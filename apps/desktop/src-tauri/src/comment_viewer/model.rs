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
    /// 062a: Twitch のレイド（他チャンネルからの視聴者流入）。**課金ではない**——視聴者メモリの
    /// `subscription_count` / `is_member` / `last_subscription_at` にも、frontend の
    /// `MONETARY_EVENT_TYPES`（ティア色カード・投げ銭ティッカー・061 のエフェクト条件）にも入れない。
    /// ⚠ この variant が無いと wire の `"raid"` は**未知 variant としてデシリアライズ全体を失敗**させ、
    /// `record_comment` は fire-and-forget なので**レイドが黙って 1 件も保存されない**（YouTube に相当機能は無い）。
    Raid,
    /// 063e: Twitch のチャンネルポイント報酬の引き換え。**課金ではない**——レイドと同じく視聴者メモリの
    /// `subscription_count` / `is_member` / `last_subscription_at` にも、frontend の
    /// `MONETARY_EVENT_TYPES`（ティア色カード・投げ銭ティッカー・通知音の代表音・読み上げ優先キュー・
    /// 061 のエフェクト条件）にも入れない。⚠ **チャンネルポイントは「お金」ではない。**
    /// ⚠ この variant が無いと wire の `"channelpoint"` は**未知 variant としてデシリアライズ全体を失敗**させ、
    /// `record_comment` は fire-and-forget なので**引き換えが黙って 1 件も保存されない**（YouTube に相当機能は無い）。
    /// ⚠ レイドと違い**本文を持ちうる**（視聴者が報酬に添えた `user_input`）ので、
    /// `viewers.total_comments` と配信サマリーの「コメント数」には**入る**（063e の決定・SQL は 1 文字も変えていない）。
    Channelpoint,
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
            CommentEventType::Raid => "raid",
            CommentEventType::Channelpoint => "channelpoint",
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
    /// 043e: Jewels の combo（連続ギフト）回数（jewels 時のみ・単発は None）。**非保存**（月数/件数と同じ扱い）。
    /// 表示（コメント行の「×N」）だけに使い、**金額計算には使わない**（フェーズ1）。整数のみで個人情報を含まない。
    // 【レビュー指摘 S-5・既存設計どおりで修正不要】`Option<u32>` なので範囲外値/float/文字列が来ると
    //   `record_comment` **全体**のデシリアライズが失敗し、fire-and-forget で握り潰される（month_count /
    //   gift_count / tier と同じ設計）。不正データが端末に残らない fail-closed 方向なので安全側だが、combo 更新で
    //   これが起きると「画面は新金額・DB は旧金額」という表示と保存の乖離になる。フェーズ1 の金額は乗算しない
    //   安全側なので実害は小さい。※ 非 doc コメント（//）にしてあるのは ts-rs binding へ流さないため。
    //   再修正トリガー: この乖離が実際に観測されたら、フィールド単位で None へ劣化させる（deserialize_with）を検討。
    #[ts(optional)]
    pub combo_count: Option<u32>,
    /// 062a: レイド人数（raid 時のみ・それ以外は None）。⚠ **月数/件数/階級/combo と違い端末保存する**
    /// （`viewer_comments.raid_viewer_count`）。「配信終わりに誰がレイドしてくれたか」を見返すのが目的で、
    /// 表示のためだけの値ではない。整数のみで個人情報を含まない（§9）。
    /// ⚠ レイド元のアバター URL（Twitch のペイロードに `profile_image_url` として存在する）は
    /// **sidecar が DTO に宣言せず取り込まない**ため、ここにも DB にも来ない。
    #[ts(optional)]
    pub raid_viewer_count: Option<u32>,
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

#[cfg(test)]
mod tests {
    use super::*;

    /// wire（sidecar の `comments.append`）が送ってくる 1 件ぶんの JSON。
    /// ⚠ `eventType` 以外は最小構成（`record_comment` が必須にする範囲）。
    fn wire_json(event_type: &str) -> String {
        format!(
            r#"{{"id":"c1","source":"twitch","author":{{"id":"u1","name":"Alice"}},
                 "text":"hi","publishedAt":"2026-08-25T10:00:00Z","eventType":"{event_type}"}}"#
        )
    }

    /// 063e: wire の `"channelpoint"` が `CommentEventType::Channelpoint` へデシリアライズできる。
    ///
    /// ⚠⚠ **これは「1 行の写像」ではなく「全滅するかどうか」のテストである。**
    /// serde の enum は未知 variant で**その DTO 全体のデシリアライズを失敗**させ、
    /// `record_comment` は frontend から fire-and-forget で呼ばれるので、失敗しても画面には何も出ない。
    /// ⇒ variant を消す変異では「チャンネルポイントが**黙って 1 件も保存されない**」という
    /// 気付けない壊れ方をする（`CommentEventType::Channelpoint` の doc が正）。
    #[test]
    fn the_wire_value_channelpoint_deserializes_into_the_enum() {
        let dto: CommentViewDto = serde_json::from_str(&wire_json("channelpoint")).unwrap();
        assert!(matches!(dto.event_type, CommentEventType::Channelpoint));
        // ⚠ DB へ書く綴りが wire と一致していること（`viewer_comments.event_type` はこの値で検索される）。
        assert_eq!(dto.event_type.as_str(), "channelpoint");
    }

    /// ⚠ 既存の種別が道連れになっていないこと（union に足しただけで写像が崩れていない）。
    #[test]
    fn the_existing_wire_values_still_deserialize() {
        for (wire, expected) in [
            ("chat", "chat"),
            ("superchat", "superchat"),
            ("membership", "membership"),
            ("subscription", "subscription"),
            ("gift", "gift"),
            ("donation", "donation"),
            ("jewels", "jewels"),
            ("raid", "raid"),
        ] {
            let dto: CommentViewDto = serde_json::from_str(&wire_json(wire)).unwrap();
            assert_eq!(dto.event_type.as_str(), expected, "wire 値 {wire} の写像");
        }
    }

    /// ⚠⚠ **未知の種別は「その 1 件が落ちる」のではなく DTO 全体が失敗する**ことの記録。
    /// これが `Channelpoint` を足さなければならなかった理由そのものである
    /// （＝新種別を wire に足したら Rust にも必ず足す、を忘れると静かに全滅する）。
    #[test]
    fn an_unknown_wire_value_fails_the_whole_dto() {
        assert!(serde_json::from_str::<CommentViewDto>(&wire_json("unknown_kind")).is_err());
    }
}
