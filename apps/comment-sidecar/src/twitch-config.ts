// 032c-b コミット2: allow-list 二層強制の①「env ピン留め」。
// osareview の Env*ConfigProvider（process.env で base URL を override 可能）を使わず、Twitch の base URL を
// **定数**に固定した Provider に置き換える（override 分岐を削除）。これにより Rust から env で宛先を差し替える
// 経路を無くす（docs/security.md の allow-list 限定）。
//
// TWITCH_CLIENT_ID は Device Code（public client・secret 無し）に必要な**公開**アプリ識別子。秘密情報ではない。
// esbuild の define で **ビルド時に** `__TWITCH_CLIENT_ID__` へ焼き込む（`TWITCH_CLIENT_ID=xxxx pnpm ... build:sea`）。
// ランタイム env / dotenv は使わない（未設定ならログイン時に「未設定」エラーになる）。
import type {
  TwitchConfigProvider,
} from "../vendor/comment-fetcher/src/infrastructure/twitch/config/api-config.js";
import type {
  TwitchOAuthConfig,
  TwitchOAuthConfigProvider,
} from "../vendor/auth/src/infrastructure/twitch/config/oauth-config.js";

declare const __TWITCH_CLIENT_ID__: string | undefined;

/** ビルド時に焼き込まれる Twitch アプリ Client ID（未設定なら空文字）。 */
export const TWITCH_CLIENT_ID: string =
  typeof __TWITCH_CLIENT_ID__ === "string" ? __TWITCH_CLIENT_ID__ : "";

// allow-list の宛先（定数・env override 不可）。
export const TWITCH_HELIX_API_BASE_URL = "https://api.twitch.tv/helix";
export const TWITCH_EVENTSUB_WS_URL = "wss://eventsub.wss.twitch.tv/ws";
export const TWITCH_DEVICE_AUTHORIZATION_ENDPOINT =
  "https://id.twitch.tv/oauth2/device";
export const TWITCH_TOKEN_ENDPOINT = "https://id.twitch.tv/oauth2/token";
// 043a(拡張): Bits Power-ups（channel.bits.use）取得のため bits:read を追加。既存宛先内の購読追加で
// 新規 egress 先は増えないが、OAuth スコープ拡大＝既存ユーザーは再ログインするまで Power-ups は届かない
// （bits.use 購読は sidecar 側で非致命化し、本線配信は継続）。docs/security.md 方針①/⑦ 参照。
// 066: **チャットへの書き込み**（Helix `POST /chat/messages`）のため `user:write:chat` を追加。
// ⚠⚠⚠ **StreamDock 初の「書き込み」スコープである**（それまでは読むだけだった）。
// ⚠ **新規 egress 先はゼロ**（`api.twitch.tv` は既に allow-list）。増えるのは**能力**だけ。
// ⚠⚠ **既存ユーザーは再ログインするまで送信できない**（旧トークンにこのスコープが無く 401/403 になる）。
// 043a の `bits:read` と同じく **sidecar 側で非致命化**し、本線（コメント取得）は止めない。
// ⚠⚠⚠ **YouTube 側は 1 文字も変えていない**（`youtube.force-ssl` は同意画面が「管理」相当になり、
// かつ書き込みは 1 回 50 units・既定 10,000 units/日で**取得と枠を共用**するため。依頼者の決定・2026-08-22）。
// docs/security.md §1 の追補（066）を参照。
// 063e: **チャンネルポイント報酬の引き換え**（EventSub `channel.channel_points_custom_reward_redemption.add`）
// のため `channel:read:redemptions` を追加。
// ⚠ **新規 egress 先はゼロ**（`api.twitch.tv` / `eventsub.wss.twitch.tv` は既に allow-list）。増えるのは**能力**だけ。
// ⚠⚠ **既存ユーザーは再ログインするまで引き換えが届かない**（旧トークンにこのスコープが無く購読作成が 403 になる）。
//   043a の `bits:read` / 066 の `user:write:chat` と同じく **sidecar 側で非致命化**し、本線（コメント取得）は止めない。
// ⚠⚠⚠ **読み取り専用である。`channel:manage:redemptions`（報酬の作成・消化・返却）は取らない。**
//   ＝ StreamDock は引き換えを消化済みにすることも返却することもできない（できないことを、できなくしておく）。
//   066 が Twitch 初の「書き込み」を 1 本入れたばかりなので、2 本目をガチャのついでに増やさない。
// ⚠ **YouTube 側は 1 文字も変えていない**（チャンネルポイントに相当する機能が存在しないため）。
// docs/security.md §1 の追補（063e）を参照。
export const TWITCH_SCOPES: readonly string[] = [
  "user:read:chat",
  "bits:read",
  "user:write:chat",
  "channel:read:redemptions",
];

/** Helix/EventSub の base URL を定数で返す（env 参照なし）。 */
export class PinnedTwitchConfigProvider implements TwitchConfigProvider {
  getHelixApiBaseUrl(): string {
    return TWITCH_HELIX_API_BASE_URL;
  }
  getEventSubWebSocketUrl(): string {
    return TWITCH_EVENTSUB_WS_URL;
  }
  getClientId(): string {
    return TWITCH_CLIENT_ID;
  }
}

/** Device Code OAuth の endpoint/scope を定数で返す（env 参照なし）。 */
export class PinnedTwitchOAuthConfigProvider
  implements TwitchOAuthConfigProvider
{
  getOAuthConfig(): TwitchOAuthConfig {
    return {
      clientId: TWITCH_CLIENT_ID,
      deviceAuthorizationEndpoint: TWITCH_DEVICE_AUTHORIZATION_ENDPOINT,
      tokenEndpoint: TWITCH_TOKEN_ENDPOINT,
      scopes: TWITCH_SCOPES,
    };
  }
}
