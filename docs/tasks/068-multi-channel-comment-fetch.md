# 068. 複数チャンネル同時コメント取得（Multi-Channel Comment Fetch）

| | |
|---|---|
| 起票 | 2026-09-10 |
| 依頼者の言葉 | 「複数の YouTube チャンネル同時配信とか、複数のツイッチも同時配信して 3 つ以上の配信になる可能性もあるよね？」「同時配信というか、**同時コメント取得**ね」 |
| 状態 | **未着手**（067 完了後に判断） |
| 前提タスク | [067](067-multistream-output-split.md)（同時配信・規約分離）が完了していること |

---

## ⚠⚠⚠ 結論（先に書く）

**止めているのは API ではない。StreamDock の内部設計である。**

| | 状況 |
|---|---|
| Twitch の API | ✅ **1 ログインで N チャンネルの chat を購読できる**（EventSub の condition が `broadcaster_user_id` ＋ `user_id`）。⚠⚠ **StreamDock は既に他人のチャンネルを読める**（`start-session` が login 名を取る）——できないのは**同時に複数**だけ |
| YouTube の API | ⚠ 現在は `mine=true`（自分の配信）専用。他チャンネルは `videos.list` → `activeLiveChatId` で取れ、**その部品は既にある**（`findLiveDetails`） |
| sidecar のセッション管理 | ❌ **`Map<Provider, AbortController>`＝ provider ごとに 1 本**。2 本目を開始すると 1 本目が `abort()` される |
| コメントのワイヤ形式 | ❌ **`source` が `"twitch" \| "youtube"` だけ**——どのチャンネル宛のコメントか**持っていない** |
| 視聴者の同一性 | ✅ **壊れない**（`viewers(provider, provider_user_id)`＝チャンネル非依存） |
| 067 の成果物（規約の凍結表・出力シーン） | ✅ **そのまま使える**（platform 単位の判断なので、チャンネルが増えても変わらない） |

⇒ **本命の作業は 2 つ**: ①セッションの多重化 ②コメントにチャンネル識別子を通すこと。
⇒ ⚠ **067 は本タスクをブロックしない。** 2 固定のまま完了させてよい。

---

## 1. 背景（Background）

StreamDock は 032c 以来、**「Twitch 1 アカウント ＋ YouTube 1 アカウント」**を前提に作られている。
ログイン・コメント取得・チャット送信・視聴者メモリ・配信サマリー・（067 で足した）配信キーの保管が、
すべて `Provider = "twitch" | "youtube"` を鍵にしている。

一方、実際の配信者は次のような運用をする:

- **同じプラットフォームに複数チャンネルを持つ**（本チャンネルと切り抜き用、個人と法人、日本語と英語）
- **複数チャンネルへ同時に配信し、そのすべてのコメントを 1 か所で読みたい**
- **他人のチャンネルのコメントを併せて読む**（コラボ配信・レイド先の様子見）

⚠ 067（同時配信）は**配信の出口**を 2 つにしたが、**コメントの入口は 1 プラットフォーム 1 本のまま**である。

---

## 2. 問題（Problem）

### 2-1. ⚠⚠⚠ 2 本目のセッションが 1 本目を殺す

[`apps/comment-sidecar/src/index.ts:748`](../../apps/comment-sidecar/src/index.ts#L748):

```ts
const sessionAborts = new Map<Provider, AbortController>();
```

[`apps/comment-sidecar/src/index.ts:793`](../../apps/comment-sidecar/src/index.ts#L793)（Twitch）／
[`:866`](../../apps/comment-sidecar/src/index.ts#L866)（YouTube）:

```ts
// 035a: 自 provider（twitch）の既存セッションのみ差し替える（youtube は温存＝並行取得を維持）。
sessionAborts.get("twitch")?.abort();
```

⚠ **これは 035a の意図どおりの実装である**（「Twitch と YouTube を並行させ、同じ provider は差し替える」）。
⚠⚠ **バグではなく設計**なので、直すのではなく**設計を広げる**話になる。

### 2-2. ⚠⚠ コメントが「どこ宛か」を持っていない

[`apps/comment-sidecar/src/wire.ts:8`](../../apps/comment-sidecar/src/wire.ts#L8):

```ts
export type CanonicalCommentSource = "twitch" | "youtube";
```

[`:40`](../../apps/comment-sidecar/src/wire.ts#L40) の `CanonicalComment.source` がこれを持つ。

⇒ N チャンネルからコメントが来ても、画面では**全部ごちゃ混ぜ**になる。
⚠⚠⚠ **「どのチャンネルに書かれたコメントか」が分からないと返信先も決まらない**——
066 のチャット送信は `start-session` の 1 チャンネルに束ねられている（[2-4](#2-4-チャット送信の宛先が-1-本に束ねられている)）。

### 2-3. 配信サマリー・視聴者メモリのスキーマ

| 表 | 所在 | 状況 |
|---|---|---|
| `stream_sessions` | [`stream_session/repository.rs:44`](../../apps/desktop/src-tauri/src/stream_session/repository.rs#L44) | `platforms TEXT`（`"twitch,youtube"` のカンマ連結）。⚠ **チャンネルの概念が無い** |
| `viewers` | [`viewer_memory/repository.rs:143`](../../apps/desktop/src-tauri/src/viewer_memory/repository.rs#L143) | `provider` ＋ `provider_user_id`。✅ **チャンネル非依存なので壊れない** |
| `viewer_comments` | [`viewer_memory/repository.rs:167`](../../apps/desktop/src-tauri/src/viewer_memory/repository.rs#L167) | `source TEXT` ＋ `session_id`。⚠ **どのチャンネルに書かれたかは無い** |

⚠ `viewers` に UNIQUE 制約は無く、同一性の判定はコード側の upsert が持っている。

### 2-4. チャット送信の宛先が 1 本に束ねられている

066 の `chatSender.setChannel(channel)` は `start-session` でしか変わらない
（[`index.ts:805`](../../apps/comment-sidecar/src/index.ts#L805) 付近）。
送信フレームは宛先を運ばず、`expectedChannel`（[`chat-send-frame.ts:80`](../../apps/comment-sidecar/src/chat-send/chat-send-frame.ts#L80)）で
「画面の宛先と実際の宛先が一致していること」だけを突き合わせている。

⚠⚠ **N チャンネルになると「どこへ送るか」が初めて曖昧になる。** これは security-review 066 S-2 が
塞いだ「宛先の差し替え」の議論に直接触れるので、**設計を変えるなら再レビューが要る**。

### 2-5. 影響範囲の規模（実測）

| | 数 |
|---|---|
| `"twitch"` / `"youtube"` を直接持つ Rust モジュール | **13**（`comment_viewer` / `stream_summary` / `stream_session` / `viewer_memory` / `comment_sidecar` / `overlay_theme` ほか） |
| `source` を参照する frontend ファイル | **49**（`features/comment-viewer` ＋ `screens/comment-viewer`） |
| SQLite の表 | **3**（`stream_sessions` / `viewers` / `viewer_comments`） |

---

## 3. 目的（Goal）

1. **同一プラットフォームの複数チャンネルから、同時にコメントを取得できる。**
2. **コメントが「どのチャンネル宛か」を持ち、画面で区別できる。**
3. ⚠⚠ **067 の規約分離を壊さない**——Twitch へ出す映像に他プラットフォームのコメントを載せない。
4. ⚠ **既存ユーザーのデータと挙動を壊さない**（1 チャンネル運用の人には何も変わらない）。

---

## 4. やらないこと（Non-Goals）

- ❌ **配信先を 3 つ以上にすること**（＝ 067 の出口側の拡張）。⚠ **別タスク**である。
  本タスクは**入口（コメント取得）だけ**を扱う。
- ❌ 他人のチャンネルへのチャット送信の拡大。⚠ 066 の宛先制約は**据え置く**（[2-4](#2-4-チャット送信の宛先が-1-本に束ねられている)）。
- ❌ 複数の Google / Twitch アカウントの同時ログイン。
  ⚠⚠ **本タスクは「1 ログインで N チャンネルを読む」だけを目指す**（[7](#7-プラットフォーム-api-の調査実コードと一次ソース)）。
  複数アカウントは token_vault の account 設計を変える話なので、必要になったら別タスクで起票する。
- ❌ チャンネルごとの読み上げ音声・テーマの出し分け。

---

## 5. 現在の StreamDock 実装の調査結果（実コード・2026-09-10）

### 5-1. セッションの流れ

```
viewer ──ws(start-session: {service, channel, ticket})──▶ sidecar
                                                            │
                                          sessionAborts.get(service)?.abort()   ← ⚠ ここで 1 本目が死ぬ
                                          sessionAborts.set(service, abort)
                                                            │
                            ┌───────────────────────────────┴────────────────────┐
                    runTwitchPipeline(…, channel)                    runYouTubePipeline(…)
                            │                                                    │
                  Helix: resolveUserIdByLogin(channel)              gRPC streamList(www.googleapis.com)
                  EventSub WS: channel.chat.message                  ← liveChatId は mine=true で解決
                            └──────────────── outputPort ────────────┘
                                                │
                                     CanonicalComment{ source: "twitch" | "youtube" }
                                                │
                                          broadcastMessage → viewer / overlay 窓
```

### 5-2. ⚠ 既に「他人のチャンネル」は読める

`start-session` は **login 名を受け取る**（[`index.ts:791`](../../apps/comment-sidecar/src/index.ts#L791) の `startSession(channel)`）。
コード中のコメントも「自分のチャンネル → **他人のチャンネル**へ繋ぎ直したとき」という状況を前提に書かれている。

⇒ **任意チャンネルを読む能力は既にある。** 足りないのは**同時に複数**だけ。

### 5-3. YouTube 側は自分の配信専用

[`youtube/client/live-stream.client.ts:80`](../../apps/comment-sidecar/vendor/comment-fetcher/src/adapters/youtube/client/live-stream.client.ts#L80)
の `findActiveOwnBroadcast()` が `liveBroadcasts.list(broadcastStatus=active, mine=true)` を使う（**1 unit 固定**）。

⚠ 他チャンネル用の部品は**同じファイルに既にある**——
[`:108`](../../apps/comment-sidecar/vendor/comment-fetcher/src/adapters/youtube/client/live-stream.client.ts#L108)
の `findLiveDetails()` が `videos.list`（by-id・1 unit）で `activeLiveChatId` を引く。

### 5-4. 067 が作ったものとの関係

| 067 の成果物 | 本タスクでの扱い |
|---|---|
| `obs/stream-policy.ts`（凍結表） | ✅ **無改変**。判断は platform 単位で、チャンネル数に依存しない |
| `obs/stream-output.ts`（出力シーン） | ✅ **無改変**。同じ platform の複数チャンネルは同じ出力シーンでよい |
| `features/comment-viewer/overlayCommentFilter.ts` | ⚠ **要検討**。いまは `source`（platform）で濾すが、「チャンネル A の窓」を作るなら濾す軸が増える |
| 配信キーの keychain account | ✅ 本タスクの対象外（出口側） |

---

## 6. ⚠⚠⚠ 設計の中心的な問い

### 6-1. 「チャンネル」を何で識別するか

| 案 | 中身 | 評価 |
|---|---|---|
| **A. platform ＋ チャンネル ID** | `{ platform: "twitch", channelId: "123456" }` | ⚠ 表示名の変更に強い。⚠⚠ **画面に出すには名前の解決が別途要る** |
| **B. StreamDock 内部の接続 ID** | `conn-1` / `conn-2`（UUID） | ⚠ プラットフォームに依存しない。⚠⚠ **再起動をまたぐと同じチャンネルが別 ID になる**——保存データと繋がらない |
| **C. A ＋ B の併用** | 保存は A、実行時の束ね方は B | ⚠ 2 つあると片方だけ更新される |

⇒ **推奨は A**。理由＝ `viewers` が既に `(provider, provider_user_id)` という「platform ＋ ID」の形を採っており、
**同じ流儀を 2 つ持たない**ため。⚠ 着手時に再検討すること。

### 6-2. `CanonicalComment` をどう広げるか

| 案 | 中身 | 評価 |
|---|---|---|
| **A. `source` を構造体にする** | `source: { platform, channelId }` | ❌ **49 ファイル ＋ Rust の ts-rs 契約が一斉に壊れる** |
| **B. `channel` を任意フィールドで足す** | `source` は据え置き、`channel?: {id, name}` を追加 | ✅ **既存の比較（`source === "twitch"`）が全部生きる**。未設定＝現行挙動 |

⇒ **推奨は B**。⚠⚠ 036b／062a の事故（wire 型に無いフィールドを黙って落とす）と同型の risk があるので、
**`toCanonicalComment` の詰め替えを契約テストで固定すること**（`scripts/test-comment-relay.mjs` の
`RELAYED_NUMERIC_FIELDS` と同じ作法）。

### 6-3. セッションの鍵をどうするか

```ts
// 現在
const sessionAborts = new Map<Provider, AbortController>();

// 案
const sessionAborts = new Map<string /* `${platform}:${channelId}` */, AbortController>();
```

⚠⚠ **`stop-session` のフレームも鍵を運ぶ必要がある。** いまは `service` しか運んでいないので、
**チケット必須のフレーム（066 段 2）の形が変わる**＝ `session-control-frame.ts` の形式検査も変わる。
⚠⚠⚠ **`isAllowedSessionChannel` の上限・文字種の検査を弱めないこと**（security-review 066 S-5 が固定した層）。

### 6-4. 上限をどこに置くか

⚠ **無制限にしない。** 理由:

| 資源 | 制約 |
|---|---|
| Twitch EventSub | 1 WS 接続あたりの購読数に上限がある。⚠ **段 0 で実測すること** |
| YouTube Data API | 既定 10,000 units/日。⚠⚠ **067c の生存確認（60 秒間隔・1 unit）も同じ枠を食う**——N チャンネルなら N 倍 |
| 端末 | コメント表示・読み上げ・視聴者メモリの書き込みが N 倍 |

⇒ **MVP は 4 チャンネル程度を上限に固定し、定数に名前を付けて置く**（マジックナンバーにしない）。

---

## 7. プラットフォーム API の調査（実コードと一次ソース）

### 7-1. Twitch — ✅ 1 ログインで N チャンネル読める

[`twitch/client/helix.client.ts:149`](../../apps/comment-sidecar/vendor/comment-fetcher/src/adapters/twitch/client/helix.client.ts#L149):

```ts
condition: {
  broadcaster_user_id: string;   // ← 誰のチャットか
  user_id?: string;              // ← 誰として読むか（＝ログイン中のユーザー）
};
```

⇒ **`broadcaster_user_id` を変えれば別チャンネルの chat を購読できる**。`user_id` は自分のまま。
⚠ 必要なスコープは既存の `user:read:chat` のみ＝**新規スコープゼロ・新規 egress ゼロ**。

⚠⚠ **ただし `channel:read:redemptions`（チャンネルポイント）は別**——あれは**放送者本人の認可**が要るので、
**他人のチャンネルでは引き換えが届かない**（063e が既に「他人のチャンネルでは `unavailable` が正常」と書いている）。

### 7-2. YouTube — ⚠ 他チャンネルは経路が変わる

| | 自分のチャンネル（現行） | 他チャンネル |
|---|---|---|
| 配信の検出 | `liveBroadcasts.list(mine=true)`・**1 unit** | `videos.list(id=…)`・**1 unit**（`liveStreamingDetails.activeLiveChatId`） |
| ⚠ そもそも videoId をどう知るか | 不要（mine で引ける） | ⚠⚠ **ユーザーに URL / videoId を入力させるか、`search.list`（100 unit）が要る** |

⚠⚠⚠ **`search.list` は 100 unit** で、032c-d″ が**わざわざ捨てた経路**である（インデックス反映が遅く不正確）。
⇒ **他チャンネルは「配信 URL を貼ってもらう」形が現実的**。⚠ 着手時に UX を決めること。

### 7-3. ⚠ 段 0 で実測すべきこと

一次ソースの読みだけで決めない。**067 が S-1〜S-8 でやったのと同じ形でスパイクを打つ。**

---

## 8. 規約（Policy）

### 8-1. Twitch ToS §11 との関係

§11 Simulcasting が禁じているのは **「他プラットフォームの活動を Twitch 配信上で統合すること」**である。

| 構成 | 判断 |
|---|---|
| Twitch A の配信画面に **Twitch B** のコメントを出す | ⚠ **同一プラットフォーム内なので §11 の文言には該当しないはず**。⚠⚠ **着手時に本文を引き直して確認すること** |
| Twitch A の配信画面に **YouTube** のコメントを出す | ❌ **禁止**（067 が凍結表で塞いでいる。⚠ 本タスクでこれを緩めない） |

### 8-2. ⚠⚠⚠ 067 の凍結表を「チャンネル単位」に降ろさないこと

`STREAM_POLICY` は **platform → 方針** の表である。チャンネルが増えても
「Twitch へ出す映像には Twitch のコメントだけ」は変わらない。

⚠ **表をチャンネル単位に細かくすると、「チャンネルごとに設定で変えられる」形へ滑る**——
それは 067 が「設定ファイルに出すと fail-open になる」として明確に避けた形である。
⇒ **表は platform 単位のまま据え置く。**

---

## 9. UI / UX

### 9-1. 現在

コメビュ窓のヘッダー左に **接続ピルが 2 つ固定**（Twitch / YouTube）。
それぞれクリックで「連携 / コメント取得開始 / 停止」のポップオーバーが開く。

### 9-2. ⚠ N チャンネルにすると壊れるところ

- **ピルが固定 2 個**（[`CommentViewerApp.tsx:3229`](../../apps/desktop/src/screens/comment-viewer/CommentViewerApp.tsx#L3229) 付近）
- **チャンネル名の入力欄が 1 つ**（Twitch 用の `channel` state が 1 本）
- **コメント行に配信元アイコンは出るが、チャンネル名が出ない**

### 9-3. 案（着手時に決める）

| 案 | 中身 | 評価 |
|---|---|---|
| **A. ピルを可変リストにする** | 接続ごとに 1 ピル ＋「＋ 追加」 | ⚠ ヘッダーが横に伸びる。4 つが限界 |
| **B. 「接続」画面を作る** | 一覧＋追加/削除。ヘッダーには**まとめて 1 つ**のピル | ⚠⚠ 067 で画面が 1 つ増えたばかりなので、**さらに増やす前に置き場所を考えること** |
| **C. 設定画面のカードにする** | 042b で本体へ移設した経緯の**逆戻り**になる | ❌ 過去の判断を理由なく反転させない |

⚠⚠⚠ **コメント行にチャンネルを出すかは慎重に決めること。**
061d 以来の方針は「**情報を増やさない**」であり、1 チャンネル運用の人にとってチャンネル名は**ノイズでしかない**。
⇒ **2 つ以上つないでいるときだけ出す**、が既定の落とし所。

---

## 10. セキュリティ（`docs/security.md` 準拠）

| 論点 | 扱い |
|---|---|
| **新規 egress** | ✅ **ゼロ**（`api.twitch.tv` / `eventsub.wss.twitch.tv` / `www.googleapis.com` はすべて allow-list 済み） |
| **新規スコープ** | ✅ **ゼロ**（`user:read:chat` のまま。⚠ `channel:read:redemptions` は他人のチャンネルでは効かないだけ） |
| **`start-session` のチケット** | ⚠⚠ **形が変わる**（鍵が `service` から `service ＋ channel` へ）。⚠⚠⚠ **チケット必須を外さないこと**（066 段 2） |
| **`isAllowedSessionChannel`** | ⚠ 上限・文字種の検査は**そのまま残す**（security-review 066 S-5） |
| **チャット送信の宛先** | ⚠⚠⚠ **本タスクでは広げない**（[4](#4-やらないことnon-goals)）。広げるなら **`security-review` 必須** |
| **第三者データの増加** | ⚠ 読み込むチャンネルが増える＝**保存される他人のコメントが増える**。⚠⚠ `viewer_comments` の増え方を [16](#16-リスクrisks) で見積もること |
| **`security-review`** | ⚠⚠ **段 2（セッション多重化）と段 4（保存）で必須** |

---

## 11. 実装ステップ（Implementation Steps）

### 段 0（068s）: スパイク ⚠ **必須**

[7-3](#7-段-0-で実測すべきこと)。**コードを書く前に実測する**（067s と同じ形）。

| # | 実測すること |
|---|---|
| S-1 | Twitch EventSub の **1 WS 接続あたりの購読上限**（何チャンネルまで載るか） |
| S-2 | 1 ログインで **他人のチャンネル 2 本 ＋ 自分 1 本**を同時購読できるか |
| S-3 | YouTube の他チャンネル `activeLiveChatId` を `videos.list` で引けるか（＋ gRPC streamList がそれで回るか） |
| S-4 | **YouTube の unit 消費**を N チャンネルで実測（⚠ 067c の生存確認と同じ枠） |
| S-5 | 4 チャンネル同時取得時の **CPU / メモリ / コメント落ち** |

### 段 1（068a）: コメントにチャンネルを通す（⚠ 表示は変えない）

- `CanonicalComment` に **任意フィールド**として `channel?: { id, name }` を足す（[6-2](#6-2-canonicalcomment-をどう広げるか) 案 B）
- Rust の `CommentViewDto`（ts-rs）にも同形で足す
- ⚠⚠ **詰め替えを契約テストで固定する**（落としても型検査が通る形なので）
- ⚠ **この段では画面が 1 ミリも変わらない**（1 チャンネルなので値は常に同じ）

### 段 2（068b）: セッションの多重化 ⚠ **`security-review` 必須**

- `sessionAborts` の鍵を `${platform}:${channelId}` へ
- `start-session` / `stop-session` フレームに識別子を追加（⚠ チケットの形式検査も更新）
- 上限の定数化（[6-4](#6-4-上限をどこに置くか)）
- ⚠⚠ **チャット送信の宛先は据え置く**（1 本目のチャンネルに束ねたまま・[4](#4-やらないことnon-goals)）

### 段 3（068c）: UI

- 接続の一覧化（[9-3](#9-3-案着手時に決める)）
- ⚠ コメント行のチャンネル表示は **2 つ以上つないでいるときだけ**
- ⚠⚠ オーバーレイ窓の濾し方をどうするか決める（`overlayCommentFilter.ts`）

### 段 4（068d）: 保存と集計 ⚠ **`security-review` 必須**

- `viewer_comments` に channel 列を足す（⚠ 既存行は NULL＝「不明」）
- `stream_sessions.platforms` の扱いを決める（⚠ カンマ連結の TEXT にチャンネルを混ぜない）
- 配信サマリーをチャンネル別に出すか、合算のままにするか

---

## 12. 変更対象になりそうなファイル

| 層 | ファイル | 段 |
|---|---|---|
| sidecar | `src/wire.ts`（`CanonicalComment`） | 1 |
| sidecar | `src/index.ts`（`sessionAborts` / `startSession` / `startYouTubeSession`） | 2 |
| sidecar | `src/session-control/session-control-frame.ts`（形式検査） | 2 |
| sidecar | `src/comment-fetcher/register-youtube-deps.ts`（他チャンネル経路） | 2 |
| sidecar | `scripts/test-comment-relay.mjs`（詰め替えの契約） | 1 |
| Rust | `src/comment_viewer/model.rs`（`CommentViewDto`） | 1 |
| Rust | `src/viewer_memory/repository.rs`（`viewer_comments`） | 4 |
| Rust | `src/stream_session/repository.rs`（`platforms`） | 4 |
| Rust | `src/stream_summary/service.rs` | 4 |
| frontend | `features/comment-viewer/commentStream.ts` | 1 |
| frontend | `features/comment-viewer/overlayCommentFilter.ts` | 3 |
| frontend | `screens/comment-viewer/CommentViewerApp.tsx`（接続ピル） | 3 |

⚠ `source` を参照する frontend ファイルは **49** ある。案 B（任意フィールド追加）を採れば
**そのほとんどは無改変で済む**——採らない場合は一斉に壊れる。

---

## 13. 完了条件（Acceptance Criteria）

- [ ] **同じプラットフォームの 2 チャンネルから同時にコメントが届く**（実機・両方の実配信で確認）
- [ ] **2 本目を開始しても 1 本目が止まらない**（[2-1](#2-1-2-本目のセッションが-1-本目を殺す) の反転）
- [ ] コメントが **どのチャンネル宛か** 画面で分かる（⚠ 2 つ以上つないでいるときだけ）
- [ ] ⚠⚠⚠ **067 の規約分離が壊れていない**（Twitch の配信映像に YouTube のコメントが 1 件も出ない）
- [ ] **1 チャンネル運用のユーザーの画面が 1 ミリも変わらない**
- [ ] 既存の SQLite を**移行なしで開ける**（channel 列は NULL 許容）
- [ ] YouTube の unit 消費が **1 日の枠に収まる**（⚠ 067c の生存確認と合算で見積もる）
- [ ] `security-review` 実施済み（段 2・段 4）
- [ ] `pnpm typecheck` / `pnpm lint` / `cargo check` / `cargo test` / 各テストが green

---

## 14. テスト（Test Cases）

| # | 対象 | 内容 |
|---|---|---|
| 1 | `session-control-frame` | ⚠⚠ **チケット無し／識別子だけ差し替えたフレームを通さない**（fail-closed） |
| 2 | `wire` の詰め替え | ⚠⚠⚠ **`channel` を落としても型検査が通る**ので、契約テストで固定する（036b／062a と同型の事故） |
| 3 | セッションの鍵 | 同じ platform の別チャンネルを開始しても、**既存が abort されない** |
| 4 | 上限 | 上限を超える開始要求を**理由付きで拒否**する（黙って無視しない） |
| 5 | ⚠⚠⚠ `stream_policy` の凍結 | **067 のテストがそのまま green であること**（本タスクで規約が緩んでいない証明） |
| 6 | 既存 DB | channel 列が無い DB を開いて**落ちない**・NULL が「不明」として読める |
| 7 | 1 チャンネル運用 | 接続 1 本のときの画面が**変更前と同一**（スナップショット） |

---

## 15. 未解決（Open Questions）

| # | 問い | 決める人 |
|---|---|---|
| Q-1 | **他人のチャンネルを読む**のは目的に入るか（コラボ配信）、それとも**自分の複数チャンネル**だけか | 依頼者 |
| Q-2 | YouTube の他チャンネルをどう指定するか（**配信 URL を貼ってもらう** vs `search.list` の 100 unit を払う） | 依頼者 ＋ 段 0 の実測 |
| Q-3 | 上限を何本にするか（⚠ 段 0 の S-1 / S-4 / S-5 の実測が根拠） | 段 0 のあと |
| Q-4 | チャット送信の宛先を広げるか（⚠ 広げるなら 066 の security-review を引き直す） | 依頼者 |
| Q-5 | 配信サマリーをチャンネル別に割るか、合算のままか | 依頼者 |
| Q-6 | コメント行のチャンネル表示をどう出すか（⚠ 061d「情報を増やさない」との折り合い） | 依頼者 |

---

## 16. リスク（Risks）

| # | リスク | 影響 | 緩和 |
|---|---|---|---|
| R-1 | ⚠⚠⚠ **067 の規約分離が緩む** | **大**（規約違反） | 凍結表を platform 単位のまま据え置く（[8-2](#8-2-067-の凍結表をチャンネル単位に降ろさないこと)）。067 のテストを green のまま維持する |
| R-2 | **YouTube の unit 枯渇** | 大（コメントが止まる） | 段 0 で実測。⚠ 067c の生存確認と**同じ枠**であることを忘れない |
| R-3 | ⚠⚠ **`channel` の詰め替え漏れ** | 中（型検査もテストも通るのに値だけ消える） | 契約テストで固定（036b／062a の前例） |
| R-4 | **チャット送信の誤爆**（別チャンネルへ送る） | **大** | 本タスクでは宛先を広げない。広げるなら `security-review` |
| R-5 | 既存 DB との非互換 | 中 | channel 列は NULL 許容・移行なしで開ける |
| R-6 | ⚠ 画面が複雑になり 061d の方針に反する | 中 | **2 つ以上つないでいるときだけ**情報を出す |

---

## 17. 一次ソース（調査日 2026-09-10・⚠ 着手時に引き直すこと）

| 種別 | 出所 | 何を確かめたか |
|---|---|---|
| 実コード | [`index.ts:748`](../../apps/comment-sidecar/src/index.ts#L748) / [`:793`](../../apps/comment-sidecar/src/index.ts#L793) / [`:866`](../../apps/comment-sidecar/src/index.ts#L866) | セッションが provider ごとに 1 本であること |
| 実コード | [`wire.ts:8`](../../apps/comment-sidecar/src/wire.ts#L8) / [`:40`](../../apps/comment-sidecar/src/wire.ts#L40) | コメントがチャンネルを持たないこと |
| 実コード | [`helix.client.ts:149`](../../apps/comment-sidecar/vendor/comment-fetcher/src/adapters/twitch/client/helix.client.ts#L149) | EventSub の condition が `broadcaster_user_id` ＋ `user_id` であること |
| 実コード | [`youtube/live-stream.client.ts:80`](../../apps/comment-sidecar/vendor/comment-fetcher/src/adapters/youtube/client/live-stream.client.ts#L80) / [`:108`](../../apps/comment-sidecar/vendor/comment-fetcher/src/adapters/youtube/client/live-stream.client.ts#L108) | `mine=true` 専用であること／by-id の部品が既にあること |
| 実コード | [`viewer_memory/repository.rs:143`](../../apps/desktop/src-tauri/src/viewer_memory/repository.rs#L143) / [`:167`](../../apps/desktop/src-tauri/src/viewer_memory/repository.rs#L167) | 視聴者の同一性がチャンネル非依存であること |
| 実コード | [`stream_session/repository.rs:44`](../../apps/desktop/src-tauri/src/stream_session/repository.rs#L44) | `platforms` がカンマ連結の TEXT であること |
| 規約 | Twitch ToS §11 Simulcasting | ⚠ **未確認**。[8-1](#8-1-twitch-tos-11-との関係) の「同一プラットフォーム内は該当しない」は**推定**である。⚠⚠ 着手時に本文を引くこと |
| API | Twitch EventSub の購読上限 | ⚠ **未確認**（段 0 S-1） |
| API | YouTube Data API のコスト表 | ⚠ **未確認**（段 0 S-4） |

---

## 18. このタスクでやらないこと（再掲・線引き）

- ❌ **配信先を 3 つ以上にする**（出口側）⇒ 067 の続きとして別途起票する
- ❌ 複数アカウントの同時ログイン ⇒ token_vault の設計変更なので別タスク
- ❌ チャット送信の宛先の拡大 ⇒ 066 の security-review を引き直す話
