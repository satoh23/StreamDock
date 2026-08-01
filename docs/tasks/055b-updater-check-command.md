# 055b 更新検出エンジン（updater plugin 導入＋Rust コマンド・UI なし）

> ## 実装済み（2026-08-01）— ただし**実機 DevTools 確認は依頼者の手番で未実施**
>
> 記録は [`docs/progress.md`](../progress.md) の「2026-08-01 (055b 更新検出エンジン …)」節を正とする。
> 実装差分は `Cargo.toml` / `Cargo.lock` / `lib.rs` / `error.rs` / `package.json`（`check:bindings` の列挙のみ）/
> `ErrorCode.ts`（再生成）/ `docs/security.md`（3 箇所）と、新規 `src-tauri/src/app_update/`（2 本）・
> `src/features/app-update/`（3 本）。**capability / `tauri.conf.json` / CI / sidecar / JS 依存は差分ゼロ**。
>
> 本タスクで確定した要点（詳細は progress.md）:
> - **タイムアウト 15 秒**（`UpdaterBuilder::timeout`）。タスクファイルが警戒していた panic だけでなく、
>   **reqwest 既定の「無期限」が同じ症状（UI が「確認中」から戻らない）を作る**ため。`endpoints` は触っていない。
>   ⚠ **この値は `download()` に伝播しない**（レビューで訂正・当初は逆に書いていた）。`check()` が返す
>   `Update` は `timeout: None` ハードコードなので **DL 側が無期限**＝**055d は DL に別途上限を張ること**。
> - feature は `default-features = false, features = ["rustls-tls", "zip"]`（既定と同内容を明示固定）。
>   `cargo tree -i openssl-sys` / `-i native-tls` / `-i openssl` はいずれも **該当なし**。
>   ⚠ **`zip` を落とすと macOS でコンパイルエラー**になる（当初「サイレントに死ぬ」と書いていたのは誤り）。
> - `ErrorCode::UpdateCheckFailed` を **1 個だけ**追加。種別（到達不可/404/JSON 破損/署名検証失敗）では分けない。
> - **URL 漏洩対策**: `AppError::update_check_failed()` は**引数を取らない**／呼び出しは `map_err(|_| …)` のみ／
>   `From<tauri_plugin_updater::Error>` は作らない。契約テストで `map_err(` の総数＝`map_err(|_|` の数を照合。
> - ⚠ **`notes` / `latest_version` / `pub_date` は minisign 署名の対象外**（`latest.json` 自体は未署名）。
>   **055c / 055e は HTML として解釈しないこと。**
> - ⚠ **`osakit`（AppleScript 実行）が推移依存に入った**。plugin の macOS 昇格インストール経路が使うもので
>   **`check()` からは到達しない**が、**§4/§5 の評価は 055d の領分**（progress.md ⑥ 参照）。
>
> ### 残っている確認（**依頼者の手番**）
>
> `pnpm --filter ./apps/desktop tauri dev` → DevTools コンソール:
>
> ```js
> (async () => {
>   const t = performance.now();
>   try { console.log("resolved:", await window.__TAURI_INTERNALS__.invoke("check_app_update")); }
>   catch (e) { console.log("rejected:", e); }
>   finally { console.log("elapsed(ms)", Math.round(performance.now() - t)); }
> })();
> ```
>
> ⚠ **`await import("@tauri-apps/api/core")` は使えない**（当初この形で書いていたが実機で構文エラーになった）。
> 理由は 2 つ: ①DevTools のコンソールは入力を Module ではなく **Script** として解析するため
> **トップレベル `await` が構文エラー**になる（`Unexpected keyword 'import'`）②bare specifier の動的 import は
> ブラウザ側で解決できない（Vite が事前バンドルしていてもコンソールには import map が無い）。
> **`window.__TAURI_INTERNALS__.invoke` は Tauri v2 が全窓に必ず注入する**ので、
> `withGlobalTauri` 未設定（＝`window.__TAURI__` は無い）の本アプリでもこれが使える
> （`@tauri-apps/api` の `invoke` の実体も `window.__TAURI_INTERNALS__.invoke(cmd, args, options)` を呼ぶだけ）。
> **async IIFE にしてあるので何度貼り直しても `const` の二重宣言エラーにならない**（繰り返し実行するため重要）。
>
> | # | 状態 | 期待 | 前提 |
> | --- | --- | --- | --- |
> | 1 ✅ | **publish 前（今）** | 404 → **panic せず reject**。`code: "UPDATE_CHECK_FAILED"` ＋ 固定文言のみで **URL が入っていない** | **実施済み（2026-08-01・下記「実測結果」参照）** |
> | 2 | 到達不可 | 同じく reject されるだけで固まらない | `/etc/hosts` に `127.0.0.1 github.com`（listener なし＝即 connection refused）→ **確認後に必ず削除** |
> | 3 | **応答しないネットワーク** | **約 15 秒**で reject（永久 pending にならない） | 別ターミナルで `sudo nc -l 443` ＋ 上の `/etc/hosts` → **確認後に nc 停止＋行削除** |
> | 4 | — | **draft を publish**（GitHub Web UI・`gh` は無い） | 依頼者 |
> | 5 | publish 後 | `available: false` | |
> | 6 | `tauri.conf.json` の `version` を一時的に下げて再起動 | `available: true` ＋ `latestVersion: "0.1.0"` ＋ `notes`（`docs/release-notes/v0.1.0.md` の内容そのまま） | **下げるのは `tauri.conf.json` だけでよい**（updater が比較するのは `app.package_info().version`） |
> | 7 | version を**必ず戻す** | `pnpm test` が緑に戻る | |
>
> ⚠ **⑥ の間は `pnpm --filter ./apps/desktop test` が赤くなる**（055a の `check-version-sync.mjs` が 5 箇所の
> 一致を要求するため）。**これは戻し忘れの検出装置として正しい挙動**なので、⑥ の前後で `pnpm test` は走らせず
> ⑦ の後に緑を確認する。`tauri dev` は `beforeDevCommand` に `check:version` を含まないので起動はできる。
>
> ⚠ **`pnpm check:bindings` はコミット前は exit 1 になる**（`ErrorCode.ts` の意図した変更が未コミットのため。
> 中身は `git diff --exit-code`）。生成にドリフトが無いことは別途確認済み（progress.md 参照）。

> 状態: ~~**未着手（実装サブタスク・UI なし基盤タスク）**~~。位置づけ・方式決定・線引きは
> 親 [055](055-app-self-update.md) を正とする。**配布側 [055a](055a-updater-release-pipeline.md) の完了が前提**
> （エンドポイントに実物の `latest.json` が無いと検証できない）。
>
> **必読前提**: 親 [055](055-app-self-update.md)（方式決定・egress の定義・**capability ゼロ方針とその限界**・
> **初の `async fn` になる罠**）、[055a](055a-updater-release-pipeline.md)（`plugins.updater` と署名鍵）、
> Rust エントリ [`lib.rs`](../../apps/desktop/src-tauri/src/lib.rs)（Builder / plugin 登録 / `invoke_handler`）、
> エラー型 [`error.rs`](../../apps/desktop/src-tauri/src/error.rs)（`AppError` / `ErrorCode` / `AppResult`）、
> 依存の書き方 [`Cargo.toml`](../../apps/desktop/src-tauri/Cargo.toml)（**各 crate に追加理由コメントが付く文化**）、
> capability [`default.json`](../../apps/desktop/src-tauri/capabilities/default.json)、
> invoke ラッパの作法 [`toolApi.ts`](../../apps/desktop/src/features/tools/toolApi.ts)、
> [`docs/security.md`](../security.md)（§1/§3/§9/§10/Capabilities 方針）。
> CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。
> **本体プロセス初のインターネット egress ＋ network/http crate ＋ auto update 系**＝**security-review 必須**。
>
> ⚠ **行番号は書かない**（特定はシンボル名で行うこと）。

## 目的

「更新があるかどうか」を判定できる **Rust コマンド 1 本**と、その薄い invoke ラッパを作る。
**UI は一切作らない**（ベル・バッジ・画面は [055c](055c-update-notice-and-screen.md)、
DL/インストール/再起動は [055d](055d-update-install-and-restart.md)）。

038a / 039a / 040a / 041a と同じ「基盤だけ先に作って devtools から直接叩いて確かめる」型のタスク。
本タスクの区切りで security.md への追記（§1 例外 / §10 依存 / Capabilities 方針）も済ませる。

## 現在の前提（調査結果・実コード）

### Rust 側の構造

- `lib.rs` の `run()` が `tauri::Builder::default()` に **`.plugin(…)` を 4 つ**（`opener` / `dialog` / `autostart` / `shell`）
  並べ、`.setup(…)` で DB とプロセス管理の State を `app.manage` し、
  `.invoke_handler(tauri::generate_handler![…])` に全コマンドを列挙して、`.build()` ＋ `.run(closure)` で
  `RunEvent::Exit` に sidecar の shutdown をぶら下げている。
- コマンドは `commands.rs`（薄い）→ `service.rs`（ロジック）→ `repository.rs`（SQLite）の 3 層が基本。
  **DB を持たない機能は 2 層**でよい（`tools/icon.rs` を呼ぶ `extract_app_icon` が「State を取らない＝最小権限」の先例）。
- 戻り値は必ず `AppResult<T>`。`ErrorCode` は `error.rs` の enum で、ts-rs 経由で TS へ出る。
- `Cargo.toml` は**すべての依存に「なぜ入れたか」の日本語コメント**が付いており、
  「**Rust は完全同期のまま（async/WS/HTTP crate を足さない）**」が繰り返し書かれている。本タスクはここを崩す。
- **`src-tauri/src` に `async fn` は 1 つも無い**。窓生成コマンドの `#[tauri::command(async)]` は
  「同期 fn を tokio worker で走らせる」だけ。

### capability

`default.json`（メイン窓）は `core:default` ＋ dialog 2 ＋ autostart 3 ＋ window 操作 4。
他 3 枚（`comment-viewer` / `comment-overlay` / `pinned-overlay`）は `core:default` のみ。
**`tauri-plugin-shell` は crate を入れつつ `shell:*` をゼロ付与**という先例があり、本タスクはこれと同型。

### フロント側の作法

`src/features/*/xxxApi.ts` が `invoke` の薄いラッパで、コンポーネントは `invoke` を直接呼ばない。
型は `features/*/bindings/`（ts-rs 生成・`pnpm check:bindings` でドリフト検査）と `types.ts`（手書き）に分かれる。
`check:bindings` の `git diff --exit-code` の対象パスは **`apps/desktop/package.json` にハードコードされた列挙**なので、
**新しい bindings ディレクトリを作ったら、この列挙にも足さないと検査対象から漏れる**。

## このタスクでやること

### (1) 依存の追加（理由コメント必須）

- `Cargo.toml` に `tauri-plugin-updater = "2"` を追加する。既存 crate と同じ書式で、直上に**なぜ入れるか**を書く:
  - 何のために入れるか（アプリ自己アップデートの検出・DL・インストール）
  - **「Rust 完全同期」方針への正面からの例外**であること（reqwest / zip / tar / flate2 / minisign-verify が入る）
  - 代替案（GitHub API 直参照＋手動 DL 誘導）を検討して却下した理由（要望を満たさない）
  - **TLS は `rustls` 系 feature を選ぶ**（native-tls/OpenSSL を持ち込まない）。正確な feature 名は crate ドキュメントで確認する
  - **`tauri-plugin-process` は入れない**（再起動は `AppHandle::restart()`。`process:allow-restart` を配らずに済む）
  - **JS 側 `@tauri-apps/plugin-updater` も入れない**（capability を広げないため）
- `pnpm-lock.yaml` / `apps/desktop/package.json` は**変更しない**（JS 側の依存は増えない）。

### (2) plugin 登録

- `lib.rs` の `.plugin(tauri_plugin_shell::init())` の並びに `.plugin(tauri_plugin_updater::Builder::new().build())` を足す。
  直上に **「capability に `updater:*` は付与しない（Rust 専用）」**というコメントを、shell の既存コメントと同じ調子で書く。
- ⚠ **`endpoints` を実行時に上書きしない**（`UpdaterBuilder::endpoints()` を呼ばない）。宛先は
  `tauri.conf.json` の `plugins.updater.endpoints`（055a で設定済み）だけを正とする。

### (3) `app_update` モジュールと `check_app_update` コマンド

- 新規 `src-tauri/src/app_update/`（`mod.rs` / `commands.rs`。DB を持たないので **2 層**）。`lib.rs` に `mod app_update;` を足す。
- **`check_app_update`（`async fn`）** → `AppResult<AppUpdateStatus>`。
  - 引数は `AppHandle` のみ（DB State を取らない＝最小権限。`extract_app_icon` と同じ思想）。
  - `app.updater()?.check().await` の結果を `AppUpdateStatus` に詰め替える。
- 型 `AppUpdateStatus`（ts-rs で export）:

  | フィールド | 型 | 意味 |
  | --- | --- | --- |
  | `current_version` | `String` | いま動いているバージョン |
  | `available` | `bool` | 更新があるか（**バッジの出し分けはこれだけで決まる**） |
  | `latest_version` | `Option<String>` | 更新がある場合の新バージョン |
  | `notes` | `Option<String>` | `latest.json` の `notes`（＝リリースノートのマークダウン原文） |
  | `pub_date` | `Option<String>` | 公開日時 |

  export 先は新規 `apps/desktop/src/features/app-update/bindings/`。
  **`apps/desktop/package.json` の `check:bindings` の対象パス列挙にこのディレクトリを足す**（漏れると検査対象外になる）。
- **エラーは全経路 `AppResult` に落とす**。`unwrap()` / `expect()` を使わない。
  - ⚠ **panic すると invoke の Promise が永久未解決になる**（`lib.rs` の `WINDOW_OPEN_LOCK` 周辺コメントが同じ罠を記録済み）。
    055c の UI は「読み込み中」から永久に戻らなくなる。
  - 「ネットワーク到達不可」「エンドポイント 404（＝まだ publish していない draft のとき）」「JSON が壊れている」
    「署名検証に失敗」がすべて `Err(AppError)` になること。**`available: false` に潰さない**
    （「更新なし」と「確認できなかった」は 055c で別表示にするため区別が要る）。
  - `ErrorCode` は既存の値で足りるかを実装時に判断する。足りなければ追加するが、**追加は最小限**にする
    （`ErrorCode` の追加は `log_message()` の match と ts-rs の bindings に波及する）。
- `invoke_handler` の `generate_handler!` に `app_update::commands::check_app_update` を追加する。

### (4) フロントの薄いラッパ（UI なし）

- 新規 `apps/desktop/src/features/app-update/appUpdateApi.ts`。`toolApi.ts` と同じ作法で
  `checkAppUpdate(): Promise<AppUpdateStatus>` を 1 本 export するだけ。**コンポーネントは作らない**。

### (5) security.md への追記（本タスクの区切りで済ませる）

- **§1 に「### 例外（055・アプリ自己アップデート＝StreamDock 本体プロセス初のインターネット egress）」**を新設する
  （既存 6 例外と同じ書式）。書く内容:
  - 宛先は `github.com` → `objects.githubusercontent.com` の **2 ホストのみ・GET のみ・送信するアプリ側データはゼロ**。
  - 宛先は `tauri.conf.json` の**コンパイル時定数**で、実行時にもフロントからも差し替えない。
  - 完全性は **minisign 公開鍵検証**で fail-closed（署名が合わないものは実行しない）。
  - **チェックは起動時に自動・既定 ON 固定で、ユーザーが止める手段は設けない（本人の決定）**。
  - **sidecar の fail-closed ホストガードには寄せない**理由（sidecar はコメビュ窓を開いている間しか生きておらず、
    インストールは Tauri プロセス側でしかできず plugin の reqwest はホストガードを通らない＝
    「守られているつもり」になるだけ。032c-a で切ったメイン窓⇄sidecar の依存も復活する）。
- **§10 に「追加した依存（055・アプリ自己アップデート）」**を追記する（既存の 032c-b / 032c-d / 036b / 036c / 044a と同じ書式）。
  `tauri-plugin-updater`（→ reqwest / zip / tar / flate2 / minisign-verify）と、
  **明示的に足さないもの**＝`tauri-plugin-process` / JS 側 `@tauri-apps/plugin-updater` / マークダウンライブラリ。
  **「Rust 完全同期」方針を初めて崩す**ことを明記する。
- **「Tauri Permissions / Capabilities 方針」に 055 の節**を足す（032c-b の shell と同型）。
  「crate は入れるが capability はゼロ付与」であることと、
  ⚠ **その限界＝アプリ定義コマンドは ACL 対象外なので 4 窓すべてから呼べる**ことを 1 行残す。

## このタスクでやらないこと

- **UI の一切**（ベル・バッジ・アップデート画面・進捗表示）。**自動チェックの発火**（起動時フックは 055c）。
- **DL・インストール・再起動**（`install_app_update` / `restart_app` は 055d）。§5 の例外追記も 055d。
- 更新チェックの ON/OFF トグル（親 055 の決定により作らない）。バッジの件数表示。
- **capability の変更**（`capabilities/*.json` は差分ゼロ）。JS 側 plugin の追加。`csp: null` の変更。
- 更新の成否を SQLite / app_logs へ記録すること（新規の保存経路を作らない）。
- `tauri.conf.json` の変更（055a で済んでいる）。CI の変更。

## セキュリティ制約（docs/security.md 準拠）

- **egress は前掲 2 ホスト・GET のみ・送信データゼロ**（§1・上記の例外節が正）。`endpoints` を実行時に上書きしない。
- **capability は不変**（`updater:*` / `process:*` を配らない）。JS 側 plugin を入れない（§3・Capabilities 方針）。`csp: null` 不変。
- **§9**: 更新チェックのログに **URL・ローカルパス・環境情報を出さない**。出してよいのはバージョン文字列と成否のみ。
  `AppError.message` は既存規約どおり「ユーザー向けの安全な文言」で、生のエラー文字列・URL を載せない
  （`From<rusqlite::Error>` が生文字列を落としているのと同じ扱いにする）。
- **§10**: 依存追加の理由・代替検討・却下理由を `Cargo.toml` のコメントと security.md の両方に書く。
  `rustls` 系 feature を選び OpenSSL を持ち込まない。
- **§3 最小権限**: コマンドは `AppHandle` のみを取り、DB State を取らない。フロントから URL・バージョンを受け取らない。

## 完了条件

- `cargo check` / `cargo test`（ts-rs の `export_bindings` を含む）が通る。
- `pnpm --filter ./apps/desktop check:bindings` が通り、**新しい bindings ディレクトリが検査対象に入っている**。
- devtools から `invoke("check_app_update")` を直接叩いて、**055a が publish した実リリースに対して**
  「更新なし（`available:false`）」と「更新あり（`available:true` ＋ `latest_version` ＋ `notes`）」の**両方**を確認した。
  - 「更新あり」は `tauri.conf.json` の version を一時的に下げて再起動する等で作る（**確認後に必ず戻す**。
    `check:version` が fail するので戻し忘れは検出される）。
- **ネット遮断・エンドポイント 404（draft 状態）・壊れた JSON のいずれでも panic せず `Err(AppError)` が返る**ことを確認した。
  UI が無い時点でも、devtools の Promise が reject されることで確認できる。
- `capabilities/*.json` に差分が無い。`csp: null` 不変。JS 側の依存が増えていない。
- security.md の §1 例外 / §10 依存 / Capabilities 方針 の 3 箇所が追記されている。
- `pnpm --filter ./apps/desktop typecheck` / `lint` / `test` が通る。[`docs/progress.md`](../progress.md) を更新。

## 確認コマンド

```bash
git diff --stat
cd apps/desktop/src-tauri && cargo check && cargo test && cd -
pnpm --filter ./apps/desktop gen:bindings
pnpm --filter ./apps/desktop check:bindings
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
pnpm --filter ./apps/desktop test

# ゼロ拡大の担保（差分ゼロが期待）
git status --short -- apps/desktop/src-tauri/capabilities/ apps/desktop/package.json.orig \
  apps/comment-sidecar/ .github/
# JS 側の依存が増えていないことの担保（dependencies に差分が無いこと）
git diff -- apps/desktop/package.json pnpm-lock.yaml

# UI は無いので devtools から直接叩いて確認する
pnpm --filter ./apps/desktop tauri dev
#   DevTools コンソールで（⚠ トップレベル await と bare specifier の import は使えない。冒頭の注記参照）:
#     (async () => { try { console.log(await window.__TAURI_INTERNALS__.invoke("check_app_update")) }
#                    catch (e) { console.log("rejected:", e) } })();
#   → available / latestVersion / notes / currentVersion が返る（JSON は camelCase）
#   → 機内モード（ネット遮断）でも reject されるだけで、アプリが固まらない
```

## 実装後に必要なレビュー

- **security-review 必須**。観点:
  - **通信先が前掲 2 ホストだけ**であること（`endpoints` を実行時に上書きしていない・`api.github.com` を叩いていない・
    URL に動的プレースホルダやアプリ側データを載せていない）。
  - **capability の差分がゼロ**であること（`updater:*` / `process:*` を配っていない・JS 側 plugin を入れていない）。`csp: null` 不変。
  - **panic 経路が無い**こと（`unwrap` / `expect` が無く、全エラーが `AppResult` に落ちる）。
    ＝invoke の Promise が永久未解決になり UI が固まる事故を防げているか。
  - **ログに URL・パス・環境情報が出ていない**こと（§9）。`AppError.message` が安全文言であること。
  - `Cargo.toml` の理由コメントと security.md の 3 箇所が、**なぜ「Rust 完全同期」方針を崩すのか**を説明できていること。
  - **アプリ定義コマンドが 4 窓すべてから呼べる**という限界が security.md に残っていること。
