# 060b カスタム CSS 取り込み基盤（Rust・保存/検証/レジストリ）

> 状態: **未着手（実装サブタスク）**。分割・線引きは親 [060](060-overlay-custom-css.md) を正とする。
>
> **必読前提**: 親 [060](060-overlay-custom-css.md)、セレクタ契約 [060a](060a-overlay-selector-contract.md)（変換表の正）、
> **取り込み方式の先行設計 [039](039-font-import.md) / [039a](039a-font-import-rust-storage.md)（本タスクはこれをなぞる）**、
> Rust モジュールの層構造 [`viewer_memory/`](../../apps/desktop/src-tauri/src/viewer_memory/)（`commands`/`service`/`repository`/`model`）、
> 冪等な列追加 [`util.rs`](../../apps/desktop/src-tauri/src/util.rs)（`ensure_column`）、
> ファイル選択の既存例 [`AddToolScreen.tsx`](../../apps/desktop/src/screens/add-tool/AddToolScreen.tsx)（`@tauri-apps/plugin-dialog` の `open`）、
> capability [`comment-viewer.json`](../../apps/desktop/src-tauri/capabilities/comment-viewer.json)、
> [`docs/security.md`](../security.md)（**§3 最小権限／§5 ファイル操作／§8 入力検証／## CSP方針／Capabilities 方針／§10／レビュー必須条件**）。
> CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。
> **security-review 必須**（新規ファイル書き込み経路・capability 追加・ユーザー提供コンテンツの取り込み）。
>
> ⚠ **行番号は書かない**（特定はシンボル名で行うこと）。

## 目的

ユーザーが用意した CSS ファイルを**アプリの管理領域へ安全に取り込み**、名前を付けて保存し、
オーバーレイへ供給できるようにする Rust 側の基盤を作る。

**外部 URL は本タスクの時点では取り込まず除去する。** 外部 `@import` の取得は
[060c](060c-external-css-snapshot.md) の増分（＝本タスク単体でも機能として完成する）。

## 現在の前提（調査結果・実コード）

- **ユーザーファイルをアプリ内へコピーする Rust 経路は存在しない。** `fs` plugin も asset protocol も未導入。
  Rust の `std::fs` 使用は `obs_config.rs`（read-only）・`lib.rs` の `create_dir_all(app_data_dir)`・
  `tools/icon.rs`（.icns 読取）・`process/service.rs`（canonicalize）の**5 か所だけ**で、
  **ファイル書き込みコマンドは 1 本も無い**。
- ファイル選択は frontend の `@tauri-apps/plugin-dialog` の `open()` で**パス文字列を得るだけ**。
- ⚠ **`dialog:allow-open` は main 窓（`default.json`）にしかない。**
  `comment-viewer.json` は `core:default` のみ＝**capability の追加が要る**。
- DB は `app_data_dir/stream-dock.db`。**マイグレーション基盤は無い**。
  各モジュールの `repository::init(&conn)` を起動時に順に呼ぶ（すべて `CREATE TABLE IF NOT EXISTS`）。
  列追加は [`util.rs`](../../apps/desktop/src-tauri/src/util.rs) の `ensure_column`（冪等）。`PRAGMA user_version` は未使用。
- Rust モジュールは `commands.rs`（薄い）/ `service.rs`（検証・整形）/ `repository.rs`（SQL）/ `model.rs` の層構造。
  TS binding は ts-rs で自動生成（`pnpm gen:bindings` → CI が `pnpm check:bindings` で差分検出）。
- [039a](039a-font-import-rust-storage.md) が「app_data_dir へコピー＋検証＋SQLite レジストリ＋
  データを返すコマンド」という**同型の設計**を持っている（保留中だが設計は完成済み）。
- ⚠ **アプリ定義コマンドは ACL の対象外**（[`docs/security.md`](../security.md) の 046b 節）。
  ここで足すコマンドは**全 4 窓から呼べる**。capability では絞れないので**コマンド自体を狭く作る**。

## このタスクでやること

### (1) `overlay_themes` テーブルとモジュール新設

- `src-tauri/src/overlay_theme/` を新設（`commands.rs` / `service.rs` / `repository.rs` / `model.rs` の 4 分割）。
- テーブル（`CREATE TABLE IF NOT EXISTS`・既存作法どおり）:

```sql
CREATE TABLE IF NOT EXISTS overlay_themes (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,          -- ユーザーが付ける名前（要望「名前をつけて」）
    file_name   TEXT NOT NULL,          -- app_data_dir/themes/ 配下の実ファイル名（id 由来・元パスは保存しない）
    origin      TEXT NOT NULL,          -- 'local'（060c で 'snapshot' を追加）
    stripped_count INTEGER NOT NULL DEFAULT 0,  -- 取り込み時に除去した外部参照の件数（UI 表示用）
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);
```

⚠ **セレクタ変換の結果（変換できた/できなかったルール数）はここに持たない。**
変換は**注入時**に frontend が行う（下記 (3)-6）ので、DB に持つと**保存時の値と実際に適用される値がずれる**
（変換表を更新した瞬間に DB の数字が古くなる）。表示は [060d](060d-css-theme-management-ui.md) が
その場で計算する。

- ⚠ **`name` に UNIQUE を張るかを決める**。張ると同名インポートが失敗し、張らないと一覧で見分けられない。
  推奨＝**張らない**（`presets.name` は UNIQUE だが、テーマは「試しに 2 つ入れて見比べる」使い方があるため）。
  代わりに UI で重複を警告する。**この判断はコメントに残す。**
- ⚠ **元ファイルのフルパスを保存しない**（§9）。取り込み後は StreamDock の管理下のコピーだけが正。
- `lib.rs` の `setup` に `overlay_theme::repository::init(&conn)` を既存の並びへ追加。

### (2) コマンド（**単一目的・狭く**）

| コマンド | 引数 | 戻り | 備考 |
|---|---|---|---|
| `import_overlay_theme` | `path: String, name: String` | `OverlayThemeRecord` | ⚠ 汎用の `write_file(path, content)` にしない（§3） |
| `list_overlay_themes` | — | `Vec<OverlayThemeRecord>` | read-only |
| `get_overlay_theme_css` | `id: String` | `String` | **CSS 本文を文字列で返す**（039 の `get_font_data` と同型・asset protocol も CSP も触らない） |
| `rename_overlay_theme` | `id: String, name: String` | `OverlayThemeRecord` | |
| `delete_overlay_theme` | `id: String` | `()` | ファイル実体も消す |

- ⚠ **`path` は frontend から来る生パス**なので、Rust 側で必ず検証する（§8・「frontend でバリデーション
  していても Rust 側でも必ず検証する」）。
- ⚠ **`get_overlay_theme_css` は全 4 窓から呼べる**（ACL 対象外）。read-only で、返すのは
  **ユーザー自身が入れた CSS** なので許容するが、**この事実を security.md に記録する**。

### (3) 検証（`service.rs`・§5/§8）

取り込み時に**この順で**行う。1 つでも落ちたら取り込まない（fail-closed）。

1. **拡張子許可リスト**: `.css` のみ。
2. **サイズ上限**: 例 **256KB**（実値は実装時に決めて定数化＋コメントで理由を残す）。
   ⚠ 上限が無いと巨大ファイルで webview が固まる（055c の `clampNotes` と同じ発想）。
3. **UTF-8 として読めること**。読めないものは拒否（バイナリを CSS として保存させない）。
4. **制御文字の拒否**（`\0` 等）。
5. **`name` の検証**: 空でない・長さ上限・制御文字なし・前後空白のトリム。
6. **セレクタ変換はここでは行わない。** ⚠ 変換表は TypeScript 側（[`cssCompat.ts`](060a-overlay-selector-contract.md)）にあり、
   Rust で再実装すると**2 実装に分裂して片方だけ古くなる**。かといって「取り込み時に frontend で変換してから
   Rust へ渡す」形にすると、**変換表を更新しても取り込み済みテーマには反映されない**（入れ直しが要る）。
   → **保存するのは変換前の CSS**とし、**変換は注入時に frontend が毎回行う**（[060d](060d-css-theme-management-ui.md)）。
   これで変換表の更新が既存テーマにも自動で効く。
   ⚠ **§8「frontend の検証を信用しない」**は変わらず適用される＝**安全性に関わる検証（1〜5 と 7）は必ず Rust で行う**。
   変換は安全性ではなく利便性の処理なので、frontend 側にあってよい。
7. **外部 URL の除去** ← **本タスクの最重要処理**
   - `@import url("http…")` / `@import "http…"` を**除去**する。
   - `url(http…)` / `url("//…")` / `image-set(…)` の外部参照を**除去**する。
   - `data:` URI は**許可する**（036 系のアイコンと同じ扱い・外部通信を起こさない）。
   - ⚠ **除去した件数を戻り値に含める**（UI が「外部参照を N 件除去しました」と出せるように）。
     黙って消すと「なぜデザインが違うのか」がユーザーに分からない。
   - ⚠ **完全な CSS パースはしない**（依存を増やさない）。正規表現ベースの除去で始める。
     **ただし「取りこぼしても外部通信が起きない」保証にはならない**ので、
     **除去漏れがあった場合の被害**（＝オーバーレイ窓から外部 GET が飛ぶ）を security-review で必ず評価すること。
     ⚠ 迂回の可能性（`\75 rl(` のような CSS エスケープ・コメント挿入 `u/**/rl(`・大文字小文字）を
     テストで具体的に潰す。
8. **`app_data_dir/themes/<id>.css` へ書き込む**。ファイル名は**アプリが採番した id 由来**にし、
   ユーザー入力（元ファイル名・`name`）を**ファイル名に使わない**（パストラバーサルの経路を作らない）。
9. **管理ディレクトリ外へ書かない**ことを実装で保証する（パス組み立ては `app_data_dir` から固定で行い、
   ユーザー入力を結合しない）。

### (4) capability の追加

- `capabilities/comment-viewer.json` に **`dialog:allow-open` を 1 件だけ**追加する（最小権限・§3）。
- ⚠ **これ以外は増やさない**（`dialog:allow-save` も `fs:*` も足さない）。
- ⚠ **capability の変更＝レビュー必須条件**。security.md の「Capabilities 方針」に追記する。

### (5) security.md の更新

| 節 | 追記内容 |
|---|---|
| §5 ファイル操作 | 例外節を新設（`app_data_dir/themes/` への取り込み書き込み。039 と同型・**§5 で例外を設けるのは 055d に続き 2 回目**） |
| Capabilities 方針 | `comment-viewer.json` への `dialog:allow-open` 追加とその理由 |
| ## CSP方針 | **ユーザー CSS を注入しても「外部 style を読み込まない」が保たれる根拠**（取り込み時に外部 URL を除去する・`data:` のみ許可・`csp: null` は不変） |
| §10 依存 | 新規依存ゼロを記録（CSS パーサを足した場合はその理由） |

### (6) テスト

- `service.rs` / `repository.rs` の `#[cfg(test)] mod`（既存の `viewer_memory` と同型）:
  - 拡張子・サイズ上限・非 UTF-8・制御文字・空 `name` が**すべて拒否される**こと
  - 外部 URL 除去: `@import url("https://…")` / `url(http…)` / `url(//…)` / `image-set` が消えること
  - **`data:` URI が残ること**（消しすぎない担保）
  - ⚠ **迂回パターン**（CSS エスケープ・コメント挿入・大文字小文字・空白）が塞がれていること
  - ファイル名に**ユーザー入力が混ざらない**こと（`name` に `../` を入れても管理ディレクトリ外へ出ない）
  - `delete_overlay_theme` がファイル実体も消すこと
- `command_contract` 型のテスト（`app_update/commands.rs` の先例）で、
  **汎用書き込みコマンドが生えていない**ことを機械的に固定してもよい。
- **ミューテーションで実効性を確認**する。最低限、外部 URL 除去を無効化したときにレッドになること。

## このタスクでやらないこと

- **外部 `@import` の取得**（[060c](060c-external-css-snapshot.md)）。本タスクは**除去する**だけ。
- **セレクタ変換**（[060a](060a-overlay-selector-contract.md) が表を持ち、[060d](060d-css-theme-management-ui.md) が
  注入時に適用する）。**本タスクは変換に一切関与しない**（保存するのは変換前の CSS）。
- **CSS の注入・テーマ切替 UI・プレビュー**（[060d](060d-css-theme-management-ui.md)）。
- 汎用のファイル読み書きコマンド（§3 で明示的に禁止されている `write_file(path, content)` 型）。
- `fs` plugin / asset protocol の導入。**CSS は文字列で返す**（039 の data URI 方式と同じ発想）。
- CSS の構文チェック（壊れた CSS を入れても、ブラウザが無視するだけで実害がない）。
- コメビュ本体への適用。

## セキュリティ制約（docs/security.md 準拠）

- **外部通信ゼロ**（§1）。本タスクは**外部 URL を除去する側**。取得は 060c。
- **ファイル操作は Rust 側・`app_data_dir/themes/` 限定**（§5）。管理ディレクトリ外へ書き込まない。
  **ファイル名にユーザー入力を使わない**（id 由来で採番）。
- **入力検証は Rust 側で必ず行う**（§8）。frontend の生パス・生 CSS を信用しない。
  変換（利便性の処理）だけ frontend に委ねてよいが、**検証は委ねない**。
- **コマンドは単一目的・最小権限**（§3）。汎用の読み書きコマンドを作らない。
  ⚠ **足したコマンドは全 4 窓から呼べる**（ACL 対象外）ことを前提に設計し、その事実を security.md に記録する。
- **capability は `dialog:allow-open` 1 件のみ**。
- **`csp: null` 不変**・`tauri.conf.json` 差分ゼロ。
- ログに CSS 本文・元ファイルのフルパスを出さない（§9・`with_filename_detail` 流儀）。
- **新規依存ゼロを目指す**。CSS パーサを入れる場合は §10 に理由を記録し `cargo audit` を通す。

## 完了条件

- `overlay_theme` モジュール（4 分割）と `overlay_themes` テーブルが存在し、5 コマンドが動く。
- ローカルの `.css` を取り込むと `app_data_dir/themes/<id>.css` に保存され、一覧に出る。
- **外部 URL（`@import` / `url()` / `image-set`）が除去され、除去件数が戻り値に載る**。`data:` は残る。
- **迂回パターン（CSS エスケープ・コメント挿入・大文字小文字）がテストで塞がれている。**
- ファイル名にユーザー入力が混ざらず、管理ディレクトリ外へ出られない。
- `capabilities/comment-viewer.json` に **`dialog:allow-open` が 1 件だけ**追加され、それ以外の capability は差分ゼロ。
- [`docs/security.md`](../security.md) に (5) の 4 項目が追記されている。
- ts-rs binding が生成され `pnpm check:bindings` が通る。
- Rust テストが通り、**ミューテーションで実効性を確認**している。
- `tauri.conf.json` 差分ゼロ・`csp: null` 不変・新規依存ゼロ（または §10 に記録済み）。
- `pnpm --filter ./apps/desktop typecheck` / `lint` / `test` / `cargo check` が通る。[`docs/progress.md`](../progress.md) を更新。

## 確認コマンド

```bash
git diff --stat
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
pnpm --filter ./apps/desktop test
pnpm --filter ./apps/desktop check:bindings
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml

# capability は 1 件だけ増える（comment-viewer.json のみ・dialog:allow-open のみ）
git diff -- apps/desktop/src-tauri/capabilities/
# tauri.conf.json は差分ゼロが期待（csp: null 不変）
git status --short -- apps/desktop/src-tauri/tauri.conf.json .github/
# 新規依存ゼロの担保（差分ゼロが期待）
git status --short -- apps/desktop/package.json pnpm-lock.yaml package.json apps/desktop/src-tauri/Cargo.toml apps/desktop/src-tauri/Cargo.lock

pnpm --filter ./apps/desktop tauri dev
# ① 依頼者の実サンプル CSS（外部 @import を含む）を取り込む → 保存され「外部参照を N 件除去」が返る
# ② app_data_dir/themes/ に <id>.css だけが増える（元ファイル名は使われていない）
# ③ 名前に "../evil" を入れても管理ディレクトリ外にファイルが出ない
# ④ 削除するとファイル実体も消える
# ⑤ lsof -i で **外部 ESTABLISHED が増えないこと**（本タスクは取得しない）
```

## 実装後に必要なレビュー

- **security-review 必須**（[`security-review`](../../.claude/skills/security-review/SKILL.md)）。対象:
  - §5 ファイル書き込み経路の新設（管理ディレクトリ限定・パス組み立て）
  - §8 入力検証（Rust 側での検証・frontend を信用しない）
  - §3 コマンドの最小権限（全 4 窓から呼べる前提）
  - **Capabilities の変更**（`dialog:allow-open`）
  - **外部 URL 除去の網羅性**（正規表現ベースの限界と、除去漏れ時の被害）
- ⚠ レビュー時は**除去漏れを狙った独自のミューテーション**を必ず作ること
  （055e の教訓：「自分のガードの主張を裏返す変異だけでは、ガードが見ていない領域の穴は見つからない」）。
