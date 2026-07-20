# 032c-b Node sidecar 基盤 ＋ Twitch コメント取得 ＋ viewer WS 接続 ＋ インターネット通信 初解禁

> 状態: **未着手（実装サブタスク）**。本ファイルは [032c（親設計・方針転換の正）](032c-comment-viewer-voicevox-design.md)
> の「## 実装タスクへの分割」032c-b 節・「## 決定事項」論点 2 / 6 / 7・「## セキュリティ方針の改訂方針」を
> distill したもの。**スコープ・決定の線引きは 032c を正とする**。
>
> **必読前提**: [032c（親設計）](032c-comment-viewer-voicevox-design.md) と `docs/security.md`（特に §1 外部通信 /
> §4 shell / §9 ログ・資格情報 / §10 依存 / Capabilities 方針 / CSP 方針 / レビュー必須条件）を読むこと。
> あわせて [032c-a（前提サブタスク）](032c-a-comment-viewer-window-internal-tool.md) の viewer 別ウィンドウ枠組み・
> `mergeComments`（append ＋ id 重複排除 ＋ 上限クランプ）・内蔵ツール（`ToolKind::Internal`）を把握すること。
> 再利用元の実績コードは別リポジトリ **osareview**（内部名 comment-dock・`/Users/tetsuya/PersonalWork/osareview`）の
> `backend/{comment-fetcher, api-gateway, auth}`（Twitch 経路）。
>
> **本タスクは StreamDock で初めて能動的なインターネット通信を導入する最高リスクのタスク**であり、§1「外部通信を
> しない」を **Twitch 宛先の allow-list 限定・ユーザー明示接続時のみ**で初解禁する。**security-review 必須**。
> **依存前提は 032c-a のみ**（032c-c の完了は前提ではない。032c-b は TTS 無し＝コメント表示のみで mac 開発機で
> E2E 検証できる）。CLAUDE.md どおり「実装して」と言われるまでコード・docs 本文は変更せず、まず変更計画と対象
> ファイルを提示すること。

## 目的

内蔵コメントビューアに **Twitch の実コメントを流し込む配管**を用意する。取得は **Node sidecar（externalBin）に
閉じ込め**、viewer 別ウィンドウは **localhost WebSocket** で `CommentViewDto` を受けて描画する（032c-a の
`mergeComments` に流す）。これにより **StreamDock の Rust は完全同期のまま**（tokio / WS / OAuth の async
サブシステムを Rust に持ち込まない）、**インターネット通信面を Node sidecar と viewer webview に封じ込め**、
**main ウィンドウは従来の no-internet を維持**する。

本タスクは **Node sidecar 基盤（単一実行ファイル化・externalBin 同梱・Rust によるライフサイクル/ポート管理）＋
Twitch Device Code ログイン＋EventSub/Helix 取得＋viewer WS 受信描画＋`docs/security.md`/`docs/product.md` の
インターネット通信例外の初解禁**に限定する。**TTS（VOICEVOX 合成・読み上げ）は繋がない**（032c-c・実装済み）。
YouTube は含めない（032c-d）。実装全体像は [032c](032c-comment-viewer-voicevox-design.md) を正とする。

## 現在の前提（調査結果）

### 032c-a が用意済み（本タスクの接続先）

- **viewer 別ウィンドウ**: Rust `open_comment_viewer_window`（`apps/desktop/src-tauri/src/lib.rs`・ラベル
  `comment-viewer`・`WebviewWindowBuilder`・単一インスタンスガード＝既存なら `show()`+`set_focus()`）。frontend に
  ウィンドウ生成権限は露出しない。同一 Vite バンドルを `App.tsx` が `getCurrentWindow().label` で分岐描画。
- **描画（本タスクの単一注入点）**: `apps/desktop/src/screens/comment-viewer/CommentViewerApp.tsx` の純関数
  `mergeComments(prev, incoming)` が append ＋ **id 重複排除** ＋ **上限クランプ（`MAX_COMMENTS = 200`）**を行い、
  「実際に append された新規分」を戻り値で返す。現状のデータ源は**モックのみ**（`makeMock` / `SEED_COMMENTS` /
  「モックを追加」ボタン）。本タスクは実データ（Twitch）をこの `mergeComments` に流す。
- **DTO 型（現状 frontend 専用モック）**: `apps/desktop/src/features/comment-viewer/types.ts` の
  `CommentViewDto = { id, source:'twitch'|'youtube', author:{id,name}, text, publishedAt(ISO), eventType, monetaryAmount? }`。
  型ヘッダに「Rust 正規化 `CommentViewDto` ＋ ts-rs binding は 032c-b/-d で新設」と明記されている（＝本タスクで新設）。
- **内蔵ツール**: `ToolKind::Internal`（`apps/desktop/src-tauri/src/tools/model.rs`）＋固定 id `builtin-comment-viewer`
  の冪等 seed＋launch dispatch 分岐（削除不可・コア編集不可・プリセット組込可）。
- **capability**: `apps/desktop/src-tauri/capabilities/comment-viewer.json`（`"windows":["comment-viewer"]`・
  `"permissions":["core:default"]` のみ・最小権限）。`capabilities/default.json`（main）に shell 系 permission は無い。

### 再利用元 osareview の技術的実体（Twitch 経路・調査結果）

- **モノレポ**: pnpm workspace、TypeScript **ESM**（Node 22 系）、**tsyringe DI ＋ reflect-metadata**
  （`experimentalDecorators` + `emitDecoratorMetadata` ＝**decorator metadata が load-bearing**）。バンドラ設定は無い
  （各パッケージ `tsc` ビルドのみ）。
- **Twitch Device Code（public client・Secret 不要）**: `POST https://id.twitch.tv/oauth2/device`（`client_id`+scopes）→
  `device_code`/`user_code`/`verification_uri`/`interval` を取得 → `POST https://id.twitch.tv/oauth2/token`
  （`grant_type=…device_code`）を `interval` 間隔でポーリング。スコープ既定 `user:read:chat`。
  実装: `backend/auth/src/adapters/twitch/{client/device-code-oauth.client.ts, login/device-code-login-strategy.ts}`。
- **EventSub WebSocket**: `wss://eventsub.wss.twitch.tv/ws` に接続 → `session_welcome` で `session.id` を取得 → Helix で
  `channel.chat.message` ＋ `channel.chat.notification` を購読（`transport.session_id`）→ `notification` の
  `payload.event` を AsyncIterable で配信。`session_reconnect` は Twitch 提供の **`reconnect_url`**（`*.wss.twitch.tv`
  系）へ張り替え。実装: `backend/comment-fetcher/src/adapters/twitch/client/eventsub-websocket.client.ts`。
- **Helix REST**: base `https://api.twitch.tv/helix`。`GET /users`（broadcaster/self の id 解決）・`GET /streams`
  （配信検出）・`POST /eventsub/subscriptions`（WS transport 購読作成）。全リクエストに `Authorization: Bearer` +
  `Client-Id` を付与。HTTP は **グローバル `fetch`**（`node-fetch`/`undici` 非依存）。
- **正規化コメント**: 内部 `Comment` → `CommentViewDto`（`packages/shared`）は **stream-dock のモック型と同一形状**
  （`{id, source:'twitch', author:{id,name}, text, publishedAt(ISO), eventType, monetaryAmount?}`）。`publishedAt` は
  受信時刻でスタンプ。Twitch は `message_id`→`id`、cheer(bits>0)→`super_chat`＋`monetaryAmount{currency:'BITS',amount}`、
  notice は `sub/resub/sub_gift/community_sub_gift/pay_it_forward` のみ `subscription` として残す。badges/color/emote は
  raw DTO には有るが正規化で落とす（本タスクでも移植しない）。
- **配信トランスポート**: api-gateway が **WS サーバ**を `127.0.0.1:17331` で公開（backend=サーバ・desktop=クライアント）、
  HTTP 制御を `127.0.0.1:17332`（hono+zod）で公開。WS メッセージは `comments.append`/`session.state`/`account.state`。
- **トークン取扱**: 現状は OS keychain（`@napi-rs/keyring`・**native addon**）。`TokenStore` interface で差し替え可能。
  **トークンはどこにもログ出力されず、外部送信も Twitch 宛のみ**。**telemetry/analytics/crash-report は皆無**（grep 済み）。
- **YouTube は完全分離**（`youtube/` 配下・gRPC `@grpc/grpc-js` ＋ **Client Secret**）。ただし
  `registerCommentFetcherDependencies` と api-gateway の `ManageStreamingSessionsUseCase` が **YouTube モジュールを
  top-level import** するため、api-gateway 丸ごと再利用は gRPC/YouTube を bundle に引きずり込む（→ 論点＝トランスポート）。
- **device-code の表出**: `createAuthClient().login()` は `void` を返し、`DeviceCodeLoginStrategy` は `userCode` を
  捕捉するが **`verificationUri` だけを `open`（ブラウザ shell-out）に渡し `userCode` を捨てる**。→ viewer に code/URL を
  テキスト表示するには **login strategy 拡張 or sidecar-local な薄い orchestration**＋`open` 廃止が要る（＝統合作業）。

### stream-dock 現状（sidecar は完全新設＝greenfield）

- **bundle に externalBin/resources/sidecar は無い**（`apps/desktop/src-tauri/tauri.conf.json`）。`app.security.csp` は `null`。
- **`tauri-plugin-shell` は未依存**（Rust・JS とも）。`capabilities/default.json` に shell 系 permission 無し。
- Rust は**完全同期**（全 Tauri command が同期 `fn`・async command 無し・自前の async/WS スタック無し。tokio/hyper/reqwest は
  Tauri 経由の transitive のみ・**websocket crate はゼロ**）。
- プロセスライフサイクルの実績パターン: `apps/desktop/src-tauri/src/process/{service.rs, registry.rs}` の
  **shell 非経由 `std::process::Command` spawn ＋ `Mutex<HashMap<String, ManagedProcess>>`（app state）**、
  `child.kill()+wait()` で停止、`try_wait()` で reap。sidecar のライフサイクルはこのパターンを singleton 化して踏襲する。
- Rust↔TS binding は **ts-rs**（`cargo test export_bindings` → `src/features/*/bindings/`・`check:bindings` で git diff
  検証）。現状 `comment-viewer/bindings` は未カバー（本タスクで DTO binding を追加する際に対象へ含める）。
- frontend は **単一 HTML エントリ**（`index.html` → `main.tsx`）。パッケージマネージャは **pnpm**。

## このタスクでやること

### (1) Node sidecar 基盤（単一実行ファイル化・externalBin 同梱）

- osareview の Twitch 経路（`comment-fetcher` の `runTwitchPipeline` ＋ `auth` の Twitch device-code ＋ `shared` ＋
  `comment-delivery`）だけを import する **Twitch 専用 entry** を新設し、**`tsc`（`emitDecoratorMetadata` 付き）→
  `esbuild`（単一 CJS へバンドル・`ws` の optional native addon を external 化）→ **Node SEA**（`postject` でブロブ注入）**
  で**単一実行ファイル化**する。→ decorator metadata を tsc 段で確定させてから束ねるため tsyringe DI が壊れない。
  keyring（native addon）と `open` を落とすので SEA の native 落とし穴が消える。
- 生成物を `-<target-triple>`（例 `…-aarch64-apple-darwin`）命名で **Tauri `bundle.externalBin` として同梱**する。
  Node ランタイム同梱ゆえ **OS 別ビルド**（mac 先行検証・Windows は 098 と連動）である旨を明記する。

### (2) Rust による sidecar ライフサイクル / ポート管理

- **`tauri-plugin-shell` を追加**（Rust 専用・後述 (追加依存)）。sidecar の spawn/kill は **Rust から
  `app.shell().sidecar()` のみ**で行い、**`shell:*` permission は capability に一切付与しない**（frontend に shell 面を
  出さない・§2 維持）。
- **singleton ライフサイクル**: `Mutex<Option<CommentSidecar>>`（`CommandChild` ＋ 実ポートを保持）を app state に持ち、
  既存の `Mutex<HashMap>` registry と同じ流儀で管理。`open_comment_viewer_window` の中で（未起動なら）spawn。
- **no-orphan の 3 段 kill フック**: ①viewer 窓の `WindowEvent::Destroyed`/`CloseRequested` で kill、②`RunEvent::Exit`
  （アプリ終了）で kill＝**現状 `lib.rs` に無いので追加**、③sidecar 側の自衛（`process.ppid` を監視し親消滅で自 exit・
  macOS は `PDEATHSIG` が無いため）。
- **ポート 17331 衝突＝空きポート自動割当＋Rust へ通知**: sidecar は 17331 を試し `EADDRINUSE` なら OS 割当の空きポートへ
  フォールバックし、**実際に bind したポートを stdout 出力**。Rust は `CommandEvent::Stdout` で受け取り保持し、viewer は
  **読み取り専用の新 command `get_comment_stream_port`** で実ポートを取得してから `ws://127.0.0.1:<実ポート>` へ接続する。

### (3) Twitch Device Code ログイン＋EventSub/Helix 取得＋CommentViewDto

- viewer に **Device Code ログイン UI** を表示：`user_code` と `verification_uri` を**テキストで提示**（`open` による
  ブラウザ shell-out は廃止）。ユーザーが自チャンネルを明示接続した時のみ発火する。
- sidecar 内で **Device Code →（ポーリング）→ token → EventSub WS 購読 ＋ Helix** を実行し、正規化 `CommentViewDto` を
  WS(実ポート) で viewer へ push。viewer は `mergeComments` に流して描画（TTS は繋がない）。
- **Rust 正規化 `CommentViewDto` ＋ ts-rs binding を新設**し、frontend 専用モック型を置き換える（`check:bindings` の
  対象に `comment-viewer/bindings` を含める）。実データ形状は osareview の正規化 DTO と同一のため mapper は薄い。

### (4) 制御/配信トランスポート（単一双方向 WS(17331)）

- **単一の双方向 WebSocket(17331)** に集約：viewer→sidecar の制御フレーム（`start-login`/`start-session`/`stop-session`）と、
  sidecar→viewer の `device_code{user_code, verification_uri}`/`session_state`/`comments_append` を同一ソケットで扱う。
  osareview の `WebSocketCommentOutputPort`（送出）を再利用し、同じ `ws` サーバに inbound 制御ハンドラを足す。
- **api-gateway の hono/zod 制御サーバ（17332）は使わない**（丸ごと再利用は YouTube/gRPC を top-level import で引きずり込む
  ため）。EventSub/Helix/Device Code/mapper/message framing の**実績コアは再利用継続**。

### (5) allow-list 強制（宛先限定・fail-closed）

- **二層で強制**する：①**env ピン留め**＝全 base URL の env override（`TWITCH_*_URL`/`*_ENDPOINT`）を Rust から渡さず、
  sidecar ビルドで override 分岐を削除（＝親 env が汚染されても宛先を差し替えられない）、②**fail-closed ホストガード**＝
  `fetch` と `ws` クライアント生成を包み、`{id.twitch.tv, api.twitch.tv, eventsub.wss.twitch.tv, *.wss.twitch.tv}` 以外の
  ホストを throw（EventSub の `reconnect_url` は Twitch レスポンス由来なので `*.wss.twitch.tv` を許可）。
- **telemetry/analytics/crash-report は全面禁止**を維持（依存にも入れない）。取得コメントは**画面表示のみ**に使い端末外へ
  出さない。**allow-list 強制はコード**なので段階②（インターネット解禁コミット）に載せる（docs コミットではない）。

### (6) `docs/security.md` / `docs/product.md` 本文改訂（§1 初解禁ほか）＋ security-review

- `docs/security.md` に**新章「### コメントビューア（配信サービス連携）方針」**を追加し、§1 初解禁（allow-list 宛先）・
  窓単位封じ込め（main は no-internet）・§4 sidecar（externalBin）例外・§9 OAuth トークン取扱・取得コメントの扱い・
  明示同意＋security-review 必須を明文化する。既存の例外注記の書式（太字ラベル＋条件＋設計ファイルを「正」に参照）を踏襲し、
  章頭で本 spec と 032c 親設計を「正」に参照する。
- §1（外部通信）に allow-list 宛先への通信を新章条件下で許可する例外注記を追加し、**032c-c の loopback 例外の
  forward-ref（「Twitch/YouTube 取得は 032c-b/-d」）を更新**する。§4（shell 原則不使用）に Node sidecar（externalBin）例外を
  追加。§9 に OAuth トークンの非ログ・非外部送信・保存場所（in-memory のみ）を明記。§10 / Capabilities 方針に
  `tauri-plugin-shell` 追加（shell 権限ゼロ付与）と externalBin を記す。「レビュー必須条件」に
  「内蔵コメントビューアの配信サービス連携（インターネット通信・Node sidecar 同梱・OAuth トークン取扱）」を追加。
  `csp: null` は当面維持（TODO 扱い）。
- `docs/product.md` の「MVP でやらないこと」に、コメントビューアの配信サービス連携に限り（明示同意＋allow-list 宛先＋
  security-review を条件に）例外的に許可する旨を、既存の外部アプリ自動起動例外と同じ体裁で追記する。
- **docs 差分（＋capabilities/externalBin/依存追加を含む一連）に security-review スキルを適用し判定を得る**。重点は
  封じ込め（main no-internet）・allow-list 限定・トークン非ログ/非外部送信・sidecar 権限最小化。

## sidecar 実行方式・トランスポート・ライフサイクル（設計まとめ）

| 論点 | 決定 |
|---|---|
| 単一実行ファイル化 | `tsc`（metadata）→ `esbuild`（単一 CJS・`ws` native addon を external）→ **Node SEA**（`postject`）。externalBin `-<triple>` 命名。 |
| sidecar 起動/停止 | **`tauri-plugin-shell`（Rust 専用・`shell:*` 権限ゼロ付与）**。Rust から `app.shell().sidecar()` のみ。frontend に shell 面を出さない。 |
| ライフサイクル | `Mutex<Option<CommentSidecar>>`（`CommandChild`＋実ポート）。窓 open で spawn／**3 段 kill フック**で no-orphan。 |
| ポート | 17331 を試し EADDRINUSE で空きポート自動割当 → stdout 出力 → Rust が受領 → viewer は `get_comment_stream_port` 経由接続。 |
| トランスポート | **単一双方向 WS(実ポート)**。hono/zod/17332 は不使用。`WebSocketCommentOutputPort` 再利用＋inbound 制御追加。 |
| トークン | **in-memory `TokenStore`**（keyring 永続化しない）。非ログ・非外部送信・Twitch 宛のみ。 |
| Device Code | viewer に `user_code`+`verification_uri` を**テキスト提示**（`open` 廃止）。 |
| allow-list | env ピン留め＋fail-closed ホストガード（`*.wss.twitch.tv` 含む）。 |
| 封じ込め | インターネットは **Node sidecar のみ**／main は no-internet／viewer は localhost WS のみ。 |
| Rust の同期性 | Rust は child ハンドル管理のみ（async は Node 内）。**Rust に async/WS/HTTP crate を足さない**。 |

## 追加依存（CLAUDE.md「新しいライブラリは理由を説明」準拠）

- **Rust/Tauri**: `tauri-plugin-shell` — externalBin sidecar を Rust から起動/停止（`-<triple>` ＋ dev/バンドルの
  パス解決、停止用 `CommandChild::kill()`、ポート受け渡しの stdout チャネル）。**capability にはゼロ付与**で frontend
  shell 面を作らない。汎用 Rust crate の新規追加は無し（singleton は `std::sync::Mutex`+`app.manage`）。
- **Node ビルド時のみ（同梱しない）**: `esbuild`（tsc 出力を SEA 用の単一 CJS へ束ね、`ws` optional native addon を
  external 化）、`postject`（Node SEA 公式のブロブ注入）。`typescript`/`tsc` は osareview 既存 devDep（**esbuild の前に
  必須**・新規ではない）。
- **Node ランタイム（SEA に埋め込む）**: `ws`（EventSub クライアント＋ローカル WS サーバ・pure JS）、`tsyringe`
  （再利用コアの DI）、`reflect-metadata`（entry 先頭 import）、workspace ソース（`shared` / `comment-fetcher` の
  Twitch 経路 / `auth` の Twitch device-code / `comment-delivery`）。
- **明示的に落とす（同梱しない・理由）**: `hono`+`@hono/node-server`+`zod`（HTTP 制御 listener を廃止）、
  `@napi-rs/keyring`（in-memory 化で native addon 排除）、`open`（code をテキスト提示・ブラウザ shell-out しない）、
  `@grpc/grpc-js`+`@grpc/proto-loader`（YouTube 除外＝Twitch 専用 entry で import グラフから外す）、`dotenv`（env は
  Rust が注入）。

## 実機スパイクで確定する点（着手前提の技術リスク・段階①で先に潰す）

1. **decorator metadata が tsc→esbuild→SEA を生存する**（最重要。SEA バイナリ内で tsyringe `container.resolve` が動くか）。
2. **YouTube/gRPC の transitive 混入排除**（Twitch 専用 entry のバンドルに grpc が含まれないこと）。
3. **device-code `user_code` 表出ギャップ**（login strategy 拡張 or sidecar-local orchestration＋`open` 廃止）。
4. **externalBin パス解決＋target-triple**（`tauri dev` とバンドル `.app`/`Contents/MacOS/` の両方で解決）。
5. **macOS 孤児化**（`PDEATHSIG` 無し）→ 3 段 kill フックを `kill -9` で検証。
6. **ポート受け渡しのタイミング**（viewer が実ポートを待ってから接続）。
7. **SEA sidecar の macOS 署名**（`postject` が node 署名を無効化 → 署名済み `.app`（hardened runtime）内で Gatekeeper に
   殺され得る → 再署名）。
8. **`ws` optional native addon**（`bufferutil`/`utf-8-validate` を esbuild で external 化しビルドを通す）。

## このタスクでやらないこと

- **YouTube コメント取得・OAuth PKCE・Client Secret 同梱・Google Cloud 運用**（すべて 032c-d）。
- **VOICEVOX 合成 API・TTS キュー・Web Audio 再生**（032c-c・実装済み）。本タスクはコメント**表示**まで。
- **OAuth トークンの keyring 永続化**（§9 準拠で in-memory で扱うが、恒久保管方式は本タスク対象外）。
- **CSP 硬化**（`csp: null` は当面維持・別途）。
- **main ウィンドウをインターネット可能にすること**（封じ込めを崩さない）。
- osareview のリッチ機能（ピン留め・タグ・スパチャ装飾・統計・SQLite 永続化・複数窓・リッチ整形）の移植。
- YouTube + Twitch の同時 / マージ表示。（**当時。035a で同時取得・マージ表示を解禁**＝`docs/tasks/035-simultaneous-youtube-twitch-comments.md`。本タスク時点のスコープとしては対象外だった記録として残す）

## セキュリティ制約（docs/security.md 準拠・抵触点と解禁範囲）

- **抵触点**: §1（**初の能動的インターネット通信**）／§4（shell 原則不使用＝Node sidecar/externalBin＋`tauri-plugin-shell`）／
  §9（OAuth トークン）／§10（依存・capabilities）／CSP 方針。
- **解禁範囲**: インターネット通信は **allow-list 宛先（Twitch = `api.twitch.tv` / `eventsub.wss.twitch.tv` /
  `id.twitch.tv`＋reconnect の `*.wss.twitch.tv`）限定・ユーザー明示接続時のみ**。通信面は **Node sidecar と viewer
  webview に封じ込め**（main は no-internet 維持）。telemetry/analytics/crash-report は全面禁止。取得コメントは端末外へ
  出さない。OAuth トークンは§9 準拠（非ログ・非外部送信・in-memory 保存）。**明示同意＋security-review 必須**。
- `tauri-plugin-shell` は追加するが **capability に `shell:*` をゼロ付与**（sidecar spawn は Rust から・IPC を通らない）。
  frontend からは raw なパス/ポート/コマンドを渡さない（CLAUDE.md「frontend から shell 実行しない」「OS 操作は Rust に
  寄せる」に整合）。`csp: null` 不変。

## 完了条件

- Node sidecar が **externalBin として同梱**され、**Rust 側でライフサイクル/ポートが管理**される（viewer 開で spawn・
  閉/アプリ終了で kill・孤児プロセスが残らない・17331 衝突時は空きポート自動割当＋viewer へ通知）。
- **Twitch Device Code ログイン**が機能し（viewer に code/URL をテキスト提示）、実チャンネルのコメントが
  **sidecar → localhost WS → viewer 描画**（`mergeComments`）まで流れる（TTS 無しで可）。
- §1 のインターネット通信初解禁が **allow-list 宛先限定・ユーザー明示接続時のみ・main は no-internet 維持**で実装され、
  通信面が Node sidecar と viewer webview に封じ込められている（`lsof -i`/ネットワーク監視で外部ソケットが sidecar PID
  下のみに現れ、StreamDock 本体 PID には現れないことを確認）。
- Rust 正規化 `CommentViewDto` ＋ ts-rs binding が新設され、**Rust↔TS bindings drift ゼロ**。
- `docs/security.md`（新章＋§1/§4/§9/§10 例外・レビュー必須条件・032c-b 実施記録）・`docs/product.md`（外部通信例外）が
  改訂され、**security-review を通過**している。
- **トークン・code verifier 等が `app_logs` / 標準出力に出ていない**（§9）。
- `pnpm --filter ./apps/desktop typecheck` / `lint` / `cargo check` が pass。既存機能（ツール起動/停止・プリセット・
  らくらく画面枠組み・032c-a の別窓/内蔵ツール・032c-c の TTS）に退行が無い。
- `docs/progress.md` が更新されている。

## 確認コマンド

```bash
git diff --stat
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
pnpm gen:bindings && git diff --stat        # bindings drift ゼロ確認（comment-viewer/bindings 含む）
pnpm --filter ./apps/desktop tauri dev      # mac で E2E（下記）
# 封じ込め検証（tauri dev 実行中に別端末で）: 外部ソケットが Node sidecar PID 下のみに出ることを確認
lsof -i -nP | grep -iE 'twitch|ESTABLISHED'
```

E2E 目視（`pnpm tauri dev`・mac）:
1. **段階①**（インターネット無し）: viewer を開くと sidecar が起動し、ダミー `comments_append` が viewer に描画される。
   viewer を閉じる / アプリ終了で sidecar が停止し、`kill -9` でも孤児が残らない。ポート衝突時に空きポートで疎通する。
2. **段階②**: Twitch Device Code ログイン（viewer に code/URL 表示）が通り、実チャンネルのコメントが viewer に流れて
   描画される（TTS 無しで可）。通信が allow-list 宛先（Twitch 系）に限定され、telemetry 送信が無い。
3. **封じ込め**: main ウィンドウがインターネット接続を行わない。外部ソケットは Node sidecar PID 下のみ。
4. **資格情報**: OAuth トークン・code verifier 等が app_logs / 標準出力に出ていない（§9）。

## 段階分割（実装は「実装して」後・3 コミット）

1. **コミット1: Node sidecar 基盤（インターネット無しで E2E 検証）** — `tsc`→`esbuild`→SEA パイプライン、externalBin
   `-<triple>` 同梱、`tauri-plugin-shell`（Rust 専用・権限ゼロ）で spawn/kill/no-orphan（3 フック）、WS サーバが選定
   ポートに bind＋**ポート report-back**、viewer が実ポートへ接続し **実 tsyringe DI で立てた `WebSocketCommentOutputPort`
   からダミー `comments_append` を描画**。→ **decorator-metadata-thru-SEA・トランスポート・ポート受け渡しを
   インターネット前に実証**（スパイク 1/2/4/5/6/7/8 をここで潰す）。インターネットはまだ張らない。typecheck / lint /
   cargo check pass。
2. **コミット2: Twitch Device Code ログイン＋EventSub/Helix 取得＋描画（インターネット解禁）** — viewer に Device Code
   UI（`user_code`+`verification_uri` テキスト表示）、EventSub WS＋Helix、Rust 正規化 `CommentViewDto`＋ts-rs binding
   新設、`mergeComments` へ流す。**allow-list 強制コード（env ピン留め＋fail-closed ホストガード）を本コミットに載せる**
   （スパイク 3 をここで解消）。binding 再生成を同梱。`pnpm tauri dev` で実チャンネル E2E。
3. **コミット3: `docs/security.md` / `docs/product.md` 本文改訂＋security-review** — 新章追加、§1 allow-list 例外注記
   （＋032c-c forward-ref 更新）、§4 sidecar 例外、§9 トークン取扱、§10 依存/capability、「レビュー必須条件」1 行追加、
   product.md 例外追記、`### 032c-b …（security-review 実施済み）` 記録追加、`docs/progress.md` 更新。**docs 差分に
   security-review スキルを適用し判定を得る**。
