//! 032c-b: Twitch OAuth トークンの OS キーチェーン保存（ログイン永続化）。
//!
//! sidecar（pure-JS・単一ファイル SEA）は native keyring addon を持ち込めないため、キーチェーン所有は
//! Rust 側に置く。sidecar が login/refresh でトークンを更新すると、その `TokenSetPlain`(JSON) を
//! 親子プロセス間の **private pipe（stdout の専用プレフィックス行）** で受け取り、ここで keychain に保存する。
//! 起動時は `load()` で読み出し、stdin 経由で sidecar のメモリ内ストアへ復元注入する（[mod.rs]）。
//!
//! §9 の要点: **トークンをログ/DB/stdout(=Rust の標準出力)・端末外へ一切出さない**。keychain とメモリ間の
//! 移動のみで、この関数群も token 文字列をログに出さない（`let _ =` でエラーも握りつぶし、内容を露出しない）。
//! 保存されるのは access/refresh token を含む JSON 1 件（`service`×`account` で 1 エントリ）。

use keyring::Entry;

/// キーチェーンのサービス名（アプリ単位）。
const SERVICE: &str = "stream-dock";
/// エントリのアカウント名（連携先単位）。将来 YouTube 等を足すなら別 account にする。
const ACCOUNT: &str = "twitch-comment-viewer";

/// キーチェーンエントリのハンドルを得る（生成失敗時は `None`＝この環境では永続化しない）。
fn entry() -> Option<Entry> {
    Entry::new(SERVICE, ACCOUNT).ok()
}

/// 保存済みトークン（`TokenSetPlain` の JSON 文字列）を読み出す。未保存・失敗時は `None`。
/// 返り値はそのまま sidecar の stdin へ復元注入する（Rust では内容をログに出さない）。
pub fn load() -> Option<String> {
    let entry = entry()?;
    // NoEntry（未保存）やアクセス不可はすべて None 扱い＝ログイン無しとしてフォールバックする。
    entry.get_password().ok()
}

/// トークン JSON をキーチェーンへ保存する（best-effort）。**内容はログに出さない**。
pub fn save(token_json: &str) {
    if let Some(entry) = entry() {
        // 失敗（キーチェーンロック中など）は握りつぶす。token を含むため詳細もログに出さない。
        let _ = entry.set_password(token_json);
    }
}

/// 保存済みトークンを削除する（logout / 認可失効時）。存在しなくてもエラーにしない（idempotent）。
pub fn clear() {
    if let Some(entry) = entry() {
        let _ = entry.delete_credential();
    }
}
