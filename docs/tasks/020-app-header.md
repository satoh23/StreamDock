# 020 App Header (Docker-like)

## 目的

Docker Desktop 風の共通ヘッダーを全画面に常設する（ユーザー要望 1）。
左側にアプリアイコン＋「StreamDock」ワードマーク、右側に設定画面・診断画面へ遷移するアイコンを置く。
今後、プリセット/ツール管理**以外**の追加機能はヘッダーから遷移する想定で、その土台とする。

## 現在の前提

- 画面遷移は React Router を使わず `App.tsx` の `useState<Screen>("main")` による状態切替
  （`Screen = "main" | "add-tool" | "add-preset" | "diagnostics" | "settings"`、`types.ts`）。
- 最上位レイアウトは `components/Window.tsx`。`Window.module.css` は
  `grid-template-columns: 300px 1fr`（sidebar + main）の 2 カラムのみで、**ヘッダー行は存在しない**。
  サイドバーは `App.tsx:231` で `screen === "main"` のときだけ渡される（他画面は `.fullWidth`）。
- 設定/診断への遷移は**現在サイドバー下部の ghost ボタンのみ**（`Sidebar.tsx:180-193` の
  「🩺 診断 / ログ」「⚙ 設定」）。`onNavigate(screen)` を呼ぶ。`Sidebar` は `activeNav` prop で
  ghost の active 表示に対応済み（ただし `App.tsx` は現状 `activeNav` を渡していない）。
- 各画面は独自の見出し領域（`MainScreen` の `.top`、各フォームの `layout.pageTitle` 等）を持つ。
- 共有 UI atom は `components/primitives.tsx`（`IconTile` 等）。スタイルは CSS Modules ＋
  グローバル `styles/theme.css`（role トークン）。

## このタスクでやること

- **ヘッダーコンポーネント新設**: `components/Header.tsx` ＋ `components/Header.module.css`。
  - props: `activeNav?: Extract<Screen, "diagnostics" | "settings">`、`onNavigate: (s: Screen) => void`。
  - 左: アプリアイコン（当面は既存 `IconTile` 風の角丸グリフ、または `public/` のアプリアイコン）＋
    「StreamDock」ワードマーク。
  - 右: 「診断 / ログ」「設定」のアイコンボタン（現行の 🩺 / ⚙ を流用）。`activeNav` で active 表示。
- **Window をヘッダー付きに再構成**: `Window.tsx` を縦方向（ヘッダー行 ＋ 本体行）にし、本体側で
  既存の `sidebar | main` 2 カラムを保持する。`Window.module.css` を `grid-template-rows`
  もしくは外側 flex ラップで再構成。ヘッダーは **sidebar の有無に関わらず全画面で常時表示**。
- **App 配線**: `App.tsx` から `Header` を `Window`（またはその上位ラッパ）へ渡し、
  `onNavigate={handleNavigate}` と現在 `screen` から導出した `activeNav` を渡す。
- **サイドバーからの移設**: `Sidebar.tsx:180-193` の診断/設定 ghost ボタンセクションを**削除**し、
  ヘッダーへ一本化する。それに伴い未使用になる props / スタイルを整理する。
- ヘッダーはアプリ名バーに徹し、各画面の見出しは残す（二重見出しにしない）。

## このタスクでやらないこと

- ウィンドウのネイティブ枠のカスタム化（カスタムタイトルバー・ドラッグ領域・信号機ボタン移動）
- ヘッダーから遷移する**新規機能画面そのもの**の追加（土台のみ）
- プリセット/ツール管理の導線変更（サイドバーの ＋追加・一覧はそのまま）
- 配色・ボタンのモダン化（021 で扱う）／フォーム文言・項目の変更（022 で扱う）

## セキュリティ制約（docs/security.md 準拠）

- frontend のみの変更。OS 操作・ファイル操作・プロセス操作を追加しない。
- 外部リソース（外部フォント・CSS・CDN・リモート画像）を読み込まない（§CSP）。アイコンは
  同梱アセット or インライン SVG / 絵文字に限る。
- 外部通信・telemetry を増やさない。

## 完了条件

- 全画面（main / add-tool / add-preset / diagnostics / settings）でヘッダーが常時表示される
- ヘッダー左にアプリアイコン＋「StreamDock」、右に設定/診断アイコンがある
- ヘッダー右のアイコンから設定画面・診断画面へ遷移でき、現在画面が active 表示される
- サイドバー下部の診断/設定 ghost ボタンが削除され、遷移がヘッダーへ一本化されている
- 各画面の見出しと二重にならず、レイアウトが破綻していない（sidebar 有/無の両方）
- 新しいライブラリを追加していない / 外部リソースを読み込んでいない
- `pnpm --filter ./apps/desktop typecheck` / `lint` が通る
- docs/progress.md が更新されている

## 確認コマンド

```bash
git diff --stat
git diff --name-only
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
pnpm --filter ./apps/desktop tauri dev
```
