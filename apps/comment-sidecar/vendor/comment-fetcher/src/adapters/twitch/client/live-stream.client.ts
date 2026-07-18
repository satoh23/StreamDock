import { inject, injectable } from "tsyringe";
import { TWITCH_DI_TOKENS } from "../access-token/di-tokens.js";
import type { TwitchHelixClient } from "./helix.client.js";

@injectable()
export class TwitchLiveStreamClient {
  constructor(
    @inject(TWITCH_DI_TOKENS.helixClient)
    private readonly helixClient: TwitchHelixClient,
  ) {}

  /** チャンネルlogin名から、現在配信中の配信IDとコメント取得対象IDを解決する。 */
  async findLiveStream(input: {
    channelId: string;
  }): Promise<{
    liveStreamId: string;
    liveChatId: string;
    title: string | null;
  } | null> {
    const broadcasterUserId = await this.helixClient.resolveUserIdByLogin(
      input.channelId,
    );
    if (!broadcasterUserId) {
      return null;
    }

    const activeStream =
      await this.helixClient.findActiveStream(broadcasterUserId);
    if (!activeStream) {
      return null;
    }

    return {
      liveStreamId: activeStream.streamId,
      // Twitch では EventSub購読対象として broadcaster_user_id を使う。
      liveChatId: broadcasterUserId,
      title: activeStream.title,
    };
  }
}
