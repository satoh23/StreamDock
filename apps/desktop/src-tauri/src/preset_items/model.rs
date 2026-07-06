use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// ツールの起動モード。ordered は起動順が重要なツール、parallel は順番なしで並行起動するツール。
/// enum のため、デシリアライズ時点で `"ordered"` / `"parallel"` 以外の値は拒否される
/// （＝launchMode のバリデーションを型で担保する）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/features/presets/bindings/")]
pub enum LaunchMode {
    Ordered,
    Parallel,
}

impl LaunchMode {
    /// DB 保存用の文字列表現。
    pub fn as_str(self) -> &'static str {
        match self {
            LaunchMode::Ordered => "ordered",
            LaunchMode::Parallel => "parallel",
        }
    }

    /// DB の文字列から復元する。未知の値は ordered にフォールバックする。
    pub fn from_str(value: &str) -> Self {
        match value {
            "parallel" => LaunchMode::Parallel,
            _ => LaunchMode::Ordered,
        }
    }
}

/// 永続化される PresetItem（Preset と Tool の紐付け／DB・API 戻り値）。JSON は camelCase。
/// プリセット内で「どのツールを、どの順番で、または並行で起動するか」を表す。
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/features/presets/bindings/")]
pub struct PresetItem {
    pub id: String,
    pub preset_id: String,
    pub tool_id: String,
    pub launch_mode: LaunchMode,
    pub order_index: u32,
    pub enabled: bool,
    pub created_at: String,
    pub updated_at: String,
}

/// プリセットへのツール追加の入力。launch_mode は省略時 ordered。
/// order_index は末尾に自動採番するため入力に含めない。
#[derive(Debug, Clone, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/features/presets/bindings/")]
pub struct AddPresetItemInput {
    pub preset_id: String,
    pub tool_id: String,
    #[serde(default)]
    #[ts(optional)]
    pub launch_mode: Option<LaunchMode>,
}

/// PresetItem 更新の入力。起動モードと有効フラグのみ扱う。
/// 起動順（order_index）は reorder_preset_items で扱うためここには含めない。
#[derive(Debug, Clone, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/features/presets/bindings/")]
pub struct UpdatePresetItemInput {
    pub launch_mode: LaunchMode,
    pub enabled: bool,
}
