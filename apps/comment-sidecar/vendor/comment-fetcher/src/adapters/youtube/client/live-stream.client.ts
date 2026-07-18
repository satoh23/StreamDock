import { inject, injectable } from "tsyringe";
import { UnauthorizedRequestError } from "@comment-dock/auth";
import {
  QuotaExceededError,
  isRestQuotaExceededResponse,
} from "../../shared/quota/error.js";
import { YOUTUBE_DI_TOKENS } from "../access-token/di-tokens.js";
import type { AuthorizedHttpClient } from "../../../infrastructure/shared/auth/access-token-provider.js";
import { SHARED_DI_TOKENS } from "../../../infrastructure/shared/http/http-client.js";
import type { HttpClient } from "../../../infrastructure/shared/http/http-client.js";
import type { YouTubeConfigProvider } from "../../../infrastructure/youtube/config/api-config.js";
import type {
  YouTubeChannelsListResponseDto,
  YouTubeSearchListResponseDto,
  YouTubeVideosListResponseDto,
} from "../dto/live-stream.dto.js";

@injectable()
export class YouTubeLiveStreamClient {
  constructor(
    @inject(YOUTUBE_DI_TOKENS.accessTokenProvider)
    private readonly authorizedHttpClient: AuthorizedHttpClient,
    @inject(SHARED_DI_TOKENS.httpClient)
    private readonly httpClient: HttpClient,
    @inject(YOUTUBE_DI_TOKENS.configProvider)
    private readonly configProvider: YouTubeConfigProvider,
  ) {}

  async findLiveStream(input: {
    channelId: string;
  }): Promise<{
    liveStreamId: string;
    liveChatId: string;
    title: string | null;
  } | null> {
    const liveStreamId = await this.findLiveStreamId(input.channelId);
    if (!liveStreamId) {
      return null;
    }

    const details = await this.findLiveDetails(liveStreamId);
    if (!details.liveChatId) {
      return null;
    }

    return {
      liveStreamId,
      liveChatId: details.liveChatId,
      title: details.title,
    };
  }

  /** OAuth ログイン中ユーザー自身の channelId を取得する。 */
  async resolveOwnChannelId(): Promise<string | null> {
    const query = new URLSearchParams({
      part: "id",
      mine: "true",
      maxResults: "1",
    });
    const url = `${this.configProvider.getDataApiBaseUrl()}/channels?${query.toString()}`;
    const response = await this.request<YouTubeChannelsListResponseDto>(url);
    return response.items[0]?.id ?? null;
  }

  /** 指定チャンネルで現在配信中のライブ配信IDを1件取得する。 */
  private async findLiveStreamId(channelId: string): Promise<string | null> {
    const query = new URLSearchParams({
      part: "id",
      channelId,
      eventType: "live",
      type: "video",
      maxResults: "1",
    });
    const url = `${this.configProvider.getDataApiBaseUrl()}/search?${query.toString()}`;
    const response = await this.request<YouTubeSearchListResponseDto>(url);
    return response.items[0]?.id?.videoId ?? null;
  }

  /** 指定したライブ配信IDに紐づくライブチャットIDとタイトルを取得する。 */
  private async findLiveDetails(
    liveStreamId: string,
  ): Promise<{ liveChatId: string | null; title: string | null }> {
    const query = new URLSearchParams({
      part: "liveStreamingDetails,snippet",
      id: liveStreamId,
    });
    const url = `${this.configProvider.getDataApiBaseUrl()}/videos?${query.toString()}`;
    const response = await this.request<YouTubeVideosListResponseDto>(url);
    const item = response.items[0];
    return {
      liveChatId: item?.liveStreamingDetails?.activeLiveChatId ?? null,
      title: item?.snippet?.title ?? null,
    };
  }

  private async request<T>(url: string): Promise<T> {
    // token の取得・refresh・retry は auth 側へ委譲し、
    // このクライアントは YouTube Data API のリクエスト内容だけを組み立てる。
    return this.authorizedHttpClient.request(async (accessToken) => {
      const response = await this.httpClient(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
      });

      if (response.status === 401) {
        throw new UnauthorizedRequestError();
      }

      if (!response.ok) {
        const errorBody = await response.text();
        // 032c-d(stream-dock): 403 quotaExceeded 等は graceful stop 用に分類する（generic Error にしない）。
        if (isRestQuotaExceededResponse(response.status, errorBody)) {
          throw new QuotaExceededError();
        }
        throw new Error(
          `YouTube API との通信に失敗しました（HTTP ${response.status} ${response.statusText}）: ${errorBody}`,
        );
      }

      return (await response.json()) as T;
    });
  }
}
