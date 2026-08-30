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

use super::model::{GachaDrawRecord, NewGachaDraw};

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

/// 1 回の配信ぶんの一覧を返す SQL（063i・read-only）。
///
/// ## ⚠⚠⚠ この形を変えないこと（`WHERE session_id = ?1 ORDER BY drawn_at DESC, id DESC`）
///
/// 索引 `idx_gacha_draws_session` は **`(session_id, drawn_at, id)` の 3 列**で、
/// **この並びを賄うためだけに 3 列にしてある**（単一列なら `USE TEMP B-TREE FOR ORDER BY`、
/// 2 列でも `RIGHT PART OF ORDER BY` が出る＝063h で実測）。
/// ⚠ 並び順や述語を足すと**一時 B-Tree が黙って復活する**（クエリは正しい結果を返し続けるので
/// 画面でも気付けない）。⇒ [`tests::the_list_query_is_covered_by_the_session_index`] が
/// **この定数そのもの**に `EXPLAIN QUERY PLAN` を掛けて固定している。
///
/// ## ⚠ 出す列（[`GachaDrawRecord`] と 1 対 1）
///
/// `session_id`（呼び出し側が持っている）・`gacha_id`（画面はガチャ**名**で読む）・
/// `created_at`（記録した時刻＝抽選した時刻ではない）は**出さない**。
/// ⚠⚠ **`viewers` を JOIN しない**——一覧は行が持つ `viewer_name`（抽選時点の名前）だけで完結する
/// （JOIN すると「今の名前」に化け、`viewers` に行が無い視聴者の抽選が一覧から消える＝063i 穴 C / 穴 D）。
///
/// ⚠ 上限・ページングは持たない（切るのは画面側＝063i 穴 A）。引数はセッション id 1 つだけ（§3）。
const LIST_BY_SESSION_SQL: &str = concat!(
    "SELECT ",
    "id, viewer_id, viewer_name, gacha_name, prize_label, rare, drawn_at",
    " FROM gacha_draws WHERE session_id = ?1 ORDER BY drawn_at DESC, id DESC"
);

/// 1 回の配信ぶんの抽選記録を新しい順で返す（read-only）。
///
/// ⚠ **行の中身を信用して落ちないこと**（§9 追補〔063h〕レビュー S-3）。`record_gacha_draw` は
/// アプリ定義コマンド＝ACL を通らず全窓から呼べるので、`viewers` にも `stream_sessions` にも
/// 対応行を持たない行が入りうる。ここは JOIN も突き合わせもしないので、そのまま返るのが正しい。
pub fn list_by_session(
    conn: &Connection,
    session_id: &str,
) -> rusqlite::Result<Vec<GachaDrawRecord>> {
    let mut stmt = conn.prepare(LIST_BY_SESSION_SQL)?;
    let rows = stmt.query_map(rusqlite::params![session_id], |row| {
        Ok(GachaDrawRecord {
            id: row.get("id")?,
            viewer_id: row.get("viewer_id")?,
            viewer_name: row.get("viewer_name")?,
            gacha_name: row.get("gacha_name")?,
            // ⚠ NULL は `None` のまま返す（空文字へ潰さない＝「何も出なかった抽選」の唯一の表現）。
            prize_label: row.get("prize_label")?,
            rare: row.get("rare")?,
            drawn_at: row.get("drawn_at")?,
        })
    })?;
    rows.collect()
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

    // -----------------------------------------------------------------------
    // 063i: 一覧（read-only）
    // -----------------------------------------------------------------------

    /// 一覧テスト用の 1 行（`draw` はセッション・時刻が固定なので、こちらで作り分ける）。
    fn listed(id: &str, session_id: &str, drawn_at: &str) -> NewGachaDraw {
        NewGachaDraw {
            id: id.to_string(),
            session_id: session_id.to_string(),
            viewer_id: "twitch:1".to_string(),
            viewer_name: "アリス".to_string(),
            gacha_id: "g:1".to_string(),
            gacha_name: "朝ガチャ".to_string(),
            prize_label: Some("色紙".to_string()),
            rare: false,
            drawn_at: drawn_at.to_string(),
        }
    }

    /// ⚠ 新しい順（`drawn_at` の降順）で返ること。
    #[test]
    fn list_by_session_returns_the_newest_draw_first() {
        let conn = test_conn();
        insert(&conn, &listed("a", "s1", "2026-08-30T12:00:00Z"), "t").unwrap();
        insert(&conn, &listed("b", "s1", "2026-08-30T12:05:00Z"), "t").unwrap();
        insert(&conn, &listed("c", "s1", "2026-08-30T11:00:00Z"), "t").unwrap();

        let ids: Vec<String> = list_by_session(&conn, "s1")
            .unwrap()
            .into_iter()
            .map(|d| d.id)
            .collect();
        assert_eq!(ids, vec!["b", "a", "c"]);
    }

    /// ⚠⚠ **同じバッチ（＝`drawn_at` が同値）の同点崩しは記録 id の降順**である。
    ///
    /// ⚠⚠⚠ **これは「抽選順」ではない**（frontend は 1 バッチにつき時刻を 1 回だけ作って全件へ配る＝
    /// docs/security.md §9 追補〔063h〕§8 のレビュー Q-2）。ここが固定しているのは
    /// **並びが決定的であること**だけで、実際に引いた順とは無関係である。
    /// ⚠ 索引 `(session_id, drawn_at, id)` の 3 列目はこの同点崩しのために在る。
    ///
    /// ## ⚠⚠ 現状このテストで殺せない変異（正直に残す・2026-08-30 実測）
    ///
    /// **`ORDER BY` から `id DESC` だけを落とす**変異は**生存する**。索引が
    /// `(session_id, drawn_at, id)` なので、`drawn_at` だけで並べても**索引の走査順が
    /// たまたま id の降順になる**（[`the_list_query_is_covered_by_the_session_index`] も
    /// 索引の接頭辞で賄えるため落ちない）。⚠ **観測できないだけで保証は消えている**ので、
    /// `id DESC` は消さないこと。⚠ 殺せるのは**向きを変える**変異（`id ASC`）だけで、
    /// そちらはこのテストと索引テストの両方がレッドになる（実測）。
    ///
    /// ⚠⚠ **2026-08-31 追記（063i レビュー）: この受容は「合わせ技」で成り立っている。**
    /// `id DESC` を落とす変異が無害なのは**索引が 3 列だから**であって、
    /// その索引が変われば [`the_list_query_is_covered_by_the_session_index`] か
    /// このテストのどちらかが必ずレッドになる。⇒ ⚠ **`id DESC` は「索引が将来変わったとき」の
    /// 保険**として残す価値がある（単体では殺せないが、無意味ではない）。
    #[test]
    fn draws_from_the_same_batch_are_ordered_by_record_id_not_by_draw_order() {
        let conn = test_conn();
        insert(&conn, &listed("c1:g:1:0", "s1", "2026-08-30T12:00:00Z"), "t").unwrap();
        insert(&conn, &listed("c2:g:1:0", "s1", "2026-08-30T12:00:00Z"), "t").unwrap();

        let ids: Vec<String> = list_by_session(&conn, "s1")
            .unwrap()
            .into_iter()
            .map(|d| d.id)
            .collect();
        assert_eq!(ids, vec!["c2:g:1:0", "c1:g:1:0"]);
    }

    /// ⚠ 別の配信の行が混ざらないこと（引数はセッション id 1 つだけ＝§3）。
    #[test]
    fn list_by_session_does_not_mix_in_another_session() {
        let conn = test_conn();
        insert(&conn, &listed("a", "s1", "2026-08-30T12:00:00Z"), "t").unwrap();
        insert(&conn, &listed("b", "s2", "2026-08-30T12:01:00Z"), "t").unwrap();

        let rows = list_by_session(&conn, "s1").unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, "a");
    }

    /// ⚠ 記録より前の配信（＝行が 1 つも無いセッション）は**空**で返る（エラーにしない）。
    #[test]
    fn list_by_session_is_empty_for_a_session_without_draws() {
        let conn = test_conn();
        insert(&conn, &listed("a", "s1", "2026-08-30T12:00:00Z"), "t").unwrap();
        assert!(list_by_session(&conn, "old-session").unwrap().is_empty());
    }

    /// ⚠⚠⚠ **`prize_label` の NULL が `None` として返ること**（＝何も当たらなかった抽選）。
    ///
    /// ⚠ 空文字へ潰す実装に変えると、063i の画面が「何も出ない」と「名前が空の当たり」を
    /// 区別できなくなる。
    #[test]
    fn a_draw_that_won_nothing_comes_back_as_none() {
        let conn = test_conn();
        let mut miss = listed("a", "s1", "2026-08-30T12:00:00Z");
        miss.prize_label = None;
        insert(&conn, &miss, "t").unwrap();

        let rows = list_by_session(&conn, "s1").unwrap();
        assert_eq!(rows[0].prize_label, None);
    }

    /// 行が持つ値がそのまま返ること（⚠ `viewers` を JOIN しない＝**抽選時点の名前**が出る）。
    #[test]
    fn the_row_carries_the_name_captured_at_draw_time() {
        let conn = test_conn();
        let mut d = listed("a", "s1", "2026-08-30T12:00:00Z");
        d.viewer_name = "当時の名前".to_string();
        d.gacha_name = "夜ガチャ".to_string();
        d.rare = true;
        insert(&conn, &d, "t").unwrap();

        let rows = list_by_session(&conn, "s1").unwrap();
        assert_eq!(rows[0].viewer_id, "twitch:1");
        assert_eq!(rows[0].viewer_name, "当時の名前");
        assert_eq!(rows[0].gacha_name, "夜ガチャ");
        assert!(rows[0].rare);
        assert_eq!(rows[0].drawn_at, "2026-08-30T12:00:00Z");
    }

    /// ⚠⚠⚠ **一覧が実際に使う SQL（[`LIST_BY_SESSION_SQL`] そのもの）が索引で賄えること。**
    ///
    /// ⚠⚠ 上の [`the_session_index_covers_the_ordering_the_summary_uses`] は
    /// **テストの中に書き写したクエリ**を見ているので、**実装の定数を書き換えても落ちない**
    /// （063i の起票時に「あちらのテストは落ちないので気付けない」と警告されていた穴）。
    /// ⇒ こちらは定数を直接 EXPLAIN する。
    /// ⚠ `EXPLAIN QUERY PLAN` の前置は**テスト専用の連結**である（`[..].concat()`）。
    /// 本番の SQL は完全な文字列リテラルのままで、§8 の「組み立てない」は壊れていない。
    /// ⚠⚠ **`EXPLAIN QUERY PLAN` は複数行を返す**ので、`query_row` で先頭だけ読まないこと
    /// （063h で `USE TEMP B-TREE` の行を見落とし、索引を単一列へ戻す変異が生存した）。
    #[test]
    fn the_list_query_is_covered_by_the_session_index() {
        let conn = test_conn();
        let explain = ["EXPLAIN QUERY PLAN ", LIST_BY_SESSION_SQL].concat();
        let mut stmt = conn.prepare(&explain).unwrap();
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
            "並び替えのために一時 B-Tree が作られている（索引が賄えていない）: {plan}"
        );
    }
}
