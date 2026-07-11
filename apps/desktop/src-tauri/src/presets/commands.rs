use rusqlite::Connection;
use tauri::{AppHandle, State};
use tauri_plugin_autostart::ManagerExt;

use crate::app_logs;
use crate::app_logs::model::{LogCategory, LogLevel, NewLog};
use crate::error::AppResult;
use crate::tools::commands::DbState;

use super::model::{CreatePresetInput, Preset, UpdatePresetInput};
use super::{repository, service};

/// 019: ログイン項目（自動起動）を「フラグ付きプリセットが 1 つ以上 ⇔ 有効」という
/// 不変条件に是正する。OS 連携は AppHandle を持てる command 層でのみ行い、
/// service 層（`&Connection` のみ）では触らない。`is_enabled()` で冗長な OS 書込を避ける。
/// OS 書込失敗は best-effort（UI をブロックせず app_logs に Warn 記録）。
///
/// DB ロック保持中に OS 呼び出しをするが、autolaunch は DB へ再入しないためデッドロックせず、
/// preset 操作は低頻度のため許容（将来ロック外へ出す余地）。count 取得失敗時は unwrap_or(0) で
/// want=false に倒れうるが best-effort（次回 reconcile / 起動時 reconcile で自己修復する）。
pub(crate) fn reconcile_autostart(app: &AppHandle, conn: &Connection) {
    let want = repository::count_auto_launch_on_boot(conn).unwrap_or(0) > 0;
    let manager = app.autolaunch();
    let is_enabled = manager.is_enabled().unwrap_or(false);
    let outcome = if want && !is_enabled {
        manager.enable()
    } else if !want && is_enabled {
        manager.disable()
    } else {
        Ok(())
    };
    if outcome.is_err() {
        app_logs::service::record(
            conn,
            NewLog::new(
                LogLevel::Warn,
                LogCategory::Preset,
                "reconcile_autostart",
                "ログイン項目の更新に失敗しました",
            ),
        );
    }
}

#[tauri::command]
pub fn create_preset(
    app: AppHandle,
    db: State<'_, DbState>,
    input: CreatePresetInput,
) -> AppResult<Preset> {
    let conn = db.lock().expect("db mutex poisoned");
    let result = service::create(&conn, input);
    // 011: 保存処理失敗 / validation error を記録する。
    app_logs::service::log_command_err(&conn, LogCategory::Preset, "create_preset", &result);
    if result.is_ok() {
        reconcile_autostart(&app, &conn);
    }
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
    app: AppHandle,
    db: State<'_, DbState>,
    id: String,
    input: UpdatePresetInput,
) -> AppResult<Preset> {
    let conn = db.lock().expect("db mutex poisoned");
    let result = service::update(&conn, &id, input);
    app_logs::service::log_command_err(&conn, LogCategory::Preset, "update_preset", &result);
    if result.is_ok() {
        reconcile_autostart(&app, &conn);
    }
    result
}

#[tauri::command]
pub fn delete_preset(app: AppHandle, db: State<'_, DbState>, id: String) -> AppResult<()> {
    let conn = db.lock().expect("db mutex poisoned");
    let result = service::delete(&conn, &id);
    app_logs::service::log_command_err(&conn, LogCategory::Preset, "delete_preset", &result);
    if result.is_ok() {
        reconcile_autostart(&app, &conn);
    }
    result
}
