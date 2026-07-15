// らくらくツール設定（外部アプリ連携・032b）の IPC 型は Rust をソースに ts-rs で自動生成する（bindings/）。
// このファイルは生成物を再エクスポートするだけ。型は手書きせず、Rust 側
// （src-tauri/src/rakuraku/model.rs）を変更したら
// `pnpm --filter ./apps/desktop gen:bindings` で再生成する。
export type { ScanResult } from "./bindings/ScanResult";
export type { ComponentStatus } from "./bindings/ComponentStatus";
export type { LaunchResult } from "./bindings/LaunchResult";
