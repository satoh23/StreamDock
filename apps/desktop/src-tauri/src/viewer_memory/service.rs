//! 038a: 視聴者メモリの検証・整形層。
//!
//! frontend の生値を信用せず、Rust 側で trim / 制御文字拒否を通してから repository に渡す
//! （docs/security.md §8）。エラーは既存 `AppError` 経由で DB パス等を露出しない。

use rusqlite::Connection;

use crate::comment_viewer::model::CommentViewDto;
use crate::error::{AppError, AppResult};
use crate::util::{now_rfc3339, reject_control_chars, require_non_empty};

use super::model::{
    ListViewersInput, NewViewerComment, RecordResult, ViewerDetail, ViewerRecord, ViewerSort,
};
use super::repository;

/// 受信済みコメントを 1 件記録する（視聴者 upsert＋集計＋過去コメント追加）。戻り値は 038c 判定（初見／久しぶり）。
///
/// `comment` は loopback WS で frontend が受信済みの値を Tauri コマンド経由で渡すだけ（新規の外部通信は
/// 発生しない）。同一コメント id の二重記録は repository 側の `INSERT OR IGNORE` で冪等に無視され、判定も
/// 肯定を返さない（`RecordResult{false,false}`）。
pub fn record_comment(
    conn: &Connection,
    comment: CommentViewDto,
    session_id: String,
) -> AppResult<RecordResult> {
    // session_id: 必須・制御文字拒否。
    let session_id = session_id.trim().to_string();
    require_non_empty(&session_id, "セッションIDは必須です")?;
    reject_control_chars(&session_id, "セッションIDに制御文字は使用できません")?;

    // コメント id / 投稿者 id: 安定キーとして必須・制御文字拒否。
    require_non_empty(&comment.id, "コメントIDは必須です")?;
    reject_control_chars(&comment.id, "コメントIDに制御文字は使用できません")?;
    let provider_user_id = comment.author.id.trim().to_string();
    require_non_empty(&provider_user_id, "投稿者IDは必須です")?;
    reject_control_chars(&provider_user_id, "投稿者IDに制御文字は使用できません")?;

    // 表示名・本文: trim のうえ制御文字を拒否（改行・NUL 等）。名前は空でも許容（provider 依存）。
    let name = comment.author.name.trim().to_string();
    reject_control_chars(&name, "投稿者名に制御文字は使用できません")?;
    // 【意図】§8 準拠で本文にも制御文字を拒否（単一行前提）。【修正不要理由】共有 util の reject_control_chars
    //   を全モジュールで統一／本文は SQL バインド・非ログ・React エスケープで実害小・MVP は単一行前提。
    // 【副作用】改行入りの正当コメント（複数行 YouTube スパチャ等）は記録から落ちる（表示は済み・集計のみ欠落）。
    // 【再修正トリガ】複数行の集計欠落が問題化したら text だけ「拒否」→「制御文字の除去(strip)」へ切替（Q2）。
    let text = comment.text.trim().to_string();
    reject_control_chars(&text, "コメント本文に制御文字は使用できません")?;

    // published_at: 必須（集計の first/last・038c 判定に使う）。
    require_non_empty(&comment.published_at, "投稿日時が空です")?;

    let source = comment.source.as_str().to_string();
    let event_type = comment.event_type.as_str().to_string();
    let viewer_id = format!("{source}:{provider_user_id}");
    let (amount, currency) = match &comment.monetary {
        Some(m) => (Some(m.amount), Some(m.currency.clone())),
        None => (None, None),
    };

    let new = NewViewerComment {
        comment_id: comment.id,
        viewer_id,
        session_id,
        provider: source.clone(),
        provider_user_id,
        name,
        source,
        text,
        event_type,
        amount,
        currency,
        monetary_amount: comment.monetary_amount,
        published_at: comment.published_at,
    };

    Ok(repository::record_comment(conn, &new)?)
}

/// 視聴者一覧を返す（検索・並び替えは任意）。
pub fn list(conn: &Connection, input: Option<ListViewersInput>) -> AppResult<Vec<ViewerRecord>> {
    let input = input.unwrap_or_default();
    // 検索語は trim し、空なら「絞り込みなし」に落とす。
    let search = input
        .search
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let sort = input.sort.unwrap_or(ViewerSort::LastComment);
    Ok(repository::list(conn, search.as_deref(), sort)?)
}

/// 視聴者の詳細（本人＋過去コメント）を返す。
pub fn get(conn: &Connection, id: &str) -> AppResult<ViewerDetail> {
    let viewer = repository::get(conn, id)?
        .ok_or_else(|| AppError::not_found(format!("視聴者が見つかりません: {id}")))?;
    let comments = repository::list_comments(conn, id)?;
    Ok(ViewerDetail { viewer, comments })
}

/// 配信者メモを更新して更新後の視聴者を返す。
pub fn update_note(conn: &Connection, id: &str, note: String) -> AppResult<ViewerRecord> {
    // メモは trim ＋制御文字拒否（MVP は単一行想定。改行を許すなら別途方針を決める）。
    let note = note.trim().to_string();
    reject_control_chars(&note, "メモに制御文字は使用できません")?;
    let affected = repository::update_note(conn, id, &note, &now_rfc3339())?;
    if affected == 0 {
        return Err(AppError::not_found(format!("視聴者が見つかりません: {id}")));
    }
    repository::get(conn, id)?
        .ok_or_else(|| AppError::not_found(format!("視聴者が見つかりません: {id}")))
}

/// 視聴者を削除する（当該コメントも FK CASCADE で削除）。
pub fn delete(conn: &Connection, id: &str) -> AppResult<()> {
    let affected = repository::delete(conn, id)?;
    if affected == 0 {
        return Err(AppError::not_found(format!("視聴者が見つかりません: {id}")));
    }
    Ok(())
}

/// 全視聴者を削除する（プライバシー手段の全消去）。
pub fn clear(conn: &Connection) -> AppResult<()> {
    repository::clear(conn)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::comment_viewer::model::{
        CommentAuthor, CommentEventType, CommentMonetaryDto, CommentSource, CommentViewDto,
    };
    use crate::error::ErrorCode;
    use rusqlite::Connection;

    /// テスト用 in-memory 接続（本番同様に foreign_keys=ON）。
    fn test_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute("PRAGMA foreign_keys = ON", []).unwrap();
        repository::init(&conn).unwrap();
        conn
    }

    /// 最小の受信 DTO（twitch / 通常チャット / 金額なし）。
    fn dto() -> CommentViewDto {
        CommentViewDto {
            id: "c1".to_string(),
            source: CommentSource::Twitch,
            author: CommentAuthor {
                id: "u1".to_string(),
                name: "Alice".to_string(),
                avatar: None,
            },
            text: "hello".to_string(),
            published_at: "2026-01-01T00:00:00Z".to_string(),
            event_type: CommentEventType::Chat,
            monetary_amount: None,
            monetary: None,
            month_count: None,
            gift_count: None,
            tier: None,
            combo_count: None,
        }
    }

    // 正常系: viewer_id を `source:providerUserId` で合成し、session_id を付けて記録する。
    #[test]
    fn records_and_composes_viewer_id() {
        let conn = test_conn();
        record_comment(&conn, dto(), "sess-1".to_string()).unwrap();
        let detail = get(&conn, "twitch:u1").unwrap();
        assert_eq!(detail.viewer.id, "twitch:u1");
        assert_eq!(detail.viewer.provider, "twitch");
        assert_eq!(detail.viewer.provider_user_id, "u1");
        assert_eq!(detail.comments.len(), 1);
        assert_eq!(detail.comments[0].session_id, "sess-1");
    }

    // P6/P13: monetary から amount/currency を取り出し集計に反映する。
    #[test]
    fn extracts_monetary_into_superchat_aggregate() {
        let conn = test_conn();
        let mut d = dto();
        d.event_type = CommentEventType::Superchat;
        d.monetary = Some(CommentMonetaryDto { amount: 500.0, currency: "JPY".to_string() });
        d.monetary_amount = Some("500 JPY".to_string());
        record_comment(&conn, d, "s".to_string()).unwrap();
        let v = get(&conn, "twitch:u1").unwrap().viewer;
        assert_eq!(v.superchat_count, 1);
        assert_eq!(v.superchat_amount, 500.0);
        assert_eq!(v.superchat_currency.as_deref(), Some("JPY"));
    }

    // P7: 空・空白のみの session_id は Validation で弾く（記録されない）。
    #[test]
    fn rejects_blank_session_id() {
        let conn = test_conn();
        let err = record_comment(&conn, dto(), "   ".to_string()).unwrap_err();
        assert_eq!(err.code, ErrorCode::ValidationError);
        assert!(get(&conn, "twitch:u1").is_err());
    }

    // P7: 空の投稿者 ID は Validation で弾く。
    #[test]
    fn rejects_empty_author_id() {
        let conn = test_conn();
        let mut d = dto();
        d.author.id = "  ".to_string();
        assert_eq!(
            record_comment(&conn, d, "s".to_string()).unwrap_err().code,
            ErrorCode::ValidationError
        );
    }

    // P7: 空の投稿日時は Validation で弾く。
    #[test]
    fn rejects_empty_published_at() {
        let conn = test_conn();
        let mut d = dto();
        d.published_at = "".to_string();
        assert_eq!(
            record_comment(&conn, d, "s".to_string()).unwrap_err().code,
            ErrorCode::ValidationError
        );
    }

    // P7: 本文の制御文字（改行）は Validation で弾き、視聴者行も作られない。
    #[test]
    fn rejects_control_chars_in_text() {
        let conn = test_conn();
        let mut d = dto();
        d.text = "line1\nline2".to_string();
        assert_eq!(
            record_comment(&conn, d, "s".to_string()).unwrap_err().code,
            ErrorCode::ValidationError
        );
        assert!(get(&conn, "twitch:u1").is_err()); // not_found（未記録）
    }

    // P9: メモは trim して更新し、更新後 viewer を返す。
    #[test]
    fn update_note_trims_and_returns_updated() {
        let conn = test_conn();
        record_comment(&conn, dto(), "s".to_string()).unwrap();
        let v = update_note(&conn, "twitch:u1", "  常連さん  ".to_string()).unwrap();
        assert_eq!(v.note, "常連さん");
    }

    // P9: メモの制御文字（改行）は Validation で弾く（MVP 単一行前提）。
    #[test]
    fn update_note_rejects_newline() {
        let conn = test_conn();
        record_comment(&conn, dto(), "s".to_string()).unwrap();
        assert_eq!(
            update_note(&conn, "twitch:u1", "a\nb".to_string()).unwrap_err().code,
            ErrorCode::ValidationError
        );
    }

    // ---- 043e: combo 更新を service 経由で通したときの仕様（§8 検証・非保存・削除手段の非退行）----

    /// 043e: Jewels コメント 1 件の受信 DTO（`combo_count` 付き）。
    fn jewels_dto(amount: f64, combo: Option<u32>) -> CommentViewDto {
        let mut d = dto();
        d.id = "g1".to_string();
        d.source = CommentSource::Youtube;
        d.event_type = CommentEventType::Jewels;
        d.text = "".to_string();
        d.monetary = Some(CommentMonetaryDto { amount, currency: "JEWELS".to_string() });
        d.monetary_amount = Some(format!("{amount} JEWELS"));
        d.combo_count = combo;
        d
    }

    // 043e: combo 更新は service 層（trim / 制御文字拒否）を通っても成立し、金額が置き換わる。
    //   行は増えず、combo_count は**端末に保存されない**（monthCount/giftCount/tier と同じ扱い＝§9）。
    #[test]
    fn jewels_combo_update_passes_through_service_and_does_not_persist_combo_count() {
        let conn = test_conn();
        record_comment(&conn, jewels_dto(30.0, None), "sess-1".to_string()).unwrap();
        let r = record_comment(&conn, jewels_dto(90.0, Some(3)), "sess-1".to_string()).unwrap();
        assert!(!r.first_time, "combo 更新で初見を再点灯させない");
        assert!(!r.long_absence);

        let detail = get(&conn, "youtube:u1").unwrap();
        assert_eq!(detail.comments.len(), 1, "combo は論理的に 1 ギフト＝1 行");
        assert_eq!(detail.comments[0].amount, Some(90.0), "最新の jewels 額へ置き換わる");
        assert_eq!(detail.comments[0].monetary_amount.as_deref(), Some("90 JEWELS"));
        assert_eq!(detail.viewer.total_comments, 1);
        // combo_count を保存する列は存在しない（保存項目を増やさない＝§9 の保存範囲は不変）。
        // 保存済み行の全列を文字列化しても combo の値（3）はどこにも現れない。
        let saved = format!("{:?}", detail.comments[0]);
        assert!(
            !saved.contains("combo"),
            "combo_count は端末保存しない（保存行に combo 由来の列が無いこと）"
        );
    }

    // 043e(§8): combo 更新の本文に制御文字が入っていたら service が弾き、**既存行は 1 バイトも変わらない**。
    //   frontend 由来の値が検証をすり抜けて既存レコードを壊さないことの担保（更新経路でも §8 が効く）。
    #[test]
    fn jewels_combo_update_with_control_chars_is_rejected_and_leaves_row_intact() {
        let conn = test_conn();
        record_comment(&conn, jewels_dto(30.0, None), "sess-1".to_string()).unwrap();

        let mut bad = jewels_dto(90.0, Some(3));
        bad.text = "combo!\nsecond line".to_string();
        assert_eq!(
            record_comment(&conn, bad, "sess-1".to_string()).unwrap_err().code,
            ErrorCode::ValidationError
        );

        let detail = get(&conn, "youtube:u1").unwrap();
        assert_eq!(detail.comments[0].amount, Some(30.0), "拒否された更新は金額も反映しない");
        assert_eq!(detail.comments[0].text, "", "本文も元のまま");
    }

    // 043e: combo 更新の本文は trim される（挿入経路と同じ整形が更新経路にも効く）。
    #[test]
    fn jewels_combo_update_trims_text() {
        let conn = test_conn();
        record_comment(&conn, jewels_dto(30.0, None), "sess-1".to_string()).unwrap();
        let mut d = jewels_dto(90.0, Some(3));
        d.text = "  combo!  ".to_string();
        record_comment(&conn, d, "sess-1".to_string()).unwrap();
        assert_eq!(get(&conn, "youtube:u1").unwrap().comments[0].text, "combo!");
    }

    // 043e: プライバシー手段の非退行。combo 更新を経た jewels 行も delete（FK CASCADE）で取り残しなく消える
    //   （security.md「削除手段は新テーブル・新列ゼロのため取り残しゼロで有効」の担保）。
    #[test]
    fn deleting_viewer_removes_combo_updated_jewels_comment() {
        let conn = test_conn();
        record_comment(&conn, jewels_dto(30.0, None), "sess-1".to_string()).unwrap();
        record_comment(&conn, jewels_dto(90.0, Some(3)), "sess-1".to_string()).unwrap();
        delete(&conn, "youtube:u1").unwrap();

        assert_eq!(get(&conn, "youtube:u1").unwrap_err().code, ErrorCode::NotFound);
        let remaining: i64 = conn
            .query_row("SELECT COUNT(*) FROM viewer_comments", [], |r| r.get(0))
            .unwrap();
        assert_eq!(remaining, 0, "combo 更新済みのコメントも CASCADE で消える");
    }

    // P8d/P9: 不在 id は get / update_note / delete いずれも not_found。
    #[test]
    fn absent_id_is_not_found() {
        let conn = test_conn();
        assert_eq!(get(&conn, "nope").unwrap_err().code, ErrorCode::NotFound);
        assert_eq!(
            update_note(&conn, "nope", "x".to_string()).unwrap_err().code,
            ErrorCode::NotFound
        );
        assert_eq!(delete(&conn, "nope").unwrap_err().code, ErrorCode::NotFound);
    }
}
