//! rakuraku ドメインのサービス層。連携 id → 実装のディスパッチを担う。
//!
//! 連携追加＝ここに 1 行足すだけ（MVP は棒読みちゃん×VOICEVOX の 1 実装のみ）。

use crate::error::{AppError, AppResult};
use crate::tools::model::{Tool, ToolKind};

use super::integrations::Integration;

/// 登録済みの連携実装一覧（連携追加＝ここに 1 つ足すだけ）。
/// 032c-a: 棒読みちゃん×VOICEVOX 実装は方針転換で撤去したため現在は空。`find` は常に NotFound を返す
/// （空でも panic しない）。VOICEVOX 直接読み上げの連携は 032c-b 以降で再登録する。
fn registry() -> Vec<Box<dyn Integration>> {
    Vec::new()
}

/// 連携 id に対応する実装を返す。未知 id は NotFound（frontend は登録済み id のみ渡す想定だが、
/// Rust 側でも検証する・§8）。
pub fn find(id: &str) -> AppResult<Box<dyn Integration>> {
    registry()
        .into_iter()
        .find(|integration| integration.id() == id)
        .ok_or_else(|| AppError::not_found("対象の連携が見つかりません"))
}

/// 032b 修正2: 登録済みツール一覧から、期待する exe ファイル名（例: `VOICEVOX.exe` /
/// `BouyomiChan.exe`）に一致する Tool を返す（大小無視・`ToolKind::Executable` のみ・複数一致は先頭）。
///
/// らくらくツール設定は FS 広域走査をやめ、この「登録済みの小さなリスト」との exe 名照合だけで部品を
/// 解決する（同名 exe 偽装の入り口を排除）。対応関係は永続化しない（毎 scan で照合＝032 決定4）。
/// クロスプラットフォーム（自動起動 `rakuraku_launch_component` が全 OS で呼び、scan 検出は windows）。
pub fn resolve_tool_for_component<'a>(tools: &'a [Tool], expected_exe: &str) -> Option<&'a Tool> {
    tools.iter().find(|tool| {
        tool.kind == ToolKind::Executable
            && std::path::Path::new(&tool.executable_path)
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.eq_ignore_ascii_case(expected_exe))
    })
}
