import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { CommentViewerApp } from "./CommentViewerApp";
import type { CommentStreamHandlers } from "../../features/comment-viewer/commentStream";

/**
 * 063e 段 1-b: **`channelpoints.state` が設定ビューまで届いている**ことの配線テスト。
 *
 * ## ⚠⚠⚠ なぜ「配線」だけを別に固定するのか
 *
 * 受け口（`commentStream.channelPoints.test.ts`）と表示（`SettingsView.channelPoints.test.tsx`）は
 * それぞれ固定済みだが、**その 2 つを繋ぐ 1 行（`onChannelPointsState` → `setChannelPointsState`）は
 * どちらのテストにも入っていなかった**。変異テストで確認した結果、その 1 行を消しても
 * **全テストが緑のまま通った**（＝設定カードが永久に「まだ分かりません」になる欠落を誰も止めない）。
 *
 * ⚠⚠ この壊れ方は**症状が待ち状態と見分けられない**——「まだ表示されていないだけ」に見えるので、
 * 実機で触っても気付けない。⚠ しかもこの機能は**作者が実機確認できない**（チャンネルポイントは
 * Twitch 側で有効化されるまで存在しない）ため、テストが唯一の検出手段である。
 *
 * 外部境界（Tauri invoke / sidecar WS / Web Audio / ループバック fetch）は全てモックする
 * （vitest.config.ts の「外部通信も OS 操作も一切行わない」方針）。
 */

// vi.mock のファクトリは巻き上げられるため、共有スパイは vi.hoisted で先に作る。
const mocks = vi.hoisted(() => ({
  handlers: { current: null as CommentStreamHandlers | null },
}));

// sidecar への単一双方向 WS。接続はせず、受け取った handlers を捕捉して直接叩く。
vi.mock("../../features/comment-viewer/commentStream", () => ({
  connectCommentStream: vi.fn((handlers) => {
    mocks.handlers.current = handlers;
    return {
      disconnect: vi.fn(),
      startLogin: vi.fn(),
      startSession: vi.fn(async () => ({ ok: true as const })),
      stopSession: vi.fn(async () => ({ ok: true as const })),
      enableObs: vi.fn(),
      hideObs: vi.fn(),
      listObsSources: vi.fn(),
      fireObsSource: vi.fn(),
      disableObs: vi.fn(),
      requestThemeFont: vi.fn(async () => ({
        ok: false as const,
        reason: "offline" as const,
      })),
      requestThemeImport: vi.fn(async () => ({
        ok: false as const,
        reason: "offline" as const,
      })),
      sendChat: vi.fn(async () => ({ ok: false as const, reason: "offline" })),
    };
  }),
}));

// 以下は CommentViewerApp のマウント時に走る外部境界の封鎖。
// ⚠ モジュールを**丸ごと差し替える**ので、書かなかった export は undefined になる。
vi.mock("../../features/comment-viewer/windowApi", () => ({
  isCommentOverlayOpen: vi.fn(async () => false),
  openCommentOverlayWindow: vi.fn(async () => {}),
  closeCommentOverlayWindow: vi.fn(async () => {}),
  isPinnedOverlayOpen: vi.fn(async () => false),
  openPinnedOverlayWindow: vi.fn(async () => {}),
  closePinnedOverlayWindow: vi.fn(async () => {}),
  isStageOverlayOpen: vi.fn(async () => false),
  openStageOverlayWindow: vi.fn(async () => {}),
  closeStageOverlayWindow: vi.fn(async () => {}),
  closeCommentViewerWindow: vi.fn(async () => {}),
  isCommentViewerOpen: vi.fn(async () => false),
}));

vi.mock("../../features/comment-viewer/obsApi", () => ({
  detectObsWebsocketConfig: vi.fn(async () => null),
  setObsWebsocketPassword: vi.fn(async () => {}),
  clearObsWebsocketPassword: vi.fn(async () => {}),
}));

vi.mock("../../features/comment-viewer/audioOutputApi", () => ({
  listAudioOutputDevices: vi.fn(async () => []),
  playNotificationSound: vi.fn(async () => {}),
}));

vi.mock("../../features/comment-viewer/voicevox", () => ({
  VOICEVOX_BASE: "http://127.0.0.1:50021",
  ZUNDAMON_NORMAL_SPEAKER_ID: 3,
  checkEngineRunning: vi.fn(async () => false),
  fetchSpeakers: vi.fn(async () => []),
  synthesize: vi.fn(async () => new ArrayBuffer(0)),
  playWav: vi.fn(async () => {}),
}));

vi.mock("../../features/comment-viewer/voicevoxApi", () => ({
  launchVoicevoxEngine: vi.fn(async () => ({
    supported: true,
    launched: false,
    message: "",
  })),
}));

// jsdom に AudioContext が無いため、読み上げキューと試聴プレイヤーは生成ごと差し替える。
vi.mock("../../features/comment-viewer/ttsQueue", () => ({
  sanitizeForSpeech: vi.fn((text: string) => text),
  createTtsQueue: vi.fn(() => ({
    enqueue: vi.fn(),
    resume: vi.fn(async () => {}),
    dispose: vi.fn(),
  })),
}));

vi.mock("../../features/comment-viewer/voicevoxPreview", () => ({
  createVoicevoxPreview: vi.fn(() => ({ play: vi.fn(), dispose: vi.fn() })),
}));

vi.mock("../../features/viewer-memory/viewerMemoryApi", () => ({
  recordComment: vi.fn(),
  recordComments: vi.fn(),
  listViewers: vi.fn(async () => []),
  getViewer: vi.fn(),
  updateViewerNote: vi.fn(async () => {}),
  deleteViewer: vi.fn(async () => {}),
  clearViewers: vi.fn(async () => {}),
}));

vi.mock("../../features/stream-session/streamSessionApi", () => {
  const record = {
    id: "session-1",
    startedAt: "2026-08-16T10:00:00+00:00",
    platforms: ["twitch"],
    title: "",
    createdAt: "2026-08-16T10:00:00+00:00",
    updatedAt: "2026-08-16T10:00:00+00:00",
  };
  return {
    startStreamSession: vi.fn(async () => record),
    getActiveStreamSession: vi.fn(async () => null),
    updateStreamSessionPlatforms: vi.fn(async () => record),
    endStreamSession: vi.fn(async () => record),
    updateStreamSessionTitle: vi.fn(async () => record),
    listStreamSessions: vi.fn(async () => []),
    closeStaleStreamSessions: vi.fn(async () => 0),
  };
});

vi.mock("../../features/stream-summary/streamSummaryApi", () => ({
  getStreamSummary: vi.fn(async () => {
    throw new Error("stub");
  }),
}));

// 設定ビューが host_os を invoke するため OS を固定する。
vi.mock("../../features/platform/useHostOs", () => ({
  useHostOs: () => "macos",
}));

beforeEach(() => {
  localStorage.clear();
  mocks.handlers.current = null;
});

/** sidecar からの `channelpoints.state` を再現する（実 WS は張らないので捕捉した handlers を直接叩く）。 */
async function emitChannelPointsState(state: string) {
  expect(mocks.handlers.current).not.toBeNull();
  await act(async () => {
    mocks.handlers.current?.onChannelPointsState?.(state);
  });
}

/** 設定ビューを開く。 */
function openSettings() {
  fireEvent.click(screen.getByRole("button", { name: "設定" }));
}

describe("CommentViewerApp 063e 段 1-b: channelpoints.state の配線", () => {
  it("⚠⚠⚠ 受信できたという通知が設定カードまで届く", async () => {
    render(<CommentViewerApp />);
    await emitChannelPointsState("receiving");
    openSettings();
    expect(document.body.textContent ?? "").toContain(
      "引き換えを受信できる状態です",
    );
  });

  it("⚠⚠⚠ 受信できていないという通知も設定カードまで届く", async () => {
    render(<CommentViewerApp />);
    await emitChannelPointsState("unavailable");
    openSettings();
    expect(document.body.textContent ?? "").toContain(
      "引き換えを受信できていません",
    );
  });

  it("⚠ 設定ビューを開いたあとに届いた通知も反映される（開きっぱなしで切り替わる）", async () => {
    render(<CommentViewerApp />);
    openSettings();
    // ⚠ 取得開始 → 購読の成否は数秒あとに決まるので、**開いたまま更新される**ことが要る。
    expect(document.body.textContent ?? "").toContain(
      "受信できる状態かどうかがここに出ます",
    );
    await emitChannelPointsState("receiving");
    expect(document.body.textContent ?? "").toContain(
      "引き換えを受信できる状態です",
    );
    // ⚠⚠ 取得を止めた／繋ぎ直したときの `unknown` も戻ってくること（緑を残さない）。
    await emitChannelPointsState("unknown");
    expect(document.body.textContent ?? "").not.toContain(
      "引き換えを受信できる状態です",
    );
  });

  it("何も届いていなければ「まだ分かりません」のまま", async () => {
    render(<CommentViewerApp />);
    openSettings();
    const body = document.body.textContent ?? "";
    expect(body).toContain("受信できる状態かどうかがここに出ます");
    expect(body).not.toContain("引き換えを受信できていません");
  });
});
