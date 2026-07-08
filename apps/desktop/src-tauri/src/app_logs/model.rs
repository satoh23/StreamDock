use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::ErrorCode;
use crate::process::model::RuntimeProcess;

/// ログの重要度。JSON は lowercase（`info` / `warn` / `error`）。
/// Deserialize は DB の文字列から復元する際に使う。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "../../src/features/logs/bindings/")]
pub enum LogLevel {
    Info,
    Warn,
    Error,
}

/// ログのカテゴリ。JSON は kebab-case（`preset-item` / `process-launch` など）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = "../../src/features/logs/bindings/")]
pub enum LogCategory {
    Tool,
    Preset,
    PresetItem,
    ProcessLaunch,
    BulkLaunch,
    ProcessStop,
    RuntimeStatus,
    Storage,
    Ui,
}

/// 保存・返却される構造化ログ1件。JSON は camelCase。
///
/// 機密情報（環境変数・secret・stack trace 全文・不要なフルパス・ファイル内容・
/// 任意ユーザー入力全文）は載せない。message / 各フィールドは安全な最小情報に限定する。
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/features/logs/bindings/")]
pub struct AppLogEntry {
    pub id: String,
    pub level: LogLevel,
    pub category: LogCategory,
    pub operation: String,
    pub message: String,
    #[ts(optional)]
    pub error_code: Option<ErrorCode>,
    #[ts(optional)]
    pub tool_id: Option<String>,
    #[ts(optional)]
    pub tool_name: Option<String>,
    #[ts(optional)]
    pub preset_id: Option<String>,
    #[ts(optional)]
    pub preset_name: Option<String>,
    #[ts(optional)]
    pub preset_item_id: Option<String>,
    #[ts(optional)]
    pub launch_id: Option<String>,
    #[ts(optional)]
    pub process_id: Option<u32>,
    pub occurred_at: String,
}

/// ユーザーが開発者に共有しやすい診断サマリー。JSON は camelCase。
///
/// 直近の error / warn を中心にまとめる。full path や環境変数など危険な情報は含めない
/// （`runtimeProcesses` は既にサニタイズ済みの `RuntimeProcess` フィールドのみ）。
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/features/logs/bindings/")]
pub struct DiagnosticSummary {
    pub generated_at: String,
    pub app_version: String,
    pub recent_errors: Vec<AppLogEntry>,
    pub recent_warnings: Vec<AppLogEntry>,
    pub runtime_processes: Vec<RuntimeProcess>,
}

/// ログ書き込み用の内部入力（id / occurred_at は service で採番するため持たない）。
/// ts-rs には出さない（frontend からは記録できない＝Rust 側でのみ生成する）。
pub struct NewLog {
    pub level: LogLevel,
    pub category: LogCategory,
    pub operation: String,
    pub message: String,
    pub error_code: Option<ErrorCode>,
    pub tool_id: Option<String>,
    pub tool_name: Option<String>,
    pub preset_id: Option<String>,
    // `preset_name` はユーザー入力のため、ログ／共有サマリーへ流出しないよう **あえて setter（builder）を
    // 用意しない**。プリセット識別は `preset_id`（UUID）で行う。これは docs/security.md §9 と
    // 前回 security-review 対応（プリセット名のサマリー流出）の恒久的な構造防御であり、
    // builder 非提供に依存しているため意図を残す。将来プリセット名を UI ログに出す要件が出ても、
    // message へ埋め込まず、表示側で id→name 解決するなど本防御を意識した安全な経路で行うこと。
    pub preset_name: Option<String>,
    pub preset_item_id: Option<String>,
    pub launch_id: Option<String>,
    pub process_id: Option<u32>,
}

impl NewLog {
    pub fn new(
        level: LogLevel,
        category: LogCategory,
        operation: impl Into<String>,
        message: impl Into<String>,
    ) -> Self {
        NewLog {
            level,
            category,
            operation: operation.into(),
            message: message.into(),
            error_code: None,
            tool_id: None,
            tool_name: None,
            preset_id: None,
            preset_name: None,
            preset_item_id: None,
            launch_id: None,
            process_id: None,
        }
    }

    pub fn error_code(mut self, code: ErrorCode) -> Self {
        self.error_code = Some(code);
        self
    }

    pub fn tool(mut self, id: impl Into<String>, name: impl Into<String>) -> Self {
        self.tool_id = Some(id.into());
        self.tool_name = Some(name.into());
        self
    }

    pub fn preset_id(mut self, id: impl Into<String>) -> Self {
        self.preset_id = Some(id.into());
        self
    }

    /// 【未使用・意図的に残置】preset-item 単位の失敗（bulk-launch の per-item 失敗など）を
    /// ログで辿るための builder。011 では bulk-launch を集約ログのみで記録し per-item ログは
    /// 出さないため未使用。
    /// どうなったら配線するか: per-item の失敗調査が必要になったとき、`launch_one` 由来のログに
    /// `.preset_item_id(item.id)` を付けて配線する。
    #[allow(dead_code)]
    pub fn preset_item_id(mut self, id: impl Into<String>) -> Self {
        self.preset_item_id = Some(id.into());
        self
    }

    pub fn launch_id(mut self, id: impl Into<String>) -> Self {
        self.launch_id = Some(id.into());
        self
    }

    pub fn process_id(mut self, pid: u32) -> Self {
        self.process_id = Some(pid);
        self
    }
}
