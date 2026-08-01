//! 055b: アプリ自己アップデートの**更新検出**（`tauri-plugin-updater` の Rust API 専用ラッパ）。
//!
//! 公開リリースリポジトリ `satoh23/StreamDock-releases` の `latest.json` を見て「更新があるか」だけを
//! 判定する。UI（ベル・バッジ・アップデート画面）は 055c、DL/インストール/再起動は 055d。
//!
//! **DB を持たないので 2 層**（`commands` のみ。`service` / `repository` は作らない）。更新の成否を
//! SQLite / app_logs へ記録する経路も作らない（新規の保存経路を増やさない）。
//!
//! セキュリティ（docs/security.md §1「例外（055・アプリ自己アップデート）」/ §3 / §9 / §10）:
//! - **StreamDock 本体プロセス初のインターネット egress**。従来 egress はすべて Node sidecar 側に集約され
//!   `host-guard.ts` の fail-closed allow-list で守られていたが、自己アップデートは Tauri プロセス自身が
//!   自分を置き換える性質上 sidecar へ寄せられない（sidecar はコメビュ窓を開いている間しか生きておらず、
//!   plugin 内部の reqwest はホストガードを一切通らない）。
//! - **宛先は `tauri.conf.json` の `plugins.updater.endpoints`（コンパイル時定数）だけ**。
//!   `UpdaterBuilder::endpoints()` を呼ばない＝実行時にもフロントからも差し替えられない。
//!   完全性は minisign 公開鍵検証で fail-closed。
//! - **capability 差分ゼロ**（`updater:*` / `process:*` を配らない・JS 側 plugin を入れない）。
//!   露出するのは単一目的のアプリ定義コマンド 1 本だけで、引数は `AppHandle` のみ（§3 最小権限）。
//! - **エラーに URL を載せない**（§9）。詳細は `AppError::update_check_failed` の注記。

pub mod commands;
