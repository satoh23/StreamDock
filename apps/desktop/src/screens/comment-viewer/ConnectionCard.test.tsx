import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ConnectionCard } from "./ConnectionCard";

/**
 * 042b（デザイン改修）: ヘッダー内の接続ピル＋非モーダル ポップオーバーの仕様テスト。
 *
 * 仕様（こうあるべき）— ConnectionCard.tsx の docstring / タスク 042b（デザイン改修）が正:
 * - ピルはネイティブ <button> で、`aria-haspopup="dialog"` と、`open` を反映する `aria-expanded` を持つ
 *   （クリック/Enter/Space/フォーカスは button 標準）。
 * - open=false のときはポップオーバー（role="dialog"）を描画しない＝children（連携フォーム・device code 等）も出さない。
 * - open=true のときだけポップオーバー（role="dialog"・aria-label="<サービス> 接続"）に children を描画する。
 * - 状態は「色付き円＋日本語テキストラベル」で色覚に依存しない。ラベルは sessionState のみから導出（linked/streamConnected は
 *   props に無く構造的に混ざらない・旧 StatusIndicator と同義）。
 * - ピルのクリックで onToggle を呼ぶ。表示専用＝当テストでも invoke/WS は一切発生しない。
 * - 「1 つずつ開く（ラジオ排他）」「外側クリック/Esc で閉じる」は state を持つ CommentViewerApp 側の責務のため、ここでは検証しない
 *   （手動 E2E で確認）。
 */

function renderCard(
  overrides: {
    service?: string;
    sessionState?: string;
    open?: boolean;
    onToggle?: () => void;
  } = {},
) {
  const onToggle = overrides.onToggle ?? vi.fn();
  const utils = render(
    <ConnectionCard
      service={overrides.service ?? "Twitch"}
      sessionState={overrides.sessionState ?? "idle"}
      open={overrides.open ?? false}
      onToggle={onToggle}
    >
      <span>連携フォーム</span>
    </ConnectionCard>,
  );
  return { onToggle, ...utils };
}

describe("ConnectionCard", () => {
  it("ピルは button で aria-haspopup=dialog・aria-expanded を open に追従させる", () => {
    const { rerender } = renderCard({ open: false });
    const pill = screen.getByRole("button");
    expect(pill).toHaveAttribute("aria-haspopup", "dialog");
    expect(pill).toHaveAttribute("aria-expanded", "false");

    rerender(
      <ConnectionCard
        service="Twitch"
        sessionState="idle"
        open={true}
        onToggle={() => {}}
      >
        <span>連携フォーム</span>
      </ConnectionCard>,
    );
    expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "true");
  });

  it("閉じているときはポップオーバー（dialog）も children も描画しない", () => {
    renderCard({ open: false });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText("連携フォーム")).toBeNull();
  });

  it("開いているときだけポップオーバー（role=dialog・aria-label）に children を描画する", () => {
    renderCard({ service: "YouTube", open: true });
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-label", "YouTube 接続");
    expect(screen.getByText("連携フォーム")).toBeInTheDocument();
  });

  it("ピルのクリックで onToggle を呼ぶ（レンダーだけでは呼ばない）", () => {
    const { onToggle } = renderCard({ open: false });
    expect(onToggle).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button"));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("サービス名と、色覚非依存の状態テキストラベルをピルに表示する", () => {
    renderCard({ service: "YouTube", sessionState: "connected" });
    expect(screen.getByText("YouTube")).toBeInTheDocument();
    expect(screen.getByText("接続済み")).toBeInTheDocument(); // connected=接続済み
  });

  it("状態ラベルは sessionState のみから導出する（未知は待機中へ劣化・旧 StatusIndicator と同義）", () => {
    const cases: Array<[string, string]> = [
      ["connecting", "接続中"],
      ["failed", "失敗"],
      ["idle", "待機中"],
      ["bogus", "待機中"], // 未知は待機中へ劣化（壊れない）
    ];
    for (const [state, label] of cases) {
      const { unmount } = renderCard({ sessionState: state });
      expect(screen.getByText(label)).toBeInTheDocument();
      unmount();
    }
  });
});
