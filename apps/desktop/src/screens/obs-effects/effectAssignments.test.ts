import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  EFFECT_ASSIGNMENTS_KEY,
  GACHA_LIBRARY_KEY,
} from "../../features/comment-viewer/overlaySettings";
import { EFFECT_CONDITION_EVENT_TYPES } from "../comment-viewer/viewerFormat";
import {
  addKeywordCondition,
  createEffectFireMatcher,
  GACHA_DEFINITION_MAX,
  GACHA_ID_MAX_LENGTH,
  GACHA_NAME_MAX_LENGTH,
  loadGachaLibrary,
  migrateLegacyGachas,
  nextGachaId,
  runGachaMigration,
  saveGachaLibrary,
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
  gachaPrizeLabel,
  GACHA_UNNAMED_PRIZE_LABEL,
  type GachaPrize,
  updateKeywordCondition,
  type EffectCondition,
  type EffectConditions,
} from "./effectAssignments";
import { isGachaMissingFromList } from "./effectSelectValue";
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

// ⚠⚠ 063e 段 2: 出所が `MONETARY_EVENT_TYPES` から替わった（6 → 7・`channelpoint` が末尾に生えた）。
// ⚠ **件数をベタ書きしない**——ここを 7 と書くと、次に種別が増えたとき「テストが落ちて気付く」ではなく
//   「テストを直して終わり」になる。集合そのものを正とする。
const EVENT_TYPES = [...EFFECT_CONDITION_EVENT_TYPES];

/**
 * 064d: **レーンが 1 本になったので matcher も 1 本**（旧: 出力先ごとの factory）。
 *
 * ⚠ 061j までの全ケースは「窓が 1 本だった時代」の仕様なので、この 1 本で**無改変のまま通る**。
 * ⚠ factory をモジュールの先頭で 1 回作っているが、**返す関数は呼ばれるたびに localStorage を読む**ので
 * 各ケースの `beforeEach` でのクリアが効く（「読み直しの規律を変えていない」ことの副次的な担保）。
 */
const resolveEffectMatch = createEffectFireMatcher();

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

/** ⚠ イベント条件が `EFFECT_CONDITION_EVENT_TYPES` の件数ちょうどで、同じ並びであること。 */
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

  it("⚠⚠ イベント条件は必ず `EFFECT_CONDITION_EVENT_TYPES` の件数ちょうど・同じ並びになる", () => {
    // 1 件だけ保存されていても全件へ復元される（欠けは「出さない」で埋める）。
    localStorage.setItem(EFFECT_ASSIGNMENTS_KEY, JSON.stringify([ev("gift")]));
    const conditions = loadEffectConditions();
    expectEventRowShape(conditions);
    expect(eventRows(conditions)).toHaveLength(EVENT_TYPES.length);
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
    expect(eventRows(conditions)).toHaveLength(EVENT_TYPES.length);
    expect(
      conditions.find((c) => c.id === "event:superchat")?.effect,
    ).toEqual({ kind: "obs-source", sourceName: UUID });
  });

  it("⚠⚠ 未知の eventType の条件は捨てられる（UI に行が無い＝表現できない条件を残さない）", () => {
    localStorage.setItem(
      EFFECT_ASSIGNMENTS_KEY,
      // ⚠ "bits" は `EFFECT_CONDITION_EVENT_TYPES` に**無い**（ビッツは superchat に含まれる）。
      JSON.stringify([ev("bits"), ev("__proto__"), ev("chat")]),
    );
    const conditions = loadEffectConditions();
    expectEventRowShape(conditions);
    expect(conditions.every((c) => c.effect.kind === "none")).toBe(true);
  });

  // --- 新規 12: 判断 8（旧形式からの移行） -------------------------------------------------------

  it("⚠⚠ 旧形式（Record）の保存値がイベント条件の全行へ変換される", () => {
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
    //   `EFFECT_CONDITION_EVENT_TYPES` に無いので**エフェクトが出なくなる**（061b の穴②と同型）。
    //   ⚠ 本関数は `monetary` を受け取らないので、そもそも `displayEventType` を呼べない。
    expect(resolveEffectMatch({ eventType: "superchat", text: "Power-up 🎉" })).toEqual({
      effect: TPL,
      conditionId: "event:superchat",
      cooldownMs: 0,
    });
  });

  // --- 063e 段 2: チャンネルポイント（⚠⚠⚠ 課金ゲートを削除した本体） -----------------------------

  it("⚠⚠⚠ 063e 段 2: チャンネルポイントでイベント条件が効く（課金ゲートの削除）", () => {
    // ⚠⚠ **段 1 の実装ではここが `null` になっていた。** 照合の直前に
    //   `if (!isMonetaryEvent(input.eventType)) continue;` があり、チャンネルポイントは
    //   `MONETARY_EVENT_TYPES` に**入れない**（お金ではない）ので必ず落ちたためである。
    //   ⇒ 症状は「**条件表に行は出るのに、選んでも何も起きない**」＝ 061a Q-1 が最も嫌う形。
    setConditionEffect("event:channelpoint", TPL);
    expect(
      resolveEffectMatch({ eventType: "channelpoint", text: "がんばれー！" }),
    ).toEqual({
      effect: TPL,
      conditionId: "event:channelpoint",
      cooldownMs: 0,
    });
  });

  it("⚠ 063e 段 2: 本文が空の引き換え（テキスト入力なしの報酬）でも効く", () => {
    // ⚠ イベント条件は本文を見ないので当たる。⚠ ここが落ちると
    //   「テキスト入力を求めない報酬ではガチャが回らない」という**報酬しだいの挙動**になる。
    setConditionEffect("event:channelpoint", TPL);
    expect(resolveEffectMatch({ eventType: "channelpoint", text: "" })).toEqual({
      effect: TPL,
      conditionId: "event:channelpoint",
      cooldownMs: 0,
    });
  });

  it("⚠⚠⚠ 063e 段 2: 条件表に無い種別（chat / raid）はイベント条件に 1 件も当たらない", () => {
    // ⚠⚠ **これが「課金ゲートを消して安全である」ことの直接の担保である。**
    //   ゲートを消した論証＝「`parseConditions` が許可集合の外を捨てるので、
    //   `condition.when.eventType === input.eventType` が成り立つなら入力も必ず集合の要素」。
    //   ⇒ **全行にエフェクトを入れてもなお、集合外の種別では 1 件も当たらない**ことを確かめる。
    // ⚠ キーワード条件は 1 件も作らない（作ると chat で当たってしまい、何も確かめられない）。
    for (const eventType of EFFECT_CONDITION_EVENT_TYPES) {
      setConditionEffect(`event:${eventType}`, TPL);
    }
    for (const eventType of ["chat", "raid", "bits", "__proto__", ""]) {
      expect(
        resolveEffectMatch({ eventType, text: "なんでもいい本文" }),
      ).toBeNull();
    }
  });

  it("⚠⚠ 063e 段 2: チャンネルポイントの行が保存・復元される（移行コード無しで乗る）", () => {
    // ⚠ 既存ユーザーの保存値には `channelpoint` の行が**無い**。それでも
    //   `parseConditions` が集合から行を生やすので、**移行コードを 1 行も書かずに乗る**（061j の設計）。
    localStorage.setItem(
      EFFECT_ASSIGNMENTS_KEY,
      JSON.stringify([ev("superchat", TPL)]),
    );
    const conditions = loadEffectConditions();
    expectEventRowShape(conditions);
    const row = conditions.find((c) => c.id === "event:channelpoint");
    expect(row).toBeTruthy();
    // ⚠ 生えた行は「エフェクトを出さない」＝**既存ユーザーの配信画面は 1 ピクセルも変わらない**。
    expect(row?.effect).toEqual(NONE);
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
 * `EFFECT_OVERLAY_ENABLED_KEY` も存在しない。⚠ **不変条件としては残す**
 * （⚠⚠ **063b でレーンは 1 本に確定した**が、`{kind:"none"}` の条件を数えない規律は同じ形で生きている）。
 *
 * ⚠ ①の「state のサイズを直接数える」ケースは、fixture（`comment`）のある
 * `effectTrigger.test.ts` 側に置いてある（064 レビュー Q-3）。
 */
describe("064b: 割り当て先としての OBS ソース", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  const obsMatch = createEffectFireMatcher();

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
  it("matcher は OBS ソースの条件に当たる", () => {
    setConditionEffect("event:superchat", OBS);
    expect(obsMatch({ eventType: "superchat", text: "" })?.effect).toEqual(OBS);
  });

  it("⚠⚠ 「出さない」条件は当たった扱いにならない（キーワードを塞がない）", () => {
    // ⚠⚠ これが「当たり判定の**前**に落とす」ことの観測可能な形である。
    //   後ろで捨てる実装だと、先に並ぶイベント条件が当たってしまい、ここでキーワードまで到達しない。
    //   ⚠⚠ 063b でレーンは 1 本に確定したので、いま `select` が落とすのは `{kind:"none"}` だけである。
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
   * ⇒ **実 matcher（`createEffectFireMatcher`）を通したうえで、state に 1 バイトも触れていない**
   * ことを直接数える。⚠ **スタブ matcher で代用しないこと**——規則の持ち主は
   * `createConditionMatcher` の `continue` なので、そこを通らないテストでは変異を殺せない（実測）。
   * ⚠⚠ **063b: 2 本目のレーンは入らなかった**（`select` が 2 kind を通す 1 本レーンに決めた）。
   * ⇒ **このケースが守るのは「`{kind:\"none\"}` の条件が枠を食わない」**であり、
   * 「ガチャの条件が OBS の枠を食わない」は**もはや守るべき性質ではない**（同じレーンなので共有が正しい）。
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

  // --- 063a / 063d: ガチャ（穴 A / 穴 F / 穴 P〜V） ----------------------------------------

  /**
   * ⚠⚠ **063d: 景品の保存先が変わった。**
   * 063a は割り当てに直付け（`{kind:"gacha", prizes}`）だったが、063d で
   * **ガチャ本体が [`GACHA_LIBRARY_KEY`] の一覧へ移った**。
   * ⚠ **`parseGachaPrize` の規則そのものは 1 行も変えていない**ので、下の期待値は 063a から無改変である。
   */
  const putGacha = (prizes: unknown[], name = "テストガチャ") =>
    localStorage.setItem(
      GACHA_LIBRARY_KEY,
      JSON.stringify([{ id: "g:1", name, prizes }]),
    );
  /**
   * 景品 1 件（⚠⚠ **063d 以前の保存形＝ `sourceName` 直付け**）。
   *
   * ⚠⚠⚠ **063c 段 2-a: ここを新しい形に変えないこと。** この関数が旧形式を書き続けることで、
   * 下のケース群がそのまま **`parseGachaPrizeOutput` の後方互換の検査**になっている
   * （＝ すでに保存されているデータが新しいビルドで読めることを、既存のケースが毎回確かめる）。
   * ⚠ 新しい形（`output`）のケースは別の `describe` に足してある。
   */
  const prize = (
    over: Partial<{ name: unknown; weight: unknown; sourceName: unknown }> = {},
  ): unknown => ({
    name: over.name ?? "大当たり",
    weight: over.weight ?? 1,
    sourceName: over.sourceName ?? UUID,
  });
  /** ⚠ 期待値用: 旧形式が読まれた結果（＝ `{kind:"obs-source"}` へ翻訳される）。 */
  const obsOut = (sourceName: string) =>
    ({ kind: "obs-source", sourceName }) as const;
  /** 保存された 1 件目のガチャ。 */
  const storedGacha = () => loadGachaLibrary()[0];
  /** 条件に割り当てられたガチャ id（`null` ＝ ガチャではない）。 */
  const assignedGachaId = (id: string): string | null => {
    const effect = loadEffectConditions().find((c) => c.id === id)?.effect;
    return effect?.kind === "gacha" ? effect.gachaId : null;
  };

  it("⚠⚠ ガチャの一覧が正しく読める（063d で足した保存先）", () => {
    putGacha([
      prize({ name: "大当たり", weight: 1, sourceName: UUID }),
      prize({ name: "はずれ", weight: 9, sourceName: UUID2 }),
    ]);
    expect(storedGacha()?.prizes).toEqual([
      { name: "大当たり", weight: 1, output: obsOut(UUID) },
      { name: "はずれ", weight: 9, output: obsOut(UUID2) },
    ]);
  });

  it("⚠⚠ 景品 0 件でもガチャは一覧に残る（消すと「作ったのに増えない」になる）", () => {
    putGacha([]);
    expect(storedGacha()?.prizes).toEqual([]);
    localStorage.setItem(
      GACHA_LIBRARY_KEY,
      JSON.stringify([{ id: "g:1", name: "x" }]),
    );
    expect(storedGacha()?.prizes).toEqual([]);
  });

  it("⚠⚠ `weight` が 0 / 負 / 小数 / 上限超の景品は**その行だけ**落ちる（0 除算と『絶対に出ない景品』を作らない）", () => {
    putGacha([
      prize({ name: "0", weight: 0 }),
      prize({ name: "負", weight: -1 }),
      prize({ name: "小数", weight: 1.5 }),
      prize({ name: "NaN", weight: Number.NaN }),
      prize({ name: "文字", weight: "3" }),
      prize({ name: "上限超", weight: GACHA_WEIGHT_MAX + 1 }),
      prize({ name: "上限", weight: GACHA_WEIGHT_MAX }),
      prize({ name: "下限", weight: 1 }),
    ]);
    expect(storedGacha()?.prizes.map((p) => p.name)).toEqual(["上限", "下限"]);
  });

  it("⚠ 旧形式の `sourceName` が空 / 制御文字入り / 非文字列の景品は落ちる（`EffectObsSource` と同じ規則）", () => {
    putGacha([
      prize({ name: "空", sourceName: "   " }),
      prize({ name: "制御", sourceName: "a\u0000b" }),
      prize({ name: "非文字列", sourceName: 42 }),
      prize({ name: "ok", sourceName: `  ${UUID}  ` }),
    ]);
    expect(storedGacha()?.prizes).toEqual([
      { name: "ok", weight: 1, output: obsOut(UUID) },
    ]);
  });

  it("⚠ 景品名が長すぎる／制御文字入りの景品は落ち、空の景品名は許される", () => {
    const tooLong = "あ".repeat(GACHA_PRIZE_NAME_MAX_LENGTH + 1);
    putGacha([
      prize({ name: tooLong }),
      prize({ name: "a\u0000b" }),
      prize({ name: 42 }),
      prize({ name: "", sourceName: UUID2 }),
    ]);
    expect(storedGacha()?.prizes).toEqual([
      { name: "", weight: 1, output: obsOut(UUID2) },
    ]);
  });

  it("⚠ 景品は上限を超えたら落ちる（丸めない）", () => {
    putGacha(
      Array.from({ length: GACHA_PRIZE_MAX + 5 }, (_, i) =>
        prize({ name: `p${i}` }),
      ),
    );
    expect(storedGacha()?.prizes).toHaveLength(GACHA_PRIZE_MAX);
  });

  /**
   * ⚠⚠⚠ **063d: ガチャ名は空を許さない**（景品名とはここが違う）。
   * `<select>` の選択肢に出るので、空だと**選べないガチャ**が一覧に並ぶ。
   */
  it("⚠⚠ ガチャ名が空 / 制御文字入り / 長すぎ / 非文字列なら、そのガチャごと落ちる", () => {
    const tooLong = "あ".repeat(GACHA_NAME_MAX_LENGTH + 1);
    localStorage.setItem(
      GACHA_LIBRARY_KEY,
      JSON.stringify([
        { id: "g:1", name: "   ", prizes: [] },
        { id: "g:2", name: "a\u0000b", prizes: [] },
        { id: "g:3", name: tooLong, prizes: [] },
        { id: "g:4", name: 42, prizes: [] },
        { id: "g:5", name: "  ok  ", prizes: [] },
      ]),
    );
    expect(loadGachaLibrary()).toEqual([{ id: "g:5", name: "ok", prizes: [] }]);
  });

  it("⚠⚠ id が重複したガチャは先勝ちで落とす（どちらを指しているか決まらなくなる）", () => {
    localStorage.setItem(
      GACHA_LIBRARY_KEY,
      JSON.stringify([
        { id: "g:1", name: "さき", prizes: [] },
        { id: "g:1", name: "あと", prizes: [] },
      ]),
    );
    expect(loadGachaLibrary().map((g) => g.name)).toEqual(["さき"]);
  });

  it("⚠ ガチャは上限を超えたら落ちる（丸めない）", () => {
    localStorage.setItem(
      GACHA_LIBRARY_KEY,
      JSON.stringify(
        Array.from({ length: GACHA_DEFINITION_MAX + 3 }, (_, i) => ({
          id: `g:${i + 1}`,
          name: `ガチャ${i + 1}`,
          prizes: [],
        })),
      ),
    );
    expect(loadGachaLibrary()).toHaveLength(GACHA_DEFINITION_MAX);
  });

  it("⚠⚠ 保存経路でも同じ検査が効く（読み込み時だけの検査にしない）", () => {
    saveGachaLibrary([
      {
        id: "g:1",
        name: "のこる",
        prizes: [
          { name: "落ちる", weight: 0, output: { kind: "obs-source", sourceName: UUID } },
          { name: "残る", weight: 2, output: { kind: "obs-source", sourceName: UUID2 } },
        ],
      },
    ]);
    expect(localStorage.getItem(GACHA_LIBRARY_KEY) ?? "").not.toContain(
      "落ちる",
    );
    expect(storedGacha()?.prizes).toEqual([
      { name: "残る", weight: 2, output: obsOut(UUID2) },
    ]);
  });

  /**
   * ⚠⚠⚠ **063d: id を詰めない**（`kw:n` とまったく同じ規律）。
   * 詰めると「削除したガチャを指していた条件が、新しく作った別のガチャを黙って指す」。
   */
  it("⚠⚠⚠ 次の id は「最大 n + 1」で、削除しても詰めない", () => {
    // ⚠⚠ レビュー Q-2: **第 2 引数は必須**になった（既定値 `[]` を外した）。
    //   省略できると「渡し忘れると黙って穴が開く」形になり、⚠ 実際に `migrateLegacyGachas` が
    //   渡し忘れていた（Q-1）。⇒ **見るべき id が無いときも明示的に `[]` と書く。**
    expect(nextGachaId([], [])).toBe("g:1");
    expect(
      nextGachaId(
        [
          { id: "g:1", name: "a", prizes: [] },
          { id: "g:3", name: "b", prizes: [] },
        ],
        [],
      ),
    ).toBe("g:4");
    expect(nextGachaId([{ id: "g:3", name: "b", prizes: [] }], [])).toBe("g:4");
    // ⚠⚠⚠ 穴 W: **一覧が空でも、条件がまだ指している id は避ける。**
    expect(nextGachaId([], ["g:5"])).toBe("g:6");
  });

  /**
   * ⚠⚠ **レビュー Q-2: 採番が読む id の形は `kw:` 側（`/^\d+$/`）と揃える。**
   *
   * 旧実装は `Number(id.slice(2))` だったので `g:0x10`（→16）・`g:1e3`（→1000）・
   * `g: 5`（→5）を通し、**手で編集された id が採番の最大値を不当に押し上げられた**。
   */
  it("⚠⚠ 採番は `g:<数字>` 以外の id を見ない（`kw:` と同じ厳しさ）", () => {
    for (const bad of ["g:0x10", "g:1e3", "g: 5", "g:-1", "g:1.5", "g:", "gacha:9"]) {
      expect(nextGachaId([], [bad])).toBe("g:1");
    }
  });

  it("⚠⚠ 割り当ては gachaId を保つ（一覧に無い id でも「出さない」へ潰さない）", () => {
    setConditionEffect("event:superchat", { kind: "gacha", gachaId: "g:9" });
    expect(assignedGachaId("event:superchat")).toBe("g:9");
    // ⚠⚠ レビュー Q-6: 述語の持ち主は `effectSelectValue.ts` の [`isGachaMissingFromList`] 1 か所。
    //   （`effectAssignments.ts` 側にあった同名同実装の `isGachaMissingFromLibrary` は削除した。
    //   ⚠ **本番が使うのはこちら**なので、検査もこちらに付ける。）
    expect(
      isGachaMissingFromList(
        { kind: "gacha", gachaId: "g:9" },
        loadGachaLibrary(),
      ),
    ).toBe(true);
  });

  it("⚠ gachaId が空 / 非文字列 / 長すぎなら「出さない」へ倒れる", () => {
    for (const bad of [
      "",
      "   ",
      42,
      null,
      "g".repeat(GACHA_ID_MAX_LENGTH + 1),
    ]) {
      localStorage.setItem(
        EFFECT_ASSIGNMENTS_KEY,
        JSON.stringify([ev("superchat", { kind: "gacha", gachaId: bad })]),
      );
      expect(assignedGachaId("event:superchat")).toBeNull();
    }
  });

  // --- 063d 穴 P〜Q: 063a 形式からの移行 ---------------------------------------------------

  /**
   * ⚠⚠⚠ **本タスク最大の危険箇所。**
   *
   * `parseAssignment` は 063a 形式（`{kind:"gacha", prizes}`）を「出さない」へ落とすので、
   * **移行より先に保存が走ると景品が消える**。⇒ `runGachaMigration` が
   * **生の JSON に対して**働くことを、ここで固定する。
   */
  const legacy = (eventType: string, prizes: unknown[]) => ({
    id: `event:${eventType}`,
    when: { type: "event", eventType },
    effect: { kind: "gacha", prizes },
  });

  it("⚠⚠⚠ 063a 形式は一覧へ移り、景品が 1 つも失われない", () => {
    localStorage.setItem(
      EFFECT_ASSIGNMENTS_KEY,
      JSON.stringify([
        legacy("superchat", [prize({ name: "大当たり", weight: 100 })]),
      ]),
    );
    expect(runGachaMigration()).toEqual([
      {
        id: "g:1",
        name: "移行したガチャ 1",
        prizes: [{ name: "大当たり", weight: 100, output: obsOut(UUID) }],
      },
    ]);
    expect(assignedGachaId("event:superchat")).toBe("g:1");
    expect(localStorage.getItem(EFFECT_ASSIGNMENTS_KEY) ?? "").not.toContain(
      "大当たり",
    );
  });

  it("⚠⚠⚠ 穴 Q: 同じ景品構成でも**まとめない**（頼んでいない共有を作らない）", () => {
    const same = [prize({ name: "同じ", weight: 100 })];
    localStorage.setItem(
      EFFECT_ASSIGNMENTS_KEY,
      JSON.stringify([legacy("superchat", same), legacy("jewels", same)]),
    );
    expect(runGachaMigration().map((g) => g.id)).toEqual(["g:1", "g:2"]);
    expect(assignedGachaId("event:superchat")).toBe("g:1");
    expect(assignedGachaId("event:jewels")).toBe("g:2");
  });

  it("⚠⚠ 移行は冪等（2 回走らせても増えない・StrictMode 対策）", () => {
    localStorage.setItem(
      EFFECT_ASSIGNMENTS_KEY,
      JSON.stringify([legacy("superchat", [prize({ weight: 100 })])]),
    );
    runGachaMigration();
    const second = runGachaMigration();
    expect(second).toHaveLength(1);
    expect(
      migrateLegacyGachas(
        JSON.parse(localStorage.getItem(EFFECT_ASSIGNMENTS_KEY) ?? "[]"),
        second,
      ),
    ).toBeNull();
  });

  it("⚠ 移すものが無ければ何も書かない（`null` を返す純関数）", () => {
    expect(migrateLegacyGachas([], [])).toBeNull();
    expect(migrateLegacyGachas("こわれた", [])).toBeNull();
    expect(
      migrateLegacyGachas([{ effect: { kind: "gacha", gachaId: "g:1" } }], []),
    ).toBeNull();
  });

  it("⚠ 上限に達したら移さない（超えた分は「出さない」へ倒れる）", () => {
    saveGachaLibrary(
      Array.from({ length: GACHA_DEFINITION_MAX }, (_, i) => ({
        id: `g:${i + 1}`,
        name: `ガチャ${i + 1}`,
        prizes: [],
      })),
    );
    localStorage.setItem(
      EFFECT_ASSIGNMENTS_KEY,
      JSON.stringify([legacy("superchat", [prize({ weight: 100 })])]),
    );
    expect(runGachaMigration()).toHaveLength(GACHA_DEFINITION_MAX);
    expect(assignedGachaId("event:superchat")).toBeNull();
  });

  /**
   * ⚠⚠⚠ **レビュー Q-1（穴 W の移行版）。**
   *
   * 旧実装は移行の採番を `nextGachaId(nextLibrary)` と **`usedIds` なし**で呼んでいたので、
   * 「一覧から消えたガチャを指したままの条件」と「063a 形式の条件」が同居していると、
   * **前者の参照が、移行で作られた後者のガチャを黙って指す**。
   * ⚠ **これは N6（穴 W）とまったく同じ壊れ方が、別の入口から入るもの**である。
   */
  it("⚠⚠⚠ Q-1: 移行の採番は、条件がまだ指している id を再利用しない", () => {
    localStorage.setItem(
      EFFECT_ASSIGNMENTS_KEY,
      JSON.stringify([
        // 一覧から消えたガチャを指したまま残っている参照（一覧は空）。
        ev("superchat", { kind: "gacha", gachaId: "g:1" }),
        // 063a 形式（移行対象）。
        legacy("gift", [prize({ name: "大当たり", weight: 100 })]),
      ]),
    );
    const library = runGachaMigration();
    expect(library.map((g) => g.id)).toEqual(["g:2"]);
    // ⚠ 古い参照は `g:1` のまま（＝**新しいガチャへ化けていない**）。
    expect(assignedGachaId("event:superchat")).toBe("g:1");
    expect(assignedGachaId("event:gift")).toBe("g:2");
  });

  /**
   * ⚠⚠ **レビュー Q-9: 一覧を条件より先に保存することを固定する。**
   *
   * `runGachaMigration` の JSDoc は「順序が逆だと、条件だけ `gachaId` になって
   * **指す先が無い**状態で落ちたときに景品が復元できない」と理由を書いているのに、
   * ⚠ **その理由を守る検査が無く、順序を入れ替えるミューテーションが緑のまま生存していた。**
   */
  it("⚠⚠ Q-9: 移行は**一覧を先に**保存する（途中で落ちても景品が復元できる）", () => {
    localStorage.setItem(
      EFFECT_ASSIGNMENTS_KEY,
      JSON.stringify([legacy("superchat", [prize({ weight: 100 })])]),
    );
    const keys: string[] = [];
    // ⚠ 書き込みは実際に行いつつ、**呼ばれた順番だけ**を記録する
    //   （先例: `EffectOverlayApp.streamEvent.test.tsx` の `setItem` spy）。
    const original = Storage.prototype.setItem;
    const spy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(function (this: Storage, key: string, value: string) {
        keys.push(key);
        original.call(this, key, value);
      });
    runGachaMigration();
    spy.mockRestore();
    expect(keys.indexOf(GACHA_LIBRARY_KEY)).toBeGreaterThanOrEqual(0);
    expect(keys.indexOf(GACHA_LIBRARY_KEY)).toBeLessThan(
      keys.indexOf(EFFECT_ASSIGNMENTS_KEY),
    );
  });

  it("⚠⚠⚠ 063b: ガチャの割り当ても matcher を通る（063d までは `select` が落としていた）", () => {
    addKeywordCondition(
      { text: "ガチャ", match: "contains" },
      { kind: "gacha", gachaId: "g:1" },
    );
    // ⚠ 走査順がそのまま優先順位（先に保存したガチャが勝つ）＝ OBS ソースと同じ規則。
    addKeywordCondition({ text: "ガチャ", match: "contains" }, OBS);
    expect(obsMatch({ eventType: "chat", text: "ガチャ" })?.effect).toEqual({
      kind: "gacha",
      gachaId: "g:1",
    });
  });

  it("⚠⚠⚠ 063b（穴 A の担保・その 1）: matcher は抽選を 1 度も行わない", () => {
    // ⚠⚠ **`select` の中で引く実装に変えると、当たっていない条件でも乱数が回る。**
    //   matcher の戻り値は**引く前の `EffectGacha` のまま**でなければならない
    //   （＝ここに `sourceName` が現れたら、どこかで引いてしまっている）。
    addKeywordCondition(
      { text: "ガチャ", match: "contains" },
      { kind: "gacha", gachaId: "g:1" },
    );
    const match = obsMatch({ eventType: "chat", text: "ガチャ" });
    expect(match?.effect).toEqual({ kind: "gacha", gachaId: "g:1" });
    expect(JSON.stringify(match)).not.toContain("sourceName");
  });

  it("⚠⚠ 063b: 未知の kind は matcher まで届かない（前方互換のガードが生きている）", () => {
    // ⚠⚠⚠ **このケースが守っているのは `select` ではなく [`parseAssignment`] である**
    //   （063b の実装中に判明した訂正）。`readConditions` が必ず `parseConditions` を通すので、
    //   **未知の kind は `select` へ届く前に `{kind:"none"}` へ潰れている**。
    //   ⚠ ＝ `select` を allow-list にしても `!== "none"` にしても**このケースは緑のまま**
    //   （ミューテーションで実測済み）。⚠ **それでもこのケースは消さないこと**——
    //   061h / 064d の移行をコード 1 行も書かずに済ませた仕組み本体がここだからである。
    localStorage.setItem(
      EFFECT_ASSIGNMENTS_KEY,
      JSON.stringify([
        {
          id: "kw:1",
          when: { type: "keyword", text: "ガチャ", match: "contains" },
          effect: { kind: "future-lane", sourceName: "x" },
        },
      ]),
    );
    expect(obsMatch({ eventType: "chat", text: "ガチャ" })).toBeNull();
  });

  it("⚠⚠ §9: 抽選履歴・当選者は 1 バイトも保存されない", () => {
    saveGachaLibrary([
      {
        id: "g:1",
        name: "大当たりガチャ",
        prizes: [
          { name: "大当たり", weight: 1, output: { kind: "obs-source", sourceName: UUID } },
        ],
      },
    ]);
    setConditionEffect("event:superchat", { kind: "gacha", gachaId: "g:1" });
    const stored = `${raw() ?? ""}${localStorage.getItem(GACHA_LIBRARY_KEY) ?? ""}`;
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


/**
 * ⚠⚠⚠ **063c 段 2-a: 景品の出力先（[`GachaPrizeOutput`]）の保存形。**
 *
 * ⚠ 上の 063d の describe が**旧形式（`sourceName` 直付け）が読めること**を丸ごと担っているので、
 * ここが担うのは **新形式・未知の形・両方が入っているとき**の 3 つである。
 */
describe("063c 段 2-a: 景品の出力先（GachaPrizeOutput）", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  /** ⚠ **生の JSON を書く**（保存関数を通すと新形式に正規化されてしまい、読み込み側を試せない）。 */
  const putRawPrizes = (prizes: readonly unknown[]) =>
    localStorage.setItem(
      GACHA_LIBRARY_KEY,
      JSON.stringify([{ id: "g:1", name: "g", prizes }]),
    );
  const stored = (): readonly GachaPrize[] => loadGachaLibrary()[0]?.prizes ?? [];

  it("⚠ 新形式の `{kind:\"builtin\"}` が読める", () => {
    putRawPrizes([{ name: "当たり", weight: 1, output: { kind: "builtin" } }]);
    expect(stored()).toEqual([
      { name: "当たり", weight: 1, output: { kind: "builtin" } },
    ]);
  });

  it("⚠ 新形式の `{kind:\"obs-source\"}` は trim される（旧形式と同じ規則）", () => {
    putRawPrizes([
      { name: "A", weight: 1, output: { kind: "obs-source", sourceName: "  花火  " } },
    ]);
    expect(stored()).toEqual([
      { name: "A", weight: 1, output: { kind: "obs-source", sourceName: "花火" } },
    ]);
  });

  it("⚠⚠ `output` が在れば旧 `sourceName` は無視される（片方だけが真実）", () => {
    putRawPrizes([
      {
        name: "A",
        weight: 1,
        output: { kind: "builtin" },
        sourceName: "旧いソース名",
      },
    ]);
    expect(stored()).toEqual([
      { name: "A", weight: 1, output: { kind: "builtin" } },
    ]);
    expect(JSON.stringify(stored())).not.toContain("旧いソース名");
  });

  it("⚠⚠⚠ 未知の kind は**その行だけ落ちる**（組み込みへ倒さない）", () => {
    putRawPrizes([
      { name: "未知", weight: 1, output: { kind: "webhook", url: "http://x" } },
      { name: "空 kind", weight: 1, output: {} },
      { name: "残る", weight: 1, output: { kind: "builtin" } },
    ]);
    expect(stored().map((p) => p.name)).toEqual(["残る"]);
  });

  it("⚠ `output.sourceName` が不正なら落ちる（旧形式と同じ 1 つの規則）", () => {
    putRawPrizes([
      { name: "空", weight: 1, output: { kind: "obs-source", sourceName: "   " } },
      { name: "制御", weight: 1, output: { kind: "obs-source", sourceName: "a\u0000b" } },
      { name: "非文字列", weight: 1, output: { kind: "obs-source", sourceName: 42 } },
    ]);
    expect(stored()).toEqual([]);
  });

  it("⚠⚠ 保存経路でも同じ検査が効く（読み込み時だけの検査にしない）", () => {
    saveGachaLibrary([
      {
        id: "g:1",
        name: "g",
        prizes: [
          { name: "残る", weight: 1, output: { kind: "builtin" } },
          // ⚠ 型を欺いて不正値を保存経路へ流す（手で localStorage を編集した場合に相当）。
          { name: "落ちる", weight: 1, output: { kind: "obs-source", sourceName: "" } },
        ] as unknown as GachaPrize[],
      },
    ]);
    expect(stored().map((p) => p.name)).toEqual(["残る"]);
  });

  it("⚠⚠ 表示名の規則は `gachaPrizeLabel` 1 か所（名前 → ソース名 → 既定）", () => {
    expect(
      gachaPrizeLabel({ name: "大当たり", weight: 1, output: { kind: "builtin" } }),
    ).toBe("大当たり");
    expect(
      gachaPrizeLabel({
        name: "",
        weight: 1,
        output: { kind: "obs-source", sourceName: "花火" },
      }),
    ).toBe("花火");
    expect(
      gachaPrizeLabel({ name: "", weight: 1, output: { kind: "builtin" } }),
    ).toBe(GACHA_UNNAMED_PRIZE_LABEL);
  });

  it("⚠⚠⚠ 表示名が空文字にならない（配信画面の景品名が空のまま出ない）", () => {
    expect(
      gachaPrizeLabel({ name: "", weight: 1, output: { kind: "builtin" } }).length,
    ).toBeGreaterThan(0);
  });
});
