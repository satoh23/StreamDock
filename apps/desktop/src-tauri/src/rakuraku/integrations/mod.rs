//! 連携（integration）ごとの実装を束ねるモジュール。
//!
//! 各連携は [`Integration`] トレイトを実装し、`scan` と公式ページ URL・起動対象 exe 名を提供する。
//! ガイド手順（導入・SAPI 登録）は**実行せず** scan の結果データとして UI に返す（032 決定 4）。
//! 実処理は各実装の `#[cfg(windows)]` 分岐に閉じ、非 Windows は `*::unsupported()` を返す。
//! 032c-a: 方針転換に伴い棒読みちゃん×VOICEVOX 実装（設定書換 configure / ループバック verify を含む）は
//! 撤去した。現時点で登録済み実装は無い（`registry()` は空）が、共有の器（trait・scan/launch/公式ページ）は
//! 内蔵コメビュ露出・らくらく一覧の再利用のため温存する。

use crate::error::AppResult;
use crate::tools::model::Tool;

use super::model::ScanResult;

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
    /// 部品名 → 公式ページ URL（Rust 側の固定定数）。未知の部品・未確定は `None`。
    ///
    /// frontend は raw URL を渡さず、`id` と部品名（固定語）だけを渡す。ここで定数に解決し、
    /// 呼び出し側が opener の Rust API（ACL 不要）で開く。誘導のみ・自動DLはしない。
    fn official_page(&self, component: &str) -> Option<&'static str>;
}

/// 連携実行時のコンテキスト。scan が導入検出・自動起動の解決元として登録済みツール一覧を読む。
///
/// `tools` は windows の scan でのみ読むため、非 Windows では未使用になる。
pub struct IntegrationCtx {
    /// ツール管理に登録済みのツール一覧（032b 修正2: 導入検出・自動起動の解決元）。
    /// command 層が `DbState` から `tools::service::list` して注入する（imp は global state を触らない）。
    #[cfg_attr(not(windows), allow(dead_code))]
    pub tools: Vec<Tool>,
}
