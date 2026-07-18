export type TwitchDeviceAuthorizationSuccessResponse = {
  readonly device_code: string;
  readonly user_code: string;
  readonly verification_uri: string;
  readonly expires_in: number;
  readonly interval: number;
};

export type TwitchTokenSuccessResponse = {
  readonly access_token: string;
  readonly refresh_token?: string;
  readonly expires_in: number;
  readonly scope: readonly string[] | string;
  readonly token_type: string;
};

export type TwitchTokenErrorResponse = {
  readonly error?: string;
  readonly status?: number;
  readonly message?: string;
};
