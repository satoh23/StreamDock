import { describe, it, expect } from "vitest";
import type { GachaPrize } from "./effectAssignments";
import {
  drawGachaPrizeIndex,
  GACHA_PERCENT_SCALE,
  GACHA_PROBABILITY_UNAVAILABLE_TEXT,
  gachaPercentToWeight,
  gachaProbabilityText,
  gachaTotalPercentText,
  gachaTotalWeight,
  gachaWeightToPercent,
  GACHA_RARE_MAX_PERCENT,
  isGachaOverAllocated,
  isGachaRarePrize,
} from "./gachaDraw";

/**
 * 063a: 確率表示と抽選の仕様テスト。
 *
 * ⚠⚠ **この 1 ファイルが固定している最重要の不変条件は 2 つ。**
 *
 * **① 穴 D の丸め規則**（各行は四捨五入して 1 桁）。
 * ⚠⚠ **「丸めた各行の％を足すと 100.0% にならない」**——1/1/1 で 99.9%、1/3/3 で 100.1% になる。
 * ⇒ **丸めた％の和を画面に出さない**（合計は必ず**重みの合計から直接**出す）という決定を、
 * ここで検算ごと固定する。
 * ⚠ **1/3/3 と 1/1/1 は必ずケースに入れること**（この 2 つが「和では出せない」の証拠そのもの）。
 * ⚠⚠⚠ **063a-2 の「合計行は固定表記 `"100%"`」は撤回済み**（合計はもう 100% に固定されない）。
 * 合計行の期待値は下の `gachaTotalPercentText` のケースが正である。
 *
 * **② 0 除算しない**。⚠ `weight` は 1 以上が保証されている（`parseGachaPrize`）ので
 * 合計 0 は景品 0 件のときだけだが、**その 1 経路を型ではなくテストで塞ぐ**。
 */

// ⚠ 063c 段 2-a: `sourceName` → `output`。⚠⚠ **抽選は出力先を 1 バイトも見ない**ので、
//   ここは「型として要る」だけである（見るようになったらこのテストが嘘になる）。
const p = (weight: number, name = `p${weight}`): GachaPrize => ({
  name,
  weight,
  output: { kind: "obs-source", sourceName: `src-${name}` },
});

/** 重みの並びから、各行の確率表示を取り出す。 */
const texts = (weights: readonly number[]): string[] => {
  const prizes = weights.map((w) => p(w));
  const total = gachaTotalWeight(prizes);
  return prizes.map((prize) => gachaProbabilityText(prize.weight, total));
};

/** ⚠ 丸めた％を実際に足した値（＝**画面には出さない**値）。検算のためだけに使う。 */
const roundedSum = (weights: readonly number[]): number =>
  texts(weights).reduce((a, t) => a + Number(t.replace("%", "")), 0);

describe("gachaDraw（063a: 確率の表示）", () => {
  it("⚠⚠ 重み 1/3/6 は 10.0% / 30.0% / 60.0%（063a の完了条件そのもの）", () => {
    expect(texts([1, 3, 6])).toEqual(["10.0%", "30.0%", "60.0%"]);
    expect(roundedSum([1, 3, 6])).toBeCloseTo(100.0, 5);
  });

  it("⚠⚠ 重み 1/3/3 は 14.3% / 42.9% / 42.9%（丸めた和は **100.1%** になる）", () => {
    expect(texts([1, 3, 3])).toEqual(["14.3%", "42.9%", "42.9%"]);
    // ⚠⚠ **これが「合計が常に 100.0%」を達成できない証拠**である。
    expect(roundedSum([1, 3, 3])).toBeCloseTo(100.1, 5);
  });

  it("⚠⚠ 重み 1/1/1 は 33.3% ×3（丸めた和は **99.9%** になる）", () => {
    expect(texts([1, 1, 1])).toEqual(["33.3%", "33.3%", "33.3%"]);
    expect(roundedSum([1, 1, 1])).toBeCloseTo(99.9, 5);
  });

  it("⚠ 重み 1 ×7 は 14.3% ×7（丸めた和は **100.1%**）", () => {
    expect(texts([1, 1, 1, 1, 1, 1, 1])).toEqual(Array(7).fill("14.3%"));
    expect(roundedSum([1, 1, 1, 1, 1, 1, 1])).toBeCloseTo(100.1, 5);
  });

  it("⚠ 重みを変えると確率がその場で変わる（保存された確率を読んでいない）", () => {
    expect(gachaProbabilityText(1, gachaTotalWeight([p(1), p(1)]))).toBe(
      "50.0%",
    );
    expect(gachaProbabilityText(1, gachaTotalWeight([p(1), p(3)]))).toBe(
      "25.0%",
    );
  });

  it("⚠⚠ 合計が 0 でも 0 除算しない（景品 0 件）", () => {
    expect(gachaTotalWeight([])).toBe(0);
    expect(gachaProbabilityText(1, 0)).toBe(GACHA_PROBABILITY_UNAVAILABLE_TEXT);
    expect(gachaProbabilityText(1, -1)).toBe(
      GACHA_PROBABILITY_UNAVAILABLE_TEXT,
    );
  });
});

describe("gachaDraw（063a-3: ％はその行だけの値）", () => {
  /**
   * ⚠⚠⚠ **063a-2 の「正規化（合計を 1000 に保つ）」は削除した。**
   * あれが「**フォーム側が補正されるからめっちゃ使いにくい**」（依頼者・2026-08-22）の正体で、
   * **行どうしが連動し、入力の順番に依存し、超過した入力が黙って元へ戻る**原因だった。
   * ⚠ **`normalize` 相当を書き戻さないこと。**
   */
  const w = (...weights: number[]): GachaPrize[] =>
    weights.map((weight, i) => ({
      name: `p${i}`,
      weight,
      output: { kind: "obs-source", sourceName: `src-${i}` } as const,
    }));

  it("⚠⚠ ％と重みは 1 対 1（0.1% 刻み・他の行に依存しない）", () => {
    expect(gachaPercentToWeight(10)).toBe(100);
    expect(gachaPercentToWeight(0.1)).toBe(1);
    expect(gachaPercentToWeight(100)).toBe(GACHA_PERCENT_SCALE);
    expect(gachaWeightToPercent(100)).toBe(10);
    expect(gachaWeightToPercent(1)).toBeCloseTo(0.1, 10);
  });

  it("⚠⚠⚠ 他の行を足しても、その行の％は変わらない（063s の痛点＝％が信用できない、を消す）", () => {
    const before = w(gachaPercentToWeight(10));
    const after = w(gachaPercentToWeight(10), gachaPercentToWeight(30));
    expect(gachaWeightToPercent(before[0].weight)).toBe(10);
    expect(gachaWeightToPercent(after[0].weight)).toBe(10);
  });

  it("合計の表示は重みの合計から 1 回で出す", () => {
    expect(gachaTotalPercentText(w(100, 300))).toBe("40.0%");
    expect(gachaTotalPercentText(w(333, 333, 334))).toBe("100.0%");
    expect(gachaTotalPercentText([])).toBe("0.0%");
  });

  it("⚠⚠ 合計が 100% を超えているかを判定できる（⚠ **入力を戻す代わりの伝え方**）", () => {
    expect(isGachaOverAllocated(w(500, 500))).toBe(false);
    expect(isGachaOverAllocated(w(500, 501))).toBe(true);
    expect(isGachaOverAllocated([])).toBe(false);
  });
});

describe("gachaDraw（063a-3: 分母は 1000 固定＝「はずれ」がある）", () => {
  const w = (...weights: number[]): GachaPrize[] =>
    weights.map((weight, i) => ({
      name: `p${i}`,
      weight,
      output: { kind: "obs-source", sourceName: `src-${i}` } as const,
    }));

  it("⚠⚠⚠ 打った％がそのまま当たる確率になる（合計で割らない）", () => {
    // 10% の景品 1 つだけ＝ 90% は「何も出ない」。
    const prizes = w(gachaPercentToWeight(10));
    expect(drawGachaPrizeIndex(prizes, () => 0)).toBe(0);
    expect(drawGachaPrizeIndex(prizes, () => 0.099)).toBe(0);
    // ⚠⚠ 合計で割っていたら、ここは必ず 0 に当たってしまう。
    expect(drawGachaPrizeIndex(prizes, () => 0.1)).toBe(-1);
    expect(drawGachaPrizeIndex(prizes, () => 0.99)).toBe(-1);
  });

  it("⚠⚠ 合計が 100% 未満なら「はずれ」が出る（最後の景品へ倒さない）", () => {
    const prizes = w(gachaPercentToWeight(10), gachaPercentToWeight(20));
    expect(drawGachaPrizeIndex(prizes, () => 0.05)).toBe(0);
    expect(drawGachaPrizeIndex(prizes, () => 0.25)).toBe(1);
    expect(drawGachaPrizeIndex(prizes, () => 0.31)).toBe(-1);
    expect(drawGachaPrizeIndex(prizes, () => 0.999)).toBe(-1);
  });

  it("ちょうど 100% なら必ずどれかに当たる", () => {
    const prizes = w(
      gachaPercentToWeight(10),
      gachaPercentToWeight(30),
      gachaPercentToWeight(60),
    );
    expect(drawGachaPrizeIndex(prizes, () => 0)).toBe(0);
    expect(drawGachaPrizeIndex(prizes, () => 0.099)).toBe(0);
    expect(drawGachaPrizeIndex(prizes, () => 0.1)).toBe(1);
    expect(drawGachaPrizeIndex(prizes, () => 0.399)).toBe(1);
    expect(drawGachaPrizeIndex(prizes, () => 0.4)).toBe(2);
    expect(drawGachaPrizeIndex(prizes, () => 0.999)).toBe(2);
  });

  it("⚠ 景品 0 件は `-1`", () => {
    expect(drawGachaPrizeIndex([], () => 0.5)).toBe(-1);
  });
});

/**
 * ⚠⚠⚠ **063c 段 3: 「レア！」を出してよいかの判定。**
 *
 * ⚠⚠ **これが「レア！」の表示を嘘にしない根拠である**——分母が 1000 固定なので
 * `weight` は**ユーザーが設定画面に打った％そのもの**であり、
 * ⚠ **他の行を 1 つも見ない**（合計で割った相対確率ではない＝穴 D）。
 *
 * ⚠⚠⚠ **境界を含めないこと**（`<` であって `<=`）。
 * 含めると「10% と打った景品は毎回レア」になり、**きりのいい既定値がレア扱い**になる。
 */
describe("063c 段 3: isGachaRarePrize", () => {
  const w = (...weights: number[]): GachaPrize[] =>
    weights.map((weight, i) => ({
      name: `p${i}`,
      weight,
      output: { kind: "builtin" } as const,
    }));

  it("⚠⚠⚠ 10% ちょうどはレアではない（境界を含めない）", () => {
    expect(isGachaRarePrize(gachaPercentToWeight(GACHA_RARE_MAX_PERCENT))).toBe(
      false,
    );
    // ⚠ 1 目盛り（0.1%）下ならレア。
    expect(
      isGachaRarePrize(gachaPercentToWeight(GACHA_RARE_MAX_PERCENT) - 1),
    ).toBe(true);
  });

  it.each([
    [1, true],
    [50, true],
    [99, true],
    [100, false],
    [101, false],
    [500, false],
    [1000, false],
  ])("重み %i → レア: %s", (weight, expected) => {
    expect(isGachaRarePrize(weight)).toBe(expected);
  });

  /**
   * ⚠⚠ **他の行を足してもレア判定は動かない。**
   * ⚠ 相対確率（`weight / total`）で判定する実装に変えると、
   * **「他の景品を足したらレアになった／レアでなくなった」**が起きる。
   */
  it("⚠⚠⚠ 他の景品が何件あってもレア判定は変わらない", () => {
    const rare = 99;
    expect(isGachaRarePrize(rare)).toBe(true);
    // ⚠ 合計が 10% しかない構成でも、20% を占めていても、判定は同じ。
    expect(gachaTotalWeight(w(rare, 1))).toBe(100);
    expect(isGachaRarePrize(rare)).toBe(true);
  });
});
