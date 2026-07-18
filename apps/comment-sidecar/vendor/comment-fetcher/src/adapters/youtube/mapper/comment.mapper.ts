import type {
  Comment,
  MonetaryAmount,
} from "../../../entities/comment/comment.js";
import { COMMENT_EVENT_TYPES, COMMENT_SOURCES } from "@comment-dock/shared";
import type {
  YouTubeLiveChatMessagesListResponseDto,
  YouTubeSuperChatDetailsDto,
  YouTubeSuperStickerDetailsDto,
} from "../dto/raw.dto.js";

const YOUTUBE_MESSAGE_TYPE_TO_COMMENT_EVENT_TYPE = {
  TEXT_MESSAGE_EVENT: COMMENT_EVENT_TYPES.NORMAL,
  SUPER_CHAT_EVENT: COMMENT_EVENT_TYPES.SUPER_CHAT,
  // TODO: 将来的に Super Sticker 専用イベント型が必要になれば分離を検討する。
  SUPER_STICKER_EVENT: COMMENT_EVENT_TYPES.SUPER_CHAT,
  // TODO: 将来的に新規メンバー加入専用イベント型が必要になれば分離を検討する。
  NEW_SPONSOR_EVENT: COMMENT_EVENT_TYPES.SUBSCRIPTION,
  // TODO: 将来的に継続マイルストーン専用イベント型が必要になれば分離を検討する。
  MEMBER_MILESTONE_CHAT_EVENT: COMMENT_EVENT_TYPES.SUBSCRIPTION,
} as const;

/** 配信コメントの取得結果を、共通コメント配列へ変換する。 */
export function mapYouTubeLiveChatMessagesToComments(
  response: YouTubeLiveChatMessagesListResponseDto,
): Comment[] {
  return response.items
    .map((message) => {
      // 削除/撤回/BAN などの本文なしイベントは snippet や author_details が欠けるため除外する。
      if (!message?.snippet || !message.author_details) {
        return null;
      }

      // 未対応の message type は業務イベントへ変換できないため除外する。
      if (
        !(message.snippet.type in YOUTUBE_MESSAGE_TYPE_TO_COMMENT_EVENT_TYPE)
      ) {
        return null;
      }

      const eventType =
        YOUTUBE_MESSAGE_TYPE_TO_COMMENT_EVENT_TYPE[
          message.snippet
            .type as keyof typeof YOUTUBE_MESSAGE_TYPE_TO_COMMENT_EVENT_TYPE
        ];

      const publishedAt = new Date(message.snippet.published_at);
      if (Number.isNaN(publishedAt.getTime())) {
        return null;
      }

      const comment: Comment = {
        id: message.id,
        source: COMMENT_SOURCES.YOUTUBE,
        author: {
          id: message.author_details.channel_id,
          name: message.author_details.display_name,
        },
        text: message.snippet.display_message,
        publishedAt,
        eventType,
        monetaryAmount: mapMonetaryAmount(
          message.snippet.super_chat_details ??
            message.snippet.super_sticker_details,
        ),
      };

      return comment;
    })
    .filter((comment): comment is Comment => comment !== null);
}

/** 金額情報を通常単位へ変換する。変換できない値は undefined。 */
function mapMonetaryAmount(
  detail?: YouTubeSuperChatDetailsDto | YouTubeSuperStickerDetailsDto,
): MonetaryAmount | undefined {
  if (!detail) {
    return undefined;
  }

  const amountMicros = Number(detail.amount_micros);
  if (!Number.isFinite(amountMicros)) {
    return undefined;
  }

  return {
    currency: detail.currency,
    amount: amountMicros / 1_000_000,
  };
}
