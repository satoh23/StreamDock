// NOTE: プリセット一覧は 005 で、プリセット内のツール構成（ツール選択・起動順・並行）は 006 で
// それぞれ実データ（SQLite）へ移行した。旧2ステップUI用の仮データ（toolCatalog /
// defaultSelectedToolIds）は AddPresetScreen が登録済みツール（実データ）を使うようになったため撤去した。
// 以下は AddToolScreen が使用中の表示専用 select 選択肢のみ残置している。

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
