# 032c 内蔵コメントビューア × VOICEVOX 直接読み上げ（方針転換設計）

> 状態: **設計確定**。本ファイルは方針転換の設計判断・アーキテクチャ・改訂計画の記録であり、
> 実装は **032c-a / 032c-b / 032c-c / 032c-d** に分割して行う（本タスク＝設計そのものは
> コード・依存・capability・`docs/security.md` / `docs/product.md` 本文を変更しない）。
>
> **必読前提**: [032（親設計）](032-rakuraku-auto-setup-design.md) と `docs/security.md` を読むこと。
> **本ファイルは 032b（棒読みちゃん×VOICEVOX 連携）を目的について全面 supersede し、棒読みちゃん /
> SAPI For VOICEVOX 経路を撤去する**（032c-a で実施）。CLAUDE.md どおり「実装して」と言われるまで
> コードは変更せず、まず変更計画と対象ファイルを提示すること。

## 目的

らくらくツール設定の中核目的（＝**配信者が簡単にずんだもんの声でコメントを読ませる**）を、
**手段を全面的に変えて**達成する。

032b は「棒読みちゃん×VOICEVOX」でこれを実現しようとしたが、ユーザーに以下の複雑な OS 操作を強いており、
「らくらく」を全く達成できていない:

1. VOICEVOX 導入 → 2. **SAPI For VOICEVOX 導入（レジストリ書込＝管理者昇格・不可逆）** →
3. 棒読みちゃん導入 → 4. VOICEVOX / 棒読みちゃんをツール管理へ手動登録。

そこで手段を次のように置き換える:

- 別リポジトリ osareview（内部名 comment-dock。`/Users/tetsuya/PersonalWork/osareview`）から
  **最低限のコメントビューア機能を移植**し、StreamDock に**簡易コメントビューアを内蔵**する。
- 取得したコメントを **VOICEVOX ENGINE の HTTP 合成 API（`/audio_query` + `/synthesis`）に直接投げ、
  返る WAV をローカル再生**してずんだもんの声で読み上げる。これにより **棒読みちゃんと
  SAPI For VOICEVOX が完全に不要**になり、4 段連鎖（VOICEVOX ← SAPI ← 棒読み ← Socket）が
  **2 段（コメント取得 → VOICEVOX 合成・再生）**に単純化する。残る前提は「VOICEVOX ENGINE が起動
  していること」と「ずんだもんクレジット表記義務」のみ。
- コメビュは**選択すると別ウィンドウで開く**。ツール管理に**デフォルト登録された正規ツール**として扱う。
- ミニマムは **YouTube と Twitch** のコメント取得＋ずんだもん読み上げに絞る（今後機能追加していく前提）。
- 現行セキュリティ方針の **§1「外部通信をしない」を、StreamDock 初の能動的インターネット通信として
  限定解禁**する（YouTube / Twitch のみ）。実装（032c-b/-d）で `docs/security.md` /
  `docs/product.md` を改訂する（security-review 必須）。

> **方針転換の重要な副次効果（検証容易性）**: 本方針は 032b と違い **mac 開発機で E2E 検証できる**。
> 棒読み / SAPI / レジストリ / Windows 専用依存が消え、VOICEVOX ENGINE・Web Audio・Twitch WebSocket・
> Node sidecar はいずれも mac で動く。032b の「Windows 専用・098 まで未検証で main 投入」という
> 重い前提を解消できる。

## 現在の前提（調査結果・確定事項）

### VOICEVOX 直接合成で棒読み / SAPI が不要になる整理

- 従来（032b）: **VOICEVOX ENGINE ← SAPI For VOICEVOX（SAPI5 音声登録・要昇格・不可逆）← 棒読みちゃん
  （声質選択）← Socket 送信（TCP 50001）** の 4 段連鎖。stream-dock の VOICEVOX 呼び出しは
  `127.0.0.1:50021/version` のヘルスチェックのみで、合成 API は未使用だった。
- 新方式（032c）: コメント本文 → `POST http://127.0.0.1:50021/audio_query`（text, speaker）→ 返る
  query JSON → `POST /synthesis`（speaker）→ **WAV bytes をローカル再生**。棒読みちゃん・SAPI
  For VOICEVOX を一切介さない。**ずんだもんのクレジット義務（「VOICEVOX:ずんだもん」表記）は継続**。

### 移植元 osareview の技術的実体（調査結果）

- osareview は **Tauri 2 + React（`apps/desktop`）** と **Node.js バックエンド（`backend/*`）** の
  pnpm モノレポ。**コメント取得は Rust ではなく Node バックエンド**にあり、desktop とは localhost
  **WebSocket(17331) / HTTP(17332)** で通信する。
- **YouTube**: Data API v3 `liveChatMessages.streamList` を **gRPC ストリーミング**で利用。
  **OAuth 認可コード + PKCE 必須**（Client ID + **Secret**）。Google Cloud の consent screen を
  **本番公開（審査）**しないと refresh_token が 7 日で失効。
- **Twitch**: **EventSub over WebSocket**（`wss://eventsub.wss.twitch.tv/ws`）+ Helix REST。
  **OAuth 必須だが Device Code Flow（Client ID のみ・Secret 不要）**、スコープ `user:read:chat`。
- 取得コメントは `CommentViewDto`（`{id, source, author{id,name}, text, publishedAt, eventType,
  monetaryAmount?}`）に正規化され、YouTube / Twitch の差異は mapper で吸収済み。**VOICEVOX / TTS は
  osareview に存在しない**（新規実装）。
- desktop 表示側の最小構成は「`CommentViewDto[]` を append ＋ id 重複排除 ＋ 上限クランプして map 表示」。

### stream-dock 現状（再利用・変更点）

- Rust は **完全同期・async runtime 無し**（全 Tauri command が同期。既存依存は `rusqlite` / `sysinfo` /
  `windows`（feature 限定）/ `ureq`（windows 依存・ループバック用）/ `tauri-plugin-opener` /
  `tauri-plugin-autostart`）。**tokio を要求する tonic / tokio-tungstenite の持ち込みは避ける**（→ 決定 2）。
- **別ウィンドウ機構は未実装**（`tauri.conf.json` は `main` 1 枚・`WebviewWindow` 未使用・capabilities も
  `main` のみ・ウィンドウ生成権限なし）。
- **デフォルトツールの seed 処理は無い**。`tools/service.rs::create()` は**パス実在検証**あり
  （internal ツールはこの検証を通せないため対処が必要＝決定 5）。
- `rakuraku` vertical slice・`process::service::spawn`＋PID registry・`open_url` は再利用する
  （VOICEVOX 起動誘導・らくらく一覧・内蔵コメビュ露出）。撤去は棒読み / SAPI 依存部分に限定する（→ 032b 撤去範囲）。

## 決定事項（論点 1〜7 の確定）

### 1. コメント取得対象

**YouTube と Twitch の両方**をミニマムに含める。

### 2. コメント取得アーキテクチャ（Node sidecar 同梱）

osareview の `backend/comment-fetcher` + `api-gateway` + `auth` を**単一実行ファイル化**（Node SEA / pkg 等）
して **Tauri sidecar（externalBin）として同梱・起動**し、コメビュ別ウィンドウは localhost **WebSocket(17331)**
で受ける。

- **理由**: 両プラットフォームを**実績コードで再利用**でき、YouTube の gRPC / OAuth PKCE と Twitch の
  EventSub / Device Code を作り直さずに済む。stream-dock の Rust が**完全同期（tokio 無し）**である制約を
  回避できる（tonic / tokio-tungstenite / oauth2 crate 群の巨大な async サブシステム持ち込み＝
  「最小依存」「大規模リファクタしない」への抵触を避ける）。
- **代償（security-review 必須）**: Node ランタイム同梱で配布サイズ増＋OS 別ビルド、sidecar/externalBin
  capability が **§4（shell 原則不使用）のエスカレーション**、sidecar のライフサイクル / ポート管理。

### 3. VOICEVOX 直接合成の実行レイヤ（viewer webview + Web Audio）

VOICEVOX 合成 HTTP と再生を **viewer webview で行う**。`fetch` で `http://127.0.0.1:50021`（ループバック）を
叩き、返る WAV ArrayBuffer を **Web Audio API（`AudioContext.decodeAudioData` + `onended` 直列再生）**で鳴らす。

- **理由**: 新依存ゼロ（Rust の `rodio`＝cpal/coreaudio/alsa 等の重い音声バックエンド追加を避ける）。
  コメントストリームと TTS キューを同じ場所（viewer frontend）に置け、`onended` で厳密に直列化できる。
  ユーザーが外部通信制約の例外を明言しているため webview 直叩きを採る。→ **Rust のネットワーク面はほぼ
  増えず、内部/外部通信は Node sidecar と viewer webview に封じ込まる**（main ウィンドウは従来の no-internet 維持）。
- **TTS キュー（ミニマムでも必須）**: バースト対策に **FIFO 直列キュー ＋ 再生中フラグ ＋ バックログ上限**
  （溢れたら古い未読を破棄）＋ **最小テキスト整形**（URL / 絵文字の除去）。話者は **ずんだもん（ノーマル）=
  VOICEVOX speaker 3 を既定**（実値は VOICEVOX 実機でスパイク確定・定数化）。著者名読み上げはミニマム対象外。

### 4. 別ウィンドウ実装方式（Rust WebviewWindowBuilder）

Rust `WebviewWindowBuilder` による**オンデマンド生成**。新コマンド `open_comment_viewer_window`、ラベル
`comment-viewer`、**単一インスタンスガード**（既存なら focus）。frontend にウィンドウ生成権限を露出しない
（CLAUDE.md「OS 操作 / ウィンドウは Rust に寄せる」に整合）。

- 描画は**同一 Vite バンドルをウィンドウラベルで分岐**（`App.tsx` → MainWindowApp / CommentViewerApp）。
  osareview の `apps/desktop/src/app/window/use-window-label.ts` が先例。マルチ HTML エントリ不要。
- **新規 capability** `capabilities/comment-viewer.json`（`windows:["comment-viewer"]` ＋最小権限）を追加。
  **main の capability は不変**。webview の fetch / WebSocket / Web Audio は Tauri IPC 権限ではなく webview
  ネイティブ機能のため capability 不要（CSP 管理下。現 `csp: null`）。

### 5. 内蔵コメビュ＝プリセット組込可能な正規ツール

内蔵コメビュを**プリセット組込・一括起動も可能な正規ツール**として扱う。

- `ToolKind::Internal` を新設し、固定 id（例 `builtin-comment-viewer`）で **SQLite へ冪等 seed**。
- launch dispatch を分岐（`launch_tool` → internal → `open_comment_viewer_window`）。**internal は
  パス実在検証を skip**（実行ファイルでも URL でもないため）。preset_items からも参照できるようにする。
- builtin ツールの編集 / 削除 semantics（削除不可 or 再 seed）を定義する。

### 6. セキュリティ方針の扱い（§1 の初解禁 ほか）

`docs/security.md` に**新章「コメントビューア（配信サービス連携）方針」**を追加し、以下に**限って**解禁する
（一般原則の禁止は維持）。詳細な改訂計画は後述「セキュリティ方針の改訂方針」に記す。

- **§1（外部通信）を StreamDock 初の能動的インターネット通信として限定解禁**。宛先を **allow-list 限定**
  （Twitch = `api.twitch.tv` / `eventsub.wss.twitch.tv` / `id.twitch.tv`、YouTube = `accounts.google.com` /
  `oauth2.googleapis.com` / YouTube API）。**telemetry / analytics / crash-report は引き続き全面禁止**。
  ユーザーが自チャンネルを明示接続した時のみ発火。
- **窓単位の封じ込め**: main ウィンドウとその Rust コマンドは従来の no-internet を維持。新通信面は
  **Node sidecar と viewer webview** に封じ込める（主要な安全論拠）。
- **§4（shell 原則不使用）のエスカレーション**: sidecar（externalBin）同梱を例外化し、理由 / ライフサイクル /
  ポート固定を明記して security-review 対象に追加する。
- **§9（資格情報）**: OAuth トークンはログに出さない・外部送信しない・保存場所を明記。Twitch は Device Code
  （Secret 不要）で YouTube より安全である旨を記録。
- **loopback 50021 拡張**: 既存の「/version ヘルスチェックのみ」を「/audio_query・/synthesis 合成 ＋
  WAV ローカル再生」へ拡張。
- **取得コメントの扱い**: 画面表示とローカル VOICEVOX（ループバック）TTS のみに使用し、端末外へ出さない。
- **明示同意（接続操作）＋ security-review 必須**。

### 7. コスト / クォータ（金銭コストは両サービスとも $0）

- **Twitch**: API は完全無料（レート制限のみ・金銭課金なし）。1 万コメントでも $0。
- **YouTube**: Data API v3 も金銭課金なし・従量課金なし・クレカ不要。ただし **無料クォータ 10,000 units/日**
  （全エンドポイント合算・PT 深夜リセット・**セルフ課金購入不可**）の制限あり。コストは**コメント件数ではなく
  API 呼び出し（ポーリング）回数**で決まり、1 万コメント収集自体は数十〜数百 units 程度。効くのは
  **長時間モニタリング**で、無料枠は 5 秒間隔ポーリングで約 3〜14 時間/日相当（`liveChatMessages.list` /
  `streamList` の正確な unit 会計は 032c-d のスパイクで確定）。超過時は取得停止＝**無料の増枠審査フォーム申請**が必要。
- VOICEVOX 読み上げはローカル無料。文字起こし / LLM 等の従量課金サービスは使わない。

## 実装タスクへの分割（032c-a / -b / -c / -d）

- **032c-a コメビュ別ウィンドウ枠組み ＋ 内蔵デフォルトツール ＋ 032b 撤去**（frontend / Rust・ネットワーク無・
  **mac 検証可**）
  - Rust `open_comment_viewer_window`（`WebviewWindowBuilder`・ラベル `comment-viewer`・単一インスタンス
    ガード）を `lib.rs` に追加。`capabilities/comment-viewer.json` 新設（main は不変）。
  - ウィンドウラベル分岐描画（`App.tsx` → MainWindowApp / CommentViewerApp）。
  - `ToolKind::Internal` 新設・固定 id で冪等 seed・launch dispatch 分岐・internal はパス検証 skip・
    プリセット組込対象化。
  - **032b 撤去**（下記「032b の撤去範囲」を実施）。
  - モック `CommentViewDto` で最小コメント描画（append ＋ id 重複排除 ＋ 上限クランプ）。
- **032c-b Node sidecar 基盤 ＋ Twitch コメント取得 ＋ viewer WS 接続 ＋ インターネット通信 初解禁**
  （**mac 検証可**・**security-review 必須**）
  - osareview の `backend/{comment-fetcher,api-gateway,auth}` を単一実行ファイル化して Tauri sidecar
    （externalBin）として同梱・起動・ライフサイクル / ポート管理。
  - Twitch Device Code ログイン UI を viewer ウィンドウ内に表示、EventSub WS ＋ Helix、`CommentViewDto`
    マッピング、viewer が WS(17331) 受信・描画。
  - **`docs/security.md` / `docs/product.md` へインターネット通信例外を追記（§1 / §4 / §9 / §10）＋ security-review**。
- **032c-c VOICEVOX 直接合成 ＋ TTS キュー**（loopback 例外拡張・**mac 検証可**。モックコメントで 032c-b と
  独立検証可）
  - viewer で `/audio_query` + `/synthesis`（ずんだもん speaker）→ Web Audio 再生、直列 FIFO キュー、
    バックログ上限、最小テキスト整形。
  - ENGINE 稼働検出（ループバック）＋起動誘導（VOICEVOX は「登録済みツールを管理付き `spawn`」経路を再利用）。
  - **`docs/security.md` の loopback 50021 例外を `/audio_query`・`/synthesis` ＋ WAV ローカル再生へ拡張**。
    ずんだもんクレジット表記の提示（032a の同意文を再利用）。
- **032c-d YouTube コメント取得有効化**（**mac 検証可**・security 追記）
  - sidecar の YouTube 経路（OAuth PKCE・Client Secret 同梱・Google Cloud consent screen 本番公開運用）を
    有効化、YouTube ログイン UI、`CommentViewDto` 統合。
  - **`docs/security.md` に YouTube 宛先と開発者 OAuth 運用前提を追記**。**product.md にクォータ制限
    （長時間運用で増枠申請が要り得る）を記録**。
- **順序**: **032c-a → 032c-c（モックで先行可）→ 032c-b → 032c-d → E2E 統合**。

### 032b の撤去範囲（032c-a で実施）

- **削除**: `apps/desktop/src-tauri/src/rakuraku/integrations/bouyomi_voicevox.rs`、
  `rakuraku_configure_integration` / `rakuraku_verify_integration` など棒読み専用コマンド、
  `integrationRegistry.ts` の `bouyomi-voicevox` エントリ、`RakurakuToolsScreen` の棒読み実行経路。
  `Cargo.toml` の `ureq`（VOICEVOX を webview 直叩きにするため Rust の HTTP クライアントが不要になる場合。
  他に用途が残らないか要確認）。
- **`docs/security.md` / `docs/product.md`**: 032b 用の記述（§1・§5 例外注記、`らくらくツール設定
  （外部アプリ連携）方針`、`レビュー必須条件` の該当行、`### 032b …` 実施記録群）を、撤去に合わせて整理
  （削除 or「032c で supersede」注記）。
- **残す（撤去対象外）**: `rakuraku` vertical slice、`process::service::spawn` ＋ PID registry、`open_url` /
  `open_official_page`、らくらくツール設定**画面枠組み（032a）**。VOICEVOX 起動誘導・らくらく一覧・内蔵
  コメビュ露出に再利用する。撤去は棒読み / SAPI 依存部分に限定する。

## セキュリティ方針の改訂方針（実装 032c-b/-c/-d で反映・security-review 必須）

### `docs/security.md`

- 新章「### コメントビューア（配信サービス連携）方針」を追加し、決定 6 の各点（§1 初解禁・宛先 allow-list・
  窓単位封じ込め・§4 sidecar エスカレーション・§9 トークン取扱・loopback 50021 拡張・取得コメントの扱い・
  明示同意 ＋ security-review 必須）を明文化する。
- §1（外部通信）に「ただしコメントビューアの配信サービス連携に限り、allow-list の宛先への通信を上記新章の
  条件下で許可する」旨の例外注記を加える。
- §4（shell 原則不使用）に「Node sidecar（externalBin）同梱を上記新章の条件下で例外的に許可する」旨を加える。
- 「レビュー必須条件」に「内蔵コメントビューアの配信サービス連携（インターネット通信・Node sidecar 同梱・
  OAuth トークン取扱）」を追加する。
- `csp: null` は当面維持。将来 viewer に CSP を効かせる際は connect-src に Twitch / Google / localhost を並べる
  （032 追加対応の YouTube iframe 例外と同じ TODO 扱い）。

### `docs/product.md`

- 「MVP でやらないこと」の「外部通信をしない」系記述に、**コメントビューアの配信サービス連携に限り
  （明示同意 ＋ allow-list 宛先 ＋ security-review を条件に）例外的に許可する**旨を追記する。
- YouTube のクォータ制限（金銭 $0 だが無料枠 10,000 units/日・長時間運用で増枠申請が要り得る）を記録する。

## このタスク（設計）でやること

- 論点 1〜7 の決定事項を本ファイルに確定記録する（済）。
- 実装タスク 032c-a / -b / -c / -d の分割と順序を定義し、`docs/task-board.md` に反映する。
- 032b の撤去範囲を確定し、task-board 上で 032b を supersede / 撤去予定として整理する。
- `docs/security.md` / `docs/product.md` の**改訂方針**を固める（実際の改訂は 032c-b/-c/-d で実施）。

## このタスク（設計）でやらないこと

- コード・依存（Node sidecar / capability 等）・Tauri capability・`docs/security.md` / `docs/product.md`
  本文の変更（これらは 032c-a〜d で行う）。
- osareview のリッチ機能（ピン留め・タグ・視聴者メモ・スパチャ装飾・統計・コメント SQLite 永続化・
  viewer-card 複数窓）の移植設計（ミニマム対象外・今後）。
- TTS 高度化（話者 / スタイル選択 UI・速度 / 音程設定・著者名読み上げ・スキップ / モデレーション）の設計
  （ミニマムは固定ずんだもん ＋ 基本整形 ＋ バックログ破棄のみ）。
- YouTube + Twitch の同時 / マージ表示、OAuth トークンの keyring 永続化、CSP 硬化（別途）。

## セキュリティ制約（docs/security.md 準拠・抵触点と解禁範囲）

- **抵触点:** §1（外部通信＝**初の能動的インターネット通信**）／§4（shell 原則不使用＝Node sidecar／
  externalBin）／§5 の延長（loopback 50021 を合成 API へ拡張）／§9（OAuth トークン）／§10（依存・capabilities）／
  CSP 方針。
- **解禁範囲（本設計で確定・実装 032c-b/-c/-d で明文化）:** インターネット通信は **allow-list 宛先
  （Twitch / YouTube）限定・ユーザー明示接続時のみ**／通信面は **Node sidecar と viewer webview に封じ込め**
  （main は no-internet 維持）／VOICEVOX はループバック 50021 の合成 ＋ ローカル再生のみ／OAuth トークンは
  §9 準拠／明示同意 ＋ **security-review 必須**。
- **本タスク（設計）自体:** docs 追記のみ。コード・依存・capability・`docs/security.md` / `docs/product.md`
  本文は一切変更しない。

## 完了条件

- 論点 1〜7 の決定事項が本ファイルに確定記録されている。
- 032c-a / -b / -c / -d の分割・順序が定義され、`docs/task-board.md` に反映されている。
- 032b が **supersede / 撤去予定**として整理されている（撤去範囲が本ファイルに明記され、task-board から
  032b の Todo 行が外れている）。
- `docs/security.md` / `docs/product.md` の改訂方針が本ファイルに明記されている。
- docs/progress.md が更新されている。

## 確認コマンド

```bash
# 設計タスクのためコード変更なし。docs 差分のみ確認する（typecheck / cargo check は各サブタスクで実施）。
git status
git diff --stat docs/
```
