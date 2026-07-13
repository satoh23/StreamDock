# 030 "登録" Wording Unification

## 目的

プリセット/ツールの**新規作成**アクションの動詞が、画面によって「追加」だったり「登録」だったりバラつく。
これを既存の「ツールを登録」に揃え、**新規作成は「登録」に統一**する。位置を表す語（末尾/先頭に追加）や、
既存ツールをプリセットへ足す操作（＋ツールを追加）は意味が異なるため **"追加" のまま維持**する。
frontend の表示文言のみの変更で、ロジック/API/DB は変更しない。

## 現在の前提（調査結果）

- ヘッダー/サイドバー/各画面の文言は各コンポーネントに直書き。チュートリアル文言
  `apps/desktop/src/features/tutorial/tutorialSteps.ts` は**ボタン名を直書き引用**しているため同期修正が必須。
- 「新規作成」なのに「追加」表記の箇所（＝統一対象）:
  - `apps/desktop/src/components/Sidebar.tsx:113` — `＋ プリセットを追加`（＋ `:39` の説明コメント）。
  - `apps/desktop/src/screens/main/MainScreen.tsx:532` — 空状態文 `プリセットを追加して、…`。
  - `MainScreen.tsx:538` — `＋ プリセットを追加`。
  - `apps/desktop/src/screens/add-preset/AddPresetScreen.tsx:287` — 新規時ページタイトル `プリセットを追加`。
  - `apps/desktop/src/screens/add-tool/AddToolScreen.tsx:212` — 新規時見出し `ツールを追加`。
  - `AddToolScreen.tsx:416` — プレビュータイトル `ツール追加後プレビュー`。
  - `tutorialSteps.ts:103` — 引用 `『＋ プリセットを追加』`。
- 「追加」のまま維持する箇所（位置語・既存ツールのプリセットへの追加。改名しない）:
  - `MainScreen.tsx:629`（`＋ ツールを追加` = 既存ツールをプリセットへ足す）/ `:638-639` / `:657`（picker「追加」）/ `:668-669`。
  - `AddToolScreen.tsx:371`（`プリセットには追加しない`）/ `:382`（`追加位置`）/ `:389`（`末尾に追加`）/ `:390`（`先頭に追加`）/
    `:409`（`保存して追加` = プリセットへの追加を指す）。
  - `AddPresetScreen.tsx:357`（`「＋ ツールを追加」でツールを登録してください` の前半ボタン参照）。
  - `tutorialSteps.ts:94`（`『保存して追加』` = 上記ボタンの引用）。
- 既に「登録」で正しい箇所（変更不要）: `Sidebar.tsx:175` `＋ ツールを登録`、`tutorialSteps.ts:77-78`。

## このタスクでやること

### (1) 新規作成の動詞を「登録」に統一

- 上記「統一対象」の各文言を「追加」→「登録」に置換する:
  - `Sidebar.tsx:113`（＋ `:39` コメント）、`MainScreen.tsx:532` / `:538`、`AddPresetScreen.tsx:287`、
    `AddToolScreen.tsx:212` / `:416`。
- 「プリセットを追加」→「プリセットを登録」、「ツールを追加（新規見出し）」→「ツールを登録」、
  「ツール追加後プレビュー」→「ツール登録後プレビュー」。

### (2) チュートリアル文言の同期

- `tutorialSteps.ts:103` の引用 `『＋ プリセットを追加』` を `『＋ プリセットを登録』` に更新し、
  実ボタン名（(1) の変更後）と一致させる。

## このタスクでやらないこと

- ロジック・API・DB スキーマ・Rust 側エラーメッセージの変更（純粋な frontend 文言変更のみ）。
- 位置語（末尾/先頭に追加・追加位置・プリセットには追加しない）や、既存ツールをプリセットへ足す
  「＋ ツールを追加」「保存して追加」の改名。
- `docs/product.md` 等ドキュメントの「プリセットを作成」等の文言変更。

## セキュリティ制約（docs/security.md 準拠）

- frontend の表示文字列のみの変更。OS 操作・ファイル操作・プロセス操作を追加しない（§2 / §4 / §5）。
- 新しい Tauri command / capabilities / 依存を追加しない（§3 / §10）。
- 外部通信・外部リソース読み込みを増やさない（§1 / §CSP）。

## 完了条件

- 新規作成の導線（サイドバー/メイン空状態/プリセット登録画面/ツール登録画面/プレビュー）が「登録」に統一されている
- 位置語・既存ツールのプリセットへの追加は「追加」のまま維持されている
- チュートリアル引用が実ボタン名と一致している
- 新しいライブラリ / Tauri command / capabilities を追加していない
- `pnpm --filter ./apps/desktop typecheck` / `lint` が通る
- docs/progress.md が更新されている

## 確認コマンド

```bash
git diff --stat
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
pnpm --filter ./apps/desktop tauri dev   # サイドバー/各画面/チュートリアルのラベルを目視確認
```
