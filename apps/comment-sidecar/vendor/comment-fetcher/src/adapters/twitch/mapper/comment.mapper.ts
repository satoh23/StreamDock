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

/** Twitch EventSub のチャットイベント配列を共通コメント配列へ変換する。 */
export function mapTwitchChatEventsToComments(
  events: TwitchChatEventDto[],
): Comment[] {
  return events
    .map((event) => mapTwitchChatEventToComment(event))
    .filter((comment): comment is Comment => comment !== null);
}

/** Twitch EventSub の単一チャットイベントを共通コメントへ変換する。 */
function mapTwitchChatEventToComment(
  event: TwitchChatEventDto,
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
