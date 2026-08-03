//! 058a: 通知音の出力デバイス選択と再生（②-軽）。
//!
//! 「配信に載せる音／載せない音」を**出力デバイスの出し分け**に還元するための基盤。読み上げ
//! （VOICEVOX）は Web Audio のまま OS 既定＝仮想オーディオデバイスへ出て**配信に載り**、通知音だけを
//! ここで**実デバイスを明示指定して**鳴らす＝**配信に載らない**。実際の通知音（コメント音・投げ銭音・
//! クールダウン・排他）は 059 の領分で、本モジュールは「列挙」と「指定デバイスで鳴らす」だけを持つ。
//!
//! **なぜ Rust なのか**: 058s の実測で webview 側では出力デバイスを選べないことが確定した。
//! macOS(WKWebView) は `navigator.mediaDevices` ごと非対応、Windows(WebView2) は `setSinkId` はあるが
//! `enumerateDevices` が `deviceId`・`label` とも空の 1 件しか返さず**渡せる ID が存在しない**。
//! Rust（cpal）は権限なしでデバイス名と安定 ID を返すので、機能の前提条件は Rust 側にしか無い。
//!
//! **DB を持たないので 3 層**（`commands` / `model` / `service`。`repository.rs` は作らない）。
//! 再生の成否を SQLite / app_logs へ記録する経路も作らない（下記 §9 の理由）。
//!
//! セキュリティ（docs/security.md §3 / §4 / §8 / §9 / §10）:
//! - **入力（マイク）に一切触れない。** `output_devices()` しか呼ばず、`devices()` /
//!   `default_input_device()` / `build_input_stream()` を使わない。これは
//!   `service` の契約テストが**ソース文字列で機械的に**固定している。
//! - **コマンドは単一目的の 2 本だけ**（§3）。`run_command` 的な汎用も、任意パスの音声を鳴らす
//!   コマンドも作らない。そもそも**音源ファイルが存在しない**（音はアプリ内で合成する）ので、
//!   frontend からパスを渡させる余地が構造的に無い。
//! - **frontend から受けたデバイス ID は Rust 側で列挙結果と照合してから使う**（§8）。
//!   照合に失敗したら**既定デバイスへ落とさずエラー**にする（fail-closed）。⚠ 既定へ落とすと
//!   ②-軽の運用では仮想オーディオデバイス＝**配信に載る側**へ出てしまい、この機能の存在理由が壊れる。
//! - **デバイス名・デバイス ID をログにも frontend のエラーにも出さない**（§9）。コマンドが
//!   `DbState` を取らない（最小権限）ので、app_logs へ到達する経路そのものが無い。
//! - **新規 egress ゼロ・capability 追加ゼロ・`csp: null` 不変・`tauri.conf.json` 差分ゼロ。**
//! - 新規 crate は `rodio`（`default-features = false, features = ["playback"]`）1 本。
//!   理由と feature を絞る根拠は `Cargo.toml` の該当コメントと §10 を正とする。
//!
//! ⚠ **Windows 未検証**（058s の実測は macOS のみ）。WASAPI でのデバイス名・安定 ID の取得と実再生は
//! 098 完了後に実機で確認すること。詳細は docs/tasks/058a-audio-routing-foundation.md の
//! 「Windows 未検証」節。

pub mod commands;
pub mod model;
pub mod service;
