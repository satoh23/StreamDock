import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import {
  CHANNEL_POINT_REWARDS_KEY,
  EFFECT_ASSIGNMENTS_KEY,
  // 064b: 割り当て先に OBS 側のソースを出す（一覧はコメビュ窓が書いたものを読む）。
  OBS_SOURCE_LIST_KEY,
} from "../../features/comment-viewer/overlaySettings";
import { EffectAssignmentCard } from "./EffectAssignmentCard";
import type { GachaDefinition } from "./effectAssignments";
import {
  KEYWORD_CONDITION_MAX,
  CHANNEL_POINT_CONDITION_MAX,
  REWARD_TITLE_MAX_LENGTH,
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
import { loadRecentChannelPointRewards } from "../../features/comment-viewer/channelPointRewards";

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

  /**
   * ⚠⚠⚠ **063e 段 3-c: 「チャンネルポイント」の行（プルダウン）を消した。**
   *
   * 依頼者＝「**そもそもチャンネルポイント交換しただけで表示したいエフェクトなんか無い**んだから、
   * チャンネルポイントにあるプルダウンを消して、**必ずカスタム報酬ごとに**設定する形に」。
   *
   * ⚠⚠ **見出しの文字と取り違えないこと。** 段 3-c で下のブロックの見出しが
   * 「チャンネルポイント」になったので、⚠⚠⚠ **`getByText("チャンネルポイント")` は
   * いまも通ってしまう**（＝行が復活しても気づけない偽の緑）。
   * ⇒ **`<select>` の有無で見る**（`aria-label` は行にしか付かない）。
   */
  it("⚠⚠⚠ 063e 段 3-c: 「チャンネルポイント」のプルダウンは出ない（カスタム報酬ごとに設定する）", () => {
    render(<Harness />);
    expect(
      screen.queryByLabelText("チャンネルポイントのエフェクト"),
    ).not.toBeInTheDocument();
    // ⚠ 代わりに、カスタム報酬ごとのブロックの見出しとして出ている（唯一の入口）。
    expect(
      screen.getByRole("heading", { name: "チャンネルポイント" }),
    ).toBeInTheDocument();
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
  // --- 063e 段 3-b: チャンネルポイントの報酬ごと（1 紐づき＝1 行）-------------------------------

  /**
   * ⚠⚠⚠ **063e 段 3-b**（依頼者＝「**このチャネポ交換ならこれ、このチャネポ交換ならこのガチャ**
   * みたいにそれぞれ設定できるようにして欲しい／**それぞれの紐づきは 1 行で**／
   * **今はフォームの長さが長すぎる**」）。
   *
   * ⚠⚠ **段 3 のサブフォーム（条件表の行の下に開く「対象の報酬」欄）は削除した。**
   * ⇒ 下の「段 3 の欄がもう無い」検査が、**戻す変更を確実にレッドにする網**である。
   */
  const rewardRowInput = (n = 1): HTMLInputElement =>
    screen.getByLabelText(`カスタム報酬の名前 ${n}`) as HTMLInputElement;
  const addRewardRow = () =>
    fireEvent.click(screen.getByRole("button", { name: "カスタム報酬を追加" }));

  /**
   * ⚠⚠⚠ **依頼者の指摘（「フォームの長さが長すぎる」）に対する構造的な担保。**
   * 段 3 は条件表の行の下に**欄＋チップ＋説明文の 3 段**を常に開いていた。
   * ⚠ 1 件も紐づけていないときは**行が 0 本**であることをここで固定する。
   */
  it("⚠⚠⚠ 段 3 の「対象の報酬」欄はもう無い（既定では入力欄が 1 つも開かない）", () => {
    render(<Harness />);
    expect(screen.queryByLabelText("対象の報酬")).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("カスタム報酬の名前 1"),
    ).not.toBeInTheDocument();
  });

  it("＋ を押すと 1 行だけ生える（未確定なので、まだ保存されない）", () => {
    render(<Harness />);
    addRewardRow();
    expect(rewardRowInput()).toBeInTheDocument();
    expect(localStorage.getItem(EFFECT_ASSIGNMENTS_KEY)).toBeNull();
    // ⚠ 未確定行は 1 本だけ（＋ が押せなくなる）。
    expect(
      screen.getByRole("button", { name: "カスタム報酬を追加" }),
    ).toBeDisabled();
  });

  it("報酬名を入れて blur すると保存される", () => {
    render(<Harness />);
    addRewardRow();
    fireEvent.change(rewardRowInput(), { target: { value: "ガチャを引く" } });
    // ⚠ `onChange` では保存しない（打鍵ごとに `storage` を他窓へ撒かないため）。
    expect(localStorage.getItem(EFFECT_ASSIGNMENTS_KEY)).toBeNull();
    fireEvent.blur(rewardRowInput());
    expect(localStorage.getItem(EFFECT_ASSIGNMENTS_KEY)).toContain("cp:1");
    expect(localStorage.getItem(EFFECT_ASSIGNMENTS_KEY)).toContain(
      "ガチャを引く",
    );
  });

  it("Enter でも確定する", () => {
    render(<Harness />);
    addRewardRow();
    fireEvent.change(rewardRowInput(), { target: { value: "ガチャを引く" } });
    fireEvent.keyDown(rewardRowInput(), { key: "Enter" });
    expect(localStorage.getItem(EFFECT_ASSIGNMENTS_KEY)).toContain("cp:1");
  });

  /**
   * ⚠⚠⚠ **これが要望の本体である**——報酬ごとに**別のものを選べる**こと。
   * ⚠ 行ごとにエフェクトの `<select>` が独立していることを、**名前で引いて**確かめる。
   */
  it("⚠⚠⚠ 2 行作ると、それぞれに別のエフェクトを選べる", () => {
    // ⚠ 選べる先が要るので OBS の一覧を先に置く（`putObsSources` はこの画面の既存ヘルパ）。
    putObsSources([OBS_SOURCE_A]);
    render(<Harness />);
    addRewardRow();
    fireEvent.change(rewardRowInput(1), { target: { value: "ガチャを引く" } });
    fireEvent.blur(rewardRowInput(1));
    addRewardRow();
    fireEvent.change(rewardRowInput(2), { target: { value: "曲リクエスト" } });
    fireEvent.blur(rewardRowInput(2));

    expect(
      screen.getByLabelText("カスタム報酬 1 のエフェクト"),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("カスタム報酬 2 のエフェクト"),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("カスタム報酬 1 のエフェクト"), {
      target: { value: `${OBS_SOURCE_PREFIX}${OBS_SOURCE_A}` },
    });
    const stored = JSON.parse(
      localStorage.getItem(EFFECT_ASSIGNMENTS_KEY) ?? "[]",
    ) as { id: string; effect: { kind: string } }[];
    const row1 = stored.find((c) => c.id === "cp:1");
    const row2 = stored.find((c) => c.id === "cp:2");
    expect(row1?.effect.kind).toBe("obs-source");
    // ⚠⚠ **もう片方が巻き込まれないこと**（1 実装を共有していても値は行ごと）。
    expect(row2?.effect.kind).toBe("none");
  });

  it("削除すると、その行だけ消える", () => {
    render(<Harness />);
    addRewardRow();
    fireEvent.change(rewardRowInput(1), { target: { value: "ガチャを引く" } });
    fireEvent.blur(rewardRowInput(1));
    addRewardRow();
    fireEvent.change(rewardRowInput(2), { target: { value: "曲リクエスト" } });
    fireEvent.blur(rewardRowInput(2));

    fireEvent.click(screen.getAllByRole("button", { name: "削除" })[0]);
    expect(rewardRowInput(1).value).toBe("曲リクエスト");
    expect(
      screen.queryByLabelText("カスタム報酬の名前 2"),
    ).not.toBeInTheDocument();
  });

  /**
   * ⚠⚠⚠ **打ち間違いで紐づけが消えないこと**（段 3 とはここが逆になった）。
   * 段 3 の欄は「絞り込み」だったので空にするのが有効な操作だったが、
   * 段 3-b の欄は**行の主キー**なので、空を通すと**保存層が行ごと落とす**。
   */
  it("⚠⚠⚠ 既存の行を空にしても消えない（直前の確定値へ戻る）", () => {
    render(<Harness />);
    addRewardRow();
    fireEvent.change(rewardRowInput(), { target: { value: "ガチャを引く" } });
    fireEvent.blur(rewardRowInput());
    fireEvent.change(rewardRowInput(), { target: { value: "" } });
    fireEvent.blur(rewardRowInput());
    expect(rewardRowInput().value).toBe("ガチャを引く");
    expect(localStorage.getItem(EFFECT_ASSIGNMENTS_KEY)).toContain(
      "ガチャを引く",
    );
  });

  it("⚠ 未確定行は空のままでは保存されない（行は残るので打ち直せる）", () => {
    render(<Harness />);
    addRewardRow();
    fireEvent.blur(rewardRowInput());
    expect(rewardRowInput()).toBeInTheDocument();
    expect(localStorage.getItem(EFFECT_ASSIGNMENTS_KEY)).toBeNull();
  });

  it("⚠ 制御文字は確定時に落ちる", () => {
    render(<Harness />);
    addRewardRow();
    fireEvent.change(rewardRowInput(), { target: { value: "ガ\u0000チャ" } });
    fireEvent.blur(rewardRowInput());
    expect(rewardRowInput().value).toBe("ガチャ");
  });

  /**
   * ⚠⚠⚠ **同じ報酬名の行が 2 本あると、2 本目は永久に発火しない**（走査は最初の 1 件だけ）。
   * ⚠ 保存層で落とさず**画面で言う**——落とすと**打った文字列ごと黙って消える**。
   */
  it("⚠⚠⚠ 報酬名が重複した行には警告が出る（黙って動かない行を作らない）", () => {
    render(<Harness />);
    addRewardRow();
    fireEvent.change(rewardRowInput(1), { target: { value: "ガチャを引く" } });
    fireEvent.blur(rewardRowInput(1));
    expect(
      screen.queryByText(/上の行と同じカスタム報酬/),
    ).not.toBeInTheDocument();

    addRewardRow();
    // ⚠ 前後の空白・全角半角の違いでも「同じ行」として当たる（照合と同じ正規化）。
    fireEvent.change(rewardRowInput(2), { target: { value: " ガチャを引く " } });
    fireEvent.blur(rewardRowInput(2));
    expect(screen.getByText(/上の行と同じカスタム報酬/)).toBeInTheDocument();
  });

  /**
   * ⚠⚠⚠ **「極力画面操作は少なく」の本体**——実際に届いた報酬名を**押すだけ**で
   * **その報酬の行が 1 本生える**（打ち間違いが構造的に起きない）。
   * ⚠ 段 3 は「開いている欄に入れる」だったが、行が複数ある段 3-b では
   * **どの行に入れるかが決まらない**ので、押した報酬の行を作る形にした。
   */
  it("⚠⚠⚠ 最近届いた報酬名のチップを押すと、その報酬の行が生えて保存される", () => {
    localStorage.setItem(
      CHANNEL_POINT_REWARDS_KEY,
      JSON.stringify(["ガチャを引く", "読み上げ"]),
    );
    render(<Harness />);
    fireEvent.click(
      screen.getByRole("button", { name: "「ガチャを引く」の行を追加" }),
    );
    expect(rewardRowInput().value).toBe("ガチャを引く");
    expect(localStorage.getItem(EFFECT_ASSIGNMENTS_KEY)).toContain("cp:1");
  });

  /**
   * ⚠⚠ **チップは行が増えても複製されない**（＝ブロックに 1 つ）。
   * 段 3 は行ごとに出していたので、行が増えるほど画面が伸びた（「フォームが長すぎる」の一因）。
   */
  it("⚠⚠ チップは行が増えてもブロックに 1 組だけ", () => {
    localStorage.setItem(
      CHANNEL_POINT_REWARDS_KEY,
      JSON.stringify(["ガチャを引く", "読み上げ"]),
    );
    render(<Harness />);
    fireEvent.click(
      screen.getByRole("button", { name: "「ガチャを引く」の行を追加" }),
    );
    expect(
      screen.getAllByRole("button", { name: /の行を追加$/ }),
    ).toHaveLength(2);
  });

  /**
   * ⚠⚠ **既に行がある報酬のチップは押せない**——押せると
   * **永久に発火しない 2 本目**を 1 クリックで作れてしまう。
   * ⚠ 消さずに押せない形で残すのは、「まだ届いていない」のか「もう足した」のかを
   * **画面から読めるようにする**ためである。
   */
  it("⚠⚠ 既に行がある報酬のチップは押せない（重複行を 1 クリックで作らせない）", () => {
    localStorage.setItem(
      CHANNEL_POINT_REWARDS_KEY,
      JSON.stringify(["ガチャを引く", "読み上げ"]),
    );
    render(<Harness />);
    fireEvent.click(
      screen.getByRole("button", { name: "「ガチャを引く」の行を追加" }),
    );
    expect(
      screen.getByRole("button", { name: "「ガチャを引く」の行を追加" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "「読み上げ」の行を追加" }),
    ).not.toBeDisabled();
  });

  it("⚠⚠ 届いた報酬が 1 件も無ければチップは出ない（「候補なし」とも書かない）", () => {
    render(<Harness />);
    expect(
      screen.queryByRole("button", { name: /の行を追加$/ }),
    ).not.toBeInTheDocument();
  });

  it("⚠ 壊れた保存値のチップは出ない（その要素だけ落ちる）", () => {
    localStorage.setItem(
      CHANNEL_POINT_REWARDS_KEY,
      JSON.stringify(["よい報酬", 123, ""]),
    );
    render(<Harness />);
    expect(screen.getAllByRole("button", { name: /の行を追加$/ })).toHaveLength(
      1,
    );
  });

  /* ⚠⚠⚠ **2026-08-31（依頼者指示）: 「紐づけていないカスタム報酬では何も出ない」
     「自動報酬には反応しない」の 2 文を画面から削除したので、その存在検査も外した。**
     ⚠ **JSDoc 記法にしないこと**（review Q-3）——`it()` を消した跡に JSDoc を残すと、
     直後の `${CHANNEL_POINT_CONDITION_MAX} 件まで足せる` のドキュメントとして読まれてしまう。
     ⚠⚠ **消えた保証を正直に書いておく**: 自動報酬（「ハイライトされたメッセージ」など）の
     名前を打った人は**黙って永久に鳴らない**（画面にもログにも理由が出ない）。
     ⚠ 文言を書き戻すときは、この検査も一緒に戻すこと。
     ⚠⚠ **ただし「語を狭める」規律だけは下の検査で維持している**（review Q-5）。 */

  /**
   * ⚠⚠⚠ **review Q-5（2026-08-31）: 文言を戻さずに「語を狭める」規律だけを固定する。**
   *
   * 反応するのは `channel.channel_points_custom_reward_redemption.add` の 1 本だけで、
   * Twitch 既定の**自動報酬**は `...automatic_reward_redemption.add` という**別の購読**で届く
   * （⚠ **取っていない**）。⇒ 画面が裸の「報酬」と書くと、自動報酬の名前を打った人が
   * **黙って永久に鳴らない**（061a Q-1 が最も嫌う壊れ方）。
   *
   * ⚠⚠ **説明文を消した後、この規律を担保していたのは `EffectAssignmentCard.tsx` のコメント 1 本だけ**
   * になっていた（旧「ハイライトされたメッセージ」の存在検査が消えたため）。
   * ⇒ **文言の存在検査ではなく「裸の『報酬』が出ないこと」の検査**にすれば、依頼者の削除指示と両立する。
   *
   * ⚠ 再修正トリガー＝**自動報酬の購読も取るようになったとき**（そのときは語を広げてよいので本検査を外す）。
   */
  it("⚠⚠⚠ 可視文言・aria-label に裸の「報酬」が出ない（必ず「カスタム報酬」と書く）", () => {
    const { container } = render(<Harness />);
    const texts = [
      container.textContent ?? "",
      ...Array.from(container.querySelectorAll("[aria-label]")).map(
        (el) => el.getAttribute("aria-label") ?? "",
      ),
      ...Array.from(container.querySelectorAll("[placeholder]")).map(
        (el) => el.getAttribute("placeholder") ?? "",
      ),
    ];
    for (const text of texts) {
      // 「カスタム報酬」を取り除いた残りに「報酬」が残っていたら、それが裸の「報酬」。
      expect(text.replace(/カスタム報酬/g, "")).not.toContain("報酬");
    }
  });

  it(`⚠ ${CHANNEL_POINT_CONDITION_MAX} 件まで足せる（超えたら ＋ が押せない）`, () => {
    const rows = Array.from(
      { length: CHANNEL_POINT_CONDITION_MAX },
      (_, i) => ({
        id: `cp:${i + 1}`,
        when: { type: "channelpoint", rewardTitle: `報酬${i + 1}` },
        effect: { kind: "none" },
      }),
    );
    localStorage.setItem(EFFECT_ASSIGNMENTS_KEY, JSON.stringify(rows));
    render(<Harness />);
    expect(
      screen.getByRole("button", { name: "カスタム報酬を追加" }),
    ).toBeDisabled();
  });

  /**
   * ⚠⚠⚠ **上限が 2 か所にある**（`effectAssignments.ts` と `channelPointRewards.ts`）。
   * ⚠ 片方だけ短いと「押せるのに保存で落ちる」、片方だけ長いと「押したのに当たらない」
   * ——どちらも**黙って**起きる。⇒ 一致をここで固定する。
   */
  it("⚠⚠⚠ 入力欄の上限と、覚える側の上限が一致している", () => {
    render(<Harness />);
    addRewardRow();
    expect(rewardRowInput().maxLength).toBe(REWARD_TITLE_MAX_LENGTH);
    // ⚠ 覚える側（`channelPointRewards.ts`）は 45 文字ちょうどを受け入れ、46 で落とす。
    localStorage.setItem(
      CHANNEL_POINT_REWARDS_KEY,
      JSON.stringify(["あ".repeat(REWARD_TITLE_MAX_LENGTH)]),
    );
    expect(loadRecentChannelPointRewards()).toHaveLength(1);
    localStorage.setItem(
      CHANNEL_POINT_REWARDS_KEY,
      JSON.stringify(["あ".repeat(REWARD_TITLE_MAX_LENGTH + 1)]),
    );
    expect(loadRecentChannelPointRewards()).toHaveLength(0);
  });
});
