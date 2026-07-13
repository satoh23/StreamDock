# 029 StreamDock Naming Consistency

## 目的

正式名称は **StreamDock** だが、ユーザー可視の箇所に Vite 既定の雑多なタイトルや `stream-dock`
表記が残っている。ユーザーの目に触れる表示名を **StreamDock** に統一する。**技術識別子
（パッケージ名・バンドル ID・crate 名・DB ファイル名・localStorage キー）は変更しない**
（既存ユーザーのデータ/設定を壊さないため）。frontend 文言と window タイトルのみの変更で、
OS/ファイル/プロセス操作・外部通信・新規依存は増やさない。

## 現在の前提（調査結果）

- ユーザー可視で表記が正しくない箇所:
  - `apps/desktop/index.html:7` — `<title>Tauri + React + Typescript</title>`（Vite 雛形のまま。ブラウザ/ウィンドウのタブ相当）。
  - `apps/desktop/src-tauri/tauri.conf.json:15` — ネイティブ window `"title": "stream-dock"`。
  - `apps/desktop/src/screens/diagnostics/DiagnosticsScreen.tsx:29` — 診断サマリー本文 `"stream-dock 診断サマリー"`。
- 既に「StreamDock」で正しく、変更不要な箇所:
  - `apps/desktop/src/components/Header.tsx:43` — wordmark `StreamDock`。
  - `apps/desktop/src/features/tutorial/tutorialSteps.ts:46` — `"StreamDock へようこそ！"`。
- 技術識別子（**変更すると壊れる/据え置く**）:
  - `apps/desktop/src-tauri/tauri.conf.json:3` `productName: "stream-dock"`（バンドル成果物名・OS アプリ表示名に波及）。
  - `package.json`（root `stream-dock-workspace` / desktop `stream-dock`）、`tauri.conf.json:5` `identifier: com.tetsuya.stream-dock`、
    `src-tauri/Cargo.toml` の `name = "stream-dock"` / `stream_dock_lib`、`src-tauri/src/main.rs:5` `stream_dock_lib::run()`。
  - `src-tauri/src/lib.rs:39` DB ファイル名 `stream-dock.db`、localStorage キー `stream-dock.theme`
    （`features/theme/theme.ts:5`）/ `stream-dock.tutorial.completed`（`features/tutorial/tutorialStorage.ts:8`）。

## このタスクでやること

### (1) ユーザー可視の表示名を StreamDock に統一

- `apps/desktop/index.html:7` の `<title>` を `StreamDock` にする。
- `apps/desktop/src-tauri/tauri.conf.json:15` の window `title` を `StreamDock` にする。
- `apps/desktop/src/screens/diagnostics/DiagnosticsScreen.tsx:29` の `"stream-dock 診断サマリー"` を
  `"StreamDock 診断サマリー"` にする。

## このタスクでやらないこと

- `tauri.conf.json:3` `productName` の変更。バンドル成果物名/インストール名/OS アプリ名に波及し、
  **098 Windows Build・099 配布パッケージへ影響**するため、MVP では据え置く。将来 098/099 と併せて再検討する。
- パッケージ名・バンドル `identifier`・crate 名・`stream_dock_lib`・DB ファイル名・localStorage キーの改名
  （既存データ/設定の互換性が壊れる）。
- `docs/prototypes/*.html` 等の使い捨てプロトタイプ、Rust/JSDoc コメント内のプロジェクト名参照の一括置換。
- ロジック・API・DB スキーマの変更。

## セキュリティ制約（docs/security.md 準拠）

- 表示文字列と window タイトルのみの変更。OS 操作・ファイル操作・プロセス操作を追加しない（§2 / §4 / §5）。
- 新しい Tauri command / capabilities / 依存を追加しない（§3 / §10）。
- 外部通信・外部リソース読み込みを増やさない（§1 / §CSP）。
- ユーザー入力を扱わない固定文字列の変更のみ（§8 非該当）。

## 完了条件

- ウィンドウタイトル・診断サマリーの表示が `StreamDock` になっている
- 技術識別子（パッケージ名・identifier・crate 名・DB ファイル名・localStorage キー・`productName`）は変更されていない
- 新しいライブラリ / Tauri command / capabilities を追加していない
- `pnpm --filter ./apps/desktop typecheck` / `lint` が通る
- docs/progress.md が更新されている

## 確認コマンド

```bash
git diff --stat
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
pnpm --filter ./apps/desktop tauri dev   # ウィンドウタイトル / 診断画面の表示を目視確認
```
