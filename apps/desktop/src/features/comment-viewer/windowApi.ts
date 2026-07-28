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

/**
 * 033f: OBS 用の背景透過オーバーレイ窓（label `comment-overlay`）を開く（ワンクリック）。窓が既に開いていれば
 * Rust 側で再利用する（冪等）。033f 追修正で**最背面・非フォーカス**で開くため、配信者の画面に前面表示されず
 * OBS のウィンドウキャプチャにだけ映る。オーバーレイは**表示専用**で、sidecar の起動/停止には関与しない
 * （no-orphan kill 契機はコメビュ窓に集約のまま）。data 源は既存の loopback WS の読み取り専用接続のみ。
 */
export function openCommentOverlayWindow(): Promise<void> {
  return invoke<void>("open_comment_overlay_window");
}

/**
 * 033f 追修正: OBS 用オーバーレイ窓を閉じる（コメビュ本体の「閉じる」用）。窓が無ければ Rust 側 no-op（冪等）。
 * オーバーレイは最背面・非フォーカスで開き Cmd+W で掴みにくいため、本体から明示的に閉じられるよう用意する。
 * オーバーレイは sidecar を起動していないため、閉じても sidecar は落ちない（no-orphan kill 契機は不変）。
 */
export function closeCommentOverlayWindow(): Promise<void> {
  return invoke<void>("close_comment_overlay_window");
}

/**
 * 034d: OBS オーバーレイ窓（label `comment-overlay`）が開いているかを返す（読み取り専用）。
 * 設定ビューの開閉トグルが、初期同期・外部close後の再同期に使う（開＝ON / 閉＝OFF）。
 * アプリ定義 command のため capability 列挙不要（本ファイル冒頭の注記どおり）。
 */
export function isCommentOverlayOpen(): Promise<boolean> {
  return invoke<boolean>("is_comment_overlay_open");
}

/**
 * 046b: 固定コメント（046a のピン留め）専用の背景透過オーバーレイ窓（label `pinned-overlay`）を開く。
 * 既に開いていれば Rust 側で再利用する（冪等）。既存の `comment-overlay`（コメント一覧用）とは
 * **独立した別窓**で、OBS では別ソースとして取り込む（窓名「StreamDock 固定コメント」）。
 *
 * この窓は**表示専用**で WS へ接続しない（046a が localStorage に書いた固定コメントを読むだけ）。
 * sidecar の起動/停止にも関与しないため、閉じても sidecar は落ちない（no-orphan kill 契機は不変）。
 */
export function openPinnedOverlayWindow(): Promise<void> {
  return invoke<void>("open_pinned_overlay_window");
}

/**
 * 046b: 固定コメント専用オーバーレイ窓を閉じる（設定ビューのトグル OFF 用）。窓が無ければ Rust 側 no-op（冪等）。
 * 最背面・非フォーカスで開くため Cmd+W では掴みにくく、設定から明示的に閉じられるよう用意する。
 */
export function closePinnedOverlayWindow(): Promise<void> {
  return invoke<void>("close_pinned_overlay_window");
}

/**
 * 046b: 固定コメント専用オーバーレイ窓が開いているかを返す（読み取り専用）。
 * 設定トグルが、マウント時に「設定 ON なのに窓が無い」場合だけ開き直すために使う。
 * アプリ定義 command のため capability 列挙不要（本ファイル冒頭の注記どおり）。
 */
export function isPinnedOverlayOpen(): Promise<boolean> {
  return invoke<boolean>("is_pinned_overlay_open");
}
