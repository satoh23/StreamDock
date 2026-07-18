export type FindLiveStreamInput = {
  channelId: string;
};

export type FindLiveStreamResult = {
  liveStreamId: string;
  liveChatId: string;
  title: string | null;
};

export interface LiveStreamRepository {
  findLiveStream(
    input: FindLiveStreamInput,
  ): Promise<FindLiveStreamResult | null>;
}
