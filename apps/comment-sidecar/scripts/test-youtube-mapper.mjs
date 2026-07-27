// 043d: YouTube の受信面（proto の公式番号 → DTO → mapper）の単体検証。
// dist（tsc 出力）から proto 文字列と mapper を import し、素の assert で表明する
// （test-host-guard.mjs と同じ体裁）。build:tsc または build:bundle の後に実行:
//
//   pnpm --filter @stream-dock/comment-sidecar build:tsc
//   node apps/comment-sidecar/scripts/test-youtube-mapper.mjs
//
// 何を担保するか:
//   A. 自 proto のフィールド番号/enum 値が**公式ドキュメントの番号表と一致**する（推測ゼロの機械チェック）。
//   B. **公式 proto（全フィールド）でシリアライズしたバイト列を自 proto でデコード**して mapper に通す。
//      我々は公式のサブセットしか宣言していないため、番号がずれていればデコードが壊れて必ず落ちる。
//      gift/jewels は実配信での発火機会が乏しいため、これが実質的な唯一の自動検証手段になる。
//   C. 受贈者情報（受領側 details）を**受信も保持もしない**こと（security.md §9）。
//
// dist の JS は `@comment-dock/*` の path alias を保持したまま emit されるため、mapper を読む前に
// dist-alias-loader.mjs を resolve フックとして登録する（登録後に動的 import する必要がある）。
import { register } from "node:module";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

register("./dist-alias-loader.mjs", import.meta.url);

const require = createRequire(import.meta.url);
const protoLoader = require("@grpc/proto-loader");

const { STREAM_LIST_PROTO } = await import(
  "../dist/vendor/comment-fetcher/src/adapters/youtube/client/stream-list-proto.js"
);
const { mapYouTubeLiveChatMessagesToComments } = await import(
  "../dist/vendor/comment-fetcher/src/adapters/youtube/mapper/comment.mapper.js"
);

let failures = 0;
// 043d(レビュー指摘・2026-07-27／修正不要と判断): JSON.stringify 比較なので `undefined` と「キーごと欠落」を
//   同一視する（`{a:undefined}` と `{}` が等しくなる）。本テストの期待値は「値が付かないこと」であって
//   「キーの有無」ではないため実害が無く、素の assert に寄せる体裁（test-host-guard.mjs と同じ）を優先する。
//   再修正トリガー: キーの存在自体を区別したい表明（例: 明示的な null と未設定の区別）が要るようになったら、
//   `Object.hasOwn` を見る専用アサートを足すこと。
const ok = (label, actual, expected) => {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (!pass) failures++;
  process.stderr.write(
    `${pass ? "PASS" : "FAIL"} ${label}` +
      (pass
        ? "\n"
        : `\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}\n`),
  );
};

/** proto 文字列を loadSync と同じオプション（api.client.ts と一致）で読む。 */
const load = (proto, filename) => {
  const dir = mkdtempSync(join(tmpdir(), "streamdock-proto-test-"));
  const path = join(dir, filename);
  writeFileSync(path, proto, "utf8");
  return protoLoader.loadSync(path, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });
};

const ours = load(STREAM_LIST_PROTO, "stream_list.proto");

// ---------------------------------------------------------------------------
// A. 公式番号との一致（出典: https://developers.google.com/youtube/v3/live/streaming-live-chat）
// ---------------------------------------------------------------------------

const snippetDesc = ours["youtube.api.v3.LiveChatMessageSnippet"].type;
const enumValues = Object.fromEntries(
  snippetDesc.enumType.find((e) => e.name === "Type").value.map((v) => [v.name, v.number]),
);
const fieldsOf = (typeName) =>
  Object.fromEntries(
    ours[`youtube.api.v3.${typeName}`].type.field.map((f) => [f.name, f.number]),
  );
const typeOf = (typeName, fieldName) =>
  ours[`youtube.api.v3.${typeName}`].type.field.find((f) => f.name === fieldName)?.type;

ok("enum: MEMBERSHIP_GIFTING_EVENT = 18", enumValues.MEMBERSHIP_GIFTING_EVENT, 18);
ok("enum: GIFT_MEMBERSHIP_RECEIVED_EVENT = 19", enumValues.GIFT_MEMBERSHIP_RECEIVED_EVENT, 19);
ok("enum: GIFT_EVENT = 21", enumValues.GIFT_EVENT, 21);
ok("enum: MEMBER_MILESTONE_CHAT_EVENT = 17", enumValues.MEMBER_MILESTONE_CHAT_EVENT, 17);
// 公式に存在しない旧独自値は宣言しない。
ok("enum: MESSAGE_DELETED_EVENT は非宣言", enumValues.MESSAGE_DELETED_EVENT, undefined);
ok("enum: MESSAGE_RETRACTED_EVENT は非宣言", enumValues.MESSAGE_RETRACTED_EVENT, undefined);

const snippetFields = fieldsOf("LiveChatMessageSnippet");
ok("snippet: membership_gifting_details = 31", snippetFields.membership_gifting_details, 31);
ok("snippet: gift_details = 34", snippetFields.gift_details, 34);
// 決定1: 受領側の詳細は proto に宣言しない（受贈者情報をそもそも受信しない）。
ok(
  "snippet: gift_membership_received_details は非宣言（決定1）",
  snippetFields.gift_membership_received_details,
  undefined,
);

ok(
  "LiveChatMembershipGiftingDetails.gift_memberships_count = 1",
  fieldsOf("LiveChatMembershipGiftingDetails").gift_memberships_count,
  1,
);
ok("LiveChatGiftDetails.jewels_amount = 3", fieldsOf("LiveChatGiftDetails").jewels_amount, 3);
// 043e: combo（連続ギフト）回数。公式番号 8・int32。
ok("LiveChatGiftDetails.combo_count = 8", fieldsOf("LiveChatGiftDetails").combo_count, 8);
ok(
  "LiveChatGiftDetails.combo_count は int32",
  typeOf("LiveChatGiftDetails", "combo_count"),
  "TYPE_INT32",
);
// 043e で採ったのは combo_count だけ。ギフト資産情報（画像 URL 等）は引き続き非宣言（CSP・§9）。
ok("LiveChatGiftDetails.gift_url は非宣言（CSP/§9）", fieldsOf("LiveChatGiftDetails").gift_url, undefined);
// バグ修正 2 件（番号・型が公式どおりであること）。
ok(
  "LiveChatMemberMilestoneChatDetails.member_month = 2（旧 1 は member_level_name）",
  fieldsOf("LiveChatMemberMilestoneChatDetails").member_month,
  2,
);
ok(
  "LiveChatSuperChatDetails.amount_micros は uint64（旧 string はワイヤ型不一致）",
  typeOf("LiveChatSuperChatDetails", "amount_micros"),
  "TYPE_UINT64",
);
ok(
  "LiveChatSuperStickerDetails.amount_micros は uint64",
  typeOf("LiveChatSuperStickerDetails", "amount_micros"),
  "TYPE_UINT64",
);
ok(
  "author_details.profile_image_url = 104（036b の暫定値が公式と一致と確定）",
  fieldsOf("LiveChatMessageAuthorDetails").profile_image_url,
  104,
);

// ---------------------------------------------------------------------------
// B. 公式 proto（全フィールド）で送信 → 自 proto でデコード → mapper
//
// 送信側は公式ドキュメント掲載の定義を**そのまま**書く（我々が採用していないフィールドも含む）。
// これにより「YouTube が実際に送ってくるバイト列」を再現でき、番号ズレがあれば必ず落ちる。
//
// ⚠ この送信側 proto は**実装者が公式を読んで書き起こしたもの**であり、受信側と同じ誤解を共有していれば
//   テストは緑のまま通ってしまう（テスト単体は番号の正しさを証明しない）という構造的弱点がある。
//   → 2026-07-27 のレビューで**第三者が一次情報を独立に再取得し、本送信側 proto の全フィールド番号・
//     ワイヤ型を 1 件ずつ照合して全一致を確認済み**（出典: 上記公式ガイドの proto 全文）。
//   以後この送信側を編集するときは、必ず公式ガイドの proto 全文と突き合わせてから変更すること。
//
// 型の代替（いずれもワイヤ型が同一なので、受信側のスキップ挙動は公式と等価）:
//   - google.protobuf.Duration → bytes（ともにワイヤ型 2 = length-delimited。import を避けるため）
//   - BanTypeWrapper.BanType / PollStatusWrapper.PollStatus → int32（ともに varint）
// ---------------------------------------------------------------------------

const OFFICIAL_SENDER_PROTO = `syntax = "proto2";

package youtube.api.v3;

message LiveChatMessageListResponse {
  optional string kind = 200;
  optional string etag = 201;
  optional string offline_at = 2;
  optional PageInfo page_info = 1004;
  optional string next_page_token = 100602;
  repeated LiveChatMessage items = 1007;
  optional LiveChatMessage active_poll_item = 1008;
}

message PageInfo {
  optional int32 total_results = 1;
  optional int32 results_per_page = 2;
}

message LiveChatMessage {
  optional string kind = 200;
  optional string etag = 201;
  optional string id = 101;
  optional LiveChatMessageSnippet snippet = 2;
  optional LiveChatMessageAuthorDetails author_details = 3;
}

message LiveChatMessageSnippet {
  enum Type {
    INVALID_TYPE = 0;
    TEXT_MESSAGE_EVENT = 1;
    TOMBSTONE = 2;
    FAN_FUNDING_EVENT = 3;
    CHAT_ENDED_EVENT = 4;
    SPONSOR_ONLY_MODE_STARTED_EVENT = 5;
    SPONSOR_ONLY_MODE_ENDED_EVENT = 6;
    NEW_SPONSOR_EVENT = 7;
    MEMBER_MILESTONE_CHAT_EVENT = 17;
    MEMBERSHIP_GIFTING_EVENT = 18;
    GIFT_MEMBERSHIP_RECEIVED_EVENT = 19;
    USER_BANNED_EVENT = 10;
    SUPER_CHAT_EVENT = 15;
    SUPER_STICKER_EVENT = 16;
    POLL_EVENT = 20;
    GIFT_EVENT = 21;
  }
  optional Type type = 1;
  optional string live_chat_id = 201;
  optional string author_channel_id = 301;
  optional string published_at = 4;
  optional bool has_display_content = 17;
  optional string display_message = 16;
  optional LiveChatTextMessageDetails text_message_details = 19;
  optional LiveChatUserBannedMessageDetails user_banned_details = 22;
  optional LiveChatSuperChatDetails super_chat_details = 27;
  optional LiveChatSuperStickerDetails super_sticker_details = 28;
  optional LiveChatNewSponsorDetails new_sponsor_details = 29;
  optional LiveChatMemberMilestoneChatDetails member_milestone_chat_details = 30;
  optional LiveChatMembershipGiftingDetails membership_gifting_details = 31;
  optional LiveChatGiftMembershipReceivedDetails gift_membership_received_details = 32;
  optional LiveChatPollDetails poll_details = 33;
  optional LiveChatGiftDetails gift_details = 34;
}

message LiveChatTextMessageDetails {
  optional string message_text = 1;
}

message ChannelProfileDetails {
  optional string channel_id = 101;
  optional string channel_url = 2;
  optional string display_name = 3;
  optional string profile_image_url = 4;
}

message LiveChatUserBannedMessageDetails {
  optional ChannelProfileDetails banned_user_details = 1;
  optional int32 ban_type = 2;
  optional uint64 ban_duration_seconds = 4;
}

message LiveChatNewSponsorDetails {
  optional string member_level_name = 1;
  optional bool is_upgrade = 2;
}

message LiveChatPollDetails {
  message PollMetadata {
    message PollOption {
      optional string option_text = 1;
      optional int64 tally = 2;
    }
    optional string question_text = 1;
    repeated PollOption options = 2;
  }
  optional PollMetadata metadata = 1;
  optional int32 status = 2;
}

message SuperStickerMetadata {
  optional string sticker_id = 1;
  optional string alt_text = 2;
  optional string alt_text_language = 3;
}

message LiveChatMessageAuthorDetails {
  optional string channel_id = 10101;
  optional string channel_url = 102;
  optional string display_name = 103;
  optional string profile_image_url = 104;
  optional bool is_verified = 4;
  optional bool is_chat_owner = 5;
  optional bool is_chat_sponsor = 6;
  optional bool is_chat_moderator = 7;
}

message LiveChatSuperChatDetails {
  optional uint64 amount_micros = 1;
  optional string currency = 2;
  optional string amount_display_string = 3;
  optional string user_comment = 4;
  optional uint32 tier = 5;
}

message LiveChatSuperStickerDetails {
  optional uint64 amount_micros = 1;
  optional string currency = 2;
  optional string amount_display_string = 3;
  optional uint32 tier = 4;
  optional SuperStickerMetadata super_sticker_metadata = 5;
}

message LiveChatMemberMilestoneChatDetails {
  optional string member_level_name = 1;
  optional uint32 member_month = 2;
  optional string user_comment = 3;
}

message LiveChatMembershipGiftingDetails {
  optional int32 gift_memberships_count = 1;
  optional string gift_memberships_level_name = 2;
}

message LiveChatGiftMembershipReceivedDetails {
  optional string member_level_name = 1;
  optional string gifter_channel_id = 2;
  optional string associated_membership_gifting_message_id = 3;
}

message LiveChatGiftDetails {
  optional string gift_name = 1;
  optional bytes gift_duration = 2;
  optional int32 jewels_amount = 3;
  optional string gift_url = 4;
  optional string alt_text = 5;
  optional string language = 6;
  optional bool has_visual_effect = 7;
  optional int32 combo_count = 8;
}
`;

const official = load(OFFICIAL_SENDER_PROTO, "official_stream_list.proto");
const SENDER = official["youtube.api.v3.LiveChatMessageListResponse"];
const RECEIVER = ours["youtube.api.v3.LiveChatMessageListResponse"];

const PUBLISHED_AT = "2026-07-27T12:00:00.000Z";

/**
 * 公式定義でシリアライズしたバイト列を、自 proto でデコードする（＝実配信と同じ経路）。
 *
 * 番号やワイヤ型がずれていると読み取り位置が壊れ、protobufjs が例外を投げる
 * （旧 `member_month = 1` の実挙動が「invalid wire type」）。テスト全体をクラッシュさせず
 * FAIL として報告したいので握って空レスポンスを返す。
 */
const roundTrip = (items) => {
  try {
    return RECEIVER.deserialize(SENDER.serialize({ items }));
  } catch (e) {
    failures++;
    process.stderr.write(`FAIL デコード例外（番号/ワイヤ型ズレの疑い）: ${e.message}\n`);
    return { kind: "youtube#liveChatMessageListResponse", etag: "", items: [] };
  }
};

/** 公式レスポンス 1 件分の骨組み。author_details は公式の全フィールドを埋める。 */
const message = (id, type, snippetExtra = {}) => ({
  id,
  snippet: {
    type,
    live_chat_id: "chat-1",
    author_channel_id: "UC_author",
    published_at: PUBLISHED_AT,
    has_display_content: true,
    display_message: "",
    ...snippetExtra,
  },
  author_details: {
    channel_id: "UC_author",
    channel_url: "https://www.youtube.com/channel/UC_author",
    display_name: "Gifter",
    profile_image_url: "https://yt3.ggpht.com/ytc/abc=s48-c-k",
    is_verified: false,
    is_chat_owner: false,
    is_chat_sponsor: true,
    is_chat_moderator: false,
  },
});

const mapOne = (msg) => mapYouTubeLiveChatMessagesToComments(roundTrip([msg]));

/**
 * レビュー指摘(2026-07-27)対応: `ok(..., c?.x, undefined)` 形式の否定アサートは、c が undefined だと
 * **素通りしてしまう**（roundTrip がデコード例外を握って空配列を返した場合でも緑になり得る）。
 * そこで各ブロックの前提として「ちょうど 1 件に写ること」を先に固定してから個別フィールドを見る。
 * JSON.stringify(c) を使う §9 アサートが c=undefined で TypeError になる問題も同時に潰れる。
 */
const one = (label, msg) => {
  const comments = mapOne(msg);
  ok(`${label}: ちょうど 1 件に写る（後続アサートの前提）`, comments.length, 1);
  return comments[0];
};

// ① 贈与側（MEMBERSHIP_GIFTING_EVENT = 18）→ eventType=gift + giftCount。
//    公式では level_name も同梱されるが、我々は宣言していないのでスキップされる（受信面は count のみ）。
{
  const c = one(
    "gifting",
    message("m-gifting", "MEMBERSHIP_GIFTING_EVENT", {
      membership_gifting_details: {
        gift_memberships_count: 5,
        gift_memberships_level_name: "レベル 2 メンバー",
      },
    }),
  );
  ok("gifting: eventType", c?.eventType, "gift");
  ok("gifting: giftCount", c?.giftCount, 5);
  ok("gifting: monetaryAmount なし", c?.monetaryAmount, undefined);
  ok("gifting: author は投稿者（贈与者）本人のみ", c?.author?.name, "Gifter");
  ok("gifting: avatar（profile_image_url = 104）が読める", c?.author?.avatar, "https://yt3.ggpht.com/ytc/abc=s48-c-k");
  // §9: 未宣言の level_name は受信面に出てこない。
  ok(
    "gifting(§9): gift_memberships_level_name は受信しない",
    JSON.stringify(c).includes("レベル 2 メンバー"),
    false,
  );
}

// ①-2 件数欠落／0（loadSync の defaults:true で 0 が入る）は undefined へ劣化＝「0 件贈りました」を作らない。
{
  const zero = one(
    "gifting-zero",
    message("m-gifting-zero", "MEMBERSHIP_GIFTING_EVENT", {
      membership_gifting_details: { gift_memberships_level_name: "レベル 1" },
    }),
  );
  ok("gifting: count 未設定（defaults で 0）は undefined へ劣化", zero?.giftCount, undefined);
}

// ② 受領側（GIFT_MEMBERSHIP_RECEIVED_EVENT = 19）は**取り込まない**（決定1・二重計上ゼロの回帰検知）。
{
  const comments = mapOne(
    message("m-received", "GIFT_MEMBERSHIP_RECEIVED_EVENT", {
      gift_membership_received_details: {
        member_level_name: "レベル 2 メンバー",
        gifter_channel_id: "UC_gifter_secret",
        associated_membership_gifting_message_id: "m-gifting",
      },
    }),
  );
  ok("received: 0 件に落ちる", comments.length, 0);
}

// ②-2 1 購入 = 贈与側 1 + 受領側 N が同時に届いても、通るのは贈与側 1 件だけ（二重計上ゼロ）。
{
  const comments = mapYouTubeLiveChatMessagesToComments(
    roundTrip([
      message("m-gifting", "MEMBERSHIP_GIFTING_EVENT", {
        membership_gifting_details: { gift_memberships_count: 3 },
      }),
      message("m-recv-1", "GIFT_MEMBERSHIP_RECEIVED_EVENT", {
        gift_membership_received_details: { gifter_channel_id: "UC_gifter_secret" },
      }),
      message("m-recv-2", "GIFT_MEMBERSHIP_RECEIVED_EVENT", {
        gift_membership_received_details: { gifter_channel_id: "UC_gifter_secret" },
      }),
      message("m-recv-3", "GIFT_MEMBERSHIP_RECEIVED_EVENT", {
        gift_membership_received_details: { gifter_channel_id: "UC_gifter_secret" },
      }),
    ]),
  );
  ok("1 購入 N 発火: 通るのは贈与側 1 件のみ", comments.length, 1);
  ok("1 購入 N 発火: 残ったのは贈与側", comments[0]?.id, "m-gifting");
  ok("1 購入 N 発火: giftCount は購入 1 件ぶん", comments[0]?.giftCount, 3);
}

// ③ Jewels（GIFT_EVENT = 21）→ eventType=jewels + { currency: "JEWELS", amount }（micros 換算しない）。
//    043e で combo_count を採用したので comboCount も通る。ギフト資産情報（gift_name/gift_url/alt_text 等）は
//    引き続き宣言していないのでスキップされる。
{
  const c = one(
    "jewels",
    message("m-jewels", "GIFT_EVENT", {
      gift_details: {
        gift_name: "Rose",
        gift_duration: Buffer.from([0x08, 0x05]),
        jewels_amount: 30,
        gift_url: "https://example.invalid/gift.png",
        alt_text: "バラのギフト",
        language: "ja",
        has_visual_effect: true,
        combo_count: 3,
      },
    }),
  );
  ok("jewels: eventType", c?.eventType, "jewels");
  // 043e フェーズ1 の仕様固定: combo でも **jewels_amount を素のまま採る（× combo_count しない）**。
  //   意味論（単価か累計か）が公式に無いため推測で換算しない。フェーズ2 で単価と確定したらここが 90 になる。
  ok("jewels: monetaryAmount は乗算しない（フェーズ1）", c?.monetaryAmount, {
    currency: "JEWELS",
    amount: 30,
  });
  ok("jewels: comboCount が通る", c?.comboCount, 3);
  ok("jewels: giftCount は付かない", c?.giftCount, undefined);
  // CSP/§9: gift_url（画像 URL）を受信していないこと。
  ok("jewels(§9/CSP): gift_url を受信しない", JSON.stringify(c).includes("gift.png"), false);
}

// ③-2 jewels_amount 未設定（defaults:true で 0）は金額を付けない＝「0 JEWELS」バッジを作らない。
//     レビュー指摘(2026-07-27)で mapGiftCount と非対称だった点を修正したことの回帰検知。
//     043e: combo_count も同じく未設定（defaults で 0）なら undefined へ落ちる＝「×0」を作らない。
{
  const c = one(
    "jewels-zero",
    message("m-jewels-zero", "GIFT_EVENT", { gift_details: { gift_name: "Rose" } }),
  );
  ok("jewels: eventType は jewels のまま", c?.eventType, "jewels");
  ok("jewels: amount 未設定（defaults で 0）は monetaryAmount なし", c?.monetaryAmount, undefined);
  ok("jewels: combo_count 未設定（defaults で 0）は comboCount なし", c?.comboCount, undefined);
}

// ③-3 043e: 単発ギフト（combo_count = 0 を**明示**）でも comboCount は付かない。
//     公式の「The combo count of the gift; 0 if not a combo」＝単発は 0 で届くため、そのまま通すと
//     表示が「×0」になる。0 以下を undefined へ落とす方針（mapGiftCount と同じ）の回帰検知。
{
  const c = one(
    "jewels-single",
    message("m-jewels-single", "GIFT_EVENT", {
      gift_details: { jewels_amount: 30, combo_count: 0 },
    }),
  );
  ok("jewels: combo_count = 0（単発）は comboCount なし", c?.comboCount, undefined);
  ok("jewels: 単発でも金額は通る", c?.monetaryAmount, { currency: "JEWELS", amount: 30 });
}

// ③-4 043e: combo は「別メッセージが N 件届く」のではなく「**同じ id が N 回更新される**」。
//     同一 id・combo_count 1 → 3 の 2 通を往復させ、mapper が**両方をそのまま同じ id のコメントとして写す**
//     （＝重複排除もマージもしない＝後段の mergeComments / record_comment が扱う）ことと、
//     jewels_amount が変わらない限り金額も変わらない（乗算しない）ことを固定する。
{
  const comments = mapYouTubeLiveChatMessagesToComments(
    roundTrip([
      message("m-jewels-combo", "GIFT_EVENT", {
        gift_details: { jewels_amount: 30, combo_count: 1 },
      }),
      message("m-jewels-combo", "GIFT_EVENT", {
        gift_details: { jewels_amount: 30, combo_count: 3 },
      }),
    ]),
  );
  ok("combo: 2 通とも写る（mapper は間引かない）", comments.length, 2);
  ok("combo: id は同一（更新であることの根拠）", comments[0]?.id === comments[1]?.id, true);
  ok("combo: comboCount が 1 → 3 と通る", [comments[0]?.comboCount, comments[1]?.comboCount], [1, 3]);
  ok("combo: 金額は乗算されない（両方とも素の jewels_amount）", [
    comments[0]?.monetaryAmount,
    comments[1]?.monetaryAmount,
  ], [
    { currency: "JEWELS", amount: 30 },
    { currency: "JEWELS", amount: 30 },
  ]);
}

// ④ マイルストーンの月数（proto の member_month = 2 修正の回帰検知）。
//    旧 proto（member_month = 1）は公式の member_level_name（string）を uint32 として読むため壊れていた。
{
  const c = one(
    "milestone",
    message("m-milestone", "MEMBER_MILESTONE_CHAT_EVENT", {
      member_milestone_chat_details: {
        member_level_name: "レベル 2 メンバー",
        member_month: 7,
        user_comment: "いつも応援してます",
      },
      display_message: "いつも応援してます",
    }),
  );
  ok("milestone: eventType", c?.eventType, "membership");
  ok("milestone: monthCount が正しい月数", c?.monthCount, 7);
}

// ⑤ スパチャ（amount_micros を uint64 化しても longs:String で文字列として受かる）。
{
  const c = one(
    "superchat",
    message("m-superchat", "SUPER_CHAT_EVENT", {
      super_chat_details: {
        amount_micros: "1000000000",
        currency: "JPY",
        amount_display_string: "￥1,000",
        user_comment: "応援！",
        tier: 4,
      },
      display_message: "応援！",
    }),
  );
  ok("superchat: eventType", c?.eventType, "super_chat");
  ok("superchat: monetaryAmount（micros → 主要単位）", c?.monetaryAmount, {
    currency: "JPY",
    amount: 1000,
  });
}

// ⑥ 未対応 type は除外される（新規メンバー/通常チャットは従来どおり通ることも併せて確認）。
{
  ok("unmapped: POLL_EVENT は 0 件", mapOne(message("m-poll", "POLL_EVENT")).length, 0);
  ok(
    "regression: NEW_SPONSOR_EVENT は membership",
    mapOne(message("m-sponsor", "NEW_SPONSOR_EVENT"))[0]?.eventType,
    "membership",
  );
  ok(
    "regression: TEXT_MESSAGE_EVENT は normal",
    mapOne(message("m-text", "TEXT_MESSAGE_EVENT", { display_message: "こんにちは" }))[0]
      ?.eventType,
    "normal",
  );
}

// ⑦ レビュー指摘(2026-07-27)対応: 未宣言フィールドのスキップが**採用フィールドの隣接番号**でも安全なこと。
//    以前の送信側 proto はこれらを省いていたためスキップ経路が一度も試されていなかった。
//    とくに poll_details = 33（gift_details = 34 の隣）と active_poll_item = 1008（items = 1007 の隣）は、
//    読み取り位置がずれると採用フィールドを巻き込むため重要。埋め込みメッセージ・repeated・nested も混ぜる。
{
  const bytes = SENDER.serialize({
    // 未宣言（公式）: response 直下の page_info = 1004 / active_poll_item = 1008
    page_info: { total_results: 42, results_per_page: 20 },
    active_poll_item: message("m-active-poll", "POLL_EVENT", {
      poll_details: {
        metadata: {
          question_text: "次に何を歌う？",
          options: [{ option_text: "A", tally: 3 }, { option_text: "B", tally: 5 }],
        },
        status: 1,
      },
    }),
    items: [
      // 未宣言（公式）: text_message_details = 19
      message("m-text-full", "TEXT_MESSAGE_EVENT", {
        display_message: "こんにちは",
        text_message_details: { message_text: "こんにちは" },
      }),
      // 未宣言（公式）: user_banned_details = 22（ネストした ChannelProfileDetails 入り）
      message("m-banned", "USER_BANNED_EVENT", {
        user_banned_details: {
          banned_user_details: {
            channel_id: "UC_banned_secret",
            display_name: "BannedUser",
            channel_url: "https://www.youtube.com/channel/UC_banned_secret",
            profile_image_url: "https://example.invalid/banned.png",
          },
          ban_type: 2,
          ban_duration_seconds: "300",
        },
      }),
      // 未宣言（公式）: new_sponsor_details = 29
      message("m-sponsor-full", "NEW_SPONSOR_EVENT", {
        new_sponsor_details: { member_level_name: "レベル 1", is_upgrade: true },
      }),
      // 未宣言（公式）: poll_details = 33 ＝ 採用している gift_details = 34 の直前
      message("m-poll-full", "POLL_EVENT", {
        poll_details: { metadata: { question_text: "Q", options: [] }, status: 2 },
      }),
      // 未宣言（公式）: super_sticker_metadata = 5。採用フィールド（amount_micros/currency）が
      //   同じメッセージ内で正しく読めることまで確認する。
      message("m-sticker", "SUPER_STICKER_EVENT", {
        super_sticker_details: {
          amount_micros: "500000000",
          currency: "JPY",
          amount_display_string: "￥500",
          tier: 2,
          super_sticker_metadata: {
            sticker_id: "sticker-1",
            alt_text: "ステッカー",
            alt_text_language: "ja",
          },
        },
      }),
      // 隣接番号を跨いだ直後でも gift_details = 34 が正しく読めること。
      message("m-jewels-after", "GIFT_EVENT", {
        poll_details: { metadata: { question_text: "Q2", options: [] }, status: 1 },
        gift_details: { gift_name: "Rose", jewels_amount: 77 },
      }),
    ],
  });

  let comments = [];
  try {
    comments = mapYouTubeLiveChatMessagesToComments(RECEIVER.deserialize(bytes));
  } catch (e) {
    failures++;
    process.stderr.write(`FAIL 未宣言フィールドのスキップで例外: ${e.message}\n`);
  }
  // POLL_EVENT ×2 は未対応 type として落ち、残るのは text / banned(未対応) / sponsor / sticker / jewels。
  // USER_BANNED_EVENT も mapper 未対応なので落ちる → 期待は text / sponsor / sticker / jewels の 4 件。
  ok("skip: 隣接番号を跨いでも件数が合う", comments.length, 4);
  ok("skip: TEXT_MESSAGE_EVENT は normal", comments[0]?.eventType, "normal");
  ok("skip: NEW_SPONSOR_EVENT は membership", comments[1]?.eventType, "membership");
  ok("skip: SUPER_STICKER_EVENT の金額が正しく読める", comments[2]?.monetaryAmount, {
    currency: "JPY",
    amount: 500,
  });
  ok("skip: poll_details(33) の直後でも gift_details(34) が読める", comments[3]?.monetaryAmount, {
    currency: "JEWELS",
    amount: 77,
  });
  // §9: 未宣言フィールドに載っていた第三者情報が一切現れないこと。
  ok(
    "skip(§9): BAN された第三者の情報を受信しない",
    JSON.stringify(comments).includes("UC_banned_secret"),
    false,
  );
}

// ---------------------------------------------------------------------------
// C. §9: 受贈者/贈与者の個人情報を受信も保持もしない（受領側 details を丸ごと送っても漏れないこと）
// ---------------------------------------------------------------------------
{
  const decoded = roundTrip([
    message("m-received", "GIFT_MEMBERSHIP_RECEIVED_EVENT", {
      gift_membership_received_details: {
        member_level_name: "レベル 2 メンバー",
        gifter_channel_id: "UC_gifter_secret",
        associated_membership_gifting_message_id: "m-gifting",
      },
    }),
  ]);
  const asJson = JSON.stringify(decoded);
  ok("§9: デコード結果に gifter_channel_id が現れない", asJson.includes("UC_gifter_secret"), false);
  ok(
    "§9: デコード結果に受領側 details 自体が現れない",
    asJson.includes("gift_membership_received_details"),
    false,
  );
}

process.stderr.write(
  failures === 0 ? "\nYOUTUBE-MAPPER PASS\n" : `\nYOUTUBE-MAPPER FAIL (${failures})\n`,
);
process.exit(failures === 0 ? 0 : 1);
