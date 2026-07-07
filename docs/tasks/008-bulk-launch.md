# 008 Bulk Launch

## 目的

stream-dock に、選択中プリセット内のツールをまとめて起動する機能を追加する。

007 Process Launch までで、登録済み Tool を単体起動できるようになっている前提。

008 では、006 Preset Item Ordering で保存した PresetItem の構成を使い、選択中 Preset に紐づく Tool を ordered / parallel の設定に従って一括起動できるようにする。

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
  - frontend からは原則 toolId を渡す
  - Rust 側で Tool を取得し、executablePath を検証して起動する
  - 起動成功時に processId を取得できる

## このタスクでやること

- Preset を指定して、紐づく enabled な PresetItem を一括起動する Tauri command を追加する
- Rust 側で presetId から Preset / PresetItem / Tool を取得する
- Rust 側で起動対象の Tool を検証する
- ordered の PresetItem を orderIndex 昇順で順番に起動する
- parallel の PresetItem をまとめて並行起動する
- 一括起動の結果として、成功した Tool と失敗した Tool を返す
- React 側に bulk launch 用 API wrapper を追加する
- メイン画面の選択中プリセットから一括起動できるようにする
- 起動中は一括起動ボタンを disabled にする
- 起動成功・一部失敗・全失敗が UI で分かるようにする
- 007 の単体起動ロジックを可能な限り再利用する
- docs/progress.md を更新する

## このタスクでやらないこと

- プロセス停止
- 起動状態監視
- waiting / starting / running / stopping / stopped / error の本格的な状態管理
- ツールが完全に起動しきったかどうかの検知
- アプリウィンドウが表示されたかどうかの検知
- プロセスの死活監視
- 起動後の自動リトライ
- 起動後のログ詳細画面
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

## 008 の範囲

008 は、あくまで「選択中プリセット内の登録済みツールをまとめて起動する」機能に限定する。

以下は 008 の範囲外。

- 起動したプロセスを止めること
- 起動中・停止中・エラーなどをリアルタイム監視すること
- プリセット実行履歴を詳細に管理すること
- 起動ログ画面を作ること
- ユーザーが任意の起動引数を指定できるようにすること
- ユーザーが任意の working directory を指定できるようにすること

## 起動順の定義

PresetItem の launchMode は以下の意味で扱う。

- `ordered`
  - 起動順が重要なツール
  - orderIndex 昇順で 1 つずつ起動する

- `parallel`
  - 起動順が重要ではないツール
  - まとめて並行起動する

MVP では、分かりやすさを優先して以下の順序で実行する。

1. enabled な ordered items を orderIndex 昇順で順番に起動する
2. enabled な parallel items をまとめて並行起動する

注意:

- ordered の「起動完了」は、アプリが完全に起動しきったことではなく、OS プロセスの spawn に成功したことを意味する
- 008 ではアプリの起動完了検知はしない
- 008 ではツールごとの起動待機秒数は実装しない
- 008 では launch group の概念は追加しない

## エラー方針

008 では best-effort で起動する。

つまり、1つの Tool の起動に失敗しても、可能な限り他の Tool の起動は続行する。

ただし、以下の場合は一括起動自体を開始しない。

- presetId が空
- Preset が存在しない
- Preset に enabled な PresetItem が存在しない

各 Tool の起動失敗は、結果に failure として含める。

すでに起動に成功したプロセスを、008 の中で停止しない。

停止処理は 009 Process Stop で扱う。

## 入力仕様

frontend から渡してよい値は原則として `presetId` のみ。

```ts
type BulkLaunchPresetInput = {
  presetId: string;
};
```

frontend から Tool の executablePath、任意コマンド文字列、任意のパス、任意の引数配列を渡してはいけない。

## 出力仕様

起動結果は、成功・失敗が分かる形で返す。

既存の 007 の型や実装に合わせて最終決定するが、概念上は以下のような形を想定する。

```ts
type BulkLaunchPresetResult = {
  presetId: string;
  startedAt: string;
  finishedAt: string;
  totalCount: number;
  successCount: number;
  failureCount: number;
  results: BulkLaunchToolResult[];
};

type BulkLaunchToolResult = {
  presetItemId: string;
  toolId: string;
  toolName: string;
  launchMode: "ordered" | "parallel";
  orderIndex: number;
  success: boolean;
  processId?: number;
  startedAt?: string;
  errorMessage?: string;
};
```

エラー表示に使う message は、安全な内容にする。

環境変数、不要なローカルパス詳細、内部スタックトレース、個人情報は UI に出さない。

## Rust 側で確認すること

Rust 側では最低限以下を検証する。

- presetId が空ではない
- presetId に対応する Preset が存在する
- Preset に enabled な PresetItem が存在する
- PresetItem に対応する Tool が存在する
- Tool の executablePath が空ではない
- executablePath が絶対パスである
- executablePath が存在する
- executablePath がディレクトリではない
- 008 では `.lnk` を起動対象にしない
- 008 では `.bat` を起動対象にしない
- 008 では shell を経由しない
- 008 では任意のコマンド文字列を組み立てない
- 008 では frontend から executablePath を受け取らない
- 008 では frontend から起動引数を受け取らない
- 008 では frontend から working directory を受け取らない

## 起動方法

007 Process Launch で実装した単体起動ロジックを可能な限り再利用する。

方針は以下。

- Tool 起動処理は共通 service に寄せる
- bulk launch 側では PresetItem の取得、並び替え、起動順制御、結果集約を担当する
- shell 経由ではなく、保存済み executablePath を直接起動する
- `cmd /C` は使わない
- `sh -c` は使わない
- 文字列連結でコマンドを作らない
- 汎用 command 実行機能を作らない

## PID の扱い

007 で起動成功時に processId を取得できるようになっている前提。

008 でも、起動成功した Tool ごとに processId を結果へ含める。

009 Process Stop では、stream-dock 経由で起動した PID だけを停止対象にする予定。

そのため、007 で起動記録や PID 管理の仕組みを追加している場合は、008 でも同じ仕組みに合わせる。

ただし、008 では停止処理や死活監視は実装しない。

## Tauri command 候補

既存の命名規則に合わせて最終決定する。

候補は以下。

```rust
launch_preset
```

または

```rust
bulk_launch_preset
```

想定する責務は以下。

- presetId を受け取る
- Preset の存在を確認する
- PresetItem を取得する
- enabled な PresetItem を起動対象にする
- Tool を取得する
- ordered items を順番に起動する
- parallel items を並行起動する
- 起動結果を集約して返す

## service / repository 方針

既存の 004 Tool Registry / 005 Preset CRUD / 006 Preset Item Ordering / 007 Process Launch の構成に合わせる。

基本方針は以下。

- Tauri command は薄くする
- 一括起動ロジックは service 層に寄せる
- Tool の起動処理は 007 の service を再利用する
- Preset / PresetItem / Tool の取得は既存 repository / service を使う
- 必要なら bulk launch 用 service を追加する
- 必要なら bulk launch result 用 model を追加する
- 大規模なリファクタリングはしない

## React 側 API wrapper

React コンポーネントから Tauri command を直接呼ばない。

007 の Tool 起動 API wrapper と同じ方針で、bulk launch 用 API wrapper を追加する。

候補は以下。

```ts
export async function launchPreset(
  presetId: string,
): Promise<BulkLaunchPresetResult>;
```

または

```ts
export async function bulkLaunchPreset(
  presetId: string,
): Promise<BulkLaunchPresetResult>;
```

最終的な命名は既存の API wrapper 命名規則に合わせる。

## UI 接続

メイン画面の選択中 Preset に対して、一括起動ボタンを接続する。

最低限、以下を満たす。

- Preset が選択されている場合、一括起動できる
- Preset が未選択の場合、一括起動できない
- Preset に Tool がない場合、一括起動できない
- enabled な PresetItem がない場合、一括起動できない
- 起動中は一括起動ボタンを disabled にする
- 起動成功時に成功メッセージを表示する
- 一部失敗時に一部失敗メッセージを表示する
- 全失敗時に失敗メッセージを表示する
- 失敗した Tool 名が分かるようにする
- 詳細すぎる内部情報や環境情報は表示しない

## UI で表示する結果

最低限、以下が分かればよい。

- 何件中何件起動に成功したか
- 失敗した Tool があるか
- 失敗した Tool の名前
- 失敗理由の簡潔な説明

008 では詳細なログ画面は作らない。

詳細ログ整備は 011 Error Handling / Logs で扱う。

## 008 で追加してはいけない command

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
launch_tools_by_paths
bulk_launch_paths
```

008 で必要なのは、登録済み Preset を presetId で起動する限定的な command のみ。

## セキュリティ制約

docs/security.md に従うこと。

特に以下を守る。

- 外部通信を追加しない
- frontend から直接 shell 実行しない
- frontend から自由なファイル操作をしない
- frontend から任意パスを起動できる設計にしない
- frontend から任意コマンドを実行できる設計にしない
- frontend から起動引数を渡せる設計にしない
- frontend から working directory を渡せる設計にしない
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
- frontend から渡された presetId を無条件に信用しない
- PresetItem に紐づく toolId を無条件に信用しない
- Tool に保存された executablePath も無条件に信用しない
- ログに不要な個人情報や機密情報を出さない

## 007 以前への影響確認

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
- サイドバーのプリセットメタ情報
- メイン画面の選択中プリセット連動

## 完了条件

- 選択中 Preset の Tool を一括起動できる
- frontend からは presetId のみを渡している
- Rust 側で Preset を取得している
- Rust 側で PresetItem を取得している
- Rust 側で Tool を取得している
- Rust 側で executablePath を検証している
- ordered items を orderIndex 昇順で順番に起動している
- parallel items をまとめて並行起動している
- shell を経由せずに起動している
- 起動成功した Tool ごとに processId を取得できる
- 一括起動の成功件数・失敗件数が分かる
- 起動失敗した Tool が UI で分かる
- 起動中は一括起動ボタンが disabled になる
- 一括起動後に成功・一部失敗・全失敗の結果が分かる
- 008 の範囲外である停止処理を実装していない
- 008 の範囲外である状態監視を実装していない
- 008 の範囲外である `.lnk` 解決を実装していない
- 008 の範囲外である `.bat` 対応を実装していない
- 危険な汎用 Tauri command を追加していない
- Tauri capabilities / permissions に不要な強権限を追加していない
- React 側に bulk launch 用 API wrapper がある
- React コンポーネントから直接 invoke を乱用していない
- 004 Tool Registry の既存機能が壊れていない
- 005 Preset CRUD の既存機能が壊れていない
- 006 Preset Item Ordering の既存機能が壊れていない
- 007 Process Launch の既存機能が壊れていない
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

008 は OS プロセス操作を複数件まとめて実行するため、実装後に security-review を必ず行う。

レビューでは最低限以下を確認する。

- shell 経由になっていないか
- frontend から任意パスを起動できないか
- frontend から任意コマンドを実行できないか
- frontend から任意の起動引数を渡せないか
- Tauri capabilities / permissions が広がりすぎていないか
- `.lnk` / `.bat` / 停止処理 / 状態監視など 008 の範囲外が混ざっていないか
- 009 Process Stop に進む前に PID の扱いが破綻していないか
