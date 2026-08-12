import { describe, it, expect, vi, beforeEach } from "vitest";
import type { EffectTemplateMedia } from "../../features/obs-effects/bindings/EffectTemplateMedia";

/**
 * 061d-2: メディア先読みキャッシュ（20MiB ＋ LRU）の仕様テスト。
 *
 * ⚠⚠ **上限は既定 20MiB だが、テストでは小さい上限を渡す。** 20MiB を超える base64 文字列を
 * 4 本作るのは非現実的（テストが数百 MB を確保する）で、そのぶん**追い出し順を固定できないまま
 * 出荷する**ことになる。ファクトリが上限を引数で受ける形にしてあるのはこのためである
 * （⚠ **本番の呼び出しは既定値のまま**＝`EffectOverlayApp` は引数を渡さない）。
 *
 * ⚠ **キャッシュに入るのは `safeEffectMedia` を通った値だけ**であることも固定する
 * （＝生の IPC 戻り値がキャッシュにも state にも載らない）。
 */

const mocks = vi.hoisted(() => ({
  getEffectTemplateMedia: vi.fn(),
}));

vi.mock("../../features/obs-effects/effectTemplateApi", () => ({
  getEffectTemplateMedia: mocks.getEffectTemplateMedia,
}));

const { createEffectMediaCache, EFFECT_MEDIA_CACHE_MAX_CHARS } = await import(
  "./effectMediaCache"
);

/** `n` 文字ぶんの base64 本体を持つ PNG の data URI。 */
const png = (n: number): EffectTemplateMedia => ({
  media: `data:image/png;base64,${"A".repeat(n)}`,
  sound: null,
});

describe("effectMediaCache", () => {
  beforeEach(() => {
    mocks.getEffectTemplateMedia.mockReset();
  });

  it("既定の上限は 20MiB（④の決定）", () => {
    expect(EFFECT_MEDIA_CACHE_MAX_CHARS).toBe(20 * 1024 * 1024);
  });

  it("先読みしたメディアを取り出せる", async () => {
    mocks.getEffectTemplateMedia.mockResolvedValue(png(8));
    const cache = createEffectMediaCache();
    await cache.prime("a");
    expect(cache.get("a")?.media).toBe(png(8).media);
  });

  it("⚠⚠ `safeEffectMedia` を通らない値はキャッシュに入らない（描画シンクの最終防波堤）", async () => {
    mocks.getEffectTemplateMedia.mockResolvedValue({
      media: "javascript:alert(1)",
      sound: null,
    });
    const cache = createEffectMediaCache();
    await cache.prime("a");
    expect(cache.get("a")).toBeUndefined();
  });

  it("⚠ 取得に失敗した id は再取得しない（投げ銭のたびに 6.7MB の IPC が走らない）", async () => {
    mocks.getEffectTemplateMedia.mockRejectedValue(new Error("gone"));
    const cache = createEffectMediaCache();
    await cache.prime("a");
    await cache.prime("a");
    await cache.prime("a");
    expect(mocks.getEffectTemplateMedia).toHaveBeenCalledTimes(1);
  });

  it("⚠ 失敗の記録は clearFailures で捨てる（割り当てを触ったら再挑戦できる）", async () => {
    mocks.getEffectTemplateMedia.mockRejectedValueOnce(new Error("gone"));
    const cache = createEffectMediaCache();
    await cache.prime("a");
    mocks.getEffectTemplateMedia.mockResolvedValue(png(8));
    cache.clearFailures();
    await cache.prime("a");
    expect(cache.get("a")).toBeDefined();
  });

  it("⚠ 同じ id の同時取得は 1 本に畳む", async () => {
    mocks.getEffectTemplateMedia.mockResolvedValue(png(8));
    const cache = createEffectMediaCache();
    await Promise.all([cache.prime("a"), cache.prime("a"), cache.prime("a")]);
    expect(mocks.getEffectTemplateMedia).toHaveBeenCalledTimes(1);
  });

  it("⚠ 既に載っている id は取り直さない", async () => {
    mocks.getEffectTemplateMedia.mockResolvedValue(png(8));
    const cache = createEffectMediaCache();
    await cache.prime("a");
    await cache.prime("a");
    expect(mocks.getEffectTemplateMedia).toHaveBeenCalledTimes(1);
  });

  it("⚠⚠ 上限を超えたら**古い順に**追い出す（LRU）", async () => {
    // 1 件あたり "data:image/png;base64," (22 文字) + 本体 78 文字 = 100 文字。上限 250 で 2 件まで。
    const cache = createEffectMediaCache(250);
    for (const id of ["a", "b", "c"]) {
      mocks.getEffectTemplateMedia.mockResolvedValueOnce(png(78));
      await cache.prime(id);
    }
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBeDefined();
    expect(cache.get("c")).toBeDefined();
  });

  it("⚠⚠ 使ったものは残る（`get` が LRU の末尾へ動かす＝追い出し順が「古い順」であることの担保）", async () => {
    const cache = createEffectMediaCache(250);
    for (const id of ["a", "b"]) {
      mocks.getEffectTemplateMedia.mockResolvedValueOnce(png(78));
      await cache.prime(id);
    }
    // "a" を使う＝ "b" のほうが古くなる。
    expect(cache.get("a")).toBeDefined();
    mocks.getEffectTemplateMedia.mockResolvedValueOnce(png(78));
    await cache.prime("c");
    // ⚠ 追い出し方向を反転する変異は、この 2 行がレッドにする。
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBeDefined();
  });

  it("⚠ 音源の長さも重さに数える（メディアだけで測ると上限を突き抜ける）", async () => {
    const cache = createEffectMediaCache(250);
    mocks.getEffectTemplateMedia.mockResolvedValueOnce({
      media: `data:image/png;base64,${"A".repeat(78)}`,
      sound: `data:audio/wav;base64,${"A".repeat(200)}`,
    });
    await cache.prime("big");
    mocks.getEffectTemplateMedia.mockResolvedValueOnce(png(78));
    await cache.prime("small");
    expect(cache.get("big")).toBeUndefined();
    expect(cache.get("small")).toBeDefined();
  });

  it("⚠ 割り当てから外れた id は retain で捨てる（LRU 任せにしない）", async () => {
    mocks.getEffectTemplateMedia.mockResolvedValue(png(8));
    const cache = createEffectMediaCache();
    await cache.prime("a");
    await cache.prime("b");
    cache.retain(["b"]);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBeDefined();
  });

  it("⚠ markFailed は載っている値も捨てる（デコードできないものを持ち続けない）", async () => {
    mocks.getEffectTemplateMedia.mockResolvedValue(png(8));
    const cache = createEffectMediaCache();
    await cache.prime("a");
    cache.markFailed("a");
    expect(cache.get("a")).toBeUndefined();
    await cache.prime("a");
    // ⚠ 失敗として記録されているので取り直さない。
    expect(mocks.getEffectTemplateMedia).toHaveBeenCalledTimes(1);
  });
});
