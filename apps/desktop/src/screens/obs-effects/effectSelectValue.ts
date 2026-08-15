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
 *   2. ⚠⚠ **イベント条件の行とキーワード条件の行の両方がこの 1 本を使う**
 *      （`obs:<名前>` の組み立てを 2 通りに書かない）。**捨てる足場ではない。**
 *
 * ⚠ **ここは「表示の規則」だけを持つ**——保存形の検証（`isEffectObsSourceName` / `parseAssignment`）も
 * 一覧の取得も持たない。`effectAssignments.ts`（割り当ての読み書きと解決）とは層が違う。
 */

/** `<select>` の値。⚠ 「出さない」だけが固定値で、あとはプレフィックス付きの動的な値。 */
export const NONE_VALUE = "none";

/**
 * 064b: OBS 側のソースは `obs:<ソース名>` で表す。
 *
 * ⚠⚠ **値を取り出すのは `slice` であって `split(":")` ではない。** OBS のソース名は
 * **ユーザーが自由に付けた文字列**なので `:` を含みうる（「12:34 の演出」など）。
 * `split` で全部割ると**実在するのに「見つかりません」になる**——064a で
 * `parseObsSourceTestFire` が踏まないように作った罠とまったく同じもので、**2 例目**である。
 * ⚠ [`effectSelectAssignment`] がその 1 か所なので、**ここ以外で値を分解しないこと。**
 */
export const OBS_SOURCE_PREFIX = "obs:";

/**
 * 割り当ての値 → `<select>` の `value`。
 *
 * ⚠⚠ **選択肢に無いものは、明示的に `NONE_VALUE` へ落とす**（061h で `BUILTIN_VALUE` から反転。
 * 「壊れ方の方針」の全文は `effectAssignments.ts` の module JSDoc が正）。
 * ⚠ 064d: テンプレート（`template:<id>`）の分岐は取り込み機能ごと削除した。
 * ⚠ **ブラウザが先頭を選ぶ既定に依存しない**ことがこの関数の存在理由そのものである
 * （＝ `!isObsSourceMissingFromList(...)` を外す変異が、選択肢の中身に関わらず必ずレッドになる）。
 */
export function effectSelectValue(
  effect: EffectAssignment,
  // ⚠ 省略できる（一覧を持たない画面・テストのため）。
  //   省略時は**一覧が空**と同じ＝ OBS ソースの割り当ては `NONE_VALUE` へ落ちる。
  obsSources: readonly { name: string }[] = [],
): string {
  if (effect.kind === "obs-source") {
    return !isObsSourceMissingFromList(effect, obsSources)
      ? `${OBS_SOURCE_PREFIX}${effect.sourceName}`
      : NONE_VALUE;
  }
  return NONE_VALUE;
}

/**
 * 064b: 割り当て先が **OBS から取れた一覧に載っていない**か。
 *
 * ⚠⚠ **表示の受け皿をどこへ落とすか**を決める述語で、
 * 「無い」という断言（警告文）とは別の判断である。断言してよいのは
 * **一覧を 1 度でも取れているとき**だけで、その組み合わせは呼び出し側が行う。
 * ⚠ **一覧をまだ取っていない状態と「OBS から消えた」状態は区別できない**——
 * OBS の一覧は 064a のボタンでしか更新されないので、**未取得なら全部「無い」に見える**。
 * ⇒ 警告を出す条件は `EffectAssignmentCard` 側が持つ（`listState === "ready"` と同じ形）。
 */
export function isObsSourceMissingFromList(
  effect: EffectAssignment,
  obsSources: readonly { name: string }[],
): boolean {
  return (
    effect.kind === "obs-source" &&
    !obsSources.some((s) => s.name === effect.sourceName)
  );
}

/**
 * 064b: `<select>` の `value` → 割り当ての値（[`effectSelectValue`] の逆）。
 *
 * ⚠⚠ **組み立てと分解を 1 つのモジュールに閉じるために足した。** 061j (0) が
 * 「組み立てが 2 か所になると規則が片方だけ緩む」と書いたのと同じ理由で、
 * **分解を `EffectAssignmentCard` 側に書かない**（あちらは `onChange` の値をそのまま渡すだけ）。
 *
 * ⚠ **`obs:` の分解は `slice`**（[`OBS_SOURCE_PREFIX`] の注記が正）。
 * ⚠ 未知の値・空の名前はすべて **`{kind:"none"}`**（＝「出さない」へ倒す・061h からの向き）。
 */
export function effectSelectAssignment(value: string): EffectAssignment {
  if (value.startsWith(OBS_SOURCE_PREFIX)) {
    const sourceName = value.slice(OBS_SOURCE_PREFIX.length);
    // ⚠ 空名は保存層（`parseAssignment`）でも落ちるが、**ここでも作らない**
    //   （「出さない」へ倒すという答えを 1 つに保つ）。
    if (sourceName.length === 0) return { kind: "none" };
    return { kind: "obs-source", sourceName };
  }
  return { kind: "none" };
}
