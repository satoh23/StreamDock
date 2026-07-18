export type HttpClient = typeof fetch;

export const SHARED_DI_TOKENS = {
  httpClient: "HttpClient",
} as const;
