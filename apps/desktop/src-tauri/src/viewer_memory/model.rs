//! 038a: 視聴者メモリの DTO / 内部入力型。
//!
//! frontend へ返す DTO（`ViewerRecord` / `ViewerCommentRecord` / `ViewerDetail`）と、一覧の入力
//! （`ListViewersInput` / `ViewerSort`）を ts-rs で bindings 出力する。`NewViewerComment` は
//! `record_comment` の検証済み値を repository へ渡す内部型（frontend からは記録できないため ts-rs 非出力）。

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// 視聴者 1 人分の集計・メモ（`viewers` テーブル 1 行）。JSON は camelCase。
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/features/viewer-memory/bindings/")]
pub struct ViewerRecord {
    /// 安定キー（`provider:providerUserId`）。
    pub id: String,
    /// 配信元（"twitch" | "youtube"）。
    pub provider: String,
    /// 配信元での投稿者 ID（生値）。
    pub provider_user_id: String,
    /// 最新の表示名。
    pub name: String,
    /// 最初のコメント時刻（ISO8601）。
    pub first_seen_at: String,
    /// 最終コメント時刻（ISO8601）。
    pub last_comment_at: String,
    /// 総コメント数。
    pub total_comments: u32,
    /// bits を投げた回数。
    pub bits_count: u32,
    /// bits の合計枚数。
    ///
    /// ⚠⚠ **この列は 2 層で守られている（security-review S-1 への対処）。片方だけ消さないこと。**
    /// 中身は `CAST(SUM(amount) AS INTEGER)` で、`amount` は `CommentViewDto.monetary.amount`（f64）＝
    /// **`ViewerRecord` の集計のうち唯一 frontend 由来の実数が入る列**である。守りが無いと `u32` に
    /// 収まらない値や**負値**が 1 件入るだけで `list_viewers` / `get_viewer` が**両方とも `StorageFailed`**
    /// で落ち、**視聴者一覧が丸ごと開けなくなる**（実測: `amount = -1, currency = "BITS"` の 1 件で再現）。
    /// 記録側は成功扱いで返るので原因が見えず、一覧が開けないので UI からその行を消すこともできない。
    /// - **入口**: `service::MAX_COMMENT_AMOUNT`（有限・非負・1 億以内。超えたらコメントごと弾く）
    /// - **出口**: `repository::read_u32_clamped`（範囲外を丸めて読む＝既に壊れた DB でも一覧が開く）
    ///
    /// ⚠ 入口だけでは足りない（SUM なので件数が増えれば合計は溢れる）し、出口だけでも足りない
    /// （壊れた値が保存され続ける）。065a が `imported_*` に `MAX_IMPORTED_COUNT` を入れたのと同じ機序で、
    /// **こちらは SUM である点だけが違う**——だから上限 1 つでは閉じず、2 層になっている。
    pub bits_amount: u32,
    /// スーパーチャット回数（bits を除く実通貨）。
    pub superchat_count: u32,
    /// スーパーチャット合計額（**混在通貨時は近似**。正確な内訳は viewer_comments を参照）。
    pub superchat_amount: f64,
    /// 最後に観測したスパチャ通貨（表示用・近似）。
    #[ts(optional)]
    pub superchat_currency: Option<String>,
    /// サブスク/メンシプ系イベントの回数。
    pub subscription_count: u32,
    /// サブスク/メンシプを観測したか。
    pub is_member: bool,
    /// 最後のサブスクイベント時刻。
    #[ts(optional)]
    pub last_subscription_at: Option<String>,
    /// 配信者が残すメモ。
    pub note: String,
    pub created_at: String,
    pub updated_at: String,

    // ---- 065a: わんコメ（OneComme）の公式 CSV からの引き継ぎ ----
    //
    // ⚠⚠ **`imported_name_history`（生 JSON 文字列）はここに出さない。** 保管専用の列で 065b は
    //   使わないため、第三者データを IPC 境界へ載せる面を増やさない（docs/security.md §9）。
    //   表示したくなったら `nameHistory` のパース方針を決め、**§9 を再評価してから**足すこと。
    /// わんコメのニックネーム（`name` / `note` とは別概念。未設定なら空文字）。
    pub nickname: String,
    /// わんコメのラベル（単一値。未設定なら空文字）。
    pub label: String,
    /// わんコメ互換の統合ギフト回数（実測 ＋ 引き継ぎ）。
    /// ⚠ `raid` と `chat` は数えない（レイドは課金ではない＝062a）。
    pub gift_count: u32,
    /// 参加配信数（実測 ＋ 引き継ぎ）。
    /// ⚠⚠ **062b 以前のデータでは多めに出る**——当時の `session_id` はコメビュ窓のマウント単位で、
    ///   窓を開き直すたびに別 id になっていた。062b はバックフィルしないと決めているので歪みは残る。
    ///   065b で表示するときは「参加配信数」を厳密な値として説明しないこと。
    pub stream_count: u32,
    /// 参加日数（実測 ＋ 引き継ぎ）。
    /// ⚠⚠ **実測分は UTC 日で数える**（日本時間の朝の配信は UTC で 2 日に割れる）。引き継ぎ分の
    ///   `atdDays` はわんコメのローカル日と思われ、**左右で「1 日」の定義が揃っていない近似**である。
    pub active_days: u32,
    /// 引き継いだ累積コメント数（わんコメ `tc`）。`total_comments` にはこの値が加算済み。
    pub imported_comments: u32,
    /// 引き継いだギフト回数（わんコメ `tgc`）。`gift_count` にはこの値が加算済み。
    pub imported_gifts: u32,
    /// 引き継いだギフト累計額（わんコメ `amount`）。
    /// ⚠⚠ **単位不明**（CSV に通貨情報が無く、円ではなく YouTube の Jewels の可能性が高い）。
    ///   `superchat_amount` / `bits_amount` には**一切加算していない**。
    ///   **065b は単位を付けて表示しないこと**（「1000 円」と読ませない）。
    pub imported_gift_amount: f64,
    /// 引き継いだ参加日数（わんコメ `atdDays`）。`active_days` にはこの値が加算済み。
    pub imported_active_days: u32,
    /// 引き継いだ参加配信数（わんコメ `atdLives`）。`stream_count` にはこの値が加算済み。
    pub imported_stream_count: u32,
    /// 引き継いだ初回来訪時刻の**推定値**（わんコメ `lcts − interval`）。
    /// ⚠⚠ **仮説を含む**（`interval` を「初回コメントからの経過時間」と読んだ解釈。親 065・(3)）。
    ///   `first_seen_at` とは**合成していない**——表示側で `MIN(first_seen_at, imported_first_seen_at)`
    ///   を採ること。⚠ `first_seen_at` は実測分の `MIN(published_at)` で毎回上書きされるので、
    ///   **引き継ぎだけの視聴者が初めてコメントすると「初回来訪日」が今日へ飛ぶ**（合成表示が必須）。
    #[ts(optional)]
    pub imported_first_seen_at: Option<String>,
    /// 取り込み日時（**NULL＝引き継ぎ無し**の判別に使う）。
    #[ts(optional)]
    pub imported_at: Option<String>,
}

/// 視聴者の過去コメント 1 件（`viewer_comments` テーブル 1 行）。JSON は camelCase。
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/features/viewer-memory/bindings/")]
pub struct ViewerCommentRecord {
    /// コメント id（重複排除キー）。
    pub id: String,
    /// 視聴者 id（`viewers.id` への FK）。
    pub viewer_id: String,
    /// 取得セッションのローカル id（配信の束）。
    pub session_id: String,
    pub source: String,
    pub text: String,
    pub event_type: String,
    #[ts(optional)]
    pub amount: Option<f64>,
    #[ts(optional)]
    pub currency: Option<String>,
    #[ts(optional)]
    pub monetary_amount: Option<String>,
    /// 062a: レイド人数（`event_type='raid'` の行のみ・それ以外は None）。
    /// 062c（配信サマリーのレイド一覧）が読むためここまで通す。
    #[ts(optional)]
    pub raid_viewer_count: Option<u32>,
    pub published_at: String,
    pub created_at: String,
}

/// `get_viewer` の戻り値（視聴者＋その過去コメント）。
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/features/viewer-memory/bindings/")]
pub struct ViewerDetail {
    pub viewer: ViewerRecord,
    pub comments: Vec<ViewerCommentRecord>,
}

/// 一覧の並び替えキー。JSON は camelCase（frontend から渡す）。
#[derive(Debug, Clone, Copy, Default, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/features/viewer-memory/bindings/")]
pub enum ViewerSort {
    /// 最終コメント日時の新しい順（既定）。
    #[default]
    LastComment,
    /// 総コメント数の多い順。
    TotalComments,
    /// 名前の昇順（大小無視）。
    Name,
}

/// `list_viewers` の入力（検索・並び替え。いずれも任意）。
#[derive(Debug, Clone, Default, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/features/viewer-memory/bindings/")]
pub struct ListViewersInput {
    /// 名前の部分一致検索（未指定＝全件）。
    #[serde(default)]
    #[ts(optional)]
    pub search: Option<String>,
    /// 並び替えキー（未指定＝last_comment 降順）。
    #[serde(default)]
    #[ts(optional)]
    pub sort: Option<ViewerSort>,
}

/// 038c: `record_comment` の判定結果（初見／久しぶり）。JSON は camelCase。
///
/// `record_comment` が **実際に挿入した初回のみ** 肯定値を返す（重複記録は両方 false）。frontend は
/// この 2 値の真偽だけを消費してバッジ/枠色を出す。**端末外へ出さない・ログにも出さない**（真偽 2 値のみ）。
/// `first_time` と `long_absence` は排他（初コメントは初見が優先で久しぶりは付けない）。
#[derive(Debug, Clone, Copy, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/features/viewer-memory/bindings/")]
pub struct RecordResult {
    /// その視聴者の初コメント（記録前に viewer 行が無い）＝**初見**。
    pub first_time: bool,
    /// 直前の最終コメントから 1 ヶ月以上経過後の最初のコメント＝**久しぶり**。
    pub long_absence: bool,
}

/// 065a: `import_viewer_memory_csv` の戻り値（**件数だけ**）。JSON は camelCase。
///
/// ⚠⚠ **視聴者名・メモ・ニックネーム・ラベル・ID を 1 つも載せない**（docs/security.md §9）。
/// 取り込みは第三者の個人データを扱うが、frontend へ返すのは「何件どうなったか」だけでよく、
/// 中身を返すと `console.log` 1 行で個人データが開発者ツールへ出る面ができる。
/// `the_import_result_never_carries_viewer_identity` が `{:?}` 出力で固定している。
///
/// ⚠ 型名を `ImportResult` にしていないのは、barrel（`features/viewer-memory/types.ts`）から
/// 再エクスポートしたときに何の取り込みか分からなくなるため（先例＝`OverlayThemeImportResult`）。
#[derive(Debug, Clone, Copy, Default, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/features/viewer-memory/bindings/")]
pub struct ViewerImportResult {
    /// 新規に作った視聴者数。
    pub imported: u32,
    /// 既存の視聴者を更新した数。
    pub updated: u32,
    /// 未対応サービス／未知プレフィックス／`service` 不一致でスキップした数。
    pub skipped_unsupported: u32,
    /// 必須値の欠落・検証失敗・数値のパース失敗でスキップした数。
    pub skipped_invalid: u32,
}

/// `record_comment` の検証済み値を repository へ渡す内部入力（ts-rs 非出力）。
///
/// frontend からはこの型で記録しない（記録は `CommentViewDto` を受けて service が組み立てる）。
pub struct NewViewerComment {
    pub comment_id: String,
    pub viewer_id: String,
    pub session_id: String,
    pub provider: String,
    pub provider_user_id: String,
    pub name: String,
    pub source: String,
    pub text: String,
    pub event_type: String,
    pub amount: Option<f64>,
    pub currency: Option<String>,
    pub monetary_amount: Option<String>,
    /// 062a: レイド人数（raid 以外は None）。⚠ この 1 列だけが 062a で増える保存項目。
    pub raid_viewer_count: Option<u32>,
    pub published_at: String,
}
