import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  EFFECT_ASSIGNMENTS_KEY,
  GACHA_LIBRARY_KEY,
} from "../../features/comment-viewer/overlaySettings";
import type { CommentViewDto } from "../../features/comment-viewer/types";
import {
  addKeywordCondition,
  createEffectFireMatcher,
  GACHA_UNNAMED_PRIZE_LABEL,
  loadGachaLibrary,
  saveGachaLibrary,
  setConditionEffect,
  type GachaDefinition,
} from "./effectAssignments";
import {
  createEffectTriggerState,
  EFFECT_MAX_CONCURRENT,
  type EffectMatcher,
  type EffectTriggerState,
} from "./effectTrigger";
import {
  decideFireResults,
  GACHA_VIEWER_NAME_MAX,
  type EffectFire,
  type EffectFireResult,
} from "./effectFire";

/**
 * 063b: **ガチャが実際に発火するまでの経路**の仕様テスト（段 1-a）。
 *
 * ## ⚠⚠⚠ このファイルが固定している最重要の不変条件は 3 つ
 *
 * **① 抽選は「発火が確定してから」1 回だけ行われる。**
 * ⚠⚠ `select` の中で引くと ①当たっていない条件でも引く ②はずれが次の条件へ落ちる（穴 A）。
 * ⚠⚠⚠ **②は「出ない」を見るテストでは絶対に殺せない**（**出てはいる**——別の条件が代わりに鳴る）。
 * ⇒ **`random` の呼び出し回数**と**鳴ったソース名**の両方で固定する。
 *
 * **② はずれでもバースト枠とクールダウンを消費する**（＝「発火＝1 回引いた」）。
 * ⚠ 消費しないと、合計 30% のガチャは 7 割の確率で「無料でもう 1 回」になる。
 * ⚠⚠ **`recentFires` / `lastConditionAt` のサイズを直接数える**こと（「出ない」では殺せない）。
 *
 * **③ 指す先が無い／景品 0 件で、別のガチャへ黙って化けない。**
 *
 * ⚠ **`random` はすべて `countingRandom` で包む**——「引いた回数」こそが本ファイルの主要な観測量である。
 * ⚠ 時計は使わない（`now` は引数）。
 */

const T0 = 1_000_000;
const SRC_HIT = "大当たり演出";
const SRC_LOSE = "はずれ演出";
const SRC_DIRECT = "直指定ソース";
const OBS = { kind: "obs-source", sourceName: SRC_DIRECT } as const;

/** ⚠ 引いた回数を数える乱数。**戻り値は固定**（確率の規則そのものは `gachaDraw.test.ts` が持つ）。 */
const countingRandom = (value = 0) => {
  const fn = () => {
    fn.calls += 1;
    return value;
  };
  fn.calls = 0;
  return fn;
};

const comment = (over: Partial<CommentViewDto> = {}): CommentViewDto => ({
  id: "c1",
  source: "youtube",
  author: { id: "u1", name: "視聴者A" },
  text: "本文です",
  publishedAt: "2026-08-23T00:00:00Z",
  eventType: "superchat",
  monetaryAmount: "¥1,000",
  monetary: { amount: 1000, currency: "JPY" },
  ...over,
});

/** 重み 300（＝30%）1 件だけのガチャ。⚠ **合計 100% 未満なので「はずれ」が正常に起きる**。 */
const GACHA_30: GachaDefinition = {
  id: "g:1",
  name: "30% ガチャ",
  prizes: [
    {
      name: "大当たり",
      weight: 300,
      output: { kind: "obs-source", sourceName: SRC_HIT },
    },
  ],
};

/** ちょうど 100%（2 件）。⚠ 必ずどちらかに当たる。 */
const GACHA_100: GachaDefinition = {
  id: "g:2",
  name: "100% ガチャ",
  // ⚠ 景品名は**ソース名の部分文字列にしない**（§9 のケースで「載っていない」を判定できなくなる）。
  prizes: [
    {
      name: "景品アルファ",
      weight: 500,
      output: { kind: "obs-source", sourceName: SRC_HIT },
    },
    {
      name: "景品ベータ",
      weight: 500,
      output: { kind: "obs-source", sourceName: SRC_LOSE },
    },
  ],
};

const GACHA_EMPTY: GachaDefinition = {
  id: "g:3",
  name: "景品なし",
  prizes: [],
};

/**
 * ⚠ **実データと同じ形＝ 1 件ずつ流す**（sidecar は `comments.append` を 1 件ずつ送る）。
 * ⚠⚠ **`loadGachaLibrary` を関数のまま渡す**——本番（`CommentViewerApp`）と同じ渡し方にしないと、
 * 「鳴らす直前に読み直す」変異が殺せない。
 */
const feed = (
  comments: CommentViewDto[],
  random: () => number,
  state: EffectTriggerState = createEffectTriggerState(),
  matcher: EffectMatcher<EffectFire> = createEffectFireMatcher(),
  at = T0,
): EffectFireResult[] =>
  comments.flatMap((c) =>
    decideFireResults([c], [], state, at, matcher, loadGachaLibrary, random),
  );

/**
 * ⚠ 063c 段 2-a: **鳴った OBS のソース名だけ**を取り出す（063b までの `feed` の戻り値）。
 *
 * ⚠⚠ **組み込みの景品は [`BUILTIN_NAME`] として現れる**——落とさないのが要点である。
 * 落とすと「組み込みに化けた」変異が **`toEqual([])` を期待するケースで緑のまま通る**。
 */
const BUILTIN_NAME = "(組み込み)";
const names = (results: readonly EffectFireResult[]): string[] =>
  results.map((r) =>
    r.output.kind === "obs-source" ? r.output.sourceName : BUILTIN_NAME,
  );
const feedNames = (
  ...args: Parameters<typeof feed>
): string[] => names(feed(...args));

describe("063b: ガチャの発火（decideFireResults）", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  // --- 基本の発火 -----------------------------------------------------------------------

  it("⚠⚠⚠ 条件にガチャを割り当てると、当たった景品の OBS ソースが鳴る", () => {
    saveGachaLibrary([GACHA_100]);
    setConditionEffect("event:superchat", { kind: "gacha", gachaId: "g:2" });
    // ⚠ 0.0 → 1 件目（当たり）。0.6 → 2 件目。
    expect(feedNames([comment()], countingRandom(0))).toEqual([SRC_HIT]);
    localStorage.removeItem(GACHA_LIBRARY_KEY);
    saveGachaLibrary([GACHA_100]);
    expect(feedNames([comment()], countingRandom(0.6))).toEqual([SRC_LOSE]);
  });

  it("⚠⚠ 既存の「OBS ソース直指定」の条件が壊れていない（回帰）", () => {
    setConditionEffect("event:superchat", OBS);
    const random = countingRandom(0);
    expect(feedNames([comment()], random)).toEqual([SRC_DIRECT]);
    // ⚠ ガチャが 1 件も無いバッチでは**抽選を 1 度も呼ばない**。
    expect(random.calls).toBe(0);
  });

  it("⚠⚠ 合計 100% 未満のガチャは「はずれ」て何も鳴らない（最後の景品へ倒さない）", () => {
    saveGachaLibrary([GACHA_30]);
    setConditionEffect("event:superchat", { kind: "gacha", gachaId: "g:1" });
    // ⚠⚠⚠ 変異 4 を殺す: `-1` を「最後の景品」へ倒すと `[SRC_HIT]` が返る。
    expect(feedNames([comment()], countingRandom(0.99))).toEqual([]);
  });

  it("ちょうど 100% のガチャは必ず何かが鳴る", () => {
    saveGachaLibrary([GACHA_100]);
    setConditionEffect("event:superchat", { kind: "gacha", gachaId: "g:2" });
    for (const r of [0, 0.4999, 0.5, 0.999]) {
      localStorage.removeItem(GACHA_LIBRARY_KEY);
      saveGachaLibrary([GACHA_100]);
      expect(feedNames([comment()], countingRandom(r))).toHaveLength(1);
    }
  });

  // --- ③ 指す先が無い / 景品 0 件 ---------------------------------------------------------

  it("⚠⚠⚠ 一覧に無い `gachaId` では何も鳴らない（別のガチャへ黙って化けない）", () => {
    // ⚠ **一覧には別のガチャが在る**——変異 5（先頭へフォールバック）を殺すために必須。
    saveGachaLibrary([GACHA_100]);
    setConditionEffect("event:superchat", { kind: "gacha", gachaId: "g:404" });
    expect(feedNames([comment()], countingRandom(0))).toEqual([]);
  });

  it("⚠ 景品 0 件のガチャでは何も鳴らない", () => {
    saveGachaLibrary([GACHA_EMPTY]);
    setConditionEffect("event:superchat", { kind: "gacha", gachaId: "g:3" });
    expect(feedNames([comment()], countingRandom(0))).toEqual([]);
  });

  it("⚠ ガチャの一覧が空でも何も鳴らない（例外にしない）", () => {
    setConditionEffect("event:superchat", { kind: "gacha", gachaId: "g:1" });
    expect(feedNames([comment()], countingRandom(0))).toEqual([]);
  });

  // --- ① 抽選の位置（穴 A・変異 1／変異 2） -------------------------------------------------

  it("⚠⚠⚠ 穴 A: 当たっていない条件では抽選が 1 度も起きない（`random` の回数で固定）", () => {
    saveGachaLibrary([GACHA_100]);
    // ⚠ ガチャ条件は「A」にだけ当たる。流すのは「B」。
    addKeywordCondition(
      { text: "A", match: "contains" },
      {
        kind: "gacha",
        gachaId: "g:2",
      },
    );
    addKeywordCondition({ text: "B", match: "contains" }, OBS);
    const random = countingRandom(0);
    const fired = feedNames(
      [comment({ eventType: "chat", text: "B" })],
      random,
    );
    // ⚠⚠ **`select` の中で引く実装だと、走査の 1 件目（ガチャ条件）で必ず 1 回引く。**
    expect(random.calls).toBe(0);
    // ⚠⚠⚠ **かつ、鳴ったのは OBS 直指定のほう**（はずれが次の条件へ落ちたのではないこと）。
    expect(fired).toEqual([SRC_DIRECT]);
  });

  it("⚠⚠⚠ 穴 A: ガチャがはずれても、次の条件が代わりに発火しない", () => {
    saveGachaLibrary([GACHA_30]);
    // ⚠ 同じキーワードに 2 件——先に 30% ガチャ、後ろに OBS 直指定。
    addKeywordCondition(
      { text: "ガチャ", match: "contains" },
      {
        kind: "gacha",
        gachaId: "g:1",
      },
    );
    addKeywordCondition({ text: "ガチャ", match: "contains" }, OBS);
    const random = countingRandom(0.99); // ⚠ 必ずはずれる
    const fired = feedNames(
      [comment({ eventType: "chat", text: "ガチャ" })],
      random,
    );
    // ⚠⚠⚠ **`select` の中で引くと、はずれ（`null`）が「通さない kind」と区別できず
    //   `continue` して 2 件目の OBS 直指定が鳴る。** そちらは「1 件出ている」ので
    //   「出ない」を見るテストでは殺せない。
    expect(fired).toEqual([]);
    expect(random.calls).toBe(1);
  });

  it("⚠⚠ 変異 2: コミュニティギフト N+1 でも抽選は 1 回だけ（畳み込みが先）", () => {
    saveGachaLibrary([GACHA_100]);
    setConditionEffect("event:gift", { kind: "gacha", gachaId: "g:2" });
    const random = countingRandom(0);
    const gift = (id: string) =>
      comment({
        id,
        eventType: "gift",
        monetaryAmount: undefined,
        monetary: undefined,
      });
    const fired = feedNames(
      [gift("c1"), gift("c2"), gift("c3"), gift("c4")],
      random,
    );
    expect(random.calls).toBe(1);
    expect(fired).toHaveLength(1);
  });

  it("⚠⚠ 変異 2: バースト上限を超えたぶんは引かない", () => {
    saveGachaLibrary([GACHA_100]);
    setConditionEffect("event:superchat", { kind: "gacha", gachaId: "g:2" });
    const random = countingRandom(0);
    const fired = feedNames(
      Array.from({ length: 6 }, (_, i) => comment({ id: `c${i}` })),
      random,
    );
    // ⚠ 抽選が畳み込み・バースト検査より前に動くと 6 回引かれる。
    expect(random.calls).toBe(EFFECT_MAX_CONCURRENT);
    expect(fired).toHaveLength(EFFECT_MAX_CONCURRENT);
  });

  it("⚠⚠ `updated`（Jewels combo 再送）では引かない", () => {
    saveGachaLibrary([GACHA_100]);
    setConditionEffect("event:jewels", { kind: "gacha", gachaId: "g:2" });
    const random = countingRandom(0);
    const c = comment({ eventType: "jewels" });
    const out = decideFireResults(
      [],
      [c],
      createEffectTriggerState(),
      T0,
      createEffectFireMatcher(),
      loadGachaLibrary,
      random,
    );
    expect(out).toEqual([]);
    expect(random.calls).toBe(0);
  });

  it("⚠ キーワード条件のクールダウン内では引かない（10 秒に 1 回）", () => {
    saveGachaLibrary([GACHA_100]);
    addKeywordCondition(
      { text: "ガチャ", match: "contains" },
      {
        kind: "gacha",
        gachaId: "g:2",
      },
    );
    const random = countingRandom(0);
    const state = createEffectTriggerState();
    const matcher = createEffectFireMatcher();
    const chat = (id: string) =>
      comment({ id, eventType: "chat", text: "ガチャ" });
    feedNames([chat("c1"), chat("c2"), chat("c3")], random, state, matcher);
    expect(random.calls).toBe(1);
  });

  // --- ② はずれでも枠を消費する（変異 3） --------------------------------------------------

  it("⚠⚠⚠ 変異 3: はずれでもバースト枠を消費する（`recentFires` を直接数える）", () => {
    saveGachaLibrary([GACHA_30]);
    setConditionEffect("event:superchat", { kind: "gacha", gachaId: "g:1" });
    const state = createEffectTriggerState();
    const matcher = createEffectFireMatcher();
    const random = countingRandom(0.99); // ⚠ 全部はずれ
    const fired = feedNames(
      Array.from({ length: 5 }, (_, i) => comment({ id: `c${i}` })),
      random,
      state,
      matcher,
    );
    expect(fired).toEqual([]);
    // ⚠⚠ **鳴っていないのに枠は 3 つ埋まっている**＝「発火＝1 回引いた」の定義そのもの。
    expect(state.recentFires).toHaveLength(EFFECT_MAX_CONCURRENT);
    // ⚠ ＝ はずれで枠が減らないなら、5 回ぶん引けてしまう。
    expect(random.calls).toBe(EFFECT_MAX_CONCURRENT);
  });

  it("⚠⚠⚠ 変異 3: はずれでもクールダウンを消費する（`lastConditionAt` を直接数える）", () => {
    saveGachaLibrary([GACHA_30]);
    addKeywordCondition(
      { text: "ガチャ", match: "contains" },
      {
        kind: "gacha",
        gachaId: "g:1",
      },
    );
    const state = createEffectTriggerState();
    const matcher = createEffectFireMatcher();
    const random = countingRandom(0.99);
    const chat = (id: string) =>
      comment({ id, eventType: "chat", text: "ガチャ" });
    const fired = feedNames(
      [chat("c1"), chat("c2"), chat("c3")],
      random,
      state,
      matcher,
    );
    expect(fired).toEqual([]);
    // ⚠⚠ **1 回目だけが記録され、2 件目以降はクールダウンで落ちている。**
    expect(state.lastConditionAt.size).toBe(1);
    expect(random.calls).toBe(1);
  });

  it("⚠ はずれでも gift の畳み込み状態を消費する（同一投稿者の N+1 が漏れない）", () => {
    saveGachaLibrary([GACHA_30]);
    setConditionEffect("event:gift", { kind: "gacha", gachaId: "g:1" });
    const state = createEffectTriggerState();
    const matcher = createEffectFireMatcher();
    const random = countingRandom(0.99);
    const gift = (id: string) =>
      comment({
        id,
        eventType: "gift",
        monetaryAmount: undefined,
        monetary: undefined,
      });
    feedNames([gift("c1"), gift("c2"), gift("c3")], random, state, matcher);
    expect(state.lastGiftAt.size).toBe(1);
    expect(random.calls).toBe(1);
  });

  // --- 前方互換 / 混在 --------------------------------------------------------------------

  // ⚠⚠⚠ **守っているのは `parseAssignment`（1 枚目の網）である**——`select` の書き方
  //   （allow-list か `!== "none"` か）はこのケースに影響しない（ミューテーションで実測済み）。
  //   ⚠ `select` 側の担保は**コンパイル時**にしか存在しない（`createEffectFireMatcher` の JSDoc が正）。
  it("⚠⚠ 前方互換のガード: 未知の `kind` では何も鳴らず、抽選も起きない", () => {
    saveGachaLibrary([GACHA_100]);
    localStorage.setItem(
      EFFECT_ASSIGNMENTS_KEY,
      JSON.stringify([
        {
          id: "kw:1",
          when: { type: "keyword", text: "ガチャ", match: "contains" },
          effect: { kind: "future-lane", gachaId: "g:2" },
        },
      ]),
    );
    const random = countingRandom(0);
    expect(
      feedNames([comment({ eventType: "chat", text: "ガチャ" })], random),
    ).toEqual([]);
    expect(random.calls).toBe(0);
  });

  it("⚠⚠ 「出さない」条件はバースト枠もクールダウンも消費しない（061d-2 穴 γ の維持）", () => {
    saveGachaLibrary([GACHA_100]);
    for (let i = 0; i < 5; i++) {
      addKeywordCondition(
        { text: `語${i}`, match: "contains" },
        { kind: "none" },
      );
    }
    const state = createEffectTriggerState();
    const matcher = createEffectFireMatcher();
    const random = countingRandom(0);
    feedNames(
      Array.from({ length: 5 }, (_, i) =>
        comment({ id: `c${i}`, eventType: "chat", text: `語${i}` }),
      ),
      random,
      state,
      matcher,
    );
    expect(state.recentFires).toHaveLength(0);
    expect(state.lastConditionAt.size).toBe(0);
    expect(random.calls).toBe(0);
  });

  it("⚠ ガチャと OBS 直指定は同じバースト枠を共有する（レーンは 1 本）", () => {
    saveGachaLibrary([GACHA_100]);
    setConditionEffect("event:superchat", OBS);
    setConditionEffect("event:donation", { kind: "gacha", gachaId: "g:2" });
    const state = createEffectTriggerState();
    const matcher = createEffectFireMatcher();
    const fired = feedNames(
      [
        comment({ id: "c1" }),
        comment({ id: "c2" }),
        comment({ id: "c3", eventType: "donation" }),
        comment({ id: "c4", eventType: "donation" }),
      ],
      countingRandom(0),
      state,
      matcher,
    );
    // ⚠⚠ **出力先が同じ（どちらも OBS のソース）ので、枠の共有が正しい。**
    //   2 本レーンにすると 4 件すべて鳴り、画面上の同時表示が上限を超える。
    expect(fired).toHaveLength(EFFECT_MAX_CONCURRENT);
  });

  // --- 読み直しの規律 ---------------------------------------------------------------------

  it("⚠⚠ ガチャの一覧は鳴らす直前に読み直す（main 窓で編集した直後の 1 件目から効く）", () => {
    saveGachaLibrary([GACHA_100]);
    setConditionEffect("event:superchat", { kind: "gacha", gachaId: "g:2" });
    const state = createEffectTriggerState();
    const matcher = createEffectFireMatcher();
    expect(
      feedNames([comment({ id: "c1" })], countingRandom(0), state, matcher),
    ).toEqual([SRC_HIT]);
    // ⚠ 途中で景品を差し替える（main 窓での編集に相当）。
    localStorage.removeItem(GACHA_LIBRARY_KEY);
    saveGachaLibrary([
      {
        ...GACHA_100,
        prizes: [
          {
            name: "新景品",
            weight: 1000,
            output: { kind: "obs-source", sourceName: "新演出" },
          },
        ],
      },
    ]);
    expect(
      feedNames([comment({ id: "c2" })], countingRandom(0), state, matcher),
    ).toEqual(["新演出"]);
  });

  it("⚠ ガチャの発火が無いバッチでは一覧を 1 度も読まない", () => {
    setConditionEffect("event:superchat", OBS);
    let loads = 0;
    const out = decideFireResults(
      [comment()],
      [],
      createEffectTriggerState(),
      T0,
      createEffectFireMatcher(),
      () => {
        loads += 1;
        return [];
      },
      countingRandom(0),
    );
    expect(names(out)).toEqual([SRC_DIRECT]);
    expect(loads).toBe(0);
  });

  // --- §9 -----------------------------------------------------------------------------

  /**
   * ⚠⚠⚠ **このケースは 2 度書き換わっている。線がどこに在るかを追うならここを読むこと。**
   *
   * | いつ | 載ってよいもの |
   * |---|---|
   * | 061b 段 1-b | **何も載らない**（コメント由来の値は 1 つも無い） |
   * | 063c 段 2-a | ＋ **景品名**（＝ユーザー自身の入力。配信画面に出すのが 063c の目的） |
   * | ⚠⚠⚠ 063c 段 3 | ＋ **引いた視聴者の表示名 1 本だけ**（`docs/security.md` §9 追補） |
   *
   * ⚠⚠ **いまも載ってはいけないもの＝コメント本文・視聴者 id・金額・アバター**である。
   * ⚠ **「載る」と「載らない」を同じケースで同時に固定する**
   * （片方だけ残すと、次に触る人がもう片方を消せる）。
   */
  it("⚠⚠⚠ §9: 戻り値に載る第三者データは表示名だけ（本文・視聴者 id・金額は載らない）", () => {
    saveGachaLibrary([GACHA_100]);
    setConditionEffect("event:superchat", { kind: "gacha", gachaId: "g:2" });
    const out = feed(
      [
        comment({
          text: "これは第三者の本文です",
          author: { id: "u9", name: "視聴者Z" },
        }),
      ],
      countingRandom(0),
    );
    const dump = JSON.stringify(out);
    // ⚠⚠ **本文・視聴者 id・金額は載らない**（`EffectFireResult` に載せる場所が型として無い）。
    expect(dump).not.toContain("これは第三者の本文です");
    expect(dump).not.toContain("u9");
    expect(dump).not.toContain("1,000");
    // ⚠⚠⚠ **表示名は載る**（＝ 063c 段 3 が意図して開けた唯一の穴）。
    expect(out[0].gacha?.viewerName).toBe("視聴者Z");
    // ⚠ **自分の入力も載る**（＝ 063c 段 2-a が広げたぶん）。
    expect(names(out)).toEqual([SRC_HIT]);
    expect(out[0].gacha?.prizeLabel).toBe("景品アルファ");
  });

  // --- 063c 段 3: 誰が引いたか ／ レア ---------------------------------------------------

  /**
   * ⚠⚠⚠ **`decideFireResults` はコメントを 1 件ずつ `decideEffects` へ渡すようになった**（段 3）。
   * 「どのコメントがこの発火を起こしたか」を知るための実装で、
   * ⚠ **バッチごと渡した場合と結果が完全に同じ**であることに全体重を乗せている。
   * ⇒ **その等価性をここで直接固定する**（＝ `decideEffects` に「バッチ全体を見る規則」が
   * 足された瞬間、このテストがレッドになる）。
   *
   * ⚠⚠ 既存のテストは軒並み `feed`（1 件ずつ）を通るので、
   * **バッチで渡す経路を踏むのはこのケースだけ**である。消さないこと。
   */
  it("⚠⚠⚠ 1 回の呼び出しに 6 件まとめて渡しても、1 件ずつ渡したときと同じ結果になる", () => {
    const many = Array.from({ length: 6 }, (_, i) => comment({ id: `c${i}` }));
    const run = (batched: boolean): string[] => {
      localStorage.clear();
      saveGachaLibrary([GACHA_100]);
      setConditionEffect("event:superchat", { kind: "gacha", gachaId: "g:2" });
      const state = createEffectTriggerState();
      const matcher = createEffectFireMatcher();
      const random = countingRandom(0);
      const results = batched
        ? decideFireResults(
            many,
            [],
            state,
            T0,
            matcher,
            loadGachaLibrary,
            random,
          )
        : many.flatMap((c) =>
            decideFireResults(
              [c],
              [],
              state,
              T0,
              matcher,
              loadGachaLibrary,
              random,
            ),
          );
      // ⚠ バースト上限で捨てられた件数まで含めて同じであることを見る。
      return [...names(results), `random=${random.calls}`];
    };
    expect(run(true)).toEqual(run(false));
    // ⚠ 「どちらも 0 件」で通ってしまわないよう、実際に出ていることも見る。
    expect(run(true).length).toBeGreaterThan(1);
  });

  it("⚠⚠⚠ 引いた視聴者の表示名が結果に載る（§9 追補・063c 段 3）", () => {
    saveGachaLibrary([GACHA_100]);
    setConditionEffect("event:superchat", { kind: "gacha", gachaId: "g:2" });
    const out = feed([comment()], countingRandom(0));
    expect(out[0].gacha?.viewerName).toBe("視聴者A");
  });

  /**
   * ⚠⚠ **`decideFireResults` は「どのコメントが引いたか」を取り違えない。**
   * ⚠ 1 件ずつ渡す実装なので、**2 人ぶんを 1 回で渡したとき**にだけ壊れうる（＝ここで見る）。
   */
  it("⚠⚠ 複数人が同時に引いたら、それぞれの表示名が付く", () => {
    saveGachaLibrary([GACHA_100]);
    setConditionEffect("event:superchat", { kind: "gacha", gachaId: "g:2" });
    const out = decideFireResults(
      [
        comment({ id: "a", author: { id: "u1", name: "あかり" } }),
        comment({ id: "b", author: { id: "u2", name: "ばんり" } }),
      ],
      [],
      createEffectTriggerState(),
      T0,
      createEffectFireMatcher(),
      loadGachaLibrary,
      countingRandom(0),
    );
    expect(out.map((r) => r.gacha?.viewerName)).toEqual(["あかり", "ばんり"]);
  });

  it("⚠ 表示名が空なら null（空文字を配信画面へ出さない）", () => {
    saveGachaLibrary([GACHA_100]);
    setConditionEffect("event:superchat", { kind: "gacha", gachaId: "g:2" });
    const out = feed(
      [comment({ author: { id: "u1", name: "" } })],
      countingRandom(0),
    );
    expect(out[0].gacha?.viewerName).toBeNull();
  });

  /**
   * ⚠⚠⚠ **長い表示名はコードポイント単位で切る。**
   * ⚠ `slice` で切ると**絵文字を途中で割って壊れた文字が配信画面に出る**
   * （表示名に絵文字は普通に入る）。⇒ サロゲートペアを含む名前で固定する。
   */
  it("⚠⚠ 長い表示名は 20 文字で切って … を付ける（絵文字を割らない）", () => {
    saveGachaLibrary([GACHA_100]);
    setConditionEffect("event:superchat", { kind: "gacha", gachaId: "g:2" });
    const name = "🎁".repeat(30);
    const out = feed(
      [comment({ author: { id: "u1", name } })],
      countingRandom(0),
    );
    const cut = out[0].gacha?.viewerName ?? "";
    expect([...cut]).toHaveLength(GACHA_VIEWER_NAME_MAX + 1);
    expect(cut.endsWith("…")).toBe(true);
    // ⚠⚠ **壊れた文字（U+FFFD 相当の孤立サロゲート）が 1 つも無い**こと。
    expect([...cut].every((ch) => ch === "…" || ch === "🎁")).toBe(true);
  });

  it("⚠ ちょうど 20 文字なら切らない（境界）", () => {
    saveGachaLibrary([GACHA_100]);
    setConditionEffect("event:superchat", { kind: "gacha", gachaId: "g:2" });
    const name = "あ".repeat(GACHA_VIEWER_NAME_MAX);
    const out = feed(
      [comment({ author: { id: "u1", name } })],
      countingRandom(0),
    );
    expect(out[0].gacha?.viewerName).toBe(name);
  });

  /**
   * ⚠⚠⚠ **レアは「確率が低い景品」であって「当たったこと」ではない。**
   * ⚠ 100% の景品でレアが立つと、**毎回「レア！」が出る**＝ 段 2-b で「大当たり！」を
   * 却下した理由とまったく同じ嘘になる。
   */
  it("⚠⚠⚠ 10% 未満の景品だけ rare になる（100% の景品は rare ではない）", () => {
    saveGachaLibrary([
      {
        id: "g:9",
        name: "テスト",
        prizes: [
          { name: "ほぼ確定", weight: 901, output: { kind: "builtin" } },
          { name: "レア", weight: 99, output: { kind: "builtin" } },
        ],
      },
    ]);
    setConditionEffect("event:superchat", { kind: "gacha", gachaId: "g:9" });
    // ⚠ 0.0 → 1 件目（90.1%）／0.99 → 2 件目（9.9%）。
    expect(feed([comment()], countingRandom(0))[0].gacha?.rare).toBe(false);
    expect(
      feed([comment({ id: "c2" })], countingRandom(0.99))[0].gacha?.rare,
    ).toBe(true);
  });

  it("⚠⚠ ガチャではない発火（条件への直指定）は gacha が null（rare を持てない）", () => {
    setConditionEffect("event:superchat", OBS);
    expect(feed([comment()], countingRandom(0))[0].gacha).toBeNull();
  });

  it("⚠⚠ §9: 発火しても抽選履歴・当選者・視聴者 id が 1 バイトも保存されない", () => {
    saveGachaLibrary([GACHA_100]);
    setConditionEffect("event:superchat", { kind: "gacha", gachaId: "g:2" });
    feedNames(
      [comment({ author: { id: "u9", name: "視聴者Z" } })],
      countingRandom(0),
    );
    let all = "";
    for (let i = 0; i < localStorage.length; i++) {
      all += localStorage.getItem(localStorage.key(i) ?? "") ?? "";
    }
    for (const forbidden of [
      "history",
      "winner",
      "drawnAt",
      "当選",
      "u9",
      "視聴者Z",
    ]) {
      expect(all).not.toContain(forbidden);
    }
  });

  it("⚠⚠ §9: 発火しても localStorage のキーが 1 つも増えない（新しい保存先を作っていない）", () => {
    saveGachaLibrary([GACHA_100]);
    setConditionEffect("event:superchat", { kind: "gacha", gachaId: "g:2" });
    const before = localStorage.length;
    feedNames([comment()], countingRandom(0));
    expect(localStorage.length).toBe(before);
  });
});

/**
 * ⚠⚠⚠ **063c 段 2-a: 戻り値が広がったことの仕様**（`string[]` → [`EffectFireResult`]`[]`）。
 *
 * ⚠ **ここが固定しているのは 3 つ**:
 *   1. **ガチャかどうかが `gacha` の `null` で読める**（受け手が演出の有無を決める唯一の材料）
 *   2. **表示名の規則は [`gachaPrizeLabel`] に委ねている**（この層で組み立て直していない）
 *   3. ⚠⚠ **`{kind:"builtin"}` の景品は OBS のソース名を返さない**
 *      ＝ 064a の実在照合（sidecar の `GetInputList`）の**向こうへ行かない**
 */
describe("063c 段 2-a: 発火の結果（EffectFireResult）", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  const gachaOf = (prizes: GachaDefinition["prizes"]): GachaDefinition => ({
    id: "g:9",
    name: "テスト",
    prizes,
  });

  it("⚠⚠ 条件への直指定は gacha が null（＝ガチャではない）", () => {
    setConditionEffect("event:superchat", OBS);
    const out = feed([comment()], countingRandom(0));
    expect(out).toEqual([
      { output: { kind: "obs-source", sourceName: SRC_DIRECT }, gacha: null },
    ]);
  });

  it("⚠⚠ ガチャ由来は景品名が載る", () => {
    saveGachaLibrary([GACHA_100]);
    setConditionEffect("event:superchat", { kind: "gacha", gachaId: "g:2" });
    const out = feed([comment()], countingRandom(0));
    expect(out).toEqual([
      {
        output: { kind: "obs-source", sourceName: SRC_HIT },
        gacha: {
          prizeLabel: "景品アルファ",
          viewerName: "視聴者A",
          rare: false,
        },
      },
    ]);
  });

  it("⚠ 景品名が空なら OBS のソース名が表示名になる（gachaPrizeLabel に委ねている）", () => {
    saveGachaLibrary([
      gachaOf([
        {
          name: "",
          weight: 1000,
          output: { kind: "obs-source", sourceName: SRC_HIT },
        },
      ]),
    ]);
    setConditionEffect("event:superchat", { kind: "gacha", gachaId: "g:9" });
    expect(feed([comment()], countingRandom(0))[0].gacha?.prizeLabel).toBe(
      SRC_HIT,
    );
  });

  it("⚠ 名前もソースも無い景品（組み込み・無名）は GACHA_UNNAMED_PRIZE_LABEL", () => {
    saveGachaLibrary([
      gachaOf([{ name: "", weight: 1000, output: { kind: "builtin" } }]),
    ]);
    setConditionEffect("event:superchat", { kind: "gacha", gachaId: "g:9" });
    expect(feed([comment()], countingRandom(0))[0].gacha?.prizeLabel).toBe(
      GACHA_UNNAMED_PRIZE_LABEL,
    );
  });

  it("⚠⚠⚠ 組み込みの景品は OBS のソース名を 1 つも返さない（064a の壁の向こうへ行かない）", () => {
    saveGachaLibrary([
      gachaOf([
        { name: "組み込み当たり", weight: 1000, output: { kind: "builtin" } },
      ]),
    ]);
    setConditionEffect("event:superchat", { kind: "gacha", gachaId: "g:9" });
    const out = feed([comment()], countingRandom(0));
    expect(out).toEqual([
      {
        output: { kind: "builtin" },
        gacha: {
          prizeLabel: "組み込み当たり",
          viewerName: "視聴者A",
          rare: false,
        },
      },
    ]);
    // ⚠⚠ **ここが本質**——`sourceName` を持つ結果が 1 件も無いので、
    //   呼び出し側（`CommentViewerApp`）は OBS へ 1 バイトも送れない。
    expect(out.filter((r) => r.output.kind === "obs-source")).toEqual([]);
  });

  it("⚠ 組み込みとOBSソースは 1 つのガチャに混在できる", () => {
    saveGachaLibrary([
      gachaOf([
        { name: "A", weight: 500, output: { kind: "builtin" } },
        {
          name: "B",
          weight: 500,
          output: { kind: "obs-source", sourceName: SRC_HIT },
        },
      ]),
    ]);
    setConditionEffect("event:superchat", { kind: "gacha", gachaId: "g:9" });
    const state = createEffectTriggerState();
    const matcher = createEffectFireMatcher();
    expect(
      feed([comment({ id: "c1" })], countingRandom(0), state, matcher)[0]
        .output,
    ).toEqual({ kind: "builtin" });
    expect(
      feed([comment({ id: "c2" })], countingRandom(0.6), state, matcher)[0]
        .output,
    ).toEqual({ kind: "obs-source", sourceName: SRC_HIT });
  });
});
