import { container } from "tsyringe";
import { setTimeout as sleep } from "node:timers/promises";
import { NotAuthorizedError } from "@comment-dock/auth";
import { COMMENT_SOURCES, SESSION_STATES } from "@comment-dock/shared";
import type {
  CommentSource,
  SessionPlatform,
  SessionState,
} from "@comment-dock/shared";
// 032c-b(stream-dock): YouTube 経路は distill 時に除外（grpc を import グラフから外す）。
import { TwitchCommentRepository } from "../adapters/twitch/repository/comment.repository.js";
import { TwitchLiveStreamRepository } from "../adapters/twitch/repository/live-stream.repository.js";
import {
  DetectLiveStreamUseCase,
  LiveStreamNotFoundError,
} from "../usecases/live-stream-detection/index.js";
import { CollectTwitchCommentsUseCase } from "../usecases/comment-collection/twitch/collect-comments.usecase.js";
import type {
  CollectCommentsInput,
  CollectCommentsStream,
} from "../usecases/comment-collection/comment-collection.types.js";
import type { CommentOutputPort } from "../usecases/comment-collection/comment-collection.interface.js";
import type {
  FindLiveStreamInput,
  FindLiveStreamResult,
} from "../usecases/live-stream-detection/live-stream-repository.interface.js";
import { getLiveStreamPollingIntervalMs } from "../infrastructure/shared/config/live-stream-detection.js";

type CommentProvider = CommentSource;

export type RunCommentFetcherAppOptions = {
  retryOnLiveStreamNotFound?: boolean;
  liveStreamRetryIntervalMs?: number;
};

// NOTE: 単発パイプライン用の公開名を先に分けておく。
// 現状は既存アプリ実行オプションと同じだが、Gateway 側からの利用が増えた時に
// runCommentFetcherApp と別のオプション形へ切り出しやすくするため alias にしている。
export type PipelineRunOptions = RunCommentFetcherAppOptions;

export type SessionStateChangeEvent = {
  platform: SessionPlatform;
  state: SessionState;
  reason?: string;
  /** CONNECTED 時のみセット。プラットフォーム固有の配信ID。 */
  liveStreamId?: string;
  /** CONNECTED 時のみセット。配信タイトル。 */
  title?: string;
};

export type PipelineControlOptions = {
  signal?: AbortSignal;
  onStateChange?: (event: SessionStateChangeEvent) => void | Promise<void>;
};

type ResolvedPipelineRunOptions = Required<
  Pick<
    RunCommentFetcherAppOptions,
    "retryOnLiveStreamNotFound" | "liveStreamRetryIntervalMs"
  >
>;

type CommentFetchPipeline = {
  provider: CommentProvider & SessionPlatform;
  resolveTargetChannelId: () => Promise<string | null>;
  findCurrentLiveStream: (
    input: FindLiveStreamInput,
  ) => Promise<FindLiveStreamResult | null>;
  findActiveLiveStream: (
    input: FindLiveStreamInput,
    options?: { signal?: AbortSignal },
  ) => Promise<FindLiveStreamResult>;
  streamCommentsFromLiveChat: (
    input: CollectCommentsInput,
  ) => CollectCommentsStream;
};

class LiveStreamEndedError extends Error {
  constructor() {
    super("配信が終了しました。");
    this.name = "LiveStreamEndedError";
  }
}

const isAuthorizationMissingError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }
  return (
    error instanceof NotAuthorizedError ||
    /ログインが必要です/.test(error.message) ||
    /ログイン状態を確認してください/.test(error.message) ||
    /access token is missing from AccessTokenProvider\./.test(error.message) ||
    /Twitch API との通信に失敗しました（HTTP 401 Unauthorized）/.test(
      error.message,
    ) ||
    /Twitch Helix request failed: 401 Unauthorized/.test(error.message) ||
    /Invalid OAuth token/.test(error.message)
  );
};

const isLiveStreamEndedError = (error: unknown): boolean =>
  error instanceof LiveStreamEndedError;

const isAbortError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }
  return error.name === "AbortError";
};

const linkAbortSignal = (
  source: AbortSignal | undefined,
  target: AbortController,
): (() => void) => {
  if (!source) {
    return () => {};
  }

  if (source.aborted) {
    target.abort(source.reason);
    return () => {};
  }

  const onAbort = (): void => {
    target.abort(source.reason);
  };
  source.addEventListener("abort", onAbort, { once: true });
  return () => {
    source.removeEventListener("abort", onAbort);
  };
};

const monitorLiveStreamEnd = async (
  pipeline: CommentFetchPipeline,
  input: {
    channelId: string;
    liveStreamId: string;
  },
  intervalMs: number,
  signal: AbortSignal,
): Promise<void> => {
  while (true) {
    await waitForRetry(intervalMs, signal);
    signal.throwIfAborted();

    const currentLiveStream = await pipeline.findCurrentLiveStream({
      channelId: input.channelId,
    });
    if (
      !currentLiveStream ||
      currentLiveStream.liveStreamId !== input.liveStreamId
    ) {
      throw new LiveStreamEndedError();
    }
  }
};

const emitStateChange = async (
  pipeline: CommentFetchPipeline,
  controls: PipelineControlOptions,
  state: SessionState,
  extra?: { reason?: string; liveStreamId?: string; title?: string },
): Promise<void> => {
  await controls.onStateChange?.({
    platform: pipeline.provider,
    state,
    ...(extra?.reason ? { reason: extra.reason } : {}),
    ...(extra?.liveStreamId ? { liveStreamId: extra.liveStreamId } : {}),
    ...(extra?.title ? { title: extra.title } : {}),
  });
};

const waitForRetry = async (
  milliseconds: number,
  signal?: AbortSignal,
): Promise<void> => {
  await sleep(milliseconds, undefined, { signal });
};

const nextWithAbort = async <T>(
  iterator: AsyncIterator<T>,
  signal?: AbortSignal,
): Promise<IteratorResult<T>> => {
  if (!signal) {
    return iterator.next();
  }

  signal.throwIfAborted();

  // for await...of では next() 待機中の AbortSignal を直接扱えないため、
  // iterator.next() と abort 通知を競争させて停止操作に即時反応できるようにする。
  let removeAbortListener: (() => void) | undefined;
  const abortPromise = new Promise<never>((_, reject) => {
    const onAbort = (): void => {
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    removeAbortListener = () => {
      signal.removeEventListener("abort", onAbort);
    };
  });

  try {
    return await Promise.race([iterator.next(), abortPromise]);
  } finally {
    removeAbortListener?.();
  }
};

// 外部入力の optional な実行設定を、collectComments が扱う必須設定へ解決する。
// 既存の runCommentFetcherApp は常駐プロセス互換で再検知あり、
// 単発パイプラインはボタン起点の実行なので再検知なしを既定にするため、
// retry の既定値だけ呼び出し元から渡せるようにしている。
const resolveRuntimeOptions = (
  options: RunCommentFetcherAppOptions,
  defaultRetryOnLiveStreamNotFound: boolean,
): ResolvedPipelineRunOptions => ({
  retryOnLiveStreamNotFound:
    options.retryOnLiveStreamNotFound ?? defaultRetryOnLiveStreamNotFound,
  liveStreamRetryIntervalMs:
    options.liveStreamRetryIntervalMs ?? getLiveStreamPollingIntervalMs(),
});

const createTwitchPipeline = (channelId?: string): CommentFetchPipeline => {
  const liveStreamRepository = container.resolve(TwitchLiveStreamRepository);
  const commentRepository = container.resolve(TwitchCommentRepository);
  const detectLiveStreamUseCase = new DetectLiveStreamUseCase(
    liveStreamRepository,
  );
  const collectCommentsUseCase = new CollectTwitchCommentsUseCase(
    commentRepository,
  );

  return {
    provider: COMMENT_SOURCES.TWITCH,
    resolveTargetChannelId: async () => {
      // 032c-b(stream-dock): 実運用では viewer が start-session で指定した channel(login 名) が常に
      // 渡るため、こちらだけが使われる。`?? process.env.TWITCH_TARGET_CHANNEL_ID` は osareview 原本の
      // フォールバックで stream-dock では **dead**（Rust は sidecar に宛先 env を渡さない）。宛先 URL の
      // env override ではなく取得対象チャンネルの既定値に過ぎないので実害はないが、distill 最終化時は
      // この env フォールバックを削除して channelId 必須にしてよい。
      const resolved = channelId ?? process.env.TWITCH_TARGET_CHANNEL_ID;
      if (!resolved) {
        console.warn(
          "[comment-fetcher] 取得対象チャンネルが未指定のため、Twitch コメント取得をスキップします。",
        );
        return null;
      }
      return resolved;
    },
    findCurrentLiveStream: (input) =>
      liveStreamRepository.findLiveStream(input),
    findActiveLiveStream: (input, findOptions) =>
      detectLiveStreamUseCase.findActiveLiveStream(input, findOptions),
    streamCommentsFromLiveChat: (input) =>
      collectCommentsUseCase.streamCommentsFromLiveChat(input),
  };
};

const collectComments = async (
  pipeline: CommentFetchPipeline,
  outputPort: CommentOutputPort,
  options: ResolvedPipelineRunOptions,
  controls: PipelineControlOptions = {},
): Promise<void> => {
  while (true) {
    try {
      controls.signal?.throwIfAborted();
      await emitStateChange(pipeline, controls, SESSION_STATES.CONNECTING);
      const channelId = await pipeline.resolveTargetChannelId();
      if (!channelId) {
        await emitStateChange(pipeline, controls, SESSION_STATES.FAILED, {
          reason:
            "コメント取得対象のチャンネルを特定できませんでした。アカウント連携や配信ID設定を確認してください。",
        });
        return;
      }

      const activeLiveStream = await pipeline.findActiveLiveStream(
        {
          channelId,
        },
        { signal: controls.signal },
      );
      console.info(
        `[comment-fetcher] ${pipeline.provider} live stream detected`,
        {
          channelId,
          liveChatId: activeLiveStream.liveChatId,
          liveStreamId: activeLiveStream.liveStreamId,
          title: activeLiveStream.title,
        },
      );
      await emitStateChange(pipeline, controls, SESSION_STATES.CONNECTED, {
        liveStreamId: activeLiveStream.liveStreamId,
        ...(activeLiveStream.title ? { title: activeLiveStream.title } : {}),
      });

      const commentStream = pipeline.streamCommentsFromLiveChat({
        liveChatId: activeLiveStream.liveChatId,
        retryOnStreamEnd: options.retryOnLiveStreamNotFound,
      });
      const commentIterator = commentStream[Symbol.asyncIterator]();
      const streamMonitorController = new AbortController();
      const unlinkAbortSignal = linkAbortSignal(
        controls.signal,
        streamMonitorController,
      );
      const streamMonitor = monitorLiveStreamEnd(
        pipeline,
        {
          channelId,
          liveStreamId: activeLiveStream.liveStreamId,
        },
        options.liveStreamRetryIntervalMs,
        streamMonitorController.signal,
      ).catch((error: unknown) => {
        if (streamMonitorController.signal.aborted) {
          return;
        }
        streamMonitorController.abort(error);
      });
      try {
        while (true) {
          const nextComments = await nextWithAbort(
            commentIterator,
            streamMonitorController.signal,
          );
          if (nextComments.done) {
            break;
          }

          controls.signal?.throwIfAborted();
          await outputPort.outputComments(nextComments.value);
        }
      } finally {
        const streamEnded = isLiveStreamEndedError(
          streamMonitorController.signal.reason,
        );
        streamMonitorController.abort();
        unlinkAbortSignal();
        await streamMonitor;
        const closeCommentIterator = commentIterator.return?.();
        if (streamEnded) {
          void closeCommentIterator?.catch(() => {});
        } else {
          await closeCommentIterator;
        }
      }

      // 配信終了などでストリームが自然終了した場合は待機して再検知する。
      // テストでは無限待機を避けるため、ここで明示的に終了できるようにする。
      if (!options.retryOnLiveStreamNotFound) {
        await emitStateChange(pipeline, controls, SESSION_STATES.IDLE);
        return;
      }
      await waitForRetry(options.liveStreamRetryIntervalMs, controls.signal);
    } catch (error) {
      if (isLiveStreamEndedError(error)) {
        await emitStateChange(pipeline, controls, SESSION_STATES.IDLE);
        return;
      }
      if (controls.signal?.aborted || isAbortError(error)) {
        await emitStateChange(pipeline, controls, SESSION_STATES.IDLE);
        return;
      }
      if (isAuthorizationMissingError(error)) {
        console.warn(
          `[comment-fetcher] ${pipeline.provider} はログイン情報がないためスキップします。`,
        );
        await emitStateChange(pipeline, controls, SESSION_STATES.FAILED, {
          reason: error instanceof Error ? error.message : String(error),
        });
        return;
      }
      if (error instanceof LiveStreamNotFoundError) {
        console.warn(
          `[comment-fetcher] ${pipeline.provider} の配信が見つかりませんでした。`,
          error.message,
        );
        await emitStateChange(pipeline, controls, SESSION_STATES.FAILED, {
          reason: error.message,
        });
        if (!options.retryOnLiveStreamNotFound) {
          return;
        }
        await waitForRetry(options.liveStreamRetryIntervalMs, controls.signal);
        continue;
      }
      throw error;
    }
  }
};

export const runTwitchPipeline = async (
  options: PipelineRunOptions,
  outputPort: CommentOutputPort,
  controls: PipelineControlOptions = {},
  channelId?: string,
): Promise<void> => {
  await collectComments(
    createTwitchPipeline(channelId),
    outputPort,
    resolveRuntimeOptions(options, false),
    controls,
  );
};

// 032c-b(stream-dock): createTwitchPipeline() を単独 export し、DI 解決の疎通確認
// （decorator metadata が SEA を生存しているかのスパイク）にも使えるようにする。
export { createTwitchPipeline };
