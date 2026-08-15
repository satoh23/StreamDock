# 062c 配信サマリー画面（集計と表示）

> 状態: **未着手（実装サブタスク）**。分割・線引きは親 [062](062-stream-summary.md) を正とする。
> ⚠ **2026-08-16（062b 完了時）に前提を実コードで再検証して更新した。**
> 下記「⚠⚠ 前提の訂正と 062a / 062b からの申し送り」が**本文より優先**する。
>
> **必読前提**: 親 [062](062-stream-summary.md)、レイド取り込み [062a](062a-twitch-raid-ingestion.md)、
> **セッション記録 [062b](062b-stream-session-recording.md)（集計単位の正）**、
> データ層 [`viewer_memory/repository.rs`](../../apps/desktop/src-tauri/src/viewer_memory/repository.rs)（`viewer_comments` の列と `idx_viewer_comments_session`）、
> 視聴者一覧の表示作法 [038b](038b-viewer-list-detail-and-notes.md) と [`ViewersView.tsx`](../../apps/desktop/src/screens/comment-viewer/ViewersView.tsx) / [`viewerFormat.ts`](../../apps/desktop/src/screens/comment-viewer/viewerFormat.ts)、
> 既知の歪み [043a](043a-monetary-ingestion-fidelity.md)（**コミュニティギフト N+1**）/ [043e](043e-youtube-jewels-combo-fidelity.md)（**Jewels の単位未確定**）、
> 設定画面の書式規則 [054](054-comment-viewer-settings-readability.md)、
> [`docs/security.md`](../security.md)（§8／§9）。
> CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。**軽レビュー**。
>
> ⚠ **行番号は書かない**（特定はシンボル名で行うこと）。
> ⚠ **着手条件＝[062b](062b-stream-session-recording.md) 完了** → ✅ **2026-08-16 に完了**（実機確認のみ未実施）。

## ⚠⚠ 前提の訂正と 062a / 062b からの申し送り（2026-08-16・実コードで検証済み・**本文より優先**）

062b の完了時に本ファイルの前提を実コードで検証した。**誤りが 2 件、決めないと進めない論点が 2 件、
使える土台の申し送りが 5 件**あった。

### ⚠⚠ 訂正 1: `total_comments` の定義が 062a の決定と逆になっている

本文 (1) は `total_comments: i64, // event_type <> 'raid'（062a の決定に合わせる）` と書いているが、
**062a の決定は (a)＝`COUNT(*)` のままレイド行も数える**（`RECOMPUTE_VIEWER_AGGREGATES_SQL` の doc に
理由 3 点が明記されており、そのうち③は「**062c は `event_type='raid'` で直接引くので
`total_comments` の定義に依存しない**」と 062c 側の設計を前提にしている）。

⇒ **どちらを採るかを決めること**（どちらでも実装できるが、黙って食い違わせない）:

| 案 | サマリーの「総コメント数」 | 副作用 |
|---|---|---|
| **(A) 推奨: `event_type <> 'raid'`** | 「その配信で流れたコメントの数」＝画面の語感どおり | ⚠ `viewers.total_comments`（レイド込み）と**意図的に定義が違う**。完了条件の「視聴者一覧と数え方が一致する」は**課金・サブスクの分類**を指すと読み替える |
| (B) `COUNT(*)` | `viewers.total_comments` と完全一致 | ⚠ レイドが「コメント」として数えられる（レイド元は普通その配信の視聴者ではない） |

⚠ **(A) を採るなら、完了条件「視聴者一覧（038b）と数え方が一致する」の対象を明示的に狭めること。**

### ⚠⚠ 訂正 2: `donation` は既存の視聴者集計に**どこにも入っていない**（4 つ目の歪み）

本文は既知の歪みを 3 つ（コミュニティギフト N+1／Jewels 単位未確定／通貨混在）としているが、実コードには
**4 つ目**がある。`RECOMPUTE_VIEWER_AGGREGATES_SQL` は

- bits = `currency = 'BITS'`
- スパチャ = `event_type = 'superchat' AND currency IS NOT NULL AND currency <> 'BITS'`
- サブスク系 = `event_type IN ('subscription','membership','gift')`

なので、**`event_type='donation'`（Twitch charity_donation・実金銭で `amount`/`currency` を持つ）は
金額集計のどこにも入らない**（`total_comments` に入るだけ）。
`donation_is_not_counted_in_subscription_or_superchat` がこの挙動を**意図として固定している**。

⇒ **決めること**:

| 案 | 総課金額に donation を | 副作用 |
|---|---|---|
| **(A) 推奨: 含める** | 入れる | ⚠ 視聴者一覧の `superchat_amount` と数字が食い違う ⇒ **サマリー側で「スパチャ / ビッツ / ドネーション」を種別ごとにも出し**、一覧の「スパチャ額」が**スパチャだけ**の意味だと分かるようにする |
| (B) 含めない | 入れない | ⚠ **実際に投げてもらったお金が総額から消える**（要望「誰がいくらくれたか」に反する） |

⚠ どちらでも**注記が要る**（本文 (3) の注記リストに 4 つ目として足すこと）。

### ⚠ 論点 3: `monetary_by_currency` を素直に `GROUP BY currency` すると **JEWELS が実通貨として混ざる**

Jewels は `event_type='jewels'` かつ **`currency='JEWELS'`** で保存される（043e）。
本文 (1) は「`jewels_count` … 金額は合算しない」と書いているが、**除外を明示しないと
`GROUP BY currency` が `JEWELS` を 1 通貨として拾う**（＝「合算しない」が黙って破れる）。
⇒ **`monetary_by_currency` から `currency='JEWELS'` を明示的に除外し、変異テストで固定すること。**

### ⚠ 論点 4: 貢献者一覧に**レイドしかしていない配信者**が混ざる（062a の受容した副作用）

レイド元は `viewer_comments.viewer_id`（FK NOT NULL）の都合で **`viewers` に「視聴者」として行ができる**。
⇒ 貢献者一覧を `viewers` 由来で組むと**課金 0 円のレイド元**が並ぶ。
⇒ **貢献者一覧は「課金・サブスクがある人」に絞る**（レイドは専用のレイド一覧に出す）。

### 申し送り 5: 062b が用意した土台（**そのまま使える／作り直さないこと**）

- **テーブル `stream_sessions`**: `id` / `started_at` / `ended_at`（**NULL＝進行中**）/ `platforms`
  （`"twitch"` / `"youtube"` / `"twitch,youtube"` の**昇順 CSV**）/ `title`（手入力・既定空）/
  `created_at` / `updated_at`。
- **コマンドは 7 本が既にある**（062c で足す必要があるのは集計コマンドだけ）:
  `start_stream_session` / `get_active_stream_session` / `update_stream_session_platforms` /
  `end_stream_session` / **`update_stream_session_title`** / **`list_stream_sessions`** /
  `close_stale_stream_sessions`。
  ⇒ 本文 (2) の**タイトル編集は `update_stream_session_title` を呼ぶだけ**（検証は Rust 側に在る＝
  trim・制御文字拒否・`chars().count()` で 100 文字）。「やらないこと」に書かれている
  **「どのセッションを見るか」の最小限の選択も `list_stream_sessions` / `get_active_stream_session`
  で足りる**（新しいコマンドを作らない）。
- **frontend の API ラッパ**: `src/features/stream-session/streamSessionApi.ts`（型は
  `StreamSessionRecord`）。**binding は `src/features/comment-viewer/bindings/` に在る。**

### ⚠ 申し送り 6: `ended_at` は**近似**である

- ライブ終了（猶予満了）＝**猶予 30 分ぶん後ろにずれた now**。
- 閉じ忘れ回収＝**最終活動時刻**（最後のコメントの `published_at`。無ければ `started_at`）。

⇒ **配信時間を「`ended_at` − `started_at`」で出すと最大 30 分長く出る。** 期間を出すなら
「実際の尾は `published_at` の最大値」を使うか、**近似であることを画面に書く**こと。

### ⚠⚠ 申し送り 7: 「配信中」の判定に**接続状態を使わないこと**

062b で判明したとおり、**sidecar は WS が繋がるたびに `session.state = idle` を両 platform へ送る**
（スナップショットが永久に初期値のまま・`commentStream.ts` の `snapshotPending` の注記が正）。
⇒ 本文 (4) の「配信中」は **`ended_at IS NULL` だけで判定する**（接続状態から導くと、
窓を開き直した直後に「配信が終わった」と表示される）。

### 申し送り 8: **既存データが一覧に出ない旨の 1 行注記は 062c の担当**

062b の完了条件に入っていたが、**062b には一覧画面が無い**ので本タスクへ移した（本文 (3) の最終行が該当）。

### ⚠ 申し送り 9: 新規 binding の置き場所と `check:bindings`

`check:bindings` は**ハードコードされた 6 ディレクトリしか見ない**（実在は 7 で
`src/features/rakuraku/bindings` が漏れている）。⇒ `StreamSummary` 等を**新しいディレクトリへ出すと
生成漏れがあってもチェックが緑になる**。**既に checked なディレクトリへ出すか、列挙に足すこと。**
⚠ さらに**新規 binding ファイルは未追跡なので、`git add` するまで `git diff --exit-code` が見に行かない**。

## 目的

依頼者の要望⑤の本体を実装する。1 回の配信について次を出す。

- **総コメント数**
- **総課金額**（⚠ 通貨ごと）
- **総課金回数**
- **サブスク件数**
- **誰が課金チャットやサブスクをしてくれたか**（⚠ **マスト**）
- **誰がレイドしてくれたか**（Twitch のみ・[062a](062a-twitch-raid-ingestion.md)・⚠ **マスト**）

## 現在の前提（調査結果・実コード）

- 集計元は `viewer_comments`。⚠ **現在の列は次のとおり**（062a で `raid_viewer_count` が増えた）:
  `id` / `viewer_id` / `session_id` / `source` / `text` / `event_type` / `amount` / `currency` /
  `monetary_amount` / **`raid_viewer_count`** / `published_at` / `created_at`。
  `idx_viewer_comments_session` が効く。
- ⚠ **`event_type` の全種別**（Rust の `CommentEventType`・DB には小文字で入る）:
  `chat` / `superchat` / `membership` / `subscription` / `gift` / `donation` / `jewels` / `raid`。
  ⚠ **ビッツは `event_type='superchat'` ＋ `currency='BITS'` で届く**（専用種別は無い）。
- **配信セッションのメタ情報は `stream_sessions`**（062b）。**`viewer_comments.session_id` に FK は無い**
  （緩い関連＝アプリ側で突き合わせる）。⚠ 062b 以前の `session_id` には**対応行が存在しない**。
- `viewers` は**視聴者単位の累計**（配信単位ではない）。⚠ **サマリーで `viewers` の列を使わない**
  （`superchat_amount` 等は全期間の累計で、この配信のぶんではない）。
- 既存の集計 SQL（`RECOMPUTE_VIEWER_AGGREGATES_SQL`）が種別をどう数えているかが**意味論の手本**:
  - bits = `currency = 'BITS'`
  - スパチャ = `event_type = 'superchat' AND currency IS NOT NULL AND currency <> 'BITS'`
  - サブスク系 = `event_type IN ('subscription', 'membership', 'gift')`
  ⚠ **サマリーもこの分類に揃える**（画面ごとに違う数え方をすると、視聴者一覧と数字が合わなくなる）。
- ⚠ **既知の歪み 4 つ**（1〜3 は親 062 に詳細・**4 は 062b 完了時に実コードで見つけた**）:
  1. **Twitch コミュニティギフトの N+1**（`subscription_count` が水増しされる）
  2. **YouTube Jewels の単位未確定**（単価か累計か不明）
  3. **通貨が混在**（`superchat_amount` は通貨を問わず合計する `REAL`）
  4. ⚠⚠ **`donation`（Twitch チャリティ）が既存の金額集計にどこにも入っていない**
     （`superchat_*` にも `bits_*` にも入らず、`total_comments` に数えられるだけ。
     `donation_is_not_counted_in_subscription_or_superchat` が意図として固定している）＝**訂正 2**
- 表示の文言整形は [`viewerFormat.ts`](../../apps/desktop/src/screens/comment-viewer/viewerFormat.ts) に既にある
  （`eventLabel` / `composeEventMessage` / `fmtSuperchat` / `fmtNumber` / `fmtDateTime` /
  `providerLabel` / `commentAmount`）。**再利用する**（金額は verbatim 表示・換算しない）。
  ⚠ `MONETARY_EVENT_TYPES`（frontend・`superchat`/`subscription`/`membership`/`gift`/`donation`/`jewels`）は
  **「赤枠強調の対象」であって集計の分類ではない**（`donation` も `jewels` も入っている）。
  **集計の手本は Rust の `RECOMPUTE_VIEWER_AGGREGATES_SQL` のほう**——混同しないこと。

## このタスクでやること

### (1) 集計クエリ（Rust `stream_summary` モジュール）

- `src-tauri/src/stream_summary/`（`commands.rs` / `service.rs` / `repository.rs` / `model.rs`）を新設。
  ⚠ `viewer_memory` に足さない（責務が違う＝あちらは視聴者単位の累計、こちらは配信単位の集計）。
- `get_stream_summary(session_id) -> StreamSummary`:

```
StreamSummary {
  session: StreamSessionRecord,    // ⚠ 062b の既存型（binding は comment-viewer/bindings/ に在る）
  total_comments: i64,             // ⚠⚠ 訂正 1: 定義を決めること（推奨 (A) = event_type <> 'raid'。
                                   //    062a の決定は COUNT(*) なので viewers.total_comments とは
                                   //    意図的に食い違う。黙って揃えない・黙って食い違わせない）
  monetary_total_count: i64,       // 課金イベントの回数
  monetary_by_currency: Vec<{ currency: String, amount: f64, count: i64 }>,  // ⚠ 通貨ごと
                                   // ⚠⚠ 論点 3: currency='JEWELS' を**明示的に除外**する
                                   //    （素の GROUP BY だと JEWELS が 1 通貨として混ざる）
                                   // ⚠⚠ 訂正 2: donation を含めるか決めること（推奨＝含める）
  jewels_count: i64,               // ⚠ 金額は合算しない（単位未確定）
  subscription_count: i64,         // event_type IN ('subscription','membership','gift')
  contributors: Vec<Contributor>,  // 誰がいくら（マスト）
  raids: Vec<RaidRecord>,          // 誰がレイドしたか（Twitch のみ・マスト）
}
```

- `Contributor` = `{ viewer_id, name, source, monetary_by_currency, subscription_count, first_at }`
  ⚠ **「誰がいくら」がマスト要件**なので、ここが画面の主役。金額降順で並べる。
  ⚠⚠ **論点 4: 課金・サブスクがある人だけに絞る**（レイド元も `viewers` に行ができるため、
  絞らないと**課金 0 円のレイド元配信者**が貢献者一覧に並ぶ）。
- `RaidRecord` = `{ name, viewer_count, at }`
  ⚠ 出所は **`viewer_comments` の `event_type='raid'` 行**（`raid_viewer_count` は 062a で
  `ViewerCommentRecord` の binding まで通してある）。`viewers` 側の集計には**入っていない**。
- ⚠ **識別子（テーブル名・ORDER BY 句）はコンパイル時定数のみ、値はパラメータバインド**（§8・
  `viewer_memory/repository.rs` 冒頭の規律）。`session_id` は必ずバインドする。
- ⚠ **`monetary_by_currency` の `BITS` は別扱い**にする（実通貨と混ぜない）。
  既存 SQL が `currency = 'BITS'` を分けているのと同じ理由。

### (2) サマリー画面

- 置き場所を決める。候補:
  - (a) コメビュ窓の 4 つ目のビュー（現在 `"comment" | "settings" | "viewers"`）
  - (b) main 窓の新しい `Screen`
  - **推奨は (a)**。配信終わりに見るもので、コメビュ窓に視聴者一覧（`viewers`）が既にあり、
    **貢献者一覧から視聴者詳細へ繋げられる**（038b の導線を再利用できる）。
  - ⚠ **決めた理由をコメントに残すこと。**
- 表示構成:
  - **上部**: 配信の期間（`started_at` 〜 `ended_at`）・プラットフォーム・タイトル（編集可）
    ⚠ **`ended_at` は近似**（申し送り 6）。配信時間として引き算すると**最大 30 分長く出る**。
    ⚠ `platforms` は**昇順 CSV の文字列**（`"twitch,youtube"`）ではなく **binding 上は `string[]`**。
    ⚠ タイトル編集は **既存の `update_stream_session_title` を呼ぶだけ**（検証は Rust 側に在る）。
  - **数字のタイル**: 総コメント数 / 総課金回数 / サブスク件数 / 通貨ごとの総額
  - **貢献者一覧**（マスト）: 名前・サイト・金額（通貨ごと）・サブスク回数。金額降順。
    行クリックで視聴者詳細（[038b](038b-viewer-list-detail-and-notes.md) の導線を再利用）
  - **レイド一覧**（マスト・Twitch のみ）: レイド元・人数・時刻
- ⚠ **YouTube 接続時にレイド欄をどう出すか**を決める。
  **推奨＝「Twitch のみ」と明記して常に出す**（欄ごと消すと「機能が無い」と誤解される）。
  [040](040-lurker-list.md) が「Twitch 限定・YouTube は対象外」を明示している先例と同型。

### (3) ⚠ 既知の歪みを注記する（隠さない）

親 062 の決定どおり、**数字の限界を画面に出す**。

- **サブスク件数の下**に注記: 「Twitch のコミュニティギフトは、件数が多めに出ることがあります」
  （[043a](043a-monetary-ingestion-fidelity.md) の N+1）
- **Jewels は件数のみ**表示し、総課金額に**合算しない**。注記: 「Jewels は金額の単位が確定していないため、
  回数のみ表示しています」（[043e](043e-youtube-jewels-combo-fidelity.md) フェーズ 2 未了）
- **通貨は混ぜない**。「JPY 12,340 / BITS 500」のように並べる。換算しない旨を注記。
- ⚠⚠ **4 つ目の注記（訂正 2）**: `donation`（Twitch チャリティ）を総課金額に**含めた場合**は
  「視聴者一覧の『スパチャ額』はスパチャだけの金額です」、**含めない場合**は
  「チャリティのドネーションは総額に含まれていません」と出す。**どちらでも黙らせない。**
- ⚠ **これらの注記を消さない**。数字が売りの機能で、限界を隠すと配信者が誤った数字を信じる。
  **テストで注記の存在を固定する**（054 の E2E 追補②で「文言を消した結果、担保が失われた」経緯がある）。
- ⚠ **[062b](062b-stream-session-recording.md) 実装前のデータは一覧に出ない**旨も 1 行出す。
  ⚠⚠ **これは 062b からの正式な引き継ぎ**（062b の完了条件に入っていたが、あちらには一覧画面が無い＝
  申し送り 8）。`stream_sessions` に行が無い過去の `session_id` は**永久に一覧へ出てこない**
  （バックフィルしない＝セッションを捏造しないという 062b の決定）。

### (4) 進行中セッションの扱い

- `ended_at` が NULL のセッションも見られるようにする（配信中に途中経過を見たい）。
- ⚠ ただし**「配信中」と明示する**（数字が確定していないことが分かるように）。
- ⚠⚠ **判定は `ended_at IS NULL` だけで行う。接続状態（`session.state`）から導かないこと**（申し送り 7）。
  sidecar は WS が繋がるたびに嘘の `idle` を送るので、**窓を開き直した直後に「配信が終わった」と出る**。
- 進行中セッションの取得は既存の **`get_active_stream_session`** を使う（新しい経路を作らない）。

### (5) テスト

- Rust `repository.rs` の集計テスト:
  - 通貨が混在するデータで `monetary_by_currency` が正しく分かれること（**JPY と USD と BITS**）
  - ⚠⚠ **`JEWELS` が `monetary_by_currency` に現れないこと**（論点 3・素の `GROUP BY` だと混ざる）
  - `jewels` が総課金額に**合算されない**こと
  - `raid` が `subscription_count` / 金額集計に**入らない**こと
    ⚠ `total_comments` は**訂正 1 で決めた定義**をテスト名に書くこと（`<> 'raid'` なら「レイドは
    総コメント数に入らない」、`COUNT(*)` なら「レイドも数える＝`viewers` と一致する」）
  - ⚠⚠ **`donation` の扱い（訂正 2 の決定）を固定する**こと（含める／含めない のどちらでも、
    「意図してそうしている」ことがテスト名から読めること）
  - ⚠ **貢献者一覧にレイドしかしていない視聴者が出ないこと**（論点 4）
  - 貢献者が金額降順に並ぶこと
  - 別セッションのデータが混ざらないこと（`session_id` のバインド）
  - ⚠ **既存 SQL（`RECOMPUTE_VIEWER_AGGREGATES_SQL`）と分類が一致する**こと
    （同じデータで視聴者一覧とサマリーの数え方がずれないこと）。
    ⚠⚠ **ただし一致させる対象は「bits / スパチャ / サブスク系の分類」であって、
    `total_comments` の定義と donation の扱いは訂正 1・2 で意図的に分かれうる**。
- frontend:
  - 貢献者一覧・レイド一覧が出ること
  - **4 つの注記＋「既存データは出ない」の 1 行が出ること**（消えたら落ちるテスト）
  - 進行中セッションに「配信中」が出ること
  - レイド欄が YouTube 単独でも「Twitch のみ」と出ること
- **ミューテーションで実効性を確認**する。最低限、`jewels` を合算する変異と、
  通貨で分けない変異でレッドになること。

## このタスクでやらないこと

- **フィルタ・履歴一覧**（[062d](062d-stream-history-filter.md)）。本タスクは**1 セッションの詳細**まで。
  ⚠ ただし「どのセッションを見るか」の最小限の選択（直近の配信を開く程度）は要る。
- **コミュニティギフトの N+1 の解消**（上流の課題・注記するのみ）。
- **Jewels の単位確定**（[043e](043e-youtube-jewels-combo-fidelity.md) フェーズ 2・実データ待ち）。
- **通貨換算**（外部レート＝§1 違反 / 固定レート＝すぐ古くなる）。
- **CSV / JSON エクスポート**。
- グラフ・チャート（数字と一覧まで）。
- 視聴者メモリ（`viewers`）の既存集計・表示の変更。
- 配信ごとの比較（前回比など）。

## セキュリティ制約（docs/security.md 準拠）

- **外部通信ゼロ**（§1）。集計は端末内 SQLite で完結する。
- **識別子はコンパイル時定数のみ・値はパラメータバインド**（§8）。`session_id` は必ずバインドする。
- **§9 で新しい保存はしない**（既存データを読んで集計するだけ）。
  ⚠ **集計結果をキャッシュテーブルに保存しない**（保存すると §9 の判断がやり直しになる。
  `idx_viewer_comments_session` が効くので都度計算で足りる）。
- ログに視聴者名・金額・レイド元を出さない（§9）。
- **capability を増やさない**・`csp: null` 不変・**新規依存ゼロ**・生 hex ゼロ（トークンのみ）。

## 完了条件

- 1 回の配信について、総コメント数・**通貨ごとの総課金額**・総課金回数・サブスク件数が出る。
- **貢献者一覧（誰がいくら・誰がサブスク）が金額降順で出る**（マスト）。
- **レイド一覧（誰が何人連れてきたか）が出る**（マスト・Twitch のみと明記）。
- **既知の歪みの注記が出ている**（⚠ **3 つではなく 4 つ**＝コミュニティギフト N+1／Jewels の単位／
  通貨混在／**donation の扱い**〔訂正 2〕。テストで固定）。
- **Jewels が総課金額に合算されていない**（⚠ `monetary_by_currency` に `JEWELS` が現れないこと＝論点 3）。
- **視聴者一覧（038b）と `bits` / スパチャ / サブスク系の分類が一致する**
  （⚠ `total_comments` の定義と donation の扱いは訂正 1・2 の決定に従う＝**意図的に分かれうる**）。
- **貢献者一覧にレイドしかしていない配信者が並んでいない**（論点 4）。
- 進行中セッションが「配信中」と分かる（⚠ **判定は `ended_at IS NULL`**・接続状態を使わない）。
- **[062b](062b-stream-session-recording.md) 以前のデータが一覧に出ない旨の注記が出ている**（申し送り 8）。
- ts-rs binding が生成され `pnpm check:bindings` が通る
  （⚠ **既に checked なディレクトリへ出すか列挙に足す**＋**新規ファイルは `git add` するまで
  チェックが見に行かない**＝申し送り 9）。
- Rust / frontend のテストが通り、**ミューテーションで実効性を確認**している。
- **capability 追加ゼロ・`tauri.conf.json` 差分ゼロ・`csp: null` 不変・新規依存ゼロ・生 hex ゼロ。**
- `pnpm --filter ./apps/desktop typecheck` / `lint` / `test` / `cargo check` / `cargo test` が通る。
  [`docs/progress.md`](../progress.md) を更新。

## 確認コマンド

```bash
git diff --stat
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
pnpm --filter ./apps/desktop test   # check:css も含む
pnpm --filter ./apps/desktop check:bindings
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml

# ゼロ拡大の担保（差分ゼロが期待）
git status --short -- apps/desktop/src-tauri/capabilities/ apps/desktop/src-tauri/tauri.conf.json .github/ apps/comment-sidecar/
# 新規依存ゼロの担保（差分ゼロが期待）
git status --short -- apps/desktop/package.json pnpm-lock.yaml package.json apps/desktop/src-tauri/Cargo.toml
# ⚠ 申し送り 9: 新規 binding が本当にチェック対象か（列挙に入っていること）
grep -n "check:bindings" apps/desktop/package.json
git status --short -- apps/desktop/src/features/    # 未追跡の binding が残っていないこと

# ⚠ 062b の実機確認と同じく COMMENT_SIDECAR_MOCK=1 で流せる（実配信不要）
COMMENT_SIDECAR_MOCK=1 pnpm --filter ./apps/desktop tauri dev
# ① dev-mock でスパチャ（JPY）・ビッツ・サブスク・ギフト・Jewels・レイドを一通り流す
#    ⚠ mock は seq 周回で種別を出し分ける（レイドは twitch の seq%20===16・Jewels は youtube の
#      seq%20===9、combo 更新は 12）。1.8 秒間隔なので 1 分ほど流せば一通り揃う
# ② サマリー画面で「JPY 〇〇 / BITS 〇〇」と**通貨ごとに**出る（混ざらない）
# ③ Jewels は「N 回」だけ出て、総課金額に入っていない
# ④ 貢献者一覧が金額降順に並び、行から視聴者詳細へ飛べる
# ⑤ レイド一覧に「誰が何人」が出る（YouTube 単独でも欄は出て「Twitch のみ」と分かる）
# ⑥ 注記が 4 つ出ている（N+1 / Jewels / 通貨混在 / donation の扱い）＋既存データが出ない旨の 1 行
# ⑦ 視聴者一覧（038b）の bits・スパチャ・サブスクの数字とサマリーが矛盾しない
#    ⚠ total_comments と donation は訂正 1・2 の決定どおりに**意図して**差が出ることを確認する
# ⑧ ⚠ 配信中に**コメビュ窓を閉じて開き直しても**「配信中」表示が消えない（申し送り 7＝接続状態を見ていない担保）
# ⑨ 貢献者一覧にレイドしかしていない配信者が並んでいない（論点 4）
```

## 実装後に必要なレビュー

- **軽レビュー**（[`code-review-light`](../../.claude/skills/code-review-light/SKILL.md)）。
- ⚠ ただし次は軽レビューでも必ず確認する:
  - **§8**（識別子は定数・`session_id` はバインド）
  - **集計結果をキャッシュテーブルに保存していない**こと（§9 の判断をやり直さない）
  - **既知の歪みの注記が実装されている**こと（数字の信頼性に直結する）
