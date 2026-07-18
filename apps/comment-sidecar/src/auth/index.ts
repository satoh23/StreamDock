// 032c-b(stream-dock): osareview backend/auth の entry（index.ts / provider.ts の createAuthClient）を
// Twitch Device Code 専用に distill した fork。
//  - YouTube（Authorization Code + loopback / PKCE / state）経路を除外
//  - TokenStore を KeyringTokenStoreRepository（native addon）→ InMemoryTokenStore に差し替え（§9・in-memory）
//  - BrowserLauncher を OpenBrowserLauncher（`open`）→ NoopBrowserLauncher に差し替え（open 廃止）
// このファイルが tsconfig paths の "@comment-dock/auth" のエントリになる。
import { container } from "tsyringe";
import type { Provider } from "../../vendor/auth/src/provider.js";
import { TwitchDeviceCodeOAuthClient } from "../../vendor/auth/src/adapters/twitch/client/device-code-oauth.client.js";
import { TwitchLoginPolicy } from "../../vendor/auth/src/adapters/twitch/config/login-policy.js";
import { DeviceCodeLoginStrategy } from "../../vendor/auth/src/adapters/twitch/login/device-code-login-strategy.js";
import { LoginUsecase } from "../../vendor/auth/src/usecases/login.usecase.js";
import {
  GetValidAccessTokenUsecase,
  NotAuthorizedError,
} from "../../vendor/auth/src/usecases/get-valid-access-token.usecase.js";
import {
  GetLinkStatusUsecase,
  type LinkStatus,
} from "../../vendor/auth/src/usecases/get-link-status.usecase.js";
import { RefreshAccessTokenUsecase } from "../../vendor/auth/src/usecases/refresh-access-token.usecase.js";
import {
  WithAuthorizedRequestUsecase,
  type AuthorizedRequestFn,
} from "../../vendor/auth/src/usecases/with-authorized-request.usecase.js";
import {
  CreateAuthorizedTokenAccessorUsecase,
  type AuthorizedTokenAccessor,
} from "../../vendor/auth/src/usecases/create-authorized-token-accessor.usecase.js";
import {
  AuthorizationLostNotifier,
  type AuthorizationLostEvent,
  type AuthorizationLostListener,
} from "../../vendor/auth/src/shared/authorization-lost-notifier.js";
import { AUTH_DI_TOKENS } from "../../vendor/auth/src/shared/di-tokens.js";
import {
  DEFAULT_ACCESS_TOKEN_CLOCK_SKEW_MS,
  TokenSet,
  type TokenSetPlain,
} from "../../vendor/auth/src/entities/token/token-set.js";
import type {
  LoginStrategy,
  OAuthTokenRefresher,
  TokenStore,
} from "../../vendor/auth/src/usecases/interfaces/index.js";
import { UnauthorizedRequestError } from "../../vendor/auth/src/errors/unauthorized-request.error.js";
import { InMemoryTokenStore } from "./in-memory-token-store.js";
import {
  PersistingTokenStore,
  type TokenPersistListener,
} from "./persisting-token-store.js";
import { NoopBrowserLauncher } from "./noop-browser-launcher.js";
import { PinnedTwitchOAuthConfigProvider } from "../twitch-config.js";

/** Device Code の画面提示情報（viewer にテキスト提示する user_code / verification_uri）。 */
export interface DeviceCodePrompt {
  userCode: string;
  verificationUri: string;
}

export type { Provider };
export type {
  AuthorizationLostEvent,
  AuthorizationLostListener,
  AuthorizedTokenAccessor,
  AuthorizedRequestFn,
  LinkStatus,
  TokenSetPlain,
};
export { NotAuthorizedError, UnauthorizedRequestError };

export interface AuthClient {
  login(provider: Provider): Promise<void>;
  /**
   * 032c-b: Twitch Device Code ログイン。polling 前に `onDeviceCode` で user_code / verification_uri を
   * 呼び出し側へ渡す（osareview の login は user_code を破棄していたギャップを解消）。成功時トークンは
   * この AuthClient の in-memory ストアに保存され、取得パイプラインが同じストアから読む。
   */
  loginTwitchWithDeviceCode(
    onDeviceCode: (prompt: DeviceCodePrompt) => void,
  ): Promise<void>;
  /**
   * 032c-b: 起動時に OS キーチェーンから読んだトークンをメモリのストアへ復元する（ログイン永続化）。
   * これ自体はネットワークを張らない（取得は start-session で明示的に開始）。復元は Rust への
   * 書き戻し通知を出さない（PersistingTokenStore.restore 経由）。
   */
  restoreTwitchToken(plain: TokenSetPlain): Promise<void>;
  getLinkStatus(provider: Provider): Promise<LinkStatus>;
  getValidAccessToken(provider: Provider): Promise<string>;
  withAuthorizedRequest<T>(
    provider: Provider,
    requestFn: AuthorizedRequestFn<T>,
  ): Promise<T>;
  createAuthorizedTokenAccessor(provider: Provider): AuthorizedTokenAccessor;
  onAuthorizationLost(listener: AuthorizationLostListener): () => void;
  refresh(provider: Provider): Promise<string>;
  logout(provider: Provider): Promise<void>;
}

export type CreateAuthClientOptions = {
  accessTokenClockSkewMs?: number;
  /**
   * 032c-b: twitch トークンの save/clear を外へ通知する（Rust が OS キーチェーンへ永続化するための hook）。
   * save 時は最新の `TokenSetPlain`、clear 時は `null`。未指定なら永続化しない（従来どおり in-memory のみ）。
   */
  onTokenPersist?: TokenPersistListener;
};

// 032c-b: Twitch のみサポート（YouTube は distill 対象外）。
function assertSupportedProvider(provider: Provider): void {
  if (provider !== "twitch") {
    throw new Error(`対応していない連携先です: ${provider}`);
  }
}

export function createAuthClient(
  options: CreateAuthClientOptions = {},
): AuthClient {
  const c = container.createChildContainer();

  const browserLauncher = new NoopBrowserLauncher();
  // 032c-b: env ピン留め。Env* ではなく定数 Provider を使う（endpoint override を排除）。
  const twitchConfigProvider = new PinnedTwitchOAuthConfigProvider();
  const twitchDeviceCodeOAuthClient = new TwitchDeviceCodeOAuthClient(
    twitchConfigProvider,
  );
  const twitchLoginPolicy = new TwitchLoginPolicy(twitchConfigProvider);
  const authorizationLostNotifier = new AuthorizationLostNotifier();

  const twitchLoginStrategy = new DeviceCodeLoginStrategy(
    twitchDeviceCodeOAuthClient,
    browserLauncher,
    twitchLoginPolicy,
  );

  const loginStrategyByProvider = new Map<Provider, LoginStrategy>();
  loginStrategyByProvider.set("twitch", twitchLoginStrategy);

  const oauthTokenRefresherByProvider = new Map<Provider, OAuthTokenRefresher>();
  oauthTokenRefresherByProvider.set("twitch", twitchDeviceCodeOAuthClient);

  // 032c-b: ログイン永続化。InMemoryTokenStore を PersistingTokenStore でラップし、save/clear を
  // onTokenPersist（→ Rust が OS キーチェーンへ保存）へ通知する。restore は通知せずメモリへ載せるだけ。
  const tokenStore = new PersistingTokenStore(
    new InMemoryTokenStore(),
    options.onTokenPersist,
  );
  c.register<TokenStore>(AUTH_DI_TOKENS.tokenStore, { useValue: tokenStore });
  c.registerInstance<ReadonlyMap<Provider, LoginStrategy>>(
    AUTH_DI_TOKENS.loginStrategyByProvider,
    loginStrategyByProvider,
  );
  c.registerInstance<ReadonlyMap<Provider, OAuthTokenRefresher>>(
    AUTH_DI_TOKENS.oauthTokenRefresherByProvider,
    oauthTokenRefresherByProvider,
  );
  c.registerInstance<number>(
    AUTH_DI_TOKENS.accessTokenClockSkewMs,
    options.accessTokenClockSkewMs ?? DEFAULT_ACCESS_TOKEN_CLOCK_SKEW_MS,
  );
  c.registerInstance<AuthorizationLostNotifier>(
    AUTH_DI_TOKENS.authorizationLostNotifier,
    authorizationLostNotifier,
  );
  c.registerInstance<() => number>(AUTH_DI_TOKENS.nowFn, Date.now);

  const loginUsecase = c.resolve(LoginUsecase);
  const getLinkStatusUsecase = c.resolve(GetLinkStatusUsecase);
  const getValidAccessTokenUsecase = c.resolve(GetValidAccessTokenUsecase);
  const refreshAccessTokenUsecase = c.resolve(RefreshAccessTokenUsecase);
  c.registerInstance<RefreshAccessTokenUsecase>(
    AUTH_DI_TOKENS.refreshAccessTokenUsecase,
    refreshAccessTokenUsecase,
  );
  const withAuthorizedRequestUsecase = c.resolve(WithAuthorizedRequestUsecase);
  const createAuthorizedTokenAccessorUsecase = c.resolve(
    CreateAuthorizedTokenAccessorUsecase,
  );

  return {
    async login(provider: Provider): Promise<void> {
      assertSupportedProvider(provider);
      await loginUsecase.login(provider);
    },

    async loginTwitchWithDeviceCode(
      onDeviceCode: (prompt: DeviceCodePrompt) => void,
    ): Promise<void> {
      // requestDeviceAuthorization → user_code を呼び出し側へ提示 → polling → token をストアに保存。
      const scopes = twitchLoginPolicy.getScopes();
      const authorization =
        await twitchDeviceCodeOAuthClient.requestDeviceAuthorization(scopes);
      onDeviceCode({
        userCode: authorization.userCode,
        verificationUri: authorization.verificationUri.toString(),
      });
      const tokenSet = await twitchDeviceCodeOAuthClient.pollingForToken({
        deviceCode: authorization.deviceCode,
        intervalSeconds: authorization.intervalSeconds,
        expiresAtMs: authorization.expiresAtMs,
      });
      await tokenStore.save("twitch", tokenSet);
    },

    async restoreTwitchToken(plain: TokenSetPlain): Promise<void> {
      await tokenStore.restore("twitch", TokenSet.create(plain));
    },

    async getLinkStatus(provider: Provider): Promise<LinkStatus> {
      assertSupportedProvider(provider);
      return getLinkStatusUsecase.getLinkStatus(provider);
    },

    async getValidAccessToken(provider: Provider): Promise<string> {
      assertSupportedProvider(provider);
      return getValidAccessTokenUsecase.getValidAccessToken(provider);
    },

    async withAuthorizedRequest<T>(
      provider: Provider,
      requestFn: AuthorizedRequestFn<T>,
    ): Promise<T> {
      assertSupportedProvider(provider);
      return withAuthorizedRequestUsecase.execute(provider, requestFn);
    },

    createAuthorizedTokenAccessor(provider: Provider): AuthorizedTokenAccessor {
      assertSupportedProvider(provider);
      return createAuthorizedTokenAccessorUsecase.createAuthorizedTokenAccessor(
        provider,
      );
    },

    onAuthorizationLost(listener: AuthorizationLostListener): () => void {
      return authorizationLostNotifier.subscribe(listener);
    },

    async refresh(provider: Provider): Promise<string> {
      assertSupportedProvider(provider);
      return refreshAccessTokenUsecase.refresh(provider);
    },

    async logout(provider: Provider): Promise<void> {
      assertSupportedProvider(provider);
      await tokenStore.clear(provider);
    },
  };
}
