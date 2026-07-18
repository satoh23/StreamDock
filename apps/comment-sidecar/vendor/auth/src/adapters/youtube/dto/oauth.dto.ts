export type YouTubeTokenSuccessResponse = {
  readonly access_token: string;
  readonly token_type: string;
  readonly expires_in: number;
  readonly scope: string;
  readonly refresh_token?: string;
};

export type YouTubeTokenErrorResponse = {
  readonly error?: string;
  readonly error_description?: string;
};
