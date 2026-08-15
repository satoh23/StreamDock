# 065 わんコメ リスナー記録の引き継ぎ（親・設計と線引き）

> 状態: **未着手（親タスク・設計文書）**。実装は [065a](065a-onecomme-csv-import-data-layer.md)（データ層）→
> [065b](065b-onecomme-import-ui.md)（UI）の順。
>
> **必読前提**: 視聴者メモリのデータ層 [038a](038a-viewer-memory-data-layer.md) と
> [`viewer_memory/repository.rs`](../../apps/desktop/src-tauri/src/viewer_memory/repository.rs)（**`RECOMPUTE_VIEWER_AGGREGATES_SQL`**）、
> 初見／久しぶり判定 [038c](038c-first-time-and-returning-badges.md)、
> 配信セッション [062b](062b-stream-session-recording.md)（`viewer_comments.session_id`）、
> **ファイル取り込みの唯一の先例** [060b](060b-custom-css-import-backend.md) と
> [`overlay_theme/service.rs`](../../apps/desktop/src-tauri/src/overlay_theme/service.rs)（`validate_source_path`）、
> 冪等な列追加 [`util.rs`](../../apps/desktop/src-tauri/src/util.rs)（`ensure_column` / `is_network_path`）、
> [`docs/security.md`](../security.md)（**§1／§3／§5／§8／§9／§10・「コメントビューア（配信サービス連携）方針」⑪**）。
> CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。
>
> ⚠ **行番号は書かない**（特定はシンボル名で行うこと）。
>
> ⚠⚠ **本ファイルの「調査結果」は 2026-08-16 に実物の CSV（61 名分・2 回エクスポート）と
> 実コードで検証済み**。推測で書いた箇所には ⚠ を付けてある。

## 目的

配信者が**わんコメ（OneComme）で積み上げてきたリスナー記録を StreamDock へ引き継ぐ**。

⚠ **本機能のいちばんの実利は累積数そのものではない。** [038c](038c-first-time-and-returning-badges.md) の
初見バッジは `viewers` 行の**存在有無**だけで判定するため、引き継ぎをしないと
**「何年も来てくれている常連さんに初見バッジが出る」**。これは移行の障壁そのものであり、
`viewers` 行さえ作れば解消する。累積数・メモ・ニックネームの移送はその上乗せである。

## ⚠⚠ 規約上の線引き（着手前に必ず読むこと）

### わんコメ利用規約に触れうる条項

[利用規約](https://onecomme.com/terms) の禁止事項のうち、本機能に関係するのは 3 つ。

| 条項 | 本文（逐語） | 本機能との関係 |
|---|---|---|
| 禁止 2 | 「逆コンパイル・**リバースエンジニアリング**及びこれらの方法を公開すること」 | **`onecomme.db` の直読み・解析は正面から抵触する。だから採らない**（後述の却下案 C） |
| 禁止 17 | 「**非公開もしくは許諾のないAPI**を用いて連携を行うこと」 | 公開されている HTTP API・CSV 出力は対象外 |
| 禁止 18 | 「わんコメのロゴ・ソースコード・**取得したデータの一部または全部を無断で外部保存する行為**」 | ⚠ **本機能が正面から当たる条項** |

加えて YouTube / Twitch / ニコ生 の各連携サービス条項に共通で次の一文がある。

> 「外部より取得されたあらゆるデータについて配信サイトの利用規約に準ずるものとし、
> 取得したデータを**当アプリ・サービス以外での二次利用することを目的としたデータの保存は認められません**」

⇒ **素直に読むと、経路が何であれ、わんコメのデータを StreamDock の SQLite へ保存する行為は
禁止 18・連携サービス条項に該当しうる。** 逃げ道は禁止 18 の「**無断で**」という限定で、
開発元の許諾を取れば解禁できる構造になっている。

### 本人の判断（2026-08-16）

**開発元への許諾確認は行わず、CSV インポートのみで進める**と決定した。根拠として置いた整理は次の 2 点。

1. **CSV 出力は公式機能である**（[リスナー記録機能](https://onecomme.com/docs/feature/listener-list)
   に「リスナーリストをCSVで出力することができます」と明記）。出力後の利用を一切禁じるなら
   CSV 出力を提供する意味がない。
2. **出力されたファイルはユーザー自身の手元にあり、取り込みはユーザーの明示操作で始まる。**
   StreamDock がわんコメへ自動で取りに行くわけではない。

⚠ **この整理が正しい保証はない**（リスクは提示のうえで本人が受容した）。
⚠ **したがって HTTP API（`/api/listeners`）経由の自動同期は本タスクの対象外**とする。
実装したくなったときは、**許諾確認を先に行うこと**（下記「やらないこと」）。

### 日本法の整理

| 論点 | 評価 |
|---|---|
| 著作権法 12 条の 2（データベースの著作物） | 視聴者 ID とカウンタの集積に創作的な選択・体系性は認めにくく、**侵害構成は弱い**。個々の値は事実データで著作物性なし |
| 著作権法 30 条の 4（情報解析のための利用） | 解析行為自体は著作権法上は適法になり得る。⚠ **ただし利用規約は契約なので、著作権法がセーフでも契約違反は別途残る**（混同しないこと） |
| 不正競争防止法（限定提供データ・技術的制限手段） | 「業として特定の者に提供する情報」ではなくローカルデータなので該当しにくい |
| 個人情報保護法 | 視聴者名・ID・コメント履歴は個人情報になり得る。既存方針（**端末内のみ・端末外非送信・削除手段あり**＝§9・⑪）で実務上のリスクは抑えられている |

⇒ **止めているのは法律ではなく契約（利用規約）**である。

### ⚠ 別件で見つかった既存の潜在課題（本タスクの対象外・別途起票すること）

わんコメ規約が準拠を求めている先、[YouTube API Services Developer Policies](https://developers.google.com/youtube/terms/developer-policies)
には **保存期間 30 日ルール**がある（無期限保存が許されるのは channelId 等の **ID 系のみ**。
統計値の 36 か月保存は derived metrics の申請が通った Client のみ）。

StreamDock は [038a](038a-viewer-memory-data-layer.md) で **YouTube のコメント本文と表示名を
`viewer_comments` に無期限保存している**。⚠ **これは本タスクとは独立に既に存在する論点**だが、
本タスクは保存量を増やす方向なので、**遅かれ早かれ向き合う必要がある**。

## 取り込み経路の比較（採用＝B）

| 案 | 経路 | 規約適合 | 判定 |
|---|---|---|---|
| A. 公式 HTTP API | `GET http://localhost:11180/api/listeners` ほか | 禁止 17 の対象外。禁止 18 は要許諾 | **本タスクでは不採用**（許諾未確認・わんコメ起動が前提） |
| **B. 公式 CSV エクスポート** | ユーザーが出力 → StreamDock が読む | 最も安全・明示操作が挟まる | ✅ **採用** |
| C. `onecomme.db` 直読み | データフォルダの SQLite を解析 | **禁止 2・18 に正面衝突** | ❌ **却下**（公式 CSV がある以上リスクを取る理由がゼロ） |
| D. わんコメプラグイン | わんコメ側から押し出す | 公式拡張点 | ❌ 別配布が要りユーザー負担が重い |

⚠ **わんコメのデータフォルダに `user.db` は存在しない**（公式バックアップガイドの記述は古い）。
実測（macOS・2026-08-16）では `~/Library/Application Support/onecomme` に
`onecomme.db` / `comments.db` / `timestamp.db`（いずれも `-shm` / `-wal` を伴う SQLite）がある。
**中身は開いていない**（案 C を却下したため）。

## 調査結果（実物の CSV・2026-08-16）

### ファイルの性質（実測）

- **UTF-8・BOM なし・LF**（CRLF ではない）。61 名分で 14.6KB。
- **RFC4180 の標準クォート**を使っている。`badges` 列に
  `"[{""label"":""🔧"",""url"":""""}]"` が出ており、**カンマとダブルクォートを含む値が
  フィールド全体のクォート＋二重化で正しくエスケープされている**。
  ⇒ **わんコメは標準的な CSV ライタを使っている**ので、メモに何が入っても標準の CSV パーサで読める。

### ⚠⚠ 列順は固定ではない（本タスク最大の落とし穴）

**同じ環境で 2 回エクスポートしたら、列名も列数（22）も同じまま、順序だけが変わった。**

```
1 回目: … badges, nickname, screenName, lang, service, memo, …
2 回目: … badges, nickname, lang, service, memo, …  … anonymity, label, screenName, atdDays, …
```

`screenName` が **6 列目 → 19 列目**へ移動し、間の 13 列がすべて 1 つずつズレた。
おそらく内部オブジェクトのキー順をそのまま書き出しており、値が入る/入らないで順序が動く。

⇒ **列位置で読む実装は将来必ず壊れる。必ずヘッダ名で引くこと。**
⇒ さらに **必須列の存在をヘッダで検証し、欠けていたら fail-closed で拒否する**こと
（わんコメのバージョンが上がれば列は増減しうる）。

### 列マッピング（全 22 列）

| わんコメ | 実データ | StreamDock | 判定 |
|---|---|---|---|
| `id` | `yt-UCx6uXIHxi2leLjrV-oGU2zg` | `viewers.id` | ✅ **突合キー**（後述） |
| `username` | `@Takato_10969` | `name` | ⚠ **ハンドルであって表示名ではない** |
| `icon` | アバター URL | — | ❌ **保存しない**（038a の明示方針・§9） |
| `badges` | `[]` / `[{"label":"🔧","url":""}]` | — | ❌ 受け皿なし |
| `nickname` | `謎の男` | `nickname`（新設） | ✅ **単一文字列** |
| `lang` | 全行 `[]` | — | ❌ 翻訳設定・不要 |
| `service` | 全行 `youtube` | `provider` | ✅ |
| `memo` | `へへへ` | `note` | ✅ **単一文字列** |
| `nameHistory` | 全行 `[]` | `imported_name_history`（新設） | ⚠ **要素の形が不明。生 JSON 文字列のまま保管** |
| `allowIcon` | 全行空 | — | ❌ |
| `interval` | 0 が 46 件 | `imported_first_seen_at` の材料 | ⚠ **後述（仮説）** |
| `lcts` | `2026-08-15T23:29:04.288Z` | `last_comment_at` | ✅ **ISO8601 UTC・無変換で使える** |
| `tc` | 1〜3 | `imported_comments` | ✅ |
| `tgc` | 0〜2 | `imported_gifts` | ✅ |
| `amount` | 0 / 5 / 6 / 7 / 10 / 160 / 320 / 1000 | `imported_gift_amount`（新設） | ⚠ **通貨情報なし・後述** |
| `lst` | **全行 `#`** | — | ❌ 意味不明・定数 |
| `anonymity` | 全行空 | — | ❌ |
| `label` | `😀` | `label`（新設） | ✅ **単一値**（わんコメ UI 上も 1 つしか設定できないことを本人が確認） |
| `screenName` | 全行空 | — | ❌ 用途不明 |
| `atdDays` | 全行 `1` | `imported_active_days` | ✅ 参加日数 |
| `atdLives` | 全行 `1` | `imported_stream_count` | ✅ 参加配信数 |
| `lstLive` | `26DodFTXj4c`（videoId） | — | ❌ 受け皿なし |

### 突合キーは成立する（実コードで検証済み）

- わんコメ: `id = "yt-" + YouTube channelId`
- StreamDock: `viewers.id = format!("{source}:{provider_user_id}")`（`viewer_memory/service.rs`）で
  `provider_user_id = comment.author.id`
- YouTube の `author.id` は **`message.author_details.channel_id`**
  （[`youtube/mapper/comment.mapper.ts`](../../apps/comment-sidecar/vendor/comment-fetcher/src/adapters/youtube/mapper/comment.mapper.ts)）＝**`UC...` そのもの**

⇒ **`yt-UCxxx` → `youtube:UCxxx` のプレフィックス変換だけで一致する。**

⚠ **Twitch 側は未検証。** Twitch の `author.id` は `event.chatter_user_id`
（[`twitch/mapper/comment.mapper.ts`](../../apps/comment-sidecar/vendor/comment-fetcher/src/adapters/twitch/mapper/comment.mapper.ts)）だが、
**わんコメ側のプレフィックス（`tw-` と推定）は実データで確認できていない**。
⇒ **未知のプレフィックス／未知の `service` は取り込まずスキップし、件数を結果に返す**設計にする（fail-closed）。

### 引き継げないもの

- **初回来訪日時**（`first_seen_at` に相当する列が無い。⚠ `interval` 仮説を除く）
- **表示名**（`username` は `@handle`、`screenName` は全行空）
- **サブスク／メンバーシップの有無**（`is_member` / `subscription_count` に相当する列が無い）
- **`amount` の通貨**
- **ニコ生・ツイキャス等の視聴者**（StreamDock は twitch / youtube のみ）

## 設計判断とその理由

### (1) `imported_*` ベースライン列 ＋ 再計算 SQL への加算

⚠⚠ **これが本タスクの中心にして最大の設計上の障害。**
`RECOMPUTE_VIEWER_AGGREGATES_SQL` は `viewers` の集計列を**毎回 `viewer_comments` から再計算する**
（038a が「増分ドリフトが起きない」ために意図的にそうした）。

⇒ **`viewers` に引き継ぎ値をそのまま書いても、その視聴者が次に 1 回コメントした瞬間に
`record_comment` → 再計算が走り、`total_comments` が `1` に、`first_seen_at` が今日に上書きされて消える。**

⇒ 採用: **`imported_*` を別列に持ち、再計算 SQL 側で `COUNT(...) + COALESCE(imported_*, 0)` にする。**
既存の再計算契約を壊さずに引き継ぎ値が生き残り、UI で「うち引き継ぎ分」を分離表示もできる。

却下した案:
- **疑似 `viewer_comments` 行を生成**（累積数ぶんダミー行を挿す）… 存在しないコメントの捏造で、詳細画面が破綻する
- **別テーブル `viewer_imports` で参照時に合算**… 正しいが、一覧・詳細・038c・062c の**全読み出し経路**に合算処理が波及する

### (2) `amount` は既存の金額列に混ぜない

値が 5 / 6 / 7 / 10 / 160 / 320 / 1000 と小さい数字混じりで、**円ではなく YouTube の Jewels の可能性が高い**
（StreamDock は 043e で `jewels` を扱っている）。StreamDock は `superchat_amount`（通貨付き REAL）と
`bits_amount`（INTEGER）を分けて持つので、**単位不明の値をここへ足すと「1000 円」と「1000 jewels」が加算される**。

⇒ **`imported_gift_amount` として単独で保持し、`superchat_amount` / `bits_amount` には一切加算しない。**
UI では単位を付けずに「引き継ぎ: ギフト ◯ 回 / 累計 ◯」と出す。単位が判明したら移し替えられる。

### (3) `imported_first_seen_at` は独立列（⚠ 仮説を含む）

`interval` が 0 の 46 件と `tc = 1` の 46 件が**完全一致**する。つまり「複数回コメントした人だけ非ゼロ」の
ミリ秒値。`lcts − interval` を計算すると配信開始直後に着地するため、**「初回コメントからの経過時間」**と
読むのが自然。

⚠⚠ **ただし「直近 2 件の間隔」という解釈も同じデータで成立してしまい、
今回のデータ（1 配信・約 75 秒・最大 `tc = 3`）では区別できない。**
本人の判断で**検証せずに `lcts − interval` を採用する**が、**必ず独立列に置くこと**。理由は 2 つ。

1. **解釈が外れたときに復旧できる。** `first_seen_at` に直接書くと実測値と混ざって二度と分離できないが、
   独立列なら**その 1 列を NULL にするだけで戻せる**。
2. **そもそも上書きされる。** `first_seen_at` は再計算 SQL で `MIN(published_at)` に毎回上書きされるため、
   独立列でなければ機能しない（＝(1) と同じ理由）。

表示は `MIN(first_seen_at, imported_first_seen_at)` で合成する。

### (4) 再インポートは「`imported_*` だけ置換・属性は非破壊マージ」

- **`imported_*` 集計列**: 加算ではなく**上書き**。何度取り込んでも結果が同じ（冪等）＝二重加算事故が構造的に起きない。
  わんコメを併用している間は、新しい CSV を当て直せば最新値になる。
- **`name` / `note` / `nickname` / `label`**: **CSV 側が非空かつ StreamDock 側が空のときだけ**書く。
  ⚠ **配信者が StreamDock で書いたメモや、コメント受信で得た表示名を、CSV の空値で潰さないため。**
  （実データでは `nickname` / `memo` / `label` は 61 名中 1 名しか埋まっていない＝空が普通。）

### (5) 新テーブルは作らない

当初は `viewer_labels` / `viewer_name_history` を新設する方針だったが、**実データで `label` は単一値**
（わんコメ UI 上も 1 つしか設定できないことを本人が確認）、`nameHistory` は**要素の形が不明**（全行 `[]`）。

⇒ **`label` は単一列、`nameHistory` は生 JSON 文字列列に保管**する。データは失わず、
複数値だと判明した時点でテーブル化すればよい。**新テーブルゼロで 065a のスコープが縮む。**

## サブタスク

| | 内容 | レビュー |
|---|---|---|
| [065a](065a-onecomme-csv-import-data-layer.md) | Rust データ層（列追加・再計算 SQL 改訂・CSV パース・`import_viewer_memory_csv`・security.md 改訂） | **security-review 必須** |
| [065b](065b-onecomme-import-ui.md) | UI（ファイル選択・取り込み結果表示・一覧/詳細への新項目反映） | 軽レビュー |

## このタスク（065 系全体）でやらないこと

- **HTTP API（`/api/listeners`）経由の自動同期**。⚠ **着手条件＝わんコメ開発元への許諾確認が取れたとき。**
- **`onecomme.db` の直読み・解析**（禁止 2・18 に正面衝突）。
- **StreamDock からわんコメへの書き戻し**（一方向のみ）。
- **ニコ生・ツイキャス等、StreamDock が対応していないサービスの取り込み**。
- **アバター画像の保存**（038a の方針を変えない）。
- **`badges` / `lang` / `allowIcon` / `anonymity` / `screenName` / `lst` / `lstLive` の取り込み**（受け皿がない・用途不明）。
- **YouTube 30 日保存ルールへの対応**（既存の論点。別途起票する）。
- **端末外送信・クラウド同期**（§9・⑪ 不変）。

## 完了条件（065 系全体）

- わんコメの CSV を選ぶだけで、`viewers` に行が作られ、累積・ニックネーム・メモ・ラベルが引き継がれる。
- **引き継いだ視聴者に初見バッジが出ない**（本機能のいちばんの目的）。
- 引き継ぎ後にその人がコメントしても、**引き継いだ累積が消えない**（再計算で上書きされない）。
- 同じ CSV を二度取り込んでも結果が変わらない（冪等）。
- 取り込めなかった行（未対応サービス・不正行）の件数がユーザーに伝わる。
- **端末外送信ゼロ・新規 capability ゼロ・新規 egress ゼロ。**
