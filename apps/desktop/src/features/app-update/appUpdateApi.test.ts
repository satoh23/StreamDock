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

import { invoke } from "@tauri-apps/api/core";
import { checkAppUpdate } from "./appUpdateApi";

const mockInvoke = vi.mocked(invoke);

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
