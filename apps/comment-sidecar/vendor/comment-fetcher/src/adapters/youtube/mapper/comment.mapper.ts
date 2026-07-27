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
  //   043e: GIFT_EVENT は**同一 message id が combo_count 更新で再送される**（公式 proto の
  //     LiveChatMessage.id に明記）。本 mapper は再送されたメッセージも**同じ id のコメント 1 件として
  //     そのまま写す**（重複排除やマージはしない＝ここは「届いた事実」を写す層）。同一 id をどう扱うかは
  //     表示・記録の単一注入点である frontend の mergeComments（updated バケット）と Rust の
  //     record_comment（event_type='jewels' 限定の UPDATE）が担う。
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
        // 043e: Jewels の combo 回数（表示用の観測値・金額計算には使わない）。0 以下は undefined へ落とす。
        comboCount: mapComboCount(message.snippet.gift_details?.combo_count),
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
 *
 * 043e(フェーズ1・意図的に乗算しない): combo（連続ギフト）でも **最新の jewels_amount をそのまま採る**。
 * `jewels_amount` が「1 回ぶんの単価」か「combo 累計」かは公式に明記が無く実データ検証もできないため、
 * 推測で換算を入れない（043d の「推測ゼロ」原則）。累計読みならこれで完全に正しく、単価読みでも従来と
 * 同値になるだけで**過大計上には絶対にならない**（安全側）。
 * 【フェーズ2 の再修正トリガー】同一 id の連続到着で `jewels_amount` が**変化しない**（＝単価）と実データで
 * 確認できたら、この return を `{ currency: "JEWELS", amount: amount * Math.max(comboCount ?? 0, 1) }` 相当へ
 * 変える（`combo_count = 0`＝単発で 0 倍にならないよう `max(..., 1)` は必須）。金額が変わるため
 * **再度 security-review** を通すこと（docs/tasks/043e-youtube-jewels-combo-fidelity.md のフェーズ2 節）。
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

/**
 * 043e: Jewels の combo 回数。公式は「The combo count of the gift; **0 if not a combo**」なので、
 * 単発ギフトは 0 で届く（`defaults: true` で未設定も 0）。`mapGiftCount` と同じく **0 以下は undefined へ落とす**
 * ＝表示側が「×0」という無意味な文言を作らない（combo でない普通のギフトには何も付かない）。
 *
 * **この値は金額計算に使わない**（フェーズ1）。単価か累計かを実機で判別するための観測値として表示まで通すだけ。
 *
 * 【レビュー指摘 Q-10・mapGiftCount と実装が同一だが共通化しないこと】①意味論が違う（ギフト件数 vs combo 回数）
 * うえ、0 を落とす根拠が別々の一次情報（`gift_memberships_count` の仕様 /「0 if not a combo」）で、共通ヘルパに
 * すると各々の根拠コメントが失われる。②フェーズ2 で本関数だけが `max(combo_count, 1)` の起点になり**確実に分岐する**。
 * 再修正トリガー: フェーズ2 を「対応不要」で閉じ、かつ 3 つ目の同型マッパが増えたら共通ヘルパ化を検討する。
 */
function mapComboCount(count?: number): number | undefined {
  return count != null && Number.isFinite(count) && count > 0
    ? count
    : undefined;
}
