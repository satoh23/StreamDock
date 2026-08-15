//! 062b: 配信セッションの検証・境界判定層。
//!
//! frontend の生値を信用せず、Rust 側で trim / 制御文字拒否 / 長さ上限 / allow-list を通してから
//! repository に渡す（docs/security.md §8）。エラーは既存 `AppError` 経由で DB パス等を露出しない。

use chrono::{DateTime, FixedOffset, Utc};
use rusqlite::Connection;

use crate::error::{AppError, AppResult};
use crate::util::{now_rfc3339, reject_control_chars, require_non_empty};

use super::model::StreamSessionRecord;
use super::repository;

/// 配信タイトルの最大文字数（**文字数＝Unicode スカラー単位**。バイト数ではない）。
///
/// ⚠ `presets::service::MAX_NAME_LEN` / `overlay_theme::service::MAX_NAME_CHARS` と同じく
/// `chars().count()` で数える。`len()`（バイト数）にすると日本語で 1/3 の長さしか入らない。
/// ⚠ **`viewer_memory::service::update_note` を真似ないこと**——あちらは制御文字拒否だけで
/// 長さ上限を持っていない（真似ると上限が漏れる）。
const MAX_TITLE_CHARS: usize = 100;

/// 受け付けるプラットフォーム（allow-list）。
///
/// ⚠ frontend 側の値は `commentStream.ts` の `parsePlatform` が **`"youtube"` 以外をすべて
/// `"twitch"` に寄せる**ため、実際に届くのはこの 2 語だけである。将来 3 つ目が増えるときは
/// ここと `parsePlatform` の両方を直すこと（片方だけだと黙って捨てられる）。
const KNOWN_PLATFORMS: [&str; 2] = ["twitch", "youtube"];

/// 閉じ忘れ回収の猶予（分）。最終活動からこの時間が過ぎた進行中セッションを閉じる。
///
/// ⚠⚠ **frontend の猶予タイマー（`sessionBoundary.ts` の `SESSION_END_GRACE_MS`）と同じ 30 分**だが、
/// 別物である。あちらは「アプリが動いている間のライブ判定」、こちらは
/// 「強制終了・窓の閉じ忘れで宙ぶらりんになった行を次の起動で拾う網」。
/// **不変条件: こちらの猶予は frontend の猶予以上であること。** 短くすると、frontend がまだ
/// 「猶予中（配信は続いている）」と思っているセッションを回収が先回りして閉じてしまう。
pub const STALE_GRACE_MINUTES: i64 = 30;

/// セッション id の検証（§8）。frontend 由来の文字列をそのまま SQL の値に渡す前に通す。
fn validate_id(id: &str) -> AppResult<String> {
    let id = id.trim().to_string();
    require_non_empty(&id, "セッションIDは必須です")?;
    reject_control_chars(&id, "セッションIDに制御文字は使用できません")?;
    Ok(id)
}

/// プラットフォーム集合を正規化する（trim → 小文字化 → allow-list → 重複除去 → 昇順）。
///
/// ⚠ **昇順で保存することが要点**。`"twitch,youtube"` と `"youtube,twitch"` が別物として保存されると、
/// 062c/062d が「同じ同時配信」を 2 種類として扱ってしまう。
/// ⚠ allow-list 外の値は**黙って落とす**（エラーにしない）。1 つでも既知の値が残れば配信の記録は
/// 続けられるべきで、未知の 1 語のためにセッション開始ごと失敗させると**その配信の記録が丸ごと消える**
/// （062b の動機＝「記録は遡れない」に反する）。全部落ちて空になったときだけ Validation で弾く。
fn normalize_platforms(raw: &[String]) -> AppResult<Vec<String>> {
    let mut out: Vec<String> = raw
        .iter()
        .map(|p| p.trim().to_ascii_lowercase())
        .filter(|p| KNOWN_PLATFORMS.contains(&p.as_str()))
        .collect();
    out.sort();
    out.dedup();
    if out.is_empty() {
        return Err(AppError::validation("配信プラットフォームが未指定です"));
    }
    Ok(out)
}

/// 配信タイトルの検証（trim ＋制御文字拒否 ＋文字数上限）。**空文字列は許容**（任意入力）。
fn validate_title(raw: &str) -> AppResult<String> {
    let title = raw.trim().to_string();
    reject_control_chars(&title, "配信タイトルに制御文字は使用できません")?;
    if title.chars().count() > MAX_TITLE_CHARS {
        return Err(AppError::validation(format!(
            "配信タイトルは{MAX_TITLE_CHARS}文字以内で入力してください"
        )));
    }
    Ok(title)
}

/// セッションの「最終活動時刻」を決める（`started_at` とコメント群のうち**最も遅い時刻**）。
/// 判定不能なら `None`（＝**閉じない**）。
///
/// - コメントが 1 件も無いセッションは `started_at` にフォールバックする。
///   ⚠ これが無いと基準が決まらず**永久に閉じない**（回収の目的を果たさない）。
/// - `published_at` が `started_at` より古い異常値でも壊れないよう、常に**遅いほう**を採る。
/// - **1 つでもパース不能なら `None`**（安全側＝進行中セッションを壊さない。
///   `viewer_memory` の `is_long_absence` が「パース不能なら判定を付けない」としているのと同じ作法）。
///   ⚠ ここを「読めた行だけで最大を取る」に緩めると、時刻が全部壊れた DB で `started_at` へ落ち、
///   **長時間配信の途中で閉じる**方向に倒れる。
///
/// ⚠⚠ **最大値の決定が Rust に居ることが本質。** `started_at` は `now_rfc3339()` 由来の `+00:00` 形式、
/// `published_at` はプラットフォーム由来（Twitch は `Z`）でオフセット付きも混ざりうるため、
/// **文字列比較では大小が壊れる**（例: `"…12:00:00Z"` > `"…05:00:00-08:00"` だが、実時刻は後者が 1 時間新しい）。
/// RFC3339 としてパースしてから比較する。
fn last_activity_at(started_at: &str, comment_times: &[String]) -> Option<DateTime<FixedOffset>> {
    let mut latest = DateTime::parse_from_rfc3339(started_at).ok()?;
    for raw in comment_times {
        let published = DateTime::parse_from_rfc3339(raw).ok()?;
        if published > latest {
            latest = published;
        }
    }
    Some(latest)
}

/// 最終活動から猶予を過ぎているか。
///
/// ⚠ 未来の時刻（`published_at` が進んでいる等）では負になり **false**（閉じない側）に倒れる。
fn is_stale(
    last_activity: DateTime<FixedOffset>,
    now: DateTime<Utc>,
    grace_minutes: i64,
) -> bool {
    now.signed_duration_since(last_activity.with_timezone(&Utc))
        .num_minutes()
        >= grace_minutes
}

/// セッションを開始する（進行中があればそれを返す＝冪等）。
pub fn start(conn: &Connection, platforms: &[String]) -> AppResult<StreamSessionRecord> {
    let platforms = normalize_platforms(platforms)?;
    let id = uuid::Uuid::new_v4().to_string();
    Ok(repository::start(conn, &id, &platforms, &now_rfc3339())?)
}

/// 進行中のセッションを返す（無ければ `None`）。read-only。
///
/// ⚠⚠ **コメビュ窓がマウント時にこれを呼んで id を引き継ぐ**のが 062b の主目的
/// （窓を開き直しても `session_id` が変わらない）。`start` で代用してはいけない——
/// あちらは進行中が無ければ**新しいセッションを作ってしまう**ので、
/// 「窓を開いた＝配信開始」という誤った境界になる。
pub fn active(conn: &Connection) -> AppResult<Option<StreamSessionRecord>> {
    Ok(repository::active(conn)?)
}

/// 全セッションを返す（開始時刻の降順）。062c/062d の一覧用の read-only 経路。
pub fn list(conn: &Connection) -> AppResult<Vec<StreamSessionRecord>> {
    Ok(repository::list(conn)?)
}

/// プラットフォームを足す（union）。
pub fn update_platforms(
    conn: &Connection,
    id: &str,
    platforms: &[String],
) -> AppResult<StreamSessionRecord> {
    let id = validate_id(id)?;
    let platforms = normalize_platforms(platforms)?;
    repository::update_platforms(conn, &id, &platforms, &now_rfc3339())?
        .ok_or_else(|| AppError::not_found("配信セッションが見つかりません"))
}

/// セッションを終了する（冪等）。`ended_at` には**現在時刻**を入れる。
///
/// ⚠ 呼ばれるのは frontend の猶予タイマー満了時なので、実際の切断より最大で猶予ぶん後ろにずれる。
/// 062c は `ended_at` を**おおよその終了時刻**として扱うこと（コメントの `published_at` が正確な尾）。
pub fn end(conn: &Connection, id: &str) -> AppResult<StreamSessionRecord> {
    let id = validate_id(id)?;
    let now = now_rfc3339();
    // 0 行（＝既に終了済み）でもエラーにしない＝冪等。行が無い場合だけ not_found にする。
    repository::end(conn, &id, &now, &now)?;
    repository::get(conn, &id)?
        .ok_or_else(|| AppError::not_found("配信セッションが見つかりません"))
}

/// 配信タイトルを更新する（手入力・任意）。
pub fn update_title(
    conn: &Connection,
    id: &str,
    title: &str,
) -> AppResult<StreamSessionRecord> {
    let id = validate_id(id)?;
    let title = validate_title(title)?;
    let affected = repository::update_title(conn, &id, &title, &now_rfc3339())?;
    if affected == 0 {
        return Err(AppError::not_found("配信セッションが見つかりません"));
    }
    repository::get(conn, &id)?
        .ok_or_else(|| AppError::not_found("配信セッションが見つかりません"))
}

/// 閉じ忘れたセッションを回収する（起動時とコメビュ窓のマウント時に呼ぶ）。戻り値は閉じた件数。
///
/// ⚠⚠ **猶予時間を引数に取らない**（§3）。取ると frontend が `0` や負値を渡すだけで
/// **進行中のセッションを全部終了させられる**。アプリ定義コマンドは ACL を通らず全窓から呼べるので、
/// この能力は構造側で持たせない（`overlay_theme` が件数上限を構造側に置いたのと同じ考え方）。
pub fn close_stale(conn: &Connection) -> AppResult<usize> {
    close_stale_at(conn, Utc::now(), STALE_GRACE_MINUTES)
}

/// `close_stale` の本体（時刻と猶予を注入してテストを決定的にする）。
///
/// ⚠⚠ **`ended_at` には「最終活動時刻」を入れる（`now` ではない）。** 強制終了したセッションを
/// 3 日後の起動で回収すると、`now` を入れた場合の終了時刻は「3 日後」になり 062c のサマリーが嘘になる。
fn close_stale_at(conn: &Connection, now: DateTime<Utc>, grace_minutes: i64) -> AppResult<usize> {
    let now_s = now.to_rfc3339();
    let mut closed = 0usize;
    for candidate in repository::active_candidates(conn)? {
        let times = repository::comment_times(conn, &candidate.id)?;
        let Some(last) = last_activity_at(&candidate.started_at, &times) else {
            // 時刻が読めないセッションは閉じない（安全側）。
            continue;
        };
        if !is_stale(last, now, grace_minutes) {
            continue;
        }
        closed += repository::end(conn, &candidate.id, &last.to_rfc3339(), &now_s)?;
    }
    Ok(closed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::ErrorCode;

    fn test_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute("PRAGMA foreign_keys = ON", []).unwrap();
        crate::viewer_memory::repository::init(&conn).unwrap();
        repository::init(&conn).unwrap();
        conn
    }

    fn platforms(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    fn at(rfc3339: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(rfc3339).unwrap().with_timezone(&Utc)
    }

    /// 進行中セッションを 1 本、指定の開始時刻で作る（id は戻り値）。
    fn start_at(conn: &Connection, started_at: &str) -> String {
        let id = uuid::Uuid::new_v4().to_string();
        repository::start(conn, &id, &platforms(&["twitch"]), started_at)
            .unwrap()
            .id
    }

    /// そのセッションにコメントを 1 件だけ差し込む（`published_at` の形式をテストが選べる）。
    ///
    /// ⚠ `viewer_comments.viewer_id` は `viewers` への FK なので親行を先に作る（本番と同じ順序）。
    fn insert_comment(conn: &Connection, session_id: &str, published_at: &str) {
        conn.execute(
            "INSERT OR IGNORE INTO viewers
                (id, provider, provider_user_id, name, first_seen_at, last_comment_at, note, created_at, updated_at)
             VALUES ('twitch:u1', 'twitch', 'u1', 'A', ?1, ?1, '', ?1, ?1)",
            rusqlite::params![published_at],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO viewer_comments
                (id, viewer_id, session_id, source, text, event_type, published_at, created_at)
             VALUES (?1, 'twitch:u1', ?2, 'twitch', 'hi', 'chat', ?3, ?3)",
            rusqlite::params![uuid::Uuid::new_v4().to_string(), session_id, published_at],
        )
        .unwrap();
    }

    // ---- platforms の正規化 ----

    #[test]
    fn platforms_are_lowercased_deduped_and_sorted() {
        assert_eq!(
            normalize_platforms(&platforms(&[" YouTube ", "twitch", "youtube"])).unwrap(),
            platforms(&["twitch", "youtube"])
        );
    }

    #[test]
    fn unknown_platforms_are_dropped_but_a_known_one_still_starts_the_session() {
        assert_eq!(
            normalize_platforms(&platforms(&["kick", "twitch"])).unwrap(),
            platforms(&["twitch"])
        );
    }

    #[test]
    fn platforms_must_not_be_empty_after_normalization() {
        assert_eq!(
            normalize_platforms(&platforms(&["kick"])).unwrap_err().code,
            ErrorCode::ValidationError
        );
        assert_eq!(
            normalize_platforms(&[]).unwrap_err().code,
            ErrorCode::ValidationError
        );
    }

    // ---- title の検証（穴 I: 上限は chars().count()） ----

    #[test]
    fn title_is_trimmed_and_bounded_by_character_count() {
        let conn = test_conn();
        let id = start_at(&conn, "2026-08-16T10:00:00+00:00");
        let updated = update_title(&conn, &id, "  8月の配信  ").unwrap();
        assert_eq!(updated.title, "8月の配信");

        // ⚠ 100 文字の日本語（300 バイト）は通ること。`len()` で数える実装だとここで落ちる。
        let just_fit = "あ".repeat(MAX_TITLE_CHARS);
        assert_eq!(update_title(&conn, &id, &just_fit).unwrap().title, just_fit);

        // 101 文字は落ちること。
        let too_long = "あ".repeat(MAX_TITLE_CHARS + 1);
        assert_eq!(
            update_title(&conn, &id, &too_long).unwrap_err().code,
            ErrorCode::ValidationError
        );
        // 拒否された更新は既存値を書き換えない。
        assert_eq!(repository::get(&conn, &id).unwrap().unwrap().title, just_fit);
    }

    #[test]
    fn title_rejects_control_chars() {
        let conn = test_conn();
        let id = start_at(&conn, "2026-08-16T10:00:00+00:00");
        assert_eq!(
            update_title(&conn, &id, "8月の\n配信").unwrap_err().code,
            ErrorCode::ValidationError
        );
    }

    #[test]
    fn title_may_be_empty() {
        let conn = test_conn();
        let id = start_at(&conn, "2026-08-16T10:00:00+00:00");
        assert_eq!(update_title(&conn, &id, "   ").unwrap().title, "");
    }

    // ---- id の検証 / not_found ----

    #[test]
    fn blank_or_control_ids_are_rejected_before_touching_sql() {
        let conn = test_conn();
        assert_eq!(end(&conn, "   ").unwrap_err().code, ErrorCode::ValidationError);
        assert_eq!(
            update_title(&conn, "a\nb", "x").unwrap_err().code,
            ErrorCode::ValidationError
        );
    }

    #[test]
    fn unknown_id_is_not_found_and_the_message_does_not_leak_the_id() {
        let conn = test_conn();
        let err = end(&conn, "no-such-session").unwrap_err();
        assert_eq!(err.code, ErrorCode::NotFound);
        assert!(
            !err.message.contains("no-such-session"),
            "セッション id をエラー文言に載せない（§9）"
        );
    }

    // ---- start / end の冪等 ----

    #[test]
    fn start_is_idempotent_and_end_is_idempotent() {
        let conn = test_conn();
        let first = start(&conn, &platforms(&["twitch"])).unwrap();
        let second = start(&conn, &platforms(&["youtube"])).unwrap();
        assert_eq!(second.id, first.id);
        assert!(second.ended_at.is_none());

        let ended = end(&conn, &first.id).unwrap();
        let ended_at = ended.ended_at.clone().unwrap();
        let ended_again = end(&conn, &first.id).unwrap();
        assert_eq!(ended_again.ended_at, Some(ended_at));
    }

    #[test]
    fn active_is_none_before_the_first_session_and_some_while_running() {
        let conn = test_conn();
        assert!(active(&conn).unwrap().is_none());
        let s = start(&conn, &platforms(&["twitch"])).unwrap();
        assert_eq!(active(&conn).unwrap().unwrap().id, s.id);
        end(&conn, &s.id).unwrap();
        assert!(active(&conn).unwrap().is_none());
    }

    // ---- 閉じ忘れ回収（穴 F / 穴 M） ----

    #[test]
    fn stale_close_keeps_sessions_inside_the_grace_period() {
        let conn = test_conn();
        let id = start_at(&conn, "2026-08-16T10:00:00+00:00");
        insert_comment(&conn, &id, "2026-08-16T11:00:00Z");
        // 最終コメントから 29 分（猶予 30 分）。
        assert_eq!(close_stale_at(&conn, at("2026-08-16T11:29:00Z"), 30).unwrap(), 0);
        assert!(repository::get(&conn, &id).unwrap().unwrap().ended_at.is_none());
    }

    #[test]
    fn stale_close_closes_sessions_past_the_grace_period() {
        let conn = test_conn();
        let id = start_at(&conn, "2026-08-16T10:00:00+00:00");
        insert_comment(&conn, &id, "2026-08-16T11:00:00Z");
        assert_eq!(close_stale_at(&conn, at("2026-08-16T11:31:00Z"), 30).unwrap(), 1);
        // ⚠ 穴 M: ended_at は「最終活動時刻」であって `now`（11:31）ではない。
        let ended_at = repository::get(&conn, &id).unwrap().unwrap().ended_at.unwrap();
        assert_eq!(
            DateTime::parse_from_rfc3339(&ended_at).unwrap().with_timezone(&Utc),
            at("2026-08-16T11:00:00Z"),
            "ended_at は最終活動時刻（回収した時刻ではない）"
        );
    }

    // ⚠⚠ 穴 F: コメントが 1 件も無いセッションは started_at フォールバックで閉じること
    //   （これが無いと「配信開始したがコメントゼロ」のセッションが永久に進行中のまま残る）。
    #[test]
    fn stale_close_falls_back_to_started_at_when_the_session_has_no_comments() {
        let conn = test_conn();
        let id = start_at(&conn, "2026-08-16T10:00:00+00:00");
        assert_eq!(close_stale_at(&conn, at("2026-08-16T10:29:00Z"), 30).unwrap(), 0);
        assert_eq!(close_stale_at(&conn, at("2026-08-16T10:31:00Z"), 30).unwrap(), 1);
        let ended_at = repository::get(&conn, &id).unwrap().unwrap().ended_at.unwrap();
        assert_eq!(
            DateTime::parse_from_rfc3339(&ended_at).unwrap().with_timezone(&Utc),
            at("2026-08-16T10:00:00Z")
        );
    }

    // ⚠⚠ 穴 F: `+00:00`（started_at）と `Z`（Twitch の published_at）が混ざっても正しく判定すること。
    //   SQL の文字列比較でやると `'+' < 'Z'` で最終活動が started_at 側に化け、**まだ配信中なのに閉じる**。
    #[test]
    fn stale_close_handles_mixed_z_and_offset_timestamps() {
        let conn = test_conn();
        let id = start_at(&conn, "2026-08-16T10:00:00+00:00");
        // started_at より 2 時間新しいコメント（Z 形式）。文字列比較だと started_at のほうが「大きい」。
        insert_comment(&conn, &id, "2026-08-16T12:00:00Z");
        // started_at から 2 時間半後 ＝ コメントからは 30 分未満。閉じてはいけない。
        assert_eq!(close_stale_at(&conn, at("2026-08-16T12:20:00Z"), 30).unwrap(), 0);
        assert!(repository::get(&conn, &id).unwrap().unwrap().ended_at.is_none());
    }

    // ⚠⚠ 穴 F の本体: セッション内に `Z` と**オフセット付き**の published_at が混ざったとき、
    //   **実時刻（instant）で**最新を選ぶこと。SQL の `MAX(published_at)`（＝ただの文字列比較）だと
    //   "2026-08-16T12:00:00Z" のほうが "2026-08-16T05:00:00-08:00"（＝13:00 UTC）より大きいと判定され、
    //   最終活動が 1 時間古くなる ⇒ **まだ配信中のセッションを閉じる**方向へ倒れる。
    #[test]
    fn stale_close_compares_timestamps_as_instants_not_as_strings() {
        let conn = test_conn();
        let id = start_at(&conn, "2026-08-16T10:00:00+00:00");
        insert_comment(&conn, &id, "2026-08-16T12:00:00Z"); // 12:00 UTC（文字列としては最大）
        insert_comment(&conn, &id, "2026-08-16T05:00:00-08:00"); // 13:00 UTC（実時刻の最新）
        // 13:20 UTC ＝ 実際の最終活動から 20 分。猶予 30 分なので閉じてはいけない。
        assert_eq!(close_stale_at(&conn, at("2026-08-16T13:20:00Z"), 30).unwrap(), 0);
        assert!(repository::get(&conn, &id).unwrap().unwrap().ended_at.is_none());
    }

    // ⚠ 穴 F: パース不能な published_at では判定しない（安全側＝進行中セッションを壊さない）。
    #[test]
    fn stale_close_leaves_sessions_with_unparsable_timestamps_open() {
        let conn = test_conn();
        let id = start_at(&conn, "2026-08-16T10:00:00+00:00");
        insert_comment(&conn, &id, "not-a-timestamp");
        assert_eq!(close_stale_at(&conn, at("2026-08-20T00:00:00Z"), 30).unwrap(), 0);
        assert!(repository::get(&conn, &id).unwrap().unwrap().ended_at.is_none());
    }

    // 未来の時刻でも閉じない（負の経過時間で猶予判定が反転しないこと）。
    #[test]
    fn stale_close_ignores_sessions_whose_last_activity_is_in_the_future() {
        let conn = test_conn();
        let id = start_at(&conn, "2026-08-16T10:00:00+00:00");
        insert_comment(&conn, &id, "2026-08-17T10:00:00Z");
        assert_eq!(close_stale_at(&conn, at("2026-08-16T12:00:00Z"), 30).unwrap(), 0);
        assert!(repository::get(&conn, &id).unwrap().unwrap().ended_at.is_none());
    }

    // 既に終了したセッションは回収の対象外（件数を二重に数えない）。
    #[test]
    fn stale_close_is_idempotent() {
        let conn = test_conn();
        let id = start_at(&conn, "2026-08-16T10:00:00+00:00");
        assert_eq!(close_stale_at(&conn, at("2026-08-16T11:00:00Z"), 30).unwrap(), 1);
        assert_eq!(close_stale_at(&conn, at("2026-08-16T12:00:00Z"), 30).unwrap(), 0);
        assert!(repository::get(&conn, &id).unwrap().unwrap().ended_at.is_some());
    }

    // 猶予の既定値を固定する（frontend の SESSION_END_GRACE_MS と対で 30 分。穴 N の不変条件）。
    #[test]
    fn stale_grace_default_is_thirty_minutes() {
        assert_eq!(STALE_GRACE_MINUTES, 30);
    }
}
