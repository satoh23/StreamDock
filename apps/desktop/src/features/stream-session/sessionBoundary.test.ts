import { describe, it, expect } from "vitest";
import {
  connectedPlatforms,
  needsPlatformUpdate,
  platformsOfComments,
  SESSION_END_GRACE_MS,
} from "./sessionBoundary";
import type { CommentViewDto } from "../comment-viewer/types";

/**
 * 062b: 配信セッションの境界判定（純関数）の仕様テスト。
 *
 * あるべき挙動（docs/tasks/062b）:
 * - 「取得できている」＝ `connected` **だけ**。`idle` / `connecting` / `failed` はいずれも未接続扱いで、
 *   復帰は猶予（30 分）とコメント到着で拾う。
 * - コメントの `source` は「配信が生きている」証拠として使えるので、そこからプラットフォームを導ける。
 * - プラットフォームは**増える方向にだけ**追従する（片方が切れても記録から消さない）。
 */

function dto(source: "twitch" | "youtube", id = "c1"): CommentViewDto {
  return {
    id,
    source,
    author: { id: "u1", name: "Alice" },
    text: "hi",
    publishedAt: "2026-08-16T12:00:00Z",
    eventType: "chat",
  } as CommentViewDto;
}

describe("connectedPlatforms（生存判定）", () => {
  it("connected の provider だけを昇順で返す", () => {
    expect(connectedPlatforms("connected", "idle")).toEqual(["twitch"]);
    expect(connectedPlatforms("idle", "connected")).toEqual(["youtube"]);
    expect(connectedPlatforms("connected", "connected")).toEqual([
      "twitch",
      "youtube",
    ]);
  });

  // ⚠ 穴 K: `failed` を「接続中の一種」として扱わない（`deriveConnectionStatus` は表示用に
  //   4 状態を区別するが、境界判定は「取得できている / いない」の 2 値で決める）。
  it("connecting / failed / idle はいずれも未接続として扱う", () => {
    for (const state of ["idle", "connecting", "failed", "unknown"]) {
      expect(connectedPlatforms(state, state)).toEqual([]);
    }
  });
});

describe("platformsOfComments（コメント＝生存の証拠）", () => {
  it("受信バッチの source を昇順・重複なしで返す", () => {
    expect(
      platformsOfComments([dto("youtube", "a"), dto("twitch", "b"), dto("youtube", "c")]),
    ).toEqual(["twitch", "youtube"]);
  });

  it("空バッチは空配列（セッションを起こさない）", () => {
    expect(platformsOfComments([])).toEqual([]);
  });

  // WS 境界を跨いだ値なので、既知の 2 語以外は落とす（Rust の allow-list と二重）。
  it("未知の source は落とす", () => {
    const alien = { ...dto("twitch"), source: "kick" } as unknown as CommentViewDto;
    expect(platformsOfComments([alien])).toEqual([]);
    expect(platformsOfComments([alien, dto("youtube", "y")])).toEqual(["youtube"]);
  });
});

describe("needsPlatformUpdate（増分だけ Rust へ送る）", () => {
  it("増える分があるときだけ true", () => {
    expect(needsPlatformUpdate(["twitch"], ["youtube"])).toBe(true);
    expect(needsPlatformUpdate([], ["twitch"])).toBe(true);
  });

  it("既に記録済みなら false（コメントのたびに invoke を投げない）", () => {
    expect(needsPlatformUpdate(["twitch"], ["twitch"])).toBe(false);
    expect(needsPlatformUpdate(["twitch", "youtube"], ["twitch"])).toBe(false);
  });

  // ⚠ 減る方向は見ない＝片方が切れても `platforms` を書き換えに行かない。
  it("記録済みより少ない集合でも更新を要求しない", () => {
    expect(needsPlatformUpdate(["twitch", "youtube"], [])).toBe(false);
  });
});

describe("猶予時間", () => {
  // ⚠ 穴 N: Rust 側 `STALE_GRACE_MINUTES`（30 分）と対。**Rust 側はこれ以上**でなければ、
  //   回収が先回りして「猶予中（配信は続いている）」のセッションを閉じてしまう。
  it("30 分（Rust の回収猶予と同じ）", () => {
    expect(SESSION_END_GRACE_MS).toBe(30 * 60 * 1000);
  });
});
