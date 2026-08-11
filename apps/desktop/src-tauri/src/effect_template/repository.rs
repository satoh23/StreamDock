//! 061c: `effect_templates` テーブルの SQL 層。
//!
//! 識別子（テーブル名・カラム名・ORDER BY 句）は**コンパイル時定数のみ**を使い、値は必ず
//! パラメータバインドする（docs/security.md §8）。既存の各 repository と同じく `init()` は冪等 DDL で、
//! マイグレーション基盤は使わない。
//!
//! ⚠ **`manifest` は「検証済みの正規化 JSON」を文字列で持つ。** 列に展開しないのは、
//! `layout` / `text` が入れ子を持つうえ 061d 以降で形が増えるためで、
//! **読み出し時に必ず `manifest::parse_manifest` を通し直す**ことで DB を信用しない姿勢を保つ
//! （`service::to_record` が正）。

use rusqlite::{Connection, OptionalExtension};

/// `effect_templates` テーブル 1 行（**Rust 内部の表現**）。
///
/// ⚠ frontend へ返すのは `model::EffectTemplateRecord` で、こちらには `dir_name` が**入らない**。
/// 実ファイル名を知らせないことで「frontend がパスを組み立てる」経路そのものを作らない（§3 / §5）。
pub struct TemplateRow {
    pub id: String,
    pub name: String,
    /// `app_data_dir/effects/` 配下のディレクトリ名（**id 由来**・元パスは保存しない）。
    ///
    /// ⚠ 呼び出し側（`service`）は、この値をパスへ結合する前に必ず `is_managed_dir_name` を通すこと。
    pub dir_name: String,
    /// 検証済み manifest の JSON（`media` / `sound` は**管理下の名前へ書き換え済み**）。
    pub manifest_json: String,
    pub created_at: String,
    pub updated_at: String,
}

/// SELECT で取得する全カラム（複数クエリで共有）。
const TEMPLATE_COLUMNS: &str = "id, name, dir_name, manifest, created_at, updated_at";

/// `effect_templates` テーブルを作成する（存在すれば何もしない）。
///
/// ⚠ **`name` に UNIQUE を張らない**（060b の `overlay_themes` と同じ判断）。
/// 同じテンプレートを別名で 2 つ入れて見比べる使い方が普通で、同名衝突で**取り込みごと失敗する**のは
/// 損失が大きい。加えて UNIQUE 違反は `StorageFailed`（「アプリ内の保存処理に失敗しました」）へ潰れるので、
/// ユーザーには**原因の分からないエラー**として出る。重複の周知は 061d が UI 側の警告で行う。
///
/// 索引は張らない（上限 64 件で、一覧は常に全件を `created_at` 降順で返すため）。
pub fn init(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS effect_templates (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            dir_name    TEXT NOT NULL,
            manifest    TEXT NOT NULL,
            created_at  TEXT NOT NULL,
            updated_at  TEXT NOT NULL
        );",
    )?;
    Ok(())
}

fn row_to_template(row: &rusqlite::Row<'_>) -> rusqlite::Result<TemplateRow> {
    Ok(TemplateRow {
        id: row.get("id")?,
        name: row.get("name")?,
        dir_name: row.get("dir_name")?,
        manifest_json: row.get("manifest")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

/// 1 件登録する。
pub fn insert(conn: &Connection, row: &TemplateRow) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO effect_templates
            (id, name, dir_name, manifest, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![
            row.id,
            row.name,
            row.dir_name,
            row.manifest_json,
            row.created_at,
            row.updated_at,
        ],
    )?;
    Ok(())
}

/// 新しい順に全件返す。
pub fn list(conn: &Connection) -> rusqlite::Result<Vec<TemplateRow>> {
    let sql =
        format!("SELECT {TEMPLATE_COLUMNS} FROM effect_templates ORDER BY created_at DESC, id DESC");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], row_to_template)?;
    rows.collect()
}

/// id で 1 件返す。
pub fn get(conn: &Connection, id: &str) -> rusqlite::Result<Option<TemplateRow>> {
    let sql = format!("SELECT {TEMPLATE_COLUMNS} FROM effect_templates WHERE id = ?1");
    let mut stmt = conn.prepare(&sql)?;
    stmt.query_row([id], row_to_template).optional()
}

/// 1 件削除する。戻りは削除行数（0 なら存在しなかった）。
pub fn delete(conn: &Connection, id: &str) -> rusqlite::Result<usize> {
    conn.execute("DELETE FROM effect_templates WHERE id = ?1", [id])
}

/// 登録済みテンプレートの件数。
pub fn count(conn: &Connection) -> rusqlite::Result<u32> {
    let n: i64 = conn.query_row("SELECT COUNT(*) FROM effect_templates", [], |row| row.get(0))?;
    Ok(u32::try_from(n).unwrap_or(u32::MAX))
}

#[cfg(test)]
mod tests {
    //! `effect_templates` の SQL 層の仕様テスト（`overlay_theme::repository` と同型・in-memory SQLite）。

    use super::*;

    fn conn() -> Connection {
        let conn = match Connection::open_in_memory() {
            Ok(conn) => conn,
            Err(e) => panic!("in-memory SQLite を開けない: {e}"),
        };
        if let Err(e) = init(&conn) {
            panic!("init に失敗: {e}");
        }
        conn
    }

    fn row(id: &str, name: &str) -> TemplateRow {
        TemplateRow {
            id: id.to_string(),
            name: name.to_string(),
            dir_name: id.to_string(),
            manifest_json: r#"{"schemaVersion":1}"#.to_string(),
            created_at: "2026-08-11T00:00:00Z".to_string(),
            updated_at: "2026-08-11T00:00:00Z".to_string(),
        }
    }

    #[test]
    fn init_is_idempotent() {
        let conn = conn();
        assert!(init(&conn).is_ok());
        assert!(init(&conn).is_ok());
    }

    #[test]
    fn insert_then_get_round_trips_every_field() {
        let conn = conn();
        assert!(insert(&conn, &row("id-1", "きらきら")).is_ok());

        let got = match get(&conn, "id-1").ok().flatten() {
            Some(got) => got,
            None => panic!("入れた行が引けない"),
        };
        assert_eq!(got.id, "id-1");
        assert_eq!(got.name, "きらきら");
        assert_eq!(got.dir_name, "id-1");
        assert_eq!(got.manifest_json, r#"{"schemaVersion":1}"#);
        assert_eq!(got.created_at, "2026-08-11T00:00:00Z");
    }

    #[test]
    fn duplicate_names_are_allowed() {
        // ⚠ `presets.name` と違って UNIQUE を張らない（`init` の注記）。ここが落ちるようになったら
        // 「同名で入れ直して見比べる」が壊れているので、UNIQUE を足した変更を疑うこと。
        let conn = conn();
        assert!(insert(&conn, &row("id-1", "同じ名前")).is_ok());
        assert!(insert(&conn, &row("id-2", "同じ名前")).is_ok());
        assert_eq!(count(&conn).unwrap_or(0), 2);
    }

    #[test]
    fn list_returns_newest_first() {
        let conn = conn();
        let mut older = row("id-old", "古い");
        older.created_at = "2026-08-01T00:00:00Z".to_string();
        let mut newer = row("id-new", "新しい");
        newer.created_at = "2026-08-05T00:00:00Z".to_string();
        assert!(insert(&conn, &older).is_ok());
        assert!(insert(&conn, &newer).is_ok());

        let ids: Vec<String> = list(&conn).unwrap_or_default().into_iter().map(|r| r.id).collect();
        assert_eq!(ids, vec!["id-new".to_string(), "id-old".to_string()]);
    }

    #[test]
    fn delete_removes_one_row_and_is_safe_to_repeat() {
        // 二重削除で落ちず、2 回目は 0 行（service が NotFound に変換する）。
        let conn = conn();
        assert!(insert(&conn, &row("id-1", "きらきら")).is_ok());
        assert_eq!(delete(&conn, "id-1").unwrap_or(0), 1);
        assert_eq!(delete(&conn, "id-1").unwrap_or(9), 0);
        assert_eq!(count(&conn).unwrap_or(9), 0);
        assert!(get(&conn, "id-1").ok().flatten().is_none());
    }
}
