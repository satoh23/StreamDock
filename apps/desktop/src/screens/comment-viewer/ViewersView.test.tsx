import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { ViewerRecord, ViewerDetail } from "../../features/viewer-memory/types";

// invoke ラッパ（038a）は全てモックする＝テストは端末外通信も OS 操作も一切しない。
vi.mock("../../features/viewer-memory/viewerMemoryApi", () => ({
  listViewers: vi.fn(),
  getViewer: vi.fn(),
  updateViewerNote: vi.fn(),
  deleteViewer: vi.fn(),
}));

import {
  listViewers,
  getViewer,
  updateViewerNote,
  deleteViewer,
} from "../../features/viewer-memory/viewerMemoryApi";
import { ViewersView } from "./ViewersView";

const mockList = vi.mocked(listViewers);
const mockGet = vi.mocked(getViewer);
const mockUpdate = vi.mocked(updateViewerNote);
const mockDelete = vi.mocked(deleteViewer);

/** 仕様上ありうる ViewerRecord を作る（テスト都度上書き可能）。 */
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
  // 065a: わんコメからの引き継ぎ。既定は「引き継ぎ無し」（importedAt が undefined＝未取り込み）。
  nickname: "",
  label: "",
  giftCount: 0,
  streamCount: 1,
  activeDays: 1,
  importedComments: 0,
  importedGifts: 0,
  importedGiftAmount: 0,
  importedActiveDays: 0,
  importedStreamCount: 0,
  ...over,
});

const makeDetail = (viewer: ViewerRecord): ViewerDetail => ({
  viewer,
  comments: [],
});

beforeEach(() => {
  mockList.mockResolvedValue([]);
  mockGet.mockResolvedValue(makeDetail(makeViewer()));
  mockUpdate.mockResolvedValue(makeViewer());
  mockDelete.mockResolvedValue(undefined);
});

describe("ViewersView 一覧", () => {
  it("マウント時に list_viewers を叩き、視聴者名を並べる", async () => {
    mockList.mockResolvedValue([
      makeViewer({ id: "twitch:1", name: "Alice" }),
      makeViewer({ id: "youtube:2", name: "Bob", provider: "youtube" }),
    ]);
    render(<ViewersView onBack={vi.fn()} />);

    expect(await screen.findByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(mockList).toHaveBeenCalled();
  });

  it("データが無ければ空表示にする", async () => {
    mockList.mockResolvedValue([]);
    render(<ViewersView onBack={vi.fn()} />);
    expect(await screen.findByText("視聴者はまだいません")).toBeInTheDocument();
  });

  it("検索は debounce してサーバ側 list_viewers({search,sort}) に渡す（client フィルタしない）", async () => {
    mockList.mockResolvedValue([makeViewer({ name: "Alice" })]);
    render(<ViewersView onBack={vi.fn()} />);
    await screen.findByText("Alice");

    fireEvent.change(screen.getByLabelText("視聴者を名前で検索"), {
      target: { value: "ali" },
    });

    // 250ms debounce 後、search 付きで再取得される。
    await waitFor(() =>
      expect(mockList).toHaveBeenLastCalledWith({ search: "ali", sort: "lastComment" }),
    );
  });
});

// 【レビュー：ViewerDetailPanel.test との二重カバレッジについて】以下の詳細・メモ・個別削除は、ViewersView 側では
// 「一覧の行クリック→ViewerDetailPanel へ正しい id が渡り、パネルの操作が command に届く」という配線（integration）を
// 検証する。パネル単体の状態機械（NotFound の安全文言・× 閉じるなど）は ViewerDetailPanel.test（unit）が担う。
// 役割分担のため重複は意図的（冗長ではない）。抽出前の緑を非退行として残す意味も持つ。
describe("ViewersView 詳細・メモ", () => {
  it("行クリックで get_viewer を叩き、詳細（メモ欄）を表示する", async () => {
    mockList.mockResolvedValue([makeViewer({ id: "twitch:1", name: "Alice" })]);
    render(<ViewersView onBack={vi.fn()} />);
    fireEvent.click(await screen.findByText("Alice"));

    expect(await screen.findByText("配信者メモ")).toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledWith("twitch:1");
  });

  it("メモを編集して保存すると update_viewer_note(id, note) を呼ぶ", async () => {
    const viewer = makeViewer({ id: "twitch:1", name: "Alice", note: "" });
    mockList.mockResolvedValue([viewer]);
    mockGet.mockResolvedValue(makeDetail(viewer));
    render(<ViewersView onBack={vi.fn()} />);
    fireEvent.click(await screen.findByText("Alice"));

    const textarea = await screen.findByPlaceholderText(
      "この視聴者についてのメモ（端末内にのみ保存されます）",
    );
    // 未変更時は保存ボタンが無効（仕様）。
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();

    fireEvent.change(textarea, { target: { value: "常連さん" } });
    const save = screen.getByRole("button", { name: "保存" });
    expect(save).toBeEnabled();
    fireEvent.click(save);

    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith("twitch:1", "常連さん"),
    );
  });
});

describe("ViewersView 削除（必ず確認ダイアログを経由する）", () => {
  it("個別削除は確認ダイアログ確定後にのみ delete_viewer を呼ぶ", async () => {
    mockList.mockResolvedValue([makeViewer({ id: "twitch:1", name: "Alice" })]);
    render(<ViewersView onBack={vi.fn()} />);
    fireEvent.click(await screen.findByText("Alice"));

    // 詳細の削除トリガーを押しただけでは削除されない。
    fireEvent.click(
      await screen.findByRole("button", { name: "この視聴者の情報を削除する" }),
    );
    expect(mockDelete).not.toHaveBeenCalled();

    // 確認ダイアログが出て、その「削除」を押して初めて実行される。
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "削除" }));
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith("twitch:1"));
  });

  it("一括削除は選択→確認→確定で選択分だけ delete_viewer を呼ぶ", async () => {
    mockList.mockResolvedValue([
      makeViewer({ id: "twitch:1", name: "Alice" }),
      makeViewer({ id: "youtube:2", name: "Bob", provider: "youtube" }),
    ]);
    render(<ViewersView onBack={vi.fn()} />);
    await screen.findByText("Alice");

    // Alice の行を選択（チェックボックスは詳細を開かず選択のみ）。
    fireEvent.click(screen.getByLabelText("Alice を選択"));
    fireEvent.click(
      await screen.findByRole("button", { name: /選択した .* 件を削除/ }),
    );
    expect(mockDelete).not.toHaveBeenCalled();

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "削除" }));
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith("twitch:1"));
    expect(mockDelete).toHaveBeenCalledTimes(1); // Bob は未選択なので呼ばれない
  });
});
