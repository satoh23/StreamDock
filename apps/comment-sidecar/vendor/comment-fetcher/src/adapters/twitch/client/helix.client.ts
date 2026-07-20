import { inject, injectable } from "tsyringe";
import { UnauthorizedRequestError } from "@comment-dock/auth";
import { TWITCH_DI_TOKENS } from "../access-token/di-tokens.js";
import type { AuthorizedHttpClient } from "../../../infrastructure/shared/auth/access-token-provider.js";
import { SHARED_DI_TOKENS } from "../../../infrastructure/shared/http/http-client.js";
import type { HttpClient } from "../../../infrastructure/shared/http/http-client.js";
import type { TwitchConfigProvider } from "../../../infrastructure/twitch/config/api-config.js";
import type {
  TwitchEventSubSubscriptionsResponseDto,
  TwitchEventSubSubscriptionType,
  TwitchStreamsResponseDto,
  TwitchUsersResponseDto,
} from "../dto/raw.dto.js";

@injectable()
export class TwitchHelixClient {
  // getSelfUserId() の結果をメモ化し、同一プロセス内の重複API呼び出しを避ける。
  private selfUserId: string | null = null;

  constructor(
    @inject(TWITCH_DI_TOKENS.accessTokenProvider)
    private readonly authorizedHttpClient: AuthorizedHttpClient,
    @inject(SHARED_DI_TOKENS.httpClient)
    private readonly httpClient: HttpClient,
    @inject(TWITCH_DI_TOKENS.configProvider)
    private readonly configProvider: TwitchConfigProvider,
  ) {}

  /** user_login から broadcaster_user_id を1件解決する。 */
  async resolveUserIdByLogin(userLogin: string): Promise<string | null> {
    const query = new URLSearchParams({ login: userLogin });
    const url = `${this.configProvider.getHelixApiBaseUrl()}/users?${query.toString()}`;
    const response = await this.request<TwitchUsersResponseDto>(url, "GET");
    // ユーザーが見つかればそのID、見つからなければ null
    return response.data[0]?.id ?? null;
  }

  /** user_id から現在配信中の stream id とタイトルを1件取得する。 */
  async findActiveStream(
    userId: string,
  ): Promise<{ streamId: string; title: string | null } | null> {
    const query = new URLSearchParams({ user_id: userId });
    const url = `${this.configProvider.getHelixApiBaseUrl()}/streams?${query.toString()}`;
    const response = await this.request<TwitchStreamsResponseDto>(url, "GET");
    const stream = response.data[0];
    if (!stream?.id) return null;

    return { streamId: stream.id, title: stream.title ?? null };
  }

  /** 現在のアクセストークンに紐づく user_id を取得する。 */
  async getSelfUserId(): Promise<string> {
    if (this.selfUserId) {
      return this.selfUserId;
    }

    const url = `${this.configProvider.getHelixApiBaseUrl()}/users`;
    const response = await this.request<TwitchUsersResponseDto>(url, "GET");
    const userId = response.data[0]?.id;
    if (!userId) {
      throw new Error(
        "Twitch のログイン中ユーザーを確認できませんでした。もう一度アカウント連携を行ってください。",
      );
    }
    this.selfUserId = userId;
    return userId;
  }

  /** EventSub WebSocket セッションへチャット購読を1件作成する。 */
  async createEventSubSubscription(input: {
    type: TwitchEventSubSubscriptionType;
    version: "1";
    condition: {
      broadcaster_user_id: string;
      user_id: string;
    };
    sessionId: string;
  }): Promise<void> {
    await this.createEventSubSubscriptionWithToken(input);
  }

  /**
   * EventSub の長期接続側が保持している token で購読を作成する。
   * 401 は UnauthorizedRequestError として返し、呼び出し側が accessor.refresh() で再接続できるようにする。
   */
  async createEventSubSubscriptionWithToken(
    input: {
      type: TwitchEventSubSubscriptionType;
      version: "1";
      condition: {
        broadcaster_user_id: string;
        user_id: string;
      };
      sessionId: string;
    },
    accessToken?: string,
  ): Promise<void> {
    const url = `${this.configProvider.getHelixApiBaseUrl()}/eventsub/subscriptions`;
    const body = JSON.stringify({
      type: input.type,
      version: input.version,
      condition: input.condition,
      transport: {
        method: "websocket",
        session_id: input.sessionId,
      },
    });

    await this.request<TwitchEventSubSubscriptionsResponseDto>(
      url,
      "POST",
      body,
      accessToken,
    );
  }

  private async request<T>(
    url: string,
    method: "GET" | "POST",
    body?: string,
    accessToken?: string,
  ): Promise<T> {
    const clientId = this.configProvider.getClientId();
    if (!clientId) {
      throw new Error(
        "Twitch 連携を利用できません。アプリを再インストール／アップデートしてください。",
      );
    }

    if (accessToken) {
      return this.requestWithAccessToken(
        url,
        method,
        clientId,
        accessToken,
        body,
      );
    }

    // token の取得・refresh・retry は auth 側へ委譲し、
    // このクライアントは Helix API のリクエスト内容だけを組み立てる。
    return this.authorizedHttpClient.request(async (accessToken) => {
      return this.requestWithAccessToken(
        url,
        method,
        clientId,
        accessToken,
        body,
      );
    });
  }

  private async requestWithAccessToken<T>(
    url: string,
    method: "GET" | "POST",
    clientId: string,
    accessToken: string,
    body?: string,
  ): Promise<T> {
    const response = await this.httpClient(url, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Client-Id": clientId,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body } : {}),
    });

    if (response.status === 401) {
      throw new UnauthorizedRequestError();
    }

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Twitch API との通信に失敗しました（HTTP ${response.status} ${response.statusText}）: ${errorBody}`,
      );
    }

    return (await response.json()) as T;
  }
}
