import { invoke } from "@tauri-apps/api/core";
import type {
  CreateToolInput,
  LaunchToolResult,
  StopProcessResult,
  ToolRecord,
  UpdateToolInput,
} from "./types";

/**
 * Tauri command の薄いラッパ。
 * コンポーネントは invoke を直接呼ばず、この API 経由でツールを操作する。
 */

export function listTools(): Promise<ToolRecord[]> {
  return invoke<ToolRecord[]>("list_tools");
}

export function getTool(id: string): Promise<ToolRecord> {
  return invoke<ToolRecord>("get_tool", { id });
}

export function createTool(input: CreateToolInput): Promise<ToolRecord> {
  return invoke<ToolRecord>("create_tool", { input });
}

export function updateTool(
  id: string,
  input: UpdateToolInput,
): Promise<ToolRecord> {
  return invoke<ToolRecord>("update_tool", { id, input });
}

export function deleteTool(id: string): Promise<void> {
  return invoke<void>("delete_tool", { id });
}

/**
 * 登録済み Tool を toolId で単体起動する。
 * frontend からは toolId のみを渡し、Tool 取得・パス検証・起動は Rust 側で行う。
 * presetItemId（起動元のメイン画面行）を渡すと registry に記録され、画面遷移で UI 状態を失っても
 * reconcile が「起動済み」を復元できる（バグ2）。停止対象のスコープには影響しない（preset_id は None）。
 */
export function launchTool(
  id: string,
  presetItemId?: string,
): Promise<LaunchToolResult> {
  return invoke<LaunchToolResult>("launch_tool", { id, presetItemId });
}

/**
 * 起動中プロセスを launchId で前面に出す（アクティブ化）。「開く」ボタン用（バグ1）。
 * frontend からは launchId のみを渡す（`stopProcess` と同じ設計）。Rust 側が registry から
 * 実 PID を解決し、shell を経由せず既存ウィンドウを前面化する（新規インスタンスは起動しない）。
 * Windows は保持 PID のウィンドウを前面化、macOS の `.app` は `/usr/bin/open` で既存を前面化する。
 */
export function focusProcess(launchId: string): Promise<void> {
  return invoke<void>("focus_process", { launchId });
}

/**
 * stream-dock 経由で起動した単体プロセスを launchId で停止する（009 Process Stop）。
 * frontend からは launchId のみを渡す。停止対象は Rust 側 registry 登録済みプロセスに限定され、
 * raw PID / path / command は渡さない（docs/security.md §6）。
 */
export function stopProcess(launchId: string): Promise<StopProcessResult> {
  return invoke<StopProcessResult>("stop_process", { launchId });
}
