import type { Provider } from "../../provider.js";
import type { TokenSet } from "../../entities/token/token-set.js";

/**
 * プロバイダ別に `TokenSet` を永続化する契約（keychain 等の実装が満たす）。
 */
export interface TokenStore {
  /** 保存がなければ `null`。 */
  get(provider: Provider): Promise<TokenSet | null>;

  save(provider: Provider, tokenSet: TokenSet): Promise<void>;

  clear(provider: Provider): Promise<void>;
}
