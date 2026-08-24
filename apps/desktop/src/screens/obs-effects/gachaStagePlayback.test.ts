import { describe, it, expect } from "vitest";
import {
  GACHA_DISPENSE_MS,
  GACHA_OPEN_FRAME_MS,
  GACHA_OPEN_FRAMES,
  GACHA_OPEN_MS,
  GACHA_RESULT_MS,
  GACHA_SPIN_FRAME_MS,
  GACHA_SPIN_FRAMES,
  GACHA_SPIN_MS,
  gachaStageTotalMs,
  gachaStageView,
} from "./gachaStagePlayback";

/**
 * ⚠⚠⚠ **063c 段 2-b: 演出の進み方（純関数）の仕様テスト。**
 *
 * ⚠ ここが固定できるのは **`EffectOverlayApp` に持たせなかったから**である
 * （コンポーネントの中に `setTimeout` の連鎖として書いていたら、
 * 「途中でアンマウント」「次の当選が来た」の組み合わせは実質検査できない）。
 *
 * あるべき挙動:
 * 1. **抽選中 → 開封 → 結果 → 終わり（`null`）**の順に進み、**戻らない**
 * 2. ⚠ **コマは存在する範囲に収まる**（`min` を外すと無い画像を指す）
 * 3. ⚠⚠ **抽選中の最後は「排出の 1 枚」で止まる**（コマを送らない）
 *
 * ⚠⚠ **063c 段 4-a: 「抽選中の秒数」は設定ではなくなった**ので、
 * 旧「0 ＝ 演出なし」「短いときは排出を出さない」のケースは**消した**
 * （到達しない経路のテストを残すと、読む人が「設定できる」と誤解する）。
 */

/** ⚠ コマ番号を取り出す（`result` にはコマが無いので `undefined`）。 */
const frameAt = (elapsed: number): number | undefined => {
  const view = gachaStageView(elapsed);
  return view !== null && view.phase !== "result" ? view.frame : undefined;
};

describe("063c 段 2-b: gachaStageView", () => {
  it("⚠⚠ 抽選中 → 開封 → 結果 → 終わり の順に進む", () => {
    expect(gachaStageView(0)?.phase).toBe("spin");
    expect(gachaStageView(GACHA_SPIN_MS - 1)?.phase).toBe("spin");
    expect(gachaStageView(GACHA_SPIN_MS)?.phase).toBe("open");
    expect(gachaStageView(GACHA_SPIN_MS + GACHA_OPEN_MS - 1)?.phase).toBe("open");
    expect(gachaStageView(GACHA_SPIN_MS + GACHA_OPEN_MS)?.phase).toBe("result");
    expect(
      gachaStageView(GACHA_SPIN_MS + GACHA_OPEN_MS + GACHA_RESULT_MS - 1)?.phase,
    ).toBe("result");
    expect(
      gachaStageView(GACHA_SPIN_MS + GACHA_OPEN_MS + GACHA_RESULT_MS),
    ).toBeNull();
  });

  /**
   * ⚠⚠⚠ **回転を 1 度も見せずに排出だけが映らないための前提。**
   * ⚠ `GACHA_SPIN_MS <= GACHA_DISPENSE_MS` にすると、**1 コマ目から排出の絵**になる。
   */
  it("⚠⚠ 抽選中は排出の窓より長い（定数どうしの前提）", () => {
    expect(GACHA_SPIN_MS).toBeGreaterThan(GACHA_DISPENSE_MS);
  });

  it("⚠ 抽選中はマシンのコマがループする", () => {
    const frames = [0, 1, 2, 3, 4, 5].map((i) => frameAt(i * GACHA_SPIN_FRAME_MS));
    expect(frames).toEqual([0, 1, 2, 3, 0, 1]);
  });

  /**
   * ⚠⚠⚠ **063c 段 2-c: 排出は「1 枚を持たせる」であって、コマ送りではない。**
   * ⚠ シートの 6 コマ目は**排出されるカプセルの色が違う**（青／桃）ので、
   * ここでコマが進む実装に戻ると「青が出てきて赤が割れる」になる。
   */
  it("⚠⚠ 抽選中の最後は「カプセルが出てくる」1 枚のまま動かない", () => {
    for (let t = GACHA_SPIN_MS - GACHA_DISPENSE_MS; t < GACHA_SPIN_MS; t += 10) {
      expect(gachaStageView(t)).toEqual({
        phase: "spin",
        frame: GACHA_SPIN_FRAMES,
      });
    }
    // ⚠ 排出に入る 1 ミリ秒前は、まだ回転のコマ（＝境界がここに在る）。
    expect(frameAt(GACHA_SPIN_MS - GACHA_DISPENSE_MS - 1)).toBeLessThan(
      GACHA_SPIN_FRAMES,
    );
  });

  it("⚠ 開封のコマは 0→3 と進み、最後のコマで止まる", () => {
    const at = (n: number) => frameAt(GACHA_SPIN_MS + n * GACHA_OPEN_FRAME_MS);
    expect([at(0), at(1), at(2), at(3)]).toEqual([0, 1, 2, 3]);
    // ⚠⚠ コマ送りが終わっても開封の段は続く（＝最後のコマを持たせる）。
    expect(at(4)).toBe(GACHA_OPEN_FRAMES - 1);
  });

  /**
   * ⚠⚠ **全時間帯を舐めて、存在しないコマを 1 度も指さないことを見る。**
   * ⚠ `Math.min` を外す変異は「たまたま踏まない時刻のテスト」では殺せない。
   */
  it("⚠⚠⚠ どの時刻でもコマが範囲内に収まる", () => {
    const total = gachaStageTotalMs();
    for (let t = 0; t <= total + 200; t += 10) {
      const view = gachaStageView(t);
      if (view === null || view.phase === "result") continue;
      expect(view.frame).toBeGreaterThanOrEqual(0);
      if (view.phase === "spin") {
        // ⚠ 排出の 1 枚ぶんだけ多い（`MACHINE_FRAMES` は 5 枚）。
        expect(view.frame).toBeLessThanOrEqual(GACHA_SPIN_FRAMES);
      } else {
        expect(view.frame).toBeLessThanOrEqual(GACHA_OPEN_FRAMES - 1);
      }
    }
  });

  it("⚠ 負の経過でも壊れない（0 として扱う）", () => {
    expect(gachaStageView(-500)?.phase).toBe("spin");
  });

  it("⚠⚠ 全長は「抽選中 ＋ 開封 ＋ 結果」（キューの見積もりの根拠）", () => {
    expect(gachaStageTotalMs()).toBe(
      GACHA_SPIN_MS + GACHA_OPEN_MS + GACHA_RESULT_MS,
    );
    // ⚠ 全長のちょうど手前までは何か出ている（＝終わりの境界が全長と一致する）。
    const total = gachaStageTotalMs();
    expect(gachaStageView(total - 1)).not.toBeNull();
    expect(gachaStageView(total)).toBeNull();
  });
});
