# 032c-d YouTube コメント取得有効化（OAuth PKCE ＋ gRPC streamList ＋ Client Secret 同梱 ＋ Google Cloud 運用 ＋ クォータ管理）

> 状態: **実装済（ヘッドレス検証 pass・実機 E2E 待ち）**。3 コミット（①OAuth ログイン ②gRPC streamList 取得＋クォータ graceful stop
> ③docs＋security-review）で実装し、security-review スキル判定＝問題なし。実施記録は `docs/progress.md`「032c-d …」を正とする。
> **残（実機）**: Google「Desktop app」OAuth クライアント（Client ID/Secret）焼き込み＋実 YouTube ライブで、①OAuth ログイン E2E
> ②実チャットの sidecar→WS→viewer 描画＋ずんだもん読み上げ ③`lsof` 封じ込め（gRPC egress 含め sidecar PID 下のみ）④クォータ unit 会計。
> consent screen 本番公開が未実施だとテストモードで refresh_token 7 日失効（§9・方針⑧）。本ファイルは
> [032c（親設計・方針転換の正）](032c-comment-viewer-voicevox-design.md) の「## 実装タスクへの分割」032c-d 節・「## 決定事項」論点
> 1 / 6 / 7・「## セキュリティ方針の改訂方針」を distill したもの。**スコープ・決定の線引きは 032c を正とする**。
>
> **必読前提**: [032c（親設計）](032c-comment-viewer-voicevox-design.md) と `docs/security.md`（特に §1 外部通信 /
> §4 shell / §9 ログ・資格情報 / §10 依存 / Capabilities 方針 / CSP 方針 / レビュー必須条件 / 「## コメントビューア
> （配信サービス連携）方針」）を読むこと。あわせて [032c-b（前提サブタスク・ハード依存）](032c-b-node-sidecar-twitch-comments.md)
> の Node sidecar 基盤・viewer WS(17331)・`CommentViewDto`（Rust ts-rs）・§1 二層 fail-closed 封じ込め・auth モジュール
> 配線を把握すること。再利用元の実績コードは別リポジトリ **osareview**（内部名 comment-dock・`/Users/tetsuya/PersonalWork/osareview`）の
> `backend/{comment-fetcher, api-gateway, auth}`（**YouTube 経路**）。
>
> **本タスクは 032c-b が構築した「StreamDock 初の能動的インターネット通信」基盤の上に YouTube 宛先を追加解禁する**もので、
> 新しい通信基盤は作らない。YouTube は Twitch より運用・セキュリティが厄介（**OAuth 認可コード＋PKCE＋Client Secret 同梱**・
> **Google Cloud consent screen 本番公開運用**・**無料クォータ 10,000 units/日**）であり、これらの前提と根拠を docs に
> 明文化する。**security-review 必須**。**依存前提は 032c-a ＋ 032c-b（ハード依存）**（Twitch/VOICEVOX と違い独立ではない・
> 着手前に 032c-b 完了を確認済み）。032c-c（VOICEVOX TTS・実装済み）は読み上げ E2E に流用する。CLAUDE.md どおり
> 「実装して」と言われるまでコード・docs 本文は変更せず、まず変更計画と対象ファイルを提示すること。

## 目的

内蔵コメントビューアに **YouTube の実コメントも流し込む**。032c-b が Twitch 用に構築した配管
（**Node sidecar（externalBin）→ localhost WS(17331) → viewer 描画**・§1 封じ込め・`CommentViewDto` 正規化）を
**そのまま再利用**し、sidecar の **YouTube 経路を有効化**する。これにより「YouTube と Twitch の両方でずんだもん
読み上げ」（各サービス個別選択）というミニマムが完成する。**StreamDock の Rust は完全同期のまま**・**main ウィンドウは
no-internet を維持**し、YouTube のインターネット通信も **Node sidecar と viewer webview に封じ込める**。

本タスクは **sidecar への YouTube OAuth（PKCE＋Client Secret 同梱）ログイン＋`liveChatMessages.streamList`（gRPC）
取得＋`CommentViewDto` 統合＋viewer の YouTube ログイン UI＋allow-list への Google/YouTube 宛先追加＋クォータ管理＋
`docs/security.md`/`docs/product.md` の YouTube 宛先・OAuth 運用前提・クォータ記録**に限定する。**Twitch 経路のロジックは
触らない**（032c-b 完了・フレームのみ再利用）。**VOICEVOX 合成/TTS/Web Audio は変更しない**（032c-c・読み上げは既存
パイプラインに流すだけ）。実装全体像は [032c](032c-comment-viewer-voicevox-design.md) を正とする。

## 現在の前提（調査結果）

### 032c-b が用意済み（本タスクの接続先＝再利用する基盤）

- **Node sidecar 基盤**: `apps/comment-sidecar/`（`tsc`→`esbuild`→Node SEA／`postject`・externalBin `comment-sidecar-<triple>`）。
  Rust ライフサイクル/ポート/no-orphan 3 段 kill は `apps/desktop/src-tauri/src/comment_sidecar/mod.rs`。
- **viewer WS(17331)**: sidecar の `WebSocketCommentOutputPort`（`vendor/gateway`）が 17331→空きポート フォールバックで bind し
  stdout `COMMENT_SIDECAR_PORT=<port>` で Rust へ通知。viewer は `get_comment_stream_port`→`ws://127.0.0.1:<実ポート>` へ接続。
  **単一双方向 WS**: viewer→sidecar `start-login`/`start-session`/`stop-session`、sidecar→viewer `device_code`/`session.state`/
  `comments.append`/`link.state`。実装は `apps/comment-sidecar/src/index.ts`・viewer 側は `src/features/comment-viewer/commentStream.ts`。
- **`CommentViewDto`（Rust ts-rs・正規化の正）**: `apps/desktop/src-tauri/src/comment_viewer/model.rs`＝
  `{ id, source(Twitch|Youtube), author{id,name}, text, published_at, event_type(Chat|Superchat|Membership|Subscription), monetary_amount?:String }`。
  **`source` は既に `youtube` を含む**（viewer の `mergeComments`・バッジ表示も source 非依存）。sidecar の `src/wire.ts`
  `toCanonicalComment()` が osareview DTO → この Rust binding 形状へ正規化して `comments.append` で送る。
- **§1 二層 fail-closed 封じ込め**: `apps/comment-sidecar/src/host-guard.ts`。(a) env ピン留め（base URL を定数固定）、
  (b) `installHttpHostGuard()` が **global `fetch`** を、`guardedWebSocketRuntime` が **`ws`** を包み、allow-list 以外を throw。
  **現在の allow-list は Twitch 宛先のみ**（`id.twitch.tv`/`api.twitch.tv`/`eventsub.wss.twitch.tv`/`*.wss.twitch.tv`）。
- **auth 配線**: `apps/comment-sidecar/src/auth/index.ts`。`createAuthClient()` が `loginStrategyByProvider`/
  `oauthTokenRefresherByProvider` に **`twitch` のみ**登録し、`assertSupportedProvider()` が **twitch 以外を reject**。
  `InMemoryTokenStore` を `PersistingTokenStore` でラップし、Twitch は `onTokenPersist`→Rust の OS キーチェーンへ永続化（032c-b′）。
- **Rust の同意URL open**: 汎用の frontend `open_url` command は無い。Rust 内部の `process::service::open_url`／
  `rakuraku_open_official_page` が **`tauri-plugin-opener`（既存 dep・IPC 非経由・ACL 不要）** で URL を開く実績あり。

### 再利用元 osareview の技術的実体（YouTube 経路・調査結果）

- **OAuth = 認可コード＋PKCE(S256)＋Client Secret・loopback リダイレクト**（RFC 8252 / Google「Desktop app」クライアント）。
  実装: `backend/auth/src/adapters/youtube/login/authorization-code-loopback-login-strategy.ts`。
  - PKCE は `node:crypto`（`adapters/shared/pkce/pkce.ts`・`randomBytes(32)`→base64url、challenge=base64url(sha256(verifier)))・
    追加ライブラリ無し。`state`=`randomBytes(16).hex`。
  - 認可URL（`adapters/youtube/client/oauth.client.ts`）: `https://accounts.google.com/o/oauth2/v2/auth`＋
    `client_id`/`response_type=code`/`redirect_uri`/`scope`/`state`/`code_challenge`/`code_challenge_method=S256`/
    `access_type=offline`/`prompt=consent`。scope 既定 `https://www.googleapis.com/auth/youtube.readonly`。
  - loopback: `adapters/shared/loopback/loopback.server.ts`＝`node:http` を `127.0.0.1:0`（**エフェメラルポート**）で listen、
    path `/callback`、state 検証（CSRF）・OAuth `error` 拒否・1 回だけ code を解決して close。`redirect_uri=http://127.0.0.1:<port>/callback`。
  - token 交換/更新（同 `oauth.client.ts`）: `POST https://oauth2.googleapis.com/token`（form・**`client_secret` を交換/更新の両方に含める**・
    グローバル `fetch`）。更新で refresh_token が返らなければ旧 refresh_token を再利用。
  - Client ID/Secret/endpoint は **env**（`YOUTUBE_OAUTH_CLIENT_ID`/`..._SECRET`/`..._ENDPOINT`）から。stream-dock ではこれを
    **ビルド時焼き込み（ピン留め）**に置換する（env override を排除＝§1 層(a)）。
- **ブラウザ shell-out**: osareview は `open`（npm）で認可URLを開く。stream-dock では **Rust opener に置換**（sidecar に `open` を足さない）。
- **liveChatId 検出**（`backend/comment-fetcher/src/adapters/youtube/client/live-stream.client.ts`・REST・グローバル `fetch`）:
  `GET /channels?mine=true`（自チャンネル id）→ `GET /search?eventType=live&type=video`（videoId・**search.list=100 units**）→
  `GET /videos?part=liveStreamingDetails`（`activeLiveChatId`）。検出は既定 5 回・5 秒間隔リトライ。
- **チャット取得 = gRPC `liveChatMessages.streamList`**（`adapters/youtube/client/api.client.ts`）: `www.googleapis.com:443` へ
  `credentials.createSsl()`・metadata `authorization: Bearer <token>`＋`x-goog-api-format-version: 2`・request
  `{ live_chat_id, page_token, part:[id,snippet,authorDetails], max_results:2000 }`。**手書き proto2** `stream_list.proto`
  （`@grpc/proto-loader`・`keepCase:true`）。**REST `liveChatMessages.list` は使わず、`pollingIntervalMillis` も無い**。
  UNAUTHENTICATED(code16) のみ refresh して張り直し。reconnect ループ（`usecases/comment-collection/youtube/collect-comments.usecase.ts`）は
  `next_page_token` を持ち越し 1000ms 待って再接続。
- **正規化**: `adapters/youtube/mapper/comment.mapper.ts`（snake_case）→内部 `Comment` → `comment-delivery` の converter → `CommentViewDto`。
  event map: `TEXT_MESSAGE_EVENT→normal`、`SUPER_CHAT_EVENT`/`SUPER_STICKER_EVENT→super_chat`、`NEW_SPONSOR_EVENT`/
  `MEMBER_MILESTONE_CHAT_EVENT→subscription`。`monetaryAmount={currency, amount_micros/1_000_000}`。snippet/author_details 欠落は drop。
- **クォータ handling は無い**: 403 `quotaExceeded`（REST）も `RESOURCE_EXHAUSTED`（gRPC）も特別扱いされず、gRPC 側は
  **1 秒で hot-loop 再接続**し得る。**stream-dock では graceful stop を追加する**（要改修点）。
- **トークンはどこにもログ出力されない**（grep 済み・良好）。ただし token endpoint の **`error`/`error_description`** は throw の
  message に載る（token ではない）。stream-dock 側の `safeReason` 相当で YouTube のエラー文言も精査する。
- **依存**: `@grpc/grpc-js ^1.14.3`＋`@grpc/proto-loader ^0.8.0`（純 JS・ネイティブアドオン無し）。auth は `open`＋
  `@napi-rs/keyring` を使うが **stream-dock では持ち込まない**（Rust opener／in-memory）。HTTP はグローバル `fetch`（`googleapis`/
  `node-fetch` 非依存）。

### stream-dock 現状（sidecar は Twitch 専用・YouTube は未 vendor）

- `apps/comment-sidecar/vendor/` は `auth`/`comment-delivery`/`comment-fetcher`/`gateway`/`shared` を持つが
  **YouTube ファイル・`.proto` は皆無**（Twitch のみ distill 済み）。`comment-fetcher/index.ts` は **Twitch 専用バレル**。
- `apps/comment-sidecar/package.json` の依存は `reflect-metadata`/`tsyringe`/`ws`（runtime）＋`esbuild`/`postject`/`typescript`
  （build）のみ。**`@grpc/*` は無い**（§10 で「YouTube 除外」として落とし済み）。
- viewer `CommentViewerApp.tsx` は Twitch パネル（「Twitch に接続」/チャンネル入力/取得開始/停止/device_code 表示/`linked`）を持つが
  **YouTube ボタンは無い**（`SOURCE_LABEL`/`SOURCE_CLASS` と seed には `youtube` 有り）。
- Rust `comment_sidecar/mod.rs` の stdout reader は `COMMENT_SIDECAR_PORT=`/`COMMENT_SIDECAR_TOKEN=`/`..._TOKEN_CLEAR` を扱う。
  **`COMMENT_SIDECAR_OPEN_URL=` は無い**（本タスクで新設）。`tauri-plugin-opener` は既存 dep。

## このタスクでやること

### (1) sidecar の YouTube OAuth（PKCE＋loopback＋Client Secret 同梱）ログイン

- osareview の YouTube 認可経路（`auth/adapters/youtube/*`＋`adapters/shared/{pkce,state,loopback}`）を **sidecar `vendor/` へ
  distill 取り込み**。追加ネット依存ライブラリは無し（`node:crypto`/`node:http`）。
- `apps/comment-sidecar/src/auth/index.ts`: `loginStrategyByProvider`/`oauthTokenRefresherByProvider` に **`youtube`** を登録、
  `assertSupportedProvider()` を youtube 許可に拡張。**YouTube は `InMemoryTokenStore` のみ**（`PersistingTokenStore` で
  ラップしない＝**keyring 永続化しない**・§9・本タスク対象外）。新規 `src/auth/youtube-config.ts`＝`PinnedYouTubeOAuthConfigProvider`
  （**Client ID＋Client Secret を焼き込み**・endpoint 定数固定＝env override 排除＝§1 層(a)）。
- **token/code_verifier/client_secret は WS にもログにも一切載せない**（in-memory のみ）。診断は stderr（stdout はプロトコル専用）。

### (2) 同意画面を開く導線（Rust opener・host 検証）＋viewer YouTube ログイン UI

- **ControlFrame を `service`（`twitch`|`youtube`）付きに拡張**（既定 twitch で後方互換）。`src/index.ts` が service で
  login/session を分岐。youtube ログイン開始で sidecar が PKCE 生成＋loopback server(127.0.0.1:ephemeral) 起動＋認可URL構築。
- **認可URLは sidecar→Rust の stdout 新規行 `COMMENT_SIDECAR_OPEN_URL=<url>`（親子 private pipe）で渡す**。`comment_sidecar/mod.rs`
  の stdout reader が受領し、**`https://accounts.google.com/...` を scheme/host 検証（fail-closed）してから `tauri-plugin-opener`
  で開く**（**URL 全体はログに出さない**・host のみ）。認可URLの query は非機密（client_id 公開・code_challenge はハッシュ・state
  乱数・redirect_uri は loopback）で **code_verifier は URL に載らない**。frontend は URL に触らない（OS 操作は Rust・CLAUDE.md 準拠）。
- ブラウザ同意 → loopback が code 受領 → `oauth2.googleapis.com` で token 交換（in-memory）→ `session.state`/`link.state` を
  **service 付き**で viewer へ。
- **viewer UI**（`CommentViewerApp.tsx`／`commentStream.ts`／`types`）: Twitch パネルと**併存**する **YouTube パネル**追加
  （「YouTube に接続」→`startLogin('youtube')`）。service ごとの `linked`/session 状態。YouTube は Rust が自動でブラウザを
  開くため device-code テキストブロックは不要（「ブラウザで同意してください」ステータス）。取得対象は**自分のアカウントの
  アクティブ配信を検出**（`mine=true`）＝YouTube はチャンネル名入力を要さない（Twitch と UI が異なる）。

### (3) YouTube コメント取得（`liveChatMessages.streamList`）→ `CommentViewDto` 統合 → viewer 描画

- osareview の YouTube 経路（検出 REST → `activeLiveChatId` → **gRPC streamList** → reconnect/pageToken）を `vendor/` へ取り込み、
  `comment-fetcher/index.ts` に **YouTube バレル**（`runYouTubePipeline`＋`registerYouTubeDeps`）を追加。`stream_list.proto` を同梱。
- `src/index.ts` の start-session(youtube) で `runYouTubePipeline` を起動し、`convertCommentToViewDto`→`toCanonicalComment`→
  `comments.append`（**既存パス再利用**・`source:'youtube'`）。**event-type マッピングが total か**（normal/super_chat/subscription →
  Rust `Chat`/`Superchat`/`Membership`/`Subscription`。`Membership` は YouTube では未使用＝許容）を `wire.ts` で確認。

### (4) allow-list 拡張（fetch ガード＋gRPC チャネルガード）＋クォータ graceful stop

- `host-guard.ts` の `ALLOWED_EXACT_HOSTS` に **`oauth2.googleapis.com`＋`www.googleapis.com`** を追加（OAuth token・REST 検出・
  fetch 経路をカバー）。`accounts.google.com` は**ブラウザ側**（Rust opener が開く先）で sidecar の fetch は張らない。
- **gRPC は fetch/ws を通らない**ため **gRPC チャネルガードを新設**（channel 生成時に target host を allow-list 照合＋Data API
  base URL を env ピン留め）＝§1 二層 fail-closed を **streamList にも適用**。ユニットテストに Google 宛先＋gRPC ガード＋
  サブドメイン偽装拒否を追加。
- **クォータ graceful stop**: 403 `quotaExceeded`（REST）/ `RESOURCE_EXHAUSTED`（gRPC）を検知したら **取得を停止し viewer へ通知**
  （`session.state='failed'`＋reason・**クラッシュさせない**・1 秒 hot-loop しない）。

### (5) `docs/security.md` / `docs/product.md` 本文改訂 ＋ security-review

- `docs/security.md`: §1 に **`### 例外（032c-d・…YouTube…）`** を追加（032c-b Twitch 例外の書式踏襲）。
  **「## コメントビューア（配信サービス連携）方針」** の ①（YouTube 宛先＝`accounts.google.com`[ブラウザ側・Rust opener]／
  `oauth2.googleapis.com`／`www.googleapis.com`[REST＋gRPC streamList]・fetch ガード＋**gRPC チャネルガード**の二層）と
  ④（**YouTube token は in-memory のみ＝keychain 永続化しない**＝Twitch と対比・code_verifier/client_secret 非ログ・同意URLは
  **Rust opener で host 検証して開く**＝Twitch のテキスト提示と異なる）を拡張し、**新規 ⑧**（**Client Secret 同梱の根拠**＝
  Google「Desktop app」OAuth クライアントは secret を機密扱いしない・**抽出前提でも PKCE＋インストール型モデルで被害限定**／
  **Google Cloud consent screen 本番公開の運用前提**＝テストモードだと refresh_token 7 日失効・100 ユーザー上限／OAuth
  クライアント種別＝Desktop app）を追記。§4（Rust opener で同意URLを開く・host 検証）・§9（YouTube token 取扱）・§10
  （`@grpc/grpc-js`＋`@grpc/proto-loader` を理由付きで再追加・`open` は足さず Rust opener・`tauri-plugin-opener` は既存）を拡張。
  `### 032c-d …（security-review 実施済み）` 記録を追記。`csp: null` は当面維持。
- `docs/product.md`: 「YouTube 取得は 032c-d で別途。」プレースホルダを **YouTube 例外＋クォータ記録**（無料枠 10,000 units/日・
  金銭 $0・長時間運用で無料の増枠申請が要り得る・枯渇時 graceful stop）へ更新。`docs/task-board.md`/`docs/progress.md` も更新。
- **docs 差分（＋allow-list/依存/OAuth/Client Secret/opener を含む一連）に security-review スキルを適用し判定を得る**。重点は
  封じ込め（main no-internet 維持・gRPC チャネル含む）・allow-list が Google/YouTube に限定・token/secret 非ログ・
  Client Secret 同梱の根拠明示。

## 設計まとめ（論点別）

| 論点 | 決定 |
|---|---|
| チャット取得 transport | **gRPC `liveChatMessages.streamList`**（osareview api.client.ts 最大再利用・低クォータ・親設計「現在の前提」と一致）。REST は破損時のフォールバック。 |
| OAuth | 認可コード＋**PKCE(S256)**＋**Client Secret 同梱**・**loopback リダイレクト**（Google Desktop app クライアント）。scope `youtube.readonly`。 |
| 同意画面を開く | **Rust が `tauri-plugin-opener` で開く**（sidecar→stdout `COMMENT_SIDECAR_OPEN_URL=`→Rust が host=accounts.google.com 検証）。sidecar に `open` を足さない。 |
| トークン | **in-memory のみ（keyring 永続化しない）**。非ログ・非外部送信・Google 宛のみ。Rust 側 token pipe/keychain は Twitch 用のまま不変。 |
| allow-list | fetch ガード（`oauth2.googleapis.com`/`www.googleapis.com` 追加）＋**gRPC チャネルガード**（streamList の target host 照合＋base URL env ピン留め）。 |
| クォータ | 無料枠 10,000 units/日・$0。枯渇時 **graceful stop＋通知**（hot-loop しない）。unit 会計は実機スパイクで確定。 |
| 検出 | 自アカウントのアクティブ配信（`mine=true`→search→videos→`activeLiveChatId`）。YouTube はチャンネル名入力不要。 |
| 封じ込め | インターネットは Node sidecar のみ／main は no-internet／viewer は localhost WS のみ。Twitch と併存・各サービス個別選択。 |
| Rust の同期性 | Rust は child ハンドル管理＋URL open のみ。**async/WS/HTTP crate を足さない**。 |

## 追加依存（CLAUDE.md「新しいライブラリは理由を説明」準拠）

- **Node ランタイム（SEA に埋め込む）**: `@grpc/grpc-js`＋`@grpc/proto-loader`（YouTube `liveChatMessages.streamList` gRPC
  ストリーミング。**純 JS＝ネイティブアドオン無し**。032c-b が §10 で「YouTube 除外」として落としたものを再導入）。`stream_list.proto`
  同梱（`@grpc/proto-loader` の runtime 読取が SEA で不可なら pbjs 静的 JS 化 or SEA アセット埋め込み＝スパイク1）。
- **新規に足さないもの**: npm `open`（**Rust opener** を使う）・`@napi-rs/keyring`（YouTube は in-memory）・`googleapis`/`node-fetch`
  （グローバル `fetch`）。`tauri-plugin-opener` は既存 dep（新規 Rust crate 追加なし）。Rust は完全同期のまま（async/WS/HTTP crate を足さない）。

## 実機スパイクで確定する点（着手前提の技術リスク・mac・自分の Google アカウント＋実 YouTube ライブ）

1. **proto-under-SEA（gRPC の gate・段階①で先に潰す）**: `@grpc/proto-loader` が単一 SEA 内で `stream_list.proto` を読めるか。
   ダメなら **pbjs 静的 JS 化 or SEA アセット埋め込み**。どうしても無理なら **REST `liveChatMessages.list` フォールバック**。
2. **gRPC チャネル封じ込め**: `lsof` で streamList egress が sidecar PID 下・`www.googleapis.com` のみ。チャネルガードが他 host を reject（ユニットテスト）。
3. **クォータ unit 会計**: 実ライブで units/時を実測し日次可動目安を本 spec / product.md に記録（検出 search.list=100 units が支配的か等）。
4. **OAuth 運用**: consent screen 本番公開の要否・refresh_token 寿命（テストモード=7 日）を確認しドキュメント化（コードでない前提）。
5. **SEA 再署名**: gRPC 追加後も `postject` SEA が mac 署名/Gatekeeper を通るか（032c-b スパイク7 の継続確認）。

## Google Cloud 運用前提（開発者側・コードでない前提・ドキュメント化）

- Google Cloud で **YouTube Data API v3 を有効化**＋**「Desktop app」種別の OAuth クライアントを作成**（Client ID＋Client Secret）。
  Client ID/Secret は Twitch Client ID と同様に **sidecar ビルド時に焼き込む**（ランタイム env / dotenv は使わない）。
- 実 E2E には**自分の Google アカウント＋実 YouTube ライブ配信**が必要。refresh_token を実運用寿命にするには **consent screen を
  本番公開**する（テストモードのままだと refresh_token 7 日失効・100 ユーザー上限）。

## このタスクでやらないこと

- **Twitch 経路の変更**（032c-b 完了・フレームは再利用するが Twitch のロジックは触らない）。
- **VOICEVOX 合成・TTS キュー・Web Audio の変更**（032c-c・実装済み）。YouTube コメントの読み上げは c の既存パイプラインに流すだけ。
- **Node sidecar 基盤・viewer WS・§1 封じ込めフレームの作り直し**（032c-b の再利用）。
- **OAuth トークンの keyring 永続化**（対象外・§9 準拠で in-memory で扱う）。
- **YouTube + Twitch の同時 / マージ表示**（対象外・各サービス個別選択）。
- **CSP 硬化**（`csp: null` は当面維持）。
- **クォータ増枠の自動申請・金銭課金の有効化**（金銭課金は使わない・枯渇時は graceful stop で対応）。
- osareview のリッチ機能（ピン留め・タグ・スパチャ装飾・統計・SQLite 永続化）の移植。

## セキュリティ制約（docs/security.md 準拠・抵触点と解禁範囲）

- **抵触点**: §1（allow-list に **Google/YouTube 宛先**を追加）／§4・opener 方針（**Rust が同意URLを opener で開く**）／
  §9（**Client Secret 同梱・PKCE code_verifier・YouTube OAuth トークン**）／§10（`@grpc/*` 再追加）／「## コメントビューア
  （配信サービス連携）方針」拡張／CSP 方針（`csp:null` 維持）。「レビュー必須条件」の既存行（内蔵コメントビューアの配信
  サービス連携）が本変更をカバー。
- **解禁範囲**: YouTube のインターネット通信は **allow-list 宛先（`oauth2.googleapis.com`／`www.googleapis.com`＋ブラウザ側
  `accounts.google.com`）限定・ユーザー明示接続時のみ**。通信面は **Node sidecar と viewer webview に封じ込め**（main は
  no-internet 維持・gRPC チャネルもガード）。telemetry/analytics/crash-report は全面禁止。取得コメントは端末外へ出さない。
  OAuth トークン・code_verifier・Client Secret は §9 準拠（**非ログ・非外部送信・in-memory 保存＝keyring 永続化しない**）。
  **明示同意＋security-review 必須**。
- **Client Secret 同梱の根拠**: Google「Desktop app」OAuth クライアントの secret は**機密扱いされない**（インストール型は抽出前提）。
  抽出されても **PKCE 併用＋インストール型モデル**で被害は限定（認可コード横取り防止・ユーザー個別同意）。この根拠を security.md に明記。
- `tauri-plugin-opener` は既存 dep で **capability に汎用 open 面を frontend に出さない**（Rust が host 検証して開く）。`csp: null` 不変。

## 完了条件

- **YouTube OAuth（PKCE＋Google Desktop クライアント）ログイン**が機能し、実ライブのチャットが
  **sidecar → localhost WS(17331) → viewer 描画**（`mergeComments`）まで流れる（**Twitch と併存・各サービス個別選択**）。
- **Client Secret 同梱の根拠**（抽出前提＋PKCE＋インストール型モデルで被害限定）と **Google Cloud consent screen 本番公開の
  運用前提**が `docs/security.md` に明記されている。
- §1 の allow-list に **YouTube 宛先が追加**され、**main は no-internet を維持**したまま通信が sidecar に封じ込められている
  （**gRPC チャネル含む**・`lsof -i` で外部ソケットが sidecar PID 下のみ・Twitch＋Google 宛先）。
- **無料クォータ 10,000 units/日**が `docs/product.md` に記録され、**枯渇時に graceful に取得停止**する（クラッシュせず通知）。
- **OAuth トークン・code_verifier・Client Secret が `app_logs` / 標準出力に出ていない**（§9）。**security-review を通過**している。
- Rust↔TS bindings drift ゼロ。`pnpm --filter ./apps/desktop typecheck` / `lint` / `cargo check` が pass。既存機能
  （Twitch 取得・VOICEVOX 読み上げ・別窓/内蔵ツール・プリセット・らくらく画面枠組み）に退行が無い。`docs/progress.md` が更新されている。

## 確認コマンド

```bash
git diff --stat
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
pnpm gen:bindings && git diff --stat        # bindings drift ゼロ確認
pnpm --filter ./apps/comment-sidecar typecheck   # sidecar（YouTube 追加後）
pnpm --filter ./apps/desktop tauri dev      # mac で E2E（下記・要 Google Desktop OAuth クライアント焼き込み）
# 封じ込め検証（tauri dev 実行中に別端末で）: 外部ソケットが Node sidecar PID 下のみに出ることを確認
lsof -i -nP | grep -iE 'googleapis|twitch|ESTABLISHED'
```

E2E 目視（`pnpm tauri dev`・mac・自分の Google アカウント＋実 YouTube ライブ）:
1. **段階①**: 「YouTube に接続」で Rust がシステムブラウザに同意画面（accounts.google.com）を開き、自分の Google
   アカウントで OAuth ログインが通る。token/verifier/secret が app_logs/stdout/stderr に出ない。
2. **段階②**: 実ライブのチャットが sidecar → WS(17331) → viewer 描画まで流れる。**Twitch と併存し各サービスを個別選択**できる。
   032c-c の**ずんだもんが読み上げる**。**クォータ枯渇時に graceful**（クラッシュせず通知・hot-loop しない）。
3. **封じ込め**: main ウィンドウがインターネット接続しない。外部ソケット（Google/YouTube＋Twitch）は Node sidecar PID 下のみ・
   gRPC streamList egress も sidecar 下のみ。telemetry/analytics が無い。
4. **資格情報**: OAuth トークン・code_verifier・Client Secret が app_logs / 標準出力に出ていない（§9）。

## 段階分割（実装は「実装して」後・3 コミット）

1. **コミット1: sidecar の YouTube OAuth ログイン → token 取得（ログに出さない）** — YouTube 認可経路を vendor 取り込み、
   `auth/index.ts` に youtube 配線（in-memory・keyring 無し）＋`youtube-config.ts`（Client ID/Secret 焼き込み・ピン留め）、
   ControlFrame に service 拡張、**`COMMENT_SIDECAR_OPEN_URL=`→Rust opener（host 検証）**、loopback で code 受領→token 交換、
   viewer に **YouTube ログイン UI**。**proto-under-SEA gate（スパイク1）と gRPC チャネルガードの土台をここで先行確認**。
   `pnpm tauri dev` で自分の Google アカウントで OAuth ログイン E2E。typecheck/lint/cargo check pass。
2. **コミット2: `liveChatMessages.streamList` 取得 → CommentViewDto → viewer 描画（クォータ会計・graceful stop）** —
   YouTube comment-fetcher を vendor 取り込み＋`@grpc/grpc-js`/`@grpc/proto-loader` 再導入＋`stream_list.proto` 同梱、
   start-session(youtube)→`runYouTubePipeline`→`comments.append`（既存パス再利用）、`host-guard` に Google 宛先＋**gRPC
   チャネルガード**、**403/RESOURCE_EXHAUSTED で graceful stop**。実 YouTube ライブ E2E＋クォータ unit 会計スパイク。
   Twitch と併存・各サービス個別選択・ずんだもん読み上げ確認。binding drift ゼロ。
3. **コミット3: `docs/security.md`（YouTube 宛先・Client Secret 根拠・consent 運用）＋`docs/product.md`（クォータ）＋
   security-review** — §1 例外（032c-d）追加、コメントビューア方針 ①④拡張＋新規 ⑧、§4/§9/§10 拡張、`### 032c-d …`
   実施記録、product.md のクォータ記録、task-board/progress 更新。**docs 差分に security-review スキルを適用し判定を得る**。
