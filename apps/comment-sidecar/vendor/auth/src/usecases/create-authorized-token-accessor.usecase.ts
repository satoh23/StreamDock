import "reflect-metadata";
import { inject, injectable } from "tsyringe";
import type { Provider } from "../provider.js";
import type { RefreshAccessTokenPort, TokenStore } from "./interfaces/index.js";
import { AUTH_DI_TOKENS } from "../shared/di-tokens.js";
import { AuthorizationLostNotifier } from "../shared/authorization-lost-notifier.js";
import {
  AUTH_NOT_AUTHORIZED_REASON,
  AUTHORIZATION_LOST_REASON,
} from "../shared/authorization-reasons.js";
import { NotAuthorizedError } from "./get-valid-access-token.usecase.js";

export type AuthorizedTokenAccessor = {
  getCurrentAccessToken(): Promise<string>;
  refresh(): Promise<string>;
};

@injectable()
export class CreateAuthorizedTokenAccessorUsecase {
  constructor(
    // TokenStore / refresh / notifier / 時刻を DI で注入し、長期接続の認証回復だけを単体で検証しやすくする。
    @inject(AUTH_DI_TOKENS.tokenStore) private readonly tokenStore: TokenStore,
    @inject(AUTH_DI_TOKENS.refreshAccessTokenUsecase)
    private readonly refreshUsecase: RefreshAccessTokenPort,
    @inject(AUTH_DI_TOKENS.authorizationLostNotifier)
    private readonly notifier: AuthorizationLostNotifier,
    @inject(AUTH_DI_TOKENS.nowFn) private readonly nowFn: () => number,
  ) {}

  /**
   * gRPC / WebSocket などの長期接続が必要なタイミングで token 操作できる accessor を作る。
   * provider をこの場で閉じ込めることで、呼び出し側は接続中に provider を渡し直さずに使える。
   */
  createAuthorizedTokenAccessor(provider: Provider): AuthorizedTokenAccessor {
    return {
      getCurrentAccessToken: () => this.getCurrentAccessToken(provider),
      refresh: () => this.refresh(provider),
    };
  }

  /**
   * 保存済み token から現在の access token を返す。
   * 接続開始時に使う想定で、ここでは期限確認や refresh は行わない。
   */
  private async getCurrentAccessToken(provider: Provider): Promise<string> {
    const tokenSet = await this.tokenStore.get(provider);
    if (tokenSet === null) {
      throw new NotAuthorizedError(AUTH_NOT_AUTHORIZED_REASON);
    }

    return tokenSet.accessToken;
  }

  /**
   * 長期接続側で認可エラーを検知した後に、明示的に access token を更新する。
   * refresh に失敗した場合は保存済み token を消し、認可喪失イベントを通知して NotAuthorizedError を投げる。
   */
  private async refresh(provider: Provider): Promise<string> {
    try {
      return await this.refreshUsecase.refresh(provider);
    } catch (err) {
      await this.tokenStore.clear(provider);
      this.notifier.emit({
        provider,
        reason: AUTHORIZATION_LOST_REASON,
        occurredAt: this.nowFn(),
        cause: err,
      });

      if (err instanceof NotAuthorizedError) {
        throw err;
      }
      throw new NotAuthorizedError(AUTHORIZATION_LOST_REASON, {
        cause: err,
      });
    }
  }
}
