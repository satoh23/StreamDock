import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { MainScreen } from "./MainScreen";
import type { PresetItemWithTool } from "../../features/presets/types";

/**
 * 061b: ツール管理（メイン画面）の**内蔵コメントビューア行の「停止」**の仕様テスト。
 *
 * ⚠⚠ **ここで固定しているのは意匠ではなく `docs/security.md` §1 の「取得の停止条件」である。**
 *
 * 061b で sidecar の停止条件が「コメビュ窓 **or** エフェクト窓のどちらも無いとき」へ広がった結果、
 * **「コメビュ窓を閉じる＝Twitch/YouTube の取得（インターネット通信）が止まる」が偽になった**
 * （sidecar の取得セッションは `stop-session` かプロセス終了でしか止まらず、窓の close では
 * `stop-session` を送らない）。＝**エフェクト窓が開いている間は、この「停止」ボタンを押しても取得は続く。**
 *
 * §1 はこれを受けて「**取得が続いていることと、その止め方をユーザーへ明示する導線を必ず保つこと**」を
 * 要求している。⚠⚠ **061b レビュー②S-5 で、この導線が実質存在していなかったことが分かった**——
 * 明示は別画面（`ObsEffectsScreen`）の、さらに「コメビュ窓が閉じている」ときだけ出る注記しか無く、
 * **停止操作をした当の画面が「停止しました」と積極的に偽を述べていた**
 * （061a の Q-1「配信中には表示されません」と同じ失敗モード）。しかもエフェクト窓は永続設定で
 * アプリ起動時に自動復元されるので、ユーザーが数日その画面を見ていなくても成立する。
 *
 * ⚠ **窓の状態軸は増やさないのが仕様**（ツール行の意味は「窓が開いているか」のままで、
 * `is_comment_viewer_open` が見ているのも窓の存在）。増やすのは**フィードバック文言だけ**。
 *
 * 実 IPC は張らないため、Tauri command ラッパはすべてモックする（テストは端末外通信も OS 操作もしない）。
 */
const mocks = vi.hoisted(() => ({
  closeCommentViewerWindow: vi.fn(),
  isCommentViewerOpen: vi.fn(),
  isEffectOverlayOpen: vi.fn(),
  // 061k: ステージ窓ぶん（§1 の導線は**どちらか 1 つでも開いていれば**取得が続く）。
  isStageOverlayOpen: vi.fn(),
  listRuntimeProcesses: vi.fn(),
  launchTool: vi.fn(),
  stopProcess: vi.fn(),
  focusProcess: vi.fn(),
  launchPreset: vi.fn(),
  stopPresetProcesses: vi.fn(),
}));

vi.mock("../../features/comment-viewer/windowApi", () => ({
  closeCommentViewerWindow: mocks.closeCommentViewerWindow,
  isCommentViewerOpen: mocks.isCommentViewerOpen,
  isEffectOverlayOpen: mocks.isEffectOverlayOpen,
  isStageOverlayOpen: mocks.isStageOverlayOpen,
}));
vi.mock("../../features/presets/runtimeApi", () => ({
  listRuntimeProcesses: mocks.listRuntimeProcesses,
}));
vi.mock("../../features/tools/toolApi", () => ({
  launchTool: mocks.launchTool,
  stopProcess: mocks.stopProcess,
  focusProcess: mocks.focusProcess,
}));
vi.mock("../../features/presets/presetLaunchApi", () => ({
  launchPreset: mocks.launchPreset,
  stopPresetProcesses: mocks.stopPresetProcesses,
}));

/** 内蔵コメントビューア（`kind: "internal"`）1 行だけのプリセット構成。 */
const internalItem = (): PresetItemWithTool => ({
  id: "item-1",
  presetId: "preset-1",
  toolId: "tool-viewer",
  launchMode: "ordered",
  orderIndex: 0,
  enabled: true,
  createdAt: "2026-08-09T00:00:00Z",
  updatedAt: "2026-08-09T00:00:00Z",
  tool: {
    id: "tool-viewer",
    name: "コメントビューア",
    executablePath: "",
    description: "内蔵",
    iconLabel: "コ",
    kind: "internal",
    createdAt: "2026-08-09T00:00:00Z",
    updatedAt: "2026-08-09T00:00:00Z",
  },
});

const renderMain = () =>
  render(
    <MainScreen
      presetName="配信"
      presetId="preset-1"
      items={[internalItem()]}
      availableTools={[]}
      hasAnyTools
      onNavigate={() => {}}
      onAddTool={() => {}}
      onRemoveItem={() => {}}
      onReorder={() => {}}
      onSetLaunchMode={() => {}}
    />,
  );

/**
 * 「起動済み」まで進めてから停止ボタンを押す。
 *
 * ⚠ internal 行の state は**窓の開閉から導出**される（`is_comment_viewer_open`）ので、
 * マウント時の reconcile が解決するのを待ってから押す必要がある。
 */
const openThenStop = async () => {
  renderMain();
  const stop = await screen.findByTitle("停止");
  await act(async () => {
    stop.click();
  });
};

describe("061b: メイン画面・内蔵コメントビューアの「停止」", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listRuntimeProcesses.mockResolvedValue([]);
    // 窓は開いている＝行は「起動済み」＝停止ボタンが出る状態。
    mocks.isCommentViewerOpen.mockResolvedValue(true);
    mocks.isEffectOverlayOpen.mockResolvedValue(false);
    mocks.isStageOverlayOpen.mockResolvedValue(false);
    mocks.closeCommentViewerWindow.mockResolvedValue(undefined);
  });

  it("停止は窓を閉じるだけで、PID kill 系のコマンドを呼ばない（§6）", async () => {
    // ⚠ 内蔵コメビュは stream-dock が spawn した PID プロセスではなく**自アプリの窓**なので、
    //   停止経路に `stop_process` / `stop_preset_processes` が現れてはいけない。
    await openThenStop();
    expect(mocks.closeCommentViewerWindow).toHaveBeenCalledTimes(1);
    expect(mocks.stopProcess).not.toHaveBeenCalled();
    expect(mocks.stopPresetProcesses).not.toHaveBeenCalled();
  });

  it("エフェクト窓が閉じていれば「停止しました」と伝える（実際に取得も止まるため）", async () => {
    // ⚠ この場合はコメビュ窓の close で sidecar が落ちる（消費者が 1 つも残らない）＝取得も止まる。
    //   ここで余計な但し書きを出すと、エフェクトを使っていないユーザーに嘘を言うことになる。
    mocks.isEffectOverlayOpen.mockResolvedValue(false);
    await openThenStop();
    expect(
      await screen.findByText(/コメントビューア を停止しました/),
    ).toBeInTheDocument();
  });

  it("⚠⚠ エフェクト窓が開いていれば「取得が続いている」ことを伝える（§1・停止したと偽らない）", async () => {
    mocks.isEffectOverlayOpen.mockResolvedValue(true);
    await openThenStop();

    const feedback = await screen.findByText(/コメントの取得は続いています/);
    expect(feedback).toBeInTheDocument();
    // ⚠ 「停止しました」と**断言していない**こと（061a Q-1 と同じ失敗モードの再発防止）。
    expect(feedback.textContent).not.toContain("を停止しました");
  });

  it("⚠ 取得を止める方法も併せて伝える（§1「その止め方を明示する導線を必ず保つこと」）", async () => {
    // ⚠ 「続いています」とだけ言って放り出すと、ユーザーは止める手段に到達できない。
    // ⚠⚠ **061i レビュー S-1 でここを書き換えた。** 旧アサーションは
    //   `toContain("エフェクトの表示を OFF")` で**061i が廃止したトグルの名前を固定していた**ため、
    //   「案内が存在しない操作を指している」という退行を**テストが守ってしまっていた**。
    // ⚠⚠⚠ **061p で同じ失敗モードが 2 度目に発火した。** 061i/061k のアサーションは
    //   `toContain("OBSエフェクト")` / `toContain("ウィンドウを閉じる")` で
    //   **061p が廃止したボタンの名前を固定していた**（＝また存在しない操作を守っていた）。
    //   ⇒ **いまの止め方は「コメントビューアを開いて取得を停止する」1 つだけ**
    //   （`docs/security.md` §1 の 061p 追補）。⚠ **廃止した 2 つの名前が戻らないことも見る。**
    mocks.isEffectOverlayOpen.mockResolvedValue(true);
    await openThenStop();

    const feedback = await screen.findByText(/コメントの取得は続いています/);
    expect(feedback.textContent).toContain("コメントビューアを開いて");
    expect(feedback.textContent).toContain("取得を停止");
    // ⚠ 廃止した操作名が「親切だから」で戻ってこないようにする（061i / 061p の 2 世代ぶん）。
    expect(feedback.textContent).not.toContain("エフェクトの表示を OFF");
    expect(feedback.textContent).not.toContain("ウィンドウを閉じる");
  });

  it("⚠⚠ 061k（新規 12）: **ステージ窓だけ**開いていても「取得が続いている」と伝える", async () => {
    // ⚠⚠ **061i レビュー S-1 と同型の失敗モードを 061k で再発させないための本命。**
    //   `docs/security.md` §1 は「**どちらか 1 つでも開いていれば取得が続く**」なので、
    //   コーナー側だけを見る実装だと**「停止しました」と積極的に嘘を述べる**。
    mocks.isEffectOverlayOpen.mockResolvedValue(false);
    mocks.isStageOverlayOpen.mockResolvedValue(true);
    await openThenStop();

    const feedback = await screen.findByText(/コメントの取得は続いています/);
    expect(feedback.textContent).not.toContain("を停止しました");
    // ⚠⚠ **061p: 「2 つとも閉じる」という止め方は無くなった**（ボタンごと廃止）。
    //   ⇒ ステージ窓だけのときも**コーナー窓だけのときと同じ 1 つの止め方**を案内する。
    //   ⚠ ここで固定しているのは「**窓の組み合わせで案内が変わらない**」ことである。
    expect(feedback.textContent).toContain("コメントビューアを開いて");
  });

  it("⚠ 061k: 2 窓とも閉じているときだけ「停止しました」と言い切る", async () => {
    mocks.isEffectOverlayOpen.mockResolvedValue(false);
    mocks.isStageOverlayOpen.mockResolvedValue(false);
    await openThenStop();
    expect(
      await screen.findByText(/コメントビューア を停止しました/),
    ).toBeInTheDocument();
  });

  it("⚠ 窓の状態軸は増やさない（どちらの場合もツール行は「停止済み」になる）", async () => {
    // ⚠ ツール行の意味は「窓が開いているか」であり、取得が続いているかどうかではない
    //   （`is_comment_viewer_open` が見ているのは窓の存在）。文言だけを分岐させるのが 061b の決定。
    mocks.isEffectOverlayOpen.mockResolvedValue(true);
    await openThenStop();
    expect(await screen.findByText("停止済み")).toBeInTheDocument();
    expect(screen.queryByText("起動済み")).toBeNull();
  });

  it("⚠ エフェクト窓の判定に失敗しても停止操作は成功として扱う（通常の文言へフォールバック）", async () => {
    // ⚠ 停止（窓 close）自体は成功しているので、ここで失敗を見せると
    //   「停止できなかった」と誤解させる。判定はあくまで文言を足すためのもの。
    mocks.isEffectOverlayOpen.mockRejectedValue(new Error("ipc failed"));
    mocks.isStageOverlayOpen.mockRejectedValue(new Error("ipc failed"));
    await openThenStop();
    expect(
      await screen.findByText(/コメントビューア を停止しました/),
    ).toBeInTheDocument();
    expect(await screen.findByText("停止済み")).toBeInTheDocument();
  });

  it("⚠ 窓を閉じられなければ「起動済み」へ戻し、取得の但し書きは出さない", async () => {
    // ⚠ close に失敗した＝窓は開いたまま＝取得の状態も変わっていないので、
    //   「取得が続いています」を出すと原因を取り違えさせる（出すべきはエラー）。
    mocks.closeCommentViewerWindow.mockRejectedValue(new Error("close failed"));
    mocks.isEffectOverlayOpen.mockResolvedValue(true);
    await openThenStop();

    expect(screen.queryByText(/コメントの取得は続いています/)).toBeNull();
    expect(mocks.isEffectOverlayOpen).not.toHaveBeenCalled();
    expect(mocks.isStageOverlayOpen).not.toHaveBeenCalled();
  });
});
