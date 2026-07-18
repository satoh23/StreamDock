import "reflect-metadata";
import { inject, injectable } from "tsyringe";
import type { TokenSet } from "../../../entities/token/token-set.js";
import { AUTH_DI_TOKENS } from "../../../shared/di-tokens.js";
import type {
  BrowserLauncher,
  DeviceCodeOAuthClient,
  LoginPolicy,
  LoginStrategy,
} from "../../../usecases/interfaces/index.js";

@injectable()
export class DeviceCodeLoginStrategy implements LoginStrategy {
  constructor(
    @inject(AUTH_DI_TOKENS.oauthClient)
    private readonly deviceCodeOAuthClient: DeviceCodeOAuthClient,
    @inject(AUTH_DI_TOKENS.browserLauncher)
    private readonly browserLauncher: BrowserLauncher,
    @inject(AUTH_DI_TOKENS.loginPolicy)
    private readonly loginPolicy: LoginPolicy,
  ) {}

  async login(): Promise<TokenSet> {
    const authorization =
      await this.deviceCodeOAuthClient.requestDeviceAuthorization(
        this.loginPolicy.getScopes(),
      );

    // NOTE: ライブラリ層では表示責務を持たない。必要な案内表示は呼び出し側（CLI/UI）で行う。
    await this.browserLauncher.open(authorization.verificationUri);

    return await this.deviceCodeOAuthClient.pollingForToken({
      deviceCode: authorization.deviceCode,
      intervalSeconds: authorization.intervalSeconds,
      expiresAtMs: authorization.expiresAtMs,
    });
  }
}
