# 038b 視聴者一覧・詳細 UI ＋配信者メモ

> 状態: **未着手（実装サブタスク）**。分割・線引きは親 [038](038-viewer-memory.md) を正とする。
>
> **必読前提**: 親 [038](038-viewer-memory.md)、データ基盤 [038a](038a-viewer-memory-data-layer.md)（コマンド/DTO の正）、
> コメビュ画面 [`CommentViewerApp.tsx`](../../apps/desktop/src/screens/comment-viewer/CommentViewerApp.tsx)・[`SettingsView.tsx`](../../apps/desktop/src/screens/comment-viewer/SettingsView.tsx)、
> [`docs/security.md`](../security.md)。CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。

## 目的

038a で保存・集計した視聴者データを、コメントビューア（配信者だけが見る画面）で**閲覧できる UI** を追加し、
**配信者メモの編集**を可能にする。

## 現在の前提（調査結果）

- コメビュ本体は `view` state で `"comment"`（一覧）と `"settings"`（設定）を切り替える（[`CommentViewerApp.tsx`](../../apps/desktop/src/screens/comment-viewer/CommentViewerApp.tsx)）。
  設定ビューは `SettingsView`（表示専用・props でハンドラ受領）。同様のビュー追加パターンで「視聴者」ビューを足せる。
- 038a が `list_viewers` / `get_viewer`（詳細＋過去コメント）/ `update_viewer_note` / `delete_viewer` コマンドと ts-rs DTO を提供する。
- 部品は既存の `Select` / `ToggleSwitch` / `StatusIndicator` を再利用（[`apps/desktop/src/screens/comment-viewer/`](../../apps/desktop/src/screens/comment-viewer/)）。スタイルは `CommentViewerApp.module.css` の役割トークン。

## このタスクでやること

### 視聴者ビューの追加（一覧＋詳細）

- コメビュに「視聴者」ビューを追加（`view` に `"viewers"` を足す等）。導線はヘッダ/ツールバーのボタン。
- **一覧**: `list_viewers` を呼び、ユーザー名・サイト名・総コメント数・bits/スパチャ合計などを表形式で表示。検索/並び替え（総数順・最終コメント順など）。
- **詳細**: 行選択で `get_viewer` を呼び、総コメント数・bits/スパチャの回数と合計額・サブスク/メンシプ期間・**その配信で過去に行ったコメント**・
  配信者メモを表示。

### 配信者メモの編集

- 詳細に memo テキスト入力を置き、`update_viewer_note` で保存（既存の入力検証は 038a の Rust 側が担う）。削除（`delete_viewer`/全消去）導線も用意。

### 表示専用の原則

- WS/TTS/sidecar 制御はこのビューに持たせない（`SettingsView` と同じく表示専用）。コマンド呼び出しは `invoke` のみ。

## このタスクでやらないこと

- 保存・集計・コマンド実装（038a）。初見/久しぶりバッジ（038c）。ROM 一覧（040b）。
- 端末外送信・エクスポート。オーバーレイ側の変更。

## セキュリティ制約（docs/security.md 準拠）

- **frontend 表示＋メモ更新（invoke）のみ**。外部通信宛先・API・capability・依存を増やさない（§1/§3/§10）。`csp: null` 不変。
- 視聴者本文・メモは画面表示のみ（端末外に出さない・§9）。ログに出さない。

## 完了条件

- 視聴者一覧と詳細（総数/サイト/bits/スパチャ回数・額/サブスク期間/過去コメント）が表示され、配信者メモの保存・削除が動作する。
- 表示専用で新規宛先/API/capability/依存の追加が無い。`csp: null` 不変。
- `pnpm --filter ./apps/desktop typecheck` / `lint` が通る。[`docs/progress.md`](../progress.md) を更新。

## 確認コマンド

```bash
git diff --stat
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
pnpm --filter ./apps/desktop tauri dev   # コメント取得後に視聴者ビューで一覧→詳細を開き、集計値・過去コメント・
                                         #   メモ保存/削除が動くことを目視
```

## 実装後に必要なレビュー

- security-review（軽）: frontend 表示＋メモ更新のみで外部通信宛先・API・capability・依存が不変であること、視聴者データを端末外/ログに出さないことを確認する。
