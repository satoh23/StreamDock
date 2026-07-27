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
  // 043e: Jewels の combo（連続ギフト）回数。表示用の観測値で**金額計算には使わない**（フェーズ1）。
  /** combo 回数（YouTube Jewels の combo_count・単発/未設定は undefined）。 */
  comboCount?: number;
};
