# 038a 視聴者メモリ Rust データ基盤（保存・集計・コマンド）

> 状態: **未着手（実装サブタスク）**。分割・線引きは親 [038](038-viewer-memory.md) を正とする。
>
> **必読前提**: 親 [038](038-viewer-memory.md)、DB レイヤの流儀 [`tools/repository.rs`](../../apps/desktop/src-tauri/src/tools/repository.rs)・
> [`util.rs`](../../apps/desktop/src-tauri/src/util.rs)、[`lib.rs`](../../apps/desktop/src-tauri/src/lib.rs) の `setup`、
> ワイヤ契約 [`comment_viewer/model.rs`](../../apps/desktop/src-tauri/src/comment_viewer/model.rs)、
> [`docs/security.md`](../security.md)（**§9 保存ポリシー変更**・「## コメントビューア方針」）。
> CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。

## 目的

視聴者メモリの**保存・集計・取得の Rust 基盤**を作る。受信済みコメントを Rust に渡して視聴者ごとに upsert・集計し、
一覧/詳細/メモ/削除の Tauri コマンドを提供する。これが 038b（UI）・038c（バッジ）・040b（ROM 突合）のデータ源になる。

## 現在の前提（調査結果）

- テーブルは各 `repository::init()` の `CREATE TABLE IF NOT EXISTS` で定義し `lib.rs` setup（253-256 行）で呼ぶ。後付けカラムは
  [`util::ensure_column`](../../apps/desktop/src-tauri/src/util.rs)（80-96 行）。時刻は `util::now_rfc3339()`、検証は
  `require_non_empty`/`reject_control_chars`（[`util.rs`](../../apps/desktop/src-tauri/src/util.rs) 25-38 行）。
- 接続は `DbState = Mutex<Connection>`（`lib.rs` 257 行で `app.manage(Mutex::new(conn))`）。コマンドは `db: State<'_, DbState>` を受けて
  `service`→`repository` を呼ぶ既存形（[`tools/commands.rs`](../../apps/desktop/src-tauri/src/tools/commands.rs)）。コマンド登録は `lib.rs` 301-341 行。
- コメントは frontend が loopback WS で受信（`connectCommentStream` / `commentStream.ts`・`mergeComments.ts` で蓄積）。
  **Rust はコメント本文に触れていない**（本タスクで frontend→Rust の経路を新設する）。
- コメントの型は `CommentViewDto`（[`comment_viewer/model.rs`](../../apps/desktop/src-tauri/src/comment_viewer/model.rs) 51-67 行）。`monetary_amount` は文字列のみ。

## このタスクでやること

### `viewer_memory` モジュール新設（model / repository / service / commands）

- `apps/desktop/src-tauri/src/viewer_memory/` を新設し、`lib.rs` に `mod viewer_memory;`＋setup で `viewer_memory::repository::init(&conn)?;` を追加。
- テーブル `viewers` / `viewer_comments`（親 038 の案）を `CREATE TABLE IF NOT EXISTS` で定義。カラム追加は `ensure_column`。
  安定キー `id`＝`provider:providerUserId`（`CommentAuthor.id` を provider 付きで）。`viewer_comments.viewer_id` は FK CASCADE。
- 集計は Rust 側で一貫実行: 総コメント数、bits/スパチャの回数・合計額、`first_seen_at`/`last_comment_at`、サブスク/メンシプ関連。

### frontend→Rust の記録経路（record_comment）

- Tauri コマンド `record_comment(comment, session_id)` を追加。frontend（`CommentViewerApp`）が WS 受信ごと（`mergeComments` 追加時）に呼び、
  `service` で trim/制御文字検証（§8）の上、視聴者 upsert＋`viewer_comments` 追加＋集計更新を行う。**sidecar は不変**（受信済みの値を渡すだけ）。
- `session_id` はコメント取得セッション開始時に frontend で採番するローカル ID（「その配信」の束を識別）。

### 金額・期間の正確化（必要ならワイヤ拡張）

- `monetary_amount` 文字列では回数/額の集計が不正確になるため、**正確な集計が要る範囲で `model.rs` の `CommentViewDto` に数値フィールド
  （amount / currency / sub months 等）を追加**し bindings 再生成＋sidecar 側の充填を伴わせる（sidecar 追補が必要なら本ファイルに明記して分離）。
  MVP では「取得できる範囲で集計し、不足は近似」でも可（親 038 の方針）。判断と実際の粒度は実装時に確定する。

### 取得・メモ・削除コマンド

- `list_viewers`（一覧・並び替え/検索）、`get_viewer`（詳細＋その視聴者の過去コメント）、`update_viewer_note`（配信者メモ更新）、
  `delete_viewer` / `clear_viewers`（削除・全消去＝プライバシー手段）を追加し `lib.rs` の `generate_handler!` に登録。ts-rs で DTO を bindings 出力。

### security.md 更新

- 「## コメントビューア（配信サービス連携）方針」に**視聴者メモリの保存範囲（端末内 SQLite のみ・端末外非送信・削除手段）**を明文化し、
  §9 の例外として位置づける。

## このタスクでやらないこと

- 視聴者一覧/詳細 UI・メモ編集 UI（038b）。初見/久しぶり判定 UI（038c）。ROM 突合（040）。
- 端末外送信・クラウド同期。オーバーレイ側の変更。

## セキュリティ制約（docs/security.md 準拠）

- **保存は端末内 SQLite のみ・端末外に出さない**（§9 を視聴者メモリに限り変更・security.md へ明文化）。**保存ポリシー変更のため security-review 必須**。
- `record_comment` は loopback WS で受信済みの値を Tauri コマンドで渡すだけ。**新規の外部通信・宛先・capability を増やさない**（§1/§3）。sidecar/メイン窓の no-internet 境界は不変。
- 入力（コメント本文・視聴者名・メモ・session_id）は Rust 側で trim/制御文字拒否（`util.rs`）を通す（§8）。SQL は既存流儀のパラメータバインド（識別子は定数のみ）。
- ログに視聴者本文・メモ・投げ銭履歴を出さない（§9）。エラーは `AppError` 経由で DB パス等を露出しない。
- 新規 crate を増やさない方針（必要なら理由を添えて提案）。

## 完了条件

- `viewers` / `viewer_comments` が作成され、`record_comment` 呼び出しで視聴者 upsert・集計・過去コメント蓄積が行われる。
- `list_viewers` / `get_viewer` / `update_viewer_note` / `delete_viewer`（+ 全消去）が動作し、bindings が生成されている。
- 保存は端末内のみで端末外送信・新規宛先/capability の追加が無い。security.md に保存範囲が明文化されている。
- `pnpm --filter ./apps/desktop typecheck` / `lint`・`cargo check`（bindings 再生成後）が通る。[`docs/progress.md`](../progress.md) を更新。

## 確認コマンド

```bash
git diff --stat
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
pnpm --filter ./apps/desktop tauri dev   # コメント取得→視聴者行が upsert され総数/最終日時/投げ銭集計が更新されること、
                                         #   list_viewers/get_viewer が値を返すこと、メモ更新・削除が効くことを確認
```

## 実装後に必要なレビュー

- **security-review（必須）**: §9 の保存ポリシー変更が視聴者メモリに限定され端末内 SQLite のみ・端末外非送信であること、`record_comment` が
  新規外部通信・宛先・capability を増やさないこと、入力検証・ログ非露出・削除手段が備わっていることを確認する。security.md 更新の妥当性も確認。
