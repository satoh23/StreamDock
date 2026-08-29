import {
  EVENT_LABEL,
  EFFECT_CONDITION_EVENT_TYPES,
} from "../comment-viewer/viewerFormat";

/**
 * 061d-2: 割り当て表の**行の定義**（イベント種別 → 画面に出す名前）。
 *
 * ⚠⚠ 行は「条件を追加」ボタンで増やす形にしない——種別は固定なので**最初から全部並んでいる**のが
 * 最も簡単で、たぬえさ3 の「タグをコピペで増やす」の逆をやるのが 061d の狙いそのもの（(2) の判断）。
 *
 * ⚠ **ラベルの出所は `EVENT_LABEL`**（コメント一覧・ティッカー・読み上げと同じ表）。
 * ここで新しい呼び名を発明しない。
 *
 * ⚠⚠ **063e 段 2 で行の集合が `MONETARY_EVENT_TYPES` から `EFFECT_CONDITION_EVENT_TYPES` へ替わった。**
 * あちらは「これはお金か？」に答える集合で、チャンネルポイントは**条件表には出したいが、お金ではない**
 * （＝赤枠も投げ銭音も出してはいけない）。分けた理由の全文は
 * `viewerFormat.ts` の `EFFECT_CONDITION_EVENT_TYPES` の JSDoc が正。
 * ⚠⚠⚠ **段 3-c で `channelpoint` はその集合から外れた**（＝ここの行にも出ない）。
 * チャンネルポイントは **カスタム報酬ごとの条件**（`{type:"channelpoint"; rewardTitle}`）で扱う。
 * ⚠ **2 つの集合はいま偶然おなじ中身だが、統合しないこと**（`viewerFormat.ts` の JSDoc が正）。
 */

/**
 * 画面に出す名前。⚠ **superchat だけ `EVENT_LABEL` をそのまま使わない。**
 *
 * ⚠⚠ ビッツは wire 上 `eventType === "superchat"`（`currency === "BITS"`）で届き、
 * `MONETARY_EVENT_TYPES` にも `EFFECT_CONDITION_EVENT_TYPES` にも `"bits"` は**無い**
 * （`displayEventType` がラベル用に振り替えているだけ）。
 * ＝ **スーパーチャットの行に割り当てるとビッツにも効く**ので、そう書かないと嘘になる。
 * 061b はこの非対称を課金判定で踏んでいる（`isMonetaryEvent(c.eventType)` が正しく、
 * `displayEventType` を通すとビッツでエフェクトが出なくなる）。**同じ罠がここにもある。**
 */
export const EFFECT_EVENT_LABEL: Record<string, string> = {
  ...EVENT_LABEL,
  superchat: "スーパーチャット・ビッツ",
};

/**
 * 割り当て表の行（`EFFECT_CONDITION_EVENT_TYPES` の挿入順＝`viewerFormat.ts` の並び）。
 *
 * ## ⚠⚠⚠ 063e 段 2 で判明: **プロダクションの消費者は 1 つも無い**
 *
 * ⚠ 画面の行を実際に作っているのは **`effectAssignments.ts` の `parseConditions`** である
 * （`EffectAssignmentCard` は `loadEffectConditions()` の結果を `when.type === "event"` で絞って描き、
 * ラベルだけ下の [`EFFECT_EVENT_LABEL`] を引く）。
 * ⚠ 061d-2 の当時はここが行の出所だったが、**061j で条件が配列になったときに主導権が
 * `parseConditions` へ移り、この定数は取り残された**（＝ 063e 段 2 の変異テストで発見した:
 * ここを `MONETARY_EVENT_TYPES` へ戻す変異が**全テスト緑のまま通った**）。
 *
 * ⚠⚠ **ここだけを直しても画面は 1 ピクセルも変わらない。** 行の集合を変えるときは
 * **必ず `EFFECT_CONDITION_EVENT_TYPES` を変えること**（両方がそれを見ているので、そうすれば揃う）。
 * ⚠ 残しているのは、`EffectAssignmentCard.test.tsx` が**「画面が実際に描いた行」と突き合わせる鏡**
 * として使っているためである。
 *
 * ## ⚠⚠⚠ ただし「鏡」としての価値はほぼ無い（レビュー Q-L1・2026-08-29 追記）
 *
 * ⚠ この定数と `parseConditions` は**どちらも `EFFECT_CONDITION_EVENT_TYPES` を見ている**ので、
 * 鏡が検出できるのは「片方だけラベル解決の仕方を変えた」場合だけである。
 * ⚠⚠ 実際、063e 段 2 の変異テストで **ここを `MONETARY_EVENT_TYPES` へ戻す変異が全緑で通った**
 * ——**鏡としても機能していなかった**ことが実証済みである。
 * **再修正トリガー＝いま**（063e 段 2 のスコープ外として見送っているだけ）。別タスクで、
 * `EffectAssignmentCard.test.tsx` を `EFFECT_CONDITION_EVENT_TYPES` から直接組み立て直し、
 * この定数を削除すること。⚠ **`EFFECT_EVENT_LABEL` の側には実消費者がある**
 * （`EffectAssignmentCard` が superchat の非対称ラベルを引く）ので、**ファイルごと消さないこと。**
 */
export const EFFECT_EVENT_ROWS: readonly { eventType: string; label: string }[] =
  [...EFFECT_CONDITION_EVENT_TYPES].map((eventType) => ({
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
 *
 * ## ⚠⚠⚠ 063e 段 3-b: **報酬ごとの条件（`channelpoint`）を足した**
 *
 * ⚠ **`tsc` がここを名指しで落として気づかせた**——引数の構造型に新しい variant が
 * 無かったため（`GachaLibraryCard` の呼び出しがコンパイルエラーになった）。
 * ⚠⚠ 落ちなかった場合の壊れ方は「**ガチャを消すときの『使っている条件』の一覧から、
 * 報酬ごとの紐づけだけが黙って抜ける**」＝ユーザーは**使用中と知らずに消す**。
 * ⇒ **この構造型を `EffectConditionWhen` へ緩めないこと**（緩めると次の variant で落ちなくなる）。
 *
 * ⚠ 出す文字列は**イベント名ではなく報酬名**である。同じチャンネルポイントに
 * 複数の紐づけがありうるので、「チャンネルポイント」だけだと**どの行か分からない**
 * （キーワード条件を「キーワード」と書かずに文字列ごと出しているのと同じ理由）。
 * ⚠⚠ 呼び方は「**カスタム報酬**」で揃えてある（画面の見出しと同じ語）——
 * この機能が反応するのは**カスタム報酬だけ**で、Twitch の自動報酬は別購読だからである
 * （理由の全文は `EffectAssignmentCard` の説明文の直上の注記が正）。
 */
export function conditionLabel(condition: {
  when:
    | { type: "event"; eventType: string }
    | { type: "keyword"; text: string }
    | { type: "channelpoint"; rewardTitle: string };
}): string {
  if (condition.when.type === "event") {
    const { eventType } = condition.when;
    return EFFECT_EVENT_LABEL[eventType] ?? eventType;
  }
  if (condition.when.type === "channelpoint") {
    return `カスタム報酬「${condition.when.rewardTitle}」`;
  }
  return `キーワード「${condition.when.text}」`;
}
