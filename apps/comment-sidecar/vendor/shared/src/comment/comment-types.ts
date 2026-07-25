export type CommentSource = "youtube" | "twitch";

// 043a: メンシプ／ギフトをサブスクから種別分離する。従来 3 値（normal/super_chat/subscription）に
// membership（YouTube NEW_SPONSOR/MEMBER_MILESTONE）・gift（Twitch sub_gift/community_sub_gift）を加える。
// 043a(拡張): donation（Twitch charity_donation＝チャリティ実金銭ドネーション）を追加。サブスク/ギフトと
// 明確に分離し、金額は monetaryAmount 経由で通す（団体名は本文以外で持ち回らない＝§9）。
// 043a(拡張): jewels（YouTube 縦型ライブの Jewels ギフト）を表示語彙として追加。**取得（ingestion）は 043d**
// （gRPC proto のフィールド番号が非公開のため未受信）で、現状は dev-mock のみが発行する（実データは 043d 後）。
export type CommentEventType =
  | "normal"
  | "super_chat"
  | "subscription"
  | "membership"
  | "gift"
  | "donation"
  | "jewels";

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
} as const satisfies Record<string, CommentEventType>;
