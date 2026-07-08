use rusqlite::Connection;

use crate::error::{AppError, AppResult};
use crate::util::{normalize_optional, now_rfc3339, reject_control_chars, require_non_empty};

use super::model::{CreatePresetInput, Preset, UpdatePresetInput};
use super::repository;

/// プリセット名の最大文字数（文字数＝Unicode スカラー単位）。
const MAX_NAME_LEN: usize = 100;
/// 説明の最大文字数。
const MAX_DESCRIPTION_LEN: usize = 500;

/// 入力を trim し、正規化した (name, description) を返す。
fn normalize(name: &str, description: &Option<String>) -> (String, String) {
    (name.trim().to_string(), normalize_optional(description))
}

/// 必須・長さ・制御文字・重複の検証。id を除外して name 重複を検証する。
fn validate(
    conn: &Connection,
    name: &str,
    description: &str,
    exclude_id: Option<&str>,
) -> AppResult<()> {
    require_non_empty(name, "プリセット名は必須です")?;
    if name.chars().count() > MAX_NAME_LEN {
        return Err(AppError::validation(format!(
            "プリセット名は{MAX_NAME_LEN}文字以内で入力してください"
        )));
    }
    // 制御文字（改行・NUL 等）を弾く。
    reject_control_chars(name, "プリセット名に制御文字は使用できません")?;
    if description.chars().count() > MAX_DESCRIPTION_LEN {
        return Err(AppError::validation(format!(
            "説明は{MAX_DESCRIPTION_LEN}文字以内で入力してください"
        )));
    }
    // 説明も名前と同様に制御文字を弾く（単一行入力のため改行等は許可しない）。
    reject_control_chars(description, "説明に制御文字は使用できません")?;
    if let Some(existing) = repository::find_by_name(conn, name)? {
        if exclude_id != Some(existing.id.as_str()) {
            return Err(AppError::duplicate_name(format!(
                "同じ名前のプリセットが既に登録されています: {name}"
            )));
        }
    }
    Ok(())
}

pub fn create(conn: &Connection, input: CreatePresetInput) -> AppResult<Preset> {
    let (name, description) = normalize(&input.name, &input.description);
    validate(conn, &name, &description, None)?;

    let now = now_rfc3339();
    let preset = Preset {
        id: uuid::Uuid::new_v4().to_string(),
        name,
        description,
        created_at: now.clone(),
        updated_at: now,
    };
    repository::insert(conn, &preset)?;
    Ok(preset)
}

pub fn list(conn: &Connection) -> AppResult<Vec<Preset>> {
    Ok(repository::list(conn)?)
}

pub fn get(conn: &Connection, id: &str) -> AppResult<Preset> {
    repository::get(conn, id)?
        .ok_or_else(|| AppError::not_found(format!("プリセットが見つかりません: {id}")))
}

pub fn update(conn: &Connection, id: &str, input: UpdatePresetInput) -> AppResult<Preset> {
    let existing = repository::get(conn, id)?
        .ok_or_else(|| AppError::not_found(format!("プリセットが見つかりません: {id}")))?;

    let (name, description) = normalize(&input.name, &input.description);
    validate(conn, &name, &description, Some(id))?;

    let updated = Preset {
        id: existing.id,
        name,
        description,
        created_at: existing.created_at,
        updated_at: now_rfc3339(),
    };
    repository::update(conn, &updated)?;
    Ok(updated)
}

pub fn delete(conn: &Connection, id: &str) -> AppResult<()> {
    let affected = repository::delete(conn, id)?;
    if affected == 0 {
        return Err(AppError::not_found(format!("プリセットが見つかりません: {id}")));
    }
    Ok(())
}
