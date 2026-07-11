use std::sync::Mutex;

use rusqlite::Connection;
use tauri::State;

use crate::app_logs;
use crate::app_logs::model::LogCategory;
use crate::error::AppResult;

use super::icon;
use super::model::{CreateToolInput, Tool, UpdateToolInput};
use super::service;

/// 共有される SQLite 接続。lib.rs の setup で app.manage される。
pub type DbState = Mutex<Connection>;

#[tauri::command]
pub fn create_tool(db: State<'_, DbState>, input: CreateToolInput) -> AppResult<Tool> {
    let conn = db.lock().expect("db mutex poisoned");
    let result = service::create(&conn, input);
    // 011: 保存処理失敗 / validation error を記録する。
    app_logs::service::log_command_err(&conn, LogCategory::Tool, "create_tool", &result);
    result
}

#[tauri::command]
pub fn list_tools(db: State<'_, DbState>) -> AppResult<Vec<Tool>> {
    let conn = db.lock().expect("db mutex poisoned");
    service::list(&conn)
}

#[tauri::command]
pub fn get_tool(db: State<'_, DbState>, id: String) -> AppResult<Tool> {
    let conn = db.lock().expect("db mutex poisoned");
    service::get(&conn, &id)
}

#[tauri::command]
pub fn update_tool(
    db: State<'_, DbState>,
    id: String,
    input: UpdateToolInput,
) -> AppResult<Tool> {
    let conn = db.lock().expect("db mutex poisoned");
    let result = service::update(&conn, &id, input);
    app_logs::service::log_command_err(&conn, LogCategory::Tool, "update_tool", &result);
    result
}

/// 018: ユーザーが選択した実行ファイルの実アイコンを抽出し、base64 PNG（`data:` 無し・≤128px）を返す。
/// 読み取り専用・外部通信なし。非対応形式・失敗・パス検証 NG は `Ok(None)`（frontend は文字にフォールバック）。
/// DB は使わないため State を取らない（最小権限）。
#[tauri::command]
pub fn extract_app_icon(path: String) -> AppResult<Option<String>> {
    icon::extract_app_icon(&path)
}

#[tauri::command]
pub fn delete_tool(db: State<'_, DbState>, id: String) -> AppResult<()> {
    let conn = db.lock().expect("db mutex poisoned");
    let result = service::delete(&conn, &id);
    app_logs::service::log_command_err(&conn, LogCategory::Tool, "delete_tool", &result);
    result
}
