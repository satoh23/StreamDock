// 032c-b コミット2: sidecar→viewer の WS ワイヤ表現。
// Rust 正規化 CommentViewDto（ts-rs binding）と**同形**の「正規化コメント」を定義し、osareview の
// CommentViewDto（source/super_chat・monetaryAmount={currency,amount}）を viewer 表示形へ変換する。
// これにより wire = Rust ts-rs 型 = viewer 消費型が一致し、コミット1 の暫定アダプタ（commentStream.ts）を撤去できる。
import type { CommentViewDto as OsareviewCommentViewDto } from "@comment-dock/shared";

/** viewer 表示用の配信元。 */
export type CanonicalCommentSource = "twitch" | "youtube";

/** viewer 表示用のコメント種別。 */
export type CanonicalCommentEventType =
  | "chat"
  | "superchat"
  | "membership"
  | "subscription"
  | "gift"
  | "donation"
  | "jewels";

export interface CanonicalCommentAuthor {
  id: string;
  name: string;
  // 036b: 投稿者アイコンの data URI（webview が `<img>`/background-image にそのまま使える形）。未取得時は undefined。
  // Rust ワイヤ契約 CommentAuthor.avatar（ts-rs・036a）と同形。036a は UserSummaryDto/converter まで通したが
  // この wire 型（active 配信経路の実ペイロード）に無く avatar を落としていたため 036b でここに通す。
  avatar?: string;
}

/** Rust `CommentViewDto`（ts-rs）と同形の正規化コメント。 */
export interface CanonicalComment {
  id: string;
  source: CanonicalCommentSource;
  author: CanonicalCommentAuthor;
  text: string;
  publishedAt: string;
  eventType: CanonicalCommentEventType;
  monetaryAmount?: string;
  // 038a: 投げ銭の数値内訳（Rust CommentViewDto.monetary と同形）。回数/合計額の正確な集計に使う。
  // 表示用 monetaryAmount 文字列は温存しつつ、数値 {amount, currency} を落とさず通す（視聴者メモリ用）。
  monetary?: { amount: number; currency: string };
  // 043a: メンシプ／サブスク／ギフトの付随数値（Rust CommentViewDto の monthCount/giftCount/tier と同形）。
  // 表示（043b/043c）用途で通すのみ・端末保存しない・受贈者名は持たない（§9）。
  monthCount?: number;
  giftCount?: number;
  tier?: number;
  // 043e: Jewels の combo（連続ギフト）回数（Rust CommentViewDto.comboCount と同形）。
  // monthCount 等と同じく**表示用途で通すのみ・端末保存しない**。整数のみで個人情報を含まない（§9）。
  // フェーズ1 では金額計算に使わない（単価か累計かを実機で判別するための観測値）。
  comboCount?: number;
}

const EVENT_TYPE_MAP: Record<
  OsareviewCommentViewDto["eventType"],
  CanonicalCommentEventType
> = {
  normal: "chat",
  super_chat: "superchat",
  subscription: "subscription",
  // 043a: メンシプ／ギフトを種別として通す（従来は経路が無く subscription に畳まれていた）。
  membership: "membership",
  gift: "gift",
  // 043a(拡張): チャリティ・ドネーション（Twitch charity_donation）を種別として通す。
  donation: "donation",
  // 043a(拡張): YouTube Jewels。取得は 043d（現状 dev-mock のみ発行）。語彙は通しておく。
  jewels: "jewels",
};

/** osareview CommentViewDto を viewer 表示用の正規化コメントへ変換する。 */
export function toCanonicalComment(
  dto: OsareviewCommentViewDto,
): CanonicalComment {
  const canonical: CanonicalComment = {
    id: dto.id,
    source: dto.source,
    author: {
      id: dto.author.id,
      name: dto.author.name,
      // 036b: converter が data URI 化済み（未取得は undefined）。整形済み base64 data URI 保証は converter の責務。
      avatar: dto.author.avatar,
    },
    text: dto.text,
    publishedAt: dto.publishedAt,
    eventType: EVENT_TYPE_MAP[dto.eventType] ?? "chat",
    // 043a: 付随数値をそのまま通す（undefined は JSON 直列化時に落ちる＝Rust 側 None）。
    monthCount: dto.monthCount,
    giftCount: dto.giftCount,
    tier: dto.tier,
    // 043e: combo 回数もそのまま通す（undefined は JSON 直列化時に落ちる＝Rust 側 None）。
    comboCount: dto.comboCount,
  };
  if (dto.monetaryAmount) {
    const { currency, amount } = dto.monetaryAmount;
    canonical.monetaryAmount =
      currency === "BITS" ? `${amount} bits` : `${amount} ${currency}`;
    // 038a: 数値 {amount, currency} も落とさず通す（視聴者メモリの回数/合計額の正確集計用）。
    canonical.monetary = { amount, currency };
  }
  return canonical;
}
