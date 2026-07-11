//! 各モジュール（tools / presets / preset_items / process / app_logs）で重複していた
//! 下位イディオムを集約する薄い共通ヘルパ。
//!
//! 012 Rust Common Helper Refactor で新設。挙動・検証ルール・メッセージ文言は一切変えず、
//! 「定義が1箇所にない」状態のみを解消する純リファクタ。過剰な抽象化（trait 化・ジェネリクス
//! 多用）はせず、返り値・エラー型は既存 `AppError` / `AppResult` をそのまま使う。

use std::path::Path;

use rusqlite::Connection;

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

/// 023: URL を http/https スキーム限定で検証し、trim 済みの安全な URL 文字列を返す。
///
/// 保存時（`tools::service`）と起動時（`process::service::open_url`）の両方で使う多層防御。
/// frontend の生値を信用せず Rust 側で必ず検証する（docs/security.md §4/§8）。`javascript:` /
/// `file:` / `data:` / 独自スキーム等は `http://` / `https://` プレフィックスに一致しないため拒否される。
pub fn validate_http_url(raw: &str) -> AppResult<String> {
    let url = raw.trim();
    require_non_empty(url, "URL が未設定です")?;
    reject_control_chars(url, "URL に制御文字は使用できません")?;
    // スキームは大文字小文字を無視して比較する（ホスト・パスの大小は保持したいので元文字列を返す）。
    let lower = url.to_ascii_lowercase();
    if !(lower.starts_with("http://") || lower.starts_with("https://")) {
        return Err(AppError::validation(
            "URL は http:// または https:// で始まる必要があります",
        ));
    }
    Ok(url.to_string())
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

/// テーブルに指定カラムが無ければ `ALTER TABLE ... ADD COLUMN` で追加する冪等マイグレーション。
///
/// マイグレーション基盤が無い（各 repository の `init()` が冪等 DDL）ため、既存 DB へ後付けカラムを
/// 安全に足すための最小ヘルパ。`pragma_table_info` で現在のカラムを確認し、未存在時のみ追加する。
/// 018 で新設し、以降のスキーマ追加（019 等）でも共用する。
///
/// 注意: SQLite は識別子（テーブル名・カラム名）をプレースホルダにバインドできないため ADD COLUMN の
/// SQL は `format!` で組み立てる。`table` / `column` / `decl` は**呼び出し側のコンパイル時定数のみ**を
/// 渡すこと（ユーザー入力を渡さない）。存在確認の `table` は table-valued function にバインドする。
pub fn ensure_column(
    conn: &Connection,
    table: &str,
    column: &str,
    decl: &str,
) -> rusqlite::Result<()> {
    let exists = {
        let mut stmt = conn.prepare("SELECT 1 FROM pragma_table_info(?1) WHERE name = ?2")?;
        stmt.exists(rusqlite::params![table, column])?
    };
    if !exists {
        conn.execute_batch(&format!(
            "ALTER TABLE {table} ADD COLUMN {column} {decl};"
        ))?;
    }
    Ok(())
}
