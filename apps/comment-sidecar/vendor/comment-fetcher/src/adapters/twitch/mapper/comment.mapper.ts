import { COMMENT_EVENT_TYPES, COMMENT_SOURCES } from "@comment-dock/shared";
import type {
  Comment,
  MonetaryAmount,
} from "../../../entities/comment/comment.js";
import type {
  TwitchBitsUseEventDto,
  TwitchCharityDonationDetailsDto,
  TwitchChatMessageEventDto,
  TwitchChatNotificationEventDto,
  TwitchChatNoticeType,
} from "../dto/raw.dto.js";

type TwitchChatEventDto =
  | TwitchChatMessageEventDto
  | TwitchChatNotificationEventDto
  | TwitchBitsUseEventDto;

// 043a: subscription 系（自身の加入/継続）の notice_type。
// pay_it_forward は「贈られた分の恩送り」で従来どおり subscription 側に残す（過剰分類しない）。
// 043a(拡張): 有料化（gift_paid_upgrade＝ギフト分を自費継続／prime_paid_upgrade＝Prime→有料）も自分の
//   有料サブなので subscription 系に含める（従来は notice_type 未収載で drop されていた取りこぼし）。
const SUBSCRIPTION_NOTICE_TYPES: ReadonlySet<TwitchChatNoticeType> = new Set([
  "sub",
  "resub",
  "pay_it_forward",
  "gift_paid_upgrade",
  "prime_paid_upgrade",
]);

// 043a: ギフト（他者への贈与）を subscription から種別分離する。
const GIFT_NOTICE_TYPES: ReadonlySet<TwitchChatNoticeType> = new Set([
  "sub_gift",
  "community_sub_gift",
]);

// 043a(拡張): チャリティ実金銭ドネーション（従来は notice_type 未収載で drop されていた取りこぼし）。
const DONATION_NOTICE_TYPES: ReadonlySet<TwitchChatNoticeType> = new Set([
  "charity_donation",
]);

/**
 * 062a: レイド（他チャンネルからの視聴者流入）の notice_type。
 *
 * ⚠⚠ **`unraid` を入れてはならない**。公式の notice_type 一覧には `raid` と `unraid` が
 * **独立した値**として存在し、`unraid` は「レイドの取り消し」で記録すべきイベントではない。
 * ⚠ 判定に `Set.has`（**完全一致**）を使うのが担保の実体である——`noticeType.includes("raid")` や
 * `endsWith("raid")` のような部分一致に書き換えると **`unraid` が黙って当たる**
 * （`stripSharedChatPrefix` は `shared_chat_` しか剥がさないので `unraid` は `unraid` のまま来る）。
 * `test-twitch-mapper.mjs` が `unraid` を落とすことを固定している。
 */
const RAID_NOTICE_TYPES: ReadonlySet<TwitchChatNoticeType> = new Set(["raid"]);

const SHARED_CHAT_PREFIX = "shared_chat_";

/**
 * 043a(拡張): 共有チャット由来の `shared_chat_*` を基底 notice_type へ正規化する（例 shared_chat_sub → sub）。
 * 共有チャット中は同じ収益イベントが別 notice_type で届くため、剥がして同一に分類し取りこぼしを防ぐ。
 * ※付随オブジェクト名（sub/resub/...）は shared 版では別名（shared_chat_sub 等）で未モデル化のため、
 *   数値内訳（tier/monthCount/giftCount）は shared 経路では undefined に劣化する（分類は維持）。
 */
function stripSharedChatPrefix(
  noticeType: TwitchChatNoticeType,
): TwitchChatNoticeType {
  return noticeType.startsWith(SHARED_CHAT_PREFIX)
    ? (noticeType.slice(SHARED_CHAT_PREFIX.length) as TwitchChatNoticeType)
    : noticeType;
}

/** Twitch の sub_tier（"1000"/"2000"/"3000"）を階級番号（1/2/3）へ。未知は undefined。 */
function mapSubTier(tier?: string): number | undefined {
  switch (tier) {
    case "1000":
      return 1;
    case "2000":
      return 2;
    case "3000":
      return 3;
    default:
      return undefined;
  }
}

/**
 * 043a(拡張): charity_donation の amount（最小単位整数 value＋decimal_places）を通常単位へ変換する。
 * 例 value=550, decimal_places=2 → 5.50。変換できない値は undefined。
 */
function mapCharityAmount(
  donation?: TwitchCharityDonationDetailsDto,
): MonetaryAmount | undefined {
  if (!donation?.amount) {
    return undefined;
  }
  const { value, decimal_places, currency } = donation.amount;
  if (!Number.isFinite(value) || !Number.isFinite(decimal_places)) {
    return undefined;
  }
  return { currency, amount: value / 10 ** decimal_places };
}

/**
 * 036c: chatter_user_id からアバター URL（ドメイン値）を引く解決関数。
 * chat イベントにアバターが載らない Twitch では repository が Helix で解決して渡す。
 */
type ResolveAvatarUrl = (chatterUserId: string) => string | undefined;

/** Twitch EventSub のチャットイベント配列を共通コメント配列へ変換する。 */
export function mapTwitchChatEventsToComments(
  events: TwitchChatEventDto[],
  resolveAvatar?: ResolveAvatarUrl,
): Comment[] {
  return events
    .map((event) => mapTwitchChatEventToComment(event, resolveAvatar))
    .filter((comment): comment is Comment => comment !== null);
}

/** Twitch EventSub の単一チャットイベントを共通コメントへ変換する。 */
function mapTwitchChatEventToComment(
  event: TwitchChatEventDto,
  resolveAvatar?: ResolveAvatarUrl,
): Comment | null {
  if (isNotificationEvent(event)) {
    // 043a(拡張): 共有チャット由来の shared_chat_* を基底へ正規化してから分類する（取りこぼし防止）。
    const noticeType = stripSharedChatPrefix(event.notice_type);

    const isDonation = DONATION_NOTICE_TYPES.has(noticeType);
    const isGift = GIFT_NOTICE_TYPES.has(noticeType);
    const isSubscription = SUBSCRIPTION_NOTICE_TYPES.has(noticeType);
    // 062a: レイドは収益ではないが「誰がレイドしてくれたか」の記録のために取り込む。
    const isRaid = RAID_NOTICE_TYPES.has(noticeType);

    // 収益にもレイドにも関係しない notice（announcement / bits_badge_tier / unraid /
    // watch_streak / modiversary / unknown 等）は取り込まない。
    if (!isDonation && !isGift && !isSubscription && !isRaid) {
      return null;
    }

    if (isRaid) {
      // 062a: レイドの主体は **`raid` オブジェクト**に載る（chatter ではない）。公式は
      //   `raid.user_id` / `user_name` を「the broadcaster raiding this channel」と明記する一方、
      //   `chatter_user_*` は「the user that sent the message」としか書いておらず、raid notice で
      //   誰を指すかは**公式から確定できない**。「誰がレイドしてくれたか」として確実に正しいのは前者。
      // ⚠ 共有チャット由来（notice_type=shared_chat_raid）では公式定義どおり `raid` が null になり、
      //   同形の `shared_chat_raid` 側に載るため両方を見る（raw.dto.ts の該当コメントが理由の正）。
      const raid = event.raid ?? event.shared_chat_raid;
      // ⚠⚠ **fail-closed。`chatter_user_*` へフォールバックしない。** どちらの付随オブジェクトも
      //   無いのに chatter を採ると、**根拠のない人物を「レイドしてくれた人」として端末に保存する**
      //   ことになる（§9・保存する情報は確定した出典を持つものだけにする）。行を作らない方を採る。
      if (!raid) {
        return null;
      }
      return {
        id: event.message_id,
        source: COMMENT_SOURCES.TWITCH,
        author: {
          id: raid.user_id,
          name: raid.user_name,
          // ⚠ **アバターを解決しない**（`resolveAvatar` を呼ばない）。ペイロードの
          //   `profile_image_url` を取らないと決めた判断（raw.dto.ts）と、Helix で引き直すのは
          //   同じことなので、経路を変えて実質的に解禁するのは筋が通らない。§9 の線引きを守る。
        },
        // 043a と同じ規律: 本文は視聴者が添えたメッセージのみで、`system_message`（Twitch が生成する
        // 英語の自動文。受贈者名を含みうる）へは**フォールバックしない**。レイドでは通常空文字になる。
        text: event.message.text,
        publishedAt: new Date(),
        eventType: COMMENT_EVENT_TYPES.RAID,
        raidViewerCount: raid.viewer_count,
        // monetaryAmount は**付けない**（レイドは金銭ではない）。`viewer_comments` の
        // amount / currency / monetary_amount は常に NULL になり、課金系の集計にも入らない。
      };
    }

    // 043a: ギフト（他者贈与）は gift、チャリティは donation、それ以外
    // （sub/resub/pay_it_forward/gift_paid_upgrade/prime_paid_upgrade）は subscription。
    const eventType = isDonation
      ? COMMENT_EVENT_TYPES.DONATION
      : isGift
        ? COMMENT_EVENT_TYPES.GIFT
        : COMMENT_EVENT_TYPES.SUBSCRIPTION;

    // 043a: 階級は notice_type に応じた付随オブジェクトから拾う（受信済みフィールド・数値のみ）。
    const tier = mapSubTier(
      event.sub?.sub_tier ??
        event.resub?.sub_tier ??
        event.sub_gift?.sub_tier ??
        event.community_sub_gift?.sub_tier ??
        event.prime_paid_upgrade?.sub_tier,
    );

    return {
      id: event.message_id,
      source: COMMENT_SOURCES.TWITCH,
      author: {
        id: event.chatter_user_id,
        name: event.chatter_user_name,
        // 036c: 取得元の画像 URL（ドメイン値）。data URI 化は配信境界の converter が担う。
        avatar: resolveAvatar?.(event.chatter_user_id),
      },
      // 043b: 本文は視聴者が添えたメッセージのみ（system_message＝英語自動文へはフォールバックしない）。
      // 種別の要約は表示側（043b）が monthCount/tier/giftCount から日本語で組み立てる。system_message は
      // 受贈者名を含み得るため保存/表示に載せない（§9）。無メッセージ時は空文字＝表示側で要約のみ出す。
      text: event.message.text,
      publishedAt: new Date(),
      eventType,
      // 継続月数は resub のみ（新規 sub は 1 ヶ月目＝undefined）。ギフト件数は community=total／単発=1。
      // 【レビュー対応・修正不要】既知の二重計上（043a 以前からの既存挙動・退行ではない）: コミュニティギフト N 件は
      //   community_sub_gift(total=N) と個別 sub_gift×N の両方が届くため gift 行が N+1 個生成され、集計
      //   (subscription_count) も N+1 になる。043a は分離前と同じ集合を保っただけ。dedup(community_gift_id) は未実装で、
      //   043b の赤枠強調で重複がより目立つ点は follow-up 送り。再修正トリガー: 重複表示/計上が実運用で問題化したら
      //   community_gift_id 単位で個別 sub_gift を dedup する。
      monthCount: event.resub?.cumulative_months,
      giftCount: isGift ? (event.community_sub_gift?.total ?? 1) : undefined,
      tier,
      // 043a(拡張): チャリティは実金銭ドネーション。amount を金額として通す（サブスク/ギフトは金額なし）。
      monetaryAmount: isDonation
        ? mapCharityAmount(event.charity_donation)
        : undefined,
    };
  }

  if (isBitsUseEvent(event)) {
    // 043a(拡張): cheer は channel.chat.message で取得済のため二重計上を避けて捨てる。
    // power_up / custom_power_up（bits 消費）のみを bits 額つき superchat として取り込む。
    if (event.type === "cheer") {
      return null;
    }
    return {
      id: event.message_id,
      source: COMMENT_SOURCES.TWITCH,
      author: {
        id: event.user_id,
        name: event.user_name,
        avatar: resolveAvatar?.(event.user_id),
      },
      text: event.message?.text ?? "",
      publishedAt: new Date(),
      // ビッツ消費は既存の bits 表現（superchat＋currency="BITS"）に合わせる（別種別化しない）。
      eventType: COMMENT_EVENT_TYPES.SUPER_CHAT,
      monetaryAmount: mapBitsToMonetaryAmount(event.bits),
    };
  }

  return {
    id: event.message_id,
    source: COMMENT_SOURCES.TWITCH,
    author: {
      id: event.chatter_user_id,
      name: event.chatter_user_name,
      // 036c: 取得元の画像 URL（ドメイン値）。data URI 化は配信境界の converter が担う。
      avatar: resolveAvatar?.(event.chatter_user_id),
    },
    text: event.message.text,
    publishedAt: new Date(),
    eventType:
      event.cheer && event.cheer.bits > 0
        ? COMMENT_EVENT_TYPES.SUPER_CHAT
        : COMMENT_EVENT_TYPES.NORMAL,
    monetaryAmount: mapBitsToMonetaryAmount(event.cheer?.bits),
  };
}

function isNotificationEvent(
  event: TwitchChatEventDto,
): event is TwitchChatNotificationEventDto {
  return "notice_type" in event;
}

/** 043a(拡張): channel.bits.use のイベント（トップレベル数値 bits を持つ）を判別する。 */
function isBitsUseEvent(
  event: TwitchChatEventDto,
): event is TwitchBitsUseEventDto {
  return (
    !("notice_type" in event) &&
    "bits" in event &&
    typeof (event as TwitchBitsUseEventDto).bits === "number"
  );
}

function mapBitsToMonetaryAmount(bits?: number): MonetaryAmount | undefined {
  if (!bits || bits <= 0) {
    return undefined;
  }

  return {
    currency: "BITS",
    amount: bits,
  };
}
