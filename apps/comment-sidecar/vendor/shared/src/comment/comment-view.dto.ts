import type { UserSummaryDto } from "../user/user-summary.dto.js";
import type { CommentEventType, CommentSource } from "./comment-types.js";

export type CommentMonetaryAmountDto = {
  currency: string;
  amount: number;
};

/**
 * 画面描画専用の共通DTO。
 * YouTube/Twitchどちらのコメントでも、この型へ変換して表示層へ渡す。
 */
export type CommentViewDto = {
  id: string;
  source: CommentSource;
  author: UserSummaryDto;
  text: string;
  publishedAt: string;
  eventType: CommentEventType;
  monetaryAmount?: CommentMonetaryAmountDto;
  // 043a: メンシプ／サブスク／ギフトの付随数値（表示用・受贈者名は持たない＝§9）。
  /** メンバー／サブスク継続月数。 */
  monthCount?: number;
  /** ギフト件数（community_sub_gift の total・単発 sub_gift は 1）。 */
  giftCount?: number;
  /** サブスク階級（1/2/3）。 */
  tier?: number;
  // 043e: Jewels の combo（連続ギフト）回数。表示用の観測値で**金額計算には使わない**（フェーズ1）。
  /** combo 回数（YouTube Jewels の combo_count・単発/未設定は undefined）。 */
  comboCount?: number;
  // 062a: レイド人数。他の付随数値と違い**端末保存する**（`viewer_comments.raid_viewer_count`）＝
  // 「誰がレイドしてくれたか」を配信後に見返すのが 062 の要望のため。整数のみで個人情報を含まない（§9）。
  /** レイド人数（Twitch raid の viewer_count・raid 以外は undefined）。 */
  raidViewerCount?: number;
  // ⚠⚠⚠ 063e 段 3: 引き換えた報酬の名前（channelpoint 以外は undefined）。
  //   ⚠ 配信者が Twitch で付けた名前＝**ユーザー自身の設定値**であり、第三者データではない（§9）。
  //   ⚠⚠ **端末保存しない**（monthCount / giftCount / tier と同じ側）。用途は照合 1 つだけ。
  /** 報酬名（Twitch `reward.title`・channelpoint 以外は undefined）。 */
  rewardTitle?: string;
};
