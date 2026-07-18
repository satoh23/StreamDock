import type { TokenSet } from "../../entities/token/token-set.js";
import type {
  OAuthTokenRefresher,
  RefreshAccessTokenInput,
} from "./oauth-token-refresher.interface.js";

export type DeviceAuthorization = {
  readonly deviceCode: string;
  readonly userCode: string;
  readonly verificationUri: URL;
  readonly intervalSeconds: number;
  readonly expiresAtMs: number;
};

export type PollingForTokenInput = {
  readonly deviceCode: string;
  readonly intervalSeconds: number;
  readonly expiresAtMs: number;
  readonly signal?: AbortSignal;
};

/**
 * Device Code Grant Flow 向け OAuth クライアント契約。
 */
export interface DeviceCodeOAuthClient extends OAuthTokenRefresher {
  requestDeviceAuthorization(
    scopes: readonly string[],
  ): Promise<DeviceAuthorization>;
  pollingForToken(input: PollingForTokenInput): Promise<TokenSet>;

  // 明示的に再定義して契約を読みやすくする（OAuthTokenRefresher 由来）。
  refresh(input: RefreshAccessTokenInput): Promise<TokenSet>;
}
