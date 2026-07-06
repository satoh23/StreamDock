use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// 永続化される Tool（DB / API 戻り値）。JSON は camelCase。
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/features/tools/bindings/")]
pub struct Tool {
    pub id: String,
    pub name: String,
    pub executable_path: String,
    pub description: String,
    pub icon_label: String,
    pub created_at: String,
    pub updated_at: String,
}

/// ツール新規作成の入力。description / icon_label は任意。
#[derive(Debug, Clone, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/features/tools/bindings/")]
pub struct CreateToolInput {
    pub name: String,
    pub executable_path: String,
    #[serde(default)]
    #[ts(optional)]
    pub description: Option<String>,
    #[serde(default)]
    #[ts(optional)]
    pub icon_label: Option<String>,
}

/// ツール更新の入力。create と同項目（id は command 引数で受ける）。
#[derive(Debug, Clone, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/features/tools/bindings/")]
pub struct UpdateToolInput {
    pub name: String,
    pub executable_path: String,
    #[serde(default)]
    #[ts(optional)]
    pub description: Option<String>,
    #[serde(default)]
    #[ts(optional)]
    pub icon_label: Option<String>,
}
