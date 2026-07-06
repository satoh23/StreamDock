use tauri::State;

use crate::error::AppResult;
use crate::tools::commands::DbState;

use super::model::{CreatePresetInput, Preset, UpdatePresetInput};
use super::service;

#[tauri::command]
pub fn create_preset(db: State<'_, DbState>, input: CreatePresetInput) -> AppResult<Preset> {
    let conn = db.lock().expect("db mutex poisoned");
    service::create(&conn, input)
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
    service::update(&conn, &id, input)
}

#[tauri::command]
pub fn delete_preset(db: State<'_, DbState>, id: String) -> AppResult<()> {
    let conn = db.lock().expect("db mutex poisoned");
    service::delete(&conn, &id)
}
