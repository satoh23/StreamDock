import type { EffectAssignment } from "./effectAssignments";

/**
 * 061j (0): **割り当ての値 ⇄ `<select>` の `value`** の組み立て（`EffectAssignmentCard` の表示規則）。
 *
 * ⚠⚠ **061h 申し送り ⑦-c を返済するために、`EffectAssignmentCard.tsx` から切り出した。**
 * 061h のミューテーション⑦-c（`notInList` の判定ごと削除）は**警告文が消えること**しか
 * レッドにできていなかった。理由（`docs/progress.md` の 061h 節が正）は
 * **`<select>` の `value` が選択肢に無いと、ブラウザも jsdom も "ask for a reset" で
 * 先頭の `<option>` を選ぶ**こと——先頭がたまたま「エフェクトを出さない」なので、
 * **判定を消しても値のアサーションが偶然通る**（＝「落とす先を明示している」ことを直接固定できない）。
 * ⚠ 061i は「選択肢の順序を変えない」ことで回避したが、**061j は保存形ごと変えるので回避できない**。
 * ⚠ **順序を変えて解決するのは「やらないこと」**なので、**DOM を経由しない形**へ寄せた
 * ＝ ここが純関数なので `EffectAssignmentCard.test.tsx` が `<option>` を 1 つも描かずに値を固定できる。
 *
 * ⚠ **モジュールを分けた理由は 2 つ**:
 *   1. `react-refresh/only-export-components`——コンポーネントのファイルから定数や関数を export すると
 *      Fast Refresh が効かなくなる（eslint が警告する）。`effectEventRows.ts` と同じ扱いにする。
 *   2. ⚠⚠ **061j 本体でイベント条件の行とキーワード条件の行の両方がこの 1 本を使う**
 *      （`template:<id>` の組み立てを 2 通りに書かない）。**捨てる足場ではない。**
 *
 * ⚠ **ここは「表示の規則」だけを持つ**——保存形の検証（`isEffectTemplateId` / `parseAssignment`）も
 * 一覧の取得も持たない。`effectAssignments.ts`（割り当ての読み書きと解決）とは層が違う。
 */

/** `<select>` の値。⚠ テンプレートは `template:<id>` で表す（`<option value>` は文字列しか持てない）。 */
export const NONE_VALUE = "none";
export const TEMPLATE_PREFIX = "template:";

/**
 * 割り当て先が **`templates`（main 窓が持つ一覧）に載っていない**か。
 *
 * ⚠⚠ **`missing`（「見つかりません」という断言）とは別の判断である。**
 * こちらは**表示の受け皿をどこへ落とすか**で、一覧が読めていなくても成立する。
 * 「無い」と断言してよいのは `listState === "ready"` のときだけ（061d-2 レビュー S-1）で、
 * その組み合わせは呼び出し側が行う。**ここで `listState` を見ないこと**——見ると
 * 「一覧の取得に失敗している間だけ、選択肢に無い value が `<select>` に渡る」状態が生まれる。
 *
 * ⚠ **判定をここ 1 か所に閉じてある**——[`effectSelectValue`] と警告の両方が同じ述語を見るので、
 * 「片方だけ緩む」を作れない（`isEffectTemplateId` を 1 か所に閉じたのと同じ規律）。
 */
export function isEffectTemplateMissingFromList(
  effect: EffectAssignment,
  templates: readonly { id: string }[],
): boolean {
  return (
    effect.kind === "template" &&
    !templates.some((t) => t.id === effect.templateId)
  );
}

/**
 * 割り当ての値 → `<select>` の `value`。
 *
 * ⚠⚠ **選択肢に無い id は、明示的に `NONE_VALUE` へ落とす**（061h で `BUILTIN_VALUE` から反転。
 * 「壊れ方の方針」の全文は `effectAssignments.ts` の module JSDoc が正）。
 * ⚠ **ブラウザが先頭を選ぶ既定に依存しない**ことがこの関数の存在理由そのものである
 * （＝ `!isEffectTemplateMissingFromList(...)` を外す変異が、選択肢の中身に関わらず必ずレッドになる）。
 */
export function effectSelectValue(
  effect: EffectAssignment,
  templates: readonly { id: string }[],
): string {
  return effect.kind === "template" &&
    !isEffectTemplateMissingFromList(effect, templates)
    ? `${TEMPLATE_PREFIX}${effect.templateId}`
    : NONE_VALUE;
}
