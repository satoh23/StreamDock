use tauri::State;

use crate::error::{AppError, AppResult};
use crate::presets;
use crate::tools;
use crate::tools::commands::DbState;

use super::model::{
    BulkLaunchPresetResult, LaunchToolResult, StopPresetProcessesResult, StopProcessResult,
    StopStatus,
};
use super::registry::ProcessRegistry;
use super::service;

/// 登録済み Tool を toolId で単体起動する。
///
/// frontend からは toolId のみを受け取る。Tool の取得と executablePath の検証は Rust 側で行い、
/// shell を経由せず保存済み executablePath を直接起動する。
/// 009: 起動した Child を runtime process registry に登録し、停止操作用の launchId を返す。
#[tauri::command]
pub fn launch_tool(
    db: State<'_, DbState>,
    registry: State<'_, ProcessRegistry>,
    id: String,
) -> AppResult<LaunchToolResult> {
    if id.trim().is_empty() {
        return Err(AppError::Validation("toolId は必須です".into()));
    }

    // DB ロックは Tool の取得だけで解放し、プロセス spawn 中は保持しない。
    let tool = {
        let conn = db.lock().expect("db mutex poisoned");
        tools::service::get(&conn, &id)?
    };

    let child = service::spawn(&tool)?;
    let process_id = child.id();
    let started_at = chrono::Utc::now().to_rfc3339();
    let launch_id = service::register(&registry, &tool, None, None, child, started_at.clone());

    Ok(LaunchToolResult {
        launch_id,
        tool_id: tool.id,
        process_id,
        started_at,
    })
}

/// 選択中 Preset に紐づく enabled な PresetItem を一括起動する（008）。
///
/// frontend からは presetId のみを受け取る。Preset / PresetItem / Tool の取得と executablePath の検証は
/// Rust 側で行い、shell を経由せず保存済み executablePath を直接起動する。
/// best-effort 起動のため、1つの失敗で全体を中断せず成功・失敗を集約して返す。
/// 009: 起動に成功したプロセスは registry に登録し、各結果に launchId を含める。
#[tauri::command]
pub fn launch_preset(
    db: State<'_, DbState>,
    registry: State<'_, ProcessRegistry>,
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

    Ok(service::launch_preset_targets(&preset_id, targets, &registry))
}

/// launchId で単体プロセスを停止する（009）。
///
/// frontend からは launchId のみを受け取る。停止対象は runtime process registry に登録された
/// プロセスに限定し、raw PID / path / command を frontend から受け取らない。
/// registry に該当が無ければ `not-found` を返し、何も停止しない。
#[tauri::command]
pub fn stop_process(
    registry: State<'_, ProcessRegistry>,
    launch_id: String,
) -> AppResult<StopProcessResult> {
    if launch_id.trim().is_empty() {
        return Err(AppError::Validation("launchId は必須です".into()));
    }

    // ロックは registry からの取り出しだけで解放し、kill / wait 中は保持しない。
    let managed = registry
        .lock()
        .expect("process registry mutex poisoned")
        .remove(&launch_id);

    let Some(managed) = managed else {
        // registry に無い launchId は停止対象外。frontend が任意 launchId を渡しても停止しない。
        return Ok(StopProcessResult {
            launch_id,
            tool_id: String::new(),
            tool_name: String::new(),
            process_id: 0,
            status: StopStatus::NotFound,
            stopped_at: None,
            error_message: None,
        });
    };

    let (result, keep) = service::stop_one(managed);
    if let Some(managed) = keep {
        // 停止失敗時は再試行できるよう registry へ戻す。
        registry
            .lock()
            .expect("process registry mutex poisoned")
            .insert(managed.launch_id.clone(), managed);
    }
    Ok(result)
}

/// 選択中 Preset に紐づく、registry 登録済みプロセスをまとめて停止する（009）。
///
/// frontend からは presetId のみを受け取る。Rust 側で registry を検索し、その presetId に
/// 紐づく managed process だけを停止する。対象が0件でも totalCount=0 の正常結果を返す。
#[tauri::command]
pub fn stop_preset_processes(
    db: State<'_, DbState>,
    registry: State<'_, ProcessRegistry>,
    preset_id: String,
) -> AppResult<StopPresetProcessesResult> {
    if preset_id.trim().is_empty() {
        return Err(AppError::Validation("presetId は必須です".into()));
    }

    // Preset 実在チェック（DB ロックは確認のみで解放）。
    {
        let conn = db.lock().expect("db mutex poisoned");
        presets::service::get(&conn, &preset_id)?;
    }

    // この presetId に紐づく launchId を収集（ロックは収集のみで解放）。
    let launch_ids: Vec<String> = {
        let reg = registry.lock().expect("process registry mutex poisoned");
        reg.iter()
            .filter(|(_, mp)| mp.preset_id.as_deref() == Some(preset_id.as_str()))
            .map(|(id, _)| id.clone())
            .collect()
    };

    let mut results: Vec<StopProcessResult> = Vec::with_capacity(launch_ids.len());
    for id in launch_ids {
        // 取り出しごとにロックを取り、kill / wait 中はロックを保持しない。
        let managed = registry
            .lock()
            .expect("process registry mutex poisoned")
            .remove(&id);
        if let Some(managed) = managed {
            let (result, keep) = service::stop_one(managed);
            if let Some(managed) = keep {
                registry
                    .lock()
                    .expect("process registry mutex poisoned")
                    .insert(managed.launch_id.clone(), managed);
            }
            results.push(result);
        }
    }

    let stopped_at = chrono::Utc::now().to_rfc3339();
    let total_count = results.len() as u32;
    let success_count = results
        .iter()
        .filter(|r| matches!(r.status, StopStatus::Stopped))
        .count() as u32;
    let already_exited_count = results
        .iter()
        .filter(|r| matches!(r.status, StopStatus::AlreadyExited))
        .count() as u32;
    let failure_count = results
        .iter()
        .filter(|r| matches!(r.status, StopStatus::Failed))
        .count() as u32;

    Ok(StopPresetProcessesResult {
        preset_id,
        stopped_at,
        total_count,
        success_count,
        already_exited_count,
        failure_count,
        results,
    })
}
