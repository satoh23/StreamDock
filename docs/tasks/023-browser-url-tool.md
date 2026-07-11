# 023 Browser URL Tool Support

## 目的

ツールとして PC アプリ（実行ファイル）だけでなく、**ブラウザで開く URL（サイト）**も登録・起動できる
ようにする（ユーザー要望 8）。例: ブラウザで動作する文字起こしサイト等をツールとして登録し、
プリセットから起動できるようにする。

本タスクは **登録＋起動の基盤まで**（URL を既定ブラウザで開く）。将来的な「起動したらブラウザ上ツールの
設定も自動反映」は **Out of scope（将来別タスクで設計）**。

> 補足: 本タスクは task-board の Todo（将来）。着手前に 020〜022 の完了と、下記「状態/停止の扱い」の
> 方針決定（MVP は「開くのみ」推奨）を行う。

## 現在の前提

- ツールモデル `src-tauri/src/tools/model.rs` は `executable_path` ベース。**`kind`/`type`/`url` は無い**。
  `Tool` / `CreateToolInput` / `UpdateToolInput` すべて実行ファイルパス前提。ts-rs で
  `src/features/tools/bindings/` に生成。
- `tools` テーブル（`tools/repository.rs`）は `executable_path TEXT NOT NULL` ＋
  `CREATE UNIQUE INDEX idx_tools_executable_path ON tools(executable_path)`。
  `icon_png` は `util::ensure_column` で後付け済（冪等 ADD COLUMN ガードの前例）。
- 起動は `process/service.rs::spawn` → `validate_executable`（124-173 行）で**絶対パス・存在必須**の
  厳格検証。URL（http/https）はここで確実に弾かれる。起動は shell 非経由
  （`Command::new(path)` / macOS は `/usr/bin/open <bundle>`）。
- 単体起動は `process/commands.rs::launch_tool`（frontend からは `toolId` のみ。DB の値を Rust 側で
  検証・起動。raw path/URL を frontend から受けない設計）。停止/生存監視/前面化は
  `process/registry.rs` の `Handle`（自 spawn の PID 前提）。
- `tauri-plugin-opener` は `Cargo.toml` / `lib.rs`（`.plugin(tauri_plugin_opener::init())`）で
  **導入・init 済みだが未使用**。capabilities は `opener:default`。

## このタスクでやること

### (1) モデル / スキーマ拡張

- `tools` に種別カラム `kind TEXT NOT NULL DEFAULT 'executable'`（値は `'executable' | 'url'`）と
  URL 種別用 `url TEXT` を **`util::ensure_column` で冪等追加**する（既存 DB でも落ちない）。
- `Tool` / `CreateToolInput` / `UpdateToolInput`（`tools/model.rs`）へ対応フィールドを追加し、
  ts-rs バインディングを再生成する。
- **`idx_tools_executable_path` の UNIQUE 制約を見直す**。url 種別は `executable_path` が空になり得るため、
  url 行同士で空文字が UNIQUE 衝突しないよう、`kind = 'executable'` の部分ユニークインデックス化
  もしくは制約設計を見直す（重複登録防止の意図は維持する）。

### (2) フォーム（frontend）

- `AddToolScreen.tsx` に種別トグル（アプリ / URL）を追加する。
  - アプリ種別: 従来どおりファイル選択（dialog `open()`）。
  - URL 種別: 実行ファイル選択の代わりに URL 入力欄を出す。**http/https のみ許可**のバリデーションを行う。
- types / api（`features/tools/`）を拡張し、`kind` / `url` を payload に含める。

### (3) 起動経路（Rust）

- `process/service.rs` に url 種別分岐を追加する。ローカル起動の代わりに、**導入済みの
  `tauri-plugin-opener`** で既定ブラウザに URL を開く。
- frontend からは従来どおり `toolId` のみ渡し、URL は **DB 保存値を Rust 側で検証**（http/https スキーム
  限定）してから opener に渡す。新規 spawn 経路・shell を増やさない。

### (4) 状態 / 停止の扱い（要方針決定）

- url 種別は PID 管理下に入らない。以下いずれかを本タスク着手時に決める:
  - **(推奨・MVP)** url ツールは「起動（＝開く）」のみ対応し、停止 / 生存監視 / 前面化を無効化する
    （UI 上も stop/status を出さない、または「開く」だけ表示）。
  - もしくは `registry.rs` の `Handle` enum に URL 用バリアントを足し、限定的に扱う。

### (5) capabilities

- opener の capabilities scope を**必要最小**に精査する（`opener:default` の許可範囲を確認し、
  http/https を開くのに必要な範囲に限定。広い許可を足さない）。

## このタスクでやらないこと（Out of scope・将来検討）

- **「起動後にブラウザ上ツールの設定を自動反映」**（ブラウザ拡張連携・プロファイル注入・自動操作）。
  別タスクで別途設計する。本タスクは URL を開くところまで。
- 埋め込みブラウザ（WebView）内でのサイト表示
- url ツールの停止 / タブ制御 / 複数ブラウザ選択 / ブラウザ指定起動
- 既存プリセット一括起動（008）での url ツールの高度な順序制御

## セキュリティ制約（docs/security.md 準拠・重点 §4 / §5 / §6 / §CSP）

- frontend から**任意の URL / コマンドを直接渡さない**。保存済み値を Rust 側で **http/https スキーム検証**
  してから opener に渡す。`javascript:` / `file:` / 独自スキーム等は拒否する。
- opener の capabilities scope を必要最小に絞る（広い許可を足さない）。
- 新規 spawn 面・shell 経由・任意コマンド組立・外部通信を増やさない（URL を開くのは OS 既定ブラウザに委譲）。
- DB / モデル / 起動経路 / capabilities の変更を伴うため、**実装後に security-review を必須**とする。

## 完了条件

- ツール追加/編集で種別（アプリ / URL）を選べ、URL 種別は http/https の URL を保存・再表示できる
- url ツールを起動すると既定ブラウザで URL が開く（frontend は `toolId` のみ渡し、Rust 側でスキーム検証）
- `tools.kind` / `tools.url` が冪等な `ensure_column` で追加され、既存 DB でも落ちない
- `executable_path` の UNIQUE 制約が url 種別で破綻しない（重複防止の意図は維持）
- ts-rs バインディングが再生成され frontend の型と整合している
- capabilities に広い許可を足していない（opener は必要最小 scope）
- url ツールの状態/停止の扱いが決定・実装されている（MVP は「開くのみ」）
- 「起動後の自動設定反映」は Out of scope として progress.md に明記されている
- `pnpm --filter ./apps/desktop typecheck` / `lint`、`cargo check` が通る
- docs/progress.md が更新されている

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

モデル/DB/起動経路/capabilities の変更を伴うため、実装後に security-review を必須とする。最低限:

- frontend から任意 URL/コマンドを渡せない設計になっているか（Rust 側で http/https 検証しているか）
- `javascript:` / `file:` 等の危険スキームを拒否しているか
- opener capabilities が必要最小 scope に限定されているか
- 新規 spawn 面・shell を足していないか / 外部通信を増やしていないか
- `ensure_column` が冪等で既存 DB を壊さないか
