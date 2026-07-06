mod error;
mod presets;
mod tools;

use std::sync::Mutex;

use rusqlite::Connection;
use tauri::Manager;

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
            tools::repository::init(&conn)?;
            presets::repository::init(&conn)?;
            app.manage(Mutex::new(conn));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            tools::commands::create_tool,
            tools::commands::list_tools,
            tools::commands::get_tool,
            tools::commands::update_tool,
            tools::commands::delete_tool,
            presets::commands::create_preset,
            presets::commands::list_presets,
            presets::commands::get_preset,
            presets::commands::update_preset,
            presets::commands::delete_preset,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
