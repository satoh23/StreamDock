# 065a わんコメ CSV 取り込みの Rust データ層（列追加・再計算 SQL 改訂・パース・コマンド）

> 状態: **未着手（実装サブタスク）**。分割・線引きは親 [065](065-onecomme-viewer-import.md) を正とする。
>
> **必読前提**: 親 [065](065-onecomme-viewer-import.md)（**規約の線引き・CSV の実測結果・設計判断の理由は
> すべて親が正**）、[038a](038a-viewer-memory-data-layer.md) と
> [`viewer_memory/repository.rs`](../../apps/desktop/src-tauri/src/viewer_memory/repository.rs)
> （**`RECOMPUTE_VIEWER_AGGREGATES_SQL`・`record_comment` の冪等契約**）、
> [`viewer_memory/service.rs`](../../apps/desktop/src-tauri/src/viewer_memory/service.rs)（`viewer_id` の合成）、
> [060b](060b-custom-css-import-backend.md) と
> [`overlay_theme/service.rs`](../../apps/desktop/src-tauri/src/overlay_theme/service.rs)
> （`validate_source_path` / `read_import_source` / TOCTOU の作法）、
> [`util.rs`](../../apps/desktop/src-tauri/src/util.rs)（`ensure_column` / `is_network_path` /
> `require_non_empty` / `reject_control_chars` / `with_filename_detail` / `now_rfc3339`）、
> [`comment_viewer/model.rs`](../../apps/desktop/src-tauri/src/comment_viewer/model.rs)（`CommentEventType`）、
> [`docs/security.md`](../security.md)（**§1／§3／§5／§8／§9／§10・「コメントビューア（配信サービス連携）方針」⑪**）。
> CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。
> **security-review 必須**（§9 保存データ種別の変更＋§5 ファイル読み取りの追加）。
>
> ⚠ **行番号は書かない**（特定はシンボル名で行うこと）。

## 目的

わんコメの CSV を読んで `viewers` を upsert し、**引き継いだ累積が以後の再計算で消えないようにする**
Rust 側の基盤を作る。UI（[065b](065b-onecomme-import-ui.md)）はこの上に乗るだけ。

## 現在の前提（実コードで検証済み・2026-08-16）

### 集計は毎回 `viewer_comments` から再計算される ← ⚠ 本タスク最大の制約

`RECOMPUTE_VIEWER_AGGREGATES_SQL` は `total_comments` / `bits_*` / `superchat_*` /
`subscription_count` / `is_member` / `last_subscription_at` / **`first_seen_at`** / **`last_comment_at`** を
すべて `viewer_comments` の集約（`COUNT` / `SUM` / `MIN` / `MAX`）で**上書き**する。

⇒ **`viewers` に引き継ぎ値を書くだけでは、その視聴者が次にコメントした瞬間に消える。**
⇒ 本タスクは **`imported_*` 列を足し、再計算 SQL 側で加算する**（理由と却下案は親 065）。

### 既存の作法

- マイグレーション基盤は無い。各 `repository::init()` の `CREATE TABLE IF NOT EXISTS` ＋
  [`util.rs`](../../apps/desktop/src-tauri/src/util.rs) の `ensure_column`（冪等）で運用。`PRAGMA user_version` は未使用。
- 接続は `DbState = Mutex<Connection>`。コマンドは `db: State<'_, DbState>` を受けて
  `service` → `repository` を呼ぶ（[`viewer_memory/commands.rs`](../../apps/desktop/src-tauri/src/viewer_memory/commands.rs)）。
  変更系は `app_logs::service::log_command_err(..., LogCategory::Storage, ...)` で**失敗のみ**記録する。
- コマンド登録は [`lib.rs`](../../apps/desktop/src-tauri/src/lib.rs) の `generate_handler!`。
  **アプリ定義コマンドは ACL 列挙不要**なので `capabilities/` は差分ゼロにできる（§⑪・062b 申し送り 8）。
- `viewers.id` は `format!("{source}:{provider_user_id}")`（`viewer_memory/service.rs`）。
- `CommentEventType` の DB 保存値は
  **`chat` / `superchat` / `membership` / `subscription` / `gift` / `donation` / `jewels` / `raid`**。
  ⚠ **`raid` は課金ではない**（062a が `subscription_count` / `is_member` に入れないと明記）。

### ファイル取り込みの唯一の先例（060b）

`import_overlay_theme(path, name)` が完全な同型。frontend が `@tauri-apps/plugin-dialog` の `open()` で
**生パス**を取り、Rust が受けて検証 → `std::fs::read` する。**`dialog:allow-open` は
[`capabilities/default.json`](../../apps/desktop/src-tauri/capabilities/default.json) と
[`capabilities/comment-viewer.json`](../../apps/desktop/src-tauri/capabilities/comment-viewer.json) に付与済み**で、
**`fs:*` はゼロ付与**。⇒ **本タスクで新規プラグイン・新規 capability は要らない。**

`validate_source_path` が押さえている論点（**そのまま踏襲すること**）:

1. ⚠⚠ **UNC / ネットワークパスを触る前に拒否**（`util::is_network_path`）。
   アプリ定義コマンドは ACL 対象外で全窓から呼べるため `path` が dialog 由来である保証はなく、
   Windows で `\\evil.example\share\x.csv` を渡されると `fs::metadata` の時点で
   **OS が SMB 接続し NTLM 資格情報ハッシュが飛ぶ**。⚠ **拡張子チェックより前に置くこと。**
2. 拡張子チェック（大小無視）
3. `metadata.is_file()`
4. **読む前にサイズ上限で落とす**（巨大ファイルをメモリへ載せない）
5. ⚠ **TOCTOU**: metadata を見てから read するまでにファイルは伸びうるので、**実バイト長で取り直す**
6. エラーは `util::with_filename_detail` で**ファイル名のみ**を付ける（フルパスを露出しない）

## このタスクでやること

### (1) `csv` crate を追加する ← ⚠ 唯一の新規依存

`apps/desktop/src-tauri/Cargo.toml` に `csv = "1"` を追加し、**理由を既存の作法どおりコメントで書く**
（[`Cargo.toml`](../../apps/desktop/src-tauri/Cargo.toml) の他の依存と同じ密度で）。理由:

- ⚠⚠ **わんコメの CSV は列順が固定ではない**（親 065 の実測：`screenName` が 6 列目 → 19 列目へ移動した）。
  **ヘッダ名で引く**必要があり、`csv` の `StringRecord::get` ＋ヘッダ索引（または serde デシリアライズ）が
  まさにそれを行う。**位置で読む手書き実装は将来必ず壊れる。**
- **メモは自由記入**でカンマ・改行・引用符が入りうる。わんコメは RFC4180 の標準クォートを使っている
  （`badges` 列が実証）。**引用フィールド内の改行**を手書きで正しく処理するのは事故のもとで、
  パース事故はそのままデータ破損になる。
- pure-Rust・**外部通信なし**・ビルドスクリプトなし。**同期 API**（Rust 完全同期の要件に適合・tokio 不要）。

⚠ **`serde` は既に依存にある**ので追加は `csv` 1 つだけ。⚠ **`csv` の `serde` 連携を使うかは実装時に決める**
（列が増減しうるので `#[serde(default)]` を全フィールドに付けるより、**ヘッダ索引 ＋ 明示 `get` のほうが
「必須列が無ければ拒否」を書きやすい**）。

### (2) `viewers` への列追加（`ensure_column` で冪等に）

⚠ **識別子（テーブル名・カラム名・型宣言）はすべてコンパイル時定数**。ユーザー入力を渡さない（§8）。

| 列 | 型 | 由来 | 役割 |
|---|---|---|---|
| `nickname` | `TEXT NOT NULL DEFAULT ''` | `nickname` | わんコメのニックネーム（`name` / `note` とは別概念） |
| `label` | `TEXT NOT NULL DEFAULT ''` | `label` | 単一値（親 065・(5)） |
| `imported_comments` | `INTEGER NOT NULL DEFAULT 0` | `tc` | ベースライン |
| `imported_gifts` | `INTEGER NOT NULL DEFAULT 0` | `tgc` | ベースライン |
| `imported_gift_amount` | `REAL NOT NULL DEFAULT 0` | `amount` | ⚠ **単位不明。既存の金額列に混ぜない** |
| `imported_active_days` | `INTEGER NOT NULL DEFAULT 0` | `atdDays` | ベースライン |
| `imported_stream_count` | `INTEGER NOT NULL DEFAULT 0` | `atdLives` | ベースライン |
| `imported_first_seen_at` | `TEXT`（NULL 可） | `lcts − interval` | ⚠ **仮説を含む（親 065・(3)）。独立列であることが復旧手段** |
| `imported_name_history` | `TEXT NOT NULL DEFAULT ''` | `nameHistory` | ⚠ **生 JSON 文字列のまま保管。パースしない** |
| `imported_at` | `TEXT`（NULL 可） | 取り込み日時 | **引き継ぎ由来かどうかの判別**（NULL＝引き継ぎ無し） |
| `gift_count` | `INTEGER NOT NULL DEFAULT 0` | 集計 | わんコメ互換の統合ギフト回数（下記 (3)） |
| `stream_count` | `INTEGER NOT NULL DEFAULT 0` | 集計 | 参加配信数（下記 (3)） |
| `active_days` | `INTEGER NOT NULL DEFAULT 0` | 集計 | 参加日数（下記 (3)） |

⚠ **既存列の意味論は 1 つも変えない。** `total_comments` は総コメント数のまま（`raid` 行も数える＝062a の決定）。

### (3) `RECOMPUTE_VIEWER_AGGREGATES_SQL` の改訂

**加算する 4 つ**（`?1` は viewer_id）:

```sql
total_comments = (SELECT COUNT(*) FROM viewer_comments WHERE viewer_id = ?1)
                 + COALESCE(imported_comments, 0),
gift_count     = (SELECT COUNT(*) FROM viewer_comments WHERE viewer_id = ?1
                    AND event_type IN ('superchat','membership','subscription','gift','donation','jewels'))
                 + COALESCE(imported_gifts, 0),
stream_count   = (SELECT COUNT(DISTINCT session_id) FROM viewer_comments WHERE viewer_id = ?1)
                 + COALESCE(imported_stream_count, 0),
active_days    = (SELECT COUNT(DISTINCT date(published_at)) FROM viewer_comments WHERE viewer_id = ?1)
                 + COALESCE(imported_active_days, 0),
```

- ⚠ **`gift_count` の集合に `raid` と `chat` を入れない**（`raid` は課金ではない＝062a）。
- ⚠ **`first_seen_at` / `last_comment_at` の式は変えない。** 実測値のまま残し、
  `imported_first_seen_at` とは**合成しない**（合成は読み出し側/UI の仕事）。
  ⚠⚠ ここを合成すると、(2) で独立列にした意味（解釈が外れたときに戻せる）が失われる。
- ⚠ `imported_*` は**この UPDATE 文が触らない列**なので、加算しても再計算のたびに壊れない。

### (4) 新規視聴者行を CSV から作るときの初期値

`viewers` の `first_seen_at` / `last_comment_at` は **NOT NULL**。CSV には初回来訪日が無いので:

- `last_comment_at` ← `lcts`
- `first_seen_at` ← `lcts`（**実測が 1 件も無い状態での暫定値**。その人が初めてコメントした時点で
  再計算により `MIN(published_at)` に置き換わる）
- `imported_first_seen_at` ← `lcts − interval`（ミリ秒。`interval` が 0 なら `lcts` と同値）

⚠ **`viewer_comments` の行は 1 件も作らない**（コメントを捏造しない）。
⇒ その視聴者は**再計算が一度も走っていない**状態で存在する。集計列には `imported_*` を初期値として
直接書き込むこと（`total_comments = imported_comments` など）。

### (5) `import_viewer_memory_csv(path)` コマンド

```
frontend（plugin-dialog の open() が返す生パス）
  → import_viewer_memory_csv(path)
     → validate_source_path 相当（is_network_path → 拡張子 .csv → is_file → サイズ上限 → 実バイト再チェック）
     → UTF-8 デコード（BOM があれば剥がす）
     → csv でヘッダを読む → 必須列の存在を検証（無ければ fail-closed で拒否）
     → 行ごとに変換・検証 → viewers を upsert
     → ImportResult を返す
```

- ⚠ **単一目的**（§3）。汎用の `read_file(path)` / `write_file(path, content)` 型は作らない。
- **上限**: ファイルサイズと**行数**の両方に上限を課す（数値は実装時に確定。CSV 実測は 61 行で 14.6KB）。
- **必須列**: `id` / `service` / `lcts`。⚠ **これが欠けていたら 1 行も取り込まずにエラーを返す**
  （わんコメのバージョン差で列が消えたとき、黙って壊れたデータを入れない）。
- **ID 変換**: `yt-` → `youtube:` ／ `tw-` → `twitch:`。
  ⚠⚠ **`tw-` は未検証の推定**（親 065）。⚠ **未知のプレフィックス・未知の `service` はスキップして
  件数に数える**（fail-closed。`service` 列とプレフィックスの**両方**が一致することを要求する）。
- **入力検証**（§8）: `id` / `name` / `nickname` / `note` / `label` は trim ＋
  `reject_control_chars`。数値列は失敗したら 0 として扱わず**その行をスキップ**して件数に数える
  （黙って 0 を入れると「引き継いだのに 0 だった」と区別できない）。
- **トランザクション**: 全行を 1 トランザクションで処理する（途中で失敗したら何も入らない）。
  ⚠ `unchecked_transaction` は `record_comment` と同じ作法（全 command が単一 `Mutex<Connection>` で直列化される）。

**戻り値 `ImportResult`**（ts-rs で bindings 出力・`src/features/viewer-memory/bindings/`）:

| フィールド | 意味 |
|---|---|
| `imported` | 新規に作った視聴者数 |
| `updated` | 既存の視聴者を更新した数 |
| `skipped_unsupported` | 未対応サービス／未知プレフィックスでスキップした数 |
| `skipped_invalid` | 必須値の欠落・検証失敗でスキップした数 |

⚠ **視聴者名・メモ・ID を戻り値に含めない**（件数のみ・§9）。

### (6) upsert のマージ規則 ← ⚠ ここを間違えるとユーザーの編集が消える

| 対象 | 規則 |
|---|---|
| `imported_comments` / `imported_gifts` / `imported_gift_amount` / `imported_active_days` / `imported_stream_count` / `imported_first_seen_at` / `imported_name_history` | **常に上書き**（加算しない）。⇒ 同じ CSV を何度取り込んでも結果が同じ（冪等） |
| `name` / `nickname` / `note` / `label` | **CSV 側が非空 かつ StreamDock 側が空のときだけ**書く（非破壊マージ） |
| `last_comment_at` | 既存値と `lcts` の**新しいほう**を採る（実測を過去へ戻さない） |
| `first_seen_at` | **既存行なら触らない**（実測値を壊さない）。新規行のみ `lcts` |
| `provider` / `provider_user_id` | 新規行のみ設定（既存行では不変） |
| `imported_at` / `updated_at` | 常に更新 |

⚠ **`name` を無条件で上書きしないこと。** CSV の `username` は `@handle` であって表示名ではないため、
コメント受信で得た `display_name` を上書きすると表示が退化する（親 065 の列マッピング）。

### (7) `lib.rs` への登録

- `generate_handler!` に `viewer_memory::commands::import_viewer_memory_csv` を追加。
- ⚠ **`viewer_memory::repository::init` は既に setup にある**ので追加不要。(2) の `ensure_column` を
  その `init()` の中に足す。**`stream_session::repository::init` より前**という既存の順序制約は変えない。

### (8) `docs/security.md` の更新

| 節 | 追記内容 |
|---|---|
| 「コメントビューア（配信サービス連携）方針」⑪ | **⑫として追補**: 視聴者メモリの保存項目に**わんコメから引き継いだ値**（累積コメント数・ギフト回数と額・参加日数/配信数・ニックネーム・メモ・ラベル・名前変更履歴の生 JSON・引き継ぎ日時）が加わる。**端末内 SQLite のみ・端末外非送信・既存の削除手段（`delete_viewer` / `clear_viewers`）がそのまま効く**（`viewers` の列なので行削除で消える） |
| §5 ファイル操作 | **読み取り専用の取り込み経路が 060b（`.css`）に加えて `.csv` の 1 本増える**。書き込みは発生しない。UNC 拒否・拡張子・サイズ上限・TOCTOU 再チェックは 060b と同じ作法 |
| §10 依存 | **`csv` crate の追加理由**（(1) の 3 点）を明記 |

⚠ **§1（外部通信）は不変**。本タスクは**ローカルファイルを読むだけ**で、わんコメへ接続しない
（HTTP API 経路は親 065 で対象外と決めている）。**新規 egress ゼロ・新規宛先ゼロ。**

### (9) テスト

**`repository.rs` / `service.rs`（Rust）**

- ⚠⚠ **引き継いだ累積が `record_comment` 後も消えない**（本タスクの中心。
  取り込み → `record_comment` を 1 件 → `total_comments == imported_comments + 1`）
- **同じ CSV を 2 回取り込んでも `imported_*` が二重加算されない**（冪等）
- **非破壊マージ**: StreamDock 側で `update_viewer_note` した後に、`memo` が空の CSV を当てても note が消えない
- **`name` が `display_name` から `@handle` に退化しない**（既存行の `name` が非空なら上書きしない）
- **ID 変換**: `yt-UCxxx` → `youtube:UCxxx`。⚠ **未知プレフィックス（`nico-` 等）はスキップされ
  `skipped_unsupported` に数えられる**。⚠ **`service` とプレフィックスが食い違う行もスキップされる**
- ⚠⚠ **列順が入れ替わった CSV でも同じ結果になる**（親 065 の実測を再現するテスト。
  **位置で読む実装への回帰を構造的に塞ぐ**）
- **必須列が欠けた CSV は 1 行も取り込まずエラー**（fail-closed）
- **引用フィールド内のカンマ・改行・二重引用符が正しく読める**
- **BOM 付き CSV も読める**（実測ファイルに BOM は無いが、Excel 経由で付く経路がありうる）
- **`gift_count` の集合に `raid` / `chat` が入らない**
- `imported_first_seen_at` が `lcts − interval` になる（`interval = 0` なら `lcts` と同値）
- 数値列が壊れている行は `skipped_invalid` に数えられ、**0 として取り込まれない**
- パス検証: UNC 拒否 ／ `.csv` 以外を拒否 ／ ディレクトリを拒否 ／ サイズ上限
- ⚠ **戻り値に視聴者名・メモ・ID が含まれない**（§9 の担保をテストで固定する）
- **ミューテーションで実効性を確認する**。最低限、再計算 SQL の `+ COALESCE(imported_comments, 0)` を
  外したときにレッドになること。

## このタスクでやらないこと

- **UI**（[065b](065b-onecomme-import-ui.md)）。本タスクはコマンドと bindings までで、画面は作らない。
- **HTTP API 連携・`onecomme.db` 直読み**（親 065 の線引き）。
- **`nameHistory` のパース**（要素の形が不明。生 JSON 文字列のまま保管する）。
- **`viewer_labels` / `viewer_name_history` テーブルの新設**（親 065・(5) で不要と判断）。
- **`viewer_comments` へのダミー行の挿入**（コメントを捏造しない）。
- **`superchat_amount` / `bits_amount` への `amount` の加算**（単位不明・親 065・(2)）。
- **`viewer_comments` のスキーマ変更**（本タスクは `viewers` の列追加のみ）。
- **既存の `record_comment` の冪等契約の変更**（043e の jewels 例外を含め一切触らない）。
- **アバター URL・`badges` の保存**。

## セキュリティ制約（docs/security.md 準拠）

- **外部通信ゼロ**（§1）。ローカルファイルを読むだけ。**新規 egress・新規宛先・新規スコープはゼロ。**
- **§5**: 読むのは**ユーザーが選んだ 1 ファイルのみ**。書き込み・削除はしない。
  ⚠ **UNC / ネットワークパスは拡張子チェックより前に拒否**（`util::is_network_path`・060b の S-4）。
- **§3 最小権限**: コマンドは `import_viewer_memory_csv` の**単一目的 1 本**。汎用のファイル読み取りを作らない。
  **capability は差分ゼロ**（アプリ定義コマンドは ACL 列挙不要・`dialog:allow-open` は既に付与済み）。
- **§8**: CSV は**信頼できない入力**。全文字列列を trim ＋ `reject_control_chars`。
  識別子はコンパイル時定数のみ・値はパラメータバインド。**ファイルサイズと行数の両方に上限**。
- **§9**: 保存は**端末内 SQLite のみ**。端末外へ出さない・クラウド同期しない。
  ⚠ **ログに視聴者名・メモ・ニックネーム・ラベル・ID・ファイルのフルパスを出さない**
  （`log_command_err` の固定安全文言のみ・エラーの `details` は `with_filename_detail` でファイル名まで）。
  戻り値は**件数のみ**。
- **§10**: 新規依存は **`csv` の 1 つだけ**（理由を Cargo.toml と security.md に明記）。
  ⚠ **async / HTTP / tokio 系の crate を持ち込まない**（Rust 完全同期の方針を維持）。
- **既存 DB を壊さない**: `CREATE TABLE IF NOT EXISTS` ＋ `ensure_column` の作法。
  ⚠ **既存列の意味論を変えない**・**新規 FK を張らない**。

## 完了条件

- `viewers` に (2) の列が冪等に追加され、**既存 DB で起動してもエラーが出ない**。
- `import_viewer_memory_csv` が動き、実物のわんコメ CSV（61 名）が取り込める。
- ⚠⚠ **引き継いだ累積が `record_comment` 後も消えない**（再計算 SQL の加算が効いている）。
- **同じ CSV を二度取り込んでも結果が変わらない**（冪等）。
- **StreamDock 側で編集したメモ・受信で得た表示名が、CSV の空値で潰されない**（非破壊マージ）。
- ⚠ **列順が入れ替わった CSV でも同じ結果になる**（テストで固定）。
- 必須列が欠けた CSV は fail-closed で拒否される。
- 未対応サービス・不正行の件数が `ImportResult` で返る（**視聴者名・ID は含まない**）。
- [`docs/security.md`](../security.md) に (8) の 3 か所が追記されている。
- ts-rs binding が生成され `pnpm check:bindings` が通る。
  ⚠⚠ **`ImportResult` は新規 binding ファイル＝未追跡なので、`git add -N` を挟まないと
  `git diff --exit-code` がそもそも見に行かず、生成漏れがあっても緑になる**（062b 申し送り 7）。
- Rust テストが通り、**ミューテーションで実効性を確認**している。
- **capability 追加ゼロ・`tauri.conf.json` 差分ゼロ・sidecar 差分ゼロ・`csp: null` 不変。**
  ⚠ **新規依存は `csv` の 1 つだけ**（`Cargo.toml` / `Cargo.lock` 以外に依存の差分が出ないこと）。
- `pnpm --filter ./apps/desktop typecheck` / `lint` / `cargo check` / `cargo test` が通る。
  [`docs/progress.md`](../progress.md) を更新。

## 確認コマンド

```bash
git diff --stat
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
pnpm --filter ./apps/desktop check:bindings   # ⚠ 新規 binding は先に git add -N すること

# ゼロ拡大の担保（差分ゼロが期待）
git status --short -- apps/desktop/src-tauri/capabilities/ apps/desktop/src-tauri/tauri.conf.json apps/comment-sidecar/
# 新規依存は csv の 1 つだけ（package.json / pnpm-lock.yaml は差分ゼロが期待）
git status --short -- apps/desktop/package.json pnpm-lock.yaml package.json

pnpm --filter ./apps/desktop tauri dev
# ① 実物の CSV を取り込む → viewers に 61 行できる（sqlite3 で確認）
# ② もう一度同じ CSV を取り込む → imported_* が二重加算されない
# ③ 取り込んだ視聴者のコメントを 1 件記録 → total_comments が imported_comments + 1 になる
#    （⚠ ここが本タスクの中心。0 や 1 に戻ったら再計算 SQL の加算が効いていない）
# ④ 既存 DB（実装前のデータがある状態）で起動してもエラーが出ない
```

## 実装後に必要なレビュー

- **security-review 必須**（[`security-review`](../../.claude/skills/security-review/SKILL.md)）。対象:
  - **§9 保存データ種別の変更**（わんコメ由来の値が増える／端末外へ出ないこと／削除手段が効くこと）
  - **§5 ファイル読み取りの追加**（UNC 拒否が拡張子チェックより前にあること・サイズ/行数上限・
    TOCTOU 再チェック・書き込みが無いこと）
  - **§8 信頼できない入力としての CSV の扱い**（制御文字・必須列 fail-closed・パラメータバインド）
  - **§3 単一目的**（汎用ファイル読み取りコマンドになっていないこと・capability 差分ゼロ）
  - **§10 `csv` crate の追加**（推移依存に async/HTTP 系が入っていないこと）
  - **ログとエラーに視聴者名・メモ・ID・フルパスが出ていないこと**
  - **新規通信・新規宛先がゼロであること**
