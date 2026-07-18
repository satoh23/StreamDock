import "reflect-metadata";
import { inject, injectable } from "tsyringe";
import type { LoginPolicy } from "../../../usecases/interfaces/login-policy.interface.js";
import type { YouTubeOAuthConfigProvider } from "../../../infrastructure/youtube/config/oauth-config.js";
import { AUTH_DI_TOKENS } from "../../../shared/di-tokens.js";

const DEFAULT_CALLBACK_TIMEOUT_MS = 180_000;

@injectable()
export class YouTubeLoginPolicy implements LoginPolicy {
  constructor(
    @inject(AUTH_DI_TOKENS.oauthConfigProvider)
    private readonly configProvider: YouTubeOAuthConfigProvider,
    private readonly callbackTimeoutMs: number = DEFAULT_CALLBACK_TIMEOUT_MS,
  ) {}

  getScopes(): readonly string[] {
    return this.configProvider.getOAuthConfig().scopes;
  }

  getCallbackTimeoutMs(): number {
    return this.callbackTimeoutMs;
  }
}
