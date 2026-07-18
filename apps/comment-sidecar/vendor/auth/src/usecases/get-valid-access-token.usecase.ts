import type { Provider } from "../provider.js";
import "reflect-metadata";
import { inject, injectable } from "tsyringe";
import type { OAuthTokenRefresher, TokenStore } from "./interfaces/index.js";
import { DEFAULT_ACCESS_TOKEN_CLOCK_SKEW_MS } from "../entities/token/token-set.js";
import { AUTH_DI_TOKENS } from "../shared/di-tokens.js";
import {
  AUTH_NOT_AUTHORIZED_REASON,
  AUTHORIZATION_LOST_REASON,
} from "../shared/authorization-reasons.js";

export class NotAuthorizedError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "NotAuthorizedError";
  }
}

export type GetValidAccessTokenUsecaseDeps = {
  tokenStore: TokenStore;
  oauthTokenRefresherByProvider: ReadonlyMap<Provider, OAuthTokenRefresher>;
  accessTokenClockSkewMs?: number;
};

@injectable()
export class GetValidAccessTokenUsecase {
  private readonly accessTokenClockSkewMs: number;

  constructor(
    @inject(AUTH_DI_TOKENS.tokenStore) private readonly tokenStore: TokenStore,
    @inject(AUTH_DI_TOKENS.oauthTokenRefresherByProvider)
    private readonly oauthTokenRefresherByProvider: ReadonlyMap<
      Provider,
      OAuthTokenRefresher
    >,
    @inject(AUTH_DI_TOKENS.accessTokenClockSkewMs)
    accessTokenClockSkewMs?: number,
  ) {
    this.accessTokenClockSkewMs =
      accessTokenClockSkewMs ?? DEFAULT_ACCESS_TOKEN_CLOCK_SKEW_MS;
  }

  async getValidAccessToken(provider: Provider): Promise<string> {
    const oauthTokenRefresher =
      this.oauthTokenRefresherByProvider.get(provider);
    if (oauthTokenRefresher === undefined) {
      throw new Error(`対応していない連携先です: ${provider}`);
    }

    const tokenSet = await this.tokenStore.get(provider);
    if (tokenSet === null) {
      throw new NotAuthorizedError(AUTH_NOT_AUTHORIZED_REASON);
    }

    if (tokenSet.isAccessTokenLive(this.accessTokenClockSkewMs)) {
      return tokenSet.accessToken;
    }

    try {
      const refreshed = await oauthTokenRefresher.refresh({
        refreshToken: tokenSet.refreshToken,
      });
      await this.tokenStore.save(provider, refreshed);
      return refreshed.accessToken;
    } catch (err) {
      await this.tokenStore.clear(provider);
      throw new NotAuthorizedError(AUTHORIZATION_LOST_REASON, { cause: err });
    }
  }
}
