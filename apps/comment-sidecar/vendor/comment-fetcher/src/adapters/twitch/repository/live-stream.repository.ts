import { inject, injectable } from "tsyringe";
import { TWITCH_DI_TOKENS } from "../access-token/di-tokens.js";
import type { TwitchLiveStreamClient } from "../client/live-stream.client.js";
import type {
  FindLiveStreamInput,
  FindLiveStreamResult,
  LiveStreamRepository,
} from "../../../usecases/live-stream-detection/live-stream-repository.interface.js";

// Repositoryが必要とする最小機能だけに依存し、結合度とモック実装コストを下げるための境界。
interface TwitchLiveStreamApi {
  findLiveStream: TwitchLiveStreamClient["findLiveStream"];
}

@injectable()
export class TwitchLiveStreamRepository implements LiveStreamRepository {
  constructor(
    @inject(TWITCH_DI_TOKENS.liveStreamClient)
    private readonly liveStreamClient: TwitchLiveStreamApi,
  ) {}

  async findLiveStream(
    input: FindLiveStreamInput,
  ): Promise<FindLiveStreamResult | null> {
    return this.liveStreamClient.findLiveStream({
      channelId: input.channelId,
    });
  }
}
