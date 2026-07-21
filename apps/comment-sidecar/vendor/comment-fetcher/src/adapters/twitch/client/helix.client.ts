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

// Helix `GET /users` は 1 リクエストあたり最大 100 件の id を受け付ける。
const HELIX_USERS_BATCH_LIMIT = 100;

// 036c【レビュー対応・要修正】アバター解決の Helix `/users` にだけ課すタイムアウト（ms）。repository は
// chat イベントごとに ensureAvatarResolved を **yield 前に await** するため、Helix 遅延/ハング時に
// コメント配信 critical path を無制限にブロックしないよう上限を設ける（best-effort のアバターが本線を
// 止めないための fail-safe）。画像 fetch 側の 3s タイムアウトと対称。5s は 401 refresh+リトライ込みの上限を
// 見込んだ値。購読作成・self user id など起動系の Helix 呼び出しは per-event でないため対象外（signal 未指定）。
const HELIX_USERS_REQUEST_TIMEOUT_MS = 5000;

// 036c: overlay の投稿者アイコン表示サイズ（44px）に対する取得サイズ。Twitch の available variant のうち近い値。
const TWITCH_AVATAR_TARGET_SIZE = 70;

/**
 * 036c: Twitch の `profile_image_url` は既定で 300x300 を返す（Helix にサイズ指定パラメータが無い）。
 * 300x300 の写真系アイコンは 036b 基盤のバイト上限(128KB)に迫る/超えるため、URL 内の
 * `-profile_image-<W>x<H>` を小サイズへ差し替えて **CDN 側で縮小**させる（YouTube の `profile_image_size=48` 相当）。
 * これで確実に上限を下回り WS ペイロードも軽くなる。パターンに一致しない URL はそのまま返す（安全側）。
 *
 * 【レビュー対応・修正不要】70x70 variant が CDN に存在する前提（`jtv_user_pictures` /
 * `user-default-pictures-uv` の標準サイズで確認済み）。variant を生成しない/URL 形状が違う稀ケースは
 * 404→`resolveAvatarDataUri` が undefined→グレー丸で無害にフォールバックするため、失敗時の原寸リトライ等は
 * 今回は入れない。再修正トリガー: 実配信で 70x70 の 404 起因グレー丸が実測で問題化したら、150x150 併用や
 * 失敗時の原寸フォールバックを検討する。
 */
function toSmallTwitchAvatarUrl(url: string): string {
  return url.replace(
    /-profile_image-\d+x\d+/,
    `-profile_image-${TWITCH_AVATAR_TARGET_SIZE}x${TWITCH_AVATAR_TARGET_SIZE}`,
  );
}

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

  /**
   * 036c: 投稿者 ID からプロフィール画像 URL を解決する（オーバーレイのアバター表示用）。
   * chat イベントにアバターが載らない Twitch のための追加照会。
   * - 入力を重複排除し、Helix の上限に合わせて 100 件ずつバッチ照会する（`/users?id=A&id=B...`）。
   * - 戻り値は id→profile_image_url の Map（未取得/空文字の投稿者は含めない）。
   * - 呼び出し側は id→URL キャッシュで同一投稿者の再照会を避けること（過剰呼び出し防止）。
   */
  async getUserProfileImagesByIds(
    userIds: string[],
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    const uniqueIds = [...new Set(userIds)].filter((id) => id.length > 0);
    if (uniqueIds.length === 0) {
      return result;
    }

    const baseUrl = this.configProvider.getHelixApiBaseUrl();
    for (let i = 0; i < uniqueIds.length; i += HELIX_USERS_BATCH_LIMIT) {
      const chunk = uniqueIds.slice(i, i + HELIX_USERS_BATCH_LIMIT);
      const query = new URLSearchParams();
      for (const id of chunk) {
        query.append("id", id);
      }
      const url = `${baseUrl}/users?${query.toString()}`;
      // アバター解決だけタイムアウトを課す（per-event await が本線をブロックしないため・上記定数コメント参照）。
      // タイムアウト時は AbortError が throw → repository の catch でキャッシュせず次コメントで再試行。
      const response = await this.request<TwitchUsersResponseDto>(
        url,
        "GET",
        undefined,
        undefined,
        AbortSignal.timeout(HELIX_USERS_REQUEST_TIMEOUT_MS),
      );
      for (const user of response.data) {
        if (user.profile_image_url) {
          result.set(user.id, toSmallTwitchAvatarUrl(user.profile_image_url));
        }
      }
    }

    return result;
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

  // signal は任意（既存呼び出しは未指定＝従来どおり無タイムアウト）。036c のアバター解決だけが
  // AbortSignal.timeout を渡し、per-event await が本線をブロックしないようにする。
  private async request<T>(
    url: string,
    method: "GET" | "POST",
    body?: string,
    accessToken?: string,
    signal?: AbortSignal,
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
        signal,
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
        signal,
      );
    });
  }

  private async requestWithAccessToken<T>(
    url: string,
    method: "GET" | "POST",
    clientId: string,
    accessToken: string,
    body?: string,
    signal?: AbortSignal,
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
      ...(signal ? { signal } : {}),
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
