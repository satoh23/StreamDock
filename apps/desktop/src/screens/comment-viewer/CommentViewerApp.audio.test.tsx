import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CommentViewerApp } from "./CommentViewerApp";
import { AUDIO_OUTPUT_DEVICE_KEY } from "../../features/comment-viewer/audioOutputPrefs";
import type { AudioOutputDevice } from "../../features/comment-viewer/audioOutputApi";

/**
 * 058a: 通知音の出力デバイス選択の**配線**（CommentViewerApp が持つ state とハンドラ）の仕様テスト。
 *
 * あるべき挙動（docs/tasks/058a-audio-routing-foundation.md 完了条件・docs/security.md §8/§9）:
 * - 設定ビューを開くたびに**列挙し直す**（＝デバイスを挿し直したら開き直せば直る。ホットプラグ監視は持たない）。
 * - 「再読み込み」で再列挙できる。
 * - ⚠ **列挙の失敗を空配列で潰さない。**「デバイスが無い」と「取得できなかった」は案内が違う。
 * - 選んだデバイスは localStorage に永続し、開き直し・再起動で復元される。
 * - ⚠⚠ **保存済み ID が今の一覧に無くても、保存値は消さない**（挿し直せばそのまま復帰する）。
 *   消すと、ヘッドホンを抜くたびに選び直しになる。
 * - テスト再生は**選択中のデバイス ID と `"test"`** で `play_notification_sound` を呼ぶ。
 * - ⚠⚠ **失敗しても既定デバイスで鳴らし直さない（fail-closed）。** ②-軽では OS 既定＝仮想オーディオ
 *   デバイス＝**配信に載る側**なので、落とすと「載せないつもりの通知音が配信に載る」。
 * - 選び直したら直前の失敗表示を消す（古い赤字を残さない）。
 *
 * ⚠ SettingsView 側の見た目（選択肢の並び・警告文・disabled）は `SettingsView.audio.test.tsx` が担う。
 * ここは**アプリが command をどう呼ぶか / 何を保存するか**だけを見る。
 *
 * CommentViewerApp をマウントするため、起動時に走る外部境界（Tauri invoke / sidecar WS / Web Audio /
 * ループバック fetch）を全てモックして隔離する。**テストは外部通信も OS 操作も一切行わない**。
 * localStorage は実物（jsdom）を使い、各テストで明示的にクリアする。
 *
 * 注（`CommentViewerApp.toolbar.test.tsx` の「2 本目になったらハーネスを切り出す」トリガーについて）:
 * **vi.mock の呼び出しはモジュール単位で巻き上げられるため、別ファイルへ切り出して共有できない**
 * （共有できるのは spy を束ねる箱とヘルパ関数だけで、重複の大半である vi.mock ブロックは残る）。
 * 現時点では間接層を足す利得が薄いので、モックは各ファイルで完結させる。
 * 再修正トリガー＝3 本目が出るか、vitest のセットアップで安全に共有する手立てができたとき。
 */

// vi.mock のファクトリは巻き上げられるため、共有スパイは vi.hoisted で先に作る。
const mocks = vi.hoisted(() => ({
  listAudioOutputDevices: vi.fn(),
  playNotificationSound: vi.fn(),
}));

// 058a: 本テストの検証対象。列挙と再生はここ（Rust command の薄いラッパ）を通る。
vi.mock("../../features/comment-viewer/audioOutputApi", () => ({
  listAudioOutputDevices: mocks.listAudioOutputDevices,
  playNotificationSound: mocks.playNotificationSound,
}));

// 以下は CommentViewerApp のマウント時に走る外部境界の封鎖（toolbar テストと同型）。
// ⚠ モジュールを**丸ごと差し替える**ので、書かなかった export は undefined になる。実モジュールの
// export 面を埋めておくこと（今は踏まなくても、将来直接 import され始めたときに静かに壊れる）。
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

vi.mock("../../features/comment-viewer/commentStream", () => ({
  connectCommentStream: vi.fn(() => ({
    disconnect: vi.fn(),
    startLogin: vi.fn(),
    startSession: vi.fn(),
    stopSession: vi.fn(),
    enableObs: vi.fn(),
    hideObs: vi.fn(),
    disableObs: vi.fn(),
  })),
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
// ⚠ 058a は読み上げ経路を無改変で残す設計なので、ここが差し替わっていても通知音の検証には影響しない。
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

// 設定ビューが host_os を invoke するため OS を固定する。
vi.mock("../../features/platform/useHostOs", () => ({
  useHostOs: () => "macos",
}));

const DEVICES: AudioOutputDevice[] = [
  { id: "CoreAudio:BuiltInSpeakerDevice", name: "内蔵スピーカー" },
  { id: "CoreAudio:BlackHole2ch_UID", name: "BlackHole 2ch" },
];

const MISSING_ID = "CoreAudio:UnpluggedHeadphones";

beforeEach(() => {
  localStorage.clear();
  mocks.listAudioOutputDevices.mockReset();
  mocks.playNotificationSound.mockReset();
  mocks.listAudioOutputDevices.mockResolvedValue(DEVICES);
  mocks.playNotificationSound.mockResolvedValue(undefined);
});

/** 設定ビューを開き、出力先セレクトが出るまで待つ。 */
async function openSettings() {
  render(<CommentViewerApp />);
  fireEvent.click(screen.getByRole("button", { name: "設定" }));
  return await screen.findByRole("combobox", { name: "通知音の出力先" });
}

describe("058a 通知音の出力デバイス（CommentViewerApp の配線）", () => {
  it("設定ビューを開くと出力デバイスを列挙し、名前つきで並べる", async () => {
    const select = await openSettings();
    expect(mocks.listAudioOutputDevices).toHaveBeenCalled();
    await waitFor(() =>
      expect(
        Array.from((select as HTMLSelectElement).options).map(
          (o) => o.textContent,
        ),
      ).toEqual([
        "選択しない（通知音を鳴らさない）",
        "内蔵スピーカー",
        "BlackHole 2ch",
      ]),
    );
  });

  it("「再読み込み」で列挙し直す（挿し直したデバイスを拾える）", async () => {
    await openSettings();
    await waitFor(() =>
      expect(mocks.listAudioOutputDevices).toHaveBeenCalledTimes(1),
    );
    fireEvent.click(screen.getByRole("button", { name: "再読み込み" }));
    await waitFor(() =>
      expect(mocks.listAudioOutputDevices).toHaveBeenCalledTimes(2),
    );
  });

  it("⚠ 列挙に失敗したら『取得できませんでした』と案内する（空配列で潰さない）", async () => {
    mocks.listAudioOutputDevices.mockRejectedValue({
      code: "AUDIO_DEVICE_UNAVAILABLE",
    });
    await openSettings();
    expect(
      await screen.findByText(/音声出力デバイスを取得できませんでした/),
    ).toBeInTheDocument();
  });

  it("§9: 列挙に失敗しても画面に例外の中身（デバイス識別子・OS のエラー表現）を出さない", async () => {
    // ⚠ 判定に使う語は、画面の固定文言と衝突しないものを選ぶこと。デバイス名の例として
    // 「BlackHole」「VB-CABLE」は仮想オーディオデバイスの**案内文**に常時出ており、
    // それを needle にすると「漏れていないのに落ちる」誤検知になる（実際に一度踏んだ）。
    mocks.listAudioOutputDevices.mockRejectedValue(
      new Error("CoreAudio OSStatus -10851 on Zz-PrivateHeadset-9f3a"),
    );
    const { container } = render(<CommentViewerApp />);
    fireEvent.click(screen.getByRole("button", { name: "設定" }));
    await screen.findByText(/音声出力デバイスを取得できませんでした/);

    for (const leak of ["OSStatus", "-10851", "Zz-PrivateHeadset-9f3a"]) {
      expect(container.textContent).not.toContain(leak);
    }
  });

  it("デバイスを選ぶと localStorage に保存する", async () => {
    const select = await openSettings();
    await waitFor(() =>
      expect((select as HTMLSelectElement).options).toHaveLength(3),
    );
    fireEvent.change(select, {
      target: { value: "CoreAudio:BlackHole2ch_UID" },
    });
    await waitFor(() =>
      expect(localStorage.getItem(AUDIO_OUTPUT_DEVICE_KEY)).toBe(
        "CoreAudio:BlackHole2ch_UID",
      ),
    );
  });

  it("保存済みの選択を開き直しで復元する（再起動をまたいで選び直さなくてよい）", async () => {
    localStorage.setItem(AUDIO_OUTPUT_DEVICE_KEY, "CoreAudio:BlackHole2ch_UID");
    const select = await openSettings();
    await waitFor(() =>
      expect((select as HTMLSelectElement).value).toBe(
        "CoreAudio:BlackHole2ch_UID",
      ),
    );
  });

  it("⚠⚠ 保存済みデバイスが一覧に無くても localStorage から消さない（挿し直せば復帰する）", async () => {
    localStorage.setItem(AUDIO_OUTPUT_DEVICE_KEY, MISSING_ID);
    const select = await openSettings();

    // 表示は「選択しない」へ落ちるが……
    await waitFor(() => expect((select as HTMLSelectElement).value).toBe(""));
    expect(
      screen.getByText(/以前選んだ音声出力デバイスが見つかりません/),
    ).toBeInTheDocument();
    // ……保存値そのものは保持されている（ここが消えると抜くたびに選び直しになる）。
    expect(localStorage.getItem(AUDIO_OUTPUT_DEVICE_KEY)).toBe(MISSING_ID);
  });

  it("テスト再生は選択中のデバイス ID と \"test\" で play_notification_sound を呼ぶ", async () => {
    localStorage.setItem(AUDIO_OUTPUT_DEVICE_KEY, "CoreAudio:BlackHole2ch_UID");
    await openSettings();
    const button = await screen.findByRole("button", { name: "テスト再生 ▶" });
    await waitFor(() => expect(button).toBeEnabled());

    fireEvent.click(button);
    await waitFor(() =>
      expect(mocks.playNotificationSound).toHaveBeenCalledWith(
        "CoreAudio:BlackHole2ch_UID",
        "test",
      ),
    );
  });

  it("⚠⚠ テスト再生に失敗しても既定デバイスで鳴らし直さない（fail-closed）", async () => {
    localStorage.setItem(AUDIO_OUTPUT_DEVICE_KEY, "CoreAudio:BlackHole2ch_UID");
    mocks.playNotificationSound.mockRejectedValue({
      code: "AUDIO_DEVICE_UNAVAILABLE",
    });
    await openSettings();
    const button = await screen.findByRole("button", { name: "テスト再生 ▶" });
    await waitFor(() => expect(button).toBeEnabled());

    fireEvent.click(button);
    expect(
      await screen.findByText(/テスト音を再生できませんでした/),
    ).toBeInTheDocument();
    // 既定デバイスへのリトライが無いこと＝2 回目の invoke が飛んでいない。
    // ②-軽では既定＝仮想オーディオデバイス＝配信に載る側なので、これは「載せないつもりの音が載る」経路。
    expect(mocks.playNotificationSound).toHaveBeenCalledTimes(1);
  });

  it("デバイスを選び直すと直前の失敗表示が消える（古い赤字を残さない）", async () => {
    localStorage.setItem(AUDIO_OUTPUT_DEVICE_KEY, "CoreAudio:BlackHole2ch_UID");
    mocks.playNotificationSound.mockRejectedValue({
      code: "AUDIO_PLAYBACK_FAILED",
    });
    const select = await openSettings();
    const button = await screen.findByRole("button", { name: "テスト再生 ▶" });
    await waitFor(() => expect(button).toBeEnabled());

    fireEvent.click(button);
    await screen.findByText(/テスト音を再生できませんでした/);

    fireEvent.change(select, {
      target: { value: "CoreAudio:BuiltInSpeakerDevice" },
    });
    await waitFor(() =>
      expect(
        screen.queryByText(/テスト音を再生できませんでした/),
      ).not.toBeInTheDocument(),
    );
  });

  it("⚠ 未選択のあいだは再生 command を一度も呼ばない（既定デバイスで代わりに鳴らさない）", async () => {
    const select = await openSettings();
    await waitFor(() =>
      expect((select as HTMLSelectElement).options).toHaveLength(3),
    );
    expect((select as HTMLSelectElement).value).toBe("");

    // 未選択ではテスト再生を押せない（UI 側の遮断）。
    expect(screen.getByRole("button", { name: "テスト再生 ▶" })).toBeDisabled();
    // 列挙・再読み込み・表示のどの経路からも再生は起きない（配線側の遮断）。
    fireEvent.click(screen.getByRole("button", { name: "再読み込み" }));
    await waitFor(() =>
      expect(mocks.listAudioOutputDevices).toHaveBeenCalledTimes(2),
    );
    expect(mocks.playNotificationSound).not.toHaveBeenCalled();
  });

  it("設定を開いていないあいだは列挙しない（起動しただけで音声デバイスを触らない）", async () => {
    render(<CommentViewerApp />);
    // マウント直後のトグル同期などが落ち着くのを待つ。
    await screen.findByRole("button", { name: "設定" });
    expect(mocks.listAudioOutputDevices).not.toHaveBeenCalled();
    expect(mocks.playNotificationSound).not.toHaveBeenCalled();
  });
});
