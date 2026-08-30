import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * ⚠⚠⚠ **063f 段 2-a: `sendChat` の予約（`pendingChatSend`）が実際に効くことの仕様テスト。**
 *
 * ## なぜこのファイルが要るのか
 *
 * 066 段 1 以来 `sendChat` には「**同時 1 本**」のガードが書いてあったが、
 * ⚠⚠ **`commentStream` の層でチャット送信を叩くテストが 1 本も無かった**——
 * 送信を触るテストはすべて `CommentViewerApp.*.test.tsx` 側にあり、
 * あちらは **`sendChat` 自体をモックしている**ので、
 * 「**sidecar へ実際に何本フレームが出るか**」は**構造的に観測できなかった**。
 *
 * ⇒ その死角に、**`security-review`（2026-08-30・S-1）が実測で見つけた TOCTOU** が住んでいた:
 *
 * 1. `if (pendingChatSend !== null) return` … ガード
 * 2. `await invoke("get_chat_send_ticket")` … ⚠⚠⚠ **ここで中断する**
 * 3. `pendingChatSend = { ... }` … 代入
 *
 * ⚠⚠ 063f の自動送信は**同一バッチの当選を同じ遅延で予約する**ので、
 * **最大 3 本のタイマーが同じ tick で発火し、3 本とも 1 のガードを素通りしていた。**
 *
 * ## ⚠⚠⚠ ここで固定していること（＝二度と戻さないもの）
 *
 * 1. **同じ tick の 2 本目は `{ok:false}` で即返り、`invoke` が 1 回しか走らない。**
 *    ⚠⚠ **見るのは「フレームが 1 本」だけでは足りない**——`invoke` の回数まで見て初めて
 *    「**チケット取得すら走らない**」（＝ガードが `await` より前で効いている）が固定される。
 * 2. ⚠⚠⚠ **成功した 1 本目の結果が、呼び出し元へ正しく返る。**
 *    旧実装ではここが `requestId` 不一致で捨てられ、**「投稿されたのに『失敗しました』と出る」**
 *    になっていた（S-1 の帰結のうち最も重いもの）。
 * 3. ⚠⚠ **予約は必ず解放される。** 解放し忘れは**1 度失敗したら以後 1 通も送れない**という、
 *    直す前より悪い壊れ方になる。⇒ **チケット失敗／切断／`invoke` が返らない**の 3 経路とも見る。
 *
 * ## ⚠ ここで固定して**いない**こと
 *
 * - **スロットル**（最短 3 秒／30 秒に 5 通／直前と同じ本文を拒否）は **sidecar 側にしかない**
 *   （`docs/security.md` §1 の 063f 追補）。⚠⚠ **frontend に流量を数える仕組みを持ち込まないこと**
 *   ——ここが落としているのは「**同時に 2 本走らせない**」だけで、流量制限ではない。
 *
 * `invoke` と `WebSocket` はモックする＝テストは端末外通信も OS 操作も一切しない（§1）。
 */
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import { connectCommentStream } from "./commentStream";

const mockInvoke = vi.mocked(invoke);

const TICKET = "0123456789abcdef0123456789abcdef";
/** ⚠ 別能力のチケット。**これが載っていたら能力の分離が壊れている。** */
const OTHER_TICKET = "ffffffffffffffffffffffffffffffff";

/** commentStream が使う最小の WebSocket モック（`commentStream.sessionControl.test.ts` と同じ作法）。 */
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

/** §9: どの経路でもチケットも本文も `console.*` に出さないことを見張る。 */
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
  vi.useRealTimers();
});

/**
 * ⚠ **コマンドごとに別の値を返す。** これが「テーマ／セッション制御のチケットを流用していないか」を
 * 見るための仕掛けで、`get_chat_send_ticket` 以外を呼ぶと別の値が載る。
 *
 * @param ticket `null` を渡すと「チケットが取れない」を再現する。
 */
function mockBackend(ticket: string | null = TICKET) {
  mockInvoke.mockImplementation((cmd: string) => {
    if (cmd === "get_comment_stream_port") return Promise.resolve(17331);
    if (cmd === "get_chat_send_ticket") return Promise.resolve(ticket);
    if (cmd === "get_theme_import_ticket") return Promise.resolve(OTHER_TICKET);
    if (cmd === "get_session_control_ticket")
      return Promise.resolve(OTHER_TICKET);
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

/** 送信された `chat-send` フレームだけを取り出す。 */
const chatFrames = (socket: MockWebSocket) =>
  socket.sent
    .map((raw) => JSON.parse(raw) as Record<string, unknown>)
    .filter((f) => f.type === "chat-send");

/** `get_chat_send_ticket` を呼んだ回数（＝「チケット取得すら走らない」の実体）。 */
const ticketCalls = () =>
  mockInvoke.mock.calls.filter((c) => c[0] === "get_chat_send_ticket").length;

/** sidecar が返す送信結果（要求元 1 本への unicast）を再現する。 */
function replyResult(
  socket: MockWebSocket,
  payload: { requestId: unknown; ok?: unknown; reason?: unknown },
) {
  socket.onmessage?.({
    data: JSON.stringify({ type: "chat.send.result", payload }),
  });
}

describe("063f 段 2-a: sendChat の予約は await の前に置く（S-1 の TOCTOU）", () => {
  /**
   * ⚠⚠⚠ **このファイルの本体。** 同じ tick で 2 回呼ぶ＝自動送信で**日常的に起きる**形である
   * （同一バッチで 2 件当選すると、2 本のタイマーが同じ tick で発火する）。
   *
   * ⚠⚠ **`invoke` の回数を見ているのが要点**——フレーム数だけを見ると、
   * 「チケットは 2 回取ったが送るのは 1 本」という**直っていない実装でも緑になりうる**。
   */
  it("⚠⚠⚠ 同じ tick で 2 回呼ぶと、2 本目はチケット取得すら走らずに即 {ok:false} で返る", async () => {
    mockBackend();
    const { handle, socket } = await connectAndOpen();

    // ⚠ **await を挟まずに 2 回呼ぶ**（＝同一バッチの当選が同じ tick で発火する形の再現）。
    const first = handle.sendChat("1 通目", "mychannel");
    const second = handle.sendChat("2 通目", "mychannel");

    // ⚠⚠⚠ 2 本目は**その場で**理由つきで返る（＝ガードが `await` より前で効いている）。
    await expect(second).resolves.toEqual({
      ok: false,
      reason: "前の書き込みが終わっていないため送れませんでした。",
    });
    // ⚠⚠ **チケット取得は 1 回だけ**。旧実装（予約が `await` の後）ではここが 2 になる。
    expect(ticketCalls()).toBe(1);

    await flush();
    // ⚠⚠⚠ sidecar へ出るフレームも 1 本だけ（旧実装では 2 本出ていた）。
    const frames = chatFrames(socket);
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({
      type: "chat-send",
      ticket: TICKET,
      message: "1 通目",
      // ⚠⚠⚠ S-2b: 宛先ではなく**期待値**（この修正で扱いを変えていないこと）。
      expectedChannel: "mychannel",
    });

    // ⚠ 1 本目は待たせたままにしない（未処理の Promise を残さない）。
    replyResult(socket, { requestId: frames[0].requestId, ok: true });
    await expect(first).resolves.toEqual({ ok: true });
  });

  /**
   * ⚠⚠⚠ **S-1 の帰結のうち最も重いものが閉じたことの固定。**
   *
   * 旧実装では `pendingChatSend` が 2 本目に上書きされるため、
   * **1 本目の結果フレームが `requestId` 不一致で捨てられ**、
   * 呼び出し元には**2 本目の拒否理由**しか残らなかった
   * ⇒ 画面には**「投稿されたのに『失敗しました』と出る」**。
   */
  it("⚠⚠⚠ バーストのあとでも、成功した 1 本目の結果がそのまま返る", async () => {
    mockBackend();
    const { handle, socket } = await connectAndOpen();

    const first = handle.sendChat("1 通目", "mychannel");
    void handle.sendChat("2 通目", "mychannel");
    await flush();

    const frame = chatFrames(socket)[0];
    replyResult(socket, { requestId: frame.requestId, ok: true });

    // ⚠⚠ **`{ok:true}` が返る**（拒否理由に化けない）。
    await expect(first).resolves.toEqual({ ok: true });
  });

  /** ⚠ 理由つきの失敗も、そのまま 1 本目の呼び出し元へ返る（短文をそのまま画面に出すため）。 */
  it("⚠ sidecar が返した拒否理由がそのまま返る", async () => {
    mockBackend();
    const { handle, socket } = await connectAndOpen();

    const sent = handle.sendChat("こんにちは", "mychannel");
    await flush();
    replyResult(socket, {
      requestId: chatFrames(socket)[0].requestId,
      ok: false,
      reason: "直前と同じ内容は送れません（Twitch 側で弾かれるため）。",
    });

    await expect(sent).resolves.toEqual({
      ok: false,
      reason: "直前と同じ内容は送れません（Twitch 側で弾かれるため）。",
    });
  });

  /**
   * ⚠⚠⚠ **予約を `await` の前へ出したことで新しく生まれた壊れ方**——
   * 解放し忘れると、**1 度失敗しただけで以後 1 通も送れなくなる**（直す前より悪い）。
   */
  it("⚠⚠⚠ チケットが取れずに失敗しても、次の送信は普通に走る（予約を解放している）", async () => {
    mockBackend(null);
    const { handle, socket } = await connectAndOpen();

    await expect(handle.sendChat("1 回目", "mychannel")).resolves.toEqual({
      ok: false,
      reason: "コメントの取得に接続していません。",
    });
    expect(chatFrames(socket)).toHaveLength(0);

    // ⚠⚠ **チケットが取れるようになったら送れること**（予約が残っていたらここが「前の書き込みが終わっていない」になる）。
    mockBackend();
    const retry = handle.sendChat("2 回目", "mychannel");
    await flush();
    const frames = chatFrames(socket);
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ message: "2 回目" });

    replyResult(socket, { requestId: frames[0].requestId, ok: true });
    await expect(retry).resolves.toEqual({ ok: true });
  });

  /** ⚠ `invoke` が throw した場合も同じ（例外でも予約を握り続けない）。 */
  it("⚠⚠ チケット取得が throw しても予約を握り続けない", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_comment_stream_port") return Promise.resolve(17331);
      if (cmd === "get_chat_send_ticket")
        return Promise.reject(new Error("boom"));
      return Promise.reject(new Error(`unexpected command: ${cmd}`));
    });
    const { handle } = await connectAndOpen();

    await expect(handle.sendChat("1 回目", "mychannel")).resolves.toEqual({
      ok: false,
      reason: "コメントの取得に接続していません。",
    });

    mockBackend();
    // ⚠ 2 回目が「前の書き込みが終わっていない」で落ちず、**チケット取得まで進む**こと
    //   （1 回目の throw ぶんと合わせて 2 回＝ 2 回目もガードを通過した証拠）。
    void handle.sendChat("2 回目", "mychannel");
    await flush();
    expect(ticketCalls()).toBe(2);
  });

  /**
   * ⚠⚠ チケットを待っているあいだに切断されたら、**フレームを出さない**。
   * ⚠ 予約も残さない（残すと、再接続しても「前の書き込みが終わっていない」で 1 通も出せなくなる）。
   */
  it("⚠⚠ チケット取得中に切断されたら送らず、予約も残さない", async () => {
    // ⚠ **noop で初期化する**（`| null` にすると、代入が executor の中なので TS が `never` に絞る）。
    let resolveTicket: (v: string) => void = () => {};
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_comment_stream_port") return Promise.resolve(17331);
      if (cmd === "get_chat_send_ticket")
        return new Promise<string>((resolve) => {
          resolveTicket = resolve;
        });
      return Promise.reject(new Error(`unexpected command: ${cmd}`));
    });
    const { handle, socket } = await connectAndOpen();

    const sending = handle.sendChat("こんにちは", "mychannel");
    await flush();

    // ⚠ 切断（`onclose` が進行中の待ちを落とす）。
    socket.readyState = MockWebSocket.CLOSED;
    socket.onclose?.();
    resolveTicket(TICKET);

    await expect(sending).resolves.toEqual({
      ok: false,
      reason: "コメントの取得に接続していません。",
    });
    // ⚠⚠⚠ **閉じたソケットへフレームを出していない。**
    expect(chatFrames(socket)).toHaveLength(0);
  });

  /**
   * ⚠⚠⚠ **`invoke` が永久に返らないときの保険**（＝予約を `await` の前へ出した代償）。
   *
   * `CHAT_SEND_TIMEOUT_MS` のタイマーを**予約の直後**に張ってあるので、
   * チケット取得が固まっても予約は有限時間で必ず解ける。
   * ⚠⚠ **タイマーをフレーム送出の直前へ戻すとこのケースが落ちる**（＝恒久ロックの復活）。
   */
  it("⚠⚠⚠ チケット取得が返らなくても、予約は有限時間で解ける（恒久ロックにしない）", async () => {
    vi.useFakeTimers();
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_comment_stream_port") return Promise.resolve(17331);
      // ⚠ **永久に settle しない**チケット取得。
      if (cmd === "get_chat_send_ticket") return new Promise<string>(() => {});
      return Promise.reject(new Error(`unexpected command: ${cmd}`));
    });
    const handle = connectCommentStream({ onComments: vi.fn() });
    await vi.advanceTimersByTimeAsync(0);
    const socket = MockWebSocket.instances[0];
    socket.onopen?.();

    void handle.sendChat("固まる 1 通目", "mychannel");
    await vi.advanceTimersByTimeAsync(0);
    // ⚠ この時点ではまだ予約されている（2 本目は落ちる）。
    await expect(handle.sendChat("2 通目", "mychannel")).resolves.toEqual({
      ok: false,
      reason: "前の書き込みが終わっていないため送れませんでした。",
    });

    // ⚠⚠ タイムアウト（15 秒）を跨ぐ。
    await vi.advanceTimersByTimeAsync(20_000);

    // ⚠⚠⚠ **予約が解けているので、3 本目はチケット取得まで進む。**
    void handle.sendChat("3 通目", "mychannel");
    await vi.advanceTimersByTimeAsync(0);
    expect(ticketCalls()).toBe(2);
  });

  /**
   * ⚠⚠⚠ **2026-08-30・レビュー Q-1: 「成功したあと予約が解ける」が 1 本も無かった。**
   *
   * 結果フレームの受け口（`pendingChatSend = null` → `settle`）を**削る変異が生存した**
   * ——8 本すべて緑のまま通った。⚠⚠ **踏むと `await settled` の直後に `clearTimeout` するせいで
   * タイマーも消え、`pendingChatSend` が永久に残る**＝
   * ⚠⚠⚠ **1 セッションで書けるのは生涯 1 通だけ**（以後すべて「前の書き込みが終わっていない」）。
   * ⇒ **このファイルが自ら宣言した「予約は必ず解放される」の、いちばん短い経路である。**
   */
  it("⚠⚠⚠ 1 通目が成功したあとも 2 通目が普通に送れる（結果フレームで予約が解ける）", async () => {
    mockBackend();
    const { handle, socket } = await connectAndOpen();

    const first = handle.sendChat("1 通目", "mychannel");
    await flush();
    replyResult(socket, { requestId: chatFrames(socket)[0].requestId, ok: true });
    await expect(first).resolves.toEqual({ ok: true });

    const second = handle.sendChat("2 通目", "mychannel");
    await flush();
    // ⚠⚠ **チケット取得まで進む**（予約が残っていたらここが 1 のまま＝「前の書き込みが終わっていない」で落ちる）。
    expect(ticketCalls()).toBe(2);
    const frames = chatFrames(socket);
    expect(frames).toHaveLength(2);
    expect(frames[1]).toMatchObject({ message: "2 通目" });

    replyResult(socket, { requestId: frames[1].requestId, ok: true });
    await expect(second).resolves.toEqual({ ok: true });
  });

  /**
   * ⚠⚠⚠ **2026-08-30・レビュー Q-1: 「予約が解けていたらフレームを出さない」検査が未固定だった。**
   *
   * `sendChat` は `await invoke` の後に「**予約がまだ自分のものか**」を見てから送出するが、
   * ⚠⚠ **この分岐を丸ごと削る変異が生存した**。既存の「切断」ケースでは
   * **`onclose` が `ws` を `null` にするので手前の分岐で return してしまい、ここへ到達しない。**
   * ⇒ ⚠ **WS は開いたまま「タイムアウトで予約だけ解けた」状態**を作るのが、この 1 本の役目である。
   *
   * ⚠ 出しても結果は `requestId` 不一致で捨てられるだけで、
   * **sidecar のスロットル枠（30 秒に 5 通）を無駄に食う**。
   */
  it("⚠⚠⚠ タイムアウト後に遅れて届いたチケットでは、フレームを出さない", async () => {
    vi.useFakeTimers();
    let resolveTicket: (v: string) => void = () => {};
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_comment_stream_port") return Promise.resolve(17331);
      if (cmd === "get_chat_send_ticket")
        return new Promise<string>((resolve) => {
          resolveTicket = resolve;
        });
      return Promise.reject(new Error(`unexpected command: ${cmd}`));
    });
    const handle = connectCommentStream({ onComments: vi.fn() });
    await vi.advanceTimersByTimeAsync(0);
    const socket = MockWebSocket.instances[0];
    socket.onopen?.();

    const sending = handle.sendChat("固まる 1 通目", "mychannel");
    await vi.advanceTimersByTimeAsync(0);
    // ⚠⚠ タイムアウト（15 秒）を跨ぐ。⚠ **WS は開いたまま**である。
    await vi.advanceTimersByTimeAsync(20_000);
    expect(socket.readyState).toBe(MockWebSocket.OPEN);

    // ⚠ ここで遅れてチケットが返る（＝予約はもう自分のものではない）。
    resolveTicket(TICKET);
    await expect(sending).resolves.toEqual({
      ok: false,
      reason: "送信の結果を確認できませんでした。",
    });
    // ⚠⚠⚠ **フレームは 1 本も出ていない。**
    expect(chatFrames(socket)).toHaveLength(0);
  });

  /**
   * ⚠⚠⚠ **2026-08-30・レビュー Q-1: `release()` の所有者検査が未固定だった。**
   *
   * `release()` は **`pendingChatSend?.requestId === requestId` を確かめてから**消すが、
   * ⚠⚠ **無条件 `null` へ変える変異が生存した**。
   * ⇒ 踏むと**タイムアウトした 1 本目の遅れた解放が、2 本目の予約を巻き添えにする**
   * （2 本目の結果フレームが `requestId` 不一致で捨てられ、**15 秒待たされる**）。
   */
  it("⚠⚠⚠ 遅れて解放される 1 本目が、2 本目の予約を巻き添えにしない", async () => {
    vi.useFakeTimers();
    let resolveFirstTicket: (v: string) => void = () => {};
    let ticketCall = 0;
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_comment_stream_port") return Promise.resolve(17331);
      if (cmd === "get_chat_send_ticket") {
        ticketCall += 1;
        // ⚠ 1 本目だけ**永久に返らない**（2 本目は普通に取れる）。
        if (ticketCall === 1)
          return new Promise<string>((resolve) => {
            resolveFirstTicket = resolve;
          });
        return Promise.resolve(TICKET);
      }
      return Promise.reject(new Error(`unexpected command: ${cmd}`));
    });
    const handle = connectCommentStream({ onComments: vi.fn() });
    await vi.advanceTimersByTimeAsync(0);
    const socket = MockWebSocket.instances[0];
    socket.onopen?.();

    const first = handle.sendChat("固まる 1 通目", "mychannel");
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(20_000); // 1 本目の予約が解ける

    // 2 本目は普通に予約でき、フレームも出る。
    const second = handle.sendChat("2 通目", "mychannel");
    await vi.advanceTimersByTimeAsync(0);
    const frames = chatFrames(socket);
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ message: "2 通目" });

    // ⚠ ここで 1 本目が遅れて resume し、`release()` を通る。
    resolveFirstTicket(TICKET);
    await expect(first).resolves.toEqual({
      ok: false,
      reason: "送信の結果を確認できませんでした。",
    });
    // ⚠ 1 本目はフレームを増やしていない。
    expect(chatFrames(socket)).toHaveLength(1);

    // ⚠⚠⚠ **2 本目の予約が生きている**＝結果フレームがそのまま返る。
    replyResult(socket, { requestId: frames[0].requestId, ok: true });
    await expect(second).resolves.toEqual({ ok: true });
  });

  /** ⚠ §9: チケットも本文も `console.*` に出さない（全ケースを通した最後に見る）。 */
  it("⚠ §9: チケットも本文もログに出さない", async () => {
    mockBackend();
    const { handle, socket } = await connectAndOpen();
    const sent = handle.sendChat("秘密の本文", "mychannel");
    await flush();
    replyResult(socket, {
      requestId: chatFrames(socket)[0].requestId,
      ok: true,
    });
    await sent;

    const logged = consoleSpies.output.join("\n");
    expect(logged).not.toContain(TICKET);
    expect(logged).not.toContain("秘密の本文");
  });
});
