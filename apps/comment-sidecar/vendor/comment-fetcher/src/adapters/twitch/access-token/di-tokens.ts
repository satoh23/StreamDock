export const TWITCH_DI_TOKENS = {
  accessTokenProvider: "TwitchAccessTokenProvider",
  liveStreamClient: "TwitchLiveStreamClient",
  liveStreamRepository: "TwitchLiveStreamRepository",
  configProvider: "TwitchConfigProvider",
  helixClient: "TwitchHelixClient",
  eventSubClient: "TwitchEventSubWebSocketClient",
  eventSubWebSocketRuntime: "TwitchEventSubWebSocketRuntime",
  commentRepository: "TwitchCommentRepository",
} as const;
