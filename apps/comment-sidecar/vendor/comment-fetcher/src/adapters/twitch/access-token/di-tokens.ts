export const TWITCH_DI_TOKENS = {
  accessTokenProvider: "TwitchAccessTokenProvider",
  liveStreamClient: "TwitchLiveStreamClient",
  liveStreamRepository: "TwitchLiveStreamRepository",
  configProvider: "TwitchConfigProvider",
  helixClient: "TwitchHelixClient",
  eventSubClient: "TwitchEventSubWebSocketClient",
  eventSubWebSocketRuntime: "TwitchEventSubWebSocketRuntime",
  commentRepository: "TwitchCommentRepository",
  // 063e 段 1-b: チャンネルポイント購読の成否（1 bit）の通知先。
  // ⚠ 実体（broadcast する関数）は `src/` 側にあり、vendor は**関数型しか知らない**
  //   （WS も frontend も vendor へ持ち込まない＝`eventSubWebSocketRuntime` と同じ形の境界）。
  channelPointsSubscriptionReporter: "TwitchChannelPointsSubscriptionReporter",
} as const;
