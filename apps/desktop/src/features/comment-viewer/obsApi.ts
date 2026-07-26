import { invoke } from "@tauri-apps/api/core";
import type { ObsWsConfig } from "./bindings/ObsWsConfig";

/**
 * 044a: OBS 連携（方式A＝ウィンドウキャプチャ自動追加）の Rust command 薄いラッパ。
 *
 * - 連携の ON/OFF（＝ソース自動追加のトリガー）と OBS 状態通知は loopback WS（commentStream の
 *   `enableObs`/`disableObs` と `obs.state`）で行う（非秘密）。
 * - **OBS パスワードだけは WS に載せず**、この Rust command 経由で渡す（Rust が keychain 保存＋sidecar へ
 *   stdin private pipe で私信・非ログ・§9）。localStorage にも保存しない。
 * - WS 有効状態の検出は OBS の config.json を **read-only** で読む Rust command（書き込みしない・§5）。
 *
 * いずれもアプリ定義 command（`generate_handler!` 登録）のため capability 列挙は不要。
 */

export type { ObsWsConfig };

/**
 * OBS の WebSocket サーバー設定を read-only 検出する（有効/ポート/認証要否）。
 * 検出できない（未導入/未設定/読取不可）ときは `null`＝UI は有効化ガイドを出す。**パスワードは読まない**。
 */
export function detectObsWebsocketConfig(): Promise<ObsWsConfig | null> {
  return invoke<ObsWsConfig | null>("detect_obs_websocket_config");
}

/**
 * OBS WebSocket パスワードを設定する（OBS 側で認証が有効なときのみ必要）。
 * Rust が §8 検証→keychain 保存→稼働中 sidecar へ stdin 私信で渡す。frontend は生値をこの経路にのみ渡し、
 * WS/localStorage には保存しない（§9）。
 */
export function setObsWebsocketPassword(password: string): Promise<void> {
  return invoke<void>("set_obs_websocket_password", { password });
}

/** OBS WebSocket パスワードを破棄する（keychain 削除＋sidecar の in-memory 消去）。 */
export function clearObsWebsocketPassword(): Promise<void> {
  return invoke<void>("clear_obs_websocket_password");
}
