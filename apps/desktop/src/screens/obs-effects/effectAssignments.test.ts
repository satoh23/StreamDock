import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EFFECT_ASSIGNMENTS_KEY } from "../../features/comment-viewer/overlaySettings";
import { MONETARY_EVENT_TYPES } from "../comment-viewer/viewerFormat";
import {
  assignedTemplateIds,
  clearAllEffectAssignments,
  clearEffectAssignmentsForTemplate,
  loadEffectAssignments,
  resolveEffectKind,
  saveEffectAssignments,
} from "./effectAssignments";

/**
 * 061d-2: イベント種別 → エフェクトの割り当ての仕様テスト。
 *
 * ⚠⚠ **この 1 ファイルが固定している最重要の不変条件＝「壊れたら『組み込み』へ倒れる」**（⑪）。
 * 全「なし」へ倒す実装だと、**061d のリリースで既存ユーザーの投げ銭エフェクトが黙って止まる**
 * （アップデートしたら配信画面から消えた、という最悪の壊れ方）。
 * ＝ **「出さない」に倒れてよいのは、ユーザーが自分でそう選んだときだけ。**
 * ⚠ 下のケースはどれも「なし」へ倒す変異でレッドになる（ミューテーションで実測）。
 *
 * localStorage 以外の外部境界は使わない（IPC も通信も無い純ロジック）。
 */

const BUILTIN = { kind: "builtin-monetary" } as const;
const UUID = "93c76e02-1111-4222-8333-444455556666";
const UUID2 = "0f0e0d0c-1111-4222-8333-444455556666";

/** 全種別が「組み込み」であること（＝既定の形）。 */
const expectAllBuiltin = (value: Record<string, unknown>) => {
  expect(Object.keys(value).sort()).toEqual([...MONETARY_EVENT_TYPES].sort());
  for (const eventType of MONETARY_EVENT_TYPES) {
    expect(value[eventType]).toEqual(BUILTIN);
  }
};

describe("effectAssignments", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  // --- フォールバック（⚠ すべて「組み込み」へ） -------------------------------------------------

  it("⚠⚠ 未保存なら全種別が「組み込み」（＝既存ユーザーのエフェクトが黙って止まらない）", () => {
    expectAllBuiltin(loadEffectAssignments());
  });

  it("⚠⚠ 不正な JSON は全種別「組み込み」へ倒れる", () => {
    localStorage.setItem(EFFECT_ASSIGNMENTS_KEY, "{ not json");
    expectAllBuiltin(loadEffectAssignments());
  });

  it("⚠⚠ localStorage が例外を投げても全種別「組み込み」へ倒れる", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expectAllBuiltin(loadEffectAssignments());
  });

  it("⚠ ルートが配列でも全種別「組み込み」へ倒れる（添字が拾われない）", () => {
    localStorage.setItem(EFFECT_ASSIGNMENTS_KEY, JSON.stringify([1, 2, 3]));
    expectAllBuiltin(loadEffectAssignments());
  });

  it("⚠ ルートが文字列・null でも全種別「組み込み」へ倒れる", () => {
    localStorage.setItem(EFFECT_ASSIGNMENTS_KEY, JSON.stringify("none"));
    expectAllBuiltin(loadEffectAssignments());
    localStorage.setItem(EFFECT_ASSIGNMENTS_KEY, JSON.stringify(null));
    expectAllBuiltin(loadEffectAssignments());
  });

  it("⚠ 未知のイベント種別キーは無視する（読み込み結果に載らない）", () => {
    // ⚠⚠ **061d-2 レビュー Q-6: `__proto__` は生の文字列で書く。**
    //   `JSON.stringify({ __proto__: … })` はプロトタイプ設定として解釈されて**キーごと消える**ので、
    //   オブジェクトリテラルで書くとこのケースは 1 度も実行されない（実測）。
    //   `JSON.parse` は `__proto__` を own property として作るため、こちらが本物の検査になる。
    localStorage.setItem(
      EFFECT_ASSIGNMENTS_KEY,
      '{"chat":{"kind":"none"},"__proto__":{"kind":"none"}}',
    );
    expectAllBuiltin(loadEffectAssignments());
    // ⚠ プロトタイプが汚染されていないこと（既知キーしか引かない実装の担保）。
    expect(({} as Record<string, unknown>).kind).toBeUndefined();
  });

  it("⚠ 既知キーでも値が非オブジェクトなら、その行だけ「組み込み」", () => {
    localStorage.setItem(
      EFFECT_ASSIGNMENTS_KEY,
      JSON.stringify({ superchat: "none", subscription: { kind: "none" } }),
    );
    const loaded = loadEffectAssignments();
    expect(loaded.superchat).toEqual(BUILTIN);
    expect(loaded.subscription).toEqual({ kind: "none" });
  });

  it("⚠⚠ 未知の kind（063 の gacha を古いビルドが読んだ場合）は「組み込み」へ倒れる", () => {
    localStorage.setItem(
      EFFECT_ASSIGNMENTS_KEY,
      JSON.stringify({ superchat: { kind: "gacha", tableId: UUID } }),
    );
    expect(loadEffectAssignments().superchat).toEqual(BUILTIN);
  });

  it("⚠⚠ templateId が uuid v4 の形でなければ「組み込み」へ倒れる（IPC まで届かせない）", () => {
    for (const templateId of ["", "../../etc/passwd", "t1", 123, null]) {
      localStorage.setItem(
        EFFECT_ASSIGNMENTS_KEY,
        JSON.stringify({ superchat: { kind: "template", templateId } }),
      );
      expect(loadEffectAssignments().superchat).toEqual(BUILTIN);
    }
  });

  it("⚠⚠ 「エフェクトを出さない」だけが「出ない」側へ倒れる（ユーザーが明示的に選んだとき）", () => {
    localStorage.setItem(
      EFFECT_ASSIGNMENTS_KEY,
      JSON.stringify({ membership: { kind: "none" } }),
    );
    const loaded = loadEffectAssignments();
    expect(loaded.membership).toEqual({ kind: "none" });
    // ⚠ 触っていない種別は既定のまま（組み込み）。
    expect(loaded.superchat).toEqual(BUILTIN);
  });

  // --- 保存 -------------------------------------------------------------------------------------

  it("保存した割り当てを読み戻せる", () => {
    saveEffectAssignments({
      ...loadEffectAssignments(),
      superchat: { kind: "template", templateId: UUID },
      gift: { kind: "none" },
    });
    const loaded = loadEffectAssignments();
    expect(loaded.superchat).toEqual({ kind: "template", templateId: UUID });
    expect(loaded.gift).toEqual({ kind: "none" });
    expect(loaded.jewels).toEqual(BUILTIN);
  });

  it("⚠ 全部が既定（組み込み）ならキーごと消す（未保存と同じ状態に潰す）", () => {
    saveEffectAssignments({
      ...loadEffectAssignments(),
      superchat: { kind: "none" },
    });
    expect(localStorage.getItem(EFFECT_ASSIGNMENTS_KEY)).not.toBeNull();
    saveEffectAssignments(loadEffectAssignments0());
    expect(localStorage.getItem(EFFECT_ASSIGNMENTS_KEY)).toBeNull();
    expectAllBuiltin(loadEffectAssignments());
  });

  it("⚠ 未知のイベント種別キーは保存もしない", () => {
    saveEffectAssignments({
      ...loadEffectAssignments(),
      superchat: { kind: "none" },
      chat: { kind: "none" },
    });
    const raw = localStorage.getItem(EFFECT_ASSIGNMENTS_KEY) ?? "{}";
    // ⚠ 部分文字列で見ない（"superchat" が "chat" を含むので偽陽性になる）。キー集合で見る。
    expect(Object.keys(JSON.parse(raw) as object).sort()).toEqual(
      [...MONETARY_EVENT_TYPES].sort(),
    );
  });

  it("⚠ 保存できない環境でも例外を投げない（表示は既定で続く）", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() =>
      saveEffectAssignments({
        ...loadEffectAssignments(),
        superchat: { kind: "none" },
      }),
    ).not.toThrow();
  });

  // --- 復帰導線 ---------------------------------------------------------------------------------

  it("⚠⚠ 「すべての割り当てを解除」で全種別が「組み込み」へ戻る（復帰導線）", () => {
    saveEffectAssignments({
      superchat: { kind: "template", templateId: UUID },
      subscription: { kind: "none" },
      membership: { kind: "template", templateId: UUID2 },
      gift: { kind: "none" },
      donation: { kind: "none" },
      jewels: { kind: "none" },
    });
    const cleared = clearAllEffectAssignments();
    expectAllBuiltin(cleared);
    // ⚠ 戻り値だけでなく**保存も**されていること（画面だけ戻って次回起動で復活しない）。
    expectAllBuiltin(loadEffectAssignments());
  });

  it("⚠⚠ テンプレート削除時、それを使っている行だけが「組み込み」へ戻る", () => {
    saveEffectAssignments({
      ...loadEffectAssignments(),
      superchat: { kind: "template", templateId: UUID },
      membership: { kind: "template", templateId: UUID2 },
      gift: { kind: "none" },
    });
    const next = clearEffectAssignmentsForTemplate(UUID);
    expect(next.superchat).toEqual(BUILTIN);
    // ⚠ 別のテンプレートと「出さない」は巻き添えにしない。
    expect(next.membership).toEqual({ kind: "template", templateId: UUID2 });
    expect(next.gift).toEqual({ kind: "none" });
    expect(loadEffectAssignments().superchat).toEqual(BUILTIN);
  });

  // --- 先読みの対象 -----------------------------------------------------------------------------

  it("⚠ 先読みの対象は「割り当てに出てくる id」だけ（重複は畳む）", () => {
    const ids = assignedTemplateIds({
      ...loadEffectAssignments(),
      superchat: { kind: "template", templateId: UUID },
      subscription: { kind: "template", templateId: UUID },
      membership: { kind: "template", templateId: UUID2 },
      gift: { kind: "none" },
    });
    expect(ids.sort()).toEqual([UUID2, UUID].sort());
  });

  // --- resolver ---------------------------------------------------------------------------------

  it("⚠⚠ resolver: 「エフェクトを出さない」は null（＝decideEffects が 1 件も出さない）", () => {
    saveEffectAssignments({
      ...loadEffectAssignments(),
      superchat: { kind: "none" },
    });
    expect(resolveEffectKind("superchat")).toBeNull();
  });

  it("resolver: 「組み込み」は builtin-monetary", () => {
    expect(resolveEffectKind("superchat")).toEqual(BUILTIN);
  });

  it("resolver: テンプレート指定は template + templateId", () => {
    saveEffectAssignments({
      ...loadEffectAssignments(),
      superchat: { kind: "template", templateId: UUID },
    });
    expect(resolveEffectKind("superchat")).toEqual({
      kind: "template",
      templateId: UUID,
    });
  });

  it("⚠ resolver: 未知のイベント種別も「組み込み」へ（知らないから出さない、にしない）", () => {
    expect(resolveEffectKind("chat")).toEqual(BUILTIN);
  });

  it("⚠⚠ resolver は呼ばれるたびに読み直す（main 窓で変えた直後の 1 件目から効く）", () => {
    expect(resolveEffectKind("superchat")).toEqual(BUILTIN);
    saveEffectAssignments({
      ...loadEffectAssignments(),
      superchat: { kind: "none" },
    });
    // ⚠ モジュールを再読み込みしていないのに変わる＝ state にミラーしていないことの担保。
    expect(resolveEffectKind("superchat")).toBeNull();
  });
});

/** 既定の表（`loadEffectAssignments` の初期状態）を作るだけのヘルパ。 */
function loadEffectAssignments0() {
  localStorage.removeItem(EFFECT_ASSIGNMENTS_KEY);
  return loadEffectAssignments();
}
