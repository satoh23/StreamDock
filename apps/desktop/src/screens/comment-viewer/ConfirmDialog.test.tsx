import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ConfirmDialog } from "./ConfirmDialog";

/**
 * 038b: 破壊的操作の確認ダイアログの仕様テスト。
 *
 * 仕様（こうあるべき）:
 * - 破壊的操作は「明示的に開いたときだけ」確認ダイアログを出す（open=false なら何も描かない）。
 * - open が false→true になったら "実際にモーダル表示される"（＝showModal 済み・dialog.open=true）。
 *   これはレビュー #1（[] 依存で showModal が二度と呼ばれず削除確認が出なかった不具合）の回帰ガード。
 * - 「確認」で onConfirm、「キャンセル」/Esc で onCancel。busy 中は両ボタンを無効化して二重実行を防ぐ。
 */

const baseProps = {
  title: "視聴者の削除",
  message: "「Alice」を削除します。取り消せません。",
  confirmLabel: "削除",
  onConfirm: vi.fn(),
  onCancel: vi.fn(),
};

describe("ConfirmDialog", () => {
  it("open=false では何も描画しない（確認は明示時のみ）", () => {
    render(<ConfirmDialog open={false} {...baseProps} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("open が false→true でモーダル表示される（#1 回帰ガード: showModal 済み）", () => {
    const { rerender } = render(<ConfirmDialog open={false} {...baseProps} />);
    expect(screen.queryByRole("dialog")).toBeNull();

    rerender(<ConfirmDialog open={true} {...baseProps} />);
    const dialog = screen.getByRole("dialog") as HTMLDialogElement;
    // showModal が呼ばれていれば open 属性が立つ（[] 依存の旧実装では false のままだった）。
    expect(dialog.open).toBe(true);
    expect(screen.getByText(baseProps.message)).toBeInTheDocument();
  });

  it("「確認」ボタンで onConfirm、「キャンセル」で onCancel を呼ぶ", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog open {...baseProps} onConfirm={onConfirm} onCancel={onCancel} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "削除" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("busy 中は両ボタンが無効（二重実行・誤操作を防ぐ）", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open
        busy
        {...baseProps}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    const confirm = screen.getByRole("button", { name: "処理中…" });
    const cancel = screen.getByRole("button", { name: "キャンセル" });
    expect(confirm).toBeDisabled();
    expect(cancel).toBeDisabled();
    fireEvent.click(confirm);
    fireEvent.click(cancel);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("Esc（cancel イベント）で onCancel を呼ぶ（既定 close を止めて state 経由で閉じる）", () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog open {...baseProps} onCancel={onCancel} />);
    const dialog = screen.getByRole("dialog");
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
