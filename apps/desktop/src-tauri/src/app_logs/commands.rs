use tauri::State;

use crate::error::AppResult;
use crate::process::registry::ProcessRegistry;
use crate::tools::commands::DbState;

use super::model::{AppLogEntry, DiagnosticSummary};
use super::service;

/// 直近のアプリ内ログを返す（011 Error Handling / Logs）。
///
/// frontend からは limit のみを受け取る。任意 SQL / 任意検索条件は渡せず、上限は Rust 側で
/// clamp する（既定 50・最大 200）。ログ保存先は Rust が固定し、任意 path の読み書きはできない。
#[tauri::command]
pub fn list_app_logs(db: State<'_, DbState>, limit: Option<u32>) -> AppResult<Vec<AppLogEntry>> {
    let conn = db.lock().expect("db mutex poisoned");
    service::list(&conn, limit)
}

/// ユーザーが開発者へ共有しやすい診断サマリーを返す（011）。
///
/// 直近の error / warn ＋ 現在の runtime process 状態をまとめる。full path や環境変数など
/// 危険な情報は含めない。クリップボードへのコピーは frontend 側で行う。
///
/// 副作用の注記: 内部で呼ぶ `process::service::snapshot` は終了検知したプロセスを registry から
/// 除去する（`list_runtime_processes` と同挙動）。よってこの command は純粋な read ではなく、
/// 呼び出しで registry を mutate しうる。
/// ロック順の注記: ここは db ロックを保持したまま registry ロックを取る唯一の箇所（db → registry）。
/// 現状 registry → db の順で取る経路は無いためデッドロックしないが、将来 registry 保持中に
/// ログ書き込み（db ロック）を追加する場合はこの順序に注意すること。
#[tauri::command]
pub fn get_diagnostic_summary(
    db: State<'_, DbState>,
    registry: State<'_, ProcessRegistry>,
) -> AppResult<DiagnosticSummary> {
    let conn = db.lock().expect("db mutex poisoned");
    service::diagnostic_summary(&conn, &registry)
}

/// アプリ内ログをすべて削除する（ユーザーテストの履歴リセット用）。
#[tauri::command]
pub fn clear_app_logs(db: State<'_, DbState>) -> AppResult<()> {
    let conn = db.lock().expect("db mutex poisoned");
    service::clear(&conn)
}
