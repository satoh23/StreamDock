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
 * ⚠⚠ 固定したい不変条件（⚠ **061h で倒れる向きを反転した**）:
 * - **行は `MONETARY_EVENT_TYPES` から機械的に作られる**（「条件を追加」ボタンを作らない・
 *   7 種別目が増えたら行も増える）。
 * - ⚠⚠ **実在しないテンプレート id は「エフェクトを出さない」として表示し、警告を出す**
 *   （061d-2 は「組み込み」として表示していた。⚠ **判定そのものは残っている**——
 *   `<select>` の value が選択肢に無いとブラウザが勝手に先頭を選ぶ、という理由は 061h でも生きており、
 *   **明示的に**落とす先を書く必要がある。061h が変えたのは落とす先だけ）。
 * - ⚠⚠ **「すべて「表示しない」に戻す」が動く**——壊れたテンプレートで配信画面が
 *   読めなくなったときの**唯一の脱出路**（エフェクト窓は透過・最背面・非フォーカスで操作できない）。
 * - **テンプレート削除で、それを使っている割り当てが「表示しない」へ戻る**＋確認文にその旨が出る。
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
function Harness({ openEffectOverlay = () => {} }: { openEffectOverlay?: () => void }) {
  // ⚠ 061i: 「条件が 0 → 1 件になったら窓を開く」の**判断は hook**、**invoke は `ObsEffectsScreen`**。
  //   このファイルは判断の側だけを見るので、呼ばれたことが分かるモックを差し込める形にしてある。
  const templates = useEffectTemplates({ openEffectOverlay });
  return (
    <>
      {/* ⚠ 061h/061i: `effectWindowOpen`（前提ステータス）と `openEffectOverlay` は
          `ObsEffectsScreen` が渡す props。このファイルが見るのは割り当て側なので、値は固定でよい。 */}
      <EffectTemplateCard
        {...templates}
        effectWindowOpen={true}
        openEffectOverlay={openEffectOverlay}
      />
      <EffectAssignmentCard {...templates} />
    </>
  );
}

/** 割り当ての `<select>` を種別のラベルで引く。 */
const selectFor = (label: string) =>
  screen.getByLabelText(`${label}のエフェクト`) as HTMLSelectElement;

const stored = (): Record<string, { kind: string; templateId?: string }> =>
  JSON.parse(localStorage.getItem(EFFECT_ASSIGNMENTS_KEY) ?? "{}");

/**
 * ⚠⚠ **061i レビュー Q-3（既知の弱さ・別タスクで直す）: このファイルの待ち合わせは弱い。**
 *
 * 各ケースが使っている `await waitFor(() => expect(listEffectTemplates).toHaveBeenCalledTimes(1))`
 * が待っているのは「**IPC が呼ばれたこと**」であって「**`<option>` が描画されたこと**」ではない。
 * `vi.fn(async …)` の呼び出し回数は**呼んだ瞬間**に 1 になるので、解決 → 再レンダーより前に
 * `waitFor` が満たされうる。`<option>` が未描画のまま `fireEvent.change` すると値が反映されず、
 * `stored()` のアサーションが落ちる。
 *
 * ⚠ **061i の変異検証中に 1 度だけ観測された「無関係なケースの失敗」の実因はこれ**である
 * （progress.md の 061i 節では当初「負荷由来の flake」と記録していたが、負荷は**引き金**であって
 * 原因ではない。この待ち合わせが正しければ負荷では落ちない）。
 *
 * ⚠ **061i では直さない**——同じ形が本ファイルに 16 か所あり、061i のスコープ（画面の再構成）から
 * 外れるため（CLAUDE.md「1 回の作業で複数機能をまとめない」）。⚠ 061i が**新しく書いた**
 * `ObsEffectsScreen.test.tsx` は `await screen.findAllByText("きらきら演出")` と
 * **描画を待っている**ので、新しい形のほうが正しい。
 *
 * **再修正トリガー＝このファイルのケースが再び落ちたとき／本ファイルを本格的に触るとき。**
 * そのときは `waitFor(呼び出し回数)` を `await screen.findByRole("option", { name: … })` 相当
 * （＝描画の完了を待つ形）へ**16 か所まとめて**置き換えること。
 * ⚠ 1 か所ずつ直すと「直した所と直していない所」が混在し、次に落ちたときの切り分けが効かなくなる。
 */

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

  it("⚠⚠ 選択肢は「エフェクトを出さない」＋テンプレート名だけ（061h：組み込みの選択肢を消した）", async () => {
    render(<Harness />);
    await waitFor(() =>
      expect(mocks.listEffectTemplates).toHaveBeenCalledTimes(1),
    );
    const options = Array.from(
      selectFor("スーパーチャット・ビッツ").options,
    ).map((o) => o.textContent);
    // ⚠⚠ **「組み込み（名前と金額）」を足し直す変異はここがレッドにする。**
    expect(options).toEqual(["エフェクトを出さない", "きらきら演出"]);
  });

  // --- 既定と保存 -------------------------------------------------------------------------------

  it("⚠⚠ 未保存の既定は全種別「エフェクトを出さない」（061h：割り当てるまで何も出ない）", async () => {
    // ⚠⚠ **061h の本命。** 061d-2 はここが全種別「組み込み」で、
    //   **条件を 1 つも設定していない状態で投げ銭が来ると演出が出た**（＝運用と真逆）。
    render(<Harness />);
    await waitFor(() =>
      expect(mocks.listEffectTemplates).toHaveBeenCalledTimes(1),
    );
    for (const select of screen.getAllByRole("combobox")) {
      expect((select as HTMLSelectElement).value).toBe("none");
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

  it("「エフェクトを出さない」へ戻すと保存される", async () => {
    // ⚠ 061h: 既定が「出さない」になったので、**まずテンプレートを選んでから**戻す
    //   （既定のまま「出さない」を選んでも保存キーごと消える＝未保存と同じ状態に潰れる）。
    localStorage.setItem(
      EFFECT_ASSIGNMENTS_KEY,
      JSON.stringify({
        subscription: { kind: "template", templateId: TEMPLATE_ID },
        gift: { kind: "template", templateId: TEMPLATE_ID },
      }),
    );
    render(<Harness />);
    await waitFor(() =>
      expect(mocks.listEffectTemplates).toHaveBeenCalledTimes(1),
    );
    fireEvent.change(selectFor("サブスク"), { target: { value: "none" } });
    expect(stored().subscription).toEqual({ kind: "none" });
    // ⚠ 他の行は巻き添えにしない。
    expect(stored().gift).toEqual({ kind: "template", templateId: TEMPLATE_ID });
  });

  // --- ⑪: 実在しない id ------------------------------------------------------------------------

  it("⚠⚠ 実在しないテンプレート id の行は「出さない」として表示し、警告を出す（061h で反転）", async () => {
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
    // ⚠⚠ **「組み込み」へ倒す変異はこの 1 行がレッドにする**（061d-2 とは逆向き）。
    expect(selectFor("スーパーチャット・ビッツ").value).toBe("none");
    // ⚠⚠ **この警告が、061h で「出さない側へ倒した」ことを観測可能にしている。**
    //   エフェクト窓は透過・最背面・非フォーカスで何も出せないので、
    //   「割り当てたのに出ない」に気付ける場所はここしかない（`fire()` の注記が前提として名指ししている）。
    expect(
      screen.getByText(
        /割り当てていたエフェクトが見つかりません。いまは何も表示されません。/,
      ),
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
    expect(screen.queryByText(/割り当てていたエフェクトが見つかりません/)).toBeNull();
    // 一覧が届いたあとも（実在する id なので）出ない。
    await waitFor(() =>
      expect(mocks.listEffectTemplates).toHaveBeenCalledTimes(1),
    );
    expect(screen.queryByText(/割り当てていたエフェクトが見つかりません/)).toBeNull();
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
    expect(screen.queryByText(/割り当てていたエフェクトが見つかりません/)).toBeNull();
    // ⚠ それでも `<select>` は明示的に「エフェクトを出さない」を指す（061h）。
    //   ⚠ **判定（`notInList`）を消してよい、という意味ではない**——選択肢に無い value を渡すと
    //   ブラウザが**勝手に**先頭を選ぶので、「たまたま先頭が『出さない』だから合っている」状態になる。
    //   061d-2 の判定はそのまま残し、落とす先だけを変えてある。
    expect(selectFor("スーパーチャット・ビッツ").value).toBe("none");
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

  it("⚠⚠ 「すべて「表示しない」に戻す」で全部「出さない」へ戻る（復帰導線）", async () => {
    // ⚠⚠ **061h で文言と戻し先が変わったが、担保は不変**＝ **no-op にする変異でレッドになること**。
    //   ⚠ むしろ復帰導線としては強くなっている（061d-2 は解除しても組み込みが出続けたので、
    //   配信画面を完全に静かにするには 6 種別を 1 つずつ「出さない」にするしかなかった）。
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
      screen.getByRole("button", { name: "すべて「表示しない」に戻す" }),
    );

    // ⚠⚠ **no-op にする変異はこの 2 つがレッドにする**（画面と保存の両方を見る）。
    for (const select of screen.getAllByRole("combobox")) {
      expect((select as HTMLSelectElement).value).toBe("none");
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

  it("⚠⚠ 061h の移行案内を出す（旧「組み込み」が黙って止まったことに気付ける唯一の場所）", async () => {
    // ⚠⚠ **061h レビュー Q-8 で足した回帰。** 旧版の `{"kind":"builtin-monetary"}` は
    //   `parseAssignment` が**未知 kind として「出さない」へ倒す**ので、更新したユーザーは
    //   自分で変えた覚えが無いのに何も出なくなる。⚠ しかも `notInList` は
    //   `kind === "template"` のときしか立たない（旧値はここへ届く前に `{kind:"none"}` へ化ける）ので、
    //   上の「見つかりません」警告も出ない＝**この 1 文が唯一の気付ける経路**である。
    // ⚠ 移行の判定コードは書かない方針（＝「未知 kind は安全側へ倒す」を 2 通りに書かない）なので、
    //   **静的な文**として全ユーザーに出る。⚠ 消してよいのは 061h が十分に行き渡ってから。
    render(<Harness />);
    await waitFor(() =>
      expect(mocks.listEffectTemplates).toHaveBeenCalledTimes(1),
    );
    expect(
      screen.getByText(/以前のバージョンで「組み込み（名前と金額）」のエフェクトを使っていた場合/),
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
    // ⚠ 061h: 戻し先が変わったので文言も追随する（「組み込みのエフェクトに戻ります」→ これ）。
    expect(
      dialog.getByText(/「表示しない」に戻ります/),
    ).toBeInTheDocument();
    expect(dialog.getByText(/スーパーチャット・ビッツ/)).toBeInTheDocument();
  });

  it("⚠ 割り当てに使っていないテンプレートの削除では、その一文を出さない", async () => {
    render(<Harness />);
    await waitFor(() =>
      expect(mocks.listEffectTemplates).toHaveBeenCalledTimes(1),
    );
    fireEvent.click(screen.getByRole("button", { name: "削除" }));
    expect(screen.queryByText(/「表示しない」に戻ります/)).toBeNull();
  });

  it("⚠⚠ 削除すると、それを使っていた割り当てが「出さない」へ戻る", async () => {
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
      expect(selectFor("スーパーチャット・ビッツ").value).toBe("none"),
    );
    // ⚠ 別のテンプレートと「出さない」は巻き添えにしない。
    expect(selectFor("メンバーシップ").value).toBe(`template:${TEMPLATE_ID2}`);
    expect(selectFor("ギフト").value).toBe("none");
  });
});
