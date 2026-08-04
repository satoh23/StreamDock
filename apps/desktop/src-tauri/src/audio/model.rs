//! 058a: 音声出力コマンドの引数・戻り値型（ts-rs binding の唯一の正）。
//!
//! `process/model.rs` / `rakuraku/model.rs` の慣習（Serialize + ts-rs export・安全な短文）に倣う。
//! 永続化はしない（SQLite テーブルを追加しない）。frontend 側でユーザーが選んだデバイス ID は
//! localStorage（`stream-dock.comment-viewer.audio-output-device`）に置くが、それは
//! **ユーザー自身の非機密 UI 設定値**で、第三者の個人データではない（docs/security.md §9 追補 046a）。

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// 選択可能な音声**出力**デバイス 1 件。
///
/// ⚠ **入力（マイク）は絶対にここへ入らない**。生成元は `service::list_output_devices` の
/// `output_devices()` だけで、`devices()`（入力を含む全件）は使わない。
///
/// ⚠ **`name` は UI に出すためだけの値**で、ログにも DB にも外部にも出さない（§9）。
/// `id` は `cpal::DeviceId` の `Display`（`"<HostId>:<device>"`）で、cpal が
/// 「再起動・再接続をまたいで持続する一意な識別子」と規定しているもの。frontend はこれを
/// **そのまま保存して返すだけ**で、組み立てたり加工したりしない。
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/features/comment-viewer/bindings/")]
pub struct AudioOutputDevice {
    /// 保存・再指定に使う安定 ID（`cpal::DeviceId` の文字列表現）。
    pub id: String,
    /// UI 表示用のデバイス名（`cpal::DeviceDescription::name()`）。
    pub name: String,
}

/// 鳴らせる音の種類。**アプリ内で合成する音だけ**を列挙する（同梱ファイルもパスも存在しない）。
///
/// ⚠ **これが「任意のファイルを鳴らせない」ことの構造的な担保**である（docs/security.md §3 / §4）。
/// `play_notification_sound` はこの enum しか受け取らないので、frontend からパスや任意のバイト列を
/// 渡す経路が型レベルで塞がっている。**ここを `String` や `PathBuf` に変えないこと。**
///
/// 音の波形は `service::samples_for` の `match` に 1 アームを足すだけで増やせる（decoder は要らない）。
///
/// ⚠ **variant は「ペイロードなし」のまま増やすこと。** `Comment { volume: f32 }` のように
/// ペイロードを持たせる変更は、docs/security.md の「レビュー必須条件」が
/// **「enum 以外で指定できるようにする変更」に含む**と名指ししており security-review 必須になる
/// （契約テストの `PathBuf` needle では捕まらないため、条文側で止めている）。
/// 059a / 059b がペイロードなしの variant 追加に留めたのはこの線を越えないため
/// （判断根拠は progress.md 059a / 059b）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "../../src/features/comment-viewer/bindings/")]
pub enum NotificationSound {
    /// 設定画面の「テスト再生」用のトーン。
    ///
    /// 058a に**この 1 つしか無い**のは意図的で、通知音そのもの（コメント音・投げ銭音）は
    /// 059 の領分だから。とはいえ 058s の合格基準は「選んだデバイスで鳴る」＋「既定デバイスでは
    /// 鳴らない」の 2 点セットで、鳴らせる音が 1 つも無いと 058a 単体でそれを測れない。
    Test,
    /// 059a: コメントが届いたときに鳴らす「ポン」。
    ///
    /// ⚠ **`Test` と同じ波形にしない**（`service::tone_spec` で別の値にしてある）。設定画面には
    /// 「テスト再生」（出力先の検証・`Test`）と「試聴」（この音の確認・`Comment`）の 2 つのボタンが
    /// 並ぶので、同じ音だと**どちらを押したのか分からず、テスト再生の診断価値が落ちる**。
    Comment,
    /// 059b: 課金チャット（スパチャ・ビッツ・サブスク・メンシプ・ギフト・ドネーション・ジュエル）を
    /// 検知したときに鳴らす音。
    ///
    /// ⚠ **`Comment` と同時には鳴らない**（親 059 の決定＝排他）。課金コメントが来たバッチでは
    /// 投げ銭音だけを鳴らす。両方鳴ると「別の音にした」意味が消える。判定と排他は frontend
    /// （`CommentViewerApp` の `playBatchNotification`）の責務で、Rust は音を持つだけ。
    ///
    /// ⚠ **`Test` / `Comment` と 3 音続けて鳴らしても聞き分けられる値にしてある**
    /// （`service::tone_spec` で音高・長さ・余韻の 3 軸すべてを離した）。
    /// 「聞き分けられる」こと自体はテストで担保できないので、実機確認の項目にしている。
    Monetary,
}
