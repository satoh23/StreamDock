import { inject, injectable } from "tsyringe";
import type { Comment } from "@comment-dock/comment-fetcher";
import type { CommentOutputPort } from "./interfaces/comment-output-port.interface.js";
import { DELIVERY_DI_TOKENS } from "../infrastructure/shared/di-tokens.js";
import { DecorationPipeline } from "../adapters/decorators/decoration-pipeline.js";
import { convertCommentToViewDto } from "../adapters/presenters/converters/comment-to-view.converter.js";

@injectable()
export class DeliverCommentsUseCase {
  constructor(
    @inject(DELIVERY_DI_TOKENS.commentOutputPort)
    private readonly outputPort: CommentOutputPort,
    @inject(DecorationPipeline)
    private readonly decorationPipeline: DecorationPipeline,
  ) {}

  async deliverComments(comments: readonly Comment[]): Promise<void> {
    // 036b: convertCommentToViewDto は avatar 解決（画像 fetch）で async 化したため await Promise.all で解決する。
    const viewComments = await Promise.all(
      comments.map((comment) => convertCommentToViewDto(comment)),
    );
    const decoratedComments =
      await this.decorationPipeline.decorateComments(viewComments);
    await this.outputPort.outputToUi(decoratedComments);
  }
}
