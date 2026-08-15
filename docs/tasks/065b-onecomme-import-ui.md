# 065b わんコメ引き継ぎの UI（ファイル選択・取り込み結果・一覧/詳細への反映）

> 状態: **未着手（実装サブタスク）**。分割・線引きは親 [065](065-onecomme-viewer-import.md) を正とする。
> **着手条件＝[065a](065a-onecomme-csv-import-data-layer.md) が完了していること**（本タスクは
> `import_viewer_memory_csv` と `ImportResult` の binding に乗るだけ）。
>
> **必読前提**: 親 [065](065-onecomme-viewer-import.md)、[065a](065a-onecomme-csv-import-data-layer.md)、
> [038b](038b-viewer-list-detail-and-notes.md) と
> [`ViewersView.tsx`](../../apps/desktop/src/screens/comment-viewer/ViewersView.tsx) /
> [`ViewerDetailPanel.tsx`](../../apps/desktop/src/screens/comment-viewer/ViewerDetailPanel.tsx) /
> [`viewerFormat.ts`](../../apps/desktop/src/screens/comment-viewer/viewerFormat.ts)、
> API ラッパの流儀 [`viewerMemoryApi.ts`](../../apps/desktop/src/features/viewer-memory/viewerMemoryApi.ts) と
> [`types.ts`](../../apps/desktop/src/features/viewer-memory/types.ts)、
> **ファイル選択の唯一の先例** [`overlayThemeApi.ts`](../../apps/desktop/src/features/comment-viewer/overlayThemeApi.ts)
> （`importOverlayTheme` が `plugin-dialog` の `open()` の生パスを渡す形）、
> [`docs/security.md`](../security.md)（**§9・「コメントビューア（配信サービス連携）方針」⑪**）。
> CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。
>
> ⚠ **行番号は書かない**（特定はシンボル名で行うこと）。

## 目的

配信者が **CSV を選ぶだけで引き継ぎが終わる**ようにし、**何が引き継がれ、何が引き継がれなかったかを
その場で分かるようにする**。

## 現在の前提（実コードで検証済み・2026-08-16）

- 視聴者一覧は [`ViewersView.tsx`](../../apps/desktop/src/screens/comment-viewer/ViewersView.tsx)
  （**コメビュ窓 `comment-viewer` の中**）。詳細は `ViewerDetailPanel.tsx` に切り出されており、
  **一覧とコメント本体のサイドパネルの両方から使われる**（038b フォローアップ）。
- 操作はすべて `viewerMemoryApi`（Tauri command の薄い invoke ラッパ）経由。
  **WS / TTS / sidecar 制御は持たない**表示専用の流儀。
- 破壊的操作は必ず `ConfirmDialog` を経由する（`clear_viewers` は UI に出していない）。
- 表示整形は `viewerFormat.ts`（`providerLabel` / `fmtDateTime` / `fmtNumber` / `fmtSuperchat`）に集約。
- ボタン意匠は `components/compactButtons.module.css`（061g で共有化。**寸法・配色はこの窓の 6 ファイルと共有**）。
- **`dialog:allow-open` は [`capabilities/comment-viewer.json`](../../apps/desktop/src-tauri/capabilities/comment-viewer.json)
  に付与済み**（060b が settings 画面で `.css` を選ぶために足した）。
  ⇒ **本タスクで capability は増えない。** `fs:*` はゼロ付与のまま。
- ⚠ **`SummaryView.test.tsx` が「画面に長い説明文（注記）を出さない」を構造で固定している**
  （`(ます|です)。` で終わる 30 文字以上の散文が 1 つも無いこと）。⚠ **同じ窓に長い注記を書く設計にしないこと。**

## このタスクでやること

### (1) `viewerMemoryApi` に `importViewerMemoryCsv` を足す

- `overlayThemeApi.ts` の `importOverlayTheme` と**同型**：`plugin-dialog` の `open()` が返した
  **生パス**をそのまま渡すだけ。⚠ **検証は Rust 側で必ず再実行される**（frontend の検証は UX のためだけ）。
- ⚠ **frontend は取り込み前のファイルを読む手段を持たない**（`open()` はパス文字列しか返さず `fs:*` は無い）。
  ⇒ **プレビューは実装できない**。この制約は 060b と同じ（`cssScope.ts` の記述と同趣旨）。

### (2) 取り込みの導線（`ViewersView`）

- 視聴者一覧に「**わんコメから引き継ぐ**」ボタンを 1 つ置く。
- 押すと `open()` で `.csv` フィルタ付きのファイル選択 → `importViewerMemoryCsv(path)` → 結果表示 → 一覧を再取得。
- ⚠ **取り込み中は多重実行を防ぐ**（ボタンを無効化する）。61 名で一瞬だが、大きい CSV では待ちが出る。
- ⚠ **「引き継ぎ」は既存データを書き換える操作**なので、**実行前に `ConfirmDialog` を挟む**
  （既存の破壊的操作の作法に合わせる）。ただし 065a の設計上、
  **既存の編集は非破壊マージで守られる**ので、文言は「消えます」ではなく**何が起きるか**を短く書く。

### (3) 取り込み結果の表示

`ImportResult` の 4 つの件数を**その場に出す**。

| 表示 | 由来 |
|---|---|
| 新しく引き継いだ | `imported` |
| 更新した | `updated` |
| 取り込めなかった（未対応サービス） | `skipped_unsupported` |
| 取り込めなかった（内容不備） | `skipped_invalid` |

- ⚠ **`skipped_*` が 0 でないときは必ず見えるようにする。** 黙って一部を落とすと
  「引き継いだのに居ない人がいる」と壊れて見える。
- ⚠ **わんコメには StreamDock が対応していないサービス（ニコ生・ツイキャス等）の視聴者が居る**ため、
  `skipped_unsupported` は**正常系でも 0 にならない**。エラー表現にしないこと。
- ⚠ **視聴者名・ID は結果に出さない**（`ImportResult` が件数しか持たない＝§9・065a の設計）。

### (4) 一覧・詳細への新項目の反映

**一覧（`ViewersView`）**

- `nickname` があれば名前と並べて出す（`name` を置き換えない＝どちらの呼び方でも探せるように）。
- `label` があれば出す（単一値）。
- ⚠ **並び替え（`ViewerSort`）の `TotalComments` は `total_comments` を見ているので、
  引き継ぎ分が加算された値で並ぶ**＝**追加作業なしで正しくなる**（065a の再計算 SQL 改訂の効果）。

**詳細（`ViewerDetailPanel`）**

- `gift_count` / `stream_count` / `active_days` を出す。
- `imported_gift_amount` は ⚠ **単位を付けずに**出す（親 065・(2)：円か Jewels か確定していない）。
  ⚠ **`fmtSuperchat`（通貨付き整形）を流用しないこと。** 通貨記号が付いた瞬間に嘘になる。
- **初回来訪日**は `first_seen_at` と `imported_first_seen_at` の**古いほう**を出す。
  ⚠ `imported_first_seen_at` 由来のときは**引き継ぎ由来と分かる形**にする（親 065・(3) の仮説を含むため）。
- `imported_at` が非 NULL のとき「わんコメから引き継ぎ」と分かる印を出す。
- ⚠ **`imported_name_history` は生 JSON なので画面に出さない**（065a で保管のみと決めている）。

⚠ **表示整形の追加は `viewerFormat.ts` に足す**（コンポーネント内に整形を散らさない＝既存の流儀）。

### (5) テスト

- 「わんコメから引き継ぐ」→ `open()` → `importViewerMemoryCsv` がそのパスで呼ばれる
- **ファイル選択をキャンセルしたら command を呼ばない**（`open()` が null を返す経路）
- `ImportResult` の 4 件数が画面に出る。⚠ **`skipped_*` が 0 でないとき必ず見える**
- 取り込み後に一覧が再取得される
- **取り込み中はボタンが無効**（多重実行しない）
- `ConfirmDialog` を経ずには実行されない
- command が失敗したとき、**固定の安全文言だけ**が出る（本文・エラー詳細を出さない・`console` にも流さない）
- 詳細に `gift_count` / `stream_count` / `active_days` が出る
- ⚠ **`imported_gift_amount` に通貨記号が付かない**（`fmtSuperchat` を使っていない担保）
- `imported_at` が NULL の視聴者に「引き継ぎ」の印が出ない
- ⚠ **ミューテーションで実効性を確認する**。最低限、`skipped_*` の表示を消したときにレッドになること。

## このタスクでやらないこと

- **Rust 側の一切**（[065a](065a-onecomme-csv-import-data-layer.md)）。
- **取り込み前のプレビュー・差分確認画面**（frontend はファイルを読めない＝(1) の制約）。
- **取り込みの取り消し（undo）**。⚠ 戻したいときは `delete_viewer` で消す。
- **`nameHistory` の表示**（生 JSON のまま保管しているだけ）。
- **わんコメへの書き戻し・自動同期**（親 065 の線引き）。
- **設定画面（`SettingsView`）への導線追加**（視聴者一覧に 1 か所だけ置く）。

## セキュリティ制約（docs/security.md 準拠）

- **§9**: 視聴者名・メモ・ニックネーム・ラベル・ID を**端末外へ出さない・`console` にも出さない**。
  command 失敗時は**固定の安全文言だけ**を画面に出す（既存 `ViewersView` の作法）。
- **フルパスを画面に出さない**（`open()` が返す生パスをそのまま表示しない）。
- **capability を増やさない**（`dialog:allow-open` は付与済み・`fs:*` はゼロのまま）。
- **`csp: null` 不変・新規依存ゼロ・sidecar 差分ゼロ・外部通信ゼロ。**

## 完了条件

- 視聴者一覧から CSV を選ぶだけで引き継ぎが完了する。
- **取り込めなかった件数がユーザーに見える**（未対応サービスと内容不備を区別して）。
- 一覧に `nickname` / `label` が出て、`TotalComments` 並び替えが引き継ぎ分を含んだ値で並ぶ。
- 詳細に `gift_count` / `stream_count` / `active_days` / 初回来訪日（引き継ぎ由来が分かる形）が出る。
- ⚠ **`imported_gift_amount` に通貨記号が付いていない。**
- frontend のテストが通り、**ミューテーションで実効性を確認**している。
- **capability 追加ゼロ・新規依存ゼロ・`tauri.conf.json` 差分ゼロ・sidecar 差分ゼロ。**
- `pnpm --filter ./apps/desktop typecheck` / `lint` / `test` が通る。
  [`docs/progress.md`](../progress.md) を更新。

## 確認コマンド

```bash
git diff --stat
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
pnpm --filter ./apps/desktop test

# ゼロ拡大の担保（差分ゼロが期待）
git status --short -- apps/desktop/src-tauri/capabilities/ apps/desktop/src-tauri/tauri.conf.json apps/comment-sidecar/
git status --short -- apps/desktop/package.json pnpm-lock.yaml package.json

pnpm --filter ./apps/desktop tauri dev
# ① 視聴者一覧 →「わんコメから引き継ぐ」→ 実物の CSV を選ぶ → 件数が出て一覧に 61 名が並ぶ
# ② もう一度同じ CSV を取り込む → 「更新した」件数になり、数字が二重にならない
# ③ 引き継いだ視聴者がコメントする → 初見バッジが出ない（⚠ 065 系の主目的）
# ④ 詳細を開く → 参加配信数・参加日数・ギフト回数が出る。金額に通貨記号が付いていない
# ⑤ ファイル選択をキャンセルしても何も起きない
```

## 実装後に必要なレビュー

- **軽レビュー**（[`code-review-light`](../../.claude/skills/code-review-light/SKILL.md)）。
  ⚠ **保存ポリシーとファイル読み取りの security-review は [065a](065a-onecomme-csv-import-data-layer.md) で済ませてある**ので、
  本タスクでは次だけ見る:
  - 視聴者名・メモ・ID・フルパスが画面/`console`/ログに出ていないこと
  - capability・依存・`tauri.conf.json`・sidecar の差分がゼロであること
  - `skipped_*` が握り潰されていないこと
