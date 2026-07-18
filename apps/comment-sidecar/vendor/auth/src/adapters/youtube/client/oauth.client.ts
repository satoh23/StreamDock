import type {
  AuthorizationRequest,
  ExchangeAuthorizationCodeInput,
  OAuthClient,
} from "../../../usecases/interfaces/oauth-client.interface.js";
import { RefreshAccessTokenInput } from "../../../usecases/interfaces/oauth-token-refresher.interface.js";
import type {
  YouTubeTokenErrorResponse,
  YouTubeTokenSuccessResponse,
} from "../dto/oauth.dto.js";
import "reflect-metadata";
import { inject, injectable } from "tsyringe";
import { TokenSet } from "../../../entities/token/token-set.js";
import type { YouTubeOAuthConfigProvider } from "../../../infrastructure/youtube/config/oauth-config.js";
import { AUTH_DI_TOKENS } from "../../../shared/di-tokens.js";

type FetchLike = typeof fetch;

class YouTubeOAuthClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "YouTubeOAuthClientError";
  }
}

@injectable()
export class YouTubeOAuthClient implements OAuthClient {
  private readonly fetchFn: FetchLike;

  constructor(
    @inject(AUTH_DI_TOKENS.oauthConfigProvider)
    private readonly configProvider: YouTubeOAuthConfigProvider,
    options: { fetchFn?: FetchLike } = {},
  ) {
    this.fetchFn = options.fetchFn ?? fetch;
  }

  authorize(request: AuthorizationRequest): URL {
    const config = this.configProvider.getOAuthConfig();

    const url = new URL(config.authorizationEndpoint);
    url.searchParams.set("client_id", config.clientId);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("redirect_uri", request.redirectUri);
    url.searchParams.set("scope", request.scopes.join(" "));
    url.searchParams.set("state", request.state);
    url.searchParams.set("code_challenge", request.codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    return url;
  }

  async exchange(input: ExchangeAuthorizationCodeInput): Promise<TokenSet> {
    const config = this.configProvider.getOAuthConfig();

    const payload = new URLSearchParams();
    payload.set("client_id", config.clientId);
    payload.set("client_secret", config.clientSecret);
    payload.set("grant_type", "authorization_code");
    payload.set("code", input.code);
    payload.set("code_verifier", input.codeVerifier);
    payload.set("redirect_uri", input.redirectUri);
    const response = await this.fetchFn(config.tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: payload,
    });

    const json = await this.readJson(response);
    const token = this.parseTokenResponse(json);

    return this.toTokenSet(token, token.refresh_token);
  }

  async refresh(input: RefreshAccessTokenInput): Promise<TokenSet> {
    const config = this.configProvider.getOAuthConfig();

    const payload = new URLSearchParams();
    payload.set("client_id", config.clientId);
    payload.set("client_secret", config.clientSecret);
    payload.set("grant_type", "refresh_token");
    payload.set("refresh_token", input.refreshToken);
    const response = await this.fetchFn(config.tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: payload,
    });

    const json = await this.readJson(response);
    const token = this.parseTokenResponse(json);

    return this.toTokenSet(token, token.refresh_token ?? input.refreshToken);
  }

  private async readJson(response: Response): Promise<unknown> {
    let json: unknown;

    try {
      json = await response.json();
    } catch {
      throw new YouTubeOAuthClientError(
        "YouTube からのログイン応答を読み取れませんでした。もう一度お試しください。",
      );
    }
    if (!response.ok) {
      throw this.errorFromErrorResponse(json, response.status);
    }
    return json;
  }

  private errorFromErrorResponse(json: unknown, status: number): Error {
    if (isYouTubeTokenErrorResponse(json) && json.error) {
      const description =
        json.error_description !== undefined
          ? ` (${json.error_description})`
          : "";
      return new YouTubeOAuthClientError(
        `YouTube ログインでエラーが発生しました: ${json.error}${description}`,
      );
    }
    return new YouTubeOAuthClientError(
      `YouTube ログインで通信エラーが発生しました（HTTP ${status}）。`,
    );
  }

  private parseTokenResponse(json: unknown): YouTubeTokenSuccessResponse {
    if (!isYouTubeTokenSuccessResponse(json)) {
      throw new YouTubeOAuthClientError(
        "YouTube からのログイン応答の形式が正しくありません。もう一度お試しください。",
      );
    }
    return json;
  }

  private toTokenSet(
    token: YouTubeTokenSuccessResponse,
    refreshToken: string | undefined,
  ): TokenSet {
    if (refreshToken === undefined || refreshToken === "") {
      throw new YouTubeOAuthClientError(
        "YouTube のログイン更新情報が見つかりません。もう一度アカウント連携を行ってください。",
      );
    }

    const obtainedAt = Date.now();

    return TokenSet.create({
      accessToken: token.access_token,
      refreshToken,
      expiresAt: TokenSet.accessTokenExpiresAtMs(obtainedAt, token.expires_in),
      scope: token.scope,
      obtainedAt,
    });
  }
}

function isYouTubeTokenErrorResponse(
  value: unknown,
): value is YouTubeTokenErrorResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    (v.error === undefined || typeof v.error === "string") &&
    (v.error_description === undefined ||
      typeof v.error_description === "string")
  );
}

function isYouTubeTokenSuccessResponse(
  value: unknown,
): value is YouTubeTokenSuccessResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    typeof v.access_token === "string" &&
    typeof v.token_type === "string" &&
    typeof v.expires_in === "number" &&
    typeof v.scope === "string" &&
    (v.refresh_token === undefined || typeof v.refresh_token === "string")
  );
}
