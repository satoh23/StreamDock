// 032c-b コミット2: allow-list 二層強制の②「fail-closed ホストガード」。
// 取得経路（Device Code / Helix / EventSub）が使う **fetch** と **ws クライアント生成** を包み、
// allow-list 以外の宛先は throw する（既定拒否＝fail-closed）。§1 の allow-list 限定を実コードで担保する。
//
// 許可宛先:
//   - HTTPS: id.twitch.tv（Device Code/token）, api.twitch.tv（Helix）, oauth2.googleapis.com / www.googleapis.com（YouTube・032c-d）,
//            *.ggpht.com / *.googleusercontent.com（YouTube アバター画像 CDN・036b。data URI 化は sidecar 内で完結）
//   - WSS  : eventsub.wss.twitch.tv（EventSub）, *.wss.twitch.tv（reconnect_url は Twitch 由来）
//   - gRPC : www.googleapis.com:443 のみ（別途 assertAllowedGrpcTarget・最狭）
// telemetry/analytics/crash-report は依存にも入れない。取得コメント・data URI は端末外へ出さない。
import WebSocket from "ws";

/** 完全一致で許可するホスト（HTTPS/WSS 共通で参照）。 */
const ALLOWED_EXACT_HOSTS = new Set<string>([
  "id.twitch.tv",
  "api.twitch.tv",
  "eventsub.wss.twitch.tv",
  // 032c-d コミット1: YouTube OAuth のトークン交換/更新エンドポイント（認可コード → token）。
  // 認可画面 accounts.google.com はブラウザ側（Rust opener が開く）で sidecar の fetch は張らないため
  // ここには入れない。
  "oauth2.googleapis.com",
  // 032c-d コミット2: YouTube Data API v3。REST 検出（search/videos/channels・mine=true）の fetch がここを通る。
  // gRPC streamList も同 host（別途 gRPC チャネルガードで照合）。
  "www.googleapis.com",
]);

/** WSS 専用ワイルドカード許可（reconnect_url は `*.wss.twitch.tv`。Twitch 由来のサブドメイン）。 */
const ALLOWED_WS_WILDCARD_SUFFIX = ".wss.twitch.tv";

// 036b/036c: HTTPS 専用ワイルドカード許可＝投稿者アバター画像 CDN。sidecar が投稿者アイコンを取得して data URI 化する
// ための新規 egress（docs/security.md「コメントビューア方針」⑩）。**HTTPS の fetch でのみ許可**し、WS/gRPC には
// 広げない（gRPC は www.googleapis.com:443 のみのまま＝最狭を維持）。先頭ドット suffix なので真のサブドメインのみ
// 一致し、`ggpht.com.evil.com` / `evil-ggpht.com` / `jtvnw.net.evil.com` / `evil-jtvnw.net` は throw する。
// 取得は data URI で webview へ渡し、外部 URL を踏ませない。
// - 036b（YouTube）: `*.ggpht.com`（例 `yt3.ggpht.com`）／`*.googleusercontent.com`（例 `lh3.googleusercontent.com`）。
// - 036c（Twitch）: `*.jtvnw.net`（Helix `users` の `profile_image_url`＝例 `static-cdn.jtvnw.net`）。
const ALLOWED_HTTPS_WILDCARD_SUFFIXES = [
  ".ggpht.com",
  ".googleusercontent.com",
  ".jtvnw.net",
];

// 032c-d コミット2: gRPC チャネルガード用の allow-list。gRPC は fetch/ws を通らないため独立に持つ。
// **www.googleapis.com:443 のみ**を許可する（fetch の allow-list より狭い＝Twitch/oauth を gRPC target に
// できない・fail-closed）。streamList の target は Data API base URL（定数）から導出される。
// 043d(レビュー指摘・2026-07-27／現状維持): 公式ガイドのサンプルコードは `dns:///youtube.googleapis.com:443`
//   を使っている（本実装の www.googleapis.com でも実際に取得できているため広げない＝受信面最小のまま）。
//   もし将来 Google が streamList を youtube.googleapis.com へ集約すると、本ガードが fail-closed で遮断し
//   「原因不明の取得停止」に見える。遮断自体は正しい挙動なので、その症状が出たら**まずここを疑い**、
//   allow-list への追加は security-review を通してから行うこと。
const ALLOWED_GRPC_EXACT_HOSTS = new Set<string>(["www.googleapis.com"]);
const ALLOWED_GRPC_PORT = "443";

/** HTTPS fetch で許可するホスト = exact host ∨ 画像 CDN の HTTPS ワイルドカード suffix。 */
function isAllowedHttpsHost(host: string): boolean {
  return (
    ALLOWED_EXACT_HOSTS.has(host) ||
    ALLOWED_HTTPS_WILDCARD_SUFFIXES.some((suffix) => host.endsWith(suffix))
  );
}

/** WSS で許可するホスト = exact host ∨ `*.wss.twitch.tv`（画像 CDN ワイルドカードは含めない）。 */
function isAllowedWssHost(host: string): boolean {
  return ALLOWED_EXACT_HOSTS.has(host) || host.endsWith(ALLOWED_WS_WILDCARD_SUFFIX);
}

/**
 * 060c: `installHttpHostGuard` が global `fetch` を差し替える**前**の素の関数。
 * ⚠ **参照をモジュール外へ出さないこと。** 使ってよいのは `themeImportFetch`（必ずアサートを通す）だけ。
 */
let preGuardFetch: typeof fetch | null = null;

class DisallowedHostError extends Error {
  constructor(url: string) {
    super(`[comment-sidecar] blocked by allow-list: ${redactUrl(url)}`);
    this.name = "DisallowedHostError";
  }
}

/** ログ/エラーに載せる際、クエリ（token/code を含み得る）を落として host+path のみにする（§9）。 */
function redactUrl(raw: string): string {
  try {
    const u = new URL(raw);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return "<invalid-url>";
  }
}

function assertAllowedHttpUrl(raw: string): void {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new DisallowedHostError(raw);
  }
  if (u.protocol !== "https:" || !isAllowedHttpsHost(u.hostname)) {
    throw new DisallowedHostError(raw);
  }
}

function assertAllowedWsUrl(raw: string): void {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new DisallowedHostError(raw);
  }
  if (u.protocol !== "wss:" || !isAllowedWssHost(u.hostname)) {
    throw new DisallowedHostError(raw);
  }
}

/**
 * 044a（OBS 連携）: OBS WebSocket 接続先を **loopback 限定**で許可する fail-closed アサート。
 * 許可は `ws://127.0.0.1:<port>`（port は 1〜65535 の数値）**のみ**で、他ホスト・非 ws・userinfo 付き・
 * ポート欠落は throw する。obs-websocket-js は isomorphic-ws→`ws` パッケージを使い global `WebSocket` を
 * 通らないため、global ガードでは傍受できない。よって **OBS クライアントが接続直前に本アサートを呼ぶ**
 * （①`127.0.0.1` のコード定数化＝ホストピン留め、②本アサート、の二層で loopback 限定を担保）。
 * 外部 HTTPS/WSS/gRPC の allow-list とは**分離**し、ここに loopback を混ぜない（外部宛先は増やさない）。
 */
export function assertAllowedObsUrl(raw: string): void {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new DisallowedHostError(raw);
  }
  const port = Number(u.port);
  if (
    u.protocol !== "ws:" ||
    u.hostname !== "127.0.0.1" ||
    u.username !== "" ||
    u.password !== "" ||
    u.port === "" ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  ) {
    throw new DisallowedHostError(raw);
  }
}

// --- 060c: カスタム CSS テーマの外部 `@import` 取得（スナップショット） ---------------------------
//
// ⚠⚠ **このブロックは上の allow-list とは完全に分離されている。** 宛先はユーザーが持ち込んだ CSS に
// 書かれた URL なので allow-list で固定できず（既存 7 例外との決定的な違い）、代わりに
// ①**取得のたびにユーザーが完全な URL とホストを目で見て同意する**（frontend の同意ダイアログ）
// ②**取得できる形を極端に狭める**（下の `assertAllowedThemeImportUrl`）の 2 本で担保する。
// 詳細は docs/security.md §1 の「例外（060c・…）」。
//
// ⚠⚠ **`assertAllowedObsUrl` は loopback を「許可」する逆向きのガードである。絶対に流用・統合しないこと。**
// あちらは「loopback 以外を拒否」、こちらは「loopback を含む内部宛先を拒否」で、要件が正反対である。

/** メタデータサービス等、**名前で**内部へ解決される既知の宛先（IP リテラル拒否では捕まらない分）。 */
const THEME_IMPORT_BLOCKED_HOSTS = new Set<string>([
  "169.254.169.254",
  "metadata.google.internal",
  "metadata.goog",
]);

/** 内部用に予約されたサフィックス（mDNS / 社内 TLD / ループバック別名）。 */
const THEME_IMPORT_BLOCKED_SUFFIXES = [
  ".local",
  ".localhost",
  ".internal",
  ".home.arpa",
  ".localdomain",
];

/**
 * 完全一致で拒否する単独ラベル。
 *
 * ⚠ **いまは到達不能（意図的な冗長）**——下の `!host.includes(".")` が単一ラベルのホストを
 * 例外なく落とすので、この 3 つが決め手になることはない（security-review 060c Q-5）。
 * 残しているのは「単一ラベル拒否」が将来ゆるむ可能性への保険で、**消しても現状の挙動は変わらない**。
 * ⚠ 再修正トリガー＝「単一ラベルを許す」変更（社内配布向け等）を入れるなら、
 * **そのとき初めてこの表が load-bearing になる**ので、中身を実態に合わせて見直すこと。
 */
const THEME_IMPORT_BLOCKED_EXACT = new Set<string>([
  "localhost",
  "local",
  "localdomain",
]);

/**
 * ホスト名を判定用に正規化する（小文字化 ＋ **末尾ドットを全部**落とす）。
 *
 * ⚠ **これが無いと `https://evil.local./a.css` がサフィックス判定を素通りする**
 * （`"evil.local."` は `.local` で終わらない）。DNS 的には同じ宛先なので必ず正規化してから判定する。
 * ⚠⚠ **1 個だけ剥がす実装では `https://evil.local../a.css` が素通りする**
 * （security-review 060c S-1・実測。`localhost..` `metadata.google.internal..` も同様に通っていた）。
 * ドットは**貪欲に**落とすこと。空ラベル（`a..b` / `.a.b`）は [`hasEmptyLabel`] が別に拒否する
 * ——「末尾ドットを剥がす」と「空ラベルを許さない」は**別の失敗モード**なので両方要る。
 */
function normalizeThemeImportHost(hostname: string): string {
  return hostname.toLowerCase().replace(/\.+$/, "");
}

/**
 * ホスト名に**空ラベル**が含まれるか（`a..b` / `.a.b`）。
 *
 * ⚠ WHATWG URL は special scheme でも空ラベルを弾かない（実測: `new URL("https://a..b/x.css").hostname`
 * は `"a..b"`）。正当なホスト名には存在しない形なので拒否側へ倒す。
 * ⚠⚠ **リゾルバに判定を預けない**のが要点——macOS の `getaddrinfo` は空ラベルを `ENOTFOUND` にするが
 * （実測）、これは実装依存であって仕様上の保証ではない。ここで落としておけば
 * 「ガード（形）＋ DNS（解決先）の 2 本立て」がプラットフォームに依存せず成立する。
 */
function hasEmptyLabel(host: string): boolean {
  return host.split(".").some((label) => label === "");
}

/**
 * ドット 10 進の IPv4 リテラルか。
 *
 * ⚠ WHATWG URL は **special scheme のとき IPv4 を正規化する**ので、`https://2130706433/`・
 * `https://0x7f.0.0.1/`・`https://127.1/` はいずれも `hostname` が `"127.0.0.1"` になる。
 * ＝ 10 進・8 進・16 進の変種を個別に見る必要はなく、この 1 本で捕まる（実測で確認）。
 */
function isIpv4Literal(host: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host);
}

/**
 * ドット 10 進の IPv4 が**内部宛先**か（loopback / プライベート / link-local / CGNAT / 予約）。
 *
 * ⚠ 呼ぶのは [`isIpv4Literal`] が true のものだけ。形が壊れていたら**拒否側**（true）へ倒す。
 */
function isInternalIpv4(host: string): boolean {
  const parts = host.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a, b] = parts;
  return (
    a === 0 || // 0.0.0.0/8「このネットワーク」
    a === 10 || // プライベート
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // CGNAT 100.64.0.0/10
    (a === 169 && b === 254) || // link-local（メタデータを含む）
    (a === 172 && b >= 16 && b <= 31) || // プライベート
    (a === 192 && b === 0) || // 192.0.0.0/24・192.0.2.0/24（IETF 予約 / TEST-NET-1）
    (a === 192 && b === 168) || // プライベート
    (a === 198 && (b === 18 || b === 19)) || // ベンチマーク 198.18.0.0/15
    (a === 198 && b === 51) || // TEST-NET-2
    (a === 203 && b === 0) || // TEST-NET-3
    a >= 224 // マルチキャスト / 予約 / ブロードキャスト
  );
}

/** 16bit グループ 2 つ（IPv6 の下位 32bit）をドット 10 進の IPv4 へ戻す。 */
function ipv4FromGroups(hi: number, lo: number): string {
  return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
}

/**
 * IPv6 文字列を **8 個の 16bit グループへ展開**する。解釈できない形は `null`。
 *
 * ⚠⚠ **文字列のまま前方一致で判定してはいけない**（security-review 060c S-2・実測）。
 * 旧実装は `addr.split(":")[0] || "0"` で先頭グループを取っていたため、`::` で始まるアドレスの
 * 空文字が `"0"` に化けて **`::ffff:7f00:1`（＝ 127.0.0.1 の hex 表記）や `0:0:0:0:0:ffff:127.0.0.1`
 * （非圧縮）が public 判定**になっていた。表記の揺れ（圧縮の有無・hex/ドット・ゾーン ID）を
 * ここで 1 つの形へ潰してから判定する。
 *
 * 対応する表記: 角括弧付き `[::1]` ／ ゾーン ID 付き `fe80::1%eth0` ／
 * 末尾がドット 10 進の埋め込み IPv4（`::ffff:127.0.0.1` / `::127.0.0.1`）。
 */
function expandIpv6(raw: string): number[] | null {
  let addr = raw.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  const zone = addr.indexOf("%");
  if (zone !== -1) addr = addr.slice(0, zone);

  // 末尾の `a.b.c.d` は 2 グループへ畳んでから通常の走査に載せる。
  const dotted = /:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(addr);
  if (dotted !== null) {
    const octets = dotted[1].split(".").map(Number);
    if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    const hi = ((octets[0] << 8) | octets[1]).toString(16);
    const lo = ((octets[2] << 8) | octets[3]).toString(16);
    addr = `${addr.slice(0, dotted.index)}:${hi}:${lo}`;
  }

  const toGroups = (part: string): number[] | null => {
    if (part === "") return [];
    const out: number[] = [];
    for (const g of part.split(":")) {
      if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
      out.push(Number.parseInt(g, 16));
    }
    return out;
  };

  const halves = addr.split("::");
  if (halves.length > 2) return null; // `::` は 1 回だけ
  const left = toGroups(halves[0] ?? "");
  const right = halves.length === 2 ? toGroups(halves[1]) : [];
  if (left === null || right === null) return null;
  if (halves.length === 1) return left.length === 8 ? left : null;
  const fill = 8 - left.length - right.length;
  if (fill < 1) return null;
  return [...left, ...Array<number>(fill).fill(0), ...right];
}

/**
 * IPv6 が**内部宛先**か（loopback / ULA / link-local / 埋め込み IPv4 が内部のもの）。
 * 角括弧付き（`[::1]`）でも裸でも受ける。
 *
 * ⚠⚠ **解釈できない形は `true`（拒否側）へ倒す**（security-review 060c S-2）。
 * 旧実装は末尾で `false`（＝ public）を返しており、[`isInternalIpv4`] が壊れた入力を `true` へ
 * 倒しているのと**非対称**だった。ここへ渡る文字列は「攻撃者が AAAA レコードで publish できる値」なので、
 * 知らない形は許可しないのが正しい向きである。
 */
function isInternalIpv6(raw: string): boolean {
  const g = expandIpv6(raw);
  if (g === null) return true; // ⚠ fail-closed（上の注記）
  const zeroPrefix = (n: number): boolean => g.slice(0, n).every((x) => x === 0);

  // `::`（unspecified）/ `::1`（loopback）
  if (zeroPrefix(7) && (g[7] === 0 || g[7] === 1)) return true;
  // `::ffff:a.b.c.d`（IPv4-mapped）と `::a.b.c.d`（IPv4-compatible・RFC 4291 で廃止）は
  // ⚠ **中の IPv4 で判定する**。どちらも `::` 圧縮で先頭グループが 0 になるため、
  //   グループ単位で見ないと素通りする（S-2 の実体）。
  if (zeroPrefix(5) && (g[5] === 0xffff || g[5] === 0)) {
    return isInternalIpv4(ipv4FromGroups(g[6], g[7]));
  }
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 ULA
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0] & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local（廃止だが念のため）
  // ⚠ 6to4（2002::/16）と NAT64（64:ff9b::/96）は**埋め込まれた IPv4 へ届きうる**経路なので、
  //   中の IPv4 で判定する（`2002:7f00:1::1` は 127.0.0.1 を指す）。
  if (g[0] === 0x2002) return isInternalIpv4(ipv4FromGroups(g[1], g[2]));
  if (g[0] === 0x0064 && g[1] === 0xff9b) {
    return isInternalIpv4(ipv4FromGroups(g[6], g[7]));
  }
  return false;
}

/**
 * 060c: **解決済みアドレスが内部宛先か**を判定する（`node:dns` の結果を渡す）。
 *
 * ⚠⚠ **ホスト名ベースの拒否だけでは「社内ドメインが内部 IP を指す」形を塞げない**ので、
 * 取得の直前に解決して 1 つでも内部宛先なら拒否する（`theme-import.ts` の `assertResolvesToPublicAddress`）。
 * ⚠ **DNS リバインディング**（検査後・接続直前に応答が差し替わる形）はこれでも塞げない。
 * Node の `fetch` は接続先アドレスへのフックを公開しておらず、塞ぐには `undici` の `Dispatcher` が要る
 * ＝ 新規依存になるため受容する。**再修正トリガー＝ sidecar に HTTP クライアント依存を足すことになったら、
 * 接続時アドレス検証を同時に入れること。**
 */
export function isInternalAddress(address: string, family: number): boolean {
  // ⚠ `family` の申告だけに従わず、**アドレスの形も見る**（`:` を含むなら IPv6 として扱う）。
  // family が 4/6 以外（0 等）で届いても IPv6 表記を IPv4 判定へ流さないための保険で、
  // どちらの経路も解釈できない入力は `true`（拒否側）へ倒す。
  return family === 6 || address.includes(":")
    ? isInternalIpv6(address)
    : isInternalIpv4(address);
}

/**
 * 060c: **テーマ取り込みの外部 `@import` 取得先**を検証する fail-closed アサート。
 *
 * 下の**すべて**を満たさないものは throw する。ここに書かれていない形は通らない（既定拒否）。
 *
 * | 条件 | 理由 |
 * |---|---|
 * | `https:` のみ | `http:` は中間者に書き換えられる＝任意 CSS を注入される |
 * | userinfo 無し | `https://trusted.example@evil.example/a.css` の実宛先は `evil.example` |
 * | ポート指定無し（＝ 443 のみ） | ⚠ WHATWG URL は既定ポートを削るので `https://a/x` も `https://a:443/x` も `port === ""` |
 * | クエリ・フラグメント無し | 取得できる形を狭める。⚠ **060h（Google Fonts の `?family=`）は緩和が要る**——そのときは再レビュー |
 * | パスが `.css` 終端 | 同上。`%2Ecss` は一致せず拒否＝安全側 |
 * | IP リテラルでない | ⚠ **SSRF の中核**。10 進/16 進の変種も URL 正規化で dotted-quad になるので 1 本で捕まる |
 * | 単一ラベルでない（ドットを含む） | `https://intranet/a.css` は検索ドメインで社内に解決される |
 * | 空ラベルを含まない | ⚠⚠ `https://evil.local../a.css` でサフィックス判定を逃れる形を塞ぐ（S-1・[`hasEmptyLabel`]） |
 * | `localhost` / `*.local` / `*.internal` 等でない | mDNS・社内 TLD・loopback 別名 |
 * | メタデータの既知ホスト名でない | `metadata.google.internal` は**名前**なので IP リテラル判定では捕まらない |
 *
 * ⚠ **これだけでは足りない**——ドメイン名が内部 IP に解決される形は [`isInternalAddress`] を使った
 * 取得直前の DNS 検査で塞ぐ（`theme-import.ts`）。本関数は同期で、ネットワークに触らない。
 */
export function assertAllowedThemeImportUrl(raw: string): void {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new DisallowedHostError(raw);
  }
  const host = normalizeThemeImportHost(u.hostname);
  if (
    u.protocol !== "https:" ||
    u.username !== "" ||
    u.password !== "" ||
    u.port !== "" ||
    u.search !== "" ||
    u.hash !== "" ||
    !u.pathname.toLowerCase().endsWith(".css") ||
    host === "" ||
    host.startsWith("[") || // IPv6 リテラル
    isIpv4Literal(host) || // IPv4 リテラル（10 進/16 進の変種も正規化済み）
    !host.includes(".") || // 単一ラベル＝社内解決
    hasEmptyLabel(host) || // ⚠ `evil.local..` / `.evil.example`（サフィックス判定の迂回・S-1）
    THEME_IMPORT_BLOCKED_EXACT.has(host) ||
    THEME_IMPORT_BLOCKED_HOSTS.has(host) ||
    THEME_IMPORT_BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))
  ) {
    throw new DisallowedHostError(raw);
  }
}

/**
 * 060c: テーマ取り込みの取得を行う唯一の入口。**必ず [`assertAllowedThemeImportUrl`] を通してから**、
 * `installHttpHostGuard` が差し替える**前**の素の `fetch` を呼ぶ。
 *
 * ⚠⚠ **なぜ素の `fetch` が要るのか**: global `fetch` は allow-list ガードに置き換わっているので、
 * そのまま呼ぶと**必ず throw する**（宛先はユーザー由来で allow-list に載らないため）。
 * かといって allow-list 側に穴を開けると 2 つのガードが混ざり、
 * 「Twitch/YouTube の宛先」と「ユーザーが持ってきた宛先」が同じ表で管理されることになる——
 * それは 044a が `assertAllowedObsUrl` を分離した理由と同じ形の事故につながる。
 *
 * ⚠ **素の `fetch` の参照はこのモジュールの外へ出さない**（`getUnguardedFetch()` のような形にしない）。
 * 外へ出せるのは「**必ずアサートを通る**この関数」だけである。
 */
export function themeImportFetch(
  rawUrl: string,
  init: RequestInit,
): Promise<Response> {
  assertAllowedThemeImportUrl(rawUrl);
  const unguarded = preGuardFetch ?? globalThis.fetch;
  return unguarded(rawUrl, init);
}

/**
 * 032c-d コミット2: gRPC streamList の接続先 `target`（"host:port"）を allow-list 照合する（fail-closed）。
 * gRPC は `fetch`/`ws` を通らないため独立のガード。**www.googleapis.com:443 のみ**を許可し、port 欠落・別 host・
 * 別 port・サブドメイン偽装（`www.googleapis.com.evil.com`）は throw する。api.client の client 生成前に呼ぶ。
 */
export function assertAllowedGrpcTarget(target: string): void {
  const lastColon = target.lastIndexOf(":");
  if (lastColon === -1) {
    throw new DisallowedHostError(`grpc://${target}`);
  }
  const host = target.slice(0, lastColon);
  const port = target.slice(lastColon + 1);
  if (port !== ALLOWED_GRPC_PORT || !ALLOWED_GRPC_EXACT_HOSTS.has(host)) {
    throw new DisallowedHostError(`grpc://${target}`);
  }
}

/** URL 入力を文字列へ正規化する（fetch は string / URL / Request を受ける）。 */
function urlOf(input: unknown): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  if (typeof input === "object" && input !== null && "url" in input) {
    return String((input as { url: unknown }).url);
  }
  return "";
}

/**
 * global `fetch` を allow-list ガードで置き換える。**DI 配線・auth client 生成の前に 1 度だけ呼ぶ**こと。
 * 以降、id.twitch.tv / api.twitch.tv（HTTPS）以外への fetch は throw する（Device Code も Helix もこれを通る）。
 */
export function installHttpHostGuard(): void {
  const originalFetch = globalThis.fetch;
  if (typeof originalFetch !== "function") {
    throw new Error("[comment-sidecar] global fetch is unavailable");
  }
  // 060c: ガード導入**前**の素の fetch を退避する。使ってよいのは `themeImportFetch` だけで、
  // そこでは必ず `assertAllowedThemeImportUrl` を通す（この変数はモジュール外へ出さない）。
  preGuardFetch = originalFetch;
  const guarded: typeof fetch = (input, init) => {
    assertAllowedHttpUrl(urlOf(input));
    return originalFetch(input as Parameters<typeof fetch>[0], init);
  };
  globalThis.fetch = guarded;
}

/**
 * EventSub 用の ws ランタイム（allow-list ガード付き）。DI の eventSubWebSocketRuntime に登録して使う。
 * eventsub.wss.twitch.tv / *.wss.twitch.tv（WSS）以外の接続は throw する。
 */
export const guardedWebSocketRuntime = {
  createClient: (url: string): WebSocket => {
    assertAllowedWsUrl(url);
    return new WebSocket(url);
  },
};

// テスト用に公開（allow-list の単体検証で使う）。
export const __hostGuardInternals = {
  assertAllowedHttpUrl,
  assertAllowedWsUrl,
  assertAllowedGrpcTarget,
  assertAllowedObsUrl,
  isAllowedHttpsHost,
  isAllowedWssHost,
  // 060c
  assertAllowedThemeImportUrl,
  isInternalAddress,
};
