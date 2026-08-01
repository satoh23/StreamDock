import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AppUpdateStatus } from "./bindings/AppUpdateStatus";

/**
 * 055b: `checkAppUpdate` の仕様テスト。
 * あるべき挙動（docs/tasks/055b / security.md §3・§8・§9）:
 * - 引数を取らず `check_app_update` command を**パラメータなし**で呼ぶ（宛先もバージョンも frontend から渡さない）。
 * - Rust の戻り値をそのまま通す（「更新なし」は `available: false` で **resolve**）。
 * - 「確認できなかった」は **reject をそのまま伝播**する（`available: false` に潰さない。
 *   055c が「更新なし」と「確認できなかった」を別表示にできるのはこの区別が届くから）。
 * invoke（Tauri command）はモックする＝テストは端末外通信も OS 操作も一切しない（§1）。
 */
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  APP_UPDATE_PROGRESS_EVENT,
  checkAppUpdate,
  installAppUpdate,
  listenAppUpdateProgress,
  restartApp,
} from "./appUpdateApi";
import type { AppUpdateProgress } from "./bindings/AppUpdateProgress";

const mockInvoke = vi.mocked(invoke);
const mockListen = vi.mocked(listen);

/**
 * **Rust が実際に送ってくる JSON の形**。
 *
 * ts-rs が出す `AppUpdateStatus` は `latestVersion?: string`（＝`string | undefined`）だが、
 * serde 側に `skip_serializing_if` が無いため **省略可フィールドは `null` で届く**
 * （リポジトリ全体で `skip_serializing_if` は 0 箇所＝既存作法）。
 * この差は 055c の分岐（`!== undefined` は `null` に対して true）に効くので、型として明示しておく。
 */
type WireAppUpdateStatus = {
  currentVersion: string;
  available: boolean;
  latestVersion: string | null;
  notes: string | null;
  pubDate: string | null;
};

const noUpdate: AppUpdateStatus = {
  currentVersion: "0.1.0",
  available: false,
};

const hasUpdate: AppUpdateStatus = {
  currentVersion: "0.0.9",
  available: true,
  latestVersion: "0.1.0",
  notes: "## 0.1.0\n\n- 初回リリース",
  pubDate: "2026-08-01T00:00:00.000Z",
};

beforeEach(() => {
  mockInvoke.mockReset();
  mockListen.mockReset();
});

describe("checkAppUpdate", () => {
  it("check_app_update command を引数なしで呼ぶ（宛先・バージョンを frontend から渡さない）", async () => {
    mockInvoke.mockResolvedValueOnce(noUpdate);
    await checkAppUpdate();
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledWith("check_app_update");
  });

  it("更新なし（available:false）をそのまま resolve で返す", async () => {
    mockInvoke.mockResolvedValueOnce(noUpdate);
    await expect(checkAppUpdate()).resolves.toEqual(noUpdate);
  });

  it("更新あり（latestVersion / notes / pubDate 付き）をそのまま返す", async () => {
    mockInvoke.mockResolvedValueOnce(hasUpdate);
    await expect(checkAppUpdate()).resolves.toEqual(hasUpdate);
  });

  it("確認失敗は reject をそのまま伝播する（available:false に潰さない）", async () => {
    const appError = {
      code: "UPDATE_CHECK_FAILED",
      message: "更新の確認に失敗しました。時間をおいて再度お試しください。",
      occurredAt: "2026-08-01T00:00:00Z",
    };
    mockInvoke.mockRejectedValueOnce(appError);
    await expect(checkAppUpdate()).rejects.toEqual(appError);
  });

  it("省略可フィールドが null で届いても、正規化せずそのまま渡す", async () => {
    // ⚠ 上の `noUpdate` はキーごと省略しているが、**Rust が実際に送るのは null**
    //（`skip_serializing_if` を付けない＝リポジトリ全体の既存作法。Rust 側の
    // `absent_fields_are_sent_as_null_not_omitted` テストで固定している）。
    // このラッパは薄い通し（仕様）なので null → undefined の正規化はしない。
    // ＝**055c は `!== undefined` ではなく truthy 判定で読むこと**（`null` は `!== undefined` が true）。
    const wire: WireAppUpdateStatus = {
      currentVersion: "0.1.0",
      available: false,
      latestVersion: null,
      notes: null,
      pubDate: null,
    };
    mockInvoke.mockResolvedValueOnce(wire);

    const received = (await checkAppUpdate()) as unknown as WireAppUpdateStatus;
    expect(received).toEqual(wire);
    expect(received.latestVersion).toBeNull();
    // 「キーが無い」ではなく「null が入っている」ことを明示（055c の分岐が依存する差）。
    expect("latestVersion" in received).toBe(true);
    expect(received.latestVersion).not.toBeUndefined();
  });

  it("呼ぶたびに invoke する（結果をキャッシュしない）", async () => {
    // 055c は「再確認」で最新状態を取り直す。ラッパが結果を握ると再確認が効かなくなる。
    mockInvoke.mockResolvedValueOnce(noUpdate).mockResolvedValueOnce(hasUpdate);
    await expect(checkAppUpdate()).resolves.toEqual(noUpdate);
    await expect(checkAppUpdate()).resolves.toEqual(hasUpdate);
    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });

  it("reject のあとでも次の呼び出しは通常どおり実行される（失敗を記憶しない）", async () => {
    mockInvoke.mockRejectedValueOnce({ code: "UPDATE_CHECK_FAILED" });
    await expect(checkAppUpdate()).rejects.toBeTruthy();
    mockInvoke.mockResolvedValueOnce(noUpdate);
    await expect(checkAppUpdate()).resolves.toEqual(noUpdate);
    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });
});

/**
 * 055d: DL / インストール / 再起動 / 進捗購読。
 *
 * あるべき挙動（docs/tasks/055d / security.md §3・§8・§9）:
 * - `install_app_update` / `restart_app` を**パラメータなし**で呼ぶ
 *   （URL・バージョン・ファイル名・保存先を frontend から渡す経路を作らない）。
 * - 失敗は reject をそのまま伝播する（握り潰さない。文言化はフックの責務）。
 * - 進捗イベント名は Rust 側の定数と**一字一句一致**していること
 *   （ズレると進捗が一切出ないまま気付けない。ts-rs は const を書き出さないので機械同期できない）。
 */
describe("installAppUpdate / restartApp", () => {
  it("install_app_update を引数なしで呼ぶ（宛先・バージョンを frontend から渡さない）", async () => {
    mockInvoke.mockResolvedValueOnce("installed");
    await expect(installAppUpdate()).resolves.toBe("installed");
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledWith("install_app_update");
  });

  it("⚠ 「何もしなかった」を成功に潰さず、Rust の結果をそのまま返す（review S-2）", async () => {
    // resolve ＝ 完了ではない。呼び出し側が 3 つを区別できることがこの層の責務。
    for (const outcome of ["installed", "noUpdate", "alreadyRunning"] as const) {
      mockInvoke.mockResolvedValueOnce(outcome);
      await expect(installAppUpdate()).resolves.toBe(outcome);
    }
  });

  it("restart_app を引数なしで呼ぶ", async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    await restartApp();
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledWith("restart_app");
  });

  it("インストール失敗は reject をそのまま伝播する（握り潰さない）", async () => {
    const appError = {
      code: "UPDATE_INSTALL_FAILED",
      message: "更新のインストールに失敗しました。時間をおいて再度お試しください。",
      occurredAt: "2026-08-02T00:00:00Z",
    };
    mockInvoke.mockRejectedValueOnce(appError);
    await expect(installAppUpdate()).rejects.toEqual(appError);
  });
});

describe("listenAppUpdateProgress", () => {
  it("イベント名が Rust 側の APP_UPDATE_PROGRESS_EVENT と一致する", () => {
    // ⚠ ここが 2 箇所に持っている文字列の唯一の同期点。Rust 側の定数を変えたらここも変えること。
    expect(APP_UPDATE_PROGRESS_EVENT).toBe("app-update:progress");
    // Tauri が許すのは英数と `-` `/` `:` `_` のみ。
    expect(APP_UPDATE_PROGRESS_EVENT).toMatch(/^[A-Za-z0-9\-/:_]+$/);
  });

  /**
   * `listen` に渡された Tauri 側ハンドラを、モックの呼び出し記録から取り出す。
   * ⚠ クロージャで掴む書き方（`let captured = null` に代入）は、TS が代入を追えず
   * `never` に狭めてしまうので使わない。
   */
  function capturedTauriHandler() {
    return mockListen.mock.calls[0][1] as (event: { payload: AppUpdateProgress }) => void;
  }

  it("その名前で listen し、ペイロードだけをハンドラへ渡す", async () => {
    const unlisten = vi.fn();
    mockListen.mockResolvedValueOnce(unlisten);

    const handler = vi.fn();
    const received = await listenAppUpdateProgress(handler);

    expect(mockListen).toHaveBeenCalledTimes(1);
    expect(mockListen.mock.calls[0][0]).toBe(APP_UPDATE_PROGRESS_EVENT);
    expect(received).toBe(unlisten);

    const payload: AppUpdateProgress = {
      phase: "downloading",
      downloadedBytes: 1024,
      totalBytes: 4096,
    };
    // Tauri は `{ event, id, payload }` を渡してくるが、ハンドラに見せるのは payload だけ。
    capturedTauriHandler()({ payload });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(payload);
  });

  it("総バイト数が null のペイロードもそのまま通す（正規化しない）", async () => {
    mockListen.mockResolvedValueOnce(vi.fn());

    const handler = vi.fn();
    await listenAppUpdateProgress(handler);
    capturedTauriHandler()({
      payload: { phase: "installing", downloadedBytes: 7, totalBytes: null },
    });
    expect(handler).toHaveBeenCalledWith({
      phase: "installing",
      downloadedBytes: 7,
      totalBytes: null,
    });
  });
});
