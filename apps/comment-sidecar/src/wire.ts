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

/**
 * 060i(2026-08-09): 表示用金額文字列の数値部（桁区切りを入れる）。
 *
 * 従来はテンプレートリテラルの素の数値だったため、**本番表示が `20000 JPY`** になっていた。
 * 一方 dev-mock は `"20,000 JPY"` というカンマ付きラベルを直接組んでおり（wire.ts を通らない）、
 * 設定プレビューの見本は `"1,000 JPY"` なので、**モック／プレビューと本番で表記が食い違っていた**
 * ＝「動作確認では正しく見えるのに本番だけ桁が読みにくい」状態。ここを 1 箇所直せば全表示経路
 * （オーバーレイ課金カード／アプリ内課金カード／課金ティッカー／固定コメント帯／過去コメント）が揃う。
 *
 * ⚠⚠ **`maximumFractionDigits: 20` は必須**（既定は 3 桁）。`amount` は YouTube の `amount_micros` を
 * `/ 1_000_000` した値（`vendor/comment-fetcher/.../youtube/mapper/comment.mapper.ts`）なので理屈上
 * 小数 6 桁までありうる。既定のままだと**丸めが入って監視した金額と違う値を表示する**——
 * `monetaryAmount` は「監視済みの値をそのまま出す」文字列（`CommentList.tsx` の注記）なので、
 * 桁区切りを足すために丸めを持ち込んではならない。
 * ⚠ 読み上げ（`speechText.ts`）と集計は**この文字列を使わず数値 `monetary.amount` を見る**ので無影響。
 * ⚠ ロケールは `ja-JP` 固定。sidecar は Node SEA で公式 Node は full-icu 同梱だが、万一 ICU が縮小構成でも
 *   フォールバック先も 3 桁区切りなので破綻しない（`scripts/test-comment-relay.mjs` が期待値を固定している）。
 *
 * ⚠⚠ **desktop 側の `viewerFormat.fmtNumber` と「同じ」なのはロケールだけで、丸めは違う**
 * （security-review 060i・Q-4・2026-08-09 に明示）。あちらは `maximumFractionDigits` **未指定＝既定 3 桁**。
 * `viewerFormat.commentAmount()` は `monetaryAmount` が**空のときだけ** `fmtNumber(amount)` へ落ちるので、
 * 同じ `1234.56789 USD` が経路によって `1,234.56789 USD`（本関数）／`1,234.568 USD`（フォールバック）に
 * 分かれうる。**意図的な非対称**——本関数は「監視済みの値を verbatim」という `monetaryAmount` の契約側、
 * `fmtNumber` は視聴者メモリの集計値など「読みやすさ優先」の表示側で、要件が違う。
 * 実害が小さいのは `monetaryAmount` が通常入っているため（フォールバックは金額欠落時の保険）。
 * **再修正トリガー**: フォールバック経路で丸め差が実際に報告されたら、`commentAmount()` 側を
 * `maximumFractionDigits: 20` に揃える（`fmtNumber` 自体は集計表示で共有しているので触らないこと）。
 *
 * ⚠ **出力の長さは入力しだいで有界ではない**（security-review 060i・S-1・**受容**）。従来のテンプレート
 * リテラルは指数表記で短く済んでいた（`${1e308}` → `"1e+308"`＝6 文字）が、`toLocaleString` は
 * **411 文字**に展開する（`1e21` も 5 → 29 文字）。表示側の金額バッジは `white-space: nowrap` ＋
 * `flex-shrink: 0`（`OverlayComment.module.css` の `.amountBadge`）なので、**異常値は 060i で直した症状を
 * 金額側から再現できる**。受容の理由＝ ①`amount` は配信プラットフォーム由来の実額（`amount_micros/1e6`
 * ／bits）で、この帯域の値は上流が壊れない限り来ない ②金額バッジは課金カードにしか出ず
 * （chat 行は `monetaryAmount` を描かない＝`CommentList.tsx` の注記）、`.card { overflow: hidden }` が
 * 切るので**窓の外へは出ない**＝読めなくなるだけで封じ込めは破れない。
 * ⚠ 例外は投げない（実測: `NaN`→`"NaN"` / `±Infinity`→`"∞"`/`"-∞"` / `-0`→`"-0"`。
 * `maximumFractionDigits: 20` は ES2023 で上限が 100 へ拡張済みなので `RangeError` の懸念も無い）
 * ＝ **コメント配信パイプラインが落ちる形の失敗は起きない**。
 * **再修正トリガー**: 実際に極端な金額で表示が壊れたら、`wire.ts` で値域を弾くのではなく
 * `.amountBadge` に `max-width` ＋ `overflow: hidden` を足す（chat 側と同じ「縮められる」原則の徹底）。
 */
const fmtMonetaryAmount = (amount: number): string =>
  amount.toLocaleString("ja-JP", { maximumFractionDigits: 20 });

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
    // 060i: 数値部は桁区切り付き（`20000 JPY` → `20,000 JPY`）。⚠ 単位の綴りは変えていない
    // （BITS だけ小文字 "bits" ＝ 043a からの仕様。`test-comment-relay.mjs` が回帰で固定している）。
    const shown = fmtMonetaryAmount(amount);
    canonical.monetaryAmount =
      currency === "BITS" ? `${shown} bits` : `${shown} ${currency}`;
    // 038a: 数値 {amount, currency} も落とさず通す（視聴者メモリの回数/合計額の正確集計用）。
    canonical.monetary = { amount, currency };
  }
  return canonical;
}
