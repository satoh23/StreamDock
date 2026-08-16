# 065b わんコメ引き継ぎの UI（ファイル選択・取り込み結果・一覧/詳細への反映）

> 状態: **未着手（実装サブタスク）**。分割・線引きは親 [065](065-onecomme-viewer-import.md) を正とする。
>
> ⚠⚠ **着手条件が当初と逆転している（2026-08-16・065a の実装と外部レビューを受けて更新）。**
> 当初は「065a が**完了**していること」と書いていたが、**065a は実機確認が未実施のまま止まっている**——
> UI が無く `withGlobalTauri` も無いため、**取り込みを起動する手段が現状ゼロ**だからである
> （確認のためだけに devtools から invoke できるようにするのは攻撃面を開けるので採らない）。
> ⇒ **065b の最初の一歩が、065a の疎通確認の場そのものになる**（外部レビュー Q-8・task-board 申し送り 9）。
> **下記 (0) を必ず最初に単独で通すこと。** 一覧・詳細まで作り込んでから疎通させると、
> **実 CSV のヘッダが必須 9 列を満たさなかった場合に全部やり直しになる。**
>
> **必読前提**: 親 [065](065-onecomme-viewer-import.md)、[065a](065a-onecomme-csv-import-data-layer.md)、
> ⚠⚠ **[`docs/progress.md`](../progress.md) の 065a 節**（**実装の結論・穴 A〜L・上限値の根拠・
> 外部レビューの反映はここが正**。本ファイルより新しい）、
> ⚠ [`docs/task-board.md`](../task-board.md) の **065b 申し送り 10 項目**、
> [`viewer_memory/csv_import.rs`](../../apps/desktop/src-tauri/src/viewer_memory/csv_import.rs)
> （**必須列・上限値・スキップ規則の実体**）、
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
  （句点を含む 30 文字以上の散文が 1 つも無いこと）。
  ⚠⚠ **ガードが掛かっているのは `SummaryView` だけ**で、`ViewersView` / `ViewerDetailPanel` に
  長文を書いても**機械的には落ちない**。ただし全廃は**同じ窓・同じ人の実機での決定**
  （062c・「説明文が画面の大半を占めて邪魔」）なので、**この窓に長い注記を書く設計にしないこと。**
  ⇒ 下記 (2) の「取り込む直前にエクスポートを」の案内も**短い一文**に収めること。

## 065a 実装後の実態（⚠ 本ファイルの当初想定から変わった点・2026-08-16）

**根拠は [`docs/progress.md`](../progress.md) の 065a 節。** 本ファイルの以下の記述はそれに合わせて更新済み。

- **戻り値の型名は `ImportResult` ではなく `ViewerImportResult`**（barrel から再エクスポート済み）。
  フィールドは camelCase＝`imported` / `updated` / `skippedUnsupported` / `skippedInvalid`。
- **`ViewerRecord` に 12 列が増えている**（`nickname` / `label` / `giftCount` / `streamCount` /
  `activeDays` / `importedComments` / `importedGifts` / `importedGiftAmount` / `importedActiveDays` /
  `importedStreamCount` / `importedFirstSeenAt` / `importedAt`）。
  ⚠ **`imported_name_history` は DTO に出していない**（保管専用の生 JSON・§9）。
- ⚠⚠ **必須列は 9 つ**（`id` / `service` / `lcts` / `tc` / `tgc` / `amount` / `atdDays` / `atdLives` /
  `interval`）。**1 つでも欠けたら 1 行も取り込まずエラー**になる（fail-closed）。
  ⇒ **実 CSV がこれを満たすかは未検証**（下記 (0) で最初に確かめる）。
- ⚠ **行が丸ごと落ちる条件が増えている**（`skippedInvalid` に数えられる）:
  数値の空欄・パース失敗・負値／**回数 1 億超**／**`memo` 1,000 文字超**／
  **`id` / `username` / `nickname` / `label` 200 文字超**／`lcts` がパース不能。
  ⚠ **なぜ落ちたかは戻り値に含まれない**（§9・件数だけ）。
- ⚠ **ファイル自体が拒否される条件**: `.csv` 以外／**8MiB 超**／**20,001 行以上**／UNC・ネットワークパス／
  UTF-8 として読めない／**必須列の欠落**。いずれも `AppError` として返る。
- **既存 DB は 065a の起動時に一度だけ backfill 済み**なので、
  **既に居る視聴者にも `giftCount` / `streamCount` / `activeDays` が入っている**
  （＝一覧に 0 が並ぶことはない）。

## このタスクでやること

### (0) ⚠⚠ **最初に「dialog → invoke だけ」の最小導線を通す**（065a の疎通確認を兼ねる）

**ここだけを単独で実装し、実物の CSV を 1 回通してから (1) 以降へ進むこと。**

- ボタン 1 つ →`open()`→`importViewerMemoryCsv(path)`→ **件数を素で出すだけ**（整形も一覧再取得も後回し）。
- 確認するのは 4 つ:
  1. ⚠⚠ **実 CSV のヘッダが必須 9 列を満たすか**（満たさなければ「必要な列がありません」で全行弾かれる）
  2. **61 名で `skipped_*` がどう出るか**（`skippedUnsupported` は正常系でも 0 にならない想定）
  3. ⚠ **`tw-` プレフィックスの推定が当たっているか**（実データで未確認。Twitch の視聴者が居れば分かる）
  4. **既存 DB での backfill 所要時間**（起動が目に見えて遅くならないか）
- ⚠ **ここで DB が実データに変わる**ので、[065a の実機確認手順](065a-onecomme-csv-import-data-layer.md)の
  **バックアップと後始末をそのまま踏むこと**。
- ⚠ 結果（とくに 1 と 3）は **progress.md へ実測値として残す**。外れていたら 065a 側の修正が先である。

### (1) `viewerMemoryApi` に `importViewerMemoryCsv` を足す

- `overlayThemeApi.ts` の `importOverlayTheme` と**同型**：`plugin-dialog` の `open()` が返した
  **生パス**をそのまま渡すだけ。⚠ **検証は Rust 側で必ず再実行される**（frontend の検証は UX のためだけ）。
- ⚠ **frontend は取り込み前のファイルを読む手段を持たない**（`open()` はパス文字列しか返さず `fs:*` は無い）。
  ⇒ **プレビューは実装できない**。この制約は 060b と同じ（`cssScope.ts` の記述と同趣旨）。

### (2) 取り込みの導線（`ViewersView`）

- 視聴者一覧に「**わんコメから引き継ぐ**」ボタンを 1 つ置く。
- 押すと `open()` で `.csv` フィルタ付きのファイル選択 → `importViewerMemoryCsv(path)` → 結果表示 → 一覧を再取得。
- ⚠ **取り込み中は多重実行を防ぐ**（ボタンを無効化する）。61 名で一瞬だが、大きい CSV では待ちが出る。
  ⚠⚠ **取り込み中は DB ロックを保持したまま最大 20,000 行を 1 トランザクションで処理する**ので、
  その間**コメント記録・プリセット起動・ログがまとめて止まる**（065a で受容した設計）。
  ⇒ **配信中に押させない**方向で文言を書くこと（「配信前に」の一言で足りる）。
- ⚠ **「引き継ぎ」は既存データを書き換える操作**なので、**実行前に `ConfirmDialog` を挟む**
  （既存の破壊的操作の作法に合わせる）。ただし 065a の設計上、
  **既存の編集は非破壊マージで守られる**ので、文言は「消えます」ではなく**何が起きるか**を短く書く。
- ⚠ **「取り込む直前にエクスポートを」を短く 1 行**入れる（申し送り 6）。理由＝1 ヶ月以上前の CSV を
  取り込むと、その人の次のコメントで**全員に「久しぶり」バッジが出る**（`lcts` が古いため・**受容した挙動**）。
  ⚠ **理由まで書かないこと**（上記の長文禁止）。

### (3) 取り込み結果の表示

`ViewerImportResult` の 4 つの件数を**その場に出す**。

| 表示 | 由来（camelCase） |
|---|---|
| 新しく引き継いだ | `imported` |
| 更新した | `updated` |
| 取り込めなかった（未対応サービス） | `skippedUnsupported` |
| 取り込めなかった（内容不備） | `skippedInvalid` |

- ⚠ **`skipped*` が 0 でないときは必ず見えるようにする。** 黙って一部を落とすと
  「引き継いだのに居ない人がいる」と壊れて見える。
- ⚠ **わんコメには StreamDock が対応していないサービス（ニコ生・ツイキャス等）の視聴者が居る**ため、
  `skippedUnsupported` は**正常系でも 0 にならない**。エラー表現にしないこと。
- ⚠ **視聴者名・ID は結果に出さない**（`ViewerImportResult` が件数しか持たない＝§9・065a の設計）。
- ⚠⚠ **`skippedInvalid` の「なぜ落ちたか」は返ってこない**（§9・件数のみ）。⇒ **理由を推測して書かない。**
  件数だけを淡々と出し、原因を知りたい要望が出たら**そのとき §9 を再評価して 065a 側に足す**こと。

**⚠⚠ 失敗（`AppError`）の出し方は 1 段考えること**

既存 `ViewersView` の作法は `catch {}`（エラー値を束縛しない）＋**固定の安全文言**である。だが取り込みは
「**アプリが壊れた**」と「**選んだファイルが違う**」が混ざる唯一の経路で、後者は Rust 側が既に
**原因の分かる固定文言**を返す（例:「この CSV には必要な列がありません。わんコメのリスナーリストを
書き出したファイルを選んでください。」「CSV ファイルが大きすぎます。8MB 以内にしてください。」）。
全部を「取り込みに失敗しました。」に潰すと、**ユーザーが取れる行動が消える**。

- ⇒ **`AppError.message` はそのまま出してよい**（Rust 側の**コンパイル時定数**で、第三者データを含まない）。
- ⚠⚠ **`AppError.details` は出さないこと。** `util::with_filename_detail` が**ファイル名**を入れる
  （フルパスではないが、画面に出す必要が無い）。
- ⚠ **`console` には流さない**（既存の作法どおり）。
- ⚠ この判断は「固定文言だけを出す」という既存の作法を**広げる**方向なので、
  **軽レビューで必ず見てもらうこと**（下記「実装後に必要なレビュー」）。

### (4) 一覧・詳細への新項目の反映

**一覧（`ViewersView`）**

- `nickname` があれば名前と並べて出す（`name` を置き換えない＝どちらの呼び方でも探せるように）。
- `label` があれば出す（単一値）。
- ⚠ **並び替え（`ViewerSort`）の `TotalComments` は `total_comments` を見ているので、
  引き継ぎ分が加算された値で並ぶ**＝**追加作業なしで正しくなる**（065a の再計算 SQL 改訂の効果）。

**詳細（`ViewerDetailPanel`）**

- `giftCount` / `streamCount` / `activeDays` を出す。
  - ⚠⚠ **`streamCount`（参加配信数）は 062b 以前のデータで多めに出る**——当時の `session_id` は
    コメビュ窓のマウント単位で、窓を開き直すたびに別 id だった。062b はバックフィルしないと
    決めているので**歪みは永久に残る**。⇒ **厳密な値として説明する文言を書かないこと**（申し送り 2）。
  - ⚠⚠ **`activeDays`（参加日数）は近似**——実測分は **UTC 日**で数える（日本時間の朝の配信は
    UTC で 2 日に割れる）が、引き継ぎ分の `atdDays` はわんコメの**ローカル日**と思われる
    ＝**足し算の左右で「1 日」の定義が違う**。壊れた時刻の行は黙って落ちるので少なめにも出うる（申し送り 3）。
  - ⚠ 上の 2 つは**注記で説明しない**（この窓は説明文を全廃した）。**厳密さを主張しない言い回し**にするか、
    表示そのものをやめるかで解くこと。
- `importedGiftAmount` は ⚠ **単位を付けずに**出す（親 065・(2)：円か Jewels か確定していない）。
  ⚠ **`fmtSuperchat`（通貨付き整形）を流用しないこと。** 通貨記号が付いた瞬間に嘘になる。
  ⚠ **065a はこの列にだけ上限を課していない**（`f64`）ので、**桁を丸める**こと（申し送り 4）。
- **初回来訪日**は `firstSeenAt` と `importedFirstSeenAt` の**古いほう**を出す。
  ⚠⚠ **比較は必ずパースして行う**（`Date` などで）。**辞書順で比較しないこと**——
  `importedFirstSeenAt` は `Z` 形、`firstSeenAt` は provider 由来で `+09:00` 形が混ざりうるため、
  文字列比較だと**古いほうを新しいと判定する**（065a の穴 D / 穴 L と同じ罠。申し送り 5）。
  ⚠ `importedFirstSeenAt` 由来のときは**引き継ぎ由来と分かる形**にする（親 065・(3) の仮説を含むため）。
  ⚠ **合成表示は必須**である——`firstSeenAt` は実測分の `MIN(published_at)` で毎回上書きされるので、
  **引き継ぎだけの視聴者が初めてコメントした瞬間に「初回来訪日」が今日へ飛ぶ**。
- `importedAt` が **非 NULL のとき**「わんコメから引き継ぎ」と分かる印を出す（`null`＝引き継ぎ無し・申し送り 7）。
- ⚠ **`importedNameHistory` は DTO に存在しない**（065a が保管専用と決めて出していない）。画面にも出せない。

⚠ **表示整形の追加は `viewerFormat.ts` に足す**（コンポーネント内に整形を散らさない＝既存の流儀）。

### (5) テスト

- 「わんコメから引き継ぐ」→ `open()` → `importViewerMemoryCsv` がそのパスで呼ばれる
- **ファイル選択をキャンセルしたら command を呼ばない**（`open()` が null を返す経路）
- `ViewerImportResult` の 4 件数が画面に出る。⚠ **`skipped*` が 0 でないとき必ず見える**
- 取り込み後に一覧が再取得される
- **取り込み中はボタンが無効**（多重実行しない）
- `ConfirmDialog` を経ずには実行されない
- ⚠⚠ command が失敗したとき、**`AppError.message` は出るが `details` は出ない**
  （ファイル名が画面に出ないことの担保）。⚠ `console` にも流さない
- ⚠ **`AppError` を持たない例外（`open()` の失敗等）では固定の安全文言に落ちる**
- 詳細に `giftCount` / `streamCount` / `activeDays` が出る
- ⚠ **`importedGiftAmount` に通貨記号が付かない**（`fmtSuperchat` を使っていない担保）
- ⚠⚠ **初回来訪日の合成がオフセット混在でも正しい**——`firstSeenAt = "2026-08-16T08:00:00+09:00"`
  （＝08-15 23:00 UTC）と `importedFirstSeenAt = "2026-08-15T23:29:04.288Z"` を与え、**前者**が
  選ばれること（**辞書順だと後者を選んでしまう**ケースを直接踏む）
- ⚠ **引き継ぎだけの視聴者**（`firstSeenAt === importedFirstSeenAt` に近い状態）でも表示が壊れない
- `importedAt` が `null` の視聴者に「引き継ぎ」の印が出ない
- ⚠ **ミューテーションで実効性を確認する**。最低限:
  1. `skipped*` の表示を消す → レッド
  2. ⚠ **初回来訪日の比較を辞書順（`<` での文字列比較）へ変える** → レッド
  3. ⚠ `importedGiftAmount` を `fmtSuperchat` に差し替える → レッド
  4. ⚠ **自分で考えた変異も試すこと**（065a では「試していない変異が 5 件生き残っていた」と
     外部レビューに指摘されている＝自分で試す変異だけでは足りない）

## このタスクでやらないこと

- **Rust 側の一切**（[065a](065a-onecomme-csv-import-data-layer.md)）。
  ⚠ **例外は (0) で疎通が失敗したときだけ**——その場合は 065a 側の修正が先である
  （必須列の見立てが外れた等）。UI を積み増して回避しないこと。
- **取り込み前のプレビュー・差分確認画面**（frontend はファイルを読めない＝(1) の制約）。
- **取り込みの取り消し（undo）**。⚠ 戻したいときは `delete_viewer` で消す。
- **`nameHistory` の表示**（DTO に存在しない＝065a が保管のみと決めている）。
- **`skippedInvalid` の理由の表示**（戻り値に含まれない＝§9。出したくなったら 065a 側の再評価から）。
- ⚠ **`nickname` / `label` の編集機能**（申し送り 10）。足すなら**非破壊マージとの整合を先に決めること**——
  065a 時点でこの 2 列を書ける経路は取り込みだけで、`the_merge_protects_the_nickname_and_label_too` が
  「既存が非空なら CSV で上書きしない」を固定している。**編集で入った値も同じ規則で守られるか**
  （＝編集後に再取り込みしても消えないか）を Rust 側のテストへ足す必要がある。
- **わんコメへの書き戻し・自動同期**（親 065 の線引き）。
- **設定画面（`SettingsView`）への導線追加**（視聴者一覧に 1 か所だけ置く）。

## セキュリティ制約（docs/security.md 準拠）

- **§9**: 視聴者名・メモ・ニックネーム・ラベル・ID を**端末外へ出さない・`console` にも出さない**。
  ⚠ command 失敗時に出してよいのは **`AppError.message`（Rust 側のコンパイル時定数）まで**。
  ⚠⚠ **`AppError.details` は出さない**（`with_filename_detail` が**ファイル名**を入れる）。
- **フルパスを画面に出さない**（`open()` が返す生パスをそのまま表示しない）。
- **capability を増やさない**（`dialog:allow-open` は付与済み・`fs:*` はゼロのまま）。
  ⚠ **`withGlobalTauri` を有効化しない**（デバッグのために開けたくなるが、全窓へ `invoke` を露出する）。
- **`csp: null` 不変・新規依存ゼロ・sidecar 差分ゼロ・外部通信ゼロ。**
  ⚠ **わんコメへ接続しない**（`localhost:11180` / `/api/listeners` を frontend からも叩かない）。

## 完了条件

- ⚠⚠ **(0) の最小導線で実物の CSV が 1 回通っていること**（＝065a の実機確認がここで済むこと）。
  実測値（必須 9 列を満たしたか・`skipped_*` の内訳・`tw-` の当否）が
  [`docs/progress.md`](../progress.md) に残っていること。
- 視聴者一覧から CSV を選ぶだけで引き継ぎが完了する。
- **取り込めなかった件数がユーザーに見える**（未対応サービスと内容不備を区別して）。
- ⚠ **ファイルごと拒否されたとき、ユーザーが次に取れる行動が分かる**
  （「必要な列がありません」等が読める＝全部を「失敗しました」に潰していない）。
- 一覧に `nickname` / `label` が出て、`TotalComments` 並び替えが引き継ぎ分を含んだ値で並ぶ。
- 詳細に `giftCount` / `streamCount` / `activeDays` / 初回来訪日（引き継ぎ由来が分かる形）が出る。
- ⚠ **`importedGiftAmount` に通貨記号が付いていない。**
- ⚠⚠ **初回来訪日の合成がオフセット混在でも正しい**（辞書順比較になっていない）。
- ⚠ **`streamCount` / `activeDays` を厳密な値として説明する文言が無い**（近似だから）。
- frontend のテストが通り、**ミューテーションで実効性を確認**している。
- **capability 追加ゼロ・新規依存ゼロ・`tauri.conf.json` 差分ゼロ・sidecar 差分ゼロ・Rust 差分ゼロ。**
- `pnpm --filter ./apps/desktop typecheck` / `lint` / `test` が通る。
  [`docs/progress.md`](../progress.md) を更新。

## 確認コマンド

```bash
git diff --stat
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
pnpm --filter ./apps/desktop test

# ゼロ拡大の担保（差分ゼロが期待）
git status --short -- apps/desktop/src-tauri/ apps/comment-sidecar/   # ⚠ Rust も差分ゼロが期待
git status --short -- apps/desktop/package.json pnpm-lock.yaml package.json

# §9 の担保
grep -rn "details" apps/desktop/src/screens/comment-viewer/ViewersView.tsx   # AppError.details を画面に出していないこと
grep -rn "console\." apps/desktop/src/screens/comment-viewer/                # console へ流していないこと
grep -rn "11180\|/api/listeners\|withGlobalTauri" apps/desktop/src apps/desktop/src-tauri/tauri.conf.json  # ヒットゼロ
```

**実機確認**（⚠ **(0) の段階で 065a のバックアップ手順をそのまま踏むこと**。
手順の全文は [065a のタスクファイル](065a-onecomme-csv-import-data-layer.md)の「⏳ 実機確認の手順」が正）

```bash
pnpm --filter ./apps/desktop tauri dev
```
- ⓪ ⚠⚠ **(0) の最小導線**で実物の CSV を選ぶ → **必須 9 列を満たすか**／`skipped_*` の内訳／
  `tw-` の当否／backfill の所要時間を実測して progress.md へ残す
- ① 視聴者一覧 →「わんコメから引き継ぐ」→ 件数が出て一覧に 61 名が並ぶ
- ② もう一度同じ CSV を取り込む →「更新した」件数になり、**数字が二重にならない**
- ③ 引き継いだ視聴者がコメントする → **初見バッジが出ない**（⚠ 065 系の主目的）
- ④ 詳細を開く → 参加配信数・参加日数・ギフト回数が出る。**金額に通貨記号が付いていない**
- ⑤ ファイル選択をキャンセルしても何も起きない
- ⑥ ⚠ **`.txt` や巨大ファイルを選ぶ** → 原因の分かる文言が出て、**ファイル名は出ない**
- ⑦ ⚠ 「久しぶり」バッジが**申し送り 6 のとおりに出る／出ない**（`lcts` の新しさ次第）

## 実装後に必要なレビュー

- **軽レビュー**（[`code-review-light`](../../.claude/skills/code-review-light/SKILL.md)）。
  ⚠ **保存ポリシーとファイル読み取りの security-review は [065a](065a-onecomme-csv-import-data-layer.md) で
  済ませてある**（自己レビュー＋外部レビューの 2 回）ので、本タスクでは次だけ見る:
  - 視聴者名・メモ・ID・フルパス・**ファイル名**が画面/`console`/ログに出ていないこと
  - ⚠⚠ **`AppError.message` を出す判断**（既存の「固定文言だけ」の作法を広げている）が妥当か
  - capability・依存・`tauri.conf.json`・sidecar・**Rust** の差分がゼロであること
  - `skipped*` が握り潰されていないこと
  - ⚠ **初回来訪日の比較がパース済みで行われている**こと（辞書順になっていない）
