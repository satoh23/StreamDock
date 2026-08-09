# 061b 組み込み投げ銭エフェクト＋発火層（多重発火抑制）

> 状態: **未着手（実装サブタスク）**。分割・線引きは親 [061](061-obs-effects.md) を正とする。
>
> ## ⚠⚠ 仕様変更（2026-08-09・依頼者決定）——**エフェクト窓は sidecar の WS に直接つなぐ**
>
> **変更前**: `sidecar ──WS──▶ コメビュ窓 ──localStorage + storage──▶ エフェクト窓`
> **変更後**: `sidecar ──WS──▶ コメビュ窓` と `sidecar ──WS──▶ エフェクト窓` の**2 本に分ける**
>
> **動機**（依頼者）: エフェクト機能が**内蔵コメビュ窓に依存している**状態を解消したい。
>
> ⚠ 当初は「OBS 側のコメント一覧から取る」案が出たが、**技術的に不可能**と確認して却下した:
> obs-websocket 5 のプロトコルに**チャット取得のリクエストが 1 つも無い**（Scenes / Inputs / SceneItems /
> Outputs / Stream / Record / Filters / Transitions / Ui のみ）。OBS の「チャット」ドックは Twitch/YouTube の
> チャットページを出す**ブラウザパネル**で、外から中身を読む口が無い。読むには第三者ページへ JS を注入して
> DOM を掻くことになり、**親 061 の「第三者コードを実行しない」と正面から衝突**するうえ、依存先が
> OBS ではなく Twitch/YouTube の HTML に移るだけで壊れやすくなる。
>
> **採った案の利点**:
> - ⚠⚠ **これは新方式ではない。** コメントオーバーレイ窓（`OverlayApp`）が**既に同じことをしている**
>   （`connectCommentStream` で sidecar の loopback WS を直接張る）。WS が 2 本 → 3 本になるだけで、
>   既存構造の踏襲であって発明ではない。
> - ⚠ **061a のレビューで積み残した最大の技術リスク（`storage` の窓跨ぎ伝播が実機で届くか）が丸ごと消える。**
> - 新規宛先ゼロを維持（既存の loopback WS のまま）。
>
> **代償**: 下記「(0) sidecar ライフサイクルの切り離し」が必須になり、**Rust に触る＝ 061b は
> 「frontend のみ・Rust/sidecar 差分ゼロ」ではなくなった**。レビュー区分も**軽レビュー →
> security-review 必須**へ格上げする（§6 のプロセス停止設計に触るため）。
>
> ⚠ **達成できることの正確な範囲**（過大に書かないこと）:
> - ✅ **一度コメント取得を開始すれば、コメビュ窓を閉じてもエフェクトは出続ける**。
> - ❌ **「コメビュ窓を一度も開かずにエフェクトを出す」は本タスクでは達成しない。**
>   外部通信（Twitch/YouTube への接続）は `start-session` フレームでのみ始まり、
>   **その導線は `CommentViewerApp` の「コメント取得開始」ボタンにしかない**。
>   これを main 窓へ出すかは別タスク（下記「このタスクでやらないこと」）。
>
> **必読前提**: 親 [061](061-obs-effects.md)、**器 [061a](061a-effect-overlay-window.md)（`effect-overlay` 窓の正）**、
> **WS を直接張る先例 [`OverlayApp.tsx`](../../apps/desktop/src/screens/comment-viewer/OverlayApp.tsx)**、
> **sidecar のライフサイクル [`lib.rs`](../../apps/desktop/src-tauri/src/lib.rs)（`open_comment_viewer_window` の
> `ensure_started` と窓 close の `shutdown`）／[`comment_sidecar/mod.rs`](../../apps/desktop/src-tauri/src/comment_sidecar/mod.rs)**、
> 課金判定 [`viewerFormat.ts`](../../apps/desktop/src/screens/comment-viewer/viewerFormat.ts)（`isMonetaryEvent` / `displayEventType` / `composeEventMessage` / `monetaryTone`）、
> ティア配色 [`monetaryTone.ts`](../../apps/desktop/src/screens/comment-viewer/monetaryTone.ts)、
> 差分検出 [`mergeComments.ts`](../../apps/desktop/src/features/comment-viewer/mergeComments.ts)（`{ next, added, updated }`）、
> **Jewels combo 再送 [043e](043e-youtube-jewels-combo-fidelity.md)**、
> Twitch コミュニティギフトの二重計上 [043a](043a-monetary-ingestion-fidelity.md)（**N 件で N+1 行届く**）、
> 窓間伝達の作法 [046a](046a-viewer-pin-comment.md)（localStorage ＋ `storage` イベント。⚠ **本タスクでは
> エフェクトに使わない**——上の仕様変更で WS 直結にしたため。046a/046b の既存機能の理解用として読む）、
> オーバーレイの描画作法 [`OverlayApp.tsx`](../../apps/desktop/src/screens/comment-viewer/OverlayApp.tsx) / [043c](043c-overlay-monetary-highlight.md)、
> [`docs/security.md`](../security.md)（§1／**§6 プロセス停止**／§9 追補（046a））。
> CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。
> ⚠ **security-review 必須**（2026-08-09 の仕様変更で軽レビューから格上げ）。
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
  ⚠ ただし**プラットフォーム依存でベストエフォート**で、**実機で届くかは 046a/034e から一度も検証されていない**。
  ⚠⚠ **本タスクはこの経路をエフェクトには使わない**（上の仕様変更）。使うのは既存の loopback WS。

### ⚠⚠ 仕様変更にあたっての実コード調査（2026-08-09・**ここが設計の根拠**）

- **`connectCommentStream` を呼んでいるのは 2 つだけ**＝`CommentViewerApp` と **`OverlayApp`（`comment-overlay` 窓）**。
  → **「オーバーレイ窓が sidecar の WS を直接張る」は既にこのリポジトリにある構造**で、エフェクト窓だけが例外だった。
- **`ensure_started`（sidecar 起動）の呼び出しはコード全体で 1 箇所だけ**＝`lib.rs` の
  `open_comment_viewer_window` の中。停止は**コメビュ窓の close イベント**（と アプリ終了）に紐づく。
  → ⚠⚠ **矢印を分けるだけでは足りない。** エフェクト窓が WS を張れても、
  **コメビュ窓を開いていなければ WS サーバー（sidecar）自体が存在しない。**
- ⚠ **sidecar の起動は外部通信を伴わない。** 起動時にやるのは
  ①loopback WS サーバーを立てる ②Rust が stdin へ書く復元行から keychain のトークンを**メモリへ**戻す、の 2 つで、
  `index.ts` に「**ネットワークは張らない（取得は start-session で明示）**」と明記されている。
  → **sidecar をエフェクトのために起動しても §1「明示的に有効化した時のみ接続」は破らない。**
- ⚠ **ただし `start-session`（＝実際のコメント取得＝外部通信）を送る導線は
  `CommentViewerApp` の「コメント取得開始」ボタンにしかない。**
  → 本タスクで達成できるのは「**一度開始したあと、コメビュ窓を閉じてもエフェクトが出続ける**」まで。
- ⚠ **[046a](046a-viewer-pin-comment.md) の教訓**: 固定コメントを localStorage に置いたとき、
  **`author.avatar` を保存しないと決めた**（base64 data URI の容量・`storage` ペイロード・§9）。
  結果、専用オーバーレイのアイコンは**イニシャルフォールバック**になっている。
  エフェクトでも同じ判断が要る。
- ⚠ **[046a](046a-viewer-pin-comment.md) の security-review 結果**: 第三者のコメント本文・表示名・金額を
  localStorage へ永続化するのは**保存先を問わず §9 の対象**（追補が新設された）。

## このタスクでやること

> ⚠ **(0) → (2) → (1) → (3) → (4) の順で実装する。** (0) が無いと (2) が無意味（繋ぐ先が存在しない）で、
> (1) の発火層は (2) が動いていないと実機で確認できない。
> ⚠ **(0) と (2) を先に 1 段目として仕上げ、そこで一度動作確認を挟む**こと（(1) 以降は 2 段目）。
> 分けたくなったら `061b-1`（経路）／`061b-2`（エフェクト本体）へ割ってよい。

### (0) sidecar ライフサイクルの切り離し（**新規・2026-08-09 の仕様変更で追加**）

⚠⚠ **本タスクで唯一 Rust に触る部分**であり、**security-review の主対象**。

- **いま**: `open_comment_viewer_window` が `ensure_started`、**コメビュ窓の close** が `shutdown`。
  ＝ **sidecar の生存がコメビュ窓 1 点に集約**されている。
- **これから**: 起動契機と停止条件を「**コメビュ窓 or エフェクト機能のどちらかが使っている間は生かす**」へ広げる。
  - 起動: `open_effect_overlay_window` でも `ensure_started` を呼ぶ（＝エフェクト窓が開いたら sidecar を立てる）。
  - 停止: **コメビュ窓を閉じただけでは落とさない**。「コメビュ窓が無く、かつエフェクト窓も無い」ときに落とす。
    ⚠ 判定は **Rust 側で実窓を見て行う**（`get_webview_window` の有無）。frontend の設定値を信用しない（§8）。
- ⚠⚠ **§6（プロセス停止）の設計に触る。** 現状の no-orphan 3 段 kill は「契機がコメビュ窓 1 点」を前提に
  組まれている。契機が 2 つになるので、**「どの窓も無くなったら必ず落ちる」ことを崩さない**こと。
  とくに次の 3 経路をすべて確認する:
  1. コメビュ窓 → エフェクト窓 の順で閉じる
  2. エフェクト窓 → コメビュ窓 の順で閉じる
  3. アプリ終了（`RunEvent::Exit`）。⚠ ここは**既に無条件 shutdown**なので、変更後も孤児は残らない側に倒れる
- ⚠ **§1 は破らない。** sidecar 起動は**ローカル WS サーバーを立てるだけ**で外部通信を伴わない
  （`index.ts` に「ネットワークは張らない（取得は start-session で明示）」と明記）。
  外部通信の契機は従来どおり `start-session`（＝ユーザーの「コメント取得開始」操作）のみ。
  **この論証を security.md §1 に 1 行残す**（「sidecar 起動 ≠ 外部通信」を後任が誤解しないため）。
- ⚠ **既存の挙動を変えない**こと: コメビュ窓を開く → sidecar 起動、は不変。
  変わるのは「**閉じたときに落ちるかどうか**」だけ。

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

### (2) データ経路（**2026-08-09 の仕様変更で全面差し替え**）

⚠⚠ **旧版はここが「窓間伝達（`effectQueue.ts`）＝localStorage ＋ `storage`」だった。廃止する。**

- **エフェクト窓（`EffectOverlayApp`）が sidecar の loopback WS を直接張る。**
  実装は **`OverlayApp` の写し**（`connectCommentStream` を呼び、`onComments` でコメントを受ける）。
  ⚠ 061a は「エフェクト窓は WS へ接続しない」と決めていたが、**本変更でその決定を反転する**。
  061a のコメント（`EffectOverlayApp.tsx` / `windowApi.ts` / `lib.rs` の各 JSDoc・
  `EffectOverlayApp.test.tsx` の「WS へ接続しない」ケース）を**すべて更新すること**
  ——放置すると「WS を張らないはずの窓が張っている」という嘘のコメントが残る。
- **`effectQueue.ts` は作らない。** localStorage を経由しないので、
  - ⚠ **`storage` の窓跨ぎ伝播という未検証の賭けが消える**（061a レビューの積み残し）。
  - ⚠ **第三者の表示名・金額を localStorage に置かなくて済む**＝ §9 追補（046a）の判定自体が**不要になる**
    （旧版はここを「軽レビューで判定する」としていた。**判定する対象が無くなった**）。
- ⚠⚠ **マウント時に過去のエフェクトを再生しない、という 061a への約束は引き続き守られる**——
  そもそも保存しないので**再生する対象が存在しない**（061a レビュー S-1 の懸念が構造的に消える）。
  ⚠ **`onComments` で受けた過去分を遡って発火しないこと**（接続直後に履歴が流れてくる場合に備える）。
- ⚠ **エフェクト窓は受け取ったコメントを描かない・保存しない。**
  `onComments` には第三者のコメント本文が流れてくるが、**エフェクトに使うのは
  投稿者名・金額・種別だけ**（下記 `EffectRequest`）。本文は (1) の発火層で捨てる。
  - ⚠ **`recordComments` 等の DB 経路へ流さない**（046a と同じ規律）。
  - ⚠ **ログに出さない**（§9）。
- ⚠ **sidecar が居ないときは静かに何もしない。** (0) で起動契機を広げるが、
  「エフェクト窓だけ開いていて `start-session` がまだ」の状態は正常で、そのときは**接続待ちのまま 0 件**
  （`OverlayApp` と同じ挙動）。**エラー表示も再試行ループも増やさない。**

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
- ⚠ `effectQueue.test.ts` は**作らない**（`effectQueue.ts` ごと廃止したため）。
- `EffectOverlayApp` のテスト: 描画内容・表示時間・**本文が出ないこと**。
  ⚠ **061a のテストを書き換える**: 「WS へ接続しない」ケースは**逆の仕様になった**ので、
  「**WS へ接続する**（`connectCommentStream` を 1 回呼ぶ）」＋「**受け取った本文を描かない・保存しない**」へ差し替える。
  ⚠ 後者を落とすと、§9 の担保が「実装がそうなっている」だけになる（テストで固定すること）。
- ⚠ **(0) の Rust 側**: 「どの窓も無くなったら sidecar が落ちる」を固定する。
  実窓を見る判定なので単体テストは難しい——**`lib.rs` の契約テスト（`include_str!` の先例）で
  「`shutdown` が窓の存在確認を経てから呼ばれる」形を固定**し、実挙動は実機 3 経路（下記）で確認する。
- **ミューテーションで実効性を確認**する。最低限、`updated` を発火対象に含めたときと、
  gift の畳み込みを外したときと、**エフェクト窓の close で無条件 shutdown させたとき**にレッドになること。

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
- ⚠ **`start-session`（コメント取得開始）の導線を main 窓／`ObsEffectsScreen` に置くこと。**
  これを入れれば「コメビュ窓を一度も開かずにエフェクト」まで到達するが、**外部通信の開始ボタンを
  増やす**話なので §1 の例外範囲（「内蔵コメントビューアの…明示接続した時のみ」）の読み直しが要る。
  **別タスクとして起票する**（本タスクは「一度開始したら閉じても出続ける」まで）。
- ⚠ **外部コメビュ（わんコメ等）からの取り込み。** 第三者ソフトへの依存と新規宛先が増えるので範囲外。
- ⚠ **OBS からのコメント取得。** 上の仕様変更節のとおり**技術的に不可能**（obs-websocket にチャット API が無い）。

## セキュリティ制約（docs/security.md 準拠）

> ⚠⚠ **2026-08-09 の仕様変更でここが最も変わった。** 旧版は「frontend のみ・Rust/sidecar 差分ゼロ」
> だったが、(0) で **Rust（sidecar のライフサイクル）に触る**ため成立しなくなった。

- **新規宛先ゼロ**（§1）。**新規 WS プロトコルも Tauri イベントも増やさない**——
  エフェクト窓が張るのは**既存の loopback WS**（`ws://127.0.0.1:<port>`）で、`OverlayApp` が既に使っている経路そのもの。
- ⚠ **§1 の論証を必ず残す**: **sidecar の起動は外部通信を伴わない**（ローカル WS サーバー＋keychain からの
  メモリ復元だけ。`index.ts` に「ネットワークは張らない（取得は start-session で明示）」と明記）。
  外部通信の契機は従来どおり **`start-session`＝ユーザーの明示操作のみ**。
  → **§1 の例外範囲は広がらない**。この 1 行を [`docs/security.md`](../security.md) §1 に追記する。
- ⚠⚠ **§6（プロセス停止）に触る**: sidecar の停止契機が「コメビュ窓の close」1 点から
  「コメビュ窓もエフェクト窓も無くなったとき」へ変わる。**孤児プロセスを残さない**ことを崩さない
  （実機 3 経路で確認・下記「確認コマンド」）。**この変更を §6 に追記する。**
- ⚠ **§9 追補（046a）の判定は不要になった。** 旧版は「第三者の表示名・金額を localStorage に置くので
  追補の対象か軽レビューで判定する」としていたが、**localStorage を経由しなくなったので置く対象が無い**。
  ⚠ 代わりに「**エフェクト窓が `onComments` で第三者のコメント本文を受け取るが、描かない・保存しない・
  ログに出さない**」ことを担保する（`OverlayApp` と同じ立場になる）。
- **配信画面に第三者の自由入力（コメント本文）を大写しにしない。**
- **`recordComments` 等の DB 経路へ流さない**（046a と同じ規律）。
- ログに投稿者名・金額を出さない（§9）。
- ⚠ **capabilities / `tauri.conf.json` / 依存は差分ゼロを維持**（`csp: null` 不変）。
  Rust の差分は **`ensure_started` / `shutdown` の呼び出し条件だけ**に閉じ、**新 command を足さない**
  （061a の 3 本＋既存で足りる）。sidecar（`apps/comment-sidecar/`）は**差分ゼロ**。
- 生 hex を書かない（トークンのみ）。

## 完了条件

**1 段目（(0) + (2)＝経路）**

- ⚠⚠ **コメビュ窓を閉じてもエフェクト窓へコメントが届き続ける**（＝本仕様変更の目的そのもの）。
- ⚠ **どの窓も無くなれば sidecar が確実に落ちる**（孤児プロセスを残さない・実機 3 経路で確認）。
- 既存挙動が不変: コメビュ窓を開く → sidecar 起動／`comment-overlay` 窓の WS は無改変。
- ⚠ **061a の「WS を張らない」という記述が、コメント・テストとも 1 つ残らず更新されている**
  （嘘のコメントを残さない）。

**2 段目（(1) + (3) + (4)＝エフェクト本体）**

- 課金コメントが届くとエフェクト窓に「〇〇さんが ¥1,000」が出て、数秒で消える。
- **Jewels の combo 更新では出ない。**
- **Twitch のコミュニティギフト N 件で N+1 回出ない**（同一投稿者ぶんが畳まれる）。
- **バースト上限**が効き、大量の課金が来てもエフェクトが出続けない。
- **コメント本文とアバターがエフェクトに出ない**（テストで固定）。
- ⚠ **接続直後に過去分を遡って発火しない。**
- 金額の色が[043c](043c-overlay-monetary-highlight.md)（コメント欄のカード）と**一致する**。
- テスト発火ボタンで OBS のセットアップができる。

**共通**

- 新規テストが通り、**ミューテーションで実効性を確認**している。
- ⚠ **capabilities / `tauri.conf.json` / 依存 / `apps/comment-sidecar/` は差分ゼロ**・`csp: null` 不変・生 hex ゼロ。
  **Rust の差分は `ensure_started` / `shutdown` の呼び出し条件だけ**（新 command ゼロ）。
- ⚠ **[`docs/security.md`](../security.md) の §1（sidecar 起動 ≠ 外部通信）と §6（停止契機が 2 つになった）を更新**。
- `pnpm --filter ./apps/desktop typecheck` / `lint` / `test` / `cargo test` が通る。
  [`docs/progress.md`](../progress.md) を更新。

## 確認コマンド

```bash
git diff --stat
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
pnpm --filter ./apps/desktop test   # check:css（生 hex / トークン規約）も含む
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml   # (0) で Rust を触るので必須

# ⚠ ゼロ拡大の担保（差分ゼロが期待）——**Rust 全体ではなくなった点に注意**
git status --short -- apps/comment-sidecar/ .github/
git status --short -- apps/desktop/src-tauri/capabilities/ apps/desktop/src-tauri/tauri.conf.json
# Rust の差分が ensure_started / shutdown の呼び出し条件だけに閉じているか（新 command ゼロ）
git diff -- apps/desktop/src-tauri/src/lib.rs
grep -n "generate_handler" -A 30 apps/desktop/src-tauri/src/lib.rs   # 登録リストが 061a のままか

# 新規依存ゼロの担保（差分ゼロが期待）
git status --short -- apps/desktop/package.json pnpm-lock.yaml package.json apps/desktop/src-tauri/Cargo.toml apps/desktop/src-tauri/Cargo.lock

# エフェクト窓が WS を張るようになったこと（呼び出しが 2 → 3 箇所へ）
grep -rn "connectCommentStream" apps/desktop/src
# 061a の「WS を張らない」という記述が残っていないこと（**残っていたら嘘のコメント**）
grep -rn "WS へ.*接続しない\|WS へは一切接続しない" apps/desktop/src apps/desktop/src-tauri/src

pnpm --filter ./apps/desktop tauri dev
# --- 1 段目（経路・(0)+(2)）---
# ⓪-1 コメビュ窓 → エフェクト窓 の順で閉じる → sidecar が落ちる（孤児が残らない）
# ⓪-2 エフェクト窓 → コメビュ窓 の順で閉じる → sidecar が落ちる
# ⓪-3 アプリ終了 → sidecar が落ちる
# ⓪-4 ⚠⚠ **コメント取得開始 → コメビュ窓だけ閉じる → エフェクト窓にコメントが届き続ける**（本仕様変更の目的）
# ⓪-5 エフェクト窓だけ開いた状態（start-session 前）でエラー表示も再試行ループも出ない
# --- 2 段目（エフェクト本体）---
# ① テスト発火ボタン → エフェクト窓に「〇〇さんが ¥1,000」が出て数秒で消える
# ② dev-mock でスパチャ → 実データでも出る／金額の色がコメント欄のカードと一致する
# ③ dev-mock の Jewels combo（同一 id 再送）では出ない
# ④ コミュニティギフト（N+1 件）で 1 回しか出ない
# ⑤ 大量の課金を一気に流してもエフェクトが出続けない（バースト上限）
# ⑥ サブスク/メンシプ（金額なし）で「〇〇さんが…しました」が出る
# ⑦ OBS 側で実際にエフェクトが合成されて映る
# ⑧ ⚠ エフェクト窓を開いた直後に、過去のコメントで一斉発火しない
```

## 実装後に必要なレビュー

⚠⚠ **2026-08-09 の仕様変更で「軽レビュー」→「security-review 必須」へ格上げした。**
理由＝(0) が **sidecar のプロセスライフサイクル（§6）と外部通信の起動条件（§1）に触る**ため。
旧版が軽レビューで済む前提だったのは「frontend のみ・Rust 差分ゼロ」だったからで、その前提は失効した。

- **security-review**（[`security-review`](../../.claude/skills/security-review/SKILL.md)）＋ 品質レビュー。
- ⚠ 次は必ず判定する:
  - ⚠⚠ **孤児プロセスが残る経路が無いこと**（§6）。停止契機が 2 つになったので、
    「どちらの窓を先に閉じても」「アプリ終了でも」sidecar が確実に落ちること。
  - ⚠ **§1 の例外範囲が広がっていないこと**——sidecar 起動が外部通信を伴わず、
    外部通信の契機が `start-session`（ユーザーの明示操作）のままであること。
  - **エフェクト窓が受け取ったコメント本文を、描かない・保存しない・ログに出さない**こと（§9）。
    ⚠ 061a では「そもそも WS を張らない」ことが担保だったが、**その担保は本タスクで失われる**。
  - **`EffectRequest` に本文・アバターが含まれていない**こと。
  - **多重発火の 3 経路**（combo 再送・コミュニティギフト N+1・バースト）がすべて塞がれていること。
  - **capabilities / `tauri.conf.json` / 依存 / sidecar が差分ゼロ**で、Rust の差分が
    `ensure_started` / `shutdown` の呼び出し条件だけに閉じていること（新 command ゼロ）。
  - ⚠ **061a の「WS を張らない」という記述がコード・テスト・docs に残っていないこと**。
