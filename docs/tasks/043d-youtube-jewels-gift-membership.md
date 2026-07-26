# 043d YouTube ギフトメンシプ／Jewels の取得（受信面拡張）

> 状態: **保留（2026-07-26）**。解除条件(b)用の**生 gRPC キャプチャ足場は実装済み（dev 専用・env ゲート・未マージ・
> ブランチ `043d-grpc-capture-spike`）**だが、**実配信キャプチャ本番が未実施＝フィールド番号 未確定**のため proto/DTO/mapper は
> 未着手。**中断理由**: キャプチャ対象に予定していた協力配信者が **Jewels を終了**したため、投げ銭キャプチャで番号確定を進められなくなった
> （下記「## 保留の経緯（2026-07-26）」「## 実装済み足場（2026-07-26・解除条件(b)用・dev 専用・未マージ）」を参照）。
> proto 拡張＝新規受信面のため、実配線に着手する際は **security-review 必須**。分割・線引きは親 [043](043-monetary-emphasis.md) を正とする。
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

## 保留の経緯（2026-07-26）

- 解除条件(a)（osareview 上流 proto に gift/jewel メッセージ＋番号）は **無い**ことを確認済み（repo に `.proto` 実ファイル無し・
  逐語コピー元が存在しない）。よって残る道は **(b) 実配信の生 gRPC キャプチャで番号を確定**のみ。
- (b) の進め方として「**収益化済みの協力配信者の公開配信に投げ銭し、その生バイトを取得して番号を逆算**する」方針を採った
  （自チャンネルが未収益化で gift/jewels を発火させられないため）。この経路を実現する **dev 専用キャプチャ足場を実装済み**（下記）。
- **中断理由**: 予定していた協力配信者が **Jewels を終了**したため、Jewels の実配信キャプチャができなくなった。gift membership も
  同様に「メンバーシップ有効な協力配信者へのギフト購入」が要り、現時点で対象が確保できていない。**番号を確定できないため保留**。
- **再開の解除条件（いずれか）**:
  1. **Jewels 有効な縦型（モバイル）ライブを出せる協力配信者**を確保 → そこへ Jewels を送ってキャプチャ（giftEvent の番号確定）。
  2. **メンバーシップ有効な協力配信者**を確保 → そこへギフトメンバーシップを購入してキャプチャ（membershipGifting/giftMembershipReceived の番号確定）。
  3. **自チャンネルが収益化（メンバーシップ／Jewels 有効）**され、自配信で発火させてキャプチャできる状態になる。
  4. osareview 上流 proto が更新され、該当メッセージ＋番号が入手できる（＝解除条件(a) が満たされる）。
  - gift と Jewels は**別々に確定してよい**（片方だけ番号が取れたら、その分だけ先行して 043d 本体を進めることも可）。

## 実装済み足場（2026-07-26・解除条件(b)用の生 gRPC キャプチャ・dev 専用・未マージ）

> 実配線（proto/DTO/mapper）ではなく、**番号を実測するための dev 専用ツール**。番号確定後に本足場は撤去する前提。
> **実装コードは git stash に退避**（`git stash list` の「043d gRPC capture scaffold」エントリ・ブランチ
> `043d-grpc-capture-spike` 上で作成・**未マージ・未コミット**）。復元は `git stash apply`（下記「再開手順」）。詳細記録は
> [`docs/progress.md`](../progress.md) の「2026-07-26 (043d 解除条件(b)用: gRPC 生バイト キャプチャ足場…)」節。

**なぜ足場が要るか**: gift/jewels の gRPC 内部フィールド番号は非公開で、protobuf デコーダは**未知フィールドを黙って捨てる**
（`$unknownFields` 無し）。よって復号**前**の生バイトを保存し、後段で `protoc --decode_raw` 相当にかけて field 番号を読むしかない。

**2 つの能力（どちらも env ゲート `COMMENT_SIDECAR_CAPTURE=1`・既定 OFF＝本番は byte 同一）**:
1. **生バイト捕捉**: gRPC の `responseDeserialize`（proto-loader）を **`loadSync` ラップで差し替え**、復号前の生バイトを
   0700 一時ファイル `streamdock-yt-capture-*/frames.b64`（base64・1 frame/line・**`appendFileSync` 同期＝kill でも直前
   フレーム残存**）へ書く。`createClient` の **gRPC チャネルガードは温存**（loadSync のみ差替え）。
2. **他人の公開配信を対象化**: `COMMENT_SIDECAR_CAPTURE_VIDEO_ID=<動画ID>` 指定時、`live-stream.client.ts` が既存
   `findLiveDetails`（`videos.list?id=`）で公開配信の `activeLiveChatId` を解決して読む。未指定は現行 `findActiveOwnBroadcast`
   と**完全同一**。他人の**公開**チャット読取は `youtube.readonly` の範囲・宛先は `www.googleapis.com` のまま。

**対象ファイル**:
- 新規 `apps/comment-sidecar/src/youtube-capture.ts`（env ゲート＋dump＋runtime ラップ・副作用ゼロ・dev-mock と同契約）。
- 変更 `apps/comment-sidecar/src/comment-fetcher/register-youtube-deps.ts`（capture ON 時のみ wrap 注入・OFF は素の guarded runtime）。
- 変更 `apps/comment-sidecar/src/index.ts`（稼働バナー）。
- 変更 `apps/comment-sidecar/vendor/comment-fetcher/src/adapters/youtube/client/live-stream.client.ts`（env ゲートの videoId seam）。
- dev スクリプト（**バンドル非同梱**）: `scripts/protobuf-raw.mjs`（protoc 非依存の生ワイヤデコーダ）／`scripts/decode-capture.mjs`
  （frames.b64→field 番号ツリー・既知番号の参照ヘッダ付き）／`scripts/test-capture.mjs`（厳密テスト 45 件）／`scripts/dist-alias-loader.mjs`（テスト用）。

**セキュリティ（枠を広げない）**: **新規宛先/OAuth スコープ/依存ゼロ**（`host-guard.ts`/`youtube-config.ts`/`package.json`/Rust/binding/
capability すべて差分なし・build:bundle 禁止依存アサート通過）。§9: 生バイト（本文/投稿者名含み得る）は 0700 一時ファイルのみ・
非永続・端末外へ出さない・通常ログ/DB 非保存。※proto は未拡張（番号未記入）＝本足場での security-review は不要と判断（実配線＝
043d 本体着手時に実施）。

**テスト**: `node scripts/test-capture.mjs`（45 件 PASS）＝実 @grpc/proto-loader 経由で「タップ実発火・生バイト完全一致（未知フィールド
込み）・同期書込・復号は未知フィールドを消す・生デコーダが未知/既知番号を ground truth 一致で報告・ガード温存・タップ0件は throw・
videoId seam のルーティング（本番不変）」を検証。host-guard 回帰・typecheck・build:bundle も通過。

**再開手順（新しいキャプチャ機会が得られたら）**:
1. 実装を復元: `git stash list` で「043d gRPC capture scaffold」を確認 → `git stash apply <該当>`（ブランチ `043d-grpc-capture-spike` 上で退避）。
2. sidecar を再ビルド（capture コードは SEA に焼き込む）: `TWITCH_CLIENT_ID=… YOUTUBE_CLIENT_ID=… YOUTUBE_CLIENT_SECRET=… pnpm --filter @stream-dock/comment-sidecar build:sea`。
3. `COMMENT_SIDECAR_CAPTURE=1 COMMENT_SIDECAR_CAPTURE_VIDEO_ID=<協力者の公開動画ID> pnpm --filter ./apps/desktop tauri dev` で起動しアプリで YouTube 接続。
4. **デリスク**: まず**通常チャット**が `frames.b64` に溜まるか確認（読めれば gift/jewels も同経路で来る見込み）。溜まらなければ投げ銭前に中止。
5. gift membership／Jewels を実送信（各 1 件・最小額）→ `node apps/comment-sidecar/scripts/decode-capture.mjs <frames.b64>` で
   既知番号に無い `type` 整数／`details` message 番号を確定。
6. 確定番号を出典明記で proto に記入＋DTO＋mapper（**受領側 N 件の二重計上回避方針**を決める）を**変更計画**として提示 →「実装して」で本実装
   （**新規受信面＝security-review 必須**）→ 本足場は撤去。
