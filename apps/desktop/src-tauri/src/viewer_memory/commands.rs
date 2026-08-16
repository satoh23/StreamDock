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

use super::model::{
    ListViewersInput, RecordResult, ViewerDetail, ViewerImportResult, ViewerRecord,
};
use super::service;

/// 受信済みコメントを 1 件記録する（視聴者 upsert＋集計＋過去コメント追加）。戻り値は 038c 判定（初見／久しぶり）。
///
/// `comment` は frontend が loopback WS で受信済みの値。ここで新規の外部通信・宛先・capability は増えない
/// （受信済みの値を Tauri コマンドで渡すだけ・sidecar / main の no-internet 境界は不変）。戻り値は真偽 2 値
/// （`firstTime`/`longAbsence`）のみで視聴者本文・時刻は含めない（端末外/ログ非露出・§9）。
#[tauri::command]
pub fn record_comment(
    db: State<'_, DbState>,
    comment: CommentViewDto,
    session_id: String,
) -> AppResult<RecordResult> {
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

/// 065a: 取り込み元コメントビューアーの公式 CSV エクスポートを読んで `viewers` へ引き継ぐ。
///
/// ⚠⚠ **StreamDock は取り込み元のアプリへ一切接続しない。** 読むのは**ユーザーが dialog で選んだ 1 ファイル**だけで、
/// **新規 egress ゼロ・新規宛先ゼロ・新規 capability ゼロ**（`dialog:allow-open` は 060b で付与済み・
/// `fs:*` はゼロのまま）。取り込み元アプリの DB の直読みも HTTP API 連携も**採らないと決めている**
/// （規約上の線引きは `docs/tasks/065-onecomme-viewer-import.md`・docs/security.md ⑪ の 065a 節）。
///
/// ⚠ **単一目的**（§3）。汎用の `read_file(path)` 型ではない——読める形は `.csv` に限られ、
/// **読んだ内容を 1 バイトも返さない**（戻り値は件数 4 つだけ）。取り込んだ値を読み出すのは既存の
/// `list_viewers` / `get_viewer` で、どちらもパスを取らないので「2 本合成すれば任意ファイルが読める」
/// という 060b の形が構造的に成立しない。
///
/// ⚠ **戻り値に視聴者名・メモ・ID を載せない**（§9。`ViewerImportResult` の doc とテストが固定）。
/// 失敗は `log_command_err` の固定安全文言のみを記録する（本文・パスをログに出さない）。
///
/// `async fn` にしているのは `import_overlay_theme` と同じ理由——ユーザーが選ぶファイルは
/// 応答の遅いボリューム上にありうるので、Tauri v2 が同期コマンドを走らせるメインスレッドを塞がない。
/// ⚠ 中身はブロッキング I/O のままなので、正確には「メインスレッドは止まらないが async runtime の
/// ワーカーを 1 本塞ぐ」状態である（本来形は `spawn_blocking`）。UNC を弾くので発生確率は低く、
/// 060b と同じ構えで現状維持とする。
#[tauri::command]
pub async fn import_viewer_memory_csv(
    db: State<'_, DbState>,
    path: String,
) -> AppResult<ViewerImportResult> {
    // ⚠⚠ **読み込みは DB ロックの外**（060b と同じ。ロックの内側で応答しないボリュームを掴むと
    //   アプリ全体の DB コマンドが止まる）。詳細は `service::read_import_csv` の注記。
    // ⚠⚠ **この 2 行の順序はテストで守れない**（`#[tauri::command]` なので単体テストが無く、
    //   `db.lock()` の下へ移す変異はテストが 1 本もレッドにならない・060b も同じ状態）。
    //   ⇒ **順序を動かすときは必ず `service::read_import_csv` の doc を読むこと。**
    let source = service::read_import_csv(&path)?;
    let conn = db.lock().expect("db mutex poisoned");
    let result = service::import_csv(&conn, &source);
    app_logs::service::log_command_err(
        &conn,
        LogCategory::Storage,
        "import_viewer_memory_csv",
        &result,
    );
    result
}
