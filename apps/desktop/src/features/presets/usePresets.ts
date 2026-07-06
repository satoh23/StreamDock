import { useCallback, useEffect, useState } from "react";
import { toErrorMessage } from "../tools/useTools";
import { listPresets } from "./presetApi";
import type { PresetRecord } from "./types";

interface UsePresetsResult {
  presets: PresetRecord[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

/**
 * 登録済みプリセットをロードして保持する。App で一度呼び、props で各画面へ配布する。
 * エラー整形は Tool と共通の toErrorMessage を再利用する。
 */
export function usePresets(): UsePresetsResult {
  const [presets, setPresets] = useState<PresetRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listPresets();
      setPresets(result);
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

  return { presets, loading, error, reload };
}
