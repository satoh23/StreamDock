use rusqlite::{Connection, OptionalExtension};

use super::model::Preset;

/// SELECT で取得する presets テーブルの全カラム（複数クエリで共有）。
const PRESET_COLUMNS: &str = "id, name, description, created_at, updated_at";

/// presets テーブルを作成する（存在すれば何もしない）。
pub fn init(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS presets (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            created_at  TEXT NOT NULL,
            updated_at  TEXT NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_presets_name
            ON presets(name);",
    )?;
    Ok(())
}

fn row_to_preset(row: &rusqlite::Row<'_>) -> rusqlite::Result<Preset> {
    Ok(Preset {
        id: row.get("id")?,
        name: row.get("name")?,
        description: row.get("description")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

pub fn insert(conn: &Connection, preset: &Preset) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO presets
            (id, name, description, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![
            preset.id,
            preset.name,
            preset.description,
            preset.created_at,
            preset.updated_at,
        ],
    )?;
    Ok(())
}

pub fn list(conn: &Connection) -> rusqlite::Result<Vec<Preset>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {PRESET_COLUMNS} FROM presets ORDER BY created_at ASC"
    ))?;
    let rows = stmt.query_map([], row_to_preset)?;
    rows.collect()
}

pub fn get(conn: &Connection, id: &str) -> rusqlite::Result<Option<Preset>> {
    conn.query_row(
        &format!("SELECT {PRESET_COLUMNS} FROM presets WHERE id = ?1"),
        rusqlite::params![id],
        row_to_preset,
    )
    .optional()
}

/// name が一致するプリセットを返す（重複チェック用）。
pub fn find_by_name(conn: &Connection, name: &str) -> rusqlite::Result<Option<Preset>> {
    conn.query_row(
        &format!("SELECT {PRESET_COLUMNS} FROM presets WHERE name = ?1"),
        rusqlite::params![name],
        row_to_preset,
    )
    .optional()
}

pub fn update(conn: &Connection, preset: &Preset) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE presets SET
            name = ?2,
            description = ?3,
            updated_at = ?4
         WHERE id = ?1",
        rusqlite::params![
            preset.id,
            preset.name,
            preset.description,
            preset.updated_at,
        ],
    )?;
    Ok(())
}

pub fn delete(conn: &Connection, id: &str) -> rusqlite::Result<usize> {
    let affected = conn.execute("DELETE FROM presets WHERE id = ?1", rusqlite::params![id])?;
    Ok(affected)
}
