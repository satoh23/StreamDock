import { describe, it, expect } from "vitest";
import {
  enqueuePendingGachaDraws,
  PENDING_GACHA_DRAW_LIMIT,
} from "./pendingGachaDraws";
import type { GachaDrawOutcome } from "../../screens/obs-effects/effectFire";

/**
 * 063h 穴 C: セッション未確定のあいだ抽選を貯めるバッファ。
 *
 * ⚠⚠ **固定するのは「捨てるときに黙らない」こと**である——
 * 記録は fire-and-forget なので、ここで数え損ねると
 * **「演出は出たのに配信サマリーに無い」が誰にも見えないまま起きる**。
 */

const draw = (id: string): GachaDrawOutcome => ({
  commentId: id,
  nth: 0,
  viewerId: "twitch:u1",
  viewerName: "視聴者A",
  gachaId: "g:2",
  gachaName: "朝ガチャ",
  prizeLabel: null,
  rare: false,
  drawnAt: "2026-08-30T12:00:00.000Z",
});

const many = (n: number) => Array.from({ length: n }, (_, i) => draw(`c${i}`));

describe("063h: pendingGachaDraws", () => {
  it("空を積んでも元のまま（新しい配列は返す）", () => {
    const prev = [draw("a")];
    const { next, dropped } = enqueuePendingGachaDraws(prev, []);
    expect(next).toEqual(prev);
    expect(next).not.toBe(prev);
    expect(dropped).toBe(0);
  });

  it("上限までは 1 件も捨てない", () => {
    const { next, dropped } = enqueuePendingGachaDraws(
      [],
      many(PENDING_GACHA_DRAW_LIMIT),
    );
    expect(next).toHaveLength(PENDING_GACHA_DRAW_LIMIT);
    expect(dropped).toBe(0);
  });

  /**
   * ⚠⚠ **溢れたら古いほうから捨てる**（新しい抽選のほうが、直後に確定するセッションに属する）。
   * ⚠ **捨てた件数を返す**——0 を返す変異は「静かに消える」を作る。
   */
  it("⚠⚠ 上限を超えたら古いほうから捨て、捨てた件数を返す", () => {
    const { next, dropped } = enqueuePendingGachaDraws(
      [],
      many(PENDING_GACHA_DRAW_LIMIT + 3),
    );
    expect(next).toHaveLength(PENDING_GACHA_DRAW_LIMIT);
    expect(dropped).toBe(3);
    // ⚠ 残っているのは**新しいほう**（先頭 3 件が消えている）。
    expect(next[0].commentId).toBe("c3");
    expect(next[next.length - 1].commentId).toBe(
      `c${PENDING_GACHA_DRAW_LIMIT + 2}`,
    );
  });

  it("⚠ 既に貯まっているぶんと合わせて上限を超えたときも古いほうから捨てる", () => {
    const prev = many(PENDING_GACHA_DRAW_LIMIT);
    const { next, dropped } = enqueuePendingGachaDraws(prev, [draw("new")]);
    expect(dropped).toBe(1);
    expect(next).toHaveLength(PENDING_GACHA_DRAW_LIMIT);
    expect(next[next.length - 1].commentId).toBe("new");
    expect(next[0].commentId).toBe("c1");
  });

  it("元の配列を書き換えない（純関数）", () => {
    const prev = many(3);
    enqueuePendingGachaDraws(prev, many(5));
    expect(prev).toHaveLength(3);
  });
});
