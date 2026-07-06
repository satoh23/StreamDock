use std::path::Path;

use rusqlite::Connection;

use crate::error::{AppError, AppResult};

use super::model::{CreateToolInput, Tool, UpdateToolInput};
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
        description.as_deref().unwrap_or("").trim().to_string(),
        icon_label.as_deref().unwrap_or("").trim().to_string(),
    )
}

/// 必須・パス存在の検証。id を除外して executable_path 重複を検証する。
fn validate(
    conn: &Connection,
    name: &str,
    executable_path: &str,
    exclude_id: Option<&str>,
) -> AppResult<()> {
    if name.is_empty() {
        return Err(AppError::Validation("ツール名は必須です".into()));
    }
    if executable_path.is_empty() {
        return Err(AppError::Validation("実行ファイルパスは必須です".into()));
    }
    // 制御文字（改行・NUL 等）を弾く。将来プロセス起動時のコマンド注入を防ぐ前提検証。
    if name.chars().any(char::is_control) {
        return Err(AppError::Validation(
            "ツール名に制御文字は使用できません".into(),
        ));
    }
    if executable_path.chars().any(char::is_control) {
        return Err(AppError::Validation(
            "実行ファイルパスに制御文字は使用できません".into(),
        ));
    }
    if !Path::new(executable_path).exists() {
        return Err(AppError::PathNotFound(format!(
            "指定された実行ファイルが見つかりません: {executable_path}"
        )));
    }
    if let Some(existing) = repository::find_by_executable_path(conn, executable_path)? {
        if exclude_id != Some(existing.id.as_str()) {
            return Err(AppError::DuplicatePath(format!(
                "同じ実行ファイルパスのツールが既に登録されています: {executable_path}"
            )));
        }
    }
    Ok(())
}

pub fn create(conn: &Connection, input: CreateToolInput) -> AppResult<Tool> {
    let (name, executable_path, description, icon_label) = normalize(
        &input.name,
        &input.executable_path,
        &input.description,
        &input.icon_label,
    );
    validate(conn, &name, &executable_path, None)?;

    let now = chrono::Utc::now().to_rfc3339();
    let tool = Tool {
        id: uuid::Uuid::new_v4().to_string(),
        name,
        executable_path,
        description,
        icon_label,
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
        .ok_or_else(|| AppError::NotFound(format!("ツールが見つかりません: {id}")))
}

pub fn update(conn: &Connection, id: &str, input: UpdateToolInput) -> AppResult<Tool> {
    let existing = repository::get(conn, id)?
        .ok_or_else(|| AppError::NotFound(format!("ツールが見つかりません: {id}")))?;

    let (name, executable_path, description, icon_label) = normalize(
        &input.name,
        &input.executable_path,
        &input.description,
        &input.icon_label,
    );
    validate(conn, &name, &executable_path, Some(id))?;

    let updated = Tool {
        id: existing.id,
        name,
        executable_path,
        description,
        icon_label,
        created_at: existing.created_at,
        updated_at: chrono::Utc::now().to_rfc3339(),
    };
    repository::update(conn, &updated)?;
    Ok(updated)
}

pub fn delete(conn: &Connection, id: &str) -> AppResult<()> {
    let affected = repository::delete(conn, id)?;
    if affected == 0 {
        return Err(AppError::NotFound(format!("ツールが見つかりません: {id}")));
    }
    Ok(())
}
