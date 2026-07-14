import { invoke } from "@tauri-apps/api/core";
import type { ConfigureResult, ScanResult, VerifyResult } from "./types";

/**
 * らくらくツール設定（外部アプリ連携・032b）の Tauri command 薄いラッパ。
 *
 * コンポーネントは invoke を直接呼ばず、この API 経由で連携を実行する（既存 `toolApi.ts` に倣う）。
 * frontend からは raw なパス/URL/ポート/コマンドを渡さず、連携 id（＋公式ページは部品名の固定語）
 * だけを渡す。検出・書換・疎通・公式ページのオープンはすべて Rust 側の限定コマンドで完結する。
 * 実処理は Windows 専用（非 Windows は各コマンドが「未対応」結果を返す）。
 */

/** 検出（読み取り専用）: VOICEVOX/棒読みちゃんの導入・SAPI 登録・VOICEVOX 50021 稼働を確認する。 */
export function scanIntegration(id: string): Promise<ScanResult> {
  return invoke<ScanResult>("rakuraku_scan_integration", { id });
}

/** 設定書換: 棒読みちゃん設定のみをバックアップ先取りしてから書き換える（可逆）。 */
export function configureIntegration(id: string): Promise<ConfigureResult> {
  return invoke<ConfigureResult>("rakuraku_configure_integration", { id });
}

/** 検証: VOICEVOX 50021 ヘルスチェック＋棒読みちゃん 50001 テスト送信（ループバックのみ）。 */
export function verifyIntegration(id: string): Promise<VerifyResult> {
  return invoke<VerifyResult>("rakuraku_verify_integration", { id });
}

/**
 * 不足部品の公式配布ページを開く（誘導のみ・自動DLしない）。
 * component は "voicevox" / "bouyomichan" 等の固定語。URL は Rust 側の固定定数から解決する
 * （frontend は raw URL を渡さない）。
 */
export function openOfficialPage(id: string, component: string): Promise<void> {
  return invoke<void>("rakuraku_open_official_page", { id, component });
}
