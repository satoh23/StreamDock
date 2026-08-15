//! 062c: 配信サマリーの SQL 層（`viewer_comments` を `session_id` で集計する **read-only**）。
//!
//! ⚠⚠ **このモジュールはテーブルを作らない**（`init()` が無いのは意図・詳細は `mod.rs`）。
//! 集計結果をキャッシュテーブルに保存すると docs/security.md §9 の判断がやり直しになる。
//!
//! ## §8（識別子は定数・値はバインド）をどう守っているか
//!
//! - SQL は**すべて完全な文字列リテラル**で、`format!` を 1 つも使っていない
//!   （`viewer_memory` / `stream_session` は `SELECT {COLUMNS}` の連結に `format!` を使うが、
//!   ここは連結する必要が無いので**そもそも組み立てない**形にした＝`grep format!` で 0 件になる）。
//! - `session_id` は**必ず `?1` でバインド**する。⚠ どの関数にも例外を作らないこと
//!   （`another_session_data_is_not_mixed_in` が固定する）。
//!
//! ## ⚠⚠ 母集合の定義（**ここが 062c の意味論の中心**）
//!
//! ```text
//! <課金>     = amount IS NOT NULL AND currency IS NOT NULL AND currency <> 'JEWELS'
//! <サブスク>  = event_type IN ('subscription', 'membership', 'gift')
//! <コメント>  = event_type <> 'raid'
//! kind       = CASE WHEN currency = 'BITS' THEN 'bits' ELSE event_type END
//! ```
//!
//! ### ⚠ なぜ `<課金>` を「金額があるところ」で引くのか（allow-list にしない理由）
//!
//! `event_type IN ('superchat','donation')` の allow-list にすると、**種別を書き忘れたときに黙って落ちる**
//! （落ちたことが誰にも見えない）。「お金は `amount` と `currency` があるところにある」で引けば、
//! 新しい課金種別が増えても**自動的に総額へ入る**。これは既存の `RECOMPUTE_VIEWER_AGGREGATES_SQL` が
//! bits を `currency = 'BITS'` だけで引いている（`event_type` を見ていない）のと同じ考え方である。
//!
//! ⚠ **`donation` が自動的に入るのは既定の挙動**であり、訂正 2 (A)〔含める〕と一致する。
//! 「含めない」ほうが**明示的な除外を要する**側だと理解しておくこと。
//!
//! ### ⚠⚠ なぜ二重計上にならないのか（**将来ここが破れるので必ず読むこと**）
//!
//! `subscription` / `membership` / `gift` は現在 `amount` / `currency` を**どちらも持たない**
//! （Twitch のサブに金額は来ない＝043a の取り込み仕様）ので、`<課金>` に一致せず
//! `subscription_count` と重ならない。
//! ⚠ **これは「今そうである」という性質に寄りかかっている。** 将来ギフトに金額が付いたら、その行は
//! `<課金>` にも `<サブスク>` にも入る。ただしそれは **「金額」と「件数」という別々の指標に同じ行が
//! 入るだけ**で、同じ数字の二重計上ではない（金額としては正しく合算されるべき）。
//! ⚠ **ただし画面で「総課金回数」と「サブスク件数」を足し算して見せてはいけない**——そこは重複する。
//! 【再修正トリガー】`amount` を持つ `subscription`/`membership`/`gift` 行が保存されるようになり、かつ
//! 「サブスクの金額は総額に入れたくない」要件が出たら、`<課金>` に `event_type NOT IN (...)` を足す。
//!
//! ### ⚠ bits に `event_type` 条件を**足さない**こと（穴 E）
//!
//! `RECOMPUTE_VIEWER_AGGREGATES_SQL` の `bits_count` / `bits_amount` は **`currency = 'BITS'` だけ**で
//! 引いており、`event_type` を見ていない。`<課金>` も同じく `event_type` を見ないので**分類が一致する**。
//! ⚠ ここに `AND event_type = 'superchat'` を足すと、将来 BITS 通貨が別の種別で届いたときに
//! **視聴者一覧にだけ入ってサマリーから消える**（数字がずれる）。
//! **これは「書き忘れ」ではなく、既存の分類に揃えた結果である。**
//! `bits_classification_matches_the_viewer_list_and_ignores_event_type` が固定する。
//!
//! ⚠⚠ **ただし「完全一致」は外部の性質に寄りかかっている**（穴 D と同じ種類の依存・レビュー指摘 Q-3a）。
//! 述語そのものは一致していない——`<課金>` は `amount IS NOT NULL` を含むが、`bits_count` は
//! `currency = 'BITS'` だけである。両者が一致するのは `viewer_memory::service::record_comment` が
//! `comment.monetary` から **`amount` と `currency` を必ずペアで**入れる（両方 `Some` か両方 `None`）ため。
//! 【再修正トリガー】**片方だけ NULL の行が保存されるようになったら**（例: 金額不明の課金イベントを
//! 通貨だけ付けて保存する）、その行は `viewers.bits_count` に入るのにサマリーからは消える。
//! そのときは `<課金>` の `amount IS NOT NULL` を見直すか、既存集計側と足並みを揃えること。
//!
//! ### ⚠ jewels の除外は「通貨側」、件数は「種別側」で引いている（非対称は意図）
//!
//! 除外を `currency <> 'JEWELS'` に置いたのは、論点 3 の要求が
//! 「**`monetary_by_currency` に `JEWELS` が現れないこと**」そのものだから。
//! `event_type <> 'jewels'` にすると、将来 `JEWELS` 通貨が別種別で届いたときに**黙って実通貨の隣に並ぶ**。
//! 一方 `jewels_count` は「Jewels ギフトの回数」なので `event_type = 'jewels'` で引く。
//! 043e は両方を必ずセットで保存するので、現状この 2 つは同じ集合を指す。
//!
//! ### ⚠ `published_at` の比較は**文字列比較**である（穴 M・062b が警告した当のもの）
//!
//! `stream_session::repository::comment_times` の doc が
//! 「`MAX(published_at)` を SQL で取らないこと（Twitch は `Z` 形式・オフセット付きが混ざりうる）」と
//! 明記しているとおり、`MIN(published_at)` / `ORDER BY published_at` は**単なる文字列比較**である。
//! ⚠ ただし影響は 062b と違い**表示順と表示時刻だけ**で、合計金額はずれない（あちらは「配信を閉じるか」の
//! 判断だった）。ここに日時パースを持ち込むのは 062b の判断のやり直しになるので**入れない**。
//! 【再修正トリガー】実データでレイドの並びや「初回課金時刻」が明らかに狂ったら、`comment_times` と同じく
//! Rust 側で `DateTime::parse_from_rfc3339` してから比較する。

use rusqlite::Connection;

use super::model::RaidRecord;

/// 総コメント数（⚠ **訂正 1 (A)**: レイドは数えない）。
const TOTAL_COMMENTS_SQL: &str = "SELECT COUNT(*) FROM viewer_comments \
     WHERE session_id = ?1 AND event_type <> 'raid'";

/// 課金の内訳（種別 × 通貨）。**サマリーの金額 3 種（内訳 / 通貨ごと / 総回数）はすべてこの 1 本から導く。**
///
/// ⚠ 別々のクエリにすると「通貨ごとの count の合計 ≠ 総課金回数」が起こりうる（穴 C）。
/// **1 本から導出することで構造的に起こり得なくしている。ここを 3 本に割らないこと。**
const MONETARY_BY_KIND_SQL: &str = "SELECT \
        CASE WHEN currency = 'BITS' THEN 'bits' ELSE event_type END AS kind, \
        currency AS currency, \
        COALESCE(SUM(amount), 0) AS amount, \
        COUNT(*) AS entry_count \
     FROM viewer_comments \
     WHERE session_id = ?1 \
       AND amount IS NOT NULL AND currency IS NOT NULL AND currency <> 'JEWELS' \
     GROUP BY kind, currency \
     ORDER BY kind ASC, currency ASC";

/// Jewels の回数（⚠ 金額は合算しない＝043e フェーズ 2 未了で単位が不明）。
const JEWELS_COUNT_SQL: &str = "SELECT COUNT(*) FROM viewer_comments \
     WHERE session_id = ?1 AND event_type = 'jewels'";

/// サブスク系の件数。⚠ **`RECOMPUTE_VIEWER_AGGREGATES_SQL` と 1 文字も違わない述語にすること**
/// （違わせると視聴者一覧と数字が合わなくなる）。
const SUBSCRIPTION_COUNT_SQL: &str = "SELECT COUNT(*) FROM viewer_comments \
     WHERE session_id = ?1 AND event_type IN ('subscription', 'membership', 'gift')";

/// 貢献者の課金（視聴者 × 通貨）。⚠ 述語は `MONETARY_BY_KIND_SQL` と**同じ**でなければならない
/// （`contributor_amounts_roll_up_to_the_session_totals` が両者のドリフトを検知する）。
///
/// ⚠ `viewers` の JOIN で使ってよいのは `name` / `provider` だけ（穴 A の線引き・`mod.rs` の表）。
const CONTRIBUTOR_MONEY_SQL: &str = "SELECT \
        c.viewer_id AS viewer_id, \
        v.name AS name, \
        v.provider AS provider, \
        c.currency AS currency, \
        COALESCE(SUM(c.amount), 0) AS amount, \
        COUNT(*) AS entry_count, \
        MIN(c.published_at) AS first_at \
     FROM viewer_comments c \
     JOIN viewers v ON v.id = c.viewer_id \
     WHERE c.session_id = ?1 \
       AND c.amount IS NOT NULL AND c.currency IS NOT NULL AND c.currency <> 'JEWELS' \
     GROUP BY c.viewer_id, c.currency \
     ORDER BY c.viewer_id ASC, c.currency ASC";

/// 貢献者のサブスク系（視聴者ごと）。
const CONTRIBUTOR_SUBSCRIPTION_SQL: &str = "SELECT \
        c.viewer_id AS viewer_id, \
        v.name AS name, \
        v.provider AS provider, \
        COUNT(*) AS entry_count, \
        MIN(c.published_at) AS first_at \
     FROM viewer_comments c \
     JOIN viewers v ON v.id = c.viewer_id \
     WHERE c.session_id = ?1 \
       AND c.event_type IN ('subscription', 'membership', 'gift') \
     GROUP BY c.viewer_id \
     ORDER BY c.viewer_id ASC";

/// レイド一覧（⚠ 名前は `viewers` JOIN からしか取れない＝穴 A。レイド行の `text` は空文字列）。
const RAIDS_SQL: &str = "SELECT \
        v.name AS name, \
        c.raid_viewer_count AS viewer_count, \
        c.published_at AS at \
     FROM viewer_comments c \
     JOIN viewers v ON v.id = c.viewer_id \
     WHERE c.session_id = ?1 AND c.event_type = 'raid' \
     ORDER BY c.published_at DESC, c.id DESC";

/// 課金の内訳 1 行（種別 × 通貨）。
pub struct KindCurrencyRow {
    pub kind: String,
    pub currency: String,
    pub amount: f64,
    pub count: u32,
}

/// 貢献者の課金 1 行（視聴者 × 通貨）。
pub struct ContributorMoneyRow {
    pub viewer_id: String,
    pub name: String,
    pub source: String,
    pub currency: String,
    pub amount: f64,
    pub count: u32,
    pub first_at: String,
}

/// 貢献者のサブスク 1 行（視聴者ごと）。
pub struct ContributorSubscriptionRow {
    pub viewer_id: String,
    pub name: String,
    pub source: String,
    pub count: u32,
    pub first_at: String,
}

/// 総コメント数（レイドを除く＝訂正 1 (A)）。
pub fn total_comments(conn: &Connection, session_id: &str) -> rusqlite::Result<u32> {
    conn.query_row(TOTAL_COMMENTS_SQL, rusqlite::params![session_id], |row| {
        row.get(0)
    })
}

/// 課金の内訳（種別 × 通貨）。**通貨ごとの合計も総課金回数もこの戻り値から導く**（穴 C）。
pub fn monetary_by_kind(
    conn: &Connection,
    session_id: &str,
) -> rusqlite::Result<Vec<KindCurrencyRow>> {
    let mut stmt = conn.prepare(MONETARY_BY_KIND_SQL)?;
    let rows = stmt.query_map(rusqlite::params![session_id], |row| {
        Ok(KindCurrencyRow {
            kind: row.get("kind")?,
            currency: row.get("currency")?,
            amount: row.get("amount")?,
            count: row.get("entry_count")?,
        })
    })?;
    rows.collect()
}

/// Jewels の回数（金額は合算しない）。
pub fn jewels_count(conn: &Connection, session_id: &str) -> rusqlite::Result<u32> {
    conn.query_row(JEWELS_COUNT_SQL, rusqlite::params![session_id], |row| {
        row.get(0)
    })
}

/// サブスク系の件数。
pub fn subscription_count(conn: &Connection, session_id: &str) -> rusqlite::Result<u32> {
    conn.query_row(
        SUBSCRIPTION_COUNT_SQL,
        rusqlite::params![session_id],
        |row| row.get(0),
    )
}

/// 貢献者の課金（視聴者 × 通貨）。
pub fn contributor_money(
    conn: &Connection,
    session_id: &str,
) -> rusqlite::Result<Vec<ContributorMoneyRow>> {
    let mut stmt = conn.prepare(CONTRIBUTOR_MONEY_SQL)?;
    let rows = stmt.query_map(rusqlite::params![session_id], |row| {
        Ok(ContributorMoneyRow {
            viewer_id: row.get("viewer_id")?,
            name: row.get("name")?,
            source: row.get("provider")?,
            currency: row.get("currency")?,
            amount: row.get("amount")?,
            count: row.get("entry_count")?,
            first_at: row.get("first_at")?,
        })
    })?;
    rows.collect()
}

/// 貢献者のサブスク系（視聴者ごと）。
pub fn contributor_subscriptions(
    conn: &Connection,
    session_id: &str,
) -> rusqlite::Result<Vec<ContributorSubscriptionRow>> {
    let mut stmt = conn.prepare(CONTRIBUTOR_SUBSCRIPTION_SQL)?;
    let rows = stmt.query_map(rusqlite::params![session_id], |row| {
        Ok(ContributorSubscriptionRow {
            viewer_id: row.get("viewer_id")?,
            name: row.get("name")?,
            source: row.get("provider")?,
            count: row.get("entry_count")?,
            first_at: row.get("first_at")?,
        })
    })?;
    rows.collect()
}

/// レイド一覧（時刻の降順）。
pub fn raids(conn: &Connection, session_id: &str) -> rusqlite::Result<Vec<RaidRecord>> {
    let mut stmt = conn.prepare(RAIDS_SQL)?;
    let rows = stmt.query_map(rusqlite::params![session_id], |row| {
        Ok(RaidRecord {
            name: row.get("name")?,
            viewer_count: row.get("viewer_count")?,
            at: row.get("at")?,
        })
    })?;
    rows.collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::viewer_memory::model::NewViewerComment;

    /// テスト用 in-memory 接続（本番同様に `foreign_keys=ON`・`viewer_comments` と `stream_sessions` を作る）。
    ///
    /// ⚠ `viewer_memory::repository::init` を先に呼ぶのは本番の `setup()` と同じ順序
    /// （視聴者メモリ → 配信セッション）。
    fn test_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute("PRAGMA foreign_keys = ON", []).unwrap();
        crate::viewer_memory::repository::init(&conn).unwrap();
        crate::stream_session::repository::init(&conn).unwrap();
        conn
    }

    /// 1 行ぶんの投入指定（既定は「セッション s1 の Alice が普通のチャットを 1 件」）。
    struct Row<'a> {
        id: &'a str,
        session: &'a str,
        viewer: &'a str,
        name: &'a str,
        source: &'a str,
        event_type: &'a str,
        amount: Option<f64>,
        currency: Option<&'a str>,
        raid_viewer_count: Option<u32>,
        at: &'a str,
    }

    impl Default for Row<'_> {
        fn default() -> Self {
            Self {
                id: "c1",
                session: "s1",
                viewer: "twitch:u1",
                name: "Alice",
                source: "twitch",
                event_type: "chat",
                amount: None,
                currency: None,
                raid_viewer_count: None,
                at: "2026-08-16T10:00:00Z",
            }
        }
    }

    /// ⚠⚠ **投入は本番と同じ `viewer_memory::repository::record_comment` を通す。**
    /// 直に INSERT すると `viewers` の upsert（＝名前）と既存集計の再計算が走らず、
    /// 「視聴者一覧と分類が一致する」ことを本物のデータで確かめられない。
    fn insert(conn: &Connection, r: Row<'_>) {
        crate::viewer_memory::repository::record_comment(
            conn,
            &NewViewerComment {
                comment_id: r.id.to_string(),
                viewer_id: r.viewer.to_string(),
                session_id: r.session.to_string(),
                provider: r.source.to_string(),
                provider_user_id: r.viewer.to_string(),
                name: r.name.to_string(),
                source: r.source.to_string(),
                text: String::new(),
                event_type: r.event_type.to_string(),
                amount: r.amount,
                currency: r.currency.map(str::to_string),
                monetary_amount: None,
                raid_viewer_count: r.raid_viewer_count,
                published_at: r.at.to_string(),
            },
        )
        .unwrap();
    }

    /// 保存済み viewer 1 行（視聴者一覧＝038b が見ている数字との突き合わせ用）。
    fn viewer(conn: &Connection, id: &str) -> crate::viewer_memory::model::ViewerRecord {
        crate::viewer_memory::repository::get(conn, id)
            .unwrap()
            .unwrap()
    }

    /// 通貨ごとの合計を引く小道具（`service` のロールアップと同じ規則を手で書いたもの）。
    fn by_currency(rows: &[KindCurrencyRow], currency: &str) -> (f64, u32) {
        rows.iter()
            .filter(|r| r.currency == currency)
            .fold((0.0, 0), |(a, c), r| (a + r.amount, c + r.count))
    }

    // -----------------------------------------------------------------------
    // 金額の分類
    // -----------------------------------------------------------------------

    // 通貨混在（JPY / USD / BITS）が 1 つに丸められず、通貨ごとに分かれること。
    #[test]
    fn monetary_by_currency_splits_jpy_usd_and_bits() {
        let conn = test_conn();
        insert(&conn, Row { id: "c1", event_type: "superchat", amount: Some(1000.0), currency: Some("JPY"), ..Default::default() });
        insert(&conn, Row { id: "c2", event_type: "superchat", amount: Some(20.0), currency: Some("USD"), ..Default::default() });
        insert(&conn, Row { id: "c3", event_type: "superchat", amount: Some(500.0), currency: Some("BITS"), ..Default::default() });

        let rows = monetary_by_kind(&conn, "s1").unwrap();
        assert_eq!(by_currency(&rows, "JPY"), (1000.0, 1));
        assert_eq!(by_currency(&rows, "USD"), (20.0, 1));
        assert_eq!(by_currency(&rows, "BITS"), (500.0, 1));
        // 3 通貨が 1 行に潰れていないこと（「通貨で分けない」変異を殺す）。
        assert_eq!(rows.len(), 3);
    }

    // ⚠⚠ 論点 3: 素の GROUP BY だと JEWELS が 1 通貨として混ざる。明示除外を固定する。
    #[test]
    fn jewels_never_appears_in_monetary_by_currency() {
        let conn = test_conn();
        insert(&conn, Row { id: "c1", event_type: "jewels", amount: Some(30.0), currency: Some("JEWELS"), ..Default::default() });
        insert(&conn, Row { id: "c2", event_type: "superchat", amount: Some(1000.0), currency: Some("JPY"), ..Default::default() });

        let rows = monetary_by_kind(&conn, "s1").unwrap();
        assert!(
            rows.iter().all(|r| r.currency != "JEWELS"),
            "JEWELS は実通貨と並べない（単位が未確定なので合算も比較もできない）"
        );
        assert_eq!(by_currency(&rows, "JPY"), (1000.0, 1));
    }

    // ⚠⚠ 除外を「通貨側」に置いたことの担保（変異で生存したので足した）。
    //   `event_type <> 'jewels'` で除外する代替設計でも、043e が両方をセットで保存する現状では
    //   まったく同じ結果になる＝**上のテストだけでは設計判断が固定できていなかった**。
    //   `currency='JEWELS'` を持つ行は**種別が何であれ**実通貨の隣に並ばないことをここで固定する
    //   （論点 3 の要求は「monetary_by_currency に JEWELS が現れないこと」そのものだから）。
    #[test]
    fn a_jewels_currency_row_is_excluded_whatever_its_event_type_is() {
        let conn = test_conn();
        insert(&conn, Row { id: "c1", event_type: "superchat", amount: Some(30.0), currency: Some("JEWELS"), ..Default::default() });
        insert(&conn, Row { id: "c2", event_type: "superchat", amount: Some(1000.0), currency: Some("JPY"), at: "2026-08-16T10:01:00Z", ..Default::default() });

        let rows = monetary_by_kind(&conn, "s1").unwrap();
        assert!(
            rows.iter().all(|r| r.currency != "JEWELS"),
            "除外は通貨側（currency <> 'JEWELS'）で行う。種別側（event_type <> 'jewels'）にすると、\
             JEWELS 通貨が別の種別で届いたときに黙って実通貨の隣に並ぶ"
        );
        assert_eq!(by_currency(&rows, "JPY"), (1000.0, 1));

        // ⚠⚠ レビュー Q-3b: この状況では**視聴者一覧とサマリーのスパチャ額が食い違う**。
        //   `RECOMPUTE_VIEWER_AGGREGATES_SQL` の superchat は `currency <> 'BITS'` しか見ないので
        //   JEWELS の 30 を拾うが、サマリーは通貨側で除外するので拾わない。
        //   **これは論点 3 が意図した挙動**であって不具合ではない。model.rs の突き合わせ表が
        //   「完全一致」ではなく「この場合だけ分かれる」と書いている根拠をここで可視化しておく。
        let v = viewer(&conn, "twitch:u1");
        assert_eq!(v.superchat_amount, 1030.0, "viewers 側は JEWELS の 30 も superchat に数える");
        assert_eq!(
            by_currency(&rows, "JPY").0,
            1000.0,
            "サマリー側は JEWELS を除外するので 1000 のまま＝意図的な不一致"
        );
    }

    // jewels は「回数だけ」。金額にも回数にも入らない（穴 C＝母集合を揃えた結果）。
    #[test]
    fn jewels_is_counted_only_as_jewels_count() {
        let conn = test_conn();
        insert(&conn, Row { id: "c1", event_type: "jewels", amount: Some(30.0), currency: Some("JEWELS"), ..Default::default() });
        insert(&conn, Row { id: "c2", event_type: "jewels", amount: Some(100.0), currency: Some("JEWELS"), at: "2026-08-16T10:01:00Z", ..Default::default() });

        assert_eq!(jewels_count(&conn, "s1").unwrap(), 2);
        assert!(monetary_by_kind(&conn, "s1").unwrap().is_empty());
    }

    // ⚠⚠ 訂正 2 (A): donation は総課金額に**含める**。視聴者一覧の superchat_amount とは意図して食い違う。
    #[test]
    fn donation_is_included_in_the_summary_total_unlike_the_viewer_list() {
        let conn = test_conn();
        insert(&conn, Row { id: "c1", event_type: "superchat", amount: Some(300.0), currency: Some("JPY"), ..Default::default() });
        insert(&conn, Row { id: "c2", event_type: "donation", amount: Some(500.0), currency: Some("JPY"), at: "2026-08-16T10:01:00Z", ..Default::default() });

        // サマリー: donation を含めて 800 JPY / 2 回。
        let rows = monetary_by_kind(&conn, "s1").unwrap();
        assert_eq!(by_currency(&rows, "JPY"), (800.0, 2));
        // 種別の内訳では分かれている（画面で「スパチャ / ドネーション」を出し分けられる）。
        assert_eq!(rows.iter().find(|r| r.kind == "superchat").unwrap().amount, 300.0);
        assert_eq!(rows.iter().find(|r| r.kind == "donation").unwrap().amount, 500.0);

        // 視聴者一覧（038b）: donation はどの金額集計にも入らない＝**意図的な不一致**。
        let v = viewer(&conn, "twitch:u1");
        assert_eq!(v.superchat_amount, 300.0, "viewers 側は superchat だけ（donation を含めない）");
        assert_eq!(v.superchat_count, 1);
    }

    // ⚠ 穴 E: bits の分類に event_type 条件を**足していない**こと（足すと視聴者一覧とずれる）。
    //   `currency='BITS'` かつ `event_type <> 'superchat'` の行が、**両方**で bits として数えられる。
    #[test]
    fn bits_classification_matches_the_viewer_list_and_ignores_event_type() {
        let conn = test_conn();
        // 既存 SQL は `currency = 'BITS'` だけで bits を数える（event_type を見ていない）。
        insert(&conn, Row { id: "c1", event_type: "chat", amount: Some(100.0), currency: Some("BITS"), ..Default::default() });
        insert(&conn, Row { id: "c2", event_type: "superchat", amount: Some(400.0), currency: Some("BITS"), at: "2026-08-16T10:01:00Z", ..Default::default() });

        let rows = monetary_by_kind(&conn, "s1").unwrap();
        let v = viewer(&conn, "twitch:u1");
        assert_eq!(
            by_currency(&rows, "BITS"),
            (v.bits_amount as f64, v.bits_count),
            "bits の分類は視聴者一覧と一致すること（サマリー側に event_type='superchat' を足さない）"
        );
        assert_eq!(by_currency(&rows, "BITS"), (500.0, 2));
        // kind は currency='BITS' で "bits" へ振り替わる（event_type がチャットでも）。
        assert!(rows.iter().all(|r| r.kind == "bits"));
    }

    // 完了条件: スパチャ・サブスク系の分類が視聴者一覧と一致すること（donation を含まないデータで確認）。
    #[test]
    fn superchat_and_subscription_classification_matches_the_viewer_list() {
        let conn = test_conn();
        insert(&conn, Row { id: "c1", event_type: "superchat", amount: Some(1000.0), currency: Some("JPY"), ..Default::default() });
        insert(&conn, Row { id: "c2", event_type: "subscription", at: "2026-08-16T10:01:00Z", ..Default::default() });
        insert(&conn, Row { id: "c3", event_type: "membership", at: "2026-08-16T10:02:00Z", ..Default::default() });
        insert(&conn, Row { id: "c4", event_type: "gift", at: "2026-08-16T10:03:00Z", ..Default::default() });

        let v = viewer(&conn, "twitch:u1");
        let rows = monetary_by_kind(&conn, "s1").unwrap();
        let superchat = rows.iter().find(|r| r.kind == "superchat").unwrap();
        assert_eq!((superchat.amount, superchat.count), (v.superchat_amount, v.superchat_count));
        assert_eq!(subscription_count(&conn, "s1").unwrap(), v.subscription_count);
        assert_eq!(subscription_count(&conn, "s1").unwrap(), 3);
    }

    // サブスク系は amount/currency を持たないので、金額の母集合に入らない（穴 D の「なぜ二重計上にならないか」）。
    #[test]
    fn subscription_family_carries_no_amount_and_stays_out_of_the_money_totals() {
        let conn = test_conn();
        insert(&conn, Row { id: "c1", event_type: "subscription", ..Default::default() });
        insert(&conn, Row { id: "c2", event_type: "membership", at: "2026-08-16T10:01:00Z", ..Default::default() });
        insert(&conn, Row { id: "c3", event_type: "gift", at: "2026-08-16T10:02:00Z", ..Default::default() });

        assert!(monetary_by_kind(&conn, "s1").unwrap().is_empty());
        assert_eq!(subscription_count(&conn, "s1").unwrap(), 3);
    }

    // -----------------------------------------------------------------------
    // レイド（訂正 1・論点 4）
    // -----------------------------------------------------------------------

    // ⚠⚠ 訂正 1 (A): 総コメント数はレイドを数えない。⇒ viewers.total_comments（COUNT(*)）と**意図的に食い違う**。
    #[test]
    fn total_comments_excludes_raid_and_therefore_differs_from_viewers_total_comments() {
        let conn = test_conn();
        insert(&conn, Row { id: "c1", event_type: "chat", ..Default::default() });
        insert(&conn, Row { id: "c2", viewer: "twitch:raider", name: "RaiderChannel", event_type: "raid", raid_viewer_count: Some(42), at: "2026-08-16T10:01:00Z", ..Default::default() });

        assert_eq!(total_comments(&conn, "s1").unwrap(), 1, "レイドは「流れたコメント」ではない");
        assert_eq!(
            viewer(&conn, "twitch:raider").total_comments,
            1,
            "viewers 側は COUNT(*) のままレイドを数える（062a の決定 (a)）＝意図的な不一致"
        );
    }

    // レイドは金額にもサブスク件数にも入らない。
    #[test]
    fn raid_is_excluded_from_money_and_subscription_count() {
        let conn = test_conn();
        insert(&conn, Row { id: "c1", viewer: "twitch:raider", name: "RaiderChannel", event_type: "raid", raid_viewer_count: Some(42), ..Default::default() });

        assert!(monetary_by_kind(&conn, "s1").unwrap().is_empty());
        assert_eq!(subscription_count(&conn, "s1").unwrap(), 0);
        assert_eq!(jewels_count(&conn, "s1").unwrap(), 0);
    }

    // ⚠ 穴 A: レイド元の名前は `viewers` の JOIN からしか取れない（viewer_comments に名前列が無く、
    //   レイド行は text も空）。人数は raid_viewer_count。
    #[test]
    fn raids_report_the_raider_name_and_viewer_count() {
        let conn = test_conn();
        insert(&conn, Row { id: "c1", viewer: "twitch:raider", name: "RaiderChannel", event_type: "raid", raid_viewer_count: Some(42), ..Default::default() });

        let list = raids(&conn, "s1").unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].name, "RaiderChannel", "id ではなく表示名が出ること");
        assert_eq!(list[0].viewer_count, Some(42));
        assert_eq!(list[0].at, "2026-08-16T10:00:00Z");
    }

    // 人数が NULL でも 0 を捏造しない（「0 人のレイド」と「人数不明」を混同させない）。
    #[test]
    fn raids_keep_a_missing_viewer_count_as_none() {
        let conn = test_conn();
        insert(&conn, Row { id: "c1", viewer: "twitch:raider", name: "RaiderChannel", event_type: "raid", raid_viewer_count: None, ..Default::default() });

        assert_eq!(raids(&conn, "s1").unwrap()[0].viewer_count, None);
    }

    // YouTube 単独の配信ではレイドが 0 件（欄は画面側が「Twitch のみ」と明記して常に出す）。
    #[test]
    fn raids_are_empty_for_a_youtube_only_session() {
        let conn = test_conn();
        insert(&conn, Row { id: "c1", viewer: "youtube:u1", source: "youtube", event_type: "superchat", amount: Some(500.0), currency: Some("JPY"), ..Default::default() });

        assert!(raids(&conn, "s1").unwrap().is_empty());
    }

    // レイドは時刻の降順（最新が上）。
    #[test]
    fn raids_are_ordered_by_time_descending() {
        let conn = test_conn();
        insert(&conn, Row { id: "c1", viewer: "twitch:r1", name: "First", event_type: "raid", raid_viewer_count: Some(1), at: "2026-08-16T10:00:00Z", ..Default::default() });
        insert(&conn, Row { id: "c2", viewer: "twitch:r2", name: "Second", event_type: "raid", raid_viewer_count: Some(2), at: "2026-08-16T11:00:00Z", ..Default::default() });

        let names: Vec<String> = raids(&conn, "s1").unwrap().into_iter().map(|r| r.name).collect();
        assert_eq!(names, vec!["Second".to_string(), "First".to_string()]);
    }

    // -----------------------------------------------------------------------
    // 貢献者（論点 4・穴 A）
    // -----------------------------------------------------------------------

    // ⚠⚠ 論点 4: レイドしかしていない配信者は貢献者に**現れない**（クエリの構造として入らない）。
    #[test]
    fn contributors_exclude_viewers_who_only_raided() {
        let conn = test_conn();
        insert(&conn, Row { id: "c1", viewer: "twitch:raider", name: "RaiderChannel", event_type: "raid", raid_viewer_count: Some(42), ..Default::default() });
        insert(&conn, Row { id: "c2", event_type: "superchat", amount: Some(500.0), currency: Some("JPY"), at: "2026-08-16T10:01:00Z", ..Default::default() });

        let money = contributor_money(&conn, "s1").unwrap();
        let subs = contributor_subscriptions(&conn, "s1").unwrap();
        assert!(money.iter().all(|r| r.viewer_id != "twitch:raider"));
        assert!(subs.iter().all(|r| r.viewer_id != "twitch:raider"));
        assert_eq!(money.len(), 1);
        assert_eq!(money[0].viewer_id, "twitch:u1");
    }

    // 論点 4 の裏: チャットしかしていない人も貢献者ではない。
    #[test]
    fn contributors_exclude_viewers_who_only_chatted() {
        let conn = test_conn();
        insert(&conn, Row { id: "c1", viewer: "twitch:lurker", name: "Lurker", event_type: "chat", ..Default::default() });

        assert!(contributor_money(&conn, "s1").unwrap().is_empty());
        assert!(contributor_subscriptions(&conn, "s1").unwrap().is_empty());
    }

    // 名前・配信元は viewers から引く（穴 A の線引き）。通貨ごとに 1 行ずつ返る。
    #[test]
    fn contributor_money_is_grouped_per_viewer_and_currency() {
        let conn = test_conn();
        insert(&conn, Row { id: "c1", event_type: "superchat", amount: Some(1000.0), currency: Some("JPY"), ..Default::default() });
        insert(&conn, Row { id: "c2", event_type: "superchat", amount: Some(2000.0), currency: Some("JPY"), at: "2026-08-16T10:01:00Z", ..Default::default() });
        insert(&conn, Row { id: "c3", event_type: "superchat", amount: Some(10.0), currency: Some("USD"), at: "2026-08-16T10:02:00Z", ..Default::default() });

        let rows = contributor_money(&conn, "s1").unwrap();
        assert_eq!(rows.len(), 2, "JPY と USD で 2 行");
        let jpy = rows.iter().find(|r| r.currency == "JPY").unwrap();
        assert_eq!((jpy.amount, jpy.count), (3000.0, 2));
        assert_eq!(jpy.name, "Alice");
        assert_eq!(jpy.source, "twitch");
        assert_eq!(jpy.first_at, "2026-08-16T10:00:00Z");
    }

    // ⚠⚠ 穴 A の線引き: 貢献者の金額は**そのセッションのぶんだけ**（viewers の全期間累計を混ぜていない）。
    #[test]
    fn contributor_amounts_are_per_session_not_lifetime_totals() {
        let conn = test_conn();
        insert(&conn, Row { id: "c1", session: "s1", event_type: "superchat", amount: Some(10000.0), currency: Some("JPY"), ..Default::default() });
        insert(&conn, Row { id: "c2", session: "s2", event_type: "superchat", amount: Some(500.0), currency: Some("JPY"), at: "2026-08-17T10:00:00Z", ..Default::default() });

        // 視聴者一覧（全期間）は 10,500。
        assert_eq!(viewer(&conn, "twitch:u1").superchat_amount, 10500.0);
        // サマリー（s2）は 500 だけ。
        let rows = contributor_money(&conn, "s2").unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].amount, 500.0);
    }

    // 別セッションのデータが混ざらない（session_id のバインド）。
    #[test]
    fn another_session_data_is_not_mixed_in() {
        let conn = test_conn();
        insert(&conn, Row { id: "c1", session: "s1", event_type: "superchat", amount: Some(1000.0), currency: Some("JPY"), ..Default::default() });
        insert(&conn, Row { id: "c2", session: "s2", event_type: "superchat", amount: Some(9999.0), currency: Some("JPY"), at: "2026-08-17T10:00:00Z", ..Default::default() });
        insert(&conn, Row { id: "c3", session: "s2", event_type: "subscription", at: "2026-08-17T10:01:00Z", ..Default::default() });
        insert(&conn, Row { id: "c4", session: "s2", viewer: "twitch:raider", name: "RaiderChannel", event_type: "raid", raid_viewer_count: Some(9), at: "2026-08-17T10:02:00Z", ..Default::default() });

        assert_eq!(total_comments(&conn, "s1").unwrap(), 1);
        assert_eq!(by_currency(&monetary_by_kind(&conn, "s1").unwrap(), "JPY"), (1000.0, 1));
        assert_eq!(subscription_count(&conn, "s1").unwrap(), 0);
        assert!(raids(&conn, "s1").unwrap().is_empty());
        assert_eq!(contributor_money(&conn, "s1").unwrap().len(), 1);
        assert_eq!(contributor_subscriptions(&conn, "s1").unwrap().len(), 0);
    }

    // 存在しないセッション id は空（0 件）で返る（service が NotFound を出す前提の素の挙動）。
    #[test]
    fn an_unknown_session_id_aggregates_to_zero() {
        let conn = test_conn();
        insert(&conn, Row { id: "c1", event_type: "superchat", amount: Some(1000.0), currency: Some("JPY"), ..Default::default() });

        assert_eq!(total_comments(&conn, "nope").unwrap(), 0);
        assert!(monetary_by_kind(&conn, "nope").unwrap().is_empty());
    }

    // ⚠⚠ 穴 B: 視聴者を削除すると（FK CASCADE で viewer_comments ごと消えるため）**過去のサマリーの数字が変わる**。
    //   ⚠ 2026-08-16 に画面の説明文を全廃したので**この挙動はユーザーには見えない**が、
    //   「サマリーの数字は後から変わりうる」という性質そのものはここで機械的に固定しておく
    //   （次の人が「集計がおかしい」と誤診しないため）。
    #[test]
    fn deleting_a_viewer_changes_a_past_summary() {
        let conn = test_conn();
        insert(&conn, Row { id: "c1", event_type: "superchat", amount: Some(1000.0), currency: Some("JPY"), ..Default::default() });
        insert(&conn, Row { id: "c2", viewer: "twitch:u2", name: "Bob", event_type: "superchat", amount: Some(500.0), currency: Some("JPY"), at: "2026-08-16T10:01:00Z", ..Default::default() });
        assert_eq!(by_currency(&monetary_by_kind(&conn, "s1").unwrap(), "JPY"), (1500.0, 2));

        crate::viewer_memory::repository::delete(&conn, "twitch:u2").unwrap();

        assert_eq!(
            by_currency(&monetary_by_kind(&conn, "s1").unwrap(), "JPY"),
            (1000.0, 1),
            "視聴者を削除すると過去の配信サマリーの数字も変わる（サマリー側では防げない＝仕様）"
        );
        assert_eq!(contributor_money(&conn, "s1").unwrap().len(), 1);
    }
}
