// 043e: 受信面 → wire の**中継経路**（mapper が作った Comment → converter → wire）の単体検証。
// dist（tsc 出力）から converter と wire を import し、素の assert で表明する
// （test-host-guard.mjs / test-youtube-mapper.mjs と同じ体裁。テストフレームワークは足さない）。
//
//   pnpm --filter @stream-dock/comment-sidecar build:tsc
//   node apps/comment-sidecar/scripts/test-comment-relay.mjs
//
// 何を担保するか（＝仕様としてこうあるべき）:
//   A. **付随数値（monthCount / giftCount / tier / comboCount）が中継で 1 つも落ちない**。
//      043e の実装時に判明したとおり、この経路（entities/comment.ts → shared/comment-view.dto.ts →
//      comment-to-view.converter.ts → wire.ts）はフィールドを**明示列挙**して詰め替えるため、
//      1 箇所でも書き漏らすと**型検査もテストも通るのに値だけが静かに消える**（＝表示も記録も無言で欠落）。
//      mapper 側（test-youtube-mapper.mjs）は Comment までしか見ないので、その先はここでしか守れない。
//   B. **境界**: 未設定の付随数値は最後まで undefined のまま（勝手に 0 やキー生成へ劣化しない）。
//   C. **§9**: 中継後の CanonicalComment に受贈者情報・アバター取得元 URL 等が現れない。
//   D. **回帰**: eventType の写像と monetaryAmount（文字列＋数値 monetary）の既存変換を壊していない。
//
// dist の JS は `@comment-dock/*` の path alias を保持したまま emit されるため、
// dist-alias-loader.mjs を resolve フックとして登録する（登録後に動的 import する必要がある）。
import { register } from "node:module";

register("./dist-alias-loader.mjs", import.meta.url);

const { convertCommentToViewDto } = await import(
  "../dist/vendor/comment-delivery/src/adapters/presenters/converters/comment-to-view.converter.js"
);
const { toCanonicalComment } = await import("../dist/src/wire.js");

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
 * mapper（comment.mapper.ts）が返す Comment の最小形。
 * `author.avatar` は**未設定にしておく**: converter の resolveAvatarDataUri は空 URL を
 * fetch せず undefined を返す全域関数なので、本テストは一切ネットに出ない（§1）。
 */
const comment = (over = {}) => ({
  id: "m1",
  source: "youtube",
  author: { id: "u1", name: "Alice" },
  text: "hi",
  publishedAt: new Date("2026-01-01T00:00:00.000Z"),
  eventType: "normal",
  ...over,
});

/** Comment → CommentViewDto → CanonicalComment（実運用と同じ 2 段の中継を通す）。 */
const relay = async (c) => toCanonicalComment(await convertCommentToViewDto(c));

// ---- A. 付随数値が中継で 1 つも落ちない（043a の 3 つ ＋ 043e の comboCount）----
// **仕様**: 表示用に「通すと決めた」付随数値は、中継の各層で明示列挙されて最後まで到達する。
//   ここが落ちると 043b/043c の文言組み立てと 043e の「×N」表示が無言で消える。
{
  const c = await relay(
    comment({
      eventType: "jewels",
      monthCount: 12,
      giftCount: 5,
      tier: 3,
      comboCount: 7,
    }),
  );
  ok("relay: comboCount が wire まで到達する（043e・中継 3 ファイルの担保）", c.comboCount, 7);
  ok("relay: monthCount が wire まで到達する（043a 回帰）", c.monthCount, 12);
  ok("relay: giftCount が wire まで到達する（043a 回帰）", c.giftCount, 5);
  ok("relay: tier が wire まで到達する（043a 回帰）", c.tier, 3);
}

// 付随数値の**取りこぼしゼロ**を 1 本のアサートでも表明する（将来フィールドが増えたときの網）。
// **仕様**: 「通すと決めた付随数値」の集合は中継の前後で一致する。片側だけ増やすと落ちる。
{
  const RELAYED_NUMERIC_FIELDS = ["monthCount", "giftCount", "tier", "comboCount"];
  const source = { monthCount: 1, giftCount: 2, tier: 3, comboCount: 4 };
  const c = await relay(comment({ eventType: "jewels", ...source }));
  const dropped = RELAYED_NUMERIC_FIELDS.filter((k) => c[k] !== source[k]);
  ok("relay: 付随数値の取りこぼしゼロ（落ちたフィールド名の一覧が空）", dropped, []);
}

// ---- B. 境界: 未設定は最後まで undefined（0 やキー生成へ劣化しない）----
// **仕様**: 単発ギフト等で mapper が undefined へ落とした値は、中継でも undefined のまま
//   （Rust 側で None になる＝「×0」表示や誤った集計を作らない）。
{
  const c = await relay(comment({ eventType: "jewels" }));
  ok("relay(境界): comboCount 未設定は undefined のまま", c.comboCount, undefined);
  ok("relay(境界): monthCount 未設定は undefined のまま", c.monthCount, undefined);
  ok("relay(境界): giftCount 未設定は undefined のまま", c.giftCount, undefined);
  ok("relay(境界): tier 未設定は undefined のまま", c.tier, undefined);
}

// **仕様**: 0 は「値が来ていない」として mapper が落とす契約なので中継には現れないが、
//   万一 0 が渡っても中継は値を改変せずそのまま通す（判断は mapper の責務・中継は素通し）。
{
  const c = await relay(comment({ eventType: "jewels", comboCount: 0 }));
  ok("relay(境界): 0 も改変せず素通しする（劣化判断は mapper の責務）", c.comboCount, 0);
}

// ---- C. §9: 中継後に第三者の個人情報・取得元 URL が現れない ----
// **仕様**: 受贈者情報はそもそも受信しない（043d 決定1）。アバターは data URI 化済みのみで、
//   取得元 URL が wire に載ることは無い（載ると webview が外部 URL を踏む＝§CSP）。
{
  const c = await relay(
    comment({ eventType: "jewels", comboCount: 3, author: { id: "u1", name: "Alice" } }),
  );
  const asJson = JSON.stringify(c);
  ok("relay(§9): 出力に http(s) URL が現れない", /https?:\/\//.test(asJson), false);
  ok("relay(§9): 受領側フィールド名が現れない", asJson.includes("received"), false);
  ok("relay(§9): gifter/recipient 等の語が現れない", /gifter|recipient|受贈/.test(asJson), false);
}

// ---- D. 回帰: 既存の変換（eventType 写像・monetaryAmount）を壊していない ----
// **仕様**: jewels は eventType=jewels のまま、金額は表示文字列と数値 monetary の**両方**を通す
//   （数値側は視聴者メモリの集計に使うため落とせない＝Rust の UPDATE 列と対応する）。
{
  const c = await relay(
    comment({
      eventType: "jewels",
      monetaryAmount: { currency: "JEWELS", amount: 30 },
      comboCount: 3,
    }),
  );
  ok("relay(回帰): eventType 写像", c.eventType, "jewels");
  ok("relay(回帰): monetaryAmount 文字列", c.monetaryAmount, "30 JEWELS");
  ok("relay(回帰): monetary 数値も落とさない", c.monetary, { amount: 30, currency: "JEWELS" });
  ok("relay(回帰): publishedAt は ISO8601 文字列へ", c.publishedAt, "2026-01-01T00:00:00.000Z");
}

// **仕様**: BITS だけは表示文字列が特別（"N bits"）。043e で触っていないことの回帰。
{
  const c = await relay(
    comment({
      source: "twitch",
      eventType: "normal",
      monetaryAmount: { currency: "BITS", amount: 100 },
    }),
  );
  ok("relay(回帰): BITS の表示文字列", c.monetaryAmount, "100 bits");
  ok("relay(回帰): chat への写像（normal → chat）", c.eventType, "chat");
}

if (failures > 0) {
  console.error(`\nCOMMENT-RELAY FAILED: ${failures}`);
  process.exit(1);
}
console.log("\nCOMMENT-RELAY PASS");
