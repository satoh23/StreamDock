# 057s Discord RPC ＋ StreamKit 技術検証（スパイク・方式決定と中止判断）

> 状態: **未着手（スパイク＝技術検証・本実装しない）**。分割・線引きは親 [057](057-discord-voice-overlay-design.md) を正とする。
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
