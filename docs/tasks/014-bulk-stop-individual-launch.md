# 014 Bulk Stop for Individual Launches

## 目的

プリセット画面で**個別起動**したツールを、「一括停止」ボタンで停止できるようにする。

現状、プリセットのメイン画面でツールを 1 つずつ個別起動したあとに「一括停止」を押しても、
それらのプロセスが停止されない。ユーザーの期待（選択中プリセットの文脈で起動したツールは
一括停止で止まる）に反しているため、014 でこれを解消する。

## 現在の前提

以下は完了済み。

- 007 Process Launch
  - 登録済み Tool を単体起動できる（`launch_tool`）
- 008 Bulk Launch
  - 選択中 Preset のツールを一括起動できる（`launch_preset`）
- 009 Process Stop
  - 単体停止（`stop_process`）／Preset 単位停止（`stop_preset_processes`）ができる
  - 停止対象は Rust 側 runtime process registry（`ManagedProcess`）に載っているプロセスに限定
- 010 Runtime Status / 013 macOS App Bundle Stop
  - registry 経由で状態表示・実アプリ停止ができる

registry の `ManagedProcess` は `preset_id: Option<String>` と `preset_item_id: Option<String>` を
保持している。

## 根本原因（確認済み）

- `apps/desktop/src-tauri/src/process/commands.rs` の `launch_tool` は、単体起動時に
  `service::register(..., None, preset_item_id, ...)` として **`preset_id = None` で登録**している
  （008 の一括停止スコープを変えない、という当時の意図的な判断）。
- `stop_preset_processes` は registry を `mp.preset_id.as_deref() == Some(preset_id)` で絞り込むため、
  `preset_id = None` の個別起動プロセスは**一括停止の対象に一切入らない**。
- 一方、プリセットのメイン画面からの個別起動（ToolRow の起動ボタン）は `preset_item_id` を渡している
  （`launch_tool(toolId, preset_item_id)`）。つまり所属プリセットは特定可能なのに、その情報が
  `preset_id` へ反映されていないだけ。
- サイドバーからの個別起動（プリセット文脈なし）は `preset_item_id` を渡していない。

## このタスクでやること

- `launch_tool` において、`preset_item_id` が `Some` のとき、Tool 取得と同じ DB ロック内で
  `preset_items::repository::get` により所属 `preset_id` を解決し、
  `service::register(..., Some(preset_id), preset_item_id, ...)` で登録する。
- 解決に失敗（該当 preset_item が無い等）した場合は `None` にフォールバックし、**起動自体は失敗させない**。
- これにより、`stop_preset_processes`（無改修）が個別起動プロセスも一括停止できるようになることを確認する。
- `launch_tool` の doc コメント（現状「preset_id は None のまま」と明記している箇所）を実態に合わせて更新する。
- docs/progress.md を更新する。

## 想定アプローチ（推奨: 登録時に preset_id を解決）

登録時に `preset_id` を確定させる方式を推奨する（stop 側で join する案より堅牢）。

- 起動時点で `preset_id` を registry に確定保存するため、後で preset_item が削除されても一括停止できる。
- `stop_preset_processes` に DB 参照を足さずに済み、変更が `launch_tool` 一箇所に閉じる。
- `process/service.rs::register` は既に `preset_id: Option<String>` を受け取るため無改修。

代替案（`stop_preset_processes` 側で `preset_item_id → preset_id` を join）は、停止のたびに DB 往復が増え、
preset_item 削除済みケースで解決できず取りこぼす懸念があるため採用しない。

## このタスクでやらないこと

- サイドバー等**プリセット文脈のない個別起動**を一括停止の対象にすること（従来どおり対象外）
- `stop_preset_processes` のフィルタロジック変更
- frontend から任意 PID / path を渡して停止できる設計
- 外部プロセス（stream-dock 非起動）の停止
- Windows / Linux / macOS の停止・状態表示の挙動変更（registry の枠組みは不変）
- 死活監視ループやリトライの追加

## セキュリティ制約（docs/security.md 準拠）

- 停止対象は Rust 側 registry に登録された、stream-dock 起動プロセスに限定する（§6）。
  本タスクはスコープを「プリセット文脈で個別起動したプロセス」に**広げるだけ**で、
  外部プロセス・ユーザーが手動起動したプロセスを対象化しない。
- shell 経由で停止しない（`taskkill` / `kill` / `pkill` 等を追加しない）。
- frontend から渡るのは `launch_id` / `preset_id` / `toolId` / `preset_item_id` のみ。任意 PID/path は受け取らない。
- Rust 側で `preset_item_id` を無条件に信用せず、存在確認したうえで `preset_id` を解決する。
- 停止処理の挙動に関わる変更のため、実装後に security-review を必須とする。

## 完了条件

- プリセットのメイン画面で複数ツールを個別起動 → 「一括停止」で**それらが実際に停止する**
- 一括起動（008）で起動したプロセスの停止は従来どおり動作する（退行なし）
- サイドバー等プリセット文脈のない個別起動は、一括停止の対象に**入らない**
- 個別起動時に所属 preset_item が解決できないケースでも、起動自体は失敗しない
- `stop_preset_processes` を改修していない（変更は `launch_tool` に閉じている）
- 危険な汎用 command を追加していない / Tauri capabilities に不要な強権限を追加していない
- `pnpm --filter ./apps/desktop typecheck` / `lint`、`cargo check` が通る
- docs/progress.md が更新されている

## 確認コマンド

```bash
git diff --stat
git diff --name-only
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
cd apps/desktop/src-tauri && cargo check
pnpm --filter ./apps/desktop tauri dev
```

## 実装後に必要なレビュー

停止処理のスコープに関わる変更のため、実装後に security-review を必須とする。最低限以下を確認する。

- registry に載る stream-dock 起動プロセスのみを停止対象にしているか
- 外部プロセス・手動起動プロセスを取り込んでいないか
- frontend から任意 PID / path を停止に渡せる設計になっていないか
- 008 の一括停止・009 の単体停止・013 の macOS 実アプリ停止を壊していないか
