// 032c-d コミット2: YouTube 取得の DI 登録（allow-list 二層強制を配線する版）。
// register-twitch-deps.ts と同型。osareview の register-di-dependencies から YouTube 分のみを移し、
//  ① env ピン留め: configProvider を PinnedYouTubeConfigProvider（定数 Data API base URL）に固定
//  ② fail-closed gRPC チャネルガード＋SEA proto: streamListRuntime を guardedStreamListRuntime に固定
//     ＋ httpClient は installHttpHostGuard 後の guarded global fetch を useValue で固定（REST 検出がこれを通る）
// する。Twitch とは独立に登録するが、httpClient/authClient は同じ値なので二重登録でも安全（last-wins・同値）。
import { createAuthClient, type AuthClient } from "@comment-dock/auth";
import { container } from "tsyringe";
import { YouTubeAccessTokenProvider } from "../../vendor/comment-fetcher/src/adapters/youtube/access-token/access-token-provider.js";
import { YOUTUBE_DI_TOKENS } from "../../vendor/comment-fetcher/src/adapters/youtube/access-token/di-tokens.js";
import { YouTubeApiClient } from "../../vendor/comment-fetcher/src/adapters/youtube/client/api.client.js";
import { YouTubeLiveStreamClient } from "../../vendor/comment-fetcher/src/adapters/youtube/client/live-stream.client.js";
import { YouTubeLiveStreamRepository } from "../../vendor/comment-fetcher/src/adapters/youtube/repository/live-stream.repository.js";
import { SHARED_DI_TOKENS } from "../../vendor/comment-fetcher/src/infrastructure/shared/http/http-client.js";
import { SHARED_AUTH_DI_TOKENS } from "../../vendor/comment-fetcher/src/infrastructure/shared/auth/di-tokens.js";
import { PinnedYouTubeConfigProvider } from "../youtube-config.js";
import { guardedStreamListRuntime } from "./youtube-grpc-runtime.js";

export type RegisterYouTubeDependenciesOptions = {
  authClient?: AuthClient;
};

export const registerYouTubeDependencies = (
  options: RegisterYouTubeDependenciesOptions = {},
): void => {
  // httpClient は installHttpHostGuard() 後の guarded global fetch を固定する（REST 検出はこれを通る）。
  container.register(SHARED_DI_TOKENS.httpClient, { useValue: fetch });
  container.register<AuthClient>(SHARED_AUTH_DI_TOKENS.authClient, {
    useValue: options.authClient ?? createAuthClient(),
  });
  container.register(YOUTUBE_DI_TOKENS.accessTokenProvider, {
    useClass: YouTubeAccessTokenProvider,
  });
  container.register(YOUTUBE_DI_TOKENS.apiClient, {
    useClass: YouTubeApiClient,
  });
  // ② fail-closed gRPC チャネルガード＋SEA proto: ガード付き StreamListRuntime に固定（DEFAULT は使わない）。
  container.register(YOUTUBE_DI_TOKENS.streamListRuntime, {
    useValue: guardedStreamListRuntime,
  });
  container.register(YOUTUBE_DI_TOKENS.liveStreamClient, {
    useClass: YouTubeLiveStreamClient,
  });
  container.register(YOUTUBE_DI_TOKENS.liveStreamRepository, {
    useClass: YouTubeLiveStreamRepository,
  });
  // ① env ピン留め: 定数 Data API base URL の Provider に固定（Env* は使わない）。
  container.register(YOUTUBE_DI_TOKENS.configProvider, {
    useValue: new PinnedYouTubeConfigProvider(),
  });
};
