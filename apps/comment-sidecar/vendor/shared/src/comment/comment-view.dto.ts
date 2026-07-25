import type { UserSummaryDto } from "../user/user-summary.dto.js";
import type { CommentEventType, CommentSource } from "./comment-types.js";

export type CommentMonetaryAmountDto = {
  currency: string;
  amount: number;
};

/**
 * 画面描画専用の共通DTO。
 * YouTube/Twitchどちらのコメントでも、この型へ変換して表示層へ渡す。
 */
export type CommentViewDto = {
  id: string;
  source: CommentSource;
  author: UserSummaryDto;
  text: string;
  publishedAt: string;
  eventType: CommentEventType;
  monetaryAmount?: CommentMonetaryAmountDto;
  // 043a: メンシプ／サブスク／ギフトの付随数値（表示用・受贈者名は持たない＝§9）。
  /** メンバー／サブスク継続月数。 */
  monthCount?: number;
  /** ギフト件数（community_sub_gift の total・単発 sub_gift は 1）。 */
  giftCount?: number;
  /** サブスク階級（1/2/3）。 */
  tier?: number;
};
