import type { CommentViewDto } from "@comment-dock/shared";

export interface CommentOutputPort {
  outputToUi(comments: CommentViewDto[]): Promise<void>;
  close?(): Promise<void>;
}
