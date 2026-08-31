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
 *
 * ⚠⚠ **2026-08-31（依頼者指示）: この 3 本を呼ぶ画面は無くなった**（`screens/rakuraku-tools/` を削除）。
 *   ⚠ **Rust 側の `rakuraku_*` コマンドは残っている**（`generate_handler!` の登録も不変）。
 *   ⚠⚠ **`rakuraku::service` は `launch_voicevox_engine` が使っており、Rust ごと消すことはできない。**
 *   ⇒ ラッパも残す（露出面は変わらない＝invoke は画面の有無に関係なく webview から届く）。
 *
 * ## ⚠⚠⚠ いまこの 3 本を呼んでも**何も起きない**（security-review S-3・2026-08-31 で追記）
 *
 * `rakuraku/service.rs` の `registry()` が **`Vec::new()` を返す**（032c-a で実装を撤去した）ので、
 * 3 本とも先頭の `service::find(&id)?` で **NotFound を返して即終了する**。
 * ⚠⚠ 特に `rakuraku_launch_component` は **`process::service::spawn` に到達しない**。
 * ⇒ 「画面が無いから安全」ではなく「**Rust 側が空だから実効ゼロ**」が正しい理解である
 * （上の「露出面は変わらない」だけだと、読んだ人が「呼べば動く」と誤解する）。
 *
 * ⚠⚠⚠ **再修正トリガー＝`registry()` にエントリを戻すとき（032c-b）。**
 *   そのとき 3 本は **UI ゲートの無いまま生き返る**。アプリ定義コマンドは capabilities の ACL 対象外なので、
 *   **コメビュ窓・オーバーレイ窓（第三者コメントとユーザー CSS を描画する webview）からも invoke が届く**。
 *   ⇒ 復活させる前に、呼び出し元窓の絞り込み（`webview.label` チェック等）を再検討すること。
 *   ⚠ なおガード自体は堅い——`resolve_tool_for_component` は
 *   **ユーザーが自分でツール管理に登録済みの exe 名一致**しか解決しない（任意パス起動にはならない）。
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
