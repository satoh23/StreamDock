# 062d 配信履歴とフィルタ（配信別／月別／年別）

> 状態: **未着手（実装サブタスク）**。分割・線引きは親 [062](062-stream-summary.md) を正とする。
>
> **必読前提**: 親 [062](062-stream-summary.md)、セッション記録 [062b](062b-stream-session-recording.md)、
> **サマリー画面 [062c](062c-stream-summary-view.md)（集計クエリと表示の正）**、
> データ層 [`viewer_memory/repository.rs`](../../apps/desktop/src-tauri/src/viewer_memory/repository.rs)（**「識別子はコンパイル時定数のみ」の規律**と `ViewerSort` の作法）、
> 一覧 UI の作法 [038b](038b-viewer-list-detail-and-notes.md) / [`ViewersView.tsx`](../../apps/desktop/src/screens/comment-viewer/ViewersView.tsx)、
> [`docs/security.md`](../security.md)（**§8 ユーザー入力を信頼しない**／§9）。
> CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。**軽レビュー**。
>
> ⚠ **行番号は書かない**（特定はシンボル名で行うこと）。
> ⚠ **着手条件＝[062c](062c-stream-summary-view.md) 完了**。

## 目的

依頼者の要望⑤の後半「**あとから見返すこともでき、何月は誰がいくらくれたとか、今年はとか、
この配信はみたいな感じでフィルタリングもできると良い**」を実装する。

## 現在の前提（調査結果・実コード）

- [062b](062b-stream-session-recording.md) で `stream_sessions`（`started_at` / `ended_at` /
  `platforms` / `title`）と `idx_stream_sessions_started` ができている。
- [062c](062c-stream-summary-view.md) で `get_stream_summary(session_id)` の集計ができている。
  ⚠ **本タスクは「期間で集計する」版が要る**（`session_id` 1 本ではなく範囲）。
- ⚠ **[`viewer_memory/repository.rs`](../../apps/desktop/src-tauri/src/viewer_memory/repository.rs) 冒頭の規律**:
  > 識別子（テーブル名・ORDER BY 句）は**コンパイル時定数のみ**を使い、値は必ずパラメータバインドする（§8）
  **フィルタ機能はまさにここを破りたくなる場所**（動的 WHERE / 動的 ORDER BY）。**本タスク最大の注意点。**
- `ViewerSort`（`viewer_memory/model.rs`）が「ソート指定を enum で受けて、SQL 側は定数から選ぶ」という
  **手本**になっている。**同じ形にする。**
- `published_at` は ISO8601 の文字列で保存されており、first/last は**辞書順比較**している
  （全 provider が UTC・同形 ISO8601 を送る前提。038a に明記されている）。
  ⚠ **月別・年別の集計はローカルタイムでやりたい**が、保存は UTC。**ここがずれる**（下記 (2)）。

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
  それでも遅いなら**その時点で本人に相談**（キャッシュは §9 の再レビューが要る）。

### (2) 期間フィルタ（月別／年別）— ⚠ タイムゾーンの扱いを決める

- `get_period_summary(from: String, to: String) -> StreamSummary` 相当を足す
  （[062c](062c-stream-summary-view.md) の `StreamSummary` を期間版で返す）。
- ⚠ **`published_at` は UTC の ISO8601 文字列**で、辞書順比較で範囲を切る。
  一方ユーザーが期待する「2026 年 8 月」は**ローカルタイム**。
  → **frontend でローカルの月境界を UTC の ISO8601 に変換してから渡す**のが素直
  （Rust に `chrono-tz` を足さない＝新規依存ゼロ）。
  ⚠ **境界がずれる**（日本時間 8/1 00:00 = UTC 7/31 15:00）。**これは正しい挙動**だが、
  実装時に**必ずテストで固定する**（でないと「月初のスパチャが前月に入る」という気づきにくいバグになる）。
  ⚠ **決めた方式をコメントに残す。**
- ⚠ **`from` / `to` は frontend から来る文字列**なので Rust 側で検証する（§8）:
  ISO8601 として `chrono` でパースできること・`from <= to`・範囲の上限（例 10 年）。
  **パースせずに SQL へ渡さない。**

### (3) フィルタ UI

- 期間の選択:
  - **プリセット**（今月 / 先月 / 今年 / 全期間）＋ **年月の指定**
  - ⚠ **日付ピッカーを自作しない**。年と月のセレクトで足りる（要望は「何月は」「今年は」）。
- プラットフォームの絞り込み（YouTube / Twitch / 両方）。
  ⚠ `platforms` は `"youtube,twitch"` のような文字列なので、**`LIKE` ではなく**
  正規化した順で保存されている前提の完全一致 or `IN` で引く（[062b](062b-stream-session-recording.md) が
  正規化を保証している）。⚠ `LIKE '%twitch%'` にすると将来の値追加で壊れる。
- ⚠ **貢献者一覧は期間フィルタの主役**。「何月は誰がいくらくれたか」がマスト要件なので、
  期間集計でも**貢献者一覧を必ず出す**（数字のタイルだけにしない）。

### (4) 表示

- 期間サマリーは [062c](062c-stream-summary-view.md) と**同じコンポーネントを再利用**する
  （数字のタイル・貢献者一覧・レイド一覧）。
  ⚠ **表示を 2 実装に分けない**（片方だけ注記が消える等の分裂が起きる）。
- ⚠ **[062c](062c-stream-summary-view.md) の 3 つの注記**（コミュニティギフト N+1 / Jewels の単位 /
  通貨を換算しない）は**期間サマリーでも出る**こと。
- 期間の表示に**タイムゾーンの断り**を 1 行入れる（「集計はお使いの PC の時刻で区切っています」程度）。

### (5) テスト

- Rust:
  - `StreamSessionSort` が enum で受けられ、**SQL に文字列を埋めていない**こと
    （⚠ `command_contract` 型のテストで「`format!` で ORDER BY を組んでいない」を機械的に固定してもよい）
  - `from` / `to` の検証（不正な ISO8601・`from > to`・範囲超過が拒否される）
  - **月境界の変換**: 日本時間の月初/月末に投げられたスパチャが正しい月に入ること
    （⚠ UTC との 9 時間差を跨ぐケースを必ず入れる）
  - `platforms` の絞り込みが完全一致 / `IN` で効くこと（`LIKE` に依存していないこと）
  - 期間集計が [062c](062c-stream-summary-view.md) の単一セッション集計と**分類が一致する**こと
- frontend:
  - プリセット（今月 / 先月 / 今年 / 全期間）が正しい範囲を渡すこと
  - **期間サマリーでも貢献者一覧と 3 つの注記が出る**こと
- **ミューテーションで実効性を確認**する。最低限、月境界の変換を UTC 固定に変えたときにレッドになること。

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

## セキュリティ制約（docs/security.md 準拠）

- **外部通信ゼロ**（§1）。
- ⚠ **§8 が本タスクの最重要項目**:
  - **識別子（テーブル名・ORDER BY 句）はコンパイル時定数のみ。** ソートは enum で受ける（`ViewerSort` と同型）。
  - **値は必ずパラメータバインド。** `from` / `to` / `platforms` を SQL 文字列に埋めない。
  - **frontend から来る日付文字列を Rust 側で検証する**（パースできること・順序・範囲上限）。
- **§9 で新しい保存はしない**（既存データを読んで集計するだけ・キャッシュも作らない）。
- ログに視聴者名・金額・期間を出さない（§9）。
- **capability を増やさない**・`csp: null` 不変・**新規依存ゼロ**・生 hex ゼロ。

## 完了条件

- 配信履歴の一覧が出て、行を開くと [062c](062c-stream-summary-view.md) の詳細が見られる。
- **今月 / 先月 / 今年 / 全期間 / 年月指定**で集計を切り替えられる。
- **期間集計でも貢献者一覧（誰がいくら・誰がサブスク）が出る**（マスト）。
- **月境界がローカルタイムで正しく切れる**（UTC との差を跨ぐケースがテストで固定されている）。
- プラットフォーム絞り込みが `LIKE` に依存せず動く。
- **SQL に文字列を埋めていない**（ソートは enum・値はバインド）。
- [062c](062c-stream-summary-view.md) の 3 つの注記が期間サマリーでも出る。
- 表示コンポーネントが 062c と共有されている（2 実装に分かれていない）。
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

# §8 の担保: SQL 組み立てに format!/文字列連結が入っていないこと（目視 + grep）
grep -rn "format!" apps/desktop/src-tauri/src/stream_summary/ || echo "format! なし"

# ゼロ拡大の担保（差分ゼロが期待）
git status --short -- apps/desktop/src-tauri/capabilities/ apps/desktop/src-tauri/tauri.conf.json .github/ apps/comment-sidecar/
# 新規依存ゼロの担保（差分ゼロが期待）
git status --short -- apps/desktop/package.json pnpm-lock.yaml package.json apps/desktop/src-tauri/Cargo.toml

pnpm --filter ./apps/desktop tauri dev
# ① 履歴一覧に過去の配信が新しい順に並ぶ／行を開くと詳細が出る
# ② 「今月」「先月」「今年」で数字と貢献者一覧が切り替わる
# ③ 年月を直接指定しても同じ
# ④ **月初 00:05（日本時間）に投げられたスパチャが、その月に入る**（前月に入らない）
# ⑤ プラットフォーム絞り込みが効く
# ⑥ 期間サマリーにも 3 つの注記が出ている
# ⑦ セッション数が増えたときの体感速度（重ければ本人に相談）
```

## 実装後に必要なレビュー

- **軽レビュー**（[`code-review-light`](../../.claude/skills/code-review-light/SKILL.md)）。
- ⚠ ただし **§8 だけは必ず確認する**（本タスクは動的 SQL を書きたくなる唯一の場所）:
  - 識別子（テーブル名・ORDER BY 句）がコンパイル時定数のみであること
  - `from` / `to` / `platforms` がパラメータバインドされていること
  - frontend から来る日付文字列が Rust 側で検証されていること
- ⚠ **月境界のタイムゾーン変換**は、間違っても症状が出にくい（月初/月末だけずれる）ので、
  テストが実際に UTC 差を跨いでいるかをレビューで確認すること。
