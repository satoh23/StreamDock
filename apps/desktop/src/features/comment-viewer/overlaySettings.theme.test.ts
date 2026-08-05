import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  OVERLAY_THEME_KEY,
  loadOverlayTheme,
  saveOverlayTheme,
} from "./overlaySettings";

/**
 * 060d: 選択中カスタム CSS テーマ id の永続化（overlaySettings）の仕様テスト。
 *
 * あるべき挙動（docs/tasks/060d-css-theme-management-ui.md / docs/security.md §9）:
 * - 永続化するのは **id 1 個だけ**。⚠ **CSS 本文は localStorage に置かない**（Rust が持つ）。
 * - **未保存・不正な形・例外はすべて `null`（＝既定意匠）へ倒す**（fail-safe）。
 *   壊れた値が残っていても「前のテーマを当て続ける」経路が無く、必ず StreamDock 標準へ戻る。
 * - `null` の保存は**キーごと削除**（「未保存＝既定」と「既定を選んだ」を同じ状態に潰す）。
 */

const VALID_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function storedKeys(): string[] {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k) keys.push(k);
  }
  return keys;
}

describe("loadOverlayTheme", () => {
  it("未保存なら null（既定意匠）", () => {
    expect(loadOverlayTheme()).toBeNull();
  });

  it("保存済みの uuid はそのまま返る", () => {
    localStorage.setItem(OVERLAY_THEME_KEY, VALID_ID);
    expect(loadOverlayTheme()).toBe(VALID_ID);
  });

  it.each([
    ["空文字", ""],
    ["空白のみ", "   "],
    ["uuid でない文字列", "not-a-uuid"],
    ["パスに見える値", "../../etc/passwd"],
    ["桁の足りない uuid", "3f2504e0-4f89-41d3-9a0c-0305e82c330"],
    ["余分な文字が付いた uuid", `${VALID_ID}x`],
  ])("不正な値（%s）は null へ倒れる", (_label, raw) => {
    localStorage.setItem(OVERLAY_THEME_KEY, raw);
    expect(loadOverlayTheme()).toBeNull();
  });

  it("localStorage が例外を投げても null（プライベートモード等で壊れない）", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(loadOverlayTheme()).toBeNull();
  });
});

describe("saveOverlayTheme", () => {
  it("id を保存する", () => {
    saveOverlayTheme(VALID_ID);
    expect(localStorage.getItem(OVERLAY_THEME_KEY)).toBe(VALID_ID);
    expect(loadOverlayTheme()).toBe(VALID_ID);
  });

  it("null はキーごと削除する（未保存＝既定と同じ状態に潰す）", () => {
    saveOverlayTheme(VALID_ID);
    saveOverlayTheme(null);
    expect(storedKeys()).not.toContain(OVERLAY_THEME_KEY);
    expect(loadOverlayTheme()).toBeNull();
  });

  it("localStorage が例外を投げても throw しない（表示は継続できる）", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => saveOverlayTheme(VALID_ID)).not.toThrow();
  });

  it("⚠ CSS 本文をこのキーに書かない（保存されるのは id だけ）", () => {
    saveOverlayTheme(VALID_ID);
    const stored = localStorage.getItem(OVERLAY_THEME_KEY) ?? "";
    expect(stored).not.toContain("{");
    expect(stored.length).toBeLessThanOrEqual(64);
  });
});
