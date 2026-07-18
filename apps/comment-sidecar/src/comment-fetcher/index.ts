// 032c-b(stream-dock): "@comment-dock/comment-fetcher" の alias エントリ。
// osareview の lib.ts（runYouTubePipeline 等 YouTube/grpc を再エクスポートする）を使わず、
// Twitch 経路と Comment 型のみを公開する Twitch 専用バレル。
export type {
  Comment,
  MonetaryAmount,
  User,
} from "../../vendor/comment-fetcher/src/entities/index.js";
export {
  runTwitchPipeline,
  createTwitchPipeline,
} from "../../vendor/comment-fetcher/src/app/main.js";
export type {
  PipelineRunOptions,
  PipelineControlOptions,
  SessionStateChangeEvent,
  RunCommentFetcherAppOptions,
} from "../../vendor/comment-fetcher/src/app/main.js";
export {
  registerCommentFetcherDependencies,
  type RegisterCommentFetcherDependenciesOptions,
} from "./register-twitch-deps.js";
export type { CommentOutputPort } from "../../vendor/comment-fetcher/src/usecases/comment-collection/comment-collection.interface.js";
