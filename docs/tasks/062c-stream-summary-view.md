# 062c 配信サマリー画面（集計と表示）

> 状態: **未着手（実装サブタスク）**。分割・線引きは親 [062](062-stream-summary.md) を正とする。
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
> ⚠ **着手条件＝[062b](062b-stream-session-recording.md) 完了**（集計単位が決まらないと画面が作れない）。

## 目的

依頼者の要望⑤の本体を実装する。1 回の配信について次を出す。

- **総コメント数**
- **総課金額**（⚠ 通貨ごと）
- **総課金回数**
- **サブスク件数**
- **誰が課金チャットやサブスクをしてくれたか**（⚠ **マスト**）
- **誰がレイドしてくれたか**（Twitch のみ・[062a](062a-twitch-raid-ingestion.md)・⚠ **マスト**）

## 現在の前提（調査結果・実コード）

- 集計元は `viewer_comments`（`session_id` / `source` / `event_type` / `amount` / `currency` /
  `monetary_amount` / `published_at` / `viewer_id`）。`idx_viewer_comments_session` が効く。
- `viewers` は**視聴者単位の累計**（配信単位ではない）。⚠ **サマリーで `viewers` の列を使わない**
  （`superchat_amount` 等は全期間の累計で、この配信のぶんではない）。
- 既存の集計 SQL（`RECOMPUTE_VIEWER_AGGREGATES_SQL`）が種別をどう数えているかが**意味論の手本**:
  - bits = `currency = 'BITS'`
  - スパチャ = `event_type = 'superchat' AND currency IS NOT NULL AND currency <> 'BITS'`
  - サブスク系 = `event_type IN ('subscription', 'membership', 'gift')`
  ⚠ **サマリーもこの分類に揃える**（画面ごとに違う数え方をすると、視聴者一覧と数字が合わなくなる）。
- ⚠ **既知の歪み 3 つ**（親 062 に詳細）:
  1. **Twitch コミュニティギフトの N+1**（`subscription_count` が水増しされる）
  2. **YouTube Jewels の単位未確定**（単価か累計か不明）
  3. **通貨が混在**（`superchat_amount` は通貨を問わず合計する `REAL`）
- 表示の文言整形は [`viewerFormat.ts`](../../apps/desktop/src/screens/comment-viewer/viewerFormat.ts) に既にある
  （`eventLabel` / `composeEventMessage` / 金額の verbatim 表示）。**再利用する。**

## このタスクでやること

### (1) 集計クエリ（Rust `stream_summary` モジュール）

- `src-tauri/src/stream_summary/`（`commands.rs` / `service.rs` / `repository.rs` / `model.rs`）を新設。
  ⚠ `viewer_memory` に足さない（責務が違う＝あちらは視聴者単位の累計、こちらは配信単位の集計）。
- `get_stream_summary(session_id) -> StreamSummary`:

```
StreamSummary {
  session: StreamSessionRecord,
  total_comments: i64,          // event_type <> 'raid'（062a の決定に合わせる）
  monetary_total_count: i64,    // 課金イベントの回数
  monetary_by_currency: Vec<{ currency: String, amount: f64, count: i64 }>,  // ⚠ 通貨ごと
  jewels_count: i64,            // ⚠ 金額は合算しない（単位未確定）
  subscription_count: i64,      // event_type IN ('subscription','membership','gift')
  contributors: Vec<Contributor>,  // 誰がいくら（マスト）
  raids: Vec<RaidRecord>,          // 誰がレイドしたか（Twitch のみ・マスト）
}
```

- `Contributor` = `{ viewer_id, name, source, monetary_by_currency, subscription_count, first_at }`
  ⚠ **「誰がいくら」がマスト要件**なので、ここが画面の主役。金額降順で並べる。
- `RaidRecord` = `{ name, viewer_count, at }`
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
- ⚠ **これらの注記を消さない**。数字が売りの機能で、限界を隠すと配信者が誤った数字を信じる。
  **テストで注記の存在を固定する**（054 の E2E 追補②で「文言を消した結果、担保が失われた」経緯がある）。
- ⚠ **[062b](062b-stream-session-recording.md) 実装前のデータは一覧に出ない**旨も 1 行出す。

### (4) 進行中セッションの扱い

- `ended_at` が NULL のセッションも見られるようにする（配信中に途中経過を見たい）。
- ⚠ ただし**「配信中」と明示する**（数字が確定していないことが分かるように）。

### (5) テスト

- Rust `repository.rs` の集計テスト:
  - 通貨が混在するデータで `monetary_by_currency` が正しく分かれること（**JPY と USD と BITS**）
  - `jewels` が総課金額に**合算されない**こと
  - `raid` が `total_comments` / `subscription_count` に**入らない**こと
  - 貢献者が金額降順に並ぶこと
  - 別セッションのデータが混ざらないこと（`session_id` のバインド）
  - ⚠ **既存 SQL（`RECOMPUTE_VIEWER_AGGREGATES_SQL`）と分類が一致する**こと
    （同じデータで視聴者一覧とサマリーの数え方がずれないこと）
- frontend:
  - 貢献者一覧・レイド一覧が出ること
  - **3 つの注記が出ること**（消えたら落ちるテスト）
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
- **既知の歪み 3 つの注記が出ている**（テストで固定）。
- **Jewels が総課金額に合算されていない。**
- **視聴者一覧（038b）と数え方が一致する**（同じデータで矛盾しない）。
- 進行中セッションが「配信中」と分かる。
- ts-rs binding が生成され `pnpm check:bindings` が通る。
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
git status --short -- apps/desktop/package.json pnpm-lock.yaml package.json

pnpm --filter ./apps/desktop tauri dev
# ① dev-mock でスパチャ（JPY）・ビッツ・サブスク・ギフト・Jewels・レイドを一通り流す
# ② サマリー画面で「JPY 〇〇 / BITS 〇〇」と**通貨ごとに**出る（混ざらない）
# ③ Jewels は「N 回」だけ出て、総課金額に入っていない
# ④ 貢献者一覧が金額降順に並び、行から視聴者詳細へ飛べる
# ⑤ レイド一覧に「誰が何人」が出る（YouTube 単独でも欄は出て「Twitch のみ」と分かる）
# ⑥ 3 つの注記が出ている
# ⑦ 視聴者一覧（038b）の数字とサマリーの数字が矛盾しない
```

## 実装後に必要なレビュー

- **軽レビュー**（[`code-review-light`](../../.claude/skills/code-review-light/SKILL.md)）。
- ⚠ ただし次は軽レビューでも必ず確認する:
  - **§8**（識別子は定数・`session_id` はバインド）
  - **集計結果をキャッシュテーブルに保存していない**こと（§9 の判断をやり直さない）
  - **既知の歪みの注記が実装されている**こと（数字の信頼性に直結する）
