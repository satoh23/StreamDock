# 043 お金がかかるコメントの強調＋取得精緻化（親設計）

> 状態: **未着手（親設計・線引きの正）**。実装は子タスク 043a / 043b / 043c（順序は下記）。
>
> **必読前提**: [`docs/security.md`](../security.md)（§1・§9・「## コメントビューア（配信サービス連携）方針」⑪＝視聴者メモリ保存・集計）、
> ワイヤ契約 [`model.rs`](../../apps/desktop/src-tauri/src/comment_viewer/model.rs)（`CommentEventType`/`monetary`）、[`wire.ts`](../../apps/comment-sidecar/src/wire.ts)、
> 描画 [`CommentList.tsx`](../../apps/desktop/src/screens/comment-viewer/CommentList.tsx)。**本親は保留中の [037](037-overlay-design-expansion.md) / [037b](037b-overlay-monetary-highlight-design.md)（オーバーレイ投げ銭強調）を supersede する**（下記）。
> CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。**1 作業 1 機能**。

## 目的

**お金がかかっているコメント（スパチャ・ビッツ・サブスク・メンシプ・ギフト等）を、配信者が絶対に見逃さない**ようにする。投げ銭を見逃すと
視聴者体験が著しく損なわれ配信の質が下がるため、優先度が高い（ユーザー要望④⑤・「多少無理してでも実装したい」）。3 層で対応する:

1. **取得精緻化（043a）**: sidecar/wire/Rust を拡張し、現状すべて `subscription` に潰れているメンシプ/ギフト等を**種別として区別**する。
2. **コメビュ本体の強調表示（043b）**: 受信した投げ銭系イベントを本体で枠色＋種別ラベル＋金額で強調（要望⑤）。
3. **オーバーレイの強調表示（043c）**: OBS オーバーレイでも投げ銭コメントを目立たせる（要望④・037b を現行意匠単独で実体化）。

## 現在の前提（調査結果・実コード）

- `event_type`（`chat / superchat / membership / subscription`）と `monetary { amount, currency }`／`monetary_amount`（整形済み文字列）は
  **全層に配線済み**（[`model.rs`](../../apps/desktop/src-tauri/src/comment_viewer/model.rs) `CommentEventType` 41-46 行・`CommentViewDto` 78-98 行・`CommentMonetaryDto` 108-113 行、bindings、[`wire.ts`](../../apps/comment-sidecar/src/wire.ts) 27-38 行）。
- ただしマッパの実態は集約が粗い（**要精緻化＝043a**）:
  - YouTube: `SUPER_CHAT_EVENT`→superchat（金額あり）、`SUPER_STICKER_EVENT`→superchat（区別せず）、`NEW_SPONSOR_EVENT`/`MEMBER_MILESTONE_CHAT_EVENT`→**subscription**（メンシプが sub に潰れる・`member_month` 破棄）。
  - Twitch: cheer→superchat＋`currency="BITS"`、`sub`/`resub`/`sub_gift`/`community_sub_gift`/`pay_it_forward`→**subscription**（ギフトが sub に潰れる・受贈者/件数/階級なし）。
  - `membership` は enum/wire/binding にあるが **EVENT_TYPE_MAP（`wire.ts` 40-47 行）に発行経路が無く実際には出ない**。
- コメビュ**本体**描画 [`CommentList.tsx`](../../apps/desktop/src/screens/comment-viewer/CommentList.tsx) `renderDefaultItem`（99-148 行）は **`event_type` で分岐せず**、`monetaryAmount` がある種別に小バッジ（141-143 行）を出すだけ。**金額文字列を持たないサブスク/メンシプ/ギフトは通常コメントと区別されない（要精緻化＝043b）**。
- **オーバーレイ**描画 `renderOverlayItem`（153-196 行）は `event_type`/`monetary` を一切見ない（要精緻化＝043c）。色トークンは [`OverlayComment.module.css`](../../apps/desktop/src/screens/comment-viewer/OverlayComment.module.css)／`theme.css` の `--overlay-*`。
- 視聴者メモリの集計 [`viewer_memory/repository.rs`](../../apps/desktop/src-tauri/src/viewer_memory/repository.rs)（200-216 行）は `currency='BITS'`／`event_type='superchat'`／`event_type='subscription'` で bits/superchat/subscription を数える。043a で種別語彙が増えるなら整合を取る。

## 子タスクと線引き

| 子 | 内容 | 層 | レビュー |
|---|---|---|---|
| [043a](043a-monetary-ingestion-fidelity.md) | sidecar/wire/Rust 拡張＝membership を実発行・ギフトを区別（可能なら受贈者/件数・メンバー月数・階級） | 取得層 | **security-review 必須** |
| [043b](043b-monetary-emphasis-in-viewer.md) | コメビュ本体で chat 以外の全イベントを枠色＋種別ラベル＋金額で強調 | 表示（本体） | 軽 |
| [043c](043c-overlay-monetary-highlight.md) | オーバーレイの現行意匠に投げ銭強調を相乗り（037b を supersede・037a 非依存） | 表示（オーバーレイ） | 軽 |

## 037 / 037b の扱い（supersede）

- 保留中の [037b](037b-overlay-monetary-highlight-design.md)（オーバーレイ投げ銭強調）は本親の **043c が現行意匠単独で実体化**する（037a 意匠選択機構には依存しない）。
- したがって **037b は 043c に supersede**。037a（意匠選択機構）自体は本要望の対象外で保留のまま（別途判断）。[`docs/task-board.md`](../task-board.md) の 037 行にこの統合を注記する。

## 実装順（提案）

- **043b（本体表示・見逃し解消の最短効果）→ 043a（取得精緻化・security-review）→ 043c（オーバーレイ）** を基本とする。
- 網羅を最優先するなら **043a を先行**させ種別語彙を確定してから 043b/043c で表示、も可（各子タスクに相互依存を明記）。043b/043c は 043a 未了でも現行 `event_type` で成立する（サブスク/メンシプ/ギフトは `subscription` として可視化＝まず見逃しを解消）。

## このタスク（親）でやらないこと

- 実装（各子タスク）。通貨換算・履歴集計 UI（038 視聴者メモリの領分）。
- 「ジュエル」等 **YouTube/Twitch に存在しない**マネタイズ種別（新規サービス連携＝別スコープ・対象外）。
- 037a（意匠選択機構）の復帰。

## セキュリティ制約（docs/security.md 準拠）

- 043b/043c は**表示分岐のみ**（新規通信/依存/capability ゼロ・`csp: null` 不変・`<img>`/`background-image` は data URI のみ）。
- 043a は**受信済みイベントの分類変更のみ**で新規外部通信・宛先・OAuth/スコープを増やさない。ワイヤ契約・Rust モデル・（波及すれば）保存集計の変更のため **security-review 必須**（§9 本文/金額を非ログ）。

## 完了条件（親）

- 投げ銭系（スパチャ/ビッツ/サブスク/メンシプ/ギフト）が本体・オーバーレイ双方で**一目で分かる**強調表示になる。
- 少なくともメンシプとギフトが sub と**区別**されて届く（043a）。通常チャットは従来どおり（強調なし）で表示が壊れない。
- 新規外部通信・依存・capability を増やしていない。`csp: null` 不変。037b の supersede が task-board に反映されている。

## 実装後に必要なレビュー

- 各子タスク記載のとおり（043a＝security-review 必須 / 043b・043c＝軽）。
