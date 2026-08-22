import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EFFECT_ASSIGNMENTS_KEY } from "../../features/comment-viewer/overlaySettings";
import { MONETARY_EVENT_TYPES } from "../comment-viewer/viewerFormat";
import {
  addKeywordCondition,
  createObsSourceMatcher,
  GACHA_PRIZE_MAX,
  GACHA_PRIZE_NAME_MAX_LENGTH,
  GACHA_WEIGHT_MAX,
  isUsableKeyword,
  KEYWORD_CONDITION_MAX,
  KEYWORD_COOLDOWN_MS,
  KEYWORD_MAX_LENGTH,
  loadEffectConditions,
  removeCondition,
  sanitizeKeywordInput,
  saveEffectConditions,
  setConditionEffect,
  updateKeywordCondition,
  type EffectCondition,
  type EffectConditions,
} from "./effectAssignments";
import type { CommentViewDto } from "../../features/comment-viewer/types";
import {
  CONDITION_COOLDOWN_MAX_MS,
  createEffectTriggerState,
  decideEffects,
} from "./effectTrigger";

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
/** 064d: 割り当て先は「OBS 側のソース」1 種類だけ（テンプレートは取り込み機能ごと削除）。 */
const UUID = "きらきら演出";
const UUID2 = "紙吹雪";
const TPL = { kind: "obs-source", sourceName: UUID } as const;
const OBS = TPL;

const EVENT_TYPES = [...MONETARY_EVENT_TYPES];

/**
 * 064d: **レーンが 1 本になったので matcher も 1 本**（旧: 出力先ごとの factory）。
 *
 * ⚠ 061j までの全ケースは「窓が 1 本だった時代」の仕様なので、この 1 本で**無改変のまま通る**。
 * ⚠ factory をモジュールの先頭で 1 回作っているが、**返す関数は呼ばれるたびに localStorage を読む**ので
 * 各ケースの `beforeEach` でのクリアが効く（「読み直しの規律を変えていない」ことの副次的な担保）。
 */
const resolveEffectMatch = createObsSourceMatcher();

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

  /**
   * ⚠⚠⚠ **063a で例を差し替えた 1 本**（元は `{ kind: "gacha", tableId: "x" }` を
   * 「未知の kind」の例に使っていた）。
   *
   * ⚠⚠ **消していない・期待値も変えていない。** このテストが守っているのは
   * 「**未知の kind は安全側（出さない）へ倒れる**」という前方互換のガードで、
   * **061h の移行（`builtin-monetary`）と 064d の移行（`template`）を、移行コード 1 行も
   * 書かずに済ませた仕組みそのもの**である。063a で `gacha` が**既知**になったので、
   * 例だけを**まだ存在しない別の kind** へ移した。
   *
   * ⚠⚠ **「旧ビルドが gacha を読むと『出さない』へ倒れる」ことは、もうこのビルドでは
   * 表現できない**（このビルドでは gacha は既知だから）。⚠ **前方互換が消えたわけではない**
   * ——仕組みは生きており、次に足す kind に対して同じように働く。それを固定しているのがこの 1 本。
   */
  it("⚠⚠ 未知の kind（このビルドがまだ知らない将来の割り当て）は「出さない」へ倒れる", () => {
    localStorage.setItem(
      EFFECT_ASSIGNMENTS_KEY,
      JSON.stringify([ev("superchat", { kind: "future-thing", tableId: "x" })]),
    );
    expect(
      loadEffectConditions().find((c) => c.id === "event:superchat")?.effect,
    ).toEqual(NONE);
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
        ev("superchat", { kind: "obs-source", sourceName: UUID }),
        ev("superchat", { kind: "obs-source", sourceName: UUID2 }),
      ]),
    );
    const conditions = loadEffectConditions();
    expect(eventRows(conditions)).toHaveLength(6);
    expect(
      conditions.find((c) => c.id === "event:superchat")?.effect,
    ).toEqual({ kind: "obs-source", sourceName: UUID });
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
        superchat: { kind: "obs-source", sourceName: UUID },
        subscription: { kind: "none" },
        bits: { kind: "obs-source", sourceName: UUID2 },
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
    const before = JSON.stringify({ superchat: { kind: "obs-source", sourceName: UUID } });
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
      },
      {
        id: "kw:1",
        when: { type: "keyword", text: "草", match: "exact" },
        effect: TPL,
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
        },
      ]),
    ).not.toThrow();
  });

  // --- 変更 API（すべて「読む → 変える → 保存 → 読み直す」） -------------------------------------

  it("`setConditionEffect` はイベント条件にもキーワード条件にも効く", () => {
    addKeywordCondition({ text: "草", match: "contains" }, NONE);
    setConditionEffect("event:superchat", TPL);
    setConditionEffect("kw:1", { kind: "obs-source", sourceName: UUID2 });
    const conditions = loadEffectConditions();
    expect(conditions.find((c) => c.id === "event:superchat")?.effect).toEqual(TPL);
    expect(conditions.find((c) => c.id === "kw:1")?.effect).toEqual({
      kind: "obs-source",
      sourceName: UUID2,
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
    addKeywordCondition({ text: "草", match: "contains" }, { kind: "obs-source", sourceName: UUID2 });
    // スパチャの本文にキーワードが入っている。⚠ **投げ銭のほうが重要度が高い。**
    expect(resolveEffectMatch({ eventType: "superchat", text: "草" })).toEqual({
      effect: TPL,
      conditionId: "event:superchat",
      cooldownMs: 0,
    });
  });

  it("⚠ 複数のキーワードに当たっても、保存順で最初の 1 件だけ", () => {
    addKeywordCondition({ text: "草", match: "contains" }, TPL);
    addKeywordCondition({ text: "w", match: "contains" }, { kind: "obs-source", sourceName: UUID2 });
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
    addKeywordCondition({ text: "草", match: "contains" }, { kind: "obs-source", sourceName: UUID2 });
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

/**
 * 064b: **割り当て先が「OBS 側のソース」になれる**ことの仕様テスト。
 *
 * ⚠⚠ **このブロックが固定している最重要の不変条件は 2 つ。**
 *
 * **① 2 つのレーンは当たり判定の「前」に分かれる。**
 * エフェクト窓のレーン（テンプレート）と OBS のレーン（ソース）は、
 * **相手の条件をバースト枠・クールダウンの消費者にしてはいけない**。
 * ⚠ 「出ない」だけを見ると**どちらの実装でも通る**ので、`decideEffects` の state のサイズを
 * 直接数えるケースを置く（061d-2 穴 γ ／ 061j 穴 η ／ 061k と同型で 4 例目）。
 *
 * **② OBS ソースの条件は「窓を開く数」に入らない。**
 * ⚠ 064b 当時の理由は「`effectConditionCount` が `EFFECT_OVERLAY_ENABLED_KEY` の値そのもので、
 * 数え足すと OBS ソースしか設定していないユーザーの配信画面に透過窓が生える」だった。
 * ⚠⚠ **064 レビュー Q-6/S-6（訂正）: その前提はもう無い**——064d で条件による窓の自動 open は
 * 消え（窓が開く契機は「配信イベントの開始」だけ）、`effectConditionCount` の呼び手も
 * `EFFECT_OVERLAY_ENABLED_KEY` も存在しない。⚠ **不変条件としては残す**（063 で
 * 2 本目のレーンが入るときに同じ罠が戻るため）。
 *
 * ⚠ ①の「state のサイズを直接数える」ケースは、fixture（`comment`）のある
 * `effectTrigger.test.ts` 側に置いてある（064 レビュー Q-3）。
 */
describe("064b: 割り当て先としての OBS ソース", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  const obsMatch = createObsSourceMatcher();

  /** ⚠ レーン分離のケース用の最小コメント（`decideEffects` へ実データと同じ形で流すため）。 */
  const dto = (id: string, text: string): CommentViewDto => ({
    id,
    source: "youtube",
    author: { id: "u1", name: "視聴者A" },
    text,
    publishedAt: "2026-08-16T00:00:00Z",
    eventType: "chat",
  });

  it("保存して読み直せる", () => {
    const next = setConditionEffect("event:superchat", OBS);
    expect(next.find((c) => c.id === "event:superchat")?.effect).toEqual(OBS);
    expect(
      loadEffectConditions().find((c) => c.id === "event:superchat")?.effect,
    ).toEqual(OBS);
  });

  it("キーワード条件にも割り当てられる", () => {
    addKeywordCondition({ text: "草", match: "contains" }, OBS);
    expect(keywordRows(loadEffectConditions())[0]?.effect).toEqual(OBS);
  });

  // --- 検証（多層防御の 1 枚目。壁そのものは sidecar 側の 2 枚） -----------------------------
  //
  // ⚠⚠ **落ちる先はすべて「出さない」**（061h からの向き）。⚠ `parseAssignment` の 1 分岐が
  //   消えると、これらが全部「そのまま保存される」へ倒れて **wire に細工された名前が載る**。
  it.each([
    ["空文字", ""],
    ["空白だけ", "   "],
    ["非文字列（数値）", 123],
    ["非文字列（null）", null],
    ["未指定", undefined],
    ["201 文字", "a".repeat(201)],
    ["改行入り", "a\nb"],
    ["NUL 入り", "a\u0000b"],
  ])("⚠⚠ 不正なソース名は「出さない」へ倒れる: %s", (_label, sourceName) => {
    localStorage.setItem(
      EFFECT_ASSIGNMENTS_KEY,
      JSON.stringify([ev("superchat", { kind: "obs-source", sourceName })]),
    );
    expect(
      loadEffectConditions().find((c) => c.id === "event:superchat")?.effect,
    ).toEqual(NONE);
  });

  it("200 文字ちょうどは通る（sidecar の上限と同じ値）", () => {
    const sourceName = "a".repeat(200);
    localStorage.setItem(
      EFFECT_ASSIGNMENTS_KEY,
      JSON.stringify([ev("superchat", { kind: "obs-source", sourceName })]),
    );
    expect(
      loadEffectConditions().find((c) => c.id === "event:superchat")?.effect,
    ).toEqual({ kind: "obs-source", sourceName });
  });

  it("⚠⚠ 064 レビュー S-10: 前後の空白は落として保存する（sidecar と同じ値に揃える）", () => {
    // ⚠⚠ **判定は trim 済み・保存は生、という非対称を殺すケース。**
    //   生のまま保存すると、`isObsSourceMissingFromList`（一覧との**完全一致**）が外れて
    //   **matcher は発火するのに `<select>` では「出さない」に見える**——
    //   064b が「TS 側と sidecar 側で規則を揃える」と決めた約束が 1 点だけ崩れる形だった。
    //   ⚠ sidecar（`toFireableSource` / `fireSource`）も受領時に `trim()` するので、これで値が 1 つに揃う。
    localStorage.setItem(
      EFFECT_ASSIGNMENTS_KEY,
      JSON.stringify([ev("superchat", { kind: "obs-source", sourceName: "  花火  " })]),
    );
    expect(
      loadEffectConditions().find((c) => c.id === "event:superchat")?.effect,
    ).toEqual({ kind: "obs-source", sourceName: "花火" });
  });

  it("⚠ ソース名に `:` が含まれていても保存・復元できる", () => {
    const effect = { kind: "obs-source", sourceName: "12:34 の演出" } as const;
    setConditionEffect("event:superchat", effect);
    expect(
      loadEffectConditions().find((c) => c.id === "event:superchat")?.effect,
    ).toEqual(effect);
  });

  // --- レーンの分離（不変条件 ①） --------------------------------------------------------
  it("OBS レーンの matcher は OBS ソースの条件にだけ当たる", () => {
    setConditionEffect("event:superchat", OBS);
    expect(obsMatch({ eventType: "superchat", text: "" })?.effect).toEqual(OBS);
  });

  it("⚠⚠ 「出さない」条件は当たった扱いにならない（キーワードを塞がない）", () => {
    // ⚠⚠ これが「当たり判定の**前**に落とす」ことの観測可能な形である。
    //   後ろで捨てる実装だと、先に並ぶイベント条件が当たってしまい、ここでキーワードまで到達しない。
    //   ⚠ 064d でレーンは 1 本になったが、**この規律は 063（ガチャ）で 2 本目が入るときに再び効く**。
    setConditionEffect("event:superchat", NONE);
    addKeywordCondition({ text: "草", match: "contains" }, OBS);
    expect(
      resolveEffectMatch({ eventType: "superchat", text: "草" })?.effect,
    ).toEqual(OBS);
  });

  it("OBS レーンでもキーワードのクールダウンは同じ規則", () => {
    addKeywordCondition({ text: "草", match: "contains" }, OBS);
    expect(obsMatch({ eventType: "chat", text: "草" })?.cooldownMs).toBe(
      KEYWORD_COOLDOWN_MS,
    );
  });

  it("OBS レーンでも課金ゲートは同じ（イベント条件は課金コメントだけ）", () => {
    setConditionEffect("event:superchat", OBS);
    expect(obsMatch({ eventType: "chat", text: "" })).toBeNull();
  });

  /**
   * ⚠⚠⚠ **064 レビュー Q-3（追加）: レーンの分離を「state のサイズ」で直接数える。**
   *
   * 上の JSDoc（不変条件 ①）は「**`decideEffects` の state のサイズを直接数えるケースを置く**」と
   * 宣言していたが、064b で足した OBS レーンぶんは**「出ない」を見るケースしか無かった**。
   *
   * ⚠⚠ **「出ない」だけでは、`createConditionMatcher` の `select` を当たり判定の「後ろ」へ
   * 動かす変異が生き残る**——出力は同じでも、**相手のレーンの条件がバースト枠（`recentFires`）と
   * クールダウン（`lastConditionAt`）を食う**ようになり、
   * 「OBS のソースが数回鳴っただけで直後の投げ銭が捨てられる」が起きる
   * （061d-2 穴 γ ／ 061j 穴 η と同型）。
   * ⇒ **実 matcher（`createObsSourceMatcher`）を通したうえで、state に 1 バイトも触れていない**
   * ことを直接数える。⚠ **スタブ matcher で代用しないこと**——規則の持ち主は
   * `createConditionMatcher` の `continue` なので、そこを通らないテストでは変異を殺せない（実測）。
   * ⚠ **再修正トリガー＝063 で 2 本目のレーンが入るとき**（そのとき両レーンぶん置くこと）。
   */
  it("⚠⚠ 宛て先でない条件は、バースト枠もクールダウンもギフト畳みも消費しない", () => {
    // ⚠ 「出さない」条件だけを用意する（＝ OBS レーンから見て「自分宛てではない」）。
    for (let i = 0; i < 5; i++) {
      addKeywordCondition({ text: `語${i}`, match: "contains" }, NONE);
    }
    const state = createEffectTriggerState();
    const fires = Array.from({ length: 5 }, (_, i) =>
      decideEffects(
        [dto(`c${i}`, `語${i}`)],
        [],
        state,
        1_700_000_000_000,
        obsMatch,
      ),
    ).flat();

    // ①出ない（従来のケースが見ていたもの）。
    expect(fires).toHaveLength(0);
    // ⚠⚠ ②**state が空のまま**（分離の位置を固定する本体）。
    expect(state.recentFires).toHaveLength(0);
    expect(state.lastConditionAt.size).toBe(0);
    expect(state.lastGiftAt.size).toBe(0);
  });

  // --- 保存キーの削除条件（061j の規則を壊していないこと） ---------------------------------
  it("⚠ OBS ソースを 1 件でも割り当てたらキーは消えない", () => {
    setConditionEffect("event:superchat", OBS);
    expect(raw()).not.toBeNull();
    setConditionEffect("event:superchat", NONE);
    expect(raw()).toBeNull();
  });

  // --- 063a: ガチャの割り当て（穴 A / 穴 F） ----------------------------------------------

  /** ガチャの割り当て 1 件（保存形と同じ形）。 */
  const gacha = (prizes: unknown[]): unknown => ({ kind: "gacha", prizes });
  /** 景品 1 件（保存形と同じ形）。 */
  const prize = (
    over: Partial<{ name: unknown; weight: unknown; sourceName: unknown }> = {},
  ): unknown => ({
    name: over.name ?? "大当たり",
    weight: over.weight ?? 1,
    sourceName: over.sourceName ?? UUID,
  });
  const gachaEffect = (id: string) => {
    const effect = loadEffectConditions().find((c) => c.id === id)?.effect;
    return effect?.kind === "gacha" ? effect : null;
  };

  it("⚠⚠ `{ kind: 'gacha' }` が正しく読める（063a で足した 3 本目の割り当て）", () => {
    localStorage.setItem(
      EFFECT_ASSIGNMENTS_KEY,
      JSON.stringify([
        ev(
          "superchat",
          gacha([
            prize({ name: "大当たり", weight: 1, sourceName: UUID }),
            prize({ name: "はずれ", weight: 9, sourceName: UUID2 }),
          ]),
        ),
      ]),
    );
    expect(gachaEffect("event:superchat")?.prizes).toEqual([
      { name: "大当たり", weight: 1, sourceName: UUID },
      { name: "はずれ", weight: 9, sourceName: UUID2 },
    ]);
  });

  it("⚠⚠ 景品 0 件でも `gacha` のまま保つ（`none` へ潰すと設定が黙って消える）", () => {
    localStorage.setItem(
      EFFECT_ASSIGNMENTS_KEY,
      JSON.stringify([ev("superchat", gacha([]))]),
    );
    expect(gachaEffect("event:superchat")?.prizes).toEqual([]);
    // ⚠ `prizes` が配列ですらない場合も同じ（0 件として読む）。
    localStorage.setItem(
      EFFECT_ASSIGNMENTS_KEY,
      JSON.stringify([ev("superchat", { kind: "gacha" })]),
    );
    expect(gachaEffect("event:superchat")?.prizes).toEqual([]);
  });

  it("⚠⚠ `weight` が 0 / 負 / 小数 / 上限超の景品は**その行だけ**落ちる（0 除算と『絶対に出ない景品』を作らない）", () => {
    localStorage.setItem(
      EFFECT_ASSIGNMENTS_KEY,
      JSON.stringify([
        ev(
          "superchat",
          gacha([
            prize({ name: "0", weight: 0 }),
            prize({ name: "負", weight: -1 }),
            prize({ name: "小数", weight: 1.5 }),
            prize({ name: "NaN", weight: Number.NaN }),
            prize({ name: "文字", weight: "3" }),
            prize({ name: "上限超", weight: GACHA_WEIGHT_MAX + 1 }),
            prize({ name: "上限", weight: GACHA_WEIGHT_MAX }),
            prize({ name: "下限", weight: 1 }),
          ]),
        ),
      ]),
    );
    expect(gachaEffect("event:superchat")?.prizes.map((p) => p.name)).toEqual([
      "上限",
      "下限",
    ]);
  });

  it("⚠ `sourceName` が空 / 制御文字入り / 非文字列の景品は落ちる（`EffectObsSource` と同じ規則）", () => {
    localStorage.setItem(
      EFFECT_ASSIGNMENTS_KEY,
      JSON.stringify([
        ev(
          "superchat",
          gacha([
            prize({ name: "空", sourceName: "   " }),
            prize({ name: "制御", sourceName: "a\u0000b" }),
            prize({ name: "非文字列", sourceName: 42 }),
            prize({ name: "ok", sourceName: `  ${UUID}  ` }),
          ]),
        ),
      ]),
    );
    // ⚠ 生き残るのは 1 件だけで、**保存されるのは trim 済みの値**（064 レビュー S-10 と同じ理由）。
    expect(gachaEffect("event:superchat")?.prizes).toEqual([
      { name: "ok", weight: 1, sourceName: UUID },
    ]);
  });

  it("⚠ 景品名が長すぎる／制御文字入りの景品は落ち、空の景品名は許される", () => {
    const tooLong = "あ".repeat(GACHA_PRIZE_NAME_MAX_LENGTH + 1);
    localStorage.setItem(
      EFFECT_ASSIGNMENTS_KEY,
      JSON.stringify([
        ev(
          "superchat",
          gacha([
            prize({ name: tooLong }),
            prize({ name: "a\u0000b" }),
            prize({ name: 42 }),
            prize({ name: "", sourceName: UUID2 }),
          ]),
        ),
      ]),
    );
    expect(gachaEffect("event:superchat")?.prizes).toEqual([
      { name: "", weight: 1, sourceName: UUID2 },
    ]);
  });

  it("⚠ 景品は上限を超えたら落ちる（丸めない）", () => {
    const prizes = Array.from({ length: GACHA_PRIZE_MAX + 5 }, (_, i) =>
      prize({ name: `p${i}` }),
    );
    localStorage.setItem(
      EFFECT_ASSIGNMENTS_KEY,
      JSON.stringify([ev("superchat", gacha(prizes))]),
    );
    expect(gachaEffect("event:superchat")?.prizes).toHaveLength(GACHA_PRIZE_MAX);
  });

  it("⚠⚠ 保存経路でも同じ検査が効く（読み込み時だけの検査にしない）", () => {
    setConditionEffect("event:superchat", {
      kind: "gacha",
      prizes: [
        { name: "落ちる", weight: 0, sourceName: UUID },
        { name: "残る", weight: 2, sourceName: UUID2 },
      ],
    });
    expect(raw()).not.toContain("落ちる");
    expect(gachaEffect("event:superchat")?.prizes).toEqual([
      { name: "残る", weight: 2, sourceName: UUID2 },
    ]);
  });

  it("⚠⚠ ガチャの割り当ては 063a では**発火しない**（`select` が当たり判定の前に落とす）", () => {
    // ⚠ 発火層（`effectTrigger.ts`）には 1 文字も触っていない＝穴 I の判断がここで固定される。
    //   ⚠ 「当たり判定の前に落ちる」ので、キーワード条件を塞がないことも併せて確認する。
    addKeywordCondition({ text: "ガチャ", match: "contains" }, {
      kind: "gacha",
      prizes: [{ name: "大当たり", weight: 1, sourceName: UUID }],
    });
    addKeywordCondition({ text: "ガチャ", match: "contains" }, OBS);
    expect(obsMatch({ eventType: "chat", text: "ガチャ" })?.effect).toEqual(OBS);
  });

  it("⚠⚠ §9: 抽選履歴・当選者は 1 バイトも保存されない", () => {
    setConditionEffect("event:superchat", {
      kind: "gacha",
      prizes: [{ name: "大当たり", weight: 1, sourceName: UUID }],
    });
    const stored = raw() ?? "";
    for (const forbidden of ["history", "winner", "drawnAt", "当選"]) {
      expect(stored).not.toContain(forbidden);
    }
  });

  // --- §9 -------------------------------------------------------------------------------
  it("⚠⚠ 照合しても本文は戻り値にも localStorage にも出ない", () => {
    addKeywordCondition({ text: "草", match: "contains" }, OBS);
    const match = obsMatch({
      eventType: "chat",
      text: "草 これは第三者の本文です",
    });
    expect(JSON.stringify(match)).not.toContain("第三者");
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
};
void _shape;
