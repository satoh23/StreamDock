// ts-rs 生成物（bindings/）の re-export バレル。
// bindings は Rust の model / error から自動生成されるため手書きしない。
// 変更時は `pnpm --filter ./apps/desktop gen:bindings` で再生成する。
export type { AppLogEntry } from "./bindings/AppLogEntry";
export type { LogLevel } from "./bindings/LogLevel";
export type { LogCategory } from "./bindings/LogCategory";
export type { DiagnosticSummary } from "./bindings/DiagnosticSummary";

// ErrorCode は tools 側に生成される共有型、RuntimeProcess は presets 側に生成される型を共有する。
export type { ErrorCode } from "../tools/bindings/ErrorCode";
export type { RuntimeProcess } from "../presets/bindings/RuntimeProcess";
