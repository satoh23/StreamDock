use tauri::State;

use crate::app_logs;
use crate::app_logs::model::LogCategory;
use crate::error::AppResult;
use crate::tools::commands::DbState;

use super::model::{CreatePresetInput, Preset, UpdatePresetInput};
use super::service;

#[tauri::command]
pub fn create_preset(db: State<'_, DbState>, input: CreatePresetInput) -> AppResult<Preset> {
    let conn = db.lock().expect("db mutex poisoned");
    let result = service::create(&conn, input);
    // 011: 保存処理失敗 / validation error を記録する。
    app_logs::service::log_command_err(&conn, LogCategory::Preset, "create_preset", &result);
    result
}

#[tauri::command]
pub fn list_presets(db: State<'_, DbState>) -> AppResult<Vec<Preset>> {
    let conn = db.lock().expect("db mutex poisoned");
    service::list(&conn)
}

#[tauri::command]
pub fn get_preset(db: State<'_, DbState>, id: String) -> AppResult<Preset> {
    let conn = db.lock().expect("db mutex poisoned");
    service::get(&conn, &id)
}

#[tauri::command]
pub fn update_preset(
    db: State<'_, DbState>,
    id: String,
    input: UpdatePresetInput,
) -> AppResult<Preset> {
    let conn = db.lock().expect("db mutex poisoned");
    let result = service::update(&conn, &id, input);
    app_logs::service::log_command_err(&conn, LogCategory::Preset, "update_preset", &result);
    result
}

#[tauri::command]
pub fn delete_preset(db: State<'_, DbState>, id: String) -> AppResult<()> {
    let conn = db.lock().expect("db mutex poisoned");
    let result = service::delete(&conn, &id);
    app_logs::service::log_command_err(&conn, LogCategory::Preset, "delete_preset", &result);
    result
}
