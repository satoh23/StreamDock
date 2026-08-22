# 063e Twitch チャンネルポイントの取り込み（ガチャのトリガー・受信面拡張）

> 状態: **未着手（2026-08-23 起票）**。分割・線引きは親 [063](063-gacha-effect.md) を正とする。
>
> ⚠⚠⚠ **実装順に強い制約がある**: **段 1 は [066](066-chat-send.md) をリリースする前に入れること。**
> 066 が `user:write:chat` を足した時点で**既存ユーザーの再ログインは既に確定している**ので、
> ここに相乗りすれば**追加の再ログインはゼロ**。⚠ 後に回すと**再ログインを 2 回起こす**。
>
> ⚠⚠ **実装順は [063a](063a-gacha-definition-editor.md) ✅ → [063d](063d-gacha-library.md) →
> **本タスク 段 1** → [063b](063b-gacha-draw-and-triggers.md) → [063c](063c-gacha-presentation.md)（保留）。**
> **文字は識別子であって順番ではない**（063d の同じ注記と同じ規律）。
>
> **必読前提**: 親 [063](063-gacha-effect.md)、
> ⚠⚠ **スコープ拡大＋非致命購読の先例 [043a](043a-monetary-ingestion-fidelity.md)（`bits:read` / `channel.bits.use`）**、
> ⚠⚠ **`CommentEventType` に variant を足した先例 [062a](062a-twitch-raid-ingestion.md)（⚠ 特に「実装で判明した前提の訂正」1・9）**、
> **調査 [063s](063s-tanuesa-gacha-spike.md) (4)（⚠ 本タスクは 063s の「選択肢 (a)」そのものである）**、
> **出力の型 [063t](063t-gacha-output-types-spike.md)**、
> 条件の配列 [061j](061j-keyword-conditions.md)（`EFFECT_ASSIGNMENTS_KEY` の正）、
> 割り当ての行 [061d](061d-effect-template-ui.md)（`EFFECT_EVENT_ROWS` の正）、
> スコープ拡大の姿勢 [066](066-chat-send.md)、
> [`docs/security.md`](../security.md)（**§1**／§8／§9／§10）。
> CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。
> ⚠⚠ **段 1 は `security-review` 必須**（OAuth スコープの拡大＝ 043a / 066 と同じ扱い）。
>
> ⚠ **行番号は書かない**（特定はシンボル名で行うこと）。

## 目的

**Twitch のチャンネルポイント報酬の引き換えを受信し、ガチャのトリガーとして使えるようにする。**

依頼者の指摘（2026-08-23）:

> チャネポ引き換えが扱えない理由は何？ それが扱えないと論外なんだけど

## 発端 —— ⚠⚠ 「扱えない」の根拠は 1 つしか無く、その 1 つが崩れた

[063s](063s-tanuesa-gacha-spike.md) (4) と親 [063](063-gacha-effect.md) が「扱えない」と書いた根拠は
**「新規 OAuth スコープが要る＝既存ユーザーが再ログインするまで届かない」の 1 点だけ**である。
API 上の制限でも、審査でも、Device Code Flow の制約でもない。⚠ そして次の 3 つで前提が変わった:

1. ⚠⚠⚠ **066 が既に再ログインを発生させている。** 現在の `TWITCH_SCOPES` は
   `["user:read:chat", "bits:read", "user:write:chat"]`（`user:write:chat` は 066 段 1 で追加済み）。
   ⇒ **同じリリースに相乗りすれば追加コストはゼロ。**⚠ **これは今しか無い窓である。**
2. ⚠ **チャンネルポイントが Affiliate 不要になった**（Twitch「Monetization for All」・2026-05-13〜。
   ⚠ **二次ソース複数一致・一次確認は未実施**）。「持っている人が少ない」は反論として成立しない。
3. **保留理由②は既に取り消し済み**——親 063 が「チャネポ対応は 063a の前提ではなくなった」と訂正済み。
   ⚠ ただしそれは「**要らない**」ではなく「**063a の前提ではない**」であって、
   [063s](063s-tanuesa-gacha-spike.md) (4) の「**たぬえさのガチャは公開されている限り全例がチャネポ**」は**取り消されていない**。

⇒ ⚠⚠ **たぬえさ代替を名乗るなら、チャネポは「あると良い」ではなく「無いと用途が 1 つ丸ごと欠ける」。**

## 現在の前提（調査結果・⚠ 出典の強さを併記）

### 公開情報（2026-08-23 に確認）

| 事実 | 出典の強さ |
|---|---|
| 購読は `channel.channel_points_custom_reward_redemption.add` | ✅ Twitch 公式 EventSub ドキュメント |
| Authorization は「Must have `channel:read:redemptions` scope.」 | ✅ **公式原文** |
| condition は `broadcaster_user_id`（＋任意 `reward_id`） | ✅ 公式 |
| ⚠ **ブロードキャスター本人のトークンでしか購読できない**（モデレータ／エディタ不可） | ⚠ 開発者フォーラム・**公式原文では未確認** |
| ⚠⚠ **報酬名（`reward.title`）がイベントペイロードに載るか** | ⚠⚠ **未確認**（下記 穴 G） |
| 載っていなくても Helix `GET /channel_points/custom_rewards` で引ける（**同じスコープ**） | ⚠ 未確認 |
| チャンネルポイントは Affiliate 不要（2026-05-13〜） | ⚠ 二次ソース複数一致 |

⚠ **`channel.channel_points_automatic_reward_redemption.add`（自動報酬＝ハイライト等）は別購読であり、本タスクの対象外。**

### 実コード（⚠ 本節は推測を含まない。すべて読んで確認した）

- **新規 egress 先はゼロ。** `api.twitch.tv` / `eventsub.wss.twitch.tv` はいずれも
  `host-guard.ts` の allow-list にあり、宛先は `twitch-config.ts` に**定数でピン留め**されている。
  ⚠ **増えるのは能力だけ**（066 が §1 に書いた形とまったく同じ）。
- 購読の作成は `eventsub-websocket.client.ts` の `subscribeChatEvents`。
  ⚠⚠ **`channel.bits.use` が既に「任意＝非致命 catch」の形で並んでおり、本タスクはその 3 件目**である
  （403 でも本線の 2 購読とコメント配信を止めない）。
- 種別の語彙は **5 段**を通る。⚠⚠ **どこか 1 段を落とすと `?? "chat"` に落ちて
  「普通のコメントとして保存される」**（`wire.ts` が `raidViewerCount` の JSDoc で名指しで警告している事故）:
  1. `raw.dto.ts` … `TwitchEventSubSubscriptionType` ＋ envelope の `event` union ＋ 新 DTO
  2. `comment.mapper.ts`（twitch）
  3. `vendor/shared/src/comment/comment-types.ts` … `"raid"` がある union
  4. `comment-to-view.converter.ts` … `eventType` を素通しするだけ（明示列挙層）
  5. `src/wire.ts` … `CanonicalCommentEventType` ＋ `EVENT_TYPE_MAP`
  ⚠ **5 の `EVENT_TYPE_MAP` は `Record<OsareviewCommentViewDto["eventType"], …>` なので、
  3 の union に足せばキー不足でコンパイルが落ちる**＝構造的に落とせない（062a が確認した網）。
- Rust は `comment_viewer/model.rs` の `CommentEventType` に variant を 1 つと `as_str` に 1 行。
  ⚠⚠ **DB のマイグレーションは不要**——`viewer_comments.event_type` は `TEXT NOT NULL` で
  **CHECK 制約が無い**（`viewer_memory/repository.rs`）。
- ⚠⚠ **frontend の 2 箇所が `Record<CommentEventType, …>` でコンパイルを落とし、判断を強制する**
  （062a の「訂正 9」と同じ網）: `pinnedComments.ts` の `EVENT_TYPES` と
  `speechText.test.ts` の `SPEECH_KIND`。
- ⚠⚠⚠ **エフェクト条件の行は `MONETARY_EVENT_TYPES` から機械生成される**
  （`effectEventRows.ts` の `EFFECT_EVENT_ROWS`）。**課金でないものは行に出ない。**
  ⚠ 062a のレイドはこの道を通らなかった（レイドはエフェクト条件に出さない決定だった）ので、
  **本タスクが最初にここへ当たる**（下記 穴 B）。
- Twitch の接続は**チャンネル名の手入力**（`live-stream.client.ts` の `resolveUserIdByLogin`）。
  ⚠⚠ **他人のチャンネルにも接続できる**（下記 穴 D）。YouTube は `mine=true` で自分固定。

## ⚠⚠ 段の割り方（CLAUDE.md「1 回の作業で複数機能をまとめて実装しない」）

| 段 | 内容 | レビュー |
|---|---|---|
| **段 1** | **取り込みだけ**（スコープ＋購読＋5 段の語彙＋Rust variant＋コメント一覧に出るまで） | ⚠⚠ **`security-review` 必須** |
| 段 2 | **エフェクト条件の行として使えるようにする**（063b の割り当てから選べる） | 軽レビュー |
| 段 3 | ⚠ **報酬名ごとの出し分け**（穴 G の一次確認が済んでから） | 軽レビュー |

⚠⚠ **段 1 を単独で通す理由**＝ スコープ拡大の判断を、ガチャの設計と切り離して固めるため（066 段 1 と同じ作法）。
⚠ **段 1 の時点ではガチャは回らない**（コメント一覧に「チャンネルポイント」の行が出るだけ）。

## このタスクでやること（段 1）

### (1) スコープを 1 つ足す —— `apps/comment-sidecar/src/twitch-config.ts`

- `TWITCH_SCOPES` に **`channel:read:redemptions`** を追加。
- ⚠ **043a / 066 と同じコメントの作法**で、「既存ユーザーは再ログインするまで届かない」ことを名指しで書く。

### (2) 購読を 1 件足す（**非致命**） —— `eventsub-websocket.client.ts` の `subscribeChatEvents`

- `channel.channel_points_custom_reward_redemption.add`（version `"1"`・condition は `broadcaster_user_id` のみ）。
- ⚠⚠ **`channel.bits.use` と同じ `.catch(() => {})`**。403（旧トークン／他人のチャンネル）でも
  **本線の 2 購読とコメント配信を止めない**。⚠ §9 配慮でエラー内容はログに残さない。
- ⚠ **`reward_id` を condition に入れない**（段 3 まで報酬を絞らない）。

### (3) 語彙を 5 段通す（⚠ **1 段でも落とすと静かに chat になる**）

- `raw.dto.ts` … `TwitchEventSubSubscriptionType` に 1 件、envelope の `event` union に 1 件、
  新 DTO `TwitchChannelPointsRedemptionEventDto`。
  ⚠ **`user_input` は「在るが、本文として使う」**（下記 (4)）。⚠ **`reward` は段 1 では消費しない**（穴 G）。
- `comment.mapper.ts`（twitch）… 引き換え → コメント 1 件。
  ⚠ **`id` は引き換えイベント自身の `id`**（重複排除キー）。⚠ `channel.bits.use` のように
  `metadata.message_id` を補填する必要があるかは**実装時に `eventsub-websocket.client.ts` を読んで確認する**。
- `vendor/shared/src/comment/comment-types.ts` … union に **`"channelpoint"`** を追加。
- `comment-to-view.converter.ts` … 素通しであることを確認（明示列挙層・062a 訂正 1 の教訓）。
- `src/wire.ts` … `CanonicalCommentEventType` ＋ `EVENT_TYPE_MAP` に 1 行。

⚠ **語は `"channelpoint"` に統一する**（`channel_points` / `redemption` と 3 通りに散らさない）。

### (4) 本文（`text`）の扱い

- **`user_input` があればそれを `text` にする**（＝視聴者が報酬に入力したテキスト）。
- ⚠⚠ **`user_input` が無い報酬では `text` が空**になる。⇒ **062a の判断をそのまま踏襲し、
  配信画面（OBS オーバーレイ）には出さない**（空の吹き出しが配信に映るため）。
- ⚠ §9: `user_input` は**第三者が打った文字列**。端末に保存されるのは既存のコメントと同じ経路で、
  **新しい保存先も新しい露出先も作らない**。

### (5) Rust —— `comment_viewer/model.rs`

- `CommentEventType` に **`Channelpoint`** を追加（`#[serde(rename_all = "lowercase")]` で `"channelpoint"`）＋ `as_str` に 1 行。
- ⚠ **062a の `Raid` に付いている JSDoc と同じ趣旨のコメントを付ける**
  （「この variant が無いと wire の値が未知 variant としてデシリアライズ全体を失敗させ、
  `record_comment` は fire-and-forget なので黙って 1 件も保存されない」）。
- **マイグレーションは書かない**（`event_type TEXT NOT NULL`・CHECK 無し）。

### (6) frontend（段 1 は表示だけ）

- `viewerFormat.ts` の `EVENT_LABEL` に **`channelpoint: "チャンネルポイント"`**。
  ⚠⚠ **`MONETARY_EVENT_TYPES` には入れない**（穴 A）。
- `pinnedComments.ts` の `EVENT_TYPES` と `speechText.test.ts` の `SPEECH_KIND` は
  **コンパイルが落ちて判断を強制してくる**ので、そこで決める（穴 H・穴 I）。
- ⚠ **画面に「自分のチャンネルのときだけ届く」と書く**（穴 D・061a Q-1「黙って効かない、を作らない」）。

### (7) dev-mock と静的検査

- `apps/comment-sidecar/src/dev-mock.ts` に合成発行を 1 件足す（`jewels` / `gift` と同じ作法）。
  ⚠ **`user_input` 有りと無しの 2 パターン**を出す（(4) の分岐を目視できるようにする）。
- `scripts/test-twitch-mapper.mjs` に mapper のケースを追加。
  ⚠ `package.json` の `scripts.test` は**既に両スクリプトを繋いでいる**ので差分は出ない。

## このタスクでやらないこと

- **ガチャの抽選・割り当て**（[063b](063b-gacha-draw-and-triggers.md)）。段 1 は**取り込みだけ**。
- ⚠ **報酬名ごとの出し分け**（段 3・穴 G の一次確認が先）。
- ⚠ **`channel.channel_points_automatic_reward_redemption.add`（自動報酬）**。別購読・別タスク。
- **報酬の消化／返却**（`channel:manage:redemptions`）。⚠ **書き込み権限は取らない**——
  066 が Twitch 初の書き込みを 1 本入れたばかりで、**2 本目をガチャのついでに増やさない**。
- **YouTube 側の対応**。⚠⚠ **相当機能が存在しない**（066 と同じ非対称が 1 つ増える）。**画面にそう書く。**
- **チャネポの残高・履歴の取得**。
- たぬえさ3 の**逆解析・設定ファイル形式の再現**（親 063 の線引き・不変）。

## ⚠ 先に潰した穴（A〜L）

- **A. `MONETARY_EVENT_TYPES` に入れてはいけない。** 入れるとティア色カード・投げ銭ティッカー・
  オーバーレイの課金カード・061 のエフェクト条件が**いっせいに発火する**（062a がレイドで書いた警告と同じ）。
  ⚠ **チャネポは「お金ではない」**。
- **B. ⚠⚠⚠ しかし A を守ると、チャネポの条件は 4 つの関門で落ちる**（⚠ **UI だけの問題ではない**）:
  1. `effectEventRows.ts` の `EFFECT_EVENT_ROWS` … **行が生えない**（行は Set から機械生成）
  2. `parseConditions` の `event` 分岐 … `!MONETARY_EVENT_TYPES.has(eventType)` で
     **保存済みの条件を読み込み時に捨てる**
  3. `parseConditions` の並び生成ループ … 条件の配列に**そもそも作られない**
  4. `createConditionMatcher` の**課金ゲート** `if (!monetary) continue;` …
     仮に条件が届いても**発火の直前で落ちる**
  ⇒ ⚠⚠ **原因は 1 つ**——`MONETARY_EVENT_TYPES` が「**お金か**」と「**条件表に出すか**」の
  **2 つの質問に兼用**されている。**チャネポは前者が No で後者が Yes** なので、ここで初めて割れる。
  ⇒ **段 2 の修正は「定数を 2 本に割る」だけ**:
  `MONETARY_EVENT_TYPES`（お金・6 値のまま）と
  **`EFFECT_CONDITION_EVENT_TYPES`（条件表に出す種別＝上記 ∪ `{channelpoint}`）**。
  ⚠ 差し替えは**上の 4 関門＋旧形式の読み込みループ＝ 5 箇所**、
  ＋ `EffectAssignmentCard.test.tsx` の**行数を Set のサイズで固定している 1 行**。
  ⚠ `effectAssignments.ts` の §9 コメント「イベント種別（`MONETARY_EVENT_TYPES` の 6 値）」も更新する。
  ⚠⚠ **コード量は小さいが、設計の線を 1 本引く作業**なので段を分けている。
- **C. 語彙 5 段のどれかを落とすと `?? "chat"` で普通のコメントとして保存される。**
  ⚠ 担保は `EVENT_TYPE_MAP` の `Record` 型強制（3 に足せば 5 が落ちる）＋ `test-comment-relay.mjs`。
- **D. ⚠⚠ 他人のチャンネルに接続すると 403 で黙って届かない。**
  購読はブロードキャスター本人のトークンでしか通らないのに、接続先は**手入力のチャンネル名**である。
  ⇒ **画面に書く**（061a Q-1）。⚠ **接続先が自分かどうかを判定する材料**（ログイン中のユーザー ID と
  `resolveUserIdByLogin` の結果の突き合わせ）が現状 frontend に無いので、**段 1 では固定の説明文**にする。
- **E. `user_input` の無い報酬は `text` が空**＝ 配信画面に空の吹き出しが出る。⇒ オーバーレイに出さない（062a と同じ）。
- **F. ⚠⚠⚠ 再ログインのタイミング。** 066 のリリース前に (1) を入れれば**再ログインは 1 回**、
  後に回すと**2 回**。⚠ **これが段 1 を最優先にする唯一かつ十分な理由である。**
- **G. ⚠⚠ 報酬名がペイロードに載るか未確認。** ⇒ **段 1 は報酬を区別しない**
  （「チャンネルポイント」1 行で全報酬をまとめて受ける）。⚠ **段 3 に着手する前に一次確認すること。**
- **H. `Record<CommentEventType, …>` の 2 箇所がコンパイルを落とす**（`pinnedComments.ts` / `speechText.test.ts`）。
  ⚠ **これは事故ではなく設計された網**（046a / 049 が張ったもの）。落ちたら判断して埋める。
- **I. 読み上げ（TTS）をどうするか。** ⚠⚠ **当初「チャネポ経由で読み上げを乗っ取れる」と書いたが、
  これは過大だった（2026-08-23 訂正）**——`chat` は既に `body-only` で**本文が全文読まれる**ので、
  `user_input` を同じ `body-only` にするだけなら**新しい能力は増えない**。
  ⚠ **優先キューは `isMonetaryEvent` を見ている**ので、**穴 A の決定（課金に入れない）に自動的に従う**
  ＝ここで別途の判断は要らない。⇒ **残る判断は `SPEECH_KIND` を `summary` か `body-only` かの 1 択だけ**
  （**`body-only` 推奨**）。⚠ むしろ**チャネポで読み上げさせる報酬は定番**なので、
  要望は「**読ませたい**」側から来る。
- **J. YouTube に相当機能が無い。** 066 と同じく**画面に書く**（黙って効かない、を作らない）。
- **K. dev-mock に足さないと実機まで確認できない**（自分のチャンネルに報酬を作る必要がある）。
- **L. 自動報酬は別購読。** `channel.channel_points_automatic_reward_redemption.add` を
  今回の購読で受けられると誤解しないこと。

## セキュリティ制約（docs/security.md 準拠）

- ⚠⚠ **`security-review` 必須**（段 1）。理由＝ **OAuth スコープの拡大**であり、
  043a（`bits:read`）・066（`user:write:chat`）と同じ扱いにする。
- **新規 egress 先ゼロ**（§1）。`api.twitch.tv` / `eventsub.wss.twitch.tv` は allow-list 済み・定数ピン留め・
  二層 fail-closed は不変。**増えるのは能力だけ。**
- ⚠ **`docs/security.md` §1 に追補を書く**（043a の `bits:read` 節・066 の例外節と同じ形）。
  書くべきは: ①スコープが 1 つ増えること ②**同意画面が変わる**こと（チャネポを使わない人にも出る）
  ③**非致命化**して本線を止めないこと ④**読み取り専用**であること（`channel:manage:redemptions` は取らない）。
- **§9**: `user_input` は第三者の入力文字列。⚠ **既存のコメントと同じ経路にしか流さない**
  （新しい保存先・新しいログ・新しい外部送信はゼロ）。⚠ **報酬名も段 1 では消費しない。**
- **§10**: **新規依存ゼロ**（npm / crate とも）。
- ⚠ **新規 Tauri command ゼロ・新規 capability ゼロ**（既存のコメント配信経路に相乗りするだけ）。

## 完了条件（段 1）

- `pnpm typecheck` / `pnpm lint` / `cargo check` / sidecar の `pnpm test` が通る。
- 自分のチャンネルでチャネポ報酬を引き換えると、**コメント一覧に「チャンネルポイント」の行が出る**。
- ⚠ **`user_input` の無い報酬でも、配信画面に空の吹き出しが出ない。**
- ⚠ **他人のチャンネル名で接続しても、コメント取得が止まらない**（チャネポだけ届かない）。
- ⚠ **課金の見た目（赤枠・ティッカー・課金カード）が 1 つも発火しない**（穴 A）。
- **新規依存ゼロ**（`package.json` の `dependencies` / `devDependencies` / `pnpm-lock.yaml` / `Cargo.lock` に差分が無い）。
- `docs/security.md` §1 に追補が書かれ、`security-review` が実施済み。
- [`docs/progress.md`](../progress.md) と [`docs/task-board.md`](../task-board.md) に記録。

## 確認コマンド

```bash
pnpm typecheck
pnpm lint
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
pnpm --filter @stream-dock/comment-sidecar test

# 依存が増えていないこと
git diff --stat -- package.json pnpm-lock.yaml apps/comment-sidecar/package.json apps/desktop/src-tauri/Cargo.lock

# 実機
# ① 自分のチャンネルで報酬（テキスト入力あり）を引き換え → 一覧に「チャンネルポイント」行＋本文
# ② テキスト入力なしの報酬を引き換え → 一覧には出る／配信画面には出ない
# ③ 他人のチャンネル名で接続 → コメントは流れ続け、チャネポだけ届かない
# ④ 再ログイン前の旧トークンで接続 → 本線が止まらない（チャネポだけ届かない）
```

## 実装後に必要なレビュー

- ⚠⚠ **段 1 は `security-review` 必須**（スコープ拡大）。
- 段 2・段 3 は**軽レビュー**（`code-review-light`）。
