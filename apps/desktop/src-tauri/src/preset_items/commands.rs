use tauri::State;

use crate::error::AppResult;
use crate::tools::commands::DbState;

use super::model::{AddPresetItemInput, PresetItem, UpdatePresetItemInput};
use super::service;

#[tauri::command]
pub fn add_tool_to_preset(
    db: State<'_, DbState>,
    input: AddPresetItemInput,
) -> AppResult<PresetItem> {
    let conn = db.lock().expect("db mutex poisoned");
    service::add(&conn, input)
}

#[tauri::command]
pub fn list_preset_items(
    db: State<'_, DbState>,
    preset_id: String,
) -> AppResult<Vec<PresetItem>> {
    let conn = db.lock().expect("db mutex poisoned");
    service::list_by_preset(&conn, &preset_id)
}

#[tauri::command]
pub fn list_all_preset_items(db: State<'_, DbState>) -> AppResult<Vec<PresetItem>> {
    let conn = db.lock().expect("db mutex poisoned");
    service::list_all(&conn)
}

#[tauri::command]
pub fn remove_tool_from_preset(db: State<'_, DbState>, id: String) -> AppResult<()> {
    let conn = db.lock().expect("db mutex poisoned");
    service::remove(&conn, &id)
}

#[tauri::command]
pub fn update_preset_item(
    db: State<'_, DbState>,
    id: String,
    input: UpdatePresetItemInput,
) -> AppResult<PresetItem> {
    let conn = db.lock().expect("db mutex poisoned");
    service::update(&conn, &id, input)
}

#[tauri::command]
pub fn reorder_preset_items(
    db: State<'_, DbState>,
    preset_id: String,
    ordered_ids: Vec<String>,
) -> AppResult<Vec<PresetItem>> {
    let conn = db.lock().expect("db mutex poisoned");
    service::reorder(&conn, &preset_id, ordered_ids)
}
