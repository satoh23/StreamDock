export type CommentSource = "youtube" | "twitch";

// 043a: メンシプ／ギフトをサブスクから種別分離する。従来 3 値（normal/super_chat/subscription）に
// membership（YouTube NEW_SPONSOR/MEMBER_MILESTONE）・gift（Twitch sub_gift/community_sub_gift）を加える。
// 043a(拡張): donation（Twitch charity_donation＝チャリティ実金銭ドネーション）を追加。サブスク/ギフトと
// 明確に分離し、金額は monetaryAmount 経由で通す（団体名は本文以外で持ち回らない＝§9）。
// 043a(拡張): jewels（YouTube 縦型ライブの Jewels ギフト）を表示語彙として追加。**取得（ingestion）は 043d**
// （gRPC proto のフィールド番号が非公開のため未受信）で、現状は dev-mock のみが発行する（実データは 043d 後）。
// 062a: raid（Twitch のレイド）を追加。**収益種別ではない**（金額を持たず、視聴者メモリの
// subscription_count 等にも入らず、MONETARY_EVENT_TYPES にも入れない）が、「誰がレイドして
// くれたか」を配信後に見返すために取り込む。YouTube に相当機能は無く Twitch 限定。
// 063e: channelpoint（Twitch のチャンネルポイント引き換え）を追加。raid と同じく**収益種別ではない**
// （チャンネルポイントは「お金」ではない＝MONETARY_EVENT_TYPES に入れない）。raid と違うのは
// **視聴者が添えたテキスト（user_input）を本文として持ちうる**点で、そのぶん「コメント」に近い。
// ⚠ 語は `"channelpoint"` に統一する（`channel_points` / `redemption` と 3 通りに散らさない）。
// YouTube に相当機能は無く Twitch 限定。
export type CommentEventType =
  | "normal"
  | "super_chat"
  | "subscription"
  | "membership"
  | "gift"
  | "donation"
  | "jewels"
  | "raid"
  | "channelpoint";

export const COMMENT_SOURCES = {
  YOUTUBE: "youtube",
  TWITCH: "twitch",
} as const satisfies Record<string, CommentSource>;

export const COMMENT_EVENT_TYPES = {
  NORMAL: "normal",
  SUPER_CHAT: "super_chat",
  SUBSCRIPTION: "subscription",
  MEMBERSHIP: "membership",
  GIFT: "gift",
  DONATION: "donation",
  JEWELS: "jewels",
  RAID: "raid",
  CHANNELPOINT: "channelpoint",
} as const satisfies Record<string, CommentEventType>;
