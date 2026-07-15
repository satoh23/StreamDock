use rusqlite::{Connection, OptionalExtension};

use super::model::{Tool, ToolKind};

/// SELECT で取得する tools テーブルの全カラム（複数クエリで共有）。
const TOOL_COLUMNS: &str =
    "id, name, executable_path, description, icon_label, icon_png, kind, url, created_at, updated_at";

/// tools テーブルを作成する（存在すれば何もしない）。
pub fn init(conn: &Connection) -> rusqlite::Result<()> {
    // インデックスはここでは作らない。`kind` 列を後付け（ensure_column）してからでないと
    // 部分ユニークインデックス（WHERE kind = 'executable'）を張れないため、下で作成する。
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS tools (
            id              TEXT PRIMARY KEY,
            name            TEXT NOT NULL,
            executable_path TEXT NOT NULL,
            description     TEXT NOT NULL DEFAULT '',
            icon_label      TEXT NOT NULL DEFAULT '',
            created_at      TEXT NOT NULL,
            updated_at      TEXT NOT NULL
        );",
    )?;
    // 018: 既存 DB にも `icon_png`（nullable）を冪等に追加する。マイグレーション基盤が無いため
    // pragma で存在確認してから ADD COLUMN する共通ヘルパを使う（既存インストールでも落ちない）。
    crate::util::ensure_column(conn, "tools", "icon_png", "TEXT")?;
    // 023: 種別カラム。既存行は 'executable' 既定で埋まる（NOT NULL ＋ 定数 DEFAULT は SQLite で許容）。
    crate::util::ensure_column(conn, "tools", "kind", "TEXT NOT NULL DEFAULT 'executable'")?;
    // 023: url 種別用の URL（nullable。executable 種別では NULL）。
    crate::util::ensure_column(conn, "tools", "url", "TEXT")?;
    // 023: executable_path の重複防止を維持しつつ、url 種別（executable_path 空文字）の衝突を避けるため
    // 旧・全行 UNIQUE インデックスを撤去し、`kind = 'executable'` の部分ユニークインデックスへ移行する。
    // DROP IF EXISTS + CREATE IF NOT EXISTS で冪等（新規/既存/再起動いずれも最終状態は部分 index のみ）。
    conn.execute_batch(
        "DROP INDEX IF EXISTS idx_tools_executable_path;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_tools_executable_path_executable
            ON tools(executable_path) WHERE kind = 'executable';",
    )?;
    // 032c-a: 内蔵コメントビューアを固定 id で冪等 seed する（既存なら何もしない＝毎起動安全）。
    // kind='internal'・executable_path 空・url NULL。部分ユニーク index（WHERE kind='executable'）の
    // 対象外なので executable_path 空でも衝突しない。id は PRIMARY KEY のため `INSERT OR IGNORE` が
    // `ON CONFLICT(id) DO NOTHING` 相当になる（name などをユーザーが後から変えても再 seed で上書きしない）。
    let now = crate::util::now_rfc3339();
    conn.execute(
        "INSERT OR IGNORE INTO tools
            (id, name, executable_path, description, icon_label, kind, url, created_at, updated_at)
         VALUES ('builtin-comment-viewer', 'コメントビューア', '', '', '', 'internal', NULL, ?1, ?1)",
        rusqlite::params![now],
    )?;
    Ok(())
}

fn row_to_tool(row: &rusqlite::Row<'_>) -> rusqlite::Result<Tool> {
    let kind: String = row.get("kind")?;
    Ok(Tool {
        id: row.get("id")?,
        name: row.get("name")?,
        executable_path: row.get("executable_path")?,
        description: row.get("description")?,
        icon_label: row.get("icon_label")?,
        icon_png: row.get("icon_png")?,
        // 未知値（前方互換）は executable に丸める。
        kind: ToolKind::from_str_lenient(&kind),
        url: row.get("url")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

pub fn insert(conn: &Connection, tool: &Tool) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO tools
            (id, name, executable_path, description, icon_label, icon_png, kind, url, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        rusqlite::params![
            tool.id,
            tool.name,
            tool.executable_path,
            tool.description,
            tool.icon_label,
            tool.icon_png,
            tool.kind.as_str(),
            tool.url,
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

/// url が一致する url 種別ツールを返す（023 url 種別の重複チェック用）。
pub fn find_by_url(conn: &Connection, url: &str) -> rusqlite::Result<Option<Tool>> {
    conn.query_row(
        &format!("SELECT {TOOL_COLUMNS} FROM tools WHERE kind = 'url' AND url = ?1"),
        rusqlite::params![url],
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
            kind = ?7,
            url = ?8,
            updated_at = ?9
         WHERE id = ?1",
        rusqlite::params![
            tool.id,
            tool.name,
            tool.executable_path,
            tool.description,
            tool.icon_label,
            tool.icon_png,
            tool.kind.as_str(),
            tool.url,
            tool.updated_at,
        ],
    )?;
    Ok(())
}

pub fn delete(conn: &Connection, id: &str) -> rusqlite::Result<usize> {
    let affected = conn.execute("DELETE FROM tools WHERE id = ?1", rusqlite::params![id])?;
    Ok(affected)
}
