use rusqlite::Connection;

use crate::error::{AppError, AppResult};
use crate::presets::repository as presets_repo;
use crate::tools::repository as tools_repo;

use super::model::{AddPresetItemInput, LaunchMode, PresetItem, UpdatePresetItemInput};
use super::repository;

/// presetId / toolId が必須かつ実在することを検証する。
/// frontend 側のチェックとは別に、Rust 側でも参照整合を担保する。
fn validate_refs(conn: &Connection, preset_id: &str, tool_id: &str) -> AppResult<()> {
    if preset_id.trim().is_empty() {
        return Err(AppError::Validation("プリセットIDは必須です".into()));
    }
    if tool_id.trim().is_empty() {
        return Err(AppError::Validation("ツールIDは必須です".into()));
    }
    if presets_repo::get(conn, preset_id)?.is_none() {
        return Err(AppError::NotFound(format!(
            "プリセットが見つかりません: {preset_id}"
        )));
    }
    if tools_repo::get(conn, tool_id)?.is_none() {
        return Err(AppError::NotFound(format!(
            "ツールが見つかりません: {tool_id}"
        )));
    }
    Ok(())
}

/// プリセットにツールを追加する。末尾（既存最大 order_index + 1、無ければ 0）に配置する。
pub fn add(conn: &Connection, input: AddPresetItemInput) -> AppResult<PresetItem> {
    let preset_id = input.preset_id.trim().to_string();
    let tool_id = input.tool_id.trim().to_string();
    validate_refs(conn, &preset_id, &tool_id)?;

    // 同一プリセット内での同一ツール重複を防ぐ。
    if repository::find_by_preset_and_tool(conn, &preset_id, &tool_id)?.is_some() {
        return Err(AppError::DuplicateToolInPreset(
            "このツールは既にプリセットに追加されています".into(),
        ));
    }

    let order_index = repository::max_order_index(conn, &preset_id)?
        .map(|max| max + 1)
        .unwrap_or(0);
    let now = chrono::Utc::now().to_rfc3339();
    let item = PresetItem {
        id: uuid::Uuid::new_v4().to_string(),
        preset_id,
        tool_id,
        launch_mode: input.launch_mode.unwrap_or(LaunchMode::Ordered),
        order_index,
        enabled: true,
        created_at: now.clone(),
        updated_at: now,
    };
    repository::insert(conn, &item)?;
    Ok(item)
}

pub fn list_by_preset(conn: &Connection, preset_id: &str) -> AppResult<Vec<PresetItem>> {
    Ok(repository::list_by_preset(conn, preset_id)?)
}

pub fn list_all(conn: &Connection) -> AppResult<Vec<PresetItem>> {
    Ok(repository::list_all(conn)?)
}

/// プリセットからツールを外す（preset_items 行のみ削除。Tool 自体は削除しない）。
pub fn remove(conn: &Connection, id: &str) -> AppResult<()> {
    let affected = repository::delete(conn, id)?;
    if affected == 0 {
        return Err(AppError::NotFound(format!(
            "プリセットのツールが見つかりません: {id}"
        )));
    }
    Ok(())
}

/// 起動モード・有効フラグを更新する。
pub fn update(
    conn: &Connection,
    id: &str,
    input: UpdatePresetItemInput,
) -> AppResult<PresetItem> {
    let existing = repository::get(conn, id)?.ok_or_else(|| {
        AppError::NotFound(format!("プリセットのツールが見つかりません: {id}"))
    })?;

    let updated = PresetItem {
        launch_mode: input.launch_mode,
        enabled: input.enabled,
        updated_at: chrono::Utc::now().to_rfc3339(),
        ..existing
    };
    repository::update(conn, &updated)?;
    Ok(updated)
}

/// プリセット内の起動順を、渡された id の並び順どおりに再割当する（0..n）。
/// 渡された id 群が当該プリセットの全アイテムと完全一致することを検証する。
pub fn reorder(
    conn: &Connection,
    preset_id: &str,
    ordered_ids: Vec<String>,
) -> AppResult<Vec<PresetItem>> {
    let current = repository::list_by_preset(conn, preset_id)?;
    if ordered_ids.len() != current.len() {
        return Err(AppError::Validation(
            "並び替え対象がプリセットのツール一覧と一致しません".into(),
        ));
    }
    let current_ids: std::collections::HashSet<&str> =
        current.iter().map(|i| i.id.as_str()).collect();
    if !ordered_ids.iter().all(|id| current_ids.contains(id.as_str())) {
        return Err(AppError::Validation(
            "並び替え対象にプリセット外のツールが含まれています".into(),
        ));
    }

    let now = chrono::Utc::now().to_rfc3339();
    for (index, id) in ordered_ids.iter().enumerate() {
        repository::update_order_index(conn, id, index as u32, &now)?;
    }
    Ok(repository::list_by_preset(conn, preset_id)?)
}
