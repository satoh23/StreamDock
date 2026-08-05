# 060f オーバーレイ DOM の整合（取り込んだ CSS が「正しい要素・正しい範囲」に当たるようにする）

> 状態: **未着手（実装サブタスク）／⚠⚠ 060 の実用性を左右する最優先タスク**。
> 分割・線引きは親 [060](060-overlay-custom-css.md) を正とする。
>
> **必読前提**: 契約の正 [060a](060a-overlay-selector-contract.md)（安定クラスと変換表）、
> 取り込み基盤 [060b](060b-custom-css-import-backend.md)、管理 UI と注入 [060d](060d-css-theme-management-ui.md)、
> [`docs/security.md`](../security.md)（**レビュー必須条件＝オーバーレイへのユーザー CSS の注入**）。
>
> ⚠ **行番号は書かない**（特定はシンボル名で行うこと）。
> ⚠ **着手条件＝ [060d](060d-css-theme-management-ui.md) / [060e](060e-paste-css-import.md) の実機確認が済んでいること。**
> ここは 034e / 043c で作り込んだ**既定意匠を触る**タスクなので、未確認のまま着手すると
> 「元から壊れていたのか、本タスクで壊したのか」が切り分けられなくなる。

## 目的

**ユーザーが持っている CSS を貼って、そのとおりのデザインになる**——060 の目的そのものが、
現状では 3 つの構造的なズレで成立していない。本タスクはそれを DOM と変換表の側で埋める。

⚠ **本タスクは外部通信を一切足さない**（`@import` の取得は [060c](060c-external-css-snapshot.md)、
Web フォントは [060h](060h-external-font-snapshot.md)）。**新規依存ゼロ・新規 capability ゼロ・Rust 差分ゼロ**。

## ⚠⚠ 背景（2026-08-05 の実測。ここを読まずに着手しないこと）

依頼者の実サンプル（`https://ruri.info/tool/css/frame-fukidashi.css` を `@import` する CSS）の
**構造だけ**を取得して分析した結果、対象は **YouTube 純正ライブチャットの DOM**（`yt-live-chat-*`）だった。
30 セレクタを `rewriteSelectors()` に通した実測:

- **変換成功 10 / 未変換 20**。未変換のうち 14 は YouTube の画面部品を隠す指定（`#panel-pages` /
  ヘッダ / 入力欄 / ティッカー等）で、**StreamDock には対応物が無い＝無害**。
- **本当に足りないのは 6 つだけ**（下の (4)）。

つまり「変換表がまるで足りない」わけではない。**致命的なのは次の 3 つのズレ**である。

### ズレ① ⚠⚠ chat 専用に書かれた CSS が課金カードにも当たる（**最優先。これが「論外」の正体**）

```
YouTube:    yt-live-chat-text-message-renderer = テキストコメント**専用**
StreamDock: .sd-comment                        = chat と課金の**両方**に付く
```

`CommentList.tsx` の実装（実測）:

```
chat: <li className={`${overlayStyles.item} sd-comment`}>
課金: <li className={`${overlayStyles.item} ${overlayStyles.card} ${cardClass} sd-comment sd-comment-tip`}>
```

`.sd-comment-text` / `.sd-comment-name` / `.sd-comment-icon` / `.sd-comment-body` /
`.sd-comment-source` も**すべて両方に付いている**。

＝ 変換表が「chat 専用」を「両方」へ対応させており、**取り込んだテーマが課金カードの意匠を壊す**。
⚠⚠ **依頼者の要件は「普通のチャットにのみデザインが当たること」。ここが満たせないと機能として成立しない。**

### ズレ② ⚠⚠ 吹き出しが二重になる

```
StreamDock: li.sd-comment > div.row > div.sd-comment-body ← 既定の吹き出し＋しっぽ
                                        └ p.sd-comment-text ← 取り込んだ CSS の吹き出し＋しっぽ
YouTube:    yt-live-chat-text-message-renderer > #message  ← 吹き出しはここ**だけ**
```

YouTube 側に `.sd-comment-body` に相当する要素が**存在しない**。取り込んだ CSS は
`#message`（→ `.sd-comment-text`）に吹き出しを描き、その `:before` / `:after` にしっぽを付けるので、
**StreamDock の吹き出しの内側にもう 1 個吹き出しが描かれる**。
⚠ **これは変換表をいくら厚くしても直らない**（DOM の形の問題）。

### ズレ③ 器に安定クラスが無い

`.header`（名前行）／`.row`（アイコン＋吹き出しの行）／`.cardHeader`（課金ヘッダ）／
`<ol className={styles.list}>`（一覧の器）に **`sd-*` が付いていない**。
そのため YouTube の `div#author-info` / `yt-live-chat-item-list-renderer #items` に対応物が作れない。

## やること

### (1) ⚠⚠ chat 限定にする（**方式 A**・2026-08-05 依頼者決定）

**変換表の向き先を chat 専用クラスにする。** 注入時に CSS を書き換える走査器は**増やさない**。

- ⚠ **方式 B（注入時にテーマ CSS 全体を chat 限定へ書き換える）は採らない。** セキュリティ上の壁ではないのに
  走査型のコードを 1 本増やすことになり、`cssScope.ts` の走査器が **2 回続けて実 CSS パーサと desync した**
  （060d security-review ①②）領域を広げてしまう。方式 A なら**表と DOM だけ**の問題に閉じる。
- ⚠ **帰結として、StreamDock 語彙で直接書いた CSS（`.sd-comment{…}`）は依然 chat と課金の両方に当たる。**
  これは受容する——`.sd-comment` は仕様上「コメント 1 件（chat / 課金 共通）」であり、
  それを知って書いている人の意図どおりだから。**課金だけを狙いたい人には `.sd-comment-tip` が、
  chat だけを狙いたい人には新設の `.sd-comment-chat` がある。**

### (2) chat の中間 div を廃す（ズレ②）

```
【現状】li.sd-comment > div.row > div.sd-comment-body > p.sd-comment-text
【変更】li.sd-comment > div.row > p.sd-comment-body.sd-comment-text
```

⚠⚠ **`sd-comment-body` は `<p>` に残す**（2026-08-05 依頼者決定）。消さない理由:

- 契約「**chat と課金で同じ役割には同じ安定クラス**」（060a）を保てる。`.sd-comment-body` の意味は
  「吹き出し／カード本体＝背景と枠を持つ箱」のままで、chat ではそれが `<p>` になっただけ。
- YouTube 由来の CSS（`#message` → `.sd-comment-text`）も StreamDock 語彙の CSS（`.sd-comment-body`）も
  **同じ要素に当たる**ので、競合は普通のカスケードで解決する（後勝ち。ユーザー CSS は `<head>` 末尾に注入される）。

**これで直る核心**: 取り込んだ CSS の `#message:before` / `:after` が `.sd-comment-text:before` / `:after` へ
変換され、**StreamDock のしっぽと同じ要素・同じ疑似要素**になる ＝ **二重ではなく置き換え**になる。

⚠ **課金カードは触らない。** `div.cardBody`（= `.sd-comment-body`）はヘッダ帯＋ボディの 2 段構造に必要。

### (3) 安定クラスを 4 つ追加（ズレ③）

| 新クラス | 付ける場所 | 役割 |
|---|---|---|
| `sd-comment-chat` | chat の `<li>` **のみ** | ⚠ (1) の的。課金には**付けない** |
| `sd-comment-header` | `.header`（chat）と `.cardHeader`（課金） | 名前行 |
| `sd-comment-row` | `.row`（chat） | アイコン＋吹き出しの行 |
| `sd-comment-list` | `<ol className={styles.list}>` | 一覧の器 |

⚠⚠ **`sd-comment-list` は `variant === "overlay"` のときだけ付けること。** この `<ol>` は
**本体コメビュ（`variant="default"`）と共有**で、`CommentList.test.tsx` の
「variant=default には安定クラスも data 属性も付かない」が既にこの不変条件を固定している。

### (4) 変換表を更新する

**chat 限定へ向け直す（8 件）**

| from | 現 to | **新 to** |
|---|---|---|
| `yt-live-chat-text-message-renderer` | `.sd-comment` | `.sd-comment-chat` |
| `yt-live-chat-text-message-renderer #message` | `.sd-comment-text` | `.sd-comment-chat .sd-comment-text` |
| `yt-live-chat-text-message-renderer #author-name` | `.sd-comment-name` | `.sd-comment-chat .sd-comment-name` |
| `yt-live-chat-text-message-renderer #img` | `.sd-comment-icon` | `.sd-comment-chat .sd-comment-icon` |
| `.chat-line__message` | `.sd-comment` | `.sd-comment-chat` |
| `.chat-line__message-body` | `.sd-comment-text` | `.sd-comment-chat .sd-comment-text` |
| `.chat-line__no-background` | `.sd-comment` | `.sd-comment-chat` |
| `.chat-author__display-name` | `.sd-comment-name` | `.sd-comment-chat .sd-comment-name` |

**据え置き（2 件）——⚠ 理由を消さないこと**

| from | to | なぜ chat 限定にしないか |
|---|---|---|
| `yt-live-chat-paid-message-renderer` | `.sd-comment-tip` | 課金専用なので現状が正しい |
| `yt-img-shadow` | `.sd-comment-icon` | ⚠⚠ **YouTube では chat と課金の両方に出る共有要素**。chat 限定にすると `yt-live-chat-paid-message-renderer yt-img-shadow` が `.sd-comment-tip .sd-comment-chat .sd-comment-icon` になり **絶対に当たらないセレクタ**を生む（(10-b) のコメントが言う「変換されたのに効かない＝最悪の状態」） |

**新規追加（7 件）**

| from | to | 根拠 |
|---|---|---|
| `.yt-live-chat-author-chip` | `.sd-comment-chat .sd-comment-name` | 投稿者名チップ（実サンプルで未変換だった） |
| `yt-live-chat-app` | `.sd-overlay` | 窓ルート（全体の背景・フォント） |
| `yt-live-chat-renderer` | `.sd-overlay` | 同上 |
| `yt-live-chat-item-list-renderer #items` | `.sd-comment-list` | 一覧の器 |
| `div#author-info` | `.sd-comment-header` | 名前行。⚠ chat / 課金の両方に現れる役割なので**限定しない** |
| `.yt-live-chat-membership-item-renderer` | `.sd-comment-tip` | メンバーシップも StreamDock では課金カード |
| `yt-live-chat-paid-message-renderer #message` | `.sd-comment-tip .sd-comment-text` | ⚠ 対称性のため新設（これが無いと課金本文を狙う CSS が unmatched になる） |

**⚠ 追加してはいけないもの**

- **`body`** —— 窓全体の背景に触れると**オーバーレイの透過（OBS 合成の前提）が壊れる**。
  未変換のまま `unmatched` に出して気付かせる。

⚠ **`.sd-overlay` を変換表に入れてよくなった理由を書き残すこと。** `cssCompat.ts` の現行コメントは
「`.sd-overlay` は入れない（060d のプレビューは全セレクタへ `.sd-preview` を前置するので窓ルートは当たらなくなる）」
と書いているが、**060d は `.sd-overlay` を `.sd-preview` へ読み替える実装になった**（`cssScope.ts` の
`ROOT_LIKE_CS`）ため、この制約は**既に解消されている**。コメントが古い＝訂正対象。

### (5) 静的ガードを更新する

| ガード | 変更 |
|---|---|
| **(10-a)** `STABLE_CLASSES` | `sd-comment-chat` / `sd-comment-header` / `sd-comment-row` / `sd-comment-list` を追加 |
| **(10-b)** 変換先 ⊆ 契約 | ⚠ **変更不要**（実測済み）。`to.matchAll(/\.([A-Za-z0-9_-]+)/g)` で**全クラストークン**を検査する形なので、`.sd-comment-chat .sd-comment-text` のような複合セレクタも既に通る |
| **(10-c)** from に sd 語彙を書かない | 変更不要（`to` 側のみの変更のため） |
| **(10-e)** `--sd-*` フォールバックの厳密一致 | ⚠ **`.bubble` の 4 エントリを統合後の規則名へ**（`background` / `border` / `border-radius` / `::before` `::after` の `border-right-color`）。`.text` の `color` も同じ規則へ寄る |

## やらないこと

- **外部通信**（`@import` の取得は 060c、フォントは 060h）。**Rust には一切触らない。**
- **表示項目のトグル**（サイト名・アイコン）＝ [060g](060g-overlay-display-toggles.md)。
- **本体コメビュ（`variant="default"`）の DOM 変更**。触るのは overlay / 固定コメント窓の分岐だけ。
- 変換表の網羅（実サンプルが通る範囲＋今回判明した 6 つに留める。`unmatched` が次の観測手段）。

## ⚠ リスクと確認事項

1. ⚠⚠ **034e / 043c の既定意匠が動く可能性がある。** `.bubble` の `flex:1; min-width:0; position:relative` を
   `<p>` へ移す操作自体は無害なはずだが、**実機で見た目を必ず確認すること**（jsdom は再現しない）。
2. ⚠ `CommentList.tsx` は **`PinnedOverlayApp`（固定コメント窓）とも共有**。DOM 変更は固定窓にも出る。
   意匠は同じ `OverlayComment.module.css` 由来なので追随するが、**固定窓の見た目も確認すること**。
3. ⚠ `<p>` の UA 既定 margin。統合後の規則に `margin: 0` が残っていることを確認する。

## 実装後に必要なレビュー

⚠⚠ **security-review 必須。** `docs/security.md`「レビュー必須条件」の
**「スコープ化・封じ込めの担保を弱める変更」**に該当する可能性があるため（`.sd-comment-body` の構造変更は
`cssScope.ts` の前提ではないが、**注入先の DOM が変わる**）。あわせて次を必ず見ること:

- `.sd-overlay` を変換表へ入れたことで、**プレビューの読み替え（`ROOT_LIKE_CS`）が正しく効くか**
- 新クラスが `variant="default"`（本体コメビュ）へ漏れていないこと

## 完了条件

- [ ] 実サンプル（YouTube 由来の CSS）を取り込んだとき、**課金カードの見た目が変わらない**
- [ ] chat の吹き出しが**二重にならない**（取り込んだ CSS のしっぽが StreamDock のしっぽを**置き換える**）
- [ ] `unmatched` に残るのが「StreamDock に対応物が無いもの」だけになる（YouTube の画面部品を隠す指定など）
- [ ] `variant="default"`（本体コメビュ）に新しい安定クラスが 1 つも付かない
- [ ] `pnpm test`（CSS guard 含む）／`typecheck`／`lint` が緑。**Rust 差分ゼロ**
- [ ] ⚠ **security-review**（別チャット）
- [ ] ⚠ 実機確認（既定意匠の見た目・固定コメント窓・課金カード）
