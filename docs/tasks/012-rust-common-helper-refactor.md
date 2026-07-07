# 012 Rust Common Helper Refactor

## 目的

004〜007 で各機能モジュール（tools / presets / preset_items / process）に散在した
**同一イディオムの重複コード**を、共通ヘルパへ抽出して一元化する。

挙動は一切変えない**純粋なリファクタリング**。時刻フォーマットや検証メッセージなどの
「定義が1箇所にない」状態を解消し、今後の機能追加（008 以降）で重複がさらに増えるのを防ぐ。

013 Windows Build の前に実施する（ビルド・パッケージング前にコードベースを整えておく）。

## 背景

007 Process Launch のレビュー時に、以下の重複が確認された（実ファイル調査済み）。

- `chrono::Utc::now().to_rfc3339()` が **4ファイル8箇所**で完全重複
  - `tools/service.rs`、`presets/service.rs`、`preset_items/service.rs`、`process/service.rs`
- パス不在エラーの生成 `AppError::PathNotFound(format!("指定された実行ファイルが見つかりません: {}"))`
  が `process/service.rs` と `tools/service.rs` で**文字列まで一致**
- 「trim して空なら Validation」ガードが複数箇所（`process/commands.rs`、`preset_items/service.rs` 等）
- 制御文字拒否 `x.chars().any(char::is_control)` が **4箇所**（`tools/service.rs` ×2、`presets/service.rs` ×2）
- 任意フィールドの正規化 `x.as_deref().unwrap_or("").trim().to_string()` が複数箇所（`tools`/`presets`）

なお **Rust / React の型二重定義は無い**（IPC 型・`AppError`・入力型は ts-rs で Rust を単一ソースに
生成し React は再エクスポートのみ）。**この観点は本タスクの対象外**。

## このタスクでやること

- Rust 側に小さな共通ヘルパを1モジュール新設する（例: `src-tauri/src/util.rs` または `common/`）
- 以下を共通化し、各 service / command の呼び出し側を差し替える
  - `now_rfc3339() -> String`（8箇所）
  - パス不在エラー生成ヘルパ（`process` / `tools` の一致メッセージ）
  - `require_non_empty(value, message)` 相当の必須・空チェック
  - `reject_control_chars(value, message)` 相当の制御文字チェック
  - `normalize_optional(&Option<String>) -> String`（任意フィールドの trim 正規化）
- 差し替え後もコンパイル・型生成・既存挙動が不変であることを確認する

## このタスクでやらないこと

- 検証**ルールそのもの**の変更（メッセージ文言・チェック内容・順序は現状維持）
- 起動時パス検証と登録時パス検証の**統合**（意図が別で分けて正しい。共通化するのは
  「メッセージ生成」など下位プリミティブのみで、検証フロー自体は各モジュールに残す）
- 新機能・新 command の追加
- DB スキーマ / bindings 出力の変更（型が変わる変更はしない）
- 新規ライブラリ追加
- React 側の変更（型は ts-rs 一元化済み。フロントの `"ordered"`/`"parallel"` リテラル散在等は別途）

## 対象の重複箇所（差し替え元）

| ヘルパ | 現状の重複箇所 |
|--------|----------------|
| `now_rfc3339()` | `tools/service.rs:73,115` / `presets/service.rs:67,100` / `preset_items/service.rs:48,95,123` / `process/service.rs:89` |
| パス不在エラー | `process/service.rs:31` / `tools/service.rs:51` |
| 必須・空チェック | `process/commands.rs:16` / `preset_items/service.rs:13,16` ほか |
| 制御文字拒否 | `tools/service.rs:39,44` / `presets/service.rs:37,48` |
| 任意フィールド正規化 | `tools/service.rs:20,21` / `presets/service.rs:17` |

（行番号は 007 時点。実装時に再確認する）

## 方針

- ヘルパは**薄く**保つ。過剰な抽象化（trait 化・ジェネリクスの多用）はしない
- 返り値・エラー型は既存 `AppError` / `AppResult` をそのまま使う
- 1回の作業でルール変更とリファクタを混ぜない（CLAUDE.md 準拠。純リファクタに限定）
- 差し替えは機械的置換に留め、挙動差分ゼロを保つ

## セキュリティ制約（docs/security.md 準拠）

- 外部通信・危険 command・capabilities 変更は無し（純内部リファクタ）
- 検証の**強度を下げない**（空・制御文字・実在・絶対パス・拡張子拒否は現状維持）
- ログ出力・エラー露出の方針を変えない（`LaunchFailed` の固定文言等は不変）

## 既存機能への影響確認

以下が壊れていないことを確認する（挙動不変が本タスクの要件）。

- Tool の登録 / 一覧 / 編集 / 削除（004）
- Preset の作成 / 一覧 / 編集 / 削除（005）
- PresetItem の追加 / 削除 / 並び替え / ordered・parallel 切替（006）
- Tool の単体起動（007）

## 完了条件

- 共通ヘルパモジュールが1つ追加され、対象の重複が差し替えられている
- 検証ルール・メッセージ・挙動が変わっていない
- DB スキーマ・bindings 出力に差分が出ない
- 新規ライブラリ・capabilities 追加が無い
- `cargo check` / typecheck / lint が通る

## 確認コマンド

```bash
git diff --stat
cd apps/desktop/src-tauri && cargo check
pnpm --filter ./apps/desktop gen:bindings   # 型生成物に差分が出ない（挙動不変）ことを確認
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
pnpm --filter ./apps/desktop tauri dev       # 004〜007 の主要動線が非破壊であることを実機確認
```
