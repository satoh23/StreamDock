import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EFFECT_ASSIGNMENTS_KEY } from "../../features/comment-viewer/overlaySettings";
import { MONETARY_EVENT_TYPES } from "../comment-viewer/viewerFormat";
import {
  addKeywordCondition,
  assignedTemplateIds,
  clearAllEffectConditions,
  clearEffectConditionsForTemplate,
  createEffectMatcher,
  DEFAULT_EFFECT_OUTPUT,
  effectConditionCount,
  EFFECT_OUTPUT_LABEL,
  EFFECT_OUTPUT_WINDOW_TITLE,
  EFFECT_OUTPUTS,
  hasEffectConditions,
  isUsableKeyword,
  KEYWORD_CONDITION_MAX,
  KEYWORD_COOLDOWN_MS,
  KEYWORD_MAX_LENGTH,
  loadEffectConditions,
  removeCondition,
  sanitizeKeywordInput,
  saveEffectConditions,
  setConditionEffect,
  setConditionOutput,
  updateKeywordCondition,
  type EffectCondition,
  type EffectConditions,
  type EffectOutput,
} from "./effectAssignments";
import { CONDITION_COOLDOWN_MAX_MS } from "./effectTrigger";

/**
 * 061d-2 / 061h / **061j**: 「どんなコメントで、どのエフェクトを出すか」の仕様テスト。
 *
 * ⚠⚠ **この 1 ファイルが固定している最重要の不変条件は 2 つ。**
 *
 * **① 読み取れなかったら「出さない」へ倒れる**（⚠ **061h で 061d-2 の ⑪ を反転した**）。
 * 061d-2 は逆に「`{"kind":"none"}` 以外はすべて組み込みへ倒す」を固定していた——当時は
 * 組み込み意匠が既定の表示手段で、「アップデートしたら配信画面からエフェクトが消えた」が
 * 最悪の壊れ方だったため。⚠ **061h で組み込みを廃止したので前提ごと消えた**:
 *   - 倒れる先が**構造的に存在しない**（`EffectKind` の variant は template だけ）
 *   - 実害の向きが逆＝「**頼んでいない演出が黙って出る**」ほうが今の運用では大きい
 *   - 「出ない」は main 窓の警告で**観測できる**壊れ方である
 * ＝ **「出す」側へ倒れてよいのは、ユーザーが自分でテンプレートを選んだときだけ。**
 *
 * **② ⚠⚠ 061j: 空のキーワードが保存経路にも読み込み経路にも通らない。**
 * `"".includes(…)` は**全コメントに一致する**＝配信画面がエフェクトで埋まる。
 * **本タスクで最も危険な失敗モード**なので、保存時・読み込み時の**両方**を別々のケースで固定する。
 * ⚠ 空白の判定は **照合に使う値（正規化後）** に対して行う。⚠⚠ **起票時の「生の `trim()` では
 * 全角スペースを取りこぼす」は誤りだった**（JS の `trim()` は `U+3000` も落とす＝ミューテーション⑮-b が
 * 等価変異として生存）。理由の全文は `effectAssignments.ts` の `normalizeForMatch` の訂正メモが正。
 *
 * localStorage 以外の外部境界は使わない（IPC も通信も無い純ロジック）。
 */

const NONE = { kind: "none" } as const;
const UUID = "93c76e02-1111-4222-8333-444455556666";
const UUID2 = "0f0e0d0c-1111-4222-8333-444455556666";
const TPL = { kind: "template", templateId: UUID } as const;

const EVENT_TYPES = [...MONETARY_EVENT_TYPES];

/**
 * 061k: **061j までの `resolveEffectMatch` 相当**（＝コーナー窓の matcher）。
 *
 * ⚠ 061j までの全ケースは「窓が 1 本だった時代」の仕様なので、この 1 本で**無改変のまま通る**
 * （既定の出力先が `"corner"` だから＝判断 4-b の「既存ユーザーの見え方が変わらない」の裏取りでもある）。
 * ⚠ **出力先の絞り込みそのものを見るケースは別に置く**（下の「061k: 出力先」節）。
 * ⚠ factory をモジュールの先頭で 1 回作っているが、**返す関数は呼ばれるたびに localStorage を読む**ので
 * 各ケースの `beforeEach` でのクリアが効く（061k が「読み直しの規律を変えていない」ことの副次的な担保）。
 */
const resolveEffectMatch = createEffectMatcher(DEFAULT_EFFECT_OUTPUT);

/** 保存値をそのまま読む（＝「書き戻していない」ことの確認にも使う）。 */
const raw = (): string | null => localStorage.getItem(EFFECT_ASSIGNMENTS_KEY);

const eventRows = (conditions: EffectConditions) =>
  conditions.filter((c) => c.when.type === "event");
const keywordRows = (conditions: EffectConditions) =>
  conditions.filter((c) => c.when.type === "keyword");

/** キーワード条件 1 件（保存形と同じ形）。 */
const kw = (
  n: number,
  text: string,
  over: Partial<{ match: string; effect: unknown }> = {},
): unknown => ({
  id: `kw:${n}`,
  when: { type: "keyword", text, match: over.match ?? "contains" },
  effect: over.effect ?? TPL,
});

/** イベント条件 1 件（保存形と同じ形）。 */
const ev = (eventType: string, effect: unknown = TPL): unknown => ({
  id: `event:${eventType}`,
  when: { type: "event", eventType },
  effect,
});

/** ⚠ イベント条件が 6 件ちょうどで、`MONETARY_EVENT_TYPES` と同じ並びであること。 */
const expectEventRowShape = (conditions: EffectConditions) => {
  const rows = eventRows(conditions);
  expect(rows.map((c) => (c.when.type === "event" ? c.when.eventType : ""))).toEqual(
    EVENT_TYPES,
  );
  expect(rows.map((c) => c.id)).toEqual(EVENT_TYPES.map((t) => `event:${t}`));
};

/** 全条件が「エフェクトを出さない」であること（＝ 061h 以降の既定の形）。 */
const expectAllNone = (conditions: EffectConditions) => {
  expectEventRowShape(conditions);
  for (const c of conditions) expect(c.effect).toEqual(NONE);
};

describe("effectAssignments（061j: 条件の配列）", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  // --- フォールバック（⚠ すべて「出さない」へ・061h） --------------------------------------------

  it("⚠⚠ 未保存なら全種別が「エフェクトを出さない」（＝条件を作るまで配信画面に何も出ない）", () => {
    expectAllNone(loadEffectConditions());
    expect(keywordRows(loadEffectConditions())).toHaveLength(0);
  });

  it("⚠⚠ 不正な JSON は全種別「出さない」へ倒れる", () => {
    localStorage.setItem(EFFECT_ASSIGNMENTS_KEY, "{ broken");
    expectAllNone(loadEffectConditions());
  });

  it("⚠⚠ localStorage が例外を投げても全種別「出さない」へ倒れる", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expectAllNone(loadEffectConditions());
  });

  it("⚠ ルートが文字列・数値・null でも全種別「出さない」へ倒れる", () => {
    for (const value of ['"x"', "42", "null", "true"]) {
      localStorage.setItem(EFFECT_ASSIGNMENTS_KEY, value);
      expectAllNone(loadEffectConditions());
    }
  });

  it("⚠ 配列の要素が非オブジェクト・`when` が壊れていても、その 1 件だけ落ちる", () => {
    localStorage.setItem(
      EFFECT_ASSIGNMENTS_KEY,
      JSON.stringify([null, 42, "x", { when: null }, { when: { type: "??" } }, ev("gift")]),
    );
    const conditions = loadEffectConditions();
    expectEventRowShape(conditions);
    expect(conditions.find((c) => c.id === "event:gift")?.effect).toEqual(TPL);
  });

  it("⚠⚠ 未知の kind（063 の gacha を古いビルドが読んだ場合）は「出さない」へ倒れる", () => {
    localStorage.setItem(
      EFFECT_ASSIGNMENTS_KEY,
      JSON.stringify([ev("superchat", { kind: "gacha", tableId: "x" })]),
    );
    expect(
      loadEffectConditions().find((c) => c.id === "event:superchat")?.effect,
    ).toEqual(NONE);
  });

  it("⚠⚠ templateId が uuid の形でなければ「出さない」へ倒れる（IPC まで届かせない）", () => {
    for (const bad of ["../x", "", "not-a-uuid", `${UUID}/x`]) {
      localStorage.setItem(
        EFFECT_ASSIGNMENTS_KEY,
        JSON.stringify([ev("superchat", { kind: "template", templateId: bad })]),
      );
      expect(
        loadEffectConditions().find((c) => c.id === "event:superchat")?.effect,
      ).toEqual(NONE);
    }
  });

  // --- 新規 13: 判断 2（イベント条件を読み込み時に作り直す） --------------------------------------

  it("⚠⚠ イベント条件は必ず 6 件ちょうど・`MONETARY_EVENT_TYPES` と同じ並びになる", () => {
    // 1 件だけ保存されていても 6 件へ復元される（欠けは「出さない」で埋める）。
    localStorage.setItem(EFFECT_ASSIGNMENTS_KEY, JSON.stringify([ev("gift")]));
    const conditions = loadEffectConditions();
    expectEventRowShape(conditions);
    expect(eventRows(conditions)).toHaveLength(6);
    for (const c of eventRows(conditions)) {
      expect(c.effect).toEqual(c.id === "event:gift" ? TPL : NONE);
    }
  });

  it("⚠⚠ イベント条件が重複していたら **先勝ち**で 1 件に潰れる（画面の並びと使う値を一致させる）", () => {
    // ⚠ 「後勝ち」だと**画面（最初の行を描く）と実際に使われる値が食い違う**。
    localStorage.setItem(
      EFFECT_ASSIGNMENTS_KEY,
      JSON.stringify([
        ev("superchat", { kind: "template", templateId: UUID }),
        ev("superchat", { kind: "template", templateId: UUID2 }),
      ]),
    );
    const conditions = loadEffectConditions();
    expect(eventRows(conditions)).toHaveLength(6);
    expect(
      conditions.find((c) => c.id === "event:superchat")?.effect,
    ).toEqual({ kind: "template", templateId: UUID });
  });

  it("⚠⚠ 未知の eventType の条件は捨てられる（UI に行が無い＝表現できない条件を残さない）", () => {
    localStorage.setItem(
      EFFECT_ASSIGNMENTS_KEY,
      // ⚠ "bits" は `MONETARY_EVENT_TYPES` に**無い**（ビッツは superchat に含まれる）。
      JSON.stringify([ev("bits"), ev("__proto__"), ev("chat")]),
    );
    const conditions = loadEffectConditions();
    expectEventRowShape(conditions);
    expect(conditions.every((c) => c.effect.kind === "none")).toBe(true);
  });

  // --- 新規 12: 判断 8（旧形式からの移行） -------------------------------------------------------

  it("⚠⚠ 旧形式（Record）の保存値がイベント条件 6 件へ変換される", () => {
    // 061i までの保存形。⚠ 変換しないと **061i で設定した条件が全部消える**
    //   （ルートの形が Object → Array に変わったため、061h の前方互換の仕組みが効かない）。
    localStorage.setItem(
      EFFECT_ASSIGNMENTS_KEY,
      JSON.stringify({
        superchat: { kind: "template", templateId: UUID },
        subscription: { kind: "none" },
        bits: { kind: "template", templateId: UUID2 },
      }),
    );
    const conditions = loadEffectConditions();
    expectEventRowShape(conditions);
    expect(conditions.find((c) => c.id === "event:superchat")?.effect).toEqual(TPL);
    expect(conditions.find((c) => c.id === "event:subscription")?.effect).toEqual(NONE);
    // ⚠ 旧形式の未知キー（"bits"）も捨てる。
    expect(conditions.some((c) => c.id === "event:bits")).toBe(false);
    expect(keywordRows(conditions)).toHaveLength(0);
  });

  it("⚠⚠ 旧形式は**読んだだけでは書き戻さない**（読み込みが副作用を持たない）", () => {
    const before = JSON.stringify({ superchat: { kind: "template", templateId: UUID } });
    localStorage.setItem(EFFECT_ASSIGNMENTS_KEY, before);
    loadEffectConditions();
    loadEffectConditions();
    expect(raw()).toBe(before);
  });

  it("⚠ 旧形式でも `builtin-monetary`（061h で廃止）は「出さない」へ倒れる", () => {
    localStorage.setItem(
      EFFECT_ASSIGNMENTS_KEY,
      JSON.stringify({ superchat: { kind: "builtin-monetary" } }),
    );
    expectAllNone(loadEffectConditions());
  });

  // --- 新規 10: ⚠⚠ 空キーワード（本タスク最大の失敗モード） --------------------------------------

  it("⚠⚠ 空文字・空白のみのキーワードは **保存されない**", () => {
    // ⚠ 全角スペース（U+3000）や半角スペースだけの値も落ちること。
    //   ⚠ コメントに全角スペースそのものは書かない（`no-irregular-whitespace`）。文字列の中は許される。
    for (const text of ["", " ", "　", " 　 "]) {
      localStorage.clear();
      saveEffectConditions([
        {
          id: "kw:1",
          when: { type: "keyword", text, match: "contains" },
          effect: TPL,
          output: DEFAULT_EFFECT_OUTPUT,
        },
      ]);
      expect(keywordRows(loadEffectConditions())).toHaveLength(0);
      // ⚠ 条件が 1 件も残らないので、キーごと消えている（未保存＝既定と同じ状態）。
      expect(raw()).toBeNull();
    }
  });

  it("⚠⚠ 空のキーワードが保存値に混ざっていても **読み込みで落ちる**（手編集への 2 枚目）", () => {
    localStorage.setItem(
      EFFECT_ASSIGNMENTS_KEY,
      JSON.stringify([kw(1, ""), kw(2, "　"), kw(3, "草")]),
    );
    const rows = keywordRows(loadEffectConditions());
    expect(rows).toHaveLength(1);
    expect(rows[0].when.type === "keyword" && rows[0].when.text).toBe("草");
  });

  it("⚠⚠ 空のキーワードが混ざっていても **全コメントに一致しない**（失敗モードそのものの否定）", () => {
    localStorage.setItem(
      EFFECT_ASSIGNMENTS_KEY,
      JSON.stringify([kw(1, ""), kw(2, "　")]),
    );
    // ⚠ 「読み込みで落ちる」だけでなく、**照合の結果**として何も当たらないことを別に見る
    //   （落とし方を変えても、この 1 行が失敗モードの再発を止める）。
    for (const text of ["", "こんばんは", "草", "a"]) {
      expect(resolveEffectMatch({ eventType: "chat", text })).toBeNull();
    }
  });

  it("⚠ `isUsableKeyword` は照合に使う値で空を判定する（UI と保存層が同じ規則を見る）", () => {
    expect(isUsableKeyword("")).toBe(false);
    expect(isUsableKeyword(" ")).toBe(false);
    // ⚠ 全角スペースだけの値も false。⚠⚠ **これは `text.trim()` でも同じ結果になる**
    //   （起票時は「生の trim では取りこぼす」と想定していたが誤りだった＝⑮-b は等価変異）。
    expect(isUsableKeyword("　")).toBe(false);
    expect(isUsableKeyword("草")).toBe(true);
    expect(isUsableKeyword(" 草 ")).toBe(true);
  });

  // --- 新規 11: 判断 9 のその他の制限 ------------------------------------------------------------

  it("⚠ 32 文字を超えるキーワードは落ちる（境界ちょうどは通る）", () => {
    const ok = "あ".repeat(KEYWORD_MAX_LENGTH);
    const ng = "あ".repeat(KEYWORD_MAX_LENGTH + 1);
    localStorage.setItem(EFFECT_ASSIGNMENTS_KEY, JSON.stringify([kw(1, ok), kw(2, ng)]));
    const rows = keywordRows(loadEffectConditions());
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("kw:1");
  });

  it("⚠ 文字数は**コードポイント**で数える（絵文字 1 文字を 2 と数えない）", () => {
    // 32 個の絵文字＝ UTF-16 では 64 コード単位。⚠ `String.length` で数える実装だと落ちる。
    const emoji = "😀".repeat(KEYWORD_MAX_LENGTH);
    localStorage.setItem(EFFECT_ASSIGNMENTS_KEY, JSON.stringify([kw(1, emoji)]));
    expect(keywordRows(loadEffectConditions())).toHaveLength(1);
  });

  it("⚠ 制御文字を含むキーワードは落ちる", () => {
    localStorage.setItem(
      EFFECT_ASSIGNMENTS_KEY,
      JSON.stringify([kw(1, "草\u0000"), kw(2, "草\u007f"), kw(3, "草")]),
    );
    const rows = keywordRows(loadEffectConditions());
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("kw:3");
  });

  it("⚠ 21 件目以降のキーワード条件は落ちる（走査コストの上限）", () => {
    const many = Array.from({ length: KEYWORD_CONDITION_MAX + 5 }, (_, i) =>
      kw(i + 1, `w${i}`),
    );
    localStorage.setItem(EFFECT_ASSIGNMENTS_KEY, JSON.stringify(many));
    expect(keywordRows(loadEffectConditions())).toHaveLength(KEYWORD_CONDITION_MAX);
  });

  it("⚠ 未知の `match` は落とす（`contains` へ倒すと「完全一致のつもりが部分一致で出る」）", () => {
    localStorage.setItem(
      EFFECT_ASSIGNMENTS_KEY,
      JSON.stringify([kw(1, "草", { match: "regex" }), kw(2, "草", { match: "exact" })]),
    );
    const rows = keywordRows(loadEffectConditions());
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("kw:2");
  });

  it("⚠ id が `kw:<数字>` の形でないキーワード条件は落ちる（クールダウンのキーの形を保つ）", () => {
    localStorage.setItem(
      EFFECT_ASSIGNMENTS_KEY,
      JSON.stringify([
        { id: "x", when: { type: "keyword", text: "草", match: "contains" }, effect: TPL },
        { id: "kw:a", when: { type: "keyword", text: "草", match: "contains" }, effect: TPL },
        kw(7, "草"),
      ]),
    );
    const rows = keywordRows(loadEffectConditions());
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("kw:7");
  });

  it("⚠ id が重複したキーワード条件は先勝ちで 1 件に潰れる", () => {
    localStorage.setItem(
      EFFECT_ASSIGNMENTS_KEY,
      JSON.stringify([kw(1, "あ"), kw(1, "い")]),
    );
    const rows = keywordRows(loadEffectConditions());
    expect(rows).toHaveLength(1);
    expect(rows[0].when.type === "keyword" && rows[0].when.text).toBe("あ");
  });

  it("⚠ `sanitizeKeywordInput` は制御文字を落として 32 コードポイントで詰める（UI 側の整形）", () => {
    expect(sanitizeKeywordInput("草\u0000生")).toBe("草生");
    expect([...sanitizeKeywordInput("あ".repeat(40))]).toHaveLength(KEYWORD_MAX_LENGTH);
    // ⚠ サロゲートペアを割らない。
    expect([...sanitizeKeywordInput("😀".repeat(40))].every((c) => c === "😀")).toBe(true);
  });

  // --- 保存・削除条件（⑥） ----------------------------------------------------------------------

  it("保存した条件を読み戻せる（イベント・キーワードの両方）", () => {
    saveEffectConditions([
      {
        id: "event:superchat",
        when: { type: "event", eventType: "superchat" },
        effect: TPL,
        output: DEFAULT_EFFECT_OUTPUT,
      },
      {
        id: "kw:1",
        when: { type: "keyword", text: "草", match: "exact" },
        effect: TPL,
        output: DEFAULT_EFFECT_OUTPUT,
      },
    ]);
    const conditions = loadEffectConditions();
    expect(conditions.find((c) => c.id === "event:superchat")?.effect).toEqual(TPL);
    const rows = keywordRows(conditions);
    expect(rows).toHaveLength(1);
    expect(rows[0].when).toEqual({ type: "keyword", text: "草", match: "exact" });
  });

  it("⚠ イベント条件が全部「出さない」かつキーワード 0 件ならキーごと消す（未保存と同じ状態に潰す）", () => {
    localStorage.setItem(EFFECT_ASSIGNMENTS_KEY, JSON.stringify([ev("gift")]));
    saveEffectConditions(loadEffectConditions().map((c) => ({ ...c, effect: NONE })));
    expect(raw()).toBeNull();
  });

  it("⚠⚠ キーワード条件が 1 件でも在ればキーを消さない（打った文字列を勝手に捨てない）", () => {
    // ⚠ **エフェクトが「出さない」でも消さない**のが要点——キーワードは**ユーザーのデータ**である。
    saveEffectConditions([
      {
        id: "kw:1",
        when: { type: "keyword", text: "草", match: "contains" },
        effect: NONE,
        output: DEFAULT_EFFECT_OUTPUT,
      },
    ]);
    expect(raw()).not.toBeNull();
    const rows = keywordRows(loadEffectConditions());
    expect(rows).toHaveLength(1);
    expect(rows[0].effect).toEqual(NONE);
  });

  it("⚠ 保存できない環境でも例外を投げない（表示は既定で続く）", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() =>
      saveEffectConditions([
        {
          id: "event:gift",
          when: { type: "event", eventType: "gift" },
          effect: TPL,
          output: DEFAULT_EFFECT_OUTPUT,
        },
      ]),
    ).not.toThrow();
  });

  // --- 変更 API（すべて「読む → 変える → 保存 → 読み直す」） -------------------------------------

  it("`setConditionEffect` はイベント条件にもキーワード条件にも効く", () => {
    addKeywordCondition({ text: "草", match: "contains" }, NONE);
    setConditionEffect("event:superchat", TPL);
    setConditionEffect("kw:1", { kind: "template", templateId: UUID2 });
    const conditions = loadEffectConditions();
    expect(conditions.find((c) => c.id === "event:superchat")?.effect).toEqual(TPL);
    expect(conditions.find((c) => c.id === "kw:1")?.effect).toEqual({
      kind: "template",
      templateId: UUID2,
    });
  });

  it("`updateKeywordCondition` はキーワードと当て方を差し替える", () => {
    addKeywordCondition({ text: "草", match: "contains" }, TPL);
    updateKeywordCondition("kw:1", { text: "こんばん", match: "exact" });
    expect(keywordRows(loadEffectConditions())[0].when).toEqual({
      type: "keyword",
      text: "こんばん",
      match: "exact",
    });
  });

  it("⚠ `removeCondition` にイベント条件の id を渡してもイベント行は消えない（構造で守る）", () => {
    setConditionEffect("event:gift", TPL);
    removeCondition("event:gift");
    const conditions = loadEffectConditions();
    // ⚠ 6 行は必ず作り直されるので「イベント条件が 5 行になる」状態は作れない。
    expectEventRowShape(conditions);
    // ⚠ ただし effect は消える（保存値から落ちるため）＝ 呼び出し側でガードを書かなくてよい。
    expect(conditions.find((c) => c.id === "event:gift")?.effect).toEqual(NONE);
  });

  // --- 新規 14: 判断 3（id の採番） --------------------------------------------------------------

  it("⚠⚠ キーワード条件の id は単調増加で、削除しても再利用されない", () => {
    addKeywordCondition({ text: "あ", match: "contains" }, TPL);
    addKeywordCondition({ text: "い", match: "contains" }, TPL);
    expect(keywordRows(loadEffectConditions()).map((c) => c.id)).toEqual([
      "kw:1",
      "kw:2",
    ]);
    // ⚠ **1 件目を消しても詰めない**——`kw:1` を再利用すると、消した条件のクールダウンを
    //   別の条件が引き継ぐ（`lastConditionAt` のキーが id だから）。
    removeCondition("kw:1");
    addKeywordCondition({ text: "う", match: "contains" }, TPL);
    expect(keywordRows(loadEffectConditions()).map((c) => c.id)).toEqual([
      "kw:2",
      "kw:3",
    ]);
  });

  // --- 復帰導線 ---------------------------------------------------------------------------------

  it("⚠⚠ 「すべて「表示しない」に戻す」で全条件が「出さない」へ戻る（復帰導線）", () => {
    setConditionEffect("event:superchat", TPL);
    addKeywordCondition({ text: "草", match: "contains" }, TPL);
    const next = clearAllEffectConditions();
    for (const c of next) expect(c.effect).toEqual(NONE);
    expect(effectConditionCount(next)).toBe(0);
    expect(hasEffectConditions(next)).toBe(false);
  });

  it("⚠⚠ 復帰導線でも**キーワードそのものは消さない**（リセットではない）", () => {
    addKeywordCondition({ text: "草", match: "exact" }, TPL);
    clearAllEffectConditions();
    const rows = keywordRows(loadEffectConditions());
    expect(rows).toHaveLength(1);
    expect(rows[0].when).toEqual({ type: "keyword", text: "草", match: "exact" });
    expect(rows[0].effect).toEqual(NONE);
  });

  it("⚠⚠ テンプレート削除時、それを使っている条件だけが「出さない」へ戻る（キーワードも対象）", () => {
    setConditionEffect("event:superchat", TPL);
    setConditionEffect("event:gift", { kind: "template", templateId: UUID2 });
    addKeywordCondition({ text: "草", match: "contains" }, TPL);
    const next = clearEffectConditionsForTemplate(UUID);
    expect(next.find((c) => c.id === "event:superchat")?.effect).toEqual(NONE);
    expect(next.find((c) => c.id === "kw:1")?.effect).toEqual(NONE);
    // ⚠ 他のテンプレートを指す条件は巻き添えにしない。
    expect(next.find((c) => c.id === "event:gift")?.effect).toEqual({
      kind: "template",
      templateId: UUID2,
    });
  });

  // --- 数え方と先読み ----------------------------------------------------------------------------

  it("⚠ 数えるのは「エフェクトを出す設定になっている条件」の**行数**（重複を潰さない）", () => {
    setConditionEffect("event:superchat", TPL);
    setConditionEffect("event:gift", TPL);
    addKeywordCondition({ text: "草", match: "contains" }, TPL);
    const conditions = loadEffectConditions();
    expect(effectConditionCount(conditions)).toBe(3);
    // ⚠ `assignedTemplateIds` は**重複を潰した id 集合**（先読みの対象）＝別物。
    expect(assignedTemplateIds(conditions)).toEqual([UUID]);
  });

  it("⚠⚠ キーワードを打っただけでは条件に数えない（エフェクトを選んで初めて 1 件）", () => {
    // ⚠ これが「窓がいつ開くか」の説明を 1 本にしている（イベント行と同じ規則）。
    addKeywordCondition({ text: "草", match: "contains" }, NONE);
    expect(effectConditionCount(loadEffectConditions())).toBe(0);
    setConditionEffect("kw:1", TPL);
    expect(effectConditionCount(loadEffectConditions())).toBe(1);
  });

  it("⚠ 先読みの対象はキーワード条件のテンプレートも含む", () => {
    addKeywordCondition({ text: "草", match: "contains" }, { kind: "template", templateId: UUID2 });
    expect(assignedTemplateIds(loadEffectConditions())).toEqual([UUID2]);
  });

  // --- resolveEffectMatch（判断 4・5・11） -------------------------------------------------------

  it("⚠⚠ 新規 1: キーワードを含む**通常チャット**でエフェクトが出る（課金ゲートの移動）", () => {
    addKeywordCondition({ text: "草", match: "contains" }, TPL);
    const match = resolveEffectMatch({ eventType: "chat", text: "これは草だな" });
    expect(match).toEqual({
      effect: TPL,
      conditionId: "kw:1",
      cooldownMs: KEYWORD_COOLDOWN_MS,
    });
  });

  it("⚠⚠ 新規 2: ビッツ（`superchat` ＋ BITS）でイベント条件が効く（`displayEventType` を通さない）", () => {
    setConditionEffect("event:superchat", TPL);
    // ⚠ wire 上ビッツは `eventType === "superchat"` で届く。`displayEventType` を通すと "bits" になり、
    //   `MONETARY_EVENT_TYPES` に無いので**エフェクトが出なくなる**（061b の穴②と同型）。
    //   ⚠ 本関数は `monetary` を受け取らないので、そもそも `displayEventType` を呼べない。
    expect(resolveEffectMatch({ eventType: "superchat", text: "Power-up 🎉" })).toEqual({
      effect: TPL,
      conditionId: "event:superchat",
      cooldownMs: 0,
    });
  });

  it("⚠⚠ 新規 3: `exact` は部分一致では当たらない／`contains` は当たる", () => {
    updateKeywordCondition("kw:1", { text: "こんばん", match: "contains" });
    addKeywordCondition({ text: "こんばん", match: "contains" }, TPL);
    expect(resolveEffectMatch({ eventType: "chat", text: "こんばんは〜" })).not.toBeNull();
    updateKeywordCondition("kw:1", { text: "こんばん", match: "exact" });
    expect(resolveEffectMatch({ eventType: "chat", text: "こんばんは〜" })).toBeNull();
    expect(resolveEffectMatch({ eventType: "chat", text: "こんばん" })).not.toBeNull();
  });

  it("⚠ `exact` は前後の空白を無視する（両側 trim・規則を片方だけ変えない）", () => {
    addKeywordCondition({ text: "草", match: "exact" }, TPL);
    expect(resolveEffectMatch({ eventType: "chat", text: " 草 " })).not.toBeNull();
    expect(resolveEffectMatch({ eventType: "chat", text: "　草　" })).not.toBeNull();
  });

  it("⚠⚠ 新規 4-a: 全角で登録したキーワードが半角のコメントに当たる（NFKC）", () => {
    addKeywordCondition({ text: "ＯＢＳ", match: "contains" }, TPL);
    expect(resolveEffectMatch({ eventType: "chat", text: "obs すごい" })).not.toBeNull();
    // 半角カナ → 全角カナも同じ 1 本の規則で当たる。
    updateKeywordCondition("kw:1", { text: "ﾅｲｽ", match: "contains" });
    expect(resolveEffectMatch({ eventType: "chat", text: "ナイスプレイ👏" })).not.toBeNull();
  });

  it("⚠⚠ 新規 4-b: 大文字で登録したキーワードが小文字のコメントに当たる（toLowerCase）", () => {
    addKeywordCondition({ text: "GGWP", match: "contains" }, TPL);
    expect(resolveEffectMatch({ eventType: "chat", text: "ggwp!" })).not.toBeNull();
    expect(resolveEffectMatch({ eventType: "chat", text: "GGWP" })).not.toBeNull();
  });

  it("⚠⚠ 新規 8: 複数当たってもイベント条件が先に勝つ（走査順がそのまま優先順位）", () => {
    setConditionEffect("event:superchat", TPL);
    addKeywordCondition({ text: "草", match: "contains" }, { kind: "template", templateId: UUID2 });
    // スパチャの本文にキーワードが入っている。⚠ **投げ銭のほうが重要度が高い。**
    expect(resolveEffectMatch({ eventType: "superchat", text: "草" })).toEqual({
      effect: TPL,
      conditionId: "event:superchat",
      cooldownMs: 0,
    });
  });

  it("⚠ 複数のキーワードに当たっても、保存順で最初の 1 件だけ", () => {
    addKeywordCondition({ text: "草", match: "contains" }, TPL);
    addKeywordCondition({ text: "w", match: "contains" }, { kind: "template", templateId: UUID2 });
    expect(resolveEffectMatch({ eventType: "chat", text: "草www" })?.conditionId).toBe("kw:1");
  });

  it("⚠⚠ 新規 9: `kind === \"none\"` の条件は走査をスキップする", () => {
    // スーパーチャットを「出さない」にしていても、本文のキーワードでは出る。
    setConditionEffect("event:superchat", NONE);
    addKeywordCondition({ text: "草", match: "contains" }, TPL);
    expect(resolveEffectMatch({ eventType: "superchat", text: "草" })).toEqual({
      effect: TPL,
      conditionId: "kw:1",
      cooldownMs: KEYWORD_COOLDOWN_MS,
    });
  });

  it("⚠ キーワードに当たらない通常チャットは `null`（＝1 件も出さない）", () => {
    addKeywordCondition({ text: "草", match: "contains" }, TPL);
    expect(resolveEffectMatch({ eventType: "chat", text: "こんばんは" })).toBeNull();
  });

  it("⚠ 本文が空でも安全側（キーワードは当たらない・イベント条件は当たる）", () => {
    // サブスク／ギフトは本文を持たない（dev-mock も `text: ""` を送る）。
    setConditionEffect("event:gift", TPL);
    addKeywordCondition({ text: "草", match: "contains" }, { kind: "template", templateId: UUID2 });
    expect(resolveEffectMatch({ eventType: "chat", text: "" })).toBeNull();
    expect(resolveEffectMatch({ eventType: "gift", text: "" })?.conditionId).toBe("event:gift");
  });

  it("⚠ 課金以外のイベント種別ではイベント条件が当たらない（ゲートが効いている）", () => {
    setConditionEffect("event:superchat", TPL);
    expect(resolveEffectMatch({ eventType: "chat", text: "x" })).toBeNull();
    expect(resolveEffectMatch({ eventType: "raid", text: "x" })).toBeNull();
  });

  it("⚠⚠ 正規表現として解釈しない（041b の規律）", () => {
    addKeywordCondition({ text: ".*", match: "contains" }, TPL);
    // ⚠ 正規表現なら全部に当たる。`includes` なので当たらない。
    expect(resolveEffectMatch({ eventType: "chat", text: "こんばんは" })).toBeNull();
    expect(resolveEffectMatch({ eventType: "chat", text: "a.*b" })).not.toBeNull();
  });

  it("⚠⚠ 発火のたびに読み直す（main 窓で変えた直後の 1 件目から効く）", () => {
    addKeywordCondition({ text: "草", match: "contains" }, TPL);
    expect(resolveEffectMatch({ eventType: "chat", text: "草" })).not.toBeNull();
    // 別窓が localStorage を書き換えた状況を模す（`storage` は購読していない）。
    localStorage.setItem(EFFECT_ASSIGNMENTS_KEY, JSON.stringify([kw(1, "花")]));
    expect(resolveEffectMatch({ eventType: "chat", text: "草" })).toBeNull();
    expect(resolveEffectMatch({ eventType: "chat", text: "花" })).not.toBeNull();
  });

  // --- 定数の整合（追加穴 θ） --------------------------------------------------------------------

  it("⚠⚠ `KEYWORD_COOLDOWN_MS` は `CONDITION_COOLDOWN_MAX_MS` 以下でなければならない", () => {
    // ⚠ 超えると `decideEffects` の先頭の掃除が先に走り、**クールダウンが黙って無効化される**。
    //   ⚠ 片方だけ動かす変異はここでしか殺せない（振る舞いの差が「たまに 1 件多く出る」だけなので）。
    expect(KEYWORD_COOLDOWN_MS).toBeLessThanOrEqual(CONDITION_COOLDOWN_MAX_MS);
  });

  // --- 061k: 出力先（どこへ出すか・第 3 の軸） ---------------------------------------------------

  /** 061k: 条件 1 件を保存形のまま仕込む（`output` を明示できる）。 */
  const seed = (items: unknown[]) =>
    localStorage.setItem(EFFECT_ASSIGNMENTS_KEY, JSON.stringify(items));
  /** 061k: 出力先つきのキーワード条件。 */
  const kwOut = (n: number, text: string, output: unknown, effect: unknown = TPL) => ({
    id: `kw:${n}`,
    when: { type: "keyword", text, match: "contains" },
    effect,
    output,
  });
  /** 061k: 出力先つきのイベント条件。 */
  const evOut = (eventType: string, output: unknown, effect: unknown = TPL) => ({
    id: `event:${eventType}`,
    when: { type: "event", eventType },
    effect,
    output,
  });
  const outputOf = (conditions: EffectConditions, id: string) =>
    conditions.find((c) => c.id === id)?.output;

  it("⚠⚠ 新規 2: `output` の無い保存値は `corner` へ倒れる（既存ユーザーの見え方が 1 ミリも変わらない）", () => {
    // ⚠ **061j までの保存値そのもの**（`output` フィールドが存在しない）。
    seed([ev("superchat"), kw(1, "草")]);
    const conditions = loadEffectConditions();
    expect(outputOf(conditions, "event:superchat")).toBe("corner");
    expect(outputOf(conditions, "kw:1")).toBe("corner");
    // ⚠ 061i 以前の**旧形式（Record）**からの移行も同じ（出力先という概念が無かった）。
    seed([]);
    localStorage.setItem(EFFECT_ASSIGNMENTS_KEY, JSON.stringify({ superchat: TPL }));
    expect(outputOf(loadEffectConditions(), "event:superchat")).toBe("corner");
  });

  it("⚠⚠ 新規 3: 未知の `output` も `corner` へ（「出さない」へは倒さない＝意味が違う）", () => {
    // ⚠⚠ 061j の「未知は安全側」と**形は同じだが意味が違う**——ここでの安全側は
    //   「出さない」ではなく「**既存の挙動**」である。倒す先を `none` にすると
    //   「アップデートしたらエフェクトが消えた」になる。
    for (const bad of ["fullscreen", "", 42, null, {}, ["stage"], "__proto__", "constructor"]) {
      seed([evOut("superchat", bad), kwOut(1, "草", bad)]);
      const conditions = loadEffectConditions();
      expect(outputOf(conditions, "event:superchat")).toBe("corner");
      expect(outputOf(conditions, "kw:1")).toBe("corner");
      // ⚠ **「出さない」へ倒れていない**ことも同時に見る（倒す先を取り違える変異を殺す）。
      expect(conditions.find((c) => c.id === "event:superchat")?.effect).toEqual(TPL);
    }
  });

  it("⚠⚠ T-c: `stage` を指定した条件は保存され、読み直しても `stage` のまま", () => {
    // ⚠⚠ **これが無いと「常に corner へ丸める」変異（⑯-a）が生存する**
    //   ——下の T-a / T-b（丸めと削除条件）だけでは、丸めすぎを検出できない。
    seed([evOut("superchat", "stage"), kwOut(1, "草", "stage")]);
    const conditions = loadEffectConditions();
    expect(outputOf(conditions, "event:superchat")).toBe("stage");
    expect(outputOf(conditions, "kw:1")).toBe("stage");
    // 保存経路（`saveEffectConditions` → `parseConditions`）を通しても往復すること。
    saveEffectConditions(conditions);
    expect(outputOf(loadEffectConditions(), "event:superchat")).toBe("stage");
    expect(outputOf(loadEffectConditions(), "kw:1")).toBe("stage");
  });

  it("⚠⚠ T-b: `effect` が「出さない」の条件は `output` が既定へ丸められる（判断 4-b）", () => {
    // ⚠ 「何も出さない条件の出力先」に意味は無い。丸めておくことで
    //   `saveEffectConditions` の「キーごと削除」条件が**無改変のまま正しくなる**。
    seed([evOut("superchat", "stage", NONE), kwOut(1, "草", "stage", NONE)]);
    const conditions = loadEffectConditions();
    expect(outputOf(conditions, "event:superchat")).toBe("corner");
    expect(outputOf(conditions, "kw:1")).toBe("corner");
  });

  it("⚠⚠ T-b': 「出さない」行にエフェクトを選び直しても、隠れていた出力先が有効化されない", () => {
    // ⚠⚠ **丸めが防いでいる実挙動はこれである**（T-b は保存値の見え方の話）。
    //   丸めが無いと、手編集や過去の操作で `{effect:none, output:"stage"}` が残った行に
    //   ユーザーがテンプレートを選んだ瞬間、**画面に一度も出ていない「全画面」が有効になる**
    //   ——「コーナーに出るはずが全画面に出る」が無操作で起きる。
    seed([evOut("superchat", "stage", NONE)]);
    setConditionEffect("event:superchat", TPL);
    expect(outputOf(loadEffectConditions(), "event:superchat")).toBe("corner");
    expect(effectConditionCount(loadEffectConditions(), "stage")).toBe(0);
  });

  it("⚠⚠ T-a: イベント条件が全部「出さない」なら、出力先を変えていてもキーごと消える", () => {
    // ⚠⚠ **これが「ユーザーが変えた出力先が黙って消える」問題の答えである**——
    //   丸めによって「全部 none だが output は stage」という状態が**保存形に存在しなくなる**ので、
    //   061j の削除条件を 1 文字も変えずに済む（＝分岐を増やさない）。
    seed([evOut("superchat", "stage", NONE), evOut("gift", "stage", NONE)]);
    saveEffectConditions(loadEffectConditions());
    expect(raw()).toBeNull();
  });

  it("⚠ キーワード条件が在れば、出力先を変えていてもキーは消えない（打った文字列を捨てない）", () => {
    seed([kwOut(1, "草", "stage", NONE)]);
    saveEffectConditions(loadEffectConditions());
    expect(raw()).not.toBeNull();
    expect(keywordRows(loadEffectConditions())).toHaveLength(1);
  });

  it("⚠ `setConditionOutput` で出力先を変えられる（イベント条件・キーワード条件の両方）", () => {
    setConditionEffect("event:superchat", TPL);
    addKeywordCondition({ text: "草", match: "contains" }, TPL);
    setConditionOutput("event:superchat", "stage");
    setConditionOutput("kw:1", "stage");
    const conditions = loadEffectConditions();
    expect(outputOf(conditions, "event:superchat")).toBe("stage");
    expect(outputOf(conditions, "kw:1")).toBe("stage");
    // ⚠ 触っていない条件は既定のまま（1 件だけ変わることの担保）。
    expect(outputOf(conditions, "event:gift")).toBe("corner");
  });

  it("⚠ `setConditionOutput` は存在しない id では何も壊さない", () => {
    setConditionEffect("event:superchat", TPL);
    const before = raw();
    setConditionOutput("kw:999", "stage");
    expect(outputOf(loadEffectConditions(), "event:superchat")).toBe("corner");
    expect(raw()).toBe(before);
  });

  it("⚠⚠ 新規 4: `effectConditionCount` は出力先ごとに数える／省略すると合計", () => {
    seed([
      evOut("superchat", "corner"),
      evOut("gift", "stage"),
      kwOut(1, "草", "stage"),
      // ⚠ 「出さない」条件は出力先に関係なく 0 件側（061i からの規則は無改変）。
      kwOut(2, "w", "stage", NONE),
    ]);
    const conditions = loadEffectConditions();
    expect(effectConditionCount(conditions, "corner")).toBe(1);
    expect(effectConditionCount(conditions, "stage")).toBe(2);
    // ⚠⚠ **省略時は合計**（前提ステータスの「表示する条件」がこれを出す）。
    //   ⚠ 既定を片方の窓にすると画面の数字が黙って半分になる。
    expect(effectConditionCount(conditions)).toBe(3);
    expect(hasEffectConditions(conditions, "stage")).toBe(true);
    expect(hasEffectConditions(conditions, "corner")).toBe(true);
    expect(hasEffectConditions(conditions)).toBe(true);
  });

  it("⚠⚠ 新規 6（判定側）: corner 条件だけのとき stage は 0 件（＝ステージ窓を開く理由が無い）", () => {
    seed([evOut("superchat", "corner"), kwOut(1, "草", "corner")]);
    const conditions = loadEffectConditions();
    expect(hasEffectConditions(conditions, "corner")).toBe(true);
    expect(hasEffectConditions(conditions, "stage")).toBe(false);
    // 逆向きも同じ。
    seed([evOut("superchat", "stage")]);
    const only = loadEffectConditions();
    expect(hasEffectConditions(only, "stage")).toBe(true);
    expect(hasEffectConditions(only, "corner")).toBe(false);
  });

  it("⚠⚠ 新規 13（判定側）: `assignedTemplateIds` は出力先で絞れる／省略すると合計", () => {
    // ⚠ 先読みの 20MiB 予算を「もう一方の窓のぶん」で使わないための絞り込み。
    seed([evOut("superchat", "corner"), evOut("gift", "stage", { kind: "template", templateId: UUID2 })]);
    const conditions = loadEffectConditions();
    expect(assignedTemplateIds(conditions, "corner")).toEqual([UUID]);
    expect(assignedTemplateIds(conditions, "stage")).toEqual([UUID2]);
    expect(assignedTemplateIds(conditions).sort()).toEqual([UUID2, UUID].sort());
  });

  it("⚠⚠ 新規 1: corner の matcher は stage の条件を返さない／その逆も", () => {
    seed([kwOut(1, "こーなー", "corner"), kwOut(2, "すてーじ", "stage")]);
    const corner = createEffectMatcher("corner");
    const stage = createEffectMatcher("stage");
    expect(corner({ eventType: "chat", text: "こーなー" })?.conditionId).toBe("kw:1");
    expect(corner({ eventType: "chat", text: "すてーじ" })).toBeNull();
    expect(stage({ eventType: "chat", text: "すてーじ" })?.conditionId).toBe("kw:2");
    expect(stage({ eventType: "chat", text: "こーなー" })).toBeNull();
    // イベント条件でも同じ。
    seed([evOut("superchat", "stage")]);
    expect(createEffectMatcher("stage")({ eventType: "superchat", text: "" })?.conditionId).toBe(
      "event:superchat",
    );
    expect(createEffectMatcher("corner")({ eventType: "superchat", text: "" })).toBeNull();
  });

  it("⚠ 出力先を変えると、次の照合から相手の matcher が当てる（保存が即座に効く）", () => {
    addKeywordCondition({ text: "草", match: "contains" }, TPL);
    expect(createEffectMatcher("corner")({ eventType: "chat", text: "草" })).not.toBeNull();
    setConditionOutput("kw:1", "stage");
    // ⚠⚠ **factory を作り直していない**（＝返す関数が毎回 localStorage を読んでいることの担保）。
    const corner = createEffectMatcher("corner");
    const stage = createEffectMatcher("stage");
    setConditionOutput("kw:1", "stage");
    expect(corner({ eventType: "chat", text: "草" })).toBeNull();
    expect(stage({ eventType: "chat", text: "草" })).not.toBeNull();
  });

  it("⚠ 出力先の表は `EffectOutput` の全値を持ち、窓名は互いに部分文字列でない（案内文の出所）", () => {
    // ⚠⚠ **窓名は sidecar の `includes` 一致で使われる**ので、互いに含み合ってはいけない。
    //   ⚠ Rust の `frontend_window_title_table_matches_overlay_titles` が実タイトルとの
    //   バイト一致を見ており、ここは「表の形」だけを見る（2 層で守る）。
    for (const output of EFFECT_OUTPUTS) {
      expect(EFFECT_OUTPUT_WINDOW_TITLE[output]).toBeTruthy();
      expect(EFFECT_OUTPUT_LABEL[output]).toBeTruthy();
    }
    expect(Object.keys(EFFECT_OUTPUT_WINDOW_TITLE).sort()).toEqual([...EFFECT_OUTPUTS].sort());
    for (const a of EFFECT_OUTPUTS) {
      for (const b of EFFECT_OUTPUTS) {
        if (a === b) continue;
        expect(EFFECT_OUTPUT_WINDOW_TITLE[a].includes(EFFECT_OUTPUT_WINDOW_TITLE[b])).toBe(false);
      }
    }
    // ⚠ **画面での呼び方と窓名は別物**（判断 2＝改名は禁止なので UI 側だけ変えた）。
    for (const output of EFFECT_OUTPUTS) {
      expect(EFFECT_OUTPUT_LABEL[output]).not.toBe(EFFECT_OUTPUT_WINDOW_TITLE[output]);
    }
    // ⚠ 既定は「061j までの唯一の窓」＝コーナー（ここを stage にすると既存ユーザーの見え方が変わる）。
    expect(DEFAULT_EFFECT_OUTPUT).toBe<EffectOutput>("corner");
  });

  // --- §9 ---------------------------------------------------------------------------------------

  it("⚠⚠ 照合の戻り値に本文が 1 バイトも含まれない（§9・型の担保をテストでも固定）", () => {
    addKeywordCondition({ text: "草", match: "contains" }, TPL);
    const match = resolveEffectMatch({
      eventType: "chat",
      text: "草 これは第三者の本文です",
    });
    expect(match).not.toBeNull();
    expect(Object.keys(match as object).sort()).toEqual([
      "conditionId",
      "cooldownMs",
      "effect",
    ]);
    expect(JSON.stringify(match)).not.toContain("第三者");
  });

  it("⚠⚠ 照合しても localStorage に本文が書かれない（§9）", () => {
    addKeywordCondition({ text: "草", match: "contains" }, TPL);
    resolveEffectMatch({ eventType: "chat", text: "草 これは第三者の本文です" });
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      expect(localStorage.getItem(key ?? "")).not.toContain("第三者");
    }
  });
});

/** ⚠ 型テスト: 保存形に計算結果（正規化済み文字列）が混ざらないこと。 */
const _shape: EffectCondition = {
  id: "kw:1",
  when: { type: "keyword", text: "草", match: "contains" },
  effect: { kind: "none" },
  // ⚠ 061k: 第 3 の軸。⚠ **`when` にも `effect` にも入っていない**ことを型で示す。
  output: "corner",
};
void _shape;
