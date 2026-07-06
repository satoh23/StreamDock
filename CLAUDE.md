# stream-dock 開発ルール

## プロダクト概要

stream-dock は、配信者がPC上の複数ツールをプリセット単位で起動・停止するためのTauriデスクトップアプリです。

## 技術構成

- Frontend: React + TypeScript
- Desktop: Tauri
- Backend: Rust
- DB: SQLite
- Package manager: pnpm

## 重要ルール

- 実装前に必ず変更計画と対象ファイルを提示する
- こちらが「実装して」と言うまでコード変更しない
- 1回の作業で複数機能をまとめて実装しない
- 仕様にない大規模リファクタリングをしない
- 新しいライブラリを追加する場合は理由を説明する
- OS操作、プロセス起動、停止、ファイル操作はRust側に寄せる
- frontendから直接shell実行する設計にしない
- npm / yarn は使わず pnpm を使う
- セキュリティ方針は docs/security.md を正とし、OS操作・ファイル操作・プロセス操作を変更する場合は必ず参照する

## 検証コマンド

- pnpm typecheck
- pnpm lint
- cargo check
- pnpm tauri dev
