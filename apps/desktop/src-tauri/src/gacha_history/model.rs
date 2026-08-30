//! 063h: ガチャ抽選記録の DTO。
//!
//! ⚠⚠ **binding の出力先が `comment-viewer/bindings/` なのは意図的**（`StreamSessionRecord` /
//! `StreamSummary` と同じ理由）。`package.json` の `check:bindings` は**ハードコードされた
//! 6 ディレクトリしか見ない**ので、そこに無いディレクトリへ出すと `git diff --exit-code` の
//! 対象外になり、**生成漏れがあってもチェックが緑になる**。
//! ⚠ 専用ディレクトリへ移すなら、**`check:bindings` の列挙に足すこととセット**でなければならない。

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// 抽選 1 回ぶんの記録（`record_gacha_draw` の入力）。
///
/// ⚠⚠⚠ **ここに載っていない値は保存できない**（docs/security.md §9 追補〔063h〕）。
/// **コメント本文・投げ銭金額・アバター・引き金になったコメント id** は
/// **型としても列としても載せる場所を作らない**。
/// ⚠ 「送信済みフラグ」等の予備の列も足さないこと——[063g] が「景品の自動配布はやらない」で
/// 完了したので使い道が無く、**使わない列は §9 の説明を難しくする**。
///
/// ⚠⚠⚠ **`Serialize` を付けていない**（入力専用＝この型が Rust から frontend へ出る経路を作らない）。
/// ⚠ **063i で読み出しが増えても、ここへ `Serialize` を足して使い回さないこと**——
/// 読み出し側は別型の [`GachaDrawRecord`] で、**出す列を選べる**（`session_id` / `gacha_id` /
/// `created_at` を出していないのはそのため）。1 つの型を入出力で兼ねると、
/// **入力に足した列がそのまま frontend へ出る**経路が黙って開く。
#[derive(Debug, Clone, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/features/comment-viewer/bindings/")]
pub struct NewGachaDraw {
    /// 記録 id。⚠⚠ **決定的な文字列**（frontend が `${commentId}:${gachaId}:${nth}` で組む＝穴 A）。
    ///
    /// ⚠⚠⚠ **この形を Rust 側でパースしないこと。** 形は frontend の実装都合であり、
    /// パースし始めると**形を変えられなくなる**（063h 穴 H で `trigger_comment_id` 列を
    /// 却下したときの理由と同じ）。ここでは「空でない・制御文字を含まない文字列」としてのみ扱う。
    pub id: String,
    /// 配信セッション id（062b の `stream_sessions.id`）。⚠ FK は張らない（`mod.rs` の注記が正）。
    pub session_id: String,
    /// `provider:providerUserId`（frontend の `viewerIdOf` が作る）。⚠ FK は張らない。
    pub viewer_id: String,
    /// ⚠⚠ **抽選した時点の表示名**（`viewers.name` ＝今の名前とは別物）。
    ///
    /// ⚠⚠⚠ **切っていない生値である**（演出とチャットの 20 文字＋`…` は通さない＝穴 D）。
    /// 20 文字で切るのは**配信面へ出すための整形**であって検証ではなく、DB に持ち込むと
    /// 「**サマリーの名前だけ末尾が `…`**」になる。線の引き直しは §9 追補〔063h〕が正。
    /// ⚠ **空を許す**（provider によっては表示名が取れない＝`record_comment` の `name` と同じ扱い）。
    pub viewer_name: String,
    /// ガチャ id（frontend の `GachaDefinition.id`＝`"g:n"`）。
    pub gacha_id: String,
    /// ⚠ **抽選した時点のガチャ名**（ユーザー自身の入力）。ガチャは後から改名・削除されるので、
    /// `gacha_id` だけだと**消したガチャの履歴が読めなくなる**（063h 穴 G）。
    pub gacha_name: String,
    /// 当選景品の表示名（ユーザー自身の入力）。
    ///
    /// ⚠⚠⚠ **`None` ＝ 何も当たらなかった**（＝ 1 回の抽選として記録する）。
    /// ⚠⚠ **「何も出ない」という文字列を入れないこと**（`mod.rs` の注記が正）。
    /// ⚠ frontend は `gachaPrizeLabel` が決めた値をそのまま渡す——景品名が空の当たりは
    /// `GACHA_UNNAMED_PRIZE_LABEL`（＝「当たり」）になり、**`None` にはならない**。
    #[ts(optional)]
    pub prize_label: Option<String>,
    /// その景品の確率が `GACHA_RARE_MAX_PERCENT` 未満だったか（frontend の `isGachaRarePrize` が唯一の持ち主）。
    pub rare: bool,
    /// 抽選した時刻（RFC3339）。
    ///
    /// ⚠⚠ **frontend が抽選の瞬間に作る**（`now_rfc3339()` で代用しない）。セッション未確定で
    /// バッファに貯まった抽選が「流した時刻」で記録されると、**配信サマリーの並びが
    /// 実際の抽選順と食い違う**。⇒ 検証は `util::require_rfc3339`（§8）。
    pub drawn_at: String,
}

/// 抽選 1 回ぶんの**読み出し**用 DTO（063i・`list_gacha_draws` の戻り値）。
///
/// ⚠⚠⚠ **[`NewGachaDraw`] とは別の型である**（あちらを `Serialize` にして使い回さないこと）。
/// 入力型と出力型を分けてあるのは、**出す列をここで選べる**ようにするためで、
/// 実際に `session_id`（呼び出し側が既に持っている）・`gacha_id`（画面はガチャ**名**で読む）・
/// `created_at`（記録した時刻＝抽選した時刻ではない）は**出していない**。
/// 1 つの型で兼ねると、入力に足した列がそのまま frontend へ出る経路が黙って開く。
///
/// ⚠⚠ **配信元（`source`）は載せない。** `gacha_draws` は provider を列として持たず、
/// `viewer_id`（`provider:providerUserId`）から切り出すことはできるが、
/// **それは「保存していないものを画面に出す」ことと同義**である（切り出しの規則が
/// `viewers.provider` とずれても誰も気付けない）。⚠ サイト列を出したくなったら
/// **`docs/security.md` §9 追補〔063h〕を読み直し、DTO と保存内容を先に決め直すこと。**
///
/// ⚠ 表示は**この行が持つ値だけで完結する**（`viewers` を JOIN しない＝063i 穴 C / 穴 D）。
/// `viewer_name` は**抽選した時点の名前**で、貢献者一覧が出す `viewers.name`（＝今の名前）とは
/// **別の規則**である（改名した視聴者では 2 つが食い違うが、それが仕様）。
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/features/comment-viewer/bindings/")]
pub struct GachaDrawRecord {
    /// 記録 id（`${commentId}:${gachaId}:${nth}`）。⚠ **画面は key として使うだけ**で、
    /// 中身を分解しないこと（形は frontend の実装都合＝[`NewGachaDraw::id`] の注記が正）。
    pub id: String,
    /// `provider:providerUserId`。⚠ **視聴者詳細（038b の導線）へ渡すために出している。**
    /// ⚠⚠ `viewers` に対応行が**無いことがある**（FK を張っていない＝§9 追補〔063h〕レビュー S-1）ので、
    /// 受け手は「詳細が引けない」場合に壊れないこと。
    pub viewer_id: String,
    /// ⚠ **抽選した時点の表示名**（`viewers.name` ＝今の名前ではない）。
    pub viewer_name: String,
    /// ⚠ **抽選した時点のガチャ名**（消したガチャの履歴も読めるようにするため＝063h 穴 G）。
    pub gacha_name: String,
    /// 当選景品の表示名。⚠⚠⚠ **`None` ＝ 何も当たらなかった**（1 回の抽選として並べる）。
    /// ⚠ **ここに「何も出ない」という文字列を作らないこと**——画面の文言は frontend の
    /// `GACHA_MISS_LABEL` が唯一の持ち主で、DB にも Rust にもその語を持ち込まない（`mod.rs` が正）。
    #[ts(optional)]
    pub prize_label: Option<String>,
    /// レアだったか。
    pub rare: bool,
    /// 抽選した時刻（RFC3339・frontend が抽選の瞬間に作った値）。
    ///
    /// ⚠⚠ **同じバッチの抽選は同値になる**（frontend が 1 バッチにつき 1 回だけ時刻を作るため）。
    /// その中の並びは `id DESC`＝**記録 id の辞書順**で、**抽選順ではない**
    /// （§9 追補〔063h〕§8 の「レビュー Q-2 の追記」が正）。⚠ 並び順のテストを抽選順で書かないこと。
    pub drawn_at: String,
}
