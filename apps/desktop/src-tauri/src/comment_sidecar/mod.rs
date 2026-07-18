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
//! - 032c-b(ログイン永続化): Twitch OAuth トークンは Rust 側で OS キーチェーンに保存する（[token_vault]）。
//!   起動時に `load()` して sidecar の **stdin** へ復元行（`COMMENT_SIDECAR_RESTORE=`）を書き、sidecar が
//!   login/refresh で更新すると **stdout** の専用行（`COMMENT_SIDECAR_TOKEN=` / `..._TOKEN_CLEAR`）で受けて
//!   keychain を更新する。token は親子プロセス間の private pipe のみを通り、**ログ/DB/端末外に出さない**（§9）。

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use tauri::{AppHandle, Manager};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

use crate::error::{AppError, AppResult};

mod token_vault;

/// externalBin のベース名（Tauri が `-<target-triple>` を付けて解決する）。
const SIDECAR_NAME: &str = "comment-sidecar";
/// sidecar が実ポートを報告する stdout 行の prefix。
const PORT_PREFIX: &str = "COMMENT_SIDECAR_PORT=";
/// sidecar が login/refresh 後にトークン(JSON)を報告する stdout 行の prefix（親子 private pipe）。
/// 受けたら keychain へ保存する。**この行の内容（token）はログに出さない**。
const TOKEN_PREFIX: &str = "COMMENT_SIDECAR_TOKEN=";
/// sidecar が logout/認可失効でトークン破棄を要求する stdout 行（内容なし）。
const TOKEN_CLEAR_LINE: &str = "COMMENT_SIDECAR_TOKEN_CLEAR";
/// 起動時に Rust→sidecar の **stdin** へ復元トークン(JSON)を渡す行の prefix。
const RESTORE_PREFIX: &str = "COMMENT_SIDECAR_RESTORE=";

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

    // 032c-b: 保存済みトークンがあれば sidecar の stdin へ復元行を書き、ログイン状態を復元する
    // （keychain→メモリの移動のみ。ネットワークは張らず、§1 の明示接続は取得開始ボタンで別途行う）。
    // best-effort（書込失敗は未ログイン扱い）。**token 内容はログに出さない**。
    if let Some(token_json) = token_vault::load() {
        let line = format!("{RESTORE_PREFIX}{token_json}\n");
        let _ = child.write(line.as_bytes());
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
                        } else if let Some(token_json) = trimmed.strip_prefix(TOKEN_PREFIX) {
                            // 032c-b: login/refresh で更新されたトークン(JSON)を keychain へ保存する。
                            // **token 文字列はログに出さない**（token_vault も内容を露出しない）。
                            token_vault::save(token_json);
                        } else if trimmed == TOKEN_CLEAR_LINE {
                            // logout / 認可失効: 保存済みトークンを削除する。
                            token_vault::clear();
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
