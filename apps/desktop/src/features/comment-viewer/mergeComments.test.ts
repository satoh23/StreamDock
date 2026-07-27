import { describe, it, expect } from "vitest";
import { MAX_COMMENTS, mergeComments } from "./mergeComments";
import type { CommentViewDto } from "./types";

/**
 * 043e: 受信コメントの蓄積ロジック（`mergeComments`）の仕様テスト。033f で切り出されて以来テストが無かったが、
 * 043e で **表示・TTS・保存の 3 系統がぶら下がる単一注入点**に「更新（updated）」の概念が入ったため新設した。
 *
 * 仕様（こうあるべき）— mergeComments.ts の docstring が正:
 * - `next`    … 表示用の全体リスト（上限クランプ後）。本体ビューとオーバーレイが共有する。
 * - `added`   … **新規行だけ**。TTS enqueue の単一注入点なので、ここに載る＝読み上げられる。
 * - `updated` … **既存行の中身が変わったもの**（YouTube Jewels の combo 更新）。記録専用で TTS へは渡らない。
 * - 同一 id の更新を許すのは **`eventType === "jewels"` のみ**。他種別の同一 id は従来どおり完全にスキップする
 *   （表示も記録も動かさない＝3 層すべてで従来と同じ挙動）。
 * - 変化判定は **Rust `record_comment` が UPDATE する 4 列**（text / monetaryAmount / monetary.amount /
 *   monetary.currency）＋表示専用の comboCount。この「比較キー ⊇ 更新列」が崩れると更新の取りこぼしが出る。
 *
 * 再修正トリガー: repository.rs の UPDATE 対象列を増減したら、本テストと hasComboPayloadChanged を同時に更新する。
 */

/** テスト用のコメント 1 件（既定は通常チャット）。 */
const comment = (over: Partial<CommentViewDto> = {}): CommentViewDto => ({
  id: "c1",
  source: "youtube",
  author: { id: "u1", name: "Alice" },
  text: "hello",
  publishedAt: "2026-01-01T00:00:00Z",
  eventType: "chat",
  ...over,
});

/** テスト用の Jewels コメント（金額つき）。 */
const jewels = (over: Partial<CommentViewDto> = {}): CommentViewDto =>
  comment({
    id: "g1",
    eventType: "jewels",
    text: "",
    monetaryAmount: "30 JEWELS",
    monetary: { amount: 30, currency: "JEWELS" },
    ...over,
  });

describe("mergeComments: 新規追加（従来仕様の据え置き）", () => {
  it("新規 id は added に載り next へ追加される", () => {
    const a = comment({ id: "c1" });
    const b = comment({ id: "c2" });
    const { next, added, updated } = mergeComments([a], [b]);
    expect(next.map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(added).toEqual([b]);
    expect(updated).toEqual([]);
  });

  it("同一 id かつ中身も同じなら added / updated のどちらにも載らず next も変わらない", () => {
    const a = comment({ id: "c1" });
    const { next, added, updated } = mergeComments([a], [comment({ id: "c1" })]);
    expect(next).toEqual([a]);
    expect(added).toEqual([]);
    expect(updated).toEqual([]);
  });

  it("上限を超えたら古い方から捨てるが、added はクランプ前の追加分を返す（読み上げを落とさない）", () => {
    const prev = Array.from({ length: MAX_COMMENTS }, (_, i) =>
      comment({ id: `old-${i}` }),
    );
    const fresh = comment({ id: "new-1" });
    const { next, added } = mergeComments(prev, [fresh]);
    expect(next).toHaveLength(MAX_COMMENTS);
    expect(next[0].id).toBe("old-1"); // 先頭（最古）が 1 件落ちる
    expect(next[next.length - 1].id).toBe("new-1");
    expect(added).toEqual([fresh]);
  });
});

describe("mergeComments: jewels の combo 更新（043e）", () => {
  it("金額が変わった同一 id は updated に載り、表示行は増えずに中身だけ差し替わる", () => {
    const first = jewels();
    const combo = jewels({
      monetaryAmount: "90 JEWELS",
      monetary: { amount: 90, currency: "JEWELS" },
      comboCount: 3,
    });
    const { next, added, updated } = mergeComments([first], [combo]);
    expect(next).toHaveLength(1); // 行は増えない（combo は論理的に 1 ギフト）
    expect(next[0]).toEqual(combo); // 中身だけ最新へ差し替わる
    expect(updated).toEqual([combo]);
    // added が空＝TTS の単一注入点に載らない＝combo 更新で再読み上げされない（本タスクの完了条件）。
    expect(added).toEqual([]);
  });

  it("comboCount だけが変わった場合も updated に載る（金額据え置きの combo を取りこぼさない）", () => {
    const first = jewels({ comboCount: 1 });
    const combo = jewels({ comboCount: 3 });
    const { added, updated } = mergeComments([first], [combo]);
    expect(updated).toEqual([combo]);
    expect(added).toEqual([]);
  });

  it("text だけが変わった場合も updated に載る（Rust の UPDATE 列と比較キーが一致している）", () => {
    const first = jewels({ text: "" });
    const combo = jewels({ text: "combo!" });
    const { next, updated } = mergeComments([first], [combo]);
    expect(updated).toEqual([combo]);
    expect(next[0].text).toBe("combo!");
  });

  it("中身が同じ再送は updated に載らない（StrictMode の二重実行で無駄な UPDATE を飛ばさない）", () => {
    const first = jewels({ comboCount: 3 });
    const { next, added, updated } = mergeComments([first], [jewels({ comboCount: 3 })]);
    expect(next).toEqual([first]);
    expect(added).toEqual([]);
    expect(updated).toEqual([]);
  });

  // レビュー指摘 Q-1: `added` は「新規コメント」ではなく厳密には「prev に無い id」。クランプで既に
  //   next から消えた jewels 行に後から combo 更新が届くと updated ではなく added に載る（＝TTS まで到達し、
  //   再読み上げを防ぐのは ttsQueue の seenIds）。仕様として正しいので、その挙動をここで固定しておく。
  it("prev から既に消えている id の combo 更新は added に載る（再読み上げ防止は ttsQueue.seenIds が担う）", () => {
    const combo = jewels({
      id: "g-evicted",
      monetaryAmount: "90 JEWELS",
      monetary: { amount: 90, currency: "JEWELS" },
      comboCount: 3,
    });
    // prev（＝前回の next）に対象 id が存在しない状況＝クランプで既に落ちた後。
    const { next, added, updated } = mergeComments([comment({ id: "c1" })], [combo]);
    expect(added).toEqual([combo]);
    expect(updated).toEqual([]);
    expect(next.map((c) => c.id)).toEqual(["c1", "g-evicted"]);
  });

  it("上限でクランプされて next から落ちた行の更新も updated には載る（記録へ届く）", () => {
    const target = jewels({ id: "g-old" });
    const prev = [
      target,
      ...Array.from({ length: MAX_COMMENTS - 1 }, (_, i) => comment({ id: `c-${i}` })),
    ];
    const combo = jewels({
      id: "g-old",
      monetary: { amount: 90, currency: "JEWELS" },
      monetaryAmount: "90 JEWELS",
    });
    // 新規 1 件で溢れさせ、先頭（更新対象）が next から落ちる状況を作る。
    const { next, updated } = mergeComments(prev, [combo, comment({ id: "c-new" })]);
    expect(next.some((c) => c.id === "g-old")).toBe(false);
    expect(updated).toEqual([combo]);
  });
});

describe("mergeComments: jewels 以外は従来どおり（限定の担保）", () => {
  it("superchat の同一 id で金額が変わっても updated に載らず、表示行も元のまま", () => {
    const first = comment({
      id: "s1",
      eventType: "superchat",
      monetaryAmount: "500 JPY",
      monetary: { amount: 500, currency: "JPY" },
    });
    const resend = comment({
      id: "s1",
      eventType: "superchat",
      monetaryAmount: "9999 JPY",
      monetary: { amount: 9999, currency: "JPY" },
    });
    const { next, added, updated } = mergeComments([first], [resend]);
    expect(next).toEqual([first]); // 差し替えない
    expect(added).toEqual([]);
    expect(updated).toEqual([]); // Rust へ invoke も飛ばさない
  });

  it("chat の同一 id で本文が変わっても完全にスキップする", () => {
    const first = comment({ id: "c1", text: "hello" });
    const { next, added, updated } = mergeComments(
      [first],
      [comment({ id: "c1", text: "tampered" })],
    );
    expect(next).toEqual([first]);
    expect(added).toEqual([]);
    expect(updated).toEqual([]);
  });
});

describe("mergeComments: jewels 以外は従来どおり（限定の担保・全種別）", () => {
  // 仕様: 「id 更新型イベント」は公式仕様上 GIFT_EVENT（jewels）だけ。よって jewels 以外の**すべての種別**で
  //   同一 id は完全スキップ＝表示も invoke も 0（3 層すべてで 043d 以前と挙動不変）。
  //   種別が増えたときに条件を緩めた変更（例: gift も更新可にする）を検知するため全種別で表明する。
  const NON_JEWELS_EVENT_TYPES = [
    "chat",
    "superchat",
    "membership",
    "subscription",
    "gift",
    "donation",
  ] as const;

  it.each(NON_JEWELS_EVENT_TYPES)(
    "%s の同一 id は中身が変わっても updated に載らず表示も変わらない",
    (eventType) => {
      const first = comment({ id: "x1", eventType, text: "before" });
      const resend = comment({
        id: "x1",
        eventType,
        text: "after",
        monetaryAmount: "9999 JPY",
        monetary: { amount: 9999, currency: "JPY" },
        comboCount: 3,
      });
      const { next, added, updated } = mergeComments([first], [resend]);
      expect(next).toEqual([first]);
      expect(added).toEqual([]);
      expect(updated).toEqual([]);
    },
  );
});

describe("mergeComments: 同一バッチ内の同 id（防御的挙動）", () => {
  // sidecar は comments.append を 1 件ずつ送るため実運用では起きないが、起きても
  // 「INSERT がまだ済んでいない id に UPDATE を撃つ」順序競合を作らないことを固定する。
  it("同一バッチで新規 → 更新が来たら added を最新値へ差し替え、updated には積まない", () => {
    const first = jewels({ comboCount: 1 });
    const combo = jewels({
      comboCount: 3,
      monetaryAmount: "90 JEWELS",
      monetary: { amount: 90, currency: "JEWELS" },
    });
    const { next, added, updated } = mergeComments([], [first, combo]);
    expect(next).toEqual([combo]);
    expect(added).toEqual([combo]); // 1 件だけ・値は最新
    expect(updated).toEqual([]);
  });

  // 仕様: prev に**既にある** jewels が同一バッチで 2 回更新された場合は、いずれも「INSERT 済みの行への
  //   UPDATE」なので順序競合は起きない。守るべきは ①表示行は 1 行のまま最新値 ②TTS には載らない
  //   ③記録に最後に届く値が最新値（＝表示と記録が一致する）の 3 点。updated の件数そのものは実装都合。
  it("prev にある jewels が同一バッチで 2 回更新されても、表示は 1 行・最新値で TTS には載らない", () => {
    const stored = jewels({ comboCount: 1 });
    const step2 = jewels({
      comboCount: 2,
      monetaryAmount: "60 JEWELS",
      monetary: { amount: 60, currency: "JEWELS" },
    });
    const step3 = jewels({
      comboCount: 3,
      monetaryAmount: "90 JEWELS",
      monetary: { amount: 90, currency: "JEWELS" },
    });
    const { next, added, updated } = mergeComments([stored], [step2, step3]);
    expect(next).toEqual([step3]); // 行は増えず最新値
    expect(added).toEqual([]); // 再読み上げしない
    // 記録へ最後に届く値＝表示と一致（`.at` は tsconfig の lib 対象外なので添字で取る）。
    expect(updated[updated.length - 1]).toEqual(step3);
    expect(updated.every((c) => c.id === stored.id)).toBe(true);
  });
});
