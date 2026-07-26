import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  OBS_AUTO_ADD_KEY,
  loadObsAutoAdd,
  saveObsAutoAdd,
} from "./overlaySettings";

/**
 * 044a: OBS 自動追加トグルの永続化（overlaySettings）の仕様テスト。
 * あるべき挙動（docs/tasks/044a-obs-auto-source-impl.md / docs/security.md §9）:
 * - 永続化するのは **非機密の boolean（ON/OFF）のみ**。既定は OFF（false）。
 * - localStorage には "true"/"false" 文字列で保存し、load は "true" の厳密一致でのみ true を返す。
 * - 読み書きが失敗（プライベートモード等）しても壊れず false へ劣化する。
 * - **OBS パスワードは localStorage に保存しない**（このモジュールは boolean 以外を書かない）。
 */

beforeEach(() => {
  localStorage.clear();
});

function storedKeys(): string[] {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k) keys.push(k);
  }
  return keys;
}

describe("loadObsAutoAdd / saveObsAutoAdd", () => {
  it("未保存のときは既定 OFF（false）", () => {
    expect(loadObsAutoAdd()).toBe(false);
  });

  it("true を保存すると 'true' 文字列で永続化し、load は true を返す", () => {
    saveObsAutoAdd(true);
    expect(localStorage.getItem(OBS_AUTO_ADD_KEY)).toBe("true");
    expect(loadObsAutoAdd()).toBe(true);
  });

  it("false を保存すると 'false' 文字列で永続化し、load は false を返す", () => {
    saveObsAutoAdd(false);
    expect(localStorage.getItem(OBS_AUTO_ADD_KEY)).toBe("false");
    expect(loadObsAutoAdd()).toBe(false);
  });

  it("'true' 以外の値は false（厳密一致・壊れた値でも劣化）", () => {
    localStorage.setItem(OBS_AUTO_ADD_KEY, "1");
    expect(loadObsAutoAdd()).toBe(false);
    localStorage.setItem(OBS_AUTO_ADD_KEY, "yes");
    expect(loadObsAutoAdd()).toBe(false);
  });

  it("localStorage 読取が例外でも false へフォールバック（表示は継続）", () => {
    const spy = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    expect(loadObsAutoAdd()).toBe(false);
    spy.mockRestore();
  });

  it("localStorage 書込が例外でも投げない（プライベートモード等でも壊れない）", () => {
    const spy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    expect(() => saveObsAutoAdd(true)).not.toThrow();
    spy.mockRestore();
  });

  it("保存されるのは boolean 用キーのみで、機密キーは作らない（§9）", () => {
    saveObsAutoAdd(true);
    const keys = storedKeys();
    expect(keys).toContain(OBS_AUTO_ADD_KEY);
    // password/pw/secret/token を含むキーは一切作らない（機密は localStorage に置かない）。
    expect(keys.some((k) => /password|pw|secret|token/i.test(k))).toBe(false);
  });
});
