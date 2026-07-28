# 046a コメビュ本体のコメント固定（右クリック→上部固定＋ピンストア）

> 状態: **実装済み（2026-07-28）**。分割・線引きは親 [046](046-pinned-comment-overlay.md) を正とする。
> 実装結果・**ピンストアの JSON スキーマ（046b が読む契約）**・設計判断の根拠は [`docs/progress.md`](../progress.md) の 046a 節を正とする。
>
> **実装時に確定／本文から変更した点**（本文は当初計画のまま残してあるので、食い違う場合は下記が正）:
> - **上限 N＝1（単一ピン）**。親 046 の初期案「例 3」から変更（YouTube / Twitch のコメント固定と同じ体験にする、という依頼者の決定）。親 046 の該当節も更新済み。
> - **保存型は `PinnedComment`**（`CommentViewDto` から `author.avatar` を除いた部分型）で、`loadPinned(): PinnedComment[]`。
>   下記 (1) の「`loadPinned(): CommentViewDto[]`」と保存フィールドの列挙は誤り＝`CommentViewDto` は `publishedAt` が必須で、
>   列挙どおりに削ると型を名乗れず、`monthCount`/`giftCount`/`tier` を落とすと `composeEventMessage` の要約文言が劣化する。
> - **`author.avatar` は保存しない**（base64 data URI・容量と `storage` ペイロード・§9）。046b のアイコンは 036a のイニシャルフォールバックになる。
> - **固定解除は右クリックメニューのみ**（実機確認後の修正）。下記 (3) の「各項目に『固定解除』導線を付ける」を**ボタンではなく右クリック**で実装している。
>   固定帯とコメント一覧の間には divider（`--border-soft`・ツールバーと同色）を引く。
>

> **必読前提**: 親 [046](046-pinned-comment-overlay.md)、コメント描画 [`CommentList.tsx`](../../apps/desktop/src/screens/comment-viewer/CommentList.tsx)、
> 設定永続化の手本 [`overlaySettings.ts`](../../apps/desktop/src/features/comment-viewer/overlaySettings.ts)、
> ワイヤ型 [`CommentViewDto`](../../apps/desktop/src/features/comment-viewer/bindings/CommentViewDto.ts)、[`docs/security.md`](../security.md)（§9）。
> CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。**frontend のみ**＝**軽レビュー**。

## 目的

配信者がコメントを**右クリックで選んで上部に固定**でき、固定を解除できるようにする（要望③前半）。固定内容は
**専用オーバーレイ（046b）が読むためのピンストア（localStorage）**にも保存し、本体上部にも固定表示する。

## 現在の前提（調査結果・実コード）

> 行番号は **2026-07-28 の実装完了後**の値（着手前の値は 045a/045b/045c 実装で `CommentViewerApp.tsx` 側が 100 行前後ずれていた）。
> **レビュー対応（2026-07-28）**: `CommentViewerApp.tsx` 側は保存 effect ブロック（7 行）を足す前の値のままだったため、現物に合わせて再修正した。
> 以後もずれるので、**行番号ではなくシンボル名で特定**すること。

- コメント行は [`CommentList.tsx`](../../apps/desktop/src/screens/comment-viewer/CommentList.tsx) の `renderDefaultItem`（159-250 行）。
  - 左クリック導線 `onSelect`（prop 106 行・分割代入 134 行）で視聴者詳細を開く。**右クリックは 046a で `onContextMenu`（194 行〜）を追加**し、`onPin`（120 行）/`pinnedIds`（125 行）で親へ渡す。
  - 一意キーは `c.id`（176 行）。行 DTO は `CommentViewDto`（id/source/author/text/publishedAt/eventType/monetary/monetaryAmount 等）。
- 一覧は [`CommentViewerApp.tsx`](../../apps/desktop/src/screens/comment-viewer/CommentViewerApp.tsx) の `commentSplit`（1191 行〜）で `CommentList`（1198 行〜）を描く。上部にはツールバー（935 行〜）＋クレジット（1148 行〜）＋ENGINE バナー（1162 行〜）＋**固定帯 `PinnedCommentBar`（1185 行）**が並ぶ。
- 永続化パターン: [`overlaySettings.ts`](../../apps/desktop/src/features/comment-viewer/overlaySettings.ts)（名前空間 `stream-dock.comment-viewer.*`・localStorage 直 read/write・例外握りつぶし）と、
  `CommentViewerApp` の `useState(()=>load*())`＋`useEffect(()=>save*(x),[x])`（固定コメントは `pinned` の useState が 344 行 / `savePinned` の effect が 424-426 行）＝新設定の手本。

## このタスクでやること

### (1) ピンストア（localStorage）

- 新規 `features/comment-viewer/pinnedComments.ts` を追加（`overlaySettings.ts` と同方式）。
  - キー `stream-dock.comment-viewer.pinned-comments`（JSON 配列）。**実装は `PinnedComment`＝`CommentViewDto` から `author.avatar` を除いた部分型を丸ごと保存**する
    （publishedAt・monthCount/giftCount/tier も含む。冒頭の注記参照。スキーマ全文は progress.md の 046a 節）。
  - `loadPinned(): PinnedComment[]` / `savePinned(list)` / `toPinned(dto)` / 上限 `PINNED_LIMIT`（**実装は 1＝単一ピン**）で新しい順にクランプ。例外は握りつぶし（表示は継続）。
- **非機密の表示データのみ**を保存する（OAuth トークン等は載せない）。外部送信しない。

### (2) 右クリックメニュー＋固定/固定解除

- [`CommentList.tsx`](../../apps/desktop/src/screens/comment-viewer/CommentList.tsx) の `renderDefaultItem`（159-250 行）に `onContextMenu` を足し、`onPin?(comment)` prop（`onSelect` と同型の任意 prop・**実装ではトグル**）で押されたコメントを親へ渡す。
  - 「固定済みか」は `pinnedIds?: ReadonlySet<string>`（`badges` と同じ「id で引く任意 prop」の作法）で子へ渡し、メニュー文言を出し分ける。
  - コンテキストメニュー UI は小さな自作メニュー（「上部に固定」/「固定解除」）。既存に汎用メニュー基盤は無いため、この機能内で完結する軽量メニュー（外側クリック/Esc で閉じる）を追加する＝**新規 [`CommentContextMenu.tsx`](../../apps/desktop/src/screens/comment-viewer/CommentContextMenu.tsx)**。overlay バリアントには効かない（`variant==="overlay"` は非インタラクティブのまま）。
  - `e.preventDefault()`（ネイティブメニュー抑止）は**この行の `onContextMenu` だけ**で、しかも `onPin` 指定時のみ。アプリ全体のコンテキストメニューは潰さない。
- [`CommentViewerApp.tsx`](../../apps/desktop/src/screens/comment-viewer/CommentViewerApp.tsx) に `pinned` state（`useState(()=>loadPinned())`）＋永続化 `useEffect(()=>savePinned(pinned),[pinned])` を追加し、固定/解除ハンドラを `CommentList` の `onPin` に渡す。

### (3) 本体上部の固定表示

- `commentSplit`（1191 行）より上（クレジット/ENGINE バナーの直下）に**固定コメント帯**を新設し、`pinned` を新しい順に表示する＝**新規 [`PinnedCommentBar.tsx`](../../apps/desktop/src/screens/comment-viewer/PinnedCommentBar.tsx)**（0 件なら null を返し既存レイアウトは不変）。
- **解除導線は帯の項目の右クリックメニュー**（実機確認後の修正・2026-07-28 で「固定解除」ボタンから変更）。一覧側の行を右クリックしても解除できるが、一覧は `MAX_COMMENTS`(=200) でクランプされるため固定が流れ去ると解除対象そのものが消える＝帯の側にも導線が要る。メニューは [`CommentContextMenu`](../../apps/desktop/src/screens/comment-viewer/CommentContextMenu.tsx) を再利用（新規依存ゼロ）。キーボード用に項目へ `tabIndex={0}` を付け Shift+F10 / メニューキーで開けるようにする。
- 意匠は本体の既存トークン/クラス（`styles.item`/`.badge`/`.amount` 等）を流用し、課金種別なら 043b と同じラベル/金額（[`viewerFormat.ts`](../../apps/desktop/src/screens/comment-viewer/viewerFormat.ts) の `eventLabel`/`displayEventType`/`isMonetaryEvent`/`composeEventMessage`/`providerLabel`）を再利用する（重複実装しない）。
- 長文スパチャを固定してもコメント一覧が潰れないよう、帯には `max-height: 22vh; overflow-y: auto` を付ける。
- 帯とコメント一覧の境目に **divider**（`border-bottom: 1px solid var(--border-soft)`＝`.toolbar` と同じ役割トークン）。線をツールバーと同じ幅（窓幅いっぱい）にするため、左右のインセットは margin ではなく padding で持つ。

## このタスクでやらないこと

- **固定専用オーバーレイ窓の新設**（046b）。窓間伝達の受け側（046b）。既存 `comment-overlay` の変更。
- 課金チャットの横スクロール表示（047）。視聴者メモリ（038）への保存。**新規外部通信・WS・Rust・依存・capability の追加**。

## セキュリティ制約（docs/security.md 準拠）

- **frontend のみ**（localStorage の非機密表示データ＋表示分岐）。外部通信宛先・API・capability・依存を増やさない（§1/§3/§10）。`csp: null` 不変。
- 固定コメント（本文・名前・金額）を **Rust の DB/ログに出さない・外部送信しない**（§9・既存踏襲）。localStorage の非機密 UI データに限る。

## 完了条件

- コメントを右クリック→「上部に固定」で本体上部に固定表示され、**固定帯の項目を右クリック→「固定解除」**で外れる（一覧側の行の右クリックでも解除できる）。上限 `PINNED_LIMIT`（=1）を超えると最古が押し出される（＝別のコメントを固定すると置き換わる）。
- 固定帯とコメント一覧の間に divider が出る（固定 0 件のときは帯ごと消えるので線も出ない）。
- ピンストア（localStorage）に保存され、窓の再オープンで復元する。046b が読める形式（JSON 配列）で保存されている。
- 課金種別の固定は種別ラベル＋金額が表示される（既存 util 流用）。通常 chat の表示・既存の左クリック導線（視聴者詳細）は壊れない。
- 新規宛先/API/capability/依存の追加が無い。`csp: null` 不変。
- `pnpm --filter ./apps/desktop typecheck` / `lint` が通る。[`docs/progress.md`](../progress.md) を更新。

## 確認コマンド

```bash
git diff --stat
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
pnpm --filter ./apps/desktop test        # 既存テストの非退行（新 prop はすべて optional）＋ 046a の追加分

# 通信面・Rust がゼロ拡大であることの担保（差分ゼロが期待値）
git status --short -- apps/desktop/src-tauri/ apps/comment-sidecar/ apps/desktop/package.json

pnpm --filter ./apps/desktop tauri dev   # 右クリックで固定/解除・上部に出る・別コメント固定で置き換わる・再オープンで復元・左クリック詳細が壊れない、を目視
```

## 実装後に必要なレビュー

- 軽レビュー: frontend のみで外部通信宛先・API・capability・依存が不変であること、固定コメントを DB/ログに出さず外部送信しないこと、
  既存の `onSelect`（視聴者詳細）と overlay バリアントを壊していないことを確認する。
