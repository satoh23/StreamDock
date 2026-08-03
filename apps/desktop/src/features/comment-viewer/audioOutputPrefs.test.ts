import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  AUDIO_OUTPUT_DEVICE_ID_MAX_LENGTH,
  AUDIO_OUTPUT_DEVICE_KEY,
  NO_AUDIO_OUTPUT_DEVICE,
  isValidAudioOutputDeviceId,
  loadAudioOutputDeviceId,
  saveAudioOutputDeviceId,
} from "./audioOutputPrefs";

/**
 * 058a: 通知音の出力デバイス選択（永続化）の仕様テスト。
 *
 * あるべき挙動（docs/tasks/058a-audio-routing-foundation.md 完了条件・docs/security.md §8/§9・
 * 既存 `ttsPrefs` / `overlaySettings` の作法）:
 * - 選択したデバイス ID を保存し、再オープン・再起動で復元する（往復する）。
 * - 未保存・空・壊れた値（長すぎる／制御文字入り）・localStorage 例外は**すべて未選択へ劣化**し、
 *   例外を投げない。
 * - ⚠ **未選択は「既定デバイスで鳴らす」ではなく「鳴らさない」**（fail-closed）。②-軽では
 *   OS 既定＝仮想オーディオデバイス＝配信に載る側なので、劣化先が「既定で鳴らす」だと
 *   **載せないつもりの通知音が配信に載る**。劣化の向きがこのモジュールの一番大事な性質。
 * - 保存するのは**非機密のデバイス ID 1 つだけ**（デバイス名・コメント本文・投稿者名を書かない＝§9）。
 */

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** 実物に近い形の ID（`cpal::DeviceId` の `Display` は `"<HostId>:<device>"`）。 */
const REAL_ID = "CoreAudio:BuiltInSpeakerDevice";

function storedKeys(): string[] {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key) keys.push(key);
  }
  return keys;
}

describe("isValidAudioOutputDeviceId", () => {
  it("実物の形の ID を受け付ける", () => {
    expect(isValidAudioOutputDeviceId(REAL_ID)).toBe(true);
  });

  it("空文字は受け付けない（未選択と区別しない）", () => {
    expect(isValidAudioOutputDeviceId("")).toBe(false);
  });

  it("上限ちょうどは受け付け、1 文字超えたら受け付けない", () => {
    const atLimit = "a".repeat(AUDIO_OUTPUT_DEVICE_ID_MAX_LENGTH);
    expect(isValidAudioOutputDeviceId(atLimit)).toBe(true);
    expect(isValidAudioOutputDeviceId(`${atLimit}a`)).toBe(false);
  });

  it.each([
    ["改行", "CoreAudio:Built\nIn"],
    ["NUL", "CoreAudio:Built\u0000In"],
    ["タブ", "CoreAudio:Built\tIn"],
    ["DEL", "CoreAudio:Built\u007fIn"],
    // ⚠ C1 制御文字（U+0080..=U+009F）。Rust 側は `char::is_control` で弾き、列挙
    // （`service::is_selectable_device_id`）もこれを含む ID を選択肢に出さない。
    // このモジュールの doc は「Rust 側も同じ検査で弾く」と宣言しているので、**判定域を揃える**のが仕様。
    // 揃っていないと「frontend は保存を許すのに Rust が必ず拒否する」値が作れる＝§8 の多層防御が片肺になる。
    ["C1 制御文字 (NEL)", "CoreAudio:Built\u0085In"],
    ["C1 制御文字 (APC)", "CoreAudio:Built\u009fIn"],
  ])("制御文字（%s）を含む値は受け付けない（§8）", (_label, value) => {
    expect(isValidAudioOutputDeviceId(value)).toBe(false);
  });

  it("実在しうる記号（コロン・アンダースコア・空白入りの名前）は弾かない", () => {
    // 弾きすぎると正当なデバイスが選べなくなる（fail-closed の副作用を最小にする）。
    expect(isValidAudioOutputDeviceId("CoreAudio:BlackHole 2ch_UID")).toBe(true);
    expect(isValidAudioOutputDeviceId("WASAPI:{0.0.0.00000000}.{guid}")).toBe(
      true,
    );
  });
});

describe("loadAudioOutputDeviceId", () => {
  it("未保存のときは未選択", () => {
    expect(loadAudioOutputDeviceId()).toBe(NO_AUDIO_OUTPUT_DEVICE);
  });

  it("保存して読み直すと往復する", () => {
    saveAudioOutputDeviceId(REAL_ID);
    expect(loadAudioOutputDeviceId()).toBe(REAL_ID);
  });

  it("前後の空白は落として復元する", () => {
    localStorage.setItem(AUDIO_OUTPUT_DEVICE_KEY, `  ${REAL_ID}  `);
    expect(loadAudioOutputDeviceId()).toBe(REAL_ID);
  });

  it.each([
    ["空文字", ""],
    ["空白のみ", "   "],
    ["制御文字入り", "CoreAudio:Built\nIn"],
    ["長すぎる値", "a".repeat(AUDIO_OUTPUT_DEVICE_ID_MAX_LENGTH + 1)],
  ])("手書き/破損した値（%s）は未選択へ劣化する", (_label, raw) => {
    localStorage.setItem(AUDIO_OUTPUT_DEVICE_KEY, raw);
    expect(loadAudioOutputDeviceId()).toBe(NO_AUDIO_OUTPUT_DEVICE);
  });

  it("localStorage が読めなくても例外を投げず未選択を返す", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(loadAudioOutputDeviceId()).toBe(NO_AUDIO_OUTPUT_DEVICE);
  });

  it("⚠ 劣化先は必ず未選択＝『鳴らさない』であって、既定デバイスを指す値ではない", () => {
    // このテストが落ちるとき、たいてい「未選択なら既定デバイスで鳴らす」という実装が入っている。
    // ②-軽では OS 既定＝仮想オーディオデバイス＝**配信に載る側**なので、それは
    // 「載せないつもりの通知音が配信に載る」＝本機能の存在理由が壊れた状態。
    localStorage.setItem(AUDIO_OUTPUT_DEVICE_KEY, "\u0000");
    const degraded = loadAudioOutputDeviceId();
    expect(degraded).toBe("");
    expect(isValidAudioOutputDeviceId(degraded)).toBe(false);
  });
});

describe("saveAudioOutputDeviceId", () => {
  it("保存前に検証する（壊れた値を localStorage に残さない）", () => {
    saveAudioOutputDeviceId("a".repeat(AUDIO_OUTPUT_DEVICE_ID_MAX_LENGTH + 1));
    expect(localStorage.getItem(AUDIO_OUTPUT_DEVICE_KEY)).toBe(
      NO_AUDIO_OUTPUT_DEVICE,
    );
    saveAudioOutputDeviceId("CoreAudio:Built\nIn");
    expect(localStorage.getItem(AUDIO_OUTPUT_DEVICE_KEY)).toBe(
      NO_AUDIO_OUTPUT_DEVICE,
    );
  });

  it("前後の空白は落として保存する（Rust 側の trim と揃える）", () => {
    // ⚠ コマンド側は受け取った ID を trim() してから**完全一致**で照合する。保存時に落としておかないと、
    // 「保存値と照合対象が別物」という状態を frontend 側から作れてしまう。
    saveAudioOutputDeviceId(`  ${REAL_ID}  `);
    expect(localStorage.getItem(AUDIO_OUTPUT_DEVICE_KEY)).toBe(REAL_ID);
  });

  it("⚠ 今つながっていないデバイスの ID でも保存値は保持する（挿し直せば復帰する）", () => {
    // 058a の明示仕様: 一覧に無い ID は「選択しない」と表示するが、**保存値そのものは消さない**。
    // 消すと、ヘッドホンを抜くたびに選び直しになる。
    saveAudioOutputDeviceId("CoreAudio:UnpluggedHeadphones");
    expect(loadAudioOutputDeviceId()).toBe("CoreAudio:UnpluggedHeadphones");
  });

  it("未選択（空文字）を保存できる＝選択の解除ができる", () => {
    saveAudioOutputDeviceId(REAL_ID);
    saveAudioOutputDeviceId(NO_AUDIO_OUTPUT_DEVICE);
    expect(loadAudioOutputDeviceId()).toBe(NO_AUDIO_OUTPUT_DEVICE);
  });

  it("localStorage が書けなくても例外を投げない", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => saveAudioOutputDeviceId(REAL_ID)).not.toThrow();
  });

  it("保存するのは非機密のデバイス ID 1 つだけ（§9: デバイス名を保存しない）", () => {
    saveAudioOutputDeviceId(REAL_ID);
    expect(storedKeys()).toEqual([AUDIO_OUTPUT_DEVICE_KEY]);
    expect(localStorage.getItem(AUDIO_OUTPUT_DEVICE_KEY)).toBe(REAL_ID);
  });
});
