/**
 * 063e 段 1-b: EventSub notification envelope の**修復**（`repairNotificationEvent`）。
 *
 * ## ⚠⚠ なぜ WebSocket クライアントから切り出しているのか（063e 段 2-b）
 *
 * ⚠ **`dev-mock.ts` からも呼ぶため**である。モックは「Twitch の公式ペイロードと同じ形」を
 * 本番と同じ変換チェーンに流して目視するためのもので、その先頭がこの修復である。
 * ⚠⚠ クライアント本体（`eventsub-websocket.client.ts`）は `ws` と tsyringe の `@injectable()` を
 * **モジュール評価時に**引き込むので、そこから import すると `dev-mock.ts` が掲げている
 * 「**純関数のみを import する（top-level 副作用ゼロ）**」が崩れる。⇒ 純粋な関数だけをここへ置く。
 * ⚠ 副産物として `scripts/test-eventsub-repair.mjs` から `reflect-metadata` の読み込みが要らなくなった。
 *
 * ⚠ **ここに `ws` / tsyringe / DI を持ち込まないこと**（持ち込んだ瞬間に上の理由が消える）。
 */
import type { TwitchEventSubNotificationEnvelopeDto } from "../dto/raw.dto.js";

/**
 * 063e 段 1-b: notification envelope の event を、**mapper が扱える形へ修復する**（in-place）。
 *
 * ⚠⚠⚠ **ここが「推測ではない唯一の場所」である。** mapper はイベント本体の形だけを見て種別を当てる
 * （＝推測）が、ここには **`metadata.subscription_type`＝ Twitch 自身が名乗った購読種別**がある。
 * ⇒ 形が仕様どおりでなかったとき（`user_input` が `null`、`id` が欠落）に、
 * **根拠を持って直せるのはここだけ**。
 *
 * ⚠ 043a が `channel.bits.use` の `message_id` について既に同じことをしており、これはその一般化である
 * （関数へ括り出したのは、**実ネットに出ないと再現できない修復を単体で固定するため**＝
 * `scripts/test-eventsub-repair.mjs`）。
 *
 * ⚠⚠ **やるのは「欠けている値を埋める」ことだけ**で、載っている値は 1 つも書き換えない。
 * ⚠ §9: **新しいフィールドを生やさない**（`reward` 等はここでも触らない）。
 */
export function repairNotificationEvent(
  notification: TwitchEventSubNotificationEnvelopeDto,
): void {
  // ⚠ 実行時の形は型が保証しない（WS 境界）。**素の unknown から確かめてから**触る
  //   ——ここは「仕様どおりでない値」を受け止めるための関数なので、自分が仕様を信じたら本末転倒である。
  // ⚠⚠⚠ **`payload` にも `?.` を付ける**（レビュー S-2）。上流の `isEventSubEnvelope` は
  //   `metadata.message_type` しか検査しておらず **`payload` の存在を見ていない**ので、
  //   `{"metadata":{"message_type":"notification"}}` が届くと素の `.` は TypeError になる。
  //   ⚠ 投げると `handleMessage` の catch が `streamError` を立てて**取得セッションごと落ちる**
  //   （あそこの catch は握りつぶしではない）。⇒ この関数は**自分で throw しない**を不変条件にする。
  const rawEvent: unknown = notification.payload?.event;
  if (typeof rawEvent !== "object" || rawEvent === null) {
    return;
  }
  const event = rawEvent as Record<string, unknown>;
  const metadata = notification.metadata as
    | { subscription_type?: unknown; message_id?: unknown }
    | undefined;
  const subscriptionType = metadata?.subscription_type;
  const messageId = metadata?.message_id;

  // 043a(拡張): channel.bits.use はイベント本体に一意 id を持たないため、envelope の
  // metadata.message_id を message_id として補填する（viewer_memory の dedup キー）。
  if (
    subscriptionType === "channel.bits.use" &&
    !event.message_id &&
    typeof messageId === "string" &&
    messageId !== ""
  ) {
    event.message_id = messageId;
  }

  if (
    subscriptionType === "channel.channel_points_custom_reward_redemption.add"
  ) {
    // ⚠⚠ `id` は本来イベント本体が持つ（bits.use と違う）。それでも保険を張るのは、
    //   欠けたときの壊れ方が **`record_comment` のデシリアライズ全滅（fire-and-forget ＝ 無言）**
    //   だからである（`raw.dto.ts` の `id` の注記が正）。
    if (
      (typeof event.id !== "string" || event.id === "") &&
      typeof messageId === "string" &&
      messageId !== ""
    ) {
      event.id = messageId;
    }
    // ⚠⚠⚠ `user_input` を **string へ正規化する**。`null` / キー欠落で来ても
    //   「本文が空の引き換え」として通す＝**行が静かに消えることを許さない**。
    //   ⚠ 空文字にするのであって、報酬名などで埋めるのではない（§9・段 1 は報酬を区別しない）。
    if (typeof event.user_input !== "string") {
      event.user_input = "";
    }
  }
}
