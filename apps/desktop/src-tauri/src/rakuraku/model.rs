//! らくらくツール設定（外部アプリ連携）の API 戻り値型。
//!
//! 032b。`scan` / `launch` の結果を frontend に返す（JSON は camelCase）。
//! 032c-a: 方針転換で設定書換（configure）・ループバック疎通（verify）の結果型は撤去した。
//! `process/model.rs` の慣習（Serialize + ts-rs export・安全な短文メッセージ）に倣う。
//! 永続化はしない（SQLite テーブルは追加しない）。
//!
//! 一部の variant / field は `#[cfg(windows)]` の実処理でのみ構築される。非 Windows では各コマンドが
//! `*::unsupported()` を返すため、mac の `cargo check` では windows 専用の variant/field が未構築＝
//! dead_code になる。これは意図どおりなので `#[cfg_attr(not(windows), allow(dead_code))]` で丸める。

use serde::Serialize;
use ts_rs::TS;

/// 検出（scan・読み取り専用）の結果。
///
/// 032c-a: 棒読み×VOICEVOX 実装の撤去で `registry()` が空になり `find` が常に NotFound を返すため、現状この
/// 結果を生成する経路は無い（全フィールド未使用）。VOICEVOX 直接読み上げ連携（032c-b）で scan を再登録する
/// 際の器として構造だけ温存する。下の `engine_running`/`bouyomi_running` は 032b のループバック疎通
/// （50021/50001）由来の名残で、実処理は撤去済み（現状は書込・外部通信を一切伴わない）。032c-b で意味を
/// 再定義するまでは値の生産者が無い前提。失敗詳細は丸め、フルパス/OS エラーを露出しない（docs/security.md §9）。
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
    /// 棒読みちゃん（127.0.0.1:50001 Socket 連携）が待ち受けているか（疎通確認には起動が必須）。
    pub bouyomi_running: bool,
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

/// 自動起動（launch・§既導入アプリの起動解禁範囲）の結果。
///
/// 既導入・同意済みアプリ（未起動）の起動のみを行う（**自動DL/インストールはしない**）。
/// 実行ファイルが見つからないときは `launched=false` で導入を案内する（エラーにはしない）。
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/features/rakuraku/bindings/")]
pub struct LaunchResult {
    /// 現在の OS でこの連携を実行できるか。
    pub supported: bool,
    /// 起動を試みられたか（実行ファイルを解決して spawn した=true / 実行ファイル未検出=false）。
    pub launched: bool,
    /// UI 表示用の安全な短文（フルパス/環境情報を含めない）。
    pub message: String,
}

// 非対応 OS（非 Windows）で scan 実装が返す「未対応」結果。032c-a で登録済み連携が空になり現在は未使用だが、
// 将来の連携実装が非 Windows で返す共有ヘルパとして温存する（dead_code を明示的に許可）。
impl ScanResult {
    #[allow(dead_code)]
    pub fn unsupported() -> Self {
        ScanResult {
            supported: false,
            components: Vec::new(),
            engine_running: false,
            bouyomi_running: false,
            message: Some("この連携は Windows でご利用いただけます。".to_string()),
        }
    }
}
