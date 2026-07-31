import { describe, it, expect } from "vitest";
import { capForSpeech, sanitizeForSpeech } from "./ttsQueue";

/**
 * 048: 読み上げテキストの文字数上限（「以下略」で打ち切り）の仕様テスト。
 *
 * あるべき挙動（docs/tasks/048-tts-reading-length-cap.md 完了条件）:
 * - 上限を超えたコメントの**読み上げテキストだけ**を打ち切り、末尾へ「、以下略」を足す（表示は全文のまま）。
 * - 数える単位は**コードポイント**。UTF-16 コードユニットで割ると 𠮷 等が孤立サロゲート「�」になる。
 * - 上限が不正（非有限・1 未満）なら切り詰めない（既定値・クランプのポリシーは `ttsPrefs.ts` の責務）。
 *
 * 対象は**純関数のみ**で `createTtsQueue` は呼ばない（`new AudioContext()` を作るため jsdom で動かない）。
 * 049 / 050 がキュー本体のテスト（`synthesize` / `playWav` をモックする）をこのファイルへ足す前提。
 * そのとき **`getMaxLength` を注入した `enqueue` が実際に切り詰めること**も 1 ケース足すこと
 * （現状 `getMaxLength` は optional ＋ `?? Infinity` なので、本体側の注入が消えても型もテストも気付けない）。
 *
 * ⚠ 打ち切り表記「、以下略」は**意図的にリテラルで書いている**（実装から import すると恒真式になり仕様を固定できない）。
 * 実機判定で `SPEECH_ELLIPSIS` を差し替える場合は、このファイルの 4 箇所も同時に直すこと。
 */

/** 孤立サロゲート（ペアの片割れだけが残った状態）を含むか。含むと画面/読みが「�」に化ける。 */
const hasLoneSurrogate = (s: string): boolean =>
  [...s].some((cp) => {
    const code = cp.codePointAt(0) ?? 0;
    return code >= 0xd800 && code <= 0xdfff;
  });

describe("capForSpeech の境界", () => {
  it("上限ちょうどは素通しする（接尾辞を足さない）", () => {
    const text = "あ".repeat(60);
    expect(capForSpeech(text, 60)).toBe(text);
  });

  it("上限を 1 文字超えたら打ち切って「、以下略」を足す", () => {
    const text = "あ".repeat(61);
    expect(capForSpeech(text, 60)).toBe("あ".repeat(60) + "、以下略");
  });

  it("大幅に超える長文でも本文は上限ちょうどで、続きは読まない", () => {
    // dev-mock の長文枠（290 文字）相当。既定 60 で打ち切ると約 10〜13 秒に収まり、
    // 読み上げ中に届いた後続コメントが MAX_BACKLOG(20) 超過で捨てられなくなる、というのが本タスクの目的。
    const text = "長".repeat(290);
    const capped = capForSpeech(text, 60);
    expect([...capped]).toHaveLength(60 + "、以下略".length);
    expect(capped.endsWith("、以下略")).toBe(true);
  });

  it("空文字は空文字のまま（接尾辞を足さない＝空判定を通って読み上げをスキップできる）", () => {
    expect(capForSpeech("", 60)).toBe("");
  });
});

describe("capForSpeech の文字数の数え方", () => {
  it("サロゲートペアを割らない（孤立サロゲートを作らない）", () => {
    // 𠮷 は絵文字ではないので sanitizeForSpeech では消えず、コードユニット単位で切ると割れる。
    const text = "𠮷".repeat(10);
    const capped = capForSpeech(text, 5);
    expect(hasLoneSurrogate(capped)).toBe(false);
    expect(capped).toBe("𠮷".repeat(5) + "、以下略");
  });

  it("コードポイント数で数える（サロゲートペア 1 文字を 2 文字と数えない）", () => {
    // コードユニット単位なら length===6 で上限 5 を超えたと誤判定する。コードポイントでは 3 文字なので素通し。
    const text = "𠮷𩸽𡈽";
    expect(text.length).toBe(6);
    expect(capForSpeech(text, 5)).toBe(text);
  });

  // ※ 結合文字（濁点 U+3099 等）の書記素クラスタは**意図的に割り得る**仕様（capForSpeech の JSDoc 参照）。
  //   結合文字は基底文字の後ろにあるため、切断点で落ちるのは濁点側＝打ち切り位置の 1 文字が濁点を失って読まれる
  //   （`が`→`か`）。孤立サロゲートのような「�」化とは影響の桁が違うので、ここでは仕様として固定しない
  //   （固定すると Segmenter 導入時にテストごと書き換えになる）。
});

describe("capForSpeech の防御（上限値が不正なとき）", () => {
  // 0.5 は「1 未満なら切り詰めない」ガードの検証。通してしまうと slice の truncate で本文が 0 文字になり、
  // 「、以下略」だけを読む無意味な出力になる（製品経路はクランプ済み整数のみなので到達しないが、純関数の契約として固定する）。
  it.each([0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "上限 %p では切り詰めない",
    (max) => {
      const text = "あ".repeat(100);
      expect(capForSpeech(text, max)).toBe(text);
    },
  );
});

describe("sanitizeForSpeech（既存仕様の回帰）", () => {
  it("URL と絵文字を除去し、空白を畳み込む", () => {
    expect(sanitizeForSpeech("見て https://example.com/a  これ🎉")).toBe(
      "見て これ",
    );
  });

  it("非絵文字のサロゲートペアは残す（だから capForSpeech 側で割らない配慮が要る）", () => {
    expect(sanitizeForSpeech("𠮷野家")).toBe("𠮷野家");
  });
});
