# 062b 配信セッションの記録（`stream_sessions` テーブル・境界の確定）

> 状態: **未着手（実装サブタスク）**。分割・線引きは親 [062](062-stream-summary.md) を正とする。
>
> **必読前提**: 親 [062](062-stream-summary.md)、レイド取り込み [062a](062a-twitch-raid-ingestion.md)、
> **既存の session_id 採番 [`CommentViewerApp.tsx`](../../apps/desktop/src/screens/comment-viewer/CommentViewerApp.tsx)（`sessionIdRef`）**、
> データ層 [`viewer_memory/repository.rs`](../../apps/desktop/src-tauri/src/viewer_memory/repository.rs)（`viewer_comments.session_id` / `idx_viewer_comments_session`）と [038a](038a-viewer-memory-data-layer.md)、
> 接続状態 [`commentStream.ts`](../../apps/desktop/src/features/comment-viewer/commentStream.ts)（`session.state` / `account.state`）と [`connectionStatus.ts`](../../apps/desktop/src/features/comment-viewer/connectionStatus.ts)、
> 接続 UI [042b](042b-connection-cards-on-comment-view.md)、
> 冪等な列追加 [`util.rs`](../../apps/desktop/src-tauri/src/util.rs)（`ensure_column`）、
> [`docs/security.md`](../security.md)（**§9 端末保存／§8／レビュー必須条件**）。
> CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。
> **security-review 必須**（§9 保存データ種別の変更）。
>
> ⚠ **行番号は書かない**（特定はシンボル名で行うこと）。
> ⚠ **記録は遡れない。** セッション境界を記録し始めるのが遅れるほど、その間の配信は「いつの配信か」が
> 永久に分からないままになる。[062a](062a-twitch-raid-ingestion.md) と並ぶ最優先。
>
> ⚠ **本ファイルは 2026-08-16（062a 完了時）に前提を実コードで再検証して更新した。**
> 下記「⚠⚠ 前提の訂正と 062a からの申し送り」が**本文より優先**する。

## ⚠⚠ 前提の訂正と 062a からの申し送り（2026-08-16・実コードで検証済み）

062a で「タスクファイルの前提が実コードと食い違っていた」ことが 5 件あったため、着手前に
本ファイルの記述も実コードで検証した。**誤りが 3 件、追記すべき申し送りが 5 件**あった。

### ⚠⚠ 訂正 1: 051 の初コメ判定は `session_id` に**依存していない**（が、もっと厄介な問題がある）

本文 (4) は「051 の初コメント判定（`firstOfStream.ts`）が `session_id` の粒度に依存している可能性がある」と
書いているが、**実コードでは `firstOfStream.ts` は `session_id` を 1 度も読んでいない**
（`trackFirstOfStream` は `viewerId → コメント id` の `Map` で、保持しているのは `CommentViewerApp` の
**マウント単位の state**）。⇒ 文字どおりの依存は無い。

⚠⚠ **しかし本当の問題はその逆側にある。** `firstOfStream.ts` の docstring は
「**038a の `sessionIdRef`（窓マウント毎に採番する session_id）と同じ粒度で、「その配信」の定義が揃っている**」と
明記している。＝ 両者は「たまたま同じマウント単位」であることに寄りかかっている。

⇒ **062b で `session_id` だけを配信単位にすると、この 2 つが初めて食い違う**:

| | 窓を開き直したとき |
|---|---|
| `session_id`（062b 後） | **変わらない**（同じ配信のまま） |
| 初コメ判定の Map | **リセットされる**（マウント単位のまま） |

⇒ **同じ配信の途中で窓を開き直すと、既に喋っていた常連にもう一度「初コメ」バッジが出る。**
（062b 以前は `session_id` も一緒にリセットされていたので、少なくとも定義は揃っていた。）

⚠ **着手時に決めること**: ①受容する（バッジが再表示されるだけ・記録には影響しない）
②Map の寿命をセッションに合わせる（`session_id` が変わったときだけリセット）。
**どちらにせよ `firstOfStream.ts` の docstring は嘘になるので必ず書き換えること。**
⚠ 完了条件の「051 の初コメ判定が壊れない」は、**この食い違いを決めて固定する**という意味に読み替える。

### ⚠ 訂正 2: `connectionStatus.ts` は状態を「持って」いない

本文の必読前提は「`connectionStatus.ts` が状態を持っている」と書いているが、実際に export しているのは
**`deriveConnectionStatus(sessionState: string)` という純関数**と `STATUS_LABEL` / `ConnectionStatus` 型だけ。

**接続状態の実体は [`CommentViewerApp.tsx`](../../apps/desktop/src/screens/comment-viewer/CommentViewerApp.tsx) が
provider 別の 2 つの `useState<string>` で持っている**（`sessionState` / `youtubeSessionState`）。
書き込みは `connectCommentStream` の `onSessionState(platform, state, reason)` ハンドラ 1 か所。
⇒ **セッション境界の判定はここに足すことになる**（新しい状態の持ち主を作らない）。

⚠⚠ **`onConnectionChange` → `streamConnected` と混同しないこと。** あれは
**viewer webview ↔ sidecar の loopback WS が繋がっているか**であって、**配信プラットフォームへの接続ではない**。
これを境界に使うと「アプリを開いた＝配信開始」になる。

### ⚠ 訂正 3: FK を張らない理由の説明が不正確

本文 (2) は「FK を張ると `PRAGMA foreign_keys = ON` で**既存 DB が壊れる**」と書いているが、
機序が違う。**SQLite は `PRAGMA foreign_keys = ON` の時点で既存行を検証しない**
（違反は書き込み時か `PRAGMA foreign_key_check` で初めて表面化する）。

正しい理由は次の 3 点（**結論＝FK を張らない、は変わらない**）:

1. **SQLite は `ALTER TABLE` で FK 制約を後から追加できない。** 張るなら
   `viewer_comments` を**丸ごと作り直す**しかない（新テーブル作成 → コピー → DROP → RENAME）。
   ⚠ このテーブルは 043e 以降 **append-only ではなく UPDATE も走る**ので、作り直しは相応にリスクがある。
2. 既存データには `stream_sessions` に対応行の**無い `session_id` が大量にある**（本文 (5)）。
   作り直したうえで FK を張れば、**それらの行が挿し直せない／捨てるしかない**。
3. 本タスクは**バックフィルしない**と決めている（セッションを捏造しない）ので、対応行は永遠に作られない。

⇒ **緩い関連（アプリ側で JOIN するだけ）にする**。⚠ **この 3 点をコメントに残すこと**
（「FK を張ると壊れるから」だけ書くと、次の人が「検証されないなら張ってもいいのでは」と誤読する）。

### 申し送り 4: `viewer_comments` の現在の列（062a 完了後）

```
id / viewer_id / session_id / source / text / event_type /
amount / currency / monetary_amount / raid_viewer_count / published_at / created_at
```

⚠ 本文 (7) の「`viewer_comments` に FK が張られていない」テストを書くときは、この列構成が正。
**062a の `raid_viewer_count` は追加済み**なので、本文「やらないこと」の
「`viewer_comments` のスキーマ変更（062a が `raid_viewer_count` を足すのみ）」は **完了済み**と読むこと。

### 申し送り 5: `sessionIdRef` の使用箇所は**実測で 2 か所**（本文の記述どおり）

`recordComments(added, sessionIdRef.current, handleRecordResult)` と
`recordComments(updated, sessionIdRef.current)` の 2 つのみ（`CommentViewerApp.tsx`）。
⚠ **`recordComments` の呼び出し自体がリポジトリ全体でこの 2 か所だけ**なので、
「他の窓（`OverlayApp` / `PinnedOverlayApp`）からも記録されている」心配は無い。

### ⚠ 申し送り 6: dev-mock でセッション境界を駆動できる（実機確認が軽くなる）

[`dev-mock.ts`](../../apps/comment-sidecar/src/dev-mock.ts) の `handleControl` は
**`sendSessionState(provider, "connecting" → "connected")`**、stop で **`"idle"`** を合成発行する。
⇒ **`COMMENT_SIDECAR_MOCK=1` で「接続 → 切断 → 再接続」を実配信なしに再現でき、
猶予中の再接続・猶予超過の終了・provider 別の platforms を目視できる。**
⚠ ただし 062a の穴 F と同じ注意: dev-mock は `wire.ts` を通らない。もっとも **062b は sidecar を
1 バイトも触らない**ので、この経路差は 062b の担保には影響しない（`git status` で
`apps/comment-sidecar/` の差分ゼロを確認すること＝確認コマンドに既に入っている）。

### ⚠⚠ 申し送り 7: `check:bindings` は**新規 binding では `git add -N` が要る**（062a とは事情が違う）

`check:bindings` は `pnpm gen:bindings && git diff --exit-code -- <binding dirs>` で、
**作業ツリー vs インデックス**を見る。

- **062a**（既存 binding の変更）… `git add -N` は**未追跡ファイル専用なので効かなかった**。
  binding を `git add` して初めて通った。
- **062b**（`StreamSessionRecord` 等の**新規 binding ファイル**）… こちらは**未追跡**なので
  **`git add -N` が正しく効く**。⚠ **これを挟まないと `git diff --exit-code` は新規ファイルを
  そもそも見ないので、生成漏れがあっても緑になる**（＝チェックが素通りする）。

⇒ **新規 binding を足すタスクでは `git add -N` を必ず挟むこと。**

### 申し送り 8: コマンド 6 本を足しても capability は増えない

`docs/security.md` の「コメントビューア（配信サービス連携）方針」⑪ に
**「アプリ定義コマンドは ACL 列挙不要」**と明記されている（038a が `record_comment` 等を足したときの先例）。
⇒ 本文 (3) の 6 コマンドを足しても **`capabilities/` は差分ゼロ**にできる。完了条件どおり。

---

## 目的

「**1 回の配信**」を明示的に記録する。[062c](062c-stream-summary-view.md) / [062d](062d-stream-history-filter.md) が
集計・フィルタする単位をここで確定させる。

## 現在の前提（調査結果・実コード）

### `session_id` はあるが「配信」ではない

- `viewer_comments` は**既に `session_id` 列と `idx_viewer_comments_session` を持っている**（038a）。
- ⚠ しかし採番は [`CommentViewerApp.tsx`](../../apps/desktop/src/screens/comment-viewer/CommentViewerApp.tsx) の
  `sessionIdRef` で、**コメビュ窓のマウント単位**（`crypto.randomUUID()`）。
  `recordComments(added, sessionIdRef.current, …)` でそのまま保存されている。
  → **窓を開き直すと別セッションになり、1 回の配信が複数に分裂する。**
  → 逆に、**窓を開きっぱなしで 2 日配信すると 2 回の配信が 1 つに混ざる。**
- **セッションのメタ情報（開始/終了時刻・プラットフォーム・タイトル）を持つテーブルは存在しない。**
  現状 `session_id` は束ねるキーでしかなく、**いつの配信かは `published_at` から推測するしかない**。

### 接続状態は既に観測できる

- sidecar → viewer に `session.state` / `account.state` が流れており、
  [`connectionStatus.ts`](../../apps/desktop/src/features/comment-viewer/connectionStatus.ts) が状態を持っている。
  ⚠ **→ 訂正 2 を参照。** `connectionStatus.ts` は**純関数だけ**で状態を持っていない。実体は
  `CommentViewerApp` の `sessionState` / `youtubeSessionState`。⚠ `streamConnected` と混同しないこと。
- [035a](035a-sidecar-concurrent-sessions.md) で **provider 別（YouTube / Twitch）の並行セッション**になっており、
  「両方接続」「片方だけ」が起こりうる。
  ⚠ **「配信の開始」は provider ごとなのか、まとめて 1 つなのか**を決める必要がある。

### マイグレーション基盤は無い

- `repository::init` の `CREATE TABLE IF NOT EXISTS` ＋ [`util.rs`](../../apps/desktop/src-tauri/src/util.rs) の
  `ensure_column`（冪等）で運用。`PRAGMA user_version` は未使用。

## このタスクでやること

### (1) セッション境界を確定する ← ⚠ 本タスクの中心

親 [062](062-stream-summary.md) の推奨は **(c)「接続開始/切断に紐づけ、一定時間内の再接続は同一セッションへ継続」**。
実装時に次を確定させ、**理由をコメントに残すこと**。

- **開始の契機**: どれかの provider が「接続済み」になった瞬間。
- **終了の契機**: 全 provider が切断され、**猶予時間（例 30 分）** 経過したとき。
  ⚠ **猶予中の再接続は同じセッションを継続する**（配信中の一時的な切断で記録が割れないように）。
  ⚠ **猶予タイマーは必ず取り消せるようにする**（045c で「猶予タイマーの取り消し漏れ」が実際に回帰を作った）。
- **アプリ終了時**: 走っているセッションを**開いたまま**にする（次回起動時に猶予判定で閉じる）。
  ⚠ **閉じ忘れたセッションが永久に「配信中」になる**のを防ぐため、
  **起動時に「最終コメントから猶予時間以上経過している未終了セッション」を閉じる**処理を入れる。
- **YouTube と Twitch の同時配信は 1 セッション**にする（`platforms` に両方を記録）。
  ⚠ 分けると「同じ配信の集計が 2 つに割れる」＝要望「この配信は」が満たせない。

### (2) `stream_sessions` テーブル

```sql
CREATE TABLE IF NOT EXISTS stream_sessions (
    id           TEXT PRIMARY KEY,   -- viewer_comments.session_id と同じ値
    started_at   TEXT NOT NULL,
    ended_at     TEXT,               -- NULL = 進行中
    platforms    TEXT NOT NULL,      -- "youtube" / "twitch" / "youtube,twitch"（正規化した順で保存）
    title        TEXT NOT NULL DEFAULT '',  -- 配信タイトル（手入力・任意）
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stream_sessions_started ON stream_sessions(started_at);
```

- ⚠ **`viewer_comments.session_id` に FK を張らない。**
  既存データには `stream_sessions` に対応行が無い `session_id` が残っており、
  FK を張ると `PRAGMA foreign_keys = ON`（接続ごとに実行される）で**既存 DB が壊れる**。
  → **緩い関連**（アプリ側で JOIN するだけ）にする。**この判断はコメントに残す。**
  ⚠ **→ 訂正 3 を参照。結論は同じだが理由の説明が不正確。** `PRAGMA foreign_keys = ON` は
  既存行を検証しない。正しい理由は「SQLite は `ALTER TABLE` で FK を後付けできず、
  張るには 043e 以降 UPDATE も走る `viewer_comments` の**作り直し**が要る」ほか 2 点。
- `title` は**手入力**（任意）。⚠ 自動取得は「新規 API 呼び出しが増える」ので**本タスクではやらない**
  （要望は「この配信は」でフィルタできることで、タイトルは手入力でも満たせる）。

### (3) コマンド

| コマンド | 引数 | 戻り | 備考 |
|---|---|---|---|
| `start_stream_session` | `platforms: Vec<String>` | `StreamSessionRecord` | 進行中があれば**それを返す**（冪等） |
| `update_stream_session_platforms` | `id, platforms` | `StreamSessionRecord` | 途中で片方が繋がったとき |
| `end_stream_session` | `id: String` | `StreamSessionRecord` | 冪等（既に終了済みなら何もしない） |
| `list_stream_sessions` | （フィルタ引数は [062d](062d-stream-history-filter.md) で足す） | `Vec<StreamSessionRecord>` | read-only |
| `update_stream_session_title` | `id, title` | `StreamSessionRecord` | |
| `close_stale_stream_sessions` | `graceMinutes: i64` | `usize` | 起動時に呼ぶ（閉じ忘れの回収） |

- ⚠ **すべて単一目的**（§3）。汎用の「セッションを任意に書き換える」コマンドは作らない。
- `title` は**ユーザー入力**なので Rust 側で検証する（長さ上限・制御文字拒否・§8）。

### (4) `sessionIdRef` の置き換え（`CommentViewerApp.tsx`）

- 窓マウント単位の `crypto.randomUUID()` をやめ、**`start_stream_session` が返した id を使う**。
- ⚠ **接続前に届くコメントが無いことを確認する**。もし「セッション未確立の状態で `recordComments` が
  呼ばれうる」なら、そのときの `session_id` をどうするか決める
  （推奨＝**セッションが無ければ記録しない**のではなく、**その場でセッションを開始する**。
  記録の取りこぼしのほうが痛い）。
- ⚠ **既存の `sessionIdRef` を使っている箇所は 2 つ**（`recordComments(added, …)` と
  `recordComments(updated, …)`）。**両方を漏れなく差し替える。**
- ⚠ **[051 の「その配信の初コメント」判定（`firstOfStream.ts`）が `session_id` の粒度に依存している**
  可能性がある。実装時に確認し、**粒度が変わることで初コメ判定が変わらないか**を必ず見ること。
  （窓を開き直すたびに「初コメ」が出ていたのが、配信単位になる＝**むしろ正しくなる**はずだが、
  意図した変更であることをテストで固定する。）
  ⚠⚠ **→ 訂正 1 を参照。この見立ては逆だった。** `firstOfStream.ts` は `session_id` を**読んでいない**
  （マウント単位の `Map`）ので、**自動的には正しくならない**——`session_id` だけが配信単位になると
  両者が初めて**食い違い**、同じ配信の途中で窓を開き直すと常連に「初コメ」が**再表示される**。
  受容するか Map の寿命を合わせるかを決め、**`firstOfStream.ts` の docstring も必ず書き換える**こと。

### (5) 既存データの扱い

- ⚠ 既存の `viewer_comments` には `stream_sessions` に対応行の無い `session_id` が大量にある。
- **バックフィルはしない**（`published_at` から推測してセッションを捏造しない）。
- [062c](062c-stream-summary-view.md) / [062d](062d-stream-history-filter.md) では
  **`stream_sessions` に載っているセッションだけを一覧に出す**。
  ⚠ **「過去の配信が出てこない」ことをユーザーに伝える**（サマリー画面に 1 行注記）。
  黙っていると「壊れている」と思われる。

### (6) security.md の更新

| 節 | 追記内容 |
|---|---|
| §9 端末保存 | 配信セッションのメタ情報（開始/終了時刻・プラットフォーム・**ユーザーが入力したタイトル**）を新テーブルに保存する。第三者の個人データは含まない |

### (7) テスト

- Rust `repository.rs` / `service.rs`:
  - `start_stream_session` が冪等（進行中があれば同じ行を返す）
  - `end_stream_session` が冪等
  - `close_stale_stream_sessions` が猶予時間内のセッションを閉じない／超過したものだけ閉じる
  - `platforms` が正規化した順で保存される（`"twitch,youtube"` と `"youtube,twitch"` が同一にならないと困る）
  - `title` の検証（長さ上限・制御文字）
  - **`viewer_comments` に FK が張られていない**こと（既存 DB が壊れない担保）
- frontend:
  - 接続 → セッション開始、全切断 → 猶予後に終了
  - **猶予中の再接続で同じセッションが継続する**
  - **猶予タイマーが取り消される**（045c の回帰と同型のケース）
  - `recordComments` の 2 か所が新しい session id を使う
  - 051 の初コメ判定が壊れない
- **ミューテーションで実効性を確認**する。最低限、猶予判定を反転させたときにレッドになること。

## このタスクでやらないこと

- **サマリーの集計・表示**（[062c](062c-stream-summary-view.md)）。本タスクはセッションを記録するだけ。
- **フィルタ**（[062d](062d-stream-history-filter.md)）。
- **既存データのバックフィル**（セッションを捏造しない）。
- **配信タイトルの自動取得**（新規 API 呼び出しが増えるため。手入力で満たす）。
- 視聴者数・同時接続数の記録（別 API・別スコープが要る）。
- 配信のアーカイブ URL の記録。
- `viewer_comments` のスキーマ変更（[062a](062a-twitch-raid-ingestion.md) が `raid_viewer_count` を足すのみ
  ＝ ✅ **2026-08-16 に追加済み**。現在の列構成は「申し送り 4」が正）。

## セキュリティ制約（docs/security.md 準拠）

- **外部通信ゼロ**（§1）。セッションの開始/終了は**既に受信している接続状態**から判定する。
  **新規 API 呼び出し・新規購読・新規スコープはゼロ。**
- **§9 端末保存**: 保存するデータの種別が増える（配信セッションのメタ情報）。security.md へ追記。
  ⚠ ただし**第三者の個人データは含まない**（時刻・プラットフォーム・ユーザー自身が入力したタイトルのみ）。
  この点で [038a](038a-viewer-memory-data-layer.md) や [062a](062a-twitch-raid-ingestion.md) より軽い。
- **識別子はコンパイル時定数のみ・値はパラメータバインド**（§8）。
- **`title` はユーザー入力**なので Rust 側で検証する（長さ上限・制御文字拒否・§8）。
- **コマンドは単一目的**（§3）。汎用の書き換えコマンドを作らない。
- ⚠ **既存 DB を壊さない**（FK を張らない・`CREATE TABLE IF NOT EXISTS` ＋ `ensure_column` の作法）。
- ログにタイトル・セッション id を出さない（§9）。
- **capability を増やさない**・`csp: null` 不変・**新規依存ゼロ**。

## 完了条件

- `stream_sessions` テーブルとコマンド 6 本が動く。
- 配信に接続するとセッションが始まり、全切断＋猶予後に終了する。**猶予中の再接続は継続する。**
- **アプリを落として再起動しても、閉じ忘れたセッションが回収される。**
- YouTube と Twitch の同時配信が **1 セッション**になり、`platforms` に両方が記録される。
- `viewer_comments.session_id` が新しいセッション id を使う（**2 か所とも**）。
- **051 の初コメ判定と `session_id` の粒度の食い違いを決めて固定してある**（訂正 1）。
  ⚠ 受容するなら「窓を開き直すと初コメが再表示される」ことをテストで固定し、
  合わせるなら「同一セッション中の再マウントで初コメが再表示されない」ことを固定する。
  **どちらでも `firstOfStream.ts` の docstring を書き換える**（「`sessionIdRef` と同じ粒度」は嘘になる）。
- **`viewer_comments` に FK が張られていない**（既存 DB が壊れない）。
- 既存データが一覧に出ないことがユーザーに伝わる。
- [`docs/security.md`](../security.md) §9 に (6) が追記されている。
- ts-rs binding が生成され `pnpm check:bindings` が通る。
  ⚠⚠ **新規 binding ファイルは未追跡なので、`git add -N` を挟まないと `git diff --exit-code` が
  そもそも見に行かず、生成漏れがあっても緑になる**（申し送り 7）。
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

# ゼロ拡大の担保（差分ゼロが期待）
git status --short -- apps/desktop/src-tauri/capabilities/ apps/desktop/src-tauri/tauri.conf.json .github/ apps/comment-sidecar/
# 新規依存ゼロの担保（差分ゼロが期待）
git status --short -- apps/desktop/package.json pnpm-lock.yaml package.json apps/desktop/src-tauri/Cargo.toml

pnpm --filter ./apps/desktop tauri dev
# ① Twitch に接続 → セッションが始まる（DB を sqlite3 で覗いて stream_sessions に行ができる）
# ② YouTube も接続 → platforms が "twitch,youtube" になる（新しいセッションが増えない）
# ③ 切断 → 猶予中は ended_at が NULL のまま／再接続すると同じセッションが続く
# ④ 猶予を過ぎる → ended_at が入る
# ⑤ 接続中にアプリを強制終了 → 再起動時に close_stale_stream_sessions が回収する
# ⑥ コメビュ窓を閉じて開き直しても、同じ配信なら session_id が変わらない（本タスクの主目的）
# ⑦ 既存 DB（実装前のデータがある状態）で起動してもエラーが出ない
```

## 実装後に必要なレビュー

- **security-review 必須**（[`security-review`](../../.claude/skills/security-review/SKILL.md)）。対象:
  - **§9 保存データ種別の変更**（何を保存し、何を保存しないか）
  - `title`（ユーザー入力）の Rust 側検証
  - §8（識別子は定数・値はバインド）
  - **既存 DB を壊さない**こと（FK 不使用・冪等な init）
  - 新規通信・新規スコープがゼロであること
