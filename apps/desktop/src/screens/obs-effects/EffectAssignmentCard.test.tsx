import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import {
  EFFECT_ASSIGNMENTS_KEY,
  EFFECT_OVERLAY_ENABLED_KEY,
} from "../../features/comment-viewer/overlaySettings";
import type { EffectTemplateRecord } from "../../features/obs-effects/bindings/EffectTemplateRecord";
import { MONETARY_EVENT_TYPES } from "../comment-viewer/viewerFormat";
import { EFFECT_EVENT_LABEL, EFFECT_EVENT_ROWS } from "./effectEventRows";

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
 *   ⚠⚠ **061j (0) で「落とす先の明示」を DOM の外で固定した**（061h 申し送り ⑦-c の返済）——
 *   組み立てを `effectSelectValue` / `isEffectTemplateMissingFromList` へ切り出し、
 *   **`<option>` を 1 つも描かずに**値を検査する describe を先頭に置いた。
 *   ⚠ **選択肢の順序は 1 文字も変えていない**（061i の申し送りどおり、順序では解決しない）。
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
import {
  KEYWORD_CONDITION_MAX,
  type EffectAssignment,
  type EffectOutput,
} from "./effectAssignments";
import {
  effectSelectValue,
  isEffectTemplateMissingFromList,
  NONE_VALUE,
  TEMPLATE_PREFIX,
} from "./effectSelectValue";

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
function Harness({
  openEffectOverlay = () => {},
}: {
  openEffectOverlay?: (output: EffectOutput) => void;
}) {
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
        stageWindowOpen={true}
        openEffectOverlay={openEffectOverlay}
      />
      <EffectAssignmentCard {...templates} />
    </>
  );
}

/** 割り当ての `<select>` を種別のラベルで引く。 */
const selectFor = (label: string) =>
  screen.getByLabelText(`${label}のエフェクト`) as HTMLSelectElement;

/**
 * 061j: 保存値（**条件の配列**）を読む。⚠ 061i までの `Record<eventType, …>` から形が変わった。
 *
 * ⚠ **生の JSON を読む**（`loadEffectConditions()` を通さない）——「画面の操作が
 * localStorage に何を書いたか」を見たいので、読み込み時の正規化を挟むと**書けていなくても通る**。
 */
interface StoredCondition {
  id: string;
  when: { type: string; eventType?: string; text?: string; match?: string };
  effect: { kind: string; templateId?: string };
}
const stored = (): StoredCondition[] => {
  const raw = localStorage.getItem(EFFECT_ASSIGNMENTS_KEY);
  return raw === null ? [] : (JSON.parse(raw) as StoredCondition[]);
};
/** 条件 1 件を id で引く。 */
const storedById = (id: string): StoredCondition | undefined =>
  stored().find((c) => c.id === id);
const storedKeywords = (): StoredCondition[] =>
  stored().filter((c) => c.when.type === "keyword");

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

/**
 * ⚠⚠ **061j (0): 061h 申し送り ⑦-c の返済。**
 *
 * 061h のミューテーション⑦-c（`notInList` の判定ごと削除）は**警告文が消えること**しか
 * レッドにできていなかった。理由（`docs/progress.md` の 061h 節が正）:
 * **`<select>` の `value` が選択肢に無いと、ブラウザも jsdom も "ask for a reset" で
 * 先頭の `<option>` を選ぶ**——先頭がたまたま「エフェクトを出さない」なので、
 * **判定を消しても `select.value` のアサーションが偶然通る**。
 * ⚠ 061i は「選択肢の順序を変えない」ことで回避したが、**061j は保存形ごと変えるので回避できない**
 * （061i 申し送り）。⚠ **選択肢の順序を変えて解決するのは「やらないこと」**なので、
 * **DOM を経由しない形**＝ 組み立てを純関数へ切り出して直接固定する形にした。
 *
 * ⇒ ここの 6 ケースは **`<option>` を 1 つも描かずに**値を検査するので、
 * **選択肢の先頭が何であっても**「落とす先を明示している」ことが固定される。
 *
 * ⚠ **正直な限界（過大な主張をしない）**: 固定できたのは
 * **「`effectSelectValue` が正しいこと」**であって、**「画面がそれを使い続けること」ではない**。
 * 画面側で `template:<id>` を直に組み立て直す変異は、ブラウザの既定と結果が一致するため
 * 依然として DOM からは観測できない。⚠ ただし**落とす先を「先頭のテンプレート」等へ変える**変異は
 * 下の「`<select>` の value は `effectSelectValue` と一致する」ケースが拾う。
 */
describe("061j (0): `<select>` の値の組み立て（純関数・DOM を経由しない）", () => {
  const templates = [record(), record({ id: TEMPLATE_ID2, name: "紙吹雪" })];
  const tpl = (templateId: string): EffectAssignment => ({
    kind: "template",
    templateId,
  });

  it("「エフェクトを出さない」はそのまま NONE_VALUE", () => {
    expect(effectSelectValue({ kind: "none" }, templates)).toBe(NONE_VALUE);
  });

  it("一覧に在るテンプレートは `template:<id>`", () => {
    expect(effectSelectValue(tpl(TEMPLATE_ID), templates)).toBe(
      `${TEMPLATE_PREFIX}${TEMPLATE_ID}`,
    );
    expect(effectSelectValue(tpl(TEMPLATE_ID2), templates)).toBe(
      `${TEMPLATE_PREFIX}${TEMPLATE_ID2}`,
    );
  });

  it("⚠⚠ 一覧に無い id は **明示的に** NONE_VALUE へ落ちる（061h 申し送り ⑦-c の本体）", () => {
    // ⚠⚠ **`!isEffectTemplateMissingFromList(...)` を外す変異は、この 1 行が必ずレッドにする。**
    //   ⚠ ブラウザの「先頭を選ぶ」既定に一切依存していないのが要点
    //   （選択肢を 1 つも描いていないので、先頭が何であっても結果は変わらない）。
    expect(effectSelectValue(tpl(MISSING_ID), templates)).toBe(NONE_VALUE);
    // ⚠ 落とす先は**先頭のテンプレート**でもない（061h で `BUILTIN_VALUE` → `NONE_VALUE` へ反転した先）。
    expect(effectSelectValue(tpl(MISSING_ID), templates)).not.toBe(
      `${TEMPLATE_PREFIX}${TEMPLATE_ID}`,
    );
  });

  it("⚠ 一覧が届く前（空）でも判定は要る＝ NONE_VALUE へ落ちる", () => {
    // ⚠ 「一覧が空だから警告は出さない」（下の `missing`）とは**別の判断**である。
    //   受け皿の値は一覧の取得状況に関わらず必ず明示する。
    expect(effectSelectValue(tpl(TEMPLATE_ID), [])).toBe(NONE_VALUE);
  });

  it("⚠⚠ `isEffectTemplateMissingFromList` は `listState` を見ない（警告の条件と混ぜない）", () => {
    // ⚠ **表示の受け皿**（この述語）と**「無い」という断言**（警告）は別の判断で、
    //   後者だけが `listState === "ready"` を要求する（061d-2 レビュー S-1）。
    //   ⚠ ここに `listState` を持ち込む変異は、下の DOM ケース群と食い違って必ずどちらかが落ちる。
    expect(isEffectTemplateMissingFromList(tpl(MISSING_ID), templates)).toBe(
      true,
    );
    expect(isEffectTemplateMissingFromList(tpl(TEMPLATE_ID), templates)).toBe(
      false,
    );
    expect(isEffectTemplateMissingFromList(tpl(TEMPLATE_ID), [])).toBe(true);
  });

  it("⚠ 「エフェクトを出さない」は『見つからない』にならない（警告を出す条件に混ぜない）", () => {
    expect(isEffectTemplateMissingFromList({ kind: "none" }, [])).toBe(false);
  });
});

/**
 * 061k: **エフェクトの `<select>` だけ**を集める（出力先の `<select>` を混ぜない）。
 * ⚠ `getAllByRole("combobox")` は 061k 以降**出力先・キーワードの当て方**も拾うので、
 * 「全部の combobox が `none`」というアサーションは意味が変わってしまう。
 */
const effectSelects = (): HTMLSelectElement[] =>
  screen
    .getAllByRole("combobox")
    .filter((el): el is HTMLSelectElement =>
      (el.getAttribute("aria-label") ?? "").endsWith("のエフェクト"),
    );

describe("EffectAssignmentCard", () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.listEffectTemplates.mockResolvedValue([record()]);
    mocks.deleteEffectTemplate.mockResolvedValue(undefined);
  });
  afterEach(() => localStorage.clear());

  // --- 行の集合 ---------------------------------------------------------------------------------

  it("⚠⚠ イベント条件の行は課金種別ぶん最初から全部ある（061d の (2) はここでは維持）", async () => {
    render(<Harness />);
    await waitFor(() =>
      expect(mocks.listEffectTemplates).toHaveBeenCalledTimes(1),
    );
    // ⚠ `MONETARY_EVENT_TYPES` に 7 種別目が増えたら、この件数も自動で増える（行の作り方が機械的）。
    for (const { eventType } of EFFECT_EVENT_ROWS) {
      const label = EFFECT_EVENT_LABEL[eventType] ?? eventType;
      expect(screen.getByLabelText(`${label}のエフェクト`)).toBeInTheDocument();
    }
    expect(EFFECT_EVENT_ROWS).toHaveLength(MONETARY_EVENT_TYPES.size);
    // ⚠⚠ **イベント条件には「条件を追加」を作らない**（061d の (2)＝たぬえさ3 の逆をやる）。
    //   ⚠ **061j でキーワード条件だけ追加ボタンを持つ**ようになったので、
    //   「ボタンが 1 つも無い」ではなく「**イベント行が最初から全部並んでいる**」で固定する
    //   （061d の狙いは「増やせないこと」ではなく「コピペで増やす手作業を作らないこと」）。
    expect(screen.getAllByRole("combobox").length).toBeGreaterThanOrEqual(
      MONETARY_EVENT_TYPES.size,
    );
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
    for (const select of effectSelects()) {
      expect(select.value).toBe("none");
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
    expect(storedById("event:superchat")?.effect).toEqual({
      kind: "template",
      templateId: TEMPLATE_ID,
    });
  });

  it("「エフェクトを出さない」へ戻すと保存される", async () => {
    // ⚠ 061h: 既定が「出さない」になったので、**まずテンプレートを選んでから**戻す
    //   （既定のまま「出さない」を選んでも保存キーごと消える＝未保存と同じ状態に潰れる）。
    // ⚠ 061j: 仕込む形も**条件の配列**になった。
    localStorage.setItem(
      EFFECT_ASSIGNMENTS_KEY,
      JSON.stringify([
        {
          id: "event:subscription",
          when: { type: "event", eventType: "subscription" },
          effect: { kind: "template", templateId: TEMPLATE_ID },
        },
        {
          id: "event:gift",
          when: { type: "event", eventType: "gift" },
          effect: { kind: "template", templateId: TEMPLATE_ID },
        },
      ]),
    );
    render(<Harness />);
    await waitFor(() =>
      expect(mocks.listEffectTemplates).toHaveBeenCalledTimes(1),
    );
    fireEvent.change(selectFor("サブスク"), { target: { value: "none" } });
    expect(storedById("event:subscription")?.effect).toEqual({ kind: "none" });
    // ⚠ 他の行は巻き添えにしない。
    expect(storedById("event:gift")?.effect).toEqual({
      kind: "template",
      templateId: TEMPLATE_ID,
    });
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
    // ⚠⚠ **061j (0): この行だけでは「落とす先を明示している」ことは固定できない**——
    //   判定を消しても `value` は選択肢に無い値になり、**ブラウザ（jsdom）が先頭を選ぶ**ので
    //   たまたま "none" に一致する。それを固定しているのは上の純関数の describe である。
    //   ⇒ ここは**画面が純関数と同じ規則を見ていること**を確かめる位置づけに変えた
    //   （落とす先を「先頭のテンプレート」等へ変える変異は、選択肢に在る値になるのでここで落ちる）。
    expect(selectFor("スーパーチャット・ビッツ").value).toBe(
      effectSelectValue(
        { kind: "template", templateId: MISSING_ID },
        [record()],
      ),
    );
    expect(selectFor("スーパーチャット・ビッツ").value).toBe(NONE_VALUE);
    // ⚠⚠ **この警告が、061h で「出さない側へ倒した」ことを観測可能にしている。**
    //   エフェクト窓は透過・最背面・非フォーカスで何も出せないので、
    //   「割り当てたのに出ない」に気付ける場所はここしかない（`fire()` の注記が前提として名指ししている）。
    // ⚠ **値（上）と警告（下）は別々に見る**——前者は「表示の受け皿」、後者は
    //   「無いという断言」で、成立条件が違う（後者だけ `listState === "ready"` を要求する）。
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
    // ⚠ 実在する id なので受け皿へは落ちない（＝落とす判定が常に true になる変異でレッド）。
    expect(selectFor("スーパーチャット・ビッツ").value).toBe(
      `${TEMPLATE_PREFIX}${TEMPLATE_ID}`,
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
    //   ⚠⚠ **061j (0): その「たまたま」を潰したのは上の純関数の describe である**
    //   （この行は依然としてブラウザの既定と区別が付かない＝ここでは固定できていない）。
    expect(selectFor("スーパーチャット・ビッツ").value).toBe(
      effectSelectValue({ kind: "template", templateId: TEMPLATE_ID }, []),
    );
    expect(selectFor("スーパーチャット・ビッツ").value).toBe(NONE_VALUE);
  });

  it("⚠ 実在しない id を見つけても保存値は書き換えない（一時的な取得失敗で設定が消えない）", async () => {
    const raw = JSON.stringify([
      {
        id: "event:superchat",
        when: { type: "event", eventType: "superchat" },
        effect: { kind: "template", templateId: MISSING_ID },
      },
    ]);
    localStorage.setItem(EFFECT_ASSIGNMENTS_KEY, raw);
    render(<Harness />);
    await waitFor(() =>
      expect(mocks.listEffectTemplates).toHaveBeenCalledTimes(1),
    );
    // ⚠ **バイト単位で不変**（読んだだけでは書き戻さない・判断 8）。
    expect(localStorage.getItem(EFFECT_ASSIGNMENTS_KEY)).toBe(raw);
  });

  // --- 復帰導線 ---------------------------------------------------------------------------------

  // ⚠⚠⚠ **061p: 復帰導線（「すべて「表示しない」に戻す」）の 3 件を削除した**
  //   （①全部「出さない」へ戻る ②説明文を添える ③キーワードは消さない）。
  //   ボタンと `clearAllEffectConditions` ごと廃止したため（指示）。
  //   ⚠ **061p 以降の復帰手段は「条件を 1 行ずつ『エフェクトを出さない』に戻す」だけ**で、
  //   その経路は下の「`<select>` を変えると保存される」ケースが固定している。
  //   ⚠ **復活させるときは `git show` でこの 3 件ごと戻すこと。**
  //
  // ⚠⚠ **音が配信に流れる旨の開示（061d-2 security-review S-1）は
  //   `EffectTemplateCard.test.tsx` へ移した**（文をあちらのカードへ移設したため）。
  //   ⚠ **どちらかの画面に必ず出ていること**が S-1 の要求で、**両方から消してはいけない。**
  //
  // ⚠⚠ **061h の移行案内（旧「組み込み」が黙って止まった件）の回帰も削除した。**
  //   061h レビュー Q-8 が「061h が十分に行き渡ったら消してよい」と書いていた文で、
  //   061p の「説明が長すぎる」でその予定を前倒しした。
  //   ⚠ **再修正トリガー＝旧版から更新した人の「何も出ない」問い合わせが実際に出たとき。**

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

  // --- 061j: キーワード条件（自由テキスト） ------------------------------------------------------

  /** 一覧が届くまで待つ（`<option>` が生えてから操作する）。 */
  const readyHarness = async (openEffectOverlay = () => {}) => {
    render(<Harness openEffectOverlay={openEffectOverlay} />);
    await screen.findAllByRole("option", { name: "きらきら演出" });
  };

  /** 「条件を追加」→ 未確定行のキーワード入力を返す。 */
  const addRow = async () => {
    fireEvent.click(screen.getByRole("button", { name: "条件を追加" }));
    return screen.getByLabelText("キーワード 1") as HTMLInputElement;
  };

  it("⚠⚠ 穴 β: 「条件を追加」で行が生えるが、**空のままでは何も保存されない**", async () => {
    await readyHarness();
    const input = await addRow();
    expect(input).toBeInTheDocument();
    // ⚠⚠ **判断 9（空を保存しない）と「条件を追加」が両立していることの担保。**
    //   素直に `addKeywordCondition()` を `commitConditions` へ通すと、保存層が空を落として
    //   **行がその場で消える**（＝ボタンが動かない）。⇒ 未確定行はコンポーネント state に持つ。
    expect(localStorage.getItem(EFFECT_ASSIGNMENTS_KEY)).toBeNull();
    fireEvent.blur(input);
    expect(localStorage.getItem(EFFECT_ASSIGNMENTS_KEY)).toBeNull();
    // ⚠ 行は消えない（打ち直せる）。
    expect(screen.getByLabelText("キーワード 1")).toBeInTheDocument();
  });

  it("⚠⚠ 穴 α: 打鍵ごとには保存せず、blur で 1 回だけ確定する（048 の先例）", async () => {
    await readyHarness();
    const input = await addRow();
    fireEvent.change(input, { target: { value: "く" } });
    fireEvent.change(input, { target: { value: "くさ" } });
    fireEvent.change(input, { target: { value: "草" } });
    // ⚠⚠ **ここが `onChange` 即 commit にする変異をレッドにする 1 行。**
    //   打鍵ごとに書くと `EFFECT_ASSIGNMENTS_KEY` が毎回変わり、エフェクト窓の `storage` 購読が
    //   `list_effect_templates` を**打鍵ごとに 1 本**投げる。
    expect(localStorage.getItem(EFFECT_ASSIGNMENTS_KEY)).toBeNull();
    fireEvent.blur(input);
    expect(storedKeywords()).toHaveLength(1);
    expect(storedKeywords()[0].when.text).toBe("草");
  });

  it("⚠ Enter でも確定する", async () => {
    await readyHarness();
    const input = await addRow();
    fireEvent.change(input, { target: { value: "草" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(storedKeywords()).toHaveLength(1);
  });

  it("⚠⚠ 新規 10（UI 側）: 既存の行を空にして確定すると **直前の確定値へ戻る**", async () => {
    await readyHarness();
    const input = await addRow();
    fireEvent.change(input, { target: { value: "草" } });
    fireEvent.blur(input);
    expect(storedKeywords()[0].when.text).toBe("草");

    // 全部消して確定（＝打ち間違い）。⚠ 空を保存すると**全コメントに一致する**。
    const saved = screen.getByLabelText("キーワード 1") as HTMLInputElement;
    fireEvent.change(saved, { target: { value: "" } });
    fireEvent.blur(saved);
    expect(storedKeywords()[0].when.text).toBe("草");
    // ⚠ 画面も直前値へ戻る（「消えたのか残ったのか」が分からない状態を作らない）。
    expect((screen.getByLabelText("キーワード 1") as HTMLInputElement).value).toBe("草");
  });

  it("⚠⚠ 新規 10（UI 側）: 全角スペースだけを入力しても保存されない", async () => {
    await readyHarness();
    const input = await addRow();
    // ⚠ 空白だけの入力は確定しない（`isUsableKeyword` が拾う）。
    fireEvent.change(input, { target: { value: "　" } });
    fireEvent.blur(input);
    expect(localStorage.getItem(EFFECT_ASSIGNMENTS_KEY)).toBeNull();
  });

  it("⚠ 32 文字を超える入力は詰められ、**入力欄の表示も書き戻る**（048 の規律）", async () => {
    await readyHarness();
    const input = await addRow();
    // ⚠ `maxLength` はブラウザの補助なので、`fireEvent` では効かない（＝確定時の整形を直接見られる）。
    fireEvent.change(input, { target: { value: "あ".repeat(40) } });
    fireEvent.blur(input);
    expect([...storedKeywords()[0].when.text!]).toHaveLength(32);
    expect(
      [...(screen.getByLabelText("キーワード 1") as HTMLInputElement).value],
    ).toHaveLength(32);
  });

  it("⚠ 当て方（含む / 完全一致）を選ぶと保存される", async () => {
    await readyHarness();
    const input = await addRow();
    fireEvent.change(input, { target: { value: "草" } });
    fireEvent.blur(input);
    fireEvent.change(screen.getByLabelText("キーワード 1 の当て方"), {
      target: { value: "exact" },
    });
    expect(storedKeywords()[0].when.match).toBe("exact");
  });

  it("⚠ 未確定行は削除ボタンで消せる（保存値に触らない）", async () => {
    await readyHarness();
    await addRow();
    fireEvent.click(screen.getAllByRole("button", { name: "削除" })[1]);
    expect(screen.queryByLabelText("キーワード 1")).toBeNull();
    expect(localStorage.getItem(EFFECT_ASSIGNMENTS_KEY)).toBeNull();
  });

  it("⚠ 未確定行がある間は「条件を追加」を押せない（未確定が溜まらない）", async () => {
    await readyHarness();
    await addRow();
    expect(screen.getByRole("button", { name: "条件を追加" })).toBeDisabled();
  });

  it("⚠⚠ 新規 16: キーワード条件の追加・削除で `EFFECT_OVERLAY_ENABLED_KEY` が追従する", async () => {
    // ⚠⚠ **061i 判断 2（派生値の書き手を 1 か所に閉じる）が、新しい経路でも守られていること。**
    //   ⚠ `addKeywordCondition` / `removeCondition` を `commitConditions` を通さずに書く変異は
    //   ここがレッドにする。
    const openEffectOverlay = vi.fn();
    await readyHarness(openEffectOverlay);
    expect(localStorage.getItem(EFFECT_OVERLAY_ENABLED_KEY)).not.toBe("true");

    const input = await addRow();
    fireEvent.change(input, { target: { value: "草" } });
    fireEvent.blur(input);
    // ⚠ **キーワードを打っただけでは条件に数えない**（エフェクト未選択＝ `kind === "none"`）。
    expect(localStorage.getItem(EFFECT_OVERLAY_ENABLED_KEY)).not.toBe("true");
    expect(openEffectOverlay).not.toHaveBeenCalled();

    // エフェクトを選んだ瞬間に 0 → 1 件（＝窓が開く）。
    fireEvent.change(screen.getByLabelText("キーワード 1 のエフェクト"), {
      target: { value: `template:${TEMPLATE_ID}` },
    });
    expect(localStorage.getItem(EFFECT_OVERLAY_ENABLED_KEY)).toBe("true");
    expect(openEffectOverlay).toHaveBeenCalledTimes(1);

    // 消すと 0 件へ戻る（＝派生値も false）。
    fireEvent.click(screen.getAllByRole("button", { name: "削除" })[1]);
    expect(localStorage.getItem(EFFECT_OVERLAY_ENABLED_KEY)).toBe("false");
  });

  it("⚠⚠ 新規 14（UI 経由）: 削除しても id が再利用されない", async () => {
    await readyHarness();
    for (const text of ["あ", "い"]) {
      fireEvent.click(screen.getByRole("button", { name: "条件を追加" }));
      const input = screen.getByLabelText(
        `キーワード ${storedKeywords().length + 1}`,
      ) as HTMLInputElement;
      fireEvent.change(input, { target: { value: text } });
      fireEvent.blur(input);
    }
    expect(storedKeywords().map((c) => c.id)).toEqual(["kw:1", "kw:2"]);

    // 1 件目を消して 1 件足す。⚠ **`kw:1` を再利用するとクールダウンを取り違える。**
    fireEvent.click(screen.getAllByRole("button", { name: "削除" })[1]);
    fireEvent.click(screen.getByRole("button", { name: "条件を追加" }));
    const input = screen.getByLabelText("キーワード 2") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "う" } });
    fireEvent.blur(input);
    expect(storedKeywords().map((c) => c.id)).toEqual(["kw:2", "kw:3"]);
  });

  it("⚠⚠ 新規 15: キーワード条件が指すテンプレートの削除確認文に、そのキーワードが出る", async () => {
    // ⚠⚠ **判断 13。** これが無いと「消したら知らないうちに条件が『表示しない』へ戻っていた」。
    localStorage.setItem(
      EFFECT_ASSIGNMENTS_KEY,
      JSON.stringify([
        {
          id: "kw:1",
          when: { type: "keyword", text: "草", match: "contains" },
          effect: { kind: "template", templateId: TEMPLATE_ID },
        },
      ]),
    );
    await readyHarness();
    fireEvent.click(screen.getAllByRole("button", { name: "削除" })[0]);
    const dialog = within(screen.getByRole("dialog"));
    // ⚠ 当て方まで書く（「含む」と「完全一致」で意味が違う）。
    expect(dialog.getByText(/「草」を含むコメント/)).toBeInTheDocument();
    expect(dialog.getByText(/「表示しない」に戻ります/)).toBeInTheDocument();
  });

  it("⚠ 完全一致のキーワード条件は確認文でもそう書かれる", async () => {
    localStorage.setItem(
      EFFECT_ASSIGNMENTS_KEY,
      JSON.stringify([
        {
          id: "kw:1",
          when: { type: "keyword", text: "草", match: "exact" },
          effect: { kind: "template", templateId: TEMPLATE_ID },
        },
      ]),
    );
    await readyHarness();
    fireEvent.click(screen.getAllByRole("button", { name: "削除" })[0]);
    expect(
      within(screen.getByRole("dialog")).getByText(
        /「草」と完全に一致するコメント/,
      ),
    ).toBeInTheDocument();
  });

  // ⚠⚠ 061p: 「復帰導線を押してもキーワードは消えない」の回帰は、
  //   復帰導線ごと削除した（上の「復帰導線」節の注記が正）。

  // --- 文言 -------------------------------------------------------------------------------------

  // ⚠⚠⚠ **061p: 説明文の回帰 3 件（判断 11 / 12 / 7）を削除した。**
  //   ①「1 コメントに出るのは 1 つだけ・上から順」②「言葉で出すと金額やイベント名の文字が出ない」
  //   ③クールダウン（秒数は書かない）——**文そのものを画面から消した**ため（指示＝説明が長すぎる）。
  //   ⚠ **①②③はいずれも挙動の説明であって、挙動は 1 ミリも変えていない**
  //   （走査順・差し込み変数・`KEYWORD_COOLDOWN_MS` は `effectAssignments.test.ts` /
  //   `effectTrigger.test.ts` が実挙動として固定している＝**仕様の担保は残っている**）。
  //   ⚠ 消えたのは「ユーザーがそれを事前に知れること」だけである。

  it("⚠⚠ 061p: 画面に残す説明は「窓が自動で開く」と「言葉の上限・正規化」だけ", async () => {
    // ⚠⚠ **061a 以来の規律「黙って何かが起きる状態を作らない」の最後の 1 文**——
    //   061i で表示トグルを廃止して以降、**「いつ窓が開くのか」を書いている場所はここしかない**。
    //   ⚠ **これを消す変異はレッドにする**（061p の削減はここで止まる、という線引きである）。
    await readyHarness();
    expect(
      screen.getByText(/条件を 1\s*つでも設定すると、配信画面用のウィンドウが自動で開きます/),
    ).toBeInTheDocument();
    // ⚠ 上限は「＋ が押せなくなる理由」なので残す（押せない理由を書かない＝黙って詰まる）。
    const keywordNote = screen.getByText(/コメントに入っていたらエフェクトを出す言葉/);
    expect(keywordNote.textContent).toContain(`${KEYWORD_CONDITION_MAX}`);
    expect(keywordNote.textContent).toMatch(/大文字・小文字や全角・半角は区別しません/);
  });

  it("⚠⚠ 061p: 「条件を追加」は ＋ アイコンだが、アクセシブル名は保つ", async () => {
    // ⚠⚠ **グリフだけのボタンは読み上げで「プラス」としか読まれない**ので、
    //   `aria-label` で「何が増えるのか」を残す（＝この検査が名前を固定している）。
    //   ⚠ 見た目のラベル（旧「条件を追加」の文字）は消えていることも併せて見る。
    await readyHarness();
    const add = screen.getByRole("button", { name: "条件を追加" });
    expect(add).toBeInTheDocument();
    expect(add.textContent).toBe("＋");
  });
});
