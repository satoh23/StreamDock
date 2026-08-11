import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * 061d: エフェクトテンプレートの invoke ラッパの仕様テスト。
 *
 * あるべき挙動:
 * - **コマンド名と引数キーが Rust 側の `#[tauri::command]` と一致する**（打ち間違いを機械で止める）。
 *   ⚠ ここがずれると typecheck も lint も通ったまま**実機でだけ失敗する**（コマンド名は文字列なので）。
 * - ⚠⚠ **ラッパは検査もサニタイズもしない**——`get_effect_template_media` の戻り値をそのまま返し、
 *   `safeEffectMedia` は**描画シンク側**が呼ぶ。ここで検査すると「ガードが 2 か所にあり片方だけ緩む」形になる。
 *
 * 外部境界（Tauri invoke）はモックする。**テストは外部通信も OS 操作も一切行わない**。
 */

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));

import {
  deleteEffectTemplate,
  getEffectTemplateMedia,
  importEffectTemplate,
  listEffectTemplates,
} from "./effectTemplateApi";

describe("effectTemplateApi", () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
    mocks.invoke.mockResolvedValue(undefined);
  });

  it("list は list_effect_templates を引数なしで呼ぶ", async () => {
    mocks.invoke.mockResolvedValue([]);
    await listEffectTemplates();
    expect(mocks.invoke).toHaveBeenCalledWith("list_effect_templates");
  });

  it("⚠ import は import_effect_template に `dir` キーで生パスを渡す（整形しない）", async () => {
    mocks.invoke.mockResolvedValue({ id: "t1" });
    const raw = "/Users/me/My Templates/きらきら";
    await importEffectTemplate(raw);
    expect(mocks.invoke).toHaveBeenCalledWith("import_effect_template", {
      dir: raw,
    });
  });

  it("⚠ getMedia は get_effect_template_media に `id` キーで渡す", async () => {
    mocks.invoke.mockResolvedValue({ media: "data:image/png;base64,AA==", sound: null });
    await getEffectTemplateMedia("abc");
    expect(mocks.invoke).toHaveBeenCalledWith("get_effect_template_media", {
      id: "abc",
    });
  });

  it("delete は delete_effect_template に `id` キーで渡す", async () => {
    await deleteEffectTemplate("abc");
    expect(mocks.invoke).toHaveBeenCalledWith("delete_effect_template", {
      id: "abc",
    });
  });

  it("⚠⚠ getMedia は戻り値を検査せずそのまま返す（ガードは描画シンク側の責務）", async () => {
    // ⚠ もしここが「安全な値だけ返す」形に変わると、`effectMedia.ts` のガードが
    //   **自分で作った／既に濾した文字列を検査するだけ**になり、最終防波堤として機能しなくなる。
    const hostile = { media: "javascript:alert(1)", sound: "http://evil/x.mp3" };
    mocks.invoke.mockResolvedValue(hostile);
    await expect(getEffectTemplateMedia("abc")).resolves.toEqual(hostile);
  });
});
