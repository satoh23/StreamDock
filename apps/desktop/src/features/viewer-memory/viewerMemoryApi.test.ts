import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CommentViewDto } from "../comment-viewer/types";
import type { RecordResult } from "./types";

/**
 * 038c: `recordComments` の結果伝達（fire-and-forget＋onResult 通知）の仕様テスト。
 * あるべき挙動（progress.md 038c / security.md §1・§9）:
 * - 各コメントを `record_comment` command で記録し、解決時に `onResult(comment.id, 判定)` を通知する。
 * - fire-and-forget＝同期的に例外を投げず表示/読み上げを止めない。記録失敗（invoke reject）は握り潰し、
 *   onResult も呼ばない（best-effort）。
 * - onResult は任意（未指定でも壊れない）。
 * invoke（Tauri command）はモックする＝テストは端末外通信も OS 操作も一切しない（§1）。
 */
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { recordComment, recordComments } from "./viewerMemoryApi";

const mockInvoke = vi.mocked(invoke);

const makeComment = (over: Partial<CommentViewDto> = {}): CommentViewDto => ({
  id: "c1",
  source: "twitch",
  author: { id: "u1", name: "Alice" },
  text: "hello",
  publishedAt: "2026-07-26T10:00:00Z",
  eventType: "chat",
  ...over,
});

const rr = (firstTime: boolean, longAbsence: boolean): RecordResult => ({
  firstTime,
  longAbsence,
});

// fire-and-forget の .then/.catch（マイクロタスク）を確実に流し切る。
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  mockInvoke.mockReset();
});

describe("recordComment", () => {
  it("record_comment command を comment/sessionId 付きで呼び、判定をそのまま返す", async () => {
    mockInvoke.mockResolvedValueOnce(rr(true, false));
    const got = await recordComment(makeComment({ id: "c1" }), "s1");
    expect(got).toEqual(rr(true, false));
    expect(mockInvoke).toHaveBeenCalledWith("record_comment", {
      comment: expect.objectContaining({ id: "c1" }),
      sessionId: "s1",
    });
  });
});

describe("recordComments 038c: fire-and-forget＋onResult 通知", () => {
  it("各コメントを記録し、解決時に comment.id 付きで判定を通知する", async () => {
    mockInvoke
      .mockResolvedValueOnce(rr(true, false))
      .mockResolvedValueOnce(rr(false, true));
    const onResult = vi.fn();

    recordComments(
      [makeComment({ id: "c1" }), makeComment({ id: "c2" })],
      "s1",
      onResult,
    );
    await flush();

    expect(mockInvoke).toHaveBeenCalledTimes(2);
    expect(onResult).toHaveBeenCalledWith("c1", rr(true, false));
    expect(onResult).toHaveBeenCalledWith("c2", rr(false, true));
  });

  it("記録失敗（invoke reject）は握り潰す＝onResult を呼ばず例外も投げない（表示/読み上げを止めない）", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("db error"));
    const onResult = vi.fn();

    // 同期的に例外を投げない（fire-and-forget）。
    expect(() =>
      recordComments([makeComment({ id: "c1" })], "s1", onResult),
    ).not.toThrow();
    await flush();

    expect(onResult).not.toHaveBeenCalled();
  });

  it("onResult 未指定でも解決時に例外にならない（任意コールバック）", async () => {
    mockInvoke.mockResolvedValueOnce(rr(true, false));

    expect(() =>
      recordComments([makeComment({ id: "c1" })], "s1"),
    ).not.toThrow();
    await flush();

    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it("空配列では何も記録せず onResult も呼ばない（境界）", async () => {
    const onResult = vi.fn();
    recordComments([], "s1", onResult);
    await flush();
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(onResult).not.toHaveBeenCalled();
  });
});
