//! らくらくツール設定（外部アプリ連携）の API 戻り値型。
//!
//! 032b。`scan` / `configure` / `verify` の結果を frontend に返す（JSON は camelCase）。
//! `process/model.rs` の慣習（Serialize + ts-rs export・安全な短文メッセージ）に倣う。
//! 永続化はしない（バックアップはファイルのみ・SQLite テーブルは追加しない）。
//!
//! 一部の variant / field は `#[cfg(windows)]` の実処理でのみ構築される。非 Windows では各コマンドが
//! `*::unsupported()` を返すため、mac の `cargo check` では windows 専用の variant/field が未構築＝
//! dead_code になる。これは意図どおりなので `#[cfg_attr(not(windows), allow(dead_code))]` で丸める。

use serde::Serialize;
use ts_rs::TS;

/// 検出（scan・読み取り専用）の結果。
///
/// 書込・外部通信なし（VOICEVOX 50021 のループバック疎通のみ）で導出する。失敗詳細は丸め、
/// フルパス/OS エラーを露出しない（docs/security.md §9）。
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/features/rakuraku/bindings/")]
pub struct ScanResult {
    /// 現在の OS でこの連携を実行できるか（非 Windows は false）。
    pub supported: bool,
    /// 必要部品ごとの導入状況（表示順）。
    pub components: Vec<ComponentStatus>,
    /// VOICEVOX ENGINE（127.0.0.1:50021）が稼働しているか。
    pub engine_running: bool,
    /// UI 表示用の安全な短文（フルパス/環境情報を含めない）。
    #[ts(optional)]
    pub message: Option<String>,
}

/// 必要部品 1 件の検出状況。windows の scan でのみ構築する。
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/features/rakuraku/bindings/")]
#[cfg_attr(not(windows), allow(dead_code))]
pub struct ComponentStatus {
    /// 部品識別子（`rakuraku_open_official_page` に渡す固定語。例 "voicevox" / "bouyomichan" / "sapi"）。
    pub key: String,
    /// 表示名。
    pub name: String,
    /// 導入済みか。判定不能・未確認は None（安全側で「不明」扱い）。
    #[ts(optional)]
    pub installed: Option<bool>,
    /// 公式ページを開く導線（`rakuraku_open_official_page`）を出せるか（固定 URL が存在するか）。
    pub has_official_page: bool,
}

/// 設定書換（configure）の結果状態。JSON は kebab-case。
#[derive(Debug, Clone, Copy, Serialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = "../../src/features/rakuraku/bindings/")]
#[cfg_attr(not(windows), allow(dead_code))]
pub enum ConfigureStatus {
    /// バックアップ先取り後に棒読みちゃん設定を書き換えた。
    Configured,
    /// 棒読みちゃんが未導入で書換対象が無い（ガイドへ）。
    NotInstalled,
    /// 対象キーが見つからない等で書換をスキップした（設定を壊さない）。
    Skipped,
    /// 非対応 OS（非 Windows）。
    Unsupported,
}

/// 設定書換（configure・バックアップ先取り・§5 解禁範囲）の結果。
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/features/rakuraku/bindings/")]
pub struct ConfigureResult {
    /// 現在の OS でこの連携を実行できるか。
    pub supported: bool,
    /// 書換の結果状態。
    pub status: ConfigureStatus,
    /// 書換前にバックアップを取得できたか（先取りの担保。バックアップ失敗時は書換しない）。
    pub backup_created: bool,
    /// 反映に棒読みちゃんの再起動が必要か。
    pub restart_required: bool,
    /// UI 表示用の安全な短文（フルパス/環境情報を含めない）。
    pub message: String,
    /// バックアップの「ファイル名のみ」（フルパスは返さない・§9）。取得できたときのみ。
    #[ts(optional)]
    pub backup_name: Option<String>,
}

/// 疎通テスト（verify）の結果状態。JSON は kebab-case。
#[derive(Debug, Clone, Copy, Serialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = "../../src/features/rakuraku/bindings/")]
#[cfg_attr(not(windows), allow(dead_code))]
pub enum VerifyStatus {
    /// VOICEVOX 50021 応答＋棒読みちゃん 50001 送信の両方が成功。
    Ok,
    /// 片方のみ成功。
    Partial,
    /// いずれも失敗。
    Failed,
    /// 非対応 OS（非 Windows）。
    Unsupported,
}

/// 検証（verify・ループバックのみ・§1 解禁範囲）の結果。
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/features/rakuraku/bindings/")]
pub struct VerifyResult {
    /// 現在の OS でこの連携を実行できるか。
    pub supported: bool,
    /// 検証の結果状態。
    pub status: VerifyStatus,
    /// VOICEVOX ENGINE（127.0.0.1:50021）が応答したか。
    pub engine_healthy: bool,
    /// 棒読みちゃん（127.0.0.1:50001）へテスト文を送信できたか。
    pub test_message_sent: bool,
    /// UI 表示用の安全な短文。
    pub message: String,
}

// 非対応 OS（非 Windows）で各コマンドが返す「未対応」結果。mac の非 Windows 経路でのみ使う。
impl ScanResult {
    #[cfg_attr(windows, allow(dead_code))]
    pub fn unsupported() -> Self {
        ScanResult {
            supported: false,
            components: Vec::new(),
            engine_running: false,
            message: Some("この連携は Windows でご利用いただけます。".to_string()),
        }
    }
}

impl ConfigureResult {
    #[cfg_attr(windows, allow(dead_code))]
    pub fn unsupported() -> Self {
        ConfigureResult {
            supported: false,
            status: ConfigureStatus::Unsupported,
            backup_created: false,
            restart_required: false,
            message: "この連携は Windows でご利用いただけます。".to_string(),
            backup_name: None,
        }
    }
}

impl VerifyResult {
    #[cfg_attr(windows, allow(dead_code))]
    pub fn unsupported() -> Self {
        VerifyResult {
            supported: false,
            status: VerifyStatus::Unsupported,
            engine_healthy: false,
            test_message_sent: false,
            message: "この連携は Windows でご利用いただけます。".to_string(),
        }
    }
}
