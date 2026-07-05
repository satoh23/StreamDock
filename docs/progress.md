# Progress

## 2026-07-05

### 完了

- Cursor課金
- Claude Max課金
- CursorとClaude連携
- プロダクト開発用ディレクトリ作成
- git初期化
- GitHub連携

### 次にやること

- AI用ルールファイル作成
- docs作成
- Tauri + React + TypeScript の雛形作成
- 最初のタスク作成

## 2026-07-05 (001 Project Setup)

### 完了したこと

- Tauri 2 + React + TypeScript (Vite) の雛形を pnpm で作成
- アプリ名を stream-dock に統一 (package.json / tauri.conf.json / Cargo.toml)
- ESLint (flat config) を導入し `pnpm lint` / `pnpm typecheck` スクリプトを追加
- README に必要要件・起動方法・検証コマンドを記載

### 変更した主要ファイル

- `package.json` — name=stream-dock、scripts に typecheck/lint 追加、ESLint 系 devDependencies 追加
- `eslint.config.js` — 新規。flat config (typescript-eslint + react-hooks + react-refresh)
- `src-tauri/tauri.conf.json` — productName / window title = stream-dock、identifier = com.tetsuya.stream-dock
- `src-tauri/Cargo.toml` — package name = stream-dock
- `README.md` — 要件・起動方法・検証コマンドを記載
- `docs/progress.md` — 本記録
- その他スキャフォールド生成物一式 (index.html / vite.config.ts / tsconfig*.json / src/ / src-tauri/)

### 現在のディレクトリ構成 (root 直下にフラット展開)

```
stream-dock/
├── package.json            # フロントエンド (root に存在)
├── pnpm-lock.yaml
├── eslint.config.js
├── index.html
├── vite.config.ts
├── tsconfig.json / tsconfig.node.json
├── public/                 # vite.svg / tauri.svg
├── src/                    # React (App.tsx / main.tsx / assets)
├── src-tauri/              # Rust / Tauri (Cargo.toml / src / capabilities / icons / gen)
├── README.md
├── CLAUDE.md
└── docs/                   # product / architecture / decisions / progress / task-board / tasks
```

### 検証結果

- `pnpm install` 成功
- `pnpm typecheck` 成功 (exit 0)
- `pnpm lint` 成功 (exit 0)
- `cargo check` 成功 (stream-dock v0.1.0 コンパイル完了)
- `pnpm tauri dev` 起動確認 (初期画面表示、確認後にプロセス停止)

### 未完了事項 (今回スコープ外)

- SQLite導入 / ツール登録 / プリセット / プロセス起動 / UI作り込み
- git commit は未実施 (生成物一式は未追跡のまま)
- 現状は root 直下にアプリ一式が展開されており、モノレポ構成になっていない

### 次にやるべきこと

- **【次回タスク】root 直下に作成された Tauri/Vite アプリ一式を `apps/desktop` 配下へ移動し、pnpm workspace 構成に直す**
  - `pnpm-workspace.yaml` を追加し `apps/*` を対象にする
  - root には workspace 管理用の package.json を置き、アプリ本体は `apps/desktop/` に集約
  - 移動対象: package.json / vite.config.ts / tsconfig / index.html / src / src-tauri / public / eslint.config.js 等
  - 移動後に `pnpm install` / `pnpm tauri dev` / typecheck / lint が通ることを再確認
- 上記モノレポ化が済んでから、ツール登録・プリセット・SQLite 等の機能実装タスクへ進む

## 2026-07-05 (モノレポ化: apps/desktop への集約)

### 完了したこと

- root 直下にフラット展開されていた Tauri/Vite アプリ一式を `apps/desktop/` 配下へ `git mv` で移動（履歴保持）
- root を pnpm workspace の管理用に切り替え
- 移動後に Tauri/Vite が root から起動できる状態を維持

### 移動したファイル (root → apps/desktop/)

- `package.json` / `vite.config.ts` / `tsconfig.json` / `tsconfig.node.json` / `index.html` / `eslint.config.js`
- `src/` / `src-tauri/` / `public/`
- いずれも設定は相対パスのみで成立するため **内容変更なし**（アプリ名 `stream-dock` も維持）

### 新規作成 / 変更したファイル

- `pnpm-workspace.yaml` — 新規。`packages: ["apps/*"]`
- `package.json` (root) — 新規。workspace 管理用（name=stream-dock-workspace / private）。各スクリプトは `pnpm --filter ./apps/desktop <script>` へ委譲
- `README.md` — ディレクトリ構成の追記、`cargo check` のパスを `apps/desktop/src-tauri` に修正
- `docs/progress.md` — 本記録

### 現在のディレクトリ構成 (モノレポ)

```
stream-dock/
├── package.json            # workspace 管理用
├── pnpm-workspace.yaml     # apps/* を対象
├── pnpm-lock.yaml
├── apps/
│   └── desktop/            # デスクトップアプリ全体
│       ├── package.json    # アプリ (name=stream-dock)
│       ├── vite.config.ts / tsconfig*.json / index.html / eslint.config.js
│       ├── src/            # React (App.tsx / main.tsx / assets)
│       ├── src-tauri/      # Rust / Tauri
│       └── public/
├── README.md
├── CLAUDE.md
└── docs/
```
※ `backend/` ディレクトリは MVP では作らない方針。

### 検証結果

- `pnpm install` 成功（workspace projects: 2 を検出しリンク）
- `pnpm typecheck` 成功 (exit 0)
- `pnpm lint` 成功 (exit 0)
- `cargo check` 成功（旧パスの stale キャッシュを `cargo clean` してから成功。stream-dock v0.1.0 コンパイル完了）
- `pnpm build` 成功（`apps/desktop/dist` を生成。tauri の `frontendDist: "../dist"` と整合）
- `pnpm tauri dev` 起動確認（root から実行。Rust ビルド完了 → `Running target/debug/stream-dock` を確認）

### 補足 (実装メモ)

- `git mv src-tauri` でディレクトリごと移動した際、未追跡の `target/`（旧絶対パスを含む Rust ビルド生成物）も一緒に移動し、初回 `cargo check` が旧パス参照で失敗した。`cargo clean` で解消。
- pnpm workspace 化に伴い root `node_modules` を削除して再 `pnpm install`（シンボリックリンク構成で貼り直し）。

### 次にやるべきこと

- モノレポ化が完了したため、ツール登録・プリセット・SQLite 等の機能実装タスクへ進む
