# 034b OBSオーバーレイ 常時追従＋サイドバー(スクロールバー)抑止

> 状態: **未着手（実装サブタスク）**。分割・線引きは親 [034](034-comment-viewer-obs-ux-round2.md) を正とする。
>
> **必読前提**: 親 [034](034-comment-viewer-obs-ux-round2.md)、先行 [034a](034a-comment-viewer-autofollow.md)
> （追従の仕組みを再利用）、第1弾 [033f](033f-obs-transparent-overlay.md)（透過オーバーレイ窓の作法）、
> [`docs/security.md`](../security.md)。CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを
> 提示する**。オーバーレイは**表示専用**（loopback WS 読み取り専用）を維持し、通信面・sidecar・Rust command は触らない。

## 目的

OBS 透過オーバーレイ（別窓 `comment-overlay`）を**常に最新コメントへ追従**させ（配信画面に最新が映り続ける）、
透過窓に出てしまう**既定のスクロールバー（「サイドバー」に見える縦バー）を抑止**する。**要望5（オーバーレイ側）・要望7**を満たす。
オーバーレイは操作 UI を持たない表示専用のため、034a の「解除＋ジャンプボタン」は付けず**常時追従**とする。

## 現在の前提（調査結果）

- オーバーレイ本体は [`OverlayApp.tsx`](../../apps/desktop/src/screens/comment-viewer/OverlayApp.tsx)。同一 loopback WS へ
  `connectCommentStream({ onComments: incoming => setComments(prev => mergeComments(prev, incoming).next) })` で
  **読み取り専用接続**し、本体と同じ `CommentList` を表示（制御フレームは送らない・38-46行）。
- オーバーレイは既に `data-overlay="1"` 属性を付与（[`OverlayApp.tsx`](../../apps/desktop/src/screens/comment-viewer/OverlayApp.tsx)
  28-34行）。透過 CSS は [`OverlayApp.module.css`](../../apps/desktop/src/screens/comment-viewer/OverlayApp.module.css)
  が `html[data-overlay="1"]`/body/#root を `background: transparent` にしている（他窓へ波及しない）。
- 追従は未実装（本体と同様）。034a で `CommentList` に追従の仕組みが入る前提。
- スクロールバー: `.list` は `overflow-y:auto` のみでバー装飾が無い
  （[`CommentViewerApp.module.css`](../../apps/desktop/src/screens/comment-viewer/CommentViewerApp.module.css) 174-184行）。
  透過窓では WKWebView 既定の縦バーが右端に出る。非表示化の手本は
  [`Sidebar.module.css`](../../apps/desktop/src/components/Sidebar.module.css) 200-210行（`::-webkit-scrollbar` ＋
  `--overlay-scrollbar` トークン）。

## このタスクでやること

### (1) オーバーレイの常時追従

- `OverlayApp` で 034a の追従の仕組みを**常時追従モード**（解除しない・ジャンプボタン無し）で使い、新着が来たら
  常に最下部へスクロールする。034a で `CommentList` にフック/オプション（例 `mode: "always" | "detachable"`）を用意した
  場合はそれを `always` で渡す。034a が本体専用実装なら、オーバーレイ側は「常に最下部へスクロールする」最小ロジックのみを持つ。

### (2) スクロールバー（サイドバー）抑止

- **`data-overlay="1"` スコープに限定**して、オーバーレイの一覧スクロールバーを**非表示/透明化**する
  （`html[data-overlay="1"] .list::-webkit-scrollbar { width:0 }` 相当、または `--overlay-scrollbar` を用いて極細・透明に）。
  **本体（`comment-viewer`）のスクロールバーには影響させない**（034a の追従とジャンプボタンは本体で機能させる）。
- 追加は [`OverlayApp.module.css`](../../apps/desktop/src/screens/comment-viewer/OverlayApp.module.css)（`data-overlay`
  スコープ）で行い、他窓へ波及させない。

## このタスクでやらないこと

- **本体（コメビュ）の追従・ジャンプボタン（034a）**。本タスクはオーバーレイ（`comment-overlay`）のみ。
- 文字サイズ・配色・レイアウトなどの**意匠刷新（034e）**。ここでは追従とスクロールバー抑止に限定。
- オーバーレイの開閉操作・設定移設（034d）。
- 通信面・sidecar・Rust command の変更（オーバーレイは表示専用・読み取り専用接続のまま）。

## セキュリティ制約（docs/security.md 準拠）

- オーバーレイは**表示専用**を維持（loopback WS 読み取り専用接続のみ・制御フレームを送らない・§1 /「方針②」）。
  本タスクは frontend のスクロール制御と `data-overlay` スコープの CSS 追加のみで、**新規通信面・宛先・capability を作らない**。
- 新しい Tauri command / capability / 依存を追加しない（§3/§10）。`csp: null` 不変。取得コメント本文はログ/DB に出さない（既存踏襲）。
- オーバーレイ窓のライフサイクル（`open_comment_overlay_window`・no-orphan kill をコメビュ窓に集約）を変更しない。

## 完了条件

- オーバーレイが新着で常に最下部へ追従し、最新コメントが映り続ける。
- 透過オーバーレイに縦スクロールバー（サイドバー）が出ない。
- 本体（コメビュ）のスクロールバー・034a の追従/ジャンプボタンに影響が無い（`data-overlay` スコープに限定できている）。
- OBS のウィンドウキャプチャで従来どおり透過合成できる（033f の挙動を維持）。
- 新しいライブラリ / Tauri command / capability を追加していない。`csp: null` 不変。
- `pnpm --filter ./apps/desktop typecheck` / `lint` が通る。[`docs/progress.md`](../progress.md) が更新されている。

## 確認コマンド

```bash
git diff --stat
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
pnpm --filter ./apps/desktop tauri dev   # オーバーレイを開き、常時最下部追従／スクロールバー非表示／本体側は 034a どおり／OBS 透過合成を目視
```
