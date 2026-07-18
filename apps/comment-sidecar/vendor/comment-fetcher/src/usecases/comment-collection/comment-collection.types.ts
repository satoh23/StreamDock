import type { Comment } from "../../entities/comment/comment.js";
import type { FetchCommentsInput } from "./comment-repository.interface.js";

export type CollectCommentsInput = FetchCommentsInput & {
  retryOnStreamEnd?: boolean;
};
export type CollectCommentsStream = AsyncIterable<Comment[]>;
