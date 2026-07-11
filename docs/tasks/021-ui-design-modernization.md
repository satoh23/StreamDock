# 021 UI Design Modernization

## 目的

「配色がダサい／グラデーションを使いたくない」「ツール一覧の個別起動・停止ボタンが隆起して見にくい」
「リンクやボタンの枠が全部明示されていてチープに見える」（ユーザー要望 2・3）を解消する。
グラデ無し・フラット・枠線を必要箇所に限定した今どきの見た目にする。トークン差し替え中心で行い、
016 のライト/ダーク両対応を維持する。

## 現在の前提

- 配色は `styles/theme.css` の seed(`--color-*`)＋役割トークン方式（015/016 済）。`*.module.css` の
  色はすべて `var(--...)` 経由でハードコードは無い。
- グラデ/隆起の定義（`theme.css:77-91`）:
  - `--btn-primary-bg: linear-gradient(135deg, var(--color-secondary), var(--color-accent))`（cyan→purple）
  - `--elev-gradient`（隆起面用の淡い縦グラデ）／`--elev-border`
  - `--shadow-drop`（primary のグロー落ち影）／`--shadow-inset`（上辺ハイライト＝隆起）／`--shadow-1`（落ち影）
- プライマリボタンは `primitives.module.css .primary`（`--btn-primary-bg` ＋ `box-shadow: var(--shadow-drop)`）。
  `.primary.stopAll` は `--elev-gradient`＋`--shadow-inset`＋`--shadow-1`＋border の隆起中立ボタン。
  ghost は `.secondary`（`--btn-ghost-bg` ＋ `--btn-ghost-border`）。
- 起動/停止ボタンの隆起は `MainScreen.module.css` の `.runtimeAction`/`.move`/`.delete`
  （`--elev-gradient`＋`--shadow-inset`(＋`--shadow-1`)＋`border: 1px solid var(--elev-border)`）。
  `.startBtn` は accent の radial-gradient を重ねている。
- 枠線は `--line`（標準）と `--border-soft`（弱）の 2 段階。ghost ボタン・Chip・アイコンボタン・
  入力欄など広範に border が付いている。

## このタスクでやること

- **グラデーション廃止**:
  - `theme.css` の `--btn-primary-bg` を **`var(--primary)` 単色**に変更（cyan→purple グラデを撤廃）。
  - `.primary` の `box-shadow: var(--shadow-drop)` を除去し、hover は `filter: brightness(1.06)` 程度に。
  - `--elev-gradient` を使う箇所をフラット面（`--control-bg` / `--surface-2`）へ置換。
  - `.startBtn` の radial-gradient を撤廃し、accent 系の淡い単色ティントにする。
- **隆起（emboss）の排除**: `MainScreen.module.css` の `.runtimeAction`/`.move`/`.delete` から
  `--shadow-inset`＋`--shadow-1`＋`--elev-gradient`＋border を除去し、フラットな icon ボタンにする
  （既定 `--control-bg` 面・border 無し・hover で `--control-bg-hover`、`.startBtn`=accent 淡ティント、
  `.stopBtn`=danger 文字色）。`primitives .primary.stopAll` も同方針でフラット化。
- **枠線の間引き**（モダン化）:
  - **残す**: 入力フォーム（`formLayout .field input/select` の border＝視認性重要）、パネル外枠
    （`.panel` の `--line`）、状態を区別する `StatusBadge` の border。
  - **消す/弱める**: 常時 border を持つ ghost 系（`primitives .secondary`・Sidebar `.ghost`・
    `MainScreen .editToggle` / `.addToolBtn` / `.modeToggle`）の border を撤廃し、面色 or hover/active
    のみで表現する。`Chip` の border、アイコンボタンの装飾的 border を除去する。
- 変更は**トークン優先**（`theme.css`）で行い、色のハードコードを増やさない。**ライト/ダーク両方**で
  コントラスト・視認性が破綻しないことを確認する。

## このタスクでやらないこと

- レイアウト構造やコンポーネント構成の大規模リファクタリング／コンポーネント props / API の変更
- 新しい CSS / UI ライブラリの導入（Tailwind 等は入れない）
- 文言・機能・画面遷移の変更／アイコン表示方式の変更
- 020 のヘッダー実装・022 のフォーム項目/文言変更（各別タスク）

## セキュリティ制約（docs/security.md 準拠）

- frontend のスタイルのみ。OS 操作・ファイル操作・プロセス操作に触れない。
- 外部リソース（外部フォント・CSS・CDN・リモート画像）を読み込まない（§CSP）。
- 外部通信・telemetry を増やさない。

## 完了条件

- グラデーションが排除され、プライマリボタンが `--primary` 単色フラット（落ち影なし）になっている
- ツール一覧の起動/停止/移動/削除ボタンの隆起（emboss シャドウ・グラデ・border）が排除され、
  フラットで見やすいアイコンボタンになっている
- 装飾的な常時 border が削減され、視認性が重要な箇所（入力・パネル外枠・状態バッジ）には枠線が残っている
- ライト/ダーク両テーマで視覚的に破綻していない（色はトークン経由のまま）
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
