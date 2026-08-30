import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import {
  GACHA_LIBRARY_KEY,
  OBS_SOURCE_LIST_KEY,
} from "../../features/comment-viewer/overlaySettings";
import { useState } from "react";
import { EffectAssignmentCard } from "./EffectAssignmentCard";
import { GachaLibraryCard } from "./GachaLibraryCard";
import {
  GACHA_PRIZE_MAX,
  runGachaMigration,
  saveGachaLibrary,
  type GachaDefinition,
} from "./effectAssignments";
import { loadObsSourceList } from "../../features/comment-viewer/overlaySettings";
import { EFFECT_EVENT_LABEL } from "./effectEventRows";

/**
 * ⚠⚠ **`ObsEffectsScreen` そのものは描かない。**
 * あの画面は前提ステータスのために Tauri の `invoke` を叩く effect を持っており、
 * ここで描くと**未処理 rejection が毎ケース出る**（テストは緑のまま、ログだけが汚れる）。
 * ⇒ **ガチャに関する配線だけ**を同じ形で再現する
 * （状態は画面が持ち、条件カードと一覧カードの両方へ配る＝`ObsEffectsScreen` と同じ役割分担）。
 * ⚠ **配線そのもの**（共通の下部に置く／同じ一覧を両方が読む）は
 * `ObsEffectsScreen.test.tsx` が別に固定している。
 */
const Harness = () => {
  const [gachas, setGachas] = useState<readonly GachaDefinition[]>(() =>
    runGachaMigration(),
  );
  return (
    <>
      <EffectAssignmentCard gachas={gachas} />
      <GachaLibraryCard
        gachas={gachas}
        obsSources={loadObsSourceList()?.sources ?? null}
        onChange={(next) => setGachas(saveGachaLibrary(next))}
        /* ⚠ 063f 段 1-b: 「高度な設定」は**このファイルの関心ではない**（景品の表を見ている）。
           ⚠⚠ 既定どおり OFF・親も OFF で固定する＝**この画面から 1 通も出ない状態**。 */
        chatEnabled={false}
        onChatEnabledChange={() => {}}
        /* ⚠⚠ 063c 段 4-d: **演出まわりの props は無くなった**（`GachaStageCard` へ出たため）。
           このファイルの関心は**景品の表**なので、あちらは描かない
           （描くとプレビューのタイマーが回り、景品表の検査に無関係な時間依存が入る）。 */
      />
    </>
  );
};

/**
 * 063a: **ガチャの表**（景品名・出る確率・当たったら）の仕様テスト。
 *
 * ⚠⚠ **この 1 ファイルが固定している最重要の不変条件は 4 つ。**
 *
 * ① ⚠⚠ **「条件を追加」に相当する操作が無い**——行を足す＝景品を足す、だけ
 *    （要望⑦の芯そのもの。ボタンは「景品を追加」1 つで、途中に確定操作が挟まらない）。
 * ② ⚠⚠⚠ **入力した％が補正されない**（063a-3 の芯・各行が独立）。
 * ③ ⚠⚠ **OBS 側に無いソース名は警告される**（064b と同じ文・黙って別のソースへ化けない）。
 * ④ ⚠⚠ **§9: テスト抽選の結果は 1 バイトも保存されない**。
 *
 * ⚠⚠⚠ **063d で入口が変わった。** 063a では「条件行の割り当てをガチャにすると、その行の下に
 * 表が開く」形だったが、063d で**ガチャ本体が一覧（`GachaLibraryCard`）へ移った**ので、
 * ⇒ このテストは **`ObsEffectsScreen` 越しに「ガチャを作る」→「景品を編集」** で表を触る
 * （＝実際の導線と同じ経路を通る、という方針は 063a から変えていない）。
 * ⚠ **表の中身（`GachaPrizeTable`）は 1 行も変えていない**ので、各 `it` の中身も無改変である。
 *
 * テストは外部通信も OS 操作も IPC も行わない（localStorage だけの純粋な画面）。
 */

const OBS_SOURCE_A = "きらきら演出";
const OBS_SOURCE_B = "紙吹雪";

const putObsSources = (names: string[] = [OBS_SOURCE_A, OBS_SOURCE_B]) =>
  localStorage.setItem(
    OBS_SOURCE_LIST_KEY,
    JSON.stringify({
      at: 1_700_000_000_000,
      sources: names.map((name) => ({ name, kind: "ffmpeg_source" })),
    }),
  );

/**
 * ⚠ 063d: `labelPrefix` は**ガチャ名**になった（063a では条件名だった）。
 * `GachaLibraryCard` が最初に作るガチャの既定名と同じ文字列。
 */
const PREFIX = "新しいガチャ 1";

const nameInput = (n: number) =>
  screen.getByLabelText(`${PREFIX} 景品 ${n} の名前`) as HTMLInputElement;
const percentInput = (n: number) =>
  screen.getByLabelText(`${PREFIX} 景品 ${n} の出る確率`) as HTMLInputElement;
// ⚠ 063c 段 2-a: アクセシブル名を「OBS のソース」から「当たったら」へ広げた
//   （選べるものが**組み込みの演出**と **OBS のソース**の 2 種類になったので、旧名は片方しか指さない）。
const sourceSelect = (n: number) =>
  screen.getByLabelText(
    `${PREFIX} 景品 ${n} の当たったら`,
  ) as HTMLSelectElement;

// ⚠⚠ レビュー Q-063a-7: この 2 つのボタンも **`labelPrefix` 付き**である
//   （付けないとガチャを 2 つ開いた瞬間に同名のボタンが 2 個になる）。
const addPrizeButton = () =>
  screen.getByRole("button", { name: `${PREFIX} 景品を追加` });
const testDrawButton = () =>
  screen.getByRole("button", { name: `${PREFIX} テスト抽選` });

/** レビュー Q-063a-1: ％を受け付けなかったときに出る理由（`PERCENT_INVALID_TEXT` と同じ文）。 */
const REASON = "0.1〜100 の数字で入れてください（例: 10）。";
const reasonText = () => screen.getByText(REASON);

/**
 * 保存値から**最初のガチャ**を読む（⚠ 生の JSON を読む）。
 * ⚠⚠ 063d: 読む先が `EFFECT_ASSIGNMENTS_KEY` から [`GACHA_LIBRARY_KEY`] に変わった
 * （ガチャ本体は条件ではなく一覧が持つ）。
 */
/**
 * ⚠⚠ 063c 段 2-a: **旧形式（`sourceName` 直付け）と新形式（`output`）の両方を表せる形**にした。
 * ⚠ 仕込み（`seedGacha`）は**旧形式のまま**にしてあるので、
 * 画面越しに `parseGachaPrizeOutput` の後方互換が毎回通る。
 */
interface StoredPrize {
  name: string;
  weight: number;
  sourceName?: string;
  output?: { kind: "builtin" } | { kind: "obs-source"; sourceName: string };
}
const storedGacha = ():
  { id: string; name: string; prizes?: StoredPrize[] } | undefined => {
  const raw = localStorage.getItem(GACHA_LIBRARY_KEY);
  if (raw === null) return undefined;
  return (JSON.parse(raw) as GachaDefinition[])[0] as unknown as {
    id: string;
    name: string;
    prizes?: StoredPrize[];
  };
};

/** 保存されている景品の配列（⚠ 生の JSON）。 */
const storedPrizes = (): StoredPrize[] => storedGacha()?.prizes ?? [];

/**
 * ⚠ 063d: 保存済みのガチャを 1 件仕込んで開く（＝「前に作ってあった」状況を作る）。
 * ⚠⚠ 仕込む先は [`GACHA_LIBRARY_KEY`]（063a は条件のキーに直付けしていた）。
 */
const seedGacha = (prizes: StoredPrize[]) => {
  localStorage.setItem(
    GACHA_LIBRARY_KEY,
    JSON.stringify([{ id: "g:1", name: PREFIX, prizes }]),
  );
};
/** 仕込んだガチャの景品表を開く。 */
const openSeededGacha = () =>
  fireEvent.click(
    screen.getByRole("button", { name: `${PREFIX} の景品を編集` }),
  );

/** ⚠ 063d: ガチャを 1 つ作る（作ると自動で開く）。 */
const createGacha = () => {
  fireEvent.click(screen.getByRole("button", { name: "ガチャを作る" }));
};

/** ガチャを作って、景品を `count` 件足す。⚠ **足す操作はボタン 1 つだけ**であることを含意する。 */
const openGachaWithPrizes = (count: number) => {
  createGacha();
  for (let i = 0; i < count; i++) fireEvent.click(addPrizeButton());
};

/** 景品 n の**出る確率（％）**を入れて確定する（⚠ 確定は blur・061j 穴 α と同じ）。 */
const setPercent = (n: number, value: string) => {
  fireEvent.change(percentInput(n), { target: { value } });
  fireEvent.blur(percentInput(n));
};

/** 各行の入力欄に出ている％。 */
const percentValues = (): string[] =>
  screen
    .getAllByRole("spinbutton")
    .filter((el) => (el.getAttribute("aria-label") ?? "").includes("出る確率"))
    .map((el) => (el as HTMLInputElement).value);

/** 合計行の％。 */
const totalText = (): string =>
  screen.getByText(/^\d+\.\d%$/).textContent ?? "";
/** 「何も出ない: X%」／「ちょうど 100%」の表示。 */
const missText = (): string =>
  screen.getByText(/^(何も出ない: |ちょうど 100%)/).textContent ?? "";

describe("GachaPrizeTable（063a）", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  // --- ① 表 1 枚で完結する ---------------------------------------------------------------------

  it("⚠⚠ ガチャを作ると表が開き、景品 0 件では「景品がありません」が出る", () => {
    putObsSources();
    render(<Harness />);
    createGacha();
    expect(screen.getByText("景品がありません。")).toBeInTheDocument();
    // ⚠⚠ 063d: 景品 0 件でも**一覧に残る**（作った直後に消えると「押したのに増えない」になる）。
    expect(storedGacha()).toEqual({ id: "g:1", name: PREFIX, prizes: [] });
  });

  /**
   * ⚠⚠⚠ **ミューテーション M7 が生存したので足した 1 本**（061h ⑦-c とまったく同型の穴）。
   *
   * `effectSelectValue` の gacha 分岐を消しても、**表そのものは描かれ続ける**
   * （表は一覧側に開くので、条件の `<select>` の値とは別経路だから）。
   * ⇒ 表が出ていることだけを見ていると、**`<select>` が「エフェクトを出さない」を指したまま
   * ガチャが割り当たっている**という状態を検知できない。⚠ その状態は
   * 「ガチャを設定したのに、開き直すと『出さない』に見える」＝ユーザーが**設定が消えたと誤解する**。
   * ⚠ **値のアサーションを消さないこと。**
   *
   * ⚠⚠ 063d: 指す先が `"gacha"`（固定）から **`gacha:<id>`** になった。
   */
  it("⚠⚠ 条件にガチャを割り当てると `<select>` が `gacha:<id>` を指す（作り直しても同じ）", () => {
    putObsSources();
    const view = render(<Harness />);
    createGacha();
    const select = screen.getByLabelText(
      `${EFFECT_EVENT_LABEL.superchat}のエフェクト`,
    ) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "gacha:g:1" } });
    expect(select.value).toBe("gacha:g:1");
    // ⚠ 画面を作り直しても保存値から復元される。
    view.unmount();
    render(<Harness />);
    expect(
      (
        screen.getByLabelText(
          `${EFFECT_EVENT_LABEL.superchat}のエフェクト`,
        ) as HTMLSelectElement
      ).value,
    ).toBe("gacha:g:1");
  });

  it("⚠⚠ 「景品を追加」を押すだけで行が足せる（＝『条件を追加』に相当する操作が無い）", () => {
    putObsSources();
    render(<Harness />);
    openGachaWithPrizes(3);
    expect(nameInput(1)).toBeInTheDocument();
    expect(nameInput(3)).toBeInTheDocument();
    // ⚠ 押した瞬間に保存できる行になっている（未確定行の仕組みを持ち込んでいない）。
    expect(storedGacha()?.prizes).toHaveLength(3);
    // ⚠⚠⚠ **063a-3: 新しい行は末尾に既定 10% で入り、他の行には 1 ミリも触らない。**
    expect(storedGacha()?.prizes?.map((p) => p.weight)).toEqual([
      100, 100, 100,
    ]);
    expect(percentValues()).toEqual(["10", "10", "10"]);
    expect(missText()).toBe("何も出ない: 70.0%");
  });

  /**
   * ⚠⚠⚠ **063c 段 2-a（穴 γ）で意図的に反転させたケース**
   * （旧題「⚠ OBS の一覧が無いと景品を追加できない（押せない理由も出す）」）。
   *
   * ⚠ **旧ケースは仕様そのものが逆になった**——「鳴らすものが無い状態から始まる」を解消するのが
   * 063 の目的なのに、**OBS を 1 度も起動していないと景品を作れない**のが旧仕様だった。
   * ⚠⚠ **案内文を消したのではなく差し替えた**ので、その 1 文もここで固定する
   * （061a Q-1＝黙って選べない状態を作らない）。旧文が復活したら落ちる。
   */
  it("⚠⚠⚠ 穴 γ: OBS の一覧が無くても景品を追加できる（既定は組み込みの演出）", () => {
    render(<Harness />);
    createGacha();
    expect(addPrizeButton()).toBeEnabled();
    // ⚠ 旧文（＝押せない理由）は二度と出ない。
    expect(
      screen.queryByText(
        "景品を追加するには、先に OBS のソースを取得してください。",
      ),
    ).toBeNull();
    // ⚠ 代わりに「まだ選べないものがある理由」を出す。
    expect(
      screen.getByText(
        "「当たったら」で OBS のソースを選ぶには、先に OBS のソースを取得してください。いまは組み込みの演出だけが選べます。",
      ),
    ).toBeInTheDocument();

    fireEvent.click(addPrizeButton());
    // ⚠⚠ 足した行は**組み込み**（一覧の先頭に黙って結び付かない）。
    expect(sourceSelect(1).value).toBe("builtin");
    expect(storedPrizes()).toEqual([
      { name: "", weight: 100, output: { kind: "builtin" } },
    ]);
  });

  /**
   * ⚠⚠ **063a-2 にあった「残りが足りないと追加できない」は、063a-3 で概念ごと消えた。**
   * ⚠ **063c 段 2-a 訂正: 足せない理由は「上限」だけ**になった（穴 γ・上のケースが正）。
   * ⚠ 代わりに「**足しても他の行が変わらない**」を固定する（ここが 063a-2 との違いそのもの）。
   */
  it("⚠⚠⚠ 景品を足しても、既にある行の％は 1 ミリも変わらない", () => {
    putObsSources();
    render(<Harness />);
    openGachaWithPrizes(1);
    setPercent(1, "55");
    fireEvent.click(addPrizeButton());
    expect(percentValues()[0]).toBe("55");
    expect(storedGacha()?.prizes?.map((p) => p.weight)).toEqual([550, 100]);
  });

  it("⚠ 景品は上限まで（上限に達したら追加ボタンが押せず、理由が出る）", () => {
    putObsSources();
    render(<Harness />);
    // ⚠ 063a-3 では「残り」が尽きて足せなくなることは**もう無い**（各行が独立し、超過は
    //   合計行の赤字で伝えるだけ）。それでも足すたびに 1% へ下げているのは、
    //   **20 行を既定 10% のまま並べると合計 200% の異常な状態でテストが進んでしまう**ためで、
    //   ⚠ ここで見たいのは「**上限に達したら押せなくなり、理由が出る**」ことだけである。
    createGacha();
    fireEvent.click(addPrizeButton());
    for (let n = 2; n <= GACHA_PRIZE_MAX; n++) {
      fireEvent.click(addPrizeButton());
      setPercent(n - 1, "1");
    }
    expect(storedGacha()?.prizes).toHaveLength(GACHA_PRIZE_MAX);
    expect(addPrizeButton()).toBeDisabled();
    expect(
      screen.getByText(`景品は ${GACHA_PRIZE_MAX} 個までです。`),
    ).toBeInTheDocument();
  });

  // --- ② 確率の自動計算 -------------------------------------------------------------------------

  it("⚠⚠ ％をそのまま入力できる（10% / 30% と入れると合計 40.0%・残りは「何も出ない」）", () => {
    putObsSources();
    render(<Harness />);
    openGachaWithPrizes(2);
    setPercent(1, "10");
    setPercent(2, "30");
    expect(percentValues()).toEqual(["10", "30"]);
    expect(totalText()).toBe("40.0%");
    expect(missText()).toBe("何も出ない: 60.0%");
    expect(storedGacha()?.prizes?.map((p) => p.weight)).toEqual([100, 300]);
  });

  /**
   * ⚠⚠⚠ **依頼者の指摘（2026-08-22）で入れ替えた 1 本。**
   * 063a-2 は「他の行との合計が 100% を超える入力を、直前の値へ戻す」形だった。
   * ⇒ **入力の順番に依存し**（先に下げないと上げられない）、**戻った理由も画面に出ない**
   * ＝「**フォーム側が補正されるからめっちゃ使いにくい**」。
   * ⚠ **入力をブロックする形へ戻さないこと。**
   */
  it("⚠⚠⚠ 合計が 100% を超えても入力は戻らない（打った数字がそのまま残る）", () => {
    putObsSources();
    render(<Harness />);
    openGachaWithPrizes(2);
    setPercent(1, "80");
    setPercent(2, "70");
    // ⚠⚠ **どちらも打ったとおりに残る**（片方が 10 に戻されたりしない）。
    expect(percentValues()).toEqual(["80", "70"]);
    expect(storedGacha()?.prizes?.map((p) => p.weight)).toEqual([800, 700]);
  });

  it("⚠⚠ 超過は赤字で伝え、テスト抽選だけ止める（直し方も書く）", () => {
    putObsSources();
    render(<Harness />);
    openGachaWithPrizes(2);
    setPercent(1, "80");
    setPercent(2, "70");
    expect(totalText()).toBe("150.0%");
    expect(screen.getByText(/合計が 50\.0% 多いです/)).toBeInTheDocument();
    expect(
      screen.getByText(/どれかの確率を下げてください/),
    ).toBeInTheDocument();
    expect(testDrawButton()).toBeDisabled();
    // ⚠ 下げれば直る（＝直し方が画面のとおりに効く）。
    setPercent(2, "20");
    expect(screen.queryByText(/多いです/)).not.toBeInTheDocument();
    expect(testDrawButton()).toBeEnabled();
  });

  it("⚠⚠⚠ 入力の順番に依存しない（先に上げてから下げられる）", () => {
    putObsSources();
    render(<Harness />);
    openGachaWithPrizes(3);
    // ⚠ 063a-2 では 1 行目を 90 にした時点で戻されていた（他の行が 10+10 あるため）。
    setPercent(1, "90");
    expect(percentValues()[0]).toBe("90");
    setPercent(2, "5");
    setPercent(3, "5");
    expect(percentValues()).toEqual(["90", "5", "5"]);
    expect(missText()).toBe("ちょうど 100%");
  });

  it("⚠ 0.1% 刻みで入れられる（1% の激レアが作れる）", () => {
    putObsSources();
    render(<Harness />);
    openGachaWithPrizes(1);
    setPercent(1, "0.1");
    expect(percentValues()).toEqual(["0.1"]);
    expect(storedGacha()?.prizes?.map((p) => p.weight)).toEqual([1]);
  });

  it("⚠⚠ 0% / 負 / 数値でない / 100% 超は受け付けない（その行だけで成立しない値）", () => {
    putObsSources();
    render(<Harness />);
    openGachaWithPrizes(1);
    setPercent(1, "25");
    for (const bad of ["0", "-1", "", "abc", "0.04", "101"]) {
      setPercent(1, bad);
      expect(storedGacha()?.prizes?.[0]?.weight).toBe(250);
    }
    // ⚠ 100% ちょうどは受け付ける（1 行だけのガチャ）。
    setPercent(1, "100");
    expect(storedGacha()?.prizes?.[0]?.weight).toBe(1000);
  });

  /**
   * ⚠⚠⚠ **レビュー Q-063a-1 で足した 1 本。**
   *
   * 上の 1 本は「受け付けない」ことだけを固定していて、**黙って戻っていた**。
   * 063a-2 が捨てられた理由の 1 つが「**戻された理由が画面に出ない**」ことだったので、
   * **戻すなら必ず理由を出す**ことをここで固定する（061a Q-1）。
   * ⚠ **合計の超過はここに入れない**——あれは受け付けたうえで合計行の赤字で伝える（下の 1 本が正）。
   */
  it("⚠⚠⚠ 受け付けなかったときは理由が画面に出る（黙って元の値へ戻さない）", () => {
    putObsSources();
    render(<Harness />);
    openGachaWithPrizes(1);
    setPercent(1, "25");

    // ⚠ `"abc"` は `type="number"` が空文字へ正規化するので、空欄と同じ経路で落ちる
    //   （＝理由の文が 1 本しかないのはこのため。`PERCENT_INVALID_TEXT` の注記が正）。
    for (const bad of ["0", "-1", "", "abc", "0.04", "101"]) {
      setPercent(1, bad);
      expect(reasonText()).toBeInTheDocument();
      expect(storedGacha()?.prizes?.[0]?.weight).toBe(250);
    }

    // ⚠ 受け付けたら理由は消える（古い理由が正しい値に付いて残らない）。
    setPercent(1, "30");
    expect(storedGacha()?.prizes?.[0]?.weight).toBe(300);
    expect(screen.queryByText(REASON)).not.toBeInTheDocument();

    // ⚠ 打ち直し始めた時点でも消える（新しい入力に古い理由が付かない）。
    setPercent(1, "999");
    expect(reasonText()).toBeInTheDocument();
    fireEvent.change(percentInput(1), { target: { value: "5" } });
    expect(screen.queryByText(REASON)).not.toBeInTheDocument();
  });

  /**
   * ⚠⚠⚠ **レビュー Q-063a-6 で足した 1 本。**
   *
   * ドラフトも React の `key` も **index で引いている**ので、並べ替え・削除で index の指す
   * 景品が変わると**未確定の入力が別の行へ書き込まれ得る**。現状これを踏まないのは
   * 「ボタンを押す前に必ず `blur` が走る」という**暗黙の前提**のおかげなので、
   * ⚠ **前提が崩れても壊れない**ことを固定する（＝ blur を起こさずに並べ替える）。
   */
  it("⚠⚠ 未確定の入力は並べ替え・削除で破棄される（別の行へ書き込まれない）", () => {
    putObsSources();
    render(<Harness />);
    openGachaWithPrizes(2);
    setPercent(1, "10");
    setPercent(2, "20");

    // ⚠ **blur させずに**（＝確定させずに）1 行目を打ちかけたまま並べ替える。
    fireEvent.change(percentInput(1), { target: { value: "99" } });
    fireEvent.click(screen.getByLabelText(`${PREFIX} 景品 1 を下へ`));

    // ⚠⚠ 打ちかけの 99 は**どの行にも入らない**（並びだけが入れ替わる）。
    expect(storedGacha()?.prizes?.map((p) => p.weight)).toEqual([200, 100]);
    expect(percentValues()).toEqual(["20", "10"]);
  });

  it("⚠⚠ 画面に「重み」という言葉が出ない（たぬえさの用語をそのまま出さない）", () => {
    putObsSources();
    render(<Harness />);
    openGachaWithPrizes(2);
    expect(screen.queryByText(/重み/)).not.toBeInTheDocument();
    for (const el of screen.getAllByRole("spinbutton")) {
      expect(el.getAttribute("aria-label") ?? "").not.toContain("重み");
    }
  });

  it("⚠⚠ 合計行は**実際の合計**を出す（063a-2 の固定表記「100%」はやめた）", () => {
    putObsSources();
    render(<Harness />);
    openGachaWithPrizes(3);
    // ⚠⚠ 固定表記だと「足りていない」ことが読めない＝**はずれの割合が見えない**。
    expect(totalText()).toBe("30.0%");
    expect(missText()).toBe("何も出ない: 70.0%");
  });

  // --- 名前・並べ替え・削除 ---------------------------------------------------------------------

  it("⚠ 景品名は任意（空欄のまま保存でき、表示は OBS のソース名で代替する）", () => {
    putObsSources();
    render(<Harness />);
    openGachaWithPrizes(1);
    expect(storedGacha()?.prizes?.[0]?.name).toBe("");
    fireEvent.change(nameInput(1), { target: { value: "大当たり" } });
    fireEvent.blur(nameInput(1));
    expect(storedGacha()?.prizes?.[0]?.name).toBe("大当たり");
  });

  it("⚠ 景品を並べ替えられる／削除できる", () => {
    putObsSources();
    render(<Harness />);
    openGachaWithPrizes(2);
    fireEvent.change(nameInput(1), { target: { value: "A" } });
    fireEvent.blur(nameInput(1));
    fireEvent.change(nameInput(2), { target: { value: "B" } });
    fireEvent.blur(nameInput(2));
    expect(storedGacha()?.prizes?.map((p) => p.name)).toEqual(["A", "B"]);

    fireEvent.click(
      screen.getByRole("button", { name: `${PREFIX} 景品 2 を上へ` }),
    );
    expect(storedGacha()?.prizes?.map((p) => p.name)).toEqual(["B", "A"]);

    // ⚠ 景品の削除ボタンは**行ごとに一意なアクセシブル名**を持つ（キーワード行の「削除」と混ざらない）。
    fireEvent.click(
      screen.getByRole("button", { name: `${PREFIX} 景品 1 を削除` }),
    );
    expect(storedGacha()?.prizes?.map((p) => p.name)).toEqual(["A"]);
  });

  // --- ③ OBS 側に無いソース --------------------------------------------------------------------

  it("⚠⚠ OBS 側に無いソース名は警告が出る（黙って別のソースへ化けない）", () => {
    // ⚠ 一覧に無い名前を持つ景品を保存済みにしてから開く（＝OBS 側で名前を変えた状況）。
    seedGacha([{ name: "消えた", weight: 1, sourceName: "むかしの演出" }]);
    putObsSources([OBS_SOURCE_A]);
    render(<Harness />);
    openSeededGacha();
    expect(
      screen.getByText(
        "OBS にこの名前のソースが見つかりません。名前を変えた場合は選び直してください。",
      ),
    ).toBeInTheDocument();
    // ⚠⚠ 値が先頭の選択肢へ化けていないこと（`<option>` を自前で足している理由そのもの）。
    expect(sourceSelect(1).value).toBe("obs:むかしの演出");
    expect(
      within(sourceSelect(1))
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toContain("むかしの演出");
  });

  /**
   * ⚠⚠⚠ **063c 段 2-a: 「当たったら」で組み込みと OBS のソースを選び分けられる。**
   *
   * ⚠ 061h が全廃した組み込み演出を**部分的に戻す**ぶん、
   * 「**上書きを設定したのに組み込みが出る**」を作らないことが要件である
   * （[`GachaPrizeOutput`] の注記が正）。⇒ **選んだものがそのまま保存される**ことを固定する。
   */
  it("⚠⚠ 組み込み → OBS のソース → 組み込み と往復できる（選んだものがそのまま保存される）", () => {
    putObsSources();
    render(<Harness />);
    openGachaWithPrizes(1);
    expect(sourceSelect(1).value).toBe("builtin");

    fireEvent.change(sourceSelect(1), {
      target: { value: `obs:${OBS_SOURCE_B}` },
    });
    expect(storedPrizes()[0].output).toEqual({
      kind: "obs-source",
      sourceName: OBS_SOURCE_B,
    });

    fireEvent.change(sourceSelect(1), { target: { value: "builtin" } });
    expect(storedPrizes()[0].output).toEqual({ kind: "builtin" });
  });

  it("⚠ 「組み込みの演出」は一覧が 0 件でも選択肢に在る（先頭）", () => {
    render(<Harness />);
    openGachaWithPrizes(1);
    const options = within(sourceSelect(1))
      .getAllByRole("option")
      .map((o) => (o as HTMLOptionElement).value);
    expect(options[0]).toBe("builtin");
  });

  it("⚠⚠⚠ 組み込みの景品に「OBS に見つかりません」を出さない（照合する対象が無い）", () => {
    putObsSources([OBS_SOURCE_A]);
    render(<Harness />);
    openGachaWithPrizes(1);
    expect(sourceSelect(1).value).toBe("builtin");
    expect(
      screen.queryByText(
        "OBS にこの名前のソースが見つかりません。名前を変えた場合は選び直してください。",
      ),
    ).toBeNull();
  });

  it("⚠⚠ 旧形式（sourceName 直付け）の景品は OBS のソースとして開く（後方互換）", () => {
    seedGacha([{ name: "むかし", weight: 1, sourceName: OBS_SOURCE_A }]);
    putObsSources();
    render(<Harness />);
    openSeededGacha();
    expect(sourceSelect(1).value).toBe(`obs:${OBS_SOURCE_A}`);
  });

  it("⚠ 一覧をまだ取っていないときは「無い」と断言しない（064b と同じ規律）", () => {
    seedGacha([{ name: "x", weight: 1, sourceName: OBS_SOURCE_A }]);
    render(<Harness />);
    openSeededGacha();
    expect(
      screen.queryByText(
        "OBS にこの名前のソースが見つかりません。名前を変えた場合は選び直してください。",
      ),
    ).not.toBeInTheDocument();
  });

  // --- ④ テスト抽選（穴 E） ---------------------------------------------------------------------

  it("⚠⚠ テスト抽選の結果は画面に出るだけで、OBS を鳴らさず、保存もされない（§9）", () => {
    putObsSources();
    render(<Harness />);
    openGachaWithPrizes(2);
    fireEvent.change(nameInput(1), { target: { value: "大当たり" } });
    fireEvent.blur(nameInput(1));
    fireEvent.change(nameInput(2), { target: { value: "はずれ" } });
    fireEvent.blur(nameInput(2));

    vi.spyOn(Math, "random").mockReturnValue(0);
    fireEvent.click(testDrawButton());
    expect(screen.getByText(/結果: 大当たり/)).toBeInTheDocument();

    // ⚠⚠ **どの localStorage キーにも結果が入らない**（抽選履歴・当選者を保存しない）。
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i) ?? "";
      const value = localStorage.getItem(key) ?? "";
      expect(value).not.toContain("結果");
      expect(value).not.toContain("テスト抽選");
    }
    // ⚠ 割り当ての保存値は景品の定義だけ（履歴のフィールドが生えていない）。
    // ⚠⚠ 063d: 保存されるのは **id / name / prizes の 3 つだけ**（履歴も当選者も入らない）。
    expect(Object.keys(storedGacha() ?? {})).toEqual(["id", "name", "prizes"]);
  });

  it("⚠ テスト抽選は累計の内訳を出す（1 回では確率の体感が確かめられないため）", () => {
    putObsSources();
    render(<Harness />);
    openGachaWithPrizes(2);
    fireEvent.change(nameInput(1), { target: { value: "当たり" } });
    fireEvent.blur(nameInput(1));
    fireEvent.change(nameInput(2), { target: { value: "はずれ" } });
    fireEvent.blur(nameInput(2));

    // ⚠ 合計 100% にしてから引く（そうしないと「何も出ない」が混ざる）。
    setPercent(1, "50");
    setPercent(2, "50");
    vi.spyOn(Math, "random").mockReturnValue(0);
    fireEvent.click(testDrawButton());
    fireEvent.click(testDrawButton());
    vi.spyOn(Math, "random").mockReturnValue(0.9);
    fireEvent.click(testDrawButton());
    expect(screen.getByText(/テスト抽選 3 回:/)).toHaveTextContent(
      /当たり 2.*はずれ 1/,
    );
  });

  it("⚠⚠⚠ どれにも当たらなかったら「何も出ない」と出る（黙って無反応にしない）", () => {
    putObsSources();
    render(<Harness />);
    openGachaWithPrizes(1);
    setPercent(1, "10");
    vi.spyOn(Math, "random").mockReturnValue(0.9);
    fireEvent.click(testDrawButton());
    expect(screen.getByText(/結果: 何も出ない/)).toBeInTheDocument();
  });

  it("⚠ 景品 0 件ではテスト抽選を押せない", () => {
    putObsSources();
    render(<Harness />);
    createGacha();
    expect(testDrawButton()).toBeDisabled();
  });

  // --- 前方互換・他の条件行 ---------------------------------------------------------------------

  /**
   * ⚠⚠⚠ **063d で意味が変わった 1 本**（旧: 「ガチャはキーワード条件の行にも同じように開く」）。
   *
   * 063a では条件行の下に表が開いたので、「イベント行とキーワード行が 1 実装を共有する」ことを
   * ここで固定していた。⚠ 063d で**表は一覧側の 1 か所だけ**になったので、その論点は消えた。
   * ⇒ 代わりに、**同じ規律が守っている本体**——`labelPrefix` が
   * **ガチャごとに違い、2 つ目を開いても取り違えない**——を固定する（レビュー Q-063a-7 と同型）。
   */
  it("⚠⚠ 2 つ目のガチャを開いても、景品の入力欄を取り違えない（labelPrefix がガチャ名）", () => {
    putObsSources();
    render(<Harness />);
    // 1 つ目を作って景品を 1 件入れる。
    openGachaWithPrizes(1);
    setPercent(1, "40");
    // 2 つ目を作る（⚠ 作ると自動で開き、1 つ目は閉じる＝同時に 1 つだけ）。
    createGacha();
    expect(screen.getByLabelText("新しいガチャ 2 の名前")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "新しいガチャ 2 景品を追加" }),
    );
    fireEvent.change(
      screen.getByLabelText("新しいガチャ 2 景品 1 の出る確率"),
      { target: { value: "5" } },
    );
    fireEvent.blur(screen.getByLabelText("新しいガチャ 2 景品 1 の出る確率"));

    // ⚠⚠ **1 つ目のガチャは 1 ミリも変わっていない**（＝取り違えていない）。
    const stored = JSON.parse(
      localStorage.getItem(GACHA_LIBRARY_KEY) ?? "[]",
    ) as GachaDefinition[];
    expect(stored.map((g) => g.id)).toEqual(["g:1", "g:2"]);
    expect(stored[0].prizes.map((p) => p.weight)).toEqual([400]);
    expect(stored[1].prizes.map((p) => p.weight)).toEqual([50]);
  });
});
