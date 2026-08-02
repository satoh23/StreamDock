# 061b 組み込み投げ銭エフェクト＋発火層（多重発火抑制）

> 状態: **未着手（実装サブタスク）**。分割・線引きは親 [061](061-obs-effects.md) を正とする。
>
> **必読前提**: 親 [061](061-obs-effects.md)、**器 [061a](061a-effect-overlay-window.md)（`effect-overlay` 窓の正）**、
> 課金判定 [`viewerFormat.ts`](../../apps/desktop/src/screens/comment-viewer/viewerFormat.ts)（`isMonetaryEvent` / `displayEventType` / `composeEventMessage` / `monetaryTone`）、
> ティア配色 [`monetaryTone.ts`](../../apps/desktop/src/screens/comment-viewer/monetaryTone.ts)、
> 差分検出 [`mergeComments.ts`](../../apps/desktop/src/features/comment-viewer/mergeComments.ts)（`{ next, added, updated }`）、
> **Jewels combo 再送 [043e](043e-youtube-jewels-combo-fidelity.md)**、
> Twitch コミュニティギフトの二重計上 [043a](043a-monetary-ingestion-fidelity.md)（**N 件で N+1 行届く**）、
> 窓間伝達の作法 [046a](046a-viewer-pin-comment.md)（localStorage ＋ `storage` イベント）、
> オーバーレイの描画作法 [`OverlayApp.tsx`](../../apps/desktop/src/screens/comment-viewer/OverlayApp.tsx) / [043c](043c-overlay-monetary-highlight.md)、
> [`docs/security.md`](../security.md)（§1／§9 追補（046a））。
> CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。**軽レビュー**。
>
> ⚠ **行番号は書かない**（特定はシンボル名で行うこと）。
> ⚠ **着手条件＝[061a](061a-effect-overlay-window.md) 完了**。

## 目的

依頼者の要望④「課金チャットを検知して**配信にエフェクトが出せる**と良い。エフェクトは一旦
**『〇〇さんが〜』みたいな誰がいくら課金したとか**が出せれば良い」を実装する。

あわせて、[061c](061c-effect-template-import.md) / [061d](061d-effect-template-ui.md) と
[063](063-gacha-effect.md) が乗る**発火層**（何で発火し、何回出すかを決める 1 か所）をここで作る。

## 現在の前提（調査結果・実コード）

- **課金の判定・文言・配色はすべて既存**。
  - `isMonetaryEvent(eventType)` — `MONETARY_EVENT_TYPES`（superchat / subscription / membership / gift / donation / jewels）
  - `displayEventType(c)` — 表示上の種別（`CommentList` の分岐と同じ判定）
  - `composeEventMessage(c)` — 「〇〇さんが…しました」の組み立て（金額を持たない種別用）
  - `monetaryTone(c)` — 金額ティア／種別の配色トーン
  - **エフェクトも必ずこの 1 本を使う。** 判定を 2 実装に分けると、上流に課金種別が増えたとき片方だけ更新漏れになる
    （`CommentList.tsx` に「追加漏れというバグを一覧だけが隠してしまう」という同型の注記がある）。
- **多重発火の原因が 2 つ、既に分かっている**:
  - ⚠ **[043e](043e-youtube-jewels-combo-fidelity.md)**: YouTube Jewels は**同一 id が combo 更新として再送**される。
    `mergeComments` は `updated` バケットで返す（`added` には入らない）。
  - ⚠ **[043a](043a-monetary-ingestion-fidelity.md) の既存課題**: Twitch のコミュニティギフト N 件は
    `community_sub_gift(total=N)` と個別 `sub_gift`×N の**両方**が届き、gift 行が **N+1 個**生成される
    （dedup 未実装・043b の赤枠強調で重複が目立つと記録されている）。
- 窓間伝達は **localStorage ＋ `storage` イベント**が確立した作法（046a/046b が新規 WS も Tauri イベントも増やさずに実現）。
  ⚠ ただし**プラットフォーム依存でベストエフォート**と明記されている。
- ⚠ **[046a](046a-viewer-pin-comment.md) の教訓**: 固定コメントを localStorage に置いたとき、
  **`author.avatar` を保存しないと決めた**（base64 data URI の容量・`storage` ペイロード・§9）。
  結果、専用オーバーレイのアイコンは**イニシャルフォールバック**になっている。
  エフェクトでも同じ判断が要る。
- ⚠ **[046a](046a-viewer-pin-comment.md) の security-review 結果**: 第三者のコメント本文・表示名・金額を
  localStorage へ永続化するのは**保存先を問わず §9 の対象**（追補が新設された）。

## このタスクでやること

### (1) 発火層（新規 `effectTrigger.ts`・純関数）

`features/comment-viewer/effectTrigger.ts` を新設し、**「何で発火するか」を 1 か所に閉じる**。

- `decideEffects(added: CommentViewDto[], updated: CommentViewDto[]): EffectRequest[]`
  - **`updated` からは何も出さない**（[043e](043e-youtube-jewels-combo-fidelity.md) の combo 再送）
  - `added` のうち `isMonetaryEvent(displayEventType(c))` が真のものだけ拾う
  - ⚠ **コミュニティギフトの N+1 を畳む**: 同一バッチ内で
    `eventType === "gift"` かつ**同じ投稿者**のものは 1 件にまとめる。
    ⚠ **`community_sub_gift`（total=N）と個別 `sub_gift` は wire 上で区別できない**（両方 `gift`）ので、
    「同一投稿者の gift はバッチ内で 1 件」という近似で畳む。**この近似はコメントに明記する**
    （再修正トリガー＝上流で `community_gift_id` による dedup が入ったら不要になる）。
  - ⚠ **バースト上限**: 1 バッチから出すエフェクトは最大 N 件（例 3）に制限する。
    残りは捨てる（キューに溜めない）。溜めると数分後にエフェクトが出続ける。
    ⚠ **捨てた件数はログに出さない**（§9）が、**捨てる設計であることをコメントに残す**。
- `EffectRequest` は**エフェクトを出すのに必要な最小限**だけを持つ:
  `{ id, name, amountText, tone, eventLabel }`
  ⚠ **`CommentViewDto` をそのまま渡さない**。本文（`text`）もアバターも要らない。
  §9 の観点で「必要ないものは持ち回らない」（043a が `system_message` を持ち回らないと決めた先例と同型）。

### (2) 窓間伝達（`effectQueue.ts`）

- コメビュ窓（受信元）→ エフェクト窓（表示先）へ `EffectRequest` を渡す。
- **localStorage ＋ `storage` イベント**を使う（046a/046b の作法）。**新規 WS も Tauri イベントも増やさない。**
- ⚠ **`storage` 伝播はベストエフォート**。046b と同じ二段構えにする:
  - **保証ベースライン**＝エフェクト窓のマウント時に読む
  - **即時反映**＝`storage` 購読
  - ⚠ ただしエフェクトは**その瞬間に出ないと意味がない**（固定コメントと違い、後から読んでも遅い）。
    → **届かなかったら諦める**（マウント時の読み直しで過去のエフェクトを再生しない）。
    **これは 046b との明確な差なので、コメントに理由を残す。**
- ⚠ **保存するのは「今出すべき 1 件」だけ**（履歴を溜めない）。
  §9 追補（046a）の対象＝第三者の表示名・金額を localStorage に置くことになるので、
  **表示が終わったら消す**。**この判断を security.md §9 に追記するかは軽レビューで判断する**
  （046a は追補を新設した。エフェクトは一時的で履歴を残さないため、追補の対象になるかは要検討）。

### (3) 組み込みエフェクトの描画（`EffectOverlayApp.tsx`）

- 「**〇〇さんが ¥1,000**」を大きく出す。表示要素:
  - 投稿者名（`EffectRequest.name`）
  - 金額（`amountText`。`monetaryAmount` を verbatim 表示＝043c と同じ扱い）
  - 種別ラベル（`eventLabel`。金額を持たない種別＝サブスク/メンシプ/ギフト用）
  - 配色は `tone`（`monetaryTone` の戻り値）から引く。⚠ **[043c](043c-overlay-monetary-highlight.md) と
    同じトークンを使う**＝配信画面のコメント欄とエフェクトで**同じ額が同じ色**になる。
- **表示時間**は既定 5 秒程度（実値を定数化し理由をコメントに残す）。フェードイン/アウト。
- ⚠ **アイコンは出さない**（[046a](046a-viewer-pin-comment.md) と同じ判断＝
  base64 data URI を localStorage 経由で運ばない）。イニシャル表示にするかも実装時に決める。
- ⚠ **本文（コメント文）は出さない**。要望は「誰がいくら」なので、本文は不要
  （出すと配信画面に第三者の自由入力がそのまま大写しになる＝荒らし耐性が下がる）。
  **この判断は必ずコメントに残す**（再修正トリガー＝「メッセージも出したい」と言われたとき）。
- 生 hex を書かない（`theme.css` のトークンのみ・[`docs/security.md`](../security.md) の規約）。

### (4) 設定とテスト発火（`ObsEffectsScreen.tsx`）

- 「投げ銭でエフェクトを出す」ON/OFF（既定 **false**）。
- **テスト発火ボタン**（ダミーの `EffectRequest` を流す）。
  ⚠ **必須**。実際のスパチャを待たないと確認できないのでは、OBS のセットアップができない。
- 設定は localStorage（`stream-dock.comment-viewer.*` 名前空間・非機密の UI 値）。

### (5) テスト

- `effectTrigger.test.ts`（新規）:
  - `updated` から何も出ないこと（combo 再送）
  - 非課金コメントから出ないこと
  - **同一投稿者の gift がバッチ内で 1 件に畳まれる**こと（コミュニティギフト N+1）
  - **バースト上限**を超えた分が捨てられること
  - `EffectRequest` に**本文（`text`）とアバターが含まれない**こと
    （⚠ ここを固定しないと、後から「便利だから」で足されて §9 の判断が崩れる）
- `effectQueue.test.ts`: 表示後に localStorage から消えること・履歴が溜まらないこと
- `EffectOverlayApp` のテスト: 描画内容・表示時間・**本文が出ないこと**
- **ミューテーションで実効性を確認**する。最低限、`updated` を発火対象に含めたときと、
  gift の畳み込みを外したときにレッドになること。

## このタスクでやらないこと

- **テンプレートの取り込み**（[061c](061c-effect-template-import.md)）。本タスクは組み込み 1 種のみ。
  ⚠ ただし**発火層はテンプレートも乗る形**にしておくこと（`EffectRequest` に「どのエフェクトで出すか」の
  余地を残す）。
- **テンプレート適用 UI**（[061d](061d-effect-template-ui.md)）。
- **ガチャ**（[063](063-gacha-effect.md)）。
- **通知音**（[059b](059b-monetary-notification-sound.md)）。⚠ **音とエフェクトは独立**に発火する
  （どちらかが OFF でももう一方は動く）。
- 金額の通貨換算・合計。**verbatim 表示のみ**（043c と同じ）。
- Twitch コミュニティギフトの**上流での dedup**（043a から残る既存課題）。ここでは表示側で畳むだけ。
- エフェクトのアニメーション凝り込み（フェード程度に留める）。
- コメント本文の表示。

## セキュリティ制約（docs/security.md 準拠）

- **外部通信ゼロ**（§1）。新規宛先・新規 WS・新規 Tauri イベントを増やさない
  （窓間伝達は localStorage ＋ `storage`）。
- ⚠ **§9 追補（046a）の対象**: 第三者の**表示名・金額**を localStorage に置く。
  ただし **(a) 一時的（表示が終わったら消す）(b) 履歴を残さない (c) 本文・アバターは持たない**の 3 点で
  046a（固定コメントを永続保存）とは性質が違う。**この差を軽レビューで判定し、
  §9 への追補が要るかを決める**。
- **配信画面に第三者の自由入力（コメント本文）を大写しにしない。**
- **`recordComments` 等の DB 経路へ流さない**（046a と同じ規律）。
- ログに投稿者名・金額を出さない（§9）。
- **frontend のみ**。Rust / sidecar / capabilities / `tauri.conf.json` / 依存はすべて差分ゼロ。`csp: null` 不変。
- 生 hex を書かない（トークンのみ）。

## 完了条件

- 課金コメントが届くとエフェクト窓に「〇〇さんが ¥1,000」が出て、数秒で消える。
- **Jewels の combo 更新では出ない。**
- **Twitch のコミュニティギフト N 件で N+1 回出ない**（同一投稿者ぶんが畳まれる）。
- **バースト上限**が効き、大量の課金が来てもエフェクトが出続けない。
- **コメント本文とアバターがエフェクトに出ない**（テストで固定）。
- 金額の色が[043c](043c-overlay-monetary-highlight.md)（コメント欄のカード）と**一致する**。
- テスト発火ボタンで OBS のセットアップができる。
- 新規テストが通り、**ミューテーションで実効性を確認**している。
- **Rust / sidecar / capabilities / `tauri.conf.json` / 依存は差分ゼロ**・`csp: null` 不変・生 hex ゼロ。
- `pnpm --filter ./apps/desktop typecheck` / `lint` / `test` が通る。[`docs/progress.md`](../progress.md) を更新。

## 確認コマンド

```bash
git diff --stat
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
pnpm --filter ./apps/desktop test   # check:css（生 hex / トークン規約）も含む

# ゼロ拡大の担保（差分ゼロが期待）
git status --short -- apps/desktop/src-tauri/ apps/comment-sidecar/ .github/
# 新規依存ゼロの担保（差分ゼロが期待）
git status --short -- apps/desktop/package.json pnpm-lock.yaml package.json

pnpm --filter ./apps/desktop tauri dev
# ① テスト発火ボタン → エフェクト窓に「〇〇さんが ¥1,000」が出て数秒で消える
# ② dev-mock でスパチャ → 実データでも出る／金額の色がコメント欄のカードと一致する
# ③ dev-mock の Jewels combo（同一 id 再送）では出ない
# ④ コミュニティギフト（N+1 件）で 1 回しか出ない
# ⑤ 大量の課金を一気に流してもエフェクトが出続けない（バースト上限）
# ⑥ サブスク/メンシプ（金額なし）で「〇〇さんが…しました」が出る
# ⑦ OBS 側で実際にエフェクトが合成されて映る
```

## 実装後に必要なレビュー

- **軽レビュー**（[`code-review-light`](../../.claude/skills/code-review-light/SKILL.md)）。
- ⚠ ただし次は軽レビューでも必ず判定する:
  - **§9 追補（046a）の対象になるか**（第三者の表示名・金額を localStorage に一時的に置く件）。
    対象なら [`docs/security.md`](../security.md) §9 に 1 行追記する。
  - **`EffectRequest` に本文・アバターが含まれていない**こと。
  - **多重発火の 3 経路**（combo 再送・コミュニティギフト N+1・バースト）がすべて塞がれていること。
