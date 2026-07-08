import { invoke } from "@tauri-apps/api/core";
import type { AppLogEntry, DiagnosticSummary } from "./types";

/**
 * アプリ内ログ取得（011 Error Handling / Logs）の Tauri command 薄いラッパ。
 * コンポーネントは invoke を直接呼ばず、この API 経由で呼ぶ。
 *
 * frontend からは任意 path / 任意 SQL / 任意検索条件を渡さない。取得できるのは stream-dock の
 * 内部ログのみで、保存先は Rust 側が固定する。件数上限も Rust 側で clamp される（docs/security.md）。
 */

/** 直近のアプリ内ログを返す。limit を渡しても上限は Rust 側で clamp（既定 50・最大 200）。 */
export function listAppLogs(limit?: number): Promise<AppLogEntry[]> {
  return invoke<AppLogEntry[]>("list_app_logs", { limit });
}

/** ユーザーが開発者へ共有しやすい診断サマリーを返す（危険な情報は含まれない）。 */
export function getDiagnosticSummary(): Promise<DiagnosticSummary> {
  return invoke<DiagnosticSummary>("get_diagnostic_summary");
}

/** 記録されたアプリ内ログをすべて削除する（ユーザーテストの履歴リセット用）。 */
export function clearAppLogs(): Promise<void> {
  return invoke<void>("clear_app_logs");
}
