import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * 059a: 通知音のクールダウン層の仕様テスト。
 *
 * あるべき挙動（docs/tasks/059a-comment-notification-sound.md・058a の申し送り）:
 * - クールダウン内の 2 回目は **invoke しない**（鳴らさない）。⚠ **キューイングしない**（落とすのが正しい）。
 * - ⚠⚠ **クールダウンは音源 ID ごとに独立。** 共有すると 059b で「コメントが流れている最中のスパチャ音が
 *   コメント音のクールダウンで消える」＝一番気づいてほしい音が鳴らないという最悪の挙動になる。
 *   **059b が乗る前にここで固定しておく。**
 * - ⚠⚠ **デバイス未選択（`""`）では invoke しない。** 「既定デバイスで鳴らす」ではなく「鳴らさない」
 *   （②-軽では OS 既定＝仮想オーディオデバイス＝配信に載る側なので、落とすと載せないつもりの音が載る）。
 * - ⚠⚠ **失敗を握り潰さない。** 例外は投げない（コメント受信経路を巻き添えにしない）が、
 *   `"failed"` として呼び出し側へ伝える（058a はホットプラグ監視を持たないので、ここで捨てると
 *   配信中にデバイスが抜けたことに気付く手段がゼロになる）。
 * - 失敗してもクールダウンは進む（デバイスが抜けている間に invoke を撃ち続けない）。
 *
 * ⚠ **`AudioContext` はモックしない**（このモジュールは Web Audio に触れない）。モックするのは
 * 058a の invoke ラッパ（`audioOutputApi`）で、`audioOutputApi.test.ts` /
 * `CommentViewerApp.audio.test.tsx` と同じ型。テストは外部通信も OS 操作も一切行わない。
 */

// vi.mock のファクトリは巻き上げられるため、共有スパイは vi.hoisted で先に作る。
const mocks = vi.hoisted(() => ({
  playNotificationSound: vi.fn(),
}));

vi.mock("./audioOutputApi", () => ({
  playNotificationSound: mocks.playNotificationSound,
}));

import {
  requestNotificationSound,
  resetNotificationSoundCooldownForTest,
} from "./notificationSound";

/** 実物に近い形の ID（`cpal::DeviceId` の `Display` は `"<HostId>:<device>"`）。 */
const DEVICE_ID = "CoreAudio:BuiltInSpeakerDevice";

/** コメント音のクールダウン（notificationSound.ts の COOLDOWN_MS.comment）。 */
const COMMENT_COOLDOWN_MS = 600;

beforeEach(() => {
  // ⚠ モジュールスコープの Map はテスト間で持ち越されるので、必ず消してから始める
  //（消さないと実行順で結果が変わる）。
  resetNotificationSoundCooldownForTest();
  mocks.playNotificationSound.mockReset();
  mocks.playNotificationSound.mockResolvedValue(undefined);
  // Date.now() を進めるため。setSystemTime で基準を固定し、advanceTimersByTime で進める。
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-04T12:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("requestNotificationSound", () => {
  it("デバイス選択済み・クールダウン外なら鳴らす（deviceId と音源 ID をそのまま渡す）", async () => {
    await expect(requestNotificationSound("comment", DEVICE_ID)).resolves.toBe(
      "played",
    );
    expect(mocks.playNotificationSound).toHaveBeenCalledWith(
      DEVICE_ID,
      "comment",
    );
    expect(mocks.playNotificationSound).toHaveBeenCalledTimes(1);
  });

  it("⚠ クールダウン内の 2 回目は鳴らさない（invoke しない・キューイングもしない）", async () => {
    await expect(requestNotificationSound("comment", DEVICE_ID)).resolves.toBe(
      "played",
    );

    // クールダウンぎりぎり手前まで進める。
    vi.advanceTimersByTime(COMMENT_COOLDOWN_MS - 1);
    await expect(requestNotificationSound("comment", DEVICE_ID)).resolves.toBe(
      "skipped",
    );
    expect(mocks.playNotificationSound).toHaveBeenCalledTimes(1);
  });

  it("同一 tick の 2 回目も鳴らさない（StrictMode の updater 二重実行に相当）", async () => {
    // ⚠ `CommentViewerApp` は setComments の updater 内から呼ぶので、main.tsx の <React.StrictMode> で
    // updater が 2 回走る。通知音は構造的には冪等でなく、**ここで潰れることが冪等化を担っている**。
    await requestNotificationSound("comment", DEVICE_ID);
    await expect(requestNotificationSound("comment", DEVICE_ID)).resolves.toBe(
      "skipped",
    );
    expect(mocks.playNotificationSound).toHaveBeenCalledTimes(1);
  });

  it("クールダウンが明けたら再び鳴る", async () => {
    await requestNotificationSound("comment", DEVICE_ID);

    vi.advanceTimersByTime(COMMENT_COOLDOWN_MS);
    await expect(requestNotificationSound("comment", DEVICE_ID)).resolves.toBe(
      "played",
    );
    expect(mocks.playNotificationSound).toHaveBeenCalledTimes(2);
  });

  it("⚠⚠ クールダウンは音源 ID ごとに独立（059b の前提をここで固定する）", async () => {
    // コメント音を鳴らした直後でも、別の音は**必ず鳴る**。
    // これが共有カウンタになると、059b で「コメント連投中のスパチャ音が消える」＝
    // 一番気づいてほしい音が鳴らない、という最悪の壊れ方をする。
    await expect(requestNotificationSound("comment", DEVICE_ID)).resolves.toBe(
      "played",
    );
    await expect(requestNotificationSound("test", DEVICE_ID)).resolves.toBe(
      "played",
    );

    expect(mocks.playNotificationSound).toHaveBeenNthCalledWith(
      1,
      DEVICE_ID,
      "comment",
    );
    expect(mocks.playNotificationSound).toHaveBeenNthCalledWith(
      2,
      DEVICE_ID,
      "test",
    );
  });

  it("⚠ 'test' はクールダウン 0（ユーザーの明示操作にレート制限をかけない）", async () => {
    // 058a の「テスト再生」と 059a の「試聴」はユーザーが押したときだけ鳴る。
    // 押したのに鳴らないのは「壊れている」と見えるので、ここにレート制限を入れてはいけない
    //（034c の話者試聴と同じ考え方。連打は「再生中は disabled」で抑える）。
    // ⚠ 連打の上限は Rust の同時再生 1 本（可用性対策）が別途持っている。
    await expect(requestNotificationSound("test", DEVICE_ID)).resolves.toBe(
      "played",
    );
    await expect(requestNotificationSound("test", DEVICE_ID)).resolves.toBe(
      "played",
    );
    expect(mocks.playNotificationSound).toHaveBeenCalledTimes(2);
  });

  it("⚠⚠ デバイス未選択では invoke しない（既定デバイスへ落とさない＝fail-closed）", async () => {
    await expect(requestNotificationSound("comment", "")).resolves.toBe(
      "skipped",
    );
    expect(mocks.playNotificationSound).not.toHaveBeenCalled();
  });

  it("未選択で skip してもクールダウンを消費しない（選んだ直後の 1 件目が鳴る）", async () => {
    await requestNotificationSound("comment", "");
    await expect(requestNotificationSound("comment", DEVICE_ID)).resolves.toBe(
      "played",
    );
    expect(mocks.playNotificationSound).toHaveBeenCalledTimes(1);
  });

  it("⚠⚠ 失敗は握り潰さず 'failed' で呼び出し側へ伝える（例外は投げない）", async () => {
    mocks.playNotificationSound.mockRejectedValue({
      code: "AUDIO_DEVICE_UNAVAILABLE",
    });
    // reject しない＝コメント受信経路を通知音の失敗で巻き添えにしない。
    await expect(requestNotificationSound("comment", DEVICE_ID)).resolves.toBe(
      "failed",
    );
  });

  it("再生失敗のときも既定デバイスで鳴らし直さない（リトライを持たない）", async () => {
    mocks.playNotificationSound.mockRejectedValue({
      code: "AUDIO_DEVICE_UNAVAILABLE",
    });
    await requestNotificationSound("comment", DEVICE_ID);
    // 2 回目の invoke が無い＝既定へのフォールバック経路が存在しない。
    expect(mocks.playNotificationSound).toHaveBeenCalledTimes(1);
  });

  it("⚠ 失敗してもクールダウンは進む（デバイスが抜けている間 invoke を撃ち続けない）", async () => {
    mocks.playNotificationSound.mockRejectedValue({
      code: "AUDIO_DEVICE_UNAVAILABLE",
    });
    await expect(requestNotificationSound("comment", DEVICE_ID)).resolves.toBe(
      "failed",
    );

    vi.advanceTimersByTime(COMMENT_COOLDOWN_MS - 1);
    await expect(requestNotificationSound("comment", DEVICE_ID)).resolves.toBe(
      "skipped",
    );
    expect(mocks.playNotificationSound).toHaveBeenCalledTimes(1);
  });
});
