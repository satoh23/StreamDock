import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * 044a: コメントストリーム WS の OBS 制御フレーム／状態受信の仕様テスト。
 * あるべき挙動（docs/tasks/044a / docs/security.md §9）:
 * - enableObs(port) は制御フレーム {type:"obs-enable", port} を送る（**port のみ・パスワードを載せない**）。
 * - disableObs() は {type:"obs-disable"} を送る。
 * - obs.state 受信で onObsState(state, reason) を通知する（reason は任意）。
 * - **どの送信フレームにもパスワードが載らない**（§9 の不変条件）。
 *
 * 064a/064c で追加（鳴らせる OBS ソースの一覧）:
 * - listObsSources(port) は {type:"obs-list-sources", port} を送る。
 * - ⚠⚠ **obs.sources は `ok`（OBS へ繋がったか）と `sources` を運ぶ**。
 *   `ok` を落とすと「OBS が落ちている」が「ソースが 0 件」に化け、main 窓が
 *   **OBS 未起動のユーザーへ「OBS のシーンにソースを追加してください」と誤案内する**
 *   （064a の壊れ方＝061a レビュー Q-1 と同じ失敗モードの 3 度目）。
 * - ⚠ WS 境界では型が失われるので、**形が違う値はすべて安全側へ倒す**
 *   （`ok` が boolean でなければ `false` ＝「取れたと断言しない」）。
 * get_comment_stream_port（invoke）と WebSocket はモックする＝端末外通信も OS 操作もしない（§1）。
 */
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import { connectCommentStream } from "./commentStream";

const mockInvoke = vi.mocked(invoke);

/** commentStream が使う最小の WebSocket モック（送信フレームを捕捉し、受信をコールバックで駆動する）。 */
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

/** connect() 内の await（get_comment_stream_port）を流し切って socket 生成まで進める。 */
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
  mockInvoke.mockResolvedValue(17331); // get_comment_stream_port
  const onObsState = vi.fn();
  // 064a/064c: 鳴らせる OBS ソースの一覧（⚠ 064c で第 2 引数 `ok` が増えた）。
  const onObsSources = vi.fn();
  const handle = connectCommentStream({
    onComments: vi.fn(),
    onObsState,
    onObsSources,
  });
  await flush();
  const socket = MockWebSocket.instances[0];
  socket.onopen?.();
  return { handle, socket, onObsState, onObsSources };
}

describe("commentStream OBS 制御フレーム", () => {
  it("enableObs は {type:'obs-enable', port} のみを送る（パスワードを載せない・§9）", async () => {
    const { handle, socket } = await connectAndOpen();
    handle.enableObs(4455, "comments");
    expect(socket.sent).toContain(
      JSON.stringify({ type: "obs-enable", port: 4455, overlay: "comments" }),
    );
    // 送信フレームにパスワードらしき語が一切現れない（§9）。
    expect(socket.sent.join("\n").toLowerCase()).not.toContain("password");
    handle.disconnect();
  });

  it("disableObs は {type:'obs-disable'} を送る", async () => {
    const { handle, socket } = await connectAndOpen();
    handle.disableObs();
    expect(socket.sent).toContain(JSON.stringify({ type: "obs-disable" }));
    handle.disconnect();
  });

  it("hideObs は {type:'obs-hide', port} のみを送る（表示OFF連動・パスワードを載せない・§9）", async () => {
    const { handle, socket } = await connectAndOpen();
    handle.hideObs(4455, "comments");
    expect(socket.sent).toContain(
      JSON.stringify({ type: "obs-hide", port: 4455, overlay: "comments" }),
    );
    expect(socket.sent.join("\n").toLowerCase()).not.toContain("password");
    handle.disconnect();
  });

  it("046d: overlay 種別がフレームに載る（固定コメント側は 'pinned'）", async () => {
    const { handle, socket } = await connectAndOpen();
    handle.enableObs(4455, "pinned");
    handle.hideObs(4455, "pinned");
    expect(socket.sent).toContain(
      JSON.stringify({ type: "obs-enable", port: 4455, overlay: "pinned" }),
    );
    expect(socket.sent).toContain(
      JSON.stringify({ type: "obs-hide", port: 4455, overlay: "pinned" }),
    );
    // 送るのは識別子だけ＝OBS のソース名・窓名は sidecar 内の表に閉じており、viewer からは渡さない（§3/§8）。
    expect(socket.sent.join("\n")).not.toContain("StreamDock");
    handle.disconnect();
  });

  it("obs.state 受信で onObsState(state, reason) を通知する", async () => {
    const { handle, socket, onObsState } = await connectAndOpen();
    socket.onmessage?.({
      data: JSON.stringify({ type: "obs.state", payload: { state: "added" } }),
    });
    expect(onObsState).toHaveBeenCalledWith("added", undefined);
    socket.onmessage?.({
      data: JSON.stringify({
        type: "obs.state",
        payload: { state: "failed", reason: "OBS に接続できませんでした" },
      }),
    });
    expect(onObsState).toHaveBeenCalledWith(
      "failed",
      "OBS に接続できませんでした",
    );
    handle.disconnect();
  });

  it("state が非文字列の obs.state は無視する（壊れた通知でも落ちない）", async () => {
    const { handle, socket, onObsState } = await connectAndOpen();
    socket.onmessage?.({
      data: JSON.stringify({ type: "obs.state", payload: { state: 123 } }),
    });
    expect(onObsState).not.toHaveBeenCalled();
    handle.disconnect();
  });

  // --- 064a/064c: 鳴らせる OBS ソースの一覧 ------------------------------------------------------

  it("064a: listObsSources は {type:'obs-list-sources', port} のみを送る（§9）", async () => {
    const { handle, socket } = await connectAndOpen();
    handle.listObsSources(4455);
    expect(socket.sent).toContain(
      JSON.stringify({ type: "obs-list-sources", port: 4455 }),
    );
    expect(socket.sent.join("\n").toLowerCase()).not.toContain("password");
    handle.disconnect();
  });

  it("064c: obs.sources 受信で一覧と ok を通知する", async () => {
    const { handle, socket, onObsSources } = await connectAndOpen();
    socket.onmessage?.({
      data: JSON.stringify({
        type: "obs.sources",
        payload: {
          ok: true,
          sources: [{ name: "花火", kind: "ffmpeg_source" }],
        },
      }),
    });
    expect(onObsSources).toHaveBeenCalledWith(
      [{ name: "花火", kind: "ffmpeg_source" }],
      true,
    );
    handle.disconnect();
  });

  it("⚠⚠ 064c: 繋がらなかった通知（ok:false）は 0 件と区別して届く", async () => {
    // ⚠⚠ **これを潰すと「OBS が落ちている」が「ソースが 0 件」に化ける**——
    //   main 窓が OBS 未起動のユーザーへ「OBS のシーンにソースを追加してください」と
    //   誤案内していた 064a の壊れ方そのものである（061a レビュー Q-1 と同型）。
    const { handle, socket, onObsSources } = await connectAndOpen();
    socket.onmessage?.({
      data: JSON.stringify({
        type: "obs.sources",
        payload: { ok: false, sources: [] },
      }),
    });
    expect(onObsSources).toHaveBeenCalledWith([], false);
    handle.disconnect();
  });

  it("⚠⚠ 064c: ok が無い／boolean でない obs.sources は false へ倒す（取れたと断言しない）", async () => {
    // ⚠⚠ **倒し先を間違えないこと。** `true` へ倒すと上の誤案内が復活する。
    //   `false` 側の誤りは「OBS を確認してください」で済み、ユーザーの行動が無害である。
    const { handle, socket, onObsSources } = await connectAndOpen();
    for (const payload of [
      { sources: [] },
      { ok: "true", sources: [] },
      { ok: 1, sources: [] },
      { ok: null, sources: [] },
    ]) {
      socket.onmessage?.({
        data: JSON.stringify({ type: "obs.sources", payload }),
      });
    }
    expect(onObsSources).toHaveBeenCalledTimes(4);
    for (const call of onObsSources.mock.calls) {
      expect(call[1]).toBe(false);
    }
    handle.disconnect();
  });

  it("064a: 形の違う要素は落として渡す（WS 境界で型は失われる）", async () => {
    const { handle, socket, onObsSources } = await connectAndOpen();
    socket.onmessage?.({
      data: JSON.stringify({
        type: "obs.sources",
        payload: {
          ok: true,
          sources: [
            null,
            42,
            { name: 1, kind: "ffmpeg_source" },
            { name: "花火", kind: "ffmpeg_source" },
          ],
        },
      }),
    });
    expect(onObsSources).toHaveBeenCalledWith(
      [{ name: "花火", kind: "ffmpeg_source" }],
      true,
    );
    handle.disconnect();
  });

  it("sources が配列でない obs.sources は空配列へ倒す（落ちない）", async () => {
    const { handle, socket, onObsSources } = await connectAndOpen();
    socket.onmessage?.({
      data: JSON.stringify({
        type: "obs.sources",
        payload: { ok: true, sources: "nope" },
      }),
    });
    expect(onObsSources).toHaveBeenCalledWith([], true);
    handle.disconnect();
  });
});
