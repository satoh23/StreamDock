//! 032c-b: Twitch コメント取得 Node sidecar（externalBin `comment-sidecar-<triple>`）の
//! ライフサイクル/ポート管理。
//!
//! - sidecar の起動/停止は **Rust から `app.shell().sidecar()` 経由のみ**で行い、frontend に shell 面を
//!   出さない（capability に `shell:*` はゼロ付与）。docs/security.md §4 の例外（Node sidecar 同梱）。
//! - singleton `Mutex<Option<CommentSidecar>>` を app state に持ち、コメントビューア窓を開いたときに
//!   spawn する。多重起動しない（既に起動済みなら何もしない）。
//!   ⚠ **061b: spawn の契機はコメビュ窓のままだが、停止の契機は 2 窓へ広がった**（下の 3 段 kill を参照）。
//! - **Rust に async/WS/HTTP crate は足さない**。plugin が返す stdout ストリームは別スレッドで
//!   `blocking_recv()` して同期的に読む（tokio ランタイムを自前で持ち込まない）。
//! - sidecar は bind した実ポートを `COMMENT_SIDECAR_PORT=<port>` の 1 行で stdout に出す。これを受領して
//!   state に格納し、viewer は読み取り専用コマンド `get_comment_stream_port` で取得してから接続する
//!   （17331 が使用中なら sidecar が空きポートにフォールバックするため、実ポートは動的）。
//! - no-orphan の 3 段 kill の Rust 側 2 段（① **sidecar を使う窓**の Destroyed/CloseRequested、
//!   ② RunEvent::Exit）から `shutdown()` を呼ぶ。3 段目は sidecar 側の ppid 監視 self-exit
//!   （mac に PDEATHSIG が無いため）。
//!   ⚠⚠ **061b で ① の対象が「viewer 窓」から「viewer 窓 or エフェクト窓」へ広がった。**
//!   ①は「**自窓以外に sidecar を使う窓が残っていなければ落とす**」という条件付きになっており、
//!   その判定は `lib.rs` の `SIDECAR_CONSUMER_LABELS` / `is_last_sidecar_consumer` が持つ（実窓を見る）。
//!   ⚠ **② は無条件のまま**。`app.exit(0)` では窓イベントが 1 つも配送されないため、
//!   アプリ終了経路の担保は②だけである（詳細は `lib.rs` の `RunEvent::Exit` の注記）。
//!   ⚠ 「Rust 側 2 段」は**no-orphan の担保として数えている経路**の話で、`shutdown()` の呼び出し箇所の
//!   総数ではない。実際にはもう 1 箇所、`app_update/commands.rs` の**アップデート適用前の再起動**からも
//!   呼ぶ（あちらは `RunEvent::Exit` を通らない経路なので明示的に落としている）。061b レビュー Q-6。
//! - ⚠⚠ **061b: 「取得（外部通信）が止まる条件」も①に連動して変わった**（docs/security.md §1 の「取得の停止条件」）。
//!   取得セッション（sidecar 内の `sessionAborts`）は **`stop-session` フレームかプロセス終了でしか止まらない**
//!   ——WS クライアントが 0 になっても止まらない。＝**コメビュ窓を閉じてもエフェクト窓が生きていれば
//!   Twitch/YouTube への通信は続く**。061b 以前は「コメビュ窓を閉じる＝必ず kill」だったので同値だったが、
//!   いまは同値ではない。ユーザー向けの明示は `ObsEffectsScreen` の前提案内が担っている。
//! - 032c-b/032c-d′(ログイン永続化): Twitch/YouTube の OAuth トークンは Rust 側で OS キーチェーンに保存する
//!   （[token_vault]・provider 別 account）。起動時に `load()` して sidecar の **stdin** へ復元行
//!   （`COMMENT_SIDECAR_RESTORE=<provider> <json>`）を書き、sidecar が login/refresh で更新すると **stdout** の
//!   専用行（`COMMENT_SIDECAR_TOKEN=<provider> <json>` / `..._TOKEN_CLEAR=<provider>`）で受けて keychain を更新する。
//!   token は親子プロセス間の private pipe のみを通り、**ログ/DB/端末外に出さない**（§9）。

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

use crate::error::{AppError, AppResult};

mod token_vault;

/// externalBin のベース名（Tauri が `-<target-triple>` を付けて解決する）。
const SIDECAR_NAME: &str = "comment-sidecar";
/// sidecar が実ポートを報告する stdout 行の prefix。
const PORT_PREFIX: &str = "COMMENT_SIDECAR_PORT=";
/// sidecar が login/refresh 後にトークンを報告する stdout 行の prefix（親子 private pipe）。
/// 032c-d′: 内容は `<provider> <json>`。受けたら provider 別 keychain へ保存する。**token はログに出さない**。
const TOKEN_PREFIX: &str = "COMMENT_SIDECAR_TOKEN=";
/// sidecar が logout/認可失効でトークン破棄を要求する stdout 行の prefix。032c-d′: 内容は `<provider>`。
const TOKEN_CLEAR_PREFIX: &str = "COMMENT_SIDECAR_TOKEN_CLEAR=";
/// 起動時に Rust→sidecar の **stdin** へ復元トークンを渡す行の prefix。032c-d′: 内容は `<provider> <json>`。
const RESTORE_PREFIX: &str = "COMMENT_SIDECAR_RESTORE=";
/// 032c-d: sidecar が YouTube 同意画面の認可 URL を渡す stdout 行の prefix。
/// Rust が `host=accounts.google.com`（https）に限定して既定ブラウザで開く（fail-closed）。
/// **この行の URL 全体はログに出さない**（載るのは code_challenge・非機密で code_verifier は載らない）。
const OPEN_URL_PREFIX: &str = "COMMENT_SIDECAR_OPEN_URL=";
/// 032c-d: 同意画面として開いてよい唯一のホスト（Google OAuth 認可エンドポイント）。
const CONSENT_ALLOWED_HOST: &str = "accounts.google.com";
/// 044a: OBS WebSocket パスワードを Rust→sidecar の **stdin** へ渡す行の prefix（親子 private pipe）。
/// keychain に保存し、起動時復元と設定コマンドの双方でこの行を書く。**内容はログに出さない**（§9）。
const OBS_PW_PREFIX: &str = "COMMENT_SIDECAR_OBS_PW=";
/// 044a: OBS パスワード破棄を sidecar に伝える stdin 行の prefix（in-memory を消す）。
const OBS_PW_CLEAR_PREFIX: &str = "COMMENT_SIDECAR_OBS_PW_CLEAR=";
/// 060c: **テーマ取り込みチケット**を Rust→sidecar の **stdin** へ渡す行の prefix（親子 private pipe）。
///
/// ⚠⚠ **なぜチケットが要るのか（060c で脅威モデルが変わった）**: sidecar の loopback WS は**未認証**で、
/// `127.0.0.1` に到達できる同一 PC の任意プロセス（およびユーザーがブラウザで開いた悪意あるページ）が
/// 制御フレームを送れる（`vendor/gateway/.../websocket-comment.output-port.ts` の注記が明示）。
/// それが受容されてきた根拠は「**秘密が流れない・egress を起こせない**」——`obs-*` は loopback 限定だった。
/// 060c の `theme-import.fetch` は**インターネットへの GET を起こす初めての制御フレーム**なので、
/// この根拠が及ばない。チケット無しだと、悪意あるページが `ws://127.0.0.1:<port>` へ繋いで
/// **同意ダイアログを一切経ずに** `https://tracker.example/<id>.css` を叩かせられる（ビーコン・IP 露出）。
///
/// チケットは **StreamDock の窓だけが取れる**（`get_theme_import_ticket` は Tauri コマンドなので、
/// webview の外からは呼べない）。sidecar は一致しないフレームを**黙って捨てる**（返信もしない）。
/// ⚠ 値はプロセス起動ごとの使い捨てで、**keychain にも DB にも残さず・ログにも出さない**（§9）。
/// ⚠ 同一 PC の任意プロセスがアプリのメモリを読める前提なら破れるが、その前提では既に何でもできる。
const THEME_TICKET_PREFIX: &str = "COMMENT_SIDECAR_THEME_TICKET=";

/// 066: sidecar へ渡す **チャット送信チケット**（stdin private pipe）。
///
/// ⚠⚠⚠ **根拠は [`THEME_TICKET_PREFIX`] とまったく同じで、危険度はこちらが高い。**
/// 060c の `theme-import.fetch` は「**インターネットへの GET を起こす初めての制御フレーム**」だったが、
/// 066 の `chat-send` は「**配信のチャットへ書き込む初めての制御フレーム**」である。
/// チケット無しだと、悪意あるページが `ws://127.0.0.1:<port>` へ繋いで
/// **同意を一切経ずにユーザーの名前でチャットへ投稿できる**（しかも視聴者に見えて消せない）。
///
/// ⚠⚠ **テーマ取り込みのチケットと別に採番する。** 使い回すと「読む能力の秘密が漏れたら
/// 書く能力も奪われる」形になり、被害範囲が繋がってしまう。
/// ⚠ 値はプロセス起動ごとの使い捨てで、**keychain にも DB にも残さず・ログにも出さない**（§9）。
const CHAT_TICKET_PREFIX: &str = "COMMENT_SIDECAR_CHAT_TICKET=";

/// sidecar 起動インスタンスごとに払い出す世代 ID のカウンタ。
/// 旧 sidecar の stdout 読取スレッドが遅れて `Terminated` を受けても、既に差し替わった
/// 新 sidecar の state を消さない（世代不一致なら触らない）ための識別子に使う。
static SIDECAR_GENERATION: AtomicU64 = AtomicU64::new(0);

/// 起動中の sidecar 子プロセスと、報告された実ポート。
pub struct CommentSidecar {
    child: CommandChild,
    port: Option<u16>,
    /// この起動インスタンスの世代 ID（stale な `Terminated`/ポート書込を弾く識別子）。
    generation: u64,
    /// 060c: この起動インスタンスのテーマ取り込みチケット（[`THEME_TICKET_PREFIX`] の注記が正）。
    ///
    /// ⚠ **ポートと違って sidecar から受け取るのではなく Rust が生成して渡す**（sidecar 側が生成して
    /// stdout で返す形にすると、stdout を読める者＝実質誰でも手に入ってしまう）。
    theme_import_ticket: String,
    /// 066: この起動インスタンスのチャット送信チケット（[`CHAT_TICKET_PREFIX`] の注記が正）。
    ///
    /// ⚠⚠ **`theme_import_ticket` と別の値であること**が、能力ごとに被害範囲を分けることの実体である。
    chat_send_ticket: String,
}

/// app state（singleton）。`None` = 未起動。
pub type CommentSidecarState = Mutex<Option<CommentSidecar>>;

/// sidecar を起動する（既に起動済みなら何もしない）。コメントビューア窓を開いたときに呼ぶ。
pub fn ensure_started(app: &AppHandle) -> AppResult<()> {
    let state = app.state::<CommentSidecarState>();
    // check→spawn→格納を 1 つのロック区間で原子化し、多重 spawn（TOCTOU）を防ぐ。
    // 以前は「is_some チェック」と「格納」でロックを分けていたため、`open_comment_viewer_window`
    // の連続呼び出しで 2 プロセス spawn し得た（後者が前者のハンドルを上書き→前者が孤児化）。
    // spawn は fork/exec の短時間ブロッキングだが hot path ではないためロック保持で問題ない。
    let mut guard = state.lock().expect("comment sidecar mutex poisoned");
    if guard.is_some() {
        return Ok(());
    }

    let (mut rx, mut child) = app
        .shell()
        .sidecar(SIDECAR_NAME)
        .map_err(|_| AppError::launch_failed("コメント取得プロセスを起動できませんでした"))?
        .spawn()
        .map_err(|_| AppError::launch_failed("コメント取得プロセスを起動できませんでした"))?;

    // 032c-b/032c-d′: 保存済みトークンがあれば sidecar の stdin へ復元行を **provider 別**に書き、ログイン状態を
    // 復元する（keychain→メモリの移動のみ。ネットワークは張らず、§1 の明示接続は取得開始ボタンで別途行う）。
    // best-effort（書込失敗は未ログイン扱い）。**token 内容はログに出さない**。
    for provider in ["twitch", "youtube"] {
        if let Some(token_json) = token_vault::load(provider) {
            let line = format!("{RESTORE_PREFIX}{provider} {token_json}\n");
            let _ = child.write(line.as_bytes());
        }
    }
    // 044a: OBS WebSocket パスワードが保存済みなら stdin へ復元行を書く（認証有効な OBS 用）。
    // loopback WS には載せず親子 private pipe のみを通る。**内容はログに出さない**（§9）。
    if let Some(obs_password) = token_vault::load("obs") {
        let line = format!("{OBS_PW_PREFIX}{obs_password}\n");
        let _ = child.write(line.as_bytes());
    }

    // 060c: テーマ取り込みチケットを **Rust 側で採番**し、stdin private pipe で sidecar へ渡す。
    // uuid v4 は 122bit の乱数（`overlay_theme` のファイル名採番と同じ crate・新規依存ゼロ）。
    // ⚠ **ハイフン無しの hex 文字列**にしておく（sidecar 側は生の文字列比較なので形は問わないが、
    // stdin の行に空白が入らない形に揃える）。**ログにも keychain にも出さない**（§9）。
    let theme_import_ticket = uuid::Uuid::new_v4().simple().to_string();
    let _ = child.write(format!("{THEME_TICKET_PREFIX}{theme_import_ticket}\n").as_bytes());

    // 066: チャット送信チケット。⚠⚠ **テーマ取り込みとは別に採番する**（同じ値を使い回さない）。
    // 採番も受け渡しも上とまったく同じ作法（uuid v4・stdin private pipe・非ログ・§9）。
    let chat_send_ticket = uuid::Uuid::new_v4().simple().to_string();
    let _ = child.write(format!("{CHAT_TICKET_PREFIX}{chat_send_ticket}\n").as_bytes());

    let generation = SIDECAR_GENERATION.fetch_add(1, Ordering::Relaxed);
    *guard = Some(CommentSidecar {
        child,
        port: None,
        generation,
        theme_import_ticket,
        chat_send_ticket,
    });
    // reader スレッド起動前にロックを解放する（スレッド側は独立にロックを取り直す）。
    drop(guard);

    // stdout を別スレッドで読み、実ポート行を受領して state に格納する。
    // 取得コメント本文やトークンは stdout に載らない（sidecar は診断ログを stderr に出す）。
    let app_handle = app.clone();
    std::thread::spawn(move || {
        let mut buf = String::new();
        while let Some(event) = rx.blocking_recv() {
            match event {
                CommandEvent::Stdout(bytes) => {
                    buf.push_str(&String::from_utf8_lossy(&bytes));
                    while let Some(nl) = buf.find('\n') {
                        let line: String = buf.drain(..=nl).collect();
                        let trimmed = line.trim();
                        if let Some(rest) = trimmed.strip_prefix(PORT_PREFIX) {
                            if let Ok(port) = rest.trim().parse::<u16>() {
                                let state = app_handle.state::<CommentSidecarState>();
                                let mut guard =
                                    state.lock().expect("comment sidecar mutex poisoned");
                                // 自分の世代の sidecar が現役のときだけポートを書き込む
                                // （差し替え後の新 sidecar に旧ポートを混ぜない）。
                                if let Some(sidecar) = guard.as_mut() {
                                    if sidecar.generation == generation {
                                        sidecar.port = Some(port);
                                    }
                                }
                            }
                        } else if let Some(rest) = trimmed.strip_prefix(TOKEN_PREFIX) {
                            // 032c-b/032c-d′: login/refresh で更新されたトークンを provider 別 keychain へ保存する。
                            // 行は `<provider> <json>`。**token 文字列はログに出さない**（token_vault も露出しない）。
                            if let Some((provider, token_json)) = rest.split_once(' ') {
                                token_vault::save(provider, token_json);
                            }
                        } else if let Some(provider) = trimmed.strip_prefix(TOKEN_CLEAR_PREFIX) {
                            // logout / 認可失効: 該当 provider の保存済みトークンを削除する。
                            token_vault::clear(provider);
                        } else if let Some(url) = trimmed.strip_prefix(OPEN_URL_PREFIX) {
                            // 032c-d: YouTube 同意画面 URL。host=accounts.google.com を検証してから
                            // 既定ブラウザで開く（fail-closed）。**URL 全体はログに出さない**。
                            open_consent_url(&app_handle, url);
                        }
                    }
                }
                CommandEvent::Terminated(_) => {
                    // sidecar が終了したら state をクリアし、次回 open で再 spawn できるようにする。
                    // ただし自分の世代がまだ現役のときだけクリアする。既に新しい sidecar へ
                    // 差し替わっている場合（stale Terminated）は触らず、新 sidecar の state を守る。
                    let state = app_handle.state::<CommentSidecarState>();
                    let mut guard = state.lock().expect("comment sidecar mutex poisoned");
                    if guard.as_ref().map(|s| s.generation) == Some(generation) {
                        *guard = None;
                    }
                    break;
                }
                CommandEvent::Stderr(bytes) => {
                    // 032c-d′: sidecar の診断 stderr を Rust の stderr へ透過する（`pnpm tauri dev` の端末で見える）。
                    // 従来は握りつぶしており、取得失敗（例: YouTube 配信検出・gRPC エラー）の原因が全く見えなかった。
                    // token/secret は §9 で stderr に載せない設計のため露出しない。外部送信・DB 保存はせず端末出力のみ。
                    eprint!("{}", String::from_utf8_lossy(&bytes));
                }
                _ => {}
            }
        }
    });

    Ok(())
}

/// 受領済みの実ポートを返す（未確定なら `None`）。viewer は `Some` になるまでポーリングして接続する。
pub fn port(app: &AppHandle) -> Option<u16> {
    let state = app.state::<CommentSidecarState>();
    let guard = state.lock().expect("comment sidecar mutex poisoned");
    guard.as_ref().and_then(|s| s.port)
}

/// 060c: 稼働中 sidecar のテーマ取り込みチケットを返す（未起動なら `None`）。
///
/// viewer はこれを `theme-import.fetch` フレームに載せる。⚠ **返すのは「いま動いている sidecar のもの」**
/// なので、sidecar が再 spawn されると値が変わる——viewer は取得のたびに取り直すこと
/// （握ったまま使い回すと再起動後に黙って無視される）。**ログにも画面にも出さない**（§9）。
pub fn theme_import_ticket(app: &AppHandle) -> Option<String> {
    let state = app.state::<CommentSidecarState>();
    let guard = state.lock().expect("comment sidecar mutex poisoned");
    guard.as_ref().map(|s| s.theme_import_ticket.clone())
}

/// 066: 稼働中 sidecar の**チャット送信チケット**を返す（未起動なら `None`）。
///
/// viewer はこれを `chat-send` フレームに載せる。⚠ [`theme_import_ticket`] と同じく
/// **sidecar が再 spawn されると値が変わる**ので、**送信のたびに取り直すこと**。
/// ⚠⚠ **ログにも画面にも出さない**（§9）。⚠ **テーマ取り込みのチケットと取り違えないこと**
/// （取り違えるとどちらの能力も動かなくなる＝ fail-closed 側なので安全側ではあるが、原因が読めない）。
pub fn chat_send_ticket(app: &AppHandle) -> Option<String> {
    let state = app.state::<CommentSidecarState>();
    let guard = state.lock().expect("comment sidecar mutex poisoned");
    guard.as_ref().map(|s| s.chat_send_ticket.clone())
}

/// sidecar を停止する（idempotent）。窓クローズ・アプリ終了フックから呼ぶ。
///
/// ⚠ **061b: 窓クローズ側の呼び出しは無条件ではない。** `lib.rs` の `shutdown_sidecar_if_last_consumer`
/// を通り、「**sidecar を使う窓が自窓のほかに 1 つも残っていないとき**」だけここへ来る
/// （＝コメビュ窓を閉じてもエフェクト窓が生きていれば落ちない）。アプリ終了（`RunEvent::Exit`）からは
/// 従来どおり**無条件**で呼ばれる。
/// ⚠ 同じ窓から `CloseRequested` と `Destroyed` の両方で呼ばれうるが、`guard.take()` により冪等
/// （2 度目は `None` で no-op）。
pub fn shutdown(app: &AppHandle) {
    let state = app.state::<CommentSidecarState>();
    let taken = {
        let mut guard = state.lock().expect("comment sidecar mutex poisoned");
        guard.take()
    };
    if let Some(sidecar) = taken {
        // CommandChild::kill は子プロセスに SIGKILL を送る。sidecar 側 ppid 監視と併せ孤児を残さない。
        let _ = sidecar.child.kill();
    }
}

/// 044a: OBS WebSocket パスワードを OS キーチェーンへ保存し、**稼働中 sidecar があれば** stdin private pipe で
/// 渡す（loopback WS には載せない）。未起動時は keychain 保存のみで、次回 spawn 時に `ensure_started` が復元する。
/// **パスワード内容はログに出さない**（§9・token_vault も露出しない）。
pub fn set_obs_password(app: &AppHandle, password: &str) {
    token_vault::save("obs", password);
    write_line_to_sidecar(app, &format!("{OBS_PW_PREFIX}{password}\n"));
}

/// 044a: OBS WebSocket パスワードを破棄する（keychain 削除＋稼働中 sidecar の in-memory も消す）。idempotent。
pub fn clear_obs_password(app: &AppHandle) {
    token_vault::clear("obs");
    write_line_to_sidecar(app, &format!("{OBS_PW_CLEAR_PREFIX}\n"));
}

/// 稼働中 sidecar の stdin へ 1 行書く（未起動なら no-op）。**内容はログに出さない**（パスワードを含み得る）。
fn write_line_to_sidecar(app: &AppHandle, line: &str) {
    let state = app.state::<CommentSidecarState>();
    let mut guard = state.lock().expect("comment sidecar mutex poisoned");
    if let Some(sidecar) = guard.as_mut() {
        let _ = sidecar.child.write(line.as_bytes());
    }
}

/// 032c-d: sidecar が stdout の `COMMENT_SIDECAR_OPEN_URL=` 行で渡す YouTube 同意画面 URL を、
/// **`https://accounts.google.com` に限定して**既定ブラウザで開く（fail-closed）。
///
/// - `validate_http_url` で http/https スキーム・制御文字を検証（多層防御）。
/// - [`is_google_consent_url`] で host を `accounts.google.com`（https・port/userinfo/サブドメイン偽装なし）に限定。
/// - opener の Rust API（`OpenerExt`）は **IPC 非経由**で capabilities の許可を必要としない（§4・opener 方針）。
/// - 失敗しても **URL/OS エラーは露出させない**（best-effort・**URL 全体はログに出さない**）。
fn open_consent_url(app: &AppHandle, raw: &str) {
    let Ok(url) = crate::util::validate_http_url(raw) else {
        return;
    };
    if !is_google_consent_url(&url) {
        // sidecar 側は pinned config で accounts.google.com 固定だが、Rust 側でも fail-closed に再検証する。
        return;
    }
    let _ = app.opener().open_url(url, None::<&str>);
}

/// `https://accounts.google.com`（host 完全一致）のみ true。
/// port（`:443`）/ userinfo（`user@`）/ サブドメイン偽装（`accounts.google.com.evil.com`）は
/// authority がホスト名と完全一致しないため false になる（fail-closed）。
fn is_google_consent_url(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    let Some(rest) = lower.strip_prefix("https://") else {
        return false;
    };
    // authority = scheme 直後から最初の '/', '?', '#' まで（= `[userinfo@]host[:port]`）。
    let authority = rest.split(&['/', '?', '#'][..]).next().unwrap_or("");
    authority == CONSENT_ALLOWED_HOST
}

#[cfg(test)]
mod tests {
    use super::is_google_consent_url;

    #[test]
    fn accepts_google_consent_url() {
        assert!(is_google_consent_url(
            "https://accounts.google.com/o/oauth2/v2/auth?client_id=x&scope=y"
        ));
        // host のみで path/query が無い場合も許可（authority が完全一致）。
        assert!(is_google_consent_url("https://accounts.google.com"));
        // scheme の大小は無視する。
        assert!(is_google_consent_url("HTTPS://ACCOUNTS.GOOGLE.COM/o/oauth2"));
    }

    #[test]
    fn rejects_spoofed_and_non_https() {
        // http（非 https）は拒否。
        assert!(!is_google_consent_url("http://accounts.google.com/o/oauth2"));
        // サブドメイン偽装。
        assert!(!is_google_consent_url(
            "https://accounts.google.com.evil.com/o/oauth2"
        ));
        // 前方偽装。
        assert!(!is_google_consent_url("https://evil-accounts.google.com/"));
        // userinfo による偽装（実 host は evil.com）。
        assert!(!is_google_consent_url(
            "https://accounts.google.com@evil.com/"
        ));
        // 明示 port は拒否（正規 URL は port を持たない）。
        assert!(!is_google_consent_url("https://accounts.google.com:8443/"));
        // path に埋め込んだだけの別 host。
        assert!(!is_google_consent_url("https://evil.com/accounts.google.com"));
        // 別 Google ホスト（token/Data API はブラウザで開かない）。
        assert!(!is_google_consent_url("https://oauth2.googleapis.com/token"));
    }
}
