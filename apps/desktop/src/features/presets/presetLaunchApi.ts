import { invoke } from "@tauri-apps/api/core";
import type { BulkLaunchPresetResult } from "./types";

/**
 * プリセット一括起動（008 Bulk Launch）の Tauri command 薄いラッパ。
 * コンポーネントは invoke を直接呼ばず、この API 経由で呼ぶ。
 *
 * frontend からは presetId のみを渡す。Preset / PresetItem / Tool の取得と
 * executablePath の検証・起動はすべて Rust 側で行う（docs/security.md 準拠）。
 */
export function launchPreset(
  presetId: string,
): Promise<BulkLaunchPresetResult> {
  return invoke<BulkLaunchPresetResult>("launch_preset", { presetId });
}
