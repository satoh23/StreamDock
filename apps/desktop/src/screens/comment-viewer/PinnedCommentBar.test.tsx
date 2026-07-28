import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { CommentViewDto } from "../../features/comment-viewer/types";
import { toPinned } from "../../features/comment-viewer/pinnedComments";
import { PinnedCommentBar } from "./PinnedCommentBar";

/**
 * 046a: 固定コメント帯の描画仕様テスト（品質レビュー Q-1・test-coverage 欠如の後追い）。
 *
 * `CommentViewerApp` 全体は WS/TTS/AudioContext/sidecar 依存が重く単体化コストが高いが、
 * `PinnedCommentBar` は props → JSX の純表示コンポーネント（state も副作用も持たない）なので、
 * `CommentList.test.tsx` と同じ流儀で直接テストできる。
 *
 * 仕様（こうあるべき）:
 * - 固定 0 件なら何も描かない（この機能を使わないユーザーには既存レイアウトが完全に不変）。
 * - 解除導線は**右クリックメニューのみ**（実機確認後の修正・2026-07-28 で「固定解除」ボタンを廃止）。
 *   一覧側の行は `MAX_COMMENTS`(=200) で流れ去るため、帯の側にも解除導線が要る（無いと解除できなくなる）。
 * - 金額を持たない課金種別は要約文言（composeEventMessage）、金額を持つ種別は種別ラベル＋金額バッジ。
 * - 配信元バッジは source ごとに描き分ける（Record で持つ＝三項演算子で片方に寄せない）。
 */

const makePinned = (over: Partial<CommentViewDto> = {}) =>
  toPinned({
    id: "p1",
    source: "twitch",
    author: { id: "u1", name: "Alice" },
    text: "hello",
    publishedAt: "2026-07-28T10:00:00Z",
    eventType: "chat",
    ...over,
  });

describe("PinnedCommentBar 046a 固定コメント帯", () => {
  it("固定 0 件なら何も描かない（既存レイアウトが不変）", () => {
    const { container } = render(
      <PinnedCommentBar pinned={[]} onUnpin={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("固定中のコメントを本文・投稿者名・「固定」バッジ付きで描く", () => {
    render(
      <PinnedCommentBar
        pinned={[makePinned({ text: "見失いたくないコメント" })]}
        onUnpin={vi.fn()}
      />,
    );
    expect(screen.getByText("見失いたくないコメント")).toBeTruthy();
    expect(screen.getByText("Alice")).toBeTruthy();
    expect(screen.getByText("固定")).toBeTruthy();
    // 帯自体はランドマークとして名前を持つ（支援技術で「固定したコメント」と読める）。
    expect(screen.getByLabelText("固定したコメント")).toBeTruthy();
  });

  it("解除ボタンは持たない（解除導線は右クリックメニューのみ）", () => {
    render(
      <PinnedCommentBar pinned={[makePinned()]} onUnpin={vi.fn()} />,
    );
    // 閉じている間はメニューも DOM に出さないので、button ロールは 0 になる。
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("項目を右クリックすると「固定解除」メニューが開き、ネイティブメニューは抑止される", () => {
    render(<PinnedCommentBar pinned={[makePinned()]} onUnpin={vi.fn()} />);
    // 抑止範囲の仕様を固定する（この帯の項目だけ preventDefault し、アプリ全体のメニューは潰さない）。
    const notCancelled = fireEvent.contextMenu(screen.getByText("hello"), {
      clientX: 20,
      clientY: 30,
    });
    expect(notCancelled).toBe(false);
    expect(screen.getByRole("menu")).toBeTruthy();
    expect(screen.getByRole("menuitem").textContent).toBe("固定解除");
  });

  it("右クリックメニューの「固定解除」を選ぶと、その項目の id を親へ返してメニューが閉じる", () => {
    const onUnpin = vi.fn();
    render(
      <PinnedCommentBar
        pinned={[makePinned({ id: "target-id" })]}
        onUnpin={onUnpin}
      />,
    );
    fireEvent.contextMenu(screen.getByText("hello"));
    fireEvent.click(screen.getByRole("menuitem"));
    expect(onUnpin).toHaveBeenCalledTimes(1);
    expect(onUnpin).toHaveBeenCalledWith("target-id");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("Esc で閉じる（onUnpin は呼ばない）", () => {
    const onUnpin = vi.fn();
    render(<PinnedCommentBar pinned={[makePinned()]} onUnpin={onUnpin} />);
    fireEvent.contextMenu(screen.getByText("hello"));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(onUnpin).not.toHaveBeenCalled();
  });

  it("金額を持つ種別は種別ラベル＋金額バッジで出る（043b の整形を流用）", () => {
    render(
      <PinnedCommentBar
        pinned={[
          makePinned({
            eventType: "superchat",
            text: "応援してます",
            monetary: { amount: 1000, currency: "JPY" },
            monetaryAmount: "1,000 JPY",
          }),
        ]}
        onUnpin={vi.fn()}
      />,
    );
    expect(screen.getByText("スーパーチャット")).toBeTruthy();
    expect(screen.getByText("1,000 JPY")).toBeTruthy();
    expect(screen.getByText("応援してます")).toBeTruthy();
  });

  it("金額を持たない課金種別は要約文言になる（monthCount/tier を保存している効果）", () => {
    render(
      <PinnedCommentBar
        pinned={[
          makePinned({
            eventType: "subscription",
            text: "",
            monthCount: 3,
            tier: 1,
          }),
        ]}
        onUnpin={vi.fn()}
      />,
    );
    // ピンストアが monthCount/tier を落としていたら、この文言が「サブスクに加入しました」へ劣化する。
    expect(
      screen.getByText("Aliceさんがサブスクを3ヶ月継続しました（Tier1）"),
    ).toBeTruthy();
  });

  it("配信元バッジは source ごとに描き分ける（Twitch / YouTube で別クラス）", () => {
    const { rerender } = render(
      <PinnedCommentBar
        pinned={[makePinned({ source: "twitch" })]}
        onUnpin={vi.fn()}
      />,
    );
    const twitchClass = screen.getByText("Twitch").className;

    rerender(
      <PinnedCommentBar
        pinned={[makePinned({ source: "youtube" })]}
        onUnpin={vi.fn()}
      />,
    );
    // CSS Modules のハッシュ名そのものは検証せず、「source ごとに別クラスが当たる」ことだけを固定する。
    //
    // 注記: 軽レビューで直した「三項演算子だと CommentSource に値が増えても黙って YouTube 色に寄る」問題は、
    // `Record<CommentSource, string>` による**コンパイル時のキー不足エラー**が担保するものであって、
    // このテストでは捕まえられない（union に第 3 の値が無い以上、三項に戻しても実行時の挙動は同じ）。
    // ミューテーション実測でもレッドにならないことを確認済み。型で守る箇所と割り切る。
    expect(screen.getByText("YouTube").className).not.toBe(twitchClass);
  });

  it("初見/久しぶりバッジ（038c）と combo 回数（043e）は帯には出さない", () => {
    render(
      <PinnedCommentBar
        pinned={[makePinned({ eventType: "jewels", comboCount: 3 })]}
        onUnpin={vi.fn()}
      />,
    );
    expect(screen.queryByText("初見")).toBeNull();
    expect(screen.queryByText("久しぶり")).toBeNull();
    expect(screen.queryByText("×3")).toBeNull();
  });
});
