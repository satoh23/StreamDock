import { container } from "tsyringe";
import { setTimeout as sleep } from "node:timers/promises";
import { NotAuthorizedError } from "@comment-dock/auth";
import { COMMENT_SOURCES, SESSION_STATES } from "@comment-dock/shared";
import type {
  CommentSource,
  SessionPlatform,
  SessionState,
} from "@comment-dock/shared";
// 032c-d(stream-dock): YouTube 経路（gRPC streamList）を追加。Twitch と併存・各サービス個別選択。
import { TwitchCommentRepository } from "../adapters/twitch/repository/comment.repository.js";
import { TwitchLiveStreamRepository } from "../adapters/twitch/repository/live-stream.repository.js";
import { YouTubeCommentRepository } from "../adapters/youtube/repository/comment.repository.js";
import { YouTubeLiveStreamRepository } from "../adapters/youtube/repository/live-stream.repository.js";
import { YouTubeLiveStreamClient } from "../adapters/youtube/client/live-stream.client.js";
import {
  DetectLiveStreamUseCase,
  LiveStreamNotFoundError,
} from "../usecases/live-stream-detection/index.js";
import { CollectTwitchCommentsUseCase } from "../usecases/comment-collection/twitch/collect-comments.usecase.js";
import { CollectYouTubeCommentsUseCase } from "../usecases/comment-collection/youtube/collect-comments.usecase.js";
import { isQuotaExceededError } from "../adapters/shared/quota/error.js";
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
  // 032c-d(stream-dock): 実運用では未指定（mine=true で自アカウントのアクティブ配信を検出）。
  // osareview 原本の明示指定経路で stream-dock では dead（viewer はチャンネル名を渡さない）。
  youtubeTargetChannelId?: string;
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

type ResolvedPipelineRunOptions = {
  retryOnLiveStreamNotFound: boolean;
  liveStreamRetryIntervalMs: number;
  // 032c-d′(stream-dock): 配信終了で gRPC ストリームが閉じたとき nextPageToken で再接続して継続取得するか。
  // 開始時の再検出（retryOnLiveStreamNotFound）とは**独立**。YouTube=true（gRPC streamList は周期的に閉じるため
  // 再接続しないと 1 サイクルで IDLE に落ちる）/ Twitch=false（EventSub は自層で再接続・従来どおり）。
  retryOnStreamEnd: boolean;
};

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
  // 032c-d′(stream-dock): 指定ライブ配信 videoId がまだ生存しているかの安価・整合的な判定（YouTube のみ提供）。
  // 提供された場合、配信終了監視（monitorLiveStreamEnd）はこちら（videos.list・1 unit・by-id）を使う。
  // 未提供（Twitch）は従来の findCurrentLiveStream（Helix /streams）で判定する。
  checkLiveStreamActive?: (liveStreamId: string) => Promise<boolean>;
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

// 032c-d″(stream-dock): 配信終了監視。
//  - YouTube（checkLiveStreamActive あり）: silence-gated（無言監視）。コメントが流れている間は videos.list を
//    一切叩かず（＝活発な配信ではクォータ消費ゼロ）、コメントが途切れた時だけ videos.list（by-id・1 unit・
//    activeLiveChatId は権威情報）で生存確認する。壁時計で回るため、gRPC ストリームがハートビートで開いたまま／
//    健全に見える切断を繰り返しても終了を必ず検知できる（"切断時だけ確認" だと「接続中のまま永久に止まらない」
//    危険があるため採らない）。quota エラーは即 rethrow（上位で FAILED）。その他の一時エラーは inconclusive 扱いで
//    miss に数えず継続する（誤って「配信終了」に倒さない／回復後に active=false が続けば通常どおり終了検知）。
//  - Twitch（checkLiveStreamActive なし）: 従来どおり findCurrentLiveStream（Helix /streams・authoritative）で即判定。
const LIVE_STREAM_END_MISS_THRESHOLD = 2;
// 032c-d″(stream-dock): YouTube 配信終了監視の silence-gated パラメータ。
//  - SILENCE_THRESHOLD: 直近コメントからこの時間が経過して初めて生存確認を始める（それ未満＝確定的に配信中）。
//  - CHECK_INTERVAL: 監視の wake 間隔。無言中はこの間隔で videos.list（1 unit）を叩く／活発中は叩かずスキップ。
// 終了検知は緊急でない（ユーザーは「停止」も押せる）ため 90s(無言) + 2×45s(確認) ≈ 最大 ~3 分の検知遅れは許容。
// 従来は挙動と無関係に 30s 毎（3h ~360 units）叩いていたのを、活発時 ~0 units に削減する。
// Twitch は無料枠の単位課金が無いため従来の channel ベース即判定（intervalMs）のまま。
const YOUTUBE_COMMENT_SILENCE_THRESHOLD_MS = 90_000;
const YOUTUBE_LIVENESS_CHECK_INTERVAL_MS = 45_000;

const monitorLiveStreamEnd = async (
  pipeline: CommentFetchPipeline,
  input: {
    channelId: string;
    liveStreamId: string;
  },
  intervalMs: number,
  // 032c-d″(stream-dock): 直近コメント受信時刻(ms)の getter。YouTube の silence-gated 判定に使う
  //（コメントが流れている間は生存確認をスキップ）。Twitch 分岐では参照しない。
  getLastCommentAt: () => number,
  signal: AbortSignal,
): Promise<void> => {
  const checkActive = pipeline.checkLiveStreamActive;

  // Twitch: 従来の channel ベース即判定を byte-for-byte 維持する。
  if (!checkActive) {
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
  }

  // YouTube: silence-gated 生存監視。コメントが流れている間（直近受信から SILENCE_THRESHOLD 未満）は
  // 確定的に配信中なので **API を一切叩かない**（＝活発時クォータ0）。コメントが途切れた時だけ videos.list で
  // 生存確認する。壁時計で回るため、gRPC がハートビートで開いたまま／健全に見える切断を繰り返しても終了を
  // 必ず検知できる（"切断時だけ確認" 方式の「接続中のまま永久に止まらない」問題を回避）。
  let consecutiveMisses = 0;
  while (true) {
    await waitForRetry(YOUTUBE_LIVENESS_CHECK_INTERVAL_MS, signal);
    signal.throwIfAborted();

    // コメントが直近で流れていれば確定的に配信中 → API を叩かずスキップ（クォータ節約の要）。
    if (Date.now() - getLastCommentAt() < YOUTUBE_COMMENT_SILENCE_THRESHOLD_MS) {
      consecutiveMisses = 0;
      continue;
    }

    let active: boolean;
    try {
      active = await checkActive(input.liveStreamId);
    } catch (error) {
      if (isQuotaExceededError(error)) {
        throw error; // クォータ枯渇は監視の誤検知でなく本物の停止理由 → 上位で FAILED 通知。
      }
      // 一時エラー（ネット瞬断等）は inconclusive: miss に数えず継続する。誤って「配信終了」に倒さないため
      //（回復後の確認で active=false が続けば通常どおり終了検知できる）。
      console.warn(
        "[comment-fetcher] YouTube 配信生存チェックに失敗しました（一時エラー・継続）。",
        error,
      );
      continue;
    }

    if (active) {
      consecutiveMisses = 0;
      continue;
    }
    consecutiveMisses += 1;
    if (consecutiveMisses >= LIVE_STREAM_END_MISS_THRESHOLD) {
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
  // 032c-d′(stream-dock): 配信終了時の再接続既定（YouTube=true / Twitch=false）。retryOnLiveStreamNotFound と独立。
  defaultRetryOnStreamEnd: boolean,
): ResolvedPipelineRunOptions => ({
  retryOnLiveStreamNotFound:
    options.retryOnLiveStreamNotFound ?? defaultRetryOnLiveStreamNotFound,
  liveStreamRetryIntervalMs:
    options.liveStreamRetryIntervalMs ?? getLiveStreamPollingIntervalMs(),
  retryOnStreamEnd: defaultRetryOnStreamEnd,
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

// 032c-d(stream-dock): YouTube パイプライン（gRPC streamList）。mine=true で自アカウントのアクティブ配信を
// 検出する（チャンネル名入力不要）。collectComments は provider 非依存なのでそのまま流用する。
const createYouTubePipeline = (
  options: RunCommentFetcherAppOptions,
): CommentFetchPipeline => {
  const liveStreamRepository = container.resolve(YouTubeLiveStreamRepository);
  const liveStreamClient = container.resolve(YouTubeLiveStreamClient);
  const commentRepository = container.resolve(YouTubeCommentRepository);
  const detectLiveStreamUseCase = new DetectLiveStreamUseCase(
    liveStreamRepository,
  );
  const collectCommentsUseCase = new CollectYouTubeCommentsUseCase(
    commentRepository,
  );

  return {
    provider: COMMENT_SOURCES.YOUTUBE,
    // 032c-d‴(stream-dock) 補足: この channelId 解決（`resolveOwnChannelId`＝channels.list・**1 unit**）は、検出を
    // liveBroadcasts.list（`broadcastStatus=active`＝認証ユーザー自身に暗黙固定）へ移した後は **検出に不要**になった
    // （`findActiveOwnBroadcast` は channelId を使わない・下記 client 参照）。それでも残す意図:
    //  ①未ログイン/チャンネル不定を **検出前に固定文言で早期 FAILED** にできる（1u で分かりやすく落とす）、
    //  ②`CommentFetchPipeline` 契約（Twitch と共通の resolveTargetChannelId）の parity 維持。
    // 注意: `youtubeTargetChannelId` を指定しても、検出は常に「自分のアクティブ配信」を返す（他チャンネルは選べない）。
    // 現状このオプションは sidecar エントリから未配線のため実害なし。**UI 等でユーザーに露出させる場合は要再設計**
    // （露出すると「他人の配信を指定したのに自分の配信を監視する」罠になる → オプション撤去 or channel 指定検出の復活）。
    // 再検討の目安: 上記①の早期検知が不要と判断した／クォータ逼迫で 1u/接続 すら惜しくなった場合は本呼び出しを削れる。
    resolveTargetChannelId: async () => {
      if (options.youtubeTargetChannelId) {
        return options.youtubeTargetChannelId;
      }
      const ownChannelId = await liveStreamClient.resolveOwnChannelId();
      if (!ownChannelId) {
        console.warn(
          "[comment-fetcher] ログイン中の YouTube アカウントからチャンネルを特定できませんでした。",
        );
        return null;
      }
      return ownChannelId;
    },
    findCurrentLiveStream: (input) =>
      liveStreamRepository.findLiveStream(input),
    findActiveLiveStream: (input, findOptions) =>
      detectLiveStreamUseCase.findActiveLiveStream(input, findOptions),
    streamCommentsFromLiveChat: (input) =>
      collectCommentsUseCase.streamCommentsFromLiveChat(input),
    // 032c-d′(stream-dock): 配信終了監視は search.list ではなく videos.list（by-id・1 unit・安定）で判定する。
    checkLiveStreamActive: (liveStreamId) =>
      liveStreamClient.isLiveStreamActive(liveStreamId),
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

      // 032c-d″(stream-dock): silence-gated 監視用に直近コメント受信時刻を追跡する。CONNECT 直後は Date.now() で
      // 初期化し、SILENCE_THRESHOLD ぶんのグレース期間を与える（接続直後の無言で誤検知しないため）。
      let lastCommentAt = Date.now();

      const commentStream = pipeline.streamCommentsFromLiveChat({
        liveChatId: activeLiveStream.liveChatId,
        // 032c-d′(stream-dock): 配信終了で gRPC ストリームが閉じたときの再接続は retryOnStreamEnd（YouTube=true）で
        // 制御する（開始時の再検出 retryOnLiveStreamNotFound とは独立）。以前は後者(=false)に束ねていたため、
        // YouTube の streamList が最初に閉じた時点で自然完了 IDLE（下記 401 行）に落ち、継続取得できなかった。
        retryOnStreamEnd: options.retryOnStreamEnd,
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
        () => lastCommentAt,
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
          lastCommentAt = Date.now(); // silence-gated 監視の基準を更新（コメントが流れている＝配信中）。
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
      // 032c-d(stream-dock): クォータ枯渇（403 quotaExceeded / gRPC RESOURCE_EXHAUSTED）は再検知せず
      // graceful stop する（FAILED を viewer へ通知・hot-loop しない・クラッシュさせない）。
      if (isQuotaExceededError(error)) {
        await emitStateChange(pipeline, controls, SESSION_STATES.FAILED, {
          reason: error.message,
        });
        return;
      }
      if (isLiveStreamEndedError(error)) {
        // 032c-d′(stream-dock): 配信終了検知の IDLE に理由を付ける（従来は無表示で「待機」の原因が見えなかった）。
        await emitStateChange(pipeline, controls, SESSION_STATES.IDLE, {
          reason: "配信の終了を検知しました。",
        });
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
    // 032c-d′(stream-dock): Twitch は従来どおり（配信終了時の再接続なし＝EventSub は自層で再接続）。
    resolveRuntimeOptions(options, false, false),
    controls,
  );
};

// 032c-d(stream-dock): YouTube 取得パイプライン。start-session(youtube) から起動する（チャンネル名不要）。
export const runYouTubePipeline = async (
  options: PipelineRunOptions,
  outputPort: CommentOutputPort,
  controls: PipelineControlOptions = {},
): Promise<void> => {
  await collectComments(
    createYouTubePipeline(options),
    outputPort,
    // 032c-d′(stream-dock): YouTube は retryOnStreamEnd=true（gRPC streamList は周期的に閉じるため nextPageToken で
    // 再接続して継続取得する）。開始時の再検出（retryOnLiveStreamNotFound）は false のまま（配信が無ければ FAILED で停止）。
    resolveRuntimeOptions(options, false, true),
    controls,
  );
};

// 032c-d(stream-dock): createYouTubePipeline を単独 export（DI 解決＋proto-under-SEA のスパイクにも使える）。
export { createYouTubePipeline };

// 032c-b(stream-dock): createTwitchPipeline() を単独 export し、DI 解決の疎通確認
// （decorator metadata が SEA を生存しているかのスパイク）にも使えるようにする。
export { createTwitchPipeline };
