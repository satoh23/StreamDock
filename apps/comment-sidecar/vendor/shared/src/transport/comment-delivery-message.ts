import type { CommentViewDto } from "../comment/comment-view.dto.js";

export type SessionPlatform = "youtube" | "twitch";

export type SessionState = "idle" | "connecting" | "connected" | "failed";

export type AccountLinkProvider = SessionPlatform;

export type AccountLinkState = "unlinked" | "linking" | "linked" | "failed";

export const SESSION_PLATFORMS = {
  YOUTUBE: "youtube",
  TWITCH: "twitch",
} as const satisfies Record<string, SessionPlatform>;

export const SESSION_STATES = {
  IDLE: "idle",
  CONNECTING: "connecting",
  CONNECTED: "connected",
  FAILED: "failed",
} as const satisfies Record<string, SessionState>;

export const ACCOUNT_LINK_STATES = {
  UNLINKED: "unlinked",
  LINKING: "linking",
  LINKED: "linked",
  FAILED: "failed",
} as const satisfies Record<string, AccountLinkState>;

export const COMMENT_DELIVERY_MESSAGE_TYPES = {
  COMMENTS_APPEND: "comments.append",
  COMMENTS_BATCH: "comments.batch",
  SESSION_STATE: "session.state",
  ACCOUNT_LINK_STATE: "account.state",
} as const;

export const SESSION_STATE_MESSAGE_TYPE =
  COMMENT_DELIVERY_MESSAGE_TYPES.SESSION_STATE;

export const ACCOUNT_LINK_STATE_MESSAGE_TYPE =
  COMMENT_DELIVERY_MESSAGE_TYPES.ACCOUNT_LINK_STATE;

export type CommentDeliveryMessageType =
  (typeof COMMENT_DELIVERY_MESSAGE_TYPES)[keyof typeof COMMENT_DELIVERY_MESSAGE_TYPES];

export type CommentsAppendMessage = {
  type: typeof COMMENT_DELIVERY_MESSAGE_TYPES.COMMENTS_APPEND;
  payload: {
    comment: CommentViewDto;
  };
};

export type CommentsBatchMessage = {
  type: typeof COMMENT_DELIVERY_MESSAGE_TYPES.COMMENTS_BATCH;
  payload: {
    comments: CommentViewDto[];
  };
};

export type SessionStateMessage = {
  type: typeof COMMENT_DELIVERY_MESSAGE_TYPES.SESSION_STATE;
  payload: {
    platform: SessionPlatform;
    state: SessionState;
    reason?: string;
    /** CONNECTED 時のみセット。プラットフォーム固有の配信ID。 */
    liveStreamId?: string;
    /** CONNECTED 時のみセット。配信タイトル。 */
    title?: string;
  };
};

export type AccountLinkStateMessage = {
  type: typeof COMMENT_DELIVERY_MESSAGE_TYPES.ACCOUNT_LINK_STATE;
  payload: {
    provider: AccountLinkProvider;
    state: AccountLinkState;
    reason?: string;
  };
};

export type AccountLinkSnapshot = {
  provider: AccountLinkProvider;
  state: AccountLinkState;
  reason?: string;
};

export type AccountLinkSnapshots = Record<
  AccountLinkProvider,
  AccountLinkSnapshot
>;

export type AccountLinkResponse = {
  account: AccountLinkSnapshot;
};

export type AccountLinksResponse = {
  accounts: AccountLinkSnapshots;
};

export type StreamingSessionSnapshot = {
  platform: SessionPlatform;
  state: SessionState;
  reason?: string;
  /** CONNECTED 時のみセット。プラットフォーム固有の配信ID。 */
  liveStreamId?: string;
  /** CONNECTED 時のみセット。配信タイトル。 */
  title?: string;
};

export type StreamingSessionSnapshots = Record<
  SessionPlatform,
  StreamingSessionSnapshot
>;

export type StreamingSessionResponse = {
  session: StreamingSessionSnapshot;
};

export type StreamingSessionsResponse = {
  sessions: StreamingSessionSnapshots;
};

export type CommentDeliveryMessage =
  | CommentsAppendMessage
  | CommentsBatchMessage
  | SessionStateMessage
  | AccountLinkStateMessage;
