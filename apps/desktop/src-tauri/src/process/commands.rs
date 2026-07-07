use tauri::State;

use crate::error::{AppError, AppResult};
use crate::tools;
use crate::tools::commands::DbState;

use super::model::{BulkLaunchPresetResult, LaunchToolResult};
use super::service;

/// 登録済み Tool を toolId で単体起動する。
///
/// frontend からは toolId のみを受け取る。Tool の取得と executablePath の検証は Rust 側で行い、
/// shell を経由せず保存済み executablePath を直接起動する。
#[tauri::command]
pub fn launch_tool(db: State<'_, DbState>, id: String) -> AppResult<LaunchToolResult> {
    if id.trim().is_empty() {
        return Err(AppError::Validation("toolId は必須です".into()));
    }

    // DB ロックは Tool の取得だけで解放し、プロセス spawn 中は保持しない。
    let tool = {
        let conn = db.lock().expect("db mutex poisoned");
        tools::service::get(&conn, &id)?
    };

    service::launch(&tool)
}

/// 選択中 Preset に紐づく enabled な PresetItem を一括起動する（008）。
///
/// frontend からは presetId のみを受け取る。Preset / PresetItem / Tool の取得と executablePath の検証は
/// Rust 側で行い、shell を経由せず保存済み executablePath を直接起動する。
/// best-effort 起動のため、1つの失敗で全体を中断せず成功・失敗を集約して返す。
#[tauri::command]
pub fn launch_preset(
    db: State<'_, DbState>,
    preset_id: String,
) -> AppResult<BulkLaunchPresetResult> {
    if preset_id.trim().is_empty() {
        return Err(AppError::Validation("presetId は必須です".into()));
    }

    // DB ロックは起動対象の解決だけで解放し、プロセス spawn 中は保持しない。
    let targets = {
        let conn = db.lock().expect("db mutex poisoned");
        service::resolve_preset_targets(&conn, &preset_id)?
    };

    Ok(service::launch_preset_targets(&preset_id, targets))
}
