export type StartOAuthCallbackSessionInput = {
  expectedState: string;
  timeoutMs: number;
};

export interface OAuthCallbackSession {
  readonly redirectUri: string;
  waitForAuthorizationCode(): Promise<string>;
  close(): Promise<void>;
}

export interface OAuthCallbackReceiver {
  start(input: StartOAuthCallbackSessionInput): Promise<OAuthCallbackSession>;
}
