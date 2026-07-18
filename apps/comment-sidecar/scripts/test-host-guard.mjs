// 032c-b コミット2: allow-list fail-closed ホストガードの単体検証。
// dist（tsc 出力）から guard を import し、許可/拒否を表明する。build:tsc または build:bundle の後に実行。
import {
  __hostGuardInternals,
  installHttpHostGuard,
} from "../dist/src/host-guard.js";

const { assertAllowedHttpUrl, assertAllowedWsUrl } = __hostGuardInternals;

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

// WS: 許可 = wss の eventsub.wss.twitch.tv / *.wss.twitch.tv
ok("ws wss://eventsub.wss.twitch.tv/ws", () => assertAllowedWsUrl("wss://eventsub.wss.twitch.tv/ws"), false);
ok("ws wss://foo.wss.twitch.tv/ws (reconnect wildcard)", () => assertAllowedWsUrl("wss://foo.wss.twitch.tv/ws"), false);
ok("ws wss://evil.com/ws", () => assertAllowedWsUrl("wss://evil.com/ws"), true);
ok("ws ws://eventsub.wss.twitch.tv (not wss)", () => assertAllowedWsUrl("ws://eventsub.wss.twitch.tv/ws"), true);
// 認証情報埋め込みバイパス（WS 版・reconnect_url が細工されても実宛先は evil.com）。必ず拒否。
ok("ws wss://eventsub.wss.twitch.tv@evil.com (credential-embedded → host is evil.com)", () => assertAllowedWsUrl("wss://eventsub.wss.twitch.tv@evil.com/ws"), true);
// 偽ワイルドカード: `.wss.twitch.tv` を含むが suffix ではない（`-wss.twitch.tv`）ため拒否されること。
ok("ws wss://evil-wss.twitch.tv/ws (not a real *.wss.twitch.tv subdomain)", () => assertAllowedWsUrl("wss://evil-wss.twitch.tv/ws"), true);

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
