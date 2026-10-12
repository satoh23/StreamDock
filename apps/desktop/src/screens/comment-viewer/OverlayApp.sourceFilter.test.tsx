import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, screen, cleanup, waitFor } from "@testing-library/react";
import {
  OVERLAY_SHOW_TWITCH_KEY,
  OVERLAY_SHOW_YOUTUBE_KEY,
} from "../../features/comment-viewer/overlaySettings";
import type { CommentViewDto } from "../../features/comment-viewer/types";
import type { CommentStreamHandlers } from "../../features/comment-viewer/commentStream";
import { OverlayApp } from "./OverlayApp";

/**
 * 067a: **オーバーレイ窓が実際に配信元で絞って描画しているか**の配線テスト。
 *
 * ⚠⚠⚠ **`overlayCommentFilter.test.ts`（純関数）だけでは足りない。**
 * あちらは「何を描いてよいか」の判断を固定するが、
 * **`OverlayApp` がその結果を `CommentList` へ渡し忘れる**（絞る前の配列を渡す）と
 * 純関数のテストは緑のまま**設定で外したはずのコメントが出る**。⇒ 鎖の最後の輪をここで固定する。
 *
 * あるべき挙動:
 * - `comment-overlay` 窓は **既定で両方**を描く（035b 以来の現行挙動＝回帰させない）。
 * - `comment-overlay` 窓はユーザー設定に従う（storage イベントで開いたまま反映される）。
 * - ⚠ **未知のラベルは何も描かない**（fail-closed）。
 * - ⚠ `localStorage.clear()`（`key === null`）でも読み直す（レビュー Q-8）。
 *
 * 実 WS / Rust を踏まないよう `commentStream` と `overlayThemeApi` はモックする
 * （`OverlayApp.test.tsx` と同じ作法）。
 */

const mocks = vi.hoisted(() => ({
  connectCommentStream: vi.fn(),
  getOverlayThemeCss: vi.fn(),
  getOverlayThemeFontCss: vi.fn(),
  /** 実装が渡してきた handlers を捕捉する箱（ここへコメントを流し込む）。 */
  handlers: { current: null as CommentStreamHandlers | null },
}));

vi.mock("../../features/comment-viewer/commentStream", () => ({
  connectCommentStream: vi.fn((handlers: CommentStreamHandlers) => {
    mocks.handlers.current = handlers;
    return mocks.connectCommentStream(handlers) ?? { disconnect: vi.fn() };
  }),
}));

vi.mock("../../features/comment-viewer/overlayThemeApi", () => ({
  getOverlayThemeCss: mocks.getOverlayThemeCss,
  getOverlayThemeFontCss: mocks.getOverlayThemeFontCss,
}));

/** テスト用のコメント 1 件（表示に要る最小フィールドだけ埋める）。 */
function comment(id: string, source: "twitch" | "youtube"): CommentViewDto {
  return {
    id,
    source,
    author: { name: `name-${id}` },
    text: `body-${id}`,
    publishedAt: "2026-09-09T00:00:00.000Z",
    eventType: "chat",
  } as CommentViewDto;
}

/** sidecar からの受信を再現する（両プラットフォームを 1 件ずつ流す）。 */
function pushBothPlatforms(): void {
  act(() => {
    mocks.handlers.current?.onComments([
      comment("tw", "twitch"),
      comment("yt", "youtube"),
    ]);
  });
}

/**
 * 他窓（設定窓）での localStorage 書換を再現する（自窓の書換では storage は発火しない）。
 * ⚠ `key: null` は `localStorage.clear()` のときに飛ぶ形（実装が `e.key === null` で拾う）。
 */
function emitStorage(key: string | null): void {
  act(() => {
    window.dispatchEvent(new StorageEvent("storage", { key }));
  });
}

beforeEach(() => {
  localStorage.clear();
  mocks.handlers.current = null;
  mocks.connectCommentStream.mockReset();
  mocks.connectCommentStream.mockReturnValue({ disconnect: vi.fn() });
  mocks.getOverlayThemeCss.mockReset();
  mocks.getOverlayThemeCss.mockResolvedValue("");
  mocks.getOverlayThemeFontCss.mockReset();
  mocks.getOverlayThemeFontCss.mockResolvedValue("");
});

afterEach(() => {
  cleanup();
});

describe("OverlayApp: 配信元による描画の絞り込み（067a）", () => {
  it("⚠⚠⚠ 未知のラベルの窓は何も描かない（fail-closed）", async () => {
    // ⚠ 2026-09-12 に撤回した Twitch 専用窓のラベル。どこかに残っていても**何も出さない**。
    //   ⇒ 壊れ方が「出てはいけないものが出る」ではなく「出ない」になる（実機で即分かる向き）。
    localStorage.setItem(OVERLAY_SHOW_TWITCH_KEY, "true");
    localStorage.setItem(OVERLAY_SHOW_YOUTUBE_KEY, "true");

    render(<OverlayApp label="twitch-overlay" />);
    await waitFor(() => expect(mocks.handlers.current).not.toBeNull());
    pushBothPlatforms();

    expect(screen.queryByText("body-tw")).toBeNull();
    expect(screen.queryByText("body-yt")).toBeNull();
  });

  it("既定で両方を描く（035b 以来の現行挙動を回帰させない）", async () => {
    render(<OverlayApp label="comment-overlay" />);
    await waitFor(() => expect(mocks.handlers.current).not.toBeNull());
    pushBothPlatforms();

    expect(screen.getByText("body-tw")).toBeTruthy();
    expect(screen.getByText("body-yt")).toBeTruthy();
  });

  it("保存済み設定に従う（YouTube を OFF にすると出ない）", async () => {
    localStorage.setItem(OVERLAY_SHOW_YOUTUBE_KEY, "false");

    render(<OverlayApp label="comment-overlay" />);
    await waitFor(() => expect(mocks.handlers.current).not.toBeNull());
    pushBothPlatforms();

    expect(screen.getByText("body-tw")).toBeTruthy();
    expect(screen.queryByText("body-yt")).toBeNull();
  });

  it("設定窓での変更が storage イベントで開いたまま反映される（両方向）", async () => {
    render(<OverlayApp label="comment-overlay" />);
    await waitFor(() => expect(mocks.handlers.current).not.toBeNull());
    pushBothPlatforms();
    expect(screen.getByText("body-yt")).toBeTruthy();

    // OFF にする → 既に受信済みのコメントも消える（絞るのは受信時ではなく描画時）。
    localStorage.setItem(OVERLAY_SHOW_YOUTUBE_KEY, "false");
    emitStorage(OVERLAY_SHOW_YOUTUBE_KEY);
    expect(screen.queryByText("body-yt")).toBeNull();
    expect(screen.getByText("body-tw")).toBeTruthy();

    // ⚠ ON へ戻したら**過去のコメントも戻る**（受信時に捨てていないことの担保）。
    localStorage.setItem(OVERLAY_SHOW_YOUTUBE_KEY, "true");
    emitStorage(OVERLAY_SHOW_YOUTUBE_KEY);
    expect(screen.getByText("body-yt")).toBeTruthy();
  });

  it("⚠ localStorage.clear()（key=null）でも読み直す（既定 ON へ戻る）", async () => {
    // ⚠⚠ レビュー Q-8 で追加。実装は `e.key === null` を拾っているのに、**この 2 キーだけ
    //   テストが無かった**（テーマ側には同型のケースがある）。
    // ⚠⚠⚠ ここが壊れると「OFF にしていたのに、全消去のあと黙って ON に戻る」＝
    //   **出さないはずのコメントが配信に載る**側へ倒れる。fail-closed の逆向きなので固定する。
    localStorage.setItem(OVERLAY_SHOW_YOUTUBE_KEY, "false");

    render(<OverlayApp label="comment-overlay" />);
    await waitFor(() => expect(mocks.handlers.current).not.toBeNull());
    pushBothPlatforms();
    expect(screen.queryByText("body-yt")).toBeNull();

    localStorage.clear();
    emitStorage(null);
    expect(screen.getByText("body-yt")).toBeTruthy();
    expect(screen.getByText("body-tw")).toBeTruthy();
  });

  it("両方 OFF なら何も描かない（設定どおりに倒す）", async () => {
    localStorage.setItem(OVERLAY_SHOW_TWITCH_KEY, "false");
    localStorage.setItem(OVERLAY_SHOW_YOUTUBE_KEY, "false");

    render(<OverlayApp label="comment-overlay" />);
    await waitFor(() => expect(mocks.handlers.current).not.toBeNull());
    pushBothPlatforms();

    expect(screen.queryByText("body-tw")).toBeNull();
    expect(screen.queryByText("body-yt")).toBeNull();
  });
});
