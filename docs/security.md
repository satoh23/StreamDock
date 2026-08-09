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

**追補（049・課金イベントの読み上げに投稿者名を含める・2026-07-31）**: 上記の「合成対象はコメント本文のみ・
**著者名は送らない**」を、**課金イベント（membership / gift / subscription / jewels）に限り**改める。これらは
`text` が空（要約文言は 043b 以降**表示側**が組み立てる）で ⑤ 空判定に落ち**完全に無音**だったため、表示と同じ
「〇〇さんが〜」の要約を読み上げる＝**投稿者の表示名が合成テキストに含まれる**。

- **宛先・API・依存・capability・CSP はいずれも不変**＝既存のループバック `127.0.0.1:50021` への
  `POST /audio_query` / `POST /synthesis` のみ。新規宛先・新規 command・新規依存・新規 capability はゼロ、
  `csp: null` 不変（Rust / sidecar / `package.json` / `pnpm-lock.yaml` は差分ゼロを実測）。
- **端末外へ出さない・保存しない・ログに出さない**。文言は frontend の純関数
  （`screens/comment-viewer/speechText.ts` の `composeSpeechText`）が組み立て、`ttsQueue` のメモリ上キューを経て
  `synthesize` にのみ渡る。DB（`viewer_comments`）・localStorage・`invoke`・オーバーレイのいずれにも渡らず、
  `console.debug` に出るのは**破棄件数と事象名だけ**（読み上げ文言・投稿者名・合成 URL は出さない・§9）。
  **046a の「端末保存」追補には該当しない**（永続化しない）。
  - **記述の訂正（050 レビュー・2026-07-31）**: 当初ここは「`console.debug` に出るのは**破棄件数**だけ」と
    書いていたが、050 が再生ストール検知のログ（**事象名のみ**・件数ではない）を 1 行足したため、
    上記の表現へ改めた。**§9 の実質（本文・投稿者名・URL を出さない）は不変**で、条文の緩和ではない
    （`voicevox.ts` はログ 0 行のまま／`ttsQueue.ts` は事象名と件数のみ／実行時テストで固定済み）。
- **通常チャット・スパチャ・ビッツ・ドネーションは従来どおり本文のみ**（著者名を送らない）＝方針そのものは
  変えていない。受贈者名は 043d 決定1 でそもそも受信していないので読み上げ対象になり得ない。
- URL/絵文字除去（`sanitizeForSpeech`）・読み替え辞書（041a）・文字数上限（048）は**投稿者名にも等しく適用**
  される（041a の内蔵辞書が英字始まりの表示名を書き換える既知の副作用は `speechText.ts` の JSDoc と
  `docs/progress.md` の 049 節に記録した）。
- **条文の変更に当たるため security-review 必須**（本追補は 049 のレビュー指摘 S-1 で追加した。frontend のみ・
  新規宛先ゼロでも、**既存例外の「何を送るか」を変える**なら「レビュー必須条件」の外部通信に該当する）。

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

**取得の停止条件（⚠⚠ 061b で変わった。032c-d の YouTube 取得にも等しく適用する）**:
この例外は「いつ始まるか」（＝ユーザーの明示接続）だけでなく、**「いつ終わるか」でも範囲が決まる**。

- 取得セッションが止まるのは次の 2 つだけ: ①ユーザーの明示操作（`stop-session`）
  ②**sidecar プロセスの停止**（＝`comment-viewer` と `effect-overlay` の**どちらも無くなったとき**／アプリ終了。
  詳細は下記「Tauri Permissions / Capabilities 方針」の 061a 節「sidecar の停止条件」）。
  **WS クライアント（窓）が 0 になっても取得は止まらない**——sidecar 側は接続数を見ていない。
- ⚠⚠ **061b 以前は「コメビュ窓を閉じる＝sidecar を kill＝取得が必ず止まる」だったが、いまは同値ではない。**
  **エフェクト窓が開いている間はコメビュ窓を閉じても取得（インターネット通信）が続く。** これは
  「一度取得を開始すればコメビュ窓を閉じてもエフェクトが出続ける」という 061b の仕様の裏返しであり、意図した挙動。
- ⚠⚠ **だからこそ「取得が続いていること」と「その止め方」をユーザーへ明示する導線を必ず保つこと。**
  取得中であることを示す UI はコメビュ窓にしかなく、`close_comment_viewer_window`（＝ツール管理の「停止」ボタン）は
  **窓を閉じるだけで、それ自体は取得を止めない**（`stop-session` を送らない）。
  ⚠ **このボタンで取得が止まるのは「その close で sidecar が落ちるとき」＝エフェクト窓も無いときだけ**で、
  エフェクト窓が開いていれば取得は続く（条件付きであることを落とさずに書くこと。無条件に「取得は止めない」と
  書くと、エフェクト窓を使っていないユーザーにとって嘘になり、`ObsEffectsScreen` の案内文とも矛盾する）。
  明示は `ObsEffectsScreen` の前提案内と、ツール管理の停止フィードバック文言（`MainScreen` が
  `is_effect_overlay_open` を見て分岐する）が担う。
  ⚠ **この導線を消す／`SIDECAR_CONSUMER_LABELS` に窓を足して sidecar をさらに延命する変更は、
  「ユーザーが知らないうちに外部通信が続く」を広げる方向なので本例外の再評価が必要**（レビュー必須条件の「外部通信」）。

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
  main no-internet 不変）。OBS へは**オーバーレイ窓ごとにソースを作り**（`CreateInput`(`window_capture`) / 既存なら再利用）、その
  **作成/再利用したソースの表示・非表示を切り替える**（`SetSceneItemEnabled`＝オーバーレイ表示 OFF で非表示・**削除はしない**）だけで、
  コメント取得・配信はしない。**新規外部宛先・新規依存はゼロ**（同一 loopback WS 上の OBS 制御に限る）。
  検証は `lsof -i` で 4455 接続が sidecar PID 下のみ・外部 ESTABLISHED が増えないことで確認する。
  - **046d（2026-07-29・自動追加の対象を 2 ソースへ拡張）**: 当初は「StreamDock コメントオーバーレイ」1 ソースのみだったが、
    **固定コメント専用オーバーレイ（窓 `pinned-overlay`・ソース名「StreamDock 固定コメント」）も自動追加の対象**にした。
    046/046b は「将来タスク」として先送りしていただけで技術的な障害は無く、依頼者の指示で解禁したもの。
    **宛先・プロトコル・依存はいずれも不変**（同じ `ws://127.0.0.1:4455`・同じ obs-websocket 呼び出し・新規 npm ゼロ）で、
    差分は「OBS のシーンに作られるソースが最大 2 つになる」点のみ。
    **対象は viewer から名前で指定させない**: 制御フレームに載るのは `overlay: "comments" | "pinned"` の
    **固定 union だけ**で、実際のソース名・キャプチャ窓名は sidecar 内の表（`OBS_OVERLAYS`）に閉じている
    （allow-list 方式＝未知値は `"comments"` へ劣化。§3/§8「ユーザー入力が OS/外部アプリ操作へ渡る経路を作らない」を維持）。
    接続契機も不変＝**「OBSに自動で反映する」が ON のときだけ**で、OFF なら固定オーバーレイを開いても OBS へは繋がない（045c の線引き）。
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

### 例外（055・アプリ自己アップデート＝StreamDock 本体プロセス初のインターネット egress）

上記「外部通信をしない」原則に対し、**StreamDock 自身のアップデート確認・取得に限り**、public リリースリポジトリ
（`satoh23/StreamDock-releases`）へのインターネット通信を例外的に許可する。§1 が「許可する可能性があるもの」として
既に**「将来的なアップデート確認」**を挙げていたものを実装するもの。**これは Tauri 本体プロセスが初めて
インターネットに出る例外**である（従来 egress はすべて Node sidecar 側に集約され `host-guard.ts` の fail-closed
allow-list で守られていた）。方式決定・分割は `docs/tasks/055-app-self-update.md` を正とする
（配布側 055a ／ 検出 055b ／ DL・インストール 055d）。

- **宛先は 2 ホストのみ・GET のみ・送信するアプリ側データはゼロ**＝
  `github.com`（`…/releases/latest/download/latest.json`・302）→ `objects.githubusercontent.com`（実体）。
  リクエストボディなし・Cookie なし・認証なし。**`api.github.com` は使わない**。
- **宛先は `tauri.conf.json` の `plugins.updater.endpoints` というコンパイル時定数**で、
  **実行時にもフロントからも差し替えない**（`UpdaterBuilder::endpoints()` を呼ばない。
  `app_update/commands.rs` の `#[cfg(test)] mod command_contract` で機械的に固定。
  ⚠ 055d でこのモジュールは `check_command_contract` から改名した——`install_app_update` / `restart_app` も
  同じファイルに置いて、`include_str!` による既存 3 本の検査を追加コードにも効かせているため）。
  `{{current_version}}` 等の動的プレースホルダを URL に埋めない＝**バージョンを外部へ送らない**。
  コマンドは `AppHandle` のみを取り、**frontend から URL もバージョンも受け取らない**（§3/§8）。
  送るヘッダは `Accept: application/json` と plugin 自身の User-Agent（`tauri-plugin-updater/<crate version>`）だけで、
  アプリ名もアプリバージョンも載らない（実測確認済み）。
  ⚠ **不変なのは URL であって「経路」ではない**（レビュー指摘・055b）。`tauri-plugin-updater` は
  `UpdaterBuilder::no_proxy()` を呼んでおらず、reqwest は既定で**システムプロキシ環境変数を尊重する**
  （`auto_sys_proxy: true`）＝`HTTPS_PROXY` / `ALL_PROXY` 等でパケットの経路は変えられる。
  ただし TLS 検証（`dangerousAcceptInvalidCerts` 不使用・release ビルドでは非 https の endpoint を拒否）と
  minisign fail-closed が効くので、**経路上での改竄・盗聴は成立しない**。`no_proxy()` で塞ぐ選択もあるが、
  **企業プロキシ配下で更新できなくなる**ので採らない。
  ⚠ **固定されているのは check の宛先だけ**（レビュー指摘・055d）。**実体の DL 先は
  `latest.json` の `platforms.*.url`＝未署名データが決める**（plugin の `Update.download_url`）。
  上の「宛先は 2 ホストのみ」は**現在の観測事実であって強制ではない**。実体の完全性は minisign が守るが、
  **どこへ取りに行くかは署名で守られていない**。前提が「GitHub 侵害または `latest.json` の改竄」で、
  その前提なら endpoint 自体も差し替えられるため**リスクは増えていない**が、
  「endpoint が定数だから DL 先も固定」と読み違えないこと。
- **完全性は minisign 公開鍵検証で fail-closed**（`plugins.updater.pubkey`＝コンパイル時に焼き込まれる公開値）。
  署名が合わないものは実行しない。⚠ ただし**署名が守るのはダウンロードした実体のバイト列だけ**で、
  **`latest.json` 自体は署名されていない**。＝`version` / `notes` / `pub_date` は HTTPS で守られるだけの
  未署名データなので、**表示側（055c / 055e）はこれらを HTML として解釈しない**
  （055e が `dangerouslySetInnerHTML` を使わず自前の最小マークダウンレンダラを書く決定はここで意味を持つ）。
- **チェックは起動時に自動・既定 ON 固定で、ユーザーが止める手段は設けない（本人の決定）**。
  ＝**外部通信を止める手段をユーザー側に残さない**選択であることを明記して残す（055c で起動時フックを付ける）。
- **§9**: 更新経路のログに **URL・ローカルパス・環境情報を出さない**。出してよいのはバージョン文字列と成否のみ。
  ⚠ `tauri-plugin-updater` / reqwest の**生エラー文字列はエンドポイント URL を含む**
  （`Error::Reqwest` が `#[error(transparent)]` で、reqwest の Display が `error sending request for url (…)`）。
  そのため `AppError.message` には固定の安全文言だけを載せ、**エラー値は `map_err(|_| …)` で束縛せずに捨てる**
  （`From<rusqlite::Error>` が生の DB エラー文字列を落としているのと同じ扱い。契約テストで固定）。
  更新の成否は **SQLite / app_logs に記録しない**（新規の保存経路を作らない）。
  ⚠ plugin 内部に `log::debug!("checking for updates {url}")` があるが、本アプリは `log` の実装
  （`tauri-plugin-log` / `env_logger`）を 1 つも登録していないため実行時は出力されない。
  **将来ロガーを入れるとこの 1 行で URL が出るようになる**ので、そのときは併せて塞ぐこと。
- **ハング対策（panic と同じ事故を起こす経路）**: reqwest は既定でタイムアウトを持たない。
  ネットワークが「切断」ではなく**「繋がるが応答しない」**（キャプティブポータル・パケット落ち）状態では
  `check()` が返らず、055c の UI が「確認中」から永久に戻らない——**panic を全部潰しても同じ症状になる**。
  そのため `UpdaterBuilder::timeout()` で上限（**15 秒**）を課す（`endpoints` には触らない）。
  ⚠ **この値は `download()` には伝播しない**（レビュー指摘で訂正・当初は逆に書いていた）。plugin の
  `Updater::check()` は戻り値を `Update { timeout: None, .. }` と**ハードコード**して組み立てるため、
  **DL 側は既定で無期限**。＝055d の課題は「15 秒を引き継がせないこと」ではなく**DL に別途上限を張ること**で、
  総リクエスト時間ではなく `configure_client` の `connect_timeout` + `read_timeout` を使うこと
  （サイズが事前に分からない転送には総 deadline を張れないため）。
- **応答ボディにサイズ上限が無い（受容した制約）**: `check()` は `res.json()` でボディ全体をメモリに読む。
  plugin にもこちらにも上限は無く、実質の歯止めは上記 15 秒で流し込める量だけ。前提が「GitHub 侵害または
  有効証明書を持つ MITM」で、かつ plugin を fork しない限り塞げないため受容する。表示側の長さ制御は 055c の領分。
- **sidecar の fail-closed ホストガードには寄せない**。理由: ①sidecar はコメビュ窓を開いている間しか生きておらず、
  更新チェックの契機（起動時）に存在しない ②インストールは Tauri プロセス側でしかできず、
  **plugin 内部の reqwest は sidecar のホストガードを一切通らない**＝寄せても「守られているつもり」になるだけ
  ③032c-a で切ったメイン窓⇄sidecar の依存が復活する。代わりにこの経路は
  **コンパイル時定数の単一 endpoint ＋ minisign fail-closed** で担保する。
- **capability 差分ゼロ・`csp: null` 不変・JS 側 plugin ゼロ**（下記「Tauri Permissions / Capabilities 方針」の 055b 節）。
  telemetry / analytics / crash-report は追加しない。
- **security-review 必須**（本体プロセス初のインターネット egress ＋ network/http crate ＋ auto update 系）。
  ※ **§5 の例外（アップデータが自分自身の `.app` / インストール先を置換する＝管理領域外への書き込み）は
  055d で追記済み**（055b は検出のみでファイルを 1 バイトも書かない）。
  §4 の「例外（055d・macOS の昇格インストール経路＝`osakit` / AppleScript）」も併せて参照すること。
  ※ **055d で DL 側にもタイムアウトを張った**（`configure_client` の `connect_timeout` 15 秒 /
  `read_timeout` 30 秒）。上の「⚠ この値は `download()` には伝播しない」への対処にあたる。
  ※ **055d で進捗イベント（`app-update:progress`）を導入したが capability は不変**。
  frontend の `listen` に必要な `core:event:allow-listen` は `core:default` に既に含まれている
  （下記「Tauri Permissions / Capabilities 方針」の 055d 節）。

### 例外（060c・カスタム CSS テーマの外部 `@import` 取り込み時スナップショット）

上記「外部通信をしない」原則、および「CDN からの script/css/image 読み込み」の禁止に対し、
**カスタム CSS テーマの取り込み時に限り**、ユーザーが**そのつど明示同意した 1 つの HTTPS URL**へ
sidecar が 1 回だけ GET することを例外的に許可する（要望③・`docs/tasks/060c-external-css-snapshot.md`）。
取得した CSS は**その場でインライン展開して保存**し、**以後の実行時は一切通信しない**（スナップショット）。

- ⚠⚠ **本例外は既存 7 例外と決定的に違い、宛先を allow-list で固定できない。** 宛先はユーザーが持ち込んだ
  CSS に書かれた URL であり、同じサイトでも意匠ごとにファイルが違う（実サンプルは `midashi1Comment.css` /
  `twmidashi1Comment.css` / `fukidashiComment.css`）。**固定の代わりに次の 2 本で担保する**:
  ① **取得のたびにユーザーが完全な URL とホストを目で見て同意する**（下記）
  ② **取得できる形を極端に狭める**（下記の専用ガード）
- **専用ガード `assertAllowedThemeImportUrl`（`host-guard.ts`）**——既存 allow-list とは**分離**し、
  ここにホストを 1 つも追加しない。`https:` のみ／userinfo 無し／**既定ポート（443）のみ**／
  クエリ・フラグメント無し／パスが `.css` 終端／**IP リテラル拒否**／**単一ラベルのホスト名拒否**／
  `localhost` `*.local` `*.localhost` `*.internal` `*.home.arpa` `*.localdomain` 拒否／
  **プライベート・loopback・link-local・`169.254.169.254`・`metadata.google.internal`・`metadata.goog`
  拒否**／**末尾ドットを（1 個ではなく）全部剥いてから判定し、空ラベルを含むホストを拒否**。
  ⚠⚠ **末尾ドットは「全部」であることが要件**（security-review 060c S-1・実測）。1 個だけ剥がす実装だと
  `https://evil.local../a.css`・`https://localhost../a.css`・`https://metadata.google.internal../a.css` が
  **サフィックス判定を素通りする**。⚠ 空ラベル（`a..b` / `.a.b`）の拒否も**形の段階で**行うこと——
  空ラベルを解決するかはリゾルバ実装依存（macOS の `getaddrinfo` は `ENOTFOUND`・実測）なので、
  DNS 事前解決検査に判定を預けると担保がプラットフォーム依存になる。
  ⚠ WHATWG URL は special scheme で IPv4 を正規化するので、`https://2130706433/`・`https://0x7f.0.0.1/`・
  `https://127.1/` はいずれも dotted-quad になり、IP リテラル判定 1 本で捕まる（実測）。
  ⚠⚠ **`assertAllowedObsUrl` は loopback を「許可」する逆向きのガードである。絶対に流用・統合しないこと。**
  両方向（テーマガードが `ws://127.0.0.1` を拒否／OBS ガードがテーマ URL を拒否）をテストで固定してある。
- **DNS 事前解決検査**——ホスト名ベースの拒否では「社内ドメインが内部 IP を指す」形を塞げないため、
  取得の直前に `node:dns` で解決し、**解決先が 1 つでもプライベート／loopback／link-local なら拒否**する。
  ⚠⚠ **IPv6 は文字列の前方一致ではなく 8 グループへ展開してから判定すること**（security-review 060c S-2・実測）。
  `::` 圧縮があると先頭グループの取り出しが空文字になり、`::ffff:7f00:1`（＝ 127.0.0.1 の hex 表記）・
  `0:0:0:0:0:ffff:127.0.0.1`（非圧縮）・`::127.0.0.1`（IPv4-compatible）が **public 判定**になっていた。
  埋め込み IPv4 を持つ形（IPv4-mapped / IPv4-compatible / 6to4 `2002::/16` / NAT64 `64:ff9b::/96`）は
  **中の IPv4 で判定**し、**解釈できない形は拒否側へ倒す**（IPv4 側と向きを揃える）。
  ⚠ ここへ渡る文字列は**攻撃者が AAAA レコードで publish できる値**なので、既定は必ず「内部＝拒否」にする。
  ⚠ **残余リスク（受容）**＝ DNS リバインディング（検査後・接続前に応答が差し替わる形）は
  `undici` の `Dispatcher` を持ち込まない限り塞げない。**再修正トリガー＝ sidecar に HTTP クライアント
  依存を足すことになったら、接続時アドレス検証を同時に入れること。**
- **リダイレクトを追わない**（`redirect: "error"` ＋ `response.redirected` / 3xx の明示検査の**2 層**）。
  追うとガードをリダイレクト先で迂回できる。リダイレクトされたら失敗として返し、最終 URL を
  ユーザー自身に指定してもらう。⚠ 2 層は独立に不変条件を守っており、**片方だけ外す変異は生存する**
  （実測）。守っているのは「リダイレクトが**成功した取得にならない**」ことであって特定の 1 行ではない。
- **サイズ・時間の上限**: タイムアウト 10 秒（`AbortController`＋`setTimeout`）。
  サイズ上限は **`256KB − 既存 CSS 長` の動的値**で、**取得前に検査**する（保存上限が事実上の合計上限であり、
  取得に成功してから保存で落ちると帯域も同意も無駄になるため）。⚠ **`Content-Length` は判定に使わず**、
  読みながら実バイトを数えて打ち切る（⚠ 実測では過少申告より **`Content-Length` 無し（chunked）**が
  本当の抜け道だった）。`Content-Type` の MIME が `text/css` でなければ失敗にする（前方一致にしない）。
  **同時 1 件・直近 60 秒で 8 件**のレート制限も課す。
- **送信データはゼロ**: GET のみ・リクエストボディ無し・**Cookie / Referer / 認証 / カスタムヘッダを一切送らない**
  （ユーザーの識別子になるものを 1 つも送らない・§9）。失敗はリトライせず graceful に返す。
- **明示同意（毎回）**: 取得前に必ずダイアログを出し、**完全な URL** と **取得先ホスト（`new URL().hostname`）を
  別行で強調**して表示する（`https://trusted.example@evil.example/a.css` のような userinfo 付き URL は
  正当なので Rust 側では弾いておらず、素で出すと先頭を信じられる）。**既定はキャンセル側**（`autoFocus`）。
  ⚠ **「今後確認しない」は作らない。** 宛先が固定できない以上、毎回の同意が唯一の担保である。
  ⚠ 表示した URL と取得する URL が**同一の 1 変数**であることをコードで保証する（テストで固定）。
  ⚠ **既知の限界（受容・security-review 060c S-4）**: 同一なのは**URL 文字列**であって、そこから導出する
  **ホスト名は 2 つの URL パーサ**（表示＝ webview の WebKit / Blink、検証＝ sidecar の Node/ada）が
  別々に計算している。両方 WHATWG 準拠なので乖離は考えにくく、乖離しても**取得できる形を決めるのは
  sidecar のガード**（表示だけが甘くなる方向）なので受容する。⚠ 再修正トリガー＝ホスト名を
  「同意の可否」以外の判断（allow-list 照合・同意済み宛先の記憶など）に使い始めたら、判定を 1 実装へ寄せること。
- ⚠⚠ **loopback WS の未認証性に対するチケット認証**: `theme-import.fetch` は
  **StreamDock の窓だけが取れるチケット**（Rust が sidecar 起動ごとに採番し stdin private pipe で渡す
  uuid v4）を伴わなければ受け付けない（不一致は**黙って捨てる**）。
  理由＝ sidecar の loopback WS は**未認証**で、`127.0.0.1` に到達できる同一 PC の任意プロセス
  （およびユーザーがブラウザで開いた悪意あるページ）が制御フレームを送れる。従来フレームが受容されて
  きた根拠は「**秘密が流れない・egress を起こせない**」（`obs-*` は loopback 限定）だったが、
  **`theme-import.fetch` はインターネットへの GET を起こす初めての制御フレーム**なのでその根拠が及ばない。
  チケットが無いと、悪意あるページが**同意ダイアログを一切経ずに** `https://tracker.example/<id>.css` を
  叩かせられる（ビーコン・IP 露出）。⚠ チケットは**ログにも keychain にも DB にも残さない**（§9）。
  ⚠ 同一 PC の任意プロセスがアプリのメモリを読める前提なら破れるが、その前提では既に何でもできる。
- **実行時は通信しない**: 保存されるのはインライン展開後の CSS で、その中に残る外部参照
  （`url()` の画像・Web フォント・入れ子の `@import`）は **060b のサニタイザが除去する**。
  ＝ スナップショット後は完全オフライン（キャッシュ・再取得・更新チェックを一切行わない）。
- **取得は sidecar のみ。main 窓の no-internet は不変**（Rust は同期のまま・HTTP crate を足さない。
  `overlay_theme` の契約テストが `reqwest` / `TcpStream` 等の不在を固定している）。
  **再帰的な `@import` は追わない**（1 段で打ち切る。追うと深さ無制限の外部取得になる）。
  ⚠ 取得した CSS の中の `@import` は保存時に除去され、その宛先で**同意ループを再起動しない**
  （＝無限ループ防止。テストで固定）。**`url()` の中身は取りに行かない**（フォントの実体は 060h）。
- **停止手段**: 同意ダイアログで「取得しない」を選べば egress はゼロ。
  `@import` を含む CSS を取り込まない限り、この経路は 1 バイトも通信しない。
  ⚠ 055 の自己アップデートと違い、**ユーザーが常に止められる**。
- **§9**: **取得先 URL・取得した CSS 本文をログにも `AppError` にも出さない**。sidecar が返す失敗理由は
  固定語彙（`blocked` / `rate` / `redirect` / `type` / `size` / `timeout` / `network`）だけで、HTTP ステータスも
  レスポンス本文も載せない。⚠ `rate`（レート制限）を `blocked`（形・解決先の拒否）から分けているのは
  **ユーザーが取る行動が違う**ため（前者は待つ／後者は URL を直す）。security-review 060c S-7 で分離した。
  取得結果は **要求元の WS クライアントへ unicast** し、
  オーバーレイ窓・固定コメント窓へは配らない（`broadcastMessage` を使わない）。
- **新規依存ゼロ**（`fetch` / `AbortController` / `node:dns` / `node:crypto` の標準 API のみ）・
  **新規 capability ゼロ**・`tauri.conf.json` 差分ゼロ・`csp: null` 不変・**vendor 差分ゼロ**。
- **security-review 必須**（§1 の例外新設＝本リポジトリで最もリスクの高い種類の変更）。

### 追補（060h・Web フォント実体の取り込み＝取得を 2 段目・3 段目へ広げる）

上記 060c 例外の**適用範囲だけ**を広げる（担保の構造は変えない）。取得するのは
`@font-face` の `src` が指す woff2 / woff の実体で、**base64 の `data:` URI へ変換して保存**する。
保存後は完全オフラインである点も 060c と同じ。

- ⚠⚠ **取得してよいものの規則（これがすべて）**:
  ① **CSS** … `@import` の宛先。**深さ 2 まで**（1 段目＝ユーザー CSS の `@import`／2 段目＝
     1 段目で取得した CSS の中の `@import`）。**3 段目以降は追わない。**
  ② **フォント** … 保存直前の合成 CSS の **`@font-face` ブロック内の `src` 宣言**にある url。
     **そこから先は一切辿らない**（woff2 は CSS ではない）。
  それ以外の url（`background-image` / `cursor` / `list-style-image` / `mask` / `filter` /
  `@namespace` / `@import` 内の `data:`）は **1 つも取得しない**。
  ⚠⚠ **「CSS の中の url を取得する」という一般化を絶対に行わない**——
  `background-image: url(https://…)` まで辿ると**トラッキングピクセル**になる。
  ⚠ **深さ 2 が必要な理由**（実測）: 依頼者の実サンプルは
  `ユーザー CSS` → `ruri.info/…css`（1 段目）→ `@import fonts.googleapis.com`（2 段目）→
  `@font-face src: fonts.gstatic.com/….woff2` という構造で、**深さ 1（060c）では Google Fonts の
  CSS に到達できず書体が 1 バイトも入らない**。3 段目以降は実在の用途が無い。
- ⚠⚠ **候補 URL を作れるのは Rust のサニタイザ 1 か所だけ**（`stripped_import_urls` /
  `stripped_font_faces`）。frontend も sidecar も CSS から URL を抜き出さない。
  `stripped_font_faces` に載るのは「**`@font-face` ブロックの直下**」かつ「**プロパティ名が `src`**」の
  宣言から取れた url に限る（走査器がブロックの入れ子を辿った結果として決まる＝正規表現ではない）。
  clamp は `@import` と**同じ 1 実装**（`is_offerable_url`＝ http(s) 絶対 URL のみ・エスケープを含むものは
  載せない・bidi / format 文字を含むものは載せない・1 件 2048 文字）で、**件数上限のみ 256**
  （日本語フォントは `unicode-range` で約 110 分割されるため）。
  ⚠ **平坦な URL 配列ではなくブロック単位で返す**のは実測に基づく——保存される CSS からは
  `src` 宣言が丸ごと消えるので、「どの URL がどの `@font-face` のものか」を保存後の CSS から
  **復元できない**。対応関係を Rust が返すことで、CSS を解析する実装が frontend 側に生まれるのを防ぐ。
- **深さは「保存ラウンドの回数」で表現する**（`MAX_IMPORT_ROUNDS = 2` の定数 1 つが決める）。
  各ラウンドの候補は前ラウンドで取得したテキスト由来のものだけになる——保存済み CSS からは
  `@import` が既に除去されているので、**同じ宛先が再登場しない＝無限ループしない**。
- **明示同意（段ごとに必ず）**: 1 段目に同意しても 2 段目・3 段目は自動で取得しない。
  ⚠ 1 段目のダイアログには「取得した内容がさらに別のアドレスを参照していた場合は、**改めて確認する**」
  ことを明記する（1 段目の時点では 2 段目の宛先を知りようがないため）。
  1 段目・2 段目は**1 件ずつ**完全な URL ＋ ホスト強調。既定はキャンセル側。「今後確認しない」は作らない。
  ⚠⚠ **3 段目（フォント）だけはホスト単位で 1 枚にまとめる**——日本語 1 ファミリで約 110 本になり、
  110 枚のダイアログは同意として機能しない（クリック疲れで担保が空洞化する）。
  **代替の担保**: ①ダイアログに出すホスト集合は、**実際に取得する URL 群から導出した集合そのもの**
  ②取得ループはその URL 群（`stripped_font_faces` の部分集合）以外を 1 本も送らない（テストで固定）
  ③sidecar 側は 1 本ごとに `assertAllowedThemeFontUrl` を再度通す。
  ④**同意の前に**「候補 N 件のうち M 件だけ取り込む」「上限（約 4MB）を超えるぶんは取り込まない」を出す
  （帯域も同意も無駄にしない・060b 申し送り⑤と同じ趣旨）。
- **`assertAllowedThemeImportUrl` の「クエリ禁止」を緩和する**（`?family=` が必須のため）。
  ⚠ **フラグメント禁止は残す。** 緩和してよい根拠＝クエリで運べる情報は**パスで既に運べる**
  （`https://tracker.example/<id>.css` は 060c の時点で通る）ので脅威モデルが変わらない。
  形を狭める担保は `https:` / 443 / パスの形 / IP リテラル拒否 / 内部サフィックス拒否 /
  DNS 事前解決検査 / リダイレクト禁止 / 毎回の明示同意 / チケット認証が引き続き受け持つ。
  ⚠ `redactUrl` は**引き続きクエリを落とす**ので、ログ・エラーに載る面は広がっていない（§9）。
- ⚠⚠ **パスの形も緩めた（実測で `.css` 終端だけでは足りないと分かった）**: 2 段目の必須形
  `https://fonts.googleapis.com/css2?family=…` の `pathname` は **`/css2`** で、`.css` で終わらない
  （v1 は `/css`）。→ CSS 側は「**`.css` 終端 または 最後のパス片が `css` ＋ 数字 0 個以上**」を許す。
  ⚠ これは**ホストを名指ししない「形」の規則**である（allow-list にホストは 1 つも足していない）。
  ⚠ **これ以上は広げないこと**——「拡張子を見ない」まで緩めると、この経路は
  「ユーザーが同意すれば任意の HTTPS エンドポイントへ GET できる汎用フェッチャ」になる。
  中身が CSS であることは `Content-Type: text/css` の厳密一致が別に担保している。
- **フォント専用ガード `assertAllowedThemeFontUrl`**（`assertAllowedThemeImportUrl` と**別関数**）:
  条件は同一で、**パスの形だけ**が `.woff2` / `.woff` 終端に置き換わる（判定本体は 1 実装を共有）。
  ⚠ CSS 側の「拡張子無しでも通る形」（`/css2`）は**フォント側では許さない**（必要が無い＝広げない）。
  ⚠⚠ **`assertAllowedObsUrl` は loopback を「許可」する逆向きのガード**である点は 060c と同じ。
- **バイナリ取得の上限**（本リポジトリ初のバイナリ egress・`runThemeFontFetch`）:
  `Content-Type` は **`font/woff2` / `font/woff` / `application/font-woff2` /
  `application/font-woff` / `application/x-font-woff2` / `application/x-font-woff` の厳密一致のみ**。
  ⚠⚠ **`application/octet-stream` は許可しない**——許すと MIME 検査が実質無効になり、
  「何でも取れる汎用フェッチャ」＝ §1 例外の無制限な拡大になる。
  サイズは **1 本 512KiB・総量 3MiB（base64 後 4MiB）・本数 256** を上限とし、
  `Content-Length` は判定に使わず**読みながら実バイトで打ち切る**（chunked でも）。タイムアウト **5 秒**
  （CSS の 10 秒より短い＝ 110 本を逐次で引くため。10 秒 × 110 本＝最悪 18 分になる）。
  ⚠⚠ **`TextDecoder` を通さない**（デコードすると不正バイトが U+FFFD に置換されフォントが壊れる）。
  ＝ CSS 取得（`runThemeImportFetch`）と**別関数**にしてあり、片方の緩みが他方へ伝播しない。
  返すのは `{ mime, base64 }` で、**`mime` は sidecar が allow-list で検証した値のみ**
  （frontend が `data:` の型を自由に決められないようにする）。
- **レート制限はフレーム種別で分ける**: CSS は従来どおり**同時 1 件・60 秒 8 件**。
  フォントは**同時 1 件・60 秒 300 件・60 秒 16MiB**。
  ⚠ 枠を分けても濫用防止は薄くならない——①この枠を使えるのは
  `assertAllowedThemeFontUrl`（`.woff2` / `.woff` 終端）と `Content-Type` のフォント allow-list を
  **両方**満たす宛先だけ ②**バイト側の天井を新設した**（ビーコンは件数・持ち出しはバイトで効くので、
  両方に天井があるほうが件数だけだった 060c より**むしろ強い**）③チケットと毎回の同意はそのまま効く。
- **新しい制御フレームもチケット必須**: `theme-import.fetch-font` は
  `theme-import.fetch` と**同じ受理条件・同じチケット照合・同じ unicast**を通る
  （`maxBytes` の天井だけが違う）。
  ⚠⚠ **チケット照合は種別で分岐する前に置くこと**——分岐の中へ落とすと
  「新しいフレームを足したときに検証を書き忘れる」形が作れる。
  ⚠ 060c 時点でテスト不能だったこの分岐は、060h で純関数 `handleThemeImportFrame` へ切り出し、
  **チケット不一致で黙って捨てる（返信もしない）／unicast であること／fail-closed** を
  テストで固定した（security-review 060c S-3 の宿題）。
- **実行時は通信しない**: 保存されるのは data URI 化済みのフォント CSS で、外部 URL は 1 つも残らない
  （残っていれば 060b のサニタイザが除去する）。キャッシュ・再取得・更新チェックを一切行わない。
- **停止手段**: どの段でも「取得しない／取り込まない」を選べば egress はゼロ。
- **⚠ ライセンスはユーザー自身の責任**: 取得したフォントは端末の `app_data_dir` に置くだけで
  再配布ではないが、**ユーザーが任意の URL を指定できる以上、利用条件を StreamDock は確認できない**。
  同意ダイアログに明記する（`docs/tasks/060h-external-font-snapshot.md` も同じ）。
- **§9**: フォントのバイト列も取得先 URL もログにも `AppError` にも出さない。失敗理由は
  CSS 取得と**共通の固定語彙**（`blocked` / `rate` / `redirect` / `type` / `size` / `timeout` / `network`）。
- **新規依存ゼロ**（`fetch` / `AbortController` / `node:dns` / `node:crypto` / `node:buffer` の標準 API のみ）・
  **新規 capability ゼロ**・`tauri.conf.json` 差分ゼロ・`csp: null` 不変・vendor 差分ゼロ・
  **`package.json` 差分ゼロ**（060c と違い sidecar の `scripts` も増やしていない）。
- **security-review 必須**（§1 例外の適用範囲拡大 ＋ §5 の保存形の変更）。
  → ✅ **2026-08-09 実施済み**（判定「軽微な懸念あり」）。**条文は緩めず、実装とテストを条文へ寄せた**。
  上の記述のうち、**実装はしていたが機械的に固定できていなかった**ものが 4 件あったので塞いだ:
  ①「CSS 側の `/css2` の形はフォント側では許さない」（テストの URL が誤っていて未検証だった）
  ②「**バイト側の天井**を新設した」（レート枠から外す変異が生存＝ 1 行もテストが無かった）
  ③「1 本 512KiB」（定数そのものを固定していなかった＝ `parseControlFrame` の受理上限まで動かせた）
  ④「Cookie / Referer / 認証 / **カスタムヘッダ**を一切送らない」（§9 の中核なのにテストが無かった）。
  あわせて次の 3 点を**実装側で**直した（どれも「取得できる宛先」は広げていない）:
  - `sanitize::clamp_descriptor` が `/` と `*` を落とすようにした。規則注入は元から不可能だったが
    **CSS コメントの開始（`/*`）は作れており**、生成したフォント CSS が丸ごと無効化されうる形だった。
  - `@font-face` の宛先を溜めるバッファを走査のローカルへ移した。入れ子・閉じ忘れの `@font-face` で
    **別ブロックの記述子と混線**していた（取得する URL 集合は不変だが、対応づけが壊れる）。
  - **`attach_theme_fonts` が `@font-face` 以外のトップレベル規則を拒否する**ようにした
    （下記 §5 の 060b 例外節④に追記）。フォント資産は注入時に変換を 1 つも通らないので、
    「変換を通さない注入口へ任意の CSS を流す」形を frontend の作法だけに任せない。

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

**例外（055d・macOS の昇格インストール経路＝`osakit` / AppleScript）**: `tauri-plugin-updater` の
`Update::install_inner()` は、macOS で `.app` の置換が `PermissionDenied` になった**フォールバック時にだけ**
`do shell script "rm -rf '<extract_path>' && mv -f '<tmp>' '<extract_path>'" with administrator privileges` を
OSAKit（`osakit` crate・055b で入った推移依存）で実行する。**これは本アプリが書くコードではなく plugin 内部の経路**で、
`check_app_update` からは到達せず、`install_app_update` の macOS 経路でのみ生きる（055b の面はゼロだった）。
- 組み立てられる文字列に**フロントからの入力は一切入らない**。埋まるのは `current_exe()` 由来の
  自アプリのパスと、plugin が作る一時ディレクトリ（`tempfile`）のパスだけである。
- 起動されるのは `rm -rf` と `mv` の 2 つのみで、対象は**自アプリのインストール位置と一時ディレクトリに限られる**。
- 昇格（管理者パスワードの入力ダイアログ）が発生するのは**このフォールバックに落ちたときだけ**……
  **ではない**。`/Applications` は既定で `root:admin` なので、**標準ユーザー（非管理者）で実行すると毎回この分岐に入る**。
  「稀な経路」として扱わないこと。
- ⚠⚠ **plugin はこのパスをエスケープしない**（`format!` にシングルクォート内へ生で埋める）。
  **`current_exe()` のパスはユーザーにも同一権限のプロセスにも書き換え可能**（`.app` のリネーム／
  親ディレクトリ名）なので、**「ユーザー入力が入らないから安全」は担保にならない**:
  - `'` … シェルのクォートを脱出できる ＝ **root 権限のコマンドインジェクション**。
  - `"` / `\` … AppleScript リテラルが壊れ、`script.compile().expect(…)` が**メインスレッドで panic**。
  - 悪意が無くても `~/Bob's Apps/StreamDock.app` のような普通のパスで `rm -rf` の引数が壊れる。
  → **`install_app_update` は DL の前に `ensure_install_path_is_shell_safe()` で fail-closed に弾く**
  （`'` `"` `\` `` ` `` `$` 改行を含むインストール位置では更新しない）。
  **この経路が安全なのは、この検査があるからである。** 検査の消失は契約テスト
  `install_refuses_shell_unsafe_install_paths` が止めている。
  ⚠ ユーザーには定型文言しか出ない（パスを画面にもログにも出さない・§9 を優先した受容）。
  根本原因は plugin 側にあり、**fork しない限りこちらでは直せない**。
- ⚠ この plugin 内部コードは `script.compile().expect("invalid AppleScript")` /
  `tx.send(r).unwrap()` / `rx.recv().unwrap()` を含む＝**こちらのコードでは消せない panic 経路**。
  UI 側の緩和（`useAppUpdate` の watchdog）と、それでも救えない範囲は `docs/progress.md` の 055d 節に記録した。
- ⚠ `install_app_update` を**同期コマンドにしてはいけない**（メインスレッドで走るとこの経路がデッドロックする）。
  理由は同じく progress.md の 055d 節。

自由な shell 実行・ユーザー入力を結合したコマンド実行は引き続き禁止で、この経路も**frontend からは起動できない**
（`install_app_update` の引数は `AppHandle` のみ）。書き込みそのものの評価は §5 の「例外（055d・自己置換）」を正とする。

### 追補（058a・音声出力デバイスの列挙とアプリ内生成音の再生）

**shell は一切経由しない**（`rodio` / `cpal` が OS の音声 API を直接叩く）。本項は §4 の禁止事項に触れないが、
**OS 操作の面が 1 つ増える**ので、その範囲をここで固定する。

- **増えるのは 2 つだけ**: ①音声**出力**デバイスの**列挙**（読み取りのみ） ②**アプリ内で合成した音の再生**。
- ⚠ **入力（マイク）には一切触れない。** `cpal::traits::HostTrait::output_devices()` しか呼ばず、
  `devices()`（入力を含む全件）・`default_input_device()`・`build_input_stream()` を使わない。
  `rodio` の `recording` feature も落としてある（§10）。**この不変条件は `audio::service` の
  契約テスト（`never_touches_input_devices`）がソース文字列で機械的に守っている**——
  実デバイスは環境依存で単体テストできないため、ここだけは静的検査に頼る。
  frontend 側も `getUserMedia` / `enumerateDevices` を呼ばない（webview の音声デバイス API 使用はゼロ）。
- **コマンドは単一目的の 2 本に限定**（§3）: `list_audio_output_devices()`（read-only）と
  `play_notification_sound(deviceId, sound)`。`run_command` 的な汎用は作らない。
- **frontend から任意のファイルパスを受け取らない。** 鳴らす音は
  **`NotificationSound` enum に列挙されたアプリ内合成音だけ**で（058a の「テスト音」＋059a の「コメント音」
  ＋059b の「投げ銭音」。3 つとも**ペイロードなしの unit variant** を足しただけで、指定経路は enum のまま）、
  同梱音源ファイルすら存在しない＝**パスという概念が経路上に無い**。
  ⚠ この enum を `String` / `PathBuf` に変えると「任意ファイル再生コマンド」に化ける。変えないこと。
  契約テスト（`accepts_no_file_path_from_the_frontend`）が `PathBuf` / `include_bytes!` / `std::fs` の
  出現を止めている。
- **デバイス ID は Rust 側で列挙結果と照合してから使う**（§8）。frontend が渡せるのは
  `list_audio_output_devices()` が返した値だけで、組み立てさせない。
- ⚠⚠ **照合に失敗しても既定デバイスへフォールバックしない（fail-closed）。**
  058s の結論（②-軽）では **OS 既定＝仮想オーディオデバイス＝配信に載る側**なので、既定へ落とすと
  **「載せないつもりの通知音が配信に載る」**——本機能の存在理由そのものが壊れる。鳴らないのは軽微な不便で、
  載るのは事故。契約テスト（`never_falls_back_to_the_default_output_device`）が
  `default_output_device` / `from_default_device` / `open_default_sink` / `open_sink_or_fallback` の
  出現を止めている。
- **出力ストリームは State に持たず、再生のたびに開いて閉じる。** 音声デバイスを掴みっぱなしにしないためと、
  **毎回デバイスを解決し直すことで「抜かれた」を再生時点で必ず検出する**ため。
- **同時再生は 1 本に制限する**（`audio::service` の `PLAYING` / `PlaybackGuard`）。⚠ これは
  **クールダウンではなく可用性（自己 DoS）対策**で、`#[tauri::command(async)]` ＋ 同期 fn が
  tokio の worker を占有するため（根拠と実測は §10 の該当項）。競合時は鳴らさず `Ok(())` を返す。
- **列挙は「一覧に出るなら必ず鳴らせる」を不変条件にする。** `list_output_devices` は、コマンド側の検証
  （`trim()` ＋ 制御文字拒否）を通らない ID を**列挙の時点で落とす**。ここがずれると「UI には出るのに
  再生時に必ず失敗する」原因不明の故障になる（fail-closed なので危険ではないが、直せない不便になる）。
- **新規 egress ゼロ・capability 追加ゼロ・`csp: null` 不変・`tauri.conf.json` 差分ゼロ**
  （音源を同梱しないので `bundle.resources` を足していない）。
- **全経路が `AppResult`**。`src/audio/` に `unwrap()` / `expect()` / `panic!` は 1 つも無い
  （契約テスト `has_no_panicking_paths`）。
- ⚠ **Windows 未検証**（058s の実測は macOS のみ）。WASAPI でのデバイス名・安定 ID の取得と実再生は
  098 完了後に実機で確認する。詳細は `docs/tasks/058a-audio-routing-foundation.md`。

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

### 例外（055d・アプリ自己アップデート＝自分自身の置換）

上記「アプリの管理領域内に限定する」原則に対し、**StreamDock 自身の更新に限り**、
**アプリ自身のインストール位置への書き込み**を例外的に許可する。§1 の
「例外（055・アプリ自己アップデート）」の DL・インストール側にあたる
（検出だけの 055b はファイルを 1 バイトも書かない）。方式決定は `docs/tasks/055-app-self-update.md` を正とする。

**⚠ §5 で「### 例外」を設けるのはこれが初めて**（§1 は 7 件あるが §5 は 0 件だった）。

- **何が起きるか**
  - **macOS**: `.app.tar.gz` を一時ディレクトリへ展開し、既存の `/Applications/StreamDock.app` を
    一時ディレクトリへ退避（`std::fs::rename`）してから、展開したものを同じ位置へ移動する。
    ＝**自分自身の `.app` を丸ごと置換する**。退避したものは成功後に破棄される。
  - **Windows**: NSIS インストーラ（`*-setup.nsis.zip` を展開した `.exe`）を `ShellExecuteW` で起動し、
    **インストーラがインストール先を書き換える**。plugin は起動直後に `std::process::exit(0)` する。
  - どちらも「アプリの管理領域（設定 / SQLite / ログ）」の**外側**への書き込みである。

- **担保の柱は 3 つ**
  1. **書き込み先はアプリ自身のインストール位置に限定される。** パスは `tauri-plugin-updater` が
     `current_exe()` から導出する（`extract_path_from_executable`）ものだけで、**任意パスは指定できない**。
  2. **書き込む内容は minisign 公開鍵で検証済みのバイト列に限られる。** 署名が合わなければ
     1 バイトも書かずに失敗する（fail-closed）。検証は `Update::download()` の中で、
     ダウンロード完了後・`install()` の前に実行される。公開鍵は `tauri.conf.json` の
     `plugins.updater.pubkey`＝**コンパイル時に焼き込まれる**。
  3. **フロントから書き込み先・URL・バージョンを指定できない。** `install_app_update` の引数は
     `AppHandle` のみで、`app_update/commands.rs` の `#[cfg(test)] mod command_contract` が
     **シグネチャ全体**を機械的に固定している（引数を 1 つ足した瞬間にテストが落ちる）。

- **汎用のファイル書き込みコマンドは新設していない**（§3 の「`write_file(path, content)` のような
  強すぎる command を作らない」に抵触しない）。書き込み経路は `tauri-plugin-updater` の実装のみで、
  こちらのコードはファイルを 1 バイトも直接書かない。

- ⚠ **`bundle.externalBin` の sidecar（`comment-sidecar-*`）も同時に置き換わる**（本体バンドル同梱のため）。
  更新後に**実行ビットと ad-hoc 署名が保たれるか**は未検証で、
  [099b](tasks/099b-updater-e2e.md) の E2E-4 / E2E-8 で実測する。壊れると
  「更新したらコメントビューアだけ死ぬ」という症状になる。

- ⚠ **削除も伴い、ロールバック機構は無い。** macOS 経路は置換前に既存 `.app` を退避し、
  失敗時は plugin が戻す実装になっているが、昇格経路（下記 §4 の例外）は `rm -rf` してから `mv` するため、
  **その間に失敗するとインストール先が消えたままになりうる**。ロールバックは親 055 の「やらないこと」で、
  復旧手段は手動での再インストールのみ。

- ⚠ **DL のサイズに上限を課す手段が plugin API に無い（受容した制約）。** `Update::download()` は
  応答ボディ全体を `Vec<u8>` に積んでから minisign 検証する。進捗コールバック
  `on_chunk(usize, Option<u64>)` は**戻り値が `()` で中断を伝えられず**、`Update.timeout` は
  総リクエスト時間なのでサイズ依存で値を決められない。＝ §1 の「応答ボディにサイズ上限が無い」と
  **同じ制約が数十〜数百 MB のスケールで再来する**（前提は同じく「GitHub 侵害または有効証明書を持つ MITM」）。
  塞ぐには plugin を fork して自前で DL する必要があるため受容する。

- **更新の成否を SQLite / app_logs に記録しない**（新規の保存経路を作らない・§9）。

- ⚠ **「何もしなかった」を成功と混ぜない**（055d review S-2）。`install_app_update` は
  `AppUpdateInstallOutcome`（`installed` / `noUpdate` / `alreadyRunning`）を返す。
  **`alreadyRunning` を「完了」として扱うと、走行中の自己置換の最中に再起動を促す**ことになり、
  macOS では `install_inner()` の 2 回の `rename` の間に刺さって `.app` が消えうる（ロールバック機構は無い）。

- **security-review 必須**（auto update 系 ＋ 自己置換）。

### 例外（060b・オーバーレイのカスタム CSS テーマの取り込み）

上記「アプリの管理領域内に限定する」原則に対し、**ユーザーが持ち込んだ CSS を
`app_data_dir/themes/` へ取り込む書き込み**を例外的に許可する（要望③・`docs/tasks/060b-custom-css-import-backend.md`）。

**⚠ §5 で「### 例外」を設けるのは 055d に続き 2 回目。**

⚠ **持ち込み方は 3 通りある**（②は 2026-08-05・060e／③は 2026-08-09・060c で追加）:
**①ファイルを選ぶ**（`import_overlay_theme(path, name)`）、
**②本文を貼り付ける**（`import_overlay_theme_text(css, name)`）、
**③外部 `@import` のスナップショット**（`import_overlay_theme_snapshot(css, name)`）。
**保存先の組み立て・検証・サニタイズ・上限は 3 経路とも同一の共通コア（`service::store_sanitized_css`）**で、
下記の担保はどれにも等しく効く。
⚠⚠ **①と②の攻撃面は「狭い／広い」で片付かないので、軸を分けて書く**（security-review②・2026-08-05。
初版は「②のほうが狭い」とだけ書いており、片側しか見ていなかった）:

- **②で増えないもの**（＝実装者の当初の主張は、この軸については正しい）: `path` を取らないので、
  下記の「UNC / ネットワークパス経由の egress」も「2 本のコマンドを合成した**拡張子 `.css` 限定の
  任意ファイル読み取り**」（060b review② の受容事項）も**増えない**。
- ⚠ **②で増えるもの**: **本文の内容支配**。①が保存できるのは「既にディスク上にある `.css` の中身」だが、
  ②は**呼び出し側が選んだ任意のバイト列**を `app_data_dir` へ**永続化**できる。
  アプリ定義コマンドは ACL 対象外＝**全 4 窓から呼べる**ので、いずれかの窓でスクリプト実行を許した場合、
  ①では「攻撃者が中身を選べない」ぶんの制約が②には無い（＝再起動をまたいで残り、後でプレビュー＝
  特権窓へ持ち込める payload を置ける）。
  ⚠ ただし **egress は増えない**（保存されるのはサニタイザを通った CSS だけ）し、
  **前提条件が「webview でのスクリプト実行」なので、その時点で他の手段も等しく開いている**。
  容量も 256KB × 200 件で頭打ち。以上から**受容**する。

⚠⚠ **③ Snapshot 経路の再評価（2026-08-09・060c。契約テストが設計どおり落ちたので行ったもの）**:

- **③で増えないもの**: 保存先の組み立て（`app_data_dir/themes/<uuid v4>.css` の固定形）・サニタイズ・
  上限（**256KB / 200 件**）・制御文字検査は**②とまったく同じ 1 セット**（`store_sanitized_css`）。
  `path` を取らないので、UNC 経由の egress も「拡張子 `.css` 限定の任意ファイル読み取り」の合成も増えない。
  `origin` はコマンド引数に現れず、`Snapshot` を立てるのは `service::import_fetched_snapshot` だけである
  （`the_theme_origin_is_never_settable_from_the_frontend` が固定）。
- ⚠ **③で増えるもの**: **本文の出所が「ネットワークから来たバイト列」になる**（①②はローカル由来）。
  ただし **3 経路ともサニタイズ前の本文を信頼していない**ので扱いは変わらず、取得できる形は
  §1 の 060c 例外節のガード（`https:` / 443 / `.css` / SSRF 拒否 / リダイレクト禁止 / `text/css` /
  サイズ・時間上限 / **毎回の明示同意** / **チケット認証**）で極端に狭めてある。
- ⚠⚠ **`css: String` の出現回数の固定を 1 → 2 へ緩めた。** 緩めてよい根拠は②のときと同じ——
  §3 が禁じているのは「**書ける場所を呼び出し側が決める**」形であって本文そのものではない。
  **数字だけ書き換えて通してはいない**（この節がその再評価の記録である）。
  ⚠ 契約テストは出現回数に加えて**コマンド名 2 つの実在**も固定してあり、`content` / `bytes` / `data` は
  引き続き全面禁止。**4 本目を足すときも同じ手順（再評価＋security-review）を踏むこと。**

⚠⚠ **④ フォント資産の再評価（2026-08-09・060h。契約テストが設計どおり落ちたので行ったもの）**:

1 テーマが持つ管理ファイルが **最大 2 つ**（意匠 ＋ フォント）になった。

- **④で増えないもの**:
  - **保存先の組み立ては不変。** フォント資産も **`app_data_dir/themes/<uuid v4>.css`** の固定形で、
    **別の uuid v4 を採番するだけ**。`is_managed_file_name()`（`<uuid v4>.css` 完全一致）は
    **書き換えていない**＝ **書けるファイル名の集合は 1 バイトも広がっていない**。
  - **サニタイズも書き込みも 1 か所のまま。** 2 本目の保存経路（`service::attach_theme_fonts`）は
    私有ヘルパ `service::write_sanitized_asset` へ委譲するだけで、`sanitize::sanitize_css(` と
    `std::fs::write(` はソース上 1 か所である
    （`exactly_one_place_sanitizes_and_exactly_one_place_writes` は**緑のまま**）。
    ⚠ **これは数字合わせではない**——このテストが守っている不変条件
    「保存経路が 2 本に分かれて片方だけ緩む形を作らない」を**実際に維持している**。
    新しい契約テストが「両方の経路が共通コアを通ること」を出現回数で固定した。
  - `path` を取らないので、UNC 経由の egress も「拡張子 `.css` 限定の任意ファイル読み取り」の合成も増えない。
  - `origin` はコマンド引数に現れない（`the_theme_origin_is_never_settable_from_the_frontend` は不変）。
- ⚠ **④で増えるもの**:
  1. **本文の上限が資産種別で 2 値になる**（意匠 **256KiB** ／ フォント **5MiB**＝`MAX_FONT_CSS_BYTES`）。
     ⚠ **意匠の 256KiB は動かしていない**——あれは 060a の実測に紐づく**注入経路の予算**で、
     `rewriteSelectors` は 060d が**注入のたびに毎回**走らせる。
     フォント側を 5MiB にしてよい根拠＝フォント CSS は **`rewriteSelectors` も `scopeSelectors` も
     `withDecorationReset` も通らない**（`@font-face` はセレクタを持たないので変換対象が無い）ので、
     注入時のコストは「ブラウザが CSS を 1 回パースする」だけであり、256KiB の根拠が及ばない。
     ⚠ 制御文字・BOM の規則は資産種別で変わらない（「フォントだけ検査がゆるい」を作らない）。
  2. **1 テーマが管理ファイルを 2 つ持つ**（`file_name` ＋ NULL 許容の `font_file_name`）。
     削除は**両方**を消す（DB 行が先・ファイル実体は best-effort の順序は不変）。
     ⚠ 孤児ファイルは不可視で無害／孤児 DB 行は可視の故障、という線引きも不変。
     ⚠ 060h security-review S-11: `set_font_file_name` の**更新行数も見る**こと。
     存在確認と UPDATE の間にテーマが消えると `Ok(0)` が返り、書いたファイルが
     `delete` からも辿れない**永久孤児**になる（0 行なら書いたファイルを掃除して `not_found`）。
  2'. ⚠⚠ **フォント資産は `@font-face` だけ**（060h security-review S-10 で Rust 側の検査を足した）。
     この資産は注入時に `rewriteSelectors` / `scopeSelectors` / `withDecorationReset` を
     **1 つも通らない**（`@font-face` はセレクタを持たないから変換が要らない、という前提で
     別 `<style>` に載せている）。その前提を frontend の `buildFontFaceCss` の作法だけに任せると、
     「**変換を通さない注入口へ任意の CSS を流す**」形が将来の 1 行で作れてしまう。
     → `sanitize` がトップレベルに `@font-face` 以外の中身があったかを返し、
     `attach_theme_fonts` が**それを拒否する**（拒否時は書いたファイルを掃除する）。
     ＝ **注入経路の性質と、保存できる中身が構造的に一致する**。
     ⚠ 意匠 CSS 側はこの検査を通さない（当然セレクタを持つ）。
  3. **`css: String` を取るコマンドが 3 本目**（`attach_overlay_theme_fonts`）、
     **コマンド総数が 9 本**（`get_overlay_theme_font_css` を含む）になった。
     解禁してよい根拠は②③のときと同じ——§3 が禁じているのは
     「**書ける場所を呼び出し側が決める**」形であって本文そのものではなく、上記のとおり
     **保存先の組み立てにユーザー入力は 1 バイトも入らない**。
     ⚠ `content` / `bytes` / `data` は引き続き全面禁止。**4 本目を足すときも同じ手順を踏むこと。**
  4. **ディスク使用量の天井が上がる**: 従来 256KB × 200 件 ≒ 50MB →
     最大 (256KB + 5MiB) × 200 件 ≒ **1GB**。
     ⚠ **200 件上限（`MAX_THEMES`）は据え置く**（増やさない）。受容理由＝フォント付きテーマは
     取り込むたびに**3 段の同意**を通すので大量生成が構造的に起きにくく、削除導線が常時ある。
     **再修正トリガー＝ 200 件上限を緩める変更を入れるときは、フォント資産込みの総量で再評価すること。**

詳細は `docs/tasks/060e-paste-css-import.md` / `docs/tasks/060c-external-css-snapshot.md` /
`docs/tasks/060h-external-font-snapshot.md`。

- **何が起きるか**: frontend の `@tauri-apps/plugin-dialog` の `open()` で得たパスを
  `import_overlay_theme(path, name)` へ渡し、Rust が読み・検証し・**外部参照を除去してから**
  `app_data_dir/themes/<uuid v4>.css` へ書く。削除時はその 1 ファイルを消す。**それ以外は書かない。**

- **担保の柱**
  1. **保存先の組み立てにユーザー入力が 1 バイトも入らない。** パスは
     「`app_data_dir()` → `join("themes")` → `join("<uuid v4>.css>")`」の固定形だけで、
     **元ファイル名も `name` もファイル名に使わない**＝パストラバーサルが構造的に成立しない。
     多層防御として、パスへ結合する直前に必ず `is_managed_file_name()`（`<uuid v4>.css` 完全一致）を通す。
     `overlay_theme::service` の契約テストが「`app_data_dir()` の呼び出しは 1 か所」
     「`join(THEMES_DIR)` は 1 か所」「ファイル名の結合は 1 か所」を機械的に固定している。
  2. **汎用のファイル書き込みコマンドを新設していない**（§3 の `write_file(path, content)` 型に抵触しない）。
     コマンドは 6 本すべて単一目的で、`path: String` を取るのは `import_overlay_theme` の 1 本だけ、
     **`css: String` を取るのは `import_overlay_theme_text` の 1 本だけ**（契約テストが出現回数まで固定）。
     ⚠⚠ **本文を渡せることは §3 違反ではない。** §3 が禁じているのは「**書ける場所を呼び出し側が決める**」
     形（`write_file(path, content)`）であって、本文そのものではない。ここでは上記 1. のとおり
     **保存先の組み立てにユーザー入力が 1 バイトも入らない**ので、本文を受け取っても書ける場所は動かない。
     ⚠ 060e で `css: String` の**全面禁止を出現回数 1 の固定へ緩めた**（`content` / `bytes` / `data` は
     引き続き全面禁止）。**2 本目を足すなら §3 の再評価と security-review が要る**——
     そのとき契約テストが落ちるようになっている。
  3. **読み込みも `.css` 1 ファイルに限定**される。`import_overlay_theme` 自体は読んだ内容を返さない
     （サニタイズして保存するだけ。返るのは件数と除去した `@import` の宛先のみ）。
     `get_overlay_theme_css` が返すのは**取り込み済みテーマの本文だけ**で、id を DB で引き
     `file_name` を検証してから読むので、**このコマンド単体では**任意ファイル読み取りにならない。

- ⚠⚠ **ただし 2 本を合成すると「拡張子 `.css` に限定された任意ファイル読み取り」になる**
  （2026-08-05 security-review②）。`import_overlay_theme(path)` → `get_overlay_theme_css(id)` の 2 コールで
  サニタイズ後の全文が返り、しかも**アプリ定義コマンドは ACL 対象外＝全 4 窓から呼べる**うえ、
  `path` が dialog 由来かどうかを Rust は検証できない。**これは受容する**が、
  「読んだ内容は返らない」と書いて済ませない——現状 webview には `fs` plugin も asset protocol も無く
  **ファイルを読む手段がゼロ**だったので、限定つきとはいえ読み取り経路を 1 本**新設している**。
  受容理由: ①拡張子 `.css` に限定される（`.css` に秘密が入ることは稀）②書き込み先は
  `app_data_dir/themes/<uuid>.css` のみで元パスに一切影響されない ③アプリはユーザー権限で動くので
  特権境界を跨がない ④`get_overlay_theme_css` は 060d の注入に必須。
  **再修正トリガー＝この 2 本以外に `path` を受け取るコマンドが増えたら、この合成を再評価すること。**

- ⚠⚠ **UNC / ネットワークパスは拒否する**（2026-08-05 security-review②）。Windows で
  `\\evil.example\share\x.css` を渡されると、`fs::metadata` の時点で **OS が攻撃者ホストへ SMB 接続し、
  既定設定では NTLM でユーザー/マシンの資格情報ハッシュが飛ぶ**——ユーザー操作ゼロ・ダイアログ非経由の
  egress で、§1 の趣旨に直接反する。`validate_source_path` が `\\` / `//` 始まりを**拡張子チェックより前**に
  弾く（＝ディスクにもネットワークにも触らない）。macOS の `/Volumes/...`（マウント済み共有）は
  ユーザーが既にマウントした先だけなので拒否しない（新しい宛先を作らない）。

- **`canonicalize` もシンボリックリンク拒否も、意図的に行っていない。**
  canonicalize に意味があるのは「元パスが保存先の組み立てに影響するとき」だが上記 1. のとおり影響しない。
  シンボリックリンク越しに読めるのはユーザーが元々読めるファイルだけで**特権境界を跨がない**ため、
  拒否しても防げるものが無く、正当な構成（Dropbox / iCloud のリンク）を壊すだけになる。

- **入力検証はすべて Rust 側**（§8）: **UNC / ネットワークパスの拒否**（上記）／`.css` 拡張子（ASCII 大小無視）／**256KB 上限**（`metadata` で読む前に 1 回、
  読んだ後に実バイト長でもう 1 回＝TOCTOU）／UTF-8 として読めること／本文の制御文字
  （⚠ CSS は改行・タブを使うので `reject_control_chars` は当てられない。C0 のうち `\t \n \r \x0C` 以外と DEL を拒否）／
  `name` は trim・空拒否・`reject_control_chars`・80 文字上限／**テーマ件数 200 件上限**
  （取り込みコマンドは全 4 窓から呼べるので、無制限にディスクが増える経路を構造側で塞ぐ）。

- **失敗時に孤児を残さない。** 順序は**ファイル書き込み → INSERT**で、INSERT が落ちたら書いたファイルを消す。
  逆順にしないのは、残るものの質が違うから——孤児**ファイル**は不可視で無害だが、孤児**DB 行**は
  一覧に出て開けない「可視の故障」になる。削除は**DB 行が先**で、ファイル実体の削除は best-effort（同じ理由）。

- **`themes/` は取り込み時に `create_dir_all` で用意する**（`lib.rs` の `setup` ではなく `service` 側）。
  実行中にディレクトリを消されても復旧できる。

- ⚠ **読み込みは DB ロックの外で行う**（security-review 指摘）。ユーザーが選ぶファイルは
  ネットワークボリューム上にありうるので、`db.lock()` の内側で読むと応答しないボリュームを掴んだときに
  **アプリ全体の DB コマンド（コメント記録・プリセット起動・ログ）がまとめて止まる**。
  この順序は契約テストで固定してある。

- **security-review 必須**（ファイル書き込み経路の新設 ＋ capability 追加 ＋ ユーザー提供コンテンツの取り込み）。

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
**追補の追補（043e・2026-07-27）**: 上記は当初 append-only（挿入のみ）だったが、**043e で `event_type='jewels'` の行に
限り既存行の上書きを解禁した**（更新するのは `amount` / `currency` / `monetary_amount` / `text` の 4 列のみ・列追加なし・
`published_at`/`viewer_id`/`session_id`/`created_at` は不変）。**`viewer_comments` はもはや厳密な append-only ではない**
ため、不変性を前提にする機能（エクスポート・監査・差分同期等）を作る場合はこの例外を必ず考慮すること。
詳細と限定の根拠は⑪の 043e 節。

**追補（046a・固定コメントの端末内 localStorage 保存＝端末内保存の 2 つ目の限定解禁・2026-07-28）**:
「流れるコメントを見失わないよう右クリックで上部に固定する」機能に**限り**、**ユーザーが明示的に固定操作した
コメント（既定で最大 1 件）**を **viewer webview の localStorage** に保存する。038a が SQLite について定めた
限定解禁と**同じ趣旨の拡張**であり（保存先が SQLite か localStorage かではなく、**保存するデータの種類**＝
第三者のコメント本文・表示名・投げ銭金額が §9 の対象）、本追補で明文化する。

- **キー**は `stream-dock.comment-viewer.pinned-comments` の 1 つのみ（値は JSON 配列・先頭＝最新）。
  保存項目は `id` / `source` / `author.id` / `author.name` / `text` / `published_at` / `event_type` と、
  任意の数値・金額表示（`monetaryAmount` / `monetary` / `monthCount` / `giftCount` / `tier` / `comboCount`）。
  スキーマ全文は `docs/progress.md` の 046a 節（046b が読む契約）を正とする。
- **`author.avatar`（data URI）は保存しない**（038a の「視聴者メモリにアバターを保存しない」と同方針。容量と
  `storage` イベントのペイロードも理由）。**OAuth トークン・OBS パスワード・`code_verifier` 等の機密は載せない**
  （既存の localStorage キー同様・§9）。
- **端末外へ送信しない・クラウド同期しない**。窓間伝達は **localStorage＋`storage` イベントのみ**で
  **Rust を一切経由しない**ため、固定コメントは **Rust の DB（`viewer_comments`）にもログにも入らない**。
  **新規の外部通信/宛先/capability/依存はゼロ**（`csp: null` 不変）。
- **削除手段**は固定帯の「固定解除」と、**コメントビューアを開き直すこと**（046b レビュー S-1 で追加＝
  マウント時に必ず空へ倒すので、セッションをまたいで端末に残らない。下記 ⚠ 節）。上限 1 件かつ固定中は
  常時画面に出るため取り残しが起きない。
  **ただし 038a の `delete_viewer` / `clear_viewers` はこのキーを消さない**（SQLite のみを対象とするコマンドで、
  localStorage は別ストア）。すなわち視聴者メモリから視聴者を削除しても、その人の固定コメント（氏名・本文・金額）は
  固定解除するかコメビュ窓を開き直すまで端末に残る。**端末内保存データの一括削除・エクスポートを作る場合は、SQLite だけでなく
  本キーも対象に含めること**（043e で `viewer_comments` の append-only 前提が崩れたことを明記したのと同種の申し送り）。
- **読み手（046b・2026-07-29 追記）**: 固定コメント専用オーバーレイ窓（`pinned-overlay`）が同じキーを
  **読むだけ**の消費者として増えた。**保存範囲・保存項目・キーは一切変えていない**（`pinnedComments.ts` は無改変）ため
  本追補の内容は不変。046b が追加した localStorage キー（`...pinned-overlay-enabled`）は**トグルの ON/OFF**＝
  ユーザー自身の UI 設定値で、本追補の対象外（詳細は「Tauri Permissions / Capabilities 方針」の 046b 節）。
  なお表示先が増えたことで、**コメビュ窓を閉じた後もこのオーバーレイに第三者のコメント（氏名・本文・金額）が
  表示され続ける**（固定解除するか窓を閉じるまで）。上記の「一括削除・エクスポート」を作る際は、SQLite と
  本キーに加えて**この窓の表示状態**も対象に含めること。
- **⚠→対応済み 配信をまたいだ自動復元（046b レビュー S-1・2026-07-29）**: 046b で
  **①ピン本体（本追補のキー）②トグル ON/OFF（`...pinned-overlay-enabled`）**の 2 つが永続し、
  さらに **ON ならコメビュ本体のマウント時に窓を自動 open** するようになった結果、
  **前回配信で固定したコメント（表示名・本文・金額）が、次の配信の開始時にユーザー操作ゼロで本番画面に出る**
  という経路が生まれていた。窓は `always_on_bottom` ＋ 透過 ＋ 装飾なしで配信者自身のデスクトップでは
  気付きにくく、気付ける経路は OBS プレビューとコメビュ本体の固定帯のみ。**永続した第三者の個人データが
  「配信に出る面」へ自動描画されるのは 046b が初めて**（046a 単体の復元先はコメビュ窓の固定帯＝OBS
  キャプチャ対象外、既存 `comment-overlay` の中身は WS 由来で永続しない）。
  **対応（依頼者の決定・挙動変更）＝コメントビューアを開くたびにピンストアを空へ倒す**
  （`CommentViewerApp` の `pinned` state を `loadPinned()` 初期化から空配列へ変更し、既存の保存 effect が
  マウント時に `"[]"` を書く）。**ピンストア（`pinnedComments.ts`）は無改変**＝キー・保存項目・保存形・
  上限・046b の読み手契約はいずれも不変で、「いつ空へ倒すか」だけを本体側で決めている。
  この担保は**未検証の `storage` 跨ぎ配送に依存しない**（アプリ再起動時はオーバーレイ窓がまだ存在せず、
  窓が開くのは必ずこの書込の後＝read-on-mount が空を読む）。`storage` に依存するのは「オーバーレイを
  開いたままコメビュ窓だけ開き直した」二次ケースのみ。
  **副作用として、ピンは配信をまたいで残らない**（毎回固定し直す運用）。設定カードの注記で明示済み。
  **再修正トリガー＝「配信をまたいで固定を残したい」要望が出たとき**。そのときは起動時クリアをやめるのではなく
  「前回の固定を復元しますか」を明示操作にする（**無操作で配信面に出さない**、を守る）。
- **本追補の追加自体が security-review の対象**（保存ポリシーの変更）。046a は当初「軽レビュー」指定だったが、
  「第三者の個人データを初めて localStorage に永続化する」点は下記「レビュー必須条件」の
  **「取得コメント・視聴者情報の端末保存」に該当**する。frontend のみ・通信ゼロでも、保存ポリシーに触れる変更は
  レビュー必須として扱うこと。

### 追補（058a・音声出力デバイスの名前と ID）

**デバイス名・デバイス ID をログに出さない。** 端末外へ送らない・DB にも保存しない。
接続中のオーディオ機器の構成は、配信者の環境（同居人の機材・職場の会議システム・使用中の外部サービス）を
推測できる情報になりうるため、コメント本文や表示名と同じ扱いにする。

- **ログ DB へ到達する経路が構造的に無い**: `audio` の 2 コマンドは **`DbState` を取らない**
  （`extract_app_icon` の「DB は使わないため State を取らない（最小権限）」と同型）。
  したがって `app_logs` にも診断サマリー（共有用）にも載りようがない。
- **`AppError` に載せない**: `AppError::audio_device_unavailable()` / `audio_playback_failed()` は
  **引数を取らない**（`update_check_failed()` と同じ構え）ので、呼び出し側が cpal の生エラーや
  デバイス名を載せられない。呼び出し側は必ず `map_err(|_| ...)` の形にし、エラー値を束縛しないこと。
  `error.rs` の `audio_failures_carry_only_fixed_messages_without_device_identity` が固定している。
- **UI にも出さない**: 「デバイスが見つかりません」の警告文は
  **「以前選んだ音声出力デバイス」**と書き、名前も ID も出さない。`console.*` も書かない。
- **localStorage に置くのは「ユーザー自身が選んだデバイス ID」1 つだけ**
  （`stream-dock.comment-viewer.audio-output-device`）。これは§9 追補（046a）が対象とする
  **第三者の個人データではなく、ユーザー自身の非機密 UI 設定値**（`OBS_AUTO_ADD_KEY` と同種）。
  ⚠ **デバイス名は保存しない**（表示のたびに Rust の列挙結果から取る＝古い名前が残らない）。

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

**追加した依存（055b・アプリ自己アップデート）**:
- Rust/Tauri: **`tauri-plugin-updater`**（`default-features = false, features = ["rustls-tls", "zip"]`）。
  公開リリースの `latest.json` を見て更新の有無を判定し（055b）、DL/インストールする（055d）。
  **§10 の「auto update 系 / network・http 系 / updater 系」に正面から該当**するため 055b/055d は security-review 必須。
  feature は**既定（`rustls-tls` + `zip`）と同じ内容を明示固定**した（`image` の `default-features = false` と同型）。
  - `rustls-tls`: TLS を pure-Rust の rustls に固定し **`native-tls` / `native-tls-vendored` を選ばない**
    ＝**OpenSSL を持ち込まない**・クロスビルドを増やさない。実測で担保済み（`cargo tree -i openssl-sys` /
    `-i native-tls` / `-i openssl` がいずれも「該当パッケージなし」）。将来 crate 側の既定が変わっても
    TLS 実装が黙って入れ替わらないよう明示する。
  - `zip`: `flate2` / `tar` / `zip` を引く。⚠ **落とさないこと。**
    （⚠ **055d で理由を再訂正した。結論は変わらないが、危険度は当初の記述より高い。**
    055b 時点の記述は「`flate2`/`tar` は `zip` feature でしか有効化されない optional 依存＝落とすと
    **macOS でコンパイルエラー**になり必ず気付く」だったが、plugin の `Cargo.toml` を実際に読むと
    `[target.'cfg(target_os = "macos")'.dependencies]` の `tar` / `flate2` に **`optional` 指定は無い**
    ——`optional = true` なのは **Linux ターゲットの分だけ**である。＝**macOS では `zip` を落としてもビルドは通る。**
    本当に効くのは **Windows 側**で、tauri の updater 成果物は `*-setup.nsis.zip`、`Update::extract()` の
    zip 展開分岐が `#[cfg(feature = "zip")]` なので、落とすと `extract_exe()` にフォールバックする。
    ⚠ **さらに訂正（055d review Q-12）**: そこで「zip のバイト列を `.exe` として書き出す」と書いていたのも誤り。
    `extract_exe()` は `infer::app::is_exe` / `infer::archive::is_msi` を順に見て、
    どちらでもなければ **`Err(InvalidUpdaterFormat)` を返すだけで 1 バイトも書かない**。
    ＝正確には「**Windows の自己更新が、原因の分からない定型エラーで失敗するようになる**」。
    **コンパイルエラーでは気付けない**という結論と「落とすな」は変わらない。）
- **実際に増えた依存（`Cargo.lock` の実測・29 crate）**:
  - HTTP: `reqwest`（⚠ `Cargo.lock` には従来から在ったが、`tauri` 側の依存が **android / apple-non-macos 限定の
    `cfg` ターゲット依存**だったため **macOS/Windows のバイナリには入っていなかった**。055b で初めてリンクされる）、
    `hyper-rustls`。
  - TLS(rustls): `rustls` / `rustls-webpki` / `rustls-pki-types` / `tokio-rustls` / `rustls-platform-verifier`
    / `rustls-native-certs` / `webpki-root-certs` / `ring` / `untrusted` / `subtle` / `schannel`（Windows のみ）/
    `openssl-probe`（**Linux の CA 証明書ファイルの場所を探すだけの crate で、OpenSSL をリンクしない**）。
  - 署名検証: `minisign-verify`。
  - 展開: `tar` / `zip`（Windows・Linux ターゲットのみ）/ `filetime` / `xattr`
    （`flate2` は既に `png`→`ico`→`tauri-codegen` 経由で在ったため新規ではない）。
  - **macOS の昇格インストール: `osakit` / `objc2-osa-kit`（＝AppleScript 実行）**。⚠ これは §4「Shell実行は
    原則使わない」に触れる事実なので明記する: plugin の `Update::install_inner()` は、アプリの置換が
    `PermissionDenied` になった**フォールバック時にだけ** `do shell script "rm -rf … && mv -f …"
    with administrator privileges` を OSAKit で実行する。**`check()` からは到達しない**（055b の面はゼロ）ので
    本タスクでの実害は無いが、**この経路の評価と §4/§5 への追記は 055d の領分**とする
    （併せて、この plugin 内部コードは `expect` / `unwrap` を含む＝**こちらのコードでは消せない panic 経路**である）。
  - Android 専用（macOS/Windows ではコンパイルされない）: `jni` / `jni-macros` / `simd_cesu8` / `simdutf8` /
    `rustls-platform-verifier-android`。その他 `arbitrary` / `derive_arbitrary`（`zip` の optional）・`windows-sys`（新版）。
- **「Rust は完全同期のまま（async/WS/HTTP crate を足さない）」方針を、本タスクで初めて崩す**。
  032c-b 以降ずっと「通信面は sidecar に封じ込め、Rust は完全同期」を守ってきた（同じ `[dependencies]` の
  `keyring` を「**同期 API**（Rust 完全同期の要件に適合・tokio 不要）」で選んだ記述がその方針の記録）。だが
  自己アップデートは **Tauri プロセス自身が自分を置き換える**性質上 sidecar へ寄せられない（上記 §1 例外の
  「sidecar に寄せない理由」）。＝**代替が存在しないための正面からの例外**であり、
  `check_app_update` が**リポジトリ初の真の `async fn` コマンド**になる（tokio は Tauri v2 が既に保持）。
- **代替案の検討と却下**: ①GitHub Releases API（`api.github.com`）を webview `fetch` で見て手動 DL へ誘導する案は
  Rust に reqwest が入らない唯一の案だが、**「アプリから更新まで完結」という要望を満たさない**。
  ②検出だけ `fetch`・DL/インストールは plugin という案は、**インストールで結局 reqwest が要るのに
  egress ホストだけ 1 つ増える**（`api.github.com` の未認証レート制限も背負う）。
- **明示的に足さないもの**: `tauri-plugin-process`（再起動は `AppHandle::restart()`＝`process:allow-restart` を
  配らずに済む）／JS 側 `@tauri-apps/plugin-updater`（capability を広げない）／マークダウンライブラリ
  （`react-markdown` + `remark-gfm` は推移的依存が 20 以上あるので 055e で自前の最小レンダラを書く）／
  `time`（`pub_date` は `Update.raw_json` から RFC3339 文字列のまま取り出す）。
  **JS 側の依存は 1 つも増えていない**（`apps/desktop/package.json` の `dependencies` と `pnpm-lock.yaml` は差分ゼロ。
  `package.json` の差分は `check:bindings` の対象パス列挙 1 行のみ）。telemetry/analytics 系は入れない。
- ⚠ **`ring` は pure-Rust ではない**（**C ファイル 17 個・アセンブリ 111 個**を含む）。本ファイルと `Cargo.toml` の
  既存コメントは既存依存について「いずれも pure-Rust」と繰り返してきたが、**055b でその前提が初めて崩れた**。
  `ring` は rustls が使う暗号実装で、Rust エコシステムで最も広く使われている TLS 用暗号ライブラリ
  （高速化のためのアセンブリは業界標準）。ただし**事実として記録**しておく。
  併せて、055b で増えた 30 crate のうち**ビルド時に自前スクリプト（`build.rs`）を走らせるのは `ring` と `rustls` の 2 つだけ**
  （＝取り込み時に任意コードが走る面は最小）。

**追加した依存（055d・DL → インストール → 再起動）: ゼロ**（2026-08-02）。

- **Rust も JS も新規依存は 1 つも無い。** 055d が使う API（`Update::download` / `Update::install` /
  `UpdaterBuilder::configure_client` / `on_before_exit` / `Emitter::emit` / `AppHandle::restart`）は
  すべて **055b で入れた `tauri-plugin-updater` と `tauri` 本体**に既にあるもの。
  `Cargo.toml` / `Cargo.lock` / `package.json` / `pnpm-lock.yaml` は**すべて差分ゼロ**。
- **`osakit`（AppleScript 実行）は 055b で既に推移依存として入っていた**が、
  **055d で初めてその経路が実行されうる状態になった**（macOS の昇格インストール時のみ）。
  評価は §4 の「例外（055d・macOS の昇格インストール経路）」を正とする。
- **引き続き明示的に足さないもの**: `tauri-plugin-process`（再起動は `AppHandle::restart()`）／
  JS 側 `@tauri-apps/plugin-updater`（capability を広げない）／
  進捗バー・プログレス系の UI ライブラリ（既存の CSS トークンと `div` 2 段で足りる）／
  マークダウンライブラリ（055e で自前の最小レンダラ）。
- **`cargo audit` の再実行は不要**（`Cargo.lock` に差分が無いため。`.githooks/pre-commit` は
  ロックファイルをステージしたときだけ走る＝この差分では発火しない。これは意図どおり）。

**追加した依存（055e・リリースノートのマークダウン描画）: ゼロ**（2026-08-02）。

- **Rust も JS も新規依存は 1 つも無い。** `Cargo.toml` / `Cargo.lock` / `package.json` /
  `pnpm-lock.yaml` は**すべて差分ゼロ**（`apps/desktop/src-tauri/` / `apps/comment-sidecar/` /
  `.github/` も差分ゼロ）。実装は frontend の純関数
  （`apps/desktop/src/screens/app-update/renderReleaseNotes.tsx`）＋ CSS だけ。
- **明示的に落とした依存（マークダウンレンダラ 4 種）**——本タスクの本題なので理由まで残す:
  - **`react-markdown` + `remark-gfm`**: unified / remark / micromark / mdast 系の**推移的依存が 20 以上**
    増える。§10「依存関係を増やしすぎない」に照らして、**リリースノート 1 画面のために払うコストとして重い**。
    描画対象は `docs/release-notes/vX.Y.Z.md` ＝**自分たちが書いた数十行**であり、任意のマークダウンを
    正確に再現する必要がない。
  - **`marked` + `DOMPurify`**: 依存数は小さいが、**HTML 文字列を経由する**ため
    `dangerouslySetInnerHTML` が必須になる。`notes` は `latest.json` 由来で **minisign 署名の対象外**
    （未署名。§1 / 上の 055b の記述を参照）なので、**サニタイザの正しさに安全性を預ける**形になる。
    自前レンダラは **React 要素を返す**＝**HTML インジェクションの経路が構造的に存在しない**ので、
    こちらを採った（＝「依存を減らす」だけでなく「面を減らす」判断）。
  - **`highlight.js` / `prism` 等のシンタックスハイライタ**: コードブロック自体を対応記法にしていない
    （そのまま文字として出す）ので不要。
- **この不変条件は機械で固定した**。担保は**ランタイムのテストと静的検査の 2 本立て**で、
  **役割が違うので両方要る**（当初ここには「React 要素しか組まないので『結果に生 HTML が混ざらない』は
  構造的に必ず通る＝空虚（ミューテーションでも殺せない）」と書いていたが、**これは誤りだった**。
  下記「記述の訂正」を参照）。
  - **ランタイム**（`UpdateScreen.test.tsx` / `renderReleaseNotes.test.tsx`）… 描画結果に現れる違反を殺す
    ＝生 HTML（`<img>`/`<b>` 非解釈）・`<a>`/`<img>` がゼロ・**組み立てた要素が属性を 1 つも持たない**
    （未署名の `notes` が `title=` / `style=` などの属性値へ流れない。`style` は React が CSS 値を
    サニタイズしないため `url(…)` で外部リソース取得が成立しうる）。
  - **静的検査**（`apps/desktop/scripts/check-css-guards.mjs` の **(9)**）… 描画結果に**現れない**追加を殺す
    ＝`dangerouslySetInnerHTML` / `openUrl` / `plugin-opener` / `window.open` / `<a ` / `href=` の不在を
    **`src/screens/app-update/` 配下の非テスト `.ts(x)` 全部**に、`http` / `src=` / `url(` の不在を
    **レンダラ本体 2 本**に課し、加えて `renderReleaseNotes(clampNotes(` という**呼び出しの順序**と
    `styles.notesBody` の参照を固定する。Rust の `app_update/commands.rs` の `command_contract` と同じ手口。
  - **新しい .mjs に分けなかった**のは、`package.json` に `check:*` を 1 行足すと
    「新規依存ゼロ＝`package.json` 差分ゼロ」の担保が崩れるため（`pnpm test` は既に `check:css` を呼ぶ）。
  - **記述の訂正（055e レビュー・2026-08-02）**: 当初は「静的検査だけが担保で、ランタイムのテストは空虚」と
    書いていた。レビューのミューテーション実測で、`dangerouslySetInnerHTML` を足す変異も
    `createElement("a", { href })` で needle を回避する変異も**ランタイムのテストが殺し、
    当時の静的ガード（3 ファイル名指し）のほうがすり抜けた**ことが分かったため、上記のとおり改めた。
    併せて **(9-a) をファイル名の列挙からディレクトリ走査へ**（新規ファイルを足す迂回を封じる）、
    **`http` / `src=` / `url(` はレンダラ本体のみへ**（アップデート画面全体に課すと正しいコードで落ちる）、
    **属性ゼロのランタイム検査を新設**した。**条文の緩和ではなく、担保の強化と役割分担の訂正**である
    （禁止しているものは 1 つも減っていない）。
- **リンクを開く経路は作っていない**（`tauri-plugin-opener` を新たに呼ばない）。リリースノート内の
  `[text](url)` は**テキストとして表示するだけ**＝「外部から来た文字列に含まれる URL を開く」という
  新しい面を作らない。再修正トリガー＝踏ませたくなったら **https 限定 ＋ ホスト検証**を入れて別タスクにする。
- **外部リソースを 1 つも読み込まない**（画像・フォント・script・style）。`csp: null` は不変で、
  CSP 方針の「inline script を増やさない」も維持している。

**追加した依存（058a・通知音の Rust 再生）**:
- Rust: **`rodio`（`default-features = false, features = ["playback"]`）**。
  用途は「音声**出力**デバイスの列挙」と「アプリ内で合成した音を、指定したデバイスで鳴らす」の 2 つだけ（§4 追補）。
  **§10 の「特に注意するもの」のどれにも該当しない**（shell / fs / auto update / network / telemetry いずれでもない）が、
  **§4 の OS 操作面が増えるため 058a は security-review 必須**とした。
- **なぜ必要か（webview では代替できない）**: 058s（2026-08-03）の実測で ①macOS(WKWebView) は
  `navigator.mediaDevices` ごと非対応で `setSinkId` が存在しない ②Windows(WebView2) は `setSinkId` はあるが
  `enumerateDevices` が `deviceId`・`label` とも空の 1 件しか返さず**渡せる ID が無い** ③`selectAudioOutput` は
  両 OS とも未実装、と確定した。**マイク権限を取らずに出力デバイスを選ぶ手段は webview に存在しない**。
  Rust（cpal）は権限なしでデバイス名と安定 ID を返すので、機能の前提条件は Rust 側にしか無い。
- **feature を `playback` だけに絞る理由**（実測・2026-08-04）:
  - 既定は `playback, recording, flac, mp3, mp4, vorbis, wav, dither` で、symphonia のデコーダ一式が入り
    **126 crate** に膨らむ。⚠ **`default-features = false` を外さないこと**
    （`zip` feature を落とすなという 055b の申し送りと同種の地雷だが、向きは逆＝こちらは「足すな」）。
  - ⚠ **`wav` も足していない。058s の指示からの訂正である。** rodio 0.22 の `wav` は
    `["symphonia-wav", "symphonia-pcm"]` の別名で、足すと symphonia / -core / -format-riff / -codec-pcm /
    -metadata が入る（058s が `features = ["playback","wav"]` と書き、増加 crate を「macOS 39」と見積もったのは
    これを含む数字）。**058a はデコーダを必要としない**——音は `SineWave` / `SamplesBuffer` /
    `Player::connect_new().append()`（いずれも feature gate されていない）でアプリ内合成する。
    decoder が要るのは `rodio::play(mixer, reader)` だけで、それは使わない。
    実測: **`cargo tree -i symphonia` が「該当パッケージなし」**。
  - `recording`（マイク入力）も落としてある＝**入力に触れないことが依存レベルでも担保されている**。
- **増える crate は 2 通りの数え方があるので書き分ける**（レビュー指摘で追記）:
  - **`Cargo.lock` への追加は 16 件・削除ゼロ。** `cargo audit` は **lock 全体**を読むので、**監査対象はこの 16 件**。
  - **macOS ビルドツリーへの実増分は 11 件**（`cargo tree --edges normal --prefix none | sort -u` が **315 → 326**）:
    `rodio` / `cpal` / `coreaudio-rs` / `dasp_sample` / `mach2` / `num-rational` / `num-bigint` / `num-integer` /
    `objc2-audio-toolbox` / `objc2-core-audio` / `objc2-core-audio-types`。
  - 差の 5 件（`alsa` / `alsa-sys` / `ndk-context` / `num-derive` / `objc2-avf-audio`）は Linux / Android / iOS 専用で、
    `--target aarch64-apple-darwin` のツリーには現れない（実測確認済み）。
  - objc2 系の大半・`thiserror` / `libc` / `bitflags` は Tauri が既に持っているため増分に入らない。
  ⚠ 058s の見積もり（macOS 39 / Windows 38）は**使い捨てプロジェクトで測った総数**であって本体への増分ではない。
- **`tokio` / async ランタイムを引かない**＝**「Rust は完全同期のまま」の方針を破らない**。
  実測: `cargo tree -p rodio --edges normal` に `tokio` / `async-std` / `futures-executor` が現れない。
  ⚠ `cargo tree -i tokio` は**担保に使えない**（tokio は Tauri v2 が既に保持しているので必ずヒットする）。
  再生は同期関数で行い、UI を止めないために `#[tauri::command(async)]`（＝既存の async runtime へ逃がす）に載せる。
- ⚠⚠ **`#[tauri::command(async)]` ＋ 同期 fn は tokio の worker を占有する**（レビューでソースを確認して追記）。
  `tauri-macros` が付ける tracing ラベル `"sync_threadpool"` は**ラベル文字列にすぎず**、実体は
  `tauri/src/ipc/mod.rs` の `respond_async` → **`async_runtime::spawn`**（`spawn_blocking` **ではない**）で、
  `async_runtime` は tokio のマルチスレッドランタイム。つまり**再生が終わるまで worker を 1 本ブロックする**。
  窓生成コマンドや `check_app_update` / `install_app_update` と**同じランタイムを共有する**ため、
  積み上がると IPC 全体が詰まる（可用性＝自己 DoS の論点）。
  → 058a は `audio::service` に**同時再生 1 本の上限**（`PLAYING` / `PlaybackGuard`・競合時は鳴らさず `Ok(())`）
  を持たせて構造的に塞いだ。⚠ **これはクールダウンではない**（「どの音を何秒に 1 回まで」は 059 の責務）。
  ⚠ **この上限を外さないこと。** 外すと 059 のコメント受信ごとの呼び出しで worker が積み上がる。
  契約テスト `only_one_playback_runs_at_a_time` が固定している。
- **`cargo audit` は exit 0**（2026-08-04・Cargo.lock 577 crate 走査）。
  **今回 lock に増えた 16 crate に advisory は 1 件も無い**（既存の警告 18 件＝GTK/glib 等の Linux 専用
  unmaintained/unsound は不変）。⚠ ここが「11 件」ではないのは上記のとおり `cargo audit` が lock 全体を見るため。
- ⚠ **`rodio::speakers`（`available_outputs` / `SpeakersBuilder`）は使わない**——`experimental` feature 配下。
  安定 API の `DeviceSinkBuilder::from_device(device)` → `open_stream()` 経路を使う。
- **明示的に足さないもの**: **`cpal` の直接依存**（`rodio::cpal` の再エクスポートを使う＝バージョン不整合を作らない）／
  音声デコーダ（上記）／HTTP・async 系 crate／音源アセットの同梱（`bundle.resources` を足していない＝
  `tauri.conf.json` 差分ゼロ。**同梱ファイルが無いのでパス解決もファイル I/O も存在しない**）。
- ⚠ **Windows 申し送り（098）**: cpal 0.17 は `windows` crate を `>=0.59, <=0.62` で要求する。
  ⚠ **レビューで実測して訂正した**（当初「058a のせいで 2 系統並ぶ」と書いていたが誤り）。
  `cargo tree --target x86_64-pc-windows-msvc -i windows` の実測は **0.58.0 / 0.61.3 / 0.62.2 の 3 系統**:

  | 版 | 供給元 | 058a 以前 |
  | --- | --- | --- |
  | 0.58.0 | 自前（028 の Win32 コード） | ✅ あり |
  | 0.61.3 | `tao` → `tauri-runtime-wry` → `tauri` | ✅ あり |
  | 0.62.2 | **`cpal` → `rodio`** | ❌ **058a で追加** |

  つまり **0.58 と 0.61.3 の併存は 058a 以前からの状態**で、058a が足すのは **3 本目の 0.62.2 だけ**。
  ⚠ さらに 0.x 同士は semver 非互換なので cargo は決して統合しない＝**「統一」は 098 でも達成できない**
  （028 を 0.62 へ上げても `tao` の 0.61.3 が残る＝到達点は 3→2）。098 で判断するのは統一の可否ではなく
  **ビルドサイズと重複コストを許容するか**である。なお上記の「11 crate」は **macOS の実測値**であって
  Windows の増分ではない（Windows の実増分は 098 で測る）。
- ⚠ **Windows 未検証**（058s の実測は macOS のみ）。WASAPI での実再生・デバイス名・安定 ID は 098 で確認する。

**依存の脆弱性検査（055b で初めて実施・2026-08-01）**:

本リポジトリには**依存の脆弱性検査の仕組みが存在しなかった**（`cargo audit` / `cargo deny` 未導入・Dependabot 設定なし・
CI に検査ステップなし・過去タスクにも実施記録なし）。§10 は「**理由を説明する**」ことは求めていたが、
**既知脆弱性との照合は求めていなかった**。055b で通信スタックが入るのを機に**初めて実施**した。

- **結果（`cargo audit` v0.22.2・advisory DB 1177 件・Cargo.lock の 561 crate を走査）**:
  **脆弱性（vulnerabilities）は 0 件**（exit code 0）。警告 18 件はすべて `unmaintained`(16) / `unsound`(2) で、
  **055b が増やした 30 crate には 1 件も該当が無い**。
- 警告 18 件の内訳と評価（いずれも Tauri 由来で 055b とは無関係）:
  - **13 件は Linux 専用**（`gtk` / `gdk` / `atk` / `glib` / `gtk3-macros` / `proc-macro-error` 等の GTK3 バインディングと
    `event-listener`〈zbus→D-Bus 経由〉）＝**mac/Windows のアプリにはコンパイルされない**（`cargo tree` で確認）。
    本アプリは Linux を配布対象にしていない（親 055「やらないこと」）。
  - **5 件は `unic-*`**（`urlpattern`→`tauri-utils` 経由。Tauri の URL パターン解析）。macOS でも依存グラフに現れるが、
    到達経路は `tauri-macros`（proc-macro＝**コンパイル時**）を通っており、debug バイナリの文字列走査でも
    `unic` 由来の文字列は 0 件だった。いずれも「メンテナンス停止」の警告で**脆弱性ではない**。
- **JS 側（`pnpm audit`）の結果**: **配布される依存（`--prod`）は 0 件**。ただし**開発専用の依存に 5 件**
  （high 4 / moderate 1）ある——`brace-expansion`(×3・eslint / typescript-eslint 経由・DoS)、
  `postcss`(vite 経由・パストラバーサル)、`esbuild`(sidecar のビルド用・**dev server** の問題)。
  **いずれもユーザーへ配るバイナリには入らない**（ビルド時にしか使わない）が、
  **免罪したわけではない**ので task-board の 056 に残す。

**継続的な検査（pre-commit ゲート・056・2026-08-01 導入）**:

上記は「一度きりのスナップショット」でしかなかったため、**`.githooks/pre-commit` で入口を塞いだ**
（依頼者の判断で CI ではなく pre-commit。壊れた依存を push してから CI で気づくと手戻りになるため）。

- **`Cargo.lock` / `pnpm-lock.yaml` がステージされたコミットのときだけ**走る。この条件は 2 つの問題を同時に解く:
  ①依存が変わらないコミットに時間を払わない ②どちらの audit も外部へ問い合わせるが、
  **ロックファイルを更新できた＝直前にオンラインだった**はずなので「オフラインでコミットできない」がほぼ起きない。
- **Rust は `cargo audit`（既定）**＝**脆弱性でのみ落ちる**。`unmaintained` / `unsound` の警告では落とさない
  （上記 18 件で初日から常時赤になり、hook が「無視するもの」に成り下がるため）。
- **JS は `pnpm audit --prod`**＝**配布される依存だけ**を見る（`--prod` 無しだと上記の開発依存 5 件で必ず落ちる）。
  ⚠ **`--prod` は「配布物の依存を隠す」ものではない**（レビューで実測確認）。ワークスペース全体の
  production 依存が対象で、**SEA に焼き込まれる `apps/comment-sidecar` の依存**（`ws` / `@grpc/grpc-js` /
  `obs-websocket-js` / `tsyringe` / `reflect-metadata`）も検査される。除外される 5 件はすべて
  devDependencies 経由（`esbuild` の path も `apps__comment-sidecar>esbuild`＝ビルド用）。
- **`cargo-audit` 未導入なら fail-closed**（「ツールが無い」を「問題なし」と読み替えない）。
- 仕組みは **`.githooks/` ＋ root `package.json` の `prepare` で `core.hooksPath` を設定**するだけ＝
  **husky 等の新規依存はゼロ**（§10 の方針と整合）。手動実行は `pnpm audit:deps`。
- **開発機側の新規 egress**（アプリの egress ではないが、§1 の一貫性のため記録する）: この hook により
  **`git commit` が外部通信を 2 本行うようになった**——`cargo audit` は rustsec advisory-db を GitHub から
  fetch し、`pnpm audit` は npm レジストリに問い合わせる。ロックファイルを変えるコミットのときだけ。
- ⚠ **`core.hooksPath` を設定すると `.git/hooks/*` が丸ごと無効になる**。導入時点で `.git/hooks` には
  サンプル以外が無いことを確認済み（回帰ゼロ）だが、**今後 `.git/hooks` に置いたものは黙って動かなくなる**。
  フックを足すときは `.githooks/` 側に置くこと。
- ⚠ **`prepare` は CI の `pnpm install --frozen-lockfile` でも走る**（`release.yml` に 3 箇所）。
  `actions/checkout` が `.git` を作るので `git config` は成功するが、**055a で緑を確認したリリース経路に
  未検証の副作用が 1 つ入った**状態＝`.github/` の差分がゼロでも「CI の挙動が不変」ではない。
- ⚠ **限界（塞げていないもの）**: **依存が変わっていなくても脆弱性は日々公表される**。この hook は
  「自分が依存を変えたとき」しか見ないので、**既存依存に後から報告されたものは捕まえられない**。
  それには定期実行（Dependabot／スケジュール CI）が別途要る＝**task-board の 056 に残っている**。
  また `git commit --no-verify` で飛ばせる（飛ばしたら理由を progress.md に残すこと）。
  **`git merge` / `git pull` が持ち込む依存変更も素通りする**（merge commit は pre-commit を通らない）＝
  これも定期実行でしか埋まらない（056 の残①）。

**追加した依存（060b・オーバーレイのカスタム CSS 取り込み）: ゼロ**（2026-08-05）。

- **Rust / Node / JS とも新規依存なし。** `Cargo.toml` / `Cargo.lock` / `apps/desktop/package.json` /
  `pnpm-lock.yaml` / ルート `package.json` すべて差分ゼロ。
- **CSS パーサ crate を入れなかった**（`cssparser` / `lightningcss` 等）。理由は 2 つ:
  ①本タスクが必要とするのは「トークン境界を正しく取ること」だけで、カスケードもセレクタ解釈も要らない
  （**保存するのは変換前の CSS**で、変換は注入時に frontend が行う＝ 060a の `cssCompat.ts`）。
  ②サニタイザは §1 を守る唯一の壁なので、**挙動を自分で読み切れることの価値が大きい**——
  パーサ crate に寄せると「このバージョンは `url()` のこの形をどう扱うか」が依存側の実装詳細になる。
  代わりに CSS 仕様に沿った**手書きのトークナイザ**（`overlay_theme/sanitize.rs`・約 400 行）を置き、
  敵対的入力のテスト群とミューテーションで実効性を実測している。
- ⚠ **再修正トリガー**: 手書きトークナイザで塞ぎきれない迂回が実際に見つかったら、そのときこそ
  パーサ crate の導入を検討する（その場合は §10 に理由を記録し `cargo audit` を通すこと）。
- **既存依存の利用のみ**: `rusqlite`（レジストリ）・`uuid`（ファイル名の採番）・`chrono`（時刻）・
  `ts-rs`（binding）・`tauri-plugin-dialog`（**既に導入済み**・JS 側 `@tauri-apps/plugin-dialog` も既存）。
  増えたのは `comment-viewer.json` の `dialog:allow-open` **1 件だけ**（上記「Capabilities 方針」）。

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

**046b（固定コメント専用オーバーレイ窓＝4 つ目のウィンドウ・2026-07-29）**: 046a の固定コメント（ピン留め）を OBS へ
出すため、既存の `comment-overlay` とは**独立した新ウィンドウ** `pinned-overlay` を追加した。

- **新 capability は `capabilities/pinned-overlay.json` の 1 枚のみ**（`comment-overlay.json` と同型・
  `windows:["pinned-overlay"]`・`permissions:["core:default"]`）。**`default.json` / `comment-viewer.json` /
  `comment-overlay.json` は不変**。`windows` は**ラベル完全一致**なので、`default.json` が持つ広い permission
  （`dialog:*` / `autostart:*` / `core:window:*`）はこの窓へ**継承されない**。`csp: null`・`macOSPrivateApi` 不変。
  レビューで `gen/schemas/acl-manifests.json` を展開して実体も確認済み: `core:default` の窓/webview 面は
  **すべて読み取り系**（`core:window:default` = `allow-get-all-windows` / `allow-*-position` / `allow-*-size` /
  `allow-is-*` / `allow-title` / モニタ系、`core:webview:default` = `allow-get-all-webviews` /
  `allow-webview-position` / `allow-webview-size` / `allow-internal-toggle-devtools`）で、
  **`allow-create-*` / `allow-close` / `allow-set-*` は含まれない**＝この窓の JS から窓の生成・破棄や
  他窓の操作はできない（**唯一の例外は `core:window:default` に含まれる `allow-internal-toggle-maximize`**＝
  自窓の最大化トグルのみ内部コマンドとして残る。ドラッグ領域のダブルクリック用で、この窓は読み込むのが
  ローカルバンドルのみ・外部コンテンツを踏む経路ゼロのため実害は無い）。
  未使用の `core:menu` / `core:tray` も含まれるが、既存 `comment-overlay.json` と同型で
  Tauri v2 の標準ベースラインを個別に分解する保守コストのほうが上回るため据え置く。
- **この最小権限が守るのは ACL 面だけ**（レビュー指摘）: Tauri v2 では**アプリ定義コマンドは ACL の対象外**なので、
  この窓の webview も `invoke_handler` に登録された全コマンド（`open_comment_viewer_window`＝sidecar 起動、
  `launch_tool`、`clear_viewers` 等）を呼べる。これは既存 3 窓と同じ構造で 046b が広げたものではなく、
  この窓が読み込むのはローカルバンドルのみ・外部コンテンツを踏む経路ゼロのため実害は無い。
  capability だけを見て「この窓は無害」と判断しないこと。
- **新 command は単一目的の 3 つのみ**（§3）: `open_pinned_overlay_window` / `close_pinned_overlay_window` /
  `is_pinned_overlay_open`。いずれも**引数は `AppHandle` のみ＝frontend から値を受け取らない**（ラベルは Rust 内の
  リテラル）。任意ラベル・任意オプションの汎用窓生成は露出しない。ユーザー入力が OS 操作へ渡る経路は無い（§8）。
- **表示専用・通信面ゼロ**: この窓の frontend（`PinnedOverlayApp`）は **WS へ接続しない**（`connectCommentStream` を
  呼ばない）。046a が localStorage へ書いた固定コメントを read-on-mount ＋ `storage` 購読で読むだけで、
  **新規の外部通信・宛先・Rust emit・依存はゼロ**。`author.avatar` は保存されていないためアイコンはイニシャル丸で、
  **外部 URL を踏む経路が存在しない**（036a の「webview が踏むのは data URI のみ」ガードは無傷）。
- **sidecar に触れない**: `comment-overlay` と同じく window イベント（sidecar 連動）を
  **登録しない**ので、この窓を閉じても sidecar は落ちない。`close_pinned_overlay_window` は自アプリのウィンドウを
  閉じるだけで、**PID kill・プロセス名 kill は行わない**（§6 の PID kill はそもそも発生しない）。
  ⚠ **061b で「no-orphan kill 契機は不変」ではなくなった**（061b レビュー②S-4）。kill 契機は
  `comment-viewer` / `effect-overlay` の 2 点（下記 061a 節「sidecar の停止条件」）へ広がっている。
  ただし**この窓はそこに入っていない**ので、上記「閉じても落ちない／開いていても延命しない」は 046b から真のまま。
- **窓タイトルは `StreamDock 固定コメント`**。044a の自動ソース追加は窓名の `includes` 一致で対象窓を探すため、
  **2 つの窓名が互いに部分文字列にならない**ことが必須条件（「StreamDock 固定コメント」は
  「StreamDock コメントオーバーレイ」を含まない＝取り違えない）。
  **⚠ 046b 実装時点の「この窓は 044a の自動追加の対象外＝手動ウィンドウキャプチャ前提・sidecar 側は不変」という
  記述は 046d で失効した**（上記 §1「例外（044a…）」の 046d 節が正）。046d で `obs-client.ts` / `index.ts` を改変し、
  この窓も自動追加の対象になっている。したがって上記の窓名要件は「紛れないと分かりやすい」ではなく
  **自動追加が窓を取り違えないための機能要件**として、いっそう厳格に守ること。
- **新規 localStorage キー `stream-dock.comment-viewer.pinned-overlay-enabled`** はトグルの ON/OFF（boolean）＝
  **ユーザー自身の UI 設定値**で、`obs-auto-add` と同種。§9 追補（046a）が対象とする第三者の個人データではないため、
  下記「レビュー必須条件」の localStorage 追補には**該当しない**。
- **新規ウィンドウ＋新規 capability＋新規 command のため security-review 必須**（2026-07-29 実施・判定「軽微な懸念あり」・
  修正必須 0 件）。指摘は「永続 ON のときコメビュ本体のマウントで窓が自動オープンする＝**このセッション中に
  ユーザー操作なしで窓が開く経路が 1 本増える**」の 1 点。045c が削除した経路と逆行するが、①起点は明示的な永続設定
  （既定 OFF）②開く窓は表示専用で**新規通信・OBS 接続・sidecar 起動をいずれも伴わない**（045c が問題視した
  「設定 ON が OBS への接続契機になる」点とは無関係）ため許容した。**自動 close は作っていない**
  （親 046 の「ピン 0 件で窓が消えると OBS ソースが壊れる」を守るため・設定 OFF で窓が開いていても閉じない）。

**055b（tauri-plugin-updater を追加するが updater 権限はゼロ・2026-08-01）**: アプリ自己アップデートのため
`tauri-plugin-updater` を Rust 依存に追加したが、更新チェック（055b）と DL/インストール（055d）はいずれも
Rust の `app.updater_builder()` から行い IPC を通らないため、**4 枚の capability いずれにも `updater:*` /
`process:*` permission を一切追加しない**（`default.json` / `comment-viewer.json` / `comment-overlay.json` /
`pinned-overlay.json` は**差分ゼロ**）。**032c-b の「`tauri-plugin-shell` を入れつつ `shell:*` をゼロ付与」と
完全に同型**の構え。

- **JS 側 `@tauri-apps/plugin-updater` を入れない**（入れると `updater:default` をメイン窓へ配る必要が出る）。
  再起動は `AppHandle::restart()` を使い **`tauri-plugin-process` も入れない**（`process:allow-restart` を配らずに済む）。
  `csp: null` 不変。JS 側の依存は 1 つも増えていない（§10）。
- **新 command は単一目的の 1 つのみ**（§3・055b 時点）: `check_app_update`（読み取り専用・ファイルを 1 バイトも書かない）。
  **引数は `AppHandle` のみ＝frontend から値を受け取らない**（宛先も現在バージョンも Rust /`tauri.conf.json` 側が持つ）。
  **DB State を取らない**（`extract_app_icon` と同じ最小権限）。ユーザー入力が OS 操作・外部通信へ渡る経路は無い（§8）。
  **055d で `install_app_update` / `restart_app` の 2 本が加わった**（どちらも引数は `AppHandle` のみ・
  下記 055d 節を参照）。
- **⚠ この最小権限が守るのは ACL 面だけ**（046b と同じ限界・レビュー指摘の再掲）: Tauri v2 では
  **アプリ定義コマンドは ACL の対象外**なので、`check_app_update`（および 055d の `install_app_update` /
  `restart_app`）は **コメビュ窓・オーバーレイ 2 窓を含む 4 窓すべての webview から呼べる**。
  これは既存 3 窓と同じ構造で 055b が広げたものではなく、いずれの窓もローカルバンドルしか読み込まず
  外部コンテンツを踏む経路がゼロ（オーバーレイが踏むのは data URI のみ）のため実害は無い。
  **capability だけを見て「この機能はメイン窓に閉じている」と判断しないこと。**
- **本体プロセス初のインターネット egress ＋ network/http crate ＋ auto update 系のため security-review 必須**
  （詳細は §1 の「例外（055・アプリ自己アップデート）」と §10 を正とする）。

**055d（進捗イベントを導入するが capability は不変・2026-08-02）**: DL 進捗を frontend へ流すため
**リポジトリで初めて Tauri のイベント機構**（Rust の `Emitter::emit` / JS の `listen`）を使ったが、
**4 枚の capability はいずれも差分ゼロのまま**。

- **根拠（実測）**: `core:default` は `core:event:default` を含み、`core:event:default` は
  `allow-listen` / `allow-unlisten` / `allow-emit` / `allow-emit-to` を含む
  （生成物 `src-tauri/gen/schemas/acl-manifests.json` と、`tauri` crate の `build.rs` が
  `PLUGINS` から `core:default` を生成している実装で確認）。**4 枚すべてが `core:default` を持っている**ので、
  `listen` のために追加する permission は無い。
- **⚠ 進捗イベントは全窓へブロードキャストされる。** `app.emit()` は全 webview に配信する。
  `emit_to(EventTarget::webview_window("main"), …)` に**絞っても実際には絞れない**——
  tauri の `match_any_or_filter` は「リスナ側が `EventTarget::Any` で登録していれば emit のフィルタを
  無条件に素通しする」実装で、`@tauri-apps/api` の `listen()` はオプション省略時にまさに `Any` で登録する。
  ＝**絞ったつもりの記録だけが残る**ので、素直にブロードキャストしている。
  実際にメイン窓しか受け取らないのは「`MainWindowApp` でしか購読していない」という**アプリ側の構造**によるもので、
  イベント機構による保証ではない。**ペイロードは受信済みバイト数・総バイト数・フェーズの 3 つだけ**で、
  URL・ローカルパス・バージョン・環境情報を含まない（§9。キー集合の完全一致を Rust のテストで固定）。
- **⚠ `core:event:allow-emit` も既定で配られている＝webview 側から同名イベントを偽造できる。**
  偽の進捗が表示されるだけで何のアクションも起こらないが、
  **完了判定はイベントではなく invoke の resolve で行う**という不変条件を守ること
  （`useAppUpdate` は実行中フラグが立っていないときの進捗イベントを捨てる）。
  ⚠ **緩和はこれだけでは足りない**（055d review S-5）。**実行中は進捗イベントを信頼している**ので、
  偽イベントを送り続けると「plugin 内部の panic から抜ける唯一の逃げ道」である 120 秒 watchdog を
  **永久に張り直させて無力化できる**。そのため `useAppUpdate` は
  **進捗では絶対に延長されない上限**（`INSTALL_DEADLINE_MS`）を別に 1 本張っている。
- **⚠ `install_app_update` は 4 窓すべてから呼べる**（上の 055b と同じ限界）。055d でこれは
  「実際にインストールを起こせるコマンド」になったため、Rust 側にも同時実行ガード
  （`INSTALL_IN_FLIGHT` / `InstallGuard`）を置いて**走行中の 2 本目は何もせず返す**ようにした。
  ⚠ これは**多重実行を防ぐだけで、呼べること自体は防いでいない**
  （アプリ定義コマンドは ACL の対象外なので、Tauri v2 では構造的に防げない）。
  **capability だけを見て「更新はメイン窓に閉じている」と判断しないこと。**
- **JS 側 plugin ゼロ・`tauri-plugin-process` 不採用・`csp: null` 不変**は 055b から変わらない。

**060b（`comment-viewer.json` に `dialog:allow-open` を 1 件だけ追加・2026-08-05）**: オーバーレイの
カスタム CSS テーマを取り込む UI（060d）をコメビュ窓の設定ビューに置くため、`comment-viewer.json` に
**`dialog:allow-open` を 1 件だけ**追加した（**リポジトリで初めて `comment-viewer.json` が `core:default` 以外を持つ**）。

- **これ以外は増やしていない**: `dialog:allow-save` も `fs:*` も足さない。
  `default.json`（main）/ `comment-overlay.json` / `pinned-overlay.json` は**差分ゼロ**。
  `windows` はラベル完全一致なので、この permission が他窓へ継承されることもない。
  `csp: null`・`tauri.conf.json` 不変・**新規依存ゼロ**（CSS パーサを入れず手書きのトークナイザにした・§10）。
- `dialog:allow-open` が許すのは**ネイティブのファイル選択ダイアログを出すこと**だけで、
  返るのは**ユーザー自身が選んだパス文字列**。**その先の検証はすべて Rust 側**にあり
  （拡張子・実在・種別・サイズ・UTF-8・制御文字。§5 の 060b 例外節）、frontend は生パスを持てても
  それでできることが「`.css` を 1 つ取り込む」以外に無い。
  ⚠ `open()` は `directory: true` でディレクトリも選べるが、Rust 側が `is_file()` で弾く。
- **⚠ この最小権限が守るのは ACL 面だけ**（046b / 055b と同じ限界の再掲）: Tauri v2 では
  **アプリ定義コマンドは ACL の対象外**なので、060b が足した 5 本
  （`import_overlay_theme` / `list_overlay_themes` / `get_overlay_theme_css` /
  `rename_overlay_theme` / `delete_overlay_theme`）は**全 4 窓の webview から呼べる**。
  capability だけを見て「テーマ機能はコメビュ窓に閉じている」と判断しないこと。
  そのぶん**コマンド自体を狭く作る**ことで担保している（§5 の 060b 例外節の「担保の柱」）。
- **`get_overlay_theme_css` が全 4 窓から呼べることは受容する。** 理由:
  ①**read-only**で、返すのは**ユーザー自身が取り込み、サニタイザを通った CSS** だけ
  ②**frontend からパスを受け取らない**（id → DB → `file_name` の検証 → 固定ディレクトリ配下、の 2 段検証）
  ③256KB 上限があり、内容に秘密情報は無い（ユーザー自身のスタイルシート）
  ④そもそも **3 窓が実際に必要とする**——`comment-overlay`（注入先）・`comment-viewer`（060d のプレビュー）・
  `pinned-overlay`（将来の拡張余地）。得るものが無いのは `main` だけ。
- ⚠⚠ **`import_overlay_theme` ＋ `get_overlay_theme_css` の合成が「`*.css` 限定の任意ファイル読み取り」に
  なることは受容している**（§5 の 060b 例外節に受容理由と再修正トリガーを記載）。**capability を見て
  「読み取り経路は無い」と判断しないこと。**
- **新規 capability ＋ ユーザー提供コンテンツの取り込みのため security-review 必須**
  （2026-08-05 実施・判定「軽微な懸念あり」・指摘 3 件を反映 → **同日 security-review②（外部レビュー）実施・
  判定「修正必須」・指摘 8 件を反映済み**。詳細は `docs/progress.md` の 060b 節）。

**061a（エフェクト専用オーバーレイ窓＝5 つ目のウィンドウ・2026-08-09）**: 061 のエフェクト（061b の
組み込み投げ銭エフェクト、061c/061d のテンプレート）を配信へ載せるため、既存 2 オーバーレイとは
**独立した新ウィンドウ** `effect-overlay` を追加した。046b（`pinned-overlay`）と同型。

- **新 capability は `capabilities/effect-overlay.json` の 1 枚のみ**（`pinned-overlay.json` と同型・
  `windows:["effect-overlay"]`・`permissions:["core:default"]`）。**既存 4 枚（`default.json` /
  `comment-viewer.json` / `comment-overlay.json` / `pinned-overlay.json`）は差分ゼロ**。
  `windows` は**ラベル完全一致**なので、`default.json` が持つ広い permission（`dialog:*` / `autostart:*` /
  `core:window:*`）はこの窓へ**継承されない**。`csp: null`・`macOSPrivateApi`・`tauri.conf.json` 不変。
  `core:default` の実体（窓/webview 面はすべて読み取り系）は 046b 節の調査が正で、061a で変わっていない。
- ⚠⚠ **「capability だけを見て『この窓は無害』と判断しない」の適用対象が 1 窓増えて 5 窓になった。**
  Tauri v2 では**アプリ定義コマンドは ACL の対象外**なので、この窓の webview も `invoke_handler` に
  登録された全コマンド（`open_comment_viewer_window`＝sidecar 起動、`launch_tool`、`clear_viewers`、
  `install_app_update`、`import_overlay_theme` 等）を呼べる。これは既存 4 窓と同じ構造で 061a が
  広げたものではなく、この窓が読み込むのはローカルバンドルのみ・**外部コンテンツを踏む経路ゼロ**
  （061a 時点では data URI すら踏まない＝表示するのは静的なセットアップ用ガイドだけ）のため実害は無い。
  ⚠⚠ **この受容根拠には失効条件がある**（061a レビュー S-3 で明示化）——**061c/061d でこの窓が
  第三者テンプレートのアセット（画像/GIF/APNG/WebM/音源）を読み込んだ時点で、「外部コンテンツを踏む
  経路ゼロ」は真でなくなる。** 親 061 の決定（HTML/CSS/JS は実行しない）によりコード実行にはならないが、
  「ACL 対象外＝全コマンドを呼べる窓に、第三者由来のデータを持ち込む」変更であることに変わりはないので、
  **061c の security-review でこの節を必ず再評価すること**（再評価せずに通したら、それ自体が指摘対象）。
- **新 command は単一目的の 3 つのみ**（§3）: `open_effect_overlay_window` /
  `close_effect_overlay_window` / `is_effect_overlay_open`。いずれも**引数は `AppHandle` のみ＝
  frontend から値を受け取らない**（ラベルは Rust 内のリテラル）。任意ラベル・任意オプションの汎用窓生成は
  露出しない。ユーザー入力が OS 操作へ渡る経路は無い（§8）。
- **読み取り専用接続（⚠⚠ 061b で 061a の決定を反転した）**: この窓の frontend（`EffectOverlayApp`）は、
  コメビュ窓・`comment-overlay` 窓と**同じ既存の loopback WS**（`ws://127.0.0.1:<port>`）へ
  `connectCommentStream` で**読み取り専用接続**する（`onComments` のみ・制御フレームは 1 つも送らない）。
  **新規宛先・新規 WS プロトコル・Tauri イベント・依存はいずれもゼロ**（`OverlayApp` と同じ立場）。
  ⚠⚠ **この窓は第三者のコメント本文を受け取る。** 061a の「そもそも WS を張らない」という担保は
  失われたので、代わりに次を満たすこと: **本文とアバターを描かない・state や localStorage に保存しない・
  ログに出さない**、**エフェクトへ渡す値（投稿者名 / 金額 / 種別 / 配色キー）に本文とアバターを含めない**、
  **`record_comment` 等の DB 経路へ流さない**。
  ⚠ **マウント時に過去のエフェクトを再生する経路を作らないこと**（何も永続しないので再生する対象が
  存在しない、という構造で担保する）。**061c/061d で永続層を足すときは、この前提を必ず再評価すること。**
- **sidecar の停止条件（⚠⚠ 061b で拡張した）**: sidecar を止めるのは次の 2 つ。
  ①**`comment-viewer` と `effect-overlay` のどちらも存在しなくなったとき**
  （判定は Rust 側で `get_webview_window` により**実窓**を見る。frontend の設定値は信用しない＝§8）
  ②**アプリ終了（`RunEvent::Exit`・無条件）**。
  **起動契機は `open_comment_viewer_window` の 1 箇所のまま**（エフェクト窓は sidecar を起動しない）。
  ⚠⚠ **①の判定では「閉じようとしている窓」を必ずラベルで除外すること。** Tauri v2 の実装では
  `CloseRequested` のハンドラが走る時点で**自窓はまだ `get_webview_window` に居る**（`Destroyed` では既に居ない）。
  除外を外して「実窓を見ればよい」と単純化すると、**どの窓を閉じても sidecar が落ちなくなる**（＝孤児が残る）。
  ⚠ これは Tauri のイベント発火順に依存する前提なので、**Tauri を上げるときはここを再確認すること**
  （`RunEvent::WindowEvent` と per-window ハンドラの前後関係が変わると壊れる側に倒れる）。
  ⚠ **①の変更は「取得＝外部通信がいつ止まるか」も同時に変える**。§1 の「取得の停止条件」を必ず併せて読むこと。
  ⚠⚠ **「どの窓も無くなったら必ず落ちる」を崩さないこと**が §6 の趣旨（孤児プロセスを残さない）に対する
  担保である。とくに②は**アプリ終了経路での唯一の担保**なので（`app.exit(0)` は個々の窓の
  `CloseRequested`／`Destroyed` を配送しない）、**無条件のまま維持すること**。
  sidecar 側の ppid 監視 self-exit を担保に数えないこと。
  `comment-overlay` / `pinned-overlay` は**この判定に含めない**（含めると停止条件が緩む＝孤児が残る方向）。
  `close_effect_overlay_window` は自アプリのウィンドウを閉じるのみで、**PID kill・プロセス名 kill は行わない**。
- **窓タイトルは `StreamDock エフェクト`**。044a/046d の自動ソース追加は窓名の `includes` 一致で対象窓を
  探すため、**3 つの窓名が互いに部分文字列にならない**ことが**機能要件**（壊れると `ensureOverlaySource` の
  M2 フォールバックで `"reused"`＝成功として返り、UI は成功表示・OBS は真っ黒という静かな失敗になる）。
  `lib.rs` の `#[cfg(test)] mod overlay_window_contract`（**046d の `pinned_overlay_contract` から改名**）が
  **総当たりループ**で固定している＝窓を増やしても組み合わせを取りこぼさない。
- **`ObsOverlayKind` は固定 union のまま**（`"comments" | "pinned" | "effects"`）。viewer からは識別子しか
  渡せず、実ソース名／窓名は sidecar 内の `OBS_OVERLAYS` に閉じている（§3/§8）。
  ⚠ 046d の `parseOverlayKind`（未検証 JSON を固定 union へ落とす allow-list＝**実質的な唯一の
  セキュリティ制御**。loopback WS は未認証なので同一 PC の任意プロセスが制御フレームを送れる）は
  `index.ts` から `obs/obs-client.ts` へ移し、**`OBS_OVERLAYS` から導出する形**にした。
  これにより「表を増やしたのに検証側を更新し忘れる」が構造的に起きない。
  ⚠⚠ 照合は **`Object.keys` の配列に対する `includes`** でなければならない——`v in OBS_OVERLAYS` や
  `OBS_OVERLAYS[v] !== undefined` にすると `"__proto__"` / `"constructor"` / `"toString"` が
  **プロトタイプ経由で真になり fail-open する**。`scripts/test-obs-client.mjs` がこの 3 つを名指しで固定済み
  （046d 時点は `index.ts` にあり import 不能＝**検証ゼロ**だった）。
  ⚠ `obs/obs-helpers.ts` と `host-guard.ts`（fail-closed 層）は**差分ゼロ**。
- **新規宛先ゼロ**（§1）。OBS は既存の loopback（`ws://127.0.0.1:<port>`）で `assertAllowedObsUrl` を通る
  経路のまま。`enable` / `hide` / `disable` / `ensureOverlaySource` のロジックは 1 行も変えていない。
- **新規 localStorage キー 2 本**（`...effect-overlay-enabled` / `...effect-obs-auto-add`）はいずれも
  トグルの ON/OFF（boolean）＝**ユーザー自身の UI 設定値**で、`obs-auto-add` /
  `pinned-overlay-enabled` と同種。§9 追補（046a）が対象とする第三者の個人データではないため、
  下記「レビュー必須条件」の localStorage 追補には**該当しない**。
- ⚠ **構造上の制約と、そこから来る 2 つの新しい経路**（軽 security-review 2026-08-09 で記録）:
  - `obs-enable` を送れるのは WS ハンドルを持つ**コメビュ窓だけ**で、sidecar のライフサイクルも
    コメビュ窓に紐づく。一方エフェクト画面は main 窓（親 061 の決定）。よって **main 窓は設定を
    localStorage に書くだけ**で、送出はコメビュ窓が 046b と同じ二段構え（マウント時 reconcile ＋
    `storage` 購読）で代行する。**main 窓から sidecar WS へ繋ぐ案は採らなかった**——
    `connectCommentStream` は `onComments` 必須なので**第三者のコメント本文が main 窓へ流れ込む**（§9 の後退）、
    かつ `get_comment_stream_port` が null の間**毎秒 invoke が永久ループ**するため。
  - **(1) main 窓に「コメントビューアを開く」導線を足した**（`windowApi.openCommentViewerWindow`＝
    既存 `open_comment_viewer_window` の薄いラッパ・新規 Rust ゼロ）。main 窓が sidecar を起動できること
    自体は既存の構造（`MainScreen` が `launchTool` 経由で同じことをしており、アプリ定義コマンドは
    ACL 対象外）で、061a は**明示的な UI 導線を 1 本足しただけ**。
  - **(2) アプリ起動時（`MainWindowApp` のマウント）に、永続設定が ON なら窓を開き直す。**
    046b で指摘された「ユーザー操作なしに窓が開く経路が 1 本増える」に該当する。許容根拠は 046b より
    明確に強い: ①起点は明示的な永続設定（**既定 OFF**）②開く窓は **061a 時点では完全に空**
    （第三者の個人データを 1 バイトも描かない）③新規通信・OBS 接続・sidecar 起動をいずれも伴わない。
    ⚠ **061b でこの窓が投稿者名と金額を描くようになるが**、061b の設計は「届かなかったら諦める・
    マウント時に過去のエフェクトを再生しない」なので、**起動時に前回配信の第三者データが出る経路は
    生まれない**（046b が踏んだ S-1 とはここが決定的に違う）。**061b のレビューでこの前提を再確認すること。**
    ⚠⚠ **061a レビュー S-1**: この前提は 061a 側の 3 箇所（本節 / task-board / 061a タスクファイル）に
    書かれていた一方、**061b の仕様書には「保証ベースライン＝エフェクト窓のマウント時に読む」という
    逆を指示する箇条書きが残っていた**（同ファイル内で矛盾していた）。字面どおり実装されると S-1 が
    そのまま再発するため、**061b 側の記述を「`storage` 購読の一段だけ」に修正済み**
    （[`docs/tasks/061b-monetary-effect-builtin.md`](tasks/061b-monetary-effect-builtin.md) の「(2) 窓間伝達」）。
    ⚠ **その後の 2026-08-09 の仕様変更（エフェクト窓の WS 直結）で localStorage 経路自体が廃止されたため、
    この懸念は構造的に消滅した**（保存しないので再生する対象が存在しない）。
    ⚠ ただし「**接続直後に過去分を遡って発火しない**」は WS 経路でも要件として残る。
- **新規ウィンドウ＋新規 capability＋新規 command のため security-review 実施**
  （2026-08-09・**外部レビュー**・判定「**軽微な懸念あり**」・修正必須 2 件〔いずれもドキュメント・対応済み〕・
  後回し可 2 件、あわせて品質指摘 10 件〔要修正 4・コメントのみ 6〕。044a / 046d と同型のため軽め）。
  - 修正必須 **S-1**（上記）＝061b 仕様書の矛盾行。**対応済み**（061b を「`storage` 一段のみ」に修正）。
  - 修正必須 **S-2** ＝ security.md / progress.md / task-board / 061a タスクファイルの 4 箇所が、
    **レビュー実施前に「判定『問題なし』・修正必須 0 件」を確定事項として記録していた**。
    セキュリティ記録に未実施のレビュー結果が入ると「レビュー済みだから見なくてよい」の材料になるため、
    本行を含む 4 箇所を実際の結果へ差し替えた。**以後、実施前に書く場合は「実施予定」と明記すること。**
  - 後回し可 S-3（上記の失効条件・追記済み）／ S-4（loopback WS 未認証。061a で姿勢は不変・記録のみ）。
  - ⚠ コード上のセキュリティ欠陥は **0 件**（新規宛先ゼロ・fail-closed 層の差分ゼロ・capability 最小・
    `parseOverlayKind` の allow-list が fail-closed・§9 該当なしを、いずれも実差分で確認済み）。

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

### 060b（ユーザー CSS を注入しても「外部 style / image を読み込まない」が保たれる根拠）

060 でユーザーが持ち込んだ CSS をオーバーレイ窓へ注入するようになるが、上記「外部リソースを読み込まない」は
**取り込み時に外部参照を保存できないようにする**ことで保たれる。`csp: null` は不変。

⚠⚠ **この除去は多層防御の 1 枚ではなく、唯一の壁である**（060a レビュー S-3 / S-4）。理由を先に書く:

- **CSP は安い代替にならない。** `img-src 'self' data:` を効かせれば構造的に塞げるが、
  **Tauri v2 の `csp` はアプリ全体に 1 つ**しか無く、`comment-viewer` 窓は Twitch / YouTube / VOICEVOX /
  OBS への `connect-src` を要する＝**オーバーレイ窓だけに効かせられない**。
- **060a のセレクタ契約が「的」を作っている。** 安定クラス（`.sd-comment` / `.sd-comment-icon` 等）により、
  ユーザー CSS は**オーバーレイの全要素を文書化された名前で確定的に狙える**。
  とくに `.sd-comment-icon` は **036a の「webview が踏むのは data URI のみ」を背負っている要素そのもの**で、
  除去に穴があると 036a の不変条件がその要素の上で破れる。
- **除去漏れの被害＝オーバーレイ窓から外部 GET が飛ぶ＝ §1 の直接違反。**
  → **「念のための処理」として緩めないこと。**

**方式は deny-list ではなく allow-list（＝そもそも保存できない）。**
「`http…` / `//…` に見えるものを消す」という当初案は **CSS エスケープで自明に破れる**
（`@import "\68ttps://evil/a.css"` は `\68`→`h`、文字列内の `\`＋改行は行継続として消える）。
「URL が何に見えるか」で判定する方式は復元が必要で、しかも**見落としが「残す側」＝危険側に倒れる**。
allow-list ではこれが反転し、**難読化された時点で自動的に除去される**。

| 位置 | 保存されるか |
|---|---|
| `@import`（`url()` 形・素の文字列形・**`data:` 形も**） | **保存されない**（無条件で除去） |
| `@namespace` | **保存されない** |
| 宣言値の `url(…)` | **エスケープ無し・制御文字無し・`#` 無し・ASCII 大小無視で `data:` 始まり**のときだけ保存される |
| **裸の文字列を URL 化しうる関数**＝`image-set()` / `-webkit-` / `-moz-` / `-o-` の各 image-set / `image()` / **`src()`** | **保存されない**（中身に関わらず宣言ごと除去） |
| ブロック系アットルールのプレリュード内の**取り除けない**参照（`@media (…url(http…))`） | **取り込み自体を拒否**（fail-closed） |

- ⚠ **`@import` では `data:` も許さない。** `@import url("data:text/css,@import url(https://evil)")` は
  **入れ子の `@import` をブラウザが辿る**＝ egress になるため。`data:` の許可は宣言値の `url()` 位置に限る。
- ⚠ **裸の文字列を URL として扱う関数は中身に関わらず落とす。** `image-set()` は
  `--a:"https://evil"; background-image:image-set(var(--a) 1x)` という **`var()` 経由の密輸**が成立する。
  宣言ごと落とせば、カスタムプロパティ側へ隠す形も同時に閉じる。
  ⚠⚠ **この表は「engine が実装済みか」で決めてはいけない**（2026-08-05 security-review②）。
  CSS Values 4 の **`src()`** は `<string>` を取り **`var()` 置換可能であることが存在理由**の URL 関数で、
  現在どの engine も未実装なだけ。**出荷された瞬間にコードを 1 行も変えずに壁が開く**ので先に載せてある。
  **再修正トリガー＝新しい CSS の画像 / URL 関数が仕様に入ったら、実装状況を問わず表へ足す。**
- ⚠ **プレリュードで拒否するのは「取り除けない参照」だけ**（2026-08-05 security-review②）。
  許可形の `data:` しか含まない `@supports (background:url(data:…)){…}` や、実在するサポート検出
  `@supports (background-image:-webkit-image-set(url(a.png) 1x)){…}` まで拒否していたのを改めた
  （前者は**外部参照が 1 つも無いのに「外部参照が…」と誤診断して全拒否**していた）。
- ⚠ **識別子の判定に非 ASCII を含めない**（2026-08-05 security-review②）。含めると貪欲読みと相まって
  `<NBSP>url(https://evil…)` が 1 つの識別子として扱われ、**除去も残留検証もすり抜ける**
  （`@import<NBSP>url(…)` は at-keyword ごと外れて文が丸ごと残っていた）。css-syntax-3 では
  U+00A0 / U+00D7 / U+2003 などは ident code point ではないので、仕様どおりの実装は分割して
  `url(` を url-token として読む＝ egress。**ASCII に絞ると過剰除去にしか倒れない。**
- ⚠ **`data:` にフラグメント（`#`）があるものも落とす**（security-review で追加）。`data:` を許す根拠は
  「SVG を**画像として**読む経路は **secure static mode** になり外部参照が仕様上禁止される」ことだが、
  **`filter:` / `mask:` / `clip-path:` は SVG を「リソース文書」として読む**のでその保証が及ぶとは限らない。
  リソース参照は必ずフラグメントを要するので、`#` を落とせばこの経路がまとめて閉じる。
- ⚠ **相対 URL（`url(/x.png)`）は egress ではない**（webview のオリジンは Tauri のカスタムプロトコル）。
  それでも allow-list により除去される＝規則を 1 本に保つため。**「相対だから安全」と読み替えないこと**——
  **`url(//evil/x.png)`（プロトコル相対）は Windows では実 egress になる**（オリジンが `http:` のため）。
- **除去後にもう一度出力を走査し、許可形以外の url 位置が 1 つも残っていないことを表明する**（残留検証）。
  残っていたら取り込みを拒否する。⚠ 同じトークナイザを使うのでトークナイザ自体のバグは検出できないが、
  **ブロック構造の解釈がずれた場合は「url が漏れる」ではなく「取り込みが拒否される」へ劣化する**。
  ⚠⚠ **この限界は理論上の話ではない**（2026-08-05 security-review②）——非 ASCII の識別子境界と `src()` の
  欠落は、**どちらも残留検証を素通りした**（`find_residual_violation` が同じトークナイザ・同じ関数表を
  使うため）。**「第 2 の検査を別方式で作る」案は採らない**: 粗い正規表現を最終アラームに足すと、
  正当な `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'>` が必ず引っかかり
  （実サンプルで確認）、除外規則を積むと結局トークナイザが二重になる。
  代わりに**「url 位置を作りうる関数の表」を doc に固定し、再修正トリガーを明記する**方針を採った。
- ⚠ **除去した `@import` 先として frontend へ返すのは `http://` / `https://` の絶対 URL だけ**
  （2026-08-05 security-review②）。この一覧は 060c の同意ダイアログに**そのまま出る＝ユーザーが取得を
  許可するか判断する唯一の材料**なので、取得できない形（相対 / `data:` / `javascript:` / `file:`）と、
  **bidi / format 文字**（U+202E 等。`char::is_control` では弾けず `https://evil.example/<U+202E>…` で
  **別ホストに見える表示**を作れる）を載せない。⚠ 載せなかったぶんも件数には数えられている。
- **担保は敵対的入力のテスト＋ミューテーション**（CSS エスケープ `\75 rl(` / `u\72 l(` / `\000075rl(` /
  `@\69 mport`、大文字、コメント挿入 `@import/**/url(…)`、文字列内の行継続、`var()` 密輸、
  カスタムプロパティ、未終端の文字列・コメント・`url(`、深い入れ子）。**新規依存ゼロ**（CSS パーサを入れず、
  仕様に沿った手書きのトークナイザにした・§10）。

⚠ **060d への条件**: 060b は `</style>` を含む CSS も**そのまま保存する**（`content: "</style>"` は正当な CSS で、
除去すると壊れるため）。したがって **注入は必ず `<style>` の `textContent` で行うこと**——`innerHTML` に入れると
DOM を閉じられる。この不変条件は 060d の責務で、下記「レビュー必須条件」に既に書かれている。

### 060d（注入する側の実装 —— ⚠ プレビューは**特権窓**の中で第三者 CSS を走らせる）

060d が実際の注入を実装した。ここで**構図が 1 つ増えている**——060b 節が想定していたのは
「オーバーレイ窓（表示専用）に第三者 CSS を当てる」だけだったが、060d の**プレビュー**は
**設定 UI のある `comment-viewer` 窓の `<head>` に第三者 CSS を注入する**。
＝ **060b のサニタイザが守るのは egress だけ**であり、それ以外の被害はこの節の担保が受け持つ。

- **注入経路は `<style>` の `textContent` だけ**（`createElement("style")` は 2 か所＝オーバーレイ注入と
  プレビュー）。`innerHTML` / `dangerouslySetInnerHTML` / `insertRule` / `adoptedStyleSheets` /
  `document.write` / `new CSSStyleSheet` / `replaceSync` は**リポジトリ全体で禁止**。
  ⚠ この不変条件は**ランタイムテストでは殺せない**（jsdom は `<style>.innerHTML` に RAWTEXT の
  フラグメント解析を実装しておらず `textContent` と同じ結果になる）。守っているのは
  `scripts/check-css-guards.mjs` の **(10-i)** だけなので、**消さないこと**。
  (10-i) は `src/` 全体の禁止 ＋ `<style>` / `<link>` 生成箇所の allow-list（2 ファイル）の 2 本立てで、
  **4 つ目の注入先が増えたら落ちる**（＝ここが落ちたら、まず本ファイルのレビュー必須条件を読むこと）。
  ⚠ 禁止リストは `innerHTML` 系だけでなく **`insertAdjacentHTML` / `setHTMLUnsafe` / `parseHTMLUnsafe` /
  `createContextualFragment` も含む**（security-review②・2026-08-05 に追加）。これらは
  **`createElement` を経由しない**ので allow-list 側も素通りしてしまう
  （`head.insertAdjacentHTML("beforeend", "<style>" + css + "</style>")`）。
  ⚠ 逆に **`innerHTML` の「読み取り」は禁止していない**（既存テストが「外部 URL が DOM に出ていないこと」の
  assert に使っており、読みを禁じるとその assert を弱い形へ書き換えさせることになるため）。
  ⚠ 既知の限界＝`stripTsComments` は文脈なしで `//` を消すので、**文字列中の `//` 以降を行ごと見落とす**。

- **窓ごとの扱いが非対称**: オーバーレイ窓は**前置しない**（窓が分かれているので閉じ込める相手がいない）。
  プレビューだけ `cssScope.ts` の `scopeSelectors` でラッパ（`.sd-preview`）配下へ閉じ込める。

- ⚠⚠ **プレビューの担保は 3 枚あり、それぞれ別のものを守っている**（2026-08-05 security-review）:
  1. **`scopeSelectors`（どの要素に当たるか）** —— ⚠ 初版は実 CSS パーサと desync して破れた。
     原因は「無引用 `url(` トークンを不透明に扱っていない」「CSS エスケープ（`\`）を扱っていない」の 2 つで、
     `url(data:text/css,/*)` や `--x:\{` は **060b のサニタイザを `stripped_count=0`・無改変で通過する**
     （実測）ため、サニタイザは壁にならない。修正済み（ident / url をトークンとして読む）。
     ⚠⚠ **1 回目の修正では閉じていなかった**（security-review②・2026-08-05・第三者。仕様トークナイザ
     `@csstools/css-tokenizer` を oracle に実測）。取りこぼしは 2 系統で、どちらも同じく
     `stripped_count=0`・無改変で通り、末尾に `}` を 1 つ足せば `unclosedBlockDepth` も 0 になった:
     ① **`\` ＋改行は valid escape ではない**（delim トークン）のに ident へ飲み込んでいたため、
     直後の `url(` の不透明扱いが起動しなかった（`.a{color:\`＋改行＋`url(data:x,{)}`）
     ② **at-keyword の名前のエスケープを復元していなかった**ため、`@med\69 a`（＝ブラウザにとって `@media`）が
     グループ規則と認識されず、中の規則に前置されなかった（`@suppo\72 ts` / `@lay\65 r` / `@containe\72` /
     `@scop\65` も同型）。あわせて `@starting-style` が `GROUP_AT_RULES` から漏れていた。
     いずれも修正済み（`isIdentStart` / `readIdent` / `atRuleName` の注記が正）。
     ⚠⚠ **教訓＝この走査器は「1 か所直したら閉じた」と考えないこと。**
     検証は**仕様トークナイザとの差分**でしか成立しない（目視・自作コーパスだけでは 2 回とも漏れた）。
     ⚠ **`cssCompat.ts` の `scanPreludes()` には同じ穴が残っている**が、ずれる向きは安全側の片方向
     （変換された規則は必ずスコープされる）。**向きを逆転させないこと。**
  2. **`.themePreview` の `contain: paint`（どこに描かれるか）** —— `overflow:hidden` だけでは
     `position:fixed` / `absolute` の子孫を止められない（包含ブロックがビューポート／初期包含ブロックになる）。
     これが無いと「既定のデザインに戻す」ボタン・OBS のパスワード入力・視聴者メモリ削除導線を**覆える**。
     ⚠ **意匠ではなく安全装置**なので消さないこと。
     ⚠ security-review②（2026-08-05）で追認: paint containment は仕様上 ①fixed / absolute の**包含ブロックになる**
     ②パディングボックスへ**クリップする** ③**スタッキングコンテキストを作る**（巨大 `z-index` が枠外へ出ない）の
     3 つを満たすので、**CSS だけで抜ける経路は見つからなかった**（`::backdrop` / `popover` / `dialog` /
     `view-transition` はいずれも **top layer へ入るのに JS か属性が要る**ので、ユーザー CSS からは到達できない）。
     ⚠⚠ **ただしサポート下限がある**——`contain: paint` は **Safari 15.4+（macOS 12.3+）/ Chromium 52+**。
     それ未満の WKWebView では **(10-j) が緑でも実際には効かず** `overflow:hidden` だけに戻る。
     **実機確認では OS バージョンも記録すること。**
  3. **露出時間（プレビューを開いている間だけ `<style>` を置く）** —— ⚠ これは**閉じてはいない**。
     ⚠ **文書グローバルな名前空間は 4 種**（security-review②で追加・2026-08-05）:
     `@font-face` の `font-family` 名 ／ `@keyframes` の名前 ／ **`@property`**（カスタムプロパティの登録。
     `inherits` と `initial-value` が文書全体の計算値に効き、`syntax` に合わない既存値を無効化できる）／
     **`@counter-style`**。どれも「規則を持たないアットルール」なので `scopeSelectors` は中身に触れず、
     060b のサニタイザも通す。**受容の範囲はこの 4 種**として読むこと。
     `@font-face` の `font-family` 名と `@keyframes` の名前は**文書グローバル**で、
     しかも 060b は `data:` の `url()` を許可形として残すので、
     `@font-face{font-family:"Segoe UI";src:url(data:font/woff2;base64,…)}` で**任意のグリフを持つフォント**を
     持ち込み、アプリ UI のフォント名を乗っ取れる（＝表示文字列の偽装。実測で `stripped_count=0`）。
     名前の書き換えは `var()` 経由で破れるので中途半端になる。
     **恒久策は shadow root / iframe への移行**（設計変更につき別タスク）。

- **egress は増えていない**（§1）。スコープ化が破れても外部 GET にはならない——060b が `url()` / `@import` を
  除去済みだからで、**被害は特権窓の UI 完全性（偽装・クリックジャッキング・可用性）に限定される**。
  ⚠ この線引きは「060b の除去に穴が無い」ことに完全に依存している。

- ⚠ **`scopeSelectors` は新しい `url()` 位置を作らない**（構造で言える）。挿入するのは定数
  `PREVIEW_SCOPE_SELECTOR` のみ、削除するのは先頭の root 相当トークンのみで、
  トークン境界の否定先読みにより結合面が ident 文字にならないため、`url` という ident を合成できない。

- ⚠ **060f 追修正（2026-08-08）: 注入する CSS に StreamDock 生成の文字列が混ざるようになった。**
  `overlayThemeReset.ts` の**固定リセット**（当時は
  `:where(.sd-comment-body)::before/::after{content:none}`。⚠ **追修正③で `all: unset` に置き換わっている**
  ——下の 3 つ目の項目が現在の正）を
  テーマ CSS の**手前**へ連結する（既定のしっぽが疑似要素 2 枚で描かれているのに対し、テーマは `::before`
  1 枚しか書かないのが普通で、`::after` が孤児として残り**しっぽが二重に見えていた**ため）。
  **本項の区分は変わらない**——理由は 3 つで、いずれも機械で固定してある:
  ①**固定文字列のみ**（ユーザー入力を 1 バイトも混ぜない。混ぜたら 060g の表示設定層と同じ判断が要る）
  ②**新しい `<style>` を作らない**（既存の `textContent` へ前置するだけ）＝ **(10-i) の allow-list は不変**
  ③**プレビューではスコープ化の前に連結する**ので、リセットも `.sd-preview` 配下へ閉じ込められる
  （後に連結すると**リセットだけが枠の外へ漏れる**）。
  ⚠ 効く仕組みは「**非レイヤー > レイヤー**」（既定側を `@layer sd-default` に入れてある）。
  `!important` ではない——`!important` にすると**ユーザーのテーマに勝ってしまう**。
  新設の静的ガード **(10-m)** が「注入 2 か所とも通っていること」と
  「`@layer sd-default` が外れておらず、`.bubble` 一式がその**中**にあること」を固定する。
  ⚠⚠ **この (10-m) は同じ形の間違いで 3 度穴を持った**（レビュー指摘 S-1・2026-08-08 で 3 つ目を実測）——
  いずれも「**条件を満たすものが 1 つ在るか**」を見て「**該当する全部が満たすか**」を見ていなかった:
  ①`includes("withDecorationReset")`（import が残っていれば呼び出しを消しても緑）
  ②`@layer` の**存在**だけ（`.bubble` をレイヤー外へ出す変異が生存）
  ③`exec`＝**最初の 1 件**だけ（`.bubble::before` / `::after` は束ねルールと単独ルールの**2 つに
  分かれている**ため、しっぽの幾何を持つ単独ルールをレイヤー外へ出す変異が **check:css も vitest 1119 件も
  全部緑のまま**生存した＝追修正③が直した欠陥がそのまま復活する）。
  → ③は `matchAll` で**全件**を見る形へ是正済み（先頭は `^[ \t]*`——`^\s*` は `\n` をまたいで
  マッチ開始位置がずれる）。**この種の検査を足すときは必ず `matchAll` で書くこと。**
  ⚠ ミューテーション一覧に「単独 `.bubble::before` / `::after` をレイヤー外へ出す」を常設すること。

- ⚠ **060f 追修正②（2026-08-08）: リセットの守備範囲が「しっぽ」から「吹き出しの装飾一式」へ広がった。**
  `background` / `border` / `border-radius` / `filter` と `--sd-icon-gap` も引っ込める
  （既定の吹き出しが「テーマが部分的にしか上書きできない床」になっており、**吹き出しを持たない
  デザインが原理的に適用できなかった**ため。実機の差し戻し②）。
  **本項の区分は変わらない**——上の ①②③ はそのまま成立する（固定文字列のみ／新しい `<style>` を
  作らない／スコープ化の前に連結）。⚠ 攻撃面はむしろ**減る側**で、既定の**不透明背景を消す**方向なので
  「注入 CSS が OBS の透過を塗り潰す」経路を助けない。
  ⚠ 触ってはいけないプロパティが 2 つある（どちらもテストで固定）: **`position`**（テーマの絶対配置
  しっぽの位置基準を壊す）と **`padding`**（純正チャット向けテーマは元サイトの余白に依存している）。

- ⚠ **060f 追修正③（2026-08-08）: リセットが `all: unset` と `position: relative` を持つようになった。**
  ①既定のしっぽの疑似要素は `content:none` ではなく **`all: unset`**（`content` だけ止めても、テーマが
  `content:""` で復活させた瞬間 `top` / `width` / `border-*-width` 等が既定のまま漏れてズレる）。
  ②`:where(.sd-comment){position:relative}`（実テーマ頻出の「コメント 1 件の枠に対する絶対配置」が
  窓の左上へ飛ぶのを防ぐ）。**本項の区分は変わらない**——依然として**固定文字列のみ**で、
  新しい `<style>` も作らず、プレビューではスコープ化の前に連結している。
  ⚠ `position: relative` はむしろ**閉じ込め側に働く**（`.card` の `overflow:hidden` が効くようになる）。
  ⚠⚠ **当て先は下の追修正④で `:where(.sd-comment-chat)` へ変更済み**（本段落の `:where(.sd-comment)` は
  当時の記録）。リセット 4 ルールの現行の当て先は `overlayThemeReset.ts` の `DEFAULT_DECORATION_RESET` が正。

- ⚠ **060f 追修正④（2026-08-08・本人決定）: ユーザー CSS の到達範囲が「chat のコメントだけ」に狭まった。**
  **課金カード（投げ銭カード）から安定クラスと `data-sd-*` を全部外した**ので、テーマは
  スーパーチャット／メンバーシップのカードを**名指しできない**（新設の静的ガード **(10-o)** が
  `CommentList.tsx` の字面を、`CommentList.selectorContract.test.tsx` が実 DOM を固定する）。
  あわせて変換表から課金系 3 エントリを削除し、リセット（`overlayThemeReset.ts`）の当て先も
  `.sd-comment-chat` / `.sd-comment-in-chat` へ寄せた。
  **本項の区分は変わらない**——**攻撃面は正味で減る側**である（的が減っただけで、新しい注入経路も
  新しい `<style>` も増えていない）。

  ⚠⚠⚠ **ただし「1 要素も届かない」ではない**（security-review 2026-08-08 で実測・**絶対表現は使わないこと**）。
  正確には「**名指しできない**」までで、**祖先の契約クラス ＋ 汎用/型セレクタ経由では依然として到達する**:

  | ユーザー CSS（純正 YouTube 語彙） | 変換後 | 課金カードへのヒット |
  |---|---|---|
  | `yt-live-chat-paid-message-renderer{display:none!important}` | 未変換 | **0**（＝起票理由そのものは解決）|
  | `yt-live-chat-renderer *` | `.sd-overlay *` | **9 要素** |
  | `yt-live-chat-item-list-renderer #items > *` | `.sd-comment-list > *` | **1（`<li>` 自身）** |
  | `yt-live-chat-app li` | `.sd-overlay li` | **1（`<li>` 自身）** |

  ⚠ しかも祖先ハンドルの 2 つ（`yt-live-chat-app` / `yt-live-chat-renderer` → `.sd-overlay`、
  `yt-live-chat-item-list-renderer #items` → `.sd-comment-list`）は**060f が新規に追加した写像**である。
  ＝ 060f は「課金カードの名指し」を塞ぐと同時に「純正語彙から祖先へ到達する経路」を 1 つ開けている。
  **能力そのものは 060a 時点から `.sd-overlay li{…}` と直接書けば可能だった**ので区分は変わらないが、
  **踏む確率**は上がっている（`.sd-overlay` を変換表に入れた判断と同じトレードオフ・`cssCompat.ts` の
  `to` の docstring を参照）。
  ⚠ `CommentList.selectorContract.test.tsx` の「どの変換先も課金カードに当たらない」は
  **変換表の `to` のリテラル文字列だけ**を見ており、上のような合成セレクタは範囲外である
  （同ファイルに「既知の限界」として当たることを固定するテストがある）。
  ⚠ **「課金カードは絶対に触れない」を不変条件として新しい設計の前提に置かないこと。**
  そこまで保証したくなったら、必要なのは目印の除去ではなく**構造の分離**（課金カードを
  shadow root か別の器へ出して、注入した `<style>` のスコープから外す）である。
  ⚠ きっかけは実害で、OBS 用に配られているテーマが
  `yt-live-chat-paid-message-renderer{display:none!important}`（純正チャットはスパチャがティッカーにも
  出るので「インライン側を消す」のが定番）を書いており、変換すると **StreamDock の課金カードが
  丸ごと消えていた**（2026-08-08 実機）。⚠ **目印クラスによる限定では原理的に防げない**
  （テーマが狙っているのは課金カードそのもの）ため、的を外す方向で解いた。

- ⚠ **060f 追修正⑦（2026-08-08）: `.themePreview` に `transform: translateZ(0)` が増えた（描画バグ回避）。**
  これは**安全装置ではなく WebKit の描画バグ回避**（テーマの `<style>` を差し替えたとき、WKWebView が
  プレビューの課金カードの領域を再描画しそこねて「要素はあるのに描かれない」状態になる）。
  ⚠ **本項に書くのは、これが `contain: paint` / `overflow: hidden` と同じルールに同居し、
  同じ静的ガード (10-j) が固定している宣言だから**である。ここに記録が無いと、将来「意匠だから」と
  消される（1 宣言・手元では消しても何も起きない・実機の WKWebView でしか症状が出ない）。

  **封じ込めは弱まらない**（判断の根拠を残す）。`transform` は
  ①`position: fixed` / `absolute` の**包含ブロックを作る**（枠内の第三者 CSS が `inset:0` を書いても
  ビューポートではなくこの枠が基準になる）②**スタッキングコンテキストを作る**（巨大 `z-index` が
  枠外へ浮上しない）——**060d security-review S-2 で `contain: paint` に求めた役割そのもの**を副作用として
  二重化する。＝ 区分は変わらず、むしろ**強化側**である。
  ⚠⚠ **`contain: paint` の代替にはならない**（`contain: none` にしても描画バグは再発するので両者は独立。
  2026-08-08 に一度「`contain: paint` が原因」と誤診して差し戻している）。**3 宣言とも消さないこと。**
  ⚠ **当て先が `.themePreview`（CSS Modules のハッシュ名）でなければならない**——`.sd-preview` /
  `.sd-comment-list` / `.sd-comment` は**ユーザー CSS から名指しできる**ので、テーマが `transform` を
  上書きすると回避策が黙って無効化される。
  ⚠ **恒久策ではない**（エンジン固有の回避策）。再修正トリガーはプレビューを shadow root / iframe へ
  移すとき（構造が変わるので実機で測り直す）。実測の手順と限界は progress.md の「追修正⑦」節が正。

- **再修正トリガー**: ①`cssCompat.ts` の `scanPreludes` を変更したとき（`cssScope.ts` の `scan` も見る）
  ②プレビュー以外の場所でユーザー CSS を描画したくなったとき（＝下記レビュー必須条件に該当する）
  ③`@font-face` / `@keyframes` の名前汚染が実際に観測されたとき
  ④**リセットに動的な値を入れたくなったとき**（＝新しい注入経路になる・060f 追修正）
  ⑤**課金カードへ安定クラスや `data-sd-*` を戻したくなったとき**（＝ユーザー CSS の到達範囲が広がる・
  060f 追修正④）。⚠ 戻すなら「配布テーマの `display:none` で課金カードが消えないこと」を
  どう担保するかを先に決めること。

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
      - **（過少計上の既知課題）→ 043e で対応済み（2026-07-27）**: 公式 proto は `LiveChatMessage.id` に
        「For giftEvents, the same ID may be reused to update the combo count」と明記しており、**`GIFT_EVENT`（Jewels）だけは
        同一 id が combo 更新で再送される**。043d 時点は `combo_count`（= 8）を採らず、Rust の `INSERT OR IGNORE`（`viewer_comments.id`）
        が 2 件目以降を落としていたため、**連続ギフトの Jewels が 1 回ぶんしか記録されなかった**。下記 043e 節が対応。
      - **再検討トリガー**: 「誰が受け取ったか」を表示したい要望が出たら、受領側を**集計対象外の新種別**として起票し直し
        **再度 security-review** を通す（`membership` 流用は `subscription_count` が N+1 に膨らむため不可）。
    - **（043e・Jewels combo 更新の取り込み＝受信面拡張＋保存挙動の変更＝方針⑪該当・security-review 済／2026-07-27）**
      上記 043d の既知課題（combo による過少計上）に**対応済み**。frontend `mergeComments` に `updated` バケットを新設して
      combo 更新を Rust まで到達させ、`viewer_comments` の**既存行を UPDATE** するようにした
      （タスク: `docs/tasks/043e-youtube-jewels-combo-fidelity.md`）。
      - **受信面の追加は `combo_count`（= 8・int32）のみ**。proto に 1 フィールド宣言を足しただけで、**新規宛先・新規 OAuth
        スコープ・新規依存はゼロ**（既存 `youtube.readonly`・既存 gRPC ストリーム内・二層 fail-closed／gRPC チャネルガード
        `www.googleapis.com:443` のみ・`csp: null`・capabilities・`part`/`profile_image_size` はすべて不変＝**追加リクエスト／
        クォータ影響なし**。バンドル内の宛先一覧が 043d と同一であることを実測で再確認）。`combo_count` は**整数のみで
        個人情報を含まない**（§9 の新論点なし）。表示は本体コメント行の「×N」のみで、**オーバーレイ（配信画面）には出さない**。
      - **引き続き受信しないもの**: `gift_url` / `gift_name` / `alt_text` 等のギフト資産情報（`gift_url` は画像取得＝CSP・§9 の
        新論点を生むため）、および受領側 `gift_membership_received_details`（= 32・043d 決定1 を維持＝受贈者情報はそもそも
        デコードされない）。いずれも「非宣言であること」を sidecar テストのアサートで固定した。
      - **保存範囲（§9 追補 038a に該当・本変更の核心）**: **`viewer_comments` の既存行を UPDATE する経路が初めて入る**。
        - **列は増やさない**（スキーマ不変。`viewers` に JEWELS 用ロールアップ列も追加しない）。
        - 更新するのは **`amount` / `currency` / `monetary_amount` / `text` の 4 列のみ**。**`published_at` / `viewer_id` /
          `session_id` / `created_at` は書き換えない**（集計 first/last と 038c 判定の基準・行の所有者・記録セッションを動かさない）。
          ＝**保存項目の追加ではなく既存項目の上書き**であり、保存する情報の種類は増えない。
        - **対象は `event_type = 'jewels'` に限定**（引数の種別による早期 return と SQL の `WHERE ... AND event_type = 'jewels'` の
          **二重**で縛る）。他種別の同一 id 再送は**現行どおり 0 行・集計非更新・`RecordResult{false,false}`**（既存の冪等契約は不変）。
        - 再計算する視聴者は **保存済み行の `viewer_id` を DB から読む**（frontend 由来の引数を信用せず、コメントの付け替えを
          構造的に防ぐ＝§8）。値はすべてパラメータバインドで、SQL に埋める識別子はコンパイル時定数のみ。
        - 戻り値は常に `RecordResult{false,false}`＝**更新で初見／久しぶりバッジを再点灯させない**。TTS も再読み上げしない
          （combo 更新は `added` に載らず `updated` 経由で記録のみ）。
        - **脅威モデル上の位置づけ**: 未認証 loopback WS へ到達できるローカルの第三者は、既存 jewels 行の `amount`/`text` を
          上書きできるようになる。ただし同じ相手は**以前から任意コメントを INSERT できた**ため特権昇格ではなく、上書きは
          jewels 行に限られ**行の所有者は変えられない**。`text` は既存の trim／制御文字拒否（§8）を通る。
          **独立レビュー指摘 S-3 の補足（2026-07-27）**: 追加された能力は「追記」ではなく「**既存レコードの改変**（完全性）」で
          質が異なる。実害が限定される根拠は ①JEWELS は `bits_amount`（`currency='BITS'`）にも `superchat_amount`
          （`event_type='superchat'`）にも入らない ②行の所有者を変えられない ③`text` は §8 の検証を通る、の 3 点。
          **`viewer_comments` が厳密な append-only ではなくなった**ことは §9 追補（038a の追補）にも記載した。
        - **限定の担保（独立レビュー指摘 S-1 で追加・2026-07-27）**: 上記「二重」の各層は、**片方だけを外しても検知できる**
          テストで固定している（`stored_non_jewels_row_is_not_updated_by_incoming_jewels` ＝ SQL の `WHERE` 単独／
          `stored_jewels_row_is_not_updated_by_incoming_non_jewels` ＝ 引数側チェック単独）。とくに前者は
          **「既存 chat コメントの id ＋ `eventType: "jewels"`」というなりすまし種別の再送**を止める唯一の層であり、
          この形が未認証 loopback WS からの現実的な攻撃形になる。定数と SQL リテラルの値ドリフトは
          `combo_updatable_event_type_matches_sql_literal` で検知する。
      - **金額の意味論は据え置き（フェーズ1）**: `jewels_amount × combo_count` の換算は**入れない**。最新値をそのまま採るため
        **過大計上には絶対にならない**（累計読みなら完全に正しく、単価読みでも従来と同値）。実データで単価と確定したら
        `× max(combo_count, 1)` を入れ、**金額が変わるため再度 security-review** を通す（フェーズ2・再開トリガーはタスクファイル）。
      - **ログ非露出は不変**（追加経路にログ出力を入れない・本文／金額をログに出さない＝§9）。削除手段（`delete_viewer` /
        `clear_viewers`）も新テーブル・新列が無いため取り残しゼロで有効なまま。
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
  - ⚠ **コメント取得 sidecar の停止条件**（どの窓が生きている間は落とさないか・どのイベントで判定するか・
    起動契機を増やすこと）を変える変更も本項に該当する。§6 の本文は「ツールプロセスの停止は自 spawn PID に
    限定」であって sidecar のライフサイクルを扱っていないが、**「どの窓も無くなったら必ず落ちる」＝
    孤児プロセスを残さない保証はここ 1 点に集約している**（実体は上記「Tauri Permissions / Capabilities 方針」の
    061a 節「sidecar の停止条件」）。**§6 の下位条件に当てはまらないことを理由に自分を免除しないこと。**
- ファイル読み書き処理
- ログ出力処理
- 外部通信
- 自動アップデート
- **音声デバイスの列挙・音声の再生**（058a）
  - ⚠⚠ **下位条件は「該当する例」の列挙であって、スコープの定義ではない**（059a レビューで追記・2026-08-04）。
    **`src-tauri/src/audio/` の本番コード（`model.rs` / `service.rs` / `commands.rs`）に差分が出る変更は、
    下位条件のどれにも当たらなくても本項に該当する。** 059a は「5 つの下位条件がすべて非該当だから軽レビュー」と
    判定したが、親項目の文言は「音声デバイスの列挙・音声の再生」と広く、実際には
    `NotificationSound` の variant 追加（＝鳴らせる音の集合の変更）と `samples_for` の減衰導出の書き換え
    （＝既存の Test 音を含む全再生波形の生成ロジック）に触れていた。**この判定は誤りで、レビューで是正した**
    （実体の逸脱はゼロだった）。046a が「当初『軽レビュー』指定だったが保存ポリシーに触れるので必須」と
    是正されたのと同型の誤りである。**列挙された項目に触れるなら、下位条件の当てはめで自分を免除しないこと。**
  - 列挙対象を**出力デバイス以外へ広げる**変更（＝入力／マイクに触れる変更）は**本項に必ず該当する**。
  - 再生できる音を **enum 以外**（ファイルパス・バイト列・URL）で指定できるようにする変更も同様。
  - 「デバイスが見つからないときに既定デバイスへフォールバックする」向きの変更も同様
    （§4 追補のとおり、②-軽では既定＝配信に載る側なので**意味が反転する**）。
  - **同時再生の上限（`PLAYING` / `PlaybackGuard`）を外す・緩める**変更も同様（§10 のとおり
    `#[tauri::command(async)]` は tokio worker を占有するので、上限を外すと自己 DoS になる）。
  - `NotificationSound` の variant に**ペイロード（`Test { name: String }` 等）を持たせる**変更も
    「enum 以外で指定できるようにする変更」に含む。契約テストの `PathBuf` needle では捕まらない。
- 設定ファイルのバックアップ・上書き
- ユーザー入力をOS操作に渡す処理
- ログイン項目（autostart / 永続 OS 連携）の登録・解除処理
- らくらくツール設定の外部アプリ連携（**既導入アプリの自動起動**・公式ページ誘導）
- 外部コンテンツの埋め込み（iframe・外部 script/style/image/media・外部ドメインの読込）
- 内蔵コメントビューアの配信サービス連携（**インターネット通信**・**Node sidecar（externalBin）同梱**・OAuth トークン取扱）
- 取得コメント・視聴者情報の端末保存（**視聴者メモリ＝§9 保存ポリシーの限定解禁分**・保存範囲/集計項目/削除手段の変更・「コメントビューア方針」⑪）
  - **保存先は問わない**＝Rust の SQLite だけでなく、**webview の localStorage へ第三者のコメント本文・表示名・
    投げ銭金額を永続化する変更も本項に該当する**（046a の固定コメント＝§9 追補 046a）。ユーザー自身の UI 設定値
    （テーマ・フォント・トグル・チャンネル名等）を localStorage に置く変更は従来どおり本項に該当しない。
- **ユーザーが指定した宛先への取得**（060c／カスタム CSS テーマの外部 `@import` スナップショット）
  - ⚠⚠ **宛先を allow-list で固定できない唯一の egress** なので、担保は「毎回の明示同意」＋
    「取得できる形を極端に狭める専用ガード」の 2 本しかない。**どちらかを緩める変更は必ず本項に該当する。**
  - 具体的には次を変更するとき: `assertAllowedThemeImportUrl` の条件（スキーム / ポート / クエリ /
    拡張子 / IP リテラル / 内部サフィックス）、DNS 事前解決検査、リダイレクト禁止の 2 層、
    サイズ・時間・レートの上限、`Content-Type` 検査、**同意ダイアログ**（既定フォーカス・ホスト強調・
    表示 URL と送信 URL の同一性・「今後確認しない」を作らないこと）、**チケット認証**。
  - ⚠ **`theme-import.fetch` は egress を起こせる初めての制御フレーム**である。
    loopback WS へ**新しい制御フレームを足すとき**は、それが egress を起こすかを必ず判定し、
    起こすならチケット必須にすること（未認証 WS の受容根拠が及ばない）。
  - ⚠ **060h（Web フォントの実体取り込み）は本項に必ず該当する**——2 段目のホスト（`fonts.gstatic.com`）へ
    広げ、`assertAllowedThemeImportUrl` の「クエリ禁止」を緩める必要がある。
    → ✅ **2026-08-09 実施済み**（詳細は §1 の「追補（060h・…）」）。以後、次を変更するときは本項に該当する:
    **取得段数の規則**（`MAX_IMPORT_ROUNDS`）／**`stripped_font_faces` に載る条件**
    （`@font-face` の直下・プロパティ名が `src`）／**CSS のパスの形**（`.css` 終端 または `css<数字>`）／
    **フォント用ガード `assertAllowedThemeFontUrl`**／**フォントの `Content-Type` allow-list**
    （⚠⚠ **`application/octet-stream` を足す変更は必ず該当**——足すと MIME 検査が実質無効になる）／
    **フォント枠のレート制限（件数・バイト）**／**フォント同意ダイアログ**
    （ホストの全列挙・既定キャンセル・上限を同意の前に出すこと）／**`theme-import.fetch-font` フレーム**。
- **オーバーレイへのユーザー CSS の注入**（060d／`<style>` 生成・`insertRule`・`adoptedStyleSheets` 等）
  - ⚠⚠ **060b の `url()` / `@import` 除去が実装済みであることを前提条件として確認する**（060a レビュー S-2 で追加・2026-08-05）。
    060a のセレクタ契約（`.sd-comment-icon` 等の安定クラス）は、ユーザー CSS が
    `background-image: url(…)` / `@font-face src` / `image-set()` / `cursor: url()` / `list-style-image` で
    **webview から実 egress を成立させる的**でもある。**060a 時点では注入経路がゼロなので実害は無い**が、
    注入を実装した瞬間にこの経路が開く。＝**060b より先に 060d を実装してはならない**。
  - ⚠ `csp: null` のままなので **webview 側に構造的な歯止めは無い**（Tauri v2 の `csp` はアプリ全体に 1 つで、
    `comment-viewer` 窓は Twitch / YouTube / VOICEVOX / OBS への `connect-src` を要するため、
    オーバーレイ窓だけに効かせることはできない）。＝**060b のサニタイザが唯一の壁**であり、
    fail-closed かつ迂回（CSS エスケープ・コメント挿入・大文字・`\0075`）のテスト付きで実装すること。
  - 060a 自体（安定クラスと CSS 変数を DOM/CSS に足すだけ・新規通信ゼロ・新規権限ゼロ）は本項に該当せず、
    **軽レビューで妥当**だった（060a レビュー S-5）。本項が対象にするのは**注入する側**である。
  - ⚠⚠ **注入先が「オーバーレイ窓」以外へ広がる変更は本項に必ず該当する**（060d レビューで追記・2026-08-05）。
    060d のプレビューは**設定 UI のある `comment-viewer` 窓**へ注入しており、そこには
    「既定のデザインに戻す」（＝壊れたテーマからの唯一の脱出路）・OBS のパスワード入力・
    視聴者メモリの削除導線がある。**オーバーレイ窓は表示専用だが、こちらは特権 UI である。**
    固定コメント窓・本体ウィンドウ・将来のプレビュー 2 本目も同様。
  - ⚠ **060c（2026-08-09）で配信窓の注入経路にも `rewriteRootLike` が入った**（`body` / `html` / `:root` /
    `.sd-overlay` を窓ルートへ読み替える）。**プレビューと配信窓で `body` の当たり先を揃える**ためのもので、
    `cssScope.ts` の同じ走査器・同じ正規表現を使う（**変換表 `cssCompat.ts` は 1 行も触っていない**＝
    060f が却下した案・静的ガード (10-k) には当たらない）。⚠ `body{background:#fff}` が
    `.sd-overlay{background:#fff}` になり**窓が全面不透明になる**副作用は、060f が
    `yt-live-chat-app` → `.sd-overlay` を変換表へ入れたときに**既に受容済み**の挙動と同一で、
    脱出路も同じ（「既定のデザインに戻す」）＝**新しい能力は増えていない**。
    ⚠⚠ **ただし発生頻度は上がる**（security-review 060c Q-3 で訂正）。060f のケースは
    「YouTube チャット専用に書かれたテーマ」を要したが、`body{background:…}` は**外部 CSS にほぼ必ず入る**。
    ＝「一部のテーマで起きうる」→「多くのテーマで起きる」。**能力は同じ・頻度は上がる**が正しい要約で、
    実機確認で窓が不透明になっても実装ミスではない（常時ある脱出路の確認で足りる）。
  - ⚠⚠ **060c 追修正（2026-08-09）で「テーマが越えられない床」が 2 つできた。**
    どちらも**意匠ではなく窓そのものの機能**を守るもので、060f の「テーマは土台を越えられる」方針
    （＝既定意匠は `@layer sd-default` に入れて弱くする）とは**反対向き**である。線引きは
    「**意匠は越えられる／窓の機能（可用性・脱出路）は越えられない**」。
    ①`OverlayApp.module.css` の `html[data-overlay="1"]` 系 `overflow:hidden`
    （ユーザー CSS はここに到達できない——`html`/`body` と書いても `rewriteRootLike` が `.sd-overlay` へ化かす）
    ②`CommentViewerApp.module.css` の **`@layer { .themePreview > * { min-height:0 !important; max-height:100% !important } }`**
    （追修正④）——`scopeSelectors` はテーマの `body`/`html`/`:root` を `.sd-preview`（＝プレビュー枠の中身）へ
    読み替えるので、定型句 `body{min-height:100vh}` が **200px の枠を突き抜け**、`<ol>` も一緒に伸びて
    `scrollHeight === clientHeight`＝**スクロールも発生せず、切られた下側へ永久に到達できなくなる**
    （実測：フィクスチャ 16 種中 6 種で再現 → 床ありで 16/16 正常）。
    ⚠ **`height` は固定しない**（テーマの余白設計は効かせる＝上限だけ噛ませる）。
    ⚠ **`min-height:0` が必須**（CSS では `min-height` が `max-height` に勝つので `max-height` だけでは止まらない）。
    ⚠⚠ **レイヤーに名前を付けてはいけない。** `@layer` は 060b のサニタイザを素通りするので、
    名前を付けるとテーマが `@layer <その名前>{…}` で**同じレイヤーへ合流して床を破れる**（実 WKWebView で実測：
    無名なら効いたまま／名前付きにすると破れた）。無名レイヤーは名前で開き直せないので合流されない。
    ⚠ **配信窓（`.sd-overlay`）には同じ床を置いていない**——あちらは窓いっぱいに対する `height:100%` なので
    `100vh` は無害だが、**絶対長**（`body{height:600px}`）では同型のバグが起きることを実測済み（未修正・残課題）。
    ⚠ 静的ガード **(10-p)** が①②と「レイヤーが無名であること」を機械で固定している。
    ⚠ **床を増やすときは必ずこの線引きに照らすこと**——意匠を床にすると「適用できないデザイン」が生まれ、
    060f が 3 巡かけて剥がした失敗（既定の吹き出しが床になっていた）を作り直すことになる。
    ⚠⚠ **一度あった 3 つ目の床（`@layer { .list { overflow-y: auto !important } }`）は撤回した。**
    コメント一覧のスクロールは**床ではなく構造**（スクロール容器 `.scroller` と器 `<ol>` を分ける 2 層）で
    守っている。詳細は `docs/progress.md` の 060c 節「差し戻し（追修正③の撤回）」。
  - ⚠⚠ **060h（2026-08-09）で `@font-face` が実際に読み込まれるようになった。**
    060d が受容した「`@font-face` の family 名は文書グローバルで閉じていない」という残余リスクについて
    再評価した結果は **「能力は増えていない・発生頻度は上がる」**（060c の `body{background:…}` と同型の要約）:
    - **能力は既に開いていた**——`@font-face{src:url(data:font/woff2;base64,…)}` は
      **060b の許可形**（`sanitize.rs` のテストが「消えないこと」を固定している）なので、
      base64 フォントを貼り付けた CSS は 060d の時点でプレビュー（＝特権窓）へ実フォントを注入できた。
    - **頻度は上がる**——取り込んだテーマにフォントが自動で付いてくるようになった。
    → **受容は維持**し、担保（「プレビューを開いている間だけ `<style>` を置く」＝露出時間を限ること）を
    **フォント用 `<style>` にも同じ強さで適用**する（`previewThemeId` に厳密に連動・
    取得に失敗しても残らない・**テストで固定**）。
    ⚠ 恒久策（shadow root / iframe への移行）は別タスクのまま。
    **再修正トリガー＝プレビューを常時表示にする変更**（露出時間を限る担保が消える）。
    - ⚠⚠ **上の要約は控えめすぎたので訂正する**（060h security-review S-9）。「能力は増えていない」は
      **種類としては正しい**が、060h が変えたのは頻度だけではない。実際に広がったのは 3 点:
      ①攻撃者が woff2 を貼り付け CSS へ**インラインしなくてよくなった**（リモート配信でよい）
      ②その入れ物の上限が **256KiB → 5MiB**（20 倍）
      ③意匠 CSS が通る `scopeSelectors` の経路から**完全に外れた**（フォント用 `<style>` は変換を通さない）。
      成立する形は具体的で、`@font-face{font-family:'<アプリ UI のフォント名>';src:url(https://…/x.woff2)}`
      と `.sd-comment{font-family:'<同じ名前>'}` の 2 行あれば `selectFontFaces` の絞り込みも通る
      （グリフ差し替えによる**表示偽装**の対象はプレビュー表示中のコメビュ設定画面全体＝同意ダイアログを含む）。
      **受容は維持する**（露出時間限定＋毎回の明示同意＋ホスト全列挙）が、
      **恒久策の優先度を上げる**。安価な代替＝**プレビューにはフォントを注入しない**
      （配信窓だけに入れる）。特権窓から `@font-face` を締め出せば 060d 時点より**むしろ狭くなる**ので、
      プレビューの忠実さより安全を採る判断になったらこちらを先に入れること。
  - ⚠ **060h でユーザー CSS を注入する `<style>` が窓ごとに 2 本になった**（意匠 ＋ フォント）。
    フォント側は **`rewriteSelectors` / `rewriteRootLike` / `scopeSelectors` / `withDecorationReset` を
    1 つも通さない**（`@font-face` はセレクタを持たないので変換対象が無く、意匠と同じ文字列に混ぜると
    テーマ切り替えのたびに数 MB を走査することになる）。
    ⚠ 注入は意匠と同じく **`<style>` の `textContent` のみ**で、cleanup も同じ
    （＝**常に 0 個か 1 個**・切り替えで積み上がらない）。
    ⚠⚠ **静的ガード (10-i) を「ファイルの集合」から「ファイル → `<style>` の本数」へ強化した**——
    旧実装は既に許可されたファイルの中に 2 本目を足しても**何も落ちなかった**（060h がまさにそれを行う）。
    これは 060d security-review S-5 で向きを反転させたときに**同一ファイル内の増加が残っていた**、
    という同型の穴である。
    ⚠⚠ **その強化にもさらに 2 つ穴が残っていた**（060h security-review S-3・どちらも実測で「緑のまま通った」）:
    ①本数のカウントが**ダブルクォートしか見ておらず**、`createElement('style')` で 3 本目を足すと素通り
    ②**`link` の本数を固定していなかった**ので、許可済みファイルに
    `createElement("link")` ＋ `href="https://cdn.example/x.css"` を足しても何も落ちなかった
    ——これは §1 が名指しで禁じる「**CDN からの css 読み込み**」そのもので、`csp: null` の下では
    他に止めるものが無い。→ **クォート両対応にし、`style` と `link` を別々に本数固定した**
    （`link` の期待値は **0**。増やすなら §1 の例外新設が要る）。
    ⚠ 教訓は (10-m) が 3 度踏んだものと同じ＝「条件を満たすものが 1 つ在るか」ではなく
    「**該当する全部が期待どおりか**」を見ること。
  - **スコープ化・封じ込めの担保を弱める変更**も本項に該当する。具体的には
    `cssScope.ts` の `scan` / `splitTopLevelCommas`（トークンの読み分け）、
    `.themePreview` の `contain: paint`、静的ガード **(10-h) / (10-i)** の 3 つ。
    ⚠ これらは**意匠でも整形でもなく安全装置**なので、「使っていないから消す」判断をしないこと。
    根拠は「## CSP方針」の **060d 節**。

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
