import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act, fireEvent, screen, waitFor } from "@testing-library/react";
import { CommentViewerApp } from "./CommentViewerApp";
import {
  EFFECT_OVERLAY_ENABLED_KEY,
  STAGE_OVERLAY_ENABLED_KEY,
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
 *   - コメビュ窓（ここ）＝ **保証ベースライン（reconcile）＋ 即時反映（`storage` 購読）**
 * という 046b と同じ二段構えになっている。
 * ⚠⚠ **061e(5): 保証ベースラインの契機は「マウント時」から「WS 接続確立時」へ移った**（実機で発見した
 * Bug-1）。マウント時点では WS がまだ OPEN でなく `send` が黙って捨てるので、保証になっていなかった。
 * ＝ このファイルのケースは原則 `emitConnected()` で接続を再現してから反映を期待する。
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
  // 061k: ステージ窓ぶん（**独立に**判定されることを見る）。
  isStageOverlayOpen: vi.fn(),
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
  isStageOverlayOpen: mocks.isStageOverlayOpen,
  openStageOverlayWindow: vi.fn(async () => {}),
  closeStageOverlayWindow: vi.fn(async () => {}),
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

/**
 * 061e: sidecar からの `obs.state` 通知を再現する（実 WS は張らないので捕捉した handlers を直接叩く）。
 * ⚠ `?.` は捕捉が壊れても黙って no-op になり、「何も出ない」を見る否定ケースが**通知が届いていないから通る**
 * （vacuous）状態になりうるため、捕捉の生存をここで明示的に落とす（toolbar テストと同じ作法）。
 */
function emitObsState(state: string) {
  expect(mocks.handlers.current).not.toBeNull();
  act(() => mocks.handlers.current?.onObsState?.(state));
}

/**
 * ⚠⚠ 061e(5): **sidecar WS の接続確立**を再現する（実 WS は張らないので捕捉した handlers を直接叩く）。
 * 実機ではこれを呼ぶのは `commentStream.ts` の `socket.onopen`。
 *
 * ⚠⚠ **これが要るようになったのは実機で見つかった Bug-1 の修正から。** 061a は保証ベースラインの reconcile を
 * **マウント時**に走らせていたが、その時点で WS はまだ OPEN でなく `send` は**黙って捨てる**ので、
 * `enableObs` は誰にも届かないのに `obsState` だけ `connecting` になって**固着**していた。
 * 061e(5) で契機を「WS 接続確立」へ移し、`requestObsAutoAdd` の未接続判定も「WS が OPEN か」に直した。
 * ＝ **テストを通すための追加ではなく、実機の順序（マウント直後はまだ繋がっていない）の再現**である
 *（`emitSettingChange` が「別窓の書換 → storage」の順序を再現しているのと同じ作法）。
 * ⚠ 旧テストがこれ無しで緑だったことが、まさに Bug-1 を見逃した理由なので、**省略しないこと**。
 */
function emitConnected() {
  expect(mocks.handlers.current).not.toBeNull();
  act(() => mocks.handlers.current?.onConnectionChange?.(true));
}

/** 061e: ツールバーの OBS 失敗表示（赤字）。文言は 059b の判断で種別によらず固定。 */
const OBS_ERROR_TEXT = "OBSに接続できませんでした";

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
  mocks.isStageOverlayOpen.mockResolvedValue(false);
  mocks.handlers.current = null;
});

describe("061a エフェクト窓の OBS 自動反映（コメビュ窓が代行する）", () => {
  it("保証ベースライン: WS 接続確立時に「設定 ON ＋ 実窓あり」なら即反映する", async () => {
    // ⚠⚠ 061e(5): 旧題は「**マウント時**に…」だった。実機（Bug-1）で、マウント時点では WS がまだ
    // OPEN でなく `send` に捨てられることが判明したので、契機を接続確立へ移した。
    localStorage.setItem(EFFECT_OVERLAY_ENABLED_KEY, "true");
    localStorage.setItem(EFFECT_OBS_AUTO_ADD_KEY, "true");
    mocks.isEffectOverlayOpen.mockResolvedValue(true);

    render(<CommentViewerApp />);
    emitConnected();

    // ⚠ 猶予は挟まない（窓は既に開いていて OBS のウィンドウ一覧に載っているはず）。
    await waitFor(() =>
      expect(mocks.stream.enableObs).toHaveBeenCalledWith(4455, "effects"),
    );
  });

  it("⚠⚠ B1 (Bug-1): WS が繋がるまでは反映を送らない（捨てられる送信をしない・connecting 固着を作らない）", async () => {
    // ⚠⚠ **実機で見つかった Bug-1 の本体**。061a はマウント時に reconcile していたが、その時点で
    // sidecar WS はまだ OPEN でなく、`commentStream.ts` の `send` は **OPEN 以外を黙って捨てる**。
    // ＝ `enableObs` は誰にも届かないのに `requestObsAutoAdd` が `setObsState("connecting")` を立てるので、
    // **`obsState` が `connecting` のまま永久に固着**していた（実機で 2 回再現）。
    // ツールバーの赤字は failed のときだけ出るので**何も出ず**、設定カードには「OBSに接続しています…」が
    // 残り続ける＝ 061e が直そうとした「結果が読み取れない」が最も起きやすい経路で残っていた。
    // ⚠ ここで固定するのは「**送らない**」こと。送ってしまうと固着が復活する。
    localStorage.setItem(EFFECT_OVERLAY_ENABLED_KEY, "true");
    localStorage.setItem(EFFECT_OBS_AUTO_ADD_KEY, "true");
    mocks.isEffectOverlayOpen.mockResolvedValue(true);

    render(<CommentViewerApp />); // ⚠ emitConnected() を**呼ばない**＝未接続のまま
    await act(async () => {});

    expect(mocks.stream.enableObs).not.toHaveBeenCalled();
    // 固着の目印（設定カードの「OBSに接続しています…」）も出ない＝ idle のまま。
    expect(screen.queryByText("OBSに接続しています…")).not.toBeInTheDocument();
  });

  it("⚠⚠ B2 (Bug-1): 接続が確立した時点で保証ベースラインが走る", async () => {
    // B1 と対。「送らない」だけなら reconcile を消しても通るので、**接続後には必ず走る**ことを対で固定する。
    localStorage.setItem(EFFECT_OVERLAY_ENABLED_KEY, "true");
    localStorage.setItem(EFFECT_OBS_AUTO_ADD_KEY, "true");
    mocks.isEffectOverlayOpen.mockResolvedValue(true);

    render(<CommentViewerApp />);
    await act(async () => {});
    expect(mocks.stream.enableObs).not.toHaveBeenCalled();

    emitConnected();

    await waitFor(() =>
      expect(mocks.stream.enableObs).toHaveBeenCalledWith(4455, "effects"),
    );
  });

  it("⚠⚠ B3 (Bug-1): 再接続では走らせない（061a の「窓を開いたら 1 回」を保つ）", async () => {
    // ⚠ 契機を接続へ移したことで「再接続のたびに反映が飛ぶ」形になりうる。それは 045c の
    // 「**反映の契機は表示 ON**」を越えて、配信中に sidecar が落ちて復帰するたび OBS へ繋ぎに行く。
    // 061a の意味論（窓を開いたら 1 回）をタイミングだけ移すのが目的なので、**最初の 1 回だけ**に絞る。
    localStorage.setItem(EFFECT_OVERLAY_ENABLED_KEY, "true");
    localStorage.setItem(EFFECT_OBS_AUTO_ADD_KEY, "true");
    mocks.isEffectOverlayOpen.mockResolvedValue(true);

    render(<CommentViewerApp />);
    emitConnected();
    await waitFor(() =>
      expect(mocks.stream.enableObs).toHaveBeenCalledTimes(1),
    );

    // 切断 → 再接続（sidecar の再起動やスリープ復帰で実際に起きる）。
    act(() => mocks.handlers.current?.onConnectionChange?.(false));
    emitConnected();
    await act(async () => {});

    expect(mocks.stream.enableObs).toHaveBeenCalledTimes(1);
  });

  it("⚠⚠ B4 (Bug-1): 切断中に連携を ON にされたら connecting で固まらず failed に落とす", async () => {
    // ⚠ `requestObsAutoAdd` の未接続判定を「ハンドルの有無」から「**WS が OPEN か**」に直した分。
    // ハンドルは `connectCommentStream` が接続を待たずに同期で返すので、**接続前でも非 null**＝
    // 旧ガードは素通りしていた（これが Bug-1 の直接の原因）。
    // ⚠ 保証ベースラインの経路（B1）と違い、こちらは**ユーザーが今まさに ON にした**ので、
    // 黙って何もしないのではなく **failed を出して伝える**のが正しい（L2 が元から意図していたこと）。
    localStorage.setItem(EFFECT_OVERLAY_ENABLED_KEY, "true");
    mocks.isEffectOverlayOpen.mockResolvedValue(true);
    render(<CommentViewerApp />);
    emitConnected();
    await act(async () => {});
    act(() => mocks.handlers.current?.onConnectionChange?.(false)); // 切断

    emitSettingChange(EFFECT_OBS_AUTO_ADD_KEY, "true");

    await waitFor(() =>
      expect(screen.getByText(OBS_ERROR_TEXT)).toBeInTheDocument(),
    );
    // 届かない送信はしない（固着の芽を作らない）。
    expect(mocks.stream.enableObs).not.toHaveBeenCalled();
    expect(screen.queryByText("OBSに接続しています…")).not.toBeInTheDocument();
  });

  it("⚠ 実窓が無ければマウント時に送らない（OBS に空ソースを残さない・046d レビュー）", async () => {
    localStorage.setItem(EFFECT_OVERLAY_ENABLED_KEY, "true");
    localStorage.setItem(EFFECT_OBS_AUTO_ADD_KEY, "true");
    mocks.isEffectOverlayOpen.mockResolvedValue(false);

    render(<CommentViewerApp />);
    emitConnected();
    await act(async () => {});

    expect(mocks.stream.enableObs).not.toHaveBeenCalled();
  });

  it("自動反映 OFF ならマウント時に送らない（明示的に有効化した時のみ接続・§1）", async () => {
    localStorage.setItem(EFFECT_OVERLAY_ENABLED_KEY, "true");
    mocks.isEffectOverlayOpen.mockResolvedValue(true);

    render(<CommentViewerApp />);
    emitConnected();
    await act(async () => {});

    expect(mocks.stream.enableObs).not.toHaveBeenCalled();
  });

  it("即時反映: 表示 ON の書換を storage で受けると、猶予後に enableObs が飛ぶ", async () => {
    vi.useFakeTimers();
    try {
      localStorage.setItem(EFFECT_OBS_AUTO_ADD_KEY, "true");
      render(<CommentViewerApp />);
      emitConnected();
    emitConnected();
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
      emitConnected();
    emitConnected();
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
      emitConnected();
    emitConnected();
      await act(async () => {});

      emitSettingChange(EFFECT_OVERLAY_ENABLED_KEY, "true"); // 猶予が仕掛かる
      emitSettingChange(EFFECT_OBS_AUTO_ADD_KEY, "false"); // 経過前に連携 OFF

      await act(() => vi.advanceTimersByTimeAsync(10_000));
      expect(mocks.stream.enableObs).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  // ⚠⚠ **061k レビュー S-1: 上のケースの `"stage"` 版が無かったため、実装の非対称が生存していた。**
  //   （`clearObsEnableTimer("effects")` を消すと上のケースが RED になるのに、stage 側は誰も見ていなかった）
  //   ⚠ 壊れ方は「ユーザーが自動反映を OFF にしたのに `enableObs("stage")` が飛ぶ」＝
  //   docs/security.md §1「明示的に有効化した時のみ接続」に反する（045c 回帰の再発）。
  it("⚠⚠ 061k: ステージ側も、猶予中に自動反映 OFF にしたら enableObs は飛ばない", async () => {
    vi.useFakeTimers();
    try {
      localStorage.setItem(EFFECT_OBS_AUTO_ADD_KEY, "true");
      render(<CommentViewerApp />);
      emitConnected();
      await act(async () => {});

      emitSettingChange(STAGE_OVERLAY_ENABLED_KEY, "true"); // stage の猶予が仕掛かる
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
      emitConnected();
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
    emitConnected();
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
      emitConnected();
    emitConnected();
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
      emitConnected();
    emitConnected();
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
      emitConnected();
    emitConnected();
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
      emitConnected();
    emitConnected();
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
    emitConnected();
    await act(async () => {});
    expect(mocks.stream.enableObs).not.toHaveBeenCalled();

    emitSettingChange(EFFECT_OBS_AUTO_ADD_KEY, "true");

    await waitFor(() =>
      expect(mocks.stream.enableObs).toHaveBeenCalledWith(4455, "effects"),
    );
  });
});

/**
 * 061e: **OBS 連携の失敗が、ユーザーの居る画面で読み取れること。**
 *
 * ⚠⚠ 061a の宿題 (B) がここ: ツールバーの赤字は `obsAutoAdd`（**コメント側のトグル**）で絞られていたが、
 * `obsAutoAdd` が束ねるのは comments / pinned の 2 種別だけで、**エフェクトの連携は main 窓が持つ別キー**。
 * ＝「コメント側 OFF ／ エフェクト側 ON」の構成だと、**エフェクトの OBS 追加に失敗しても赤字が 1 文字も出ない**。
 *
 * 直し方は 2 段:
 *   - **(1)** エフェクトの自動反映 OFF でも `obsState` を idle へ戻す（045c の不変条件を effects 側でも成立させる）
 *   - **(2)** ツールバーの赤字ゲートから `obsAutoAdd &&` を外す（(1) がゲートの代わりになる）
 *
 * ⚠⚠ **穴 1（`obsState` が 3 種別で 1 本であること）への答えをこの表で固定する。**
 * `obsState` は共有なので「連携 OFF なら必ず idle」は**種別ごとの不変条件になりえない**。
 * よって (1) は「**他種別の連携もすべて OFF のときだけ**倒す」に狭めてある——無条件に倒すと
 * **comments / pinned の失敗の赤字まで巻き添えで消える**＝ 061e が消そうとしている
 * 「失敗が黙って出ない」を 061e 自身が 1 本作ることになるため。
 *
 * ⚠ **この表で固定できていないこと（正直に書く）**:
 *   - **赤字がどの種別の失敗か**——`obs.state` が `overlay` を運ばないので区別できない（046d / 061a Q-2 の領分）。
 *   - **sidecar の echo で赤字が消える経路**——`hideObs` / `disableObs` は sidecar が `idle` を broadcast し
 *     返すので、コメント側の OFF は effects の failed も消す。ここでは sidecar をモックしているため
 *     再現できない（実機確認でしか見られない）。frontend で塞げないことが (1) を effects 側だけに
 *     狭めた理由そのものなので、**この穴は仕様として受容している**。
 */
describe("061e OBS 連携の失敗がツールバーに出る（共有 obsState の上での出し分け）", () => {
  /** エフェクトの「表示 ON ＋ 自動反映 ON ＋ 実窓あり」を作り、失敗通知まで進める。 */
  async function renderWithEffectFailure() {
    localStorage.setItem(EFFECT_OVERLAY_ENABLED_KEY, "true");
    localStorage.setItem(EFFECT_OBS_AUTO_ADD_KEY, "true");
    mocks.isEffectOverlayOpen.mockResolvedValue(true);
    render(<CommentViewerApp />);
    emitConnected();
    await waitFor(() =>
      expect(mocks.stream.enableObs).toHaveBeenCalledWith(4455, "effects"),
    );
    emitObsState("failed");
  }

  it("⚠⚠ T3 (2): コメント側の自動反映 OFF でも、失敗すればツールバーに赤字が出る", async () => {
    // ⚠ `OBS_AUTO_ADD_KEY` を立てない＝コメント側の自動反映 OFF。旧実装（`obsAutoAdd && ...`）では
    // ここで赤字が 1 文字も出ず、**エフェクトが OBS に反映されていないことに気付く手段がゼロ**だった。
    // ⚠ ゲートを戻す変異でレッドになるのはこのケース。
    await renderWithEffectFailure();

    const error = screen.getByText(OBS_ERROR_TEXT);
    // 文言は変えない（どの種別で失敗してもユーザーが取る行動は同じ＝OBS を起動する・059b）。
    expect(error).toHaveAttribute(
      "title",
      "OBSに接続できませんでした。OBSが起動しているか確認してください。",
    );
  });

  it("⚠⚠ T1 (1): エフェクトの自動反映を OFF にすると赤字が消える（他種別の連携も OFF のとき）", async () => {
    // 045c の不変条件「連携 OFF なら必ず obsState を idle へ戻す」を effects 側でも成立させた分。
    // ⚠ (2) でゲートが外れているので、**ここが赤字を消す唯一の経路**（ゲートが肩代わりしてくれない）。
    // ⚠ `setObsState("idle")` を消す変異でレッドになるのはこのケース。
    await renderWithEffectFailure();
    expect(screen.getByText(OBS_ERROR_TEXT)).toBeInTheDocument();

    emitSettingChange(EFFECT_OBS_AUTO_ADD_KEY, "false");

    expect(screen.queryByText(OBS_ERROR_TEXT)).not.toBeInTheDocument();
    // ⚠ 連携 OFF は OBS へ何も送らない（061a の線引き＝OFF は「もう送らない」であって「消す」ではない）。
    expect(mocks.stream.hideObs).not.toHaveBeenCalled();
    expect(mocks.stream.disableObs).not.toHaveBeenCalled();
  });

  it("⚠⚠ T2 (穴 1): コメント側の連携が ON のままなら、エフェクトの自動反映 OFF で赤字を消さない", async () => {
    // ⚠⚠ **ここが穴 1 の答え**。`obsState` は 3 種別で 1 本なので、無条件に idle へ倒すと
    // **comments / pinned の失敗の赤字まで巻き添えで消える**（＝失敗が黙って出なくなる／061e が
    // 直そうとしている症状そのものを 061e が作る）。
    // 代償は「エフェクトの連携を OFF にしたのに赤字が残る」だが、その赤字は**そのとき真**
    //（comments/pinned 側は現に OBS へ繋がっていない）で、取る行動も同じ＝OBS を起動する（059b）。
    // ⚠ `!loadObsAutoAdd()` のガードを外す変異でレッドになるのはこのケース。
    localStorage.setItem(OBS_AUTO_ADD_KEY, "true"); // コメント側の連携は ON のまま
    await renderWithEffectFailure();

    emitSettingChange(EFFECT_OBS_AUTO_ADD_KEY, "false");

    expect(screen.getByText(OBS_ERROR_TEXT)).toBeInTheDocument();
  });

  it("T4 (回帰): エフェクトの表示を OFF にすると赤字が消える（061a の既存挙動）", async () => {
    // 表示 OFF は OBS 側も非表示にする（`hideObs`）ので、直前の結果は実態と食い違う＝ idle へ戻す。
    // ⚠ こちらは 061a から在る経路で、061e では**触っていない**（回帰として固定するだけ）。
    await renderWithEffectFailure();
    expect(screen.getByText(OBS_ERROR_TEXT)).toBeInTheDocument();

    emitSettingChange(EFFECT_OVERLAY_ENABLED_KEY, "false");

    expect(mocks.stream.hideObs).toHaveBeenCalledWith(4455, "effects");
    expect(screen.queryByText(OBS_ERROR_TEXT)).not.toBeInTheDocument();
  });

  it("⚠⚠ T5 (穴 1 の対): コメント側の連携が ON でも、エフェクトの**表示** OFF は赤字を消す（狭めない）", async () => {
    // ⚠⚠ **T2 と対にして「2 本の分岐の非対称」を表として固定する**（061e レビュー Q-3）。
    //   - **自動反映 OFF**（T2）＝ OBS へ**何も送らない**ので frontend の判断が最終決定
    //     → `!loadObsAutoAdd()` で狭める（他種別の failed を巻き添えにしない）
    //   - **表示 OFF**（ここ）＝ `hideObs` を送るので **sidecar が `idle` を broadcast し返す**
    //     → frontend で狭めても echo が着弾して同じ結果になる＝**効かないガード**なので狭めない
    // ⚠ これが無いと、「対称にしよう」と表示 OFF 側にも `!loadObsAutoAdd()` を足す変異が**生存する**
    //（実測: T1〜T4 だけでは 50/50 緑のまま通ってしまった）。WS 未接続時には挙動が変わる変更なので、
    // 意図せず入ることを防ぐ意味でもここで固定する。
    localStorage.setItem(OBS_AUTO_ADD_KEY, "true"); // コメント側の連携は ON のまま
    await renderWithEffectFailure();
    expect(screen.getByText(OBS_ERROR_TEXT)).toBeInTheDocument();

    emitSettingChange(EFFECT_OVERLAY_ENABLED_KEY, "false");

    expect(mocks.stream.hideObs).toHaveBeenCalledWith(4455, "effects");
    expect(screen.queryByText(OBS_ERROR_TEXT)).not.toBeInTheDocument();
  });

  it("⚠⚠ T6 (実機③後半): 残った赤字は、sidecar の echo（obs.state = idle）が着弾すれば消える", async () => {
    // ⚠⚠ **progress の「テストで固定できていない」②を、frontend の責務の範囲で固定する。**
    // コメント側の表示 OFF / 連携 OFF は `hideObs` / `disableObs` を送り、sidecar が
    // `obs.state = idle` を broadcast し返す（`obs-client.ts` の `hide()` は `finally { onState("idle") }`、
    // `disable()` は `onState("idle")`）。**sidecar が必ず idle を返すこと自体は sidecar の責務**だが、
    // **その echo が着弾したら赤字を消すことは frontend の責務**で、ここはテストできる。
    // ⚠ これが T2（＝ effects 連携 OFF では消さない）と両立して初めて
    // 「(b) は消せない赤字を作らない」＝残った赤字にも必ず出口がある、が成立する。
    localStorage.setItem(OBS_AUTO_ADD_KEY, "true"); // コメント側の連携は ON のまま
    await renderWithEffectFailure();

    emitSettingChange(EFFECT_OBS_AUTO_ADD_KEY, "false");
    expect(screen.getByText(OBS_ERROR_TEXT)).toBeInTheDocument(); // T2 の状態

    // コメント側で表示 OFF / 連携 OFF を操作した結果、sidecar から返ってくる idle。
    emitObsState("idle");

    expect(screen.queryByText(OBS_ERROR_TEXT)).not.toBeInTheDocument();
  });

  it("⚠⚠ T7 (実機⑦): 設定 ON ＋ OBS 未起動なら、コメビュ窓を開き直すたびに赤字が出る", async () => {
    // ⚠⚠ **061a Q-2 の再修正トリガー①（「コメビュを開くたびに OBS の赤字が出る」）の症状そのもの**を
    // 仕様として固定する。設定の持ち主は main 窓なので、コメビュ窓は**開くたびにマウント時 reconcile を
    // 走らせる**（061a の保証ベースライン）＝ OBS が起動していなければ毎回 failed になる。
    // ⚠ 061e(2) 前はコメント側連携が OFF ならゲートで隠れていたので、**061e で初めて可視化された**。
    // ⚠ これは 061e の目的（失敗の可視化）そのものなので**赤字を隠す方向では直さない**。
    // 煩わしいと分かったときの答えは wire 変更（種別ごとの state と文言）で、ゲート復活ではない。
    // ⚠⚠ **訂正（実機確認・061e(5)）**: このケースを最初に書いたとき、実機では**赤字が出なかった**
    //（Bug-1＝マウント時 reconcile が WS 未接続で捨てられ `connecting` 固着）。本ケースが緑だったのは
    // `emitObsState("failed")` を**手で注入**していて「failed が来ない」経路を再現していなかったため。
    // いまは `emitConnected()` で実機の順序（接続してから反映）を再現している＝
    // **「開き直すたびに赤字」が成立するのは接続確立後**、というのが正しい仕様。
    localStorage.setItem(EFFECT_OVERLAY_ENABLED_KEY, "true");
    localStorage.setItem(EFFECT_OBS_AUTO_ADD_KEY, "true");
    mocks.isEffectOverlayOpen.mockResolvedValue(true);

    const first = render(<CommentViewerApp />);
    emitConnected();
    await waitFor(() =>
      expect(mocks.stream.enableObs).toHaveBeenCalledWith(4455, "effects"),
    );
    emitObsState("failed");
    expect(screen.getByText(OBS_ERROR_TEXT)).toBeInTheDocument();

    // 窓を閉じる＝アンマウント。`obsState` は窓ごとの state なので次のマウントでは idle から始まる。
    first.unmount();
    mocks.stream.enableObs.mockClear();

    render(<CommentViewerApp />);
    emitConnected();
    await waitFor(() =>
      expect(mocks.stream.enableObs).toHaveBeenCalledWith(4455, "effects"),
    );
    expect(screen.queryByText(OBS_ERROR_TEXT)).not.toBeInTheDocument(); // 通知が来るまでは出ない
    emitObsState("failed");

    expect(screen.getByText(OBS_ERROR_TEXT)).toBeInTheDocument();
  });

  it("⚠⚠ T8 (実機⑧・レビュー Q-1): 連携 OFF 後に in-flight の failed が着弾すると、全部 OFF でも赤字が出る", async () => {
    // ⚠⚠ **受容した stale-positive を仕様として固定する**（061e 独立レビュー Q-1）。
    // 連携 ON でゲートされるのは**「呼ぶ瞬間」だけ**で、`enableObs` を送ったあとの結果は追いかけられない
    //（sidecar の `disable()` は `onState("idle")` を出すだけで**走っている `enable()` を止めない**）。
    // ⇒ 連携を OFF にした数秒後に `failed` が届き、**連携が 1 つも ON でないのに赤字が出る**。
    // **受容の根拠**＝その赤字が指す事実（OBS へ繋がらない）はその瞬間**現に真**で、
    // ユーザーが取る行動も変わらない（OBS を起動する）。
    // ⚠ **直すならゲート復活ではなく世代カウンタ**（`requestObsAutoAdd` のコメント参照）。
    // この表明が落ちたら、まず「世代カウンタを入れたのか」を疑うこと（＝そのときはこのケースを消す）。
    localStorage.setItem(EFFECT_OVERLAY_ENABLED_KEY, "true");
    localStorage.setItem(EFFECT_OBS_AUTO_ADD_KEY, "true");
    mocks.isEffectOverlayOpen.mockResolvedValue(true);
    render(<CommentViewerApp />);
    emitConnected();
    await waitFor(() =>
      expect(mocks.stream.enableObs).toHaveBeenCalledWith(4455, "effects"),
    );

    // ここで連携 OFF。コメント側も OFF（`OBS_AUTO_ADD_KEY` を立てていない）なので idle へ倒れる。
    emitSettingChange(EFFECT_OBS_AUTO_ADD_KEY, "false");
    expect(screen.queryByText(OBS_ERROR_TEXT)).not.toBeInTheDocument();

    // 送出済みだった反映要求の結果が、遅れて届く。
    emitObsState("failed");

    expect(screen.getByText(OBS_ERROR_TEXT)).toBeInTheDocument();
  });

  it("⚠ T9 (レビュー Q-1 の続き): その赤字は「表示 OFF」では消えない（消すのは連携の ON→OFF）", async () => {
    // ⚠ 表示 OFF の後始末（`hideObs` ＋ idle）は **`loadEffectObsAutoAdd()` が真のときだけ**走るので、
    // 既に連携 OFF になっている T8 の状態では**後始末そのものに入らない**＝赤字が残る。
    // ⚠ progress の「表示 OFF または自動反映 OFF のどちらかで必ず消える」という当初の記述が
    // **正確でなかった**ことの表明（Q-1 で訂正済み）。出口は「連携を ON→OFF」または窓の開き直し。
    localStorage.setItem(EFFECT_OVERLAY_ENABLED_KEY, "true");
    localStorage.setItem(EFFECT_OBS_AUTO_ADD_KEY, "true");
    mocks.isEffectOverlayOpen.mockResolvedValue(true);
    render(<CommentViewerApp />);
    emitConnected();
    await waitFor(() =>
      expect(mocks.stream.enableObs).toHaveBeenCalledWith(4455, "effects"),
    );
    emitSettingChange(EFFECT_OBS_AUTO_ADD_KEY, "false");
    emitObsState("failed");
    expect(screen.getByText(OBS_ERROR_TEXT)).toBeInTheDocument();

    emitSettingChange(EFFECT_OVERLAY_ENABLED_KEY, "false");

    expect(screen.getByText(OBS_ERROR_TEXT)).toBeInTheDocument();
    // 連携 OFF 済みなので OBS へは何も送らない（061a の線引き＝OFF は「もう送らない」）。
    expect(mocks.stream.hideObs).not.toHaveBeenCalled();
  });

  it("⚠⚠ T10 (実機④・(C) の目的): エフェクトの成功でも設定カードは「OBSに表示しました。」と出る", async () => {
    // ⚠⚠ **(C) が直したのはここ**。旧文「OBSにコメントを表示しました。」は、`obsState` が 3 種別で
    // 共有されているせいで**エフェクトの成功でも出て嘘になっていた**。
    // ⚠ `SettingsView.obs.test.tsx` は props で `obsState` を渡す単体テストなので、
    // 「**エフェクト由来の added が実際にこのカードへ届く**」経路はここでしか固定できない。
    localStorage.setItem(EFFECT_OVERLAY_ENABLED_KEY, "true");
    localStorage.setItem(EFFECT_OBS_AUTO_ADD_KEY, "true");
    mocks.isEffectOverlayOpen.mockResolvedValue(true);
    render(<CommentViewerApp />);
    emitConnected();
    await waitFor(() =>
      expect(mocks.stream.enableObs).toHaveBeenCalledWith(4455, "effects"),
    );

    emitObsState("added");
    fireEvent.click(screen.getByRole("button", { name: "設定" }));

    const note = await screen.findByText("OBSに表示しました。");
    // 種別に依存しない文であること（エフェクトの成功なので「コメント」と書いてあったら嘘になる）。
    expect(note.textContent).not.toContain("コメント");
    // 045c: 成功はツールバーへ出さない（配信中のツールバーを騒がしくしない）。
    expect(screen.queryByText(OBS_ERROR_TEXT)).not.toBeInTheDocument();
  });
  // --- 061k（新規 9）: ステージ窓ぶんの連携 --------------------------------------------------------

  it("⚠⚠ 新規 9: stage キーの `storage` で `enableObs(\"stage\")` を出す（`\"effects\"` を巻き添えにしない）", async () => {
    vi.useFakeTimers();
    try {
      localStorage.setItem(EFFECT_OBS_AUTO_ADD_KEY, "true");
      mocks.isStageOverlayOpen.mockResolvedValue(true);
      render(<CommentViewerApp />);
      emitConnected();
      await act(async () => {});

      // main 窓が stage の派生値を true にした（＝stage 条件が 0 → 1 件）。
      emitSettingChange(STAGE_OVERLAY_ENABLED_KEY, "true");
      // 044a と同じ猶予（窓が OBS のウィンドウ一覧に載るまで）を経由する。
      expect(mocks.stream.enableObs).not.toHaveBeenCalled();

      await act(() => vi.advanceTimersByTimeAsync(10_000));
      expect(mocks.stream.enableObs).toHaveBeenCalledWith(4455, "stage");
      // ⚠⚠ **本命**: コーナー側は 1 度も呼ばれない（種別を取り違えない）。
      expect(mocks.stream.enableObs).not.toHaveBeenCalledWith(4455, "effects");
      expect(mocks.stream.enableObs).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("⚠⚠ 新規 9: stage キーが false になったら `hideObs(\"stage\")` を出す（`\"effects\"` は触らない）", async () => {
    localStorage.setItem(EFFECT_OBS_AUTO_ADD_KEY, "true");
    localStorage.setItem(STAGE_OVERLAY_ENABLED_KEY, "true");
    render(<CommentViewerApp />);
    emitConnected();
    await act(async () => {});

    emitSettingChange(STAGE_OVERLAY_ENABLED_KEY, "false");

    await waitFor(() =>
      expect(mocks.stream.hideObs).toHaveBeenCalledWith(4455, "stage"),
    );
    expect(mocks.stream.hideObs).not.toHaveBeenCalledWith(4455, "effects");
  });

  it("⚠⚠ 新規 9: 接続確立時の reconcile も 2 窓を独立に判定する（片方だけ ON）", async () => {
    // ⚠ 合計で判定すると「コーナー条件しか無いのにステージのソースを作りに行く」＝
    //   キャプチャ対象未設定の空ソースが OBS に残る（046d レビューの失敗モード）。
    localStorage.setItem(EFFECT_OBS_AUTO_ADD_KEY, "true");
    localStorage.setItem(STAGE_OVERLAY_ENABLED_KEY, "true");
    // ⚠ コーナー側の派生値は false（＝条件が corner に 1 件も無い）。
    mocks.isEffectOverlayOpen.mockResolvedValue(true);
    mocks.isStageOverlayOpen.mockResolvedValue(true);

    render(<CommentViewerApp />);
    emitConnected();

    await waitFor(() =>
      expect(mocks.stream.enableObs).toHaveBeenCalledWith(4455, "stage"),
    );
    expect(mocks.stream.enableObs).not.toHaveBeenCalledWith(4455, "effects");
  });

  it("⚠ 新規 9: ステージ窓が実在しないなら `enableObs(\"stage\")` を送らない（空ソースを残さない）", async () => {
    // ⚠ 046d レビューと同じ理由——設定 ON ／ 窓なしで送ると sidecar 側 `ensureOverlaySource` が
    //   先に `CreateInput` してから窓を探して失敗し、**キャプチャ対象未設定の空ソースが OBS に残る**。
    localStorage.setItem(EFFECT_OBS_AUTO_ADD_KEY, "true");
    localStorage.setItem(STAGE_OVERLAY_ENABLED_KEY, "true");
    mocks.isStageOverlayOpen.mockResolvedValue(false);

    render(<CommentViewerApp />);
    emitConnected();
    await act(async () => {});

    expect(mocks.stream.enableObs).not.toHaveBeenCalledWith(4455, "stage");
  });
});
