//! 038a: 視聴者メモリの Tauri コマンド。
//!
//! 既存の tools と同型（`db: State<'_, DbState>` を受け、service へ委譲して `AppResult<T>` を返す）。
//! 変更系は `app_logs::service::log_command_err` で失敗のみ記録する（本文・メモ・投げ銭履歴は
//! ログに出さない＝`ErrorCode` 由来の固定安全文言のみ記録・docs/security.md §9）。DB 保存カテゴリは
//! `LogCategory::Storage` を流用する（視聴者メモリ専用カテゴリは設けない）。

use tauri::State;

use crate::app_logs;
use crate::app_logs::model::LogCategory;
use crate::comment_viewer::model::CommentViewDto;
use crate::error::AppResult;
use crate::tools::commands::DbState;

use super::model::{ListViewersInput, ViewerDetail, ViewerRecord};
use super::service;

/// 受信済みコメントを 1 件記録する（視聴者 upsert＋集計＋過去コメント追加）。
///
/// `comment` は frontend が loopback WS で受信済みの値。ここで新規の外部通信・宛先・capability は増えない
/// （受信済みの値を Tauri コマンドで渡すだけ・sidecar / main の no-internet 境界は不変）。
#[tauri::command]
pub fn record_comment(
    db: State<'_, DbState>,
    comment: CommentViewDto,
    session_id: String,
) -> AppResult<()> {
    let conn = db.lock().expect("db mutex poisoned");
    let result = service::record_comment(&conn, comment, session_id);
    // 【注意】失敗時のみ記録（本文非露出・固定安全文言）。正常時は無ログ。DB が壊れていると毎コメント
    //   失敗ログが出得るため、頻発が問題化したら初回失敗のみ記録等の抑制を検討（S3）。
    app_logs::service::log_command_err(&conn, LogCategory::Storage, "record_comment", &result);
    result
}

#[tauri::command]
pub fn list_viewers(
    db: State<'_, DbState>,
    input: Option<ListViewersInput>,
) -> AppResult<Vec<ViewerRecord>> {
    let conn = db.lock().expect("db mutex poisoned");
    service::list(&conn, input)
}

#[tauri::command]
pub fn get_viewer(db: State<'_, DbState>, id: String) -> AppResult<ViewerDetail> {
    let conn = db.lock().expect("db mutex poisoned");
    service::get(&conn, &id)
}

#[tauri::command]
pub fn update_viewer_note(
    db: State<'_, DbState>,
    id: String,
    note: String,
) -> AppResult<ViewerRecord> {
    let conn = db.lock().expect("db mutex poisoned");
    let result = service::update_note(&conn, &id, note);
    app_logs::service::log_command_err(&conn, LogCategory::Storage, "update_viewer_note", &result);
    result
}

#[tauri::command]
pub fn delete_viewer(db: State<'_, DbState>, id: String) -> AppResult<()> {
    let conn = db.lock().expect("db mutex poisoned");
    let result = service::delete(&conn, &id);
    app_logs::service::log_command_err(&conn, LogCategory::Storage, "delete_viewer", &result);
    result
}

#[tauri::command]
pub fn clear_viewers(db: State<'_, DbState>) -> AppResult<()> {
    let conn = db.lock().expect("db mutex poisoned");
    let result = service::clear(&conn);
    app_logs::service::log_command_err(&conn, LogCategory::Storage, "clear_viewers", &result);
    result
}
