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
};
