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
};
