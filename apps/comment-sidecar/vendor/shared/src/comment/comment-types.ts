export type CommentSource = "youtube" | "twitch";

export type CommentEventType = "normal" | "super_chat" | "subscription";

export const COMMENT_SOURCES = {
  YOUTUBE: "youtube",
  TWITCH: "twitch",
} as const satisfies Record<string, CommentSource>;

export const COMMENT_EVENT_TYPES = {
  NORMAL: "normal",
  SUPER_CHAT: "super_chat",
  SUBSCRIPTION: "subscription",
} as const satisfies Record<string, CommentEventType>;
