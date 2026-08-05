# 060d テーマ管理 UI＋オーバーレイへの注入・切替

> 状態: **実装済み（2026-08-05）／security-review 実施済み・指摘対応済み（2026-08-05）／実機確認は未実施**。
> ⚠⚠ **security-review の判定は「修正必須」**だった（プレビューのスコープ化が敵対的入力で実際に破れた）。
> 対応内容は [`docs/progress.md`](../progress.md) の 060d 節「security-review」表と
> [`docs/security.md`](../security.md)「## CSP方針」の **060d 節**が正。
> ⚠ **実装後の実際の姿は [`docs/progress.md`](../progress.md) の 060d 節が正**
> （本ファイルは着手前の設計メモで、下記「実装で判明した前提と訂正」以外は当時のまま残してある）。
> 分割・線引きは親 [060](060-overlay-custom-css.md) を正とする。

## ⚠ 実装で判明した前提と訂正（2026-08-05）

着手時の調査で、本ファイルが前提にしていなかった事実が見つかった。**行番号は書かない**（特定はシンボル名で）。

1. ⚠⚠ **完了条件「取り込み前後のサイズ比が極端なら警告する」は実現できない。**
   本文は「取り込み前のファイルサイズは 060d 側が知っている」と書いているが（[060b](060b-custom-css-import-backend.md) の
   `model.rs` の doc コメントも同じ）、**これは事実誤認**。`@tauri-apps/plugin-dialog@2.7.1` の `open()` は
   **パス文字列しか返さず**（`OpenDialogReturn<T>` を実測）、`plugin-fs` も asset protocol も無いので
   **frontend は選ばれたファイルを 1 バイトも読めない**。
   → **本人決定で「保存後 CSS に閉じ忘れたブロックが残っているか」（`unclosedBlockDepth`）へ置き換えた。**
   対応の取れていない `(` があるとそこから EOF までが 1 宣言として除去され、**囲んでいた `}` も一緒に消える**
   ので必ず閉じ忘れが残る（実測 `.a{`）。⚠ 末尾が `{` とは限らない（`.a{color:red;width:calc(1px;}` →
   `.a{color:red;`）ので**深さ**を見る。
   ⚠⚠ **比率のほうが劣る**理由も記録する——実サンプル（全 6 行のうち 1 行が `@import`）も `url()` を多数持つ
   普通のテーマも**正常に数割減る**ので、閾値は誤報か取り逃しにしかならない。
   ⚠ `model.rs` の当該コメントは**誤ったまま残っている**（Rust 差分ゼロのため）。
   **再修正トリガー＝ [060c](060c-external-css-snapshot.md) で `overlay_theme` を触るときに訂正すること。**
2. ⚠⚠ **レビュー区分は「軽レビュー」ではない。**（→ **security-review 実施済み・2026-08-05**。
   判定「修正必須」で、`scopeSelectors` の走査器 desync（S-1）・プレビュー枠からのはみ出し（S-2）・
   ガード (10-i) の範囲（S-5）・ファイル名の clamp（S-6）を修正した。詳細は progress.md 060d 節。） [`docs/security.md`](../security.md) の「レビュー必須条件」に
   **「オーバーレイへのユーザー CSS の注入（060d／`<style>` 生成・`insertRule`・`adoptedStyleSheets` 等）」**が
   060a レビュー S-2 で追加済みで、「**本項が対象にするのは注入する側である**」と明記されている。
   下記「## 実装後に必要なレビュー」の「軽レビュー」は**その項目が追加される前の記述**。
   → **本人判断で security-review は別チャットで実施する**（＝**要件の免除ではない**）。本セッションは軽レビューのみ。
3. **申し送り③の理由づけを訂正した。** 「同ファイルに `.sd-preview` を書くとガード (10-b) が誤検知する」は
   厳密には誤りで、(10-b) は `cssCompat.ts` の **`to:` 右辺だけ**を突き合わせる（素の定数を書いても落ちない）。
   ⚠ **分離という結論は変わらない**が、理由は「**060a の資産を凍結して差分ゼロを担保するため**」。
   新設した静的ガード **(10-h)** がこの構造を固定する。
4. **`scopeSelectors` は `.sd-overlay` も読み替える**（`:root` / `html` / `body` に加えて追加）。
   読み替えないと `.sd-overlay { --sd-comment-bg: … }`（CSS 変数を上書きする唯一の器）が
   **プレビューでだけ効かない**。
5. ⚠⚠ **`innerHTML` への退行はランタイムテストでは殺せない**（実測）。jsdom は `<style>.innerHTML` に
   **RAWTEXT のフラグメント解析を実装しておらず**、`textContent` 経路と完全に同じ結果になる。
   → **この不変条件を実際に殺しているのは静的ガード (10-i) だけ。消さないこと。**
6. **`name` の検証は Rust と厳密に等価にした**（申し送り①）＝ **`/\p{Cc}/u`** と **`[...name].length`**。
   ⚠ `/[\x00-\x1F\x7F]/` では C1（U+0080..=U+009F）が漏れ、`name.length` は UTF-16 単位なので絵文字で食い違う。
7. **設定 UI は `SettingsView` の「表示専用・state は親」から意図的に逸脱した**——新規 `OverlayThemeCard.tsx` が
   自前で API と `ConfirmDialog` を持つ（`ViewersView` の先例）。`SettingsView` から渡すのはプレビューの体裁に要る 2 つだけ。
8. **CSS 差分ゼロは達成していない**（一覧の行とプレビュー枠に箱が要る）。新規 5 クラスは役割トークンのみ・
   `--text-faint` 不使用・[054](054-comment-viewer-settings-readability.md) の 3 段規則どおり。
>
> **必読前提**: 親 [060](060-overlay-custom-css.md)、セレクタ契約と変換表 [060a](060a-overlay-selector-contract.md)（`cssCompat.ts`）、
> 取り込み基盤 [060b](060b-custom-css-import-backend.md)（コマンドと DTO の正）、
> オーバーレイ [`OverlayApp.tsx`](../../apps/desktop/src/screens/comment-viewer/OverlayApp.tsx)（`storage` 購読による即反映の作法）、
> 設定の保存作法 [`overlaySettings.ts`](../../apps/desktop/src/features/comment-viewer/overlaySettings.ts)、
> 設定 UI [`SettingsView.tsx`](../../apps/desktop/src/screens/comment-viewer/SettingsView.tsx) と書式規則 [054](054-comment-viewer-settings-readability.md)、
> invoke ラッパの作法（`features/<機能>/<機能>Api.ts`）、
> [`docs/security.md`](../security.md)（§1／## CSP方針／§9）。
> CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。**軽レビュー**。
>
> ⚠ **行番号は書かない**（特定はシンボル名で行うこと）。
> ⚠ **着手条件＝[060a](060a-overlay-selector-contract.md) ＋ [060b](060b-custom-css-import-backend.md) 完了**。

## 目的

依頼者の要望③の後半「**import したものには名前をつけて、配信画面からいつでもデザイン切り替えができる**」を実装する。
あわせて、保存済み CSS を**実際にオーバーレイへ注入する**（ここまでで機能が通しで動く）。

## 現在の前提（調査結果・実コード）

- オーバーレイ窓（`comment-overlay`）とコメビュ窓（`comment-viewer`）は**別 webview だが同一 localStorage を共有**する。
  設定窓が `save*` → オーバーレイ窓が `storage` イベントで即反映、が確立した作法
  （`OverlayApp` のフォント／サイト名表示がこれ）。
  ⚠ **この伝播はプラットフォーム依存でベストエフォート**と明記されている。
  **保証ベースラインは起動時の read-on-mount**（lazy `useState` 初期化）。同じ二段構えにする。
- `dangerouslySetInnerHTML` は**リポジトリ全体で使用ゼロ**。
- CSS の注入先は `OverlayApp`。透過は `document.documentElement` の `data-overlay="1"` ＋ `:global` ルール。
- invoke は `features/<機能>/<機能>Api.ts` の薄いラッパ経由（**コンポーネントは invoke を直接呼ばない**）。
- 設定画面の書式は [054](054-comment-viewer-settings-readability.md) で確定
  （項目名＝`.fieldLabel` 13px/700/`var(--text)` ／ 説明＝`.note` `var(--muted)` ／ `--text-faint` は無効状態専用）。

## このタスクでやること

### (1) invoke ラッパ（`features/comment-viewer/overlayThemeApi.ts`）

- [060b](060b-custom-css-import-backend.md) の 5 コマンドを包む薄いラッパ。ts-rs 生成の型（`bindings/`）を使う。
- **コンポーネントから `invoke` を直接呼ばない**（既存の作法）。

### (2) 選択中テーマの保存（`overlaySettings.ts` に追加）

- `OVERLAY_THEME_KEY = "stream-dock.comment-viewer.overlay-theme"`、
  `loadOverlayTheme(): string | null` / `saveOverlayTheme(id: string | null): void`。
  既存作法どおり（例外は握りつぶし・未保存/不正は `null`＝既定意匠）。
- **`null` が「既定（StreamDock の現行意匠）」**。⚠ カスタムテーマを消しても**必ず既定へ戻れる**ようにする
  （テーマが壊れて配信画面が真っ白、から復帰できないのが最悪）。

### (3) オーバーレイへの注入（`OverlayApp.tsx`）

- マウント時に `loadOverlayTheme()` → id があれば `get_overlay_theme_css(id)` で CSS 文字列を取得。
- **`cssCompat.rewriteSelectors()` を通してから**注入する（[060a](060a-overlay-selector-contract.md)）。
  ⚠ **変換は注入時に毎回行う**（[060b](060b-custom-css-import-backend.md) の決定）。
  これで変換表を更新すると**既存テーマにも自動で効く**。
- 注入は **`document.createElement("style")` ＋ `textContent` への代入**で行い、`<head>` に足す。
  - ⚠ **`dangerouslySetInnerHTML` を使わない**（リポジトリ全体で使用ゼロという事実を壊さない）。
  - ⚠ **`style.textContent` は HTML として解釈されない**ので、`</style>` を含む CSS でも
    タグを閉じて DOM を壊すことはない。**`innerHTML` に入れると壊れる**ので、必ず `textContent` を使うこと。
  - アンマウント／テーマ変更時に**必ず取り除く**（`<style>` が積み上がらないこと）。
- `storage` イベントで `OVERLAY_THEME_KEY` の変更を購読し、**開いたまま切り替わる**ようにする
  （既存のフォント／サイト名表示と同じ二段構え：起動時 read ＋ storage 購読）。

### (4) テーマ管理 UI（設定ビューに「コメントのデザイン」カード）

- **一覧**: 「既定」＋インポート済みテーマ。ラジオ or セレクトで**現在選択中**が分かる形。
- **インポート**: `@tauri-apps/plugin-dialog` の `open()` でファイル選択（`.css` フィルタ）→ 名前を入力 →
  `import_overlay_theme`。
  ⚠ **capability（`dialog:allow-open`）は [060b](060b-custom-css-import-backend.md) で追加済み**。
- **名前の変更 / 削除**。削除は確認を挟む（既存の `ConfirmDialog` を再利用）。
  ⚠ **選択中のテーマを削除したら `null`（既定）へ戻す**。
- **取り込み結果の表示**（本タスクの要）:
  - 「外部参照を N 件除去しました」（[060b](060b-custom-css-import-backend.md) の `stripped_count`）
  - 「M 個のルールを StreamDock 用に変換しました／K 個はそのままです」
    （`cssCompat.rewriteSelectors()` の `rewritten` / `unmatched` を**その場で計算**）
  - ⚠ **`unmatched` が多いテーマは「入れたのに効かない」**。ここを黙っていると、
    ユーザーは原因不明のまま諦める。**必ず出すこと。**
- **プレビュー**: カード内に**ダミーコメント数件**を安定クラス付きで描き、選択中テーマの CSS を当てて見せる。
  - ⚠ **プレビューにテーマ CSS を注入すると、コメビュ窓全体に漏れる**（`<style>` はスコープを持たない）。
    対処＝プレビュー専用のラッパに `.sd-preview` を付け、注入時に**全セレクタへ `.sd-preview` を前置**する
    （`rewriteSelectors` の隣に `scopeSelectors(css, ".sd-preview")` を置く）。
    ⚠ この前置処理は**プレビュー専用**で、オーバーレイ窓への注入では使わない（あちらは窓ごと分かれている）。
  - ⚠ **プレビューの完全一致は目指さない**（フォント・サイズ・背景が実配信と違う）。
    「だいたいこうなる」で十分だと UI に書く。

### (5) 復帰導線（壊れたテーマからの脱出）

- ⚠ ユーザー CSS は**オーバーレイを完全に不可視にできる**（`display:none` 等）。
  そのとき**オーバーレイ窓からは何も操作できない**（表示専用・非フォーカス窓）。
- → **設定ビューに「既定のデザインに戻す」ボタンを必ず置く**。1 クリックで `saveOverlayTheme(null)`。
- ⚠ **これはテストで固定する**。無いと配信中に詰む。

### (6) テスト

- `overlaySettings.test.ts` に新キーの load/save（未保存 / 不正 / 例外 → `null`）
- `OverlayApp` のテスト:
  - テーマ id があるとき `<style>` が 1 つだけ足されること
  - テーマを切り替えると**古い `<style>` が消えて新しいものが 1 つになる**こと（積み上がらない担保）
  - `null` のとき `<style>` が無いこと
  - ⚠ **注入経路が `textContent` であること**（`innerHTML` に変わったら落ちるテスト）
  - `storage` イベントで切り替わること
- 管理 UI のテスト: 一覧・選択・削除確認・**「既定に戻す」ボタンの存在**・
  `unmatched` が 0 でないとき警告が出ること
- `scopeSelectors` の単体テスト（プレビューが外へ漏れない担保）
- **ミューテーションで実効性を確認**する。最低限、`<style>` の removal を外したときにレッドになること。

## このタスクでやらないこと

- **CSS の検証・保存**（[060b](060b-custom-css-import-backend.md)）。本タスクは呼ぶだけ。
- **外部 `@import` の取得**（[060c](060c-external-css-snapshot.md)）。同意ダイアログの置き場所は本タスクの UI だが、
  **実装は 060c**。
- **セレクタ変換表の中身**（[060a](060a-overlay-selector-contract.md)）。本タスクは適用するだけ。
- **コメビュ本体への適用**。対象はオーバーレイのみ。
- アプリ内 CSS エディタ。
- テーマの共有・書き出し（エクスポート）。
- 固定コメントオーバーレイ（`pinned-overlay`）への適用。
  ⚠ **要望は「コメント欄」なので `comment-overlay` のみ**。固定コメントにも効かせたくなったら別タスク
  （[046d](046d-pinned-overlay-obs-auto-add.md) の「1 → 2 ソースへの一般化」と同じ広げ方になる）。

## セキュリティ制約（docs/security.md 準拠）

- **外部通信ゼロ**（§1）。注入するのは [060b](060b-custom-css-import-backend.md) が
  **外部 URL を除去済み**の CSS。オーバーレイ表示中に通信は発生しない。
- ⚠ **`dangerouslySetInnerHTML` を使わない**。`<style>` は `textContent` へ代入する
  （リポジトリ全体で `dangerouslySetInnerHTML` 使用ゼロという事実を壊さない）。
- **`csp: null` 不変**・`tauri.conf.json` 差分ゼロ・**新規 capability ゼロ**
  （`dialog:allow-open` は 060b で追加済み）。
- 追加する localStorage キーは**ユーザー自身の UI 設定値**（テーマ id 1 個）で、
  §9 追補（046a）が対象とする第三者の個人データではない。**CSS 本文を localStorage に置かない**（Rust が持つ）。
- **新規依存ゼロ**。
- ログに CSS 本文を出さない（§9）。

## 完了条件

- 設定ビューでローカル CSS をインポートでき、**名前を付けて保存**され、一覧に並ぶ。
- **一覧から選ぶとオーバーレイの見た目が切り替わる**（開いたまま＝`storage` 伝播、または開き直しで確実に）。
- **「既定のデザインに戻す」で必ず元に戻れる**。
- 取り込み結果に「**取り込めない参照を** N 件除去」「M 件変換／K 件は未変換」が出る
  （⚠ `strippedCount` は相対 URL や `url(#frag)` も含むので「外部参照を N 件」は不正確）。
- ⚠ ~~**取り込み前後のサイズ比が極端なら警告する**~~ → **上記「実装で判明した前提と訂正」①のとおり、
  「保存後 CSS に閉じ忘れたブロックが残っているか」（`unclosedBlockDepth(css) > 0`）へ置き換えた**（本人決定）。
  以下は当時の記述（**「取り込み前のファイルサイズは 060d 側が知っている」は誤り**）:
  CSS に対応の取れていない `(` が 1 つあるとそこから EOF までが 1 宣言として扱われ、参照が 1 つでもあれば
  **ファイルの残り全部が消えて `strippedCount` は 1** になる（ブラウザも同じ範囲を捨てるので意味論としては正しい）。
  実測: `.a{width:calc(100% - 10px;}` ＋以降 → 保存されるのは `.a{` だけ。
- ⚠ **060b の実機確認（progress.md 060b 節の 1〜4・6・7）をここで消化する。**
  コマンドを呼ぶ UI が本タスクの領分なので、060b 側では実施できていない:
  ①実サンプル CSS を取り込むと保存され件数が返る（⚠ **見た目は「書体しか効かない」のが仕様どおり**）
  ②`themes/` に `<uuid>.css` **だけ**が増える（元ファイル名が使われていない）
  ③テーマ名に `../evil` を入れても管理ディレクトリ外にファイルが出ない
  ④削除でファイル実体も消え、二重削除でも落ちない（`NotFound` になるだけ）
  ⑥拡張子違い（`.txt`）／256KB 超／`.css` にリネームしたバイナリ（PNG）が拒否される
  ⑦`@media (min-width: calc(1px + url(https://x))){…}` が拒否され、
  「@media / @supports などの条件部分に、取り除けない参照が…」という文言が出る
- テーマを切り替えても `<style>` が**積み上がらない**（常に 0 または 1 個）。
- プレビューの CSS が**コメビュ窓の他の部分へ漏れない**。
- 選択中テーマを削除したら既定へ戻る。
- 新規テストが通り、**ミューテーションで実効性を確認**している。
- **Rust / sidecar / capabilities / `tauri.conf.json` / 依存は差分ゼロ**・`csp: null` 不変。
- `pnpm --filter ./apps/desktop typecheck` / `lint` / `test` が通る。[`docs/progress.md`](../progress.md) を更新。

## 確認コマンド

```bash
git diff --stat
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
pnpm --filter ./apps/desktop test

# ゼロ拡大の担保（差分ゼロが期待）
git status --short -- apps/desktop/src-tauri/ apps/comment-sidecar/ .github/
# 新規依存ゼロの担保（差分ゼロが期待）
git status --short -- apps/desktop/package.json pnpm-lock.yaml package.json

pnpm --filter ./apps/desktop tauri dev
# ① 依頼者の実サンプル CSS（外部 @import は除去済み）を取り込む → 名前を付けて一覧に出る
# ② 選択 → オーバーレイの見た目が変わる（開いたまま切り替わるか／ダメでも開き直せば変わるか）
# ③ 「既定のデザインに戻す」で戻る
# ④ `.sd-comment { display: none }` だけのテーマを入れて配信画面が空になる → ③ で復帰できる
# ⑤ テーマを 5 回切り替えて DevTools の <head> に <style> が 1 つしか無いこと
# ⑥ プレビューを表示してもコメビュ窓の他の部分が壊れないこと
# ⑦ 取り込み結果に除去件数・変換件数・未変換件数が出ること
```

## 実装後に必要なレビュー

⚠⚠ **訂正（上記②）**: [`docs/security.md`](../security.md) の「レビュー必須条件」に
**「オーバーレイへのユーザー CSS の注入（060d）」が既にある**（060a レビュー S-2 で追加）ので、
本タスクは **security-review 該当**。下記の「軽レビュー」指定はその項目が追加される前の記述。
**本人判断で security-review は別チャットで実施する**（＝要件の免除ではない・完了まで task-board に「レビュー未了」で残す）。

- **軽レビュー**（[`code-review-light`](../../.claude/skills/code-review-light/SKILL.md)）は実施済み（修正必須 0 件）。
- ⚠ ただし次の 3 点は必ず確認する（軽レビューでも飛ばさない）:
  - **注入経路が `<style>` の `textContent` のみ**（`dangerouslySetInnerHTML` / `innerHTML` を使っていない）
  - **プレビューの CSS が窓全体へ漏れない**（`scopeSelectors` が効いている）
  - **「既定に戻す」で必ず復帰できる**（壊れたテーマからの脱出路）
