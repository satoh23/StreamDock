// 032c-b: 内蔵コメントビューアの表示 DTO。
//
// Rust 側で正規化した CommentViewDto の ts-rs binding（`bindings/`）を**正**とし、本ファイルはそれを
// 再エクスポートするだけにする（032c-a のヘッダ方針どおり frontend 専用モック型を撤去）。sidecar が WS で
// 送る `comments.append` のワイヤ表現と同形で、wire = 型 = 描画が一致する。
export type { CommentViewDto } from "./bindings/CommentViewDto";
export type { CommentSource } from "./bindings/CommentSource";
export type { CommentEventType } from "./bindings/CommentEventType";
export type { CommentAuthor } from "./bindings/CommentAuthor";
