// 060c: カスタム CSS テーマの外部 `@import` を**取り込み時に 1 回だけ**取得する（スナップショット）。
//
// ⚠⚠ **実行時には一切通信しない。** ここで取得した CSS 本文は viewer へ返され、除去済み CSS の前に
// 前置されて Rust の `import_overlay_theme_snapshot` で保存される。保存後は完全オフラインで、
// 取得した CSS の中に残る外部参照（`url()` の画像・Web フォント・入れ子の `@import`）は
// **060b のサニタイザが除去する**。
//
// ## 責務を 3 つに割ってある理由
//
// 1. `assertAllowedThemeImportUrl`（`host-guard.ts`）… URL の形（同期・ネットワークに触らない）
// 2. `assertResolvesToPublicAddress`（本ファイル）… 解決先アドレス（非同期・DNS のみ）
// 3. `runThemeImportFetch`（本ファイル）… 取得本体（リダイレクト禁止・上限・Content-Type）
//
// ⚠ 3 をテストから直接叩けるようにするための分割である。テスト用のローカルサーバは必ず `127.0.0.1` に
// 立つので、1 と 2 を通したままでは**取得本体を 1 行もテストできない**（ガード自体は
// `scripts/test-host-guard.mjs` が網羅する）。**この分割を潰さないこと。**
//
// ## §9
//
// **取得先 URL も CSS 本文もログに出さない。** 呼び出し側へ返す失敗理由は下の固定語彙だけで、
// HTTP ステータスもレスポンス本文も載せない。
import { lookup } from "node:dns/promises";

import {
  assertAllowedThemeFontUrl,
  assertAllowedThemeImportUrl,
  isInternalAddress,
  themeFontFetch,
  themeImportFetch,
} from "./host-guard.js";

/** 失敗理由（**固定語彙のみ**。URL・本文・HTTP ステータスを載せない＝§9）。 */
export type ThemeImportFailure =
  | "blocked" // ガード拒否（URL の形 / 解決先が内部）
  // ⚠ レート制限は `blocked` から分けてある（security-review 060c S-7）。まとめると UI が
  // 「アドレスが変わっている・許可していない形式」と案内してしまい、**ユーザーが取る行動が変わる**
  // （前者は URL を直す／後者は少し待つ）。⚠ §9 的には安全——回数の話しか漏れない。
  | "rate" // レート制限（同時 1 件・直近 60 秒で 8 件）
  | "redirect" // リダイレクトされた
  | "type" // Content-Type が text/css でない
  | "size" // 上限を超えた
  | "timeout" // 時間切れ
  | "network"; // 接続失敗・その他

export type ThemeImportResult =
  | { ok: true; css: string }
  | { ok: false; reason: ThemeImportFailure };

/**
 * 060h: フォント実体の取得結果。
 *
 * ⚠⚠ **`mime` は sidecar が allow-list で検証した値だけ**が入る。frontend はこれをそのまま
 * `data:<mime>;base64,<base64>` に組むので、**frontend 側が型を自由に決められない**ことが要件である
 * （決められると `data:text/html` のような形を CSS へ埋め込めてしまう）。
 * ⚠ 失敗理由の語彙は CSS 取得と共通（§9・固定語彙のみ）。
 */
export type ThemeFontResult =
  | { ok: true; mime: string; base64: string }
  | { ok: false; reason: ThemeImportFailure };

/**
 * 取得の絶対上限（バイト）。**Rust の `MAX_CSS_BYTES`（256KB）と同値**。
 *
 * ⚠ 実際に使う上限は呼び出し側が渡す `maxBytes`（`256KB − 既存 CSS 長` の**動的値**）で、
 * ここはその**クランプ用の天井**である。⚠⚠ 制御フレームは未認証の loopback WS から届きうるので、
 * 巨大な `maxBytes` を送られても天井を超えないようにする。
 */
export const THEME_IMPORT_MAX_BYTES = 256 * 1024;

/**
 * 060h: **フォント実体 1 本**の絶対上限（バイト）。
 *
 * ⚠ Google Fonts の日本語サブセットは 1 本 4〜40KB。**分割していない CJK フォント丸ごと（1〜4MB）は
 * ここで落ちる**＝「1 本で総量予算を食い潰す」形を構造的に排除する。
 * ⚠ 実際に使う上限は呼び出し側が渡す `maxBytes`（残り予算）で、ここはその**クランプ用の天井**である。
 */
export const THEME_FONT_MAX_BYTES = 512 * 1024;

/**
 * 060h: フォント実体で許す `Content-Type`（MIME の**厳密一致**のみ。前方一致にしない）。
 *
 * ⚠⚠ **`application/octet-stream` は入れない。** 許すと MIME 検査が実質無効になり、
 * 「何でも取れる汎用フェッチャ」＝ `docs/security.md` §1 例外の無制限な拡大になる。
 * `fonts.gstatic.com` は `font/woff2` を返す（実運用で必要十分）。
 * ⚠ 綴りの揺れ（`application/font-woff2` 等）は実サーバに存在するので入れてある。
 */
const THEME_FONT_MIME_TYPES = new Set<string>([
  "font/woff2",
  "font/woff",
  "application/font-woff2",
  "application/font-woff",
  "application/x-font-woff2",
  "application/x-font-woff",
]);

/** 取得のタイムアウト（ミリ秒）。 */
const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * 060h: **フォント 1 本**のタイムアウト（ミリ秒）。CSS の 10 秒より短い。
 *
 * ⚠ 日本語 1 ファミリは unicode-range で約 110 分割されるので、10 秒 × 110 本＝最悪 18 分になる。
 * woff2 は 1 本数十 KB なので 5 秒あれば十分で、**短くすることが可用性の担保**になっている。
 *
 * ⚠⚠ **この値だけは未実測のまま残っている**（060h review Q-9・受容）。本ファイルの他の上限
 * （512KiB / 300 件 / 16MiB）は「濫用の天井」なので余裕を持たせてあるが、こちらは
 * **短すぎると正常系が壊れる**向きの値である。実測していない前提が 2 つある:
 * ①1 本の実所要時間（初回は TLS ハンドシェイクを含む）②`assertResolvesToPublicAddress` の
 * **DNS 解決はこのタイムアウトの外**なので、実際の 1 本あたり総時間は「5 秒 ＋ DNS」になる。
 * 失敗しても graceful（`failed` に数えて続行）なので事故にはならないが、遅い回線では
 * 「110 本のうち一部だけ入って残りは端末フォント」という**まだら状態が既定の挙動**になりうる。
 * ⚠ 再修正トリガー＝**実機確認で「取り込めた本数 / 候補本数」が安定して 1 を割る**なら、
 * まずここを 8 秒程度へ上げて再測すること（レート枠は 300 件あるので件数側は余る）。
 */
const FONT_TIMEOUT_MS = 5_000;

/** レート制限: 直近この時間内に */
const RATE_WINDOW_MS = 60_000;
/** 許す取得回数。 */
const RATE_MAX_IN_WINDOW = 8;

/**
 * 060h: **フォント枠**で許す取得回数（直近 60 秒）。
 *
 * ⚠⚠ **CSS 枠（8 件）とは別枠**である。理由＝日本語 1 ファミリで 110 本を引くので、8 件では
 * 「書体が入らない」が既定の挙動になる。**枠を分けても濫用防止は薄くならない**:
 * ①この枠を使えるのは `assertAllowedThemeFontUrl`（`.woff2` / `.woff` 終端）＋
 *   `Content-Type` がフォント系、を**両方**満たす宛先だけ ②下の**バイト側の天井**を新設した
 * ③チケット認証と毎回の明示同意はそのまま効く。
 */
const FONT_RATE_MAX_IN_WINDOW = 300;

/**
 * 060h: **フォント枠**で許す総バイト（直近 60 秒）。
 *
 * ⚠⚠ **件数だけでは濫用の形を測れない**——ビーコンは件数、持ち出しは**バイト**で効く。
 * 両方に天井を置くほうが、件数だけだった 060c より**むしろ強い**。
 * 値は「1 テーマぶんの予算（生 3MiB）を数回撮り直せる」程度。
 */
const FONT_RATE_MAX_BYTES_IN_WINDOW = 16 * 1024 * 1024;

/**
 * 060c: 取得のレート制限（同時 1 件・直近 60 秒で 8 件）。
 *
 * ⚠ 同意ダイアログは frontend にあり、**sidecar 側からは同意の有無を検証できない**。チケット認証で
 * 「StreamDock の窓以外は送れない」ようにはしてあるが、窓の中でスクリプト実行を許した場合の
 * 連射までは止められないので、**回数の天井**を別に置く（ビーコン化・第三者への負荷の両方を抑える）。
 */
class RateLimiter {
  private inFlight = false;
  private readonly recent: { at: number; bytes: number }[] = [];

  /**
   * @param maxInWindow      直近 60 秒に許す**件数**。
   * @param maxBytesInWindow 直近 60 秒に許す**総バイト**（`null` なら件数だけで測る＝ 060c の CSS 枠）。
   *   ⚠ 060h のフォント枠だけがこれを使う（ビーコンは件数・持ち出しはバイトで効くため）。
   */
  constructor(
    private readonly maxInWindow: number,
    private readonly maxBytesInWindow: number | null = null,
  ) {}

  /** 取得を始めてよければ `true`（`finish()` を必ず呼ぶこと）。 */
  tryStart(now: number): boolean {
    if (this.inFlight) return false;
    while (this.recent.length > 0 && now - this.recent[0].at > RATE_WINDOW_MS) {
      this.recent.shift();
    }
    if (this.recent.length >= this.maxInWindow) return false;
    if (this.maxBytesInWindow !== null) {
      const spent = this.recent.reduce((sum, e) => sum + e.bytes, 0);
      // ⚠ **窓の中で既に上限へ達していたら始めない**（1 本ぶんの超過は許すが、次からは止まる）。
      if (spent >= this.maxBytesInWindow) return false;
    }
    this.recent.push({ at: now, bytes: 0 });
    this.inFlight = true;
    return true;
  }

  /** 060h: 実際に受け取ったバイト数を、いま始めた 1 件へ計上する（バイト枠を持つときだけ意味がある）。 */
  record(bytes: number): void {
    const last = this.recent[this.recent.length - 1];
    if (last !== undefined) last.bytes = bytes;
  }

  finish(): void {
    this.inFlight = false;
  }
}

/**
 * 060c: ホスト名の**解決先**が公開アドレスであることを確かめる（1 つでも内部なら throw）。
 *
 * ⚠⚠ `assertAllowedThemeImportUrl` は IP リテラルを拒否するが、
 * **`internal.corp.example` → `10.0.0.5` のように名前が内部 IP を指す形**は塞げない（古典的 SSRF）。
 * ここで取得の直前に解決して塞ぐ。
 * ⚠ **DNS リバインディング**（検査後・接続前に応答が差し替わる）は残る。詳細は `isInternalAddress` の注記。
 */
export async function assertResolvesToPublicAddress(
  hostname: string,
  resolver: typeof lookup = lookup,
): Promise<void> {
  const addresses = await resolver(hostname, { all: true, verbatim: true });
  if (addresses.length === 0) {
    throw new Error("no address");
  }
  for (const entry of addresses) {
    if (isInternalAddress(entry.address, entry.family)) {
      throw new Error("internal address");
    }
  }
}

/**
 * テストから差し替えられるようにした取得本体の依存。**本番では既定値のまま使う。**
 *
 * ⚠⚠ **`fetchImpl` を本番コードから渡さないこと**（渡すとガードを迂回できる唯一の形になる）。
 * `scripts/test-theme-import.mjs` の静的検査が「`src/` に `fetchImpl:` が本ファイル以外に現れないこと」と
 * 「`index.ts` が `createThemeImporter()` を引数なしで呼ぶこと」を固定している
 * （security-review 060c S-6。3 分割の理由は本ファイル冒頭の注記）。
 */
export interface ThemeImportDeps {
  /** ⚠ 既定は `themeImportFetch`＝ **必ず `assertAllowedThemeImportUrl` を通る**入口。 */
  fetchImpl?: (url: string, init: RequestInit) => Promise<Response>;
  timeoutMs?: number;
}

/**
 * 取得本体。**URL の形と解決先の検査は済んでいる前提**で呼ぶ（責務分割の注記を参照）。
 *
 * - **リダイレクトを追わない**（`redirect: "error"`）。⚠ 追うとガードをリダイレクト先で迂回できる。
 * - **送信データはゼロ**（GET・ボディ無し・Cookie 無し・Referer 無し・カスタムヘッダ無し）。
 * - **`Content-Length` を信用しない**——読みながら加算し、上限を超えた時点で打ち切る。
 * - `Content-Type` が `text/css` でなければ失敗（HTML を CSS として保存させない）。
 * - **リトライしない**（hot-loop を作らない）。
 */
export async function runThemeImportFetch(
  url: string,
  maxBytes: number,
  deps: ThemeImportDeps = {},
): Promise<ThemeImportResult> {
  const limit = Math.min(Math.max(Math.floor(maxBytes), 1), THEME_IMPORT_MAX_BYTES);
  const fetchImpl = deps.fetchImpl ?? themeImportFetch;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetchImpl(url, {
      method: "GET",
      redirect: "error",
      signal: controller.signal,
      // ⚠ `cache: "no-store"` は付けていない——Node（undici）の `RequestInit` に当該フィールドが無く
      // 型で落ちる。undici は既定で HTTP キャッシュを持たないので指定しても意味が無い
      // （**取得内容のキャッシュを作らない**という 060c の要件は、そもそも保存しないことで満たしている）。
      referrerPolicy: "no-referrer",
      credentials: "omit",
      // ⚠ ヘッダは 1 つも足さない（User-Agent は Node の既定のみ）。
      headers: {},
    });

    // ⚠ `redirect: "error"` は fetch を reject させるが、実装差で `response.redirected` を
    // 返す経路が将来生まれても素通りしないように、ここでも見る（多層防御）。
    if (response.redirected || (response.status >= 300 && response.status < 400)) {
      return { ok: false, reason: "redirect" };
    }
    if (!response.ok) {
      return { ok: false, reason: "network" };
    }

    const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
    // `text/css` / `text/css;charset=utf-8` を許す。`text/csshack` のような前方一致の抜けは作らない。
    const mime = contentType.split(";")[0].trim();
    if (mime !== "text/css") {
      return { ok: false, reason: "type" };
    }

    const body = response.body;
    if (!body) {
      return { ok: false, reason: "network" };
    }

    // ⚠⚠ **`Content-Length` を一切見ない。** 嘘をつけるヘッダなので、実バイトを数えて打ち切る。
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, reason: "size" };
      }
      chunks.push(value);
    }

    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    // ⚠ `fatal: false`＝不正バイトは U+FFFD に置換する。Rust 側の UTF-8 検査で落ちない側へ倒しておき、
    // 「取得できたのに保存で落ちる」を作らない（本文の危険性はサニタイザが見る）。
    const css = new TextDecoder("utf-8", { fatal: false }).decode(merged);
    return { ok: true, css };
  } catch (error) {
    if (timedOut) return { ok: false, reason: "timeout" };
    // ⚠ エラーの中身は見ない・出さない（§9）。`redirect: "error"` の reject もここへ来るが、
    // 種別を判別するには実装依存の文言に頼ることになるので "network" に丸める
    // （リダイレクトかどうかはユーザーの取る行動を変えないため）。
    const name = (error as { name?: unknown })?.name;
    if (name === "AbortError" || name === "TimeoutError") {
      return { ok: false, reason: "timeout" };
    }
    return { ok: false, reason: "network" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 060c: 制御フレームから呼ぶ入口。**ガード → DNS 検査 → 取得**の順に通す。
 *
 * ⚠ 順序が要件である——ガードを通さないまま DNS を引くと、その時点で**存在確認の egress**（DNS クエリ）が
 * 攻撃者の任意ホストへ飛ぶ。形の検査を先に置くことでそれも塞ぐ。
 */
/**
 * 060h: **フォント実体**の取得本体。**URL の形と解決先の検査は済んでいる前提**で呼ぶ。
 *
 * ⚠⚠ **`runThemeImportFetch` と共通化していないのは意図である。** あちらは `text/css` 前提で
 * `TextDecoder` を通すが、こちらは**デコードせず base64 化する**（フォントはバイナリで、
 * U+FFFD 置換が入った瞬間にフォントとして壊れる）。1 本にまとめると
 * 「片方の緩みがもう片方へ伝播する」形になり、`Content-Type` の allow-list も混ざる。
 *
 * - **リダイレクトを追わない**（`redirect: "error"` ＋ `response.redirected` / 3xx の 2 層）。
 * - **送信データはゼロ**（GET・ボディ無し・Cookie 無し・Referer 無し・カスタムヘッダ無し）。
 * - **`Content-Length` を信用しない**——読みながら加算し、上限を超えた時点で打ち切る。
 * - `Content-Type` が [`THEME_FONT_MIME_TYPES`] のいずれでもなければ失敗。
 * - **リトライしない**。
 */
export async function runThemeFontFetch(
  url: string,
  maxBytes: number,
  deps: ThemeImportDeps = {},
): Promise<ThemeFontResult> {
  const limit = Math.min(Math.max(Math.floor(maxBytes), 1), THEME_FONT_MAX_BYTES);
  const fetchImpl = deps.fetchImpl ?? themeFontFetch;
  const timeoutMs = deps.timeoutMs ?? FONT_TIMEOUT_MS;

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetchImpl(url, {
      method: "GET",
      redirect: "error",
      signal: controller.signal,
      referrerPolicy: "no-referrer",
      credentials: "omit",
      // ⚠ ヘッダは 1 つも足さない（`Accept` すら送らない＝識別子になりうるものをゼロにする・§9）。
      headers: {},
    });

    if (response.redirected || (response.status >= 300 && response.status < 400)) {
      return { ok: false, reason: "redirect" };
    }
    if (!response.ok) {
      return { ok: false, reason: "network" };
    }

    const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
    const mime = contentType.split(";")[0].trim();
    // ⚠⚠ **allow-list の厳密一致**（`application/octet-stream` は入っていない）。
    if (!THEME_FONT_MIME_TYPES.has(mime)) {
      return { ok: false, reason: "type" };
    }

    const body = response.body;
    if (!body) {
      return { ok: false, reason: "network" };
    }

    // ⚠⚠ **`Content-Length` を一切見ない。** 嘘をつけるヘッダなので、実バイトを数えて打ち切る。
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, reason: "size" };
      }
      chunks.push(value);
    }

    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    // ⚠⚠ **デコードしない。** `TextDecoder` を通すと不正バイトが U+FFFD へ置換され、
    // フォントとして壊れる（CSS 取得側とここが決定的に違う点）。
    return { ok: true, mime, base64: Buffer.from(merged).toString("base64") };
  } catch (error) {
    if (timedOut) return { ok: false, reason: "timeout" };
    // ⚠ エラーの中身は見ない・出さない（§9）。
    const name = (error as { name?: unknown })?.name;
    if (name === "AbortError" || name === "TimeoutError") {
      return { ok: false, reason: "timeout" };
    }
    return { ok: false, reason: "network" };
  } finally {
    clearTimeout(timer);
  }
}

export function createThemeImporter(deps: ThemeImportDeps = {}) {
  const limiter = new RateLimiter(RATE_MAX_IN_WINDOW);
  return async function fetchThemeCss(
    url: string,
    maxBytes: number,
    now: number = Date.now(),
  ): Promise<ThemeImportResult> {
    if (!limiter.tryStart(now)) {
      return { ok: false, reason: "rate" };
    }
    try {
      let hostname: string;
      try {
        // ⚠ 形の検査を**先に**行う（DNS より前）。ここで throw すれば 1 バイトも外へ出ない。
        //   `themeImportFetch` の中でも同じアサートが走る（多層防御・呼び忘れを作らない）。
        const parsed = new URL(url);
        hostname = parsed.hostname;
      } catch {
        return { ok: false, reason: "blocked" };
      }
      try {
        // ⚠ `themeImportFetch` の中でも同じアサートが走るが、**ここでも通す**——DNS を引く前に
        // 落とさないと、形が不正な宛先へ「存在確認の DNS クエリ」だけが飛んでしまう。
        assertAllowedThemeImportUrl(url);
        await assertResolvesToPublicAddress(hostname);
      } catch {
        return { ok: false, reason: "blocked" };
      }
      return await runThemeImportFetch(url, maxBytes, deps);
    } finally {
      limiter.finish();
    }
  };
}

/**
 * 060h: フォント取得の入口。**ガード → DNS 検査 → 取得**の順は CSS と同じで、違うのは
 * ①専用ガード（`.woff2` / `.woff`）②**別枠のレート制限**（件数 300 / 60 秒 ＋ バイト 16MiB / 60 秒）
 * ③取得本体（デコードせず base64 化）。
 *
 * ⚠ 順序が要件である——ガードを通さないまま DNS を引くと、その時点で**存在確認の egress**（DNS クエリ）が
 * 攻撃者の任意ホストへ飛ぶ。
 */
export function createThemeFontFetcher(deps: ThemeImportDeps = {}) {
  const limiter = new RateLimiter(
    FONT_RATE_MAX_IN_WINDOW,
    FONT_RATE_MAX_BYTES_IN_WINDOW,
  );
  return async function fetchThemeFont(
    url: string,
    maxBytes: number,
    now: number = Date.now(),
  ): Promise<ThemeFontResult> {
    if (!limiter.tryStart(now)) {
      return { ok: false, reason: "rate" };
    }
    try {
      let hostname: string;
      try {
        const parsed = new URL(url);
        hostname = parsed.hostname;
      } catch {
        return { ok: false, reason: "blocked" };
      }
      try {
        // ⚠ 形の検査を**先に**行う（DNS より前）。ここで throw すれば 1 バイトも外へ出ない。
        assertAllowedThemeFontUrl(url);
        await assertResolvesToPublicAddress(hostname);
      } catch {
        return { ok: false, reason: "blocked" };
      }
      const result = await runThemeFontFetch(url, maxBytes, deps);
      // ⚠ **バイト枠へ計上する**（成功したぶんだけ。失敗は 0 バイト扱い）。
      if (result.ok) {
        // base64 は生バイトの 4/3。枠は**生バイト**で測る（受け取った量そのもの）。
        limiter.record(Math.floor((result.base64.length * 3) / 4));
      }
      return result;
    } finally {
      limiter.finish();
    }
  };
}

/**
 * テスト用に公開する内部（`host-guard.ts` の `__hostGuardInternals` と同じ作法）。
 *
 * ⚠⚠ **060h security-review S-8 で足した。** フォント枠の**バイト側の天井**は
 * `docs/security.md` §1 が「枠を分けても濫用防止は薄くならない」と言うための 3 根拠の 1 つなのに、
 * **1 行もテストが無く、削除する変異が生存していた**（実測）。
 * `createThemeFontFetcher` 経由では成功する取得が要る＝実ネットワークになってしまうので、
 * [`RateLimiter`] を直接叩けるようにしてここで固定する。
 * ⚠ **本番コードからは参照しないこと**（`fetchImpl` と同じ扱い）。
 */
export const __themeImportInternals = {
  RateLimiter,
  RATE_WINDOW_MS,
  RATE_MAX_IN_WINDOW,
  FONT_RATE_MAX_IN_WINDOW,
  FONT_RATE_MAX_BYTES_IN_WINDOW,
};
