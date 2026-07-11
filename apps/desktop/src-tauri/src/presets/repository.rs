use rusqlite::{Connection, OptionalExtension};

use super::model::Preset;

/// SELECT で取得する presets テーブルの全カラム（複数クエリで共有）。
const PRESET_COLUMNS: &str =
    "id, name, description, auto_launch_on_boot, created_at, updated_at";

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
    // 019: PC 起動時の自動一括起動フラグ。マイグレーション基盤が無いため、
    // 既存 DB でも落ちないよう冪等 ADD COLUMN（table/column/decl はコンパイル時定数のみ）。
    crate::util::ensure_column(conn, "presets", "auto_launch_on_boot", "INTEGER NOT NULL DEFAULT 0")?;
    Ok(())
}

fn row_to_preset(row: &rusqlite::Row<'_>) -> rusqlite::Result<Preset> {
    let auto_launch_on_boot: i64 = row.get("auto_launch_on_boot")?;
    Ok(Preset {
        id: row.get("id")?,
        name: row.get("name")?,
        description: row.get("description")?,
        auto_launch_on_boot: auto_launch_on_boot != 0,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

pub fn insert(conn: &Connection, preset: &Preset) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO presets
            (id, name, description, auto_launch_on_boot, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![
            preset.id,
            preset.name,
            preset.description,
            preset.auto_launch_on_boot as i64,
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
            auto_launch_on_boot = ?4,
            updated_at = ?5
         WHERE id = ?1",
        rusqlite::params![
            preset.id,
            preset.name,
            preset.description,
            preset.auto_launch_on_boot as i64,
            preset.updated_at,
        ],
    )?;
    Ok(())
}

/// auto_launch_on_boot が有効なプリセット数（reconcile の不変条件判定に使う）。
pub fn count_auto_launch_on_boot(conn: &Connection) -> rusqlite::Result<i64> {
    conn.query_row(
        "SELECT COUNT(*) FROM presets WHERE auto_launch_on_boot != 0",
        [],
        |row| row.get(0),
    )
}

/// auto_launch_on_boot が有効なプリセット一覧（起動時フックの自動一括起動対象）。
pub fn list_auto_launch_on_boot(conn: &Connection) -> rusqlite::Result<Vec<Preset>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {PRESET_COLUMNS} FROM presets WHERE auto_launch_on_boot != 0 ORDER BY created_at ASC"
    ))?;
    let rows = stmt.query_map([], row_to_preset)?;
    rows.collect()
}

pub fn delete(conn: &Connection, id: &str) -> rusqlite::Result<usize> {
    let affected = conn.execute("DELETE FROM presets WHERE id = ?1", rusqlite::params![id])?;
    Ok(affected)
}
