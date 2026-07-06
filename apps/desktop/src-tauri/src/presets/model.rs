use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// 永続化される Preset（DB / API 戻り値）。JSON は camelCase。
/// 005 時点ではツール紐付け・起動順・並行設定は持たない（006 以降で拡張）。
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/features/presets/bindings/")]
pub struct Preset {
    pub id: String,
    pub name: String,
    pub description: String,
    pub created_at: String,
    pub updated_at: String,
}

/// プリセット新規作成の入力。description は任意。
#[derive(Debug, Clone, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/features/presets/bindings/")]
pub struct CreatePresetInput {
    pub name: String,
    #[serde(default)]
    #[ts(optional)]
    pub description: Option<String>,
}

/// プリセット更新の入力。create と同項目（id は command 引数で受ける）。
#[derive(Debug, Clone, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/features/presets/bindings/")]
pub struct UpdatePresetInput {
    pub name: String,
    #[serde(default)]
    #[ts(optional)]
    pub description: Option<String>,
}
