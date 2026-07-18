import { inject, injectable } from "tsyringe";
import { YOUTUBE_DI_TOKENS } from "../access-token/di-tokens.js";
import type { YouTubeLiveStreamClient } from "../client/live-stream.client.js";
import type {
  FindLiveStreamInput,
  FindLiveStreamResult,
  LiveStreamRepository,
} from "../../../usecases/live-stream-detection/live-stream-repository.interface.js";

// Repositoryが必要とする最小機能だけに依存し、結合度とモック実装コストを下げるための境界。
interface YouTubeLiveStreamApi {
  findLiveStream: YouTubeLiveStreamClient["findLiveStream"];
}

@injectable()
export class YouTubeLiveStreamRepository implements LiveStreamRepository {
  constructor(
    @inject(YOUTUBE_DI_TOKENS.liveStreamClient)
    private readonly liveStreamClient: YouTubeLiveStreamApi,
  ) {}

  async findLiveStream(
    input: FindLiveStreamInput,
  ): Promise<FindLiveStreamResult | null> {
    return this.liveStreamClient.findLiveStream({
      channelId: input.channelId,
    });
  }
}
