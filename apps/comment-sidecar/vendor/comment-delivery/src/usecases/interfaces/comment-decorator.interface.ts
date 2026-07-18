import type { CommentViewDto } from "@comment-dock/shared";

export interface CommentDecorator {
  decorate(comment: CommentViewDto): CommentViewDto | Promise<CommentViewDto>;
}
