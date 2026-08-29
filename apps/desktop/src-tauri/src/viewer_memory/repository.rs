//! 038a: 視聴者メモリの SQL 層（`viewers` / `viewer_comments`）。
//!
//! 保存は端末内 SQLite のみ。識別子（テーブル名・ORDER BY 句）は**コンパイル時定数のみ**を使い、
//! 値は必ずパラメータバインドする（docs/security.md §8）。集計は挿入行から再計算するため冪等。

use chrono::{DateTime, Months};
use rusqlite::{Connection, OptionalExtension};

use super::model::{NewViewerComment, RecordResult, ViewerCommentRecord, ViewerRecord, ViewerSort};

/// SELECT で取得する viewers テーブルの全カラム（複数クエリで共有）。
///
/// ⚠⚠ 065a: **`imported_name_history` は意図的に入れていない。** 取り込み元由来の生 JSON 文字列を
/// 保管しているだけの列で、`ViewerRecord`（＝ IPC で frontend へ渡る DTO）には出さない
/// （065b は使わない・第三者データを IPC 境界へ載せる面を増やさない＝docs/security.md §9）。
/// 表示したくなったときは、まず `nameHistory` のパース方針を決め、**§9 を再評価してから**足すこと。
const VIEWER_COLUMNS: &str = "id, provider, provider_user_id, name, first_seen_at, last_comment_at, \
    total_comments, bits_count, bits_amount, superchat_count, superchat_amount, superchat_currency, \
    subscription_count, is_member, last_subscription_at, note, created_at, updated_at, \
    nickname, label, gift_count, stream_count, active_days, \
    imported_comments, imported_gifts, imported_gift_amount, imported_active_days, \
    imported_stream_count, imported_first_seen_at, imported_at";

/// SELECT で取得する viewer_comments テーブルの全カラム。
const VIEWER_COMMENT_COLUMNS: &str =
    "id, viewer_id, session_id, source, text, event_type, amount, currency, monetary_amount, \
    raid_viewer_count, published_at, created_at";

/// ある視聴者（?1）の集計を `viewer_comments` から**全再計算**する（?2 = updated_at）。
///
/// 【設計意図】増分加算ではなく挿入行から毎回全再計算（recompute-on-write）＝二重記録・順序前後でも
///   集計がドリフトしない冪等性を優先。走査は当該 viewer 限定で idx_viewer_comments_viewer が効く。
///   【再修正トリガ】常連の 1 セッション数千コメントで挿入が重くなったら増分更新/しきい値化を検討（Q3）。
/// 【043a】メンシプ（YouTube NEW_SPONSOR/MEMBER_MILESTONE→'membership'）・ギフト（Twitch
///   sub_gift/community_sub_gift→'gift'）を種別分離して受け取るようになった。分離前は全て 'subscription'
///   に畳まれていたため、subscription_count/is_member/last_subscription_at は
///   event_type IN ('subscription','membership','gift') で数えて**分離前と同じ集合**を保つ
///   （＝取りこぼしゼロ・退行ゼロ・列追加なし）。累計月数/ギフト件数（wire の monthCount/giftCount）は
///   表示用途で通すのみで**端末保存しない**近似（is_member＋回数のみ）。
///   【再修正トリガ】membership/gift を別カウントで持ちたい要件が出たら列追加＋038 表示波及を検討（Q7）。
/// 【前提 → ⚠⚠ 既に偽であることが実証済み。065a で doc だけ訂正した（式は 1 文字も変えていない）】
///   first/last は published_at の**辞書順比較**である。当初は「全 provider が UTC・同形 ISO8601 を送る」
///   前提を置き、ずれたら正規化する（Q5）を再修正トリガーにしていた。**このトリガーは 062b で発火済みで、
///   まだ誰も直していない。**
///   - 062b の `stream_session::repository::comment_times` の doc が「`published_at` はプラットフォーム由来
///     （Twitch は `Z` 形式）で、しかも**オフセット付き（`+09:00` / `-08:00`）が混ざりうる**。SQL の `MAX` は
///     単なる文字列比較なので、この混在で**最新でない行を「最新」として選ぶ**」と明記している。
///     062b 自身は SQL の `MAX` を捨て、Rust の `DateTime::parse_from_rfc3339` で最大値を決める形へ逃げた。
///   - 実測（sqlite3）: `MAX('2026-01-01T12:00:00Z', '2026-01-01T05:00:00-08:00')` は**前者**を返すが、
///     実際に新しいのは後者（13:00 UTC）である。
///   ⇒ **オフセット混在時に `first_seen_at` / `last_comment_at` がずれる**。`is_long_absence` はこの
///     `last_comment_at` を基準にするので **038c の「久しぶり」判定にも波及する**。
///   ⚠⚠ **この doc を読んで「UTC 前提だから安全」と判断しないこと。それがこの訂正の目的である。**
///   【再修正トリガ】発火済み・**未対応**。065a は「first/last の式は変えない」と決めているので**別課題**として残す。
///     直し方は二択: ①`comment_times` に倣い「SQL は値を取り出すだけ・比較は Rust」へ寄せる
///     ②保存時に `published_at` を UTC 正規化する（既存行の移行を伴う）。**038 側に起票すること。**
/// 【065a】CSV からの引き継ぎ（`imported_*`）を**加算する 4 列**を足した（他の列も式も不変）。
///   - `total_comments` / `gift_count` / `stream_count` / `active_days` の 4 つだけが
///     `COUNT(...) + COALESCE(imported_*, 0)` になる。`imported_*` は**この UPDATE が触らない列**なので、
///     再計算が何度走っても引き継ぎ値は消えない（＝065a の中心。038a の recompute-on-write 契約は不変）。
///   - ⚠ **`COALESCE` は冗長である。** `imported_*` は `INTEGER NOT NULL DEFAULT 0` で `ensure_column` が
///     既存行も 0 で埋めるため、実際には NULL になりえない。**防御として残しているだけ**で、
///     「この列は NULL があり得る」と読まないこと（本当に NULL 可なのは `imported_first_seen_at` で、
///     この SQL は 1 度も触らない）。
///   - ⚠ `gift_count` の集合に **`raid` と `chat` を入れない**（レイドは課金ではない＝062a の決定）。
///   - ⚠⚠ **`active_days` は UTC 日で数える**（SQLite の `date()` はオフセットを UTC へ正規化する。実測:
///     `date('2026-08-16T02:00:00+09:00')` = `2026-08-15`）。⇒ 日本時間の朝の配信（08:00–10:00 JST）は
///     **UTC で 2 日に割れる**。さらに引き継ぎ側の `atdDays` は（ほぼ確実に）**取り込み元のローカル日**なので、
///     **足し算の左右で「1 日」の定義が揃っていない近似**である。`date(published_at,'localtime')` を
///     採らなかったのは端末 TZ で値が動くため（同じデータでも端末ごとに違う・旅行/DST で過去の値が変わる・
///     テストが環境依存になる）。
///   - ⚠⚠ **壊れた `published_at` は `date()` が NULL を返し、`COUNT(DISTINCT ...)` が黙って落とす**
///     （実測: 有効 2 行 ＋ bogus ＋ NULL で結果 1）。**エラーにならない**＝`active_days` は少なめに出る。
///     `service::record_comment` は `published_at` に `require_non_empty` しか掛けていないので実際に到達しうる。
///     水増しより安全側なので**受容**する（`active_days_counts_utc_days_and_ignores_broken_timestamps` が固定）。
///   - ⚠ **`stream_count = COUNT(DISTINCT session_id)` は 062b 以前のデータで水増しされる。**
///     062b 以前の `session_id` は**コメビュ窓のマウント単位**（窓を開き直すたびに別 id）だったため、
///     1 回の配信が複数セッションとして数えられる。062b は**バックフィルしないと決めている**
///     （セッションを捏造しない）ので、**この歪みは永久に残る**。`stream_sessions` に行がある
///     `session_id` だけ数える案は、062b 以前が丸ごと 0 になる＝逆方向の嘘なので採らなかった。
///   - ⚠⚠ **コメント 0 件の視聴者へこの SQL を当ててはいけない。** `first_seen_at` / `last_comment_at` は
///     **`TEXT NOT NULL`** なので `MIN/MAX` が NULL を返し、**NOT NULL 制約違反 → トランザクション全体が
///     ロールバック**する（実測済み。062a が案 (c) を却下した理由①と同じ失敗）。CSV 取り込みは
///     `viewer_comments` の行を 1 件も作らないため、**引き継ぎだけの視聴者は必ずコメント 0 件**である。
///     ⇒ 取り込み経路と [`backfill_new_aggregates`] は、**`viewer_comments` に行がある視聴者だけ**へ流す。
/// 【043e】新規挿入時（step3）と、jewels の combo 更新で既存行を UPDATE した後の 2 箇所から呼ぶため定数化した
///   （SQL 本文は 043a 時点から 1 文字も変えていない）。combo 更新でも「行から全再計算」なので、
///   total_comments = COUNT(*) は変わらず、置き換わった amount だけが集計へ反映される。
/// 【062a】レイド（`event_type='raid'`）を取り込んだが、**この SQL は 1 文字も変えていない**。
///   - `subscription_count` / `is_member` / `last_subscription_at` に `'raid'` を**足さない**
///     （レイドはサブスクではない）。`raid_is_not_counted_in_any_existing_aggregation` が固定する。
///   - `bits_*` / `superchat_*` にも入らない（レイド行は amount/currency が常に NULL）。
///   - ⚠⚠ **`total_comments = COUNT(*)` はそのままでレイド行も数える**（決定 (a)）。当初案は
///     `event_type <> 'raid'` に変える (b) だったが採らなかった。理由は 3 つ:
///     ①`first_seen_at` / `last_comment_at` も揃えて除外する案 (c) は、両列が **`TEXT NOT NULL`** なので
///       レイドしかしていない視聴者で `MIN/MAX` が NULL を返し **NOT NULL 制約違反 → トランザクション
///       全体がロールバック → レイドが 1 件も保存されない**（本タスクの最優先＝記録は遡れない、を壊す）
///     ②(b) だけを採ると「総コメント数 0 なのに最終コメント日時がある」視聴者が生まれ、038 の視聴者一覧で
///       読めない状態になる。しかも `ViewerSort::TotalComments`（総コメント数順）で 0 として沈み、
///       **レイドしてくれた人が一覧から実質見えなくなる**
///     ③062c の配信サマリーは `event_type='raid'` で直接引くので `total_comments` の定義に依存しない
///     ＝ 実害は「レイド元配信者の総コメント数が 1 増える」だけ（レイド元は通常その配信の視聴者ではない）。
///     【再修正トリガ】「総コメント数」にレイドが混ざるのが実運用で問題になったら、(b) 単独ではなく
///     `first_seen_at` / `last_comment_at` の NOT NULL をどう扱うかまで含めて 038 側の課題として起票する。
const RECOMPUTE_VIEWER_AGGREGATES_SQL: &str = "UPDATE viewers SET
            total_comments = (SELECT COUNT(*) FROM viewer_comments WHERE viewer_id = ?1)
                             + COALESCE(imported_comments, 0),
            gift_count = (SELECT COUNT(*) FROM viewer_comments WHERE viewer_id = ?1 AND event_type IN ('superchat', 'membership', 'subscription', 'gift', 'donation', 'jewels'))
                             + COALESCE(imported_gifts, 0),
            stream_count = (SELECT COUNT(DISTINCT session_id) FROM viewer_comments WHERE viewer_id = ?1)
                             + COALESCE(imported_stream_count, 0),
            active_days = (SELECT COUNT(DISTINCT date(published_at)) FROM viewer_comments WHERE viewer_id = ?1)
                             + COALESCE(imported_active_days, 0),
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
         WHERE id = ?1";

/// 043e: 同一 id の再送で既存行の更新を許す唯一のコメント種別。
///
/// YouTube の `GIFT_EVENT`（Jewels）だけは公式仕様上「同じ message id が combo count の更新として再送される」
/// （公式 proto の `LiveChatMessage.id` に明記）。それ以外の種別で同一 id が来るのは単なる再配信なので、
/// 既存の冪等契約（0 行・集計非更新・`RecordResult{false,false}`）を**一切変えない**。
///
/// 【レビュー指摘 Q-4・二重管理は意図的なので共通化しないこと】この定数と UPDATE 文の SQL リテラル
/// `AND event_type = 'jewels'` は同じ値を 2 箇所に持つが、**見ている対象が違う**（本定数＝受信側の種別／
/// SQL＝保存済み行側の種別）。SQL 側を本定数のバインドや `format!` 展開に置き換えると「SQL は引数に
/// 関係なく jewels 行しか触らない」という防御特性が失われ、定数の書き換え 1 箇所で両層が同時に緩む。
/// 値のドリフトは下の `combo_updatable_event_type_matches_sql_literal` テストで検知する。
const COMBO_UPDATABLE_EVENT_TYPE: &str = "jewels";

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
    // 062a: レイド人数（`event_type='raid'` の行のみ・それ以外は NULL）。既存 DB にも後付けできるよう
    //   `ensure_column` で冪等に追加する（マイグレーション基盤が無く各 init() が冪等 DDL、という既存流儀）。
    //   ⚠ 識別子（テーブル名・カラム名・型宣言）は**すべてコンパイル時定数**でユーザー入力を渡さない（§8）。
    //   ⚠ 062a で増える保存項目はこの 1 列だけ。既存列の意味論は 1 つも変えていない
    //     （`total_comments` は `COUNT(*)` のままレイド行も数える＝穴 G の決定 (a)。理由は
    //      `RECOMPUTE_VIEWER_AGGREGATES_SQL` の doc コメントを正とする）。
    crate::util::ensure_column(conn, "viewer_comments", "raid_viewer_count", "INTEGER")?;

    // 065a: 取り込み元コメントビューアーの公式 CSV エクスポートから引き継ぐ値と、それを足し込んだ集計。
    //   ⚠ 識別子（テーブル名・カラム名・型宣言）は**すべてコンパイル時定数**でユーザー入力を渡さない（§8）。
    //   ⚠ **既存列の意味論は 1 つも変えていない**（`total_comments` は総コメント数のままで、そこへ
    //     引き継ぎ分が加算されるだけ。レイドを数える決定〔062a〕も不変）。
    //   ⚠ **新テーブルも新規 FK も作らない**。すべて `viewers` の列なので、既存の削除手段
    //     （`delete_viewer` / `clear_viewers`）が**取り残しゼロで効いたまま**である（§9・⑪）。
    //   ⚠ `imported_*` は「引き継ぎのベースライン」で、`RECOMPUTE_VIEWER_AGGREGATES_SQL` が
    //     **触らない列**。だから再計算が何度走っても消えない（＝065a の中心）。
    //   ⚠⚠ `imported_first_seen_at` を独立列にしてあるのは、その値が**仮説を含む**ため
    //     （`lcts − interval` を「初回コメントからの経過時間」と読んだ解釈。親 065・(3)）。
    //     解釈が外れてもこの 1 列を NULL にするだけで戻せる。**`first_seen_at` へ直接書かないこと。**
    //   ⚠ `imported_gift_amount` は**単位不明**（CSV に通貨情報が無い）。`superchat_amount` /
    //     `bits_amount` には**一切加算しない**（「1000 円」と「1000 jewels」が足し合わさるため）。
    //
    // ⚠ 下のバックフィル判定は**列を足す前**に取る（足した後だと必ず「存在する」になり、
    //   065a より前に作られた DB が永久に 0 のままになる）。代表として `gift_count` を見る
    //   ——13 列は同じループで一括追加されるので、1 つでも欠けていれば全部欠けている。
    let needs_aggregate_backfill = {
        let mut stmt = conn.prepare("SELECT 1 FROM pragma_table_info(?1) WHERE name = ?2")?;
        !stmt.exists(rusqlite::params!["viewers", "gift_count"])?
    };
    for (column, decl) in [
        ("nickname", "TEXT NOT NULL DEFAULT ''"),
        ("label", "TEXT NOT NULL DEFAULT ''"),
        ("imported_comments", "INTEGER NOT NULL DEFAULT 0"),
        ("imported_gifts", "INTEGER NOT NULL DEFAULT 0"),
        ("imported_gift_amount", "REAL NOT NULL DEFAULT 0"),
        ("imported_active_days", "INTEGER NOT NULL DEFAULT 0"),
        ("imported_stream_count", "INTEGER NOT NULL DEFAULT 0"),
        ("imported_first_seen_at", "TEXT"),
        ("imported_name_history", "TEXT NOT NULL DEFAULT ''"),
        ("imported_at", "TEXT"),
        ("gift_count", "INTEGER NOT NULL DEFAULT 0"),
        ("stream_count", "INTEGER NOT NULL DEFAULT 0"),
        ("active_days", "INTEGER NOT NULL DEFAULT 0"),
    ] {
        crate::util::ensure_column(conn, "viewers", column, decl)?;
    }

    // 065a: **新しい集計 3 列は、既に居る視聴者では 0 のまま埋まらない**（再計算は `record_comment` から
    //   しか走らないため）。⇒ もう来ない常連さんは「参加配信数 0 / 参加日数 0」で永久に固定され、
    //   065b の一覧が**明らかに壊れて見える**。列を新規に足したこの 1 回だけ再計算する。
    //   ⚠ 判定は `gift_count` の**追加前**に取ること（`ensure_column` の後に見ると必ず存在する）。
    if needs_aggregate_backfill {
        backfill_new_aggregates(conn)?;
    }
    Ok(())
}

/// 065a: `gift_count` / `stream_count` / `active_days` を既存の視聴者へ 1 回だけ埋める。
///
/// ⚠⚠ **`RECOMPUTE_VIEWER_AGGREGATES_SQL` を 1 人ずつ流すのが要点**である。4 つの集計式をここへ
/// 書き写して「全視聴者を 1 本の UPDATE で」やるほうが速いが、それは**式が 2 か所に分かれる**
/// ということで、片方だけが古くなる（`validate_source_path` のコメントが 060b / 061c について
/// 戒めているのと同じ形）。**同じ定数を通せば、式のドリフトが構造的に起きない。**
///
/// ⚠⚠ **`viewer_comments` に行がある視聴者だけへ流す。** コメント 0 件の視聴者に当てると
/// `first_seen_at` / `last_comment_at`（`TEXT NOT NULL`）へ `MIN/MAX` の NULL が入り、
/// **NOT NULL 制約違反 → 起動時の init が失敗してアプリが立ち上がらない**。
/// ⚠ コメント 0 件の `viewers` 行は**実在しうる**——`record_comment` の step1（upsert）は
/// 重複コメント id の判定より前にあるので、既存 id を別の viewer_id で再送されると
/// 「視聴者行だけ作られてコメントは入らない」状態になる（同関数の S-4 注記）。
///
/// ⚠ 副作用として、対象視聴者の `updated_at` が 1 回だけ更新される（スキーマ変更イベントなので受容）。
/// ⚠ 1 トランザクションにまとめてあるのは、視聴者ごとに fsync すると起動が目に見えて遅くなるため。
///
/// ## ⚠⚠ 失敗したときに起きること（レビュー指摘 S-4・受容）
///
/// 本関数の `Err` は `init()` → `lib.rs` の `setup()` まで `?` で伝わるので、**その回はアプリが起動しない**。
/// ⚠ ただし `ensure_column` の 13 列は本関数より前に**別トランザクションで確定済み**なので、
/// 次回起動では `needs_aggregate_backfill` が `false` になり、**バックフィルは二度と走らない**
/// ——アプリは起動するが、集計 3 列は 0 のまま静かに残る（自動リトライは無い）。
/// この形を受容したのは、①バックフィル自体は 1 トランザクションなので DB が壊れることは無い
/// ②「起動できない」より「一部の集計が 0」のほうが害が小さい ③リトライ用のフラグ列を足すと
/// 「マイグレーション基盤を持たない」という既存流儀を崩す、の 3 点による。
/// 【再修正トリガ】実機で「参加配信数が 0 のままの視聴者が居る」と言われたら、
/// **列の有無ではなく「集計が埋まっているか」を判定条件にする**（例: `stream_count = 0 AND
/// total_comments > 0` の視聴者だけを 1 人ずつ流し直す）。⚠ その場合は毎起動で走るので所要時間を測ること。
///
/// ⚠ 所要時間は「コメントを持つ視聴者数 × その人のコメント数」で伸びる（1 人につき相関サブクエリ 12 本）。
/// 上限は無い＝**大規模 DB では起動が体感で遅くなりうる**。実測が要るのは実機確認の⑦。
fn backfill_new_aggregates(conn: &Connection) -> rusqlite::Result<()> {
    let now = crate::util::now_rfc3339();
    let tx = conn.unchecked_transaction()?;
    let ids: Vec<String> = {
        let mut stmt = tx.prepare(
            "SELECT id FROM viewers \
             WHERE EXISTS(SELECT 1 FROM viewer_comments WHERE viewer_id = viewers.id)",
        )?;
        let rows = stmt.query_map([], |row| row.get(0))?;
        rows.collect::<rusqlite::Result<Vec<String>>>()?
    };
    for id in &ids {
        tx.execute(RECOMPUTE_VIEWER_AGGREGATES_SQL, rusqlite::params![id, now])?;
    }
    tx.commit()
}

/// ⚠⚠ **`u32` の DTO 列を「行が読めなくならない形」で読む（security-review S-1 の 2 層目）。**
///
/// `rusqlite` の `row.get::<_, u32>` は列の値が `u32` の範囲外（負値・42.9 億超）だと
/// `IntegralValueOutOfRange` を返す。**それは 1 行の失敗では済まない**——`list` は
/// `rows.collect()` で束ねるので、**壊れた行が 1 つあると視聴者一覧が丸ごと `StorageFailed` になり、
/// UI からその行を消すこともできなくなる**（実測: `amount = -1, currency = "BITS"` のコメント 1 件で再現）。
///
/// ⇒ **範囲外は丸めて読む。** 表示が不正確になるより、**一覧が開いて当該行を削除できる**ほうが良い
/// （065a の CSV 経路が「数値を勝手に丸めない」で通しているのと**逆の判断**だが、対象が違う——
/// あちらは*これから保存する値*で、こちらは*既に保存されてしまった値の表示*である。
/// 入口を丸めると嘘のデータが増えるが、出口を丸めるのは復旧手段を残すためである）。
///
/// ⚠ 入口（[`super::service`] の `MAX_COMMENT_AMOUNT`）と**両方**要る。入口だけだと既に壊れた DB が
/// 救われず、出口だけだと壊れた値が保存され続ける。**片方だけ消さないこと。**
/// 【再修正トリガ】丸めが実際に発火していることが分かったら（＝表示が `4294967295` に張り付いたら）、
/// 入口の上限か `bits_amount` の型そのもの（`u32` → `#[ts(type = "number")]` 付きの `i64`）を見直す。
fn read_u32_clamped(row: &rusqlite::Row<'_>, column: &str) -> rusqlite::Result<u32> {
    let raw: i64 = row.get(column)?;
    Ok(raw.clamp(0, u32::MAX as i64) as u32)
}

/// ⚠ 非有限の `f64`（`inf`）を 0 に倒して読む。`serde_json` は非有限の `f64` を `null` へ落とすので、
/// そのまま通すと **binding の型は `number` なのに実体は `null`** という嘘になる（S-1 と同じ出口側の防御）。
/// ⚠ SQLite は `NaN` を NULL として保存するので、ここに来るのは `inf` だけである。
fn read_finite_f64(row: &rusqlite::Row<'_>, column: &str) -> rusqlite::Result<f64> {
    let raw: f64 = row.get(column)?;
    Ok(if raw.is_finite() { raw } else { 0.0 })
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
        // ⚠⚠ **`bits_amount` だけは丸めて読む**（理由は [`read_u32_clamped`]）。この列は
        //   `CAST(SUM(amount) AS INTEGER)` で、`amount` は frontend 由来の f64 が入る唯一の集計である。
        //   ⚠ 他の `u32` 列を素の `row.get` のままにしてあるのは**意図**——`COUNT(*)` 由来（`total_comments` /
        //   `bits_count` / `superchat_count` / `subscription_count`）は負にも巨大にもならず、
        //   `gift_count` / `stream_count` / `active_days` / `imported_*` は取り込み側の
        //   `MAX_IMPORTED_COUNT` で押さえてある。**丸めを全列へ広げると本物のバグを隠す。**
        bits_amount: read_u32_clamped(row, "bits_amount")?,
        superchat_count: row.get("superchat_count")?,
        superchat_amount: read_finite_f64(row, "superchat_amount")?,
        superchat_currency: row.get("superchat_currency")?,
        subscription_count: row.get("subscription_count")?,
        is_member: row.get("is_member")?,
        last_subscription_at: row.get("last_subscription_at")?,
        note: row.get("note")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        // 065a: CSV からの引き継ぎ分。⚠ `imported_name_history` は **DTO に出さない**ので
        //   `VIEWER_COLUMNS` にも入っておらず、ここでも読まない（理由は同定数の doc）。
        nickname: row.get("nickname")?,
        label: row.get("label")?,
        gift_count: row.get("gift_count")?,
        stream_count: row.get("stream_count")?,
        active_days: row.get("active_days")?,
        imported_comments: row.get("imported_comments")?,
        imported_gifts: row.get("imported_gifts")?,
        imported_gift_amount: row.get("imported_gift_amount")?,
        imported_active_days: row.get("imported_active_days")?,
        imported_stream_count: row.get("imported_stream_count")?,
        imported_first_seen_at: row.get("imported_first_seen_at")?,
        imported_at: row.get("imported_at")?,
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
        raid_viewer_count: row.get("raid_viewer_count")?,
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
/// 043e（唯一の例外）: `event_type = 'jewels'` だけは同一 id の再送が「同じギフトの**更新**」を意味するため
/// （YouTube の combo。公式 proto の `LiveChatMessage.id` に明記）、既存行の `amount` / `currency` /
/// `monetary_amount` / `text` を差し替えて集計を再計算する。**それ以外の種別は上記の冪等契約のまま**で、
/// 戻り値は更新時も必ず `RecordResult{false,false}`（更新でバッジを再点灯させない）。
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
    // 【レビュー指摘 S-4・043e の退行ではないので修正不要】この upsert は inserted の判定より前にあるため、
    //   既存 id を**別の viewer_id を名乗って**再送されると、その視聴者行だけは作成/改名される
    //   （コメント自体は移らない＝下の combo 更新経路が保存済み行の所有者で再計算する）。結果として
    //   total_comments = 0 の視聴者行が一覧に現れうるが、これは 043e 以前（重複 id は即 return）でも
    //   同じく step1 が commit されていた**既存挙動**であり、今回の変更で悪化していない。
    //   再修正トリガー: 「コメント 0 件の視聴者が一覧に出る」がユーザー体験上の問題になったら、
    //   upsert を実挿入時のみに寄せる（判定順序の見直し＝038c 判定への波及があるため単独タスク化する）。
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
            (id, viewer_id, session_id, source, text, event_type, amount, currency, monetary_amount, raid_viewer_count, published_at, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
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
            // 062a: レイド人数（raid 以外は None＝NULL）。⚠ 043e の combo 更新の SET 句には**足さない**
            //   （更新対象は amount/currency/monetary_amount/text の 4 列のまま・jewels 限定なので
            //    レイド行には到達しない。列を増やすと frontend `hasComboPayloadChanged` の比較キーとの
            //    不変条件「比較キー ⊇ 更新列」を壊す）。
            c.raid_viewer_count,
            c.published_at,
            now,
        ],
    )?;
    if inserted == 0 {
        // 043e: jewels（YouTube の combo 更新）だけは同一 id の再送が「同じギフトの**更新**」を意味するため、
        //   既存行を差し替える。それ以外は**現行どおり**ここで即 return（冪等契約は 1 バイトも変えない）。
        // 【レビュー指摘 Q-9・修正不要】この分岐は return を 3 つ持つが、いずれも tx.commit() を通り、
        //   `?` による早期脱出では tx が drop されてロールバックされる（どの経路でも境界は正しい）。
        //   別関数への抽出は読みやすくなる一方で「仕様にない大規模リファクタをしない」（CLAUDE.md）に触れる
        //   ため今回は行わない。再修正トリガー: フェーズ2 等でこの分岐にさらに条件が増えたら
        //   `fn update_jewels_combo(&tx, c, now) -> rusqlite::Result<bool>` へ切り出す。
        if c.event_type != COMBO_UPDATABLE_EVENT_TYPE {
            tx.commit()?;
            // 重複記録: 集計を触らず、判定も肯定を返さない（二重にバッジを立てない・冪等）。
            return Ok(RecordResult { first_time: false, long_absence: false });
        }
        // 更新するのは amount / currency / monetary_amount / text の 4 列のみ。
        //   published_at / session_id / viewer_id / created_at は**書き換えない**
        //   （集計の first/last と 038c 判定の基準・行の所有者・記録セッションを動かさないため）。
        //   金額は combo の最新値をそのまま採る（乗算しない＝過大計上しない安全側。043e フェーズ1）。
        // 【レビュー指摘 Q-2】**この SET 句の列を増減したら、frontend `mergeComments.ts` の
        //   `hasComboPayloadChanged` の比較キーも必ず合わせること**（不変条件「比較キー ⊇ 更新列」）。
        //   列を増やすだけだと frontend が変化を検知せず、更新が Rust へ届かないまま**静かに取りこぼす**
        //   （テストも落ちない方向のドリフトなので、この注意書きが唯一の防波堤）。
        // WHERE の event_type は「保存済み行側」の限定。上の引数側チェック（＝受信側の限定）と合わせて
        //   **二重に**縛る。見ている対象が違うので冗長ではない: 既存の chat/superchat 行の id を指定して
        //   event_type だけ "jewels" を名乗る再送を止められるのは、この WHERE だけである。
        let updated = tx.execute(
            "UPDATE viewer_comments SET amount = ?2, currency = ?3, monetary_amount = ?4, text = ?5
             WHERE id = ?1 AND event_type = 'jewels'",
            rusqlite::params![
                c.comment_id,
                c.amount,
                c.currency,
                c.monetary_amount,
                c.text,
            ],
        )?;
        if updated == 0 {
            tx.commit()?;
            return Ok(RecordResult { first_time: false, long_absence: false });
        }
        // 再計算する視聴者は **保存済み行の viewer_id**（引数 c.viewer_id は信用しない）。UPDATE は viewer_id を
        //   書き換えないため、引数で再計算すると「行は元の所有者のまま／集計だけ別視聴者を再計算」という
        //   付け替えが起きうる。行の実所有者から引けば UPDATE 対象と再計算対象が構造的に一致する（§8）。
        let owner: String = tx.query_row(
            "SELECT viewer_id FROM viewer_comments WHERE id = ?1",
            rusqlite::params![c.comment_id],
            |row| row.get(0),
        )?;
        tx.execute(RECOMPUTE_VIEWER_AGGREGATES_SQL, rusqlite::params![owner, now])?;
        tx.commit()?;
        // 更新は「新規コメント」ではないので、初見／久しぶりバッジを再点灯させない（常に両方 false）。
        return Ok(RecordResult { first_time: false, long_absence: false });
    }

    // 3) 集計を viewer_comments から再計算（bits は currency='BITS'・スパチャは実通貨のみ）。
    //    SQL 本文と設計意図は RECOMPUTE_VIEWER_AGGREGATES_SQL の doc コメントを正とする
    //    （043e で combo 更新経路と共有するため定数化した。挙動は不変）。
    tx.execute(
        RECOMPUTE_VIEWER_AGGREGATES_SQL,
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

/// 065a: 取り込み元 CSV の 1 行を `viewers` へ upsert する。**新規に作ったなら `true`** を返す。
///
/// ⚠ **1 行ぶんの SQL を 1 か所にまとめてある**（呼び出し側〔service〕がトランザクションを張る）。
///
/// ## マージ規則（ここを間違えるとユーザーの編集が消える）
///
/// | 対象 | 規則 |
/// |---|---|
/// | `imported_*` 7 列 | **常に上書き**（加算しない）＝同じ CSV を何度取り込んでも結果が同じ（冪等） |
/// | `name` / `nickname` / `note` / `label` | **CSV が非空 かつ 既存が空のときだけ**書く（非破壊マージ） |
/// | `last_comment_at` | 既存と `lcts` の**新しいほう**（[`later_timestamp`] が Rust で判定する） |
/// | `first_seen_at` | **既存行では触らない**（実測値を壊さない）。新規行のみ `lcts` |
/// | `provider` / `provider_user_id` / `created_at` | 新規行のみ |
/// | `imported_at` / `updated_at` | 常に更新 |
///
/// ⚠⚠ **`name` を無条件で上書きしないこと。** CSV の `username` は `@handle` であって表示名ではないので、
/// コメント受信で得た `display_name` を潰すと一覧の表示が退化する（親 065 の列マッピング）。
///
/// ## ⚠⚠ 再計算を当ててよい相手は「コメントを持つ視聴者」だけ
///
/// 取り込みは `viewer_comments` の行を **1 件も作らない**（コメントを捏造しない）ので、引き継ぎだけの
/// 視聴者は必ずコメント 0 件になる。そこへ [`RECOMPUTE_VIEWER_AGGREGATES_SQL`] を当てると
/// `first_seen_at` / `last_comment_at`（`TEXT NOT NULL`）へ `MIN/MAX` の NULL が入り、
/// **NOT NULL 制約違反 → トランザクション全体がロールバック → 1 行も取り込まれない**（実測済み）。
/// ⇒ コメント 0 件のときは、集計 4 列に `imported_*` をそのまま入れた upsert が**最終値**である。
///
/// ⚠ コメントを持つ視聴者では再計算のあとに `last_comment_at` を書き戻す。再計算は
/// `MAX(published_at)`（＝実測のみ）で上書きしてしまい、CSV の `lcts` が消えるため。
/// ⚠ **この書き戻しは保護されない**——その視聴者が次にコメントした瞬間、`record_comment` の再計算が
/// また `MAX(published_at)` にする。意図どおりである（`last_comment_at` は「実測の最終」列で、
/// 引き継ぎ値の保管先は `imported_first_seen_at` 側だけ）。
pub fn upsert_imported_viewer(
    conn: &Connection,
    v: &super::csv_import::ImportedViewer,
    now: &str,
) -> rusqlite::Result<bool> {
    // 既存かどうかと、**再計算を当ててよい相手か**（コメントを持つか）を 1 回で読む。
    let existing: Option<(String, bool)> = conn
        .query_row(
            "SELECT last_comment_at,
                    EXISTS(SELECT 1 FROM viewer_comments WHERE viewer_id = ?1)
             FROM viewers WHERE id = ?1",
            rusqlite::params![v.id],
            |row| Ok((row.get(0)?, row.get::<_, i64>(1)? != 0)),
        )
        .optional()?;
    let last_comment_at = match &existing {
        Some((current, _)) => later_timestamp(current, &v.last_comment_at),
        None => v.last_comment_at.clone(),
    };

    conn.execute(
        "INSERT INTO viewers
            (id, provider, provider_user_id, name, first_seen_at, last_comment_at, note,
             created_at, updated_at, nickname, label, imported_comments, imported_gifts,
             imported_gift_amount, imported_active_days, imported_stream_count,
             imported_first_seen_at, imported_name_history, imported_at,
             total_comments, gift_count, stream_count, active_days)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?8,
                 ?11, ?12, ?15, ?14)
         ON CONFLICT(id) DO UPDATE SET
             imported_comments = excluded.imported_comments,
             imported_gifts = excluded.imported_gifts,
             imported_gift_amount = excluded.imported_gift_amount,
             imported_active_days = excluded.imported_active_days,
             imported_stream_count = excluded.imported_stream_count,
             imported_first_seen_at = excluded.imported_first_seen_at,
             imported_name_history = excluded.imported_name_history,
             name = CASE WHEN viewers.name = '' AND excluded.name <> ''
                         THEN excluded.name ELSE viewers.name END,
             nickname = CASE WHEN viewers.nickname = '' AND excluded.nickname <> ''
                             THEN excluded.nickname ELSE viewers.nickname END,
             note = CASE WHEN viewers.note = '' AND excluded.note <> ''
                         THEN excluded.note ELSE viewers.note END,
             label = CASE WHEN viewers.label = '' AND excluded.label <> ''
                          THEN excluded.label ELSE viewers.label END,
             last_comment_at = excluded.last_comment_at,
             total_comments = excluded.total_comments,
             gift_count = excluded.gift_count,
             stream_count = excluded.stream_count,
             active_days = excluded.active_days,
             imported_at = excluded.imported_at,
             updated_at = excluded.updated_at",
        rusqlite::params![
            v.id,
            v.provider,
            v.provider_user_id,
            v.name,
            v.last_comment_at, // ?5: first_seen_at は**新規行のみ**（DO UPDATE 側に現れない）
            last_comment_at,   // ?6
            v.note,
            now, // ?8: created_at / updated_at / imported_at
            v.nickname,
            v.label,
            v.imported_comments,     // ?11 → total_comments の初期値も兼ねる
            v.imported_gifts,        // ?12 → gift_count
            v.imported_gift_amount,  // ?13
            v.imported_active_days,  // ?14 → active_days
            v.imported_stream_count, // ?15 → stream_count
            v.imported_first_seen_at,
            v.imported_name_history,
        ],
    )?;

    // 実測コメントがある視聴者だけ、実測 ＋ 引き継ぎで数え直す（上の doc が理由）。
    if let Some((_, true)) = existing {
        conn.execute(RECOMPUTE_VIEWER_AGGREGATES_SQL, rusqlite::params![v.id, now])?;
        // 再計算が `MAX(published_at)` で潰した CSV 由来の値を戻す。
        conn.execute(
            "UPDATE viewers SET last_comment_at = ?2 WHERE id = ?1",
            rusqlite::params![v.id, last_comment_at],
        )?;
    }
    Ok(existing.is_none())
}

/// 2 つの RFC3339 時刻のうち新しいほうを返す（判定できなければ `current` を動かさない）。
///
/// ⚠⚠ **SQL の `MAX()` を使わないのが要点である。** `MAX` は単なる文字列比較なので、
/// `last_comment_at`（プラットフォーム由来・オフセット付きが混ざりうる）と `lcts`（常に `Z` 形式）を
/// 比べると**古いほうを「新しい」と判定しうる**（実測: `MAX('...T12:00:00Z', '...T05:00:00-08:00')` は
/// 前者を返すが、実際に新しいのは後者＝13:00 UTC）。
/// これは `RECOMPUTE_VIEWER_AGGREGATES_SQL` の doc が「既に偽と実証済み」と書いている前提そのものなので、
/// **新しく書くコードで同じ罠を踏まない**——062b の `stream_session::repository::comment_times` と
/// 同じく「SQL は値を取り出すだけ・比較は Rust」に倒す。
/// ⚠ どちらかがパース不能なら `current` を返す（壊れた値で実測を過去へ動かさない安全側）。
fn later_timestamp(current: &str, candidate: &str) -> String {
    let (Ok(current_dt), Ok(candidate_dt)) = (
        DateTime::parse_from_rfc3339(current),
        DateTime::parse_from_rfc3339(candidate),
    ) else {
        return current.to_string();
    };
    if candidate_dt > current_dt {
        candidate.to_string()
    } else {
        current.to_string()
    }
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
            // 062a: レイド人数は raid のケースだけ後から差し替える（既定 None＝既存ケースの挙動は不変）。
            raid_viewer_count: None,
            published_at: published_at.to_string(),
        }
    }

    /// 062a: レイド 1 件の内部入力（レイド元＝別の viewer_id・金額なし・人数つき）。
    fn raid(comment_id: &str, viewer_id: &str, viewers: u32, published_at: &str) -> NewViewerComment {
        let mut c = nc(comment_id, viewer_id, "raid", None, None, published_at);
        // レイドの author は**レイド元の配信者**（chatter ではない）＝ mapper が raid.user_* を採る。
        c.provider_user_id = viewer_id.trim_start_matches("twitch:").to_string();
        c.name = "RaiderChannel".to_string();
        // レイドは本文を持たないのが通常（system_message へはフォールバックしない＝§9）。
        c.text = String::new();
        c.raid_viewer_count = Some(viewers);
        c
    }

    /// 043e: 保存済みコメント 1 行を id で引く（combo 更新の検証用）。
    fn comment_row(conn: &Connection, id: &str) -> ViewerCommentRecord {
        conn.query_row(
            &format!("SELECT {VIEWER_COMMENT_COLUMNS} FROM viewer_comments WHERE id = ?1"),
            rusqlite::params![id],
            row_to_comment,
        )
        .expect("comment row should exist")
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

    // ---- 062a: レイド（Twitch）----

    // 062a: レイド行は**既存のどの集計にも入らない**。レイドはサブスクでも投げ銭でもないので
    //   subscription_count / is_member / last_subscription_at / bits_* / superchat_* のいずれにも
    //   混ざってはいけない（RECOMPUTE_VIEWER_AGGREGATES_SQL に 'raid' を足す変異でレッドになる）。
    #[test]
    fn raid_is_not_counted_in_any_existing_aggregation() {
        let conn = test_conn();
        record_comment(&conn, &raid("r1", "twitch:raider", 42, "2026-01-01T00:00:00Z")).unwrap();
        let v = viewer(&conn, "twitch:raider");
        assert_eq!(v.subscription_count, 0, "レイドはサブスクではない");
        assert!(!v.is_member, "レイドでメンバー扱いにしない");
        assert_eq!(v.last_subscription_at, None, "レイドはサブスク時刻を更新しない");
        assert_eq!(v.bits_count, 0);
        assert_eq!(v.bits_amount, 0);
        assert_eq!(v.superchat_count, 0);
        assert_eq!(v.superchat_amount, 0.0);
        assert_eq!(v.superchat_currency, None);
    }

    // 062a: サブスクとレイドが同じ視聴者に混在しても、レイドはサブスク集計を 1 つも増やさない
    //   （集計 SQL の IN 句に 'raid' を足す変異は、上のテストより先にここで落ちる）。
    #[test]
    fn raid_does_not_inflate_subscription_count_when_mixed() {
        let conn = test_conn();
        record_comment(&conn, &nc("c1", "twitch:u1", "subscription", None, None, "2026-01-01T00:00:00Z")).unwrap();
        record_comment(&conn, &raid("r1", "twitch:u1", 7, "2026-01-02T00:00:00Z")).unwrap();
        record_comment(&conn, &nc("c2", "twitch:u1", "membership", None, None, "2026-01-03T00:00:00Z")).unwrap();
        let v = viewer(&conn, "twitch:u1");
        assert_eq!(v.subscription_count, 2, "subscription+membership の 2 件だけ（raid は入らない）");
        assert_eq!(
            v.last_subscription_at.as_deref(),
            Some("2026-01-03T00:00:00Z"),
            "raid（1/2）ではなく membership（1/3）が最終サブスク時刻"
        );
    }

    // 062a（穴 G・決定 (a)）: `total_comments` は `COUNT(*)` のままなので**レイド行も数える**。
    //   ⚠ このテストは「そう決めた」ことの記録である。`event_type <> 'raid'` へ変える変異はここで落ちる。
    //   決定理由（NOT NULL 制約・038 一覧の可読性・062c は非依存）は
    //   RECOMPUTE_VIEWER_AGGREGATES_SQL の doc コメントを正とする。
    #[test]
    fn raid_is_counted_in_total_comments_by_design() {
        let conn = test_conn();
        record_comment(&conn, &nc("c1", "twitch:u1", "chat", None, None, "2026-01-01T00:00:00Z")).unwrap();
        record_comment(&conn, &raid("r1", "twitch:u1", 42, "2026-01-02T00:00:00Z")).unwrap();
        let v = viewer(&conn, "twitch:u1");
        assert_eq!(v.total_comments, 2, "決定 (a): レイド行も総コメント数に数える");
        // ⚠ (b)（total だけ除外）を採らなかったことの裏返し: first/last は全行対象のままなので、
        //   「総コメント数 0 なのに最終コメント日時がある」という読めない状態は生まれない。
        assert_eq!(v.first_seen_at, "2026-01-01T00:00:00Z");
        assert_eq!(v.last_comment_at, "2026-01-02T00:00:00Z");
    }

    // 062a: レイド人数が保存され、読み戻せる（service→repository→SELECT の往復）。
    //   金額列は常に NULL（レイドは金銭ではない）。
    #[test]
    fn raid_viewer_count_is_persisted_and_read_back() {
        let conn = test_conn();
        record_comment(&conn, &raid("r1", "twitch:raider", 42, "2026-01-01T00:00:00Z")).unwrap();
        let row = comment_row(&conn, "r1");
        assert_eq!(row.event_type, "raid");
        assert_eq!(row.raid_viewer_count, Some(42), "レイド人数が保存されて読み戻せる");
        assert_eq!(row.amount, None, "レイドは金額を持たない");
        assert_eq!(row.currency, None);
        assert_eq!(row.monetary_amount, None);
        assert_eq!(row.text, "", "system_message へフォールバックしないので本文は空のまま");
    }

    // ---- 063e: チャンネルポイント（Twitch）----

    // 063e（穴 A）: チャンネルポイント行は**既存のどの課金集計にも入らない**。レイドと同じ扱いで、
    //   subscription_count / is_member / last_subscription_at / bits_* / superchat_* / gift_count の
    //   いずれにも混ざってはいけない（RECOMPUTE_VIEWER_AGGREGATES_SQL に 'channelpoint' を足す変異でレッド）。
    #[test]
    fn channel_points_are_not_counted_in_any_monetary_aggregation() {
        let conn = test_conn();
        record_comment(&conn, &nc("cp1", "twitch:u1", "channelpoint", None, None, "2026-01-01T00:00:00Z")).unwrap();
        let v = viewer(&conn, "twitch:u1");
        assert_eq!(v.subscription_count, 0, "チャンネルポイントはサブスクではない");
        assert!(!v.is_member, "チャンネルポイントでメンバー扱いにしない");
        assert_eq!(v.last_subscription_at, None);
        assert_eq!(v.bits_count, 0);
        assert_eq!(v.bits_amount, 0);
        assert_eq!(v.superchat_count, 0);
        assert_eq!(v.superchat_amount, 0.0);
        assert_eq!(v.superchat_currency, None);
        assert_eq!(v.gift_count, 0, "gift_count（課金系の件数）にも入らない");
    }

    // 063e（穴 O・決定）: `total_comments` は `COUNT(*)` のままなので**チャンネルポイント行も数える**。
    //   ⚠ このテストは「そう決めた」ことの記録である。⚠⚠ レイド（062a 決定 (a)）と結論は同じだが、
    //   **理由が 1 つ強い**——チャンネルポイントは視聴者が添えたテキスト（`user_input`）を本文に持ちうるので、
    //   「コメント」として数えるのはむしろ自然である。`event_type <> 'channelpoint'` へ変える変異はここで落ちる。
    #[test]
    fn channel_points_are_counted_in_total_comments_by_design() {
        let conn = test_conn();
        record_comment(&conn, &nc("c1", "twitch:u1", "chat", None, None, "2026-01-01T00:00:00Z")).unwrap();
        record_comment(&conn, &nc("cp1", "twitch:u1", "channelpoint", None, None, "2026-01-02T00:00:00Z")).unwrap();
        let v = viewer(&conn, "twitch:u1");
        assert_eq!(v.total_comments, 2, "決定: チャンネルポイント行も総コメント数に数える");
        assert_eq!(v.last_comment_at, "2026-01-02T00:00:00Z");
    }

    // 063e: チャンネルポイント行は金額列を持たない（mapper が monetaryAmount を付けないことの保存側の裏取り）。
    #[test]
    fn channel_point_rows_carry_no_amount() {
        let conn = test_conn();
        record_comment(&conn, &nc("cp1", "twitch:u1", "channelpoint", None, None, "2026-01-01T00:00:00Z")).unwrap();
        let row = comment_row(&conn, "cp1");
        assert_eq!(row.event_type, "channelpoint", "wire と同じ綴りで保存される");
        assert_eq!(row.amount, None);
        assert_eq!(row.currency, None);
        assert_eq!(row.monetary_amount, None);
        assert_eq!(row.raid_viewer_count, None, "レイド人数はチャンネルポイントには付かない");
    }

    // 062a: レイド以外の行では raid_viewer_count は NULL のまま（他種別に混入しない）。
    #[test]
    fn non_raid_rows_keep_null_raid_viewer_count() {
        let conn = test_conn();
        record_comment(&conn, &nc("c1", "twitch:u1", "chat", None, None, "2026-01-01T00:00:00Z")).unwrap();
        assert_eq!(comment_row(&conn, "c1").raid_viewer_count, None);
    }

    // 062a: `raid_viewer_count` 列は**冪等**に追加される。init() を繰り返し呼んでも落ちず、
    //   既に列がある DB でも ALTER TABLE を撃たない（`ensure_column` の契約）。
    #[test]
    fn raid_viewer_count_column_is_added_idempotently() {
        let conn = test_conn();
        init(&conn).unwrap();
        init(&conn).unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('viewer_comments') WHERE name = 'raid_viewer_count'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1, "列は 1 つだけ（重複追加されない）");
        // 既存行が残ったまま列が足されること（後付けマイグレーションとして成立すること）も見る。
        record_comment(&conn, &raid("r1", "twitch:raider", 5, "2026-01-01T00:00:00Z")).unwrap();
        assert_eq!(comment_row(&conn, "r1").raid_viewer_count, Some(5));
    }

    // 062a: 043e の combo 更新経路は**レイドに一切効かない**。同一 id の raid 再送は現行の冪等契約どおり
    //   0 行・集計非更新で、`raid_viewer_count` も書き換わらない（更新できるのは jewels 行だけ）。
    #[test]
    fn raid_row_is_not_updatable_by_resend() {
        let conn = test_conn();
        record_comment(&conn, &raid("r1", "twitch:raider", 42, "2026-01-01T00:00:00Z")).unwrap();
        let r = record_comment(&conn, &raid("r1", "twitch:raider", 999, "2026-01-01T00:00:00Z")).unwrap();
        assert!(!r.first_time && !r.long_absence, "再送で判定を再点灯させない");
        assert_eq!(
            comment_row(&conn, "r1").raid_viewer_count,
            Some(42),
            "レイドは同一 id 再送で書き換わらない（更新が許されるのは jewels 行だけ）"
        );
        assert_eq!(count_comments(&conn, "twitch:raider"), 1);
    }

    // 062a: レイド行も delete_viewer の FK CASCADE で取り残しなく消える
    //   （security.md「削除手段は新テーブル・新列ゼロのため取り残しゼロ」の 062a 版の担保）。
    #[test]
    fn deleting_viewer_removes_raid_comment() {
        let conn = test_conn();
        record_comment(&conn, &raid("r1", "twitch:raider", 42, "2026-01-01T00:00:00Z")).unwrap();
        delete(&conn, "twitch:raider").unwrap();
        let remaining: i64 = conn
            .query_row("SELECT COUNT(*) FROM viewer_comments", [], |r| r.get(0))
            .unwrap();
        assert_eq!(remaining, 0, "レイド行も CASCADE で消える");
    }

    // ---- 043e: jewels の combo 更新（同一 id 再送で既存行を差し替える。他種別は現行どおり）----

    // 043e-P1: jewels の同一 id 再送で amount/monetary_amount/text が最新値へ置き換わる。
    //   行は増えない（combo は論理的に 1 ギフト＝total_comments は 1 のまま）。戻り値は {false,false}
    //   （更新で初見/久しぶりバッジを再点灯させない）。
    #[test]
    fn jewels_combo_update_replaces_amount_and_keeps_single_row() {
        let conn = test_conn();
        let mut first = nc("g1", "youtube:u1", "jewels", Some(30.0), Some("JEWELS"), "2026-01-01T00:00:00Z");
        first.monetary_amount = Some("30 JEWELS".to_string());
        assert!(record_comment(&conn, &first).unwrap().first_time);

        let mut combo = first;
        combo.amount = Some(90.0);
        combo.monetary_amount = Some("90 JEWELS".to_string());
        combo.text = "combo!".to_string();
        let r = record_comment(&conn, &combo).unwrap();
        assert!(!r.first_time, "combo 更新で初見を再点灯させない");
        assert!(!r.long_absence);

        let row = comment_row(&conn, "g1");
        assert_eq!(row.amount, Some(90.0), "最新の jewels 額へ置き換わる");
        assert_eq!(row.monetary_amount.as_deref(), Some("90 JEWELS"));
        assert_eq!(row.text, "combo!");
        assert_eq!(count_comments(&conn, "youtube:u1"), 1, "表示・記録とも 1 ギフト＝1 行");
        assert_eq!(viewer(&conn, "youtube:u1").total_comments, 1);
    }

    // 043e-P2: combo 更新は published_at を書き換えない（集計 first/last と 038c 判定の基準を動かさない）。
    #[test]
    fn jewels_combo_update_preserves_published_at() {
        let conn = test_conn();
        record_comment(&conn, &nc("g1", "youtube:u1", "jewels", Some(30.0), Some("JEWELS"), "2026-01-01T00:00:00Z")).unwrap();
        // 再送の published_at がずれて届いても、行の published_at は初回のまま。
        let mut combo = nc("g1", "youtube:u1", "jewels", Some(90.0), Some("JEWELS"), "2026-06-30T00:00:00Z");
        combo.session_id = "sess-2".to_string();
        record_comment(&conn, &combo).unwrap();

        let row = comment_row(&conn, "g1");
        assert_eq!(row.published_at, "2026-01-01T00:00:00Z", "published_at は不変");
        assert_eq!(row.session_id, "sess-1", "session_id も不変");
        let v = viewer(&conn, "youtube:u1");
        assert_eq!(v.first_seen_at, "2026-01-01T00:00:00Z");
        assert_eq!(v.last_comment_at, "2026-01-01T00:00:00Z");
    }

    // 043e-P3: 同じコメント id を**別の viewer_id**で再送しても行の所有者は変わらず、集計の再計算対象も
    //   元の視聴者のまま（引数の viewer_id を信用しない＝コメントの付け替え防止）。
    #[test]
    fn jewels_combo_update_does_not_move_comment_to_another_viewer() {
        let conn = test_conn();
        record_comment(&conn, &nc("g1", "youtube:u1", "jewels", Some(30.0), Some("JEWELS"), "2026-01-01T00:00:00Z")).unwrap();
        let mut hijack = nc("g1", "youtube:u2", "jewels", Some(90.0), Some("JEWELS"), "2026-01-01T00:00:00Z");
        hijack.provider_user_id = "u2".to_string();
        record_comment(&conn, &hijack).unwrap();

        let row = comment_row(&conn, "g1");
        assert_eq!(row.viewer_id, "youtube:u1", "行の所有者は元の視聴者のまま");
        assert_eq!(row.amount, Some(90.0), "金額は更新される（更新自体は成立する）");
        assert_eq!(count_comments(&conn, "youtube:u1"), 1);
        assert_eq!(count_comments(&conn, "youtube:u2"), 0, "別視聴者へ行は移らない");
        assert_eq!(viewer(&conn, "youtube:u1").total_comments, 1, "元の視聴者の集計が再計算される");
    }

    // 043e-P4: jewels 以外は同一 id 再送で**一切更新しない**（既存の冪等契約の限定＝退行検知）。
    //   金額・本文とも据え置きで、superchat 集計にも波及しない。
    #[test]
    fn non_jewels_duplicate_id_does_not_update_row() {
        let conn = test_conn();
        let mut first = nc("c1", "youtube:u1", "superchat", Some(500.0), Some("JPY"), "2026-01-01T00:00:00Z");
        first.monetary_amount = Some("500 JPY".to_string());
        record_comment(&conn, &first).unwrap();

        let mut resend = first;
        resend.amount = Some(9999.0);
        resend.monetary_amount = Some("9999 JPY".to_string());
        resend.text = "tampered".to_string();
        let r = record_comment(&conn, &resend).unwrap();
        assert!(!r.first_time);
        assert!(!r.long_absence);

        let row = comment_row(&conn, "c1");
        assert_eq!(row.amount, Some(500.0), "jewels 以外は金額を更新しない");
        assert_eq!(row.monetary_amount.as_deref(), Some("500 JPY"));
        assert_eq!(row.text, "hi", "jewels 以外は本文も更新しない");
        let v = viewer(&conn, "youtube:u1");
        assert_eq!(v.superchat_count, 1);
        assert_eq!(v.superchat_amount, 500.0, "集計にも波及しない");
    }

    // 043e-P4a（レビュー指摘 S-1）: **保存済み行が jewels 以外**なら、受信側が event_type="jewels" を
    //   名乗っても既存行は書き換わらない。これを止めているのは SQL の `AND event_type = 'jewels'` **だけ**で
    //   （引数側チェックは受信種別が jewels なので通過する）、未認証 loopback WS から
    //   「既存 chat コメントの id ＋ eventType: jewels」を送られたときの唯一の防波堤。
    //   ※ P4 と分けているのは、P4（保存も受信も superchat）では二重ロックの両層が同時に効くため、
    //     SQL 側だけを外しても検知できないから。この 2 件で各層を単独に固定する。
    #[test]
    fn stored_non_jewels_row_is_not_updated_by_incoming_jewels() {
        let conn = test_conn();
        let mut first = nc("x1", "youtube:u1", "chat", None, None, "2026-01-01T00:00:00Z");
        first.text = "ふつうのコメント".to_string();
        record_comment(&conn, &first).unwrap();

        // 同一 id を jewels と名乗って金額つきで再送する（なりすまし種別）。
        let mut spoof = nc("x1", "youtube:u1", "jewels", Some(9999.0), Some("JEWELS"), "2026-01-01T00:00:00Z");
        spoof.monetary_amount = Some("9999 JEWELS".to_string());
        spoof.text = "tampered".to_string();
        let r = record_comment(&conn, &spoof).unwrap();
        assert!(!r.first_time);
        assert!(!r.long_absence);

        let row = comment_row(&conn, "x1");
        assert_eq!(row.event_type, "chat", "保存済み行の種別は変わらない");
        assert_eq!(row.text, "ふつうのコメント", "本文は書き換わらない（SQL の WHERE が守る）");
        assert_eq!(row.amount, None, "金額も付かない");
        assert_eq!(row.monetary_amount, None);
    }

    // 043e-P4b（レビュー指摘 S-1）: **保存済み行が jewels でも、受信側が jewels 以外**なら更新しない。
    //   これを止めているのは引数側の早期 return **だけ**（SQL の WHERE は保存済み行が jewels なので通る）。
    #[test]
    fn stored_jewels_row_is_not_updated_by_incoming_non_jewels() {
        let conn = test_conn();
        let mut first = nc("g1", "youtube:u1", "jewels", Some(30.0), Some("JEWELS"), "2026-01-01T00:00:00Z");
        first.monetary_amount = Some("30 JEWELS".to_string());
        record_comment(&conn, &first).unwrap();

        let mut resend = nc("g1", "youtube:u1", "chat", Some(9999.0), Some("JPY"), "2026-01-01T00:00:00Z");
        resend.monetary_amount = Some("9999 JPY".to_string());
        resend.text = "tampered".to_string();
        record_comment(&conn, &resend).unwrap();

        let row = comment_row(&conn, "g1");
        assert_eq!(row.amount, Some(30.0), "受信側が jewels 以外なら金額は据え置き（引数側チェックが守る）");
        assert_eq!(row.currency.as_deref(), Some("JEWELS"));
        assert_eq!(row.monetary_amount.as_deref(), Some("30 JEWELS"));
        assert_eq!(row.text, "hi");
    }

    // 043e（レビュー指摘 Q-4）: 二重管理の値ドリフト検知。COMBO_UPDATABLE_EVENT_TYPE と UPDATE 文の
    //   SQL リテラルは**意図的に**別々に持っている（対象が受信側/保存済み行側で異なるため）ので、
    //   共通化する代わりに値が一致していることだけをテストで固定する。
    #[test]
    fn combo_updatable_event_type_matches_sql_literal() {
        assert_eq!(
            COMBO_UPDATABLE_EVENT_TYPE, "jewels",
            "定数を変えたら record_comment の UPDATE 文の AND event_type = 'jewels' も合わせること"
        );
    }

    // 043e-P5: jewels の combo 更新後も既存集計の切り分け（043a）は不変。JEWELS は bits にも superchat にも
    //   入らず、subscription 系にも入らない。total_comments だけが 1 のまま数えられる。
    #[test]
    fn jewels_combo_update_does_not_leak_into_other_aggregations() {
        let conn = test_conn();
        record_comment(&conn, &nc("g1", "youtube:u1", "jewels", Some(30.0), Some("JEWELS"), "2026-01-01T00:00:00Z")).unwrap();
        record_comment(&conn, &nc("g1", "youtube:u1", "jewels", Some(900.0), Some("JEWELS"), "2026-01-01T00:00:00Z")).unwrap();
        let v = viewer(&conn, "youtube:u1");
        assert_eq!(v.bits_count, 0);
        assert_eq!(v.bits_amount, 0);
        assert_eq!(v.superchat_count, 0);
        assert_eq!(v.superchat_amount, 0.0);
        assert_eq!(v.subscription_count, 0);
        assert_eq!(v.total_comments, 1);
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

    // ---- 065a: CSV からの引き継ぎ（列追加・再計算 SQL の加算・バックフィル）----
    //
    // ⚠ 段 1 の時点では取り込みコマンドがまだ無いので、`imported_*` は直接書いて検証する
    //   （段 2 で CSV パース経由の同じ性質をテストし直す）。

    /// 引き継ぎ値だけを直接書き込む（段 2 の upsert が入るまでの代役）。
    fn set_imported(conn: &Connection, id: &str, comments: i64, gifts: i64, days: i64, streams: i64) {
        conn.execute(
            "UPDATE viewers SET imported_comments = ?2, imported_gifts = ?3,
                 imported_active_days = ?4, imported_stream_count = ?5, imported_at = ?6
             WHERE id = ?1",
            rusqlite::params![id, comments, gifts, days, streams, "2026-08-16T00:00:00Z"],
        )
        .expect("引き継ぎ値を書けない");
    }

    /// CSV から作った直後の視聴者（**`viewer_comments` の行は 1 件も無い**）を模す。
    ///
    /// ⚠ 集計列に `imported_*` をそのまま入れるのは、この視聴者では再計算が一度も走っていないため
    ///   （段 2 の取り込みも同じ形で書く）。
    fn insert_imported_only_viewer(conn: &Connection, id: &str, lcts: &str, comments: i64) {
        conn.execute(
            "INSERT INTO viewers
                (id, provider, provider_user_id, name, first_seen_at, last_comment_at, note,
                 created_at, updated_at, imported_comments, total_comments, imported_at,
                 imported_first_seen_at)
             VALUES (?1, 'youtube', 'UCtest', '', ?2, ?2, '', ?3, ?3, ?4, ?4, ?3, ?2)",
            rusqlite::params![id, lcts, "2026-08-16T00:00:00Z", comments],
        )
        .expect("引き継ぎのみの視聴者を作れない");
    }

    /// 065a 以前（＝13 列が無い）のスキーマを手で作る。⚠ `CREATE TABLE IF NOT EXISTS` は既存表に
    /// 何もしないので、これで「既存 DB に後から列を足す」経路そのものを踏める。
    fn pre_065a_conn() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory SQLite を開けない");
        conn.execute("PRAGMA foreign_keys = ON", []).unwrap();
        conn.execute_batch(
            "CREATE TABLE viewers (
                id TEXT PRIMARY KEY, provider TEXT NOT NULL, provider_user_id TEXT NOT NULL,
                name TEXT NOT NULL, first_seen_at TEXT NOT NULL, last_comment_at TEXT NOT NULL,
                total_comments INTEGER NOT NULL DEFAULT 0, bits_count INTEGER NOT NULL DEFAULT 0,
                bits_amount INTEGER NOT NULL DEFAULT 0, superchat_count INTEGER NOT NULL DEFAULT 0,
                superchat_amount REAL NOT NULL DEFAULT 0, superchat_currency TEXT,
                subscription_count INTEGER NOT NULL DEFAULT 0, is_member INTEGER NOT NULL DEFAULT 0,
                last_subscription_at TEXT, note TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE TABLE viewer_comments (
                id TEXT PRIMARY KEY,
                viewer_id TEXT NOT NULL REFERENCES viewers(id) ON DELETE CASCADE,
                session_id TEXT NOT NULL, source TEXT NOT NULL, text TEXT NOT NULL,
                event_type TEXT NOT NULL, amount REAL, currency TEXT, monetary_amount TEXT,
                raid_viewer_count INTEGER, published_at TEXT NOT NULL, created_at TEXT NOT NULL
            );",
        )
        .expect("065a 以前のスキーマを作れない");
        conn
    }

    /// 065a 以前のスキーマへ、視聴者 1 人とコメントを直接入れる（`record_comment` は新列に依存するため使えない）。
    fn seed_pre_065a_viewer(conn: &Connection, id: &str, comments: &[(&str, &str, &str)]) {
        conn.execute(
            "INSERT INTO viewers
                (id, provider, provider_user_id, name, first_seen_at, last_comment_at,
                 total_comments, note, created_at, updated_at)
             VALUES (?1, 'twitch', 'u1', 'Alice', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z',
                 ?2, '', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            rusqlite::params![id, comments.len() as i64],
        )
        .expect("旧スキーマへ視聴者を入れられない");
        for (comment_id, session_id, published_at) in comments {
            conn.execute(
                "INSERT INTO viewer_comments
                    (id, viewer_id, session_id, source, text, event_type, published_at, created_at)
                 VALUES (?1, ?2, ?3, 'twitch', 'hi', 'chat', ?4, '2026-01-01T00:00:00Z')",
                rusqlite::params![comment_id, id, session_id, published_at],
            )
            .expect("旧スキーマへコメントを入れられない");
        }
    }

    // T-1 ⚠⚠ **本タスクの中心**。引き継いだ累積は、その人が次にコメントしても再計算で消えない。
    //   変異 M-1（再計算 SQL から `+ COALESCE(imported_comments, 0)` を外す）はここで落ちる。
    #[test]
    fn imported_totals_survive_recompute() {
        let conn = test_conn();
        record_comment(&conn, &nc("c1", "twitch:u1", "chat", None, None, "2026-01-01T00:00:00Z")).unwrap();
        set_imported(&conn, "twitch:u1", 7, 3, 5, 2);
        // 引き継ぎを書いた直後はまだ再計算が走っていない（total は実測の 1 のまま）。
        assert_eq!(viewer(&conn, "twitch:u1").total_comments, 1);

        // ⚠ ここが 038a の recompute-on-write と正面からぶつかっていた箇所。
        record_comment(&conn, &nc("c2", "twitch:u1", "chat", None, None, "2026-01-02T00:00:00Z")).unwrap();
        let v = viewer(&conn, "twitch:u1");
        assert_eq!(v.total_comments, 9, "実測 2 件 ＋ 引き継ぎ 7 件（0 や 2 に戻ったら加算が効いていない）");
        assert_eq!(v.gift_count, 3, "課金 0 件 ＋ 引き継ぎ 3");
        assert_eq!(v.stream_count, 3, "セッション 1 本 ＋ 引き継ぎ 2");
        assert_eq!(v.active_days, 7, "実測 2 日 ＋ 引き継ぎ 5");
        // ⚠ 引き継ぎ列そのものは再計算 SQL が触らないので不変（ここが壊れると二重加算が始まる）。
        assert_eq!(v.imported_comments, 7);
        assert_eq!(v.imported_gifts, 3);
        assert_eq!(v.imported_active_days, 5);
        assert_eq!(v.imported_stream_count, 2);
    }

    // T-1b: 再計算が**何度走っても**引き継ぎ分は 1 回しか足されない（増分ドリフトが起きない）。
    #[test]
    fn imported_totals_are_added_once_per_recompute_not_accumulated() {
        let conn = test_conn();
        record_comment(&conn, &nc("c1", "twitch:u1", "chat", None, None, "2026-01-01T00:00:00Z")).unwrap();
        set_imported(&conn, "twitch:u1", 7, 0, 0, 0);
        for (i, day) in ["02", "03", "04"].iter().enumerate() {
            record_comment(
                &conn,
                &nc(&format!("x{i}"), "twitch:u1", "chat", None, None, &format!("2026-01-{day}T00:00:00Z")),
            )
            .unwrap();
        }
        assert_eq!(viewer(&conn, "twitch:u1").total_comments, 11, "実測 4 ＋ 引き継ぎ 7（累積しない）");
    }

    // T-2 ⚠ `gift_count` に `raid` と `chat` を入れない（レイドは課金ではない＝062a）。
    //   変異 M-5（集合に 'raid' を足す）はここで落ちる。
    #[test]
    fn gift_count_excludes_raid_and_chat() {
        let conn = test_conn();
        record_comment(&conn, &nc("c1", "twitch:u1", "chat", None, None, "2026-01-01T00:00:00Z")).unwrap();
        record_comment(&conn, &raid("r1", "twitch:u1", 42, "2026-01-02T00:00:00Z")).unwrap();
        let v = viewer(&conn, "twitch:u1");
        assert_eq!(v.gift_count, 0, "chat も raid も統合ギフト回数に入らない");
        assert_eq!(v.total_comments, 2, "総コメント数には両方数える（062a の決定 (a) は不変）");
    }

    // T-3: 課金 6 種別はすべて `gift_count` に数える（集合を減らす変異を検知する）。
    #[test]
    fn gift_count_includes_the_six_paid_types() {
        let conn = test_conn();
        for (i, event_type) in ["superchat", "membership", "subscription", "gift", "donation", "jewels"]
            .iter()
            .enumerate()
        {
            record_comment(
                &conn,
                &nc(&format!("p{i}"), "twitch:u1", event_type, None, None, &format!("2026-01-0{}T00:00:00Z", i + 1)),
            )
            .unwrap();
        }
        record_comment(&conn, &nc("c9", "twitch:u1", "chat", None, None, "2026-01-08T00:00:00Z")).unwrap();
        record_comment(&conn, &raid("r9", "twitch:u1", 5, "2026-01-09T00:00:00Z")).unwrap();
        let v = viewer(&conn, "twitch:u1");
        assert_eq!(v.gift_count, 6, "課金 6 種別だけを数える");
        assert_eq!(v.total_comments, 8);
    }

    // T-4 ⚠⚠ `active_days` は **UTC 日**で数え、**壊れた `published_at` は黙って落ちる**。
    //   どちらも「そう決めた」ことの記録である（穴 C の決定①）。
    #[test]
    fn active_days_counts_utc_days_and_ignores_broken_timestamps() {
        let conn = test_conn();
        // 8/15 23:00Z と 8/16 01:00Z は **JST では同じ 8/16**（08:00 と 10:00）だが、UTC では別の日。
        record_comment(&conn, &nc("c1", "twitch:u1", "chat", None, None, "2026-08-15T23:00:00Z")).unwrap();
        record_comment(&conn, &nc("c2", "twitch:u1", "chat", None, None, "2026-08-16T01:00:00Z")).unwrap();
        // ⚠ オフセット付きは SQLite の `date()` が UTC へ正規化する（実測: date('...T02:00:00+09:00') = 08-15）
        //   ＝ c1 と同じ UTC 日に畳まれる。
        record_comment(&conn, &nc("c3", "twitch:u1", "chat", None, None, "2026-08-16T02:00:00+09:00")).unwrap();
        assert_eq!(viewer(&conn, "twitch:u1").active_days, 2, "UTC 日で 08-15 と 08-16 の 2 日");

        // ⚠⚠ 壊れた時刻は `date()` が NULL を返し、`COUNT(DISTINCT ...)` が**エラーにせず落とす**。
        //   ＝ active_days は少なめに出る（水増しより安全側なので受容している）。
        record_comment(&conn, &nc("c4", "twitch:u1", "chat", None, None, "bogus-timestamp")).unwrap();
        let v = viewer(&conn, "twitch:u1");
        assert_eq!(v.active_days, 2, "壊れた時刻は 1 日として数えない（黙って落ちる＝受容した挙動）");
        assert_eq!(v.total_comments, 4, "総コメント数には数える（取りこぼしゼロ）");
    }

    // T-4b: 引き継ぎ分は実測日数へ**足される**（左右で「1 日」の定義が違う近似であることは doc が正）。
    #[test]
    fn active_days_adds_the_imported_baseline() {
        let conn = test_conn();
        record_comment(&conn, &nc("c1", "twitch:u1", "chat", None, None, "2026-08-15T23:00:00Z")).unwrap();
        set_imported(&conn, "twitch:u1", 0, 0, 9, 0);
        record_comment(&conn, &nc("c2", "twitch:u1", "chat", None, None, "2026-08-16T01:00:00Z")).unwrap();
        assert_eq!(viewer(&conn, "twitch:u1").active_days, 11, "UTC 2 日 ＋ 引き継ぎ 9 日");
    }

    // T-5 ⚠ `stream_count` は `session_id` の異なり数。**062b 以前のデータでは多めに出る**ことを
    //   決定として記録する（コメビュ窓のマウント単位で id が変わっていたため）。
    #[test]
    fn stream_count_counts_distinct_session_ids_including_pre_062b_inflation() {
        let conn = test_conn();
        // 同じ 1 回の配信中に窓を開き直した＝062b 以前は別 session_id になっていた形。
        let mut a = nc("c1", "twitch:u1", "chat", None, None, "2026-08-16T10:00:00Z");
        a.session_id = "mount-1".to_string();
        let mut b = nc("c2", "twitch:u1", "chat", None, None, "2026-08-16T11:00:00Z");
        b.session_id = "mount-2".to_string();
        record_comment(&conn, &a).unwrap();
        record_comment(&conn, &b).unwrap();
        assert_eq!(
            viewer(&conn, "twitch:u1").stream_count,
            2,
            "⚠ 実際は 1 配信だが 2 と数える（062b 以前の粒度をそのまま反映する＝受容した歪み）"
        );
    }

    // T-6: 13 列は**冪等**に追加される（起動のたびに init が走るため）。
    #[test]
    fn the_065a_columns_are_added_idempotently() {
        let conn = test_conn();
        init(&conn).unwrap();
        init(&conn).unwrap();
        for column in [
            "nickname", "label", "imported_comments", "imported_gifts", "imported_gift_amount",
            "imported_active_days", "imported_stream_count", "imported_first_seen_at",
            "imported_name_history", "imported_at", "gift_count", "stream_count", "active_days",
        ] {
            let count: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM pragma_table_info('viewers') WHERE name = ?1",
                    rusqlite::params![column],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(count, 1, "{column} が 1 列だけ存在しない（重複追加か未追加）");
        }
    }

    // T-7 ⚠⚠ **穴 K**。065a 以前に作られた DB では、新しい集計 3 列は再計算が走るまで 0 のままになる。
    //   ＝ もう来ない常連さんが「参加配信数 0」で永久に固定される。列を足した 1 回だけ埋めること。
    //   変異 M-8（バックフィルを消す）はここで落ちる。
    #[test]
    fn a_database_created_before_065a_gains_the_new_columns_and_is_backfilled() {
        let conn = pre_065a_conn();
        seed_pre_065a_viewer(
            &conn,
            "twitch:old",
            &[
                ("o1", "sess-a", "2026-08-15T23:00:00Z"),
                ("o2", "sess-a", "2026-08-16T01:00:00Z"),
                ("o3", "sess-b", "2026-08-16T02:00:00Z"),
            ],
        );

        init(&conn).expect("既存 DB に対する init が失敗した");
        let v = viewer(&conn, "twitch:old");
        assert_eq!(v.stream_count, 2, "sess-a / sess-b の 2 本（0 のままなら埋めていない）");
        assert_eq!(v.active_days, 2, "UTC で 08-15 と 08-16 の 2 日");
        assert_eq!(v.total_comments, 3, "引き継ぎ 0 なので実測どおり");
        assert_eq!(v.gift_count, 0, "課金イベントが無いので 0（この 0 は正しい 0）");

        // ⚠ 2 回目の init では列が既にあるのでバックフィルは走らない（＝二重に足されない）。
        init(&conn).expect("init が冪等でない");
        assert_eq!(viewer(&conn, "twitch:old").stream_count, 2, "起動のたびに値が動いてはいけない");
    }

    // T-8 ⚠⚠ **穴 J**。コメント 0 件の視聴者へ全再計算を当てると `first_seen_at` へ NULL が入り、
    //   **NOT NULL 制約違反でトランザクション全体がロールバック**する（062a が案 (c) を却下した理由①）。
    //   ここが壊れると「起動時の init が失敗してアプリが立ち上がらない」になる。
    //   ⚠ コメント 0 件の視聴者は実在しうる（`record_comment` の step1 が判定より前にあるため・S-4 注記）。
    #[test]
    fn backfill_does_not_break_on_viewers_without_comments() {
        let conn = pre_065a_conn();
        // コメントを 1 件も持たない視聴者（旧スキーマ）。
        conn.execute(
            "INSERT INTO viewers
                (id, provider, provider_user_id, name, first_seen_at, last_comment_at,
                 total_comments, note, created_at, updated_at)
             VALUES ('twitch:ghost', 'twitch', 'ghost', '', '2026-01-01T00:00:00Z',
                 '2026-01-01T00:00:00Z', 0, '', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            [],
        )
        .unwrap();
        seed_pre_065a_viewer(&conn, "twitch:real", &[("o1", "sess-a", "2026-08-16T01:00:00Z")]);

        init(&conn).expect("⚠⚠ コメント 0 件の視聴者でバックフィルが落ちた（起動不能になる）");

        // 落ちなかっただけでなく、コメントを持つ視聴者はちゃんと埋まっている。
        assert_eq!(viewer(&conn, "twitch:real").stream_count, 1);
        // コメント 0 件の視聴者は触られず、NOT NULL 列も壊れていない。
        let ghost = viewer(&conn, "twitch:ghost");
        assert_eq!(ghost.stream_count, 0);
        assert_eq!(ghost.first_seen_at, "2026-01-01T00:00:00Z", "実測が無い行の時刻を NULL で潰さない");
    }

    // T-10 ⚠⚠ **親 065 の主目的**。引き継ぎで `viewers` 行があれば、その人の初コメントに初見バッジが出ない。
    #[test]
    fn first_time_does_not_fire_for_an_imported_viewer() {
        let conn = test_conn();
        insert_imported_only_viewer(&conn, "youtube:UCtest", "2026-08-15T23:29:04.288Z", 42);
        let r = record_comment(
            &conn,
            &nc("c1", "youtube:UCtest", "chat", None, None, "2026-08-16T10:00:00Z"),
        )
        .unwrap();
        assert!(!r.first_time, "⚠⚠ 引き継いだ常連さんに初見バッジを出さない（本機能の一番の目的）");
        // 引き継いだ累積は最初のコメントの後も残る。
        assert_eq!(viewer(&conn, "youtube:UCtest").total_comments, 43, "42 ＋ 実測 1");
    }

    // T-9 ⚠⚠ **穴 B の決定①（受容）を記録として固定する。**
    //   引き継ぎ行の `last_comment_at` は CSV の `lcts` なので、**1 ヶ月以上前の CSV を取り込むと
    //   その人の次のコメントで「久しぶり」が出る**。意味論としては正しい（実際 1 ヶ月来ていない）ので
    //   受容した。⚠ 実運用で誤爆が問題になったら 038 側で「観測した前回コメントだけを基準にする」を起票する
    //   （`viewer_comments` に行があるかを見れば新しい状態は要らない）。
    #[test]
    fn long_absence_fires_for_an_imported_viewer_by_design() {
        let conn = test_conn();
        // 2 ヶ月前にエクスポートされた CSV を取り込んだ状態。
        insert_imported_only_viewer(&conn, "youtube:UCstale", "2026-06-01T00:00:00Z", 100);
        let r = record_comment(
            &conn,
            &nc("c1", "youtube:UCstale", "chat", None, None, "2026-08-16T10:00:00Z"),
        )
        .unwrap();
        assert!(!r.first_time, "初見は出ない（引き継ぎ行がある）");
        assert!(r.long_absence, "⚠ 古い CSV を取り込むと「久しぶり」が出る＝受容した挙動");

        // 対照: 直前にエクスポートした CSV なら誤爆しない（実運用の通常経路）。
        insert_imported_only_viewer(&conn, "youtube:UCfresh", "2026-08-15T23:29:04.288Z", 100);
        let fresh = record_comment(
            &conn,
            &nc("c2", "youtube:UCfresh", "chat", None, None, "2026-08-16T10:00:00Z"),
        )
        .unwrap();
        assert!(!fresh.first_time);
        assert!(!fresh.long_absence, "取り込む直前にエクスポートしていればバッジは出ない");
    }

    // T-23（段 1 ぶん）: 引き継ぎ列は `viewers` の列なので、既存の削除手段がそのまま効く（§9・⑪）。
    #[test]
    fn deleting_an_imported_viewer_removes_every_imported_column() {
        let conn = test_conn();
        insert_imported_only_viewer(&conn, "youtube:UCtest", "2026-08-15T23:29:04.288Z", 42);
        assert_eq!(delete(&conn, "youtube:UCtest").unwrap(), 1);
        assert!(get(&conn, "youtube:UCtest").unwrap().is_none(), "行ごと消えるので引き継ぎ値も残らない");

        insert_imported_only_viewer(&conn, "youtube:UCtest2", "2026-08-15T23:29:04.288Z", 7);
        clear(&conn).unwrap();
        let remaining: i64 = conn.query_row("SELECT COUNT(*) FROM viewers", [], |r| r.get(0)).unwrap();
        assert_eq!(remaining, 0, "全消去でも取り残しゼロ");
    }
}
