# 055d ダウンロード → インストール → 再起動

> **状態: 実装済み＋ security-review / code-review 対応済み（2026-08-02・実機確認は未実施／未コミット）。**
> レビューで見つかった**修正必須 2 件**（macOS 昇格経路のパス未エスケープ＝root コマンドインジェクション／
> `InstallGuard` に弾かれた 2 本目を「完了」と誤読する経路）と、**生存変異 6 件**は対応済み。
> 内容は progress.md 055d 節の「security-review / code-review の対応」を正とする。
>
> ⚠ **`pnpm check:bindings` は未コミットの作業ツリーでは通らない**（`git diff --exit-code` が HEAD と比べるため）。
> **コミット後に走らせること**（再生成しても作業ツリーが変わらない＝実 drift ゼロは確認済み）。
> 記録は [`docs/progress.md`](../progress.md) の 055d 節を正とする（DL タイムアウトの根拠・
> イベントと capability 不変の根拠・`restart()` のスレッド依存・plugin 内部 panic への対処と限界・
> 契約テストの拡張・dev で確認できる範囲・099b への積み残しをすべてそこに記載した）。
>
> ⚠ **完了条件を 1 つ読み替えた（下記「完了条件」の注記を参照）**:
> 「`tauri dev` でボタンを押すと進捗が進み、完了状態になる」は**そのままでは満たせない**。
> dev の実行ファイルは `.app` バンドルではないため、plugin の置換先 `extract_path` が
> **`apps/desktop/src-tauri/target/debug` そのもの**になり、install を走らせると**ビルドツリーが消える**。
> ＝ **dev では install を押さない**（DL の進捗が進むところまでで止める）。実挙動の確定は [099b](099b-updater-e2e.md)。
>
> 位置づけ・方式決定・線引きは
> 親 [055](055-app-self-update.md) を正とする。**[055c](055c-update-notice-and-screen.md) の
> アップデート画面（ボタンは `disabled`）まで完了していることが前提**。
>
> **必読前提**: 親 [055](055-app-self-update.md)（**capability ゼロ方針とその限界**・**§5 の例外が発生する**・
> **初の `async fn` の罠**）、[055b](055b-updater-check-command.md)（`check_app_update` と `app_update` モジュール）、
> [055c](055c-update-notice-and-screen.md)（画面と `useAppUpdate`）、
> Rust エントリ [`lib.rs`](../../apps/desktop/src-tauri/src/lib.rs)、エラー型 [`error.rs`](../../apps/desktop/src-tauri/src/error.rs)、
> [`docs/security.md`](../security.md)（**§5 ファイル操作** / §1 / §3 / §9 / §10）。
> CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。
> **自分自身を置換する（§5 の例外）＋ auto update 系**＝**security-review 必須**。
>
> ⚠ **行番号は書かない**（特定はシンボル名で行うこと）。
> ⚠ **実機確認はこのタスクでは完了しない**。mac/win の実挙動は [099b](099b-updater-e2e.md) で確定する
> （048/049/050 と同じ「実装済み（実機確認は未実施）」の扱い）。

## 目的

アップデート画面の「アップデート」ボタンを押すと、**ダウンロードとインストールが自動で走り**、
完了後の**再起動ボタン**で新しいバージョンが反映されるようにする。これで 055 系の機能ループが閉じる。

## 現在の前提（調査結果・実コード）

- [055b](055b-updater-check-command.md) で `tauri-plugin-updater` が Rust に入り、`app_update` モジュールと
  `check_app_update`（`async fn`・`AppResult<AppUpdateStatus>`）が動いている。
  宛先は `tauri.conf.json` の `plugins.updater.endpoints`（コンパイル時定数・1 本）。

### ⚠ 055b からの申し送り（実装済み・2026-08-01。詳細は [`docs/progress.md`](../progress.md) の 055b 節）

1. **DL 側にタイムアウトを別途張ること（⚠ 当初の申し送りは事実と逆で、レビューで訂正した）。**
   055b は `UpdaterBuilder::timeout(15 秒)` を張って「繋がるが応答しない」ネットワークでのハングを塞いでいるが、
   **この値は `download()` に伝播しない**。`tauri-plugin-updater` 2.10.1 の `Updater::check()` は戻り値を
   **`Update { timeout: None, .. }` とハードコード**して組み立て、`Update::download()` はその
   `self.timeout`（＝`None`）を見る。＝**DL 側は既定で無期限**で、いま無防備なのはこちら。
   - ⚠ **当初「15 秒が伝播して 100MB の DL を殺すから updater を再利用するな」と書いていたのは誤り。**
     これを信じて「timeout 無しの updater を別途 build」すると、**055b が塞いだのと同じ
     「Promise 永久未解決」を DL 側で作る**（しかも DL のほうが長時間・高確率）。
   - 正しい対処: `Update.timeout` は reqwest の**総**リクエスト時間なので、サイズ依存で値を決められない。
     reqwest 自身が「サイズが事前に分からない転送には `read_timeout`（各 read でリセット）が適切」と
     明記しているので、**`configure_client` で `connect_timeout` + `read_timeout` を張る**こと。
   - ⚠ `configure_client` は `Update` 構築時に `configure_client: self.configure_client.clone()` として
     **持ち越される**（当初「持ち越されない」と書いていたのも誤り）＝`download()` にも効く。
2. **`osakit`（AppleScript 実行）が推移依存に入っている。** plugin の `Update::install_inner()` は、
   macOS でアプリ置換が `PermissionDenied` になった**フォールバック時にだけ**
   `do shell script "rm -rf '<extract_path>' && mv -f '<tmp>' '<extract_path>'" with administrator privileges` を
   OSAKit で実行する。**`check()` からは到達しないので 055b の面はゼロ**だったが、
   **`install` を配線する 055d で初めてこの経路が生きる**。security.md **§4「Shell実行は原則使わない」と
   §5 の例外（自己置換）の両方**を、この事実を踏まえて書くこと。
   ⚠ さらに、この plugin 内部コードは `script.compile().expect("invalid AppleScript")` と
   `tx.send(r).unwrap()` を含む＝**こちらのコードでは消せない panic 経路**。`unwrap`/`expect` をゼロにしても
   「invoke の Promise が永久未解決」を完全には防げないので、**UI 側にタイムアウト/中断の逃げ道を用意するか、
   少なくともその限界を記録すること**（055b の `check` にはこの問題は無い）。
3. **`zip` feature を落とさないこと。** `Cargo.toml` の `features = ["rustls-tls", "zip"]` の `zip` が
   `flate2`/`tar`/`zip` を引いており、**macOS の `.app.tar.gz` 展開に必須**。
   （⚠ レビューで訂正: 当初「サイレントに mac だけ死ぬ」と書いていたが誤り。plugin の macOS 実装は
   `flate2`/`tar` を **feature gate 無しで**使うので、落とすと **macOS ではコンパイルエラー**＝必ず気付く。）
4. **`ErrorCode` は `UpdateCheckFailed` の 1 個だけ**。DL/インストールの失敗に別 code が要るかは 055d の判断。
   ただし**種別（到達不可/404/JSON 破損/署名検証失敗）で細かく分けない**方針は 055b で確定済み。
5. **エラーに URL を載せない作法**（§9）: `AppError::update_check_failed()` は**引数を取らない**／
   呼び出しは `map_err(|_| …)` のみ／`From<tauri_plugin_updater::Error> for AppError` は作らない。
   `app_update/commands.rs` の `#[cfg(test)] mod check_command_contract` が `map_err(` の総数と
   `map_err(|_|` の数の一致を照合しているので、**055d で追加するコードも同じ形にすること**
   （`|e|` を 1 つ書くとテストが落ちる）。
- [055c](055c-update-notice-and-screen.md) で `UpdateScreen` と `useAppUpdate` があり、
  **「アップデート」ボタンは `disabled`** のまま。更新内容はプレーンテキスト表示。
- `capabilities/*.json` は 055b 時点で差分ゼロ（`updater:*` / `process:*` を配っていない）。
- `lib.rs` は `.build()` ＋ `.run(closure)` に分割済みで、`RunEvent::Exit` で
  [`comment_sidecar::shutdown`](../../apps/desktop/src-tauri/src/comment_sidecar/mod.rs) を呼んでいる。
- `error.rs` の `AppError.message` は「ユーザー向けの安全な文言（フルパス・環境変数・stack trace・secret を含めない）」
  という規約で、`From<rusqlite::Error>` は生エラー文字列を意図的に捨てている。

### OS ごとにインストールの意味が違う（UI 設計に直結する）

| OS | インストールの実体 | 「再起動」ボタンの扱い |
| --- | --- | --- |
| macOS | `.app.tar.gz` を展開して **`.app` を丸ごと置換**。アプリは生きたまま | ボタンが素直に効く |
| Windows | **NSIS インストーラを起動**し、updater 側がアプリを終了させる | **ボタンに到達しない可能性が高い** |

⚠ **Windows では「再起動ボタンを押す」体験にならない可能性がある。**
UI は両方を扱える形にし、Windows では「インストーラが起動します。完了後に自動で立ち上がります」等へ分岐させる。
**どちらの挙動になるかは [099b](099b-updater-e2e.md) で実測して確定する**（本タスクでは両対応の形を用意するところまで）。

### `tauri.conf.json` の `plugins.updater.windows.installMode`

055a で `passive` を第一候補として設定済み。実挙動が期待と違えば 099b の結果を受けて変更する。

## このタスクでやること

### (1) `install_app_update` コマンド（Rust）

- `app_update/commands.rs` に **`install_app_update`（`async fn`）** → `AppResult<()>` を足す。
- **引数は `AppHandle` のみ。フロントから URL・バージョン・ファイル名を一切受け取らない**（§3 最小権限・§8）。
  受け取ってしまうと「フロント側から任意の場所を落としてインストールさせる」経路が生まれる。
- 実装方針: **内部で `check()` をやり直してから `download_and_install()` を呼ぶ**。
  - ⚠ **`Update` オブジェクトを `Mutex<State>` に持ち越して `.await` を跨がせない**。
    このリポジトリの State はすべて `std::sync::Mutex`（Rust 完全同期の名残）で、
    **`.await` を跨ぐと `Send` 境界で落ちるか、跨げてもロックを握ったまま await してデッドロックを作る**。
    **状態を持たない（毎回 check し直す）**のが最も安全で、実装も短い。
  - check し直した結果「更新なし」だった場合は素直に `Ok(())` で返す（多重押下・時間差での競合を吸収する）。
- **進捗の通知**: `download_and_install` のコールバックで受け取ったバイト数を、
  Tauri の event（`app.emit(…)`）でフロントへ流す。
  - ⚠ **イベントのペイロードに URL・ローカルパスを載せない**（§9）。載せてよいのは
    「受信済みバイト数」「総バイト数（分かる場合）」「フェーズ（downloading / installing / done）」だけ。
  - 総バイト数が不明な場合があるので、**UI は不定形（インデターミネート）にも耐える形**にする。
- **全経路を `AppResult` に落とす**。`unwrap()` / `expect()` を使わない
  （panic は invoke の Promise を永久未解決にし、UI が「インストール中」から戻らなくなる）。

### (2) `restart_app` コマンド（Rust）

- `app_update/commands.rs` に `restart_app` を足す。**`AppHandle::restart()` を使う。**
  **`tauri-plugin-process` は入れない**（`process:allow-restart` を配らずに済む・親 055 の決定）。
- ⚠ **メインスレッド制約の有無を実装時に確認する。** 必要なら `app.run_on_main_thread(…)` 経由にする。
- ⚠ **再起動前に sidecar が確実に落ちること**を確認する。`lib.rs` の `RunEvent::Exit` で
  `comment_sidecar::shutdown` を呼んでいるが、**`restart()` がこのイベントを発火させるかは実装時に確認が要る**。
  発火しないなら、`restart_app` の中で明示的に `comment_sidecar::shutdown(&app)` を呼んでから再起動する。
  これを外すと**孤児 sidecar が残り、次回起動でポートを掴んだまま**になる。
- `invoke_handler` の `generate_handler!` に 2 本とも追加する。

### (3) フロントの配線

- `appUpdateApi.ts` に `installAppUpdate()` / `restartApp()` を足す（薄いラッパのみ）。
- `useAppUpdate.ts` に `phase` を拡張する: `"idle" | "checking" | "ready" | "downloading" | "installing" | "installed" | "error"`。
  - 進捗イベントを購読し、**アンマウント時に必ず unlisten する**。
  - **多重実行を防ぐ**（`downloading` / `installing` 中はボタンを無効化する）。
- `UpdateScreen.tsx`:
  - 「アップデート」ボタンの `disabled` を外して `installAppUpdate()` に配線する。
  - **進捗バー**を出す（総バイト数不明時は不定形表示）。
  - 完了後、**OS で表示を分岐**する:
    - macOS: 「再起動」ボタン → `restartApp()`
    - Windows: 「インストーラが起動します。完了後に自動で立ち上がります」等の案内
      （`useHostOs()` で判定する。`SettingsView.tsx` が同じ判定で Windows 向け注記を出している先例あり）。
  - 失敗時は「更新に失敗しました」の定型文言と再試行の導線。**生エラー文字列・URL は出さない**（§9）。
  - ⚠ **インストール中に画面を離れられないようにはしない**（他画面へ遷移できてよい）。
    ただし遷移しても処理は Rust 側で走り続けるので、**戻ってきたときに状態が復元される**か、
    少なくとも**壊れない**ことを確認する。

### (4) security.md への追記（§5 の例外）

- **§5「ファイル操作はアプリ管理領域に限定する」に「### 例外（055・アプリ自己アップデート＝自己置換）」を新設する。**
  ここが本タスクで最も見落としやすい論点。書く内容:
  - アップデータは **macOS では自分自身の `.app` を丸ごと置換**し、**Windows ではインストーラを起動して
    インストール先を書き換える**。＝「アプリの管理領域内に限定する」原則の**外に出る**。
  - 書き込み先は**アプリ自身のインストール位置に限定**され、任意パスではない。
    **書き込む内容は minisign 公開鍵で検証済みのバイト列に限られる**（署名が合わなければ何も書かない＝fail-closed）。
  - 経路は `tauri-plugin-updater` の実装のみで、**汎用のファイル書き込みコマンドを新設していない**（§3 の
    「`write_file(path, content)` のような強すぎる command を作らない」に抵触しない）。
  - **フロントから書き込み先・URL・バージョンを指定できない**（`install_app_update` の引数は `AppHandle` のみ）。
  - ⚠ **`externalBin` の sidecar も同時に置き換わる**（本体バンドル同梱のため）。
    更新後に sidecar の実行ビット・ad-hoc 署名が保たれるかは 099b で実測する。

## このタスクでやらないこと

- **サイレント自動更新**（ユーザーの操作なしに更新を当てる）。差分更新。ロールバック。
- **マークダウン描画**（[055e](055e-release-notes-markdown.md)）。
- **実機での E2E 確認**（[099b](099b-updater-e2e.md)）。macOS の署名・notarize（[099](099-user-test-package.md) の領分）。
- capability の追加（`updater:*` / `process:*` を配らない）。JS 側 plugin の追加。`tauri-plugin-process` の追加。
- 更新の成否を SQLite / app_logs へ記録すること（新規の保存経路を作らない）。
- CI / `tauri.conf.json` の変更（`windows.installMode` の見直しが必要になった場合は **099b の結果を受けて**行う）。

## セキュリティ制約（docs/security.md 準拠）

- **§5 の例外**（自己置換）。上記 (4) の節を追記すること。**書き込み先はアプリ自身のインストール位置のみ・
  内容は minisign 検証済みのみ・フロントから指定不可**の 3 点が担保の柱。
- **§3 最小権限**: `install_app_update` の引数は `AppHandle` のみ。**URL・パス・バージョンをフロントから受け取らない**。
  汎用のダウンロード/書き込みコマンドを作らない。
- **§1**: 宛先は 055b で決めたコンパイル時定数の 2 ホストのみ。**`endpoints` を実行時に上書きしない**。
- **capability 不変**（`updater:*` / `process:*` を配らない）。`csp: null` 不変。
  ⚠ ただし **`install_app_update` は 4 窓すべてから呼べる**（アプリ定義コマンドは ACL 対象外）。
  親 055 で security.md に記録済みの限界だが、**本タスクで「実際にインストールを起こせるコマンド」になる**ため、
  レビューで改めて確認する。
- **§9**: 進捗イベント・ログ・画面のどこにも **URL・ローカルパス・環境情報を出さない**。
  出してよいのはバイト数・フェーズ・バージョン文字列・成否のみ。`AppError.message` は安全文言に限る。
- **panic を作らない**（`unwrap` / `expect` 禁止）。invoke の Promise が永久未解決になると
  「インストール中」から戻れなくなり、ユーザーはアプリを強制終了するしかなくなる。

## 完了条件

- ⚠ **読み替え済み（2026-08-02）**: 〜~`tauri dev` で「アップデート」ボタンを押すと **進捗が進み、完了状態になる**~〜
  → **dev で確認するのは「押せる／固まらない／定型エラーになる」と、publish 後の「DL の進捗が進む」ところまで**。
  **install 段は dev で押さない**（`extract_path` が `target/debug` を指すためビルドツリーが消える。
  詳細は progress.md の 055d 節⑥）。実際の置換・再起動・sidecar の生死は [099b](099b-updater-e2e.md) で確定する。
  **OS 分岐と完了表示は `UpdateScreen.test.tsx` が担保**（実機に頼らない）。
- **多重押下・インストール中の画面遷移でアプリが壊れない**。
- 失敗時（ネット遮断・署名不一致）に**定型文言のエラー表示になり、生エラー文字列・URL が出ない**。
- macOS では「再起動」ボタンが出て `restart_app` に配線されている。Windows では案内文言に分岐する。
- **再起動時に sidecar が孤児にならない**（`RunEvent::Exit` が発火するか確認し、しないなら明示的に shutdown する）。
- `capabilities/*.json` に差分が無い。`csp: null` 不変。`tauri-plugin-process` も JS 側 plugin も入っていない。
- security.md の **§5 例外**が追記されている。
- `cargo check` / `cargo test` / `pnpm --filter ./apps/desktop typecheck` / `lint` / `test` が通る。
  [`docs/progress.md`](../progress.md) を更新。
- ⏳ **実機での自己更新確認は [099b](099b-updater-e2e.md) に積み残す**（この時点では「実装済み・実機確認は未実施」）。

## 確認コマンド

```bash
git diff --stat
cd apps/desktop/src-tauri && cargo check && cargo test && cd -
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
pnpm --filter ./apps/desktop test

# ゼロ拡大の担保（差分ゼロが期待）
git status --short -- apps/desktop/src-tauri/capabilities/ apps/comment-sidecar/ .github/ \
  apps/desktop/src-tauri/tauri.conf.json
# 依存が増えていないことの担保（tauri-plugin-process / @tauri-apps/plugin-updater が無いこと）
grep -n "tauri-plugin-process" apps/desktop/src-tauri/Cargo.toml || echo "OK: process plugin 無し"
grep -n "plugin-updater" apps/desktop/package.json || echo "OK: JS 側 updater plugin 無し"

# panic 経路が無いことの担保（app_update 配下に unwrap/expect が無いこと）
grep -rn "unwrap()\|expect(" apps/desktop/src-tauri/src/app_update/ || echo "OK: panic 経路無し"

pnpm --filter ./apps/desktop tauri dev   # ①ボタンを押すと進捗が進む ②多重押下でも壊れない
                                         # ③インストール中に他画面へ行って戻っても壊れない
                                         # ④機内モードで押すと定型エラー（生文字列・URL が出ない）
                                         # ⑤macOS は再起動ボタン / Windows は案内文言に分岐する
                                         # ⑥再起動後にコメビュ窓が開ける（sidecar が孤児になっていない）
```

## 実装後に必要なレビュー

- **security-review 必須**。観点:
  - **`install_app_update` がフロントから URL・パス・バージョンを受け取っていない**こと（引数は `AppHandle` のみ）。
  - **汎用のダウンロード/ファイル書き込みコマンドを新設していない**こと（§3）。
  - **§5 の例外節**が追記され、「書き込み先はアプリ自身のインストール位置のみ・内容は minisign 検証済みのみ・
    フロントから指定不可」の 3 点が書かれていること。
  - **capability の差分がゼロ**であること（`updater:*` / `process:*` を配っていない・`tauri-plugin-process` を入れていない）。
  - **進捗イベント・ログ・画面に URL / ローカルパス / 環境情報が出ていない**こと（§9）。
  - **panic 経路が無い**こと（`unwrap` / `expect` が無い・`Mutex` を `.await` 跨ぎで握っていない）。
  - **再起動時に sidecar が確実に落ちる**こと（孤児プロセスを作らない）。
  - `install_app_update` が**4 窓すべてから呼べる**という限界が security.md に記録されたままであること。
