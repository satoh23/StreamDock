import { describe, it, expect } from "vitest";
import {
  enqueuePendingRecords,
  PENDING_RECORD_LIMIT,
  type PendingRecordBatch,
} from "./pendingRecords";
import type { CommentViewDto } from "../comment-viewer/types";

/**
 * 062b: セッション未確定中のコメント記録バッファ（純関数）の仕様テスト。
 *
 * あるべき挙動（docs/tasks/062b・穴 B）:
 * - 記録は**取りこぼさない**（確定後にまとめて流せるよう、順番も保つ）。
 * - `added` / `updated` の区別（＝038c の判定コールバックを渡すか）を保つ。
 * - 上限を超えたら**古いほうから捨て、捨てた件数を返す**（黙って消さない）。
 */

function comments(n: number, prefix = "c"): CommentViewDto[] {
  return Array.from(
    { length: n },
    (_, i) =>
      ({
        id: `${prefix}${i}`,
        source: "twitch",
        author: { id: "u1", name: "Alice" },
        text: "hi",
        publishedAt: "2026-08-16T12:00:00Z",
        eventType: "chat",
      }) as CommentViewDto,
  );
}

const batch = (n: number, withResult = true, prefix = "c"): PendingRecordBatch => ({
  comments: comments(n, prefix),
  withResult,
});

describe("enqueuePendingRecords", () => {
  it("順番を保って積み、取りこぼさない", () => {
    const first = enqueuePendingRecords([], batch(2, true, "a"));
    const second = enqueuePendingRecords(first.next, batch(3, false, "b"));
    expect(second.dropped).toBe(0);
    expect(second.next).toHaveLength(2);
    expect(second.next[0].comments.map((c) => c.id)).toEqual(["a0", "a1"]);
    expect(second.next[1].comments.map((c) => c.id)).toEqual(["b0", "b1", "b2"]);
  });

  // ⚠ 043e: `updated`（combo 更新）へ判定コールバックを渡すとバッジが再点灯する。区別を落とさないこと。
  it("added / updated の区別を保つ", () => {
    const { next } = enqueuePendingRecords(
      enqueuePendingRecords([], batch(1, true, "a")).next,
      batch(1, false, "b"),
    );
    expect(next.map((b) => b.withResult)).toEqual([true, false]);
  });

  it("空バッチは積まない（無駄なエントリを作らない）", () => {
    const { next, dropped } = enqueuePendingRecords([], batch(0));
    expect(next).toEqual([]);
    expect(dropped).toBe(0);
  });

  it("上限までは 1 件も捨てない", () => {
    const { next, dropped } = enqueuePendingRecords([], batch(PENDING_RECORD_LIMIT));
    expect(dropped).toBe(0);
    expect(next[0].comments).toHaveLength(PENDING_RECORD_LIMIT);
  });

  // ⚠ 溢れたら古いほうから捨て、**件数を返す**（呼び出し側がユーザーへ知らせるため）。
  it("上限を超えたら古いバッチから捨て、捨てた件数を返す", () => {
    const filled = enqueuePendingRecords([], batch(PENDING_RECORD_LIMIT, true, "old"));
    const { next, dropped } = enqueuePendingRecords(filled.next, batch(10, true, "new"));
    expect(dropped).toBe(PENDING_RECORD_LIMIT);
    expect(next).toHaveLength(1);
    expect(next[0].comments.map((c) => c.id)).toEqual(
      comments(10, "new").map((c) => c.id),
    );
  });

  // ⚠ バッチ単位で捨てると「1 バッチが上限超え」のときに全部消える。中を削って残せること。
  it("1 バッチだけで上限を超えた場合は、そのバッチの古い側だけを削る", () => {
    const { next, dropped } = enqueuePendingRecords([], batch(PENDING_RECORD_LIMIT + 3));
    expect(dropped).toBe(3);
    expect(next[0].comments).toHaveLength(PENDING_RECORD_LIMIT);
    expect(next[0].comments[0].id).toBe("c3"); // 古い 3 件だけが落ちる
  });

  it("入力を破壊しない（prev はそのまま）", () => {
    const prev = enqueuePendingRecords([], batch(1, true, "a")).next;
    const snapshot = [...prev];
    enqueuePendingRecords(prev, batch(1, true, "b"));
    expect(prev).toEqual(snapshot);
  });
});
