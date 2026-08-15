import { describe, it, expect, beforeEach } from "vitest";
import {
  STAGE_OVERLAY_ENABLED_KEY,
  EFFECT_OVERLAY_GUIDE_PENDING_KEY,
  loadStageOverlayEnabled,
  saveStageOverlayEnabled,
  loadEffectOverlayGuidePending,
  saveEffectOverlayGuidePending,
} from "./overlaySettings";

/**
 * 061a: エフェクト窓の設定キーの仕様テスト（既存 `overlaySettings.obs.test.ts` と同型）。
 *
 * あるべき挙動:
 * - **既定 OFF**。⚠ これは 045c の「明示的に有効化した時のみ OBS へ接続する」と、
 *   「アップデート直後にユーザー操作ゼロで配信画面へ窓が出ない」の両方を担保している。
 * - 未保存・不正値・例外はすべて false へ倒す（fail-safe）。
 *
 * ## ⚠⚠⚠ 064e: `EFFECT_OBS_AUTO_ADD_KEY`（OBS 自動反映の ON/OFF）を削除した
 *
 * 依頼者の指示＝「**OBS に自動で反映はデフォルト機能にします**」。
 * ⇒ ステージ窓の OBS 追加は**配信イベントを開始したら必ず走る**（トグルが存在しない）。
 * ⚠ **061a が「2 つのキーは独立」として固定していた 4 ケースは、片方が消えたので成立しない。**
 * ⚠⚠ **代わりに「戻ってこないこと」を固定する**——キーを復活させると
 * **既定 OFF に戻り、玉入れが「開始したのに配信画面へ出ない」に逆戻りする**（064e の主眼）。
 *
 * ## ⚠⚠⚠ 064 レビュー S-6: 対象を `STAGE_OVERLAY_ENABLED_KEY` へ移した
 *
 * このファイルは長らく `EFFECT_OVERLAY_ENABLED_KEY`（コーナー窓の旗）を対象にしていたが、
 * **064d でコーナー窓ごと廃止され、書き手も読み手も消えた**（キーと `load*` / `save*` だけが
 * 呼び手ゼロで残っていたのを S-6 で削除した）。
 * ⚠⚠ **検出力は落としていない**——ここで見ている「既定 OFF」「読み戻し」「不正値は false」は
 * **いま `docs/security.md` §1 を守っている唯一のガード**（ステージ窓の旗）に対して、
 * まったく同じ形で効いている。⚠ **むしろ守るべき対象へ検査が移った。**
 */
describe("061a/064e: エフェクト窓の設定キー", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("キーが既存のオーバーレイ設定と衝突しない", () => {
    expect(STAGE_OVERLAY_ENABLED_KEY).toBe(
      "stream-dock.comment-viewer.stage-overlay-enabled",
    );
  });

  it("⚠⚠ 未保存は false（既定 OFF ＝ 開催していない扱い・§1 の fail-closed）", () => {
    expect(loadStageOverlayEnabled()).toBe(false);
  });

  it("保存した値を読み戻せる", () => {
    saveStageOverlayEnabled(true);
    expect(loadStageOverlayEnabled()).toBe(true);

    saveStageOverlayEnabled(false);
    expect(loadStageOverlayEnabled()).toBe(false);
  });

  it("不正値は false へ倒す（fail-safe＝OBS へ繋がない側）", () => {
    localStorage.setItem(STAGE_OVERLAY_ENABLED_KEY, "TRUE");
    expect(loadStageOverlayEnabled()).toBe(false);
    localStorage.setItem(STAGE_OVERLAY_ENABLED_KEY, "1");
    expect(loadStageOverlayEnabled()).toBe(false);
  });

  it("⚠⚠⚠ 064e: OBS 自動反映の設定は存在しない（既定 ON ＝ 設定ではない）", async () => {
    // ⚠⚠ **旧キーを読み書きする API が戻る変異をここで殺す。** 戻すと既定 OFF になり、
    //   **配信イベントを開始してもステージ窓が OBS へ追加されない**（061l の玉入れが
    //   「開始したのに配信画面に何も出ない」に逆戻りする）。
    // ⚠ これは意匠ではなく `docs/security.md` §1 の 064e 追補（明示操作 2 段 → 1 段）に紐づく。
    const mod = await import("./overlaySettings");
    expect("EFFECT_OBS_AUTO_ADD_KEY" in mod).toBe(false);
    expect("loadEffectObsAutoAdd" in mod).toBe(false);
    expect("saveEffectObsAutoAdd" in mod).toBe(false);
  });

  it("⚠⚠ 064 レビュー S-6: 064d で消えた窓の設定 API が戻ってこない", async () => {
    // ⚠⚠ **戻すと「呼び手ゼロのキーが localStorage に増える」だけ**で、
    //   §9 の一括削除・エクスポートの対象表と実態がまた食い違う。
    //   ⚠ 戻すとしたら、それは**コーナー窓／テスト表示を作り直す判断**であって
    //   保存層の話ではない（そのときは 064d の削除ごと見直すこと）。
    const mod = await import("./overlaySettings");
    for (const name of [
      "EFFECT_OVERLAY_ENABLED_KEY",
      "loadEffectOverlayEnabled",
      "saveEffectOverlayEnabled",
      "EFFECT_TEST_FIRE_KEY",
      "EFFECT_TEST_FIRE_PENDING_KEY",
      "STAGE_TEST_FIRE_PENDING_KEY",
      "requestEffectTestFire",
      "saveEffectTestFirePending",
      "takeEffectTestFirePending",
      "saveStageTestFirePending",
      "takeStageTestFirePending",
    ]) {
      expect(name in mod).toBe(false);
    }
  });
});

/**
 * 061a レビュー（Q-1）: セットアップ用ガイドのワンショット旗。
 *
 * あるべき挙動（`EFFECT_OVERLAY_GUIDE_PENDING_KEY` の JSDoc が正）:
 * - ⚠⚠ **未保存＝false**。これが「アプリ起動時の窓復元ではガイドを出さない」を土台で担保している
 *  （旧実装は窓のマウントで無条件に出しており、配信直前に StreamDock を起動すると
 *   破線枠とセットアップ文言が 30 秒間 OBS のキャプチャに映っていた）。
 * - 立てる／倒すができ、**開催の旗から独立**している。
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
    expect(EFFECT_OVERLAY_GUIDE_PENDING_KEY).not.toBe(STAGE_OVERLAY_ENABLED_KEY);
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

  it("⚠ 開催の旗を立てただけではガイド旗は立たない（旗を立てるのは画面側の明示操作だけ）", () => {
    saveStageOverlayEnabled(true);
    expect(loadEffectOverlayGuidePending()).toBe(false);
  });

  it("⚠ ガイド旗を倒しても開催の旗は残る（窓は開いたままガイドだけ消える）", () => {
    saveStageOverlayEnabled(true);
    saveEffectOverlayGuidePending(true);
    saveEffectOverlayGuidePending(false);
    expect(loadStageOverlayEnabled()).toBe(true);
  });
});
