import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import type { AppUpdateStatus } from "./bindings/AppUpdateStatus";
import { useAppUpdate, UPDATE_CHECK_ERROR_MESSAGE } from "./useAppUpdate";

/**
 * 055c: `useAppUpdate`（起動時の自動チェック）の仕様テスト。
 *
 * 仕様（こうあるべき・docs/tasks/055c / 055b の申し送り / 055b security-review S-4）:
 * - **起動時に 1 回だけ**チェックする。⚠ `main.tsx` は `<React.StrictMode>` なので dev では
 *   effect が 2 回走る。**この二重発火は実機では観測できない**（Rust 側の HTTP は webview の
 *   DevTools の Network に出ず、結果も 1 回目と 2 回目で同じ）ため、**この不変条件はここでしか守れない**。
 * - 「更新なし」は resolve `available:false` としてそのまま持つ。
 * - 「確認できなかった」は reject → `phase:"error"` ＋ **`status` は `null` のまま**
 *   （**`available:false` に潰さない**＝オフラインが「最新です」に化けない）。
 * - **失敗しても自動リトライしない**（S-4）。再チェックはユーザーの明示操作（`recheck()`）のみ。
 * - **実行中は再実行しない**（S-4）。
 * - §9: `error` には**定型文言だけ**が入る（生エラー文字列・URL を持ち回らない）。
 *
 * `checkAppUpdate` はモックする＝テストは外部通信も OS 操作も一切行わない（§1）。
 */
vi.mock("./appUpdateApi", () => ({ checkAppUpdate: vi.fn() }));

import { checkAppUpdate } from "./appUpdateApi";

const mockCheck = vi.mocked(checkAppUpdate);

const noUpdate: AppUpdateStatus = { currentVersion: "0.1.0", available: false };
const hasUpdate: AppUpdateStatus = {
  currentVersion: "0.0.9",
  available: true,
  latestVersion: "0.1.0",
  notes: "- 修正",
};

/** フックの戻り値を DOM に映すだけの薄いハーネス。 */
function Harness() {
  const { status, phase, error, recheck } = useAppUpdate();
  return (
    <div>
      <span data-testid="phase">{phase}</span>
      <span data-testid="available">{String(status?.available ?? "none")}</span>
      <span data-testid="status-null">{String(status === null)}</span>
      <span data-testid="error">{error ?? ""}</span>
      <button onClick={() => void recheck()}>再確認</button>
    </div>
  );
}

/** マイクロタスク（await 済みの Promise の解決）を流し切る。 */
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  mockCheck.mockReset();
});

describe("useAppUpdate", () => {
  it("⚠ StrictMode 下でも起動時チェックは 1 回だけ発火する", async () => {
    mockCheck.mockResolvedValue(noUpdate);

    render(
      <React.StrictMode>
        <Harness />
      </React.StrictMode>,
    );
    await flush();

    // StrictMode は effect を mount → cleanup → mount と 2 回走らせる。
    // ref ガードが無いと、起動のたびに check_app_update が 2 回発火する。
    expect(mockCheck).toHaveBeenCalledTimes(1);
  });

  it("StrictMode 無しでも起動時チェックは 1 回だけ（負のコントロール）", async () => {
    mockCheck.mockResolvedValue(noUpdate);
    render(<Harness />);
    await flush();
    expect(mockCheck).toHaveBeenCalledTimes(1);
  });

  it("更新なしは resolve をそのまま持つ（phase: ready / available: false）", async () => {
    mockCheck.mockResolvedValue(noUpdate);
    render(<Harness />);
    await flush();

    expect(screen.getByTestId("phase")).toHaveTextContent("ready");
    expect(screen.getByTestId("available")).toHaveTextContent("false");
    expect(screen.getByTestId("error")).toHaveTextContent("");
  });

  it("更新ありも resolve をそのまま持つ（phase: ready / available: true）", async () => {
    mockCheck.mockResolvedValue(hasUpdate);
    render(<Harness />);
    await flush();

    expect(screen.getByTestId("phase")).toHaveTextContent("ready");
    expect(screen.getByTestId("available")).toHaveTextContent("true");
  });

  it("確認失敗は phase:error にし、status を null のまま保つ（available:false に潰さない）", async () => {
    mockCheck.mockRejectedValue({
      code: "UPDATE_CHECK_FAILED",
      message: "更新の確認に失敗しました。時間をおいて再度お試しください。",
    });
    render(<Harness />);
    await flush();

    expect(screen.getByTestId("phase")).toHaveTextContent("error");
    // ⚠ ここが false になると「オフラインが最新版です に化ける」重大な仕様違反。
    expect(screen.getByTestId("status-null")).toHaveTextContent("true");
    expect(screen.getByTestId("available")).toHaveTextContent("none");
  });

  it("§9: error には定型文言だけを入れる（生エラー文字列・URL を持ち回らない）", async () => {
    mockCheck.mockRejectedValue({
      code: "UPDATE_CHECK_FAILED",
      message:
        "error sending request for url (https://github.com/satoh23/StreamDock-releases/releases/latest/download/latest.json)",
      details: "/Users/someone/Library/Application Support/stream-dock",
    });
    render(<Harness />);
    await flush();

    const shown = screen.getByTestId("error").textContent ?? "";
    expect(shown).toBe(UPDATE_CHECK_ERROR_MESSAGE);
    expect(shown).not.toMatch(/https?:|:\/\/|github|latest\.json|\/Users\//);
  });

  it("§9: 失敗しても console に 1 行も出さない（DevTools コンソールへの漏洩を止める）", async () => {
    // 055c の実機確認項目 4 は「画面にも **DevTools コンソールにも** 生エラー文字列・URL・
    // ローカルパスが出ていないこと」。**コンソール側はここで機械的に固定できる**（画面側は既存の別テスト）。
    // ⚠ `console.*` を 1 つも書かない、というのは grep でしか守られていなかった。
    //    `catch` に `console.error(e)` を足す変異は、この 1 本が無いと誰も落とせない。
    const methods = ["log", "info", "warn", "error", "debug", "trace"] as const;
    const spies = methods.map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );

    mockCheck.mockRejectedValue({
      code: "UPDATE_CHECK_FAILED",
      message:
        "error sending request for url (https://github.com/satoh23/StreamDock-releases/releases/latest/download/latest.json)",
      details: "/Users/someone/Library/Application Support/stream-dock",
    });
    render(<Harness />);
    await flush();

    expect(screen.getByTestId("phase")).toHaveTextContent("error");
    for (const [i, spy] of spies.entries()) {
      expect(
        spy,
        `console.${methods[i]} が呼ばれています（§9: 更新経路はコンソールにも出さない）`,
      ).not.toHaveBeenCalled();
    }
    for (const spy of spies) spy.mockRestore();
  });

  it("失敗しても自動リトライしない（明示操作が無い限り 2 回目は飛ばない）", async () => {
    mockCheck.mockRejectedValue({ code: "UPDATE_CHECK_FAILED" });
    render(<Harness />);
    await flush();
    await flush();
    await flush();

    expect(mockCheck).toHaveBeenCalledTimes(1);
  });

  it("recheck() は明示操作のときだけ再実行する", async () => {
    mockCheck.mockRejectedValueOnce({ code: "UPDATE_CHECK_FAILED" });
    render(<Harness />);
    await flush();
    expect(screen.getByTestId("phase")).toHaveTextContent("error");

    mockCheck.mockResolvedValueOnce(hasUpdate);
    fireEvent.click(screen.getByRole("button", { name: "再確認" }));
    await flush();

    expect(mockCheck).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("phase")).toHaveTextContent("ready");
    expect(screen.getByTestId("available")).toHaveTextContent("true");
  });

  it("成功したあと recheck が失敗したら、前回の成功結果を捨てて error に倒す", async () => {
    // 055c review Q-1: この「往復」が 1 本も無く、`catch` の `setStatus(null)` を削除しても
    // 全テストが緑だった（＝仕様ではなく実装の副作用として存在していた）。
    // ⚠ 意図は「`status !== null` なら、その中身は**今回の通信で得たもの**」という不変条件を保つこと。
    //   残す設計にすると `phase` と `status` の組み合わせで表示が決まり、状態空間が広がる。
    //   副作用として「更新ありを見た後に再確認が失敗すると更新ありの表示が消える」——これは受容する。
    mockCheck.mockResolvedValueOnce(hasUpdate);
    render(<Harness />);
    await flush();
    expect(screen.getByTestId("available")).toHaveTextContent("true");

    mockCheck.mockRejectedValueOnce({ code: "UPDATE_CHECK_FAILED" });
    fireEvent.click(screen.getByRole("button", { name: "再確認" }));
    await flush();

    expect(screen.getByTestId("phase")).toHaveTextContent("error");
    expect(screen.getByTestId("status-null")).toHaveTextContent("true");
    expect(screen.getByTestId("error")).toHaveTextContent(UPDATE_CHECK_ERROR_MESSAGE);
  });

  it("失敗したあと recheck が成功したら、error を消して結果を持つ", async () => {
    // 逆向きの往復。成功時に `setError(null)` を落とすと、エラー文言が出たまま更新内容が並ぶ。
    mockCheck.mockRejectedValueOnce({ code: "UPDATE_CHECK_FAILED" });
    render(<Harness />);
    await flush();
    expect(screen.getByTestId("error")).toHaveTextContent(UPDATE_CHECK_ERROR_MESSAGE);

    mockCheck.mockResolvedValueOnce(noUpdate);
    fireEvent.click(screen.getByRole("button", { name: "再確認" }));
    await flush();

    expect(screen.getByTestId("phase")).toHaveTextContent("ready");
    expect(screen.getByTestId("available")).toHaveTextContent("false");
    expect(screen.getByTestId("error")).toHaveTextContent("");
  });

  it("実行中は再実行しない（連打しても通信が積み上がらない・S-4）", async () => {
    // 起動時チェックを解決させない＝ずっと実行中の状態を作る。
    mockCheck.mockReturnValue(new Promise<AppUpdateStatus>(() => {}));
    render(<Harness />);
    await flush();

    expect(screen.getByTestId("phase")).toHaveTextContent("checking");

    const button = screen.getByRole("button", { name: "再確認" });
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);
    await flush();

    expect(mockCheck).toHaveBeenCalledTimes(1);
  });

  it("checkAppUpdate は引数なしで呼ぶ（宛先もバージョンも frontend から渡さない）", async () => {
    mockCheck.mockResolvedValue(noUpdate);
    render(<Harness />);
    await flush();

    expect(mockCheck).toHaveBeenCalledWith();
  });
});
