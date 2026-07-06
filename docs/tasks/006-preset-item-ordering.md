# 006 Preset Item Ordering

## 目的

stream-dock に、プリセット内のツール構成を管理する機能を実装する。

ユーザーが作成した配信プリセットに、登録済みツールを追加し、起動順や並行起動設定を保存・編集できるようにする。

このタスクでは、以下を実装する。

- プリセットにツールを追加する
- プリセットからツールを外す
- プリセット内のツール一覧を表示する
- 起動順を変更する
- ordered / parallel の起動モードを切り替える
- プリセット追加画面の2ステップUIと実データを接続する
- メイン画面の編集モードと実データを接続する

## 背景

004 Tool Registry では、配信で使うPCツールを登録・一覧表示・編集・削除・ローカル保存できるようにした。

005 Preset CRUD では、配信プリセットを作成・一覧表示・編集・削除・ローカル保存できるようにした。

006 Preset Item Ordering では、Tool と Preset を紐づけ、プリセットごとに「どのツールを、どの順番で、または順番なしで起動するか」を保存・編集できるようにする。

ただし、このタスクではまだ実際のアプリ起動・一括起動・停止・起動状態監視は実装しない。
それらは 007 Process Launch 以降で扱う。

## 対象範囲

### やること

- PresetItem model を定義する
- プリセットにツールを追加する機能を実装する
- プリセットからツールを外す機能を実装する
- プリセット内のツール一覧取得を実装する
- プリセット内の起動順変更を実装する
- ordered / parallel の起動モードを保存・更新できるようにする
- プリセット追加画面の Step 1 / Step 2 を実データと接続する
- メイン画面の編集モードで、ツールの追加・削除・並び替え・起動モード変更ができるようにする
- サイドバーのプリセットメタ情報に、紐づいているツール数を反映する
- アプリ再起動後もプリセット内のツール構成が残るようにする
- 最低限の入力バリデーションを実装する
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
- 外部通信
- 課金
- ユーザーアカウント
- クラウド同期

## 技術方針

- 004 Tool Registry / 005 Preset CRUD で採用した保存方式・ディレクトリ構成・実装方針に合わせる
- 保存処理は Rust / Tauri 側に寄せる
- frontendから直接ファイル操作しない
- frontendから直接shell実行しない
- Tauri command は薄くし、ロジックは service / repository 層に寄せる
- React側では Tauri command を各コンポーネントから直接呼ばず、API wrapperを経由する
- 003 App Shell の見た目を大きく崩さない
- 004 Tool Registry / 005 Preset CRUD の既存機能を壊さない
- DB schema / migration / model / repository の整合性を保つ
- 大きなリファクタリングはしない

## PresetItem model

MVPでは、PresetItem は以下の項目を持つ。

```ts
type PresetItem = {
  id: string;
  presetId: string;
  toolId: string;
  launchMode: "ordered" | "parallel";
  orderIndex: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};
```

## 表示用モデル

React側では、プリセット内ツール一覧を表示しやすくするため、Tool情報を含んだ表示用型を用意してよい。

```ts
type PresetItemWithTool = PresetItem & {
  tool: Tool;
};
```

## launchMode の扱い

### ordered

起動順が重要なツール。

UIでは番号付きで表示する。

例:

- 1 OBS Studio
- 2 ワンコメ
- 3 棒読みちゃん

### parallel

起動順が重要ではないツール。

UIでは「並行」または「順番なし」と表示する。

例:

- 並行 VOICEVOX
- 並行 翻訳ツール

006時点では実際の起動は行わないため、launchMode は保存・表示・編集のみ扱う。

## orderIndex の方針

MVPでは以下の方針とする。

- ordered のツールは `orderIndex` 昇順で表示する
- parallel のツールも一覧上の表示順を持つため `orderIndex` を保持する
- 上下ボタンで `orderIndex` を入れ替える
- 削除後は必要に応じて `orderIndex` を詰め直す
- 同一プリセット内で同じToolを重複追加しない

## 入力バリデーション

最低限、以下を実装する。

- presetId は必須
- toolId は必須
- launchMode は `ordered` または `parallel` のみ許可
- orderIndex は0以上の整数
- enabled はboolean
- 存在しない presetId / toolId を紐づけない
- 同一プリセット内で同じ toolId を重複登録しない
- frontend側だけでなく、Rust側でも検証する

## Tauri command 候補

Rust側には、最低限以下のcommandを用意する。

- `add_tool_to_preset`
- `list_preset_items`
- `remove_tool_from_preset`
- `update_preset_item`
- `reorder_preset_items`
- `set_preset_item_launch_mode`

ただし、命名・引数・戻り値は既存の Tool / Preset command の設計に合わせる。

## React側の実装

React側では、PresetItem用のAPI wrapperを作成する。

例:

```ts
// apps/desktop/src/features/presetItems/presetItemApi.ts
export async function listPresetItems(
  presetId: string,
): Promise<PresetItemWithTool[]>;
export async function addToolToPreset(
  input: AddToolToPresetInput,
): Promise<PresetItemWithTool>;
export async function removeToolFromPreset(id: string): Promise<void>;
export async function updatePresetItem(
  id: string,
  input: UpdatePresetItemInput,
): Promise<PresetItemWithTool>;
export async function reorderPresetItems(
  presetId: string,
  itemIds: string[],
): Promise<PresetItemWithTool[]>;
export async function setPresetItemLaunchMode(
  id: string,
  launchMode: "ordered" | "parallel",
): Promise<PresetItemWithTool>;
```

## UI接続

### メイン画面

- 選択中プリセットに紐づくツール一覧を表示する
- 編集モードで上下移動できる
- 編集モードでプリセットからツールを外せる
- 編集モードで ordered / parallel を切り替えられる
- まだ起動機能は実装しないため、起動ボタンは見た目だけ、またはdisabledでもよい

### プリセット追加画面

- Step 1で登録済みツールから使用ツールを選択する
- Step 2で選択したツールの起動順・並行起動設定を編集する
- 保存時に Preset と PresetItem を作成する
- 005で実装済みのPreset作成処理と整合する形にする

### サイドバー

- プリセット一覧に紐づいているツール数を表示する
- 例: `5ツール`
- 並行起動が含まれる場合は、可能なら `一部並行` と表示する

## 期待する挙動

1. ユーザーがプリセットを選択する
2. そのプリセットに紐づくツール一覧が表示される
3. 編集モードに入る
4. ツールを追加できる
5. ツールの順番を変更できる
6. ツールを並行起動設定に変更できる
7. ツールをプリセットから外せる
8. アプリを再起動しても構成が残っている

## 空状態

選択中プリセットにツールが1件もない場合は、空状態を表示する。

例:

- 「このプリセットにはまだツールがありません」
- 「ツールを追加して、配信準備をまとめましょう」

デザインは003 App Shellのトーンに合わせる。

## 削除時の挙動

PresetItem削除時は、Tool自体は削除しない。
あくまでプリセットから外すだけにする。

Tool Registryに登録されているToolは残す。

## 完了条件

- プリセットにツールを追加できる
- プリセットからツールを外せる
- プリセット内ツール一覧を表示できる
- 起動順を変更できる
- ordered / parallel を切り替えられる
- アプリ再起動後もプリセット内ツール構成が残る
- プリセット追加画面の2ステップUIが実データと接続されている
- メイン画面の選択中プリセットに応じてツール一覧が切り替わる
- サイドバーのプリセットメタ情報にツール数が反映される
- Rust側にPresetItem管理のcommand / service / repositoryがある
- React側にPresetItem用API wrapperがある
- 004 Tool Registry / 005 Preset CRUDの既存機能が壊れていない
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

006ではOS操作・プロセス操作はまだ行わないが、以下を確認する。

- 外部通信を追加していない
- frontendから直接ファイル操作していない
- frontendから直接shell実行していない
- 保存処理はRust/Tauri側に寄せている
- 入力値はRust側でも検証している
- 汎用的な `run_command` / `execute_shell` / `write_file` / `delete_path` のような危険なcommandを追加していない
- Tauri capabilities に不要な強権限を追加していない
- 004 Tool Registry / 005 Preset CRUDのデータを壊す変更をしていない
- Tool削除とPresetItem削除の責務が混ざっていない

## 注意点

- 006では実際のプロセス起動は実装しない
- 006では一括起動は実装しない
- 006では停止処理は実装しない
- 006では起動状態監視は実装しない
- PresetItem削除時にTool自体を削除しない
- 003 App Shellのデザインを維持する
- 004 / 005の実装パターンに合わせる
- 新しいライブラリを追加する場合は、必ず理由を説明する
- 大きなリファクタリングはしない
