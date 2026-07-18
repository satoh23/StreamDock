import "reflect-metadata";
import { injectable } from "tsyringe";

const DEFAULT_AUTHORIZATION_ENDPOINT =
  "https://accounts.google.com/o/oauth2/v2/auth";
const DEFAULT_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

const DEFAULT_SCOPES = [
  "https://www.googleapis.com/auth/youtube.readonly",
] as const;

const ENV_CLIENT_ID = "YOUTUBE_OAUTH_CLIENT_ID";
const ENV_CLIENT_SECRET = "YOUTUBE_OAUTH_CLIENT_SECRET";
const ENV_AUTHORIZATION_ENDPOINT = "YOUTUBE_OAUTH_AUTHORIZATION_ENDPOINT";
const ENV_TOKEN_ENDPOINT = "YOUTUBE_OAUTH_TOKEN_ENDPOINT";
const ENV_SCOPES = "YOUTUBE_OAUTH_SCOPES";

export interface YouTubeOAuthConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly scopes: readonly string[];
}

export interface YouTubeOAuthConfigProvider {
  getOAuthConfig(): YouTubeOAuthConfig;
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

// 032c-d(stream-dock): これは osareview 原本の env 可変版（endpoint/scope/Client ID/Secret を
// process.env で override 可能）。stream-dock では **未配線・到達不能**で、代わりに定数固定＋ビルド時
// 焼き込みの `PinnedYouTubeOAuthConfigProvider`（src/youtube-config.ts）を auth fork（src/auth/index.ts）で
// 直接 new して使う（§1 の env ピン留め＝宛先 override 経路を持ち込まない）。parity 維持のため残置・
// 二層ガードで安全・distill 最終化時の削除候補。型（YouTubeOAuthConfig / YouTubeOAuthConfigProvider）は
// vendored youtube アダプタが参照するためこのファイルに置く。
@injectable()
export class EnvYouTubeOAuthConfigProvider implements YouTubeOAuthConfigProvider {
  getOAuthConfig(): YouTubeOAuthConfig {
    const clientId = process.env[ENV_CLIENT_ID]?.trim() ?? "";
    if (clientId === "") {
      throw new Error(
        `${ENV_CLIENT_ID} is required (set it in your environment or .env)`,
      );
    }
    const clientSecret = process.env[ENV_CLIENT_SECRET]?.trim() ?? "";
    if (clientSecret === "") {
      throw new Error(
        `${ENV_CLIENT_SECRET} is required (set it in your environment or .env)`,
      );
    }
    const authorizationEndpoint =
      process.env[ENV_AUTHORIZATION_ENDPOINT]?.trim() ||
      DEFAULT_AUTHORIZATION_ENDPOINT;
    const tokenEndpoint =
      process.env[ENV_TOKEN_ENDPOINT]?.trim() || DEFAULT_TOKEN_ENDPOINT;
    return {
      clientId,
      clientSecret,
      authorizationEndpoint,
      tokenEndpoint,
      scopes: parseScopes(process.env[ENV_SCOPES]),
    };
  }
}
