# 039a フォントインポート Rust 基盤（取込・保存・レジストリ）

> 状態: **未着手（実装サブタスク）**。分割・線引きは親 [039](039-font-import.md) を正とする。
>
> **必読前提**: 親 [039](039-font-import.md)、DB レイヤの流儀 [`tools/repository.rs`](../../apps/desktop/src-tauri/src/tools/repository.rs)・[`util.rs`](../../apps/desktop/src-tauri/src/util.rs)、
> [`lib.rs`](../../apps/desktop/src-tauri/src/lib.rs) の `setup`（app_data_dir・246-257 行）、ファイル検証の流儀 [`tools/service.rs`](../../apps/desktop/src-tauri/src/tools/service.rs)、
> [`docs/security.md`](../security.md)（**§5 ファイル操作を管理領域限定**・CSP方針）。CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。

## 目的

ユーザーが選んだフォントファイルを**アプリの管理ディレクトリへコピーして保存**し、レジストリ（SQLite）に登録して、
webview へ data URI で供給する Rust 基盤を作る。これが 039b（`@font-face` 注入・選択 UI）のデータ源になる。

## 現在の前提（調査結果）

- ユーザーファイルをアプリ内へコピーする経路は無い。ファイル選択は frontend の `@tauri-apps/plugin-dialog` の `open()`
  （[`AddToolScreen.tsx`](../../apps/desktop/src/screens/add-tool/AddToolScreen.tsx) 116-134 行）で**パス文字列を得るだけ**。
- Rust の DB/検証/時刻の流儀: `CREATE TABLE IF NOT EXISTS`＋`ensure_column`（[`util.rs`](../../apps/desktop/src-tauri/src/util.rs) 80-96 行）、`now_rfc3339`、
  `require_non_empty`/`reject_control_chars`（25-38 行）、フルパス非露出の `with_filename_detail`（64-69 行）。接続は `DbState = Mutex<Connection>`。
- app data dir は `app.path().app_data_dir()`（[`lib.rs`](../../apps/desktop/src-tauri/src/lib.rs) 246 行、`create_dir_all` 済み）。base64 を DB に持つ前例は `tools.icon_png`。

## このタスクでやること

### `fonts` レジストリ＋管理ディレクトリ

- 新モジュール `apps/desktop/src-tauri/src/fonts/`（`model/repository/service/commands`）を追加し、`lib.rs` に `mod fonts;`＋setup で
  `fonts::repository::init(&conn)?;` を配線。テーブル `fonts`（`id`, `family`（表示名）, `original_filename`, `format`（ttf/otf/woff/woff2）,
  `stored_path`（app_data の fonts/ 相対）, `size`, `created_at`）。
- 管理ディレクトリ `app_data_dir/fonts/` を `create_dir_all` で用意（既存の data_dir 生成に倣う）。

### インポート（コピー＋検証）

- コマンド `import_font(source_path)`: frontend の `open()` で得たパスを受け、**Rust 側で検証**（拡張子許可リスト・サイズ上限・
  `reject_control_chars`・パス検証／§5/§8）した上で、`app_data_dir/fonts/<生成id>.<ext>` へ**コピー**し、`fonts` に登録してメタデータを返す。
  管理ディレクトリ外へは書き込まない。family 名は可能なら抽出、無理ならファイル名由来にフォールバック（依存追加が要るなら親 039 の方針どおり理由を添えて提案）。

### 取得・削除・data URI 供給

- `list_fonts`（レジストリ一覧）、`delete_font`（レコード＋実ファイル削除）、`get_font_data(id)`（保存ファイルを読み base64 `data:font/...` を返す）を追加し
  `lib.rs` の `generate_handler!` に登録、ts-rs で DTO を bindings 出力。

### capability（最小権限）

- インポート UI をコメビュ窓に置くため、`@tauri-apps/plugin-dialog` の **open 権限のみ**を
  [`capabilities/comment-viewer.json`](../../apps/desktop/src-tauri/capabilities/comment-viewer.json)（現状 `core:default`）へ追加する（§3 最小権限）。

### security.md 更新

- 「## CSP方針」/「§5」周辺に、**ローカルフォントインポートの保存範囲（app data dir 配下 fonts/ 限定）・data URI 供給・外部フォント非追加**を明文化。

## このタスクでやらないこと

- `@font-face` 注入・選択 UI・プレビュー・適用（039b）。オーバーレイ意匠変更（037）。
- 外部フォント/CDN 参照。フォントのアプリ同梱配布。

## セキュリティ制約（docs/security.md 準拠）

- **ファイル操作は Rust 側・管理領域（app_data_dir/fonts/）限定**（§5）。コピー先を管理ディレクトリ内に固定しパス検証する。
- **入力検証を Rust で必ず行う**（拡張子許可リスト・サイズ上限・制御文字拒否・パス検証／§8）。frontend の生パスを信用しない。
- **外部通信ゼロ・CSP 方針不変**（data URI で供給・外部フォント非追加）。plugin-dialog は open 権限のみ最小追加（§3）。
- ログにフルパス・フォント内容を出さない（`with_filename_detail` でファイル名のみ・§9）。エラーは `AppError` 経由。
- 新規 crate を増やさない方針（family 名抽出等で必要なら理由を添えて提案）。

## 完了条件

- `import_font` でフォントが `app_data_dir/fonts/` にコピーされ `fonts` に登録され、`list_fonts`/`get_font_data`/`delete_font` が動作する。
- 検証（拡張子/サイズ/パス）で不正ファイルを拒否し、管理ディレクトリ外に書き込まない。comment-viewer capability の dialog 権限は open のみ。
- security.md に保存範囲・data URI 供給・外部フォント非追加が明文化されている。
- `cargo check`・`pnpm --filter ./apps/desktop typecheck` / `lint`（bindings 再生成後）が通る。[`docs/progress.md`](../progress.md) を更新。

## 確認コマンド

```bash
git diff --stat
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
pnpm --filter ./apps/desktop tauri dev   # .ttf/.otf を import_font→ fonts/ にコピー＆登録、list_fonts/get_font_data が返ること、
                                         #   拡張子違い/巨大ファイルが拒否されること、delete_font で実ファイルも消えることを確認
```

## 実装後に必要なレビュー

- **security-review（必須）**: ファイル書き込みが管理領域（app_data_dir/fonts/）限定であること、入力検証（拡張子/サイズ/パス/制御文字）が
  Rust 側で効くこと、外部通信・CSP・font-src を増やさず data URI で供給していること、dialog 権限が open のみの最小追加であること、
  ログにフルパス/フォント内容を出さないことを確認する。security.md 更新の妥当性も確認。
