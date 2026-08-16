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
  // 065a: CSV からの引き継ぎ。既定は「引き継ぎ無し」（importedAt が undefined＝未取り込み）。
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

/**
 * 065b (4): CSV の取り込みで増えた項目の表示。
 *
 * あるべき挙動（docs/tasks/065b-onecomme-import-ui.md ／ task-board の 065a 申し送り 2〜5・7）:
 * - `giftCount` / `streamCount` / `activeDays` が出る。⚠ 後ろ 2 つは**近似**なのでラベル自体で示す
 * - ⚠⚠ `importedGiftAmount` に**通貨記号を付けない**（単位不明。`fmtSuperchat` を流用したら嘘になる）
 * - ⚠⚠ 初回来訪は `firstSeenAt` と `importedFirstSeenAt` の**古いほう**（比較はパースして行う）
 * - ⚠ `importedAt` が null（＝引き継ぎ無し）なら引き継ぎ由来の行を出さない
 */
describe("ViewerDetailPanel 取り込んだデータの表示（065b）", () => {
  const IMPORTED = {
    importedAt: "2026-08-16T11:31:02Z",
    importedGiftAmount: 1234.5678,
    importedFirstSeenAt: "2024-03-02T12:15:04.000Z",
  } as const;

  it("giftCount / streamCount / activeDays が出る", async () => {
    // ⚠ makeViewer の既定 totalComments は 12 なので、streamCount は別の値にして取り違えを防ぐ。
    mockGet.mockResolvedValue(
      makeDetail(makeViewer({ giftCount: 3, streamCount: 27, activeDays: 8 })),
    );
    render(<ViewerDetailPanel id="twitch:1" onDismiss={vi.fn()} />);

    expect(await screen.findByText("ギフト")).toBeInTheDocument();
    expect(screen.getByText("3 回")).toBeInTheDocument();
    expect(screen.getByText("27")).toBeInTheDocument();
    expect(screen.getByText("8 日")).toBeInTheDocument();
  });

  it("⚠⚠ streamCount / activeDays は近似だとラベル自体で示す（この窓は注記を全廃したため）", async () => {
    mockGet.mockResolvedValue(makeDetail(makeViewer()));
    render(<ViewerDetailPanel id="twitch:1" onDismiss={vi.fn()} />);

    expect(await screen.findByText("参加配信数（概算）")).toBeInTheDocument();
    expect(screen.getByText("参加日数（概算）")).toBeInTheDocument();
    // ⚠ 回数（ギフト）は実測・引き継ぎとも正確なので「概算」を付けない。
    expect(screen.getByText("ギフト")).toBeInTheDocument();
    expect(screen.queryByText("ギフト（概算）")).not.toBeInTheDocument();
  });

  it("⚠⚠ importedGiftAmount に通貨記号が付かず、整数へ丸まる（fmtSuperchat を使っていない担保）", async () => {
    mockGet.mockResolvedValue(
      makeDetail(makeViewer({ ...IMPORTED, superchatCurrency: "JPY" })),
    );
    render(<ViewerDetailPanel id="twitch:1" onDismiss={vi.fn()} />);

    expect(await screen.findByText("インポートしたギフト累計")).toBeInTheDocument();
    const value = screen.getByText("1,235");
    expect(value).toBeInTheDocument();
    expect(value.textContent).not.toMatch(/JPY|円|¥|BITS/);
    // 小数がそのまま出ていないこと（素の toLocaleString だと "1,234.568"）。
    expect(screen.queryByText(/1,234\.568/)).not.toBeInTheDocument();
  });

  it("⚠⚠ 初回来訪はオフセット混在でも古いほうを選ぶ（辞書順だと逆になるケース）", async () => {
    // firstSeenAt = 1786834800000 / importedFirstSeenAt = 1786836544288 で**実測のほうが古い**。
    // ⚠ 文字列比較だと "2026-08-16T…" > "2026-08-15T…" で引き継ぎ側を選んでしまう。
    mockGet.mockResolvedValue(
      makeDetail(
        makeViewer({
          ...IMPORTED,
          firstSeenAt: "2026-08-16T08:00:00+09:00",
          importedFirstSeenAt: "2026-08-15T23:29:04.288Z",
        }),
      ),
    );
    render(<ViewerDetailPanel id="twitch:1" onDismiss={vi.fn()} />);

    expect(await screen.findByText("初回来訪")).toBeInTheDocument();
    const expected = new Date("2026-08-16T08:00:00+09:00").toLocaleString(
      "ja-JP",
    );
    expect(screen.getByText(expected)).toBeInTheDocument();
    // 実測が採られたので「（インポート分）」は出ない。
    expect(screen.queryByText(/（インポート分）/)).not.toBeInTheDocument();
  });

  it("引き継ぎ推定のほうが古ければそれを出し、引き継ぎ由来だと分かる形にする", async () => {
    mockGet.mockResolvedValue(
      makeDetail(
        makeViewer({ ...IMPORTED, firstSeenAt: "2026-08-16T00:00:00Z" }),
      ),
    );
    render(<ViewerDetailPanel id="twitch:1" onDismiss={vi.fn()} />);

    await screen.findByText("初回来訪");
    const expected = new Date(IMPORTED.importedFirstSeenAt).toLocaleString(
      "ja-JP",
    );
    expect(screen.getByText(`${expected}（インポート分）`)).toBeInTheDocument();
  });

  it("⚠ 引き継ぎだけの視聴者（firstSeenAt と importedFirstSeenAt が同値）でも壊れない", async () => {
    mockGet.mockResolvedValue(
      makeDetail(
        makeViewer({
          ...IMPORTED,
          firstSeenAt: "2026-08-15T23:29:04.288Z",
          importedFirstSeenAt: "2026-08-15T23:29:04.288Z",
        }),
      ),
    );
    render(<ViewerDetailPanel id="twitch:1" onDismiss={vi.fn()} />);

    await screen.findByText("初回来訪");
    // 同値なら実測を優先＝「取り込み由来」と主張しない。
    expect(screen.queryByText(/（インポート分）/)).not.toBeInTheDocument();
  });

  it("⚠ importedAt が無い視聴者には引き継ぎの印が出ない", async () => {
    // makeViewer の既定は importedAt 未設定＝引き継ぎ無し。
    mockGet.mockResolvedValue(makeDetail(makeViewer()));
    render(<ViewerDetailPanel id="twitch:1" onDismiss={vi.fn()} />);

    await screen.findByText("初回来訪");
    expect(screen.queryByText("インポート日時")).not.toBeInTheDocument();
    expect(screen.queryByText("インポートしたギフト累計")).not.toBeInTheDocument();
    expect(screen.queryByText(/（インポート分）/)).not.toBeInTheDocument();
  });

  // ⚠⚠ **本番で実際に届くのは `null`**（レビュー Q-1）。binding は `?: string` だが serde に
  //   `skip_serializing_if` が無いので `Option::None` は JSON `null` として送られる。
  //   `!= null` を `!== undefined` へ「厳密化」すると、引き継ぎの無い全視聴者にこの 2 行が出て
  //   `fmtDateTime(null)` が `1970/1/1 9:00:00` を表示する（実測）。
  // ⚠ 型が嘘をついているのでキャストが要る。**キャストを消して型どおりに書き直さないこと**が要点。
  it("⚠⚠ importedAt が null（serde の実出力）でも引き継ぎの印が出ない", async () => {
    mockGet.mockResolvedValue(
      makeDetail(
        makeViewer({
          importedAt: null as unknown as undefined,
          importedFirstSeenAt: null as unknown as undefined,
        }),
      ),
    );
    render(<ViewerDetailPanel id="twitch:1" onDismiss={vi.fn()} />);

    await screen.findByText("初回来訪");
    expect(screen.queryByText("インポート日時")).not.toBeInTheDocument();
    expect(screen.queryByText("インポートしたギフト累計")).not.toBeInTheDocument();
    expect(screen.queryByText(/（インポート分）/)).not.toBeInTheDocument();
    // 1970 へ飛んでいないこと（厳密化したときに最初に出る症状）。
    expect(screen.queryByText(/1970/)).not.toBeInTheDocument();
  });

  it("importedAt があれば引き継ぎ日時を出す", async () => {
    mockGet.mockResolvedValue(makeDetail(makeViewer(IMPORTED)));
    render(<ViewerDetailPanel id="twitch:1" onDismiss={vi.fn()} />);

    expect(await screen.findByText("インポート日時")).toBeInTheDocument();
    expect(
      screen.getByText(new Date(IMPORTED.importedAt).toLocaleString("ja-JP")),
    ).toBeInTheDocument();
  });
});
