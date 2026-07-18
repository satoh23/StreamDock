import type { YouTubeApiClient } from "../client/api.client.js";
import { inject, injectable } from "tsyringe";
import { mapYouTubeLiveChatMessagesToComments } from "../mapper/comment.mapper.js";
import { YOUTUBE_DI_TOKENS } from "../access-token/di-tokens.js";
import type {
  CommentRepository,
  FetchCommentsInput,
  FetchCommentsResult,
} from "../../../usecases/comment-collection/comment-repository.interface.js";

// Repositoryが必要とする最小機能だけに依存し、結合度とモック実装コストを下げるための境界。
interface YouTubeCommentApi {
  fetchLiveChatMessages: YouTubeApiClient["fetchLiveChatMessages"];
}

@injectable()
export class YouTubeCommentRepository implements CommentRepository {
  constructor(
    @inject(YOUTUBE_DI_TOKENS.apiClient)
    private readonly apiClient: YouTubeCommentApi,
  ) {}

  async *streamComments(
    input: FetchCommentsInput,
  ): AsyncIterable<FetchCommentsResult> {
    for await (const response of this.apiClient.fetchLiveChatMessages({
      liveChatId: input.liveChatId,
      pageToken: input.pageToken,
    })) {
      yield {
        comments: mapYouTubeLiveChatMessagesToComments(response),
        nextPageToken: response.next_page_token,
      };
    }
  }
}
