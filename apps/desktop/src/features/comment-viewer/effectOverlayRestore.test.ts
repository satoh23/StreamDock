import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  EFFECT_OVERLAY_ENABLED_KEY,
  EFFECT_OVERLAY_GUIDE_PENDING_KEY,
  STAGE_OVERLAY_ENABLED_KEY,
} from "./overlaySettings";

/**
 * 061a: **アプリ起動時のエフェクト窓の復元**の仕様テスト。
 *
 * ⚠⚠ **なぜこのテストが要るのか**: これは 061a で唯一「**ユーザー操作なしに窓が開く**」挙動で、
 * 046b の security-review が論点にした経路そのものである（docs/security.md の 061a 節「(2)」）。
 * 061a レビュー（Q-9）までは `App.tsx` の `useEffect` に直書きされており、`MainWindowApp` が
 * invoke 依存の hook を多数マウントする都合で**どのテストもカバーしていなかった**。
 *
 * 仕様（`docs/security.md` 061a 節 ／ `effectOverlayRestore.ts` の JSDoc ／ 046b の先例）:
 * - **設定 ON ＋ 窓なし → 開く。** 配信開始時に窓が無いと OBS のウィンドウキャプチャが真っ黒で始まるため。
 * - **設定 OFF → 開かない。** 既定 OFF ＝ 明示的に有効化していないユーザーの配信画面に窓を出さない。
 * - **窓あり → 開かない。** 最背面窓を余計に show してちらつかせない（Rust 側は冪等だが、意図を明示する）。
 * - ⚠ **`isEffectOverlayOpen()` の解決を待つ間に OFF にされたら開かない。**
 *   設定を先に読んで握ると stale な true で開いてしまい、自動 close 経路が無いので
 *   「設定 OFF なのに窓が OBS に映り続ける」がセッション中ずっと解消しない（046b と同じ判断）。
 * - ⚠⚠ **この経路ではセットアップ用ガイドの旗を立てない**（061a レビュー Q-1）。立てると
 *   「設定 ON のまま配信直前に StreamDock を起動」でガイドが OBS のキャプチャに映る。
 * - 例外は握りつぶさず呼び出し側（`App.tsx`）へ返す。
 *
 * invoke ラッパは全てモックする＝テストは外部通信も OS 操作も一切行わない（§1）。
 */

const mocks = vi.hoisted(() => ({
  isEffectOverlayOpen: vi.fn(),
  openEffectOverlayWindow: vi.fn(),
  // 061k: ステージ窓ぶん（**独立に**復元されることを見る）。
  isStageOverlayOpen: vi.fn(),
  openStageOverlayWindow: vi.fn(),
}));

vi.mock("./windowApi", () => ({
  isEffectOverlayOpen: mocks.isEffectOverlayOpen,
  openEffectOverlayWindow: mocks.openEffectOverlayWindow,
  isStageOverlayOpen: mocks.isStageOverlayOpen,
  openStageOverlayWindow: mocks.openStageOverlayWindow,
}));

const { restoreEffectOverlayWindow } = await import("./effectOverlayRestore");

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  mocks.isEffectOverlayOpen.mockResolvedValue(false);
  mocks.openEffectOverlayWindow.mockResolvedValue(undefined);
  mocks.isStageOverlayOpen.mockResolvedValue(false);
  mocks.openStageOverlayWindow.mockResolvedValue(undefined);
});

describe("061a: restoreEffectOverlayWindow（起動時の窓復元）", () => {
  it("設定 ON ＋ 窓なし → 窓を開く（配信開始時に OBS のソースが真っ黒にならない）", async () => {
    localStorage.setItem(EFFECT_OVERLAY_ENABLED_KEY, "true");
    mocks.isEffectOverlayOpen.mockResolvedValue(false);

    await restoreEffectOverlayWindow();

    expect(mocks.openEffectOverlayWindow).toHaveBeenCalledTimes(1);
    // ⚠ 引数を渡さない＝任意ラベル/任意オプションの窓生成を frontend から要求しない（§3）。
    expect(mocks.openEffectOverlayWindow).toHaveBeenCalledWith();
  });

  it("⚠ 設定 OFF → 開かない（ユーザー操作なしに配信画面へ窓を出さない・既定 OFF）", async () => {
    // 未保存＝既定 OFF。
    mocks.isEffectOverlayOpen.mockResolvedValue(false);

    await restoreEffectOverlayWindow();

    expect(mocks.openEffectOverlayWindow).not.toHaveBeenCalled();
  });

  it("⚠ 設定が明示的に false でも開かない（'false' 文字列を真と読まない）", async () => {
    localStorage.setItem(EFFECT_OVERLAY_ENABLED_KEY, "false");

    await restoreEffectOverlayWindow();

    expect(mocks.openEffectOverlayWindow).not.toHaveBeenCalled();
  });

  it("設定 ON ＋ 既に窓あり → 開き直さない（最背面窓を余計に show しない）", async () => {
    localStorage.setItem(EFFECT_OVERLAY_ENABLED_KEY, "true");
    mocks.isEffectOverlayOpen.mockResolvedValue(true);

    await restoreEffectOverlayWindow();

    expect(mocks.openEffectOverlayWindow).not.toHaveBeenCalled();
  });

  it("⚠⚠ 窓の存在確認を待つ間に設定が OFF になったら開かない（stale な true で開かない・046b）", async () => {
    // 「アプリ起動 → 復元が走る → 解決前に条件が全部消えて派生値が false になった」を再現する。
    // ⚠ 061k: 061i で旧トグルが廃止されたので、この値を false にするのは**条件の編集**である。
    // ⚠ ここが「設定を is* の解決**後**に読む」ことの本体。順序を入れ替えると、
    //    自動 close 経路が無いので「設定 OFF なのに窓が OBS に映り続ける」がセッション中解消しない。
    localStorage.setItem(EFFECT_OVERLAY_ENABLED_KEY, "true");
    let resolveIsOpen: ((open: boolean) => void) | undefined;
    mocks.isEffectOverlayOpen.mockReturnValue(
      new Promise<boolean>((resolve) => {
        resolveIsOpen = resolve;
      }),
    );

    const pending = restoreEffectOverlayWindow();
    // 解決前にユーザーが OFF にする。
    localStorage.setItem(EFFECT_OVERLAY_ENABLED_KEY, "false");
    resolveIsOpen?.(false);
    await pending;

    expect(mocks.openEffectOverlayWindow).not.toHaveBeenCalled();
  });

  it("⚠⚠ 復元ではセットアップ用ガイドの旗を立てない（配信直前の起動で配信画面を汚さない）", async () => {
    // 061a レビュー Q-1: 旗を立てるのは**明示操作だけ**（⚠ 061i で起点が「ウィンドウが停止中のときの
    //   テスト表示」へ移った＝`EffectTemplateCard`）。復元経路では立てない。
    localStorage.setItem(EFFECT_OVERLAY_ENABLED_KEY, "true");
    mocks.isEffectOverlayOpen.mockResolvedValue(false);

    await restoreEffectOverlayWindow();

    expect(mocks.openEffectOverlayWindow).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(EFFECT_OVERLAY_GUIDE_PENDING_KEY)).toBeNull();
  });

  it("⚠ 既に立っている旗を復元が消さない（トグル ON 直後の起動でもガイドは出せる）", async () => {
    // 「テスト表示で旗が立つ → 窓生成が失敗 → 次回起動で復元が開く」経路。
    // 旗は窓側（`EffectOverlayApp`）がマウント時に倒すので、復元は触らないのが正しい。
    localStorage.setItem(EFFECT_OVERLAY_ENABLED_KEY, "true");
    localStorage.setItem(EFFECT_OVERLAY_GUIDE_PENDING_KEY, "true");

    await restoreEffectOverlayWindow();

    expect(localStorage.getItem(EFFECT_OVERLAY_GUIDE_PENDING_KEY)).toBe("true");
  });

  it("窓の存在確認が失敗したら例外を返し、窓は開かない（呼び出し側が握りつぶす）", async () => {
    localStorage.setItem(EFFECT_OVERLAY_ENABLED_KEY, "true");
    mocks.isEffectOverlayOpen.mockRejectedValue(new Error("invoke failed"));

    await expect(restoreEffectOverlayWindow()).rejects.toThrow();
    expect(mocks.openEffectOverlayWindow).not.toHaveBeenCalled();
  });

  it("窓生成が失敗したら例外を返す（設定は残るので次回起動で再挑戦する）", async () => {
    localStorage.setItem(EFFECT_OVERLAY_ENABLED_KEY, "true");
    mocks.openEffectOverlayWindow.mockRejectedValue(new Error("build failed"));

    await expect(restoreEffectOverlayWindow()).rejects.toThrow();
  });

  // --- 061k（新規 10）: 2 窓を独立に復元する -----------------------------------------------------

  it("⚠⚠ 新規 10: 片方だけ ON なら片方だけ開く（コーナーのみ）", async () => {
    localStorage.setItem(EFFECT_OVERLAY_ENABLED_KEY, "true");
    // ⚠ stage のキーは未保存＝ false。

    await restoreEffectOverlayWindow();

    expect(mocks.openEffectOverlayWindow).toHaveBeenCalledTimes(1);
    // ⚠⚠ **もう片方を巻き添えで開かないこと**（＝「開いたのに何も出ない窓」を作らない）。
    expect(mocks.openStageOverlayWindow).not.toHaveBeenCalled();
  });

  it("⚠⚠ 新規 10: 片方だけ ON なら片方だけ開く（ステージのみ）", async () => {
    localStorage.setItem(STAGE_OVERLAY_ENABLED_KEY, "true");

    await restoreEffectOverlayWindow();

    expect(mocks.openStageOverlayWindow).toHaveBeenCalledTimes(1);
    expect(mocks.openStageOverlayWindow).toHaveBeenCalledWith();
    expect(mocks.openEffectOverlayWindow).not.toHaveBeenCalled();
  });

  it("⚠ 両方 ON なら両方開く", async () => {
    localStorage.setItem(EFFECT_OVERLAY_ENABLED_KEY, "true");
    localStorage.setItem(STAGE_OVERLAY_ENABLED_KEY, "true");

    await restoreEffectOverlayWindow();

    expect(mocks.openEffectOverlayWindow).toHaveBeenCalledTimes(1);
    expect(mocks.openStageOverlayWindow).toHaveBeenCalledTimes(1);
  });

  it("⚠⚠ 新規 10: **片方の窓の状態でもう片方を判断しない**（ステージだけ既に開いている）", async () => {
    // ⚠ これが「まとめて 1 回だけ `isOpen()` を見る」実装（＝片方の結果を使い回す）を殺す。
    localStorage.setItem(EFFECT_OVERLAY_ENABLED_KEY, "true");
    localStorage.setItem(STAGE_OVERLAY_ENABLED_KEY, "true");
    mocks.isEffectOverlayOpen.mockResolvedValue(false);
    mocks.isStageOverlayOpen.mockResolvedValue(true);

    await restoreEffectOverlayWindow();

    expect(mocks.openEffectOverlayWindow).toHaveBeenCalledTimes(1);
    // ⚠ 既に開いている窓は開き直さない（最背面窓を余計に show しない）。
    expect(mocks.openStageOverlayWindow).not.toHaveBeenCalled();
  });

  it("⚠⚠ ステージ側も「解決を待ってから設定を読む」（stale な true で開かない）", async () => {
    // ⚠ 061k: 061a の stale-true 対策は**窓ごとに**成立していなければならない。
    localStorage.setItem(STAGE_OVERLAY_ENABLED_KEY, "true");
    mocks.isStageOverlayOpen.mockImplementation(async () => {
      // 「解決を待つ間に条件が全部消えて派生値が false になった」を再現する。
      localStorage.removeItem(STAGE_OVERLAY_ENABLED_KEY);
      return false;
    });

    await restoreEffectOverlayWindow();

    expect(mocks.openStageOverlayWindow).not.toHaveBeenCalled();
  });

  it("⚠⚠ 片方の失敗がもう片方を巻き添えにしない（`Promise.all` にしない）", async () => {
    // ⚠ 窓生成の失敗は「その窓だけ OBS が真っ黒」に留めるのが正しい。
    //   `Promise.all` だと最初の reject で終わり、**もう片方の open が投げられないことがある**。
    localStorage.setItem(EFFECT_OVERLAY_ENABLED_KEY, "true");
    localStorage.setItem(STAGE_OVERLAY_ENABLED_KEY, "true");
    mocks.openEffectOverlayWindow.mockRejectedValue(new Error("build failed"));

    await expect(restoreEffectOverlayWindow()).rejects.toThrow();
    // ⚠⚠ **本命**: コーナーが失敗してもステージは開く。
    expect(mocks.openStageOverlayWindow).toHaveBeenCalledTimes(1);
  });
});
