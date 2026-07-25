import { describe, it, expect } from "vitest";
import {
  providerLabel,
  eventLabel,
  fmtNumber,
  fmtSuperchat,
  commentAmount,
  fmtDateTime,
  viewerIdOf,
} from "./viewerFormat";

/**
 * 038b: 視聴者ビューの純粋な表示整形ヘルパの仕様テスト。
 *
 * 「こうあるべき（仕様）」を先に決めて表明する:
 * - 既知の値は表示名/日本語ラベルに、未知の値は "壊れず劣化" する（原文 or 空文字）。
 * - 金額は整形済み優先 → 数値(+通貨) → 無ければ null。0 は "0"（null にしない）。
 * - 日時は不正なら原文フォールバック（端末外へは出さないローカル整形）。
 */

describe("providerLabel", () => {
  it("既知 provider は表示名にする", () => {
    expect(providerLabel("twitch")).toBe("Twitch");
    expect(providerLabel("youtube")).toBe("YouTube");
  });
  it("未知 provider は原文のまま返す（壊れず劣化）", () => {
    expect(providerLabel("kick")).toBe("kick");
    expect(providerLabel("")).toBe("");
  });
});

describe("eventLabel", () => {
  it("既知イベントだけ日本語ラベルにする", () => {
    expect(eventLabel("superchat")).toBe("スーパーチャット");
    expect(eventLabel("bits")).toBe("ビッツ");
    expect(eventLabel("subscription")).toBe("サブスク");
    expect(eventLabel("membership")).toBe("メンバーシップ");
  });
  it("未知イベント（通常チャット等）はラベル無し＝空文字で劣化", () => {
    expect(eventLabel("chat")).toBe("");
    expect(eventLabel("")).toBe("");
  });
});

describe("fmtNumber", () => {
  it("ja-JP の桁区切りにする", () => {
    expect(fmtNumber(0)).toBe("0");
    expect(fmtNumber(1234567)).toBe("1,234,567");
  });
});

describe("fmtSuperchat", () => {
  it("通貨があれば『額 通貨』、無ければ額のみ", () => {
    expect(fmtSuperchat(500, "JPY")).toBe("500 JPY");
    expect(fmtSuperchat(1500)).toBe("1,500");
    expect(fmtSuperchat(1000, "")).toBe("1,000"); // 空通貨は falsy → 額のみ
  });
});

describe("commentAmount", () => {
  it("整形済み monetaryAmount を最優先する", () => {
    expect(commentAmount({ monetaryAmount: "¥500", amount: 999 })).toBe("¥500");
  });
  it("monetaryAmount が空なら amount(+通貨) にフォールバックする", () => {
    expect(commentAmount({ monetaryAmount: "", amount: 5 })).toBe("5");
    expect(commentAmount({ amount: 100, currency: "USD" })).toBe("100 USD");
    expect(commentAmount({ amount: 1000 })).toBe("1,000");
  });
  it("amount が 0 のときは '0' を表示（null にしない）", () => {
    expect(commentAmount({ amount: 0, currency: "USD" })).toBe("0 USD");
  });
  it("金額情報が無ければ null（金額バッジを出さない）", () => {
    expect(commentAmount({})).toBeNull();
    expect(commentAmount({ amount: undefined })).toBeNull();
  });
});

describe("fmtDateTime", () => {
  it("不正な日時は原文のままフォールバックする", () => {
    expect(fmtDateTime("not-a-date")).toBe("not-a-date");
    expect(fmtDateTime("")).toBe("");
  });
  it("正常な日時は整形される（原文 ISO とは異なり、年を含む）", () => {
    const out = fmtDateTime("2026-07-25T10:00:00Z");
    expect(out).not.toBe("2026-07-25T10:00:00Z");
    expect(out).toContain("2026");
  });
});

describe("viewerIdOf", () => {
  it("source と author.id を連結して安定キー（provider:providerUserId）にする", () => {
    expect(viewerIdOf({ source: "twitch", author: { id: "u1" } })).toBe("twitch:u1");
    expect(viewerIdOf({ source: "youtube", author: { id: "abc" } })).toBe("youtube:abc");
  });
  it("author.id は trim して Rust 側の key と完全一致させる", () => {
    expect(viewerIdOf({ source: "twitch", author: { id: "  u1  " } })).toBe("twitch:u1");
  });
});
