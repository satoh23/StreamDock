import { describe, it, expect, beforeEach } from "vitest";
import {
  EFFECT_ASSIGNMENTS_KEY,
  GACHA_STAGE_ENABLED_KEY,
  STAGE_OVERLAY_ENABLED_KEY,
} from "../../features/comment-viewer/overlaySettings";
import { isStageOverlayRequired } from "./stageOverlayGuard";

/**
 * 063c 段 1: ⚠⚠⚠ **`docs/security.md` §1（044a 例外）を守る唯一のガードの真理値表。**
 *
 * ## ⚠⚠ このファイルが在る理由
 *
 * このガードの読み手は 3 経路（起動時の窓復元 ／ コメビュ窓の `storage` 購読 ／ WS 接続時 reconcile）で、
 * それぞれ別のファイルがテストを持っている。⚠ **どれも「経路が通ること」を見ており、
 * 「判定そのもの」を全組み合わせで見ていない**——8 通りのうち 1 つでも取り違えると
 * **明示操作ゼロで OBS へ繋ぐ**か、**明示的に ON にしたのに繋がらない**のどちらかになる。
 * ⇒ **判定だけを、入力の全組み合わせで固定する。**
 *
 * ⚠ ここは localStorage しか触らない純粋な述語なので、外部通信も OS 操作も IPC も行わない。
 */

/** ガチャを指す条件を 1 件だけ保存する。 */
const putGachaCondition = () =>
  localStorage.setItem(
    EFFECT_ASSIGNMENTS_KEY,
    JSON.stringify([
      {
        when: { type: "event", eventType: "superchat" },
        effect: { kind: "gacha", gachaId: "g:1" },
      },
    ]),
  );

/** ⚠ 条件はあるが**ガチャを指していない**（AND ゲートの片側を満たさない）。 */
const putObsCondition = () =>
  localStorage.setItem(
    EFFECT_ASSIGNMENTS_KEY,
    JSON.stringify([
      {
        when: { type: "event", eventType: "superchat" },
        effect: { kind: "obs-source", sourceName: "きらきら演出" },
      },
    ]),
  );

beforeEach(() => {
  localStorage.clear();
});

describe("063c 段 1: isStageOverlayRequired（§1 のガード）", () => {
  it("⚠⚠⚠ 何も設定していなければ false（fail-closed の既定）", () => {
    expect(isStageOverlayRequired()).toBe(false);
  });

  // --- 061l: 配信イベントの開催（無改変であることの確認も兼ねる） -------------------------------

  it("開催中なら true（061l の経路を壊していない）", () => {
    localStorage.setItem(STAGE_OVERLAY_ENABLED_KEY, "true");
    expect(isStageOverlayRequired()).toBe(true);
  });

  it("⚠ 開催中ならガチャの条件が 0 件でも true（AND ゲートは 063c 側にしか掛からない）", () => {
    localStorage.setItem(STAGE_OVERLAY_ENABLED_KEY, "true");
    localStorage.setItem(GACHA_STAGE_ENABLED_KEY, "false");
    expect(isStageOverlayRequired()).toBe(true);
  });

  // --- 063c: 明示トグル ＋ AND ゲート -----------------------------------------------------------

  it("⚠⚠ トグル ON ＋ ガチャを指す条件あり → true", () => {
    localStorage.setItem(GACHA_STAGE_ENABLED_KEY, "true");
    putGachaCondition();
    expect(isStageOverlayRequired()).toBe(true);
  });

  it("⚠⚠⚠ トグル OFF ＋ 条件あり → false（派生値だけで true にならない）", () => {
    // ⚠⚠ **061i にあり 064d が hook ごと削除した形／064c が却下した線をここで殺す。**
    //   `&&` を `||` に変える変異がこのケースでレッドになる。
    putGachaCondition();
    expect(isStageOverlayRequired()).toBe(false);
  });

  it("⚠⚠ トグル ON ＋ 条件 0 件 → false（AND ゲート＝接続が残り続けない）", () => {
    localStorage.setItem(GACHA_STAGE_ENABLED_KEY, "true");
    expect(isStageOverlayRequired()).toBe(false);
  });

  it("⚠⚠ トグル ON ＋ ガチャを指さない条件だけ → false", () => {
    localStorage.setItem(GACHA_STAGE_ENABLED_KEY, "true");
    putObsCondition();
    expect(isStageOverlayRequired()).toBe(false);
  });

  it("⚠ 旗の文字列が 'true' 以外なら false（'1' や 'yes' を真と読まない）", () => {
    putGachaCondition();
    for (const raw of ["1", "yes", "TRUE", "", "false"]) {
      localStorage.setItem(GACHA_STAGE_ENABLED_KEY, raw);
      expect(isStageOverlayRequired()).toBe(false);
    }
  });

  it("⚠⚠ 条件の保存値が壊れていても true にならない（fail-closed）", () => {
    localStorage.setItem(GACHA_STAGE_ENABLED_KEY, "true");
    for (const raw of ["{", "null", "42", '"x"', "[]"]) {
      localStorage.setItem(EFFECT_ASSIGNMENTS_KEY, raw);
      expect(isStageOverlayRequired()).toBe(false);
    }
  });

  it("⚠ 未知の kind を指す条件はガチャとして数えない（前方互換の既定は『出さない』）", () => {
    localStorage.setItem(GACHA_STAGE_ENABLED_KEY, "true");
    localStorage.setItem(
      EFFECT_ASSIGNMENTS_KEY,
      JSON.stringify([
        {
          when: { type: "event", eventType: "superchat" },
          effect: { kind: "future-lane", gachaId: "g:1" },
        },
      ]),
    );
    expect(isStageOverlayRequired()).toBe(false);
  });

  it("⚠ キーワード条件のガチャも数える（イベント条件だけを見ていない）", () => {
    localStorage.setItem(GACHA_STAGE_ENABLED_KEY, "true");
    localStorage.setItem(
      EFFECT_ASSIGNMENTS_KEY,
      JSON.stringify([
        {
          id: "kw:1",
          when: { type: "keyword", text: "ガチャ", match: "contains" },
          effect: { kind: "gacha", gachaId: "g:1" },
        },
      ]),
    );
    expect(isStageOverlayRequired()).toBe(true);
  });
});
