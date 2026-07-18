// 032c-b(stream-dock): ログイン永続化のための TokenStore デコレータ。
//
// InMemoryTokenStore（メモリのみ）をラップし、save/clear のたびに `onPersist` で「Rust 側へ永続化して
// ほしい」通知を出す。Rust はこの通知（stdout の専用行）を受けて OS キーチェーンへ保存する
//（sidecar は単一ファイル SEA で native keyring addon を持ち込めないため、keychain 所有は Rust 側）。
//
// - `save`：login 成功 / refresh（Twitch は refresh_token をローテートするため毎回）/ 取得時の期限切れ
//   refresh を 1 箇所で捕捉し、最新の TokenSetPlain(JSON) を通知する。
// - `clear`：logout / 認可失効を通知する（Rust は keychain から削除）。
// - `restore`：起動時に keychain から読んだトークンをメモリへ載せる専用経路。**通知しない**
//   （Rust へ即座に echo で書き戻さないため）。
//
// token は viewer への WS には一切流さない。stdout の専用行（親子 private pipe）のみを通り、
// Rust が消費してログには出さない（§9）。
import type { Provider } from "../../vendor/auth/src/provider.js";
import type { TokenSet, TokenSetPlain } from "../../vendor/auth/src/entities/token/token-set.js";
import type { TokenStore } from "../../vendor/auth/src/usecases/interfaces/token-store.interface.js";

/** twitch の token が save/clear されたことを外へ通知する（save=plain / clear=null）。 */
export type TokenPersistListener = (twitch: TokenSetPlain | null) => void;

export class PersistingTokenStore implements TokenStore {
  constructor(
    private readonly inner: TokenStore,
    private readonly onPersist?: TokenPersistListener,
  ) {}

  async get(provider: Provider): Promise<TokenSet | null> {
    return this.inner.get(provider);
  }

  async save(provider: Provider, tokenSet: TokenSet): Promise<void> {
    await this.inner.save(provider, tokenSet);
    if (provider === "twitch") this.onPersist?.(tokenSet.toPlain());
  }

  async clear(provider: Provider): Promise<void> {
    await this.inner.clear(provider);
    if (provider === "twitch") this.onPersist?.(null);
  }

  /** 起動時の keychain 復元用（メモリへ載せるだけで onPersist は呼ばない＝Rust へ書き戻さない）。 */
  async restore(provider: Provider, tokenSet: TokenSet): Promise<void> {
    await this.inner.save(provider, tokenSet);
  }
}
