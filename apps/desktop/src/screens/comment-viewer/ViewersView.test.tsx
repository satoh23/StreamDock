import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { ViewerRecord, ViewerDetail } from "../../features/viewer-memory/types";

// invoke ラッパ（038a）は全てモックする＝テストは端末外通信も OS 操作も一切しない。
// ⚠⚠ 065b: **ファクトリが返すオブジェクトに ViewersView が import する名前が全部要る。**
//   `importViewerMemoryCsv` を足し忘れると vitest が
//   `No "importViewerMemoryCsv" export is defined on the mock` を投げ、**この 1 行で既存テストが全部落ちる**。
vi.mock("../../features/viewer-memory/viewerMemoryApi", () => ({
  listViewers: vi.fn(),
  getViewer: vi.fn(),
  updateViewerNote: vi.fn(),
  deleteViewer: vi.fn(),
  importViewerMemoryCsv: vi.fn(),
}));

// 065b: ファイル選択ダイアログ。⚠ モック方式は既存（OverlayThemeCard.test.tsx / ObsEffectsScreen.test.tsx）に
//   揃える＝`vi.hoisted` で作った関数を `@tauri-apps/plugin-dialog` の `open` に差す（新方式を発明しない）。
const mocks = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mocks.open }));

import {
  listViewers,
  getViewer,
  updateViewerNote,
  deleteViewer,
  importViewerMemoryCsv,
} from "../../features/viewer-memory/viewerMemoryApi";
import { ViewersView } from "./ViewersView";

const mockList = vi.mocked(listViewers);
const mockGet = vi.mocked(getViewer);
const mockUpdate = vi.mocked(updateViewerNote);
const mockDelete = vi.mocked(deleteViewer);
const mockImport = vi.mocked(importViewerMemoryCsv);

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

const makeDetail = (viewer: ViewerRecord): ViewerDetail => ({
  viewer,
  comments: [],
});

beforeEach(() => {
  mockList.mockResolvedValue([]);
  mockGet.mockResolvedValue(makeDetail(makeViewer()));
  mockUpdate.mockResolvedValue(makeViewer());
  mockDelete.mockResolvedValue(undefined);
  mocks.open.mockReset();
  mockImport.mockReset();
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

/**
 * 065b: 視聴者データ CSV のインポート導線。
 *
 * あるべき挙動（docs/tasks/065b-onecomme-import-ui.md ／ task-board の 065a 申し送り）:
 * - 「視聴者データをインポート」→ **ConfirmDialog** →`open()`→`import_viewer_memory_csv(生パス)`→ 結果 → 一覧再取得
 * - ⚠ **ConfirmDialog を経ずには実行されない**（既存 DB を書き換える操作なのでこの窓の作法に合わせる）
 * - ⚠ ファイル選択をキャンセルしたら command を呼ばない
 * - ⚠⚠ **4 件数を常に全部出す**（`skipped*` が 0 でないとき必ず見える＝黙って一部を落とさない）
 * - ⚠ 取り込み中はボタンが無効（多重実行しない）
 * - ⚠⚠ 失敗時は `AppError.message` を出すが **`details`（ファイル名）は出さない**・`console` にも流さない
 * - ⚠ フルパス・ファイル名を画面に出さない（§9）
 */
describe("ViewersView 視聴者データ CSV のインポート（065b）", () => {
  const CSV_PATH = "/Users/me/Downloads/listeners.csv";
  /**
   * Rust が返す `AppError.message` の**スタンドイン**（レビュー Q-9）。
   * ⚠ **実際の文言をコピーしてはいけない。** コピーすると Rust と frontend の二重管理になり、
   * Rust 側だけ文言が退行してもモックは自分のコピーを返すので**テストは緑のまま通り抜ける**
   * （065a 外部レビュー Q-1 と同じ形）。ここで固定したいのは「Rust の message が消えずに画面へ出て、
   * 一覧の再取得で消えないこと」であって、文言の中身ではない。
   */
  const IMPORT_ERR = "（Rust が返す固定の原因文言）";

  /** 確認ダイアログの「取り込む」まで進める（この導線の唯一の入口）。 */
  const confirmImport = async () => {
    fireEvent.click(
      screen.getByRole("button", { name: "視聴者データをインポート" }),
    );
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "インポート" }));
  };

  it("ConfirmDialog →「取り込む」で、open() が返した生パスのまま import_viewer_memory_csv を呼ぶ", async () => {
    mocks.open.mockResolvedValue(CSV_PATH);
    mockImport.mockResolvedValue({
      imported: 55,
      updated: 6,
      skippedUnsupported: 3,
      skippedInvalid: 2,
    });
    render(<ViewersView onBack={vi.fn()} />);
    await screen.findByText("視聴者はまだいません");

    await confirmImport();

    await waitFor(() => expect(mockImport).toHaveBeenCalledWith(CSV_PATH));
  });

  // ⚠ 実ダイアログの挙動はモックでは踏めないが、**渡している絞り込みが消えたら気づける**ようにする
  //   （レビュー S-2。フィルタ / directory / multiple のどれを外してもテストが緑だった）。
  //   ⚠ これは二次防御であって一次防御ではない——拡張子と `is_file` は Rust が必ず再検証する。
  it("⚠ open() に .csv フィルタ・単一ファイル・非ディレクトリを渡す（二次防御が消えたら気づく）", async () => {
    mocks.open.mockResolvedValue(CSV_PATH);
    mockImport.mockResolvedValue({
      imported: 1,
      updated: 0,
      skippedUnsupported: 0,
      skippedInvalid: 0,
    });
    render(<ViewersView onBack={vi.fn()} />);
    await screen.findByText("視聴者はまだいません");

    await confirmImport();

    await waitFor(() => expect(mocks.open).toHaveBeenCalled());
    expect(mocks.open).toHaveBeenCalledWith(
      expect.objectContaining({
        multiple: false,
        directory: false,
        filters: [{ name: "CSV", extensions: ["csv"] }],
      }),
    );
  });

  it("⚠⚠ ConfirmDialog を経ずには実行されない（ボタンだけでは open() も command も呼ばない）", async () => {
    mocks.open.mockResolvedValue(CSV_PATH);
    render(<ViewersView onBack={vi.fn()} />);
    await screen.findByText("視聴者はまだいません");

    fireEvent.click(
      screen.getByRole("button", { name: "視聴者データをインポート" }),
    );

    // 確認ダイアログは出るが、この時点では何も起きていない。
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(mocks.open).not.toHaveBeenCalled();
    expect(mockImport).not.toHaveBeenCalled();
  });

  it("確認ダイアログでキャンセルしたら何も起きない", async () => {
    mocks.open.mockResolvedValue(CSV_PATH);
    render(<ViewersView onBack={vi.fn()} />);
    await screen.findByText("視聴者はまだいません");

    fireEvent.click(
      screen.getByRole("button", { name: "視聴者データをインポート" }),
    );
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "キャンセル" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(mocks.open).not.toHaveBeenCalled();
    expect(mockImport).not.toHaveBeenCalled();
  });

  it("⚠ ファイル選択をキャンセル（open() が null）したら command を呼ばない", async () => {
    mocks.open.mockResolvedValue(null);
    render(<ViewersView onBack={vi.fn()} />);
    await screen.findByText("視聴者はまだいません");

    await confirmImport();

    await waitFor(() => expect(mocks.open).toHaveBeenCalled());
    expect(mockImport).not.toHaveBeenCalled();
  });

  it("⚠⚠ 4 件数がすべて画面に出る（skipped* が 0 でなくても必ず見える）", async () => {
    mocks.open.mockResolvedValue(CSV_PATH);
    mockImport.mockResolvedValue({
      imported: 55,
      updated: 6,
      skippedUnsupported: 3,
      skippedInvalid: 2,
    });
    render(<ViewersView onBack={vi.fn()} />);
    await screen.findByText("視聴者はまだいません");

    await confirmImport();

    const status = await screen.findByText(/新しく取り込んだ/);
    expect(status).toHaveTextContent("新しく取り込んだ 55 件");
    expect(status).toHaveTextContent("更新した 6 件");
    expect(status).toHaveTextContent("取り込めなかった（未対応サービス）3 件");
    expect(status).toHaveTextContent("取り込めなかった（内容不備）2 件");
  });

  it("⚠ skipped* が 0 のときも 4 件数を出す（「出ていない＝0」と「出し忘れ」を画面上で区別できるように）", async () => {
    // 実機の初回取り込みの実測値（61 名・2026-08-16）。
    mocks.open.mockResolvedValue(CSV_PATH);
    mockImport.mockResolvedValue({
      imported: 61,
      updated: 0,
      skippedUnsupported: 0,
      skippedInvalid: 0,
    });
    render(<ViewersView onBack={vi.fn()} />);
    await screen.findByText("視聴者はまだいません");

    await confirmImport();

    const status = await screen.findByText(/新しく取り込んだ/);
    expect(status).toHaveTextContent("新しく取り込んだ 61 件");
    expect(status).toHaveTextContent("取り込めなかった（未対応サービス）0 件");
    expect(status).toHaveTextContent("取り込めなかった（内容不備）0 件");
  });

  it("取り込みに成功したら一覧を取り直す", async () => {
    mocks.open.mockResolvedValue(CSV_PATH);
    mockImport.mockResolvedValue({
      imported: 61,
      updated: 0,
      skippedUnsupported: 0,
      skippedInvalid: 0,
    });
    render(<ViewersView onBack={vi.fn()} />);
    await screen.findByText("視聴者はまだいません");
    const before = mockList.mock.calls.length;

    await confirmImport();

    await waitFor(() =>
      expect(mockList.mock.calls.length).toBeGreaterThan(before),
    );
  });

  // ⚠ 「成功したときだけ取り直す」という判断そのものを固定する（レビュー Q-7。`loadList()` を
  //   `finally` へ動かす変異がテスト緑のまま通っていた）。取り込みが失敗したら Rust 側は 1 トランザクションで
  //   ロールバックしていて一覧は変わらないので、取り直す理由が無い。
  it("⚠ 取り込みに失敗したら一覧を取り直さない（ロールバック済みで変わらないため）", async () => {
    mocks.open.mockResolvedValue(CSV_PATH);
    mockImport.mockRejectedValue({
      code: "Validation",
      message: "CSV ファイルが大きすぎます。8MB 以内にしてください。",
    });
    render(<ViewersView onBack={vi.fn()} />);
    await screen.findByText("視聴者はまだいません");
    const before = mockList.mock.calls.length;

    await confirmImport();
    await screen.findByText(/大きすぎます/);

    expect(mockList.mock.calls.length).toBe(before);
  });

  it("⚠ 取り込み中はボタンが無効（多重実行しない）", async () => {
    mocks.open.mockResolvedValue(CSV_PATH);
    // 解決しない Promise で「取り込み中」を保持する。
    let settle: (r: {
      imported: number;
      updated: number;
      skippedUnsupported: number;
      skippedInvalid: number;
    }) => void = () => {};
    mockImport.mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );
    render(<ViewersView onBack={vi.fn()} />);
    await screen.findByText("視聴者はまだいません");

    await confirmImport();

    const btn = await screen.findByRole("button", { name: "インポート中…" });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(mockImport).toHaveBeenCalledTimes(1); // 2 回目は走らない

    settle({
      imported: 1,
      updated: 0,
      skippedUnsupported: 0,
      skippedInvalid: 0,
    });
    await screen.findByRole("button", { name: "視聴者データをインポート" });
  });

  // ⚠⚠ **多重実行を塞いでいる本体はモーダルそのもの**（レビュー Q-2）。確認ダイアログを先頭で閉じると
  //   `busy={importing}` が一度も true で描画されない**死んだ prop** になり、外しても誰も気づかなかった。
  //   ⇒ 「取り込みが終わるまでダイアログが処理中のまま残り、終わったら閉じる」を固定する（runDelete と同じ作法）。
  it("⚠⚠ 取り込み中は確認ダイアログが「処理中…」のまま残り、終わったら閉じる", async () => {
    mocks.open.mockResolvedValue(CSV_PATH);
    let settle: (r: {
      imported: number;
      updated: number;
      skippedUnsupported: number;
      skippedInvalid: number;
    }) => void = () => {};
    mockImport.mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );
    render(<ViewersView onBack={vi.fn()} />);
    await screen.findByText("視聴者はまだいません");

    await confirmImport();

    const dialog = await screen.findByRole("dialog");
    const confirm = await within(dialog).findByRole("button", {
      name: "処理中…",
    });
    expect(confirm).toBeDisabled();
    // 誤キャンセルも塞ぐ（busy は両ボタンを無効化する）。
    expect(within(dialog).getByRole("button", { name: "キャンセル" })).toBeDisabled();

    settle({
      imported: 1,
      updated: 0,
      skippedUnsupported: 0,
      skippedInvalid: 0,
    });
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("⚠ ファイル選択をキャンセルしてもダイアログは閉じ、取り込み中表示も戻る", async () => {
    mocks.open.mockResolvedValue(null);
    render(<ViewersView onBack={vi.fn()} />);
    await screen.findByText("視聴者はまだいません");

    await confirmImport();

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(
      await screen.findByRole("button", { name: "視聴者データをインポート" }),
    ).toBeEnabled();
  });

  it("⚠⚠ 失敗時は AppError.message を出すが details（ファイル名）は出さず console にも流さない", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((k) =>
      vi.spyOn(console, k).mockImplementation(() => {}),
    );
    mocks.open.mockResolvedValue(CSV_PATH);
    // ⚠⚠ **Rust の文言を 1 字一句コピーしない**（レビュー Q-9）。完全一致で持つと、それ自体が
    //   「Rust と frontend の二重管理」になり——素通し方式が避けたかったものがテストへ移るだけ——
    //   Rust 側だけ文言が退行しても**このテストは自分のコピーを返すので緑のまま**通り抜ける
    //   （065a 外部レビュー Q-1 とまったく同じ形）。⇒ **その文言が伝えている行動**だけを見る。
    mockImport.mockRejectedValue({
      code: "UnsupportedFileType",
      message: "この CSV には必要な列がありません。（以下、原因と次の行動）",
      // ⚠ util::with_filename_detail が入れるのは**ファイル名**。画面に出してはいけない。
      details: "listeners.csv",
    });
    render(<ViewersView onBack={vi.fn()} />);
    await screen.findByText("視聴者はまだいません");

    await confirmImport();

    expect(
      await screen.findByText(/この CSV には必要な列がありません。/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/listeners\.csv/)).not.toBeInTheDocument();
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    for (const spy of spies) spy.mockRestore();
  });

  it("⚠ message を持たない例外（open() の失敗等）は固定の安全文言に落ちる", async () => {
    // AppError の形をしていない例外。`toErrorMessage` は message も string でもない値を
    // 「予期しないエラーが発生しました」へ落とす＝**未知の中身が画面へ漏れない**ことの担保。
    mocks.open.mockRejectedValue({ code: 500, cause: { path: "/Users/me/x" } });
    render(<ViewersView onBack={vi.fn()} />);
    await screen.findByText("視聴者はまだいません");

    await confirmImport();

    expect(
      await screen.findByText("予期しないエラーが発生しました"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Users\/me/)).not.toBeInTheDocument();
    expect(mockImport).not.toHaveBeenCalled();
  });

  it("⚠⚠ open() が返した生パスを画面に出さない（フルパスもファイル名も・§9）", async () => {
    mocks.open.mockResolvedValue(CSV_PATH);
    mockImport.mockResolvedValue({
      imported: 61,
      updated: 0,
      skippedUnsupported: 0,
      skippedInvalid: 0,
    });
    render(<ViewersView onBack={vi.fn()} />);
    await screen.findByText("視聴者はまだいません");

    await confirmImport();
    await screen.findByText(/新しく取り込んだ/);

    expect(document.body.textContent).not.toContain("listeners.csv");
    expect(document.body.textContent).not.toContain("/Users/me");
  });

  it("⚠ 取り込みのエラーは一覧の再取得（検索・並び替え・更新）で消えない", async () => {
    // ⚠⚠ loadList は先頭で setListError(null) を呼ぶので、取り込みの失敗を listError に載せると
    //   検索や並び替えのたびに黙って消える。器を分けていることの回帰テスト。
    mocks.open.mockResolvedValue(CSV_PATH);
    // ⚠ Rust の文言を完全一致でコピーしない（レビュー Q-9・上の注記が理由）。ここで見たいのは
    //   「Rust が返した message が消えないこと」であって、その中身ではない。
    mockImport.mockRejectedValue({ code: "Validation", message: IMPORT_ERR });
    render(<ViewersView onBack={vi.fn()} />);
    await screen.findByText("視聴者はまだいません");

    await confirmImport();
    expect(await screen.findByText(IMPORT_ERR)).toBeInTheDocument();

    // 並び替えを変えると loadList が走る。
    fireEvent.change(screen.getByLabelText("並び替え"), {
      target: { value: "name" },
    });
    await waitFor(() =>
      expect(mockList).toHaveBeenCalledWith(
        expect.objectContaining({ sort: "name" }),
      ),
    );
    expect(screen.getByText(IMPORT_ERR)).toBeInTheDocument();
  });
});

/**
 * 065b (4): 一覧への新項目。
 *
 * ⚠⚠ **列は足していない**（`.viewerHead` と `.viewerRow` は別グリッドで、列を足すと 7 列すべてを引き直す
 * ことになりヘッダ↔行のズレが再発する）。`nickname` / `label` は**名前セルの中**に置く。
 */
describe("ViewersView 一覧の nickname / label（065b）", () => {
  it("nickname があれば名前と並べて出す（name を置き換えない）", async () => {
    mockList.mockResolvedValue([
      makeViewer({ name: "Takato", nickname: "謎の男" }),
    ]);
    render(<ViewersView onBack={vi.fn()} />);

    expect(await screen.findByText("Takato")).toBeInTheDocument();
    expect(screen.getByText("（謎の男）")).toBeInTheDocument();
  });

  it("label があればバッジで出す", async () => {
    mockList.mockResolvedValue([makeViewer({ name: "Takato", label: "😀" })]);
    render(<ViewersView onBack={vi.fn()} />);

    await screen.findByText("Takato");
    expect(screen.getByText("😀")).toBeInTheDocument();
  });

  // ⚠⚠ **描画順とクラスの割り当てを固定する**（レビュー Q-4。入れ替える変異がどちらも緑で通っていた）。
  //   `.vName` は ellipsis のかかるセルなので**右端ほど消えやすい**＝順序は見た目の優先順位そのもので、
  //   「名前 → ニックネーム → ラベル」という並びは意図した順位づけである。
  //   クラスも意味を持つ: nickname は `.vMuted`（薄い補助表示）、label は 062a の**無彩色**バッジ
  //   `.badgeRaid`（課金のティア配色・初見/久しぶりの判定バッジと色で競合させない）。逆に当てると
  //   「色が付いている＝お金かユーザー判定」という既存の読み方が壊れる。
  it("⚠⚠ 名前セルは「名前 → ニックネーム → ラベル」の順で、クラスの役割も入れ替わらない", async () => {
    mockList.mockResolvedValue([
      makeViewer({ name: "Takato", nickname: "謎の男", label: "常連" }),
    ]);
    const { container } = render(<ViewersView onBack={vi.fn()} />);

    await screen.findByText("Takato");
    const cell = screen.getByText("（謎の男）").parentElement;
    expect(cell?.textContent).toBe("Takato（謎の男）常連");

    // ニックネームは薄い補助表示、ラベルは無彩色バッジ（CSS Modules はクラス名を含む識別子へ変換される）。
    const nickname = screen.getByText("（謎の男）");
    const label = screen.getByText("常連");
    expect(nickname.className).toMatch(/vMuted/);
    expect(nickname.className).not.toMatch(/badge/);
    expect(label.className).toMatch(/badge/);
    expect(label.className).toMatch(/badgeRaid/);
    // 列は増えていない（`.viewerHead` と `.viewerRow` は別グリッドなので、増やすとヘッダ↔行がズレる）。
    expect(container.querySelectorAll('[class*="viewerRow"] > *')).toHaveLength(
      7,
    );
  });

  // ⚠⚠ **3 つを `.vName` の中へ戻す退行を殺す**（レビュー Q-4）。初版は名前・ニックネーム・ラベルを
  //   すべて `.vName`（ellipsis を持つブロック）の**中のインライン要素**として並べていたため、
  //   名前が長いと後ろの 2 つが省略記号に飲まれて消えていた。⇒ 器（`.vNameCell`）に分け、
  //   `.vName` は**名前だけ**を包む形にした。⚠ jsdom は省略表示を再現しないので、ここで見られるのは
  //   **構造だけ**である（縮まないこと自体は `check-css-guards.mjs` の (1-c) が担保する）。
  it("⚠⚠ 名前だけが .vName に入り、ニックネーム・ラベルは器の兄弟として並ぶ（省略に飲まれない構造）", async () => {
    mockList.mockResolvedValue([
      makeViewer({ name: "Takato", nickname: "謎の男", label: "常連" }),
    ]);
    render(<ViewersView onBack={vi.fn()} />);

    const name = await screen.findByText("Takato");
    // .vName が包むのは名前そのものだけ（ニックネームもラベルも中に入っていない）。
    expect(name.className).toMatch(/vName/);
    expect(name.className).not.toMatch(/vNameCell/);
    expect(name.textContent).toBe("Takato");

    // 3 つは同じ器の直接の子で、器は .vName ではない。
    const cell = name.parentElement;
    expect(cell?.className).toMatch(/vNameCell/);
    expect(cell?.children).toHaveLength(3);
    expect(screen.getByText("（謎の男）").parentElement).toBe(cell);
    expect(screen.getByText("常連").parentElement).toBe(cell);
  });

  it("⚠ nickname / label が空文字なら何も出さない（括弧だけ・空バッジを出さない）", async () => {
    mockList.mockResolvedValue([
      makeViewer({ name: "Takato", nickname: "", label: "" }),
    ]);
    render(<ViewersView onBack={vi.fn()} />);

    await screen.findByText("Takato");
    expect(screen.queryByText("（）")).not.toBeInTheDocument();
    // 名前セルは名前だけ（余計な括弧やバッジが増えていない）。
    expect(screen.getByText("Takato").textContent).toBe("Takato");
  });
});
