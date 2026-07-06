// Preset 系の IPC 型は Rust をソースに ts-rs で自動生成する（bindings/）。
// このファイルは生成物を再エクスポートするだけ。型は手書きせず、
// Rust 側（src-tauri/src/presets/model.rs・error.rs）を変更したら
// `pnpm --filter ./apps/desktop gen:bindings` で再生成する。
export type { Preset } from "./bindings/Preset";
export type { CreatePresetInput } from "./bindings/CreatePresetInput";
export type { UpdatePresetInput } from "./bindings/UpdatePresetInput";

// AppError は Tool と共有（tools/bindings に生成される）。
export type { AppError } from "../tools/bindings/AppError";

// コンポーネントは `PresetRecord` 名で参照する（Tool の ToolRecord に揃える）。
export type { Preset as PresetRecord } from "./bindings/Preset";
