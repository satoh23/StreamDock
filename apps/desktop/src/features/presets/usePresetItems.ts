import { useCallback, useEffect, useState } from "react";
import { toErrorMessage } from "../tools/useTools";
import { listAllPresetItems } from "./presetItemApi";
import type { PresetItemRecord } from "./types";

interface UsePresetItemsResult {
  items: PresetItemRecord[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

/**
 * 全プリセットのツール構成（PresetItem）をロードして保持する。
 * App で一度呼び、選択中プリセットの一覧やサイドバーのツール数集計へ派生させる。
 * エラー整形は Tool / Preset と共通の toErrorMessage を再利用する。
 */
export function usePresetItems(): UsePresetItemsResult {
  const [items, setItems] = useState<PresetItemRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listAllPresetItems();
      setItems(result);
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

  return { items, loading, error, reload };
}
