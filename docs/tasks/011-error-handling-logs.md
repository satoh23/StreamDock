# 011 Error Handling / Logs

## 目的

stream-dock に、ユーザー検証で原因を追える最低限のエラー処理とログ機能を追加する。

010 Runtime Status までで、Tool の登録、Preset 管理、PresetItem の起動順管理、単体起動、一括起動、停止、runtime status 表示ができるようになっている前提。

011 では、特に以下のような問題が起きたときに、ユーザーと開発者が状況を把握しやすくする。

- Tool の起動に失敗した
- Preset の一括起動で一部 Tool が失敗した
- Process Stop に失敗した
- Runtime Status の取得に失敗した
- 登録された executablePath が存在しない
- `.lnk` / `.bat` など未対応形式を起動しようとした
- DB / 保存処理で失敗した
- UI 上では何が起きたか分かりにくい

MVP の目的は、完璧なログ基盤を作ることではなく、ユーザーテスト時に問題を再現・聞き取り・修正しやすくすること。

## 現在の前提

以下は完了済み。

- 004 Tool Registry
  - Tool を登録・編集・削除・一覧表示できる
  - Tool の executablePath を保存できる

- 005 Preset CRUD
  - Preset を登録・編集・削除・一覧表示できる

- 006 Preset Item Ordering
  - Preset に Tool を追加できる
  - Preset から Tool を外せる
  - PresetItem の orderIndex を変更できる
  - PresetItem の launchMode を ordered / parallel で切り替えられる

- 007 Process Launch
  - 登録済み Tool を単体起動できる
  - 起動成功時に processId / launchId を取得できる

- 008 Bulk Launch
  - Preset に紐づく Tool を ordered / parallel に従って一括起動できる
  - 一括起動結果として成功件数・失敗件数を返せる

- 009 Process Stop
  - stream-dock 経由で起動したプロセスだけを停止できる
  - launchId を使って停止できる

- 010 Runtime Status
  - runtime process registry の状態を UI に反映できる
  - waiting / starting / running / stopping / stopped / error を表示できる

## このタスクでやること

- Rust 側のエラー型を整理する
- frontend に返すエラー形式を統一する
- 起動・一括起動・停止・状態取得・保存処理で発生するエラーを、ユーザー向け message と開発者向け context に分ける
- 主要操作の失敗を structured log として保存する
- UI で直近エラーが分かるようにする
- ユーザーが確認できる簡易ログビューを追加する
- ユーザーテスト時に共有しやすい診断サマリーを表示できるようにする
- ログに不要な個人情報・機密情報・環境変数・スタックトレースを出さない
- docs/progress.md を更新する

## このタスクでやらないこと

- 外部送信ログ
- telemetry
- analytics
- crash report
- cloud sync
- 自動バグレポート送信
- Sentry など外部サービス連携
- 遠隔ログ収集
- 詳細なログ検索機能
- 高度なログフィルタリング
- 永続的な詳細監査ログ基盤
- ログローテーションの本格実装
- OS イベントログ連携
- プロセスツリー解析
- CPU / メモリ使用量取得
- `.lnk` の実体パス解決
- `.bat` 対応
- アイコン自動抽出
- 設定ファイルのバックアップ
- 設定ファイルの上書き
- 任意コマンド実行機能
- 任意ファイル操作機能

## 011 の範囲

011 は、MVP ユーザーテストに必要な最低限のエラー処理とログ整備に限定する。

特に重要なのは以下。

- ユーザーが見て理解できるエラーメッセージ
- 開発者が原因を推測できるログ
- ユーザーが共有しやすい診断サマリー
- セキュリティ上危険な情報をログに出さないこと

## エラー設計方針

Rust 側で、frontend に返すエラー形式を統一する。

概念上は以下。

```ts
type AppErrorResponse = {
  code: string;
  message: string;
  details?: string;
  operation?: string;
  occurredAt: string;
};
```

実際の型名・配置は既存実装に合わせる。

## code の候補

最低限、以下のような error code を用意する。

```text
VALIDATION_ERROR
NOT_FOUND
UNSUPPORTED_FILE_TYPE
LAUNCH_FAILED
BULK_LAUNCH_PARTIAL_FAILED
BULK_LAUNCH_FAILED
STOP_FAILED
PROCESS_ALREADY_EXITED
RUNTIME_STATUS_FAILED
STORAGE_FAILED
PERMISSION_DENIED
INTERNAL_ERROR
```

既存のエラー型がある場合は、それに合わせて整理する。

## message の方針

`message` はユーザー向けの安全な文言にする。

例。

```text
登録されたツールが見つかりません。
登録された実行ファイルが見つかりません。
このファイル形式は現在未対応です。
ツールの起動に失敗しました。
一部のツールを起動できませんでした。
停止対象のプロセスが見つかりませんでした。
アプリ内の保存処理に失敗しました。
```

## details の方針

`details` は UI に表示しても安全な補足情報にする。

以下は入れない。

- 環境変数
- stack trace
- access token
- secret
- full home directory path
- 不要な絶対パス
- OS ユーザー名
- 内部実装の詳細すぎる情報

executablePath の扱いには注意する。

必要な場合でも、UI や共有用サマリーでは full path をそのまま出さず、以下のようにする。

- ファイル名だけ表示する
- 先頭ディレクトリを伏せる
- `.../OBS Studio/bin/obs64.exe` のように一部だけ表示する

## ログ設計方針

主要操作の失敗を structured log として保存する。

概念上は以下。

```ts
type AppLogEntry = {
  id: string;
  level: "info" | "warn" | "error";
  category:
    | "tool"
    | "preset"
    | "preset-item"
    | "process-launch"
    | "bulk-launch"
    | "process-stop"
    | "runtime-status"
    | "storage"
    | "ui";
  operation: string;
  message: string;
  errorCode?: string;
  toolId?: string;
  toolName?: string;
  presetId?: string;
  presetName?: string;
  presetItemId?: string;
  launchId?: string;
  processId?: number;
  occurredAt: string;
};
```

実際の型名・配置・保存方式は既存実装に合わせる。

## ログに残すべきイベント

最低限、以下をログに残す。

- Tool 単体起動成功
- Tool 単体起動失敗
- Preset 一括起動開始
- Preset 一括起動完了
- Preset 一括起動の一部失敗
- Preset 一括起動の全失敗
- Process Stop 成功
- Process Stop 失敗
- Process already exited
- Runtime Status 取得失敗
- 保存処理失敗
- validation error

## ログに残さないもの

以下は残さない。

- ユーザーの環境変数
- access token
- secret
- cookie
- スタックトレース全文
- 不要な full path
- ファイル内容
- 任意のユーザー入力全文
- 外部送信先情報
- クリップボード内容

## ログ保存方式

既存の保存方式に合わせる。

候補は以下。

- SQLite に app_logs テーブルを追加する
- app data 配下の固定ファイルに保存する

MVP では、既存の repository / migration 設計と相性が良い方法を選ぶ。

重要:

- frontend から任意 path を指定してログを書き込めるようにしない
- frontend から任意 path を指定してログを読めるようにしない
- ログ保存先は Rust 側で固定する
- 外部送信しない
- ログファイルを任意の場所に export する機能は 011 では必須にしない

## app_logs table 案

SQLite を使う場合、概念上は以下。

```sql
CREATE TABLE IF NOT EXISTS app_logs (
  id TEXT PRIMARY KEY,
  level TEXT NOT NULL,
  category TEXT NOT NULL,
  operation TEXT NOT NULL,
  message TEXT NOT NULL,
  error_code TEXT,
  tool_id TEXT,
  tool_name TEXT,
  preset_id TEXT,
  preset_name TEXT,
  preset_item_id TEXT,
  launch_id TEXT,
  process_id INTEGER,
  occurred_at TEXT NOT NULL
);
```

既存 migration 方式に合わせて実装する。

## ログ取得 command 候補

既存の命名規則に合わせて最終決定する。

候補は以下。

```rust
list_app_logs
clear_app_logs
get_diagnostic_summary
```

最低限必要なのは以下。

```rust
list_app_logs
get_diagnostic_summary
```

`clear_app_logs` は必要なら追加してよい。

ただし、MVP では command を増やしすぎない。

## list_app_logs

責務は以下。

- 直近のログを返す
- limit を受け取る場合は Rust 側で上限を持つ
- frontend から任意 SQL や任意検索条件を渡さない
- デフォルトは直近 50 件程度
- 最大でも 200 件程度に制限する

## get_diagnostic_summary

責務は以下。

- ユーザーが開発者に共有しやすい診断サマリーを返す
- 直近の error / warn を中心にまとめる
- full path や環境変数など危険な情報は含めない
- クリップボードへのコピー自体は frontend 側で行ってよい
- ファイル export は 011 では必須にしない

概念上の出力は以下。

```ts
type DiagnosticSummary = {
  generatedAt: string;
  appVersion?: string;
  recentErrors: AppLogEntry[];
  recentWarnings: AppLogEntry[];
  runtimeProcesses: RuntimeProcess[];
};
```

実際の型名・配置は既存実装に合わせる。

## React 側 API wrapper

React コンポーネントから Tauri command を直接呼ばない。

logs 用 API wrapper を追加する。

候補は以下。

```ts
export async function listAppLogs(limit?: number): Promise<AppLogEntry[]>;
export async function getDiagnosticSummary(): Promise<DiagnosticSummary>;
export async function clearAppLogs(): Promise<void>;
```

最終的な命名は既存の API wrapper 命名規則に合わせる。

## UI 方針

MVP では大きなログ画面を作り込まない。

最低限、以下を追加する。

- 直近エラー表示
- 簡易ログビュー
- 診断サマリー表示
- 診断サマリーをコピーしやすい UI

設置場所は既存 UI に合わせる。

候補は以下。

- 設定 / diagnostics 的な画面
- メイン画面下部のログパネル
- エラー表示から開ける簡易ログモーダル

大規模な UI 改修はしない。

## UI に表示する情報

最低限、以下を表示する。

- 発生時刻
- level
- category
- operation
- message
- 関連 Tool 名
- 関連 Preset 名
- error code

表示しなくてよいもの。

- stack trace
- full path
- environment variables
- raw Rust error
- 内部的な詳細すぎる context

## UI のエラー表示方針

起動・停止・状態取得などでエラーが起きた場合、ユーザー向け message を表示する。

悪い例。

```text
Os { code: 2, kind: NotFound, message: "指定されたファイルが見つかりません。" }
```

良い例。

```text
登録された実行ファイルが見つかりません。ツールのパスを確認してください。
```

悪い例。

```text
thread 'main' panicked at src-tauri/src/process/mod.rs:42:9
```

良い例。

```text
ツールの起動処理で予期しないエラーが発生しました。
```

## 007 / 008 / 009 / 010 との連携

以下の既存処理にエラー処理とログ記録を追加する。

- Tool 単体起動
- Preset 一括起動
- Process Stop
- Runtime Status 取得
- Tool / Preset / PresetItem の保存処理

ただし、既存機能を壊すような大規模リファクタリングはしない。

## セキュリティ制約

docs/security.md に従うこと。

特に以下を守る。

- 外部通信を追加しない
- telemetry を追加しない
- analytics を追加しない
- crash report を追加しない
- cloud sync を追加しない
- frontend から任意 path にログを書き込める設計にしない
- frontend から任意 path のログを読める設計にしない
- frontend から任意 SQL を渡せる設計にしない
- frontend から自由なファイル操作をしない
- frontend から直接 shell 実行しない
- 汎用的な `write_file` を作らない
- 汎用的な `read_file` を作らない
- 汎用的な `delete_path` を作らない
- 汎用的な `open_anything` を作らない
- 汎用的な `run_command` を作らない
- 汎用的な `execute_shell` を作らない
- Tauri capabilities に不要な強権限を追加しない
- ログに不要な個人情報や機密情報を出さない
- ログに環境変数を出さない
- ログに stack trace 全文を出さない
- 共有用サマリーに full path を出さない
- 入力値は Rust 側でも検証する

## 011 で追加してはいけない command

以下のような汎用 command は追加しない。

```text
read_file
write_file
delete_path
open_anything
export_file
run_command
execute_shell
run_shell
read_any_log
write_any_log
execute_sql
query_sql
```

011 で必要なのは、stream-dock の内部ログを限定的に取得する command のみ。

## 010 以前への影響確認

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
- Tool の単体起動
- Preset の一括起動
- 一括起動結果表示
- launchId を使った単体停止
- Preset 単位停止
- Runtime Status 表示
- waiting / starting / running / stopping / stopped / error の表示
- サイドバーのプリセットメタ情報
- メイン画面の選択中プリセット連動

## 完了条件

- Rust 側のエラー形式が整理されている
- frontend に返すエラー形式が統一されている
- ユーザー向け message と開発者向け context が分けられている
- Tool 単体起動失敗がログに残る
- Preset 一括起動の一部失敗・全失敗がログに残る
- Process Stop 失敗がログに残る
- Runtime Status 取得失敗がログに残る
- 保存処理失敗がログに残る
- 簡易ログビューで直近ログを確認できる
- 診断サマリーを表示できる
- 診断サマリーをコピーしやすい UI がある
- ログに不要な個人情報や機密情報を出していない
- ログに環境変数を出していない
- ログに stack trace 全文を出していない
- 共有用サマリーに full path を出していない
- 外部通信を追加していない
- telemetry / analytics / crash report / cloud sync を追加していない
- frontend から任意 path の読み書きができる設計になっていない
- 危険な汎用 Tauri command を追加していない
- Tauri capabilities / permissions に不要な強権限を追加していない
- React 側に logs 用 API wrapper がある
- React コンポーネントから直接 invoke を乱用していない
- 004 Tool Registry の既存機能が壊れていない
- 005 Preset CRUD の既存機能が壊れていない
- 006 Preset Item Ordering の既存機能が壊れていない
- 007 Process Launch の既存機能が壊れていない
- 008 Bulk Launch の既存機能が壊れていない
- 009 Process Stop の既存機能が壊れていない
- 010 Runtime Status の既存機能が壊れていない
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

011 はログとエラー情報を扱うため、実装後に security-review を行う。

レビューでは最低限以下を確認する。

- ログに不要な個人情報や機密情報が出ていないか
- ログに環境変数が出ていないか
- ログに stack trace 全文が出ていないか
- 共有用サマリーに full path が出ていないか
- frontend から任意 path の読み書きができないか
- frontend から任意 SQL を実行できないか
- 外部通信や telemetry が追加されていないか
- Tauri capabilities / permissions が広がりすぎていないか
- 012 Windows Build 以降の範囲が混ざっていないか
