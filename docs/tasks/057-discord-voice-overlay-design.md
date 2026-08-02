# 057 Discord コラボ配信 自動オーバーレイ（親設計・線引きの正）

> 状態: **保留（2026-08-02・[057s](057s-discord-rpc-streamkit-spike.md) の実測により下記「中止条件」を発動）**。
> **このタスク自体はコードを 1 行も変更しない**（方式決定と分割の記録のみ）。
> 実装は [057s](057s-discord-rpc-streamkit-spike.md)（スパイク＝技術検証）→ [057a](057a-discord-rpc-voice-detection.md) →
> [057b](057b-obs-streamkit-browser-source.md) → [057c](057c-rakuraku-discord-integration-ui.md) の順。
>
> **必読前提**: [`docs/security.md`](../security.md)（§1 外部通信／§1 例外（044a）／**「らくらくツール設定（外部アプリ連携）方針」**／
> §3 最小権限／§9 ログ・保存／§10 依存／レビュー必須条件）、[032](032-rakuraku-auto-setup-design.md)（らくらく画面の器と per-integration
> アーキテクチャ）、[044](044-obs-auto-source.md)・[044s](044s-obs-websocket-spike.md)（obs-websocket の方式決定とスパイクの作法）、
> [046d](046d-pinned-overlay-obs-auto-add.md)（OBS ソースを 2 種類へ一般化した先例）、[032c-b](032c-b-node-sidecar-twitch-comments.md)（sidecar 封じ込め）。
> CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。
> **新規インターネット egress ＋ OAuth ＋ らくらく方針の改訂を伴うため、実装サブタスクは security-review 必須**。
>
> ⚠ **行番号は書かない**（特定はシンボル名で行うこと）。
>
> ⚠ **本親は「やる」と決めたタスクではない。** [057s](057s-discord-rpc-streamkit-spike.md) の実測が通らなければ
> **057 系ごと `## 保留` へ移す**（下記「中止条件」）。実装サブタスクの記述は、スパイクが通った場合の設計案である。

## 目的

配信者が **Discord でコラボ用のボイスチャンネル（VC）に入るだけ**で、OBS に参加者一覧が出ている状態にする。

現状、コラボ配信のたびに以下が発生している。

1. Discord StreamKit Overlay のサイトを開く
2. 対象の Discord サーバーを探す
3. ボイスチャンネルを選ぶ
4. 生成された Overlay 用 URL をコピーする
5. OBS の Browser Source に貼り付ける

**サーバーを多数使っている配信者ほど 2 と 3 の負担が大きい。** 本機能の後、利用者は上記 1〜5 を一切意識しない。

配信開始前の体験を次にする。

1. Discord でコラボ用 VC へ参加する
2. StreamDock を起動する（または起動済み）
3. OBS を開く → **もうコラボ参加者が映っている**

## 現在の前提（調査結果・実コード）

### らくらくツール設定の器は空のまま残っている

- [`integrationRegistry.ts`](../../apps/desktop/src/features/rakuraku/integrationRegistry.ts) の `INTEGRATION_REGISTRY` は
  **空配列**。032c-a で唯一の連携（棒読みちゃん×VOICEVOX）を撤去したまま、画面シェル（一覧 → 詳細 → 同意 → 実行）と
  `Integration` 型・OS ヘルパだけが温存されている。**057c が入れるのが 1 件目のエントリになる。**
- Rust 側も対称に空（`rakuraku::service` の `registry()` が空を返すため `rakuraku_scan_integration` /
  `rakuraku_launch_component` / `rakuraku_open_official_page` は現状すべて `NotFound`）。
- ヘッダー導線は [`headerSections.ts`](../../apps/desktop/src/components/headerSections.ts) の `rakuraku` エントリで
  既に `implemented: true`。**画面には入れるがカードが 0 件**という状態。

### OBS 連携は既に本実装済み（ただしウィンドウキャプチャ専用）

- [`obs-client.ts`](../../apps/comment-sidecar/src/obs/obs-client.ts) が `obs-websocket-js` で
  `GetSceneList` / `GetInputList` / `CreateInput` / `SetInputSettings` / `GetSceneItemId` / `SetSceneItemEnabled` を叩いている。
- ソース種別は **`window_capture` に固定**（`inputKind` はモジュール内のローカル定数）。対象は `ObsOverlayKind`（`"comments" | "pinned"`）
  の 2 種で、ソース名／窓名の対応は `OBS_OVERLAYS` 表に閉じている。**viewer からソース名・窓名は渡さない**（046d）。
- 宛先は `ws://${OBS_HOST}:${port}`（`OBS_HOST` はコード定数 `127.0.0.1`）。接続直前に
  [`host-guard.ts`](../../apps/comment-sidecar/src/host-guard.ts) の `assertAllowedObsUrl` を必ず通す（fail-closed 二層）。
- 接続は**オンデマンド**（enable のたびに connect → 確保 → disconnect）。**接続リトライループは張らない**。
- パスワードは Rust の `comment_sidecar::set_obs_password` が OS キーチェーンへ保存し、稼働中 sidecar の **stdin private pipe** へ
  1 行書く（loopback WS には載せない）。ポート検出は Rust の `detect_obs_websocket_config`（`config.json` の read-only・
  **`server_password` は読まない**）。

### 通信面の境界

- インターネット通信は **Node sidecar（`bundle.externalBin` 同梱）に封じ込め**、Rust は完全同期のまま
  （async / WS / HTTP crate を足さない）。唯一の正面からの例外が 055（`tauri-plugin-updater`）。
- sidecar の allow-list は [`host-guard.ts`](../../apps/comment-sidecar/src/host-guard.ts) の
  `ALLOWED_EXACT_HOSTS` / `ALLOWED_HTTPS_WILDCARD_SUFFIXES` / `ALLOWED_WS_WILDCARD_SUFFIX` / `ALLOWED_GRPC_EXACT_HOSTS` で
  **fail-closed**（`installHttpHostGuard` が global `fetch` を差し替える）。**Discord は 1 つも入っていない。**
- sidecar → Rust の通知経路は **stdout の 1 行プロトコル**（`COMMENT_SIDECAR_PORT=` / `COMMENT_SIDECAR_TOKEN=` /
  `COMMENT_SIDECAR_OPEN_URL=` など）が既にある。Rust は別スレッドで同期的に読む。
- Rust → webview のイベントは 055d で `app-update:progress` が入っており、**Tauri イベントの先例がある**。
- **メインウィンドウ（＝らくらく画面）は sidecar と loopback WS を張っていない。** WS を張っているのは
  コメントビューア窓だけ（[`commentStream.ts`](../../apps/desktop/src/features/comment-viewer/commentStream.ts)）。

### Discord 連携は 1 行も存在しない

リポジトリ全体で `discord` の実装・依存・設定はゼロ（[`docs/progress.md`](../progress.md) に第三者アプリの例として
名前が出るのみ）。**057 は完全な新規スライス。**

## 方式決定（比較と採用理由）

### ① 「現在参加中の VC」をどう取るか

| 方式 | 実現可能性 | メリット | デメリット / 制約 | 一般配布 |
| --- | --- | --- | --- | --- |
| **ローカル RPC（IPC パイプ / loopback WS）** | ◯（要実測） | VC の参加・移動・退出に**常駐監視で追従**できる。公式 API。コラボ相手のサーバーに何も入れない | `rpc` スコープは **アプリ所有者と whitelist ユーザーのみ**（Discord の審査が必要）。`rpc.voice.read` は公式ドキュメント上「Public」だが**非承認アプリで通るかは未実証** | **承認次第（＝057s の主目的）** |
| Bot ＋ Gateway の voice state | ◯ | 承認不要 | **コラボ相手のサーバー全部に Bot を入れてもらう**必要がある。「サーバーが多いほど楽になる」という目的と正反対 | △ |
| Guild Widget JSON | △ | 認証不要 | サーバー側で Widget 有効化が必要。**自分がどの VC にいるかは分からない**（VC の在室者一覧しか出ない） | ✕ |
| Discord クライアントのローカルデータ解析 | △ | — | 非公式・クライアント更新で壊れる。§2（frontend から自由な OS 操作をさせない）・§5（ファイル操作はアプリ管理領域に限定）に真っ向から反する | **却下** |

**採用: ローカル RPC。** ただし承認要件が本機能の生死を決めるため、**[057s](057s-discord-rpc-streamkit-spike.md) で実測してから実装に入る。**

RPC の要点（一次情報で確認済み・出典は 057s に記録する）:

- Transport は 2 つ。**(a) 名前付きパイプ / unix socket `discord-ipc-0`〜`-9`**（Windows は `\\?\pipe\`、macOS は
  `$TMPDIR` 等の探索順）。フレームは `opcode(u32 LE) + length(u32 LE) + JSON`。**ブラウザ外なので Origin 検証がない。**
  **(b) `ws://127.0.0.1:6463/?v=1&client_id=<id>`**。こちらは **Origin ヘッダをアプリの `rpc_origins` と照合**する。
- フロー: `HANDSHAKE` → `READY` → `AUTHORIZE`（Discord クライアント内に同意モーダルが出る）→ `code` →
  トークン交換 → `AUTHENTICATE` → コマンド。
- `GET_SELECTED_VOICE_CHANNEL` は **`rpc` または `rpc.voice.read`** で使える。戻り値に `id` / `name` / `guild_id` / `voice_states[]`。
- `VOICE_CHANNEL_SELECT` を `SUBSCRIBE` すれば参加・移動・退出が push で届く。

### ② Overlay をどう描くか — **方式 A（StreamKit URL の自動反映）を採用**

| 観点 | **方式 A: StreamKit URL 自動反映（採用）** | 方式 B: 自前オーバーレイ窓（不採用） |
| --- | --- | --- |
| 実装 | URL を組んで OBS の **Browser Source** に入れるだけ | RPC の `voice_states` ＋ `SPEAKING_START`/`SPEAKING_STOP` を購読し、透過窓に自分で描画 → 既存の window_capture 自動追加（044a/046d）に相乗り |
| 見た目 | **Discord 公式そのもの**（利用者の期待と一致） | 自由に作れる |
| StreamDock の egress | **増えない**（URL を開くのは OBS のブラウザソース） | アイコン表示に `cdn.discordapp.com` への**新規 egress が要る** |
| RPC の購読範囲 | `GET_SELECTED_VOICE_CHANNEL` ＋ `VOICE_CHANNEL_SELECT` のみ | 上記＋ voice state ＋ speaking イベント＝**承認要件が重くなる可能性** |
| 工数 | 小（既存 `obs-client.ts` の一般化） | 大（描画・状態同期・アイコン取得を新規に作る） |
| 外部仕様への依存 | StreamKit のサイト仕様が変わると壊れる | 壊れない |

**採用理由**: 目的（「StreamKit の設定作業を意識させない」）に**文字どおり一致**し、**StreamDock 自身の外部通信を増やさない**。
StreamKit の URL は可変部が `guild_id` / `channel_id` の **2 つだけ**のテンプレートで、StreamKit のサイトは
「OAuth でサーバー一覧を出して ID を穴埋めする GUI」に過ぎない。**この 2 つの ID さえ取れれば、サイトを開かずに URL を組み立てられる**
——これが本機能の芯である。

```
https://streamkit.discord.com/overlay/voice/{guild_id}/{channel_id}?icon=true&online=true&logo=white&...
```

方式 B は**将来タスクとして残す**（[`docs/task-board.md`](../task-board.md) の `## Todo`）。
意匠のカスタム要求が出たとき、または StreamKit が廃止されたときに再検討する。**この決定を覆すには 057s 相当の再実測が要る。**

### ③ 先行事例（実コードを確認した）

- **[Overlayed](https://github.com/overlayeddev/overlayed)**（Tauri v2 + React・winget / brew / flathub で一般配布）:
  方式 B の完成形。RPC は `ws://127.0.0.1:6463` に Origin ヘッダ付きで接続し、スコープは **`["identify", "rpc"]`**
  ＝ **Discord の承認済みアプリ側**（承認済みは Overlayed / Reactive Images / Discord StreamKit / Streamdeck の 4 つのみ）。
  ソース中に「他のスコープはどう使うのか 🤔」というコメントが残っており、**`rpc.voice.read` 単独の利用は作者も未解決**。
  トークン交換は自前の API サーバで client secret を隠している。
- **[voice-channel-grabber](https://github.com/dichternebel/voice-channel-grabber)**: 本機能とまったく同じ目的
  （StreamKit URL を現在の VC に同期）。**承認を取れず**、「作者の app tester 枠 50 席に入る」か
  「ユーザーが自分で Discord アプリを登録する」の二択になっている。
  → **これが本機能の最大のリスクそのもの。** 同じ結末にならないことを 057s で確定させる。

## 採用アーキテクチャ

```
Discord デスクトップアプリ
  │  ローカル RPC（IPC パイプ or ws://127.0.0.1:6463）※どちらを採るかは 057s
  ▼
comment-sidecar（Node・既存の「通信面」）
  │   AUTHORIZE(rpc.voice.read) → トークン交換(https://discord.com) → AUTHENTICATE
  │   GET_SELECTED_VOICE_CHANNEL ＋ SUBSCRIBE VOICE_CHANNEL_SELECT
  │
  ├─ guildId / channelId から URL を組む（テンプレートは sidecar 内の定数）
  │     https://streamkit.discord.com/overlay/voice/{guildId}/{channelId}?...
  │
  ├─ obs-websocket（既存 obs-client.ts）→ Browser Source「StreamDock Discord 通話」を作成 / URL を更新
  │
  └─ stdout private pipe → Rust → Tauri イベント → らくらく画面（状態表示のみ）
```

**なぜこの形か**

1. **StreamDock 本体の egress を増やさない。** 増える通信は sidecar からの `discord.com`（トークン交換）だけ。
   **StreamKit URL を実際に開くのは OBS のブラウザソース**であって StreamDock ではない。方式 A の最大の利点で、
   §1 に足す例外が 1 宛先で済む。
2. **通信面は sidecar に閉じる**という既存の境界（032c-b）をそのまま守る。Rust は同期のままで、async / WS / OAuth を持ち込まない。
3. **frontend は raw な URL / guild ID / channel ID を一切扱わない。** らくらく方針の「frontend からは raw なパス/URL/ポート/
   コマンドを受けない」を維持し、画面に出すのは**チャンネル名と状態だけ**。
4. **メイン窓は sidecar と WS を張らない。** 状態は既存の stdout 1 行プロトコル → Rust → Tauri イベント
   （055d の `app-update:progress` が先例）で配る。コメビュ窓の loopback WS はコメビュ専用のまま。

### ⚠ この設計で崩れる前提が 1 つある

[`docs/security.md`](../security.md) の「らくらくツール設定（外部アプリ連携）方針」は現状
**「外部通信は追加しない（capability は追加しない）。`csp: null` 不変」** と書いてある。057 はこれを正面から破る。
**同節の改訂を [057a](057a-discord-rpc-voice-detection.md) の完了条件に入れる**（下記の割り当て表）。

## 中止条件（本人決定・2026-08-02）

**Discord の RPC 承認が取れない、または `rpc.voice.read` が非承認アプリで通らないと確定した場合、機能を出さない。**

- 手動で「サーバー / VC を選んで保存 → OBS へは自動反映」というフォールバックは **作らない**
  （UX が 1 段落ちるうえ、「意識しなくてよい」という目的が半分しか満たせないため）。
- ユーザーに自分の Discord アプリを登録させる方式（voice-channel-grabber と同じ）も **採らない**
  （Developer Portal での登録を要求する時点で目的に反する）。
- その場合は **057 系全体を [`docs/task-board.md`](../task-board.md) の `## 保留` へ移し**、
  Discord への承認申請の結果を待つ。**057s の結果が出るまで 057a 以降には着手しない。**

### 発動の記録（2026-08-02）

**上記の中止条件を発動した。** 実測の全文は [057s](057s-discord-rpc-streamkit-spike.md) 末尾の「スパイク結果」節を正とする。

**何が理由で止めたか**

`AUTHORIZE` に対し、Discord は全拒否ケースで同一のエラーを返した。

```
opcode 1 (FRAME) / evt: "ERROR"
{ "code": 5000, "message": "OAuth2 Error: invalid_scope: The requested scope is invalid, unknown, or malformed." }
```

| scopes | A（Application の所有者） | **B（所有者でも App Tester でもないアカウント）** |
| --- | --- | --- |
| `identify`（対照実験） | ✅ 認可コード取得 | **✅ 認可コード取得** |
| `rpc.voice.read` | **✕ `5000`** | **✕ `5000`** |
| `rpc` | ✅ 認可コード取得 | **✕ `5000`** |

- **`rpc.voice.read` は所有者でも使えない。** 本親が「方式決定」節で `rpc` の代替として期待していた
  **「Public 表記のサブスコープに逃げる」道は、そもそも存在しなかった。**
  現行の公式ドキュメントでも `rpc.voice.read` は `rpc` と同じ **"only available to approved partners"** と記載されており
  （本親が根拠にした「Public: Yes」の記述は現行ドキュメントに無い）、実測と整合する。
- **`rpc` は所有者だけが通る。** ＝ 057s が最重要の落とし穴として警告していた「所有者特権で通ってしまう」ケースそのもの。
  **一般ユーザーは全員 B 側**なので、**配布した先では動かない。**
- **`identify` が A / B 両方で通っている**ため、「接続やアプリ設定が壊れている」可能性は排除されている。
  拒否されているのは **RPC 系スコープだけ**である。
- **OAuth を迂回する道も無い**: `HANDSHAKE`/`READY` のみの状態で `GET_SELECTED_VOICE_CHANNEL` /
  `GET_VOICE_SETTINGS` / `GET_CHANNELS` / `GET_GUILDS` / `SUBSCRIBE VOICE_CHANNEL_SELECT` を叩いたところ、
  **5 コマンドすべて `4006 "Not authenticated or invalid scope"`**。
- **Discord Social SDK も代替にならない**（承認制であることに加え、**ゲーム内に独自の通話を作る SDK** であって
  Discord の VC の在室状態を読むものではない）。

**再現条件**

- Discord Application は **新規登録・team 非所属**（team 所属時の既知問題を避けるため）
- transport は **IPC**（`$TMPDIR/discord-ipc-0`）。**1 接続の上で scopes を変えて順に `AUTHORIZE`** を投げた
- **B は App Testers に登録していない**（登録すると所有者と同じ扱いになり検証が無効になる）
- 同じ `client_id`・同じマシン・同じスクリプトで、**変えたのはログイン中のアカウントだけ**

**どこまでは成立していたか（＝方式 A 自体は生きている）**

- **(5) StreamKit URL は、自分が管理者でないサーバーでも参加者を描画した ✅**。
  **ウィジェット無効・非コミュニティ・非公開のまま**描画されたので、**隠れた前提は無い**
  ＝ **コラボ相手に設定を頼む必要が無い**（本機能の目的が成立する条件を満たしている）。
- **(6) OBS ブラウザソースの自動作成・URL 差し替え・重複防止・表示切替はすべて動いた ✅**。
  **`SetInputSettings` だけで再読込される**ため `refreshnocache` は不要。
- **(4) transport は IPC を採るべきと確定**（loopback WS は `4001 "Invalid Origin"` で `rpc_origins` 登録が必須。
  IPC は Origin 検証が無く、Node の `node:net` だけで**新規依存ゼロ**）。

**＝ 「今いる VC の guild_id / channel_id さえ取れれば、残りは全部動く」ことは実測で証明されている。**
壊れているのは入口だけである。

**半自動版（ID を手登録 → OBS へ自動反映）の再検討と却下（本人決定・2026-08-02）**

実測後に「**自動反映が無理でも、URL の自動生成だけならできるのでは**」を改めて検討した。結論は **作らない**——
中止条件の 1 つ目（手動フォールバックを作らない）を**維持する**。

- **技術的には可能だった。** URL の可変部は `guild_id` / `channel_id` の 2 つだけで、(5)(6) が ✅ なので
  **OBS 側は完全に自動になる**（ソース作成・URL 投入・差し替え・重複防止すべて実証済み）。
- **しかし ID の入手が「半自動」までしか行かない**:

  | 経路 | 可否 |
  | --- | --- |
  | 今いる VC の自動検出 | **✕**（RPC が要る＝本発動の理由そのもの） |
  | サーバー一覧（`guilds` スコープ） | ◯ と思われる（公開スコープ・`identify` が非所有者で通った）が **未検証** |
  | **チャンネル一覧** | **✕**。user の OAuth トークンでは取得できない（Bot か RPC が要る）→ **VC は必ず手入力になる** |
  | Guild Widget JSON | **✕（実質）**。サーバー側で**ウィジェット有効化が必要**＝**コラボ相手に設定を頼む**ことになり目的に反する |

  ⚠ StreamKit のサイトがサーバーと VC を選ばせられるのは、**あのサイト自身が承認済みアプリとしてローカル RPC を
  使っている**ため（OBS のブラウザソースが当該ページを読み込んだ際に Discord の同意モーダルが出たことで裏付けられた）。
  **同じことを非承認アプリで再現する道は無い。**
- ⚠ **判断の前提が変わっていた点も記録しておく**: 当初この案を却下したときの比較は「**半分 vs 全部**」だったが、
  実測後の比較は「**半分 vs ゼロ**」である。それでも**却下を維持**した——**チャンネルの手入力が残る以上、
  「サーバーを多数使っている配信者ほど VC を探す負担が大きい」という本機能の芯（目的の 2・3）が解消されない**ため。
- **再検討のトリガー**: 「**VC を人が指定する手間を許容してでも、OBS への反映だけ自動化したい**」という要望が
  実際に出たとき。そのときは `guilds` スコープの実測（非所有者で通るか）から始めればよい。

**再開条件**

- **Discord から RPC の承認が下りたとき**（`rpc` が一般ユーザーに開いたとき）
- または **`rpc.voice.read` が実際に Public として払い出されるようになったとき**

⚠ **ただし申請の窓口が公開されていない。** Developer Portal に RPC whitelist の独立した欄は無く、
実体は **App Testers（50 枠）**——これは公式ドキュメントの「list of testers … 50 testing spots」に当たる。
一般承認の申請入口は Portal にも公式ドキュメントにも見当たらず、先行事例
（[voice-channel-grabber](https://github.com/dichternebel/voice-channel-grabber)）も承認を取れていない。
**再開の見込みは高くないという前提で保留する。**

**再開時にどこから始めるか**

**(1)(4)(5)(6) は測り済み。** 057s の (3)（RPC の実挙動＝`GET_SELECTED_VOICE_CHANNEL` の戻り値・DM 通話・
退出時のペイロード・guild 名のスコープ要否）と (2) の残り（トークン交換で PKCE 可否）から再開し、そのまま 057a へ。
**057b は 057a に依存しないので、(5)(6) の実測結果だけで先行着手できる。**

⚠ **再開時に必ず本ファイルで再判断すること**: 承認が下りても使えるのは **`rpc`**
（＝**ローカル Discord クライアントの制御権限**）であって `rpc.voice.read`（音声の読み取りだけ）ではない。
**当初想定よりはるかに広い権限**であり、[`docs/security.md`](../security.md) §3（最小権限）に正面から関わる。
**「この広さを受け入れるか」は、承認が下りた時点で改めて判断する。**

⚠ **057a / 057b / 057c は既に起票済み**（本発動より前に書かれている）。**内容は変更せず、状態行だけを「保留」に更新した**。
下記「分割と実装順」表と「security.md へ追記する節の割り当て」表も、**承認が下りたら生きる設計として残してある**（消さないこと）。

- **[057a](057a-discord-rpc-voice-detection.md)** … 着手条件（(1) が ✅）を**満たさなかった**ため保留。
  ⚠ 設計が `rpc.voice.read` 前提で書かれているので、**再開時はスコープ前提の書き直しが要る**。
- **[057b](057b-obs-streamkit-browser-source.md)** … ⚠ **本タスク自身の着手条件（(5)(6) とも ✅）は満たされている。**
  止まっているのは **ID を供給する 057a が不可能になった**ためであり、057b の技術的障害ではない。
  **再開時はここから着手できる**（実測値を状態行に転記済み）。
- **[057c](057c-rakuraku-discord-integration-ui.md)** … 057a に連動して保留。
  ⚠ `INTEGRATION_REGISTRY` は**空のまま**＝らくらく画面はカード 0 件が続く。

## 分割と実装順

| 子 | 内容 | 実装有無 | レビュー |
| --- | --- | --- | --- |
| [057s](057s-discord-rpc-streamkit-spike.md) | RPC の承認要件・PKCE 可否・StreamKit URL の描画条件・OBS ブラウザソースの再読込を**実測**し、方式と中止判断を確定 | **検証のみ（本実装しない）** | 方針ドラフトのみ |
| [057a](057a-discord-rpc-voice-detection.md) | sidecar に Discord RPC クライアント＋OAuth＋常駐監視。host-guard 拡張・security.md 改訂 | 実装 | **security-review 必須** |
| [057b](057b-obs-streamkit-browser-source.md) | `obs-client.ts` を `browser_source` へ一般化し、URL を自動投入 / 自動更新 | 実装 | **軽 security-review** |
| [057c](057c-rakuraku-discord-integration-ui.md) | らくらくツール設定に 1 件目の連携として載せる（一覧 / 詳細 / 同意 / 実行 / 状態表示） | 実装 | **軽レビュー** |

```
057s（スパイク・ここが通らなければ 057 系は止まる）
  │
  ├─→ 057a Discord 接続基盤（sidecar・security-review 必須）
  │        │
  │        └─→ 057c らくらく UI（057a の状態イベントを購読）
  │
  └─→ 057b OBS ブラウザソース（057a と独立に着手可・URL は固定値で先行検証できる）
```

⚠ **057b は 057a に依存しない。** URL を固定値（自分のサーバーの guild/channel）で先に通せるので、
057a の承認待ちが長引くなら 057b だけ先に進められる。

## security.md へ追記する節の割り当て

| 節 | 追記内容 | 担当サブタスク |
| --- | --- | --- |
| §1 に **`### 例外（057・Discord RPC 連携＝コラボ VC の自動検出）`** を新設 | 宛先 allow-list（`discord.com` のトークン交換のみ）／ローカル RPC は loopback・IPC で外部に出ないこと／**ユーザーが明示的に連携したときだけ接続**／送るもの（認可コードとトークンのみ・コメント本文や視聴者情報は送らない） | 057a |
| §1「例外（044a）」に **057 節**を追記 | OBS に作るソースが `window_capture` に加え **`browser_source` へ拡張**されること／その URL が `streamkit.discord.com` を指し、**開くのは OBS であって StreamDock ではない**こと | 057b |
| **「らくらくツール設定（外部アプリ連携）方針」の改訂** | 「外部通信は追加しない」を「**057 を唯一の例外として、明示同意 ＋ security-review を通した連携に限り外部通信を許す**」へ。既存の他条項（自動 DL しない・登録済み exe のみ起動・frontend は raw を渡さない）は不変 | 057a |
| §9 に追補 | Discord の OAuth トークンは **OS キーチェーン**（Twitch / YouTube と同型）／loopback WS にも stdout にも載せない／**guild ID / channel ID を永続化しない**／コラボ相手の表示名を保存しない | 057a |
| §10 に「追加した依存（057）」 | 新規 npm を足すなら理由を記録。**足さない方針**（Node 標準の `net` ＋ 既存の `ws` で足りるはず）なら「明示的に落とした依存」として記録 | 057a |
| 「レビュー必須条件」に 1 行 | 「**Discord ローカル RPC 連携（VC の自動検出・OAuth トークン取扱・OBS への URL 自動投入）**」 | 057a |

## このタスク（親）でやらないこと（＝ 057 系全体のスコープ外）

- **方式 B（自前オーバーレイ描画）**。将来タスクとして `## Todo` に残す。
- **Discord のテキストチャット取得・読み上げ**（コメントビューアの領分であり、別の承認要件・別の §9 判断になる）。
- **Bot の導入**（サーバー側に何かを入れる方式は目的に反する）。
- **StreamKit の意匠カスタマイズ UI**（クエリパラメータを弄れるようにするのは、まず動いてから）。
- **手動で guild / channel を選ぶフォールバック UI**（本人決定・上記「中止条件」）。
- 本親でのコード変更（**1 行も変更しない**）。

## セキュリティ制約（docs/security.md 準拠）

- **本親はドキュメントのみ**。コード・依存・capability・`tauri.conf.json` を変更しない。`csp: null` 不変。
- 実装サブタスクの制約は各ファイルに書く。共通の線引きは以下。
  - Discord のローカル RPC は **IPC または `ws://127.0.0.1:6463` のみ**。**fail-closed のアサートを必ず通す**（`assertAllowedObsUrl` と同じ作法）。
  - インターネット egress は **`discord.com`（OAuth トークン交換）だけ**。sidecar の allow-list に足す。
  - **接続はユーザーが明示的に連携したときだけ**。同意画面に「Discord アカウントの連携」「OBS にソースを作ること」
    「**コラボ相手の表示名とアイコンが OBS 経由で配信に出ること**」を明示する。
  - トークンは **非ログ・非外部送信**、OS キーチェーンのみ（§9）。
  - **frontend には ID も URL も渡さない**（§3／らくらく方針）。

## 完了条件（親）

- 方式（A / B）と「現在参加中 VC の取得方法」が本ファイルで決定され、**中止条件が明文化されている**。
- 子タスク 4 本（057s / 057a / 057b / 057c）が起票され、実装順と依存関係が定まっている。
- security.md へ追記する節の割り当てが確定している。
- [`docs/task-board.md`](../task-board.md) に 057 ブロックが追加されている。
- **コードの差分がゼロ**（本親は 1 行も変更しない）。[`docs/progress.md`](../progress.md) を更新。

## 確認コマンド

```bash
git status --short
# 期待: docs/ 配下のみ

# コード差分ゼロの担保（すべて空が期待）
git status --short -- apps/ .github/ package.json pnpm-lock.yaml

# 番号衝突の確認（057 が他タスク・board で使われていないこと）
grep -rn "\b057\b" docs/task-board.md docs/tasks/ | grep -v "^docs/tasks/057"

# 子タスクのリンク先が実在すること
ls docs/tasks/057*.md
```

## 実装後に必要なレビュー

- 本親は**方針ドラフトのみ**（レビューは 057a / 057b で本実施）。
- ただし本親の時点で、**らくらく方針「外部通信は追加しない」を破る**ことと、
  **コラボ相手（第三者）の表示名・アイコンが配信画面に出る**ことの 2 点が security-review の争点になることを
  記録しておく（057a のレビューで最初に確認される項目）。
