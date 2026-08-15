import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * 061a: `App.tsx` の**窓ラベル分岐**の仕様テスト。
 *
 * あるべき挙動: 同一 Vite バンドルを全窓が読むので、`getCurrentWindow().label` だけで描くものが決まる。
 * - `stage-overlay` → `EffectOverlayApp`（⚠ 064d で `effect-overlay` は廃止）
 * - `pinned-overlay` → `PinnedOverlayApp`（⚠ 3 本目を足したときに既存の分岐を奪っていないこと）
 * - `comment-overlay` → `OverlayApp`
 *
 * ⚠ **`main` は検証しない。** `MainWindowApp` は Tauri の invoke に依存する hook を多数マウントするので、
 * ここで扱うとテストがルータの検証ではなく巨大な統合テストになる（`main` の中身は各画面のテストが持つ）。
 * ラベル分岐は上から順の early-return なので、既知ラベル 3 つが正しく出れば「既定へ落ちる」経路は
 * 残りの 1 本しかない。
 *
 * 各窓コンポーネントは目印だけを返すモックへ差し替える（実体の描画はそれぞれのテストの担当）。
 */

const mocks = vi.hoisted(() => ({
  label: { current: "main" as string },
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ label: mocks.label.current }),
}));

vi.mock("./screens/obs-effects/EffectOverlayApp", () => ({
  EffectOverlayApp: () => <div data-testid="effect-overlay-app" />,
}));
vi.mock("./screens/comment-viewer/PinnedOverlayApp", () => ({
  PinnedOverlayApp: () => <div data-testid="pinned-overlay-app" />,
}));
vi.mock("./screens/comment-viewer/OverlayApp", () => ({
  OverlayApp: () => <div data-testid="overlay-app" />,
}));
vi.mock("./screens/comment-viewer/CommentViewerApp", () => ({
  CommentViewerApp: () => <div data-testid="comment-viewer-app" />,
}));

// ⚠ `main` 分岐は描かないが、`App.tsx` の**モジュール読み込み**は起きるので、起動時の窓復元で使う
// 2 本の Rust command（`MainWindowApp` の 061a effect）が undefined にならないようにしておく。
//
// ⚠⚠ 061a レビュー（Q-9・**既知の穴として記録**）: その起動時復元 effect は
// 「**ユーザー操作なしに窓が開く**」という 061a で唯一セキュリティ的に意味のある挙動なのに、
// このファイルは `main` を検証対象外にした上で、ここのモックによって effect を塞いでいる
// ＝**どのテストもカバーしていない**（実機確認でのみ担保されている）。
// 今テストを足さないのは、`MainWindowApp` が invoke 依存の hook を多数マウントするため、
// ここで扱うとルータのテストが巨大な統合テストに化けるから（本ファイル冒頭の判断と同じ）。
// **再修正トリガー**＝復元条件が増える（設定 2 つ以上を見る／窓が 2 つになる）か、
// 061b で「起動時に何を描くか」が問題になったら、**この effect を純関数
//（`shouldRestoreEffectOverlay(enabled, isOpen)` 相当）へ切り出して単体テストする**。
vi.mock("./features/comment-viewer/windowApi", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("./features/comment-viewer/windowApi")
  >()),
  isEffectOverlayOpen: vi.fn(async () => false),
  openEffectOverlayWindow: vi.fn(async () => {}),
}));

import App from "./App";

describe("061a: App の窓ラベル分岐", () => {
  beforeEach(() => {
    mocks.label.current = "main";
  });

  it("stage-overlay ラベルで EffectOverlayApp を描く", () => {
    mocks.label.current = "stage-overlay";
    render(<App />);
    expect(screen.getByTestId("effect-overlay-app")).toBeInTheDocument();
  });

  it("⚠⚠ 064d: `effect-overlay`（コーナー窓）は廃止した＝ main へ落ちる", () => {
    // ⚠ あの窓は**取り込んだテンプレート専用**で、配信イベントはステージ窓にしか出さないと
    //   決めていたので、テンプレートを消すと**描くものが 1 つも無い窓**になった。
    mocks.label.current = "effect-overlay";
    render(<App />);
    // ⚠ 既知のラベルに当たらなければ `MainWindowApp` へ落ちる（＝ここでは「窓が描かれない」だけ見る。
    //   `MainWindowApp` は invoke 依存の hook を多数マウントするので、この形の否定検査に留める）。
    expect(screen.queryByTestId("effect-overlay-app")).toBeNull();
    expect(screen.queryByTestId("overlay-app")).toBeNull();
    expect(screen.queryByTestId("pinned-overlay-app")).toBeNull();
  });

  it("pinned-overlay ラベルは PinnedOverlayApp のまま（3 本目が既存の分岐を奪っていない）", () => {
    mocks.label.current = "pinned-overlay";
    render(<App />);
    expect(screen.getByTestId("pinned-overlay-app")).toBeInTheDocument();
    expect(screen.queryByTestId("effect-overlay-app")).toBeNull();
  });

  it("comment-overlay ラベルは OverlayApp のまま", () => {
    mocks.label.current = "comment-overlay";
    render(<App />);
    expect(screen.getByTestId("overlay-app")).toBeInTheDocument();
    expect(screen.queryByTestId("effect-overlay-app")).toBeNull();
  });

  it("comment-viewer ラベルは CommentViewerApp のまま", () => {
    mocks.label.current = "comment-viewer";
    render(<App />);
    expect(screen.getByTestId("comment-viewer-app")).toBeInTheDocument();
  });
});
