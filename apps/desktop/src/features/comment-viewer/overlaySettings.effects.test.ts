import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  STAGE_OVERLAY_ENABLED_KEY,
  EFFECT_OVERLAY_GUIDE_PENDING_KEY,
  GACHA_PLACEMENT_DEFAULT,
  GACHA_PLACEMENT_KEY,
  GACHA_PRIZE_COLORS,
  GACHA_PRIZE_COLOR_DEFAULT,
  GACHA_PRIZE_COLOR_KEY,
  loadGachaPlacement,
  loadGachaPrizeColor,
  loadStageOverlayEnabled,
  saveGachaPlacement,
  saveGachaPrizeColor,
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
    expect(EFFECT_OVERLAY_GUIDE_PENDING_KEY).not.toBe(
      STAGE_OVERLAY_ENABLED_KEY,
    );
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

/**
 * ⚠⚠⚠ **063c 段 4-a: 「抽選中の長さ」の設定は削除した。**
 *
 * 依頼者の指示＝「**ガチャを回す速度の設定はいらない。常にデフォルトで良い。
 * この設定値を変えることによるメリットが配信者になく、逆に項目が増えることで
 * 画面が複雑になってしまっている**」。⇒ **`GACHA_SPIN_MS`（定数）になった**ので、
 * 範囲検査もそのテストも要らない。
 * ⚠ 代わりに入ったのが下の 2 つ（配置・景品名の色）である。
 */

/**
 * ⚠⚠ **063c 段 4-c: 演出を出す位置。**
 *
 * ⚠⚠⚠ **これはガードではない**（`GACHA_STAGE_ENABLED_KEY` と混同しないこと）——
 * 見た目の位置だけで、OBS へ繋ぐかどうかに関与しない。
 *
 * あるべき挙動:
 * - ⚠ **知らない値は既定（中央）へ倒す**（設定した覚えのない位置に出さない）
 * - ⚠⚠ 保存側も**同じ 1 つの表**を使う（＝検査を 2 通りに分けない）
 */
describe("063c 段 4-c: 演出を出す位置（GACHA_PLACEMENT_KEY）", () => {
  beforeEach(() => localStorage.clear());

  it("未保存なら既定（中央）", () => {
    expect(loadGachaPlacement()).toBe(GACHA_PLACEMENT_DEFAULT);
    expect(GACHA_PLACEMENT_DEFAULT).toBe("center");
  });

  it.each(["left", "center", "right"] as const)(
    "保存した値が読める: %s",
    (id) => {
      saveGachaPlacement(id);
      expect(loadGachaPlacement()).toBe(id);
    },
  );

  it.each([
    ["知らない id", "top"],
    ["空", ""],
    ["JSON", '{"id":"left"}'],
  ])("⚠⚠ 壊れた保存値は既定へ倒す: %s", (_label, raw) => {
    localStorage.setItem(GACHA_PLACEMENT_KEY, raw);
    expect(loadGachaPlacement()).toBe(GACHA_PLACEMENT_DEFAULT);
  });

  it("⚠ 一覧に無い id は保存しない（前の値が残る）", () => {
    saveGachaPlacement("right");
    // @ts-expect-error ⚠ 型では通らない値を、手で書き換えた場合として渡す。
    saveGachaPlacement("top");
    expect(loadGachaPlacement()).toBe("right");
  });

  it("⚠ 読めない環境でも既定を返す（例外を投げない）", () => {
    const spy = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    try {
      expect(loadGachaPlacement()).toBe(GACHA_PLACEMENT_DEFAULT);
    } finally {
      spy.mockRestore();
    }
  });
});

/**
 * ⚠⚠⚠ **063c 段 4-b / 段 5-e: 景品名の色。**
 *
 * ## 何が仕様なのか
 *
 * 段 5-e で **6 択の id → 自由な色（`#rrggbb`）** に変わった。
 * ⚠⚠ **保存値が `style` へ届くようになった**ので、⚠⚠⚠ **関門が 1 つだけ在ることが仕様である**——
 * `parseGachaPrizeColor` を通らない値は 1 バイトも出て行かない。
 *
 * あるべき挙動:
 * - ⚠ 未保存・壊れた値はすべて**既定へ倒す**（`undefined` を返さない——
 *   返すと `style` から色が消え、テーマ由来の読めない色へ戻る＝段 3 までの不具合そのもの）
 * - ⚠⚠⚠ **`#rrggbb` 以外は保存も反映もされない**（CSS の式・別プロパティの注入が通らない）
 * - ⚠ 段 4-b の保存値（`"sky"` などの id）は**その色へ移行する**（黙って既定へ倒さない）
 */
describe("063c 段 5-e: 景品名の色（GACHA_PRIZE_COLOR_KEY）", () => {
  beforeEach(() => localStorage.clear());

  it("未保存なら既定", () => {
    expect(loadGachaPrizeColor()).toBe(GACHA_PRIZE_COLOR_DEFAULT);
  });

  it("⚠⚠ 自由な色を保存して読める（見本に無い色でも）", () => {
    for (const color of ["#000000", "#ffffff", "#123abc", "#7fd4ff"]) {
      saveGachaPrizeColor(color);
      expect(loadGachaPrizeColor()).toBe(color);
    }
  });

  it("⚠ 大文字で来ても小文字に正規化して保存する（見本の選択状態が一致しなくなるため）", () => {
    saveGachaPrizeColor("#FFD76A");
    expect(loadGachaPrizeColor()).toBe("#ffd76a");
    expect(localStorage.getItem(GACHA_PRIZE_COLOR_KEY)).toBe("#ffd76a");
  });

  it.each([
    // ⚠⚠⚠ **CSS の式が通らないこと**（`style` へ届く経路が開いたので、ここが本丸）。
    ["別プロパティの注入", "#ffffff; background: url(x)"],
    ["関数", "var(--text)"],
    ["色名", "red"],
    ["3 桁", "#fff"],
    ["透明度つき 8 桁", "#ffffff80"],
    ["# が無い", "ffd76a"],
    ["16 進でない", "#gggggg"],
    ["空", ""],
    ["空白入り", " #ffd76a "],
  ])("⚠⚠⚠ 壊れた保存値は既定へ倒す: %s", (_label, raw) => {
    localStorage.setItem(GACHA_PRIZE_COLOR_KEY, raw);
    expect(loadGachaPrizeColor()).toBe(GACHA_PRIZE_COLOR_DEFAULT);
  });

  it.each([
    ["別プロパティの注入", "#ffffff; background: url(x)"],
    ["色名", "red"],
    ["3 桁", "#fff"],
    ["空", ""],
  ])("⚠⚠⚠ 文法に合わない値は保存しない（前の値が残る）: %s", (_label, raw) => {
    saveGachaPrizeColor("#7fd4ff");
    saveGachaPrizeColor(raw);
    expect(loadGachaPrizeColor()).toBe("#7fd4ff");
  });

  it("⚠ 段 4-b の保存値（見本の id）はその色へ移行する", () => {
    for (const c of GACHA_PRIZE_COLORS) {
      localStorage.setItem(GACHA_PRIZE_COLOR_KEY, c.id);
      expect(loadGachaPrizeColor()).toBe(c.css);
    }
  });

  it("⚠⚠ 既定は見本のいちばん上（ゴールド）と同じ色である", () => {
    expect(GACHA_PRIZE_COLOR_DEFAULT).toBe(GACHA_PRIZE_COLORS[0]?.css);
  });

  it("⚠ 読めない環境でも既定を返す（例外を投げない）", () => {
    const spy = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    try {
      expect(loadGachaPrizeColor()).toBe(GACHA_PRIZE_COLOR_DEFAULT);
    } finally {
      spy.mockRestore();
    }
  });
});
