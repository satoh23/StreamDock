import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { CommentViewDto } from "../../features/comment-viewer/types";
import type { RecordResult } from "../../features/viewer-memory/types";
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

/**
 * 038c: 初見／久しぶりバッジの描画仕様テスト（品質レビュー Q1・test-coverage 欠如の後追い）。
 * renderDefaultItem の分岐（該当 id に firstTime→「初見」/ longAbsence→「久しぶり」・初見優先で 1 つだけ・
 * 非該当は無装飾・overlay 変種には出さない）を、ユーザーに見えるバッジ文言で担保する（CSS クラス名は
 * CSS Modules 変換に依存するため文言で検証する）。判定ロジック自体は Rust 側 5 件で担保済み。
 */
const badgesOf = (entries: Record<string, RecordResult>) =>
  new Map<string, RecordResult>(Object.entries(entries));

describe("CommentList 038c バッジ（初見／久しぶり）", () => {
  it("firstTime の id には「初見」バッジが出る（久しぶりは出ない）", () => {
    render(
      <CommentList
        comments={[makeComment({ id: "c1", text: "hi" })]}
        badges={badgesOf({ c1: { firstTime: true, longAbsence: false } })}
      />,
    );
    expect(screen.getByText("初見")).toBeTruthy();
    expect(screen.queryByText("久しぶり")).toBeNull();
  });

  it("longAbsence の id には「久しぶり」バッジが出る（初見は出ない）", () => {
    render(
      <CommentList
        comments={[makeComment({ id: "c1", text: "hi" })]}
        badges={badgesOf({ c1: { firstTime: false, longAbsence: true } })}
      />,
    );
    expect(screen.getByText("久しぶり")).toBeTruthy();
    expect(screen.queryByText("初見")).toBeNull();
  });

  it("両方 true でも初見が優先で 1 つだけ出す（久しぶりは出さない）", () => {
    render(
      <CommentList
        comments={[makeComment({ id: "c1", text: "hi" })]}
        badges={badgesOf({ c1: { firstTime: true, longAbsence: true } })}
      />,
    );
    expect(screen.getByText("初見")).toBeTruthy();
    expect(screen.queryByText("久しぶり")).toBeNull();
  });

  it("非該当 id（別コメント）はバッジ無し（従来どおり無装飾）", () => {
    render(
      <CommentList
        comments={[makeComment({ id: "c1", text: "hi" })]}
        badges={badgesOf({ other: { firstTime: true, longAbsence: false } })}
      />,
    );
    expect(screen.queryByText("初見")).toBeNull();
    expect(screen.queryByText("久しぶり")).toBeNull();
  });

  it("overlay バリアントには判定バッジが出ない（badges を渡しても renderDefaultItem 限定）", () => {
    render(
      <CommentList
        comments={[makeComment({ id: "c1", text: "hi" })]}
        variant="overlay"
        badges={badgesOf({ c1: { firstTime: true, longAbsence: false } })}
      />,
    );
    expect(screen.queryByText("初見")).toBeNull();
  });
});
