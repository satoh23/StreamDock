# Security Policy

## 目的

stream-dock は、ユーザーのPC上で動作し、外部アプリのパスを保存し、将来的にはプロセス起動・停止を行うデスクトップアプリである。

そのため、ユーザーのPCを壊さないこと、意図しないファイル操作やシェル操作を行わないこと、外部通信を勝手に行わないことを最重要方針とする。

## このファイルの役割

本ファイルには、セキュリティレビューの**観点・方針・レビュー必須条件**のみを記載する。
個別変更のレビュー**実施記録**（「security-review 実施済み・判定・確認事項」等）はここには書かず、
`docs/progress.md` に記録する（2026-07-23 に、それまで本ファイルに蓄積していた実施記録節を
progress.md へ移設した）。レビューの結果、観点・方針・例外・レビュー必須条件そのものが変わる場合のみ、
本ファイルの該当箇所を更新する。

## 基本方針

### 1. 外部通信をしない

MVPでは、stream-dock は外部サーバーと通信しない。

禁止するもの:

- telemetry
- analytics
- crash report の自動送信
- remote config
- cloud sync
- 外部API通信
- CDNからのscript/css/image読み込み
- ユーザーデータの外部送信

許可する可能性があるもの:

- ユーザーが明示的に押した「公式サイトを開く」ボタン
- 将来的なアップデート確認

ただし、MVPではこれらも原則実装しない。

### 例外（032c-c・コメントビューアの VOICEVOX ローカル合成読み上げ）

上記「外部通信をしない」原則に対し、**コメントビューア（別ウィンドウ label `comment-viewer`）の VOICEVOX
読み上げに限り**、ローカルの VOICEVOX ENGINE（`http://127.0.0.1:50021`・ループバック）への通信を例外的に
許容する（コメントをローカルで音声合成して読み上げるため。インターネット通信ではない）。032c-a で全撤去した
loopback 例外を、合成＋ローカル再生に限定して（再）定義するもの。

- **宛先はループバック `127.0.0.1:50021` のみ**。許可する通信は **GET `/version`（稼働検出）／GET `/speakers`
  （話者・スタイル一覧の取得・033d）／POST `/audio_query`／POST `/synthesis`（合成）** に限定し、返る WAV は
  **Web Audio でローカル再生**する（外部送信しない）。**`GET /speakers` は話者名/スタイル名の一覧取得のみ**
  （GET・body 無し＝コメント本文・著者名・認証情報は送らず、返る一覧も選択肢に使うだけで端末外へは送信しない）。
- **viewer webview の `fetch` のみ**で行い、**Rust 側に HTTP クライアント・音声再生ライブラリ（`reqwest`/`rodio` 等）は
  追加しない**（新規依存ゼロ）。合成対象はコメント本文のみ・URL/絵文字を除去してから送る・著者名は送らない。
- VOICEVOX ENGINE の**プロセス起動のみ** Rust の管理付き `spawn`＋PID registry（`launch_tool` と同経路）で行い、
  frontend は raw なパス/ポートを渡さず**登録済みツールを exe 名一致で解決**して起動する（絶対パス直起動しない・
  未登録は誘導のみ・`registry()` は空のまま触らない）。
- **本例外（032c-c）自体はインターネット通信・OAuth に波及しない**（ローカル合成のみ）。Twitch コメント取得の
  インターネット通信は **032c-b で下記「例外（032c-b…）」＋「## コメントビューア（配信サービス連携）方針」に定義した**
  （YouTube 取得は **032c-d で定義済み**＝上記「例外（032c-d…）」）。新規 capability の広域追加・CSP 硬化はしない（`csp: null` 不変）。
- 撤去済みの棒読みちゃん 50001 はこの例外に含めない（50021 のみ）。

### 例外（032c-b・コメントビューアの Twitch コメント取得＝StreamDock 初の能動的インターネット通信）

上記「外部通信をしない」原則に対し、**内蔵コメントビューア（別ウィンドウ label `comment-viewer`）の Twitch
コメント取得に限り**、ユーザーが自チャンネルへ**明示接続した時のみ**、allow-list 宛先への通信を例外的に許可する
（配信サービスのコメントを取得して画面表示するため。StreamDock で初めての能動的インターネット通信）。詳細方針は
下記「## コメントビューア（配信サービス連携）方針」を正とし、設計は `docs/tasks/032c-b-node-sidecar-twitch-comments.md`
と親設計 `docs/tasks/032c-comment-viewer-voicevox-design.md` を正とする。

- **宛先は allow-list のみ**＝`id.twitch.tv`（Device Code / token）／`api.twitch.tv`（Helix）／
  `eventsub.wss.twitch.tv`（EventSub WS）／`*.wss.twitch.tv`（`reconnect_url` は Twitch 由来）。二層強制で担保する:
  ①**env ピン留め**（全 base URL を sidecar 内の定数に固定し env override 分岐を削除・Rust から宛先 env を渡さない）、
  ②**fail-closed ホストガード**（`fetch` と ws クライアント生成を包み、allow-list 以外は throw）。
- **通信面は Node sidecar と viewer webview に封じ込め**、**main ウィンドウ・その Rust command は no-internet を維持**する
  （Rust は完全同期のまま・async/WS/HTTP crate を足さない）。sidecar 起動/停止は Rust の `app.shell().sidecar()` からのみで、
  capability に `shell:*` はゼロ付与（frontend に shell 面を出さない）。
- **telemetry / analytics / crash-report は全面禁止**（依存にも入れない）。**取得コメントは画面表示のみで端末外へ出さない**
  （Rust の DB / ログにも保存しない）。OAuth トークン・device code・code verifier は**非ログ・非外部送信・in-memory のみ**（§9）。
- **明示同意（ユーザーの接続操作）＋ security-review を必須**とする。`user_code` / `verification_uri` は**テキスト提示**し、
  ブラウザ shell-out（`open`）はしない。`csp: null` は当面維持（TODO：将来 viewer CSP を効かせる際は `connect-src` に
  `https://id.twitch.tv https://api.twitch.tv wss://eventsub.wss.twitch.tv wss://*.wss.twitch.tv ws://127.0.0.1:*` を許可する）。

### 例外（032c-d・コメントビューアの YouTube コメント取得）

上記「外部通信をしない」原則に対し、**内蔵コメントビューア（別ウィンドウ label `comment-viewer`）の YouTube
コメント取得に限り**、ユーザーが**明示接続した時のみ**、allow-list 宛先への通信を例外的に許可する（032c-b の Twitch
例外に YouTube 宛先を追加解禁するもの・新しい通信基盤は作らない）。詳細方針は下記「## コメントビューア（配信サービス
連携）方針」を正とし、設計は `docs/tasks/032c-d-youtube-comments.md` と親設計 `docs/tasks/032c-comment-viewer-voicevox-design.md`
を正とする。

- **宛先は allow-list のみ**＝`accounts.google.com`（OAuth 同意画面・**ブラウザ側**で Rust opener が開く先。sidecar の fetch は
  張らない）／`oauth2.googleapis.com`（OAuth トークン交換/更新）／`www.googleapis.com`（YouTube Data API v3・REST 検出＋
  gRPC `liveChatMessages.streamList`）。**三面で fail-closed 強制**する: (a) **env ピン留め**（OAuth endpoint・Data API base URL を
  sidecar 内の定数に固定し env override を排除）、(b) **fetch ホストガード**（OAuth トークン交換・REST 検出が通る global `fetch`
  を包み allow-list 以外は throw）、(c) **gRPC チャネルガード（新設）**（gRPC は `fetch`/`ws` を通らないため、streamList の channel
  生成時に target を `www.googleapis.com:443` のみに照合して throw する）。ユーザーが「YouTube に接続」を押した時のみログインを開始する。
- **通信面は Node sidecar と viewer webview に封じ込め**、**main ウィンドウ・その Rust command は no-internet を維持**する
  （Rust は完全同期のまま・async/WS/HTTP crate を足さない・**gRPC egress も sidecar プロセスのみ**）。OAuth 同意 URL は sidecar→Rust の
  stdout 専用行 `COMMENT_SIDECAR_OPEN_URL=<url>` で渡し、Rust が **host=accounts.google.com を検証**してから `tauri-plugin-opener`
  （既存 dep・IPC 非経由・capability 不要）で既定ブラウザに開く（sidecar に `open` を足さない・**URL 全体はログに出さず host のみ**）。
- **telemetry / analytics / crash-report は全面禁止**（依存にも入れない）。**取得コメントは画面表示のみで端末外へ出さない**。
  OAuth アクセス/リフレッシュトークン・code_verifier・Client Secret は**非ログ・非外部送信**（§9）。**032c-d′ で OAuth アクセス/
  リフレッシュトークンは Twitch と同様に OS キーチェーンへ永続化する**（code_verifier/Client Secret は引き続き in-memory/baked＝非永続）。
- **無料クォータ 10,000 units/日**（金銭課金 $0）。枯渇時（REST 403 `quotaExceeded` / gRPC `RESOURCE_EXHAUSTED`）は取得を
  **graceful に停止**して viewer へ通知する（クラッシュせず・1 秒 hot-loop しない）。
- **明示同意（ユーザーの接続操作）＋ security-review を必須**とする。`csp: null` は当面維持（TODO：将来 viewer CSP を効かせる際は
  下記方針⑦の `connect-src` に `https://accounts.google.com https://oauth2.googleapis.com https://www.googleapis.com` を追加する）。

### 追補（036b・オーバーレイ投稿者アバター画像の取得＝新規 egress）

上記「外部通信をしない」原則に対し、**オーバーレイの投稿者アイコン表示に限り**、sidecar が投稿者プロフィール画像を
取得して **data URI 化**することを例外的に許容する（YouTube 分。詳細は下記「## コメントビューア（配信サービス連携）方針」⑩を正とする）。

- **追加宛先は fetch ホストガードの HTTPS ワイルドカードに明示追加**＝YouTube アバター画像 CDN `*.ggpht.com` / `*.googleusercontent.com`
  （**HTTPS の fetch のみ**・WS/gRPC には広げない・gRPC は `www.googleapis.com:443` のみのまま）。それ以外は throw（fail-closed）。
  env ピン留め・gRPC チャネルガードは不変。
- **取得は sidecar 内で完結**し webview には **data URI のみ**を渡す（webview/CSP/capabilities/main・Rust の no-internet 不変）。
  タイムアウト・バイト上限・MIME 許可・投稿者 ID 単位の上限付きメモリキャッシュ（非永続）を課し、data URI/URL は DB/ログに出さない（§9）。
  **新規依存なし**（`profile_image_size` で CDN 小サイズ要求＋`Buffer` base64・§10）。**方針変更のため security-review 必須**。

### 追補（036c・オーバーレイ投稿者アバター画像の取得＝新規 egress・Twitch 分）

上記「外部通信をしない」原則に対し、**オーバーレイの投稿者アイコン表示（Twitch 分）に限り**、sidecar が投稿者プロフィール画像を
取得して **data URI 化**することを 036b と同様に許容する（詳細は下記「## コメントビューア（配信サービス連携）方針」⑩を正とする）。
Twitch の chat イベントにはアバター URL が載らないため、**投稿者 ID を Helix `GET /users` で照会して `profile_image_url` を解決**する
（Helix `api.twitch.tv` は 032c-b で既に allow-list 済み＝**既存宛先内の照会追加**・宛先は増えない）。

- **追加宛先は fetch ホストガードの HTTPS ワイルドカードに明示追加**＝Twitch アバター画像 CDN `*.jtvnw.net`（例 `static-cdn.jtvnw.net`）
  （**HTTPS の fetch のみ**・WS/gRPC には広げない・gRPC は `www.googleapis.com:443` のみのまま）。それ以外は throw（fail-closed）。
  env ピン留め・gRPC チャネルガードは不変。
- **036b の共通取得基盤（`resolveAvatarDataUri`）を再利用**（Twitch 用に新実装しない）＝取得・data URI 化・タイムアウト・バイト上限・
  MIME 許可・上限付きメモリキャッシュ・失敗時 `undefined`（overlay グレー丸フォールバック）は同一。Helix 解決結果（投稿者 ID→URL）は
  sidecar 内の**上限付きメモリキャッシュ（非永続）**に載せ**同一投稿者を再照会しない**（過剰呼び出し防止）。**取得は sidecar 内で完結**し
  webview へは **data URI のみ**を渡す（webview/CSP/capabilities/main・Rust の no-internet 不変）。data URI・アバター URL・Helix 応答・
  OAuth トークンは DB/ログに出さない（§9）。**新規依存なし**（§10）。**方針変更のため security-review 必須**。

### 例外（044a・OBS オーバーレイソース自動追加＝obs-websocket loopback 連携）

上記「外部通信をしない」原則に対し、**OBS 連携（オーバーレイの「ウィンドウキャプチャ」ソース自動追加）に限り**、
ユーザーが**明示的に有効化した時のみ**、ローカルの OBS WebSocket（`ws://127.0.0.1:4455`・ループバック）への通信を
例外的に許容する（要望①・033/033f の「obs-websocket 不使用」決定を UX 優先で反転）。方式は **044s スパイクで方式A
（ウィンドウキャプチャ）に決定**（方式B＝ブラウザソースは当該環境で未描画・ローカル HTTP 新設が必要で不採用）。
詳細設計は `docs/tasks/044-obs-auto-source.md`／`044s`／`044a` を正とする。

- **宛先はループバック `127.0.0.1:4455` のみ**（インターネットには出さない）。**fail-closed の二層**で担保する:
  ①**ホストピン留め**＝OBS クライアント（sidecar）が接続 URL を `ws://127.0.0.1:${port}` と組み、`127.0.0.1` を
  **コード定数**に固定する（viewer/ユーザーは host を指定できない。port は下記 read-only 検出由来の数値のみ）。
  ②**接続直前アサート**＝`host-guard.ts` の `assertAllowedObsUrl()` が `ws://127.0.0.1:<port>` 以外（別ホスト・
  非 ws・userinfo 付き・ポート欠落）を throw する（`test-host-guard.mjs` で固定）。**obs-websocket-js は `isomorphic-ws`
  →`ws` パッケージを使い global `WebSocket` を通らない**ため global ガードでは傍受できず、この2層で loopback 限定を担保する。
  **外部 HTTPS/WSS/gRPC の allow-list とは分離**し、ここに loopback を混ぜない（外部宛先は増やさない）。
- **通信面は Node sidecar に封じ込め**、**Rust は完全同期のまま**（async/WS/HTTP crate を足さない・OBS 通信は sidecar・
  main no-internet 不変）。OBS へはソースを1つ作り（`CreateInput`(`window_capture`) / 既存なら再利用）、その
  **作成/再利用したソースの表示・非表示を切り替える**（`SetSceneItemEnabled`＝オーバーレイ表示 OFF で非表示・**削除はしない**）だけで、
  コメント取得・配信はしない。**新規外部宛先・新規依存はゼロ**（同一 loopback WS 上の OBS 制御に限る）。
  検証は `lsof -i` で 4455 接続が sidecar PID 下のみ・外部 ESTABLISHED が増えないことで確認する。
- **OBS WebSocket パスワード（§9）**: OBS 側で**認証が有効なときだけ**必要（read-only 検出の `auth_required` で判定し、
  必要な時のみ UI で入力を求める）。パスワードは **loopback WS には載せず**、UI→Rust コマンド（`set_obs_websocket_password`）
  →**OS キーチェーン**（`token_vault` の account `obs-websocket`）→sidecar へ **stdin private pipe**（`COMMENT_SIDECAR_OBS_PW=`）
  で渡す。**非ログ・非外部送信・localStorage 非保存**。
- **OBS 設定の read-only 検出（§5）**: WS 有効状態・ポート・認証要否を案内するため、OBS の
  `plugin_config/obs-websocket/config.json` を **read-only** で読む（`detect_obs_websocket_config`）。**書き込みは一切しない**
  （§5「外部アプリ設定の勝手な上書き」禁止を厳守・自動有効化は別タスク）。**`server_password` は読まない・返さない**（§9）。
  対象は **OS 別の既定パスのみ**（任意パス読取にしない・§7）。未検出/壊れは graceful（UI が有効化手順を案内）。
- **依存（§10）**: 新規 npm `obs-websocket-js`（sidecar 側・obs-websocket v5 クライアント）。**Rust の新規 crate は無し**
  （keyring/serde_json/tauri path API で足りる）。**ローカル HTTP サーバは新設しない**（方式A のため方式B の HTTP 依存は不要）。
- **Windows（要実機検証）**: ウィンドウキャプチャの「キャプチャ方法」を **WGC（Windows 10 1903 以降）に自動設定**する
  （既定「自動」だと透過窓が黒くなるため）。`method` の実 enum は 098 VM で確認する（macOS は該当プロパティ無し・実測済み）。
- **capability / CSP 不変**（`comment-viewer`/`comment-overlay`/`main` の capability を広げない・`csp: null` 不変・
  app 定義コマンドは ACL 非列挙）。telemetry/analytics/crash-report は追加しない。
- **明示同意（ユーザーの有効化操作）＋ security-review を必須**とする（方針反転＋新規 loopback 通信面＋新規依存＋
  外部アプリ設定の read-only 読取に該当）。

### 2. frontendから自由なOS操作をさせない

React / TypeScript側から、自由なshell実行・自由なファイル操作・自由なプロセス操作を行わない。

禁止するもの:

- frontendから任意コマンドを組み立てて実行する
- frontendから任意のファイルを読み書きする
- frontendから任意パスを削除する
- frontendからshell pluginのexecute/openを自由に呼ぶ
- ユーザー入力をそのままコマンドラインに渡す

OS操作、ファイル操作、プロセス操作は、Rust/Tauri側で定義した限定的なcommandのみを経由する。

### 3. Tauri commandは最小権限にする

Tauri commandは、機能ごとに明示的に定義する。

例:

- `create_tool`
- `list_tools`
- `update_tool`
- `delete_tool`
- `launch_tool`
- `stop_tool`

禁止するcommand例:

- `run_command(command: string)`
- `execute_shell(input: string)`
- `write_file(path: string, content: string)`
- `delete_path(path: string)`
- `open_anything(pathOrUrl: string)`

つまり、汎用的で強すぎるcommandを作らない。

### 4. Shell実行は原則使わない

MVPでは、自由なshell実行は使わない。

外部アプリ起動が必要な場合は、Rust側で `std::process::Command` 等を使い、登録済みのTool情報に基づいて起動する。

禁止するもの:

- `cmd /C <user input>`
- `powershell <user input>`
- `sh -c <user input>`
- shell経由での文字列コマンド実行
- ユーザー入力を結合したコマンド実行

許可するもの:

- 登録済みの `executablePath` を、Rust側で検証したうえで起動する
- 引数が必要な場合も、文字列結合ではなく配列として明示的に渡す

**例外（032c-b・コメントビューアの Twitch コメント取得）**: コメント取得の Node sidecar（`bundle.externalBin`
同梱の `comment-sidecar-<triple>`）を **Rust の `app.shell().sidecar()` からのみ**起動/停止することを例外的に許可する
（詳細は「## コメントビューア（配信サービス連携）方針」）。`tauri-plugin-shell` を追加するが **capability に `shell:*` を
ゼロ付与**し、sidecar spawn は IPC を通らない（frontend から shell 実行はできない）。自由な shell 実行・ユーザー入力を
結合したコマンド実行は引き続き禁止で、frontend には raw なパス/ポート/コマンドを渡さない。

**例外（032c-d・YouTube 同意画面を既定ブラウザで開く）**: YouTube OAuth の同意画面（`https://accounts.google.com/...`）は、
sidecar が stdout 専用行 `COMMENT_SIDECAR_OPEN_URL=<url>` で URL を渡し、**Rust 側が host=accounts.google.com を検証**してから
既存の `tauri-plugin-opener`（Rust API・IPC 非経由）で開く（`open` パッケージは sidecar に足さない）。frontend は URL に触れず、
opener コマンドを frontend に公開しない（capability 追加なし）。既存の url 種別ツール（023）と同じ opener 委譲方式で、
**host 検証を追加**した点のみ差分（`012` の `validate_http_url`＋host 完全一致・port/userinfo/サブドメイン偽装を fail-closed 拒否）。

### 5. ファイル操作はアプリ管理領域に限定する

MVPで許可するファイル操作は、原則としてアプリの管理領域内に限定する。

許可するもの:

- アプリ設定の保存
- SQLite DBの保存
- ログファイルの保存
- 将来的な設定バックアップファイルの保存

禁止するもの:

- 任意パスへの書き込み
- 任意パスの削除
- ユーザーのドキュメント、デスクトップ、ダウンロード配下を勝手に変更する
- 登録された外部アプリの設定ファイルを勝手に上書きする

将来的に設定ファイルのバックアップ・上書きを行う場合は、別タスクでセキュリティレビューを必須とする。

### 6. プロセス停止はstream-dock経由で起動したPIDに限定する

MVPでは、停止対象は stream-dock 経由で起動し、PIDを保持しているプロセスのみとする。

禁止するもの:

- process nameだけでkillする
- OBSなどの有名アプリ名を見つけて勝手に停止する
- ユーザーが手動で起動したプロセスを停止する
- 管理者権限で強制停止する

許可するもの:

- stream-dockが起動したPIDを停止する
- 停止できなかった場合にエラーを表示する

既知の実装上の限界（013 macOS `.app`）:

- macOS `.app` は `/usr/bin/open`（LaunchServices）で起動するため掴む `Child` が実アプリにならず、
  起動した実アプリの PID を「exe の親が `<bundle>/Contents/MacOS` である実行中プロセス」の照合で同定する。
  停止・状態確認の直前に **exe 絶対パスと起動時刻（start_time）の一致**を再検証して PID 再利用を弾く。
- `Contents/MacOS` 直下に**複数のフラットバイナリ**を持つ `.app`（ランチャスタブ＋本体等）では、本体以外の
  PID を同定・停止しうる（低頻度・アプリ依存の既知の限界）。`Info.plist` の `CFBundleExecutable` で厳密化する
  余地はあるが、読み取り専用の追加依存を避けるため MVP では据え置く。
- 既起動アプリの再アクティブ化（新規 PID が出ない）や遅延解決時に、ユーザーが手動起動したインスタンスを
  管理対象に取り込む可能性がある（上記「ユーザーが手動で起動したプロセスを停止する」禁止事項に対する緊張点）。

### 7. パス入力は検証する

ツール登録時の `executablePath` は、Rust側で最低限検証する。

確認項目:

- 空文字ではない
- 前後の空白をtrimする
- 重複登録を防ぐ
- 危険な制御文字を含まない
- 将来的には拡張子や存在チェックを行う

MVPでは、存在しないパスを保存するかどうかはタスクごとに判断してよいが、起動時には必ずエラーとして扱う。

### 8. ユーザー入力を信頼しない

frontend側でバリデーションしていても、Rust側でも必ず検証する。

対象:

- ツール名
- 実行ファイルパス
- 説明
- アイコンラベル
- プリセット名
- 起動順
- launchMode
- toolId
- presetId

### 9. ログに機密情報を出しすぎない

ログには、デバッグに必要な情報だけを書く。

避けるもの:

- 不必要なフルパスの大量出力
- 環境変数
- ユーザー名を含む情報の過剰出力
- 将来的な認証情報
- 外部送信

MVPではログはローカル保存のみとし、外部送信しない。

**例外運用（032c-b・OAuth トークン）**: コメントビューアの Twitch 連携で扱う OAuth アクセス/リフレッシュトークンは、
**ログに出さない・外部（インターネット/loopback WS）へ送信しない**。ログイン永続化のため、トークン一式
（`TokenSetPlain` の JSON）は **Rust 側で OS キーチェーン**（macOS Keychain / Windows Credential Manager /
Linux Secret Service）に保存する（sidecar は単一ファイル SEA のため native keyring addon を持てず、keychain 所有は
Rust に寄せる）。トークンは **sidecar↔Rust の親子プロセス private pipe のみ**を通る＝起動時の復元は Rust→sidecar の
**stdin**（`COMMENT_SIDECAR_RESTORE=<json>`）、更新（login/refresh）の再保存は sidecar→Rust の **stdout の専用行**
（`COMMENT_SIDECAR_TOKEN=<json>` / `COMMENT_SIDECAR_TOKEN_CLEAR`）で、Rust はこれをキーチェーンへ反映し**その内容を
ログに出さない**。**loopback WS（未認証）にはトークンを一切載せない**（載せるのは `user_code`/`verification_uri` 等の
非機密のみ）。device code・code verifier は従来どおり **in-memory のみ・永続化しない**。sidecar の stdout は Rust への
受け渡し専用（ポート行＋トークン行）で、人間向け診断ログは stderr に分離してトークン類を載せない。取得したコメント本文も
ログ/DB に保存しない（詳細は「## コメントビューア（配信サービス連携）方針」）。

**追補（032c-d・YouTube トークン／032c-d′ で永続化に更新）**: YouTube 連携で扱う OAuth アクセス/リフレッシュトークン・PKCE
`code_verifier`・**Client Secret** は **非ログ・非外部送信**。**当初（032c-d）は in-memory のみ（keyring 非永続）だったが、032c-d′ で
使い心地を Twitch と統一するため、OAuth アクセス/リフレッシュトークンのみ Twitch と同様に OS キーチェーンへ永続化する**
（provider 別 account `youtube-comment-viewer`・Rust 側 `keyring`・親子 private pipe 経由・非ログ）。**`code_verifier`（一時値）・
`Client Secret`（焼き込み）は引き続き in-memory/baked＝非永続**（TokenSetPlain に含まれない）。同意 URL の受け渡し（stdout
`COMMENT_SIDECAR_OPEN_URL=`）には token/secret/code_verifier を一切載せない（URL に載るのは `code_challenge`＝S256・非機密で、
`code_verifier` は sidecar メモリのみ）。Rust は URL 全体をログに出さず host のみ扱う。取得コメント本文もログ/DB に保存しない（Twitch と同様）。

**追補（038a・視聴者メモリの端末内保存＝§9「取得コメントを DB に保存しない」の限定解禁）**: 「一度コメントした
視聴者を記憶する」視聴者メモリ機能に**限り**、受信済みコメント（本文・著者名・event_type・投げ銭数値/通貨・
`published_at`）と集計（総数・bits/スパチャ回数と額・first/last・サブスク関連）・配信者メモを **端末内 SQLite
（`viewers`/`viewer_comments`）のみ**に保存する（ユーザーのセキュリティ方針＝限定・同意・レビュー付きで保存解禁は可、に沿う）。
**端末外へ送信しない・クラウド同期しない・新規の外部通信/宛先/capability を増やさない**（`record_comment` は
loopback WS で受信済みの値を Tauri コマンドで渡すだけ＝sidecar・main の no-internet 境界は不変）。**削除手段**
（`delete_viewer` 個別／`clear_viewers` 全消去）を備え、**アバター（data URI）は保存しない**。**ログには視聴者本文・
メモ・投げ銭履歴を出さない**（変更系コマンドの error ログは `ErrorCode` 由来の固定安全文言のみ・§9 の精神は維持）。
入力（コメント本文・視聴者名・メモ・session_id）は Rust 側で trim/制御文字拒否を通す（§8）。詳細は下記
「## コメントビューア（配信サービス連携）方針」⑪。**保存ポリシー変更のため security-review 必須**。

### 10. 依存関係を増やしすぎない

新しいnpm package、Rust crate、Tauri pluginを追加する場合は、理由を説明する。

特に注意するもの:

- shell操作系
- file system操作系
- auto update系
- network/http系
- telemetry系
- updater系
- plugin経由で強い権限を要求するもの

**追加した依存（032c-b・コメントビューアの Twitch コメント取得）**:
- Rust/Tauri: `tauri-plugin-shell`（externalBin sidecar を **Rust から**起動/停止・パス解決・stdout ポート受け渡し。
  **capability に `shell:*` はゼロ付与**）。`keyring`（v3・ログイン永続化: Twitch トークンを OS キーチェーンへ保存する。
  sidecar が native addon を持てないため keychain 所有を Rust に寄せる最小・イディオム的手段で、**同期 API**＝Rust 完全同期
  の要件に適合。各 OS の native backend のみ有効化）。他に汎用 Rust crate の新規追加は無し（singleton は `std::sync::Mutex`＋
  `app.manage`。**async/WS/HTTP crate は足さない**）。`bundle.externalBin` に Node sidecar（`comment-sidecar-<triple>`）を同梱する。
- Node（sidecar・アプリ本体には同梱しない別実行ファイル）: ランタイム＝`ws`/`tsyringe`/`reflect-metadata`、
  ビルド時のみ＝`esbuild`/`postject`。**明示的に落とした依存**＝`@grpc/grpc-js`・`@grpc/proto-loader`（YouTube 除外）、
  `@napi-rs/keyring`（in-memory 化・native addon 排除）、`open`（テキスト提示に変更）、`hono`/`@hono/node-server`/`zod`
  （HTTP 制御を単一 WS に統合）、`dotenv`（env を注入しない）。telemetry/analytics 系は入れない。
  詳細は「## コメントビューア（配信サービス連携）方針」。

**追加した依存（032c-d・コメントビューアの YouTube コメント取得）**:
- Node（sidecar）: `@grpc/grpc-js`＋`@grpc/proto-loader`（YouTube `liveChatMessages.streamList` の gRPC ストリーミング。
  **純 JS＝ネイティブアドオン無し**で、032c-b が「YouTube 除外」として落としたものを理由付きで**再導入**）。`stream_list.proto` は
  proto-loader が単一 SEA 内で実ファイルを読めないため**文字列として同梱**し、起動時に OS の一時ファイルへ展開して `loadSync` する
  （スパイク1）。SEA ビルドの禁止依存アサートから `@grpc/*` を外した（`@napi-rs/keyring`/`@hono/node-server`/`dotenv` は引き続き禁止）。
- **新規に足さないもの**: `open`（**Rust opener** を使う）・`@napi-rs/keyring`（YouTube は in-memory）・`googleapis`/`node-fetch`
  （グローバル `fetch`）。`tauri-plugin-opener` は既存 dep（新規 Rust crate は無し）。**Rust は完全同期のまま**（async/WS/HTTP crate を
  足さない・child ハンドル管理＋URL open のみ）。Client ID/Secret は Twitch Client ID と同様に **esbuild define でビルド時に焼き込む**
  （ランタイム env/dotenv 不使用）。

**追加した依存（036b・オーバーレイ投稿者アバター画像の取得）**:
- **新規依存なし**。アバターの縮小は gRPC リクエストの `profile_image_size`（=48）で **CDN 側に小サイズ URL を要求**するため
  クライアント側デコード/リサイズが不要で、取得は既存のグローバル `fetch`（fail-closed ホストガード経由）＋標準 `Buffer.toString("base64")`
  のみで data URI 化できる。**明示的に足さないもの**＝画像処理系（`sharp`/`canvas`＝native で §10 の pure-JS 方針に反する・`jimp`＝pure-JS だが
  CDN 縮小で不要）・HTTP クライアント（グローバル `fetch`）。想定外の画像サイズはバイト上限（128KB・ストリーム実測）で sidecar 内遮断する。

**追加した依存（036c・オーバーレイ投稿者アバター画像の取得＝Twitch 分）**:
- **新規依存なし**。036b の共通取得基盤（`resolveAvatarDataUri`）と既存の Helix クライアント（`TwitchHelixClient`・グローバル `fetch`）を
  再利用するのみ。Twitch は `profile_image_size` 相当のサイズ指定が無いため Helix `users` の `profile_image_url`（実寸）をそのまま使い、
  想定外サイズは 036b 基盤のバイト上限（128KB・ストリーム実測）で sidecar 内遮断する。投稿者 ID→URL の Helix 解決キャッシュも標準
  `Map` のみ（新規ライブラリ無し）。

**追加した依存（044a・OBS オーバーレイソース自動追加）**:
- Node（sidecar）: `obs-websocket-js`（v5・obs-websocket クライアント。OBS へ `ws://127.0.0.1:4455` で接続しウィンドウ
  キャプチャソースを自動追加する。`isomorphic-ws`→`ws`〈既存 dep〉経由で loopback のみに接続し、`assertAllowedObsUrl` と
  ホストピン留めで fail-closed）。SEA の禁止依存アサート（`@napi-rs/keyring`/`@hono/node-server`/`dotenv`）には該当せずそのままバンドルされる。
- **Rust/Tauri: 新規 crate なし**（`keyring`〈既存・OBS パスワードを account `obs-websocket` で保存〉・`serde_json`〈既存・
  config.json 解析〉・Tauri path API〈既存・OS 別既定パス解決〉で足りる。**async/WS/HTTP crate は足さない**＝Rust 完全同期を維持）。
- **明示的に足さないもの**: ローカル HTTP サーバ（`hono` 等＝方式B 不採用のため不要）・画像処理系・network/http crate。
  telemetry/analytics 系は入れない。

## Tauri Permissions / Capabilities 方針

Tauriのpermissions/capabilitiesは最小限にする。

方針:

- `shell:default` のような広い権限を安易に許可しない
- `fs:default` のような広い権限を安易に許可しない
- 使っていないplugin権限をcapabilitiesに追加しない
- frontendから呼べるcommandを必要最小限にする
- 危険なscopeを広げない

**032c-b（tauri-plugin-shell を追加するが shell 権限はゼロ）**: `tauri-plugin-shell` を依存に追加したが、
sidecar の spawn は Rust の `app.shell().sidecar()` から行い IPC を通らないため、`capabilities/comment-viewer.json`
にも `capabilities/default.json` にも **`shell:*` permission を一切追加しない**（`comment-viewer.json` は `core:default`
のまま／`default.json`（main）不変）。viewer は読み取り専用の新 command `get_comment_stream_port` と既存パターンの
`open_comment_viewer_window` のみを invoke する（アプリ定義 command は ACL 列挙不要）。`csp: null` 不変。

## CSP方針

MVPでは外部リソースを読み込まない。

方針:

- 外部scriptを読み込まない
- 外部styleを読み込まない
- 外部imageを読み込まない
- inline scriptを増やさない
- remote domain IPCを使わない

### 現状の実装メモ（018 時点）

`tauri.conf.json` は plain JSON でインラインコメントを持てないため、CSP の現状意図をここに残す。

- `app.security.csp` は現在 `null`（＝CSP を**強制していない**）。これは 018 以前からの既定で、
  018 Tool Icon Auto-Extraction でも**緩めていない**（変更していない）。
- 018 のアイコン表示は `data:image/png;base64,...`（inline data URI）のみを使い、リモート画像の
  取得は行わない。上記「外部imageを読み込まない」方針とは矛盾しない。
- TODO（別タスク）: CSP を実際に効かせる場合は `img-src 'self' data:` 等を設定し、`data:` inline を
  許可しつつ外部リソースをブロックする。値の変更はレビュー必須条件（下記）に該当するため別途対応する。

### 例外（032 追加対応・らくらくツール設定 詳細画面の YouTube デモ動画埋め込み）

上記「外部リソースを読み込まない」原則に対し、**らくらくツール設定の詳細画面のデモ動画に限り**、
YouTube（`https://www.youtube-nocookie.com/embed/<id>`）の **iframe 埋め込み**を例外的に許容する
（動画をアプリに同梱すると容量が増えるため。明示同意ではなくデモ表示のため security-review で担保）。

- **プライバシー強化ドメイン（youtube-nocookie）**を使い、再生するまで Cookie を張らない。`rel=0` で関連動画を抑制。
- iframe 属性は最小・安全側（`referrerpolicy="strict-origin-when-cross-origin"` / `allow="encrypted-media; fullscreen;
  picture-in-picture"` / `loading="lazy"` / `title`）。動画 ID は **frontend の定数**（ユーザー入力でない）で、
  `^[A-Za-z0-9_-]{11}$` の正規表現ガードを通してから src を組み立てる（未設定・不正時は「準備中」プレースホルダ）。
- 新規依存・Tauri command・capability の追加なし（iframe は純 HTML・webview が描画し IPC に触れない）。`csp: null` 不変。
  詳細画面を開くと YouTube/Google へ外部通信が発生する（§1 の一般禁止に対する限定例外）。telemetry は追加しない。
- **TODO（別タスク・上記と同じ）**: CSP を実際に効かせる場合、本埋め込みのため `frame-src https://www.youtube-nocookie.com`
  （および YouTube 側が要求する `googlevideo.com` 等の派生ドメイン）を許可する必要がある。

## らくらくツール設定（外部アプリ連携）方針

らくらくツール設定の「外部アプリ連携」機能に関する方針（詳細な設計判断は
`docs/tasks/032-rakuraku-auto-setup-design.md` を正とする）。

**032c-a（方針転換に伴う撤去）**: 032b で実装した棒読みちゃん×VOICEVOX 連携のうち、**ループバック疎通通信
（§1 の限定解禁分・VOICEVOX 50021 / 棒読みちゃん 50001）／棒読みちゃん設定ファイルの書換（§5 の限定解禁分・
バックアップ付き）／新規依存 `ureq`／SAPI レジストリ読取（`Win32_System_Registry`）**は撤去した。これにより
§1（外部通信をしない）・§5（外部設定を上書きしない）の一般原則へ復帰する（限定解禁は無し）。現時点で登録済みの
連携実装は無い（`registry()` は空）。なお VOICEVOX 直接読み上げ（ローカル合成）の loopback 50021 例外は、その後
**032c-c で（再）定義した**（合成＋WAV ローカル再生に限定・上記 §1「例外（032c-c…）」を参照）。棒読みちゃん
50001 は撤去済みで（再）定義しない。

以下は温存する共有部（らくらく画面シェル・登録済みアプリの自動起動・公式ページ誘導）の方針。

- **インストーラの自動DL・自動インストールはしない**。不足アプリは公式配布元ページを開いて誘導するのみとする
  （URL は Rust 側の固定定数で解決し、frontend は raw URL を渡さない）。
- **既導入・同意済みアプリの自動起動を許可**する（032b 修正2 の導入検出・起動経路を温存）。対象は**「ツール管理」に
  登録済みで `executablePath` が有効**（絶対・実在・非ディレクトリ・`.lnk`/`.bat` でない）なアプリのみ。
  **解決は登録済み `executablePath` のみ**を用い、**FS 広域走査（Downloads/ドライブ直下等の `read_dir`）・sysinfo に
  よるプロセス列挙は行わない**（同名 exe 偽装の攻撃面を排除）。登録済みツールと部品の対応付けは **exe ファイル名一致**
  （大小無視）で行い、**永続化しない**。起動は **shell 非経由**で、登録時にユーザーが明示選択・検証済みの絶対パスを
  **既存の管理付き `process::service::spawn`＋PID registry 登録**（`launch_tool` と同経路）で行う。これにより起動
  プロセスは**停止/監視の対象になる**（§6「停止は自 spawn 起動 PID に限定」と整合）。frontend は部品名の固定語だけを
  渡し、raw パスは渡さない。**未署名バイナリの DL/インストールはしない**（誘導のみ）。
- **明示同意（同意画面）＋ security-review を必須**とする。自動起動は同意画面に明示する。
- **frontend からは raw なパス/URL/ポート/コマンドを受けず、限定コマンド（`rakuraku_*`）経由のみ**とする。
  外部通信は追加しない（capability は追加しない）。`csp: null` 不変。

## コメントビューア（配信サービス連携）方針

内蔵コメントビューア（別ウィンドウ label `comment-viewer`）の配信サービス連携（032c-b で Twitch を初解禁・
**032c-d で YouTube を追加解禁**）の方針。**StreamDock で初めての能動的インターネット通信**であり、詳細な設計判断は
`docs/tasks/032c-b-node-sidecar-twitch-comments.md`／`docs/tasks/032c-d-youtube-comments.md` と親設計
`docs/tasks/032c-comment-viewer-voicevox-design.md` を正とする。**Twitch と YouTube は併存し同時取得・マージ表示する**
（provider 別セッションで並行取得。**035a で「各サービス個別選択・同時取得しない」から反転**。sidecar のセッション排他を
`Map<Provider, AbortController>` へ分離しただけで、宛先・二層 fail-closed・no-internet 境界は不変＝通信面の拡大ではない）。

**構成**: インターネット通信は **Node sidecar（`bundle.externalBin` 同梱の単一実行ファイル `comment-sidecar-<triple>`）**
に封じ込め、viewer webview は **localhost の WebSocket（`ws://127.0.0.1:<実ポート>`）のみ**で sidecar と通信する。
main ウィンドウと Rust command は **no-internet を維持**する（Rust は完全同期のまま・tokio/WS/HTTP/OAuth の async を持ち込まない・
sidecar の stdout は別スレッドで同期的に読む・**gRPC egress も sidecar のみ**）。sidecar は osareview の Twitch/YouTube 経路を
distill（vendor）したもので、keyring・`open`・hono/zod・dotenv・googleapis/node-fetch を import グラフから排除している
（gRPC＝`@grpc/grpc-js`/`@grpc/proto-loader` は YouTube streamList のため 032c-d で再導入し、チャネルガードで封じ込める）。

- **①外部通信は allow-list 宛先・ユーザー明示接続時のみ（§1 の限定解禁）**。宛先＝`id.twitch.tv`（Device Code / token）／
  `api.twitch.tv`（Helix）／`eventsub.wss.twitch.tv`（EventSub WS）／`*.wss.twitch.tv`（`reconnect_url` は Twitch 由来）。
  **二層で fail-closed 強制**する: (a) **env ピン留め**＝全 base URL を sidecar 内の定数に固定し env override 分岐を削除
  （Rust から宛先 env を渡さない）、(b) **ホストガード**＝global `fetch` と ws クライアント生成を包み、allow-list 以外
  （host 不一致・非 HTTPS/WSS）は throw する。ユーザーが「Twitch に接続」を押した時のみログインを開始する。
  **（032c-d・YouTube 追加）** 宛先に `accounts.google.com`（OAuth 同意画面・**ブラウザ側**で Rust opener が開く先。sidecar の
  fetch は張らない）／`oauth2.googleapis.com`（OAuth トークン交換/更新）／`www.googleapis.com`（Data API v3・REST 検出＋gRPC
  streamList）を追加。gRPC は `fetch`/`ws` を通らないため **(c) gRPC チャネルガードを新設**し、streamList の channel 生成時に
  target を **`www.googleapis.com:443` のみ**に照合して throw する（fetch の allow-list より狭い）。ユーザーが「YouTube に接続」を
  押した時のみログインを開始する。
  **（043a 拡張・Twitch Bits Power-ups）** Bits Power-ups 取得のため **Twitch OAuth スコープに `bits:read` を追加**し、
  EventSub 購読に **`channel.bits.use` を追加**する。**宛先（allow-list ホスト）は増えない**（既存 `api.twitch.tv`／
  `eventsub.wss.twitch.tv` 上の購読追加のみ・env ピン留め・二層 fail-closed は不変）が、**OAuth スコープの拡大**にあたるため
  既存ユーザーは**再ログインするまで Power-ups 購読は 403 になり得る**。この購読作成は sidecar 側で**非致命化**し（失敗しても
  chat.message/chat.notification の本線配信は継続）、cheer は chat.message 側で取得済のため mapper で二重計上を避ける
  （bits.use の `type==="cheer"` を捨て、power_up のみ superchat＋`currency="BITS"` に集約）。
- **②通信面の封じ込め（最重要の安全論拠）**。インターネットに出るのは sidecar プロセスのみ。main は出ない。
  検証は `lsof -i` で外部 ESTABLISHED ソケットが **sidecar PID 下のみ**に出て StreamDock 本体 PID に出ないことで確認する。
- **③§4（shell）例外**。sidecar 起動/停止は Rust の `app.shell().sidecar()` からのみ。`tauri-plugin-shell` を追加するが
  **capability に `shell:*` はゼロ付与**（IPC を通らない）。frontend に shell 面・raw パス/ポートを出さない。
- **④§9（資格情報）**。OAuth アクセス/リフレッシュトークンは **非ログ・非外部送信**。ログイン永続化のため、
  トークン一式は **Rust 側で OS キーチェーンに保存**し（sidecar は native keyring を持てないため keychain 所有は Rust）、
  sidecar↔Rust の **親子 private pipe のみ**で受け渡す（復元＝stdin `COMMENT_SIDECAR_RESTORE=`、再保存＝stdout の専用行
  `COMMENT_SIDECAR_TOKEN=`／破棄＝`COMMENT_SIDECAR_TOKEN_CLEAR`）。**loopback WS にはトークンを載せない**。device code /
  code verifier は in-memory のみ・非永続。`user_code` / `verification_uri`（非機密）は viewer に**テキスト提示**し、ブラウザ
  shell-out（`open`）はしない。**取得したコメントは画面表示のみ**で、端末外へ出さず Rust の DB / ログにも保存しない
  （**例外（038a）: 視聴者メモリ機能に限り、受信済みコメントを端末内 SQLite へ保存する＝下記⑪。端末外へは出さない**）。
  **（032c-d・YouTube 追加／032c-d′ 更新）** YouTube の OAuth アクセス/リフレッシュトークンは **Twitch と同様に OS キーチェーンへ
  永続化する**（032c-d′・使い心地統一・provider 別 account `youtube-comment-viewer`）。`code_verifier`（一時値）・`Client Secret`（焼き込み）は
  **in-memory/baked＝非永続**。いずれも非ログ・非外部送信。同意 URL は Twitch のテキスト提示と異なり
  **Rust opener で開く**＝sidecar→Rust stdout `COMMENT_SIDECAR_OPEN_URL=`→Rust が `host=accounts.google.com` を検証して
  `tauri-plugin-opener` で開く（URL 全体はログに出さず host のみ・URL に載るのは `code_challenge` で `code_verifier` は載らない）。
- **⑤telemetry / analytics / crash-report は全面禁止**（依存にも入れない）。
- **⑥Twitch アプリ Client ID の扱い**。Device Code（public client・secret 無し）で必須の**公開**アプリ識別子であり秘密情報ではない。
  sidecar のビルド時に焼き込む（ランタイム env / dotenv は使わない）。ユーザーのログイン/連携はビューア画面からのランタイム操作で、
  Client ID はエンドユーザーに露出しない。
- **⑦明示同意（接続操作）＋ security-review を必須**とする。`csp: null` は当面維持（TODO：将来 viewer CSP を効かせる際は
  `connect-src https://id.twitch.tv https://api.twitch.tv wss://eventsub.wss.twitch.tv wss://*.wss.twitch.tv ws://127.0.0.1:*`
  ＋YouTube 分 `https://accounts.google.com https://oauth2.googleapis.com https://www.googleapis.com` を許可）。
  **（043a 拡張）** Twitch スコープに `bits:read` を追加したため、既存接続ユーザーは **再ログイン（再同意）で新スコープを付与**する
  まで Power-ups が届かない（本線チャットは従来スコープで継続）。宛先は増えないが**スコープ拡大は明示同意の対象**として扱う。
- **⑧（032c-d）YouTube「Desktop app」OAuth の Client Secret 同梱の根拠 ＋ consent screen 運用前提 ＋ クォータ**。
  - **Client Secret 同梱**: Google の **「Desktop app」種別**の OAuth クライアントでは、secret は **機密として扱われない**
    （インストール型アプリはバイナリからの抽出前提）。secret が抽出されても **PKCE(S256)＋インストール型モデル**で被害は限定される
    （認可コード横取り防止・ユーザーごとの個別同意が必要）。よって Twitch Client ID と同様に **ビルド時に焼き込む**（ランタイム
    env/dotenv は使わない・§9/§10）。クライアント種別は **Desktop app**（loopback リダイレクト）。
  - **consent screen 運用前提**: refresh_token を実運用寿命にするには consent screen を **本番公開**する必要がある
    （テストモードのままだと **refresh_token が 7 日で失効・登録 100 ユーザー上限**）。これは開発者側の運用前提（コードではない）。
  - **クォータ**: YouTube Data API v3 は金銭課金 $0 だが **無料枠 10,000 units/日**（PT 深夜リセット・セルフ課金購入不可）。
    枯渇時（REST 403 `quotaExceeded` / gRPC `RESOURCE_EXHAUSTED`）は取得を **graceful に停止**して viewer へ通知する
    （クラッシュ・hot-loop しない）。長時間運用では無料の増枠申請が要り得る（自動申請・課金有効化はしない）。
- **⑨（035a）同時取得の並行 egress・リソース留意**。Twitch と YouTube を同時取得すると、上記①の既存 allow-list 宛先へ
  **並行に egress**する（**新規宛先は増やさない**・env ピン留め・fetch/gRPC ガードは不変）。CPU/メモリ/ソケットは
  2 セッション分に増える。**YouTube の無料クォータ（10,000 units/日）消費は Twitch 併走の影響を受けない**（消費源は
  YouTube Data API のみで、Twitch は EventSub WS＝別勘定。現行の検出/生存監視は各 1 unit・チャットは gRPC streamList で
  低消費のため実運用の枯渇はまず起きず、枯渇時は⑧の graceful stop で viewer へ通知＝032c-d 既実装）。ユーザーが**明示接続
  した provider のみ**取得を開始する点は不変。UI 上の読み上げ制御（source 別 ON/OFF）は 035c で扱う（クォータ保護 UI は
  不要と判断し 035c から除外＝2026-07-20）。
- **⑩（036b）オーバーレイの投稿者アバター画像取得（新規 egress・YouTube 分）**。overlay の投稿者アイコンへ実画像を
  出すため、**sidecar が投稿者のプロフィール画像を取得して data URI 化**する（親 [036]・036b）。**取得は sidecar 内で完結**し、
  webview へは **data URI のみ**を loopback WS で渡す＝webview は外部 URL を踏まない・**`csp: null` 不変・capabilities 不変・
  main/Rust の no-internet 不変**（`<img>`/`background-image` が踏むのは data URI のみ）。
  - **追加宛先（fetch ホストガードの HTTPS ワイルドカードに明示追加）**＝YouTube アバター画像 CDN
    `*.ggpht.com`（例 `yt3.ggpht.com`）／`*.googleusercontent.com`（例 `lh3.googleusercontent.com`）。**HTTPS の fetch でのみ許可**し、
    **WS・gRPC には広げない**（gRPC は `www.googleapis.com:443` のみのまま＝最狭を維持）。先頭ドット suffix で真のサブドメインのみ
    一致し、`ggpht.com.evil.com` 等の偽装は throw（`host-guard.ts` の `ALLOWED_HTTPS_WILDCARD_SUFFIXES`・`test-host-guard.mjs` で固定）。
    env ピン留め・gRPC チャネルガード等の既存ロジックは不変。**allow-list 外ホストは従来どおり throw（fail-closed）**。
    ※CDN ホストは実 streamList レスポンスの `profile_image_url` で最終確定し、`host-guard.ts` と本記述を一致させる。
  - **縮小はクライアント側で行わない**＝gRPC リクエストの `profile_image_size`（=48）で CDN から小サイズ URL を要求するため
    デコード/リサイズ不要。取得は `fetch` + `Buffer.toString("base64")` のみで **新規依存なし**（§10）。**取得タイムアウト
    (3s)・画像バイト上限(128KB・ストリーム実測で中断)・MIME 許可(png/jpeg/webp/gif)** を課し、失敗/超過/タイムアウト/非許可は
    **undefined**（overlay はグレー丸へフォールバック）。リダイレクト追従は fail-closed に禁止（`redirect:"error"`）。
  - **キャッシュ**は投稿者 ID 単位・**メモリ内・上限付き（正 LRU 500件／負 TTL 5分）・非永続**。**data URI・アバター URL を
    Rust の DB／ログに出さない**（§9）。取得した第三者アイコンは**一時表示のみ**。
  - **036c（Twitch・実施済み）**は本基盤（`resolveAvatarDataUri`）を再利用する。Twitch の chat イベントにはアバター URL が載らないため、
    **投稿者 ID を Helix `GET /users` で照会して `profile_image_url` を解決**（Helix `api.twitch.tv` は既存 allow-list 内・宛先は増えない・
    投稿者 ID→URL の上限付きメモリキャッシュで再照会しない）し、Twitch アバター CDN **`*.jtvnw.net`**（例 `static-cdn.jtvnw.net`）を
    `ALLOWED_HTTPS_WILDCARD_SUFFIXES`（`host-guard.ts`）・`test-host-guard.mjs` に追加した（HTTPS fetch のみ・WS/gRPC には広げない・
    `jtvnw.net.evil.com` / `evil-jtvnw.net` は throw）。取得は sidecar 内完結・data URI のみを webview へ渡す（CSP/capabilities/no-internet 不変）。
- **⑪（038a）視聴者メモリの端末内保存（§9「取得コメントを DB に保存しない」の限定解禁・security-review 必須）**。
  「一度コメントした視聴者を記憶する」ため、受信済みコメント（本文・著者名・event_type・投げ銭数値/通貨・`published_at`）と
  集計（総数・bits/スパチャ回数と額・first/last・サブスク/メンシプ関連）・**配信者が残すメモ**を、**端末内 SQLite
  （`viewers` / `viewer_comments`）のみ**に保存する（安定キー `provider:providerUserId`・`viewer_comments` は FK CASCADE）。
  - **端末外へ出さない・クラウド同期しない・複数端末共有しない**。frontend が loopback WS で受信済みの値を Tauri コマンド
    `record_comment(comment, session_id)` で Rust へ渡すだけで、**新規の外部通信・宛先・capability を増やさない**
    （§1/§3。sidecar・main ウィンドウの no-internet 境界は不変・`comment-viewer.json` は `core:default` のまま・
    アプリ定義コマンドは ACL 列挙不要）。集計（回数・合計額）の正確化のため sidecar の wire（`wire.ts`）に既にある
    投げ銭の数値 `{amount, currency}` を捨てず Rust `CommentViewDto.monetary` へ通すが、**通信面は拡大しない**
    （sidecar の宛先・二層 fail-closed は不変）。
    - **（043a・集計項目の変更＝方針⑪該当・security-review 済）** メンシプ（YouTube `NEW_SPONSOR`/`MEMBER_MILESTONE`→`membership`）・
      ギフト（Twitch `sub_gift`/`community_sub_gift`→`gift`）を **`subscription` から種別分離**して受け取るようにした
      （**受信済みフィールドの分類変更のみ**・新規宛先/OAuth スコープ/依存・二層 fail-closed は不変）。分離前はいずれも
      `subscription` に畳まれ集計に入っていたため、`subscription_count`/`is_member`/`last_subscription_at` を
      `event_type IN ('subscription','membership','gift')` で数えて**分離前と同じ集合**を保つ（列追加なし・退行/取りこぼしゼロ）。
      継続月数/ギフト件数/階級（wire の `monthCount`/`giftCount`/`tier`）は表示用途で wire→Rust `CommentViewDto` を通すのみで
      **端末保存しない**（`viewer_comments` スキーマ不変）ため、累計月数は依然 **`is_member`＋イベント回数のみの近似**。
      **投げ銭金額・受贈者名は非ログ・非外部送信**（§9）＝**受贈者名は wire にも Rust DTO にも載せない**（数値属性のみ）。
    - **（043a 拡張・収益種別の網羅／集計項目の変更＝方針⑪該当・security-review 済）** 上記に加えて次を**受信済みイベントの分類**
      として拾う（新規宛先/依存・二層 fail-closed は不変。※Twitch Power-ups のみ **OAuth スコープ `bits:read` を追加**＝上記①/⑦）:
      - **チャリティ・ドネーション**（Twitch `charity_donation`）＝新種別 **`donation`**（実金銭・サブスク/ギフトと分離）。金額は
        既存 monetary 経路（`amount/currency`）で通し、`viewer_comments` に**行単位では保存されるが集計 rollup 列は作らない**
        （§9/⑪ の「列追加なし」を維持・累計は 038 の領分）。**団体名（charity_name）は集計/保存キーに使わず**個人名は持たない（§9）。
      - **有料化**（Twitch `gift_paid_upgrade`/`prime_paid_upgrade`）＝`subscription` に分類（従来 notice_type 未収載で drop していた取りこぼし）。
      - **共有チャット収益**（Twitch `shared_chat_*`）＝接頭辞を剥がして同一分類（取りこぼし防止・数値内訳は shared 経路で undefined 劣化）。
      - **Bits Power-ups**（Twitch `channel.bits.use`）＝既存の bits 表現（`superchat`＋`currency="BITS"`）へ集約。cheer は chat.message で
        取得済のため mapper で二重計上を回避。購読作成は**非致命**（旧トークンは再ログインまで届かない・本線は継続）。
      - **受贈者/贈与者/団体の個人名は wire にも Rust DTO にも載せない・保存しない**（数値属性・金額のみ／§9）。
    - **（043d・YouTube ギフトメンシプ／Jewels の取得＝新規受信面・security-review 済／2026-07-27）** YouTube の
      **メンバーシップギフト（贈与側 `MEMBERSHIP_GIFTING_EVENT`）**と **Jewels（`GIFT_EVENT`）**を受信するよう gRPC proto を拡張した
      （それぞれ `gift` / `jewels` 種別。**新規宛先・新規 OAuth スコープ・新規依存はゼロ**＝既存 `youtube.readonly`・既存 gRPC ストリーム内・
      二層 fail-closed／gRPC チャネルガード `www.googleapis.com:443` のみは不変・リクエストの `part`/`profile_image_size` も不変＝
      追加リクエスト/クォータ影響なし）。
      - **前提の訂正**: 043a 時点で「gRPC proto の内部フィールド番号が非公開」と記録していたが**これは誤り**。`liveChatMessages.streamList` は
        公式メソッドで、Google が `stream_list.proto` の全文（enum 整数値・フィールド番号込み）を公式ガイド
        `https://developers.google.com/youtube/v3/live/streaming-live-chat` にインライン掲載している。**採用した番号はすべて公式出典（推測ゼロ）**。
      - **§9 の担保（受贈者情報を「捨てる」のではなく「受信しない」）**: **受領側 `GIFT_MEMBERSHIP_RECEIVED_EVENT` は取り込まない**
        （1 購入につき受領者数ぶん発火するため贈与側 1 件だけを扱えば二重計上ゼロ）。詳細メッセージ `gift_membership_received_details`（= 32）を
        **proto に宣言しない**ため、`member_level_name` / `gifter_channel_id` / `associated_membership_gifting_message_id` は
        **そもそもデコードされない**。新たに受信するのは**数値属性 2 つのみ**（`gift_memberships_count` / `jewels_amount`）で、
        `gift_memberships_level_name` は不採用。`gift_url`（ギフト画像 URL）は**画像取得＝CSP・§9 の新たな論点を生むため意図的に除外**する
        （採用する場合は 036b/036c の avatar 基盤と同様の allow-list 追加＋data URI 化＋再レビューが必要）。
      - **wire/Rust/binding/集計は不変**（043a で整備済みの語彙に乗るだけ）。`viewer_comments` のスキーマ・rollup 列は増やさず、
        `subscription_count` は既存の `event_type IN ('subscription','membership','gift')` に YouTube ギフトが自然に入る。
        `JEWELS` は `bits_count`（`currency='BITS'`）にも `superchat_count`（`event_type='superchat'`）にも混ざらない。
      - **保存範囲**（レビュー指摘・2026-07-27 で表現を精密化）: **列・保存項目は不変だが、gift/jewels の「行」は新たに増える**
        （＝既存スキーマ上に新イベント種別の行が載るだけで、保存する項目の種類は増えない）。増える値は**数値属性のみ**
        （`gift_memberships_count` / `jewels_amount`）で個人情報を含まないため、§9 追補 038a の「保存範囲の変更」には当たらない。
      - **⚠ 既知の未解決課題（過少計上・043e として起票済み／2026-07-27）**: 公式 proto は `LiveChatMessage.id` に
        「For giftEvents, the same ID may be reused to update the combo count」と明記しており、**`GIFT_EVENT`（Jewels）だけは
        同一 id が combo 更新で再送される**。現行は `combo_count`（= 8）を採らず、Rust の `INSERT OR IGNORE`（`viewer_comments.id`）
        が 2 件目以降を落とすため、**連続ギフトの Jewels が 1 回ぶんしか記録されない**。正しい合計の意味論が公式に明記されておらず
        実データ検証もできないため、**推測での換算は入れない**（043d の「推測ゼロ」原則）。個人情報・外部通信への影響は無く
        セキュリティ境界の問題ではないが、金額の正確性に関わるため記録する。
        **対応**: `docs/tasks/043e-youtube-jewels-combo-fidelity.md`（フェーズ1＝combo 更新を Rust まで到達させ `event_type='jewels'`
        限定で `amount` を差し替える／換算は最新値をそのまま採り**乗算しない**＝過大計上には絶対にならない安全側。
        フェーズ2＝実データで `jewels_amount` が単価と確定したら `× max(combo_count, 1)` を入れて**再度 security-review**）。
        043e は**受信面に `combo_count`（整数のみ・個人情報なし）を足し、`viewer_comments` の既存行 UPDATE を jewels 限定で解禁する**ため
        着手時に security-review を通すこと。
      - **再検討トリガー**: 「誰が受け取ったか」を表示したい要望が出たら、受領側を**集計対象外の新種別**として起票し直し
        **再度 security-review** を通す（`membership` 流用は `subscription_count` が N+1 に膨らむため不可）。
  - **プライバシー**: 第三者の氏名・発言・投げ銭履歴を端末に保存するため、**削除手段**を必須とする＝`delete_viewer`
    （個別・FK CASCADE で当該コメントも削除）／`clear_viewers`（全消去）。**アバター（data URI）は保存しない**
    （アイコンは overlay 意匠のみ・§9）。入力（コメント本文・視聴者名・メモ・session_id）は Rust 側で **trim/制御文字拒否**
    （§8）を通し、SQL は既存流儀の**パラメータバインド**（識別子・ORDER BY 句は定数のみ）。
  - **ログ非露出**: 視聴者本文・メモ・投げ銭履歴を**ログに出さない**（変更系コマンドの error ログは `ErrorCode` 由来の
    固定安全文言のみ・§9）。エラーは既存 `AppError` 経由で DB パス等を露出しない。`session_id` は取得セッション開始時に
    frontend（コメビュ窓）が採番するローカル ID で、端末外へは出さない。

## レビュー必須条件

以下を変更する場合は、必ずセキュリティレビューを行う。

- Tauri capabilities
- shell plugin
- filesystem plugin
- opener plugin
- process起動処理
- process停止処理
- ファイル読み書き処理
- ログ出力処理
- 外部通信
- 自動アップデート
- 設定ファイルのバックアップ・上書き
- ユーザー入力をOS操作に渡す処理
- ログイン項目（autostart / 永続 OS 連携）の登録・解除処理
- らくらくツール設定の外部アプリ連携（**既導入アプリの自動起動**・公式ページ誘導）
- 外部コンテンツの埋め込み（iframe・外部 script/style/image/media・外部ドメインの読込）
- 内蔵コメントビューアの配信サービス連携（**インターネット通信**・**Node sidecar（externalBin）同梱**・OAuth トークン取扱）
- 取得コメント・視聴者情報の端末保存（**視聴者メモリ＝§9 保存ポリシーの限定解禁分**・保存範囲/集計項目/削除手段の変更・「コメントビューア方針」⑪）

### 011 ログイン項目（autostart, 019 時点）

- ログイン項目の登録・解除は公式 `tauri-plugin-autostart`（v2, macOS は LaunchAgent 方式）のみで行い、
  手書きの LaunchAgent plist / レジストリ書込は行わない（§5）。
- ユーザー向けのグローバル ON/OFF は設けず、「`auto_launch_on_boot` フラグ付きプリセットが 1 つ以上
  ⇔ ログイン項目 ON」という不変条件を reconcile（create/update/delete/起動時）で導出する。
  全フラグ解除時は `disable()` により**必ず**解除される（`is_enabled()` でガードし冗長書込を回避）。
- OS がログイン時に起動する際は `--autostart` 引数を渡し、起動時フックはこの引数がある時のみ
  フラグ付きプリセットのツールを自動一括起動する（手動起動では発火しない）。起動処理は既存
  `validate_executable` / 保存済み `executablePath` 経由のみで、新規 spawn 面・shell・外部通信を増やさない。
- capabilities は autostart の 3 permission（`allow-enable` / `allow-disable` / `allow-is-enabled`）のみ。
  なお reconcile は Rust 側 `ManagerExt`（IPC 非経由）で行うため、これら 3 permission は **JS からは未使用**。
  削除すると plugin が ACL 経由の場合に autostart が黙って壊れるリスクがあるため最小構成として保持する
  （`capabilities/default.json` は JSON でコメントを書けないため、保持理由をここに残す）。
- **既知の限界**: アプリをアンインストールした場合、登録済みのログイン項目（macOS の
  `~/Library/LaunchAgents/<identifier>.plist` 等）が OS 側に残留し得る。アンインストーラ側での
  クリーンアップは MVP スコープ外（別途検討）。ユーザーが手動で削除することでも解除できる。
- **プラットフォーム限定（未検証）**: `tauri-plugin-autostart` は OS ごとに登録方式が異なる
  （macOS=LaunchAgent / Windows=レジストリ Run キー / Linux=.desktop）。本開発環境は macOS のため、
  Windows/Linux の autostart 登録経路は `cargo check` でコンパイルされても**実挙動は未検証**
  （動作対象は macOS のみ）。起動時の自動一括起動が再利用する `launch_preset_targets` も
  013 由来のプラットフォーム差（macOS `/usr/bin/open` 縮退）を継承する。

### 021 カスタムタイトルバー（core:window capabilities / frameless）

- Docker Desktop 風に OS ウィンドウ枠へヘッダーを統合するため、`capabilities/default.json` に
  `core:window` の変更系 permission を**ウィンドウ操作に限定**して追加した:
  `allow-start-dragging` / `allow-minimize` / `allow-toggle-maximize` / `allow-close`。
  いずれも自ウィンドウの移動・最小化・最大化・クローズという UI 制御のみで、shell / fs / process / network を
  伴わない（実害の小さい操作）。広い scope（`core:window:default` を超える任意 window 生成等）は追加しない。
- **frontend からの呼び出し面**: `@tauri-apps/api/window` の `getCurrentWindow().minimize()/toggleMaximize()/
  close()`（Windows の自作制御ボタン）と、`data-tauri-drag-region`（両 OS のドラッグ移動）に限定。
  任意 URL/コマンド/パスを渡す口はない。
- **OS 判定コマンド `host_os`**: `std::env::consts::OS` を返すだけの自前コマンド（ユーザー入力なし・固定文字列）。
  タイトルバーの出し分け（macOS=信号機回避の余白 / Windows=制御ボタン表示）にのみ使う。ACL 追加は不要。
- **ウィンドウ枠設定**: macOS は `titleBarStyle="Overlay"`＋`hiddenTitle`＋`trafficLightPosition`（config）で
  ネイティブ信号機を残す。Windows は `lib.rs` setup で `#[cfg(windows)]` 時のみ `set_decorations(false)` で
  フレームレス化する（static config の `decorations` 衝突回避のため実行時に設定）。
- **CSP・外部リソースは不変**（`csp: null` のまま／外部フォント・CSS・CDN・リモート画像を増やさない）。
  新規 npm / crate / plugin の追加なし。
- **プラットフォーム限定（未検証）**: 本開発環境は macOS のため、Windows のフレームレス＋自作制御ボタン経路は
  `cargo check` でコンパイルされても**実挙動は未検証**（動作対象は macOS を主とする。既存 013/019 と同じ扱い）。
  フレームレス Windows の Aero Snap / リサイズ縁 / スナップレイアウトのホバーはネイティブ同等にならない場合がある。

### 028 Windows アイコン抽出（`windows` feature 追加 / unsafe FFI・未検証）

- 018 で `Ok(None)` スタブだった Windows(.exe) の実アイコン抽出を本実装した（`tools/icon.rs::windows`）。
  ユーザー選択済み `.exe` のシェル表示アイコンを **読み取り専用**で取得し、018 と同じ出力仕様
  （`data:` 無し base64 PNG・≤128px・失敗は `Ok(None)`）で返す。frontend / DB / `extract_app_icon` の
  I/F・出力仕様は 018 のまま流用（変更なし）。
- 主経路 `IShellItemImageFactory::GetImage` / フォールバック `SHGetFileInfoW` はいずれもアイコン描画取得のみで、
  **書き込み・削除・外部通信を行わない**。抽出対象は `validate_icon_path`（非空・絶対・実在・非ディレクトリ・
  `.lnk`/`.bat` 拒否）を通過したパスのみで、汎用ファイル読取にはしない（§3/§4/§7）。エラー詳細（フルパス/OS
  エラー）は返さず `Ok(None)` に丸め、ログ追加もしない（§9）。
- 追加依存は `windows` クレートの **feature 追加のみ**（`Win32_UI_Shell` / `Win32_Graphics_Gdi` /
  `Win32_System_Com` / `Win32_Storage_FileSystem`）。新規クレートは増やさず、`image`/`base64` は macOS 限定
  ブロックから共通 `[dependencies]` への**ターゲット再配置**（新規追加ではない）。Cargo.lock 差分なし（§10）。
- ハンドル/COM リーク対策として RAII ガード（`CoUninitialize`/`DestroyIcon`/`DeleteObject`/`ReleaseDC` を Drop）を
  用い、全 early-return 経路で解放する。COM インターフェース Release が `CoUninitialize` より先に走る宣言順にしてある。
  `unsafe` FFI は各呼び出し単位の最小スコープに限定。
- **プラットフォーム限定（未検証）**: 本開発環境は macOS のため `#[cfg(windows)] mod windows` は
  `cargo check` の対象外＝**macOS では未コンパイル・実機未確認**。型・API 名・unsafe FFI は windows 0.58 実ソース
  との**机上整合のみ**で、実コンパイル・実機 E2E・リーク実挙動の確認は 098（Windows ARM64 VM）が初
  （既存 013/019/021 の Windows 経路と同じ扱い）。098 でコンパイルエラー/不具合が出た場合は 098 側で最小修正する。

## 004 Tool Registry時点のレビュー観点

004では、以下を確認する。

- frontendから直接shell実行していない
- frontendから直接ファイル操作していない
- Tool保存処理がRust/Tauri側に寄っている
- Tool入力値をRust側でも検証している
- executablePathを保存するだけで、まだ起動していない
- 同じexecutablePathの重複登録を防いでいる
- 保存先がアプリ管理領域内である
- 外部通信を追加していない
- capabilitiesに不要な強権限を追加していない
- 003 App Shellの見た目を大きく壊していない
