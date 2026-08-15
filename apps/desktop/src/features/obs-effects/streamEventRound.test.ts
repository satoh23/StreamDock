import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  STREAM_EVENT_ROUND_KEY,
  STREAM_EVENT_SELECTED_KEY,
} from "../comment-viewer/overlaySettings";
import {
  clearStreamEventRound,
  formatStreamEventClock,
  isSameStreamEventRound,
  loadStreamEventRound,
  loadStreamEventSelected,
  parseStreamEventRound,
  saveStreamEventRound,
  saveStreamEventSelected,
  startStreamEventRound,
  streamEventRemainingLabel,
  streamEventRemainingMs,
} from "./streamEventRound";

/**
 * 061l: 配信イベントの**開催状態**の仕様テスト（判断 1・5）。
 *
 * あるべき挙動:
 * - ⚠⚠ **終了は「`endsAt` を過ぎた保存値を『開催していない』と読む」ことで表す**
 *   （`removeItem` する主体を決めない＝「main 窓が閉じていると消えない」を作らない）。
 * - ⚠⚠ **壊れた保存値はすべて「開催していない」へ倒す**（fail-safe）。とくに
 *   **未知 eventId**（アプリ更新でレジストリから消えた／他窓から細工された）も落とす。
 * - ⚠ 判定は **`now` を引数で受ける純関数**（テストで時計を偽装しない＝061b/061j と同じ規律）。
 *
 * ## ⚠⚠ 061p: 同梱レジストリを**差し替えて**検査する（`StreamEventTab.test.tsx` と同じ手）
 *
 * 061l はここで `STREAM_EVENT_REGISTRY[0]`（＝見本「みんなでコメントカウント」）を直接使っていたが、
 * **061p で同梱イベントが 0 本になった**ため、そのままだと `undefined` を掴んで落ちる。
 * ⇒ **検査用のイベントを 1 本注入する**。⚠ **こうすることで「開催状態の仕様」は
 * 同梱データの本数に関係なく固定され続ける**（次タスクで玉入れ大会を足したときも無改変で通る）。
 * ⚠⚠ **実データが 0 本であること自体は `streamEventRegistry.test.ts` が固定している**
 * （＝「未知 id は落とす」規則と合わせて、**実機では開催状態を作れない**ことの担保になっている）。
 */
// ⚠ `vi.mock` は巻き上げられるので、注入する値は `vi.hoisted` に置く
//   （`StreamEventTab.test.tsx` と同じ形。**同じ定義を 2 か所に書かない**）。
const mocks = vi.hoisted(() => ({
  event: {
    id: "test-event",
    icon: "🧪",
    title: "検査用イベント",
    summary: "検査用。",
    description: "検査用。",
    defaultDurationMs: 5 * 60_000,
    howTo: ["検査用"],
  },
}));
const EVENT = mocks.event;

vi.mock("./streamEventRegistry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./streamEventRegistry")>();
  const registry = [mocks.event];
  return {
    ...actual,
    STREAM_EVENT_REGISTRY: registry,
    findStreamEvent: (id: string) => registry.find((e) => e.id === id) ?? null,
    isStreamEventId: (id: string) => registry.some((e) => e.id === id),
  };
});

describe("061l: streamEventRound", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  // --- 新規 1: 期限切れ -------------------------------------------------------------------------

  it("⚠⚠ 新規 1: `endsAt` を過ぎた保存値は「開催していない」になる", () => {
    const raw = JSON.stringify({
      eventId: EVENT.id,
      startedAt: 1_000,
      endsAt: 5_000,
    });
    // 期限前は開催中。
    expect(parseStreamEventRound(raw, 4_999)).toEqual({
      eventId: EVENT.id,
      startedAt: 1_000,
      endsAt: 5_000,
    });
    // ⚠ `endsAt` ちょうどは「終わっている」側（境界）。
    expect(parseStreamEventRound(raw, 5_000)).toBeNull();
    expect(parseStreamEventRound(raw, 5_001)).toBeNull();
  });

  it("⚠ 期限切れでも保存値そのものは消さない（掃除は main 窓の best-effort）", () => {
    localStorage.setItem(
      STREAM_EVENT_ROUND_KEY,
      JSON.stringify({ eventId: EVENT.id, startedAt: 0, endsAt: 100 }),
    );
    expect(loadStreamEventRound(9_999)).toBeNull();
    // ⚠⚠ 読むだけで消えないこと（＝正しさが `removeItem` に依存していない）。
    expect(localStorage.getItem(STREAM_EVENT_ROUND_KEY)).not.toBeNull();
  });

  // --- 新規 2: 壊れた保存値 ---------------------------------------------------------------------

  it("⚠⚠ 新規 2: 壊れた保存値はすべて「開催していない」へ倒れる", () => {
    const now = 1_000;
    const cases: Array<[string, string | null]> = [
      ["未保存", null],
      ["非 JSON", "{"],
      ["文字列", JSON.stringify("open")],
      ["数値", JSON.stringify(1)],
      ["null", JSON.stringify(null)],
      ["配列", JSON.stringify([{ eventId: EVENT.id, startedAt: 0, endsAt: 9_999 }])],
      [
        "⚠⚠ 未知 eventId",
        JSON.stringify({ eventId: "no-such-event", startedAt: 0, endsAt: 9_999 }),
      ],
      [
        "eventId が文字列でない",
        JSON.stringify({ eventId: 1, startedAt: 0, endsAt: 9_999 }),
      ],
      [
        "startedAt が非数値",
        JSON.stringify({ eventId: EVENT.id, startedAt: "0", endsAt: 9_999 }),
      ],
      [
        "endsAt が非数値",
        JSON.stringify({ eventId: EVENT.id, startedAt: 0, endsAt: "9999" }),
      ],
      [
        "endsAt が NaN 相当（JSON では null）",
        JSON.stringify({ eventId: EVENT.id, startedAt: 0, endsAt: null }),
      ],
      [
        "endsAt が Infinity 相当（JSON では null）",
        '{"eventId":"' + EVENT.id + '","startedAt":0,"endsAt":1e999}',
      ],
      ["eventId が無い", JSON.stringify({ startedAt: 0, endsAt: 9_999 })],
    ];
    for (const [label, raw] of cases) {
      expect(parseStreamEventRound(raw, now), label).toBeNull();
    }
  });

  it("⚠ 例外（localStorage が使えない）でも「開催していない」へ倒れる", () => {
    const original = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("denied");
      },
    });
    try {
      expect(loadStreamEventRound(0)).toBeNull();
      expect(loadStreamEventSelected()).toBeNull();
      // ⚠ 書き込み側も例外を投げない（開催が始まらないだけ＝安全側）。
      expect(() => saveStreamEventRound({ eventId: EVENT.id, startedAt: 0, endsAt: 1 })).not.toThrow();
      expect(() => saveStreamEventSelected(EVENT.id)).not.toThrow();
      expect(() => clearStreamEventRound()).not.toThrow();
    } finally {
      if (original) Object.defineProperty(window, "localStorage", original);
    }
  });

  // --- 保存・読み出し ---------------------------------------------------------------------------

  it("開催を保存して読み戻せる／消すと「開催していない」になる", () => {
    const round = startStreamEventRound(EVENT, 10_000);
    expect(round).toEqual({
      eventId: EVENT.id,
      startedAt: 10_000,
      endsAt: 10_000 + EVENT.defaultDurationMs,
    });
    saveStreamEventRound(round);
    expect(loadStreamEventRound(10_001)).toEqual(round);
    clearStreamEventRound();
    expect(loadStreamEventRound(10_001)).toBeNull();
    expect(localStorage.getItem(STREAM_EVENT_ROUND_KEY)).toBeNull();
  });

  it("適用中のイベントは id だけを保存する／未知 id は `null` へ倒す", () => {
    saveStreamEventSelected(EVENT.id);
    expect(localStorage.getItem(STREAM_EVENT_SELECTED_KEY)).toBe(EVENT.id);
    expect(loadStreamEventSelected()).toBe(EVENT.id);
    // ⚠ アプリ更新でレジストリから消えた id を掴んだままにしない。
    localStorage.setItem(STREAM_EVENT_SELECTED_KEY, "no-such-event");
    expect(loadStreamEventSelected()).toBeNull();
  });

  it("⚠⚠ 適用は開催キーを書かない（判断 6＝「適用」と「開始」は別）", () => {
    saveStreamEventSelected(EVENT.id);
    expect(localStorage.getItem(STREAM_EVENT_ROUND_KEY)).toBeNull();
  });

  // --- 時間の表示 -------------------------------------------------------------------------------

  it("残り時間は負にならない／同じ開催かを比べられる", () => {
    const round = { eventId: EVENT.id, startedAt: 0, endsAt: 60_000 };
    expect(streamEventRemainingMs(round, 0)).toBe(60_000);
    expect(streamEventRemainingMs(round, 59_000)).toBe(1_000);
    expect(streamEventRemainingMs(round, 99_999)).toBe(0);

    expect(isSameStreamEventRound(round, { ...round })).toBe(true);
    expect(isSameStreamEventRound(round, { ...round, startedAt: 1 })).toBe(false);
    expect(isSameStreamEventRound(null, null)).toBe(true);
    expect(isSameStreamEventRound(round, null)).toBe(false);
  });

  it("⚠ main 窓の残り表示は「分」まで（秒を出さない＝毎秒再描画しない・判断 10）", () => {
    const round = { eventId: EVENT.id, startedAt: 0, endsAt: 300_000 };
    expect(streamEventRemainingLabel(round, 0)).toBe("残り 5 分");
    // 4 分 1 秒残り → 切り上げて 5 分（「あと 5 分以内」の意味）。
    expect(streamEventRemainingLabel(round, 59_000)).toBe("残り 5 分");
    expect(streamEventRemainingLabel(round, 240_001)).toBe("残り 1 分");
    expect(streamEventRemainingLabel(round, 300_000)).toBe("まもなく終了");
  });

  it("⚠ 配信画面の残り表示は `分:秒`（0 未満は 0:00）", () => {
    expect(formatStreamEventClock(300_000)).toBe("5:00");
    expect(formatStreamEventClock(61_500)).toBe("1:01");
    expect(formatStreamEventClock(9_000)).toBe("0:09");
    expect(formatStreamEventClock(0)).toBe("0:00");
    expect(formatStreamEventClock(-1)).toBe("0:00");
  });
});
