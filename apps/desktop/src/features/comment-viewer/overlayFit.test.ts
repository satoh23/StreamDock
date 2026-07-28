import { describe, it, expect, vi } from "vitest";
import {
  fitScale,
  quantizeScale,
  MAX_FIT_ITERATIONS,
  MIN_FIT_SCALE,
  FIT_TOLERANCE_PX,
  type FitMeasurement,
} from "./overlayFit";

/**
 * 046c: 縮小フィットのソルバ仕様テスト。
 *
 * あるべき挙動（docs/tasks/046c-pinned-overlay-long-text-fit.md）:
 * - 収まっているなら**等倍（1）を返し、一切縮めない**（短文で既存の見た目を変えない）。
 * - 収まらないなら、**返り値のスケールで実際に収まっている**ところまで縮める。
 * - 探索したスケールは**厳密に減少**する（＝どんな measure でも停止する）。
 * - 測れない環境（jsdom はレイアウトを持たず 0 を返す）では縮めない。
 *
 * jsdom はレイアウトを実装していないので、実 DOM ではなく**合成モデル**を注入して検証する
 * （`CommentList.test.tsx` が「見た目の折返しは jsdom では測れないため実機目視」と書いているのと同じ理由で、
 * ここは数値探索の性質だけを固定し、実際の描画は実機確認に回す）。
 */

/**
 * 固定オーバーレイの実寸に近い合成モデル。スケール k ではレイアウト幅が W/k に広がって本文が再フローする。
 *
 * ⚠ **`content` は必ず `available` 以上を返す**。実 DOM の `scrollHeight` は `clientHeight` で下限クランプ
 * されるためで、この制約を入れずに独立な値を返すモデルにすると「収まっている状態」を正しく再現できず、
 * 判定式の誤りをテストが素通しする（046c の初回実装で実際にそうなった）。
 */
function makeModel(options: {
  chars: number;
  windowWidth?: number;
  windowHeight?: number;
}) {
  const { chars, windowWidth = 480, windowHeight = 560 } = options;
  // 横クローム（ol padding 24 + li padding 8 + アイコン 44 + gap 28 + 吹き出し padding 24 + border 5）
  const HORIZONTAL_CHROME = 133;
  const VERTICAL_CHROME = 70; // 名前行 + 各種 padding + border
  const FONT_SIZE = 19;
  const LINE_HEIGHT = 28.5; // 19px * 1.5

  return (scale: number): FitMeasurement => {
    const layoutWidth = windowWidth / scale;
    const textWidth = layoutWidth - HORIZONTAL_CHROME;
    const perLine = Math.max(1, Math.floor(textWidth / FONT_SIZE));
    const lines = Math.ceil(chars / perLine);
    const natural = VERTICAL_CHROME + lines * LINE_HEIGHT;
    const available = windowHeight / scale;
    return { content: Math.max(natural, available), available };
  };
}

describe("quantizeScale", () => {
  it("0.02 刻みへ切り捨てる（安全側）", () => {
    expect(quantizeScale(1)).toBe(1);
    expect(quantizeScale(0.7597)).toBeCloseTo(0.74, 10);
    expect(quantizeScale(0.5)).toBeCloseTo(0.5, 10);
  });
});

describe("fitScale", () => {
  it("収まっているときは等倍を返し、measure は 1 回しか呼ばない（短文で縮めない）", () => {
    // ⚠ 実 DOM では収まっている＝`scrollHeight === clientHeight`（下限クランプ）。
    // ここを content < available（ありえない値）で書くとバグを素通しするので、必ず同値で書く。
    const measure = vi.fn(() => ({ content: 560, available: 560 }));
    expect(fitScale(measure)).toBe(1);
    // 余計な測定＝余計な強制リフロー。1 回で確定することを固定する。
    expect(measure).toHaveBeenCalledTimes(1);
  });

  it("**回帰**: 短文（content === available）を縮めない", () => {
    // 046c の初回実装は判定を `content <= available - 8` と書いていたため、
    // scrollHeight >= clientHeight のクランプにより**この条件が絶対に真にならず**、
    // どんな短文でも反復を使い切って ~0.86 倍まで縮んでいた。
    for (const size of [100, 320, 560, 1200]) {
      expect(fitScale(() => ({ content: size, available: size }))).toBe(1);
    }
  });

  it("許容量ちょうどのはみ出しは縮めない（サブピクセル差で無駄に縮まない）", () => {
    expect(
      fitScale(() => ({ content: 560 + FIT_TOLERANCE_PX, available: 560 })),
    ).toBe(1);
    expect(
      fitScale(() => ({ content: 560 + FIT_TOLERANCE_PX + 1, available: 560 })),
    ).toBeLessThan(1);
  });

  it("290 字が 320px 窓（046b の見切れ再現）に収まるまで縮める", () => {
    const model = makeModel({ chars: 290, windowHeight: 320 });
    const scale = fitScale(model);

    expect(scale).toBeLessThan(1);
    // 後条件: 返り値のスケールで**実際に収まっている**こと（縮めたつもりで足りない、を防ぐ）。
    const { content, available } = model(scale);
    expect(content - available).toBeLessThanOrEqual(FIT_TOLERANCE_PX);
  });

  it("290 字は 560px 窓（046c の既定サイズ）ならほぼ等倍で収まる", () => {
    // 「窓の高さが主役・フィットは保険」という設計の裏取り。見積り誤差ぶんの微縮小は許容する。
    const scale = fitScale(makeModel({ chars: 290, windowHeight: 560 }));
    expect(scale).toBeGreaterThanOrEqual(0.9);
  });

  it("500 字（Twitch の本文上限）でも収まるところまで縮む", () => {
    const model = makeModel({ chars: 500, windowHeight: 560 });
    const scale = fitScale(model);
    const { content, available } = model(scale);
    expect(content - available).toBeLessThanOrEqual(FIT_TOLERANCE_PX);
    expect(scale).toBeGreaterThan(MIN_FIT_SCALE);
  });

  it("探索するスケールは厳密に減少する（同じ値で足踏みしない）", () => {
    const seen: number[] = [];
    const model = makeModel({ chars: 900, windowHeight: 320 });
    fitScale((scale) => {
      seen.push(scale);
      return model(scale);
    });
    expect(seen[0]).toBe(1);
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]).toBeLessThan(seen[i - 1]);
    }
  });

  it("常に「収まらない」と返す measure でも停止する（無限ループしない）", () => {
    const measure = vi.fn(() => ({ content: 100000, available: 100 }));
    const scale = fitScale(measure);

    expect(scale).toBe(MIN_FIT_SCALE);
    // 反復上限 + 下限到達時の適用 1 回ぶんを超えて呼ばれない。
    expect(measure.mock.calls.length).toBeLessThanOrEqual(MAX_FIT_ITERATIONS + 1);
  });

  it("非単調・振動する measure でも停止する（単調減少の強制が効いている）", () => {
    let i = 0;
    const measure = vi.fn((): FitMeasurement => {
      i++;
      // 収まり判定が行ったり来たりする敵対的な測定。
      return i % 2 === 0
        ? { content: 5000, available: 300 }
        : { content: 900, available: 300 };
    });
    const scale = fitScale(measure);

    expect(scale).toBeGreaterThan(0);
    expect(scale).toBeLessThanOrEqual(1);
    expect(measure.mock.calls.length).toBeLessThanOrEqual(MAX_FIT_ITERATIONS + 1);
  });

  it("測れない環境（available=0・jsdom 相当）では縮めない", () => {
    const measure = vi.fn(() => ({ content: 0, available: 0 }));
    expect(fitScale(measure)).toBe(1);
    expect(measure).toHaveBeenCalledTimes(1);
  });

  it("下限へ到達したときは、下限を DOM へ適用してから返す（契約: 返り値が適用済み）", () => {
    const applied: number[] = [];
    const scale = fitScale((k) => {
      applied.push(k);
      return { content: 100000, available: 100 };
    });
    // 最後に measure へ渡した値＝DOM に当たっている値が、返り値と一致すること。
    expect(applied[applied.length - 1]).toBe(scale);
  });

  it("反復を使い切っても、返り値＝最後に DOM へ適用した値（契約: 返り値が適用済み）", () => {
    // レビュー指摘: 下限クランプ経路には上のケースがあるが、**反復打ち切り経路**には無かった。
    // 一定量だけ超え続ける measure（分割不能な要素があるケース相当）は sqrt 推定がほぼ効かず
    // FIT_STEP ぶんしか下がらないため、MIN_FIT_SCALE に届く前に MAX_FIT_ITERATIONS を使い切る。
    // 旧実装はここで `scale`（＝まだ measure へ渡していない次の候補）を返していて 1 段ズレていた。
    const applied: number[] = [];
    const scale = fitScale((k) => {
      applied.push(k);
      // available は k に反比例、content は常にそれを許容量より少し超える＝永久に収まらない。
      const available = 560 / k;
      return { content: available + FIT_TOLERANCE_PX + 1, available };
    });

    // 反復を使い切ったことの確認（下限クランプ経路に落ちていたらこのテストは意味を持たない）。
    expect(applied.length).toBe(MAX_FIT_ITERATIONS);
    expect(scale).toBeGreaterThan(MIN_FIT_SCALE);
    expect(applied[applied.length - 1]).toBe(scale);
  });

  it("返り値は常に (0, 1] の 0.02 刻み", () => {
    for (const chars of [1, 50, 290, 500, 2000]) {
      const scale = fitScale(makeModel({ chars, windowHeight: 320 }));
      expect(scale).toBeGreaterThan(0);
      expect(scale).toBeLessThanOrEqual(1);
      expect(Math.round(scale * 50)).toBeCloseTo(scale * 50, 6);
    }
  });
});
