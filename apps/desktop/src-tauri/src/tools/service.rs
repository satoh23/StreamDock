use std::path::Path;

use rusqlite::Connection;

use crate::error::{AppError, AppResult};
use crate::util::{
    normalize_optional, now_rfc3339, reject_control_chars, require_non_empty, validate_http_url,
    with_filename_detail,
};

use super::model::{CreateToolInput, Tool, ToolKind, UpdateToolInput};
use super::repository;

/// 入力を trim し、正規化した (name, executable_path, description, icon_label) を返す。
fn normalize(
    name: &str,
    executable_path: &str,
    description: &Option<String>,
    icon_label: &Option<String>,
) -> (String, String, String, String) {
    (
        name.trim().to_string(),
        executable_path.trim().to_string(),
        normalize_optional(description),
        normalize_optional(icon_label),
    )
}

/// 名前の共通検証（種別に依らず必須・制御文字を弾く）。
fn validate_name(name: &str) -> AppResult<()> {
    require_non_empty(name, "ツール名は必須です")?;
    reject_control_chars(name, "ツール名に制御文字は使用できません")?;
    Ok(())
}

/// executable 種別の検証。必須・実在・制御文字・executable_path 重複を検証する。
fn validate_executable_kind(
    conn: &Connection,
    executable_path: &str,
    exclude_id: Option<&str>,
) -> AppResult<()> {
    require_non_empty(executable_path, "実行ファイルパスは必須です")?;
    // 制御文字（改行・NUL 等）を弾く。将来プロセス起動時のコマンド注入を防ぐ前提検証。
    reject_control_chars(
        executable_path,
        "実行ファイルパスに制御文字は使用できません",
    )?;
    if !Path::new(executable_path).exists() {
        // フルパスは frontend / log に露出させない。details にはファイル名のみを入れる。
        let err = AppError::path_not_found(
            "指定された実行ファイルが見つかりません。パスを確認してください。",
        );
        return Err(with_filename_detail(err, Path::new(executable_path)));
    }
    if let Some(existing) = repository::find_by_executable_path(conn, executable_path)? {
        if exclude_id != Some(existing.id.as_str()) {
            let err =
                AppError::duplicate_path("同じ実行ファイルパスのツールが既に登録されています。");
            return Err(with_filename_detail(err, Path::new(executable_path)));
        }
    }
    Ok(())
}

/// url 種別の検証。http/https スキーム限定で検証し、重複 URL を拒否する。検証済み URL を返す。
fn validate_url_kind(
    conn: &Connection,
    raw_url: &Option<String>,
    exclude_id: Option<&str>,
) -> AppResult<String> {
    // frontend の生値を信用せず Rust 側で必ず検証する（http/https 限定・危険スキーム拒否）。
    let url = validate_http_url(raw_url.as_deref().unwrap_or(""))?;
    if let Some(existing) = repository::find_by_url(conn, &url)? {
        if exclude_id != Some(existing.id.as_str()) {
            return Err(AppError::validation(
                "同じ URL のツールが既に登録されています。",
            ));
        }
    }
    Ok(url)
}

pub fn create(conn: &Connection, input: CreateToolInput) -> AppResult<Tool> {
    let (name, executable_path, description, icon_label) = normalize(
        &input.name,
        &input.executable_path,
        &input.description,
        &input.icon_label,
    );
    validate_name(&name)?;

    let now = now_rfc3339();
    // 種別で分岐して検証し、保存する executable_path / url を確定する。
    let (executable_path, url) = match input.kind {
        ToolKind::Executable => {
            validate_executable_kind(conn, &executable_path, None)?;
            (executable_path, None)
        }
        ToolKind::Url => {
            let url = validate_url_kind(conn, &input.url, None)?;
            // url 種別は executable_path を空文字で保存する。
            (String::new(), Some(url))
        }
        // 032c-a: 内蔵ツールは実行パス/URL を持たず別ウィンドウを開くのみ。executable_path 空・url None で保存。
        ToolKind::Internal => (String::new(), None),
    };

    let tool = Tool {
        id: uuid::Uuid::new_v4().to_string(),
        name,
        executable_path,
        description,
        icon_label,
        // 018: 抽出済み base64 PNG はそのまま保存する（trim / 正規化しない）。
        icon_png: input.icon_png,
        kind: input.kind,
        url,
        created_at: now.clone(),
        updated_at: now,
    };
    repository::insert(conn, &tool)?;
    Ok(tool)
}

pub fn list(conn: &Connection) -> AppResult<Vec<Tool>> {
    Ok(repository::list(conn)?)
}

pub fn get(conn: &Connection, id: &str) -> AppResult<Tool> {
    repository::get(conn, id)?
        .ok_or_else(|| AppError::not_found(format!("ツールが見つかりません: {id}")))
}

pub fn update(conn: &Connection, id: &str, input: UpdateToolInput) -> AppResult<Tool> {
    let existing = repository::get(conn, id)?
        .ok_or_else(|| AppError::not_found(format!("ツールが見つかりません: {id}")))?;

    let (name, executable_path, description, icon_label) = normalize(
        &input.name,
        &input.executable_path,
        &input.description,
        &input.icon_label,
    );
    validate_name(&name)?;

    let (executable_path, url) = match input.kind {
        ToolKind::Executable => {
            validate_executable_kind(conn, &executable_path, Some(id))?;
            (executable_path, None)
        }
        ToolKind::Url => {
            let url = validate_url_kind(conn, &input.url, Some(id))?;
            (String::new(), Some(url))
        }
        // 032c-a: 内蔵ツールは実行パス/URL を持たず別ウィンドウを開くのみ。executable_path 空・url None で保存。
        ToolKind::Internal => (String::new(), None),
    };

    let updated = Tool {
        id: existing.id,
        name,
        executable_path,
        description,
        icon_label,
        // 018: 編集画面が既存値を再送するためそのまま保存する（trim / 正規化しない）。
        icon_png: input.icon_png,
        kind: input.kind,
        url,
        created_at: existing.created_at,
        updated_at: now_rfc3339(),
    };
    repository::update(conn, &updated)?;
    Ok(updated)
}

pub fn delete(conn: &Connection, id: &str) -> AppResult<()> {
    let affected = repository::delete(conn, id)?;
    if affected == 0 {
        return Err(AppError::not_found(format!("ツールが見つかりません: {id}")));
    }
    Ok(())
}
