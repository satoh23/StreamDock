import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useState } from "react";
import { Tabs, type TabItem } from "./Tabs";

/**
 * 061i: 画面の中身をタブで切り替える共通部品の仕様テスト（判断 6）。
 *
 * ⚠⚠ 固定したい不変条件:
 * - **`role="tablist"` / `role="tab"` / `aria-selected` が付く**（既存 idiom＝`AddToolScreen` の
 *   `.kindToggle` に倣った a11y の形。ここが消えると支援技術には「ただのボタンが並んでいる」ようにしか見えない）。
 * - **状態は持たない**（`activeId` / `onChange` は呼び出し側のもの）。
 * - **`aria-label` が付く**（何のタブ列かが伝わる）。
 *
 * ⚠ 意匠（選択中のタブが浮いて見えること）は jsdom では検証できない。
 *   `components/Tabs.module.css` に生 hex / `rgba()` を書かないこと・`--text-faint` を可読テキストに
 *   使わないことは `scripts/check-css-guards.mjs` の (6-b) が走査で見ている。
 */

const ITEMS: readonly TabItem[] = [
  { id: "a", label: "コメントで出すエフェクト" },
  { id: "b", label: "配信イベント" },
];

/** 呼び出し側が状態を持つ形（＝実際の使われ方）を模す。 */
function Harness({ initial = "a" }: { initial?: string }) {
  const [active, setActive] = useState(initial);
  return (
    <>
      <Tabs
        items={ITEMS}
        activeId={active}
        onChange={setActive}
        ariaLabel="エフェクトの種類"
      />
      <div role="tabpanel">{active === "a" ? "Aの中身" : "Bの中身"}</div>
    </>
  );
}

describe("061i: Tabs", () => {
  it("⚠ `role=\"tablist\"` の中に `role=\"tab\"` が並び、選択中だけ `aria-selected` が true", () => {
    render(<Harness />);
    const list = screen.getByRole("tablist", { name: "エフェクトの種類" });
    expect(list).toBeInTheDocument();

    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual([
      "コメントで出すエフェクト",
      "配信イベント",
    ]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(tabs[1]).toHaveAttribute("aria-selected", "false");
  });

  it("タブを押すとパネルが入れ替わる（状態は呼び出し側が持つ）", () => {
    render(<Harness />);
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Aの中身");

    fireEvent.click(screen.getByRole("tab", { name: "配信イベント" }));

    expect(screen.getByRole("tabpanel")).toHaveTextContent("Bの中身");
    expect(screen.getByRole("tab", { name: "配信イベント" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("⚠ `activeId` は props で決まる（部品が自分で状態を持たない）", () => {
    // ⚠ ここが崩れると「画面を離れて戻るとタブが勝手に戻る／戻らない」を部品が決めることになる。
    const onChange = vi.fn();
    render(
      <Tabs items={ITEMS} activeId="b" onChange={onChange} ariaLabel="種類" />,
    );
    expect(screen.getByRole("tab", { name: "配信イベント" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    // 押しても部品側の見た目は変わらない（＝`onChange` を受けた呼び出し側が決める）。
    fireEvent.click(screen.getByRole("tab", { name: "コメントで出すエフェクト" }));
    expect(onChange).toHaveBeenCalledWith("a");
    expect(screen.getByRole("tab", { name: "配信イベント" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("⚠ `type=\"button\"` を付ける（フォームの中に置いても submit しない）", () => {
    // ⚠ この画面群のボタンは `layout.panel`（＝将来フォーム化しうる器）の中に置かれる。
    //   既定の `type="submit"` のままだと、タブを押した瞬間にフォームが送信される事故が起きる。
    render(<Harness />);
    for (const tab of screen.getAllByRole("tab")) {
      expect(tab).toHaveAttribute("type", "button");
    }
  });
});
