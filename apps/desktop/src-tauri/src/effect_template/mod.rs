//! 061c: エフェクトテンプレート（取り込み・保存・レジストリ・供給）の Rust 基盤。
//!
//! ユーザーが用意した**テンプレートのディレクトリ**（`manifest.json` ＋ 参照メディア）を
//! **`app_data_dir/effects/<uuid v4>/`** へ取り込み、`effect_templates` テーブルへ登録して、
//! 061d が描画するための **data URI** を返す。
//!
//! ## このモジュールが背負っている不変条件
//!
//! ⚠⚠ **第三者のコードを 1 行も実行しない。** テンプレートは
//! **アセット（画像 / GIF / APNG / WebP / WebM / 音源）＋宣言的レイアウト（JSON）**だけで、
//! **HTML / CSS / JS を受け付けない**（親 061 の決定）。理由は
//! 「`csp: null` ＋ **アプリ定義コマンドが ACL 対象外**（046b）なので、注入された JS が
//! Tauri のコマンドを全部呼べる」——たぬえさ3 の `forOBS3.html` 互換は**捨てている**。
//!
//! ⚠⚠ **`manifest.json` が参照しているファイルだけを読む。ディレクトリを列挙しない。**
//! `read_dir` を 1 度も呼ばないので、`.html` や実行ファイルを同梱されても**それを指すコードが存在しない**
//! （件数上限ではなく構造で担保している）。契約テストが `read_dir(` の不在を固定する。
//!
//! ⚠⚠ **外部通信ゼロ**（§1）。`manifest.json` に **URL フィールドを作らない**＝
//! 外部取得の経路を最初から作らない。契約テストが `reqwest` / `TcpStream` 等の不在を固定する。
//!
//! ⚠ **読み込み元の組み立てには第三者の入力が入る**（`<選ばれたディレクトリ>/<manifest.media>`）。
//! これは 060b（`overlay_theme`）に**無かった軸**で、`service` の 2 つの規則
//! （**単一ファイル名規則** ＋ **アセットの symlink 拒否**）が閉じている。
//! 060b の「symlink を拒否しない」という判断が 061c に及ばない理由は [`service`] のモジュール doc が正。
//!
//! ## 層の構成（overlay_theme と同型 ＋ manifest）
//!
//! - [`commands`] … 薄い委譲のみ（4 本）
//! - [`service`] … パスの検証（**UNC 拒否 / 単一ファイル名規則 / symlink 拒否**）、拡張子の許可リスト、
//!   サイズ上限、**マジックバイト**、保存先の組み立て、書き込み↔INSERT の順序と後始末、`remove_dir_all` の安全策
//! - [`manifest`] … **スキーマ検証**（`deny_unknown_fields` / `schemaVersion` / 範囲 / 差し込み変数の allow-list）。
//!   I/O をまったく持たない純粋層
//! - [`repository`] … SQL のみ
//! - [`model`] … DTO（ts-rs）と `manifest.json` を受ける serde 型
//!
//! ## セキュリティ（docs/security.md）
//!
//! - §5 例外（061c 節）: 書き込みは `app_data_dir/effects/` に限定。**保存先の組み立てにユーザー入力を
//!   1 バイトも結合しない**（ディレクトリ名は `<uuid v4>`・ファイル名は `media.<拡張子>` / `sound.<拡張子>` で
//!   拡張子は許可リストの定数）。削除は `remove_dir_all` で、安全策 5 点は `service::remove_managed_dir` が正。
//! - §8: frontend の生パス・生 manifest を信用しない。検証はすべて Rust 側で行う。
//! - §3: コマンドは単一目的。⚠ **アプリ定義コマンドは ACL の対象外なので、ここで足す 4 本は
//!   全 5 窓（main / comment-viewer / comment-overlay / pinned-overlay / effect-overlay）から呼べる**。
//! - ## CSP方針（061c 節）: メディアは **data URI のみ**で webview へ渡す。
//!   asset protocol も `fs` plugin も増やさず `csp: null` は不変。**描画側にも最終防波堤のガード**を置く
//!   （036a の `avatarDataUri` と同型・`src/screens/obs-effects/effectMedia.ts`）。
//! - §9: ログにも `AppError` にもテンプレート名・フルパス・manifest 本文を出さない。
pub mod commands;
pub mod manifest;
pub mod model;
pub mod repository;
pub mod service;
