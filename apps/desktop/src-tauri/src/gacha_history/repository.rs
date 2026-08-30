//! 063h: `gacha_draws` テーブルの SQL 層。
//!
//! ⚠⚠ **SQL は完全な文字列リテラルだけで組む**（docs/security.md §8）。列名の共有は
//! **`concat!`**（コンパイル時連結）で行っており、⚠⚠⚠ **本モジュールに文字列整形マクロの
//! 呼び出しは 1 つも無い**——`stream_summary` が担保している性質を新モジュールでも保つため
//! （`stream_session` は `SELECT {COLUMNS}` の連結にあのマクロを使っているが、
//! あちらは 062b 以前の作法である）。
//!
//! ⚠⚠⚠ **この doc に検証で使う grep のパターン（`format` ＋ `!` ＋ 開き括弧）を書かないこと。**
//! 書くと `grep -rn` が**この行そのものに当たり**、「SQL を組み立てている」と誤読される
//! （`stream_summary` が実際にその状態で、063i の起票時に 6 件の偽陽性として問題になった）。
//!
//! 既存の各 repository と同じく `init()` は**冪等 DDL**で、マイグレーション基盤（`PRAGMA user_version`）は
//! 使わない。列の後付けが要るときは `util::ensure_column`。

use rusqlite::Connection;

use super::model::NewGachaDraw;

/// `gacha_draws` テーブルを作成する（存在すれば何もしない）。
///
/// ## ⚠⚠ FK を 1 つも張らない（**張り忘れではない**）
///
/// `viewer_id` / `session_id` のどちらにも FK を張らない。理由は `mod.rs` の注記が正
/// （記録の順序が保証できない ／ `viewers` 行を先に作ると 038c の初見バッジが壊れる）。
/// ⚠ **代わりに削除は明示 DELETE で行う**（[`delete_by_viewer`] / [`delete_all`]）。
///
/// ## 索引
///
/// ⚠⚠ **`(session_id, drawn_at, id)` の 3 列**。063i の一覧は
/// `WHERE session_id = ?1 ORDER BY drawn_at DESC, id DESC` で引く。
///
/// - 単一列（`session_id` だけ）にすると **`USE TEMP B-TREE FOR ORDER BY`**（全件ソート）が走る。
/// - ⚠ **2 列（`session_id, drawn_at`）でも足りない**——`id DESC` のぶんが
///   **`USE TEMP B-TREE FOR RIGHT PART OF ORDER BY`** になる（実測・2026-08-30）。
///   ⚠⚠ `id` の同点崩しは**捨てられない**: 記録 id は `${commentId}:${gachaId}:${nth}` なので、
///   **同じコメントで 2 つのガチャが当たると `drawn_at` が同値になりうる**（frontend が同じ
///   バッチで作る）。並びが実装依存になると、063i の「並び順」テストが不安定になる。
/// - ⇒ **3 列にして並び替えまで索引で賄う。**
///
/// `viewer_id` の索引は**削除（`delete_by_viewer`）のためだけに要る**ので別に張る。
pub fn init(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS gacha_draws (
            id           TEXT PRIMARY KEY,
            session_id   TEXT NOT NULL,
            viewer_id    TEXT NOT NULL,
            viewer_name  TEXT NOT NULL,
            gacha_id     TEXT NOT NULL,
            gacha_name   TEXT NOT NULL,
            prize_label  TEXT,
            rare         INTEGER NOT NULL DEFAULT 0,
            drawn_at     TEXT NOT NULL,
            created_at   TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_gacha_draws_session
            ON gacha_draws(session_id, drawn_at, id);
        CREATE INDEX IF NOT EXISTS idx_gacha_draws_viewer
            ON gacha_draws(viewer_id);",
    )?;
    Ok(())
}

/// 1 行挿入する SQL。
///
/// ⚠⚠⚠ **`INSERT OR IGNORE` である**（穴 A）。記録 id が決定的なので、
/// StrictMode の二重実行でも再送でも**行が増えない**。⚠ `OR REPLACE` にしないこと——
/// 同じ id で内容だけ違う行が来たときに**先に入った正しい記録を上書きする**。
const INSERT_SQL: &str = concat!(
    "INSERT OR IGNORE INTO gacha_draws (",
    "id, session_id, viewer_id, viewer_name, gacha_id, gacha_name, ",
    "prize_label, rare, drawn_at, created_at",
    ") VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)"
);

/// 検証済みの 1 件を記録する。挿入された行数（0 ＝ 既に同じ id が在った）を返す。
///
/// ⚠ **`draw` は [`super::service`] が検証済みの値であること**（生の frontend 入力を直接渡さない）。
pub fn insert(conn: &Connection, draw: &NewGachaDraw, created_at: &str) -> rusqlite::Result<usize> {
    conn.execute(
        INSERT_SQL,
        rusqlite::params![
            draw.id,
            draw.session_id,
            draw.viewer_id,
            draw.viewer_name,
            draw.gacha_id,
            draw.gacha_name,
            // ⚠ `Option<String>` はそのまま NULL / TEXT にバインドされる（空文字へ潰さない）。
            draw.prize_label,
            draw.rare,
            draw.drawn_at,
            created_at,
        ],
    )
}

/// ⚠⚠ 1 人ぶんの記録を消す（**`delete_viewer` から呼ばれる**・FK CASCADE の代わり）。
///
/// ⚠ 消した行数を返すが、**呼び出し側は 0 件を失敗として扱わないこと**——
/// ガチャを 1 度も引いていない視聴者を消したときは正常に 0 件である。
pub fn delete_by_viewer(conn: &Connection, viewer_id: &str) -> rusqlite::Result<usize> {
    conn.execute(
        "DELETE FROM gacha_draws WHERE viewer_id = ?1",
        rusqlite::params![viewer_id],
    )
}

/// ⚠⚠ 全件消す（**`clear_viewers` から呼ばれる**・プライバシー手段の全消去）。
pub fn delete_all(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM gacha_draws", [])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// テスト用の in-memory 接続（本番同様に `foreign_keys = ON` を有効化する）。
    ///
    /// ⚠ 本モジュールは FK を 1 つも張らないが、**「ON にしても落ちない」ことを毎回通す**ために
    /// 本番と同じ設定にしておく（FK を後から足した人が気付けるようにする）。
    fn test_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute("PRAGMA foreign_keys = ON", []).unwrap();
        init(&conn).unwrap();
        conn
    }

    fn draw(id: &str, viewer_id: &str, prize_label: Option<&str>) -> NewGachaDraw {
        NewGachaDraw {
            id: id.to_string(),
            session_id: "s1".to_string(),
            viewer_id: viewer_id.to_string(),
            viewer_name: "アリス".to_string(),
            gacha_id: "g:1".to_string(),
            gacha_name: "朝ガチャ".to_string(),
            prize_label: prize_label.map(str::to_string),
            rare: false,
            drawn_at: "2026-08-30T12:00:00Z".to_string(),
        }
    }

    fn count(conn: &Connection) -> i64 {
        conn.query_row("SELECT COUNT(*) FROM gacha_draws", [], |r| r.get(0))
            .unwrap()
    }

    #[test]
    fn init_is_idempotent() {
        let conn = test_conn();
        init(&conn).unwrap();
        init(&conn).unwrap();
        assert_eq!(count(&conn), 0);
    }

    /// ⚠⚠ 穴 A: 同じ id の二重記録で行が増えないこと（StrictMode の二重実行・再送）。
    #[test]
    fn the_same_id_is_recorded_only_once() {
        let conn = test_conn();
        assert_eq!(
            insert(&conn, &draw("c1:g:1:0", "twitch:1", Some("色紙")), "t").unwrap(),
            1
        );
        assert_eq!(
            insert(&conn, &draw("c1:g:1:0", "twitch:1", Some("色紙")), "t").unwrap(),
            0
        );
        assert_eq!(count(&conn), 1);
    }

    /// ⚠⚠⚠ **`prize_label` の `None` が NULL として入り、空文字にならないこと。**
    ///
    /// ⚠ 空文字へ潰すと、063i で「何も出ない」が出なくなる（ミューテーション 3 が狙う場所）。
    #[test]
    fn a_draw_that_won_nothing_is_stored_as_null_not_an_empty_string() {
        let conn = test_conn();
        insert(&conn, &draw("c1:g:1:0", "twitch:1", None), "t").unwrap();
        let is_null: bool = conn
            .query_row(
                "SELECT prize_label IS NULL FROM gacha_draws WHERE id = ?1",
                rusqlite::params!["c1:g:1:0"],
                |r| r.get(0),
            )
            .unwrap();
        assert!(is_null, "何も当たらなかった抽選は NULL で保存されること");
    }

    /// ⚠ 削除連動: その視聴者のぶんだけ消え、他人の行が巻き添えにならないこと。
    #[test]
    fn delete_by_viewer_removes_only_that_viewers_rows() {
        let conn = test_conn();
        insert(&conn, &draw("a", "twitch:1", Some("色紙")), "t").unwrap();
        insert(&conn, &draw("b", "twitch:1", None), "t").unwrap();
        insert(&conn, &draw("c", "twitch:2", Some("色紙")), "t").unwrap();

        assert_eq!(delete_by_viewer(&conn, "twitch:1").unwrap(), 2);
        assert_eq!(count(&conn), 1);
        // ⚠ 引いていない視聴者を消しても 0 件で正常（失敗にしないこと）。
        assert_eq!(delete_by_viewer(&conn, "twitch:999").unwrap(), 0);
    }

    #[test]
    fn delete_all_removes_every_row() {
        let conn = test_conn();
        insert(&conn, &draw("a", "twitch:1", Some("色紙")), "t").unwrap();
        insert(&conn, &draw("b", "twitch:2", None), "t").unwrap();
        delete_all(&conn).unwrap();
        assert_eq!(count(&conn), 0);
    }

    /// ⚠⚠ 063i が引くクエリの形（`WHERE session_id = ?1 ORDER BY drawn_at DESC, id DESC`）が
    /// **複合索引 `(session_id, drawn_at)` で並び替えまで賄えること**を固定する。
    ///
    /// ⚠⚠⚠ **`EXPLAIN QUERY PLAN` は複数行を返す。** `query_row` で先頭行だけを読むと
    /// **`USE TEMP B-TREE FOR ORDER BY` の行（2 行目）を見落とす**——実際、最初の実装がそれで、
    /// 「索引を単一列へ戻す」変異が**生存した**（2026-08-30・実測）。⇒ **全行を連結して見ること。**
    #[test]
    fn the_session_index_covers_the_ordering_the_summary_uses() {
        let conn = test_conn();
        let mut stmt = conn
            .prepare(
                "EXPLAIN QUERY PLAN SELECT id FROM gacha_draws \
                 WHERE session_id = ?1 ORDER BY drawn_at DESC, id DESC",
            )
            .unwrap();
        let plan: String = stmt
            .query_map(rusqlite::params!["s1"], |r| r.get::<_, String>(3))
            .unwrap()
            .map(Result::unwrap)
            .collect::<Vec<_>>()
            .join(" | ");
        assert!(
            plan.contains("idx_gacha_draws_session"),
            "セッション索引が使われていない: {plan}"
        );
        assert!(
            !plan.contains("TEMP B-TREE"),
            "並び替えのために一時 B-Tree が作られている（索引が (session_id, drawn_at) でない）: {plan}"
        );
    }
}
