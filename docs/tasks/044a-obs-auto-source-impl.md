# 044a OBS 自動ソース追加 実装（決定方式）

> 状態: **未着手（実装サブタスク・[044s](044s-obs-websocket-spike.md) の方式決定後に着手）**。分割・線引きは親 [044](044-obs-auto-source.md) を正とする。
>
> **必読前提**: 親 [044](044-obs-auto-source.md)、スパイク [044s](044s-obs-websocket-spike.md)（方式 A/B の決定・security 方針ドラフト）、
> オーバーレイ開閉 [034d](034d-overlay-controls-in-settings.md)・設定節 [`SettingsView.tsx`](../../apps/desktop/src/screens/comment-viewer/SettingsView.tsx)（364-425 行）、
> [`docs/security.md`](../security.md)（§1／allow-list／sidecar 封じ込め／§9 資格情報／§10 依存／レビュー必須条件「外部通信」）。
> CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。**新規 loopback 通信＋新規依存＋方針反転のため security-review 必須**。

## 目的

[044s](044s-obs-websocket-spike.md) で決定した方式で、**OBS オーバーレイを ON にしたときに OBS へオーバーレイソースを自動追加**（既存なら再利用）し、
ワンクリックで配信画面にコメントビューアーが出るようにする（要望①）。失敗時は現行の手動手順へフォールバックし、退行させない。

## 現在の前提（調査結果・実コード）

- 現行オーバーレイ ON/OFF は設定ビュー [`SettingsView.tsx`](../../apps/desktop/src/screens/comment-viewer/SettingsView.tsx)（364-425 行・[034d](034d-overlay-controls-in-settings.md)）。開閉窓は [`lib.rs`](../../apps/desktop/src-tauri/src/lib.rs) の `open_comment_overlay_window`（174-219 行）/ `close_comment_overlay_window`（226-234 行）/ `is_comment_overlay_open`（261-264 行）、frontend ラッパは [`windowApi.ts`](../../apps/desktop/src/features/comment-viewer/windowApi.ts)。
- 通信は sidecar 封じ込め（Rust 完全同期）。sidecar 宛先は [`host-guard.ts`] の allow-list で fail-closed。→ **obs-websocket クライアントは sidecar 側（`obs-websocket-js`）に置く**。
- 具体の方式（A＝ウィンドウキャプチャ / B＝ブラウザソース＋ローカル HTTP）と対象ファイル・UI 仕様は **044s の決定に従う**（本ファイルの (1)〜(3) は決定後に具体化する）。

## このタスクでやること（044s の決定を反映して具体化）

### (1) OBS 連携（sidecar 側）

- sidecar に obs-websocket v5 クライアント（`obs-websocket-js`）を追加。`ws://127.0.0.1:4455` へ**ユーザーが OBS 連携を有効化した時のみ**接続（認証パスワード対応）。allow-list（[`host-guard.ts`]）に **loopback 4455** を通す（外部 HTTPS/WSS の allow-list とは分離・loopback 限定）。
- 決定方式でソースを自動作成: **既存ソース検出→無ければ作成／有れば再利用**（重複追加しない）。作成先シーン（現在シーン等）の扱いは 044s の結論に従う。
- 失敗（OBS 未起動 / WS 無効 / 認証失敗）は graceful に扱い、viewer へ「自動追加できないため手動手順で」を通知（hot-loop しない）。

### (2) UI（オーバーレイ設定節）

- 設定ビューのオーバーレイ節（[`SettingsView.tsx`](../../apps/desktop/src/screens/comment-viewer/SettingsView.tsx) 364-425 行）に **「OBS へ自動追加（連携）」トグル/ボタン**と、OBS WebSocket のパスワード入力（必要時）、失敗時の**手動手順フォールバック案内**を置く。
- オーバーレイ ON 操作（[034d](034d-overlay-controls-in-settings.md) の `overlayOpen` トグル）と連動させ、ON で（連携有効なら）自動追加を試みる。

### (3) security.md 追記

- [`docs/security.md`](../security.md) に、OBS 連携の方針（**loopback 4455 限定解禁・明示同意時のみ・sidecar 封じ込め・パスワード非ログ非外部送信・新規依存 `obs-websocket-js` の理由・方式 B なら HTTP サーバの範囲**）を追記。§1 の例外運用と §10 依存、レビュー必須条件「外部通信」に沿って記述。

## このタスクでやらないこと

- **外部インターネット通信の追加**（OBS 連携は loopback のみ）。Rust への async/WS/HTTP crate の持ち込み（同期方針維持・OBS 通信は sidecar）。
- obs-websocket 以外の OBS 連携（プラグイン等）。オーバーレイ意匠の変更（043c）。方式の再検討（044s 済み）。

## セキュリティ制約（docs/security.md 準拠）

- OBS 連携は **loopback `127.0.0.1:4455` のみ・ユーザーが有効化した時のみ**（明示同意）。外部インターネット通信は増やさない。通信面は **sidecar に封じ込め**（Rust 完全同期・main no-internet 不変）。
- OBS WebSocket パスワードは **非ログ・非外部送信**（§9・保存する場合は OS キーチェーン等）。新規依存（`obs-websocket-js`・方式 B の HTTP 手段）は §10 で理由を記録。capability を不要に広げない。`csp: null` は方式 B の webview 影響を含め方針を明記（当面維持）。
- **方針反転（033/033f）＋新規通信面（loopback 4455）＋新規依存のため security-review 必須**（レビュー必須条件「外部通信」）。

## 完了条件

- オーバーレイ ON（連携有効）で OBS にオーバーレイソースが**自動追加**され（既存なら再利用・重複しない）、ワンクリックで配信画面にコメントが出る。
- OBS 未起動/WS 無効/認証失敗時は手動手順へ**graceful にフォールバック**し、現行の手動キャプチャ運用が退行しない。
- OBS 連携は **loopback のみ・明示同意時のみ・sidecar 封じ込め**。外部インターネット通信は増えていない（`lsof -i` で確認）。パスワードは非ログ・非外部送信。
- security.md に方針が追記されている。新規依存の理由が §10 に記録されている。`csp: null`（方式に応じた方針）明記。
- `pnpm --filter ./apps/desktop typecheck` / `lint` / `cargo check`（Rust に触れる場合）が通る。sidecar ビルドが通る。[`docs/progress.md`](../progress.md) を更新。
- **security-review を通過**している。

## 確認コマンド

```bash
git diff --stat
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
cd apps/desktop/src-tauri && cargo check   # Rust に触れる場合
pnpm --filter ./apps/desktop tauri dev     # OBS 起動＋WS 有効で、オーバーレイ ON→ソース自動追加（重複しない）／WS 無効時は手動手順案内を目視
# no-internet 確認: lsof -i で 4455 が sidecar PID 下のみ・外部インターネット ESTABLISHED が増えていないこと
```

## 実装後に必要なレビュー

- security-review（必須）: OBS 連携が **loopback 4455 限定・明示同意時のみ・sidecar 封じ込め**で外部インターネット通信を増やしていないこと、パスワードを**非ログ・非外部送信**にしていること、新規依存（`obs-websocket-js`・方式 B の HTTP 手段）が §10 に記録され capability/CSP を不要に広げていないこと、main 窓の no-internet と Rust 同期方針を壊していないことを確認。
