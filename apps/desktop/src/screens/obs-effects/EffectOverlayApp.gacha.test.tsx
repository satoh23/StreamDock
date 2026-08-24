import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { EffectOverlayApp } from "./EffectOverlayApp";
import {
  EFFECT_OVERLAY_GUIDE_PENDING_KEY,
  GACHA_PLACEMENT_KEY,
  GACHA_PRIZE_COLOR_KEY,
} from "../../features/comment-viewer/overlaySettings";
import type { GachaStageResult } from "./gachaStageEvent";
import {
  GACHA_OPEN_MS,
  GACHA_SPIN_MS,
  gachaStageTotalMs,
} from "./gachaStagePlayback";
import capsule1Url from "../../assets/gacha/capsule-1.png";
import machine1Url from "../../assets/gacha/machine-1.png";
import machine2Url from "../../assets/gacha/machine-2.png";
import machine3Url from "../../assets/gacha/machine-3.png";
import machine4Url from "../../assets/gacha/machine-4.png";
import machine5Url from "../../assets/gacha/machine-5.png";

/**
 * ⚠⚠⚠ **063c 段 2-a: ステージ窓に出るガチャの当選**の仕様テスト。
 *
 * ⚠⚠ **既存の `EffectOverlayApp.test.tsx` とファイルを分けてある**（`EffectOverlayApp.streamEvent.test.tsx`
 * と同じ理由＝**`./gachaStageEvent` をモックする**必要があり、モジュールモックはファイル単位に効くため）。
 *
 * あるべき挙動:
 * - ⚠⚠⚠ **この窓は抽選をしない**（受け取った結果をそのまま出す＝二重抽選が構造的に起きない）
 * - **1 件ずつ順に出す**（後勝ちで上書きしない＝当たったのに一瞬で消える、を作らない）
 * - ⚠ **溢れたぶんは捨てる**（古いほうを捨てない＝先に当たった人が先に出る）
 * - **一定時間で消える**／⚠⚠ **アンマウントでタイマーが残らない**（判断 11）
 * - ⚠⚠ **購読はアンマウントで必ず外れる**（外れないと 1 件の当選が 2 回キューに入る）
 * - ⚠⚠⚠ **技術的なエラーを出さない**（この層は OBS のキャプチャに映る＝視聴者に読める）
 *
 * ⚠ 伝達路（`emitTo` / `listen`）そのものの仕様は [`gachaStageEvent.test.ts`] が固定する。
 * ここが見るのは**受け取ってからの振る舞い**だけである。
 */
const mocks = vi.hoisted(() => ({
  connectCommentStream: vi.fn(),
  listenGachaStageResult: vi.fn(),
}));

vi.mock("../../features/comment-viewer/commentStream", () => ({
  connectCommentStream: mocks.connectCommentStream,
}));

vi.mock("./gachaStageEvent", () => ({
  listenGachaStageResult: mocks.listenGachaStageResult,
}));

/** ⚠ 抽選中の長さ（⚠⚠ 063c 段 4-a で**設定ではなく定数**になった）。 */
const SPIN_MS = GACHA_SPIN_MS;
/** 当選 1 件の全長（抽選中 ＋ 開封 ＋ 結果）。 */
const TOTAL_MS = gachaStageTotalMs();
/**
 * ⚠ 「1 件ぶん進める」に足す余裕（ミリ秒）。
 *
 * ⚠⚠ **時計は一定間隔（60ms）で進む**ので、`TOTAL_MS` ちょうどまで進めても
 * **まだ 1 目盛りぶん足りない**ことがある。⇒ 端数を跨ぐぶんだけ足す。
 * ⚠ 実装の間隔そのものをここに書かない（間隔を変えてもこのテストが壊れない）。
 */
const TICK_SLACK_MS = 200;

/** 画面に出ている画像の `src`（⚠ `alt=""` の装飾なので role では引けない）。 */
const imgSrcs = (): string[] =>
  Array.from(document.querySelectorAll("img")).map(
    (img) => img.getAttribute("src") ?? "",
  );

const result = (
  prizeLabel: string,
  over: Partial<GachaStageResult> = {},
): GachaStageResult => ({
  prizeLabel,
  output: { kind: "builtin" },
  viewerName: null,
  rare: false,
  ...over,
});

/** 購読ハンドラ（`listenGachaStageResult` に渡されたもの）。 */
let handler: ((r: GachaStageResult) => void) | null = null;
/** 解除関数が呼ばれた回数。 */
let unlistenCalls = 0;

const deliver = (...results: GachaStageResult[]) => {
  if (handler === null) throw new Error("購読が張られていない");
  act(() => {
    for (const r of results) handler?.(r);
  });
};

const advance = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

describe("063c 段 2-a: ステージ窓のガチャ当選", () => {
  beforeEach(() => {
    localStorage.clear();
    handler = null;
    unlistenCalls = 0;
    mocks.connectCommentStream.mockReset();
    mocks.connectCommentStream.mockReturnValue({ disconnect: vi.fn() });
    mocks.listenGachaStageResult.mockReset();
    mocks.listenGachaStageResult.mockImplementation(
      (cb: (r: GachaStageResult) => void) => {
        handler = cb;
        return Promise.resolve(() => {
          unlistenCalls += 1;
        });
      },
    );
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.documentElement.removeAttribute("data-overlay");
  });

  /** ⚠ `listen` は Promise なので、購読が張られるまで 1 マイクロタスク待つ。 */
  const mount = async () => {
    const view = render(<EffectOverlayApp />);
    await act(async () => {
      await Promise.resolve();
    });
    return view;
  };

  /** ⚠ 抽選中 → 開封 を飛ばして「結果」まで進める。 */
  const toResult = () => advance(SPIN_MS + GACHA_OPEN_MS + TICK_SLACK_MS);
  /** ⚠ 当選 1 件を最後まで出し切る。 */
  const toEnd = () => advance(TOTAL_MS + TICK_SLACK_MS);

  it("⚠⚠ 受け取った当選が「抽選中 → 開封 → 結果」の順に出る", async () => {
    await mount();
    deliver(result("大当たり"));
    // 抽選中: ガチャマシンが出ていて、景品名はまだ出ない。
    expect(imgSrcs()).toContain(machine1Url);
    expect(screen.queryByText("大当たり")).toBeNull();

    // 開封: カプセルへ変わる（⚠ コマ送りの 1 コマ目に居るよう、余分に進めない）。
    advance(SPIN_MS);
    expect(imgSrcs()).toContain(capsule1Url);
    expect(imgSrcs()).not.toContain(machine1Url);
    expect(screen.queryByText("大当たり")).toBeNull();

    // 結果: ここで初めて景品名が出る。
    advance(GACHA_OPEN_MS + TICK_SLACK_MS);
    expect(screen.getByText("大当たり")).toBeInTheDocument();
    // ⚠⚠ 063c 段 5-b: **説明文は出ない**（景品名 1 行だけ）。
    expect(screen.queryByText(/当たりました/)).toBeNull();
  });

  /**
   * ⚠⚠ **「N ミリ秒進めたら N コマ目」と書かないこと。**
   * 時計の目盛り（一定間隔）とコマ送りの間隔は**割り切れる保証が無い**ので、
   * そう書くとどちらかの定数を変えた瞬間にテストだけが落ちる
   * （063c 段 2-c で実際に 120ms → 156ms へ変えて踏んだ）。
   * ⇒ **細かく進めて「出た順」を集め、順序だけを固定する。**
   *
   * ⚠⚠⚠ 最後が `machine-5` であることも同時に見る＝ **排出の絵が出て終わる**
   * （ここが回転のコマのままだと、カプセルが出てこないまま開封へ飛ぶ）。
   */
  it("⚠ 抽選中はマシンのコマが 1→2→3→4 と進み、最後は排出の絵で終わる", async () => {
    await mount();
    deliver(result("大当たり"));
    const seen: string[] = [];
    for (let t = 0; t < SPIN_MS; t += 20) {
      const src = imgSrcs().find((s) => s.includes("machine"));
      if (src !== undefined && seen[seen.length - 1] !== src) seen.push(src);
      advance(20);
    }
    expect(seen.slice(0, 4)).toEqual([
      machine1Url,
      machine2Url,
      machine3Url,
      machine4Url,
    ]);
    expect(seen[seen.length - 1]).toBe(machine5Url);
  });

  /**
   * ⚠⚠⚠ **063c 段 4: 見た目の設定は「当選が出始めた瞬間」に読む**（マウント時ではない）。
   * ⇒ **main 窓で変えた直後の 1 件目から効く**。
   * ⚠ このケースは同時に「**読み直している**」ことも固定している
   * （マウント時に 1 回だけ読む実装だと、ここがレッドになる）。
   */
  /**
   * ⚠⚠⚠ **3 つとも見る。** 1 つだけ見ていると
   * 「対応表の 1 行を別の値に書き換える」変異（例: `left` を中央のクラスにする）が**生き残る**
   * ——実際に変異テストで生存したので、`it.each` に変えた。
   */
  it.each([
    ["left", /gachaAlignLeft/],
    ["center", /gachaAlignCenter/],
    ["right", /gachaAlignRight/],
  ])(
    "⚠⚠ 位置の設定は当選が出るたびに読み直される: %s",
    async (id, expected) => {
      await mount();
      localStorage.setItem(GACHA_PLACEMENT_KEY, id);
      deliver(result("大当たり"));
      // ⚠ CSS モジュールのクラス名はハッシュ化されるので、**含まれること**で見る。
      const layer = document.querySelector("[class*='gachaLayer']");
      expect(layer?.className).toMatch(expected);
    },
  );

  /** ⚠ 3 つが**別々のクラス**であること（全部同じにする変異を殺す）。 */
  it("⚠⚠⚠ 3 つの位置はそれぞれ別のクラスになる", async () => {
    const seen: string[] = [];
    for (const id of ["left", "center", "right"]) {
      localStorage.setItem(GACHA_PLACEMENT_KEY, id);
      const view = await mount();
      deliver(result("大当たり"));
      const layer = document.querySelector("[class*='gachaLayer']");
      seen.push(layer?.className ?? "");
      view.unmount();
    }
    expect(new Set(seen).size).toBe(3);
  });

  it("⚠ 知らない位置が保存されていても中央に出る（壊れた値で消えない）", async () => {
    await mount();
    localStorage.setItem(GACHA_PLACEMENT_KEY, "top");
    deliver(result("大当たり"));
    const layer = document.querySelector("[class*='gachaLayer']");
    expect(layer?.className).toMatch(/gachaAlignCenter/);
  });

  /**
   * ⚠⚠⚠ **`style` へ届く色は「解決済みの CSS 色」だけである。**
   * ⚠ localStorage の中身がそのまま `style` へ届く経路を作らないための構えで、
   * **関門は [`parseGachaPrizeColor`] ただ 1 つ**（通る文法は `#` ＋ 16 進 6 桁のみ）。
   * ⚠⚠ 段 5-e レビュー Q-3 で訂正——旧記述の `gachaPrizeColorCss` は**段 5-e で消えた関数**である。
   *
   * ⚠ ここで `"sky"` を入れているのは、**段 4-b で保存された古い id の移行**を見るためである
   * （`parseGachaPrizeColor` の後半＝ `GACHA_PRIZE_COLORS` との突き合わせ）。
   * ⚠⚠ **黙って既定へ倒れていないこと**（`#ffd76a` ではなく `#7fd4ff` になること）が要点。
   */
  it("⚠⚠ 景品名の色の設定が演出へ届く（段 4-b の古い id も移行される）", async () => {
    await mount();
    localStorage.setItem(GACHA_PRIZE_COLOR_KEY, "sky");
    deliver(result("大当たり"));
    const stage = document.querySelector("[class*='gachaStage']");
    expect(
      (stage as HTMLElement).style.getPropertyValue("--gacha-prize-color"),
    ).toBe("#7fd4ff");
  });

  it("⚠⚠⚠ 壊れた色の設定でも、色が消えない（既定へ倒す）", async () => {
    await mount();
    localStorage.setItem(GACHA_PRIZE_COLOR_KEY, "red; background: url(x)");
    deliver(result("大当たり"));
    const stage = document.querySelector("[class*='gachaStage']");
    const color = (stage as HTMLElement).style.getPropertyValue(
      "--gacha-prize-color",
    );
    expect(color).toBe("#ffd76a");
  });

  it("何も受け取っていなければ 1 文字も出ない", async () => {
    await mount();
    expect(document.querySelector("[class*='gachaLayer']")).toBeNull();
  });

  it("⚠ 一定時間で消える", async () => {
    await mount();
    deliver(result("大当たり"));
    advance(TOTAL_MS - TICK_SLACK_MS);
    expect(screen.getByText("大当たり")).toBeInTheDocument();
    advance(TICK_SLACK_MS * 2);
    expect(screen.queryByText("大当たり")).toBeNull();
  });

  /**
   * ⚠⚠⚠ **後勝ちにしない**（063c (4) の決定）。
   * 上書きにすると、**課金してガチャを回した視聴者の当たりが直後の別の当たりに潰される**。
   */
  it("⚠⚠ 同時に届いた 2 件は 1 件ずつ順に出る（後勝ちで上書きしない）", async () => {
    await mount();
    deliver(result("1 個目"), result("2 個目"));
    toResult();
    expect(screen.getByText("1 個目")).toBeInTheDocument();
    expect(screen.queryByText("2 個目")).toBeNull();
    toEnd();
    expect(screen.queryByText("1 個目")).toBeNull();
    // ⚠⚠ **2 件目も演出の最初から始まる**（＝結果だけを出して終わらない）。
    expect(imgSrcs()).toContain(machine1Url);
    toResult();
    expect(screen.getByText("2 個目")).toBeInTheDocument();
    toEnd();
    expect(screen.queryByText("2 個目")).toBeNull();
  });

  it("⚠ 溢れたぶんは捨てる（古いほうを捨てない＝先に当たった人が先に出る）", async () => {
    await mount();
    deliver(result("A"), result("B"), result("C"), result("D"));
    for (const label of ["A", "B", "C"]) {
      toResult();
      expect(screen.getByText(label)).toBeInTheDocument();
      advance(TOTAL_MS);
    }
    // ⚠⚠ 4 件目は**キューに入っていない**（＝ A が押し出されていない）。
    toResult();
    expect(screen.queryByText("D")).toBeNull();
  });

  it("⚠⚠ 1 件出し終わると次を受け付けられる（キューが詰まらない）", async () => {
    await mount();
    deliver(result("A"), result("B"), result("C"), result("D"));
    toEnd();
    deliver(result("E"));
    toEnd();
    toEnd();
    toResult();
    expect(screen.getByText("E")).toBeInTheDocument();
  });

  /**
   * ⚠⚠ **2 件目以降でも CSS アニメーション（落下・ポップ）が再生されること**の裏付け。
   * 要素が作り直されていれば、ブラウザはアニメーションを頭から再生する。
   *
   * ⚠⚠⚠ **正直な限界（実測）: これは `key` を固定にする変異を殺せない。**
   * 当選と当選の間に「出すものが無い」レンダーが 1 回挟まって層ごとアンマウントされるため、
   * **`key` が無くても要素は作り直される**（＝ここで見えているのは `key` の効果ではない）。
   * ⚠ それでも `key={seq}` は残してある——**その中間レンダーが将来 React のバッチ化で
   * 消えたときに、初めて `key` が効く**（消えたことに気づく手段は無い）。
   * ⚠⚠ **jsdom は CSS アニメーションを実行しない**ので、ここから先は実機確認の担当である。
   */
  it("⚠⚠ 当選ごとに演出の要素が作り直される（2 件目もアニメーションが再生される）", async () => {
    await mount();
    deliver(result("1 個目"), result("2 個目"));
    // ⚠ CSS モジュールのクラス名はハッシュ付きなので前方一致で引く。
    const stage = () => document.querySelector("[class*='gachaStage']");
    const first = stage();
    expect(first).not.toBeNull();
    toEnd();
    const second = stage();
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
  });

  it("⚠⚠ アンマウントで購読が外れる（外れないと 1 件が 2 回キューに入る）", async () => {
    const { unmount } = await mount();
    unmount();
    expect(unlistenCalls).toBe(1);
  });

  /**
   * ⚠⚠ **「残っているタイマーが 0 本」では書けない**——jsdom / React 側にも
   * タイマーが在り、**最初のマウントで 1 回きりの 1 本が作られてそのまま残る**（実測）。
   * ⇒ **1 周期（マウント → 当選 → アンマウント）で増えた本数が 0 本**であることを見る。
   * ⚠ 1 周目をウォームアップに使うのは、その「1 回きりの 1 本」を先に作らせるためである。
   * ⚠⚠ これで `clearTimeout` を消す変異だけが確実にレッドになる（実測でも 1 本残る）。
   */
  it("⚠⚠ アンマウントでタイマーが残らない（配信中にタイマーを残さない・判断 11）", async () => {
    const cycle = async (withResult: boolean): Promise<number> => {
      const before = vi.getTimerCount();
      const view = await mount();
      if (withResult) deliver(result("大当たり"));
      view.unmount();
      return vi.getTimerCount() - before;
    };
    await cycle(false);
    expect(await cycle(true)).toBe(0);
  });

  it("⚠ 当選が出たらセットアップ用ガイドを畳む（実物が出た時点で役目が終わる）", async () => {
    localStorage.setItem(EFFECT_OVERLAY_GUIDE_PENDING_KEY, "true");
    await mount();
    expect(
      screen.getByText(/この枠に配信画面用のエフェクトが表示されます/),
    ).toBeInTheDocument();
    deliver(result("大当たり"));
    expect(
      screen.queryByText(/この枠に配信画面用のエフェクトが表示されます/),
    ).toBeNull();
  });

  /**
   * ⚠⚠⚠ **この層は OBS のキャプチャに映る＝視聴者に読める**ので、
   * 「そのソースが OBS に見つかりません」のような**技術的なエラーを出さない**
   * （063c レビュー Q-12 追記 2 の決定）。警告の持ち主は設定画面（`GachaPrizeTable`）1 か所である。
   */
  it("⚠⚠⚠ OBS ソースを指す当選でも、エラー文言を配信画面に出さない", async () => {
    await mount();
    deliver(
      result("大当たり", {
        output: { kind: "obs-source", sourceName: "きらきら演出" },
      }),
    );
    toResult();
    expect(screen.getByText("大当たり")).toBeInTheDocument();
    // ⚠ ソース名そのものも出さない（出るのは景品の表示名だけ）。
    expect(screen.queryByText(/きらきら演出/)).toBeNull();
    expect(screen.queryByText(/見つかりません/)).toBeNull();
    expect(screen.queryByText(/エラー/)).toBeNull();
  });

  it("⚠⚠ この窓は抽選をしない（受け取った表示名をそのまま出す）", async () => {
    await mount();
    deliver(result("ぴったりこの文字列"));
    toResult();
    expect(screen.getByText("ぴったりこの文字列")).toBeInTheDocument();
  });

  it("⚠ 購読の解決前にアンマウントされても購読が漏れない", async () => {
    let resolveListen: ((fn: () => void) => void) | null = null;
    mocks.listenGachaStageResult.mockImplementation(() => {
      return new Promise<() => void>((resolve) => {
        resolveListen = resolve;
      });
    });
    const { unmount } = render(<EffectOverlayApp />);
    unmount();
    await act(async () => {
      resolveListen?.(() => {
        unlistenCalls += 1;
      });
      await Promise.resolve();
    });
    expect(unlistenCalls).toBe(1);
  });
});
