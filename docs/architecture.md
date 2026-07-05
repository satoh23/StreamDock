# Architecture

## 方針

Tauri + React + TypeScript + Rust + SQLite のローカルデスクトップアプリとして実装する。

## レイヤー

- React UI
- Tauri invoke API wrapper
- Tauri Rust commands
- Service layer
- Repository layer
- SQLite

## 主要サービス

- ToolRegistryService
- PresetService
- LaunchOrchestrator
- ProcessService
- SettingsService
- LogService

## 重要な制約

- OS操作はRust側に寄せる
- frontendから直接shell実行しない
- 停止対象は原則としてstream-dock経由で起動したPIDのみ
- 一括起動は順番起動と並行起動を扱う
- 起動失敗時はUIにエラーを返す
