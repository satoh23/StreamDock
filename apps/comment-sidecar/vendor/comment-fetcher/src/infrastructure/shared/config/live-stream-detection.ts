export const DEFAULT_LIVE_STREAM_POLLING_INTERVAL_MS = 5000;
export const DEFAULT_LIVE_STREAM_MAX_ATTEMPTS = 5;

const readPositiveIntegerEnv = (
  envName: string,
  defaultValue: number,
): number => {
  const rawValue = process.env[envName]?.trim();
  if (!rawValue) {
    return defaultValue;
  }

  const parsedValue = Number(rawValue);
  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    return defaultValue;
  }

  return parsedValue;
};

export const getLiveStreamPollingIntervalMs = (): number =>
  readPositiveIntegerEnv(
    "LIVE_STREAM_POLLING_INTERVAL_MS",
    DEFAULT_LIVE_STREAM_POLLING_INTERVAL_MS,
  );

export const getLiveStreamMaxAttempts = (): number =>
  readPositiveIntegerEnv(
    "LIVE_STREAM_MAX_ATTEMPTS",
    DEFAULT_LIVE_STREAM_MAX_ATTEMPTS,
  );
