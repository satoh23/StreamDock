import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { EFFECT_ASSIGNMENTS_KEY } from "../../features/comment-viewer/overlaySettings";
import type { EffectTemplateRecord } from "../../features/obs-effects/bindings/EffectTemplateRecord";
import { MONETARY_EVENT_TYPES } from "../comment-viewer/viewerFormat";

/**
 * 061d-2: イベント種別ごとの割り当て UI の仕様テスト。
 *
 * ⚠⚠ 固定したい不変条件:
 * - **行は `MONETARY_EVENT_TYPES` から機械的に作られる**（「条件を追加」ボタンを作らない・
 *   7 種別目が増えたら行も増える）。
 * - ⚠⚠ **実在しないテンプレート id は「組み込み」として表示し、警告を出す**（⑪。**「なし」ではない**）。
 * - ⚠⚠ **「すべての割り当てを解除（組み込みに戻す）」が動く**——壊れたテンプレートで配信画面が
 *   読めなくなったときの**唯一の脱出路**（エフェクト窓は透過・最背面・非フォーカスで操作できない）。
 * - **テンプレート削除で、それを使っている割り当てが組み込みへ戻る**＋確認文にその旨が出る。
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

import { EffectAssignmentCard } from "./EffectAssignmentCard";
import { EffectTemplateCard } from "./EffectTemplateCard";
import { useEffectTemplates } from "./useEffectTemplates";

const TEMPLATE_ID = "93c76e02-1111-4222-8333-444455556666";
const TEMPLATE_ID2 = "0f0e0d0c-1111-4222-8333-444455556666";
const MISSING_ID = "ffffffff-1111-4222-8333-444455556666";

const record = (
  over: Partial<EffectTemplateRecord> = {},
): EffectTemplateRecord => ({
  id: TEMPLATE_ID,
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

/**
 * ⚠ **hook をモックしない。** 「削除すると割り当てが組み込みへ戻る」は
 * **一覧と割り当てが 1 つの hook を共有していること**そのものが仕様なので、
 * 差し替えるとその継ぎ目（＝061d-2 で新しく壊れうる箇所）が検査されない。
 */
function Harness() {
  const templates = useEffectTemplates();
  return (
    <>
      <EffectTemplateCard {...templates} />
      <EffectAssignmentCard {...templates} />
    </>
  );
}

/** 割り当ての `<select>` を種別のラベルで引く。 */
const selectFor = (label: string) =>
  screen.getByLabelText(`${label}のエフェクト`) as HTMLSelectElement;

const stored = (): Record<string, { kind: string; templateId?: string }> =>
  JSON.parse(localStorage.getItem(EFFECT_ASSIGNMENTS_KEY) ?? "{}");

describe("EffectAssignmentCard", () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.listEffectTemplates.mockResolvedValue([record()]);
    mocks.deleteEffectTemplate.mockResolvedValue(undefined);
  });
  afterEach(() => localStorage.clear());

  // --- 行の集合 ---------------------------------------------------------------------------------

  it("⚠⚠ 行は課金イベント種別ぶん最初から全部ある（「条件を追加」ボタンを作らない）", async () => {
    render(<Harness />);
    await waitFor(() =>
      expect(mocks.listEffectTemplates).toHaveBeenCalledTimes(1),
    );
    const selects = screen.getAllByRole("combobox");
    // ⚠ `MONETARY_EVENT_TYPES` に 7 種別目が増えたら、この件数も自動で増える（行の作り方が機械的）。
    expect(selects).toHaveLength(MONETARY_EVENT_TYPES.size);
    expect(screen.queryByRole("button", { name: /条件を追加/ })).toBeNull();
  });

  it("⚠⚠ スーパーチャットの行は「ビッツ」も含むと書く（wire 上 superchat で届くため）", async () => {
    render(<Harness />);
    await waitFor(() =>
      expect(mocks.listEffectTemplates).toHaveBeenCalledTimes(1),
    );
    expect(screen.getByText("スーパーチャット・ビッツ")).toBeInTheDocument();
  });

  it("選択肢は「エフェクトを出さない」「組み込み（名前と金額）」＋テンプレート名", async () => {
    render(<Harness />);
    await waitFor(() =>
      expect(mocks.listEffectTemplates).toHaveBeenCalledTimes(1),
    );
    const options = Array.from(
      selectFor("スーパーチャット・ビッツ").options,
    ).map((o) => o.textContent);
    expect(options).toEqual([
      "エフェクトを出さない",
      "組み込み（名前と金額）",
      "きらきら演出",
    ]);
  });

  // --- 既定と保存 -------------------------------------------------------------------------------

  it("⚠⚠ 未保存の既定は全種別「組み込み」（全「なし」だと既存ユーザーのエフェクトが黙って止まる）", async () => {
    render(<Harness />);
    await waitFor(() =>
      expect(mocks.listEffectTemplates).toHaveBeenCalledTimes(1),
    );
    for (const select of screen.getAllByRole("combobox")) {
      expect((select as HTMLSelectElement).value).toBe("builtin");
    }
  });

  it("テンプレートを選ぶと保存される", async () => {
    render(<Harness />);
    await waitFor(() =>
      expect(mocks.listEffectTemplates).toHaveBeenCalledTimes(1),
    );
    fireEvent.change(selectFor("スーパーチャット・ビッツ"), {
      target: { value: `template:${TEMPLATE_ID}` },
    });
    expect(stored().superchat).toEqual({
      kind: "template",
      templateId: TEMPLATE_ID,
    });
  });

  it("「エフェクトを出さない」を選ぶと保存される", async () => {
    render(<Harness />);
    await waitFor(() =>
      expect(mocks.listEffectTemplates).toHaveBeenCalledTimes(1),
    );
    fireEvent.change(selectFor("サブスク"), { target: { value: "none" } });
    expect(stored().subscription).toEqual({ kind: "none" });
  });

  // --- ⑪: 実在しない id ------------------------------------------------------------------------

  it("⚠⚠ 実在しないテンプレート id の行は「組み込み」として表示し、警告を出す（「なし」ではない）", async () => {
    localStorage.setItem(
      EFFECT_ASSIGNMENTS_KEY,
      JSON.stringify({
        superchat: { kind: "template", templateId: MISSING_ID },
      }),
    );
    render(<Harness />);
    await waitFor(() =>
      expect(mocks.listEffectTemplates).toHaveBeenCalledTimes(1),
    );
    // ⚠⚠ **「なし」へ倒す変異はこの 1 行がレッドにする。**
    expect(selectFor("スーパーチャット・ビッツ").value).toBe("builtin");
    expect(
      screen.getByText(/割り当てていたテンプレートが見つかりません/),
    ).toBeInTheDocument();
  });

  it("⚠⚠ 一覧が届く前の一瞬にも「見つかりません」と言わない（レビュー S-1・点滅の防止）", async () => {
    // ⚠ 仕様: 一覧は非同期に届く。**最初の描画では必ず `listState === "loading"`** なので、
    //   ここで警告を出すと**画面を開くたびに一瞬だけ嘘が出る**（ユーザーには「消えた」と見える）。
    //   ⚠ `await` せずに**同期的に**見るのが要点——待ってしまうと点滅は観測できない。
    localStorage.setItem(
      EFFECT_ASSIGNMENTS_KEY,
      JSON.stringify({
        superchat: { kind: "template", templateId: TEMPLATE_ID },
      }),
    );
    render(<Harness />);
    expect(screen.queryByText(/割り当てていたテンプレートが見つかりません/)).toBeNull();
    // 一覧が届いたあとも（実在する id なので）出ない。
    await waitFor(() =>
      expect(mocks.listEffectTemplates).toHaveBeenCalledTimes(1),
    );
    expect(screen.queryByText(/割り当てていたテンプレートが見つかりません/)).toBeNull();
    expect(selectFor("スーパーチャット・ビッツ").value).toBe(
      `template:${TEMPLATE_ID}`,
    );
  });

  it("⚠⚠ 一覧が読めていないときは「見つかりません」と言わない（レビュー S-1）", async () => {
    // ⚠ 一覧の取得に失敗した状態＝ `templates` は空のまま。ここで警告を出すと
    //   「テンプレートが消えた」という**嘘**になり、隣のカードの「一覧を読み込めませんでした」と
    //   矛盾する（ユーザーを不要な復帰操作へ誘導する）。
    localStorage.setItem(
      EFFECT_ASSIGNMENTS_KEY,
      JSON.stringify({
        superchat: { kind: "template", templateId: TEMPLATE_ID },
      }),
    );
    mocks.listEffectTemplates.mockRejectedValue(new Error("db"));
    render(<Harness />);
    await waitFor(() =>
      expect(
        screen.getByText(/テンプレートの一覧を読み込めませんでした/),
      ).toBeInTheDocument(),
    );
    // ⚠⚠ **`listState` の検査を外す変異は、この 1 行がレッドにする。**
    expect(screen.queryByText(/割り当てていたテンプレートが見つかりません/)).toBeNull();
    // ⚠ それでも `<select>` は「組み込み」を指す（選択肢に無い value を渡すと
    //   ブラウザが先頭の「エフェクトを出さない」を勝手に選んでしまうため）。
    expect(selectFor("スーパーチャット・ビッツ").value).toBe("builtin");
  });

  it("⚠ 実在しない id を見つけても保存値は書き換えない（一時的な取得失敗で設定が消えない）", async () => {
    const raw = JSON.stringify({
      superchat: { kind: "template", templateId: MISSING_ID },
    });
    localStorage.setItem(EFFECT_ASSIGNMENTS_KEY, raw);
    render(<Harness />);
    await waitFor(() =>
      expect(mocks.listEffectTemplates).toHaveBeenCalledTimes(1),
    );
    expect(stored().superchat).toEqual({
      kind: "template",
      templateId: MISSING_ID,
    });
  });

  // --- 復帰導線 ---------------------------------------------------------------------------------

  it("⚠⚠ 「すべての割り当てを解除（組み込みに戻す）」で全部「組み込み」へ戻る", async () => {
    localStorage.setItem(
      EFFECT_ASSIGNMENTS_KEY,
      JSON.stringify({
        superchat: { kind: "template", templateId: TEMPLATE_ID },
        subscription: { kind: "none" },
        gift: { kind: "none" },
      }),
    );
    render(<Harness />);
    await waitFor(() =>
      expect(mocks.listEffectTemplates).toHaveBeenCalledTimes(1),
    );
    expect(selectFor("スーパーチャット・ビッツ").value).toBe(
      `template:${TEMPLATE_ID}`,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "すべての割り当てを解除（組み込みに戻す）",
      }),
    );

    // ⚠⚠ **no-op にする変異はこの 2 つがレッドにする**（画面と保存の両方を見る）。
    for (const select of screen.getAllByRole("combobox")) {
      expect((select as HTMLSelectElement).value).toBe("builtin");
    }
    expect(localStorage.getItem(EFFECT_ASSIGNMENTS_KEY)).toBeNull();
  });

  it("⚠⚠ テンプレートの音が配信に流れることを、割り当て画面で必ず開示する（security-review S-1）", async () => {
    // ⚠ プレビュー枠の注意文は「音ありテンプレートをプレビューしたとき」しか出ないので、
    //   **プレビューを見ずに割り当てる導線**では「知らないまま配信に音が出る」経路が残っていた。
    render(<Harness />);
    await waitFor(() =>
      expect(mocks.listEffectTemplates).toHaveBeenCalledTimes(1),
    );
    expect(screen.getByText(/配信にも流れます/)).toBeInTheDocument();
  });

  it("⚠ 復帰導線には「何が起きるか」の説明を添える", async () => {
    render(<Harness />);
    await waitFor(() =>
      expect(mocks.listEffectTemplates).toHaveBeenCalledTimes(1),
    );
    expect(
      screen.getByText(/テンプレートは削除されません/),
    ).toBeInTheDocument();
  });

  // --- 削除との連動 -----------------------------------------------------------------------------

  it("⚠⚠ 割り当て中のテンプレートを削除すると、確認文にその旨が出る", async () => {
    localStorage.setItem(
      EFFECT_ASSIGNMENTS_KEY,
      JSON.stringify({
        superchat: { kind: "template", templateId: TEMPLATE_ID },
      }),
    );
    render(<Harness />);
    await waitFor(() =>
      expect(mocks.listEffectTemplates).toHaveBeenCalledTimes(1),
    );
    fireEvent.click(screen.getByRole("button", { name: "削除" }));
    // ⚠ 行のラベルにも同じ文字列があるので、ダイアログの中に絞って見る。
    const dialog = within(screen.getByRole("dialog"));
    expect(
      dialog.getByText(/組み込みのエフェクトに戻ります/),
    ).toBeInTheDocument();
    expect(dialog.getByText(/スーパーチャット・ビッツ/)).toBeInTheDocument();
  });

  it("⚠ 割り当てに使っていないテンプレートの削除では、その一文を出さない", async () => {
    render(<Harness />);
    await waitFor(() =>
      expect(mocks.listEffectTemplates).toHaveBeenCalledTimes(1),
    );
    fireEvent.click(screen.getByRole("button", { name: "削除" }));
    expect(screen.queryByText(/組み込みのエフェクトに戻ります/)).toBeNull();
  });

  it("⚠⚠ 削除すると、それを使っていた割り当てが「組み込み」へ戻る", async () => {
    localStorage.setItem(
      EFFECT_ASSIGNMENTS_KEY,
      JSON.stringify({
        superchat: { kind: "template", templateId: TEMPLATE_ID },
        membership: { kind: "template", templateId: TEMPLATE_ID2 },
        gift: { kind: "none" },
      }),
    );
    mocks.listEffectTemplates.mockResolvedValue([
      record(),
      record({ id: TEMPLATE_ID2, name: "別の演出" }),
    ]);
    render(<Harness />);
    await waitFor(() =>
      expect(mocks.listEffectTemplates).toHaveBeenCalledTimes(1),
    );

    // 「きらきら演出」の行の削除ボタン（1 本目）。
    fireEvent.click(screen.getAllByRole("button", { name: "削除" })[0]);
    mocks.listEffectTemplates.mockResolvedValue([
      record({ id: TEMPLATE_ID2, name: "別の演出" }),
    ]);
    // ⚠ 一覧の行にも「削除」があるので、ダイアログの中に絞って押す。
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "削除" }),
    );

    await waitFor(() =>
      expect(mocks.deleteEffectTemplate).toHaveBeenCalledWith(TEMPLATE_ID),
    );
    await waitFor(() =>
      expect(selectFor("スーパーチャット・ビッツ").value).toBe("builtin"),
    );
    // ⚠ 別のテンプレートと「出さない」は巻き添えにしない。
    expect(selectFor("メンバーシップ").value).toBe(`template:${TEMPLATE_ID2}`);
    expect(selectFor("ギフト").value).toBe("none");
  });
});
