import { describe, it, expect } from "vitest";
import type { CommentViewDto } from "../../features/comment-viewer/types";
import {
  createEffectTriggerState,
  decideEffects,
  EFFECT_DISPLAY_MS,
  EFFECT_MAX_CONCURRENT,
  type EffectRequest,
} from "./effectTrigger";

/**
 * 061b: 発火層（`decideEffects`）の仕様テスト。
 *
 * ⚠⚠ **この層が塞いでいるのは多重発火の 3 経路**で、どれも「実データでしか踏めない」ものばかりなので、
 * ここが唯一の防波堤になる:
 * 1. **[043e] Jewels の combo 再送** … 同じ id が更新として何度も届く（`updated` バケット）。
 * 2. **[043a] Twitch のコミュニティギフト N+1** … N 件の贈与で gift 行が N+1 個生成される。
 * 3. **バースト** … 大量の課金が一気に来たときに出し続けない（**キューに溜めない**）。
 *
 * ⚠⚠ **穴 H（着手時に判明）**: sidecar は `comments.append` を **1 件ずつ**送るので `added` は常に長さ 1。
 * ＝「バッチ内で畳む」「1 バッチ最大 N 件」では**実データで一度も発動しない**。だから 2 と 3 は
 * **時間窓を持つ状態**で判定する。本テストも**1 件ずつ渡す**ケースを主役に置く（実データと同じ形）。
 *
 * `now` は引数なので、**時計を偽装せず**に時間経過を表現できる（`vi.useFakeTimers` は使わない）。
 */

const T0 = 1_700_000_000_000;

const comment = (over: Partial<CommentViewDto> = {}): CommentViewDto => ({
  id: "c1",
  source: "youtube",
  author: { id: "u1", name: "視聴者A" },
  text: "本文です",
  publishedAt: "2026-08-09T00:00:00Z",
  eventType: "superchat",
  monetaryAmount: "¥1,000",
  monetary: { amount: 1000, currency: "JPY" },
  ...over,
});

/** 実データと同じ形＝**1 件ずつ**流す。戻り値は全バッチぶんを平坦化して返す。 */
const feedOneByOne = (
  comments: CommentViewDto[],
  state = createEffectTriggerState(),
  at = T0,
): EffectRequest[] =>
  comments.flatMap((c) => decideEffects([c], [], state, at));

describe("061b: decideEffects（発火層）", () => {
  it("課金コメントからエフェクトを 1 件出す", () => {
    const out = decideEffects([comment()], [], createEffectTriggerState(), T0);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("視聴者A");
    expect(out[0].amountText).toBe("¥1,000");
    expect(out[0].eventLabel).toBe("スーパーチャット");
  });

  it("⚠ 非課金コメント（通常チャット）からは出さない", () => {
    const out = decideEffects(
      [comment({ eventType: "chat", monetaryAmount: undefined, monetary: undefined })],
      [],
      createEffectTriggerState(),
      T0,
    );
    expect(out).toEqual([]);
  });

  it("⚠⚠ ビッツで出る（`isMonetaryEvent(displayEventType(c))` と書くと出なくなる）", () => {
    // ⚠ 059b が通知音で踏んだ誤りと同型。`displayEventType` は superchat+BITS を "bits" へ振り替えるが
    // "bits" は `MONETARY_EVENT_TYPES` に無い（あの Set は**生の eventType に適用する述語**）。
    // ここが落ちるなら `decideEffects` の課金判定が `displayEventType` を噛ませてしまっている。
    const out = decideEffects(
      [
        comment({
          eventType: "superchat",
          monetaryAmount: "100 bits",
          monetary: { amount: 100, currency: "BITS" },
        }),
      ],
      [],
      createEffectTriggerState(),
      T0,
    );
    expect(out).toHaveLength(1);
    expect(out[0].eventLabel).toBe("ビッツ");
    expect(out[0].tone).toBe("bits");
  });

  it("⚠⚠ `updated` からは 1 件も出さない（043e の combo 再送で光り続けない）", () => {
    const jewels = comment({
      id: "j1",
      eventType: "jewels",
      monetaryAmount: "30 jewels",
      monetary: { amount: 30, currency: "JEWELS" },
      comboCount: 5,
    });
    const out = decideEffects([], [jewels], createEffectTriggerState(), T0);
    expect(out).toEqual([]);
  });

  it("⚠ `added` と `updated` に同じものが来ても `added` の 1 件だけ（updated を足し込まない）", () => {
    const jewels = comment({ id: "j1", eventType: "jewels" });
    const out = decideEffects([jewels], [jewels], createEffectTriggerState(), T0);
    expect(out).toHaveLength(1);
  });

  // --- [043a] コミュニティギフト N+1 -------------------------------------------------------------

  it("⚠⚠ 同一投稿者の gift は時間窓内で 1 件へ畳まれる（N+1 で N+1 回出さない）", () => {
    // ⚠ **実データと同じく 1 件ずつ**流す（バッチ内畳み込みでは 1 件も減らない＝穴 H）。
    const gifts = [
      comment({ id: "g0", eventType: "gift", giftCount: 5, monetaryAmount: undefined, monetary: undefined }),
      ...Array.from({ length: 5 }, (_, i) =>
        comment({
          id: `g${i + 1}`,
          eventType: "gift",
          monetaryAmount: undefined,
          monetary: undefined,
        }),
      ),
    ];
    expect(gifts).toHaveLength(6); // community_sub_gift(total=5) ＋ 個別 sub_gift × 5 ＝ N+1
    expect(feedOneByOne(gifts)).toHaveLength(1);
  });

  it("⚠ 別の投稿者の gift は畳まれない（他人の贈与を巻き添えで消さない）", () => {
    const out = feedOneByOne([
      comment({ id: "g1", eventType: "gift", author: { id: "u1", name: "A" } }),
      comment({ id: "g2", eventType: "gift", author: { id: "u2", name: "B" } }),
    ]);
    expect(out.map((e) => e.name)).toEqual(["A", "B"]);
  });

  it("⚠ 畳み込みの判定キーは表示名ではなく安定 ID（改名しても畳まれる／同名でも別人は畳まれない）", () => {
    const state = createEffectTriggerState();
    // 同一 ID・改名 → 畳まれる。
    const renamed = feedOneByOne(
      [
        comment({ id: "g1", eventType: "gift", author: { id: "u1", name: "旧名" } }),
        comment({ id: "g2", eventType: "gift", author: { id: "u1", name: "新名" } }),
      ],
      state,
    );
    expect(renamed).toHaveLength(1);
    // 別 ID・同名 → 畳まれない。
    const sameName = feedOneByOne(
      [
        comment({ id: "g3", eventType: "gift", author: { id: "u9", name: "新名" } }),
      ],
      state,
    );
    expect(sameName).toHaveLength(1);
  });

  it("⚠ 時間窓を過ぎれば同一投稿者の gift もまた出る（永久に抑制しない）", () => {
    const state = createEffectTriggerState();
    const first = decideEffects(
      [comment({ id: "g1", eventType: "gift" })],
      [],
      state,
      T0,
    );
    expect(first).toHaveLength(1);
    // ⚠ 畳み込み窓もバースト窓も十分に過ぎた時刻で流す。
    const later = decideEffects(
      [comment({ id: "g2", eventType: "gift" })],
      [],
      state,
      T0 + 60_000,
    );
    expect(later).toHaveLength(1);
  });

  it("⚠ gift 以外は同一投稿者でも畳まれない（連投スパチャは全部出る）", () => {
    const out = feedOneByOne([
      comment({ id: "s1" }),
      comment({ id: "s2" }),
    ]);
    expect(out).toHaveLength(2);
  });

  // --- バースト上限 -------------------------------------------------------------------------------

  it("⚠⚠ 時間窓のバースト上限を超えた分は捨てる（キューに溜めない）", () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      comment({ id: `s${i}`, author: { id: `u${i}`, name: `視聴者${i}` } }),
    );
    expect(feedOneByOne(many)).toHaveLength(EFFECT_MAX_CONCURRENT);
  });

  it("⚠⚠ 捨てた分が後から出てこない（溜めていないことの担保）", () => {
    const state = createEffectTriggerState();
    const many = Array.from({ length: 20 }, (_, i) =>
      comment({ id: `s${i}`, author: { id: `u${i}`, name: `視聴者${i}` } }),
    );
    feedOneByOne(many, state, T0);
    // ⚠ 窓が明けたあと、**何も新しく届いていない**のにエフェクトが出たら「溜めている」ということ。
    expect(decideEffects([], [], state, T0 + 60_000)).toEqual([]);
  });

  it("⚠ 時間窓が明ければまた出せる（永久に止まらない）", () => {
    const state = createEffectTriggerState();
    const many = Array.from({ length: 20 }, (_, i) =>
      comment({ id: `s${i}`, author: { id: `u${i}`, name: `視聴者${i}` } }),
    );
    expect(feedOneByOne(many, state, T0)).toHaveLength(EFFECT_MAX_CONCURRENT);
    const after = decideEffects(
      [comment({ id: "later", author: { id: "u99", name: "後の人" } })],
      [],
      state,
      T0 + EFFECT_DISPLAY_MS,
    );
    expect(after).toHaveLength(1);
  });

  it("⚠ バースト窓は表示時間と同値（画面上の同時表示数が上限を超えない）", () => {
    // ⚠⚠ この 2 定数がずれると「画面に 3 件」の保証が壊れる。実装は片方から導出しているので
    // ここは**その意図を明示する**ためのテスト（値を直接ハードコードしない）。
    expect(EFFECT_DISPLAY_MS).toBeGreaterThan(0);
    expect(EFFECT_MAX_CONCURRENT).toBeGreaterThan(0);
    const state = createEffectTriggerState();
    const many = Array.from({ length: 10 }, (_, i) =>
      comment({ id: `s${i}`, author: { id: `u${i}`, name: `${i}` } }),
    );
    // 表示時間の「直前」までは追加で出ない＝出ている 3 件が消える前に 4 件目が出ない。
    feedOneByOne(many, state, T0);
    expect(
      decideEffects(
        [comment({ id: "x", author: { id: "ux", name: "x" } })],
        [],
        state,
        T0 + EFFECT_DISPLAY_MS - 1,
      ),
    ).toEqual([]);
  });

  it("⚠⚠ バーストで捨てた gift は畳み込みの記録に残さない（1 回も出ない状態を作らない）", () => {
    // ⚠⚠ 061b レビュー②Q-2・実測で生存した変異（`lastGiftAt.set` をバースト判定の**前**へ移す）。
    //   実装のコメントは「実際に出したときだけ記録する。捨てた分まで記録すると
    //   **1 件目が捨てられ 2 件目も畳まれて 1 回も出ない**」と明言しているのに、
    //   それを固定するケースが 1 つも無く、全 1347 件緑のまま変異が通っていた。
    // ⚠ 畳み込み窓もバースト窓も 5 秒なので、**捨てた時刻をずらす**のが要点——
    //   T0 に枠を埋め、T0+3000 に gift を捨てさせると、T0+5000 では
    //   「バースト枠は明けている／変異が書いた記録（T0+3000 起点）はまだ生きている」となり、差が出る。
    //   同時刻で捨てさせると両方の窓が同じ瞬間に明けてしまい、変異を観測できない。
    const state = createEffectTriggerState();
    // 別人のスパチャでバースト枠を埋め切る。
    feedOneByOne(
      Array.from({ length: EFFECT_MAX_CONCURRENT }, (_, i) =>
        comment({ id: `s${i}`, author: { id: `u${i}`, name: `${i}` } }),
      ),
      state,
      T0,
    );
    // この gift は**バーストで捨てられる**（枠が無い）。ここで記録してしまうのが変異。
    const dropped = decideEffects(
      [comment({ id: "g1", eventType: "gift", author: { id: "gifter", name: "G" } })],
      [],
      state,
      T0 + 3_000,
    );
    expect(dropped).toEqual([]);
    // バースト枠が明けたあと、同じ人の gift が**出ること**（捨てた分を記録していれば畳まれて出ない）。
    const after = decideEffects(
      [comment({ id: "g2", eventType: "gift", author: { id: "gifter", name: "G" } })],
      [],
      state,
      T0 + EFFECT_DISPLAY_MS,
    );
    expect(after).toHaveLength(1);
  });

  it("⚠ 畳み込みで落ちた gift はバースト枠を消費しない", () => {
    const state = createEffectTriggerState();
    // 同一投稿者の gift を 10 件（1 件だけ出る）。
    feedOneByOne(
      Array.from({ length: 10 }, (_, i) =>
        comment({ id: `g${i}`, eventType: "gift" }),
      ),
      state,
      T0,
    );
    // 枠は 1 しか使っていないので、別の投稿者のスパチャがまだ 2 件出せる。
    const out = feedOneByOne(
      [
        comment({ id: "s1", author: { id: "z1", name: "Z1" } }),
        comment({ id: "s2", author: { id: "z2", name: "Z2" } }),
        comment({ id: "s3", author: { id: "z3", name: "Z3" } }),
      ],
      state,
      T0,
    );
    expect(out).toHaveLength(EFFECT_MAX_CONCURRENT - 1);
  });

  // --- §9: EffectRequest が持つもの -------------------------------------------------------------

  it("⚠⚠ EffectRequest に本文（text）とアバターが含まれない（§9・テストで固定する）", () => {
    // ⚠ ここを落とすと、後から「便利だから」で `text` が足されて配信画面に第三者の自由入力が
    // 大写しになる（親 061 の判断が静かに崩れる）。**キー集合そのもの**を固定する。
    const out = decideEffects(
      [
        comment({
          text: "第三者の自由入力です",
          author: { id: "u1", name: "A", avatar: "data:image/png;base64,AAAA" },
        }),
      ],
      [],
      createEffectTriggerState(),
      T0,
    );
    expect(Object.keys(out[0]).sort()).toEqual(
      ["amountText", "eventLabel", "id", "kind", "message", "name", "tone"].sort(),
    );
    const dump = JSON.stringify(out[0]);
    expect(dump).not.toContain("第三者の自由入力です");
    expect(dump).not.toContain("data:image");
  });

  it("⚠ 金額を持たない種別は composeEventMessage の文を持つ（文言を 2 実装に分けない）", () => {
    const out = decideEffects(
      [
        comment({
          id: "sub1",
          source: "twitch",
          eventType: "subscription",
          monetaryAmount: undefined,
          monetary: undefined,
          monthCount: 3,
          tier: 1,
        }),
      ],
      [],
      createEffectTriggerState(),
      T0,
    );
    expect(out[0].amountText).toBeNull();
    expect(out[0].message).toBe("視聴者Aさんがサブスクを3ヶ月継続しました（Tier1）");
    expect(out[0].eventLabel).toBe("サブスク");
  });

  it("⚠ 配色は monetaryTone と同一（コメント欄のカードと同じ額が同じ色になる）", () => {
    const t6 = decideEffects(
      [comment({ monetaryAmount: "¥10,000", monetary: { amount: 10000, currency: "JPY" } })],
      [],
      createEffectTriggerState(),
      T0,
    );
    expect(t6[0].tone).toBe("t6");
    const t0 = decideEffects(
      [comment({ id: "x", monetaryAmount: "¥100", monetary: { amount: 100, currency: "JPY" } })],
      [],
      createEffectTriggerState(),
      T0,
    );
    expect(t0[0].tone).toBe("t0");
  });

  it("⚠ 061c/063 への拡張余地として kind を持つ", () => {
    const out = decideEffects([comment()], [], createEffectTriggerState(), T0);
    expect(out[0].kind).toBe("builtin-monetary");
  });

  // --- 状態が増え続けないこと ---------------------------------------------------------------------

  it("⚠ 時間窓の外は捨てられる（長時間の配信で状態が増え続けない）", () => {
    const state = createEffectTriggerState();
    feedOneByOne(
      Array.from({ length: 50 }, (_, i) =>
        comment({
          id: `g${i}`,
          eventType: "gift",
          author: { id: `u${i}`, name: `${i}` },
        }),
      ),
      state,
      T0,
    );
    expect(state.lastGiftAt.size).toBeGreaterThan(0);
    // 窓の外の時刻で 1 回呼ぶと掃除される。
    decideEffects([], [], state, T0 + 60_000);
    expect(state.lastGiftAt.size).toBe(0);
    expect(state.recentFires).toHaveLength(0);
  });
});
