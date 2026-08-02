# 060 オーバーレイ カスタム CSS テーマ（親・設計/方針）

> 状態: **未着手（親ドキュメント）**。本ファイルは 060a〜060d の**分割・線引き・実装順の正**。
> **[037](037-overlay-design-expansion.md) を supersede する**（下記「037 の扱い」節）。
>
> **必読前提**: オーバーレイ描画 [`OverlayApp.tsx`](../../apps/desktop/src/screens/comment-viewer/OverlayApp.tsx) と
> [`CommentList.tsx`](../../apps/desktop/src/screens/comment-viewer/CommentList.tsx)（`variant="overlay"` の分岐）、
> 意匠 CSS [`OverlayComment.module.css`](../../apps/desktop/src/screens/comment-viewer/OverlayComment.module.css)、
> 現行の表示設定 [`overlaySettings.ts`](../../apps/desktop/src/features/comment-viewer/overlaySettings.ts)（フォント 4 択・サイト名 ON/OFF）、
> **取り込み方式の先行設計 [039](039-font-import.md) / [039a](039a-font-import-rust-storage.md)（保留中だが設計は完成済み・本タスクはこれをなぞる）**、
> 静的ガード [`check-css-guards.mjs`](../../apps/desktop/scripts/check-css-guards.mjs)、
> [`docs/security.md`](../security.md)（**§1 外部通信／§5 ファイル操作／§8 入力検証／「## CSP方針」／Capabilities 方針／レビュー必須条件**）。
> CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。各サブタスクは 1 タスク 1 機能で分割済み。

## 目的

依頼者の要望③「OBS に載せるコメント欄について、**ユーザーが自分で作ったカスタム CSS を import** して
好きなデザインのコメントを配信に載せられるようにしたい。**import したものには名前をつけて、
配信画面からいつでもデザイン切り替え**ができるようにしたい」を実装する。

## 現在の前提（調査結果・実コード）

### オーバーレイの意匠は 4 択のフォントとサイト名トグルしかない

- カスタマイズ可能なのは [`overlaySettings.ts`](../../apps/desktop/src/features/comment-viewer/overlaySettings.ts) の
  `OVERLAY_FONTS`（**OS 標準フォント 4 択**・外部 Web フォント参照なし）と `OVERLAY_SHOW_SOURCE_KEY`（サイト名表示）だけ。
- 適用は `OverlayApp` の `style={{ fontFamily: resolveOverlayFontStack(font) }}` の**インライン 1 か所**のみ。
  他はすべて CSS Modules（`OverlayApp.module.css` / `OverlayComment.module.css`）。

### ⚠ いただいたサンプル CSS は、そのままでは 1 行も効かない

依頼者から示されたサンプルは**YouTube / Twitch の純正チャット DOM 向け**である。

```css
/* YouTube */
yt-live-chat-text-message-renderer #message { ... }   /* ← カスタム要素名 + id */
/* Twitch */
.chat-line__no-background { ... }                      /* ← Twitch のクラス名 */
```

StreamDock のオーバーレイは**独自 DOM ＋ CSS Modules（クラス名がビルド時にハッシュ化される）**なので、
これらのセレクタは**何にもマッチしない**。ここが本タスク最大の設計上の断層で、
「差分を吸収する必要がありそう」という依頼者の懸念は**プラットフォーム間の差**ではなく
**「純正チャット DOM」と「StreamDock の DOM」の差**として現れる。

なお **YouTube と Twitch の値の差は StreamDock 側で既に吸収済み**である。
両者は sidecar で `CommentViewDto`（`source` / `author` / `text` / `eventType` / `monetaryAmount` …）へ
正規化されており、オーバーレイの DOM は**両プラットフォームで同一**。
プラットフォーム別に出し分けたい場合のフックだけ用意すればよい。

### 外部 `@import` は security.md に正面から当たる

- §1 が「**CDN からの script/css/image 読み込み**」を明示的に禁止し、「## CSP方針」も「**外部 style を読み込まない**」と書いている。
- ⚠ **技術的には止まっていない**（`tauri.conf.json` の `app.security.csp` は `null`＝CSP を強制していない）。
  止めているのは**ポリシー文書とレビューだけ**。したがって「動いてしまうから OK」は通らない。
- [`docs/security.md`](../security.md) は「**React は CSS 値をサニタイズしないため `url(…)` で外部リソース取得が成立しうる**」と
  既に明文で警告している（055e の節）。**ユーザー提供 CSS を注入する本タスクはこの論点の正面衝突。**

### ファイル取り込みの経路は存在しない（が設計は完成している）

- `fs` plugin も asset protocol も未導入。Rust の `std::fs` 使用は 5 か所だけで、**ファイル書き込みコマンドは 1 本も無い**。
- ファイル選択は `@tauri-apps/plugin-dialog` の `open()` で**パス文字列を得るだけ**（`AddToolScreen`）。
- ⚠ **`dialog:allow-open` は main 窓（`default.json`）にしか無い。**
  コメビュ窓（`comment-viewer.json`）は `core:default` のみ＝**capability の追加が要る**（[039](039-font-import.md) が既に洗い出している論点）。
- [039](039-font-import.md) が「app_data_dir へコピー＋Rust 検証＋SQLite レジストリ＋data URI で webview へ供給」という
  **確定方針**を持っている（保留中だが設計は完成済み）。**本タスクはこれをなぞる。**

## 確定した方針

### (1) セレクタ契約を定義する（＝ユーザー CSS が狙える的を作る）

- オーバーレイの DOM に、**ハッシュ化されない安定クラス名**（`sd-` 接頭辞）・**data 属性**・**CSS 変数**を併記する。
  これが「StreamDock の CSS API」になる。既存の CSS Modules クラスは**そのまま残す**（意匠は不変）。
- プラットフォーム差の出し分けは **`data-sd-source="youtube|twitch"`**、
  イベント種別の出し分けは **`data-sd-event="chat|superchat|…"`** で行う。

### (2) 既存 CSS 資産は「取り込み時のセレクタ変換」で吸収する（依頼者決定＝互換エイリアス）

- ユーザーが持っている YouTube / Twitch 純正チャット向け CSS を**そのまま貼れる**ようにするため、
  **取り込み時に既知のセレクタを sd 語彙へ機械的に書き換える**（変換表を持つ）。
  - 例: `yt-live-chat-text-message-renderer #message` → `.sd-comment-text`
  - 例: `.chat-line__no-background` → `.sd-comment`
- **DOM を純正チャットの形に寄せる方式は採らない。** 理由＝カスタム要素名（`yt-live-chat-*`）や
  重複 `id="message"` を DOM に持ち込むと、StreamDock 側の意匠・アクセシビリティ・テストが
  他社の DOM 仕様に人質を取られる。**変換表なら StreamDock の DOM はきれいなまま**で、
  対応表が古くなっても StreamDock 側は壊れない。
- ⚠ **変換は完全ではない**。マッチしなかったセレクタは**そのまま残す**（消さない）。
  ユーザーには**「変換できたルール数／できなかったルール数」を UI に出す**（黙って効かないのが最悪）。

### (3) 外部 `@import` は「取り込み時に 1 回だけ取得してスナップショット化」（依頼者決定）

- インポート時に**ユーザーが URL を確認したうえで**、**sidecar が 1 回だけ GET** して CSS 本文を取得し、
  **インライン化して保存**する。以後の**実行時は完全オフライン**。
- 保存後に残った外部参照（`url()` / 再帰的な `@import` / `image-set()`）は**除去する**。
- **§1 に例外節を新設する**（[060c](060c-external-css-snapshot.md) の完了条件）。
- 取得を sidecar に置くのは、**main 窓 no-internet の境界を崩さない**ため（既存アーキテクチャの絶対条件）。

### (4) 保存・供給は 039 の確定方針をなぞる

- CSS 本文は `app_data_dir/themes/` 配下へ保存し、レジストリ（SQLite テーブル `overlay_themes`）に登録する。
- webview へは **Rust のコマンドが文字列として返す**（asset protocol も CSP の変更も不要）。
- 検証は **Rust 側**（§5/§8）: 拡張子・サイズ上限・パス検証・制御文字拒否・**外部 URL の除去**。

### (5) テーマの切替は既存の窓間伝達に乗せる

- 選択中テーマ id は localStorage（`stream-dock.comment-viewer.overlay-theme`）に置き、
  オーバーレイ窓は `storage` イベントで即反映する（[`overlaySettings.ts`](../../apps/desktop/src/features/comment-viewer/overlaySettings.ts) と
  `OverlayApp` の既存パターンをそのまま使う）。**新規 WS も Tauri イベントも増やさない。**

## 037 の扱い（supersede）

[037](037-overlay-design-expansion.md)（`## 保留`）は「意匠選択機構を新設し複数意匠から選べるように＋新デザイン 2 種」だった。

- **037a（意匠選択機構）は本タスク 060 が実体化する**。テーマ一覧＋切替 UI（[060d](060d-css-theme-management-ui.md)）が
  037a の「意匠選択機構」そのものであり、二重に作る意味がない。
- **037b（投げ銭強調意匠）は既に [043c](043c-overlay-monetary-highlight.md) へ supersede 済み**（実装完了）。
- → **037 は親ごと supersede**。[`docs/task-board.md`](../task-board.md) の 037 行にも注記する。
- ⚠ **手放すもの**: 037 が予定していた「**新デザイン 2 種**（シンプル意匠等）を StreamDock が作って同梱する」は
  060 には**含まれない**（060 はユーザーが CSS を持ち込む機構）。組み込み意匠を増やしたくなったら、
  [060d](060d-css-theme-management-ui.md) のテーマ一覧に「組み込みテーマ」として並べる形で別タスクを立てる。
  **現行意匠 1 種＋ユーザーの持ち込み**が 060 完了時点の姿。
- ⚠ [`docs/task-board.md`](../task-board.md) の `## Todo` にある
  「**画像/GIF プレビューで意匠を選ぶ版**」は [060d](060d-css-theme-management-ui.md) のプレビューで部分的に実体化する
  （静止プレビューまで。GIF での意匠プレビューは含まない）。

## 子タスクと線引き

| 子 | 内容 | 層 | 外部通信（新規） | レビュー |
|---|---|---|---|---|
| [060a](060a-overlay-selector-contract.md) | **セレクタ契約**（安定クラス・data 属性・CSS 変数）を DOM へ導入＋**セレクタ変換表**（純関数） | frontend | なし | 軽レビュー |
| [060b](060b-custom-css-import-backend.md) | ローカル CSS の取り込み基盤（`app_data_dir/themes/`＋`overlay_themes` テーブル＋Rust 検証＋外部 URL 除去＋dialog capability） | Rust | なし | **security-review 必須** |
| [060c](060c-external-css-snapshot.md) | 外部 `@import` の**取り込み時スナップショット**（sidecar が 1 回 GET・明示同意・§1 例外節新設） | sidecar/Rust | **あり（ユーザー指定ホスト）** | **security-review 必須** |
| [060d](060d-css-theme-management-ui.md) | テーマ管理 UI（名前・一覧・切替・削除・プレビュー）＋オーバーレイへの注入・即時反映 | frontend | なし | 軽レビュー |

- **060a は本機能の芯**。ここが無いとユーザー CSS が狙う的が存在しない。
- **060b と 060c は別タスクに割る**。060b は「ローカルファイルを安全に取り込む」（039 の再演）で、
  060c は「**外部通信を新しい形で解禁する**」（§1 の例外新設）＝**リスクの質が違う**ので同じコミットに混ぜない。
- **060c は最後**。060b までで「外部 URL は除去する」形の機能が完成しており、
  060c はそこに「取り込み時だけ取得する」を足す**増分**として設計する。
  ⚠ **060c を実装しない判断も最後まで残る**（サンプル CSS の吹き出しデザインは効かなくなるが、機能は成立する）。

## 依存関係と推奨実装順

```
060a ──> 060b ──> 060d ──> 060c
```

- **060d を 060c より先**に置く理由＝060b＋060d で「ローカル CSS を入れて切り替える」が**通しで動く**状態になり、
  そこで実機の手応え（セレクタ契約が実用に足るか）を確かめてから、リスクの高い 060c を判断できる。
- ⚠ 060a を先に単独でコミットできる（DOM に属性とクラスを足すだけで、既存意匠は不変）。

## 横断セキュリティ方針（docs/security.md 準拠）

- **実行時の外部通信ゼロ**（§1）。060c で解禁するのは**取り込み時の 1 回の GET だけ**で、
  保存済みテーマの適用時は一切通信しない。main 窓 no-internet は不変。
- **ファイル操作は Rust 側・`app_data_dir/themes/` 限定**（§5）。管理ディレクトリ外へ書き込まない・パス検証必須。
  汎用の `write_file(path, content)` 型コマンドは作らない（§3）。
- **入力検証は Rust 側で必ず行う**（§8）。frontend の生パス・生 CSS を信用しない。
  拡張子許可リスト・サイズ上限・制御文字拒否・**外部 URL（`url()` / `@import` / `image-set()`）の除去**。
- ⚠ **`csp: null` は不変**（値の変更はレビュー必須条件）。ユーザー CSS を注入しても
  「外部 style を読み込まない」が**保たれる根拠**を [060b](060b-custom-css-import-backend.md) で security.md に記録する。
- ⚠ **アプリ定義コマンドは全 4 窓から呼べる**（[`docs/security.md`](../security.md) の 046b 節：
  Tauri v2 ではアプリ定義コマンドは ACL の対象外）。テーマ取り込みコマンドを 1 本足すと
  **オーバーレイ窓からも呼べる**。capability で絞れないので、**コマンド自体を狭く作る**こと。
- **capability の追加は `dialog:allow-open` の 1 件だけ**（`comment-viewer.json`）。最小権限（open のみ）に留める（§3）。
- **新規依存ゼロを目指す**。CSS パーサ／サニタイザの追加が必要になったら [060b](060b-custom-css-import-backend.md) で
  理由を添えて提案し、§10 に記録＋`cargo audit` を通す。
- ログに CSS 本文・フルパス・取得 URL を出さない（§9・`with_filename_detail` 流儀）。

## 完了条件（親）

- 060a〜060d のタスクファイルが本親の分割・依存どおりに存在し、既存フォーマットに沿う。
- [`docs/task-board.md`](../task-board.md) に 060 系が追記され、**037 行に supersede が注記**されている。
- 本親ドキュメント自体はコードを変更しない（実装は各サブタスクで「実装して」後）。

## security.md へ追記する節の割り当て

| 節 | 追記する子 | 内容 |
|---|---|---|
| §5 ファイル操作 | [060b](060b-custom-css-import-backend.md) | 例外節（`app_data_dir/themes/` への取り込み書き込み・039 と同型） |
| Capabilities 方針 | [060b](060b-custom-css-import-backend.md) | `comment-viewer.json` への `dialog:allow-open` 追加 |
| ## CSP方針 | [060b](060b-custom-css-import-backend.md) | ユーザー CSS を注入しても `csp: null` と「外部 style を読み込まない」が保たれる根拠 |
| §1 外部通信 | [060c](060c-external-css-snapshot.md) | **例外節を新設**（取り込み時 1 回の GET・ユーザー指定ホスト・実行時オフライン・明示同意） |
| §10 依存 | [060b](060b-custom-css-import-backend.md) | CSS パーサ等を足す場合のみ。足さないなら「新規依存ゼロ」を記録 |

## このタスク（親）でやらないこと

- コード実装（060a〜d それぞれで行う）。
- **コメビュ本体（`variant="default"`）へのカスタム CSS 適用**。対象は**オーバーレイのみ**
  （要望は「OBS に載せるコメント欄」）。本体にも効かせたくなったら別タスク。
- **StreamDock が新しい組み込み意匠を作ること**（037 から手放した範囲・上記「037 の扱い」参照）。
- ユーザー CSS の**エディタ**（アプリ内で CSS を書く機能）。import と切替のみ。
- テーマの共有・配布・マーケットプレイス。
- 純正チャット（YouTube/Twitch のチャットポップアウト）をブラウザソースで直接表示する方式
  （[044s](044s-obs-websocket-spike.md) で「ブラウザソースは当該環境で未描画」と実測済み・
  StreamDock の統合表示／読み上げ／視聴者メモリからも外れる）。
- フォントインポート（[039](039-font-import.md)）。⚠ 060 完了後は「カスタム CSS の `@font-face` で
  ユーザーがフォントを持ち込む」ことも理屈上は可能になるが、**外部フォント URL は除去される**ので
  039 の代替にはならない（039 は保留のまま）。

## 実装後に必要なレビュー

- [060a](060a-overlay-selector-contract.md) / [060d](060d-css-theme-management-ui.md): **軽レビュー**。
  ただし 060d は「ユーザー提供 CSS を実際に DOM へ注入する」ので、
  **注入経路が `<style>` テキストのみで `dangerouslySetInnerHTML` を使っていない**ことは必ず確認する。
- [060b](060b-custom-css-import-backend.md) / [060c](060c-external-css-snapshot.md): **security-review 必須**
  （[`security-review`](../../.claude/skills/security-review/SKILL.md)）。
  §5 ファイル書き込み経路の新設・§1 外部通信の例外・capability 追加・§8 入力検証が対象。
