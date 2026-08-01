import { invoke } from "@tauri-apps/api/core";
import type { AppUpdateStatus } from "./bindings/AppUpdateStatus";

/**
 * 055b: アプリ自己アップデートの Tauri command の薄いラッパ。
 * コンポーネントは invoke を直接呼ばず、この API 経由で更新状態を取得する。
 */

/**
 * 公開リリースの `latest.json` を見て「更新があるか」を判定する（055b）。
 *
 * **引数は取らない**。宛先（endpoint URL）も現在バージョンも Rust/`tauri.conf.json` 側が持ち、
 * frontend からは一切渡さない（docs/security.md §3 最小権限 / §8）。
 *
 * ⚠ **reject を握り潰さないこと**。「更新なし」は `{ available: false }` で **resolve** し、
 * 「確認できなかった」（ネットワーク到達不可 / エンドポイント 404 / JSON 破損 / 署名検証失敗）は
 * `AppError`（`code: "UPDATE_CHECK_FAILED"`）で **reject** する。055c はこの 2 つを別表示にするため、
 * ここで catch して `available: false` に潰すと仕様が壊れる。
 *
 * Rust 側は 15 秒でタイムアウトするので、この Promise が永久に pending になることはない。
 */
export function checkAppUpdate(): Promise<AppUpdateStatus> {
  return invoke<AppUpdateStatus>("check_app_update");
}
