import { inject, injectable } from "tsyringe";
import { NotAuthorizedError, type AuthClient } from "@comment-dock/auth";
import type {
  AccessTokenProvider,
  AuthorizedHttpClient,
  AuthorizedHttpRequest,
  AuthorizedTokenAccessorProvider,
} from "../../../infrastructure/shared/auth/access-token-provider.js";
import { SHARED_AUTH_DI_TOKENS } from "../../../infrastructure/shared/auth/di-tokens.js";

@injectable()
export class YouTubeAccessTokenProvider
  implements
    AccessTokenProvider,
    AuthorizedHttpClient,
    AuthorizedTokenAccessorProvider
{
  constructor(
    @inject(SHARED_AUTH_DI_TOKENS.authClient)
    private readonly authClient: AuthClient,
  ) {}

  async getAccessToken(): Promise<string> {
    try {
      return await this.authClient.getValidAccessToken("youtube");
    } catch (error) {
      if (error instanceof NotAuthorizedError) {
        console.warn(
          "[comment-fetcher] YouTube にログインしていません。先にアカウント連携を行ってください。",
        );
        return "";
      }
      throw error;
    }
  }

  request<T>(request: AuthorizedHttpRequest<T>): Promise<T> {
    return this.authClient.withAuthorizedRequest("youtube", request);
  }

  createAuthorizedTokenAccessor() {
    return this.authClient.createAuthorizedTokenAccessor("youtube");
  }
}
