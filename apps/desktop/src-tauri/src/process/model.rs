use serde::Serialize;
use ts_rs::TS;

use crate::preset_items::model::LaunchMode;

/// Tool 単体起動の結果（API 戻り値）。JSON は camelCase。
/// 007 では processId を返すのみ（起動記録の永続化は 009 以降）。
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/features/tools/bindings/")]
pub struct LaunchToolResult {
    /// 009 停止操作用の識別子（Rust 側で採番。frontend は stop 時にこの値のみを渡す）。
    pub launch_id: String,
    pub tool_id: String,
    // 009: 起動した Child は runtime process registry に保持し、停止はこの launch_id 経由で
    //   Child ハンドルに対して行う（PID 数値を frontend から受け取って kill しない）。
    //   なお macOS の `.app` は `/usr/bin/open` 経由で起動するため、この process_id は実アプリではなく
    //   即座に終了する `open` ヘルパの PID になる（＝ macOS の `.app` 停止は「既に終了済み」になる既知縮退。
    //   実対応は 013 macOS App Bundle Stop）。
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
    /// 009 停止操作用の識別子。起動に成功した Tool のみ Some（失敗した Tool には付けない）。
    #[ts(optional)]
    pub launch_id: Option<String>,
    #[ts(optional)]
    pub process_id: Option<u32>,
    #[ts(optional)]
    pub started_at: Option<String>,
    #[ts(optional)]
    pub error_message: Option<String>,
}

/// 単体プロセス停止（009）の状態。JSON は kebab-case（`stopped` / `already-exited` / `not-found` / `failed`）。
#[derive(Debug, Clone, Copy, Serialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = "../../src/features/tools/bindings/")]
pub enum StopStatus {
    /// kill に成功して停止した
    Stopped,
    /// stop 実行時点で既に終了していた
    AlreadyExited,
    /// registry に該当 launchId が無かった（停止操作の対象外）
    NotFound,
    /// kill に失敗した（registry に残して再試行可能）
    Failed,
}

/// 単体プロセス停止（009）の結果（API 戻り値）。JSON は camelCase。
/// エラー文言はフロントに出しても安全な短文に丸める（パス・環境情報を含めない）。
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/features/tools/bindings/")]
pub struct StopProcessResult {
    pub launch_id: String,
    pub tool_id: String,
    pub tool_name: String,
    pub process_id: u32,
    pub status: StopStatus,
    #[ts(optional)]
    pub stopped_at: Option<String>,
    #[ts(optional)]
    pub error_message: Option<String>,
}

/// Preset 単位停止（009）の結果（API 戻り値）。JSON は camelCase。
/// 選択中 Preset に紐づく registry 登録済みプロセスだけを対象に集約する。
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/features/presets/bindings/")]
pub struct StopPresetProcessesResult {
    pub preset_id: String,
    pub stopped_at: String,
    pub total_count: u32,
    pub success_count: u32,
    pub already_exited_count: u32,
    pub failure_count: u32,
    pub results: Vec<StopProcessResult>,
}

/// runtime process registry のプロセス状態（010 Runtime Status）。
/// JSON は lowercase（`running` / `stopped` / `error`）。
///
/// Rust 側が `std::process::Child::try_wait()` で判定できるのはこの3状態のみ:
/// - `try_wait()` が `Ok(None)` → Running（まだ終了していない）
/// - `try_wait()` が `Ok(Some(_))` → Stopped（既に終了した）
/// - `try_wait()` が `Err(_)` → Error（状態確認に失敗した）
///
/// UI 側の `waiting` / `starting` / `stopping` は操作中の一時状態であり registry では扱わない。
#[derive(Debug, Clone, Copy, Serialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "../../src/features/presets/bindings/")]
pub enum RuntimeProcessStatus {
    /// try_wait が None（稼働確認済み）
    Running,
    /// try_wait が終了状態を返した（既に終了）
    Stopped,
    /// try_wait が失敗した
    Error,
}

/// runtime process registry 内の管理プロセス1件の状態スナップショット（010 の API 戻り値）。
/// JSON は camelCase。
///
/// 現在のアプリ起動セッション中に stream-dock が registry に登録したプロセスのみを表す。
/// raw PID / path / command を frontend から受け取って状態確認するものではない。
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/features/presets/bindings/")]
pub struct RuntimeProcess {
    pub launch_id: String,
    pub tool_id: String,
    pub tool_name: String,
    /// 008 一括起動由来のみ Some（単体起動 007 は None）。
    #[ts(optional)]
    pub preset_id: Option<String>,
    #[ts(optional)]
    pub preset_item_id: Option<String>,
    pub process_id: u32,
    pub status: RuntimeProcessStatus,
    pub started_at: String,
    /// このスナップショットを取得した時刻。
    pub updated_at: String,
    /// 終了を検知した時刻（Running のときは None）。
    #[ts(optional)]
    pub ended_at: Option<String>,
    /// status が Error のときのフロント表示用の短文（パス・環境情報を含めない）。
    #[ts(optional)]
    pub error_message: Option<String>,
}
