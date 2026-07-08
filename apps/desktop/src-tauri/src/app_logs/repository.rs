use rusqlite::Connection;
use serde::de::DeserializeOwned;
use serde::Serialize;

use crate::error::ErrorCode;

use super::model::{AppLogEntry, LogCategory, LogLevel};

/// SELECT で取得する app_logs テーブルの全カラム（複数クエリで共有）。
const LOG_COLUMNS: &str = "id, level, category, operation, message, error_code, \
     tool_id, tool_name, preset_id, preset_name, preset_item_id, launch_id, process_id, occurred_at";

/// app_logs テーブルを作成する（存在すれば何もしない）。
pub fn init(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS app_logs (
            id             TEXT PRIMARY KEY,
            level          TEXT NOT NULL,
            category       TEXT NOT NULL,
            operation      TEXT NOT NULL,
            message        TEXT NOT NULL,
            error_code     TEXT,
            tool_id        TEXT,
            tool_name      TEXT,
            preset_id      TEXT,
            preset_name    TEXT,
            preset_item_id TEXT,
            launch_id      TEXT,
            process_id     INTEGER,
            occurred_at    TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_app_logs_occurred_at ON app_logs(occurred_at);",
    )?;
    Ok(())
}

// enum ⇔ DB 文字列の変換は serde の rename 定義を単一ソースにするため serde_json 経由で行う。
fn enum_to_db<T: Serialize>(v: T) -> Option<String> {
    serde_json::to_value(v)
        .ok()
        .and_then(|val| val.as_str().map(str::to_string))
}

fn enum_from_db<T: DeserializeOwned>(s: &str) -> Option<T> {
    serde_json::from_value(serde_json::Value::String(s.to_string())).ok()
}

pub fn insert(conn: &Connection, e: &AppLogEntry) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO app_logs
            (id, level, category, operation, message, error_code,
             tool_id, tool_name, preset_id, preset_name, preset_item_id, launch_id, process_id, occurred_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
        rusqlite::params![
            e.id,
            enum_to_db(e.level).unwrap_or_else(|| "info".to_string()),
            enum_to_db(e.category).unwrap_or_else(|| "ui".to_string()),
            e.operation,
            e.message,
            e.error_code.and_then(enum_to_db),
            e.tool_id,
            e.tool_name,
            e.preset_id,
            e.preset_name,
            e.preset_item_id,
            e.launch_id,
            e.process_id.map(|p| p as i64),
            e.occurred_at,
        ],
    )?;
    Ok(())
}

fn row_to_entry(row: &rusqlite::Row<'_>) -> rusqlite::Result<AppLogEntry> {
    let level: String = row.get("level")?;
    let category: String = row.get("category")?;
    let error_code: Option<String> = row.get("error_code")?;
    let process_id: Option<i64> = row.get("process_id")?;
    Ok(AppLogEntry {
        id: row.get("id")?,
        level: enum_from_db::<LogLevel>(&level).unwrap_or(LogLevel::Info),
        category: enum_from_db::<LogCategory>(&category).unwrap_or(LogCategory::Ui),
        operation: row.get("operation")?,
        message: row.get("message")?,
        error_code: error_code.as_deref().and_then(enum_from_db::<ErrorCode>),
        tool_id: row.get("tool_id")?,
        tool_name: row.get("tool_name")?,
        preset_id: row.get("preset_id")?,
        preset_name: row.get("preset_name")?,
        preset_item_id: row.get("preset_item_id")?,
        launch_id: row.get("launch_id")?,
        process_id: process_id.map(|v| v as u32),
        occurred_at: row.get("occurred_at")?,
    })
}

/// 直近のログを occurred_at 降順で最大 limit 件返す。
pub fn list_recent(conn: &Connection, limit: u32) -> rusqlite::Result<Vec<AppLogEntry>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {LOG_COLUMNS} FROM app_logs ORDER BY occurred_at DESC, id DESC LIMIT ?1"
    ))?;
    let rows = stmt.query_map(rusqlite::params![limit as i64], row_to_entry)?;
    rows.collect()
}

/// 指定 level のログを occurred_at 降順で最大 limit 件返す（診断サマリー用）。
pub fn list_recent_by_level(
    conn: &Connection,
    level: LogLevel,
    limit: u32,
) -> rusqlite::Result<Vec<AppLogEntry>> {
    let level_str = enum_to_db(level).unwrap_or_else(|| "info".to_string());
    let mut stmt = conn.prepare(&format!(
        "SELECT {LOG_COLUMNS} FROM app_logs WHERE level = ?1 ORDER BY occurred_at DESC, id DESC LIMIT ?2"
    ))?;
    let rows = stmt.query_map(rusqlite::params![level_str, limit as i64], row_to_entry)?;
    rows.collect()
}

/// すべてのログを削除する（ユーザーテストの履歴リセット用）。
pub fn clear(conn: &Connection) -> rusqlite::Result<usize> {
    let affected = conn.execute("DELETE FROM app_logs", [])?;
    Ok(affected)
}
