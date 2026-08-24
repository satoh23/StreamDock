import { describe, it, expect } from "vitest";
import {
  GACHA_PRIZE_BUILTIN_VALUE,
  gachaPrizeOutputFromSelectValue,
  gachaPrizeOutputSelectValue,
  NONE_VALUE,
} from "./effectSelectValue";

/**
 * ⚠⚠⚠ **063c 段 2-a: 景品の出力先 ⇄ `<select>` の値**（組み立てと分解）。
 *
 * ⚠ 画面越しの検査は [`GachaPrizeTable.test.tsx`] が持つ。ここが単体で固定するのは
 * **DOM を経由しないと殺しにくい 3 つの罠**である:
 *
 * 1. ⚠⚠⚠ **ソース名は `:` を含みうる**（「12:34 の演出」）。`split(":")` で分解すると
 *    **実在するのに「見つかりません」になる**——064a・063d に続く **4 例目**の罠。
 * 2. ⚠⚠ **「組み込みの演出」と「エフェクトを出さない」を同じ値にしない**
 *    （同じにすると「当たったのに何も出ない」が黙って起きる）。
 * 3. ⚠ **未知の値をどちらかへ倒さない**（`null` ＝ その変更を無視する）。
 */
describe("063c 段 2-a: gachaPrizeOutputSelectValue / …FromSelectValue", () => {
  it("組み込み ⇄ 値の往復", () => {
    const value = gachaPrizeOutputSelectValue({ kind: "builtin" });
    expect(value).toBe(GACHA_PRIZE_BUILTIN_VALUE);
    expect(gachaPrizeOutputFromSelectValue(value)).toEqual({ kind: "builtin" });
  });

  it("OBS のソース ⇄ 値の往復", () => {
    const output = { kind: "obs-source", sourceName: "きらきら演出" } as const;
    const value = gachaPrizeOutputSelectValue(output);
    expect(value).toBe("obs:きらきら演出");
    expect(gachaPrizeOutputFromSelectValue(value)).toEqual(output);
  });

  it("⚠⚠⚠ `:` を含むソース名でも往復できる（`split` で割らない）", () => {
    const output = { kind: "obs-source", sourceName: "12:34 の演出" } as const;
    const value = gachaPrizeOutputSelectValue(output);
    expect(gachaPrizeOutputFromSelectValue(value)).toEqual(output);
  });

  it("⚠⚠ 「組み込み」と「出さない」は別の値である", () => {
    expect(GACHA_PRIZE_BUILTIN_VALUE).not.toBe(NONE_VALUE);
  });

  it.each([
    ["出さない", NONE_VALUE],
    ["ガチャの入れ子", "gacha:g:1"],
    ["未知の接頭辞", "webhook:https://example.com"],
    ["空文字", ""],
    ["空のソース名", "obs:"],
  ])("⚠ 受け付けない値は null（黙ってどちらかへ倒さない）: %s", (_label, value) => {
    expect(gachaPrizeOutputFromSelectValue(value)).toBeNull();
  });
});
