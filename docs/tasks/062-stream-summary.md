# 062 配信サマリー（集計・保存・フィルタ・レイド）（親・設計/方針）

> 状態: **未着手（親ドキュメント）**。本ファイルは 062a〜062d の**分割・線引き・実装順の正**。
>
> **必読前提**: 視聴者メモリ [038](038-viewer-memory.md) / [038a](038a-viewer-memory-data-layer.md)（`viewers` / `viewer_comments` の正）と
> [`viewer_memory/repository.rs`](../../apps/desktop/src-tauri/src/viewer_memory/repository.rs)（**`session_id` 列と `idx_viewer_comments_session` が既にある**）、
> session_id の採番 [`CommentViewerApp.tsx`](../../apps/desktop/src/screens/comment-viewer/CommentViewerApp.tsx)（`sessionIdRef`）、
> Twitch の取得 [`comment.mapper.ts`](../../apps/comment-sidecar/vendor/comment-fetcher/src/adapters/twitch/mapper/comment.mapper.ts)（**raid を明示的に捨てている**）と
> [`raw.dto.ts`](../../apps/comment-sidecar/vendor/comment-fetcher/src/adapters/twitch/dto/raw.dto.ts)（`TwitchChatNoticeType`）、
> 取得精緻化の先例 [043a](043a-monetary-ingestion-fidelity.md) / [043d](043d-youtube-jewels-gift-membership.md)、
> ワイヤ契約 [`comment-types.ts`](../../apps/comment-sidecar/vendor/shared/src/comment/comment-types.ts) / [`comment-view.dto.ts`](../../apps/comment-sidecar/vendor/shared/src/comment/comment-view.dto.ts) と
> Rust 側 [`comment_viewer/model.rs`](../../apps/desktop/src-tauri/src/comment_viewer/model.rs)、
> 冪等な列追加 [`util.rs`](../../apps/desktop/src-tauri/src/util.rs)（`ensure_column`）、
> [`docs/security.md`](../security.md)（**§9 端末保存／§1／§8／レビュー必須条件**）。
> CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。各サブタスクは 1 タスク 1 機能で分割済み。

## 目的

依頼者の要望⑤⑥を実装する。

- 配信終わりに、**総コメント数・総課金額・総課金回数・サブスク件数・誰が課金チャットやサブスクをしてくれたか**を出す。
- **各配信ごとに保存**でき、あとから見返せる。
- **「何月は誰がいくらくれたか」「今年は」「この配信は」でフィルタ**できる。
  → ⚠ **誰がいくら投げてくれたか・誰がサブスクを更新/加入してくれたかが見られるのはマスト**。
- **Twitch のみ、配信終わりに誰がレイドしてくれたかが分かる**（要望⑥）。

## 現在の前提（調査結果・実コード）

### 土台は半分できている

- [`viewer_memory/repository.rs`](../../apps/desktop/src-tauri/src/viewer_memory/repository.rs) の
  `viewer_comments` テーブルは**既に `session_id` 列を持ち、`idx_viewer_comments_session` インデックスまで張ってある**。
  1 件ごとに `source` / `text` / `event_type` / `amount` / `currency` / `monetary_amount` / `published_at` が入る。
  → **配信サマリーは新テーブルなしで `session_id` の GROUP BY 集計として計算できる素地がある。**
- ⚠ ただし **`session_id` は「1 配信」と一致していない**。
  [`CommentViewerApp.tsx`](../../apps/desktop/src/screens/comment-viewer/CommentViewerApp.tsx) の `sessionIdRef` が
  **コメビュ窓のマウント単位**で `crypto.randomUUID()` を採番している。
  ＝**窓を開き直すと別セッションになり、配信の途中で分裂する**。
- **セッションのメタ情報（開始/終了時刻・タイトル・プラットフォーム）を持つテーブルは存在しない。**
  現状 `session_id` は「束ねるキー」でしかなく、**いつの配信かすら分からない**（`published_at` から推測するしかない）。
- `viewers` テーブルは**視聴者単位の累計**（`total_comments` / `bits_*` / `superchat_*` / `subscription_count` /
  `is_member` / `last_subscription_at`）を持つが、**配信単位ではない**。
  集計は挿入のたびに `RECOMPUTE_VIEWER_AGGREGATES_SQL` で**全再計算**する冪等方式。

### ⚠ レイドは「取り込まない」と明示的に決められている

[`comment.mapper.ts`](../../apps/comment-sidecar/vendor/comment-fetcher/src/adapters/twitch/mapper/comment.mapper.ts) に:

```ts
// 収益に関係しない notice（raid / announcement / bits_badge_tier 等）は取り込まない。
if (!isDonation && !isGift && !isSubscription) {
  return null;
}
```

- `channel.chat.notification` は**既に購読済み**（`subscribeChatEvents` の必須 2 種のひとつ）なので、
  **raid の notice は受信経路に載っている**。捨てているだけ。
- `TwitchChatNoticeType` は `(string & {})` のフォールバックを持つので、`"raid"` は**型としては通る**が
  **専用の付随オブジェクト DTO（`raid` の `viewer_count` 等）は未モデル化**。
- ⚠ **レイドは author＝レイド元チャンネルであって chatter ではない**。
  `viewers`（視聴者メモリ）に混ぜるかどうかの設計判断が要る。

### 集計の意味論に既知の歪みがある（サマリーに直撃する）

- ⚠ **Twitch コミュニティギフトの二重計上**（[043a](043a-monetary-ingestion-fidelity.md) の既知課題）:
  N 件のギフトで `community_sub_gift(total=N)` と個別 `sub_gift`×N の**両方**が届き、
  gift 行が **N+1 個**生成され `subscription_count` も N+1 になる。
  → **「サブスク件数」がそのまま水増しされる。**
- ⚠ **YouTube Jewels の単位が未確定**（[043e](043e-youtube-jewels-combo-fidelity.md) フェーズ 2 未了）:
  `jewels_amount` が単価か累計かが**今も不明**。
  ⚠ ただし **JEWELS を合計するロールアップ列は現時点で存在しない**（`bits_amount` は `currency='BITS'`、
  `superchat_amount` は `event_type='superchat'` 条件）ので、**サマリーで初めて合算対象になりうる**。
- ⚠ **通貨がバラバラ**: `superchat_amount` は `REAL` で通貨を問わず合計し、`superchat_currency` は
  「最後に使われた通貨」を入れているだけ。**「総課金額」を 1 つの数字で出すと、JPY と USD と BITS が混ざる。**

## 確定した方針

### (1) 「配信」を明示的にモデル化する（`stream_sessions` テーブル）

- **`session_id` の採番を窓マウント単位から切り離す**。配信の開始/終了に紐づけ、
  メタ情報（開始/終了時刻・プラットフォーム・タイトル）を持つ行を作る。
- ⚠ **境界の定義は [062b](062b-stream-session-recording.md) で確定させる。** 候補:
  - (a) **配信接続の開始/切断に紐づける**（自動・ただし途中で切れると分裂する）
  - (b) **手動で「配信を終了」する**（確実だが押し忘れる）
  - (c) **(a) を基本とし、一定時間内の再接続は同一セッションへ継続**（実用的・複雑）
  - **推奨は (c)**。配信中の一時的な切断で記録が割れるのが一番困る。
- **既存の `viewer_comments.session_id` はそのまま使う**（列の追加も型の変更もしない）。

### (2) 「総課金額」は通貨ごとに出す

- ⚠ **1 つの数字に丸めない。** `JPY 12,340` / `BITS 500` のように**通貨ごとに並べる**。
  換算レートを持ち込むと、外部通信（レート取得）か固定レート（すぐ古くなる）のどちらかが要る＝どちらも採らない。
- 043c/047 が「金額は verbatim 表示」と決めた方針と同じ考え方。

### (3) 既知の歪みは「隠さず注記する」

- ⚠ **コミュニティギフトの N+1** と **Jewels の単位未確定**は、062 では**直さない**（上流の課題）。
  代わりに**サマリー画面に注記を出す**（「Twitch のコミュニティギフトは件数が多めに出ることがあります」）。
  ⚠ **黙って出すと配信者が誤った数字を信じる**。数字が売りの機能なので、限界を明示するのが誠実。
- ⚠ **Jewels はサマリーの「総課金額」に合算しない**（単位が未確定なので）。**件数だけ**出し、
  金額は「JEWELS N 回」と別枠にする。[043e](043e-youtube-jewels-combo-fidelity.md) フェーズ 2 が
  決着したら合算を検討する。**この判断を 062c に明記する。**

### (4) レイドは新しいイベント種別として取り込む（要望⑥）

- `CommentEventType` に **`raid`** を足す。⚠ **sidecar は `snake_case`（`normal` / `super_chat`）、
  Rust は別語彙（`Chat` / `Superchat`）**と語彙がずれているので、**両方に足して対応表を確認する**。
- ⚠ **`viewers`（視聴者メモリ）の集計には混ぜない。** レイドは「投げ銭でもサブスクでもない」ので、
  `RECOMPUTE_VIEWER_AGGREGATES_SQL` の `subscription_count` 等に入れると意味が壊れる。
  `viewer_comments` に行としては入れるが、**集計 SQL の条件には足さない**。
- ⚠ **YouTube にレイドは無い**。要望どおり **Twitch 限定**の機能として UI にも明記する
  （[040](040-lurker-list.md) が「Twitch 限定・YouTube は対象外」を明示している先例と同型）。

### (5) 保存は端末内 SQLite のみ（§9）

- 外部送信ゼロ・エクスポート機能は作らない（別タスク）。
- ⚠ **§9 の保存ポリシー変更**に当たるので [062a](062a-twitch-raid-ingestion.md) / [062b](062b-stream-session-recording.md) は
  **security-review 必須**（[038a](038a-viewer-memory-data-layer.md) が §9 を限定解禁したのと同型）。

## 子タスクと線引き

| 子 | 内容 | 層 | 外部通信（新規） | レビュー |
|---|---|---|---|---|
| [062a](062a-twitch-raid-ingestion.md) | **Twitch レイドの取り込み**（sidecar mapper ＋ wire DTO ＋ Rust model ＋ binding） | sidecar/wire/Rust | なし（既存購読） | **security-review 必須**（受信面拡張・§9） |
| [062b](062b-stream-session-recording.md) | 配信セッションの記録（`stream_sessions` テーブル＋境界の確定＋既存 `session_id` との接続） | Rust/frontend | なし | **security-review 必須**（§9 保存データ種別の変更） |
| [062c](062c-stream-summary-view.md) | 配信サマリー画面（総コメント数／通貨別総課金額／課金回数／サブスク件数／貢献者一覧／レイド一覧） | frontend/Rust | なし | 軽レビュー |
| [062d](062d-stream-history-filter.md) | 履歴とフィルタ（配信別／月別／年別） | frontend/Rust | なし | 軽レビュー |

- **[062a](062a-twitch-raid-ingestion.md) を最初に置く理由＝取得層は遡れない。**
  レイドを取り込み始めるのが遅れるほど、その間の配信のレイド記録は**永久に失われる**。
- [062b](062b-stream-session-recording.md) も同じ理屈で早いほど良い（セッション境界の記録は遡れない）。
- [062c](062c-stream-summary-view.md) / [062d](062d-stream-history-filter.md) は**あとからでも過去データに効く**。

## 依存関係と推奨実装順

```
062a ──> 062b ──> 062c ──> 062d
```

- ⚠ **[062a](062a-twitch-raid-ingestion.md) と [062b](062b-stream-session-recording.md) は、
  他の親タスク（058〜061・063）より優先して着手する価値がある**（記録が遡れないため）。
  実装順の判断は本人に委ねるが、**この非対称性は明示しておく**。
- [062c](062c-stream-summary-view.md) は [062b](062b-stream-session-recording.md) の
  セッション境界が決まらないと画面の単位が決まらない。

## 横断セキュリティ方針（docs/security.md 準拠）

- **外部通信ゼロ**（§1）。レイドは**既に購読済み**の `channel.chat.notification` から拾うだけで、
  **新規の EventSub 購読も新規 OAuth スコープも増やさない**。
  ⚠ もし `channel.raid` の別購読が必要になったら**新規スコープ＝security-review の重みが変わる**ので、
  [062a](062a-twitch-raid-ingestion.md) で必ず「既存購読で足りるか」を先に確認すること。
- **§9 端末保存**: 保存するデータの種別が増える（レイド元チャンネル名・レイド人数・配信セッションのメタ情報）。
  [038a](038a-viewer-memory-data-layer.md) が §9 を限定解禁した形式に倣い、**追記＋security-review**。
- ⚠ **§9 で持ち回らないもの**: レイドの受贈者情報・`system_message`（英語自動文・受贈者名を含みうる）・
  レイド元のアバター URL は**保存しない**（043a が `system_message` を持ち回らないと決めた先例と同型）。
- **識別子はコンパイル時定数のみ**（テーブル名・ORDER BY 句）。値は必ずパラメータバインド（§8・
  `viewer_memory/repository.rs` の冒頭に明記されている規律）。
  ⚠ **フィルタ機能（062d）は動的な WHERE 句を作りたくなる**ので、ここが最大の注意点。
- **外部送信ゼロ・エクスポートなし**。集計は端末内で完結する。
- ログに視聴者名・金額・レイド元を出さない（§9）。
- **capability を増やさない**・`csp: null` 不変・**新規依存ゼロを目指す**。

## 完了条件（親）

- 062a〜062d のタスクファイルが本親の分割・依存どおりに存在し、既存フォーマットに沿う。
- [`docs/task-board.md`](../task-board.md) に 062 系が追記されている。
- 本親ドキュメント自体はコードを変更しない（実装は各サブタスクで「実装して」後）。

## security.md へ追記する節の割り当て

| 節 | 追記する子 | 内容 |
|---|---|---|
| §9 端末保存 | [062a](062a-twitch-raid-ingestion.md) | レイド情報（レイド元チャンネル名・人数）を `viewer_comments` に保存する。受贈者情報・`system_message`・アバター URL は持たない |
| §9 端末保存 | [062b](062b-stream-session-recording.md) | 配信セッションのメタ情報（開始/終了時刻・プラットフォーム・タイトル）を新テーブルに保存する |
| コメントビューア方針 | [062a](062a-twitch-raid-ingestion.md) | 受信面の拡張（新規スコープ・新規購読ゼロであることの記録） |

## このタスク（親）でやらないこと

- コード実装（062a〜d それぞれで行う）。
- **Twitch コミュニティギフトの二重計上の解消**（[043a](043a-monetary-ingestion-fidelity.md) から残る既存課題）。
  062 では**注記して隠さない**だけ。⚠ 直すなら `community_gift_id` 単位の dedup ＝ 取得層の別タスク。
- **YouTube Jewels の単位確定**（[043e](043e-youtube-jewels-combo-fidelity.md) フェーズ 2・実データ待ち）。
- **通貨換算**（外部レート取得＝§1 違反 / 固定レート＝すぐ古くなる）。**通貨ごとに並べる。**
- **CSV / JSON エクスポート**、外部サービス連携、クラウド同期。
- **YouTube のレイド相当**（存在しない）。
- 視聴者メモリ（[038](038-viewer-memory.md)）の既存集計の変更。
- 配信タイトルの自動取得。⚠ 取れるなら取ってよいが、**新規 API 呼び出しが増えるなら
  [062b](062b-stream-session-recording.md) で判断**（手入力でも要望は満たせる）。

## 実装後に必要なレビュー

- [062a](062a-twitch-raid-ingestion.md) / [062b](062b-stream-session-recording.md): **security-review 必須**
  （[`security-review`](../../.claude/skills/security-review/SKILL.md)）。§9 保存データ種別の変更・受信面の拡張。
- [062c](062c-stream-summary-view.md) / [062d](062d-stream-history-filter.md): **軽レビュー**。
  ⚠ ただし [062d](062d-stream-history-filter.md) は**動的 SQL を書きたくなる**ので、
  「識別子はコンパイル時定数のみ・値はパラメータバインド」（§8）だけは必ず確認する。
