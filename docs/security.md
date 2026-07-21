# Security Policy

## 目的

stream-dock は、ユーザーのPC上で動作し、外部アプリのパスを保存し、将来的にはプロセス起動・停止を行うデスクトップアプリである。

そのため、ユーザーのPCを壊さないこと、意図しないファイル操作やシェル操作を行わないこと、外部通信を勝手に行わないことを最重要方針とする。

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
- **②通信面の封じ込め（最重要の安全論拠）**。インターネットに出るのは sidecar プロセスのみ。main は出ない。
  検証は `lsof -i` で外部 ESTABLISHED ソケットが **sidecar PID 下のみ**に出て StreamDock 本体 PID に出ないことで確認する。
- **③§4（shell）例外**。sidecar 起動/停止は Rust の `app.shell().sidecar()` からのみ。`tauri-plugin-shell` を追加するが
  **capability に `shell:*` はゼロ付与**（IPC を通らない）。frontend に shell 面・raw パス/ポートを出さない。
- **④§9（資格情報）**。OAuth アクセス/リフレッシュトークンは **非ログ・非外部送信**。ログイン永続化のため、
  トークン一式は **Rust 側で OS キーチェーンに保存**し（sidecar は native keyring を持てないため keychain 所有は Rust）、
  sidecar↔Rust の **親子 private pipe のみ**で受け渡す（復元＝stdin `COMMENT_SIDECAR_RESTORE=`、再保存＝stdout の専用行
  `COMMENT_SIDECAR_TOKEN=`／破棄＝`COMMENT_SIDECAR_TOKEN_CLEAR`）。**loopback WS にはトークンを載せない**。device code /
  code verifier は in-memory のみ・非永続。`user_code` / `verification_uri`（非機密）は viewer に**テキスト提示**し、ブラウザ
  shell-out（`open`）はしない。**取得したコメントは画面表示のみ**で、端末外へ出さず Rust の DB / ログにも保存しない。
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
  - **036c（Twitch）**は本基盤（`resolveAvatarDataUri`）を再利用し、Twitch アバター CDN（`*.jtvnw.net`）を同様に追記する（別タスク）。

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

### 098 Windows Build（Windows 前面化 / focus_process / windows クレート / 028 unsafe FFI の実検証・security-review 実施済み）

- Windows 11 ARM64（UTM/QEMU）実機で、これまで未コンパイル・未検証だった Windows 限定コードを **初コンパイル・初 E2E** した:
  前面化（`process/service.rs::mod windows`：`focus_by_pid`/`EnumWindows`/`SetForegroundWindow`/`AttachThreadInput`/
  `CreateToolhelp32Snapshot`）、`focus_process` コマンド、028 アイコン抽出（`tools/icon.rs::mod windows` の unsafe FFI）。
  `cargo check`/`clippy` は **コード修正ゼロで通過**（GDI/COM の型も windows 0.58 で問題なし）。
- **前面化 / focus_process / windows クレート・028 unsafe FFI の security-review を実施し、判定＝問題なし**（修正必須なし）。
  これにより、これまで「未実施」だった前面化まわりの security-review（011/021 の Windows 経路注記・progress.md 既知 TODO）を**解消**する。
  確認事項:
  - `focus_process` は frontend から **launchId のみ**受け取り raw PID / HWND を受けない。前面化対象は **registry 保持の
    自分が起動した PID とその子孫プロセス**に限定し、**プロセス名では他人のウィンドウを探さない**（§6/§2）。
  - registry に無い launchId は前面化せず **新規インスタンスを起動しない**（二重起動を根絶）。
  - ウィンドウ選定は `GetWindowTextLengthW` の**長さ判定のみ**で**タイトル文字列を読まない**。エラーは固定文言・
    フルパス/OS エラー非露出・追加ログなし（§9）。shell 非経由・外部通信/ファイル書込削除なし（§1/§4/§5）。
  - ハンドル/COM 解放: 前面化は `CloseHandle(snapshot)` 実施。028 は RAII ガード（`CoUninitialize`/`DestroyIcon`/
    `DeleteObject`/`ReleaseDC`）が全 early-return・`?` 経路で解放し、COM インターフェース Release → `CoUninitialize` の
    drop 順も正しい。実機の繰り返し登録で不安定化なし＝リーク兆候なしと整合。
  - 追加依存は `windows` クレートの **feature のみ**（新規 crate なし・§10）。`csp:null` 不変・外部リソース非増加（§CSP）。
- **既知の限界（記録のみ・修正不要）**: `collect_process_tree` は PID 再利用時に無関係な PID を子孫集合に含めうる
  （深さ 8 / 件数 1024 で保護）。ただし操作は**前面化のみ（kill しない）**で実害は「無関係なウィンドウが前面に出る」程度・
  低頻度。停止経路（§6）のような exe/start_time 照合の追加は前面化の低リスクに対し過剰なため据え置く。
- **アプリアイコン（icon.ico）**: 098 で Windows 用 `icon.ico` を再生成した（読み取り専用の静的アセット変更のみ・
  OS 操作/通信/権限に影響なし）。macOS の `icon.icns` は不変。`tauri.conf.json` / capabilities は変更なし。

### 032c-c コメントビューア VOICEVOX ローカル合成読み上げ（loopback 50021 例外の（再）定義・security-review 実施済み）

- 032c 方針転換の中核（内蔵コメントビューア × VOICEVOX 直接読み上げ）を実装した。viewer webview から**ローカルの
  VOICEVOX ENGINE**（`http://127.0.0.1:50021`・ループバック）へ `fetch` で GET `/version`（稼働検出）／POST
  `/audio_query`／POST `/synthesis`（合成）を投げ、返る WAV を **Web Audio** でローカル再生する（FIFO 直列 TTS キュー）。
  032c-a で全撤去した loopback 例外を、合成＋ローカル再生に限定して**§1 に（再）定義**した（上記「例外（032c-c…）」）。
- **security-review を実施し、判定＝問題なし**（修正必須なし）。確認事項:
  - **通信はループバック 50021 のみ**: 宛先は `127.0.0.1:50021` に限定（GET /version・POST /audio_query・POST
    /synthesis）。**インターネット通信・Node sidecar・OAuth には一切波及しない**（Twitch/YouTube 取得は 032c-b/-d）。
    合成対象はコメント本文のみ・URL/絵文字を除去してから送る・**著者名は送らない**。text は `encodeURIComponent`／
    `JSON.stringify` で安全に送出。返る WAV は外部送信せずローカル再生のみ。クレジット文中の URL は静的表示で fetch しない。
  - **新規依存ゼロ**: 合成 HTTP と再生は viewer の `fetch`＋Web Audio（Web 標準 API）で行い、Rust に HTTP クライアント・
    音声再生ライブラリ（`reqwest`/`rodio` 等）を追加しない（`Cargo.toml`/`package.json` 不変）。
  - **プロセス起動は管理付き spawn のみ**: ENGINE 起動は薄い新 command `launch_voicevox_engine`（frontend 引数ゼロ）が
    `resolve_tool_for_component`（**登録済みツールを exe 名一致で解決**・Executable 限定・OS 別 `VOICEVOX.app`/
    `VOICEVOX.exe`）→ `process::service::spawn`（`validate_executable`・shell 非経由）＋PID registry 登録
    （`launch_tool` と同経路）で行う。frontend は raw パス/ポートを渡さず**絶対パス直起動しない**・未登録なら誘導のみ
    （`registry()` は空のまま）。§6「停止は自 spawn 起動 PID に限定」と整合。
  - **capability / CSP 不変**: アプリ定義 command は本構成の capability permission に列挙不要のため
    `capabilities/comment-viewer.json`（`core:default`）に per-command 許可を追加していない（viewer からの invoke 可否は
    E2E で確認）。`capabilities/default.json`（main）・`tauri.conf.json`（`csp: null`）に差分なし。CSP 硬化はしない。
  - **binding drift ゼロ**: 新 command は既存 `LaunchResult` を再利用し新規 ts-rs 型ゼロ（`gen:bindings` で 032c-c 由来の
    差分ゼロ）。
- **docs 整理**: §1 に 032c-c の loopback 50021 例外を（再）定義し、らくらく方針節（032c-a 撤去注記）の stale pointer
  「VOICEVOX 直接読み上げの通信方針は 032c-b で定義」を「032c-c で（再）定義した」に修正。新例外は 50021 のみを列挙する
  （棒読み 50001 は撤去済みとして含めない）。

### 032c-b コメントビューア Twitch コメント取得＋Node sidecar 初解禁（StreamDock 初の能動的インターネット通信・security-review 実施済み）

- StreamDock で初めての能動的インターネット通信を、**Twitch allow-list 宛先・ユーザー明示接続時のみ・Node sidecar 封じ込め**
  で初解禁した。osareview の Twitch 経路を distill（vendor）した単一実行ファイル sidecar（`bundle.externalBin`）を **Rust の
  `app.shell().sidecar()` から**起動/停止し、viewer は localhost WS で受信描画する（Device Code ログイン＋EventSub/Helix・TTS 無し）。
- **security-review を実施し、判定＝問題なし**（修正必須なし）。確認事項:
  - **allow-list 二層強制（fail-closed）**: ①env ピン留め（全 base URL を sidecar 内定数に固定・env override 分岐削除・
    Rust から宛先 env を渡さない）②ホストガード（global `fetch` と ws クライアント生成を包み、`{id.twitch.tv, api.twitch.tv,
    eventsub.wss.twitch.tv, *.wss.twitch.tv}` 以外・非 HTTPS/WSS を throw）。ユニットテストで `evil.com`・スキーム不一致・
    サブドメイン偽装（`api.twitch.tv.evil.com`）を全拒否、reconnect `*.wss.twitch.tv` のみ許可を確認。全 fetch/ws 経路
    （Device Code / Helix / EventSub の初回＋reconnect）がガードを通ることを grep で確認。
  - **封じ込め**: インターネットは sidecar プロセスのみ・**main とその Rust command は no-internet 維持**。**Rust は完全同期**
    （tokio/reqwest/websocket crate を足さない・sidecar stdout は別スレッドで `blocking_recv`）。`tauri-plugin-shell` は追加したが
    **capability に `shell:*` ゼロ付与**（IPC 非経由・frontend に shell 面/raw パス/ポートを出さない）。`get_comment_stream_port` は
    読み取り専用・引数なし。no-orphan の 3 段 kill（窓 Destroyed/CloseRequested・RunEvent::Exit 新設・sidecar ppid 監視 self-exit）。
  - **資格情報（§9）**: OAuth アクセス/リフレッシュトークン・device code・code verifier は **in-memory・非ログ・非外部送信**
    （keyring 永続化しない）。診断は stderr（stdout はポート受け渡し専用）。`user_code`/`verification_uri`（非機密）はテキスト提示、
    `open` 廃止。**取得コメントは画面表示のみ**で端末外へ出さず DB/ログにも保存しない。
  - **依存**: `@grpc/grpc-js`/`@grpc/proto-loader`（YouTube 除外）・`@napi-rs/keyring`（in-memory 化）・`open`・`hono`/
    `@hono/node-server`/`zod`・`dotenv` を落とし、bundle・binary の exact 検査で不在を確認。telemetry/analytics 系なし。
  - **capability / CSP 不変**: `capabilities/default.json`（main）・`comment-viewer.json`（`core:default`）・`tauri.conf.json` の
    `csp: null` に差分なし（`bundle.externalBin` 追加のみ）。**binding drift ゼロ**（`check:bindings` に `comment-viewer/bindings` を追加）。
  - **Twitch アプリ Client ID** は Device Code（public client・secret 無し）の**公開**識別子で、sidecar のビルド時に焼き込む
    （ランタイム env/dotenv 不使用・エンドユーザーに露出しない）。ユーザーのログイン/連携はビューア画面からのランタイム操作。
- **後回し（記録のみ）**: loopback WS は未認証で、同一 PC の任意プロセスが制御フレーム送信・`comments.append`/`user_code` 受信し得る
  （token/device_code は WS に流さない・宛先 allow-list 限定のため実害は公開コメント＋非機密 `user_code` の露出に留まる。032c-c の
  ループバックと同レベル）。将来 nonce ハンドシェイクを検討。**実機の封じ込め確認（`lsof` で外部ソケットが sidecar PID 下のみ・
  main no-internet）と実 Twitch E2E は mac GUI（`tauri dev`）で実施**（`TWITCH_CLIENT_ID` 設定後）。
- **docs 整理**: §1 に「例外（032c-b…）」を追加＋032c-c 例外の forward-ref（「Twitch/YouTube は 032c-b/-d で定義」）を
  「Twitch は 032c-b で定義済み・YouTube は 032c-d」に更新。§4（sidecar 例外）・§9（トークン取扱）・§10/Capabilities（tauri-plugin-shell
  権限ゼロ＋externalBin・落とした依存）・レビュー必須条件（本連携）を追記。新章「## コメントビューア（配信サービス連携）方針」を追加。
  `docs/product.md`「MVP でやらないこと」に外部通信の例外を追記。
- **追補（032c-b′・ログイン永続化＝§9 ポリシー変更・⚠ 再 security-review 必要）**: 上記レビュー後、実利用の UX 改善として
  Twitch ログインを **OS キーチェーンに永続化**する変更を追加した（窓の再オープン／アプリ再起動でも再ログイン不要）。これは §9 の
  「in-memory のみ・keyring 永続化しない」を改める**ポリシー変更**なので、**マージ前に security-review を再実施すること**。設計前提:
  - **keychain 所有は Rust 側**（`keyring` crate v3・同期）。sidecar は pure-JS/単一 SEA のまま（native keyring を持ち込まない＝
    封じ込めライフサイクルと SEA 構成・spike-2 禁止依存アサートは不変）。トークンは **sidecar↔Rust の親子 private pipe のみ**を通る
    ＝復元＝Rust→sidecar stdin `COMMENT_SIDECAR_RESTORE=<json>`、更新の再保存＝sidecar→Rust stdout `COMMENT_SIDECAR_TOKEN=<json>`／
    破棄＝`COMMENT_SIDECAR_TOKEN_CLEAR`。Rust はその内容を**ログに出さず keychain のみへ反映**。**loopback WS にはトークンを載せない**
    （従来どおり・device code(秘密) も非送出）。
  - 封じ込め・§1（ユーザー明示接続時のみ通信）・§4（shell 権限ゼロ）・CSP・capability・sidecar 窓ライフサイクルは**不変**
    （token 復元はネットワークを張らず、取得は従来どおり「コメント取得開始」で明示開始）。改訂は §9/§10 のみ（keychain 保存＋private
    pipe を許容・Rust `keyring` 追加）。viewer は `link.state` フレームで「接続済み/未接続」を表示（getLinkStatus・非機密の bool のみ）。
  - **マージ前 GUI 検証（追加）**: 再ログイン不要（窓再オープン／アプリ再起動）・logout/失効で keychain クリア・`lsof`/`app_logs`/
    stdout/stderr に token が出ない（token は private pipe のみ）・macOS Keychain に `stream-dock`/`twitch-comment-viewer` エントリ 1 件。

### 032c-d コメントビューア YouTube コメント取得有効化（OAuth PKCE＋Client Secret 同梱＋gRPC streamList＋クォータ管理・security-review 実施済み）

- 032c-b の Node sidecar 封じ込め基盤の上に **YouTube 宛先を追加解禁**した（新しい通信基盤は作らない）。OAuth 認可コード＋PKCE(S256)＋
  loopback＋Client Secret 同梱でログイン→gRPC `liveChatMessages.streamList` で取得→既存 CommentViewDto パスへ流す。Twitch と併存・各サービス
  個別選択（**当時。035a で同時取得・マージ表示を解禁**＝上記「## コメントビューア（配信サービス連携）方針」を参照）。設計は `docs/tasks/032c-d-youtube-comments.md`。
- **security-review を実施し、判定＝問題なし**（修正必須なし）。確認事項:
  - **allow-list 三面 fail-closed**: (a) env ピン留め＝OAuth endpoint／Data API base URL を sidecar 内定数に固定（`Pinned*ConfigProvider`・
    env override 排除）、(b) fetch ホストガード＝global `fetch` に `oauth2.googleapis.com`（token 交換）／`www.googleapis.com`（REST 検出）を
    追加（`accounts.google.com` はブラウザ側で fetch には入れない）、(c) **gRPC チャネルガード新設**＝gRPC は `fetch`/`ws` を通らないため、
    channel 生成時に target を `www.googleapis.com:443` のみに照合して throw（fetch より狭い allow-list）。ユニットテスト
    （`scripts/test-host-guard.mjs`）で Google 宛先許可・非許可 host/port・サブドメイン偽装（`www.googleapis.com.evil.com`）・Twitch/oauth を
    gRPC target に不可、を全 PASS。
  - **封じ込め**: インターネットは sidecar プロセスのみ・**main は no-internet 維持**（gRPC egress も sidecar のみ）。**Rust は完全同期**
    （async/WS/HTTP crate を足さない・`Cargo.toml` 不変）。同意 URL は sidecar→Rust stdout `COMMENT_SIDECAR_OPEN_URL=` で渡し、
    **Rust が host=accounts.google.com を fail-closed 検証**（http/port/userinfo/サブドメイン偽装を拒否・Rust ユニットテスト2件 PASS）してから
    既存 `tauri-plugin-opener`（IPC 非経由・新規 capability なし）で開く。`open` パッケージは sidecar に足さない。frontend は URL に触れない。
  - **資格情報（§9）**: YouTube の OAuth トークン・PKCE `code_verifier`・**Client Secret** は **in-memory のみ（keyring 永続化しない
    ＝Twitch と対比）**・非ログ・非外部送信（**注: この判定はレビュー時点の設計。032c-d′ で OAuth トークンは Twitch と同様の keychain
    永続化に変更したため、下記「追補（032c-d′…）」を参照し再レビュー対象とする**）。stdout の OPEN_URL 行に載るのは URL の `code_challenge`（S256・非機密）で `code_verifier`・secret は
    載らない。Rust は URL 全体をログに出さず host のみ。取得コメントは画面表示のみで端末外に出さない。ソース grep で token/secret/verifier の
    console 出力ゼロを確認。
  - **Client Secret 同梱の根拠**: Google「Desktop app」OAuth の secret は機密扱いされず抽出前提だが、抽出されても **PKCE＋インストール型
    モデル**で被害限定（上記方針⑧）。Twitch Client ID と同様に esbuild define でビルド時に焼き込む（ランタイム env/dotenv 不使用・
    エンドユーザー非露出）。テスト焼き込みの SEA バイナリは `.gitignore`（未追跡）。
  - **クォータ graceful stop**: REST 403 `quotaExceeded` / gRPC `RESOURCE_EXHAUSTED` を分類し、**再接続せず停止**して viewer に FAILED＋理由を
    通知する（osareview の 1 秒 hot-loop 欠陥を持ち込まない・クラッシュしない）。無料枠 10,000 units/日は `product.md` に記録。
  - **依存**: `@grpc/grpc-js`＋`@grpc/proto-loader`（純 JS・ネイティブアドオン無し）を再導入し SEA 禁止依存アサートから外した
    （`@napi-rs/keyring`/`@hono/node-server`/`dotenv` は引き続き bundle に不在を exact 検査で確認）。`open`/`googleapis`/`node-fetch` は足さない。
  - **proto-under-SEA（スパイク1）＋SEA 再署名（スパイク5）＝PASS**: `stream_list.proto` を文字列同梱→起動時に一時ファイル展開→`loadSync`。
    実 SEA バイナリ起動で `stream_list.proto loadable (spike1 OK)`・`codesign --verify` 通過を確認。proto は非機密スキーマで OS 一時領域への
    scratch 書込のみ（ユーザーデータ・秘密ではない）。
  - **capability / CSP 不変**: `capabilities/{default,comment-viewer}.json`・`tauri.conf.json`（`csp: null`）に差分なし。lib.rs に新規 command なし
    （opener は sidecar stdout リーダースレッドから呼び IPC 非経由）。**binding drift ゼロ**（ts-rs `CommentViewDto` は `source: youtube`・
    eventType 4 種が既存で不変・`check:bindings` PASS）。
- **後回し（記録のみ）**: ①ログイン中の **loopback OAuth コールバックサーバ**（`127.0.0.1:ephemeral`・～180 秒の一時 listener）は未認証だが、
  **ランダム state（CSRF）＋PKCE**で保護（偽 code は matching `code_verifier` 無しに Google 側で交換不可）＝viewer WS と同レベルの localhost
  信頼モデル。②event-type は osareview 準拠で **メンバーシップ（NEW_SPONSOR/MEMBER_MILESTONE）→ subscription に畳む**（Rust の `Membership`
  variant は当面未使用）。③**実機の `lsof` 封じ込め（Google/YouTube＋gRPC egress が sidecar PID 下のみ・main no-internet）と実 YouTube ライブ
  E2E・クォータ unit 会計は、Google「Desktop app」OAuth クライアント焼き込み＋実配信で mac GUI（`tauri dev`）実施**（Twitch 032c-b と同様）。
- **docs 整理**: §1 に「例外（032c-d…）」追加＋032c-c/032c-b の forward-ref を「定義済み」に更新、§4（Rust opener で host 検証）・§9（YouTube
  トークン in-memory）・§10/コメントビューア方針①④拡張＋新規⑧（Client Secret 根拠・consent 運用・クォータ）を追記。`product.md` にクォータ記録、
  `task-board.md`/`progress.md` 更新。
- **追補（032c-d′・YouTube ログイン永続化＝§9 ポリシー変更・⚠ 再 security-review 必要）**: 上記レビュー後、UX を Twitch と完全に揃える
  ため、**YouTube ログインも OS キーチェーンに永続化**する変更を追加した（コメントビューア窓の再オープン／アプリ再起動でも再ログイン不要）。
  これは §9 の「YouTube は in-memory のみ・keyring 非永続」を改める**ポリシー変更**なので、**マージ前に security-review を再実施すること**。
  設計前提（032c-b′ の Twitch 永続化と同型に一般化・新しい通信/依存は増やさない）:
  - 既存の Twitch 永続化パイプ（sidecar↔Rust の親子 private pipe）を **provider 対応に一般化**した。`PersistingTokenStore` が
    twitch/youtube 双方の save/clear を **provider 付き**で通知し、stdout 専用行 `COMMENT_SIDECAR_TOKEN=<provider> <json>` /
    `..._TOKEN_CLEAR=<provider>`、復元は stdin `COMMENT_SIDECAR_RESTORE=<provider> <json>`。sidecar は不正/未知 provider を復元しない。
  - **keychain 所有は Rust 側**（`keyring` crate・同期・`Cargo.toml`/`Cargo.lock` 差分ゼロ＝新規 crate なし）。account は provider 別
    （`twitch-comment-viewer` / `youtube-comment-viewer`）。未知 provider は `account_for` が `None`＝保存/読取しない（fail-closed）。
  - **永続対象は OAuth トークン一式（TokenSetPlain＝access/refresh/expiry/scope）のみ**。`code_verifier`（一時値）・`Client Secret`（焼き込み）
    は **引き続き非永続**（TokenSetPlain に含まれない）。token は viewer WS に載せず private pipe のみ・非ログ（§9 不変）。封じ込め・§1・§4・
    capability・CSP（`csp:null`）・binding は不変。
  - **留意**: consent 画面が「テスト」モードだと YouTube refresh_token は 7 日失効するため、保存していても 7 日後は復元失敗→再ログイン
    （graceful）。恒久保持には consent 画面の本番公開が要る（運用前提）。macOS の keychain アクセスは **署名済み配布（Developer ID＋
    notarization）で無音**（未署名 dev ビルドはリビルドのたびに確認ダイアログが出る＝署名で解消）。
  - **マージ前 GUI 検証**: YouTube 再ログイン不要（窓再オープン／アプリ再起動）・logout/失効で keychain クリア・`lsof`/`app_logs`/stdout/stderr に
    token 非露出（token は private pipe のみ）・macOS Keychain に `stream-dock`/`youtube-comment-viewer` エントリ 1 件。
- **追補（032c-d″・YouTube 取得の継続性修正＋観測性・宛先/依存/capability 不変）**: 実ライブ検証で「取得開始→数秒で待機・コメント取得できず」を
  修正した。原因は (1) 配信終了監視 `monitorLiveStreamEnd` が YouTube を `search.list`（100 units・eventual consistency）で 5 秒ごとに再検出し、
  生存中でも null が返って誤って「配信終了」→ IDLE、かつクォータを急速消費（~1,200 units/分）、(2) `retryOnStreamEnd` を開始時再検出フラグに束ねて
  false 固定していたため gRPC streamList が最初に閉じた時点で自然完了 IDLE に落ちていた。修正内容:
  - **監視を `videos.list`（by-id・1 unit・整合的）＋連続 miss 閾値(3) に置換**（YouTube のみ・Twitch は Helix `/streams` のまま不変）。宛先は
    `www.googleapis.com`（**既存 allow-list 内・新規宛先ゼロ**）。クォータ消費を ~1,200 units/分 → ~12 units/分に低減（product.md の「枯渇時 graceful stop」と整合）。
  - **YouTube は `retryOnStreamEnd=true`（開始時再検出とは独立）** で nextPageToken 再接続し継続取得。配信終了は監視が有限回（≤3×5s）で確定し停止。
  - **観測性（§9・ログ出力処理）**: 従来 Rust reader が握りつぶしていた **sidecar stderr を Rust の stderr（`tauri dev` 端末）へ透過**する（取得失敗の
    原因が見えるように）。**token/secret は §9 で stderr に載せない設計のため露出せず**、外部送信・DB 保存はせず**ローカル端末出力のみ**。配信終了 IDLE に
    固定文言の理由（「配信の終了を検知しました。」）を付与。**新規依存・capability・CSP（`csp:null`）・Cargo は不変**。
- **追補（032c-d‴・クォータ大幅削減：検出の liveBroadcasts 化＋監視の silence-gated 化・宛先/スコープ/capability 不変）**: 「消費しすぎ」への対応。
  - **検出を `search.list`（100 units・検索インデックス遅延）→ `liveBroadcasts.list`（`broadcastStatus=active`・1 unit・配信管理APIで即時整合）に置換**。
    id/liveChatId/title が 1 コールで揃うため従来の `videos.list` 追い打ちも不要。宛先 `www.googleapis.com`（**既存 allow-list 内・新規宛先ゼロ**）、
    スコープは `youtube.readonly` のまま（`liveBroadcasts.list` 読取は同スコープで許可＝**再同意不要**）。
  - **配信終了監視を silence-gated（無言監視）に再設計**: コメントが流れている間（直近受信から 90s 未満）は `videos.list` を**一切叩かない**
    （＝活発な配信ではクォータ消費ゼロ）。コメントが途切れた時だけ 45s ごとに `videos.list`（1 unit・`activeLiveChatId` は権威情報）で生存確認し、
    連続 2 miss で終了確定。壁時計で回るため gRPC がハートビートで開いたままでも終了を必ず検知できる（"切断時だけ確認" 方式は「接続中のまま
    止まらない」危険があるため採らない）。一時エラーは inconclusive（miss に数えず継続＝誤終了防止）。**取得ループ(usecase)・`retryOnStreamEnd`・
    型・Twitch 経路・capability・CSP・Cargo は不変**。
  - **消費**: 活発な配信の監視分を ~360 units/3h → **実質 ~0** に低減（検出は 100→1）。コメント本体 gRPC streamList は未実測（実配信で Cloud Console 実測予定）。

### 032c-a らくらくツール設定 032b（棒読み×VOICEVOX）撤去（ループバック通信 / 外部設定書換 / `ureq` / SAPI レジストリ読取の削除・security-review 実施済み）

- 032c 方針転換（内蔵コメントビューア × VOICEVOX 直接読み上げ）に伴い、032b で追加した棒読みちゃん×VOICEVOX
  連携の**棒読み/SAPI 依存部分**を撤去した。削除対象: `rakuraku/integrations/bouyomi_voicevox.rs` 全体
  （`#[cfg(windows)] mod imp`）／`Integration` trait の `configure`/`verify` メソッド／`rakuraku_configure_integration`・
  `rakuraku_verify_integration` コマンドと `lib.rs` 登録／`ConfigureResult`/`VerifyResult` 系 model・TS binding／
  `Cargo.toml` の `ureq` 依存・`windows` feature `Win32_System_Registry`。frontend 側は `integrationRegistry` の唯一の
  エントリ・`rakurakuApi` の configure/verify ラッパ・ExecutionView の設定書換/疎通経路を撤去。
- **security-review を実施し、判定＝問題なし**（修正必須なし・攻撃面は縮小方向）。確認事項:
  - **外部通信の限定解禁を全撤去**: `ureq`（`127.0.0.1:50021`）・`std::net::TcpStream`（`127.0.0.1:50001`）の利用箇所は
    `bouyomi_voicevox.rs` のみで、同ファイル削除後は残らない（grep で他用途ゼロを確認）。§1（外部通信をしない）の
    一般原則へ復帰。**本タスクでは外部通信の新規解禁は追記しない**（VOICEVOX 直接読み上げの通信方針は 032c-b）。
  - **外部設定書換の限定解禁を撤去**: 棒読みちゃん設定ファイルの書換（バックアップ先取り）経路を削除。§5（外部設定を
    上書きしない）の一般原則へ復帰。app 管理領域外への書込は行わない。
  - **レジストリ読取を撤去**: SAPI トークン列挙（`Win32_System_Registry`・`RegOpenKeyExW`/`RegEnumKeyExW`）の利用は
    `bouyomi_voicevox.rs` のみで、削除後に未使用（grep 確認）。`Cargo.toml` から feature を外した。
  - **capability / CSP 不変**: `capabilities/default.json` / `tauri.conf.json`（`csp: null`）に差分なし。新規 command は
    追加せず、`rakuraku_*` は 2 本削減（scan / launch / open_official_page の 3 本は温存）。
  - **温存した共有部**: らくらく画面シェル（一覧/詳細/同意/実行の器）・`rakuraku_launch_component`（登録済み exe を
    管理付き `spawn`＋PID registry で起動）・`rakuraku_open_official_page`・`resolve_tool_for_component`。これらの
    セキュリティ方針は上記「らくらくツール設定（外部アプリ連携）方針」に集約済み（撤去で挙動は変わらない）。撤去後
    `registry()` は空で、`find` は常に `NotFound` を返す（空でもらくらく画面はクラッシュしない）。
  - **binding drift ゼロ**: 削除した Rust 型の残骸 TS（`ConfigureResult.ts`/`ConfigureStatus.ts`/`VerifyResult.ts`/
    `VerifyStatus.ts`）を手動削除し、`gen:bindings` 再実行で差分ゼロを確認。
- **docs 整理**: 本 security.md の §1/§5 の 032b 例外・らくらく方針節・032b 系レビュー記録、`docs/product.md` の
  棒読み/SAPI 例外を、撤去に合わせて整理（撤去/整理のみで外部通信の新規解禁追記は含まない）。

### 032 追加対応 らくらくツール設定 詳細画面（YouTube デモ動画 iframe 埋め込み / 非対応 OS ガード・security-review 実施済み）

- 詳細画面のデモ動画を **YouTube（youtube-nocookie）iframe でインライン埋め込み**（アプリ同梱による容量増を避けるため）。
  非対応 OS では「確認画面に進む」を無効化＋小さめ赤文字「(このOSでは利用できません)」を表示。**frontend のみ**
  （registry＋screen＋css）・Rust/Cargo/capabilities/`tauri.conf.json`（`csp: null`）不変。詳細は上記 CSP方針の「例外」を参照。
- **security-review を実施し、判定＝問題なし**（修正必須なし）。確認済み: youtube-nocookie＋`rel=0`（Cookie/関連動画抑制・
  telemetry 追加なし）／動画 ID は frontend 定数を `^[A-Za-z0-9_-]{11}$` でガードしてから src を組み立て（URL/属性の
  ブレイクアウト不可・未設定/不正は「準備中」フォールバック）／iframe 属性は最小・安全側（`allow` は
  encrypted-media/fullscreen/picture-in-picture のみ・`referrerpolicy=strict-origin-when-cross-origin`・`loading=lazy`・`title`）／
  クロスオリジン外部フレームで Tauri IPC 非接触・新規依存/command/capability なし・`csp:null` 不変／OS ガードは UI のみで多重防御。
- **留意点（動画 ID 設定後に `tauri dev` で確認）**: 現状 `demoVideoId` 未設定のため外部通信は未発生。実 ID 設定後、
  ① インライン再生 ② フレーム内操作でアプリウィンドウが外部 URL へ遷移/想定外ポップアップしないこと を確認する。
  top-navigation/popups が起きる場合は `sandbox="allow-scripts allow-same-origin allow-presentation"`（top-nav/popups 非付与）を
  追加し再生維持を確認する。将来 CSP を効かせる際は `frame-src https://www.youtube-nocookie.com`（＋派生ドメイン）が必要。

### 033f コメントビューア OBS 透過オーバーレイ窓（新規 per-window capability＋`macos-private-api` feature・security-review 実施済み）

- コメント一覧を OBS の「ウィンドウキャプチャ」へ載せるため、背景透過のオーバーレイ窓（label `comment-overlay`）を
  ワンクリックで開く機能を追加した（親 033・問題 9）。obs-websocket は不採用（新規 localhost 接続面を作らない）。
  データ源は**既存の loopback sidecar WS（`ws://127.0.0.1:<port>`）の読み取り専用接続のみ**で、**新規外部通信ゼロ・新規依存ゼロ**。
- **security-review を実施し、判定＝問題なし**（修正必須なし）。確認事項:
  - **新規外部通信ゼロ・読み取り専用**: `OverlayApp` は `connectCommentStream({ onComments })` のみで制御フレーム
    （start-login / start-session / stop-session）を一切送らない＝送信フレームゼロ。外部 http(s)/WS 宛先の新規追加なし。
    **main とその Rust command は no-internet 維持**（§1／方針②）。新通信面を作らないため security.md 本体への §1 例外追記は不要。
  - **capability 最小・main/comment-viewer 不変**: 新設 `capabilities/comment-overlay.json` は `core:default` のみ＋
    `windows:["comment-overlay"]` に scope 限定。`default.json`（`windows:["main"]`）・`comment-viewer.json` は差分ゼロで、
    overlay 窓は main の `core:window`（close/minimize 等）/dialog/autostart 権限を継承しない。アプリ定義 command
    （`open/close_comment_overlay_window`・引数は `AppHandle` のみ・固定ラベル/固定オプション）は本構成では ACL 列挙不要。
  - **プロセス/no-orphan kill 不変（§6）**: overlay は表示専用で sidecar を起動/停止しない（`ensure_started` 無し・
    窓イベント登録無し・close で `shutdown` 連動無し）。PID kill・プロセス名 kill なし。sidecar 起動/停止契機は
    コメビュ窓（`open_comment_viewer_window` の窓イベント／`RunEvent::Exit`）に集約のまま。
  - **依存（§10）・CSP 不変**: 新規 crate/npm/plugin ゼロ。透過描画のため既存 `tauri` crate に **`macos-private-api`
    feature を追加**（新規 crate ではなく feature 追加＝028 の `windows` feature と同型）＋`tauri.conf.json` に
    `app.macOSPrivateApi: true`。`csp: null` 不変・外部 script/style/image 非増加。透過 CSS は overlay 窓の document
    （`data-overlay="1"`）にだけ効き main/comment-viewer に波及しない。
  - **MAS 配布不可の受容**: macOS 私的 API 使用のため Mac App Store 配布不可になるが、本アプリは .app/.dmg 直配布で
    MAS 経路が無いため受容（IPC/権限/ネットワークの攻撃面は増えず、透過描画に閉じる）。`background_throttling(Disabled)`
    は webview の描画/タイマー スケジューリング設定のみで通信/権限/プロセスに触れない（macOS14+ のみ有効・Windows/Linux は no-op）。
  - **binding drift ゼロ**: 追加 command は引数 `AppHandle`・戻り `AppResult<()>` で新規 ts-rs 型なし（`check:bindings` 32 passed）。
- **後回し（記録のみ）**: overlay を開くと sidecar への loopback WS 接続が 1 本増える（コメビュ本体に加えて）が、
  sidecar は全クライアントへ同報するだけで overlay は読み取り専用購読＝本体セッションに影響せず、close/unmount で
  `disconnect()` される（032c-b の loopback WS と同レベルの localhost 信頼モデル）。**実機（macOS 14.6.1）で `lsof -i` の
  外部 ESTABLISHED が sidecar PID 下のみ・overlay/main に出ないこと、OBS ウィンドウキャプチャの透過ライブ合成を目視**（`tauri dev`）。

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
