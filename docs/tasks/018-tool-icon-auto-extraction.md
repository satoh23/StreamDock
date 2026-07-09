# 018 Tool Icon Auto-Extraction

## 目的

ツール追加/編集画面でユーザーが選んだ実行ファイルの**実アイコン**（各アプリのアイコン）を自動抽出し、
表示・保存する（ユーザー要望 6）。現状はアイコンラベル（1 文字）しか無く、アプリらしさが乏しい。

## 現在の前提

- 017 Tool Path Input Lock 完了。実行ファイルパスはピッカー（`open()`）経由でのみ設定される。
- Tool のアイコンは現状「1 文字のラベル」だけ（`tools.icon_label`、`toIconLetter` で表示）。
  画像/実アイコンの仕組みは無い。
- Tool モデルは `tools/model.rs`（`Tool` / `CreateToolInput` / `UpdateToolInput`）、
  ts-rs バインディングが `apps/desktop/src/features/tools/bindings/` に生成される。
- `tools` テーブルは `apps/desktop/src-tauri/src/tools/repository.rs` の `init()` で
  `CREATE TABLE IF NOT EXISTS`。**マイグレーション基盤は無い**（各 `init()` が冪等 DDL）。
- 起動系のパス検証は `process/service.rs::validate_executable`（絶対パス・実在・非ディレクトリ・
  `.lnk`/`.bat` 拒否）にある。
- CSP 方針: リモート画像は禁止。`data:` の inline は許容。
- 既存の依存: `sysinfo`（macOS 限定）、`windows` クレート（Windows 限定）が既にある
  （target 別に依存を足す前例がある）。プラグインは `tauri-plugin-opener` / `tauri-plugin-dialog`。

## このタスクでやること

- Rust に**限定的な新規コマンド** `extract_app_icon(path) -> AppResult<Option<String>>` を追加する。
  - 返り値は base64 PNG（`data:` プレフィックス無しの純粋な base64 文字列）。
  - 抽出できない形式・失敗時は `Ok(None)`（frontend は `icon_label` 文字にフォールバック）。
  - 抽出前に `validate_executable` 相当でパス検証（非空・絶対・実在・`.lnk`/`.bat` 拒否）。
  - **読み取り専用**。ファイル書き込みや外部通信は行わない。
  - 出力画像は **≤128px** にリサイズしてから PNG エンコード（DB 肥大化を防ぐ）。
  - `lib.rs` の `invoke_handler` に登録。コマンドは tools feature 配下（例: `tools/icon.rs` 新設 or
    `tools/commands.rs` 拡張）に置く。
- プラットフォーム別抽出:
  - **macOS(.app)**: `Contents/Info.plist` の `CFBundleIconFile`（拡張子無しなら `.icns` 補完）→
    `Contents/Resources/<name>.icns` を解決 → 最大サイズの画像を PNG 化。
  - **Windows(.exe)**: 既存 `windows` クレートの feature 追加で埋め込みアイコンリソースを抽出 → PNG 化。
  - **Linux / 非バンドル / スクリプト**: `Ok(None)`。
- スキーマ変更（マイグレーション基盤なし）:
  - `tools` に nullable カラム `icon_png TEXT` を追加。
  - 冪等 `ALTER TABLE ADD COLUMN` ガード関数 **`util.rs::ensure_column`** を**本タスクで新設**する
    （`pragma_table_info` で存在確認してから `ALTER TABLE ... ADD COLUMN`）。019 でも共用する。
  - `tools::repository::init` の `CREATE TABLE IF NOT EXISTS` 直後に `ensure_column` を呼ぶ。
- モデル/永続化:
  - `Tool` に `icon_png: Option<String>`（`#[ts(optional)]`）、`CreateToolInput` / `UpdateToolInput` に
    `#[serde(default)] #[ts(optional)] icon_png: Option<String>` を追加。ts-rs バインディング再生成。
  - `tools/repository.rs`（`TOOL_COLUMNS` / `row_to_tool` / `insert` / `update`）と
    `tools/service.rs`（`create` / `update`）に `icon_png` を通す（正規化せず保存）。
- frontend 配線:
  - `AddToolScreen.tsx` の `selectFile()` でパス確定後に `extract_app_icon` を invoke し、base64 を state 保持。
  - プレビューは base64 があれば `<img src="data:image/png;base64,...">`、無ければ既存の
    `toIconLetter` 文字を表示。保存ペイロード（`createTool`/`updateTool`）に `icon_png` を含める。
  - 一覧・サイドバー・`IconTile`（`features/tools/display.ts` / `components/primitives.tsx`）を
    「PNG があれば PNG、無ければ文字」に対応。
- docs/progress.md を更新する。

## 依存追加（理由の明示が必要）

- `image`: PNG エンコード / リサイズのため。広く使われ、外部通信なし。
- macOS 用: `plist`（Info.plist パース）+ `icns`（`.icns` デコード）。いずれも pure-Rust・mac target 限定で、
  既存 `sysinfo` の mac 限定パターンに倣う。
- Windows: 既存 `windows` クレートの **feature 追加**のみ（新規クレートを増やさない）。
- 代替として単一クレート `systemicons` 等もあるが、リポジトリの「target 別・監査可能」方針に合わせ
  個別実装を推奨（実装時に比較して最終決定してよい）。

## このタスクでやらないこと

- アイコンのユーザー手動アップロード/差し替え
- リモート（Web）からのアイコン取得
- PNG をファイル出力して asset protocol / `convertFileSrc` で参照する方式
  （data URI 方式を採用し、`fs`/asset-protocol の scope 追加を避ける）
- 一覧表示時の都度再抽出（選択時に一度だけ抽出して保存）
- `.lnk` 実体解決や `.bat` 対応
- アイコンのテーマ連動・加工

## セキュリティ制約（docs/security.md 準拠）

- 新規 Tauri command は最小権限・限定的にする（§3）。汎用ファイル読取 command を作らない。
- ユーザーが**明示的に選択した**実行ファイルパスの**読み取り専用**アクセスに限定する（§4 / §5 / §7）。
  書き込み・削除・外部送信をしない。パスは Rust 側で検証する。
- 出力サイズを制限する（≤128px）。エラーは固定文言に丸め、フルパス等の詳細をログ/UI に出さない（§9）。
- CSP はリモート画像禁止のまま、`data:` inline のみ利用（§CSP）。外部通信を追加しない。
- Tauri capabilities / permissions に不要な強権限（`fs:default` / asset protocol scope 等）を追加しない。
- 新規クレート/feature の追加理由を progress.md に明記する（§10）。
- ファイル読取処理・新規依存の追加のため、実装後に security-review を必須とする。

## 完了条件

- ピッカーで `.app`（macOS）/ `.exe`（Windows）を選ぶと、その実アイコンがプレビューに表示される
- 抽出できない形式では従来の文字アイコンにフォールバックする（クラッシュしない）
- 抽出したアイコンが Tool に保存され、一覧・サイドバー・プレビューで表示される
- `tools.icon_png` が冪等な `ensure_column` で追加され、既存 DB でも `cargo` 起動後に落ちない
- `util.rs::ensure_column` が新設され、019 から参照できる形になっている
- ts-rs バインディングが再生成され、frontend の型と整合している
- 新規コマンドが読み取り専用・パス検証済み・出力サイズ制限付きである
- CSP を緩めていない / asset protocol / `fs` の強権限を追加していない / 外部通信を追加していない
- `pnpm --filter ./apps/desktop typecheck` / `lint`、`cargo check` が通る
- docs/progress.md が更新されている（追加依存の理由を含む）

## 確認コマンド

```bash
git diff --stat
git diff --name-only
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
cd apps/desktop/src-tauri && cargo check
pnpm --filter ./apps/desktop tauri dev
```

## 実装後に必要なレビュー

ファイル読取処理・新規 command・新規依存の追加のため、実装後に security-review を必須とする。最低限:

- `extract_app_icon` が読み取り専用で、任意パスの自由読取 command になっていないか
- パス検証・出力サイズ制限が効いているか
- CSP / capabilities を不要に緩めていないか（`data:` inline のみか）
- 外部通信を追加していないか / ログにフルパス等の機密を出していないか
- 追加した crate / feature が最小で、理由が説明されているか
