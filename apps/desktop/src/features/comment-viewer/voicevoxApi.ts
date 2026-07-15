import { invoke } from "@tauri-apps/api/core";
import type { LaunchResult } from "../rakuraku/types";

/**
 * 032c-c: コメントビューアの VOICEVOX ENGINE 起動誘導 API。
 *
 * ENGINE 未起動時に、**ツール管理に登録済みの VOICEVOX** を管理付き spawn（resolve→spawn→register）で
 * 起動する薄い Rust command（`launch_voicevox_engine`）のラッパ。frontend は raw パス/ポートを渡さず、
 * Rust 側が登録済みツールを exe 名一致（OS 別: macOS=`VOICEVOX.app` / Windows=`VOICEVOX.exe`）で解決する。
 * 未登録なら `launched=false` で「ツール管理に登録してください」を返す（誘導のみ・絶対パス直起動しない）。
 * ENGINE への合成 HTTP は viewer の `fetch`（ループバック 50021）で行い、この command は起動のみを担う。
 *
 * capability について（`comment-viewer.json` に per-command 許可を足していない理由・要 E2E）:
 * Tauri v2 の ACL（capability の `permissions`）は **plugin/core command のみ**を対象とし、アプリ定義
 * command（`generate_handler!` 登録の自作 command）は列挙不要で invoke できる。実際 main の
 * `capabilities/default.json` は `core:default` ＋ plugin 権限のみで約30個のアプリ command を invoke 成功して
 * いる。同機構で viewer（`core:default`）からも本 command を invoke できるはずだが、viewer からのアプリ
 * command invoke は本タスクが初なので `pnpm tauri dev` で要確認。
 * ⚠️ 万一拒否された場合、アプリ command は ACL 識別子を持たないため「comment-viewer.json に command 許可を
 * 1 行追加」では直せない。その場合は window×capability の対応（`windows` 指定・capability 分割）で是正する。
 */
export function launchVoicevoxEngine(): Promise<LaunchResult> {
  return invoke<LaunchResult>("launch_voicevox_engine");
}
