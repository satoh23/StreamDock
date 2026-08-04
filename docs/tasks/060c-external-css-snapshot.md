# 060c 外部 `@import` の取り込み時スナップショット（§1 例外の新設）

> 状態: **未着手（実装サブタスク）**。分割・線引きは親 [060](060-overlay-custom-css.md) を正とする。
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
> ⚠ **着手条件＝[060b](060b-custom-css-import-backend.md) ＋ [060d](060d-css-theme-management-ui.md) 完了**（通しで動く状態を見てから判断する）。
> ⚠ **本タスクは実装しない判断も最後まで残る**（親 060 の方針）。実装しなければ外部 `@import` は
> 060b が除去したまま＝機能は成立するが、依頼者のサンプルの吹き出しデザインは効かない。

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
