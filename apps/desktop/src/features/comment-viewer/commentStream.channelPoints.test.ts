import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * 063e 段 1-b: sidecar → viewer の `channelpoints.state`（**チャンネルポイント購読の成否**）の受け口テスト。
 *
 * ## なぜ必要か
 *
 * ⚠⚠⚠ **この 1 本のフレームが「黙って効かない」を潰す唯一の経路である**（061a Q-1）。
 * チャンネルポイントの購読は**非致命**（403 でもコメント取得は続く）なので、届かない人には
 * **エラーすら出ない**。しかも届かない理由の 1 つ（Twitch 側で未有効化）は
 * **新規配信者の既定状態**である＝StreamDock の想定ユーザーの多くがそこに居る。
 * ⇒ 受け口が黙って壊れると、症状は「設定画面がずっと『まだ分かりません』のまま」＝
 *   **本来の待ち状態と見分けが付かない**。テストで固定しないと気付けない種類の欠落である。
 *
 * ## 何を担保するか
 *   A. 3 語（`unknown` / `receiving` / `unavailable`）が**そのまま**ハンドラへ渡る
 *      （viewer 側で語を解釈しない＝表示の持ち主は `SettingsView` 1 か所）。
 *   B. **型が違うものは渡さない**（`obs.state` の `typeof p?.state === "string"` と同じ作法）。
 *   C. **他のフレームを巻き込まない**（`comments.append` / `session.state` は従来どおり）。
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
  const onChannelPointsState = vi.fn();
  const onComments = vi.fn();
  const onSessionState = vi.fn();
  const handle = connectCommentStream({
    onComments,
    onSessionState,
    onChannelPointsState,
  });
  await flush();
  const socket = MockWebSocket.instances[0];
  socket.onopen?.();
  return { handle, socket, onChannelPointsState, onComments, onSessionState };
}

describe("commentStream 063e 段 1-b: channelpoints.state", () => {
  for (const state of ["unknown", "receiving", "unavailable"] as const) {
    it(`⚠ ${state} をそのままハンドラへ渡す（viewer 側で語を解釈しない）`, async () => {
      const { socket, onChannelPointsState, handle } = await connectAndOpen();
      socket.onmessage?.({
        data: JSON.stringify({
          type: "channelpoints.state",
          payload: { state },
        }),
      });
      expect(onChannelPointsState).toHaveBeenCalledWith(state);
      handle.disconnect();
    });
  }

  it("⚠⚠ sidecar が語を増やしても素通しする（表示側が倒し先を決める）", async () => {
    // ⚠ ここで未知語を捨てると、**将来の語が viewer に届かない**まま気付けなくなる。
    //   倒し先の判断は `SettingsView`（「断言しない側へ倒す」）に閉じている。
    const { socket, onChannelPointsState, handle } = await connectAndOpen();
    socket.onmessage?.({
      data: JSON.stringify({
        type: "channelpoints.state",
        payload: { state: "future-word" },
      }),
    });
    expect(onChannelPointsState).toHaveBeenCalledWith("future-word");
    handle.disconnect();
  });

  it("⚠ state が文字列でなければ渡さない（WS 境界で型は保証されない）", async () => {
    const { socket, onChannelPointsState, handle } = await connectAndOpen();
    for (const payload of [
      { state: 1 },
      { state: null },
      { state: { v: "receiving" } },
      {},
      undefined,
    ]) {
      socket.onmessage?.({
        data: JSON.stringify({ type: "channelpoints.state", payload }),
      });
    }
    expect(onChannelPointsState).not.toHaveBeenCalled();
    handle.disconnect();
  });

  it("⚠ 他のフレームでは呼ばれない（種別の取り違えをしない）", async () => {
    const { socket, onChannelPointsState, onSessionState, handle } =
      await connectAndOpen();
    socket.onmessage?.({
      data: JSON.stringify({
        type: "session.state",
        payload: { platform: "twitch", state: "connected" },
      }),
    });
    socket.onmessage?.({
      data: JSON.stringify({
        type: "obs.state",
        payload: { state: "added" },
      }),
    });
    expect(onChannelPointsState).not.toHaveBeenCalled();
    // ⚠ 逆向きも確かめる（新しい分岐が既存の session.state を食っていないこと）。
    expect(onSessionState).toHaveBeenCalledWith(
      "twitch",
      "connected",
      undefined,
    );
    handle.disconnect();
  });

  it("⚠ コメントの配送を巻き込まない", async () => {
    const { socket, onComments, handle } = await connectAndOpen();
    socket.onmessage?.({
      data: JSON.stringify({
        type: "channelpoints.state",
        payload: { state: "unavailable" },
      }),
    });
    socket.onmessage?.({
      data: JSON.stringify({
        type: "comments.append",
        payload: { comment: { id: "c1", text: "hi" } },
      }),
    });
    expect(onComments).toHaveBeenCalledTimes(1);
    handle.disconnect();
  });

  it("⚠ ハンドラ未指定でも落ちない（受け口は任意）", async () => {
    mockInvoke.mockResolvedValue(17331);
    const handle = connectCommentStream({ onComments: vi.fn() });
    await flush();
    const socket = MockWebSocket.instances[0];
    socket.onopen?.();
    expect(() =>
      socket.onmessage?.({
        data: JSON.stringify({
          type: "channelpoints.state",
          payload: { state: "receiving" },
        }),
      }),
    ).not.toThrow();
    handle.disconnect();
  });
});
