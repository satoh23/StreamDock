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
  assertAllowedThemeImportUrl,
  isInternalAddress,
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
 * 取得の絶対上限（バイト）。**Rust の `MAX_CSS_BYTES`（256KB）と同値**。
 *
 * ⚠ 実際に使う上限は呼び出し側が渡す `maxBytes`（`256KB − 既存 CSS 長` の**動的値**）で、
 * ここはその**クランプ用の天井**である。⚠⚠ 制御フレームは未認証の loopback WS から届きうるので、
 * 巨大な `maxBytes` を送られても天井を超えないようにする。
 */
export const THEME_IMPORT_MAX_BYTES = 256 * 1024;

/** 取得のタイムアウト（ミリ秒）。 */
const DEFAULT_TIMEOUT_MS = 10_000;

/** レート制限: 直近この時間内に */
const RATE_WINDOW_MS = 60_000;
/** 許す取得回数。 */
const RATE_MAX_IN_WINDOW = 8;

/**
 * 060c: 取得のレート制限（同時 1 件・直近 60 秒で 8 件）。
 *
 * ⚠ 同意ダイアログは frontend にあり、**sidecar 側からは同意の有無を検証できない**。チケット認証で
 * 「StreamDock の窓以外は送れない」ようにはしてあるが、窓の中でスクリプト実行を許した場合の
 * 連射までは止められないので、**回数の天井**を別に置く（ビーコン化・第三者への負荷の両方を抑える）。
 */
class RateLimiter {
  private inFlight = false;
  private readonly recent: number[] = [];

  /** 取得を始めてよければ `true`（`finish()` を必ず呼ぶこと）。 */
  tryStart(now: number): boolean {
    if (this.inFlight) return false;
    while (this.recent.length > 0 && now - this.recent[0] > RATE_WINDOW_MS) {
      this.recent.shift();
    }
    if (this.recent.length >= RATE_MAX_IN_WINDOW) return false;
    this.recent.push(now);
    this.inFlight = true;
    return true;
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
export function createThemeImporter(deps: ThemeImportDeps = {}) {
  const limiter = new RateLimiter();
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
