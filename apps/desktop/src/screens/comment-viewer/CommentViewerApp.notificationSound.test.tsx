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
import { SOUND_COMMENT_ENABLED_KEY } from "../../features/comment-viewer/soundPrefs";
import { resetNotificationSoundCooldownForTest } from "../../features/comment-viewer/notificationSound";
import type { AudioOutputDevice } from "../../features/comment-viewer/audioOutputApi";
import type { CommentViewDto } from "../../features/comment-viewer/types";

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
  resetNotificationSoundCooldownForTest();
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
});

/** 通知音 ON ＋ 出力先選択済みの状態で起動する（既定は両方とも未設定）。 */
function setUpEnabled() {
  localStorage.setItem(SOUND_COMMENT_ENABLED_KEY, "true");
  localStorage.setItem(AUDIO_OUTPUT_DEVICE_KEY, DEVICE_ID);
}

/** 設定ビューを開き、出力先セレクトが列挙し終わるまで待つ（058a の audio テストと同型）。 */
async function openSettings() {
  fireEvent.click(screen.getByRole("button", { name: "設定" }));
  const select = (await screen.findByRole("combobox", {
    name: "通知音の出力先",
  })) as HTMLSelectElement;
  await waitFor(() =>
    expect(select.options).toHaveLength(DEVICES.length + 1),
  );
  return select;
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

  it("⚠ updated（043e の Jewels combo 更新）では鳴らさない", () => {
    setUpEnabled();
    render(<CommentViewerApp />);

    const jewels = comment({
      id: "g1",
      eventType: "jewels",
      text: "",
      monetaryAmount: "30 JEWELS",
      monetary: { amount: 30, currency: "JEWELS" },
      comboCount: 1,
    });
    // 初報は新着なので鳴る。
    receive([jewels]);
    expect(mocks.requestNotificationSound).toHaveBeenCalledTimes(1);
    mocks.requestNotificationSound.mockClear();
    // クールダウンで潰れて「鳴らない」のではなく、**そもそも要求されない**ことを見たいので消す。
    resetNotificationSoundCooldownForTest();

    // 同一 id の combo 更新＝ updated バケット。新しいコメントではないので鳴らさない。
    receive([{ ...jewels, monetaryAmount: "60 JEWELS", comboCount: 2 }]);
    expect(mocks.requestNotificationSound).not.toHaveBeenCalled();
  });

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
    resetNotificationSoundCooldownForTest();

    receive(batch);
    expect(mocks.requestNotificationSound).not.toHaveBeenCalled();
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

    await openSettings();
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

    await openSettings();
    fireEvent.click(screen.getByRole("switch", { name: "コメント通知音" }));
    await waitFor(() =>
      expect(localStorage.getItem(SOUND_COMMENT_ENABLED_KEY)).toBe("true"),
    );
    unmount();

    render(<CommentViewerApp />);
    await openSettings();
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
    resetNotificationSoundCooldownForTest();
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

  it("⚠ 058a の「テスト再生」が成功しても消える（同じデバイスを挿し直した導線）", async () => {
    // 059a レビュー Q-2 で追加。**選択を変えずにデバイスを挿し直した**場合は
    // handleAudioOutputDeviceIdChange が発火しないので、赤字を見たユーザーが最初に押すのは
    // （赤字の title が名指ししている）058a の「テスト再生」になる。ここで畳まないと
    // 「一番踏まれやすい導線だけが効かない」配置になる。
    setUpEnabled();
    mocks.playNotificationSound.mockRejectedValue({
      code: "AUDIO_DEVICE_UNAVAILABLE",
    });
    render(<CommentViewerApp />);

    receive([comment()]);
    await screen.findByText("通知音を再生できません");

    // 挿し直した＝いまは鳴る状態。設定を開いてテスト再生を押す。
    // ⚠ 設定を開くと列挙が走る（非同期）。**enabled になるまで待たずに click すると無反応で空振りする。**
    fireEvent.click(screen.getByRole("button", { name: "設定" }));
    const testButton = await screen.findByRole("button", {
      name: "テスト再生 ▶",
    });
    await waitFor(() => expect(testButton).toBeEnabled());

    mocks.playNotificationSound.mockResolvedValue(undefined);
    mocks.playNotificationSound.mockClear();
    fireEvent.click(testButton);
    await waitFor(() =>
      expect(mocks.playNotificationSound).toHaveBeenCalledWith(
        DEVICE_ID,
        "test",
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "コメントに戻る" }));

    // ⚠ 必ずコメント画面へ戻ってから確認する（設定ビューはツールバーごと差し替わるため）。
    await screen.findByRole("button", { name: "設定" });
    expect(
      screen.queryByText("通知音を再生できません"),
    ).not.toBeInTheDocument();
  });

  it("⚠ 試聴の失敗は 058a の「音声出力（通知音）」カードへ漏れない（state を共有していない）", async () => {
    // 059a レビュー Q-9 で追加。`SoundPreviewState` と `AudioTestState` は構造的に同一なので、
    // CommentViewerApp → SettingsView の props を取り違えても typecheck は通ってしまう。
    // branded type の代わりに、取り違えそのものをここで殺す。
    setUpEnabled();
    render(<CommentViewerApp />);

    fireEvent.click(screen.getByRole("button", { name: "設定" }));
    // ⚠ 列挙（非同期）が終わるまで disabled なので、enabled を待ってから押す。
    const previewButton = await screen.findByRole("button", { name: "試聴 ▶" });
    await waitFor(() => expect(previewButton).toBeEnabled());

    mocks.playNotificationSound.mockRejectedValue({
      code: "AUDIO_PLAYBACK_FAILED",
    });
    fireEvent.click(previewButton);

    // 通知音カードには出る。
    expect(
      await screen.findByText(
        "通知音を再生できませんでした。デバイスを選び直してください。",
      ),
    ).toBeInTheDocument();
    // 058a のカード（テスト再生の失敗）には出ない。
    expect(
      screen.queryByText(
        "テスト音を再生できませんでした。デバイスを選び直してください。",
      ),
    ).not.toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: "試聴 ▶" }));
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
});
