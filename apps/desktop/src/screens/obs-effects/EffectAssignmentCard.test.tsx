import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import {
  EFFECT_ASSIGNMENTS_KEY,
  // 064b: 割り当て先に OBS 側のソースを出す（一覧はコメビュ窓が書いたものを読む）。
  OBS_SOURCE_LIST_KEY,
} from "../../features/comment-viewer/overlaySettings";
import { EffectAssignmentCard } from "./EffectAssignmentCard";
import type { GachaDefinition } from "./effectAssignments";
import {
  KEYWORD_CONDITION_MAX,
  type EffectAssignment,
} from "./effectAssignments";
import {
  effectSelectAssignment,
  effectSelectValue,
  isObsSourceMissingFromList,
  NONE_VALUE,
  OBS_SOURCE_PREFIX,
} from "./effectSelectValue";
import { EFFECT_CONDITION_EVENT_TYPES } from "../comment-viewer/viewerFormat";
import { EFFECT_EVENT_LABEL, EFFECT_EVENT_ROWS } from "./effectEventRows";

/**
 * 061d-2 / 061j / **064d**: 「エフェクトを表示する条件」カードの仕様テスト。
 *
 * ⚠⚠ **064d でこのファイルの半分が消えた。** 取り込み機能（テンプレートの一覧・削除・
 * 「配信画面でテスト表示」・出力先の選択）ごと無くなったので、
 * **検査する対象そのものが存在しない**ケースを落としてある。
 *
 * いま固定している不変条件:
 * - **イベント条件の行は `EFFECT_CONDITION_EVENT_TYPES` から機械的に作られる**
 *   （⚠ 063e 段 2 で出所が `MONETARY_EVENT_TYPES` から替わった＝チャンネルポイントは**条件表には出すが、お金ではない**）
 *   （「条件を追加」ボタンを作らない・7 種別目が増えたら行も増える）。
 * - ⚠⚠ **既定は全種別「エフェクトを出さない」**（061h で反転＝割り当てるまで何も出ない）。
 * - ⚠⚠ **空のキーワードは保存されない**（`"".includes(…)` が全コメントに一致する＝最大の失敗モード）。
 * - ⚠ **選択肢に無い割り当ては明示的に「出さない」へ落ちる**
 *   （`<select>` の value が選択肢に無いとブラウザが勝手に先頭を選ぶので、**明示的に**落とす先を書く）。
 * - ⚠⚠ **064d: カードは props を取らない**（条件の state を自分で持つ）。
 *   旧 `useEffectTemplates` は「テンプレートを削除したら、それを指す条件を戻す」という
 *   一覧と割り当ての**継ぎ目**のために在ったが、取り込み機能ごと消えたので継ぎ目も消えた。
 *
 * **テストは外部通信も OS 操作も一切行わない**（IPC も無い＝localStorage だけの純粋な画面）。
 */

const OBS_SOURCE_A = "きらきら演出";
const OBS_SOURCE_B = "紙吹雪";

/** 064d: テンプレートが消えたので、`<select>` に並ぶのは OBS のソースだけ。 */
const putObsSources = (names: string[] = [OBS_SOURCE_A, OBS_SOURCE_B]) =>
  localStorage.setItem(
    OBS_SOURCE_LIST_KEY,
    JSON.stringify({
      at: 1_700_000_000_000,
      sources: names.map((name) => ({ name, kind: "ffmpeg_source" })),
    }),
  );

/** 割り当ての `<select>` を種別のラベルで引く。 */
const selectFor = (label: string) =>
  screen.getByLabelText(`${label}のエフェクト`) as HTMLSelectElement;

/**
 * 061j: 保存値（**条件の配列**）を読む。
 *
 * ⚠ **生の JSON を読む**（`loadEffectConditions()` を通さない）——「画面の操作が
 * localStorage に何を書いたか」を見たいので、読み込み時の正規化を挟むと**書けていなくても通る**。
 */
interface StoredCondition {
  id: string;
  when: { type: string; eventType?: string; text?: string; match?: string };
  effect: { kind: string; sourceName?: string };
}
const stored = (): StoredCondition[] => {
  const raw = localStorage.getItem(EFFECT_ASSIGNMENTS_KEY);
  return raw === null ? [] : (JSON.parse(raw) as StoredCondition[]);
};
const storedById = (id: string): StoredCondition | undefined =>
  stored().find((c) => c.id === id);
const storedKeywords = (): StoredCondition[] =>
  stored().filter((c) => c.when.type === "keyword");

/**
 * ⚠⚠ **063d: カードはガチャの一覧だけを props で受ける**（条件の state は自分で持つ）。
 * ⚠ 既定は空配列＝「ガチャを 1 つも作っていない」状態で、
 * **既存のテストはこの状態のまま通る**（＝ガチャを足しても既存の選択肢の意味を変えていない）。
 */
const GACHA_A: GachaDefinition = {
  id: "g:1",
  name: "大当たりガチャ",
  prizes: [],
};
const Harness = ({
  gachas = [],
}: {
  gachas?: readonly GachaDefinition[];
} = {}) => <EffectAssignmentCard gachas={gachas} />;

const effectSelects = (): HTMLSelectElement[] =>
  screen
    .getAllByRole("combobox")
    .filter((el): el is HTMLSelectElement =>
      (el.getAttribute("aria-label") ?? "").endsWith("のエフェクト"),
    );

describe("EffectAssignmentCard", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  // --- 行の集合 ---------------------------------------------------------------------------------

  it("⚠⚠ イベント条件の行は条件表の種別ぶん最初から全部ある（061d の (2) はここでは維持）", () => {
    render(<Harness />);
    for (const row of EFFECT_EVENT_ROWS) {
      expect(screen.getByText(row.label)).toBeInTheDocument();
    }
    expect(effectSelects()).toHaveLength(EFFECT_CONDITION_EVENT_TYPES.size);
  });

  it("⚠⚠⚠ 063e 段 2: `EFFECT_EVENT_ROWS` と**画面が実際に描いた行**が一致する（鏡がずれない）", () => {
    // ⚠⚠⚠ **`EFFECT_EVENT_ROWS` にはプロダクションの消費者が 1 つも無い**（063e 段 2 の変異テストで判明）。
    //   行を実際に作っているのは `effectAssignments.ts` の `parseConditions` で、
    //   061j で条件が配列になったときに主導権が移り、この定数は取り残された。
    //   ⇒ **あちらだけを直しても画面は 1 ピクセルも変わらない**（＝黙って無効になる変更が書ける）。
    // ⚠ ここで「画面が描いた行」と突き合わせておけば、**片方だけ直した瞬間にレッドになる**
    //   ＝ 定数を残すなら、この 1 本が残す理由そのものである。
    render(<Harness />);
    const rendered = effectSelects().map((el) =>
      (el.getAttribute("aria-label") ?? "").replace(/のエフェクト$/, ""),
    );
    expect(rendered).toEqual(EFFECT_EVENT_ROWS.map((r) => r.label));
  });

  it("⚠⚠⚠ 063e 段 2: 「チャンネルポイント」の行が出る（＝ガチャの引き金として選べる）", () => {
    render(<Harness />);
    // ⚠ ラベルの出所は `EVENT_LABEL`（コメント一覧・ティッカー・読み上げと同じ表）。
    //   ここで新しい呼び名を発明していないことも併せて固定する。
    expect(screen.getByText("チャンネルポイント")).toBeInTheDocument();
  });

  it("⚠⚠ 063e 段 2: 「レイド」の行は出ない（ガチャは視聴者が対価を払って引くもの）", () => {
    // ⚠ 判断の記録は `viewerFormat.ts` の `EFFECT_CONDITION_EVENT_TYPES` の JSDoc が正。
    //   ⚠ レイドを足す変異はここと `viewerFormat.test.ts` の両方で死ぬ。
    render(<Harness />);
    expect(screen.queryByText("レイド")).not.toBeInTheDocument();
  });

  it("⚠⚠ スーパーチャットの行は「ビッツ」も含むと書く（wire 上 superchat で届くため）", () => {
    render(<Harness />);
    expect(screen.getByText(EFFECT_EVENT_LABEL.superchat)).toHaveTextContent(
      /ビッツ/,
    );
  });

  /**
   * ⚠⚠ **063a で期待値を 1 件増やし、063d でさらに作り直した 1 本。**
   * ⚠ **順序を固定していることがこのテストの意味**なので、
   * **先頭は「エフェクトを出さない」のまま**（061h ⑦-c）、ガチャは**末尾**に足してある。
   * ⚠⚠ 063d: ガチャの選択肢は**固定 1 個**ではなく、**一覧に登録されたぶんだけ**出る。
   */
  it("⚠⚠ 選択肢は「エフェクトを出さない」＋ OBS のソース＋登録済みのガチャ（順序も固定する）", () => {
    putObsSources([OBS_SOURCE_A]);
    render(<Harness gachas={[GACHA_A]} />);
    const options = within(selectFor(EFFECT_EVENT_LABEL.superchat)).getAllByRole(
      "option",
    );
    expect(options.map((o) => o.textContent)).toEqual([
      "エフェクトを出さない",
      OBS_SOURCE_A,
      "ガチャ: 大当たりガチャ",
    ]);
  });

  /**
   * ⚠⚠⚠ **063d で足した 1 本（穴 R）。**
   *
   * 指しているガチャが**一覧から消えている**とき、`<option>` を自前で足さないと
   * **ブラウザが先頭（「エフェクトを出さない」）を選び**、
   * 「消えたガチャを指していた」という事実そのものが画面から消える（061h ⑦-c と同型）。
   * ⚠ **黙って別のガチャへ化けないこと**が、この 1 本の意味である。
   */
  it("⚠⚠⚠ 消えたガチャを指していたら、警告を出しつつ値を保つ（先頭へ化けない）", () => {
    putObsSources([OBS_SOURCE_A]);
    localStorage.setItem(
      EFFECT_ASSIGNMENTS_KEY,
      JSON.stringify([
        {
          id: "event:superchat",
          when: { type: "event", eventType: "superchat" },
          effect: { kind: "gacha", gachaId: "g:9" },
        },
      ]),
    );
    render(<Harness gachas={[GACHA_A]} />);
    const select = selectFor(EFFECT_EVENT_LABEL.superchat);
    expect(select.value).toBe("gacha:g:9");
    expect(
      within(select)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toContain("ガチャ（削除されました）");
    expect(
      screen.getByText(
        "このガチャは削除されています。下の「ガチャ」から選び直してください。",
      ),
    ).toBeInTheDocument();
  });

  // --- 既定と保存 -------------------------------------------------------------------------------

  it("⚠⚠ 未保存の既定は全種別「エフェクトを出さない」（061h：割り当てるまで何も出ない）", () => {
    render(<Harness />);
    for (const select of effectSelects()) expect(select.value).toBe(NONE_VALUE);
    // ⚠ 既定のままなら**キーごと存在しない**（「未保存＝既定」を潰さない）。
    expect(localStorage.getItem(EFFECT_ASSIGNMENTS_KEY)).toBeNull();
  });

  it("OBS のソースを選ぶと保存される", () => {
    putObsSources([OBS_SOURCE_A]);
    render(<Harness />);
    fireEvent.change(selectFor(EFFECT_EVENT_LABEL.superchat), {
      target: { value: `${OBS_SOURCE_PREFIX}${OBS_SOURCE_A}` },
    });
    expect(storedById("event:superchat")?.effect).toEqual({
      kind: "obs-source",
      sourceName: OBS_SOURCE_A,
    });
  });

  it("⚠ 「エフェクトを出さない」へ戻すと、全部既定になった時点でキーごと消える", () => {
    putObsSources([OBS_SOURCE_A]);
    render(<Harness />);
    const select = selectFor(EFFECT_EVENT_LABEL.superchat);
    fireEvent.change(select, {
      target: { value: `${OBS_SOURCE_PREFIX}${OBS_SOURCE_A}` },
    });
    expect(localStorage.getItem(EFFECT_ASSIGNMENTS_KEY)).not.toBeNull();
    fireEvent.change(select, { target: { value: NONE_VALUE } });
    expect(localStorage.getItem(EFFECT_ASSIGNMENTS_KEY)).toBeNull();
  });

  it("⚠ 保存済みの割り当てが `<select>` に復元される", () => {
    putObsSources([OBS_SOURCE_A]);
    localStorage.setItem(
      EFFECT_ASSIGNMENTS_KEY,
      JSON.stringify([
        {
          id: "event:superchat",
          when: { type: "event", eventType: "superchat" },
          effect: { kind: "obs-source", sourceName: OBS_SOURCE_A },
        },
      ]),
    );
    render(<Harness />);
    expect(selectFor(EFFECT_EVENT_LABEL.superchat).value).toBe(
      `${OBS_SOURCE_PREFIX}${OBS_SOURCE_A}`,
    );
  });

  // --- 061j: キーワード条件 ----------------------------------------------------------------------

  it("キーワード条件を追加して確定すると保存される", () => {
    putObsSources([OBS_SOURCE_A]);
    render(<Harness />);
    fireEvent.click(screen.getByLabelText("条件を追加"));
    const input = screen.getByLabelText("キーワード 1") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "草" } });
    fireEvent.blur(input);
    expect(storedKeywords()).toHaveLength(1);
    expect(storedKeywords()[0].when.text).toBe("草");
  });

  it("⚠⚠ 空のキーワードは保存されない（`\"\".includes(…)` は全コメントに一致する）", () => {
    render(<Harness />);
    fireEvent.click(screen.getByLabelText("条件を追加"));
    const input = screen.getByLabelText("キーワード 1") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.blur(input);
    expect(storedKeywords()).toHaveLength(0);
  });

  it("⚠ 上限まで足すと「条件を追加」が押せなくなる", () => {
    localStorage.setItem(
      EFFECT_ASSIGNMENTS_KEY,
      JSON.stringify(
        Array.from({ length: KEYWORD_CONDITION_MAX }, (_, i) => ({
          id: `kw:${i + 1}`,
          when: { type: "keyword", text: `w${i}`, match: "contains" },
          effect: { kind: "none" },
        })),
      ),
    );
    render(<Harness />);
    expect((screen.getByLabelText("条件を追加") as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("キーワード条件を削除できる", () => {
    localStorage.setItem(
      EFFECT_ASSIGNMENTS_KEY,
      JSON.stringify([
        {
          id: "kw:1",
          when: { type: "keyword", text: "草", match: "contains" },
          effect: { kind: "none" },
        },
      ]),
    );
    render(<Harness />);
    fireEvent.click(screen.getAllByText("削除")[0]);
    expect(storedKeywords()).toHaveLength(0);
  });
});

describe("064b: 割り当て先の OBS ソース（純関数）", () => {
  const obsSources = [{ name: OBS_SOURCE_A }];
  const obs = (sourceName: string): EffectAssignment => ({
    kind: "obs-source",
    sourceName,
  });

  it("一覧に在る OBS ソースは `obs:<名前>`", () => {
    expect(effectSelectValue(obs(OBS_SOURCE_A), obsSources)).toBe(
      `${OBS_SOURCE_PREFIX}${OBS_SOURCE_A}`,
    );
  });

  it("⚠⚠ 一覧に無い名前は **明示的に** NONE_VALUE へ落ちる", () => {
    // ⚠⚠ **`!isObsSourceMissingFromList(...)` を外す変異は、この 1 行が必ずレッドにする。**
    //   ⚠ ブラウザの「先頭を選ぶ」既定に一切依存していないのが要点
    //   （選択肢を 1 つも描いていないので、先頭が何であっても結果は変わらない）。
    expect(effectSelectValue(obs("消えたソース"), obsSources)).toBe(NONE_VALUE);
  });

  it("⚠ 一覧を渡さなければ（既定）OBS ソースは NONE_VALUE へ落ちる", () => {
    expect(effectSelectValue(obs(OBS_SOURCE_A))).toBe(NONE_VALUE);
  });

  it("`isObsSourceMissingFromList` は none を「見つからない」にしない", () => {
    expect(isObsSourceMissingFromList({ kind: "none" }, [])).toBe(false);
  });

  // --- 逆変換（値の分解を 1 か所に閉じてある） ---------------------------------------------
  it("`obs:<名前>` を割り当てへ戻せる", () => {
    expect(effectSelectAssignment(`${OBS_SOURCE_PREFIX}${OBS_SOURCE_A}`)).toEqual(
      { kind: "obs-source", sourceName: OBS_SOURCE_A },
    );
  });

  it("⚠⚠ ソース名に `:` が含まれていても壊れない（`split` ではなく `slice`）", () => {
    // ⚠ `split(":")` で全部割る実装だと、この名前は**実在するのに選べなくなる**。
    expect(effectSelectAssignment(`${OBS_SOURCE_PREFIX}12:34 の演出`)).toEqual({
      kind: "obs-source",
      sourceName: "12:34 の演出",
    });
  });

  it("⚠ 未知の値・空の名前はすべて「出さない」へ倒れる", () => {
    for (const value of [NONE_VALUE, "", "???", OBS_SOURCE_PREFIX]) {
      expect(effectSelectAssignment(value)).toEqual({ kind: "none" });
    }
  });
});

describe("064b: 割り当て先の OBS ソース（画面）", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("取得済みの OBS ソースが選択肢に出る", async () => {
    putObsSources([OBS_SOURCE_A]);
    render(<Harness />);
    expect(
      within(selectFor(EFFECT_EVENT_LABEL.superchat)).getByRole("option", {
        name: OBS_SOURCE_A,
      }),
    ).toBeTruthy();
  });

  it("⚠ 一覧をまだ取っていなければ **OBS のソースの**選択肢は増えない（この画面は取りに行かない）", async () => {
    render(<Harness />);
    // ⚠ 064d: 一覧に由来する選択肢はゼロ（テンプレートの選択肢はもう無い）。
    // ⚠⚠ **063a で 1 → 2 になり、063d で 1 に戻った**——063a のガチャは
    //   「一覧に由来しない固定の選択肢」だったが、⚠ 063d では
    //   **ガチャも一覧（`gachas`）に由来する**ようになったので、
    //   ガチャを 1 つも作っていなければ選択肢も出ない。
    //   ⚠ このテストが守っているのは「**この画面が OBS へ取りに行かない**」ことなので、
    //   固定の選択肢が「出さない」1 つに戻っても意味は変わらない。
    const options = within(
      selectFor(EFFECT_EVENT_LABEL.superchat),
    ).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["エフェクトを出さない"]);
  });

  it("⚠⚠ 選ぶと obs-source の割り当てが保存される", async () => {
    putObsSources([OBS_SOURCE_A]);
    render(<Harness />);

    fireEvent.change(selectFor(EFFECT_EVENT_LABEL.superchat), {
      target: { value: `${OBS_SOURCE_PREFIX}${OBS_SOURCE_A}` },
    });

    expect(storedById("event:superchat")?.effect).toEqual({
      kind: "obs-source",
      sourceName: OBS_SOURCE_A,
    });
  });

  it("⚠⚠ 一覧に無い名前を指していたら「見つかりません」を出す", async () => {
    putObsSources(["別のソース"]);
    localStorage.setItem(
      EFFECT_ASSIGNMENTS_KEY,
      JSON.stringify([
        {
          id: "event:superchat",
          when: { type: "event", eventType: "superchat" },
          effect: { kind: "obs-source", sourceName: "消えたソース" },
        },
      ]),
    );
    render(<Harness />);
    expect(
      screen.getByText(/OBS にこの名前のソースが見つかりません/),
    ).toBeTruthy();
  });

  it("⚠⚠ 一覧を 1 度も取っていなければ「見つかりません」と断言しない", async () => {
    // ⚠ ここが緩むと、OBS のソース一覧を取る前に画面を開いただけで
    //   **設定は正しいのに全部「見つかりません」**と出る。
    localStorage.setItem(
      EFFECT_ASSIGNMENTS_KEY,
      JSON.stringify([
        {
          id: "event:superchat",
          when: { type: "event", eventType: "superchat" },
          effect: { kind: "obs-source", sourceName: OBS_SOURCE_A },
        },
      ]),
    );
    render(<Harness />);
    expect(
      screen.queryByText(/OBS にこの名前のソースが見つかりません/),
    ).toBeNull();
  });

  it("⚠ コメビュ窓が一覧を書き戻したら（storage）選択肢が増える", async () => {
    render(<Harness />);

    putObsSources([OBS_SOURCE_A]);
    fireEvent(
      window,
      new StorageEvent("storage", { key: OBS_SOURCE_LIST_KEY }),
    );

    expect(
      await screen.findAllByRole("option", {
        name: OBS_SOURCE_A,
      }),
    ).not.toHaveLength(0);
  });

});
