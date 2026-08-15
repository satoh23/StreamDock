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

if (failures > 0) {
  console.error(`\nTWITCH-MAPPER FAILED: ${failures}`);
  process.exit(1);
}
console.log("\nTWITCH-MAPPER PASS");
