//! 062c: 配信サマリーの Tauri コマンド。
//!
//! 既存の viewer_memory / stream_session と同型（`db: State<'_, DbState>` を受け、service へ委譲して
//! `AppResult<T>` を返す）。
//!
//! ⚠ **read-only なので `log_command_err` を付けない**（`list_viewers` / `get_active_stream_session` と同じ扱い）。
//! 付けても記録されるのは `ErrorCode` 由来の固定安全文言だけだが、**取得系は失敗してもデータが壊れない**ので
//! ログを増やさない既存の線引きに揃える（docs/security.md §9）。
//! ⚠ アプリ定義コマンドなので capability（ACL）は増えない
//! （docs/security.md「コメントビューア（配信サービス連携）方針」⑪）。
//! ⚠ **単一目的**（§3）。「任意の条件で集計する」汎用コマンドは作らない——フィルタは 062d の仕事で、
//! そこでも**動的な WHERE 句を組まない**こと（§8）。

use tauri::State;

use crate::error::AppResult;
use crate::tools::commands::DbState;

use super::model::StreamSummary;
use super::service;

/// 1 回の配信（`session_id`）ぶんの集計を返す。read-only。
///
/// ⚠ **集計結果は保存しない**（キャッシュテーブルを作ると docs/security.md §9 の判断がやり直しになる）。
/// `idx_viewer_comments_session` が効くので都度計算で足りる。
/// ⚠ 062b 以前の `session_id`（`stream_sessions` に対応行が無い）は `NotFound` になる。
/// バックフィルはしない＝セッションを捏造しないという 062b の決定。
/// ⚠ 画面はこれを**説明文で書かない**（2026-08-16 の決定・`SummaryView.tsx` 冒頭を参照）——
/// 一覧に出ないという事実だけがユーザーに見える。
#[tauri::command]
pub fn get_stream_summary(
    db: State<'_, DbState>,
    session_id: String,
) -> AppResult<StreamSummary> {
    let conn = db.lock().expect("db mutex poisoned");
    service::get(&conn, &session_id)
}
