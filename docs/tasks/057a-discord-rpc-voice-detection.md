# 057a Discord 接続基盤（ローカル RPC ＋ OAuth ＋ VC の常駐監視）

> 状態: **未着手（実装サブタスク）**。分割・線引きは親 [057](057-discord-voice-overlay-design.md) を正とする。
>
> ⚠ **着手条件**: [057s](057s-discord-rpc-streamkit-spike.md) の検証項目 (1) が **✅（非所有者でも `rpc.voice.read` で通った）**
> であること。⚠ / ✕ なら親 057 の中止条件が発動し、本タスクには着手しない。
> 併せて 057s の (2)(3)(4) の結論（OAuth の形・イベント挙動・transport）が確定していること。
>
> **必読前提**: 親 [057](057-discord-voice-overlay-design.md)、[057s](057s-discord-rpc-streamkit-spike.md)（実測結果が実装の前提）、
> [`docs/security.md`](../security.md)（§1 外部通信／**「らくらくツール設定（外部アプリ連携）方針」**／§3／§9／§10／レビュー必須条件）、
> [032c-b](032c-b-node-sidecar-twitch-comments.md)（sidecar 封じ込め・二層 fail-closed・OAuth トークンの OS キーチェーン運用）、
> 対象 [`host-guard.ts`](../../apps/comment-sidecar/src/host-guard.ts)、[`comment_sidecar/mod.rs`](../../apps/desktop/src-tauri/src/comment_sidecar/mod.rs)。
> CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。
> **新規インターネット egress ＋ OAuth トークン取扱 ＋ らくらく方針の改訂 ＝ security-review 必須**。
>
> ⚠ **行番号は書かない**（特定はシンボル名で行うこと）。

## 目的

**配信者が Discord でコラボ用 VC に入ったことを、StreamDock が自動で知る。**

本タスクの成果は「現在の guild ID / channel ID / チャンネル名」を sidecar 内に保持し、
その変化を Rust 経由で UI へ通知する状態機械まで。**OBS への反映は [057b](057b-obs-streamkit-browser-source.md)、
画面は [057c](057c-rakuraku-discord-integration-ui.md) の領分**で、本タスクは OBS も UI も触らない。

## 現在の前提（調査結果・実コード）

- **Discord 連携はリポジトリに 1 行も存在しない**（依存・設定・コードすべてゼロ）。
- sidecar の allow-list は [`host-guard.ts`](../../apps/comment-sidecar/src/host-guard.ts) にあり、
  `ALLOWED_EXACT_HOSTS`（Twitch / Google）・`ALLOWED_HTTPS_WILDCARD_SUFFIXES`（アバター CDN）・
  `ALLOWED_WS_WILDCARD_SUFFIX`（Twitch EventSub）・`ALLOWED_GRPC_EXACT_HOSTS` の 4 系統。
  `installHttpHostGuard` が global `fetch` を差し替え、**allow-list 以外は `DisallowedHostError` を throw する**。
  **Discord は 1 つも入っていない。**
- loopback 宛先のアサートは **外部宛先の allow-list と分離**して持つのが既存の作法
  （`assertAllowedObsUrl` が `ws://127.0.0.1:<port>` 限定・**ここに loopback を混ぜない**とコメントに明記されている）。
- OAuth トークンの扱いは Twitch / YouTube で確立済み。**Rust が所有する OS キーチェーン**（`keyring`）へ保存し、
  sidecar ↔ Rust は **親子プロセスの private pipe（stdin / stdout 専用行）のみ**を通す。**loopback WS には載せない**。
- sidecar → Rust の通知は **stdout の 1 行プロトコル**（`COMMENT_SIDECAR_PORT=` / `COMMENT_SIDECAR_TOKEN=` /
  `COMMENT_SIDECAR_OPEN_URL=` など）。Rust は別スレッドで同期的に読む。**新しい prefix を足せば拡張できる。**
- Rust → webview のイベントは 055d の `app-update:progress` が先例（`app_update::commands` の
  `APP_UPDATE_PROGRESS_EVENT` と、frontend の `appUpdateApi.ts` の同名定数が対）。
  ⚠ [`useAppUpdate.ts`](../../apps/desktop/src/features/app-update/useAppUpdate.ts) のコメントにあるとおり
  **どの窓の webview からでもイベントは偽造できる**。**イベントを信頼して OS 操作を行わないこと。**
- **メインウィンドウは sidecar と loopback WS を張っていない**（WS はコメントビューア窓だけ）。
  したがって本タスクの通知経路は **stdout → Rust → Tauri イベント**になる。

## このタスクでやること

### (1) sidecar に Discord RPC クライアントを新設

- 新規 `apps/comment-sidecar/src/discord/`。少なくとも次の 3 つに分ける（既存 `obs/` が
  `obs-client.ts`（I/O あり）と `obs-helpers.ts`（純ヘルパ・単体テスト対象）に分かれているのと同じ作法）。
  - **フレーミングの純関数**（`opcode(u32 LE) + length(u32 LE) + JSON` のエンコード / デコード）
    → **ここは I/O を持たないので単体テストを書く**。
  - **RPC クライアント**（接続・ハンドシェイク・コマンド送信・イベント購読）。
  - **状態機械**（後述 (4)）。
- transport は **057s (4) で決めた方（IPC パイプ or `ws://127.0.0.1:6463`）**を使う。
  - IPC を採る場合は Node 標準の `net` で足りる＝**新規依存ゼロ**。
  - loopback WS を採る場合は既存の `ws` を再利用する＝**新規依存ゼロ**。
  - **どちらでも新規 npm を足さないこと**（足すなら §10 に理由を書き、security-review の争点にする）。
- `discord-ipc-0` が使用中のときは `-1`〜`-9` を順に試す（057s (4) の実測に従う）。
  ⚠ **見つからないときに無限リトライしない**（044a の「hot-loop しない」と同じ方針）。

### (2) fail-closed のホストガードを足す

[`host-guard.ts`](../../apps/comment-sidecar/src/host-guard.ts) に以下を追加する。

- **`assertAllowedDiscordRpcUrl(raw: string)`**（loopback WS transport を採る場合のみ）。
  `assertAllowedObsUrl` と**同じ書き方**で、`ws://127.0.0.1:6463` **のみ**を許可する。
  非 ws・別ホスト・別ポート・userinfo 付きは throw。**外部 allow-list とは分離して持つ**（既存の方針どおり）。
- IPC パイプ transport を採る場合は、**パス組み立てをモジュール内の定数から行い、外部入力を混ぜない**。
  ソケット名は `discord-ipc-<0-9>` の**固定パターンのみ**を受け付ける（`^discord-ipc-[0-9]$`）。
- `ALLOWED_EXACT_HOSTS` に **`discord.com`** を追加する。用途は **OAuth トークン交換の 1 エンドポイントだけ**。
  ⚠ **`discordapp.com` / `cdn.discordapp.com` は足さない**（アバター取得は方式 B の領分で、本タスクのスコープ外）。
- `__hostGuardInternals` に新しいアサートを公開し、**`scripts/test-host-guard.mjs` にケースを足す**
  （偽装ホスト `discord.com.evil.com` / `evil-discord.com`、非 HTTPS、別ポートが throw すること）。

### (3) OAuth（057s (2) の結論に従う）

- **PKCE が使えるなら PKCE ＋ Public Client**。**client secret を同梱しない。**
- PKCE が使えず client secret 同梱になる場合は、[032c-d](032c-d-youtube-comments.md) の YouTube と**同じ扱い**にし、
  §10 と security-review でその判断を明示的に記録する。
- 認可の起点は **RPC の `AUTHORIZE`**（Discord クライアント内に同意モーダルが出る）。
  ⚠ **ブラウザを開く経路は増やさない**（`tauri-plugin-opener` を新たに使わない）。
- トークンは **Rust が所有する OS キーチェーン**へ保存する（Twitch / YouTube と同型）。
  sidecar とは **stdin / stdout の private pipe 専用行**でやり取りする。
- **stdout の新 prefix を追加する**。既存の命名に揃えること（例: `COMMENT_SIDECAR_DISCORD_TOKEN=` /
  `COMMENT_SIDECAR_DISCORD_STATE=`）。⚠ **トークン行と状態行は必ず別 prefix にする**
  （状態行はログに出す可能性があるが、トークン行は絶対に出せないため）。
- 「連携解除」でトークンを破棄できる導線を用意する（キーチェーンの削除。既存の logout 経路と同型）。

### (4) VC の常駐監視（状態機械）

- 接続後に `GET_SELECTED_VOICE_CHANNEL` を 1 回呼び、`SUBSCRIBE VOICE_CHANNEL_SELECT` を張る。
- 保持する状態は最小にする。

  | 状態 | 意味 |
  | --- | --- |
  | `disconnected` | 未連携 / Discord 未起動 |
  | `connected` | 連携済みだが VC に入っていない |
  | `in-voice` | VC に入っている（guild ID / channel ID / チャンネル名を保持） |
  | `failed` | 接続 / 認証に失敗（理由つき・**graceful**） |

- **guild ID / channel ID は使う前に `^\d{17,20}$` で検証する**（Discord のスノーフレーク）。
  検証に落ちたら `in-voice` にしない（fail-closed）。
- **DM / グループ DM 通話（`guild_id` が無い）は `connected` 扱いにする**（057s (3) の実測に従う）。
  UI 文言は 057c の領分だが、状態としては「VC に入っていない」と同じに倒す。
- **Discord が落ちた / 再起動したときは `disconnected` へ落とし、hot-loop しない**。
  再接続はユーザー操作か、有界な間隔のポーリング（044a と同じく**リトライループは張らない**方針を守る）。

### (5) Rust への通知と Tauri イベント

- sidecar は状態が**変化したときだけ** stdout に 1 行出す。ペイロードは
  **`{ state, channelName }`**（＋必要なら `guildName`）。
- ⚠ **guild ID / channel ID を stdout に出さない。frontend まで運ばない。**
  ID を知る必要があるのは [057b](057b-obs-streamkit-browser-source.md)（URL を組む sidecar 内）だけで、
  **sidecar の外に出す理由が無い**（§3 最小権限・§9）。
- Rust は受領した状態を state に持ち、**Tauri イベント（例 `discord-voice:state`）でメインウィンドウへ emit する**。
  定数は Rust 側と frontend 側で対にし、**055d と同型の契約テスト**（両者の文字列一致）を書く。
- ⚠ **イベントは webview から偽造できる**ので、**このイベントを起点に OS 操作・プロセス起動・ファイル操作を行わない**
  （本タスクでは表示にしか使わないので現状問題ないが、057c 以降で経路を増やすときの前提として明記する）。

### (6) security.md の更新

親 057 の「割り当て表」のうち、本タスクの担当分を書く。

- §1 に **`### 例外（057・Discord RPC 連携＝コラボ VC の自動検出）`** を新設。
  宛先 allow-list（`discord.com` のトークン交換のみ）／ローカル RPC は loopback・IPC で外部に出ないこと／
  **ユーザーが明示的に連携したときだけ接続**／**送るのは認可コードとトークンだけ**（コメント本文・視聴者情報・
  guild/channel ID を Discord へ送らない）。
- **「らくらくツール設定（外部アプリ連携）方針」の改訂。**
  現状の「外部通信は追加しない（capability は追加しない）」を、
  **「057 を唯一の例外として、明示同意 ＋ security-review を通した連携に限り外部通信を許す」**へ。
  ⚠ 他の条項（自動 DL しない・登録済み exe のみ起動・frontend は raw を渡さない）は**変えない**。
- §9 に追補。Discord トークンは OS キーチェーンのみ・**loopback WS にも stdout の状態行にも載せない**・
  **guild/channel ID を永続化しない**・**コラボ相手の表示名を保存しない**（そもそも取得しない）。
- §10 に「追加した依存（057）」。**新規依存ゼロなら「明示的に落とした依存」として記録**する
  （`discord-rpc` / `discord-ipc` 系の npm を入れなかった理由＝フレーミングは数十行で、
  依存を増やすほどの複雑さが無い）。
- 「レビュー必須条件」に 1 行:
  **「Discord ローカル RPC 連携（VC の自動検出・OAuth トークン取扱・OBS への URL 自動投入）」**。

## このタスクでやらないこと

- **OBS への反映**（[057b](057b-obs-streamkit-browser-source.md)）。本タスクは `obs-client.ts` を 1 行も触らない。
- **UI**（[057c](057c-rakuraku-discord-integration-ui.md)）。`INTEGRATION_REGISTRY` も画面も触らない。
- **方式 B（自前オーバーレイ描画）に必要な購読**（`voice_states` の追跡・`SPEAKING_START` / `SPEAKING_STOP`）。
  **スコープを増やす理由になるので購読しない。**
- **アバター画像の取得**（`cdn.discordapp.com` を allow-list に足さない）。
- Discord のテキストチャット取得。Bot の導入。
- **guild / channel を手動で選ぶ UI**（親 057 の中止条件どおり作らない）。
- 新規 capability の追加。`tauri.conf.json` の変更。`csp: null` は不変。

## セキュリティ制約（docs/security.md 準拠）

- **インターネット egress は `discord.com` の 1 ホストだけ**。allow-list に足すのはトークン交換のためで、
  それ以外の Discord API（guilds / users / channels の REST）は**叩かない**。
- **ローカル RPC は loopback / IPC のみ**。`assertAllowedDiscordRpcUrl`（またはソケット名の固定パターン照合）で
  **fail-closed** にする。外部 allow-list とは分離して持つ。
- **接続はユーザーが明示的に連携したときだけ**。起動しただけでは Discord に触らない。
- **トークン・認可コード・client secret は非ログ・非外部送信**（§9）。エラーメッセージに URL を載せない
  （既存 `redactUrl` と同じ扱い）。
- **guild ID / channel ID を sidecar の外へ出さない・永続化しない**（§3／§9）。
- **frontend からは raw な URL / ID / ポート / コマンドを受けない**（らくらく方針）。
  frontend が呼べるのは「連携する / 解除する」の 2 つだけ。
- Rust は**完全同期のまま**（async / WS / HTTP crate を足さない）。
- 新規 capability を追加しない。`csp: null` 不変。

## 完了条件

- ユーザーが「Discord と連携」を押すと Discord クライアントに同意モーダルが出て、承認後に
  **現在の VC が検出され、状態が UI へ届く**（VC の参加・移動・退出に追従する）。
- Discord 未起動 / 未連携 / 認証失敗のいずれでも **graceful に `failed` か `disconnected` へ落ち、hot-loop しない**。
- `scripts/test-host-guard.mjs` に Discord のケースが足され、**偽装ホストが throw する**ことが固定されている。
- フレーミングの純関数に単体テストがあり、**ミューテーションでレッドになることを実測**している。
- Rust ↔ frontend のイベント名の契約テストが通る。
- **`guild` / `channel` の ID が frontend のコードにも stdout の状態行にも現れない**ことを grep で確認できる。
- **新規 npm 依存がゼロ**（`package.json` / `pnpm-lock.yaml` に差分が無い）。ゼロでない場合は §10 に理由が書かれている。
- [`docs/security.md`](../security.md) に (6) の 5 項目が追記され、**らくらく方針の改訂**が入っている。
- 新規 capability ゼロ・`tauri.conf.json` 差分ゼロ・`csp: null` 不変。
- `pnpm --filter ./apps/desktop typecheck` / `lint` / `test` と `cargo check` が通る。
  [`docs/progress.md`](../progress.md) を更新。

## 確認コマンド

```bash
git diff --stat
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
pnpm --filter ./apps/desktop test
pnpm --filter ./apps/comment-sidecar test    # host-guard / obs / youtube-mapper ＋ 新規 discord
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml

# 新規依存ゼロの担保（差分ゼロが期待）
git status --short -- apps/comment-sidecar/package.json apps/desktop/package.json pnpm-lock.yaml package.json

# ゼロ拡大の担保（差分ゼロが期待）
git status --short -- apps/desktop/src-tauri/capabilities/ apps/desktop/src-tauri/tauri.conf.json .github/

# ID が frontend / 状態行へ漏れていないこと
grep -rn "guildId\|guild_id\|channelId\|channel_id" apps/desktop/src/ || echo "OK: frontend に ID 無し"

# トークンがログ経路に載っていないこと
grep -rn "console\." apps/comment-sidecar/src/discord/ | grep -i "token\|code\|secret" || echo "OK: token をログしていない"

pnpm --filter ./apps/desktop tauri dev
# ①Discord 未起動 → 連携を押すと graceful に失敗し、hot-loop しない
# ②Discord 起動 → 連携 → 同意モーダル → VC 未参加なら connected
# ③VC に参加 → in-voice へ遷移しチャンネル名が出る
# ④VC を移動 → チャンネル名が追随する
# ⑤VC を退出 → connected へ戻る
# ⑥Discord を落とす → disconnected へ落ちて再接続を連打しない
# ⑦連携解除 → キーチェーンからトークンが消え、再度連携で同意モーダルが出る
```

## 実装後に必要なレビュー

- **security-review 必須。** 争点は次の 5 点になる。
  1. **らくらく方針「外部通信は追加しない」を破ること**の妥当性（改訂文が過不足なくスコープを限定できているか）。
  2. **egress が `discord.com` の 1 ホストに閉じている**こと（`cdn.discordapp.com` 等が紛れていないこと）。
  3. **ローカル RPC の fail-closed** が二層（定数ピン留め＋アサート）で担保されていること。
     `assertAllowedObsUrl` に loopback を混ぜていないこと。
  4. **トークン・認可コード・secret がログ / stdout の状態行 / エラーメッセージに出ない**こと（§9）。
  5. **guild / channel ID が sidecar の外に出ていない**こと（§3 最小権限）。
- 併せて品質面: フレーミングの純関数のテストが**ミューテーションで実際にレッドになる**こと、
  Discord 未起動時に**リトライループを張っていない**ことを確認する。
