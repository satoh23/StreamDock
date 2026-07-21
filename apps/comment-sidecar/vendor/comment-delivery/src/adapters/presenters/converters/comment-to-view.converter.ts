import type { Comment } from "@comment-dock/comment-fetcher";
import type { CommentViewDto } from "@comment-dock/shared";

export const convertCommentToViewDto = (comment: Comment): CommentViewDto => {
  return {
    id: comment.id,
    source: comment.source,
    author: {
      id: comment.author.id,
      name: comment.author.name,
      // 036a: 素通し（036a では User.avatar を誰も埋めないため常に undefined）。型上はドメイン User.avatar（URL 意味）を
      // UserSummaryDto.avatar（data URI 意味）へコピーする＝036a は器の予約のみで意味は未整合だが、値が流れないため無害。
      // 036b がこの行を URL→data URI 変換に差し替える境界（egress を converter 1 箇所に集約し webview に raw URL を渡さない）。
      // 036b 申し送り（security-review 必須）:
      //   ・画像 fetch（I/O）を伴うため、convertCommentToViewDto の async 化か、上流で解決済みの data URI キャッシュ参照へ再構成する。
      //   ・出力は `data:image/<mime>;base64,<base64>`（base64 文字集合のみ）であることを emit 前に検証する。
      //     受け側 overlay の background-image は raw URL / カンマ多重背景でブレイクアウトし外部 URL を踏み得るため（§CSP）、
      //     ここで well-formed 保証を作るのが唯一の egress 集約点になる。
      avatar: comment.author.avatar,
    },
    text: comment.text,
    publishedAt: comment.publishedAt.toISOString(),
    eventType: comment.eventType,
    monetaryAmount: comment.monetaryAmount,
  };
};
