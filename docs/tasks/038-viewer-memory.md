# 038 視聴者メモリ（親・設計/方針）

> 状態: **未着手（親ドキュメント）**。本ファイルは 038a〜038c の**分割・線引き・実装順の正**。
>
> **必読前提**: コメントのワイヤ契約 [`model.rs`](../../apps/desktop/src-tauri/src/comment_viewer/model.rs)（`CommentViewDto`）、
> DB レイヤの流儀 [`tools/repository.rs`](../../apps/desktop/src-tauri/src/tools/repository.rs)・[`util.rs`](../../apps/desktop/src-tauri/src/util.rs)（`ensure_column`）・
> [`lib.rs`](../../apps/desktop/src-tauri/src/lib.rs) の `setup`（244-257 行）、
> [`docs/security.md`](../security.md)（**特に §9「取得コメントを DB/ログに保存しない」＝本タスクで方針変更**）。
> CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。各サブタスクは 1 タスク 1 機能で分割済み。
> ユーザーのセキュリティ方針（限定・同意・レビュー付きで保存解禁は可）に沿って進める。

## 目的

コメントビューア（配信者だけが見る画面）に、**一度コメントした視聴者を記憶する**機能を追加する。視聴者ごとに次を保持・表示する:

- ユーザー名 / サイト名（Twitch・YouTube）
- 総コメント数
- bits・スーパーチャットの**回数と合計額**
- サブスク／メンバーシップの**期間**
- その配信で過去に行ったコメント
- 配信者自身が残す**視聴者に関するメモ**

さらに 038c で、この記憶を土台に「初見／久しぶり」の判定（枠色＋バッジ）を提供する。

## 現在の前提（調査結果）

- **コメント・視聴者・配信の SQLite テーブルは現状ゼロ**。既存は tools / presets / preset_items / app_logs のみ
  （[`lib.rs`](../../apps/desktop/src-tauri/src/lib.rs) 253-256 行で各 `repository::init()` を呼ぶ）。テーブルは
  `CREATE TABLE IF NOT EXISTS`＋後付けカラムは [`util::ensure_column`](../../apps/desktop/src-tauri/src/util.rs)（80-96 行）。
  DB は `rusqlite`、`commands/service/repository/model` の手書きレイヤード、接続は `DbState = Mutex<Connection>`
  （[`tools/commands.rs`](../../apps/desktop/src-tauri/src/tools/commands.rs) 15 行相当・`lib.rs` 257 行で `app.manage`）。
- **コメントは realtime のみで永続化されていない**。コメント本文は Node sidecar が生成し、loopback WS で frontend
  （`CommentViewerApp` / `OverlayApp`）へ直送。**Rust はコメント本文に触れない**（[`comment_viewer/model.rs`](../../apps/desktop/src-tauri/src/comment_viewer/model.rs) 1-6 行に
  「Rust 側でこの DTO を構築する経路は無く…§9 で DB/ログへ保存しない」と明記）。→ **本タスクはこの前提を意図的に変更する**。
- コメントは `CommentViewDto`（id / source / author{id,name,avatar?} / text / published_at / event_type / monetary_amount?）で届く。
  `monetary_amount` は整形済み文字列（例 "100 bits"）で、**回数・合計額の集計には数値・通貨の分解が必要**（wire に生値は現状無い）。
  サブスク/メンシプの「期間（累計月数など）」も現状 wire に無い（sidecar の生イベントには存在する）。

## 確定した方針

- **§9 の「保存しない」を、視聴者メモリ機能に限って解禁する**（要 security-review）。保存は **端末内 SQLite のみ**・端末外へ送信しない・
  OAuth トークン同様に外部に出さない。[`docs/security.md`](../security.md) の「## コメントビューア（配信サービス連携）方針」に
  保存範囲・目的・削除手段を明文化する（更新は 038a で着手）。
- **新モジュール `viewer_memory`**（`model.rs` / `repository.rs` / `service.rs` / `commands.rs`）を追加し、`lib.rs` の setup で
  `viewer_memory::repository::init(&conn)` を配線する（tools/presets と同じ流儀）。テーブル案（詳細カラムは 038a で確定）:
  - `viewers`: `id`（`provider:providerUserId` 等の安定キー）, `provider`, `name`, `first_seen_at`, `last_comment_at`,
    `total_comments`, `bits_count`, `bits_amount`, `superchat_count`, `superchat_amount`, サブスク/メンシプ関連（`is_member` / `sub_months` 等）,
    `note`（配信者メモ）, `created_at`, `updated_at`。
  - `viewer_comments`: `id`, `viewer_id`(FK CASCADE), `session_id`（配信単位の区別・下記）, `source`, `text`, `event_type`, `monetary_amount`, `published_at`, `created_at`。
- **コメントを Rust に届ける経路**は「**frontend が WS で受信したコメントを Tauri コマンド `record_comment` で Rust に渡して upsert/集計**」を基本とする
  （sidecar は不変・既存の no-internet 境界を崩さない）。集計（総数・bits/スパチャ回数と額・最終コメント日時）は Rust 側で一貫して行う。
- **「その配信」の区別**は `session_id`（コメント取得セッション開始時に採番するローカル ID）で表現する。既存に stream/session テーブルは無いため、
  最小の session 概念を 038a で導入する（永続テーブル化は必須ではなく、当該配信のコメント束を識別できれば良い）。
- **金額・期間の取得**: `monetary_amount` の文字列集計では不正確なため、038a は「取得できる範囲で集計」しつつ、
  **正確な回数/額/期間が要る場合は wire 契約（`model.rs`→bindings＋sidecar）に数値フィールド（amount/currency/months 等）を追加する**方針とする
  （このワイヤ拡張が必要なら 038a のスコープに含め、sidecar 側の追補は別途明記）。
- **プライバシー**: 第三者の氏名・発言・投げ銭履歴を端末に保存する。端末内限定・削除手段（視聴者削除/全消去コマンド）を用意し、
  ログには視聴者本文・メモを出さない（§9 の精神を保存範囲を限定して維持）。

## サブタスク分割

| ID | 内容 | 外部通信（新規） | security-review |
|----|------|-----------------|-----------------|
| [038a](038a-viewer-memory-data-layer.md) | Rust データ基盤: `viewer_memory` モジュール新設（テーブル＋集計 upsert）＋frontend→Rust の `record_comment` 配線＋取得/メモ更新/削除コマンド＋（必要なら）wire に数値フィールド追加＋security.md 更新 | なし（保存は端末内） | **必須**（§9 保存ポリシー変更） |
| [038b](038b-viewer-list-detail-and-notes.md) | 視聴者一覧・詳細 UI（コメビュ内・総数/サイト/bits/スパチャ/サブスク期間/過去コメント表示）＋配信者メモ編集 | なし | 軽（表示＋メモ更新のみ） |
| [038c](038c-first-time-and-returning-badges.md) | 初見/久しぶりバッジ＋枠色（初見＝初コメント／久しぶり＝最終コメントから 1 ヶ月以上経過後の初コメント） | なし | 軽（判定＋表示） |

## 依存関係と推奨実装順

```
038a → 038b → 038c
```

- **038a が土台**（保存・集計・コマンド・ポリシー変更）。これが無いと 038b/038c が読むデータが無い。
- **038b** は 038a のコマンドを叩く表示層＋メモ編集。**038c** は 038a の `first_seen_at`/`last_comment_at` を突合してバッジ判定する。
- 番号の大小で 040（ROM 突合）より前に完了する（ROM は視聴者メモリを参照する）。

## 横断セキュリティ方針（docs/security.md 準拠）

- **§9 の保存ポリシーを視聴者メモリに限って変更する**（端末内 SQLite のみ・端末外非送信・削除手段あり）。「## コメントビューア方針」に明文化。
  **保存ポリシー変更のため 038a は security-review 必須**。
- コメントを Rust に渡す経路（`record_comment`）は **loopback WS で受信済みの値を Tauri コマンドで渡すだけ**で、新規の外部通信・宛先・
  capability を増やさない（§1/§3）。sidecar・メイン窓の no-internet 境界は不変。
- 入力（コメント本文・視聴者名・メモ）は Rust 側で trim/制御文字拒否等の既存検証（[`util.rs`](../../apps/desktop/src-tauri/src/util.rs)）を通す（§8）。
- ログに視聴者本文・メモ・投げ銭履歴を出さない（§9）。エラーは既存 `AppError` 経由で DB パス等を露出しない。
- 新規 crate/npm/plugin を増やさない方針（必要な場合は 038a で理由を添えて提案）。

## 完了条件

- 038a〜038c のタスクファイルが本親の分割・依存どおりに存在し、各々が既存フォーマットに沿う。
- [`docs/task-board.md`](../task-board.md) に 038 系が追記されている。
- 本親ドキュメント自体はコードを変更しない（実装は各サブタスクで「実装して」後）。
- 各サブタスク完了時に [`docs/progress.md`](../progress.md) を更新する。

## このタスク（親）でやらないこと

- コード実装（038a〜c それぞれで行う）。
- 端末外への送信・クラウド同期・複数端末共有（端末内保存のみ）。
- ROM 勢一覧（040）。オーバーレイ側の投げ銭意匠（037b）。
- 視聴者アイコンのコメビュ本体表示（アイコンは overlay 意匠のみ・036 系の線引き踏襲）。
