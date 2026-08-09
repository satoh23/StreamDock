import { describe, it, expect } from "vitest";
import { HEADER_SECTIONS } from "./headerSections";

/**
 * 061a: ヘッダー導線の定義の不変条件。
 *
 * ⚠ **なぜこのファイルが「OBSエフェクトが準備中ページを出さない」ことの担保になるのか**:
 * `App.tsx` は `HEADER_SECTIONS.find((s) => !s.implemented && s.screen === screen)` で
 * 「準備中」ページを引いている。したがって `obs` が `implemented: true` である限り、
 * `ComingSoonScreen` は `obs-effects` では**構造的に出ない**（`App.window.test.tsx` が
 * 窓ラベル側の分岐を、こちらが画面側の条件を固定する）。
 */
describe("061a: HEADER_SECTIONS", () => {
  it("OBSエフェクトが実装済みになっている（準備中ページを出さない）", () => {
    const obs = HEADER_SECTIONS.find((s) => s.id === "obs");
    expect(obs).toBeDefined();
    expect(obs?.screen).toBe("obs-effects");
    expect(obs?.implemented).toBe(true);
  });

  it("OBSエフェクトに comingSoonDescription が残っていない", () => {
    // ⚠ `implemented: true` では使われないので、残すと「準備中です」という嘘の説明がコードに残り続ける。
    const obs = HEADER_SECTIONS.find((s) => s.id === "obs");
    expect(obs?.comingSoonDescription).toBeUndefined();
  });

  it("未実装のセクションには必ず説明がある（準備中ページが空にならない）", () => {
    for (const section of HEADER_SECTIONS) {
      if (section.implemented) continue;
      expect(section.comingSoonDescription, `${section.id} の説明が無い`).toBeTruthy();
    }
  });

  it("label と screen が重複しない（導線の単一ソースとしての前提）", () => {
    const labels = HEADER_SECTIONS.map((s) => s.label);
    const screens = HEADER_SECTIONS.map((s) => s.screen);
    expect(new Set(labels).size).toBe(labels.length);
    expect(new Set(screens).size).toBe(screens.length);
  });
});
