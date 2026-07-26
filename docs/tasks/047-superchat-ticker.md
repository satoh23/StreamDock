# 047 課金チャット 横スクロールティッカー＋クリック展開

> 状態: **未着手（単体タスク）**。親子分割はしない（ティッカー表示とクリック展開ダイアログは一体の UI 機能）。
>
> **必読前提**: 課金判定/整形の既存 util [`viewerFormat.ts`](../../apps/desktop/src/screens/comment-viewer/viewerFormat.ts)、本体描画 [`CommentList.tsx`](../../apps/desktop/src/screens/comment-viewer/CommentList.tsx)・
> 本体 [`CommentViewerApp.tsx`](../../apps/desktop/src/screens/comment-viewer/CommentViewerApp.tsx)、投げ銭強調 [043b](043b-monetary-emphasis-in-viewer.md)（本体の枠色/ラベル・共存させる）、
> [`docs/security.md`](../security.md)（§1）。CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。**frontend のみ**＝**軽レビュー**。

## 目的

課金チャット（スパチャ/ビッツ/サブスク/メンシプ/ギフト/ドネーション/ジュエル）を、**YouTube のチャット欄のように上部へ横スクロールで小さく並べ**、
**クリックするとダイアログのように重なって全文が開く** UI をコメビュ本体に追加する（要望④）。流れて消えるコメント一覧の中で投げ銭を配信者が見失わないための常時表示。

## 現在の前提（調査結果・実コード）

- 受信コメントは [`CommentViewerApp.tsx`](../../apps/desktop/src/screens/comment-viewer/CommentViewerApp.tsx) の `comments` state（`CommentViewDto[]`・`CommentList` に 1043-1048 行で渡す）。上部は `toolbar`（828 行〜）＋クレジット（997-1006 行）＋ENGINE バナー（1011-1030 行）＋`commentSplit`（1036 行〜）の縦積み。
- 課金判定/整形は [`viewerFormat.ts`](../../apps/desktop/src/screens/comment-viewer/viewerFormat.ts) に既存（**流用・重複実装しない**）:
  - `isMonetaryEvent(eventType)`（51-52 行・chat/未知は false）＝ティッカー対象の抽出条件。
  - `displayEventType(c)`（63-66 行・BITS を "bits" 振替）／`eventLabel(...)`（34-35 行）＝種別ラベル。
  - `superchatTier(amount, currency)`（94-105 行）＝スパチャ金額ティア（配色に流用可）。`composeEventMessage(c)`（120-139 行）＝金額なし種別の要約文。金額は `c.monetaryAmount`（整形済み）を優先表示。
- 既存の投げ銭強調（043b）は**本体一覧の行**を枠色＋ラベル＋金額で強調する（`renderDefaultItem` 128-195 行）。本タスクの「上部の常時ティッカー」は別レイヤで**共存**させる（一覧側は据え置き）。
- overlay 側の投げ銭カード意匠（043c）は [`OverlayComment.module.css`](../../apps/desktop/src/screens/comment-viewer/OverlayComment.module.css) にあり、配色トークンの参考にできる（**本タスクは本体側 UI で OBS オーバーレイではない**）。
- 全幅の重ねパネル意匠は既存に手本がある（視聴者詳細の全幅オーバーレイ・`CommentViewerApp.module.css` 内の detail 系クラス、`detailPane` 1050-1059 行）。クリック展開ダイアログの土台として参考にできる。

## このタスクでやること

### (1) 上部の横スクロールティッカー（本体のみ）

- [`CommentViewerApp.tsx`](../../apps/desktop/src/screens/comment-viewer/CommentViewerApp.tsx) の `commentSplit`（1036 行）より上に、`comments.filter(c => isMonetaryEvent(c.eventType))` を**横スクロールの帯**で表示する新コンポーネント（例 `screens/comment-viewer/SuperchatTicker.tsx`）を追加する。
  - 各項目は小型ピル（種別ラベル＋名前＋金額＝`eventLabel(displayEventType(c))` / `c.author.name` / `c.monetaryAmount`）。スパチャは `superchatTier` で配色（既存トークン流用）。
  - 横スクロール（`overflow-x: auto`）で新しい課金が右（または左）に積まれる。件数 0 のときは帯を出さない（場所を取らない）。
- **046a の固定コメント帯と上部レイアウトが競合しないよう**、縦の並び順（固定帯／課金ティッカー／一覧）を決めて配置する（両機能が同時にあっても崩れないこと）。

### (2) クリックで重ねダイアログ展開

- ティッカーのピルをクリックすると、そのコメントの**全文**（種別ラベル・名前・金額・`composeEventMessage`・本文 `c.text`）を**重ねダイアログ**（モーダル/全幅オーバーレイ）で表示する。既存の重ねパネル意匠を土台に、外側クリック/Esc/閉じるボタンで閉じる。
- 選択状態は本体のローカル state（選択中の `comment.id`）で保持する。

## このタスクでやらないこと

- **OBS オーバーレイ側の変更**（043c が overlay の投げ銭カードを担当・本タスクは配信者が見る本体 UI）。本体一覧の投げ銭強調（043b）の変更。
- 通貨換算・投げ銭の集計/履歴（038 の領分）。取得側（sidecar/wire/Rust）の変更。**新規外部通信・API・capability・依存の追加**。

## セキュリティ制約（docs/security.md 準拠）

- **frontend の表示追加のみ**（既に受信済みの `comments` を別レイアウトで再描画するだけ）。外部通信宛先・API・capability・依存を増やさない（§1/§3/§10）。`csp: null` 不変。
- 取得コメント（本文・金額）を Rust の DB/ログに出さない・外部送信しない（§9・既存踏襲）。

## 完了条件

- 課金チャットが上部に横スクロールで小さく常時表示され、クリックで全文が重ねダイアログで開く（外側クリック/Esc/閉じるで閉じる）。
- 通常 chat はティッカーに出ない。件数 0 で帯が出ない。046a の固定帯と同時でも上部レイアウトが崩れない。
- 043b（本体一覧の強調）・043c（overlay）と共存し、既存表示が壊れない。新規宛先/API/capability/依存の追加が無い。`csp: null` 不変。
- `pnpm --filter ./apps/desktop typecheck` / `lint` が通る。[`docs/progress.md`](../progress.md) を更新。

## 確認コマンド

```bash
git diff --stat
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
pnpm --filter ./apps/desktop tauri dev   # 課金（superchat/bits/subscription/membership/gift/donation/jewels）のダミー/実コメントで
                                         #   上部ティッカーに小さく並ぶ・横スクロールできる・クリックで重ね表示・chat は出ない、を目視
```

## 実装後に必要なレビュー

- 軽レビュー: frontend 表示追加のみで外部通信宛先・API・capability・依存が不変であること、コメント本文/金額を DB/ログに出さず外部送信しないこと、
  043b/043c と既存一覧の表示を壊していないことを確認する。
