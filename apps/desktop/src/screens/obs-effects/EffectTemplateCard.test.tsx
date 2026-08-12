import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import type { EffectTemplateRecord } from "../../features/obs-effects/bindings/EffectTemplateRecord";
import type { EffectTemplateMedia } from "../../features/obs-effects/bindings/EffectTemplateMedia";

/**
 * 061d-1: テンプレートの取り込み・一覧・削除・プレビューの仕様テスト。
 *
 * ⚠⚠ 固定したい不変条件:
 * - **「テンプレート専用のフォルダを選んでください」の案内が出ている**
 *   （061c security-review S-3 の**唯一の緩和策**。Rust 側では構造的に塞げない）。
 * - **取り込み直後にプレビューが自動で開く**（同上）。
 * - ⚠⚠ **プレビューがエフェクト窓へ出ない**——窓を開くコマンドを呼ばず、
 *   エフェクト窓向けの localStorage キーへ 1 バイトも書かない。
 * - **`safeEffectMedia` を通す**（`data:` 以外は描かない）。
 * - **プレビューの音は既定 OFF**＝`<audio>` 要素が DOM に存在しない。
 * - 削除は確認を挟む。
 *
 * 外部境界（Tauri invoke / dialog）は全てモックして隔離する。
 * **テストは外部通信も OS 操作も一切行わない。**
 */

const mocks = vi.hoisted(() => ({
  open: vi.fn(async (): Promise<string | null> => null),
  listEffectTemplates: vi.fn(async (): Promise<EffectTemplateRecord[]> => []),
  importEffectTemplate: vi.fn(),
  getEffectTemplateMedia: vi.fn(),
  deleteEffectTemplate: vi.fn(async () => {}),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mocks.open }));
vi.mock("../../features/obs-effects/effectTemplateApi", () => ({
  listEffectTemplates: mocks.listEffectTemplates,
  importEffectTemplate: mocks.importEffectTemplate,
  getEffectTemplateMedia: mocks.getEffectTemplateMedia,
  deleteEffectTemplate: mocks.deleteEffectTemplate,
}));

import { EffectTemplateCard } from "./EffectTemplateCard";
import { useEffectTemplates } from "./useEffectTemplates";

/**
 * ⚠⚠ **061d-2 で `EffectTemplateCard` が state を持たなくなった**（061d-1 レビュー Q-9 の分割）。
 * state は `useEffectTemplates`、プレビューは `EffectTemplatePreview` にある。
 *
 * ⚠ **hook をモックせず、本物を組み合わせて描く。** ここで見たいのは
 * 「ユーザーが取り込みボタンを押すと何が起きるか」という**画面の振る舞い**で、
 * hook を差し替えると **分割の継ぎ目そのもの**（＝ 061d-2 で新しく壊れうる箇所）が検査されない。
 * 外部境界（Tauri invoke / dialog）は上でモック済みなので、これでも実 I/O は 1 つも起きない。
 */
function Harness() {
  const templates = useEffectTemplates();
  return <EffectTemplateCard {...templates} />;
}

const record = (over: Partial<EffectTemplateRecord> = {}): EffectTemplateRecord => ({
  id: "t1",
  name: "きらきら演出",
  durationMs: 5000,
  layout: { anchor: "center", offsetX: 0, offsetY: 0, width: 480, height: 240 },
  text: {
    template: "{name}さんが{amount}",
    templateWithoutAmount: "{message}",
    anchor: "bottom",
    fontSize: 32,
  },
  hasSound: false,
  createdAt: "2026-08-11T00:00:00Z",
  updatedAt: "2026-08-11T00:00:00Z",
  ...over,
});

const PNG: EffectTemplateMedia = {
  media: "data:image/png;base64,iVBORw0KGgo=",
  sound: null,
};

/** ⚠ PNG と**別の値**であることが要点（どちらのプレビューが出ているかを src で見分けるため）。 */
const GIF: EffectTemplateMedia = {
  media: "data:image/gif;base64,R0lGODlhAQABAAAAACw=",
  sound: null,
};

describe("EffectTemplateCard", () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.open.mockResolvedValue(null);
    mocks.listEffectTemplates.mockResolvedValue([]);
    mocks.getEffectTemplateMedia.mockResolvedValue(PNG);
    mocks.deleteEffectTemplate.mockResolvedValue(undefined);
  });

  afterEach(() => {
    localStorage.clear();
  });

  // --- S-3 の緩和策 ---------------------------------------------------------------------------

  it("⚠⚠ 「テンプレート専用のフォルダを選んでください」の案内が出ている（S-3 の緩和策）", async () => {
    render(<Harness />);
    // ⚠ この文言を消す変異はここで赤くなる。Rust 側では塞げないので、UI がただ 1 つの防波堤。
    // ⚠⚠ **3 文を独立に固定する**（061d-1 レビュー S-1）。当初は 1 文目と 3 文目だけを見ており、
    //   「なぜ専用フォルダが要るか」を説明する 2 文目を削る変異が**生存していた**（実測）。
    //   理由が消えると、残る 2 文は根拠のない指示に劣化する。
    expect(
      screen.getByText(/テンプレート専用のフォルダを選んでください/),
    ).toBeTruthy();
    expect(
      screen.getByText(
        /ダウンロードフォルダなど、他のファイルが入っている場所を選ぶと、意図しない画像が配信画面に出ることがあります/,
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(/取り込んだ直後にプレビューが出るので、必ず内容を確認してください/),
    ).toBeTruthy();
  });

  it("⚠ StreamDock 形式だけを扱うことを明示する（親 061 の決定）", () => {
    render(<Harness />);
    expect(screen.getByText(/HTML\s*エフェクトは読み込めません/)).toBeTruthy();
  });

  it("⚠⚠ 取り込み直後にプレビューが自動で開く（S-3 の緩和策）", async () => {
    mocks.open.mockResolvedValue("/Users/me/templates/kirakira");
    mocks.importEffectTemplate.mockResolvedValue(record());
    mocks.listEffectTemplates.mockResolvedValue([record()]);

    render(<Harness />);
    fireEvent.click(screen.getByText("フォルダを選んで取り込む"));

    await waitFor(() => {
      expect(screen.getByTestId("effect-template")).toBeTruthy();
    });
    expect(mocks.getEffectTemplateMedia).toHaveBeenCalledWith("t1");
  });

  it("⚠⚠ 一覧の再取得に失敗しても、取り込み直後のプレビューは必ず出る（S-3 を一覧に巻き込まない）", async () => {
    // ⚠ 061d-1 レビュー S-2(a)。プレビュー対象を `templates.find` から導出していると、
    //   `reload()` がこけただけで**枠が無言の空になる**＝唯一の緩和策が fail-open する。
    //   `importEffectTemplate` が返した record をそのまま使うので、一覧の成否に依存しない。
    mocks.open.mockResolvedValue("/Users/me/templates/kirakira");
    mocks.importEffectTemplate.mockResolvedValue(record());
    // 初回（マウント時）の一覧は成功、取り込み後の再取得だけ失敗させる。
    mocks.listEffectTemplates
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error("db locked"));

    render(<Harness />);
    fireEvent.click(screen.getByText("フォルダを選んで取り込む"));

    await screen.findByTestId("effect-template");
    expect(mocks.getEffectTemplateMedia).toHaveBeenCalledWith("t1");
    // ⚠ 一覧が失敗した事実は事実として出す（黙らない・§9 のとおり詳細は出さない）。
    expect(
      await screen.findByText(/テンプレートの一覧を読み込めませんでした/),
    ).toBeTruthy();
    expect(screen.queryByText(/db locked/)).toBeNull();
  });

  it("⚠⚠ 再取得した一覧にまだ新しい record が載っていなくても、取り込み直後のプレビューは閉じない", async () => {
    // ⚠⚠ **061d-2 の回帰**。プレビューを閉じる条件を「一覧に無くなったら」にすると、
    //   取り込みは「record を受け取る → 一覧を取り直す」の順なので、
    //   **一覧がまだ新しい record を返さない一瞬で、開いたばかりのプレビューが閉じられる**
    //   ＝ 061c S-3 の唯一の緩和策が、削除とは無関係な理由で fail-open する。
    //   いまは**削除という明示的な出来事だけ**を見て閉じている。
    mocks.open.mockResolvedValue("/Users/me/templates/kirakira");
    mocks.importEffectTemplate.mockResolvedValue(record({ id: "t2" }));
    // ⚠ 一覧は成功するが、**新しい record を含まない**（レプリカ遅延・読めない行の取りこぼし等）。
    mocks.listEffectTemplates.mockResolvedValue([record({ id: "t1" })]);

    render(<Harness />);
    await screen.findByText("きらきら演出");
    fireEvent.click(screen.getByText("フォルダを選んで取り込む"));

    await waitFor(() => {
      expect(mocks.getEffectTemplateMedia).toHaveBeenCalledWith("t2");
    });
    expect(screen.getByTestId("effect-template")).toBeTruthy();
  });

  it("ディレクトリ選択をキャンセルすると取り込まない", async () => {
    mocks.open.mockResolvedValue(null);
    render(<Harness />);
    fireEvent.click(screen.getByText("フォルダを選んで取り込む"));
    await waitFor(() => {
      expect(mocks.open).toHaveBeenCalled();
    });
    expect(mocks.importEffectTemplate).not.toHaveBeenCalled();
  });

  it("⚠ 取り込みは open({ directory: true }) で選んだ生パスをそのまま渡す", async () => {
    mocks.open.mockResolvedValue("/Users/me/My Templates/きらきら");
    mocks.importEffectTemplate.mockResolvedValue(record());
    render(<Harness />);
    fireEvent.click(screen.getByText("フォルダを選んで取り込む"));
    await waitFor(() => {
      expect(mocks.importEffectTemplate).toHaveBeenCalledWith(
        "/Users/me/My Templates/きらきら",
      );
    });
    expect(mocks.open).toHaveBeenCalledWith(
      expect.objectContaining({ directory: true, multiple: false }),
    );
  });

  // --- プレビューが配信へ漏れないこと ------------------------------------------------------------

  it("⚠⚠ プレビューはエフェクト窓へ出ない（窓を開かない・エフェクト窓向けのキーへ書かない）", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    mocks.listEffectTemplates.mockResolvedValue([record()]);

    render(<Harness />);
    await screen.findByText("きらきら演出");
    fireEvent.click(screen.getByText("プレビュー"));
    await screen.findByTestId("effect-template");

    // ⚠ この module は窓を開くコマンドもテスト発火も import していない（＝呼びようがない）。
    //   ここでは「localStorage を通ってエフェクト窓へ届く経路を作っていない」を観測可能な形で固定する。
    // ⚠⚠ **`for` ループだけにしない**（061d-1 レビュー P-2）——setItem が 0 回だと
    //   ループ本体が 1 度も走らず**自明に通る**（vacuous truth）ので、「1 バイトも書かない」ことを
    //   `not.toHaveBeenCalled()` で直接主張する。ループはキー名を落とさないための二重目として残す。
    expect(setItem).not.toHaveBeenCalled();
    for (const call of setItem.mock.calls) {
      expect(String(call[0])).not.toMatch(/^stream-dock\.comment-viewer\.effect-/);
    }
    setItem.mockRestore();
  });

  // --- 描画ガード -------------------------------------------------------------------------------

  it("⚠⚠ `data:` 以外のメディアは描かず「表示できません」と出す（safeEffectMedia を通す）", async () => {
    mocks.listEffectTemplates.mockResolvedValue([record()]);
    mocks.getEffectTemplateMedia.mockResolvedValue({
      media: "http://evil.example/x.png",
      sound: null,
    });

    render(<Harness />);
    await screen.findByText("きらきら演出");
    fireEvent.click(screen.getByText("プレビュー"));

    await screen.findByText(/このテンプレートのメディアは表示できません/);
    expect(screen.queryByTestId("effect-template")).toBeNull();
    expect(document.querySelector('img[src^="http"]')).toBeNull();
  });

  it("⚠⚠ メディアがデコードできなかったら「読み込めませんでした」と出す（無言の空にしない）", async () => {
    // ⚠ 061d-1 レビュー S-2(b)。ガードを通った data URI でもデコードは失敗しうる
    //   （マジックバイトは通るが途中で切れた WebM / APNG 等）。`onMediaError` を渡していないと
    //   **枠が無言で空になり**、ユーザーは「確認した」と誤認する。
    mocks.listEffectTemplates.mockResolvedValue([record()]);
    render(<Harness />);
    await screen.findByText("きらきら演出");
    fireEvent.click(screen.getByText("プレビュー"));

    const view = await screen.findByTestId("effect-template");
    const img = view.querySelector("img");
    if (img === null) throw new Error("img not rendered");
    fireEvent.error(img);

    expect(
      await screen.findByText(/テンプレートのメディアを読み込めませんでした/),
    ).toBeTruthy();
    expect(screen.queryByTestId("effect-template")).toBeNull();
  });

  it("⚠ プレビューを素早く切り替えても、遅れて来た古い応答が新しい表示を上書きしない", async () => {
    // ⚠ 061d-1 レビュー Q-4 / MX1。`useEffect` の `cancelled` ガードを丸ごと外す変異が生存していた。
    //   t1 の取得を保留したまま t2 へ切り替え、あとから t1 を解決して**無視される**ことを見る。
    mocks.listEffectTemplates.mockResolvedValue([
      record({ id: "t1", name: "きらきら演出" }),
      record({ id: "t2", name: "紙吹雪" }),
    ]);
    // ⚠ `let` + narrowing を避けるためオブジェクト越しに resolve を持つ。
    const pending: { resolve: (m: EffectTemplateMedia) => void } = {
      resolve: () => {},
    };
    mocks.getEffectTemplateMedia.mockImplementation((id: string) =>
      id === "t1"
        ? new Promise<EffectTemplateMedia>((r) => {
            pending.resolve = r;
          })
        : Promise.resolve(GIF),
    );

    render(<Harness />);
    await screen.findByText("きらきら演出");
    fireEvent.click(screen.getAllByText("プレビュー")[0]); // t1（保留のまま）
    fireEvent.click(screen.getAllByText("プレビュー")[1]); // t2（即座に解決）

    const view = await screen.findByTestId("effect-template");
    expect(view.querySelector("img")?.getAttribute("src")).toBe(GIF.media);

    // 遅れて t1 が返る → 破棄済みなので表示は t2 のまま。
    pending.resolve(PNG);
    await waitFor(() => {
      expect(screen.getByTestId("effect-template")).toBeTruthy();
    });
    expect(
      screen.getByTestId("effect-template").querySelector("img")?.getAttribute("src"),
    ).toBe(GIF.media);
  });

  it("メディアの取得に失敗したら「読み込めませんでした」と出す（無言で消えない）", async () => {
    mocks.listEffectTemplates.mockResolvedValue([record()]);
    mocks.getEffectTemplateMedia.mockRejectedValue(new Error("boom"));

    render(<Harness />);
    await screen.findByText("きらきら演出");
    fireEvent.click(screen.getByText("プレビュー"));

    await screen.findByText(/テンプレートのメディアを読み込めませんでした/);
  });

  // --- プレビューの音 ---------------------------------------------------------------------------

  it("⚠⚠ プレビューの音は既定 OFF＝`<audio>` 要素が DOM に無い", async () => {
    mocks.listEffectTemplates.mockResolvedValue([record({ hasSound: true })]);
    mocks.getEffectTemplateMedia.mockResolvedValue({
      media: PNG.media,
      sound: "data:audio/wav;base64,UklGRg==",
    });

    render(<Harness />);
    await screen.findByText("きらきら演出");
    fireEvent.click(screen.getByText("プレビュー"));
    await screen.findByTestId("effect-template");

    expect(screen.queryByTestId("effect-preview-sound")).toBeNull();
    // ⚠ 配信に載りうることをユーザーへ明示している。
    expect(screen.getByText(/配信にも流れます/)).toBeTruthy();
  });

  it("トグルを ON にすると `<audio>` が置かれる（音源も data: だけ）", async () => {
    mocks.listEffectTemplates.mockResolvedValue([record({ hasSound: true })]);
    mocks.getEffectTemplateMedia.mockResolvedValue({
      media: PNG.media,
      sound: "data:audio/wav;base64,UklGRg==",
    });

    render(<Harness />);
    await screen.findByText("きらきら演出");
    fireEvent.click(screen.getByText("プレビュー"));
    await screen.findByTestId("effect-template");

    fireEvent.click(screen.getByRole("switch", { name: "プレビューの音を鳴らす" }));
    const audio = await screen.findByTestId("effect-preview-sound");
    expect(audio.getAttribute("src")).toBe("data:audio/wav;base64,UklGRg==");
  });

  it("⚠⚠ プレビューを開き直すと音は必ず OFF へ戻る（既定 OFF を担保しているのはこの reset）", async () => {
    // ⚠ `useState(false)` の初期値だけでは担保にならない——プレビューが開いていない間は誰も
    //   `previewSound` を読まないので、初期値を true へ変える変異は**振る舞いを変えない**
    //   （equivalent mutant・実測）。実際に効いているのは `previewId` の `useEffect` が毎回行う
    //   `setPreviewSound(false)` で、それを固定するのがこのケース。
    mocks.listEffectTemplates.mockResolvedValue([
      record({ id: "t1", name: "きらきら演出", hasSound: true }),
      record({ id: "t2", name: "紙吹雪", hasSound: true }),
    ]);
    mocks.getEffectTemplateMedia.mockResolvedValue({
      media: PNG.media,
      sound: "data:audio/wav;base64,UklGRg==",
    });

    render(<Harness />);
    const rows = await screen.findAllByText("プレビュー");
    fireEvent.click(rows[0]);
    await screen.findByTestId("effect-template");
    fireEvent.click(screen.getByRole("switch", { name: "プレビューの音を鳴らす" }));
    await screen.findByTestId("effect-preview-sound");

    // 別のテンプレートをプレビューし直す → 音は OFF に戻っている。
    fireEvent.click(screen.getAllByText("プレビュー")[1]);
    // ⚠⚠ **新しいプレビューが ready になるまで待ってから** `<audio>` の不在を主張する
    //   （061d-1 レビュー Q-4）。切り替え直後は `previewState` が一瞬 "loading" になり
    //   `<audio>` のゲート（`previewState === "ready"`）が閉じるので、待たずに書くと
    //   **`previewSound` の値に関係なく即座に通る**＝ reset を外す変異を殺せない。
    await screen.findByTestId("effect-template");
    expect(screen.queryByTestId("effect-preview-sound")).toBeNull();
    expect(
      screen.getByRole("switch", { name: "プレビューの音を鳴らす" }).getAttribute("aria-checked"),
    ).toBe("false");
  });

  it("⚠ 音源を持たないテンプレートでは、音のトグルも「配信にも流れます」の注意文も出さない", async () => {
    // ⚠ `hasSound` のゲートを外す変異が生存していた（061d-1 レビュー Q-4 / MX4）。
    //   鳴らせない相手に「音を鳴らす」トグルを出すと、押しても何も起きない導線ができる。
    mocks.listEffectTemplates.mockResolvedValue([record({ hasSound: false })]);
    render(<Harness />);
    await screen.findByText("きらきら演出");
    fireEvent.click(screen.getByText("プレビュー"));
    await screen.findByTestId("effect-template");

    expect(
      screen.queryByRole("switch", { name: "プレビューの音を鳴らす" }),
    ).toBeNull();
    expect(screen.queryByText(/配信にも流れます/)).toBeNull();
  });

  it("⚠ 音源が `data:` 以外なら鳴らさない（メディアは出す）", async () => {
    mocks.listEffectTemplates.mockResolvedValue([record({ hasSound: true })]);
    mocks.getEffectTemplateMedia.mockResolvedValue({
      media: PNG.media,
      sound: "http://evil.example/x.mp3",
    });

    render(<Harness />);
    await screen.findByText("きらきら演出");
    fireEvent.click(screen.getByText("プレビュー"));
    await screen.findByTestId("effect-template");

    fireEvent.click(screen.getByRole("switch", { name: "プレビューの音を鳴らす" }));
    expect(screen.queryByTestId("effect-preview-sound")).toBeNull();
  });

  // --- 一覧と削除 -------------------------------------------------------------------------------

  it("一覧に名前・秒数・音の有無が出る（⚠ ファイル名は出ない／出せない）", async () => {
    mocks.listEffectTemplates.mockResolvedValue([
      record({ durationMs: 3000, hasSound: true }),
    ]);
    render(<Harness />);
    await screen.findByText("きらきら演出");
    expect(screen.getByText("3.0秒・音あり")).toBeTruthy();
  });

  it("⚠ 秒数が壊れていても一覧は落ちず「—」へ劣化する", async () => {
    // `durationLabel` は「壊れ値は握りつぶす（一覧が落ちるより『—』のほうがよい）」という劣化仕様。
    // ⚠ Rust が 500〜15000 に検証済みなので通常来ないが、IPC 境界の内側なので型を信じ切らない。
    mocks.listEffectTemplates.mockResolvedValue([
      record({ durationMs: Number.NaN as unknown as number }),
    ]);
    render(<Harness />);
    await screen.findByText("きらきら演出");
    expect(screen.getByText("—")).toBeTruthy();
  });

  it("⚠ テンプレート名に HTML を入れても *テキストとして* 出る", async () => {
    mocks.listEffectTemplates.mockResolvedValue([
      record({ name: "<img src=x onerror=alert(1)>" }),
    ]);
    render(<Harness />);
    expect(await screen.findByText("<img src=x onerror=alert(1)>")).toBeTruthy();
    expect(document.querySelectorAll("img")).toHaveLength(0);
  });

  it("削除は確認を挟む（確認前は削除しない）", async () => {
    mocks.listEffectTemplates.mockResolvedValue([record()]);
    render(<Harness />);
    await screen.findByText("きらきら演出");

    fireEvent.click(screen.getByText("削除"));
    expect(screen.getByText("テンプレートを削除しますか？")).toBeTruthy();
    expect(mocks.deleteEffectTemplate).not.toHaveBeenCalled();

    // ⚠ 一覧の行にも「削除」があるので、ダイアログの中に絞って押す。
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "削除" }));
    await waitFor(() => {
      expect(mocks.deleteEffectTemplate).toHaveBeenCalledWith("t1");
    });
  });

  it("⚠ プレビュー中のテンプレートを削除するとプレビューも閉じる", async () => {
    // ⚠ 061d-1 レビュー Q-4 / MX2。閉じないと、消えた id の取り直しに失敗して
    //   「読み込めませんでした」が出るだけの枠が残る。
    mocks.listEffectTemplates.mockResolvedValue([record()]);
    render(<Harness />);
    await screen.findByText("きらきら演出");
    fireEvent.click(screen.getByText("プレビュー"));
    await screen.findByTestId("effect-template");

    mocks.listEffectTemplates.mockResolvedValue([]);
    fireEvent.click(screen.getByText("削除"));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "削除" }));

    await waitFor(() => {
      expect(mocks.deleteEffectTemplate).toHaveBeenCalledWith("t1");
    });
    await waitFor(() => {
      expect(screen.queryByText(/プレビュー（配信画面には出ていません）/)).toBeNull();
    });
    expect(screen.queryByTestId("effect-template")).toBeNull();
  });

  it("確認をキャンセルすると削除しない", async () => {
    mocks.listEffectTemplates.mockResolvedValue([record()]);
    render(<Harness />);
    await screen.findByText("きらきら演出");

    fireEvent.click(screen.getByText("削除"));
    fireEvent.click(screen.getByText("キャンセル"));
    expect(mocks.deleteEffectTemplate).not.toHaveBeenCalled();
    expect(screen.queryByText("テンプレートを削除しますか？")).toBeNull();
  });

  it("一覧が読めないときは、その事実だけを出す（詳細は出さない・§9）", async () => {
    mocks.listEffectTemplates.mockRejectedValue(new Error("db locked"));
    render(<Harness />);
    expect(
      await screen.findByText(/テンプレートの一覧を読み込めませんでした/),
    ).toBeTruthy();
    expect(screen.queryByText(/db locked/)).toBeNull();
  });

  it("0 件のときは空であることを伝える", async () => {
    render(<Harness />);
    expect(
      await screen.findByText("取り込んだテンプレートはまだありません。"),
    ).toBeTruthy();
  });
});
