# 046a コメビュ本体のコメント固定（右クリック→上部固定＋ピンストア）

> 状態: **未着手（実装サブタスク）**。分割・線引きは親 [046](046-pinned-comment-overlay.md) を正とする。
>
> **必読前提**: 親 [046](046-pinned-comment-overlay.md)、コメント描画 [`CommentList.tsx`](../../apps/desktop/src/screens/comment-viewer/CommentList.tsx)、
> 設定永続化の手本 [`overlaySettings.ts`](../../apps/desktop/src/features/comment-viewer/overlaySettings.ts)、
> ワイヤ型 [`CommentViewDto`](../../apps/desktop/src/features/comment-viewer/bindings/CommentViewDto.ts)、[`docs/security.md`](../security.md)（§9）。
> CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。**frontend のみ**＝**軽レビュー**。

## 目的

配信者がコメントを**右クリックで選んで上部に固定**でき、固定を解除できるようにする（要望③前半）。固定内容は
**専用オーバーレイ（046b）が読むためのピンストア（localStorage）**にも保存し、本体上部にも固定表示する。

## 現在の前提（調査結果・実コード）

- コメント行は [`CommentList.tsx`](../../apps/desktop/src/screens/comment-viewer/CommentList.tsx) の `renderDefaultItem`（128-195 行）。
  - 左クリック導線 `onSelect`（prop 101 行・分割代入 116 行・付与 138/148-160 行）で視聴者詳細を開く。**右クリック（`onContextMenu`）は未使用**（全 src で該当ゼロ）。
  - 一意キーは `c.id`（145 行）。行 DTO は `CommentViewDto`（id/source/author/text/eventType/monetary/monetaryAmount 等）。
- 一覧は [`CommentViewerApp.tsx`](../../apps/desktop/src/screens/comment-viewer/CommentViewerApp.tsx) の `commentSplit`（1036 行〜）で `CommentList`（1043-1048 行）を描く。上部にはツールバー（828 行〜）＋クレジット（997-1006 行）＋ENGINE バナー（1011-1030 行）が既にある。
- 永続化パターン: [`overlaySettings.ts`](../../apps/desktop/src/features/comment-viewer/overlaySettings.ts)（名前空間 `stream-dock.comment-viewer.*`・localStorage 直 read/write・例外握りつぶし）と、
  `CommentViewerApp` の `useState(()=>load*())`＋`useEffect(()=>save*(x),[x])`（例: 315-378 行）＝新設定の手本。

## このタスクでやること

### (1) ピンストア（localStorage）

- 新規 `features/comment-viewer/pinnedComments.ts` を追加（`overlaySettings.ts` と同方式）。
  - キー `stream-dock.comment-viewer.pinned-comments`（JSON 配列）。保存/読込で `CommentViewDto` の表示に必要なフィールドを持つ（本文・名前・source・event_type・monetary・monetaryAmount・id）。
  - `loadPinned(): CommentViewDto[]` / `savePinned(list)` / 上限 N（親 046 の既定＝例 3）で新しい順にクランプ。例外は握りつぶし（表示は継続）。
- **非機密の表示データのみ**を保存する（OAuth トークン等は載せない）。外部送信しない。

### (2) 右クリックメニュー＋固定/固定解除

- [`CommentList.tsx`](../../apps/desktop/src/screens/comment-viewer/CommentList.tsx) の `renderDefaultItem`（128-195 行）に `onContextMenu` を足し、`onPin?(comment)` prop（`onSelect` と同型の任意 prop）で押されたコメントを親へ渡す。
  - コンテキストメニュー UI は小さな自作メニュー（「上部に固定」/「固定解除」）。既存に汎用メニュー基盤は無いため、この機能内で完結する軽量メニュー（外側クリック/Esc で閉じる）を追加する。overlay バリアントには効かない（`variant==="overlay"` は非インタラクティブのまま）。
- [`CommentViewerApp.tsx`](../../apps/desktop/src/screens/comment-viewer/CommentViewerApp.tsx) に `pinned` state（`useState(()=>loadPinned())`）＋永続化 `useEffect(()=>savePinned(pinned),[pinned])` を追加し、固定/解除ハンドラを `CommentList` の `onPin` に渡す。

### (3) 本体上部の固定表示

- `commentSplit`（1036 行）より上（クレジット/バナーの近傍）に**固定コメント帯**を新設し、`pinned` を新しい順に表示する。各項目に「固定解除」導線を付ける。
- 意匠は本体の既存トークン/クラス（`styles.item`/`.badge`/`.amount` 等）を流用し、課金種別なら 043b と同じラベル/金額（[`viewerFormat.ts`](../../apps/desktop/src/screens/comment-viewer/viewerFormat.ts) の `eventLabel`/`isMonetaryEvent` 等）を再利用する（重複実装しない）。

## このタスクでやらないこと

- **固定専用オーバーレイ窓の新設**（046b）。窓間伝達の受け側（046b）。既存 `comment-overlay` の変更。
- 課金チャットの横スクロール表示（047）。視聴者メモリ（038）への保存。**新規外部通信・WS・Rust・依存・capability の追加**。

## セキュリティ制約（docs/security.md 準拠）

- **frontend のみ**（localStorage の非機密表示データ＋表示分岐）。外部通信宛先・API・capability・依存を増やさない（§1/§3/§10）。`csp: null` 不変。
- 固定コメント（本文・名前・金額）を **Rust の DB/ログに出さない・外部送信しない**（§9・既存踏襲）。localStorage の非機密 UI データに限る。

## 完了条件

- コメントを右クリック→「上部に固定」で本体上部に固定表示され、「固定解除」で外れる。上限 N を超えると最古が押し出される。
- ピンストア（localStorage）に保存され、窓の再オープンで復元する。046b が読める形式（JSON 配列）で保存されている。
- 課金種別の固定は種別ラベル＋金額が表示される（既存 util 流用）。通常 chat の表示・既存の左クリック導線（視聴者詳細）は壊れない。
- 新規宛先/API/capability/依存の追加が無い。`csp: null` 不変。
- `pnpm --filter ./apps/desktop typecheck` / `lint` が通る。[`docs/progress.md`](../progress.md) を更新。

## 確認コマンド

```bash
git diff --stat
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
pnpm --filter ./apps/desktop tauri dev   # 右クリックで固定/解除・上部に出る・上限で押し出し・再オープンで復元・左クリック詳細が壊れない、を目視
```

## 実装後に必要なレビュー

- 軽レビュー: frontend のみで外部通信宛先・API・capability・依存が不変であること、固定コメントを DB/ログに出さず外部送信しないこと、
  既存の `onSelect`（視聴者詳細）と overlay バリアントを壊していないことを確認する。
