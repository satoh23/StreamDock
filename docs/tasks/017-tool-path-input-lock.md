# 017 Tool Path Input Lock

## 目的

ツール追加/編集画面の「実行ファイルパス」を、ユーザーに**直接入力・編集させない**（ユーザー要望 7）。
値の設定は既存のファイル選択（Tauri dialog `open()`）ピッカー経由のみに限定する。

任意のパス文字列を手打ちさせないことで、入力ミス・不正パスの混入を減らし、セキュリティ方針
（frontend から任意パスを扱わせない）とも整合させる。

## 現在の前提

- ツール追加/編集は単一ページフォーム（`src/screens/add-tool/AddToolScreen.tsx`）。
  作成/編集を `isEdit = !!editingTool` で切替。フォーム状態は `name` / `executablePath` /
  `description` / `iconLabel`。
- 実行ファイルパスの設定手段が現状 2 つある:
  - (a) Tauri dialog プラグインの `open()` ピッカー（`実行ファイルを選択`）
  - (b) `executablePath` に束縛された**直接編集可能なテキスト `<input>`**
    （ヘルプ文言「『アプリを選択』で自動入力されます。直接入力・編集も可能です。」）
- 未選択時はドロップゾーン風パネルに「アプリを選択」ボタンと `.exe/.app/その他` チップを表示。
  選択済みだと selectedApp カードにアイコン文字＋名前＋パスを表示。
- Rust 側 `tools/service.rs::validate` と `process/service.rs::validate_executable` で、
  保存時・起動時にパス検証は行われている（本タスクでは変更しない）。

## このタスクでやること

- `AddToolScreen.tsx` の実行ファイルパス用 `<input>` を**読み取り専用/非活性化**する
  （`readOnly` もしくは `disabled`。値はピッカー選択時のみ更新される状態にする）。
- 実行ファイルパスの値設定は、既存の `open()` ピッカー経由のみに限定する。
- ヘルプ文言を「『アプリを選択』からのみ設定できます」等、直接入力できない旨に更新する。
- 未選択時のドロップゾーン導線（「アプリを選択」ボタン）は維持する。
- 選択済み表示（selectedApp カード）は据え置き。アイコンは 018 で扱うため本タスクでは変更しない。
- docs/progress.md を更新する。

## このタスクでやらないこと

- Rust 側のパス検証（`validate` / `validate_executable`）の変更
- アイコン自動抽出・表示方式の変更（018 Tool Icon Auto-Extraction で扱う）
- パス以外のフォーム項目（名前・説明・アイコンラベル）の挙動変更
- ピッカーの拡張子フィルタや選択仕様の作り込み
- OS ドラッグ&ドロップの実装

## セキュリティ制約（docs/security.md 準拠）

- frontend から任意のパス文字列を自由入力させない方向の変更であり、§2 / §7 の方針に沿う。
- OS 操作・ファイル操作・プロセス操作は追加しない（既存の dialog `open()` の利用範囲を変えない）。
- Rust 側の検証は引き続き効いていること（frontend の非活性化だけに依存しない）。

## 完了条件

- 実行ファイルパス欄が直接編集できない（読み取り専用/非活性）
- パスは「アプリを選択」ピッカーからのみ設定できる
- ツールの作成・編集フローが従来どおり動作する（保存・更新・名前自動推測など）
- ヘルプ文言が直接入力できない旨に更新されている
- 選択済み表示・未選択時のドロップゾーン導線が維持されている
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
