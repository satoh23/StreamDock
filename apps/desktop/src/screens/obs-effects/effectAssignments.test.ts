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
 * 061d-2 / 061h: イベント種別 → エフェクトの割り当ての仕様テスト。
 *
 * ⚠⚠ **この 1 ファイルが固定している最重要の不変条件＝「読み取れなかったら『出さない』へ倒れる」**
 * （⚠ **061h で 061d-2 の ⑪ を反転した**）。
 * 061d-2 は逆に「`{"kind":"none"}` 以外はすべて組み込みへ倒す」を固定していた——当時は
 * 組み込み意匠が既定の表示手段で、「アップデートしたら配信画面からエフェクトが消えた」が
 * 最悪の壊れ方だったため。⚠ **061h で組み込みを廃止したので前提ごと消えた**:
 *   - 倒れる先が**構造的に存在しない**（`EffectKind` の variant は template だけ）
 *   - 実害の向きが逆＝「**頼んでいない演出が黙って出る**」ほうが今の運用では大きい
 *   - 「出ない」は main 窓の警告で**観測できる**壊れ方である
 * ＝ **「出す」側へ倒れてよいのは、ユーザーが自分でテンプレートを選んだときだけ。**
 * ⚠ 下のケースはどれも「組み込み／テンプレートへ倒す」変異でレッドになる（ミューテーションで実測）。
 *
 * localStorage 以外の外部境界は使わない（IPC も通信も無い純ロジック）。
 */

const NONE = { kind: "none" } as const;
const UUID = "93c76e02-1111-4222-8333-444455556666";
const UUID2 = "0f0e0d0c-1111-4222-8333-444455556666";

/** 全種別が「エフェクトを出さない」であること（＝ 061h 以降の既定の形）。 */
const expectAllNone = (value: Record<string, unknown>) => {
  expect(Object.keys(value).sort()).toEqual([...MONETARY_EVENT_TYPES].sort());
  for (const eventType of MONETARY_EVENT_TYPES) {
    expect(value[eventType]).toEqual(NONE);
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

  // --- フォールバック（⚠ すべて「出さない」へ・061h） --------------------------------------------

  it("⚠⚠ 未保存なら全種別が「エフェクトを出さない」（＝割り当てるまで配信画面に何も出ない）", () => {
    expectAllNone(loadEffectAssignments());
  });

  it("⚠⚠ 不正な JSON は全種別「出さない」へ倒れる", () => {
    localStorage.setItem(EFFECT_ASSIGNMENTS_KEY, "{ not json");
    expectAllNone(loadEffectAssignments());
  });

  it("⚠⚠ localStorage が例外を投げても全種別「出さない」へ倒れる", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expectAllNone(loadEffectAssignments());
  });

  it("⚠ ルートが配列でも全種別「出さない」へ倒れる（添字が拾われない）", () => {
    localStorage.setItem(EFFECT_ASSIGNMENTS_KEY, JSON.stringify([1, 2, 3]));
    expectAllNone(loadEffectAssignments());
  });

  it("⚠ ルートが文字列・null でも全種別「出さない」へ倒れる", () => {
    localStorage.setItem(EFFECT_ASSIGNMENTS_KEY, JSON.stringify("none"));
    expectAllNone(loadEffectAssignments());
    localStorage.setItem(EFFECT_ASSIGNMENTS_KEY, JSON.stringify(null));
    expectAllNone(loadEffectAssignments());
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
    expectAllNone(loadEffectAssignments());
    // ⚠ プロトタイプが汚染されていないこと（既知キーしか引かない実装の担保）。
    expect(({} as Record<string, unknown>).kind).toBeUndefined();
  });

  it("⚠ 既知キーでも値が非オブジェクトなら、その行だけ「出さない」", () => {
    localStorage.setItem(
      EFFECT_ASSIGNMENTS_KEY,
      JSON.stringify({
        superchat: "template",
        subscription: { kind: "template", templateId: UUID },
      }),
    );
    const loaded = loadEffectAssignments();
    expect(loaded.superchat).toEqual(NONE);
    expect(loaded.subscription).toEqual({ kind: "template", templateId: UUID });
  });

  it("⚠⚠ 未知の kind（063 の gacha を古いビルドが読んだ場合）は「出さない」へ倒れる", () => {
    localStorage.setItem(
      EFFECT_ASSIGNMENTS_KEY,
      JSON.stringify({ superchat: { kind: "gacha", tableId: UUID } }),
    );
    expect(loadEffectAssignments().superchat).toEqual(NONE);
  });

  it("⚠⚠ 061h の移行: 旧 `builtin-monetary` の保存値は「出さない」へ倒れる（変換コードを書かない）", () => {
    // ⚠⚠ **これが 061h の移行仕様そのもの。** 061d〜061g のユーザーの localStorage には
    //   `{"superchat":{"kind":"builtin-monetary"}}` が残っている。組み込みを廃止した以上
    //   他に倒しようが無く、**「未知の kind は安全側へ倒す」という既存の前方互換がそのまま正しく働く**ので、
    //   移行専用の分岐は 1 つも足していない（同じことを 2 通りに書かない）。
    //   ⇒ **アップデート後、組み込みに割り当てていた種別は「表示しない」になる**（意図した仕様変更）。
    localStorage.setItem(
      EFFECT_ASSIGNMENTS_KEY,
      JSON.stringify({
        superchat: { kind: "builtin-monetary" },
        subscription: { kind: "template", templateId: UUID },
      }),
    );
    const loaded = loadEffectAssignments();
    expect(loaded.superchat).toEqual(NONE);
    // ⚠ 同じ保存値の中のテンプレート指定は**巻き添えにしない**（行ごとに独立して読む）。
    expect(loaded.subscription).toEqual({ kind: "template", templateId: UUID });
  });

  it("⚠⚠ templateId が uuid v4 の形でなければ「出さない」へ倒れる（IPC まで届かせない）", () => {
    for (const templateId of ["", "../../etc/passwd", "t1", 123, null]) {
      localStorage.setItem(
        EFFECT_ASSIGNMENTS_KEY,
        JSON.stringify({ superchat: { kind: "template", templateId } }),
      );
      expect(loadEffectAssignments().superchat).toEqual(NONE);
    }
  });

  it("⚠⚠ 「出す」側へ倒れるのはテンプレートを明示的に選んだときだけ", () => {
    localStorage.setItem(
      EFFECT_ASSIGNMENTS_KEY,
      JSON.stringify({ membership: { kind: "template", templateId: UUID } }),
    );
    const loaded = loadEffectAssignments();
    expect(loaded.membership).toEqual({ kind: "template", templateId: UUID });
    // ⚠ 触っていない種別は既定のまま（出さない）。
    expect(loaded.superchat).toEqual(NONE);
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
    expect(loaded.gift).toEqual(NONE);
    expect(loaded.jewels).toEqual(NONE);
  });

  it("⚠ 全部が既定（出さない）ならキーごと消す（未保存と同じ状態に潰す）", () => {
    // ⚠ 061h: 既定が「出さない」になったので、**非既定を作るにはテンプレートを選ぶしかない**
    //   （061d-2 のこのケースは `{kind:"none"}` を入れて非既定を作っていた）。
    saveEffectAssignments({
      ...loadEffectAssignments(),
      superchat: { kind: "template", templateId: UUID },
    });
    expect(localStorage.getItem(EFFECT_ASSIGNMENTS_KEY)).not.toBeNull();
    saveEffectAssignments(loadEffectAssignments0());
    expect(localStorage.getItem(EFFECT_ASSIGNMENTS_KEY)).toBeNull();
    expectAllNone(loadEffectAssignments());
  });

  it("⚠ 未知のイベント種別キーは保存もしない", () => {
    saveEffectAssignments({
      ...loadEffectAssignments(),
      superchat: { kind: "template", templateId: UUID },
      chat: { kind: "template", templateId: UUID },
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
        superchat: { kind: "template", templateId: UUID },
      }),
    ).not.toThrow();
  });

  // --- 復帰導線 ---------------------------------------------------------------------------------

  it("⚠⚠ 「すべて「表示しない」に戻す」で全種別が「出さない」へ戻る（復帰導線）", () => {
    // ⚠⚠ **これが唯一の脱出路**（壊れたテンプレートで配信画面が読めなくなったとき）。
    //   ⚠ 061h で文言と戻し先が変わったが、**no-op にする変異でレッドになる**という担保は不変。
    saveEffectAssignments({
      superchat: { kind: "template", templateId: UUID },
      subscription: { kind: "none" },
      membership: { kind: "template", templateId: UUID2 },
      gift: { kind: "none" },
      donation: { kind: "none" },
      jewels: { kind: "none" },
    });
    const cleared = clearAllEffectAssignments();
    expectAllNone(cleared);
    // ⚠ 戻り値だけでなく**保存も**されていること（画面だけ戻って次回起動で復活しない）。
    expectAllNone(loadEffectAssignments());
  });

  it("⚠⚠ テンプレート削除時、それを使っている行だけが「出さない」へ戻る", () => {
    saveEffectAssignments({
      ...loadEffectAssignments(),
      superchat: { kind: "template", templateId: UUID },
      membership: { kind: "template", templateId: UUID2 },
      gift: { kind: "none" },
    });
    const next = clearEffectAssignmentsForTemplate(UUID);
    expect(next.superchat).toEqual(NONE);
    // ⚠ 別のテンプレートと「出さない」は巻き添えにしない。
    expect(next.membership).toEqual({ kind: "template", templateId: UUID2 });
    expect(next.gift).toEqual(NONE);
    expect(loadEffectAssignments().superchat).toEqual(NONE);
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

  it("⚠⚠ resolver: 未保存（既定）も null（＝割り当てを引かずに出る経路が無い）", () => {
    // ⚠ 061h の本命。061d-2 はここが `{kind:"builtin-monetary"}` を返しており、
    //   **条件を 1 つも設定していない状態で投げ銭が来ると演出が出た**。
    expect(resolveEffectKind("superchat")).toBeNull();
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

  it("⚠ resolver: 未知のイベント種別も null（061h で「組み込みへ倒す」から反転）", () => {
    expect(resolveEffectKind("chat")).toBeNull();
  });

  it("⚠⚠ resolver は呼ばれるたびに読み直す（main 窓で変えた直後の 1 件目から効く）", () => {
    saveEffectAssignments({
      ...loadEffectAssignments(),
      superchat: { kind: "template", templateId: UUID },
    });
    expect(resolveEffectKind("superchat")).toEqual({
      kind: "template",
      templateId: UUID,
    });
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
