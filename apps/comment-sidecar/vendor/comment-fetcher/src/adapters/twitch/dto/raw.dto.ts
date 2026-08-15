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
    event:
      | TwitchChatMessageEventDto
      | TwitchChatNotificationEventDto
      | TwitchBitsUseEventDto;
  };
};

/** 今回扱う EventSub サブスク種別。 */
export type TwitchEventSubSubscriptionType =
  | "channel.chat.message"
  | "channel.chat.notification"
  // 043a(拡張): Bits Power-ups（cheer は channel.chat.message 側で取得済のため mapper で二重計上回避）。
  | "channel.bits.use";

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
  // 043a: EventSub の channel.chat.notification が notice_type に応じて既に送っている付随オブジェクト
  // （新規受信ではなく未モデル化だったフィールドの取り回し）。mapper が階級/継続月数/ギフト件数を数値で拾う。
  // 受贈者（recipient_user_*）・贈与者（gifter_user_*）はペイロードに存在するが §9（非ログ・非外部送信）
  // 配慮で意図的にモデル化・消費しない（数値属性のみ持つ）。
  sub?: TwitchSubDetailsDto;
  resub?: TwitchResubDetailsDto;
  sub_gift?: TwitchSubGiftDetailsDto;
  community_sub_gift?: TwitchCommunitySubGiftDetailsDto;
  // 043a(拡張): prime→有料化（prime_paid_upgrade）は sub_tier のみ数値で拾う。gift_paid_upgrade は
  // 贈与者名しか持たない（§9 非モデル化）ため notice_type のみで subscription 分類する（付随オブジェクトなし）。
  prime_paid_upgrade?: TwitchPrimePaidUpgradeDetailsDto;
  // 043a(拡張): チャリティ実金銭ドネーション。amount を金額として拾う（charity_name は団体名＝PII でない）。
  charity_donation?: TwitchCharityDonationDetailsDto;
  // 062a: レイド（他チャンネルからの視聴者流入）。**収益ではない**が「誰がレイドしてくれたか」を記録する。
  // ⚠ 公式は `raid` を「Null if notice_type is not raid」と定義しており、共有チャット由来
  //   （notice_type=shared_chat_raid）では `raid` が null で `shared_chat_raid` 側に**同形**で載る。
  //   043a は shared_* の付随オブジェクトを未モデル化にして「数値内訳だけ undefined へ劣化・分類は維持」と
  //   したが、**レイドではその規律をそのまま踏襲できない**——付随オブジェクトが `author` そのもの
  //   （レイド元の user_id/user_name）を持つため、劣化すると「名前も ID も無いレイド行」になり行が成立しない。
  //   ＝劣化の質が違う（数値欠落 vs 主体の消失）ので、ここだけ shared 版も同一 DTO で受ける。
  raid?: TwitchRaidDetailsDto;
  shared_chat_raid?: TwitchRaidDetailsDto;
};

/**
 * channel.bits.use の event ペイロード（043a 拡張・Bits Power-ups）。
 * cheer もこの購読で届くが channel.chat.message 側で既に取得済のため mapper で type==="cheer" を捨てる
 * （二重計上回避）。power_up / custom_power_up（bits 消費）のみ取り込む。
 * ⚠ message_id はイベント本体に無いため、EventSub envelope の metadata.message_id を websocket client 側で
 *   補填する（dedup 用の一意キー）。受贈者名等の個人名は持たない（§9・投稿者=bits 使用者のみ）。
 */
export type TwitchBitsUseEventDto = {
  broadcaster_user_id: string;
  broadcaster_user_login: string;
  broadcaster_user_name: string;
  user_id: string;
  user_login: string;
  user_name: string;
  bits: number;
  type: "cheer" | "power_up" | (string & {});
  power_up?: {
    type?: string;
  };
  message?: {
    text: string;
    fragments: TwitchChatMessageFragmentDto[];
  };
  // websocket client が envelope の metadata.message_id を補填する（イベント本体には無い）。
  message_id: string;
};

/**
 * chat notification の既知種別。
 * 043a: sub/resub/sub_gift/community_sub_gift/pay_it_forward（従来）。
 * 043a(拡張): charity_donation（実金銭ドネーション）・gift_paid_upgrade / prime_paid_upgrade（有料化）を追加。
 *   共有チャット中は同じ収益イベントが `shared_chat_*` の別 notice_type で届くため、mapper が接頭辞を剥がして
 *   同一に分類する（取りこぼし防止）。非収益（announcement 等）は mapper 側で null に落とす。
 * 062a: **raid を明示的に収載する**（`(string & {})` のフォールバックに頼らない）。
 *   ⚠ **`unraid` は別の値であって raid ではない**（公式の notice_type 一覧に独立して存在する）。
 *   ここに収載しないことと、mapper の `RAID_NOTICE_TYPES` が**完全一致の Set**であることの二段で落とす。
 *   ⚠ その他の非収益（announcement / bits_badge_tier / watch_streak / modiversary / unknown）も従来どおり落とす。
 */
export type TwitchChatNoticeType =
  | "sub"
  | "resub"
  | "sub_gift"
  | "community_sub_gift"
  | "pay_it_forward"
  | "gift_paid_upgrade"
  | "prime_paid_upgrade"
  | "charity_donation"
  | "raid"
  | `shared_chat_${string}`
  | (string & {});

/** サブスク階級（"1000"=Tier1 / "2000"=Tier2 / "3000"=Tier3）。未知値も受ける。 */
export type TwitchSubTier = "1000" | "2000" | "3000" | (string & {});

/** notice_type=sub の付随情報。 */
export type TwitchSubDetailsDto = {
  sub_tier: TwitchSubTier;
  // 【レビュー対応・修正不要】is_prime は受信・モデル化するが現状マッパでは未活用。Prime サブ（視聴者に金銭負担なし）も
  //   通常サブと同じく subscription＋赤枠（お金扱い）で強調され「お金がかかる」観点ではやや過大だが、現状は全 sub を等しく
  //   見逃し防止対象とする product 判断。再修正トリガー: Prime を強調除外/淡色化したくなったら is_prime を wire/表示へ通す。
  is_prime: boolean;
  duration_months: number;
};

/** notice_type=resub の付随情報。 */
export type TwitchResubDetailsDto = {
  sub_tier: TwitchSubTier;
  cumulative_months: number;
  duration_months: number;
};

/** notice_type=sub_gift の付随情報（受贈者フィールドは §9 配慮で持たない）。 */
export type TwitchSubGiftDetailsDto = {
  sub_tier: TwitchSubTier;
  duration_months: number;
};

/** notice_type=community_sub_gift の付随情報（受贈者は不特定・total＝件数）。 */
export type TwitchCommunitySubGiftDetailsDto = {
  sub_tier: TwitchSubTier;
  total: number;
};

/** notice_type=prime_paid_upgrade の付随情報（Prime→有料サブへ転換・階級のみ）。 */
export type TwitchPrimePaidUpgradeDetailsDto = {
  sub_tier: TwitchSubTier;
};

/**
 * notice_type=charity_donation の付随情報（Twitch チャリティへの実金銭ドネーション）。
 * amount は最小単位整数 value と decimal_places で表現される（例 value=550, decimal_places=2 → 5.50）。
 * charity_name は寄付先団体名（個人名ではない）。受贈者/贈与者の個人名は持たない（§9）。
 */
export type TwitchCharityDonationDetailsDto = {
  // 【レビュー対応・修正不要】charity_name は寄付先「団体名」（個人名ではない）。mapper（mapCharityAmount）は
  //   意図的に amount(value/decimal_places/currency) のみを消費し、本フィールドは消費しない＝wire/Rust/DB/ログへ
  //   一切流さない（§9 衛生）。宣言はペイロード形の記録用に留める。
  //   再修正トリガー: 将来 charity_name を表示等で消費するなら、§9（団体名の取り回し）影響を再評価してから解禁する。
  charity_name?: string;
  amount: {
    value: number;
    decimal_places: number;
    currency: string;
  };
};

/**
 * notice_type=raid / shared_chat_raid の付随情報（062a）。
 *
 * 公式（EventSub リファレンス Channel Chat Notification Event）の `raid` オブジェクトは
 * **`user_id` / `user_name` / `user_login` / `viewer_count` / `profile_image_url` の 5 つ**を持ち、
 * user 系はいずれも「the broadcaster raiding this channel」＝**レイド元の配信者**と明記されている。
 * そのうち本 DTO が宣言するのは **3 つだけ**。
 *
 * ⚠⚠ **`profile_image_url` は「無い」のではなく「在るが取らない」**（§9）。043a が
 * `sub_gift` / `community_sub_gift` の受贈者（`recipient_user_*`）・贈与者（`gifter_user_*`）について
 * 「ペイロードに存在するが §9 配慮で意図的にモデル化・消費しない」と決めたのと**同じ形**である。
 * アバターの取得は 036b/036c の基盤（Helix で解決 → allow-list ホストから fetch → data URI 化）に限り、
 * ここから別経路で URL を持ち出すと **CSP・§9 の論点が新しく生える**（`gift_url` を 043d が
 * 意図的に除外したのと同じ理由）。**視聴者メモリにアバターを保存しない**方針も不変。
 * 再修正トリガー: レイド元のアイコンを出したくなったら、036b/036c と同様に
 * allow-list 追加＋data URI 化＋再 security-review を通してから解禁する。
 *
 * ⚠ `user_login` も宣言しない（表示にも保存にも使わないため。表示名は `user_name` で足りる）。
 */
export type TwitchRaidDetailsDto = {
  /** レイド元配信者のユーザー ID（"The user ID of the broadcaster raiding this channel."）。 */
  user_id: string;
  /** レイド元配信者の表示名（"The user name of the broadcaster raiding this channel."）。 */
  user_name: string;
  /** レイド人数（"The number of viewers in the raid."）。 */
  viewer_count: number;
};

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
