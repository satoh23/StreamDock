# Security Policy

## 目的

stream-dock は、ユーザーのPC上で動作し、外部アプリのパスを保存し、将来的にはプロセス起動・停止を行うデスクトップアプリである。

そのため、ユーザーのPCを壊さないこと、意図しないファイル操作やシェル操作を行わないこと、外部通信を勝手に行わないことを最重要方針とする。

## 基本方針

### 1. 外部通信をしない

MVPでは、stream-dock は外部サーバーと通信しない。

禁止するもの:

- telemetry
- analytics
- crash report の自動送信
- remote config
- cloud sync
- 外部API通信
- CDNからのscript/css/image読み込み
- ユーザーデータの外部送信

許可する可能性があるもの:

- ユーザーが明示的に押した「公式サイトを開く」ボタン
- 将来的なアップデート確認

ただし、MVPではこれらも原則実装しない。

### 2. frontendから自由なOS操作をさせない

React / TypeScript側から、自由なshell実行・自由なファイル操作・自由なプロセス操作を行わない。

禁止するもの:

- frontendから任意コマンドを組み立てて実行する
- frontendから任意のファイルを読み書きする
- frontendから任意パスを削除する
- frontendからshell pluginのexecute/openを自由に呼ぶ
- ユーザー入力をそのままコマンドラインに渡す

OS操作、ファイル操作、プロセス操作は、Rust/Tauri側で定義した限定的なcommandのみを経由する。

### 3. Tauri commandは最小権限にする

Tauri commandは、機能ごとに明示的に定義する。

例:

- `create_tool`
- `list_tools`
- `update_tool`
- `delete_tool`
- `launch_tool`
- `stop_tool`

禁止するcommand例:

- `run_command(command: string)`
- `execute_shell(input: string)`
- `write_file(path: string, content: string)`
- `delete_path(path: string)`
- `open_anything(pathOrUrl: string)`

つまり、汎用的で強すぎるcommandを作らない。

### 4. Shell実行は原則使わない

MVPでは、自由なshell実行は使わない。

外部アプリ起動が必要な場合は、Rust側で `std::process::Command` 等を使い、登録済みのTool情報に基づいて起動する。

禁止するもの:

- `cmd /C <user input>`
- `powershell <user input>`
- `sh -c <user input>`
- shell経由での文字列コマンド実行
- ユーザー入力を結合したコマンド実行

許可するもの:

- 登録済みの `executablePath` を、Rust側で検証したうえで起動する
- 引数が必要な場合も、文字列結合ではなく配列として明示的に渡す

### 5. ファイル操作はアプリ管理領域に限定する

MVPで許可するファイル操作は、原則としてアプリの管理領域内に限定する。

許可するもの:

- アプリ設定の保存
- SQLite DBの保存
- ログファイルの保存
- 将来的な設定バックアップファイルの保存

禁止するもの:

- 任意パスへの書き込み
- 任意パスの削除
- ユーザーのドキュメント、デスクトップ、ダウンロード配下を勝手に変更する
- 登録された外部アプリの設定ファイルを勝手に上書きする

将来的に設定ファイルのバックアップ・上書きを行う場合は、別タスクでセキュリティレビューを必須とする。

### 6. プロセス停止はstream-dock経由で起動したPIDに限定する

MVPでは、停止対象は stream-dock 経由で起動し、PIDを保持しているプロセスのみとする。

禁止するもの:

- process nameだけでkillする
- OBSなどの有名アプリ名を見つけて勝手に停止する
- ユーザーが手動で起動したプロセスを停止する
- 管理者権限で強制停止する

許可するもの:

- stream-dockが起動したPIDを停止する
- 停止できなかった場合にエラーを表示する

### 7. パス入力は検証する

ツール登録時の `executablePath` は、Rust側で最低限検証する。

確認項目:

- 空文字ではない
- 前後の空白をtrimする
- 重複登録を防ぐ
- 危険な制御文字を含まない
- 将来的には拡張子や存在チェックを行う

MVPでは、存在しないパスを保存するかどうかはタスクごとに判断してよいが、起動時には必ずエラーとして扱う。

### 8. ユーザー入力を信頼しない

frontend側でバリデーションしていても、Rust側でも必ず検証する。

対象:

- ツール名
- 実行ファイルパス
- 説明
- アイコンラベル
- プリセット名
- 起動順
- launchMode
- toolId
- presetId

### 9. ログに機密情報を出しすぎない

ログには、デバッグに必要な情報だけを書く。

避けるもの:

- 不必要なフルパスの大量出力
- 環境変数
- ユーザー名を含む情報の過剰出力
- 将来的な認証情報
- 外部送信

MVPではログはローカル保存のみとし、外部送信しない。

### 10. 依存関係を増やしすぎない

新しいnpm package、Rust crate、Tauri pluginを追加する場合は、理由を説明する。

特に注意するもの:

- shell操作系
- file system操作系
- auto update系
- network/http系
- telemetry系
- updater系
- plugin経由で強い権限を要求するもの

## Tauri Permissions / Capabilities 方針

Tauriのpermissions/capabilitiesは最小限にする。

方針:

- `shell:default` のような広い権限を安易に許可しない
- `fs:default` のような広い権限を安易に許可しない
- 使っていないplugin権限をcapabilitiesに追加しない
- frontendから呼べるcommandを必要最小限にする
- 危険なscopeを広げない

## CSP方針

MVPでは外部リソースを読み込まない。

方針:

- 外部scriptを読み込まない
- 外部styleを読み込まない
- 外部imageを読み込まない
- inline scriptを増やさない
- remote domain IPCを使わない

## レビュー必須条件

以下を変更する場合は、必ずセキュリティレビューを行う。

- Tauri capabilities
- shell plugin
- filesystem plugin
- opener plugin
- process起動処理
- process停止処理
- ファイル読み書き処理
- ログ出力処理
- 外部通信
- 自動アップデート
- 設定ファイルのバックアップ・上書き
- ユーザー入力をOS操作に渡す処理

## 004 Tool Registry時点のレビュー観点

004では、以下を確認する。

- frontendから直接shell実行していない
- frontendから直接ファイル操作していない
- Tool保存処理がRust/Tauri側に寄っている
- Tool入力値をRust側でも検証している
- executablePathを保存するだけで、まだ起動していない
- 同じexecutablePathの重複登録を防いでいる
- 保存先がアプリ管理領域内である
- 外部通信を追加していない
- capabilitiesに不要な強権限を追加していない
- 003 App Shellの見た目を大きく壊していない
