import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * 窓操作の Rust command 薄いラッパ（windowApi）の仕様テスト。**061a で 4 本増えたのを機に新設**。
 *
 * ⚠⚠ **なぜ command 名を固定するのか**: これらは文字列リテラルで、typo しても TypeScript は何も言わない。
 * 実行時に invoke が reject するだけで、呼び出し側（`App.tsx` の復元・`ObsEffectsScreen` のトグル）は
 * いずれも `.catch(() => {})` で握りつぶすため、**画面上は何も起きないまま静かに壊れる**
 *（「表示 ON にしたのに窓が出ない」が無言で起きる）。
 *
 * あるべき挙動（`docs/security.md` §3 ／ 各関数の JSDoc）:
 * - 各ラッパは**対応する単一目的コマンドを 1 本だけ**呼ぶ。
 * - ⚠⚠ **すべて無引数**。窓のラベル・サイズ・オプションを frontend から渡す口を作らない（§3/§8）。
 *   ラベルは Rust 内のリテラルで、汎用の `open_window(label)` 型は存在しない。
 * - `is*` は Rust の戻り値（boolean）をそのまま返す。
 *
 * invoke はモックする＝テストは端末外通信も OS 操作も一切しない（§1）。
 */
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import {
  openCommentViewerWindow,
  closeCommentViewerWindow,
  isCommentViewerOpen,
  openCommentOverlayWindow,
  closeCommentOverlayWindow,
  isCommentOverlayOpen,
  openPinnedOverlayWindow,
  closePinnedOverlayWindow,
  isPinnedOverlayOpen,
  openStageOverlayWindow,
  closeStageOverlayWindow,
  isStageOverlayOpen,
} from "./windowApi";

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  mockInvoke.mockReset();
  mockInvoke.mockResolvedValue(undefined);
});

/** ラッパ → 呼ぶべき command 名。⚠ 窓を増やしたらここへ 3 行足すこと。 */
const WRAPPERS: ReadonlyArray<readonly [() => Promise<unknown>, string]> = [
  // ⚠ 064d: コーナー窓（`effect-overlay`）の 3 本は削除した（取り込み機能ごと廃止）。
  // 032c-a: 内蔵コメントビューア窓（061a で open のラッパを足した）。
  [openCommentViewerWindow, "open_comment_viewer_window"],
  [closeCommentViewerWindow, "close_comment_viewer_window"],
  [isCommentViewerOpen, "is_comment_viewer_open"],
  // 033f: コメント一覧オーバーレイ窓。
  [openCommentOverlayWindow, "open_comment_overlay_window"],
  [closeCommentOverlayWindow, "close_comment_overlay_window"],
  [isCommentOverlayOpen, "is_comment_overlay_open"],
  // 046b: 固定コメントオーバーレイ窓。
  [openPinnedOverlayWindow, "open_pinned_overlay_window"],
  [closePinnedOverlayWindow, "close_pinned_overlay_window"],
  [isPinnedOverlayOpen, "is_pinned_overlay_open"],
  // 061k: ステージ演出（全画面）オーバーレイ窓＝エフェクトの 2 本目の出力窓。
  // ⚠ Rust 側の登録漏れは `window_commands_used_by_the_frontend_are_registered` が止める
  //   （このテストは「ラッパがその名前を呼ぶこと」までしか見られない）。
  [openStageOverlayWindow, "open_stage_overlay_window"],
  [closeStageOverlayWindow, "close_stage_overlay_window"],
  [isStageOverlayOpen, "is_stage_overlay_open"],
];

describe("windowApi: command 名の固定", () => {
  it.each(WRAPPERS)("%o は %s を呼ぶ", async (fn, command) => {
    await fn();
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledWith(command);
  });

  it("⚠⚠ すべて無引数で呼ぶ（窓のラベル/オプションを frontend から渡す口を作らない・§3）", async () => {
    for (const [fn] of WRAPPERS) {
      await fn();
    }
    expect(mockInvoke.mock.calls).toHaveLength(WRAPPERS.length);
    for (const call of mockInvoke.mock.calls) {
      // ⚠ 引数が 2 つ以上になったら、それは「frontend から値を受け取る窓操作」＝§3 の逸脱。
      expect(call).toHaveLength(1);
    }
  });

  it("⚠ 15 本の command 名がすべて異なる（コピペで別の窓を操作してしまわない）", () => {
    const names = WRAPPERS.map(([, command]) => command);
    expect(new Set(names).size).toBe(names.length);
    // ⚠⚠ **本数そのものも固定する**（061k で 12 → 15）。集合の一意性だけだと、
    //   ラッパを 1 本まるごと消す変異が緑のまま通る（＝Rust 側の下限 `found >= 15` と対になる検査）。
    expect(names).toHaveLength(12);
  });
});

describe("windowApi: is* は Rust の戻り値を透過する", () => {
  const READERS: ReadonlyArray<readonly [() => Promise<boolean>, string]> = [
    [isCommentViewerOpen, "is_comment_viewer_open"],
    [isCommentOverlayOpen, "is_comment_overlay_open"],
    [isPinnedOverlayOpen, "is_pinned_overlay_open"],
    [isStageOverlayOpen, "is_stage_overlay_open"],
  ];

  it.each(READERS)("%o は true/false をそのまま返す（%s）", async (fn) => {
    mockInvoke.mockResolvedValue(true);
    await expect(fn()).resolves.toBe(true);
    mockInvoke.mockResolvedValue(false);
    await expect(fn()).resolves.toBe(false);
  });
});
