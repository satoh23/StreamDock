//! 062b: 配信セッションの DTO。
//!
//! frontend へ返すのは「いつ・どのプラットフォームで配信したか」と手入力タイトルだけで、
//! **第三者の個人データは 1 つも載らない**（docs/security.md §9 追補〔062b〕）。JSON は camelCase。

use serde::Serialize;
use ts_rs::TS;

/// 1 回の配信（`stream_sessions` テーブル 1 行）。
///
/// ⚠⚠ **binding の出力先が `comment-viewer/bindings/` なのは意図的**。`package.json` の
/// `check:bindings` は**ハードコードされた 6 ディレクトリしか見ない**ので、そこに無いディレクトリへ
/// 出すと `git diff --exit-code` の対象外になり、**生成漏れがあってもチェックが緑になる**
/// （実際 `src/features/rakuraku/bindings` が列挙から漏れており、取りこぼしの前例がある）。
/// 別モジュールの型をここへ出す先例は `overlay_theme` / `audio` / `obs_config` が既にある。
/// ⚠ 専用ディレクトリ（`src/features/stream-session/bindings/`）へ移すなら、
/// **`check:bindings` の列挙に足すこととセット**でなければならない。
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/features/comment-viewer/bindings/")]
pub struct StreamSessionRecord {
    /// セッション id（端末内ローカルの UUID v4）。**`viewer_comments.session_id` と同じ値**。
    /// ⚠ FK は張っていない（既存行には対応する `stream_sessions` 行が無く、バックフィルもしないため。
    /// 詳細は `repository::init` のコメント）。
    pub id: String,
    /// 開始時刻（RFC3339）。
    pub started_at: String,
    /// 終了時刻（RFC3339）。**`None` ＝進行中**。
    #[ts(optional)]
    pub ended_at: Option<String>,
    /// 接続していたプラットフォーム（`"twitch"` / `"youtube"` のみ・**昇順**）。
    ///
    /// ⚠ **セッション中は単調増加（union）**で、片方が切れても消さない
    /// （「この配信は両方でやった」が正しい記録なので）。正規化は `service::normalize_platforms`。
    pub platforms: Vec<String>,
    /// 配信タイトル（**ユーザーの手入力**・任意・既定は空文字列）。
    ///
    /// ⚠ **自動取得はしない**（新規 API 呼び出し・新規スコープが増えるため・§1）。
    /// ＝ここに入るのは常にユーザー自身が打った文字列である。
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
}
