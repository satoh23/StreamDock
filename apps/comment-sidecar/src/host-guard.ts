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
};
