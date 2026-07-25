import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { ViewerRecord, ViewerDetail } from "../../features/viewer-memory/types";

// invoke ラッパ（038a）は全てモック＝テストは端末外通信も OS 操作もしない。
vi.mock("../../features/viewer-memory/viewerMemoryApi", () => ({
  getViewer: vi.fn(),
  updateViewerNote: vi.fn(),
  deleteViewer: vi.fn(),
}));

import {
  getViewer,
  updateViewerNote,
  deleteViewer,
} from "../../features/viewer-memory/viewerMemoryApi";
import { ViewerDetailPanel } from "./ViewerDetailPanel";

const mockGet = vi.mocked(getViewer);
const mockUpdate = vi.mocked(updateViewerNote);
const mockDelete = vi.mocked(deleteViewer);

const makeViewer = (over: Partial<ViewerRecord> = {}): ViewerRecord => ({
  id: "twitch:1",
  provider: "twitch",
  providerUserId: "1",
  name: "Alice",
  firstSeenAt: "2026-07-20T10:00:00Z",
  lastCommentAt: "2026-07-25T10:00:00Z",
  totalComments: 12,
  bitsCount: 0,
  bitsAmount: 0,
  superchatCount: 0,
  superchatAmount: 0,
  subscriptionCount: 0,
  isMember: false,
  note: "",
  createdAt: "2026-07-20T10:00:00Z",
  updatedAt: "2026-07-25T10:00:00Z",
  ...over,
});
const makeDetail = (viewer: ViewerRecord): ViewerDetail => ({ viewer, comments: [] });

beforeEach(() => {
  mockGet.mockResolvedValue(makeDetail(makeViewer()));
  mockUpdate.mockResolvedValue(makeViewer());
  mockDelete.mockResolvedValue(undefined);
});

describe("ViewerDetailPanel", () => {
  it("get_viewer で詳細（名前・メモ欄）を表示する", async () => {
    render(<ViewerDetailPanel id="twitch:1" onDismiss={vi.fn()} />);
    expect(
      await screen.findByRole("heading", { name: "Alice" }),
    ).toBeInTheDocument();
    expect(screen.getByText("配信者メモ")).toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledWith("twitch:1");
  });

  it("取得失敗（未記録＝NotFound を含む）は固定の安全文言のみ出す（本文・エラー詳細は出さない）", async () => {
    mockGet.mockRejectedValue(new Error("NotFound"));
    render(<ViewerDetailPanel id="twitch:x" onDismiss={vi.fn()} />);
    expect(
      await screen.findByText(/記録が見つかりませんでした/),
    ).toBeInTheDocument();
    // 集計・メモ・削除カードは出さない。
    expect(screen.queryByText("配信者メモ")).toBeNull();
  });

  it("メモを編集して保存すると update_viewer_note(id, note) を呼ぶ", async () => {
    render(<ViewerDetailPanel id="twitch:1" onDismiss={vi.fn()} />);
    const textarea = await screen.findByPlaceholderText(
      "この視聴者についてのメモ（端末内にのみ保存されます）",
    );
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled(); // 未変更時は無効
    fireEvent.change(textarea, { target: { value: "常連さん" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith("twitch:1", "常連さん"),
    );
  });

  it("削除は確認ダイアログ確定後にのみ delete_viewer を呼び、onDeleted を通知する", async () => {
    const onDeleted = vi.fn();
    render(
      <ViewerDetailPanel id="twitch:1" onDismiss={vi.fn()} onDeleted={onDeleted} />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "この視聴者の情報を削除する" }),
    );
    expect(mockDelete).not.toHaveBeenCalled(); // 確認前は削除しない

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "削除" }));
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith("twitch:1"));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith("twitch:1"));
  });

  it("dismissKind='close' は × ボタン（閉じる）で onDismiss を呼ぶ（サイドパネル用）", async () => {
    const onDismiss = vi.fn();
    render(
      <ViewerDetailPanel id="twitch:1" onDismiss={onDismiss} dismissKind="close" />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "閉じる" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
