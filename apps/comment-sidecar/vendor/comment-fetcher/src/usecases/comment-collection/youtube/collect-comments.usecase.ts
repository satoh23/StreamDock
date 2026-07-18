import { setTimeout as sleep } from "node:timers/promises";
import type { CommentRepository } from "../comment-repository.interface.js";
import {
  QuotaExceededError,
  isGrpcResourceExhaustedError,
} from "../../../adapters/shared/quota/error.js";
import { DEFAULT_COMMENT_STREAM_RECONNECT_INTERVAL_MS } from "../../../infrastructure/youtube/config/comment-collection.js";
import type {
  CollectCommentsInput,
  CollectCommentsStream,
} from "../comment-collection.types.js";

export class CollectYouTubeCommentsUseCase {
  constructor(
    private readonly repository: CommentRepository,
    private readonly reconnectIntervalMs = DEFAULT_COMMENT_STREAM_RECONNECT_INTERVAL_MS,
    // テスト時に再接続待機を差し替えて高速・安定に検証できるよう注入可能にしている。
    private readonly wait: (milliseconds: number) => Promise<void> = async (
      milliseconds,
    ) => {
      await sleep(milliseconds);
    },
  ) {}

  async *streamCommentsFromLiveChat(
    input: CollectCommentsInput,
  ): CollectCommentsStream {
    let nextPageToken = input.pageToken;
    const retryOnStreamEnd = input.retryOnStreamEnd ?? true;

    while (true) {
      try {
        for await (const chunk of this.repository.streamComments({
          liveChatId: input.liveChatId,
          pageToken: nextPageToken,
        })) {
          nextPageToken = chunk.nextPageToken;
          if (chunk.comments.length > 0) {
            yield chunk.comments;
          }
        }
      } catch (error) {
        // 032c-d(stream-dock): クォータ枯渇（gRPC RESOURCE_EXHAUSTED）は再接続すると 1 秒間隔の hot-loop で
        // さらにクォータを消費するため、**再接続せず** QuotaExceededError を投げて graceful stop する
        // （上位 collectComments が FAILED を viewer へ通知）。osareview の欠陥（全エラーを 1 秒で無限再接続）は
        // 持ち込まない。通常の切断（配信一時中断等）は従来どおり pageToken 付きで再接続する。
        if (isGrpcResourceExhaustedError(error)) {
          throw new QuotaExceededError();
        }
        // 通常切断（配信一時中断・ネットワーク瞬断等）は再接続で回復するため warn に留める。ここで載せる
        // error は gRPC の ServiceError（code/details/応答 metadata）で、**リクエストの Authorization ヘッダ
        // （access token）は含まない**。かつ console.warn は Node 既定で **stderr** に出るため sidecar の stdout
        // プロトコル（COMMENT_SIDECAR_* 行）を汚さない（診断は stderr へ分離＝§9）。
        // どうなったら修正検討: error に token/PII が載り得る経路が増えたら、第2引数を外し error.message のみへ絞る。
        console.warn(
          retryOnStreamEnd
            ? "[CollectYouTubeCommentsUseCase] stream disconnected, reconnecting with last pageToken"
            : "[CollectYouTubeCommentsUseCase] stream disconnected",
          error,
        );
      }

      if (!retryOnStreamEnd) {
        return;
      }

      await this.wait(this.reconnectIntervalMs);
    }
  }
}
