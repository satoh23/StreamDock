/**
 * Twitch EventSub / Helix レスポンスのうち、
 * 現時点の実装で必要なフィールドに絞ったプロバイダ固有DTO。
 *
 * 方針:
 * - DTO層は外部API仕様に寄せる。
 * - 業務判断（どのイベントを採用/除外するか）は mapper/usecase 層で行う。
 */

/** EventSub の message_type 定数。 */
export const TWITCH_EVENTSUB_MESSAGE_TYPES = {
  SESSION_WELCOME: "session_welcome",
  SESSION_KEEPALIVE: "session_keepalive",
  NOTIFICATION: "notification",
  SESSION_RECONNECT: "session_reconnect",
  REVOCATION: "revocation",
} as const;

/** EventSub WebSocket の envelope。 */
export type TwitchEventSubEnvelopeDto =
  | TwitchEventSubSessionWelcomeEnvelopeDto
  | TwitchEventSubKeepaliveEnvelopeDto
  | TwitchEventSubNotificationEnvelopeDto
  | TwitchEventSubReconnectEnvelopeDto
  | TwitchEventSubRevocationEnvelopeDto;

/** EventSub の keepalive 通知。 */
export type TwitchEventSubKeepaliveEnvelopeDto = {
  metadata: {
    message_type: typeof TWITCH_EVENTSUB_MESSAGE_TYPES.SESSION_KEEPALIVE;
    message_id: string;
  };
  payload: Record<string, never>;
};

/** EventSub セッション開始通知。 */
export type TwitchEventSubSessionWelcomeEnvelopeDto = {
  metadata: {
    message_type: typeof TWITCH_EVENTSUB_MESSAGE_TYPES.SESSION_WELCOME;
    message_id: string;
  };
  payload: {
    session: {
      id: string;
      keepalive_timeout_seconds: number;
      reconnect_url?: string | null;
    };
  };
};

/** EventSub の再接続通知。 */
export type TwitchEventSubReconnectEnvelopeDto = {
  metadata: {
    message_type: typeof TWITCH_EVENTSUB_MESSAGE_TYPES.SESSION_RECONNECT;
    message_id: string;
  };
  payload: {
    session: {
      id: string;
      reconnect_url: string;
    };
  };
};

/** EventSub サブスク失効通知。 */
export type TwitchEventSubRevocationEnvelopeDto = {
  metadata: {
    message_type: typeof TWITCH_EVENTSUB_MESSAGE_TYPES.REVOCATION;
    message_id: string;
    subscription_type: TwitchEventSubSubscriptionType;
  };
  payload: {
    subscription: {
      id: string;
      status: string;
      type: TwitchEventSubSubscriptionType;
      version: string;
      condition: Record<string, string>;
      transport: {
        method: "websocket";
        session_id: string;
      };
      cost: number;
      created_at: string;
    };
  };
};

/** EventSub イベント通知。 */
export type TwitchEventSubNotificationEnvelopeDto = {
  metadata: {
    message_type: typeof TWITCH_EVENTSUB_MESSAGE_TYPES.NOTIFICATION;
    message_id: string;
    subscription_type: TwitchEventSubSubscriptionType;
    subscription_version: string;
  };
  payload: {
    subscription: {
      id: string;
      type: TwitchEventSubSubscriptionType;
      version: string;
      status: string;
      condition: Record<string, string>;
      transport: {
        method: "websocket";
        session_id: string;
      };
    };
    event: TwitchChatMessageEventDto | TwitchChatNotificationEventDto;
  };
};

/** 今回扱う EventSub サブスク種別。 */
export type TwitchEventSubSubscriptionType =
  | "channel.chat.message"
  | "channel.chat.notification";

/** channel.chat.message の event ペイロード。 */
export type TwitchChatMessageEventDto = {
  broadcaster_user_id: string;
  broadcaster_user_login: string;
  broadcaster_user_name: string;
  chatter_user_id: string;
  chatter_user_login: string;
  chatter_user_name: string;
  message_id: string;
  message: {
    text: string;
    fragments: TwitchChatMessageFragmentDto[];
  };
  color: string;
  badges: TwitchChatBadgeDto[];
  cheer?: {
    bits: number;
  };
  reply?: {
    parent_message_id: string;
    parent_message_body: string;
    parent_user_id: string;
    parent_user_login: string;
    parent_user_name: string;
    thread_message_id: string;
    thread_user_id: string;
    thread_user_login: string;
    thread_user_name: string;
  };
  channel_points_custom_reward_id?: string;
  message_type:
    | "text"
    | "channel_points_highlighted"
    | "channel_points_sub_only"
    | (string & {});
};

/** channel.chat.notification の event ペイロード。 */
export type TwitchChatNotificationEventDto = {
  broadcaster_user_id: string;
  broadcaster_user_login: string;
  broadcaster_user_name: string;
  chatter_user_id: string;
  chatter_user_login: string;
  chatter_user_name: string;
  chatter_is_anonymous: boolean;
  color: string;
  badges: TwitchChatBadgeDto[];
  system_message: string;
  message_id: string;
  message: {
    text: string;
    fragments: TwitchChatMessageFragmentDto[];
  };
  notice_type: TwitchChatNoticeType;
};

/** chat notification の既知種別。 */
export type TwitchChatNoticeType =
  | "sub"
  | "resub"
  | "sub_gift"
  | "community_sub_gift"
  | "pay_it_forward"
  | (string & {});

/** message.fragments の1要素。 */
export type TwitchChatMessageFragmentDto = {
  type: "text" | "cheermote" | "emote" | "mention" | (string & {});
  text: string;
  mention?: {
    user_id: string;
    user_login: string;
    user_name: string;
  };
  cheermote?: {
    prefix: string;
    bits: number;
    tier: number;
  };
  emote?: {
    id: string;
    emote_set_id: string;
    owner_id: string;
    format: string[];
  };
};

/** バッジ情報。 */
export type TwitchChatBadgeDto = {
  set_id: string;
  id: string;
  info: string;
};

/** Helix users API レスポンス。 */
export type TwitchUsersResponseDto = {
  data: TwitchUserDto[];
};

/** Helix users API のユーザー要素。 */
export type TwitchUserDto = {
  id: string;
  login: string;
  display_name: string;
  // 036c: プロフィール画像 URL（`*.jtvnw.net`）。オーバーレイのアバター解決に使う。
  profile_image_url: string;
};

/** Helix streams API レスポンス。 */
export type TwitchStreamsResponseDto = {
  data: TwitchStreamDto[];
};

/** Helix streams API の配信要素。 */
export type TwitchStreamDto = {
  id: string;
  user_id: string;
  title: string;
};

/** Helix EventSub subscription 作成レスポンス。 */
export type TwitchEventSubSubscriptionsResponseDto = {
  data: Array<{
    id: string;
    status: string;
    type: TwitchEventSubSubscriptionType;
    version: string;
  }>;
};
