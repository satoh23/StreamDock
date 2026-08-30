//! 063h: ガチャ抽選記録の Tauri コマンド。
//!
//! ⚠⚠⚠ **本モジュールのコマンドは 1 本だけである**（docs/security.md §3・§9 追補〔063h〕）。
//! **削除・更新・一括操作・一覧取得のコマンドを足さないこと**:
//!
//! - 削除は既存の `delete_viewer` / `clear_viewers` に相乗りする（`viewer_memory::service`）。
//!   ⚠ 専用の削除コマンドを作ると、**アプリ定義コマンドは ACL を通らず全窓から呼べる**ので、
//!   「任意の行を消せる」能力が構造側に生まれる（062b の §3 の議論と同じ）。
//! - 一覧を返すコマンドは [063i](../../../../docs/tasks/063i-gacha-summary-view.md) の仕事で、
//!   ⚠ そちらも**引数はセッション id 1 つだけ**にすること（任意条件の汎用クエリにしない）。
//!
//! ⚠ アプリ定義コマンドなので capability（ACL）は増えない
//! （docs/security.md「コメントビューア（配信サービス連携）方針」⑪）。

use tauri::State;

use crate::app_logs;
use crate::app_logs::model::LogCategory;
use crate::error::AppResult;
use crate::tools::commands::DbState;

use super::model::NewGachaDraw;
use super::service;

/// ガチャの抽選 1 回を記録する。
///
/// ⚠⚠ **戻り値は `()`**（挿入されたかどうかを返さない）。返すと「その記録は既にあるか」を
/// 全窓から問い合わせられることになり、§3 の最小権限に反する。
///
/// ⚠⚠⚠ **frontend は失敗を握り潰す**（best-effort・`recordComments` と同じ）ので、
/// **ここで弾いた抽選は画面のどこにも出ずに消える**。⚠ 検証を厳しくしすぎないこと
/// （`service::MAX_GACHA_TEXT_CHARS` の注記が正）。
///
/// ⚠ ログは**失敗時のみ**・`ErrorCode` 由来の**固定安全文言**だけ。
/// **景品名・ガチャ名・表示名・視聴者 id・件数は 1 つも出さない**（§9）。
#[tauri::command]
pub fn record_gacha_draw(db: State<'_, DbState>, draw: NewGachaDraw) -> AppResult<()> {
    let conn = db.lock().expect("db mutex poisoned");
    let result = service::record(&conn, draw);
    app_logs::service::log_command_err(&conn, LogCategory::Storage, "record_gacha_draw", &result);
    result
}
