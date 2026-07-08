//! 各モジュール（tools / presets / preset_items / process / app_logs）で重複していた
//! 下位イディオムを集約する薄い共通ヘルパ。
//!
//! 012 Rust Common Helper Refactor で新設。挙動・検証ルール・メッセージ文言は一切変えず、
//! 「定義が1箇所にない」状態のみを解消する純リファクタ。過剰な抽象化（trait 化・ジェネリクス
//! 多用）はせず、返り値・エラー型は既存 `AppError` / `AppResult` をそのまま使う。

use std::path::Path;

use crate::error::{AppError, AppResult};

/// 現在時刻を RFC3339 文字列で返す（`chrono::Utc::now().to_rfc3339()` の単一定義）。
pub fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339()
}

/// 任意フィールド（`Option<String>`）を trim 正規化する。`None` は空文字列にする。
pub fn normalize_optional(value: &Option<String>) -> String {
    value.as_deref().unwrap_or("").trim().to_string()
}

/// trim 後に空なら Validation エラーを返す（必須・空チェック）。
pub fn require_non_empty(value: &str, message: impl Into<String>) -> AppResult<()> {
    if value.trim().is_empty() {
        return Err(AppError::validation(message));
    }
    Ok(())
}

/// 制御文字（改行・NUL 等）を含むなら Validation エラーを返す。
pub fn reject_control_chars(value: &str, message: impl Into<String>) -> AppResult<()> {
    if value.chars().any(char::is_control) {
        return Err(AppError::validation(message));
    }
    Ok(())
}

/// `AppError` に「ファイル名のみ」の `details` を付与する（フルパスは frontend / log に露出しない）。
///
/// `path_not_found` / `duplicate_path` で共通していた「`file_name` を取り出して
/// `ファイル名: {name}` を `with_details` する」定型を集約する。付与元の `AppError`（＝どの
/// エラーコード・message か）は呼び出し側がそのまま渡すため、各サイト固有の安全文言は維持される。
pub fn with_filename_detail(err: AppError, path: &Path) -> AppError {
    match path.file_name().and_then(|n| n.to_str()) {
        Some(name) if !name.is_empty() => err.with_details(format!("ファイル名: {name}")),
        _ => err,
    }
}
