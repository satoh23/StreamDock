# 025 Form/UI Polish Round 2

## 目的

022 に続くフォーム/UI の細部整理（frontend のみ）。未使用フォームの削除、プレビュー枠のフラット化、
ツール編集時の種別トグル非表示、メイン画面編集中フッタの不要要素削除を行う。

- プリセット編集/追加画面の「説明」欄はどこにも表示されないため削除する。
- ツール追加後プレビューの枠が影/枠のように見えて上辺の線がおかしくなるため、フラット表示にする。
- ツール編集画面ではアプリ/URL トグルを出さず、対象種別の項目だけ編集できるようにする。
- メイン画面編集中の最下部「起動間隔を設定」「PC起動時の動作」と、それを囲う枠線を削除する。

## 現在の前提

- プリセット追加/編集は `apps/desktop/src/screens/add-preset/AddPresetScreen.tsx`。「説明」欄は Step1
  （335-345 行）。state `description`（79 行）、初期化 `editingPreset?.description`（97 行）、保存 payload
  （`saveCreate` 168 行 / `saveEdit` 184 行）で `description` を送っている。
  **保存されるが UI のどこにも表示されない write-only**（`Sidebar.tsx` / `MainScreen.tsx` / `Header.tsx` は
  preset の description を読まない。一覧に出るのは tool の description のみ）。ヘルプ「サイドバーや一覧の
  補足として使えます。」（342-344 行）は実装されていない。
- ツール追加後プレビューは `apps/desktop/src/components/PreviewCard.tsx` ＋
  `apps/desktop/src/components/PreviewCard.module.css`。ハイライト行 `.newRow`（CSS 77-85 行）が
  `border: 1px solid color-mix(... --accent 30% ...)` ＋ radial-gradient 背景で「影/枠」のように見え、
  パネル（`.panel` の `--line` 枠）の上辺の線と干渉する。**box-shadow は無い**（正体は accent border＋グラデ背景）。
- ツール追加/編集は同一 `apps/desktop/src/screens/add-tool/AddToolScreen.tsx`。アプリ/URL 種別トグル
  （174-200 行, `role="tablist"`）は `isEdit` でガードされず**編集時も常時表示**され、種別を切り替えられてしまう。
  `kind` は `editingTool?.kind` から初期化（70 行）。URL 種別と executable 種別で表示項目が分岐している
  （202-285 行の URL 入力 / 実行ファイル選択、257-285 行のフォーム分岐）。
- メイン画面編集中フッタは `apps/desktop/src/screens/main/MainScreen.tsx` 709-716 行
  （`起動間隔を設定` / `PC起動時の動作` の `Button`、いずれも onClick 未配線のプレースホルダ）。
  枠は `apps/desktop/src/screens/main/MainScreen.module.css` `.footerActions`（323-333 行、
  `border: 1px solid var(--line)` ＋ `border-radius` ＋ `background: var(--surface-2)`）と
  `.footerButtons`（334-338 行）。019 でも当フッタ（起動間隔プレースホルダ）は将来対応の扱いだった。

## このタスクでやること

### (1) プリセット説明欄の削除

- `AddPresetScreen.tsx` の「説明」フィールド（335-345 行）を削除する。
- 関連 state `description`（79 行）・初期化（97 行）・保存 payload の `description`（168・184 行）を整理し、
  `createPreset` / `updatePreset` へ `description` を送らない。
- **Rust モデル / DB の `description` カラムは残置**する（022 の `icon_label` と同方針。破壊的変更は範囲外で、
  既存の default 挙動に委ねる）。

### (2) プレビュー枠のフラット化

- `PreviewCard.module.css` の `.newRow`（77-85 行）から accent の `border` と radial-gradient 背景を撤廃し、
  フラット表示（単色面 `--surface-2` 等・border 無し、必要なら控えめな面色のみ）にする。
- パネル上辺の線（`.panel` の `--line`）と干渉して線がおかしく見える状態を解消する。021 のフラット方針に整合させる。

### (3) ツール編集時の種別トグル非表示

- `AddToolScreen.tsx` の種別トグル（174-200 行）を `isEdit` のときは**非表示**にする。
- 編集時は `editingTool.kind` に応じて、アプリ（executable）なら実行ファイル系の項目のみ、URL なら URL 入力
  のみを編集できるようにする（種別の切り替えは編集時にはさせない）。パネル見出し（166-172 行）や本文の
  分岐が編集対象の種別で正しく出ることを確認する。

### (4) メイン画面編集中フッタの削除

- `MainScreen.tsx` 709-716 行の `起動間隔を設定` / `PC起動時の動作` `Button` と、それを囲う
  `.footerActions` ブロックを削除する。
- `MainScreen.module.css` の `.footerActions`（323-333 行）と、未使用になる `.footerButtons`（334-338 行）を
  削除する。編集モードのレイアウトが崩れないことを確認する。

## このタスクでやらないこと

- Rust 側モデル / DB スキーマの変更（preset の `description` カラム削除はしない）。
- ツール追加時のプリセット登録の本実装（024 で扱う）。
- 配色トークンやボタンのモダン化の追加変更（021 の範囲）。
- 「起動間隔を設定」「PC起動時の動作」機能そのものの実装（削除のみ。将来別タスク）。
- プレビュー以外のコンポーネントのスタイル刷新。

## セキュリティ制約（docs/security.md 準拠）

- frontend のみの変更。OS 操作・ファイル操作・プロセス操作を追加しない（§2 / §4）。
- 外部リソース（外部フォント・CSS・CDN・リモート画像）を読み込まない（§CSP）。
- 外部通信・telemetry を増やさない（§1）。パス設定・ファイル選択の既存仕様は変更しない。

## 完了条件

- プリセット追加/編集画面から「説明」欄が消え、保存・編集が破綻しない（Rust の `description` カラムは残置）
- ツール追加後プレビューのハイライト枠がフラットになり、パネル上辺の線が正常に表示される
- ツール編集画面でアプリ/URL トグルが表示されず、対象種別の項目のみ編集できる（種別切替不可）
- メイン画面編集中の「起動間隔を設定」「PC起動時の動作」と囲み枠線が削除され、レイアウトが崩れない
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
