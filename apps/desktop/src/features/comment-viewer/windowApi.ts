import { invoke } from "@tauri-apps/api/core";

/**
 * 033e: 内蔵コメントビューア窓（label `comment-viewer`）の停止/開閉状態を扱う薄い Rust command ラッパ。
 *
 * ツール管理（`MainScreen`）でコメビュを他ツールと同じ再生/停止・起動済み表示にするために使う。
 * コメビュは PID プロセスではなく Tauri ウィンドウのため、PID registry には載せず窓の開閉から状態を導出する。
 * 起動（開く）は既存の `launchTool`（Rust が `open_comment_viewer_window` を呼ぶ）を再利用するため、
 * ここには含めない（このファイルは停止＝窓 close と、状態取得＝窓存在確認のみ）。
 *
 * どちらもアプリ定義 command（`generate_handler!` 登録）で、Tauri v2 の ACL（capability の `permissions`）は
 * plugin/core command のみを対象とするため列挙不要（main は `core:default` で既に多数のアプリ command を invoke 済み）。
 */

/**
 * 内蔵コメントビューア窓を閉じる（ツール管理の「停止」用）。窓が無ければ Rust 側 no-op（冪等）。
 * `.close()` は既存の窓イベント経由で Twitch/YouTube コメント取得 sidecar の停止も連動する（032c-b）。
 * PID kill は行わず、自アプリのウィンドウを閉じるのみ（docs/security.md §6）。
 */
export function closeCommentViewerWindow(): Promise<void> {
  return invoke<void>("close_comment_viewer_window");
}

/**
 * 内蔵コメントビューア窓が開いているかを返す（読み取り専用）。
 * reconcile が窓の開閉から internal 行の起動状態を導出するために使う（開＝起動済み / 閉＝停止済み）。
 */
export function isCommentViewerOpen(): Promise<boolean> {
  return invoke<boolean>("is_comment_viewer_open");
}
