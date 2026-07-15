// 032c-a: 内蔵コメントビューアの表示 DTO（frontend 専用モック型）。
//
// 親設計 032c（docs/tasks/032c-comment-viewer-voicevox-design.md）の CommentViewDto の形に合わせる。
// 本タスク（032c-a）では実データ取得（Twitch/YouTube・Node sidecar・WebSocket）を作らず、この型の
// モックのみを描画する。将来 Rust 側で正規化した CommentViewDto の ts-rs binding を持つ場合（032c-b/-d）は、
// 他 feature（tools/rakuraku）と同様に `bindings/` 生成物へ移し、本ファイルはそれを再エクスポートする形にする。

/** コメントの配信元。 */
export type CommentSource = "twitch" | "youtube";

/** コメント種別（通常チャット／投げ銭／メンバーシップ等）。 */
export type CommentEventType =
  | "chat"
  | "superchat"
  | "membership"
  | "subscription";

/** コメント投稿者。 */
export interface CommentAuthor {
  /** 配信元内の投稿者 ID。 */
  id: string;
  /** 表示名。 */
  name: string;
}

/** 表示側で扱う正規化済みコメント 1 件。 */
export interface CommentViewDto {
  /** 一意 ID（重複排除のキー）。 */
  id: string;
  /** 配信元。 */
  source: CommentSource;
  /** 投稿者。 */
  author: CommentAuthor;
  /** 本文。 */
  text: string;
  /** 投稿日時（ISO8601 文字列）。 */
  publishedAt: string;
  /** コメント種別。 */
  eventType: CommentEventType;
  /** 投げ銭などの金額表示（該当時のみ・例 "¥500"）。 */
  monetaryAmount?: string;
}
