import { describe, it, expect } from "vitest";
import type { CommentViewDto } from "../../features/comment-viewer/types";
import type {
  EffectObsSource as EffectObsSourcePayload,
} from "./effectTrigger";
import {
  CONDITION_COOLDOWN_MAX_MS,
  createEffectTriggerState,
  createSeenEffectIds,
  decideEffects,
  EFFECT_DISPLAY_MS,
  EFFECT_MAX_CONCURRENT,
  takeFreshComments,
  type EffectMatcher,
  type EffectObsSource,
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

/** 064d: 発火先はもう「OBS 側のソース」1 種類だけ（テンプレートは取り込み機能ごと削除）。 */
const SOURCE_NAME = "きらきら演出";

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
 * ⚠ **ここに既定引数を復活させる変異は「型エラー」で落ちる**。
 */
const KIND = { kind: "obs-source", sourceName: SOURCE_NAME } as const;

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
  matcher: EffectMatcher = TPL,
  // ⚠ 063b 段 1-b: 戻り値は **matcher が返したペイロードだけ**になった（旧 `EffectRequestBase & …`）。
): EffectObsSourcePayload[] =>
  comments.flatMap((c) => decideEffects([c], [], state, at, matcher));

/**
 * ⚠⚠⚠ **063b 段 1-b: 「どの発火がどのコメント由来か」を見分けるための stub。**
 *
 * 戻り値からコメント由来の値が全部消えたので、`out.map(e => e.name)` のような
 * **投稿者で見分ける書き方ができなくなった**。⚠ 「件数だけ」に落とすと
 * 「1 件目を 2 回出す」変異が生き残るので、⚠⚠ **matcher が唯一見られる `text` を
 * ペイロードへ写して見分ける**（`EffectMatcher` は `{eventType, text}` しか受け取らない）。
 * ⚠ **これは stub の中だけの話である**——本番の matcher（`createEffectFireMatcher`）は
 * 本文をペイロードに載せない（§9・`EffectMatch` に載せる場所が型として無い）。
 */
const echoMatcher: EffectMatcher = ({ text }) => ({
  effect: { kind: "obs-source", sourceName: text },
  conditionId: "event:superchat",
  cooldownMs: 0,
});

describe("061b: decideEffects（発火層）", () => {
  it("課金コメントからエフェクトを 1 件出す", () => {
    const out = decideEffects([comment()], [], createEffectTriggerState(), T0, TPL);
    // ⚠⚠ 063b 段 1-b: 出るのは **matcher が返したペイロードそのもの**である
    //   （旧: 投稿者名・金額・種別ラベルも載っていた。⚠ **§9 で全廃した**）。
    expect(out).toEqual([KIND]);
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

  /**
   * ⚠⚠⚠ **063b 段 1-b: 「ビッツで出る」ケースをここから削除した。**
   *
   * 旧ケースは `out[0].eventLabel === "ビッツ"` / `out[0].tone === "bits"` を見ていたが、
   * ⚠⚠ **そのフィールドは §9 で全廃した**（`effectTrigger.ts` の 段 1-b 節が正）。
   * ⚠ 残る `toHaveLength(1)` は `TPL`（どんなコメントでも出す stub）では**何も検出しない**ので、
   * ケースごと落とすのが正直である。
   * ⚠ **失われたカバレッジはゼロ**——罠（`displayEventType` を噛ませるとビッツが落ちる）の担保は
   * 2 か所に在る: 本ファイルの「**matcher は生の eventType と本文を受け取る（ビッツは superchat として引ける）**」と、
   * `effectAssignments.test.ts` の「**OBS レーンでも課金ゲートは同じ**」。
   * ラベル・配色そのものは `viewerFormat.test.ts`（57 ケース）が持ち主である。
   */

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
    // ⚠ 063b 段 1-b: 投稿者名は戻り値に載らなくなったので、**本文で見分ける**（`echoMatcher`）。
    //   ⚠⚠ 件数だけを見ると「1 件目を 2 回出す」変異が生き残る。
    const out = feedOneByOne(
      [
        comment({ id: "g1", text: "A の贈与", eventType: "gift", author: { id: "u1", name: "A" } }),
        comment({ id: "g2", text: "B の贈与", eventType: "gift", author: { id: "u2", name: "B" } }),
      ],
      createEffectTriggerState(),
      T0,
      echoMatcher,
    );
    expect(out.map((e) => e.sourceName)).toEqual(["A の贈与", "B の贈与"]);
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

  it("⚠⚠⚠ 063b 段 1-b: 戻り値に**コメント由来の値が 1 つも載らない**（§9・キー集合で固定）", () => {
    // ⚠⚠⚠ **061j の担保より 1 段強い。** 061j は「**本文を書ける場所が型として無い**」だったが、
    //   段 1-b で `EffectRequestBase` を全廃したので、いまは
    //   **投稿者名・金額・種別ラベル・配色・元コメントの id も 1 つも載らない**
    //   ＝ 出ていくのは**ユーザー自身が作った設定**（OBS のソース名／ガチャの id）だけである。
    // ⚠ ここを落とすと、後から「便利だから」で `text` や `name` が足されて
    //   配信画面に第三者の自由入力が大写しになる（親 061 の判断が静かに崩れる）。
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
    // ⚠⚠ **matcher が返したペイロードのキーとちょうど一致する**（余分が 1 つも無い）。
    expect(Object.keys(out[0]).sort()).toEqual(["kind", "sourceName"].sort());
    expect(Object.keys(out[0]).sort()).toEqual(Object.keys(KIND).sort());
    const dump = JSON.stringify(out[0]);
    expect(dump).not.toContain("第三者の自由入力です");
    expect(dump).not.toContain("data:image");
    // ⚠ 投稿者名・金額・元コメントの id も出ない（段 1-b で落とした 6 つ）。
    expect(dump).not.toContain("視聴者A");
    expect(dump).not.toContain("1,000");
    expect(dump).not.toContain("c1");
  });

  /**
   * ⚠⚠⚠ **063b 段 1-b: 「文言（`composeEventMessage`）」と「配色（`monetaryTone`）」の
   * 2 ケースをここから削除した。**
   *
   * どちらも `out[0].message` / `out[0].tone` を見ていたが、⚠⚠ **そのフィールドは §9 で全廃した**
   * （`effectTrigger.ts` の 段 1-b 節が正）。
   * ⚠ 旧ケースの主張は「**文言と配色を 2 実装に分けない**（発火層も共有関数を使う）」だったが、
   * ⚠⚠⚠ **発火層はもう `viewerFormat` の文言・配色関数を 1 本も呼ばない**ので、
   * **主張する対象そのものが無くなった**（残るのは gift 畳み込み用の `viewerIdOf` だけ）。
   *
   * ⚠ **失われたカバレッジはゼロ**——`composeEventMessage` / `monetaryTone` / `eventLabel` の
   * 持ち主は `viewerFormat.test.ts`（57 ケース）で、そちらが
   * 「サブスクを3ヶ月継続しました（Tier2）」もティア配色も直接固定している。
   * ⚠ コメント欄のカード・ティッカー・読み上げ側の消費は
   * `CommentList.test.tsx` / `MonetaryTicker.test.tsx` / `speechText.test.ts` が持つ。
   */

  it("⚠ 063 への拡張余地として kind を持つ（064d 以降の唯一の variant は obs-source）", () => {
    const out = decideEffects([comment()], [], createEffectTriggerState(), T0, TPL);
    expect(out[0].kind).toBe("obs-source");
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
        effect: { kind: "obs-source", sourceName: "別の演出" },
        conditionId: "kw:9",
        cooldownMs: 0,
      }),
    );
    expect(out[0]).toMatchObject({
      kind: "obs-source",
      sourceName: "別の演出",
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

  it("⚠ matcher が返した発火先が**そのまま**載る（063b 段 1-b: 足しも引きもしない）", () => {
    const effect = { kind: "obs-source", sourceName: "tpl-1" } as const;
    const out = decideEffects(
      [comment()],
      [],
      createEffectTriggerState(),
      T0,
      () => ({ effect, conditionId: "event:superchat", cooldownMs: 0 }),
    );
    // ⚠⚠ **`toEqual` で丸ごと一致**＝ `decideEffects` が値を 1 つも足していないことの固定
    //   （旧: `EffectRequestBase` の 6 つが載っていたので、キー集合を列挙して比べるしかなかった）。
    expect(out).toEqual([effect]);
    // ⚠ 本文は載らない（§9）。
    expect(JSON.stringify(out[0])).not.toContain("本文です");
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
    expect(seen).toEqual([
      { eventType: "superchat", text: "Power-up 🎉", rewardTitle: undefined },
    ]);
  });

  it("⚠⚠ matcher に渡すのは `{eventType, text, rewardTitle}` の 3 つだけ（§9・DTO を持ち回らない）", () => {
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
    // ⚠⚠⚠ **063e 段 3 で 2 → 3 になった。** 増えたのは `rewardTitle`（＝**配信者自身が
    //   Twitch で付けた報酬名**）で、⚠ **第三者データは `text` のままである**
    //   ——この網の目的は「本文以外の第三者データを持ち回らせない」ことなので、目的は不変。
    //   ⚠⚠ **ここを増やすときは、増やす値が「ユーザー自身の設定値」か必ず確かめること。**
    expect(Object.keys(received ?? {}).sort()).toEqual([
      "eventType",
      "rewardTitle",
      "text",
    ]);
  });

  it("⚠⚠⚠ 063e 段 3: チャンネルポイントの報酬名がそのまま matcher へ渡る", () => {
    const seen: unknown[] = [];
    decideEffects(
      [
        comment({
          eventType: "channelpoint",
          text: "",
          rewardTitle: "ガチャを引く",
        }),
      ],
      [],
      createEffectTriggerState(),
      T0,
      (input) => {
        seen.push(input);
        return null;
      },
    );
    // ⚠ この 1 行が落ちると **出し分けが永久に効かない**（画面にもログにも何も出ない）。
    expect(seen).toEqual([
      { eventType: "channelpoint", text: "", rewardTitle: "ガチャを引く" },
    ]);
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
    // ⚠ 063b 段 1-b: **ペイロードに種別を写して**「出たのがスパチャであること」を見分ける
    //   （旧 `out[0].id` は戻り値から消えた）。
    const resolve: EffectMatcher = ({ eventType }) =>
      eventType === "subscription"
        ? null
        : {
            effect: { kind: "obs-source", sourceName: eventType },
            conditionId: `event:${eventType}`,
            cooldownMs: 0,
          };

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
    expect(out).toEqual([{ kind: "obs-source", sourceName: "superchat" }]);
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
    // ⚠ 063b 段 1-b: id は戻り値に載らなくなったので、**本文で見分ける**（`echoMatcher`）。
    const out = feedOneByOne(
      [comment({ id: "s1", text: "1 件目" }), comment({ id: "s2", text: "2 件目" })],
      state,
      T0,
      echoMatcher,
    );
    expect(out.map((r) => r.sourceName)).toEqual(["1 件目", "2 件目"]);
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

/**
 * 061k（判断 5・**新規 1 の本体**）: **もう一方の窓宛ての条件が、この窓の state を 1 バイトも汚さない。**
 *
 * ⚠⚠ **「出ない」だけを見るアサーションでは、判断 5 が却下した実装を殺せない。**
 * 却下したのは「`EffectRequest` に `output` を載せ、窓側で自分宛てでなければ捨てる」形で、
 * それでも**出力は同じ（出ない）**である。違うのは **`decideEffects` が発火時に
 * `recentFires.push` / `lastConditionAt.set` / `lastGiftAt.set` を書いてしまう**こと——
 * ＝ **コーナー窓のバースト枠がステージ用エフェクトに食われる**。
 *
 * ⚠ ここは `effectAssignments.ts` を通さず、**却下した実装を模した matcher** で
 * 「発火層の側から見て何が違うのか」を直接固定する（＝ 実装の置き場所が将来変わっても効く）。
 * ⚠⚠ **061j 追加穴 η・061d-2 穴 γ と同型の罠であり、これが 3 回目である。**
 */
describe("061k: 出力先の絞り込みは state を汚してはいけない（判断 5）", () => {
  /** ⚠ 採用した実装＝**自分宛てでなければ matcher が `null` を返す**（state に触れない）。 */
  const OTHER_WINDOW_SKIPS: EffectMatcher = () => null;

  it("⚠⚠ 相手の窓宛ての条件しかないとき、この窓の state のサイズが 1 つも増えない", () => {
    const state = createEffectTriggerState();
    const out = feedOneByOne(
      [comment({ id: "a" }), comment({ id: "b" }), comment({ id: "c" })],
      state,
    ).length;
    // 対照: 素の TPL matcher なら 3 件出て state も積まれる。
    expect(out).toBe(3);
    expect(state.recentFires.length).toBe(3);

    // 本題: 相手の窓宛て（matcher が null）なら **1 件も出ず、state も 1 つも増えない**。
    const other = createEffectTriggerState();
    for (const id of ["a", "b", "c"]) {
      expect(decideEffects([comment({ id })], [], other, T0, OTHER_WINDOW_SKIPS)).toHaveLength(0);
    }
    // ⚠⚠ **ここが本命の 3 行**（「出ない」だけを見ると、捨てる実装が生存する）。
    expect(other.recentFires.length).toBe(0);
    expect(other.lastConditionAt.size).toBe(0);
    expect(other.lastGiftAt.size).toBe(0);
  });

  it("⚠⚠ 相手の窓宛てが `EFFECT_MAX_CONCURRENT` 件続いても、直後の自分宛てが捨てられない", () => {
    // ⚠ これが「バースト枠を食われる」の具体形である。
    const state = createEffectTriggerState();
    for (let i = 0; i < EFFECT_MAX_CONCURRENT + 2; i++) {
      decideEffects([comment({ id: `other-${i}` })], [], state, T0, OTHER_WINDOW_SKIPS);
    }
    // 自分宛ての 1 件目は**必ず出る**（枠が消費されていないため）。
    const mine = decideEffects([comment({ id: "mine" })], [], state, T0, TPL);
    expect(mine).toHaveLength(1);
  });

  it("⚠⚠ 相手の窓宛ては、同じ条件 id のクールダウンも消費しない", () => {
    // ⚠ 「捨てる」実装だと `lastConditionAt` に相手ぶんの id が積まれ、
    //   **自分の窓で同じ条件が当たったときに黙って落ちる**（＝ 出るはずのものが出ない）。
    const state = createEffectTriggerState();
    decideEffects([comment({ id: "other", text: "草" })], [], state, T0, OTHER_WINDOW_SKIPS);
    expect(state.lastConditionAt.size).toBe(0);
    const m = keywordMatcher("草", "kw:1", 10_000);
    expect(decideEffects([comment({ id: "mine", text: "草" })], [], state, T0, m)).toHaveLength(1);
  });
});

/**
 * 064b: **発火先が 2 種類になった**ことの仕様テスト。
 *
 * ⚠⚠ 固定したい不変条件は 3 つ:
 *
 * **① `decideEffects` の 4 つの関門は、OBS レーンでも 1 実装のまま効く。**
 * 特に [043a] のコミュニティギフト N+1——別実装にすると **1 回の贈与で OBS のソースが 4 回鳴る**。
 *
 * **② レーンごとに `EffectTriggerState` を分ければ、枠を食い合わない。**
 * ⚠ 「出ない」だけを見ても分からないので、**state の 3 つのサイズを直接数える**。
 *
 * **③ 本文は発火層より先へ進まない**（§9）。`sourceName` は
 * **ユーザー自身が OBS で付けた名前**なので、第三者データではない。
 */
const OBS_SOURCE = KIND;

/** OBS レーンの matcher（イベント条件を模す＝クールダウン無効）。 */
const OBS: EffectMatcher<EffectObsSource> = () => ({
  effect: OBS_SOURCE,
  conditionId: "event:superchat",
  cooldownMs: 0,
});

describe("064b: OBS のソースを鳴らすレーン", () => {
  it("OBS レーンでも 1 件のコメントから 1 件出る（ペイロードは sourceName）", () => {
    const out = decideEffects([comment()], [], createEffectTriggerState(), T0, OBS);
    expect(out).toHaveLength(1);
    expect(out[0].sourceName).toBe("きらきら演出");
    expect(out[0].kind).toBe("obs-source");
  });

  it("⚠⚠ [043a] コミュニティギフトの N+1 は OBS レーンでも 1 件に畳まれる", () => {
    // ⚠ ここが別実装だと **1 回の贈与で OBS のソースが 4 回鳴る**。
    const state = createEffectTriggerState();
    const out = [
      comment({ id: "g0", eventType: "gift" }),
      comment({ id: "g1", eventType: "gift" }),
      comment({ id: "g2", eventType: "gift" }),
      comment({ id: "g3", eventType: "gift" }),
    ].flatMap((c) => decideEffects([c], [], state, T0, OBS));
    expect(out).toHaveLength(1);
  });

  it("⚠⚠ バースト上限も OBS レーンで効く（溜めずに捨てる）", () => {
    const state = createEffectTriggerState();
    const out = Array.from({ length: EFFECT_MAX_CONCURRENT + 3 }, (_, i) =>
      comment({ id: `s${i}`, author: { id: `u${i}`, name: `視聴者${i}` } }),
    ).flatMap((c) => decideEffects([c], [], state, T0, OBS));
    expect(out).toHaveLength(EFFECT_MAX_CONCURRENT);
  });

  it("⚠⚠ combo 更新（`updated`）からは 1 件も鳴らない", () => {
    const jewels = comment({ id: "j1", eventType: "jewels" });
    expect(
      decideEffects([], [jewels], createEffectTriggerState(), T0, OBS),
    ).toHaveLength(0);
  });

  it("⚠⚠ レーンごとに state を分ければ、相手の発火が枠を食わない", () => {
    // ⚠⚠ これが 061k の「窓ごとに state を持つ」を 3 本目のレーンへ広げた形。
    //   ⚠ 共有すると「OBS のソースが 3 回鳴っただけで直後の投げ銭が捨てられる」が起きる。
    const obsState = createEffectTriggerState();
    const templateState = createEffectTriggerState();
    for (let i = 0; i < EFFECT_MAX_CONCURRENT + 2; i++) {
      decideEffects([comment({ id: `o${i}` })], [], obsState, T0, OBS);
    }
    expect(templateState.recentFires.length).toBe(0);
    expect(templateState.lastConditionAt.size).toBe(0);
    expect(templateState.lastGiftAt.size).toBe(0);
    expect(
      decideEffects([comment({ id: "mine" })], [], templateState, T0, TPL),
    ).toHaveLength(1);
  });

  it("⚠⚠ 本文は戻り値に載らない（§9・063b 段 1-b: 載るのはペイロードだけ）", () => {
    const out = decideEffects(
      [comment({ text: "これは第三者の本文です" })],
      [],
      createEffectTriggerState(),
      T0,
      OBS,
    );
    // ⚠⚠ 段 1-b で `EffectRequestBase` の 6 つが消えたので、**キーはペイロードの 2 つだけ**。
    expect(Object.keys(out[0]).sort()).toEqual(["kind", "sourceName"].sort());
    expect(JSON.stringify(out[0])).not.toContain("第三者");
  });
});

/**
 * 064b: [`takeFreshComments`]（`EffectOverlayApp` から移した「一度見た id は二度と発火させない」）。
 *
 * ⚠⚠ **移設が正しく行われたことをここで固定する。** 消費者が 2 つ（エフェクト窓・コメビュ窓）に
 * なったので、規則が片方だけ緩むと **[043e] の combo 再送で二重に鳴る**。
 */
describe("064b: takeFreshComments", () => {
  it("初見のコメントはそのまま返る", () => {
    const seen = createSeenEffectIds();
    expect(takeFreshComments(seen, [comment({ id: "a" })])).toHaveLength(1);
  });

  it("⚠⚠ 同じ id は 2 度目に落ちる（[043e] の combo 再送）", () => {
    const seen = createSeenEffectIds();
    takeFreshComments(seen, [comment({ id: "a" })]);
    expect(takeFreshComments(seen, [comment({ id: "a" })])).toHaveLength(0);
  });

  it("⚠ 同じバッチ内の新旧が混ざっても、新しいものだけ返る", () => {
    const seen = createSeenEffectIds();
    takeFreshComments(seen, [comment({ id: "a" })]);
    const fresh = takeFreshComments(seen, [
      comment({ id: "a" }),
      comment({ id: "b" }),
    ]);
    expect(fresh.map((c) => c.id)).toEqual(["b"]);
  });

  it("⚠ 集合は上限までしか増えない（長時間の配信で増え続けない）", () => {
    const seen = createSeenEffectIds();
    for (let i = 0; i < 600; i++) {
      takeFreshComments(seen, [comment({ id: `c${i}` })]);
    }
    expect(seen.size).toBeLessThanOrEqual(500);
    // ⚠ 直近のものは残っている（＝捨てるのは古い順）。
    expect(seen.has("c599")).toBe(true);
  });
});
