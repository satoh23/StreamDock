import type { MonetaryTone } from "./viewerFormat";
import styles from "./CommentViewerApp.module.css";
import overlayStyles from "./OverlayComment.module.css";

/**
 * 047b: `viewerFormat.ts` の `monetaryTone()` が返す配色キー → CSS クラスの対応表。
 *
 * **なぜ独立した module なのか**: 同じ表を必要とする描画側が 4 つ（`MonetaryTicker` / `MonetaryDetailDialog` /
 * `CommentList` の一覧行 / `PinnedCommentBar`）あり、どれかに置くと残り 3 つがそこへ import することになって
 * 依存の向きが不自然になる。またクラス名を持つ以上 `viewerFormat.ts`（React/CSS/DOM 非依存が契約）には置けない。
 *
 * **本体用（`TONE_CLASS`）と OBS 用（`OVERLAY_TONE_CLASS`）を 1 ファイルに並べているのは意図的**で、
 * 「tone を足したら 2 つの CSS モジュール**両方**にクラスを足す必要がある」ことを 1 画面で見えるようにするため。
 * `Record<MonetaryTone, string>` なので、キーを足して当て漏れると **typecheck が落ちる**（当て漏れの検知は
 * コメントではなく型が担保する）。
 *
 * OBS 側のクラス名（`.tier0` / `.tipBits` …）は 043c 由来でそのまま使う。本体側は 047b で新設したので
 * `.toneT0` / `.toneBits` … と tone キーに素直な名前を付けてある。
 */

/** 本体 UI（コメント一覧の課金カード・上部ティッカー・全文ダイアログ）用。 */
export const TONE_CLASS: Record<MonetaryTone, string> = {
  t0: styles.toneT0,
  t1: styles.toneT1,
  t2: styles.toneT2,
  t3: styles.toneT3,
  t4: styles.toneT4,
  t5: styles.toneT5,
  t6: styles.toneT6,
  bits: styles.toneBits,
  subscription: styles.toneSubscription,
  membership: styles.toneMembership,
  gift: styles.toneGift,
  donation: styles.toneDonation,
  jewels: styles.toneJewels,
};

/** OBS オーバーレイの投げ銭カード用（043c のクラス名を維持）。 */
export const OVERLAY_TONE_CLASS: Record<MonetaryTone, string> = {
  t0: overlayStyles.tier0,
  t1: overlayStyles.tier1,
  t2: overlayStyles.tier2,
  t3: overlayStyles.tier3,
  t4: overlayStyles.tier4,
  t5: overlayStyles.tier5,
  t6: overlayStyles.tier6,
  bits: overlayStyles.tipBits,
  subscription: overlayStyles.tipSubscription,
  membership: overlayStyles.tipMembership,
  gift: overlayStyles.tipGift,
  donation: overlayStyles.tipDonation,
  jewels: overlayStyles.tipJewels,
};
