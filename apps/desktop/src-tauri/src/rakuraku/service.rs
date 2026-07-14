//! rakuraku ドメインのサービス層。連携 id → 実装のディスパッチを担う。
//!
//! 連携追加＝ここに 1 行足すだけ（MVP は棒読みちゃん×VOICEVOX の 1 実装のみ）。

use crate::error::{AppError, AppResult};

use super::integrations::bouyomi_voicevox::BouyomiVoicevox;
use super::integrations::Integration;

/// 登録済みの連携実装一覧（連携追加＝ここに 1 つ足すだけ）。
fn registry() -> Vec<Box<dyn Integration>> {
    vec![Box::new(BouyomiVoicevox)]
}

/// 連携 id に対応する実装を返す。未知 id は NotFound（frontend は登録済み id のみ渡す想定だが、
/// Rust 側でも検証する・§8）。
pub fn find(id: &str) -> AppResult<Box<dyn Integration>> {
    registry()
        .into_iter()
        .find(|integration| integration.id() == id)
        .ok_or_else(|| AppError::not_found("対象の連携が見つかりません"))
}
