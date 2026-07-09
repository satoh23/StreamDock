# 015 Design Tokens & Color Unification

## 目的

配色を役割ベースのデザイントークン（CSS 変数）に集約し、「配色がダサい・見にくい」「ボタン等の色が
不統一」（ユーザー要望 1・2）を解消する。

015 では**ダーク単色のまま**配色そのものを洗練させ、色のハードコードをトークンに寄せる。
ライト/ダーク切替・OS 検知・設定画面は **016 Light/Dark Theme + Settings** で扱う。015 はその土台。

## 現在の前提

- frontend は React + TypeScript + Vite、スタイルは **CSS Modules（`*.module.css`）+ グローバル
  `src/styles/theme.css`**（`main.tsx` で読込）。
- `theme.css` には少数の CSS 変数（`--bg` `--text` `--muted` `--line` `--accent` `--accent-2`
  `--ok` `--warn` `--danger` `--radius`）のみ定義されている。ダーク単色。
- 一方、**9 個の `*.module.css` に約 192 箇所のハードコード hex/rgba が散在**している。
  特に多いのは:
  - `src/screens/main/MainScreen.module.css`
  - `src/screens/add-preset/AddPresetScreen.module.css`
  - `src/components/primitives.module.css`
  - `src/components/Sidebar.module.css`
  - `src/screens/add-tool/AddToolScreen.module.css`
  - `src/screens/diagnostics/DiagnosticsScreen.module.css`
  - `src/screens/formLayout.module.css`
  - `src/components/PreviewCard.module.css`
  - `src/components/Window.module.css`
- プライマリボタンのグラデーション（`linear-gradient(135deg, #19d3ee, #8b5cf6)`）や、`.primary.stopAll`
  の別配色など、ボタンの見た目が個別に定義され統一が取れていない（`primitives.module.css`）。
- 共有 UI atom は `src/components/primitives.tsx`（`IconTile` `OrderBadge` `Chip` `StatusBadge`
  `Spinner` `Button`）。フォーム共通スタイルは `src/screens/formLayout.module.css`。

## このタスクでやること

- `src/styles/theme.css` に**セマンティックなデザイントークン体系**を整備する。役割ベースで定義する。
  最低限、以下の役割を用意する（命名は既存 `--bg` 等と整合させて拡張する）:
  - 背景系: アプリ背景 / 表面（カード・パネル）/ 一段上の表面 / hover 面
  - 境界系: 標準の境界線 / 弱い境界線
  - 文字系: 標準文字 / muted / さらに弱い文字 / accent 上の文字
  - アクセント系: primary accent / secondary accent（グラデーション両端を含む）
  - ステータス系: ok / warn / danger（および必要なら各の弱い背景）
  - ボタン系: primary 背景・文字・影 / secondary(ghost) 背景・境界・文字 / stopAll(neutral) 背景・境界
  - その他: 影（elevation）/ `--radius` 系
- 各 `*.module.css` のハードコード hex/rgba を、対応するトークン参照（`var(--...)`）へ置換する。
- `Button` の variant（primary / stopAll / ghost など既存の見た目）をトークンで統一し、
  バッジ・入力・チップの配色も同じトークン群で揃える。
- 洗練された 1 つのダークパレットに調整する（見やすさ・コントラストを改善する）。
- docs/progress.md を更新する。

## このタスクでやらないこと

- ライト/ダーク切替・OS 検知（`prefers-color-scheme`）・設定画面（すべて 016）
- レイアウト構造やコンポーネント構成の大規模リファクタリング
- コンポーネントの props / API 変更
- 新しい CSS ライブラリ・UI ライブラリの導入（Tailwind 等は入れない）
- 文言・機能・画面遷移の変更
- アイコン表示方式の変更（018 で扱う）

## トークン設計方針

- 016 でライト値を差し込めるよう、**色は必ずトークン経由**にする（`*.module.css` に生の hex/rgba を
  残さない）。半透明のオーバーレイも、可能な範囲でトークン化または `color-mix` 等で表現する。
- トークンは「役割」で名付ける（`--surface` `--border` `--btn-primary-bg` 等）。特定色名
  （`--cyan` 等）では名付けない。016 のライト値定義が素直になる。
- 既存変数（`--bg` `--text` `--muted` `--line` `--accent` `--accent-2` `--ok` `--warn` `--danger`
  `--radius`）は温存しつつ、必要な役割トークンを追加する。破壊的リネームは最小限にする。

## セキュリティ制約（docs/security.md 準拠）

- 外部リソースを読み込まない（§CSP）。外部フォント・外部 CSS・CDN・リモート画像を追加しない。
- 外部通信・telemetry を増やさない。
- OS 操作・ファイル操作・プロセス操作には触れない（本タスクは frontend のスタイルのみ）。

## 完了条件

- `*.module.css` から色のハードコード（hex/rgba）が実質排除され、トークン参照になっている
- `theme.css` に役割ベースのトークン体系が整備されている
- ボタン（primary / stopAll / ghost 等）・バッジ・入力・チップの配色が統一されている
- 既存の全画面（メイン / ツール追加 / プリセット追加 / 診断 / サイドバー / プレビュー）が
  視覚的に破綻していない
- 016 でライト値を差し込める前提（色がトークン経由）になっている
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
