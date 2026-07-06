use rusqlite::{Connection, OptionalExtension};

use super::model::{LaunchMode, PresetItem};

/// SELECT で取得する preset_items テーブルの全カラム（複数クエリで共有）。
const PRESET_ITEM_COLUMNS: &str =
    "id, preset_id, tool_id, launch_mode, order_index, enabled, created_at, updated_at";

/// preset_items テーブルを作成する（存在すれば何もしない）。
/// preset_id / tool_id は外部キーで presets / tools を参照し、親削除時にカスケード除去する
/// （孤児行を防ぐ。外部キーの有効化は lib.rs の `PRAGMA foreign_keys = ON` で行う）。
/// 同一プリセット内での同一ツール重複は UNIQUE INDEX で防ぐ。
pub fn init(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS preset_items (
            id          TEXT PRIMARY KEY,
            preset_id   TEXT NOT NULL,
            tool_id     TEXT NOT NULL,
            launch_mode TEXT NOT NULL DEFAULT 'ordered',
            order_index INTEGER NOT NULL,
            enabled     INTEGER NOT NULL DEFAULT 1,
            created_at  TEXT NOT NULL,
            updated_at  TEXT NOT NULL,
            FOREIGN KEY (preset_id) REFERENCES presets(id) ON DELETE CASCADE,
            FOREIGN KEY (tool_id) REFERENCES tools(id) ON DELETE CASCADE
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_preset_items_preset_tool
            ON preset_items(preset_id, tool_id);",
    )?;
    Ok(())
}

fn row_to_preset_item(row: &rusqlite::Row<'_>) -> rusqlite::Result<PresetItem> {
    let launch_mode: String = row.get("launch_mode")?;
    let enabled: i64 = row.get("enabled")?;
    Ok(PresetItem {
        id: row.get("id")?,
        preset_id: row.get("preset_id")?,
        tool_id: row.get("tool_id")?,
        launch_mode: LaunchMode::from_str(&launch_mode),
        order_index: row.get("order_index")?,
        enabled: enabled != 0,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

pub fn insert(conn: &Connection, item: &PresetItem) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO preset_items
            (id, preset_id, tool_id, launch_mode, order_index, enabled, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        rusqlite::params![
            item.id,
            item.preset_id,
            item.tool_id,
            item.launch_mode.as_str(),
            item.order_index,
            item.enabled as i64,
            item.created_at,
            item.updated_at,
        ],
    )?;
    Ok(())
}

/// 指定プリセットのツール一覧を order_index 昇順で返す。
pub fn list_by_preset(conn: &Connection, preset_id: &str) -> rusqlite::Result<Vec<PresetItem>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {PRESET_ITEM_COLUMNS} FROM preset_items
         WHERE preset_id = ?1 ORDER BY order_index ASC"
    ))?;
    let rows = stmt.query_map(rusqlite::params![preset_id], row_to_preset_item)?;
    rows.collect()
}

/// 全プリセットのツール一覧を返す（サイドバーのプリセット別ツール数集計用）。
pub fn list_all(conn: &Connection) -> rusqlite::Result<Vec<PresetItem>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {PRESET_ITEM_COLUMNS} FROM preset_items
         ORDER BY preset_id ASC, order_index ASC"
    ))?;
    let rows = stmt.query_map([], row_to_preset_item)?;
    rows.collect()
}

pub fn get(conn: &Connection, id: &str) -> rusqlite::Result<Option<PresetItem>> {
    conn.query_row(
        &format!("SELECT {PRESET_ITEM_COLUMNS} FROM preset_items WHERE id = ?1"),
        rusqlite::params![id],
        row_to_preset_item,
    )
    .optional()
}

/// 同一プリセット内に同じツールが既に登録されているか調べる（重複チェック用）。
pub fn find_by_preset_and_tool(
    conn: &Connection,
    preset_id: &str,
    tool_id: &str,
) -> rusqlite::Result<Option<PresetItem>> {
    conn.query_row(
        &format!(
            "SELECT {PRESET_ITEM_COLUMNS} FROM preset_items
             WHERE preset_id = ?1 AND tool_id = ?2"
        ),
        rusqlite::params![preset_id, tool_id],
        row_to_preset_item,
    )
    .optional()
}

/// 指定プリセット内の最大 order_index を返す（末尾追加の採番用）。行が無ければ None。
pub fn max_order_index(conn: &Connection, preset_id: &str) -> rusqlite::Result<Option<u32>> {
    conn.query_row(
        "SELECT MAX(order_index) FROM preset_items WHERE preset_id = ?1",
        rusqlite::params![preset_id],
        |row| row.get::<_, Option<u32>>(0),
    )
}

/// launch_mode / enabled / updated_at を更新する（order_index・created_at は維持）。
pub fn update(conn: &Connection, item: &PresetItem) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE preset_items SET
            launch_mode = ?2,
            enabled = ?3,
            updated_at = ?4
         WHERE id = ?1",
        rusqlite::params![
            item.id,
            item.launch_mode.as_str(),
            item.enabled as i64,
            item.updated_at,
        ],
    )?;
    Ok(())
}

/// order_index のみ更新する（reorder 用）。
pub fn update_order_index(
    conn: &Connection,
    id: &str,
    order_index: u32,
    updated_at: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE preset_items SET order_index = ?2, updated_at = ?3 WHERE id = ?1",
        rusqlite::params![id, order_index, updated_at],
    )?;
    Ok(())
}

pub fn delete(conn: &Connection, id: &str) -> rusqlite::Result<usize> {
    let affected =
        conn.execute("DELETE FROM preset_items WHERE id = ?1", rusqlite::params![id])?;
    Ok(affected)
}
