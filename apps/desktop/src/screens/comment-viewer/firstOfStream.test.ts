import { describe, it, expect } from "vitest";
import type { CommentViewDto } from "../../features/comment-viewer/types";
import { trackFirstOfStream } from "./firstOfStream";

/**
 * 051: 「その配信で初めてしたコメント」の追跡（`trackFirstOfStream`）の仕様テスト。
 *
 * 仕様（こうあるべき）— firstOfStream.ts の docstring が正:
 * - 各視聴者について、**この配信での 1 件目のコメント id** を記録する（2 件目以降では更新しない）。
 * - 視聴者の同一性は `viewerIdOf`＝`source:author.id`。**同じ表示名でも source が違えば別人**。
 * - **冪等**: 同じ入力を何度渡しても結果が変わらない（StrictMode の updater 二重実行・同一コメントの
 *   再送・jewels の combo 更新に耐える）。これは「既記録の viewerId を上書きしない」で成立している。
 * - 変化ゼロなら `prev` を**同一参照で**返す（無駄な再レンダを起こさない＝`mergeMonetary` と同じ作法）。
 *
 * このテストが守っている最大の退行は「**2 件目のコメントが初コメント扱いに書き換わる**」こと。
 * 上書き禁止を外すと（＝素直に `set` するだけにすると）、同じ視聴者が喋るたびに「初コメ」バッジと枠色が
 * 最新行へ移動し、「今日はじめて喋った人」という意味が失われる。
 */

const comment = (over: Partial<CommentViewDto> = {}): CommentViewDto => ({
  id: "c1",
  source: "youtube",
  author: { id: "u1", name: "Alice" },
  text: "hello",
  publishedAt: "2026-01-01T00:00:00Z",
  eventType: "chat",
  ...over,
});

describe("trackFirstOfStream 051 その配信での初コメント", () => {
  it("初めて喋った視聴者のコメント id を記録する", () => {
    const next = trackFirstOfStream(new Map(), [comment({ id: "c1" })]);
    expect([...next.values()]).toEqual(["c1"]);
  });

  it("同じ視聴者の 2 件目では記録を更新しない（初コメントが最新行へ移らない）", () => {
    const first = trackFirstOfStream(new Map(), [comment({ id: "c1" })]);
    const next = trackFirstOfStream(first, [comment({ id: "c2" })]);

    expect([...next.values()]).toEqual(["c1"]);
    // 同じバッチ内に 2 件並んでも 1 件目だけが残る。
    const both = trackFirstOfStream(new Map(), [
      comment({ id: "c1" }),
      comment({ id: "c2" }),
    ]);
    expect([...both.values()]).toEqual(["c1"]);
  });

  it("視聴者ごとに 1 件ずつ記録する", () => {
    const next = trackFirstOfStream(new Map(), [
      comment({ id: "a1", author: { id: "u1", name: "Alice" } }),
      comment({ id: "b1", author: { id: "u2", name: "Bob" } }),
      comment({ id: "a2", author: { id: "u1", name: "Alice" } }),
    ]);
    expect(new Set(next.values())).toEqual(new Set(["a1", "b1"]));
  });

  it("source が違えば別人として扱う（viewerIdOf と同じ規則）", () => {
    // Twitch と YouTube で同じ author.id が来ても別の視聴者。
    const next = trackFirstOfStream(new Map(), [
      comment({ id: "y1", source: "youtube", author: { id: "u1", name: "A" } }),
      comment({ id: "t1", source: "twitch", author: { id: "u1", name: "A" } }),
    ]);
    expect(new Set(next.values())).toEqual(new Set(["y1", "t1"]));
  });

  it("同じ incoming を 2 回渡しても結果が変わらない（StrictMode の二重実行に耐える）", () => {
    const incoming = [comment({ id: "c1" })];
    const once = trackFirstOfStream(new Map(), incoming);
    // 2 回目は変化ゼロ＝同一参照で返る（＝冪等が参照レベルでも観測できる）。
    expect(trackFirstOfStream(once, incoming)).toBe(once);
    expect([...once.values()]).toEqual(["c1"]);
  });

  it("同一 id の再送・combo 更新でも初コメントは動かない", () => {
    // jewels の combo 更新は同じ id で金額だけ伸びて再送される（043e）。
    const jewels = (amount: string) =>
      comment({
        id: "g1",
        eventType: "jewels",
        text: "",
        monetaryAmount: amount,
      });
    const first = trackFirstOfStream(new Map(), [jewels("30 jewels")]);
    const next = trackFirstOfStream(first, [jewels("90 jewels")]);

    expect(next).toBe(first);
    expect([...next.values()]).toEqual(["g1"]);
  });

  it("変化ゼロなら prev を同一参照で返す（無駄な再レンダを起こさない）", () => {
    const prev = trackFirstOfStream(new Map(), [comment({ id: "c1" })]);
    expect(trackFirstOfStream(prev, [])).toBe(prev);
    expect(trackFirstOfStream(prev, [comment({ id: "c9" })])).toBe(prev);
  });

  it("課金イベントも通常チャットと同じく初コメントになりうる（種別で分けない）", () => {
    const next = trackFirstOfStream(new Map(), [
      comment({ id: "s1", eventType: "superchat", monetaryAmount: "1,000 JPY" }),
    ]);
    expect([...next.values()]).toEqual(["s1"]);
  });
});
