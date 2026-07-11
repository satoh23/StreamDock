use rusqlite::{Connection, OptionalExtension};

use super::model::Tool;

/// SELECT で取得する tools テーブルの全カラム（複数クエリで共有）。
const TOOL_COLUMNS: &str =
    "id, name, executable_path, description, icon_label, icon_png, created_at, updated_at";

/// tools テーブルを作成する（存在すれば何もしない）。
pub fn init(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS tools (
            id              TEXT PRIMARY KEY,
            name            TEXT NOT NULL,
            executable_path TEXT NOT NULL,
            description     TEXT NOT NULL DEFAULT '',
            icon_label      TEXT NOT NULL DEFAULT '',
            created_at      TEXT NOT NULL,
            updated_at      TEXT NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_tools_executable_path
            ON tools(executable_path);",
    )?;
    // 018: 既存 DB にも `icon_png`（nullable）を冪等に追加する。マイグレーション基盤が無いため
    // pragma で存在確認してから ADD COLUMN する共通ヘルパを使う（既存インストールでも落ちない）。
    crate::util::ensure_column(conn, "tools", "icon_png", "TEXT")?;
    Ok(())
}

fn row_to_tool(row: &rusqlite::Row<'_>) -> rusqlite::Result<Tool> {
    Ok(Tool {
        id: row.get("id")?,
        name: row.get("name")?,
        executable_path: row.get("executable_path")?,
        description: row.get("description")?,
        icon_label: row.get("icon_label")?,
        icon_png: row.get("icon_png")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

pub fn insert(conn: &Connection, tool: &Tool) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO tools
            (id, name, executable_path, description, icon_label, icon_png, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        rusqlite::params![
            tool.id,
            tool.name,
            tool.executable_path,
            tool.description,
            tool.icon_label,
            tool.icon_png,
            tool.created_at,
            tool.updated_at,
        ],
    )?;
    Ok(())
}

pub fn list(conn: &Connection) -> rusqlite::Result<Vec<Tool>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {TOOL_COLUMNS} FROM tools ORDER BY created_at ASC"
    ))?;
    let rows = stmt.query_map([], row_to_tool)?;
    rows.collect()
}

pub fn get(conn: &Connection, id: &str) -> rusqlite::Result<Option<Tool>> {
    conn.query_row(
        &format!("SELECT {TOOL_COLUMNS} FROM tools WHERE id = ?1"),
        rusqlite::params![id],
        row_to_tool,
    )
    .optional()
}

/// executable_path が一致するツールを返す（重複チェック用）。
pub fn find_by_executable_path(
    conn: &Connection,
    executable_path: &str,
) -> rusqlite::Result<Option<Tool>> {
    conn.query_row(
        &format!("SELECT {TOOL_COLUMNS} FROM tools WHERE executable_path = ?1"),
        rusqlite::params![executable_path],
        row_to_tool,
    )
    .optional()
}

pub fn update(conn: &Connection, tool: &Tool) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE tools SET
            name = ?2,
            executable_path = ?3,
            description = ?4,
            icon_label = ?5,
            icon_png = ?6,
            updated_at = ?7
         WHERE id = ?1",
        rusqlite::params![
            tool.id,
            tool.name,
            tool.executable_path,
            tool.description,
            tool.icon_label,
            tool.icon_png,
            tool.updated_at,
        ],
    )?;
    Ok(())
}

pub fn delete(conn: &Connection, id: &str) -> rusqlite::Result<usize> {
    let affected = conn.execute("DELETE FROM tools WHERE id = ?1", rusqlite::params![id])?;
    Ok(affected)
}
