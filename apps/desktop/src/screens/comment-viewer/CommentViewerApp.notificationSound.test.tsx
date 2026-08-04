import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  act,
  waitFor,
  fireEvent,
} from "@testing-library/react";
import { CommentViewerApp } from "./CommentViewerApp";
import { AUDIO_OUTPUT_DEVICE_KEY } from "../../features/comment-viewer/audioOutputPrefs";
import {
  SOUND_COMMENT_ENABLED_KEY,
  SOUND_MONETARY_ENABLED_KEY,
} from "../../features/comment-viewer/soundPrefs";
import { resetNotificationSoundStateForTest } from "../../features/comment-viewer/notificationSound";
import type { AudioOutputDevice } from "../../features/comment-viewer/audioOutputApi";
import type { CommentViewDto } from "../../features/comment-viewer/types";
import type { CommentEventType } from "../../features/comment-viewer/bindings/CommentEventType";

/**
 * 059a: コメント通知音の**配線**（`CommentViewerApp` が受信バッチをどう音へ変換するか）の仕様テスト。
 *
 * あるべき挙動（docs/tasks/059a-comment-notification-sound.md 完了条件）:
 * - ⚠⚠ **1 バッチ 1 回。** `added` が 20 件でも再生要求は 1 回（`added.forEach` にしない）。
 * - ⚠ **`updated`（043e の Jewels combo 更新）では鳴らさない。** 金額が伸びただけで新しいコメントではない。
 * - OFF のときは鳴らさない（既定 OFF）。
 * - ⚠⚠ **出力先が未選択なら invoke しない**＝既定デバイスへ落とさない（fail-closed）。②-軽では
 *   OS 既定＝仮想オーディオデバイス＝配信に載る側なので、落とすと「載せないつもりの音が配信に載る」。
 * - ⚠⚠ **失敗を無言で捨てない。** ツールバーに**継続表示**の indicator を出す（058a が 059 へ投げた宿題）。
 *   058a は fail-closed かつホットプラグ監視を持たないので、ここが無いと「配信中にデバイスを抜いたら
 *   通知音が鳴らなくなった」ことに気付く手段がゼロになる。
 * - §9: indicator にデバイス名・デバイス ID・例外の中身を出さない。
 *
 * ### ⚠ モックの掛け方がこのファイルの肝
 *
 * `notificationSound` を **実装をそのまま通す spy** にして、**クールダウンより手前**の呼び出し回数を数える。
 * `audioOutputApi` だけをモックして invoke 回数を数えると、「1 バッチ 1 回」を `added.forEach` に
 * 書き換えるミューテーションを入れても**クールダウンが下流で 1 回に潰してしまい、テストが緑のまま通る**。
 * 「1 バッチ 1 回」は**意図**であってクールダウンの副産物ではないので、意図の側を直接固定する。
 *
 * ⚠ 058a の `CommentViewerApp.audio.test.tsx` に同居させず**別ファイル**にした（レビュー観点として明示）。
 * あちらの docstring が「ここは 058a のデバイス選択の配線だけを見る」と宣言しており、受信バッチ→音の
 * 変換規則を混ぜると両方の意図がぼやける。⚠ ファイル冒頭の vi.mock 群が重複するが、
 * **vi.mock はモジュール単位で巻き上げられるため別ファイルへ切り出して共有できない**
 *（058a のファイルに記録済みの結論。共有できるのは spy を束ねる箱とヘルパ関数だけ）。
 * 再修正トリガー＝vitest のセットアップで vi.mock を安全に共有する手立てができたとき。
 */

// vi.mock のファクトリは巻き上げられるため、共有スパイは vi.hoisted で先に作る。
const mocks = vi.hoisted(() => ({
  listAudioOutputDevices: vi.fn(),
  playNotificationSound: vi.fn(),
  requestNotificationSound: vi.fn(),
  connectCommentStream: vi.fn(),
}));

vi.mock("../../features/comment-viewer/audioOutputApi", () => ({
  listAudioOutputDevices: mocks.listAudioOutputDevices,
  playNotificationSound: mocks.playNotificationSound,
}));

// ⚠ **実装は素通しのまま**、呼び出し回数だけ数えられるようにする（上記「モックの掛け方」）。
// これで 1 ファイルの中で「クールダウンの手前（requestNotificationSound の回数）」と
// 「クールダウンの先（playNotificationSound の回数）」の両方を観測できる。
//
// ⚠ **spy は「記録専用」にして、実装は毎回 actual を直接呼ぶ**（レビュー Q-3 で堅牢化）。
// 以前は `mocks.requestNotificationSound.mockImplementation(actual.…)` で spy 自身に実装を載せていたが、
// その形だと `mockReset()`（や vitest 設定の `mockReset: true`）で**実装ごと消えて素通しでなくなり**、
// 症状が「undefined に .then を呼ぶ TypeError」になって原因が分かりにくかった。
// この形なら spy をどうリセットしても壊れるのは「手前の観測点」だけで、配線そのものは常に生きている。
vi.mock("../../features/comment-viewer/notificationSound", async (original) => {
  const actual =
    await original<
      typeof import("../../features/comment-viewer/notificationSound")
    >();
  return {
    ...actual,
    requestNotificationSound: (
      ...args: Parameters<typeof actual.requestNotificationSound>
    ) => {
      mocks.requestNotificationSound(...args);
      return actual.requestNotificationSound(...args);
    },
  };
});

vi.mock("../../features/comment-viewer/commentStream", () => ({
  connectCommentStream: mocks.connectCommentStream,
}));

// 以下は CommentViewerApp のマウント時に走る外部境界の封鎖（058a の audio テストと同型）。
// ⚠ モジュールを**丸ごと差し替える**ので、書かなかった export は undefined になる。
vi.mock("../../features/comment-viewer/windowApi", () => ({
  isCommentOverlayOpen: vi.fn(async () => false),
  openCommentOverlayWindow: vi.fn(async () => {}),
  closeCommentOverlayWindow: vi.fn(async () => {}),
  isPinnedOverlayOpen: vi.fn(async () => false),
  openPinnedOverlayWindow: vi.fn(async () => {}),
  closePinnedOverlayWindow: vi.fn(async () => {}),
  closeCommentViewerWindow: vi.fn(async () => {}),
  isCommentViewerOpen: vi.fn(async () => false),
}));

vi.mock("../../features/comment-viewer/obsApi", () => ({
  detectObsWebsocketConfig: vi.fn(async () => null),
  setObsWebsocketPassword: vi.fn(async () => {}),
  clearObsWebsocketPassword: vi.fn(async () => {}),
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

// jsdom に AudioContext が無いため、読み上げキューと試聴プレイヤーは生成ごと差し替える。
// ⚠ 059a は読み上げ経路を差分ゼロで残す設計なので、ここが差し替わっていても通知音の検証に影響しない。
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
  recordComments: vi.fn(),
  listViewers: vi.fn(async () => []),
  getViewer: vi.fn(),
  updateViewerNote: vi.fn(async () => {}),
  deleteViewer: vi.fn(async () => {}),
  clearViewers: vi.fn(async () => {}),
}));

vi.mock("../../features/platform/useHostOs", () => ({
  useHostOs: () => "macos",
}));

const DEVICES: AudioOutputDevice[] = [
  { id: "CoreAudio:BuiltInSpeakerDevice", name: "内蔵スピーカー" },
  // 2 台目は「デバイスを選び直したら次のコメントが新しいほうで鳴る」（ref 同期）を見るために要る。
  { id: "CoreAudio:UsbHeadphones_UID", name: "USBヘッドホン" },
];
const DEVICE_ID = "CoreAudio:BuiltInSpeakerDevice";
const OTHER_DEVICE_ID = "CoreAudio:UsbHeadphones_UID";

/** テスト用のコメント 1 件（既定は通常チャット・`mergeComments.test.ts` と同型）。 */
const comment = (over: Partial<CommentViewDto> = {}): CommentViewDto => ({
  id: "c1",
  source: "youtube",
  author: { id: "u1", name: "Alice" },
  text: "hello",
  publishedAt: "2026-01-01T00:00:00Z",
  eventType: "chat",
  ...over,
});

beforeEach(() => {
  localStorage.clear();
  resetNotificationSoundStateForTest();
  mocks.listAudioOutputDevices.mockReset();
  mocks.listAudioOutputDevices.mockResolvedValue(DEVICES);
  mocks.playNotificationSound.mockReset();
  mocks.playNotificationSound.mockResolvedValue(undefined);
  // 記録専用の spy なので（上記 vi.mock）、mockClear でも mockReset でも素通しは壊れない。
  // 記録だけ消せばよいので mockClear を使う。
  mocks.requestNotificationSound.mockClear();
  mocks.connectCommentStream.mockReset();
  mocks.connectCommentStream.mockReturnValue({
    disconnect: vi.fn(),
    startLogin: vi.fn(),
    startSession: vi.fn(),
    stopSession: vi.fn(),
    enableObs: vi.fn(),
    hideObs: vi.fn(),
    disableObs: vi.fn(),
  });
});

afterEach(() => {
  vi.useRealTimers();
  // 059b: 一部のテストが `Date.now` を差し替えるので必ず戻す（`mocks.*` は beforeEach が組み直す）。
  vi.restoreAllMocks();
});

/** テスト用の課金コメント 1 件（既定はスパチャ）。⚠ 課金判定は**生の eventType**で行われる。 */
const monetaryComment = (over: Partial<CommentViewDto> = {}): CommentViewDto =>
  comment({
    id: "m1",
    eventType: "superchat",
    text: "応援してます！",
    monetaryAmount: "1,000 JPY",
    monetary: { amount: 1000, currency: "JPY" },
    ...over,
  });

/** コメント通知音 ON ＋ 出力先選択済みの状態で起動する（既定は両方とも未設定）。 */
function setUpEnabled() {
  localStorage.setItem(SOUND_COMMENT_ENABLED_KEY, "true");
  localStorage.setItem(AUDIO_OUTPUT_DEVICE_KEY, DEVICE_ID);
}

/**
 * 059b: 2 音の ON/OFF を明示して起動する（出力先は選択済み）。
 * ⚠ **既定は両方 ON ではない**——「片方 OFF でもう片方は鳴る」を書きやすくするため、毎回明示する。
 */
function setUpSounds(opts: { comment: boolean; monetary: boolean }) {
  localStorage.setItem(SOUND_COMMENT_ENABLED_KEY, String(opts.comment));
  localStorage.setItem(SOUND_MONETARY_ENABLED_KEY, String(opts.monetary));
  localStorage.setItem(AUDIO_OUTPUT_DEVICE_KEY, DEVICE_ID);
}

/**
 * 設定ビューを開く（出力先セクションの有無に依らない版）。
 *
 * ⚠ 059c: 出力先セクションは「どちらかの音が ON のときだけ」描画されるので、**両方 OFF から
 * トグルを ON にする**テストはこちらを使う（`openSettings()` はセレクトを待つので永久に待つ）。
 * 待つ対象は常に存在するトグル。
 */
async function openSettingsView() {
  fireEvent.click(screen.getByRole("button", { name: "設定" }));
  await screen.findByRole("switch", { name: "コメント通知音" });
}

/**
 * 設定ビューを開き、出力先セレクトが列挙し終わるまで待つ（058a の audio テストと同型）。
 *
 * ⚠⚠ **059c: 出力先セクションは「どちらかの音が ON のときだけ」描画される。** よって
 * このヘルパは**どちらかの音を ON にして起動したケースでしか使えない**（両方 OFF だと永久に待つ）。
 * 両方 OFF から始めるテストは上の `openSettingsView()` を使うこと。
 */
async function openSettings() {
  await openSettingsView();
  const select = (await screen.findByRole("combobox", {
    name: "通知音の出力先",
  })) as HTMLSelectElement;
  await waitFor(() => expect(select.options).toHaveLength(DEVICES.length + 1));
  return select;
}

/**
 * 059c: 試聴ボタン（[コメント音, 投げ銭音]）。
 *
 * ⚠ 2 つは**表示名もアクセシブル名も同一**（「通知音を試聴 ▶」）なので並び順で引く。取り違えを
 * 黙って見逃さないよう `title` で並び順を明示検証する（`SettingsView.audio.test.tsx` と同型）。
 */
function previewButtons(): [HTMLButtonElement, HTMLButtonElement] {
  const buttons = screen.getAllByRole("button", {
    name: "通知音を試聴 ▶",
  }) as HTMLButtonElement[];
  expect(buttons).toHaveLength(2);
  expect(buttons[0]).toHaveAttribute(
    "title",
    "コメント通知音を選択中のデバイスで鳴らします",
  );
  expect(buttons[1]).toHaveAttribute(
    "title",
    "投げ銭通知音を選択中のデバイスで鳴らします",
  );
  return [buttons[0], buttons[1]];
}

/** 設定ビューからコメント画面へ戻る（ツールバーが戻るまで待つ）。 */
async function backToComments() {
  fireEvent.click(screen.getByRole("button", { name: "コメントに戻る" }));
  await screen.findByRole("button", { name: "設定" });
}

/**
 * sidecar からのコメント受信を模す（`connectCommentStream` に渡された handlers を直接叩く）。
 *
 * ⚠ **`calls[0]` ではなく最後の呼び出しを見る。** StrictMode は effect を mount → cleanup → mount と
 * 走らせるので接続が 2 回起きる（下の StrictMode テスト）。生きているのは最後のハンドルのほう。
 */
function receive(incoming: CommentViewDto[]) {
  // ⚠ `.at(-1)` は使わない（tsconfig の lib が es2022 未満で typecheck が落ちる）。
  const { calls } = mocks.connectCommentStream.mock;
  const handlers = calls[calls.length - 1]?.[0];
  if (!handlers) throw new Error("connectCommentStream が呼ばれていない");
  act(() => {
    handlers.onComments(incoming);
  });
}

describe("059a コメント通知音（CommentViewerApp の配線）", () => {
  it("⚠⚠ 1 バッチに複数の新着があっても再生要求は 1 回（added.forEach にしない）", () => {
    setUpEnabled();
    render(<CommentViewerApp />);

    receive([
      comment({ id: "c1" }),
      comment({ id: "c2" }),
      comment({ id: "c3" }),
    ]);

    // ⚠ ここはクールダウンの**手前**を数えている。下流（invoke）を数えると、forEach へ
    // 書き換えてもクールダウンが 1 回に潰すので、この退行を検出できない。
    expect(mocks.requestNotificationSound).toHaveBeenCalledTimes(1);
    expect(mocks.requestNotificationSound).toHaveBeenCalledWith(
      "comment",
      DEVICE_ID,
    );
  });

  it("鳴らす音は 'comment'（058a のテスト音ではない）", () => {
    setUpEnabled();
    render(<CommentViewerApp />);
    receive([comment()]);
    expect(mocks.playNotificationSound).toHaveBeenCalledWith(
      DEVICE_ID,
      "comment",
    );
  });

  // ⚠ **`updated`（043e の Jewels combo 更新）で鳴らさないことの固定は 059b の describe へ移した。**
  // combo 再送を起こす種別は jewels だけで、jewels は課金＝059b 以降は**投げ銭音の経路**になるため、
  // ここに置いたままだと「投げ銭音が既定 OFF だから鳴らなかった」で緑になる空振りテストになる
  // （実際に 059b の実装中にそうなった）。移設先は「⚠ updated（Jewels combo 更新）ではどちらの音も
  // 鳴らない」で、**両方の音を ON にしたうえで**初報が鳴り combo 更新が鳴らないことを見ている。

  it("OFF のときは鳴らさない（既定 OFF）", () => {
    localStorage.setItem(AUDIO_OUTPUT_DEVICE_KEY, DEVICE_ID);
    render(<CommentViewerApp />);

    receive([comment()]);
    expect(mocks.requestNotificationSound).not.toHaveBeenCalled();
    expect(mocks.playNotificationSound).not.toHaveBeenCalled();
  });

  it("⚠⚠ 出力先が未選択なら invoke しない（既定デバイスで代わりに鳴らさない＝fail-closed）", () => {
    localStorage.setItem(SOUND_COMMENT_ENABLED_KEY, "true");
    render(<CommentViewerApp />);

    receive([comment()]);
    // ②-軽では OS 既定＝仮想オーディオデバイス＝配信に載る側。ここで既定へ落とすと
    // 「載せないつもりの通知音が配信に載る」＝この機能の存在理由が壊れる。
    expect(mocks.playNotificationSound).not.toHaveBeenCalled();
    // ⚠ **アプリ層のガードも固定する**（レビュー Q-2）。invoke 回数だけを見ると、
    // `playBatchNotification` の未選択ガードを削除しても下流（notificationSound）の同じガードが
    // "skipped" を返すので**緑のまま通る**（実測済み）。fail-closed は多層防御なので層ごとに固定する。
    expect(mocks.requestNotificationSound).not.toHaveBeenCalled();
  });

  it("連投してもクールダウンで間引かれる（1 秒に何度も鳴らさない）", () => {
    setUpEnabled();
    render(<CommentViewerApp />);

    receive([comment({ id: "c1" })]);
    receive([comment({ id: "c2" })]);
    receive([comment({ id: "c3" })]);

    // 要求は 3 回（バッチが 3 つなので正しい）だが、実際に鳴るのは 1 回。
    expect(mocks.requestNotificationSound).toHaveBeenCalledTimes(3);
    expect(mocks.playNotificationSound).toHaveBeenCalledTimes(1);
  });

  it("⚠⚠ StrictMode で setComments の updater が 2 回走っても invoke は 1 回", () => {
    // ⚠ **このテストは 059a レビュー Q-1 で書き直した。** 以前は同じバッチで `receive` を 2 回呼んで
    // いたが、それでは `mergeComments` が id で dedup して 2 回目の `added` が空になり、
    // `playCommentNotification` が `added.length === 0` で早期 return するだけだった
    // ＝**クールダウンを 0 にしても緑のまま通る空振り**で、主張していた性質を何も固定していなかった。
    //
    // 本物の経路はこちら: `onComments` は 1 回でも、`main.tsx` の <React.StrictMode> は
    // **setComments に渡した updater を 2 回実行する**。updater は毎回同じ `prev` に対して merge するので
    // `added = [c1]` が 2 回でき、`playCommentNotification` も 2 回走る。
    // そこで 1 回に潰しているのが**クールダウン**＝通知音は構造的には冪等でなく、
    // **クールダウンが冪等化も担っている**（偶然ではなく設計。CommentViewerApp のコメント参照）。
    setUpEnabled();
    render(
      <React.StrictMode>
        <CommentViewerApp />
      </React.StrictMode>,
    );

    receive([comment({ id: "c1" })]);

    // updater が 2 回走ったこと自体を先に確かめる（ここが 1 だと以下の assert が空振りになる）。
    expect(mocks.requestNotificationSound).toHaveBeenCalledTimes(2);
    // クールダウンが 2 回目を潰して、実際に鳴るのは 1 回。
    expect(mocks.playNotificationSound).toHaveBeenCalledTimes(1);
  });

  it("同じバッチをもう一度受信しても鳴らない（mergeComments が dedup するので added が空）", () => {
    // 上のテストとは**別の防波堤**（クールダウンではなく id の重複排除）を見ている。
    // 両方あることで「どちらが効いているのか」を取り違えずに済む。
    setUpEnabled();
    render(<CommentViewerApp />);

    const batch = [comment({ id: "c1" })];
    receive(batch);
    mocks.requestNotificationSound.mockClear();
    resetNotificationSoundStateForTest();

    receive(batch);
    expect(mocks.requestNotificationSound).not.toHaveBeenCalled();
  });
});

/**
 * 059b: **投げ銭通知音とコメント音の排他**（`playBatchNotification` の分岐）。
 *
 * あるべき挙動（docs/tasks/059b-monetary-notification-sound.md 完了条件）:
 * - ⚠⚠ **排他。** 課金が 1 件でも含まれるバッチでは**投げ銭音だけ** 1 回。両方鳴らさない。
 * - ⚠⚠ **課金判定は `isMonetaryEvent(c.eventType)`。** `isMonetaryEvent(displayEventType(c))` と書くと
 *   **ビッツ（superchat + currency:"BITS"）が落ちる**（`displayEventType` が `"bits"` へ振り替えるが
 *   `"bits"` は `MONETARY_EVENT_TYPES` に無い）。`displayEventType(c) !== "chat"` も採らない
 *   （未知の種別に対して「投げ銭が来た」と嘘をつく）。**この 3 択がこのタスク最大の罠**。
 * - ⚠ **排他は ON/OFF より先に効く。** 代表音を先に決め、その音の ON/OFF だけを見る
 *   ＝投げ銭音 OFF の混在バッチはコメント音へフォールバックせず**無音**。
 * - ⚠ `updated`（043e の Jewels combo）ではどちらも鳴らない。
 *
 * ⚠ モックの位置は 059a と同じ（`notificationSound` を**記録専用 spy**にして、
 * **クールダウンより手前**で数える）。下流の invoke 回数だけを見ると、排他を「両方鳴らす」に
 * 書き換えてもクールダウンや同時再生上限に隠れて緑のまま通りうる。
 */
describe("059b 投げ銭通知音の排他（CommentViewerApp の配線）", () => {
  it("⚠⚠ 課金バッチでは投げ銭音だけが 1 回鳴る（コメント音は鳴らない）", () => {
    setUpSounds({ comment: true, monetary: true });
    render(<CommentViewerApp />);

    receive([monetaryComment()]);

    expect(mocks.requestNotificationSound).toHaveBeenCalledTimes(1);
    expect(mocks.requestNotificationSound).toHaveBeenCalledWith(
      "monetary",
      DEVICE_ID,
    );
    expect(mocks.requestNotificationSound).not.toHaveBeenCalledWith(
      "comment",
      DEVICE_ID,
    );
  });

  it("非課金バッチではコメント音だけが 1 回鳴る", () => {
    setUpSounds({ comment: true, monetary: true });
    render(<CommentViewerApp />);

    receive([comment()]);

    expect(mocks.requestNotificationSound).toHaveBeenCalledTimes(1);
    expect(mocks.requestNotificationSound).toHaveBeenCalledWith(
      "comment",
      DEVICE_ID,
    );
  });

  it("⚠⚠ 混在バッチ（課金 1 件＋通常 5 件）でも投げ銭音のみ 1 回", () => {
    setUpSounds({ comment: true, monetary: true });
    render(<CommentViewerApp />);

    receive([
      comment({ id: "c1" }),
      comment({ id: "c2" }),
      monetaryComment({ id: "m1" }),
      comment({ id: "c3" }),
      comment({ id: "c4" }),
      comment({ id: "c5" }),
    ]);

    expect(mocks.requestNotificationSound).toHaveBeenCalledTimes(1);
    expect(mocks.requestNotificationSound).toHaveBeenCalledWith(
      "monetary",
      DEVICE_ID,
    );
  });

  it("⚠⚠ ビッツ（eventType:'superchat' ＋ currency:'BITS'）でも投げ銭音が鳴る", () => {
    // ①の罠の固定。`isMonetaryEvent(displayEventType(c))` に書き換えると**ここだけ**が落ちる
    //（`displayEventType` が "bits" を返し、"bits" は MONETARY_EVENT_TYPES に無いため）。
    setUpSounds({ comment: true, monetary: true });
    render(<CommentViewerApp />);

    receive([
      monetaryComment({
        id: "b1",
        text: "Power-up 🎉",
        monetaryAmount: "500 bits",
        monetary: { amount: 500, currency: "BITS" },
      }),
    ]);

    expect(mocks.requestNotificationSound).toHaveBeenCalledWith(
      "monetary",
      DEVICE_ID,
    );
  });

  it.each([
    ["サブスク", "subscription"],
    ["メンバーシップ", "membership"],
    ["ギフト", "gift"],
    ["ドネーション", "donation"],
    ["ジュエル", "jewels"],
  ] as [string, CommentEventType][])(
    "金額を持たない課金種別（%s）でも投げ銭音が鳴る",
    (_label, eventType) => {
      // MONETARY_EVENT_TYPES の全種別を通す＝上流で種別が増えたとき「表示は課金なのに音はコメント音」
      // という分裂が起きないことの担保（判定を 2 実装に分裂させない、という申し送りの本体）。
      setUpSounds({ comment: true, monetary: true });
      render(<CommentViewerApp />);

      receive([comment({ id: `x-${eventType}`, eventType, text: "" })]);

      expect(mocks.requestNotificationSound).toHaveBeenCalledWith(
        "monetary",
        DEVICE_ID,
      );
    },
  );

  it("⚠ 未知の種別は課金扱いにしない（コメント音が鳴る）", () => {
    // `displayEventType(c) !== "chat"` で判定すると**ここが落ちる**。オーバーレイのカード分岐は
    // それでよい（見た目が違うだけ）が、音で同じことをすると「投げ銭が来た」と嘘をつくことになる。
    // ⚠ キャストしているのは、`CommentEventType` が**今の**wire 契約（ts-rs 生成）だから。
    // 上流（sidecar / 配信サービス）が新しい種別を送ってくる状況＝型が知らない値の到来を再現している。
    // `isMonetaryEvent` の引数が `string` なのも同じ理由（未知の値が来うる前提の述語）。
    setUpSounds({ comment: true, monetary: true });
    render(<CommentViewerApp />);

    receive([
      comment({ id: "u1", eventType: "raid" as CommentEventType, text: "" }),
    ]);

    expect(mocks.requestNotificationSound).toHaveBeenCalledWith(
      "comment",
      DEVICE_ID,
    );
    expect(mocks.requestNotificationSound).not.toHaveBeenCalledWith(
      "monetary",
      DEVICE_ID,
    );
  });

  it("⚠ updated（Jewels combo 更新）ではどちらの音も鳴らない", () => {
    setUpSounds({ comment: true, monetary: true });
    render(<CommentViewerApp />);

    const jewels = comment({
      id: "g1",
      eventType: "jewels",
      text: "",
      monetaryAmount: "30 JEWELS",
      monetary: { amount: 30, currency: "JEWELS" },
      comboCount: 1,
    });
    receive([jewels]); // 初報は新着なので投げ銭音が鳴る。
    expect(mocks.requestNotificationSound).toHaveBeenCalledWith(
      "monetary",
      DEVICE_ID,
    );
    mocks.requestNotificationSound.mockClear();
    // クールダウンで潰れて「鳴らない」のではなく、**そもそも要求されない**ことを見たいので消す。
    resetNotificationSoundStateForTest();

    receive([{ ...jewels, monetaryAmount: "60 JEWELS", comboCount: 2 }]);
    expect(mocks.requestNotificationSound).not.toHaveBeenCalled();
  });

  it("⚠⚠ 排他は ON/OFF より先に効く（投げ銭 OFF の混在バッチは無音）", () => {
    // 本人決定（2026-08-04）。バッチの代表音を先に決め、**その音の ON/OFF だけ**を見る。
    // コメント音へフォールバックすると「投げ銭音を OFF にしたのにスパチャでコメント音が鳴る」になる。
    setUpSounds({ comment: true, monetary: false });
    render(<CommentViewerApp />);

    receive([comment({ id: "c1" }), monetaryComment({ id: "m1" })]);

    expect(mocks.requestNotificationSound).not.toHaveBeenCalled();
    expect(mocks.playNotificationSound).not.toHaveBeenCalled();
  });

  it("ON/OFF は音ごとに独立（コメント音 OFF でも投げ銭音は鳴る）", () => {
    setUpSounds({ comment: false, monetary: true });
    render(<CommentViewerApp />);

    receive([comment({ id: "c1" })]);
    expect(mocks.requestNotificationSound).not.toHaveBeenCalled();

    receive([monetaryComment({ id: "m1" })]);
    expect(mocks.requestNotificationSound).toHaveBeenCalledWith(
      "monetary",
      DEVICE_ID,
    );
  });

  it("ON/OFF は音ごとに独立（投げ銭音 OFF でもコメント音は鳴る）", () => {
    setUpSounds({ comment: true, monetary: false });
    render(<CommentViewerApp />);

    receive([monetaryComment({ id: "m1" })]);
    expect(mocks.requestNotificationSound).not.toHaveBeenCalled();

    receive([comment({ id: "c1" })]);
    expect(mocks.requestNotificationSound).toHaveBeenCalledWith(
      "comment",
      DEVICE_ID,
    );
  });

  it("⚠⚠ 出力先が未選択なら投げ銭音でも invoke しない（fail-closed は 2 音とも）", () => {
    localStorage.setItem(SOUND_MONETARY_ENABLED_KEY, "true");
    render(<CommentViewerApp />);

    receive([monetaryComment()]);
    // ②-軽では OS 既定＝仮想オーディオデバイス＝配信に載る側。落とすと「載せないつもりの音が載る」。
    expect(mocks.playNotificationSound).not.toHaveBeenCalled();
    // ⚠ アプリ層のガードも固定する（レビュー Q-2・理由は 059a 側の同名テストの注記）。
    expect(mocks.requestNotificationSound).not.toHaveBeenCalled();
  });

  it("⚠⚠ StrictMode で updater が 2 回走っても投げ銭音の invoke は 1 回", async () => {
    // レビュー Q-5。059a 側には同型のテストがあるが投げ銭音には無かった。
    // 冪等化を担っているのは**クールダウン**で、その判定は `requestNotificationSound` の
    // **先頭で同期的に**走る（連結より手前）——だから 059b で invoke が 1 マイクロタスク遅れても
    // 冪等性は保たれる。⚠ **クールダウン判定を await の後ろへ動かすと投げ銭音だけ 2 回鳴る**ので、
    // その退行をここで止める。
    setUpSounds({ comment: true, monetary: true });
    render(
      <React.StrictMode>
        <CommentViewerApp />
      </React.StrictMode>,
    );

    receive([monetaryComment()]);

    // updater が 2 回走ったこと自体を先に確かめる（ここが 1 だと以下の assert が空振りになる）。
    expect(mocks.requestNotificationSound).toHaveBeenCalledTimes(2);
    await waitFor(() =>
      expect(mocks.playNotificationSound).toHaveBeenCalledTimes(1),
    );
    // 2 回目はクールダウンが同期的に潰しているので、待っても増えない。
    await Promise.resolve();
    expect(mocks.playNotificationSound).toHaveBeenCalledTimes(1);
    expect(mocks.playNotificationSound).toHaveBeenCalledWith(
      DEVICE_ID,
      "monetary",
    );
  });

  it("鳴らす音は 'monetary'（コメント音でもテスト音でもない）", async () => {
    setUpSounds({ comment: true, monetary: true });
    render(<CommentViewerApp />);

    receive([monetaryComment()]);

    // ⚠ 投げ銭音は「Rust の同時再生 1 本に譲る」ため invoke が 1 マイクロタスク遅れる（notificationSound.ts）。
    await waitFor(() =>
      expect(mocks.playNotificationSound).toHaveBeenCalledWith(
        DEVICE_ID,
        "monetary",
      ),
    );
  });
});

/**
 * 059b: **クールダウンが音源 ID ごとに独立していること**を、アプリの配線を通して固定する。
 *
 * ⚠⚠ **ここが本タスクで一番壊れやすい。** 共有カウンタにすると「コメントが流れている最中に来た
 * スパチャの音がコメント音のクールダウンで消える」＝一番気づいてほしい音が鳴らない、になる。
 * `notificationSound.test.ts` にも単体の固定はあるが、**配線側でも見る**——`playBatchNotification` が
 * 音源 ID を渡し違えると（例: 常に "comment" を渡す）単体テストは緑のまま配線だけ壊れるため。
 */
describe("059b クールダウンの独立（配線経由）", () => {
  it("⚠⚠ コメント音の直後に来たスパチャでも投げ銭音が鳴る", async () => {
    setUpSounds({ comment: true, monetary: true });
    render(<CommentViewerApp />);

    receive([comment({ id: "c1" })]);
    await waitFor(() =>
      expect(mocks.playNotificationSound).toHaveBeenCalledWith(
        DEVICE_ID,
        "comment",
      ),
    );

    // ⚠ クールダウンを消さない（消すと「独立しているから鳴った」のか「クールダウンが無いから
    // 鳴った」のか区別できず、共有カウンタへのミューテーションを検出できなくなる）。
    receive([monetaryComment({ id: "m1" })]);
    await waitFor(() =>
      expect(mocks.playNotificationSound).toHaveBeenCalledWith(
        DEVICE_ID,
        "monetary",
      ),
    );
    expect(mocks.playNotificationSound).toHaveBeenCalledTimes(2);
  });

  it("⚠ Twitch のコミュニティギフト（N+1 件）はクールダウンで 1 回に潰れる", async () => {
    // 043a から残る既存課題（community_sub_gift(total=N) と個別 sub_gift×N の**両方**が届き、
    // gift 行が N+1 個生成される）。059b は**解消せずクールダウンで凌ぐ**——その依存をここで固定する。
    //
    // ⚠⚠ **到着の広がりを Date.now で再現するのが肝**（レビュー観点として明示）。素朴に 6 バッチを
    // 連続して `receive` すると全部が同一 tick に入り、**クールダウンが 1ms でも 1 回に潰れて緑になる**
    // ＝「クールダウンに依存している」ことを何も固定していない空振りテストになる
    //（059b の実装中にミューテーション④で実測した：`monetary` を 300ms に縮めても緑のままだった）。
    // ⚠ 1 件あたり 250ms（6 件で 1250ms）は「1500ms のクールダウンにぎりぎり収まる広がり」で、
    // **値を縮めると必ず落ちる**ように選んである（600ms なら 2 回・300ms なら 3 回鳴る）。
    const ARRIVAL_INTERVAL_MS = 250;
    let now = Date.parse("2026-08-04T12:00:00Z");
    vi.spyOn(Date, "now").mockImplementation(() => now);

    setUpSounds({ comment: true, monetary: true });
    render(<CommentViewerApp />);

    // 束（total=5）＋個別 5 件が、sidecar から 1 件ずつ別バッチで届く。
    receive([
      comment({ id: "gift-bundle", eventType: "gift", text: "", giftCount: 5 }),
    ]);
    for (let i = 0; i < 5; i++) {
      now += ARRIVAL_INTERVAL_MS;
      receive([comment({ id: `gift-${i}`, eventType: "gift", text: "" })]);
    }

    // 排他の分岐は 6 回通る（バッチが 6 つなので正しい）が、実際に鳴るのは 1 回だけ。
    expect(mocks.requestNotificationSound).toHaveBeenCalledTimes(6);
    await waitFor(() =>
      expect(mocks.playNotificationSound).toHaveBeenCalledTimes(1),
    );
    expect(mocks.playNotificationSound).toHaveBeenCalledWith(
      DEVICE_ID,
      "monetary",
    );
  });
});

/**
 * 059a: 設定の変更が**受信経路へ届く**ことと、その届け方（ref 経由）が
 * 「窓内 WS 1 本」の原則を壊していないこと。
 *
 * あるべき挙動:
 * - 設定を変えたら、**次のコメントから**新しい設定で鳴る（stale closure を作らない）。
 * - ⚠⚠ **設定を変えても WS は張り直さない。** `playCommentNotification` を WS 接続 effect の
 *   deps に載せているので、これが `useCallback([])` で安定でなくなると**コメント接続が切れて繋ぎ直る**
 *   ——通知音の設定を触っただけで配信中のコメント取得が途切れる、という一番やってはいけない壊れ方になる。
 * - ON/OFF は localStorage に永続し、開き直しで復元される。
 */
describe("059a 設定変更の反映（ref 同期と「窓内 WS 1 本」）", () => {
  it("⚠ デバイスを選び直したら、次のコメントは新しいデバイスで鳴る（stale closure を作らない）", async () => {
    setUpEnabled();
    render(<CommentViewerApp />);

    const select = await openSettings();
    fireEvent.change(select, { target: { value: OTHER_DEVICE_ID } });
    await backToComments();

    receive([comment()]);
    await waitFor(() =>
      expect(mocks.playNotificationSound).toHaveBeenCalledWith(
        OTHER_DEVICE_ID,
        "comment",
      ),
    );
    // 古いデバイスでは鳴らしていない（ref が古い値のまま固まっていない）。
    expect(mocks.playNotificationSound).not.toHaveBeenCalledWith(
      DEVICE_ID,
      "comment",
    );
  });

  it("⚠ OFF で起動しても、設定で ON にすれば次のコメントから鳴る", async () => {
    // 既定 OFF なので、この経路が壊れていると**機能そのものが使えない**（初回の ON が効かない）。
    localStorage.setItem(AUDIO_OUTPUT_DEVICE_KEY, DEVICE_ID);
    render(<CommentViewerApp />);

    // ⚠ 059c: 両方 OFF で開くので出力先セクションはまだ無い（`openSettings()` は使えない）。
    await openSettingsView();
    fireEvent.click(screen.getByRole("switch", { name: "コメント通知音" }));
    await backToComments();

    receive([comment()]);
    await waitFor(() =>
      expect(mocks.playNotificationSound).toHaveBeenCalledWith(
        DEVICE_ID,
        "comment",
      ),
    );
  });

  it("⚠⚠ 設定を触ってもコメント接続は張り直さない（窓内 WS 1 本）", async () => {
    setUpEnabled();
    render(<CommentViewerApp />);
    expect(mocks.connectCommentStream).toHaveBeenCalledTimes(1);

    const select = await openSettings();
    fireEvent.click(screen.getByRole("switch", { name: "コメント通知音" }));
    fireEvent.change(select, { target: { value: OTHER_DEVICE_ID } });
    await backToComments();

    // ⚠ 通知音の state を useCallback の依存に入れると、ここが 2 回以上になる
    // ＝設定を触っただけでコメント取得が切れて繋ぎ直る。
    expect(mocks.connectCommentStream).toHaveBeenCalledTimes(1);
  });

  it("ON/OFF は localStorage に永続し、開き直しで復元する", async () => {
    localStorage.setItem(AUDIO_OUTPUT_DEVICE_KEY, DEVICE_ID);
    const { unmount } = render(<CommentViewerApp />);

    // ⚠ 059c: 両方 OFF で開くので出力先セクションはまだ無い（`openSettings()` は使えない）。
    await openSettingsView();
    fireEvent.click(screen.getByRole("switch", { name: "コメント通知音" }));
    await waitFor(() =>
      expect(localStorage.getItem(SOUND_COMMENT_ENABLED_KEY)).toBe("true"),
    );
    unmount();

    render(<CommentViewerApp />);
    await openSettingsView();
    expect(screen.getByRole("switch", { name: "コメント通知音" })).toBeChecked();
  });

  it("§9 追補(046a): コメントを受信しても第三者の個人データもデバイス名も保存しない", () => {
    // 通知音が保存してよいのは**ユーザー自身の UI 設定値**だけ（bool 1 つ）。
    // コメント本文・表示名は端末保存の対象外で、デバイスは**名前ではなく ID** だけを持つ
    //（名前を保存すると古い名前が残るうえ、接続機器の構成が §9 の対象になる）。
    setUpEnabled();
    render(<CommentViewerApp />);

    receive([
      comment({
        text: "Zz-秘密のコメント本文-9f3a",
        author: { id: "u9", name: "Zz-視聴者の表示名-9f3a" },
      }),
    ]);

    const stored = Object.keys(localStorage).map((key) =>
      String(localStorage.getItem(key)),
    );
    for (const leak of [
      "Zz-秘密のコメント本文-9f3a",
      "Zz-視聴者の表示名-9f3a",
      "内蔵スピーカー",
    ]) {
      expect(stored.join("\n")).not.toContain(leak);
    }
  });
});

describe("059a 通知音が鳴らせないことの継続表示（058a からの宿題）", () => {
  it("⚠⚠ 再生に失敗したらツールバーに継続表示が出る（黙って鳴らなくならない）", async () => {
    setUpEnabled();
    mocks.playNotificationSound.mockRejectedValue({
      code: "AUDIO_DEVICE_UNAVAILABLE",
    });
    render(<CommentViewerApp />);

    receive([comment()]);
    expect(
      await screen.findByText("通知音を再生できません"),
    ).toBeInTheDocument();
  });

  it("§9: 継続表示にデバイス名・デバイス ID・例外の中身を出さない", async () => {
    setUpEnabled();
    mocks.playNotificationSound.mockRejectedValue(
      new Error("CoreAudio OSStatus -10851 on Zz-PrivateHeadset-9f3a"),
    );
    const { container } = render(<CommentViewerApp />);

    receive([comment()]);
    await screen.findByText("通知音を再生できません");

    for (const leak of ["OSStatus", "-10851", "Zz-PrivateHeadset-9f3a"]) {
      expect(container.textContent).not.toContain(leak);
    }
  });

  it("次の再生が成功したら消える（デバイスを挿し直せば自動で回復する）", async () => {
    setUpEnabled();
    mocks.playNotificationSound.mockRejectedValue({
      code: "AUDIO_DEVICE_UNAVAILABLE",
    });
    render(<CommentViewerApp />);

    receive([comment({ id: "c1" })]);
    await screen.findByText("通知音を再生できません");

    // デバイスを挿し直した状況＝次のコメントでは鳴る。
    mocks.playNotificationSound.mockResolvedValue(undefined);
    resetNotificationSoundStateForTest();
    receive([comment({ id: "c2" })]);

    await waitFor(() =>
      expect(
        screen.queryByText("通知音を再生できません"),
      ).not.toBeInTheDocument(),
    );
  });

  it("⚠ クールダウンで鳴らさなかっただけでは消えない（skip は故障ではないが、回復でもない）", async () => {
    setUpEnabled();
    mocks.playNotificationSound.mockRejectedValue({
      code: "AUDIO_DEVICE_UNAVAILABLE",
    });
    render(<CommentViewerApp />);

    receive([comment({ id: "c1" })]);
    await screen.findByText("通知音を再生できません");

    // クールダウン中の 2 件目（invoke されない）。ここで消すと「まだ直っていないのに直ったように見える」。
    receive([comment({ id: "c2" })]);
    expect(screen.getByText("通知音を再生できません")).toBeInTheDocument();
  });

  it("通知音を OFF にすると消える（鳴らないのが正常な状態で赤字を残さない）", async () => {
    setUpEnabled();
    mocks.playNotificationSound.mockRejectedValue({
      code: "AUDIO_DEVICE_UNAVAILABLE",
    });
    render(<CommentViewerApp />);

    receive([comment()]);
    await screen.findByText("通知音を再生できません");

    // 設定ビューのトグルで OFF にする（表示条件が `soundCommentEnabled && ...` なので消えるはず）。
    // ⚠ **必ずコメント画面へ戻ってから確認すること。** 設定ビューはツールバーごと差し替わるので、
    // 設定を開いたまま assert すると **トグルの状態と無関係に消えて空振りする**（実際に一度踏んだ）。
    fireEvent.click(screen.getByRole("button", { name: "設定" }));
    fireEvent.click(screen.getByRole("switch", { name: "コメント通知音" }));
    fireEvent.click(screen.getByRole("button", { name: "コメントに戻る" }));

    // 戻れたこと（＝ツールバーが再びある状態で見ていること）を先に確かめる。
    await screen.findByRole("button", { name: "設定" });
    expect(
      screen.queryByText("通知音を再生できません"),
    ).not.toBeInTheDocument();
  });

  it("⚠ 設定を開いて閉じただけでは消えない（上のテストが空振りでないことの担保）", async () => {
    setUpEnabled();
    mocks.playNotificationSound.mockRejectedValue({
      code: "AUDIO_DEVICE_UNAVAILABLE",
    });
    render(<CommentViewerApp />);

    receive([comment()]);
    await screen.findByText("通知音を再生できません");

    // トグルを触らずに往復する＝ ON のままなので、戻ったら赤字は残っていなければならない。
    fireEvent.click(screen.getByRole("button", { name: "設定" }));
    fireEvent.click(screen.getByRole("button", { name: "コメントに戻る" }));

    await screen.findByRole("button", { name: "設定" });
    expect(screen.getByText("通知音を再生できません")).toBeInTheDocument();
  });

  // ⚠⚠ **059c で 2 本削除した**（本人指示の UI 再編に伴い、仕様そのものが無くなったため）:
  // ①「058a の『テスト再生』が成功しても消える」…テスト再生ボタンが削除された。**この導線
  //   （選択を変えずにデバイスを挿し直したときの復旧）は下の「『試聴』が成功しても消える」が
  //   そのまま担う**ので、担保は減っていない（赤字の title も「設定の『通知音』で」へ更新済み）。
  // ②「試聴の失敗が 058a のカードへ漏れない」…カードが 1 枚に統合され `AudioTestState` も
  //   削除されたので、**取り違える相手が存在しない**（059a レビュー Q-9 が branded type の代わりに
  //   置いていた配線テストで、役目を終えた）。

  it("⚠ 試聴の失敗を出す（§9: デバイス名・ID・例外の中身を出さない）", async () => {
    // 上の②の代わりに、**試聴の失敗が正しく自分の場所に出ること**だけを残す。
    setUpEnabled();
    render(<CommentViewerApp />);

    await openSettings();
    // ⚠ 列挙（非同期）が終わるまで disabled なので、enabled を待ってから押す。
    const [commentPreview] = previewButtons();
    await waitFor(() => expect(commentPreview).toBeEnabled());

    mocks.playNotificationSound.mockRejectedValue(
      new Error("CoreAudio OSStatus -10851 on Zz-PrivateHeadset-9f3a"),
    );
    fireEvent.click(commentPreview);

    const message = await screen.findByText(
      "通知音を再生できませんでした。デバイスを選び直してください。",
    );
    expect(message).toBeInTheDocument();
    for (const leak of ["OSStatus", "-10851", "Zz-PrivateHeadset-9f3a"]) {
      expect(message.textContent).not.toContain(leak);
    }
  });

  it("⚠ 「試聴」が成功しても消える（次のコメントを待たずに赤字を消せる導線）", async () => {
    setUpEnabled();
    mocks.playNotificationSound.mockRejectedValue({
      code: "AUDIO_DEVICE_UNAVAILABLE",
    });
    render(<CommentViewerApp />);

    receive([comment()]);
    await screen.findByText("通知音を再生できません");

    await openSettings();
    mocks.playNotificationSound.mockResolvedValue(undefined);
    mocks.playNotificationSound.mockClear();
    fireEvent.click(previewButtons()[0]);
    await waitFor(() =>
      expect(mocks.playNotificationSound).toHaveBeenCalledWith(
        DEVICE_ID,
        "comment",
      ),
    );
    await backToComments();

    expect(
      screen.queryByText("通知音を再生できません"),
    ).not.toBeInTheDocument();
  });

  it("⚠ デバイスを選び直しても消える（ユーザーが対処したので赤字を残さない）", async () => {
    setUpEnabled();
    mocks.playNotificationSound.mockRejectedValue({
      code: "AUDIO_DEVICE_UNAVAILABLE",
    });
    render(<CommentViewerApp />);

    receive([comment()]);
    await screen.findByText("通知音を再生できません");

    const select = await openSettings();
    fireEvent.change(select, { target: { value: OTHER_DEVICE_ID } });
    await backToComments();

    expect(
      screen.queryByText("通知音を再生できません"),
    ).not.toBeInTheDocument();
  });

  it("⚠⚠ クールダウンで鳴らさなかっただけでは継続表示を立てない（skipped ≠ failed）", async () => {
    // `"skipped"` は**鳴らせなかった**のではなく**鳴らさないことにした**状態。ここを failed と同じ扱いに
    // すると、連投のたびに「通知音を再生できません」が出て**正常動作が故障に見える**。
    // ⚠ 既存の「skip では消えない」テストは failed が先に立っているので、この向きの退行
    //（skipped を failed 扱いにする）を検出できない。両方向が要る。
    setUpEnabled();
    render(<CommentViewerApp />);

    // 1 件目は成功。
    receive([comment({ id: "c1" })]);
    await waitFor(() =>
      expect(mocks.playNotificationSound).toHaveBeenCalledTimes(1),
    );

    // 2 件目はクールダウン内なので "skipped"。
    receive([comment({ id: "c2" })]);
    await waitFor(() =>
      expect(mocks.requestNotificationSound).toHaveBeenCalledTimes(2),
    );
    expect(mocks.playNotificationSound).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByText("通知音を再生できません"),
    ).not.toBeInTheDocument();
  });

  it("⚠ ON でも出力先が未選択なら継続表示は出ない（鳴らないのは故障ではない）", () => {
    // 未選択は "skipped"＝**鳴らせなかった**のではなく**鳴らさないことにした**状態。
    // ここで赤字を出すと、案内すべき場所（設定カードの「出力先が未選択です」）と二重に叱ることになる。
    localStorage.setItem(SOUND_COMMENT_ENABLED_KEY, "true");
    render(<CommentViewerApp />);

    receive([comment()]);
    expect(
      screen.queryByText("通知音を再生できません"),
    ).not.toBeInTheDocument();
  });

  it("OFF のあいだは失敗しても継続表示が出ない（そもそも鳴らさないので要求も飛ばない）", () => {
    localStorage.setItem(AUDIO_OUTPUT_DEVICE_KEY, DEVICE_ID);
    mocks.playNotificationSound.mockRejectedValue({
      code: "AUDIO_DEVICE_UNAVAILABLE",
    });
    render(<CommentViewerApp />);

    receive([comment()]);
    expect(
      screen.queryByText("通知音を再生できません"),
    ).not.toBeInTheDocument();
  });

  it("⚠⚠ コメント音 OFF ＋投げ銭音 ON でも継続表示が出る（ゲートは 2 音の OR・059b）", async () => {
    // ゲートを `soundCommentEnabled &&` のままにすると**ここだけ**が落ちる。
    // 「投げ銭音だけ ON で配信していてデバイスを抜いた」が、まさに黙って鳴らなくなる状況。
    setUpSounds({ comment: false, monetary: true });
    mocks.playNotificationSound.mockRejectedValue({
      code: "AUDIO_DEVICE_UNAVAILABLE",
    });
    render(<CommentViewerApp />);

    receive([monetaryComment()]);
    expect(
      await screen.findByText("通知音を再生できません"),
    ).toBeInTheDocument();
  });

  it("§9: 投げ銭で失敗しても継続表示に金額・投稿者名・本文・例外の中身を出さない（059b）", async () => {
    // docs/security.md §9 追補（058a のデバイス名／046a の第三者データ）。⚠ **059b で「金額」という
    // 新しい機微が経路に入った**ので、コメント音側（既存テスト）とは別に明示的に見る。
    // ⚠ コメント本体は画面に出るのが正しい（表示が仕事）ので、**container 全体ではなく
    // indicator の文言と title だけ**を対象にする＝「警告文に出さない」が仕様。
    setUpSounds({ comment: false, monetary: true });
    mocks.playNotificationSound.mockRejectedValue(
      new Error("CoreAudio OSStatus -10851 on Zz-PrivateHeadset-9f3a"),
    );
    render(<CommentViewerApp />);

    receive([
      monetaryComment({
        text: "Zz-秘密のスパチャ本文-9f3a",
        author: { id: "u9", name: "Zz-投げ銭した人-9f3a" },
        monetaryAmount: "Zz-99999-JPY-9f3a",
        monetary: { amount: 99999, currency: "JPY" },
      }),
    ]);

    const indicator = await screen.findByText("通知音を再生できません");
    // 文言は固定文字列（音種でも失敗理由でも変わらない）。
    expect(indicator.textContent).toBe("通知音を再生できません");
    const shown = `${indicator.textContent ?? ""}\n${indicator.getAttribute("title") ?? ""}`;
    for (const leak of [
      "Zz-秘密のスパチャ本文-9f3a",
      "Zz-投げ銭した人-9f3a",
      "Zz-99999-JPY-9f3a",
      "99999",
      "OSStatus",
      "-10851",
      "Zz-PrivateHeadset-9f3a",
      "内蔵スピーカー",
      DEVICE_ID,
    ]) {
      expect(shown).not.toContain(leak);
    }
  });

  it("両方 OFF にすると消える（鳴らないのが正常な状態で赤字を残さない）", async () => {
    setUpSounds({ comment: true, monetary: true });
    mocks.playNotificationSound.mockRejectedValue({
      code: "AUDIO_DEVICE_UNAVAILABLE",
    });
    render(<CommentViewerApp />);

    receive([comment()]);
    await screen.findByText("通知音を再生できません");

    // ⚠ 片方 OFF にしただけでは消えない（OR ゲート）ことも同時に見る。
    fireEvent.click(screen.getByRole("button", { name: "設定" }));
    fireEvent.click(screen.getByRole("switch", { name: "コメント通知音" }));
    fireEvent.click(screen.getByRole("button", { name: "コメントに戻る" }));
    await screen.findByRole("button", { name: "設定" });
    expect(screen.getByText("通知音を再生できません")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "設定" }));
    fireEvent.click(screen.getByRole("switch", { name: "投げ銭通知音" }));
    fireEvent.click(screen.getByRole("button", { name: "コメントに戻る" }));
    await screen.findByRole("button", { name: "設定" });
    expect(
      screen.queryByText("通知音を再生できません"),
    ).not.toBeInTheDocument();
  });

  it("⚠ 投げ銭音の試聴が成功しても消える（059a の試聴と同じ導線・059b）", async () => {
    setUpSounds({ comment: true, monetary: true });
    mocks.playNotificationSound.mockRejectedValue({
      code: "AUDIO_DEVICE_UNAVAILABLE",
    });
    render(<CommentViewerApp />);

    receive([comment()]);
    await screen.findByText("通知音を再生できません");

    await openSettings();
    mocks.playNotificationSound.mockResolvedValue(undefined);
    mocks.playNotificationSound.mockClear();
    fireEvent.click(previewButtons()[1]);
    await waitFor(() =>
      expect(mocks.playNotificationSound).toHaveBeenCalledWith(
        DEVICE_ID,
        "monetary",
      ),
    );
    await backToComments();

    expect(
      screen.queryByText("通知音を再生できません"),
    ).not.toBeInTheDocument();
  });
});

/**
 * 059b: 投げ銭音の設定が受信経路へ届くこと（059a の ref 同期テストと同型）。
 * ⚠ **「窓内 WS 1 本」を壊していないこと**を、トグルが 2 つになった状態でもう一度固定する。
 */
describe("059b 投げ銭音の設定反映（ref 同期と「窓内 WS 1 本」）", () => {
  it("⚠ OFF で起動しても、設定で ON にすれば次のスパチャから鳴る", async () => {
    // 既定 OFF なので、この経路が壊れていると**機能そのものが使えない**。
    localStorage.setItem(AUDIO_OUTPUT_DEVICE_KEY, DEVICE_ID);
    render(<CommentViewerApp />);

    // ⚠ 059c: 両方 OFF で開くので出力先セクションはまだ無い（`openSettings()` は使えない）。
    await openSettingsView();
    fireEvent.click(screen.getByRole("switch", { name: "投げ銭通知音" }));
    await backToComments();

    receive([monetaryComment()]);
    await waitFor(() =>
      expect(mocks.playNotificationSound).toHaveBeenCalledWith(
        DEVICE_ID,
        "monetary",
      ),
    );
  });

  it("ON/OFF は localStorage に永続し、開き直しで復元する", async () => {
    localStorage.setItem(AUDIO_OUTPUT_DEVICE_KEY, DEVICE_ID);
    const { unmount } = render(<CommentViewerApp />);

    // ⚠ 059c: 両方 OFF で開くので出力先セクションはまだ無い（`openSettings()` は使えない）。
    await openSettingsView();
    fireEvent.click(screen.getByRole("switch", { name: "投げ銭通知音" }));
    await waitFor(() =>
      expect(localStorage.getItem(SOUND_MONETARY_ENABLED_KEY)).toBe("true"),
    );
    unmount();

    render(<CommentViewerApp />);
    await openSettingsView();
    expect(screen.getByRole("switch", { name: "投げ銭通知音" })).toBeChecked();
  });

  it("⚠⚠ 投げ銭音のトグルを触ってもコメント接続は張り直さない（窓内 WS 1 本）", async () => {
    setUpSounds({ comment: true, monetary: true });
    render(<CommentViewerApp />);
    expect(mocks.connectCommentStream).toHaveBeenCalledTimes(1);

    await openSettings();
    fireEvent.click(screen.getByRole("switch", { name: "投げ銭通知音" }));
    await backToComments();

    // ⚠ soundMonetaryEnabled を useCallback の依存に入れると、ここが 2 回以上になる
    // ＝設定を触っただけで配信中のコメント取得が切れて繋ぎ直る。
    expect(mocks.connectCommentStream).toHaveBeenCalledTimes(1);
  });

  it("§9 追補(046a): 投げ銭を受信しても金額・投稿者名・本文を保存しない", () => {
    // 通知音が保存してよいのは**ユーザー自身の UI 設定値**だけ（bool 2 つ）。
    // ⚠ 投げ銭は金額という新しい機微を持つので、コメント音のときより明示的に見る。
    setUpSounds({ comment: true, monetary: true });
    render(<CommentViewerApp />);

    receive([
      monetaryComment({
        text: "Zz-秘密のスパチャ本文-9f3a",
        author: { id: "u9", name: "Zz-投げ銭した人-9f3a" },
        monetaryAmount: "Zz-99999-JPY-9f3a",
        monetary: { amount: 99999, currency: "JPY" },
      }),
    ]);

    const stored = Object.keys(localStorage).map((key) =>
      String(localStorage.getItem(key)),
    );
    for (const leak of [
      "Zz-秘密のスパチャ本文-9f3a",
      "Zz-投げ銭した人-9f3a",
      "Zz-99999-JPY-9f3a",
      "99999",
      "内蔵スピーカー",
    ]) {
      expect(stored.join("\n")).not.toContain(leak);
    }
  });
});
