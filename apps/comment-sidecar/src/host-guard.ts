// 032c-b コミット2: allow-list 二層強制の②「fail-closed ホストガード」。
// 取得経路（Device Code / Helix / EventSub）が使う **fetch** と **ws クライアント生成** を包み、
// allow-list 以外の宛先は throw する（既定拒否＝fail-closed）。§1 の allow-list 限定を実コードで担保する。
//
// 許可宛先:
//   - HTTPS: id.twitch.tv（Device Code/token）, api.twitch.tv（Helix）
//   - WSS  : eventsub.wss.twitch.tv（EventSub）, *.wss.twitch.tv（reconnect_url は Twitch 由来）
// telemetry/analytics/crash-report は依存にも入れない。取得コメントは端末外へ出さない。
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

/** ワイルドカード許可（reconnect_url は `*.wss.twitch.tv`。Twitch 由来のサブドメイン）。 */
const ALLOWED_WILDCARD_SUFFIX = ".wss.twitch.tv";

// 032c-d コミット2: gRPC チャネルガード用の allow-list。gRPC は fetch/ws を通らないため独立に持つ。
// **www.googleapis.com:443 のみ**を許可する（fetch の allow-list より狭い＝Twitch/oauth を gRPC target に
// できない・fail-closed）。streamList の target は Data API base URL（定数）から導出される。
const ALLOWED_GRPC_EXACT_HOSTS = new Set<string>(["www.googleapis.com"]);
const ALLOWED_GRPC_PORT = "443";

function isAllowedHost(host: string): boolean {
  return ALLOWED_EXACT_HOSTS.has(host) || host.endsWith(ALLOWED_WILDCARD_SUFFIX);
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
  if (u.protocol !== "https:" || !isAllowedHost(u.hostname)) {
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
  if (u.protocol !== "wss:" || !isAllowedHost(u.hostname)) {
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
  isAllowedHost,
};
