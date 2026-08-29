import type { Comment } from "@comment-dock/comment-fetcher";
import type { CommentViewDto } from "@comment-dock/shared";
import { resolveAvatarDataUri } from "./resolve-avatar-data-uri.js";

// 036b: 配信境界（egress 集約点）。ドメイン `User.avatar`（取得元 URL）を UserSummaryDto.avatar（data URI）へ
// 変換する唯一の場所。画像 fetch（I/O）を伴うため async 化した（036a の申し送りどおり）。
// resolveAvatarDataUri は never throws（失敗/タイムアウト/超過/非許可ホストは undefined）で、出力は emit 前に
// 整形済み base64 data URI であることを検証済み＝overlay の background-image で外部 URL を踏ませない（§CSP）。
export const convertCommentToViewDto = async (
  comment: Comment,
): Promise<CommentViewDto> => {
  return {
    id: comment.id,
    source: comment.source,
    author: {
      id: comment.author.id,
      name: comment.author.name,
      avatar: await resolveAvatarDataUri(comment.author.id, comment.author.avatar),
    },
    text: comment.text,
    publishedAt: comment.publishedAt.toISOString(),
    eventType: comment.eventType,
    monetaryAmount: comment.monetaryAmount,
    // 043a: メンシプ／サブスク／ギフトの付随数値をそのまま通す（受贈者名は持たない＝§9）。
    monthCount: comment.monthCount,
    giftCount: comment.giftCount,
    tier: comment.tier,
    // 043e: Jewels の combo 回数（表示用の観測値・金額計算には使わない）。
    comboCount: comment.comboCount,
    // 062a: レイド人数。⚠⚠ **この詰め替えは明示列挙**なので、書き漏らすと型検査もテストも通るのに
    //   値だけが静かに消える（`wire.ts` の `toCanonicalComment` と対になる中継 2 段の 1 段目）。
    //   `scripts/test-comment-relay.mjs` が converter → wire の 2 段を実運用と同じ順で通して固定している。
    raidViewerCount: comment.raidViewerCount,
    // ⚠⚠⚠ 063e 段 3: 報酬名。**この 1 行を落とすと「出し分けが効かない」**
    //   ——報酬名が undefined になるので、報酬を指定した条件が**永久に当たらなくなる**
    //   （画面は正常・エラーも出ない）。上の `raidViewerCount` と同型の静かな欠落である。
    rewardTitle: comment.rewardTitle,
  };
};
