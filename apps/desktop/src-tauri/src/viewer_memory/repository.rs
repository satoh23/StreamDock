//! 038a: 視聴者メモリの SQL 層（`viewers` / `viewer_comments`）。
//!
//! 保存は端末内 SQLite のみ。識別子（テーブル名・ORDER BY 句）は**コンパイル時定数のみ**を使い、
//! 値は必ずパラメータバインドする（docs/security.md §8）。集計は挿入行から再計算するため冪等。

use rusqlite::{Connection, OptionalExtension};

use super::model::{NewViewerComment, ViewerCommentRecord, ViewerRecord, ViewerSort};

/// SELECT で取得する viewers テーブルの全カラム（複数クエリで共有）。
const VIEWER_COLUMNS: &str = "id, provider, provider_user_id, name, first_seen_at, last_comment_at, \
    total_comments, bits_count, bits_amount, superchat_count, superchat_amount, superchat_currency, \
    subscription_count, is_member, last_subscription_at, note, created_at, updated_at";

/// SELECT で取得する viewer_comments テーブルの全カラム。
const VIEWER_COMMENT_COLUMNS: &str =
    "id, viewer_id, session_id, source, text, event_type, amount, currency, monetary_amount, \
    published_at, created_at";

/// viewers / viewer_comments テーブルを作成する（存在すれば何もしない）。
pub fn init(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS viewers (
            id                  TEXT PRIMARY KEY,
            provider            TEXT NOT NULL,
            provider_user_id    TEXT NOT NULL,
            name                TEXT NOT NULL,
            first_seen_at       TEXT NOT NULL,
            last_comment_at     TEXT NOT NULL,
            total_comments      INTEGER NOT NULL DEFAULT 0,
            bits_count          INTEGER NOT NULL DEFAULT 0,
            bits_amount         INTEGER NOT NULL DEFAULT 0,
            superchat_count     INTEGER NOT NULL DEFAULT 0,
            superchat_amount    REAL NOT NULL DEFAULT 0,
            superchat_currency  TEXT,
            subscription_count  INTEGER NOT NULL DEFAULT 0,
            is_member           INTEGER NOT NULL DEFAULT 0,
            last_subscription_at TEXT,
            note                TEXT NOT NULL DEFAULT '',
            created_at          TEXT NOT NULL,
            updated_at          TEXT NOT NULL
        );",
    )?;
    // viewer_comments.viewer_id は viewers への FK。視聴者削除で当該コメントも消えるよう CASCADE。
    // 外部キー強制は接続ごとの `PRAGMA foreign_keys = ON`（lib.rs setup）で有効化済み。
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS viewer_comments (
            id              TEXT PRIMARY KEY,
            viewer_id       TEXT NOT NULL REFERENCES viewers(id) ON DELETE CASCADE,
            session_id      TEXT NOT NULL,
            source          TEXT NOT NULL,
            text            TEXT NOT NULL,
            event_type      TEXT NOT NULL,
            amount          REAL,
            currency        TEXT,
            monetary_amount TEXT,
            published_at    TEXT NOT NULL,
            created_at      TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_viewer_comments_viewer ON viewer_comments(viewer_id);
        CREATE INDEX IF NOT EXISTS idx_viewer_comments_session ON viewer_comments(session_id);",
    )?;
    Ok(())
}

fn row_to_viewer(row: &rusqlite::Row<'_>) -> rusqlite::Result<ViewerRecord> {
    Ok(ViewerRecord {
        id: row.get("id")?,
        provider: row.get("provider")?,
        provider_user_id: row.get("provider_user_id")?,
        name: row.get("name")?,
        first_seen_at: row.get("first_seen_at")?,
        last_comment_at: row.get("last_comment_at")?,
        total_comments: row.get("total_comments")?,
        bits_count: row.get("bits_count")?,
        bits_amount: row.get("bits_amount")?,
        superchat_count: row.get("superchat_count")?,
        superchat_amount: row.get("superchat_amount")?,
        superchat_currency: row.get("superchat_currency")?,
        subscription_count: row.get("subscription_count")?,
        is_member: row.get("is_member")?,
        last_subscription_at: row.get("last_subscription_at")?,
        note: row.get("note")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn row_to_comment(row: &rusqlite::Row<'_>) -> rusqlite::Result<ViewerCommentRecord> {
    Ok(ViewerCommentRecord {
        id: row.get("id")?,
        viewer_id: row.get("viewer_id")?,
        session_id: row.get("session_id")?,
        source: row.get("source")?,
        text: row.get("text")?,
        event_type: row.get("event_type")?,
        amount: row.get("amount")?,
        currency: row.get("currency")?,
        monetary_amount: row.get("monetary_amount")?,
        published_at: row.get("published_at")?,
        created_at: row.get("created_at")?,
    })
}

/// コメントを 1 件記録し、視聴者を upsert して集計を再計算する。
///
/// 冪等: `viewer_comments.id`（＝コメント id）が既存なら `INSERT OR IGNORE` が 0 行となり、集計を再計算せず
/// `false` を返す（同一コメントの二重記録で集計が重複しない）。集計は `viewer_comments` から毎回再計算する
/// ため増分ドリフトが起きない。upsert＋挿入＋再計算は 1 トランザクション。
///
/// 挿入順は **親（viewers）→ 子（viewer_comments）** の順。`viewer_comments.viewer_id` は `viewers(id)` への
/// FK（`foreign_keys = ON`・非 DEFERRABLE）で、親行が無い状態で子を挿入すると即 FK 制約違反になり、新規視聴者の
/// 初回コメントが必ず失敗して機能が成立しない。子先行だった実装バグを親先行へ修正済み（DDL/移行不要な純コード修正）。
pub fn record_comment(conn: &Connection, c: &NewViewerComment) -> rusqlite::Result<bool> {
    let now = crate::util::now_rfc3339();
    // DbState の Mutex を保持した状態で `&Connection` から張れる unchecked_transaction を使う
    //（本モジュールの全 command は単一 Mutex<Connection> で直列化されるため安全）。
    let tx = conn.unchecked_transaction()?;

    // 1) 親: 視聴者行を先に存在させ名前を最新化する（FK 制約のため子より前）。集計は step3 で確定するので
    //    first/last は仮値。first_seen_at / note / created_at は既存行では上書きしない。
    tx.execute(
        "INSERT INTO viewers
            (id, provider, provider_user_id, name, first_seen_at, last_comment_at, note, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5, '', ?6, ?6)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at",
        rusqlite::params![
            c.viewer_id,
            c.provider,
            c.provider_user_id,
            c.name,
            c.published_at,
            now,
        ],
    )?;

    // 2) 子: コメントを冪等挿入。既存 id なら 0 行 → 集計を触らず終了（重複時は視聴者の name/updated_at
    //    更新のみ残るが、集計は既存値のまま正しい）。親を先に作ってあるので FK 違反にはならない。
    let inserted = tx.execute(
        "INSERT OR IGNORE INTO viewer_comments
            (id, viewer_id, session_id, source, text, event_type, amount, currency, monetary_amount, published_at, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        rusqlite::params![
            c.comment_id,
            c.viewer_id,
            c.session_id,
            c.source,
            c.text,
            c.event_type,
            c.amount,
            c.currency,
            c.monetary_amount,
            c.published_at,
            now,
        ],
    )?;
    if inserted == 0 {
        tx.commit()?;
        return Ok(false);
    }

    // 3) 集計を viewer_comments から再計算（bits は currency='BITS'・スパチャは実通貨のみ）。
    //    【設計意図】増分加算ではなく挿入行から毎回全再計算（recompute-on-write）＝二重記録・順序前後でも
    //      集計がドリフトしない冪等性を優先。走査は当該 viewer 限定で idx_viewer_comments_viewer が効く。
    //      【再修正トリガ】常連の 1 セッション数千コメントで挿入が重くなったら増分更新/しきい値化を検討（Q3）。
    //    【近似】membership は wire が subscription に畳むため CommentEventType::Membership は未到達。
    //      subscription_count/is_member は event_type='subscription' のみで数える（累計月数は非取得＝vendor 非改修）。
    //      【再修正トリガ】累計月数や membership を厳密に扱う要件が出たら vendor 拡張とスキーマ追加を検討（Q7）。
    //    【前提】first/last は published_at の辞書順比較（全 provider が UTC・同形 ISO8601 を送る前提）。
    //      【再修正トリガ】provider 間で TZ/フォーマットがぶれて first/last がずれるなら正規化して比較する（Q5・038c 波及）。
    tx.execute(
        "UPDATE viewers SET
            total_comments = (SELECT COUNT(*) FROM viewer_comments WHERE viewer_id = ?1),
            bits_count = (SELECT COUNT(*) FROM viewer_comments WHERE viewer_id = ?1 AND currency = 'BITS'),
            bits_amount = (SELECT CAST(COALESCE(SUM(amount), 0) AS INTEGER) FROM viewer_comments WHERE viewer_id = ?1 AND currency = 'BITS'),
            superchat_count = (SELECT COUNT(*) FROM viewer_comments WHERE viewer_id = ?1 AND event_type = 'superchat' AND currency IS NOT NULL AND currency <> 'BITS'),
            superchat_amount = (SELECT COALESCE(SUM(amount), 0) FROM viewer_comments WHERE viewer_id = ?1 AND event_type = 'superchat' AND currency IS NOT NULL AND currency <> 'BITS'),
            superchat_currency = (SELECT currency FROM viewer_comments WHERE viewer_id = ?1 AND event_type = 'superchat' AND currency IS NOT NULL AND currency <> 'BITS' ORDER BY published_at DESC, created_at DESC LIMIT 1),
            subscription_count = (SELECT COUNT(*) FROM viewer_comments WHERE viewer_id = ?1 AND event_type = 'subscription'),
            is_member = (SELECT CASE WHEN EXISTS(SELECT 1 FROM viewer_comments WHERE viewer_id = ?1 AND event_type = 'subscription') THEN 1 ELSE 0 END),
            last_subscription_at = (SELECT MAX(published_at) FROM viewer_comments WHERE viewer_id = ?1 AND event_type = 'subscription'),
            first_seen_at = (SELECT MIN(published_at) FROM viewer_comments WHERE viewer_id = ?1),
            last_comment_at = (SELECT MAX(published_at) FROM viewer_comments WHERE viewer_id = ?1),
            updated_at = ?2
         WHERE id = ?1",
        rusqlite::params![c.viewer_id, now],
    )?;

    tx.commit()?;
    Ok(true)
}

/// ViewerSort → ORDER BY 句（定数のみ・ユーザー入力は含めない）。
fn order_by(sort: ViewerSort) -> &'static str {
    match sort {
        ViewerSort::LastComment => " ORDER BY last_comment_at DESC",
        ViewerSort::TotalComments => " ORDER BY total_comments DESC, last_comment_at DESC",
        ViewerSort::Name => " ORDER BY name COLLATE NOCASE ASC",
    }
}

/// 視聴者一覧を返す。`search` があれば name の部分一致で絞り込む（値はバインド）。
pub fn list(
    conn: &Connection,
    search: Option<&str>,
    sort: ViewerSort,
) -> rusqlite::Result<Vec<ViewerRecord>> {
    let order = order_by(sort);
    match search {
        Some(s) => {
            // 検索語 s はバインド（SQL インジェクション無し）。% / _ は LIKE ワイルドカードとして働くが
            // MVP では許容（ESCAPE 未指定）。記号込みの厳密一致要件が出たら ESCAPE を足す（Q7）。
            let sql = format!(
                "SELECT {VIEWER_COLUMNS} FROM viewers WHERE name LIKE '%' || ?1 || '%'{order}"
            );
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt.query_map(rusqlite::params![s], row_to_viewer)?;
            rows.collect()
        }
        None => {
            let sql = format!("SELECT {VIEWER_COLUMNS} FROM viewers{order}");
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt.query_map([], row_to_viewer)?;
            rows.collect()
        }
    }
}

pub fn get(conn: &Connection, id: &str) -> rusqlite::Result<Option<ViewerRecord>> {
    conn.query_row(
        &format!("SELECT {VIEWER_COLUMNS} FROM viewers WHERE id = ?1"),
        rusqlite::params![id],
        row_to_viewer,
    )
    .optional()
}

/// ある視聴者の過去コメントを新しい順で返す。
pub fn list_comments(
    conn: &Connection,
    viewer_id: &str,
) -> rusqlite::Result<Vec<ViewerCommentRecord>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {VIEWER_COMMENT_COLUMNS} FROM viewer_comments WHERE viewer_id = ?1 \
         ORDER BY published_at DESC, created_at DESC"
    ))?;
    let rows = stmt.query_map(rusqlite::params![viewer_id], row_to_comment)?;
    rows.collect()
}

/// 配信者メモを更新する。更新した行数を返す（0＝対象なし）。
pub fn update_note(
    conn: &Connection,
    id: &str,
    note: &str,
    now: &str,
) -> rusqlite::Result<usize> {
    let affected = conn.execute(
        "UPDATE viewers SET note = ?2, updated_at = ?3 WHERE id = ?1",
        rusqlite::params![id, note, now],
    )?;
    Ok(affected)
}

/// 視聴者を削除する（FK CASCADE で当該コメントも削除）。削除した行数を返す。
pub fn delete(conn: &Connection, id: &str) -> rusqlite::Result<usize> {
    let affected = conn.execute("DELETE FROM viewers WHERE id = ?1", rusqlite::params![id])?;
    Ok(affected)
}

/// 全視聴者を削除する（FK CASCADE で viewer_comments も全消去）。
pub fn clear(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM viewers", [])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::viewer_memory::model::{NewViewerComment, ViewerSort};
    use rusqlite::Connection;

    /// テスト用の in-memory 接続。**本番と同じく `foreign_keys = ON` を必ず有効化する**
    /// （これが無いと親先行→子挿入の FK 制約を検証できず、子先行バグの回帰テストが素通りする）。
    fn test_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute("PRAGMA foreign_keys = ON", []).unwrap();
        init(&conn).unwrap();
        conn
    }

    /// 検証済み内部入力 `NewViewerComment` の最小ビルダ（provider/source は twitch 既定）。
    fn nc(
        comment_id: &str,
        viewer_id: &str,
        event_type: &str,
        amount: Option<f64>,
        currency: Option<&str>,
        published_at: &str,
    ) -> NewViewerComment {
        NewViewerComment {
            comment_id: comment_id.to_string(),
            viewer_id: viewer_id.to_string(),
            session_id: "sess-1".to_string(),
            provider: "twitch".to_string(),
            provider_user_id: "u1".to_string(),
            name: "Alice".to_string(),
            source: "twitch".to_string(),
            text: "hi".to_string(),
            event_type: event_type.to_string(),
            amount,
            currency: currency.map(|s| s.to_string()),
            monetary_amount: None,
            published_at: published_at.to_string(),
        }
    }

    fn count_comments(conn: &Connection, viewer_id: &str) -> i64 {
        conn.query_row(
            "SELECT COUNT(*) FROM viewer_comments WHERE viewer_id = ?1",
            rusqlite::params![viewer_id],
            |r| r.get(0),
        )
        .unwrap()
    }

    fn viewer(conn: &Connection, id: &str) -> ViewerRecord {
        get(conn, id).unwrap().expect("viewer should exist")
    }

    // P1: 新規視聴者の初回コメントが記録される（親先行→子挿入。子先行だと FK 違反で失敗＝回帰検出）。
    #[test]
    fn records_new_viewer_first_comment() {
        let conn = test_conn();
        let inserted = record_comment(&conn, &nc("c1", "twitch:u1", "chat", None, None, "2026-01-01T00:00:00Z")).unwrap();
        assert!(inserted, "first insert should report true");
        let v = viewer(&conn, "twitch:u1");
        assert_eq!(v.total_comments, 1);
        assert_eq!(count_comments(&conn, "twitch:u1"), 1);
    }

    // P2: 同一 comment.id の二重記録は 0 行（false）で集計も重複しない。
    #[test]
    fn duplicate_comment_id_is_idempotent() {
        let conn = test_conn();
        assert!(record_comment(&conn, &nc("c1", "twitch:u1", "chat", None, None, "2026-01-01T00:00:00Z")).unwrap());
        assert!(!record_comment(&conn, &nc("c1", "twitch:u1", "chat", None, None, "2026-01-01T00:00:00Z")).unwrap());
        assert_eq!(viewer(&conn, "twitch:u1").total_comments, 1);
        assert_eq!(count_comments(&conn, "twitch:u1"), 1);
    }

    // P3a/b/c: bits（currency='BITS'）とスパチャ（実通貨）を切り分け、混在通貨は近似合算・通貨は最新を採る。
    #[test]
    fn aggregates_bits_and_superchat_separately() {
        let conn = test_conn();
        record_comment(&conn, &nc("c1", "twitch:u1", "superchat", Some(100.0), Some("BITS"), "2026-01-01T00:00:01Z")).unwrap();
        record_comment(&conn, &nc("c2", "twitch:u1", "superchat", Some(500.0), Some("JPY"), "2026-01-01T00:00:02Z")).unwrap();
        record_comment(&conn, &nc("c3", "twitch:u1", "superchat", Some(3.0), Some("USD"), "2026-01-01T00:00:03Z")).unwrap();
        record_comment(&conn, &nc("c4", "twitch:u1", "chat", None, None, "2026-01-01T00:00:04Z")).unwrap();
        let v = viewer(&conn, "twitch:u1");
        assert_eq!(v.total_comments, 4);
        assert_eq!(v.bits_count, 1);
        assert_eq!(v.bits_amount, 100);
        assert_eq!(v.superchat_count, 2); // JPY + USD（BITS は除外）
        assert_eq!(v.superchat_amount, 503.0); // 混在通貨の近似合算
        assert_eq!(v.superchat_currency.as_deref(), Some("USD")); // published_at 最新
    }

    // P3d: subscription で subscription_count/is_member/last_subscription_at が立つ。
    #[test]
    fn aggregates_subscription_and_membership_flag() {
        let conn = test_conn();
        record_comment(&conn, &nc("c1", "twitch:u1", "chat", None, None, "2026-01-01T00:00:00Z")).unwrap();
        let v = viewer(&conn, "twitch:u1");
        assert_eq!(v.subscription_count, 0);
        assert!(!v.is_member);
        record_comment(&conn, &nc("c2", "twitch:u1", "subscription", None, None, "2026-01-02T00:00:00Z")).unwrap();
        let v = viewer(&conn, "twitch:u1");
        assert_eq!(v.subscription_count, 1);
        assert!(v.is_member);
        assert_eq!(v.last_subscription_at.as_deref(), Some("2026-01-02T00:00:00Z"));
    }

    // P3e: first/last は published_at の MIN/MAX（順不同で挿入しても正しい）。
    #[test]
    fn first_and_last_track_min_max_published_at() {
        let conn = test_conn();
        record_comment(&conn, &nc("c2", "twitch:u1", "chat", None, None, "2026-01-02T00:00:00Z")).unwrap();
        record_comment(&conn, &nc("c1", "twitch:u1", "chat", None, None, "2026-01-01T00:00:00Z")).unwrap();
        record_comment(&conn, &nc("c3", "twitch:u1", "chat", None, None, "2026-01-03T00:00:00Z")).unwrap();
        let v = viewer(&conn, "twitch:u1");
        assert_eq!(v.first_seen_at, "2026-01-01T00:00:00Z");
        assert_eq!(v.last_comment_at, "2026-01-03T00:00:00Z");
    }

    // P4b: currency=NULL のスパチャ種別は superchat/bits どちらにも数えない（`currency IS NOT NULL` 条件）。
    #[test]
    fn null_currency_is_not_counted() {
        let conn = test_conn();
        record_comment(&conn, &nc("c1", "twitch:u1", "superchat", Some(5.0), None, "2026-01-01T00:00:00Z")).unwrap();
        let v = viewer(&conn, "twitch:u1");
        assert_eq!(v.superchat_count, 0);
        assert_eq!(v.superchat_amount, 0.0);
        assert_eq!(v.bits_count, 0);
        assert_eq!(v.total_comments, 1);
    }

    // P5: 再コメントで name は最新化するが first_seen_at / note は保持する。
    #[test]
    fn upsert_updates_name_but_preserves_first_seen_and_note() {
        let conn = test_conn();
        record_comment(&conn, &nc("c1", "twitch:u1", "chat", None, None, "2026-01-01T00:00:00Z")).unwrap();
        update_note(&conn, "twitch:u1", "VIP", "2026-01-01T00:00:00Z").unwrap();
        let mut later = nc("c2", "twitch:u1", "chat", None, None, "2026-01-05T00:00:00Z");
        later.name = "Alice2".to_string();
        record_comment(&conn, &later).unwrap();
        let v = viewer(&conn, "twitch:u1");
        assert_eq!(v.name, "Alice2");
        assert_eq!(v.note, "VIP");
        assert_eq!(v.first_seen_at, "2026-01-01T00:00:00Z");
        assert_eq!(v.total_comments, 2);
    }

    // P6a: delete で当該コメントも FK CASCADE で消える。
    #[test]
    fn delete_viewer_cascades_comments() {
        let conn = test_conn();
        record_comment(&conn, &nc("c1", "twitch:u1", "chat", None, None, "2026-01-01T00:00:00Z")).unwrap();
        record_comment(&conn, &nc("c2", "twitch:u1", "chat", None, None, "2026-01-02T00:00:00Z")).unwrap();
        assert_eq!(count_comments(&conn, "twitch:u1"), 2);
        assert_eq!(delete(&conn, "twitch:u1").unwrap(), 1);
        assert!(get(&conn, "twitch:u1").unwrap().is_none());
        assert_eq!(count_comments(&conn, "twitch:u1"), 0);
    }

    // P6b: clear で全視聴者・全コメントが消える。
    #[test]
    fn clear_removes_all_viewers_and_comments() {
        let conn = test_conn();
        record_comment(&conn, &nc("c1", "twitch:u1", "chat", None, None, "2026-01-01T00:00:00Z")).unwrap();
        let mut other = nc("c2", "youtube:u2", "chat", None, None, "2026-01-02T00:00:00Z");
        other.provider_user_id = "u2".to_string();
        record_comment(&conn, &other).unwrap();
        clear(&conn).unwrap();
        assert!(list(&conn, None, ViewerSort::LastComment).unwrap().is_empty());
        let total: i64 = conn.query_row("SELECT COUNT(*) FROM viewer_comments", [], |r| r.get(0)).unwrap();
        assert_eq!(total, 0);
    }

    // P8a/b: search は name 部分一致（大小無視）、sort は指定順。
    #[test]
    fn list_search_and_sort() {
        let conn = test_conn();
        let mut a = nc("c1", "twitch:u1", "chat", None, None, "2026-01-01T00:00:00Z");
        a.name = "Alice".to_string();
        let mut b = nc("c2", "twitch:u2", "chat", None, None, "2026-01-03T00:00:00Z");
        b.name = "Bob".to_string();
        b.provider_user_id = "u2".to_string();
        record_comment(&conn, &a).unwrap();
        record_comment(&conn, &b).unwrap();

        let hits = list(&conn, Some("ali"), ViewerSort::Name).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].name, "Alice");

        let all = list(&conn, None, ViewerSort::LastComment).unwrap();
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].id, "twitch:u2"); // last_comment_at の新しい方が先頭
    }

    // P8d(repo): 不在 id は None（service で not_found に変換される）。
    #[test]
    fn get_absent_returns_none() {
        let conn = test_conn();
        assert!(get(&conn, "nope").unwrap().is_none());
    }
}
