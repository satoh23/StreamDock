import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { CommentViewDto } from "../../features/comment-viewer/types";
import { CommentList } from "./CommentList";

/**
 * 038b フォローアップ: 流れるコメントをクリック→視聴者詳細を開くための onSelect の仕様テスト。
 * 仕様（こうあるべき）:
 * - onSelect 指定時のみコメント行がクリック可能（押されたコメントを渡す）。
 * - onSelect 未指定なら従来どおり表示専用（行は button にならない・クリックしても何も起きない＝回帰なし）。
 */

const makeComment = (over: Partial<CommentViewDto> = {}): CommentViewDto => ({
  id: "c1",
  source: "twitch",
  author: { id: "u1", name: "Alice" },
  text: "hello",
  publishedAt: "2026-07-26T10:00:00Z",
  eventType: "chat",
  ...over,
});

describe("CommentList onSelect", () => {
  it("onSelect 指定時、行クリックでそのコメントを渡して呼ぶ", () => {
    const onSelect = vi.fn();
    render(
      <CommentList
        comments={[
          makeComment({ id: "c1", text: "hello" }),
          makeComment({ id: "c2", text: "world", author: { id: "u2", name: "Bob" } }),
        ]}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByText("hello"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0].id).toBe("c1");
  });

  it("onSelect 未指定なら行は非インタラクティブ（button ロールを持たず、クリックしても何も起きない）", () => {
    render(<CommentList comments={[makeComment({ text: "hello" })]} />);
    // off モードなのでジャンプボタンも無く、コメント行も button にならない＝button ロールは 0。
    expect(screen.queryByRole("button")).toBeNull();
    // クリックしても例外にならない（表示専用のまま）。
    fireEvent.click(screen.getByText("hello"));
  });
});
