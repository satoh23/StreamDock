import type { AuthorizedTokenAccessor } from "@comment-dock/auth";

export interface AccessTokenProvider {
  getAccessToken(): Promise<string>;
}

export type AuthorizedHttpRequest<T> = (accessToken: string) => Promise<T>;

/**
 * REST クライアントが token 取得や refresh 判定を直接持たないようにする境界。
 * 内部で auth の withAuthorizedRequest を使う実装に差し替えられるため、HTTP 呼び出し単位の認可処理をテストしやすくする。
 */
export interface AuthorizedHttpClient {
  request<T>(request: AuthorizedHttpRequest<T>): Promise<T>;
}

/**
 * gRPC / WebSocket など、接続中に token refresh が必要になる処理へ accessor を渡す境界。
 * 長期接続側は refresh の実装を知らず、認可エラーを検知した時だけ accessor.refresh() を呼べばよい。
 */
export interface AuthorizedTokenAccessorProvider {
  createAuthorizedTokenAccessor(): AuthorizedTokenAccessor;
}
