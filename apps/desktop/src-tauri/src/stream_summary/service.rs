//! 062c: 配信サマリーの検証・組み立て層。
//!
//! frontend の生値を信用せず、Rust 側で trim / 制御文字拒否を通してから repository に渡す
//! （docs/security.md §8）。エラーは既存 `AppError` 経由で、**セッション id を message に含めない**
//! （read-only なのでログには載らないが、入力をそのまま反射しない流儀を保つ。
//! 併せて本モジュールから `format!` が 1 つも無くなり、「SQL を組み立てていない」ことが grep で確認できる）。

use std::collections::BTreeMap;

use rusqlite::Connection;

use crate::error::{AppError, AppResult};
use crate::util::{reject_control_chars, require_non_empty};

use super::model::{Contributor, CurrencyTotal, MonetaryKindTotal, StreamSummary};
use super::repository;

/// セッション id の検証（§8）。`stream_session::service::validate_id` と同じ規律。
fn validate_id(id: &str) -> AppResult<String> {
    let id = id.trim().to_string();
    require_non_empty(&id, "セッションIDは必須です")?;
    reject_control_chars(&id, "セッションIDに制御文字は使用できません")?;
    Ok(id)
}

/// 貢献者の組み立て中の入れ物（通貨ごとの合計を通貨コード昇順で保つ）。
struct ContributorAcc {
    name: String,
    source: String,
    by_currency: BTreeMap<String, (f64, u32)>,
    subscription_count: u32,
    first_at: String,
}

impl ContributorAcc {
    /// より早い `first_at` を採る。
    ///
    /// ⚠ **文字列比較**である（穴 M）。`published_at` はプラットフォーム由来で、Twitch は `Z` 形式だが
    /// オフセット付き（`+09:00`）が混ざりうるため、混在すると前後が入れ替わることがある。
    /// 影響は**表示する時刻だけ**で合計金額はずれないため、ここに日時パースは持ち込まない
    /// （持ち込むと 062b が `comment_times` で下した判断のやり直しになる）。
    fn note_first_at(&mut self, candidate: &str) {
        if candidate < self.first_at.as_str() {
            self.first_at = candidate.to_string();
        }
    }
}

/// 1 回の配信ぶんの集計を返す（read-only・新規保存なし）。
///
/// ⚠⚠ **金額の 3 つ（`monetary_by_kind` / `monetary_by_currency` / `monetary_total_count`）は
/// `repository::monetary_by_kind` が返す 1 つの行集合からだけ導く。** 別々のクエリにすると
/// 「通貨ごとの count の合計 ≠ 総課金回数」がいつでも起こりうる（穴 C）。**ここを 3 本に割らないこと。**
pub fn get(conn: &Connection, session_id: &str) -> AppResult<StreamSummary> {
    let session_id = validate_id(session_id)?;

    // ⚠ 062b 以前の `session_id` には `stream_sessions` の対応行が無い（バックフィルしない＝
    //   セッションを捏造しないという 062b の決定）。その場合はここで NotFound になり、
    //   ⚠ 画面は説明文を出さない（2026-08-16 の決定）＝一覧に出ないという事実だけが見える。
    let session = crate::stream_session::repository::get(conn, &session_id)?
        .ok_or_else(|| AppError::not_found("配信が見つかりません"))?;

    let kind_rows = repository::monetary_by_kind(conn, &session_id)?;

    // 通貨ごとへロールアップ（BTreeMap＝通貨コード昇順で決定的）。
    let mut currency_acc: BTreeMap<String, (f64, u32)> = BTreeMap::new();
    let mut monetary_total_count: u32 = 0;
    for row in &kind_rows {
        let slot = currency_acc.entry(row.currency.clone()).or_insert((0.0, 0));
        slot.0 += row.amount;
        slot.1 = slot.1.saturating_add(row.count);
        monetary_total_count = monetary_total_count.saturating_add(row.count);
    }
    let monetary_by_currency: Vec<CurrencyTotal> = currency_acc
        .into_iter()
        .map(|(currency, (amount, count))| CurrencyTotal {
            currency,
            amount,
            count,
        })
        .collect();
    let monetary_by_kind: Vec<MonetaryKindTotal> = kind_rows
        .into_iter()
        .map(|row| MonetaryKindTotal {
            kind: row.kind,
            currency: row.currency,
            amount: row.amount,
            count: row.count,
        })
        .collect();

    Ok(StreamSummary {
        session,
        total_comments: repository::total_comments(conn, &session_id)?,
        monetary_total_count,
        monetary_by_currency,
        monetary_by_kind,
        jewels_count: repository::jewels_count(conn, &session_id)?,
        subscription_count: repository::subscription_count(conn, &session_id)?,
        contributors: build_contributors(conn, &session_id)?,
        raids: repository::raids(conn, &session_id)?,
    })
}

/// 貢献者一覧を組み立てる（課金の行とサブスクの行をマージし、金額降順で並べる）。
///
/// ⚠⚠ **論点 4: 「課金・サブスクがある人だけ」の絞り込みは、後付けの filter ではなく
/// 2 本のクエリの述語そのもの**である。レイドしかしていない配信者・チャットだけの視聴者は
/// そもそもこのマップに入らないので、うっかり絞り込みが外れることがない。
fn build_contributors(conn: &Connection, session_id: &str) -> AppResult<Vec<Contributor>> {
    let mut acc: BTreeMap<String, ContributorAcc> = BTreeMap::new();

    for row in repository::contributor_money(conn, session_id)? {
        let entry = acc.entry(row.viewer_id).or_insert_with(|| ContributorAcc {
            name: row.name,
            source: row.source,
            by_currency: BTreeMap::new(),
            subscription_count: 0,
            first_at: row.first_at.clone(),
        });
        let slot = entry.by_currency.entry(row.currency).or_insert((0.0, 0));
        slot.0 += row.amount;
        slot.1 = slot.1.saturating_add(row.count);
        entry.note_first_at(&row.first_at);
    }

    for row in repository::contributor_subscriptions(conn, session_id)? {
        let entry = acc.entry(row.viewer_id).or_insert_with(|| ContributorAcc {
            name: row.name,
            source: row.source,
            by_currency: BTreeMap::new(),
            subscription_count: 0,
            first_at: row.first_at.clone(),
        });
        entry.subscription_count = entry.subscription_count.saturating_add(row.count);
        entry.note_first_at(&row.first_at);
    }

    let mut contributors: Vec<Contributor> = acc
        .into_iter()
        .map(|(viewer_id, a)| Contributor {
            viewer_id,
            name: a.name,
            source: a.source,
            monetary_by_currency: a
                .by_currency
                .into_iter()
                .map(|(currency, (amount, count))| CurrencyTotal {
                    currency,
                    amount,
                    count,
                })
                .collect(),
            subscription_count: a.subscription_count,
            first_at: a.first_at,
        })
        .collect();

    sort_contributors(&mut contributors);
    Ok(contributors)
}

/// 貢献者を「金額降順」で並べる。
///
/// ## ⚠⚠ 穴 L: 「金額降順」は**通貨をまたぐと定義できない**
///
/// 親 062 (2) が「換算しない」と決めている以上、`JPY 3,000` と `USD 50` と `BITS 500` の大小は
/// **原理的に決められない**（換算レートは外部通信＝§1 違反か、固定レート＝すぐ古くなるかのどちらか）。
/// ⇒ 第 1 キーは**通貨をまたいだ単純合計**にする。これは順位付けのためだけに使う内部値で、
/// **画面には一切出さない**（出すと「通貨を混ぜない」という表示の約束を破る）。
/// ⚠⚠ **2026-08-16 の決定で、この近似は画面に書いていない**（説明文の全廃）。
/// ＝**複数通貨が混ざった配信では順位が実際の金額の大小と一致しないことが、ユーザーには見えない。**
/// 単一通貨（日本語圏の通常運用）では正確なので受容している。伝える必要が出たら文章ではなく
/// 構造（例: 通貨ごとにタブや列を分けて、その中で並べる）で解くこと。
///
/// 第 2 キー以降は**同点でも並びが揺れない**ように決定的にする（サブスク件数の多い順 → 早い順 → id 順）。
/// ⚠ `sort_by` は安定ソートだが、入力が `BTreeMap`（viewer_id 昇順）なので最終的な順序は完全に決まる。
fn sort_contributors(contributors: &mut [Contributor]) {
    contributors.sort_by(|a, b| {
        let a_total: f64 = a.monetary_by_currency.iter().map(|c| c.amount).sum();
        let b_total: f64 = b.monetary_by_currency.iter().map(|c| c.amount).sum();
        b_total
            // NaN は現実には来ない（SUM の入力は REAL 列）が、来ても panic させない。
            // ⚠ このフォールバックと上の `saturating_add` は**テストで固定していない**（レビュー Q-4）。
            //   到達させるには DB に NaN / u32 を溢れさせる件数を仕込む必要があり、
            //   本番の投入経路（`record_comment`）からは作れない。**防御的な保険**として置いている。
            .partial_cmp(&a_total)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| b.subscription_count.cmp(&a.subscription_count))
            .then_with(|| a.first_at.cmp(&b.first_at))
            .then_with(|| a.viewer_id.cmp(&b.viewer_id))
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::ErrorCode;
    use crate::viewer_memory::model::NewViewerComment;

    fn test_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute("PRAGMA foreign_keys = ON", []).unwrap();
        crate::viewer_memory::repository::init(&conn).unwrap();
        crate::stream_session::repository::init(&conn).unwrap();
        conn
    }

    /// 進行中の配信セッションを 1 本作る（`ended_at IS NULL`＝配信中）。
    fn start_session(conn: &Connection, id: &str, at: &str) {
        crate::stream_session::repository::start(conn, id, &["twitch".to_string()], at).unwrap();
    }

    struct Row<'a> {
        id: &'a str,
        session: &'a str,
        viewer: &'a str,
        name: &'a str,
        event_type: &'a str,
        amount: Option<f64>,
        currency: Option<&'a str>,
        at: &'a str,
    }

    impl Default for Row<'_> {
        fn default() -> Self {
            Self {
                id: "c1",
                session: "s1",
                viewer: "twitch:u1",
                name: "Alice",
                event_type: "chat",
                amount: None,
                currency: None,
                at: "2026-08-16T10:00:00Z",
            }
        }
    }

    fn insert(conn: &Connection, r: Row<'_>) {
        crate::viewer_memory::repository::record_comment(
            conn,
            &NewViewerComment {
                comment_id: r.id.to_string(),
                viewer_id: r.viewer.to_string(),
                session_id: r.session.to_string(),
                provider: "twitch".to_string(),
                provider_user_id: r.viewer.to_string(),
                name: r.name.to_string(),
                source: "twitch".to_string(),
                text: String::new(),
                event_type: r.event_type.to_string(),
                amount: r.amount,
                currency: r.currency.map(str::to_string),
                monetary_amount: None,
                raid_viewer_count: None,
                published_at: r.at.to_string(),
            },
        )
        .unwrap();
    }

    // ⚠⚠ 穴 C: 通貨ごとの count を足すと総課金回数になる（画面で足し算が合う）。
    #[test]
    fn monetary_total_count_equals_the_sum_of_per_currency_counts() {
        let conn = test_conn();
        start_session(&conn, "s1", "2026-08-16T09:00:00+00:00");
        insert(&conn, Row { id: "c1", event_type: "superchat", amount: Some(1000.0), currency: Some("JPY"), ..Default::default() });
        insert(&conn, Row { id: "c2", event_type: "donation", amount: Some(500.0), currency: Some("JPY"), at: "2026-08-16T10:01:00Z", ..Default::default() });
        insert(&conn, Row { id: "c3", event_type: "superchat", amount: Some(20.0), currency: Some("USD"), at: "2026-08-16T10:02:00Z", ..Default::default() });
        insert(&conn, Row { id: "c4", event_type: "superchat", amount: Some(300.0), currency: Some("BITS"), at: "2026-08-16T10:03:00Z", ..Default::default() });
        // jewels は母集合の外（回数にも入らない）。
        insert(&conn, Row { id: "c5", event_type: "jewels", amount: Some(30.0), currency: Some("JEWELS"), at: "2026-08-16T10:04:00Z", ..Default::default() });

        let s = get(&conn, "s1").unwrap();
        let summed: u32 = s.monetary_by_currency.iter().map(|c| c.count).sum();
        assert_eq!(s.monetary_total_count, summed);
        assert_eq!(s.monetary_total_count, 4);
        assert_eq!(s.jewels_count, 1, "Jewels は別枠の回数として出す");
    }

    // 内訳（種別 × 通貨）を通貨で畳むと通貨ごとの合計になる（両者が別クエリに割れていないことの担保）。
    #[test]
    fn monetary_by_currency_is_the_rollup_of_monetary_by_kind() {
        let conn = test_conn();
        start_session(&conn, "s1", "2026-08-16T09:00:00+00:00");
        insert(&conn, Row { id: "c1", event_type: "superchat", amount: Some(1000.0), currency: Some("JPY"), ..Default::default() });
        insert(&conn, Row { id: "c2", event_type: "donation", amount: Some(500.0), currency: Some("JPY"), at: "2026-08-16T10:01:00Z", ..Default::default() });
        insert(&conn, Row { id: "c3", event_type: "superchat", amount: Some(300.0), currency: Some("BITS"), at: "2026-08-16T10:02:00Z", ..Default::default() });

        let s = get(&conn, "s1").unwrap();
        for c in &s.monetary_by_currency {
            let (amount, count) = s
                .monetary_by_kind
                .iter()
                .filter(|k| k.currency == c.currency)
                .fold((0.0, 0), |(a, n), k| (a + k.amount, n + k.count));
            assert_eq!((c.amount, c.count), (amount, count), "{} の内訳と合計が一致しない", c.currency);
        }
        // JPY はスパチャ 1000 ＋ ドネーション 500 で 1 行にまとまる（種別の内訳では 2 行）。
        let jpy = s.monetary_by_currency.iter().find(|c| c.currency == "JPY").unwrap();
        assert_eq!((jpy.amount, jpy.count), (1500.0, 2));
        assert_eq!(s.monetary_by_kind.iter().filter(|k| k.currency == "JPY").count(), 2);
        // BITS は kind が "bits" へ振り替わる。
        assert!(s.monetary_by_kind.iter().any(|k| k.kind == "bits" && k.currency == "BITS"));
    }

    // ⚠⚠ レビュー Q-4: `currency_acc` の `BTreeMap`（通貨コード昇順）を固定する。
    //   これが無いと `HashMap` / 挿入順マップへ替える変異が緑のまま通る（ロールアップ系のテストは
    //   filter+fold の集合演算なので順序を見ておらず、frontend はモックデータを描くだけ）。
    //   ⚠ **SQL の `ORDER BY kind ASC, currency ASC` と一致しないデータ**でなければ区別できない
    //   （kind 昇順 = bits < donation < superchat なので、通貨は BITS → USD → JPY の順で届く）。
    #[test]
    fn monetary_by_currency_is_sorted_by_currency_code() {
        let conn = test_conn();
        start_session(&conn, "s1", "2026-08-16T09:00:00+00:00");
        insert(&conn, Row { id: "c1", event_type: "superchat", amount: Some(500.0), currency: Some("BITS"), ..Default::default() });
        insert(&conn, Row { id: "c2", event_type: "donation", amount: Some(20.0), currency: Some("USD"), at: "2026-08-16T10:01:00Z", ..Default::default() });
        insert(&conn, Row { id: "c3", event_type: "superchat", amount: Some(1000.0), currency: Some("JPY"), at: "2026-08-16T10:02:00Z", ..Default::default() });

        let currencies: Vec<String> = get(&conn, "s1")
            .unwrap()
            .monetary_by_currency
            .into_iter()
            .map(|c| c.currency)
            .collect();
        assert_eq!(
            currencies,
            vec!["BITS".to_string(), "JPY".to_string(), "USD".to_string()],
            "通貨コード昇順で決定的に並ぶこと（SQL の kind 昇順＝BITS→USD→JPY をそのまま流していない）"
        );
    }

    // 貢献者は金額降順。⚠ 並び順の定義（通貨をまたいだ単純合計）は `sort_contributors` の doc が正。
    #[test]
    fn contributors_are_sorted_by_amount_desc_with_deterministic_tiebreak() {
        let conn = test_conn();
        start_session(&conn, "s1", "2026-08-16T09:00:00+00:00");
        insert(&conn, Row { id: "c1", viewer: "twitch:small", name: "Small", event_type: "superchat", amount: Some(100.0), currency: Some("JPY"), ..Default::default() });
        insert(&conn, Row { id: "c2", viewer: "twitch:big", name: "Big", event_type: "superchat", amount: Some(9000.0), currency: Some("JPY"), at: "2026-08-16T10:01:00Z", ..Default::default() });
        insert(&conn, Row { id: "c3", viewer: "twitch:mid", name: "Mid", event_type: "superchat", amount: Some(1000.0), currency: Some("JPY"), at: "2026-08-16T10:02:00Z", ..Default::default() });
        // 同額（100 JPY）だがサブスクもしている人は Small より上（第 2 キー）。
        insert(&conn, Row { id: "c4", viewer: "twitch:tie", name: "Tie", event_type: "superchat", amount: Some(100.0), currency: Some("JPY"), at: "2026-08-16T10:03:00Z", ..Default::default() });
        insert(&conn, Row { id: "c5", viewer: "twitch:tie", name: "Tie", event_type: "subscription", at: "2026-08-16T10:04:00Z", ..Default::default() });

        let names: Vec<String> = get(&conn, "s1").unwrap().contributors.into_iter().map(|c| c.name).collect();
        assert_eq!(names, vec!["Big".to_string(), "Mid".to_string(), "Tie".to_string(), "Small".to_string()]);
    }

    // サブスクだけの人も貢献者に出る（金額 0 で最下位側だが、一覧から消えない）。
    #[test]
    fn contributors_include_subscription_only_viewers() {
        let conn = test_conn();
        start_session(&conn, "s1", "2026-08-16T09:00:00+00:00");
        insert(&conn, Row { id: "c1", viewer: "twitch:sub", name: "SubOnly", event_type: "subscription", ..Default::default() });
        insert(&conn, Row { id: "c2", viewer: "twitch:sc", name: "Superchat", event_type: "superchat", amount: Some(100.0), currency: Some("JPY"), at: "2026-08-16T10:01:00Z", ..Default::default() });

        let contributors = get(&conn, "s1").unwrap().contributors;
        let sub = contributors.iter().find(|c| c.name == "SubOnly").unwrap();
        assert_eq!(sub.subscription_count, 1);
        assert!(sub.monetary_by_currency.is_empty());
        assert_eq!(contributors[0].name, "Superchat", "金額のある人が上");
    }

    // 貢献者の金額の合計＝セッションの通貨ごとの合計（2 本のクエリの述語がドリフトしたら落ちる）。
    #[test]
    fn contributor_amounts_roll_up_to_the_session_totals() {
        let conn = test_conn();
        start_session(&conn, "s1", "2026-08-16T09:00:00+00:00");
        insert(&conn, Row { id: "c1", viewer: "twitch:a", name: "A", event_type: "superchat", amount: Some(1000.0), currency: Some("JPY"), ..Default::default() });
        insert(&conn, Row { id: "c2", viewer: "twitch:b", name: "B", event_type: "donation", amount: Some(500.0), currency: Some("JPY"), at: "2026-08-16T10:01:00Z", ..Default::default() });
        insert(&conn, Row { id: "c3", viewer: "twitch:a", name: "A", event_type: "superchat", amount: Some(200.0), currency: Some("BITS"), at: "2026-08-16T10:02:00Z", ..Default::default() });

        let s = get(&conn, "s1").unwrap();
        for total in &s.monetary_by_currency {
            let (amount, count) = s
                .contributors
                .iter()
                .flat_map(|c| c.monetary_by_currency.iter())
                .filter(|c| c.currency == total.currency)
                .fold((0.0, 0), |(a, n), c| (a + c.amount, n + c.count));
            assert_eq!((total.amount, total.count), (amount, count), "{} が貢献者の合計と一致しない", total.currency);
        }
    }

    // 貢献者の first_at は「この配信で最初に課金 or サブスクした時刻」。
    #[test]
    fn contributor_first_at_is_the_earliest_of_money_and_subscription() {
        let conn = test_conn();
        start_session(&conn, "s1", "2026-08-16T09:00:00+00:00");
        insert(&conn, Row { id: "c1", event_type: "subscription", at: "2026-08-16T10:00:00Z", ..Default::default() });
        insert(&conn, Row { id: "c2", event_type: "superchat", amount: Some(100.0), currency: Some("JPY"), at: "2026-08-16T11:00:00Z", ..Default::default() });

        let c = &get(&conn, "s1").unwrap().contributors[0];
        assert_eq!(c.first_at, "2026-08-16T10:00:00Z");
    }

    // 配信中（ended_at が無い）セッションもそのまま集計できる（判定は ended_at IS NULL のみ＝申し送り 7）。
    #[test]
    fn a_running_session_is_returned_with_no_ended_at() {
        let conn = test_conn();
        start_session(&conn, "s1", "2026-08-16T09:00:00+00:00");
        insert(&conn, Row { id: "c1", event_type: "chat", ..Default::default() });

        let s = get(&conn, "s1").unwrap();
        assert_eq!(s.session.id, "s1");
        assert!(s.session.ended_at.is_none(), "進行中は ended_at が無い");
        assert_eq!(s.total_comments, 1);
    }

    // ⚠ 062b 以前の session_id（stream_sessions に対応行が無い）は NotFound。バックフィルしない。
    #[test]
    fn unknown_session_id_is_not_found() {
        let conn = test_conn();
        assert_eq!(get(&conn, "nope").unwrap_err().code, ErrorCode::NotFound);
    }

    #[test]
    fn empty_session_id_is_a_validation_error() {
        let conn = test_conn();
        assert_eq!(get(&conn, "   ").unwrap_err().code, ErrorCode::ValidationError);
    }

    // ⚠ 前後の空白は `trim()` が落とすので、弾かれるのは**内側**の制御文字である
    //   （`"s1\n"` は `"s1"` に正規化されて通る＝`stream_session::service::validate_id` と同じ挙動）。
    #[test]
    fn control_chars_inside_the_session_id_are_rejected() {
        let conn = test_conn();
        assert_eq!(get(&conn, "s\n1").unwrap_err().code, ErrorCode::ValidationError);
    }

    // 前後の空白は落として引く（frontend が空白付きで渡しても同じ配信を引ける）。
    #[test]
    fn the_session_id_is_trimmed_before_lookup() {
        let conn = test_conn();
        start_session(&conn, "s1", "2026-08-16T09:00:00+00:00");
        assert_eq!(get(&conn, "  s1  ").unwrap().session.id, "s1");
    }

    // 1 件も無い配信でも壊れない（全部 0 と空配列）。
    #[test]
    fn an_empty_session_summarises_to_zeros() {
        let conn = test_conn();
        start_session(&conn, "s1", "2026-08-16T09:00:00+00:00");

        let s = get(&conn, "s1").unwrap();
        assert_eq!(s.total_comments, 0);
        assert_eq!(s.monetary_total_count, 0);
        assert_eq!(s.jewels_count, 0);
        assert_eq!(s.subscription_count, 0);
        assert!(s.monetary_by_currency.is_empty());
        assert!(s.monetary_by_kind.is_empty());
        assert!(s.contributors.is_empty());
        assert!(s.raids.is_empty());
    }
}
