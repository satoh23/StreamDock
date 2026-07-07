# 013 macOS App Bundle Stop

## 目的

macOS の `.app`（アプリバンドル）を stream-dock から**実際に停止**できるようにする。

009 Process Stop では、stream-dock 経由で起動したプロセスを Rust 側 runtime process registry の
`std::process::Child` ハンドル経由で停止できるようにした。しかし macOS の `.app` については、
009 の時点では実アプリを停止できない**既知の縮退**が残っている。013 でこれを解消する。

## 背景（なぜ 009 で対応しなかったか）

007 Process Launch / 008 Bulk Launch は、macOS の `.app` を `/usr/bin/open` 経由で起動している
（`.app` はディレクトリなので直接 exec できず、LaunchServices 起動が正規経路のため）。

このため 009 の registry が掴む `Child` は、起動した実アプリではなく**即座に終了する `open` ヘルパ**の
ものになる。結果として:

- `stop_process` / `stop_preset_processes` は `child.try_wait()` で「既に終了済み（already-exited）」と判定する
- 実アプリのプロセスは registry に載っておらず、停止できない

これに正しく対応するには 007/008 の**起動処理**へ手を入れる必要があり、009（停止機能）の
スコープと実装リスクが広がる。**性能・品質のため 009 のスコープを狭める**判断として、macOS `.app` の
実停止対応を本タスク 013 に切り出した。

なお Windows(`.exe`)/Linux の直接 spawn 経路では `Child` が実プロセスなので、009 の停止機能で
正しく停止できている（本命ターゲットは Windows）。

## このタスクでやること

- macOS の `.app` について、stream-dock が起動した実アプリを停止できるようにする
- 009 の registry / `stop_process` / `stop_preset_processes` の枠組みはそのまま活かす
- macOS `.app` を起動 → 停止で、実アプリが実際に終了することを確認する

## 想定アプローチ（いずれか / 実装時に比較して決める）

- (a) **バンドル内実体バイナリの直接 spawn**: 起動時に `Contents/MacOS/<CFBundleExecutable>` を解決し、
  `/usr/bin/open` ではなくその実体バイナリを直接 `std::process::Command` で spawn する。
  掴める `Child` が実アプリになるため、009 の Child 停止がそのまま効く。
  - トレードオフ: 007/008 の起動処理を変更する必要がある。LaunchServices を介さないため、
    単一インスタンス制御・アクティベーション・一部アプリのバンドル文脈依存挙動が変わる可能性がある。
    `CFBundleExecutable` の解決方法（Info.plist パース＝新規 crate 検討 / `Contents/MacOS/` の
    ヒューリスティック）を決める必要がある。
- (b) **実アプリ PID の解決**: `open` 起動の前後で LaunchServices の差分を取る、あるいは
  起動時刻＋バンドルパスで実アプリ PID を照合して registry に載せる。
  - トレードオフ: 実装が複雑。PID 再利用・誤検知の回避を慎重に設計する必要がある。

## このタスクでやらないこと

- プロセスツリー全体の停止
- graceful shutdown / アプリごとの安全な終了手順
- 常時死活監視ループ（010 Runtime Status の範囲）
- Windows/Linux 起動経路の変更（009 で正しく停止できているため不要）
- OS 再起動後・アプリ再起動後のプロセス復元

## セキュリティ制約（docs/security.md 準拠）

- shell を経由して停止・起動しない（`taskkill` / `kill` / `pkill` / `cmd /C` / `sh -c` / `powershell` 禁止）
- frontend から任意 PID / path / command を渡して停止・起動できる設計にしない
- 停止対象は Rust 側 registry に登録されたプロセスに限定する
- 起動時の `executablePath` 検証（絶対パス・実在・拡張子）は 007/008 の方針を維持する
- 起動引数を渡す実装を入れる場合は、文字列連結ではなく配列で明示的に渡す
- 起動処理を変更するため、実装後に security-review を必須とする

## 完了条件

- macOS `.app` を stream-dock から起動 → 単体停止 / Preset 単位停止で**実アプリが終了する**
- 007 / 008 / 009 の既存機能を壊していない（Windows/Linux の起動・停止挙動は不変）
- 危険な汎用 command を追加していない / Tauri capabilities に不要な強権限を追加していない
- `cargo check` / `pnpm typecheck` / `pnpm lint` が通る
- docs/progress.md が更新されている
