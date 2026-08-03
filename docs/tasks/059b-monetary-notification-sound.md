# 059b 投げ銭通知音（コメント音とは別音）

> 状態: **未着手（実装サブタスク）**。分割・線引きは親 [059](059-notification-sounds.md) を正とする。
>
> ⚠ **2026-08-03: 再生層が変わる（[058s](058s-audio-output-device-spike.md) の結論＝②-軽）。**
> 通知音は **Rust（`rodio`）で鳴らし出力デバイスを指定する**（Web Audio の「専用 `AudioContext`」前提は差し替え）。
> 詳細は 058s の「スパイク結果」節と親 059 の申し送りを正とする。
>
> **必読前提**: 親 [059](059-notification-sounds.md)、**基盤 [059a](059a-comment-notification-sound.md)（`notificationSound.ts` / `soundPrefs.ts` の正）**、
> 課金判定 [`viewerFormat.ts`](../../apps/desktop/src/screens/comment-viewer/viewerFormat.ts)（`isMonetaryEvent` / `MONETARY_EVENT_TYPES` / `displayEventType`）、
> 課金の扱いの先例 [043b](043b-monetary-emphasis-in-viewer.md) / [049](049-monetary-event-speech.md)、
> Jewels combo 再送 [043e](043e-youtube-jewels-combo-fidelity.md)（**同一 id が更新で再送される**）、
> ルーティング [058a](058a-audio-routing-foundation.md)（「配信に載せる」を付ける場合のみ）、
> [`docs/security.md`](../security.md)（§1／§9）。
> CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。**軽レビュー**。
>
> ⚠ **行番号は書かない**（特定はシンボル名で行うこと）。
> ⚠ **着手条件＝[059a](059a-comment-notification-sound.md) 完了**。

## 目的

依頼者の要望④のうち音の部分「**課金チャットを検知したとき、コメント検知とは別の音**が鳴るようにしたい。
これも ON/OFF と配信に載せるかどうかを決められる」を実装する。

## 現在の前提（調査結果・実コード）

- **課金判定は既にある。** `isMonetaryEvent(eventType)`（[`viewerFormat.ts`](../../apps/desktop/src/screens/comment-viewer/viewerFormat.ts)）が
  `MONETARY_EVENT_TYPES`（`superchat` / `subscription` / `membership` / `gift` / `donation` / `jewels`）で判定する。
  コメビュ本体のティア色カード（[043b](043b-monetary-emphasis-in-viewer.md)）・オーバーレイ（[043c](043c-overlay-monetary-highlight.md)）・
  ティッカー（[047](047-superchat-ticker.md)）・読み上げ（[049](049-monetary-event-speech.md)）が**すべてこの 1 本**を使っている。
  → **通知音も必ずこれを使う**。判定を 2 実装に分裂させると、上流に新しい課金種別が増えたときに片方だけ更新漏れになる
  （`CommentList.tsx` の該当箇所に「追加漏れというバグを一覧だけが隠してしまう」という同型の注記がある）。
- ⚠ **`displayEventType(c)` を使うか `c.eventType` を使うかに注意**。`CommentList` は
  `displayEventType(c)` の戻り値で chat / 課金を分岐している。**表示と音で判定がずれないよう、
  表示側と同じ関数を使うこと。**
- ⚠ **043e の combo 再送**: YouTube の Jewels（`GIFT_EVENT`）は**同一 id が combo 更新として再送される**。
  `mergeComments` はこれを `updated` バケットで返す（`added` には入らない）。
  → **`updated` で鳴らさない**。連続ギフト中に鳴りっぱなしになる。
- ⚠ **既知の二重計上**（043a 以前からの既存挙動）: Twitch のコミュニティギフト N 件は
  `community_sub_gift(total=N)` と個別 `sub_gift`×N の**両方**が届き、gift 行が **N+1 個**生成される。
  → **N+1 回鳴りうる**。[059a](059a-comment-notification-sound.md) のクールダウンで潰れるはずだが、
  **クールダウンに依存していることを明示しておくこと**（値を伸ばしたときに壊れないよう、テストで固定する）。
- [059a](059a-comment-notification-sound.md) の `notificationSound.ts` は**音源 ID を引数に取る形**で作られている前提
  （059a の「2 音目を足せる形にしておくこと」）。

## このタスクでやること

### (1) 2 つ目の音源を用意して同梱する

- 投げ銭用の通知音（コメント音より**明確に区別できる**もの。例＝コインの音、和音、少し長め）を用意する。
- ⚠ **ライセンスを必ず確認して記録する**（[059a](059a-comment-notification-sound.md) と同じ条件）。
  出所と条件を [`docs/progress.md`](../progress.md) に残す。
- 置き場所・形式は 059a で選んだ方式に**揃える**（base64 定数なら同じ `sounds.ts` に 2 つ目の定数を足す）。
- ⚠ **「区別できる」はテストで担保できない**。実機で連続再生して聞き分けられるかを目視（耳視）確認すること。

### (2) 課金判定と発火（`CommentViewerApp.tsx`）

- `mergeComments` の **`added`** を課金／非課金に分ける:
  - 課金が 1 件以上あれば **投げ銭音を 1 回**
  - 課金が 0 件でコメントが 1 件以上あれば **コメント音を 1 回**（[059a](059a-comment-notification-sound.md) の挙動）
- ⚠ **排他にすること**（親 059 の決定）。課金コメントが来たバッチで**両方鳴らさない**。
  両方鳴ると「別の音にした」意味が消える。
- ⚠ **`updated` では鳴らさない**（043e の combo 更新）。
- ⚠ **バッチ内の件数分は鳴らさない**（1 バッチ 1 回）。059a と同じ規律。

### (3) クールダウンの分離

- ⚠ **コメント音と投げ銭音のクールダウンは独立**にする。共有すると
  「コメントが流れている最中に来たスパチャの音が、コメント音のクールダウンで消える」＝
  **一番気づいてほしい音が鳴らない**という最悪の挙動になる。
- [059a](059a-comment-notification-sound.md) の `notificationSound.ts` が音源 ID ごとに
  最終再生時刻を持つ形にする（既にそうなっていれば変更不要）。
- 投げ銭音のクールダウン値は**コメント音より短くてよい**（投げ銭は連投されにくい）。値と理由をコメントに残す。

### (4) 設定（`soundPrefs.ts` に追加）

- `sound-monetary-enabled`（既定 **false**）— 投げ銭通知音の ON/OFF
- `sound-monetary-stream-output`（既定 **false**）— 配信に載せるか。**[058a](058a-audio-routing-foundation.md) 完了後に追加**
- 音量は [059a](059a-comment-notification-sound.md) の `sound-volume` を**共有する**
  （音ごとに音量を分けると設定項目が増えすぎる。分けたくなったら別タスク）。
  ⚠ **この判断はコメントに残す**（再修正トリガー＝「投げ銭音だけ大きくしたい」と言われたとき）。
- 設定ビューの「通知音」カードに ON/OFF トグルと試聴ボタンを 1 組追加する。
  書式は [054](054-comment-viewer-settings-readability.md) の規則どおり。

### (5) テスト

- 課金バッチで**投げ銭音だけ**鳴りコメント音が鳴らないこと（排他の固定）
- 非課金バッチで**コメント音だけ**鳴ること
- **混在バッチ**（課金 1 件＋通常 5 件）で投げ銭音のみ 1 回鳴ること
- `updated`（Jewels combo）では**どちらも鳴らない**こと
- **クールダウンが音源 ID ごとに独立**していること
  （⚠ コメント音を鳴らした直後の投げ銭音が鳴ることを 1 ケースで固定する。ここが本タスクで一番壊れやすい）
- コミュニティギフトの N+1 件がクールダウンで 1 回に潰れること
- **ミューテーションで実効性を確認**する。最低限、排他の分岐を「両方鳴らす」に変えたときと、
  クールダウンを共有に変えたときにレッドになること。

## このタスクでやらないこと

- **金額による音の出し分け**（親 059 の決定で**一律 1 種類**）。金額ティアは [061](061-obs-effects.md) の
  エフェクト側の仕事。⚠ 再修正トリガー＝「高額だけ別の音にしたい」と言われたら、
  `monetaryTone()`（既存のティア判定）を音にも使う形で拡張する。
- **視覚エフェクト**（[061](061-obs-effects.md)）。要望④の「配信にエフェクトを出す」はそちら。
- **出力デバイスの選択**（[058a](058a-audio-routing-foundation.md)）。
- 課金判定そのものの変更（`MONETARY_EVENT_TYPES` は触らない）。
- Twitch コミュニティギフトの二重計上の解消（043a から残る既存課題。ここでは**クールダウンで凌ぐ**だけ）。
- ユーザーが自分の音源ファイルを差し替える機能（将来タスク）。

## セキュリティ制約（docs/security.md 準拠）

- **外部通信ゼロ**（§1）。音源はアプリ同梱で、CDN・外部 URL を参照しない。CSP 方針不変。
- **新規依存ゼロ**。再生は既存の Web Audio API で完結する。
- 追加する localStorage キーは**ユーザー自身の UI 設定値**（bool）で、§9 追補（046a）が対象とする
  第三者の個人データではない。**投げ銭の金額・投稿者名を保存しない・ログに出さない**（音を鳴らすのに不要）。
- **Rust・sidecar・capabilities・`tauri.conf.json`・依存はすべて差分ゼロ**。`csp: null` 不変。
- 音源のライセンスを確認し、出所と条件を記録する。

## 完了条件

- 課金コメントで投げ銭音が鳴り、通常コメントではコメント音が鳴る。**混在バッチでは投げ銭音だけ**鳴る。
- コメント音と投げ銭音の**クールダウンが独立**していて、コメントが流れている最中のスパチャでも必ず鳴る。
- `updated`（Jewels combo）では鳴らない。
- 設定ビューで投げ銭音の ON/OFF と試聴ができる。既定は OFF。
- **2 つの音が実機で聞き分けられる**（耳で確認）。
- 音源のライセンスが確認され [`docs/progress.md`](../progress.md) に記録されている。
- 新規テストが通り、**ミューテーションで実効性を確認**している。
- **Rust / sidecar / capabilities / `tauri.conf.json` / 依存は差分ゼロ**・新規 capability ゼロ・`csp: null` 不変。
- `pnpm --filter ./apps/desktop typecheck` / `lint` / `test` が通る。[`docs/progress.md`](../progress.md) を更新。

## 確認コマンド

```bash
git diff --stat
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
pnpm --filter ./apps/desktop test

# ゼロ拡大の担保（差分ゼロが期待）
git status --short -- apps/desktop/src-tauri/ apps/comment-sidecar/ .github/
# 新規依存ゼロの担保（差分ゼロが期待）
git status --short -- apps/desktop/package.json pnpm-lock.yaml package.json

pnpm --filter ./apps/desktop tauri dev
# ① 通知音カードに投げ銭音の ON/OFF と試聴が並ぶ／2 音を続けて試聴して聞き分けられる
# ② dev-mock でスパチャを流す → 投げ銭音が鳴り、コメント音は鳴らない
# ③ 通常コメントを流し続けている最中にスパチャを差し込む → **必ず投げ銭音が鳴る**（クールダウン独立の確認）
# ④ dev-mock の Jewels combo（同一 id 再送）では鳴らない
# ⑤ Twitch のコミュニティギフト（N+1 件）で鳴りっぱなしにならない
```

## 実装後に必要なレビュー

- **軽レビュー**（[`code-review-light`](../../.claude/skills/code-review-light/SKILL.md)）。
  frontend のみ・新規通信ゼロ・新規依存ゼロのため。
- ⚠ ただし**音源のライセンス確認**はレビューの外で必ず行うこと。
