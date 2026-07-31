import { describe, it, expect } from "vitest";
import {
  applyReadingDictionary,
  BUILTIN_READING_DICTIONARY,
} from "./readingDictionary";

/**
 * 041a: 読み替え辞書の適用エンジン＋内蔵辞書の仕様テスト。
 *
 * **新設の直接の動機（049 の実機確認・2026-07-31）**: 笑いの w ルールが直前しか見ておらず、
 * `"that clutch was insane"` が「that clutch わらas insane」と読まれていた。049 で課金イベントの
 * **投稿者名**も本辞書を通るようになり（`wataru` →「わらataru」）、英字表示名が高頻度で壊れる問題が
 * 顕在化したため、後方境界 `(?![A-Za-z])` を足した。**その回帰をここで固定する**。
 *
 * ⚠ 期待文字列は**意図的にリテラル**（辞書定義を import して組み立てると恒真式になり、ルールを
 * 書き換えたときに仕様の変化を検知できなくなる）。
 */

/** 内蔵辞書を適用する（本番の `enqueue` と同じ組み合わせ）。 */
const apply = (text: string): string =>
  applyReadingDictionary(text, BUILTIN_READING_DICTIONARY);

describe("笑いの w: 前後が英字でないときだけ変換する", () => {
  it.each([
    ["楽しいw", "楽しいわら"],
    ["草生えるwww", "くさ生えるわらわら"],
    ["wwww", "わらわら"], // 回数には比例させない（まとめて 1 回）
    ["w", "わら"],
    ["やばいw!", "やばいわら!"],
    ["すごいww すごい", "すごいわらわら すごい"],
  ])("%s -> %s", (input, expected) => {
    expect(apply(input)).toBe(expected);
  });

  // 049 実機で発覚した本体。直後が英字の w は笑いではない。
  it.each([
    "that clutch was insane", // ← 実機で「わらas」と読まれていた文
    "what a play",
    "we will win",
    "wataru", // 投稿者名（049 で辞書を通るようになった）
    "William",
    "wolf_gamer",
    "warota",
    "law", // 直前が英字（従来から非変換）
    "how are you",
    "few",
  ])("英単語・英字表示名は変換しない: %s", (input) => {
    expect(apply(input)).toBe(input);
  });

  it("英字に続く w 列（wwwa）は英単語の一部として非変換に倒す", () => {
    expect(apply("wwwa")).toBe("wwwa");
  });

  it("課金イベントの読み上げ文でも投稿者名が壊れない（049 の実害そのもの）", () => {
    expect(apply("wataruさんがメンバーシップに加入しました")).toBe(
      "wataruさんがメンバーシップに加入しました",
    );
  });

  // 既知の割り切り（意図的に残す）: 前後が非英字の単独大文字 W は笑い扱いのままにする。
  // 後方境界では防げず、防ごうとすると笑いの "WWW" を落とす副作用のほうが大きいため。
  it("【既知の割り切り】単独の大文字 W は笑いとして読む", () => {
    expect(apply("W")).toBe("わら");
  });
});

describe("最長一致と定義順（保護エントリがスラングを先取りする）", () => {
  it.each([
    ["煙草", "たばこ"],
    ["草原", "そうげん"],
    ["雑草", "ざっそう"],
    ["乙女", "おとめ"],
    ["草", "くさ"],
    ["乙", "おつ"],
  ])("%s -> %s", (input, expected) => {
    expect(apply(input)).toBe(expected);
  });

  it("置換後のカタカナ読みを後続ルールが再マッチしない（単一パス）", () => {
    // 「草」→「くさ」に変換した結果へ再び辞書が当たらないこと。
    expect(apply("草草")).toBe("くさくさ");
  });
});

describe("英語・tech 略語は語境界つき（部分一致で誤爆しない）", () => {
  it.each([
    ["OBSの設定", "オービーエスの設定"],
    ["PCが重い", "ピーシーが重い"],
    ["ChatGPTすごい", "チャットジーピーティーすごい"],
  ])("%s -> %s", (input, expected) => {
    expect(apply(input)).toBe(expected);
  });

  it("部分一致では誤爆しない（curl の url を拾わない）", () => {
    expect(apply("curl")).toBe("curl");
  });
});

describe("適用エンジンの契約", () => {
  it("空辞書なら素通し（未注入時に現行動作と完全に同じ）", () => {
    expect(applyReadingDictionary("楽しいw", [])).toBe("楽しいw");
  });

  it("空文字は空文字のまま", () => {
    expect(apply("")).toBe("");
  });

  it("不正な正規表現ソースは当該ルールだけ no-op に縮退する（1 件の破損で全体を落とさない）", () => {
    expect(
      applyReadingDictionary("あabcい", [
        { surface: "([", reading: "X", kind: "regex" },
        { surface: "abc", reading: "エービーシー", kind: "text" },
      ]),
    ).toBe("あエービーシーい");
  });

  it("trim はしない（空判定・trim は呼び出し側の責務）", () => {
    expect(applyReadingDictionary("  草  ", BUILTIN_READING_DICTIONARY)).toBe(
      "  くさ  ",
    );
  });
});
