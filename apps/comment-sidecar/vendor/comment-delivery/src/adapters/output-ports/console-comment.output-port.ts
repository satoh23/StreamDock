import type { CommentOutputPort } from "../../usecases/interfaces/comment-output-port.interface.js";
import type { CommentViewDto } from "@comment-dock/shared";
import { injectable } from "tsyringe";

// 開発時の切り分け用出力ポート。UI 未接続でも配信内容を確認できるようにする。
@injectable()
export class ConsoleCommentOutputPort implements CommentOutputPort {
  async outputToUi(comments: CommentViewDto[]): Promise<void> {
    for (const comment of comments) {
      console.info("[comment-delivery]", {
        source: comment.source,
        author: comment.author.name,
        text: comment.text,
        eventType: comment.eventType,
      });
    }
  }
}
