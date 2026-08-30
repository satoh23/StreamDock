import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import { recordGachaDraws } from "./gachaHistoryApi";
import type { GachaDrawOutcome } from "../../screens/obs-effects/effectFire";

const mockInvoke = vi.mocked(invoke);

/**
 * 063h: 記録の invoke ラッパ。
 *
 * ⚠⚠⚠ **このファイルが固定する最重要の不変条件は「記録 id が決定的であること」**（穴 A）。
 * ⚠ Rust 側は `INSERT OR IGNORE` なので、**id が入力ごとに変われば二重記録の抑止が丸ごと無効になる**
 * ——しかも**失敗しないので誰も気付かない**（行が静かに増えるだけ）。
 */

const draw = (over: Partial<GachaDrawOutcome> = {}): GachaDrawOutcome => ({
  commentId: "c1",
  nth: 0,
  viewerId: "twitch:u1",
  viewerName: "視聴者A",
  gachaId: "g:2",
  gachaName: "朝ガチャ",
  prizeLabel: "色紙",
  rare: false,
  drawnAt: "2026-08-30T12:00:00.000Z",
  ...over,
});

/** 直近の invoke に渡った DTO。 */
const lastDraw = () => {
  const calls = mockInvoke.mock.calls;
  return (calls[calls.length - 1][1] as { draw: Record<string, unknown> }).draw;
};

describe("063h: recordGachaDraws", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue(undefined);
  });

  it("抽選 1 件につき record_gacha_draw を 1 回呼ぶ", () => {
    recordGachaDraws([draw(), draw({ commentId: "c2" })], "s1");
    expect(mockInvoke).toHaveBeenCalledTimes(2);
    expect(mockInvoke.mock.calls[0][0]).toBe("record_gacha_draw");
  });

  it("何も渡さなければ 1 度も呼ばない", () => {
    recordGachaDraws([], "s1");
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  /**
   * ⚠⚠⚠ **穴 A: 記録 id は `${commentId}:${gachaId}:${nth}`。**
   *
   * ⚠ ここが変わると Rust 側の `INSERT OR IGNORE` が効かなくなる
   * （**StrictMode の二重実行・再送で行が増える**）。
   */
  it("⚠⚠⚠ 記録 id は commentId:gachaId:nth の決定的な文字列", () => {
    recordGachaDraws([draw()], "s1");
    expect(lastDraw().id).toBe("c1:g:2:0");
  });

  it("⚠⚠ 同じ入力からは毎回まったく同じ id が出る（決定的）", () => {
    recordGachaDraws([draw()], "s1");
    const first = lastDraw().id;
    recordGachaDraws([draw()], "s1");
    expect(lastDraw().id).toBe(first);
  });

  /** ⚠ 同じコメント・同じガチャでも `nth` が違えば別の記録になる。 */
  it("⚠ nth が違えば id も違う", () => {
    recordGachaDraws([draw({ nth: 0 })], "s1");
    const a = lastDraw().id;
    recordGachaDraws([draw({ nth: 1 })], "s1");
    expect(lastDraw().id).not.toBe(a);
  });

  it("セッション id は引数のものを載せる（記録レーンは自分で決めない）", () => {
    recordGachaDraws([draw()], "session-42");
    expect(lastDraw().sessionId).toBe("session-42");
  });

  /**
   * ⚠⚠⚠ **何も出なかった抽選は `prizeLabel` を載せない**（＝ Rust 側で `None` になる）。
   *
   * ⚠ binding は `prizeLabel?: string`（`#[ts(optional)]`）なので `null` は型に入らない。
   * ⚠⚠ **空文字を載せないこと**——載せると Rust が NULL へ倒すとはいえ、
   * 「名前が空の当たり」と区別が付かない値を wire に流すことになる。
   */
  it("⚠⚠⚠ 何も出なかった抽選は prizeLabel を送らない", () => {
    recordGachaDraws([draw({ prizeLabel: null })], "s1");
    const sent = lastDraw();
    expect("prizeLabel" in sent).toBe(false);
    expect(sent.id).toBe("c1:g:2:0");
  });

  it("当たった抽選は prizeLabel をそのまま送る", () => {
    recordGachaDraws([draw({ prizeLabel: "当たり" })], "s1");
    expect(lastDraw().prizeLabel).toBe("当たり");
  });

  /**
   * ⚠⚠ **記録が失敗しても呼び出し側へ例外が漏れないこと**（best-effort）。
   *
   * ⚠ ここが落ちると、DB が壊れているときに**演出とチャットまで止まる**。
   */
  it("⚠⚠ invoke が失敗しても例外を投げない（fire-and-forget）", async () => {
    mockInvoke.mockRejectedValue(new Error("DB が壊れている"));
    expect(() => recordGachaDraws([draw()], "s1")).not.toThrow();
    // ⚠ unhandled rejection にもならないこと（`.catch` が付いていること）。
    await Promise.resolve();
  });

  /**
   * ⚠⚠⚠ **§9: wire に載るフィールドが増えていないこと。**
   *
   * ⚠ `commentId` / `nth` は **id の材料であって保存する列ではない**ので、
   * DTO には**現れない**（Rust 側にも列が無い）。
   */
  it("⚠⚠⚠ wire に載るのは 9 フィールドだけ（commentId / nth は載らない）", () => {
    recordGachaDraws([draw()], "s1");
    expect(Object.keys(lastDraw()).sort()).toEqual([
      "drawnAt",
      "gachaId",
      "gachaName",
      "id",
      "prizeLabel",
      "rare",
      "sessionId",
      "viewerId",
      "viewerName",
    ]);
  });
});
