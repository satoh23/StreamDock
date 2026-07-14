//! らくらくツール設定（外部アプリ連携）ドメイン（032b）。
//!
//! 032a の画面枠組みに実行ロジックを差し込む vertical slice。永続化はしない（バックアップはファイル
//! のみ・SQLite テーブルは追加しない）ため `repository.rs` は持たない。実処理は各連携実装の
//! `#[cfg(windows)]` 分岐に閉じ、非 Windows は「未対応」を返す。境界は docs/security.md /
//! docs/tasks/032-rakuraku-auto-setup-design.md を正とする（ループバック限定・誘導のみ・バックアップ先取り）。

pub mod commands;
pub mod integrations;
pub mod model;
pub mod service;
