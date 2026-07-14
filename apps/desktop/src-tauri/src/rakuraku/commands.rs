//! らくらくツール設定（外部アプリ連携）の Tauri コマンド（最小・明示・§3）。
//!
//! frontend からは raw なパス/URL/ポート/コマンドを受けず、`id`（＋公式ページは部品名の固定語）だけを
//! 受け取る。ネットワーク（ureq / `std::net`）は Rust 内で完結し IPC/ACL 対象外。公式ページを開くのは
//! opener の Rust API（ACL 不要）に限定する。非 Windows は各実装が「未対応」結果を返す。

use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

use crate::error::{AppError, AppResult};
use crate::util::validate_http_url;

use super::integrations::IntegrationCtx;
use super::model::{ConfigureResult, ScanResult, VerifyResult};
use super::service;

/// 書換前バックアップの保存ルート（app 管理領域）。`<app_data_dir>/rakuraku-backups`。
fn backup_root(app: &AppHandle) -> AppResult<std::path::PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|_| AppError::storage("保存先の解決に失敗しました"))?;
    Ok(dir.join("rakuraku-backups"))
}

fn context(app: &AppHandle) -> AppResult<IntegrationCtx> {
    Ok(IntegrationCtx {
        backup_root: backup_root(app)?,
    })
}

/// 検出（scan・読み取り専用）。VOICEVOX/棒読みちゃんの導入・SAPI 登録・50021 稼働を確認する。
#[tauri::command]
pub fn rakuraku_scan_integration(app: AppHandle, id: String) -> AppResult<ScanResult> {
    let ctx = context(&app)?;
    service::find(&id)?.scan(&ctx)
}

/// 設定書換（configure）。棒読みちゃん設定のみをバックアップ先取りしてから書き換える（§5 解禁範囲）。
#[tauri::command]
pub fn rakuraku_configure_integration(app: AppHandle, id: String) -> AppResult<ConfigureResult> {
    let ctx = context(&app)?;
    service::find(&id)?.configure(&ctx)
}

/// 検証（verify）。VOICEVOX 50021 ヘルスチェック＋棒読みちゃん 50001 テスト送信（ループバックのみ・§1）。
#[tauri::command]
pub fn rakuraku_verify_integration(app: AppHandle, id: String) -> AppResult<VerifyResult> {
    let ctx = context(&app)?;
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
