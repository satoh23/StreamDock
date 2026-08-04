//! 060b: オーバーレイのカスタム CSS テーマ（取り込み・保存・レジストリ）の Rust 基盤。
//!
//! ユーザーが用意した `.css` を **`app_data_dir/themes/<id>.css`** へ取り込み、`overlay_themes`
//! テーブルへ登録して、060d がオーバーレイ窓へ注入するための CSS 文字列を返す。
//!
//! ## このモジュールが背負っている不変条件
//!
//! ⚠⚠ **保存する CSS には外部リソース参照が 1 つも残っていない。** これは「念のための処理」ではなく
//! **唯一の壁**である:
//! - `tauri.conf.json` の `csp` は `null`（＝CSP を強制していない）。Tauri v2 の `csp` はアプリ全体に
//!   1 つしか無く、`comment-viewer` 窓は Twitch / YouTube / VOICEVOX / OBS への `connect-src` を要するため、
//!   **オーバーレイ窓だけに効かせることができない**（060a レビュー S-4）。
//! - 060a のセレクタ契約（`.sd-comment` / `.sd-comment-icon` 等の安定クラス）により、ユーザー CSS は
//!   オーバーレイの**全要素を文書化された名前で確定的に狙える**（060a レビュー S-3）。
//! - とくに `.sd-comment-icon` は、036a の「webview が踏むのは data URI のみ」という不変条件を
//!   背負っている要素そのもの。除去に穴があると 036a がその要素の上で破れる。
//! - 除去漏れの被害＝**オーバーレイ窓から外部 GET が飛ぶ**＝ docs/security.md §1 の直接違反。
//!
//! 除去そのものは [`sanitize`] が単独で持つ（**このモジュールで唯一の壁なので専用ファイルに立てた**。
//! sidecar の `host-guard.ts` を「専用ガードを別に立てる作法の手本」と 060c が呼んでいるのと同じ判断）。
//!
//! ## 層の構成（tools / viewer_memory と同型 ＋ sanitize）
//!
//! - [`commands`] … 薄い委譲のみ
//! - [`service`] … 検証（name / path / 拡張子 / サイズ / UTF-8 / 本文の制御文字 / 件数上限）、
//!   保存先の組み立て、書き込み↔INSERT の順序と後始末
//! - [`sanitize`] … **外部参照の除去**（CSS トークナイザ・allow-list・残留検証）
//! - [`repository`] … SQL のみ
//! - [`model`] … DTO
//!
//! ## セキュリティ（docs/security.md）
//!
//! - §5 例外: 書き込みは `app_data_dir/themes/` に限定。**保存先の組み立てにユーザー入力を
//!   1 バイトも結合しない**（ファイル名は `<uuid v4>.css`）。
//! - §8: frontend の生パス・生 CSS を信用しない。検証はすべて Rust 側で行う。
//! - §3: コマンドは単一目的。⚠ **アプリ定義コマンドは ACL の対象外なので、ここで足す 5 本は
//!   全 4 窓（main / comment-viewer / comment-overlay / pinned-overlay）から呼べる**（046b / 055b と同じ限界）。
//! - §1: 外部通信ゼロ。本モジュールは**外部参照を除去する側**で、取得は 060c の領分。
//! - §9: ログにも `AppError` にも CSS 本文・フルパス・除去した URL を出さない。
pub mod commands;
pub mod model;
pub mod repository;
pub mod sanitize;
pub mod service;
