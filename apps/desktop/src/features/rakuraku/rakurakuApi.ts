import { invoke } from "@tauri-apps/api/core";
import type { LaunchResult, ScanResult } from "./types";

/**
 * らくらくツール設定（外部アプリ連携・032b）の Tauri command 薄いラッパ。
 *
 * コンポーネントは invoke を直接呼ばず、この API 経由で連携を実行する（既存 `toolApi.ts` に倣う）。
 * frontend からは raw なパス/URL/ポート/コマンドを渡さず、連携 id（＋公式ページは部品名の固定語）
 * だけを渡す。検出・自動起動・公式ページのオープンはすべて Rust 側の限定コマンドで完結する。
 * 実処理は Windows 専用（非 Windows は各コマンドが「未対応」結果を返す）。
 * 032c-a: 方針転換で設定書換（configure）・ループバック疎通（verify）のラッパは撤去した。
 */

/** 検出（読み取り専用）: VOICEVOX/棒読みちゃんの導入・SAPI 登録・VOICEVOX 50021 稼働を確認する。 */
export function scanIntegration(id: string): Promise<ScanResult> {
  return invoke<ScanResult>("rakuraku_scan_integration", { id });
}

/**
 * 既導入・同意済みアプリ（未起動）の自動起動。component は "voicevox" / "bouyomichan" の固定語。
 * 自動DL/インストールはしない（実行ファイル未検出は launched=false で導入を案内する）。
 * パスは Rust 側で検出した候補から解決する（frontend は raw パスを渡さない）。
 */
export function launchComponent(
  id: string,
  component: string,
): Promise<LaunchResult> {
  return invoke<LaunchResult>("rakuraku_launch_component", { id, component });
}

/**
 * 不足部品の公式配布ページを開く（誘導のみ・自動DLしない）。
 * component は "voicevox" / "bouyomichan" 等の固定語。URL は Rust 側の固定定数から解決する
 * （frontend は raw URL を渡さない）。
 */
export function openOfficialPage(id: string, component: string): Promise<void> {
  return invoke<void>("rakuraku_open_official_page", { id, component });
}
