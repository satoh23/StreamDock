/** 外観テーマの選択肢。既定は "system"（OS 設定に追従）。 */
export type ThemePreference = "system" | "light" | "dark";

/** localStorage の保存キー（1 個のみ）。 */
const STORAGE_KEY = "stream-dock.theme";

const VALID: readonly ThemePreference[] = ["system", "light", "dark"];

function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === "string" && VALID.includes(value as ThemePreference);
}

/** 保存済みのテーマ設定を読み込む。未保存・不正値・例外はすべて "system" にフォールバック。 */
export function loadThemePreference(): ThemePreference {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return isThemePreference(raw) ? raw : "system";
  } catch {
    return "system";
  }
}

/** テーマ設定を保存する（ローカルのみ。外部送信しない）。 */
export function saveThemePreference(preference: ThemePreference): void {
  try {
    localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // プライベートモード等で書けない場合は黙って無視する（表示は継続できる）。
  }
}

/**
 * ルート要素（documentElement）にテーマを反映する。
 * "system" は data-theme を外して CSS の prefers-color-scheme に委ねる（OS 変更へライブ追従）。
 * "light" / "dark" は data-theme を付与して明示的に上書きする。
 */
export function applyThemePreference(preference: ThemePreference): void {
  const root = document.documentElement;
  if (preference === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", preference);
  }
}
