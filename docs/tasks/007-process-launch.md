# 007 Process Launch

## 目的

stream-dock に、登録済みツールを単体で起動する機能を追加する。

006 Preset Item Ordering までで、以下は完了している前提。

- Tool を登録・編集・削除・一覧表示できる
- Preset を登録・編集・削除・一覧表示できる
- Preset に Tool を紐づけられる
- PresetItem の起動順と ordered / parallel を保存・編集できる

007 では、登録済み Tool の `executablePath` を使って、そのツールを stream-dock から単体起動できるようにする。

## このタスクでやること

- 登録済み Tool を単体起動する Tauri command を追加する
- React 側に Tool 起動用 API wrapper を追加する
- Tool 一覧またはメイン画面の Tool 表示から単体起動できるようにする
- 起動成功時に最低限の成功表示を出す
- 起動失敗時にユーザーが理解できるエラー表示を出す
- Rust 側で Tool ID と実行パスの検証を行う
- shell 経由ではなく、保存済み executablePath を直接プロセス起動する
- 007 時点で必要な範囲の起動結果を返す
- 009 Process Stop に備えて、stream-dock 経由で起動した PID を扱いやすい形にする
- docs/progress.md を更新する

## このタスクでやらないこと

- プリセット内ツールの一括起動
- ordered / parallel に従った起動制御
- プロセス停止
- 起動状態監視
- waiting / starting / running / stopping / stopped / error の本格的な状態管理
- `.lnk` の実体パス解決
- `.bat` 対応
- アイコン自動抽出
- 設定ファイルのバックアップ
- 設定ファイルの上書き
- 外部通信
- telemetry
- analytics
- crash report
- cloud sync
- 自動アップデート
- 任意コマンド実行機能
- 任意ファイル操作機能

## 重要な方針

007 は OS プロセス操作が初めて入るタスクなので、セキュリティを優先する。

ただし、過剰な設計や大規模リファクタリングはしない。

MVP の目的は、登録済みツールを安全に単体起動できるようにすること。

## 起動対象

起動対象は、Tool Registry に登録済みの Tool のみ。

frontend から任意のパスや任意のコマンド文字列を渡して起動してはいけない。

正しい流れは以下。

1. frontend は `toolId` だけを渡す
2. Rust 側で Tool を取得する
3. Rust 側で Tool の存在と `executablePath` を検証する
4. Rust 側で保存済み `executablePath` を使ってプロセスを起動する
5. 起動結果を frontend に返す

## MVP の起動仕様

### 入力

frontend から渡してよい値は原則として `toolId` のみ。

```ts
type LaunchToolInput = {
  toolId: string;
};
```

将来的に引数や working directory を扱う可能性はあるが、007 では実装しない。

### 出力

起動成功時は、最低限以下を返す。

```ts
type LaunchToolResult = {
  toolId: string;
  processId: number;
  startedAt: string;
};
```

起動失敗時は、frontend で表示可能な安全なエラーを返す。

エラーに不要な個人情報や環境変数を含めない。

## Rust 側で確認すること

Rust 側では最低限以下を検証する。

- `toolId` が空ではない
- `toolId` に対応する Tool が存在する
- Tool の `executablePath` が空ではない
- `executablePath` が絶対パスである
- `executablePath` が存在する
- `executablePath` がディレクトリではない
- 007 では `.lnk` を起動対象にしない
- 007 では `.bat` を起動対象にしない
- 007 では shell を経由しない
- 007 では任意のコマンド文字列を組み立てない

## 起動方法

Rust 側では shell 経由ではなく、保存済み executablePath を直接起動する。

方針としては以下。

- `std::process::Command::new(executable_path)` を使う
- `cmd /C` は使わない
- `sh -c` は使わない
- 文字列連結でコマンドを作らない
- frontend から引数配列を受け取らない
- frontend から working directory を受け取らない

## PID の扱い

009 Process Stop では、stream-dock 経由で起動した PID だけを停止対象にする予定。

そのため、007 では起動成功時に PID を取得できるようにする。

実装方針は既存設計に合わせるが、最低限以下のどちらかにする。

- 起動結果として PID を返す
- 起動記録を Rust 側で保存できる構造にしておく

ただし、007 ではプロセス停止や状態監視は実装しない。

## Tauri command 候補

既存の命名規則に合わせて最終決定する。

候補は以下。

```rust
launch_tool
```

想定する責務は以下。

- toolId を受け取る
- Tool repository / service から Tool を取得する
- executablePath を検証する
- shell を使わずにプロセスを起動する
- processId と startedAt を返す

## service / repository 方針

既存の 004 Tool Registry / 005 Preset CRUD / 006 Preset Item Ordering の構成に合わせる。

基本方針は以下。

- Tauri command は薄くする
- 起動ロジックは service 層に寄せる
- Tool 取得は既存 repository / service を使う
- 必要なら process launch 用 service を追加する
- 必要なら launch record 用 model / repository を追加する
- 大規模なリファクタリングはしない

## React 側 API wrapper

React コンポーネントから Tauri command を直接呼ばない。

PresetItem API や Tool API と同じ方針で、API wrapper を追加する。

候補は以下。

```ts
export async function launchTool(toolId: string): Promise<LaunchToolResult>;
```

## UI 接続

UI は既存の 003 App Shell の見た目を大きく崩さない。

最低限、以下のどこかから単体起動できるようにする。

- Tool 一覧
- メイン画面の選択中プリセット内 Tool 一覧
- Tool 詳細または編集モード内の Tool 行

007 では一括起動ボタンを実装しない。

既に一括起動っぽいボタンが UI に存在する場合は、007 では本実装しない。

## UI の挙動

単体起動ボタンを押したときの挙動は以下。

- 起動中は対象ボタンを一時的に disabled にする
- 成功したら成功メッセージを表示する
- 失敗したらエラーメッセージを表示する
- エラー表示はユーザーが理解できる内容にする
- 詳細すぎる内部情報や環境情報は表示しない

## エラー例

最低限、以下のようなエラーを扱う。

- Tool が存在しない
- executablePath が未設定
- executablePath が存在しない
- executablePath がディレクトリ
- 007 では対応していないファイル形式
- プロセス起動に失敗した

## セキュリティ制約

docs/security.md に従うこと。

特に以下を守る。

- 外部通信を追加しない
- frontend から直接 shell 実行しない
- frontend から自由なファイル操作をしない
- 任意コマンド実行機能を作らない
- 汎用的な `run_command` を作らない
- 汎用的な `execute_shell` を作らない
- 汎用的な `write_file` を作らない
- 汎用的な `delete_path` を作らない
- 汎用的な `open_anything` を作らない
- Tauri capabilities に不要な強権限を追加しない
- shell plugin に広すぎる権限を与えない
- filesystem plugin に広すぎる権限を与えない
- opener plugin に広すぎる権限を与えない
- 入力値は Rust 側でも検証する
- frontend から渡された toolId を無条件に信用しない
- Tool に保存された executablePath も無条件に信用しない
- ログに不要な個人情報や機密情報を出さない

## 007 で追加してはいけない command

以下のような汎用 command は追加しない。

```text
run_command
execute_shell
run_shell
write_file
delete_path
open_anything
launch_path
launch_command
```

007 で必要なのは、登録済み Tool を toolId で起動する限定的な command のみ。

## 006 以前への影響確認

以下が壊れていないことを確認する。

- Tool の登録
- Tool の一覧表示
- Tool の編集
- Tool の削除
- Preset の作成
- Preset の一覧表示
- Preset の編集
- Preset の削除
- PresetItem の追加
- PresetItem の削除
- PresetItem の並び替え
- ordered / parallel の切り替え
- サイドバーのプリセットメタ情報
- メイン画面の選択中プリセット連動

## 完了条件

- 登録済み Tool を単体起動できる
- frontend からは toolId のみを渡している
- Rust 側で Tool を取得している
- Rust 側で executablePath を検証している
- shell を経由せずに起動している
- 起動成功時に processId を取得できる
- 起動成功時に UI で成功が分かる
- 起動失敗時に UI でエラーが分かる
- 007 の範囲外である一括起動を実装していない
- 007 の範囲外である停止処理を実装していない
- 007 の範囲外である状態監視を実装していない
- 007 の範囲外である `.lnk` 解決を実装していない
- 007 の範囲外である `.bat` 対応を実装していない
- 危険な汎用 Tauri command を追加していない
- Tauri capabilities / permissions に不要な強権限を追加していない
- React 側に Tool 起動用 API wrapper がある
- React コンポーネントから直接 invoke を乱用していない
- 004 Tool Registry の既存機能が壊れていない
- 005 Preset CRUD の既存機能が壊れていない
- 006 Preset Item Ordering の既存機能が壊れていない
- TypeScript の型確認が通る
- Rust 側の cargo check が通る
- docs/progress.md が更新されている

## 確認コマンド

実際の package.json に合わせて、可能な範囲で以下を実行する。

```bash
git diff --stat
git diff --name-only
pnpm --filter desktop typecheck
pnpm --filter desktop lint
cd apps/desktop/src-tauri && cargo check
pnpm --filter desktop tauri dev
```

## 実装後に必要なレビュー

007 は OS プロセス操作が入るため、実装後に security-review を必ず行う。

レビューでは最低限以下を確認する。

- shell 経由になっていないか
- frontend から任意パスを起動できないか
- frontend から任意コマンドを実行できないか
- Tauri capabilities / permissions が広がりすぎていないか
- `.lnk` / `.bat` / 一括起動 / 停止処理など 007 の範囲外が混ざっていないか
- 009 Process Stop に進む前に PID の扱いが破綻していないか
