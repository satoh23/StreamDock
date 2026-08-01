export type Screen =
  | "main"
  | "add-tool"
  | "add-preset"
  | "diagnostics"
  | "settings"
  // 055c: アプリ自己アップデート画面（ヘッダーのベルアイコンから遷移）。
  // テキストセクション導線ではないので HEADER_SECTIONS には載せない。
  | "app-update"
  // 未実装機能の「準備中」ダミーページ（ヘッダーのセクション導線から遷移）
  | "rakuraku-tools"
  | "obs-effects";

export type ToolState =
  | "running"
  | "starting"
  | "launched"
  | "stopping"
  | "waiting"
  | "stopped"
  | "error";

/** メイン画面 起動順リストの1ツール */
export interface Tool {
  id: string;
  iconLetter: string;
  /** 018: 自動抽出した実アイコン（base64 PNG, `data:` 無し）。無ければ iconLetter を使う。 */
  iconPng?: string | null;
  name: string;
  description: string;
  state: ToolState;
  /** 023: ツール種別。`"url"` は「開く」のみで停止/状態表示を出さない。 */
  kind: import("./features/tools/types").ToolKind;
}

/** サイドバー等で使うツールのカタログ項目 */
export interface ToolCatalogItem {
  id: string;
  iconLetter: string;
  name: string;
  description: string;
}

/** ツール追加画面で選択したアプリ */
export interface SelectedApp {
  iconLetter: string;
  name: string;
  path: string;
  description: string;
}

/** プリセット追加 Step2 の起動アイテム */
export type LaunchMode = "ordered" | "parallel";

export interface LaunchItem {
  id: string;
  iconLetter: string;
  /** 018: 自動抽出した実アイコン（base64 PNG, `data:` 無し）。無ければ iconLetter を使う。 */
  iconPng?: string | null;
  name: string;
  description: string;
  mode: LaunchMode;
}
