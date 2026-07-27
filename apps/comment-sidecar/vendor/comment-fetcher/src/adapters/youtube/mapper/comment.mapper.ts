import type {
  Comment,
  MonetaryAmount,
} from "../../../entities/comment/comment.js";
import { COMMENT_EVENT_TYPES, COMMENT_SOURCES } from "@comment-dock/shared";
import type {
  YouTubeGiftDetailsDto,
  YouTubeLiveChatMessagesListResponseDto,
  YouTubeSuperChatDetailsDto,
  YouTubeSuperStickerDetailsDto,
} from "../dto/raw.dto.js";

const YOUTUBE_MESSAGE_TYPE_TO_COMMENT_EVENT_TYPE = {
  TEXT_MESSAGE_EVENT: COMMENT_EVENT_TYPES.NORMAL,
  SUPER_CHAT_EVENT: COMMENT_EVENT_TYPES.SUPER_CHAT,
  // TODO: 将来的に Super Sticker 専用イベント型が必要になれば分離を検討する。
  SUPER_STICKER_EVENT: COMMENT_EVENT_TYPES.SUPER_CHAT,
  // 043a: 新規メンバー加入／継続マイルストーンはメンシプ（membership）として分離する（旧: subscription 畳み込み）。
  NEW_SPONSOR_EVENT: COMMENT_EVENT_TYPES.MEMBERSHIP,
  MEMBER_MILESTONE_CHAT_EVENT: COMMENT_EVENT_TYPES.MEMBERSHIP,
  // 043d: メンバーシップギフトの**贈与側**（購入者本人 1 件）。Twitch の sub_gift と同じ gift 種別へ写す。
  MEMBERSHIP_GIFTING_EVENT: COMMENT_EVENT_TYPES.GIFT,
  // 043d: 縦型ライブの Jewels ギフト。金額は micros ではなく個数で届く（mapJewelsAmount 参照）。
  //   ⚠ 既知の未解決課題: GIFT_EVENT は**同一 message id が combo_count 更新で再送される**ため、
  //     Rust 側の `INSERT OR IGNORE`（と frontend mergeComments の id 重複排除）と組み合わさると
  //     連続ギフトの金額が最初の 1 回ぶんのままになる。詳細は stream-list-proto.ts の
  //     LiveChatMessage.id のコメントを正とする。**043e として起票済み**
  //     （docs/tasks/043e-youtube-jewels-combo-fidelity.md）で、本行の周辺は 043e の (1) で
  //     comboCount を通すよう変更予定。
  GIFT_EVENT: COMMENT_EVENT_TYPES.JEWELS,
  //
  // 043d(決定1): GIFT_MEMBERSHIP_RECEIVED_EVENT は**意図的にこのマップへ載せない**。
  //   1 回のギフト購入につき受領者数ぶん発火するため、贈与側 1 件だけを扱えば二重計上がゼロになる。
  //   受贈者の情報（受領側 details の member_level_name / gifter_channel_id）を**そもそも受信しない**ので
  //   security.md §9（受贈者/贈与者名の非保持）とも最整合。載っていない type は下の「未対応 type は除外」で
  //   落ちるため、受領側イベントはコメント 0 件になる。
  //   再修正トリガー: 「誰が受け取ったか」を表示したい要望が出たら、集計対象外の新種別として起票し直す
  //   （membership 流用は subscription_count が N+1 に膨らむため不可）。
} as const;

/** 配信コメントの取得結果を、共通コメント配列へ変換する。 */
export function mapYouTubeLiveChatMessagesToComments(
  response: YouTubeLiveChatMessagesListResponseDto,
): Comment[] {
  return response.items
    .map((message) => {
      // 削除/撤回/BAN などの本文なしイベントは snippet や author_details が欠けるため除外する。
      if (!message?.snippet || !message.author_details) {
        return null;
      }

      // 未対応の message type は業務イベントへ変換できないため除外する。
      if (
        !(message.snippet.type in YOUTUBE_MESSAGE_TYPE_TO_COMMENT_EVENT_TYPE)
      ) {
        return null;
      }

      const eventType =
        YOUTUBE_MESSAGE_TYPE_TO_COMMENT_EVENT_TYPE[
          message.snippet
            .type as keyof typeof YOUTUBE_MESSAGE_TYPE_TO_COMMENT_EVENT_TYPE
        ];

      const publishedAt = new Date(message.snippet.published_at);
      if (Number.isNaN(publishedAt.getTime())) {
        return null;
      }

      const comment: Comment = {
        id: message.id,
        source: COMMENT_SOURCES.YOUTUBE,
        author: {
          id: message.author_details.channel_id,
          name: message.author_details.display_name,
          // 036b: 取得元 URL（ドメイン値）。data URI 化は配信境界の converter が担う（親 036 の層別意味づけ）。
          avatar: message.author_details.profile_image_url,
        },
        text: message.snippet.display_message,
        publishedAt,
        eventType,
        monetaryAmount:
          mapMonetaryAmount(
            message.snippet.super_chat_details ??
              message.snippet.super_sticker_details,
          ) ?? mapJewelsAmount(message.snippet.gift_details),
        // 043a: 継続マイルストーンの月数を拾う（既受信フィールド・新規メンバーは月数なし＝undefined）。
        monthCount:
          message.snippet.member_milestone_chat_details?.member_month,
        // 043d: メンバーシップギフト（贈与側）の件数。受贈者名は受信しない＝件数だけを通す（§9）。
        giftCount: mapGiftCount(
          message.snippet.membership_gifting_details?.gift_memberships_count,
        ),
      };

      return comment;
    })
    .filter((comment): comment is Comment => comment !== null);
}

/** 金額情報を通常単位へ変換する。変換できない値は undefined。 */
function mapMonetaryAmount(
  detail?: YouTubeSuperChatDetailsDto | YouTubeSuperStickerDetailsDto,
): MonetaryAmount | undefined {
  if (!detail) {
    return undefined;
  }

  const amountMicros = Number(detail.amount_micros);
  if (!Number.isFinite(amountMicros)) {
    return undefined;
  }

  return {
    currency: detail.currency,
    amount: amountMicros / 1_000_000,
  };
}

/**
 * 043d: Jewels（縦型ライブのギフト）の金額。**micros 換算しない**——jewels_amount は仮想通貨の個数が
 * そのまま届くため、043a の dev-mock（`{ currency: "JEWELS", amount: n }`）と同形にする。
 * 通貨コードを "JEWELS" に固定することで、集計 SQL の bits（currency='BITS'）にもスパチャ
 * （event_type='superchat'）にも混ざらない（043a のテスト済み）。
 *
 * 043d(レビュー指摘・2026-07-27 修正): `mapGiftCount` と同じく **0 以下は undefined へ落とす**。
 * proto を flat な optional で宣言しているため `defaults: true` により「gift_details は在るが
 * jewels_amount が未設定」だと 0 が入り、金額バッジに「0 JEWELS」という誤表示が出ていた。
 * ギフトは必ずジュエルを消費するので 0 は「0 円のギフト」ではなく「値が来ていない」と解釈する。
 * 金額のみ落とし eventType=jewels は維持する（種別ラベルは出て金額バッジだけ出ない、に無害化）。
 * 再修正トリガー: 0 ジュエルのギフトが実在すると公式に確認できたら、この劣化をやめて 0 を通す。
 */
function mapJewelsAmount(
  detail?: YouTubeGiftDetailsDto,
): MonetaryAmount | undefined {
  const amount = detail?.jewels_amount;
  if (amount == null || !Number.isFinite(amount) || amount <= 0) {
    return undefined;
  }

  return { currency: "JEWELS", amount };
}

/**
 * 043d: メンバーシップギフトの件数。loadSync は `defaults: true` のため詳細メッセージが在って値が
 * 未設定だと 0 が入り、表示側が「0 件贈りました」という誤った文を作ってしまう。0 以下は undefined へ
 * 落として「〇〇さんがメンバーシップギフトを贈りました」（件数なしの文）に無害に劣化させる。
 * Twitch mapper の `?? 1`（単発 sub_gift を 1 件と見なす）とは意図的に異なる扱い。
 */
function mapGiftCount(count?: number): number | undefined {
  return count != null && Number.isFinite(count) && count > 0
    ? count
    : undefined;
}
