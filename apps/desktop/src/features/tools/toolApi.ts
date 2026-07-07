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
 */
export function launchTool(id: string): Promise<LaunchToolResult> {
  return invoke<LaunchToolResult>("launch_tool", { id });
}

/**
 * stream-dock 経由で起動した単体プロセスを launchId で停止する（009 Process Stop）。
 * frontend からは launchId のみを渡す。停止対象は Rust 側 registry 登録済みプロセスに限定され、
 * raw PID / path / command は渡さない（docs/security.md §6）。
 */
export function stopProcess(launchId: string): Promise<StopProcessResult> {
  return invoke<StopProcessResult>("stop_process", { launchId });
}
