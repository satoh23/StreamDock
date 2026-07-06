// Tool 系の IPC 型は Rust をソースに ts-rs で自動生成する（bindings/）。
// このファイルは生成物を再エクスポートするだけ。型は手書きせず、
// Rust 側（src-tauri/src/tools/model.rs・error.rs）を変更したら
// `pnpm --filter ./apps/desktop gen:bindings` で再生成する。
export type { Tool } from "./bindings/Tool";
export type { CreateToolInput } from "./bindings/CreateToolInput";
export type { UpdateToolInput } from "./bindings/UpdateToolInput";
export type { AppError } from "./bindings/AppError";

// 既存コンポーネントは `ToolRecord` 名で参照しているため alias を温存する。
export type { Tool as ToolRecord } from "./bindings/Tool";
