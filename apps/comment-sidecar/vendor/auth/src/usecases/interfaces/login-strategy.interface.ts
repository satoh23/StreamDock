import type { TokenSet } from "../../entities/token/token-set.js";

/**
 * Provider ごとのログイン手順を表す契約。
 * 例: YouTube は Authorization Code + loopback、Twitch は Device Code + polling。
 */
export interface LoginStrategy {
  login(): Promise<TokenSet>;
}
