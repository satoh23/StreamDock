mod app_logs;
mod error;
mod preset_items;
mod presets;
mod process;
mod tools;
mod util;

use std::collections::HashMap;
use std::sync::Mutex;

use rusqlite::Connection;
use tauri::Manager;

use process::registry::ManagedProcess;

/// 021: カスタムタイトルバーの出し分け（macOS=信号機回避の左余白 / Windows=自作制御ボタン）に使う
/// ホスト OS 名。ユーザー入力を取らず固定文字列（"macos"/"windows"/"linux" 等）を返すのみ。
#[tauri::command]
fn host_os() -> &'static str {
    std::env::consts::OS
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        // 019: ログイン項目登録。macOS は LaunchAgent 方式。OS がログイン時に起動する際
        // `--autostart` を渡し、起動時フックで手動起動と区別する。
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ))
        .setup(|app| {
            // アプリデータディレクトリに SQLite を開き、State として共有する
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let db_path = data_dir.join("stream-dock.db");
            let conn = Connection::open(&db_path)?;
            // 外部キー制約を有効化する（接続ごとに必要）。
            // preset_items → presets / tools のカスケード削除を効かせ、孤児行を防ぐ。
            conn.execute("PRAGMA foreign_keys = ON", [])?;
            tools::repository::init(&conn)?;
            presets::repository::init(&conn)?;
            preset_items::repository::init(&conn)?;
            app_logs::repository::init(&conn)?;
            app.manage(Mutex::new(conn));
            // stream-dock がこのセッション中に起動したプロセスを保持する runtime process registry。
            // 009 の停止は raw PID ではなくここに保持した Child ハンドル経由で行う。
            app.manage(Mutex::new(HashMap::<String, ManagedProcess>::new()));

            // 019: 起動時フック。`--autostart`（OS がログイン時に起動）かどうかで挙動を分ける。
            // 任意のローカルプロセスが本バイナリを `--autostart` 付きで起動して無人一括起動を誘発しうるが、
            // 起動対象は resolve_preset_targets→launch_preset_targets→validate_executable 経由の
            // 登録済み・検証済みツールに限定され、権限昇格にはならないため受容する（019 security-review）。
            let is_autostart = std::env::args().any(|a| a == "--autostart");

            // 起動時 reconcile: 前回セッションで全フラグ解除された場合にログイン項目を是正する。
            {
                let db = app.state::<tools::commands::DbState>();
                let conn = db.lock().expect("db mutex poisoned");
                presets::commands::reconcile_autostart(app.handle(), &conn);
            }

            // ウィンドウ制御: config はデフォルト(visible:true)。手動起動・自動起動とも通常表示にする
            //（自動起動時も、立ち上がったツールを管理しやすいよう最小化しない — ユーザー確認済み 019）。
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                // 021: カスタムタイトルバー。macOS は config の titleBarStyle="Overlay" で
                // ネイティブ信号機を残す。Windows は static config の decorations 衝突を避けるため、
                // ここで実行時にフレームレス化し、フロントの自作 min/max/close で操作する。
                #[cfg(target_os = "windows")]
                {
                    let _ = window.set_decorations(false);
                }
            }

            // `--autostart` のときのみ、フラグ付きプリセットのツールを別スレッドで自動一括起動する。
            // ウィンドウ生成をブロックしないよう別スレッド化し、既存 resolve/launch を再利用する
            //（新規 spawn 経路を作らない）。手動起動では発火させない。
            if is_autostart {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    boot_launch_presets(handle);
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            host_os,
            tools::commands::create_tool,
            tools::commands::list_tools,
            tools::commands::get_tool,
            tools::commands::update_tool,
            tools::commands::delete_tool,
            tools::commands::extract_app_icon,
            process::commands::launch_tool,
            process::commands::focus_process,
            process::commands::launch_preset,
            process::commands::stop_process,
            process::commands::stop_preset_processes,
            process::commands::list_runtime_processes,
            process::commands::list_preset_runtime_processes,
            presets::commands::create_preset,
            presets::commands::list_presets,
            presets::commands::get_preset,
            presets::commands::update_preset,
            presets::commands::delete_preset,
            preset_items::commands::add_tool_to_preset,
            preset_items::commands::list_preset_items,
            preset_items::commands::list_all_preset_items,
            preset_items::commands::remove_tool_from_preset,
            preset_items::commands::update_preset_item,
            preset_items::commands::reorder_preset_items,
            app_logs::commands::list_app_logs,
            app_logs::commands::get_diagnostic_summary,
            app_logs::commands::clear_app_logs,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// 019: `--autostart` 起動時に、auto_launch_on_boot フラグ付きプリセットのツールを
/// 既存の一括起動ロジック（`resolve_preset_targets` / `launch_preset_targets`）で自動起動する。
/// ブロッキングを避けるため setup から別スレッドで呼ばれる。best-effort（失敗は app_logs に記録）。
fn boot_launch_presets(handle: tauri::AppHandle) {
    use app_logs::model::{LogCategory, LogLevel, NewLog};
    use app_logs::service::record;
    use error::ErrorCode;

    let db = handle.state::<tools::commands::DbState>();
    let registry = handle.state::<process::registry::ProcessRegistry>();

    // フラグ付きプリセット一覧を取得（DB ロックは最小限で解放する）。
    let presets = {
        let conn = db.lock().expect("db mutex poisoned");
        presets::repository::list_auto_launch_on_boot(&conn).unwrap_or_default()
    };

    for preset in presets {
        // 開始ログ。
        {
            let conn = db.lock().expect("db mutex poisoned");
            record(
                &conn,
                NewLog::new(
                    LogLevel::Info,
                    LogCategory::BulkLaunch,
                    "autostart_launch_preset",
                    "自動起動: 一括起動を開始しました",
                )
                .preset_id(preset.id.clone()),
            );
        }

        // 起動対象を解決（DB ロックを取り、spawn 前に解放する）。
        let targets = {
            let conn = db.lock().expect("db mutex poisoned");
            match process::service::resolve_preset_targets(&conn, &preset.id) {
                Ok(targets) => targets,
                Err(e) => {
                    record(
                        &conn,
                        NewLog::new(
                            LogLevel::Error,
                            LogCategory::BulkLaunch,
                            "autostart_launch_preset",
                            e.code.log_message(),
                        )
                        .error_code(e.code)
                        .preset_id(preset.id.clone()),
                    );
                    continue;
                }
            }
        };

        // 既存の DB 非依存ランチャで best-effort 起動（新規 spawn 経路を作らない）。
        let result = process::service::launch_preset_targets(&preset.id, targets, &registry);

        // 完了ログ（launch_preset command と同じ分岐）。
        // 成功/一部失敗/全失敗の分岐は launch_preset command と重複するが、operation 名
        // ("autostart_launch_preset") とスレッド文脈が異なるため共通化せず意図的に踏襲する。
        let entry = if result.failure_count == 0 {
            NewLog::new(
                LogLevel::Info,
                LogCategory::BulkLaunch,
                "autostart_launch_preset",
                format!(
                    "自動起動: 一括起動が完了しました（成功 {} 件）",
                    result.success_count
                ),
            )
        } else if result.success_count == 0 {
            NewLog::new(
                LogLevel::Error,
                LogCategory::BulkLaunch,
                "autostart_launch_preset",
                format!(
                    "自動起動: 一括起動に失敗しました（{} 件すべて失敗）",
                    result.failure_count
                ),
            )
            .error_code(ErrorCode::BulkLaunchFailed)
        } else {
            NewLog::new(
                LogLevel::Warn,
                LogCategory::BulkLaunch,
                "autostart_launch_preset",
                format!(
                    "自動起動: 一部のツールを起動できませんでした（成功 {} / 失敗 {}）",
                    result.success_count, result.failure_count
                ),
            )
            .error_code(ErrorCode::BulkLaunchPartialFailed)
        };
        let conn = db.lock().expect("db mutex poisoned");
        record(&conn, entry.preset_id(preset.id.clone()));
    }
}
