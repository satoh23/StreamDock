//! らくらくツール設定（外部アプリ連携）の Tauri コマンド（最小・明示・§3）。
//!
//! frontend からは raw なパス/URL/ポート/コマンドを受けず、`id`（＋公式ページは部品名の固定語）だけを
//! 受け取る。ネットワーク（ureq / `std::net`）は Rust 内で完結し IPC/ACL 対象外。公式ページを開くのは
//! opener の Rust API（ACL 不要）に限定する。非 Windows は各実装が「未対応」結果を返す。

use tauri::{AppHandle, Manager, State};
use tauri_plugin_opener::OpenerExt;

use crate::error::{AppError, AppResult};
use crate::process::registry::ProcessRegistry;
use crate::tools::commands::DbState;
use crate::util::validate_http_url;

use super::integrations::IntegrationCtx;
use super::model::{ConfigureResult, LaunchResult, ScanResult, VerifyResult};
use super::service;

/// 書換前バックアップの保存ルート（app 管理領域）。`<app_data_dir>/rakuraku-backups`。
fn backup_root(app: &AppHandle) -> AppResult<std::path::PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|_| AppError::storage("保存先の解決に失敗しました"))?;
    Ok(dir.join("rakuraku-backups"))
}

/// 連携実行コンテキストを組み立てる。032b 修正2: 導入検出・自動起動・configure の解決元として、
/// ツール管理に登録済みのツール一覧（`tools::service::list`）を DB から読んで注入する（imp は
/// global state を触らず、渡された `ctx.tools` だけを見る）。DB ロックは list 取得だけで解放する。
fn context(app: &AppHandle, db: &State<'_, DbState>) -> AppResult<IntegrationCtx> {
    let tools = {
        let conn = db.lock().expect("db mutex poisoned");
        crate::tools::service::list(&conn)?
    };
    Ok(IntegrationCtx {
        backup_root: backup_root(app)?,
        tools,
    })
}

/// 検出（scan・読み取り専用）。VOICEVOX/棒読みちゃんの導入（＝登録済み＆パス有効）・SAPI 登録・
/// 50021 稼働を確認する。`db` State は Tauri が注入する（frontend は `id` のみ渡す）。
#[tauri::command]
pub fn rakuraku_scan_integration(
    app: AppHandle,
    db: State<'_, DbState>,
    id: String,
) -> AppResult<ScanResult> {
    let ctx = context(&app, &db)?;
    service::find(&id)?.scan(&ctx)
}

/// 既導入・同意済みアプリ（未起動）の自動起動。`component` は "voicevox" / "bouyomichan" の固定語。
///
/// 032b 修正2: 起動対象は**ツール管理に登録済みで exe 名が一致する Tool の executablePath のみ**。
/// 未登録なら `launched=false`（frontend は「ツール管理へ追加」導線を出す）。起動は既存の管理付き
/// `process::service::spawn`＋`register`（`launch_tool` と同じプリミティブ）で行い、PID registry に載せて
/// 停止/監視対象にする（§6＝自 spawn 起動 PID のみ）。frontend は部品名の固定語だけ渡し raw パス非受領
/// （§2/§3）。**自動DL/インストールはしない**（誘導のみ）。app-log は増やさない（§9）。`db`/`registry`
/// State は Tauri が注入する（frontend invoke は `id`/`component` のみ）。
#[tauri::command]
pub fn rakuraku_launch_component(
    db: State<'_, DbState>,
    registry: State<'_, ProcessRegistry>,
    id: String,
    component: String,
) -> AppResult<LaunchResult> {
    let integration = service::find(&id)?;
    // 起動対象部品か（SAPI For VOICEVOX 等は起動しない＝誘導のみ）。
    let Some(expected_exe) = integration.component_exe(&component) else {
        return Ok(LaunchResult {
            supported: true,
            launched: false,
            message: "起動対象の部品ではありません。".to_string(),
        });
    };
    // 登録済みツールから exe 名一致で解決する（DB ロックは list 取得だけで解放）。
    let tools = {
        let conn = db.lock().expect("db mutex poisoned");
        crate::tools::service::list(&conn)?
    };
    let Some(tool) = service::resolve_tool_for_component(&tools, expected_exe) else {
        return Ok(LaunchResult {
            supported: true,
            launched: false,
            message: "ツール管理に登録してください。".to_string(),
        });
    };
    // 管理付き spawn（検証＋起動）＋ registry 登録（launch_tool と同経路）。launch_id は使わない
    // （frontend は scan 再ポーリングで起動判定するため戻さない＝LaunchResult の型構造は不変）。
    let handle = crate::process::service::spawn(tool)?;
    let _launch_id = crate::process::service::register(
        &registry,
        tool,
        None,
        None,
        handle,
        crate::util::now_rfc3339(),
    );
    Ok(LaunchResult {
        supported: true,
        launched: true,
        message: "アプリを起動しました。".to_string(),
    })
}

/// 設定書換（configure）。棒読みちゃん設定のみをバックアップ先取りしてから書き換える（§5 解禁範囲）。
#[tauri::command]
pub fn rakuraku_configure_integration(
    app: AppHandle,
    db: State<'_, DbState>,
    id: String,
) -> AppResult<ConfigureResult> {
    let ctx = context(&app, &db)?;
    service::find(&id)?.configure(&ctx)
}

/// 検証（verify）。VOICEVOX 50021 ヘルスチェック＋棒読みちゃん 50001 テスト送信（ループバックのみ・§1）。
#[tauri::command]
pub fn rakuraku_verify_integration(
    app: AppHandle,
    db: State<'_, DbState>,
    id: String,
) -> AppResult<VerifyResult> {
    let ctx = context(&app, &db)?;
    service::find(&id)?.verify(&ctx)
}

/// 不足部品の公式配布ページを開く（誘導のみ・自動DLはしない）。
///
/// frontend は `id` と部品名（固定語）だけを渡す。URL は Rust 側の固定定数から解決し、多層防御として
/// http/https 限定で検証してから opener の Rust API（ACL 不要）で開く（§1「公式サイトを開く」の範囲）。
#[tauri::command]
pub fn rakuraku_open_official_page(
    app: AppHandle,
    id: String,
    component: String,
) -> AppResult<()> {
    let integration = service::find(&id)?;
    let url = integration
        .official_page(&component)
        .ok_or_else(|| AppError::not_found("公式ページが見つかりません"))?;
    // process::service::open_url と「validate_http_url + opener」の形は似るが、あちらの対象は保存済みの
    // Tool.url。ここは Rust 固定定数のみを扱う別責務（誘導専用）なので、共有ヘルパ化せず rakuraku
    // スライス内に閉じる（frontend へ raw URL 面を作らない意図を型で明示するため）。
    // 固定定数 URL も念のため http/https に限定して検証する（多層防御）。
    let safe = validate_http_url(url)?;
    app.opener()
        .open_url(safe, None::<&str>)
        .map_err(|_| AppError::launch_failed("公式ページを開けませんでした"))?;
    Ok(())
}
