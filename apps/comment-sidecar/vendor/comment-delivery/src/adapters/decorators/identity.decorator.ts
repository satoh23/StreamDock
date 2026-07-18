import type { CommentViewDto } from "@comment-dock/shared";
import type { CommentDecorator } from "../../usecases/interfaces/comment-decorator.interface.js";

export class IdentityDecorator implements CommentDecorator {
  decorate(comment: CommentViewDto): CommentViewDto {
    return comment;
  }
}
