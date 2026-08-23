import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * 066 段 2: **取得セッションの制御（`start-session` / `stop-session`）にチケットを要求する**仕様テスト。
 *
 * あるべき挙動（`docs/tasks/066-chat-send.md` の「段 2」節 ／ `docs/security.md` §1 の 066 節）:
 * - ⚠⚠⚠ **どちらのフレームにも必ずチケットが載る。** loopback WS は**未認証**で、
 *   `start-session` は **sidecar 側で `chatSender.setChannel` を呼ぶ唯一の経路＝
 *   チャット送信の宛先を決めるフレーム**である（security-review 066 S-2）。
 *   ⇒ ここが素通りだと、ブラウザで開いた悪意あるページが宛先を差し替えられる。
 * - ⚠⚠ **チケットは操作のたびに取り直す**（sidecar が再 spawn されると値が変わる）。
 * - ⚠⚠⚠ **取れなければ送らず、理由を返す**（穴 C）。sidecar 側は不一致を**黙って捨てる**ので、
 *   ここで黙ると「取得開始を押したのに何も起きない、原因不明」になる。
 * - ⚠ **`ok:true` は「送れた」だけ**（取得が始まったかは `session.state` が持つ）。
 * - ⚠ **チャット送信／テーマ取り込みのチケットを流用しない**（能力ごとに秘密を分ける）。
 * - §9: **チケットを `console.*` に出さない。**
 *
 * `invoke` と `WebSocket` はモックする＝テストは端末外通信も OS 操作も一切しない（§1）。
 */
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import {
  connectCommentStream,
  SESSION_CONTROL_UNAVAILABLE_REASON,
} from "./commentStream";

const mockInvoke = vi.mocked(invoke);

const TICKET = "0123456789abcdef0123456789abcdef";
/** ⚠ 別能力のチケット。**これが載っていたら能力の分離が壊れている。** */
const OTHER_TICKET = "ffffffffffffffffffffffffffffffff";

/** commentStream が使う最小の WebSocket モック（`commentStream.themeFetch.test.ts` と同じ作法）。 */
class MockWebSocket {
  static OPEN = 1;
  static CLOSED = 3;
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
let consoleSpies: { restore: () => void; output: string[] };

/** §9: どの経路でもチケットを `console.*` に出さないことを見張る。 */
function watchConsole() {
  const output: string[] = [];
  const methods = ["log", "info", "warn", "error", "debug"] as const;
  const originals = methods.map((m) => [m, console[m]] as const);
  for (const m of methods) {
    console[m] = ((...args: unknown[]) => {
      output.push(args.map(String).join(" "));
    }) as typeof console.log;
  }
  return {
    output,
    restore: () => {
      for (const [m, fn] of originals) console[m] = fn;
    },
  };
}

beforeEach(() => {
  mockInvoke.mockReset();
  MockWebSocket.instances = [];
  originalWs = (globalThis as { WebSocket?: unknown }).WebSocket;
  (globalThis as { WebSocket?: unknown }).WebSocket =
    MockWebSocket as unknown as typeof WebSocket;
  consoleSpies = watchConsole();
});

afterEach(() => {
  consoleSpies.restore();
  (globalThis as { WebSocket?: unknown }).WebSocket = originalWs;
});

/**
 * ⚠ **コマンドごとに別の値を返す。** これが「テーマ／チャットのチケットを流用していないか」を
 * 見るための仕掛けで、`get_session_control_ticket` 以外を呼ぶと別の値が載る。
 */
function mockBackend(ticket: string | null = TICKET) {
  mockInvoke.mockImplementation((cmd: string) => {
    if (cmd === "get_comment_stream_port") return Promise.resolve(17331);
    if (cmd === "get_session_control_ticket") return Promise.resolve(ticket);
    if (cmd === "get_theme_import_ticket") return Promise.resolve(OTHER_TICKET);
    if (cmd === "get_chat_send_ticket") return Promise.resolve(OTHER_TICKET);
    return Promise.reject(new Error(`unexpected command: ${cmd}`));
  });
}

async function connectAndOpen() {
  const handle = connectCommentStream({ onComments: vi.fn() });
  await flush();
  const socket = MockWebSocket.instances[0];
  socket.onopen?.();
  return { handle, socket };
}

/** 送信されたセッション制御フレームだけを取り出す。 */
const sessionFrames = (socket: MockWebSocket) =>
  socket.sent
    .map((raw) => JSON.parse(raw) as Record<string, unknown>)
    .filter(
      (f) => f.type === "start-session" || f.type === "stop-session",
    );

/** `get_session_control_ticket` を呼んだ回数。 */
const ticketCalls = () =>
  mockInvoke.mock.calls.filter((c) => c[0] === "get_session_control_ticket")
    .length;

describe("066 段 2: 取得セッション制御のチケット", () => {
  it("⚠⚠⚠ start-session にチケットが載る（未認証 WS からの宛先差し替えを塞ぐ壁）", async () => {
    mockBackend();
    const { handle, socket } = await connectAndOpen();

    const result = await handle.startSession("twitch", "mychannel");

    expect(result).toEqual({ ok: true });
    expect(sessionFrames(socket)).toEqual([
      {
        type: "start-session",
        service: "twitch",
        channel: "mychannel",
        ticket: TICKET,
      },
    ]);
  });

  it("⚠⚠ stop-session にもチケットが載る（開始と停止は同じ能力＝片方だけ誰でも叩ける形を作らない）", async () => {
    mockBackend();
    const { handle, socket } = await connectAndOpen();

    const result = await handle.stopSession("twitch");

    expect(result).toEqual({ ok: true });
    expect(sessionFrames(socket)).toEqual([
      { type: "stop-session", service: "twitch", ticket: TICKET },
    ]);
  });

  it("⚠ youtube は channel を載せない（mine=true）が、チケットは同じく載る", async () => {
    mockBackend();
    const { handle, socket } = await connectAndOpen();

    await handle.startSession("youtube");

    expect(sessionFrames(socket)).toEqual([
      { type: "start-session", service: "youtube", ticket: TICKET },
    ]);
  });

  it("⚠⚠ チケットは操作のたびに取り直す（sidecar 再 spawn で値が変わるため）", async () => {
    mockBackend();
    const { handle } = await connectAndOpen();

    await handle.startSession("twitch", "a");
    await handle.stopSession("twitch");
    await handle.startSession("youtube");

    expect(ticketCalls()).toBe(3);
  });

  it("⚠⚠⚠ チケットが取れなければ送らず、画面に出せる理由を返す（穴 C）", async () => {
    mockBackend(null);
    const { handle, socket } = await connectAndOpen();

    const result = await handle.startSession("twitch", "mychannel");

    // ⚠⚠ **送っていないこと**が本体（送って黙って捨てられると原因が読めない）。
    expect(sessionFrames(socket)).toEqual([]);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe(SESSION_CONTROL_UNAVAILABLE_REASON);
  });

  it("⚠ 停止側も同じ（チケットが取れなければ送らず理由を返す）", async () => {
    mockBackend(null);
    const { handle, socket } = await connectAndOpen();

    const result = await handle.stopSession("twitch");

    expect(sessionFrames(socket)).toEqual([]);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe(SESSION_CONTROL_UNAVAILABLE_REASON);
  });

  it("⚠ invoke が throw しても落ちず、送らずに理由を返す", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_comment_stream_port") return Promise.resolve(17331);
      return Promise.reject(new Error("boom"));
    });
    const { handle, socket } = await connectAndOpen();

    const result = await handle.startSession("twitch", "mychannel");

    expect(sessionFrames(socket)).toEqual([]);
    expect(result.ok).toBe(false);
  });

  it("⚠ WS が未接続なら送らず理由を返す（閉じたソケットへ投げて黙って消える、を作らない）", async () => {
    mockBackend();
    const { handle, socket } = await connectAndOpen();
    socket.readyState = MockWebSocket.CLOSED;

    const result = await handle.startSession("twitch", "mychannel");

    expect(sessionFrames(socket)).toEqual([]);
    expect(result.ok).toBe(false);
    // ⚠ チケットを取りに行く前に落とす（未接続と分かっているのに Rust を叩かない）。
    expect(ticketCalls()).toBe(0);
  });

  it("⚠⚠ チケット取得中に切断されたら送らない（await を挟むので前後 2 回見る）", async () => {
    let socket: MockWebSocket | null = null;
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_comment_stream_port") return Promise.resolve(17331);
      if (cmd === "get_session_control_ticket") {
        // ⚠ 解決する直前に切断される（実際の再接続と同じ順序）。
        if (socket) socket.readyState = MockWebSocket.CLOSED;
        return Promise.resolve(TICKET);
      }
      return Promise.reject(new Error(`unexpected command: ${cmd}`));
    });
    const opened = await connectAndOpen();
    socket = opened.socket;

    const result = await opened.handle.startSession("twitch", "mychannel");

    expect(sessionFrames(opened.socket)).toEqual([]);
    expect(result.ok).toBe(false);
  });

  it("⚠⚠ テーマ取り込み／チャット送信のチケットを流用しない（能力ごとに秘密が別）", async () => {
    mockBackend();
    const { handle, socket } = await connectAndOpen();

    await handle.startSession("twitch", "mychannel");

    const sent = JSON.stringify(sessionFrames(socket));
    expect(sent).toContain(TICKET);
    expect(sent).not.toContain(OTHER_TICKET);
    expect(mockInvoke).not.toHaveBeenCalledWith("get_theme_import_ticket");
    expect(mockInvoke).not.toHaveBeenCalledWith("get_chat_send_ticket");
  });

  /**
   * ⚠⚠⚠ **自 security-review（2026-08-23）で見つけた回帰の固定。**
   *
   * 段 2 以前の `startSession` / `stopSession` は**同期送信**で順序が自明だったが、
   * チケット取得（`await invoke`）を挟んだことで **2 本の解決順が入れ替わりうる**ようになった。
   * ⚠⚠ 「取得開始 → すぐ停止」と押したときに **停止したのに取得が始まる**——
   * ユーザーの**最後の**意思が消える、いちばん質の悪い壊れ方である。
   * ⚠ **実測で再現した**（下と同じ形で、1 本目のチケット取得だけ遅らせると逆順で届いた）。
   */
  it("⚠⚠⚠ 呼ばれた順に送る（1 本目のチケット取得が遅れても入れ替わらない）", async () => {
    let nth = 0;
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_comment_stream_port") return Promise.resolve(17331);
      if (cmd === "get_session_control_ticket") {
        nth += 1;
        // ⚠ **1 本目だけ遅い**（直列化していないと 2 本目が先に届く）。
        const delayMs = nth === 1 ? 30 : 0;
        return new Promise((resolve) => setTimeout(() => resolve(TICKET), delayMs));
      }
      return Promise.reject(new Error(`unexpected command: ${cmd}`));
    });
    const { handle, socket } = await connectAndOpen();

    // ⚠ **await しない**（ユーザーが取得開始→停止を続けて押した状況）。
    const started = handle.startSession("twitch", "mychannel");
    const stopped = handle.stopSession("twitch");
    await Promise.all([started, stopped]);

    expect(sessionFrames(socket).map((f) => f.type)).toEqual([
      "start-session",
      "stop-session",
    ]);
  });

  it("⚠ 1 本失敗しても後続が止まらない（一度失敗したら以後ずっと効かない、を作らない）", async () => {
    let nth = 0;
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_comment_stream_port") return Promise.resolve(17331);
      if (cmd === "get_session_control_ticket") {
        nth += 1;
        return nth === 1
          ? Promise.reject(new Error("boom"))
          : Promise.resolve(TICKET);
      }
      return Promise.reject(new Error(`unexpected command: ${cmd}`));
    });
    const { handle, socket } = await connectAndOpen();

    const first = await handle.startSession("twitch", "mychannel");
    const second = await handle.startSession("twitch", "mychannel");

    expect(first.ok).toBe(false);
    expect(second.ok).toBe(true);
    expect(sessionFrames(socket)).toHaveLength(1);
  });

  /**
   * ⚠⚠⚠ **レビュー S-1 の回帰テスト: 鎖が永久に詰まらないこと。**
   *
   * 直列化（`sessionControlChain`）の代償として、**1 本が settle しないと以後どの
   * 取得開始／停止も実行されない**——しかも呼び出し側の `await` も返らないので
   * **画面に理由すら出ない**（＝穴 C が名指しした「押したのに何も起きない、原因不明」）。
   * ⚠ 旧実装は各呼び出しが独立だったので、この失敗モードは**段 2 が新しく持ち込んだもの**である。
   * ⇒ `SESSION_CONTROL_TICKET_TIMEOUT_MS` で必ず settle させる。
   *
   * ⚠ **fake timer をこのケースだけで使う**（接続まで実タイマーで進めてから切り替える）。
   */
  it("⚠⚠⚠ チケット取得が返ってこなくても、理由を返し**後続を詰まらせない**（S-1）", async () => {
    let nth = 0;
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_comment_stream_port") return Promise.resolve(17331);
      if (cmd === "get_session_control_ticket") {
        nth += 1;
        // ⚠ **1 本目は永久に settle しない**（IPC の応答欠落・コマンドの panic 等）。
        return nth === 1 ? new Promise(() => {}) : Promise.resolve(TICKET);
      }
      return Promise.reject(new Error(`unexpected command: ${cmd}`));
    });
    const { handle, socket } = await connectAndOpen();

    vi.useFakeTimers();
    try {
      const first = handle.startSession("twitch", "mychannel");
      // ⚠ タイムアウトまで進める（実装値に依存しないよう十分に進める）。
      await vi.advanceTimersByTimeAsync(30_000);
      const firstResult = await first;
      expect(firstResult.ok).toBe(false);
      expect(firstResult.reason).toBe(SESSION_CONTROL_UNAVAILABLE_REASON);

      // ⚠⚠⚠ **ここが本体**——鎖が詰まっていたら 2 本目は永久に待つ。
      const second = handle.stopSession("twitch");
      await vi.advanceTimersByTimeAsync(1);
      const secondResult = await second;
      expect(secondResult.ok).toBe(true);
    } finally {
      vi.useRealTimers();
    }

    // ⚠ 1 本目は**送っていない**（fail-closed）。2 本目だけが載る。
    expect(sessionFrames(socket).map((f) => f.type)).toEqual(["stop-session"]);
  });

  it("⚠⚠ §9: チケットを console に出さない", async () => {
    mockBackend();
    const { handle } = await connectAndOpen();

    await handle.startSession("twitch", "mychannel");
    await handle.stopSession("twitch");

    expect(consoleSpies.output.join("\n")).not.toContain(TICKET);
  });
});
