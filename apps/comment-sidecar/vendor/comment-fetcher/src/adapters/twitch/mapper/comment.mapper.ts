import { COMMENT_EVENT_TYPES, COMMENT_SOURCES } from "@comment-dock/shared";
import type {
  Comment,
  MonetaryAmount,
} from "../../../entities/comment/comment.js";
import type {
  TwitchBitsUseEventDto,
  TwitchChannelPointsRedemptionEventDto,
  TwitchCharityDonationDetailsDto,
  TwitchChatMessageEventDto,
  TwitchChatNotificationEventDto,
  TwitchChatNoticeType,
} from "../dto/raw.dto.js";

type TwitchChatEventDto =
  | TwitchChatMessageEventDto
  | TwitchChatNotificationEventDto
  | TwitchBitsUseEventDto
  // 063e: チャンネルポイントの引き換え。
  | TwitchChannelPointsRedemptionEventDto;

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

  if (isChannelPointsRedemptionEvent(event)) {
    // 063e: チャンネルポイントの引き換えを**コメント 1 件**として取り込む。
    // ⚠ **金額は付けない**（`monetaryAmount` を undefined のままにする）。チャンネルポイントは
    //   お金ではないので、`viewer_comments` の amount / currency / monetary_amount は常に NULL になり、
    //   課金系の集計にも配色にも入らない（レイドとまったく同じ扱い＝穴 A）。
    // ⚠⚠⚠ **063e 段 3: 報酬名（`reward.title`）を消費するようになった**（段 1 の線を意図的にまたいだ）。
    //   理由は `raw.dto.ts` の `reward` の注記が正＝**「ガチャ用の報酬だけに反応させる」材料が他に無い**。
    //   ⚠ 取るのは `title` **だけ**（`id` / `cost` / `prompt` / `status` / `redeemed_at` は今も取らない）。
    return {
      id: event.id,
      source: COMMENT_SOURCES.TWITCH,
      author: {
        id: event.user_id,
        name: event.user_name,
        // 036c: 取得元の画像 URL（ドメイン値）。data URI 化は配信境界の converter が担う。
        // ⚠ レイド（062a）と違いアバターを解決する。あちらが解決しないのは
        //   「ペイロードの `profile_image_url` を取らないと決めたのに Helix で引き直すのは筋が通らない」
        //   という §9 の線引きによるもので、ここは**通常のコメントと同じ投稿者**（引き換えた視聴者）なので
        //   chat / bits.use と同じ扱いにするのが一貫している。
        avatar: resolveAvatar?.(event.user_id),
      },
      // ⚠⚠ **本文は `user_input` のみ**。テキスト入力を求めない報酬では**空文字**になる
      //   （報酬名で埋めない＝043a が `system_message` へフォールバックしないと決めたのと同じ規律）。
      //   空文字のときに配信画面へ「名前だけの空の吹き出し」を出さない担保は `CommentList.tsx` にある。
      // ⚠⚠⚠ 063e 段 1-b: **`string` でなければ空文字へ倒す。** `null` / キー欠落が来ても
      //   「本文が空の引き換え」として通す＝行を静かに消さない（`raw.dto.ts` の `user_input` の注記が正）。
      //   ⚠ ここが `event.user_input` の素通しだと、`text: null` が wire へ出て
      //   **Rust の `CommentViewDto.text: String` でデシリアライズが DTO ごと失敗する**
      //   （`record_comment` は fire-and-forget ＝ 画面には何も出ない）。
      text: typeof event.user_input === "string" ? event.user_input : "",
      publishedAt: new Date(),
      eventType: COMMENT_EVENT_TYPES.CHANNELPOINT,
      // ⚠⚠ **非文字列・空文字・欠落はすべて `undefined` へ倒す**（`user_input` と同じ規律）。
      //   ⚠ 空文字を通さないのは、`when.rewardTitle` 側も空を「未指定（＝すべての報酬）」として扱うため
      //   ——通すと「名前が空の報酬」と「報酬を指定していない条件」が**同じ値で出会って当たってしまう**。
      //   ⇒ 報酬名が取れない引き換えは「**報酬を指定した条件には当たらない**」に倒れる（安全側）。
      rewardTitle:
        typeof event.reward?.title === "string" && event.reward.title !== ""
          ? event.reward.title
          : undefined,
    };
  }

  // ⚠⚠⚠ 063e: **ここから下（chat フォールバック）へ「形を知らないイベント」を落とさないこと。**
  //   この分岐は `event.message.text` / `event.chatter_user_id` を無条件に読むので、
  //   それらを持たないイベントが来ると **TypeError を throw** する。throw は
  //   `TwitchCommentRepository.streamComments` の for-await を抜けて `runTwitchPipeline` の catch まで上がり、
  //   **コメント取得セッションが `failed` で死ぬ**（＝本線が止まる）。
  //   ⚠ 購読側の `.catch(() => {})`（非致命化）が守るのは**購読作成の失敗だけ**で、ここは守らない。
  //   ⇒ **未知の形は「行を作らない」（null）へ倒す**。非致命化と同じ向きの劣化であり、
  //     043a / 062a が「取り込まない notice は null」としてきた既存の作法とも一致する。
  if (!isChatMessageEvent(event)) {
    return null;
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

/**
 * 063e: チャンネルポイント引き換えのイベントを判別する。
 *
 * ## ⚠⚠⚠ 段 1-b: **判定材料から `user_input` を外した**（これが「穴 H'」の対処そのもの）
 *
 * 段 1 は `typeof user_input === "string"` を判定材料にしていた。⚠ それは
 * **「引き換えが 1 件も出ない」に直結する単一障害点**だった:
 *   `user_input` が `null` ／ キー欠落で 1 度でも来ると
 *   → この判定が false → 下の fail-safe（`isChatMessageEvent`）も false
 *   → **`null`（行を作らない）に落ちて静かに消える**。
 * ⚠ しかも本文の値が種別の判定を左右するという結び付き自体が読めない（本文は本文であるべき）。
 * ⚠⚠ 依頼者は実機で確認できない（チャンネルポイントは新規チャンネルでは有効化できない）ので、
 *   **「公式仕様どおりに来るはず」に賭けない**——賭けて外したときの症状が「無言」だからである。
 *
 * ## 何で判定しているか（4 種別の**構造的な差**）
 *
 * | イベント | notice_type | message_id | bits | id | user_id | chatter_user_id |
 * |---|---|---|---|---|---|---|
 * | chat.message      | ✗ | ✓ | ✗ | ✗ | ✗ | ✓ |
 * | chat.notification | ✓ | ✓ | ✗ | ✗ | ✗ | ✓ |
 * | bits.use          | ✗ | ✓(補填) | ✓ | ✗ | ✓ | ✗ |
 * | **引き換え**      | ✗ | ✗ | ✗ | **✓** | **✓** | ✗ |
 *
 * ⇒ **トップレベルの `id` ＋ `user_id`** を両方持つのは引き換えだけ。どちらも
 * **必須で、本文ではなく、視聴者が値を左右できない**（`user_input` と違う 3 点）。
 * ⚠ `bits` を見なくてよいのは、`isBitsUseEvent` が**この関数より先に**走るからである
 *   ——**呼び出し順を入れ替えないこと**（入れ替えると、将来 `id` を持った bits.use が
 *   引き換えとして取り込まれ、bits 額が消える）。
 *
 * ⚠ さらに `repairNotificationEvent`（`eventsub-websocket.client.ts`）が受信直後に
 *   `metadata.subscription_type` を根拠として `id` を補填するので、**Twitch が `id` を落としても**
 *   ここは当たる。⇒ 判定は「形の推測」だが、その形は上流で担保されている。
 *
 * ## ⚠⚠ 購読を増やすときの手順
 *
 * `subscribeChatEvents` に 5 つ目の購読を足すと、そのイベントも**この mapper に流れてくる**。
 * ⇒ **上の表に行を足し、既存の判別と衝突しないことを確かめること。** とくにトップレベルの
 * `id` と `user_id` を**両方**持つイベントを足すと、**ここに吸い込まれて「チャンネルポイント」として
 * 保存される**（本文は空になる）。⚠ 壊れ方は「行が消える」ではなく「別種別として静かに残る」である。
 * ⚠ 衝突するなら、判別を形の推測から `metadata.subscription_type` の受け渡しへ切り替えること
 * （＝mapper の入力に購読種別を添える。段 1-b では 4 種別で衝突が無いため見送っている）。
 *
 * ⚠ **`!("notice_type" in event)` は今は冗長**（`mapTwitchChatEventToComment` が
 * `isNotificationEvent` を先に評価して return するため、外しても現在の挙動は変わらない）。
 * それでも残すのは、`isBitsUseEvent` が同じ形の除外を持っており、**判定の順序を入れ替えた瞬間に
 * `notice_type` 付きイベント（サブスク・レイド等）を横取りする**からである。
 * ⚠ 冗長さの理由が源コードにしか無いので、`test-twitch-mapper.mjs` の静的検査が残存を固定している。
 */
function isChannelPointsRedemptionEvent(
  event: TwitchChatEventDto,
): event is TwitchChannelPointsRedemptionEventDto {
  const candidate = event as Partial<TwitchChannelPointsRedemptionEventDto>;
  return (
    !("notice_type" in event) &&
    typeof candidate.id === "string" &&
    candidate.id !== "" &&
    typeof candidate.user_id === "string" &&
    candidate.user_id !== ""
  );
}

/**
 * 063e: chat フォールバックが読むフィールドを**実際に持っている**ことを確かめる fail-safe。
 *
 * ⚠⚠ **これは型のためではなく、実行時に throw しないためのガードである。** 上の 3 つの判別を
 * すり抜けたイベント（＝将来 purchase された購読・仕様変更で形が変わったイベント）が
 * `event.message.text` に当たると TypeError になり、**コメント取得セッションごと落ちる**。
 * ⚠ 見るのは `chatter_user_id`（author）と `message.text`（本文）＝**下で無条件に読む 2 つだけ**。
 * 増やすと「chat なのに弾かれる」誤検知が増えるので、**読む場所と一致させ続けること**。
 */
function isChatMessageEvent(
  event: TwitchChatEventDto,
): event is TwitchChatMessageEventDto {
  const candidate = event as Partial<TwitchChatMessageEventDto>;
  return (
    typeof candidate.chatter_user_id === "string" &&
    typeof candidate.message?.text === "string"
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
