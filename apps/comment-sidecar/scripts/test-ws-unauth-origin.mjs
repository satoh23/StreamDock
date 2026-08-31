// security-attack 試運転（032c-b の loopback WS・Origin/認証の欠如）の再現テスト。
//
// ⚠⚠⚠ これは「守り」ではなく **攻め（レッドチーム）の特性化テスト**である。
//   いま **PASS するのは穴が空いているから**であって、望ましい状態だからではない。
//   `websocket-comment.output-port.ts` の `bind()` の接続ハンドラに
//   **Origin allow-list（webview 由来以外を拒否）** が入ったら、下の 2 つ目の check は
//   FAIL に反転する。**そのときこのファイルを「拒否されること」を確認する向きへ書き換える**こと
//   （＝修正タスクとセットで更新する。ここが赤くなったら「直った」合図）。
//
// 仮説: sidecar の loopback WS は Origin 検証も認証も無いので、「ユーザーが配信中に開いた
//   悪意あるページ」を模した **偽 Origin** のクライアントが接続でき、チケット不要の制御フレーム
//   （obs-list-sources / obs-fire-source / start-login / obs-disable）が controlHandler に届く。
//
// 安全: 本物の OBS / 実サービスには一切繋がない。loopback の WS サーバと ws クライアントだけを使い、
//   フレームが「controlHandler に届くか」までしか観測しない（発火先の OBS は用意しない）。
//
// 参照: docs/security-threats.md（T-1）, docs/security.md「コメントビューア（配信サービス連携）方針」
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

// 現状（穴あり）: 偽 Origin でも接続が成立する。Origin allow-list が入ると connectError が立つ。
check("偽Originクライアントの接続が拒否されない（＝穴）", connectError === null, true);

// チケット不要で撃てるはずのフレーム。届いた raw 数で受理を確認する。
const unauthFrames = [
  { type: "obs-list-sources", port: 4455 },
  { type: "obs-fire-source", port: 4455, sourceName: "StreamDock Overlay", durationMs: 3000 },
  { type: "start-login", service: "twitch" },
  { type: "obs-disable" },
];
for (const f of unauthFrames) evil.send(JSON.stringify(f));
await new Promise((r) => setTimeout(r, 150));

// controlHandler は raw をそのまま受ける（parse/ticket 照合は index.ts 側＝ここでは transport 層の欠如を示す）。
check(
  "未認証フレームが全て controlHandler に届く（＝transport層に認証が無い）",
  received.length,
  unauthFrames.length,
);

evil.close();
await server.stop?.();

// --- 静的検査: 接続ハンドラに Origin 検証がまだ無いことを固定する ------------------------------
//   （bind() の実装が import できない他テストと同じ作法＝ソース文字列で退行を殺す。
//    Origin allow-list / verifyClient が入ると下の check が FAIL へ反転する。）
const here = dirname(fileURLToPath(import.meta.url));
const serverSrc = readFileSync(
  join(here, "..", "vendor/gateway/src/adapters/ws/websocket-comment.output-port.ts"),
  "utf8",
);
// ⚠ コメント文には「Origin 検証（webview 由来以外を拒否）」という**未実装の防御の説明**が
//   書かれているので、コメントを剥いだ「コード実体」だけで判定する（さもないと説明文に誤反応する）。
const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "") // ブロックコメント
    .split("\n")
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, "$1")) // 行コメント（`://` は残す）
    .join("\n");
const bindStart = serverSrc.indexOf("private bind(");
const bindEnd = serverSrc.indexOf("async start(", bindStart);
const bindCode = stripComments(serverSrc.slice(bindStart, bindEnd));
const hasOriginGuard = /verifyClient/.test(bindCode) || /\borigin\b/i.test(bindCode);
check("bind() の接続受理に Origin 検証がまだ無い（＝穴・修正で反転）", hasOriginGuard, false);

console.log(
  failures === 0
    ? "\nATTACK CONFIRMED: 偽Origin接続 + 未認証フレーム受理 + Origin検証なし の3点を再現した"
    : `\n${failures} check(s) unexpected — 挙動が変わった可能性（修正が入ったなら向きを反転せよ）`,
);
process.exit(failures === 0 ? 0 : 1);
