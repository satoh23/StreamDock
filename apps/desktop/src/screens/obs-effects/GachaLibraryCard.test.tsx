import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, within, act } from "@testing-library/react";
import {
  EFFECT_ASSIGNMENTS_KEY,
  GACHA_LIBRARY_KEY,
  GACHA_STAGE_ENABLED_KEY,
  GACHA_PLACEMENT_KEY,
  GACHA_PRIZE_COLOR_KEY,
  OBS_SOURCE_LIST_KEY,
  loadGachaPlacement,
  GACHA_PRIZE_COLOR_DEFAULT,
  loadGachaPrizeColor,
  loadGachaStageEnabled,
  loadObsSourceList,
  saveGachaPlacement,
  saveGachaPrizeColor,
  saveGachaStageEnabled,
} from "../../features/comment-viewer/overlaySettings";
import { EffectAssignmentCard } from "./EffectAssignmentCard";
import { GachaLibraryCard } from "./GachaLibraryCard";
import { GachaStageCard } from "./GachaStageCard";
import {
  GACHA_DEFINITION_MAX,
  loadGachaLibrary,
  referencedGachaIds,
  runGachaMigration,
  saveGachaLibrary,
  type GachaDefinition,
} from "./effectAssignments";
import { EFFECT_EVENT_LABEL } from "./effectEventRows";

/**
 * 063d: **ガチャの一覧**（作る・名前を変える・消す）の仕様テスト。
 *
 * ⚠⚠ **この 1 ファイルが固定している最重要の不変条件は 3 つ。**
 *
 * ① ⚠⚠⚠ **同じガチャを複数の条件から使い回せる**——ここが 063d の存在理由そのもの
 *    （063a は景品を割り当てに直付けしていたので、同じガチャを 2 回入力させていた）。
 * ② ⚠⚠⚠ **穴 R: 使用中のガチャを黙って壊さない**——消す前に
 *    「どの条件で使われているか」を出し、消したあとは条件行に警告が出る。
 * ③ ⚠ **同時に 1 つしか開かない**（複数開くと同じ `labelPrefix` のボタンが並ぶ＝ Q-063a-7 の再発）。
 *
 * ⚠ 景品の表そのもの（`GachaPrizeTable`）は `GachaPrizeTable.test.tsx` が固定している。
 *
 * テストは外部通信も OS 操作も IPC も行わない（localStorage だけの純粋な画面）。
 */

const OBS_SOURCE_A = "きらきら演出";

const putObsSources = (names: string[] = [OBS_SOURCE_A]) =>
  localStorage.setItem(
    OBS_SOURCE_LIST_KEY,
    JSON.stringify({
      at: 1_700_000_000_000,
      sources: names.map((name) => ({ name, kind: "ffmpeg_source" })),
    }),
  );

/**
 * ⚠⚠ `ObsEffectsScreen` と同じ配線だけを再現する（あの画面は Tauri の `invoke` を叩く
 * effect を持っており、描くと未処理 rejection が出る）。
 * ⚠ **状態は上が持ち、条件カードと一覧カードの両方へ配る**——ここが 063d の要点である。
 */
const Harness = () => {
  const [gachas, setGachas] = useState<readonly GachaDefinition[]>(() =>
    runGachaMigration(),
  );
  /**
   * ⚠⚠ 063c 段 1: **旗まわりも `ObsEffectsScreen` と同じ配線で再現する**
   * （トグルの `disabled` は「条件カードの書換 → 画面が読み直す」という**跨いだ配線**に
   * 乗っているので、スタブで代用すると**その配線自体が検査されない**）。
   */
  const [stageEnabled, setStageEnabled] = useState<boolean>(
    loadGachaStageEnabled,
  );
  const [placement, setPlacement] = useState(loadGachaPlacement);
  const [prizeColor, setPrizeColor] = useState(loadGachaPrizeColor);
  const [hasGachaCondition, setHasGachaCondition] = useState<boolean>(
    () => referencedGachaIds().length > 0,
  );
  return (
    <>
      <EffectAssignmentCard
        gachas={gachas}
        onConditionsChange={() =>
          setHasGachaCondition(referencedGachaIds().length > 0)
        }
      />
      <GachaLibraryCard
        gachas={gachas}
        obsSources={loadObsSourceList()?.sources ?? null}
        onChange={(next) => setGachas(saveGachaLibrary(next))}
      />
      {/* ⚠⚠⚠ **063c 段 4-d: 演出の設定は `GachaStageCard` へ出た**が、
          **同じ画面に並んでいる**ので配線ごとここで再現する。
          ⚠ トグルの `disabled` は「条件カードの書換 → 画面が読み直す」という**跨いだ配線**に
          乗っているので、スタブで代用すると**その配線自体が検査されない**（元の注記が正）。 */}
      <GachaStageCard
        stageEnabled={stageEnabled}
        canEnableStage={hasGachaCondition}
        onStageEnabledChange={(next) => {
          // ⚠ 画面側と同じ順（保存 → state）。⚠⚠ 窓を開く invoke はここでは再現しない
          //   （`ObsEffectsScreen.test.tsx` が固定する）。
          saveGachaStageEnabled(next);
          setStageEnabled(next);
        }}
        /* ⚠ 画面側と同じ順（保存 → 読み直し）にしてある——
         **save が一覧に無い id を保存しないこと**を、この往復ごと検査するため。 */
        placement={placement}
        onPlacementChange={(next) => {
          saveGachaPlacement(next);
          setPlacement(loadGachaPlacement());
        }}
        prizeColor={prizeColor}
        onPrizeColorChange={(next) => {
          saveGachaPrizeColor(next);
          setPrizeColor(loadGachaPrizeColor());
        }}
      />
    </>
  );
};

const createGacha = () =>
  fireEvent.click(screen.getByRole("button", { name: "ガチャを作る" }));

const selectFor = (label: string) =>
  screen.getByLabelText(`${label}のエフェクト`) as HTMLSelectElement;

const MISSING_TEXT =
  "このガチャは削除されています。下の「ガチャ」から選び直してください。";

describe("GachaLibraryCard（063d）", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  // --- ① 使い回し（063d の存在理由） -----------------------------------------------------------

  it("⚠ 未作成なら「ガチャがありません」が出る", () => {
    render(<Harness />);
    expect(
      screen.getByText(
        "ガチャがありません。「ガチャを作る」で追加してください。",
      ),
    ).toBeInTheDocument();
  });

  it("⚠⚠ ガチャを作ると一覧に載り、条件の選択肢にも出る", () => {
    putObsSources();
    render(<Harness />);
    createGacha();
    expect(loadGachaLibrary()).toEqual([
      { id: "g:1", name: "新しいガチャ 1", prizes: [] },
    ]);
    expect(
      within(selectFor(EFFECT_EVENT_LABEL.superchat))
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toContain("ガチャ: 新しいガチャ 1");
  });

  /**
   * ⚠⚠⚠ **063d の要望そのもの**（依頼者・2026-08-23）:
   * 「テンプレート1のガチャはスパちゃとビッツがきた時に発火するというように設定できると良い」。
   * ⚠ **1 つのガチャを 2 つの条件が指し、片方を直すと両方に反映される**ことをここで固定する。
   */
  it("⚠⚠⚠ 同じガチャを複数の条件へ割り当てられ、直すと両方に反映される", () => {
    putObsSources();
    render(<Harness />);
    createGacha();
    // ⚠ スパチャ・ビッツ（wire 上 superchat）とサブスクの 2 条件が**同じ id** を指す。
    fireEvent.change(selectFor(EFFECT_EVENT_LABEL.superchat), {
      target: { value: "gacha:g:1" },
    });
    fireEvent.change(selectFor(EFFECT_EVENT_LABEL.subscription), {
      target: { value: "gacha:g:1" },
    });
    const stored = JSON.parse(
      localStorage.getItem(EFFECT_ASSIGNMENTS_KEY) ?? "[]",
    ) as { id: string; effect: { kind: string; gachaId?: string } }[];
    expect(
      stored
        .filter((c) => c.effect.kind === "gacha")
        .map((c) => `${c.id}=${c.effect.gachaId}`),
    ).toEqual(["event:superchat=g:1", "event:subscription=g:1"]);

    // ⚠⚠ ガチャ本体を 1 か所で直す（＝ 063a では 2 回入力する必要があった作業）。
    fireEvent.click(
      screen.getByRole("button", { name: "新しいガチャ 1 景品を追加" }),
    );
    // ⚠ 景品は**一覧側にだけ**入る（条件は id を指しているだけ）。
    expect(loadGachaLibrary()[0].prizes).toHaveLength(1);
    expect(localStorage.getItem(EFFECT_ASSIGNMENTS_KEY) ?? "").not.toContain(
      OBS_SOURCE_A,
    );
  });

  /**
   * ⚠⚠⚠ **レビュー Q-4: 受け付けなかったなら理由を出す**（Q-063a-1 と同じ規律）。
   *
   * 旧実装は空名を **黙って元の値へ戻すだけ**で、画面に理由が出なかった。
   * ⚠ 「戻された理由が画面に出ない」は **063a-2 が捨てられた理由そのもの**である。
   */
  it("⚠⚠⚠ Q-4: 空の名前は理由を出して受け付けない（黙って戻さない）", () => {
    render(<Harness />);
    createGacha();
    const input = screen.getByLabelText("新しいガチャ 1 の名前");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.blur(input);
    expect(
      screen.getByText("名前を入れてください（空にはできません）。"),
    ).toBeInTheDocument();
    expect(loadGachaLibrary()[0].name).toBe("新しいガチャ 1");

    // ⚠ 打ち直し始めたら理由は消える（古い理由が新しい入力に付いて見えない）。
    fireEvent.change(input, { target: { value: "大当たりガチャ" } });
    expect(
      screen.queryByText("名前を入れてください（空にはできません）。"),
    ).toBeNull();
    fireEvent.blur(input);
    expect(loadGachaLibrary()[0].name).toBe("大当たりガチャ");
  });

  /**
   * ⚠⚠⚠ **レビュー Q-1: 穴 W は「未確定行」からも踏めた**（手編集は要らない）。
   *
   * `referencedGachaIds()` は**保存済みの条件しか見ない**ので、未確定行（`draftRow`）が
   * 指しているガチャは数えられない。⇒ 作る → 未確定行で選ぶ → 消す → 作る、で
   * **id が再利用され**、未確定行を確定させると**ユーザーが選んだのとは別のガチャ**を指す。
   * ⚠ しかも手順の途中で出る「削除されました」の警告は**作り直した瞬間に消える**ので、
   * 最終状態には手がかりが 1 つも残らない（＝「黙って壊れる」側）。
   * ⚠⚠ 塞ぎ方＝ `GachaLibraryCard` が **このセッションで発行した id**（`issuedIds`）も避ける。
   */
  it("⚠⚠⚠ Q-1: 未確定行が指したまま消して作り直しても、id を再利用しない", () => {
    putObsSources();
    render(<Harness />);
    createGacha();
    expect(loadGachaLibrary().map((g) => g.id)).toEqual(["g:1"]);

    // 未確定行を出して、そのエフェクトに g:1 を選ぶ（⚠ **まだ保存されない**）。
    fireEvent.click(screen.getByRole("button", { name: "条件を追加" }));
    fireEvent.change(screen.getByLabelText("キーワード 1 のエフェクト"), {
      target: { value: "gacha:g:1" },
    });

    // g:1 を削除（保存済みの参照はゼロ＝`referencedGachaIds()` は空）。
    fireEvent.click(
      screen.getByRole("button", { name: "新しいガチャ 1 を削除" }),
    );
    fireEvent.click(
      screen
        .getAllByRole("button")
        .filter((b) => b.textContent === "削除")
        .pop()!,
    );
    expect(loadGachaLibrary()).toEqual([]);

    // ⚠⚠⚠ 作り直しても `g:1` を再利用しない。
    createGacha();
    expect(loadGachaLibrary().map((g) => g.id)).toEqual(["g:2"]);
    // ⚠ 未確定行はまだ消えたガチャを指したまま＝**警告が出続ける**（黙って化けない）。
    expect(screen.getByText(MISSING_TEXT)).toBeInTheDocument();
  });

  /**
   * ⚠⚠ **レビュー Q-8: 既定名は id 由来なので必ず一意**（旧実装は `gachas.length + 1`）。
   *
   * 件数基準だと「作る→作る→1 つ目を消す→作る」で**同名の行が 2 つ並び**、
   * `aria-label` が重複する（読み上げで区別できず、`getByLabelText` も引けなくなる）。
   */
  it("⚠⚠ Q-8: 作り直しても既定名が重複しない（アクセシブル名が衝突しない）", () => {
    render(<Harness />);
    createGacha();
    createGacha();
    fireEvent.click(
      screen.getByRole("button", { name: "新しいガチャ 1 を削除" }),
    );
    fireEvent.click(
      screen
        .getAllByRole("button")
        .filter((b) => b.textContent === "削除")
        .pop()!,
    );
    createGacha();
    const names = loadGachaLibrary().map((g) => g.name);
    expect(names).toEqual(["新しいガチャ 2", "新しいガチャ 3"]);
    // ⚠ 重複していれば `getByLabelText` が「複数見つかった」で落ちる。
    expect(screen.getByLabelText("新しいガチャ 3 の名前")).toBeInTheDocument();
  });

  it("⚠ 名前を変えられる（空にはできない）", () => {
    render(<Harness />);
    createGacha();
    const input = screen.getByLabelText("新しいガチャ 1 の名前");
    fireEvent.change(input, { target: { value: "大当たりガチャ" } });
    fireEvent.blur(input);
    expect(loadGachaLibrary()[0].name).toBe("大当たりガチャ");

    // ⚠⚠ 空は受け付けない（`<select>` の選択肢に出るので、空だと選べなくなる）。
    const renamed = screen.getByLabelText("大当たりガチャ の名前");
    fireEvent.change(renamed, { target: { value: "   " } });
    fireEvent.blur(renamed);
    expect(loadGachaLibrary()[0].name).toBe("大当たりガチャ");
  });

  it("⚠ ガチャは上限まで（上限に達したら押せず、理由が出る）", () => {
    render(<Harness />);
    for (let i = 0; i < GACHA_DEFINITION_MAX; i++) createGacha();
    expect(loadGachaLibrary()).toHaveLength(GACHA_DEFINITION_MAX);
    expect(screen.getByRole("button", { name: "ガチャを作る" })).toBeDisabled();
    expect(
      screen.getByText(`ガチャは ${GACHA_DEFINITION_MAX} 個までです。`),
    ).toBeInTheDocument();
  });

  // --- ② 穴 R: 使用中のガチャを黙って壊さない --------------------------------------------------

  /**
   * ⚠⚠⚠ **ミューテーション N5 が生存したので足した 1 本。**
   *
   * 削除の確認に「どの条件で使われているか」を出す処理を消しても、
   * **他のどのテストもレッドにならなかった**（＝黙って壊す実装が通ってしまう）。
   * ⚠ 消したガチャを指していた条件は**エフェクトを出さなくなる**ので、
   * **消す前に伝えることがこの機能の唯一の担保**である。⚠ **この 1 本を消さないこと。**
   */
  it("⚠⚠⚠ 穴 R: 使用中のガチャを消すとき、使っている条件が列挙される", () => {
    putObsSources();
    render(<Harness />);
    createGacha();
    fireEvent.change(selectFor(EFFECT_EVENT_LABEL.superchat), {
      target: { value: "gacha:g:1" },
    });
    fireEvent.change(selectFor(EFFECT_EVENT_LABEL.subscription), {
      target: { value: "gacha:g:1" },
    });

    fireEvent.click(
      screen.getByRole("button", { name: "新しいガチャ 1 を削除" }),
    );
    // ⚠⚠ **使っている条件の名前がそのまま出る**（`conditionLabel` が正）。
    //   ⚠ 条件の行にも同じ名前が並ぶので、**ダイアログの中だけ**を見る。
    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByText(EFFECT_EVENT_LABEL.superchat),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(EFFECT_EVENT_LABEL.subscription),
    ).toBeInTheDocument();
    // ⚠ 何が起きるかも書く（061a Q-1）。
    expect(
      screen.getByText(/削除すると、下の条件はエフェクトを出さなくなります。/),
    ).toBeInTheDocument();
  });

  it("⚠ キーワード条件も列挙される（イベント条件だけを見ていない）", () => {
    putObsSources();
    render(<Harness />);
    createGacha();
    fireEvent.click(screen.getByRole("button", { name: "条件を追加" }));
    const keyword = screen.getByLabelText("キーワード 1");
    fireEvent.change(keyword, { target: { value: "ガチャ" } });
    fireEvent.blur(keyword);
    fireEvent.change(screen.getByLabelText("キーワード 1 のエフェクト"), {
      target: { value: "gacha:g:1" },
    });

    fireEvent.click(
      screen.getByRole("button", { name: "新しいガチャ 1 を削除" }),
    );
    expect(
      within(screen.getByRole("dialog")).getByText("キーワード「ガチャ」"),
    ).toBeInTheDocument();
  });

  /**
   * ⚠⚠⚠ **063e 段 3-b: 報酬ごとの紐づけも列挙されること。**
   *
   * ⚠ これが抜けると「**使用中と知らずにガチャを消す**」——削除確認は
   * 「どの条件が使っているか」を出す**唯一の場所**だからである。
   * ⚠⚠ 出るのは**イベント名ではなく報酬名**（同じチャンネルポイントに複数の紐づけがありうるので、
   * 「チャンネルポイント」だけでは**どの行か分からない**）。
   */
  it("⚠⚠⚠ 報酬ごとの紐づけも列挙される（報酬名で出る）", () => {
    putObsSources();
    render(<Harness />);
    createGacha();
    fireEvent.click(
      screen.getByRole("button", { name: "カスタム報酬を追加" }),
    );
    const reward = screen.getByLabelText("カスタム報酬の名前 1");
    fireEvent.change(reward, { target: { value: "ガチャを引く" } });
    fireEvent.blur(reward);
    fireEvent.change(screen.getByLabelText("カスタム報酬 1 のエフェクト"), {
      target: { value: "gacha:g:1" },
    });

    fireEvent.click(
      screen.getByRole("button", { name: "新しいガチャ 1 を削除" }),
    );
    expect(
      within(screen.getByRole("dialog")).getByText(
        "カスタム報酬「ガチャを引く」",
      ),
    ).toBeInTheDocument();
  });

  it("⚠ 使われていなければ、そのまま消せる旨だけを出す", () => {
    render(<Harness />);
    createGacha();
    fireEvent.click(
      screen.getByRole("button", { name: "新しいガチャ 1 を削除" }),
    );
    expect(
      screen.getByText("「新しいガチャ 1」を削除します。"),
    ).toBeInTheDocument();
  });

  it("⚠ キャンセルすると消えない", () => {
    render(<Harness />);
    createGacha();
    fireEvent.click(
      screen.getByRole("button", { name: "新しいガチャ 1 を削除" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(loadGachaLibrary()).toHaveLength(1);
  });

  /**
   * ⚠⚠ **消したあとは条件行に警告が出る**（064b の「OBS にこの名前のソースが見つかりません」と同じ手）。
   * ⚠ 発火は `select` が落とすだけ＝配信中は無言なので、ここに出さないと理由がどこからも読めない。
   */
  it("⚠⚠ 消すと、指していた条件に警告が出る（黙って別のガチャへ化けない）", () => {
    putObsSources();
    render(<Harness />);
    createGacha();
    fireEvent.change(selectFor(EFFECT_EVENT_LABEL.superchat), {
      target: { value: "gacha:g:1" },
    });
    expect(screen.queryByText(MISSING_TEXT)).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "新しいガチャ 1 を削除" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "削除" }));

    expect(loadGachaLibrary()).toHaveLength(0);
    expect(screen.getByText(MISSING_TEXT)).toBeInTheDocument();
    // ⚠⚠ 値は保たれる（先頭の「エフェクトを出さない」へ化けない）。
    expect(selectFor(EFFECT_EVENT_LABEL.superchat).value).toBe("gacha:g:1");
  });

  /**
   * ⚠⚠⚠ **id を詰めないことの実害をここで固定する**（`nextGachaId` の単体テストと対で読む）。
   * 詰めると、**消したガチャを指したままの条件が、新しく作った別のガチャを黙って指す**。
   */
  it("⚠⚠⚠ 消したあとに作り直しても、古い参照が新しいガチャへ化けない", () => {
    putObsSources();
    render(<Harness />);
    createGacha();
    fireEvent.change(selectFor(EFFECT_EVENT_LABEL.superchat), {
      target: { value: "gacha:g:1" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "新しいガチャ 1 を削除" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "削除" }));

    // ⚠ 作り直すと id は `g:2`（詰めない）。
    createGacha();
    expect(loadGachaLibrary()[0].id).toBe("g:2");
    // ⚠⚠ 条件は `g:1` を指したままで、**警告が出続ける**（＝黙って `g:2` へ化けていない）。
    expect(selectFor(EFFECT_EVENT_LABEL.superchat).value).toBe("gacha:g:1");
    expect(screen.getByText(MISSING_TEXT)).toBeInTheDocument();
  });

  // --- ③ 同時に 1 つだけ開く -------------------------------------------------------------------

  it("⚠⚠ 景品表は同時に 1 つしか開かない（同名のボタンが並ばない）", () => {
    putObsSources();
    render(<Harness />);
    createGacha();
    expect(
      screen.getByRole("button", { name: "新しいガチャ 1 景品を追加" }),
    ).toBeInTheDocument();

    // ⚠ 2 つ目を作ると自動で開き、1 つ目は閉じる。
    createGacha();
    expect(
      screen.queryByRole("button", { name: "新しいガチャ 1 景品を追加" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "新しいガチャ 2 景品を追加" }),
    ).toBeInTheDocument();
  });

  it("⚠ 「閉じる」で畳める（畳んでも景品の件数は読める）", () => {
    putObsSources();
    render(<Harness />);
    createGacha();
    fireEvent.click(
      screen.getByRole("button", { name: "新しいガチャ 1 景品を追加" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "新しいガチャ 1 の景品を閉じる" }),
    );
    expect(
      screen.queryByRole("button", { name: "新しいガチャ 1 景品を追加" }),
    ).not.toBeInTheDocument();
    // ⚠ 開かないと分からない、を作らない。
    expect(screen.getByText("景品 1 件")).toBeInTheDocument();
  });

  // --- §9 ---------------------------------------------------------------------------------------

  it("⚠⚠ §9: 保存されるのはガチャ名・景品・OBS のソース名だけ", () => {
    putObsSources();
    render(<Harness />);
    createGacha();
    fireEvent.click(
      screen.getByRole("button", { name: "新しいガチャ 1 景品を追加" }),
    );
    const raw = localStorage.getItem(GACHA_LIBRARY_KEY) ?? "";
    for (const forbidden of ["history", "winner", "drawnAt", "当選"]) {
      expect(raw).not.toContain(forbidden);
    }
  });

  // --- 063c 段 1: 「ガチャの演出を配信画面に出す」トグル（§1 の 2 つ目の明示操作） ---------------

  /**
   * ⚠⚠⚠ **このブロックが固定しているのは `docs/security.md` §1（044a 例外）の姿勢そのものである。**
   *
   * ここが緑である限り、「**ユーザーの明示操作なしにステージ窓が開き OBS へ繋ぐ**」は作れない。
   * ⚠ 実際に窓が開くこと・旗が立つことは `ObsEffectsScreen.test.tsx` が、
   * 旗から OBS への反映は `CommentViewerApp.effects.test.tsx` が、
   * 起動時の復元は `effectOverlayRestore.test.ts` が固定している（**4 ファイルで 1 本の鎖**）。
   */
  const STAGE_TOGGLE = "ガチャの演出を配信画面に出す";
  const assignGacha = () =>
    fireEvent.change(selectFor(EFFECT_EVENT_LABEL.superchat), {
      target: { value: "gacha:g:1" },
    });

  it("⚠⚠ 既定は OFF（＝明示的に有効化していないユーザーは OBS へ繋がない）", () => {
    render(<Harness />);
    expect(screen.getByRole("switch", { name: STAGE_TOGGLE })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(loadGachaStageEnabled()).toBe(false);
    expect(localStorage.getItem(GACHA_STAGE_ENABLED_KEY)).toBeNull();
  });

  it("⚠⚠⚠ ガチャを割り当てるまで ON にできない（押せない理由も出す）", () => {
    putObsSources();
    render(<Harness />);
    createGacha();
    // ⚠ ガチャを「作った」だけでは足りない——**条件に割り当てて初めて**押せる。
    expect(screen.getByRole("switch", { name: STAGE_TOGGLE })).toBeDisabled();
    expect(
      screen.getByText(
        "上の「エフェクトを表示する条件」でガチャを割り当てると、この設定を ON にできます。",
      ),
    ).toBeInTheDocument();
  });

  it("⚠⚠ ガチャを条件に割り当てると押せるようになる（黙って押せないままにしない）", () => {
    putObsSources();
    render(<Harness />);
    createGacha();
    assignGacha();
    // ⚠⚠ **これが `onConditionsChange` の配線そのものである**（外すとレッド）。
    expect(screen.getByRole("switch", { name: STAGE_TOGGLE })).toBeEnabled();
  });

  it("⚠⚠⚠ ガチャを割り当てただけでは旗が立たない（派生値で有効化しない・064d が消した形）", () => {
    putObsSources();
    render(<Harness />);
    createGacha();
    assignGacha();
    // ⚠⚠ **押せるようになっただけ**で、旗は OFF のまま＝ OBS へは 1 バイトも向かわない。
    expect(loadGachaStageEnabled()).toBe(false);
    expect(screen.getByRole("switch", { name: STAGE_TOGGLE })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("トグルを押すと旗が立ち、もう一度押すと落ちる（明示操作の 1 往復）", () => {
    putObsSources();
    render(<Harness />);
    createGacha();
    assignGacha();

    fireEvent.click(screen.getByRole("switch", { name: STAGE_TOGGLE }));
    expect(loadGachaStageEnabled()).toBe(true);

    fireEvent.click(screen.getByRole("switch", { name: STAGE_TOGGLE }));
    expect(loadGachaStageEnabled()).toBe(false);
  });

  it("⚠⚠ ON のまま割り当てを全部消しても OFF に戻せる（脱出路を塞がない）", () => {
    putObsSources();
    render(<Harness />);
    createGacha();
    assignGacha();
    fireEvent.click(screen.getByRole("switch", { name: STAGE_TOGGLE }));
    expect(loadGachaStageEnabled()).toBe(true);

    // 割り当てを「出さない」へ戻す＝ガチャを指す条件が 0 件になる。
    fireEvent.change(selectFor(EFFECT_EVENT_LABEL.superchat), {
      target: { value: "none" },
    });

    // ⚠⚠⚠ **`disabled` の式を `!canEnableStage` だけにするとここがレッドになる**
    //   （ON のまま押せなくなり、ユーザーが自分で OFF に戻せない）。
    const toggle = screen.getByRole("switch", { name: STAGE_TOGGLE });
    expect(toggle).toBeEnabled();
    // ⚠ そして「いま出ない」理由が画面に出ている（黙って効かない、を作らない）。
    expect(
      screen.getByText(
        "ガチャを割り当てた条件がないため、いまは配信画面に出ません。",
      ),
    ).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(loadGachaStageEnabled()).toBe(false);
  });

  it("⚠ 保存済みの ON を読んで表示する（常設トグル＝再起動しても ON のまま）", () => {
    putObsSources();
    saveGachaStageEnabled(true);
    localStorage.setItem(
      EFFECT_ASSIGNMENTS_KEY,
      JSON.stringify([
        {
          when: { type: "event", eventType: "superchat" },
          effect: { kind: "gacha", gachaId: "g:1" },
        },
      ]),
    );
    render(<Harness />);
    expect(screen.getByRole("switch", { name: STAGE_TOGGLE })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("⚠⚠ §9: 旗に載るのは 'true' / 'false' だけ（第三者データも景品名も入らない）", () => {
    putObsSources();
    render(<Harness />);
    createGacha();
    assignGacha();
    fireEvent.click(screen.getByRole("switch", { name: STAGE_TOGGLE }));
    expect(localStorage.getItem(GACHA_STAGE_ENABLED_KEY)).toBe("true");
  });
});

/**
 * ⚠⚠⚠ **063c 段 4-a: 「抽選中の秒数」の設定は削除した**ので、その describe ごと消した。
 * 依頼者の指示＝「**この設定値を変えることによるメリットが配信者になく、
 * 逆に項目が増えることで画面が複雑になってしまっている**」。
 */

/**
 * ⚠⚠ **063c 段 4 / 段 5: 演出の見た目（位置・景品名の色）とプレビュー。**
 *
 * ⚠ **これはガードではない**（トグルと違い OBS へ繋ぐかどうかに関与しない）。
 * ここが固定するのは 3 点:
 *   1. 「**選んだものがそのまま保存される**」
 *   2. ⚠⚠⚠ **061h ⑦-c と同型の罠**（保存値が壊れていると**開いただけで別の設定へ化ける**）を塞ぐ
 *   3. ⚠⚠⚠ **段 5-a: プレビューが設定に追従する**——段 4 のプレビューは「層」を描いていなかったので、
 *      **位置を変えても 1 ピクセルも動かず**、**縁取りの変数も届いていなかった**。
 *
 * ## ⚠ なぜ `GachaStageCard.test.tsx` ではなくこのファイルに在るのか（段 5 レビュー Q-6・受容）
 *
 * 段 4-d で設定は [`GachaStageCard`] へ出たが、⚠⚠ **ここが固定したいのは部品単体ではなく
 * 「条件カードを書き換える → 画面が読み直す → トグルの `disabled` が変わる」という跨いだ配線**で、
 * それを再現しているのが上の `Harness`（`EffectAssignmentCard` ＋ `GachaLibraryCard` ＋
 * `GachaStageCard` を**同じ画面に並べたもの**）だからである。⚠ 分けると `Harness` が 2 つになり、
 * **本番と違う組み方で組み直したハーネス**が生まれる（`effectAssignments.test.ts` の
 * 「⚠ スタブ matcher で代用しないこと」と同じ罠）。
 * ⚠⚠ **再修正トリガー＝ `GachaStageCard` 単体で完結する検査（意匠・文言・プレビューの状態機械）が
 * ここより増えたとき。** そのときは `Harness` を共有ヘルパへ出してから
 * `GachaStageCard.test.tsx` を新設すること（**先にハーネスを共有する**のが順序である）。
 */
describe("063c 段 5: 演出の見た目とプレビュー", () => {
  const placementSelect = () =>
    screen.getByLabelText("演出を出す位置") as HTMLSelectElement;
  /**
   * ⚠ 景品名の色の `<input type="color">`。
   *
   * ## ⚠⚠ jsdom への依存は薄い（段 5 レビュー ⑧・受容）
   *
   * `<input type="color">` の値サニタイズ（`#rrggbb` へ正規化・不正値は `#000000`）は
   * **HTML 仕様が定めたもの**で、jsdom はそれに従っている＝実ブラウザと挙動が一致する。
   * ⚠⚠ そのうえで **ここが見ているのは「配線」だけ**である（選んだ値が保存へ届き、
   * 読み直しても残るか）。⚠⚠⚠ **「不正な値を弾く」ことの本体は
   * `features/comment-viewer/overlaySettings.effects.test.ts`**（`parseGachaPrizeColor` /
   * `saveGachaPrizeColor` を直接叩く側）が持っており、**あちらは jsdom の `<input>` に一切依存しない**。
   * ⇒ 仮に jsdom が挙動を変えても、落ちるのは配線側だけで**関門の検査は無傷**である。
   * ⚠ **あちらを消さないこと**——実ブラウザの `<input type="color">` は不正値を出さないので、
   * UI 経由のテストだけでは関門が効いていることを測れない。
   */
  const colorInput = () =>
    screen.getByLabelText("景品名の色") as HTMLInputElement;
  /** ⚠ プレビューの層（＝配置クラスが載っている要素）。実機とまったく同じクラスである。 */
  const previewLayer = () => document.querySelector("[class*='gachaLayer']");
  const playButton = () =>
    screen.getByRole("button", { name: "カプセルガチャを再生" });
  const hasMachine = () =>
    Array.from(document.querySelectorAll("img")).some((img) =>
      (img.getAttribute("src") ?? "").includes("machine-"),
    );

  it("既定は「中央」と既定の色", () => {
    render(<Harness />);
    expect(placementSelect().value).toBe("center");
    expect(colorInput().value).toBe(GACHA_PRIZE_COLOR_DEFAULT);
  });

  it("選ぶと保存され、読み直しても残る（位置）", () => {
    render(<Harness />);
    fireEvent.change(placementSelect(), { target: { value: "right" } });
    expect(localStorage.getItem(GACHA_PLACEMENT_KEY)).toBe("right");
    expect(loadGachaPlacement()).toBe("right");
    expect(placementSelect().value).toBe("right");
  });

  it("⚠⚠ 段 5-e: 自由な色を選ぶと保存され、読み直しても残る", () => {
    render(<Harness />);
    fireEvent.change(colorInput(), { target: { value: "#123abc" } });
    expect(localStorage.getItem(GACHA_PRIZE_COLOR_KEY)).toBe("#123abc");
    expect(loadGachaPrizeColor()).toBe("#123abc");
    expect(colorInput().value).toBe("#123abc");
  });

  it("⚠ 見本を押すとその色が入る（迷ったときの逃げ道）", () => {
    render(<Harness />);
    fireEvent.click(screen.getByLabelText("景品名の色をスカイブルーにする"));
    expect(loadGachaPrizeColor()).toBe("#7fd4ff");
    expect(colorInput().value).toBe("#7fd4ff");
  });

  /**
   * ⚠⚠⚠ **061h ⑦-c と同型の罠。** 壊れた保存値のとき、
   * **ブラウザが先頭の選択肢を選んで「開いただけで設定が変わった」**になってはいけない。
   * ⚠ ここは**既定へ倒れて表示も既定になる**のが正しい（保存層が値を検査しているため）。
   */
  it("⚠⚠⚠ 壊れた保存値でも、開いただけで保存が書き換わらない", () => {
    localStorage.setItem(GACHA_PLACEMENT_KEY, "top");
    localStorage.setItem(GACHA_PRIZE_COLOR_KEY, "red; background: url(x)");
    render(<Harness />);
    expect(placementSelect().value).toBe("center");
    expect(colorInput().value).toBe(GACHA_PRIZE_COLOR_DEFAULT);
    // ⚠⚠ **保存値は壊れたまま残る**（開いただけで保存が走らない）。
    expect(localStorage.getItem(GACHA_PLACEMENT_KEY)).toBe("top");
    expect(localStorage.getItem(GACHA_PRIZE_COLOR_KEY)).toBe(
      "red; background: url(x)",
    );
  });

  it("⚠ トグルが OFF でも設定できる（押せるのに何も起きない状態にしない）", () => {
    render(<Harness />);
    expect(placementSelect()).toBeEnabled();
    expect(colorInput()).toBeEnabled();
    fireEvent.change(placementSelect(), { target: { value: "left" } });
    expect(loadGachaPlacement()).toBe("left");
  });

  it("⚠⚠ §9: 保存されるのは色 1 つだけ（第三者データも CSS の式も載らない）", () => {
    render(<Harness />);
    fireEvent.change(colorInput(), { target: { value: "#ff9ecb" } });
    const raw = localStorage.getItem(GACHA_PRIZE_COLOR_KEY) ?? "";
    expect(raw).toMatch(/^#[0-9a-f]{6}$/);
  });

  // --- ⚠⚠⚠ 段 5-a: プレビューが実機と同じものであること ---------------------------------------

  /**
   * ⚠⚠⚠ **段 4 の不具合そのもの。** プレビューが「層」を描いていなかったので、
   * **位置を変えても中身が動かなかった**（依頼者＝「本当に効いてるのかわからなくて心配になる」）。
   * ⚠ 実機（`EffectOverlayApp.gacha.test.tsx`）と**同じクラス名**を見ていることが要点である。
   */
  it.each([
    ["left", /gachaAlignLeft/],
    ["center", /gachaAlignCenter/],
    ["right", /gachaAlignRight/],
  ])("⚠⚠⚠ プレビューが「出す位置」に追従する: %s", (value, expected) => {
    render(<Harness />);
    fireEvent.change(placementSelect(), { target: { value } });
    expect(previewLayer()?.className).toMatch(expected);
  });

  it("⚠⚠ 3 つの位置で本当に別のクラスになる（全部中央にしていない）", () => {
    render(<Harness />);
    const seen: string[] = [];
    for (const value of ["left", "center", "right"]) {
      fireEvent.change(placementSelect(), { target: { value } });
      seen.push(previewLayer()?.className ?? "");
    }
    expect(new Set(seen).size).toBe(3);
  });

  /**
   * ⚠⚠⚠ **プレビューは「実物を縮めたもの」である。**
   * ⚠ 別の絵を用意すると**プレビューと実機で見え方が変わる**（プレビューが嘘になる）。
   * ⇒ 実際の演出と**同じ画像**が出ていることを見る。
   */
  it("⚠⚠ プレビューに実際の演出の素材が出ている", () => {
    render(<Harness />);
    const srcs = Array.from(document.querySelectorAll("img")).map(
      (img) => img.getAttribute("src") ?? "",
    );
    // ⚠ 止まっているときに出ているのは**結果の段**（殻とキラキラ）である。
    expect(srcs.some((s) => s.includes("sparkle"))).toBe(true);
    expect(srcs.some((s) => s.includes("capsule-"))).toBe(true);
  });

  /**
   * ⚠⚠⚠ **段 5-d: 押すまで動かない。**
   * 依頼者＝「**自動で再生されるのは分かりにくいし画面が喧しい**」。
   * ⚠ 「動いていない」を**マシンが出ていないこと**で測る（抽選中の段は先頭にしか無い）。
   */
  it("⚠⚠⚠ 段 5-d: 押すまで再生が始まらない（押すと始まる）", () => {
    vi.useFakeTimers();
    try {
      render(<Harness />);
      // ⚠ 何もしなければ、いくら時間が経っても結果の絵のまま。
      act(() => {
        vi.advanceTimersByTime(5000);
      });
      expect(hasMachine()).toBe(false);
      // ⚠⚠ 押した瞬間に先頭（＝マシンが回っている段）へ戻る。
      fireEvent.click(playButton());
      expect(hasMachine()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
