//! 032c-b: Twitch OAuth トークンの OS キーチェーン保存（ログイン永続化）。
//! 032c-d′: YouTube も同じ仕組みで永続化する（provider 別 account）。使い心地を Twitch と統一する。
//!
//! sidecar（pure-JS・単一ファイル SEA）は native keyring addon を持ち込めないため、キーチェーン所有は
//! Rust 側に置く。sidecar が login/refresh でトークンを更新すると、その `TokenSetPlain`(JSON) を
//! 親子プロセス間の **private pipe（stdout の専用プレフィックス行）** で受け取り、ここで keychain に保存する。
//! 起動時は `load()` で読み出し、stdin 経由で sidecar のメモリ内ストアへ復元注入する（[mod.rs]）。
//!
//! §9 の要点: **トークンをログ/DB/stdout(=Rust の標準出力)・端末外へ一切出さない**。keychain とメモリ間の
//! 移動のみで、この関数群も token 文字列をログに出さない（`let _ =` でエラーも握りつぶし、内容を露出しない）。
//! 保存されるのは access/refresh token を含む JSON で、**provider ごとに 1 エントリ**
//! （`service` × provider 別 `account`＝twitch/youtube で各 1 件）。

use keyring::Entry;

/// キーチェーンのサービス名（アプリ単位）。
const SERVICE: &str = "stream-dock";

/// provider（連携先）ごとの keychain アカウント名。**未知の provider は `None`**（＝保存/読取しない・fail-closed）。
/// 032c-d′: twitch/youtube を同じ仕組みで別 account に永続化する（使い心地を統一）。将来別サービスを足すなら
/// ここに account を追加する。
fn account_for(provider: &str) -> Option<&'static str> {
    match provider {
        "twitch" => Some("twitch-comment-viewer"),
        "youtube" => Some("youtube-comment-viewer"),
        // 044a: OBS WebSocket パスワードも同じ仕組み（SERVICE × 別 account）で永続化する。
        // 保存されるのは OAuth トークンではなく OBS のパスワード文字列だが、非ログ・非外部送信・
        // 親子 private pipe のみを通る扱いは同一（§9）。
        "obs" => Some("obs-websocket"),
        _ => None,
    }
}

/// キーチェーンエントリのハンドルを得る（未知 provider / 生成失敗時は `None`＝永続化しない）。
fn entry(provider: &str) -> Option<Entry> {
    Entry::new(SERVICE, account_for(provider)?).ok()
}

/// 保存済みトークン（`TokenSetPlain` の JSON 文字列）を provider 別に読み出す。未保存・失敗時は `None`。
/// 返り値はそのまま sidecar の stdin へ復元注入する（Rust では内容をログに出さない）。
pub fn load(provider: &str) -> Option<String> {
    let entry = entry(provider)?;
    // NoEntry（未保存）やアクセス不可はすべて None 扱い＝ログイン無しとしてフォールバックする。
    entry.get_password().ok()
}

/// トークン JSON を provider 別にキーチェーンへ保存する（best-effort）。**内容はログに出さない**。
pub fn save(provider: &str, token_json: &str) {
    if let Some(entry) = entry(provider) {
        // 失敗（キーチェーンロック中など）は握りつぶす。token を含むため詳細もログに出さない。
        let _ = entry.set_password(token_json);
    }
}

/// 保存済みトークンを provider 別に削除する（logout / 認可失効時）。存在しなくてもエラーにしない（idempotent）。
pub fn clear(provider: &str) {
    if let Some(entry) = entry(provider) {
        let _ = entry.delete_credential();
    }
}
