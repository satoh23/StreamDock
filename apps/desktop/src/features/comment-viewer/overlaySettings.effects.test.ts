import { describe, it, expect, beforeEach } from "vitest";
import {
  EFFECT_OVERLAY_ENABLED_KEY,
  EFFECT_OBS_AUTO_ADD_KEY,
  EFFECT_OVERLAY_GUIDE_PENDING_KEY,
  loadEffectOverlayEnabled,
  saveEffectOverlayEnabled,
  loadEffectObsAutoAdd,
  saveEffectObsAutoAdd,
  loadEffectOverlayGuidePending,
  saveEffectOverlayGuidePending,
} from "./overlaySettings";

/**
 * 061a: エフェクト窓の 2 つの設定キーの仕様テスト（既存 `overlaySettings.obs.test.ts` と同型）。
 *
 * あるべき挙動:
 * - **どちらも既定 OFF**。⚠ これは 045c の「明示的に有効化した時のみ OBS へ接続する」と、
 *   「アップデート直後にユーザー操作ゼロで配信画面へ窓が出ない」の両方を担保している。
 * - 未保存・不正値・例外はすべて false へ倒す（fail-safe）。
 * - ⚠ **2 つのキーは独立**（片方を変えてももう片方に影響しない）。エフェクトの「表示」と
 *   「OBS 自動反映」は 045c の線引き（表示が主・自動反映は従）で別々に切れる必要がある。
 * - ⚠ **既存の `OBS_AUTO_ADD_KEY` とキーが衝突しない**（共有すると `CommentViewerApp` の
 *   `obsAutoAdd` state が main 窓の書換で stale になる。詳細は overlaySettings.ts の JSDoc）。
 */
describe("061a: エフェクト窓の設定キー", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("キーが既存のオーバーレイ設定と衝突しない", () => {
    expect(EFFECT_OVERLAY_ENABLED_KEY).toBe(
      "stream-dock.comment-viewer.effect-overlay-enabled",
    );
    expect(EFFECT_OBS_AUTO_ADD_KEY).toBe(
      "stream-dock.comment-viewer.effect-obs-auto-add",
    );
    expect(EFFECT_OVERLAY_ENABLED_KEY).not.toBe(EFFECT_OBS_AUTO_ADD_KEY);
  });

  it("未保存はどちらも false（既定 OFF）", () => {
    expect(loadEffectOverlayEnabled()).toBe(false);
    expect(loadEffectObsAutoAdd()).toBe(false);
  });

  it("保存した値を読み戻せる", () => {
    saveEffectOverlayEnabled(true);
    saveEffectObsAutoAdd(true);
    expect(loadEffectOverlayEnabled()).toBe(true);
    expect(loadEffectObsAutoAdd()).toBe(true);

    saveEffectOverlayEnabled(false);
    saveEffectObsAutoAdd(false);
    expect(loadEffectOverlayEnabled()).toBe(false);
    expect(loadEffectObsAutoAdd()).toBe(false);
  });

  it("不正値は false へ倒す（fail-safe）", () => {
    localStorage.setItem(EFFECT_OVERLAY_ENABLED_KEY, "TRUE");
    localStorage.setItem(EFFECT_OBS_AUTO_ADD_KEY, "1");
    expect(loadEffectOverlayEnabled()).toBe(false);
    expect(loadEffectObsAutoAdd()).toBe(false);
  });

  it("2 つのキーは独立している（表示 ON でも自動反映は OFF のまま）", () => {
    saveEffectOverlayEnabled(true);
    expect(loadEffectOverlayEnabled()).toBe(true);
    expect(loadEffectObsAutoAdd()).toBe(false);

    saveEffectOverlayEnabled(false);
    saveEffectObsAutoAdd(true);
    expect(loadEffectOverlayEnabled()).toBe(false);
    expect(loadEffectObsAutoAdd()).toBe(true);
  });
});

/**
 * 061a レビュー（Q-1）: セットアップ用ガイドのワンショット旗。
 *
 * あるべき挙動（`EFFECT_OVERLAY_GUIDE_PENDING_KEY` の JSDoc が正）:
 * - ⚠⚠ **未保存＝false**。これが「アプリ起動時の窓復元ではガイドを出さない」を土台で担保している
 *  （旧実装は窓のマウントで無条件に出しており、配信直前に StreamDock を起動すると
 *   破線枠とセットアップ文言が 30 秒間 OBS のキャプチャに映っていた）。
 * - 立てる／倒すができ、**他の 2 キーから独立**している。
 * - 不正値は false へ倒す（fail-safe＝配信画面を汚さない側）。
 */
describe("061a: セットアップ用ガイドのワンショット旗", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("キーが既存 2 本と衝突しない", () => {
    expect(EFFECT_OVERLAY_GUIDE_PENDING_KEY).toBe(
      "stream-dock.comment-viewer.effect-overlay-guide-pending",
    );
    expect(EFFECT_OVERLAY_GUIDE_PENDING_KEY).not.toBe(EFFECT_OVERLAY_ENABLED_KEY);
    expect(EFFECT_OVERLAY_GUIDE_PENDING_KEY).not.toBe(EFFECT_OBS_AUTO_ADD_KEY);
  });

  it("⚠⚠ 未保存は false（起動時の窓復元ではガイドを出さない）", () => {
    expect(loadEffectOverlayGuidePending()).toBe(false);
  });

  it("立てる／倒すができる", () => {
    saveEffectOverlayGuidePending(true);
    expect(loadEffectOverlayGuidePending()).toBe(true);
    saveEffectOverlayGuidePending(false);
    expect(loadEffectOverlayGuidePending()).toBe(false);
  });

  it("不正値は false へ倒す（fail-safe＝配信画面を汚さない側）", () => {
    localStorage.setItem(EFFECT_OVERLAY_GUIDE_PENDING_KEY, "TRUE");
    expect(loadEffectOverlayGuidePending()).toBe(false);
    localStorage.setItem(EFFECT_OVERLAY_GUIDE_PENDING_KEY, "1");
    expect(loadEffectOverlayGuidePending()).toBe(false);
  });

  it("⚠ 表示設定を ON にしただけでは旗は立たない（旗を立てるのは画面側の明示操作だけ）", () => {
    saveEffectOverlayEnabled(true);
    saveEffectObsAutoAdd(true);
    expect(loadEffectOverlayGuidePending()).toBe(false);
  });

  it("⚠ 旗を倒しても表示設定は残る（窓は開いたままガイドだけ消える）", () => {
    saveEffectOverlayEnabled(true);
    saveEffectOverlayGuidePending(true);
    saveEffectOverlayGuidePending(false);
    expect(loadEffectOverlayEnabled()).toBe(true);
  });
});
