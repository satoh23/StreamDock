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
    pub published_at: String,
}
