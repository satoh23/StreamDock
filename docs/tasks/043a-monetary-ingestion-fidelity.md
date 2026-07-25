# 043a 投げ銭イベントの取得精緻化（メンシプ／ギフトの種別分離）

> 状態: **未着手（実装サブタスク）**。分割・線引きは親 [043](043-monetary-emphasis.md) を正とする。
>
> **必読前提**: 親 [043](043-monetary-emphasis.md)、[`docs/security.md`](../security.md)（§1 allow-list／二層 fail-closed／§9 非ログ・非外部送信／「コメントビューア方針」⑪ 集計）、
> ワイヤ契約 [`model.rs`](../../apps/desktop/src-tauri/src/comment_viewer/model.rs)（ts-rs の正）・[`wire.ts`](../../apps/comment-sidecar/src/wire.ts)、視聴者メモリ集計 [`viewer_memory/repository.rs`](../../apps/desktop/src-tauri/src/viewer_memory/repository.rs)。
> CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。**ワイヤ契約＋Rust モデル（＋波及すれば保存集計）の変更のため security-review 必須**。

## 目的

「お金がかかるコメント」を配信者が種別ごとに把握できるよう、**現状すべて `subscription` に潰れているメンシプ／ギフトを種別として分離**する（要望⑤・網羅重視）。
可能な範囲でギフト件数/受贈者・メンバー月数・サブスク階級も拾い、表示（043b/043c）が種別・金額を正しく出せる語彙を整える。**受信済みフィールドの取り回しのみ**で、新規の外部通信・宛先・OAuth スコープは増やさない。

## 現在の前提（調査結果・実コード）

- **wire → Rust の種別語彙**: [`wire.ts`](../../apps/comment-sidecar/src/wire.ts) の `CanonicalComment`（27-38 行）と `EVENT_TYPE_MAP`（40-47 行）＝ `normal→chat` / `super_chat→superchat` / `subscription→subscription` のみ。`membership` は Rust enum [`CommentEventType`](../../apps/desktop/src-tauri/src/comment_viewer/model.rs)（41-46 行）・TS binding にあるが**発行経路が無い**。
- **sidecar 内の種別（shared）**: `apps/comment-sidecar/vendor/shared/src/comment/comment-types.ts`（3 行）は `"normal" | "super_chat" | "subscription"` の 3 値のみ（メンシプ/ビッツ専用型なし）。ドメイン `Comment` は `apps/comment-sidecar/vendor/comment-fetcher/src/entities/comment/comment.ts`（4-21 行・`eventType`＋`monetaryAmount?: {currency, amount}`）。
- **YouTube マッパ**: `apps/comment-sidecar/vendor/comment-fetcher/src/adapters/youtube/mapper/comment.mapper.ts`（12-21 行）。`SUPER_CHAT_EVENT`/`SUPER_STICKER_EVENT`→super_chat、`NEW_SPONSOR_EVENT`/`MEMBER_MILESTONE_CHAT_EVENT`→subscription。`member_milestone_chat_details.member_month` は DTO（`.../youtube/dto/raw.dto.ts` 106-109 行）にあるが**未マップ**。
- **Twitch マッパ**: `apps/comment-sidecar/vendor/comment-fetcher/src/adapters/twitch/mapper/comment.mapper.ts`（16-22・45-62・76-99 行）。cheer→super_chat＋`currency="BITS"`、notification の `notice_type`∈`sub`/`resub`/`sub_gift`/`community_sub_gift`/`pay_it_forward`→subscription。ギフト受贈者/件数/階級は DTO（`.../twitch/dto/raw.dto.ts` 156-182 行）にあるが**未マップ**。
- **保存集計**: [`viewer_memory/repository.rs`](../../apps/desktop/src-tauri/src/viewer_memory/repository.rs)（200-216 行）は `currency='BITS'`／`event_type='superchat'`／`event_type='subscription'` で集計。種別語彙が増えたら整合が要る。
- **通信面**: 上記は sidecar が既存の EventSub（Twitch）／Data API v3 gRPC（YouTube）で**既に受信しているフィールド**。宛先・二層 fail-closed（env ピン留め＋ホスト/gRPC ガード）は本タスクで**変えない**。

## このタスクでやること

### (1) 種別語彙の拡張（sidecar → wire → Rust の一貫）

- **メンシプを分離**: YouTube `NEW_SPONSOR_EVENT`/`MEMBER_MILESTONE_CHAT_EVENT` を `subscription` ではなく **`membership`** として発行する（Rust enum に既存の `Membership` を実際に使う）。`member_month` を拾えるなら wire に載せる（例 `monthCount`）。
- **ギフトを区別**: Twitch `sub_gift`/`community_sub_gift`（＋YouTube のギフトメンシプがあれば）を、`subscription` と区別できる形にする。方式は実装時に確定するが 2 案:
  - (A) `CommentEventType` に **`gift`** を追加（enum＝ts-rs 正 [`model.rs`](../../apps/desktop/src-tauri/src/comment_viewer/model.rs) 41-46 行を拡張し binding 再生成）。
  - (B) `subscription` のまま**サブ情報**（`isGift`/受贈者/件数/階級）を wire の付随フィールドで持つ。
  - どちらでも 043b/043c が「ギフト」を判別・表示できることを要件とする（親 043 と整合）。
- shared の 3 値種別（`comment-types.ts`）と各マッパ・`EVENT_TYPE_MAP`（`wire.ts` 40-47 行）を、上記の新語彙に合わせて拡張する。ビッツは従来どおり `superchat`＋`currency="BITS"`（別種別化はしない・043b で BITS 判別）か、必要なら明示種別化を実装時に判断。

### (2) 保存集計との整合（波及時のみ）

- 種別語彙拡張で [`viewer_memory/repository.rs`](../../apps/desktop/src-tauri/src/viewer_memory/repository.rs)（200-216 行）の集計クエリ（superchat/subscription/BITS の判定）が影響を受ける場合は、**メンシプ/ギフトを取りこぼさない**ようクエリを追随させる（「コメントビューア方針」⑪の集計項目変更に該当）。無影響なら触らない。

## このタスクでやらないこと

- **新規の宛先・依存の追加**（sidecar の allow-list ホスト／二層 fail-closed は不変）。※**2026-07-26 拡張**で Twitch Bits Power-ups の
  ため **OAuth スコープ `bits:read` と EventSub 購読 `channel.bits.use` を追加**（宛先は増えない・購読は非致命・再ログインで有効化＝
  security.md ①/⑦・security-review 済）。それ以外（YouTube スコープ・宛先）は不変。
- **YouTube のギフトメンシプ／Jewels（`giftEvent`）**：API には存在するが gRPC proto のフィールド番号が非公開で現状受信していない
  ＝受信には proto 拡張（新規受信面）が要るため **[043d](043d-youtube-jewels-gift-membership.md) へ**（本タスクでは発行しない）。
  ※以前「YouTube/Twitch に無い種別」と記載していたのは誤りで 2026-07-26 に訂正（存在するが未受信）。通貨換算・第三者投げ銭連携は対象外。
- 表示側（コメビュ本体＝**043b** / オーバーレイ＝**043c**）の意匠。

## セキュリティ制約（docs/security.md 準拠）

- **宛先・capability・依存を増やさない**（§1/§3/§10）。sidecar の env ピン留め・fetch/gRPC ホストガードは不変。`csp: null` 不変。
- 取得コメント本文・投げ銭金額・受贈者名を**ログに出さない・端末外へ送らない**（§9）。保存は視聴者メモリの既存範囲（端末内 SQLite）内に留める（「方針」⑪）。
- **ワイヤ契約（`model.rs`＝ts-rs 正）＋Rust モデル（＋波及すれば保存集計）の変更のため security-review 必須**（レビュー必須条件「取得コメント・視聴者情報の端末保存＝集計項目の変更」に該当し得る）。

## 完了条件

- YouTube のメンシプが `membership` として、Twitch/YouTube のギフトが（新種別 or サブ情報で）**サブスクと区別**されて wire→Rust→binding に届く。
- 種別語彙拡張後も既存の superchat/bits/subscription の取得・集計・表示が退行しない。視聴者メモリの集計がメンシプ/ギフトを取りこぼさない（波及時）。
- 新規宛先/OAuth スコープ/依存の追加が無い。`csp: null` 不変。
- `pnpm --filter ./apps/desktop typecheck` / `lint` / `cargo check` が通り、**ts-rs binding が再生成**され差分が整合。sidecar ビルドが通る。[`docs/progress.md`](../progress.md) を更新。
- **security-review を通過**している。

## 確認コマンド

```bash
git diff --stat
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
cd apps/desktop/src-tauri && cargo check   # ts-rs binding 再生成（テスト経由の生成なら該当テスト実行）
# sidecar のビルド/テスト（既存手順に従う）
pnpm --filter ./apps/desktop tauri dev     # dev-mock または実配信で membership / gift が subscription と区別されて届くことを確認
# no-internet 確認: lsof -i で外部 ESTABLISHED が sidecar PID 下のみ・宛先が既存 allow-list のみであること
```

## 実装後に必要なレビュー

- security-review: **新規宛先/OAuth スコープ/依存を増やしていない**（受信済みフィールドの分類変更のみ・env ピン留め/ホスト・gRPC ガード不変）こと、投げ銭本文/金額/受贈者名を**ログ・端末外へ出していない**こと、保存集計の変更が視聴者メモリの端末内範囲（「方針」⑪）に収まっていることを確認。
