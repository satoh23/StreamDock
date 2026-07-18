import { readPort } from "../../shared/config/port.js";

export type WebSocketApiEndpoint = {
  host: string;
  port: number;
};

const DEFAULT_WS_HOST = "127.0.0.1";
const DEFAULT_WS_PORT = 17331;

// 032c-b(stream-dock): これは osareview 原本の env 可変版で、`API_GATEWAY_WS_HOST` で bind 先を
// 上書きできる（例: 0.0.0.0 にすると LAN 公開になり得る）。
//  - なぜ現状で問題ないか: stream-dock の sidecar entry（src/index.ts）は host を "127.0.0.1" 固定で
//    `startWithFallback(WS_HOST, ...)` を呼ぶ経路のみを使い、この `getWebSocketApiEndpoint`（＝下の
//    `start()` の既定引数）は**呼ばれない dead path**。よって env で bind 先が動くことはない。
//  - どうなったら直すべきか: env 由来の可変性を完全に消したいなら、この関数と `start()` の env 経路を
//    削除して 127.0.0.1 固定にする（distill を最終化するタイミングでの削除候補）。
export const getWebSocketApiEndpoint = (): WebSocketApiEndpoint => ({
  host: process.env.API_GATEWAY_WS_HOST ?? DEFAULT_WS_HOST,
  port: readPort("API_GATEWAY_WS_PORT", DEFAULT_WS_PORT),
});
