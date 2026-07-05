docs/progress.md、docs/architecture.md、docs/product.md、CLAUDE.md、docs/tasks/003-app-shell.md を読んでください。

今回は 003 App Shell だけを実装します。

参照するプロトタイプ:

- docs/prototypes/stream-dock-prototype-v15.html
- docs/prototypes/stream-dock-add-tool-prototype-v10.html
- docs/prototypes/stream-dock-add-preset-two-step-prototype.html

目的:
HTMLプロトタイプと同じ見た目・画面構成を、apps/desktop/src 配下にReact + TypeScriptで移植してください。

作る画面:

1. メイン画面
   - サイドバー
   - 配信プリセット一覧
   - ツール一覧
   - 起動順リスト
   - 起動済み / 起動中 / 待機中 / エラー のステータス
   - 編集モード
   - 一括起動ボタン
   - 仮の起動状態変更

2. ツール追加画面
   - サイドバー
   - アプリ選択ドロップゾーン
   - 選択済みアプリ表示
   - 表示名入力
   - 登録先プリセット選択
   - 追加位置選択
   - 追加後プレビュー

3. プリセット追加画面
   - サイドバー
   - 2ステップUI
   - Step 1: 使うツール選択
   - Step 2: 起動順・並行起動設定
   - 選択中/作成後プレビュー

やること:

- Reactコンポーネントに分割する
- 仮データを使う
- React stateで画面切り替えする
- React stateで編集モードや仮の起動状態を切り替える
- CSSはプロトタイプのデザインをできるだけ再現する
- 既存のプロトタイプHTMLに近い配色、余白、角丸、カード、スクロール領域を維持する

やらないこと:

- SQLite
- Tauri command
- src-tauriの変更
- 実際のファイル選択
- 実際のプロセス起動
- 保存処理
- shadcn/uiへの本格移行
- 仕様外のリファクタリング

重要ルール:

- まず変更計画と作成・変更するファイル一覧だけ提示してください
- こちらが「実装して」と言うまで変更しないでください
- UIだけの実装なので src-tauri は触らないでください
- 大きなHTMLファイルは全文を何度も読まず、必要箇所を参照して進めてください
- 作業後に docs/progress.md を更新してください

まず計画だけ出してください。
