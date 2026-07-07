use tauri::State;

use crate::error::{AppError, AppResult};
use crate::tools;
use crate::tools::commands::DbState;

use super::model::LaunchToolResult;
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
