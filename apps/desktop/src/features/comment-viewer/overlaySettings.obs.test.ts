import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  OBS_AUTO_ADD_KEY,
  loadObsAutoAdd,
  saveObsAutoAdd,
  PINNED_OVERLAY_ENABLED_KEY,
  loadPinnedOverlayEnabled,
  savePinnedOverlayEnabled,
  // 064a/064c: 鳴らせる OBS ソースの一覧（コメビュ窓 → main 窓）。
  OBS_SOURCE_LIST_KEY,
  loadObsSourceList,
  saveObsSourceList,
} from "./overlaySettings";

/**
 * 044a: OBS 自動追加トグルの永続化（overlaySettings）の仕様テスト。
 * あるべき挙動（docs/tasks/044a-obs-auto-source-impl.md / docs/security.md §9）:
 * - 永続化するのは **非機密の boolean（ON/OFF）のみ**。既定は OFF（false）。
 * - localStorage には "true"/"false" 文字列で保存し、load は "true" の厳密一致でのみ true を返す。
 * - 読み書きが失敗（プライベートモード等）しても壊れず false へ劣化する。
 * - **OBS パスワードは localStorage に保存しない**（このモジュールは boolean 以外を書かない）。
 */

beforeEach(() => {
  localStorage.clear();
});

function storedKeys(): string[] {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k) keys.push(k);
  }
  return keys;
}

describe("loadObsAutoAdd / saveObsAutoAdd", () => {
  it("未保存のときは既定 OFF（false）", () => {
    expect(loadObsAutoAdd()).toBe(false);
  });

  it("true を保存すると 'true' 文字列で永続化し、load は true を返す", () => {
    saveObsAutoAdd(true);
    expect(localStorage.getItem(OBS_AUTO_ADD_KEY)).toBe("true");
    expect(loadObsAutoAdd()).toBe(true);
  });

  it("false を保存すると 'false' 文字列で永続化し、load は false を返す", () => {
    saveObsAutoAdd(false);
    expect(localStorage.getItem(OBS_AUTO_ADD_KEY)).toBe("false");
    expect(loadObsAutoAdd()).toBe(false);
  });

  it("'true' 以外の値は false（厳密一致・壊れた値でも劣化）", () => {
    localStorage.setItem(OBS_AUTO_ADD_KEY, "1");
    expect(loadObsAutoAdd()).toBe(false);
    localStorage.setItem(OBS_AUTO_ADD_KEY, "yes");
    expect(loadObsAutoAdd()).toBe(false);
  });

  it("localStorage 読取が例外でも false へフォールバック（表示は継続）", () => {
    const spy = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    expect(loadObsAutoAdd()).toBe(false);
    spy.mockRestore();
  });

  it("localStorage 書込が例外でも投げない（プライベートモード等でも壊れない）", () => {
    const spy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    expect(() => saveObsAutoAdd(true)).not.toThrow();
    spy.mockRestore();
  });

  it("保存されるのは boolean 用キーのみで、機密キーは作らない（§9）", () => {
    saveObsAutoAdd(true);
    const keys = storedKeys();
    expect(keys).toContain(OBS_AUTO_ADD_KEY);
    // password/pw/secret/token を含むキーは一切作らない（機密は localStorage に置かない）。
    expect(keys.some((k) => /password|pw|secret|token/i.test(k))).toBe(false);
  });
});

/**
 * 046b: 「固定コメントをOBSに表示」トグルの永続化。
 * あるべき挙動（docs/tasks/046b-pinned-overlay-window.md）:
 * - 保存するのは**ユーザー自身の UI 設定値（boolean）だけ**。固定コメントの中身（本文・表示名・金額）は
 *   046a の別キー（`pinnedComments.ts`）の責務で、このモジュールは一切触らない。
 * - 044a の `obsAutoAdd` と同型（"true" 厳密一致・例外は false へ劣化）。
 * - **キーが `obsAutoAdd` と独立している**こと（片方の保存がもう片方を書き換えない）。
 */
describe("loadPinnedOverlayEnabled / savePinnedOverlayEnabled", () => {
  it("未保存のときは既定 OFF（false）", () => {
    expect(loadPinnedOverlayEnabled()).toBe(false);
  });

  it("true/false を 'true'/'false' 文字列で永続化し、load が往復する", () => {
    savePinnedOverlayEnabled(true);
    expect(localStorage.getItem(PINNED_OVERLAY_ENABLED_KEY)).toBe("true");
    expect(loadPinnedOverlayEnabled()).toBe(true);

    savePinnedOverlayEnabled(false);
    expect(localStorage.getItem(PINNED_OVERLAY_ENABLED_KEY)).toBe("false");
    expect(loadPinnedOverlayEnabled()).toBe(false);
  });

  it("'true' 以外の値は false（厳密一致・壊れた値でも劣化）", () => {
    localStorage.setItem(PINNED_OVERLAY_ENABLED_KEY, "1");
    expect(loadPinnedOverlayEnabled()).toBe(false);
  });

  it("読取/書込が例外でも壊れない（false へ劣化・投げない）", () => {
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(loadPinnedOverlayEnabled()).toBe(false);
    get.mockRestore();

    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => savePinnedOverlayEnabled(true)).not.toThrow();
    set.mockRestore();
  });

  it("044a の自動反映トグルとはキーが独立している（互いに書き換えない）", () => {
    saveObsAutoAdd(true);
    savePinnedOverlayEnabled(false);
    expect(loadObsAutoAdd()).toBe(true);
    expect(loadPinnedOverlayEnabled()).toBe(false);
    expect(PINNED_OVERLAY_ENABLED_KEY).not.toBe(OBS_AUTO_ADD_KEY);
  });
});

/**
 * 064a/064c: 鳴らせる OBS ソースの一覧（コメビュ窓が書き、main 窓が読む）。
 *
 * ⚠⚠ **`ok`（OBS へ繋がったか）と `sources.length`（鳴らせるものがあるか）は別物**である。
 * 混ぜると、OBS が起動していないユーザーへ「OBS のシーンにソースを追加してください」という
 * **間違った対処**を案内することになる（064a の壊れ方＝061a レビュー Q-1 と同じ失敗モードの 3 度目）。
 *
 * ⚠ このキーは**他窓からも書ける**ので、形が違う値はすべて安全側へ倒す
 * （`loadEffectConditions` と同じ姿勢）。⚠ 載るのは**ユーザー自身が OBS で付けた名前と種別だけ**（§9）。
 */
describe("064c: loadObsSourceList / saveObsSourceList", () => {
  it("未保存のときは null（「まだ無い」と「0 件」を混ぜない）", () => {
    expect(loadObsSourceList()).toBeNull();
  });

  it("ok と一覧が往復する（at も付く）", () => {
    saveObsSourceList([{ name: "花火", kind: "ffmpeg_source" }], true);
    const got = loadObsSourceList();
    expect(got?.ok).toBe(true);
    expect(got?.sources).toEqual([{ name: "花火", kind: "ffmpeg_source" }]);
    expect(typeof got?.at).toBe("number");
  });

  it("⚠⚠ 繋がらなかった（ok:false・0 件）を、繋がって 0 件と区別して保存する", () => {
    saveObsSourceList([], false);
    expect(loadObsSourceList()).toMatchObject({ ok: false, sources: [] });

    saveObsSourceList([], true);
    expect(loadObsSourceList()).toMatchObject({ ok: true, sources: [] });
  });

  it("⚠⚠ ok が無い／boolean でない値は false へ倒す（「取れた」と断言しない）", () => {
    // ⚠⚠ **倒し先を間違えないこと。** `true` へ倒すと、0 件のときに
    //   「OBS のシーンにソースを追加してください」＝064c が潰した当の誤案内が復活する。
    //   ⚠ 同じ規則を WS 境界（`commentStream.ts`）も持っている。**片方だけ緩めない。**
    for (const raw of [
      '{"at":1,"sources":[]}',
      '{"at":1,"ok":"true","sources":[]}',
      '{"at":1,"ok":1,"sources":[]}',
      '{"at":1,"ok":null,"sources":[]}',
    ]) {
      localStorage.setItem(OBS_SOURCE_LIST_KEY, raw);
      expect(loadObsSourceList()?.ok).toBe(false);
    }
  });

  it("⚠ 読めない・形が違う値は「まだ無い」へ倒す（他窓が書ける値を信用しない）", () => {
    for (const raw of [
      "not json",
      "null",
      "[]",
      '{"ok":true,"sources":"nope"}',
      '{"at":"x","ok":true,"sources":[]}',
    ]) {
      localStorage.setItem(OBS_SOURCE_LIST_KEY, raw);
      expect(loadObsSourceList()).toBeNull();
    }
  });

  it("⚠ 要素の形が違うものは、その要素だけ落とす（一覧ごと捨てない）", () => {
    localStorage.setItem(
      OBS_SOURCE_LIST_KEY,
      JSON.stringify({
        at: 1,
        ok: true,
        sources: [
          null,
          42,
          { name: 1, kind: "ffmpeg_source" },
          { name: "花火", kind: "ffmpeg_source" },
        ],
      }),
    );
    expect(loadObsSourceList()?.sources).toEqual([
      { name: "花火", kind: "ffmpeg_source" },
    ]);
  });

  it("書込が例外でも壊れない（投げない）", () => {
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => saveObsSourceList([], true)).not.toThrow();
    set.mockRestore();
  });
});
