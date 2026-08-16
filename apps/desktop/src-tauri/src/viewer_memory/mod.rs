//! 038a: 視聴者メモリ（一度コメントした視聴者を記憶する）の Rust データ基盤。
//!
//! 受信済みコメント（frontend が loopback WS で受け取り済みの値）を Tauri コマンド `record_comment`
//! で受け取り、視聴者ごとに upsert・集計して **端末内 SQLite のみ**に保存する。一覧/詳細/メモ/削除の
//! コマンドを提供し、038b（UI）・038c（バッジ）・040（ROM 突合）のデータ源になる。
//!
//! セキュリティ: 保存は端末内限定・端末外へ送信しない・新規の外部通信/宛先/capability を増やさない
//! （docs/security.md §9 の保存ポリシーを視聴者メモリに限って解禁・「コメントビューア方針」⑪）。tools と
//! 同型のレイヤード構成（commands / service / repository / model）。
pub mod commands;
/// 065a: 取り込み元コメントビューアーの公式 CSV エクスポートのパース（DB に触らない純関数層）。
pub mod csv_import;
pub mod model;
pub mod repository;
pub mod service;
