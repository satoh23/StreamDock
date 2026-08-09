import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act, waitFor } from "@testing-library/react";
import { CommentViewerApp } from "./CommentViewerApp";
import {
  EFFECT_OVERLAY_ENABLED_KEY,
  EFFECT_OBS_AUTO_ADD_KEY,
  OBS_AUTO_ADD_KEY,
} from "../../features/comment-viewer/overlaySettings";
import type {
  CommentStreamHandle,
  CommentStreamHandlers,
} from "../../features/comment-viewer/commentStream";

/**
 * 061a: **エフェクト窓の OBS 自動反映をコメビュ窓が代行する**配線の仕様テスト。
 *
 * ⚠⚠ **なぜこの配線が要るのか**（061a 実装で判明した構造上の制約）:
 * `obs-effects` 画面は main 窓にあるが、`obs-enable` を送れる WS ハンドルを持つのはコメビュ窓だけで、
 * sidecar のライフサイクルもコメビュ窓に紐づいている。よって
 *   - main 窓（`ObsEffectsScreen`）＝ **localStorage に設定を書くだけ**（045c の「設定を立てるだけ」）
 *   - コメビュ窓（ここ）＝ **保証ベースライン（マウント時 reconcile）＋ 即時反映（`storage` 購読）**
 * という 046b と同じ二段構えになっている。
 *
 * 固定する仕様（045c の 4 点をエフェクト種別へ適用したもの）:
 * - 反映の契機は**表示 ON**（`EFFECT_OVERLAY_ENABLED_KEY` が true になったとき）。猶予を経て `enableObs`。
 * - 表示 OFF で `hideObs("effects")`＋`obsState` を idle へ。
 * - ⚠ **猶予タイマーは必ず取り消す**（表示 OFF・自動反映 OFF・アンマウントのすべてで）。
 * - ⚠ **`disableObs()` を呼ばない**（kind を取らないので comments / pinned を巻き添えにする）。
 * - ⚠ **エフェクトの自動反映は専用キー**で、既存の `OBS_AUTO_ADD_KEY` とは独立に効く。
 * - ⚠ **実窓が無ければ送らない**（046d レビュー＝OBS に空ソースが残るため）。
 *
 * ハーネスは `CommentViewerApp.toolbar.test.tsx` と同型（マウント時に走る外部境界を全てモックして隔離する。
 * **テストは外部通信も OS 操作も一切行わない**）。localStorage は実物（jsdom）。
 *
 * ⚠ 061a レビュー（Q-10・修正不要）: `CommentViewerApp` をマウントするテストはこれで 4 本目
 *（toolbar / audio / notificationSound / effects）で、下の `vi.mock` ブロックは互いに大きく重複している。
 * それでも共有ファイルへ切り出さないのは、**モックは「この観点で何を隔離したか」を宣言する仕様書**でもあり、
 * 1 本に寄せると 4 本が同じ都合に縛られて、片方の都合で他方の隔離条件が黙って変わるから
 *（例: audio 側の理由で `voicevox` のモックを変えると effects のケースが巻き添えになる）。
 * ⚠ **共有するなら `vi.mock` の羅列ではなく `importOriginal` 方式**にすること
 *（`App.window.test.tsx` が使っている形。書き漏らした export が undefined になる事故自体が消える）。
 * **再修正トリガー**＝5 本目を足すとき、または「実 export 面の書き漏らし」で実際に事故ったとき。
 */

const mocks = vi.hoisted(() => ({
  isCommentOverlayOpen: vi.fn(),
  openCommentOverlayWindow: vi.fn(),
  closeCommentOverlayWindow: vi.fn(),
  isPinnedOverlayOpen: vi.fn(),
  openPinnedOverlayWindow: vi.fn(),
  closePinnedOverlayWindow: vi.fn(),
  // 061a: この窓が使うのは**実窓の存在確認だけ**（open/close は main 窓が持つ）。
  isEffectOverlayOpen: vi.fn(),
  handlers: { current: null as CommentStreamHandlers | null },
  recordComments: vi.fn(),
  stream: {
    disconnect: vi.fn(),
    startLogin: vi.fn(),
    startSession: vi.fn(),
    stopSession: vi.fn(),
    enableObs: vi.fn(),
    hideObs: vi.fn(),
    disableObs: vi.fn(),
    requestThemeFont: vi.fn(() =>
      Promise.resolve({ ok: false as const, reason: "offline" }),
    ),
    requestThemeImport: vi.fn(async () => ({
      ok: false as const,
      reason: "offline",
    })),
  } satisfies CommentStreamHandle,
}));

// ⚠ モジュールを丸ごと差し替えるので、実モジュールの export 面を全て埋める（toolbar テストと同じ方針）。
// ⚠ `isEffectOverlayOpen` を書き漏らすと、061a のエフェクト連携 effect が
// 「undefined is not a function」で落ちて全ケースがレッドになる。
vi.mock("../../features/comment-viewer/windowApi", () => ({
  isCommentOverlayOpen: mocks.isCommentOverlayOpen,
  openCommentOverlayWindow: mocks.openCommentOverlayWindow,
  closeCommentOverlayWindow: mocks.closeCommentOverlayWindow,
  isPinnedOverlayOpen: mocks.isPinnedOverlayOpen,
  openPinnedOverlayWindow: mocks.openPinnedOverlayWindow,
  closePinnedOverlayWindow: mocks.closePinnedOverlayWindow,
  isEffectOverlayOpen: mocks.isEffectOverlayOpen,
  openEffectOverlayWindow: vi.fn(async () => {}),
  closeEffectOverlayWindow: vi.fn(async () => {}),
  openCommentViewerWindow: vi.fn(async () => {}),
  closeCommentViewerWindow: vi.fn(async () => {}),
  isCommentViewerOpen: vi.fn(async () => false),
}));

vi.mock("../../features/comment-viewer/obsApi", () => ({
  detectObsWebsocketConfig: vi.fn(async () => null),
  setObsWebsocketPassword: vi.fn(async () => {}),
  clearObsWebsocketPassword: vi.fn(async () => {}),
}));

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

vi.mock("../../features/platform/useHostOs", () => ({
  useHostOs: () => "macos",
}));

vi.mock("../../features/comment-viewer/audioOutputApi", () => ({
  listAudioOutputDevices: vi.fn(async () => []),
  playNotificationSound: vi.fn(async () => {}),
}));

/**
 * main 窓（`ObsEffectsScreen`）が設定を書き換えたことを再現する。
 *
 * ⚠ jsdom では **同一 window の `localStorage.setItem` は `storage` イベントを発火しない**
 * （実機でも「自窓の書換では発火しない」＝仕様どおり）。実際の書き手は別 webview（main 窓）なので、
 * ここでは値を書いたうえで `storage` イベントを手で送る＝**実機と同じ順序**を再現している。
 */
function emitSettingChange(key: string, value: string) {
  localStorage.setItem(key, value);
  act(() => {
    window.dispatchEvent(
      new StorageEvent("storage", { key, newValue: value }),
    );
  });
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  mocks.isCommentOverlayOpen.mockResolvedValue(false);
  mocks.openCommentOverlayWindow.mockResolvedValue(undefined);
  mocks.closeCommentOverlayWindow.mockResolvedValue(undefined);
  mocks.isPinnedOverlayOpen.mockResolvedValue(false);
  mocks.openPinnedOverlayWindow.mockResolvedValue(undefined);
  mocks.closePinnedOverlayWindow.mockResolvedValue(undefined);
  mocks.isEffectOverlayOpen.mockResolvedValue(false);
  mocks.handlers.current = null;
});

describe("061a エフェクト窓の OBS 自動反映（コメビュ窓が代行する）", () => {
  it("保証ベースライン: マウント時に「設定 ON ＋ 実窓あり」なら即反映する", async () => {
    localStorage.setItem(EFFECT_OVERLAY_ENABLED_KEY, "true");
    localStorage.setItem(EFFECT_OBS_AUTO_ADD_KEY, "true");
    mocks.isEffectOverlayOpen.mockResolvedValue(true);

    render(<CommentViewerApp />);

    // ⚠ 猶予は挟まない（窓は既に開いていて OBS のウィンドウ一覧に載っているはず）。
    await waitFor(() =>
      expect(mocks.stream.enableObs).toHaveBeenCalledWith(4455, "effects"),
    );
  });

  it("⚠ 実窓が無ければマウント時に送らない（OBS に空ソースを残さない・046d レビュー）", async () => {
    localStorage.setItem(EFFECT_OVERLAY_ENABLED_KEY, "true");
    localStorage.setItem(EFFECT_OBS_AUTO_ADD_KEY, "true");
    mocks.isEffectOverlayOpen.mockResolvedValue(false);

    render(<CommentViewerApp />);
    await act(async () => {});

    expect(mocks.stream.enableObs).not.toHaveBeenCalled();
  });

  it("自動反映 OFF ならマウント時に送らない（明示的に有効化した時のみ接続・§1）", async () => {
    localStorage.setItem(EFFECT_OVERLAY_ENABLED_KEY, "true");
    mocks.isEffectOverlayOpen.mockResolvedValue(true);

    render(<CommentViewerApp />);
    await act(async () => {});

    expect(mocks.stream.enableObs).not.toHaveBeenCalled();
  });

  it("即時反映: 表示 ON の書換を storage で受けると、猶予後に enableObs が飛ぶ", async () => {
    vi.useFakeTimers();
    try {
      localStorage.setItem(EFFECT_OBS_AUTO_ADD_KEY, "true");
      render(<CommentViewerApp />);
      await act(async () => {});

      emitSettingChange(EFFECT_OVERLAY_ENABLED_KEY, "true");
      // 猶予（OBS_ENABLE_DELAY_MS）を経由する＝同期では飛ばない。
      // ⚠ 固定しているのは猶予の**長さ**ではなく「タイマー（マクロタスク）を経由する」という一点
      //（既存 045c のケースと同じ粒度）。
      expect(mocks.stream.enableObs).not.toHaveBeenCalled();

      await act(() => vi.advanceTimersByTimeAsync(10_000));
      expect(mocks.stream.enableObs).toHaveBeenCalledWith(4455, "effects");
      // 二重発火するミューテーションを素通りさせないよう回数も固定する。
      expect(mocks.stream.enableObs).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("⚠ 猶予中に表示 OFF にすると enableObs は飛ばず、hideObs だけが飛ぶ", async () => {
    vi.useFakeTimers();
    try {
      localStorage.setItem(EFFECT_OBS_AUTO_ADD_KEY, "true");
      render(<CommentViewerApp />);
      await act(async () => {});

      emitSettingChange(EFFECT_OVERLAY_ENABLED_KEY, "true"); // 猶予が仕掛かる
      emitSettingChange(EFFECT_OVERLAY_ENABLED_KEY, "false"); // 経過前に OFF

      expect(mocks.stream.hideObs).toHaveBeenCalledWith(4455, "effects");

      await act(() => vi.advanceTimersByTimeAsync(10_000));
      // ⚠ ここが 045c が踏んだ回帰そのもの。hideObs の**後に** enableObs が飛ぶと、
      // OBS 側で「表示 OFF にしたはずのソース」が再表示される。
      expect(mocks.stream.enableObs).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("⚠ 猶予中に自動反映 OFF にしても enableObs は飛ばない", async () => {
    vi.useFakeTimers();
    try {
      localStorage.setItem(EFFECT_OBS_AUTO_ADD_KEY, "true");
      render(<CommentViewerApp />);
      await act(async () => {});

      emitSettingChange(EFFECT_OVERLAY_ENABLED_KEY, "true"); // 猶予が仕掛かる
      emitSettingChange(EFFECT_OBS_AUTO_ADD_KEY, "false"); // 経過前に連携 OFF

      await act(() => vi.advanceTimersByTimeAsync(10_000));
      expect(mocks.stream.enableObs).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("⚠ アンマウントで猶予タイマーが取り消される（破棄済みツリーへ発火させない）", async () => {
    vi.useFakeTimers();
    try {
      localStorage.setItem(EFFECT_OBS_AUTO_ADD_KEY, "true");
      const { unmount } = render(<CommentViewerApp />);
      await act(async () => {});

      emitSettingChange(EFFECT_OVERLAY_ENABLED_KEY, "true"); // 猶予が仕掛かる
      unmount();

      await act(() => vi.advanceTimersByTimeAsync(10_000));
      expect(mocks.stream.enableObs).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("⚠ エフェクトの表示 OFF で disableObs を呼ばない（他 2 種の連携を巻き添えにしない）", async () => {
    localStorage.setItem(EFFECT_OBS_AUTO_ADD_KEY, "true");
    localStorage.setItem(EFFECT_OVERLAY_ENABLED_KEY, "true");
    mocks.isEffectOverlayOpen.mockResolvedValue(true);
    render(<CommentViewerApp />);
    await act(async () => {});

    emitSettingChange(EFFECT_OVERLAY_ENABLED_KEY, "false");

    expect(mocks.stream.hideObs).toHaveBeenCalledWith(4455, "effects");
    // `disableObs` は kind を取らず sidecar の状態を丸ごと idle にするので、ここでは使わない。
    expect(mocks.stream.disableObs).not.toHaveBeenCalled();
  });

  it("⚠ 自動反映 OFF のときは表示 ON/OFF で OBS へ一切繋がない", async () => {
    vi.useFakeTimers();
    try {
      render(<CommentViewerApp />);
      await act(async () => {});

      emitSettingChange(EFFECT_OVERLAY_ENABLED_KEY, "true");
      await act(() => vi.advanceTimersByTimeAsync(10_000));
      emitSettingChange(EFFECT_OVERLAY_ENABLED_KEY, "false");

      expect(mocks.stream.enableObs).not.toHaveBeenCalled();
      expect(mocks.stream.hideObs).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("⚠ エフェクトの自動反映は専用キー（既存の OBS_AUTO_ADD_KEY では動かない）", async () => {
    vi.useFakeTimers();
    try {
      // 既存キーだけを ON にしても、エフェクト側は反応しない＝2 つの設定が独立していることの担保。
      localStorage.setItem(OBS_AUTO_ADD_KEY, "true");
      render(<CommentViewerApp />);
      await act(async () => {});

      emitSettingChange(EFFECT_OVERLAY_ENABLED_KEY, "true");
      await act(() => vi.advanceTimersByTimeAsync(10_000));

      expect(mocks.stream.enableObs).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("⚠ 設定ごと消えたとき（localStorage.clear）は仕掛かりを取り消し、OBS へは何も送らない", async () => {
    // 061a レビュー（Q-4）で「修正不要」と判断した挙動を、**仕様として固定**する。
    // `clear()` は `e.key === null` で来る。このとき自動反映キーも消えているので、
    // ①猶予中の enableObs は**必ず取り消す**（ユーザーの意図が消えたのに OBS を触りに行かない）
    // ②`hideObs` も送らない（送り先の意図ごと消えている操作で OBS を触る方が筋が悪い。
    //   OBS 側のソースはユーザーが消せるし、次の表示 ON で整合する）
    vi.useFakeTimers();
    try {
      localStorage.setItem(EFFECT_OBS_AUTO_ADD_KEY, "true");
      render(<CommentViewerApp />);
      await act(async () => {});

      emitSettingChange(EFFECT_OVERLAY_ENABLED_KEY, "true"); // 猶予が仕掛かる

      localStorage.clear();
      act(() => {
        window.dispatchEvent(new StorageEvent("storage", { key: null }));
      });

      await act(() => vi.advanceTimersByTimeAsync(10_000));
      expect(mocks.stream.enableObs).not.toHaveBeenCalled();
      expect(mocks.stream.hideObs).not.toHaveBeenCalled();
      // ⚠ 他 2 種別の連携を巻き添えにしないのは通常経路と同じ。
      expect(mocks.stream.disableObs).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("⚠ エフェクト以外のキーの storage では何もしない（他機能の書換に反応しない）", async () => {
    vi.useFakeTimers();
    try {
      localStorage.setItem(EFFECT_OBS_AUTO_ADD_KEY, "true");
      localStorage.setItem(EFFECT_OVERLAY_ENABLED_KEY, "true");
      mocks.isEffectOverlayOpen.mockResolvedValue(true);
      render(<CommentViewerApp />);
      await act(async () => {});
      mocks.stream.enableObs.mockClear();

      // 既存キー（コメント一覧・固定コメント用）の書換では、エフェクトの反映は動かない。
      emitSettingChange(OBS_AUTO_ADD_KEY, "false");
      await act(() => vi.advanceTimersByTimeAsync(10_000));

      expect(mocks.stream.enableObs).not.toHaveBeenCalled();
      expect(mocks.stream.hideObs).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("自動反映を後から ON にすると、既に表示中なら即反映する（猶予なし）", async () => {
    localStorage.setItem(EFFECT_OVERLAY_ENABLED_KEY, "true");
    mocks.isEffectOverlayOpen.mockResolvedValue(true);
    render(<CommentViewerApp />);
    await act(async () => {});
    expect(mocks.stream.enableObs).not.toHaveBeenCalled();

    emitSettingChange(EFFECT_OBS_AUTO_ADD_KEY, "true");

    await waitFor(() =>
      expect(mocks.stream.enableObs).toHaveBeenCalledWith(4455, "effects"),
    );
  });
});
