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
 *
 * ⚠⚠ **061p で同梱イベントは 0 本になった**（見本「みんなでコメントカウント」を削除）。
 * ⇒ 上の 2 つのループ検査は**いま空回り**するが、**次タスクで 1 本足した瞬間に効き始める**ので
 * 残してある（＝新しいイベントを足す人に対する仕様書として機能する）。
 * ⚠ **`STREAM_EVENT_REGISTRY[0]` を使う書き方をここでもよそでも作らないこと**——
 * 0 本になった瞬間に `undefined` を掴んで落ちる（061p でその形の検査を全部潰した）。
 */
describe("061l: streamEventRegistry", () => {
  it("⚠⚠ 061p: 同梱イベントは 0 本（見本を削除した・器だけ残す）", () => {
    expect(STREAM_EVENT_REGISTRY).toHaveLength(0);
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

  it("⚠⚠ 061p: 同梱イベントが 0 本なので、どの id も引けない（開催状態を作れない）", () => {
    // ⚠⚠ **これが「イベントは配信画面に 1 ピクセルも出ない」の根拠**である——
    //   `parseStreamEventRound` は `isStreamEventId` で弾くので、localStorage に
    //   細工した開催キーを置いても**必ず `null` へ倒れる**（`streamEventRound.test.ts` が固定）。
    // ⚠ **次タスクでイベントを 1 本足したら、この検査は「既知 id は引ける」へ書き換えること**
    //   （`git show` で 061l 時点の形が取れる）。
    for (const id of ["comment-count", "tamaire", ""]) {
      expect(findStreamEvent(id)).toBeNull();
      expect(isStreamEventId(id)).toBe(false);
    }
  });
});
