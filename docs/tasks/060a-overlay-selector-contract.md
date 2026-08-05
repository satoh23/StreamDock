# 060a オーバーレイのセレクタ契約＋セレクタ変換表

> 状態: **実装済み（2026-08-04）／⚠⚠ 契約は [060f](060f-overlay-dom-alignment.md) で拡張される（2026-08-05）**。
> ⚠ **実装後の実際の姿は [`docs/progress.md`](../progress.md) の 060a 節が正**
> （本ファイルは着手前の設計メモで、下記「実装で判明した前提と訂正」以外は当時のまま残してある）。
> 分割・線引きは親 [060](060-overlay-custom-css.md) を正とする。
>
> ⚠⚠ **本ファイルの契約は 060d/060e を実サンプルで通した結果、2 点足りないことが実測で判明した**（2026-08-05）:
> ① **`.sd-comment` が chat と課金の両方に付いている**のに、変換表は YouTube の
> 「テキストコメント**専用**」レンダラをそこへ対応させている＝ **chat 用 CSS が課金カードを壊す**
> ② **`.header` / `.row` / `.cardHeader` / 一覧の `<ol>` に安定クラスが無い**。
> → **修正と拡張は [060f](060f-overlay-dom-alignment.md) が担当**（`sd-comment-chat` ほか 4 クラス追加・変換表の向き先変更）。
> ⚠ また `cssCompat.ts` の「**`.sd-overlay` は変換表に入れない**」というコメントは、
> 060d が `.sd-overlay` → `.sd-preview` の読み替えを実装したことで**既に古い**（060f で訂正する）。

## ⚠ 実装で判明した前提と訂正（2026-08-04）

着手時の調査で、本ファイルが前提にしていなかった事実が 5 点見つかった。**行番号は書かない**（特定はシンボル名で）。

1. ⚠⚠ **`rewriteSelectors()` を呼ぶのは 060b ではなく 060d（注入時に毎回）。**
   下の「## 目的」の括弧書き「（[060b] が取り込み時に適用する）」と親 060 (2) の「取り込み時に」は**古い記述**。
   [060b](060b-custom-css-import-backend.md) が「**セレクタ変換はここでは行わない／保存するのは変換前の CSS／
   変換は注入時に frontend が毎回行う**」（変換表の更新が取り込み済みテーマにも効くようにするため）と決めており、
   [060d](060d-css-theme-management-ui.md) と task-board もそちらで揃っている。
   → **帰結**: 注入とプレビュー表示のたびに毎回走るので、**決定性と冪等性が機能要件**になる
   （本ファイルには書かれていなかった要件。テストと静的ガード (10-c) の両方で固定した）。
2. **固定コメントオーバーレイ窓（046b の `PinnedOverlayApp`）が同じ描画を共有している。**
   `CommentList variant="overlay"` と `OverlayApp.module.css` の `.root` をそのまま使っているため、
   `renderOverlayItem` への追加は**固定窓の DOM にも自動的に出る**。
   → 安定クラスと data 属性は**出す**（注入経路が無い限り無害）。窓ルートの `sd-overlay` は
   **`OverlayApp.tsx` にだけ**付けて窓を分けた（060d の「注入先は `comment-overlay` のみ」と構造で一致）。
   ⚠ 046c の `applyFitScale` が固定窓の `.root` の `transform`/`width`/`height` を**排他所有**しているので、
   そこをユーザー CSS に触らせる的を作らない、という理由もある。静的ガード (10-d) が両方向を固定している。
3. **`.item` はローカル CSS 変数 `--icon-size` / `--icon-gap` を自分で宣言している。**
   祖先に `--sd-icon-size` を書いても自分の宣言が勝つので、**既定値の側**を
   `--icon-size: var(--sd-icon-size, 44px)` と読み替える形にした（`--icon-gap` も対で公開）。
4. **一覧の `<ol>`（`.list`）は `CommentViewerApp.module.css`＝本体コメビュと共有。**
   `--sd-comment-gap` を `.list` の `gap` で表現すると本体 UI に波及する。かつ `.card` が `.item` の
   `padding`/`gap` を打ち消すため padding 側でも非対称になる。→ **`.item` の `margin-block`（新設・既定 0px）**
   に載せた（chat と課金の両方に対称に効き、意匠は 1px も動かない）。
5. **CSS 変数を `.root` に「定義」してはいけない。**
   `--sd-comment-radius` の当て先は `.bubble`（14px）と `.card`（12px）で**既定値が違う**ため、
   1 箇所に定義すると片方の実値が動く＝下記「既存の意匠は 1px も変えない」に反する。
   → 既定値はすべて**参照側のフォールバック** `var(--sd-X, 現行値)` に置いた。
   副産物として 060d のプレビュー（`.sd-preview` 配下＝`.root` の外）でも意匠が保たれ、
   `OverlayApp.module.css` は差分ゼロになった。

**設計の変更点（本文の記述からの差分）**

- **`data-sd-tone` は課金分岐のみ**に付けた（本文は `sd-comment` 全件に付ける読みだった）。
  `monetaryTone()` は chat を `"t0"` へ無害劣化させるので、付けると `[data-sd-tone="t0"]` で
  「最低額スパチャだけ光らせる」と書いたユーザー CSS が**全 chat にも当たる**。
- **CSS 変数は 6 個 → 9 個**（`--sd-comment-border` / `--sd-name-outline` / `--sd-icon-gap` を追加）。
  いずれも「複数箇所が連動しないと壊れる値」で、クラス指定では擬似要素や 5 層の text-shadow が取り残される。
- **変換表から単独の `#img` / `#message` / `#author-name` を外した**（ユーザー自身の id を壊しうるため
  祖先付きの形だけ入れた）。`unmatched` の判定にも裸の id は入れない（誤検知が警告を殺す）。
- **`unmatched` は「セレクタの種類数」**（ルール数ではない）。`rewritten` はルール単位。

**実サンプル CSS での検証（2026-08-04 受領・完了）**

- YouTube / Twitch とも **`rewritten=1` / `unmatched=[]` / 冪等**で変換成功。逐語で `cssCompat.test.ts` の
  フィクスチャにした（⚠ 意匠の実体である第三者資産＝ruri.info の CSS は**コピーしていない**・URL のみ）。
- `:root { --txtcolor }` は無改変かつ**警告に載らない**——`unmatched` を「sd 語彙でない全セレクタ」ではなく
  **接頭辞ベース**にした判断が、実サンプルの時点で裏付けられた（前者だと 1 本目から警告がノイズになっていた）。
- ⚠⚠ **実サンプルには意匠がほとんど無い。** 中身は外部 `@import` 1 行＋書体指定＋`--txtcolor` だけで、
  吹き出しのデザインは**丸ごと外部 CSS の中**。→ **060b＋060d まで作っても「書体しか変わらない」**、
  [060c](060c-external-css-snapshot.md) で初めて意匠が出る＝**060c はこの依頼者にとって payload そのもの**。
  「セレクタ契約が実用に足るか」という 060 の中心的な問いも、外部 CSS の中身を見るまで答えが出ない。
  詳細と 060d への追加の申し送り（`scopeSelectors` が `:root` を素通しできない件）は progress.md 060a 節。
>
> **必読前提**: 親 [060](060-overlay-custom-css.md)、
> オーバーレイ描画 [`CommentList.tsx`](../../apps/desktop/src/screens/comment-viewer/CommentList.tsx)（`renderOverlayItem`）と
> [`OverlayApp.tsx`](../../apps/desktop/src/screens/comment-viewer/OverlayApp.tsx)、
> 意匠 CSS [`OverlayComment.module.css`](../../apps/desktop/src/screens/comment-viewer/OverlayComment.module.css)、
> ティア配色 [`monetaryTone.ts`](../../apps/desktop/src/screens/comment-viewer/monetaryTone.ts)（`OVERLAY_TONE_CLASS`）、
> 静的ガード [`check-css-guards.mjs`](../../apps/desktop/scripts/check-css-guards.mjs)、
> [`docs/security.md`](../security.md)（§1／## CSP方針）。
> CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。**軽レビュー**。
>
> ⚠ **行番号は書かない**（特定はシンボル名で行うこと）。

## 目的

ユーザーが持ち込むカスタム CSS が**狙える的**を作る。具体的には 2 つ。

1. **セレクタ契約** — オーバーレイ DOM に、ビルドでハッシュ化されない**安定クラス名**・**data 属性**・**CSS 変数**を併記する。
2. **セレクタ変換表** — YouTube / Twitch 純正チャット向けの既存 CSS を、上記の語彙へ**機械的に書き換える**純関数
   （[060b](060b-custom-css-import-backend.md) が取り込み時に適用する）。

**既存の意匠は 1px も変えない。** 本タスクは DOM に属性とクラスを足すだけで、見た目は完全に不変。

## 現在の前提（調査結果・実コード）

- オーバーレイの DOM は `CommentList` の `renderOverlayItem` が組み立てる。分岐は 2 つ:
  - **chat**（`displayEventType(c) === "chat"`）= `item` > (`header` > `name` [+ `source`]) + (`row` > `icon` + (`bubble` > `text`))
  - **課金**（それ以外）= `item card <toneClass>` > (`cardHeader` > `icon` + `cardName` [+ `source`] [+ `amountBadge`]) + (`cardBody` > [`eventMessage`] [+ `cardText`])
  - クラスはすべて `OverlayComment.module.css` の CSS Modules 由来＝**ビルドでハッシュ化される**。
- ルートは `OverlayApp` の `<div className={styles.root} style={{ fontFamily: … }}>`。
  透過は `document.documentElement` の `data-overlay="1"` ＋ `OverlayApp.module.css` の属性ガード付き `:global`。
  → **`data-*` を root に立てて `:global` で受ける前例が既にある**（同じ作法を使う）。
- アイコンは `background-image: url("data:...")` をインラインで当てている。**036a のガード
  （`avatarDataUri`）で data URI 以外は踏まない**という §1 の不変条件を背負っている。
- [`check-css-guards.mjs`](../../apps/desktop/scripts/check-css-guards.mjs) が「テストで守れない不変条件」を静的に検査している
  （`pnpm test` から実行）。**クラス名の契約はまさにここで守るべき類のもの。**
- ⚠ サンプル CSS の YouTube 側は **カスタム要素名 + id**（`yt-live-chat-text-message-renderer #message`）、
  Twitch 側は **クラス名**（`.chat-line__no-background`）と**形が違う**。
  DOM 側で両方を再現するのは非現実的（重複 id・他社仕様への依存）＝**変換で吸収する**（親 060 の決定）。

## このタスクでやること

### (1) 安定クラス名を DOM へ併記する

CSS Modules のクラスは残したまま、`sd-` 接頭辞の**素の文字列クラス**を併記する。

| 要素 | 安定クラス | 対応する既存クラス |
|---|---|---|
| オーバーレイのルート | `sd-overlay` | `OverlayApp.module.css` の `root` |
| コメント 1 件（chat / 課金 共通） | `sd-comment` | `overlayStyles.item` |
| 課金カードであること | `sd-comment-tip` | `overlayStyles.card` |
| 投稿者名 | `sd-comment-name` | `overlayStyles.name` / `cardName` |
| サイト名バッジ | `sd-comment-source` | `overlayStyles.source` |
| アイコン | `sd-comment-icon` | `overlayStyles.icon` |
| 吹き出し／カード本体 | `sd-comment-body` | `overlayStyles.bubble` / `cardBody` |
| 本文テキスト | `sd-comment-text` | `overlayStyles.text` / `cardText` |
| 金額バッジ | `sd-comment-amount` | `overlayStyles.amountBadge` |
| 種別の要約文 | `sd-comment-event` | `overlayStyles.eventMessage` |

- ⚠ **chat と課金で「同じ役割」には同じ安定クラスを当てる**（例: `text` と `cardText` はどちらも `sd-comment-text`）。
  ユーザーは「本文の色を変えたい」としか思っておらず、内部の分岐を知らない。
  **既存の CSS Modules クラス名をそのまま `sd-` にしただけの写像にしないこと。**
- 付け方は `className={`${overlayStyles.item} sd-comment`}` の素朴な連結でよい（既存の連結パターンと同型）。

### (2) data 属性で出し分けのフックを作る

- `sd-comment` に **`data-sd-source="youtube" | "twitch"`** を付ける（プラットフォーム別の出し分け）。
- `sd-comment` に **`data-sd-event="chat" | "superchat" | "subscription" | …`** を付ける
  （`displayEventType(c)` の戻り値をそのまま使う＝**表示分岐と同じ判定**にする）。
- ⚠ **ティア（金額段階）も出す**: `data-sd-tone` に `monetaryTone(c)` の戻り値を入れる。
  既に `OVERLAY_TONE_CLASS` で配色を引いているので、**同じ値を属性にも出すだけ**。
  これが無いと、ユーザーは「高額スパチャだけ光らせる」ができない。

### (3) CSS 変数を公開する

- `OverlayApp.module.css` の `.root` に、ユーザーが上書きしやすい変数を定義する。
  実値は**既存の意匠から動かさない**（変数化するだけ＝見た目は不変）。
  - `--sd-comment-bg` / `--sd-comment-fg` / `--sd-comment-radius` / `--sd-comment-gap`
  - `--sd-name-fg` / `--sd-icon-size`
- ⚠ **既存の CSS Modules 内の実値を変数参照に置き換える**こと。変数を定義しただけで
  実際のプロパティが直値のままだと、ユーザーが変数を上書きしても何も起きない
  （**「定義したが誰も読んでいない変数」は最悪の API**）。
- ⚠ [`docs/security.md`](../security.md) の「生 hex 禁止・トークンのみ」規約に従い、
  変数の既定値は `theme.css` のトークン参照にする（新しい生 hex を書かない）。

### (4) セレクタ変換表（新規 `cssCompat.ts`・純関数）

`features/comment-viewer/cssCompat.ts` を新設する。**CSS の完全パースはしない**（依存を増やさない）。
セレクタ部分の**文字列置換**に留める。

- `rewriteSelectors(css: string): { css: string; rewritten: number; unmatched: string[] }`
  - 既知の YouTube / Twitch セレクタを `sd-` 語彙へ置換する（下の変換表）。
  - **置換できなかったセレクタはそのまま残す**（消さない）。ただし `unmatched` に記録して呼び出し側へ返す。
- 変換表（初期版・実サンプルを起点にする。**網羅は目指さない**）:

| 元（YouTube 純正チャット） | 変換先 |
|---|---|
| `yt-live-chat-text-message-renderer` | `.sd-comment` |
| `yt-live-chat-text-message-renderer #message` | `.sd-comment-text` |
| `yt-live-chat-text-message-renderer #author-name` | `.sd-comment-name` |
| `yt-live-chat-paid-message-renderer` | `.sd-comment-tip` |
| `#img` / `yt-img-shadow` | `.sd-comment-icon` |

| 元（Twitch 純正チャット） | 変換先 |
|---|---|
| `.chat-line__no-background` | `.sd-comment` |
| `.chat-line__message` | `.sd-comment` |
| `.chat-line__message-body` | `.sd-comment-text` |
| `.chat-author__display-name` | `.sd-comment-name` |

- ⚠ **`@import` と `url()` には触らない**。それらは [060b](060b-custom-css-import-backend.md)（除去）と
  [060c](060c-external-css-snapshot.md)（スナップショット）の責務で、**ここで二重に処理しない**
  （2 か所で同じ入力を触ると、片方だけ緩んだときに気づけない）。
- ⚠ **`rewritten` / `unmatched` を返すのが本関数の要**。UI が「12 個のルールを変換しました／3 個は
  そのままです」と出せないと、ユーザーは**なぜ効かないのか永久に分からない**。

### (5) 静的ガードを足す（`check-css-guards.mjs`）

- 安定クラス名（`sd-comment` 等）が **`CommentList.tsx` / `OverlayApp.tsx` に存在すること**を検査する項目を追加する。
- ⚠ **これはテストでは守れない類の不変条件**。クラス名は**ユーザー CSS との契約**なので、
  リネームやリファクタで消えると「ユーザーのテーマが全部壊れる」が、
  StreamDock 側のテストは 1 本も落ちない（意匠は CSS Modules で保たれるため）。
  `check-css-guards.mjs` 冒頭の「コメントはファイル境界を越えない／同じバグ 3 回」と同型の判断。
- 変換表の**変換先クラスが実在すること**も同時に検査する（`cssCompat.ts` の右辺 ⊆ 実 DOM のクラス）。

### (6) テスト

- `cssCompat.test.ts`（新規）:
  - **依頼者が示した実サンプル 2 本**（YouTube / Twitch）を入力に取り、期待どおり変換されること
  - 未知セレクタが**そのまま残り** `unmatched` に載ること
  - `@import` / `url()` を**触らない**こと（そのまま通ること）
  - `rewritten` の件数が正しいこと
- `CommentList.test.tsx` に、overlay バリアントで**安定クラスと data 属性が付く**ことを固定する
  （chat / 課金 の両分岐・`data-sd-source` / `data-sd-event` / `data-sd-tone`）。
- ⚠ **既存の意匠テストが 1 本も落ちないこと**が、「見た目不変」の担保。
- **ミューテーションで実効性を確認**する。最低限、安定クラスの連結を 1 か所外したときにレッドになること。

## このタスクでやらないこと

- **CSS の取り込み・保存**（[060b](060b-custom-css-import-backend.md)）。本タスクは変換の純関数を置くだけで、誰も呼ばない。
- **外部 `@import` / `url()` の除去・取得**（[060b](060b-custom-css-import-backend.md) / [060c](060c-external-css-snapshot.md)）。
- **CSS の注入・テーマ切替 UI**（[060d](060d-css-theme-management-ui.md)）。
- **意匠の変更**。既存の見た目は 1px も変えない（変数化しても実値は同じ）。
- コメビュ本体（`variant="default"`）への安定クラス付与。対象はオーバーレイのみ。
- 変換表の網羅（純正チャットの全セレクタを拾わない）。**実サンプルが通る**ところから始め、
  要望が来たら足す（`unmatched` が観測手段になる）。
- CSS パーサライブラリの導入。**新規依存ゼロ。**

## セキュリティ制約（docs/security.md 準拠）

- **外部通信ゼロ**（§1）。本タスクは DOM に属性を足し、純関数を 1 つ置くだけ。
- **036a の data URI ガードを壊さない。** アイコンの `background-image` は `avatarDataUri` を通した値のみ
  という不変条件があり、`sd-comment-icon` クラスを足してもこのガードには触らない。
  ⚠ **ユーザー CSS が `.sd-comment-icon { background-image: url(...) }` で外部画像を差せてしまう**点は
  [060b](060b-custom-css-import-backend.md) の `url()` 除去が塞ぐ（本タスクの責務ではないが、
  **契約を作った時点で経路が生まれる**ので 060b と必ずセットで完成させること）。
- `csp: null` 不変・`tauri.conf.json` 差分ゼロ・新規 capability ゼロ・新規依存ゼロ。
- **frontend のみ**。Rust / sidecar は差分ゼロ。

## 完了条件

- オーバーレイの DOM に安定クラス（`sd-*`）・`data-sd-source` / `data-sd-event` / `data-sd-tone`・CSS 変数が入っている。
- **CSS 変数が実際に読まれている**（定義だけで実値が直値のまま、になっていない）。
- `cssCompat.ts` の `rewriteSelectors` が、**依頼者の実サンプル 2 本**を期待どおり変換し、
  `rewritten` / `unmatched` を返す。
- `check-css-guards.mjs` に安定クラスの存在検査が入り、`pnpm test` で走る。
- **既存の意匠テストが 1 本も落ちない**（見た目不変の担保）。
- 新規テストが通り、**ミューテーションで実効性を確認**している。
- **Rust / sidecar / capabilities / `tauri.conf.json` / 依存は差分ゼロ**・`csp: null` 不変。
- `pnpm --filter ./apps/desktop typecheck` / `lint` / `test` が通る。[`docs/progress.md`](../progress.md) を更新。

## 確認コマンド

```bash
git diff --stat
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
pnpm --filter ./apps/desktop test   # check:css（静的ガード）も含む

# ゼロ拡大の担保（差分ゼロが期待）
git status --short -- apps/desktop/src-tauri/ apps/comment-sidecar/ .github/
# 新規依存ゼロの担保（差分ゼロが期待）
git status --short -- apps/desktop/package.json pnpm-lock.yaml package.json

pnpm --filter ./apps/desktop tauri dev
# ① オーバーレイを開き、DevTools で sd-comment / data-sd-source / data-sd-event / data-sd-tone が付いているか
# ② DevTools のコンソールから `document.querySelector('.sd-overlay').style.setProperty('--sd-comment-bg','red')`
#    で背景が変わる（＝変数が実際に読まれている）
# ③ **見た目が実装前と同じ**であること（chat / スパチャ / サブスク の 3 種で比較）
```

## 実装後に必要なレビュー

- **軽レビュー**（[`code-review-light`](../../.claude/skills/code-review-light/SKILL.md)）。
  frontend のみ・新規通信ゼロ・新規依存ゼロ・意匠不変のため。
- ⚠ ただし「**036a の data URI ガードに触れていない**」ことだけは必ず確認する。
