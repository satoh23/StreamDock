use tauri::State;

use crate::app_logs;
use crate::app_logs::model::{LogCategory, LogLevel, NewLog};
use crate::error::{AppError, AppResult, ErrorCode};
use crate::util::now_rfc3339;
use crate::presets;
use crate::tools;
use crate::tools::commands::DbState;

use super::model::{
    BulkLaunchPresetResult, LaunchToolResult, RuntimeProcess, RuntimeProcessStatus,
    StopPresetProcessesResult, StopProcessResult, StopStatus,
};
use super::registry::ProcessRegistry;
use super::service;

/// 構造化ログを1件記録する（DB ロックを短時間だけ取得する）。
///
/// プロセスの spawn / kill 中はロックを保持しない設計を守るため、ログ書き込みは
/// 結果確定後にこのヘルパで行う。書き込み失敗は握りつぶす（業務操作を壊さない）。
///
/// best-effort のため、lock 失敗（poison）時も panic せず黙ってスキップする。`log()` は結果確定後に
/// 呼ばれるため、成功済みの業務操作を「記録の失敗」で巻き込まないことを優先する。
/// 業務ロジック側の `db.lock()` は poison＝続行不能として `expect` のままにし、ログだけ握りつぶす
/// という使い分け。
fn log(db: &State<'_, DbState>, entry: NewLog) {
    if let Ok(conn) = db.lock() {
        app_logs::service::record(&conn, entry);
    }
}

/// 登録済み Tool を toolId で単体起動する。
///
/// frontend からは toolId のみを受け取る。Tool の取得と executablePath の検証は Rust 側で行い、
/// shell を経由せず保存済み executablePath を直接起動する。
/// 009: 起動した Child を runtime process registry に登録し、停止操作用の launchId を返す。
/// 011: 成功・失敗を app_logs に記録する。
#[tauri::command]
pub fn launch_tool(
    db: State<'_, DbState>,
    registry: State<'_, ProcessRegistry>,
    id: String,
) -> AppResult<LaunchToolResult> {
    if id.trim().is_empty() {
        let err = AppError::validation("toolId は必須です");
        log(
            &db,
            NewLog::new(LogLevel::Error, LogCategory::ProcessLaunch, "launch_tool", err.code.log_message())
                .error_code(err.code),
        );
        return Err(err);
    }

    // DB ロックは Tool の取得だけで解放し、プロセス spawn 中は保持しない。
    let tool = {
        let conn = db.lock().expect("db mutex poisoned");
        match tools::service::get(&conn, &id) {
            Ok(tool) => tool,
            Err(e) => {
                app_logs::service::record(
                    &conn,
                    NewLog::new(LogLevel::Error, LogCategory::ProcessLaunch, "launch_tool", e.code.log_message())
                        .error_code(e.code),
                );
                return Err(e);
            }
        }
    };

    match service::spawn(&tool) {
        Ok(handle) => {
            // macOS `.app` の未同定起動時は実 PID がまだ無い（resolved_pid = None）。ログには載せず、
            // wire 値（LaunchToolResult.process_id: u32）は 0 に丸める（診断表示のみ）。
            let resolved_pid = handle.resolved_pid();
            let process_id = handle.wire_pid();
            let started_at = now_rfc3339();
            let launch_id = service::register(&registry, &tool, None, None, handle, started_at.clone());
            let mut entry = NewLog::new(
                LogLevel::Info,
                LogCategory::ProcessLaunch,
                "launch_tool",
                format!("{} を起動しました", tool.name),
            )
            .tool(tool.id.clone(), tool.name.clone())
            .launch_id(launch_id.clone());
            if let Some(pid) = resolved_pid {
                entry = entry.process_id(pid);
            }
            log(&db, entry);
            Ok(LaunchToolResult {
                launch_id,
                tool_id: tool.id,
                process_id,
                started_at,
            })
        }
        Err(e) => {
            log(
                &db,
                NewLog::new(LogLevel::Error, LogCategory::ProcessLaunch, "launch_tool", e.code.log_message())
                    .error_code(e.code)
                    .tool(tool.id.clone(), tool.name.clone()),
            );
            Err(e)
        }
    }
}

/// 選択中 Preset に紐づく enabled な PresetItem を一括起動する（008）。
///
/// frontend からは presetId のみを受け取る。Preset / PresetItem / Tool の取得と executablePath の検証は
/// Rust 側で行い、shell を経由せず保存済み executablePath を直接起動する。
/// best-effort 起動のため、1つの失敗で全体を中断せず成功・失敗を集約して返す。
/// 009: 起動に成功したプロセスは registry に登録し、各結果に launchId を含める。
/// 011: 開始・完了（全成功 / 一部失敗 / 全失敗）を app_logs に記録する。
#[tauri::command]
pub fn launch_preset(
    db: State<'_, DbState>,
    registry: State<'_, ProcessRegistry>,
    preset_id: String,
) -> AppResult<BulkLaunchPresetResult> {
    if preset_id.trim().is_empty() {
        let err = AppError::validation("presetId は必須です");
        log(
            &db,
            NewLog::new(LogLevel::Error, LogCategory::BulkLaunch, "launch_preset", err.code.log_message())
                .error_code(err.code),
        );
        return Err(err);
    }

    // DB ロックは起動対象の解決だけで解放し、プロセス spawn 中は保持しない。
    let targets = {
        let conn = db.lock().expect("db mutex poisoned");
        match service::resolve_preset_targets(&conn, &preset_id) {
            Ok(targets) => targets,
            Err(e) => {
                app_logs::service::record(
                    &conn,
                    NewLog::new(LogLevel::Error, LogCategory::BulkLaunch, "launch_preset", e.code.log_message())
                        .error_code(e.code)
                        .preset_id(preset_id.clone()),
                );
                return Err(e);
            }
        }
    };

    log(
        &db,
        NewLog::new(LogLevel::Info, LogCategory::BulkLaunch, "launch_preset", "一括起動を開始しました")
            .preset_id(preset_id.clone()),
    );

    let result = service::launch_preset_targets(&preset_id, targets, &registry);

    let entry = if result.failure_count == 0 {
        NewLog::new(
            LogLevel::Info,
            LogCategory::BulkLaunch,
            "launch_preset",
            format!("一括起動が完了しました（成功 {} 件）", result.success_count),
        )
    } else if result.success_count == 0 {
        NewLog::new(
            LogLevel::Error,
            LogCategory::BulkLaunch,
            "launch_preset",
            format!("一括起動に失敗しました（{} 件すべて失敗）", result.failure_count),
        )
        .error_code(ErrorCode::BulkLaunchFailed)
    } else {
        NewLog::new(
            LogLevel::Warn,
            LogCategory::BulkLaunch,
            "launch_preset",
            format!(
                "一部のツールを起動できませんでした（成功 {} / 失敗 {}）",
                result.success_count, result.failure_count
            ),
        )
        .error_code(ErrorCode::BulkLaunchPartialFailed)
    };
    log(&db, entry.preset_id(preset_id.clone()));

    Ok(result)
}

/// launchId で単体プロセスを停止する（009）。
///
/// frontend からは launchId のみを受け取る。停止対象は runtime process registry に登録された
/// プロセスに限定し、raw PID / path / command を frontend から受け取らない。
/// registry に該当が無ければ `not-found` を返し、何も停止しない。
/// 011: 停止結果（stopped / already-exited / failed / not-found）を app_logs に記録する。
#[tauri::command]
pub fn stop_process(
    db: State<'_, DbState>,
    registry: State<'_, ProcessRegistry>,
    launch_id: String,
) -> AppResult<StopProcessResult> {
    if launch_id.trim().is_empty() {
        let err = AppError::validation("launchId は必須です");
        log(
            &db,
            NewLog::new(LogLevel::Error, LogCategory::ProcessStop, "stop_process", err.code.log_message())
                .error_code(err.code),
        );
        return Err(err);
    }

    // ロックは registry からの取り出しだけで解放し、kill / wait 中は保持しない。
    let managed = registry
        .lock()
        .expect("process registry mutex poisoned")
        .remove(&launch_id);

    let Some(managed) = managed else {
        // registry に無い launchId は停止対象外。frontend が任意 launchId を渡しても停止しない。
        log(
            &db,
            NewLog::new(LogLevel::Warn, LogCategory::ProcessStop, "stop_process", "停止対象のプロセスが見つかりませんでした")
                .launch_id(launch_id.clone()),
        );
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

    log(&db, stop_log_entry("stop_process", &result));
    Ok(result)
}

/// 選択中 Preset に紐づく、registry 登録済みプロセスをまとめて停止する（009）。
///
/// frontend からは presetId のみを受け取る。Rust 側で registry を検索し、その presetId に
/// 紐づく managed process だけを停止する。対象が0件でも totalCount=0 の正常結果を返す。
/// 011: 集計結果（成功 / 既終了 / 失敗）を app_logs に記録する。
#[tauri::command]
pub fn stop_preset_processes(
    db: State<'_, DbState>,
    registry: State<'_, ProcessRegistry>,
    preset_id: String,
) -> AppResult<StopPresetProcessesResult> {
    if preset_id.trim().is_empty() {
        let err = AppError::validation("presetId は必須です");
        log(
            &db,
            NewLog::new(LogLevel::Error, LogCategory::ProcessStop, "stop_preset_processes", err.code.log_message())
                .error_code(err.code),
        );
        return Err(err);
    }

    // Preset 実在チェック（DB ロックは確認のみで解放）。
    {
        let conn = db.lock().expect("db mutex poisoned");
        if let Err(e) = presets::service::get(&conn, &preset_id) {
            app_logs::service::record(
                &conn,
                NewLog::new(LogLevel::Error, LogCategory::ProcessStop, "stop_preset_processes", e.code.log_message())
                    .error_code(e.code)
                    .preset_id(preset_id.clone()),
            );
            return Err(e);
        }
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

    let stopped_at = now_rfc3339();
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

    let result = StopPresetProcessesResult {
        preset_id,
        stopped_at,
        total_count,
        success_count,
        already_exited_count,
        failure_count,
        results,
    };

    let entry = if result.failure_count > 0 {
        NewLog::new(
            LogLevel::Error,
            LogCategory::ProcessStop,
            "stop_preset_processes",
            format!(
                "プロセス停止に一部失敗しました（停止 {} / 既終了 {} / 失敗 {}）",
                result.success_count, result.already_exited_count, result.failure_count
            ),
        )
        .error_code(ErrorCode::StopFailed)
    } else {
        NewLog::new(
            LogLevel::Info,
            LogCategory::ProcessStop,
            "stop_preset_processes",
            format!(
                "プリセットのプロセスを停止しました（停止 {} / 既終了 {}）",
                result.success_count, result.already_exited_count
            ),
        )
    };
    log(&db, entry.preset_id(result.preset_id.clone()));

    Ok(result)
}

/// 単体停止結果から app_logs のエントリを組み立てる。
fn stop_log_entry(operation: &'static str, result: &StopProcessResult) -> NewLog {
    let entry = match result.status {
        StopStatus::Stopped => NewLog::new(
            LogLevel::Info,
            LogCategory::ProcessStop,
            operation,
            format!("{} を停止しました", result.tool_name),
        ),
        StopStatus::AlreadyExited => NewLog::new(
            LogLevel::Info,
            LogCategory::ProcessStop,
            operation,
            "プロセスは既に終了していました",
        )
        .error_code(ErrorCode::ProcessAlreadyExited),
        StopStatus::Failed => NewLog::new(
            LogLevel::Error,
            LogCategory::ProcessStop,
            operation,
            result
                .error_message
                .clone()
                .unwrap_or_else(|| "プロセスの停止に失敗しました".to_string()),
        )
        .error_code(ErrorCode::StopFailed),
        StopStatus::NotFound => NewLog::new(
            LogLevel::Warn,
            LogCategory::ProcessStop,
            operation,
            "停止対象のプロセスが見つかりませんでした",
        ),
    };
    let entry = entry.launch_id(result.launch_id.clone());
    if result.tool_id.is_empty() {
        entry
    } else {
        entry.tool(result.tool_id.clone(), result.tool_name.clone())
    }
}

/// runtime process registry の全 managed process の状態を返す（010 Runtime Status）。
///
/// frontend からは何も受け取らない。registry に登録されたプロセスだけを `try_wait()` で確認し、
/// 終了検知分は registry から除去する。raw PID / path / command による状態確認は行わない。
/// 011: 状態確認に失敗した（Error 状態の）プロセスがあれば app_logs に記録する。
#[tauri::command]
pub fn list_runtime_processes(
    db: State<'_, DbState>,
    registry: State<'_, ProcessRegistry>,
) -> AppResult<Vec<RuntimeProcess>> {
    let processes = service::snapshot(&registry, None);
    log_runtime_status_errors(&db, "list_runtime_processes", &processes);
    Ok(processes)
}

/// 選択中 Preset に紐づく managed process の状態を返す（010 Runtime Status）。
///
/// frontend からは presetId のみを受け取る。registry を presetId で絞り込み、`try_wait()` で
/// 状態確認する（単体起動 007 由来は preset_id を持たないため含まれない）。
/// 011: 状態確認に失敗した（Error 状態の）プロセスがあれば app_logs に記録する。
#[tauri::command]
pub fn list_preset_runtime_processes(
    db: State<'_, DbState>,
    registry: State<'_, ProcessRegistry>,
    preset_id: String,
) -> AppResult<Vec<RuntimeProcess>> {
    if preset_id.trim().is_empty() {
        return Err(AppError::validation("presetId は必須です"));
    }
    let processes = service::snapshot(&registry, Some(&preset_id));
    log_runtime_status_errors(&db, "list_preset_runtime_processes", &processes);
    Ok(processes)
}

/// snapshot 結果に Error 状態のプロセスがあれば runtime-status の warn ログを1件記録する。
/// snapshot は Error / Stopped を検知すると registry から除去するため、同一エラーで
/// 繰り返しログが増え続けることはない（poll ごとの spam を防ぐ）。
fn log_runtime_status_errors(db: &State<'_, DbState>, operation: &'static str, processes: &[RuntimeProcess]) {
    if processes
        .iter()
        .any(|p| matches!(p.status, RuntimeProcessStatus::Error))
    {
        log(
            db,
            NewLog::new(LogLevel::Warn, LogCategory::RuntimeStatus, operation, "一部プロセスの状態確認に失敗しました")
                .error_code(ErrorCode::RuntimeStatusFailed),
        );
    }
}
