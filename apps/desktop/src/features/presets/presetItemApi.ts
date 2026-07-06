import { invoke } from "@tauri-apps/api/core";
import type {
  AddPresetItemInput,
  PresetItemRecord,
  UpdatePresetItemInput,
} from "./types";

/**
 * PresetItem（プリセット内のツール構成）操作の Tauri command 薄いラッパ。
 * コンポーネントは invoke を直接呼ばず、この API 経由で操作する。
 */

/** 指定プリセットのツール一覧を order_index 昇順で取得する。 */
export function listPresetItems(presetId: string): Promise<PresetItemRecord[]> {
  return invoke<PresetItemRecord[]>("list_preset_items", { presetId });
}

/** 全プリセットのツール一覧を取得する（サイドバーのツール数集計・App 全体の状態用）。 */
export function listAllPresetItems(): Promise<PresetItemRecord[]> {
  return invoke<PresetItemRecord[]>("list_all_preset_items");
}

/** プリセットにツールを追加する（末尾に配置）。 */
export function addToolToPreset(
  input: AddPresetItemInput,
): Promise<PresetItemRecord> {
  return invoke<PresetItemRecord>("add_tool_to_preset", { input });
}

/** プリセットからツールを外す（Tool 自体は削除しない）。 */
export function removeToolFromPreset(id: string): Promise<void> {
  return invoke<void>("remove_tool_from_preset", { id });
}

/** 起動モード・有効フラグを更新する。 */
export function updatePresetItem(
  id: string,
  input: UpdatePresetItemInput,
): Promise<PresetItemRecord> {
  return invoke<PresetItemRecord>("update_preset_item", { id, input });
}

/** プリセット内の起動順を、渡した id の並び順どおりに再割当する。 */
export function reorderPresetItems(
  presetId: string,
  orderedIds: string[],
): Promise<PresetItemRecord[]> {
  return invoke<PresetItemRecord[]>("reorder_preset_items", {
    presetId,
    orderedIds,
  });
}
