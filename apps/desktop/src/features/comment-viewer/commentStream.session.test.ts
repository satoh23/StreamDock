import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * 062b: **WS 接続直後に sidecar が送る「嘘の待機（session.state = idle）」を捨てる**仕様のテスト。
 *
 * ## なぜ必要か（実コードで確認した経路）
 *
 * sidecar の `websocket-comment.output-port.ts` は `server.on("connection")` で新規クライアントへ
 * **必ず・同期で・最初に** `sendSessionSnapshots` を送る。ところがそのスナップショットを更新するのは
 * `publishSessionState` だけで、stream-dock の制御経路（sidecar の `index.ts` の `sendSessionState`）は
 * `broadcastMessage` を直接使う＝**スナップショットは永久に初期値（idle）のまま**。
 * さらに sidecar は**状態が変化したときしか送らない**ので、そのあと `connected` は届かない。
 *
 * ⇒ 062b が接続状態から配信セッションの終了を判定すると、
 *   ①ステージ窓を開いたままコメビュ窓を開き直す（sidecar は生きていてコメントは流れ続ける）
 *   ②WS が一瞬切れて 1 秒後に自動再接続する（`RETRY_INTERVAL_MS`）
 * のどちらでも**配信中なのにセッションが終了させられる**。
 *
 * あるべき挙動: **接続 1 本につき platform ごとの最初の 1 通が `idle` なら捨てる**
 * （スナップショットは常に接続直後の最初の 1 通・常に idle という構造上の規則）。`idle` 以外は通す。
 *
 * get_comment_stream_port（invoke）と WebSocket はモックする＝端末外通信も OS 操作もしない（§1）。
 */
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import { connectCommentStream } from "./commentStream";

const mockInvoke = vi.mocked(invoke);

/** commentStream が使う最小の WebSocket モック（受信をコールバックで駆動する）。 */
class MockWebSocket {
  static OPEN = 1;
  static instances: MockWebSocket[] = [];
  readyState = MockWebSocket.OPEN;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {}
}

const flush = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

let originalWs: unknown;

beforeEach(() => {
  mockInvoke.mockReset();
  MockWebSocket.instances = [];
  originalWs = (globalThis as { WebSocket?: unknown }).WebSocket;
  (globalThis as { WebSocket?: unknown }).WebSocket =
    MockWebSocket as unknown as typeof WebSocket;
});

afterEach(() => {
  (globalThis as { WebSocket?: unknown }).WebSocket = originalWs;
});

async function connectAndOpen() {
  mockInvoke.mockResolvedValue(17331);
  const onSessionState = vi.fn();
  const handle = connectCommentStream({
    onComments: vi.fn(),
    onSessionState,
  });
  await flush();
  const socket = MockWebSocket.instances[0];
  socket.onopen?.();
  return { handle, socket, onSessionState };
}

/** sidecar の session.state フレームを 1 通流す。 */
function emitSessionState(
  socket: MockWebSocket,
  platform: string,
  state: string,
) {
  socket.onmessage?.({
    data: JSON.stringify({
      type: "session.state",
      payload: { platform, state },
    }),
  });
}

/** 接続直後に sidecar が送るスナップショット 2 通（実装と同じ順序・同じ内容）。 */
function emitSnapshots(socket: MockWebSocket) {
  emitSessionState(socket, "youtube", "idle");
  emitSessionState(socket, "twitch", "idle");
}

describe("062b 接続直後のスナップショット（嘘の idle）を捨てる", () => {
  it("接続直後の idle は platform ごとに 1 通だけ捨てる", async () => {
    const { handle, socket, onSessionState } = await connectAndOpen();
    emitSnapshots(socket);
    expect(onSessionState).not.toHaveBeenCalled();
    handle.disconnect();
  });

  it("2 通目以降の idle は通す（本物の切断を握り潰さない）", async () => {
    const { handle, socket, onSessionState } = await connectAndOpen();
    emitSnapshots(socket);
    emitSessionState(socket, "twitch", "idle");
    expect(onSessionState).toHaveBeenCalledTimes(1);
    expect(onSessionState).toHaveBeenCalledWith("twitch", "idle", undefined);
    handle.disconnect();
  });

  it("idle 以外は 1 通目でも通す（将来 sidecar がスナップショットを正確にしたときに捨てない）", async () => {
    const { handle, socket, onSessionState } = await connectAndOpen();
    emitSessionState(socket, "twitch", "connected");
    expect(onSessionState).toHaveBeenCalledWith("twitch", "connected", undefined);
    handle.disconnect();
  });

  it("片方のスナップショットを捨てても、もう片方の枠は残る（platform ごとに独立）", async () => {
    const { handle, socket, onSessionState } = await connectAndOpen();
    emitSessionState(socket, "twitch", "idle"); // 捨てられる
    emitSessionState(socket, "youtube", "idle"); // これも捨てられる（別 platform の 1 通目）
    expect(onSessionState).not.toHaveBeenCalled();
    emitSessionState(socket, "youtube", "idle"); // 2 通目は通る
    expect(onSessionState).toHaveBeenCalledTimes(1);
    handle.disconnect();
  });

  // ⚠⚠ ここが本丸: **再接続のたびに枠が作り直される**（＝再接続でも嘘の idle を捨てる）。
  //   これが無いと「WS が一瞬切れただけで配信セッションが終了へ向かう」が実機で起きる。
  it("再接続後のスナップショットも捨てる", async () => {
    const { handle, socket, onSessionState } = await connectAndOpen();
    emitSnapshots(socket);
    // 本物の connected（配信中）。
    emitSessionState(socket, "twitch", "connected");
    expect(onSessionState).toHaveBeenLastCalledWith("twitch", "connected", undefined);

    // WS が切れて自動再接続（RETRY_INTERVAL_MS）。
    socket.onclose?.();
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const reconnected = MockWebSocket.instances[1];
    expect(reconnected).toBeDefined();
    reconnected.onopen?.();
    onSessionState.mockClear();

    emitSnapshots(reconnected);
    expect(onSessionState).not.toHaveBeenCalled();
    handle.disconnect();
  });
});
