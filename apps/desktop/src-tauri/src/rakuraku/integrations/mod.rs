//! 連携（integration）ごとの実装を束ねるモジュール。
//!
//! 各連携は [`Integration`] トレイトを実装し、`scan` / `configure` / `verify` と公式ページ URL を
//! 提供する。ガイド手順（導入・SAPI 登録）は**実行せず** scan の結果データとして UI に返す（032 決定 4）。
//! 実処理は各実装の `#[cfg(windows)]` 分岐に閉じ、非 Windows は `*::unsupported()` を返す。
//! 連携追加＝1 ファイル追加で済む構成（MVP は棒読みちゃん×VOICEVOX の 1 実装のみ）。

use std::path::PathBuf;

use crate::error::AppResult;
use crate::tools::model::Tool;

use super::model::{ConfigureResult, ScanResult, VerifyResult};

pub mod bouyomi_voicevox;

/// 連携 1 件の実装が満たすトレイト。
pub trait Integration {
    /// 内部識別子（TS 側 `integrationRegistry` の id と一致させる）。
    fn id(&self) -> &'static str;
    /// 読み取り専用の検出（インストール状況・SAPI 登録・50021 稼働）。
    fn scan(&self, ctx: &IntegrationCtx) -> AppResult<ScanResult>;
    /// 部品名（固定語）→ その部品の実行ファイル名（例: `"voicevox"=>"VOICEVOX.exe"`）。
    /// 起動対象でない部品（SAPI 等）は `None`。032b 修正2: 登録済みツールとの exe 名照合・自動起動に使う。
    /// 自動起動（`rakuraku_launch_component`）は登録済み Tool を解決して管理付き `spawn`＋`register` する。
    fn component_exe(&self, component: &str) -> Option<&'static str>;
    /// 棒読みちゃん設定のバックアップ先取り＋書換（棒読み設定のみ・可逆・§5 解禁範囲）。
    fn configure(&self, ctx: &IntegrationCtx) -> AppResult<ConfigureResult>;
    /// ループバック疎通テスト（50021 ヘルスチェック＋50001 テスト送信・§1 解禁範囲）。
    fn verify(&self, ctx: &IntegrationCtx) -> AppResult<VerifyResult>;
    /// 部品名 → 公式ページ URL（Rust 側の固定定数）。未知の部品・未確定は `None`。
    ///
    /// frontend は raw URL を渡さず、`id` と部品名（固定語）だけを渡す。ここで定数に解決し、
    /// 呼び出し側が opener の Rust API（ACL 不要）で開く。誘導のみ・自動DLはしない。
    fn official_page(&self, component: &str) -> Option<&'static str>;
}

/// 連携実行時のコンテキスト。configure がバックアップ保存先（app 管理領域）を知るために使う。
///
/// `backup_root` / `tools` は windows の scan/configure でのみ読むため、非 Windows では未使用になる。
pub struct IntegrationCtx {
    /// バックアップの保存ルート（例: `<app_data_dir>/rakuraku-backups`）。
    #[cfg_attr(not(windows), allow(dead_code))]
    pub backup_root: PathBuf,
    /// ツール管理に登録済みのツール一覧（032b 修正2: 導入検出・自動起動・configure の解決元）。
    /// command 層が `DbState` から `tools::service::list` して注入する（imp は global state を触らない）。
    #[cfg_attr(not(windows), allow(dead_code))]
    pub tools: Vec<Tool>,
}
