// 038a: 視聴者メモリの型は Rust（ts-rs）生成 bindings を唯一の正とし、ここで再エクスポートする
// （consumer は bindings ディレクトリを直接参照せず、この barrel から型を取る＝comment-viewer と同流儀）。
export type { ViewerRecord } from "./bindings/ViewerRecord";
export type { ViewerCommentRecord } from "./bindings/ViewerCommentRecord";
export type { ViewerDetail } from "./bindings/ViewerDetail";
export type { ListViewersInput } from "./bindings/ListViewersInput";
export type { ViewerSort } from "./bindings/ViewerSort";
// 038c: record_comment の判定結果（初見／久しぶり）。
export type { RecordResult } from "./bindings/RecordResult";
