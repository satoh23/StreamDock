# 034a コメビュ本体 最新コメント自動追従＋「最新コメント N件 ↓」ジャンプボタン

> 状態: **未着手（実装サブタスク・034 系の先頭）**。分割・線引きは親 [034](034-comment-viewer-obs-ux-round2.md) を正とする。
>
> **必読前提**: 親 [034](034-comment-viewer-obs-ux-round2.md)、第1弾 [033b](033b-settings-view-connection.md)
> （`CommentList` 分割）、[`docs/security.md`](../security.md)。CLAUDE.md どおり **「実装して」まで変更せず、まず
> 変更計画と対象ファイルを提示する**。純粋な frontend のスクロール/DOM 制御で、通信面・sidecar・Rust command は触らない。

## 目的

コメントビューア本体を**最新コメントへ自動追従**（新着が来たら最下部へオートスクロール）させる。ただし配信者が過去
コメントを読み返せるよう、**一定以上スクロールアップしたら追従を解除**し、その間は画面下部に**「最新コメント N件 ↓」の
半透過の黒い長丸ボタン**を出す。クリックで最下部へスクロールし追従を再開する。**要望5（コメビュ側）**を満たす。

## 現在の前提（調査結果）

- 一覧描画は [`CommentList.tsx`](../../apps/desktop/src/screens/comment-viewer/CommentList.tsx)（表示専用・`ref` を持たない・
  `<ol className={styles.list}>` に `comments.map(...)` で並べるだけ）。スクロール制御は無い
  （`screens/comment-viewer/` に `scrollTop`/`scrollHeight`/`scrollIntoView`/`scrollTo` は 0 件）。
- 新着は [`mergeComments.ts`](../../apps/desktop/src/features/comment-viewer/mergeComments.ts) の `mergeComments()` で
  **末尾に append**（＋id 重複排除＋上限 `MAX_COMMENTS = 200` で古い方を捨てる）。**最新はリスト下端**に来る前提。
- 反映は [`CommentViewerApp.tsx`](../../apps/desktop/src/screens/comment-viewer/CommentViewerApp.tsx) の `onComments`
  （`setComments(prev => { const {next, added} = mergeComments(prev, incoming); ... })`）。`added` は新規分（追従カウントに使える）。
- スクロールは CSS のみ: `.list` は `flex:1; overflow-y:auto;`
  （[`CommentViewerApp.module.css`](../../apps/desktop/src/screens/comment-viewer/CommentViewerApp.module.css) 174-184行）。

## このタスクでやること

### (1) 追従ロジック（下端追従／解除判定）

- スクロールコンテナ（`.list` の `<ol>`）へ `ref` を持たせる。**下端付近（例: `scrollHeight - scrollTop - clientHeight`
  が閾値以下）にいる間は「追従中」**とし、新着 `added` が来たら最下部へスクロール（`el.scrollTop = el.scrollHeight`）。
- **ユーザーが閾値を超えてスクロールアップしたら「追従解除」**。解除中は自動スクロールしない。判定は `onScroll` で行い、
  追従状態（`following: boolean`）と解除後の新着カウント（`unseenCount: number`）を state で持つ。
- 再利用性: この追従判定を **`CommentList` 内の小フック（例 `useFollowScroll(ref, { mode })`）** か、`CommentList` の
  内部ロジックとして実装する。034b がこれを**常時追従モード**（解除・ボタン無し）で再利用できる形にする（親 034 の依存）。

### (2) 「最新コメント N件 ↓」ジャンプボタン

- **追従解除中のみ**、一覧の下部中央に**半透過の黒い長丸ボタン**を重ねて表示（例: `position:absolute; bottom; 角丸 pill;
  `background: rgba(0,0,0,.6)` 相当・白文字）。文言は **「最新コメント {N}件 ↓」**（N＝解除後に増えた件数 `unseenCount`）。
- クリックで**最下部へスクロール＋追従再開＋`unseenCount` を 0 リセット**。追従中は非表示。
- CSS は [`CommentViewerApp.module.css`](../../apps/desktop/src/screens/comment-viewer/CommentViewerApp.module.css) に
  追加（`.list` を含むラッパを `position:relative` にしてボタンを重ねる）。

## このタスクでやらないこと

- **オーバーレイ側の追従・スクロールバー抑止（034b）**。本タスクはコメビュ本体（`comment-viewer`）のみ。
- `mergeComments`/上限 200 件・sidecar・WS・Rust command の変更（下端 append 前提をそのまま活用）。
- 仮想スクロール（react-window 等）導入などの大規模改修・新規依存追加。
- 設定ビュー・VOICEVOX・OBS 開閉/デザイン（034c〜e）。

## セキュリティ制約（docs/security.md 準拠）

- frontend のスクロール/DOM 制御と CSS 追加のみ。OS 操作・ファイル操作・プロセス操作・外部通信を増やさない（§1/§2/§4/§5）。
- 新しい Tauri command / capability / 依存を追加しない（§3/§10）。`csp: null` 不変。取得コメント本文はログ/DB に出さない（既存踏襲）。

## 完了条件

- 下端にいる間は新着で自動的に最下部へ追従する。
- 閾値を超えてスクロールアップすると追従が解除され、自動スクロールが止まる。
- 解除中は「最新コメント N件 ↓」の半透過黒長丸ボタンが下部に出て、N が解除後の新着件数で更新される。
- ボタンのクリックで最下部へスクロールし追従が再開、カウントが 0 に戻る。
- 既存の取得・読み上げ・レイアウトに退行がない。
- 新しいライブラリ / Tauri command / capability を追加していない。`csp: null` 不変。
- `pnpm --filter ./apps/desktop typecheck` / `lint` が通る。[`docs/progress.md`](../progress.md) が更新されている。

## 確認コマンド

```bash
git diff --stat
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
pnpm --filter ./apps/desktop tauri dev   # 新着で最下部追従／スクロールアップで解除＋ボタン表示／N 更新／クリックで最下部＋追従再開を目視
```
