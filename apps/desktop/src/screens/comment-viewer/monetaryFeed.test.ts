import { describe, it, expect } from "vitest";
import type { CommentViewDto } from "../../features/comment-viewer/types";
import { MONETARY_MAX, mergeMonetary } from "./monetaryFeed";

/**
 * 047: 課金ティッカーの蓄積ロジック（`mergeMonetary`）の仕様テスト。
 *
 * 仕様（こうあるべき）— monetaryFeed.ts の docstring が正:
 * - 通常 chat（と未知の種別）は**入らない**。課金 7 種別（スパチャ/ビッツ/サブスク/メンシプ/ギフト/
 *   ドネーション/ジュエル）は入る。ビッツは `eventType="superchat"` ＋ `currency="BITS"` で届く。
 * - 新着は**先頭**（＝ティッカーの左端）へ積む。
 * - 同一 id は件数を増やさない。**jewels の combo 更新だけ**中身を差し替える（金額が古いまま固まらない）。
 * - 上限 `MONETARY_MAX` を超えたら**最古（末尾）から**捨てる。
 * - 変化ゼロなら `prev` を**同一参照で**返す（無駄な再レンダを起こさない）。
 *
 * このテストが守っている最大の退行は「**200 件クランプで投げ銭が消える**」こと。`comments` から
 * `filter(isMonetaryEvent)` で導出する実装へ戻すと、下の「chat がいくら流れても課金は残る」が落ちる。
 */

/** テスト用のコメント 1 件（既定は通常チャット）。 */
const comment = (over: Partial<CommentViewDto> = {}): CommentViewDto => ({
  id: "c1",
  source: "youtube",
  author: { id: "u1", name: "Alice" },
  text: "hello",
  publishedAt: "2026-01-01T00:00:00Z",
  eventType: "chat",
  ...over,
});

/** テスト用の Jewels コメント（金額つき）。combo 更新は同じ id で金額だけ伸びて再送される。 */
const jewels = (over: Partial<CommentViewDto> = {}): CommentViewDto =>
  comment({
    id: "g1",
    eventType: "jewels",
    text: "",
    monetaryAmount: "30 jewels",
    monetary: { amount: 30, currency: "JEWELS" },
    ...over,
  });

describe("mergeMonetary 047 課金ティッカーの蓄積", () => {
  it("通常 chat はティッカーに入らない", () => {
    expect(mergeMonetary([], [comment(), comment({ id: "c2" })])).toEqual([]);
  });

  it("課金 7 種別はすべて入る（ビッツは superchat + BITS で届く）", () => {
    const incoming = [
      comment({ id: "m1", eventType: "superchat" }),
      comment({
        id: "m2",
        eventType: "superchat",
        monetary: { amount: 100, currency: "BITS" },
      }),
      comment({ id: "m3", eventType: "subscription" }),
      comment({ id: "m4", eventType: "membership" }),
      comment({ id: "m5", eventType: "gift" }),
      comment({ id: "m6", eventType: "donation" }),
      comment({ id: "m7", eventType: "jewels" }),
    ];
    expect(mergeMonetary([], incoming).map((c) => c.id)).toEqual([
      // 先頭が最新＝入力の逆順になる。
      "m7",
      "m6",
      "m5",
      "m4",
      "m3",
      "m2",
      "m1",
    ]);
  });

  it("新着は先頭（ティッカーの左端）へ積む", () => {
    const prev = mergeMonetary([], [comment({ id: "m1", eventType: "donation" })]);
    const next = mergeMonetary(prev, [comment({ id: "m2", eventType: "donation" })]);
    expect(next.map((c) => c.id)).toEqual(["m2", "m1"]);
  });

  it("chat がいくら流れても、蓄積済みの課金は消えない（200 件クランプ対策の核心）", () => {
    const prev = mergeMonetary([], [comment({ id: "m1", eventType: "superchat" })]);
    // 一覧側なら MAX_COMMENTS(=200) を優に超えて m1 が押し出される量。
    const chats = Array.from({ length: 300 }, (_, i) => comment({ id: `c${i}` }));
    const next = mergeMonetary(prev, chats);
    expect(next.map((c) => c.id)).toEqual(["m1"]);
    // chat は 1 件も変化を生まないので参照も据え置き。
    expect(next).toBe(prev);
  });

  it("同一 id の再送で件数が増えない", () => {
    const sc = comment({ id: "m1", eventType: "superchat" });
    const prev = mergeMonetary([], [sc]);
    expect(mergeMonetary(prev, [sc])).toHaveLength(1);
  });

  it("jewels の combo 更新で金額が差し替わる（古いまま固まらない）", () => {
    const prev = mergeMonetary([], [jewels()]);
    const next = mergeMonetary(prev, [
      jewels({
        monetaryAmount: "90 jewels",
        monetary: { amount: 90, currency: "JEWELS" },
        comboCount: 3,
      }),
    ]);
    // 行は増えず、中身だけ最新になる。
    expect(next).toHaveLength(1);
    expect(next[0].monetaryAmount).toBe("90 jewels");
    expect(next[0].comboCount).toBe(3);
  });

  // 【レビュー Q-1 で追加】このケースが無いと `hasComboPayloadChanged` のガードを**丸ごと削除しても
  // 全 269 テストがグリーン**になる（ミューテーション検証で生存を確認済み）。既存ケースは
  // 「同じ incoming を 2 回」が membership＝jewels 分岐の手前で continue、「同一 id の再送で件数が増えない」が
  // superchat かつ長さしか見ない、「combo 更新で差し替わる」が comparator の **true 側**しか通らない、で
  // false 側が空白だった。`mergeComments` から比較キーを export して共有している唯一の理由がこのガードなので、
  // 参照据え置きで固定する。
  it("jewels でも中身が変わっていなければ prev を同一参照で返す（比較キーの共有が効いている）", () => {
    const prev = mergeMonetary([], [jewels()]);
    expect(mergeMonetary(prev, [jewels()])).toBe(prev);
  });

  it("jewels 以外は同一 id で中身が変わっていても差し替えない（mergeComments と同じ規則）", () => {
    const prev = mergeMonetary(
      [],
      [comment({ id: "m1", eventType: "superchat", monetaryAmount: "1,000 JPY" })],
    );
    const next = mergeMonetary(prev, [
      comment({ id: "m1", eventType: "superchat", monetaryAmount: "9,999 JPY" }),
    ]);
    expect(next).toBe(prev);
    expect(next[0].monetaryAmount).toBe("1,000 JPY");
  });

  it("上限を超えたら最古（末尾）から捨てる", () => {
    const many = Array.from({ length: MONETARY_MAX + 5 }, (_, i) =>
      comment({ id: `m${i}`, eventType: "donation" }),
    );
    const next = mergeMonetary([], many);
    expect(next).toHaveLength(MONETARY_MAX);
    // 先頭は最後に届いたもの、末尾は「最古から 5 件捨てたあとの最古」。
    expect(next[0].id).toBe(`m${MONETARY_MAX + 4}`);
    expect(next[next.length - 1].id).toBe("m5");
  });

  it("変化ゼロなら prev を同一参照で返す（無駄な再レンダを起こさない）", () => {
    const prev = mergeMonetary([], [comment({ id: "m1", eventType: "gift" })]);
    expect(mergeMonetary(prev, [])).toBe(prev);
    expect(mergeMonetary(prev, [comment({ id: "c9" })])).toBe(prev);
  });

  it("同じ incoming を 2 回渡しても結果が変わらない（StrictMode の二重実行に耐える）", () => {
    const incoming = [comment({ id: "m1", eventType: "membership" })];
    const once = mergeMonetary([], incoming);
    expect(mergeMonetary(once, incoming)).toBe(once);
  });
});
