// 032c-b(stream-dock): sidecar バンドル/バイナリのオフライン疎通スモークテスト。
//  - 子プロセスを起動し stdout の COMMENT_SIDECAR_PORT=<port> を読む（スパイク6）。
//  - その実ポートへ ws で接続し comments.append（ダミー）を受信できることを確認（スパイク1/8・トランスポート）。
//  - DI 解決（decorator metadata）が失敗すると子は exit 1 する → ここで検知する（スパイク1）。
// 使い方: node scripts/smoke.mjs [起動コマンド...]   既定は `node build/sidecar.cjs`
import { spawn } from "node:child_process";
import { WebSocketServer, WebSocket } from "ws";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const cmd = argv.length > 0 ? argv[0] : "node";
const args = argv.length > 0 ? argv.slice(1) : [join(pkgDir, "build/sidecar.cjs")];
const TIMEOUT_MS = 10000;

// WebSocketServer は import 検証（bufferutil/utf-8-validate external でも ws が動くこと）にも使う。
void WebSocketServer;

const child = spawn(cmd, args, { cwd: pkgDir, stdio: ["pipe", "pipe", "pipe"] });

let done = false;
let ws = null;
const finish = (code, msg) => {
  if (done) return;
  done = true;
  process.stderr.write(`${msg}\n`);
  if (ws) try { ws.terminate(); } catch {}
  try { child.kill("SIGTERM"); } catch {}
  setTimeout(() => process.exit(code), 200);
};

const timer = setTimeout(() => finish(1, "SMOKE FAIL: timeout"), TIMEOUT_MS);

let buf = "";
child.stdout.on("data", (d) => {
  buf += d.toString("utf8");
  const m = buf.match(/COMMENT_SIDECAR_PORT=(\d+)/);
  if (m && !ws) {
    const port = Number(m[1]);
    process.stderr.write(`SMOKE: got port ${port}, connecting...\n`);
    ws = new WebSocket(`ws://127.0.0.1:${port}`);
    // コミット2 はオフラインではダミーを送らない。boot（DI 解決）＋ポート受け渡し＋WS 接続確立で PASS とする。
    ws.on("open", () => {
      clearTimeout(timer);
      process.stderr.write("SMOKE PASS: ws connected to sidecar\n");
      finish(0, "SMOKE OK");
    });
    ws.on("error", (e) => finish(1, `SMOKE FAIL: ws error ${String(e)}`));
  }
});
child.stderr.on("data", (d) => process.stderr.write(d));
child.on("exit", (code) => {
  if (!done) finish(code === 0 ? 1 : 1, `SMOKE FAIL: child exited early code=${code}`);
});
