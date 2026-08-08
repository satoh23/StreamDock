import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, waitFor, cleanup } from "@testing-library/react";
import {
  OVERLAY_THEME_KEY,
  saveOverlayTheme,
} from "../../features/comment-viewer/overlaySettings";
import { OverlayApp } from "./OverlayApp";
import { DEFAULT_DECORATION_RESET } from "../../features/comment-viewer/overlayThemeReset";

/**
 * 060d: OBS 用オーバーレイ（`comment-overlay`）へのカスタム CSS 注入の仕様テスト。
 *
 * あるべき挙動（docs/tasks/060d-css-theme-management-ui.md / docs/security.md「レビュー必須条件」）:
 * - 選択中テーマがあるとき `<style>` を **1 つだけ** `<head>` へ足す。
 * - 切り替えると**古い `<style>` が消えて 1 つのまま**（何回切り替えても積み上がらない）。
 * - 未選択（`null`）なら `<style>` は 0 個＝ StreamDock 既定意匠。
 * - ⚠⚠ **注入経路は `textContent` のみ。** `get_overlay_theme_css` が返す CSS には `</style>` が
 *   そのまま含まれうる（正当な CSS なので 060b は除去しない）ので、`innerHTML` に入れると
 *   要素が閉じて**その後ろが HTML として解釈される**。ここは `</style>` 入りの CSS で固定する。
 * - **注入前に `rewriteSelectors()` を通す**（060b の決定＝変換は注入時に毎回・変換表の更新が既存テーマに効く）。
 * - `storage` イベント（設定窓での書換）で**開いたまま切り替わる**。
 * - 取得に失敗したら**既定意匠へ倒し、localStorage は書き換えない**
 *   （オーバーレイ窓は表示専用・非フォーカスで、ここからは何も操作できない）。
 *
 * 実 WS を張らないよう `connectCommentStream` を、Rust を呼ばないよう `overlayThemeApi` をモックする。
 */

const mocks = vi.hoisted(() => ({
  connectCommentStream: vi.fn(),
  getOverlayThemeCss: vi.fn(),
}));

vi.mock("../../features/comment-viewer/commentStream", () => ({
  connectCommentStream: mocks.connectCommentStream,
}));

vi.mock("../../features/comment-viewer/overlayThemeApi", () => ({
  getOverlayThemeCss: mocks.getOverlayThemeCss,
}));

const THEME_A = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const THEME_B = "9c858901-8a57-4791-81fe-4c455b099bc9";

/** 注入された `<style>` を引く（実装が使う data 属性）。 */
const themeStyles = (): HTMLStyleElement[] =>
  Array.from(document.head.querySelectorAll("style[data-sd-overlay-theme]"));

/**
 * 060f 追修正(2026-08-08): 注入された CSS から**既定意匠のリセットを剥がして**テーマ由来のぶんを返す。
 *
 * ⚠⚠ **剥がす前に「リセットが先頭に在ること」を表明している**のが要点。順序がこの仕組みの全部で、
 * リセットが**後ろ**に付くとテーマのしっぽを消してしまう（逆にリセットが無いと既定の `::after` が
 * 孤児として残り、しっぽが二重に見える＝実機で出た崩れ）。
 * ⚠ 「2 か所とも通っていること」自体は静的ガード **(10-m)** が固定している（jsdom はカスケードも
 * `@layer` の優先順位も解決しないので、ここでは順序しか見られない）。
 */
const themeCssOf = (style: Element): string => {
  const text = style.textContent ?? "";
  expect(text.startsWith(DEFAULT_DECORATION_RESET)).toBe(true);
  return text.slice(DEFAULT_DECORATION_RESET.length);
};

/** 他窓（設定窓）での localStorage 書換を再現する（自窓の書換では storage は発火しないため手で撃つ）。 */
function emitStorage(key: string | null): void {
  act(() => {
    window.dispatchEvent(new StorageEvent("storage", { key }));
  });
}

beforeEach(() => {
  localStorage.clear();
  document.head.querySelectorAll("style[data-sd-overlay-theme]").forEach((el) => {
    el.remove();
  });
  mocks.connectCommentStream.mockReset();
  mocks.connectCommentStream.mockReturnValue({ disconnect: vi.fn() });
  mocks.getOverlayThemeCss.mockReset();
  mocks.getOverlayThemeCss.mockResolvedValue(".sd-comment{color:red}");
});

afterEach(() => {
  cleanup();
});

describe("OverlayApp: テーマ CSS の注入", () => {
  it("未選択なら <style> を作らない（既定意匠）", async () => {
    render(<OverlayApp />);
    await waitFor(() => expect(mocks.connectCommentStream).toHaveBeenCalled());
    expect(themeStyles()).toHaveLength(0);
    expect(mocks.getOverlayThemeCss).not.toHaveBeenCalled();
  });

  it("選択中テーマがあると <style> を 1 つだけ足す", async () => {
    saveOverlayTheme(THEME_A);
    render(<OverlayApp />);
    await waitFor(() => expect(themeStyles()).toHaveLength(1));
    expect(mocks.getOverlayThemeCss).toHaveBeenCalledWith(THEME_A);
    expect(themeCssOf(themeStyles()[0])).toBe(".sd-comment{color:red}");
  });

  it("注入前に rewriteSelectors を通す（純正チャットのセレクタが sd 語彙になる）", async () => {
    mocks.getOverlayThemeCss.mockResolvedValue(
      ".chat-line__no-background{color:red}",
    );
    saveOverlayTheme(THEME_A);
    render(<OverlayApp />);
    await waitFor(() => expect(themeStyles()).toHaveLength(1));
    // ⚠ 060f: 純正チャットの「テキストコメント専用」セレクタは **chat 専用クラス**へ向く
    // （`.sd-comment` は chat と課金の両方に付くため、そこへ向けると課金カードの意匠が壊れる）。
    expect(themeCssOf(themeStyles()[0])).toBe(".sd-comment-chat{color:red}");
  });

  /**
   * 060c: ⚠⚠ **注入前に `rewriteRootLike` も通す**（`body` の非対称を塞いだ分）。
   *
   * 060f の実機確認で判明した欠陥＝「プレビューは `scopeSelectors` が `body` → `.sd-preview` へ
   * 読み替えるのに、配信窓はスコープ化しないので**本物の `<body>` に効いて全要素へ継承する**」。
   * 外部 CSS には `body{margin:…; letter-spacing:…}` がほぼ必ず入るので、**プレビューが本番を
   * 再現していない**状態になっていた。窓ルートへ読み替えることで両者が同じ規則で説明できる。
   */
  it("注入前に rewriteRootLike を通す（body / html / :root が窓ルートへ向く）", async () => {
    mocks.getOverlayThemeCss.mockResolvedValue(
      "body{margin:6px auto;letter-spacing:.1em}",
    );
    saveOverlayTheme(THEME_A);
    render(<OverlayApp />);
    await waitFor(() => expect(themeStyles()).toHaveLength(1));
    expect(themeCssOf(themeStyles()[0])).toBe(
      ".sd-overlay{margin:6px auto;letter-spacing:.1em}",
    );
  });

  it("⚠ 通常のセレクタは前置されない（プレビューの scopeSelectors とはここが違う）", async () => {
    mocks.getOverlayThemeCss.mockResolvedValue(".sd-comment{color:red}");
    saveOverlayTheme(THEME_A);
    render(<OverlayApp />);
    await waitFor(() => expect(themeStyles()).toHaveLength(1));
    // 前置すると詳細度が無意味に上がる（配信窓には閉じ込める相手がいない）。
    expect(themeCssOf(themeStyles()[0])).toBe(".sd-comment{color:red}");
  });

  it(":root の CSS 変数が窓ルートに載る（実サンプルの --txtcolor が効く）", async () => {
    mocks.getOverlayThemeCss.mockResolvedValue(":root{--txtcolor:#555}");
    saveOverlayTheme(THEME_A);
    render(<OverlayApp />);
    await waitFor(() => expect(themeStyles()).toHaveLength(1));
    expect(themeCssOf(themeStyles()[0])).toBe(".sd-overlay{--txtcolor:#555}");
  });

  // ⚠⚠ **既知の限界（実測 2026-08-05）**: このテストは `innerHTML` への退行を**殺せない**。
  //   jsdom は `<style>.innerHTML` に RAWTEXT のフラグメント解析を実装しておらず、
  //   `textContent` 経路と**完全に同じ結果**になる（実測: textContent / childNodes / sheet.cssRules が一致、
  //   逃げ出す <img> も 0 件）。実ブラウザ（WKWebView / WebView2）では `</style>` で要素が閉じるため
  //   挙動が分かれるが、jsdom では観測できない。
  //   → **この不変条件を実際に殺しているのは静的ガード (10-i)**（`innerHTML` / `dangerouslySetInnerHTML` /
  //   `insertRule` / `adoptedStyleSheets` の出現をファイル単位で禁じる）。**ガードを消さないこと。**
  //   本テストは「何が正しい形か」を仕様として固定し、実ブラウザでの退行を捕まえる役割で残す
  //   （(10-a) と `CommentList.test.tsx` の役割分担と同型で、ここは向きが逆＝ガードが主・テストが従）。
  it("⚠ 注入は textContent のみ（`</style>` を含む CSS でも DOM を壊さない）", async () => {
    // 正当な CSS だが、innerHTML に入れると <style> が閉じて後ろが HTML として解釈される。
    const css = '.sd-comment{content:"</style><img src=x>"}';
    mocks.getOverlayThemeCss.mockResolvedValue(css);
    saveOverlayTheme(THEME_A);
    render(<OverlayApp />);

    await waitFor(() => expect(themeStyles()).toHaveLength(1));
    const style = themeStyles()[0];
    // textContent なら CSS が 1 文字も欠けずそのまま入る（innerHTML だと途中で切れる）。
    expect(themeCssOf(style)).toBe(css);
    // 生 HTML として解釈されていない＝要素の子も、逃げ出した <img> も無い。
    expect(style.childElementCount).toBe(0);
    expect(document.querySelector("img")).toBeNull();
  });

  it("切り替えても <style> は 1 つのまま（積み上がらない）", async () => {
    saveOverlayTheme(THEME_A);
    render(<OverlayApp />);
    await waitFor(() => expect(themeStyles()).toHaveLength(1));

    for (const [id, css] of [
      [THEME_B, ".sd-comment{color:blue}"],
      [THEME_A, ".sd-comment{color:green}"],
      [THEME_B, ".sd-comment{color:black}"],
      [THEME_A, ".sd-comment{color:white}"],
      [THEME_B, ".sd-comment{color:gray}"],
    ] as const) {
      mocks.getOverlayThemeCss.mockResolvedValue(css);
      saveOverlayTheme(id);
      emitStorage(OVERLAY_THEME_KEY);
      await waitFor(() => {
        expect(themeStyles()).toHaveLength(1);
        expect(themeCssOf(themeStyles()[0])).toBe(css);
      });
    }
  });

  it("storage イベントで既定へ戻すと <style> が消える（「既定のデザインに戻す」の受け口）", async () => {
    saveOverlayTheme(THEME_A);
    render(<OverlayApp />);
    await waitFor(() => expect(themeStyles()).toHaveLength(1));

    saveOverlayTheme(null);
    emitStorage(OVERLAY_THEME_KEY);
    await waitFor(() => expect(themeStyles()).toHaveLength(0));
  });

  it("localStorage.clear()（key=null）でも既定へ戻る", async () => {
    saveOverlayTheme(THEME_A);
    render(<OverlayApp />);
    await waitFor(() => expect(themeStyles()).toHaveLength(1));

    localStorage.clear();
    emitStorage(null);
    await waitFor(() => expect(themeStyles()).toHaveLength(0));
  });

  it("アンマウントで <style> を取り除く", async () => {
    saveOverlayTheme(THEME_A);
    const view = render(<OverlayApp />);
    await waitFor(() => expect(themeStyles()).toHaveLength(1));
    view.unmount();
    expect(themeStyles()).toHaveLength(0);
  });

  it("取得に失敗したら既定意匠へ倒し、localStorage は書き換えない", async () => {
    mocks.getOverlayThemeCss.mockRejectedValue({
      code: "NOT_FOUND",
      message: "テーマが見つかりません。",
    });
    saveOverlayTheme(THEME_A);
    render(<OverlayApp />);

    await waitFor(() => expect(mocks.getOverlayThemeCss).toHaveBeenCalled());
    expect(themeStyles()).toHaveLength(0);
    // ⚠ 表示専用の窓が設定を書き換えない（気付かせるのはコメビュ窓側の責務）。
    expect(localStorage.getItem(OVERLAY_THEME_KEY)).toBe(THEME_A);
  });

  // ⚠⚠ **実機確認 8（脱出路）のうち「機構」をここで固定する。**
  // `.sd-comment{display:none}` は**オーバーレイを完全に不可視にする 1 行**で、
  // オーバーレイ窓は表示専用・非フォーカスなので**そこからは何も操作できない**。
  // 復帰は「設定窓で既定へ戻す → localStorage → `storage` イベント → この窓が `<style>` を外す」
  // という経路**だけ**に依存している。＝ この経路が切れると**配信中に詰む**。
  // ⚠ 実機で見るのは「本当に画面が空になり、本当に戻る」ことだけに絞れる。
  it("⚠⚠ 不可視にするテーマ（display:none）でも、既定へ戻せば <style> が外れて復帰する", async () => {
    mocks.getOverlayThemeCss.mockResolvedValue(".sd-comment{display:none}");
    saveOverlayTheme(THEME_A);
    render(<OverlayApp />);
    await waitFor(() => expect(themeStyles()).toHaveLength(1));
    expect(themeCssOf(themeStyles()[0])).toBe(".sd-comment{display:none}");

    // 設定窓の「既定のデザインに戻す」＝ キーごと削除して他窓へ storage を飛ばす。
    saveOverlayTheme(null);
    emitStorage(OVERLAY_THEME_KEY);

    await waitFor(() => expect(themeStyles()).toHaveLength(0));
    // ⚠ 既定意匠へ戻る＝ 取り込んだ CSS が 1 バイトも残っていないこと。
    expect(document.head.innerHTML).not.toContain("display:none");
  });

  it("不正な id が保存されていても既定意匠へ倒す（コマンドを呼ばない）", async () => {
    localStorage.setItem(OVERLAY_THEME_KEY, "../../evil");
    render(<OverlayApp />);
    await waitFor(() => expect(mocks.connectCommentStream).toHaveBeenCalled());
    expect(mocks.getOverlayThemeCss).not.toHaveBeenCalled();
    expect(themeStyles()).toHaveLength(0);
  });
});
