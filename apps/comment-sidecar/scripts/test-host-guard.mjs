// 032c-b コミット2: allow-list fail-closed ホストガードの単体検証。
// dist（tsc 出力）から guard を import し、許可/拒否を表明する。build:tsc または build:bundle の後に実行。
import {
  __hostGuardInternals,
  installHttpHostGuard,
} from "../dist/src/host-guard.js";

const {
  assertAllowedHttpUrl,
  assertAllowedWsUrl,
  assertAllowedGrpcTarget,
  assertAllowedObsUrl,
} = __hostGuardInternals;

let failures = 0;
const ok = (label, fn, shouldThrow) => {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  const pass = threw === shouldThrow;
  if (!pass) failures++;
  process.stderr.write(
    `${pass ? "PASS" : "FAIL"} ${label} (expected ${shouldThrow ? "throw" : "ok"})\n`,
  );
};

// HTTP: 許可 = https の id/api.twitch.tv のみ
ok("http https://api.twitch.tv/helix/users", () => assertAllowedHttpUrl("https://api.twitch.tv/helix/users"), false);
ok("http https://id.twitch.tv/oauth2/device", () => assertAllowedHttpUrl("https://id.twitch.tv/oauth2/device"), false);
ok("http https://evil.com/x", () => assertAllowedHttpUrl("https://evil.com/x"), true);
ok("http http://api.twitch.tv (not https)", () => assertAllowedHttpUrl("http://api.twitch.tv/x"), true);
ok("http https://api.twitch.tv.evil.com", () => assertAllowedHttpUrl("https://api.twitch.tv.evil.com/x"), true);
// 認証情報埋め込みバイパス: `@` の前は userinfo で hostname は evil.com になる（許可ホストに見せかけても実宛先は evil.com）。必ず拒否。
ok("http https://api.twitch.tv@evil.com (credential-embedded → host is evil.com)", () => assertAllowedHttpUrl("https://api.twitch.tv@evil.com/x"), true);
// 大文字ホスト: new URL() が hostname を小文字化するため許可される（正規化の回帰固定）。
ok("http https://API.TWITCH.TV (uppercase host normalized)", () => assertAllowedHttpUrl("https://API.TWITCH.TV/oauth2/device"), false);
// 許可ホスト＋非標準ポート: hostname は変わらない（同じ Twitch 宛先）ため許可する（意図した挙動の固定）。
ok("http https://api.twitch.tv:8443 (port on allowed host)", () => assertAllowedHttpUrl("https://api.twitch.tv:8443/helix/users"), false);

// 032c-d コミット1: YouTube OAuth のトークン交換/更新エンドポイント（認可コード → token）は許可。
ok("http https://oauth2.googleapis.com/token (youtube token)", () => assertAllowedHttpUrl("https://oauth2.googleapis.com/token"), false);
// 認可画面 accounts.google.com は **ブラウザ側**（Rust opener が開く）で sidecar の fetch は張らない → 拒否のまま。
ok("http https://accounts.google.com/o/oauth2 (browser-side, not a sidecar fetch host)", () => assertAllowedHttpUrl("https://accounts.google.com/o/oauth2/v2/auth"), true);
// Google 宛先のサブドメイン偽装は拒否。
ok("http https://oauth2.googleapis.com.evil.com (spoof)", () => assertAllowedHttpUrl("https://oauth2.googleapis.com.evil.com/token"), true);
// 032c-d コミット2: YouTube Data API v3（REST 検出 search/videos/channels）は www.googleapis.com を許可。
ok("http https://www.googleapis.com/youtube/v3/channels (REST detection)", () => assertAllowedHttpUrl("https://www.googleapis.com/youtube/v3/channels?mine=true"), false);

// 036b: YouTube アバター画像 CDN（HTTPS のみ許可・ワイルドカード）。sidecar が取得して data URI 化する新規 egress。
ok("http https://yt3.ggpht.com/ytc/AIdro_x=s48-c-k-c0x00ffffff-no-rj (avatar CDN)", () => assertAllowedHttpUrl("https://yt3.ggpht.com/ytc/AIdro_x=s48-c-k-c0x00ffffff-no-rj"), false);
ok("http https://lh3.googleusercontent.com/a/xxx=s48 (avatar CDN)", () => assertAllowedHttpUrl("https://lh3.googleusercontent.com/a/xxx=s48"), false);
// サブドメイン偽装は拒否（先頭ドット suffix なので真のサブドメインのみ許可）。
ok("http https://ggpht.com.evil.com/x (spoof)", () => assertAllowedHttpUrl("https://ggpht.com.evil.com/x"), true);
ok("http https://evil-ggpht.com/x (not a real *.ggpht.com subdomain)", () => assertAllowedHttpUrl("https://evil-ggpht.com/x"), true);
// 非 https は拒否。
ok("http http://yt3.ggpht.com/x (not https)", () => assertAllowedHttpUrl("http://yt3.ggpht.com/x"), true);
// 画像 CDN は WS/gRPC では許可しない（HTTPS 限定ワイルドカード＝egress を最小化）。
ok("ws wss://yt3.ggpht.com/x (avatar CDN not allowed on WSS)", () => assertAllowedWsUrl("wss://yt3.ggpht.com/x"), true);
ok("grpc yt3.ggpht.com:443 (avatar CDN not a gRPC host)", () => assertAllowedGrpcTarget("yt3.ggpht.com:443"), true);

// 036c: Twitch アバター画像 CDN（HTTPS のみ許可・ワイルドカード）。Helix users の profile_image_url を data URI 化する新規 egress。
ok("http https://static-cdn.jtvnw.net/jtv_user_pictures/xxx-profile_image-70x70.png (avatar CDN)", () => assertAllowedHttpUrl("https://static-cdn.jtvnw.net/jtv_user_pictures/xxx-profile_image-70x70.png"), false);
// サブドメイン偽装は拒否（先頭ドット suffix なので真のサブドメインのみ許可）。
ok("http https://jtvnw.net.evil.com/x (spoof)", () => assertAllowedHttpUrl("https://jtvnw.net.evil.com/x"), true);
ok("http https://evil-jtvnw.net/x (not a real *.jtvnw.net subdomain)", () => assertAllowedHttpUrl("https://evil-jtvnw.net/x"), true);
// 非 https は拒否。
ok("http http://static-cdn.jtvnw.net/x (not https)", () => assertAllowedHttpUrl("http://static-cdn.jtvnw.net/x"), true);
// 画像 CDN は WS/gRPC では許可しない（HTTPS 限定ワイルドカード＝egress を最小化）。
ok("ws wss://static-cdn.jtvnw.net/x (avatar CDN not allowed on WSS)", () => assertAllowedWsUrl("wss://static-cdn.jtvnw.net/x"), true);
ok("grpc static-cdn.jtvnw.net:443 (avatar CDN not a gRPC host)", () => assertAllowedGrpcTarget("static-cdn.jtvnw.net:443"), true);

// 032c-d コミット2: gRPC チャネルガード（streamList の target = "host:port"）。www.googleapis.com:443 のみ許可。
ok("grpc www.googleapis.com:443 (streamList)", () => assertAllowedGrpcTarget("www.googleapis.com:443"), false);
ok("grpc www.googleapis.com:80 (wrong port)", () => assertAllowedGrpcTarget("www.googleapis.com:80"), true);
ok("grpc www.googleapis.com (no port)", () => assertAllowedGrpcTarget("www.googleapis.com"), true);
// fetch allow-list には居るが gRPC allow-list には居ない host は gRPC target にできない（gRPC は狭い）。
ok("grpc api.twitch.tv:443 (not a gRPC host)", () => assertAllowedGrpcTarget("api.twitch.tv:443"), true);
ok("grpc oauth2.googleapis.com:443 (not a gRPC host)", () => assertAllowedGrpcTarget("oauth2.googleapis.com:443"), true);
// サブドメイン偽装・別 host は拒否。
ok("grpc www.googleapis.com.evil.com:443 (spoof)", () => assertAllowedGrpcTarget("www.googleapis.com.evil.com:443"), true);
ok("grpc evil.com:443", () => assertAllowedGrpcTarget("evil.com:443"), true);

// WS: 許可 = wss の eventsub.wss.twitch.tv / *.wss.twitch.tv
ok("ws wss://eventsub.wss.twitch.tv/ws", () => assertAllowedWsUrl("wss://eventsub.wss.twitch.tv/ws"), false);
ok("ws wss://foo.wss.twitch.tv/ws (reconnect wildcard)", () => assertAllowedWsUrl("wss://foo.wss.twitch.tv/ws"), false);
ok("ws wss://evil.com/ws", () => assertAllowedWsUrl("wss://evil.com/ws"), true);
ok("ws ws://eventsub.wss.twitch.tv (not wss)", () => assertAllowedWsUrl("ws://eventsub.wss.twitch.tv/ws"), true);
// 認証情報埋め込みバイパス（WS 版・reconnect_url が細工されても実宛先は evil.com）。必ず拒否。
ok("ws wss://eventsub.wss.twitch.tv@evil.com (credential-embedded → host is evil.com)", () => assertAllowedWsUrl("wss://eventsub.wss.twitch.tv@evil.com/ws"), true);
// 偽ワイルドカード: `.wss.twitch.tv` を含むが suffix ではない（`-wss.twitch.tv`）ため拒否されること。
ok("ws wss://evil-wss.twitch.tv/ws (not a real *.wss.twitch.tv subdomain)", () => assertAllowedWsUrl("wss://evil-wss.twitch.tv/ws"), true);

// 044a: OBS 連携ガード（loopback 限定）。許可 = ws://127.0.0.1:<port> のみ。obs-websocket-js は ws パッケージ経由で
// global WebSocket を通らないため、OBS クライアントが接続直前にこれを呼ぶ（ホストピン留めの二層目）。
ok("obs ws://127.0.0.1:4455 (default loopback)", () => assertAllowedObsUrl("ws://127.0.0.1:4455"), false);
ok("obs ws://127.0.0.1:4455/ (trailing slash)", () => assertAllowedObsUrl("ws://127.0.0.1:4455/"), false);
ok("obs ws://127.0.0.1:59650 (user-changed port, still loopback)", () => assertAllowedObsUrl("ws://127.0.0.1:59650"), false);
// 外部/別ホストは拒否（loopback 以外は egress になる）。
ok("obs ws://obs.evil.com:4455 (non-loopback host)", () => assertAllowedObsUrl("ws://obs.evil.com:4455"), true);
ok("obs ws://192.168.0.5:4455 (LAN host, not loopback)", () => assertAllowedObsUrl("ws://192.168.0.5:4455"), true);
ok("obs ws://localhost:4455 (hostname not pinned 127.0.0.1)", () => assertAllowedObsUrl("ws://localhost:4455"), true);
ok("obs ws://[::1]:4455 (IPv6 loopback not pinned)", () => assertAllowedObsUrl("ws://[::1]:4455"), true);
// 認証情報埋め込みバイパス（`@` の前は userinfo・実宛先は evil.com）。必ず拒否。
ok("obs ws://127.0.0.1:4455@evil.com (credential-embedded → host is evil.com)", () => assertAllowedObsUrl("ws://127.0.0.1:4455@evil.com"), true);
// スキーム違い・ポート欠落は拒否。
ok("obs wss://127.0.0.1:4455 (wss not ws)", () => assertAllowedObsUrl("wss://127.0.0.1:4455"), true);
ok("obs http://127.0.0.1:4455 (http not ws)", () => assertAllowedObsUrl("http://127.0.0.1:4455"), true);
ok("obs ws://127.0.0.1 (no port)", () => assertAllowedObsUrl("ws://127.0.0.1"), true);
ok("obs not-a-url", () => assertAllowedObsUrl("not-a-url"), true);
// OBS loopback は既存の外部 WSS allow-list とは分離（混ぜない）: OBS assert は外部 WSS を拒否・WSS assert は ws:// を拒否。
ok("obs wss://eventsub.wss.twitch.tv/ws (external WSS not an OBS target)", () => assertAllowedObsUrl("wss://eventsub.wss.twitch.tv/ws"), true);
ok("ws ws://127.0.0.1:4455 (loopback not allowed on external WSS guard)", () => assertAllowedWsUrl("ws://127.0.0.1:4455"), true);

// global fetch のガード置換: allow-list 外は throw（ネットワークを張る前に弾く）
installHttpHostGuard();
let fetchBlocked = false;
try {
  // 同期的に assert が投げるため await 前に throw する。
  globalThis.fetch("https://evil.com/telemetry");
} catch {
  fetchBlocked = true;
}
if (!fetchBlocked) failures++;
process.stderr.write(`${fetchBlocked ? "PASS" : "FAIL"} installHttpHostGuard blocks evil.com\n`);

process.stderr.write(failures === 0 ? "\nHOST-GUARD PASS\n" : `\nHOST-GUARD FAIL (${failures})\n`);
process.exit(failures === 0 ? 0 : 1);
