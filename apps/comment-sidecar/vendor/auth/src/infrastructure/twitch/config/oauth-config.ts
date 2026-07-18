import "reflect-metadata";
import { injectable } from "tsyringe";

const DEFAULT_DEVICE_AUTHORIZATION_ENDPOINT =
  "https://id.twitch.tv/oauth2/device";
const DEFAULT_TOKEN_ENDPOINT = "https://id.twitch.tv/oauth2/token";
const DEFAULT_SCOPES = ["user:read:chat"] as const;

const ENV_CLIENT_ID = "TWITCH_CLIENT_ID";
const ENV_DEVICE_AUTHORIZATION_ENDPOINT =
  "TWITCH_OAUTH_DEVICE_AUTHORIZATION_ENDPOINT";
const ENV_TOKEN_ENDPOINT = "TWITCH_OAUTH_TOKEN_ENDPOINT";
const ENV_SCOPES = "TWITCH_OAUTH_SCOPES";

export interface TwitchOAuthConfig {
  readonly clientId: string;
  readonly deviceAuthorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly scopes: readonly string[];
}

export interface TwitchOAuthConfigProvider {
  getOAuthConfig(): TwitchOAuthConfig;
}

function parseScopes(raw: string | undefined): readonly string[] {
  if (raw === undefined || raw.trim() === "") {
    return DEFAULT_SCOPES;
  }

  const parts = raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (parts.length === 0) {
    return DEFAULT_SCOPES;
  }

  return parts;
}

// 032c-b(stream-dock): これは osareview 原本の env 可変版（endpoint/scope を process.env で
// override 可能）。stream-dock では **未配線・到達不能**で、代わりに定数固定の
// `PinnedTwitchOAuthConfigProvider`（src/twitch-config.ts）を auth fork（src/auth/index.ts）で
// 直接 new して使う。理由・現状で問題ない根拠・削除条件は comment-fetcher 側の
// `EnvTwitchConfigProvider` のコメントと同じ（parity 維持のため残置・二層ガードで安全・
// distill 最終化時の削除候補）。
@injectable()
export class EnvTwitchOAuthConfigProvider implements TwitchOAuthConfigProvider {
  getOAuthConfig(): TwitchOAuthConfig {
    const clientId = process.env[ENV_CLIENT_ID]?.trim() ?? "";
    if (clientId === "") {
      throw new Error(
        `${ENV_CLIENT_ID} が未設定です。環境変数または .env に設定してください。`,
      );
    }

    const deviceAuthorizationEndpoint =
      process.env[ENV_DEVICE_AUTHORIZATION_ENDPOINT]?.trim() ||
      DEFAULT_DEVICE_AUTHORIZATION_ENDPOINT;
    const tokenEndpoint =
      process.env[ENV_TOKEN_ENDPOINT]?.trim() || DEFAULT_TOKEN_ENDPOINT;

    return {
      clientId,
      deviceAuthorizationEndpoint,
      tokenEndpoint,
      scopes: parseScopes(process.env[ENV_SCOPES]),
    };
  }
}
