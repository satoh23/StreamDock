export const readPort = (envName: string, defaultValue: number): number => {
  const rawValue = process.env[envName];
  const port = rawValue ? Number(rawValue) : defaultValue;

  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`[api-gateway] invalid ${envName}: ${String(rawValue)}`);
  }

  return port;
};
