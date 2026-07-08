use rusqlite::Connection;

use crate::error::AppResult;
use crate::util::now_rfc3339;
use crate::process::registry::ProcessRegistry;
use crate::process::service as process_service;

use super::model::{AppLogEntry, DiagnosticSummary, LogCategory, LogLevel, NewLog};
use super::repository;

/// list_app_logs のデフォルト件数と上限（frontend から任意 SQL / 条件は受け取らない）。
const DEFAULT_LIMIT: u32 = 50;
const MAX_LIMIT: u32 = 200;
/// 診断サマリーに含める error / warn の件数上限。
const SUMMARY_LIMIT: u32 = 30;

/// ログを1件記録する。
///
/// 書き込みに失敗しても業務操作を壊さないよう、エラーは握りつぶす（best-effort）。
pub fn record(conn: &Connection, entry: NewLog) {
    let row = AppLogEntry {
        id: uuid::Uuid::new_v4().to_string(),
        level: entry.level,
        category: entry.category,
        operation: entry.operation,
        message: entry.message,
        error_code: entry.error_code,
        tool_id: entry.tool_id,
        tool_name: entry.tool_name,
        preset_id: entry.preset_id,
        preset_name: entry.preset_name,
        preset_item_id: entry.preset_item_id,
        launch_id: entry.launch_id,
        process_id: entry.process_id,
        occurred_at: now_rfc3339(),
    };
    let _ = repository::insert(conn, &row);
}

/// `AppResult` が Err のとき error ログを1件記録するヘルパ（CRUD command から使う）。
///
/// ログ本文には raw な `AppError.message`（プリセット名などユーザー入力を含みうる）ではなく、
/// `ErrorCode` 由来の固定安全文言（`log_message()`）を記録する。これにより、ユーザー入力が
/// app_logs／共有用診断サマリーへ流出するのを構造的に防ぐ（docs/security.md §9）。
///
/// process command は本ヘルパを使わず直接 `record` する。そのうち **error ログの本文も**
/// `code.log_message()` 固定文言を渡している。一方 process の **info/success ログ**（例:
/// 「{tool 名} を起動しました」）は識別のため message に tool 名を含めるが、これは Info レベルで
/// 診断サマリー（error / warn のみ）には出ない。
/// 不変条件: 診断サマリーに載る **error / warn の message には任意ユーザー入力を入れない**
/// （`buildSummaryText` は message をそのまま共有テキストに出すため）。将来 error / warn の
/// message を追加・変更する際はこの不変条件を必ず守ること（プリセット名等を埋めない）。
pub fn log_command_err<T>(
    conn: &Connection,
    category: LogCategory,
    operation: &str,
    result: &AppResult<T>,
) {
    if let Err(e) = result {
        record(
            conn,
            NewLog::new(LogLevel::Error, category, operation, e.code.log_message())
                .error_code(e.code),
        );
    }
}

/// 直近のログを返す。limit は Rust 側で clamp する（既定 50・最大 200）。
pub fn list(conn: &Connection, limit: Option<u32>) -> AppResult<Vec<AppLogEntry>> {
    let limit = limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);
    Ok(repository::list_recent(conn, limit)?)
}

/// ユーザーが開発者に共有しやすい診断サマリーを返す。
///
/// 直近の error / warn ＋ 現在の runtime process 状態をまとめる。
/// full path / 環境変数など危険な情報は含めない。
pub fn diagnostic_summary(
    conn: &Connection,
    registry: &ProcessRegistry,
) -> AppResult<DiagnosticSummary> {
    let recent_errors = repository::list_recent_by_level(conn, LogLevel::Error, SUMMARY_LIMIT)?;
    let recent_warnings = repository::list_recent_by_level(conn, LogLevel::Warn, SUMMARY_LIMIT)?;
    let runtime_processes = process_service::snapshot(registry, None);
    Ok(DiagnosticSummary {
        generated_at: now_rfc3339(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        recent_errors,
        recent_warnings,
        runtime_processes,
    })
}

/// すべてのログを削除する。
pub fn clear(conn: &Connection) -> AppResult<()> {
    repository::clear(conn)?;
    Ok(())
}
