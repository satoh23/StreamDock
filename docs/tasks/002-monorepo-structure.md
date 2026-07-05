# 002 Monorepo Structure

## 目的

root 直下にフラット展開されていた Tauri/React アプリ一式を `apps/desktop/` 配下へ集約し、
pnpm workspace 構成のモノレポに整える。今後の機能追加の土台を作る。

## やったこと

- root 直下の Tauri/Vite アプリ一式を `apps/desktop/` へ `git mv` で移動（履歴保持）
- `pnpm-workspace.yaml` を新規作成（`packages: ["apps/*"]`）
- root の `package.json` を workspace 管理用に置き換え（name=stream-dock-workspace / private）
  - 各スクリプトは `pnpm --filter ./apps/desktop <script>` へ委譲
- `README.md` のディレクトリ構成・`cargo check` パスを apps/desktop 基準に更新
- 移動したファイルは相対パスのみで成立するため内容変更なし（アプリ名 stream-dock も維持）

## やらないこと

- `backend/` ディレクトリの作成（MVP では作らない方針）
- 機能実装（ツール登録 / プリセット / SQLite / プロセス起動）

## 完了条件

- `pnpm install` が通る（workspace projects: 2 を検出）
- `pnpm typecheck` / `pnpm lint` が通る
- `cargo check` が通る
- `pnpm build` が通る（apps/desktop/dist 生成、tauri の frontendDist と整合）
- `pnpm tauri dev` が root から起動する

## 結果

- 上記完了条件をすべて満たし、モノレポ構成へ移行完了
- 補足: git mv 時に旧 target/ も移動して初回 cargo check が旧パス参照で失敗 →
  `cargo clean` で解消。root node_modules を削除して再 pnpm install で貼り直し
- 次工程（App Shell 以降の機能実装）へ進める状態
