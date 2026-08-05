import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * 060d / 060e: オーバーレイ カスタム CSS テーマの Rust command 薄いラッパ（`overlayThemeApi`）の仕様テスト。
 *
 * あるべき挙動（`docs/tasks/060b-custom-css-import-backend.md` の申し送り①・
 * `docs/tasks/060e-paste-css-import.md` の (2)(3)・`docs/security.md` §3 / §8 / §9）:
 *
 * - **単一目的の command 6 本だけ**を呼ぶ。ラッパは値を加工せず、**検証も再実装しない**
 *   （検証・サニタイズ・保存は Rust の共通コア `store_sanitized_css` が 1 セットだけ持つ）。
 * - ⚠⚠ **`origin` を frontend から渡さない**（§3）。出自（`local` / `snapshot`）は Rust 側の
 *   呼び出し経路だけが決める＝ frontend から `snapshot` を騙れない。
 * - ⚠⚠ **貼り付け経路は `path` を 1 バイトも渡さない**（保存先に関わる情報を frontend が持たない）。
 * - **入力フォームの事前判定は「Rust と同じか狭く」**（060b 申し送り①）。frontend が通したものを
 *   Rust が弾くと「入力できるのに保存できない」になる。数え方の単位が 2 つあるのが要点:
 *   - **テーマ名＝コードポイント**（Rust は `chars().count()`）
 *   - **CSS 本文＝ UTF-8 バイト長**（Rust は `css.len()`）
 *   ⚠ **片方に揃えると必ずどちらかが壊れる。** 本ファイルはその非対称を回帰として固定する。
 * - ⚠ **reject を握り潰さない**（Rust の固定文言をそのまま呼び出し側へ渡す・§9）。
 *
 * invoke はモックする＝テストは端末外通信も OS 操作も一切しない（§1）。
 */
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import {
  cssByteLength,
  deleteOverlayTheme,
  getOverlayThemeCss,
  importOverlayTheme,
  importOverlayThemeText,
  listOverlayThemes,
  renameOverlayTheme,
  themeCssError,
  themeNameError,
  THEME_CSS_MAX_BYTES,
  THEME_NAME_MAX_CHARS,
} from "./overlayThemeApi";

const mockInvoke = vi.mocked(invoke);

const THEME_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

beforeEach(() => {
  mockInvoke.mockReset();
  mockInvoke.mockResolvedValue(undefined as never);
});

describe("cssByteLength: Rust の `css.len()` と同じ数え方（UTF-8 バイト長）", () => {
  it("ASCII は文字数と一致する", () => {
    expect(cssByteLength(".a{color:red}")).toBe(13);
  });

  it("⚠ 日本語は 1 文字 3 バイト（`String.length` の 3 倍）", () => {
    // ⚠ ここが「入力できるのに保存できない」の分かれ目。`"あ".length === 1` だが UTF-8 では 3 バイト。
    expect("あ".length).toBe(1);
    expect(cssByteLength("あ")).toBe(3);
    expect(cssByteLength("/* 日本語のコメント */")).toBe(
      new TextEncoder().encode("/* 日本語のコメント */").length,
    );
  });

  it("⚠ サロゲートペア（絵文字）は 4 バイト・`String.length` は 2", () => {
    expect("🎨".length).toBe(2);
    expect(cssByteLength("🎨")).toBe(4);
  });

  it("⚠ 先頭 BOM も数える（Rust は剥がしてから数えるので frontend の方が 3 バイト厳しい＝安全側）", () => {
    // ⚠ 意図した非対称。厳しい側＝「押せなくなる側」へ倒れるので fail-safe。
    // 逆（Rust が弾くものを frontend が通す）になると「入力できるのに保存できない」になる。
    expect(cssByteLength("\uFEFF.a{}")).toBe(cssByteLength(".a{}") + 3);
  });
});

describe("themeCssError: Rust の `validate_css_body` を先に当てる（空・256KB だけ）", () => {
  it("空・空白だけは取り込めない", () => {
    expect(themeCssError("")).toBe("CSS を貼り付けてください。");
    expect(themeCssError("   \n\t ")).toBe("CSS を貼り付けてください。");
  });

  it("ふつうの CSS は通る", () => {
    expect(themeCssError(".sd-comment{color:red}")).toBeNull();
  });

  it("⚠ 上限ちょうど（256KB）は通り、1 バイト超えたら止まる", () => {
    // ⚠ Rust の `the_size_limit_is_enforced_on_the_body_at_its_exact_boundary` と対になる境界。
    // 「以内」なので**ちょうどは通る**——ここを取り違えると、通せる CSS を無用に弾く。
    const exact = "x".repeat(THEME_CSS_MAX_BYTES);
    expect(cssByteLength(exact)).toBe(THEME_CSS_MAX_BYTES);
    expect(themeCssError(exact)).toBeNull();
    expect(themeCssError(`${exact}x`)).toBe(
      "CSS が大きすぎます。256KB 以内にしてください。",
    );
  });

  it("⚠⚠ 文字数では上限内でもバイト数で超えたら止まる（`css.length` で数える退行を殺す）", () => {
    // 「あ」×90K ＝ 文字数 92,160（256K 未満）だが UTF-8 では約 270KB。
    const over = "あ".repeat(90 * 1024);
    expect(over.length).toBeLessThan(THEME_CSS_MAX_BYTES);
    expect(cssByteLength(over)).toBeGreaterThan(THEME_CSS_MAX_BYTES);
    expect(themeCssError(over)).toBe(
      "CSS が大きすぎます。256KB 以内にしてください。",
    );
  });

  it("⚠ 制御文字は**見ない**（判定を 2 実装に分裂させず Rust の固定文言に任せる）", () => {
    // ⚠ これは手抜きではなく 060b 申し送り①に沿った判断（`docs/tasks/060e-*.md` (3)）。
    // 貼り付けで NUL が混入することはまず無く、混入しても Rust が明確な文言で断る＝ fail-closed。
    // ⚠ **再修正トリガー**＝「押せたのに保存できない」が実際に報告されたら、
    // Rust の `is_forbidden_in_css_body` と**1 文字も違わない**判定をここへ足すこと
    // （C0 のうち `\t \n \r \x0C` 以外と DEL）。緩い方へずらすのは常に安全側なので、今はこれでよい。
    expect(themeCssError(".a{content:'\u0000'}")).toBeNull();
    // ⚠ 一方 CSS が空白として扱う 4 種は Rust も通すので、ここでも通ること。
    expect(themeCssError(".a{\n\tcolor:red;\r\f}")).toBeNull();
  });
});

describe("themeNameError: Rust の `validate_theme_name` を先に当てる", () => {
  it("空・空白だけは拒否し、前後の空白は無視して判定する", () => {
    expect(themeNameError("")).toBe("テーマ名を入力してください。");
    expect(themeNameError("   ")).toBe("テーマ名を入力してください。");
    expect(themeNameError("  ふつうの名前  ")).toBeNull();
  });

  it("⚠ C0 制御文字と DEL を拒否する", () => {
    expect(themeNameError("a\u0007b")).toBe(
      "テーマ名に使用できない文字（制御文字）が含まれています。",
    );
    expect(themeNameError("a\u007Fb")).toBe(
      "テーマ名に使用できない文字（制御文字）が含まれています。",
    );
  });

  it("⚠⚠ C1 制御文字（U+0080..U+009F）も拒否する（`/[\\x00-\\x1F\\x7F]/` では漏れる）", () => {
    // ⚠ Rust の `char::is_control` は C1 も弾くので、frontend が通すと
    // 「入力できるのに保存できない」になる。`/\p{Cc}/u` が厳密な等価。
    expect(themeNameError("a\u0085b")).toBe(
      "テーマ名に使用できない文字（制御文字）が含まれています。",
    );
    expect(themeNameError("a\u009Fb")).toBe(
      "テーマ名に使用できない文字（制御文字）が含まれています。",
    );
  });

  it("⚠ 長さは**コードポイント**で数える（80 ちょうどは通り、81 で止まる）", () => {
    expect(themeNameError("あ".repeat(THEME_NAME_MAX_CHARS))).toBeNull();
    expect(themeNameError("あ".repeat(THEME_NAME_MAX_CHARS + 1))).toBe(
      "テーマ名は 80 文字以内にしてください。",
    );
  });

  it("⚠⚠ 絵文字 80 個は通る（`name.length` で数える退行を殺す）", () => {
    // 「🎨」は UTF-16 で 2 単位・コードポイントで 1。Rust は `chars().count()` で数えるので
    // 80 個は通る。`name.length`（＝160）で数えると**正当な名前を弾く**。
    const emoji = "🎨".repeat(THEME_NAME_MAX_CHARS);
    expect(emoji.length).toBe(THEME_NAME_MAX_CHARS * 2);
    expect(themeNameError(emoji)).toBeNull();
    expect(themeNameError("🎨".repeat(THEME_NAME_MAX_CHARS + 1))).toBe(
      "テーマ名は 80 文字以内にしてください。",
    );
  });

  it("⚠ 名前と本文で数える単位が違う（揃えると必ずどちらかが壊れる）", () => {
    // 名前＝コードポイント／本文＝バイト長。Rust 側が `chars().count()` と `len()` で
    // 見ているためで、frontend もその非対称をそのまま写している。
    const name = "あ".repeat(THEME_NAME_MAX_CHARS);
    expect(themeNameError(name)).toBeNull(); // コードポイントでは 80＝通る
    expect(cssByteLength(name)).toBe(THEME_NAME_MAX_CHARS * 3); // バイトでは 240
  });
});

describe("invoke ラッパ: 単一目的の command を正しい引数で呼ぶ（§3）", () => {
  it("importOverlayThemeText は import_overlay_theme_text を {css, name} で呼ぶ", async () => {
    await importOverlayThemeText(".sd-comment{color:red}", "デザイン 1");
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledWith("import_overlay_theme_text", {
      css: ".sd-comment{color:red}",
      name: "デザイン 1",
    });
  });

  it("⚠⚠ 貼り付け経路は path も origin も渡さない（保存先も出自も frontend が決めない）", async () => {
    await importOverlayThemeText(".a{color:red}", "n");
    const [, args] = mockInvoke.mock.calls[0] as [string, Record<string, unknown>];
    // ⚠ `path` を渡すと §5 の「保存先の組み立てにユーザー入力を入れない」が崩れる。
    expect(args).not.toHaveProperty("path");
    // ⚠ `origin` を渡せると frontend から `snapshot`（060c の出自）を騙れる。
    expect(args).not.toHaveProperty("origin");
    expect(Object.keys(args).sort()).toEqual(["css", "name"]);
  });

  it("⚠ 本文を加工しない（trim も正規化もしない＝検証は Rust が 1 か所で行う）", async () => {
    const css = "\uFEFF  .a{content:'  '}  \n";
    await importOverlayThemeText(css, "  名前  ");
    expect(mockInvoke).toHaveBeenCalledWith("import_overlay_theme_text", {
      css,
      name: "  名前  ",
    });
  });

  it("importOverlayTheme（ファイル版）は path と name だけを渡す", async () => {
    await importOverlayTheme("/tmp/theme.css", "デザイン");
    expect(mockInvoke).toHaveBeenCalledWith("import_overlay_theme", {
      path: "/tmp/theme.css",
      name: "デザイン",
    });
    const [, args] = mockInvoke.mock.calls[0] as [string, Record<string, unknown>];
    expect(args).not.toHaveProperty("origin");
  });

  it("read 系は id だけを渡す（パスを受け取らない）", async () => {
    await listOverlayThemes();
    expect(mockInvoke).toHaveBeenCalledWith("list_overlay_themes");

    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue(".a{}" as never);
    await getOverlayThemeCss(THEME_ID);
    expect(mockInvoke).toHaveBeenCalledWith("get_overlay_theme_css", {
      id: THEME_ID,
    });
  });

  it("rename / delete も単一目的（id と name だけ）", async () => {
    await renameOverlayTheme(THEME_ID, "新しい名前");
    expect(mockInvoke).toHaveBeenCalledWith("rename_overlay_theme", {
      id: THEME_ID,
      name: "新しい名前",
    });

    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue(undefined as never);
    await deleteOverlayTheme(THEME_ID);
    expect(mockInvoke).toHaveBeenCalledWith("delete_overlay_theme", {
      id: THEME_ID,
    });
  });

  it("⚠ reject を握り潰さない（Rust の固定文言がそのまま呼び出し側へ届く・§9）", async () => {
    const err = {
      code: "VALIDATION_ERROR",
      message:
        "@media / @supports などの条件部分に、取り除けない参照が含まれています。",
    };
    mockInvoke.mockRejectedValue(err);
    await expect(importOverlayThemeText(".a{}", "n")).rejects.toBe(err);
  });
});
