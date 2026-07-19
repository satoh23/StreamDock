# 033a コメビュ本体の軽量化・レイアウト整理

> 状態: **未着手（実装サブタスク・033 系の先頭）**。分割・線引きは親 [033](033-comment-viewer-ux-revamp.md) を正とする。
>
> **必読前提**: 親 [033](033-comment-viewer-ux-revamp.md) と [`docs/security.md`](../security.md)。CLAUDE.md どおり
> **「実装して」と言われるまでコードは変更せず、まず変更計画と対象ファイルを提示する**。

## 目的

コメントビューア本体（[`CommentViewerApp.tsx`](../../apps/desktop/src/screens/comment-viewer/CommentViewerApp.tsx)）から
**検証用の要素を撤去して見た目を整理**し、**窓を実運用サイズへ拡大**する。純粋な frontend の整理＋窓サイズ値の変更で、
機能配線（Twitch/YouTube 取得・VOICEVOX 読み上げ）は触らない。**接続 UI・VOICEVOX バナーはこの時点では残置**し、
移設・トグル化は 033b/033c で行う（本タスクの範囲を狭く保ち退行を切り分ける）。

## 現在の前提（調査結果）

- ヘッダー: [`CommentViewerApp.tsx:365-368`](../../apps/desktop/src/screens/comment-viewer/CommentViewerApp.tsx#L365-L368)
  に `<h1>コメントビューア</h1>`（366）＋ `<span>{comments.length} 件</span>`（367）。
- OS 窓タイトルは既に「コメントビューア」（[`lib.rs:58`](../../apps/desktop/src-tauri/src/lib.rs#L58) の `.title("コメントビューア")`）。
- toolbar: `370-383` に「モックを追加」「クリア」「読み上げテスト」＋補足 note。
  - ハンドラ/定数: `addMock`（346-359）/ `clearAll`（361）/ `testSpeak`（333-344）/ `makeMock`（122-133）/
    `SEED_COMMENTS`（45-71・初期表示モック）/ `seqRef`（138）。
  - **残すもの**: `mergeComments`（101-120）と `enqueueForSpeech`（189-194）は実データ経路 `onComments`
    （205-210）で使用中。`makeMock`/`SEED_COMMENTS`/`seqRef`/`testSpeak`/`addMock`/`clearAll` は検証専用。
- コメント一覧: `<ol className={styles.list}>`（508-527）。空時は「コメントはまだありません」（510）。
- 窓サイズ: [`lib.rs:59-60`](../../apps/desktop/src-tauri/src/lib.rs#L59-L60) の
  `.inner_size(420.0, 640.0)` / `.min_inner_size(320.0, 400.0)`。メイン窓は `tauri.conf.json` で 1280×800。
- スタイルは [`CommentViewerApp.module.css`](../../apps/desktop/src/screens/comment-viewer/CommentViewerApp.module.css)（CSS Modules）。

## このタスクでやること

### (1) ヘッダー「コメントビューア」削除

- `366` の `<h1 className={styles.title}>コメントビューア</h1>` を削除。OS 窓タイトルが重複しているため不要
  （`styles.title` が他所で未使用になれば CSS も整理）。

### (2) コメント総数を一覧の右上へ移設

- `367` の `<span className={styles.count}>{comments.length} 件</span>` をヘッダーから外し、コメント一覧
  `<ol>`（508）の**直上に小見出し行（例: `listHeader`）を設けて右寄せ表示**する。`件` の文言は踏襲。
- ヘッダー要素が空になる場合は `<header>`（365-368）ごと除去してレイアウトを詰める。

### (3) モック追加/クリア/読み上げテストの撤去

- toolbar（370-383）を削除。併せて未使用になる `addMock`/`clearAll`/`testSpeak`/`makeMock`/`SEED_COMMENTS`/
  `seqRef` を削除する。`mergeComments`・`enqueueForSpeech` は**残す**（実データ経路で使用）。
- 初期表示は空配列（`useState<CommentViewDto[]>([])`）にし、既存の空状態「コメントはまだありません」を活用。
- lint の未使用 import/変数エラーが出ないよう、`makeMock` 等の削除に伴う import 整理も行う。

### (4) ウィンドウサイズの拡大（縦長→横広）

- [`lib.rs:59-60`](../../apps/desktop/src-tauri/src/lib.rs#L59-L60) を横広へ変更。**提案値**:
  `.inner_size(960.0, 720.0)` / `.min_inner_size(560.0, 520.0)`（メイン窓 1280×800 以下・「デフォルトと同じか
  それより小さい」範囲）。実値は `pnpm tauri dev` で目視調整し、tasks の完了時に確定値をコミットメッセージへ残す。

## このタスクでやらないこと

- 接続 UI（Twitch/YouTube パネル 386-487）の移設・撤去（**033b**）。この時点では残置。
- VOICEVOX バナー（489-506）のトグル化・クレジット条件表示（**033c**）。
- 設定ビュー・話者選択・ツール管理・OBS オーバーレイ（033b〜f）。
- データ取得・TTS・sidecar・Rust command のロジック変更（窓サイズの数値以外の Rust 変更はしない）。

## セキュリティ制約（docs/security.md 準拠）

- frontend の表示要素の削除・移動と、窓の初期/最小サイズ**数値のみ**の変更。OS 操作・ファイル操作・プロセス操作・
  外部通信を増やさない（§1/§2/§4/§5）。
- 新しい Tauri command / capability / 依存を追加しない（§3/§10）。`csp: null` 不変。
- `open_comment_viewer_window` の**ロジック（sidecar 連動・単一インスタンスガード・窓イベント）は変更しない**。
  変更は `inner_size`/`min_inner_size` の引数値に限定する。

## 完了条件

- ヘッダーのタイトルが消え、コメント総数がコメント一覧の右上に表示される。
- モック追加/クリア/読み上げテストのボタンと未使用ハンドラが撤去され、初期表示は空（「コメントはまだありません」）。
- コメビュ窓が横広（提案 960×720・実値は目視調整）で開く。
- 接続・VOICEVOX 読み上げの既存挙動に退行がない（Twitch/YouTube 取得開始・読み上げが従来どおり動く）。
- 新しいライブラリ / Tauri command / capability を追加していない。
- `pnpm --filter ./apps/desktop typecheck` / `lint` / `cargo check` が通る。
- [`docs/progress.md`](../progress.md) が更新されている。

## 確認コマンド

```bash
git diff --stat
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
cd apps/desktop/src-tauri && cargo check
pnpm --filter ./apps/desktop tauri dev   # コメビュを開き、タイトル削除/総数の右上表示/モック撤去/横広サイズ/既存取得の退行なしを目視
```
