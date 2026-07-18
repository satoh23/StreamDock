import { inject, injectable } from "tsyringe";
import { TWITCH_DI_TOKENS } from "../access-token/di-tokens.js";
import { mapTwitchChatEventsToComments } from "../mapper/comment.mapper.js";
import type { TwitchEventSubWebSocketClient } from "../client/eventsub-websocket.client.js";
import type { TwitchHelixClient } from "../client/helix.client.js";
import type {
  CommentRepository,
  FetchCommentsInput,
  FetchCommentsResult,
} from "../../../usecases/comment-collection/comment-repository.interface.js";

// Repositoryが必要とする最小機能だけに依存し、結合度とモック実装コストを下げるための境界。
interface TwitchCommentEventStreamApi {
  streamChatEvents: TwitchEventSubWebSocketClient["streamChatEvents"];
}

@injectable()
export class TwitchCommentRepository implements CommentRepository {
  constructor(
    @inject(TWITCH_DI_TOKENS.eventSubClient)
    private readonly eventSubClient: TwitchCommentEventStreamApi,
    @inject(TWITCH_DI_TOKENS.helixClient)
    private readonly helixClient: TwitchHelixClient,
  ) {}

  async *streamComments(
    input: FetchCommentsInput,
  ): AsyncIterable<FetchCommentsResult> {
    const selfUserId = await this.helixClient.getSelfUserId();

    for await (const event of this.eventSubClient.streamChatEvents({
      broadcasterUserId: input.liveChatId,
      userId: selfUserId,
    })) {
      yield {
        comments: mapTwitchChatEventsToComments([event]),
        // Twitch EventSub は pageToken を持たないため常に undefined。
        nextPageToken: undefined,
      };
    }
  }
}
