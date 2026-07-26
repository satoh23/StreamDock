import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ObsWsConfig } from "./bindings/ObsWsConfig";

/**
 * 044a: OBS 連携の Rust command 薄いラッパ（obsApi）の仕様テスト。
 * あるべき挙動（docs/tasks/044a / docs/security.md §5/§9）:
 * - detect は read-only 検出 command を無引数で呼び、結果（null 含む）をそのまま返す。
 * - **OBS パスワードは set command にのみ生値で渡す**（WS/localStorage には載せない・§9）。
 * - clear は破棄 command を呼ぶ。
 * invoke はモックする＝テストは端末外通信も OS 操作も一切しない（§1）。
 */
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import {
  detectObsWebsocketConfig,
  setObsWebsocketPassword,
  clearObsWebsocketPassword,
} from "./obsApi";

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  mockInvoke.mockReset();
});

describe("detectObsWebsocketConfig", () => {
  it("detect_obs_websocket_config を無引数で呼び、検出結果をそのまま返す", async () => {
    const cfg: ObsWsConfig = { enabled: true, port: 4455, authRequired: false };
    mockInvoke.mockResolvedValue(cfg);
    await expect(detectObsWebsocketConfig()).resolves.toEqual(cfg);
    expect(mockInvoke).toHaveBeenCalledWith("detect_obs_websocket_config");
  });

  it("未検出は null を透過する（UI が有効化ガイドを出せる）", async () => {
    mockInvoke.mockResolvedValue(null);
    await expect(detectObsWebsocketConfig()).resolves.toBeNull();
  });
});

describe("setObsWebsocketPassword", () => {
  it("set_obs_websocket_password に password だけを渡す（§9・WS には載せない）", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await setObsWebsocketPassword("s3cret");
    expect(mockInvoke).toHaveBeenCalledWith("set_obs_websocket_password", {
      password: "s3cret",
    });
    // 呼ばれた command はこの 1 つだけ（パスワードが他経路へ漏れない）。
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });
});

describe("clearObsWebsocketPassword", () => {
  it("clear_obs_websocket_password を呼ぶ（引数なし）", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await clearObsWebsocketPassword();
    expect(mockInvoke).toHaveBeenCalledWith("clear_obs_websocket_password");
  });
});
