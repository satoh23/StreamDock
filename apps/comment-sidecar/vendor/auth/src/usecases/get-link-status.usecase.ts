import "reflect-metadata";
import { inject, injectable } from "tsyringe";
import type { Provider } from "../provider.js";
import type { TokenStore } from "./interfaces/index.js";
import { AUTH_DI_TOKENS } from "../shared/di-tokens.js";

export type LinkStatus = {
  provider: Provider;
  state: "linked" | "unlinked";
  expiresAt?: number;
  scope?: string;
};

@injectable()
export class GetLinkStatusUsecase {
  constructor(
    // TokenStore は auth 内部に隠蔽し、単体テストでは DI で差し替える。
    @inject(AUTH_DI_TOKENS.tokenStore) private readonly tokenStore: TokenStore,
  ) {}

  async getLinkStatus(provider: Provider): Promise<LinkStatus> {
    const tokenSet = await this.tokenStore.get(provider);
    if (tokenSet === null) {
      return {
        provider,
        state: "unlinked",
      };
    }

    return {
      provider,
      state: "linked",
      expiresAt: tokenSet.expiresAt,
      scope: tokenSet.scope,
    };
  }
}
