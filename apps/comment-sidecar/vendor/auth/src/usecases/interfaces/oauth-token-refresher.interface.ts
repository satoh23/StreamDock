import type { TokenSet } from "../../entities/token/token-set.js";

export type RefreshAccessTokenInput = {
  refreshToken: string;
};

/**
 * refresh_token でアクセストークンを更新する契約。
 * 認可フロー（Authorization Code / Device Code など）に依存しない共通境界として使う。
 *
 * NOTE:
 * YouTube の Authorization Code フロー実装と、今後追加する Twitch の Device Code フロー実装では
 * 「ログイン時の手順（authorize/exchange）」は異なる。
 * 一方で `getValidAccessToken` / `refresh` ユースケースが必要とするのは refresh 処理だけなので、
 * ここを切り出して依存を最小化している。
 * これによりユースケース側は OAuth の方式差分を意識せず、provider 透過な実装を保てる。
 */
export interface OAuthTokenRefresher {
  refresh(input: RefreshAccessTokenInput): Promise<TokenSet>;
}
