import { COMMENT_EVENT_TYPES, COMMENT_SOURCES } from "@comment-dock/shared";
import type {
  Comment,
  MonetaryAmount,
} from "../../../entities/comment/comment.js";
import type {
  TwitchChatMessageEventDto,
  TwitchChatNotificationEventDto,
  TwitchChatNoticeType,
} from "../dto/raw.dto.js";

type TwitchChatEventDto =
  | TwitchChatMessageEventDto
  | TwitchChatNotificationEventDto;

const SUBSCRIPTION_NOTICE_TYPES: ReadonlySet<TwitchChatNoticeType> = new Set([
  "sub",
  "resub",
  "sub_gift",
  "community_sub_gift",
  "pay_it_forward",
]);

/**
 * 036c: chatter_user_id からアバター URL（ドメイン値）を引く解決関数。
 * chat イベントにアバターが載らない Twitch では repository が Helix で解決して渡す。
 */
type ResolveAvatarUrl = (chatterUserId: string) => string | undefined;

/** Twitch EventSub のチャットイベント配列を共通コメント配列へ変換する。 */
export function mapTwitchChatEventsToComments(
  events: TwitchChatEventDto[],
  resolveAvatar?: ResolveAvatarUrl,
): Comment[] {
  return events
    .map((event) => mapTwitchChatEventToComment(event, resolveAvatar))
    .filter((comment): comment is Comment => comment !== null);
}

/** Twitch EventSub の単一チャットイベントを共通コメントへ変換する。 */
function mapTwitchChatEventToComment(
  event: TwitchChatEventDto,
  resolveAvatar?: ResolveAvatarUrl,
): Comment | null {
  if (isNotificationEvent(event)) {
    if (!SUBSCRIPTION_NOTICE_TYPES.has(event.notice_type)) {
      return null;
    }

    return {
      id: event.message_id,
      source: COMMENT_SOURCES.TWITCH,
      author: {
        id: event.chatter_user_id,
        name: event.chatter_user_name,
        // 036c: 取得元の画像 URL（ドメイン値）。data URI 化は配信境界の converter が担う。
        avatar: resolveAvatar?.(event.chatter_user_id),
      },
      text: event.message.text || event.system_message,
      publishedAt: new Date(),
      eventType: COMMENT_EVENT_TYPES.SUBSCRIPTION,
    };
  }

  return {
    id: event.message_id,
    source: COMMENT_SOURCES.TWITCH,
    author: {
      id: event.chatter_user_id,
      name: event.chatter_user_name,
      // 036c: 取得元の画像 URL（ドメイン値）。data URI 化は配信境界の converter が担う。
      avatar: resolveAvatar?.(event.chatter_user_id),
    },
    text: event.message.text,
    publishedAt: new Date(),
    eventType:
      event.cheer && event.cheer.bits > 0
        ? COMMENT_EVENT_TYPES.SUPER_CHAT
        : COMMENT_EVENT_TYPES.NORMAL,
    monetaryAmount: mapBitsToMonetaryAmount(event.cheer?.bits),
  };
}

function isNotificationEvent(
  event: TwitchChatEventDto,
): event is TwitchChatNotificationEventDto {
  return "notice_type" in event;
}

function mapBitsToMonetaryAmount(bits?: number): MonetaryAmount | undefined {
  if (!bits || bits <= 0) {
    return undefined;
  }

  return {
    currency: "BITS",
    amount: bits,
  };
}
