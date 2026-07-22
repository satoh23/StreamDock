# 039 フォントインポート（親・設計/方針）

> 状態: **未着手（親ドキュメント）**。本ファイルは 039a〜039b の**分割・線引き・実装順の正**。
>
> **必読前提**: 現行フォント選択 [`overlaySettings.ts`](../../apps/desktop/src/features/comment-viewer/overlaySettings.ts)（OS 標準スタックのみ）・
> [034e](034e-overlay-design-refresh.md)（フォント選択 UI）、self-host `@font-face` の例 [`theme.css`](../../apps/desktop/src/styles/theme.css)（3-9 行）、
> ファイル選択の既存例 [`AddToolScreen.tsx`](../../apps/desktop/src/screens/add-tool/AddToolScreen.tsx)（`@tauri-apps/plugin-dialog` の `open`）、
> [`docs/security.md`](../security.md)（**特に「## CSP方針」＝外部 script/style/image/font を増やさない**・§5 ファイル操作を管理領域限定）。
> CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。各サブタスクは 1 タスク 1 機能で分割済み。

## 目的

コメント表示のフォントについて、**ユーザーが自分でダウンロードしたフォントファイルをインポートして選択できる**ようにする。
一度インポートしたフォントは**選択欄にずっと残る**（永続）。

## 現在の前提（調査結果）

- フォント選択は **OS 標準フォントのスタックのみ**（[`overlaySettings.ts`](../../apps/desktop/src/features/comment-viewer/overlaySettings.ts) の `OVERLAY_FONTS`・25-49 行）。
  id を localStorage に保存し `resolveOverlayFontStack` で font-family へ解決、`SettingsView.tsx`（372-401 行）で選択＋プレビュー、`OverlayApp` にインライン適用。
  **外部 Web フォント（CDN）は CSP 方針で禁止**、`@font-face` はアプリ名ワードマーク専用の self-host のみ（[`theme.css`](../../apps/desktop/src/styles/theme.css) 3-9 行・`public/fonts/`）。
- **ユーザーファイルをアプリ内へコピー/インポートする Rust 経路は無い**。ファイル選択は frontend の `@tauri-apps/plugin-dialog` の `open()`
  （[`AddToolScreen.tsx`](../../apps/desktop/src/screens/add-tool/AddToolScreen.tsx) 116-134 行）で**パス文字列を得るだけ**、本体コピーはしない。
  Rust の `std::fs` 書き込みは `create_dir_all(app_data_dir)` 程度（[`lib.rs`](../../apps/desktop/src-tauri/src/lib.rs) 246-247 行）。
- アプリのデータディレクトリは `app.path().app_data_dir()`（現状 `stream-dock.db` のみ格納）。アイコンは base64 PNG を DB に保存する前例あり（`tools.icon_png`）。

## 確定した方針

- **フォント本体を app data dir 配下の管理ディレクトリ（例 `app_data_dir/fonts/`）へコピーして保存**し、レジストリ（SQLite テーブル `fonts`）に登録する。
  localStorage ではなく**ファイル実体＋DB レジストリ**で管理することで「一度入れたらずっと選べる」を満たす（OS 操作・ファイル操作は Rust 側／CLAUDE.md）。
- **webview へのフォント供給は base64 データ URI 方式**にする。Rust がフォントファイルを読み、`get_font_data` で base64（`data:font/...`）を返し、
  frontend が `@font-face { src: url(data:...) }` を動的注入する。これは**アイコンの data URI 方式（036 系）と同型**で、
  **asset プロトコル/CSP font-src/capabilities を増やさずに済む**（外部通信ゼロ・CSP 方針不変）。
- **選択欄は既存 `OVERLAY_FONTS`（OS 標準）＋インポート済みフォントの合流**にする。`resolveOverlayFontStack` をインポート id にも対応させ、
  選択・プレビュー・適用は既存経路を再利用する。適用先は既定でオーバーレイ（現行フォント設定と同じ）。**コメビュ本体への適用有無は下記で決める**。
- **検証は Rust 側**（§5/§8）: 拡張子（`.ttf`/`.otf`/`.woff`/`.woff2` 等）許可リスト・サイズ上限・パス検証・制御文字拒否。管理ディレクトリ外へ書き込まない。
- **依存は増やさない方針**。フォント family 名の抽出が必要でパースに軽量ライブラリが要る場合は 039a で理由を添えて提案（無理なら family 名は
  ユーザー入力/ファイル名由来にフォールバック）。

### 決めること（親で確定）

- **適用範囲**: 既定はオーバーレイのみ（現行フォント設定の踏襲）。コメビュ本体にも適用するかは 039b 着手時に確定（既定はオーバーレイのみに留める）。
- **ファイル選択の権限**: インポート UI をコメビュ窓（`SettingsView`）に置くため、`@tauri-apps/plugin-dialog` の `open` 権限を
  [`capabilities/comment-viewer.json`](../../apps/desktop/src-tauri/capabilities/comment-viewer.json)（現状 `core:default` のみ）に追加する必要がある → **capability 追加は security-review 対象**。

## サブタスク分割

| ID | 内容 | 外部通信（新規） | security-review |
|----|------|-----------------|-----------------|
| [039a](039a-font-import-rust-storage.md) | Rust: フォントファイルのインポート/管理ディレクトリへコピー＋検証＋`fonts` レジストリ＋コマンド（import/list/delete/get_font_data）＋security.md 更新 | なし（ローカルファイルのみ） | **必須**（新規ファイル書き込み経路・§5・capability 追加） |
| [039b](039b-font-face-loading-and-selection-ui.md) | frontend: インポート済みフォントの `@font-face` 動的注入（data URI）＋選択 UI 拡張（OS 標準＋インポート）＋プレビュー＋オーバーレイ適用 | なし | 軽（表示/設定・data URI のみ） |

## 依存関係と推奨実装順

```
039a → 039b
```

- **039a が土台**（保存・レジストリ・コマンド）。これが無いと frontend が読むフォントデータが無い。
- **039b** は 039a のコマンドを叩き `@font-face` 注入＋選択 UI 合流。

## 横断セキュリティ方針（docs/security.md 準拠）

- **ファイル操作は Rust 側・管理領域（app data dir 配下 fonts/）限定**（§5）。管理ディレクトリ外へ書き込まない・パス検証必須。
- **外部通信ゼロ・CSP 方針不変**（外部 Web フォント/CDN を増やさない）。フォント供給は data URI で webview 内に閉じる（font-src/asset プロトコルを増やさない）。
- **入力検証を Rust 側で必ず行う**（拡張子許可リスト・サイズ上限・制御文字拒否・パス検証／§8）。frontend の生パスを信用しない。
- ファイル選択のための `@tauri-apps/plugin-dialog`（open）権限を comment-viewer capability へ追加する場合は**最小権限**（open のみ）に留める（§3）。
- 新規 crate/npm/plugin を増やさない方針（family 名抽出等で必要なら 039a で理由を添えて提案）。ログにフルパス・フォント内容を出さない（§9・`with_filename_detail` 流儀）。

## 完了条件

- 039a〜039b のタスクファイルが本親の分割・依存どおりに存在し、既存フォーマットに沿う。
- [`docs/task-board.md`](../task-board.md) に 039 系が追記されている。
- 本親ドキュメント自体はコードを変更しない（実装は各サブタスクで「実装して」後）。
- 各サブタスク完了時に [`docs/progress.md`](../progress.md) を更新する。

## このタスク（親）でやらないこと

- コード実装（039a〜b それぞれで行う）。
- 外部 Web フォント/CDN の参照（CSP 方針で禁止・ローカルインポートのみ）。
- フォントのアプリ同梱配布・ライセンス管理の作り込み（ユーザーが用意したファイルのインポートのみ）。
- 太さ/サイズ/行間などの詳細タイポ設定（フォント選択のみ。詳細調整は将来タスク）。
