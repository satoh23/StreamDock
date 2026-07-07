import { invoke } from "@tauri-apps/api/core";
import type { BulkLaunchPresetResult, StopPresetProcessesResult } from "./types";

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

/**
 * 選択中 Preset に紐づく、registry 登録済みプロセスをまとめて停止する（009 Process Stop）。
 * frontend からは presetId のみを渡す。Rust 側で registry を検索し、その presetId に
 * 紐づく managed process だけを停止する（docs/security.md §6）。
 */
export function stopPresetProcesses(
  presetId: string,
): Promise<StopPresetProcessesResult> {
  return invoke<StopPresetProcessesResult>("stop_preset_processes", {
    presetId,
  });
}
