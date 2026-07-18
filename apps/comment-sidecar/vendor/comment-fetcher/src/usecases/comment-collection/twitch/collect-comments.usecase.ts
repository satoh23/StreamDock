import { setTimeout as sleep } from "node:timers/promises";
import type { CommentRepository } from "../comment-repository.interface.js";
import { DEFAULT_TWITCH_COMMENT_STREAM_RECONNECT_INTERVAL_MS } from "../../../infrastructure/twitch/config/comment-collection.js";
import type {
  CollectCommentsInput,
  CollectCommentsStream,
} from "../comment-collection.types.js";

export class CollectTwitchCommentsUseCase {
  constructor(
    private readonly repository: CommentRepository,
    private readonly reconnectIntervalMs = DEFAULT_TWITCH_COMMENT_STREAM_RECONNECT_INTERVAL_MS,
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
    const retryOnStreamEnd = input.retryOnStreamEnd ?? true;

    while (true) {
      try {
        for await (const chunk of this.repository.streamComments({
          liveChatId: input.liveChatId,
        })) {
          if (chunk.comments.length > 0) {
            yield chunk.comments;
          }
        }
      } catch (error) {
        console.warn(
          retryOnStreamEnd
            ? "[CollectTwitchCommentsUseCase] stream disconnected, reconnecting"
            : "[CollectTwitchCommentsUseCase] stream disconnected",
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
