import type { Comment } from "../../entities/comment/comment.js";

export type FetchCommentsInput = {
  liveChatId: string;
  pageToken?: string;
};

export type FetchCommentsResult = {
  comments: Comment[];
  nextPageToken?: string;
};

export interface CommentRepository {
  streamComments(input: FetchCommentsInput): AsyncIterable<FetchCommentsResult>;
}
