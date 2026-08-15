# 062a Twitch レイドの取り込み（受信面拡張）

> 状態: ✅ **実装完了（2026-08-16・security-review 済）／⏳ 実機確認のみ未実施**。
> **判断と実測の全文は [`docs/progress.md`](../progress.md) の 062a 節が正**（本ファイルは着手前の計画で、
> 下記の「⚠ 実装で判明した前提の訂正」だけを後から反映してある）。分割・線引きは親 [062](062-stream-summary.md) を正とする。

## ⚠⚠ 実装で判明した前提の訂正（着手前の記述と食い違う点）

着手前に公式ドキュメント（`https://dev.twitch.tv/docs/eventsub/eventsub-reference/` の
Channel Chat Notification Event）と実コードを当たった結果、本ファイルの記述に**誤りと欠落**があった。
以下は訂正で、**本文より優先する**。

### 1. ⚠⚠⚠ 対象ファイルに `wire.ts` と converter が抜けていた（最大の穴）

**Rust が受け取るのは vendor の `CommentViewDto` ではなく
[`apps/comment-sidecar/src/wire.ts`](../../apps/comment-sidecar/src/wire.ts) の `CanonicalComment`。**
本ファイルが「語彙が sidecar と Rust でずれている」と書いたそのズレを吸収しているのがこのファイルである。
さらに手前に
[`comment-to-view.converter.ts`](../../apps/comment-sidecar/vendor/comment-delivery/src/adapters/presenters/converters/comment-to-view.converter.ts)
という**同じ性質の明示列挙層がもう 1 枚**ある。
⇒ 任意フィールド（`raidViewerCount`）は**この 2 か所で型に守られずに静かに消えうる**（036b の `avatar` 事故と同型）。
担保は `scripts/test-comment-relay.mjs` の `RELAYED_NUMERIC_FIELDS`。

### 2. ⚠ (1) は公式ドキュメントで決着した（実測不要だった）

`notice_type = "raid"` のとき `raid` オブジェクトが載り、フィールドは **5 つ**（`user_id` / `user_name` /
`user_login` / `viewer_count` / `profile_image_url`）。⇒ **既存購読だけで足り、新規購読・新規スコープ・
既存ユーザーの再ログインはいずれも不要。** `channel.raid` は要らない。

### 3. ⚠⚠ (3) の `author` は誤り

本文は `author` = `chatter_user_id` / `chatter_user_name` と書いているが、公式は
**`raid.user_*` を「the broadcaster raiding this channel」と明記**する一方、`chatter_user_*` は
"the user that sent the message" としか書いておらず **raid notice で誰を指すかは確定できない**。
⇒ **`author` は `raid.user_*`** を採る。
⚠ `shared_chat_raid` では公式定義どおり **`raid` が null** になり同形の `shared_chat_raid` に載るため
**両方を見る**（043a の「shared 版は未モデル化＝数値だけ劣化」の規律は、レイドでは付随オブジェクトが
`author` 本体を持つため踏襲できない）。**どちらも取れなければ行を作らない**（fail-closed）。

### 4. ⚠ (2) の「アバター URL は持たない」は「**在るが取らない**」

`profile_image_url` は**ペイロードに実在する**。⇒ `raw.dto.ts` に**名指しで「宣言せず消費もしない」**と
書いた（043a が受贈者・贈与者について書いた形と同型）。`resolveAvatar` も呼ばない（Helix で引き直す抜け道も塞ぐ）。

### 5. ⚠ (7) の「拾いすぎない担保」に `unraid` が抜けていた

`notice_type` には **`unraid` が独立した値として存在する**（`raid` と字面が似ているだけの別イベント）。
判定は**完全一致の `Set(["raid"])`**（`endsWith` / `includes` にすると `unraid` が黙って当たる）。
⚠ なお **`shared_chat_unraid` は公式の値としては存在しない**。

### 6. ⚠⚠ (4) の `total_comments` の推奨 (b) は採れない

`viewers` の `first_seen_at` / `last_comment_at` は **`TEXT NOT NULL`**。これらも raid 除外に揃えると
`MIN/MAX` が NULL を返して**制約違反 → トランザクション全体がロールバック → レイドが 1 件も保存されない**。
(b) 単独でも「総コメント数 0 なのに最終コメント日時がある」視聴者が生まれ 038 の一覧が読めなくなる。
⇒ **決定は (a)「何も変えない」**（依頼者決定）。062c のレイド一覧は `event_type='raid'` で直接引くので非依存。

### 7. ⚠ (5) は `viewerFormat.ts` だけでは画面に何も出ない

`CommentList.tsx` の chat 分岐は**設計上 `typeLabel` を描かない**（047b の意図的な判断）。
レイドを `MONETARY_EVENT_TYPES` に入れない以上、`EVENT_LABEL` に足すだけでは
**「配信元バッジ＋名前だけの空行」**になる。⇒ `CommentList.tsx` にレイド専用のバッジを名指しで足した。
⚠ **さらに、配信画面（OBS オーバーレイ）にはレイドを出さない**（`text` が空なので
**空の吹き出しが配信に映る**ため。043e が `comboCount` について決めたのと同じ規律）。

### 8. ⚠ (7) のテスト追加は `package.json` に差分を生む

`scripts/test-twitch-mapper.mjs` を `scripts.test` へ繋がないと `pnpm test` で 1 度も実行されない。
⇒ **`dependencies` / `devDependencies` / `pnpm-lock.yaml` は差分ゼロ**のまま、`scripts.test` の 1 行だけ変わる。

### 9. ⚠ 型で強制された箇所が 2 つあった（安全側）

`speechText.test.ts` の `SPEECH_KIND` と `pinnedComments.ts` の `EVENT_TYPES` はどちらも
`Record<CommentEventType, …>` なので、binding 再生成で**キー不足でコンパイルが落ち**、
「読み上げをどうするか」「固定コメントで許すか」の判断を強制される（049 / 046a が張った網）。

---
>
> **必読前提**: 親 [062](062-stream-summary.md)、
> **mapper [`comment.mapper.ts`](../../apps/comment-sidecar/vendor/comment-fetcher/src/adapters/twitch/mapper/comment.mapper.ts)（raid を明示的に捨てている箇所）**、
> DTO [`raw.dto.ts`](../../apps/comment-sidecar/vendor/comment-fetcher/src/adapters/twitch/dto/raw.dto.ts)（`TwitchChatNoticeType`）、
> 購読 [`eventsub-websocket.client.ts`](../../apps/comment-sidecar/vendor/comment-fetcher/src/adapters/twitch/client/eventsub-websocket.client.ts)（`subscribeChatEvents`）、
> ワイヤ契約 [`comment-types.ts`](../../apps/comment-sidecar/vendor/shared/src/comment/comment-types.ts) / [`comment-view.dto.ts`](../../apps/comment-sidecar/vendor/shared/src/comment/comment-view.dto.ts)、
> Rust 側の語彙 [`comment_viewer/model.rs`](../../apps/desktop/src-tauri/src/comment_viewer/model.rs)、
> 集計 SQL [`viewer_memory/repository.rs`](../../apps/desktop/src-tauri/src/viewer_memory/repository.rs)（`RECOMPUTE_VIEWER_AGGREGATES_SQL`）、
> 表示側 [`viewerFormat.ts`](../../apps/desktop/src/screens/comment-viewer/viewerFormat.ts)（`MONETARY_EVENT_TYPES` / `EVENT_LABEL` / `displayEventType`）、
> **同型の先行実装 [043a](043a-monetary-ingestion-fidelity.md)（受信面の拡張・§9 の線引き）**、
> [`docs/security.md`](../security.md)（**§1／§9／§8／コメントビューア（配信サービス連携）方針／レビュー必須条件**）。
> CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。
> **security-review 必須**（受信面の拡張・§9 保存データ種別の変更）。
>
> ⚠ **行番号は書かない**（特定はシンボル名で行うこと）。
> ⚠ **記録は遡れない。** レイドを取り込み始めるのが遅れるほど、その間の配信のレイド記録は永久に失われる。
> 062 系の中で**最優先**。

## 目的

依頼者の要望⑥「**ツイッチのみ、配信終わりに誰がレイドしてくれたかが分かる**」の**取得層**を実装する。
サマリー画面での表示は [062c](062c-stream-summary-view.md)。

## 現在の前提（調査結果・実コード）

### レイドは受信経路に載っているが、mapper が捨てている

- `channel.chat.notification` は **`subscribeChatEvents` の必須 2 種のひとつ**として既に購読済み
  （`channel.chat.message` / `channel.chat.notification` が必須、`channel.bits.use` が任意・非致命）。
  → **raid の notice はもう届いている。**
- [`comment.mapper.ts`](../../apps/comment-sidecar/vendor/comment-fetcher/src/adapters/twitch/mapper/comment.mapper.ts) の
  `mapTwitchChatEventToComment` が、収益 3 分類（donation / gift / subscription）に当たらないものを
  `return null` で落としている。コメントも
  「収益に関係しない notice（raid / announcement / bits_badge_tier 等）は取り込まない」と明記。
- ⚠ **`TwitchChatNoticeType` は `(string & {})` のフォールバックを持つ**ので `"raid"` は型としては通るが、
  **付随オブジェクト（`raid` の `viewer_count` 等）は未モデル化**。DTO を足す必要がある。

### 語彙が sidecar と Rust でずれている

| 層 | 定義場所 | 表記 |
|---|---|---|
| sidecar / wire | `comment-types.ts` の `CommentEventType` | `normal` / `super_chat` / `subscription` / `membership` / `gift` / `donation` / `jewels` |
| Rust | `comment_viewer/model.rs` の `CommentEventType` | `Chat` / `Superchat` / `Membership` / `Subscription` / `Gift` / `Donation` / `Jewels` |

⚠ **`normal` ↔ `Chat`、`super_chat` ↔ `Superchat` と綴りが違う**。`raid` を足すときは**両方に足し、
serde の rename 指定と wire 上の実値が一致することを必ず確認する**（043a/043d が同じ場所を通っている）。

### 集計の意味論を壊さないこと

- `RECOMPUTE_VIEWER_AGGREGATES_SQL` は `subscription_count` / `is_member` / `last_subscription_at` を
  `event_type IN ('subscription', 'membership', 'gift')` で数えている。
  ⚠ **ここに `raid` を足してはいけない**（レイドはサブスクではない）。
- `total_comments` は `COUNT(*)` なので、**レイド行を入れると総コメント数が増える**。
  ⚠ **これをどう扱うかを決める**（下記 (4)）。

### 表示側の分岐

- `MONETARY_EVENT_TYPES`（`viewerFormat.ts`）に入れると、コメビュ本体のティア色カード・
  オーバーレイの投げ銭カード・ティッカー・読み上げ・[061b](061b-monetary-effect-builtin.md) のエフェクトが
  **全部発火する**。⚠ **レイドは課金ではないので入れない。**

## このタスクでやること

### (1) 既存購読で足りるかを最初に確認する ← ⚠ 最重要の分岐

- `channel.chat.notification` の raid notice に **レイド元チャンネル名とレイド人数が載っているか**を実測する。
  - 載っている → **新規購読ゼロ・新規スコープゼロ**で完了（security-review は軽くなる）
  - 載っていない → `channel.raid` の別購読が要る＝**新規購読＋スコープの検討**（review の重みが変わる）
- ⚠ **`channel.raid` を足す判断をするなら、その時点で本人に確認すること。**
  [043a](043a-monetary-ingestion-fidelity.md) で `channel.bits.use`（`bits:read`）を足したときは
  **既存ユーザーの再ログインが必要**になった。同じことが起きる。
- 実測手段: dev-mock に raid の生ペイロードを流す／実配信でレイドを受ける（協力者が要る）／
  Twitch の公式ドキュメントで `channel.chat.notification` の raid フィールドを確認する。
  ⚠ [043d](043d-youtube-jewels-gift-membership.md) の教訓：**公式ドキュメントを一次情報として当たれば
  実データ収集が不要になることがある**（あのときは REST リファレンスだけ見て「非公開」と誤断していた）。

### (2) DTO と wire 契約の拡張

- `raw.dto.ts` に **`TwitchRaidDetailsDto`** を足す（`viewer_count` など**数値と表示名のみ**）。
  ⚠ **アバター URL（`profile_image_url`）は持たない**（§9・036 系のアバターは別経路で扱う）。
- `TwitchChatNoticeType` の union に `"raid"` を明示的に足す（`(string & {})` に頼らない）。
- `comment-types.ts` の `CommentEventType` に **`"raid"`** と `COMMENT_EVENT_TYPES.RAID` を足す。
- `comment-view.dto.ts` の `CommentViewDto` に **`raidViewerCount?: number`** を足す
  （`monthCount` / `giftCount` / `tier` / `comboCount` と同じ「付随数値」の作法）。

### (3) mapper の変更

- `RAID_NOTICE_TYPES` を追加し、`isRaid` を分類に足す。
- `return null` の条件を `if (!isDonation && !isGift && !isSubscription && !isRaid)` に変える。
- レイド行の組み立て:
  - `author` = **レイド元のチャンネル**（`chatter_user_id` / `chatter_user_name`）
    ⚠ **これは chatter ではない**。「誰がレイドしてくれたか」としては正しいが、
    **視聴者メモリの `viewers` に「コメントした人」として混ざる**ことになる。
    → **この点を (4) で扱う。**
  - `text` = `event.message.text`（レイド時は空のことが多い）。
    ⚠ **`system_message` にフォールバックしない**（043a と同じ規律・英語自動文かつ受贈者名を含みうる）。
  - `eventType` = `COMMENT_EVENT_TYPES.RAID`
  - `raidViewerCount` = `event.raid?.viewer_count`
  - `monetaryAmount` = **undefined**（レイドは金銭ではない）
- ⚠ **`shared_chat_raid` の扱い**を決める（`stripSharedChatPrefix` が既にあるので、
  剥がして同じ扱いにするのが自然）。

### (4) Rust 側（語彙・保存・集計）

- `comment_viewer/model.rs` の `CommentEventType` に **`Raid`** を足す（serde rename が wire の `"raid"` と一致すること）。
- `viewer_comments` にはレイド行を**入れる**（`event_type = 'raid'`・`amount` / `currency` は NULL）。
  ⚠ **`raidViewerCount` をどこに入れるか**を決める。候補:
  - (a) 既存の `monetary_amount`（表示用文字列）に「N 人」と入れる → 型は合うが意味が汚れる
  - (b) **`ensure_column` で `raid_viewer_count INTEGER` を追加**する → 素直
  - **推奨は (b)**（`util.rs` の `ensure_column` が冪等な列追加のために既にある）。
- ⚠ **`RECOMPUTE_VIEWER_AGGREGATES_SQL` の `subscription_count` / `is_member` / `last_subscription_at` に
  `'raid'` を足さない**（レイドはサブスクではない）。
- ⚠ **`total_comments`（`COUNT(*)`）にレイド行が入る**。これをどうするか:
  - (a) そのまま（総コメント数が 1 増える・軽微）
  - (b) `total_comments` を `event_type <> 'raid'` に変える
  - **推奨は (b)**。⚠ ただし**これは既存列の意味論を変える変更**なので、
    **[038](038-viewer-memory.md) の視聴者一覧の表示にも波及する**。実装時に影響範囲を確認し、
    **決めた理由をコメントに残すこと**。

### (5) 表示側（最小限）

- `viewerFormat.ts` の `EVENT_LABEL` に「レイド」を足す。
- ⚠ **`MONETARY_EVENT_TYPES` には足さない**（課金ではない）。
  → コメビュ本体のティア色カード・オーバーレイの投げ銭カード・ティッカー・
  [061b](061b-monetary-effect-builtin.md) のエフェクトは**発火しない**（意図どおり）。
- ⚠ **読み上げ（[049](049-monetary-event-speech.md)）の対象にするか**を決める。
  **推奨は対象外**（レイドは配信者が気づくべきだが、読み上げの優先キューは課金用）。
  ⚠ 決めた理由をコメントに残す（再修正トリガー＝「レイドも読んでほしい」と言われたとき）。
- コメビュ本体の一覧に**レイド行が出る**ようにする（`chat` 分岐に落ちて名前＋空本文になるので、
  最低限「レイド」ラベルと人数が見えるようにする）。

### (6) security.md の更新

| 節 | 追記内容 |
|---|---|
| §9 端末保存 | レイド情報（レイド元チャンネル名・レイド人数）を `viewer_comments` に保存する。**受贈者情報・`system_message`・アバター URL は持たない** |
| コメントビューア（配信サービス連携）方針 | 受信面の拡張。**新規購読ゼロ・新規スコープゼロ**であることを記録（(1) の結果が「必要」だった場合はその内容と再ログインの必要性） |

### (7) テスト

- `scripts/test-twitch-mapper.mjs`（無ければ新規・`test-youtube-mapper.mjs` が手本）:
  - raid notice が `eventType: "raid"` の Comment になること
  - `raidViewerCount` が入ること
  - **`monetaryAmount` が undefined** であること
  - **`system_message` が `text` に入らない**こと（§9）
  - **アバター URL が持ち回られない**こと（§9）
  - `shared_chat_raid` が剥がされて同じ扱いになること
  - **announcement / bits_badge_tier は従来どおり捨てられる**こと（拾いすぎない担保）
- Rust `repository.rs` のテスト:
  - raid 行が `subscription_count` / `is_member` / `last_subscription_at` に**入らない**こと
  - `total_comments` の扱いが (4)(b) の決定どおりであること
  - `raid_viewer_count` 列が冪等に追加されること
- ⚠ **ミューテーションで実効性を確認**する。最低限、集計 SQL に `'raid'` を足す変異でレッドになること。
- ts-rs binding を再生成し `pnpm check:bindings` が通ること。

## このタスクでやらないこと

- **サマリー画面での表示**（[062c](062c-stream-summary-view.md)）。本タスクは取得と保存まで。
- **配信セッションの記録**（[062b](062b-stream-session-recording.md)）。
- **YouTube のレイド相当**（存在しない）。
- レイドを課金として扱うこと（`MONETARY_EVENT_TYPES` に足さない）。
- レイドでのエフェクト発火（[061](061-obs-effects.md)）。⚠ やりたくなったら
  `effectTrigger` の対象に足すだけだが、**本タスクではやらない**。
- announcement / bits_badge_tier など他の非収益 notice の取り込み。
- Twitch コミュニティギフトの二重計上の解消（別課題）。

## セキュリティ制約（docs/security.md 準拠）

- **外部通信ゼロを目指す**（§1）。**既存購読（`channel.chat.notification`）で足りるかを (1) で必ず先に確認する。**
  ⚠ `channel.raid` の新規購読が要る場合は**新規スコープ＝既存ユーザーの再ログインが必要**になりうる
  （[043a](043a-monetary-ingestion-fidelity.md) の `bits:read` の先例）。**本人に確認してから進める。**
- **§9 端末保存**: 保存するデータの種別が増える（レイド元チャンネル名・人数）。security.md へ追記。
  ⚠ **持ち回らないもの**: `system_message`（英語自動文・受贈者名を含みうる）・
  レイド元のアバター URL・受贈者情報。
- **識別子はコンパイル時定数のみ・値はパラメータバインド**（§8）。
- **集計の意味論を壊さない**（`subscription_count` 等に `raid` を混ぜない）。
- ログにレイド元チャンネル名・人数を出さない（§9）。
- **capability を増やさない**・`csp: null` 不変・`tauri.conf.json` 差分ゼロ・**新規依存ゼロ**。

## 完了条件

- Twitch のレイドが `eventType: "raid"` として取り込まれ、`viewer_comments` に保存される。
- `raidViewerCount`（レイド人数）が wire と DB の両方で保持される。
- **`subscription_count` / `is_member` / `last_subscription_at` にレイドが混ざらない。**
- `total_comments` の扱いが決定どおりで、理由がコメントに残っている。
- **`system_message`・アバター URL が持ち回られない**（テストで固定）。
- **announcement / bits_badge_tier は従来どおり捨てられる**（拾いすぎない担保）。
- 新規購読・新規スコープの有無が確定し、[`docs/security.md`](../security.md) に (6) の 2 項目が追記されている。
- ts-rs binding が再生成され `pnpm check:bindings` が通る。
- sidecar / Rust のテストが通り、**ミューテーションで実効性を確認**している。
- **capability 追加ゼロ・`tauri.conf.json` 差分ゼロ・`csp: null` 不変・新規依存ゼロ。**
- `pnpm --filter ./apps/desktop typecheck` / `lint` / `test`、`pnpm --filter ./apps/comment-sidecar test`、
  `cargo check` / `cargo test` が通る。[`docs/progress.md`](../progress.md) を更新。

## 確認コマンド

```bash
git diff --stat
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
pnpm --filter ./apps/desktop test
pnpm --filter ./apps/desktop check:bindings
pnpm --filter ./apps/comment-sidecar test
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml

# ゼロ拡大の担保（差分ゼロが期待）
git status --short -- apps/desktop/src-tauri/capabilities/ apps/desktop/src-tauri/tauri.conf.json .github/
# 新規依存ゼロの担保（差分ゼロが期待）
git status --short -- apps/comment-sidecar/package.json apps/desktop/package.json pnpm-lock.yaml package.json

pnpm --filter ./apps/desktop tauri dev
# ① dev-mock に raid を流す → コメビュ本体に「レイド」ラベルと人数が出る
# ② スパチャ風の強調（ティア色カード）にならない（課金扱いされていない）
# ③ 読み上げの対象にならない（決定どおり）
# ④ 視聴者詳細で subscription_count が増えていない
# ⑤ 実配信でレイドを受けられるなら実データで確認（協力者が要る）
# ⑥ lsof -i で外部 ESTABLISHED が増えないこと（新規購読ゼロの実証）
```

## 実装後に必要なレビュー

- **security-review 必須**（[`security-review`](../../.claude/skills/security-review/SKILL.md)）。対象:
  - **受信面の拡張**（新規購読・新規スコープの有無。あるなら再ログインの影響）
  - **§9 保存データ種別の変更**（何を保存し、何を保存しないか）
  - **`system_message`・アバター URL が持ち回られていない**こと
  - 集計 SQL の意味論が壊れていないこと
  - §8（識別子は定数・値はバインド）
