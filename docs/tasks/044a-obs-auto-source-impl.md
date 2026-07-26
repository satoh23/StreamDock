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

---

## 044s スパイク反映（2026-07-26）：方式 **A（ウィンドウキャプチャ自動追加）に確定**

[044s](044s-obs-websocket-spike.md) の実測で **方式 A を採用**（B は本製品ユーザー実機で未描画＋HTTP 配信新設の工数）。以下は 044s の結論を反映した実装スコープと **security 方針差分ドラフト（下書き・security.md への正式追記は本 044a 実装時に security-review を通して行う）**。

### 実装スコープ（方式 A・対象ファイル）
1. **sidecar に OBS クライアント（新規 module）**：`obs-websocket-js` で `ws://127.0.0.1:4455` に**ユーザーが OBS 連携を有効化した時のみ**接続（認証パスワード対応・timeout 付き単発接続・失敗は graceful／指数バックオフ）。実装する OBS 操作は 044s で実証した最小セット：`GetVersion`／`GetSceneList`（`currentProgramSceneName`）／`GetInputList`（既存検出）／`CreateInput`(`window_capture`)／`GetInputPropertiesListPropertyItems("window")`（窓候補列挙）／`SetInputSettings`（`{owner_name, window_name, window}` を設定）。
   - **窓ターゲットは安定キー優先**：候補 itemName `[owner] title` を分解し `owner_name="stream-dock"` ＋ `window_name="StreamDock コメントオーバーレイ"` で解決（数値 `window` ID は補助・起動毎に変わるため単独依存しない）。
   - **べき等**：同名ソース（例 `StreamDock コメントオーバーレイ`）が既存なら再作成せず再利用（重複追加しない）。
   - **OS 分岐**：macOS＝上記3フィールド。**Windows＝`window` を `title:class:exe` 文字列で組み立て**（要 098 VM 実機検証・WGC/透過/DPI）。
2. **制御フレーム/配線（[index.ts](../../apps/comment-sidecar/src/index.ts)）**：viewer→sidecar に「OBS 連携 ON/自動追加」制御を追加、sidecar→viewer に結果（成功/失敗理由）を通知。パスワードは §9 に従い loopback WS には**平文で載せない**方式を選ぶ（下記ドラフト参照）。
3. **UI（[SettingsView.tsx](../../apps/desktop/src/screens/comment-viewer/SettingsView.tsx) 364-425 行のオーバーレイ節）**：「OBS へ自動追加（連携）」トグル＋（認証有効時）パスワード入力＋**失敗時フォールバック案内**（現行の手動ウィンドウキャプチャ手順＝033f の注記を再利用）。オーバーレイ ON（034d `overlayOpen`）連動で自動追加を試みる。
4. **フォールバック仕様**：OBS 未起動／WS 無効／認証失敗／窓未検出 のとき、退行させず「自動追加できないため手動で『ウィンドウキャプチャ』を追加してください」に落とす（hot-loop しない）。

### security 方針差分ドラフト（下書き・docs/security.md へは 044a 実装時に追記）
- **§1（外部通信）例外追補**：OBS 連携の **loopback `127.0.0.1:4455` 限定解禁**。外部 HTTPS/WSS の allow-list とは**分離・loopback 限定・ユーザーが OBS 連携を有効化した時のみ**接続。外部インターネット通信は増やさない（`lsof -i` で loopback 限定を検証）。
- **fail-closed 強制の設計論点（044s 実測に基づく重要点）**：現 [host-guard.ts](../../apps/comment-sidecar/src/host-guard.ts) の WS ガード（`guardedWebSocketRuntime`）は **DI 注入型で EventSub 専用＝global の WS 傍受ではない**うえ `assertAllowedWsUrl` は **`wss:` 必須**。よって `obs-websocket-js` はこのガードを**素通り**する。fail-closed を保つため、**global `WebSocket` ガードを新設**（`installHttpHostGuard()` の `fetch` と対称）し、**既存 WSS allow-list ＋ `ws://127.0.0.1:4455`（loopback・OBS 連携有効時のみ）だけを許可**、他は throw、を推奨案とする（最終形は security-review で確定）。
- **§9（資格情報）**：OBS WebSocket パスワードは **非ログ・非外部送信**。**loopback WS（未認証）に平文で載せない**（既存 Twitch/YouTube トークンと同じ親子 private pipe or Rust キーチェーンの流儀に寄せる／少なくとも保存する場合は OS キーチェーン）。接続はユーザー明示有効化時のみ。
- **§10（依存）**：新規 npm `obs-websocket-js`（sidecar 側・obs-websocket v5 クライアント）の理由を記録。**Rust には async/WS/HTTP crate を足さない**（OBS 通信は sidecar・main no-internet 不変）。方式 A 採用のため**ローカル HTTP サーバは新設しない**（方式 B の HTTP 依存は不要）。
- **capability/CSP**：`comment-viewer`/`main` の capability を広げない・`csp: null` 不変（方式 A は webview に外部リソースを増やさない）。
- **レビュー必須条件**「外部通信」に該当＝**方針反転（033/033f）＋新規 loopback 通信面＋新規依存のため security-review 必須**。

---

## 追加仕様（2026-07-26・本人要望）

### (追加1) OBS WebSocket サーバーの有効化を極力ユーザーにさせない（自動化の可否と UX）

**要望**：可能なら WebSocket サーバー有効化の手作業を無くす。無理なら UI で有効化手順を（できれば実画像付きで）案内する。

**自動化の可否（044s の知見＋方針判断）**：
| 手段 | 可否 | 理由 |
|---|---|---|
| obs-websocket 経由で有効化 | ❌ 不可 | サーバが ON でないと接続できない鶏卵問題（有効化 API を叩く前提の接続ができない） |
| OBS 起動フラグ（CLI）で有効化 | △ 要調査・低期待 | 安定・公式な有効化フラグは確認できていない。044a で存在を確認し、あれば最も安全な自動化候補 |
| OBS 設定ファイル直接編集 | ⚠ 技術的には可・**サイレント採用しない** | `plugin_config/obs-websocket/config.json`（mac: `~/Library/Application Support/obs-studio/…`／win: `%APPDATA%\obs-studio\…`／linux: `~/.config/obs-studio/…`）に `server_enabled`/`server_port`/`auth_required`/`server_password` がある。書けば有効化できるが **§5「登録された外部アプリの設定ファイルを勝手に上書きする」禁止に該当**。かつ **OBS 起動中は終了時に設定が上書き**されるため「OBS を閉じて編集→再起動」が必要で UX 悪・バージョン差で脆い |

**採用方針（§5 準拠・安全）**：
- **(a) 読み取り専用の状態検出**：上記 config.json を **read-only** で読み、`server_enabled`／`server_port`／`auth_required` を検出する（**書かない**＝§5 の上書き禁止に抵触しない）。`server_password` は**読まない・保持しない**（§9）。パスは §7 で検証し、OS 別の既定パスのみ対象（任意パス読取にしない）。検出結果で UI が「WS 無効です／ポートは 4455 です／認証が必要です」と**正確な案内**を出す。※read-only でも外部アプリのファイルを読むため **security-review 対象**（レビュー必須条件「ファイル読み書き処理」）。検出不可（ファイル無/権限無）は graceful に「手動で確認してください」へフォールバック。
- **(b) UI で有効化手順を図解ガイド**：検出が「無効」または接続失敗のとき、設定ビュー（[SettingsView.tsx](../../apps/desktop/src/screens/comment-viewer/SettingsView.tsx) 364-425 行）に **ツール→WebSocket サーバー設定→「WebSocket サーバーを有効にする」→ポート 4455→（任意）認証** の手順を**スクリーンショット付き**で案内する。画像は **CSP 準拠でローカル同梱／data URI**（外部読込しない・`csp: null` 不変・外部 image を増やさない）。**実スクリーンショットは 044a 実装時に用意して同梱**（本タスクでは未添付＝要素材）。
- **(c)（将来・別タスク／任意）consent-gated 自動有効化**：手作業を完全に無くしたい場合のみ、**明示同意画面＋バックアップ＋OBS 終了検知＋security-review** を条件に config.json を編集する案。§5 の限定解禁（限定・同意・レビュー付きで解禁可）に該当するため **044a に含めず独立タスクで切り出す**。

**この追加分の完了条件**：WS 未有効/未接続時に、状態を（可能なら read-only 検出で）判定し、UI が有効化手順を図解で案内する。config.json への**書き込みは行わない**（(c) は別タスク）。read-only 検出を入れる場合は security-review で「書かない・任意パス読取でない・パスワードを読まない/ログらない」を確認。

### (追加2) Windows のウィンドウキャプチャは「キャプチャ方法＝Windows 10 (1903以降)＝WGC」を自動設定

**背景（本人 Windows 実機所見）**：Windows で `window_capture` の「キャプチャ方法」が既定の**「自動」だとオーバーレイのコメントが表示されない**。**「Windows 10 (1903以降)」（＝Windows Graphics Capture / WGC）** に変更すると表示される（透過・レイヤード窓は従来の BitBlt では抜けず、WGC でないとクライアント領域を取得できないため）。

**仕様**：方式 A の **Windows 経路**で、`CreateInput`／`SetInputSettings` 時に `window_capture` の **キャプチャ方法を WGC（Windows 10 1903以降）に自動設定**する。あわせて透過・カーソル等の妥当値（`client_area` 等）も設定を検討する。
- **要 098 VM 実機検証**：キャプチャ方法の**正確なフィールド名と WGC の enum 整数**は、Windows OBS で `GetInputPropertiesListPropertyItems("method")`（想定フィールド名 `method`・WGC は一般に整数 `2`）を実測して確定する。macOS には `method` プロパティが存在しない（044s 実測）ため mac では設定不要。透過合成（WGC の client-area／force SDR 等）も 098 で目視確認。
- **OS 分岐**：mac＝044s で確認した `{owner_name, window_name, window}` のみ（`method` 不要）。win＝上記 `window`（`title:class:exe` 文字列）＋ `method=WGC`。

**この追加分の完了条件**：Windows でオーバーレイ ON→自動追加したソースが、**追加の手作業なしでコメントを表示**する（WGC が自動設定されている）。Windows 実機（098 VM）で `method` の実値を確認し設定していること。
