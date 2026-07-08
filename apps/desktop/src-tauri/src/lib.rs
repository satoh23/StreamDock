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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
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
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            tools::commands::create_tool,
            tools::commands::list_tools,
            tools::commands::get_tool,
            tools::commands::update_tool,
            tools::commands::delete_tool,
            process::commands::launch_tool,
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
