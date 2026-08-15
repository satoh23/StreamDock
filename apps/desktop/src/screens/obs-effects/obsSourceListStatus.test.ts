import { describe, it, expect } from "vitest";
import { obsSourceListStatus } from "./obsSourceListStatus";
import type { ObsSourceListSnapshot } from "../../features/comment-viewer/overlaySettings";

/**
 * 064c: 「OBS のソースを鳴らす」カードの**状態の決め方**の仕様テスト。
 *
 * ⚠⚠ **ここが 064 の受け入れ条件「OBS 未接続・ソース未設置のときに黙って何も起きない状態を
 * 作らない（画面で理由が読める）」の本体**である。⚠ 画面の文言は変わりうるが、
 * **どの状態に落ちるか**は変わってはいけないので、DOM を経由せずここで固定する。
 *
 * ⚠⚠⚠ **最重要は `disconnected` と `empty` を混ぜないこと。**
 * 064a は失敗も成功も空配列で返していたため両者を区別できず、
 * **OBS が起動していないユーザーへ「OBS のシーンにソースを追加してください」**という
 * 間違った対処を案内していた（061a レビュー Q-1 と同じ失敗モードの 3 度目）。
 */

const snap = (
  over: Partial<ObsSourceListSnapshot> = {},
): ObsSourceListSnapshot => ({
  at: 1000,
  ok: true,
  sources: [{ name: "花火", kind: "ffmpeg_source" }],
  ...over,
});

describe("064c: obsSourceListStatus", () => {
  it("取れている → ready", () => {
    expect(obsSourceListStatus(snap(), true, null, false)).toBe("ready");
  });

  it("⚠⚠ 繋がったが 0 件 → empty（「OBS のシーンに追加」を案内してよい状態）", () => {
    expect(obsSourceListStatus(snap({ sources: [] }), true, null, false)).toBe(
      "empty",
    );
  });

  it("⚠⚠⚠ 繋がらなかった → disconnected（0 件と混ぜない・064c の中心）", () => {
    // ⚠ ここが `empty` に落ちると、OBS が落ちているだけのユーザーを
    //   「OBS でソースを作る」作業へ誘導する（＝064a の誤案内が復活する）。
    expect(
      obsSourceListStatus(snap({ ok: false, sources: [] }), true, null, false),
    ).toBe("disconnected");
  });

  it("⚠ 繋がらなかったのに中身がある値でも disconnected（ok が優先）", () => {
    // ⚠ `ok:false` のとき sidecar は必ず空配列を返すが、この値は**他窓からも書ける**。
    //   「中身があるなら取れたのだろう」と推測しないこと。
    expect(obsSourceListStatus(snap({ ok: false }), true, null, false)).toBe(
      "disconnected",
    );
  });

  it("まだ 1 度も取っていない → never", () => {
    expect(obsSourceListStatus(null, true, null, false)).toBe("never");
  });

  // --- 返事待ちの判定（`at` の比較）-----------------------------------------------------------

  it("依頼したが一覧がまだ無い → pending", () => {
    expect(obsSourceListStatus(null, true, 5000, false)).toBe("pending");
  });

  it("⚠⚠ 依頼より古い一覧しか無い → pending（前回の結果を今回の返事と読まない）", () => {
    expect(obsSourceListStatus(snap({ at: 4999 }), true, 5000, false)).toBe(
      "pending",
    );
  });

  it("⚠ 依頼と同時刻の一覧は「返事が来た」とみなす（>= で比較）", () => {
    expect(obsSourceListStatus(snap({ at: 5000 }), true, 5000, false)).toBe(
      "ready",
    );
  });

  it("依頼より新しい一覧が来た → 中身で決まる", () => {
    expect(obsSourceListStatus(snap({ at: 5001 }), true, 5000, false)).toBe(
      "ready",
    );
    expect(
      obsSourceListStatus(
        snap({ at: 5001, ok: false, sources: [] }),
        true,
        5000,
        false,
      ),
    ).toBe("disconnected");
  });

  it("⚠ 待ちきれなかった → timeout", () => {
    expect(obsSourceListStatus(null, true, 5000, true)).toBe("timeout");
  });

  it("⚠⚠ 返事が来ていれば timedOut は無視される（遅れて届いた結果を捨てない）", () => {
    expect(obsSourceListStatus(snap({ at: 5001 }), true, 5000, true)).toBe(
      "ready",
    );
  });

  // --- コメビュ窓の有無 -----------------------------------------------------------------------

  it("⚠⚠ コメビュ窓が閉じている → no-viewer（他のどの状態よりも先に効く）", () => {
    // ⚠ 依頼を代行する窓が無い＝**押しても何も起きない**。8 秒待って timeout を出すのでは遅い。
    expect(obsSourceListStatus(snap(), false, null, false)).toBe("no-viewer");
    expect(obsSourceListStatus(null, false, 5000, false)).toBe("no-viewer");
    expect(obsSourceListStatus(null, false, 5000, true)).toBe("no-viewer");
    expect(
      obsSourceListStatus(snap({ ok: false, sources: [] }), false, null, false),
    ).toBe("no-viewer");
  });

  it("⚠⚠ 窓の状態が未取得（null）なら no-viewer にしない（初回の点滅を作らない）", () => {
    // ⚠ `isCommentViewerOpen` は 2 秒ポーリングなので、マウント直後は必ず `null` を通る。
    //   ここで「閉じています」を出すと、開いているユーザーにも一瞬出る
    //   （061d-2 レビュー S-1 の「取れていないなら断言しない」と同じ規律）。
    expect(obsSourceListStatus(snap(), null, null, false)).toBe("ready");
    expect(obsSourceListStatus(null, null, null, false)).toBe("never");
    expect(obsSourceListStatus(null, null, 5000, false)).toBe("pending");
  });
});
