# 060c 外部 `@import` の取り込み時スナップショット（§1 例外の新設）

> 状態: **未着手（実装サブタスク）／⚠⚠ 実装は必須（2026-08-05 決定）**。
> 分割・線引きは親 [060](060-overlay-custom-css.md) を正とする。
>
> **必読前提**: 親 [060](060-overlay-custom-css.md)、**取り込み基盤 [060b](060b-custom-css-import-backend.md)（検証・保存の正）**、
> 管理 UI [060d](060d-css-theme-management-ui.md)（同意ダイアログの置き場所）、
> **allow-list ガード [`host-guard.ts`](../../apps/comment-sidecar/src/host-guard.ts)（`assertAllowedObsUrl` の分離の作法が手本）**、
> sidecar への制御フレーム [`commentStream.ts`](../../apps/desktop/src/features/comment-viewer/commentStream.ts)（`obs-enable` 等）と
> sidecar 側の受け口 [`index.ts`](../../apps/comment-sidecar/src/index.ts)、
> 外部取得→data URI 化の先例 [036b](036b-sidecar-avatar-fetch-youtube.md) / [036c](036c-sidecar-avatar-fetch-twitch.md)、
> §1 例外の書き方の先例 [032c-b](032c-b-node-sidecar-twitch-comments.md) / [055](055-app-self-update.md)、
> [`docs/security.md`](../security.md)（**§1 外部通信／§8／§9／§10／レビュー必須条件**）。
> CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。
> **security-review 必須**（§1 に例外節を新設する＝本リポジトリで最もリスクの高い種類の変更）。
>
> ⚠ **行番号は書かない**（特定はシンボル名で行うこと）。
>
> ## ⚠⚠ 060f の実機確認（2026-08-08）で判明した、本タスクが必ず踏む 2 つの穴
>
> 依頼者の実サンプルの外部 CSS を**手作業で展開して**取り込み、実測して分かったこと。
> **どちらも 060c が外部 CSS を自動で取り込み始めた瞬間に主流の入力になる。**
>
> 1. ⚠⚠ **`.yt-*` の「クラス形」は変換も警告もされない。** 変換表の `from` は要素名形
>    （`yt-live-chat-text-message-renderer`）で、`compileFrom()` の前方境界が**直前の `.` を禁じる**ため
>    `.yt-live-chat-text-message-renderer::before` に当たらない。しかも `FOREIGN_SELECTOR_RE` の
>    lookbehind `(?<![A-Za-z0-9_.#-])ytd?-…` が `.yt-` を弾くので **`unmatched` にも載らない**。
>    ＝ **実サンプルの看板デザイン（吹き出し左端の縦線アクセント）が、警告ゼロで出ない。**
>    ⚠ YouTube の Polymer は scope class を子孫にも撒くので、この形は**実テーマで典型的**。
> 2. ⚠⚠ **プレビューと配信窓で `body` の扱いが非対称**（実測）。`body{margin:6px auto; letter-spacing:.1em;
>    line-height:1.8; font-weight:bold}` は変換表に無いので**変換されない**が:
>    - **プレビュー**: `scopeSelectors` の `ROOT_LIKE_CI` が `body` → **`.sd-preview` へ読み替える**（無害）
>    - **配信窓**: スコープ化しないので**本物の `<body>` に効く**（全要素へ継承）
>    ＝ **プレビューは本番を再現していない。** 外部 CSS には `body` がほぼ必ず入ってくるので、
>    「配信窓でも読み替える／落とす／そのまま通す」のどれにするかを**本タスクで決めること**。
>    ⚠ `body` を変換表に入れる案は **060f が明確に却下している**（窓の透過が壊せる＝静的ガード (10-k) が禁止）。
>
> ⚠ 実測の詳細は `docs/progress.md` の 060f 節「実機確認の差し戻し」。
>
> ### ⚠⚠ さらに 060f 追修正②（2026-08-08）で前提が 1 つ変わった
>
> **テーマを適用している間、StreamDock の既定の吹き出し装飾は注入時のリセットで引っ込む**
> （背景・枠・角丸・影・しっぽ・アイコンとのすき間。⚠ `position` と `padding` は残る）。
> ＝ **060c で外部 CSS を取り込んだあとの「忠実さ」の判定は、この前提で行うこと。**
> 「取り込んだのに吹き出しが素っ気ない」は**リセットが効いている正常な状態**で、直すべきは
> 「取り込んだ CSS がその装飾を描けているか」の側である。
> ⚠ リセットの内容は `apps/desktop/src/features/comment-viewer/overlayThemeReset.ts` が正。
>
> ### ⚠ 060f 追修正③（2026-08-08）で `.yt-*` クラス形の穴は **1 件だけ**塞いだ
>
> 実サンプルの看板デザイン（`.yt-live-chat-text-message-renderer::before` の縦バー）が出なかったので、
> **`.yt-live-chat-text-message-renderer` を変換表へ追加**した（クラス形のエントリはこれで 3 件目）。
> ⚠ **残りの穴はそのまま**——本タスクで外部 CSS を通すときにまとめて判断すること:
>
> 1. **総称 id**（`#content` / `#items` / `#card` / `#author-info` …）は**変換も警告もされない**。
>    実サンプルの `yt-live-chat-text-message-renderer #content{ text-indent:-0.5em; padding-left:8px }`
>    （＝縦バーと本文の間隔）が当たらないので、⚠ **バーが本文に近づく**。
>    ⚠ 足す判断は `FOREIGN_ID_NAMES` の「総称 id は入れない」（060a）と正面から衝突するので、
>    **実測してから**決めること（StreamDock 側に対応する器が無い点も併せて）。
> 2. **祖先がクラス形だと祖先付きエントリが当たらない**——`.yt-…renderer #message` →
>    `.sd-comment-chat #message`（要素形の前方境界が `.` を弾くため）。
>    ⚠ ただし裸 `#message` は `unmatched` に出るので「黙って効かない」にはならない。
> 3. **実サンプルに残る差分は書体だけ**になった（→ [060h](060h-external-font-snapshot.md)）。
> ⚠ **着手条件＝[060b](060b-custom-css-import-backend.md) ＋ [060d](060d-css-theme-management-ui.md) 完了**（通しで動く状態を見てから判断する）。
> ⚠⚠ **【決定・2026-08-05】本タスクは必須。「実装しない判断も残る」という当初の含みは無くなった。**
> 依頼者のサンプル CSS は**意匠の実体が丸ごと外部 `@import` の中**にあるため、本タスクが payload そのもので、
> 無ければ「書体しか変わらない」まま＝**依頼者の手持ち資産が事実上使えない**。
> ⚠ **「ユーザーがブラウザで URL を開いて view-source してコピペする」は代替にならない**
> （060e で貼り付け取り込みを足したときに一度そう書いたが、依頼者の指摘で**誤りとして取り消した**。
> 手間の問題ではなく、060 の目的「ユーザーが持っている CSS がそのまま使える」から外れる）。
> ⚠ **スコープの取り下げは実装者が判断してよい種類のものではない。**
>
> ⚠⚠ **【スコープ確定・2026-08-05】本タスクが取り込むのは「外部 CSS」までで、
> `@font-face` が参照する Web フォントの実体は [060h](060h-external-font-snapshot.md) が扱う。**
> 実サンプルが `@import` する外部 CSS は Google Fonts を 6 本 `@import` しており、
> それをインライン化しても中の `src:url(https://fonts.gstatic.com/…woff2)` は
> **060b のサニタイザが宣言ごと除去する**（許可形は `data:` のみ）＝ **本タスクだけでは書体は反映されない**。
> ⚠ **意匠は本タスクで出る**ので、価値の大半はここで届く。フォントは分けて後追いする。
> ⚠ **着手順は [060f](060f-overlay-dom-alignment.md) の後**——当たる先（DOM と変換表）が正しくなる前に
> 外部 CSS を取り込めるようにしても、課金カードを壊し吹き出しが二重になるだけで、原因切り分けが 2 層になる。

## ⚠ 本タスクで必ず出す案内（060h を待たずに価値を出すため）

取り込み結果に、**除去した `@font-face` / `@import` の宛先から拾ったフォント名**を添えて次を出すこと:

> 「このテーマは **○○** というフォントを指定していますが、StreamDock は外部からフォントを読み込みません。
> 端末にインストールすると反映されます。」

⚠ **§1 を一切曲げずにユーザーへ次の行動を示せる**ので、060h の完成を待たずに実装すること。

## ⚠⚠ テキスト取り込みコマンドは 060e が既に足した（着手前に必ず読むこと）

**060b 期の申し送り「テキスト版コマンドは未実装。060c は 10 行程度のコマンドを足すだけ」は無効である**
（060e で `import_overlay_theme_text` を実装済み・security-review② で指摘・2026-08-05）。

- 既存の `service::import_pasted_text` は **`origin = Local` 固定**なので、
  **本タスクの `Snapshot` 経路には再利用できない**（出自を騙れなくするために `origin` は
  Rust 側の呼び出し経路が定数で渡す設計。`the_theme_origin_is_never_settable_from_the_frontend` が固定）。
- ＝ 本タスクが足すのは **2 本目の `css: String` コマンド**になる。
  ⚠⚠ **そのとき契約テスト `takes_no_arbitrary_path_or_content_from_the_frontend`
  （`css: String` の出現回数 1）が設計どおり落ちる。**
  **数字だけ 2 へ書き換えて通してはいけない**——落ちること自体が
  **§3 の再評価と security-review を呼ぶための仕掛け**である（`docs/security.md` §5 の担保 2. が正）。
- 実体は **`store_sanitized_css` を `OverlayThemeOrigin::Snapshot` で呼ぶだけ**にすること
  （検証を別実装に分けない＝ 060b からの申し送りの核心は不変）。

## ⚠⚠ 着手時に必ず片付ける申し送り（060d の security-review から・2026-08-05）

**本タスクは `overlay_theme`（Rust）を触る最初の機会**なので、060d が Rust 差分ゼロのために
先送りした 2 件をここで確実に処理すること。**先に片付けてから (1) 以降へ進む。**

1. ⚠ **`overlay_theme/model.rs` の doc コメントの誤りを訂正する。**
   「取り込み前のファイルサイズは 060d 側が知っているので Rust に足すものは無い」と書かれているが、
   **これは事実誤認**（`plugin-dialog` の `open()` はパス文字列しか返さず、`plugin-fs` も asset protocol も
   無いので frontend は取り込み前のファイルを 1 バイトも読めない）。060d は Rust 差分ゼロを守るため
   **コメントを誤ったまま残した**＝いまコードと docs が食い違っている。
   ⚠ `docs/progress.md` の 060d 節にしか訂正が無いので、**`model.rs` だけを読む人には誤情報が届く。**

2. ⚠⚠ **`SanitizeOutcome` に `truncated_to_eof: bool` を足す**（060d review Q-1）。
   060d の `unclosedBlockDepth()` は「取り込み前後のサイズ比」の代替だが、**見落とす失敗モードがある**:
   壊れた `(` が**どのブロックにも入っていない位置**（`@import` / `@namespace` / グループ規則のプレリュード）に
   あると、除去が EOF まで達しても閉じ忘れが 1 つも残らず**深さが 0 のまま**になる。実測:

   ```text
   入力:  @media (min-width:1px){.sd-comment{color:red}}
          @import url(https://fonts.example/x.css      ← ) が無い
          .sd-comment{color:blue}
          .sd-comment-name{color:green}
   保存:  "@media (min-width:1px){.sd-comment{color:red}}"   ← 後半 2 行が黙って消える
   UI:    「取り込めない参照を 1 件除去しました」だけ（切り詰め警告は出ない）
   ```

   `@import` の `)` 忘れは現実的な打ち間違いなので、取り逃しの実害がある。
   判定は**除去範囲の終端が入力長に達したか**を見るだけでよい（`build_output` が持っている情報）。
   frontend 側は `truncatedToEof || unclosedBlockDepth(css) > 0` で警告する形へ変える
   （`unclosedBlockDepth` は別の失敗モードを見ているので**残す**）。

3. ⚠ **060d review S-4**: 060b の未解決 **S-5**（フラグメント無しの SVG data URI が `filter:` で
   リソース文書として fetch されるか）は、**060d が注入経路を開いたことで現実のリスクになった**。
   実測手順は `overlay_theme/sanitize.rs` の module doc（アプリ不要・5 分）。
   **本タスクの着手前提とする**——外部取得を足す前に、いま開いている経路の可否を確定させること。

## 目的

依頼者のサンプル CSS が依存している外部 `@import`（例 `@import url("https://ruri.info/tool/css/fukidashiComment.css")`）を
使えるようにする。ただし**実行時に外部へ出ない**形で。

**取り込み時に 1 回だけ取得し、CSS 本文をインライン化して保存する（スナップショット）**。以後は完全オフライン。

## 現在の前提（調査結果・実コード）

- [`docs/security.md`](../security.md) §1 は「**CDN からの script/css/image 読み込み**」を明示的に禁止し、
  「## CSP方針」も「**外部 style を読み込まない**」と書いている。**本タスクはこれを正面から破る**ので、
  §1 に例外節を新設するのが完了条件。
- §1 には既に**例外節が 7 件**ある（032c-c VOICEVOX loopback / 032c-b Twitch / 032c-d YouTube /
  036b・036c アバター CDN / 044a obs-websocket / 055 自己アップデート）。いずれも
  「**security-review 必須＋宛先 allow-list＋明示同意**」を条件に節を新設する形で通っている。**同じ形式で書く。**
- ⚠ **本タスクの宛先は allow-list で固定できない**（ユーザーが持ってきた CSS に書かれた URL）。
  これが既存 7 例外との**決定的な違い**で、本タスク最大の論点。
  → 「宛先の固定」の代わりに「**取得のたびにユーザーが URL を目で見て同意する**」＋
  「**取得できる形を極端に狭める**」で担保する（下記 (2)）。
- **通信面は sidecar に封じ込め**が絶対条件。main 窓は no-internet で、
  [`host-guard.ts`](../../apps/comment-sidecar/src/host-guard.ts) が global `fetch` を allow-list ガードで
  置き換えている（**fail-closed**）。
  ⚠ `assertAllowedObsUrl` が「**外部 HTTPS/WSS/gRPC の allow-list とは分離し、ここに loopback を混ぜない**」という
  **専用ガードを別関数として立てる作法**の手本になっている。本タスクも同じく専用ガードを立てる。
- sidecar → viewer の返信経路は既にある（`comments.append` / `session.state` / `account.state` の
  メッセージ種別と、viewer → sidecar の制御フレーム `obs-enable` / `obs-hide` / `obs-disable`）。
  **036 系が「sidecar が外部から取ってきたものを WS で viewer へ渡す」先例**（アバターの data URI）。

## このタスクでやること

### (1) 取得の入口（viewer → sidecar 制御フレーム）

- viewer が `theme-import.fetch`（仮）制御フレームで **URL を 1 本だけ**送る。
- sidecar が取得し、`theme-import.result`（仮）で **CSS 本文またはエラー**を返す。
- ⚠ **バッチ取得しない**（1 フレーム 1 URL）。CSS に `@import` が 3 本あれば、
  **3 回ユーザーに確認して 3 回送る**（下記 (3)）。
- ⚠ **再帰的な `@import` は追わない**。取得した CSS の中にさらに `@import` があっても、
  それは [060b](060b-custom-css-import-backend.md) の除去対象として消える。
  **追跡すると深さ無制限の外部取得になる**ので、1 段で打ち切る。

### (2) 専用ガード `assertAllowedThemeImportUrl`（`host-guard.ts`）

既存 allow-list とは**分離した専用関数**として立てる（`assertAllowedObsUrl` と同じ作法）。
以下を**すべて**満たさないものは throw（fail-closed）。

| 条件 | 理由 |
|---|---|
| スキーム が **`https:` のみ** | `http:` は中間者に書き換えられる＝任意 CSS を注入される |
| **userinfo（`user:pass@`）を持たない** | 既存ガードと同じ |
| ホストが **loopback / プライベート IP / `.local` / メタデータエンドポイント（`169.254.169.254`）でない** | ⚠ **SSRF 対策。ここが本タスク固有の最重要項目。**「ユーザーが URL を指定できる」＝ユーザーが自分の LAN や OBS の `127.0.0.1:4455` を叩かせられる。`assertAllowedObsUrl` は loopback を**許可**する関数なので、混同しないこと |
| ホストが IP リテラルでない（ドメイン名であること） | 上記の穴を素直に塞ぐ |
| ポートが **443（既定）のみ** | 任意ポートへの到達を防ぐ |
| パスが `.css` で終わる | 取得できる形を狭める |

### (3) 取得の実行（sidecar）

- **リダイレクトを追わない**（`redirect: "error"`）。⚠ 追うと (2) のガードを**リダイレクト先で迂回できる**。
  リダイレクトされたら失敗として返し、ユーザーに最終 URL を自分で指定してもらう。
- **タイムアウト**（例 10 秒）。`AbortController` ＋ `setTimeout`（標準 API のみ・新規依存ゼロ）。
- ⚠⚠ **サイズ上限は「512KB」ではなく `256KB − 既存 CSS 長` の動的値**（2026-08-05 060b review② で確定）。
  ⚠ `Content-Length` を信用せず、**読みながら打ち切る**
  （`Content-Length` は嘘をつける。055d の「DL サイズ上限なし」が既知課題として残っている先例）。
  - **なぜ 060b の 256KB を上げずに取得側を下げるのか**: 256KB は 060a の実測に紐づく**注入経路の予算**で、
    `rewriteSelectors` は **060d が注入のたびに毎回**走らせる。取得は 1 回・注入は毎回なので、
    **動かしてよいのは取得側**。上げると 060d の注入が重くなる。
  - **取得の前に `既存 CSS 長 + 取得上限 <= 256KB` を検査**すること。保存上限が事実上の合計上限である以上、
    取得に成功してから (5) の保存で落ちると**帯域も同意も無駄**になり、ユーザーには
    「同意したのに失敗した」としか見えない。
- **`Content-Type` が `text/css` であること**を確認する（HTML を CSS として保存させない）。
- **送信データはゼロ**（GET のみ・Cookie なし・Referer なし・カスタムヘッダなし）。
  ⚠ **ユーザーの識別子になるものを一切送らない**（§9）。
- 失敗は graceful に返す（hot-loop しない・リトライしない）。

### (4) ユーザーの明示同意（[060d](060d-css-theme-management-ui.md) の UI に載せる）

- 取り込み時に CSS 内の `@import` を検出したら、**取得前に必ずダイアログを出す**。表示する内容:
  - **取得先の完全な URL**（省略しない・ホストだけにしない）
    - ⚠⚠ **ホストを別途強調して併記すること**（2026-08-05 060b review② S-6）。`strippedImportUrls` は
      060b が `http(s)` の絶対 URL に限定し、**bidi / format 文字（U+202E 等）を含むものは載せない**
      ように直したが、**userinfo 付き URL（`https://ruri.info@evil.example/a.css`）は正当なので通る**
      ——完全な URL を素で出すと**先頭のホスト名に見えるほうを信じられる**。
      「取得先ホスト: `evil.example`」を URL とは別行で出すこと。
  - 「StreamDock が**この 1 回だけ**このアドレスから CSS を取得します」
  - 「取得した内容はテーマに保存され、**以後は通信しません**」
  - 取得しない選択肢（＝`@import` は除去され、そのぶんのデザインは効かない）
- ⚠ **既定は「取得しない」**（キャンセル側にフォーカス）。
- ⚠ **「今後確認しない」を作らない。** 宛先が固定できない以上、**毎回の同意が唯一の担保**。
- ⚠ **URL は同意画面に出したものと、実際に取得するものが同一**であることをコードで保証する
  （表示用と取得用で別々に組み立てない）。

### (5) 保存（[060b](060b-custom-css-import-backend.md) の Rust コマンドを再利用）

- 取得した CSS を元の `@import` の位置へ**インライン展開**し、その結果を
  [060b](060b-custom-css-import-backend.md) の import コマンドへ渡す
  （**テキストから取り込むコマンド**が要るので、060b の path 版に加えて 1 本足す）。
- **Rust 側の検証（サイズ・制御文字・外部 URL 除去）はそのまま全部通す。**
  ⚠ **取得した CSS の中に残っている外部参照（`url()` の画像・フォント・再帰 `@import`）は
  060b が除去する**＝実行時に外部へ出ないことがここで担保される。
  ⚠ **この結果、`@import` 先が外部画像に依存したデザインだと見た目が欠ける**。
  ユーザーには (4) の同意画面か取り込み結果で伝えること。
- `origin` は `'snapshot'` で保存する（`'local'` と区別＝どのテーマが外部由来かを後から分かるようにする）。

### (6) security.md §1 に例外節を新設

既存 7 例外と同じ形式で書く。必ず含める項目:

- **何を・いつ・どこへ**: カスタム CSS の取り込み時に 1 回だけ、ユーザー指定の HTTPS ホストへ GET
- **なぜ allow-list で固定できないか**、その代わりの担保（**毎回の明示同意**・スキーム/ポート/拡張子/リダイレクト禁止・
  **SSRF ガード**・サイズ/タイムアウト上限）
- **送信データはゼロ**（GET のみ・Cookie/Referer/カスタムヘッダなし）
- **実行時は通信しない**（スナップショット後は完全オフライン）
- **main 窓 no-internet は不変**（取得は sidecar のみ）
- **停止手段**: 取得しないという選択肢が常にある（＝機能を使わなければ egress ゼロ）
- ⚠ **`assertAllowedObsUrl`（loopback を許可）と `assertAllowedThemeImportUrl`（loopback を拒否）が
  逆向きのガードであること**を明記する。将来どちらかを触る人が取り違えないように。

### (7) テスト

- `apps/comment-sidecar/scripts/test-host-guard.mjs` に `assertAllowedThemeImportUrl` のケースを足す:
  - `http:` / userinfo 付き / loopback（`127.0.0.1` / `localhost` / `::1`）/ プライベート IP
    （`10.` / `192.168.` / `172.16-31.`）/ `169.254.169.254` / `.local` / IP リテラル / 非 443 ポート /
    `.css` 以外 → **すべて throw**
  - 正常な `https://example.com/a.css` → 通る
  - ⚠ **loopback を通してしまう変異でレッドになること**をミューテーションで確認する（本タスク最大の穴）
- 取得側のテスト（`test-theme-import.mjs` 新規）:
  - リダイレクトが失敗になること
  - サイズ上限を超えたら打ち切られること（**`Content-Length` が嘘でも**打ち切られること）
  - `Content-Type` が `text/html` なら失敗すること
  - タイムアウトが効くこと
- frontend 側: 同意ダイアログの既定がキャンセルであること・**表示 URL と送信 URL が同一**であること

## このタスクでやらないこと

- **実行時の外部読み込み**。スナップショット後は一切通信しない。
- **再帰的な `@import` の追跡**（1 段で打ち切る）。
- **外部画像・外部フォントの取得**。`url()` の中身は取りに行かない（060b が除去する）。
  ⚠ サンプルの吹き出しデザインが Web フォント（`Zen Kaku Gothic Antique`）を指しているが、
  **フォントは取得しない**（OS にあれば効く・なければフォールバック）。フォントの持ち込みは [039](039-font-import.md)。
- **allow-list への恒久的なホスト追加**。毎回の同意で通す（登録制にしない）。
- 「今後確認しない」チェックボックス。
- 取得内容のキャッシュ・再取得・更新チェック。**スナップショットは撮ったら固定**（更新したければ入れ直す）。
- main 窓からの直接取得（sidecar のみ）。

## セキュリティ制約（docs/security.md 準拠）

- **§1 に例外節を新設する**（本タスクの完了条件）。既存 7 例外と同じ形式。
- **取得は sidecar のみ。main 窓 no-internet は不変。**
- **専用ガードを分離して立てる**（`assertAllowedThemeImportUrl`）。既存 allow-list にホストを足さない。
  ⚠ **`assertAllowedObsUrl` は loopback を許可する関数**なので、絶対に流用しない。
- **SSRF を塞ぐ**（loopback / プライベート IP / メタデータ / `.local` / IP リテラルを拒否）。
  ⚠ **これが本タスク固有の最大リスク**。ユーザーが URL を指定できる機能は、
  「ユーザーが騙されて他人の URL を貼る」経路も同時に開く。
- **リダイレクトを追わない**（ガードの迂回を防ぐ）。
- **送信データゼロ**（GET のみ・Cookie/Referer/カスタムヘッダなし・§9）。
- **サイズ / タイムアウト上限**（`Content-Length` を信用しない）。
- **ログに URL・CSS 本文を出さない**（§9）。エラー表示は `redactUrl` 相当を通す
  （`host-guard.ts` の `DisallowedHostError` が既に `redactUrl` を使っている）。
- **新規依存ゼロ**（`fetch` ＋ `AbortController` の標準 API のみ）。
- `csp: null` 不変・`tauri.conf.json` 差分ゼロ・**新規 capability ゼロ**。

## 完了条件

- 外部 `@import` を含む CSS を取り込むと、**同意ダイアログに完全な URL が出て**、
  承諾したときだけ 1 回取得され、インライン展開されて保存される。
- **拒否したときは `@import` が除去されるだけ**で、取り込み自体は成功する。
- `assertAllowedThemeImportUrl` が loopback / プライベート IP / `http:` / リダイレクト /
  非 443 / 非 `.css` を**すべて拒否**する。テストで固定され、**ミューテーションで実効性を確認**している。
- 保存後、**オーバーレイ表示中に外部 ESTABLISHED が発生しない**（`lsof -i` で確認）。
- [`docs/security.md`](../security.md) §1 に例外節が新設され、(6) の全項目が書かれている。
- **新規依存ゼロ・新規 capability ゼロ・`tauri.conf.json` 差分ゼロ・`csp: null` 不変。**
- `pnpm --filter ./apps/desktop typecheck` / `lint` / `test`、`pnpm --filter ./apps/comment-sidecar test`、
  `cargo check` が通る。[`docs/progress.md`](../progress.md) を更新。

## 確認コマンド

```bash
git diff --stat
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
pnpm --filter ./apps/desktop test
pnpm --filter ./apps/comment-sidecar test   # host-guard / theme-import のテスト
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml

# ゼロ拡大の担保（差分ゼロが期待）
git status --short -- apps/desktop/src-tauri/capabilities/ apps/desktop/src-tauri/tauri.conf.json .github/
# 新規依存ゼロの担保（差分ゼロが期待）
git status --short -- apps/comment-sidecar/package.json apps/desktop/package.json pnpm-lock.yaml package.json

pnpm --filter ./apps/desktop tauri dev
# ① 依頼者の実サンプル CSS を取り込む → 同意ダイアログに完全な URL が出る（既定はキャンセル側）
# ② 承諾 → 取得され、吹き出しデザインが実際に効く
# ③ 拒否 → @import が除去されて取り込みは成功する（デザインは素のまま）
# ④ 保存後にオーバーレイを表示し、**lsof -i で外部 ESTABLISHED がゼロ**であること（実行時オフラインの実証）
# ⑤ http:// の URL / 127.0.0.1 の URL / リダイレクトする URL を仕込んだ CSS で、すべて拒否されること
```

## 実装後に必要なレビュー

- **security-review 必須**（[`security-review`](../../.claude/skills/security-review/SKILL.md)）。
  **§1 に例外節を新設する変更＝本リポジトリで最もリスクの高い種類**なので、レビューは重めに行う。対象:
  - `assertAllowedThemeImportUrl` の網羅性（**特に SSRF**）
  - リダイレクト禁止・サイズ/タイムアウト上限・`Content-Type` 検証
  - 同意 UI（**表示 URL と取得 URL の同一性**・既定がキャンセル・「今後確認しない」が無いこと）
  - 実行時に外部へ出ないことの実証（`lsof -i`）
  - §1 例外節の記述が実装と一致していること
- ⚠ レビュー時は**ガードの迂回を狙った独自のミューテーション**を必ず作ること
  （055e の教訓：自分のガードの主張を裏返す変異だけでは、ガードが見ていない領域の穴は見つからない）。
