// 032c-b コミット2: sidecar→viewer の WS ワイヤ表現。
// Rust 正規化 CommentViewDto（ts-rs binding）と**同形**の「正規化コメント」を定義し、osareview の
// CommentViewDto（source/super_chat・monetaryAmount={currency,amount}）を viewer 表示形へ変換する。
// これにより wire = Rust ts-rs 型 = viewer 消費型が一致し、コミット1 の暫定アダプタ（commentStream.ts）を撤去できる。
import type { CommentViewDto as OsareviewCommentViewDto } from "@comment-dock/shared";

/** viewer 表示用の配信元。 */
export type CanonicalCommentSource = "twitch" | "youtube";

/** viewer 表示用のコメント種別。 */
export type CanonicalCommentEventType =
  | "chat"
  | "superchat"
  | "membership"
  | "subscription";

export interface CanonicalCommentAuthor {
  id: string;
  name: string;
}

/** Rust `CommentViewDto`（ts-rs）と同形の正規化コメント。 */
export interface CanonicalComment {
  id: string;
  source: CanonicalCommentSource;
  author: CanonicalCommentAuthor;
  text: string;
  publishedAt: string;
  eventType: CanonicalCommentEventType;
  monetaryAmount?: string;
}

const EVENT_TYPE_MAP: Record<
  OsareviewCommentViewDto["eventType"],
  CanonicalCommentEventType
> = {
  normal: "chat",
  super_chat: "superchat",
  subscription: "subscription",
};

/** osareview CommentViewDto を viewer 表示用の正規化コメントへ変換する。 */
export function toCanonicalComment(
  dto: OsareviewCommentViewDto,
): CanonicalComment {
  const canonical: CanonicalComment = {
    id: dto.id,
    source: dto.source,
    author: { id: dto.author.id, name: dto.author.name },
    text: dto.text,
    publishedAt: dto.publishedAt,
    eventType: EVENT_TYPE_MAP[dto.eventType] ?? "chat",
  };
  if (dto.monetaryAmount) {
    const { currency, amount } = dto.monetaryAmount;
    canonical.monetaryAmount =
      currency === "BITS" ? `${amount} bits` : `${amount} ${currency}`;
  }
  return canonical;
}
