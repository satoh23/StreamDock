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
// ⚠⚠ 063f: **本文の持ち主はここではない**——テスト側で文面を組み立て直すと、
//   本体の文言を変えたときに**テストだけが古い文を主張して緑のまま**になる。⇒ 実物を呼ぶ。
import { buildGachaChatMessage } from "../obs-effects/gachaChatMessage";
// ⚠⚠ 063f 段 1-b: **演出の尺は `gachaStagePlayback.ts` が持つ**。
//   ⚠ ここに秒数を直書きすると、尺を変えたとき**テストだけが古い期待値で緑のまま**になる。
import { gachaChatDelayMs } from "../obs-effects/gachaStagePlayback";
// ⚠⚠ 063f 段 3: 表示名を切る長さの持ち主は `effectFire.ts` の 1 か所（テストもそこから引く）。
import { GACHA_VIEWER_NAME_MAX } from "../obs-effects/effectFire";
// ⚠ 063h 穴 C: セッション確定を**保留させる**ために掴む（モックの実体は下の vi.mock ファクトリ内）。
import { startStreamSession } from "../../features/stream-session/streamSessionApi";
// ⚠ 063h: バッファの上限（⚠ **テスト側に数字を直書きしない**＝実装が正）。
import { PENDING_GACHA_DRAW_LIMIT } from "../../features/gacha-history/pendingGachaDraws";
// ⚠ バースト上限（⚠ **テスト側に「3」を直書きしない**＝実装が正）。
import { EFFECT_MAX_CONCURRENT } from "../obs-effects/effectTrigger";

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
 * ## ⚠⚠⚠ 2026-09-05: stage の静音化（ゲートは 1 枚のまま・**結果を UI に出さなくなった**）
 *
 * 063c 段 1 レビュー S-4 の再修正トリガー（実機で「OBS 連携を OFF にしたのに OBS を触られた」＝
 * OBS 未起動でコメビュを開くたびステージ演出ぶんの接続失敗の赤字）が発火した。
 * ⚠ いったん `OBS_AUTO_ADD_KEY` の master switch 化で答えたが、**同日中に本人指示で撤回**——
 * 「あのトグルはコメントビューアの設定であって、OBS エフェクトとはユーザー的に別。
 * エフェクト側は接続できなかったら黙って落ちればよい」。
 * ⇒ **enable の条件は 064e のまま**（ガードは `isStageOverlayRequired()` 1 枚・
 * `OBS_AUTO_ADD_KEY` は見ない）で、**stage レーンの進行・結果を UI に出さない**:
 *   - `requestObsAutoAdd("stage")` は connecting / failed（L2 含む）を立てない
 *   - sidecar は `obs.state` に lane（発生元レーン）を載せ、`onObsState` が lane="stage" /
 *     "effects"（発火・一覧取得）を捨てる（2 段目で effects も静音化・本人指示）
 * ⚠ このファイルでの見方: **enableObs / hideObs の呼ばれ方は従来どおり**固定し、
 * **表示（赤字・状態文言）は「stage 由来では出ない」ことを固定する**（061e の表は書き換えた）。
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
  // 063h: ガチャ抽選の記録（⚠ **記録レーンだけが通る経路**）。
  //   ⚠ モックしないと jsdom で実 invoke が reject し、実装の `.catch` が握るので
  //   **記録したこと自体を観測できない**＝「記録していない」変異が殺せない
  //   （`emitGachaStageResult` をモックしている理由とまったく同じ）。
  recordGachaDraws: vi.fn(),
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
    // ⚠⚠⚠ **063f: 実物の型（`CommentStreamHandle["sendChat"]`）で宣言し直した。**
    //   旧実装は `vi.fn(async () => …)` で**引数ゼロ**だったので `mock.calls[0]` が `[]` 型になり、
    //   ⚠ **`calls[0][0]`（送った本文）が取り出せない＝ §9 の網（本文に表示名が入らないこと）が
    //   そもそも書けなかった。** ⚠⚠ **本体の型から引くこと**（引数を手で書き写すと静かにずれる）。
    sendChat: vi.fn<CommentStreamHandle["sendChat"]>(async () => ({
      ok: false,
      reason: "offline",
    })),
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
// 063h: ガチャ抽選の記録。⚠ **実モジュールの export 面を全て埋める**（他のモックと同じ方針）。
vi.mock("../../features/gacha-history/gachaHistoryApi", () => ({
  recordGachaDraws: mocks.recordGachaDraws,
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
 *
 * ⚠⚠ 2026-09-05（静音化）: `lane`（発生元レーン）が増えた。実物の sidecar は **enable / hide 由来の
 * 通知に対象窓の種別（comments/pinned/stage）を、発火・一覧取得には "effects" を必ず載せる**
 * （obs-client.ts の `ObsStateListener`）。lane なしを送るのは disable の echo（idle）だけ——
 * **lane なしの failed は実物には存在しない形**なので、テストで使わないこと
 * （区別を怠ると、実物では起きない形を固定してしまう）。
 */
function emitObsState(state: string, lane?: string) {
  expect(mocks.handlers.current).not.toBeNull();
  act(() => mocks.handlers.current?.onObsState?.(state, undefined, lane));
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

  it("⚠⚠ B4' (Bug-1 → 静音化): 切断中に配信イベントを開始しても、送らず・connecting でも固まらず・赤字も出ない", async () => {
    // ⚠ `requestObsAutoAdd` の未接続判定を「ハンドルの有無」から「**WS が OPEN か**」に直した分（Bug-1）。
    // ハンドルは `connectCommentStream` が接続を待たずに同期で返すので、**接続前でも非 null**＝
    // 旧ガードは素通りしていた（これが Bug-1 の直接の原因）。
    // ⚠⚠⚠ **2026-09-05（stage の静音化）: 期待値を「failed を出して伝える」から「何も出さない」へ反転した。**
    //   旧 B4 は L2 の意図（送っても届かないなら failed）どおり赤字を期待していたが、
    //   本人指示「エフェクト側は接続できなかったら黙って落ちればよい」で stage は silent になった。
    //   ⚠ **「届かない送信はしない」（固着の芽を作らない）は不変**——変わったのは表示だけである。
    vi.useFakeTimers();
    try {
      mocks.isStageOverlayOpen.mockResolvedValue(true);
      render(<CommentViewerApp />);
      emitConnected();
      await act(async () => {});
      act(() => mocks.handlers.current?.onConnectionChange?.(false)); // 切断

      emitSettingChange(STAGE_OVERLAY_ENABLED_KEY, "true"); // 開始

      await act(() => vi.advanceTimersByTimeAsync(10_000));

      // 届かない送信はしない（固着の芽を作らない）。
      expect(mocks.stream.enableObs).not.toHaveBeenCalled();
      // 静音化: stage は failed も connecting も出さない。
      expect(screen.queryByText(OBS_ERROR_TEXT)).not.toBeInTheDocument();
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
      // ⚠⚠⚠ **2026-09-05: このケースはいったん master switch 化で反転し、同日中に本人指示で戻った**
      //   ——「あのトグルはコメントビューアの設定であって、OBS エフェクトとはユーザー的に別。分けるべき」。
      //   S-4 の再修正トリガー（OFF なのに起動時に赤字）へ答えたのは**ここのゲートではなく静音化**
      //   （`requestObsAutoAdd` の JSDoc が正）。⚠ **再び束ねる変更はこのケースを見てから**＝
      //   反転させるなら本人の明示判断が要る（今回それで 1 往復した）。
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

  it("⚠⚠⚠ 静音化 (2026-09-05): 実機フィードバックの経路——OBS 未起動でコメビュを開いても赤字が出ない", async () => {
    // ⚠⚠ **今回の実機フィードバックの経路そのもの**——「OBS 未起動 ＋ ガード true」でコメビュ窓を
    //   開くたび、reconcile → `enableObs("stage")` → 4 秒タイムアウト → failed →
    //   ツールバーに「OBSに接続できませんでした」が出ていた。
    //   ⚠ enable 自体は**従来どおり送る**（あとから OBS を立ち上げた場合に備えた試行はする）。
    //   黙らせたのは**結果の表示だけ**である。ここが落ちたら症状が再発している。
    localStorage.setItem(STAGE_OVERLAY_ENABLED_KEY, "true");
    mocks.isStageOverlayOpen.mockResolvedValue(true);

    render(<CommentViewerApp />);
    emitConnected();
    await waitFor(() =>
      expect(mocks.stream.enableObs).toHaveBeenCalledWith(4455, "stage"),
    );

    // sidecar からの stage の失敗通知（lane 付き＝実物の形）は表示に流れ込まない。
    emitObsState("failed", "stage");

    expect(screen.queryByText(OBS_ERROR_TEXT)).not.toBeInTheDocument();
    expect(screen.queryByText("OBSに接続しています…")).not.toBeInTheDocument();
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
 *
 * ## ⚠⚠⚠ 2026-09-05（静音化・2 段階）: この表の前提が大きく変わった
 *
 * `obs.state` は **lane（発生元レーン）を運ぶようになった**が、それで文言を出し分けるのではなく
 * **stage（追加）と effects（発火・一覧取得）由来は成功も失敗も表示に流れ込まない**
 * （本人指示 1 段目「エフェクト側は接続できなかったら黙って落ちればよい」／
 * 2 段目「エラーが出るべきは『コメントをOBSに表示』を ON にした時だけ」）。
 * ⇒ 上の「赤字がどの種別か区別できない」穴は、**OBSエフェクト系についてだけ**「そもそも出ない」で
 * 塞がった。共有 `obsState` に残る書き手は **comments / pinned（＝表示トグルを ON にした時の
 * 反映結果）**と、lane を運ばない disable の echo（idle のみ）である。
 * ⚠ 旧 T1〜T10 のうち OBSエフェクト系の赤字を前提にしたケースは **T3' / T4' / T7' / T8' / T10' に
 * 反転して残した**（守りたい壊れ方が「出ない」→「出る」へ裏返っただけで、経路の検査は同じ数だけある）。
 */
describe("061e OBS 連携の失敗がツールバーに出る（共有 obsState の上での出し分け）", () => {
  /**
   * comments レーンの失敗で赤字が出た状態を作る（＝「コメントをOBSに表示」を ON にした反映が
   * 失敗した後の状態。静音化 2 段目以降、**赤字を出せるのは comments / pinned の反映結果だけ**である）。
   * ⚠ 2026-09-05 の 1 段目まで、ここは stage の enable 失敗で赤字を作っていた（旧名
   *   renderWithEffectFailure）。同日の 2 段目で発火系（lane="effects"）も黙ったので、
   *   赤字の前提を作れる実物の形は comments / pinned の failed だけになった。
   */
  async function renderWithSharedObsFailure() {
    render(<CommentViewerApp />);
    emitConnected();
    await act(async () => {});
    emitObsState("failed", "comments"); // 「コメントをOBSに表示」ON の反映が失敗した形
  }

  it("⚠⚠⚠ T3' (2026-09-05 反転): 発火系（lane='effects'）の失敗は赤字を出さない（黙って落ちる）", async () => {
    // ⚠⚠⚠ **旧 T3 の反転**——旧ケースは「コメント側の自動反映 OFF でも、（発火の）失敗は赤字に出る」を
    //   061e(2) の可視化として固定していた。まさにその形が実機で
    //   「『コメントをOBSに表示』OFF ＋ OBS 未起動なのに接続エラーが出る」と報告された
    //   （正体＝エフェクトの自動発火・「1回鳴らす」・一覧取得の失敗が同じ赤字に流れ込む）。
    //   本人指示「エラーが出るべきは表示を ON にした時だけ」で、OBSエフェクト系は
    //   stage（追加）に続き effects（発火・一覧）も「黙って落ちる」に統一した。
    //   ⚠ 一覧取得の失敗は OBSエフェクト画面のカードが `obs.sources` の ok:false 経由で案内する
    //   （そちらは別配線・無改変＝完全な無音ではない）。
    render(<CommentViewerApp />);
    emitConnected();
    await act(async () => {});

    emitObsState("failed", "effects"); // 自動発火／「1回鳴らす」／一覧取得の失敗（実物の形）

    expect(screen.queryByText(OBS_ERROR_TEXT)).not.toBeInTheDocument();
  });

  it("⚠⚠ T3 (2): コメント側の反映（comments レーン）の失敗は、連携トグルの状態に依らず赤字が出る", async () => {
    // ⚠ `OBS_AUTO_ADD_KEY` を立てない＝連携トグル OFF。061e(2) がツールバーの赤字から
    // `obsAutoAdd &&` ゲートを外した意味は静音化後も残る——**送ってしまった反映要求の結果**
    // （in-flight の失敗が OFF 後に着弾する等）は、トグルの状態に関わらず読めなければならない。
    // ⚠ ゲートを戻す変異でレッドになるのはこのケース。
    await renderWithSharedObsFailure();

    const error = screen.getByText(OBS_ERROR_TEXT);
    // 文言は変えない（どのレーンで失敗してもユーザーが取る行動は同じ＝OBS を起動する・059b）。
    expect(error).toHaveAttribute(
      "title",
      "OBSに接続できませんでした。OBSが起動しているか確認してください。",
    );
  });

  it("⚠⚠ T3-pinned (レビュー M-2): 固定コメントの反映（lane='pinned'）の失敗も赤字が出る", async () => {
    // ⚠⚠⚠ **フィルタを「通る」側の 2 本目**（レビュー M-2 で追加）。静音化のフィルタは
    //   [`isObsLaneVisible`] の**許可リスト**（comments / pinned ＋ lane なし）で書かれているが、
    //   これが無いと **pinned を許可リストから落とす変異が全スイート緑のまま生存する**
    //   （T3 は comments、T3'/T7'/T8' は捨てる側しか見ていない）。
    //   ⇒ 「固定コメントをOBSに表示」を ON にした人だけ、OBS 未起動の失敗が黙って消える形を殺す。
    // ⚠ 落ちたら疑うのは「pinned を静音化したのか」——静音化の対象は OBSエフェクト系
    //   （stage / effects）だけで、**表示トグルを ON にした反映結果は 2 レーンとも出す**が仕様
    //   （`docs/security.md` §1 の 2026-09-05 追補が正）。
    render(<CommentViewerApp />);
    emitConnected();
    await act(async () => {});

    emitObsState("failed", "pinned"); // 「固定コメントをOBSに表示」ON の反映が失敗した形

    expect(screen.getByText(OBS_ERROR_TEXT)).toBeInTheDocument();
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
    await renderWithSharedObsFailure();

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

  it("⚠⚠ T4' (2026-09-05 反転): 配信イベントの終了は、共有の赤字を巻き添えで消さない", async () => {
    // ⚠⚠⚠ **旧 T4/T5 の反転**——旧 2 本は「stage の表示 OFF で赤字（stage 由来）が消える」を固定していた。
    //   静音化で stage 由来の赤字そのものが無くなり、終了時の `setObsState("idle")` も削除した:
    //   残しておくと**他レーン（comments / pinned）の failed の赤字だけを巻き添えで消す**
    //   （061e 穴 1 と同じ形。旧実装ではそれを「stage 自身の赤字の後始末」として正当化できていた）。
    //   ⚠ `hideObs`（OBS 側の後始末）は従来どおり送る——消したのは共有 state への書き込みだけ。
    localStorage.setItem(STAGE_OVERLAY_ENABLED_KEY, "true"); // マウント時からガード true
    mocks.isStageOverlayOpen.mockResolvedValue(true);
    render(<CommentViewerApp />);
    emitConnected();
    await waitFor(() =>
      expect(mocks.stream.enableObs).toHaveBeenCalledWith(4455, "stage"),
    );
    emitObsState("failed", "comments"); // comments レーンの反映失敗（＝赤字を出せる唯一の形）
    expect(screen.getByText(OBS_ERROR_TEXT)).toBeInTheDocument();

    emitSettingChange(STAGE_OVERLAY_ENABLED_KEY, "false"); // 終了

    expect(mocks.stream.hideObs).toHaveBeenCalledWith(4455, "stage");
    // 赤字は残る（stage の終了は共有 obsState を触らない）。
    expect(screen.getByText(OBS_ERROR_TEXT)).toBeInTheDocument();

    // sidecar の hide echo（idle・lane="stage"＝実物の形）が着弾しても消えない（onObsState が捨てる）。
    // ⚠ 061e 穴 1 が「frontend では塞げない」と受容していた「stage の OFF が他種別の failed を消す」は、
    //   lane が付いたことで**構造的に塞がった**。
    emitObsState("idle", "stage");
    expect(screen.getByText(OBS_ERROR_TEXT)).toBeInTheDocument();
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
    //   **failed がそのまま残っている状態**から echo を当てる形にした
    //   （見たいのは「idle の echo が着弾したら消えること」であって、残り方ではない）。
    // ⚠ 2026-09-05: 前段の失敗は comments レーンへ差し替えた（OBSエフェクト系の赤字は消滅）。
    //   lane なしの idle echo（disable の echo）が消すのは従来どおり。
    localStorage.setItem(OBS_AUTO_ADD_KEY, "true"); // コメント側の連携は ON のまま
    await renderWithSharedObsFailure();
    expect(screen.getByText(OBS_ERROR_TEXT)).toBeInTheDocument();

    // コメント側で表示 OFF / 連携 OFF を操作した結果、sidecar から返ってくる idle。
    emitObsState("idle");

    expect(screen.queryByText(OBS_ERROR_TEXT)).not.toBeInTheDocument();
  });

  it("⚠⚠ T7' (2026-09-05 反転): OBS 未起動でも、コメビュ窓を開き直すたびに enable は試行される（赤字は出ない）", async () => {
    // ⚠⚠⚠ **旧 T7 の反転**——旧ケースは 061a Q-2 のトリガー①（「コメビュを開くたびに OBS の赤字が出る」）を
    // 061e の可視化の帰結として**仕様に固定していた**。まさにその症状が実機で「面倒」と言われ
    // （＝トリガー①の発火）、本人指示で stage は静音化された。
    // ⚠ **「開き直すたびの enable 試行」は残っている**ことを対で固定する——これが
    // 「OBS をあとから立ち上げたら次の契機で繋がる」の契機の 1 つである
    // （他はガチャ演出トグルの入れ直し・配信イベントの開始。ソース自体は一度作れば OBS 側に永続する）。
    localStorage.setItem(STAGE_OVERLAY_ENABLED_KEY, "true");
    mocks.isStageOverlayOpen.mockResolvedValue(true);

    const first = render(<CommentViewerApp />);
    emitConnected();
    await waitFor(() =>
      expect(mocks.stream.enableObs).toHaveBeenCalledWith(4455, "stage"),
    );
    emitObsState("failed", "stage"); // OBS 未起動（実物は lane="stage" 付きで届く）
    expect(screen.queryByText(OBS_ERROR_TEXT)).not.toBeInTheDocument();

    // 窓を閉じて開き直す＝再マウント。reconcile は毎マウント走る（061a の保証ベースライン）。
    first.unmount();
    mocks.stream.enableObs.mockClear();

    render(<CommentViewerApp />);
    emitConnected();
    await waitFor(() =>
      expect(mocks.stream.enableObs).toHaveBeenCalledWith(4455, "stage"),
    );
    emitObsState("failed", "stage");
    expect(screen.queryByText(OBS_ERROR_TEXT)).not.toBeInTheDocument();
  });

  it("⚠⚠ T8' (2026-09-05 反転): 終了後に in-flight の stage の failed が遅れて着弾しても、何も出ない", async () => {
    // ⚠⚠⚠ **旧 T8 の反転**——旧ケースは「受容した stale-positive」（連携が 1 つも ON でないのに、
    //   遅れて届いた stage の failed が赤字に出る・061e 独立レビュー Q-1）を仕様として固定していた。
    //   静音化で stage の failed は**着弾しても捨てられる**ので、この stale-positive は stage については
    //   構造的に消えた（旧コメントが「直すなら世代カウンタ」と書いていた形よりも強い解になっている）。
    //   ⚠ comments / pinned（＝表示トグルを ON にした反映）の stale-positive は従来どおり出る——
    //   そちらまで黙らせる変更はしていない（T3 が守る）。
    localStorage.setItem(STAGE_OVERLAY_ENABLED_KEY, "true");
    mocks.isStageOverlayOpen.mockResolvedValue(true);
    render(<CommentViewerApp />);
    emitConnected();
    await waitFor(() =>
      expect(mocks.stream.enableObs).toHaveBeenCalledWith(4455, "stage"),
    );

    emitSettingChange(STAGE_OVERLAY_ENABLED_KEY, "false"); // 終了
    expect(screen.queryByText(OBS_ERROR_TEXT)).not.toBeInTheDocument();

    // 送出済みだった反映要求の結果が、遅れて届く（実物は lane="stage" 付き）。
    emitObsState("failed", "stage");

    expect(screen.queryByText(OBS_ERROR_TEXT)).not.toBeInTheDocument();
  });

  // ⚠⚠ **2026-09-05: T9'（「遅れて着弾した赤字は『終了』で必ず消える」）を削除した。**
  //   あのケースの主題「消せない赤字を作らない」は、stage の赤字そのものが消滅したことで対象を失った
  //   （終了時の `setObsState("idle")` も削除済み＝残すと他レーンの赤字を巻き添えで消す・T4' が正）。
  //   共有レーンの赤字の出口は T6（idle の echo）が引き続き固定している。

  it("⚠⚠ T10' (2026-09-05 反転): stage の成功（added）は設定カードに出ない（出るのは comments / pinned だけ）", async () => {
    // ⚠⚠⚠ **旧 T10 の反転**——旧ケースは「エフェクトの成功でも『OBSに表示しました。』が出る」を
    //   固定していた（obsState 共有の帰結）。静音化で stage は**成功も表示しない**
    //   （「黙って落ちる」は「黙って成功する」でもある＝対称。ユーザーは配信プレビューで結果を見る）。
    localStorage.setItem(STAGE_OVERLAY_ENABLED_KEY, "true");
    mocks.isStageOverlayOpen.mockResolvedValue(true);
    render(<CommentViewerApp />);
    emitConnected();
    await waitFor(() =>
      expect(mocks.stream.enableObs).toHaveBeenCalledWith(4455, "stage"),
    );

    emitObsState("added", "stage"); // 実物は lane="stage" 付きで届く
    fireEvent.click(screen.getByRole("button", { name: "設定" }));
    expect(screen.queryByText("OBSに表示しました。")).not.toBeInTheDocument();

    // 対照: lane="comments"（コメント一覧の成功）は従来どおりカードに出る。
    emitObsState("added", "comments");
    expect(await screen.findByText("OBSに表示しました。")).toBeInTheDocument();
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
    // ⚠⚠⚠ **段 3-c で入口が変わった**——種別の行は廃止され、
    //   **カスタム報酬に紐づけたときだけ**鳴る（依頼者＝「そもそもチャンネルポイント交換
    //   しただけで表示したいエフェクトなんか無い」）。⚠ `rewardTitle` が wire から
    //   ここまで届いていることも、この 1 本が同時に固定している。
    localStorage.setItem(
      EFFECT_ASSIGNMENTS_KEY,
      JSON.stringify([
        {
          id: "cp:1",
          when: { type: "channelpoint", rewardTitle: "ガチャを引く" },
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
        rewardTitle: "ガチャを引く",
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

  /**
   * ⚠⚠⚠ **063e: テキスト入力を求めない報酬（`user_input` が空文字）でも鳴る（端から端まで）。**
   *
   * ## ⚠⚠ これが「実運用でいちばん多い形」である
   *
   * Twitch のカスタム報酬には「**視聴者にテキスト入力を求める**」トグルがあり、
   * **OFF なら `user_input` は空文字**（公式: "Empty string if not provided"）。
   * ⚠ **ガチャ用の報酬は普通そちら**なので、⚠⚠⚠ **本文なしで鳴らなければ機能が成立しない。**
   *
   * ## ⚠⚠⚠ なぜ窓レベルでも撃つのか（`effectFire.test.ts` があるのに）
   *
   * 発火層（`effectFire.test.ts`）は「本文が空でも引かれる」を固定しているが、
   * ⚠ **窓の配線（`CommentViewerApp` → `decideEffects` → `fireObsSource`）は
   * 本文ありのケースでしか通っていなかった**（063e 段 3-c の実装後に気づいた抜け）。
   * ⇒ 本文を落とす／空で早期 return する変更が入っても、**窓レベルでは誰も気づけない**状態だった。
   * ⚠ **この 1 本を消さないこと。**
   *
   * ⚠ 併せて「**報酬名だけで当たっている**」ことも示している——
   * 本文が空なので、キーワード条件でも本文照合でもなく `cp:1` が当たったと断定できる。
   */
  it("⚠⚠⚠ 063e: テキスト入力なしの報酬（本文が空）でも鳴る", async () => {
    localStorage.setItem(
      EFFECT_ASSIGNMENTS_KEY,
      JSON.stringify([
        {
          id: "cp:1",
          when: { type: "channelpoint", rewardTitle: "ガチャを引く" },
          effect: { kind: "obs-source", sourceName: OBS_ASSIGNED_SOURCE },
        },
      ]),
    );
    render(<CommentViewerApp />);
    emitConnected();
    await act(async () => {});

    emitComments([
      superchat({
        id: "cp0",
        source: "twitch",
        eventType: "channelpoint",
        rewardTitle: "ガチャを引く",
        // ⚠⚠ **入力を求めない報酬**（`user_input` が空文字で届く）。
        text: "",
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

  /**
   * ⚠⚠⚠ **063e 段 3-c: 紐づけていないカスタム報酬では鳴らない（端から端まで）。**
   *
   * ⚠ 総称の受け皿を廃止したことの、実際の窓での担保である。
   * これが落ちると「チャネポを引き換えただけで頼んでいない演出が出る」＝
   * 依頼者が明示的に要らないと言った挙動が復活したことになる。
   */
  it("⚠⚠⚠ 063e 段 3-c: 紐づけていない報酬では鳴らない", async () => {
    localStorage.setItem(
      EFFECT_ASSIGNMENTS_KEY,
      JSON.stringify([
        {
          id: "cp:1",
          when: { type: "channelpoint", rewardTitle: "ガチャを引く" },
          effect: { kind: "obs-source", sourceName: OBS_ASSIGNED_SOURCE },
        },
      ]),
    );
    render(<CommentViewerApp />);
    emitConnected();
    await act(async () => {});

    emitComments([
      superchat({
        id: "cp2",
        source: "twitch",
        eventType: "channelpoint",
        rewardTitle: "曲リクエスト",
        text: "",
        monetaryAmount: undefined,
        monetary: undefined,
      }),
    ]);

    expect(mocks.stream.fireObsSource).not.toHaveBeenCalled();
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

/**
 * ⚠⚠⚠ **063f: ガチャの当選結果を配信のチャットへ自動で書き込む。**
 *
 * ## ⚠⚠⚠ この 1 ファイルが持つべき担保（廃止された `ChatSendCard.test.tsx` では書けなかったもの）
 *
 * `docs/security.md` §1 の「追補（063f）」で **066 の門の 3 枚目（自動送信の経路が 1 本も無い）
 * を外した**ので、残る 2 枚が本当に効いているかを**送信の現場**で固定する:
 *
 * ① ⚠⚠⚠ **同意（既定 OFF）が ON のときだけ出る**——OFF なら **1 通も出ない**。
 *    ⚠⚠ **2026-08-30 訂正: 旧記述「同意の 2 枚が AND である」は嘘になった**
 *    （親トグル `CHAT_SEND_ENABLED_KEY` の廃止で**同意は 1 枚**になった）。
 *    ⇒ ⚠⚠⚠ **もう 1 枚の受け皿が無いぶん、この ① の検査は以前より重い。**
 * ② ⚠⚠ **送るのはガチャ由来の発火だけ**（条件への OBS ソース直指定では出ない）。
 * ③ ⚠⚠⚠ **本線（OBS の演出）を止めない**——送信が失敗しても・返ってこなくても鳴る。
 * ④ ⚠⚠⚠ **§9: 本文に載るのは「景品名」と「引いた人の表示名」だけ**——
 *    **コメント本文・視聴者 id・金額・アバターは 1 バイトも入らない**。
 *    ⚠⚠ **2026-08-30 訂正: 旧記述「第三者由来の文字列が 1 バイトも入らない（表示名も…）」は、
 *    段 3（2026-08-29・表示名を出す）の時点で嘘になっていた**（§9 の「追補の追補」が正）。
 * ⑤ ⚠ **`expectedChannel` は画面に出しているのと同じ値**（S-2b の突き合わせが生きている）。
 * ⑥ ⚠ **送信の本文も結果も localStorage に残さない**（§9・送ったものの記録を作らない）。
 */
describe("063f: ガチャの当選をチャットへ自動送信する", () => {
  /** ⚠ 100% で当たるガチャ＋スパチャ条件（上の 063c ブロックと同じ仕込み方）。 */
  const putGacha = (name = "大当たり", weight = 1000) => {
    localStorage.setItem(
      GACHA_LIBRARY_KEY,
      JSON.stringify([
        {
          id: "g:1",
          name: "ガチャ",
          prizes: [{ name, weight, output: { kind: "builtin" } }],
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
  };

  /**
   * ⚠⚠⚠ **同意の旗（2026-08-30 に 2 枚 → 1 枚になった）。**
   *
   * 旧構成は **AND**（親＝コメビュ設定の `chat-send-enabled` ＋ 子＝`gacha-chat-enabled`）だったが、
   * 依頼者の判断「**設定画面からチャットに書き込むカードを消して。これは常時 ON がただしい**」で
   * **親を廃止した**。⚠⚠ **既定 OFF と「明示操作でしか立たない」は 1 ミリも変わっていない。**
   */
  const allowAuto = () =>
    localStorage.setItem("stream-dock.comment-viewer.gacha-chat-enabled", "1");
  /** ⚠ 期待値（＝画面の「送信先」）が空だと `sendChat` は送る前に落ちるので、必ず入れる。 */
  const putChannel = () =>
    localStorage.setItem("stream-dock.comment-viewer.channel", "  MyChannel  ");

  /**
   * ⚠⚠⚠ **063f 段 1-b: 投稿は `setTimeout` で予約されるようになった**（演出のネタバレ防止）。
   *
   * ⚠⚠ 演出を出さない設定でも **`setTimeout(…, 0)`** を通るので、
   * **`emitComments` の直後に `sendChat` を見ると「まだ呼ばれていない」ことがある**
   * ——⚠ **実際にフレークになった**（同じテストが単独では緑、4 ファイル同時ではレッド）。
   * ⇒ **マクロタスクを 1 回流してから見る。**
   * ⚠ **`await act(async () => {})` では足りない**（あれはマイクロタスクしか流さない）。
   */
  const flushSend = async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };

  const fire = async (comment = superchat()) => {
    render(<CommentViewerApp />);
    emitConnected();
    await act(async () => {});
    await act(async () => {
      emitComments([comment]);
    });
    await flushSend();
  };

  /**
   * ⚠⚠⚠ **同意が無ければ 1 通も出ない**——**この機能でいちばん重い 1 本**である。
   *
   * ⚠⚠ **2026-08-30 に重みが増した**: 旧構成は AND の 2 枚だったので、
   * 片方を消しても**もう 1 枚が残った**。⚠⚠⚠ **いまは 1 枚しかない**ので、
   * **ここが緑であることが「無操作で書き込まない」の担保のすべて**である。
   * ⇒ ⚠ **このテストを消さないこと。**（旧「AND の片側／もう片側」の 2 本は、
   * 親トグルの廃止で**検査する対象そのものが消えた**ので削除した。）
   */
  it("⚠⚠⚠ 同意 OFF なら 1 通も送らない（既定 OFF の担保）", async () => {
    putChannel();
    putGacha();
    await fire();
    expect(mocks.stream.sendChat).not.toHaveBeenCalled();
    // ⚠ それでも演出は出る（＝機能そのものは動いている状態での 0 件である）。
    expect(mocks.emitGachaStageResult).toHaveBeenCalledTimes(1);
  });

  it("⚠⚠ 同意 ON なら当選 1 件につき 1 通だけ送る", async () => {
    putChannel();
    allowAuto();
    putGacha("特賞");
    await fire();
    expect(mocks.stream.sendChat).toHaveBeenCalledTimes(1);
    // ⚠ 本文は `buildGachaChatMessage` が決める（ここで文面を組み立て直さない）。
    expect(mocks.stream.sendChat).toHaveBeenCalledWith(
      // ⚠ 063f 段 3: 表示名も入る（モックのコメントの投稿者は「視聴者A」）。
      buildGachaChatMessage({
        prizeLabel: "特賞",
        rare: false,
        viewerName: "視聴者A",
      }),
      // ⚠⚠⚠ ⑤ **画面に出しているのと同じ値**（trim 済み）。
      "MyChannel",
    );
  });

  /**
   * ⚠⚠⚠ **S-2b の「画面に出している値と同じ」を、画面から取った値で固定する。**
   *
   * ## ⚠⚠ なぜ 1 本増やしたか（2026-08-30・レビュー Q-5）
   *
   * 066 S-2b の教訓は「**『見せる』対処は、見せる値が実際の状態に由来していて初めて成立する**」。
   * ⚠ 旧 `ChatSendCard.test.tsx` はこれを prop で受けていたので固定できず、
   * **`CommentViewerApp.session.test.tsx` の 1 本**（テスト送信は画面に出している送信先を渡す）が
   * 担っていたが、⚠⚠ **2026-08-30 に押し手ごと廃止して削除した。**
   *
   * ⚠⚠⚠ **上の 1 本だけでは足りない**——あちらは `localStorage` に仕込んだ値と突き合わせるので、
   * **将来ツールバーが別の値を描くようになっても緑のまま**である。
   * ⇒ **ここでは「実際に描かれている入力値」を根拠にする**（表示の担い手が
   * `ChatSendCard` の「送信先: …」からツールバーのチャンネル入力へ移ったあとの、同じ性質）。
   *
   * ⚠ **`expectedChannel` は「宛先」ではなく「宛先の期待値」である**（066 S-2 / S-2b）——
   * ⚠⚠ **sidecar に現在の宛先を聞いて渡す形にしないこと**（突き合わせが恒真になって消える）。
   */
  it("⚠⚠⚠ S-2b: 期待値は、画面のチャンネル入力が描いている値そのもの", async () => {
    putChannel();
    allowAuto();
    putGacha("特賞");
    await fire();

    // 接続ピルを開くと、同じ `channel` state を描いている入力欄が出る。
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Twitch/ }));
    });
    const shown = screen.getByLabelText("ユーザー名") as HTMLInputElement;
    // ⚠ 仕込んだ生値がそのまま描かれている（＝表示は frontend の `channel` state そのもの）。
    expect(shown.value).toBe("  MyChannel  ");

    // ⚠⚠⚠ **期待値は、いま画面に出ているその値を trim しただけのもの**である。
    expect(mocks.stream.sendChat).toHaveBeenCalledWith(
      expect.any(String),
      shown.value.trim(),
    );
  });

  /**
   * ⚠⚠⚠ **2026-08-30・security-review Q-3 で追加し、063f 段 2-a で書き直した。**
   *
   * ⚠⚠ **同一バッチの複数当選は、これまで 1 本もテストが無かった**——にもかかわらず
   * `sendGachaChat` の JSDoc が最も長く論じているのがこのケースだった。
   * ⚠⚠⚠ **その論述（「`sendChat` は同時 1 本なので 2 件目以降はチケット取得すら走らない」）は、
   * 書かれた時点では誤りだった**（S-1・TOCTOU）。
   * ⇒ ✅ **段 2-a で `commentStream.ts` を直し、記述のほうが真になった**
   * （＝ 上の再修正トリガーは**引かれた**）。
   *
   * ## ⚠ ここが固定していること（**この層で観測できるものだけ**）
   *
   * 1. ⚠⚠⚠ **本線は 2 件とも通る**（演出は当選のぶんだけ出る）——これが最重要である。
   * 2. **`sendChat` は 2 回呼ばれる**（⚠ **この層は 1 本も落とさない**）。
   * 3. ⚠⚠ **frontend が件数を数えたり、まとめたり、溜めたりしていない**
   *    （まとめると重複拒否の迂回になる＝ §1 追補の再修正トリガー ④）。
   *
   * ## ⚠⚠⚠ 「sidecar へ出るフレームが 1 本」は**ここでは観測できない**
   *
   * このファイルは **`sendChat` 自体をモックしている**ので、
   * 「呼ばれた回数」までしか見えない。⚠⚠ **落ちるのはその内側**（`commentStream.ts` の
   * `pendingChatSend` が 2 本目を `{ok:false,"前の書き込みが…"}` で即返す）である。
   * ⇒ **フレーム数と「チケット取得すら走らない」ことの固定は
   * [`commentStream.chatSend.test.ts`] が持つ**（⚠ ここへ書き写さないこと＝ モックでは嘘になる）。
   *
   * ⚠ **2 の期待値を 1 に変えたくなったら、それは層を取り違えている。**
   * `sendGachaChat` が落とし始めたら §1 追補が禁じた「frontend に数を数える仕組み」になる。
   */
  it("⚠⚠⚠ 同一バッチで 2 件当選しても、本線は 2 件とも通り frontend は 1 本も落とさない", async () => {
    putChannel();
    allowAuto();
    putGacha("特賞");
    render(<CommentViewerApp />);
    emitConnected();
    await act(async () => {});
    await act(async () => {
      // ⚠ 同じバッチに 2 件（バースト上限は 5 秒に 3 件なので 2 件は通る）。
      emitComments([
        superchat({ id: "c1", author: { id: "u1", name: "視聴者A" } }),
        superchat({ id: "c2", author: { id: "u2", name: "視聴者B" } }),
      ]);
    });
    await flushSend();

    // ⚠⚠⚠ 1: **本線（演出）は 2 件とも出る**（チャットの都合で当選を握り潰さない）。
    expect(mocks.emitGachaStageResult).toHaveBeenCalledTimes(2);
    // ⚠⚠ 2: frontend は 1 本も落とさない（＝「同時 1 本で 2 件目が落ちる」は成立しない）。
    expect(mocks.stream.sendChat).toHaveBeenCalledTimes(2);
    // ⚠⚠⚠ 3: **本文は当選ごとに別で、引いた人の表示名がそれぞれ入る**
    //   （＝ まとめたり、片方を捨てて 1 通にしたりしていない）。
    expect(mocks.stream.sendChat).toHaveBeenNthCalledWith(
      1,
      buildGachaChatMessage({
        prizeLabel: "特賞",
        rare: false,
        viewerName: "視聴者A",
      }),
      "MyChannel",
    );
    expect(mocks.stream.sendChat).toHaveBeenNthCalledWith(
      2,
      buildGachaChatMessage({
        prizeLabel: "特賞",
        rare: false,
        viewerName: "視聴者B",
      }),
      "MyChannel",
    );
  });

  /**
   * ⚠⚠⚠ **063f 段 2-a: 「投稿されたのに『失敗しました』と出る」が閉じたことの固定。**
   *
   * S-1 以前は `pendingChatSend` が上書きされるせいで、**成功した 1 通目の結果フレームが
   * `requestId` 不一致で捨てられ**、画面には**拒否された最後の 1 件**が出ていた。
   *
   * ⚠⚠ **段 2-a 以降の返り方**をモックで再現する:
   * - **1 本目** … チケット取得と往復があるので**後から** `{ok:true}` が返る
   * - **2 本目** … 予約に弾かれて**その場で** `{ok:false,"前の書き込みが…"}` が返る
   *
   * ⇒ ⚠⚠⚠ **後から届く 1 本目の成功が最後に上書きするので、赤字は残らない。**
   * ⚠ **ここは `gachaChatError` の「最後の 1 件だけ持つ」性質に乗っている**——
   * 履歴を持たない（§9）ぶん、**順序が結論を決める**ことを明示的に固定しておく。
   *
   * ⚠⚠ **2026-08-30: 出し先が設定カードからツールバーへ移った**
   * （`ChatSendCard` 廃止・⚠ **成功は出さない**＝チャットに現れた 1 通が示すので）。
   * ⇒ 見るのは「**赤字が出ていないこと**」になった。
   */
  it("⚠⚠⚠ 2 件同時当選でも、成功した 1 通目が最後に効く（赤字が残らない）", async () => {
    putChannel();
    allowAuto();
    putGacha("特賞");
    // ⚠ 1 本目は「後から成功」。⚠⚠ **`flushSend` を跨いで解決させる**ため 1 tick 遅らせる。
    mocks.stream.sendChat.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve({ ok: true }), 0);
        }),
    );
    // ⚠ 2 本目は「その場で拒否」（＝ `commentStream.ts` の予約が返す文面そのもの）。
    mocks.stream.sendChat.mockResolvedValueOnce({
      ok: false,
      reason: "前の書き込みが終わっていないため送れませんでした。",
    });
    render(<CommentViewerApp />);
    emitConnected();
    await act(async () => {});
    await act(async () => {
      emitComments([
        superchat({ id: "c1", author: { id: "u1", name: "視聴者A" } }),
        superchat({ id: "c2", author: { id: "u2", name: "視聴者B" } }),
      ]);
    });
    await flushSend();
    // ⚠ 1 本目（後から返る成功）が届くまで待つ。
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // ⚠⚠⚠ **ツールバーに赤字が出ていない**（＝ 2 本目の拒否を、1 本目の成功が消した）。
    expect(
      screen.queryByText("チャットに書き込めません"),
    ).not.toBeInTheDocument();
  });

  it("⚠⚠ レア景品なら文面が変わる（`rare` が運ばれている）", async () => {
    putChannel();
    allowAuto();
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      putGacha("極小", 99);
      await fire();
    } finally {
      random.mockRestore();
    }
    expect(mocks.stream.sendChat).toHaveBeenCalledWith(
      buildGachaChatMessage({
        prizeLabel: "極小",
        rare: true,
        viewerName: "視聴者A",
      }),
      "MyChannel",
    );
  });

  it("⚠⚠⚠ 条件への OBS ソース直指定（ガチャではない）では送らない", async () => {
    putChannel();
    allowAuto();
    putObsCondition();
    await fire();
    expect(mocks.stream.fireObsSource).toHaveBeenCalledTimes(1);
    expect(mocks.stream.sendChat).not.toHaveBeenCalled();
  });

  /**
   * ⚠⚠ **はずれ・一覧に無い `gachaId`・景品 0 件は、現行の型では区別できない**
   * （`drawGachaResult` が 3 つとも `null` を返し、結果に積まれない）。
   * ⇒ **「どれも 1 通も送らない」までが、ここで固定できることの全部**である。
   */
  it("⚠ はずれでは送らない", async () => {
    putChannel();
    allowAuto();
    putGacha("極小", 1);
    const spy = vi.spyOn(Math, "random").mockReturnValue(0.99);
    try {
      await fire();
    } finally {
      spy.mockRestore();
    }
    expect(mocks.stream.sendChat).not.toHaveBeenCalled();
  });

  it("⚠ 一覧に無い gachaId では送らない", async () => {
    putChannel();
    allowAuto();
    localStorage.setItem(GACHA_LIBRARY_KEY, JSON.stringify([]));
    localStorage.setItem(
      EFFECT_ASSIGNMENTS_KEY,
      JSON.stringify([
        {
          id: "event:superchat",
          when: { type: "event", eventType: "superchat" },
          effect: { kind: "gacha", gachaId: "g:missing" },
        },
      ]),
    );
    await fire();
    expect(mocks.stream.sendChat).not.toHaveBeenCalled();
    expect(mocks.emitGachaStageResult).not.toHaveBeenCalled();
  });

  it("⚠ 景品 0 件では送らない", async () => {
    putChannel();
    allowAuto();
    localStorage.setItem(
      GACHA_LIBRARY_KEY,
      JSON.stringify([{ id: "g:1", name: "ガチャ", prizes: [] }]),
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
    await fire();
    expect(mocks.stream.sendChat).not.toHaveBeenCalled();
  });

  /**
   * ⚠⚠⚠ **③ 本線を止めない（その 1）: 送信が失敗しても OBS と演出は動く。**
   * ⚠ 「チャットが送れなくても景品は鳴る」は 063f の完了条件そのものである。
   */
  it("⚠⚠⚠ 送信に失敗しても OBS の演出は出る", async () => {
    putChannel();
    allowAuto();
    mocks.stream.sendChat.mockResolvedValueOnce({
      ok: false,
      reason: "送信の間隔が短すぎます。少し待ってください。",
    });
    putGacha();
    await fire();
    expect(mocks.stream.sendChat).toHaveBeenCalledTimes(1);
    expect(mocks.emitGachaStageResult).toHaveBeenCalledTimes(1);
  });

  /**
   * ⚠⚠⚠ **③ 本線を止めない（その 2）: 送信が「永久に返ってこなくても」演出は出る。**
   *
   * ⚠⚠ **これが `await` していないことの担保である**——`sendGachaChat` を
   * `await` する変異を入れると、この 1 本だけがレッドになる
   * （失敗を返す上のケースは `await` してもグリーンのままなので、**あちらでは殺せない**）。
   */
  it("⚠⚠⚠ 送信が返ってこなくても OBS の演出は出る（await していない）", async () => {
    putChannel();
    allowAuto();
    // ⚠ 解決しない Promise を返す（＝ Twitch の往復が詰まっている状態）。
    mocks.stream.sendChat.mockReturnValueOnce(
      new Promise<{ ok: false; reason: string }>(() => {}),
    );
    putGacha();
    await fire();
    expect(mocks.emitGachaStageResult).toHaveBeenCalledTimes(1);
    expect(mocks.stream.fireObsSource).not.toHaveBeenCalled();
  });

  /**
   * ⚠⚠⚠ **④ §9: 本文に第三者由来の文字列が 1 バイトも入らない。**
   *
   * ⚠⚠ **表示名も入らない**——`docs/security.md` §9 の「追補の追補（063c 段 3）」の
   * 再評価トリガー ③ が「表示名が端末外（配信サービス）へ出る形」を**範囲外**としているため。
   * ⚠ **同じ発火でステージ窓には表示名が渡る**（あちらは端末内）ことも同時に見る＝
   * **線が「どこへ出るか」で引かれている**ことをコードで表現している唯一の場所である。
   */
  it("⚠⚠⚠ §9: 送る本文に入るのは表示名だけ（本文・視聴者 id は 1 文字も入らない）", async () => {
    putChannel();
    allowAuto();
    putGacha();
    await fire(
      superchat({
        text: "これは第三者の本文です",
        author: { id: "u9", name: "第三者の名前" },
      }),
    );
    const sent = String(mocks.stream.sendChat.mock.calls[0]?.[0] ?? "");
    // ⚠⚠⚠ **063f 段 3: 表示名は入る**（依頼者の判断・`docs/security.md` §9 の
    //   「追補の追補（063f）」が根拠）。⚠ **これが線の向こう側へ移った唯一の項目である。**
    expect(sent).toContain("第三者の名前");
    // ⚠⚠⚠ **ここから先は 1 文字も入らない**（型として渡す場所が無い）。
    //   ⚠ **この 3 行を消さないこと**——線がどこに在るかをコードで表現している場所である。
    expect(sent).not.toContain("これは第三者の本文です");
    expect(sent).not.toContain("u9");
    expect(sent).not.toContain("¥1,000");
    // ⚠⚠ **端末内（ステージ窓）へも同じ表示名が渡る**（段 3 で解禁済み・こちらは元から）。
    expect(mocks.emitGachaStageResult).toHaveBeenCalledWith(
      expect.objectContaining({ viewerName: "第三者の名前" }),
    );
  });

  /**
   * ⚠⚠⚠ **表示名は `stageViewerName` が 20 文字で切った後の値でなければならない。**
   *
   * ⚠⚠ **生の `author.name` を使うと、長い名前がそのままチャットへ流れる**
   * ——`docs/security.md` §9 の追補が「**最大 20 文字で切り、超過分は `…`**」と定めており、
   * ⚠ **切る規則の持ち主は `effectFire.ts` の 1 か所**である。
   */
  it("⚠⚠⚠ §9: 長い表示名は 20 文字で切られた形で送られる（生の名前を使わない）", async () => {
    putChannel();
    allowAuto();
    putGacha();
    const longName = "あ".repeat(GACHA_VIEWER_NAME_MAX + 5);
    await fire(superchat({ author: { id: "u9", name: longName } }));
    const sent = String(mocks.stream.sendChat.mock.calls[0]?.[0] ?? "");
    expect(sent).toContain(`${"あ".repeat(GACHA_VIEWER_NAME_MAX)}…`);
    // ⚠⚠ **生の名前そのものは出ない**（切られている）。
    expect(sent).not.toContain(longName);
  });

  /** ⚠ 表示名が空でも**当選そのものは送る**（名前の部分だけ落ちる）。 */
  it("⚠⚠ 表示名が空でも当選は送る（代替名を作らない）", async () => {
    putChannel();
    allowAuto();
    putGacha("特賞");
    await fire(superchat({ author: { id: "u1", name: "" } }));
    expect(mocks.stream.sendChat).toHaveBeenCalledWith(
      buildGachaChatMessage({
        prizeLabel: "特賞",
        rare: false,
        viewerName: null,
      }),
      "MyChannel",
    );
  });

  /**
   * ⚠⚠⚠ **同意は「送る直前」に読む**（マウント時の写しを掴まない）。
   *
   * ⚠⚠ **これが無いと「設定画面で ON にしたのに、窓を開き直すまで書き込まれない」**が起きる
   * ——`loadGachaLibrary` を関数のまま渡している（＝鳴らす直前に読み直す）のと同じ規律である。
   * ⚠ 逆向き（OFF にした直後も送り続ける）のほうが重い：**同意を外したのに書き込みが続く。**
   */
  it("⚠⚠⚠ 途中で同意が入った直後の当選から効く（マウント時の写しを掴んでいない）", async () => {
    putChannel();
    putGacha();
    // ⚠ **保存はゼロの状態で描画する**（＝マウント時に読んだら必ず false）。
    render(<CommentViewerApp />);
    emitConnected();
    await act(async () => {});

    // ⚠ 1 件目は同意が無いので送らない（＝この時点の写しは false）。
    await act(async () => {
      emitComments([superchat()]);
    });
    await flushSend();
    expect(mocks.stream.sendChat).not.toHaveBeenCalled();

    // ⚠⚠⚠ **2026-08-30: 同意のトグルは「OBSエフェクト」画面（＝別の窓）にしか無い。**
    //   ⇒ **別窓が書いた状態を localStorage で再現する**（この窓にトグルは 1 つも無い）。
    //   ⚠ 旧実装ではここで親トグル（コメビュ設定）をクリックしていたが、**親は廃止された**。
    allowAuto();

    // ⚠⚠ **窓を開き直していない**のに、次の当選から効くこと。
    await act(async () => {
      emitComments([superchat({ id: "c2" })]);
    });
    await flushSend();
    expect(mocks.stream.sendChat).toHaveBeenCalledTimes(1);
  });

  /** ⚠⚠ ⑥ §9: 本文も結果も端末に残さない（送ったものの記録を作らない）。 */
  it("⚠⚠ §9: 送った本文も結果も localStorage に残らない", async () => {
    putChannel();
    allowAuto();
    putGacha("特賞");
    await fire();
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i) ?? "";
      const value = localStorage.getItem(key) ?? "";
      expect(value).not.toContain("が当たりました");
      expect(value).not.toContain("視聴者A");
    }
  });

  /**
   * ⚠⚠⚠ **失敗を黙らせない**（061a Q-1 ／ `docs/security.md` §1 の 063f 追補）。
   * ⚠ 自動送信は**画面を見ていないときに走る**ので、あとから読めることが唯一の対処である。
   *
   * ## ⚠⚠⚠ 2026-08-30: 出し先が「設定カード」から「ツールバー」へ移った
   *
   * 依頼者の判断で `ChatSendCard` ごと廃止したが、⚠⚠ **§1 追補が「失敗は黙らせない」を
   * 要求しているので、消さずに動かした**。⇒ 045c の OBS エラー・059a の通知音・
   * 062b の記録落ちと**同じ場所・同じクラス**（性質も同じ＝
   * **ユーザー操作なしに起きた失敗を配信中の画面へ出す**）。
   * ⚠⚠ **むしろ設定画面より届く**——配信中に見ているのはこちらだから。
   */
  it("⚠⚠⚠ 失敗するとツールバーに出る（設定を開かなくても読める）", async () => {
    putChannel();
    allowAuto();
    mocks.stream.sendChat.mockResolvedValueOnce({
      ok: false,
      reason: "直前と同じ内容は送れません（Twitch 側で弾かれるため）。",
    });
    putGacha();
    await fire();
    // ⚠⚠⚠ **設定を開かずに読める**こと（＝ここが移設の目的そのもの）。
    const indicator = await screen.findByText("チャットに書き込めません");
    expect(indicator).toBeInTheDocument();
    // ⚠⚠ 理由は `title` に出る。⚠⚠⚠ **完全一致で見る**（部分一致にしない）——
    //   ⚠ §9: 出してよいのは **sidecar が作った定型の短文だけ**で、
    //   **送った本文をここへ足すと必ずレッドになる**（部分一致だと足しても緑のまま通る）。
    expect(indicator).toHaveAttribute(
      "title",
      "直前と同じ内容は送れません（Twitch 側で弾かれるため）。",
    );
  });

  /**
   * ⚠⚠ **成功では赤字を出さない**（成功したことは**チャットに現れた 1 通**が示す）。
   * ⚠ ツールバーの他のインジケータと同じ規律＝**出すのは失敗だけ**である。
   */
  it("⚠⚠ 成功したときはツールバーに何も出ない", async () => {
    putChannel();
    allowAuto();
    // ⚠ **既定のモックは `{ok:false,"offline"}`** なので、成功はここで明示する。
    mocks.stream.sendChat.mockResolvedValue({ ok: true });
    putGacha();
    await fire();
    expect(
      screen.queryByText("チャットに書き込めません"),
    ).not.toBeInTheDocument();
  });

  /**
   * ⚠⚠⚠ **古い赤字を残さない**（`obsState` 系と同じ振る舞い）。
   * ⚠ 1 度失敗したまま赤字が消えないと、直ったことに気づけない。
   */
  it("⚠⚠⚠ 次の書き込みが成功したら赤字は消える", async () => {
    putChannel();
    allowAuto();
    mocks.stream.sendChat.mockResolvedValueOnce({
      ok: false,
      reason: "直前と同じ内容は送れません（Twitch 側で弾かれるため）。",
    });
    putGacha();
    await fire();
    expect(
      await screen.findByText("チャットに書き込めません"),
    ).toBeInTheDocument();

    // ⚠ 2 件目は成功させる（⚠ 既定のモックは失敗を返すので明示的に差し替える）。
    mocks.stream.sendChat.mockResolvedValue({ ok: true });
    await act(async () => {
      emitComments([superchat({ id: "c9" })]);
    });
    await flushSend();
    expect(
      screen.queryByText("チャットに書き込めません"),
    ).not.toBeInTheDocument();
  });
});

/**
 * ⚠⚠⚠ **063f 段 1-b: 演出より先にチャットへ流さない（ネタバレ防止）。**
 *
 * 実機の指摘（2026-08-29）＝「**エフェクトで結果が見える前にチャットに結果が流れてしまう**」。
 * ⇒ **演出を出す設定のときだけ**、[`gachaChatDelayMs`] だけ投稿を遅らせる
 * （＝ 結果が見える時刻 ＋ 読む間。⚠ **約 6.17 秒**——依頼者の指示で 1.5 秒 → 3.5 秒と伸ばした）。
 * ⚠⚠ **秒数はここに書かない**（`gachaChatDelayMs()` から引く）ので、値を変えてもこの 4 本は緑のまま。
 *
 * ⚠⚠ **秒数をこのファイルに直書きしない**——`gachaStagePlayback.ts` から引く
 * （演出の尺を変えたときに**テストだけが古い期待値で緑のまま**になるのを防ぐ）。
 */
describe("063f 段 1-b: 演出が見えるまでチャットへ投稿しない", () => {
  const putGacha = () => {
    localStorage.setItem(
      GACHA_LIBRARY_KEY,
      JSON.stringify([
        {
          id: "g:1",
          name: "ガチャ",
          prizes: [
            { name: "大当たり", weight: 1000, output: { kind: "builtin" } },
          ],
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
  };
  /**
   * ⚠ 同意 ＋ 宛先の期待値（空だと送る前に落ちる）。
   *
   * ⚠⚠ **2026-08-30: 死んだ仕込み `chat-send-enabled` を外した**（親トグルの廃止で
   * **誰も読まないキー**になっていた）——**残すと「2 枚要る」と読める**。
   */
  const allowAll = () => {
    localStorage.setItem("stream-dock.comment-viewer.gacha-chat-enabled", "1");
    localStorage.setItem("stream-dock.comment-viewer.channel", "MyChannel");
  };
  /** ⚠⚠ **演出が出る状態**にする（＝ `isStageOverlayRequired()` が true）。 */
  const enableStage = () => {
    localStorage.setItem(GACHA_STAGE_ENABLED_KEY, "true");
  };

  const fire = async () => {
    render(<CommentViewerApp />);
    emitConnected();
    await act(async () => {});
    await act(async () => {
      emitComments([superchat()]);
    });
  };

  it("⚠⚠⚠ 演出が出る設定なら、結果が見えるまで 1 通も送らない", async () => {
    vi.useFakeTimers();
    try {
      allowAll();
      enableStage();
      putGacha();
      await fire();
      // ⚠⚠ **演出は即座に出る**（本線は止めていない）。
      expect(mocks.emitGachaStageResult).toHaveBeenCalledTimes(1);
      // ⚠⚠⚠ **1 ms 手前ではまだ送っていない**（＝遅延が本当に効いている）。
      await act(async () => {
        vi.advanceTimersByTime(gachaChatDelayMs() - 1);
      });
      expect(mocks.stream.sendChat).not.toHaveBeenCalled();
      // ⚠ 結果が見えた瞬間に 1 通。
      await act(async () => {
        vi.advanceTimersByTime(1);
      });
      expect(mocks.stream.sendChat).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("⚠⚠ 演出を出さない設定なら待たせない（従来どおり即時）", async () => {
    vi.useFakeTimers();
    try {
      allowAll();
      // ⚠ `enableStage()` を呼ばない＝ `isStageOverlayRequired()` は false。
      putGacha();
      await fire();
      await act(async () => {
        vi.advanceTimersByTime(0);
      });
      expect(mocks.stream.sendChat).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  /**
   * ⚠⚠⚠ **遅延中にトグルを OFF にしたら送らない。**
   * ⚠ 同意を「送る**直前**」に読み直していることの担保で、
   * ここを予約時の 1 回だけにすると「**OFF にしたのに数秒後に書き込まれる**」が起きる。
   */
  it("⚠⚠⚠ 待っているあいだに同意を外したら送らない", async () => {
    vi.useFakeTimers();
    try {
      allowAll();
      enableStage();
      putGacha();
      await fire();
      // ⚠ 待っているあいだに、別の窓（OBSエフェクト画面）で OFF にされた状況。
      localStorage.removeItem("stream-dock.comment-viewer.gacha-chat-enabled");
      await act(async () => {
        vi.advanceTimersByTime(gachaChatDelayMs() + 1);
      });
      expect(mocks.stream.sendChat).not.toHaveBeenCalled();
      // ⚠ 演出のほうは出たまま（本線を止めない）。
      expect(mocks.emitGachaStageResult).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  /**
   * ⚠⚠⚠ **窓を閉じたら送らない。**
   * ⚠ **書き込みは視聴者に見えて、あとから消せない**ので、
   * 「コメントビューアを閉じたのに数秒後に書き込まれた」は最も説明が付かない壊れ方である。
   *
   * ## ⚠⚠ 正直に書く: **この 1 本は cleanup そのものを固定していない**
   *
   * アンマウントで **`streamRef.current` が `null` になる**ので、
   * タイマーを捨て忘れても**発火時に `if (!stream) return;` で落ちて結局送らない**
   * ——⚠ **実測で確認した**（cleanup から `clearTimeout` を外す変異が**生存する**）。
   * ⚠⚠ **`vi.getTimerCount()` で件数を見る形も試したが駄目だった**——
   * アンマウント後も**無関係なタイマーが 20 件残っている**（ポーリング等）ので、
   * 1 件の増減がノイズに埋もれる。⚠ **同じ手を再試行しないこと。**
   *
   * ⇒ ⚠⚠⚠ **それでも cleanup を置いているのは、`stream` を予約時に閉じ込める形へ
   * 書き換えた瞬間に「閉じたのに書き込む」が復活するから**である（多層防御の 2 枚目）。
   * ⚠ **この 1 本が固定しているのは「閉じたら送らない」という振る舞いのほう**である。
   */
  it("⚠⚠⚠ 待っているあいだに窓を閉じたら送らない", async () => {
    vi.useFakeTimers();
    try {
      allowAll();
      enableStage();
      putGacha();
      const view = render(<CommentViewerApp />);
      emitConnected();
      await act(async () => {});
      await act(async () => {
        emitComments([superchat()]);
      });
      view.unmount();
      await act(async () => {
        vi.advanceTimersByTime(gachaChatDelayMs() + 1000);
      });
      expect(mocks.stream.sendChat).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * ⚠⚠⚠ **063h: 抽選の記録（2 レーンの配線）。**
 *
 * このブロックが固定する不変条件は 4 つ:
 *
 * 1. ⚠⚠⚠ **何も当たらなかった抽選で、演出もチャット投稿も起きない**（**本タスク最大の回帰**
 *    ——視聴者に見えて、あとから消せない）。それでも**記録は 1 件残る**。
 * 2. **当たった抽選では、演出・チャット・OBS が従来どおり動く**（回帰なし）。
 * 3. ⚠ **記録は本線（OBS・演出・チャット）より後**に投げる。
 * 4. ⚠⚠ **セッション id が未確定のあいだは捨てずに貯め、確定後に流す**（穴 C）。
 */
describe("063h: ガチャ抽選の記録", () => {
  /**
   * ガチャ＋スパチャ条件を仕込む。
   *
   * ⚠ `weight` が 1000 未満なら**何も当たらない抽選**が起こせる
   * （`Math.random` を固定して当たり／外れを決める）。
   */
  const putGacha = (name = "大当たり", weight = 1000) => {
    localStorage.setItem(
      GACHA_LIBRARY_KEY,
      JSON.stringify([
        {
          id: "g:1",
          name: "ガチャ",
          prizes: [{ name, weight, output: { kind: "builtin" } }],
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
  };

  /**
   * ⚠⚠⚠ **配信セッションを先に確定させてから発火させる。**
   *
   * ⚠ `emitConnected()` は **loopback WS（viewer ↔ sidecar）の接続**であって配信セッションではない
   * ——セッションの確定の契機は「どれかの provider が `connected` になった」か
   * 「**コメントが届いた**」の 2 つで、このハーネスが持っているのは後者だけである。
   * ⇒ **1 件目のコメントを「暖機」として先に流す**（ガチャ条件に当たらない種別を使う）。
   *
   * ⚠⚠⚠ **これを飛ばすと、すべての抽選がバッファ（穴 C の経路）を通ってしまう。**
   * 記録は `adoptStreamSession` の中で流れるので、**コードの位置に関わらず演出より後になり**、
   * 「記録を本線より前へ動かす」変異が**殺せなくなる**（実測して分かった・2026-08-30）。
   */
  const fire = async (comment = superchat()) => {
    render(<CommentViewerApp />);
    emitConnected();
    await act(async () => {});
    emitComments([
      superchat({
        id: "warm-up",
        eventType: "chat",
        monetaryAmount: undefined,
        monetary: undefined,
      }),
    ]);
    // ⚠ セッション確定（`start_stream_session` の解決）を待つ。
    await act(async () => {});
    mocks.emitGachaStageResult.mockClear();
    mocks.recordGachaDraws.mockClear();
    mocks.stream.fireObsSource.mockClear();

    emitComments([comment]);
    await act(async () => {});
  };

  /** 直近に記録へ渡った抽選の配列。 */
  const recorded = () => {
    const calls = mocks.recordGachaDraws.mock.calls;
    return calls[calls.length - 1]?.[0] as
      | { prizeLabel: string | null; viewerId: string; viewerName: string }[]
      | undefined;
  };

  /**
   * ⚠⚠⚠ **本タスク最大の回帰を直接押さえる。**
   *
   * ⚠ `weight: 300` ＝ 30% のガチャに `Math.random() = 0.9` を与えると必ず外れる。
   * ⚠⚠ ここが落ちたら「**何も当たっていないのに演出が出てチャットに投稿される**」
   * ——視聴者に見えて、あとから消せない（`docs/security.md` §1 の 066 節）。
   */
  it("⚠⚠⚠ 何も当たらない抽選では演出もチャットも起きないが、記録は 1 件残る", async () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0.9);
    try {
      putGacha("大当たり", 300);
      await fire();

      expect(mocks.emitGachaStageResult).not.toHaveBeenCalled();
      expect(mocks.stream.fireObsSource).not.toHaveBeenCalled();
      expect(mocks.recordGachaDraws).toHaveBeenCalledTimes(1);
      expect(recorded()).toHaveLength(1);
      // ⚠⚠ `null` ＝ 何も出なかった（⚠ 空文字でも「何も出ない」という文字列でもない）。
      expect(recorded()?.[0].prizeLabel).toBeNull();
    } finally {
      random.mockRestore();
    }
  });

  it("当たった抽選では演出が従来どおり動き、記録も 1 件残る", async () => {
    putGacha("大当たり");
    await fire();

    expect(mocks.emitGachaStageResult).toHaveBeenCalledTimes(1);
    expect(mocks.recordGachaDraws).toHaveBeenCalledTimes(1);
    expect(recorded()?.[0].prizeLabel).toBe("大当たり");
  });

  /**
   * ⚠⚠⚠ **セッション確定後は「その場で」記録する**（バッファを経由しない）。
   *
   * ⚠ `await` を 1 つも挟まずに観測することが、この担保の中身である
   * ——バッファ経由だと `adoptStreamSession` の解決を待つので、ここでは 0 回になる。
   * ⚠⚠ **この 1 本が無いと、他のケースが全部バッファ経由でも緑になる**（実測した罠）。
   */
  it("⚠⚠⚠ セッション確定後は同期的に記録する（バッファを通らない）", async () => {
    putGacha("大当たり");
    render(<CommentViewerApp />);
    emitConnected();
    await act(async () => {});
    emitComments([
      superchat({
        id: "warm-up",
        eventType: "chat",
        monetaryAmount: undefined,
        monetary: undefined,
      }),
    ]);
    await act(async () => {});
    mocks.recordGachaDraws.mockClear();

    emitComments([superchat()]);
    // ⚠⚠ **ここで `await` しない**（＝ act の同期実行だけで記録まで済んでいること）。
    expect(mocks.recordGachaDraws).toHaveBeenCalledTimes(1);
    expect(mocks.recordGachaDraws.mock.calls[0][1]).toBe("session-1");
  });

  /**
   * ⚠⚠ **記録は本線の後**（`emitGachaStageResult` → `recordGachaDraws` の順）。
   *
   * ⚠ 順序が逆になると、将来ここに `await` を足した人が**本線を止められる**
   * （063c / 063f が同じ規律で並べているものの 3 段目）。
   *
   * ⚠⚠ **063h レビュー Q-6: これが固定するのは「セッション確定済みのバッチの中の順序」だけである。**
   * セッション未確定のとき（穴 C）の記録は `adoptStreamSession` の中で流れるので、
   * **本線より後になるのは規律ではなく構造上そうなるだけ**＝この 1 本では守れていない。
   * ⚠ 実装として正しい（未確定なら記録しようがない）ので**担保を足す必要は無い**が、
   * ⚠⚠⚠ **上の `fire()` が暖機コメントでセッションを確定させていることが、
   * この 1 本が意味を持つための前提である**（これを外すと変異が生存する＝実測した罠）。
   */
  it("⚠⚠ 記録は演出・チャットより後に投げる", async () => {
    const order: string[] = [];
    mocks.emitGachaStageResult.mockImplementation(() => order.push("stage"));
    mocks.recordGachaDraws.mockImplementation(() => order.push("record"));
    putGacha("大当たり");
    await fire();

    expect(order).toEqual(["stage", "record"]);
  });

  /**
   * ⚠⚠⚠ **§9: 記録レーンだけが視聴者 id と「切っていない表示名」を持つ。**
   *
   * ⚠ 演出へ渡るペイロードには視聴者 id が**型として載る場所が無い**ので、
   * ここが逆転したら `docs/security.md` §9 追補〔063h〕の「レーンごとの線」が消える。
   */
  it("⚠⚠⚠ 記録レーンだけが視聴者 id を持ち、演出には出ない", async () => {
    const longName = "あ".repeat(GACHA_VIEWER_NAME_MAX + 5);
    putGacha("大当たり");
    await fire(superchat({ author: { id: "u1", name: longName } }));

    expect(recorded()?.[0].viewerId).toBe("youtube:u1");
    // ⚠ 記録は**切っていない**／演出は**切られている**。
    expect(recorded()?.[0].viewerName).toBe(longName);
    expect(mocks.emitGachaStageResult).toHaveBeenCalledWith(
      expect.objectContaining({
        viewerName: `${"あ".repeat(GACHA_VIEWER_NAME_MAX)}…`,
      }),
    );
    const stagePayload = mocks.emitGachaStageResult.mock.calls[0][0];
    expect(JSON.stringify(stagePayload)).not.toContain("youtube:u1");
  });

  it("⚠ ガチャではない発火（条件に OBS ソース直指定）では記録しない", async () => {
    localStorage.setItem(
      EFFECT_ASSIGNMENTS_KEY,
      JSON.stringify([
        {
          id: "event:superchat",
          when: { type: "event", eventType: "superchat" },
          effect: { kind: "obs-source", sourceName: OBS_ASSIGNED_SOURCE },
        },
      ]),
    );
    await fire();

    expect(mocks.stream.fireObsSource).toHaveBeenCalledTimes(1);
    // ⚠ 空配列でも呼ばない（`recordOrBufferGachaDraws` が先に落とす）。
    expect(mocks.recordGachaDraws).not.toHaveBeenCalled();
  });

  /**
   * ⚠⚠ **上限を超えたら捨てるが、黙って捨てない**（062b の「記録できなかったコメント N 件」と同型）。
   *
   * ⚠⚠⚠ **配信サマリーには遡って出せない**（記録は遡れない）ので、
   * ここで気付けないと**その抽選は永久に失われる**。
   *
   * ⚠ バースト上限（`EFFECT_MAX_CONCURRENT` ＝ 5 秒に 3 件）があるので、
   * **時計を進めながら 3 件ずつ**流さないと上限まで届かない。
   * ⚠⚠ `Date.now` だけを差し替える（`vi.useFakeTimers` は `await act` を止めてしまう）。
   */
  it("⚠⚠ 上限を超えたぶんは捨てるが、件数を画面に出す（黙って捨てない）", async () => {
    // ⚠ セッションを**永久に未確定**にする（＝すべての抽選がバッファへ積まれる）。
    vi.mocked(startStreamSession).mockImplementation(
      () => new Promise(() => {}),
    );
    putGacha("大当たり");
    let clock = 1_000_000;
    const now = vi.spyOn(Date, "now").mockImplementation(() => clock);
    try {
      render(<CommentViewerApp />);
      emitConnected();
      await act(async () => {});

      const perBatch = EFFECT_MAX_CONCURRENT;
      const total = PENDING_GACHA_DRAW_LIMIT + 2;
      const batches = Math.ceil(total / perBatch);
      for (let b = 0; b < batches; b += 1) {
        // ⚠ バースト窓を跨がせる（跨がないと 3 件で頭打ちになる）。
        clock += 6_000;
        emitComments(
          Array.from({ length: perBatch }, (_, i) =>
            superchat({ id: `c-${b}-${i}`, author: { id: `u${b}${i}`, name: "視聴者" } }),
          ),
        );
        await act(async () => {});
      }

      // ⚠ 実際に上限を超えたぶんだけが出ること（件数を数え間違えていないか）。
      expect(
        await screen.findByText(
          `記録できなかったガチャ ${batches * perBatch - PENDING_GACHA_DRAW_LIMIT} 件`,
        ),
      ).toBeInTheDocument();
    } finally {
      now.mockRestore();
    }
  });

  it("⚠ 取りこぼしが無ければ警告を出さない", async () => {
    putGacha("大当たり");
    await fire();
    expect(screen.queryByText(/記録できなかったガチャ/)).toBeNull();
  });

  /**
   * ⚠⚠⚠ **穴 C: セッション id が未確定のあいだの抽選を捨てない。**
   *
   * ⚠ `startStreamSession` を保留したまま抽選を起こし、**そのあと解決させる**。
   * ⚠⚠ ここが落ちると「**演出は出たのに配信サマリーに無い**」が静かに起きる
   * （062b が最も避けた失敗と同じ形で、しかも**記録は遡れない**）。
   */
  it("⚠⚠⚠ セッション未確定の抽選を捨てず、確定後に流す（穴 C）", async () => {
    let resolveSession: (() => void) | null = null;
    const pending = new Promise<void>((resolve) => {
      resolveSession = resolve;
    });
    // ⚠ `startStreamSession` は `mocks`（hoisted）ではなく **vi.mock のファクトリ内**の vi.fn なので、
    //   モジュール経由で掴む（`vi.mocked` は型を合わせるだけで実体は同じ）。
    vi.mocked(startStreamSession).mockImplementationOnce(async () => {
      await pending;
      return {
        id: "session-late",
        startedAt: "2026-08-30T10:00:00+00:00",
        platforms: ["twitch"],
        title: "",
        createdAt: "2026-08-30T10:00:00+00:00",
        updatedAt: "2026-08-30T10:00:00+00:00",
      };
    });

    putGacha("大当たり");
    render(<CommentViewerApp />);
    emitConnected();
    await act(async () => {});
    emitComments([superchat()]);
    await act(async () => {});

    // ⚠ セッションが未確定なので、まだ記録には行っていない（貯まっている）。
    expect(mocks.emitGachaStageResult).toHaveBeenCalledTimes(1);
    expect(mocks.recordGachaDraws).not.toHaveBeenCalled();

    await act(async () => {
      resolveSession?.();
      await pending;
    });

    // ⚠⚠ 確定した id で流れること（**捨てられていない**）。
    expect(mocks.recordGachaDraws).toHaveBeenCalledTimes(1);
    expect(mocks.recordGachaDraws.mock.calls[0][1]).toBe("session-late");
    expect(recorded()).toHaveLength(1);
  });
});
