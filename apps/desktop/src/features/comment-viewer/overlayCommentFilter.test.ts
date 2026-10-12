import { describe, expect, it } from "vitest";
import type { CommentViewDto } from "./types";
import {
  COMMENT_OVERLAY_LABEL,
  DEFAULT_OVERLAY_SOURCES,
  filterCommentsBySource,
  resolveOverlaySources,
  toOverlaySourceFilter,
} from "./overlayCommentFilter";

/**
 * 067a: **オーバーレイ窓が描いてよい配信元**を決める純関数の仕様テスト。
 *
 * あるべき挙動:
 *   - オーバーレイ窓は設定に従う（未指定なら両方＝035b 以来の現行挙動）。
 *   - **未知のラベルは何も描かない**（fail-closed。「全部描く」に倒さない）。
 *
 * ⚠⚠ 2026-09-12: 配信先ごとの出し分け（067b/c/e）は撤回し、**Twitch 専用窓ごと削除した**
 * （理由は `docs/tasks/067-multistream-output-split.md` §25）。
 * ⇒ `"twitch-overlay"` は**未知のラベル**になったので、fail-closed の一覧に入れて固定してある。
 */

/** テスト用のコメント 1 件（表示に要る最小フィールドだけ埋める）。 */
function comment(id: string, source: "twitch" | "youtube"): CommentViewDto {
  return {
    id,
    source,
    author: { name: `user-${id}` },
    text: `text-${id}`,
    publishedAt: "2026-09-09T00:00:00.000Z",
    eventType: "chat",
  } as CommentViewDto;
}

describe("resolveOverlaySources", () => {
  it("既定で両方を描く（035b 以来の現行挙動を変えない）", () => {
    expect(resolveOverlaySources(COMMENT_OVERLAY_LABEL)).toEqual(DEFAULT_OVERLAY_SOURCES);
    expect(DEFAULT_OVERLAY_SOURCES).toEqual(["twitch", "youtube"]);
  });

  it("設定に従う（片方だけ・両方 OFF も尊重する）", () => {
    expect(resolveOverlaySources(COMMENT_OVERLAY_LABEL, ["youtube"])).toEqual(["youtube"]);
    expect(resolveOverlaySources(COMMENT_OVERLAY_LABEL, ["twitch"])).toEqual(["twitch"]);
    // ⚠ 両方 OFF を「既定へ戻す」に倒さない（設定したのに効かない、を作らない）。
    expect(resolveOverlaySources(COMMENT_OVERLAY_LABEL, [])).toEqual([]);
  });

  it("⚠ 未知のラベルは何も描かない（fail-closed）", () => {
    // ⚠⚠ ここを「全部描く」に倒すと、ラベルの typo が**規約違反として表に出る**。
    // 空集合に倒しておけば「コメントが出ない」＝実機で即分かる方向に壊れる。
    // ⚠⚠⚠ `"twitch-overlay"` を入れてあるのは意図的——撤回で消した窓のラベルが
    //   どこかに残っていても、**何も描かない**ことを固定する。
    for (const label of [
      "main",
      "comment-viewer",
      "pinned-overlay",
      "twitch-overlay",
      "twitch-overlayX",
      "",
    ]) {
      expect(resolveOverlaySources(label, ["twitch", "youtube"])).toEqual([]);
    }
  });
});

describe("filterCommentsBySource", () => {
  const comments = [
    comment("1", "twitch"),
    comment("2", "youtube"),
    comment("3", "twitch"),
  ];

  it("許可された配信元のコメントだけを、順序を保って返す", () => {
    expect(filterCommentsBySource(comments, ["twitch"]).map((c) => c.id)).toEqual(["1", "3"]);
    expect(filterCommentsBySource(comments, ["youtube"]).map((c) => c.id)).toEqual(["2"]);
    expect(filterCommentsBySource(comments, ["twitch", "youtube"]).map((c) => c.id)).toEqual([
      "1",
      "2",
      "3",
    ]);
  });

  it("空集合なら必ず空（fail-closed の帰結）", () => {
    expect(filterCommentsBySource(comments, [])).toEqual([]);
  });

  it("元の配列を破壊しない", () => {
    filterCommentsBySource(comments, ["twitch"]);
    expect(comments).toHaveLength(3);
  });
});

describe("toOverlaySourceFilter", () => {
  it("2 つの ON/OFF を集合へ落とす", () => {
    expect(toOverlaySourceFilter(true, true)).toEqual(["twitch", "youtube"]);
    expect(toOverlaySourceFilter(true, false)).toEqual(["twitch"]);
    expect(toOverlaySourceFilter(false, true)).toEqual(["youtube"]);
  });

  it("⚠ 両方 OFF は空集合のまま（勝手に既定へ戻さない）", () => {
    expect(toOverlaySourceFilter(false, false)).toEqual([]);
  });
});

describe("窓ラベルの定数", () => {
  it("Rust の窓ラベルと一致している（`open_comment_overlay_window`）", () => {
    // ⚠ ラベルは Rust 側の窓生成と**バイト一致**していないと `App.tsx` の分岐に落ちない。
    // ⚠ 窓タイトル（OBS が探す文字列）とは別物なので混同しないこと（あちらは Rust の契約テストが固定）。
    expect(COMMENT_OVERLAY_LABEL).toBe("comment-overlay");
  });
});
