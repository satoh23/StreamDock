# 039b `@font-face` 動的読込＋フォント選択 UI 拡張

> 状態: **未着手（実装サブタスク）**。分割・線引きは親 [039](039-font-import.md) を正とする。
>
> **必読前提**: 親 [039](039-font-import.md)、Rust 基盤 [039a](039a-font-import-rust-storage.md)（コマンド/DTO の正）、
> 現行フォント選択 [`overlaySettings.ts`](../../apps/desktop/src/features/comment-viewer/overlaySettings.ts)・[`SettingsView.tsx`](../../apps/desktop/src/screens/comment-viewer/SettingsView.tsx)（372-401 行）、
> [`docs/security.md`](../security.md)（CSP方針）。CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。

## 目的

039a が保存したインポート済みフォントを **`@font-face` で動的読込**し、フォント選択欄に **OS 標準フォント＋インポート済みフォントを合流**させて
選択・プレビュー・適用できるようにする。インポート導線（ファイル選択→取込）も UI に追加する。

## 現在の前提（調査結果）

- フォント候補は `OVERLAY_FONTS`（OS 標準・[`overlaySettings.ts`](../../apps/desktop/src/features/comment-viewer/overlaySettings.ts) 25-49 行）。
  id を localStorage に保存し `resolveOverlayFontStack`（84-90 行）で font-family へ解決。選択 UI は `SettingsView.tsx`（372-401 行・`Select`＋プレビュー）、
  適用は `OverlayApp` のインライン `fontFamily`。
- 039a が `list_fonts` / `get_font_data(id)`（base64 data URI）/ `import_font(path)` / `delete_font(id)` を提供する。
- ファイル選択は `@tauri-apps/plugin-dialog` の `open()`（[`AddToolScreen.tsx`](../../apps/desktop/src/screens/add-tool/AddToolScreen.tsx) 116-134 行が手本）。039a で comment-viewer capability に open 権限追加済み前提。

## このタスクでやること

### `@font-face` 動的注入（data URI）

- 起動時/一覧更新時に `list_fonts`→各フォントの `get_font_data` を取得し、`@font-face { font-family: 'imported-<id>'; src: url(data:font/...) }` を
  動的注入する（`<style>` 要素か CSSOM insertRule）。**src は data URI のみ**（外部 URL を踏まない・CSP 方針）。
- 大きなフォントの読込を考慮し、注入は一度きり・重複防止。失敗時はそのフォントを候補から除外して表示継続。

### 選択欄の合流＋インポート導線

- フォント選択の候補を **OS 標準（`OVERLAY_FONTS`）＋インポート済み** に合流させ、`resolveOverlayFontStack` を **インポート id → `'imported-<id>', <フォールバック>`** にも
  対応させる。選択値の保存は既存 localStorage 経路（`overlaySettings.ts`）を踏襲しつつ、インポート id を扱えるよう拡張（不正/削除済み id は既定へフォールバック）。
- `SettingsView.tsx` の「OBSオーバーレイ」カードに **「フォントをインポート」ボタン**（`open()`→`import_font`→一覧更新）と、インポート済みフォントの
  削除導線（`delete_font`）を追加。プレビュー（`あア亜Ag 123`）は選択フォントで表示（既存踏襲）。

### 適用

- 選択フォントをオーバーレイへ適用（既存の `OverlayApp` インライン `fontFamily` 経路）。コメビュ本体への適用は親 039 の決定に従う（既定はオーバーレイのみ）。

## このタスクでやらないこと

- 保存・レジストリ・コマンド・検証（039a）。オーバーレイ意匠変更（037）。
- 外部フォント/CDN 参照。太さ/サイズ等の詳細タイポ設定。

## セキュリティ制約（docs/security.md 準拠）

- **frontend の表示・設定・invoke のみ**。`@font-face` の src は **data URI のみ**で外部 URL/CDN を参照しない（CSP 方針不変・§1）。
- localStorage は非機密 UI 設定（選択 id）のみ。フォント実体は 039a の管理下（frontend は data URI を受けて注入するだけ）。
- ファイル選択は plugin-dialog の open のみ（039a で最小追加）。フルパスをログ/画面へ出さない。

## 完了条件

- インポート済みフォントが選択欄に OS 標準と並んで表示され、選択でプレビュー＆オーバーレイに反映される。**一度インポートしたら再起動後も選択欄に残る**（039a の永続レジストリ由来）。
- `@font-face` の src が data URI のみで、外部フォント参照が無い。削除済み/不正 id は既定へフォールバックし表示が壊れない。
- 新規外部通信宛先・CSP 変更・依存追加が無い。
- `pnpm --filter ./apps/desktop typecheck` / `lint` が通る。[`docs/progress.md`](../progress.md) を更新。

## 確認コマンド

```bash
git diff --stat
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
pnpm --filter ./apps/desktop tauri dev   # 設定→フォントをインポート→選択欄に出現→選択でプレビュー＆オーバーレイ反映、
                                         #   再起動後も候補に残ること、削除で候補から消えることを目視
```

## 実装後に必要なレビュー

- security-review（軽）: `@font-face` の src が data URI のみで外部フォント/CDN を参照しないこと、CSP・外部通信宛先・依存が不変であること、
  フルパスをログ/画面へ出さないことを確認する。
