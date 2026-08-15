import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { EffectOverlayApp } from "./EffectOverlayApp";
import { EFFECT_OVERLAY_GUIDE_PENDING_KEY } from "../../features/comment-viewer/overlaySettings";
import type { CommentViewDto } from "../../features/comment-viewer/types";
import { STAGE_OVERLAY_WINDOW_TITLE } from "./effectAssignments";

/**
 * 061a / 061b / **064d**: 配信画面用オーバーレイ窓（label `stage-overlay`）の仕様テスト。
 *
 * ## ⚠⚠ 064d でこのファイルは 8 割が消えた
 *
 * 061b〜061r の間、この窓の仕事は**取り込んだテンプレートを描くこと**で、
 * ケースの大半（発火・表示時間・先読み・キャッシュ・音・テスト表示）はそのためのものだった。
 * 064 で「エフェクトは **OBS 側のソース**を鳴らす」方式へ転換し、取り込み機能ごと削除したので、
 * **それらのケースは検査する対象そのものが存在しない**。
 * ⚠ 配信イベント（061l）の中身は [`EffectOverlayApp.streamEvent.test.tsx`] が固定している。
 *
 * ## いまここが固定していること
 *
 * - 透過窓の目印 `data-overlay="1"` を document に立て、unmount で外す（`OverlayApp` 踏襲）。
 * - **セットアップ用ガイドは「明示操作で開いたとき」だけ出て、一定時間で自動的に消える。**
 *   ⚠⚠ 061a レビュー（Q-1）で条件が 1 つ増えた。旧実装は**無条件に出していた**ため、
 *   `App.tsx` の起動時復元（＝アプリ起動のたびに窓が開く経路）でも出てしまい、
 *   「配信直前に StreamDock を起動」で 30 秒間 OBS のキャプチャに映っていた。
 *   いまは `EFFECT_OVERLAY_GUIDE_PENDING_KEY`（**明示操作だけが立てる**ワンショット旗）が
 *   立っているときだけ出し、マウント時に旗を倒す。
 *   ⚠⚠ **064d で起点が移った**——旧: `EffectTemplateCard` のテスト表示／
 *   新: **配信イベントの開始**（＝064d 以降で唯一の明示的な窓オープン）。
 *   起点側のケースは `ObsEffectsScreen.test.tsx` が固定する（この窓が見るのは
 *   「旗があれば出す・読んだら倒す」だけ）。
 * - ⚠⚠ **この窓は sidecar の WS へ読み取り専用で接続する**（061b で 061a の「接続しない」を反転）。
 *   その代償として第三者のコメント本文がこの窓に流れ込むので、**受け取っても描かない・保存しない・
 *   ログに出さない**ことを固定する。⚠ ここを落とすと §9 の担保が「実装がたまたまそうなっている」だけになる。
 * - ⚠ **安定クラス `sd-overlay` を付けない**（060d の注入先は `comment-overlay` のみ）。
 *   静的ガード `check-css-guards.mjs` (10-d) と二重に固定する（あちらは字面、こちらは実 DOM）。
 *
 * 実 WS を張らないよう `connectCommentStream` はモックする（**呼ばれること自体が検証対象**）。
 *
 * ⚠⚠ **061b レビュー（S-2）で §9 の担保に穴があった。** 当時のケースは「描かない」「localStorage へ
 * 保存しない」しか固定しておらず、実測ミューテーションで
 * **`console.log("[effect]", cs)` を足す変異が全ケース緑のまま生存**していた。下の
 * 「ログに出さない」ケースがこの穴を塞ぐ（`eslint.config.js` の `no-console` と二重）。
 * ⚠ **`useState` に持つだけで描かない変異は、いまも検出できていない**（外から観測する手段が無い）。
 * ⚠⚠ **064d でこの穴は構造的に狭まった**——この窓が受け取ったコメントから使うのは
 * **`fresh.length`（件数）だけ**で、本文・表示名を渡せる場所が型として 1 つも無い。
 */

const mocks = vi.hoisted(() => ({
  connectCommentStream: vi.fn(),
}));

vi.mock("../../features/comment-viewer/commentStream", () => ({
  connectCommentStream: mocks.connectCommentStream,
}));

const THIRD_PARTY_TEXT = "第三者のコメント本文です";
const THIRD_PARTY_NAME = "視聴者ネーム";
const superchat = (): CommentViewDto => ({
  id: "sc-1",
  source: "youtube",
  author: {
    id: "u1",
    name: THIRD_PARTY_NAME,
    avatar: "data:image/png;base64,AAAA",
  },
  text: THIRD_PARTY_TEXT,
  publishedAt: "2026-08-09T00:00:00Z",
  eventType: "superchat",
  monetaryAmount: "¥1,000",
  monetary: { amount: 1000, currency: "JPY" },
});

const emitComments = (comments: CommentViewDto[]) => {
  const handlers = mocks.connectCommentStream.mock.calls[0]?.[0];
  if (!handlers) throw new Error("connectCommentStream が呼ばれていない");
  act(() => {
    handlers.onComments(comments);
  });
};

describe("061a/061b/064d: EffectOverlayApp（配信イベントの出力窓）", () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.connectCommentStream.mockReset();
    mocks.connectCommentStream.mockReturnValue({ disconnect: vi.fn() });
  });

  afterEach(() => {
    vi.useRealTimers();
    document.documentElement.removeAttribute("data-overlay");
  });

  /** 明示操作（064d 以降は「配信イベントの開始」）で窓が開いた状況を作る。 */
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
    expect(screen.getByText(STAGE_OVERLAY_WINDOW_TITLE)).toBeInTheDocument();
    expect(
      screen.getByText(/この枠に配信イベントが表示されます/),
    ).toBeInTheDocument();
  });

  it("⚠⚠ ガイドの本文が「いつ出るか」を実装どおりに書いている（廃止した導線を名指ししない）", () => {
    // ⚠⚠ **この文だけは OBS のキャプチャに数十秒そのまま映る**ので、
    //   画面内の案内文より嘘の害が大きい（配信を見ている視聴者にも読める）。
    //   061i の実機確認で「ガイド本文だけが古い」を実際に踏んでいる。
    armGuide();
    render(<EffectOverlayApp />);
    expect(
      screen.getByText(/配信イベントを開始した直後だけ出て/),
    ).toBeInTheDocument();
    // ⚠ 064d で消えた導線（テスト表示・表示トグル）を名指ししていないこと。
    expect(screen.queryByText(/テスト表示/)).toBeNull();
    expect(screen.queryByText(/表示を ON/)).toBeNull();
  });

  it("⚠⚠ ガイドの窓名は定数から引く（Rust の実タイトルとずれると OBS で窓が見つからない）", () => {
    armGuide();
    render(<EffectOverlayApp />);
    // ⚠ 直書きに変える変異は、この 1 行と Rust の契約テストの両方で落ちる。
    expect(STAGE_OVERLAY_WINDOW_TITLE).toBe("StreamDock ステージ演出");
    expect(
      screen.getByText(
        new RegExp(`ウィンドウの一覧から「${STAGE_OVERLAY_WINDOW_TITLE}」`),
      ),
    ).toBeInTheDocument();
  });

  it("⚠ 旗が立っていなければガイドを出さない（起動時の窓復元では配信画面を汚さない）", () => {
    render(<EffectOverlayApp />);
    expect(screen.queryByText(STAGE_OVERLAY_WINDOW_TITLE)).toBeNull();
  });

  it("⚠ 旗はマウント時に倒れる（次に開く窓ではもう出ない）", () => {
    armGuide();
    const { unmount } = render(<EffectOverlayApp />);
    expect(localStorage.getItem(EFFECT_OVERLAY_GUIDE_PENDING_KEY)).not.toBe(
      "true",
    );
    unmount();
    render(<EffectOverlayApp />);
    expect(screen.queryByText(STAGE_OVERLAY_WINDOW_TITLE)).toBeNull();
  });

  it("ガイドは一定時間で自動的に消える（開けっぱなしでも残らないことの担保）", () => {
    vi.useFakeTimers();
    armGuide();
    render(<EffectOverlayApp />);
    expect(screen.getByText(STAGE_OVERLAY_WINDOW_TITLE)).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(screen.queryByText(STAGE_OVERLAY_WINDOW_TITLE)).toBeNull();
  });

  it("ガイドが消えたあとは何も描かない（開催していなければ空の透過窓）", () => {
    const { container } = render(<EffectOverlayApp />);
    expect(container.textContent).toBe("");
  });

  it("安定クラス sd-overlay を付けない（060d の注入先は comment-overlay のみ）", () => {
    const { container } = render(<EffectOverlayApp />);
    expect(container.querySelector(".sd-overlay")).toBeNull();
  });

  // --- sidecar への接続（061b で 061a の決定を反転） -------------------------------------------

  it("⚠ sidecar の WS へ接続する（061a の「接続しない」を 061b で反転した）", () => {
    render(<EffectOverlayApp />);
    expect(mocks.connectCommentStream).toHaveBeenCalledTimes(1);
  });

  it("⚠ 接続は「窓内 WS 1 本」（再レンダーで張り直さない）", () => {
    const { rerender } = render(<EffectOverlayApp />);
    rerender(<EffectOverlayApp />);
    expect(mocks.connectCommentStream).toHaveBeenCalledTimes(1);
  });

  it("⚠ unmount で切断する（窓を閉じたあと接続が残らない）", () => {
    const disconnect = vi.fn();
    mocks.connectCommentStream.mockReturnValue({ disconnect });
    const { unmount } = render(<EffectOverlayApp />);
    unmount();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it("⚠ 制御フレームを 1 つも送らない（読み取り専用＝onComments だけを使う）", () => {
    render(<EffectOverlayApp />);
    const handlers = mocks.connectCommentStream.mock.calls[0][0];
    // ⚠⚠ ハンドラは `onComments` 1 本だけ（`onObsState` 等を足すと送信側の口も要る）。
    expect(Object.keys(handlers)).toEqual(["onComments"]);
  });

  // --- §9（第三者のコメントが流れ込む窓であることの代償） ---------------------------------------

  it("⚠⚠ コメントを受け取っても本文・表示名・アバターを描かない（§9 の担保）", () => {
    const { container } = render(<EffectOverlayApp />);
    emitComments([superchat()]);
    expect(container.textContent).not.toContain(THIRD_PARTY_TEXT);
    expect(container.textContent).not.toContain(THIRD_PARTY_NAME);
    expect(container.querySelector("img")).toBeNull();
  });

  it("⚠⚠ 受け取ったコメントを localStorage へ保存しない（046a と同じ規律）", () => {
    render(<EffectOverlayApp />);
    emitComments([superchat()]);
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      const value = localStorage.getItem(key ?? "") ?? "";
      expect(value).not.toContain(THIRD_PARTY_TEXT);
      expect(value).not.toContain(THIRD_PARTY_NAME);
    }
  });

  it("⚠⚠ 受け取った第三者のコメントを console へ 1 バイトも出さない（§9 の担保）", () => {
    // ⚠⚠ **061b レビュー S-2 が塞いだ穴**——当時は `console.log("[effect]", cs)` を足す変異が
    //   全ケース緑のまま生存していた。⚠ 課金コメントだけでなく**通常チャットも流す**
    //   （量としては圧倒的多数で、061b レビュー②S-2 が指摘した取りこぼし）。
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
    try {
      render(<EffectOverlayApp />);
      emitComments([
        superchat(),
        { ...superchat(), id: "chat-1", eventType: "chat" },
      ]);
      for (const spy of spies) {
        for (const call of spy.mock.calls) {
          expect(JSON.stringify(call)).not.toContain(THIRD_PARTY_TEXT);
          expect(JSON.stringify(call)).not.toContain(THIRD_PARTY_NAME);
        }
      }
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});
