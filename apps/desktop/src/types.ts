export type Screen = "main" | "add-tool" | "add-preset";

export type ToolState =
  | "running"
  | "starting"
  | "launched"
  | "waiting"
  | "error";

/** メイン画面 起動順リストの1ツール */
export interface Tool {
  id: string;
  iconLetter: string;
  name: string;
  description: string;
  state: ToolState;
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
  name: string;
  description: string;
  mode: LaunchMode;
}
