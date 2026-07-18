import "reflect-metadata";
import { inject, injectable } from "tsyringe";
import type { TokenSet } from "../../../entities/token/token-set.js";
import { AUTH_DI_TOKENS } from "../../../shared/di-tokens.js";
import type {
  BrowserLauncher,
  LoginPolicy,
  LoginStrategy,
  OAuthCallbackReceiver,
  OAuthClient,
  PkceGenerator,
  StateGenerator,
} from "../../../usecases/interfaces/index.js";

@injectable()
export class AuthorizationCodeLoopbackLoginStrategy implements LoginStrategy {
  constructor(
    @inject(AUTH_DI_TOKENS.oauthClient)
    private readonly oauthClient: OAuthClient,
    @inject(AUTH_DI_TOKENS.browserLauncher)
    private readonly browserLauncher: BrowserLauncher,
    @inject(AUTH_DI_TOKENS.callbackReceiver)
    private readonly callbackReceiver: OAuthCallbackReceiver,
    @inject(AUTH_DI_TOKENS.pkceGenerator)
    private readonly pkceGenerator: PkceGenerator,
    @inject(AUTH_DI_TOKENS.stateGenerator)
    private readonly stateGenerator: StateGenerator,
    @inject(AUTH_DI_TOKENS.loginPolicy)
    private readonly loginPolicy: LoginPolicy,
  ) {}

  async login(): Promise<TokenSet> {
    const pkce = this.pkceGenerator.generate();
    const state = this.stateGenerator.generate();
    const callback = await this.callbackReceiver.start({
      expectedState: state,
      timeoutMs: this.loginPolicy.getCallbackTimeoutMs(),
    });

    try {
      const authorizationUrl = this.oauthClient.authorize({
        redirectUri: callback.redirectUri,
        state,
        codeVerifier: pkce.codeVerifier,
        codeChallenge: pkce.codeChallenge,
        scopes: this.loginPolicy.getScopes(),
      });
      // NOTE: ユーザー同意フローをブラウザで開始し、loopback callback で認可コードを受け取る。
      await this.browserLauncher.open(authorizationUrl);
      const code = await callback.waitForAuthorizationCode();
      return await this.oauthClient.exchange({
        code,
        codeVerifier: pkce.codeVerifier,
        redirectUri: callback.redirectUri,
      });
    } finally {
      await callback.close();
    }
  }
}
