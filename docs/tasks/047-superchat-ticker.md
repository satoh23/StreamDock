# 047 課金チャット 横スクロールティッカー＋クリック展開

> 状態: **実装済み（2026-07-29）**。記録は [`docs/progress.md`](../progress.md) の「047 課金チャットの常時ティッカー」節。
>
> **実装が本タスクファイルと異なる点（progress.md が正）**:
> - コンポーネント名は **`MonetaryTicker`**（本文の例 `SuperchatTicker` から変更）。対象は superchat 以外 6 種を含み、
>   既存語彙 `isMonetaryEvent` / `MONETARY_EVENT_TYPES` に揃えたため。全文ダイアログは `MonetaryDetailDialog`。
> - 元データは **`comments` から導出しない**。`comments` は `MAX_COMMENTS = 200` でクランプされるため、
>   200 件流れるとティッカーから投げ銭が消える（機能の目的を壊す）。新規純関数
>   [`monetaryFeed.ts`](../../apps/desktop/src/screens/comment-viewer/monetaryFeed.ts) が**課金だけを別に蓄積**する
>   （上限 50・最新が先頭・jewels combo 更新に追随・**永続しない**）。
> - ダイアログの土台は `detailPane` ではなく **ネイティブ `<dialog>` ＋ `showModal()`**（`ConfirmDialog` と同じ idiom）。
>   focus trap/Esc/backdrop が新規依存ゼロで付き、top-layer なので z-index 競合が起きないため。
> - ~~**ティア配色（`superchatTier`）は使っていない**。未読/既読の色信号（未読＝赤枠）と競合するため。~~
>   → **047b（2026-07-29）で撤回。ティア配色を採用した。** 実機で「見にくい・額で色分けしてほしい・枠でなく
>   塗りつぶしてほしい」となり、依頼者の決定で**未読/既読を減光＋✓へ移して色チャネルを空けた**ため、
>   `MonetaryTicker.tsx` に書いてあった再修正トリガーどおり反転した（＝タスクファイルの当初仕様に戻った）。
>   ティッカーのピルは **YouTube 厳守＝ティア色の塗りつぶし・アイコン＋金額のみ**。
> - **既読マーク（✓）を追加**（依頼者の追加要望・本文には無い）。既読は**減光＋✓**（047b 以前は未読＝赤枠）。
> - 上部の並び順は `toolbar` → クレジット → ENGINE バナー → **ティッカー** → 固定帯（046a） → 一覧。
> - **047b の追加変更**: 帯は「固定ラベル（投げ銭／未読 N）＋横スクロールトラック」の 2 ブロック構成
>   （sticky での貼り付けは角丸が下のピルを隠しきれず破綻したため）。**本体コメント一覧の課金行も
>   OBS と同じティア色フルカード**へ変更（043b の赤枠を置換）。固定帯（046a）も追従。
>   詳細は progress.md の「047b 課金コメントの YouTube 意匠化」節。
> - **047b の退行 → 047c（2026-07-29）で修正済み**:
>   フルカードに付けた `overflow: hidden` が flex の自動最小高さを 0 にし、**コメントが流れるほど課金カードだけが
>   潰れて最後は線になる**（このリポジトリで 3 回目の同一バグ）。原因と対処は末尾の 047c 節を正とする。
> - **ティッカー帯の崩れ → 047d（2026-07-29）で修正済み**:
>   横オーバーフローが始まると `.tickerTrack` の横スクロールバーが**トラックの内側 15px を食い**、
>   `overflow-y: hidden` が 30px のピルを上下から切り落としていた（**ピルが四角くなる**のがその signature）。
>   対処＝スクロールバーを非表示にして縦を食わせない。原因と対処は末尾の 047d 節を正とする。
>
> **必読前提**: 課金判定/整形の既存 util [`viewerFormat.ts`](../../apps/desktop/src/screens/comment-viewer/viewerFormat.ts)、本体描画 [`CommentList.tsx`](../../apps/desktop/src/screens/comment-viewer/CommentList.tsx)・
> 本体 [`CommentViewerApp.tsx`](../../apps/desktop/src/screens/comment-viewer/CommentViewerApp.tsx)、投げ銭強調 [043b](043b-monetary-emphasis-in-viewer.md)（本体の枠色/ラベル・共存させる）、
> [`docs/security.md`](../security.md)（§1）。CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。**frontend のみ**＝**軽レビュー**。

## 目的

課金チャット（スパチャ/ビッツ/サブスク/メンシプ/ギフト/ドネーション/ジュエル）を、**YouTube のチャット欄のように上部へ横スクロールで小さく並べ**、
**クリックするとダイアログのように重なって全文が開く** UI をコメビュ本体に追加する（要望④）。流れて消えるコメント一覧の中で投げ銭を配信者が見失わないための常時表示。

## 現在の前提（調査結果・実コード）

> 行番号は **実装後（2026-07-29）の実測値に更新済み**。執筆時の値は 046a〜046d ＋本タスクで 300 行以上ずれていた。
> 参照はできるだけ**シンボル名**で行うこと。

- 受信コメントは [`CommentViewerApp.tsx`](../../apps/desktop/src/screens/comment-viewer/CommentViewerApp.tsx) の `comments` state（`CommentViewDto[]`・`CommentList` に 1438 行で渡す）。上部は `toolbar`（1162 行〜）＋クレジット（1375 行〜）＋ENGINE バナー（1389 行〜）＋**課金ティッカー（1416 行〜・047）**＋固定帯（1425 行・046a）＋`commentSplit`（1431 行〜）の縦積み。
- 課金判定/整形は [`viewerFormat.ts`](../../apps/desktop/src/screens/comment-viewer/viewerFormat.ts) に既存（**流用・重複実装しない**）:
  - `isMonetaryEvent(eventType)`（51 行・chat/未知は false）＝ティッカー対象の抽出条件。
  - `displayEventType(c)`（63 行・BITS を "bits" 振替）／`eventLabel(...)`（34 行）＝種別ラベル。
  - `superchatTier(amount, currency)`（94 行）＝スパチャ金額ティア（**047 では使わなかった**・冒頭の逸脱を参照）。`composeEventMessage(c)`（133 行）＝金額なし種別の要約文。金額は `c.monetaryAmount`（整形済み）を優先表示。
- 既存の投げ銭強調（043b）は**本体一覧の行**を枠色＋ラベル＋金額で強調する（`renderDefaultItem` 159 行〜）。本タスクの「上部の常時ティッカー」は別レイヤで**共存**させる（一覧側は据え置き＝差分ゼロ）。
- ⚠ `comments` は [`mergeComments.ts`](../../apps/desktop/src/features/comment-viewer/mergeComments.ts) の `MAX_COMMENTS = 200` でクランプされる。**ここから導出すると 200 件流れた時点でティッカーが空になる**ため、047 は課金だけを別に蓄積する（`monetaryFeed.ts`）。
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
pnpm --filter ./apps/desktop test        # 20 files / 269 tests（047 で monetaryFeed +10 / MonetaryTicker +12）
pnpm --filter ./apps/desktop tauri dev   # 課金（superchat/bits/subscription/membership/gift/donation/jewels）のダミー/実コメントで
                                         #   上部ティッカーに小さく並ぶ・横スクロールできる・クリックで重ね表示・chat は出ない、を目視
                                         #   ＋ 展開したピルに ✓ が付く・「未読 N」が減る（既読マーク）

# ゼロ拡大の担保（差分ゼロが期待）
git status --short -- apps/desktop/src-tauri/ apps/comment-sidecar/ apps/desktop/package.json \
  apps/desktop/src/screens/comment-viewer/OverlayApp.tsx \
  apps/desktop/src/screens/comment-viewer/PinnedOverlayApp.tsx \
  apps/desktop/src/screens/comment-viewer/PinnedCommentBar.tsx
grep -nE "#[0-9a-fA-F]{3,8}|rgba?\(" apps/desktop/src/screens/comment-viewer/CommentViewerApp.module.css
```

## 実装後に必要なレビュー

- 軽レビュー: frontend 表示追加のみで外部通信宛先・API・capability・依存が不変であること、コメント本文/金額を DB/ログに出さず外部送信しないこと、
  043b/043c と既存一覧の表示を壊していないことを確認する。

---

# 047c: 課金カードが潰れる不具合の修正

> 状態: **実装済み（2026-07-29）**。記録は [`docs/progress.md`](../progress.md) の「047c 課金カードが flex で潰れる不具合」節。
>
> 依頼者の実機報告（1 回目）: 「**チャット一覧にチャットがたくさん流れると、課金チャットが潰れて UI が崩れる。
> おそらくそれが影響して、課金チャットの列が潰れることがある**」。
>
> 依頼者の実機報告（2 回目）: 「**コメントが追加されるたびに課金チャットのカードがどんどん潰れていって
> 最終的に線になります**」。—— この記述が真因の決め手になった（下の「時間発展が signature になった」参照）。
>
> **実装が本節の当初計画と異なる点**:
> - **ガードテストは入れられなかった**。CSS ソースを読んで `.item` に `flex-shrink: 0` があることを assert する
>   案を実際に書いたが、**`?raw` が CSS モジュールに効かない**（Vite の CSS modules 処理が先に走り `{}` を返す。
>   vitest は既定で CSS を処理しないので `?inline` も空文字）。`node:fs` ＝ **`@types/node` の新規追加**が
>   必要になるため、依存を増やさない判断で見送った。代わりに **CSS コメントへ未カバーの理由と
>   「レビュー時は目視で確認すること」を明記**した。

## なぜ直すか

047b で本体コメント一覧の課金行を「ティア色フルカード」（`.itemTipCard`）へ変えた際に付けた
`overflow: hidden` が、**Flexbox の自動最小高さ（automatic minimum size）を 0 にする**というルールを踏み、
`.list`（`overflow-y: auto` の flex 縦積み）の中で**課金カードだけが縦に潰れる**状態になっている。

配信者が一番見逃してはいけない投げ銭が、コメントが流れるほど潰れて消える。
**047 の目的（投げ銭を見失わない）を正面から壊している**ため優先で直す。

## 原因（実コードで確定）

### 症状 A: 一覧の課金カードが潰れる —— **原因確定**

3 つのルールが噛み合って起きる。

| # | 場所 | 内容 |
|---|---|---|
| 1 | `CommentViewerApp.module.css` `.list` | `display:flex; flex-direction:column; overflow-y:auto; flex:1; min-height:0` |
| 2 | 同 `.item` | **`flex-shrink` 未指定＝既定 1**（縮む） |
| 3 | 同 `.item.itemTipCard` | **`overflow: hidden`**（047b で追加） |

Flexbox は子の `min-height: auto`（既定）を「内容ベースの自動最小サイズ」に解決するが、
**`overflow` が `visible` 以外の子ではこれが 0 になる**。したがって:

- **chat 行**（`.item` のみ・`overflow: visible`）→ 自動最小高さ＝内容高 → **実質縮まない**
- **課金カード**（`.item.itemTipCard`・`overflow: hidden`）→ 自動最小高さ＝**0** → **いくらでも縮む**

結果、一覧の総高が `.list` の可視高を超えた瞬間、
**はみ出し分（負の余白）がすべて課金カードだけに集中して配分される**。
`overflow:hidden` があるのでヘッダ帯も本文も切り落とされる。

### 時間発展が signature になった（2 回目の報告で真因が 1 つに絞れた）

> 「コメントが追加されるたびに**どんどん潰れていって最終的に線になります**」

| 観測 | flex-shrink バグでの説明 |
|---|---|
| **1 件増えるごとに少しずつ潰れる** | はみ出し量はコメント 1 件につき約 40px 増える。それを吸える子が課金カードしか無いので、**1 件ごとに約 40px ずつ課金カードだけが縮む**（一気に 0 にはならない） |
| **最終的に「線」になる** | 高さ 0 まで縮むと `.item` の `border: 1px solid` の上下だけが残る ＝ **2px の線**。`.itemTipCard` の `border-color` はティア色なので**ティア色の線**になる |
| **chat 行だけ無事** | chat 行は `overflow: visible` ＝自動最小高さが内容高になり、縮み配分の対象にならない |

「一定量ずつ縮む」＝負の余白の比例配分、「線になる」＝高さ 0 ＋ border という 2 つの signature が、
他の候補（クリップ・折り返し・スクロール）を全部落とした。
**静的なスクリーンショットより、時間発展の記述のほうが情報量が多かった。**

#### 同一原因・同一対処の先例がリポジトリ内に 2 つある（＝この対処が正しいことの裏取り）

- [`OverlayComment.module.css`](../../apps/desktop/src/screens/comment-viewer/OverlayComment.module.css) の `.item`（043c 追修正）
  —— **この現象がそのままコメントに書かれており**、対処は `flex-shrink: 0`。
  **OBS 側は既に直っていて、本体側にだけ入っていない。**
- `CommentViewerApp.module.css` の `.card`（035c）—— 「`overflow:hidden` のため flex 自動最小高さが 0 になり…
  内容をクリップしてしまう」と同文の経緯付きで `flex-shrink: 0` を入れてある。

### 症状 B: 固定コメント帯（046a）—— **同じ原因＋帯自身にも縮み止めが無い**

- `.pinnedBar` も `display:flex; flex-direction:column; max-height:22vh; overflow-y:auto`。
  子は `[styles.item, styles.pinnedItem]`（`PinnedCommentBar.tsx`）＋課金なら `.itemTipCard` なので、
  **一覧とまったく同じ潰れ方をする**（`.pinnedItem` は `cursor` しか持たない）。
- さらに `.pinnedBar` 自身が `.root`（flex 縦積み）の子で **`flex` 指定が無い**。
  `overflow-y:auto` ＝自身の自動最小高さも 0 なので、上部の段が窓高を超えると
  `.commentSplit`（`flex-basis: 0` ＝縮小配分の対象外）ではなく**この帯だけが 0 まで潰れる**。
  隣の `.tickerBar` は同じ理由で `flex: none` を明示済みで、**帯だけ対策が漏れている**。

### 症状 C: 上部の「投げ銭」ティッカー帯 —— **047c では原因未特定 → [047d](#047d-ティッカー帯が横溢れの瞬間にピルを切り落とす不具合) で解決**

047c の時点では `.tickerBar` に `flex: none`、`.tickerPill` に `flex: none`、`.tickerTrack` に `min-width: 0` が
あることまで確認でき、**A/B と同じ機構では潰れない**ところまでしか分からなかった。
推測で CSS を足さず、**まず A/B を直して実機で切り分ける**と決めた（原因が分からないまま指定を増やすと、
次に壊れたとき何が効いているか説明できなくなる）。

→ その切り分けで**別機構（横スクロールバー × `overflow-y: hidden`）と判明**した。詳細は末尾の 047d 節。

## やること（CSS 2 行・対象は 1 ファイル）

**対象ファイル: `apps/desktop/src/screens/comment-viewer/CommentViewerApp.module.css` のみ。**
TSX・ロジック・配色トークンには一切触らない。

### (1) `.item` に `flex-shrink: 0` を足す ＝ 根本原因

```css
.item {
  padding: 8px 10px;
  border-radius: 10px;
  background: var(--surface);
  border: 1px solid var(--border-soft);
  /* 047c(実機不具合): .list / .pinnedBar は overflow-y:auto の flex 縦積みなので、子が既定の flex-shrink:1 の
     ままだと「スクロールさせる」前に「子を縮める」。chat 行は overflow:visible ＝ flex 自動最小高さが内容高に
     なるため実質縮まないが、047b で入れた .item.itemTipCard は overflow:hidden で自動最小高さが 0 になり、
     **はみ出し分がすべて課金カードに集中して潰れる**（200 件流れると高さ 0 付近＝ヘッダ帯ごと消える）。
     子を縮ませず自然高を保たせ、超過分は .list 側のスクロール（034a の追従で最新へ）に回す。
     同一原因・同一対処の先例: OverlayComment.module.css の .item（043c 追修正）／このファイルの .card（035c）。
     再修正トリガー: 課金カードだけに絞りたくなったら .item.itemTipCard 側へ移す（ただし OBS 側は .item に
     置いているので、揃えるならこちらが正）。 */
  flex-shrink: 0;
}
```

### (2) `.pinnedBar` に `flex: none` を足す ＝ 二次防御

```css
.pinnedBar {
  /* …既存の指定は不変… */
  /* 047c: 帯自身も .root（flex 縦積み）の子で、overflow-y:auto ＝ flex 自動最小高さが 0。上部の段が窓高を
     超えたときに縮むのは .commentSplit（flex-basis:0 ＝縮小配分の対象外）ではなくこの帯になり、固定した
     コメントが帯ごと 0 まで潰れる。隣の .tickerBar が同じ理由で flex:none を持っているのに合わせる
     （高さの上限は従来どおり max-height:22vh が持つので、帯が出ている間の見た目は変わらない）。 */
  flex: none;
  max-height: 22vh;
  overflow-y: auto;
}
```

## 影響範囲（`.item` を共有する 3 箇所すべて確認済み・退行なし）

| 使用箇所 | 親コンテナ | `flex-shrink: 0` の効果 |
|---|---|---|
| `CommentList.tsx` `renderDefaultItem` の一覧行 | `.list`（flex縦・`overflow-y:auto`） | **目的の修正**。chat 行は元から自動最小高さ＝内容高なので**見た目は不変**、課金カードだけが潰れなくなる |
| `PinnedCommentBar.tsx` の固定帯の行 | `.pinnedBar`（flex縦・`max-height:22vh`・`overflow-y:auto`） | 同じ潰れが止まる。超過分は帯内スクロールへ（046a の設計どおり） |
| `ViewerDetailPanel.tsx` の過去コメント | `.pastList`（flex縦・`max-height:320px`・`overflow-y:auto`） | ここは `.itemTipCard` が付かない＝元から潰れない。**中立**（自然高＋スクロールが保証されるだけ） |

**OBS オーバーレイには波及しない**: `renderOverlayItem` は `overlayStyles.item`（別 CSS モジュール）だけを付け、
`CommentViewerApp.module.css` の `.item` は当たらない。`PinnedOverlayApp` も自前の CSS モジュール。
（`PinnedOverlayApp.tsx` が依存している `flex-shrink:0` は `OverlayComment.module.css` 側のもので、今回触らない。）

## ティッカー帯（症状 C）の切り分け —— **実施済み。結果は 047d へ**

A/B（＝一覧・固定帯）を直した状態で実機観察したところ、ティッカー帯だけが依然として崩れた。
**上の手順 3（`.tickerTrack` と `.tickerPill` の高さ比較／横スクロールバーが縦を食っていないか）が当たり**で、
原因は末尾の 047d 節に確定させた。手順そのものは次に同種の症状が出たときの型として残す。

## やらないこと

- ティッカー帯（症状 C）への予防的な CSS 追加。**切り分けの結果が出るまで触らない**（→ 047d で結果が出たので解除）。
- 一覧の仮想化・`MAX_COMMENTS` の変更・再レンダー最適化（今回の潰れとは無関係。`CommentList.tsx` の
  「200 件では無視できる」という既存判断とその再修正トリガーを据え置く）。
- TSX・配色トークン・OBS オーバーレイ・取得側（sidecar/wire/Rust）の変更。

## テスト方針 —— **未カバー**（試したが新規依存なしでは書けなかった）

**この 2 行はテストで守られていない。**

まず「潰れないこと」自体は検証できない。vitest は jsdom（`apps/desktop/vitest.config.ts`）で、
jsdom は**レイアウトを計算しない**（`getBoundingClientRect()` は常に 0、CSS モジュールのクラスは
識別子に置換されるだけでカスケードも走らない）。この不具合は「flex の縮小配分の結果」なので**原理的に**測れない。

そこで一段弱い不変条件（**CSS ソースの `.item` ブロックに `flex-shrink: 0` があること**）を assert する
ガードテストを実際に書いたが、**新規依存なしでは成立しなかった**ため見送った。3 回目の再発である以上
機械で固定したかったので、経緯を残す:

| 試した方法 | 結果 |
|---|---|
| `import css from "./X.module.css?raw"` | **`{}` が返る**。Vite の CSS modules 処理が `?raw` より先に走る |
| `?inline` | **空文字**。vitest は既定で CSS を処理しない（`test.css` が false） |
| `vitest.config.ts` に `css: true` | 全テストのクラス名が実ハッシュに変わり既存 294 tests へ波及するので却下 |
| `node:fs` で直接読む | 動くが **`@types/node` の新規追加**が必要（`tsc --noEmit` が `Cannot find module 'node:fs'` で落ちる） |

代わりに `.item` の CSS コメントへ**未カバーである事実・その理由・「レビュー時は目視でここを確認すること」**を明記した。

> 再検討トリガー: 他の用途で `@types/node` が入ったら、このガードテストを足す
> （**3 回目の再発**である以上、人間のレビューだけでは止まらないことが実証されている）。

既存テストは全て緑のままであること（CSS 変更なので影響しない想定だが、退行チェックとして実行する）。

## セキュリティ制約（docs/security.md 準拠）

CSS の縮小挙動の修正のみ。外部通信宛先・API・capability・依存・`csp: null` いずれも不変。
コメント本文/金額の扱いも変えない（§1/§3/§9/§10 に触れる変更なし）。

## 完了条件

- コメントが一覧の可視高を超えて流れ続けても、**課金カードのヘッダ帯（アイコン/名前/金額）と本文が縮まない**。
  はみ出し分は一覧のスクロールになり、034a の最新追従も従来どおり効く。
- chat 行の高さ・余白・折り返しが修正前と同一（非退行）。
- 長文スパチャを固定しても固定帯のカードが潰れず、22vh を超えた分は帯内スクロールになる。
- 窓を最小高（`lib.rs` の `min_inner_size` = 520px）まで縮めても固定帯が消えない。
- OBS オーバーレイ（コメント／固定）の見た目が不変。
- ティッカー帯の切り分け結果がこの節に追記されている。
- `typecheck` / `lint` / `test` が通り、`docs/progress.md` を更新。

## 確認コマンド

```bash
# 差分は CSS 1 ファイル・2 行の追加であること
git diff --stat -- apps/desktop/src/screens/comment-viewer/CommentViewerApp.module.css
git diff -- apps/desktop/src/screens/comment-viewer/CommentViewerApp.module.css

# ゼロ拡大の担保（差分ゼロが期待）
git status --short -- apps/desktop/src-tauri/ apps/comment-sidecar/ apps/desktop/package.json \
  apps/desktop/src/screens/comment-viewer/OverlayComment.module.css \
  apps/desktop/src/screens/comment-viewer/OverlayApp.tsx \
  apps/desktop/src/screens/comment-viewer/PinnedOverlayApp.tsx

pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
pnpm --filter ./apps/desktop test        # 既存 20 files / 269 tests が全て緑

pnpm --filter ./apps/desktop tauri dev   # 上の「完了条件」1〜6 を目視、7（切り分け）を実施
```

## 実装後に必要なレビュー

- 軽レビュー: CSS のみで外部通信宛先・API・capability・依存・`csp: null` が不変であること、
  `.item` を共有する 3 箇所（一覧／固定帯／視聴者詳細）と OBS オーバーレイの表示を壊していないことを確認する。

---

# 047d: ティッカー帯が横溢れの瞬間にピルを切り落とす不具合

> 状態: **実装済み（2026-07-29）**。記録は [`docs/progress.md`](../progress.md) の
> 「047d ティッカー帯が横溢れの瞬間にピルを切り落とす」節。047c の「症状 C（原因未特定）」の解決編。

## 症状（依頼者の実機報告）

> 以下のコメントが流れた瞬間ティッカーが縮んで、その次のコメントが流れたら元に戻りました。
> `k / kappa_lord / Twitch / ビッツ / 25,000 bits / that clutch was insane`

追加ヒアリングで得た 3 つの観測が、原因を 1 つに絞り込んだ。

| # | 観測 | 何が分かるか |
|---|---|---|
| 1 | **「ちょうどそのコメントでピルが横に溢れた」** | 引き金は**横オーバーフローの開始**＝`.tickerTrack` に横スクロールバーが生まれる瞬間。`25,000 bits` は金額文字列が長く、これが最後の一押しになった |
| 2 | **「ピルが四角くなった」** | `.tickerPill` は `border-radius: 999px` のスタジアム形。**要素が小さくなっただけなら角丸は比例縮小して丸いまま**なので、四角く見えるのは**上下を切り落とされたとき**だけ（丸い両端の中央帯だけが残る）＝ **クリップの signature** |
| 3 | **「帯と一緒にピルも細くなった／帯は完全には消えていない」** | 帯の高さ＝トラックの高さが落ちたが 0 ではない ＝ ラベル側（≒16px）が下限として残る落ち方 |

## 真因

```css
.tickerBar   { display: flex; align-items: stretch; flex: none; padding: 8px 16px; }
.tickerLabel { flex: none; /* 12px 文字＋10px チップ ≒ 16px 高 */ border-right: 1px solid …; }
.tickerTrack { flex: 1; min-width: 0; display: flex; align-items: center;
               overflow-x: auto; overflow-y: hidden; }
.tickerPill  { flex: none; padding: 3px 12px 3px 3px; border-radius: 999px; }
.tickerAvatar{ width: 24px; height: 24px; }     /* ← ピル実高 = 3 + 24 + 3 = 30px */
```

1. 帯の高さは `align-items: stretch` により **`.tickerLabel`(≒16px) と `.tickerTrack`(=ピル 30px) の高い方**で決まる。
   通常は 30 ＋ padding 16 ＋ border 1 ＝ **47px**。
2. **横オーバーフローが始まると `.tickerTrack` に横スクロールバーが生まれる。**
   ⚠ 依頼者の macOS 設定は**「スクロールバーを表示: 自動的に」**——これは
   **マウス接続時にレイアウト占有型（約 15px）へ切り替わる**設定で、オーバーレイ表示を前提にはできない。
3. トラックの高さは `align-items: stretch` で**外から**与えられているので、スクロールバーが出ても**帯は伸びない**。
   content box だけが 30px → 15px に減る。
4. そこに 30px のピルが入るので **`overflow-y: hidden` が上下を切り落とす**
   → 角丸の両端が消えて**ピルが四角く見え、帯全体が細く見える**（観測 2・3 と一致）。
5. **「次のコメントで元に戻った」**は、次のレイアウトでは**スクロールバーが最初から在る状態**で
   トラックの高さが計算し直され、ピルが収まる状態に落ち着いたということ。

つまり**帯の高さが「横に溢れているか」「何回目のレイアウトか」に依存してブレていた**のが不具合の本体。

### 047c との関係

**別の機構**（047c は flex の縮小配分、047d は overflow のクリップ）。共通しているのは
**「`overflow` を `visible` 以外にした箱が、外から与えられた高さの中で中身を黙って切り落とす」**という形だけ。
047b で意匠を作り込んだ結果、同じ形の罠を 2 箇所に作っていたことになる。

## やったこと（CSS のみ・対象は `CommentViewerApp.module.css` の `.tickerTrack` 1 ルール）

### (1) 横スクロールバーにトラックの縦を食わせない ＝ 根本

```css
.tickerTrack {
  /* …既存の指定は不変… */
  scrollbar-width: none;
}
.tickerTrack::-webkit-scrollbar {
  display: none;   /* WKWebView＝Tauri の実行環境ではこちらが実効 */
}
```

これで**帯の高さが溢れ状態から完全に切り離される**（溢れていても 47px のまま）。
先例: `OverlayApp.module.css` の `:global(html[data-overlay="1"] ol)::-webkit-scrollbar`（同じ手）。

**操作性は落とさない**: ピルは実 `<button>` なので Tab で自動横スクロールし、
トラックパッド／Shift+ホイールの横スクロールも効く。右端で見切れたピルが「まだ続く」という affordance を担う
（YouTube のティッカーも同じ）。

> 再修正トリガー: 実機で「もっと投げ銭があることに気づけない」となったら、**スクロールバーを戻すのではなく**
> 右端のフェードや件数表示など**縦を食わない** affordance を足す（戻すと同じ不具合が再発する）。

### (2) トラックの高さに下限を切る ＝ 二次防御

```css
.tickerTrack { min-height: 30px; }   /* .tickerAvatar 24px ＋ .tickerPill の縦 padding 3+3 */
```

(1) で原因は消えるが、**「高さが外から決まる箱が `overflow:hidden` で中身を黙って切る」構造自体は残る**ため、
切られる状態に入れない床を置く。**この 30px と `.tickerAvatar` の 24px / `.tickerPill` の縦 padding は
対で動かすこと**（片方だけ変えると再発する）。

### 触らなかったもの

- `.tickerBar { align-items: stretch }` は**維持**。ラベルの `border-right`（縦罫）を帯の全高に通すために必要で、
  `center` にすると罫線が 16px に縮んで意匠が壊れる。
- `.tickerLabel` 側は元から帯高を決めていないので不変。TSX・ロジック・配色トークンも不変。

## テスト

**追加していない（047c と同じ理由）。** jsdom はレイアウトを計算せず、**スクロールバーの有無も再現しない**ので
この不具合は原理的に検出できない。CSS ソースを読むガードテストも `?raw` が CSS モジュールに効かず
`@types/node` が要るため見送っている（上の「テスト方針」節）。CSS コメントに経緯と再修正トリガーを残すのが対処。

## 完了条件

- ピルが横に溢れても**ピルが丸いまま・帯の高さが 47px から動かない**。
- 溢れた状態でトラックパッドの横スクロール／`Tab` でのピル移動が従来どおり効く。
- **マウス接続の有無（＝スクロールバーが占有型かオーバーレイか）で挙動が変わらない**。
- 課金 0 件で帯が出ない（`MonetaryTicker` の `return null`）ことは不変。
- 047c で直した一覧の課金カードが再発していない。
- `typecheck` / `lint` / `test`（20 files / 294 tests）が緑。

## 確認コマンド

```bash
git diff --stat -- apps/desktop/src/screens/comment-viewer/CommentViewerApp.module.css

# ゼロ拡大の担保（差分ゼロが期待）
git status --short -- apps/desktop/src-tauri/ apps/comment-sidecar/ apps/desktop/package.json \
  pnpm-lock.yaml apps/desktop/vitest.config.ts \
  apps/desktop/src/screens/comment-viewer/OverlayApp.tsx \
  apps/desktop/src/screens/comment-viewer/PinnedOverlayApp.tsx

pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
pnpm --filter ./apps/desktop test

pnpm --filter ./apps/desktop tauri dev   # マウス接続あり/なしの両方で、ピルを溢れさせて上の完了条件を目視
```

## 実装後に必要なレビュー

- 軽レビュー: CSS のみで外部通信宛先・API・capability・依存・`csp: null` が不変であること、
  ティッカーの横スクロール操作性（トラックパッド／Tab）が保たれていること、047b/047c の表示を壊していないこと。
