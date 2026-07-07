import { invoke } from "@tauri-apps/api/core";
import type { RuntimeProcess } from "./types";

/**
 * runtime process registry の状態取得（010 Runtime Status）の Tauri command 薄いラッパ。
 * コンポーネントは invoke を直接呼ばず、この API 経由で呼ぶ。
 *
 * frontend からは raw PID / path / command を渡さない。状態確認対象は Rust 側 registry に
 * 登録された（stream-dock がこのセッションで起動した）プロセスに限定される（docs/security.md）。
 */

/**
 * registry の全 managed process の状態を返す。
 * 単体起動（007）由来のプロセスも含めて launchId で突き合わせられるよう、全件を返す版を使う。
 */
export function listRuntimeProcesses(): Promise<RuntimeProcess[]> {
  return invoke<RuntimeProcess[]>("list_runtime_processes");
}

/**
 * 選択中 Preset に紐づく managed process の状態だけを返す。
 * frontend からは presetId のみを渡す（単体起動由来は preset に紐づかないため含まれない）。
 */
export function listPresetRuntimeProcesses(
  presetId: string,
): Promise<RuntimeProcess[]> {
  return invoke<RuntimeProcess[]>("list_preset_runtime_processes", {
    presetId,
  });
}
