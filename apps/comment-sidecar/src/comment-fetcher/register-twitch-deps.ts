// 032c-b コミット2: Twitch 取得の DI 登録（allow-list 二層強制を配線する版）。
// osareview の register-di-dependencies を src 側に移し、
//  ① env ピン留め: configProvider を PinnedTwitchConfigProvider（定数 base URL）に固定
//  ② fail-closed host guard: eventSubWebSocketRuntime を guardedWebSocketRuntime に固定
//     ＋ httpClient は installHttpHostGuard 後の guarded global fetch を useValue で固定
// する。YouTube/grpc は登録しない（Twitch 専用）。
import { createAuthClient, type AuthClient } from "@comment-dock/auth";
import { container } from "tsyringe";
import { TwitchAccessTokenProvider } from "../../vendor/comment-fetcher/src/adapters/twitch/access-token/access-token-provider.js";
import { TWITCH_DI_TOKENS } from "../../vendor/comment-fetcher/src/adapters/twitch/access-token/di-tokens.js";
import { TwitchHelixClient } from "../../vendor/comment-fetcher/src/adapters/twitch/client/helix.client.js";
import { TwitchEventSubWebSocketClient } from "../../vendor/comment-fetcher/src/adapters/twitch/client/eventsub-websocket.client.js";
import { TwitchLiveStreamClient } from "../../vendor/comment-fetcher/src/adapters/twitch/client/live-stream.client.js";
import { TwitchLiveStreamRepository } from "../../vendor/comment-fetcher/src/adapters/twitch/repository/live-stream.repository.js";
import { TwitchCommentRepository } from "../../vendor/comment-fetcher/src/adapters/twitch/repository/comment.repository.js";
import { SHARED_DI_TOKENS } from "../../vendor/comment-fetcher/src/infrastructure/shared/http/http-client.js";
import { SHARED_AUTH_DI_TOKENS } from "../../vendor/comment-fetcher/src/infrastructure/shared/auth/di-tokens.js";
import { PinnedTwitchConfigProvider } from "../twitch-config.js";
import { guardedWebSocketRuntime } from "../host-guard.js";

export type RegisterCommentFetcherDependenciesOptions = {
  authClient?: AuthClient;
};

export const registerCommentFetcherDependencies = (
  options: RegisterCommentFetcherDependenciesOptions = {},
): void => {
  // httpClient は installHttpHostGuard() 後の guarded global fetch を固定する（Helix はこれを通る）。
  container.register(SHARED_DI_TOKENS.httpClient, { useValue: fetch });
  container.register<AuthClient>(SHARED_AUTH_DI_TOKENS.authClient, {
    useValue: options.authClient ?? createAuthClient(),
  });
  container.register(TWITCH_DI_TOKENS.accessTokenProvider, {
    useClass: TwitchAccessTokenProvider,
  });
  // ① env ピン留め: 定数 base URL の Provider に固定（Env* は使わない）。
  container.register(TWITCH_DI_TOKENS.configProvider, {
    useValue: new PinnedTwitchConfigProvider(),
  });
  container.register(TWITCH_DI_TOKENS.helixClient, {
    useClass: TwitchHelixClient,
  });
  container.register(TWITCH_DI_TOKENS.eventSubClient, {
    useClass: TwitchEventSubWebSocketClient,
  });
  // ② fail-closed host guard: EventSub の ws 生成をガード付き runtime に固定。
  container.register(TWITCH_DI_TOKENS.eventSubWebSocketRuntime, {
    useValue: guardedWebSocketRuntime,
  });
  container.register(TWITCH_DI_TOKENS.liveStreamClient, {
    useClass: TwitchLiveStreamClient,
  });
  container.register(TWITCH_DI_TOKENS.liveStreamRepository, {
    useClass: TwitchLiveStreamRepository,
  });
  container.register(TWITCH_DI_TOKENS.commentRepository, {
    useClass: TwitchCommentRepository,
  });
};
