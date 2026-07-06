use std::sync::Mutex;

use rusqlite::Connection;
use tauri::State;

use crate::error::AppResult;

use super::model::{CreateToolInput, Tool, UpdateToolInput};
use super::service;

/// 共有される SQLite 接続。lib.rs の setup で app.manage される。
pub type DbState = Mutex<Connection>;

#[tauri::command]
pub fn create_tool(db: State<'_, DbState>, input: CreateToolInput) -> AppResult<Tool> {
    let conn = db.lock().expect("db mutex poisoned");
    service::create(&conn, input)
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
    service::update(&conn, &id, input)
}

#[tauri::command]
pub fn delete_tool(db: State<'_, DbState>, id: String) -> AppResult<()> {
    let conn = db.lock().expect("db mutex poisoned");
    service::delete(&conn, &id)
}
