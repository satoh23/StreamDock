# 022 Tool/Preset Form Polish

## 目的

ツール追加/編集・プリセット追加/編集フォームの細部を整える（ユーザー要望 4・5・6・7）。
不要項目の削除、非活性欄の見た目改善、チェックボックスの余白、説明文言の調整を行う。

## 現在の前提

- ツールフォーム `screens/add-tool/AddToolScreen.tsx`。単一ページ、`isEdit = !!editingTool` で切替。
  state に `name` / `executablePath` / `description` / `iconLabel` / `iconPng`（46-51 行）。
  - 「アイコンラベル」フィールド（213-223 行）: `iconLabel` に束縛、ヘルプ「未入力なら表示名の先頭文字を使います。」
  - 「実行ファイルパス」フィールド（192-202 行）: `readOnly`（`disabled` ではない＝通常文字色）。
    ヘルプ「『アプリを選択』からのみ設定できます。直接入力・編集はできません。」
    パネル見出し `<p>`（142 行）にも同趣旨の説明あり。
  - `iconLabel` はプレビュー `toIconLetter({ iconLabel, name })`（115 行）と保存 payload（96 行）で使用。
    アイコンは 018 の自動抽出（`iconPng`）が主。`icon_label` は表示名先頭文字のフォールバック用途。
- プリセットフォーム `screens/add-preset/AddPresetScreen.tsx`（Step1）。
  - 「PC起動時にプリセット自動起動」チェックボックス（346-359 行）: `label.bootToggle`（checkbox＋span）。
    `AddPresetScreen.module.css .bootToggle` は `display:flex; align-items:center; gap:10px`。
  - 説明文（355-358 行）: 「オンにすると、PC 起動時に stream-dock が自動起動し、このプリセットのツールを
    一括起動します。」
- フォーム共通スタイルは `screens/formLayout.module.css`（`.field input/select`・`.fieldHelp` 等）。

## このタスクでやること

- **(4) アイコンラベル削除**（`AddToolScreen.tsx`）:
  - 「アイコンラベル」フィールド（213-223 行）を削除する。
  - 関連する state `iconLabel`（49 行）、初期化（60 行）、保存 payload の `iconLabel`（96 行）、
    プレビューの `toIconLetter({ iconLabel, name })`（115 行）を整理し、表示名（`name`）先頭文字ベースに寄せる。
  - `createTool` / `updateTool` へ `iconLabel` を送らない。**Rust モデル/DB の `icon_label` カラムは残置**
    （破壊的変更は本タスク範囲外。既存の default 挙動に委ねる）。
- **(5) 実行ファイルパス欄**（`AddToolScreen.tsx` 192-202 行）:
  - `readOnly` のまま、非活性と分かるよう**フォーム内の文字を灰色化**する
    （`formLayout.module.css` に `.readonlyInput` 等のクラスを追加し `color: var(--muted)` を付与、
    もしくは `AddToolScreen.module.css` に定義して当該 input に適用）。
  - ヘルプ文言を **「直接入力・編集はできません。」のみ**に短縮する。
  - パネル見出し `<p>`（142 行）の重複説明は、冗長なら簡潔化して整合させる。
- **(6) チェックボックス余白**（`AddPresetScreen.module.css .bootToggle`）:
  - checkbox とラベルテキストの間隔を広げる（`gap: 10px` → 例 `gap: 12px` 程度）。マージンを開けて整える。
- **(7) 説明文言変更**（`AddPresetScreen.tsx` 355-358 行）:
  - 「PC起動時にこのプリセットに登録されたツールが自動起動されます。」に変更する。

## このタスクでやらないこと

- Rust 側モデル / DB スキーマの変更（`icon_label` カラム削除はしない）
- パス検証（`validate` / `validate_executable`）の変更・ファイル選択仕様の変更
- フォーム項目の**追加**（URL 種別等は 023 で扱う）
- 自動起動ロジック（019）の挙動変更・アイコン自動抽出（018）の変更
- 配色・ボタンのモダン化（021 で扱う）

## セキュリティ制約（docs/security.md 準拠）

- frontend のみの変更。パスの設定は既存の dialog `open()` 経由に限定したまま（§2 / §7 維持）。
- OS 操作・ファイル操作・プロセス操作を追加しない。外部リソース・外部通信を増やさない。

## 完了条件

- ツール追加/編集画面から「アイコンラベル」フィールドが消え、アイコンは自動抽出（無ければ表示名先頭文字）で
  従来どおり表示される（保存・編集・プレビューが破綻しない）
- 実行ファイルパス欄が非活性と分かる灰色文字表示になり、ヘルプが「直接入力・編集はできません。」のみになっている
- プリセット自動起動チェックボックスとテキストの間に適度なマージンがある
- 自動起動の説明文が「PC起動時にこのプリセットに登録されたツールが自動起動されます。」になっている
- 新しいライブラリを追加していない
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
