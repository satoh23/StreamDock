//! 062b: 配信セッションの Tauri コマンド。
//!
//! 既存の viewer_memory と同型（`db: State<'_, DbState>` を受け、service へ委譲して `AppResult<T>` を返す）。
//! 変更系は `app_logs::service::log_command_err` で失敗のみ記録する（**セッション id・配信タイトルは
//! ログに出さない**＝`ErrorCode` 由来の固定安全文言のみ・docs/security.md §9）。DB 保存カテゴリは
//! `LogCategory::Storage` を流用する（配信セッション専用カテゴリは設けない）。
//!
//! ⚠ **すべて単一目的**（§3）。「セッションを任意に書き換える」汎用コマンドは作らない。
//! ⚠ アプリ定義コマンドなので capability（ACL）は増えない
//! （docs/security.md「コメントビューア（配信サービス連携）方針」⑪）。

use tauri::State;

use crate::app_logs;
use crate::app_logs::model::LogCategory;
use crate::error::AppResult;
use crate::tools::commands::DbState;

use super::model::StreamSessionRecord;
use super::service;

/// 配信セッションを開始する。**進行中があればそれを返す**（冪等）。
#[tauri::command]
pub fn start_stream_session(
    db: State<'_, DbState>,
    platforms: Vec<String>,
) -> AppResult<StreamSessionRecord> {
    let conn = db.lock().expect("db mutex poisoned");
    let result = service::start(&conn, &platforms);
    app_logs::service::log_command_err(
        &conn,
        LogCategory::Storage,
        "start_stream_session",
        &result,
    );
    result
}

/// 進行中の配信セッションを返す（無ければ `null`）。read-only。
///
/// ⚠⚠ **コメビュ窓がマウント時にこれを呼んでセッションを引き継ぐ**（窓を開き直しても
/// `session_id` が変わらない＝062b の主目的）。`start_stream_session` で代用すると
/// 「窓を開いた＝配信開始」になってしまうため、取得専用の経路を分けてある。
#[tauri::command]
pub fn get_active_stream_session(
    db: State<'_, DbState>,
) -> AppResult<Option<StreamSessionRecord>> {
    let conn = db.lock().expect("db mutex poisoned");
    service::active(&conn)
}

/// 進行中セッションのプラットフォームを**足す**（union・減らない）。
#[tauri::command]
pub fn update_stream_session_platforms(
    db: State<'_, DbState>,
    id: String,
    platforms: Vec<String>,
) -> AppResult<StreamSessionRecord> {
    let conn = db.lock().expect("db mutex poisoned");
    let result = service::update_platforms(&conn, &id, &platforms);
    app_logs::service::log_command_err(
        &conn,
        LogCategory::Storage,
        "update_stream_session_platforms",
        &result,
    );
    result
}

/// 配信セッションを終了する（冪等・既に終了済みなら `ended_at` を書き換えない）。
#[tauri::command]
pub fn end_stream_session(
    db: State<'_, DbState>,
    id: String,
) -> AppResult<StreamSessionRecord> {
    let conn = db.lock().expect("db mutex poisoned");
    let result = service::end(&conn, &id);
    app_logs::service::log_command_err(&conn, LogCategory::Storage, "end_stream_session", &result);
    result
}

/// 配信タイトル（手入力）を更新する。Rust 側で trim ／制御文字拒否 ／文字数上限を検証する（§8）。
#[tauri::command]
pub fn update_stream_session_title(
    db: State<'_, DbState>,
    id: String,
    title: String,
) -> AppResult<StreamSessionRecord> {
    let conn = db.lock().expect("db mutex poisoned");
    let result = service::update_title(&conn, &id, &title);
    app_logs::service::log_command_err(
        &conn,
        LogCategory::Storage,
        "update_stream_session_title",
        &result,
    );
    result
}

/// 配信セッションの一覧（開始時刻の降順）。read-only。
///
/// ⚠ フィルタ引数は 062d で足す。**既存データ（`stream_sessions` に行の無い `session_id`）は
/// ここに出てこない**（バックフィルしない＝セッションを捏造しないという 062b の決定）。
#[tauri::command]
pub fn list_stream_sessions(db: State<'_, DbState>) -> AppResult<Vec<StreamSessionRecord>> {
    let conn = db.lock().expect("db mutex poisoned");
    service::list(&conn)
}

/// 閉じ忘れたセッションを回収する。戻り値は閉じた件数。
///
/// ⚠⚠ **引数を取らない**（§3）。猶予時間は Rust 側の定数（`service::STALE_GRACE_MINUTES`）で、
/// frontend からは渡せない。渡せる形にすると `0` を送るだけで**進行中セッションを全部終了できる**
/// ——アプリ定義コマンドは ACL を通らず全窓から呼べるため、その能力は構造的に持たせない。
///
/// 呼び出し元は 2 か所:
/// 1. `lib.rs` の `setup()`（アプリ強制終了・クラッシュで宙ぶらりんになった行の回収）
/// 2. コメビュ窓のマウント時（`get_active_stream_session` の直前）。**猶予中に窓だけ閉じると
///    frontend のタイマーごと消える**ので、起動時だけでは前回の配信を次の配信に引き継いでしまう。
#[tauri::command]
pub fn close_stale_stream_sessions(db: State<'_, DbState>) -> AppResult<usize> {
    let conn = db.lock().expect("db mutex poisoned");
    let result = service::close_stale(&conn);
    app_logs::service::log_command_err(
        &conn,
        LogCategory::Storage,
        "close_stale_stream_sessions",
        &result,
    );
    result
}
