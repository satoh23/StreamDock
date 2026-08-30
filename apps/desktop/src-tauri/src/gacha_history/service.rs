//! 063h: ガチャ抽選記録の検証と保存。
//!
//! ⚠⚠ **検証はここが唯一の持ち主である**（docs/security.md §8＝frontend の生値を信用しない）。
//! `record_gacha_draw` はアプリ定義コマンド＝**ACL を通らず全窓から呼べる**ので、
//! 値が発火レーン由来である保証は無い。

use rusqlite::Connection;

use crate::error::AppResult;
use crate::util::{now_rfc3339, reject_control_chars, require_non_empty, require_rfc3339};

use super::model::NewGachaDraw;
use super::repository;

/// 表示名・ガチャ名・景品名の文字数上限（⚠ **`chars().count()`＝Unicode スカラー単位。バイト数ではない**）。
///
/// ## ⚠⚠ なぜ 200 なのか（frontend の上限を書き写していない理由）
///
/// frontend 側の業務ルールは **ガチャ名 24 文字**（`GACHA_NAME_MAX_LENGTH`）・
/// **景品名 24 文字**（`GACHA_PRIZE_NAME_MAX_LENGTH`）だが、⚠⚠⚠ **それをここへ書き写さない**:
///
/// 1. **`prize_label` は 24 文字に収まらない。** `gachaPrizeLabel` のフォールバックは
///    景品名 → **OBS のソース名**（`OBS_SOURCE_NAME_MAX_LENGTH` ＝ **200**）→ 「当たり」なので、
///    24 で締めると**名前を付けていない OBS ソースの当選が丸ごと記録されなくなる**。
/// 2. **記録は fire-and-forget である。** ここで弾いた抽選は**画面のどこにも出ずに消える**
///    （`recordComments` と同じ best-effort）。⇒ frontend の業務ルールを 2 通り目として書くと、
///    **あちらの上限を緩めた瞬間に、記録だけが静かに落ちる**。
/// 3. §8 がここに求めているのは**保存量の上限**であって、業務ルールの再実装ではない
///    （`record_comment` は表示名に上限すら持たず、trim ＋制御文字拒否だけで通している）。
///
/// ⇒ **3 つの名前に共通の「短いテキストの上限」**として 200 を採る
/// （`viewer_memory::csv_import` の `MAX_SHORT_TEXT_CHARS` と同じ値・同じ意味）。
/// ⚠ **再修正トリガー＝ `OBS_SOURCE_NAME_MAX_LENGTH` を 200 より大きくしたとき**（そのときここも上げる）。
///
/// ## ⚠⚠⚠ 063h レビュー: **frontend と「同じ 200」だが、数える単位が違う**（いまは安全な向き）
///
/// frontend の `isEffectObsSourceName` は **UTF-16 コード単位**（`String.prototype.length`）で 200、
/// ここは **Unicode スカラー**（`chars().count()`）で 200 である。
/// ⚠ `chars().count() <= .length` が常に成り立つ（サロゲートペアは 2 コード単位・1 スカラー）ので、
/// **frontend の検査を通った OBS ソース名は必ずここも通る**——
/// ⇒ 「絵文字入りのソース名の当選だけが、fire-and-forget で静かに記録されない」は**起きない**。
/// ⚠⚠ **これは偶然ではなく、不等号がこの向きだから成立している。**
/// ⚠⚠⚠ **再修正トリガー＝ frontend 側をコードポイント数（`[...s].length` 等）へ変えたとき。**
///   その瞬間に不等号が消えて「向こうは通るがここで落ちる」窓が開くので、
///   **ここを 200 より大きくするか、frontend を UTF-16 のまま据え置くこと。**
const MAX_GACHA_TEXT_CHARS: usize = 200;

/// 文字数上限の検査（⚠ **バイト数で数えないこと**＝062b の穴 I）。
fn require_within_limit(value: &str, message: impl Into<String>) -> AppResult<()> {
    if value.chars().count() > MAX_GACHA_TEXT_CHARS {
        return Err(crate::error::AppError::validation(message));
    }
    Ok(())
}

/// 抽選 1 回を記録する（⚠ **同じ id の二重記録では行が増えない**＝`INSERT OR IGNORE`）。
///
/// ⚠⚠ **戻り値を `()` にしてある**（挿入されたかどうかを frontend へ返さない）。
/// 返すと「その記録は既にあるか」を**全窓から問い合わせられる**ことになり、§3 の最小権限に反する。
pub fn record(conn: &Connection, draw: NewGachaDraw) -> AppResult<()> {
    // ---- 安定キー: 必須・制御文字拒否（⚠ trim して保存する） ----
    let id = draw.id.trim().to_string();
    require_non_empty(&id, "記録IDは必須です")?;
    reject_control_chars(&id, "記録IDに制御文字は使用できません")?;

    let session_id = draw.session_id.trim().to_string();
    require_non_empty(&session_id, "セッションIDは必須です")?;
    reject_control_chars(&session_id, "セッションIDに制御文字は使用できません")?;

    let viewer_id = draw.viewer_id.trim().to_string();
    require_non_empty(&viewer_id, "視聴者IDは必須です")?;
    reject_control_chars(&viewer_id, "視聴者IDに制御文字は使用できません")?;

    let gacha_id = draw.gacha_id.trim().to_string();
    require_non_empty(&gacha_id, "ガチャIDは必須です")?;
    reject_control_chars(&gacha_id, "ガチャIDに制御文字は使用できません")?;

    // ---- 表示テキスト: trim ＋ 制御文字拒否 ＋ 文字数上限 ----
    // ⚠ **表示名は空を許す**（provider によっては取れない＝`record_comment` の `name` と同じ扱い）。
    let viewer_name = draw.viewer_name.trim().to_string();
    reject_control_chars(&viewer_name, "視聴者名に制御文字は使用できません")?;
    require_within_limit(&viewer_name, "視聴者名が長すぎます")?;

    let gacha_name = draw.gacha_name.trim().to_string();
    reject_control_chars(&gacha_name, "ガチャ名に制御文字は使用できません")?;
    require_within_limit(&gacha_name, "ガチャ名が長すぎます")?;

    // ⚠⚠⚠ **`prize_label` は「空文字」と「NULL」を区別する。**
    //   trim の結果が空になったものは **NULL へ倒す**——空文字で保存すると 063i が
    //   「何も出なかった抽選」と「名前が空の当たり」を区別できなくなる。
    //   ⚠ 「何も出ない」という文字列をここで作らないこと（`mod.rs` の注記が正）。
    let prize_label = match draw.prize_label {
        Some(raw) => {
            let trimmed = raw.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                reject_control_chars(&trimmed, "景品名に制御文字は使用できません")?;
                require_within_limit(&trimmed, "景品名が長すぎます")?;
                Some(trimmed)
            }
        }
        None => None,
    };

    // ---- 時刻: RFC3339 としてパースできること（⚠ frontend が作った値・§8） ----
    let drawn_at = draw.drawn_at.trim().to_string();
    require_non_empty(&drawn_at, "抽選日時は必須です")?;
    require_rfc3339(&drawn_at, "抽選日時の形式が不正です")?;

    let validated = NewGachaDraw {
        id,
        session_id,
        viewer_id,
        viewer_name,
        gacha_id,
        gacha_name,
        prize_label,
        rare: draw.rare,
        drawn_at,
    };
    repository::insert(conn, &validated, &now_rfc3339())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::ErrorCode;

    fn test_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute("PRAGMA foreign_keys = ON", []).unwrap();
        repository::init(&conn).unwrap();
        conn
    }

    fn valid() -> NewGachaDraw {
        NewGachaDraw {
            id: "c1:g:1:0".to_string(),
            session_id: "s1".to_string(),
            viewer_id: "twitch:1".to_string(),
            viewer_name: "アリス".to_string(),
            gacha_id: "g:1".to_string(),
            gacha_name: "朝ガチャ".to_string(),
            prize_label: Some("色紙".to_string()),
            rare: true,
            drawn_at: "2026-08-30T12:00:00Z".to_string(),
        }
    }

    fn stored_prize_label(conn: &Connection, id: &str) -> Option<String> {
        conn.query_row(
            "SELECT prize_label FROM gacha_draws WHERE id = ?1",
            rusqlite::params![id],
            |r| r.get(0),
        )
        .unwrap()
    }

    #[test]
    fn a_valid_draw_is_recorded() {
        let conn = test_conn();
        record(&conn, valid()).unwrap();
        assert_eq!(
            stored_prize_label(&conn, "c1:g:1:0").as_deref(),
            Some("色紙")
        );
    }

    /// ⚠⚠ 安定キーの 4 つは空でも制御文字入りでも通らないこと。
    #[test]
    fn stable_keys_must_be_non_empty_and_free_of_control_chars() {
        let conn = test_conn();
        let cases: Vec<(&str, Box<dyn Fn(&mut NewGachaDraw)>)> = vec![
            ("id 空", Box::new(|d: &mut NewGachaDraw| d.id = "  ".into())),
            (
                "id 制御",
                Box::new(|d: &mut NewGachaDraw| d.id = "a\nb".into()),
            ),
            (
                "session 空",
                Box::new(|d: &mut NewGachaDraw| d.session_id = "".into()),
            ),
            (
                "session 制御",
                Box::new(|d: &mut NewGachaDraw| d.session_id = "s\u{0}1".into()),
            ),
            (
                "viewer 空",
                Box::new(|d: &mut NewGachaDraw| d.viewer_id = "".into()),
            ),
            (
                "viewer 制御",
                Box::new(|d: &mut NewGachaDraw| d.viewer_id = "t\r1".into()),
            ),
            (
                "gacha 空",
                Box::new(|d: &mut NewGachaDraw| d.gacha_id = "".into()),
            ),
            (
                "gacha 制御",
                Box::new(|d: &mut NewGachaDraw| d.gacha_id = "g\n1".into()),
            ),
        ];
        for (label, mutate) in cases {
            let mut d = valid();
            mutate(&mut d);
            let err = record(&conn, d).unwrap_err();
            assert_eq!(err.code, ErrorCode::ValidationError, "{label} を通した");
        }
    }

    /// ⚠⚠⚠ **空文字の景品名は NULL へ倒す**（「名前が空の当たり」と「何も出なかった抽選」を
    /// 区別できなくしないため）。⚠ frontend は `gachaPrizeLabel` を通すので通常ここは来ないが、
    /// ACL を通らないコマンドなので Rust 側で必ず倒す。
    #[test]
    fn an_empty_prize_label_is_stored_as_null() {
        let conn = test_conn();
        let mut d = valid();
        d.prize_label = Some("   ".to_string());
        record(&conn, d).unwrap();
        assert_eq!(stored_prize_label(&conn, "c1:g:1:0"), None);
    }

    #[test]
    fn a_draw_that_won_nothing_is_stored_as_null() {
        let conn = test_conn();
        let mut d = valid();
        d.prize_label = None;
        record(&conn, d).unwrap();
        assert_eq!(stored_prize_label(&conn, "c1:g:1:0"), None);
    }

    /// ⚠ 表示名は**空を許す**（provider によっては取れない）。
    #[test]
    fn an_empty_viewer_name_is_allowed() {
        let conn = test_conn();
        let mut d = valid();
        d.viewer_name = "".to_string();
        record(&conn, d).unwrap();
    }

    /// ⚠⚠ 上限は**文字数**で数える（バイト数ではない＝062b 穴 I）。
    /// 日本語 200 文字はバイト数だと 600 なので、`len()` で数える実装ならここで落ちる。
    #[test]
    fn limits_are_counted_in_characters_not_bytes() {
        let conn = test_conn();
        let mut at_limit = valid();
        at_limit.viewer_name = "あ".repeat(MAX_GACHA_TEXT_CHARS);
        record(&conn, at_limit).unwrap();

        let mut over = valid();
        over.id = "other".to_string();
        over.viewer_name = "あ".repeat(MAX_GACHA_TEXT_CHARS + 1);
        assert_eq!(
            record(&conn, over).unwrap_err().code,
            ErrorCode::ValidationError
        );
    }

    /// ⚠⚠ **景品名は 200 文字まで通ること**（OBS のソース名がフォールバックで入るため）。
    /// ⚠ 24 文字（frontend の景品名の上限）で締める実装に変えるとレッドになる。
    #[test]
    fn a_prize_label_as_long_as_an_obs_source_name_is_accepted() {
        let conn = test_conn();
        let mut d = valid();
        d.prize_label = Some("a".repeat(200));
        record(&conn, d).unwrap();
        assert_eq!(
            stored_prize_label(&conn, "c1:g:1:0").map(|s| s.chars().count()),
            Some(200)
        );
    }

    /// ⚠⚠⚠ **`drawn_at` は RFC3339 でなければ通らない**（frontend の生値を信用しない＝§8）。
    #[test]
    fn drawn_at_must_be_rfc3339() {
        let conn = test_conn();
        for bad in ["", "2026-08-30", "2026-08-30 12:00:00", "きのう"] {
            let mut d = valid();
            d.drawn_at = bad.to_string();
            assert_eq!(
                record(&conn, d).unwrap_err().code,
                ErrorCode::ValidationError,
                "不正な抽選日時を通した: {bad:?}"
            );
        }
    }

    /// ⚠ 同じ入力を 2 度記録しても行が増えないこと（穴 A・service 層から見た担保）。
    #[test]
    fn recording_the_same_draw_twice_does_not_add_a_row() {
        let conn = test_conn();
        record(&conn, valid()).unwrap();
        record(&conn, valid()).unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM gacha_draws", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }
}
