//! 032c-b: コメントビューアの正規化 CommentViewDto（ts-rs binding の唯一の正）。
//!
//! frontend 専用モック（`src/features/comment-viewer/types.ts`）を置き換える。sidecar が WS で送る
//! `comments.append` のワイヤ表現と**同形**で、viewer はこの binding を消費する（wire = 型 = 描画で一致）。
//!
//! 038a: 視聴者メモリ機能のため、frontend が受信済みコメントを Tauri コマンド `record_comment`
//! （viewer_memory）へ渡す経路を新設した。そのため本 DTO は **command 引数として Deserialize** も行い、
//! Rust 側で（端末内 SQLite のみに）保存する。§9「取得コメントを DB/ログへ保存しない」原則は視聴者メモリに
//! 限って解禁する（端末外へは出さない。詳細は docs/security.md「コメントビューア方針」⑪）。当初の
//! 「Rust 側で構築する経路は無く…保存しない」前提は、本タスクで意図的に変更したもの。集計の正確化のため
//! 金額の数値表現（`monetary`）を追加する（表示用 `monetary_amount` 文字列は温存＝後方互換の加算的変更）。

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// 配信元。
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "../../src/features/comment-viewer/bindings/")]
pub enum CommentSource {
    Twitch,
    Youtube,
}

impl CommentSource {
    /// DB 保存・安定キー生成に使う小文字表現（serde の lowercase と一致）。
    pub fn as_str(&self) -> &'static str {
        match self {
            CommentSource::Twitch => "twitch",
            CommentSource::Youtube => "youtube",
        }
    }
}

/// コメント種別（通常チャット／投げ銭／メンバーシップ／サブスク）。
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "../../src/features/comment-viewer/bindings/")]
pub enum CommentEventType {
    Chat,
    Superchat,
    Membership,
    Subscription,
    /// 043a: ギフト（Twitch sub_gift/community_sub_gift）。サブスクと区別して受け取る。
    Gift,
    /// 043a(拡張): チャリティ・ドネーション（Twitch charity_donation）。実金銭・サブスク/ギフトと区別する。
    Donation,
    /// 043a(拡張): YouTube Jewels ギフト。取得（ingestion）は 043d（proto 拡張要）で、現状は dev-mock のみ発行。
    Jewels,
}

impl CommentEventType {
    /// DB 保存に使う小文字表現（serde の lowercase と一致）。
    pub fn as_str(&self) -> &'static str {
        match self {
            CommentEventType::Chat => "chat",
            CommentEventType::Superchat => "superchat",
            CommentEventType::Membership => "membership",
            CommentEventType::Subscription => "subscription",
            CommentEventType::Gift => "gift",
            CommentEventType::Donation => "donation",
            CommentEventType::Jewels => "jewels",
        }
    }
}

/// コメント投稿者。
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/features/comment-viewer/bindings/")]
pub struct CommentAuthor {
    pub id: String,
    pub name: String,
    /// 投稿者アイコン（data URI・未取得時は None）。036b/036c が送信側を実装するまでは常に None。
    #[ts(optional)]
    pub avatar: Option<String>,
}

/// 表示側で扱う正規化済みコメント 1 件。
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
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
    /// 038a: 投げ銭の数値表現（該当時のみ）。回数/合計額の正確な集計に使う。sidecar は wire.ts で
    /// 既に数値 `{currency, amount}` を持つため、文字列化して捨てず本フィールドで通す。
    #[ts(optional)]
    pub monetary: Option<CommentMonetaryDto>,
    /// 043a: メンバー／サブスク継続月数（membership/subscription 時のみ）。表示用途で通すのみ・端末保存しない。
    #[ts(optional)]
    pub month_count: Option<u32>,
    /// 043a: ギフト件数（gift 時のみ・community_sub_gift の total／単発 sub_gift は 1）。非保存。
    #[ts(optional)]
    pub gift_count: Option<u32>,
    /// 043a: サブスク階級（1/2/3・該当時のみ）。非保存。受贈者名は §9 配慮で持たない。
    #[ts(optional)]
    pub tier: Option<u32>,
}

/// 038a: 投げ銭の数値内訳（回数/合計額の正確な集計用）。
///
/// `currency` は bits のとき `"BITS"`、スーパーチャットのとき ISO 4217（例 `"JPY"`）。
/// `amount` は bits の枚数、またはスパチャの主要単位額（例 500.0）。
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/features/comment-viewer/bindings/")]
pub struct CommentMonetaryDto {
    /// 金額（bits は枚数、スパチャは主要単位の額）。
    pub amount: f64,
    /// 通貨コード（`"BITS"` または ISO 4217）。
    pub currency: String,
}
