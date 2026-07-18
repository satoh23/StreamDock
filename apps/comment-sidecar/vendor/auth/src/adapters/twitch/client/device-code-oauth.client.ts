import type {
  DeviceAuthorization,
  DeviceCodeOAuthClient,
  PollingForTokenInput,
} from "../../../usecases/interfaces/device-code-oauth-client.interface.js";
import type { RefreshAccessTokenInput } from "../../../usecases/interfaces/oauth-token-refresher.interface.js";
import type {
  TwitchDeviceAuthorizationSuccessResponse,
  TwitchTokenErrorResponse,
  TwitchTokenSuccessResponse,
} from "../dto/oauth.dto.js";
import "reflect-metadata";
import { inject, injectable } from "tsyringe";
import { TokenSet } from "../../../entities/token/token-set.js";
import { AUTH_DI_TOKENS } from "../../../shared/di-tokens.js";

type FetchLike = typeof fetch;
type SleepMsFn = (ms: number, signal?: AbortSignal) => Promise<void>;
type NowFn = () => number;

const DEFAULT_DEVICE_AUTHORIZATION_ENDPOINT =
  "https://id.twitch.tv/oauth2/device";
const DEFAULT_TOKEN_ENDPOINT = "https://id.twitch.tv/oauth2/token";

interface TwitchDeviceCodeOAuthConfig {
  readonly clientId: string;
  readonly deviceAuthorizationEndpoint: string;
  readonly tokenEndpoint: string;
}

interface TwitchDeviceCodeOAuthConfigProvider {
  getOAuthConfig(): TwitchDeviceCodeOAuthConfig;
}

class TwitchDeviceCodeOAuthClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TwitchDeviceCodeOAuthClientError";
  }
}

/**
 * Device Code Flow のポーリング間隔待機で使う中断可能な sleep。
 *
 * - `signal` 未指定: 指定ミリ秒だけ待って resolve
 * - `signal` 指定: abort 済みなら即 reject、待機中に abort された場合も reject
 *
 * ポーリングをキャンセルできるようにすることで、CLI/UI からの中断要求に安全に追従できる。
 */
async function defaultSleepMs(ms: number, signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const id = setTimeout(resolve, ms);
    if (signal === undefined) {
      return;
    }
    const onAbort = () => {
      clearTimeout(id);
      reject(new Error("ログイン確認を中断しました。"));
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

@injectable()
export class TwitchDeviceCodeOAuthClient implements DeviceCodeOAuthClient {
  private readonly fetchFn: FetchLike;
  private readonly sleepMsFn: SleepMsFn;
  private readonly nowFn: NowFn;

  constructor(
    @inject(AUTH_DI_TOKENS.oauthConfigProvider)
    private readonly configProvider: TwitchDeviceCodeOAuthConfigProvider,
    options: { fetchFn?: FetchLike; sleepMsFn?: SleepMsFn; nowFn?: NowFn } = {},
  ) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.sleepMsFn = options.sleepMsFn ?? defaultSleepMs;
    this.nowFn = options.nowFn ?? Date.now;
  }

  async requestDeviceAuthorization(
    scopes: readonly string[],
  ): Promise<DeviceAuthorization> {
    const config = this.getConfig();

    const payload = new URLSearchParams();
    payload.set("client_id", config.clientId);
    payload.set("scopes", scopes.join(" "));

    const response = await this.fetchFn(config.deviceAuthorizationEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: payload,
    });

    const json = await this.readJson(response, "device authorization");
    if (!isValidTwitchDeviceAuthorizationResponse(json)) {
      throw new TwitchDeviceCodeOAuthClientError(
        "Twitch からのログイン開始応答の形式が正しくありません。もう一度お試しください。",
      );
    }

    return {
      deviceCode: json.device_code,
      userCode: json.user_code,
      verificationUri: new URL(json.verification_uri),
      intervalSeconds: json.interval,
      expiresAtMs: this.nowFn() + json.expires_in * 1000,
    };
  }

  async pollingForToken(input: PollingForTokenInput): Promise<TokenSet> {
    const config = this.getConfig();

    while (this.nowFn() < input.expiresAtMs) {
      await this.sleepMsFn(input.intervalSeconds * 1000, input.signal);

      const payload = new URLSearchParams();
      payload.set("client_id", config.clientId);
      payload.set("device_code", input.deviceCode);
      payload.set("grant_type", "urn:ietf:params:oauth:grant-type:device_code");

      const response = await this.fetchFn(config.tokenEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: payload,
      });

      const json = await this.readJsonAllowError(
        response,
        "device token polling",
      );
      if (response.ok) {
        const token = this.parseTokenResponse(json);
        return this.toTokenSet(token, token.refresh_token);
      }

      if (
        isTwitchTokenErrorResponse(json) &&
        json.message === "authorization_pending"
      ) {
        continue;
      }

      throw this.errorFromErrorResponse(json, response.status, "token polling");
    }

    throw new TwitchDeviceCodeOAuthClientError(
      "Twitch のログイン確認が時間切れになりました。もう一度アカウント連携を行ってください。",
    );
  }

  async refresh(input: RefreshAccessTokenInput): Promise<TokenSet> {
    const config = this.getConfig();

    const payload = new URLSearchParams();
    payload.set("client_id", config.clientId);
    payload.set("grant_type", "refresh_token");
    payload.set("refresh_token", input.refreshToken);

    const response = await this.fetchFn(config.tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: payload,
    });

    const json = await this.readJson(response, "refresh token");
    const token = this.parseTokenResponse(json);

    return this.toTokenSet(token, token.refresh_token ?? input.refreshToken);
  }

  /**
   * OAuth 設定を解決して返す。
   *
   * `configProvider` から受け取った値をベースに、
   * endpoint が空の場合は Twitch の既定値へフォールバックする。
   * これにより test/override の柔軟性を保ちながら、未設定時も安全に動作できる。
   */
  private getConfig(): TwitchDeviceCodeOAuthConfig {
    const config = this.configProvider.getOAuthConfig();

    return {
      clientId: config.clientId,
      deviceAuthorizationEndpoint:
        config.deviceAuthorizationEndpoint ||
        DEFAULT_DEVICE_AUTHORIZATION_ENDPOINT,
      tokenEndpoint: config.tokenEndpoint || DEFAULT_TOKEN_ENDPOINT,
    };
  }

  private async readJson(
    response: Response,
    context: string,
  ): Promise<unknown> {
    const json = await this.readJsonAllowError(response, context);

    if (!response.ok) {
      throw this.errorFromErrorResponse(json, response.status, context);
    }

    return json;
  }

  private async readJsonAllowError(
    response: Response,
    context: string,
  ): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      throw new TwitchDeviceCodeOAuthClientError(
        `Twitch からの応答を読み取れませんでした（${context}）。もう一度お試しください。`,
      );
    }
  }

  private errorFromErrorResponse(
    json: unknown,
    status: number,
    context: string,
  ): Error {
    if (isTwitchTokenErrorResponse(json)) {
      const message = json.message ?? json.error;
      if (message) {
        return new TwitchDeviceCodeOAuthClientError(
          `Twitch 連携でエラーが発生しました（${context}）: ${message}`,
        );
      }
    }
    return new TwitchDeviceCodeOAuthClientError(
      `Twitch 連携で通信エラーが発生しました（${context}, HTTP ${status}）。`,
    );
  }

  private parseTokenResponse(json: unknown): TwitchTokenSuccessResponse {
    if (typeof json !== "object" || json === null) {
      throw new TwitchDeviceCodeOAuthClientError(
        "Twitch からのログイン応答の形式が正しくありません。もう一度お試しください。",
      );
    }
    const v = json as Record<string, unknown>;
    const scope = v.scope;
    const scopeOk =
      typeof scope === "string" ||
      (Array.isArray(scope) && scope.every((s) => typeof s === "string"));
    const valid =
      typeof v.access_token === "string" &&
      typeof v.expires_in === "number" &&
      Number.isFinite(v.expires_in) &&
      typeof v.token_type === "string" &&
      scopeOk &&
      (v.refresh_token === undefined || typeof v.refresh_token === "string");
    if (!valid) {
      throw new TwitchDeviceCodeOAuthClientError(
        "Twitch からのログイン応答の形式が正しくありません。もう一度お試しください。",
      );
    }
    return json as TwitchTokenSuccessResponse;
  }

  private toTokenSet(
    token: TwitchTokenSuccessResponse,
    refreshToken: string | undefined,
  ): TokenSet {
    if (refreshToken === undefined || refreshToken === "") {
      throw new TwitchDeviceCodeOAuthClientError(
        "Twitch のログイン更新情報が見つかりません。もう一度アカウント連携を行ってください。",
      );
    }

    const obtainedAt = this.nowFn();
    const scope =
      typeof token.scope === "string" ? token.scope : token.scope.join(" ");

    return TokenSet.create({
      accessToken: token.access_token,
      refreshToken,
      expiresAt: TokenSet.accessTokenExpiresAtMs(obtainedAt, token.expires_in),
      scope,
      obtainedAt,
    });
  }
}

function isValidTwitchDeviceAuthorizationResponse(
  value: unknown,
): value is TwitchDeviceAuthorizationSuccessResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    typeof v.device_code === "string" &&
    typeof v.user_code === "string" &&
    typeof v.verification_uri === "string" &&
    typeof v.expires_in === "number" &&
    Number.isFinite(v.expires_in) &&
    typeof v.interval === "number" &&
    Number.isFinite(v.interval)
  );
}

function isTwitchTokenErrorResponse(
  value: unknown,
): value is TwitchTokenErrorResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    (v.error === undefined || typeof v.error === "string") &&
    (v.message === undefined || typeof v.message === "string") &&
    (v.status === undefined || typeof v.status === "number")
  );
}
