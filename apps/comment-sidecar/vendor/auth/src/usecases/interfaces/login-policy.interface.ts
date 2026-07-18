export interface LoginPolicy {
  getScopes(): readonly string[];
  getCallbackTimeoutMs(): number;
}
