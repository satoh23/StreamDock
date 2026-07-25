# 043d YouTube ギフトメンシプ／Jewels の取得（受信面拡張）

> 状態: **未着手・保留（技術ブロッカーあり）**。分割・線引きは親 [043](043-monetary-emphasis.md) を正とする。
> 起票理由: [043a](043a-monetary-ingestion-fidelity.md) の網羅調査（2026-07-26）で、YouTube のギフトメンシプ／Jewels が
> **API には存在するが現状の proto/DTO では受信していない**ことが判明した。043a は「受信済みフィールドの分類のみ」のため対象外とし、
> **受信面の拡張（proto 拡張＝新規に解釈するデータ面）を伴う本タスクへ分離**する。
>
> **必読前提**: 親 [043](043-monetary-emphasis.md)、[`docs/security.md`](../security.md)（§1 allow-list／二層 fail-closed／§9 非ログ・
> 非外部送信・受贈者/贈与者名の非保持／「コメントビューア方針」⑪）、gRPC proto
> [`stream-list-proto.ts`](../../apps/comment-sidecar/vendor/comment-fetcher/src/adapters/youtube/client/stream-list-proto.ts)、
> ワイヤ契約 [`model.rs`](../../apps/desktop/src-tauri/src/comment_viewer/model.rs)・[`wire.ts`](../../apps/comment-sidecar/src/wire.ts)。
> CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。**新規受信面のため security-review 必須**。

> **注記（2026-07-26・043a 拡張時）**: 実機確認のモック用途で **`jewels` 表示種別（shared/wire/Rust/binding/label）と dev-mock の合成発行は
> 043a で先行追加済み**（`CommentEventType` に `jewels`・`EVENT_LABEL` に「ジュエル」・集計は既存に混ざらない旨のテスト付き）。
> 本タスク 043d に残るのは **実データの取得（gRPC proto 拡張＝フィールド番号確定）と mapper 配線**であり、Jewels の**表示語彙側の作業は不要**。
> ギフトメンシプ（贈与/受領）は種別（`gift`/`membership` 流用 or 新種別）・二重計上方針の決定を含め本タスクで扱う。

## 目的

「お金がかかるコメント」の網羅（親 043・要望⑤）のうち、043a で拾えなかった **YouTube の収益イベント**を取得する:

- **メンバーシップギフト（贈与側）** `membershipGiftingEvent`（`MEMBERSHIP_GIFTING_EVENT`）＝ギフト購入者。付随 `giftMembershipsCount` / `giftMembershipsLevelName`。
- **メンバーシップギフト（受領側）** `giftMembershipReceivedEvent`（`GIFT_MEMBERSHIP_RECEIVED_EVENT`）＝1 購入につき N 件発火（受領者数分）。
- **Jewels（縦型ライブのギフト）** `giftEvent`（`GIFT_EVENT`）＝`giftEventDetails.giftMetadata.jewelsAmount` 等。

## 現在の前提（2026-07-26 調査結果）

- **API 上は存在する**（公式 `liveChatMessages` の `snippet.type` に `membershipGiftingEvent` / `giftMembershipReceivedEvent` / `giftEvent` が
  列挙されている。出典: `https://developers.google.com/youtube/v3/live/docs/liveChatMessages`）。
- **が、現状受信していない**。sidecar の gRPC proto（`stream-list-proto.ts`）は osareview の `stream_list.proto` の逐語コピーで、
  上記 event 型の **enum 整数番号・詳細メッセージのフィールド番号を含まない**。REST の型名（camelCase）からは gRPC 内部の整数番号は決まらない。
- **⚠ 技術ブロッカー（本タスクが保留の理由）**: proto に書くべきフィールド番号が**非公開**（内部 gRPC スキーマ）。番号を推測して書くと、
  **無言でデコードされない（データ欠落）／別フィールドと衝突して破損**する。既存の `profile_image_url = 104`（036b）ですら proto に
  「未確定・要実配信検証」と明記されている前例がある。

## 解除条件（着手の前提）

次のいずれかで**正しいフィールド番号を確定**してから実装する:

- (a) **osareview 上流 proto に該当メッセージ（gift/jewel）があれば逐語コピー**する（既存フィールドと同じ「単一の正」運用）。
- (b) **実配信の生 gRPC を一度キャプチャ**して番号を確定する（実配信環境が前提・036b の author_details 検証と同じ進め方）。

## このタスクでやること（解除後）

1. **proto 拡張**（`stream-list-proto.ts`）: `LiveChatMessageSnippet.Type` に `MEMBERSHIP_GIFTING_EVENT`/`GIFT_MEMBERSHIP_RECEIVED_EVENT`/`GIFT_EVENT`、
   詳細メッセージ（`MembershipGiftingDetails`/`GiftMembershipReceivedDetails`/`GiftEventDetails`）と**確定したフィールド番号**を追加。
2. **DTO**（`youtube/dto/raw.dto.ts`）: 対応する details 型と `snippet` フィールドを追加。
3. **mapper**（`youtube/mapper/comment.mapper.ts`）: 贈与側→`gift`（`giftCount`＝`giftMembershipsCount`）、受領側→`membership`（1 購入 N 件の
   **二重計上を避ける**方針を決める）、Jewels→種別と金額表現（`donation` 相当 or 新種別かは実装時に確定）。
4. 波及すれば集計（`viewer_memory/repository.rs`）・語彙（shared/wire/Rust/binding）を 043a と同じ手順で整合。

## このタスクでやらないこと

- **フィールド番号を推測して proto を書くこと**（解除条件が満たされるまで着手しない）。
- 新規宛先・新規 OAuth スコープの追加（YouTube は既存 `youtube.readonly`・既存 gRPC ストリーム内。**宛先は増えない**）。
- 通貨換算・第三者投げ銭サービス連携。

## セキュリティ制約（docs/security.md 準拠）

- **新規受信面（proto で新たに解釈するデータ）**であり、贈与者/受領者の情報を含む event を扱うため **security-review 必須**。
  §9 に従い**受贈者/贈与者の個人名は wire/Rust DTO に載せない・保存しない**（数値属性・金額のみ・043a と同方針）。
- 宛先・二層 fail-closed（env ピン留め＋gRPC チャネルガード `www.googleapis.com:443` のみ）・依存は不変。

## 完了条件

- 解除条件でフィールド番号を確定し、YouTube のギフトメンシプ／Jewels が `subscription`/`membership`/`gift`/`donation` 等と区別されて
  wire→Rust→binding に届く。二重計上（受領側 N 件）の扱いが定義され集計が退行しない。
- 新規宛先/OAuth スコープ/依存ゼロ。`csp: null` 不変。`typecheck`/`lint`/`cargo check`/binding 再生成が通る。security-review 通過。

## 確認コマンド

```bash
git diff --stat
pnpm --filter @stream-dock/comment-sidecar typecheck
pnpm --filter ./apps/desktop typecheck && pnpm --filter ./apps/desktop lint
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
# 実配信で gift/jewel が種別区別されて届くこと・lsof -i で外部 ESTABLISHED が sidecar PID 下・既存 allow-list のみ
```
