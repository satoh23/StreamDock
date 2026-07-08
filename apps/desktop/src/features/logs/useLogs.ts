import { useCallback, useEffect, useState } from "react";
import { listAppLogs } from "./logsApi";
import { toErrorMessage } from "../tools/useTools";
import type { AppLogEntry } from "./types";

interface UseLogsResult {
  logs: AppLogEntry[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

/**
 * 直近のアプリ内ログをロードして保持する。診断画面で使う。
 * 他の use* hook と同じ { items, loading, error, reload } 形に揃える。
 */
export function useLogs(limit?: number): UseLogsResult {
  const [logs, setLogs] = useState<AppLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setLogs(await listAppLogs(limit));
      setError(null);
    } catch (e) {
      setError(toErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { logs, loading, error, reload };
}
