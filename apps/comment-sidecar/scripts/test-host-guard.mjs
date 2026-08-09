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
  assertAllowedThemeImportUrl,
  assertAllowedThemeFontUrl,
  isInternalAddress,
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

// 060c: テーマ取り込みの外部 `@import` 取得ガード（allow-list とは**分離**した専用関数）。
// ⚠⚠ 宛先を allow-list で固定できない代わりに「取得できる形を極端に狭める」ので、
// ここが緩むと SSRF がそのまま通る。**本タスク最大の穴**なのでケースを厚くする。
const themeOk = (label, url, shouldThrow) =>
  ok(`theme ${label}`, () => assertAllowedThemeImportUrl(url), shouldThrow);

// 正常系（依頼者の実サンプルが指す形）。
themeOk("https://example.com/a.css", "https://example.com/a.css", false);
themeOk(
  "https://ruri.info/tool/css/fukidashiComment.css (real sample shape)",
  "https://ruri.info/tool/css/fukidashiComment.css",
  false,
);
themeOk("uppercase path .CSS", "https://example.com/A.CSS", false);
themeOk("explicit :443 is normalized away", "https://example.com:443/a.css", false);

// スキーム: https のみ。
themeOk("http (MITM can rewrite CSS)", "http://example.com/a.css", true);
themeOk("file:", "file:///etc/passwd.css", true);
themeOk("data:", "data:text/css,body{}", true);
themeOk("javascript:", "javascript:alert(1)//a.css", true);
themeOk("not-a-url", "a.css", true);

// userinfo: 実宛先は `@` の後ろ。同意ダイアログの表示偽装とセットで効く。
themeOk(
  "userinfo (real host is evil.example)",
  "https://trusted.example@evil.example/a.css",
  true,
);

// ⚠⚠ SSRF: loopback / プライベート / link-local / メタデータ / IP リテラル。
themeOk("loopback 127.0.0.1", "https://127.0.0.1/a.css", true);
themeOk("loopback localhost", "https://localhost/a.css", true);
themeOk("loopback [::1]", "https://[::1]/a.css", true);
themeOk("private 10.x", "https://10.0.0.1/a.css", true);
themeOk("private 192.168.x", "https://192.168.1.1/a.css", true);
themeOk("private 172.16.x", "https://172.16.0.1/a.css", true);
themeOk("private 172.31.x", "https://172.31.255.255/a.css", true);
themeOk("metadata 169.254.169.254", "https://169.254.169.254/a.css", true);
themeOk("metadata by name", "https://metadata.google.internal/a.css", true);
themeOk("public-looking IP literal 93.184.216.34", "https://93.184.216.34/a.css", true);
// ⚠ WHATWG URL は special scheme で 10 進/16 進の IPv4 を dotted-quad へ正規化する。
themeOk("decimal IPv4 2130706433 (= 127.0.0.1)", "https://2130706433/a.css", true);
themeOk("hex IPv4 0x7f.0.0.1 (= 127.0.0.1)", "https://0x7f.0.0.1/a.css", true);
themeOk("short IPv4 127.1 (= 127.0.0.1)", "https://127.1/a.css", true);

// 内部用サフィックス・単一ラベル・末尾ドット。
themeOk("mDNS .local", "https://printer.local/a.css", true);
themeOk(
  "trailing dot must not evade the .local suffix check",
  "https://printer.local./a.css",
  true,
);
// ⚠⚠ **ドット 2 個以上でサフィックス判定を逃れる形**（security-review 060c S-1・実測で素通りしていた）。
// 「末尾ドットを 1 個だけ剥がす」実装はここで落ちる。⚠ 空ラベルはリゾルバ依存で解決されうるので、
// DNS 事前検査に判定を預けず**形の段階で**落とす。
themeOk("double trailing dot must not evade .local", "https://printer.local../a.css", true);
themeOk("triple trailing dot must not evade .local", "https://printer.local.../a.css", true);
themeOk("double trailing dot must not evade localhost", "https://localhost../a.css", true);
themeOk(
  "double trailing dot must not evade the metadata host",
  "https://metadata.google.internal../a.css",
  true,
);
themeOk("empty label in the middle", "https://ruri..info/a.css", true);
themeOk("leading empty label", "https://.ruri.info/a.css", true);
// ⚠ 正当な FQDN 表記（末尾ドット 1 個）は**通ること**（過剰拒否にしない）。
themeOk("a single trailing dot on a public host is still allowed", "https://ruri.info./a.css", false);
themeOk("single label (resolved by search domain)", "https://intranet/a.css", true);
themeOk(".internal", "https://wiki.internal/a.css", true);
themeOk(".localhost subdomain", "https://api.localhost/a.css", true);
themeOk(".home.arpa", "https://nas.home.arpa/a.css", true);

// ポート・クエリ・フラグメント・拡張子で形を狭める。
themeOk("non-443 port", "https://example.com:8443/a.css", true);
themeOk("port 80", "https://example.com:80/a.css", true);
// ⚠⚠ **060h でクエリを解禁した**（`https://fonts.googleapis.com/css2?family=…` が 2 段目の必須形）。
//   緩めてよい根拠＝クエリで運べる情報は**パスで既に運べる**（`https://tracker.example/<id>.css` は
//   060c の時点で通る）ので脅威モデルが変わらない。形を狭める担保は `https:` / 443 / 拡張子 /
//   IP リテラル拒否 / 内部サフィックス拒否 / DNS 事前検査 / リダイレクト禁止 / 毎回の同意 / チケットが持つ。
themeOk("query string (relaxed by 060h)", "https://example.com/a.css?v=1", false);
// ⚠⚠ **`.css` 終端だけでは 2 段目に到達できない**（実測）。Google Fonts v2 の `pathname` は
//   **`/css2`**（v1 は `/css`）で拡張子を持たない。→ 「最後のパス片が `css` ＋ 数字 0 個以上」も許す。
//   ⚠ これは**ホストを名指ししない「形」の規則**である（allow-list にホストは 1 つも足していない）。
themeOk(
  "the real Google Fonts v2 shape (/css2?family=)",
  "https://fonts.googleapis.com/css2?family=M+PLUS+1p:wght@400&display=swap",
  false,
);
themeOk("the Google Fonts v1 shape (/css?family=)", "https://fonts.googleapis.com/css?family=X", false);
// ⚠ その形も**最後のパス片が丸ごと `css<数字>` のときだけ**（部分一致では通さない）。
themeOk("a path segment merely containing css", "https://example.com/cssomething", true);
themeOk("css as a directory, not the last segment", "https://example.com/css/x", true);
themeOk("cssx is not css<digits>", "https://example.com/css2x", true);
// ⚠ パスの形は `pathname` で見る（クエリの中の `.css` では通さない）。
themeOk("extension must be in the path, not the query", "https://example.com/a.php?x=.css", true);
// ⚠ **フラグメントの禁止は残す**（サーバへ送られない部分＝取得の形を広げる意味が無い）。
themeOk("fragment", "https://example.com/a.css#x", true);
themeOk("query and fragment together", "https://example.com/a.css?v=1#x", true);
themeOk("not .css", "https://example.com/a.txt", true);
themeOk("no extension", "https://example.com/a", true);
themeOk("percent-encoded dot does not count as .css", "https://example.com/a%2Ecss", true);
themeOk("directory ending in .css/", "https://example.com/a.css/", true);

// --- 060h: フォント実体のガード（`assertAllowedThemeFontUrl`）------------------------------------
//
// ⚠⚠ **CSS 用と同一の条件で、違うのは拡張子だけ**（判定本体は 1 実装を共有している）。
// だからここでは「①拡張子の入れ替わりが効いていること ②SSRF 系の条件が**フォント側でも**
// 全部効いていること」の 2 点を厚く固定する（②が抜けると「新しい口だけ SSRF が通る」形になる）。
const fontOk = (label, url, shouldThrow) =>
  ok(`font ${label}`, () => assertAllowedThemeFontUrl(url), shouldThrow);

// 正常系（実サンプルが踏む 3 段目の形）。
fontOk("https://fonts.gstatic.com/s/x/y.woff2", "https://fonts.gstatic.com/s/x/y.woff2", false);
fontOk(".woff fallback", "https://fonts.gstatic.com/s/x/y.woff", false);
fontOk("uppercase .WOFF2", "https://fonts.gstatic.com/s/x/Y.WOFF2", false);
fontOk("query is allowed (same rule as CSS)", "https://f.example/a.woff2?v=2", false);

// ⚠⚠ **拡張子で口を分けている**（CSS の口でフォントは取れず、フォントの口で CSS は取れない）。
fontOk(".css is not a font", "https://example.com/a.css", true);
themeOk(".woff2 is not a stylesheet", "https://fonts.gstatic.com/s/x/y.woff2", true);
fontOk(".ttf is not allowed (only what is actually needed)", "https://f.example/a.ttf", true);
fontOk(".otf is not allowed", "https://f.example/a.otf", true);
fontOk("no extension", "https://f.example/a", true);
// ⚠ CSS 側の「拡張子無しでも通る形」（`/css2`）は**フォント側では通さない**（必要が無い＝広げない）。
// ⚠⚠ **060h security-review S-2 で URL を直した。** 初版は `https://f.example/woff2` を試しており、
//   最終パス片が `woff2` なので **`css<digits>` の形を 1 度も試していなかった**——`isFontPath` に
//   CSS 側の `/^css[0-9]*$/` をコピーする変異が**生存した**（実測）。実際に `/css` `/css2` を試すこと。
fontOk("the css<digits> shape is not a font path", "https://f.example/css2", true);
fontOk("the css (v1) shape is not a font path", "https://f.example/css", true);
fontOk("the real Google Fonts CSS url is not a font path", "https://fonts.googleapis.com/css2?family=X", true);
fontOk("a bare woff2 segment is not a font path either", "https://f.example/woff2", true);
fontOk("percent-encoded dot", "https://f.example/a%2Ewoff2", true);
fontOk("extension in the query only", "https://f.example/a.php?x=.woff2", true);

// ⚠⚠ SSRF 系は**フォント側でも全部効くこと**（ここが抜けると新しい口だけ穴になる）。
fontOk("http", "http://f.example/a.woff2", true);
fontOk("userinfo", "https://trusted.example@evil.example/a.woff2", true);
fontOk("loopback 127.0.0.1", "https://127.0.0.1/a.woff2", true);
fontOk("loopback localhost", "https://localhost/a.woff2", true);
fontOk("loopback [::1]", "https://[::1]/a.woff2", true);
fontOk("private 10.x", "https://10.0.0.1/a.woff2", true);
fontOk("private 192.168.x", "https://192.168.1.1/a.woff2", true);
fontOk("metadata 169.254.169.254", "https://169.254.169.254/a.woff2", true);
fontOk("metadata by name", "https://metadata.google.internal/a.woff2", true);
fontOk("decimal IPv4 2130706433", "https://2130706433/a.woff2", true);
fontOk("mDNS .local", "https://printer.local/a.woff2", true);
fontOk("double trailing dot must not evade .local", "https://printer.local../a.woff2", true);
fontOk("empty label in the middle", "https://a..b/a.woff2", true);
fontOk("single label", "https://intranet/a.woff2", true);
fontOk("non-443 port", "https://f.example:8443/a.woff2", true);
fontOk("fragment", "https://f.example/a.woff2#x", true);
fontOk("not-a-url", "a.woff2", true);
// ⚠ フォントガードも OBS ガードとは逆向きであること。
fontOk("obs loopback target", "ws://127.0.0.1:4455", true);

// ⚠⚠ **既存 allow-list と混ざっていないこと**（`assertAllowedObsUrl` とは逆向きのガードである）。
ok(
  "theme guard rejects the OBS loopback target (opposite direction of assertAllowedObsUrl)",
  () => assertAllowedThemeImportUrl("ws://127.0.0.1:4455"),
  true,
);
ok(
  "OBS guard rejects a theme import URL (the two are not interchangeable)",
  () => assertAllowedObsUrl("https://example.com/a.css"),
  true,
);
// テーマ取得先を既存 allow-list に足していないこと（足すと Twitch/YouTube 宛先と同じ表で管理され始める）。
ok(
  "the shared allow-list still rejects a theme import host",
  () => assertAllowedHttpUrl("https://example.com/a.css"),
  true,
);

// 060c: 解決済みアドレスの判定（DNS 事前検査が使う表）。
const addrOk = (label, address, family, expected) => {
  const actual = isInternalAddress(address, family);
  const pass = actual === expected;
  if (!pass) failures++;
  process.stderr.write(
    `${pass ? "PASS" : "FAIL"} addr ${label} (expected ${expected ? "internal" : "public"})\n`,
  );
};
addrOk("127.0.0.1", "127.0.0.1", 4, true);
addrOk("10.1.2.3", "10.1.2.3", 4, true);
addrOk("172.20.0.1", "172.20.0.1", 4, true);
addrOk("172.15.0.1 (just outside the private range)", "172.15.0.1", 4, false);
addrOk("172.32.0.1 (just outside the private range)", "172.32.0.1", 4, false);
addrOk("192.168.0.1", "192.168.0.1", 4, true);
addrOk("169.254.169.254", "169.254.169.254", 4, true);
addrOk("100.64.0.1 (CGNAT)", "100.64.0.1", 4, true);
addrOk("0.0.0.0", "0.0.0.0", 4, true);
addrOk("93.184.216.34 (public)", "93.184.216.34", 4, false);
addrOk("8.8.8.8 (public)", "8.8.8.8", 4, false);
addrOk("::1", "::1", 6, true);
addrOk("fd00::1 (ULA)", "fd00::1", 6, true);
addrOk("fe80::1 (link-local)", "fe80::1", 6, true);
addrOk("::ffff:127.0.0.1 (IPv4-mapped loopback)", "::ffff:127.0.0.1", 6, true);
addrOk("2606:2800:220:1:248:1893:25c8:1946 (public)", "2606:2800:220:1:248:1893:25c8:1946", 6, false);
// ⚠⚠ **表記の揺れで素通りしていた分**（security-review 060c S-2・実測で public 判定になっていた）。
// 先頭グループを文字列の前方一致で取る実装はここで落ちる（`::` の空文字が "0" に化けるため）。
addrOk("::ffff:7f00:1 (same as ::ffff:127.0.0.1 in hex)", "::ffff:7f00:1", 6, true);
addrOk("0:0:0:0:0:ffff:127.0.0.1 (uncompressed IPv4-mapped)", "0:0:0:0:0:ffff:127.0.0.1", 6, true);
addrOk("::127.0.0.1 (IPv4-compatible, deprecated)", "::127.0.0.1", 6, true);
addrOk("::ffff:10.0.0.1 (IPv4-mapped private)", "::ffff:10.0.0.1", 6, true);
addrOk("2002:7f00:1::1 (6to4 wrapping 127.0.0.1)", "2002:7f00:1::1", 6, true);
addrOk("64:ff9b::7f00:1 (NAT64 wrapping 127.0.0.1)", "64:ff9b::7f00:1", 6, true);
addrOk("2002:5db8:1::1 (6to4 wrapping a public v4)", "2002:5db8:1::1", 6, false);
addrOk("fe80::1%eth0 (zone id is stripped)", "fe80::1%eth0", 6, true);
// ⚠ **解釈できない形は拒否側へ倒す**（`isInternalIpv4` と向きを揃えた）。
addrOk("garbage is refused (fail-closed)", "not-an-address", 6, true);
addrOk("too many groups is refused (fail-closed)", "1:2:3:4:5:6:7:8:9", 6, true);
addrOk("two :: is refused (fail-closed)", "1::2::3", 6, true);
// ⚠ family の申告が 4 でも `:` を含むなら IPv6 として判定する（IPv4 判定へ流さない保険）。
addrOk("v6 text declared as family 4 is still判定される", "::1", 4, true);

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
