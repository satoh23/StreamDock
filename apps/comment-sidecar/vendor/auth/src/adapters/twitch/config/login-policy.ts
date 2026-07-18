import "reflect-metadata";
import { inject, injectable } from "tsyringe";
import type { LoginPolicy } from "../../../usecases/interfaces/login-policy.interface.js";
import type { TwitchOAuthConfigProvider } from "../../../infrastructure/twitch/config/oauth-config.js";
import { AUTH_DI_TOKENS } from "../../../shared/di-tokens.js";

const DEFAULT_DEVICE_FLOW_TIMEOUT_MS = 1_800_000;

@injectable()
export class TwitchLoginPolicy implements LoginPolicy {
  constructor(
    @inject(AUTH_DI_TOKENS.oauthConfigProvider)
    private readonly configProvider: TwitchOAuthConfigProvider,
    private readonly deviceFlowTimeoutMs: number = DEFAULT_DEVICE_FLOW_TIMEOUT_MS,
  ) {}

  getScopes(): readonly string[] {
    return this.configProvider.getOAuthConfig().scopes;
  }

  getCallbackTimeoutMs(): number {
    return this.deviceFlowTimeoutMs;
  }
}
