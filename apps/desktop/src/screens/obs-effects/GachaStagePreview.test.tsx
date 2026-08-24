import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, screen, fireEvent } from "@testing-library/react";
import { GachaStagePreview } from "./GachaStagePreview";
import { gachaStageTotalMs } from "./gachaStagePlayback";

/**
 * ⚠⚠ **063c 段 4-d / 段 5: 設定画面のプレビュー**の仕様テスト。
 *
 * あるべき挙動:
 * 1. ⚠⚠⚠ **アンマウントでタイマーが残らない**（061a 以来の判断 11・**配信中に動く画面である**）
 * 2. ⚠⚠⚠ **段 5-d: 押すまで動かない・通しで 1 回だけ再生してまた止まる**
 *    （依頼者＝「**自動で再生されるのは分かりにくいし画面が喧しい**」）
 * 3. ⚠⚠⚠ **段 5-a: 実機とまったく同じ「層」で包む**（配置と縁取りがあの層に載っているため）
 * 4. ⚠⚠ **副作用ゼロ**（抽選しない・localStorage を書かない）
 * 5. ⚠ §9: 出る名前は**固定のサンプル**（実在の視聴者名を出す口が無い）
 */
describe("063c 段 5-d: GachaStagePreview", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const advance = (ms: number) =>
    act(() => {
      vi.advanceTimersByTime(ms);
    });

  const view = (placement: "left" | "center" | "right" = "center") =>
    render(
      <GachaStagePreview
        templateId="capsule"
        placement={placement}
        prizeColor="#ffd76a"
        rare={false}
      />,
    );

  const play = () =>
    fireEvent.click(
      screen.getByRole("button", { name: "カプセルガチャを再生" }),
    );

  /** ⚠ 抽選中の段でしか出ない絵。「いま動いているか」をこれで測る。 */
  const hasMachine = () =>
    Array.from(document.querySelectorAll("img")).some((img) =>
      (img.getAttribute("src") ?? "").includes("machine-"),
    );

  /**
   * ⚠⚠⚠ **タイマーを残さない。**
   * ⚠ `toBe(0)` では見られない——jsdom / React が一度きりのタイマーを 1 本残すことがある。
   * ⇒ **1 サイクル回してから「増減がゼロ」を見る**（`EffectOverlayApp.gacha.test.tsx` と同じ手）。
   */
  it("⚠⚠⚠ 再生中にアンマウントしてもタイマーが残らない", () => {
    // ⚠ 暖機（1 回目のマウントで環境側のタイマーを出し切る）。
    const warm = view();
    play();
    advance(500);
    warm.unmount();
    const before = vi.getTimerCount();

    const v = view();
    play();
    advance(500);
    // ⚠ 動いているあいだは**増えている**（＝そもそもタイマーが在ることの確認）。
    expect(vi.getTimerCount()).toBeGreaterThan(before);
    v.unmount();
    expect(vi.getTimerCount()).toBe(before);
  });

  /**
   * ⚠⚠⚠ **段 5-d の本体。** 押していない間は**タイマーを 1 本も張らない**——
   * 「止まって見えるが裏で回っている」を作ると、設定画面を開いている間ずっと再描画が走る。
   */
  it("⚠⚠⚠ 押すまではタイマーを 1 本も張らない", () => {
    const warm = view();
    advance(500);
    warm.unmount();
    const before = vi.getTimerCount();

    view();
    advance(5000);
    expect(vi.getTimerCount()).toBe(before);
    expect(hasMachine()).toBe(false);
  });

  it("⚠⚠⚠ 押すと先頭から再生され、通しで 1 回だけで止まる（ループしない）", () => {
    view();
    play();
    // ⚠ 押した瞬間に先頭（＝マシンが回っている段）へ。
    expect(hasMachine()).toBe(true);
    // ⚠⚠ 全長を過ぎたら止まって静止画へ戻る。
    advance(gachaStageTotalMs() + 500);
    expect(hasMachine()).toBe(false);
    // ⚠⚠⚠ **ここが「ループしない」の担保**——さらに待ってもマシンは二度と出ない。
    advance(gachaStageTotalMs() * 2);
    expect(hasMachine()).toBe(false);
    // ⚠ また押せる状態に戻っている。
    expect(
      screen.getByRole("button", { name: "カプセルガチャを再生" }),
    ).toBeEnabled();
  });

  it("⚠ 再生中はボタンが押せず、状態が文字で分かる", () => {
    view();
    play();
    const btn = screen.getByRole("button", { name: "再生中…" });
    expect(btn).toBeDisabled();
    advance(gachaStageTotalMs() + 500);
    expect(
      screen.getByRole("button", { name: "カプセルガチャを再生" }),
    ).toBeEnabled();
  });

  /**
   * ⚠⚠⚠ **段 5-a: 実機とまったく同じ層で包むこと。**
   * ⚠ 段 4 はこの層が無かったため、**配置が効かず・中央を選んでも左に寄り・縁取りが消えていた**。
   */
  it.each([
    ["left", /gachaAlignLeft/],
    ["center", /gachaAlignCenter/],
    ["right", /gachaAlignRight/],
  ] as const)(
    "⚠⚠⚠ 実機と同じ層で包み、配置クラスが載る: %s",
    (placement, re) => {
      view(placement);
      const layer = document.querySelector("[class*='gachaLayer']");
      expect(layer).not.toBeNull();
      expect(layer?.className).toMatch(re);
    },
  );

  /**
   * ⚠⚠ 止まっている間は**アニメーションごと切る**（キラキラの明滅は `infinite` なので、
   * 切らないと「押していないのに動いている」が残る）。
   * ⚠ jsdom は CSS を解決しないので**クラスが載ることだけ**を見る（効き目は CSS ガードの領分）。
   */
  it("⚠⚠ 止まっている間だけ「静止」のクラスが載る", () => {
    view();
    expect(
      document.querySelector("[class*='gachaPreviewStill']"),
    ).not.toBeNull();
    play();
    expect(document.querySelector("[class*='gachaPreviewStill']")).toBeNull();
    advance(gachaStageTotalMs() + 500);
    expect(
      document.querySelector("[class*='gachaPreviewStill']"),
    ).not.toBeNull();
  });

  it("⚠⚠⚠ 副作用ゼロ（localStorage に 1 バイトも書かない）", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem");
    view();
    play();
    advance(gachaStageTotalMs() + 500);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  /**
   * ⚠⚠ **063c 段 6 で `getByText` から `textContent` の突き合わせへ変えた。**
   *
   * 段 6 で**表示名だけを `<span>` で包んで大きくした**ので、`<p>` の直下にあるテキストノードは
   * 「 さんのガチャ」だけになった。⚠ `getByText` は **要素の直下のテキストノードしか見ない**
   * （`getNodeText` の仕様＝ 子要素の中身は連結しない）ので、
   * **名前と接尾辞にまたがる正規表現はもう当たらない**。
   * ⇒ `GachaEffectStage.test.tsx` の §9 テストと**同じ形**（`textContent` を丸ごと見る）に揃えた。
   * ⚠ **`getByText` に戻さないこと**——戻すと「名前が消えている」のか
   * 「マッチの仕方が合っていないだけ」なのかが区別できないまま緑／赤が動く。
   */
  it("⚠ §9: 出る名前は固定のサンプル（実在の視聴者名ではない）", () => {
    const { container } = view();
    // ⚠ 器（`<p class=gachaViewer>`）の中身を丸ごと見る＝ 名前と接尾辞が両方出ていること。
    //   ⚠⚠ **`p` を付ける**——`class*=` は部分一致なので、付けないと
    //   段 6 で足した `.gachaViewerName`（`<span>`）にも当たりうる。
    const viewer = container.querySelector("p[class*='gachaViewer']");
    expect(viewer?.textContent).toBe("視聴者さん さんのガチャ");
  });

  it("⚠ 知らないテンプレート id は何も出さない（別の演出へ倒さない）", () => {
    const { container } = render(
      <GachaStagePreview
        // @ts-expect-error ⚠ 型では通らない id を、壊れた保存値が来た場合として渡す。
        templateId="omikuji"
        placement="center"
        prizeColor="#ffd76a"
        rare={false}
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});
