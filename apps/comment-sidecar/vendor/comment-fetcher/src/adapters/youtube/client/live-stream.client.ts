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
  YouTubeLiveBroadcastsListResponseDto,
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

  // 032c-d″(stream-dock): 自分のアクティブ配信の検出を search.list(eventType=live・**100 unit**・検索インデックスの
  // 反映が遅く配信開始直後は null が返りがち) から liveBroadcasts.list(broadcastStatus=active・**1 unit**・配信管理
  // API なので即時整合) へ置換する。liveChatId/title/videoId が 1 コールで揃うため、従来の videos.list(findLiveDetails)
  // 追い打ちも不要になる。input.channelId は broadcastStatus=active が認証ユーザー自身に暗黙固定されるため未使用
  //（repository/usecase 側の呼び出し parity を保つため引数は残置）。宛先は既存 allow-list の www.googleapis.com のまま。
  async findLiveStream(_input: {
    channelId: string;
  }): Promise<{
    liveStreamId: string;
    liveChatId: string;
    title: string | null;
  } | null> {
    return this.findActiveOwnBroadcast();
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

  // 032c-d′(stream-dock): 指定ライブ配信 videoId がまだアクティブ（活きた activeLiveChatId を持つ）かを
  // **videos.list（by-id・1 unit・結果が安定）** で確認する。配信終了監視（monitorLiveStreamEnd）用。
  // 元の監視は search.list（eventType=live・**100 unit**・インデックス反映が遅く不整合）で毎回再検出しており、
  // 生存中でも null が返って誤って「配信終了」と判定＋クォータを急速に消費していた。by-id の videos.list は
  // 配信中は activeLiveChatId を安定して返し、配信が終わると欠落するため、安価かつ確実な生存判定になる。
  async isLiveStreamActive(liveStreamId: string): Promise<boolean> {
    const details = await this.findLiveDetails(liveStreamId);
    return details.liveChatId !== null;
  }

  /**
   * 認証ユーザー自身の「現在アクティブなライブ配信」を liveBroadcasts.list で 1 件取得する（1 unit）。
   * broadcastStatus=active は認証ユーザーのライブ中 broadcast だけを返す（search と違い検索インデックス
   * 非依存で即時整合）。broadcastType=all で通常配信/イベント配信の双方を対象にする。
   * liveChatId が無い（＝チャット無効/未開始）ものは取得対象外なので null 扱いにする。
   *
   * 032c-d‴(stream-dock) 補足: 現在の生存判定は **`broadcastStatus=active` フィルタ＋`liveChatId` の有無**のみで行い、
   * `status.lifeCycleStatus` は取得するが判定には使っていない。`part=status` を残す意図:
   *  ①liveBroadcasts.list は part 数に関わらず **1 unit 固定**なので追加コストが無い、②将来より厳密な生存ゲート
   *   （例: `lifeCycleStatus === "live"` で **testing/ready（モニタ配信・liveChatId は持つが未公開）を除外**）を
   *   入れたくなった時にレスポンス shape を変えずに済む・診断にも使える。
   * 再検討の目安: testing/ready の broadcast を「配信中」と誤検出して困る事例が出たら `lifeCycleStatus === "live"` を
   *  追加ゲートにする（liveStarting 等の中間状態の扱いは要判断）。将来も使わないと決めたら `,status` と DTO の status を削れる。
   */
  private async findActiveOwnBroadcast(): Promise<{
    liveStreamId: string;
    liveChatId: string;
    title: string | null;
  } | null> {
    const query = new URLSearchParams({
      part: "snippet,status",
      broadcastStatus: "active",
      broadcastType: "all",
      maxResults: "1",
    });
    const url = `${this.configProvider.getDataApiBaseUrl()}/liveBroadcasts?${query.toString()}`;
    const response =
      await this.request<YouTubeLiveBroadcastsListResponseDto>(url);
    const item = response.items[0];
    const liveStreamId = item?.id ?? null;
    const liveChatId = item?.snippet?.liveChatId ?? null;
    if (!liveStreamId || !liveChatId) {
      return null;
    }
    return {
      liveStreamId,
      liveChatId,
      title: item?.snippet?.title ?? null,
    };
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
