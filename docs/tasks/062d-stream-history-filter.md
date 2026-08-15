# 062d 配信履歴とフィルタ（配信別／月別／年別）

> 状態: **未着手（実装サブタスク）**。分割・線引きは親 [062](062-stream-summary.md) を正とする。
> ⚠⚠ **2026-08-16（062c 完了・レビュー済み）に本ファイルの前提を実コードで再検証して更新した。**
> 下記「⚠⚠ 062c 完了時点での前提の訂正と申し送り」が**本文より優先**する。
>
> **必読前提**: 親 [062](062-stream-summary.md)（⚠ **(3) 節は反転している**）、
> セッション記録 [062b](062b-stream-session-recording.md)、
> **サマリー画面 [062c](062c-stream-summary-view.md)（集計クエリと表示の正・⚠ 冒頭の「穴 A〜M」が正）**、
> ⚠⚠ **[`docs/progress.md`](../progress.md) の 062c 節**（対応表・レビュー指摘への対応・**062d への申し送り**が全文で在る）、
> データ層 [`viewer_memory/repository.rs`](../../apps/desktop/src-tauri/src/viewer_memory/repository.rs)（**「識別子はコンパイル時定数のみ」の規律**と `ViewerSort` の作法）、
> 実装 [`stream_summary/`](../../apps/desktop/src-tauri/src/stream_summary/)（**母集合の定義と穴 A の線引き表**）と
> [`SummaryView.tsx`](../../apps/desktop/src/screens/comment-viewer/SummaryView.tsx)、
> 一覧 UI の作法 [038b](038b-viewer-list-detail-and-notes.md) / [`ViewersView.tsx`](../../apps/desktop/src/screens/comment-viewer/ViewersView.tsx)、
> [`docs/security.md`](../security.md)（**§8 ユーザー入力を信頼しない**／§9）。
> CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。**軽レビュー**。
>
> ⚠ **行番号は書かない**（特定はシンボル名で行うこと）。
> ⚠ **着手条件＝[062c](062c-stream-summary-view.md) 完了** → ✅ **2026-08-16 に完了**（実機確認・レビュー済み）。

## ⚠⚠ 062c 完了時点での前提の訂正と申し送り（2026-08-16・実コードで検証済み・**本文より優先**）

062c の完了時に本ファイルの前提を実コードで検証した。**本文の記述が誤っている／古いものが 5 件**、
**着手前に決めないと進めない論点が 3 件**、**そのまま使える申し送りが 8 件**あった。

### ⚠⚠ 訂正 1: 「3 つの注記を期間サマリーでも出す」は**廃止された**

本文 (4) / (5) / 完了条件 / 確認コマンド⑥ が「062c の 3 つの注記が期間サマリーでも出ること」と書いているが、
**062c の注記（説明文）は 2026-08-16 の実機確認で全廃された**（依頼者決定・親 062 (3) の反転）。
実機で**説明文が画面の大半を占めて肝心の数字が読めなかった**ため。

⇒ **062d の要件は逆になる**:

- ⚠⚠ **期間サマリーにも説明文（注記）を書かない。** 伝えるべきことは**構造**で示す
  （通貨ごとに並べる／種別の内訳を並べる／Jewels は回数だけ／配信時間を計算して出さない）。
- ⚠ `SummaryView.test.tsx` の **「画面に長い説明文（注記）を出さない」** が
  「句点を含む 30 文字以上の散文が 1 つも無いこと」を機械で固定している。**062d の画面にも同じガードを付けること。**
- ⚠ このガードは**注記と正当な固定文言（エラー・空状態）を区別できない**。落ちたら
  **ガードを消さずに、その文言だけを除外する allow-list を足す**（テストにその方針が明記してある）。
- ⚠ **本文 (4) 末尾の「タイムゾーンの断りを 1 行入れる」も同じ理由で書かない。**
  代わりに**期間の表示そのものを曖昧さの無い形にする**（例: 選択中の期間を「2026-08」ではなく
  実際に切った境界で見せる）か、そもそも境界がずれない切り方を選ぶ（下記 論点 A）。

### ⚠⚠ 訂正 2: `published_at` の「全 provider が UTC・同形 ISO8601」という前提は**誤り**（062c 穴 M）

本文「現在の前提」の最後が「全 provider が UTC・同形 ISO8601 を送る前提（038a に明記）」と書いているが、
[062b](062b-stream-session-recording.md) が `stream_session::repository::comment_times` の doc で**明確に否定している**:

> `started_at` は `now_rfc3339()` 由来の `+00:00` 形式、`published_at` は**プラットフォーム由来**
> （Twitch は `Z` 形式）で、しかもオフセット付き（`+09:00` / `-08:00`）が混ざりうる。
> SQL の `MAX` は**単なる文字列比較**なので、この混在で**最新でない行を「最新」として選ぶ**。

⚠ 062c は「影響が表示順と表示時刻だけ（合計金額はずれない）」と判断して**据え置いた**が、
**062d は `published_at` を期間の境界判定に使うので重みが変わる**——`"…12:00:00Z"` と
`"…05:00:00-08:00"`（＝13:00 UTC）で大小が逆転し、**月初/月末のコメントが隣の月に入りうる**。
⇒ **下記 論点 A で回避策を決めること。**

### ⚠⚠ 訂正 3: `get_period_summary(...) -> StreamSummary` は**そのままでは成立しない**

本文 (2) は「062c の `StreamSummary` を期間版で返す」と書いているが、実装された
`StreamSummary` は **`session: StreamSessionRecord` を必須フィールドとして持つ**（`Option` ではない）。
期間集計には「1 本のセッション」が存在しないので、この型はそのまま使えない。

⇒ **DTO の形を決めること**（下記 論点 C）。⚠ **`session` を `Option` に変えると 062c 側の画面が
`null` 分岐だらけになる**ので、安易に既存型を緩めないこと。

### ⚠⚠ 訂正 4: `viewer_comments` に **`published_at` のインデックスは無い**

実コードの `viewer_memory::repository::init` が張っているのは **2 本だけ**:

```
idx_viewer_comments_viewer  ON viewer_comments(viewer_id)
idx_viewer_comments_session ON viewer_comments(session_id)
```

⚠ 本文 (1) は「`idx_viewer_comments_session` が効いているかを確認する」と書いているが、
**期間で直接引く（`WHERE published_at >= ? AND published_at < ?`）とどのインデックスも効かず全表スキャン**になる。
⇒ 下記 論点 A の選択に直結する（**セッション経由で引けば既存の 2 本で足りる**）。

### ⚠⚠ 訂正 5: 可変長 `IN (?, ?, …)` を安全に書く手段が**この構成には無い**

`Cargo.toml` の rusqlite は **`features = ["bundled"]` のみ**で、可変長配列を 1 つのパラメータとして
バインドする `array`（carray）feature は**有効化されていない**。
⇒ セッション id の集合や複数プラットフォームを `IN` で渡そうとすると
**プレースホルダを `format!` で組み立てたくなる**——これが **§8 を破る唯一の実際的な経路**である。

⚠ **062c は `stream_summary` の実コードから `format!` を 1 つも無くしてある**
（SQL はすべて完全な文字列リテラル・`grep format!` が 0 件）。**この性質を壊さないこと。**
⇒ 回避策は 2 つあり、どちらも `format!` を要しない:
1. **相関サブクエリ**（`WHERE session_id IN (SELECT id FROM stream_sessions WHERE started_at >= ?1 AND started_at < ?2)`）
   ——SQL は完全な定数のまま、バインドするのは値だけ。
2. **enum → 定数 SQL の選択**（`ViewerSort` と同型）。プラットフォーム絞り込みは
   取りうる値が **3 通りだけ**（下記 申し送り 6）なので、条件の数だけ定数を書けば足りる。

### ⚠ 論点 A: 期間をどの列で切るか（**訂正 2・4 をまとめて解ける**）

| 案 | 切り方 | 良い点 | 悪い点 |
|---|---|---|---|
| **(A) 推奨: `stream_sessions.started_at` で配信を絞り、その `id` で `viewer_comments` を引く** | 「その月に**始まった配信**」 | ⚠⚠ **訂正 2 を回避できる**（`started_at` は常に `now_rfc3339()` 由来の `+00:00` 形式＝**文字列比較が安全**）。⚠⚠ **訂正 4 も回避できる**（`idx_stream_sessions_started` ＋ `idx_viewer_comments_session` の既存 2 本が効く）。**062b が確定させた「1 回の配信」という単位と一致する** | ⚠ **月をまたぐ配信**（8/31 23:00 開始 → 9/1 03:00 終了）は**開始月に丸ごと入る**。定義として妥当だが**明示が要る** |
| (B) `viewer_comments.published_at` を直接範囲で引く | 「その月に**投げられた**課金」 | 月またぎの配信でも日付どおりに割れる | ⚠⚠ **訂正 2 の直撃**（オフセット混在で境界がずれる）／⚠⚠ **訂正 4**（インデックスが無く全表スキャン）／⚠ **062b 以前の `session_id` の行まで拾ってしまう**（062c は `stream_sessions` に行が無い配信を NotFound にしている＝**挙動が食い違う**） |

⚠ **(A) を採るなら、「月の判定は配信の開始時刻で行う」ことを決定として残すこと**
（本文 (5) のテストも「月境界のコメント」ではなく「**月境界の配信**」を固定する形に変わる）。
⚠ **(B) を採るなら、`published_at` を Rust でパースして比較するか、正規化列を足す**必要があり、
**後者は §9 の保存範囲の変更＝security-review のやり直し**になる。**先に本人へ確認すること。**

### ⚠ 論点 B: 月境界のタイムゾーン（**論点 A の決定に依存する**）

本文 (2) の「frontend でローカルの月境界を UTC へ変換して渡す（`chrono-tz` を足さない）」という方針は
**論点 A で (A) を採っても有効**（比較対象が `started_at` に変わるだけ）。⚠ **9 時間差を跨ぐケースを
テストで固定する**という指示もそのまま有効。⚠ ただし固定するのは
「**日本時間 8/1 00:05 に始まった配信が 8 月に入る**」（＝(A) の場合）である。

### ⚠ 論点 C: 期間集計の DTO（訂正 3）

| 案 | 形 | 評価 |
|---|---|---|
| **(A) 推奨: 集計の本体を切り出して共有する** | `StreamSummary` から `session` を除いた `SummaryTotals`（数字・内訳・貢献者・レイド）を新設し、`StreamSummary { session, totals }` / `PeriodSummary { from, to, session_count, totals }` の 2 つが**同じ `totals` を持つ** | ⚠ 062c の binding と画面に波及するが、**表示コンポーネントを 1 つに保てる**（本文 (4) の要求そのもの）。集計ロジックも 1 本のまま |
| (B) `StreamSummary.session` を `Option` にする | 既存型を緩める | ⚠ 062c 側が `null` 分岐だらけになり、「配信中」バッジ・タイトル編集の前提が崩れる |
| (C) 期間用に別 DTO を作って表示も分ける | 独立 | ⚠ **本文 (4) が禁じている 2 実装分裂**そのもの |

⚠ **(A) を採る場合、062c の binding（5 本）と `SummaryView.tsx` に手が入る**ので、
**「062c を壊していないこと」をテストで担保したまま進めること**
（防波堤＝**Rust `stream_summary` 39 本**〔binding export 5 本を含む〕＋
**frontend `SummaryView.test.tsx` 27 本**＋**`CommentViewerApp.session.test.tsx` の 062c 追加 3 本**）。

### 申し送り 1: **集計の意味論は 062c の定義をそのまま使う**（違えると数字が食い違う）

⚠⚠ **「配信別」と「月別」で違う定義を使うと、同じデータで違う数字が出る**。以下は 062c の決定
（全文と対応表は progress.md 062c 節）:

```text
<課金>     = amount IS NOT NULL AND currency IS NOT NULL AND currency <> 'JEWELS'
<サブスク>  = event_type IN ('subscription', 'membership', 'gift')
<コメント>  = event_type <> 'raid'                      ← 訂正 1（レイドは数えない）
kind       = CASE WHEN currency = 'BITS' THEN 'bits' ELSE event_type END
```

- **訂正 1**: `total_comments` は `<> 'raid'`（`viewers.total_comments` とは**意図的に不一致**）。
- **訂正 2**: **donation を総課金額に含める**（`viewers.superchat_amount` とは**意図的に不一致**）。
- **論点 3**: JEWELS の除外は**通貨側**（`currency <> 'JEWELS'`）。種別側にしない。
- **論点 4**: 貢献者は**課金 or サブスクの行からしか作らない**（レイドしかしていない配信者を出さない）。
  ⚠ 絞り込みは**後付けの filter ではなくクエリの構造**。
- **穴 E**: bits に `event_type` 条件を**足さない**（既存 `RECOMPUTE_VIEWER_AGGREGATES_SQL` と同一述語）。
- **穴 C**: 金額の 3 つ（種別内訳 / 通貨ごと / 総課金回数）は **1 本のクエリから導出する**。
  ⚠ **3 本に割ると「通貨ごとの count の合計 ≠ 総課金回数」がいつでも起こる。**

### ⚠⚠ 申し送り 2: 穴 A の線引き（`viewers` をどこまで JOIN してよいか）

`viewer_comments` に**名前の列が無い**（レイド行は `text` も空）ので、貢献者・レイド一覧は `viewers` の JOIN が要る。

| `viewers` の列 | 使ってよいか | 理由 |
|---|---|---|
| `name` / `provider` | ✅ **JOIN 可** | **同一性の属性**であって集計ではない |
| `total_comments` / `bits_*` / `superchat_*` / `subscription_count` / `is_member` / `last_subscription_at` | ❌ **不可** | **全期間の累計**で、その期間のぶんではない |
| `first_seen_at` / `last_comment_at` / `note` | ❌ 不可 | 同上／メモは集計と無関係 |

⚠ 062d は**期間集計なので誤用がより起こりやすい**（「期間の累計だからいいだろう」と混ぜたくなる）。
表は `stream_summary/mod.rs` に在る。`contributor_amounts_are_per_session_not_lifetime_totals` と同型の
テストを**期間版でも書くこと**。

### ⚠ 申し送り 3: 穴 L（貢献者の並び順）は**未解決のまま引き継ぐ**

「金額降順」は通貨をまたぐと**原理的に定義できない**（換算しない＝親 062 (2)）。062c は第 1 キーに
**通貨をまたいだ単純合計**を使い（画面には出さない）、当初はその近似を注記で明示していたが、
**注記の全廃で担保も説明も消えた**（progress.md の「固定できていないこと」に訂正済み・**現在の担保はゼロ**）。

⚠ **期間集計は複数通貨が混ざる確率が単一配信より高い**ので、062d のほうが影響が大きい。
⇒ レビューが提案した未実装案（progress.md 062c 節「構造で伝え直す案」④）:
**単一通貨なら金額降順のまま、2 通貨以上が混ざる期間では `first_at` 昇順（先に応援してくれた順）に倒す**。
分岐 1 つで「原理的に定義できない順位を近似で出す」状態そのものが消える。**採否を決めること。**

### ⚠ 申し送り 4: レビューが提案した**未実装の構造置換**（062d で一緒にやるか決める）

progress.md 062c 節「注記全廃の評価と、構造で伝え直す案」より。**062c では実装していない**（判断待ち）:

- **① コミュニティギフト N+1** ⇒ **サブスク件数を `subscription` / `membership` / `gift` の内訳で並べる**。
  N+1 は `gift` 行にだけ出るので「サブスク 5 件（サブスク 2 / ギフト 3）」と見えれば自力で気づける。
  ⚠ 実装は `SUBSCRIPTION_COUNT_SQL` に `GROUP BY event_type` を足して**1 本から導出するだけ**（穴 C の思想と同型）。
  ⚠ **062d でも同じ表示を使う**ので、やるなら 062d の DTO 設計（論点 C）と**同時が安い**。
- **② 視聴者削除で数字が変わる** ⇒ サマリーではなく**削除の側**（`ViewerDetailPanel` の削除確認）で示す。
  ⚠ **062d のスコープ外**（038b 側の変更）。やるなら別タスク。

### 申し送り 5: `list_stream_sessions` の現状

- **引数なし・全件・`ORDER BY started_at DESC, id DESC`**（`stream_session::repository::list`）。
- 062c は **画面側で直近 20 件に切り**（`SUMMARY_SESSION_LIMIT`）、切ったことを画面に出している。
  ⚠ **Rust 側は 062c で 1 行も触っていない**＝ページング・ソート・フィルタは**まるごと 062d の仕事**。
- ⚠ **既存 7 コマンドの互換を壊さないこと**（`get_active_stream_session` などをコメビュ窓が使っている）。
  引数を足すなら `Option` にして既定を現行挙動に揃える。

### 申し送り 6: `platforms` の取りうる値は **3 通りだけ**

`stream_session::service::normalize_platforms` が **allow-list（`twitch` / `youtube`）＋昇順＋重複除去**を
保証しているので、`stream_sessions.platforms` に入るのは `"twitch"` / `"youtube"` / `"twitch,youtube"` の
**3 通りのみ**。⇒ 本文 (3) の「`LIKE` を使わない」は正しく、
**enum で受けて定数 SQL を選ぶ**形にすれば可変長 `IN` も要らない（訂正 5 の回避策 2）。

### 申し送り 7: 画面側の作法（062c で確立したもの）

- ⚠⚠ **専用 CSS モジュールを作らない**。`check-css-guards.mjs` の `FAINT_SCANNED` は
  **`CommentViewerApp.module.css` ＋ `src/components/**.module.css` だけ**を走査するので、
  `screens/comment-viewer/` に新設すると `--text-faint` の誤用が素通りする。
- ⚠ 表の意匠は `.viewerHead` / `.viewerRow` を**重ねて列構成だけ上書き**する（複製を作らない・ソース順で後勝ち）。
- ⚠ 表のセクションは **`flex-shrink: 0`** で包む（`.viewerTable` が `overflow: hidden` を持つため、
  「flex 縦積み＋`overflow:auto`」で潰れてクリップされる。このリポジトリで **3 回**起きている）。
- ⚠⚠ **穴 H**: ビューを増やしても**コメントの受信・記録が止まらないこと**をテストで固定する
  （`connectCommentStream` の `useEffect` は `view` に依存していない＝現状は安全だが「今そうである」だけ）。
  **ここが壊れると、見ている間の課金が永久に失われる**（記録は遡れない）。
- ⚠ `SummaryView` は**単一の大きなコンポーネント**で、数字タイル・貢献者一覧・レイド一覧は**まだ切り出されていない**。
  本文 (4) の「同じコンポーネントを再利用」を満たすには**切り出しが要る**（論点 C の (A) と同時にやるのが自然）。

### 申し送り 8: 周辺の既知の状態（**062d では直さない／踏まないこと**）

- ⚠ **`check:bindings` は 6 ディレクトリのハードコード列挙**で、`src/features/rakuraku/bindings` が漏れている
  （**既存の別件・062c でも直していない**）。新規 binding は**既に checked なディレクトリへ出す**こと
  （`comment-viewer/bindings/`）。⚠ **新規ファイルは `git add` するまで `git diff --exit-code` が見に行かない。**
- ⚠ **`docs/security.md` は 062c で 1 文字も変更していない**（追記不要と判断し、レビューでも妥当と確認済み。
  根拠は progress.md 062c 節「レビュー指摘への対応」）。**062d も保存を増やさないなら同じく追記不要**。
  ⚠ ただし**インデックスを足す／正規化列を足す**なら話が変わるので、**先に本人へ確認すること**。
- ⚠ **Q-7（コメント密度）の再修正トリガー**: `stream_summary/repository.rs` は module doc だけで 71 行あり、
  **母集合の定義が 3 箇所**（`repository.rs` / `model.rs` / progress.md）に複製されている。
  **062d で同じ密度を続けて複製が 4 箇所以上になったら**、`repository.rs` の module doc を
  「母集合の定義＋見出しと 1 行要約」へ圧縮し、詳細は progress.md へのポインタに寄せること。

## 目的

依頼者の要望⑤の後半「**あとから見返すこともでき、何月は誰がいくらくれたとか、今年はとか、
この配信はみたいな感じでフィルタリングもできると良い**」を実装する。

## 現在の前提（調査結果・実コード）

- [062b](062b-stream-session-recording.md) で `stream_sessions`（`started_at` / `ended_at` /
  `platforms` / `title`）と `idx_stream_sessions_started` ができている。
- [062c](062c-stream-summary-view.md) で **`get_stream_summary(session_id)` の集計ができている**
  （`stream_summary` モジュール＝`commands` / `service` / `repository` / `model`・**SQL 定数 7 本**）。
  ⚠ **本タスクは「期間で集計する」版が要る**（`session_id` 1 本ではなく範囲）。
  ⚠⚠ **戻り値 `StreamSummary` は `session: StreamSessionRecord` を必須で持つ**ので期間集計にそのままは使えない
  （訂正 3・論点 C）。
  ⚠ **集計の意味論（母集合の定義）は 062c のものをそのまま使う**（申し送り 1）。
- ⚠ **[`viewer_memory/repository.rs`](../../apps/desktop/src-tauri/src/viewer_memory/repository.rs) 冒頭の規律**:
  > 識別子（テーブル名・ORDER BY 句）は**コンパイル時定数のみ**を使い、値は必ずパラメータバインドする（§8）
  **フィルタ機能はまさにここを破りたくなる場所**（動的 WHERE / 動的 ORDER BY）。**本タスク最大の注意点。**
- `ViewerSort`（`viewer_memory/model.rs`）が「ソート指定を enum で受けて、SQL 側は定数から選ぶ」という
  **手本**になっている。**同じ形にする。**
- ⚠⚠ **`published_at` は「全 provider が UTC・同形」ではない**（訂正 2）。Twitch は `Z` 形式で、
  オフセット付き（`+09:00` / `-08:00`）が混ざりうる＝**辞書順比較では大小が壊れる**
  （[062b](062b-stream-session-recording.md) の `comment_times` の doc が正）。
  一方 **`stream_sessions.started_at` は常に `now_rfc3339()` 由来の `+00:00` 形式**で、文字列比較が安全。
  ⚠ **月別・年別の集計はローカルタイムでやりたい**が、保存は UTC。**ここがずれる**（下記 (2)・論点 A/B）。
- ⚠⚠ **`viewer_comments` のインデックスは `viewer_id` と `session_id` の 2 本だけ**（訂正 4）。
  `published_at` には無いので、期間で直接引くと**全表スキャン**になる。
- ⚠⚠ **rusqlite は `features = ["bundled"]` のみ**で、可変長 `IN` を安全に渡す `array` feature が無い（訂正 5）。
  ⇒ **相関サブクエリ**か**enum → 定数 SQL** で回避する（`format!` を使わない）。

## このタスクでやること

### (1) 履歴一覧（配信別）

- `list_stream_sessions` にページングとソートを足す。
  - ソートは **`StreamSessionSort` enum**（`StartedDesc` / `StartedAsc`）で受け、
    **SQL の ORDER BY 句はコンパイル時定数から選ぶ**（`ViewerSort` と同型・§8）。
  - ⚠ **文字列を SQL に埋めない。**
- 一覧の各行に「日時・プラットフォーム・タイトル・総コメント数・通貨ごとの総額」を出す。
  ⚠ **一覧のために全セッションの集計を毎回回すと重い**。
  対処＝一覧では**軽い集計だけ**（`COUNT(*)` と通貨別 `SUM`）にし、詳細は行を開いたときに
  [062c](062c-stream-summary-view.md) の `get_stream_summary` を呼ぶ。
  ⚠ **キャッシュテーブルを作らない**（§9 の判断をやり直さない・062c の決定と同じ）。
  ⚠ **実測して遅ければ**、`idx_viewer_comments_session` が効いているかを確認する。
  それでも遅いなら**その時点で本人に相談**（キャッシュも**インデックス追加**も §9 の判断に触れるため）。
- ⚠ **既存 7 コマンドの互換を壊さない**（申し送り 5）。引数を足すなら `Option` にして既定を現行挙動に揃える。
- ⚠ 062c が画面側で切っている **直近 20 件（`SUMMARY_SESSION_LIMIT`）** は、履歴一覧ができたら
  **どちらが「配信を選ぶ」入口なのか**を決めること（2 つの選択 UI が併存すると迷子になる）。

### (2) 期間フィルタ（月別／年別）— ⚠ タイムゾーンの扱いを決める

- `get_period_summary(from: String, to: String) -> …` 相当を足す。
  ⚠⚠ **戻り値の型は論点 C で決めること**（`StreamSummary` は `session` 必須なので流用できない＝訂正 3)。
  **推奨は集計本体（`SummaryTotals`）を切り出して 062c と共有する**（表示も 1 実装に保てる）。
- ⚠⚠ **どの列で切るかを先に決めること（論点 A）**。推奨は **`stream_sessions.started_at`**
  （＝「その月に**始まった配信**」）——`+00:00` 形式で固定なので**文字列比較が安全**（訂正 2 を回避）、
  かつ `idx_stream_sessions_started` ＋ `idx_viewer_comments_session` の**既存 2 本が効く**（訂正 4 を回避）。
  ⚠ その場合 **月をまたぐ配信は開始月に丸ごと入る**。**この定義を決定として残すこと。**
- ⚠ 境界の値は ISO8601 文字列で、辞書順比較で範囲を切る。
  一方ユーザーが期待する「2026 年 8 月」は**ローカルタイム**。
  → **frontend でローカルの月境界を UTC の ISO8601 に変換してから渡す**のが素直
  （Rust に `chrono-tz` を足さない＝新規依存ゼロ）。
  ⚠ **境界がずれる**（日本時間 8/1 00:00 = UTC 7/31 15:00）。**これは正しい挙動**だが、
  実装時に**必ずテストで固定する**（でないと「月初の配信が前月に入る」という気づきにくいバグになる）。
  ⚠ 論点 A で (A) を採るなら、固定するのは
  **「日本時間 8/1 00:05 に始まった配信が 8 月に入る」**（コメント単位ではなく**配信単位**）。
  ⚠ **決めた方式をコメントに残す。**
- ⚠ **`from` / `to` は frontend から来る文字列**なので Rust 側で検証する（§8）:
  ISO8601 として `chrono` でパースできること・`from <= to`・範囲の上限（例 10 年）。
  **パースせずに SQL へ渡さない。**

### (3) フィルタ UI

- 期間の選択:
  - **プリセット**（今月 / 先月 / 今年 / 全期間）＋ **年月の指定**
  - ⚠ **日付ピッカーを自作しない**。年と月のセレクトで足りる（要望は「何月は」「今年は」）。
- プラットフォームの絞り込み（YouTube / Twitch / 両方）。
  ⚠ `platforms` は**昇順 CSV の 1 列**で、取りうる値は `"twitch"` / `"youtube"` / `"twitch,youtube"` の
  **3 通りだけ**（[062b](062b-stream-session-recording.md) の `normalize_platforms` が保証・申し送り 6）。
  ⇒ **`LIKE` を使わない**。⚠⚠ **可変長 `IN` も組まない**（`format!` が要る＝§8 を破る・訂正 5）。
  **enum で受けて条件ごとの定数 SQL を選ぶ**（`ViewerSort` と同型）。
  ⚠ `LIKE '%twitch%'` にすると将来の値追加で壊れる。
- ⚠ **貢献者一覧は期間フィルタの主役**。「何月は誰がいくらくれたか」がマスト要件なので、
  期間集計でも**貢献者一覧を必ず出す**（数字のタイルだけにしない）。
  ⚠⚠ **期間集計は複数通貨が混ざる確率が単一配信より高い**ので、**並び順（穴 L・申し送り 3）の決着を先に付ける**こと。

### (4) 表示

- 期間サマリーは [062c](062c-stream-summary-view.md) と**同じコンポーネントを再利用**する
  （数字のタイル・貢献者一覧・レイド一覧）。
  ⚠ **表示を 2 実装に分けない**（片方だけ仕様が古くなる分裂が起きる。
  実際 062c では「注記を全廃したのに frontend の入口だけ旧方針の指示が残っていた」事故がレビューで見つかっている）。
- ⚠⚠ **説明文（注記）を書かない**（訂正 1）。062c の 6 本は 2026-08-16 に全廃された。
  伝えるべきことは**構造**で示す（通貨ごとに並べる／種別の内訳を並べる／Jewels は回数だけ／
  **配信時間を計算して出さない**）。
  ⚠ **「タイムゾーンの断りを 1 行入れる」も書かない。** 代わりに
  **選択中の期間を曖昧さの無い形で見せる**か、境界がずれない切り方（論点 A の (A)）を選ぶ。
- ⚠ `SummaryView` の表示部は**まだ切り出されていない**（申し送り 7）。「1 実装に保つ」には**切り出しが要る**。

### (5) テスト

- Rust:
  - `StreamSessionSort` が enum で受けられ、**SQL に文字列を埋めていない**こと
    （⚠ `command_contract` 型のテストで「`format!` で ORDER BY を組んでいない」を機械的に固定してもよい）
  - `from` / `to` の検証（不正な ISO8601・`from > to`・範囲超過が拒否される）
  - **月境界の変換**: 日本時間の月初/月末の**配信（論点 A が (A) の場合）／コメント（(B) の場合）**が
    正しい月に入ること（⚠ UTC との 9 時間差を跨ぐケースを必ず入れる）
  - ⚠ **期間集計でも `viewers` の累計列を混ぜていない**こと（申し送り 2・
    `contributor_amounts_are_per_session_not_lifetime_totals` の期間版）
  - `platforms` の絞り込みが完全一致 / `IN` で効くこと（`LIKE` に依存していないこと）
  - ⚠⚠ 期間集計が [062c](062c-stream-summary-view.md) の単一セッション集計と**分類が一致する**こと
    （同じデータで「その配信だけの期間」を指定したら `get_stream_summary` と**同じ数字になる**、を固定するのが確実）
  - ⚠ **`format!` で SQL を組んでいないこと**（訂正 5・実コードでヒットゼロ）
- frontend:
  - プリセット（今月 / 先月 / 今年 / 全期間）が正しい範囲を渡すこと
  - **期間サマリーでも貢献者一覧が出る**こと
  - ⚠⚠ **期間サマリーにも説明文（注記）が出ない**こと（訂正 1・`SummaryView.test.tsx` の
    「画面に長い説明文（注記）を出さない」と同型のガードを付ける）
  - ⚠ **062c の既存テストが 1 本も壊れていない**こと（論点 C で (A) を採ると 062c 側に手が入るため。
    Rust 39 本 ＋ frontend 30 本）
- **ミューテーションで実効性を確認**する。最低限:
  - 月境界の変換を UTC 固定に変える
  - ソートの enum 分岐を 1 つ潰す／プラットフォーム絞り込みの定数を取り違える
  - 期間の述語から片側（`>=` or `<`）を落とす
  - 説明文を 1 本書き戻す
  ⚠ **件数ではなく「何を固定できていないか」を書く**（062c と同じ作法）。

## このタスクでやらないこと

- **集計ロジックの新設**（[062c](062c-stream-summary-view.md) のものを期間版に広げるだけ）。
- **キャッシュテーブル**（§9 の判断をやり直さないため）。遅ければ本人に相談。
- **CSV / JSON エクスポート**。
- グラフ・チャート・前年比などの分析。
- 日付ピッカーの自作。
- 週別・日別の集計（要望は「月・年・配信」）。
- 視聴者単位の期間フィルタ（「この人が今年いくら投げたか」）。
  ⚠ 貢献者一覧を期間で出せば近いことはできるが、**視聴者詳細（038b）の期間フィルタは作らない**。
- `chrono-tz` 等のタイムゾーン crate の追加（**frontend で境界を計算する**）。
- ⚠⚠ **説明文（注記）の追加**（訂正 1・062c で全廃済み）。歪みは**構造**で示す。
- ⚠ **`viewer_comments` への新規インデックス・正規化列の追加**（訂正 4）。
  ⚠ 必要だと判断したら**先に本人へ確認する**（列の追加は §9 の保存範囲の変更＝security-review のやり直し）。
- ⚠ **`check:bindings` の列挙漏れ（`rakuraku/bindings`）の修正**（既存の別件・申し送り 8）。
  見つけたら progress.md に残すだけ。直すなら仕様外なので**先に確認する**。
- ⚠ **`ViewerDetailPanel` の削除確認に「サマリーの数字が変わる」を出すこと**（申し送り 4 の②）。
  038b 側の変更なので**別タスク**。

## セキュリティ制約（docs/security.md 準拠）

- **外部通信ゼロ**（§1）。
- ⚠ **§8 が本タスクの最重要項目**:
  - **識別子（テーブル名・ORDER BY 句）はコンパイル時定数のみ。** ソートは enum で受ける（`ViewerSort` と同型）。
  - **値は必ずパラメータバインド。** `from` / `to` / `platforms` を SQL 文字列に埋めない。
  - **frontend から来る日付文字列を Rust 側で検証する**（パースできること・順序・範囲上限）。
  - ⚠⚠ **`format!` で SQL を組まない**（062c は `stream_summary` の実コードから `format!` を 0 件にしてある）。
    可変長 `IN` は**相関サブクエリ**か**enum → 定数 SQL**で回避する（訂正 5）。
  - ⚠ コマンドは**単一目的**（§3）。「任意の条件で集計する」汎用コマンドを作らない。
- **§9 で新しい保存はしない**（既存データを読んで集計するだけ・キャッシュも作らない）。
  ⚠ `stream_summary` は **`init()` を持たない**（テーブルを作らないことをコードの形で残してある）。
  **`lib.rs` の `setup()` に init を足したくなったら、何を保存しようとしているのかを疑うこと。**
  ⚠ **保存を増やさないなら `docs/security.md` への追記は不要**（062c と同型・判断の根拠は progress.md 062c 節）。
- ログに視聴者名・金額・期間を出さない（§9）。
- **capability を増やさない**・`csp: null` 不変・**新規依存ゼロ**・生 hex ゼロ。

## 完了条件

- 配信履歴の一覧が出て、行を開くと [062c](062c-stream-summary-view.md) の詳細が見られる。
- **今月 / 先月 / 今年 / 全期間 / 年月指定**で集計を切り替えられる。
- **期間集計でも貢献者一覧（誰がいくら・誰がサブスク）が出る**（マスト）。
- **月境界がローカルタイムで正しく切れる**（UTC との差を跨ぐケースがテストで固定されている）。
- プラットフォーム絞り込みが `LIKE` に依存せず動く。
- **SQL に文字列を埋めていない**（ソートは enum・値はバインド・⚠ **`format!` が実コードで 0 件**）。
- ⚠⚠ **期間サマリーに説明文（注記）が出ていない**（訂正 1）。歪みは構造で示している。
- ⚠⚠ **期間集計と `get_stream_summary` の数字が一致する**（同じ範囲を指定したら同じ結果＝申し送り 1）。
- ⚠ **`viewers` の累計列を混ぜていない**（申し送り 2）。
- 表示コンポーネントが 062c と共有されている（2 実装に分かれていない）。
- ⚠ **062c の既存テストが 1 本も壊れていない**（論点 C で (A) を採ると 062c 側に手が入るため）。
- ⚠ **`docs/progress.md` に 062d 節**（訂正 1〜5 と論点 A〜C の結論・根拠・**変異の実測結果**）。
  **`docs/task-board.md` の 062d を更新**し、**062d で判明した前提を本ファイルへ反映**すること。
- ts-rs binding が生成され `pnpm check:bindings` が通る。
- Rust / frontend のテストが通り、**ミューテーションで実効性を確認**している。
- **capability 追加ゼロ・`tauri.conf.json` 差分ゼロ・`csp: null` 不変・新規依存ゼロ。**
- `pnpm --filter ./apps/desktop typecheck` / `lint` / `test` / `cargo check` / `cargo test` が通る。
  [`docs/progress.md`](../progress.md) を更新。

## 確認コマンド

```bash
git diff --stat
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
pnpm --filter ./apps/desktop test
pnpm --filter ./apps/desktop check:bindings
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml

# ⚠⚠ §8 の担保: SQL を format! で組んでいないこと（**実コードでヒットゼロが期待**・062c から続く性質）
grep -rn "format!" apps/desktop/src-tauri/src/stream_summary/ | grep -v ": *//"
# ⚠ §9: 集計結果を保存するテーブル・インデックスを作っていないこと（ヒットゼロが期待）
grep -rn "CREATE TABLE\|CREATE INDEX\|INSERT INTO\|UPDATE \|DELETE FROM" apps/desktop/src-tauri/src/stream_summary/ | grep -v ": *//"
# ⚠ 穴 A の線引き: 本番 SQL が viewers から引くのは v.id / v.name / v.provider だけであること
grep -oE "v\.[a-z_]+" apps/desktop/src-tauri/src/stream_summary/repository.rs | sort -u
# ⚠ 穴 G: 新 CSS が (6-b) の走査対象（CommentViewerApp.module.css ＋ components/）に入っていること
grep -n "FAINT_SCANNED\|COMPONENTS_DIR" apps/desktop/scripts/check-css-guards.mjs

# ゼロ拡大の担保（差分ゼロが期待）
git status --short -- apps/desktop/src-tauri/capabilities/ apps/desktop/src-tauri/tauri.conf.json .github/ apps/comment-sidecar/
# 新規依存ゼロの担保（差分ゼロが期待）
git status --short -- apps/desktop/package.json pnpm-lock.yaml package.json apps/desktop/src-tauri/Cargo.toml

# ⚠ 062c と同じく COMMENT_SIDECAR_MOCK=1 で流せる（実配信不要）
COMMENT_SIDECAR_MOCK=1 pnpm --filter ./apps/desktop tauri dev
# ⚠⚠ **両 provider を接続し 3 分以上流すこと**（DONATION_VARIANTS は Math.floor(seq/20)%4 で
#    1 周〔36 秒〕に 1 変種しか出ず、**USD が出るのは 3 周目＝約 108 秒後**。1〜2 分では通貨が割れない）
# ① 履歴一覧に過去の配信が新しい順に並ぶ／行を開くと詳細が出る
# ② 「今月」「先月」「今年」で数字と貢献者一覧が切り替わる
# ③ 年月を直接指定しても同じ
# ④ ⚠ **月初 00:05（日本時間）に始まった配信が、その月に入る**（論点 A が (A) の場合。前月に入らない）
# ⑤ プラットフォーム絞り込みが効く
# ⑥ ⚠⚠ **期間サマリーに説明文（注記）が 1 つも出ていない**（訂正 1）
# ⑦ ⚠ **同じ配信 1 本ぶんの期間を指定すると、062c のサマリーと数字が完全に一致する**（申し送り 1）
# ⑧ セッション数が増えたときの体感速度（重ければ本人に相談）
# ⑨ ⚠ 履歴・フィルタを開いている間もコメントの受信・記録が止まらない（穴 H・申し送り 7）
# ⑩ lsof -i で外部 ESTABLISHED が増えない
```

## 実装後に必要なレビュー

- **軽レビュー**（[`code-review-light`](../../.claude/skills/code-review-light/SKILL.md)）。
- ⚠ ただし **§8 だけは必ず確認する**（本タスクは動的 SQL を書きたくなる唯一の場所）:
  - 識別子（テーブル名・ORDER BY 句）がコンパイル時定数のみであること
  - `from` / `to` / `platforms` がパラメータバインドされていること
  - frontend から来る日付文字列が Rust 側で検証されていること
  - ⚠⚠ **`format!` で SQL を組んでいないこと**（可変長 `IN` を書こうとして破られる＝訂正 5）
- ⚠ **キャッシュテーブル・新規インデックスを作っていないこと**（§9 の判断をやり直さない）
- ⚠ **説明文（注記）を書き戻していないこと**（訂正 1）
- ⚠ **`viewers` の累計列を混ぜていないこと**（申し送り 2）
- ⚠ **月境界のタイムゾーン変換**は、間違っても症状が出にくい（月初/月末だけずれる）ので、
  テストが実際に UTC 差を跨いでいるかをレビューで確認すること。
