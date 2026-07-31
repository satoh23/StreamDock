# 055c ヘッダーのベル＋バッジ＋アップデート画面（表示まで）

> 状態: **未着手（実装サブタスク・UI）**。位置づけ・方式決定・線引きは親 [055](055-app-self-update.md) を正とする。
> **[055b](055b-updater-check-command.md) の `check_app_update` と [054](054-comment-viewer-settings-readability.md) の
> タイポグラフィ規則の完了が前提**。
>
> **必読前提**: 親 [055](055-app-self-update.md)（**バッジは常に「1」＝更新の有無**・**起動時に自動チェック・トグルなし**）、
> [055b](055b-updater-check-command.md)（`checkAppUpdate()` と `AppUpdateStatus`）、
> [054](054-comment-viewer-settings-readability.md)（**設定項目名＝太字/`--text`、説明＝`--muted`** の階層規則）、
> ヘッダー [`Header.tsx`](../../apps/desktop/src/components/Header.tsx) と [`Header.module.css`](../../apps/desktop/src/components/Header.module.css)、
> 画面遷移 [`App.tsx`](../../apps/desktop/src/App.tsx)、画面 ID [`types.ts`](../../apps/desktop/src/types.ts)、
> セクション導線の単一ソース [`headerSections.ts`](../../apps/desktop/src/components/headerSections.ts)、
> 共有フォーム書式 [`formLayout.module.css`](../../apps/desktop/src/screens/formLayout.module.css)、
> 参考にする整った画面 [`SettingsScreen.tsx`](../../apps/desktop/src/screens/settings/SettingsScreen.tsx)、
> 役割トークン [`theme.css`](../../apps/desktop/src/styles/theme.css)、
> [`docs/security.md`](../security.md)（§1/§10/CSP 方針）。
> CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。
> **frontend の表示のみ（DL/インストールは配線しない）**＝**軽レビュー**。
>
> ⚠ **行番号は書かない**（特定はシンボル名で行うこと）。

## 目的

更新があることをユーザーに気づかせ、内容を読ませるところまでを作る。

1. ヘッダーに**ベルのアイコン**を置く。更新があるときだけ**バッジ（数字「1」）**を出す。
2. ベルを押すと**アップデート画面**へ遷移する。
3. 画面には**現在のバージョン**・**新しいバージョン**・**そのバージョンの更新内容**が表示される。
4. 右下に**アップデートボタン**を置く（**この時点では押しても何も起きない・無効表示**。配線は
   [055d](055d-update-install-and-restart.md)）。

**更新内容の表示は、この時点では改行を保持したプレーンテキスト**。マークダウン描画は
[055e](055e-release-notes-markdown.md) が担う（落としてもプレーンテキストで読める形にしておく）。

## 現在の前提（調査結果・実コード）

### ヘッダー

`Header.tsx` は高さ 65px のカスタムタイトルバー（`data-tauri-drag-region` でウィンドウドラッグ、
macOS は `data-os` で信号機回避の左余白、Windows はフレームレスのため自作 min/max/close）。
構造は `brand`（ロゴ＋ワードマーク）→ `nav`（`sections` → 診断ボタン → 設定ボタン → Windows 制御）。

- **アイコンはすべて自前のインライン SVG**（`width/height="22"` / `viewBox="0 0 24 24"` / `stroke="currentColor"` /
  `strokeWidth="1.8"` / `aria-hidden="true"`）。**アイコンライブラリは入っていない**（`lucide-react` 等は未導入）。
  この規約は `CommentViewerApp.tsx` のツールバーにも明文化されている（外部リソースを読み込まない・テーマ追従）。
- 右ナビのボタンは `styles.navBtn`（36×36 の grid・`opacity: 0.72` → hover/active で 1）。
- `activeNav` prop の型は `Extract<Screen, "main" | "rakuraku-tools" | "obs-effects" | "diagnostics" | "settings">`。
- **`HEADER_SECTIONS` はテキスト導線（ツール管理 / らくらくツール設定 / OBSエフェクト）用**で、
  アイコンボタン（診断・設定）はこの配列を通らず `Header.tsx` に直書きされている。
  **ベルもアイコンボタンなので `HEADER_SECTIONS` には足さない**。

### 画面遷移

- `App.tsx` が `const [screen, setScreen] = useState<Screen>("main")` を持ち、
  `activeNav` を `screen === "main" || … || screen === "settings"` の連鎖で導出して `<Header>` に渡し、
  本文は `{screen === "diagnostics" && <DiagnosticsScreen />}` のような並列条件で出し分けている。
- `Screen` は `types.ts` の union（`"main" | "add-tool" | "add-preset" | "diagnostics" | "settings" |
  "rakuraku-tools" | "obs-effects"`）。

### 画面の見た目のお手本

`SettingsScreen.tsx` が最も整っている。`formLayout.module.css` を `layout` として import し、
`layout.top` / `layout.title` `layout.pageTitle`（`<h2>` ＋ 説明 `<p>`）/ `layout.panel` / `layout.panelHead`（`<h3>` ＋ `<p>`）/
`layout.panelBody` を組み合わせる。ボタンは `components/primitives.tsx` の `Button`（variant: primary / secondary）。

**054 で確定する階層規則**（項目名＝`--text`×太字、説明＝`--muted`、`--text-faint` は無効/プレースホルダ専用）に従うこと。
新しい流儀を持ち込まない。

### 現在バージョンの取得

`AppUpdateStatus.current_version`（055b）を使う。
⚠ **`@tauri-apps/api/app` の `getVersion()` は使わない**——診断画面が表示している「アプリバージョン」は
`Cargo.toml` 由来で、updater が比較するのは `tauri.conf.json` の version。**updater の判断に使った値をそのまま表示する**
のが唯一ズレない方法（同期は 055a のガードが守るが、表示は判断元に合わせる）。

## このタスクでやること

### (1) 画面 ID と遷移

- `types.ts` の `Screen` に `"app-update"` を追加する。
- `App.tsx` の `activeNav` 導出条件に `screen === "app-update"` を足し、`Header` の `activeNav` prop の
  `Extract<Screen, …>` にも `"app-update"` を足す。
- `App.tsx` に `{screen === "app-update" && <UpdateScreen … />}` の分岐を足す。
- ⚠ **`HEADER_SECTIONS` には足さない**（アイコンボタンであってテキストセクション導線ではない）。

### (2) ベルアイコンとバッジ

- `Header.tsx` の診断ボタンの並びに、**同じ `styles.navBtn` の型で**ベルボタンを足す。
  - アイコンは**自前のインライン SVG**（`viewBox="0 0 24 24"` / `stroke="currentColor"` / `strokeWidth="1.8"`）。
    外部リソースを読み込まない・テーマ追従（`currentColor`）。**アイコンライブラリを追加しない**。
  - `title` / `aria-label` は「アップデート」。更新があるときは `aria-label` に件数を含める
    （例: 「アップデート（1件）」）。バッジ自体は `aria-hidden="true"`。
- バッジは `Header.module.css` に `.navBadge` を新設する。
  - `.navBtn` を `position: relative` にして右上に絶対配置。**色は役割トークンのみ**（`theme.css` の
    「生 hex/rgba を残さない」規約）。ヘッダー背景が `--primary` なので、その上で読める組み合わせを選ぶ。
  - **中身は常に「1」**（親 055 の決定。「未確認の更新通知が 1 件」の意味であって新しいリリースの件数ではない）。
- **置き場所**: 診断・設定の左（`sections` の右隣）。ベル → 診断 → 設定 の順。
- ⚠ **`data-tauri-drag-region` の内側にボタンを増やす**ことになるが、既存の診断/設定ボタンと同じ構造なので
  ドラッグ移動の挙動は変わらない（`button` はドラッグ領域から除外される）。実機で確認する。

### (3) 更新状態のフック

- 新規 `src/features/app-update/useAppUpdate.ts`。`usePresets` / `useLogs` と同じ作法で
  `App.tsx` が 1 つだけ持ち、`Header` と `UpdateScreen` に配る。
  - 返すもの: `status: AppUpdateStatus | null` / `phase: "idle" | "checking" | "ready" | "error"` / `error` / `recheck()`
  - **起動時に 1 回だけ `checkAppUpdate()` を呼ぶ**（`useEffect` の空依存）。**ON/OFF トグルは作らない**（親 055 の決定）。
  - ⚠ **チェックの失敗でアプリが壊れないこと**。失敗は `phase: "error"` に落とすだけで、
    バッジは出さず、他の画面には一切影響させない。ネット不通は正常な状態として扱う。
  - ⚠ **チェック中にヘッダーが固まらないこと**（`await` はフック内で完結し、レンダリングをブロックしない）。
  - ベルを押したときの再チェック（`recheck()`）を用意するかは実装時に判断してよいが、
    **押すたびに毎回通信する実装にはしない**（起動時 1 回＋明示的な再確認ボタン、程度に留める）。

### (4) アップデート画面

- 新規 `src/screens/app-update/UpdateScreen.tsx` ＋ `UpdateScreen.module.css`。
  `SettingsScreen.tsx` と同じく `formLayout.module.css` を `layout` として import して器を揃える。
- 表示する 3 状態:

  | 状態 | 表示 |
  | --- | --- |
  | 更新あり（`available: true`） | 現在バージョン → 新バージョン／更新内容（`notes`）／右下に「アップデート」ボタン |
  | 最新（`available: false`） | 現在バージョンと「最新版です」。アップデートボタンは出さない |
  | 取得失敗（`phase: "error"`） | 「更新を確認できませんでした」＋再確認の導線。**エラーの生文字列・URL は出さない**（§9） |

- 更新内容は **`<p>` などで改行を保持したプレーンテキスト**として出す（`white-space: pre-wrap`）。
  ⚠ **`dangerouslySetInnerHTML` を使わない**。055e が同じ場所を差し替えられるよう、
  **描画部分を 1 箇所に閉じ込めておく**（後から `renderReleaseNotes(notes)` に置き換えるだけで済む形）。
- **「アップデート」ボタンはこの時点では `disabled`** にし、「次のタスクで配線する」ことがコードコメントで分かるようにする。
  （中途半端に押せて何も起きないより、押せない方が事故が少ない。）
- 054 の階層規則に従う（見出し＝`--text`×太字、補足＝`--muted`、`--text-faint` は使わない）。
  色は役割トークン経由のみ・生 hex/rgba を書かない。

### (5) テスト

- `Header` のテスト: `available: true` でバッジが出る / `false` と `error` で出ない。
- `UpdateScreen` のテスト: 3 状態の表示（更新あり／最新／取得失敗）と、
  **アップデートボタンが `disabled` であること**。
- `checkAppUpdate` はモックする（実通信しない）。

## このタスクでやらないこと

- **ダウンロード・インストール・再起動の配線**（`install_app_update` / `restart_app` / 進捗表示は
  [055d](055d-update-install-and-restart.md)）。
- **マークダウン描画**（[055e](055e-release-notes-markdown.md)）。リリースノート内のリンクを踏ませること。
- 更新チェックの ON/OFF トグル（親 055 の決定により作らない）。**バッジの件数表示**（常に「1」）。
- **全リリース履歴の一覧表示**（表示するのは最新リリース 1 件だけ）。
- ヘッダーのレイアウト刷新・`HEADER_SECTIONS` の変更・アイコンライブラリの追加。
- Rust / capability / `tauri.conf.json` / CI の変更。**新規外部通信・API・依存の追加**。

## セキュリティ制約（docs/security.md 準拠）

- **frontend の表示のみ**。通信は 055b の `check_app_update` を呼ぶだけで、**新しい宛先・API・capability・依存を増やさない**
  （§1/§3/§10）。`csp: null` 不変。
- **アイコンは自前のインライン SVG のみ**。外部の画像・フォント・アイコンライブラリを読み込まない（§1・CSP 方針）。
- **`dangerouslySetInnerHTML` を使わない**。`notes` は `latest.json` 由来の外部文字列なので、
  テキストノードとしてしか描画しない（055e も同じ制約を継ぐ）。
- **§9**: 取得失敗時に**エラーの生文字列・URL・ローカルパスを画面にもコンソールにも出さない**。
  出してよいのは「確認できませんでした」という定型文言とバージョン文字列のみ。
- 更新状態を localStorage / SQLite に永続化しない（新規の保存経路を作らない）。

## 完了条件

- 更新があるとき、ヘッダーのベルに**バッジ「1」**が出る。無いとき・確認に失敗したときは出ない。
- ベルを押すとアップデート画面へ遷移し、**現在バージョン・新バージョン・更新内容**が表示される。
  「最新です」「確認できませんでした」の 2 状態も正しく出る。
- **更新内容の改行が保持されて読める**（マークダウン記法はまだそのまま文字として見える）。
- 右下に「アップデート」ボタンがあり、**`disabled`** になっている。
- ライト/ダーク両テーマで破綻しない（役割トークン経由の担保）。生 hex/rgba を書いていない。
- 更新チェックに失敗してもアプリの他の機能に影響がない（ネット遮断で起動して確認する）。
- 新規宛先/API/capability/依存の追加が無い。`csp: null` 不変。Rust に差分が無い。
- `pnpm --filter ./apps/desktop typecheck` / `lint` / `test` が通る。[`docs/progress.md`](../progress.md) を更新。

## 確認コマンド

```bash
git diff --stat
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
pnpm --filter ./apps/desktop test        # Header のバッジ / UpdateScreen の 3 状態

# ゼロ拡大の担保（差分ゼロが期待）
git status --short -- apps/desktop/src-tauri/ apps/comment-sidecar/ .github/ \
  apps/desktop/package.json pnpm-lock.yaml
# コメビュ側を触っていないことの担保（差分ゼロが期待）
git status --short -- apps/desktop/src/screens/comment-viewer/

pnpm --filter ./apps/desktop tauri dev   # ①ベルが出る ②更新があるときだけバッジ「1」
                                         # ③クリックでアップデート画面へ ④3 状態の表示
                                         # ⑤アップデートボタンが押せない ⑥改行が保持されている
                                         # ⑦ヘッダーのドラッグ移動が従来どおり効く（ボタンを 1 つ増やした影響）
                                         # ⑧macOS の信号機回避余白 / Windows の自作制御ボタンが崩れていない
                                         # ⑨機内モードで起動しても他機能に影響が無い
```

## 実装後に必要なレビュー

- 軽レビュー: frontend の表示のみで外部通信宛先・API・capability・依存が不変であること、
  **`dangerouslySetInnerHTML` を使っていない**こと、外部アイコン/フォント/画像を読み込んでいないこと、
  取得失敗時に**生エラー文字列・URL を画面やコンソールへ出していない**こと（§9）、
  色が役割トークン経由で生 hex/rgba が無いこと、054 の階層規則に従っていること、
  **アップデートボタンが本当に無効**で 055d 前に押せないことを確認する。
