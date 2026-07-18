// 032c-b(stream-dock): OAuth トークンは §9 準拠で in-memory のみ保持する（keyring 永続化しない）。
// osareview の KeyringTokenStoreRepository（@napi-rs/keyring native addon）を差し替え、
// native addon を sidecar に同梱しないための実装。プロセス終了で失われる（永続化しない）。
import type { Provider } from "../../vendor/auth/src/provider.js";
import type { TokenSet } from "../../vendor/auth/src/entities/token/token-set.js";
import type { TokenStore } from "../../vendor/auth/src/usecases/interfaces/token-store.interface.js";

export class InMemoryTokenStore implements TokenStore {
  private readonly store = new Map<Provider, TokenSet>();

  async get(provider: Provider): Promise<TokenSet | null> {
    return this.store.get(provider) ?? null;
  }

  async save(provider: Provider, tokenSet: TokenSet): Promise<void> {
    this.store.set(provider, tokenSet);
  }

  async clear(provider: Provider): Promise<void> {
    this.store.delete(provider);
  }
}
