// 032c-d コミット1: allow-list 二層強制の①「env ピン留め」（YouTube OAuth）。
// osareview の EnvYouTubeOAuthConfigProvider（process.env で endpoint/Client ID/Secret を override 可能）を
// 使わず、Google の OAuth endpoint/scope を **定数**に固定した Provider に置き換える（override 分岐を削除）。
// これにより Rust から env で宛先を差し替える経路を無くす（docs/security.md の allow-list 限定）。
//
// YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET は Google「Desktop app」種別 OAuth クライアントの識別子。
// Desktop app の secret は Google 上「機密扱いされない」（インストール型は抽出前提）が、抽出されても
// **PKCE(S256)＋インストール型モデル**で被害限定される（認可コード横取り防止・ユーザー個別同意）。
// esbuild の define で **ビルド時に** `__YOUTUBE_CLIENT_ID__` / `__YOUTUBE_CLIENT_SECRET__` へ焼き込む
// （`YOUTUBE_CLIENT_ID=xxxx YOUTUBE_CLIENT_SECRET=yyyy pnpm ... build:sea`）。ランタイム env / dotenv は使わない
// （未設定ならログイン時に「未設定」エラーになる）。token / code_verifier / client_secret はログにも WS にも載せない（§9）。
import type {
  YouTubeOAuthConfig,
  YouTubeOAuthConfigProvider,
} from "../vendor/auth/src/infrastructure/youtube/config/oauth-config.js";
import type { YouTubeConfigProvider } from "../vendor/comment-fetcher/src/infrastructure/youtube/config/api-config.js";

declare const __YOUTUBE_CLIENT_ID__: string | undefined;
declare const __YOUTUBE_CLIENT_SECRET__: string | undefined;

/** ビルド時に焼き込まれる YouTube（Google Desktop app）OAuth Client ID（未設定なら空文字）。 */
export const YOUTUBE_CLIENT_ID: string =
  typeof __YOUTUBE_CLIENT_ID__ === "string" ? __YOUTUBE_CLIENT_ID__ : "";

/** ビルド時に焼き込まれる YouTube（Google Desktop app）OAuth Client Secret（未設定なら空文字）。 */
export const YOUTUBE_CLIENT_SECRET: string =
  typeof __YOUTUBE_CLIENT_SECRET__ === "string" ? __YOUTUBE_CLIENT_SECRET__ : "";

// allow-list の宛先（定数・env override 不可）。認可はブラウザ側 accounts.google.com（Rust opener が開く）、
// token 交換は sidecar の fetch で oauth2.googleapis.com（host-guard の allow-list に追加）。
export const YOUTUBE_AUTHORIZATION_ENDPOINT =
  "https://accounts.google.com/o/oauth2/v2/auth";
export const YOUTUBE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
export const YOUTUBE_SCOPES: readonly string[] = [
  "https://www.googleapis.com/auth/youtube.readonly",
];

/** YouTube OAuth の endpoint/scope/ClientID/Secret を定数で返す（env 参照なし）。 */
export class PinnedYouTubeOAuthConfigProvider
  implements YouTubeOAuthConfigProvider
{
  getOAuthConfig(): YouTubeOAuthConfig {
    return {
      clientId: YOUTUBE_CLIENT_ID,
      clientSecret: YOUTUBE_CLIENT_SECRET,
      authorizationEndpoint: YOUTUBE_AUTHORIZATION_ENDPOINT,
      tokenEndpoint: YOUTUBE_TOKEN_ENDPOINT,
      scopes: YOUTUBE_SCOPES,
    };
  }
}

// 032c-d コミット2: YouTube Data API v3 の base URL（定数・env override 不可＝§1 層(a)）。
// REST 検出（search/videos/channels）と gRPC streamList の target（www.googleapis.com:443）はここから導出する。
export const YOUTUBE_DATA_API_BASE_URL = "https://www.googleapis.com/youtube/v3";

/** Data API base URL を定数で返す（env 参照なし）。gRPC target host のピン留めにもなる。 */
export class PinnedYouTubeConfigProvider implements YouTubeConfigProvider {
  getDataApiBaseUrl(): string {
    return YOUTUBE_DATA_API_BASE_URL;
  }
}
