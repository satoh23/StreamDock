import type { User } from "../user/user.js";
import type { CommentEventType, CommentSource } from "@comment-dock/shared";

export type MonetaryAmount = {
  currency: string;
  amount: number;
};

/**
 * 取得元に依存しない、comment-fetcher内の共通ドメイン。
 * ユースケース層はこの型だけを扱う。
 */
export type Comment = {
  id: string;
  source: CommentSource;
  author: User;
  text: string;
  publishedAt: Date;
  eventType: CommentEventType;
  monetaryAmount?: MonetaryAmount;
  // 043a: メンシプ／サブスク／ギフトの付随数値（受信済みフィールドの取り回しのみ・受贈者名は保持しない＝§9）。
  /** メンバー／サブスク継続月数（YouTube member_month・Twitch cumulative_months）。 */
  monthCount?: number;
  /** ギフト件数（Twitch community_sub_gift の total・単発 sub_gift は 1）。 */
  giftCount?: number;
  /** サブスク階級（Twitch sub_tier "1000"/"2000"/"3000" → 1/2/3）。 */
  tier?: number;
  /**
   * 043e: Jewels の combo（連続ギフト）回数（YouTube combo_count・単発/未設定は undefined）。
   * 表示用の観測値で**金額計算には使わない**（フェーズ1）。
   */
  comboCount?: number;
  /**
   * 062a: レイド人数（Twitch `raid.viewer_count`・raid 以外は undefined）。
   *
   * ⚠⚠ **ここから wire までの中継 3 層（converter → CommentViewDto → wire.ts）はいずれも
   * フィールドを明示列挙して詰め替える**ので、1 箇所でも書き漏らすと**型検査もテストも通るのに
   * 値だけが静かに消える**（036b の `avatar` と同じ落ち方）。取りこぼしゼロは
   * `scripts/test-comment-relay.mjs` の `RELAYED_NUMERIC_FIELDS` が固定している。
   */
  raidViewerCount?: number;
  /**
   * ⚠⚠⚠ 063e 段 3: **引き換えた報酬の名前**（channelpoint 以外は undefined）。
   *
   * ⚠ 配信者が Twitch で付けた名前であり、**ユーザー自身の設定値**である（第三者データではない）。
   * 用途は 1 つだけ＝**「ガチャ用の報酬だけに反応させる」ための照合**
   * （`effectAssignments.ts` の `when.rewardTitle`）。
   * ⚠⚠ **端末には保存しない**（`monthCount` / `giftCount` / `tier` と同じ扱い。
   * `raidViewerCount` だけが保存される側で、あちらは「配信終わりに見返す」用途があるため）。
   *
   * ⚠⚠ 中継 3 層（converter → CommentViewDto → wire.ts）はフィールドを明示列挙して詰め替えるので、
   * 1 箇所でも書き漏らすと**型検査もテストも通るのに値だけが静かに消える**。
   * 取りこぼしゼロは `scripts/test-comment-relay.mjs` が固定している。
   */
  rewardTitle?: string;
};
