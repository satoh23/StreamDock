# 033f OBS 用透過オーバーレイ窓（ワンクリック）

> 状態: **未着手（実装サブタスク・033 系の最後）**。分割・線引きは親 [033](033-comment-viewer-ux-revamp.md) を正とする。
>
> **必読前提**: 親 [033](033-comment-viewer-ux-revamp.md)、[`docs/security.md`](../security.md)（特に §1 /
> 「## コメントビューア（配信サービス連携）方針②」＝通信は sidecar と viewer webview に封じ込め・「## Tauri
> Permissions / Capabilities 方針」・「## CSP方針」）、[032c-a](032c-a-comment-viewer-window-internal-tool.md)（別窓＋
> capability の作法）、先行 [033b](033b-settings-view-connection.md)（`CommentList` 分割の再利用）。CLAUDE.md どおり
> **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。**新規窓・透過・新規 capability のため
> security-review 必須**。

## 目的

コメント一覧を OBS へ載せるために、**背景透過のオーバーレイ窓をワンクリックで開ける**ようにする。ユーザーは OBS の
「ウィンドウキャプチャ」でこの窓を取り込む（透過背景がそのまま抜ける）。**追加依存・新規外部通信ゼロ**で、既存の
ウィンドウ生成方式と sidecar WS（ループバック）を再利用する。obs-websocket による自動ソース追加は採らない（親 033 方針）。

## 現在の前提（調査結果）

- 窓は同一 Vite バンドルをラベル分岐（[`App.tsx:352-358`](../../apps/desktop/src/App.tsx#L352-L358)：
  `getCurrentWindow().label` で `CommentViewerApp` を出し分け）。別窓は Rust の `WebviewWindowBuilder` で生成
  （[`lib.rs:38-73`](../../apps/desktop/src-tauri/src/lib.rs#L38-L73) の `open_comment_viewer_window` が手本。label・
  単一インスタンスガード・窓イベントの型）。
- コメント一覧の描画は `CommentList`（033b で切り出す）。データは sidecar の loopback WS から
  [`connectCommentStream`](../../apps/desktop/src/features/comment-viewer/commentStream.ts)（`get_comment_stream_port`
  → `ws://127.0.0.1:<port>`）で受信し、`mergeComments`（append＋重複排除＋クランプ）で表示。
- capability は per-window（`capabilities/comment-viewer.json` が `comment-viewer` 窓用・`main` 不変）。
  `csp: null`（強制なし）。透過窓は Tauri の `WebviewWindowBuilder.transparent(true)` で作れる（要 `decorations(false)`）。
- 既存の透過・always-on-top 窓は無い（新規）。

## このタスクでやること

### (1) Rust: 透過オーバーレイ窓を開くコマンド

- `open_comment_overlay_window`（label `comment-overlay`）を新設。`WebviewWindowBuilder` に
  `.transparent(true).decorations(false).always_on_top(true)` ＋適切な初期サイズ。単一インスタンスガード
  （既存なら前面化）は `open_comment_viewer_window` に倣う。`invoke_handler` に登録。
- **sidecar 連動の扱い**: オーバーレイは表示専用。sidecar は既にコメビュ窓の `ensure_started` で起動している前提とし、
  **オーバーレイ単独で sidecar を起動/停止しない**（no-orphan の 3 段 kill を壊さないよう、shutdown 契機はコメビュ窓の
  既存イベントに集約したまま）。オーバーレイの close で sidecar を落とさない点を実装時に明示。
- `capabilities/comment-overlay.json` を新設（**最小権限**・`core:default` 程度）。`main` /
  `comment-viewer` の capability は不変。tauri.conf の透過対応（macOS の透過描画）を確認。

### (2) frontend: オーバーレイ描画（背景透過・表示専用）

- [`App.tsx`](../../apps/desktop/src/App.tsx) のラベル分岐に `comment-overlay` を追加し、`OverlayApp`（新設）を描画。
  `OverlayApp` は **`CommentList`（033b 分割）だけ**を**背景透過 CSS**（`body`/root を透明・カード背景のみ半透明等）で
  表示する。**操作 UI（接続・設定・トグル）は持たない**。
- オーバーレイは同一 sidecar WS へ `connectCommentStream` で**読み取り専用接続**して一覧を映す（`onComments` のみ使用・
  制御フレームは送らない）。これによりコメビュ本体とオーバーレイが同じコメントを表示する。

### (3) コメビュ本体に「OBS 用オーバーレイを開く」ボタン（ワンクリック）

- コメビュ本体（または設定ビュー）に「OBS 用オーバーレイを開く」ボタンを設置し、`open_comment_overlay_window` を呼ぶ。
- **初回のみ OBS 側でウィンドウキャプチャの追加が要る**旨を、ボタン近傍の小さな注記で案内する（tasks の完了条件にも明記）。

## このタスクでやらないこと

- **obs-websocket による OBS 自動ソース追加**（別方式・新規 localhost 接続面・新規依存。将来検討）。
- オーバーレイの装飾・アニメーション・レイアウトの作り込み（最小の一覧表示に留める）。
- オーバーレイからの接続/設定操作（表示専用）。
- コメビュ本体 UI（033a〜d）・ツール管理（033e）。

## セキュリティ制約（docs/security.md 準拠・重点 §1 / Capabilities 方針 / CSP方針）

- **新規外部通信を作らない**。オーバーレイのデータ源は既存の loopback sidecar WS（`ws://127.0.0.1:<port>`）の
  **読み取り専用接続**のみ。allow-list 宛先の Twitch/YouTube 通信は sidecar に封じ込め済みで、**main 窓は no-internet
  維持**（オーバーレイは viewer webview 相当の loopback WS だけ・インターネットに出ない・§1/方針②）。
- **新規 capability は最小権限**（`comment-overlay.json`・`core:default` 程度）。`main`/`comment-viewer` の capability を
  広げない。汎用強権や広い window scope を足さない（Capabilities 方針）。`csp: null` 不変（外部 script/style/image を
  増やさない・CSP方針）。
- 新規依存（npm/crate/plugin）を追加しない（§10）。取得コメント本文はログ/DB に出さない（既存踏襲）。オーバーレイの
  close で sidecar を落とさない（no-orphan kill をコメビュ窓イベントに集約したまま）。
- **新規窓・透過・always-on-top・新規 capability のため security-review 必須**（親 033 の表・「## レビュー必須条件」の
  Tauri capabilities に該当）。

## 完了条件

- 「OBS 用オーバーレイを開く」ボタンで、背景透過・フレームレス・最前面のオーバーレイ窓が開く。
- オーバーレイが sidecar の loopback WS からコメント一覧を読み取り専用で表示し、コメビュ本体と同じコメントが出る。
- OBS の「ウィンドウキャプチャ」で取り込むと背景が透過して合成できる（初回のみキャプチャ追加が要る旨を注記済み）。
- オーバーレイは操作 UI を持たず、close しても sidecar を落とさない（no-orphan kill はコメビュ窓に集約のまま）。
- 新規外部通信ゼロ・新規依存ゼロ・`main`/`comment-viewer` capability 不変・`csp: null` 不変。
- `pnpm --filter ./apps/desktop typecheck` / `lint` / `cargo check` が通る。
- **security-review を通過**している。[`docs/progress.md`](../progress.md) が更新されている。

## 確認コマンド

```bash
git diff --stat
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
cd apps/desktop/src-tauri && cargo check
pnpm --filter ./apps/desktop tauri dev   # オーバーレイを開く→透過表示／同一コメント表示／OBS ウィンドウキャプチャで透過合成／close で sidecar が落ちないことを目視
# no-internet 確認: lsof -i で外部 ESTABLISHED が sidecar PID 下のみ・オーバーレイ/main 本体 PID に出ないこと
```

## 実装後に必要なレビュー

- security-review: **新規 capability（`comment-overlay.json`）が最小権限**で `main`/`comment-viewer` を広げていないこと、
  オーバーレイの通信が **loopback WS 読み取り専用に限定**され新規外部通信・新規依存が無いこと、透過/always-on-top 窓が
  意図した表示専用に留まること、no-orphan kill 契機を壊していないことを確認。
