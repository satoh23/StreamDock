# 061b 組み込み投げ銭エフェクト＋発火層（多重発火抑制）

> 状態: **✅ 061b-1（経路）／061b-2（エフェクト本体）とも実装済み（2026-08-09）**。
> **実機確認は sidecar の生死 6 項目を実装者が自動操作で実測して成立**（⚠ **エフェクトの描画とテスト発火の
> `storage` 伝播だけ目視が残っている**）。
> ⚠ **security-review は 2 回実施済み**（061b-1 に対する 1 回目・061b-1/061b-2 通しの 2 回目。
> どちらも判定「修正必須」で**対応済み**）。指摘と対応は [`docs/progress.md`](../progress.md) の
> 「061b security-review②」節が正。
> 判断の根拠と実測値は [`docs/progress.md`](../progress.md) の **061b-1 / 061b-2 節**が正。
> 分割・線引きは親 [061](061-obs-effects.md) を正とする。
>
> ## ⚠⚠ 本ファイルの誤りで、実装時に訂正したもの（**字面どおり実装すると壊れる**）
>
> 1. **(1) の課金判定式 `isMonetaryEvent(displayEventType(c))` は誤り。** これだと**ビッツで出ない**——
>    `displayEventType` は superchat＋`currency:"BITS"` を `"bits"` へ振り替えるが、**`"bits"` は
>    `MONETARY_EVENT_TYPES` に無い**（あの Set は「ビッツは superchat に含まれる」前提＝**生の
>    `eventType` に適用する述語**）。**正は `isMonetaryEvent(c.eventType)`**。059b が通知音で
>    まったく同じ誤りを踏んで訂正済み。⚠ 回帰テスト（「ビッツで出る」）を置いてある。
> 2. **(1) の置き場所 `features/comment-viewer/effectTrigger.ts` は採らなかった。**
>    そこへ置くと**リポジトリ初の `features/` → `screens/` import（層の逆転）**になる
>    （課金判定・文言・配色はすべて `screens/comment-viewer/viewerFormat.ts` にあるため）。
>    **実装は `screens/obs-effects/effectTrigger.ts`**。
> 3. **(0) の「起動: `open_effect_overlay_window` でも `ensure_started` を呼ぶ」は採らなかった**（穴 C・依頼者決定）。
> 4. **(1) の「バッチ内で畳む／1 バッチ最大 N 件」は実データで一度も発動しない**（穴 H）。時間窓へ変更。
>
> ## ⚠⚠ 着手時に判明した「本ファイルに書かれていなかった穴」と、その結論（2026-08-09）
>
> **⚠⚠ 穴 H（最重要・下記 (1) の仕様を無効化していた）— バッチ単位の抑制は実データで一度も発動しない**
> sidecar は `comments.append` を **1 件ずつ** broadcast し（`index.ts` の `outputComments`）、
> frontend も `commentStream.ts` で `handlers.onComments([comment])` と**常に長さ 1** で渡す。
> ＝下記 (1) の「同一投稿者の gift を**バッチ内で** 1 件へ畳む」「**1 バッチから**最大 N 件」は
> **常に「1 件のバッチ」に適用されるので何も抑制しない**。Twitch のコミュニティギフト N+1 は
> **N+1 個の別バッチ**として届くため、バッチ内畳み込みでは 1 件も減らない。
> → **決定（依頼者）＝畳み込みとバースト上限は「時間窓を持つ状態」で行う。**
> `decideEffects(added, updated, state, now)` の形にし、`now` は引数注入（純関数のままテストできる）。
>
> **⚠⚠ 穴 A — テスト発火ボタンの経路が消えていた**
> WS 直結にしたことで **main 窓 → エフェクト窓の伝達手段が 1 本も無くなった**
> （061a 申し送りの「テスト発火ボタンは main 窓に置ける（**localStorage へ書くだけなので**）」は
> 旧設計を前提にした文で、取り消し線が入っていなかった）。
> → **決定（依頼者）＝テスト発火専用の localStorage キーを 1 本だけ持つ。値は nonce のみ**
> （「いま出せ」という合図だけ。エフェクトの中身はエフェクト窓側の固定ダミー定数から作る）。
> ＝ **第三者データは 1 バイトも載らない**ので §9 追補（046a）の対象外。`effectQueue.ts` とは別物。
>
> **⚠⚠ 穴 B — `CloseRequested` の時点では自窓がまだ生きている**（Tauri のソースで確定）
> `tauri-runtime-wry` の `on_close_requested()` は **①per-window ハンドラ → ②`RunEvent::WindowEvent`
> → ③実際の窓破棄**の順なので、**ハンドラ実行中は `get_webview_window(自分)` が `Some`**。
> 逆に `Destroyed` は **①`RunEvent::WindowEvent`（この中で `AppManager::on_window_close` が map から削除）
> → ②per-window ハンドラ**の順なので `None`。
> → **決定＝両イベントで判定しつつ、自窓をラベルで除外する**（どちらの順序でも同じ結果になる）。
> **⚠⚠ 穴 B″ — `app.exit(0)` では窓イベントが 1 つも配送されない**（`ControlFlow::Exit` →
> `Event::LoopDestroyed` だけ）。＝**アプリ終了経路の担保は `RunEvent::Exit` の無条件 shutdown だけ**。
>
> **⚠⚠ 穴 C — 起動時に無操作で sidecar が起動する**（`restoreEffectOverlayWindow` はアプリ起動で走る）
> → **決定（依頼者）＝`open_effect_overlay_window` に `ensure_started` を足さない**（本ファイル (0) からの
> **意図的な逸脱**）。理由: 仕様変更の目的「一度開始すればコメビュ窓を閉じてもエフェクトが出続ける」は
> **停止条件だけ広げれば 100% 達成**し、起動側を足して買えるのは「コメビュ窓を一度も開かずに sidecar 起動」だけ。
> だが `start-session` の導線がコメビュ窓にしかない以上コメントは 1 件も来ない＝**機能的な利得ゼロ**。
> 一方コストは「アプリ起動時に keychain 復元が `WINDOW_OPEN_LOCK` 保持下で走る」（未署名 dev の macOS は
> 確認ダイアログ待ちがあり得る）。**結果として Rust の差分は `shutdown` の呼び出し条件だけになり、
> §1 は差分ゼロで済む**（起動契機が変わらないので論証すら要らない）。
> ⚠ 代償＝sidecar 未起動の間、エフェクト窓が毎秒 `get_comment_stream_port` を invoke し続ける（**穴 I**）。
> ~~`comment-overlay` 窓が既に同じ性質を持つので新規の性質ではない~~
> → ⚠⚠ **061b-1 レビュー（S-4）でこの受容根拠は不正確と判明。** `comment-overlay` はコメビュ窓からしか開けず
> 起動時復元も無いので、実際には sidecar が動いている間しか存在しない。対して**エフェクト窓は永続設定で
> アプリ起動時に自動復元される唯一の WS 窓**なので、「sidecar 未起動のまま回り続ける」が**既定状態**になる。
> ＝**性質は同じだが定常状態が新しい。** それでも受容は維持する（1 回の実体が `state.lock()` して
> `Option<u16>` を読むだけの Rust command で、新規の外部通信でも OS 操作でもない）。
> 再修正トリガー＝実配信で CPU / IPC が問題化したら、`connectCommentStream` に
> 「ポート未確定時だけ指数バックオフ（上限 15 秒程度）」を入れる（`OverlayApp` にも同時に効く）。
>
> **⚠ 穴 D — 「`OverlayApp` の写し」と「保存しない」は両立しない**
> `OverlayApp` は `mergeComments` のために本文込み最大 200 件を state に持つ。
> → **決定＝`mergeComments` を使わず、上限付きの既知 id 集合だけを持つ**（061b-2）。
> ①本文が state に 1 件も残らない ②043e の combo 再送が**構造的に**発火しない（同一 id は既知）。
> ⚠ 親 061 の「判定を 2 実装に分けない」とは抵触しない——共有し続けるのは
> `isMonetaryEvent` / `displayEventType` / `composeEventMessage` / `monetaryTone` / `commentAmount` / `eventLabel`
> ＝**課金判定・文言・配色**であって差分検出ではない（差分検出は既に `mergeComments` と `mergeMonetary` の 2 実装がある）。
>
> **⚠ 穴 F — 「コメビュ窓が閉じているとエフェクトは出ない」が偽になった**（`ObsEffectsScreen` の
> 「（エフェクトも表示されません）」は嘘）。→ **061b-1 で案内文を修正済み**（回帰テスト 2 件で固定）。
> **残るねじれ＝エフェクトは出るが OBS への自動追加はコメビュ窓が要る**（`obs-enable` の送出が
> `CommentViewerApp` のままのため）。**所有者を移すのは別タスク**（`obsState` の受け皿がコメビュ窓にあり、
> 移すと結果表示が完全に消える＝061a の宿題 (A)(B)(C) と同じ根）。
>
> **⚠ 穴 G — `ObsEffectsScreen` の「main 窓から WS を張らない理由」①②③がエフェクト窓に当たる**
> → **061b-1 で JSDoc を修正済み**。理由③（毎秒 invoke ＋ 第三者本文の流入）は**エフェクト窓では受容**し、
> **main 窓では受容しない**（あちらは特権 UI＝OBS パスワード入力・視聴者メモリ削除・テーマの既定復帰がある）。
>
> ## ✅ 061b-1（経路）の実装結果（2026-08-09）
>
> - **Rust の差分は `shutdown` の呼び出し条件だけ**（`ensure_started` は 1 バイトも触っていない・新 command ゼロ）。
>   `SIDECAR_CONSUMER_LABELS` / `is_last_sidecar_consumer`（純関数）/ `shutdown_sidecar_if_last_consumer`。
> - `EffectOverlayApp` が `connectCommentStream` を 1 本張る（`onComments` のみ）。
>   **061b-1 の時点では受け取ったコメントを捨てる**（発火層と描画は 061b-2）。
> - テスト: Rust **269 → 280**（`mod sidecar_lifecycle` 6 件＋`mod sidecar_lifecycle_contract` 5 件）、
>   frontend **1298 → 1306**。
> - ⚠⚠ **061b-1 の security-review（2026-08-09・外部レビュー・判定「修正必須」）で、この行に書いていた
>   「ミューテーション 5 件すべて KILLED」が過大な主張だと判明した。** 自分で立てた 5 件はいずれも
>   「自分のガードの主張を裏返す変異」で、レビュー側の独自ミューテーション**9 件中 6 件が生存**していた:
>   Rust 側 4 件（**ラベル入れ替え／`CloseRequested` を落とす／`RunEvent::Exit` を `match` で条件化／
>   ガードの `is_open` を `&& false` で骨抜き**）、frontend 側 2 件（**`console.log` で本文を出す／
>   受信を state に置く**）。**件数ではなく「何を固定できていないか」を書くこと**（061a レビューの
>   同種の指摘が再発していた）。
> - ✅ **レビュー対応後**: 上記のうち **8 件が KILLED**。残る 1 件＝「描かずに `useState` へ置くだけ」は
>   外から観測できないため**意図的に未固定**（`EffectOverlayApp.tsx` の JSDoc に明記。061b-2 では
>   `EffectRequest` に `text` / `avatar` を持たせない型の側で構造的に守る）。
>   テストは cargo **280**（件数据え置き・検査の中身を強化）／ frontend **1306 → 1309**。
> - `docs/security.md`: 061a 節の 2 箇条書きを訂正し、S-1 の記録に 1 文追記、
>   「レビュー必須条件」の `process停止処理` に下位条件を 1 つ追加した（実装記録は書いていない）。
>   ⚠⚠ **当初「§1 は差分ゼロで正しい」と判断したが、レビュー（S-1）で誤りと判明した。**
>   §1 の例外は「いつ始まるか」だけでなく**「いつ終わるか」でも範囲が決まる**——061b で
>   **コメビュ窓を閉じても（エフェクト窓が生きていれば）Twitch/YouTube の取得が続く**ようになったので、
>   032c-b の例外へ「**取得の停止条件**」ブロックを追記した。**§6 本文は引き続き差分ゼロ**
>   （sidecar の停止条件は 061a 節が持つ・「レビュー必須条件」から辿れる）。
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
- **これから**: **停止条件だけ**を「**コメビュ窓 or エフェクト窓のどちらかが生きている間は生かす**」へ広げる。
  - ~~起動: `open_effect_overlay_window` でも `ensure_started` を呼ぶ~~
    → ⚠⚠ **依頼者決定で採らなかった（穴 C）。起動契機は `open_comment_viewer_window` の 1 箇所のまま。**
    理由は冒頭の穴 C を参照（機能的な利得ゼロ／アプリ起動時の無操作 keychain 復元を新設しない／
    結果として Rust の差分が `shutdown` の呼び出し条件だけに閉じ、§1 が差分ゼロで済む）。
  - 停止: **コメビュ窓を閉じただけでは落とさない**。「コメビュ窓が無く、かつエフェクト窓も無い」ときに落とす。
    ⚠ 判定は **Rust 側で実窓を見て行う**（`get_webview_window` の有無）。frontend の設定値を信用しない（§8）。
    ⚠⚠ **`CloseRequested` と `Destroyed` の両方で判定し、自窓はラベルで除外する**（穴 B）。
    ⚠⚠ **`RunEvent::Exit` の無条件 shutdown は絶対に条件付きにしない**（穴 B″＝アプリ終了経路では
    窓イベントが 1 つも配送されないので、あれが唯一の担保）。
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

⚠⚠ **穴 H により「バッチ内」という条件は使えない**（sidecar は 1 件ずつ送るので `added` は常に長さ 1）。
畳み込みもバースト上限も**時間窓を持つ状態**で行う。状態と `now` は**引数で受け取る**（純関数のままにする）。

- `decideEffects(added: CommentViewDto[], updated: CommentViewDto[], state: EffectTriggerState, now: number): EffectRequest[]`
  - **`updated` からは何も出さない**（[043e](043e-youtube-jewels-combo-fidelity.md) の combo 再送）
    ⚠ 呼び出し側（エフェクト窓）は既知 id を除いた配列を `added` に・`[]` を `updated` に渡すので**二重に守る**。
  - `added` のうち `isMonetaryEvent(displayEventType(c))` が真のものだけ拾う
  - ⚠ **コミュニティギフトの N+1 を畳む**: **`GIFT_FOLD_WINDOW_MS`（既定 5 秒）以内**に
    `eventType === "gift"` かつ**同じ投稿者**のものが来たら 1 件にまとめる。
    ⚠ **`community_sub_gift`（total=N）と個別 `sub_gift` は wire 上で区別できない**（両方 `gift`）ので、
    「同一投稿者の gift は時間窓内で 1 件」という近似で畳む。**この近似はコメントに明記する**
    （⚠ 副作用＝**同一人物の本物の 2 件目のギフトも窓内なら畳まれる**。
    再修正トリガー＝上流で `community_gift_id` による dedup が入ったら不要になる）。
  - ⚠ **バースト上限**: **`EFFECT_BURST_WINDOW_MS`（既定 5 秒）に最大 `EFFECT_BURST_MAX`（既定 3）件**。
    残りは捨てる（キューに溜めない）。溜めると数分後にエフェクトが出続ける。
    ⚠ **バースト窓を表示時間（`EFFECT_DISPLAY_MS`＝5 秒）と同値にしてある**——こうすると
    「**画面上の同時表示数 ≤ 3**」が構造的に保証され、別々の値にして片方だけ調整して破る事故が起きない。
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
