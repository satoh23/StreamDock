# 043d YouTube ギフトメンシプ／Jewels の取得（受信面拡張）

> 状態: **着手可（2026-07-27）**。旧状態「保留（2026-07-26）」の**保留理由は誤りだった**ため解除する。
> **誤っていた前提**: 「gift/jewels の gRPC フィールド番号は非公開（内部スキーマ）」→ **公開されている**。`liveChatMessages.streamList` は
> YouTube Live Streaming API の**公式メソッド**で、Google は `stream_list.proto` の**全文（enum 整数値・フィールド番号込み）を
> 公式ドキュメントにインライン掲載**している（出典: `https://developers.google.com/youtube/v3/live/streaming-live-chat`）。
> **誤認の原因**: 2026-07-26 の調査は REST リファレンス（`.../live/docs/liveChatMessages`）だけを参照していた。そこには
> `giftEvent` 等の**型名（camelCase）しか無く番号が無い**ため「非公開」と結論した。番号を含む proto 全文は上記**ガイドページ側**にあり、
> そのページが未確認だった。よって旧「解除条件(a)/(b)」および「再開の解除条件 1〜4」は**すべて不要**（＝公式ドキュメントで確定済み）。
> 実配信キャプチャ・協力配信者の確保・投げ銭は**一切不要**になった（キャプチャ足場も不要・下記「履歴」参照）。
>
> **必読前提**: 親 [043](043-monetary-emphasis.md)、[`docs/security.md`](../security.md)（§1 allow-list／二層 fail-closed／§9 非ログ・
> 非外部送信・受贈者/贈与者名の非保持／「コメントビューア方針」⑪）、gRPC proto
> [`stream-list-proto.ts`](../../apps/comment-sidecar/vendor/comment-fetcher/src/adapters/youtube/client/stream-list-proto.ts)、
> ワイヤ契約 [`model.rs`](../../apps/desktop/src-tauri/src/comment_viewer/model.rs)・[`wire.ts`](../../apps/comment-sidecar/src/wire.ts)。
> CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。**新規受信面のため security-review 必須**。

> **注記（2026-07-26・043a 拡張時）**: 実機確認のモック用途で **`jewels` 表示種別（shared/wire/Rust/binding/label）と dev-mock の合成発行は
> 043a で先行追加済み**（`CommentEventType` に `jewels`・`EVENT_LABEL` に「ジュエル」・集計は既存に混ざらない旨のテスト付き）。
> 本タスク 043d に残るのは **実データの取得（proto 拡張＝公式番号の記入）と mapper 配線**であり、Jewels の**表示語彙側の作業は不要**。
> ギフトメンシプ（贈与/受領）の種別と二重計上方針は「## 決定事項（2026-07-27）」で確定した。

## 目的

「お金がかかるコメント」の網羅（親 043・要望⑤）のうち、043a で拾えなかった **YouTube の収益イベント**を取得する:

- **メンバーシップギフト（贈与側）** `MEMBERSHIP_GIFTING_EVENT`＝ギフト購入者。付随 `gift_memberships_count` / `gift_memberships_level_name`。
- **メンバーシップギフト（受領側）** `GIFT_MEMBERSHIP_RECEIVED_EVENT`＝1 購入につき N 件発火（受領者数分）。→ **本タスクでは取り込まない**（決定1）。
- **Jewels（縦型ライブのギフト）** `GIFT_EVENT`＝`gift_details.jewels_amount`。

## 現在の前提（2026-07-27 訂正）

- **番号は公式ドキュメントで入手できる**。ガイドページ `https://developers.google.com/youtube/v3/live/streaming-live-chat` に
  `stream_list.proto` 全文がインライン掲載されており、gift/jewels の enum 整数値・詳細メッセージのフィールド番号がすべて記載されている。
  メソッド仕様は `https://developers.google.com/youtube/v3/live/docs/liveChatMessages/streamList`。
- **検証方法**: 同ページを無パラメータ / `?hl=en` / `?hl=en-US` / `?hl=ja` の **4 回（別 URL・別プロンプト）取得して内容一致**を確認。
  さらに既存 vendored proto の特徴的な番号（`next_page_token=100602` / `channel_id=10101` / `max_results=98` / `page_token=99` /
  `profile_image_url=104`）と**完全一致**することを確認済み（＝ページ読取の忠実性の裏取り）。
- **番号の推測は不要**（`⚠ 技術ブロッカー` は解消）。既存 `profile_image_url = 104`（036b の「未確定・要実配信検証」）も
  **公式と一致＝正しい**ことが確定した。

## 確定した公式番号（実装の根拠）

| 対象 | 公式（`stream_list.proto`） | 現状 vendored | 扱い |
| --- | --- | --- | --- |
| `MEMBERSHIP_GIFTING_EVENT` | `= 18` | 無し | 追加 |
| `GIFT_MEMBERSHIP_RECEIVED_EVENT` | `= 19` | 無し | enum のみ宣言（詳細は受信しない・決定1） |
| `GIFT_EVENT`（Jewels） | `= 21` | 無し | 追加 |
| `membership_gifting_details` | `= 31` | 無し | 追加 |
| `gift_membership_received_details` | `= 32` | 無し | **採用しない**（決定1） |
| `gift_details` | `= 34` | 無し | 追加 |
| `LiveChatMembershipGiftingDetails` | `gift_memberships_count = 1`（int32） / `gift_memberships_level_name = 2` | — | count のみ採用 |
| `LiveChatGiftDetails` | `gift_name = 1` / `gift_duration = 2`(Duration) / **`jewels_amount = 3`**(int32) / `gift_url = 4` / `alt_text = 5` / `language = 6` / `has_visual_effect = 7` / `combo_count = 8` | — | `jewels_amount` のみ採用 |
| `LiveChatMemberMilestoneChatDetails` | `member_level_name = 1` / **`member_month = 2`**(uint32) / `user_comment = 3` | **`member_month = 1`** | **バグ修正**（下記） |
| `LiveChat{SuperChat,SuperSticker}Details.amount_micros` | **`uint64`** = 1 | **`string`** = 1 | **バグ修正**（下記） |
| `author_details.profile_image_url` | `= 104` | `= 104`（036b「未確定」注記） | **正しいと確定**・注記を解消 |

**判明した既存バグ（本タスクで修正する・決定2）**

- `member_month = 1` は**公式では `member_level_name`（string）の番号**。現状は文字列フィールドを `uint32` として読むため、
  月数が誤値（文字列の長さ）になり、以降の読み取り位置もずれて詳細メッセージのデコードが破損する。実データは未検証
  （自チャンネル未収益化のため）だが、公式番号との突き合わせで**確定的に誤り**。修正後は正しい月数（`= 2`）を読む。
- `amount_micros` の宣言型 `string` は**ワイヤ型が一致しない**（公式 `uint64` = varint／`string` = length-delimited）。
  デコーダは宣言型に従って読むため、金額 varint を長さとして解釈して読み取り位置が壊れる。`loadSync` の `longs: String`
  指定により **`uint64` は文字列で受かる**ので、修正しても DTO（`amount_micros: string`）と mapper（`Number(...)`）は**無変更**。

**未採用だが番号が判明したもの**（proto 内コメントに番号を記録するだけ・受信面は増やさない）:
`text_message_details = 19` / `user_banned_details = 22` / `new_sponsor_details = 29` / `poll_details = 33` /
SuperChat の `amount_display_string = 3`・`user_comment = 4`・`tier = 5` / SuperSticker の `amount_display_string = 3`・`tier = 4`・
`super_sticker_metadata = 5` / author の `channel_url = 102`・`is_verified = 4`・`is_chat_owner = 5`・`is_chat_sponsor = 6`・
`is_chat_moderator = 7` / response の `page_info = 1004`・`active_poll_item = 1008`。

## 決定事項（2026-07-27）

1. **ギフトメンシプ受領側（`GIFT_MEMBERSHIP_RECEIVED_EVENT`）は取り込まない**。1 購入で N 件発火するため、贈与側 1 行のみを扱えば
   **二重計上ゼロ**。受贈者の情報を**そもそも受信しない**ので security.md §9（受贈者/贈与者名の非保持）と最も整合する。
   表示は贈与側の「〇〇さんがメンバーシップギフトを N 件贈りました」1 行に集約する。
   **再検討の目安**: 「誰が受け取ったか」を出したい要望が出たら、受領側を新種別（集計対象外）として起票し直す
   （`membership` 流用は `subscription_count` が N+1 に膨らむため不可）。
2. **公式 proto とのズレ修正を本タスクに含める**（proto を公式版準拠へ差し替える）。gift/jewels 追加と同一ファイルの
   同一箇所であり、番号の出典を「osareview 逐語コピー」から「公式ドキュメント」へ切り替える作業と不可分のため。

## このタスクでやること

1. **proto**（[`stream-list-proto.ts`](../../apps/comment-sidecar/vendor/comment-fetcher/src/adapters/youtube/client/stream-list-proto.ts)）
   - ヘッダコメントの出典を「osareview `stream_list.proto` の逐語コピー」から**公式ガイド URL**へ差し替える（＝新しい単一の正）。
   - enum `Type` を公式集合に合わせる（`TOMBSTONE = 2` / `FAN_FUNDING_EVENT = 3` / `CHAT_ENDED_EVENT = 4` /
     `SPONSOR_ONLY_MODE_STARTED_EVENT = 5` / `SPONSOR_ONLY_MODE_ENDED_EVENT = 6` を追加し、公式に存在しない
     `MESSAGE_DELETED_EVENT = 8` / `MESSAGE_RETRACTED_EVENT = 9` を削除）。未知整数は数値のまま届き mapper が除外するため**退行なし**。
     `MEMBERSHIP_GIFTING_EVENT = 18` / `GIFT_MEMBERSHIP_RECEIVED_EVENT = 19` / `GIFT_EVENT = 21` を追加。
   - snippet に `membership_gifting_details = 31` / `gift_details = 34` を追加。**`gift_membership_received_details = 32` は宣言しない**
     （決定1・理由をコメントに残す）。
   - メッセージ `LiveChatMembershipGiftingDetails { gift_memberships_count = 1 }` / `LiveChatGiftDetails { jewels_amount = 3 }` を追加。
   - ズレ修正: `member_month` を `2` へ、`amount_micros` を `uint64` へ。
   - メッセージ名を公式に合わせる（`SuperChatDetails` → `LiveChatSuperChatDetails` 等）。TS 側の参照は
     `V3DataLiveChatMessageService` のみなので影響なし。
   - **公式の `oneof displayed_content` と `TypeWrapper.Type` ネストは採用しない**（ワイヤ表現は同一でデコード結果も変わらず、
     `oneofs: true` による追加プロパティを避けられる）。理由をコメントに明記。
   - `gift_duration` は不採用のため `google.protobuf.Duration` の `import` は不要（SEA 下の proto 解決経路は不変）。
     未宣言フィールドはワイヤ型に従って安全にスキップされる。
2. **DTO**（`.../youtube/dto/raw.dto.ts`）
   - `YouTubeLiveChatMessageSnippetDto` に `membership_gifting_details?` / `gift_details?` を追加。
   - 新規型 `YouTubeMembershipGiftingDetailsDto { gift_memberships_count?: number }` /
     `YouTubeGiftDetailsDto { jewels_amount?: number }`。
   - `YouTubeLiveChatMessageType` union に `MEMBERSHIP_GIFTING_EVENT` / `GIFT_MEMBERSHIP_RECEIVED_EVENT` / `GIFT_EVENT` を追加
     （未知値の string フォールバックは既存どおり維持）。
   - `amount_micros: string` は**変更しない**（`longs: String` で uint64 が文字列で届く）。根拠をコメント化。
3. **mapper**（`.../youtube/mapper/comment.mapper.ts`）
   - `YOUTUBE_MESSAGE_TYPE_TO_COMMENT_EVENT_TYPE` に `MEMBERSHIP_GIFTING_EVENT → COMMENT_EVENT_TYPES.GIFT`、
     `GIFT_EVENT → COMMENT_EVENT_TYPES.JEWELS` を追加。
   - `GIFT_MEMBERSHIP_RECEIVED_EVENT` は**マップに載せない**（既存の「未対応 type は除外」で落ちる）。決定1の理由と
     再修正条件をコメントに残す。
   - `giftCount = membership_gifting_details?.gift_memberships_count`（Twitch の `?? 1` とは異なり欠落時 `undefined`
     ＝表示側が件数なしの文へ無害に劣化する）。
   - Jewels の金額は `gift_details?.jewels_amount` から `monetaryAmount = { currency: "JEWELS", amount: jewels_amount }` を組む。
     **micros 換算しない**（既存 `mapMonetaryAmount` は super_chat/sticker 専用のまま。043a の dev-mock と同形）。
4. **表示語彙の最小修正**（[`viewerFormat.ts`](../../apps/desktop/src/screens/comment-viewer/viewerFormat.ts)）
   - `composeEventMessage` の `gift` は現状 Twitch 語彙「〇〇さんが**サブギフト**を N 件贈りました」を返す。YouTube のギフトメンシプが
     `gift` で届くと文言が誤るため、`EventMessageInput` に `source?: string` を追加し `youtube` では
     「〇〇さんが**メンバーシップギフト**を N 件贈りました」を返す（YouTube 側は `tier` 未設定なので `tierSuffix` は付かない）。
   - 呼び出し側 [`CommentList.tsx`](../../apps/desktop/src/screens/comment-viewer/CommentList.tsx)（136 / 262 行）は渡している
     オブジェクトに `source` を含むため**引数の変更は不要**。
5. **波及なしの確認（変更不要であることの根拠）**
   - `jewels` / `gift` 種別・`giftCount`・`currency: "JEWELS"` の語彙と表示は 043a で整備済み
     ⇒ **wire / Rust / binding / 集計 SQL の変更はゼロ**。
   - 集計（`viewer_memory/repository.rs`）: `subscription_count = event_type IN ('subscription','membership','gift')`
     ⇒ YouTube のギフトは Twitch の gift と同じ扱いで自然に入る。`bits_count = currency = 'BITS'`・
     `superchat_count = event_type = 'superchat' AND currency <> 'BITS'` ⇒ **JEWELS はどちらにも混ざらない**（043a のテスト済み）。
   - リクエストの `part`（`id,snippet,authorDetails`）・`profile_image_size` も不変 ⇒ **追加リクエスト・クォータ影響なし**。
6. **テスト**
   - **desktop 側（既存基盤あり）**: [`viewerFormat.test.ts`](../../apps/desktop/src/screens/comment-viewer/viewerFormat.test.ts) に
     YouTube gift の文言／Twitch gift の既存文言が不変であることを追加（`pnpm --filter ./apps/desktop test`）。
   - **sidecar 側（テスト基盤が無い点に注意）**: `apps/comment-sidecar` には**テストフレームワークが無い**
     （`package.json` の scripts は `typecheck`/`build:tsc`/`build:bundle`/`build:sea` のみ・`*.test.ts` はゼロ・devDeps に vitest/jest 無し）。
     既存の慣行は `scripts/test-*.mjs`（例 `test-host-guard.mjs`＝`build:tsc` 後に `dist` から import して素の assert で表明）。
     ただし `dist/vendor/comment-fetcher/src/adapters/youtube/mapper/comment.mapper.js` は emit 後も
     `import { ... } from "@comment-dock/shared"` の **alias をそのまま保持**するため（tsconfig の `paths` は emit を書き換えない）、
     素の node では解決できず **alias 解決ローダが必要**（旧キャプチャ足場の `scripts/dist-alias-loader.mjs` が同目的で実装済み・
     stash 内にあるため復元 or 再実装が必要）。
     - **方針（推奨）**: `scripts/test-youtube-mapper.mjs`＋alias ローダを新設し、①贈与側 → `gift` + `giftCount`、
       ②`GIFT_MEMBERSHIP_RECEIVED_EVENT` は 0 件に落ちる、③`GIFT_EVENT` → `jewels` + `{ currency: "JEWELS", amount: n }`、
       ④`member_month` 修正後にマイルストーンの月数が正しく取れる、を表明する（番号ミスと二重計上の回帰検知に効く）。
     - **代替**: ローダ整備のコストを避けるなら mapper の単体テストは作らず、dev-mock＋実配信の目視確認に寄せる
       （043a 時点の YouTube mapper も単体テスト無し＝既存慣行の範囲）。この場合は下記「実機確認の順序」を必須とする。

## このタスクでやらないこと

- **受領側イベントの受信・表示・集計**（決定1。`gift_membership_received_details` は proto にも書かない）。
- `gift_name` / `gift_url` / `alt_text` / `combo_count` / `has_visual_effect` 等のギフト資産情報の受信（表示要件が無く、
  `gift_url` は画像取得＝CSP・§9 の論点を新たに生むため意図的に除外。番号はコメントに記録する）。
- `tier` / `amount_display_string` / `user_comment` / `is_chat_sponsor` 等の採用（番号記録のみ・別タスク候補）。
- 通貨換算（Jewels は仮想通貨のまま `currency: "JEWELS"`）・第三者投げ銭サービス連携。
- 新規宛先・新規 OAuth スコープ・新規依存の追加（YouTube は既存 `youtube.readonly`・既存 gRPC ストリーム内。**宛先は増えない**）。
- **キャプチャ足場の復元・実配信キャプチャ**（不要化）。stash / ブランチ `043d-grpc-capture-spike` の破棄も本タスクでは行わない。

## セキュリティ制約（docs/security.md 準拠）

- **新規受信面**（proto で新たに解釈する 3 イベント＋2 詳細メッセージ）であり **security-review 必須**。
- §9: 受贈者/贈与者の個人名は wire/Rust DTO に載せない・保存しない。決定1により**受領側を一切扱わない**ため受贈者情報は
  そもそも受信しない。受領側の `gifter_channel_id` も**不採用**。受信するのは数値属性（`gift_memberships_count` / `jewels_amount`）のみ。
- 宛先・二層 fail-closed（env ピン留め＋gRPC チャネルガード `www.googleapis.com:443` のみ）・依存・`csp: null` は不変。
- proto のズレ修正は**既存フィールドを正しい番号/型で読むだけ**で、受信するデータ項目は増えない。

## 完了条件

- 公式番号（`18` / `19` / `21` / `31` / `34` / `jewels_amount = 3` / `gift_memberships_count = 1`）で proto を拡張し、
  YouTube のギフトメンシプ（贈与側）と Jewels が `subscription`/`membership`/`gift`/`donation`/`jewels` と区別されて
  wire→Rust→binding に届く。**番号の推測はゼロ**（すべて公式出典）。
- 受領側は取り込まれない（＝二重計上なし）。集計が退行しない。
- マイルストーンの月数（`member_month = 2`）が正しく取れる／スパチャの `amount_micros` がワイヤ型一致で読める。
- 新規宛先/OAuth スコープ/依存ゼロ。`csp: null` 不変。`typecheck` / `lint` / `cargo check` / テストが通る。security-review 通過。

## 確認コマンド

```bash
git diff --stat
pnpm --filter @stream-dock/comment-sidecar typecheck
pnpm --filter ./apps/desktop typecheck && pnpm --filter ./apps/desktop lint
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
pnpm --filter ./apps/desktop test                          # viewerFormat / CommentList
pnpm --filter @stream-dock/comment-sidecar build:bundle     # 禁止依存アサート
node apps/comment-sidecar/scripts/test-host-guard.mjs       # 宛先ガード回帰（build:tsc/build:bundle 後）
# mapper テストを作る場合（推奨方針）:
pnpm --filter @stream-dock/comment-sidecar build:tsc && node apps/comment-sidecar/scripts/test-youtube-mapper.mjs
```

実機確認の順序:

1. **dev-mock で表示回帰**: `jewels` / `gift`（YouTube）の行が種別ラベル＋文言＋金額バッジで正しく出る
   （「メンバーシップギフト」文言を目視）。
2. **実配信（通常チャットのみで可）**: 通常コメント・新規メンバー・マイルストーンが**退行なく届く**ことを確認（proto 差し替えの安全確認）。
   とくに**マイルストーンの月数が正しい値**になること（従来は破損）。
3. **gift / jewels の実データ**: 発火機会があれば種別区別を確認する。機会が無くても**番号は公式確定済み**なので実装完了とする。
4. `lsof -i` で外部 ESTABLISHED が sidecar PID 配下・既存 allow-list のみであることを確認。

---

## 履歴: 保留の経緯（2026-07-26）と訂正

> **訂正（2026-07-27）**: 以下の保留は「フィールド番号が非公開」という**誤った前提**に基づくもの。番号は公式ドキュメントに
> 掲載されており、旧「解除条件(a)/(b)」「再開の解除条件 1〜4」は**すべて不要**。協力配信者の確保・投げ銭・実配信キャプチャは
> **一切不要**になった。以下は経緯の記録として残す。

- 旧解除条件(a)（osareview 上流 proto に gift/jewel メッセージ＋番号）は **無い**ことを確認済み（repo に `.proto` 実ファイル無し）。
  よって残る道は **(b) 実配信の生 gRPC キャプチャで番号を確定**のみ、と判断していた。
  → **訂正**: 探すべき先は上流 repo ではなく**公式ドキュメント**だった。
- (b) の進め方として「収益化済みの協力配信者の公開配信に投げ銭し、その生バイトを取得して番号を逆算する」方針を採り、
  dev 専用キャプチャ足場を実装した（下記）。
- **中断理由**: 予定していた協力配信者が **Jewels を終了**したため Jewels の実配信キャプチャができなくなった。gift membership も
  同様に対象が確保できず、番号を確定できないため保留とした。
- **旧「再開の解除条件」**（Jewels 有効な縦型ライブの協力者確保／メンシプ有効な協力者確保／自チャンネル収益化／上流 proto 更新）は
  **すべて不要**。

## 履歴: 実装済み足場（2026-07-26・旧解除条件(b)用の生 gRPC キャプチャ・dev 専用・未マージ）

> **不要化（2026-07-27）**: 公式 proto で番号が確定したため、**本足場は不要**。復元も撤去も要らない
> （stash / ブランチ `043d-grpc-capture-spike` は**そのまま残置**する）。以下は記録として残す。

実配線（proto/DTO/mapper）ではなく、**番号を実測するための dev 専用ツール**。実装コードは git stash に退避
（`git stash list` の「043d gRPC capture scaffold」エントリ・ブランチ `043d-grpc-capture-spike` 上で作成・**未マージ・未コミット**）。
詳細記録は [`docs/progress.md`](../progress.md) の「2026-07-26 (043d 解除条件(b)用: gRPC 生バイト キャプチャ足場…)」節。

**2 つの能力（どちらも env ゲート `COMMENT_SIDECAR_CAPTURE=1`・既定 OFF＝本番は byte 同一）**:

1. **生バイト捕捉**: gRPC の `responseDeserialize`（proto-loader）を `loadSync` ラップで差し替え、復号前の生バイトを
   0700 一時ファイル `streamdock-yt-capture-*/frames.b64`（base64・1 frame/line・`appendFileSync` 同期）へ書く。
   `createClient` の gRPC チャネルガードは温存。
2. **他人の公開配信を対象化**: `COMMENT_SIDECAR_CAPTURE_VIDEO_ID=<動画ID>` 指定時、`live-stream.client.ts` が既存
   `findLiveDetails`（`videos.list?id=`）で公開配信の `activeLiveChatId` を解決して読む。未指定は現行
   `findActiveOwnBroadcast` と完全同一。

**対象ファイル**: 新規 `apps/comment-sidecar/src/youtube-capture.ts`／変更 `register-youtube-deps.ts`・`index.ts`・
`live-stream.client.ts`／dev スクリプト（バンドル非同梱）`scripts/{protobuf-raw,decode-capture,test-capture,dist-alias-loader}.mjs`。

**セキュリティ**: 新規宛先/OAuth スコープ/依存ゼロ。§9: 生バイトは 0700 一時ファイルのみ・非永続・端末外へ出さない・
通常ログ/DB 非保存。**テスト**: `node scripts/test-capture.mjs`（45 件 PASS）。
