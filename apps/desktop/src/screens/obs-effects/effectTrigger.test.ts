import { describe, it, expect } from "vitest";
import type { CommentViewDto } from "../../features/comment-viewer/types";
import {
  CONDITION_COOLDOWN_MAX_MS,
  createEffectTriggerState,
  decideEffects,
  EFFECT_DISPLAY_MS,
  EFFECT_MAX_CONCURRENT,
  type EffectMatcher,
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

/** テンプレート id（形は問われないが、実物に合わせて uuid の形にしておく）。 */
const TEMPLATE_ID = "93c76e02-1111-4222-8333-444455556666";

/**
 * ⚠⚠ **061h: resolver は「省略できる第 5 引数」ではなく必須の引数になった。**
 *
 * 061d-2 は `resolveKind: EffectKindResolver = () => BUILTIN_KIND` と**既定つき**にして、
 * 「061b までの 21 ケースが 1 文字も書き換わらない＝発火判定に手が入っていないことを
 * `git diff` で示せる」という担保を作っていた。⚠ **061h はその担保を意図的に捨てている**——
 * 既定が消えると「**割り当てを引かずにエフェクトが出る**」経路が**型として消える**からで、
 * それが 061h の目的そのものである（判断の全文は docs/progress.md の 061h 節）。
 * ＝ **下のケースは全部この resolver を明示的に渡す**（＝「何を出すか」を決めているのは
 * 常に呼び出し側であることが、テストの字面にも現れる）。
 * ⚠ **ここに既定引数を復活させる変異は「型エラー」で落ちる**（`{ kind: "builtin-monetary" }` は
 * もう `EffectKind` ではない）。
 */
const KIND = { kind: "template", templateId: TEMPLATE_ID } as const;

/**
 * ⚠⚠ **061j: resolver は `EffectMatcher` になった**（`{eventType, text}` を受け、
 * `{effect, conditionId, cooldownMs}` を返す）。**課金判定もこの向こう側へ移った**ので、
 * このスタブは「どんなコメントでも出す」＝**発火層のロジックだけ**を裸で試せる形になっている。
 * ⚠ 既定の `conditionId` は `"event:superchat"`（クールダウン無効＝ 061h までと同じ振る舞い）。
 */
const TPL: EffectMatcher = () => ({
  effect: KIND,
  conditionId: "event:superchat",
  cooldownMs: 0,
});

/** ⚠ 課金種別だけ出す matcher（061h までの `decideEffects` 先頭のゲートを模す）。 */
const MONETARY_ONLY: EffectMatcher = ({ eventType }) =>
  MONETARY_TYPES.has(eventType)
    ? { effect: KIND, conditionId: `event:${eventType}`, cooldownMs: 0 }
    : null;

const MONETARY_TYPES = new Set([
  "superchat",
  "subscription",
  "membership",
  "gift",
  "donation",
  "jewels",
]);

/** キーワード条件を模す matcher（クールダウンあり・本文で当てる）。 */
const keywordMatcher = (
  keyword: string,
  conditionId = "kw:1",
  cooldownMs = 10_000,
): EffectMatcher => ({ text }) =>
  text.includes(keyword)
    ? { effect: KIND, conditionId, cooldownMs }
    : null;

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
  comments.flatMap((c) => decideEffects([c], [], state, at, TPL));

describe("061b: decideEffects（発火層）", () => {
  it("課金コメントからエフェクトを 1 件出す", () => {
    const out = decideEffects([comment()], [], createEffectTriggerState(), T0, TPL);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("視聴者A");
    expect(out[0].amountText).toBe("¥1,000");
    expect(out[0].eventLabel).toBe("スーパーチャット");
  });

  it("⚠⚠ 061j: 課金判定は matcher の責務になった（発火層は種別を 1 つも知らない）", () => {
    const chat = comment({
      eventType: "chat",
      monetaryAmount: undefined,
      monetary: undefined,
    });
    // ⚠ matcher が「課金だけ」と言えば通常チャットは出ない（061h までの振る舞い）。
    expect(
      decideEffects([chat], [], createEffectTriggerState(), T0, MONETARY_ONLY),
    ).toEqual([]);
    // ⚠⚠ **matcher が当てれば通常チャットでも出る**——これが 061j の本命
    //   （ゲートを `decideEffects` の先頭へ戻す変異は、この 1 行がレッドにする）。
    expect(
      decideEffects([chat], [], createEffectTriggerState(), T0, TPL),
    ).toHaveLength(1);
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
      TPL,
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
    const out = decideEffects([], [jewels], createEffectTriggerState(), T0, TPL);
    expect(out).toEqual([]);
  });

  it("⚠ `added` と `updated` に同じものが来ても `added` の 1 件だけ（updated を足し込まない）", () => {
    const jewels = comment({ id: "j1", eventType: "jewels" });
    const out = decideEffects([jewels], [jewels], createEffectTriggerState(), T0, TPL);
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
      TPL,
    );
    expect(first).toHaveLength(1);
    // ⚠ 畳み込み窓もバースト窓も十分に過ぎた時刻で流す。
    const later = decideEffects(
      [comment({ id: "g2", eventType: "gift" })],
      [],
      state,
      T0 + 60_000,
      TPL,
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
    expect(decideEffects([], [], state, T0 + 60_000, TPL)).toEqual([]);
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
      TPL,
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
        TPL,
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
      TPL,
    );
    expect(dropped).toEqual([]);
    // バースト枠が明けたあと、同じ人の gift が**出ること**（捨てた分を記録していれば畳まれて出ない）。
    const after = decideEffects(
      [comment({ id: "g2", eventType: "gift", author: { id: "gifter", name: "G" } })],
      [],
      state,
      T0 + EFFECT_DISPLAY_MS,
      TPL,
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
      TPL,
    );
    // ⚠ 061h: 組み込み経路（7 キー）が消え、**常に 8 キー**になった（`templateId` が必ず載る）。
    expect(Object.keys(out[0]).sort()).toEqual(
      [
        "amountText",
        "eventLabel",
        "id",
        "kind",
        "message",
        "name",
        "templateId",
        "tone",
      ].sort(),
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
      TPL,
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
      TPL,
    );
    expect(t6[0].tone).toBe("t6");
    const t0 = decideEffects(
      [comment({ id: "x", monetaryAmount: "¥100", monetary: { amount: 100, currency: "JPY" } })],
      [],
      createEffectTriggerState(),
      T0,
      TPL,
    );
    expect(t0[0].tone).toBe("t0");
  });

  it("⚠ 063 への拡張余地として kind を持つ（061h 以降の唯一の variant は template）", () => {
    const out = decideEffects([comment()], [], createEffectTriggerState(), T0, TPL);
    expect(out[0].kind).toBe("template");
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
    decideEffects([], [], state, T0 + 60_000, TPL);
    expect(state.lastGiftAt.size).toBe(0);
    expect(state.recentFires).toHaveLength(0);
  });

  // --- 061d-2: 割り当ての resolver（①・穴 γ） ---------------------------------------------------
  //
  // ⚠⚠ **061h: 上の全ケースへ resolver（`TPL`）を明示的に渡す形へ書き換えた。**
  //   061d-2 は「既定つきの第 5 引数なので 061b までの 21 ケースが 1 文字も書き換わらない」
  //   （＝発火判定に手が入っていないことを `git diff` で示せる）という担保を作っていたが、
  //   **061h はその担保を意図的に捨てている**——既定が消えることで
  //   「割り当てを引かずにエフェクトが出る」経路が型として消えるほうが価値が高いため。
  //   ⚠ **発火判定（課金判定・combo 再送・gift 畳み込み・バースト）のロジックは 061h でも 1 行も
  //   動いていない**。上のケースの差分が `TPL` の 1 引数だけであることが、その代わりの担保になる。

  it("⚠⚠ 発火層は「何を出すか」を 1 つも知らない（matcher が返した effect がそのまま載る）", () => {
    // ⚠ 061h: 既定引数を外したので、**渡した matcher の結果が唯一の答え**になる
    //   （061d-2 の「省略すると全部『組み込み』」ケースは、この形へ置き換わった）。
    const out = decideEffects(
      [comment()],
      [],
      createEffectTriggerState(),
      T0,
      () => ({
        effect: { kind: "template", templateId: "0f0e0d0c-1111-4222-8333-444455556666" },
        conditionId: "kw:9",
        cooldownMs: 0,
      }),
    );
    expect(out[0]).toMatchObject({
      kind: "template",
      templateId: "0f0e0d0c-1111-4222-8333-444455556666",
    });
    // ⚠⚠ **`conditionId` は `EffectRequest` に載らない**（判断 4・「出すのに要る最小限」の維持）。
    expect(out[0]).not.toHaveProperty("conditionId");
    expect(out[0]).not.toHaveProperty("cooldownMs");
  });

  it("⚠⚠ matcher が null を返すコメントは 1 件も出ない（＝エフェクトを出さない）", () => {
    const out = decideEffects(
      [comment()],
      [],
      createEffectTriggerState(),
      T0,
      () => null,
    );
    expect(out).toEqual([]);
  });

  it("⚠ matcher がテンプレートを返すと kind と templateId が載る（キー集合は 8 個）", () => {
    const out = decideEffects(
      [comment()],
      [],
      createEffectTriggerState(),
      T0,
      () => ({
        effect: { kind: "template", templateId: "tpl-1" },
        conditionId: "event:superchat",
        cooldownMs: 0,
      }),
    );
    expect(out).toHaveLength(1);
    expect(Object.keys(out[0]).sort()).toEqual(
      [
        "amountText",
        "eventLabel",
        "id",
        "kind",
        "message",
        "name",
        "templateId",
        "tone",
      ].sort(),
    );
    // ⚠ 本文・アバターは**テンプレート経路でも**載らない（§9）。
    const dump = JSON.stringify(out[0]);
    expect(dump).not.toContain("本文です");
  });

  it("⚠ matcher は生の eventType と本文を受け取る（ビッツは superchat として引ける）", () => {
    const seen: { eventType: string; text: string }[] = [];
    decideEffects(
      [comment({ text: "Power-up 🎉", monetary: { amount: 300, currency: "BITS" } })],
      [],
      createEffectTriggerState(),
      T0,
      (input) => {
        seen.push(input);
        return { effect: KIND, conditionId: "event:superchat", cooldownMs: 0 };
      },
    );
    // ⚠ `displayEventType` を通すと "bits" になるが、`MONETARY_EVENT_TYPES` に "bits" は無い
    //   ＝ 条件表（スーパーチャットの行）と引き当てられなくなる（061b の穴②と同型の罠）。
    expect(seen).toEqual([{ eventType: "superchat", text: "Power-up 🎉" }]);
  });

  it("⚠⚠ matcher に渡すのは `{eventType, text}` の 2 つだけ（§9・DTO を持ち回らない）", () => {
    let received: Record<string, unknown> | null = null;
    decideEffects(
      [comment({ text: "本文です" })],
      [],
      createEffectTriggerState(),
      T0,
      (input) => {
        received = input as unknown as Record<string, unknown>;
        return null;
      },
    );
    // ⚠ `CommentViewDto` をそのまま渡す変異は、このキー集合がレッドにする
    //   （author / monetary / publishedAt 等が混ざる）。
    expect(Object.keys(received ?? {}).sort()).toEqual(["eventType", "text"]);
  });

  // --- 穴 γ: 「出さない」の判定位置 -------------------------------------------------------------

  it("⚠⚠ 新規 5: 当たらないコメントは state を 1 バイトも書き換えない（穴 γ の本体）", () => {
    // ⚠⚠ **061j でこの不変条件の重みが桁で上がった。** 061h までは非課金コメントが
    //   `decideEffects` 先頭のゲートで落ちていたが、いまは**全コメントがループを通る**ので、
    //   ここで枠を 1 つでも積むと「キーワードに当たらない通常チャットが投げ銭を捨てる」が**常時**起きる。
    // ⚠⚠ **「何も出ない」だけを見るアサーションでは殺せない**（061h の変異⑤ / 061i の変異⑨-b の教訓）
    //   ——**その操作自身の副作用と、観測したい状態変化を分けて数える**。
    const skipped = createEffectTriggerState();
    for (let i = 0; i < 20; i++) {
      decideEffects(
        [
          comment({
            id: `n${i}`,
            eventType: "chat",
            text: "こんばんは〜",
            monetaryAmount: undefined,
            monetary: undefined,
            author: { id: `u${i}`, name: `${i}` },
          }),
        ],
        [],
        skipped,
        T0,
        keywordMatcher("草"),
      );
    }
    // ⚠⚠ **state の 3 つを直接数える**（`recentFires.push` を `match === null` の前へ動かす変異＝
    //   「非マッチが枠を食う」を作る変異は、この 3 行がレッドにする）。
    expect(skipped.recentFires).toHaveLength(0);
    expect(skipped.lastGiftAt.size).toBe(0);
    expect(skipped.lastConditionAt.size).toBe(0);
  });

  it("⚠⚠ 新規 5（続き）: 当たらないチャットが 20 件流れても、直後の投げ銭は全部出る", () => {
    const state = createEffectTriggerState();
    // 「草」を含まない通常チャットを 20 件（バースト上限 3 の 6 倍以上）。
    for (let i = 0; i < 20; i++) {
      decideEffects(
        [comment({ id: `n${i}`, eventType: "chat", text: "こんばんは〜" })],
        [],
        state,
        T0,
        keywordMatcher("草"),
      );
    }
    // ⚠ 直後の投げ銭が**上限ぶん全部**出る（＝キーワード条件を入れたせいで投げ銭が捨てられない）。
    const out = feedOneByOne(
      Array.from({ length: EFFECT_MAX_CONCURRENT }, (_, i) =>
        comment({ id: `sc${i}` }),
      ),
      state,
      T0,
    );
    expect(out).toHaveLength(EFFECT_MAX_CONCURRENT);
  });

  it("⚠⚠ 「出さない」種別はバースト枠も gift 畳み込み状態も消費しない", () => {
    const state = createEffectTriggerState();
    feedOneByOne(
      Array.from({ length: 5 }, (_, i) =>
        comment({
          id: `g${i}`,
          eventType: "gift",
          monetaryAmount: undefined,
          monetary: undefined,
          author: { id: `u${i}`, name: `${i}` },
        }),
      ),
      state,
      T0,
    );
    // ⚠ まず「出す」状態を確認しておく（対照）。
    expect(state.recentFires.length).toBeGreaterThan(0);

    const skipped = createEffectTriggerState();
    for (let i = 0; i < 5; i++) {
      decideEffects(
        [
          comment({
            id: `n${i}`,
            eventType: "gift",
            monetaryAmount: undefined,
            monetary: undefined,
            author: { id: `u${i}`, name: `${i}` },
          }),
        ],
        [],
        skipped,
        T0,
        () => null,
      );
    }
    expect(skipped.recentFires).toHaveLength(0);
    expect(skipped.lastGiftAt.size).toBe(0);
    expect(skipped.lastConditionAt.size).toBe(0);
  });

  it("⚠⚠ 「出さない」種別が枠を食って、出すはずの種別が捨てられることが無い", () => {
    const state = createEffectTriggerState();
    // 「サブスクは出さない／スーパーチャットはテンプレート」という条件。
    const resolve: EffectMatcher = ({ eventType }) =>
      eventType === "subscription"
        ? null
        : { effect: KIND, conditionId: `event:${eventType}`, cooldownMs: 0 };

    // サブスクをバースト上限より多く流す（全部「出さない」）。
    for (let i = 0; i < EFFECT_MAX_CONCURRENT + 2; i++) {
      decideEffects(
        [
          comment({
            id: `s${i}`,
            eventType: "subscription",
            monetaryAmount: undefined,
            monetary: undefined,
          }),
        ],
        [],
        state,
        T0,
        resolve,
      );
    }
    // 直後のスーパーチャットは**必ず出る**（判定が後ろにあると枠が尽きて捨てられる）。
    const out = decideEffects([comment({ id: "sc" })], [], state, T0, resolve);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("sc");
  });

  it("⚠ 「出す」種別は従来どおりバースト上限で切られる（穴 γ の対処で上限が緩んでいない）", () => {
    const state = createEffectTriggerState();
    const out = feedOneByOne(
      Array.from({ length: EFFECT_MAX_CONCURRENT + 3 }, (_, i) =>
        comment({ id: `c${i}` }),
      ),
      state,
      T0,
    );
    expect(out).toHaveLength(EFFECT_MAX_CONCURRENT);
    // 表示時間ぶん経てば窓が空く（バースト窓の値そのものは 061h でも不変）。
    expect(
      decideEffects([comment({ id: "later" })], [], state, T0 + EFFECT_DISPLAY_MS, TPL),
    ).toHaveLength(1);
  });

  // --- 061j: 条件ごとのクールダウン（判断 7） ----------------------------------------------------

  const COOLDOWN = 10_000;
  /** 通常チャット 1 件（本文だけ変える）。 */
  const chat = (id: string, text: string) =>
    comment({ id, eventType: "chat", text, monetaryAmount: undefined, monetary: undefined });

  it("⚠⚠ 新規 6-a: 同じ条件はクールダウン内で 1 回だけ出る", () => {
    const state = createEffectTriggerState();
    const m = keywordMatcher("草", "kw:1", COOLDOWN);
    expect(decideEffects([chat("a", "草")], [], state, T0, m)).toHaveLength(1);
    // 窓の内側（9.999 秒後）は出ない。
    expect(
      decideEffects([chat("b", "草")], [], state, T0 + COOLDOWN - 1, m),
    ).toHaveLength(0);
    // 窓を過ぎればまた出る（＝永久に止まらない）。
    expect(
      decideEffects([chat("c", "草")], [], state, T0 + COOLDOWN, m),
    ).toHaveLength(1);
  });

  it("⚠⚠ 新規 6-b: 別の条件はクールダウンを共有しない", () => {
    const state = createEffectTriggerState();
    /** 「草」→ kw:1、「w」→ kw:2 という 2 条件。 */
    const m: EffectMatcher = ({ text }) =>
      text.includes("草")
        ? { effect: KIND, conditionId: "kw:1", cooldownMs: COOLDOWN }
        : text.includes("w")
          ? { effect: KIND, conditionId: "kw:2", cooldownMs: COOLDOWN }
          : null;
    expect(decideEffects([chat("a", "草")], [], state, T0, m)).toHaveLength(1);
    // ⚠ 直後でも**別の条件**なら出る（id をキーにしていないと落ちる）。
    expect(decideEffects([chat("b", "www")], [], state, T0 + 1, m)).toHaveLength(1);
    // 同じ条件の 2 件目は落ちる。
    expect(decideEffects([chat("c", "草")], [], state, T0 + 2, m)).toHaveLength(0);
  });

  it("⚠⚠ 新規 7: イベント条件（`cooldownMs: 0`）にはクールダウンが効かない", () => {
    // ⚠ 課金は 1 件ずつが重要（スパチャ 2 連投の 2 件目を落としたくない）。
    const state = createEffectTriggerState();
    const out = feedOneByOne(
      [comment({ id: "s1" }), comment({ id: "s2" })],
      state,
      T0,
    );
    expect(out.map((r) => r.id)).toEqual(["s1", "s2"]);
    // ⚠ `cooldownMs > 0` の判定を外して全条件に効かせる変異は、この 1 行がレッドにする。
    expect(state.lastConditionAt.size).toBe(0);
  });

  it("⚠⚠ 変異⑤: クールダウンの記録は**実際に出したときだけ**（発火回数で数える）", () => {
    // ⚠⚠ **「何も出ない」だけを見ても殺せない**（061h の変異⑤ / 061i の変異⑨-b の教訓）。
    //   捨てたときにも記録する実装だと、**バーストで落ちた条件がそのあと沈黙する**。
    //   ⇒ **バーストで捨てさせてから、窓が明けた時点の発火回数を数える。**
    const state = createEffectTriggerState();
    const m: EffectMatcher = ({ text }) =>
      text.includes("草")
        ? { effect: KIND, conditionId: "kw:1", cooldownMs: COOLDOWN }
        : { effect: KIND, conditionId: "event:superchat", cooldownMs: 0 };

    // ① バースト枠（3）を「草」以外で埋める。
    for (let i = 0; i < EFFECT_MAX_CONCURRENT; i++) {
      decideEffects([chat(`f${i}`, "こんばんは")], [], state, T0, m);
    }
    expect(state.recentFires).toHaveLength(EFFECT_MAX_CONCURRENT);

    // ② 「草」はバーストで捨てられる（＝1 件も出ない）。
    expect(decideEffects([chat("k1", "草")], [], state, T0, m)).toHaveLength(0);
    // ⚠⚠ **ここが観測点**——捨てた分を記録していれば `kw:1` が載る。
    expect(state.lastConditionAt.has("kw:1")).toBe(false);

    // ③ バースト窓が明けた直後（クールダウンより短い）に「草」がもう一度来る。
    const fired = decideEffects(
      [chat("k2", "草")],
      [],
      state,
      T0 + EFFECT_DISPLAY_MS,
      m,
    );
    // ⚠ 捨てた分まで記録する変異だと、ここが **0 件**になる（＝1 回も出ない）。
    expect(fired).toHaveLength(1);
  });

  it("⚠ クールダウンの状態は時間窓の外で捨てられる（長時間の配信で増え続けない）", () => {
    const state = createEffectTriggerState();
    const m = keywordMatcher("草", "kw:1", COOLDOWN);
    decideEffects([chat("a", "草")], [], state, T0, m);
    expect(state.lastConditionAt.size).toBe(1);
    // ⚠ 出力では観測できないので **`size` を直接見る**（掃除を外す変異はここでしか殺せない）。
    decideEffects([], [], state, T0 + CONDITION_COOLDOWN_MAX_MS, m);
    expect(state.lastConditionAt.size).toBe(0);
  });

  it("⚠ クールダウンの判定は gift 畳み込みより前（落とした分で畳み込み状態を汚さない）", () => {
    const state = createEffectTriggerState();
    const gift = (id: string) =>
      comment({
        id,
        eventType: "gift",
        text: "草",
        monetaryAmount: undefined,
        monetary: undefined,
      });
    const m = keywordMatcher("草", "kw:1", COOLDOWN);
    expect(decideEffects([gift("g1")], [], state, T0, m)).toHaveLength(1);
    expect(state.lastGiftAt.size).toBe(1);
    // ⚠ 2 件目はクールダウンで落ちる。⚠ このとき `lastGiftAt` が**更新されない**こと
    //   （更新されると gift の畳み込み窓が延び続ける）。
    const before = state.lastGiftAt.get("youtube:u1");
    decideEffects([gift("g2")], [], state, T0 + 1_000, m);
    expect(state.lastGiftAt.get("youtube:u1")).toBe(before);
  });
});
