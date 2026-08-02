# 057s Discord RPC ＋ StreamKit 技術検証（スパイク・方式決定と中止判断）

> 状態: **完了（2026-08-02・結論＝中止。057 系は [`docs/task-board.md`](../task-board.md) の `## 保留` へ移した）**。
> 分割・線引きは親 [057](057-discord-voice-overlay-design.md) を正とする。結果は末尾の「スパイク結果」節。
>
> **必読前提**: 親 [057](057-discord-voice-overlay-design.md)（**中止条件**）、
> [044s](044s-obs-websocket-spike.md)（スパイクの書き方・結果の残し方の先例）、
> [`docs/security.md`](../security.md)（§1／§9／§10）。
> CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。
> 本タスクは **検証用コードに留め本実装しない**（成果物は決定メモ）。
>
> ⚠ **行番号は書かない**（特定はシンボル名で行うこと）。
>
> ⚠ **057 系で最初に着手するのはこのファイル。** ここで (1) が NG と確定したら、
> 親 057 の「中止条件」に従い **057 系ごと `## 保留` へ移す**（057a 以降は書かない・着手しない）。

## 目的

Discord のローカル RPC と StreamKit Overlay について、**「一般ユーザーへ配布できるか」を実測で確定**させる。

親 057 で採用したアーキテクチャは、次の 2 つがどちらも成立して初めて動く。
どちらも公開情報だけでは確定できず、**実測でしか分からない**。

1. **非承認の Discord アプリが `rpc.voice.read` で現在の VC を読めるか**
   （`rpc` スコープはアプリ所有者と whitelist ユーザーのみ。`rpc.voice.read` は公式ドキュメントで「Public」と
   表記されているが、それが「RPC 接続そのものの承認要件」を免れる意味なのかは書かれていない）
2. **StreamKit の Overlay URL が「自分が管理者でない任意のサーバー」でも描画されるか**

工数と脆さの見積りもここで確定させる。

## 現在の前提（調査結果）

親 057 の「方式決定」節に一次情報の要約を書いた。本スパイクが検証するのは、そこで **未確定**として残した点だけである。

**公開情報から確認できたこと**

- RPC の transport は 2 つ。**(a) 名前付きパイプ / unix socket `discord-ipc-0`〜`-9`**（フレームは
  `opcode(u32 LE) + length(u32 LE) + JSON`・**Origin 検証なし**）と **(b) `ws://127.0.0.1:6463/?v=1&client_id=<id>`**
  （**Origin ヘッダをアプリの `rpc_origins` と照合**）。
- `GET_SELECTED_VOICE_CHANNEL` は **`rpc` または `rpc.voice.read`** で使え、`id` / `name` / `guild_id` / `voice_states[]` を返す。
- 承認済みアプリは **Overlayed / Reactive Images / Discord StreamKit / Streamdeck** の 4 つのみ。
- Overlayed（Tauri・一般配布）は `["identify", "rpc"]`＝**承認済み側**。ソース中に「他のスコープはどう使うのか 🤔」という
  コメントが残っており、**`rpc.voice.read` 単独の道は作者も未解決**。トークン交換は自前 API サーバで client secret を隠している。
- voice-channel-grabber（同じ目的の先行事例）は **承認を取れず**、app tester 枠 50 席か
  「ユーザーが自分で Discord アプリを登録する」の二択になっている。
- Discord は **PKCE と Public Client** をサポートしている（Developer Portal の OAuth2 タブで有効化。
  トークン自動更新には `PUBLIC_OAUTH2_CLIENT` アプリフラグが要る）。ただし
  **RPC の `AUTHORIZE` コマンドが `code_challenge` を受けるか**は書かれていない。
- StreamKit の URL テンプレートは
  `https://streamkit.discord.com/overlay/voice/{guild_id}/{channel_id}?icon=true&online=true&logo=white&...`。
  可変部は **guild_id / channel_id の 2 つだけ**。

**一次情報の出典**（結果メモにも転記すること）

- Discord 公式 RPC ドキュメント: `https://discord.com/developers/docs/topics/rpc`
- OAuth2 スコープ表（`rpc` は Public: No ／ `rpc.voice.read` は Public: Yes ＋「web アプリの RPC 利用は Discord の承認が必要」の脚注）
- Overlayed のソース: `https://github.com/overlayeddev/overlayed`（`apps/desktop/src/rpc/manager.ts`）
- voice-channel-grabber: `https://github.com/dichternebel/voice-channel-grabber`
- obs-websocket v5 プロトコル: `https://github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md`

## このタスクでやること（検証項目）

### (1) 承認要件 — **ここが本スパイクの主目的。NG なら 057 系は止まる**

新規に Discord Application を 1 つ登録し（**team には所属させない**——voice-channel-grabber が
「team 所属アプリは OAuth2 スコープエラーになる」と報告している）、以下を実測する。

- `AUTHORIZE` に **`scopes: ["rpc.voice.read"]`**（必要なら `identify` を併記）を渡して通るか。
  通らない場合のエラーコードと文言を**そのまま記録**する。
- 対比として **`scopes: ["rpc"]`** のエラーも記録する（両者が同じエラーなら「サブスコープに逃げる道は無い」と確定できる）。
- ⚠ **最重要の落とし穴**: 自分は Application の **所有者**なので、`rpc` スコープでも**所有者特権で通ってしまう**。
  「自分の環境で動いた」は配布可否の証拠に**ならない**。
  **必ず、アプリの所有者でも whitelist 登録済みでもない別の Discord アカウントで再現を取る**
  （別アカウント、または協力者の PC）。これを飛ばした検証は無効とする。
- Developer Portal に「RPC の whitelist / app tester」に相当する登録欄が現在も存在するか、
  一般承認の申請窓口が現在も開いているかを確認する（申請するかどうかは本人の判断）。

**この項目の結論の書き方**（3 択で必ずどれかに落とす）

| 結論 | 意味 | 次の行動 |
| --- | --- | --- |
| ✅ 非所有者でも `rpc.voice.read` で通った | **配布可能**。057 系は続行 | 057a へ |
| ⚠ 所有者は通るが非所有者は通らない | **配布不可**。承認が要る | 親 057 の中止条件を発動 → 承認申請 → `## 保留` |
| ✕ 所有者でも通らない | RPC 経路そのものが使えない | 親 057 の中止条件を発動 → `## 保留` |

### (2) OAuth の形（client secret を同梱せずに済むか）

- **`AUTHORIZE` が `code_challenge` / `code_challenge_method` を受けるか**（PKCE 可否）。
- 受けるなら **Public Client ＋ PKCE で client secret を同梱しない**（推奨）。
- 受けないなら選択肢は 2 つ。**どちらを採るかは親 057 に戻して判断する**（スパイクでは決めない）。
  - client secret を同梱する（[032c-d](032c-d-youtube-comments.md) の YouTube に先例がある）
  - 自前のトークン交換サーバを立てる（Overlayed の方式。**サーバー運用が増えるので方針的には最後の手段**）
- リフレッシュトークンの有無と寿命、`PUBLIC_OAUTH2_CLIENT` フラグの要否も記録する。

### (3) RPC のコマンドとイベントの実挙動

- `AUTHENTICATE` 後に `GET_SELECTED_VOICE_CHANNEL` が **`guild_id` を返すか**（返らないと URL が組めない）。
- **DM / グループ DM の通話に入っているときの戻り値**（`guild_id` が無いはず）。
  → **その場合の UI 挙動が決まる**（「サーバーの VC に入ってください」と出すのか、無反応にするのか）。
- **どの VC にも入っていないとき**の戻り値（`null` か、エラーか）。
- `SUBSCRIBE VOICE_CHANNEL_SELECT` が **参加 / 移動 / 退出**それぞれで発火するか。退出時のペイロード
  （`channel_id: null` になるのか、イベント自体が来ないのか）。
- **Discord 未起動・起動途中・再起動時**の挙動（接続できない／接続が切れる／再接続できるか）。
- サーバー名の取得手段。`GET_CHANNEL` はチャンネル名を返すが、**guild 名に追加スコープ（`guilds` 等）が要るか**を確認する。
  要るなら **UI にはチャンネル名だけ出す**（スコープを増やさない方を優先）。

### (4) transport の選択

- (a) 名前付きパイプ / unix socket と (b) `ws://127.0.0.1:6463` の**両方**で疎通を試し、どちらを採るか決める。
  - (a) は Origin 検証が無く Developer Portal への `rpc_origins` 登録が不要。Node の `net` で足りる（**新規依存ゼロ**）。
  - (b) は既存の `ws` パッケージを再利用できるが、Origin ヘッダの登録が要る。
- **macOS と Windows の両方**でパイプ / ソケットのパス解決を確認する
  （Windows は `\\?\pipe\discord-ipc-N`、macOS は `$TMPDIR` 等の探索順）。
  ⚠ Windows は実機（098 の VM）が要るので、**macOS だけで確定したら「Windows 未検証」と明記**する。
- `discord-ipc-0` が埋まっている（他のアプリが使用中）ときに `-1`〜`-9` を順に試す必要があるかを確認する。

### (5) StreamKit URL の描画条件 — **NG なら方式 A ごと崩れる**

- `https://streamkit.discord.com/overlay/voice/{guild_id}/{channel_id}` を **OBS のブラウザソース**に入れ、
  **自分が管理者でない他人のサーバー**の guild / channel で参加者が描画されるかを確認する。
- サーバー側に隠れた前提（Widget 有効化・公開サーバー・特定の権限）が無いかを確認する。
  → 前提があるなら**それは「コラボ相手に設定を頼む」ことを意味し、目的に反する**ので親 057 へ差し戻す。
- 誰も VC にいないときの描画（空表示になるか、エラーになるか）。
- VC を移動したときに URL を差し替えれば追随するか。

### (6) OBS ブラウザソースの自動作成と URL 更新

- `CreateInput` で `inputKind: "browser_source"` を作り、`inputSettings.url` に StreamKit URL を入れられるか。
  透過（`shutdown` / `restart_when_active` / 幅高さ）の既定値も記録する。
- **`SetInputSettings` で URL を差し替えたときにブラウザソースが再読込されるか。**
  されないなら `PressInputPropertiesButton { propertyName: "refreshnocache" }` が要るかを実測する。
- ⚠ **044s は「方式 B（ブラウザソース）は当該 macOS 環境で未描画」と記録している**
  （`CreateInput` は成功するが CEF が取得しに行かず、Interact が真っ黒）。
  **あのときの対象は `127.0.0.1` のローカル HTTP で、今回は公開 HTTPS URL** なので同じとは限らないが、
  **同じ症状が出たら方式 A ごと成立しない**。最優先で確認すること。
- 既存ソースの検出 → 重複作成の防止（`GetInputList`）と、作成先シーン（`GetSceneList.currentProgramSceneName`）。
- VC 退出時の望ましい挙動（ソースを非表示 / URL を空にする / 放置）を実挙動から決める。

## 成果物

- **本ファイル末尾に「スパイク結果」節を追記**する（044s と同じ作法）。項目ごとに ✅ / ⚠ / ✕ と実測値を書く。
- **(1) の 3 択の結論**（配布可能 / 承認が要る / RPC 経路が使えない）。**これが最重要の成果物。**
- transport の決定（IPC パイプ or loopback WS）と、その理由。
- OAuth の形の決定案（PKCE / secret 同梱 / 自前サーバ）——**決定は親 057 に戻す**。
- security 方針の差分ドラフト（親 057 の「割り当て表」の各行に入れる文面の下書き）。
- 057a / 057b の実装スコープ確定（対象ファイル・状態機械・フォールバック仕様）。

## このタスクでやらないこと

- **本実装**（057a / 057b / 057c）。検証コードは**使い捨てブランチかリポジトリ外**に置き、本体へマージしない。
- 新規依存の本採用（検証用に入れたものは §10 記録＋security-review を通してから 057a で正式採用する）。
- 方式の事前決め打ち（実測で決める）。**「たぶん動く」で 057a を書き始めない。**
- Discord への承認申請そのもの（申請するかは (1) の結果を見て本人が判断する）。

## セキュリティ制約（docs/security.md 準拠）

- 検証中の外部通信は **`discord.com`（OAuth）と `streamkit.discord.com`（OBS のブラウザソースが開く）だけ**に留める。
  それ以外の宛先へは出さない。
- **OAuth トークン・client secret・認可コードをログ・スクリーンショット・progress.md に絶対に残さない**（§9）。
  結果メモに書くのは「通った / 通らなかった」とエラーコードだけ。
- **guild ID / channel ID も結果メモに書かない**（コラボ相手のサーバーが特定される）。書くなら伏せ字にする。
- 検証で使う Discord Application の client secret は**リポジトリに置かない**。
- 検証コードを本体に残さない（`git status` で確認）。

## 完了条件

- (1)〜(6) すべてに ✅ / ⚠ / ✕ と実測値が付き、本ファイル末尾の「スパイク結果」節に記録されている。
- **(1) が 3 択のどれかに確定している**（「たぶん通る」で終わらせない・**非所有者での再現を取った**ことが明記されている）。
- (5) が ✅ である（NG なら方式 A ごと親 057 へ差し戻す）。
- transport が決まり、057a / 057b の実装スコープが書ける状態になっている。
- **本体コードに検証コードが残っていない。** 新規依存が `package.json` / `pnpm-lock.yaml` に残っていない。
- [`docs/progress.md`](../progress.md) にスパイク結果を記録し、[`docs/task-board.md`](../task-board.md) の
  057 ブロックに結論を 1 行で書く。

## 確認コマンド

```bash
# 検証は使い捨てブランチ推奨。Discord デスクトップアプリと OBS（WebSocket サーバー有効）を起動して実施する。

# (1)(2)(3)(4): Discord RPC の疎通スクリプト（リポジトリ外 or 使い捨てブランチ）を実行し、
#   AUTHORIZE のレスポンスをそのまま記録する。⚠ 非所有者アカウントでの再現を必ず取る。

# (5)(6): OBS を起動 → 検証スクリプトで browser_source を作成 → 本人が目視。
#   VC を移動して URL を差し替え、追随するかを目視。

# loopback 封じ込めの確認（外部 ESTABLISHED が discord.com 以外に増えていないこと）
lsof -i | grep -i -E "discord|6463|4455" | head -20

# 本体に検証コードが残っていないこと（すべて空が期待）
git status --short
git status --short -- apps/ package.json pnpm-lock.yaml
```

## 実装後に必要なレビュー

- 本スパイクは security 方針の**ドラフト作成**まで（本レビューは 057a / 057b で実施）。
- ただし検証段階でも **トークン・secret・guild/channel ID を残さない**こと（§9）は守る。
- ⚠ **結果メモに「動いた」と書くときは、必ず「誰のアカウントで」を併記する。**
  所有者アカウントの成功を配布可否の根拠として書いてはいけない（それがこのスパイク最大の失敗パターン）。

---

## スパイク結果（2026-08-02・macOS 実測）

検証は**リポジトリ外の単体スクリプト**（`~/057s-spike`・Node 22 / `ws` / `obs-websocket-js` はスクラッチパッド側にのみ導入）で実施し、
**本体コード・依存・host-guard は一切変更していない**（`package.json` / `pnpm-lock.yaml` 差分ゼロ・検証コードは破棄）。
Developer Portal の操作・Discord / OBS の GUI 操作・アカウント切替・目視は本人が担当。

### ⚠ 最重要の結論 — (1) の 3 択

| 結論 | 判定 | 根拠（**誰のアカウントで確認したか**） |
| --- | --- | --- |
| ✅ 非所有者でも `rpc.voice.read` で通った | — | — |
| **⚠ 所有者は通るが非所有者は通らない＝配布不可・承認が要る** | **これ** | `rpc` が **アカウント A（Application の所有者）では成功**、**アカウント B（所有者でも App Tester でもないサブアカウント）では `5000 invalid_scope` で失敗**。同じ `client_id`・同じマシン・同じスクリプトで、**変えたのはログイン中のアカウントだけ** |
| ✕ 所有者でも通らない | **`rpc.voice.read` に限れば これ** | `rpc.voice.read` は **A（所有者）でも `5000 invalid_scope`**。＝ 057 が賭けていた「Public 表記のサブスコープに逃げる」道は**存在しなかった** |

**総合判定＝⚠。** 親 057 の中止条件を発動し、**057 系ごと `## 保留`** へ移した。

⚠ **対照実験が効いている**: `identify` は **A でも B でも成功**した。＝ 接続もアプリ設定も壊れておらず、
**拒否されているのは RPC 系スコープだけ**であることが確定している。

### 実測環境

- macOS **14.6.1 (23G93)** / Apple M3 Pro (Mac15,6) / Node **v22.12.0**
- OBS **32.2.1** / obs-browser **2.26.9** / CEF **127.0.6533.120** / obs-websocket **5.7.4**（RPC v1・`ws://127.0.0.1:4455`）
- Discord デスクトップアプリ（macOS 版）。IPC ソケット実測パス＝**`$TMPDIR/discord-ipc-0`**
- Discord Application: **新規登録・team 非所属**（2026-08-02 登録・Redirect URI に `http://localhost/` を 1 件）
- 検証アカウント: **A＝Application の所有者** ／ **B＝所有者でも App Tester でもないサブアカウント**
- 検証サーバー: **B が作成**したサーバーに **A がロール無し（`@everyone` のみ）の一般メンバーとして参加**。
  ウィジェット無効・非コミュニティ・非公開のまま（P4 で目視確認）
- **Windows 未検証**（(4) のパス解決のみ該当。098 VM 待ち）

### (1) 承認要件 — **⚠**

`AUTHORIZE` の実測（**1 接続の上で順に投げた**。transport は IPC）。

| scopes | A（所有者） | **B（非所有者）** |
| --- | --- | --- |
| `identify` | ✅ 認可コード取得 | **✅ 認可コード取得** |
| `rpc.voice.read` | ✕ `5000` | **✕ `5000`** |
| `rpc` | **✅ 認可コード取得** | **✕ `5000`** |
| `identify` + `rpc.voice.read` | ✕ `5000` | **✕ `5000`** |
| `identify` + `rpc` | ✅ 認可コード取得 | **✕ `5000`** |

エラーは全ケースで同一文言:

```
opcode 1 (FRAME) / evt: "ERROR"
{ "code": 5000, "message": "OAuth2 Error: invalid_scope: The requested scope is invalid, unknown, or malformed." }
```

- **同意モーダル**は `AUTHORIZE` が成功するケースでのみ表示された（拒否ケースはモーダルすら出ずに即エラー）。
- **HANDSHAKE 自体は A でも B でも READY に到達する**（`rpc.voice.read` を要求しない限り接続は成立する）。
  ＝ 弾かれているのは接続ではなく**スコープの払い出し**。
- **認証を迂回する道も無い**（下記「(1) 追試」）。

#### (1) 追試 — OAuth を通さずに読めないか（最後の可能性）

`HANDSHAKE` → `READY` のみの状態（`AUTHORIZE` / `AUTHENTICATE` を送らない）で読み取り系を叩いた結果、**5 コマンド全滅**。

| コマンド | 結果 |
| --- | --- |
| `GET_SELECTED_VOICE_CHANNEL` | ✕ `4006 Not authenticated or invalid scope` |
| `GET_VOICE_SETTINGS` | ✕ `4006` |
| `GET_CHANNELS` | ✕ `4006` |
| `GET_GUILDS` | ✕ `4006` |
| `SUBSCRIBE VOICE_CHANNEL_SELECT` | ✕ `4006` |

＝ リッチプレゼンス（`SET_ACTIVITY`）のように「client_id だけで叩ける読み取り系コマンド」は**存在しない**。

#### Developer Portal の現況（2026-08-02・本人が目視）

- **Public Client トグル: ある（既定 OFF）**
- **RPC whitelist に相当する独立した欄: 無い。** 実体は **App Testers**（**50 枠**）で、これが公式ドキュメントの
  「list of testers … 50 testing spots」に当たる
- **一般承認の申請窓口: 見つからない。** 公式ドキュメントは「承認されれば制限が外れる」と書くだけで**入口を示していない**
  → **⚠ これは再開経路そのものが細いことを意味する**（下記「再開条件」）

### (2) OAuth の形 — **⚠（部分実測・打ち切り）**

- `AUTHORIZE` に `code_challenge` / `code_challenge_method: "S256"` を付けても**エラーにならず、認可コードが返った**
  （`scopes: ["identify"]` で確認・A / B とも）。ただし**受理されたのか黙って無視されたのかは不明**。
- ⚠ **PKCE 可否の本当の判定は「返った code を `client_secret` 抜き＋`code_verifier` だけで交換できるか」**であり、
  **これは未実測**（(1) が ⚠ で確定したため打ち切り規則により停止）。
- **`client_secret` は本スパイクを通じて一度も作成・使用していない**（(1) の判定は `AUTHORIZE` の応答だけで付くため）。
- リフレッシュトークンの有無・寿命・`PUBLIC_OAUTH2_CLIENT` フラグの要否は**未実測**。
- ⚠ **PKCE が使えない場合の選択（secret 同梱 / 自前サーバ）は本スパイクでは決めない**（親 057 に戻す）。

### (3) RPC の実挙動 — **未実測（打ち切り規則により停止）**

(1) が ⚠ で確定した時点で、打ち切り規則に従い測定を停止した。以下はすべて**未実測**:
`GET_SELECTED_VOICE_CHANNEL` の戻り値と `guild_id` の有無 ／ DM・グループ DM 通話時 ／ どの VC にもいないとき ／
`SUBSCRIBE VOICE_CHANNEL_SELECT` の参加・移動・**退出**時のペイロード ／ guild 名取得に追加スコープが要るか。

**再開時はここから測ればよい**（(1)(4)(5)(6) は測り済み）。

**ただし副産物として、Discord 未起動時と接続の扱いが確定している:**

- **ソケットファイル `discord-ipc-0` は Discord を終了しても残る。** ＝「ファイルが在る＝起動している」は成り立たず、
  必ず接続を試みて `ECONNREFUSED` を graceful に扱う必要がある。
- ⚠ **接続を張り直すと次の HANDSHAKE が無応答になる**（切断が届く前に次を接続すると、Discord 側に古い接続が残る）。
  実測で **7 回中 5 回が READY タイムアウト**になり、**1 接続に集約して初めて安定した**。
  → **057a は「毎回張り直す」ではなく「常駐 1 接続を維持する」設計にすること。**

### (4) transport の選択 — **✅ → IPC（名前付きパイプ / unix socket）を採用**

| | (a) IPC パイプ | (b) loopback WS |
| --- | --- | --- |
| 疎通 | **✅ READY 到達** | ✕ **`4001 "Invalid Origin"`** |
| Origin 検証 | **無い** | **ある。`rpc_origins` の登録が必須** |
| 新規依存 | **ゼロ**（Node の `node:net`） | `ws`（既存 dep だが Origin 登録の運用が増える） |

- **実測パス: `$TMPDIR/discord-ipc-0`。`/tmp` 直下には存在しない** ＝ **`/tmp` 決め打ちの実装は macOS で動かない**。
  探索順は `$XDG_RUNTIME_DIR` → `$TMPDIR` → `$TMP` → `$TEMP` → `/tmp` とすること。
- **`-1`〜`-9` へのフォールバックは当環境では発生しなかった**（存在したのは `-0` のみ）。ただし他アプリが占有する状況は未検証。
- フレーム形式 `opcode(u32 LE) + length(u32 LE) + JSON` を実装して疎通を確認済み。
  **⚠ `CLOSE`（opcode 2）と `FRAME`（opcode 1）は別扱い**——無効な client_id は **opcode 2 で `4000 "Invalid Client ID"`**、
  `AUTHORIZE` の失敗は **opcode 1 の `evt: "ERROR"`**。取り違えると (1) の結論が変わる。
  **⚠ ソケットは分割して届くので部分受信の再組立が必須。**
- ⚠ **Windows 未検証**（`\\?\pipe\discord-ipc-N`）。実装は書いたが実行していない。098 VM で確認すること。

### (5) StreamKit URL の描画条件 — **✅**

| ケース | 目視結果 |
| --- | --- |
| 自分が管理者のサーバー | **✅ 描画された** |
| **自分が管理者でないサーバー**（B 作成・A はロール無しの一般メンバー） | **✅ 描画された** |
| 誰も VC にいないとき | **✅ 何も出ない**（エラーにならず空表示） |
| 参加者が 1 人（B のみ） | **✅ 描画された** |
| 参加者が 2 人（A + B） | **✅ 2 人とも描画された** |
| URL を VC-1 → VC-2 に差し替え | **✅ 追随した**（下記 (6)） |

- **隠れた前提は無い。** **ウィジェット無効・非コミュニティ・非公開のまま描画された**（B 側で設定を一切変更していない）。
  ＝ **コラボ相手に何も設定を頼まなくてよい**。057 の目的（サーバーが多い配信者ほど楽になる）が成立する条件を満たしている。
- ⚠ **限界**: 検証したのは「**サブアカウントが作成したサーバー**に、権限を持たない一般メンバーとして参加した」状態。
  **真に第三者が運用するサーバー**（独自のロール構成・ウィジェット設定・コミュニティ設定を持つもの）では未検証。

### (6) OBS ブラウザソース — **✅（ただし前提が 1 つある）**

- ⚠⚠ **044s の未描画症状は再現した。原因は方式ではなく OBS の設定だった。**
  - 初回は `CreateInput` 成功・ソースは出るが**真っ黒**、「対話(操作)」も真っ黒。**044s とまったく同じ症状**。
  - 調査: CEF は初期化済み（GPU ヘルパーは起動）だが **renderer プロセスが 1 つも無く**、
    CEF キャッシュへの書き込みも**ゼロ**（当日触られたのは `SingletonLock` / `SingletonSocket` / `SingletonCookie` のみ）
    ＝**ページの読み込みが始まってすらいない**。インストールは健全（全ヘルパー存在・`codesign --verify --deep --strict` が exit 0・隔離属性なし）。
  - **切り分け: OBS 既定の `https://obsproject.com/browser-source` すら真っ黒だった**
    ＝ StreamKit にも URL スキームにも依存しない、**その環境のブラウザソース機能そのものの不調**。
  - **`global.ini` の `BrowserHWAccel=true` を OFF にして OBS を再起動したら、既定 URL も StreamKit URL も描画された。**
  - → ⚠ **[044s](044s-obs-websocket-spike.md) が「方式 B（ブラウザソース）は当該 macOS 環境で未描画」と結論した根拠も、
    同じ 1 台・同じ設定で起きていた可能性が高い**（当時は方式 A という代替があったため切り分けが不要だった）。
    044s の方式決定（A 採用）自体は覆さないが、**「ブラウザソースは使えない」と一般化してはいけない**。
  - → **057b を作る場合は「描画されないときは OBS のブラウザソースのハードウェアアクセラレーションを疑う」案内が要る**
    （ユーザー環境でも起こりうる）。
- `CreateInput`（`inputKind: "browser_source"`）で作成可。**`GetInputDefaultSettings` の既定値**:

```
css: "body { background-color: rgba(0, 0, 0, 0); margin: 0px auto; overflow: hidden; }"  ← 既定で背景透過
fps: 30 / fps_custom: false / width: 800 / height: 600
shutdown: false / restart_when_active: false / reroute_audio: false
webpage_control_level: 1
url: "https://obsproject.com/browser-source"
```

- **`SetInputSettings` で URL を差し替えるだけで再読込された ✅**
  → **`PressInputPropertiesButton { propertyName: "refreshnocache" }` は不要**（057b の実装が 1 手減る）。
- **`GetInputList` による既存検出 → 重複作成の防止 ✅**（再実行しても input 数は 8 のまま・`browser_source` は 1 つ）。
  作成先は `GetSceneList.currentProgramSceneName`。
- **`SetSceneItemEnabled` で非表示 / 再表示 ✅**（VC 退出時の挙動の候補）。
- **VC 退出時の望ましい挙動**: 誰もいない VC の URL は**空表示**になるため、**URL を残したままでも配信画面には何も出ない**。
  ただし「自分が抜けても他の人が残っていれば映り続ける」ので、**退出時にソースを非表示にするのが妥当**（実装時に確定させる）。
- ⚠ **セキュリティ上の指摘（057b で対処すべき）**: `webpage_control_level` の**既定は `1`**＝埋め込んだページに
  **OBS のステータス読み取りを許す**レベル。057 は**第三者サイト（`streamkit.discord.com`）を配信機に埋め込む**話なので、
  **`0`（NONE）へ落とすこと**。StreamKit のページが OBS の状態を知る必要は無い。

### 通信面（loopback 封じ込め）

- 検証スクリプトの外部 egress は **`discord.com`（OAuth）のみ**。`streamkit.discord.com` へ fetch するのは
  **OBS のブラウザソースであってスクリプトではない**（＝親 057 の「StreamDock の egress は増えない」という主張の裏付け）。
- OBS は `127.0.0.1:4455`、Discord RPC は unix ソケットまたは `127.0.0.1:6463` の loopback のみ。

### 一次情報の出典（転記）

- **Discord RPC**: `https://docs.discord.com/developers/topics/rpc`
  （⚠ 旧 `https://discord.com/developers/docs/topics/rpc` は **301 で移行済み**）
  > "We currently do not allow access to RPC for unapproved apps without being on the game's list of testers.
  >  We grant 50 testing spots… After approval, this restriction is removed."
- **OAuth2 スコープ**: `https://docs.discord.com/developers/topics/oauth2`
  > `rpc` / `rpc.voice.read` / `rpc.voice.write` / `rpc.activities.write`:
  > "for local rpc server access, … - **only available to approved partners**"
  ⚠ **親 057 および本ファイルが前提にしていた「`rpc.voice.read` は Public: Yes」という記述は、現行ドキュメントには存在しない。**
  `rpc.voice.read` は `rpc` と**同じ扱い**で記載されている。実測（所有者でも `invalid_scope`）とも整合する。
- **Discord Social SDK**: `https://docs.discord.com/developers/discord-social-sdk/development-guides/managing-voice-chat`
  → **代替にならない**。承認制であることに加え、**ゲーム内に独自の通話を作る SDK** であって
  「Discord の VC の在室状態を読む」ものではない。
- Overlayed: `https://github.com/overlayeddev/overlayed`（`["identify", "rpc"]`＝**承認済み側**）
- voice-channel-grabber: `https://github.com/dichternebel/voice-channel-grabber`（**承認を取れず** app tester 枠 50 席）
- 承認済み RPC アプリ一覧: `https://gist.github.com/Hacksore/24bf9f8a950b740cd914d62975accff0`
- obs-websocket v5 プロトコル: `https://github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md`

## 決定メモ → **中止（057 系ごと `## 保留`）**

**方式 A（StreamKit URL の自動反映）は正しかった。** (5)(6) がいずれも ✅ で、
**「今いる VC の guild_id / channel_id さえ取れれば、残りは全部動く」ことは実測で証明された。**

**壊れているのは入口だけ**——その 2 つの ID を取る唯一の公式手段（ローカル RPC）が、
**非所有者では使えない**（`rpc`）か、**誰も使えない**（`rpc.voice.read`）。

親 057 の中止条件（本人決定・2026-08-02）は「承認が取れないなら機能を出さない／手動フォールバックもユーザーに
アプリ登録させる方式も作らない」であるため、**057 系全体を `## 保留`** へ移す。

⚠ **057a / 057b / 057c は既に起票済み**（本スパイクより前に書かれている）。**内容は変更せず、状態行だけを「保留」に更新した。**
⚠ **057b の着手条件（(5)(6) とも ✅）は満たされている**——止まっているのは ID を供給する 057a が不可能になったためで、
057b 自体の技術的障害ではない。**再開時は 057b から着手できる**（実測値は 057b の状態行に転記済み）。

### 再開条件

- **Discord から RPC の承認が下りたとき**（`rpc` スコープが一般ユーザーに開いたとき）
- または **`rpc.voice.read` が実際に Public として払い出されるようになったとき**（現状は所有者でも `invalid_scope`）

⚠ **ただし申請の窓口が公開されていない**（Portal にも公式ドキュメントにも入口が無い）。
先行事例（voice-channel-grabber）も承認を取れていない。**再開の見込みは高くないという前提で保留する。**

### 再開時にどこから始めるか

**(1)(4)(5)(6) は測り済み。**(3)（RPC の実挙動）と (2) の残り（トークン交換で PKCE 可否）から再開すればよい。
そのまま 057a へ。**057b は 057a に依存しないので、(5)(6) の実測結果だけで先行着手できる。**

### 残リスク・申し送り

- **⚠ スコープが `rpc` になる。** 仮に承認が下りても、使えるのは `rpc`（**ローカル Discord クライアントの制御権限**）であって
  `rpc.voice.read`（音声の読み取りだけ）ではない。**当初想定よりはるかに広い権限**で、
  §3（最小権限）に正面から関わる。**再開時は「この広さを受け入れるか」を親 057 で改めて判断すること。**
- **⚠ `BrowserHWAccel` 問題**（上記 (6)）。057b を作るときは案内が要る。**044s の記録の解釈にも影響する。**
- **⚠ 057a は常駐 1 接続を維持する設計にすること**（上記 (3)）。
- **⚠ `webpage_control_level` を `0` にすること**（上記 (6)）。
- **⚠ Windows 未検証**（IPC のパス解決）。

### 検証コードの所在

**リポジトリ外**（`~/057s-spike`）。**本体へは未マージ・依存追加ゼロ・host-guard 未改変**
（`git status --short -- apps/ package.json pnpm-lock.yaml` が空であることを確認済み）。
OBS のスパイクソース `SD_SPIKE_057_browser` と `secrets/` は検証後に削除する。
Discord Application は**削除しない**（再開時に同じ `client_id` で再現を取れるようにするため）。

⚠ **検証中に発生した事故（記録）**: 検証スクリプトの自作サマリで、キー名を `errorCode` としたフィールドに
`data.code` をそのまま入れていたため、**成功時の認可コードが平文で出力された**（4 件）。
`data.code` は「成功時＝認可コード（機密）／失敗時＝エラーコード（数値）」の両義フィールドである。
実害は無い（認可コードは単回使用・短命で、交換には未漏洩の `client_secret` が必要）が、
**キー名ベースの伏せ字は「想定したキー」しか守れない**という教訓として残す。
対処として、キー名に依存しない網（24 文字以上の `[A-Za-z0-9_-]` のみからなる不透明文字列を無条件で伏せる）を追加した。
