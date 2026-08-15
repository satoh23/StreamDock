//! 062b: `stream_sessions` テーブルの SQL 層。
//!
//! 識別子（テーブル名・カラム名・ORDER BY 句）は**コンパイル時定数のみ**を使い、値は必ず
//! パラメータバインドする（docs/security.md §8）。既存の各 repository と同じく `init()` は冪等 DDL で、
//! マイグレーション基盤（`PRAGMA user_version`）は使わない。

use rusqlite::{Connection, OptionalExtension};

use super::model::StreamSessionRecord;

/// SELECT で取得する全カラム（複数クエリで共有）。
const SESSION_COLUMNS: &str =
    "id, started_at, ended_at, platforms, title, created_at, updated_at";

/// `stream_sessions` テーブルを作成する（存在すれば何もしない）。
///
/// ## ⚠⚠ `viewer_comments.session_id` に FK を張らない理由（3 点・**次の人が誤読しないように残す**）
///
/// 「`PRAGMA foreign_keys = ON` で既存 DB が壊れるから」は**誤り**である。SQLite は
/// `PRAGMA foreign_keys = ON` の時点で既存行を検証しない（違反が表面化するのは書き込み時か
/// `PRAGMA foreign_key_check` のときだけ）。正しい理由は次の 3 点:
///
/// 1. **SQLite は `ALTER TABLE` で FK 制約を後から追加できない。** 張るには `viewer_comments` を
///    丸ごと作り直す（新テーブル作成 → コピー → DROP → RENAME）しかない。このテーブルは 043e 以降
///    **append-only ではなく UPDATE も走る**ので、作り直しは相応にリスクがある。
/// 2. 既存データには `stream_sessions` に対応行の**無い `session_id` が大量にある**（窓のマウント単位で
///    採番していた 038a〜062a の記録）。作り直したうえで FK を張ると、それらの行は**挿し直せない／捨てるしかない**。
/// 3. 本タスクは**バックフィルしない**と決めている（`published_at` から推測してセッションを捏造しない）ので、
///    対応行は今後も作られない。
///
/// ⇒ **緩い関連**（アプリ側で `session_id` を突き合わせるだけ）にする。
/// ⚠ なお `PRAGMA foreign_keys = ON` は本来「接続ごと」の設定だが、本アプリは `lib.rs` の `setup()` で
/// **単一の `Connection` に 1 回だけ**実行し、それを `Mutex<Connection>` として全コマンドで共有している
/// （＝アプリ全体で接続は 1 本）。`viewer_comments.viewer_id` → `viewers(id)` の FK CASCADE はこの上で効いており、
/// 062b はそれに一切触れていない（削除手段は非退行）。
///
/// 索引は `started_at` の 1 本だけ（一覧は常に開始時刻の降順・062c/062d が使う）。
pub fn init(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS stream_sessions (
            id           TEXT PRIMARY KEY,
            started_at   TEXT NOT NULL,
            ended_at     TEXT,
            platforms    TEXT NOT NULL,
            title        TEXT NOT NULL DEFAULT '',
            created_at   TEXT NOT NULL,
            updated_at   TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_stream_sessions_started ON stream_sessions(started_at);",
    )?;
    Ok(())
}

/// 保存形（カンマ区切り 1 列）へ畳む。呼び出し側で正規化済み（allow-list・昇順・重複なし）であること。
fn encode_platforms(platforms: &[String]) -> String {
    platforms.join(",")
}

/// 保存形をほどく。空文字列は空配列（`"".split(',')` は `[""]` を返すので必ず落とす）。
fn decode_platforms(raw: &str) -> Vec<String> {
    raw.split(',')
        .filter(|p| !p.is_empty())
        .map(str::to_string)
        .collect()
}

fn row_to_session(row: &rusqlite::Row<'_>) -> rusqlite::Result<StreamSessionRecord> {
    let platforms: String = row.get("platforms")?;
    Ok(StreamSessionRecord {
        id: row.get("id")?,
        started_at: row.get("started_at")?,
        ended_at: row.get("ended_at")?,
        platforms: decode_platforms(&platforms),
        title: row.get("title")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

/// id 指定で 1 件返す。
pub fn get(conn: &Connection, id: &str) -> rusqlite::Result<Option<StreamSessionRecord>> {
    let sql = format!("SELECT {SESSION_COLUMNS} FROM stream_sessions WHERE id = ?1");
    conn.query_row(&sql, rusqlite::params![id], row_to_session)
        .optional()
}

/// 進行中（`ended_at IS NULL`）のセッションを 1 件返す。
///
/// ⚠ 設計上「進行中は同時に 1 本だけ」（`start` が同一トランザクションで担保する）だが、
/// 万一 2 本以上あっても**最後に始まったもの**を返す（古い側は閉じ忘れ回収 `close_stale` が拾う）。
pub fn active(conn: &Connection) -> rusqlite::Result<Option<StreamSessionRecord>> {
    let sql = format!(
        "SELECT {SESSION_COLUMNS} FROM stream_sessions
         WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1"
    );
    conn.query_row(&sql, [], row_to_session).optional()
}

/// 全セッションを開始時刻の降順で返す（062c/062d の一覧が使う read-only 経路）。
pub fn list(conn: &Connection) -> rusqlite::Result<Vec<StreamSessionRecord>> {
    let sql = format!(
        "SELECT {SESSION_COLUMNS} FROM stream_sessions ORDER BY started_at DESC, id DESC"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], row_to_session)?;
    rows.collect()
}

/// セッションを開始する。**進行中があればそれをそのまま返す**（冪等）。
///
/// frontend は StrictMode の二重マウント・接続イベントとコメント到着の同時発火で `start` を
/// 複数回投げうる（＝**同じ配信に対して 2 本の行ができると 062c の集計が割れる**）。
///
/// ⚠⚠ **冪等性を実際に担保しているのは `DbState` の単一 `Mutex<Connection>` による直列化**である。
/// 全コマンドは 1 本の接続を 1 本の Mutex で守って使うため、「進行中の SELECT」と「INSERT」の間に
/// 他のコマンドが割り込む経路が構造的に無い。
/// ⚠ **本関数の `unchecked_transaction` はその上の多層防御**（接続を増やす／別スレッドから直接
/// repository を呼ぶ実装が現れたときに初めて効く）。**変異で確認済み: SELECT を tx の外へ出しても
/// 現在のテストはレッドにならない**——単一 Mutex 下では観測可能な差が出ないためで、
/// 「tx 境界そのもの」はテストで固定できていない（固定できているのは
/// 「単一 Mutex 下で 2 スレッドから叩いても行は 1 本」まで）。**接続を増やすときはここを必ず読むこと。**
///
/// ⚠ 進行中があったときに `platforms` は**触らない**（単一目的・§3）。プラットフォームが増えたときは
/// `update_platforms` を呼ぶこと。
pub fn start(
    conn: &Connection,
    new_id: &str,
    platforms: &[String],
    now: &str,
) -> rusqlite::Result<StreamSessionRecord> {
    // DbState の Mutex を保持した状態で `&Connection` から張れる unchecked_transaction を使う
    //（本モジュールの全 command は単一 Mutex<Connection> で直列化されるため安全）。
    let tx = conn.unchecked_transaction()?;
    if let Some(existing) = active(&tx)? {
        tx.commit()?;
        return Ok(existing);
    }
    tx.execute(
        "INSERT INTO stream_sessions
            (id, started_at, ended_at, platforms, title, created_at, updated_at)
         VALUES (?1, ?2, NULL, ?3, '', ?2, ?2)",
        rusqlite::params![new_id, now, encode_platforms(platforms)],
    )?;
    let created = get(&tx, new_id)?.ok_or(rusqlite::Error::QueryReturnedNoRows)?;
    tx.commit()?;
    Ok(created)
}

/// プラットフォームを**足す**（union・単調増加）。存在しない id なら `None`。
///
/// ⚠ **引数で置き換えない**のが要点。片方の provider が切れた瞬間に frontend が現在値だけを送っても、
/// 「この配信は両方でやった」という記録が消えないようにする。読み取りと書き込みを同一トランザクションに
/// 入れているのは `start` と同じ理由（同時発火で片方の追加が消えないように）。
pub fn update_platforms(
    conn: &Connection,
    id: &str,
    add: &[String],
    now: &str,
) -> rusqlite::Result<Option<StreamSessionRecord>> {
    let tx = conn.unchecked_transaction()?;
    let Some(current) = get(&tx, id)? else {
        tx.commit()?;
        return Ok(None);
    };
    let mut merged = current.platforms.clone();
    merged.extend(add.iter().cloned());
    // 両辺とも service の allow-list を通った値なので、ここは並べ替えと重複除去だけでよい。
    merged.sort();
    merged.dedup();
    if merged != current.platforms {
        tx.execute(
            "UPDATE stream_sessions SET platforms = ?2, updated_at = ?3 WHERE id = ?1",
            rusqlite::params![id, encode_platforms(&merged), now],
        )?;
    }
    let updated = get(&tx, id)?;
    tx.commit()?;
    Ok(updated)
}

/// セッションを終了する。**既に終了済みなら 0 行**（冪等・`ended_at` を上書きしない）。
pub fn end(conn: &Connection, id: &str, ended_at: &str, now: &str) -> rusqlite::Result<usize> {
    conn.execute(
        "UPDATE stream_sessions SET ended_at = ?2, updated_at = ?3
         WHERE id = ?1 AND ended_at IS NULL",
        rusqlite::params![id, ended_at, now],
    )
}

/// 配信タイトルを更新する（進行中・終了済みのどちらでも可＝配信後に付けられる）。
pub fn update_title(
    conn: &Connection,
    id: &str,
    title: &str,
    now: &str,
) -> rusqlite::Result<usize> {
    conn.execute(
        "UPDATE stream_sessions SET title = ?2, updated_at = ?3 WHERE id = ?1",
        rusqlite::params![id, title, now],
    )
}

/// 閉じ忘れ回収の判定材料（進行中セッション 1 件ぶん）。
pub struct StaleCandidate {
    pub id: String,
    pub started_at: String,
}

/// 進行中のセッションを列挙する（閉じ忘れ回収の入力）。
pub fn active_candidates(conn: &Connection) -> rusqlite::Result<Vec<StaleCandidate>> {
    let mut stmt =
        conn.prepare("SELECT id, started_at FROM stream_sessions WHERE ended_at IS NULL")?;
    let rows = stmt.query_map([], |row| {
        Ok(StaleCandidate {
            id: row.get("id")?,
            started_at: row.get("started_at")?,
        })
    })?;
    rows.collect()
}

/// そのセッションで記録したコメントの `published_at` を**全件そのまま**返す（順序は問わない）。
///
/// ⚠⚠ **`MAX(published_at)` を SQL で取らないこと**が要点。`started_at` は `now_rfc3339()` 由来の
/// `+00:00` 形式、`published_at` は**プラットフォーム由来**（Twitch は `Z` 形式）で、しかも
/// オフセット付き（`+09:00` / `-08:00`）が混ざりうる。SQL の `MAX` は**単なる文字列比較**なので、
/// この混在で**最新でない行を「最新」として選ぶ**（例: `12:00:00Z` と `05:00:00-08:00`＝13:00 UTC では
/// 前者が MAX になる）。その結果「まだ配信中のセッションを閉じる」方向へ倒れうる。
/// ⇒ ここは値を**取り出すだけ**にして、最大値の決定は Rust の `DateTime::parse_from_rfc3339` で行う
/// （`viewer_memory` の `is_long_absence` と同じ作法）。
///
/// ⚠ コストは「**進行中**セッション 1 本ぶんの `published_at` 文字列」で、`idx_viewer_comments_session`
/// が効く。呼ばれるのは起動時とコメビュ窓のマウント時だけなので、全件読みでも実用上問題にならない。
///
/// ⚠ `viewer_comments` を読む唯一の場所（＝FK を張らない「緩い関連」を突き合わせている実体）。
/// この関数を呼ぶ前に `viewer_memory::repository::init` が済んでいること（`lib.rs` の `setup()` の順序）。
pub fn comment_times(conn: &Connection, session_id: &str) -> rusqlite::Result<Vec<String>> {
    let mut stmt =
        conn.prepare("SELECT published_at FROM viewer_comments WHERE session_id = ?1")?;
    let rows = stmt.query_map(rusqlite::params![session_id], |row| row.get(0))?;
    rows.collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// テスト用 in-memory 接続（本番同様に foreign_keys=ON・`viewer_comments` も作る）。
    ///
    /// ⚠ `viewer_memory::repository::init` も呼ぶのは、閉じ忘れ回収が `viewer_comments` を
    /// 突き合わせるため（本番の `setup()` と同じ順序＝視聴者メモリ → 配信セッション）。
    fn test_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute("PRAGMA foreign_keys = ON", []).unwrap();
        crate::viewer_memory::repository::init(&conn).unwrap();
        init(&conn).unwrap();
        conn
    }

    fn platforms(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    fn count(conn: &Connection) -> i64 {
        conn.query_row("SELECT COUNT(*) FROM stream_sessions", [], |r| r.get(0))
            .unwrap()
    }

    // 既存 DB でも壊れないこと（マイグレーション基盤が無いので init は何度呼ばれてもよい）。
    #[test]
    fn init_is_idempotent() {
        let conn = test_conn();
        init(&conn).unwrap();
        init(&conn).unwrap();
        let row = start(&conn, "s1", &platforms(&["twitch"]), "2026-08-16T10:00:00+00:00").unwrap();
        assert_eq!(row.id, "s1");
    }

    // ⚠⚠ 062b の「既存 DB を壊さない」担保。`viewer_comments` の FK は **viewer_id の 1 本だけ**で、
    //   `session_id` には**張っていない**こと（`viewer_id` の FK CASCADE は削除手段が依存しているので
    //   在ることまで固定する。両者を混同しないこと）。
    #[test]
    fn viewer_comments_has_only_the_viewer_id_foreign_key() {
        let conn = test_conn();
        let mut stmt = conn
            .prepare("SELECT \"table\" AS parent, \"from\" AS child FROM pragma_foreign_key_list('viewer_comments')")
            .unwrap();
        let fks: Vec<(String, String)> = stmt
            .query_map([], |row| Ok((row.get("parent")?, row.get("child")?)))
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap();
        assert_eq!(
            fks,
            vec![("viewers".to_string(), "viewer_id".to_string())],
            "viewer_comments の FK は viewers(id) 宛の viewer_id 1 本だけであること\
             （session_id に FK を足すと、対応行の無い既存 session_id を持つ DB が壊れる）"
        );
    }

    // 進行中があれば同じ行を返す（冪等）。行は増えない。
    #[test]
    fn start_returns_the_active_session_instead_of_creating_a_second_one() {
        let conn = test_conn();
        let first = start(&conn, "s1", &platforms(&["twitch"]), "2026-08-16T10:00:00+00:00").unwrap();
        let second = start(&conn, "s2", &platforms(&["youtube"]), "2026-08-16T10:00:05+00:00").unwrap();
        assert_eq!(second.id, first.id, "進行中があれば新規採番しない");
        assert_eq!(second.platforms, platforms(&["twitch"]), "start は platforms を書き換えない");
        assert_eq!(count(&conn), 1);
    }

    // 終了済みしか無ければ新しいセッションを始める（配信 2 本目）。
    #[test]
    fn start_creates_a_new_session_after_the_previous_one_ended() {
        let conn = test_conn();
        start(&conn, "s1", &platforms(&["twitch"]), "2026-08-16T10:00:00+00:00").unwrap();
        end(&conn, "s1", "2026-08-16T12:00:00+00:00", "2026-08-16T12:00:00+00:00").unwrap();
        let next = start(&conn, "s2", &platforms(&["twitch"]), "2026-08-16T20:00:00+00:00").unwrap();
        assert_eq!(next.id, "s2");
        assert_eq!(count(&conn), 2);
    }

    // ⚠⚠ 穴 C: 同時に 2 発飛んでも行は 1 本になること。本番の `DbState` と同じく
    //   単一 Mutex<Connection> を 2 スレッドで奪い合わせる（＝コマンド層と同じ構造）。
    // ⚠ **このテストが固定しているのは「単一 Mutex 下での直列化で 1 本に収束すること」**であって、
    //   `start` 内のトランザクション境界ではない（変異で確認済み・`start` の doc コメント参照）。
    #[test]
    fn concurrent_start_creates_exactly_one_row() {
        use std::sync::{Arc, Mutex};
        let shared = Arc::new(Mutex::new(test_conn()));
        let handles: Vec<_> = ["a", "b"]
            .into_iter()
            .map(|id| {
                let shared = Arc::clone(&shared);
                std::thread::spawn(move || {
                    let conn = shared.lock().unwrap();
                    start(&conn, id, &platforms(&["twitch"]), "2026-08-16T10:00:00+00:00")
                        .unwrap()
                        .id
                })
            })
            .collect();
        let ids: Vec<String> = handles.into_iter().map(|h| h.join().unwrap()).collect();
        assert_eq!(ids[0], ids[1], "2 スレッドが同じセッション id を受け取る");
        assert_eq!(count(&shared.lock().unwrap()), 1);
    }

    // platforms は昇順のカンマ連結で保存され、読み戻しで配列に戻る（保存形の往復）。
    #[test]
    fn platforms_round_trip_through_the_csv_column() {
        let conn = test_conn();
        start(&conn, "s1", &platforms(&["twitch", "youtube"]), "2026-08-16T10:00:00+00:00").unwrap();
        let raw: String = conn
            .query_row("SELECT platforms FROM stream_sessions WHERE id = 's1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(raw, "twitch,youtube");
        assert_eq!(get(&conn, "s1").unwrap().unwrap().platforms, platforms(&["twitch", "youtube"]));
    }

    // union で増える／減らない（片方が切れても記録から消えない）。
    #[test]
    fn update_platforms_unions_and_never_shrinks() {
        let conn = test_conn();
        start(&conn, "s1", &platforms(&["twitch"]), "2026-08-16T10:00:00+00:00").unwrap();
        let added = update_platforms(&conn, "s1", &platforms(&["youtube"]), "2026-08-16T10:05:00+00:00")
            .unwrap()
            .unwrap();
        assert_eq!(added.platforms, platforms(&["twitch", "youtube"]));
        // youtube だけを渡し直しても twitch は消えない。
        let shrunk = update_platforms(&conn, "s1", &platforms(&["youtube"]), "2026-08-16T10:06:00+00:00")
            .unwrap()
            .unwrap();
        assert_eq!(shrunk.platforms, platforms(&["twitch", "youtube"]));
    }

    // 存在しない id は None（service が not_found へ翻訳する）。
    #[test]
    fn update_platforms_returns_none_for_unknown_id() {
        let conn = test_conn();
        assert!(update_platforms(&conn, "nope", &platforms(&["twitch"]), "2026-08-16T10:00:00+00:00")
            .unwrap()
            .is_none());
    }

    // end は冪等（2 度目は 0 行＝最初の ended_at を上書きしない）。
    #[test]
    fn end_is_idempotent_and_keeps_the_first_ended_at() {
        let conn = test_conn();
        start(&conn, "s1", &platforms(&["twitch"]), "2026-08-16T10:00:00+00:00").unwrap();
        assert_eq!(end(&conn, "s1", "2026-08-16T12:00:00+00:00", "2026-08-16T12:00:00+00:00").unwrap(), 1);
        assert_eq!(end(&conn, "s1", "2026-08-16T13:00:00+00:00", "2026-08-16T13:00:00+00:00").unwrap(), 0);
        assert_eq!(
            get(&conn, "s1").unwrap().unwrap().ended_at.as_deref(),
            Some("2026-08-16T12:00:00+00:00")
        );
    }

    // active は進行中のみを返す（終了させたら None）。
    #[test]
    fn active_returns_none_once_every_session_ended() {
        let conn = test_conn();
        start(&conn, "s1", &platforms(&["twitch"]), "2026-08-16T10:00:00+00:00").unwrap();
        assert!(active(&conn).unwrap().is_some());
        end(&conn, "s1", "2026-08-16T12:00:00+00:00", "2026-08-16T12:00:00+00:00").unwrap();
        assert!(active(&conn).unwrap().is_none());
    }

    // 一覧は開始時刻の降順。
    #[test]
    fn list_is_ordered_by_started_at_desc() {
        let conn = test_conn();
        start(&conn, "old", &platforms(&["twitch"]), "2026-08-15T10:00:00+00:00").unwrap();
        end(&conn, "old", "2026-08-15T12:00:00+00:00", "2026-08-15T12:00:00+00:00").unwrap();
        start(&conn, "new", &platforms(&["twitch"]), "2026-08-16T10:00:00+00:00").unwrap();
        let ids: Vec<String> = list(&conn).unwrap().into_iter().map(|s| s.id).collect();
        assert_eq!(ids, vec!["new".to_string(), "old".to_string()]);
    }

    // 閉じ忘れ回収の入力: 進行中だけが候補に挙がる（終了済みは対象外）。
    #[test]
    fn active_candidates_lists_only_running_sessions() {
        let conn = test_conn();
        start(&conn, "s1", &platforms(&["twitch"]), "2026-08-16T10:00:00+00:00").unwrap();
        let candidates = active_candidates(&conn).unwrap();
        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].id, "s1");
        assert_eq!(candidates[0].started_at, "2026-08-16T10:00:00+00:00");

        end(&conn, "s1", "2026-08-16T12:00:00+00:00", "2026-08-16T12:00:00+00:00").unwrap();
        assert!(active_candidates(&conn).unwrap().is_empty());
    }

    // コメントが 1 件も無ければ空（service が started_at フォールバックへ落とす）。
    #[test]
    fn comment_times_is_empty_when_the_session_has_no_comments() {
        let conn = test_conn();
        start(&conn, "s1", &platforms(&["twitch"]), "2026-08-16T10:00:00+00:00").unwrap();
        assert!(comment_times(&conn, "s1").unwrap().is_empty());
    }
}
