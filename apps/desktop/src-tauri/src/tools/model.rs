use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// 023: ツール種別。`executable`（実行ファイル）／`url`（既定ブラウザで開くサイト）／
/// `internal`（032c-a: 内蔵ツール。別ウィンドウを開くだけで spawn/shell を伴わない）。
/// JSON は lowercase（`"executable"` / `"url"` / `"internal"`）。既定は後方互換のため `Executable`。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "../../src/features/tools/bindings/")]
pub enum ToolKind {
    /// 実行ファイル起動（従来）。`executable_path` を使う。
    #[default]
    Executable,
    /// 既定ブラウザで URL を開く（023）。`url` を使い、`executable_path` は空。
    Url,
    /// 032c-a: 内蔵ツール（コメントビューア等）。`executable_path` 空・`url` NULL で、起動は
    /// アプリ内の別ウィンドウを開くのみ（validate_executable/spawn/PID registry を通さない）。
    Internal,
}

impl ToolKind {
    /// DB 保存用の文字列。
    pub fn as_str(self) -> &'static str {
        match self {
            ToolKind::Executable => "executable",
            ToolKind::Url => "url",
            ToolKind::Internal => "internal",
        }
    }

    /// DB 文字列から復元する。未知値は前方互換のため `Executable` に丸める。
    pub fn from_str_lenient(value: &str) -> Self {
        match value {
            "url" => ToolKind::Url,
            "internal" => ToolKind::Internal,
            _ => ToolKind::Executable,
        }
    }
}

/// 永続化される Tool（DB / API 戻り値）。JSON は camelCase。
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/features/tools/bindings/")]
pub struct Tool {
    pub id: String,
    pub name: String,
    /// 023: `kind = executable` のとき使う。`url` 種別では空文字。
    pub executable_path: String,
    pub description: String,
    pub icon_label: String,
    /// 018: 自動抽出した実アイコン（`data:` 無しの base64 PNG）。抽出できない場合は None。
    #[ts(optional)]
    pub icon_png: Option<String>,
    /// 023: ツール種別（`executable` / `url`）。
    pub kind: ToolKind,
    /// 023: `kind = url` のとき使う既定ブラウザで開く URL（http/https のみ）。`executable` 種別では None。
    #[ts(optional)]
    pub url: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// ツール新規作成の入力。description / icon_label は任意。
#[derive(Debug, Clone, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/features/tools/bindings/")]
pub struct CreateToolInput {
    pub name: String,
    #[serde(default)]
    pub executable_path: String,
    #[serde(default)]
    #[ts(optional)]
    pub description: Option<String>,
    #[serde(default)]
    #[ts(optional)]
    pub icon_label: Option<String>,
    /// 018: 自動抽出した実アイコン（`data:` 無しの base64 PNG）。未抽出なら省略/None。
    #[serde(default)]
    #[ts(optional)]
    pub icon_png: Option<String>,
    /// 023: ツール種別。省略時は後方互換で `executable`。
    #[serde(default)]
    pub kind: ToolKind,
    /// 023: `kind = url` のときの URL（http/https）。`executable` 種別では省略/None。
    #[serde(default)]
    #[ts(optional)]
    pub url: Option<String>,
}

/// ツール更新の入力。create と同項目（id は command 引数で受ける）。
#[derive(Debug, Clone, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/features/tools/bindings/")]
pub struct UpdateToolInput {
    pub name: String,
    #[serde(default)]
    pub executable_path: String,
    #[serde(default)]
    #[ts(optional)]
    pub description: Option<String>,
    #[serde(default)]
    #[ts(optional)]
    pub icon_label: Option<String>,
    /// 018: 自動抽出した実アイコン（`data:` 無しの base64 PNG）。未抽出なら省略/None。
    #[serde(default)]
    #[ts(optional)]
    pub icon_png: Option<String>,
    /// 023: ツール種別。省略時は後方互換で `executable`。
    #[serde(default)]
    pub kind: ToolKind,
    /// 023: `kind = url` のときの URL（http/https）。`executable` 種別では省略/None。
    #[serde(default)]
    #[ts(optional)]
    pub url: Option<String>,
}
