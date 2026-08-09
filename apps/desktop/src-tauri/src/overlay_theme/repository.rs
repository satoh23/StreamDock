//! 060b: `overlay_themes` テーブルの SQL 層。
//!
//! 識別子（テーブル名・カラム名・ORDER BY 句）は**コンパイル時定数のみ**を使い、値は必ず
//! パラメータバインドする（docs/security.md §8）。既存の各 repository と同じく `init()` は冪等 DDL で、
//! マイグレーション基盤は使わない。

use rusqlite::{Connection, OptionalExtension};
use serde::de::DeserializeOwned;

use super::model::{OverlayThemeOrigin, OverlayThemeRecord};

/// SELECT で取得する全カラム（複数クエリで共有）。
///
/// ⚠ `file_name` はここに含めるが、**`OverlayThemeRecord` には載せない**（frontend へ返さない）。
/// 実ファイル名を知らせないことで「frontend がパスを組み立てる」経路そのものを作らない（§3 / §5）。
const THEME_COLUMNS: &str = "id, name, file_name, origin, stripped_count, created_at, updated_at";

/// `overlay_themes` テーブルを作成する（存在すれば何もしない）。
///
/// ⚠⚠ **`name` に UNIQUE を張らない**（060b の設計判断・本人確認済み）。
/// `presets.name` が UNIQUE なのは、プリセットが**一括起動の対象を一意に指す組織キー**だからだが、
/// テーマは「試しに 2 つ入れて見比べる」使い方が普通で、同名衝突で**取り込みごと失敗する**のは損失が大きい。
/// 加えて UNIQUE 違反は `From<rusqlite::Error>` により `StorageFailed`（「アプリ内の保存処理に失敗しました」）へ
/// 潰れるので、ユーザーには**原因の分からないエラー**として出る。重複の周知は 060d が UI 側の警告
/// （ブロックしない）で行う。
/// 再修正トリガー＝「一覧で見分けがつかない」という実際の苦情が出たら、UNIQUE ではなく
/// UI 側の連番サジェスト（「配信用 (2)」）を先に検討すること。
///
/// 索引は張らない（数十件規模で、一覧は常に全件を `created_at` 降順で返すため）。
pub fn init(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS overlay_themes (
            id             TEXT PRIMARY KEY,
            name           TEXT NOT NULL,
            file_name      TEXT NOT NULL,
            origin         TEXT NOT NULL,
            stripped_count INTEGER NOT NULL DEFAULT 0,
            created_at     TEXT NOT NULL,
            updated_at     TEXT NOT NULL
        );",
    )?;
    // 060h: 取得した Web フォントを収めた**2 つ目の管理ファイル**の名前（無ければ NULL）。
    // ⚠⚠ 意匠と同じ `<uuid v4>.css` 形（別採番）なので、`is_managed_file_name` は 1 文字も緩めていない。
    // マイグレーション基盤が無いため冪等 ADD COLUMN（table/column/decl はコンパイル時定数のみ）。
    crate::util::ensure_column(conn, "overlay_themes", "font_file_name", "TEXT")?;
    Ok(())
}

/// `app_logs::repository` と同じイディオム（enum ⇄ DB 文字列）。
fn enum_to_db<T: serde::Serialize>(value: T) -> Option<String> {
    serde_json::to_value(value)
        .ok()
        .and_then(|v| v.as_str().map(str::to_string))
}

fn enum_from_db<T: DeserializeOwned>(s: &str) -> Option<T> {
    serde_json::from_value(serde_json::Value::String(s.to_string())).ok()
}

/// DB 行 → DTO。⚠ `file_name` は DTO に写さない（[`file_name_of`] で別に引く）。
fn row_to_theme(row: &rusqlite::Row<'_>) -> rusqlite::Result<OverlayThemeRecord> {
    let origin: String = row.get("origin")?;
    let stripped_count: i64 = row.get("stripped_count")?;
    Ok(OverlayThemeRecord {
        id: row.get("id")?,
        name: row.get("name")?,
        // 未知の文字列は `Local` へ劣化させる（前方互換。060c が足す `snapshot` を知らない古いビルドでも落ちない）。
        origin: enum_from_db::<OverlayThemeOrigin>(&origin).unwrap_or(OverlayThemeOrigin::Local),
        stripped_count: u32::try_from(stripped_count).unwrap_or(0),
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

/// 1 件登録する。
pub fn insert(
    conn: &Connection,
    theme: &OverlayThemeRecord,
    file_name: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO overlay_themes
            (id, name, file_name, origin, stripped_count, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![
            theme.id,
            theme.name,
            file_name,
            enum_to_db(theme.origin).unwrap_or_else(|| "local".to_string()),
            theme.stripped_count,
            theme.created_at,
            theme.updated_at,
        ],
    )?;
    Ok(())
}

/// 新しい順に全件返す。
pub fn list(conn: &Connection) -> rusqlite::Result<Vec<OverlayThemeRecord>> {
    let sql = format!(
        "SELECT {THEME_COLUMNS} FROM overlay_themes ORDER BY created_at DESC, id DESC"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], row_to_theme)?;
    rows.collect()
}

/// id で 1 件返す。
pub fn get(conn: &Connection, id: &str) -> rusqlite::Result<Option<OverlayThemeRecord>> {
    let sql = format!("SELECT {THEME_COLUMNS} FROM overlay_themes WHERE id = ?1");
    let mut stmt = conn.prepare(&sql)?;
    stmt.query_row([id], row_to_theme).optional()
}

/// id に対応する**保存ファイル名**だけを引く。
///
/// ⚠ 呼び出し側（`service`）は、この値をパスへ結合する前に必ず `is_managed_file_name` を通すこと。
pub fn file_name_of(conn: &Connection, id: &str) -> rusqlite::Result<Option<String>> {
    let mut stmt = conn.prepare("SELECT file_name FROM overlay_themes WHERE id = ?1")?;
    stmt.query_row([id], |row| row.get::<_, String>(0)).optional()
}

/// 060h: id に対応する**フォント資産のファイル名**だけを引く（未設定なら `None`）。
///
/// ⚠ `file_name_of` と同じく、**パスへ結合する前に必ず `is_managed_file_name` を通すこと**。
/// ⚠ `OverlayThemeRecord` には載せない（frontend に実ファイル名を知らせない・§3 / §5）。
pub fn font_file_name_of(conn: &Connection, id: &str) -> rusqlite::Result<Option<String>> {
    let mut stmt = conn.prepare("SELECT font_file_name FROM overlay_themes WHERE id = ?1")?;
    stmt.query_row([id], |row| row.get::<_, Option<String>>(0))
        .optional()
        .map(|v| v.flatten())
}

/// 060h: フォント資産のファイル名を設定する。戻りは更新行数。
pub fn set_font_file_name(
    conn: &Connection,
    id: &str,
    file_name: &str,
    updated_at: &str,
) -> rusqlite::Result<usize> {
    conn.execute(
        "UPDATE overlay_themes SET font_file_name = ?2, updated_at = ?3 WHERE id = ?1",
        rusqlite::params![id, file_name, updated_at],
    )
}

/// 名前を更新する。戻りは更新行数。
pub fn update_name(
    conn: &Connection,
    id: &str,
    name: &str,
    updated_at: &str,
) -> rusqlite::Result<usize> {
    conn.execute(
        "UPDATE overlay_themes SET name = ?2, updated_at = ?3 WHERE id = ?1",
        rusqlite::params![id, name, updated_at],
    )
}

/// 1 件削除する。戻りは削除行数（0 なら存在しなかった）。
pub fn delete(conn: &Connection, id: &str) -> rusqlite::Result<usize> {
    conn.execute("DELETE FROM overlay_themes WHERE id = ?1", [id])
}

/// 登録済みテーマの件数。
pub fn count(conn: &Connection) -> rusqlite::Result<u32> {
    let n: i64 = conn.query_row("SELECT COUNT(*) FROM overlay_themes", [], |row| row.get(0))?;
    Ok(u32::try_from(n).unwrap_or(u32::MAX))
}

#[cfg(test)]
mod tests {
    //! `overlay_themes` の SQL 層の仕様テスト（`viewer_memory::repository` と同型・in-memory SQLite）。

    use super::*;
    use crate::util::now_rfc3339;

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

    fn theme(id: &str, name: &str) -> OverlayThemeRecord {
        let now = now_rfc3339();
        OverlayThemeRecord {
            id: id.to_string(),
            name: name.to_string(),
            origin: OverlayThemeOrigin::Local,
            stripped_count: 3,
            created_at: now.clone(),
            updated_at: now,
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
        let t = theme("id-1", "配信用");
        assert!(insert(&conn, &t, "id-1.css").is_ok());

        let got = get(&conn, "id-1").ok().flatten();
        assert_eq!(got.as_ref(), Some(&t));
        assert_eq!(
            file_name_of(&conn, "id-1").ok().flatten(),
            Some("id-1.css".to_string())
        );
    }

    #[test]
    fn duplicate_names_are_allowed() {
        // ⚠ `presets.name` と違って UNIQUE を張らない（`init` の注記）。ここが落ちるようになったら
        // 「同名で入れ直して見比べる」が壊れているので、UNIQUE を足した変更を疑うこと。
        let conn = conn();
        assert!(insert(&conn, &theme("id-1", "同じ名前"), "id-1.css").is_ok());
        assert!(insert(&conn, &theme("id-2", "同じ名前"), "id-2.css").is_ok());
        assert_eq!(count(&conn).unwrap_or(0), 2);
    }

    #[test]
    fn list_returns_newest_first() {
        let conn = conn();
        let mut older = theme("id-old", "古い");
        older.created_at = "2026-08-01T00:00:00Z".to_string();
        let mut newer = theme("id-new", "新しい");
        newer.created_at = "2026-08-05T00:00:00Z".to_string();
        assert!(insert(&conn, &older, "id-old.css").is_ok());
        assert!(insert(&conn, &newer, "id-new.css").is_ok());

        let ids: Vec<String> = list(&conn)
            .unwrap_or_default()
            .into_iter()
            .map(|t| t.id)
            .collect();
        assert_eq!(ids, vec!["id-new".to_string(), "id-old".to_string()]);
    }

    #[test]
    fn update_name_touches_one_row_and_missing_ids_touch_none() {
        let conn = conn();
        assert!(insert(&conn, &theme("id-1", "旧"), "id-1.css").is_ok());
        assert_eq!(
            update_name(&conn, "id-1", "新", "2026-08-05T00:00:00Z").unwrap_or(0),
            1
        );
        assert_eq!(
            update_name(&conn, "no-such-id", "新", "2026-08-05T00:00:00Z").unwrap_or(9),
            0
        );

        let got = get(&conn, "id-1").ok().flatten();
        assert_eq!(got.map(|t| t.name), Some("新".to_string()));
    }

    #[test]
    fn delete_removes_one_row_and_is_safe_to_repeat() {
        // 二重削除で落ちず、2 回目は 0 行（service が NotFound に変換する）。
        let conn = conn();
        assert!(insert(&conn, &theme("id-1", "配信用"), "id-1.css").is_ok());
        assert_eq!(delete(&conn, "id-1").unwrap_or(0), 1);
        assert_eq!(delete(&conn, "id-1").unwrap_or(9), 0);
        assert_eq!(count(&conn).unwrap_or(9), 0);
        assert_eq!(get(&conn, "id-1").ok().flatten(), None);
    }

    #[test]
    fn an_unknown_origin_string_degrades_to_local_instead_of_failing() {
        // 前方互換: 060c が足す 'snapshot' を知らない古いビルドで読んでも落ちない。
        let conn = conn();
        let now = now_rfc3339();
        let inserted = conn.execute(
            "INSERT INTO overlay_themes
                (id, name, file_name, origin, stripped_count, created_at, updated_at)
             VALUES ('id-x', 'x', 'id-x.css', 'from-the-future', 0, ?1, ?1)",
            [&now],
        );
        assert!(inserted.is_ok());
        let got = get(&conn, "id-x").ok().flatten();
        assert_eq!(got.map(|t| t.origin), Some(OverlayThemeOrigin::Local));
    }

    #[test]
    fn snapshot_origin_round_trips() {
        // 060b は生成しないが、060c が入れた行を読めること（列の型が合っていること）。
        let conn = conn();
        let mut t = theme("id-1", "スナップショット");
        t.origin = OverlayThemeOrigin::Snapshot;
        assert!(insert(&conn, &t, "id-1.css").is_ok());
        let got = get(&conn, "id-1").ok().flatten();
        assert_eq!(got.map(|t| t.origin), Some(OverlayThemeOrigin::Snapshot));
    }
}
