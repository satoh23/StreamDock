import { useCallback, useEffect, useState } from "react";
import {
  applyThemePreference,
  loadThemePreference,
  saveThemePreference,
  type ThemePreference,
} from "./theme";

/**
 * テーマ設定の状態を保持し、変更を localStorage と documentElement に反映するフック。
 * 「システム」時は data-theme を外すため、OS のライト/ダーク変更には CSS
 * （prefers-color-scheme）が自動追従する（matchMedia の監視は不要）。
 */
export function useTheme() {
  const [preference, setPreferenceState] = useState<ThemePreference>(() =>
    loadThemePreference(),
  );

  // 選択が変わるたびに DOM へ反映する（初回マウント時の反映も兼ねる）。
  useEffect(() => {
    applyThemePreference(preference);
  }, [preference]);

  const setPreference = useCallback((next: ThemePreference) => {
    saveThemePreference(next);
    setPreferenceState(next);
  }, []);

  return { preference, setPreference };
}
