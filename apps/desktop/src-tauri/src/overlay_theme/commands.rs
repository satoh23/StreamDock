//! 060b: オーバーレイテーマの Tauri コマンド（**7 本**。060e で 6 本目、060c で 7 本目が入った）。
//!
//! 既存の `tools` / `viewer_memory` と同型で、`db: State<'_, DbState>` を受けて `service` へ委譲するだけ。
//! 変更系は `app_logs::service::log_command_err` で**失敗のみ**記録する（`ErrorCode` 由来の固定安全文言のみ・
//! **CSS 本文・フルパス・除去した URL は 1 つもログへ出さない**・docs/security.md §9）。
//! DB 保存カテゴリは `LogCategory::Storage` を流用する（テーマ専用カテゴリは設けない）。
//!
//! ⚠⚠ **アプリ定義コマンドは ACL の対象外なので、この 7 本は全 4 窓
//! （main / comment-viewer / comment-overlay / pinned-overlay）から呼べる**（046b / 055b と同じ限界）。
//! capability で絞れないため、**コマンド自体を狭く作る**ことで担保している:
//! - 汎用の `write_file(path, content)` 型は作らない（§3）。書けるのは
//!   `app_data_dir/themes/<uuid>.css` だけで、**パスは frontend から受け取らない**。
//! - `path` を受け取るのは `import_overlay_theme` の 1 本だけ。しかも用途は
//!   「`.css` を 1 つ読む」に限定され、読んだ内容は返さない（サニタイズして保存するだけ）。
//! - **`css` を受け取るのは 2 本だけ**＝`import_overlay_theme_text`（060e）と
//!   `import_overlay_theme_snapshot`（060c）。⚠ 本文を渡せても**書ける場所は変わらない**
//!   （保存先の組み立てにユーザー入力が 1 バイトも入らない）ので、§3 が禁じている
//!   「汎用の書き込み経路」にはならない。出現回数は契約テストが固定している。
//!   ⚠⚠ **3 本目を足すときは、060c と同じく §3 の再評価と security-review を通すこと**
//!   （契約テストが落ちること自体がその手順を呼ぶ仕掛けである）。
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

/// 060e: **貼り付けられた CSS テキスト**を `app_data_dir/themes/` へ取り込み、レジストリへ登録する。
///
/// ユーザーに `.css` ファイルを作らせずに済ませるための経路。保存先・ファイル名・サニタイズは
/// ファイル版とまったく同じ共通コア（`service::store_sanitized_css`）が受け持つ。
///
/// ⚠⚠ **`css: String` を受け取るコマンドはこの 1 本だけ**（契約テストが**出現回数**で固定している）。
/// docs/security.md §3 の禁止例（`write_file(path, content)` 型）に**当たらない**理由:
/// - 書き込み先は `app_data_dir/themes/<uuid v4>.css` の固定形だけで、**パスは frontend から受け取らない**
///   （`app_data_dir()` → `join("themes")` → `join("<uuid>.css")` の 3 手が各 1 か所に固定され、
///   結合直前に `is_managed_file_name()` を通す）。＝ **書ける場所をユーザー入力で動かせない。**
/// - 中身は**必ず `sanitize::sanitize_css` を通る**（外部参照を保存できない・取り除けない形は fail-closed）。
/// - 上限（**256KB** / **200 件**）と制御文字の検査も同じ共通コアが持っている
///   ＝ 無制限にディスクを増やす経路にならない。
///
/// ⚠ ファイル版（`import_overlay_theme`）より**攻撃面はむしろ狭い**——`path` を取らないので、
/// UNC / ネットワークパス経由の egress も、「拡張子 `.css` に限定された任意ファイル読み取り」の合成
/// （060b review② の受容事項）も**増えない**。
/// ⚠ **同期でよい**。触るのは `app_data_dir`（常にローカル）だけで、ネットワークボリュームを読まない
/// （非同期にしているのは、ユーザーが選ぶファイルを読むファイル版だけ）。
/// ⚠ CSS 本文はログにも戻り値にも出さない（§9）。
#[tauri::command]
pub fn import_overlay_theme_text(
    app: AppHandle,
    db: State<'_, DbState>,
    css: String,
    name: String,
) -> AppResult<OverlayThemeImportResult> {
    let dir = service::themes_dir(&app)?;
    let conn = db.lock().expect("db mutex poisoned");
    let result = service::import_pasted_text(&dir, &conn, &css, &name);
    app_logs::service::log_command_err(
        &conn,
        LogCategory::Storage,
        "import_overlay_theme_text",
        &result,
    );
    result
}

/// 060c: **外部 `@import` を取得してインライン展開した CSS** を取り込む（スナップショット）。
///
/// 呼び出し側（`OverlayThemeCard`）は「ユーザーが完全な URL とホストを目で見て同意した 1 回の GET の
/// 結果」を、`import_overlay_theme` / `import_overlay_theme_text` が返した**除去済み CSS の前に前置**して
/// 渡す（有効な CSS の `@import` は先頭にしか書けないので、前置＝原位置と等価）。
///
/// ⚠⚠ **`css: String` を受け取る 2 本目のコマンドである**（1 本目は `import_overlay_theme_text`）。
/// これは契約テスト `takes_no_arbitrary_path_or_content_from_the_frontend` を**設計どおり落とし**、
/// §3 の再評価と security-review を呼ぶための仕掛けだった。再評価の結論（`docs/security.md` §5 の
/// 060b 例外節「③ Snapshot 経路」に記載）:
/// - **増えない**: 保存先は `app_data_dir/themes/<uuid v4>.css` の固定形のままで、その組み立てに
///   ユーザー入力は 1 バイトも入らない。検証・サニタイズ・上限（256KB / 200 件）は
///   **`service::store_sanitized_css` の 1 セットだけ**で、`path` も取らない。
/// - **増える**: 本文の出所が「ネットワークから来たバイト列」になる（他の 2 本はローカル由来）。
///   ⚠ ただし **3 本ともサニタイズ前の本文を信頼していない**ので、扱いは変わらない。
///   取得できる形は sidecar の `assertAllowedThemeImportUrl`（`https:` / 443 / `.css` / SSRF 拒否 /
///   リダイレクト禁止 / `text/css` / サイズ・時間上限）で極端に狭めてある。
///
/// ⚠ **`origin` は引数に現れない**。`Snapshot` を立てるのは `service::import_fetched_snapshot` だけで、
/// frontend から出自は騙れない（`the_theme_origin_is_never_settable_from_the_frontend`）。
/// ⚠ **同期でよい**（触るのは `app_data_dir` だけ＝ネットワークボリュームを読まない。text 版と同じ判断）。
/// ⚠ CSS 本文も取得先 URL もログに出さない（§9）。
#[tauri::command]
pub fn import_overlay_theme_snapshot(
    app: AppHandle,
    db: State<'_, DbState>,
    css: String,
    name: String,
) -> AppResult<OverlayThemeImportResult> {
    let dir = service::themes_dir(&app)?;
    let conn = db.lock().expect("db mutex poisoned");
    let result = service::import_fetched_snapshot(&dir, &conn, &css, &name);
    app_logs::service::log_command_err(
        &conn,
        LogCategory::Storage,
        "import_overlay_theme_snapshot",
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

/// 060h: 取得した Web フォントを **`@font-face` だけの CSS** としてテーマへ添える（**2 つ目の管理ファイル**）。
///
/// ⚠⚠ **`css: String` を取る 3 本目**。契約テスト
/// `takes_no_arbitrary_path_or_content_from_the_frontend` が 2 → 3 で**設計どおり落ちた**ので、
/// `docs/security.md` §5 の 060b 例外節へ「④ フォント資産の再評価」を書いてから解禁している
/// （数字だけ書き換えて通してはいない）。再評価の要点:
/// - **増えない**: 保存先の組み立て（`app_data_dir/themes/<uuid v4>.css` の固定形）・`is_managed_file_name` の
///   完全一致・**サニタイズ 1 か所・書き込み 1 か所**（`service::write_sanitized_asset`）。
///   ＝ 書けるファイル名の集合も、書ける場所も **1 バイトも動いていない**。
/// - **増える**: ①1 テーマが持つ管理ファイルが最大 2 つになる ②本文の上限が資産種別で 2 値になる
///   （意匠 256KB / フォント 5MiB。⚠ **意匠側は動かしていない**）。
///
/// ⚠ **パスを受け取らない**（`id` と本文だけ）。⚠ **同期でよい**（触るのは `app_data_dir` だけ）。
/// ⚠ CSS 本文も取得先 URL もログに出さない（§9）。
#[tauri::command]
pub fn attach_overlay_theme_fonts(
    app: AppHandle,
    db: State<'_, DbState>,
    id: String,
    css: String,
) -> AppResult<()> {
    let dir = service::themes_dir(&app)?;
    let conn = db.lock().expect("db mutex poisoned");
    let result = service::attach_theme_fonts(&dir, &conn, &id, &css);
    app_logs::service::log_command_err(
        &conn,
        LogCategory::Storage,
        "attach_overlay_theme_fonts",
        &result,
    );
    result
}

/// 060h: テーマのフォント CSS を返す（無ければ空文字）。read-only。
///
/// ⚠ 意匠の `get_overlay_theme_css` と**別コマンドにしてある**。注入側が
/// **別の `<style>` に載せる**ためで、意匠側の戻り値に混ぜると
/// 「`rewriteSelectors` が数 MB を毎回走査する」という 060h 問題④そのものが復活する。
#[tauri::command]
pub fn get_overlay_theme_font_css(
    app: AppHandle,
    db: State<'_, DbState>,
    id: String,
) -> AppResult<String> {
    let dir = service::themes_dir(&app)?;
    let conn = db.lock().expect("db mutex poisoned");
    service::read_font_css(&dir, &conn, &id)
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
