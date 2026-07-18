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
};
