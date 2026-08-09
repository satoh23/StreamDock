import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { EffectOverlayApp } from "./EffectOverlayApp";
import { EFFECT_OVERLAY_GUIDE_PENDING_KEY } from "../../features/comment-viewer/overlaySettings";

/**
 * 061a: エフェクト専用オーバーレイ窓（label `effect-overlay`）の描画本体の仕様テスト。
 *
 * あるべき挙動（061a は**器だけ**・中身は 061b）:
 * - 透過窓の目印 `data-overlay="1"` を document に立て、unmount で外す（`OverlayApp` 踏襲）。
 * - **セットアップ用ガイドは「明示操作で開いたとき」だけ出て、一定時間で自動的に消える。**
 *   ⚠⚠ 061a レビュー（Q-1）で条件が 1 つ増えた。旧実装は**無条件に出していた**ため、
 *   `App.tsx` の起動時復元（＝アプリ起動のたびに窓が開く経路。061a が同時に新設した）でも出てしまい、
 *   「配信直前に StreamDock を起動」で 30 秒間 OBS のキャプチャに映っていた。
 *   いまは `EFFECT_OVERLAY_GUIDE_PENDING_KEY`（`ObsEffectsScreen` の表示トグル ON だけが立てる
 *   ワンショット旗）が立っているときだけ出し、マウント時に旗を倒す。
 * - ⚠ **エフェクトの中身は何も描かない**（061b が描く）。とくに第三者のコメント本文・投稿者名・
 *   金額・アバターを 061a の時点で持ち込んでいないこと。
 * - ⚠ **安定クラス `sd-overlay` を付けない**（060d の注入先は `comment-overlay` のみ）。
 *   静的ガード `check-css-guards.mjs` (10-d) と二重に固定する（あちらは字面、こちらは実 DOM）。
 */
describe("061a: EffectOverlayApp", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.documentElement.removeAttribute("data-overlay");
  });

  /** 明示操作（`ObsEffectsScreen` の表示トグル ON）で窓が開いた状況を作る。 */
  const armGuide = () =>
    localStorage.setItem(EFFECT_OVERLAY_GUIDE_PENDING_KEY, "true");

  it("data-overlay を立て、unmount で外す", () => {
    const { unmount } = render(<EffectOverlayApp />);
    expect(document.documentElement.getAttribute("data-overlay")).toBe("1");
    unmount();
    expect(document.documentElement.hasAttribute("data-overlay")).toBe(false);
  });

  it("明示操作で開いた直後はセットアップ用ガイドが出る（OBS でキャプチャ範囲を確認するため）", () => {
    armGuide();
    render(<EffectOverlayApp />);
    expect(screen.getByText("StreamDock エフェクト")).toBeInTheDocument();
    expect(
      screen.getByText(/この枠にエフェクトが表示されます/),
    ).toBeInTheDocument();
  });

  it("⚠ 旗が立っていなければガイドを出さない（起動時の窓復元では配信画面を汚さない）", () => {
    // ⚠ 061a レビュー（Q-1）の本命。`App.tsx` の起動時復元は旗を立てないので、
    // 「設定 ON のまま配信直前に StreamDock を起動」でガイドが OBS に映らないこと。
    render(<EffectOverlayApp />);
    expect(screen.queryByText("StreamDock エフェクト")).toBeNull();
    expect(screen.queryByText(/この枠にエフェクトが表示されます/)).toBeNull();
  });

  it("⚠ 旗はマウント時に倒れる（次に開く窓ではもう出ない）", () => {
    armGuide();
    const { unmount } = render(<EffectOverlayApp />);
    expect(screen.getByText("StreamDock エフェクト")).toBeInTheDocument();
    expect(localStorage.getItem(EFFECT_OVERLAY_GUIDE_PENDING_KEY)).toBe("false");

    // 窓を開き直しても（旗が立て直されていなければ）出ない。
    unmount();
    render(<EffectOverlayApp />);
    expect(screen.queryByText("StreamDock エフェクト")).toBeNull();
  });

  it("ガイドは一定時間で自動的に消える（開けっぱなしでも残らないことの担保）", () => {
    vi.useFakeTimers();
    armGuide();
    render(<EffectOverlayApp />);
    expect(screen.getByText("StreamDock エフェクト")).toBeInTheDocument();

    // ⚠ 実装の定数（SETUP_GUIDE_VISIBLE_MS）より十分に長く進める。テストは**「いつか消える」**を
    // 固定するのが目的で、秒数そのものを固定すると値の調整のたびに落ちる（値の根拠は実装の JSDoc）。
    act(() => {
      vi.advanceTimersByTime(120_000);
    });
    expect(screen.queryByText("StreamDock エフェクト")).toBeNull();
    expect(screen.queryByText(/この枠にエフェクトが表示されます/)).toBeNull();
  });

  it("ガイドが消えたあとは何も描かない（061a は器だけ・中身は 061b）", () => {
    vi.useFakeTimers();
    armGuide();
    const { container } = render(<EffectOverlayApp />);
    act(() => {
      vi.advanceTimersByTime(120_000);
    });
    // ルート要素は残る（061b がここへ描く器）が、その中は空であること。
    expect(container.textContent).toBe("");
  });

  it("安定クラス sd-overlay を付けない（060d の注入先は comment-overlay のみ）", () => {
    const { container } = render(<EffectOverlayApp />);
    expect(container.querySelector(".sd-overlay")).toBeNull();
  });

  it("WS へ接続しない（061b は localStorage + storage で受ける設計）", () => {
    // ⚠ この窓の「通信面ゼロ」は 061b の設計前提でもある（061b はコメビュ窓が localStorage へ書いた
    // `EffectRequest` を `storage` 購読で受ける＝新規 WS も Tauri イベントも増やさない）。
    // `connectCommentStream` を呼ぶと `new WebSocket(...)` が走るので、グローバルを差し替えて
    // **1 本も張られない**ことを固定する（`PinnedOverlayApp` と同じ性質）。
    const original = globalThis.WebSocket;
    const ctor = vi.fn();
    // jsdom の WebSocket コンストラクタを、呼ばれたことだけ記録する関数へ差し替える。
    globalThis.WebSocket = ctor as unknown as typeof WebSocket;
    try {
      render(<EffectOverlayApp />);
      expect(ctor).not.toHaveBeenCalled();
    } finally {
      globalThis.WebSocket = original;
    }
  });
});
