//! 044a: OBS WebSocket サーバーの有効状態を **read-only** 検出する（追加1a）。
//!
//! OBS の obs-websocket プラグイン設定 `plugin_config/obs-websocket/config.json` を **読み取り専用**で読み、
//! `server_enabled` / `server_port` / `auth_required` を返す。これで設定 UI が「WS 無効です／ポートは
//! 4455 です／認証が必要です」と正確に案内し、**認証が必要なときだけ**パスワード入力を求められる。
//!
//! セキュリティ（docs/security.md 準拠）:
//!   - **書き込みは一切しない**（§5「外部アプリの設定ファイルを勝手に上書きしない」を厳守。自動有効化は別タスク）。
//!   - **`server_password` は読まない・返さない**（§9・パスワード値には触れない）。
//!   - 対象は **OS 別の既定パスのみ**（任意パス読取にしない・§7）。見つからない/壊れている場合は `None`
//!     （graceful＝UI は有効化ガイドを出す）。

use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, Manager};
use ts_rs::TS;

/// OBS WebSocket サーバーの検出結果（read-only）。JSON は camelCase。**password は含めない**（§9）。
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/features/comment-viewer/bindings/")]
pub struct ObsWsConfig {
    /// WebSocket サーバーが有効か。
    pub enabled: bool,
    /// サーバーポート（既定 4455）。
    pub port: u16,
    /// 認証（パスワード）が必要か。true のときだけ UI はパスワード入力を求める。
    pub auth_required: bool,
}

/// OBS の obs-websocket `config.json` を read-only 検出する。見つからない/壊れているときは `None`。
/// **書き込みしない・password は読まない**。
#[tauri::command]
pub fn detect_obs_websocket_config(app: AppHandle) -> Option<ObsWsConfig> {
    let path = config_path(&app)?;
    // read-only（read_to_string）。存在しない/権限無しは None（graceful）。
    let text = std::fs::read_to_string(&path).ok()?;
    parse_ws_config(&text)
}

/// config.json のテキストを検出結果へ解析する**純関数**（ファイル IO と分離＝単体テスト対象）。
/// パース不能なら `None`。**`server_password` は読まない**（§9）。数値/真偽が欠落・型不一致なら安全な既定へフォールバック。
fn parse_ws_config(text: &str) -> Option<ObsWsConfig> {
    let json: serde_json::Value = serde_json::from_str(text).ok()?;
    let enabled = json
        .get("server_enabled")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false);
    let port = json
        .get("server_port")
        .and_then(serde_json::Value::as_u64)
        .and_then(|p| u16::try_from(p).ok())
        .unwrap_or(4455);
    let auth_required = json
        .get("auth_required")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false);
    Some(ObsWsConfig {
        enabled,
        port,
        auth_required,
    })
}

/// OBS の obs-websocket `config.json` への **OS 別既定パス**（任意パスにしない・§7）。
/// macOS: `~/Library/Application Support/obs-studio/...`（data_dir）、
/// Windows: `%APPDATA%\obs-studio\...`（data_dir=Roaming）、Linux: `~/.config/obs-studio/...`（config_dir）。
fn config_path(app: &AppHandle) -> Option<PathBuf> {
    #[cfg(target_os = "linux")]
    let base = app.path().config_dir().ok()?;
    #[cfg(not(target_os = "linux"))]
    let base = app.path().data_dir().ok()?;
    Some(
        base.join("obs-studio")
            .join("plugin_config")
            .join("obs-websocket")
            .join("config.json"),
    )
}

#[cfg(test)]
mod tests {
    //! 044a: config.json 解析（`parse_ws_config`）の仕様テスト。ファイル IO を挟まず純関数を直接検証する。
    //! あるべき挙動（docs/tasks/044a / docs/security.md §5/§9）:
    //!   - 有効/ポート/認証要否を正しく読む。欠落・型不一致・範囲外は安全な既定（enabled/auth=false・port=4455）へ劣化。
    //!   - パース不能（壊れ/空）は None（＝UI が有効化ガイドを出す graceful）。
    //!   - **`server_password` は読まない・返さない**（ObsWsConfig に存在せず、直列化にも現れない）。
    use super::*;

    #[test]
    fn reads_enabled_port_auth() {
        let cfg = parse_ws_config(
            r#"{"server_enabled":true,"server_port":4455,"auth_required":true}"#,
        )
        .unwrap();
        assert!(cfg.enabled);
        assert_eq!(cfg.port, 4455);
        assert!(cfg.auth_required);
    }

    #[test]
    fn defaults_when_fields_missing() {
        // 空 JSON。enabled/auth=false・port=4455 の安全既定へ。
        let cfg = parse_ws_config("{}").unwrap();
        assert!(!cfg.enabled);
        assert_eq!(cfg.port, 4455);
        assert!(!cfg.auth_required);
    }

    #[test]
    fn defaults_when_types_mismatch() {
        // 型不一致（文字列/数値）でも既定へフォールバック（壊れた config でも劣化して落ちない）。
        let cfg = parse_ws_config(
            r#"{"server_enabled":"yes","server_port":"x","auth_required":1}"#,
        )
        .unwrap();
        assert!(!cfg.enabled);
        assert_eq!(cfg.port, 4455);
        assert!(!cfg.auth_required);
    }

    #[test]
    fn port_out_of_u16_range_falls_back() {
        // u16 を超える port は既定 4455 へ（try_from 失敗）。
        let cfg = parse_ws_config(r#"{"server_port":70000}"#).unwrap();
        assert_eq!(cfg.port, 4455);
    }

    #[test]
    fn custom_port_preserved() {
        let cfg =
            parse_ws_config(r#"{"server_enabled":true,"server_port":59650}"#).unwrap();
        assert_eq!(cfg.port, 59650);
        assert!(cfg.enabled);
    }

    #[test]
    fn invalid_or_empty_json_is_none() {
        assert!(parse_ws_config("not json").is_none());
        assert!(parse_ws_config("").is_none());
    }

    #[test]
    fn server_password_is_never_read_or_returned() {
        // §9: server_password が config にあっても ObsWsConfig（enabled/port/auth のみ）には現れない。
        let cfg = parse_ws_config(
            r#"{"server_enabled":true,"server_password":"topsecret"}"#,
        )
        .unwrap();
        assert!(cfg.enabled);
        assert_eq!(cfg.port, 4455);
        assert!(!cfg.auth_required);
        // 直列化結果にも password 値・キーが現れないことを実値で確認する。
        let json = serde_json::to_string(&cfg).unwrap();
        assert!(!json.contains("topsecret"));
        assert!(!json.to_lowercase().contains("password"));
    }
}
