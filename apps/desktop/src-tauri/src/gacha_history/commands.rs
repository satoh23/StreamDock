//! 063h / 063i: ガチャ抽選記録の Tauri コマンド。
//!
//! ⚠⚠⚠ **本モジュールのコマンドは「記録 1 本 ＋ 読み出し 1 本」だけである**
//! （docs/security.md §3・§9 追補〔063h〕）。**削除・更新・一括操作のコマンドを足さないこと**:
//!
//! - 削除は既存の `delete_viewer` / `clear_viewers` に相乗りする（`viewer_memory::service`）。
//!   ⚠ 専用の削除コマンドを作ると、**アプリ定義コマンドは ACL を通らず全窓から呼べる**ので、
//!   「任意の行を消せる」能力が構造側に生まれる（062b の §3 の議論と同じ）。
//! - 読み出しは [`list_gacha_draws`] の 1 本で、⚠⚠ **引数はセッション id 1 つだけ**である
//!   （§9 追補〔063h〕§3 が 063i に対して名指しで求めている線）。
//!   ⚠ 「任意条件で絞る」「他のキーで引く」汎用クエリにしないこと。
//!
//! ⚠ アプリ定義コマンドなので capability（ACL）は増えない
//! （docs/security.md「コメントビューア（配信サービス連携）方針」⑪）。

use tauri::State;

use crate::app_logs;
use crate::app_logs::model::LogCategory;
use crate::error::AppResult;
use crate::tools::commands::DbState;

use super::model::{GachaDrawRecord, NewGachaDraw};
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

/// 1 回の配信ぶんのガチャ抽選記録を新しい順で返す（063i・read-only）。
///
/// ⚠⚠⚠ **`log_command_err` を付けない。** `stream_summary::commands` が
/// 「`list_viewers` / `get_active_stream_session` と同じ扱い。**取得系は失敗してもデータが壊れない**ので
/// ログを増やさない」という既存の線引きを明記しており、それに揃える（docs/security.md §9）。
/// ⚠ **同じモジュールの [`record_gacha_draw`]（書き込み）が付けているのと扱いが違う**のは意図であって、
/// 書き忘れではない。
///
/// ⚠ **保存は 1 ミリも増えない**（063i は 063h が解禁した範囲を読んで表示するだけ）。
/// 新しい項目を画面に出したくなったら、まず §9 追補〔063h〕を読み直すこと
/// ——**保存していないものは出せない**（`GachaDrawRecord` に `source` が無いのはそのため）。
#[tauri::command]
pub fn list_gacha_draws(
    db: State<'_, DbState>,
    session_id: String,
) -> AppResult<Vec<GachaDrawRecord>> {
    let conn = db.lock().expect("db mutex poisoned");
    service::list(&conn, &session_id)
}
