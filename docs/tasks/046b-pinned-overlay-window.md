# 046b 固定コメント専用オーバーレイ窓（新窓・独立）

> 状態: **実装済み（2026-07-29）**。実装記録・決定理由・検証結果は [`docs/progress.md`](../progress.md) の
> 「2026-07-29 (046b 固定コメント専用オーバーレイ窓…)」節を正とする。**security-review 実施済み**（判定「軽微な懸念あり」・修正必須 0 件）。
>
> **本ファイルの前提が実装時に変わった点（読むときに注意）**:
>
> 1. **(4) 開閉トグルの手本「034d と同型（設定ビューの OBS カード）」は古い**。034d は **045b で部分反転**しており、
>    現在の線引き（親 045）は「表示（開閉）＝配信中に頻繁に切替＝**本体ツールバー** ／ 一度きりのセットアップ＝**設定カード**」。
>    046b は後者と判断し、**設定ビューに専用カードを新設**した（既存 OBS カードには相乗りせず、その直後に置く＝既存カードは無改変）。
>    理由: 固定コメントの出し入れは右クリックメニュー側の仕事で、窓は開けっぱなしにする（親 046 が自動 close を禁じている）ため、
>    窓の開閉は配信中の操作ではない。加えてこの窓は 044a の自動追加の**対象外**だった（→ 046d で対象に入れたので、この理由は失効）。当時は OBS で手動キャプチャを追加する作業が要り、
>    その手順注記と同じカードにトグルがあるのが導線として自然。
> 2. **トグルは localStorage に永続し、ON ならコメビュ本体のマウント時に窓を自動で開く**（依頼者の決定）。
>    親 046 の「開閉は明示トグル（自動開閉にしない）」という文言からの**意図的な逸脱**だが、046 の理由は
>    「**ピン 0 件で窓が自動で閉じると** OBS ソースが黒くなる」＝自動 **close** の禁止であり、今回入れたのは
>    ユーザーが明示的に ON にした設定に基づく自動 **open** のみ（窓がより確実に存在する方向＝意図には沿う）。
>    **自動 close は作っていない**（設定 OFF で窓が開いていても閉じない）。詳細は progress.md の当該節。
> 3. **⚠ 未検証点**: 別 webview 間で `storage` イベントが跨って届くかは**実機未確認**（034e review M1 と同じ）。
>    届かなかった場合の代替（localStorage ポーリング）は**実装していない**（採否は実機判定後）。候補と却下理由は progress.md。
>
> 分割・線引きは親 [046](046-pinned-comment-overlay.md) を正とする。
>
> **必読前提**: 親 [046](046-pinned-comment-overlay.md)、ピンストア [046a](046a-viewer-pin-comment.md)（localStorage の書き手）、
> 新窓 1 枚を増やす手本＝[`lib.rs`](../../apps/desktop/src-tauri/src/lib.rs)（overlay 窓）・[`OverlayApp.tsx`](../../apps/desktop/src/screens/comment-viewer/OverlayApp.tsx)（storage 購読）・
> [`App.tsx`](../../apps/desktop/src/App.tsx)（label 分岐）・[`windowApi.ts`](../../apps/desktop/src/features/comment-viewer/windowApi.ts)・[`capabilities/comment-overlay.json`](../../apps/desktop/src-tauri/capabilities/comment-overlay.json)、
> [`docs/security.md`](../security.md)（§1 外部通信／§3 単一目的コマンド／Capabilities 方針／§6 PID kill）。
> CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。**新規ウィンドウ＋新規 capability＋新規 Rust command のため security-review 必須**。

## 目的

046a の固定コメントを、**既存のコメント表示オーバーレイ（`comment-overlay`）とは独立した専用ウィンドウ**（label `pinned-overlay`）で OBS へ固定表示する（要望③後半）。
専用オーバーレイは **WS に接続せず**、046a がピンストア（localStorage）に書いた固定コメントを read-on-mount＋`storage` 購読で描くだけ＝**表示専用・通信面ゼロ**。

## 現在の前提（調査結果・実コード）

既存 `comment-overlay` 窓の配線が**そのまま手本**（親 046 の「新窓 1 枚を増やす手本」参照）:

- Rust: `open_comment_overlay_window`（[`lib.rs`](../../apps/desktop/src-tauri/src/lib.rs#L174) 174-220 行・透過/装飾なし/最背面/非フォーカス/影なし/`background_throttling(Disabled)`）／`close_comment_overlay_window`（227-235 行）／`is_comment_overlay_open`（262-265 行）。
  - `WINDOW_OPEN_LOCK`（38 行）＝二重生成ガード（viewer/overlay で共有）。`SHARED_BROWSER_ARGS`（72 行）＝**全窓一致必須**（不一致だと Windows で WebView2 生成失敗＝窓が開かない回帰）。
  - `invoke_handler` 登録（428-436 行）。**ここへ追加しないと呼べない**。
  - 意図的に window イベント（sidecar 連動）を**登録しない**（表示専用・217-218 行）。
- フロント: 全窓が同一 `index.html` を読み、[`App.tsx`](../../apps/desktop/src/App.tsx#L355) の label 分岐（355-364 行）で描画を切替。overlay 本体は [`OverlayApp.tsx`](../../apps/desktop/src/screens/comment-viewer/OverlayApp.tsx)。
  - `OverlayApp.tsx` は `data-overlay="1"` を document に立てて透明化（41-47 行）、`storage` 購読で設定を即反映（60-73 行）＝**localStorage 受け側の手本**。
  - ラッパは [`windowApi.ts`](../../apps/desktop/src/features/comment-viewer/windowApi.ts)（`openCommentOverlayWindow` 等 38-58 行）。
- capability: [`capabilities/comment-overlay.json`](../../apps/desktop/src-tauri/capabilities/comment-overlay.json)（`windows:["comment-overlay"]`・`permissions:["core:default"]`）。
  `csp: null`（[`tauri.conf.json`](../../apps/desktop/src-tauri/tauri.conf.json) 25-27 行）・`macOSPrivateApi:true`（24 行）。
- **Vite は単一入口**（[`vite.config.ts`](../../apps/desktop/vite.config.ts) に複数入口なし）＝新窓も `WebviewUrl::App("index.html")`＋App.tsx 分岐で足りる（**vite.config.ts / tauri.conf.json は変更不要**）。
- 開閉トグルの手本: 034d の overlay 開閉トグル（設定ビューの OBS カード [`SettingsView.tsx`](../../apps/desktop/src/screens/comment-viewer/SettingsView.tsx) 235-385 行）。

## このタスクでやること

### (1) Rust: 専用オーバーレイ窓のコマンド（既存 overlay と同型）

- [`lib.rs`](../../apps/desktop/src-tauri/src/lib.rs) に `open_pinned_overlay_window` / `close_pinned_overlay_window` / `is_pinned_overlay_open` を追加（`open_comment_overlay_window` 174-220 行・`close_*` 227-235 行・`is_*` 262-265 行を手本）。
  - `WINDOW_OPEN_LOCK`（38 行）を再利用、`SHARED_BROWSER_ARGS`（72 行）を**必ず渡す**（全窓一致）。透過/装飾なし/最背面/非フォーカス/影なし/`background_throttling(Disabled)` を踏襲。窓タイトルは OBS で選びやすい別名（例「StreamDock 固定コメント」）。
  - 既存 overlay と**別の初期位置/サイズ**にして、OBS で 2 つのウィンドウキャプチャを取り違えないようにする。
  - **sidecar 連動イベントは登録しない**（表示専用・217-218 行に倣う）。
  - `invoke_handler`（428-436 行）へ 3 コマンドを追加登録する。
- [`windowApi.ts`](../../apps/desktop/src/features/comment-viewer/windowApi.ts) に `openPinnedOverlayWindow()` / `closePinnedOverlayWindow()` / `isPinnedOverlayOpen()` ラッパを追加（38-58 行を手本）。

### (2) capability（最小権限・既存と同型）

- 新規 [`capabilities/pinned-overlay.json`](../../apps/desktop/src-tauri/capabilities/pinned-overlay.json) を追加（`comment-overlay.json` を手本・`windows:["pinned-overlay"]`・`permissions:["core:default"]`）。
  ※ アプリ定義コマンドは Tauri v2 ACL の対象外（`windowApi.ts` 11-12 行の注記）なので、capability への command 列挙は不要。`main`/`comment-viewer`/`comment-overlay` の capability は不変。

### (3) フロント: 専用オーバーレイの描画（localStorage 読み手）

- [`App.tsx`](../../apps/desktop/src/App.tsx#L355) の label 分岐（355-364 行）に `label === "pinned-overlay"` → 新規 `PinnedOverlayApp` を追加する。
- 新規 `screens/comment-viewer/PinnedOverlayApp.tsx`（`OverlayApp.tsx` を手本）を追加する。
  - `data-overlay="1"` を立てて透明化（`OverlayApp.tsx` 41-47 行と同じ・既存の透過 CSS ガードを流用）。
  - **WS へは接続しない**。046a のピンストア（`pinnedComments.ts`）を **read-on-mount＋`storage` 購読**（`OverlayApp.tsx` 60-73 行と同型）で読み、固定コメントを描く。
  - 意匠は既存 overlay 意匠（[`OverlayComment.module.css`](../../apps/desktop/src/screens/comment-viewer/OverlayComment.module.css)）を流用/参考。

### (4) 開閉トグル

- 専用オーバーレイの開閉トグルを追加する（親 046 の初期案＝設定ビューの OBS カードに「固定コメントをOBSに表示」トグル）。`open/closePinnedOverlayWindow()` を呼び、`is*Open()` でマウント同期する（034d と同型）。**自動開閉にはしない**（OBS ソースが黒くならないため）。

## このタスクでやらないこと

- **ピンの生成/保存側**（046a）。既存 `comment-overlay` の変更。~~専用オーバーレイの **OBS 自動ソース追加**（044a 拡張・将来タスク）~~
  → **2026-07-29 撤回・[046d](046d-pinned-overlay-obs-auto-add.md) で実装**（親 046 の同項も撤回済み）。
- **WS 接続・Rust emit・sidecar への関与・新規外部通信・新規依存**（窓間は localStorage で完結）。任意ラベル/任意オプションの汎用窓生成コマンドの追加（単一目的のみ）。

## セキュリティ制約（docs/security.md 準拠）

- 新規 Rust command は**単一目的**（`open_pinned_overlay_window` / `close_*` / `is_*_open`）で既存 overlay コマンドと同型（任意ラベル・任意オプションの窓生成を露出しない・§3）。
- 新 capability は `windows:["pinned-overlay"]`・`permissions:["core:default"]` の**最小権限**（`comment-overlay.json` と同型）。`main`/`comment-viewer`/`comment-overlay` の capability は不変・`csp: null` 不変・`macOSPrivateApi` 既存のまま。
- 専用オーバーレイは**表示専用**（WS/制御フレームを持たない・localStorage の非機密ピンを読むだけ）。sidecar を起動/停止しない＝**no-orphan kill 契機を壊さない**（§6 の PID kill は発生しない）。**新規通信面・依存ゼロ**。
- **新規ウィンドウ＋新規 capability＋新規 command のため security-review 必須**。

## 完了条件

- 固定専用オーバーレイ窓（label `pinned-overlay`）が開閉トグルで開閉でき、既存 `comment-overlay` とは**別窓で独立**している（OBS で別ソースとして取り込める）。
- 046a のピン追加/解除が localStorage 経由で専用オーバーレイに反映される（read-on-mount＋storage 購読・開き直しでも必ず最新）。
- 追加コマンドは単一目的の 3 つのみで、新 capability は最小権限。既存窓 capability・`csp: null`・`SHARED_BROWSER_ARGS` 全窓一致が不変。
- 専用オーバーレイは WS/sidecar に触れず、新規外部通信・emit・依存が無い。
- `pnpm --filter ./apps/desktop typecheck` / `lint` / `cargo check` が通る。[`docs/progress.md`](../progress.md) を更新。**security-review を通過**している。

## 確認コマンド

```bash
git diff --stat
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
cd apps/desktop/src-tauri && cargo check
pnpm --filter ./apps/desktop tauri dev   # トグルで専用オーバーレイ開閉／046a で固定→専用オーバーレイに反映／既存 comment-overlay と別窓・独立／
                                         #   専用オーバーレイ close で sidecar が落ちない（no-orphan kill 不変）、を目視
```

## 実装後に必要なレビュー

- **security-review 必須**: 追加した `open/close/is_*_pinned_overlay_window` が**単一目的**で `main`/`comment-viewer`/`comment-overlay` の capability を広げていないこと、
  新 `pinned-overlay.json` が最小権限（`core:default`・`windows` 限定）であること、専用オーバーレイが**表示専用**で新規通信面・WS・emit・依存が無いこと、
  `SHARED_BROWSER_ARGS` を全窓一致で渡していること、no-orphan kill 契機（専用オーバーレイ close で sidecar を落とさない）を壊していないこと、`csp: null` 不変を確認する。
