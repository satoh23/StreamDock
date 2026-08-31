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

  /**
   * ⚠⚠⚠ **review Q-6（2026-08-31）: この検査は「らくらくツール設定」の削除で空ループになった。**
   *
   * `HEADER_SECTIONS` が全件 `implemented: true` になったため、下のループは 1 周も回らず
   * **無条件でパスする**（＝グリーンだが何も守っていない）。⚠ 空ループのまま放置すると
   * 「通っているから大丈夫」という**誤った安心感**を与えるので、
   * **いま全件実装済みであること自体を先に明示**して、空ループが意図的であると読めるようにする。
   *
   * ⚠ 未実装セクションを 1 つでも足したら、下のループが自動的に本来の検査として復活する
   * （そのとき最初の `expect` は落ちるので、**期待値を `true` へ直すこと**）。
   */
  it("未実装のセクションには必ず説明がある（準備中ページが空にならない）", () => {
    // ⚠ いま未実装セクションはゼロ＝下のループは空。これが変わったら気付けるように固定する。
    expect(HEADER_SECTIONS.some((s) => !s.implemented)).toBe(false);
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
