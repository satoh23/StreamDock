//! 061c: エフェクトテンプレートの Tauri コマンド（**4 本**）。
//!
//! 既存の `overlay_theme` / `tools` と同型で、`db: State<'_, DbState>` を受けて `service` へ委譲するだけ。
//! 変更系は `app_logs::service::log_command_err` で**失敗のみ**記録する（`ErrorCode` 由来の固定安全文言のみ・
//! **テンプレート名・フルパス・manifest 本文は 1 つもログへ出さない**・docs/security.md §9）。
//! DB 保存カテゴリは `LogCategory::Storage` を流用する（テンプレート専用カテゴリは設けない）。
//!
//! ⚠⚠ **アプリ定義コマンドは ACL の対象外なので、この 4 本は全 5 窓
//! （main / comment-viewer / comment-overlay / pinned-overlay / effect-overlay）から呼べる**（046b / 055b と同じ限界）。
//! capability で絞れないため、**コマンド自体を狭く作る**ことで担保している:
//! - 汎用の `write_file(path, content)` 型は作らない（§3）。書けるのは
//!   `app_data_dir/effects/<uuid v4>/media.<拡張子>` だけで、**保存先の組み立てにユーザー入力が入らない**。
//! - **`content` / `bytes` / `data` / `css` を受け取るコマンドは 1 本も無い。**
//!   受け取るのは `dir`（取り込み元フォルダ）と `id` だけである。
//! - `get_effect_template_media` は read-only で、返すのは**ユーザー自身が取り込んだテンプレートのメディア**。
//!   id で DB を引き、DB の `dir_name` と manifest の名前を検証してから読むので、
//!   **このコマンド単体では任意ファイル読み取りにならない**。
//!
//! ⚠⚠ **ただし `import_effect_template` は「パスを受け取る 2 本目のコマンド」である**
//! （1 本目は `overlay_theme::import_overlay_theme`）。docs/security.md §5 の 060b 例外節にある
//! 再修正トリガー「**この 2 本以外に `path` を受け取るコマンドが増えたら、この合成を再評価すること**」が
//! 061c で発火しており、再評価の結果は同 §5 の **061c 例外節**に記録してある。

use tauri::{AppHandle, State};

use crate::app_logs;
use crate::app_logs::model::LogCategory;
use crate::error::AppResult;
use crate::tools::commands::DbState;

use super::model::{EffectTemplateMedia, EffectTemplateRecord};
use super::service;

/// ユーザーが選んだフォルダを検証し、`app_data_dir/effects/<uuid v4>/` へ取り込む。
///
/// `dir` は frontend の `@tauri-apps/plugin-dialog` の `open({ directory: true })` が返した**生パス**なので、
/// Rust 側で必ず検証する（§8）。⚠ **ACL 対象外なので dialog 由来である保証は無い。**
/// ⚠ **capability の追加はゼロ**——main 窓は既に `dialog:allow-open` を持っており、
/// `open` コマンドは `options.directory` の分岐を内包している（ファイル選択とディレクトリ選択は同じ 1 コマンド）。
///
/// `async fn` にしているのは、ユーザーが選ぶフォルダが**ネットワークボリューム上にありうる**ため。
/// Tauri v2 は同期コマンドをメインスレッドで走らせるので、遅い I/O が UI を固める
/// （`overlay_theme::import_overlay_theme` と同じ判断）。
/// ⚠ 正確には `async` にしても**中身はブロッキング I/O のまま**なので「メインスレッドは止まらないが
/// async runtime のワーカーを 1 本塞ぐ」状態である（**本来形は `spawn_blocking`**）。
/// ⚠⚠ **「UNC を弾くので確率は低い」は理由にならない**（061c security-review S-6 で訂正）。
/// `validate_source_dir` は macOS の `/Volumes/...`（マウント済み共有）を**意図的に許容している**ので、
/// 「遅いネットワーク I/O がワーカーを塞ぐ」ケースはそのまま残っている。現状維持とするのは
/// **async コマンドが 2 本しか無い**（本コマンドと `overlay_theme::import_overlay_theme`）ためで、
/// 塞がるワーカーの本数が実用上ワーカー数に届かないという理由による。
/// **再修正トリガー＝取り込みが並列化される / async コマンドが 3 本目になったとき**——
/// そのときは `spawn_blocking` へ移すこと（両コマンドとも同じ形にする）。
#[tauri::command]
pub async fn import_effect_template(
    app: AppHandle,
    db: State<'_, DbState>,
    dir: String,
) -> AppResult<EffectTemplateRecord> {
    // ⚠⚠ **読み込みは DB ロックの外**（060b と同じ理由）。ユーザーが選ぶフォルダは
    // ネットワークボリューム上にありうるので、ロックの内側で読むと応答しないボリュームを掴んだときに
    // アプリ全体の DB コマンドが止まる。詳細は `service::read_import_source` の注記。
    let source = service::read_import_source(&dir)?;
    let root = service::effects_dir(&app)?;
    let conn = db.lock().expect("db mutex poisoned");
    let result = service::store_template(&root, &conn, &source);
    app_logs::service::log_command_err(
        &conn,
        LogCategory::Storage,
        "import_effect_template",
        &result,
    );
    result
}

/// 取り込み済みテンプレートの一覧（新しい順）。read-only。
///
/// ⚠ 返すのは表示と描画に要る値だけで、**実ファイル名（`dir_name` / `media` / `sound`）は含まない**
/// （`model::EffectTemplateRecord` の注記）。
#[tauri::command]
pub fn list_effect_templates(db: State<'_, DbState>) -> AppResult<Vec<EffectTemplateRecord>> {
    let conn = db.lock().expect("db mutex poisoned");
    service::list(&conn)
}

/// テンプレートのメディアを **data URI** で返す（061d の描画元）。
///
/// asset protocol も `fs` plugin も導入しない（039 / 060b と同じ発想で、`csp: null` を触らずに済む）。
/// ⚠ **完全な data URI を返す**（frontend 側の描画ガードが IPC 境界を越えてきた値を検査できるようにするため）。
#[tauri::command]
pub fn get_effect_template_media(
    app: AppHandle,
    db: State<'_, DbState>,
    id: String,
) -> AppResult<EffectTemplateMedia> {
    let root = service::effects_dir(&app)?;
    let conn = db.lock().expect("db mutex poisoned");
    service::read_media(&root, &conn, &id)
}

/// テンプレートを削除する（レジストリの行とディレクトリ実体の両方）。
#[tauri::command]
pub fn delete_effect_template(
    app: AppHandle,
    db: State<'_, DbState>,
    id: String,
) -> AppResult<()> {
    let root = service::effects_dir(&app)?;
    let conn = db.lock().expect("db mutex poisoned");
    let result = service::delete(&root, &conn, &id);
    app_logs::service::log_command_err(
        &conn,
        LogCategory::Storage,
        "delete_effect_template",
        &result,
    );
    result
}
