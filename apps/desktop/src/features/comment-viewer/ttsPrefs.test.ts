import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  TTS_MAX_LENGTH_DEFAULT,
  TTS_MAX_LENGTH_KEY,
  TTS_MAX_LENGTH_MAX,
  TTS_MAX_LENGTH_MIN,
  clampTtsMaxLength,
  loadTtsMaxLength,
  saveTtsMaxLength,
} from "./ttsPrefs";

/**
 * 048: 読み上げ最大文字数（このモジュール初の**数値**設定）の仕様テスト。
 *
 * あるべき挙動（docs/tasks/048-tts-reading-length-cap.md 完了条件・既存 ttsPrefs の作法）:
 * - 既定値を持ち、再オープン・再起動で復元する（往復する）。
 * - 未保存・パース不能・範囲外・localStorage 例外は**すべて安全な値へ劣化**し、例外を投げない。
 * - **「上限なし」は存在しない**（クランプ下限/上限が省略の常時有効を保証する）。
 * - クランプは load / save / 設定 UI の 3 箇所から呼ばれるが、ロジックは `clampTtsMaxLength` 1 つだけ。
 */

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("clampTtsMaxLength", () => {
  it("既定値は範囲内にある（定数どうしの整合）", () => {
    expect(TTS_MAX_LENGTH_DEFAULT).toBeGreaterThanOrEqual(TTS_MAX_LENGTH_MIN);
    expect(TTS_MAX_LENGTH_DEFAULT).toBeLessThanOrEqual(TTS_MAX_LENGTH_MAX);
  });

  it("範囲内はそのまま、範囲外は境界へ丸める", () => {
    expect(clampTtsMaxLength(60)).toBe(60);
    expect(clampTtsMaxLength(TTS_MAX_LENGTH_MIN - 1)).toBe(TTS_MAX_LENGTH_MIN);
    expect(clampTtsMaxLength(TTS_MAX_LENGTH_MAX + 1)).toBe(TTS_MAX_LENGTH_MAX);
    // 「上限なし」を作らせない（Infinity を渡しても有限の上限に落ちる）。
    expect(clampTtsMaxLength(Number.POSITIVE_INFINITY)).toBe(
      TTS_MAX_LENGTH_DEFAULT,
    );
  });

  it("小数は切り捨て、非有限は既定値にする", () => {
    expect(clampTtsMaxLength(60.9)).toBe(60);
    expect(clampTtsMaxLength(Number.NaN)).toBe(TTS_MAX_LENGTH_DEFAULT);
  });
});

describe("loadTtsMaxLength", () => {
  it("未保存のときは既定値", () => {
    expect(loadTtsMaxLength()).toBe(TTS_MAX_LENGTH_DEFAULT);
  });

  it("保存して読み直すと往復する", () => {
    saveTtsMaxLength(120);
    expect(loadTtsMaxLength()).toBe(120);
  });

  it.each([
    ["abc", TTS_MAX_LENGTH_DEFAULT],
    ["", TTS_MAX_LENGTH_DEFAULT], // Number("") === 0 の罠。0 に落とさず既定値へ。
    ["   ", TTS_MAX_LENGTH_DEFAULT],
    ["60.5", 60],
    ["-10", TTS_MAX_LENGTH_MIN],
    ["9999", TTS_MAX_LENGTH_MAX],
  ])("手書き/破損した値 %p は安全な値 %p へ劣化する", (raw, expected) => {
    localStorage.setItem(TTS_MAX_LENGTH_KEY, raw);
    expect(loadTtsMaxLength()).toBe(expected);
  });

  it("localStorage が読めなくても例外を投げず既定値を返す", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(loadTtsMaxLength()).toBe(TTS_MAX_LENGTH_DEFAULT);
  });
});

describe("saveTtsMaxLength", () => {
  it("保存前にクランプする（範囲外を localStorage に残さない）", () => {
    saveTtsMaxLength(9999);
    expect(localStorage.getItem(TTS_MAX_LENGTH_KEY)).toBe(
      String(TTS_MAX_LENGTH_MAX),
    );
    saveTtsMaxLength(1);
    expect(localStorage.getItem(TTS_MAX_LENGTH_KEY)).toBe(
      String(TTS_MAX_LENGTH_MIN),
    );
  });

  it("localStorage が書けなくても例外を投げない", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => saveTtsMaxLength(60)).not.toThrow();
  });

  it("保存するのは非機密の数値 1 つだけ（コメント本文・投稿者名を書かない＝§9）", () => {
    saveTtsMaxLength(80);
    expect(localStorage.getItem(TTS_MAX_LENGTH_KEY)).toBe("80");
  });
});
