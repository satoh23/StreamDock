import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { GachaEffectStage } from "./GachaEffectStage";
import capsule1Url from "../../assets/gacha/capsule-1.png";
import capsule4Url from "../../assets/gacha/capsule-4.png";
import machine1Url from "../../assets/gacha/machine-1.png";
import machine5Url from "../../assets/gacha/machine-5.png";
import sparkleUrl from "../../assets/gacha/sparkle.png";
import telopGachaUrl from "../../assets/gacha/telop-gacha.png";
import telopPakaUrl from "../../assets/gacha/telop-paka.png";
import telopRareUrl from "../../assets/gacha/telop-rare.png";
import type { GachaStageView } from "./gachaStagePlayback";

/**
 * ⚠⚠ **063c 段 2-b: 演出の「描く側」だけの仕様テスト。**
 *
 * ⚠ 時間の進み方は [`gachaStagePlayback.test.ts`]、通しの動きは
 * [`EffectOverlayApp.gacha.test.tsx`] が持つ。ここが単体で見るのは 3 つ:
 *
 * 1. ⚠⚠⚠ **範囲外のコマが来ても壊れない**（通しのテストからは到達できない防御）
 * 2. ⚠⚠⚠ **焼き込みの文字は「測れるもの」しか使っていない**——
 *    元シートには「大当たり！」のテロップとカードが在るが、
 *    **どの景品が当たっても「大当たり」と出る**のは視聴者に対する嘘になる。
 *    ⚠ 「レア！」は**測れる**ので使う（063c 段 3・`isGachaRarePrize` が根拠）。
 * 3. ⚠⚠⚠ **§9: 画面に出る第三者データは表示名だけ**（063c 段 3 で線が動いた）
 */
const srcs = (): string[] =>
  Array.from(document.querySelectorAll("img")).map(
    (img) => img.getAttribute("src") ?? "",
  );

/** ⚠ 既定は「名前なし・レアでない」＝ **段 2-b までの見え方**（回帰の基準になる）。 */
const stage = (
  view: GachaStageView,
  over: Partial<{
    prizeLabel: string;
    viewerName: string | null;
    rare: boolean;
    prizeColor: string;
  }> = {},
) => (
  <GachaEffectStage
    view={view}
    prizeLabel={over.prizeLabel ?? "大当たり"}
    viewerName={over.viewerName ?? null}
    rare={over.rare ?? false}
    prizeColor={over.prizeColor ?? "#ffd76a"}
  />
);

describe("063c 段 2-b: GachaEffectStage", () => {
  it("抽選中はマシンと「ガチャ！」を出す（景品名は出さない）", () => {
    render(stage({ phase: "spin", frame: 0 }));
    expect(srcs()).toEqual([machine1Url, telopGachaUrl]);
    expect(screen.queryByText("大当たり")).toBeNull();
  });

  /**
   * ⚠⚠ 063c 段 2-c: **排出はシートの 5 コマ目**（6 コマ目は排出されるカプセルの色が違うので使わない）。
   * ⚠ ここが `machine-6` に戻ると「青いカプセルが出てきて、赤いカプセルが割れる」になる。
   */
  it("⚠ 抽選中の最後のコマは「カプセルが出てくる」絵", () => {
    render(stage({ phase: "spin", frame: 4 }));
    expect(srcs()).toContain(machine5Url);
  });

  it("開封はカプセルと「パカッ！」を出す（景品名はまだ出さない）", () => {
    render(stage({ phase: "open", frame: 0 }));
    expect(srcs()).toEqual([capsule1Url, telopPakaUrl]);
    expect(screen.queryByText("大当たり")).toBeNull();
  });

  it("結果は景品名と割れた殻を出す", () => {
    render(stage({ phase: "result" }, { prizeLabel: "特賞" }));
    expect(screen.getByText("特賞")).toBeInTheDocument();
    expect(srcs()).toContain(capsule4Url);
    expect(srcs()).toContain(sparkleUrl);
  });

  /**
   * ⚠⚠⚠ **063c 段 5-b: 「が当たりました」は消した**（依頼者の指示）。
   * ⚠ 戻ると**景品名より先に説明文が目に入る**——依頼者が「あくまでそっちがメイン」と言ったのは
   * 景品名のほうである。
   */
  it("⚠⚠⚠ 段 5-b: 「が当たりました」を出さない", () => {
    render(stage({ phase: "result" }, { prizeLabel: "特賞" }));
    expect(screen.queryByText(/当たりました/)).toBeNull();
    expect(screen.queryByText(/当選/)).toBeNull();
  });

  /**
   * ⚠⚠⚠ **063c 段 5-c: 「レア！」がキラキラの下に沈まないこと**（依頼者の指摘）。
   * ⚠⚠ 重なり順は **DOM 順だけ**で決めている（`z-index` を足さない＝透過窓で予測できなくなるため）。
   * ⇒ **光がテロップより先に在る**＝光が背面、という 1 点を固定する。
   */
  it("⚠⚠⚠ 段 5-c: 光は「レア！」より背面（DOM 順で先）に在る", () => {
    render(stage({ phase: "result" }, { rare: true }));
    const order = srcs();
    expect(order).toContain(telopRareUrl);
    expect(order.indexOf(sparkleUrl)).toBeLessThan(order.indexOf(telopRareUrl));
  });

  /** ⚠ 殻と景品名の器も光より前に在る（同じ理由——光は**いちばん後ろ**である）。 */
  it("⚠⚠ 光は結果の段のいちばん最初の要素である", () => {
    render(stage({ phase: "result" }, { rare: true }));
    expect(srcs()[0]).toBe(sparkleUrl);
  });

  /**
   * ⚠⚠ **`Math.min` を外す変異を殺す。** 範囲外のコマは `undefined` になり、
   * ⚠ React は `src={undefined}` を**属性ごと省く**ので、
   * **透過窓に「壊れた画像」だけが残る**（配信画面にそのまま映る）。
   */
  it.each([
    ["抽選中", { phase: "spin", frame: 99 } as const, machine5Url],
    ["開封", { phase: "open", frame: 99 } as const, capsule4Url],
  ])("⚠⚠⚠ 範囲外のコマは最後のコマに収める: %s", (_label, view, expected) => {
    render(stage(view));
    expect(srcs()).toContain(expected);
    for (const src of srcs()) expect(src.length).toBeGreaterThan(0);
  });

  /**
   * ⚠⚠⚠ **焼き込みの「大当たり！」を使っていない。**
   * ⚠ 使うと**当たりやすさに関係なく毎回「大当たり」**と出る＝視聴者に対する嘘になる
   * （素材の切り出し側 `extract-gacha-assets.py` でも 6 コマ目を落としてある）。
   */
  it("⚠⚠⚠ どの段でも「大当たり」という文字が素材から出てこない", () => {
    for (const view of [
      { phase: "spin", frame: 0 },
      { phase: "open", frame: 3 },
      { phase: "result" },
    ] as const) {
      const { unmount } = render(
        stage(view, { prizeLabel: "ふつうの景品", rare: true }),
      );
      // ⚠ 素材のファイル名にも「大当たり」由来のものが無いこと（切り出し側と二重に固定する）。
      for (const src of srcs()) expect(src).not.toContain("atari");
      expect(screen.queryByText("大当たり")).toBeNull();
      unmount();
    }
  });

  // --- 063c 段 3: 誰のガチャか ／ レア -------------------------------------------------

  /**
   * ⚠⚠⚠ **「誰のガチャか」は 3 段すべてに出す。**
   * ⚠ 結果の段にしか出さないと、**視聴者は数秒待ってから自分の番だったと知る**ことになり、
   * 依頼の「どのユーザーのガチャなのかが分かるようにしたい」を満たさない。
   */
  it.each([
    ["抽選中", { phase: "spin", frame: 0 } as const],
    ["開封", { phase: "open", frame: 0 } as const],
    ["結果", { phase: "result" } as const],
  ])("⚠⚠ 表示名は 3 段すべてに出る: %s", (_label, view) => {
    render(stage(view, { viewerName: "視聴者A" }));
    expect(screen.getByText(/視聴者A/)).toBeInTheDocument();
  });

  it("⚠ 表示名が null なら「さんのガチャ」ごと出さない（空欄を作らない）", () => {
    render(stage({ phase: "result" }, { viewerName: null }));
    expect(screen.queryByText(/さんのガチャ/)).toBeNull();
  });

  /**
   * ⚠⚠⚠ **「レア！」は結果の段だけ。**
   * ⚠ 抽選中に出すと**当たる前から結果が漏れる**（何が当たったかはまだ伏せている段である）。
   */
  it("⚠⚠ レアのテロップは結果の段だけに出る", () => {
    for (const view of [
      { phase: "spin", frame: 0 },
      { phase: "open", frame: 0 },
    ] as const) {
      const { unmount } = render(stage(view, { rare: true }));
      expect(srcs()).not.toContain(telopRareUrl);
      unmount();
    }
    render(stage({ phase: "result" }, { rare: true }));
    expect(srcs()).toContain(telopRareUrl);
  });

  it("⚠⚠ レアでなければテロップは出ない（普通の景品にレアと出さない）", () => {
    render(stage({ phase: "result" }, { rare: false }));
    expect(srcs()).not.toContain(telopRareUrl);
  });

  /**
   * ⚠⚠⚠ **§9: 画面に出る文字は「景品名」と「表示名」の 2 つだけ**（063c 段 3 で線が動いた）。
   * ⚠ **本文・視聴者 id・金額は受け取る口が型として無い**ので、ここに出しようがない。
   * ⚠⚠ **丸ごと一致で見る**＝ 文言が 1 つでも増えたらレッドになる網である。
   */
  /**
   * ⚠⚠⚠ **063c 段 4-b: 景品名の色は「渡されたもの」で描く。**
   * ⚠ ここで既定値を持つと**2 通り目の既定**になり、`parseGachaPrizeColor` が持つ既定と食い違う
   * （⚠ 段 5-e レビュー Q-3 で訂正——旧記述の `gachaPrizeColorCss` は段 5-e で消えた関数である）。
   * ⚠⚠ 色は CSS 変数で渡す（`color` を直接インラインで当てると、CSS 側の縁取りと
   * 別々の場所で管理することになる）。
   */
  it("⚠⚠ 景品名の色は CSS 変数として渡される", () => {
    const { container } = render(
      stage({ phase: "result" }, { prizeColor: "#7fd4ff" }),
    );
    const stageEl = container.firstElementChild as HTMLElement;
    expect(stageEl.style.getPropertyValue("--gacha-prize-color")).toBe(
      "#7fd4ff",
    );
  });

  it("⚠⚠⚠ §9: 画面に出る文字は景品名と表示名だけ", () => {
    render(
      stage(
        { phase: "result" },
        { prizeLabel: "景品X", viewerName: "視聴者A" },
      ),
    );
    expect(document.body.textContent).toBe("視聴者A さんのガチャ景品X");
  });
});
