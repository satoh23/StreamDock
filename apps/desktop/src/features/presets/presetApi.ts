import { invoke } from "@tauri-apps/api/core";
import type { CreatePresetInput, PresetRecord, UpdatePresetInput } from "./types";

/**
 * Tauri command の薄いラッパ。
 * コンポーネントは invoke を直接呼ばず、この API 経由でプリセットを操作する。
 */

export function listPresets(): Promise<PresetRecord[]> {
  return invoke<PresetRecord[]>("list_presets");
}

export function getPreset(id: string): Promise<PresetRecord> {
  return invoke<PresetRecord>("get_preset", { id });
}

export function createPreset(input: CreatePresetInput): Promise<PresetRecord> {
  return invoke<PresetRecord>("create_preset", { input });
}

export function updatePreset(
  id: string,
  input: UpdatePresetInput,
): Promise<PresetRecord> {
  return invoke<PresetRecord>("update_preset", { id, input });
}

export function deletePreset(id: string): Promise<void> {
  return invoke<void>("delete_preset", { id });
}
