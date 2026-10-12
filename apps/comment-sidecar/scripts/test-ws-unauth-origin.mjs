// security-attack 試運転（032c-b の loopback WS・Origin/認証の欠如）の再現テスト。
//
// ⚠⚠⚠ 069でOrigin allow-list（webview由来のみ許可）を入れたので、このテストは
//   「拒否されること」を固定する回帰テストに反転した。ここが緑なら修正が効いている。
//   赤くなったら verifyClient が壊れているか外された合図（PRでブロックすること）。
//
// 仮説: 偽Origin（ユーザーが配信中に開いた悪意あるページを模す）のクライアントは、
//   WebSocketServer の verifyClient で拒否され、制御フレーム（obs-list-sources /
//   obs-fire-source / start-login / obs-disable）は controlHandler に一切届かない。
//
// ⚠ A2（同一PC上の任意プロセス）はOriginヘッダを自由に送れるため、このテストは塞げない
//   （069の残課題。別タスクでnonce/セッション認証を入れる）。
//
// 安全: 本物の OBS / 実サービスには一切繋がない。loopback の WS サーバと ws クライアントだけを使う。
//
// 参照: docs/security-threats.md（T-1）, docs/tasks/069-ws-origin-auth.md
import "reflect-metadata";
import { register } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { WebSocket } from "ws";

register("./dist-alias-loader.mjs", import.meta.url);

const { WebSocketCommentOutputPort } = await import(
  "../dist/vendor/gateway/src/adapters/ws/websocket-comment.output-port.js"
);

let failures = 0;
const check = (label, actual, expected) => {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (!pass) failures += 1;
  console[pass ? "log" : "error"](
    `${pass ? "PASS" : "FAIL"} ${label} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`,
  );
};

// --- Layer 3: 本物のサーバ + 偽 Origin クライアント -------------------------------------------
const server = new WebSocketCommentOutputPort();
const received = [];
server.setControlMessageHandler((raw) => received.push(raw));

// 攻撃者は host を選べない（sidecar は 127.0.0.1 固定）ので loopback で忠実に再現する。
const port = await server.startWithFallback("127.0.0.1", 0);

// ブラウザは WS ハンドシェイクに必ず Origin を付ける。悪意あるページの別オリジンを模す。
const evil = new WebSocket(`ws://127.0.0.1:${port}`, {
  headers: { Origin: "https://evil.example" },
});
let connectError = null;
await new Promise((resolve) => {
  evil.once("open", resolve);
  evil.once("error", (e) => {
    connectError = e;
    resolve();
  });
});

// 修正後: 偽Originの接続はverifyClientで拒否され、errorが立つ。
check("偽Originクライアントの接続が拒否される", connectError !== null, true);

// チケット不要で撃てていたはずのフレーム。接続自体が拒否されるので1件も届かないはず。
const unauthFrames = [
  { type: "obs-list-sources", port: 4455 },
  { type: "obs-fire-source", port: 4455, sourceName: "StreamDock Overlay", durationMs: 3000 },
  { type: "start-login", service: "twitch" },
  { type: "obs-disable" },
];
for (const f of unauthFrames) {
  try {
    evil.send(JSON.stringify(f));
  } catch {
    // 接続が確立していないので send 自体が失敗してよい。
  }
}
await new Promise((r) => setTimeout(r, 150));

check(
  "未認証フレームは1件もcontrolHandlerに届かない（接続自体が拒否されるため）",
  received.length,
  0,
);

evil.close();
await server.stop?.();

// --- 正規Originクライアント: 引き続き接続できることも確認する（回帰防止） -----------------------
const server2 = new WebSocketCommentOutputPort();
const port2 = await server2.startWithFallback("127.0.0.1", 0);

const legit = new WebSocket(`ws://127.0.0.1:${port2}`, {
  headers: { Origin: "tauri://localhost" },
});
let legitConnectError = null;
await new Promise((resolve) => {
  legit.once("open", resolve);
  legit.once("error", (e) => {
    legitConnectError = e;
    resolve();
  });
});
check("正規Origin（tauri://localhost）のクライアントは引き続き接続できる", legitConnectError, null);
legit.close();
await server2.stop?.();

// --- 静的検査: 接続ハンドラに Origin 検証が入っていることを固定する ------------------------------
const here = dirname(fileURLToPath(import.meta.url));
const serverSrc = readFileSync(
  join(here, "..", "vendor/gateway/src/adapters/ws/websocket-comment.output-port.ts"),
  "utf8",
);
// ⚠ コメント文にも「Origin」という語が出るので、コメントを剥いだ「コード実体」だけで判定する。
const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "") // ブロックコメント
    .split("\n")
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, "$1")) // 行コメント（`://` は残す）
    .join("\n");
const bindStart = serverSrc.indexOf("private bind(");
const bindEnd = serverSrc.indexOf("async start(", bindStart);
const bindCode = stripComments(serverSrc.slice(bindStart, bindEnd));
const hasOriginGuard = /verifyClient/.test(bindCode);
check("bind() の接続受理にOrigin検証（verifyClient）がある", hasOriginGuard, true);

console.log(
  failures === 0
    ? "\nFIX CONFIRMED: 偽Origin接続の拒否 + 正規Originの接続維持 + verifyClientの存在 の3点を確認した"
    : `\n${failures} check(s) unexpected — 修正が壊れている可能性がある`,
);
process.exit(failures === 0 ? 0 : 1);
