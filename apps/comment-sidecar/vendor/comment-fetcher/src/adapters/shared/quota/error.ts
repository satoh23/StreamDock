// 032c-d(stream-dock): YouTube API のクォータ枯渇を分類し、**graceful stop**（再接続 hot-loop しない）ための
// エラー型とクラシファイア。osareview には無い stream-dock 追加（osareview は quota を区別せず 1 秒間隔で
// 無限に再接続する欠陥がある＝クォータをさらに消費する）。無料枠 10,000 units/日・枯渇時は取得停止＋viewer 通知。
//
// - gRPC streamList: RESOURCE_EXHAUSTED（code 8）。
// - REST（検出 search/videos/channels）: HTTP 403 で body が quota 系理由（quotaExceeded 等）。

/** gRPC status code RESOURCE_EXHAUSTED。 */
const GRPC_RESOURCE_EXHAUSTED_CODE = 8;

/** クォータ枯渇を表すドメインエラー（viewer に安全な定型文言で通知する）。 */
export class QuotaExceededError extends Error {
  constructor(
    message = "YouTube API のクォータを使い切りました。時間をおいて再試行してください。",
  ) {
    super(message);
    this.name = "QuotaExceededError";
  }
}

export const isQuotaExceededError = (
  error: unknown,
): error is QuotaExceededError => error instanceof QuotaExceededError;

/** gRPC の RESOURCE_EXHAUSTED（code 8 もしくは message に RESOURCE_EXHAUSTED を含む）か。 */
export const isGrpcResourceExhaustedError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }
  const code = (error as { code?: unknown }).code;
  return (
    code === GRPC_RESOURCE_EXHAUSTED_CODE ||
    /RESOURCE_EXHAUSTED/i.test(error.message)
  );
};

/** REST の 403 応答本文がクォータ系理由（quotaExceeded / dailyLimitExceeded / rateLimitExceeded）か。 */
export const isRestQuotaExceededResponse = (
  status: number,
  body: string,
): boolean =>
  status === 403 &&
  /quotaExceeded|dailyLimitExceeded|rateLimitExceeded/i.test(body);
