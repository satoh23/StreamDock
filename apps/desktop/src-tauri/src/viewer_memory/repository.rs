//! 038a: 視聴者メモリの SQL 層（`viewers` / `viewer_comments`）。
//!
//! 保存は端末内 SQLite のみ。識別子（テーブル名・ORDER BY 句）は**コンパイル時定数のみ**を使い、
//! 値は必ずパラメータバインドする（docs/security.md §8）。集計は挿入行から再計算するため冪等。

use chrono::{DateTime, Months};
use rusqlite::{Connection, OptionalExtension};

use super::model::{NewViewerComment, RecordResult, ViewerCommentRecord, ViewerRecord, ViewerSort};

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

/// コメントを 1 件記録し、視聴者を upsert して集計を再計算する。戻り値は 038c の判定（初見／久しぶり）。
///
/// 冪等: `viewer_comments.id`（＝コメント id）が既存なら `INSERT OR IGNORE` が 0 行となり、集計を再計算せず
/// `RecordResult{false,false}` を返す（同一コメントの二重記録で集計も判定も重複しない）。集計は
/// `viewer_comments` から毎回再計算するため増分ドリフトが起きない。upsert＋挿入＋再計算は 1 トランザクション。
///
/// 挿入順は **親（viewers）→ 子（viewer_comments）** の順。`viewer_comments.viewer_id` は `viewers(id)` への
/// FK（`foreign_keys = ON`・非 DEFERRABLE）で、親行が無い状態で子を挿入すると即 FK 制約違反になり、新規視聴者の
/// 初回コメントが必ず失敗して機能が成立しない。子先行だった実装バグを親先行へ修正済み（DDL/移行不要な純コード修正）。
///
/// 038c 判定（初見／久しぶり）は **upsert 前の viewer 状態から算出し、実挿入（inserted==1）のときだけ返す**:
///   - 記録前に viewer 行が無い（`prior_last` が None）＝**初見**（`first_time`）。
///   - 記録があり `今回 published_at >= 直前 last_comment_at + 1 ヶ月`＝**久しぶり**（`long_absence`）。初見が優先。
/// **冪等性**: 全 command は単一 `Mutex<Connection>` で直列化されるため、同一 id の複数呼び出しは 1 つだけが実挿入
/// となり判定を返す。重複（inserted==0）は `{false,false}` に落として二重にバッジを立てない（判定を挿入時の状態で確定）。
pub fn record_comment(conn: &Connection, c: &NewViewerComment) -> rusqlite::Result<RecordResult> {
    let now = crate::util::now_rfc3339();
    // DbState の Mutex を保持した状態で `&Connection` から張れる unchecked_transaction を使う
    //（本モジュールの全 command は単一 Mutex<Connection> で直列化されるため安全）。
    let tx = conn.unchecked_transaction()?;

    // 0) 038c 判定は upsert（step1）より前の状態で確定する。step1 で viewer 行が作られ step3 で last_comment_at が
    //    今回 published_at に更新されるため、必ずこの時点で直前 last_comment_at を読む。
    let prior_last: Option<String> = tx
        .query_row(
            "SELECT last_comment_at FROM viewers WHERE id = ?1",
            rusqlite::params![c.viewer_id],
            |row| row.get(0),
        )
        .optional()?;
    let first_time = prior_last.is_none();
    // apply-review(品質Q3・修正不要): 判定基準は wall-clock `now` ではなく今回コメントの `published_at`。集計の
    // first/last=MIN/MAX(published_at) と基準が揃い（＝2 コメント時刻の差で「久しぶり」を測る本来の定義）、Rust
    // テストが決定的になり、ライブでは published_at≈now のため実害が無い。留意点として判定は記録（到着）順に依存する
    // （prior_last は直前に記録済みの last_comment_at）が、本機能はライブ WS 受信を fire-and-forget 記録するため
    // 到着順≈published 順。再修正トリガー: 履歴一括受信等で published_at が逆順に届き誤判定が実問題化したら、記録前に
    // published_at 順の整列や max(prior_last, published_at) 基準を検討する。
    let long_absence = match &prior_last {
        Some(last) => is_long_absence(last, &c.published_at),
        None => false, // 初見（記録なし）は久しぶりを付けない（初見が優先）。
    };

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
        // 重複記録: 集計を触らず、判定も肯定を返さない（二重にバッジを立てない・冪等）。
        return Ok(RecordResult { first_time: false, long_absence: false });
    }

    // 3) 集計を viewer_comments から再計算（bits は currency='BITS'・スパチャは実通貨のみ）。
    //    【設計意図】増分加算ではなく挿入行から毎回全再計算（recompute-on-write）＝二重記録・順序前後でも
    //      集計がドリフトしない冪等性を優先。走査は当該 viewer 限定で idx_viewer_comments_viewer が効く。
    //      【再修正トリガ】常連の 1 セッション数千コメントで挿入が重くなったら増分更新/しきい値化を検討（Q3）。
    //    【043a】メンシプ（YouTube NEW_SPONSOR/MEMBER_MILESTONE→'membership'）・ギフト（Twitch
    //      sub_gift/community_sub_gift→'gift'）を種別分離して受け取るようになった。分離前は全て 'subscription'
    //      に畳まれていたため、subscription_count/is_member/last_subscription_at は
    //      event_type IN ('subscription','membership','gift') で数えて**分離前と同じ集合**を保つ
    //      （＝取りこぼしゼロ・退行ゼロ・列追加なし）。累計月数/ギフト件数（wire の monthCount/giftCount）は
    //      表示用途で通すのみで**端末保存しない**近似（is_member＋回数のみ）。
    //      【再修正トリガ】membership/gift を別カウントで持ちたい要件が出たら列追加＋038 表示波及を検討（Q7）。
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
            subscription_count = (SELECT COUNT(*) FROM viewer_comments WHERE viewer_id = ?1 AND event_type IN ('subscription', 'membership', 'gift')),
            is_member = (SELECT CASE WHEN EXISTS(SELECT 1 FROM viewer_comments WHERE viewer_id = ?1 AND event_type IN ('subscription', 'membership', 'gift')) THEN 1 ELSE 0 END),
            last_subscription_at = (SELECT MAX(published_at) FROM viewer_comments WHERE viewer_id = ?1 AND event_type IN ('subscription', 'membership', 'gift')),
            first_seen_at = (SELECT MIN(published_at) FROM viewer_comments WHERE viewer_id = ?1),
            last_comment_at = (SELECT MAX(published_at) FROM viewer_comments WHERE viewer_id = ?1),
            updated_at = ?2
         WHERE id = ?1",
        rusqlite::params![c.viewer_id, now],
    )?;

    tx.commit()?;
    // ここに来るのは実挿入（inserted==1）＝この id の初回記録のみ。upsert 前の状態で確定した判定を返す。
    Ok(RecordResult { first_time, long_absence })
}

/// 直前の最終コメント `prev` から今回コメント `cur` までが 1 ヶ月以上空いたか（＝久しぶり）。
///
/// 既存依存の `chrono` で RFC3339 をパースし、`prev + 1 ヶ月 <= cur` を判定する（新規依存なし）。月末は
/// `checked_add_months` がクランプ（例: 1/31 + 1 ヶ月 → 2/28）。いずれかがパース不能なら **false**（久しぶりを
/// 付けない安全側）。両端とも同形 ISO8601（UTC 前提）で来る想定は集計の first/last と同じ（repository の前提）。
fn is_long_absence(prev: &str, cur: &str) -> bool {
    let (Ok(prev_dt), Ok(cur_dt)) = (
        DateTime::parse_from_rfc3339(prev),
        DateTime::parse_from_rfc3339(cur),
    ) else {
        return false;
    };
    match prev_dt.checked_add_months(Months::new(1)) {
        Some(threshold) => cur_dt >= threshold,
        None => false,
    }
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
    //     初回挿入は 038c 判定で初見（first_time）を返す。
    #[test]
    fn records_new_viewer_first_comment() {
        let conn = test_conn();
        let r = record_comment(&conn, &nc("c1", "twitch:u1", "chat", None, None, "2026-01-01T00:00:00Z")).unwrap();
        assert!(r.first_time, "first insert should be flagged 初見");
        assert!(!r.long_absence);
        let v = viewer(&conn, "twitch:u1");
        assert_eq!(v.total_comments, 1);
        assert_eq!(count_comments(&conn, "twitch:u1"), 1);
    }

    // P2: 同一 comment.id の二重記録は 0 行で集計も重複せず、判定も肯定を返さない（バッジがブレない）。
    #[test]
    fn duplicate_comment_id_is_idempotent() {
        let conn = test_conn();
        assert!(record_comment(&conn, &nc("c1", "twitch:u1", "chat", None, None, "2026-01-01T00:00:00Z")).unwrap().first_time);
        let dup = record_comment(&conn, &nc("c1", "twitch:u1", "chat", None, None, "2026-01-01T00:00:00Z")).unwrap();
        assert!(!dup.first_time, "duplicate must not re-flag 初見");
        assert!(!dup.long_absence);
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

    // 043a: membership（YouTube）/ gift（Twitch）も subscription 系集計に取りこぼさず数える。
    //       分離前は sub_gift/community_sub_gift/NEW_SPONSOR/MILESTONE が全て 'subscription' に畳まれ
    //       ここに入っていたため、統合カウントで挙動を維持する（＝退行ゼロ・取りこぼしゼロ）。
    //       superchat/bits/chat は subscription 系に混ざらない（退行検出）。
    #[test]
    fn membership_and_gift_count_into_subscription_family() {
        let conn = test_conn();
        record_comment(&conn, &nc("c1", "twitch:u1", "membership", None, None, "2026-01-01T00:00:00Z")).unwrap();
        record_comment(&conn, &nc("c2", "twitch:u1", "gift", None, None, "2026-01-03T00:00:00Z")).unwrap();
        record_comment(&conn, &nc("c3", "twitch:u1", "subscription", None, None, "2026-01-02T00:00:00Z")).unwrap();
        record_comment(&conn, &nc("c4", "twitch:u1", "chat", None, None, "2026-01-04T00:00:00Z")).unwrap();
        record_comment(&conn, &nc("c5", "twitch:u1", "superchat", Some(500.0), Some("JPY"), "2026-01-05T00:00:00Z")).unwrap();
        let v = viewer(&conn, "twitch:u1");
        assert_eq!(v.subscription_count, 3); // membership + gift + subscription
        assert!(v.is_member);
        assert_eq!(v.last_subscription_at.as_deref(), Some("2026-01-03T00:00:00Z")); // gift が最新
        assert_eq!(v.superchat_count, 1); // superchat は不変（混ざらない）
        assert_eq!(v.total_comments, 5);
    }

    // 043a(拡張): donation（Twitch charity_donation）は subscription 系にも superchat/bits 系にも入れない
    //       新種別（列追加なし・rollup しない）。金額は行に保存されるが集計 rollup 列は作らない（§9/⑪）。
    //       total_comments には数える（＝取りこぼしゼロ）。superchat/subscription 集計に混ざらないことを検出する。
    #[test]
    fn donation_is_not_counted_in_subscription_or_superchat() {
        let conn = test_conn();
        // charity_donation は実金銭（currency 付き）だが event_type='donation' なので superchat 集計に入らない。
        record_comment(&conn, &nc("c1", "twitch:u1", "donation", Some(500.0), Some("JPY"), "2026-01-01T00:00:00Z")).unwrap();
        record_comment(&conn, &nc("c2", "twitch:u1", "subscription", None, None, "2026-01-02T00:00:00Z")).unwrap();
        record_comment(&conn, &nc("c3", "twitch:u1", "superchat", Some(300.0), Some("JPY"), "2026-01-03T00:00:00Z")).unwrap();
        let v = viewer(&conn, "twitch:u1");
        assert_eq!(v.subscription_count, 1); // subscription のみ（donation は入らない）
        assert_eq!(v.superchat_count, 1); // superchat のみ（donation は入らない）
        assert_eq!(v.superchat_amount, 300.0); // donation の 500 は superchat 合計に混ざらない
        assert_eq!(v.total_comments, 3); // donation も総数には数える（取りこぼしゼロ）
    }

    // 043a(拡張): jewels（YouTube Jewels・取得は 043d／現状 dev-mock のみ）も新種別として既存集計に混ざらない。
    //       通貨 'JEWELS' は bits('BITS')/superchat(実通貨) いずれの集計条件にも一致しない。total には数える。
    #[test]
    fn jewels_is_not_counted_in_existing_aggregations() {
        let conn = test_conn();
        record_comment(&conn, &nc("c1", "youtube:u1", "jewels", Some(50.0), Some("JEWELS"), "2026-01-01T00:00:00Z")).unwrap();
        record_comment(&conn, &nc("c2", "youtube:u1", "superchat", Some(300.0), Some("JPY"), "2026-01-02T00:00:00Z")).unwrap();
        record_comment(&conn, &nc("c3", "youtube:u1", "superchat", Some(100.0), Some("BITS"), "2026-01-03T00:00:00Z")).unwrap();
        let v = viewer(&conn, "youtube:u1");
        assert_eq!(v.bits_count, 1); // BITS superchat のみ（JEWELS は bits に入らない）
        assert_eq!(v.superchat_count, 1); // JPY superchat のみ（jewels は入らない）
        assert_eq!(v.subscription_count, 0); // jewels は subscription 系にも入らない
        assert_eq!(v.total_comments, 3); // jewels も総数には数える
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

    // ---- 038c: 初見／久しぶり判定（保存直前の last_comment_at 基準・初回のみ・冪等）----

    // 038c-P2: 最終コメントから 1 ヶ月以上後の最初のコメントは久しぶり（初見ではない）。
    #[test]
    fn judges_long_absence_after_month_gap() {
        let conn = test_conn();
        record_comment(&conn, &nc("c1", "twitch:u1", "chat", None, None, "2026-01-01T00:00:00Z")).unwrap();
        let r = record_comment(&conn, &nc("c2", "twitch:u1", "chat", None, None, "2026-03-05T00:00:00Z")).unwrap();
        assert!(!r.first_time);
        assert!(r.long_absence);
    }

    // 038c-P3: 1 ヶ月未満の再コメントはバッジ無し（常連）。
    #[test]
    fn judges_regular_within_month() {
        let conn = test_conn();
        record_comment(&conn, &nc("c1", "twitch:u1", "chat", None, None, "2026-01-01T00:00:00Z")).unwrap();
        let r = record_comment(&conn, &nc("c2", "twitch:u1", "chat", None, None, "2026-01-15T00:00:00Z")).unwrap();
        assert!(!r.first_time);
        assert!(!r.long_absence);
    }

    // 038c-P4a: 境界＝丁度 1 ヶ月後は久しぶり（`cur >= prev + 1 ヶ月`）。
    #[test]
    fn long_absence_boundary_exactly_one_month() {
        let conn = test_conn();
        record_comment(&conn, &nc("c1", "twitch:u1", "chat", None, None, "2026-01-01T00:00:00Z")).unwrap();
        let r = record_comment(&conn, &nc("c2", "twitch:u1", "chat", None, None, "2026-02-01T00:00:00Z")).unwrap();
        assert!(r.long_absence, "exactly one month must count as 久しぶり");
    }

    // 038c-P4b: 境界直前（1 ヶ月に 1 秒足りない）は常連。
    #[test]
    fn long_absence_just_under_one_month_is_regular() {
        let conn = test_conn();
        record_comment(&conn, &nc("c1", "twitch:u1", "chat", None, None, "2026-01-01T00:00:00Z")).unwrap();
        let r = record_comment(&conn, &nc("c2", "twitch:u1", "chat", None, None, "2026-01-31T23:59:59Z")).unwrap();
        assert!(!r.long_absence);
    }

    // 038c-P5: 久しぶり判定後の同一 id 二重記録は肯定を返さない（バッジがブレない・冪等）。
    #[test]
    fn duplicate_does_not_reflag_after_long_absence() {
        let conn = test_conn();
        record_comment(&conn, &nc("c1", "twitch:u1", "chat", None, None, "2026-01-01T00:00:00Z")).unwrap();
        let first = record_comment(&conn, &nc("c2", "twitch:u1", "chat", None, None, "2026-03-05T00:00:00Z")).unwrap();
        assert!(first.long_absence);
        let dup = record_comment(&conn, &nc("c2", "twitch:u1", "chat", None, None, "2026-03-05T00:00:00Z")).unwrap();
        assert!(!dup.first_time);
        assert!(!dup.long_absence);
        assert_eq!(viewer(&conn, "twitch:u1").total_comments, 2);
    }

    // 038c-P6: 月末クランプ。1/31 の 1 ヶ月後は chrono `checked_add_months` で 2/28 にクランプされる
    //          （SQLite `datetime(x,'+1 month')` なら 3/3 に溢れる＝不採用）。クランプ後閾値 2/28 ちょうどは
    //          久しぶり、その手前（2/27）は常連。2/28 が久しぶりになること自体が「3/3 溢れではない」ことを担保する。
    #[test]
    fn long_absence_clamps_month_end() {
        // 2/28 ちょうど（クランプ後閾値）は久しぶり。
        let conn = test_conn();
        record_comment(&conn, &nc("a1", "twitch:ua", "chat", None, None, "2026-01-31T00:00:00Z")).unwrap();
        let at_clamp =
            record_comment(&conn, &nc("a2", "twitch:ua", "chat", None, None, "2026-02-28T00:00:00Z")).unwrap();
        assert!(at_clamp.long_absence, "1/31+1ヶ月はクランプで2/28＝久しぶり（3/3 に溢れない）");

        // 2/28 の手前（2/27）はまだ常連。
        let conn2 = test_conn();
        record_comment(&conn2, &nc("b1", "twitch:ub", "chat", None, None, "2026-01-31T00:00:00Z")).unwrap();
        let before_clamp =
            record_comment(&conn2, &nc("b2", "twitch:ub", "chat", None, None, "2026-02-27T23:59:59Z")).unwrap();
        assert!(!before_clamp.long_absence, "クランプ後閾値 2/28 手前は常連");
    }

    // 038c-P7: パース不能な時刻では久しぶりを付けない（§8 安全側・誤バッジ回避）。is_long_absence を直接検証する。
    #[test]
    fn is_long_absence_is_false_on_unparsable_timestamp() {
        assert!(!is_long_absence("not-a-timestamp", "2026-03-01T00:00:00Z"), "prev 不正 → false");
        assert!(!is_long_absence("2026-01-01T00:00:00Z", "garbage"), "cur 不正 → false");
        // 参考: 両端妥当で 1 ヶ月超なら通常判定は true（安全側フォールバックが誤って常に false にしていない）。
        assert!(is_long_absence("2026-01-01T00:00:00Z", "2026-03-01T00:00:00Z"));
    }
}
