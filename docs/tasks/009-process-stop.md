# 009 Process Stop

## 目的

stream-dock に、stream-dock 経由で起動したプロセスだけを停止できる機能を追加する。

007 Process Launch で単体起動、008 Bulk Launch でプリセット一括起動ができるようになっている前提。

009 では、007 / 008 で起動したプロセスを安全に管理し、ユーザーが stream-dock から停止できるようにする。

最重要方針は以下。

- stream-dock 経由で起動したプロセスだけを停止する
- ユーザーが手動で起動した OBS などを勝手に停止しない
- frontend から任意 PID を渡して停止できる設計にしない
- OS の shell command 経由で停止しない
- 停止対象は Rust 側の runtime process registry に登録されたプロセスだけにする

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
  - 起動成功時に processId を取得できる

- 008 Bulk Launch
  - Preset に紐づく Tool を ordered / parallel に従って一括起動できる
  - 起動成功した Tool ごとに processId を取得できる
  - 成功件数・失敗件数を UI で確認できる

## このタスクでやること

- stream-dock 経由で起動したプロセスを Rust 側で管理する runtime process registry を追加する
- 007 の単体起動時に、起動したプロセスを registry に登録する
- 008 の一括起動時に、起動したプロセスを registry に登録する
- 起動結果に `launchId` を含める
- `launchId` を指定して、登録済みプロセスを停止できる Tauri command を追加する
- 選択中 Preset に紐づく起動済みプロセスをまとめて停止できる Tauri command を追加する
- React 側に process stop 用 API wrapper を追加する
- UI から単体停止できるようにする
- UI から選択中 Preset の起動済みプロセスをまとめて停止できるようにする
- 停止成功・停止失敗・すでに終了済みが UI で分かるようにする
- docs/progress.md を更新する

## このタスクでやらないこと

- 起動状態の本格的な常時監視
- waiting / starting / running / stopping / stopped / error の本格的な状態管理
- プロセスの死活監視ループ
- OS 再起動後やアプリ再起動後のプロセス復元
- PID だけを使った任意プロセス停止
- ユーザーが入力した PID の停止
- プロセスツリー全体の停止
- graceful shutdown
- アプリごとの安全な終了手順
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

## 009 の範囲

009 は、現在のアプリ起動セッション中に stream-dock が起動したプロセスを停止できるようにするタスク。

MVP では、アプリ再起動後に以前 stream-dock が起動したプロセスを停止する必要はない。

理由:

- アプリ再起動後は `std::process::Child` handle を安全に保持できない
- PID は再利用される可能性がある
- PID だけを保存して後から停止すると、別プロセスを誤停止する危険がある

そのため 009 では、Rust 側の current session runtime process registry に登録されているプロセスだけを停止対象にする。

## 停止対象の定義

停止対象にしてよいのは以下のみ。

- 007 の単体起動で stream-dock が起動したプロセス
- 008 の一括起動で stream-dock が起動したプロセス
- Rust 側の runtime process registry に登録されているプロセス
- `launchId` で特定できるプロセス

停止対象にしてはいけないものは以下。

- ユーザーが手動で起動した OBS
- ユーザーが手動で起動したワンコメ
- ユーザーが手動で起動した任意アプリ
- frontend から渡された任意 PID
- frontend から渡された任意 path
- frontend から渡された任意 command

## runtime process registry 方針

Rust 側に、現在のアプリ起動セッション中に stream-dock が起動したプロセスを管理する registry を追加する。

概念上は以下のような情報を保持する。

```rust
type LaunchId = String;

struct ManagedProcess {
    launch_id: String,
    tool_id: String,
    tool_name: String,
    preset_id: Option<String>,
    preset_item_id: Option<String>,
    process_id: u32,
    started_at: String,
    child: std::process::Child,
}
```

実際の型名・配置・日時型は既存実装に合わせる。

重要:

- 停止には raw PID ではなく `Child` handle を使う
- frontend から PID を受け取って kill しない
- registry は Rust 側に保持する
- frontend には停止操作用に `launchId` を返す
- `launchId` は Rust 側で生成する
- frontend が任意の `launchId` を渡しても、registry に存在しない場合は停止しない

## 起動結果への追加

007 / 008 の起動結果に `launchId` を追加する。

007 の単体起動結果は概念上以下。

```ts
type LaunchToolResult = {
  launchId: string;
  toolId: string;
  processId: number;
  startedAt: string;
};
```

008 の一括起動結果は概念上以下。

```ts
type BulkLaunchToolResult = {
  launchId?: string;
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

注意:

- 起動に失敗した Tool には `launchId` を付けない
- 起動に成功した Tool には `launchId` を付ける
- 009 では `launchId` を停止操作の識別子として使う

## 入力仕様

### 単体停止

frontend から渡してよい値は `launchId` のみ。

```ts
type StopProcessInput = {
  launchId: string;
};
```

frontend から `processId` を渡して停止してはいけない。

### Preset 単位停止

選択中 Preset に紐づく、現在のアプリ起動セッション中に起動したプロセスをまとめて停止する。

frontend から渡してよい値は `presetId` のみ。

```ts
type StopPresetProcessesInput = {
  presetId: string;
};
```

Rust 側で registry を検索し、その presetId に紐づく managed process だけを停止する。

## 出力仕様

### 単体停止結果

概念上は以下。

```ts
type StopProcessResult = {
  launchId: string;
  toolId: string;
  toolName: string;
  processId: number;
  status: "stopped" | "already-exited" | "not-found" | "failed";
  stoppedAt?: string;
  errorMessage?: string;
};
```

### Preset 単位停止結果

概念上は以下。

```ts
type StopPresetProcessesResult = {
  presetId: string;
  stoppedAt: string;
  totalCount: number;
  successCount: number;
  alreadyExitedCount: number;
  failureCount: number;
  results: StopProcessResult[];
};
```

実際の型名・命名は既存実装に合わせる。

## Rust 側バリデーション

最低限、Rust 側で以下を検証する。

- `launchId` が空ではない
- `launchId` が runtime process registry に存在する
- registry に存在しない `launchId` の場合は停止しない
- `presetId` が空ではない
- `presetId` に対応する Preset が存在する
- Preset 単位停止では、その `presetId` に紐づく managed process だけを対象にする
- frontend から渡された PID を使って停止しない
- frontend から渡された path を使って停止しない
- frontend から渡された command を使って停止しない

## 停止方法

停止には shell command を使わない。

以下は禁止。

```text
taskkill
kill
pkill
cmd /C
sh -c
powershell
```

Rust の `std::process::Child` handle に対して停止処理を行う。

方針:

- `child.try_wait()` で既に終了しているか確認する
- 既に終了している場合は `already-exited` として扱う
- まだ動いている場合は `child.kill()` を実行する
- 可能なら `child.wait()` で終了を回収する
- 成功したら `stopped` として扱う
- 失敗したら `failed` として扱う

## registry からの削除方針

停止成功または既に終了済みの場合は、registry から削除してよい。

停止失敗の場合は、実装方針に応じて以下のどちらかにする。

- registry に残して再停止できるようにする
- failed として記録し、UI 上で再試行できるようにする

MVP では複雑にしすぎない。

ただし、registry の状態が壊れないようにする。

## Tauri command 候補

既存の命名規則に合わせて最終決定する。

候補は以下。

```rust
stop_process
stop_preset_processes
```

または

```rust
stop_launched_process
stop_preset_launched_processes
```

責務は以下。

### stop_process

- launchId を受け取る
- runtime process registry から対象を探す
- registry に存在するプロセスだけを停止する
- 停止結果を返す

### stop_preset_processes

- presetId を受け取る
- runtime process registry から presetId に紐づくプロセスを探す
- 対象プロセスだけを停止する
- 停止結果を集約して返す

## service 方針

既存の 007 / 008 の process launch 実装に合わせる。

基本方針は以下。

- Tauri command は薄くする
- process management のロジックは service 層に寄せる
- runtime process registry は Rust 側で管理する
- 007 の単体起動処理から registry 登録を呼ぶ
- 008 の一括起動処理から registry 登録を呼ぶ
- 停止処理は registry を経由する
- 大規模なリファクタリングはしない

## React 側 API wrapper

React コンポーネントから Tauri command を直接呼ばない。

process stop 用 API wrapper を追加する。

候補は以下。

```ts
export async function stopProcess(launchId: string): Promise<StopProcessResult>;
export async function stopPresetProcesses(
  presetId: string,
): Promise<StopPresetProcessesResult>;
```

最終的な命名は既存の API wrapper 命名規則に合わせる。

## UI 接続

最低限、以下を満たす。

- 単体起動に成功した Tool に対して停止できる
- 一括起動に成功した Tool に対して停止できる
- 選択中 Preset の起動済みプロセスをまとめて停止できる
- 停止中は対象ボタンを disabled にする
- 停止成功時に成功メッセージを表示する
- 既に終了済みの場合は「既に終了済み」と分かる表示にする
- 停止失敗時にエラーメッセージを表示する
- エラー表示はユーザーが理解できる内容にする
- 詳細すぎる内部情報や環境情報は表示しない

## UI でやらないこと

009 では以下はやらない。

- 常時プロセス状態を監視する UI
- 自動的な running / stopped 更新
- 詳細ログ画面
- プロセスツリー表示
- PID をユーザーに入力させる UI
- 任意アプリを選んで停止する UI

## エラー例

最低限、以下のようなエラーを扱う。

- launchId が空
- launchId が存在しない
- 対象プロセスが既に終了している
- 停止に失敗した
- presetId が空
- Preset が存在しない
- Preset に紐づく起動済みプロセスがない

## セキュリティ制約

docs/security.md に従うこと。

特に以下を守る。

- 外部通信を追加しない
- frontend から直接 shell 実行しない
- frontend から自由なファイル操作をしない
- frontend から任意 PID を停止できる設計にしない
- frontend から任意 path を停止できる設計にしない
- frontend から任意 command を実行できる設計にしない
- 汎用的な `kill_process` を作らない
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
- frontend から渡された launchId を無条件に信用しない
- frontend から渡された presetId を無条件に信用しない
- ログに不要な個人情報や機密情報を出さない

## 009 で追加してはいけない command

以下のような汎用 command は追加しない。

```text
kill_process
kill_pid
stop_pid
terminate_pid
run_command
execute_shell
run_shell
write_file
delete_path
open_anything
```

009 で必要なのは、stream-dock が起動し、Rust 側 registry に登録した process を `launchId` で停止する限定的な command のみ。

## 008 以前への影響確認

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
- サイドバーのプリセットメタ情報
- メイン画面の選択中プリセット連動

## 完了条件

- 007 の単体起動で起動したプロセスが registry に登録される
- 008 の一括起動で起動したプロセスが registry に登録される
- 起動成功結果に `launchId` が含まれる
- `launchId` を使って単体停止できる
- 選択中 Preset に紐づく起動済みプロセスをまとめて停止できる
- frontend から PID を渡して停止する設計になっていない
- frontend から任意 command を渡して停止する設計になっていない
- frontend から任意 path を渡して停止する設計になっていない
- registry に存在しない process は停止できない
- ユーザーが手動起動した OBS などを停止できない
- shell command 経由で停止していない
- `std::process::Child` handle を使って停止している
- 停止成功・既に終了済み・停止失敗が区別できる
- UI から単体停止できる
- UI から Preset 単位停止できる
- 010 Runtime Status の本格的な状態監視を実装していない
- プロセスツリー停止を実装していない
- 危険な汎用 Tauri command を追加していない
- Tauri capabilities / permissions に不要な強権限を追加していない
- React 側に process stop 用 API wrapper がある
- React コンポーネントから直接 invoke を乱用していない
- 004 Tool Registry の既存機能が壊れていない
- 005 Preset CRUD の既存機能が壊れていない
- 006 Preset Item Ordering の既存機能が壊れていない
- 007 Process Launch の既存機能が壊れていない
- 008 Bulk Launch の既存機能が壊れていない
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

009 はプロセス停止が入るため、実装後に security-review を必ず行う。

レビューでは最低限以下を確認する。

- frontend から任意 PID を停止できないか
- registry にないプロセスを停止できないか
- ユーザーが手動起動したプロセスを停止できないか
- shell command 経由で停止していないか
- `taskkill` / `kill` / `pkill` / `cmd /C` / `sh -c` を使っていないか
- Tauri capabilities / permissions が広がりすぎていないか
- 010 Runtime Status 以降の範囲が混ざっていないか
