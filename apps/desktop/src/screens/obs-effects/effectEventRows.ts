import { EVENT_LABEL, MONETARY_EVENT_TYPES } from "../comment-viewer/viewerFormat";

/**
 * 061d-2: 割り当て表の**行の定義**（イベント種別 → 画面に出す名前）。
 *
 * ⚠⚠ **行は `MONETARY_EVENT_TYPES` から機械的に作る。** 「条件を追加」ボタンで行を増やす形にしない
 * ——種別は固定 6 値なので**最初から全部並んでいる**のが最も簡単で、たぬえさ3 の
 * 「タグをコピペで増やす」の逆をやるのが 061d の狙いそのもの（(2) の判断）。
 * ⚠ `MONETARY_EVENT_TYPES` に 7 種別目が増えたら**行も自動で増える**
 * （`EffectAssignmentCard.test.tsx` が行の集合と `MONETARY_EVENT_TYPES` の一致を固定している）。
 *
 * ⚠ **ラベルの出所は `EVENT_LABEL`**（コメント一覧・ティッカー・読み上げと同じ表）。
 * ここで新しい呼び名を発明しない。
 */

/**
 * 画面に出す名前。⚠ **superchat だけ `EVENT_LABEL` をそのまま使わない。**
 *
 * ⚠⚠ ビッツは wire 上 `eventType === "superchat"`（`currency === "BITS"`）で届き、
 * `MONETARY_EVENT_TYPES` に `"bits"` は**無い**（`displayEventType` がラベル用に振り替えているだけ）。
 * ＝ **スーパーチャットの行に割り当てるとビッツにも効く**ので、そう書かないと嘘になる。
 * 061b はこの非対称を課金判定で踏んでいる（`isMonetaryEvent(c.eventType)` が正しく、
 * `displayEventType` を通すとビッツでエフェクトが出なくなる）。**同じ罠がここにもある。**
 */
export const EFFECT_EVENT_LABEL: Record<string, string> = {
  ...EVENT_LABEL,
  superchat: "スーパーチャット・ビッツ",
};

/** 割り当て表の行（`MONETARY_EVENT_TYPES` の挿入順＝`viewerFormat.ts` の並び）。 */
export const EFFECT_EVENT_ROWS: readonly { eventType: string; label: string }[] =
  [...MONETARY_EVENT_TYPES].map((eventType) => ({
    eventType,
    label: EFFECT_EVENT_LABEL[eventType] ?? eventType,
  }));

/**
 * 063d: 条件 1 件を**人に読める 1 行**にする（削除確認で「どの条件が使っているか」を出すため）。
 *
 * ⚠⚠ **新しい呼び名を発明しない**——イベントは [`EFFECT_EVENT_LABEL`]、
 * キーワードは**ユーザーが打った文字列そのもの**を出す（画面の入力欄と同じ値なので、
 * 別の言い方にすると「どの行のことか」が分からなくなる）。
 * ⚠ キーワードは**ユーザー自身の UI 設定値**であり、第三者のコメント本文ではない（§9 の対象外）。
 *
 * ⚠ 置き場所がここなのは、[`EFFECT_EVENT_LABEL`] の**唯一の持ち主**だからである
 * （`GachaLibraryCard` 側で `EFFECT_EVENT_LABEL[...] ?? ...` を書き直さない）。
 */
export function conditionLabel(condition: {
  when: { type: "event"; eventType: string } | { type: "keyword"; text: string };
}): string {
  if (condition.when.type === "event") {
    const { eventType } = condition.when;
    return EFFECT_EVENT_LABEL[eventType] ?? eventType;
  }
  return `キーワード「${condition.when.text}」`;
}
