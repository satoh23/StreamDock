import type { CommentViewDto } from "@comment-dock/shared";
import { injectAll, injectable } from "tsyringe";
import { DELIVERY_DI_TOKENS } from "../../infrastructure/shared/di-tokens.js";
import type { CommentDecorator } from "../../usecases/interfaces/comment-decorator.interface.js";

@injectable()
export class DecorationPipeline {
  constructor(
    @injectAll(DELIVERY_DI_TOKENS.commentDecorator)
    private readonly decorators: readonly CommentDecorator[],
  ) {}

  async decorateComments(
    comments: CommentViewDto[],
  ): Promise<CommentViewDto[]> {
    const results: CommentViewDto[] = [];

    for (const comment of comments) {
      let current = comment;
      for (const decorator of this.decorators) {
        current = await decorator.decorate(current);
      }
      results.push(current);
    }

    return results;
  }
}
