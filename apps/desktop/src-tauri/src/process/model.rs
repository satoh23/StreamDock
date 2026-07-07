use serde::Serialize;
use ts_rs::TS;

use crate::preset_items::model::LaunchMode;

/// Tool 単体起動の結果（API 戻り値）。JSON は camelCase。
/// 007 では processId を返すのみ（起動記録の永続化は 009 以降）。
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/features/tools/bindings/")]
pub struct LaunchToolResult {
    pub tool_id: String,
    // TODO(009): PID 数値のみでは PID 再利用により停止対象を誤る恐れがある（詳細は service::launch の spawn 箇所）。
    //   現状の実装理由 / 意図: 007 は起動結果として PID を返すだけ（停止・永続化は 009 以降）。
    //   考慮すべき修正: 009 の停止処理では Child ハンドル保持、または起動時刻＋パスでの本人性照合を併用する。
    //   また macOS の `.app` は `/usr/bin/open` 経由で起動するため、この値は実アプリではなく
    //   即座に終了する `open` ヘルパの PID になる。009 では macOS で実アプリ PID を取得する方式を要検討。
    pub process_id: u32,
    pub started_at: String,
}

/// プリセット一括起動（008）の結果（API 戻り値）。JSON は camelCase。
/// 008 は best-effort 起動のため、1つの失敗で全体を中断せず、成功・失敗を集約して返す。
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/features/presets/bindings/")]
pub struct BulkLaunchPresetResult {
    pub preset_id: String,
    pub started_at: String,
    pub finished_at: String,
    pub total_count: u32,
    pub success_count: u32,
    pub failure_count: u32,
    pub results: Vec<BulkLaunchToolResult>,
}

/// 一括起動における Tool 1件ごとの起動結果。JSON は camelCase。
/// エラー文言はフロントに出しても安全な短文に丸める（パス・環境情報を含めない）。
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/features/presets/bindings/")]
pub struct BulkLaunchToolResult {
    pub preset_item_id: String,
    pub tool_id: String,
    pub tool_name: String,
    pub launch_mode: LaunchMode,
    pub order_index: u32,
    pub success: bool,
    #[ts(optional)]
    pub process_id: Option<u32>,
    #[ts(optional)]
    pub started_at: Option<String>,
    #[ts(optional)]
    pub error_message: Option<String>,
}
