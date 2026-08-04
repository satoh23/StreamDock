//! 060b: オーバーレイテーマの Tauri コマンド（5 本）。
//!
//! 既存の `tools` / `viewer_memory` と同型で、`db: State<'_, DbState>` を受けて `service` へ委譲するだけ。
//! 変更系は `app_logs::service::log_command_err` で**失敗のみ**記録する（`ErrorCode` 由来の固定安全文言のみ・
//! **CSS 本文・フルパス・除去した URL は 1 つもログへ出さない**・docs/security.md §9）。
//! DB 保存カテゴリは `LogCategory::Storage` を流用する（テーマ専用カテゴリは設けない）。
//!
//! ⚠⚠ **アプリ定義コマンドは ACL の対象外なので、この 5 本は全 4 窓
//! （main / comment-viewer / comment-overlay / pinned-overlay）から呼べる**（046b / 055b と同じ限界）。
//! capability で絞れないため、**コマンド自体を狭く作る**ことで担保している:
//! - 汎用の `write_file(path, content)` 型は作らない（§3）。書けるのは
//!   `app_data_dir/themes/<uuid>.css` だけで、**パスは frontend から受け取らない**。
//! - `path` を受け取るのは `import_overlay_theme` の 1 本だけ。しかも用途は
//!   「`.css` を 1 つ読む」に限定され、読んだ内容は返さない（サニタイズして保存するだけ）。
//! - `get_overlay_theme_css` は read-only で、返すのは**ユーザー自身が取り込み、サニタイザを通った CSS**。
//!   id で DB を引き、DB の `file_name` を検証してから読むので、**任意ファイル読み取りにはならない**。
//!   そもそも注入先のオーバーレイ窓・プレビューを出すコメビュ窓の 2 つが実際に必要とする。
//!
//! これらの評価は `docs/security.md` の「Capabilities 方針」に記録してある。

use tauri::{AppHandle, State};

use crate::app_logs;
use crate::app_logs::model::LogCategory;
use crate::error::AppResult;
use crate::tools::commands::DbState;

use super::model::{OverlayThemeImportResult, OverlayThemeRecord};
use super::service;

/// ローカルの `.css` を `app_data_dir/themes/` へ取り込み、レジストリへ登録する。
///
/// `path` は frontend の `@tauri-apps/plugin-dialog` の `open()` が返した**生パス**なので、
/// Rust 側で必ず検証する（§8）。保存されるのは**外部参照を除去した CSS** で、除去した `@import` の
/// 宛先だけを戻り値に載せる（060c の同意ダイアログ用・DB には持たない）。
///
/// `async fn` にしているのは、ユーザーが選ぶファイルが**ネットワークボリューム上にありうる**ため。
/// Tauri v2 は同期コマンドをメインスレッドで走らせるので、遅い I/O が UI を固める（`audio` の同型の判断）。
/// ⚠ 正確には、`async` にしても**中身はブロッキング I/O のまま**なので「メインスレッドは止まらないが
/// async runtime のワーカーを 1 本塞ぐ」状態である（本来形は `spawn_blocking`）。tokio のマルチスレッド
/// ランタイム上なので実害は小さく、`validate_source_path` が UNC を弾くようになって発生確率も下がったため
/// 現状維持とする。**再修正トリガー＝取り込みが並列化される / 他の重い async コマンドが増えたとき。**
/// ⚠ 逆に他の 4 本は同期のまま——DB 操作か、`app_data_dir`（常にローカル）配下の小さな読み書きしかしない
/// （read-only でローカルファイルを読む `obs_config::detect_obs_websocket_config` と同じ構え）。
#[tauri::command]
pub async fn import_overlay_theme(
    app: AppHandle,
    db: State<'_, DbState>,
    path: String,
    name: String,
) -> AppResult<OverlayThemeImportResult> {
    // ⚠⚠ **読み込みは DB ロックの外**（security-review 指摘）。ユーザーが選ぶファイルは
    // ネットワークボリューム上にありうるので、ロックの内側で読むと応答しないボリュームを掴んだときに
    // アプリ全体の DB コマンドが止まる。詳細は `service::read_import_source` の注記。
    let source = service::read_import_source(&path, &name)?;
    let dir = service::themes_dir(&app)?;
    let conn = db.lock().expect("db mutex poisoned");
    let result = service::import_local_source(&dir, &conn, &source);
    app_logs::service::log_command_err(
        &conn,
        LogCategory::Storage,
        "import_overlay_theme",
        &result,
    );
    result
}

/// 取り込み済みテーマの一覧（新しい順）。read-only。
#[tauri::command]
pub fn list_overlay_themes(db: State<'_, DbState>) -> AppResult<Vec<OverlayThemeRecord>> {
    let conn = db.lock().expect("db mutex poisoned");
    service::list(&conn)
}

/// 保存済みテーマの CSS を**文字列で**返す（060d がオーバーレイへ注入する元）。
///
/// asset protocol も `fs` plugin も導入しない（039 の data URI 方式と同じ発想で、CSP を触らずに済む）。
#[tauri::command]
pub fn get_overlay_theme_css(
    app: AppHandle,
    db: State<'_, DbState>,
    id: String,
) -> AppResult<String> {
    let dir = service::themes_dir(&app)?;
    let conn = db.lock().expect("db mutex poisoned");
    service::read_css(&dir, &conn, &id)
}

/// テーマの表示名を変更する（ファイル実体には触れない）。
#[tauri::command]
pub fn rename_overlay_theme(
    db: State<'_, DbState>,
    id: String,
    name: String,
) -> AppResult<OverlayThemeRecord> {
    let conn = db.lock().expect("db mutex poisoned");
    let result = service::rename(&conn, &id, &name);
    app_logs::service::log_command_err(
        &conn,
        LogCategory::Storage,
        "rename_overlay_theme",
        &result,
    );
    result
}

/// テーマを削除する（レジストリの行とファイル実体の両方）。
#[tauri::command]
pub fn delete_overlay_theme(
    app: AppHandle,
    db: State<'_, DbState>,
    id: String,
) -> AppResult<()> {
    let dir = service::themes_dir(&app)?;
    let conn = db.lock().expect("db mutex poisoned");
    let result = service::delete(&dir, &conn, &id);
    app_logs::service::log_command_err(
        &conn,
        LogCategory::Storage,
        "delete_overlay_theme",
        &result,
    );
    result
}
