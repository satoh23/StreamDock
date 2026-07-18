import type { CommentSource } from "@comment-dock/shared";

/**
 * OAuth・トークン保管で用いるプロバイダ識別子。
 * 画面やコメント取得で使う `CommentSource`（`@comment-dock/shared`）と同一の値集合。
 */
export type Provider = CommentSource;
