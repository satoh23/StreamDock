# 010 Runtime Status

## 目的

stream-dock に、起動済みプロセスの現在状態を UI に反映する機能を追加する。

009 Process Stop までで、stream-dock 経由で起動したプロセスを Rust 側の runtime process registry で管理し、`launchId` を使って停止できるようになっている前提。

010 では、その runtime process registry をもとに、各 Tool / PresetItem の状態を UI 上で分かるようにする。

主な状態は以下。

- waiting
- starting
- running
- stopping
- stopped
- error

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

- 009 Process Stop
  - stream-dock 経由で起動したプロセスを runtime process registry で管理できる
  - 起動成功結果に launchId が含まれる
  - launchId を使って単体停止できる
  - 選択中 Preset に紐づく起動済みプロセスをまとめて停止できる
  - frontend から任意 PID を渡して停止できない設計になっている

## このタスクでやること

- runtime process registry の状態を取得する Tauri command を追加する
- Rust 側で registry 内プロセスの状態を確認できるようにする
- `std::process::Child::try_wait()` を使って、既に終了したプロセスを検知する
- React 側に runtime status 用 API wrapper を追加する
- メイン画面の選択中 Preset 内 Tool / PresetItem に状態バッジを表示する
- 起動ボタン / 停止ボタンの表示・disabled 状態を runtime status に合わせる
- 単体起動後に状態が running と分かるようにする
- 一括起動後に各 Tool の状態が running / error と分かるようにする
- 停止後に stopped / already exited が分かるようにする
- 必要に応じて UI 側で軽い状態再取得を行う
- docs/progress.md を更新する

## このタスクでやらないこと

- OS 再起動後やアプリ再起動後のプロセス復元
- PID だけを使った任意プロセス監視
- ユーザーが入力した PID の監視
- stream-dock 経由で起動していないプロセスの監視
- プロセスツリー全体の監視
- プロセスツリー全体の停止
- graceful shutdown
- アプリごとの安全な終了手順
- 起動完了の厳密な検知
- ウィンドウ表示完了の検知
- CPU / メモリ使用量の取得
- 詳細なログ画面
- 永続的な起動履歴DB
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

## 010 の範囲

010 は、現在のアプリ起動セッション中に stream-dock が起動したプロセスの状態を UI に反映するタスク。

MVP では、アプリ再起動後に過去の起動状態を復元する必要はない。

理由:

- アプリ再起動後は `std::process::Child` handle を安全に保持できない
- PID は再利用される可能性がある
- PID だけを保存して後から状態確認すると、別プロセスを誤認する危険がある

そのため 010 では、Rust 側の current session runtime process registry に存在するプロセスだけを状態確認対象にする。

## 状態の定義

010 では以下の status を扱う。

```ts
type RuntimeProcessStatus =
  | "waiting"
  | "starting"
  | "running"
  | "stopping"
  | "stopped"
  | "error";
```

それぞれの意味は以下。

## waiting

まだ stream-dock から起動していない状態。

主に UI 側で、PresetItem は存在するが対応する起動済み process がない場合に表示する。

## starting

起動操作を実行中の状態。

主に UI 側で、launch command の Promise が完了するまでの一時状態として扱う。

Rust 側 registry に必ず永続保持する必要はない。

## running

stream-dock 経由で起動され、runtime process registry 上でまだ終了していない状態。

Rust 側で `child.try_wait()` が `None` を返す状態。

## stopping

停止操作を実行中の状態。

主に UI 側で、stop command の Promise が完了するまでの一時状態として扱う。

Rust 側 registry に必ず永続保持する必要はない。

## stopped

stream-dock 経由で起動されたが、すでに終了した状態。

Rust 側で `child.try_wait()` が終了状態を返した場合、または 009 の停止処理が成功した場合に扱う。

## error

起動または停止に失敗した状態。

エラー内容は UI で理解できる簡潔な message にする。

内部スタックトレース、環境変数、不要なローカルパス詳細、個人情報は出さない。

## RuntimeProcess の出力仕様

Rust 側から frontend に返す runtime process の概念上の型は以下。

```ts
type RuntimeProcess = {
  launchId: string;
  toolId: string;
  toolName: string;
  presetId?: string;
  presetItemId?: string;
  processId: number;
  status: RuntimeProcessStatus;
  startedAt: string;
  updatedAt: string;
  endedAt?: string;
  errorMessage?: string;
};
```

実際の型名・配置・日時型は既存実装に合わせる。

## Tauri command 候補

既存の命名規則に合わせて最終決定する。

候補は以下。

```rust
list_runtime_processes
list_preset_runtime_processes
get_runtime_process
refresh_runtime_processes
```

最低限必要なのは以下。

```rust
list_runtime_processes
list_preset_runtime_processes
```

責務は以下。

## list_runtime_processes

- runtime process registry の全 managed process を取得する
- `try_wait()` で終了済み process を更新する
- frontend 表示用の runtime process 一覧を返す

## list_preset_runtime_processes

- presetId を受け取る
- presetId が空でないことを検証する
- runtime process registry から presetId に紐づく managed process だけを取得する
- `try_wait()` で終了済み process を更新する
- frontend 表示用の runtime process 一覧を返す

## get_runtime_process

必要なら追加してよい。

- launchId を受け取る
- registry に存在する runtime process を返す
- registry に存在しない場合は not found として扱う
- 任意 PID で検索しない

## refresh_runtime_processes

必要なら追加してよい。

- registry 内の process に対して `try_wait()` を実行する
- 終了済みの process の status を stopped に更新する
- frontend 表示用に最新状態を返す

ただし、MVP では command を増やしすぎない。

既存構成に合うなら、`list_runtime_processes` / `list_preset_runtime_processes` の中で refresh を行ってよい。

## Rust 側で確認すること

Rust 側では最低限以下を守る。

- runtime process registry に登録された process だけを状態確認する
- frontend から任意 PID を受け取って状態確認しない
- frontend から任意 path を受け取って状態確認しない
- frontend から任意 command を受け取って状態確認しない
- 状態確認に shell command を使わない
- `tasklist` を使わない
- `ps` を使わない
- `pgrep` を使わない
- `cmd /C` を使わない
- `sh -c` を使わない
- `powershell` を使わない
- `std::process::Child::try_wait()` を使って状態を確認する
- registry に存在しない launchId / process は running として扱わない
- アプリ再起動後の PID 復元はしない

## registry の更新方針

010 では registry に status を持たせてもよい。

概念上は以下。

```rust
enum RuntimeProcessStatus {
    Running,
    Stopped,
    Error,
}

struct ManagedProcess {
    launch_id: String,
    tool_id: String,
    tool_name: String,
    preset_id: Option<String>,
    preset_item_id: Option<String>,
    process_id: u32,
    started_at: String,
    updated_at: String,
    ended_at: Option<String>,
    status: RuntimeProcessStatus,
    child: Option<std::process::Child>,
    error_message: Option<String>,
}
```

実際の型は既存の 009 実装に合わせる。

重要:

- stopped になった process を即削除するか、registry に残すかは既存 009 実装に合わせる
- UI で stopped を表示したい場合は、少なくとも停止直後の結果として stopped を返す
- registry に stopped process を残す場合、Child handle は不要になった後に保持し続けない
- registry の整合性を壊さない
- 大規模な作り直しはしない

## UI 方針

メイン画面の選択中 Preset 内 Tool / PresetItem に状態バッジを表示する。

最低限、以下が分かるようにする。

- 未起動
- 起動中
- 起動済み
- 停止中
- 停止済み
- エラー

表示文言の例。

```text
未起動
起動中
起動中
停止中
停止済み
エラー
```

英語UIがある場合は既存の i18n 方針に合わせる。

## UI の操作制御

状態に応じて、ボタンの表示・disabled を切り替える。

最低限の方針は以下。

## waiting

- 起動ボタンを表示する
- 停止ボタンは disabled または非表示

## starting

- 起動ボタンを disabled にする
- 停止ボタンも disabled でよい

## running

- 起動ボタンは disabled または「起動済み」と分かる表示にする
- 停止ボタンを表示する

## stopping

- 起動ボタンを disabled にする
- 停止ボタンを disabled にする

## stopped

- 起動ボタンを再度押せるようにする
- 停止ボタンは disabled または非表示

## error

- 起動ボタンを再度押せるようにする
- 停止ボタンは状態に応じて disabled または非表示
- エラー内容を簡潔に表示する

## 状態再取得

MVP では複雑な監視ループを作らない。

以下のタイミングで状態を再取得する。

- 画面初期表示時
- Preset 選択変更時
- 単体起動成功後
- 一括起動成功後
- 単体停止後
- Preset 単位停止後
- ユーザーが必要に応じて再取得する場合

必要なら、UI 表示中のみ軽い polling を追加してよい。

ただし、以下を守る。

- 過度に短い間隔で polling しない
- 1秒未満の高頻度 polling はしない
- polling のために外部通信しない
- stream-dock 経由で起動していないプロセスを監視しない
- 大規模な状態管理ライブラリを追加しない

MVP では 3秒から5秒程度の UI 表示中 polling までなら許容する。

ただし、既存実装がシンプルなら、明示的な再取得だけでもよい。

## React 側 API wrapper

React コンポーネントから Tauri command を直接呼ばない。

runtime status 用 API wrapper を追加する。

候補は以下。

```ts
export async function listRuntimeProcesses(): Promise<RuntimeProcess[]>;
export async function listPresetRuntimeProcesses(
  presetId: string,
): Promise<RuntimeProcess[]>;
```

必要なら以下も追加してよい。

```ts
export async function getRuntimeProcess(
  launchId: string,
): Promise<RuntimeProcess>;
```

最終的な命名は既存の API wrapper 命名規則に合わせる。

## 007 / 008 / 009 との連携

010 では、007 / 008 / 009 の結果を UI 状態へ反映する。

最低限、以下を行う。

- 単体起動成功後、対象 Tool / PresetItem を running 表示にする
- 一括起動成功後、成功した Tool / PresetItem を running 表示にする
- 起動失敗した Tool / PresetItem を error 表示にする
- 単体停止成功後、対象 Tool / PresetItem を stopped 表示にする
- Preset 単位停止後、対象 Tool / PresetItem を stopped / error 表示にする
- 既に終了済みだった場合、stopped 表示にする

## 複数起動の扱い

同じ Tool / PresetItem が複数回起動される可能性がある。

MVP では複雑にしすぎない。

方針は以下のどちらかにする。

- 同じ PresetItem の running process がある場合、起動ボタンを disabled にして重複起動を防ぐ
- 複数起動を許可する場合、最新の launchId を代表として UI に表示する

推奨は、MVP では同じ PresetItem の running process がある場合は重複起動を防ぐこと。

ただし、既存 007 / 008 実装との整合性を優先する。

## セキュリティ制約

docs/security.md に従うこと。

特に以下を守る。

- 外部通信を追加しない
- frontend から直接 shell 実行しない
- frontend から自由なファイル操作をしない
- frontend から任意 PID を監視できる設計にしない
- frontend から任意 PID を停止できる設計にしない
- frontend から任意 path を渡せる設計にしない
- frontend から任意 command を実行できる設計にしない
- 汎用的な `check_process` を作らない
- 汎用的な `watch_process` を作らない
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
- frontend から渡された launchId / presetId を無条件に信用しない
- ログに不要な個人情報や機密情報を出さない

## 010 で追加してはいけない command

以下のような汎用 command は追加しない。

```text
check_process
watch_process
list_os_processes
get_process_by_pid
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

010 で必要なのは、stream-dock が起動し、Rust 側 registry に登録した process の状態を返す限定的な command のみ。

## 009 以前への影響確認

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
- サイドバーのプリセットメタ情報
- メイン画面の選択中プリセット連動

## 完了条件

- runtime process registry の状態を取得できる
- registry に登録された process の running / stopped を判定できる
- `std::process::Child::try_wait()` を使って終了済み process を検知できる
- frontend から任意 PID を渡して状態確認する設計になっていない
- shell command 経由で状態確認していない
- UI に waiting / starting / running / stopping / stopped / error が表示される
- 選択中 Preset 内 Tool / PresetItem の状態が分かる
- 単体起動後に running 表示になる
- 一括起動後に成功した Tool が running 表示になる
- 起動失敗した Tool が error 表示になる
- 単体停止後に stopped 表示になる
- Preset 単位停止後に stopped / error 表示になる
- running 中の Tool / PresetItem は停止できる
- waiting / stopped / error の Tool / PresetItem は再起動できる
- 起動中 / 停止中は対象ボタンが disabled になる
- 危険な汎用 Tauri command を追加していない
- Tauri capabilities / permissions に不要な強権限を追加していない
- React 側に runtime status 用 API wrapper がある
- React コンポーネントから直接 invoke を乱用していない
- 004 Tool Registry の既存機能が壊れていない
- 005 Preset CRUD の既存機能が壊れていない
- 006 Preset Item Ordering の既存機能が壊れていない
- 007 Process Launch の既存機能が壊れていない
- 008 Bulk Launch の既存機能が壊れていない
- 009 Process Stop の既存機能が壊れていない
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

010 は runtime process registry とプロセス状態確認が入るため、実装後に security-review を行う。

レビューでは最低限以下を確認する。

- frontend から任意 PID を監視できないか
- frontend から任意 PID を停止できないか
- registry にないプロセスを状態確認対象にしていないか
- ユーザーが手動起動したプロセスを監視対象にしていないか
- shell command 経由で状態確認していないか
- `tasklist` / `ps` / `pgrep` / `cmd /C` / `sh -c` / `powershell` を使っていないか
- Tauri capabilities / permissions が広がりすぎていないか
- 011 Error Handling / Logs 以降の範囲が混ざっていないか
