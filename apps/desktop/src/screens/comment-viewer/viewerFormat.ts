/**
 * 038b: 視聴者ビューの純粋な表示整形ヘルパ（React/CSS/DOM 非依存）。
 *
 * ViewersView から「ロジックのある純関数」だけを切り出したもの。CSS モジュール（styles）に依存する
 * providerClass や、ViewerSort 型に紐づく SORT_LABEL は UI 側（ViewersView）に残し、この module は
 * 依存ゼロ＝プレーン Node から import して単体テストできる状態に保つ（scripts/test-viewer-format.mjs）。
 * 端末外へは何も出さない（表示整形のみ）。
 */

/** 配信元の表示ラベル（CommentList の SOURCE_LABEL と同型・provider 文字列のまま fallback）。 */
export const PROVIDER_LABEL: Record<string, string> = {
  twitch: "Twitch",
  youtube: "YouTube",
};

/** 過去コメントの特別イベントだけ日本語ラベルを付ける（通常チャット等・未知の種別はラベル無しで無害に劣化）。 */
export const EVENT_LABEL: Record<string, string> = {
  superchat: "スーパーチャット",
  bits: "ビッツ",
  subscription: "サブスク",
  membership: "メンバーシップ",
  // 043a: ギフト（Twitch sub_gift/community_sub_gift）を種別分離したため、視聴者詳細パネルの空ラベルを回避。
  gift: "ギフト",
  // 043a(拡張): チャリティ・ドネーション（Twitch charity_donation）を種別分離したため空ラベルを回避。
  donation: "ドネーション",
  // 043a(拡張): YouTube Jewels（取得は 043d・現状 dev-mock のみ）。空ラベルを回避。
  jewels: "ジュエル",
};

/** 既知の provider は日本語表示名、未知はそのまま（fallback）。 */
export const providerLabel = (p: string): string => PROVIDER_LABEL[p] ?? p;

/** 既知のイベント種別だけラベル化、未知は空文字（ラベル無しで劣化）。 */
export const eventLabel = (eventType: string): string =>
  EVENT_LABEL[eventType] ?? "";

/**
 * 043b: お金がかかる（強調＝赤枠の対象）イベント種別。chat/normal 以外はすべて課金系として扱う。
 * ビッツは event_type=superchat（currency=BITS）で届くため superchat に含まれる。
 */
export const MONETARY_EVENT_TYPES: ReadonlySet<string> = new Set([
  "superchat",
  "subscription",
  "membership",
  "gift",
  "donation",
  "jewels",
]);

/** 043b: お金がかかる種別か（chat/未知は false）。true のとき本体で赤枠強調する。 */
export const isMonetaryEvent = (eventType: string): boolean =>
  MONETARY_EVENT_TYPES.has(eventType);

/**
 * 043b: 表示ラベル用の実効種別。ビッツは event_type=superchat＋currency=BITS で届くため、
 * ラベルだけ "bits"（＝「ビッツ」）へ振り分ける。それ以外は eventType のまま。
 */
export interface DisplayEventTypeInput {
  eventType: string;
  monetary?: { currency: string };
}

export const displayEventType = (c: DisplayEventTypeInput): string =>
  c.eventType === "superchat" && c.monetary?.currency === "BITS"
    ? "bits"
    : c.eventType;

/**
 * 043c: YouTube スーパーチャットの金額ティア（0=青…6=赤）を近似で求める純関数。
 * オーバーレイの投げ銭カードの配色に使う（superchat・実通貨のときだけ・bits/他種別は種別単色で本関数を通さない）。
 *
 * 通貨換算はしない（038 の領分・スコープ外）。通貨コードで 2 系統の閾値表を引くだけ＝
 * 大単位通貨（JPY 等・小数なし）と 小単位通貨（USD/EUR 等）で桁が ~100 倍違うため 2 表で近似する。
 * 未知通貨は小単位表にフォールバック。境界未満（例 ¥50）でも最低ティア0（青）にする。
 */
const TIER_THRESHOLDS_LARGE = [100, 200, 500, 1000, 2000, 5000, 10000] as const; // JPY 系
const TIER_THRESHOLDS_SMALL = [1, 2, 5, 10, 20, 50, 100] as const; // USD/EUR 系

/** 小数を持たない大単位通貨（¥100 が最下ティア境界の系統）。未収載は小単位表にフォールバック。
 *  【レビュー対応・修正不要】XAF/XOF/PYG/RWF/UGX 等の小数なし通貨は未収載＝小単位表でティアが過大に出るが、
 *  影響はカードのヘッダ色（装飾）だけで金額バッジ（monetaryAmount を verbatim 表示）は常に正確なため近似として許容。
 *  再修正トリガー: スパチャ配色の忠実度を上げたくなったら該当通貨を本 Set に追加する（換算は 038 の領分で不要）。 */
const LARGE_UNIT_CURRENCIES: ReadonlySet<string> = new Set([
  "JPY",
  "KRW",
  "VND",
  "CLP",
  "ISK",
  "HUF",
  "TWD",
  "IDR",
]);

export const superchatTier = (amount: number, currency: string): number => {
  const table = LARGE_UNIT_CURRENCIES.has(currency.toUpperCase())
    ? TIER_THRESHOLDS_LARGE
    : TIER_THRESHOLDS_SMALL;
  // amount >= table[i] を満たす最大の i（0..6）。境界未満でもティア0にクランプ。
  // 異常系（0/負値/NaN）は比較が全 false でティア0へ無害劣化し、上限超えは最上ティアに飽和する（クラッシュしない）。
  let tier = 0;
  for (let i = 0; i < table.length; i++) {
    if (amount >= table[i]) tier = i;
  }
  return tier;
};

/**
 * 043b: 金額を持たない課金イベント（サブスク/メンシプ/ギフト）を「〇〇さんが…しました」の日本語文へ組み立てる。
 * 金額を持つ種別（superchat/bits/donation/jewels）や chat/未知は null を返し、呼び出し側は種別ラベル＋金額バッジ＋
 * 本文で表示する（重複した金額文言を避けるため文は作らない）。純関数（DOM/CSS 非依存・端末外へ出さない）。
 */
export interface EventMessageInput {
  eventType: string;
  /**
   * 043d: 配信元（"youtube" | "twitch"）。gift の呼び名が配信元で異なるため受け取る。
   * 未指定は Twitch 語彙（従来の挙動）へフォールバックする。呼び出し側は CommentViewDto を丸ごと
   * 渡しており source を含むため、引数の変更は不要。
   *
   * 043d(レビュー指摘・2026-07-27／修正不要と判断): 任意にしたため渡し忘れると黙って Twitch 語彙に
   * なる。それでも許容するのは、呼び出しが CommentList.tsx の 2 箇所のみでどちらも CommentViewDto
   * （source 必須）を丸ごと渡しており、かつ「source 未指定＝サブギフト」をテストで固定してあるため
   * （既存 CommentAmountInput と同種のレビュー済みトレードオフ）。
   * 再修正トリガー: CommentViewDto 以外のオブジェクトを組み立てて渡す呼び出しが増えたら、必須化するか
   * `source?: CommentSource`（union）へ狭めてタイポと渡し忘れを型で弾くこと。
   */
  source?: string;
  author: { name: string };
  monthCount?: number;
  giftCount?: number;
  tier?: number;
}

export const composeEventMessage = (c: EventMessageInput): string | null => {
  const name = c.author.name;
  const tierSuffix = c.tier != null ? `（Tier${c.tier}）` : "";
  switch (c.eventType) {
    case "subscription":
      return c.monthCount != null
        ? `${name}さんがサブスクを${c.monthCount}ヶ月継続しました${tierSuffix}`
        : `${name}さんがサブスクに加入しました${tierSuffix}`;
    case "membership":
      return c.monthCount != null
        ? `${name}さんがメンバーシップを${c.monthCount}ヶ月継続しました`
        : `${name}さんがメンバーシップに加入しました`;
    case "gift": {
      // 043d: YouTube の gift は MEMBERSHIP_GIFTING_EVENT（メンバーシップギフトの贈与側）で届くため
      // 「サブギフト」では文言が誤る。YouTube 側は tier を持たないので tierSuffix は自然に空になる。
      const giftWord =
        c.source === "youtube" ? "メンバーシップギフト" : "サブギフト";
      return c.giftCount != null
        ? `${name}さんが${giftWord}を${c.giftCount}件贈りました${tierSuffix}`
        : `${name}さんが${giftWord}を贈りました${tierSuffix}`;
    }
    default:
      return null;
  }
};

/** RFC3339 文字列をローカル表記へ。パースできなければ原文のまま返す（端末外へは出さないローカル表示）。 */
export const fmtDateTime = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("ja-JP");
};

export const fmtNumber = (n: number): string => n.toLocaleString("ja-JP");

/** スパチャ額（f64）＋通貨。通貨が無ければ額のみ。 */
export const fmtSuperchat = (amount: number, currency?: string): string =>
  currency ? `${fmtNumber(amount)} ${currency}` : fmtNumber(amount);

/**
 * 過去コメント 1 件の投げ銭表示（整形済み文字列があれば優先、無ければ数値＋通貨、いずれも無ければ null）。
 * ViewerCommentRecord の構造部分集合を受ける（bindings 型に依存させず、この module を純粋に保つため）。
 *
 * 【レビュー：型安全のトレードオフ】全フィールドが optional なので、キー名が食い違うオブジェクトを渡しても
 * 型エラーにならず黙って null（＝金額バッジ非表示）に劣化する。現時点は ViewerCommentRecord の
 * `amount?/currency?/monetaryAmount?` と一致を確認済み。【再修正トリガー】bindings のキー名を変える改修が入ったら、
 * viewerFormat.test に「実 ViewerCommentRecord 型注釈付きのオブジェクト」を通すケースを 1 件足し、リネームを
 * コンパイルで検知できるようにする（viewerIdOf は呼び出し側が完全な DTO を渡すため名前不一致はコンパイルで捕まる）。
 */
export interface CommentAmountInput {
  monetaryAmount?: string;
  amount?: number;
  currency?: string;
}

export const commentAmount = (c: CommentAmountInput): string | null => {
  if (c.monetaryAmount) return c.monetaryAmount;
  if (c.amount != null) {
    return c.currency ? `${fmtNumber(c.amount)} ${c.currency}` : fmtNumber(c.amount);
  }
  return null;
};

/**
 * 038b フォローアップ: 流れているコメント（CommentViewDto の構造部分集合）から視聴者の安定キー
 * `provider:providerUserId` を導出する。Rust の record_comment（viewer_memory/service.rs）と同じ規則＝
 * source（"twitch"|"youtube"）と author.id を trim して連結する。これによりコメントをクリック→getViewer(id) で
 * 詳細を引ける。Rust 側 key と完全一致させるため **trim 必須**（bindings 型に依存させず構造部分集合を受ける）。
 */
export interface ViewerIdSource {
  source: string;
  author: { id: string };
}

export const viewerIdOf = (c: ViewerIdSource): string =>
  `${c.source}:${c.author.id.trim()}`;
