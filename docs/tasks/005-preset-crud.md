# 005 Preset CRUD

## 目的

stream-dock に、配信プリセットを作成・一覧表示・編集・削除できる機能を実装する。

配信プリセットは、「通常配信」「雑談配信」「ゲーム配信」「コラボ配信」など、配信内容ごとに使うツール構成をまとめるための単位である。

このタスクでは、まずプリセット単体の管理を実装する。

## 背景

004 Tool Registry では、配信で使うPCツールを登録・一覧表示・編集・削除・ローカル保存できるようにした。

005 Preset CRUD では、次の段階として、配信プリセットそのものをローカル保存できるようにする。

ただし、このタスクではまだプリセットにツールを紐づけない。
プリセットとツールの紐づけ、起動順、並行起動設定は 006 Preset Item Management で実装する。

## 対象範囲

### やること

- Preset model を定義する
- プリセット作成機能を実装する
- プリセット一覧取得機能を実装する
- プリセット詳細取得機能を実装する
- プリセット編集機能を実装する
- プリセット削除機能を実装する
- アプリ再起動後もプリセットが残るようにする
- React側のプリセット追加画面と接続する
- サイドバーのプリセット一覧を、仮データではなく保存済みデータから表示する
- メイン画面で選択中プリセットを切り替えられるようにする
- 最低限の入力バリデーションを実装する
- docs/progress.md を更新する

### やらないこと

- プリセットにツールを追加する処理
- プリセットからツールを外す処理
- プリセット内の起動順管理
- 並行起動設定
- 実際のプロセス起動
- 一括起動
- プロセス停止
- 起動状態監視
- ファイル選択
- 外部通信
- 課金・ユーザーアカウント・クラウド同期

## 技術方針

- 004 Tool Registry で採用した保存方式・ディレクトリ構成・実装方針に合わせる
- すでにSQLiteを導入している場合は、Presetも同じSQLiteに保存する
- もし004でSQLite以外の保存方式を採用している場合は、その方式と整合する形で実装する
- 保存処理は Rust / Tauri 側に寄せる
- frontendから直接ファイル操作しない
- frontendから直接shell実行しない
- Tauri command は薄くし、ロジックは service / repository 層に寄せる
- React側では Tauri command を各コンポーネントから直接呼ばず、API wrapperを経由する
- 003 App Shell の見た目を大きく崩さない
- 004 Tool Registry の既存機能を壊さない

## Preset model

MVPでは、Preset は以下の項目を持つ。

```ts
type Preset = {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
};
```

## 入力項目

プリセット追加画面では、最低限以下を扱う。

- プリセット名
- 説明

説明は任意入力とする。

## バリデーション

最低限、以下を実装する。

- プリセット名は必須
- プリセット名の前後の余計な空白をtrimする
- 空文字のプリセット名は保存しない
- 同じ名前のプリセットを重複登録しない
- 説明も保存前にtrimする
- frontend側だけでなく、Rust側でも検証する

## Tauri command 候補

Rust側には、最低限以下のcommandを用意する。

- `create_preset`
- `list_presets`
- `get_preset`
- `update_preset`
- `delete_preset`

ただし、命名・引数・戻り値は既存のTool commandの設計に合わせる。

## React側の実装

React側では、Preset用のAPI wrapperを作成する。

例:

```ts
// apps/desktop/src/features/presets/presetApi.ts
export async function listPresets(): Promise<Preset[]>;
export async function createPreset(input: CreatePresetInput): Promise<Preset>;
export async function getPreset(id: string): Promise<Preset>;
export async function updatePreset(
  id: string,
  input: UpdatePresetInput,
): Promise<Preset>;
export async function deletePreset(id: string): Promise<void>;
```

## UI接続

以下を仮データから実データに置き換える。

- サイドバーのプリセット一覧
- プリセット追加画面の保存処理
- 保存後のプリセット一覧更新
- メイン画面の選択中プリセット名
- プリセット削除後の選択状態

## 期待する挙動

1. ユーザーがプリセット追加画面を開く
2. プリセット名と説明を入力する
3. 保存ボタンを押す
4. Rust側に保存される
5. サイドバーのプリセット一覧に反映される
6. 作成したプリセットを選択できる
7. アプリを再起動してもプリセットが残っている
8. 登録済みプリセットを編集・削除できる

## 削除時の挙動

MVPでは、プリセット削除時に以下を満たす。

- 選択中プリセットを削除した場合は、別のプリセットを選択する
- 他にプリセットがない場合は、未選択状態または空状態を表示する
- 006以降でPresetItemが追加された場合の削除連動は、006以降で扱う

## 空状態

プリセットが1件もない場合は、画面上で空状態を表示する。

例:

- 「まだプリセットがありません」
- 「プリセットを追加して、配信で使うツール構成を保存しましょう」

ただし、デザインは003 App Shellのトーンに合わせる。

## 完了条件

- プリセットを新規作成できる
- 登録済みプリセット一覧を表示できる
- プリセットを選択できる
- プリセットを編集できる
- プリセットを削除できる
- アプリ再起動後もプリセットが残る
- サイドバーのプリセット一覧が保存済みデータを参照している
- メイン画面の選択中プリセットが保存済みデータと連動している
- Rust側にPreset管理のcommand / service / repositoryがある
- React側にPreset用API wrapperがある
- 004 Tool Registryの既存機能が壊れていない
- 型エラーがない
- Rust側のビルド確認が通る
- 既存の画面表示が大きく崩れていない
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

## セキュリティ観点

005ではOS操作・プロセス操作はまだ行わないが、以下を確認する。

- 外部通信を追加していない
- frontendから直接ファイル操作していない
- frontendから直接shell実行していない
- 保存処理はRust/Tauri側に寄せている
- 入力値はRust側でも検証している
- 汎用的な `run_command` / `execute_shell` / `write_file` / `delete_path` のような危険なcommandを追加していない
- Tauri capabilities に不要な強権限を追加していない
- 004 Tool Registryのデータを壊す変更をしていない

## 注意点

- 005ではプリセットとツールの紐づけは実装しない
- 005では起動順・並行起動設定は実装しない
- 005では実際のプロセス起動は実装しない
- 005では大きなUI作り直しをしない
- 003 App Shellのデザインを維持する
- 004 Tool Registryの実装パターンに合わせる
- 新しいライブラリを追加する場合は、必ず理由を説明する
- 大きなリファクタリングはしない
