// 062a: Twitch の受信面（EventSub の生ペイロード → DTO → mapper）の単体検証。
// dist（tsc 出力）から mapper を import し、素の assert で表明する
// （test-youtube-mapper.mjs / test-comment-relay.mjs と同じ体裁。テストフレームワークは足さない）。
//
//   pnpm --filter @stream-dock/comment-sidecar build:tsc
//   node apps/comment-sidecar/scripts/test-twitch-mapper.mjs
//
// 何を担保するか（＝仕様としてこうあるべき）:
//   A. **レイド（notice_type=raid）を取り込む**。author はレイド元の配信者、人数は raid.viewer_count。
//   B. **拾いすぎない**。とくに `unraid` は `raid` と字面が似ているだけの**別イベント**なので落とす。
//   C. **§9**: `system_message`（英語自動文・受贈者名を含みうる）と `profile_image_url`
//      （⚠ ペイロードに**実在するが取り込まないと決めた**もの）が出力に 1 バイトも現れない。
//   D. **金銭ではない**。`monetaryAmount` は付かない（＝課金系の集計・表示に載らない）。
//   E. **既存の収益分類を壊していない**（sub / charity_donation / cheer の回帰）。
//
// ⚠ 本テストは mapper が返す `Comment` までしか見ない。**その先（converter → CommentViewDto → wire.ts）で
//   値が静かに落ちる事故**は `test-comment-relay.mjs` が担保する（036b の avatar と同型の落ち方）。
//
// 出典（フィールド名・意味・notice_type の取りうる値）:
//   https://dev.twitch.tv/docs/eventsub/eventsub-reference/ の Channel Chat Notification Event
//   - raid.user_id / user_name / user_login … "the broadcaster raiding this channel"
//   - raid.viewer_count … "The number of viewers in the raid."
//   - raid.profile_image_url … "Profile image URL of the broadcaster raiding this channel."
//   - raid … "Information about the raid event. Null if notice_type is not raid"
//   - notice_type には `raid` と **`unraid` が独立した値として**存在する
//
// dist の JS は `@comment-dock/*` の path alias を保持したまま emit されるため、
// dist-alias-loader.mjs を resolve フックとして登録する（登録後に動的 import する必要がある）。
import { register } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

register("./dist-alias-loader.mjs", import.meta.url);

const { mapTwitchChatEventsToComments } = await import(
  "../dist/vendor/comment-fetcher/src/adapters/twitch/mapper/comment.mapper.js"
);

let failures = 0;
const ok = (label, actual, expected) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`PASS ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL ${label}\n  expected: ${e}\n  actual:   ${a}`);
  }
};

/**
 * `channel.chat.notification` の event ペイロード（実ペイロードの形をそのまま置く）。
 *
 * ⚠ **`system_message` と `profile_image_url` を必ず入れておく**——「取り込まない」ことを
 * 検証する対象なので、fixture から抜くと**テストが何も守らなくなる**（入っていて落ちることが仕様）。
 */
const notification = (over = {}) => ({
  broadcaster_user_id: "b1",
  broadcaster_user_login: "broadcaster",
  broadcaster_user_name: "Broadcaster",
  // ⚠ raid では chatter が誰を指すか公式から確定できないので、**採らないこと**を検証するために
  //   レイド元とは別人の値を入れておく（誤って chatter を採ると下のアサートで名前が現れて落ちる）。
  chatter_user_id: "chatter-id-should-not-be-used",
  chatter_user_login: "chatter_login",
  chatter_user_name: "ChatterShouldNotBeUsed",
  chatter_is_anonymous: false,
  color: "#000000",
  badges: [],
  system_message: "SomeRaider is raiding with a party of 42.",
  message_id: "m1",
  message: { text: "", fragments: [] },
  notice_type: "raid",
  ...over,
});

/** raid / shared_chat_raid の付随オブジェクト（公式の 5 フィールドすべてを置く）。 */
const raidDetails = (over = {}) => ({
  user_id: "raider-1",
  user_name: "RaiderChannel",
  user_login: "raiderchannel",
  viewer_count: 42,
  profile_image_url: "https://static-cdn.jtvnw.net/raider-avatar.png",
  ...over,
});

/** 1 件のイベントを mapper に通し、Comment（採用時）か null（drop 時）を返す。 */
const mapOne = (event) => mapTwitchChatEventsToComments([event])[0] ?? null;

// ---------------------------------------------------------------------------
// A. レイドを取り込む
// ---------------------------------------------------------------------------
{
  const c = mapOne(notification({ raid: raidDetails() }));
  ok("raid: eventType は raid", c?.eventType, "raid");
  ok("raid: レイド人数が入る", c?.raidViewerCount, 42);
  // ⚠⚠ **差 C の核心**: author は chatter ではなく `raid.user_*`。公式が
  //   「the broadcaster raiding this channel」と明記しているのはこちらだけである。
  ok("raid: author.id は raid.user_id（chatter ではない）", c?.author.id, "raider-1");
  ok("raid: author.name は raid.user_name（chatter ではない）", c?.author.name, "RaiderChannel");
  ok("raid: id は message_id（dedup キー）", c?.id, "m1");
  ok("raid: source は twitch", c?.source, "twitch");
}

// ⚠ author に chatter 側の値が**一切**混ざっていないことを、フィールドを名指しせず出力全体で見る
//   （将来 author 以外の場所へ chatter を足したときも落ちる網）。
{
  const c = mapOne(notification({ raid: raidDetails() }));
  const asJson = JSON.stringify(c);
  ok(
    "raid(差 C): chatter 側の表示名が出力のどこにも現れない",
    asJson.includes("ChatterShouldNotBeUsed"),
    false,
  );
  ok(
    "raid(差 C): chatter 側の ID が出力のどこにも現れない",
    asJson.includes("chatter-id-should-not-be-used"),
    false,
  );
}

// ---------------------------------------------------------------------------
// C. §9: 持ち回らないもの（**在るのに取らない**ことの担保）
// ---------------------------------------------------------------------------
{
  const c = mapOne(notification({ raid: raidDetails() }));
  const asJson = JSON.stringify(c);
  // ⚠⚠ `profile_image_url` は**ペイロードに実在する**（穴 D）。「無いから載らない」のではなく
  //   「在るが DTO に宣言せず消費もしない」という判断の担保である。
  ok("raid(§9): アバター取得元 URL が現れない", asJson.includes("jtvnw"), false);
  ok("raid(§9): http(s) URL が 1 つも現れない", /https?:\/\//.test(asJson), false);
  ok("raid(§9): author.avatar は解決しない（Helix で引き直さない）", c?.author.avatar, undefined);
  // ⚠ `system_message` は英語の自動文で受贈者名を含みうる（043a の規律）。本文へフォールバックしない。
  ok("raid(§9): text は message.text のまま（system_message へ落ちない）", c?.text, "");
  ok("raid(§9): system_message の断片が現れない", asJson.includes("is raiding"), false);
}

// 視聴者が本文を添えていれば、それは従来どおり本文として通る（system_message とは別物）。
{
  const c = mapOne(
    notification({
      raid: raidDetails(),
      message: { text: "遊びに来たよ", fragments: [] },
    }),
  );
  ok("raid: 視聴者が添えた本文は通す", c?.text, "遊びに来たよ");
}

// ---------------------------------------------------------------------------
// D. レイドは金銭ではない
// ---------------------------------------------------------------------------
{
  const c = mapOne(notification({ raid: raidDetails() }));
  ok("raid: monetaryAmount は付かない（課金扱いしない）", c?.monetaryAmount, undefined);
  ok("raid: monthCount は付かない", c?.monthCount, undefined);
  ok("raid: giftCount は付かない", c?.giftCount, undefined);
  ok("raid: tier は付かない", c?.tier, undefined);
}

// ---------------------------------------------------------------------------
// A'. shared_chat_raid（共有チャット由来）
// ---------------------------------------------------------------------------
// ⚠ 公式は `raid` を「Null if notice_type is not raid」と定義しており、shared 版では **`raid` が null で
//   `shared_chat_raid` に同形で載る**。043a は shared_* の付随オブジェクトを未モデル化にして
//   「数値内訳だけ undefined へ劣化・分類は維持」としたが、レイドでは付随オブジェクトが **author 本体**を
//   持つため、劣化させると「名前も ID も無いレイド行」になり**行が成立しない**。だから両方を見る。
{
  const c = mapOne(
    notification({
      notice_type: "shared_chat_raid",
      raid: undefined,
      shared_chat_raid: raidDetails({ user_id: "raider-2", user_name: "SharedRaider", viewer_count: 7 }),
    }),
  );
  ok("shared_chat_raid: 接頭辞を剥がして raid として扱う", c?.eventType, "raid");
  ok("shared_chat_raid: author が消えない", c?.author.name, "SharedRaider");
  ok("shared_chat_raid: 人数も劣化しない", c?.raidViewerCount, 7);
}

// ⚠⚠ **fail-closed**: notice_type は raid なのに付随オブジェクトが無い（形が変わった／未知の shared 版）
//   場合は **行を作らない**。`chatter_user_*` へフォールバックすると、根拠のない人物を
//   「レイドしてくれた人」として端末に保存することになる（§9）。
{
  ok(
    "raid(fail-closed): raid も shared_chat_raid も無ければ行を作らない",
    mapOne(notification({ notice_type: "raid" })),
    null,
  );
  ok(
    "raid(fail-closed): shared_chat_raid で付随オブジェクトが無くても行を作らない",
    mapOne(notification({ notice_type: "shared_chat_raid" })),
    null,
  );
}

// ---------------------------------------------------------------------------
// B. 拾いすぎない（穴 E）
// ---------------------------------------------------------------------------
// ⚠⚠ **`unraid` は `raid` ではない**（公式の notice_type 一覧に独立して存在する）。
//   判定を `Set.has`（完全一致）から `includes("raid")` / `endsWith("raid")` のような部分一致へ
//   書き換えると **`unraid` が黙って当たる**ので、その変異をここで殺す。
//   ⚠ 実ペイロードに合わせて `unraid` オブジェクトも付けておく（付いていても落ちること）。
for (const [label, event] of [
  ["unraid", notification({ notice_type: "unraid", raid: undefined, unraid: {} })],
  // ⚠ `shared_chat_unraid` は公式の notice_type 一覧に**存在しない**が、DTO は `(string & {})` の
  //   フォールバックを持つので届きうる。接頭辞を剥がすと `unraid` になり、同じく落ちること。
  ["shared_chat_unraid", notification({ notice_type: "shared_chat_unraid", raid: undefined })],
  ["announcement", notification({ notice_type: "announcement", raid: undefined })],
  ["bits_badge_tier", notification({ notice_type: "bits_badge_tier", raid: undefined })],
  ["watch_streak", notification({ notice_type: "watch_streak", raid: undefined })],
  ["modiversary", notification({ notice_type: "modiversary", raid: undefined })],
  ["shared_chat_announcement", notification({ notice_type: "shared_chat_announcement", raid: undefined })],
  ["unknown", notification({ notice_type: "unknown", raid: undefined })],
]) {
  ok(`drop: ${label} は取り込まない`, mapOne(event), null);
}

// ⚠⚠ **穴 E を実際に殺しているのはこの 1 ケースだけである**（変異で実測した結果）。
//
//   レイドの取り込みは 2 層で縛られている:
//     (1) `RAID_NOTICE_TYPES.has(noticeType)` … **受信した notice_type 側**の限定
//     (2) `if (!raid) return null`            … **付随オブジェクトが在るか**の fail-closed
//   上の一覧（付随オブジェクト無しの `unraid` 等）は **(2) だけでも落ちる**ので、
//   (1) に `"unraid"` を足す変異を撃っても**緑のまま通ってしまう**（実測で確認済み）。
//   ＝ (1) を単独で検証できるのは「**unraid なのに raid オブジェクトが付いている**」この形だけ。
//   043e が `stored_non_jewels_row_is_not_updated_by_incoming_jewels` /
//   `stored_jewels_row_is_not_updated_by_incoming_non_jewels` の 2 本で「二重の縛りの各層を
//   片方だけ外しても検知できる」ようにしたのと同じ考え方である。
//   ⚠ 上の一覧を「(1) の担保」と読み違えないこと——あちらが守っているのは
//   「**拾いすぎない**（そもそも収益でも raid でもない notice を採らない）」という別の性質。
//   ⚠ 判定を `endsWith("raid")` / `includes("raid")` へ書き換える変異も、ここだけが殺す（実測済み）。
{
  ok(
    "drop: unraid は raid オブジェクトが付いていても取り込まない（notice_type 側の限定を単独で検証）",
    mapOne(notification({ notice_type: "unraid", raid: raidDetails() })),
    null,
  );
}

// ---------------------------------------------------------------------------
// E. 既存の収益分類の回帰（062a が 043a の挙動を壊していないこと）
// ---------------------------------------------------------------------------
{
  const c = mapOne(
    notification({
      notice_type: "sub",
      raid: undefined,
      sub: { sub_tier: "2000", is_prime: false, duration_months: 1 },
    }),
  );
  ok("回帰: sub は subscription のまま", c?.eventType, "subscription");
  ok("回帰: sub の tier は 2", c?.tier, 2);
  ok("回帰: sub にレイド人数は付かない", c?.raidViewerCount, undefined);
}

{
  const c = mapOne(
    notification({
      notice_type: "charity_donation",
      raid: undefined,
      charity_donation: {
        charity_name: "Some Charity",
        amount: { value: 550, decimal_places: 2, currency: "USD" },
      },
    }),
  );
  ok("回帰: charity_donation は donation のまま", c?.eventType, "donation");
  ok("回帰: charity_donation の金額", c?.monetaryAmount, { currency: "USD", amount: 5.5 });
  ok("回帰: 団体名は持ち回らない（§9）", JSON.stringify(c).includes("Some Charity"), false);
}

{
  const c = mapOne(
    notification({
      notice_type: "community_sub_gift",
      raid: undefined,
      community_sub_gift: { sub_tier: "1000", total: 5 },
    }),
  );
  ok("回帰: community_sub_gift は gift のまま", c?.eventType, "gift");
  ok("回帰: giftCount は total", c?.giftCount, 5);
}

// 通常チャット（notice_type を持たないイベント）は従来どおり chat/superchat へ落ちる。
{
  const c = mapOne({
    broadcaster_user_id: "b1",
    broadcaster_user_login: "broadcaster",
    broadcaster_user_name: "Broadcaster",
    chatter_user_id: "u1",
    chatter_user_login: "alice",
    chatter_user_name: "Alice",
    message_id: "m2",
    message: { text: "hi", fragments: [] },
    color: "#fff",
    badges: [],
    message_type: "text",
  });
  ok("回帰: 通常チャットは normal", c?.eventType, "normal");
  ok("回帰: 通常チャットにレイド人数は付かない", c?.raidViewerCount, undefined);
}

// 複数イベントをまとめて通したとき、drop された分だけが落ちて順序が保たれる。
{
  const comments = mapTwitchChatEventsToComments([
    notification({ notice_type: "unraid", raid: undefined }),
    notification({ message_id: "m3", raid: raidDetails() }),
    notification({ notice_type: "announcement", raid: undefined }),
  ]);
  ok("バッチ: 取り込まれるのはレイド 1 件だけ", comments.length, 1);
  ok("バッチ: 残ったのは raid の行", comments[0]?.id, "m3");
}

// ---------------------------------------------------------------------------
// 063e: チャンネルポイントの引き換え（channel.channel_points_custom_reward_redemption.add）
// ---------------------------------------------------------------------------
//
// 何を担保するか:
//   F. **引き換えをコメント 1 件として取り込む**。author は引き換えた視聴者、本文は `user_input`。
//   G. **テキスト入力なしの報酬でも行は作る**（本文が空になるだけ・配信画面に出さないのは frontend の責務）。
//   H. **金銭ではない**（`monetaryAmount` が付かない＝課金系の集計・表示・音に載らない）。
//   I. **§9**: 報酬名（`reward.title`）が出力に 1 バイトも現れない（DTO に宣言していないので構造的に届かない）。
//   J. ⚠⚠⚠ **未知の形のイベントで throw しない**（本線＝コメント取得セッションを落とさない）。
//
// 出典: https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types/
//   - Authorization: "Requires `channel:read:redemptions` scope from a broadcaster's access token."
//   - Condition: broadcaster_user_id（必須）／reward_id（任意・**本実装では使わない**）
//   ⚠ イベントペイロードのフィールド表は公式ページの後半にあり、2026-08-25 時点で一次確認できていない。
//     本 fixture は「`id` / `user_*` / `user_input` を持ち、`reward` も載っている」形を置いている
//     （`reward` を入れておくのは、**取り込まないことを検証する対象**だから。抜くとテストが何も守らなくなる）。

/** チャンネルポイント引き換えの event ペイロード。 */
const redemption = (over = {}) => ({
  id: "cp1",
  broadcaster_user_id: "b1",
  broadcaster_user_login: "broadcaster",
  broadcaster_user_name: "Broadcaster",
  user_id: "u9",
  user_login: "alice",
  user_name: "Alice",
  user_input: "がんばれー！",
  status: "unfulfilled",
  // ⚠ **取り込まないことを検証するために置いている**（DTO に宣言していないので届かないはず）。
  reward: { id: "r1", title: "読み上げ", cost: 500, prompt: "好きな言葉をどうぞ" },
  redeemed_at: "2026-08-25T10:00:00Z",
  ...over,
});

{
  const c = mapOne(redemption());
  ok("channelpoint: eventType は channelpoint", c?.eventType, "channelpoint");
  ok("channelpoint: id は引き換えイベント自身の id（dedup キー）", c?.id, "cp1");
  ok("channelpoint: author は引き換えた視聴者", c?.author?.id, "u9");
  ok("channelpoint: 表示名も視聴者のもの", c?.author?.name, "Alice");
  ok("channelpoint: 本文は user_input", c?.text, "がんばれー！");
  ok("⚠⚠ channelpoint: 金額を持たない（課金扱いしない）", c?.monetaryAmount, undefined);
  ok("channelpoint: レイド人数は付かない", c?.raidViewerCount, undefined);
  // ⚠⚠ §9: 報酬名は段 1 では消費しない（DTO に宣言していない＝構造的に到達しない）。
  ok(
    "⚠⚠ §9: 報酬名が出力に現れない",
    JSON.stringify(c).includes("読み上げ"),
    false,
  );
  ok(
    "⚠ §9: 報酬の prompt も現れない",
    JSON.stringify(c).includes("好きな言葉"),
    false,
  );
}

// ⚠ テキスト入力を求めない報酬（`user_input` が空文字）。**行は作る**（本文が空になるだけ）。
{
  const c = mapOne(redemption({ id: "cp2", user_input: "" }));
  ok("channelpoint(入力なし): それでも行は作る", c?.eventType, "channelpoint");
  ok("channelpoint(入力なし): 本文は空文字", c?.text, "");
  // ⚠ 報酬名で埋めない（043a が system_message へフォールバックしないと決めたのと同じ規律）。
  ok("⚠⚠ channelpoint(入力なし): 報酬名で本文を埋めない", c?.text?.length, 0);
}

// ⚠⚠⚠ **本線を止めないこと**（063e の最重要の不変条件）。
//   購読側の `.catch(() => {})` が守るのは購読作成の失敗だけで、受信したイベントは守らない。
//   mapper が知らない形のイベントで throw すると `runTwitchPipeline` の catch まで上がり、
//   **コメント取得セッションが failed で死ぬ**。⇒ 未知の形は「行を作らない」へ倒す。
{
  let threw = false;
  let comments = null;
  try {
    comments = mapTwitchChatEventsToComments([
      // 将来 purchase された購読・仕様変更で形が変わったイベントを模す
      // （`notice_type` も `bits` も `user_input` も `message` も持たない）。
      { id: "x1", broadcaster_user_id: "b1", something_new: { nested: true } },
    ]);
  } catch {
    threw = true;
  }
  ok("⚠⚠⚠ 未知の形のイベントで throw しない（本線が止まらない）", threw, false);
  ok("⚠ 未知の形は行を作らない（静かに捨てる）", comments?.length, 0);
}

// ⚠ 既存種別の判別を奪っていないこと（`user_input` を見る判定が chat / bits を横取りしない）。
{
  const chat = mapOne({
    broadcaster_user_id: "b1",
    broadcaster_user_login: "broadcaster",
    broadcaster_user_name: "Broadcaster",
    chatter_user_id: "u1",
    chatter_user_login: "alice",
    chatter_user_name: "Alice",
    message_id: "m9",
    message: { text: "hi", fragments: [] },
    color: "#fff",
    badges: [],
    // ⚠ チャットにも `channel_points_custom_reward_id` は載りうる（ハイライト等）。
    //   これは**引き換えイベントではない**ので、chat のままでなければならない。
    channel_points_custom_reward_id: "r1",
    message_type: "channel_points_highlighted",
  });
  ok("⚠ 回帰: 報酬 id 付きのチャットは chat のまま", chat?.eventType, "normal");
  const bits = mapOne({
    broadcaster_user_id: "b1",
    broadcaster_user_login: "broadcaster",
    broadcaster_user_name: "Broadcaster",
    user_id: "u2",
    user_login: "bob",
    user_name: "Bob",
    bits: 100,
    type: "power_up",
    message_id: "m10",
  });
  ok("⚠ 回帰: bits.use は superchat のまま", bits?.eventType, "super_chat");
}

// ---------------------------------------------------------------------------
// 063e 段 1-b: **判別を `user_input` にぶら下げない**（穴 H' の対処）
// ---------------------------------------------------------------------------
//
// ⚠⚠⚠ 段 1 の判定は `typeof user_input === "string"` だった。`null` やキー欠落が 1 度でも来ると
//   引き換えとして認識されず、chat フォールバックで捨てられ、**1 件も出ない・エラーも出ない**。
//   ⚠ 依頼者はチャンネルポイントを実機で確認できない（新規チャンネルでは Twitch 側で未有効化）ので、
//     「公式仕様どおりに来るはず」に賭けられない。⇒ 判別材料を `id` ＋ `user_id` へ移した。
//   ⚠ 受信直後の `repairNotificationEvent`（`test-eventsub-repair.mjs`）が第 1 の防波堤で、
//     ここは**その手前でも壊れないこと**＝mapper 単体としての堅さを固定する。
for (const [label, over] of [
  ["null", { user_input: null }],
  ["数値", { user_input: 42 }],
  ["オブジェクト", { user_input: { text: "x" } }],
]) {
  const c = mapOne(redemption({ id: "cp-h", ...over }));
  ok(`⚠⚠⚠ user_input が ${label} でも引き換えとして取り込む`, c?.eventType, "channelpoint");
  ok(`⚠⚠ user_input が ${label} でも本文は空文字（型を漏らさない）`, c?.text, "");
}
{
  // ⚠ キーごと無いケース（`in` 演算子を使った判定なら false になっていた形）。
  const event = redemption({ id: "cp-h2" });
  delete event.user_input;
  const c = mapOne(event);
  ok("⚠⚠⚠ user_input のキーが無くても引き換えとして取り込む", c?.eventType, "channelpoint");
  ok("⚠⚠ そのとき本文は空文字", c?.text, "");
  ok("⚠ id は引き換えイベント自身のもの", c?.id, "cp-h2");
}

// ⚠ 逆向きの誤検知: **判別に使う 2 つが欠けたら引き換えにしない**（他種別を横取りしない）。
//   ⚠⚠ このとき「行を作らない」に倒れるのが正しい——`id` の補填は
//     `repairNotificationEvent` の仕事で、mapper が勝手にでっち上げてはいけない
//     （出典の無い ID で端末に保存すると dedup が壊れる）。
{
  const noId = redemption();
  delete noId.id;
  let threw = false;
  let comments = null;
  try {
    comments = mapTwitchChatEventsToComments([noId]);
  } catch {
    threw = true;
  }
  ok("⚠ id が無い引き換えで throw しない", threw, false);
  ok("⚠ id が無ければ行を作らない（ID をでっち上げない）", comments?.length, 0);
}

// ⚠⚠ **判別順を守っていること**（`isBitsUseEvent` が先）。`id` を持った bits.use が来ても
//   引き換えに横取りされない＝**bits 額が消えない**。
{
  const bitsWithId = mapOne({
    broadcaster_user_id: "b1",
    broadcaster_user_login: "broadcaster",
    broadcaster_user_name: "Broadcaster",
    user_id: "u2",
    user_login: "bob",
    user_name: "Bob",
    bits: 100,
    type: "power_up",
    message_id: "m12",
    // ⚠ 将来 bits.use が `id` を持つようになった場合を模す。
    id: "bits-id-1",
  });
  ok("⚠⚠ id 付きの bits.use は引き換えに横取りされない", bitsWithId?.eventType, "super_chat");
  ok("⚠⚠ bits 額も消えない", bitsWithId?.monetaryAmount, { currency: "BITS", amount: 100 });
}

// ⚠ chat 側も横取りしない（`chatter_user_id` はあるが `user_id` は無い）。
{
  const chat = mapOne({
    broadcaster_user_id: "b1",
    broadcaster_user_login: "broadcaster",
    broadcaster_user_name: "Broadcaster",
    chatter_user_id: "u1",
    chatter_user_login: "alice",
    chatter_user_name: "Alice",
    message_id: "m13",
    message: { text: "hi", fragments: [] },
    color: "#fff",
    badges: [],
    message_type: "text",
  });
  ok("⚠ 通常チャットは chat のまま（判別が横取りしない）", chat?.eventType, "normal");
}

// ⚠ notice_type を持つイベントは引き換えにしない（`id` を持っていても）。
{
  const c = mapOne(
    notification({ notice_type: "announcement", id: "cp-x", user_id: "u9", raid: undefined }),
  );
  ok("⚠ notice_type 付きは引き換えにならない（非収益 notice は従来どおり落とす）", c, null);
}

// バッチ: チャネポと既存種別が混ざっても、順序と件数が保たれる。
{
  const comments = mapTwitchChatEventsToComments([
    redemption({ id: "cp3" }),
    notification({ notice_type: "unraid", raid: undefined }),
    notification({ message_id: "m11", raid: raidDetails() }),
  ]);
  ok("バッチ(063e): 取り込まれるのは 2 件（チャネポ＋レイド）", comments.length, 2);
  ok("バッチ(063e): 1 件目はチャネポ", comments[0]?.id, "cp3");
  ok("バッチ(063e): 2 件目はレイド", comments[1]?.id, "m11");
}

// ---------------------------------------------------------------------------
// K. 063e: 静的検査（購読の非致命性と OAuth スコープ）
// ---------------------------------------------------------------------------
//
// ⚠⚠⚠ **ここは「動かして確かめられない不変条件」を源コードで固定する**（066 の
// `test-chat-send.mjs` が採った形と同じ）。購読作成の失敗は実ネットに出ないと再現できず、
// スコープは実際にログインしないと確かめられないが、**どちらも壊れると被害が大きい**:
//   - `.catch` を外すと **403（旧トークン／他人のチャンネル）でコメント取得ごと止まる**
//   - `channel:manage:redemptions` が混ざると **報酬の消化・返却ができる権限を黙って取る**
{
  const here = dirname(fileURLToPath(import.meta.url));
  const stripComments = (src) =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

  const clientSrc = stripComments(
    readFileSync(
      join(
        here,
        "..",
        "vendor",
        "comment-fetcher",
        "src",
        "adapters",
        "twitch",
        "client",
        "eventsub-websocket.client.ts",
      ),
      "utf8",
    ),
  );

  // 購読タイプが 1 件だけ増えていること（自動報酬の購読を紛れ込ませていないこと）。
  ok(
    "⚠ 購読しているのは**カスタム報酬**の引き換えだけ",
    clientSrc.includes(
      '"channel.channel_points_custom_reward_redemption.add"',
    ),
    true,
  );
  ok(
    "⚠⚠ 自動報酬（automatic_reward）は購読していない（別購読・別タスク）",
    clientSrc.includes("automatic_reward"),
    false,
  );
  // ⚠ condition に reward_id を入れていない（段 3 まで報酬を絞らない）。
  ok("⚠ condition に reward_id を入れていない", clientSrc.includes("reward_id"), false);

  // ⚠⚠⚠ **非致命であること。** 購読の呼び出しごとに `.catch` が付いているかを数える
  //   （必須 2 購読 = 0 個 ／ 任意 2 購読（bits.use・channel points）= 2 個）。
  const catchCount = (clientSrc.match(/\.catch\(/g) ?? []).length;
  ok(
    "⚠⚠⚠ 任意購読は 2 件とも非致命（`.catch` が 2 つある＝403 で本線が止まらない）",
    catchCount,
    2,
  );

  const configSrc = stripComments(
    readFileSync(join(here, "..", "src", "twitch-config.ts"), "utf8"),
  );
  ok(
    "⚠ スコープに channel:read:redemptions が入っている",
    configSrc.includes('"channel:read:redemptions"'),
    true,
  );
  // ⚠⚠⚠ **書き込み権限を巻き込んでいないこと。**
  ok(
    "⚠⚠⚠ `channel:manage:redemptions`（消化・返却）は取らない",
    configSrc.includes("channel:manage:redemptions"),
    false,
  );
  // ⚠ スコープが**ちょうど 4 つ**であること（増えたら気付ける＝同意画面が変わる変更を見逃さない）。
  // ⚠ 配列リテラルの中身だけを取る（`readonly string[]` の `]` に引っかからないよう `= [` から読む）。
  const scopes = (
    (/TWITCH_SCOPES[^=]*=\s*\[([^\]]*)\]/.exec(configSrc)?.[1] ?? "").match(
      /"[^"]+"/g,
    ) ?? []
  ).map((v) => v.slice(1, -1));
  ok("⚠⚠ Twitch のスコープはちょうど 4 つ", scopes, [
    "user:read:chat",
    "bits:read",
    "user:write:chat",
    "channel:read:redemptions",
  ]);

  // ⚠⚠⚠ 063e 段 1-b: **mapper の判別が `user_input` に戻っていないこと。**
  //   単体テストは「今の実装が正しい」ことしか言えず、`repairNotificationEvent` が
  //   `user_input` を必ず string にしてしまうため、**判別を `user_input` へ戻しても
  //   実運用に近い経路のテストは全部 PASS してしまう**（本番だけ静かに壊れる）。
  //   ⇒ 判別関数の本体を源コードで固定する。
  const mapperSrc = stripComments(
    readFileSync(
      join(
        here,
        "..",
        "vendor",
        "comment-fetcher",
        "src",
        "adapters",
        "twitch",
        "mapper",
        "comment.mapper.ts",
      ),
      "utf8",
    ),
  );
  const guardBody =
    /function isChannelPointsRedemptionEvent\([\s\S]*?^\}/m.exec(mapperSrc)?.[0] ?? "";
  ok("⚠ 判別関数を読み出せている（検査が空振りしていない）", guardBody.length > 0, true);
  ok(
    "⚠⚠⚠ 判別材料に user_input を使っていない（穴 H\' の再発防止）",
    guardBody.includes("user_input"),
    false,
  );
  ok("⚠ 判別材料は id ＋ user_id", guardBody.includes("id") && guardBody.includes("user_id"), true);
  // ⚠⚠ **`notice_type` の除外は「今は」冗長である**——`mapTwitchChatEventToComment` が
  //   `isNotificationEvent` を**先に**評価して return するので、外しても現在の挙動は 1 つも変わらない
  //   （変異テストで確認済み＝**振る舞いのテストでは固定できない**）。
  //   ⚠ それでも残すのは、`isBitsUseEvent` が同じ形の除外を持っており、**判定の順序を入れ替えた瞬間に
  //   `notice_type` 付きイベント（サブスク・レイド等）を横取りする**からである。
  //   ⇒ 冗長さを保つ理由が源コードにしか無いので、源コードで固定する。
  ok(
    "⚠⚠ notice_type の除外を残している（判定順を変えたときの保険）",
    guardBody.includes('"notice_type" in event'),
    true,
  );
  // ⚠⚠ 判別順（bits が先）を固定する。入れ替えると id 付き bits.use が引き換えに化ける。
  ok(
    "⚠⚠ isBitsUseEvent の判定が isChannelPointsRedemptionEvent より先に来る",
    mapperSrc.indexOf("if (isBitsUseEvent(event))") <
      mapperSrc.indexOf("if (isChannelPointsRedemptionEvent(event))"),
    true,
  );

  // ⚠ 報酬名を DTO に宣言していないこと（§9・段 1 は報酬を区別しない）。
  const dtoSrc = stripComments(
    readFileSync(
      join(
        here,
        "..",
        "vendor",
        "comment-fetcher",
        "src",
        "adapters",
        "twitch",
        "dto",
        "raw.dto.ts",
      ),
      "utf8",
    ),
  );
  ok(
    "⚠⚠ §9: 引き換え DTO に reward を宣言していない（構造的に取り込まない）",
    /TwitchChannelPointsRedemptionEventDto = \{[^}]*reward/.test(dtoSrc),
    false,
  );
}

if (failures > 0) {
  console.error(`\nTWITCH-MAPPER FAILED: ${failures}`);
  process.exit(1);
}
console.log("\nTWITCH-MAPPER PASS");
