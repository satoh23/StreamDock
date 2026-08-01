import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import type { Screen } from "../types";
import type { HostOs } from "../features/platform/useHostOs";
import { Header } from "./Header";
import { HEADER_SECTIONS } from "./headerSections";

/**
 * 055c: ヘッダーのアップデート導線（ベル＋バッジ）の仕様テスト。
 *
 * 仕様（こうあるべき・docs/tasks/055c / 親 055）:
 * - ベルは診断/設定と同じ形のアイコンボタンで、押すと `onNavigate("app-update")` を呼ぶ（遷移だけ・再チェックはしない）。
 * - **更新があるときだけ**バッジを出す。**中身は常に「1」**（＝「未確認の更新通知が 1 件」の意味で、
 *   新しいリリースの件数ではない）。**確認できなかったときは出さない**（呼び出し側が false を渡す）。
 * - バッジは `aria-hidden="true"`。件数は `aria-label`（「アップデート（1件）」）側が持つ。
 * - ⚠ **`HEADER_SECTIONS` には足さない**（アイコンボタンでありテキストセクション導線ではない）。
 * - 既存の診断/設定ボタンの遷移先は変わらない（ボタンを 1 つ増やしたことの回帰確認）。
 *
 * ⚠ 本ファイルは `src/components/` 初のテスト。vitest の include は `src/**\/*.test.{ts,tsx}` なので
 *   置くだけで拾われる（設定変更は不要）。
 *
 * `Header` は Windows 制御ボタン用に `@tauri-apps/api/window` を import する。テストが実ウィンドウ API に
 * 触れないことを構造で担保しつつ、**呼ばれたことをアサートできるよう参照を固定**してモックする
 * （`vi.hoisted` で巻き上げないと `vi.mock` のファクトリから参照できない）。
 */
const windowMock = vi.hoisted(() => ({
  minimize: vi.fn(),
  toggleMaximize: vi.fn(),
  close: vi.fn(),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => windowMock),
}));

function renderHeader(
  overrides: {
    updateAvailable?: boolean;
    hostOs?: HostOs;
    activeNav?: Extract<
      Screen,
      | "main"
      | "rakuraku-tools"
      | "obs-effects"
      | "diagnostics"
      | "settings"
      | "app-update"
    >;
  } = {},
) {
  const onNavigate = vi.fn();
  const utils = render(
    <Header
      hostOs={overrides.hostOs}
      activeNav={overrides.activeNav}
      updateAvailable={overrides.updateAvailable}
      onNavigate={onNavigate}
    />,
  );
  return { onNavigate, ...utils };
}

/** ベルボタン（更新の有無でアクセシブル名が変わるので両方を許容して引く）。 */
function bellButton() {
  return screen.getByRole("button", { name: /^アップデート/ });
}

describe("Header のアップデート導線（055c）", () => {
  it("更新があるときだけバッジ「1」を出す", () => {
    renderHeader({ updateAvailable: true });
    expect(bellButton()).toHaveTextContent("1");
  });

  it("更新が無いときはバッジを出さない", () => {
    renderHeader({ updateAvailable: false });
    expect(bellButton()).not.toHaveTextContent("1");
  });

  it("updateAvailable 未指定（＝確認できなかった等）でもバッジを出さない", () => {
    // 取得失敗時に呼び出し側が false を渡すのが正だが、既定でも出ないことを固定する
    // （「確認できなかった」が「更新あり」に化けないための多重防御）。
    renderHeader();
    expect(bellButton()).not.toHaveTextContent("1");
  });

  it("バッジは常に「1」で、件数はアクセシブル名側が持つ（バッジは aria-hidden）", () => {
    const { container } = renderHeader({ updateAvailable: true });
    expect(
      screen.getByRole("button", { name: "アップデート（1件）" }),
    ).toBeInTheDocument();

    const badge = container.querySelector('[aria-hidden="true"][class*="navBadge"]');
    expect(badge).not.toBeNull();
    expect(badge).toHaveTextContent("1");
  });

  it("更新が無いときのアクセシブル名は件数を含まない", () => {
    renderHeader({ updateAvailable: false });
    expect(screen.getByRole("button", { name: "アップデート" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "アップデート（1件）" }),
    ).toBeNull();
  });

  it("ベルを押すと app-update 画面へ遷移する（それ以外は起こさない）", () => {
    const { onNavigate } = renderHeader({ updateAvailable: true });
    fireEvent.click(bellButton());
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith("app-update");
  });

  it("ベルはアイコンボタンなのでセクション導線（HEADER_SECTIONS）には入れない", () => {
    const { container } = renderHeader({ updateAvailable: true });

    // 単一ソース側に app-update が紛れ込んでいない。
    expect(HEADER_SECTIONS.some((s) => s.screen === "app-update")).toBe(false);

    // 描画側でも、ベルはセクション導線のコンテナの外にある。
    const sections = container.querySelector('[data-tutorial-id="header-sections"]');
    expect(sections).not.toBeNull();
    expect(sections?.contains(bellButton())).toBe(false);
  });

  it("既存の診断/設定ボタンの遷移先は変わらない（ベル追加の回帰）", () => {
    const { onNavigate } = renderHeader();
    fireEvent.click(screen.getByRole("button", { name: "診断 / ログ" }));
    expect(onNavigate).toHaveBeenLastCalledWith("diagnostics");
    fireEvent.click(screen.getByRole("button", { name: "設定" }));
    expect(onNavigate).toHaveBeenLastCalledWith("settings");
    fireEvent.click(screen.getByRole("button", { name: "メイン画面へ" }));
    expect(onNavigate).toHaveBeenLastCalledWith("main");
  });

  it("activeNav=app-update のときベルが active になる（他の画面では付かない）", () => {
    const { rerender } = renderHeader({ activeNav: "app-update" });
    expect(bellButton().className).toMatch(/active/);

    rerender(
      <Header activeNav="settings" updateAvailable={false} onNavigate={vi.fn()} />,
    );
    expect(bellButton().className).not.toMatch(/active/);
  });

  it("並び順は ベル → 診断 → 設定（セクション導線の右隣）", () => {
    // 055c 仕様「置き場所: 診断・設定の左（sections の右隣）。ベル → 診断 → 設定 の順」。
    // 見た目の順序は DOM 順で決まる（nav は flex・order 指定なし）ので、ここで固定できる。
    const { container } = renderHeader({ updateAvailable: true });
    const sections = container.querySelector('[data-tutorial-id="header-sections"]')!;
    const bell = bellButton();
    const diagnostics = screen.getByRole("button", { name: "診断 / ログ" });
    const settings = screen.getByRole("button", { name: "設定" });

    const isBefore = (a: Element, b: Element) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

    expect(isBefore(sections, bell)).toBe(true);
    expect(isBefore(bell, diagnostics)).toBe(true);
    expect(isBefore(diagnostics, settings)).toBe(true);
  });
});

/**
 * 055c の実機確認項目 6「ヘッダーのドラッグ移動／macOS の信号機回避余白／Windows の自作制御ボタンが
 * 崩れていない」のうち、**jsdom で確かめられる部分**を単体テストへ降ろす（ベルを 1 つ足したことの回帰）。
 *
 * ⚠ 何が jsdom で確かめられて、何が確かめられないかを明確にしておく:
 * - ✅ `data-tauri-drag-region` / `data-os` **属性が付いていること**（CSS とネイティブ側が拾う目印）
 * - ✅ Windows 制御ボタンの**存在・出し分け・押したときの呼び出し先**
 * - ❌ **実際にドラッグでウィンドウが動くか**（webview 固有）
 * - ❌ **信号機回避の 78px が実際に空くか**（`.header[data-os="macos"]` の CSS はカスケードされない）
 *   → この 2 つは E2E（手動）に残る。
 *
 * ⚠ Windows 制御ボタンは 055c 以前から**一度もテストされていなかった**（既存からの状態）。
 * ベルを nav に 1 つ足した変更は、この分岐と同じ `nav` の中身を触るため、ここで回帰を張る。
 */
describe("Header のプラットフォーム分岐（実機確認 6 のうち jsdom で確かめられる部分）", () => {
  it("ヘッダーに data-tauri-drag-region が付いている（ボタンを増やしても外れない）", () => {
    const { container } = renderHeader();
    const header = container.querySelector("header");
    expect(header).toHaveAttribute("data-tauri-drag-region");
  });

  it("macOS では data-os=macos が付く（信号機回避余白を当てる目印）", () => {
    const { container } = renderHeader({ hostOs: "macos" });
    expect(container.querySelector("header")).toHaveAttribute("data-os", "macos");
  });

  it("hostOs 未指定なら data-os を付けない（既定は余白なし）", () => {
    const { container } = renderHeader();
    expect(container.querySelector("header")).not.toHaveAttribute("data-os");
  });

  it("Windows のときだけ自作の最小化/最大化/閉じるを出す", () => {
    renderHeader({ hostOs: "windows" });
    for (const name of ["最小化", "最大化", "閉じる"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
  });

  it("Windows 以外では制御ボタンを出さない（macOS はネイティブの信号機を使う）", () => {
    for (const hostOs of [undefined, "macos" as const, "linux" as const]) {
      const { unmount } = renderHeader({ hostOs });
      for (const name of ["最小化", "最大化", "閉じる"]) {
        expect(screen.queryByRole("button", { name })).toBeNull();
      }
      unmount();
    }
  });

  it("制御ボタンはそれぞれ対応するウィンドウ操作を呼ぶ（取り違えの回帰）", () => {
    renderHeader({ hostOs: "windows" });

    fireEvent.click(screen.getByRole("button", { name: "最小化" }));
    expect(windowMock.minimize).toHaveBeenCalledTimes(1);
    expect(windowMock.close).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "最大化" }));
    expect(windowMock.toggleMaximize).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "閉じる" }));
    expect(windowMock.close).toHaveBeenCalledTimes(1);
  });

  it("Windows でもベル/診断/設定の遷移は変わらない（制御ボタン追加との共存）", () => {
    const { onNavigate, container } = renderHeader({
      hostOs: "windows",
      updateAvailable: true,
    });
    const nav = container.querySelector("nav")!;

    fireEvent.click(within(nav).getByRole("button", { name: /^アップデート/ }));
    expect(onNavigate).toHaveBeenLastCalledWith("app-update");
    fireEvent.click(within(nav).getByRole("button", { name: "診断 / ログ" }));
    expect(onNavigate).toHaveBeenLastCalledWith("diagnostics");
    // ベルのバッジは Windows 制御ボタンと同居しても出る。
    expect(within(nav).getByRole("button", { name: "アップデート（1件）" })).toBeInTheDocument();
  });
});
