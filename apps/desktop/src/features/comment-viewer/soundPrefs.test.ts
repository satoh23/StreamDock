import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  SOUND_COMMENT_ENABLED_KEY,
  loadSoundCommentEnabled,
  saveSoundCommentEnabled,
  SOUND_MONETARY_ENABLED_KEY,
  loadSoundMonetaryEnabled,
  saveSoundMonetaryEnabled,
} from "./soundPrefs";

/**
 * 059a / 059b: 通知音（コメント／投げ銭）の ON/OFF（永続化）の仕様テスト。
 *
 * あるべき挙動（docs/tasks/059a-comment-notification-sound.md・既存 `ttsPrefs` / `audioOutputPrefs` の作法）:
 * - ⚠⚠ **既定は OFF。** 未保存・不正値・localStorage 例外は**すべて OFF へ劣化**する。
 *   劣化の向きがこのモジュールの一番大事な性質で、逆向き（既定 ON）だと
 *   **アップデート直後にユーザー操作ゼロで配信中に音が鳴り始める**。
 * - ON/OFF が往復する（再オープン・再起動で復元される）。
 * - 保存するのは**真偽値 1 つだけ**（コメント本文・表示名・金額・デバイス ID を書かない＝§9）。
 * - 例外を投げない（書けない環境でもコメント表示・読み上げは継続できる）。
 */

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function storedKeys(): string[] {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key) keys.push(key);
  }
  return keys;
}

describe("loadSoundCommentEnabled", () => {
  it("⚠ 未保存なら OFF（アップデート直後に無操作で鳴り始めない）", () => {
    expect(loadSoundCommentEnabled()).toBe(false);
  });

  it('"true" のときだけ ON になる', () => {
    localStorage.setItem(SOUND_COMMENT_ENABLED_KEY, "true");
    expect(loadSoundCommentEnabled()).toBe(true);
  });

  it.each([
    ["明示的な false", "false"],
    ["空文字", ""],
    ["大文字", "TRUE"],
    ["前後空白つき", " true "],
    ["数値", "1"],
    ["JSON", '{"enabled":true}'],
  ])("⚠ 壊れた値（%s）は OFF へ劣化する", (_label, raw) => {
    localStorage.setItem(SOUND_COMMENT_ENABLED_KEY, raw);
    expect(loadSoundCommentEnabled()).toBe(false);
  });

  it("getItem が例外を投げても OFF を返す（例外を伝播させない）", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });
    expect(loadSoundCommentEnabled()).toBe(false);
  });
});

describe("saveSoundCommentEnabled", () => {
  it("ON/OFF が往復する", () => {
    saveSoundCommentEnabled(true);
    expect(loadSoundCommentEnabled()).toBe(true);

    saveSoundCommentEnabled(false);
    expect(loadSoundCommentEnabled()).toBe(false);
  });

  it("setItem が例外を投げても握りつぶす（他の機能を巻き添えにしない）", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    expect(() => saveSoundCommentEnabled(true)).not.toThrow();
  });

  it("§9: このキー以外を書かない（コメント本文・デバイス ID を巻き込まない）", () => {
    saveSoundCommentEnabled(true);
    expect(storedKeys()).toEqual([SOUND_COMMENT_ENABLED_KEY]);
  });
});

/**
 * 059b: 投げ銭通知音の ON/OFF。**劣化の向き・作法はコメント音とまったく同じ**なので、
 * 同じ性質を同じ粒度で固定する（片方だけ緩むと「投げ銭音だけ既定 ON」のような事故になる）。
 */
describe("loadSoundMonetaryEnabled", () => {
  it("⚠ 未保存なら OFF（アップデート直後に無操作で鳴り始めない）", () => {
    expect(loadSoundMonetaryEnabled()).toBe(false);
  });

  it('"true" のときだけ ON になる', () => {
    localStorage.setItem(SOUND_MONETARY_ENABLED_KEY, "true");
    expect(loadSoundMonetaryEnabled()).toBe(true);
  });

  it.each([
    ["明示的な false", "false"],
    ["空文字", ""],
    ["大文字", "TRUE"],
    ["前後空白つき", " true "],
    ["数値", "1"],
    ["JSON", '{"enabled":true}'],
  ])("⚠ 壊れた値（%s）は OFF へ劣化する", (_label, raw) => {
    localStorage.setItem(SOUND_MONETARY_ENABLED_KEY, raw);
    expect(loadSoundMonetaryEnabled()).toBe(false);
  });

  it("getItem が例外を投げても OFF を返す（例外を伝播させない）", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });
    expect(loadSoundMonetaryEnabled()).toBe(false);
  });
});

describe("saveSoundMonetaryEnabled", () => {
  it("ON/OFF が往復する", () => {
    saveSoundMonetaryEnabled(true);
    expect(loadSoundMonetaryEnabled()).toBe(true);

    saveSoundMonetaryEnabled(false);
    expect(loadSoundMonetaryEnabled()).toBe(false);
  });

  it("setItem が例外を投げても握りつぶす（他の機能を巻き添えにしない）", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    expect(() => saveSoundMonetaryEnabled(true)).not.toThrow();
  });

  it("§9: このキー以外を書かない（金額・投稿者名・本文を巻き込まない）", () => {
    saveSoundMonetaryEnabled(true);
    expect(storedKeys()).toEqual([SOUND_MONETARY_ENABLED_KEY]);
  });
});

describe("2 つの ON/OFF は互いに独立している（059b）", () => {
  it("⚠ 別々のキーに保存され、片方を変えてももう片方は動かない", () => {
    // 1 つのキーに詰め込むと「コメント音は要らないが投げ銭だけ気づきたい」ができなくなる。
    expect(SOUND_MONETARY_ENABLED_KEY).not.toBe(SOUND_COMMENT_ENABLED_KEY);

    saveSoundMonetaryEnabled(true);
    expect(loadSoundMonetaryEnabled()).toBe(true);
    expect(loadSoundCommentEnabled()).toBe(false);

    saveSoundCommentEnabled(true);
    saveSoundMonetaryEnabled(false);
    expect(loadSoundCommentEnabled()).toBe(true);
    expect(loadSoundMonetaryEnabled()).toBe(false);
  });
});
