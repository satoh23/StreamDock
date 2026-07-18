import type { Comment } from "../../entities/comment/comment.js";

export interface CommentOutputPort {
  outputComments(comments: Comment[]): Promise<void>;
}
