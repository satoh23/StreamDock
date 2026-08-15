//! 062c: 配信サマリーの DTO。
//!
//! ⚠⚠ **binding の出力先が `comment-viewer/bindings/` なのは意図的**（`StreamSessionRecord` と同じ理由）。
//! `package.json` の `check:bindings` は**ハードコードされた 6 ディレクトリしか見ない**ので、そこに無い
//! ディレクトリへ出すと `git diff --exit-code` の対象外になり、**生成漏れがあってもチェックが緑になる**
//! （実際 `src/features/rakuraku/bindings` が列挙から漏れている）。
//! さらに `StreamSummary` は `StreamSessionRecord` を**内包する**ので、同じディレクトリに出すと
//! ts-rs が吐く相対 import（`./StreamSessionRecord`）がそのまま解決する。
//! ⚠ 専用ディレクトリ（`src/features/stream-summary/bindings/`）へ移すなら、
//! **`check:bindings` の列挙に足すこととセット**でなければならない。
//!
//! ⚠ 数値の型は既存の `ViewerRecord` に揃えて **件数＝`u32` / 金額＝`f64`**（タスクファイルの擬似コードは
//! `i64` と書いているが、視聴者一覧と同じ型にしておかないと frontend 側で無用な差が出る）。

use serde::Serialize;
use ts_rs::TS;

use crate::stream_session::model::StreamSessionRecord;

/// ある通貨の合計（実通貨も `BITS` もこの形で並ぶ。**換算はしない**＝親 062 (2) の決定）。
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/features/comment-viewer/bindings/")]
pub struct CurrencyTotal {
    /// 通貨コード（`"JPY"` / `"USD"` / `"BITS"` …）。⚠ **`"JEWELS"` は現れない**（論点 3）。
    pub currency: String,
    /// 合計額（**verbatim**。通貨をまたいで足さない）。
    pub amount: f64,
    /// 件数。
    pub count: u32,
}

/// 課金の**種別ごと**の内訳（種別 × 通貨）。
///
/// ⚠⚠ **訂正 2 (A)〔donation を総課金額に含める〕の副作用の手当てがこれ。** 総額に donation を混ぜる以上、
/// 「視聴者一覧の『スパチャ額』はスパチャだけ」という違いを画面で説明できないと数字が食い違って見える。
/// ⇒ サマリー側で「スパチャ / ビッツ / ドネーション」を分けて出せるようにしてある。
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/features/comment-viewer/bindings/")]
pub struct MonetaryKindTotal {
    /// 種別。`"superchat"` / `"bits"` / `"donation"` …。
    ///
    /// ⚠ **ビッツは `event_type='superchat'` ＋ `currency='BITS'` で届く**（専用種別が無い）ので、
    /// ここでは `currency='BITS'` の行を `"bits"` へ振り替えている（frontend の `displayEventType`
    /// と同じ考え方）。未知の種別は `event_type` の生値がそのまま入る＝画面側はラベルが引けなければ
    /// 生値で無害に劣化させること。
    pub kind: String,
    pub currency: String,
    pub amount: f64,
    pub count: u32,
}

/// 課金・サブスクをしてくれた視聴者 1 人分（⚠ **マスト要件の主役**）。
///
/// ⚠⚠ **論点 4: ここに「レイドしかしていない配信者」は入らない。** レイド元は
/// `viewer_comments.viewer_id`（FK NOT NULL）の都合で `viewers` に行ができるため、`viewers` 由来で
/// 組むと**課金 0 円のレイド元**が貢献者一覧に並ぶ。本 DTO は「課金 or サブスクの行にヒットした
/// 視聴者」からしか組み立てない＝**絞り込みが後付けの `filter` ではなくクエリの構造そのもの**なので、
/// うっかり外れることがない。
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/features/comment-viewer/bindings/")]
pub struct Contributor {
    /// 視聴者の安定キー（`provider:providerUserId`）。**038b の視聴者詳細へそのまま渡せる。**
    pub viewer_id: String,
    /// 表示名（`viewers.name`＝**今の名前**。穴 F を参照）。
    pub name: String,
    /// 配信元（`viewers.provider`）。
    pub source: String,
    /// **この配信での**通貨ごとの課金（⚠ 全期間の累計ではない）。
    pub monetary_by_currency: Vec<CurrencyTotal>,
    /// **この配信での**サブスク系（`subscription` / `membership` / `gift`）の件数。
    pub subscription_count: u32,
    /// この配信で最初に課金 or サブスクをしてくれた時刻（`published_at`）。
    pub first_at: String,
}

/// レイド 1 件（⚠ **マスト要件・Twitch のみ**。YouTube に相当機能は無い）。
///
/// 出所は `viewer_comments` の `event_type='raid'` 行（062a）。`viewers` 側の集計には入っていない。
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/features/comment-viewer/bindings/")]
pub struct RaidRecord {
    /// レイド元チャンネル名（`viewers.name`＝穴 A の線引きで JOIN 可）。
    pub name: String,
    /// 連れてきた人数。⚠ **`Option`** ——`raid_viewer_count` は NULL 許容の列なので、
    /// 欠けているときに `0` を捏造しない（「0 人のレイド」と「人数不明」を混同させない）。
    #[ts(optional)]
    pub viewer_count: Option<u32>,
    /// レイドの時刻（`published_at`）。
    pub at: String,
}

/// 1 回の配信ぶんの集計（`get_stream_summary` の戻り値）。
///
/// ## ⚠⚠ 各数字の母集合（**画面で足し算が合うことの根拠**）
///
/// `monetary_by_kind` / `monetary_by_currency` / `monetary_total_count` の 3 つは
/// **`repository::monetary_by_kind` が返す 1 つの行集合から導出している**（別々のクエリにしていない）。
/// ⇒ 「通貨ごとの count の合計 ≠ 総課金回数」が**構造的に起こり得ない**（穴 C の解き方）。
/// `monetary_total_count_equals_the_sum_of_per_currency_counts` と
/// `monetary_by_currency_is_the_rollup_of_monetary_by_kind` が固定する。
///
/// ## ⚠ 既存の視聴者集計（`RECOMPUTE_VIEWER_AGGREGATES_SQL`）との一致・不一致
///
/// ⚠⚠ **「一致」は無条件ではない**（レビュー指摘 Q-3）。下表の ✅ は**現在のデータの性質に依存**しており、
/// 述語そのものは `<課金>` 側に `amount IS NOT NULL` と `currency <> 'JEWELS'` が余分に入っている。
/// 分かれる条件は各行に明記した（**「完全一致」と読んで数字のずれを不具合と誤診しないこと**）。
///
/// | 対象 | 判定 |
/// |---|---|
/// | ビッツ（`currency='BITS'`・**`event_type` 条件なし**） | ✅ 一致（⚠ 前提＝`amount`/`currency` が**必ずペアで**保存されること。片方だけ NULL の行が来ると分かれる＝`repository.rs` 穴 E 節の再修正トリガー） |
/// | サブスク系（`event_type IN ('subscription','membership','gift')`） | ✅ **完全一致**（述語が 1 文字も違わない） |
/// | スパチャ（実通貨） | ✅ 一致（⚠ `currency='JEWELS'` を持つ `superchat` 行が来た場合のみ分かれる＝サマリー側だけが除外する。**論点 3 の意図した挙動**であって不具合ではない。`a_jewels_currency_row_is_excluded_whatever_its_event_type_is` がその状況を作っている） |
/// | **総コメント数** | ⚠⚠ **意図的に不一致**（訂正 1 (A)＝レイドを数えない。`viewers.total_comments` は `COUNT(*)`） |
/// | **総課金額** | ⚠⚠ **意図的に不一致**（訂正 2 (A)＝donation を含める。`viewers.superchat_amount` は含めない） |
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/features/comment-viewer/bindings/")]
pub struct StreamSummary {
    /// 対象の配信（062b の既存型）。⚠ **`endedAt` が無い＝配信中**（接続状態からは判定しない＝申し送り 7）。
    pub session: StreamSessionRecord,
    /// 総コメント数。
    ///
    /// ⚠⚠ **訂正 1 (A): `event_type <> 'raid'`。** 「その配信で流れたコメントの数」＝画面の語感どおり。
    /// レイド元は普通その配信の視聴者ではないので数えない。
    /// ⚠ `viewers.total_comments` は `COUNT(*)`（レイド込み）で、**意図的に定義が違う**
    /// ——062a が `COUNT(*)` を選んだのは `first_seen_at` / `last_comment_at` の **NOT NULL 制約**という
    /// DB 都合であって「レイドはコメントである」という意味論ではない（`RECOMPUTE_VIEWER_AGGREGATES_SQL`
    /// の doc の理由③が「062c は `event_type='raid'` で直接引くので依存しない」と本モジュールを前提にしている）。
    pub total_comments: u32,
    /// 課金イベントの回数（＝`monetary_by_currency` の `count` の合計）。
    ///
    /// ⚠ **jewels は入らない**（金額を合算しない以上、回数も同じ母集合から外す＝穴 C）。
    /// jewels の回数は `jewels_count` に別枠で出す。
    pub monetary_total_count: u32,
    /// 通貨ごとの総課金額（⚠ **1 つの数字に丸めない**・換算しない＝親 062 (2)）。通貨コード昇順。
    pub monetary_by_currency: Vec<CurrencyTotal>,
    /// 種別ごとの内訳（スパチャ / ビッツ / ドネーション …）。`monetary_by_currency` の内訳。
    pub monetary_by_kind: Vec<MonetaryKindTotal>,
    /// Jewels の回数。⚠ **金額は合算しない**（043e フェーズ 2 未了で単位が単価か累計か不明）。
    pub jewels_count: u32,
    /// サブスク系（`subscription` / `membership` / `gift`）の件数。
    ///
    /// ⚠⚠ Twitch のコミュニティギフトが N+1 件で届く既知の歪み（043a）で**ここは多めに出る**。
    /// ⚠ 画面はこれを**説明文で書いていない**（2026-08-16 の決定・`SummaryView.tsx` 冒頭を参照）＝
    /// **この歪みは現在どこにも表示されていない**。伝える必要が出たら文章ではなく構造で解くこと。
    pub subscription_count: u32,
    /// 貢献者一覧（⚠ **マスト**）。**金額降順**（並び順の定義は `service::sort_contributors` を参照）。
    pub contributors: Vec<Contributor>,
    /// レイド一覧（⚠ **マスト**・Twitch のみ）。時刻の降順。
    pub raids: Vec<RaidRecord>,
}
