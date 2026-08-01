import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import type { AppUpdateStatus } from "./bindings/AppUpdateStatus";
import {
  useAppUpdate,
  INSTALL_DEADLINE_MS,
  INSTALL_WATCHDOG_MS,
  UPDATE_CHECK_ERROR_MESSAGE,
  UPDATE_INSTALL_ERROR_MESSAGE,
  UPDATE_INSTALL_STALLED_MESSAGE,
} from "./useAppUpdate";

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
vi.mock("./appUpdateApi", () => ({
  checkAppUpdate: vi.fn(),
  installAppUpdate: vi.fn(),
  restartApp: vi.fn(),
  listenAppUpdateProgress: vi.fn(),
}));

import {
  checkAppUpdate,
  installAppUpdate,
  listenAppUpdateProgress,
  restartApp,
} from "./appUpdateApi";
import type { AppUpdateInstallOutcome } from "./bindings/AppUpdateInstallOutcome";
import type { AppUpdateProgress } from "./bindings/AppUpdateProgress";

const mockCheck = vi.mocked(checkAppUpdate);
const mockInstall = vi.mocked(installAppUpdate);
const mockRestart = vi.mocked(restartApp);
const mockListen = vi.mocked(listenAppUpdateProgress);

const noUpdate: AppUpdateStatus = { currentVersion: "0.1.0", available: false };
const hasUpdate: AppUpdateStatus = {
  currentVersion: "0.0.9",
  available: true,
  latestVersion: "0.1.0",
  notes: "- 修正",
};

/**
 * 購読された進捗ハンドラ。テストから任意のタイミングでイベントを送り込むために掴んでおく。
 * ⚠ 実物と同じく「購読は Promise 経由で確立する」ので、送る前に必ず `flush()` すること。
 */
let progressHandler: ((progress: AppUpdateProgress) => void) | null = null;
/** 解除が呼ばれたかを見るためのスパイ。 */
let unlistenSpy = vi.fn();

function emitProgress(progress: AppUpdateProgress) {
  act(() => {
    progressHandler?.(progress);
  });
}

/** フックの戻り値を DOM に映すだけの薄いハーネス。 */
function Harness() {
  const { status, phase, error, progress, recheck, install, restart } = useAppUpdate();
  return (
    <div>
      <span data-testid="phase">{phase}</span>
      <span data-testid="available">{String(status?.available ?? "none")}</span>
      <span data-testid="status-null">{String(status === null)}</span>
      <span data-testid="error">{error ?? ""}</span>
      <span data-testid="progress">
        {progress ? `${progress.downloadedBytes}/${String(progress.totalBytes)}` : "none"}
      </span>
      {/* ⚠ progress を**そのまま**映す。フックがイベントのペイロードを丸ごと state に入れる実装に
          変わったら（＝偽造イベントの余計なフィールドが state に入る）ここで見える（§9）。 */}
      <span data-testid="progress-raw">{JSON.stringify(progress)}</span>
      <button onClick={() => void recheck()}>再確認</button>
      <button onClick={() => void install()}>アップデート</button>
      <button onClick={() => void restart()}>再起動</button>
    </div>
  );
}

/**
 * **画面遷移**を模したハーネス（055d の手動 E2E「インストール中に他画面へ行って戻っても壊れない」の代替）。
 *
 * 実物と同じ構造にするのが要点——**フックは親（`App`）が持ち**、`UpdateScreen` に相当する子だけが
 * 出入りする。`useAppUpdate` の購読 doc が「`UpdateScreen` 側に購読を置いてはいけない」と決めているのは、
 * 置くと画面を離れた瞬間に進捗を取りこぼすため。
 */
function NavHarness() {
  const { phase, progress, install } = useAppUpdate();
  const [onUpdateScreen, setOnUpdateScreen] = React.useState(true);
  return (
    <div>
      <button onClick={() => setOnUpdateScreen((visible) => !visible)}>画面切替</button>
      {onUpdateScreen && (
        <div>
          <span data-testid="phase">{phase}</span>
          <span data-testid="progress">
            {progress ? `${progress.downloadedBytes}/${String(progress.totalBytes)}` : "none"}
          </span>
          <button onClick={() => void install()}>アップデート</button>
        </div>
      )}
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
  mockInstall.mockReset();
  mockRestart.mockReset();
  mockListen.mockReset();

  progressHandler = null;
  unlistenSpy = vi.fn();
  mockListen.mockImplementation((handler) => {
    progressHandler = handler;
    return Promise.resolve(unlistenSpy);
  });
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

/**
 * 055d: DL → インストール → 再起動。
 *
 * 仕様（docs/tasks/055d / security.md §9）:
 * - `install()` は引数なしで `installAppUpdate` を呼ぶ。
 * - 進捗イベントで `phase` と `progress` が動く。**イベントの購読はフックの生存期間と一致**する
 *   （画面遷移では解除されない）。アンマウント時には**必ず解除**する。
 * - 実行中は `recheck` と `install` が**相互排他**（`inFlightRef` を共有）。
 * - 失敗は定型文言だけを `error` に載せる。**console に 1 行も出さない**。
 * - **実行していないときの進捗イベントは無視する**（webview 側から偽造できるため）。
 * - watchdog: `installing` のまま進展が無いと `error` に落ちる。**遅れて settle した Promise が
 *   その state を巻き戻さない**。
 */
describe("useAppUpdate —— 055d インストール", () => {
  /** 「更新あり」を確認済みの状態まで進める。 */
  async function readyWithUpdate() {
    mockCheck.mockResolvedValue(hasUpdate);
    const utils = render(<Harness />);
    await flush();
    expect(screen.getByTestId("phase")).toHaveTextContent("ready");
    return utils;
  }

  const clickInstall = () =>
    fireEvent.click(screen.getByRole("button", { name: "アップデート" }));

  it("install() は installAppUpdate を引数なしで呼ぶ", async () => {
    await readyWithUpdate();
    mockInstall.mockResolvedValueOnce("installed");

    clickInstall();
    await flush();

    expect(mockInstall).toHaveBeenCalledTimes(1);
    expect(mockInstall).toHaveBeenCalledWith();
  });

  it("押した直後に downloading へ移る（Rust の 1 発目のイベントを待たない）", async () => {
    await readyWithUpdate();
    mockInstall.mockReturnValueOnce(new Promise<AppUpdateInstallOutcome>(() => {}));

    clickInstall();
    // ⚠ ここで await しない＝クリックの同期処理だけで phase が動くことを見る。
    expect(screen.getByTestId("phase")).toHaveTextContent("downloading");
  });

  it("進捗イベントで phase と progress が動く（downloading → installing）", async () => {
    await readyWithUpdate();
    mockInstall.mockReturnValueOnce(new Promise<AppUpdateInstallOutcome>(() => {}));

    clickInstall();
    await flush();

    emitProgress({ phase: "downloading", downloadedBytes: 1024, totalBytes: 4096 });
    expect(screen.getByTestId("phase")).toHaveTextContent("downloading");
    expect(screen.getByTestId("progress")).toHaveTextContent("1024/4096");

    emitProgress({ phase: "installing", downloadedBytes: 4096, totalBytes: 4096 });
    expect(screen.getByTestId("phase")).toHaveTextContent("installing");
    expect(screen.getByTestId("progress")).toHaveTextContent("4096/4096");
  });

  it("総バイト数不明（null）の進捗もそのまま持つ", async () => {
    await readyWithUpdate();
    mockInstall.mockReturnValueOnce(new Promise<AppUpdateInstallOutcome>(() => {}));
    clickInstall();
    await flush();

    emitProgress({ phase: "downloading", downloadedBytes: 512, totalBytes: null });
    expect(screen.getByTestId("progress")).toHaveTextContent("512/null");
  });

  it("完了すると installed になり、progress を捨てる", async () => {
    await readyWithUpdate();
    mockInstall.mockResolvedValueOnce("installed");

    clickInstall();
    await flush();
    emitProgress({ phase: "downloading", downloadedBytes: 1, totalBytes: 2 });
    await flush();

    expect(screen.getByTestId("phase")).toHaveTextContent("installed");
    expect(screen.getByTestId("progress")).toHaveTextContent("none");
    expect(screen.getByTestId("error")).toHaveTextContent("");
  });

  it("失敗は定型文言だけを error に載せる（生エラー・URL・パスを持ち回らない・§9）", async () => {
    await readyWithUpdate();
    mockInstall.mockRejectedValueOnce({
      code: "UPDATE_INSTALL_FAILED",
      message:
        "error sending request for url (https://objects.githubusercontent.com/StreamDock.app.tar.gz)",
      details: "/Users/someone/Applications/StreamDock.app",
    });

    clickInstall();
    await flush();

    expect(screen.getByTestId("phase")).toHaveTextContent("error");
    const shown = screen.getByTestId("error").textContent ?? "";
    expect(shown).toBe(UPDATE_INSTALL_ERROR_MESSAGE);
    expect(shown).not.toMatch(/https?:|:\/\/|github|\.tar\.gz|\/Users\/|\/Applications/);
    // ⚠ progress は捨てる（失敗したのにバーが途中で止まったまま残らない）。
    expect(screen.getByTestId("progress")).toHaveTextContent("none");
  });

  it("§9: インストール失敗でも console に 1 行も出さない", async () => {
    // 既存の check 失敗経路と同じ担保を install 経路にも張る（新しい catch が増えたため）。
    const methods = ["log", "info", "warn", "error", "debug", "trace"] as const;
    const spies = methods.map((m) => vi.spyOn(console, m).mockImplementation(() => {}));

    await readyWithUpdate();
    mockInstall.mockRejectedValueOnce({
      code: "UPDATE_INSTALL_FAILED",
      message: "error sending request for url (https://example.invalid/x.tar.gz)",
    });
    clickInstall();
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

  it("実行中は連打しても 2 回目以降が飛ばない", async () => {
    await readyWithUpdate();
    mockInstall.mockReturnValueOnce(new Promise<AppUpdateInstallOutcome>(() => {}));

    clickInstall();
    clickInstall();
    clickInstall();
    await flush();

    expect(mockInstall).toHaveBeenCalledTimes(1);
  });

  it("インストール中は recheck も走らない（inFlightRef を共有＝相互排他）", async () => {
    await readyWithUpdate();
    expect(mockCheck).toHaveBeenCalledTimes(1);
    mockInstall.mockReturnValueOnce(new Promise<AppUpdateInstallOutcome>(() => {}));

    clickInstall();
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "再確認" }));
    await flush();

    // 起動時の 1 回だけ。インストール中の再確認は弾かれる。
    expect(mockCheck).toHaveBeenCalledTimes(1);
  });

  it("チェック中は install が走らない（逆向きの相互排他）", async () => {
    mockCheck.mockReturnValue(new Promise<AppUpdateStatus>(() => {}));
    render(<Harness />);
    await flush();
    expect(screen.getByTestId("phase")).toHaveTextContent("checking");

    clickInstall();
    await flush();

    expect(mockInstall).not.toHaveBeenCalled();
  });

  it("⚠ 実行していないときの進捗イベントは無視する（webview 側から偽造できるため）", async () => {
    await readyWithUpdate();

    emitProgress({ phase: "downloading", downloadedBytes: 999, totalBytes: 999 });

    // 勝手に「ダウンロード中」に化けない。
    expect(screen.getByTestId("phase")).toHaveTextContent("ready");
    expect(screen.getByTestId("progress")).toHaveTextContent("none");
  });

  it("⚠ 完了後に届いた進捗イベントも無視する（installed を巻き戻さない）", async () => {
    await readyWithUpdate();
    mockInstall.mockResolvedValueOnce("installed");
    clickInstall();
    await flush();
    expect(screen.getByTestId("phase")).toHaveTextContent("installed");

    emitProgress({ phase: "downloading", downloadedBytes: 1, totalBytes: 100 });
    expect(screen.getByTestId("phase")).toHaveTextContent("installed");
    expect(screen.getByTestId("progress")).toHaveTextContent("none");
  });

  it("⚠ alreadyRunning を「完了」に潰さない（走行中の自己置換の最中に再起動を促さない・review S-2）", async () => {
    // Rust 側の `InstallGuard` に弾かれた 2 本目は `"alreadyRunning"` で resolve する。
    // これを installed に畳むと「更新の準備ができました」＋再起動ボタンが出て、
    // macOS では走行中の `.app` 置換に再起動が刺さりうる（最悪アプリが消える）。
    await readyWithUpdate();
    mockInstall.mockResolvedValueOnce("alreadyRunning");

    clickInstall();
    await flush();

    expect(screen.getByTestId("phase")).toHaveTextContent("error");
    expect(screen.getByTestId("error")).toHaveTextContent(UPDATE_INSTALL_STALLED_MESSAGE);
    expect(screen.getByTestId("progress")).toHaveTextContent("none");
  });

  it("noUpdate は現状どおり完了表示に畳む（受容済み・区別する材料はある）", async () => {
    // progress.md 055d 節⑧の受容。押しても再起動するだけで害が無いため。
    // ⚠ このテストは「畳んでいる」という現状の**記録**であって、正しさの主張ではない。
    await readyWithUpdate();
    mockInstall.mockResolvedValueOnce("noUpdate");

    clickInstall();
    await flush();

    expect(screen.getByTestId("phase")).toHaveTextContent("installed");
  });

  it("restart() は restartApp を引数なしで呼ぶ", async () => {
    await readyWithUpdate();
    mockRestart.mockReturnValueOnce(new Promise<void>(() => {}));

    fireEvent.click(screen.getByRole("button", { name: "再起動" }));
    await flush();

    expect(mockRestart).toHaveBeenCalledTimes(1);
    expect(mockRestart).toHaveBeenCalledWith();
  });

  it("restart() が失敗しても例外を外に出さない（画面に出す先が無いので握る）", async () => {
    await readyWithUpdate();
    mockRestart.mockRejectedValueOnce(new Error("boom"));

    fireEvent.click(screen.getByRole("button", { name: "再起動" }));
    await flush();

    // 直前の状態を壊さない。
    expect(screen.getByTestId("phase")).toHaveTextContent("ready");
    expect(screen.getByTestId("error")).toHaveTextContent("");
  });
});

describe("useAppUpdate —— 055d 進捗イベントの購読ライフサイクル", () => {
  it("マウント時に 1 回だけ購読する", async () => {
    mockCheck.mockResolvedValue(noUpdate);
    render(<Harness />);
    await flush();
    expect(mockListen).toHaveBeenCalledTimes(1);
  });

  it("⚠ アンマウント時に必ず解除する（リスナを漏らさない）", async () => {
    mockCheck.mockResolvedValue(noUpdate);
    const { unmount } = render(<Harness />);
    await flush();
    expect(unlistenSpy).not.toHaveBeenCalled();

    unmount();
    expect(unlistenSpy).toHaveBeenCalledTimes(1);
  });

  it("⚠ StrictMode の二重 mount でもリスナが漏れない（cancelled ガード）", async () => {
    // `listen` は Promise を返すので、cleanup が先に走ると `unlisten` を掴む前に解除機会を失う。
    // `cancelled` ガードが無いと 1 本目のリスナが**永久に残る**（購読 2 / 解除 1 になる）。
    mockCheck.mockResolvedValue(noUpdate);
    const { unmount } = render(
      <React.StrictMode>
        <Harness />
      </React.StrictMode>,
    );
    await flush();

    const subscriptions = mockListen.mock.calls.length;
    unmount();
    await flush();

    expect(unlistenSpy).toHaveBeenCalledTimes(subscriptions);
  });

  it("⚠ インストール中に他画面へ行って戻っても進捗を追い続ける（購読はフックの生存期間＝アプリの生存期間）", async () => {
    // 055d の手動 E2E 項目「インストール中に他画面へ行って戻っても壊れない」の**機械化**。
    // 仕様（useAppUpdate の購読 doc）: 購読はフック（＝`MainWindowApp`）が持ち、
    // `UpdateScreen` の unmount では**解除されない**。`UpdateScreen` 側に購読を置くと、
    // 画面を離れているあいだの進捗を取りこぼして戻ったときにバーが巻き戻る。
    mockCheck.mockResolvedValue(hasUpdate);
    mockInstall.mockReturnValueOnce(new Promise<AppUpdateInstallOutcome>(() => {}));
    render(<NavHarness />);
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "アップデート" }));
    await flush();
    emitProgress({ phase: "downloading", downloadedBytes: 1024, totalBytes: 4096 });
    expect(screen.getByTestId("progress")).toHaveTextContent("1024/4096");

    // 他画面へ遷移（＝UpdateScreen 相当の子だけが unmount）。
    fireEvent.click(screen.getByRole("button", { name: "画面切替" }));
    expect(screen.queryByTestId("progress")).toBeNull();
    // ⚠ ここで解除されたら仕様違反（購読が画面に紐づいてしまっている）。
    expect(unlistenSpy).not.toHaveBeenCalled();

    // 離れているあいだに届いた進捗も落とさない。
    emitProgress({ phase: "downloading", downloadedBytes: 3072, totalBytes: 4096 });

    // 戻ってくると**最新の**進捗が出ている（巻き戻らない・再購読も起きない）。
    fireEvent.click(screen.getByRole("button", { name: "画面切替" }));
    expect(screen.getByTestId("phase")).toHaveTextContent("downloading");
    expect(screen.getByTestId("progress")).toHaveTextContent("3072/4096");
    expect(mockListen).toHaveBeenCalledTimes(1);
  });

  it("⚠ §9: 偽造イベントに URL やパスが混ざっていても state に取り込まない（読むのは 3 フィールドだけ）", async () => {
    // `core:event:allow-emit` は既定で配られている＝どの窓からでもペイロードを自由に作れる。
    // フックがペイロードを**丸ごと** state に入れる実装だと、余計なフィールドがそのまま
    // 画面（と将来のログ）へ運ばれる。読むのは `downloadedBytes` / `totalBytes` / `phase` だけ。
    mockCheck.mockResolvedValue(hasUpdate);
    mockInstall.mockReturnValueOnce(new Promise<AppUpdateInstallOutcome>(() => {}));
    render(<Harness />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "アップデート" }));
    await flush();

    emitProgress({
      phase: "downloading",
      downloadedBytes: 1,
      totalBytes: 2,
      // ⚠ Rust 側は送らないが、webview からは何でも送れる。
      downloadUrl: "https://objects.githubusercontent.com/StreamDock.app.tar.gz",
      extractPath: "/Applications/StreamDock.app",
      tempDir: "/var/folders/xx/tauri_updated_app",
    } as unknown as AppUpdateProgress);

    const raw = screen.getByTestId("progress-raw").textContent ?? "";
    expect(raw).toBe('{"downloadedBytes":1,"totalBytes":2}');
    expect(raw).not.toMatch(/https?:|:\/\/|github|\/Users\/|\/Applications|\/var\/folders/);
  });

  it("購読に失敗しても壊れない（進捗が出ないだけで更新自体は走る）", async () => {
    mockListen.mockReset();
    mockListen.mockRejectedValueOnce(new Error("listen failed"));
    mockCheck.mockResolvedValue(hasUpdate);
    render(<Harness />);
    await flush();

    expect(screen.getByTestId("phase")).toHaveTextContent("ready");

    mockInstall.mockResolvedValueOnce("installed");
    fireEvent.click(screen.getByRole("button", { name: "アップデート" }));
    await flush();
    expect(screen.getByTestId("phase")).toHaveTextContent("installed");
  });
});

describe("useAppUpdate —— 055d watchdog", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** fake timers 下ではマイクロタスクだけを流す（`flush` は実タイマに触れないので同じ形でよい）。 */
  async function tick() {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  async function startInstall() {
    mockCheck.mockResolvedValue(hasUpdate);
    render(<Harness />);
    await tick();
    mockInstall.mockReturnValueOnce(new Promise<AppUpdateInstallOutcome>(() => {}));
    fireEvent.click(screen.getByRole("button", { name: "アップデート" }));
    await tick();
  }

  it("進展が無いまま INSTALL_WATCHDOG_MS 経つと error に落ちる（UI が固まらない）", async () => {
    await startInstall();
    emitProgress({ phase: "installing", downloadedBytes: 10, totalBytes: 10 });
    expect(screen.getByTestId("phase")).toHaveTextContent("installing");

    act(() => {
      vi.advanceTimersByTime(INSTALL_WATCHDOG_MS);
    });

    expect(screen.getByTestId("phase")).toHaveTextContent("error");
    expect(screen.getByTestId("error")).toHaveTextContent(UPDATE_INSTALL_STALLED_MESSAGE);
    expect(screen.getByTestId("progress")).toHaveTextContent("none");
  });

  it("進捗が来ているあいだは発火しない（タイマを張り直す）", async () => {
    await startInstall();
    emitProgress({ phase: "downloading", downloadedBytes: 1, totalBytes: 100 });

    // 上限の 9 割ずつ進めながら進捗を送り続ける＝合計は上限を大きく超えるが発火しない。
    for (let i = 0; i < 3; i += 1) {
      act(() => {
        vi.advanceTimersByTime(INSTALL_WATCHDOG_MS * 0.9);
      });
      emitProgress({ phase: "downloading", downloadedBytes: i + 2, totalBytes: 100 });
    }

    expect(screen.getByTestId("phase")).toHaveTextContent("downloading");
  });

  it("⚠ watchdog 発火後に「もう一度」押せる（実行中フラグを返す）", async () => {
    // ⚠ 見捨てた実行の Promise は**永久に settle しない**ので、`finally` に頼ると
    //    `inFlightRef` が立ちっぱなしになり、UI だけ戻って**再確認もアップデートも二度と押せない**。
    //    実装中にこのテストで実際に踏んだ穴なので、機械で固定しておく。
    await startInstall();
    act(() => {
      vi.advanceTimersByTime(INSTALL_WATCHDOG_MS);
    });
    expect(screen.getByTestId("phase")).toHaveTextContent("error");

    // 再確認が通る。
    mockCheck.mockResolvedValueOnce(hasUpdate);
    fireEvent.click(screen.getByRole("button", { name: "再確認" }));
    await tick();
    expect(mockCheck).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("phase")).toHaveTextContent("ready");

    // アップデートも通る。
    mockInstall.mockResolvedValueOnce("installed");
    fireEvent.click(screen.getByRole("button", { name: "アップデート" }));
    await tick();
    expect(mockInstall).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("phase")).toHaveTextContent("installed");
  });

  it("⚠ watchdog 発火後に遅れて届いた進捗イベントは state を巻き戻さない", async () => {
    await startInstall();
    emitProgress({ phase: "installing", downloadedBytes: 10, totalBytes: 10 });
    act(() => {
      vi.advanceTimersByTime(INSTALL_WATCHDOG_MS);
    });
    expect(screen.getByTestId("phase")).toHaveTextContent("error");

    emitProgress({ phase: "downloading", downloadedBytes: 50, totalBytes: 100 });
    expect(screen.getByTestId("phase")).toHaveTextContent("error");
    expect(screen.getByTestId("progress")).toHaveTextContent("none");
  });

  it("⚠ 押し直したあとに古い watchdog が発火しても、新しい実行を壊さない（世代ガード）", async () => {
    await startInstall();
    // 1 本目を上限直前まで進めてから、完了させずに error へ落とす。
    act(() => {
      vi.advanceTimersByTime(INSTALL_WATCHDOG_MS);
    });
    expect(screen.getByTestId("phase")).toHaveTextContent("error");

    // 2 本目を開始（世代が上がる）。
    mockInstall.mockReturnValueOnce(new Promise<AppUpdateInstallOutcome>(() => {}));
    fireEvent.click(screen.getByRole("button", { name: "アップデート" }));
    await tick();
    emitProgress({ phase: "downloading", downloadedBytes: 5, totalBytes: 10 });
    expect(screen.getByTestId("phase")).toHaveTextContent("downloading");

    // 1 本目のタイマはもう存在しない（clearWatchdog + 世代ガードの二重）。
    act(() => {
      vi.advanceTimersByTime(INSTALL_WATCHDOG_MS * 0.5);
    });
    expect(screen.getByTestId("phase")).toHaveTextContent("downloading");
  });

  it("⚠ watchdog の値は正常な自己置換を殺さない範囲にある（review Q-5）", () => {
    // ⚠ ここまでのテストはすべて定数を**シンボルで**参照しているので、値を 1 秒に書き換えても
    //    全部緑のまま「あらゆる正常な更新が 1 秒で失敗する」実装になる（ミューテーションで実測）。
    //    Rust 側の `download_timeouts_stay_within_sane_bounds` と同じく、値そのものを上下から挟む。
    expect(INSTALL_WATCHDOG_MS).toBeGreaterThanOrEqual(30_000);
    expect(INSTALL_WATCHDOG_MS).toBeLessThanOrEqual(300_000);
    // 絶対上限は滑走窓より必ず長いこと（短いと watchdog が意味を持たない）。
    expect(INSTALL_DEADLINE_MS).toBeGreaterThan(INSTALL_WATCHDOG_MS);
    expect(INSTALL_DEADLINE_MS).toBeLessThanOrEqual(3_600_000);
  });

  it("⚠ 進捗が来続けても絶対上限では必ず戻る（偽イベントで watchdog を無力化できない・review S-5）", async () => {
    // `core:event:allow-emit` は既定で配られている＝どの窓からでも進捗を偽造できる。
    // 実行中は信頼して watchdog を張り直すので、送り続けられると滑走窓は永久に発火しない。
    await startInstall();

    // 上限の 9 割ごとに進捗を送り続ける（＝滑走窓は一度も発火しない）。
    const step = INSTALL_WATCHDOG_MS * 0.9;
    for (let elapsed = 0; elapsed < INSTALL_DEADLINE_MS; elapsed += step) {
      act(() => {
        vi.advanceTimersByTime(step);
      });
      emitProgress({ phase: "downloading", downloadedBytes: elapsed, totalBytes: null });
    }

    expect(screen.getByTestId("phase")).toHaveTextContent("error");
    expect(screen.getByTestId("error")).toHaveTextContent(UPDATE_INSTALL_STALLED_MESSAGE);
  });

  it("⚠ watchdog 発火後に遅れて resolve した実行が state を巻き戻さない（世代ガード・review Q-6）", async () => {
    // ⚠ `runRef` の bump を消しても全テストが緑だった穴（ミューテーションで実測）。
    //    見捨てた実行が後から resolve すると `error` が `installed` に化け、
    //    「アプリを終了してください」という指示が消える。
    mockCheck.mockResolvedValue(hasUpdate);
    render(<Harness />);
    await tick();

    let settle: (() => void) | null = null;
    mockInstall.mockReturnValueOnce(
      new Promise<"installed">((resolve) => {
        settle = () => resolve("installed");
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "アップデート" }));
    await tick();

    act(() => {
      vi.advanceTimersByTime(INSTALL_WATCHDOG_MS);
    });
    expect(screen.getByTestId("phase")).toHaveTextContent("error");

    // 見捨てた Rust 側の処理が後から終わる。
    act(() => settle?.());
    await tick();

    expect(screen.getByTestId("phase")).toHaveTextContent("error");
    expect(screen.getByTestId("error")).toHaveTextContent(UPDATE_INSTALL_STALLED_MESSAGE);
  });

  it("⚠ watchdog 発火後に遅れて reject した実行も文言を書き換えない", async () => {
    mockCheck.mockResolvedValue(hasUpdate);
    render(<Harness />);
    await tick();

    let fail: (() => void) | null = null;
    mockInstall.mockReturnValueOnce(
      new Promise<"installed">((_resolve, reject) => {
        fail = () => reject(new Error("late"));
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "アップデート" }));
    await tick();

    act(() => {
      vi.advanceTimersByTime(INSTALL_WATCHDOG_MS);
    });
    act(() => fail?.());
    await tick();

    expect(screen.getByTestId("error")).toHaveTextContent(UPDATE_INSTALL_STALLED_MESSAGE);
  });

  it("アンマウントすると watchdog も止まる（消えた木の state を触らない）", async () => {
    mockCheck.mockResolvedValue(hasUpdate);
    const { unmount } = render(<Harness />);
    await tick();
    mockInstall.mockReturnValueOnce(new Promise<AppUpdateInstallOutcome>(() => {}));
    fireEvent.click(screen.getByRole("button", { name: "アップデート" }));
    await tick();
    emitProgress({ phase: "installing", downloadedBytes: 1, totalBytes: 1 });

    // ⚠ アンマウント**前**は 2 本（滑走窓 ＋ 絶対上限）走っている。
    expect(vi.getTimerCount()).toBe(2);

    unmount();
    // ⚠ **本数で見る**（`not.toThrow()` だけだと、絶対上限のタイマが残っていても緑になる）。
    expect(vi.getTimerCount()).toBe(0);
    // 念のため、絶対上限をまたいで進めても何も起きないこと。
    expect(() => {
      act(() => {
        vi.advanceTimersByTime(INSTALL_DEADLINE_MS * 2);
      });
    }).not.toThrow();
  });
});
