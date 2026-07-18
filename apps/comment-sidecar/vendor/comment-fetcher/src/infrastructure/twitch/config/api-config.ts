import { injectable } from "tsyringe";

// Twitch Helix REST API の既定ベースURL。
const DEFAULT_TWITCH_HELIX_API_BASE_URL = "https://api.twitch.tv/helix";
// Twitch EventSub WebSocket の既定接続先URL。
const DEFAULT_TWITCH_EVENTSUB_WEBSOCKET_URL = "wss://eventsub.wss.twitch.tv/ws";

export interface TwitchConfigProvider {
  // Helix API 呼び出し時に使うベースURLを返す。
  getHelixApiBaseUrl(): string;
  // EventSub WebSocket 接続時に使うURLを返す。
  getEventSubWebSocketUrl(): string;
  // Helix リクエストヘッダで使う Client-Id を返す。
  getClientId(): string;
}

// 032c-b(stream-dock): これは osareview 原本の env 可変版 Provider（base URL / Client-Id を
// process.env で override 可能）。stream-dock では **DI に登録しておらず到達不能**で、代わりに
// 定数固定の `PinnedTwitchConfigProvider`（src/twitch-config.ts）を配線している（allow-list①）。
//  - なぜ残しているか: vendor（osareview コピー）の原本差分を最小化するため（型/実装の parity）。
//  - なぜ現状で問題ないか: 未配線で使われない上、万一使われても global fetch の fail-closed
//    host-guard（allow-list②）が evil.com 等を弾くため二層で守られる。
//  - どうなったら直すべきか: distill を最終化する際は、env override 経路自体を消すためこの
//    `EnvTwitchConfigProvider` を削除してよい（Pinned 版のみ残す）。
@injectable()
export class EnvTwitchConfigProvider implements TwitchConfigProvider {
  getHelixApiBaseUrl(): string {
    return (
      process.env.TWITCH_HELIX_API_BASE_URL ?? DEFAULT_TWITCH_HELIX_API_BASE_URL
    );
  }

  getEventSubWebSocketUrl(): string {
    return (
      process.env.TWITCH_EVENTSUB_WS_URL ??
      DEFAULT_TWITCH_EVENTSUB_WEBSOCKET_URL
    );
  }

  getClientId(): string {
    return process.env.TWITCH_CLIENT_ID ?? "";
  }
}
