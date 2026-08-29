import { describe, it, expect, vi, beforeEach } from "vitest";
import { StrictMode } from "react";
import {
  render,
  act,
  fireEvent,
  screen,
  waitFor,
} from "@testing-library/react";
import { CommentViewerApp } from "./CommentViewerApp";
import {
  STAGE_OVERLAY_ENABLED_KEY,
  // ⚠⚠ 063c 段 1: **2 本目の旗**（ガチャ演出の明示トグル）。この窓は読み手のうちの 2 経路を持つ。
  GACHA_STAGE_ENABLED_KEY,
  // ⚠ 064e: `EFFECT_OBS_AUTO_ADD_KEY` の import を外した（自動反映が既定になり設定が消えた）。
  // 064a: OBS 側のソースを再生する方式（main 窓 → この窓）。
  OBS_SOURCE_LIST_REQUEST_KEY,
  OBS_SOURCE_TEST_FIRE_KEY,
  OBS_AUTO_ADD_KEY,
  // 064b: コメントの条件が当たったら OBS のソースを鳴らす（この窓が発火の持ち主）。
  OBS_SOURCE_FALLBACK_DURATION_MS,
  EFFECT_ASSIGNMENTS_KEY,
  // ⚠ 063c 段 2-a: ガチャ本体（景品の出力先）を仕込むため。
  GACHA_LIBRARY_KEY,
} from "../../features/comment-viewer/overlaySettings";
import type { CommentViewDto } from "../../features/comment-viewer/types";
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
 * - 反映の契機は **`STAGE_OVERLAY_ENABLED_KEY` が true になったとき**。猶予を経て `enableObs`。
 *   ⚠⚠ **064d でこの旗の意味が「stage 条件が 1 件以上あるか」→「いま配信イベントを開催しているか」へ
 *   変わっている**ので、実質の契機は**配信イベントの「開始」**である。
 * - false へ戻ったら（＝終了）`hideObs("stage")`＋`obsState` を idle へ。
 * - ⚠ **猶予タイマーは必ず取り消す**（終了・`clear()`・アンマウントのすべてで）。
 * - ⚠ **`disableObs()` を呼ばない**（kind を取らないので comments / pinned を巻き添えにする）。
 * - ⚠ **実窓が無ければ送らない**（046d レビュー＝OBS に空ソースが残るため）。
 *
 * ## ⚠⚠⚠ 064e: ゲートが 2 枚から 1 枚になった（＝このファイルの前提が変わった）
 *
 * 061a〜064d は **①自動反映トグル（`EFFECT_OBS_AUTO_ADD_KEY`）②開催中か** の 2 枚を要求していた。
 * 依頼者の指示「**OBS に自動で反映はデフォルト機能にします**」で **① を外した**（設定ごと削除）。
 * ⇒ ⚠⚠ **`docs/security.md` §1 の 044a 例外を守るガードは②だけ**になったので、
 * 「**開催していなければ送らない**」ケースが**このファイルで最も重いケース**である（消さないこと）。
 * ⚠ ①を前提にしていたケース（OFF で送らない／OFF で猶予を取り消す／OFF で赤字を消す 等）は、
 * **契機を「終了」または `clear()` へ差し替えて残してある**——守りたい壊れ方は 1 つも変わっていない。
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
  // ⚠ 064d: この窓が使うのは**ステージ窓の実窓確認だけ**（open/close は main 窓が持つ）。
  isStageOverlayOpen: vi.fn(),
  handlers: { current: null as CommentStreamHandlers | null },
  recordComments: vi.fn(),
  stream: {
    disconnect: vi.fn(),
    startLogin: vi.fn(),
    // 066 段 2: ⚠ **チケット取得（`invoke`）を挟むので Promise を返す。**
    //   ⚠⚠ `vi.fn()` のままだと `undefined` が返り、呼び出し側の「失敗なら理由を出す」分岐が
    //   **常に素通りする**（＝穴 C の受け皿がテストで守られていない状態になる）。
    startSession: vi.fn(async () => ({ ok: true as const })),
    stopSession: vi.fn(async () => ({ ok: true as const })),
    enableObs: vi.fn(),
    hideObs: vi.fn(),
    // 064a: OBS のソースを鳴らす方式（一覧取得と 1 回発火）。
    listObsSources: vi.fn(),
    fireObsSource: vi.fn(),
    disableObs: vi.fn(),
    requestThemeFont: vi.fn(() =>
      Promise.resolve({ ok: false as const, reason: "offline" }),
    ),
    requestThemeImport: vi.fn(async () => ({
      ok: false as const,
      reason: "offline",
    })),
    // 066: 送信は使わないが型を満たす（⚠ 既定 OFF なのでこれらの画面からは呼ばれない）。
    sendChat: vi.fn(async () => ({ ok: false as const, reason: "offline" })),
  } satisfies CommentStreamHandle,
  // ⚠⚠ 063c 段 2-a: 当選結果をステージ窓へ送る経路（**窓間イベント**）。
  //   ⚠ モックしないと jsdom で Tauri の IPC を叩きに行く（実装側が握りつぶすので落ちはしないが、
  //   **送ったこと自体を観測できない**＝「送っていない」変異が殺せない）。
  emitGachaStageResult: vi.fn(),
}));

vi.mock("../obs-effects/gachaStageEvent", () => ({
  emitGachaStageResult: mocks.emitGachaStageResult,
}));

// ⚠ モジュールを丸ごと差し替えるので、実モジュールの export 面を全て埋める（toolbar テストと同じ方針）。
// ⚠ `isStageOverlayOpen` を書き漏らすと、061a のエフェクト連携 effect が
// 「undefined is not a function」で落ちて全ケースがレッドになる。
vi.mock("../../features/comment-viewer/windowApi", () => ({
  isCommentOverlayOpen: mocks.isCommentOverlayOpen,
  openCommentOverlayWindow: mocks.openCommentOverlayWindow,
  closeCommentOverlayWindow: mocks.closeCommentOverlayWindow,
  isPinnedOverlayOpen: mocks.isPinnedOverlayOpen,
  openPinnedOverlayWindow: mocks.openPinnedOverlayWindow,
  closePinnedOverlayWindow: mocks.closePinnedOverlayWindow,
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
// ⚠ 062b: 配信セッション（invoke）。**マウント時に必ず走る**（閉じ忘れ回収 → 進行中セッションの引き継ぎ）
// うえ、コメント到着でも `start_stream_session` が飛ぶ。塞がないと実 invoke が jsdom で reject し、
// 実装の `.catch` が握るので**テストは通ってしまう**（＝この窓の「外部境界は全てモックして隔離する」方針どおり
// ここでも封鎖する）。進行中セッション無し・開始は成功、で固定する。
vi.mock("../../features/stream-session/streamSessionApi", () => {
  const record = {
    id: "session-1",
    startedAt: "2026-08-16T10:00:00+00:00",
    platforms: ["twitch"],
    title: "",
    createdAt: "2026-08-16T10:00:00+00:00",
    updatedAt: "2026-08-16T10:00:00+00:00",
  };
  return {
    startStreamSession: vi.fn(async () => record),
    getActiveStreamSession: vi.fn(async () => null),
    updateStreamSessionPlatforms: vi.fn(async () => record),
    endStreamSession: vi.fn(async () => record),
    updateStreamSessionTitle: vi.fn(async () => record),
    listStreamSessions: vi.fn(async () => []),
    closeStaleStreamSessions: vi.fn(async () => 0),
  };
});

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
    window.dispatchEvent(new StorageEvent("storage", { key, newValue: value }));
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
  mocks.isStageOverlayOpen.mockResolvedValue(false);
  mocks.isStageOverlayOpen.mockResolvedValue(false);
  mocks.handlers.current = null;
});

describe("061a/064d ステージ窓の OBS 自動反映（コメビュ窓が代行する）", () => {
  it("保証ベースライン: WS 接続確立時に「設定 ON ＋ 実窓あり」なら即反映する", async () => {
    // ⚠⚠ 061e(5): 旧題は「**マウント時**に…」だった。実機（Bug-1）で、マウント時点では WS がまだ
    // OPEN でなく `send` に捨てられることが判明したので、契機を接続確立へ移した。
    localStorage.setItem(STAGE_OVERLAY_ENABLED_KEY, "true");
    mocks.isStageOverlayOpen.mockResolvedValue(true);

    render(<CommentViewerApp />);
    emitConnected();

    // ⚠ 猶予は挟まない（窓は既に開いていて OBS のウィンドウ一覧に載っているはず）。
    await waitFor(() =>
      expect(mocks.stream.enableObs).toHaveBeenCalledWith(4455, "stage"),
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
    localStorage.setItem(STAGE_OVERLAY_ENABLED_KEY, "true");
    mocks.isStageOverlayOpen.mockResolvedValue(true);

    render(<CommentViewerApp />); // ⚠ emitConnected() を**呼ばない**＝未接続のまま
    await act(async () => {});

    expect(mocks.stream.enableObs).not.toHaveBeenCalled();
    // 固着の目印（設定カードの「OBSに接続しています…」）も出ない＝ idle のまま。
    expect(screen.queryByText("OBSに接続しています…")).not.toBeInTheDocument();
  });

  it("⚠⚠ B2 (Bug-1): 接続が確立した時点で保証ベースラインが走る", async () => {
    // B1 と対。「送らない」だけなら reconcile を消しても通るので、**接続後には必ず走る**ことを対で固定する。
    localStorage.setItem(STAGE_OVERLAY_ENABLED_KEY, "true");
    mocks.isStageOverlayOpen.mockResolvedValue(true);

    render(<CommentViewerApp />);
    await act(async () => {});
    expect(mocks.stream.enableObs).not.toHaveBeenCalled();

    emitConnected();

    await waitFor(() =>
      expect(mocks.stream.enableObs).toHaveBeenCalledWith(4455, "stage"),
    );
  });

  it("⚠⚠ B3 (Bug-1): 再接続では走らせない（061a の「窓を開いたら 1 回」を保つ）", async () => {
    // ⚠ 契機を接続へ移したことで「再接続のたびに反映が飛ぶ」形になりうる。それは 045c の
    // 「**反映の契機は表示 ON**」を越えて、配信中に sidecar が落ちて復帰するたび OBS へ繋ぎに行く。
    // 061a の意味論（窓を開いたら 1 回）をタイミングだけ移すのが目的なので、**最初の 1 回だけ**に絞る。
    localStorage.setItem(STAGE_OVERLAY_ENABLED_KEY, "true");
    mocks.isStageOverlayOpen.mockResolvedValue(true);

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

  it("⚠⚠ B4 (Bug-1): 切断中に配信イベントを開始したら connecting で固まらず failed に落とす", async () => {
    // ⚠ `requestObsAutoAdd` の未接続判定を「ハンドルの有無」から「**WS が OPEN か**」に直した分。
    // ハンドルは `connectCommentStream` が接続を待たずに同期で返すので、**接続前でも非 null**＝
    // 旧ガードは素通りしていた（これが Bug-1 の直接の原因）。
    // ⚠ 保証ベースラインの経路（B1）と違い、こちらは**ユーザーが今まさに操作した**ので、
    // 黙って何もしないのではなく **failed を出して伝える**のが正しい（L2 が元から意図していたこと）。
    // ⚠⚠ **064e: 契機を「連携トグルを ON」から「配信イベントの開始」へ移した**——
    //   トグルが消えた（既定 ON）ので、**ユーザーの明示操作は開始 1 つだけ**になった。
    //   ⚠ 開始は猶予を挟むので、タイマーを進めてから見る。
    vi.useFakeTimers();
    try {
      mocks.isStageOverlayOpen.mockResolvedValue(true);
      render(<CommentViewerApp />);
      emitConnected();
      await act(async () => {});
      act(() => mocks.handlers.current?.onConnectionChange?.(false)); // 切断

      emitSettingChange(STAGE_OVERLAY_ENABLED_KEY, "true"); // 開始

      await act(() => vi.advanceTimersByTimeAsync(10_000));

      expect(screen.getByText(OBS_ERROR_TEXT)).toBeInTheDocument();
      // 届かない送信はしない（固着の芽を作らない）。
      expect(mocks.stream.enableObs).not.toHaveBeenCalled();
      expect(
        screen.queryByText("OBSに接続しています…"),
      ).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("⚠ 実窓が無ければマウント時に送らない（OBS に空ソースを残さない・046d レビュー）", async () => {
    localStorage.setItem(STAGE_OVERLAY_ENABLED_KEY, "true");
    mocks.isStageOverlayOpen.mockResolvedValue(false);

    render(<CommentViewerApp />);
    emitConnected();
    await act(async () => {});

    expect(mocks.stream.enableObs).not.toHaveBeenCalled();
  });

  it("⚠⚠⚠ 064e: 開催していなければ接続時に送らない（明示的に有効化した時のみ接続・§1）", async () => {
    // ⚠⚠⚠ **`docs/security.md` §1 の 044a 例外を守るガードがこれである。**
    //   旧題は「**自動反映 OFF なら**マウント時に送らない」で、ガードは 2 枚あった
    //   （①自動反映トグル ②開催中か）。⚠ **064e で①を外した**（既定 ON）ので、
    //   **残った 1 枚がこのケースが見ているもの**だった。
    //   ⚠⚠⚠ **063c 段 1: それが `isStageOverlayRequired()` になった**（旗が 2 本になったため）。
    //   ここでは**どちらの旗も立っていない**ので、依然として 1 バイトも送らないことを見る。
    //   ⚠⚠ **ここを外すと「明示操作ゼロで OBS へ繋ぐ」**ことになり、
    //   §1 の「ユーザーが明示的に有効化した時のみ」を本当に破る。**このケースを消さないこと。**
    mocks.isStageOverlayOpen.mockResolvedValue(true);

    render(<CommentViewerApp />);
    emitConnected();
    await act(async () => {});

    expect(mocks.stream.enableObs).not.toHaveBeenCalled();
  });

  // --- 063c 段 1: 2 本目の旗と AND ゲート（§1 のガードは 1 本） ---------------------------------

  /** ガチャを指す条件を 1 件だけ保存する（AND ゲートの片側を満たす）。 */
  function putGachaCondition() {
    localStorage.setItem(
      EFFECT_ASSIGNMENTS_KEY,
      JSON.stringify([
        {
          id: "event:superchat",
          when: { type: "event", eventType: "superchat" },
          effect: { kind: "gacha", gachaId: "g:1" },
        },
      ]),
    );
  }

  it("⚠⚠ 063c: ガチャのトグル ON ＋ 割り当てあり → 接続時に送る（開催していなくても）", async () => {
    // ⚠⚠⚠ **これが 063c 段 1 で新設した経路そのもの**——
    //   064e までは「配信イベントを開催していないと OBS へ繋がらない」だった。
    putGachaCondition();
    localStorage.setItem(GACHA_STAGE_ENABLED_KEY, "true");
    mocks.isStageOverlayOpen.mockResolvedValue(true);

    render(<CommentViewerApp />);
    emitConnected();
    await act(async () => {});

    expect(mocks.stream.enableObs).toHaveBeenCalledWith(4455, "stage");
  });

  it("⚠⚠⚠ 063c: 割り当てがあってもトグル OFF なら送らない（派生値だけで繋がない）", async () => {
    // ⚠⚠ **061i にあり 064d が hook ごと削除した形／064c が却下した線を、ここで殺す。**
    putGachaCondition();
    mocks.isStageOverlayOpen.mockResolvedValue(true);

    render(<CommentViewerApp />);
    emitConnected();
    await act(async () => {});

    expect(mocks.stream.enableObs).not.toHaveBeenCalled();
  });

  it("⚠⚠ 063c: トグル ON でもガチャの割り当てが 0 件なら送らない（AND ゲート）", async () => {
    // ⚠ 条件はあるが**ガチャを指していない**（OBS ソース直指定）。
    putObsCondition();
    localStorage.setItem(GACHA_STAGE_ENABLED_KEY, "true");
    mocks.isStageOverlayOpen.mockResolvedValue(true);

    render(<CommentViewerApp />);
    emitConnected();
    await act(async () => {});

    expect(mocks.stream.enableObs).not.toHaveBeenCalled();
  });

  it("⚠⚠ 063c: トグルの書換を storage で受けると、猶予後に enableObs が飛ぶ", async () => {
    vi.useFakeTimers();
    try {
      putGachaCondition();
      render(<CommentViewerApp />);
      emitConnected();
      await act(async () => {});

      emitSettingChange(GACHA_STAGE_ENABLED_KEY, "true");
      await act(() => vi.advanceTimersByTimeAsync(10_000));

      expect(mocks.stream.enableObs).toHaveBeenCalledWith(4455, "stage");
      expect(mocks.stream.enableObs).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("⚠⚠⚠ 063c: 割り当てを全部消すと hideObs が飛ぶ（OBS への接続が残り続けない）", async () => {
    vi.useFakeTimers();
    try {
      putGachaCondition();
      localStorage.setItem(GACHA_STAGE_ENABLED_KEY, "true");
      // ⚠ 接続時 reconcile は**実窓があるときだけ**送る（046d レビュー＝空ソースを残さない）。
      mocks.isStageOverlayOpen.mockResolvedValue(true);
      render(<CommentViewerApp />);
      emitConnected();
      await act(async () => {});
      await act(() => vi.advanceTimersByTimeAsync(10_000));
      expect(mocks.stream.enableObs).toHaveBeenCalledWith(4455, "stage");

      // main 窓でガチャの割り当てを「出さない」へ戻した（＝条件キーが書き換わる）。
      emitSettingChange(EFFECT_ASSIGNMENTS_KEY, JSON.stringify([]));

      expect(mocks.stream.hideObs).toHaveBeenCalledWith(4455, "stage");
    } finally {
      vi.useRealTimers();
    }
  });

  it("⚠⚠⚠ 063c: 条件を編集しただけでは OBS を触らない（エッジ検出・064 S-1 と同型）", async () => {
    // ⚠⚠ **ここが「条件キーを購読対象に足した」ことの代償を殺しているケースである。**
    //   レベル判定のままだと、ガチャを使っていないユーザーが**キーワード条件を 1 つ打つたびに**
    //   `hideObs("stage")` が OBS へ飛ぶ（＝ユーザーが何もしていないのに OBS を触りに行く）。
    //   ⚠ 064 レビュー S-1 の②が「無条件に打たない」を選んだのとまったく同じ理由。
    render(<CommentViewerApp />);
    emitConnected();
    await act(async () => {});

    emitSettingChange(EFFECT_ASSIGNMENTS_KEY, JSON.stringify([]));
    emitSettingChange(
      EFFECT_ASSIGNMENTS_KEY,
      JSON.stringify([
        {
          id: "kw:1",
          when: { type: "keyword", text: "草", match: "contains" },
          effect: { kind: "obs-source", sourceName: "きらきら演出" },
        },
      ]),
    );

    expect(mocks.stream.hideObs).not.toHaveBeenCalled();
    expect(mocks.stream.enableObs).not.toHaveBeenCalled();
  });

  /**
   * ⚠⚠⚠ **063c 段 1 レビュー Q-1（修正）: エッジ検出の `enable` 側が固定できていなかった。**
   *
   * 上のケースは**ガードが false のまま**条件を編集する形なので、殺せるのは `else` 側
   * （`hideObs`）だけである。⚠ **`if (changed) scheduleObsAutoAdd("stage")` から `if (changed)` を
   * 外す変異は、レビュー時点で全 1893 件が緑のまま通過した**（実測）。
   * ⇒ そのとき起きるのは「**ガードが true で安定しているユーザーが、条件を 1 つ編集するたびに
   * `enableObs` を OBS へ撃ち直す**」＝ `hideObs` 側で潰した失敗モードの鏡像である
   * （`setObsState("connecting")` も毎回走るのでツールバーが点滅する）。
   * ⇒ **ガードが true のまま条件が変わる**形で撃ち直しの有無を見る。
   */
  it("⚠⚠⚠ 063c: ガードが true のまま条件を編集しても enableObs を撃ち直さない（エッジ検出の enable 側）", async () => {
    vi.useFakeTimers();
    try {
      putGachaCondition();
      localStorage.setItem(GACHA_STAGE_ENABLED_KEY, "true");
      // ⚠ 接続時 reconcile は**実窓があるときだけ**送る（046d レビュー＝空ソースを残さない）。
      mocks.isStageOverlayOpen.mockResolvedValue(true);
      render(<CommentViewerApp />);
      emitConnected();
      await act(async () => {});
      await act(() => vi.advanceTimersByTimeAsync(10_000));
      expect(mocks.stream.enableObs).toHaveBeenCalledTimes(1);

      // ⚠⚠ **ガチャを指す条件は残したまま**、無関係なキーワード条件を 1 件足す
      //   （＝ `isStageOverlayRequired()` は true → true で変わらない）。
      emitSettingChange(
        EFFECT_ASSIGNMENTS_KEY,
        JSON.stringify([
          {
            id: "event:superchat",
            when: { type: "event", eventType: "superchat" },
            effect: { kind: "gacha", gachaId: "g:1" },
          },
          {
            id: "kw:1",
            when: { type: "keyword", text: "草", match: "contains" },
            effect: { kind: "obs-source", sourceName: "きらきら演出" },
          },
        ]),
      );
      await act(() => vi.advanceTimersByTimeAsync(10_000));

      // ⚠⚠⚠ **撃ち直していない**（`if (changed)` を外すとここがレッドになる）。
      expect(mocks.stream.enableObs).toHaveBeenCalledTimes(1);
      expect(mocks.stream.hideObs).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("⚠⚠ 063c: 061l の旗は無改変で効き続ける（開催中はガチャのトグルが OFF でも送る）", async () => {
    vi.useFakeTimers();
    try {
      localStorage.setItem(GACHA_STAGE_ENABLED_KEY, "false");
      render(<CommentViewerApp />);
      emitConnected();
      await act(async () => {});

      emitSettingChange(STAGE_OVERLAY_ENABLED_KEY, "true");
      await act(() => vi.advanceTimersByTimeAsync(10_000));

      expect(mocks.stream.enableObs).toHaveBeenCalledWith(4455, "stage");
    } finally {
      vi.useRealTimers();
    }
  });

  it("即時反映: 表示 ON の書換を storage で受けると、猶予後に enableObs が飛ぶ", async () => {
    vi.useFakeTimers();
    try {
      render(<CommentViewerApp />);
      emitConnected();
      await act(async () => {});

      emitSettingChange(STAGE_OVERLAY_ENABLED_KEY, "true");
      // 猶予（OBS_ENABLE_DELAY_MS）を経由する＝同期では飛ばない。
      // ⚠ 固定しているのは猶予の**長さ**ではなく「タイマー（マクロタスク）を経由する」という一点
      //（既存 045c のケースと同じ粒度）。
      expect(mocks.stream.enableObs).not.toHaveBeenCalled();

      await act(() => vi.advanceTimersByTimeAsync(10_000));
      expect(mocks.stream.enableObs).toHaveBeenCalledWith(4455, "stage");
      // 二重発火するミューテーションを素通りさせないよう回数も固定する。
      expect(mocks.stream.enableObs).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("⚠ 猶予中に表示 OFF にすると enableObs は飛ばず、hideObs だけが飛ぶ", async () => {
    vi.useFakeTimers();
    try {
      render(<CommentViewerApp />);
      emitConnected();
      await act(async () => {});

      emitSettingChange(STAGE_OVERLAY_ENABLED_KEY, "true"); // 猶予が仕掛かる
      emitSettingChange(STAGE_OVERLAY_ENABLED_KEY, "false"); // 経過前に OFF

      expect(mocks.stream.hideObs).toHaveBeenCalledWith(4455, "stage");

      await act(() => vi.advanceTimersByTimeAsync(10_000));
      // ⚠ ここが 045c が踏んだ回帰そのもの。hideObs の**後に** enableObs が飛ぶと、
      // OBS 側で「表示 OFF にしたはずのソース」が再表示される。
      expect(mocks.stream.enableObs).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  // ⚠⚠⚠ **064e: 「猶予中に自動反映 OFF にしても enableObs は飛ばない」2 ケースを 1 本へ畳んだ。**
  //   （061k レビュー S-1 が `"effects"` / `"stage"` の非対称を潰すために 2 本にしたもの。
  //   ⚠ 064d でコーナー窓が消え、064e で連携トグルが消えたので、**軸が 2 つとも無くなった**。）
  //   ⚠ **`clearObsEnableTimer("stage")` を守る役目は下のケースが引き継ぐ**——契機が
  //   「連携 OFF」から「**配信イベントの終了**」へ変わっただけで、守りたい壊れ方は同じ＝
  //   **ユーザーがやめたのに `enableObs("stage")` が遅れて飛ぶ**（045c 回帰の再発）。
  it("⚠⚠ 064e: 猶予中に配信イベントを終了したら enableObs は飛ばない", async () => {
    vi.useFakeTimers();
    try {
      render(<CommentViewerApp />);
      emitConnected();
      await act(async () => {});

      emitSettingChange(STAGE_OVERLAY_ENABLED_KEY, "true"); // 開始＝猶予が仕掛かる
      emitSettingChange(STAGE_OVERLAY_ENABLED_KEY, "false"); // 経過前に終了

      await act(() => vi.advanceTimersByTimeAsync(10_000));
      // ⚠ **本命**: `clearObsEnableTimer("stage")` を消すとここが RED になる。
      expect(mocks.stream.enableObs).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("⚠ アンマウントで猶予タイマーが取り消される（破棄済みツリーへ発火させない）", async () => {
    vi.useFakeTimers();
    try {
      const { unmount } = render(<CommentViewerApp />);
      emitConnected();
      await act(async () => {});

      emitSettingChange(STAGE_OVERLAY_ENABLED_KEY, "true"); // 猶予が仕掛かる
      unmount();

      await act(() => vi.advanceTimersByTimeAsync(10_000));
      expect(mocks.stream.enableObs).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("⚠ エフェクトの表示 OFF で disableObs を呼ばない（他 2 種の連携を巻き添えにしない）", async () => {
    localStorage.setItem(STAGE_OVERLAY_ENABLED_KEY, "true");
    mocks.isStageOverlayOpen.mockResolvedValue(true);
    render(<CommentViewerApp />);
    emitConnected();
    await act(async () => {});

    emitSettingChange(STAGE_OVERLAY_ENABLED_KEY, "false");

    expect(mocks.stream.hideObs).toHaveBeenCalledWith(4455, "stage");
    // `disableObs` は kind を取らず sidecar の状態を丸ごと idle にするので、ここでは使わない。
    expect(mocks.stream.disableObs).not.toHaveBeenCalled();
  });

  // ⚠⚠⚠ **064e: 「自動反映 OFF のときは表示 ON/OFF で OBS へ一切繋がない」を削除した。**
  //   設定が消えた（既定 ON）ので、前提そのものが存在しない。
  //   ⚠ §1 のガードは上のケース（**開催していなければ送らない**）が引き継いでいる。

  it("⚠⚠ 064e: コメント側のトグル（OBS_AUTO_ADD_KEY）はステージの反映を左右しない", async () => {
    vi.useFakeTimers();
    try {
      // ⚠⚠ **061a は「2 つの設定は独立」を、片方だけ ON にして「動かない」ことで固定していた。**
      //   064e でエフェクト側の設定が消えたので、**独立の意味が逆向きになった**——
      //   ⇒ **コメント側が OFF でもステージは反映される**（＝あちらに引きずられない）。
      //   ⚠ ここが壊れると「コメントの OBS 連携を切っている人は玉入れが配信画面に出ない」になる。
      expect(localStorage.getItem(OBS_AUTO_ADD_KEY)).toBeNull(); // コメント側は OFF
      render(<CommentViewerApp />);
      emitConnected();
      await act(async () => {});

      emitSettingChange(STAGE_OVERLAY_ENABLED_KEY, "true");
      await act(() => vi.advanceTimersByTimeAsync(10_000));

      expect(mocks.stream.enableObs).toHaveBeenCalledWith(4455, "stage");
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
      render(<CommentViewerApp />);
      emitConnected();
      await act(async () => {});

      emitSettingChange(STAGE_OVERLAY_ENABLED_KEY, "true"); // 猶予が仕掛かる

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
      localStorage.setItem(STAGE_OVERLAY_ENABLED_KEY, "true");
      mocks.isStageOverlayOpen.mockResolvedValue(true);
      render(<CommentViewerApp />);
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

  // ⚠⚠ **064e: 「自動反映を後から ON にすると、既に表示中なら即反映する」を削除した。**
  //   ⚠ **操作そのものが無くなった**（トグルが消えて既定 ON）。
  //   ⚠ あのケースが守っていた「**既に開いている窓には猶予なしで反映する**」は、
  //   上の**保証ベースライン（WS 接続確立時の reconcile）**が同じ経路
  //   （`requestStageObsAutoAddIfOpen`）で固定し続けている。
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
    localStorage.setItem(STAGE_OVERLAY_ENABLED_KEY, "true");
    mocks.isStageOverlayOpen.mockResolvedValue(true);
    render(<CommentViewerApp />);
    emitConnected();
    await waitFor(() =>
      expect(mocks.stream.enableObs).toHaveBeenCalledWith(4455, "stage"),
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

  // ⚠⚠⚠ **064e: T1 / T2（「エフェクトの自動反映を OFF にすると赤字が消える／消さない」）を
  //   書き換えた。** 連携トグルが消えた（既定 ON）ので、**「OFF にする」という操作が存在しない**。
  //   ⚠ **061e が守っていた 2 つの規律はどちらも生きている**ので、契機を差し替えて残す:
  //     - T1 の規律「後始末で `obsState` を idle へ戻す」 → **配信イベントの終了**（下の T4 が担当）
  //     - T2 の規律「共有 `obsState` を無条件に倒さない（他種別の赤字を巻き添えにしない）」
  //       → ⚠ **`clear()` 経路へ移した**（下の T2' ）。064e 以前は連携 OFF がこの規律の入口だった。

  it("⚠⚠ T2' (穴 1・064e): コメント側の連携が ON なら、clear() で赤字を消さない", async () => {
    // ⚠⚠ **ここが穴 1 の答え**。`obsState` は 3 種別で 1 本なので、無条件に idle へ倒すと
    // **comments / pinned の失敗の赤字まで巻き添えで消える**（＝失敗が黙って出なくなる／061e が
    // 直そうとしている症状そのものを 061e が作る）。
    // ⚠ `!loadObsAutoAdd()` のガードを外す変異でレッドになるのはこのケース。
    // ⚠⚠ **064e で入口が「連携 OFF」から `clear()` へ移った**——ゲートを外したとき、
    //   `clear()` ぶんの後始末を `STAGE_OVERLAY_ENABLED_KEY` 分岐へ移設したため
    //   （`CommentViewerApp` の該当箇所のコメントが正）。
    localStorage.setItem(OBS_AUTO_ADD_KEY, "true"); // コメント側の連携は ON のまま
    await renderWithEffectFailure();

    localStorage.clear();
    localStorage.setItem(OBS_AUTO_ADD_KEY, "true"); // clear() 後もコメント側は ON という状況
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: null }));
    });

    expect(screen.getByText(OBS_ERROR_TEXT)).toBeInTheDocument();
    // ⚠⚠ **`clear()` では OBS へ何も送らない**（061a Q-4＝`clear()` に副作用を持たせない）。
    //   ⚠ 064e でゲートを外したとき、ここを守り直さないと `hideObs` が飛び始める。
    expect(mocks.stream.hideObs).not.toHaveBeenCalled();
    expect(mocks.stream.disableObs).not.toHaveBeenCalled();
  });

  it("T4 (回帰): エフェクトの表示を OFF にすると赤字が消える（061a の既存挙動）", async () => {
    // 表示 OFF は OBS 側も非表示にする（`hideObs`）ので、直前の結果は実態と食い違う＝ idle へ戻す。
    // ⚠ こちらは 061a から在る経路で、061e では**触っていない**（回帰として固定するだけ）。
    await renderWithEffectFailure();
    expect(screen.getByText(OBS_ERROR_TEXT)).toBeInTheDocument();

    emitSettingChange(STAGE_OVERLAY_ENABLED_KEY, "false");

    expect(mocks.stream.hideObs).toHaveBeenCalledWith(4455, "stage");
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

    emitSettingChange(STAGE_OVERLAY_ENABLED_KEY, "false");

    expect(mocks.stream.hideObs).toHaveBeenCalledWith(4455, "stage");
    expect(screen.queryByText(OBS_ERROR_TEXT)).not.toBeInTheDocument();
  });

  it("⚠⚠ T6 (実機③後半): 残った赤字は、sidecar の echo（obs.state = idle）が着弾すれば消える", async () => {
    // ⚠⚠ **progress の「テストで固定できていない」②を、frontend の責務の範囲で固定する。**
    // コメント側の表示 OFF / 連携 OFF は `hideObs` / `disableObs` を送り、sidecar が
    // `obs.state = idle` を broadcast し返す（`obs-client.ts` の `hide()` は `finally { onState("idle") }`、
    // `disable()` は `onState("idle")`）。**sidecar が必ず idle を返すこと自体は sidecar の責務**だが、
    // **その echo が着弾したら赤字を消すことは frontend の責務**で、ここはテストできる。
    // ⚠ これが T2'（＝共有 obsState を巻き添えで倒さない）と両立して初めて
    // 「(b) は消せない赤字を作らない」＝残った赤字にも必ず出口がある、が成立する。
    // ⚠⚠ **064e: 「連携 OFF で残った赤字」という前段が無くなった**ので、
    //   **エフェクト由来の failed がそのまま残っている状態**から echo を当てる形にした
    //   （見たいのは「idle の echo が着弾したら消えること」であって、残り方ではない）。
    localStorage.setItem(OBS_AUTO_ADD_KEY, "true"); // コメント側の連携は ON のまま
    await renderWithEffectFailure();
    expect(screen.getByText(OBS_ERROR_TEXT)).toBeInTheDocument();

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
    localStorage.setItem(STAGE_OVERLAY_ENABLED_KEY, "true");
    mocks.isStageOverlayOpen.mockResolvedValue(true);

    const first = render(<CommentViewerApp />);
    emitConnected();
    await waitFor(() =>
      expect(mocks.stream.enableObs).toHaveBeenCalledWith(4455, "stage"),
    );
    emitObsState("failed");
    expect(screen.getByText(OBS_ERROR_TEXT)).toBeInTheDocument();

    // 窓を閉じる＝アンマウント。`obsState` は窓ごとの state なので次のマウントでは idle から始まる。
    first.unmount();
    mocks.stream.enableObs.mockClear();

    render(<CommentViewerApp />);
    emitConnected();
    await waitFor(() =>
      expect(mocks.stream.enableObs).toHaveBeenCalledWith(4455, "stage"),
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
    localStorage.setItem(STAGE_OVERLAY_ENABLED_KEY, "true");
    mocks.isStageOverlayOpen.mockResolvedValue(true);
    render(<CommentViewerApp />);
    emitConnected();
    await waitFor(() =>
      expect(mocks.stream.enableObs).toHaveBeenCalledWith(4455, "stage"),
    );

    // ⚠⚠ **064e: 「連携 OFF」から「配信イベントの終了」へ契機を差し替えた**（操作が無くなったため）。
    //   終了は `hideObs` を送り、コメント側も OFF（`OBS_AUTO_ADD_KEY` を立てていない）なので idle へ倒れる。
    emitSettingChange(STAGE_OVERLAY_ENABLED_KEY, "false");
    expect(screen.queryByText(OBS_ERROR_TEXT)).not.toBeInTheDocument();

    // 送出済みだった反映要求の結果が、遅れて届く。
    emitObsState("failed");

    expect(screen.getByText(OBS_ERROR_TEXT)).toBeInTheDocument();
  });

  it("⚠⚠ T9' (064e で挙動が変わった): 遅れて着弾した赤字は「終了」で必ず消える", async () => {
    // ⚠⚠⚠ **064e で仕様が変わったケースである（＝書き換えた理由を残す）。**
    //   旧 T9 は「その赤字は**表示 OFF では消えない**」を固定していた。根拠は
    //   **表示 OFF の後始末（`hideObs` ＋ idle）が `loadEffectObsAutoAdd()` が真のときだけ走る**ことで、
    //   既に連携 OFF になっている状態では後始末そのものに入らなかったため
    //   （progress の「表示 OFF または自動反映 OFF のどちらかで必ず消える」が**不正確**だった、
    //   という 061e レビュー Q-1 の訂正）。
    //   ⚠ **064e でそのゲートを外した**ので、**後始末は必ず走る＝出口が 1 つに戻った。**
    //   ⇒ 「消せない赤字」が構造的に無くなった（061e が (b) で気にしていた形が 1 つ減った）。
    localStorage.setItem(STAGE_OVERLAY_ENABLED_KEY, "true");
    mocks.isStageOverlayOpen.mockResolvedValue(true);
    render(<CommentViewerApp />);
    emitConnected();
    await waitFor(() =>
      expect(mocks.stream.enableObs).toHaveBeenCalledWith(4455, "stage"),
    );
    emitObsState("failed");
    expect(screen.getByText(OBS_ERROR_TEXT)).toBeInTheDocument();

    emitSettingChange(STAGE_OVERLAY_ENABLED_KEY, "false"); // 終了

    expect(screen.queryByText(OBS_ERROR_TEXT)).not.toBeInTheDocument();
    // ⚠ 終了では OBS 側を**非表示にする**（ソースは消さない・064d の判断）。
    expect(mocks.stream.hideObs).toHaveBeenCalledWith(4455, "stage");
  });

  it("⚠⚠ T10 (実機④・(C) の目的): エフェクトの成功でも設定カードは「OBSに表示しました。」と出る", async () => {
    // ⚠⚠ **(C) が直したのはここ**。旧文「OBSにコメントを表示しました。」は、`obsState` が 3 種別で
    // 共有されているせいで**エフェクトの成功でも出て嘘になっていた**。
    // ⚠ `SettingsView.obs.test.tsx` は props で `obsState` を渡す単体テストなので、
    // 「**エフェクト由来の added が実際にこのカードへ届く**」経路はここでしか固定できない。
    localStorage.setItem(STAGE_OVERLAY_ENABLED_KEY, "true");
    mocks.isStageOverlayOpen.mockResolvedValue(true);
    render(<CommentViewerApp />);
    emitConnected();
    await waitFor(() =>
      expect(mocks.stream.enableObs).toHaveBeenCalledWith(4455, "stage"),
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

  it('⚠⚠ 新規 9: stage キーの `storage` で `enableObs("stage")` を出す（`"effects"` を巻き添えにしない）', async () => {
    vi.useFakeTimers();
    try {
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

  it('⚠⚠ 新規 9: stage キーが false になったら `hideObs("stage")` を出す（`"effects"` は触らない）', async () => {
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
    localStorage.setItem(STAGE_OVERLAY_ENABLED_KEY, "true");
    // ⚠ コーナー側の派生値は false（＝条件が corner に 1 件も無い）。
    mocks.isStageOverlayOpen.mockResolvedValue(true);
    mocks.isStageOverlayOpen.mockResolvedValue(true);

    render(<CommentViewerApp />);
    emitConnected();

    await waitFor(() =>
      expect(mocks.stream.enableObs).toHaveBeenCalledWith(4455, "stage"),
    );
    expect(mocks.stream.enableObs).not.toHaveBeenCalledWith(4455, "effects");
  });

  it('⚠ 新規 9: ステージ窓が実在しないなら `enableObs("stage")` を送らない（空ソースを残さない）', async () => {
    // ⚠ 046d レビューと同じ理由——設定 ON ／ 窓なしで送ると sidecar 側 `ensureOverlaySource` が
    //   先に `CreateInput` してから窓を探して失敗し、**キャプチャ対象未設定の空ソースが OBS に残る**。
    localStorage.setItem(STAGE_OVERLAY_ENABLED_KEY, "true");
    mocks.isStageOverlayOpen.mockResolvedValue(false);

    render(<CommentViewerApp />);
    emitConnected();
    await act(async () => {});

    expect(mocks.stream.enableObs).not.toHaveBeenCalledWith(4455, "stage");
  });
  // --- 064a: OBS 側のソースを鳴らす方式（main 窓の依頼をこの窓が代行する）-------------------------

  /**
   * ⚠⚠ **main 窓は WS を持たないので、代行できるのはこの窓だけ**である（構造上の非対称）。
   * ここが繋がっていないと、main 窓のボタンは**押しても何も起きない**（無言の故障）になる。
   */
  it("⚠⚠ 064a: 一覧の依頼（storage）を受けて `listObsSources` を送る", async () => {
    render(<CommentViewerApp />);
    emitConnected();
    await act(async () => {});

    emitSettingChange(OBS_SOURCE_LIST_REQUEST_KEY, "1700000000000-1");

    // ⚠ port は検出値が無ければ既定 4455（`requestObsHide` と同じ規則）。
    expect(mocks.stream.listObsSources).toHaveBeenCalledWith(4455);
  });

  it("⚠⚠ 064a: 発火の依頼（storage）を受けて `fireObsSource` へソース名と長さを渡す", async () => {
    render(<CommentViewerApp />);
    emitConnected();
    await act(async () => {});

    emitSettingChange(
      OBS_SOURCE_TEST_FIRE_KEY,
      "1700000000000-1:5000:きらきら演出",
    );

    expect(mocks.stream.fireObsSource).toHaveBeenCalledWith(
      4455,
      "きらきら演出",
      5000,
    );
  });

  it("⚠ 064a: 壊れた依頼は何もしない（黙って落とす）", async () => {
    render(<CommentViewerApp />);
    emitConnected();
    await act(async () => {});

    for (const broken of ["", "no-colon", "1700000000000-1:5000:"]) {
      emitSettingChange(OBS_SOURCE_TEST_FIRE_KEY, broken);
    }
    expect(mocks.stream.fireObsSource).not.toHaveBeenCalled();
  });

  /**
   * ⚠⚠ **`clear()`（`e.key === null`）では OBS を触らない。**
   * 061a Q-4 で確定した受容（「全部消す」は「OBS を触れ」ではない）を、新しい 2 経路にも適用する。
   * ⚠ ここが緩むと、他窓の `localStorage.clear()` だけで **OBS へソース発火が飛ぶ**。
   */
  it("⚠⚠ 064a: localStorage.clear() では OBS を触らない", async () => {
    render(<CommentViewerApp />);
    emitConnected();
    await act(async () => {});

    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: null }));
    });

    expect(mocks.stream.listObsSources).not.toHaveBeenCalled();
    expect(mocks.stream.fireObsSource).not.toHaveBeenCalled();
  });
});

/**
 * 064b: **コメントの条件が当たったら OBS 側のソースを鳴らす**（方針転換の本体）の仕様テスト。
 *
 * ⚠⚠ **なぜこの窓なのか**: sidecar と WS で繋がっているのは**この窓だけ**なので、
 * OBS を鳴らせるのもこの窓だけである（064a の代行と同じ構造上の非対称）。
 *
 * ⚠⚠ 固定したい不変条件:
 * - **条件を設定していなければ 1 回も鳴らない**（黙って何かが起きる状態を作らない）。
 * - ⚠⚠ **1 コメントで 2 回鳴らない**——React StrictMode は `setState` の updater を
 *   二重実行するので、発火を updater の中に入れると**必ず二重発火する**。
 *   ここは「同じコメントを 2 回流しても 1 回」で、その構造（updater の外＋ id の集合）を固定する。
 * - **第三者のコメント本文は OBS へ 1 バイトも渡らない**（渡るのはソース名だけ・§9）。
 */
const OBS_ASSIGNED_SOURCE = "きらきら演出";

/** 064b: 条件を 1 件だけ保存する（イベント条件・スーパーチャットに OBS ソースを割り当てる）。 */
function putObsCondition(sourceName = OBS_ASSIGNED_SOURCE) {
  localStorage.setItem(
    EFFECT_ASSIGNMENTS_KEY,
    JSON.stringify([
      {
        id: "event:superchat",
        when: { type: "event", eventType: "superchat" },
        effect: { kind: "obs-source", sourceName },
      },
    ]),
  );
}

const superchat = (over: Partial<CommentViewDto> = {}): CommentViewDto => ({
  id: "c1",
  source: "youtube",
  author: { id: "u1", name: "視聴者A" },
  text: "本文です",
  publishedAt: "2026-08-15T00:00:00Z",
  eventType: "superchat",
  monetaryAmount: "¥1,000",
  monetary: { amount: 1000, currency: "JPY" },
  ...over,
});

/** sidecar からのコメント到着を再現する（実 WS は張らないので捕捉した handlers を直接叩く）。 */
function emitComments(comments: CommentViewDto[]) {
  expect(mocks.handlers.current).not.toBeNull();
  act(() => mocks.handlers.current?.onComments?.(comments));
}

describe("064b: コメントで OBS のソースを鳴らす", () => {
  it("⚠⚠ 条件に当たったら鳴らす（発火の持ち主はこの窓）", async () => {
    putObsCondition();
    render(<CommentViewerApp />);
    emitConnected();
    await act(async () => {});

    emitComments([superchat()]);

    expect(mocks.stream.fireObsSource).toHaveBeenCalledWith(
      4455,
      OBS_ASSIGNED_SOURCE,
      OBS_SOURCE_FALLBACK_DURATION_MS,
    );
  });

  it("⚠⚠ 条件を設定していなければ 1 回も鳴らない", async () => {
    render(<CommentViewerApp />);
    emitConnected();
    await act(async () => {});

    emitComments([superchat()]);

    expect(mocks.stream.fireObsSource).not.toHaveBeenCalled();
  });

  it("⚠ 条件に当たらないコメントでは鳴らない", async () => {
    // ⚠⚠ 063e 段 2: 旧題は「（課金ゲート）」だったが、**その課金ゲートは削除した**
    //   （論証は `effectAssignments.ts` の `createConditionMatcher` の JSDoc が正）。
    //   ⚠ 鳴らない理由は「chat が条件表の集合に無いので、そもそも条件が存在しない」である。
    putObsCondition();
    render(<CommentViewerApp />);
    emitConnected();
    await act(async () => {});

    emitComments([superchat({ id: "chat1", eventType: "chat" })]);

    expect(mocks.stream.fireObsSource).not.toHaveBeenCalled();
  });

  it("⚠⚠⚠ 063e 段 2: チャンネルポイントの引き換えで鳴る（端から端まで）", async () => {
    // ⚠⚠⚠ **これが 063e 段 2 の完了条件そのものである**——sidecar から届いた
    //   `eventType: "channelpoint"` のコメントが、割り当て表の条件に当たって OBS を鳴らすところまで。
    // ⚠⚠ **段 1 の実装ではここが 1 回も鳴らなかった**（照合の直前の課金ゲートが落としていた）。
    //   症状は「条件表に行は出るのに、選んでも何も起きない」＝ 061a Q-1 が最も嫌う形。
    localStorage.setItem(
      EFFECT_ASSIGNMENTS_KEY,
      JSON.stringify([
        {
          id: "event:channelpoint",
          when: { type: "event", eventType: "channelpoint" },
          effect: { kind: "obs-source", sourceName: OBS_ASSIGNED_SOURCE },
        },
      ]),
    );
    render(<CommentViewerApp />);
    emitConnected();
    await act(async () => {});

    emitComments([
      superchat({
        id: "cp1",
        source: "twitch",
        eventType: "channelpoint",
        text: "がんばれー！",
        // ⚠ チャンネルポイントは**金額を持たない**（063e 段 1 の決定）。
        monetaryAmount: undefined,
        monetary: undefined,
      }),
    ]);

    expect(mocks.stream.fireObsSource).toHaveBeenCalledWith(
      4455,
      OBS_ASSIGNED_SOURCE,
      OBS_SOURCE_FALLBACK_DURATION_MS,
    );
  });

  it("⚠⚠ 同じコメントが 2 度届いても 1 回しか鳴らない（[043e] の combo 再送）", async () => {
    putObsCondition();
    render(<CommentViewerApp />);
    emitConnected();
    await act(async () => {});

    emitComments([superchat()]);
    emitComments([superchat()]);

    expect(mocks.stream.fireObsSource).toHaveBeenCalledTimes(1);
  });

  it("⚠⚠ StrictMode でも 1 コメントにつき 1 回しか鳴らない", async () => {
    // ⚠⚠ **StrictMode は `setState` の updater と描画を二重に実行する。** ここで固定するのは
    //   「その二重実行が発火まで漏れてこない」ことで、担保しているのは
    //   [`takeFreshComments`]（id の集合・ref なので二重実行を跨いで残る）である。
    //
    // ⚠⚠ **正直な限界（実際に変異させて確かめた）**: 「発火を `setComments` の updater の中へ移す」
    //   変異は**このケースでも落ちない**——updater が 2 回走っても、2 回目は id の集合で空になるため。
    //   ＝ **updater の外に置く規律はテストでは固定できていない**（規律として守るもの）。
    //   ⚠ **id の集合を外す変異を殺すのは「2 度届いても 1 回」のケースのほう**（ここは 1 回しか
    //   流さないので落ちない）。⇒ 2 つは**別の経路を見ている**ので、どちらも消さないこと。
    //   ⚠ **`<StrictMode>` を外さないこと**（外すと二重実行そのものが再現されなくなる）。
    putObsCondition();
    render(
      <StrictMode>
        <CommentViewerApp />
      </StrictMode>,
    );
    emitConnected();
    await act(async () => {});

    emitComments([superchat()]);

    expect(mocks.stream.fireObsSource).toHaveBeenCalledTimes(1);
  });

  it("⚠⚠ ソース名が不正な条件は鳴らさない（多層防御の 1 枚目）", async () => {
    putObsCondition("   ");
    render(<CommentViewerApp />);
    emitConnected();
    await act(async () => {});

    emitComments([superchat()]);

    expect(mocks.stream.fireObsSource).not.toHaveBeenCalled();
  });

  it("⚠⚠ OBS へ渡るのはソース名だけ（第三者の本文・表示名は渡さない・§9）", async () => {
    putObsCondition();
    render(<CommentViewerApp />);
    emitConnected();
    await act(async () => {});

    emitComments([
      superchat({
        text: "これは第三者の本文です",
        author: { id: "u9", name: "第三者の名前" },
      }),
    ]);

    expect(mocks.stream.fireObsSource).toHaveBeenCalledTimes(1);
    const args = JSON.stringify(mocks.stream.fireObsSource.mock.calls[0]);
    expect(args).not.toContain("第三者");
  });

  it("⚠ 検出済みのポートへ送る（既定 4455 へ落とさない）", async () => {
    // ⚠ 064a の `requestObsSourceFire` と同じ経路を使っていることの裏取り。
    putObsCondition();
    render(<CommentViewerApp />);
    emitConnected();
    await act(async () => {});

    emitComments([superchat()]);

    expect(mocks.stream.fireObsSource.mock.calls[0][0]).toBe(4455);
  });
});

/**
 * ⚠⚠⚠ **063c 段 2-a: 当選結果の配り先**（OBS を鳴らす／ステージ窓へ送る）。
 *
 * ⚠ この窓が持つ責務は **「`decideFireResults` の戻り値を配ること」だけ**である
 * （抽選も表示名の決定もこの窓は持たない）。⇒ ここが固定するのは配り方の 4 点:
 *   1. **`obs-source` は OBS を鳴らす**（064a の実在照合の壁を通る経路）
 *   2. ⚠⚠⚠ **`builtin` は OBS へ 1 バイトも出さない**（壁の向こうへ行かない）
 *   3. **ガチャ由来はステージ窓へ送る**（景品の表示名つき）
 *   4. ⚠⚠ **条件への直指定は送らない**（`gacha === null` ＝ ガチャではない）
 */
describe("063c 段 2-a: 当選結果の配り先", () => {
  /** 100% で 1 件だけ当たるガチャを仕込む（⚠ `Math.random` に依存せず結果が決まる）。 */
  const putGacha = (
    output: { kind: "builtin" } | { kind: "obs-source"; sourceName: string },
    name = "大当たり",
    weight = 1000,
  ) => {
    localStorage.setItem(
      GACHA_LIBRARY_KEY,
      JSON.stringify([
        { id: "g:1", name: "ガチャ", prizes: [{ name, weight, output }] },
      ]),
    );
    localStorage.setItem(
      EFFECT_ASSIGNMENTS_KEY,
      JSON.stringify([
        {
          id: "event:superchat",
          when: { type: "event", eventType: "superchat" },
          effect: { kind: "gacha", gachaId: "g:1" },
        },
      ]),
    );
  };

  const fire = async () => {
    render(<CommentViewerApp />);
    emitConnected();
    await act(async () => {});
    emitComments([superchat()]);
  };

  it("⚠ ガチャで OBS ソースが当たったら、直指定と同じ経路で鳴らす", async () => {
    putGacha({ kind: "obs-source", sourceName: OBS_ASSIGNED_SOURCE });
    await fire();
    expect(mocks.stream.fireObsSource).toHaveBeenCalledWith(
      4455,
      OBS_ASSIGNED_SOURCE,
      OBS_SOURCE_FALLBACK_DURATION_MS,
    );
  });

  it("⚠⚠⚠ 組み込みの景品は OBS へ 1 バイトも出ない（064a の壁の向こうへ行かない）", async () => {
    putGacha({ kind: "builtin" });
    await fire();
    expect(mocks.stream.fireObsSource).not.toHaveBeenCalled();
    // ⚠ それでも演出は出る（＝「何も起きない」ではない）。
    expect(mocks.emitGachaStageResult).toHaveBeenCalledTimes(1);
  });

  it("⚠⚠ ガチャ由来はステージ窓へ景品の表示名つきで送る", async () => {
    putGacha({ kind: "obs-source", sourceName: OBS_ASSIGNED_SOURCE }, "特賞");
    await fire();
    // ⚠⚠ **`toHaveBeenCalledWith` で丸ごと一致**＝ **ペイロードにこれ以外が載っていない**ことの固定。
    //   ⚠⚠⚠ ここへ勝手にフィールドが増えると必ずレッドになる（§9 の網）。
    expect(mocks.emitGachaStageResult).toHaveBeenCalledWith({
      prizeLabel: "特賞",
      output: { kind: "obs-source", sourceName: OBS_ASSIGNED_SOURCE },
      viewerName: "視聴者A",
      // ⚠ 100%（weight 1000）の景品なので**レアではない**。
      rare: false,
    });
  });

  /**
   * ⚠⚠⚠ **063c 段 3: 確率が低い景品のときだけ `rare: true` を送る。**
   * ⚠ **10.0% ちょうどはレアではない**（`isGachaRarePrize` が `<` で見る）ので、
   * ここは**境界の 1 つ内側**（9.9% ＝ weight 99）で見る。
   */
  it("⚠⚠ 10% 未満の景品は rare: true で送る", async () => {
    // ⚠ 9.9% の景品なので**素の `Math.random` では当たらない**（分母は 1000 固定）。
    //   ⇒ 当てるところは固定して、**見るのは `rare` の値だけ**にする。
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      putGacha({ kind: "builtin" }, "極小", 99);
      await fire();
      expect(mocks.emitGachaStageResult).toHaveBeenCalledWith(
        expect.objectContaining({ prizeLabel: "極小", rare: true }),
      );
    } finally {
      random.mockRestore();
    }
  });

  it("⚠⚠ 条件への直指定はステージ窓へ送らない（ガチャではない）", async () => {
    putObsCondition();
    await fire();
    expect(mocks.stream.fireObsSource).toHaveBeenCalledTimes(1);
    expect(mocks.emitGachaStageResult).not.toHaveBeenCalled();
  });

  /**
   * ⚠⚠⚠ **063c 段 3 で §9 の線が動いた。** 段 2-a までは「第三者データは 1 バイトも渡さない」
   * だったが、依頼者の要望「**どのユーザーのガチャなのかが分かるようにしたい**」により
   * **表示名 1 本だけ**が渡るようになった（`docs/security.md` §9 追補が根拠）。
   *
   * ⚠⚠ **このテストは「渡らないこと」から「表示名だけが渡ること」へ書き換えたものである。**
   * ⚠ 消さないこと——**線がどこに在るかをコードで表現している唯一の場所**であり、
   * 本文や視聴者 id が混ざり込んだ瞬間にレッドになる網でもある。
   */
  it("⚠⚠⚠ §9: ステージ窓へ渡る第三者データは表示名だけ（本文・視聴者 id は 1 バイトも渡さない）", async () => {
    putGacha({ kind: "builtin" });
    render(<CommentViewerApp />);
    emitConnected();
    await act(async () => {});
    emitComments([
      superchat({
        text: "これは第三者の本文です",
        author: { id: "u9", name: "第三者の名前" },
      }),
    ]);
    const args = JSON.stringify(mocks.emitGachaStageResult.mock.calls[0]);
    // ⚠⚠ **本文と視聴者 id は渡らない**（型として載せる場所が無い）。
    expect(args).not.toContain("これは第三者の本文です");
    expect(args).not.toContain("u9");
    // ⚠⚠⚠ **表示名は渡る**（＝ 063c 段 3 が意図して開けた唯一の穴）。
    expect(mocks.emitGachaStageResult).toHaveBeenCalledWith(
      expect.objectContaining({ viewerName: "第三者の名前" }),
    );
  });

  /** ⚠ 名前が空でも**当選そのものは必ず出す**（付加情報だけを落とす）。 */
  it("⚠ 表示名が空なら viewerName は null（当選は出る）", async () => {
    putGacha({ kind: "builtin" });
    render(<CommentViewerApp />);
    emitConnected();
    await act(async () => {});
    emitComments([superchat({ author: { id: "u1", name: "" } })]);
    expect(mocks.emitGachaStageResult).toHaveBeenCalledWith(
      expect.objectContaining({ viewerName: null }),
    );
  });

  it("⚠ はずれ（合計 100% 未満で外れた）では OBS もステージ窓も動かない", async () => {
    localStorage.setItem(
      GACHA_LIBRARY_KEY,
      JSON.stringify([
        {
          id: "g:1",
          name: "ガチャ",
          // ⚠ 0.1%（＝ 1/1000）なので、`Math.random` がどう転んでもほぼ必ず外れる。
          prizes: [{ name: "極小", weight: 1, output: { kind: "builtin" } }],
        },
      ]),
    );
    localStorage.setItem(
      EFFECT_ASSIGNMENTS_KEY,
      JSON.stringify([
        {
          id: "event:superchat",
          when: { type: "event", eventType: "superchat" },
          effect: { kind: "gacha", gachaId: "g:1" },
        },
      ]),
    );
    const spy = vi.spyOn(Math, "random").mockReturnValue(0.99);
    try {
      await fire();
    } finally {
      spy.mockRestore();
    }
    expect(mocks.stream.fireObsSource).not.toHaveBeenCalled();
    expect(mocks.emitGachaStageResult).not.toHaveBeenCalled();
  });
});
