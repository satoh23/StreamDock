// Preset 系の IPC 型は Rust をソースに ts-rs で自動生成する（bindings/）。
// このファイルは生成物を再エクスポートするだけ。型は手書きせず、
// Rust 側（src-tauri/src/presets/model.rs・error.rs）を変更したら
// `pnpm --filter ./apps/desktop gen:bindings` で再生成する。
export type { Preset } from "./bindings/Preset";
export type { CreatePresetInput } from "./bindings/CreatePresetInput";
export type { UpdatePresetInput } from "./bindings/UpdatePresetInput";

// PresetItem 系（006 Preset Item Ordering）も Rust をソースに ts-rs で自動生成する。
export type { PresetItem } from "./bindings/PresetItem";
export type { LaunchMode } from "./bindings/LaunchMode";
export type { AddPresetItemInput } from "./bindings/AddPresetItemInput";
export type { UpdatePresetItemInput } from "./bindings/UpdatePresetItemInput";

// 一括起動（008 Bulk Launch）の結果型も Rust をソースに ts-rs で自動生成する。
export type { BulkLaunchPresetResult } from "./bindings/BulkLaunchPresetResult";
export type { BulkLaunchToolResult } from "./bindings/BulkLaunchToolResult";

// Preset 単位のプロセス停止（009 Process Stop）の結果型。
export type { StopPresetProcessesResult } from "./bindings/StopPresetProcessesResult";

// runtime process registry の状態型（010 Runtime Status）。
export type { RuntimeProcess } from "./bindings/RuntimeProcess";
export type { RuntimeProcessStatus } from "./bindings/RuntimeProcessStatus";

// AppError は Tool と共有（tools/bindings に生成される）。
export type { AppError } from "../tools/bindings/AppError";

// コンポーネントは `PresetRecord` / `PresetItemRecord` 名で参照する（Tool の ToolRecord に揃える）。
export type { Preset as PresetRecord } from "./bindings/Preset";
export type { PresetItem as PresetItemRecord } from "./bindings/PresetItem";

import type { PresetItem } from "./bindings/PresetItem";
import type { ToolRecord } from "../tools/types";

/**
 * 表示用モデル。PresetItem に紐づく Tool 情報を合成したもの。
 * メイン画面のツール一覧など、name / icon / description を表示する箇所で使う。
 */
export type PresetItemWithTool = PresetItem & { tool: ToolRecord };

/** サイドバーのプリセット行に出すメタ情報（ツール数・並行起動を含むか）。 */
export type PresetItemMeta = { count: number; hasParallel: boolean };

/**
 * PresetItem[] と Tool[] を join して PresetItemWithTool[] を作る。
 * order_index 昇順を保ち、対応する Tool が存在しない行（削除済み等）は除外する。
 */
export function withTools(
  items: PresetItem[],
  tools: ToolRecord[],
): PresetItemWithTool[] {
  const byId = new Map(tools.map((t) => [t.id, t]));
  return items
    .slice()
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map((item) => {
      const tool = byId.get(item.toolId);
      return tool ? { ...item, tool } : null;
    })
    .filter((x): x is PresetItemWithTool => x !== null);
}
