import type { Preset, SelectedApp, Tool, ToolCatalogItem } from "../types";

/** サイドバーのプリセット一覧（仮データ） */
export const presets: Preset[] = [
  { id: "normal", name: "通常配信プリセット", chips: ["10ツール", "起動順あり"] },
  { id: "chat", name: "雑談用プリセット", chips: ["7ツール", "一部並行"] },
  { id: "global", name: "海外コメント対応プリセット", chips: ["9ツール", "起動順あり"] },
  { id: "collab", name: "コラボ配信プリセット", chips: ["8ツール", "一部並行"] },
  { id: "singing", name: "歌枠プリセット", chips: ["6ツール"] },
];

/** 登録済みツールのカタログ（10件・仮データ） */
export const toolCatalog: ToolCatalogItem[] = [
  { id: "obs", iconLetter: "O", name: "OBS Studio", description: "配信本体" },
  { id: "onecomme", iconLetter: "1", name: "ワンコメ", description: "コメント取得・表示" },
  { id: "bouyomi", iconLetter: "読", name: "棒読みちゃん", description: "コメント読み上げ" },
  { id: "voicevox", iconLetter: "V", name: "VOICEVOX", description: "音声変換・棒読み連携" },
  { id: "translate", iconLetter: "翻", name: "翻訳ツール", description: "チャット翻訳・変換" },
  { id: "tanuesa", iconLetter: "狸", name: "たぬえさ", description: "配信補助ツール" },
  { id: "avatars", iconLetter: "A", name: "StreamAvatars", description: "画面下部のユーザーアバター" },
  { id: "vtube", iconLetter: "V", name: "VTubeStudio", description: "Vの本体" },
  { id: "screenshot", iconLetter: "📸", name: "スクショツール", description: "配信用スクリーンショット" },
  { id: "viewers", iconLetter: "👁", name: "視聴人数表示ツール", description: "同接・視聴人数の表示" },
];

/** メイン画面 起動順リストの初期状態（1-3=running, 4=starting, 5-10=waiting） */
export const initialTools: Tool[] = toolCatalog.map((tool, index) => ({
  id: tool.id,
  iconLetter: tool.iconLetter,
  name: tool.name,
  description: tool.description,
  state: index < 3 ? "running" : index === 3 ? "starting" : "waiting",
}));

/** ツール追加画面のサンプル選択アプリ */
export const sampleSelectedApp: SelectedApp = {
  iconLetter: "A",
  name: "StreamAvatars",
  path: "C:\\Program Files (x86)\\Steam\\steamapps\\common\\StreamAvatars\\StreamAvatars.exe",
  description: "画面下部のユーザーアバター",
};

/** 登録先プリセットの選択肢 */
export const targetPresetOptions: string[] = [
  "通常配信プリセット",
  "雑談用プリセット",
  "海外コメント対応プリセット",
  "ツールだけ登録して、プリセットには追加しない",
];

/** 追加位置の選択肢 */
export const insertModeOptions: string[] = [
  "最後に追加",
  "先頭に追加",
  "選択して追加",
  "順番なし（並行起動）",
];

/** プリセット追加 Step1 で最初にチェック済みにするツールID */
export const defaultSelectedToolIds: string[] = [
  "obs",
  "onecomme",
  "bouyomi",
  "voicevox",
  "avatars",
];
