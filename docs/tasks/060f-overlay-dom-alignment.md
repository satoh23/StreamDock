# 060f オーバーレイ DOM の整合（取り込んだ CSS が「正しい要素・正しい範囲」に当たるようにする）

> 状態: **実装済み（2026-08-05）／security-review の指摘を全件反映（2026-08-06）／⚠⚠ 実機確認は未実施**。
> ⚠⚠ **本ファイルの「二重ではなく置き換えになる」（下の (2)）は誤り**（2026-08-08 の実機確認で判明）。
> 既定のしっぽは**疑似要素 2 枚**で描いており、テーマが `::before` 1 枚しか書かないと **`::after` が孤児として残る**。
> → 注入時に**固定リセットを前置**して既定のしっぽを止める形へ追修正した（`overlayThemeReset.ts` ／ `@layer sd-default`）。
> あわせて**アイコンを消したときのレイアウト崩れ**も直した（`.item` を 2 列グリッド化）。
> ⚠ **「意匠 CSS の非コメント差分ゼロ」はこの追修正で失われている**。詳細は progress.md 060f 節。
>
> ⚠⚠ **差し戻し②（2026-08-08）でリセットの守備範囲が広がった。** 実機ではしっぽを直しても見た目が合わず、
> 原因は**既定の `.bubble` が「テーマが部分的にしか上書きできない床」になっていたこと**だった
> （テーマが書かなかった枠・角丸・影・すき間が全部残る＝**吹き出しを持たないデザインが適用できない**）。
> → リセットは `background` / `border` / `border-radius` / `filter` / `--sd-icon-gap` も引っ込める形になり、
> `.bubble` 本体も `@layer sd-default` の中へ入れた。⚠ **`position` と `padding` は落とさない**
> （前者はテーマのしっぽの位置基準・後者は元サイトの余白に依存したテーマが崩れるため）。
> ⚠ **テーマを選ぶと StreamDock の既定装飾が引っ込む**という受容した挙動になったので、
> 「コメントのデザイン」カードにその説明を 1 行出している。詳細は progress.md 060f 節「差し戻し②」。
>
> ⚠⚠⚠ **差し戻し④（2026-08-08）で本タスクの起票理由①の解き方が変わった。**
> 起票理由①（chat 用に書かれたテーマが課金カードの意匠を壊す）は、本ファイルが設計した
> **「chat 専用クラスへ向ける／目印クラスで限定する」では解けなかった**——実機で使う配布テーマは
> `yt-live-chat-paid-message-renderer{display:none!important}` のように**課金カードを名指しで消しにくる**
> （純正チャットはスパチャがティッカーにも出るので「インライン側を消す」のが定番。StreamDock に
> ティッカーは無いので意図が成立せず、**課金カードが丸ごと消えた**）。
> → **「限定」ではなく「切り離し」で解いた**＝ 課金カードから安定クラスと `data-sd-*` を全部外し、
> 変換表から課金系 3 エントリを削除し、リセットの当て先も chat 専用クラスへ寄せた。
> ⚠ **`sd-comment-in-tip` は廃止**（対の `sd-comment-in-chat` は残る）。**`.sd-comment` は chat 専用**になった。
> ⚠ 受容したトレードオフ＝ `data-sd-tone` によるティア別の装飾ができなくなった。
> 新設の静的ガードは **(10-o)**。詳細は progress.md 060f 節「差し戻し④」。
>
> ⚠⚠ **契約が 2 つ増えている**（security-review Q-1 の修正・2026-08-06）——`sd-comment-in-chat` /
> `sd-comment-in-tip`。**「`<li>` は `sd-comment-chat` / `sd-comment-tip`、その中の要素はすべて
> `-in-chat` / `-in-tip`」**で、変換表の `to` を「1 要素の複合セレクタ」に保つための土台である
> （子孫セレクタに戻すと合成時に二重前置されて永久に当たらなくなる。静的ガード **(10-l)** と
> 全順序対テストが機械で守っている）。**経緯と要判断の記録は [`docs/progress.md`](../progress.md) の
> 060f 節「security-review の結果」→「Q-1 の修正」が正。**
> ⚠ **実装後の実際の姿は [`docs/progress.md`](../progress.md) の 060f 節が正**
> （本ファイルは着手前の設計メモで、下記「実装で崩れた前提と訂正」以外は当時のまま残してある）。
> 分割・線引きは親 [060](060-overlay-custom-css.md) を正とする。
>
> **必読前提**: 契約の正 [060a](060a-overlay-selector-contract.md)（安定クラスと変換表）、
> 取り込み基盤 [060b](060b-custom-css-import-backend.md)、管理 UI と注入 [060d](060d-css-theme-management-ui.md)、
> [`docs/security.md`](../security.md)（**レビュー必須条件＝オーバーレイへのユーザー CSS の注入**）。
>
> ⚠ **行番号は書かない**（特定はシンボル名で行うこと）。
> ⚠⚠ **着手条件（[060d](060d-css-theme-management-ui.md) / [060e](060e-paste-css-import.md) の実機確認）は
> 満たさないまま着手した**（2026-08-05・**依頼者決定「実機確認は後でよい、先に実装する」**）。
> ここは 034e / 043c で作り込んだ**既定意匠を触る**タスクなので、本来は未確認のまま着手すると
> 「元から壊れていたのか、本タスクで壊したのか」が切り分けられなくなる。
> → **その切り分け不能を承知で受容した。** 助けになるよう **意匠 CSS（`OverlayComment.module.css`）は
> 非コメント差分ゼロ**にしてあり、`git diff` で「本タスクは宣言を 1 つも触っていない」ことを確認できる。
> ⚠⚠ **この担保は追修正①（2026-08-08）のグリッド化で失われた。** 代替は **(10-e)** ＋
> 新設 **(10-n)（レイアウト器の宣言インベントリ）** ＋ 実機の A/B スクショ（⚠ **chat と課金カードの両方**）。
> ⚠ 実際にこの隙間を通り抜けた回帰が 1 件出ている（`.icon{margin-right}` が課金カードのヘッダを
> 28px 広げていた・レビュー指摘 Q-1 で修正済み）。**「宣言を触っていないはず」という前提で
> 差分を読み飛ばさないこと。** 詳細は progress.md 060f 節「security-review ＋ code-review の結果」。
> **実機確認は完了条件として残っている**（下のチェックリスト）。

## ⚠⚠ 実装で崩れた前提と訂正（2026-08-05）

着手後の実測で、本ファイルの記述が 3 点誤っていた。**訂正は以下が正**（詳細は progress.md 060f 節）。

1. ⚠⚠ **(5) の「(10-b) は変更不要（実測済み）」は誤り。** 複合セレクタ（`.sd-comment-chat .sd-comment-text`）が
   通るのは正しいが、**`.sd-overlay` が `STABLE_CLASSES` に無いので落ちる**（4 クラス追加後もなお 1 件）。
   かつ `sd-overlay` は `CommentList.tsx` ではなく `OverlayApp.tsx` に在るため、素朴に足すと今度は
   **(10-a)** が落ちる。→ **`ROOT_CLASSES` を別立て**にし、**(10-b) の照合集合だけを両者の和**にした
   （(10-a) は `STABLE_CLASSES` のみ・**(10-d) は不変**）。
2. ⚠⚠ **(4) の「`body` は未変換のまま `unmatched` に出して気付かせる」は誤り。** `FOREIGN_SELECTOR_RE` は
   **接頭辞ベース**（`ytd?-` / `.chat-` / `.tw-` / `[data-a-target…]` ＋ `FOREIGN_ID_NAMES` の列挙）で、
   `body` / `html` / `:root` / `#panel-pages` は**載らない**（実測）。060a が「警告をノイズにしない」ために
   意図的に選んだ設計なので**実装が正**。＝ **「変換表に足さなかったものは警告で気付ける」は成り立たない**——
   `body` を足さない判断を守っているのは `cssCompat.ts` のコメントと `cssCompat.test.ts` だけである。
   ⚠ 併せて「未変換 20」は**目視の数**であって `unmatched.length` ではない（両者は一致しない）。
3. ⚠⚠ **(5) の「(10-e) の `.bubble` 4 エントリと `.text` の `color` を統合後の規則名へ」は取り下げ。**
   `.bubble` と `.text` に**重複プロパティが 1 つも無い**ことを実測したため、**1 規則へ統合せず
   同じ `<p>` に両クラスを併記**する形にした。帰結として **(10-e) は変更不要**で、
   **意匠 CSS は非コメント差分ゼロ**＝「既存意匠を 1px も変えない」を機械で証明できる。

4. ⚠⚠⚠ **上の 1. と下の (4) が言う「複合セレクタ（`.sd-comment-chat .sd-comment-text`）」は
   **security-review Q-1 で撤回された**（2026-08-06）。**子孫セレクタは合成時に前置が二重に積まれて
   永久に当たらないセレクタになる**（`.chat-line__message .chat-line__message-body` →
   `.sd-comment-chat .sd-comment-chat .sd-comment-text`。しかも `rewritten` は加算され `unmatched` は
   空なので UI が誤報する）。→ **`to` は「1 要素の複合セレクタ」だけ**にし、chat / 課金の限定は
   **`sd-comment-in-chat` / `sd-comment-in-tip`**（`<li>` の中の要素すべてに付く目印）で表す形へ変更した。
   ＝ **下の (4) の変換表は当時のままなので、現在の `to` は progress.md 060f 節を見ること。**
   静的ガード **(10-l)** と全順序対テストが機械で守っている。

**⚠ 実装後に見つかった、本ファイルに無かったリスク 2 件**

- ⚠⚠ **`.sd-overlay` を変換表に入れたことで、`body` と同じ症状が別ルートで成立する。**
  `.sd-overlay` は `OverlayApp` の **`height: 100%` のルート div** なので、
  `yt-live-chat-app { background: #fff }` と書かれたテーマは**オーバーレイ窓を全面不透明にする**
  （窓自体は透明のままだが中の div が全面を塗る）。的として必要なので**受容**し、脱出路は
  「既定のデザインに戻す」に委ねた。**security-review の観点に必ず含めること。**
- ⚠ **詳細度が `(0,1,0)` → `(0,2,0)` へ上がる帰結が [060g](060g-overlay-display-toggles.md) に波及する。**
  060g の表示設定層（`.sd-comment-icon{display:revert!important}`＝`(0,1,0)` + `!important`）は、
  変換後のテーマが `!important` を持つと**負ける**。060g の「セレクタを 1 クラスに保つ」前提は
  本タスクで実際に破られたので、着手時に見直すこと。

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

- [x] chat の吹き出しが**二重にならない**（取り込んだ CSS のしっぽが StreamDock のしっぽを**置き換える**）
      ＝ DOM を `li > .row > p.sd-comment-body.sd-comment-text` の 1 枚に畳み、変換先を
      `.sd-comment-chat .sd-comment-text`（`(0,2,1)` > 既定の `(0,1,1)`）にした。⚠ **実機確認は残っている**
- [x] `unmatched` に残るのが「StreamDock に対応物が無いもの」だけになる
      （YouTube テーマの典型形で実測: `rewritten=13` / `unmatched=5`＝全部が画面部品を隠す指定）
- [x] `variant="default"`（本体コメビュ）に新しい安定クラスが 1 つも付かない（既存テストが `[class*="sd-comment"]` で固定）
- [x] `pnpm test`（CSS guard 含む）／`typecheck`／`lint` が緑（**1080 passed / 44 files**）。**Rust 差分ゼロ**
- [x] ⚠ 意匠 CSS の**非コメント差分ゼロ**（「既存意匠を 1px も変えない」の機械的な担保）
- [x] ⚠ ミューテーション **10 種すべて KILLED**
- [x] ⚠⚠ **security-review**（別チャット・2026-08-05 実施）——セキュリティは「軽微な懸念あり」（修正必須なし）。
      S-1 / S-2 / S-3 / Q-2 / Q-4 / Q-5 / Q-6 / Q-9 は反映済み（progress.md 060f 節の「反映済み」表）
- [x] ⚠⚠⚠ **Q-1: 複合 `to` の二重前置（修正必須）→ 修正済み（2026-08-06・方式 B）**
      ＝ `to` を「1 要素の複合セレクタ」に限り、限定は `sd-comment-in-chat` / `sd-comment-in-tip` で表す。
      静的ガード **(10-l)** ＋**全順序対 17×17 の総当たりテスト**で機械化・**ミューテーション 3 種 KILLED**。
      ⚠ 実機確認の項目に「`親 子孫` 形のテーマが当たること」を足してある
- [x] ⚠⚠ **変換表 × 実 DOM の突き合わせテスト**（`CommentList.selectorContract.test.tsx`・9 件）
      ＝「変換されたのに当たらない」を `querySelectorAll` で機械的に塞いだ。**ミューテーション 5 種 KILLED**。
      ⚠ このテストで**子結合子（`>`）の既知の限界**が新たに判明（060f の回帰ではない・060c へ申し送り）
- [x] ⚠⚠ **実機確認の 1 巡目 → 差し戻し 2 件を追修正済み（2026-08-08）**
      ①**しっぽの二重**（既定の `::after` が孤児として残る＝**本ファイルの「二重ではなく置き換えになる」は誤り**）
      → テーマ CSS の手前に固定リセットを前置＋既定のしっぽを `@layer sd-tail` へ
      ②**アイコンを消すと名前行だけインデントが残る** → `.item` を 2 列グリッド化しアイコンを `<li>` 直下へ
      ⚠ **静的ガード (10-m) 新設**・ミューテーション 7 種 KILLED・**1105 passed**。詳細は progress.md 060f 節
- [x] ⚠⚠ **実機確認の 2 巡目 → 差し戻し②を追修正済み（2026-08-08）**
      原因は**既定の吹き出しが「テーマが越えられない床」**になっていたこと 1 つ（2 枚のスクショの両方）。
      → ①`.bubble` 一式を `@layer sd-default` へ ②リセットを**装飾一式＋ `--sd-icon-gap: 8px`** へ拡張
      ③受容した挙動（テーマを選ぶと既定装飾が引っ込む）を UI に 1 行で明示。
      ⚠ (10-m) を「`.bubble` がレイヤーの**中**にあること」まで見る形へ強化
      （旧版は `@layer` の存在だけを見ており、**`.bubble` を外へ出す変異が生存していた**）。
      ミューテーション **9 種 KILLED**・**1115 passed**。詳細は progress.md 060f 節「差し戻し②」
- [ ] ⚠⚠ **実機確認の 3 巡目**（差し戻し②の確認・下記）
  - [ ] **テーマ未適用**で chat 吹き出し（とくに**しっぽの継ぎ目**・パディング・名前行のインデント）・
        スパチャ・サブスク・**固定コメント窓**が実装前と同じ
        ⚠ **`.bubble` をレイヤーで囲んだだけなので理屈上は不変**だが、意匠 CSS を触る以上ここが唯一の担保
  - [ ] 検証01（ピンク）＝ 吹き出し 1 枚・しっぽ 1 枚・**アイコンとのすき間が詰まる**・**既定の影が消える**
  - [ ] 検証02（黄色）＝ **平らな黄色い帯**（枠/角丸/影なし・余白あり）。
        ⚠ 課金カードのボディが**青のままで正しい**（`.sd-comment-text` は chat と課金の共通語彙）
  - [ ] ⚠⚠ `.sd-comment-text{color:red}` だけのテーマ＝**吹き出しが消えて素の赤文字になる**
        （受容した挙動。ここで「困る」と感じたら方式を再検討する）
- [x] ⚠⚠ **実機確認の 3 巡目 → 差し戻し③を追修正済み（2026-08-08）**
      ①**しっぽの幾何がテーマの疑似要素へ漏れていた**（`content` しか止めていなかったので、テーマが
      `content:""` で復活させると `top` / `width` / `border-*-width` 等が既定のまま効く）→ **`all: unset`**
      ②**実サンプルの縦バーが出ない**（`.yt-live-chat-text-message-renderer::before` は**クラス形**で
      変換表に無く、`.sd-comment` に `position: relative` も無かった）→ **変換表 18 件目 ＋ リセットに
      `:where(.sd-comment){position:relative}`**。⚠ **意匠 CSS の変更はゼロ**。
      ミューテーション **7 種 KILLED**・**1119 passed**・**(10-a)〜(10-m) は無改修で緑**。
      ⚠ 実サンプルに残る差分は**書体だけ**になった（→ 060h）。詳細は progress.md 060f 節「差し戻し③」
- [ ] ⚠⚠ **実機確認の 4 巡目**（差し戻し③の確認・progress.md 060f 節「差し戻し③」の表と検証 CSS を使う）
  - [ ] 検証01（**修正版**）＝ しっぽの底辺が枠にぴったり付き、先端がアイコンの手前で止まる
  - [ ] 検証04（**文字でしっぽ**）＝ `◀` が素直に出る（幾何の漏れが塞がったことの確認）
  - [ ] 実サンプル ＝ ⚠⚠ **`#555555` の縦バーが本文の左に出る**（書体だけ違う）
  - [ ] 実サンプル（YouTube 由来の CSS）を取り込んだとき、**課金カードの見た目が変わらない**
  - [ ] 吹き出しが二重にならない（⚠ 三角が「置き換え」ではなく「合成」に見えないか）
  - [ ] `unmatched` を**実サンプルで再測定**する（本ファイルの数字は再構成サンプルでの実測値）
  - [ ] プレビューでも同じ結果／コメビュ窓の他が壊れない
  - [ ] `.sd-comment{…}` を直接書いたテーマは**従来どおり chat と課金の両方に当たる**（受容した仕様）
  - [ ] ⚠ `yt-live-chat-app { background: #fff }` のテーマで**窓が全面不透明になる**ことと、
        「既定のデザインに戻す」で復帰できること
  - [ ] ⚠⚠ **Q-1 の修正の実機確認**——`.chat-line__message .chat-line__message-body` /
        `span.chat-author__display-name` のような **`親 子孫` / `型セレクタ + クラス`** 形を含むテーマで、
        指定が**実際に当たる**こと（修正前は「変換しました」と出るのに何も変わらなかった）
  - [ ] ⚠ **060d / 060e の未実施ぶん**（progress.md の各節）も併せて消化する

---

## ❌ 追修正⑤（2026-08-08）—— **【撤回済み】** プレビュー枠の固定高でスパチャが枠外に落ちていた

> ❌❌❌ **入っていない。以下は当時の記録である**（撤回の経緯は下の「追修正⑤⑥は撤回した」節）。
> `.themePreview` は **`height: 200px`（元のまま）**。現行の修正は「追修正⑦」の 1 宣言だけ。
> ⚠ **この節を読んで `min-height` を入れ直さないこと。**
> ⚠ ただし**調べ方（ヘッドレス Chrome で実物と同じ条件を描画する）と実機確認の前提は有効**なので残す。

本人報告「デザイン1・検証2・検証3 でスパチャが出ない／クリックして選択すると出てくる」の原因。

- **本体は DOM でも変換でもない**。`.themePreview`（`CommentViewerApp.module.css`）が
  `height: 200px` 固定で、ダミー 2 件目の**課金カードが枠の下からはみ出していた**
  （実測: 枠幅 520px・テーマ未適用で **+22px はみ出し**／枠幅 420px・検証3 で **+18px**）。
  カード自体は**どのテーマでも常に 99px で正しく描かれている**。
- 修正は 1 行（`height` → `min-height`）。⚠ **`overflow: hidden` と `contain: paint` は据え置き**
  （060d security-review S-2 の安全装置・静的ガード (10-j)）。
- ⚠⚠ **調べ方を変えた**——ヘッドレス Chrome に「実データのテーマ ＋ 実物の変換 ＋ 実物の CSS
  （CSS Modules のハッシュ化を prefix で再現）＋ `CommentList.tsx` が吐くとおりの DOM」を食わせ、
  `--dump-dom` で Computed 値を機械で取る。**手順は progress.md の「差し戻し⑤」節が正。**
  これで **症状 3（本文色 `#555555` と縦バーが出ない）も現行コードでは出ない**ことを実測した
  （本文 `<p>` の Computed `color` ＝ `rgb(85,85,85)`・縦バーも描画）。
  ⇒ **「実機で観測してください」と丸投げする前に、まずこの手順で測ること。**

### ⚠ 実機確認の前提（毎回）

`pnpm tauri dev` を**完全に落として起動し直す**。Vite の HMR は**別 webview（配信窓）まで確実には
届かない**ので、直後の確認は修正前のバンドルを見ていることがある（差し戻し⑤で実際に起きた）。

---

## ❌ 追修正⑥（2026-08-08）—— **【撤回済み・原因診断が誤り】** 追修正⑤の `min-height` が描画バグを生んだので固定高へ戻す

> ❌❌❌ **入っていない。しかも下の「原因」は実測で否定されている**（`contain: none` にしても再発する＝
> `contain: paint` は無関係／そもそも**画面外に置いた WKWebView で撮った偽の再現**だった）。
> ⚠⚠ **下の「ガード: (10-j) を拡張——`min-height` / `max-height` があれば落とす／`height` が固定値で
> なければ落とす」は実装していない。** 現行の (10-j) が固定するのは
> `contain: paint` / `overflow: hidden` / `transform: translateZ(0)` の 3 宣言である。
> 真因と現行の修正は下の「追修正⑦」節が正。⚠ **この節の指示に従って作業しないこと。**

- 症状: **全テーマでプレビューの課金カードが描かれない**。⚠ **ドラッグ選択すると出てくる**（本人報告）。
- 原因: `.themePreview` の **`contain: paint` の切り抜き矩形が、WKWebView では要素のリサイズに追随しない**。
  追修正⑤で `min-height` にした＝枠が後から伸びるようにしたのが引き金（テーマ CSS の注入は**非同期**なので、
  枠は 200px で描かれた後に伸びる）。**レイアウトは正しく描画だけが古い**（選択＝強制再描画で直るのが根拠）。
- 修正: **`height: 260px`（固定）**。⚠ `overflow: hidden` / `contain: paint` は据え置き。
  ⚠ React の `key` で枠を作り直す回避策は**採らない**（ウィンドウ幅の変更で再発するため）。
- ガード: **(10-j) を拡張**——`.themePreview` に `min-height` / `max-height` があれば落とす／
  `height` が固定値でなければ落とす。⚠ jsdom では守れないのでここが唯一の受け皿。

### ⚠ 実機確認（WKWebView でしか出ないので、ここが本番の受け皿）

⚠ **前提: `pnpm tauri dev` を完全に落として起動し直す。**

- [ ] プレビューを ON にして 5 テーマを順に選ぶ → ⚠ **どこもクリック・選択せずに**
      課金カードが最後まで出る
- [ ] テーマを連続で切り替える → 毎回正しく描き直される（古い意匠が残らない）
- [ ] 設定ウィンドウの幅を変える → 枠の中身が欠けない
- [ ] 「既定のデザインに戻す」 → 既定意匠へ戻り、カードも出る

---

## ⚠⚠⚠ 追修正⑤⑥は撤回した（2026-08-08・差し戻し⑦）

`.themePreview` の高さは **`height: 200px`（元のまま）**。⑤（`min-height`）も⑥（`height: 260px`）も
**本人環境の症状を直さず**、⑥の原因診断（`contain: paint` の切り抜き矩形）は**実測で否定された**
（`contain: none` にしても直らない／テーマ未適用でも同じ／そもそも**画面外の窓で撮ったスナップショット
という偽の再現**だった）。経緯と、そのとき確定した事実・調査ハーネスの作り方は progress.md の
「差し戻し⑦」節が正。

⚠ **教訓: 再現できていない不具合を直しに行かない。** 2 回続けて外した。

---

## ✅ 追修正⑦（2026-08-08）—— 有力な回避策を実測で確認: `.themePreview { transform: translateZ(0) }`

> ⚠⚠⚠ **「真因確定」とは書かない**（レビュー指摘 Q-2・2026-08-08 で格下げ）。**本人環境での確認待ち**。
> 理由＝ **再現の向きが本人症状と逆**である。実測で再現したのは「**テーマ → 既定**へ戻す向き」3/7 で、
> 本人の症状は「**テーマを当てると消える**」。したがって
> 「7/7 正常・画素差分 0」が証明しているのは「**入れても悪化せず、実測できた同型のバグは消える**」までで、
> 「**本人の症状が直る**」ではない。⑤⑥で 2 回続けて「確定」と書いて外した直後なので、ここは慎重に扱う。
> ⚠ **実機で本人症状が消えたら「真因確定」へ昇格させること**（下の実機確認チェックリスト）。

⑤⑥（枠の高さをいじる案）は**どちらも誤り**で撤回済み。仮説は **WKWebView がテーマ切替時に
プレビューの課金カードの領域を再描画しない**こと。⚠ 本人の観測「**ドラッグ選択すると出てくる**」で
「レイアウトは正しく描画だけが古い」までは確定している（＝はみ出し・`display:none`・カスケード負けは除外）。

- 修正は 1 宣言（`.themePreview` に `transform: translateZ(0)`）。**画素差分 0**＝見た目は変わらない。
- ⚠ `contain: paint` は**無関係**（`contain: none` でも再発）。⑥の診断は誤り。
- ⚠ `will-change` / `isolation` / `backface-visibility` では**直らない**（実測）。この非対称は
  「合成レイヤーへの昇格」という説明と整合的で、診断の筋としては⑥より質が高い。
- ⚠ 当て先を `.sd-preview` / `.sd-comment-list` / `.sd-comment` へ移さないこと（ユーザー CSS に上書きされる）。
- **再現手順は progress.md の「追修正⑦」節が正**（実物のコンポーネント＋ div 内スクロール＋
  **画面内の窓**＋`afterScreenUpdates: false`＋**テーマ遷移**——1 つ欠けると再現しない）。
- ⚠ **恒久策ではない**（エンジン固有の回避策を意匠 CSS に埋めている）。恒久策は
  **プレビューを shadow root / iframe へ移すこと**で、そこへ移せば構造で閉じるのでこの宣言は不要になる。
  静的ガード **(10-j)** と `.themePreview` のコメント、`docs/security.md` 060d 節の 3 か所に
  再修正トリガーとして記録済み。
- ⚠ **`docs/security.md` の 060d 節に記載した**（レビュー指摘 S-2・2026-08-08）。
  理由＝ `contain: paint` / `overflow: hidden` と**同じルールに同居し同じ (10-j) が固定している**宣言なので、
  安全装置の集約点に載っていないと「意匠だから」と消される。⚠ 封じ込めは**弱まらない**
  （`transform` は包含ブロックとスタッキングコンテキストを**作る**側＝ `contain: paint` の役割を二重化する）。

### ⚠ 実機確認（**ここが済むまで⑦は「確認待ち」**）

⚠ **前提: `pnpm tauri dev` を完全に落として起動し直す**（HMR は別 webview へ確実には届かない）。

- [ ] **本人環境で、テーマを当てたときに課金カードが消える症状が出ないこと**（＝これが本命）
- [ ] プレビュー ON でテーマを順に切り替える → ⚠ **どこもクリック・選択せずに**課金カードが出続ける
- [ ] 「既定のデザインに戻す」で既定へ戻したときもカードが出る（＝再現した向き）
- [ ] 配信窓（`OverlayApp`）でも同じ症状が出ないか観察する（出たら下の「配信窓に入れていない理由」を読む）

### ⚠ 実機確認

- [ ] プレビューを開いたままテーマを**何度も切り替える** → 毎回、課金カードが最後まで出る
      （⚠ **どこもクリック・選択せずに**）
- [ ] 「既定のデザインに戻す」→ 戻したときも課金カードが出る
- [ ] 配信窓（`comment-overlay`）でも同じ症状が出ないか（出たら `.root` ではなく内側ラッパで対処する）
