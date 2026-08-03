import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AudioOutputDevice } from "./bindings/AudioOutputDevice";

/**
 * 058a: 音声出力（通知音）の Rust command 薄いラッパ（audioOutputApi）の仕様テスト。
 *
 * あるべき挙動（docs/tasks/058a-audio-routing-foundation.md 完了条件・docs/security.md §3/§8/§9）:
 * - **単一目的の command 2 本だけ**を呼ぶ（`list_audio_output_devices` / `play_notification_sound`）。
 *   ラッパはこの 2 本以外の command を呼ばない＝汎用実行経路を作らない（§3）。
 * - 列挙は**引数なし**で呼び、戻り値をそのまま返す。**0 件（空配列）は成功**であって失敗ではない
 *   （「デバイスが無い」と「取得できなかった」は UI の案内が違うため、ここで潰さない）。
 * - 再生は `{ deviceId, sound }` を渡す。⚠ **キー名は camelCase**（Tauri v2 が Rust 側の
 *   `device_id: String` へ変換する）。ここを間違えると invoke が実行時にしか落ちない。
 * - ⚠ **ラッパは値を加工しない。** frontend でデバイス ID を組み立てたり、既定デバイスへ
 *   読み替えたりしない（実在するかは Rust 側が列挙結果と照合して決める＝§8）。
 * - ⚠ **reject を握り潰さない。** 呼び出し側が「鳴らなかった」を知れないと、fail-closed が
 *   無言の故障になる（058a はホットプラグ監視を持たない）。
 * - 鳴らせる音は `NotificationSound` enum に列挙されたものだけ＝パスもバイト列も渡らない（§3/§4）。
 *
 * invoke はモックする＝テストは端末外通信も OS 操作も一切しない（§1・vitest.config.ts の方針）。
 */
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import { listAudioOutputDevices, playNotificationSound } from "./audioOutputApi";

const mockInvoke = vi.mocked(invoke);

/** 実物に近い形の列挙結果（`cpal::DeviceId` の Display は `"<HostId>:<device>"`）。 */
const DEVICES: AudioOutputDevice[] = [
  { id: "CoreAudio:BuiltInSpeakerDevice", name: "内蔵スピーカー" },
  { id: "CoreAudio:BlackHole2ch_UID", name: "BlackHole 2ch" },
];

beforeEach(() => {
  mockInvoke.mockReset();
});

describe("listAudioOutputDevices", () => {
  it("list_audio_output_devices を無引数で呼び、結果をそのまま返す", async () => {
    mockInvoke.mockResolvedValue(DEVICES);
    await expect(listAudioOutputDevices()).resolves.toEqual(DEVICES);
    expect(mockInvoke).toHaveBeenCalledWith("list_audio_output_devices");
    // 呼ばれる command はこの 1 本だけ（§3: 単一目的）。
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it("0 件は空配列で resolve する（『デバイスが無い』は失敗ではない）", async () => {
    mockInvoke.mockResolvedValue([]);
    await expect(listAudioOutputDevices()).resolves.toEqual([]);
  });

  it("⚠ 列挙の失敗は握り潰さず reject を透過する（『無い』と『取れなかった』は案内が違う）", async () => {
    mockInvoke.mockRejectedValue({ code: "AUDIO_DEVICE_UNAVAILABLE" });
    await expect(listAudioOutputDevices()).rejects.toEqual({
      code: "AUDIO_DEVICE_UNAVAILABLE",
    });
  });
});

describe("playNotificationSound", () => {
  it("play_notification_sound に { deviceId, sound } を渡す（⚠ キーは camelCase）", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await playNotificationSound("CoreAudio:BuiltInSpeakerDevice", "test");
    expect(mockInvoke).toHaveBeenCalledWith("play_notification_sound", {
      deviceId: "CoreAudio:BuiltInSpeakerDevice",
      sound: "test",
    });
    // 呼ばれる command はこの 1 本だけ（§3・音が他経路から鳴らない）。
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it("⚠ デバイス ID を加工しない（列挙が返した値をそのまま渡す＝照合は Rust 側の仕事）", async () => {
    mockInvoke.mockResolvedValue(undefined);
    // 前後空白や見慣れない形でも、ラッパは触らずそのまま渡す。整形・正規化・拒否は
    // 列挙側（Rust の is_selectable_device_id）とコマンド側（trim + 制御文字拒否）が担う。
    await playNotificationSound("  CoreAudio:Odd  ", "test");
    expect(mockInvoke).toHaveBeenCalledWith("play_notification_sound", {
      deviceId: "  CoreAudio:Odd  ",
      sound: "test",
    });
  });

  it("⚠ 再生の失敗は reject を透過する（既定デバイスで鳴らし直す救済を入れない＝fail-closed）", async () => {
    mockInvoke.mockRejectedValue({ code: "AUDIO_DEVICE_UNAVAILABLE" });
    await expect(
      playNotificationSound("CoreAudio:Gone", "test"),
    ).rejects.toEqual({ code: "AUDIO_DEVICE_UNAVAILABLE" });
    // ⚠ フォールバックのために 2 回目を呼んでいない（既定＝配信に載る側なので落としてはいけない）。
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it("未選択（空文字）でもラッパは素通しする（呼ぶ/呼ばないの判断は呼び出し側の責務）", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await playNotificationSound("", "test");
    expect(mockInvoke).toHaveBeenCalledWith("play_notification_sound", {
      deviceId: "",
      sound: "test",
    });
    // ⚠ ここでラッパが握り潰すと、呼び出し側の「未選択なら呼ばない」を検証できなくなる。
    // 実際の遮断は CommentViewerApp（未選択なら invoke しない）と Rust（空文字は Validation で拒否）の 2 段。
  });
});
