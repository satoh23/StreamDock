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
import { UnauthorizedRequestError } from "../errors/unauthorized-request.error.js";

/**
 * 認証付き処理本体の契約。
 * 処理本体を関数として受け取ることで、トークン取得・refresh・retry の制御と外部 API 呼び出しを分離し、テストしやすくする。
 */
export type AuthorizedRequestFn<T> = (accessToken: string) => Promise<T>;

@injectable()
export class WithAuthorizedRequestUsecase {
  /**
   * provider ごとに実行中の refresh Promise を保持し、同じ provider の refresh 多重実行を防ぐ。
   */
  private readonly refreshInFlightByProvider = new Map<
    Provider,
    Promise<string>
  >();

  constructor(
    // 依存を DI で注入し、TokenStore / refresh / notifier / 時刻を単体テストで差し替えられるようにする。
    @inject(AUTH_DI_TOKENS.tokenStore) private readonly tokenStore: TokenStore,
    @inject(AUTH_DI_TOKENS.refreshAccessTokenUsecase)
    private readonly refreshUsecase: RefreshAccessTokenPort,
    @inject(AUTH_DI_TOKENS.authorizationLostNotifier)
    private readonly notifier: AuthorizationLostNotifier,
    @inject(AUTH_DI_TOKENS.nowFn) private readonly nowFn: () => number,
  ) {}

  async execute<T>(
    provider: Provider,
    requestFn: AuthorizedRequestFn<T>,
  ): Promise<T> {
    const tokenSet = await this.tokenStore.get(provider);
    if (tokenSet === null) {
      throw new NotAuthorizedError(AUTH_NOT_AUTHORIZED_REASON);
    }

    try {
      return await requestFn(tokenSet.accessToken);
    } catch (err) {
      if (!(err instanceof UnauthorizedRequestError)) {
        throw err;
      }
    }

    const refreshedAccessToken = await this.refreshOnce(provider);
    return requestFn(refreshedAccessToken);
  }

  private refreshOnce(provider: Provider): Promise<string> {
    const inFlight = this.refreshInFlightByProvider.get(provider);
    if (inFlight !== undefined) {
      return inFlight;
    }

    const refreshPromise = this.refreshUsecase
      .refresh(provider)
      .catch(async (err: unknown) => {
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
      })
      .finally(() => {
        this.refreshInFlightByProvider.delete(provider);
      });

    this.refreshInFlightByProvider.set(provider, refreshPromise);
    return refreshPromise;
  }
}
