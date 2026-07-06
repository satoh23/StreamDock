# 004 Tool Registry

## 目的

stream-dock に、配信で使うPCツールを登録・管理できるようにする。

このタスクでは、ユーザーが OBS Studio、ワンコメ、棒読みちゃん、VOICEVOX などのツールを登録し、アプリ再起動後も登録内容が残る状態を作る。

## 背景

003 App Shell では、HTMLプロトタイプをもとに以下の画面をReactで実装した。

- メイン画面
- ツール追加画面
- プリセット追加画面

ただし、現時点では仮データ表示のみで、実際の保存処理やTauri/Rust側の処理は未実装。

004 Tool Registry では、まず「ツールを登録して保存できる」状態にする。

## 対象範囲

### やること

- Tool model を定義する
- ツール登録用の保存処理を実装する
- 登録済みツール一覧を取得できるようにする
- ツールを編集できるようにする
- ツールを削除できるようにする
- アプリ再起動後も登録内容が残るようにする
- React側のツール追加画面と接続する
- サイドバーやメイン画面のツール一覧を、仮データではなく登録済みデータから表示する
- 入力バリデーションを最低限実装する
- docs/progress.md を更新する

### やらないこと

- 実際のプロセス起動
- 一括起動
- プロセス停止
- 起動状態監視
- `.lnk` の実体パス解決
- `.bat` の実行対応
- アプリアイコンの自動抽出
- 設定ファイルのバックアップ・上書き
- プリセットへの紐付け
- プリセット内の起動順管理

## 技術方針

- OS操作、ファイル操作、保存処理は Rust / Tauri 側に寄せる
- フロントエンドから直接 shell 実行はしない
- データ保存はローカル永続化する
- 保存方式は SQLite を第一候補とする
- SQLite導入が重すぎる場合は、実装前に代替案を提示する
- command は薄くし、ロジックは service / repository 層に寄せる
- apps/desktop/src-tauri 配下にRust側の処理を実装する
- apps/desktop/src 配下にReact側のAPI wrapperと画面接続を実装する

## Tool model

MVPでは、Tool は以下の項目を持つ。

```ts
type Tool = {
  id: string;
  name: string;
  executablePath: string;
  description?: string;
  iconLabel?: string;
  createdAt: string;
  updatedAt: string;
};
```

## 入力項目

ツール追加画面では、最低限以下を扱う。

- ツール名
- 実行ファイルパス
- 説明
- アイコン表示用ラベル

## バリデーション

最低限、以下を実装する。

- ツール名は必須
- 実行ファイルパスは必須
- 同じ executablePath のツールを重複登録しない
- 空文字や前後の余計な空白を保存しない
- 存在しないパスを許容するかどうかは、実装前に方針を提示する

## Tauri command 候補

Rust側には、最低限以下のcommandを用意する。

- `create_tool`
- `list_tools`
- `update_tool`
- `delete_tool`
- `get_tool`

ただし、命名や引数形式は実装前の計画で提示する。

## React側の実装

React側では、Tauri command を直接各コンポーネントから呼ばず、API wrapperを経由する。

例:

```ts
// apps/desktop/src/features/tools/toolApi.ts
export async function listTools(): Promise<Tool[]>;
export async function createTool(input: CreateToolInput): Promise<Tool>;
export async function updateTool(
  id: string,
  input: UpdateToolInput,
): Promise<Tool>;
export async function deleteTool(id: string): Promise<void>;
```

## UI接続

以下を仮データから実データに置き換える。

- サイドバーのツール一覧
- ツール追加画面の保存処理
- 保存後のツール一覧更新
- メイン画面で表示するツール情報

## 期待する挙動

1. ユーザーがツール追加画面を開く
2. ツール名と実行ファイルパスを入力する
3. 保存ボタンを押す
4. Rust側に保存される
5. サイドバーのツール一覧に反映される
6. アプリを再起動しても登録済みツールが残っている
7. 登録済みツールを編集・削除できる

## 完了条件

- ツールを新規登録できる
- 登録済みツール一覧を表示できる
- ツールを編集できる
- ツールを削除できる
- アプリ再起動後もツールが残る
- フロントエンド側は仮データではなく保存済みデータを参照している
- `src-tauri` 側にTool管理のcommand / service / repositoryがある
- 型エラーがない
- Rust側のビルド確認が通る
- 既存の画面表示が壊れていない
- docs/progress.md に作業結果が追記されている

## 確認コマンド

実装後に、可能な範囲で以下を確認する。

```bash
pnpm --filter desktop typecheck
pnpm --filter desktop lint
cd apps/desktop/src-tauri && cargo check
pnpm --filter desktop tauri dev
```

プロジェクトのscript名が異なる場合は、実際のpackage.jsonに合わせて確認コマンドを調整する。

## 注意点

- 004では実際のアプリ起動は実装しない
- 004ではプリセットとの紐付けは実装しない
- 004ではファイル選択ダイアログは必須ではない
- 手入力の実行ファイルパス保存でまず成立させてよい
- ただし、ファイル選択ダイアログを簡単に実装できる場合は、実装前の計画で提案する
- 新しいライブラリを追加する場合は、必ず理由を説明する
- 大きなリファクタリングはしない
- 003 App Shell の見た目を大きく崩さない
