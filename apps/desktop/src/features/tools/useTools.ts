import { useCallback, useEffect, useState } from "react";
import { listTools } from "./toolApi";
import type { ToolRecord } from "./types";

interface UseToolsResult {
  tools: ToolRecord[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

/**
 * 登録済みツールをロードして保持する。App で一度呼び、props で各画面へ配布する。
 */
export function useTools(): UseToolsResult {
  const [tools, setTools] = useState<ToolRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listTools();
      setTools(result);
      setError(null);
    } catch (e) {
      setError(toErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { tools, loading, error, reload };
}

/** Tauri command が reject した AppError（{ kind, message }）を表示用文字列にする。 */
export function toErrorMessage(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) {
    const message = (e as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  if (typeof e === "string") return e;
  return "予期しないエラーが発生しました";
}
