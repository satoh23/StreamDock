import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  act,
  waitFor,
  cleanup,
  fireEvent,
} from "@testing-library/react";
import { CommentViewerApp } from "./CommentViewerApp";
import type {
  CommentStreamHandle,
  CommentStreamHandlers,
} from "../../features/comment-viewer/commentStream";
import type { CommentViewDto } from "../../features/comment-viewer/types";
import type { StreamSessionRecord } from "../../features/stream-session/streamSessionApi";
import { SESSION_END_GRACE_MS } from "../../features/stream-session/sessionBoundary";
import { PENDING_RECORD_LIMIT } from "../../features/stream-session/pendingRecords";

/**
 * 062b: **「1 回の配信」の境界**（`stream_sessions`）と `session_id` の配線の仕様テスト。
 *
 * あるべき挙動（docs/tasks/062b）:
 * - 接続（`connected`）でセッションが始まり、全切断＋猶予（30 分）で終了する。
 * - **猶予中の再接続・コメント到着で継続**する（猶予タイマーが取り消される・045c 同型）。
 * - ⚠⚠ **窓を開き直しても同じ配信なら `session_id` が変わらない**（本タスクの主目的）。
 *   マウント時に「閉じ忘れ回収 → 進行中セッションの取得」を行い、あれば**引き継ぐ**。
 *   ⚠ マウントだけでセッションを**作らない**（窓を開いた＝配信開始、にしない）。
 * - ⚠⚠ **セッション未確定の間に届いたコメントを取りこぼさない**（確定後にまとめて記録する）。
 *   これが無いと Rust の `require_non_empty(session_id)` に弾かれ、`recordComments` の `.catch` が
 *   握り潰すので**画面には出たのに DB に無い**コメントが静かに生まれる。
 * - `recordComments` の 2 か所（`added` / `updated`）が新しい id を使い、**判定コールバックの
 *   有無（038c/043e の契約）を保つ**。
 * - 訂正 1（受容した挙動）: **窓を開き直すと常連にもう一度「初コメ」バッジが出る**
 *   （`firstOfStream` の Map はマウント単位のままで、`session_id` とは粒度が分かれた）。
 *
 * 外部境界（Tauri invoke / sidecar WS / Web Audio / ループバック fetch）は全てモックする
 *（vitest.config.ts の「外部通信も OS 操作も一切行わない」方針）。
 */

// vi.mock のファクトリは巻き上げられるため、共有スパイは vi.hoisted で先に作る。
const mocks = vi.hoisted(() => {
  const record = (
    id: string,
    platforms: string[] = ["twitch"],
  ): StreamSessionRecord => ({
    id,
    startedAt: "2026-08-16T10:00:00+00:00",
    platforms,
    title: "",
    createdAt: "2026-08-16T10:00:00+00:00",
    updatedAt: "2026-08-16T10:00:00+00:00",
  });
  return {
    record,
    handlers: { current: null as CommentStreamHandlers | null },
    recordComments: vi.fn(),
    // 062b: 配信セッション（Rust command）。本テストの検証対象。
    startStreamSession: vi.fn(async (platforms: string[]) =>
      record("session-new", platforms),
    ),
    getActiveStreamSession: vi.fn(
      async (): Promise<StreamSessionRecord | null> => null,
    ),
    updateStreamSessionPlatforms: vi.fn(
      async (id: string, platforms: string[]) => record(id, platforms),
    ),
    endStreamSession: vi.fn(async (id: string) => record(id)),
    closeStaleStreamSessions: vi.fn(async () => 0),
    stream: {
      disconnect: vi.fn(),
      startLogin: vi.fn(),
      startSession: vi.fn(),
      stopSession: vi.fn(),
      enableObs: vi.fn(),
      hideObs: vi.fn(),
      listObsSources: vi.fn(),
      fireObsSource: vi.fn(),
      disableObs: vi.fn(),
      requestThemeFont: vi.fn(async () => ({
        ok: false as const,
        reason: "offline" as const,
      })),
      requestThemeImport: vi.fn(async () => ({
        ok: false as const,
        reason: "offline" as const,
      })),
      // 066: 送信は使わないが型を満たす（⚠ 既定 OFF なのでこれらの画面からは呼ばれない）。
      sendChat: vi.fn(async () => ({ ok: false as const, reason: "offline" })),
    } satisfies CommentStreamHandle,
  };
});

/*
 * 以下のモックは各モジュールを丸ごと差し替えるため、書かなかった export は undefined になる。
 * toolbar.test.tsx と同じ方針で、現在踏まないものも含め**実モジュールの export 面を全て埋める**。
 */
vi.mock("../../features/comment-viewer/windowApi", () => ({
  isCommentOverlayOpen: vi.fn(async () => false),
  openCommentOverlayWindow: vi.fn(async () => {}),
  closeCommentOverlayWindow: vi.fn(async () => {}),
  isPinnedOverlayOpen: vi.fn(async () => false),
  openPinnedOverlayWindow: vi.fn(async () => {}),
  closePinnedOverlayWindow: vi.fn(async () => {}),
  isStageOverlayOpen: vi.fn(async () => false),
  openStageOverlayWindow: vi.fn(async () => {}),
  closeStageOverlayWindow: vi.fn(async () => {}),
  closeCommentViewerWindow: vi.fn(async () => {}),
  isCommentViewerOpen: vi.fn(async () => false),
}));

vi.mock("../../features/comment-viewer/obsApi", () => ({
  detectObsWebsocketConfig: vi.fn(async () => null),
  setObsWebsocketPassword: vi.fn(async () => {}),
  clearObsWebsocketPassword: vi.fn(async () => {}),
}));

// sidecar への単一双方向 WS。接続はせず、受け取った handlers を捕捉して直接叩く。
vi.mock("../../features/comment-viewer/commentStream", () => ({
  connectCommentStream: vi.fn((handlers) => {
    mocks.handlers.current = handlers;
    return mocks.stream;
  }),
}));

vi.mock("../../features/comment-viewer/voicevox", () => ({
  VOICEVOX_BASE: "http://127.0.0.1:50021",
  ZUNDAMON_NORMAL_SPEAKER_ID: 3,
  checkEngineRunning: vi.fn(async () => false),
  fetchSpeakers: vi.fn(async () => []),
  synthesize: vi.fn(async () => new ArrayBuffer(0)),
  playWav: vi.fn(async () => {}),
}));

vi.mock("../../features/comment-viewer/voicevoxApi", () => ({
  launchVoicevoxEngine: vi.fn(async () => ({
    supported: true,
    launched: false,
    message: "",
  })),
}));

vi.mock("../../features/comment-viewer/ttsQueue", () => ({
  sanitizeForSpeech: vi.fn((text: string) => text),
  createTtsQueue: vi.fn(() => ({
    enqueue: vi.fn(),
    resume: vi.fn(async () => {}),
    dispose: vi.fn(),
  })),
}));

vi.mock("../../features/comment-viewer/voicevoxPreview", () => ({
  createVoicevoxPreview: vi.fn(() => ({ play: vi.fn(), dispose: vi.fn() })),
}));

vi.mock("../../features/viewer-memory/viewerMemoryApi", () => ({
  recordComment: vi.fn(),
  recordComments: mocks.recordComments,
  listViewers: vi.fn(async () => []),
  getViewer: vi.fn(),
  updateViewerNote: vi.fn(async () => {}),
  deleteViewer: vi.fn(async () => {}),
  clearViewers: vi.fn(async () => {}),
}));

vi.mock("../../features/stream-session/streamSessionApi", () => ({
  startStreamSession: mocks.startStreamSession,
  getActiveStreamSession: mocks.getActiveStreamSession,
  updateStreamSessionPlatforms: mocks.updateStreamSessionPlatforms,
  endStreamSession: mocks.endStreamSession,
  updateStreamSessionTitle: vi.fn(),
  listStreamSessions: vi.fn(async () => []),
  closeStaleStreamSessions: mocks.closeStaleStreamSessions,
}));

// 062c: 配信サマリー（4 つ目のビュー）。本ファイルの関心は「サマリーを開いている間も記録が止まらないこと」
// だけなので、集計 command は呼ばれない前提でスタブする（呼ばれたら SummaryView が安全文言を出すだけ）。
vi.mock("../../features/stream-summary/streamSummaryApi", () => ({
  getStreamSummary: vi.fn(async () => {
    throw new Error("stub");
  }),
}));

vi.mock("../../features/platform/useHostOs", () => ({
  useHostOs: () => "macos",
}));

vi.mock("../../features/comment-viewer/audioOutputApi", () => ({
  listAudioOutputDevices: vi.fn(async () => []),
  playNotificationSound: vi.fn(async () => {}),
}));

const dto = (over: Partial<CommentViewDto> = {}): CommentViewDto =>
  ({
    id: "c1",
    source: "twitch",
    author: { id: "u1", name: "Alice" },
    text: "こんばんは",
    publishedAt: "2026-08-16T12:00:00Z",
    eventType: "chat",
    ...over,
  }) as CommentViewDto;

/** マウントし、sidecar WS の接続確立まで進める（マウント時の invoke も流し切る）。 */
async function renderApp() {
  const result = render(<CommentViewerApp />);
  expect(mocks.handlers.current).not.toBeNull();
  await act(async () => {
    mocks.handlers.current?.onConnectionChange?.(true);
  });
  return result;
}

/** sidecar からの session.state を再現する（実 WS は張らないので捕捉した handlers を直接叩く）。 */
async function emitSessionState(platform: "twitch" | "youtube", state: string) {
  expect(mocks.handlers.current).not.toBeNull();
  await act(async () => {
    mocks.handlers.current?.onSessionState?.(platform, state);
  });
}

/** sidecar からのコメント受信を再現する。 */
async function emitComments(comments: CommentViewDto[]) {
  expect(mocks.handlers.current).not.toBeNull();
  await act(async () => {
    mocks.handlers.current?.onComments(comments);
  });
}

/** `recordComments` に渡された session_id の一覧。 */
function recordedSessionIds(): string[] {
  return mocks.recordComments.mock.calls.map((call) => call[1] as string);
}

beforeEach(() => {
  localStorage.clear();
  mocks.handlers.current = null;
  mocks.getActiveStreamSession.mockResolvedValue(null);
  mocks.closeStaleStreamSessions.mockResolvedValue(0);
  mocks.startStreamSession.mockImplementation(async (platforms: string[]) =>
    mocks.record("session-new", platforms),
  );
  mocks.endStreamSession.mockImplementation(async (id: string) =>
    mocks.record(id),
  );
});

describe("062b セッションの開始", () => {
  it("マウントしただけではセッションを作らない（窓を開いた＝配信開始、にしない）", async () => {
    await renderApp();
    expect(mocks.startStreamSession).not.toHaveBeenCalled();
    // 代わりに「閉じ忘れ回収 → 進行中の取得」だけが走る。
    await waitFor(() =>
      expect(mocks.getActiveStreamSession).toHaveBeenCalled(),
    );
    expect(mocks.closeStaleStreamSessions).toHaveBeenCalled();
  });

  // ⚠ 猶予中に窓だけ閉じるとタイマーごと消えるので、マウント時にも回収しないと
  //   「昨日の配信」を今日の配信として引き継いでしまう。
  it("引き継ぎの前に閉じ忘れ回収を呼ぶ（順序）", async () => {
    const order: string[] = [];
    mocks.closeStaleStreamSessions.mockImplementation(async () => {
      order.push("close-stale");
      return 0;
    });
    mocks.getActiveStreamSession.mockImplementation(async () => {
      order.push("get-active");
      return null;
    });
    await renderApp();
    await waitFor(() => expect(order).toEqual(["close-stale", "get-active"]));
  });

  it("connected でセッションが始まり、その id で記録する", async () => {
    await renderApp();
    await emitSessionState("twitch", "connected");
    await waitFor(() =>
      expect(mocks.startStreamSession).toHaveBeenCalledWith(["twitch"]),
    );

    await emitComments([dto()]);
    await waitFor(() => expect(recordedSessionIds()).toContain("session-new"));
  });

  it("connected が連続で届いてもセッションは 1 つだけ作る（単一飛行）", async () => {
    await renderApp();
    await emitSessionState("twitch", "connected");
    await emitSessionState("twitch", "connected");
    await emitComments([dto()]);
    await waitFor(() =>
      expect(mocks.startStreamSession).toHaveBeenCalledTimes(1),
    );
  });

  it("YouTube も繋がると platforms を足す（セッションは増えない）", async () => {
    await renderApp();
    await emitSessionState("twitch", "connected");
    await waitFor(() => expect(mocks.startStreamSession).toHaveBeenCalledTimes(1));
    await emitSessionState("youtube", "connected");
    await waitFor(() =>
      expect(mocks.updateStreamSessionPlatforms).toHaveBeenCalledWith(
        "session-new",
        ["twitch", "youtube"],
      ),
    );
    expect(mocks.startStreamSession).toHaveBeenCalledTimes(1);
  });

  it("既に記録済みのプラットフォームでは更新を投げない", async () => {
    await renderApp();
    await emitSessionState("twitch", "connected");
    await waitFor(() => expect(mocks.startStreamSession).toHaveBeenCalled());
    await emitComments([dto()]); // twitch のコメント（増分なし）
    expect(mocks.updateStreamSessionPlatforms).not.toHaveBeenCalled();
  });
});

describe("062b セッションの終了と猶予", () => {
  it("全切断から猶予経過でセッションを終了する", async () => {
    vi.useFakeTimers();
    try {
      await renderApp();
      await emitSessionState("twitch", "connected");
      await act(async () => {});
      await emitSessionState("twitch", "idle");

      // 猶予の直前では終了しない。
      await act(() => vi.advanceTimersByTimeAsync(SESSION_END_GRACE_MS - 1000));
      expect(mocks.endStreamSession).not.toHaveBeenCalled();

      await act(() => vi.advanceTimersByTimeAsync(2000));
      expect(mocks.endStreamSession).toHaveBeenCalledWith("session-new");
    } finally {
      vi.useRealTimers();
    }
  });

  // ⚠⚠ 045c 同型: 猶予タイマーの**取り消し漏れ**が実際に回帰を作った。
  it("猶予中に再接続するとセッションは継続する（タイマーが取り消される）", async () => {
    vi.useFakeTimers();
    try {
      await renderApp();
      await emitSessionState("twitch", "connected");
      await act(async () => {});
      await emitSessionState("twitch", "idle");
      await act(() => vi.advanceTimersByTimeAsync(SESSION_END_GRACE_MS / 2));
      await emitSessionState("twitch", "connected");

      await act(() => vi.advanceTimersByTimeAsync(SESSION_END_GRACE_MS * 2));
      expect(mocks.endStreamSession).not.toHaveBeenCalled();
      // 同じセッションのまま（開始は 1 回だけ）。
      expect(mocks.startStreamSession).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  // ⚠⚠ 穴 A の三重目の防波堤: sidecar が「嘘の idle」を送ってきても、コメントが流れていれば終了しない。
  it("猶予中にコメントが届くとセッションは継続する（コメント＝配信が生きている証拠）", async () => {
    vi.useFakeTimers();
    try {
      await renderApp();
      await emitSessionState("twitch", "connected");
      await act(async () => {});
      await emitSessionState("twitch", "idle");
      await act(() => vi.advanceTimersByTimeAsync(SESSION_END_GRACE_MS / 2));
      await emitComments([dto({ id: "during-grace" })]);

      await act(() => vi.advanceTimersByTimeAsync(SESSION_END_GRACE_MS * 2));
      expect(mocks.endStreamSession).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  // ⚠ 穴 K: `failed` は「接続中」ではない＝猶予は動き出す（復帰は猶予内の再接続で拾う）。
  it("failed は未接続として扱う（猶予が動き出す）", async () => {
    vi.useFakeTimers();
    try {
      await renderApp();
      await emitSessionState("twitch", "connected");
      await act(async () => {});
      await emitSessionState("twitch", "failed");
      await act(() => vi.advanceTimersByTimeAsync(SESSION_END_GRACE_MS + 1000));
      expect(mocks.endStreamSession).toHaveBeenCalledWith("session-new");
    } finally {
      vi.useRealTimers();
    }
  });

  it("片方が切れてももう片方が繋がっていれば終了へ向かわない", async () => {
    vi.useFakeTimers();
    try {
      await renderApp();
      await emitSessionState("twitch", "connected");
      await emitSessionState("youtube", "connected");
      await act(async () => {});
      await emitSessionState("twitch", "idle");
      await act(() => vi.advanceTimersByTimeAsync(SESSION_END_GRACE_MS * 2));
      expect(mocks.endStreamSession).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("セッションが無い状態で切断が届いても何もしない", async () => {
    vi.useFakeTimers();
    try {
      await renderApp();
      await emitSessionState("twitch", "idle");
      await act(() => vi.advanceTimersByTimeAsync(SESSION_END_GRACE_MS * 2));
      expect(mocks.endStreamSession).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  // ⚠ 窓を閉じても配信は続いている＝セッションは開いたままにする（回収は Rust 側）。
  it("アンマウントではセッションを終了しない（猶予タイマーは止める）", async () => {
    vi.useFakeTimers();
    try {
      await renderApp();
      await emitSessionState("twitch", "connected");
      await act(async () => {});
      await emitSessionState("twitch", "idle");
      cleanup();
      await act(() => vi.advanceTimersByTimeAsync(SESSION_END_GRACE_MS * 2));
      expect(mocks.endStreamSession).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("062b 窓を開き直しても同じ配信（本タスクの主目的）", () => {
  it("進行中セッションがあれば引き継ぎ、その id で記録する（新規に採番しない）", async () => {
    mocks.getActiveStreamSession.mockResolvedValue(
      mocks.record("session-running", ["twitch", "youtube"]),
    );
    await renderApp();
    await waitFor(() =>
      expect(mocks.getActiveStreamSession).toHaveBeenCalled(),
    );
    expect(mocks.startStreamSession).not.toHaveBeenCalled();

    await emitComments([dto()]);
    await waitFor(() =>
      expect(recordedSessionIds()).toContain("session-running"),
    );
  });

  it("引き継いだセッションのプラットフォームも引き継ぐ（無駄な更新を投げない）", async () => {
    mocks.getActiveStreamSession.mockResolvedValue(
      mocks.record("session-running", ["twitch"]),
    );
    await renderApp();
    await waitFor(() => expect(mocks.getActiveStreamSession).toHaveBeenCalled());
    await emitSessionState("twitch", "connected");
    await act(async () => {});
    expect(mocks.updateStreamSessionPlatforms).not.toHaveBeenCalled();
  });

  it("窓を開き直しても session_id が変わらない（実際に 2 回マウントする）", async () => {
    // 1 回目: 接続してセッションが始まる。
    await renderApp();
    await emitSessionState("twitch", "connected");
    await waitFor(() => expect(mocks.startStreamSession).toHaveBeenCalled());
    await emitComments([dto({ id: "before" })]);
    await waitFor(() => expect(recordedSessionIds()).toContain("session-new"));

    // 窓を閉じる。⚠ Rust 側のセッションは開いたまま（回収は猶予後）。
    cleanup();
    mocks.handlers.current = null;
    mocks.recordComments.mockClear();
    // 2 回目のマウントでは Rust が同じ進行中セッションを返す。
    mocks.getActiveStreamSession.mockResolvedValue(mocks.record("session-new"));

    await renderApp();
    await emitComments([dto({ id: "after" })]);
    await waitFor(() => expect(recordedSessionIds()).toEqual(["session-new"]));
    // 2 回目のマウントで新しいセッションを作っていない。
    expect(mocks.startStreamSession).toHaveBeenCalledTimes(1);
  });

  // ⚠ 訂正 1（受容した挙動）: `firstOfStream` の Map はマウント単位のままなので、
  //   同じ配信の途中で窓を開き直すと**既に喋っていた人にもう一度「初コメ」バッジが出る**。
  //   記録（session_id）には影響しないこと（上のケース）とセットで固定する。
  it("訂正 1: 窓を開き直すと「初コメ」バッジは出直す（記録は同じセッションのまま）", async () => {
    await renderApp();
    await emitSessionState("twitch", "connected");
    await emitComments([dto({ id: "c1" })]);
    expect(screen.getAllByText("初コメ")).toHaveLength(1);
    // 同じ視聴者の 2 通目にはバッジが付かない（同一マウント中は上書きしない）。
    await emitComments([dto({ id: "c2", text: "またきた" })]);
    expect(screen.getAllByText("初コメ")).toHaveLength(1);

    cleanup();
    mocks.handlers.current = null;
    mocks.getActiveStreamSession.mockResolvedValue(mocks.record("session-new"));

    await renderApp();
    await emitComments([dto({ id: "c3", text: "ただいま" })]);
    // ⚠ 同じ配信・同じ視聴者だが、Map はマウントで初期化されるので再び「初コメ」が出る。
    expect(screen.getAllByText("初コメ")).toHaveLength(1);
  });
});

describe("062b セッション未確定の間の記録（取りこぼさない）", () => {
  // ⚠⚠ 穴 B: これが無いと Rust の Validation に弾かれ、`.catch` に握られて**静かに消える**。
  it("セッション確定前に届いたコメントを、確定後に記録する", async () => {
    let resolveActive: (value: StreamSessionRecord | null) => void = () => {};
    mocks.getActiveStreamSession.mockImplementation(
      () =>
        new Promise<StreamSessionRecord | null>((resolve) => {
          resolveActive = resolve;
        }),
    );

    await renderApp();
    // まだセッションは確定していない。
    await emitComments([dto({ id: "early" })]);
    expect(mocks.recordComments).not.toHaveBeenCalled();
    // 表示は止まっていない（記録だけが遅れる）。
    expect(screen.getByText("こんばんは")).toBeInTheDocument();

    await act(async () => {
      resolveActive(mocks.record("session-running"));
    });

    await waitFor(() => expect(mocks.recordComments).toHaveBeenCalledTimes(1));
    const [comments, sessionId] = mocks.recordComments.mock.calls[0];
    expect((comments as CommentViewDto[]).map((c) => c.id)).toEqual(["early"]);
    expect(sessionId).toBe("session-running");
  });

  it("貯めた順に流し、added だけに判定コールバックを渡す（038c/043e の契約）", async () => {
    let resolveActive: (value: StreamSessionRecord | null) => void = () => {};
    mocks.getActiveStreamSession.mockImplementation(
      () =>
        new Promise<StreamSessionRecord | null>((resolve) => {
          resolveActive = resolve;
        }),
    );

    await renderApp();
    // 1 通目（新規＝added）と、同一 id の combo 更新（＝updated）。
    await emitComments([
      dto({
        id: "g1",
        source: "youtube",
        eventType: "jewels",
        text: "",
        monetaryAmount: "30 JEWELS",
        monetary: { amount: 30, currency: "JEWELS" },
      }),
    ]);
    await emitComments([
      dto({
        id: "g1",
        source: "youtube",
        eventType: "jewels",
        text: "",
        monetaryAmount: "90 JEWELS",
        monetary: { amount: 90, currency: "JEWELS" },
        comboCount: 3,
      }),
    ]);
    expect(mocks.recordComments).not.toHaveBeenCalled();

    await act(async () => {
      resolveActive(mocks.record("session-running"));
    });

    await waitFor(() => expect(mocks.recordComments).toHaveBeenCalledTimes(2));
    // added（1 本目）には判定コールバックが渡り、updated（2 本目）には渡らない。
    expect(mocks.recordComments.mock.calls[0][2]).toBeTypeOf("function");
    expect(mocks.recordComments.mock.calls[1][2]).toBeUndefined();
  });

  // ⚠ 上限超過は「黙って捨てない」（記録できなかったことがユーザーに見える）。
  it("上限を超えたぶんは捨てるが、件数を画面に出す", async () => {
    mocks.getActiveStreamSession.mockImplementation(
      () => new Promise<StreamSessionRecord | null>(() => {}), // 永久に未確定
    );
    await renderApp();
    await emitComments(
      Array.from({ length: PENDING_RECORD_LIMIT + 5 }, (_, i) =>
        dto({ id: `c${i}`, author: { id: `u${i}`, name: `Viewer${i}` } }),
      ),
    );
    expect(
      await screen.findByText("記録できなかったコメント 5 件"),
    ).toBeInTheDocument();
  });

  it("取りこぼしが無ければ警告は出ない", async () => {
    await renderApp();
    await emitSessionState("twitch", "connected");
    await emitComments([dto()]);
    await waitFor(() => expect(mocks.recordComments).toHaveBeenCalled());
    expect(screen.queryByText(/記録できなかったコメント/)).toBeNull();
  });
});

/**
 * 062c 穴 H: **サマリービューを開いている間もコメントの受信・記録が止まらない**こと。
 *
 * ⚠⚠ 062c で増える他の担保（数字・注記・並び順）は**あとから作り直せる**が、ここだけは違う——
 * 記録は遡れないので、サマリーを見ている間の課金が記録されないと**その配信ぶんは永久に失われる**。
 * 構造上は `connectCommentStream` の effect が `view` に依存していないため止まらないが、それは
 * 「今そうである」だけなので固定する。
 */
describe("062c サマリーを開いている間の記録（穴 H）", () => {
  it("サマリーを開いたまま届いたコメントも記録される", async () => {
    await renderApp();
    await emitSessionState("twitch", "connected");
    await waitFor(() => expect(mocks.startStreamSession).toHaveBeenCalled());
    await emitComments([dto({ id: "before" })]);
    await waitFor(() => expect(mocks.recordComments).toHaveBeenCalledTimes(1));

    // 配信サマリーへ切り替える（本体のコメント一覧は分岐ごとアンマウントされる）。
    await act(async () => {
      fireEvent.click(screen.getByLabelText("配信サマリー"));
    });
    expect(screen.getByText("配信サマリー")).toBeInTheDocument();
    expect(screen.queryByText("こんばんは")).toBeNull();

    // ⚠ その間に届いたコメントも、同じ session_id で記録される。
    await emitComments([
      dto({ id: "during", author: { id: "u2", name: "Bob" } }),
    ]);
    await waitFor(() => expect(mocks.recordComments).toHaveBeenCalledTimes(2));
    expect(recordedSessionIds()).toEqual(["session-new", "session-new"]);

    // 戻ると、その間のコメントも一覧に並ぶ（state は CommentViewerApp が保持している）。
    await act(async () => {
      fireEvent.click(screen.getByLabelText("コメントへ戻る"));
    });
    expect(screen.getAllByText("こんばんは").length).toBeGreaterThanOrEqual(2);
  });

  // ⚠ ビュー切替で WS を張り直すと、張り直している間のコメントを落とす（窓内 WS 1 本の原則）。
  it("サマリーへ切り替えても sidecar WS を張り直さない", async () => {
    await renderApp();
    expect(mocks.stream.disconnect).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByLabelText("配信サマリー"));
    });

    expect(mocks.stream.disconnect).not.toHaveBeenCalled();
  });

  // 猶予タイマー（配信の区切り）もビュー切替では動かない。
  it("サマリーを開いてもセッションを終了しない", async () => {
    await renderApp();
    await emitSessionState("twitch", "connected");
    await waitFor(() => expect(mocks.startStreamSession).toHaveBeenCalled());

    await act(async () => {
      fireEvent.click(screen.getByLabelText("配信サマリー"));
    });

    expect(mocks.endStreamSession).not.toHaveBeenCalled();
  });

  /**
   * ⚠⚠⚠ **security-review 066 S-2b で足した 1 本（この経路はここでしか固定できない）。**
   *
   * `ChatSendCard.test.tsx` は `channel` を prop で直接受け取るので、
   * **「画面に出している送信先」と「sidecar へ送る期待値」が同じ値か**を検証できない。
   * ⚠⚠ S-2b の穴はまさにその配線にあった——出していたのは frontend 自身の入力値で、
   * **未認証の loopback WS から `start-session` で宛先を差し替えられても表示は変わらない**。
   * ⇒ いまは同じ値を `sendChat` の第 2 引数として渡し、sidecar が突き合わせている。
   * ⚠ **この 1 本が落ちたら「差し替えに気づけない」状態に戻ったということ**である。
   */
  it("⚠⚠⚠ 066 S-2b: テスト送信は「画面に出している送信先」を期待値として渡す", async () => {
    // ⚠ ユーザーが打ったチャンネル名（前後の空白は落として扱う）。入力欄は接続ピルの
    //   ポップオーバーの中なので、ここは**保存値から復元させる**（起動時と同じ `loadChannel()` 経路）。
    localStorage.setItem("stream-dock.comment-viewer.channel", "  MyChannel  ");
    await renderApp();

    fireEvent.click(screen.getByLabelText("設定"));
    // ⚠⚠ 既定 OFF なので、まず明示的に有効化しないと押せない（同意）。
    fireEvent.click(
      screen.getByLabelText("チャットへの書き込みを許可する", { exact: false }),
    );

    // ⚠ 画面に出ている送信先。
    expect(screen.getByText("送信先: MyChannel")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "テスト送信" }));
    });

    // ⚠⚠⚠ **表示と同じ値が期待値として渡ること**——ここがずれると突き合わせの意味が消える。
    expect(mocks.stream.sendChat).toHaveBeenCalledWith(
      expect.any(String),
      "MyChannel",
    );
  });
});
