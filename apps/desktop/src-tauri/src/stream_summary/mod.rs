//! 062c: 配信サマリー（1 回の配信ぶんの集計）。
//!
//! 062b が確定させた `stream_sessions`（＝「1 回の配信」）を単位に、`viewer_comments` を
//! **その場で集計して返すだけ**のモジュール。tools / viewer_memory / stream_session と同型の
//! レイヤード構成（commands / service / repository / model）。
//!
//! ## ⚠⚠ このモジュールは**テーブルを 1 つも作らない**（`init()` が無いのは意図）
//!
//! 集計結果をキャッシュテーブルへ保存すると **docs/security.md §9（端末保存）の判断がやり直しになる**。
//! `idx_viewer_comments_session` が効くので都度計算で足りる。`lib.rs` の `setup()` にも
//! `stream_summary::repository::init(...)` は**足していない**（足す必要が無いことをコードの形で残す）。
//! ⇒ **ここに `CREATE TABLE` を書かないこと。**
//!
//! ## セキュリティ（docs/security.md 準拠）
//!
//! - **外部通信ゼロ**（§1）。端末内 SQLite の SELECT だけで完結する。
//! - **識別子（テーブル名・カラム名・ORDER BY 句）はコンパイル時定数のみ**、値はパラメータバインド（§8）。
//!   ⚠ `session_id` は必ず `?1` でバインドする。本モジュールは **SQL を `format!` で組まない**
//!   （`repository.rs` の SQL はすべて完全な文字列リテラル）。`format!` が 1 つも無いことを
//!   grep で確認できる状態を保つこと。
//! - **§9 で新しい保存はしない**（既読のデータを読むだけ）。ログに視聴者名・金額・レイド元を出さない
//!   （`get_stream_summary` は read-only なので `log_command_err` も付けていない）。
//! - **capability を増やさない**（アプリ定義コマンドは ACL 列挙不要）・**新規依存ゼロ**。
//!
//! ## ⚠⚠ 穴 A: `viewers` の列をどこまで使ってよいか（**次の人が両方向に誤読する**）
//!
//! タスク 062c 本文は「サマリーで `viewers` の列を使わない」と書いているが、**字義どおりだと
//! マスト要件（誰がいくら／誰がレイドしたか）が実装できない**——`viewer_comments` に**名前の列が無い**
//! （列は `id / viewer_id / session_id / source / text / event_type / amount / currency /
//! monetary_amount / raid_viewer_count / published_at / created_at` だけ）ため。
//! しかもレイド行は `text` が空文字列なので本文からも取れない。⇒ **線引きはこう:**
//!
//! | `viewers` の列 | サマリーで | 理由 |
//! |---|---|---|
//! | `name` / `provider` | ✅ **JOIN してよい** | **同一性の属性**であって集計ではない。`viewer_comments` に無く、これが無いとマスト要件が作れない |
//! | `total_comments` / `bits_*` / `superchat_*` / `subscription_count` / `is_member` / `last_subscription_at` | ❌ **使わない** | **全期間の累計**で、この配信のぶんではない（混ぜると「この配信で 0 円の人が 1 万円くれた」ことになる） |
//! | `first_seen_at` / `last_comment_at` / `note` | ❌ 使わない | 同上（配信単位ではない）／メモは集計と無関係 |
//!
//! この線引きは `contributor_amounts_are_per_session_not_lifetime_totals` が固定している
//! （累計列を使う実装に変えるとレッドになる）。
//!
//! ## ⚠ 穴 F: サマリーに出るのは「**今の**名前」である（意図であって不具合ではない）
//!
//! `viewer_memory::repository::record_comment` の upsert が
//! `ON CONFLICT(id) DO UPDATE SET name = excluded.name` で**毎コメント名前を上書き**するため、
//! 改名した視聴者は**過去の配信サマリーでも現在の名前で並ぶ**。
//! ⚠ 直す手段は「`viewer_comments` に名前を保存する」だが、それは **§9 の保存項目を増やす**話なので
//! 062c ではやらない。**「記録」を謳う画面なので、次の人が不具合と誤認しないようにここへ残す。**
//! 【再修正トリガー】「あの配信のときの名前で見たい」が実要件になったら、§9 の追補＋security-review を
//! セットにして `viewer_comments` へ表示名を保存する別タスクとして起票すること。
pub mod commands;
pub mod model;
pub mod repository;
pub mod service;
