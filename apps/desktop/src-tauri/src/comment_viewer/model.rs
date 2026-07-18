//! 032c-b: コメントビューアの正規化 CommentViewDto（ts-rs binding の唯一の正）。
//!
//! frontend 専用モック（`src/features/comment-viewer/types.ts`）を置き換える。sidecar が WS で送る
//! `comments.append` のワイヤ表現と**同形**で、viewer はこの binding を消費する（wire = 型 = 描画で一致）。
//! Rust 側でこの DTO を構築する経路は無く（コメント本文は Node sidecar が生成し端末外へ出さない）、
//! ts-rs のワイヤ契約（スキーマ）としてのみ用いる。取得コメントを Rust の DB/ログへ保存しない（§9）。

use serde::Serialize;
use ts_rs::TS;

/// 配信元。
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "../../src/features/comment-viewer/bindings/")]
pub enum CommentSource {
    Twitch,
    Youtube,
}

/// コメント種別（通常チャット／投げ銭／メンバーシップ／サブスク）。
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "../../src/features/comment-viewer/bindings/")]
pub enum CommentEventType {
    Chat,
    Superchat,
    Membership,
    Subscription,
}

/// コメント投稿者。
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/features/comment-viewer/bindings/")]
pub struct CommentAuthor {
    pub id: String,
    pub name: String,
}

/// 表示側で扱う正規化済みコメント 1 件。
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/features/comment-viewer/bindings/")]
pub struct CommentViewDto {
    /// 一意 ID（重複排除のキー）。
    pub id: String,
    /// 配信元。
    pub source: CommentSource,
    /// 投稿者。
    pub author: CommentAuthor,
    /// 本文。
    pub text: String,
    /// 投稿日時（ISO8601 文字列）。
    pub published_at: String,
    /// コメント種別。
    pub event_type: CommentEventType,
    /// 投げ銭などの金額表示（該当時のみ・例 "100 bits"）。
    #[ts(optional)]
    pub monetary_amount: Option<String>,
}
