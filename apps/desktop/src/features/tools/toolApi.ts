import { invoke } from "@tauri-apps/api/core";
import type { CreateToolInput, ToolRecord, UpdateToolInput } from "./types";

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
