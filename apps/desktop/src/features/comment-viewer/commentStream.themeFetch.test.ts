import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * 060c/060h: テーマ資産（外部 `@import` の CSS ／ `@font-face` の実体）の取得依頼の仕様テスト。
 *
 * あるべき挙動（`docs/security.md` §1 の 060c 例外・060h 追補 ／ `docs/tasks/060h-*.md`）:
 * - ⚠⚠ **どの取得フレームにも必ずチケットが載る。** loopback WS は**未認証**なので、
 *   チケットが「同意ダイアログを経ない取得」を塞ぐ唯一の壁である。
 * - ⚠⚠ **チケットは取得のたびに取り直す**（sidecar が再 spawn されると値が変わるため）。
 * - ⚠ **URL は組み立て直さない**（同意ダイアログが表示した文字列そのものを送る）。
 * - ⚠⚠ **CSS の応答とフォントの応答を取り違えない**（`requestId` と**応答フレーム種別の両方**を見る）。
 *   ここが片方だけになると、フォントの結果が CSS の待ちを解決する（＝別種の本文が混ざる）形が作れる。
 * - 未接続・チケット未受領・切断は `offline` へ落とす（**フレームを送らない**）。
 * - 同時 1 本（2 本目は `busy`）。
 * - フォントは `mime` と `base64` が**両方**揃っているときだけ成功（欠けたまま `data:` を組ませない）。
 * - §9: **URL もフォントのバイト列も `console.*` に出さない。**
 *
 * `invoke`（`get_comment_stream_port` / `get_theme_import_ticket`）と `WebSocket` はモックする
 * ＝テストは端末外通信も OS 操作も一切しない（§1）。
 */
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import { connectCommentStream } from "./commentStream";

const mockInvoke = vi.mocked(invoke);

const TICKET = "0123456789abcdef0123456789abcdef";
const CSS_URL = "https://fonts.googleapis.com/css2?family=M+PLUS+1p:wght@400";
const FONT_URL = "https://fonts.gstatic.com/s/mplus1p/v1/abcdef.woff2";

/** commentStream が使う最小の WebSocket モック（`commentStream.obs.test.ts` と同じ作法）。 */
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

/** §9: どの経路でも `console.*` に本文・URL を出さないことを見張る。 */
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

/** ⚠ ポート取得とチケット取得を**別々に**返す（チケットを毎回引き直すことを見たいので件数も数える）。 */
function mockBackend(ticket: string | null = TICKET) {
  mockInvoke.mockImplementation((cmd: string) => {
    if (cmd === "get_comment_stream_port") return Promise.resolve(17331);
    if (cmd === "get_theme_import_ticket") return Promise.resolve(ticket);
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

/** 送信された取得フレームだけを取り出す。 */
const fetchFrames = (socket: MockWebSocket) =>
  socket.sent
    .map((raw) => JSON.parse(raw) as Record<string, unknown>)
    .filter((m) => String(m.type).startsWith("theme-import."));

/** sidecar からの応答を 1 件流す。 */
const deliver = (socket: MockWebSocket, message: unknown) =>
  socket.onmessage?.({ data: JSON.stringify(message) });

const ticketCalls = () =>
  mockInvoke.mock.calls.filter((c) => c[0] === "get_theme_import_ticket").length;

describe("テーマ資産の取得依頼: チケットと宛先（§1 の担保）", () => {
  it("⚠⚠ CSS もフォントも必ずチケット付きで送る（未認証 WS を塞ぐ唯一の壁）", async () => {
    mockBackend();
    const { handle, socket } = await connectAndOpen();

    const cssPending = handle.requestThemeImport(CSS_URL, 1024);
    await flush();
    deliver(socket, {
      type: "theme-import.result",
      payload: { requestId: 1, ok: true, css: "a{}" },
    });
    await cssPending;

    const fontPending = handle.requestThemeFont(FONT_URL, 2048);
    await flush();
    deliver(socket, {
      type: "theme-import.font-result",
      payload: { requestId: 2, ok: true, mime: "font/woff2", base64: "AA==" },
    });
    await fontPending;

    const frames = fetchFrames(socket);
    expect(frames).toHaveLength(2);
    for (const frame of frames) {
      expect(frame.ticket).toBe(TICKET);
    }
    handle.disconnect();
  });

  it("⚠⚠ チケットは取得のたびに取り直す（sidecar 再起動で値が変わるため）", async () => {
    mockBackend();
    const { handle, socket } = await connectAndOpen();

    const first = handle.requestThemeFont(FONT_URL, 2048);
    await flush();
    deliver(socket, {
      type: "theme-import.font-result",
      payload: { requestId: 1, ok: true, mime: "font/woff2", base64: "AA==" },
    });
    await first;
    expect(ticketCalls()).toBe(1);

    const second = handle.requestThemeFont(FONT_URL, 2048);
    await flush();
    deliver(socket, {
      type: "theme-import.font-result",
      payload: { requestId: 2, ok: true, mime: "font/woff2", base64: "AA==" },
    });
    await second;
    // ⚠ 握ったまま使い回すと、再 spawn 後に黙って無視される（＝取得できない）。
    expect(ticketCalls()).toBe(2);
    handle.disconnect();
  });

  it("⚠ URL は組み立て直さず、同意ダイアログが見せた文字列をそのまま送る", async () => {
    mockBackend();
    const { handle, socket } = await connectAndOpen();
    void handle.requestThemeFont(FONT_URL, 4096);
    await flush();

    const [frame] = fetchFrames(socket);
    expect(frame.type).toBe("theme-import.fetch-font");
    expect(frame.url).toBe(FONT_URL);
    expect(frame.maxBytes).toBe(4096);
    handle.disconnect();
  });

  it("チケットが取れなければ 1 バイトも送らない（fail-closed）", async () => {
    mockBackend(null);
    const { handle, socket } = await connectAndOpen();

    const result = await handle.requestThemeFont(FONT_URL, 2048);
    expect(result).toEqual({ ok: false, reason: "offline" });
    expect(fetchFrames(socket)).toHaveLength(0);
    handle.disconnect();
  });

  it("未接続なら送らずに offline を返す（タイムアウトまで固まらない）", async () => {
    mockBackend();
    const { handle, socket } = await connectAndOpen();
    socket.readyState = MockWebSocket.CLOSED;

    const result = await handle.requestThemeImport(CSS_URL, 1024);
    expect(result).toEqual({ ok: false, reason: "offline" });
    expect(fetchFrames(socket)).toHaveLength(0);
    handle.disconnect();
  });
});

describe("テーマ資産の取得依頼: 応答の取り違え防止", () => {
  it("⚠⚠ フォントの応答が CSS の待ちを解決しない（種別が違えば受けない）", async () => {
    mockBackend();
    const { handle, socket } = await connectAndOpen();

    const pending = handle.requestThemeImport(CSS_URL, 1024);
    await flush();

    // 同じ requestId でも**種別が違う**応答は受けない。
    deliver(socket, {
      type: "theme-import.font-result",
      payload: { requestId: 1, ok: true, mime: "font/woff2", base64: "AA==" },
    });
    await flush();

    // 正しい種別が来て初めて解決する（＝上の 1 件で解決していない）。
    deliver(socket, {
      type: "theme-import.result",
      payload: { requestId: 1, ok: true, css: ".a{}" },
    });
    expect(await pending).toEqual({ ok: true, css: ".a{}" });
    handle.disconnect();
  });

  it("⚠⚠ CSS の応答がフォントの待ちを解決しない（逆向きも同じ）", async () => {
    mockBackend();
    const { handle, socket } = await connectAndOpen();

    const pending = handle.requestThemeFont(FONT_URL, 2048);
    await flush();

    deliver(socket, {
      type: "theme-import.result",
      payload: { requestId: 1, ok: true, css: ".a{}" },
    });
    await flush();

    deliver(socket, {
      type: "theme-import.font-result",
      payload: { requestId: 1, ok: true, mime: "font/woff2", base64: "AA==" },
    });
    expect(await pending).toEqual({
      ok: true,
      mime: "font/woff2",
      base64: "AA==",
    });
    handle.disconnect();
  });

  it("古い requestId の応答は捨てる（stale を取り違えない）", async () => {
    mockBackend();
    const { handle, socket } = await connectAndOpen();

    const pending = handle.requestThemeFont(FONT_URL, 2048);
    await flush();

    deliver(socket, {
      type: "theme-import.font-result",
      payload: { requestId: 99, ok: true, mime: "font/woff2", base64: "ZZ==" },
    });
    await flush();

    deliver(socket, {
      type: "theme-import.font-result",
      payload: { requestId: 1, ok: true, mime: "font/woff2", base64: "AA==" },
    });
    const result = await pending;
    expect(result).toEqual({ ok: true, mime: "font/woff2", base64: "AA==" });
    handle.disconnect();
  });

  it("進行中があれば 2 本目は busy（同時 1 本・フレームも増えない）", async () => {
    mockBackend();
    const { handle, socket } = await connectAndOpen();

    const first = handle.requestThemeFont(FONT_URL, 2048);
    await flush();
    const second = await handle.requestThemeFont(FONT_URL, 2048);

    expect(second).toEqual({ ok: false, reason: "busy" });
    expect(fetchFrames(socket)).toHaveLength(1);

    deliver(socket, {
      type: "theme-import.font-result",
      payload: { requestId: 1, ok: true, mime: "font/woff2", base64: "AA==" },
    });
    await first;
    handle.disconnect();
  });

  it("待っている間に切断されたら offline へ落とす（永久に待たない）", async () => {
    mockBackend();
    const { handle, socket } = await connectAndOpen();

    const pending = handle.requestThemeFont(FONT_URL, 2048);
    await flush();
    socket.onclose?.();

    expect(await pending).toEqual({ ok: false, reason: "offline" });
    handle.disconnect();
  });
});

describe("テーマ資産の取得依頼: 応答の検証と §9", () => {
  it("⚠⚠ mime か base64 が欠けたフォント応答は失敗にする（型無しの data: を作らない）", async () => {
    mockBackend();
    for (const payload of [
      { requestId: 1, ok: true, base64: "AA==" }, // mime 欠け
      { requestId: 1, ok: true, mime: "font/woff2" }, // base64 欠け
      { requestId: 1, ok: true, mime: 123, base64: "AA==" }, // 型違い
    ]) {
      MockWebSocket.instances = [];
      const { handle, socket } = await connectAndOpen();
      const pending = handle.requestThemeFont(FONT_URL, 2048);
      await flush();
      deliver(socket, { type: "theme-import.font-result", payload });
      const result = await pending;
      expect(result.ok).toBe(false);
      handle.disconnect();
    }
  });

  it("失敗理由は sidecar の固定語彙をそのまま通し、不明なら network へ倒す", async () => {
    mockBackend();
    const { handle, socket } = await connectAndOpen();

    const pending = handle.requestThemeFont(FONT_URL, 2048);
    await flush();
    deliver(socket, {
      type: "theme-import.font-result",
      payload: { requestId: 1, ok: false, reason: "rate" },
    });
    expect(await pending).toEqual({ ok: false, reason: "rate" });

    const second = handle.requestThemeFont(FONT_URL, 2048);
    await flush();
    deliver(socket, {
      type: "theme-import.font-result",
      payload: { requestId: 2, ok: false },
    });
    expect(await second).toEqual({ ok: false, reason: "network" });
    handle.disconnect();
  });

  it("⚠ §9: 取得先 URL・フォントのバイト列・チケットを console に出さない", async () => {
    mockBackend();
    const { handle, socket } = await connectAndOpen();

    const pending = handle.requestThemeFont(FONT_URL, 2048);
    await flush();
    deliver(socket, {
      type: "theme-import.font-result",
      payload: {
        requestId: 1,
        ok: true,
        mime: "font/woff2",
        base64: "d09GMgABAAAAAA==",
      },
    });
    await pending;

    const logged = consoleSpies.output.join("\n");
    expect(logged).not.toContain("gstatic.com");
    expect(logged).not.toContain("d09GMg");
    expect(logged).not.toContain(TICKET);
    handle.disconnect();
  });
});
