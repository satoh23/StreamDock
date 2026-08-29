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
      | TwitchBitsUseEventDto
      // 063e: チャンネルポイントの引き換え。
      | TwitchChannelPointsRedemptionEventDto;
  };
};

/** 今回扱う EventSub サブスク種別。 */
export type TwitchEventSubSubscriptionType =
  | "channel.chat.message"
  | "channel.chat.notification"
  // 043a(拡張): Bits Power-ups（cheer は channel.chat.message 側で取得済のため mapper で二重計上回避）。
  | "channel.bits.use"
  // 063e: チャンネルポイント報酬の引き換え（**カスタム報酬のみ**）。
  // ⚠⚠ **自動報酬（`channel.channel_points_automatic_reward_redemption.add`）は別の購読種別であり、
  //   これでは受け取れない**（公式 EventSub Subscription Types で独立して定義されている）。ここに足さないこと。
  | "channel.channel_points_custom_reward_redemption.add";

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
 * channel.channel_points_custom_reward_redemption.add の event ペイロード（063e・チャンネルポイントの引き換え）。
 *
 * ⚠⚠ **`reward` は「無い」のではなく「在るが取らない」**（§9）。段 1 は**報酬を区別しない**
 * （「チャンネルポイント」1 行で全報酬をまとめて受ける）ので、報酬名を宣言する必要が無い。
 * 043a が `sub_gift` の受贈者（`recipient_user_*`）について、062a が `raid.profile_image_url` について
 * 採ったのと**同じ線**である＝宣言しなければ wire にも DB にもログにも構造的に到達しない。
 * ⚠ 報酬名ごとの出し分けは **063e 段 3** の領分。
 * ✅ **2026-08-26: 穴 G は解決した**——`reward` は **`{ id, title, cost, prompt }`** を持つことを
 *   2 つの独立した一次情報で確認済み（`twitch_api` crate の型定義／**公式 Twitch CLI** の
 *   `internal/events/types/channel_points_redemption/redemption_event.go` が emit するフィールド）。
 *   ⇒ **段 3 は Helix の追加呼び出しを必要としない**（報酬名はイベントに載っている）。
 * ⚠ ペイロードは他に `status`（`unknown`/`unfulfilled`/`fulfilled`/`canceled`・既定 `unfulfilled`）と
 *   `redeemed_at`（RFC3339）を持つ。**どちらも宣言しない**（下記の理由）。
 * ⚠ `status`（unfulfilled/fulfilled/canceled）も宣言しない。購読するのは **`.add`（引き換えの発生）だけ**で、
 *   消化・返却（`channel:manage:redemptions`）は**取らない**と決めているため、状態を見る意味が無い。
 * ⚠ `redeemed_at` も取らない（`publishedAt` は他種別と同じく mapper が受信時刻で埋める＝経路を揃える）。
 *
 * ⚠ **`id` はイベント本体が持つ**ので、`channel.bits.use` のような
 *   `metadata.message_id` の補填（websocket client 側）は**要らない**。
 * ⚠⚠ **`user_input` は視聴者が打った文字列**で、テキスト入力を求めない報酬では**空文字**になる。
 *   その場合の扱い（配信画面に出さない）は mapper と `CommentList.tsx` のコメントが正。
 */
export type TwitchChannelPointsRedemptionEventDto = {
  /**
   * 引き換え 1 件の一意 ID（重複排除のキー）。
   *
   * ⚠⚠ **欠けたときの壊れ方が静かなので、client 側で保険の補填をしている**（段 1-b）。
   * Rust の `CommentViewDto.id` は必須なので、ここが `undefined` のまま wire に出ると
   * `record_comment` のデシリアライズが DTO ごと失敗する。⚠ `record_comment` は
   * frontend から fire-and-forget で呼ばれる＝**失敗しても画面には何も出ない**。
   * ⇒ `repairNotificationEvent`（`eventsub-websocket.client.ts`）が
   * `metadata.message_id` から補填する（`channel.bits.use` の `message_id` 補填と同じ形）。
   */
  id: string;
  broadcaster_user_id: string;
  broadcaster_user_login: string;
  broadcaster_user_name: string;
  /** 引き換えた視聴者のユーザー ID。 */
  user_id: string;
  user_login: string;
  /** 引き換えた視聴者の表示名。 */
  user_name: string;
  /**
   * 視聴者が報酬に添えたテキスト（テキスト入力を求めない報酬では空文字）。
   *
   * ## ⚠⚠ 2026-08-26 訂正: 公式仕様は `string`（未入力なら**空文字**）である
   *
   * ⚠ 段 1-b はここを `?: string | null` にした根拠として「`null` の実例報告がある」と書いていたが、
   * ⚠⚠⚠ **その実例は自動報酬（`channel.channel_points_automatic_reward_redemption.add`）のもので、
   * 本購読（カスタム報酬）とは別のイベントだった**（＝根拠として不正確だった）。
   * 一次確認できた仕様は 2 つの独立した出所で一致しており、いずれも
   * **`user_input: string` / "Empty string if not provided"** である。
   *
   * ## ⚠ それでも `?: string | null` のままにしている理由
   *
   * **実機で確認できないから**である（チャンネルポイントは新規チャンネルでは有効化されておらず、
   * 依頼者の環境では引き換えを 1 度も起こせない）。⚠ 仕様を信じて外したときの症状は**無言**で、
   * 段 1 の mapper は `typeof user_input === "string"` を**種別の判別材料そのもの**に使っていたため、
   * 仮に `null` やキー欠落が 1 度でも来ると、そのイベントは
   * **チャンネルポイントとして認識されず → chat フォールバックで `null` に落ち → 静かに消える**。
   * ⚠ 広く受けておく側の costs はゼロ（読むときに空文字へ倒すだけ）なので、非対称な賭けとして受ける側を選ぶ。
   * ⇒ 三段で殺す:
   *   ①`repairNotificationEvent` が受信直後に `string` へ正規化する（`metadata.subscription_type` が根拠）
   *   ②mapper の判別材料から**外す**（`id` ＋ `user_id` で判別する）
   *   ③mapper が本文として読むときに `""` へ倒す
   * ⚠ ①だけでは足りない——mapper は client を経由しない呼び出し（テスト・将来の別経路）でも正しく動くべきで、
   *   **判別が 1 本の推測にぶら下がっている状態そのもの**が穴だった。
   */
  user_input?: string | null;
  /**
   * 報酬（⚠⚠⚠ **063e 段 3 で「在るが取らない」を意図的にまたいだ**）。
   *
   * ## ⚠⚠ 取るのは `title` **だけ**である
   *
   * 段 1 は `reward` を丸ごと宣言せず、043a の受贈者名・062a の `profile_image_url` と同じ
   * 「**在るが、取らない**」の線に置いていた。⚠ 段 3 がその線を動かしたのは、
   * **「ガチャ用の報酬だけに反応させたい」を実現する材料が他に無い**からである
   * （依頼者＝「**どのチャンネルポイント交換に紐づけるかをユーザーが設定できるようにして欲しい**」）。
   * ⚠⚠ 購読の `condition` は `broadcaster_user_id` だけなので、
   * **カスタム報酬すべての引き換えが届く**——絞る材料がここにしか無い。
   *
   * ⚠⚠⚠ **`id` / `cost` / `prompt` は宣言しない**（線は 1 つ動かしたが、動かしたのは 1 つだけである）:
   *   - `id` … UUID で**ユーザーが画面に打てない**＝設定の材料にならない（`title` で一致させる）
   *   - `cost` … 出し分けに要らない（値段で分ける要望は出ていない）
   *   - `prompt` … ⚠ **報酬の説明文**で、出し分けにも表示にも使わない
   * ⚠ `status` / `redeemed_at` も引き続き宣言しない（上の JSDoc が正）。
   *
   * ## ⚠ §9 の重さは変わっていない
   *
   * ⚠⚠ **`title` は配信者自身が Twitch で付けた名前**であって、第三者が打った文字列ではない
   * （`user_input` とは性質がまったく違う）。⇒ 演出の `prizeLabel` や OBS のソース名と同じ
   * 「**ユーザー自身の設定値**」の側であり、§9 が守っている第三者データの線は動いていない。
   *
   * ⚠ **`title` が非文字列・欠落で届いても落ちない**こと（mapper 側で `undefined` へ倒す）。
   *   報酬名が取れない引き換えは「**報酬を指定した条件には当たらない／未指定の条件には当たる**」に倒れる。
   */
  reward?: { title?: string | null } | null;
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
