import { describe, it, expect } from "vitest";
import {
  findStreamEvent,
  isStreamEventId,
  STREAM_EVENT_REGISTRY,
} from "./streamEventRegistry";

/**
 * 061l: 配信イベントの静的レジストリの仕様テスト。
 *
 * ⚠ ここで固定するのは**同梱データの性質**だけ（見た目の文言は固定しない）:
 * - ⚠⚠ **外部 URL を持たない**（§1・判断 3。サムネイルは同一オリジンの同梱物だけ）
 * - **id は一意で、絵文字と本文が揃っている**（一覧・詳細が空欄にならない）
 * - **未知 id は `null` / `false`**（＝ localStorage 由来の値を安全側へ倒せる）
 */
describe("061l: streamEventRegistry", () => {
  it("⚠ 061l: 同梱イベントは見本 1 本だけ（判断 4）", () => {
    expect(STREAM_EVENT_REGISTRY).toHaveLength(1);
  });

  it("⚠⚠ 外部 URL を 1 つも持たない（§1・判断 3）", () => {
    for (const event of STREAM_EVENT_REGISTRY) {
      // サムネイルは同一オリジンの同梱物（`/stream-events/...`）だけ。
      if (event.thumbnail !== undefined) {
        expect(event.thumbnail.startsWith("/")).toBe(true);
      }
      // レジストリ全体を JSON にして見ても、外部スキームは 1 つも現れない。
      expect(JSON.stringify(event)).not.toMatch(/https?:\/\//);
    }
  });

  it("id は一意で、表示に要る値がすべて埋まっている", () => {
    const ids = STREAM_EVENT_REGISTRY.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const event of STREAM_EVENT_REGISTRY) {
      expect(event.id).toMatch(/^[a-z0-9-]+$/);
      expect(event.icon.length).toBeGreaterThan(0);
      expect(event.title.length).toBeGreaterThan(0);
      expect(event.summary.length).toBeGreaterThan(0);
      expect(event.description.length).toBeGreaterThan(0);
      expect(event.howTo.length).toBeGreaterThan(0);
      // 開催の長さは有限の正数（`endsAt` の計算に直接入る）。
      expect(Number.isFinite(event.defaultDurationMs)).toBe(true);
      expect(event.defaultDurationMs).toBeGreaterThan(0);
    }
  });

  it("⚠ 未知 id は `null` / `false`（localStorage 由来の値を安全側へ倒せる）", () => {
    expect(findStreamEvent("no-such-event")).toBeNull();
    expect(isStreamEventId("no-such-event")).toBe(false);
    // ⚠ プロトタイプ汚染系の文字列でも真にならない（`some` による突き合わせ）。
    expect(isStreamEventId("__proto__")).toBe(false);
    expect(isStreamEventId("constructor")).toBe(false);
  });

  it("既知 id は引ける", () => {
    const first = STREAM_EVENT_REGISTRY[0];
    expect(findStreamEvent(first.id)).toBe(first);
    expect(isStreamEventId(first.id)).toBe(true);
  });
});
