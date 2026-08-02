# 060a オーバーレイのセレクタ契約＋セレクタ変換表

> 状態: **未着手（実装サブタスク）**。分割・線引きは親 [060](060-overlay-custom-css.md) を正とする。
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
