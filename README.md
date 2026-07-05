# stream-dock

配信者がPC上の複数ツールをプリセット単位で起動・停止するためのデスクトップアプリ。

## 技術構成

- Frontend: React + TypeScript (Vite)
- Desktop: Tauri 2
- Backend: Rust

## 必要要件

- Node.js 20 以上
- pnpm 10 以上
- Rust ツールチェイン (rustc / cargo)

## ディレクトリ構成

pnpm workspace のモノレポ構成。

- `apps/desktop/` … デスクトップアプリ全体
  - `apps/desktop/src/` … React + TypeScript フロントエンド
  - `apps/desktop/src-tauri/` … Rust / Tauri バックエンド
- root … workspace 管理用（`pnpm-workspace.yaml` / 管理用 `package.json`）

各コマンドは root から実行する（`--filter` で `apps/desktop` に委譲）。

## セットアップ

```sh
pnpm install
```

## 開発起動

```sh
pnpm tauri dev
```

初回は Rust 側のビルドに数分かかります。ビルド後にアプリのウィンドウが表示されます。

## 検証コマンド

```sh
pnpm typecheck   # tsc --noEmit
pnpm lint        # eslint
cd apps/desktop/src-tauri && cargo check
```
