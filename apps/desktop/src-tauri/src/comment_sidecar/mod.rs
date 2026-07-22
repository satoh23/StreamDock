//! 032c-b: Twitch コメント取得 Node sidecar（externalBin `comment-sidecar-<triple>`）の
//! ライフサイクル/ポート管理。
//!
//! - sidecar の起動/停止は **Rust から `app.shell().sidecar()` 経由のみ**で行い、frontend に shell 面を
//!   出さない（capability に `shell:*` はゼロ付与）。docs/security.md §4 の例外（Node sidecar 同梱）。
//! - singleton `Mutex<Option<CommentSidecar>>` を app state に持ち、コメントビューア窓を開いたときに
//!   spawn する。多重起動しない（既に起動済みなら何もしない）。
//! - **Rust に async/WS/HTTP crate は足さない**。plugin が返す stdout ストリームは別スレッドで
//!   `blocking_recv()` して同期的に読む（tokio ランタイムを自前で持ち込まない）。
//! - sidecar は bind した実ポートを `COMMENT_SIDECAR_PORT=<port>` の 1 行で stdout に出す。これを受領して
//!   state に格納し、viewer は読み取り専用コマンド `get_comment_stream_port` で取得してから接続する
//!   （17331 が使用中なら sidecar が空きポートにフォールバックするため、実ポートは動的）。
//! - no-orphan の 3 段 kill の Rust 側 2 段（① viewer 窓の Destroyed/CloseRequested、② RunEvent::Exit）から
//!   `shutdown()` を呼ぶ。3 段目は sidecar 側の ppid 監視 self-exit（mac に PDEATHSIG が無いため）。
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

    let generation = SIDECAR_GENERATION.fetch_add(1, Ordering::Relaxed);
    *guard = Some(CommentSidecar {
        child,
        port: None,
        generation,
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
                            match rest.trim().parse::<u16>() {
                                Ok(port) => {
                                    // [一時ログ 099a診断] Rust がポート行を受領できたことを可視化（ポート番号は非機密）。
                                    // これが出ない=stdout のポート行が届いていない/形式不一致、出る=Rust 側はOK。
                                    eprintln!(
                                        "[rust][comment-sidecar] port received: {port} (gen {generation})"
                                    );
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
                                Err(e) => {
                                    // [一時ログ 099a診断] PORT 行は来たがパース失敗（例: Windows で CRLF 混入等）。
                                    eprintln!(
                                        "[rust][comment-sidecar] failed to parse port from {:?}: {e}",
                                        rest.trim()
                                    );
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

/// sidecar を停止する（idempotent）。窓クローズ・アプリ終了フックから呼ぶ。
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
