import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * ⚠⚠⚠ **063c 段 2-a: 当選結果の伝達路（コメビュ窓 → ステージ窓）の仕様テスト。**
 *
 * あるべき挙動:
 * 1. ⚠⚠ **宛先はステージ窓のラベル 1 つだけ**（全窓へ撒かない＝コメント窓・固定窓は受け取らない）
 * 2. ⚠⚠⚠ **本線を止めない**——`emitTo` が失敗しても**例外が呼び出し側へ漏れない**
 *    （漏れると `requestObsSourceFire` が実行されず、**OBS まで鳴らなくなる**）
 * 3. ⚠ **形の違うペイロードは捨てる**（透過窓が throw で真っ白になり OBS に映るのを防ぐ）
 * 4. ⚠⚠ **未知の kind を組み込みへ倒さない**（061h が消した「壊れているのに動いて見える」を戻さない）
 *
 * ⚠ Tauri のイベント API はモックする＝テストは IPC も OS 操作も外部通信も一切行わない（§1）。
 */
vi.mock("@tauri-apps/api/event", () => ({
  emitTo: vi.fn(),
  listen: vi.fn(),
}));

import { emitTo, listen } from "@tauri-apps/api/event";
import { STAGE_OVERLAY_WINDOW_LABEL } from "./effectAssignments";
import {
  emitGachaStageResult,
  GACHA_STAGE_RESULT_EVENT,
  listenGachaStageResult,
  type GachaStageResult,
} from "./gachaStageEvent";

const mockEmitTo = vi.mocked(emitTo);
const mockListen = vi.mocked(listen);

const RESULT: GachaStageResult = {
  prizeLabel: "大当たり",
  output: { kind: "obs-source", sourceName: "きらきら演出" },
  viewerName: "視聴者A",
  rare: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockEmitTo.mockResolvedValue(undefined);
});

describe("063c 段 2-a: 当選結果を送る（emitGachaStageResult）", () => {
  it("⚠⚠ ステージ窓のラベル宛に、決めたイベント名で 1 回だけ送る", () => {
    emitGachaStageResult(RESULT);
    expect(mockEmitTo).toHaveBeenCalledTimes(1);
    expect(mockEmitTo).toHaveBeenCalledWith(
      STAGE_OVERLAY_WINDOW_LABEL,
      GACHA_STAGE_RESULT_EVENT,
      RESULT,
    );
  });

  /**
   * ⚠⚠⚠ **全窓へ撒く `emit` を使っていないことを固定する。**
   * `emit` に変える変異は「演出は出るがコメント窓・固定窓も受け取る」という
   * **画面からは見えない**壊れ方をする（§9・宛先を絞る意味が消える）。
   */
  it("⚠⚠⚠ 宛先はステージ窓だけ（第 1 引数が窓ラベルであること）", () => {
    emitGachaStageResult(RESULT);
    expect(mockEmitTo.mock.calls[0][0]).toBe("stage-overlay");
  });

  it("⚠ 送信が失敗しても例外を投げない（本線＝OBS を止めない）", () => {
    mockEmitTo.mockRejectedValue(new Error("no such window"));
    expect(() => emitGachaStageResult(RESULT)).not.toThrow();
  });

  /**
   * ⚠⚠⚠ **`.catch()` を外す変異を殺す唯一のケース。**
   *
   * ⚠ 上の「例外を投げない」だけでは**殺せない**（実測で生存した）——`emitTo` は非同期なので、
   * `.catch()` が無くても**同期例外は出ない**からである。
   * ⚠⚠ **`process.on("unhandledRejection")` で見る案も試したが、vitest 環境では発火しなかった**
   * （実測）。⇒ **失敗の受け皿が付いていること自体**を直接見る。
   *
   * ⚠ **意図的にホワイトボックスである**（`.catch` を呼んでいることに依存する）。
   * `.then(undefined, fn)` へ書き換えるとこのケースは落ちるが、
   * **落ちたら「受け皿の付け方を変えた」と読んでケースを直すこと**（外さないこと）。
   * 何を守っているのかは実装側の JSDoc（§9・拒否理由にペイロードが載りうる）が正。
   */
  it("⚠⚠⚠ 送信の Promise には必ず失敗の受け皿を付ける（未処理の rejection を作らない）", () => {
    const promise = Promise.resolve(undefined);
    const catchSpy = vi.spyOn(promise, "catch");
    mockEmitTo.mockReturnValue(promise);
    emitGachaStageResult(RESULT);
    expect(catchSpy).toHaveBeenCalledTimes(1);
  });

  /**
   * ⚠⚠⚠ **063c 段 3 で §9 の線が動いたので、このケースも書き換えた。**
   * 段 2-a までは「**第三者由来のフィールドが増えていない**」を見ていたが、
   * いまは **`viewerName`（＝引いた視聴者の表示名）が意図して 1 本だけ載っている**。
   * ⇒ ⚠⚠ **見るものを「ゼロであること」から「この 4 本だけであること」へ変えた。**
   * ⚠ **`text` / `viewerId` / `monetary` などが混ざった瞬間にレッドになる網**であることは変わらない。
   */
  it("⚠⚠⚠ 送るのはこの 4 フィールドだけ（本文・視聴者 id・金額は載らない）", () => {
    emitGachaStageResult(RESULT);
    const payload = mockEmitTo.mock.calls[0][2];
    expect(Object.keys(payload as object).sort()).toEqual([
      "output",
      "prizeLabel",
      "rare",
      "viewerName",
    ]);
  });
});

describe("063c 段 2-a: 当選結果を受ける（listenGachaStageResult）", () => {
  /** モックした `listen` に届いたハンドラへ、任意のペイロードを流し込む。 */
  const deliver = async (payload: unknown): Promise<GachaStageResult[]> => {
    const received: GachaStageResult[] = [];
    // ⚠ `let handler = null` だと TS が代入を追えず `never` に狭めるので、明示的に型を置く。
    const captured: { handler: ((e: { payload: unknown }) => void) | null } = {
      handler: null,
    };
    mockListen.mockImplementation((_event, cb) => {
      captured.handler = cb as (e: { payload: unknown }) => void;
      return Promise.resolve(() => {});
    });
    await listenGachaStageResult((r) => received.push(r));
    captured.handler?.({ payload });
    return received;
  };

  it("⚠ 決めたイベント名を購読する", async () => {
    await deliver(RESULT);
    expect(mockListen.mock.calls[0][0]).toBe(GACHA_STAGE_RESULT_EVENT);
  });

  it("正しいペイロードはそのまま通る（組み込み・OBS ソースの両方）", async () => {
    expect(await deliver(RESULT)).toEqual([RESULT]);
    expect(
      await deliver({
        prizeLabel: "当たり",
        output: { kind: "builtin" },
        viewerName: "視聴者A",
        rare: true,
      }),
    ).toEqual([
      {
        prizeLabel: "当たり",
        output: { kind: "builtin" },
        viewerName: "視聴者A",
        rare: true,
      },
    ]);
  });

  /**
   * ⚠⚠⚠ **063c 段 3: 表示名とレアが壊れていても、当選そのものは捨てない。**
   * ⚠ 捨てる（`null` を返す）実装にすると、**名前が空の視聴者が引いたときに演出が出ない**
   * ＝ **当たったのに何も起きない**になる。⇒ **付加情報だけを落とす。**
   */
  it.each([
    ["viewerName が無い", {}, null],
    ["viewerName が空文字", { viewerName: "" }, null],
    ["viewerName が非文字列", { viewerName: 42 }, null],
    ["viewerName が null", { viewerName: null }, null],
    ["viewerName が文字列", { viewerName: "視聴者A" }, "視聴者A"],
  ])(
    "⚠⚠ 表示名が壊れていても当選は出す: %s",
    async (_label, over, expected) => {
      const out = await deliver({
        prizeLabel: "当たり",
        output: { kind: "builtin" },
        ...over,
      });
      expect(out).toHaveLength(1);
      expect(out[0].viewerName).toBe(expected);
    },
  );

  /**
   * ⚠⚠⚠ **`rare` は `=== true` でしか立たない。**
   * ⚠ `Boolean(rare)` に緩めると `"false"` や `1` がレア扱いになり、
   * **普通の景品に「レア！」が出る**＝ 段 2-b で「大当たり！」を却下した理由と同じ嘘になる。
   */
  it.each([
    ["rare が無い", {}, false],
    ["rare が true", { rare: true }, true],
    ["rare が false", { rare: false }, false],
    ["rare が文字列の true", { rare: "true" }, false],
    ["rare が 1", { rare: 1 }, false],
  ])("⚠⚠⚠ レアは真の真偽値だけ受ける: %s", async (_label, over, expected) => {
    const out = await deliver({
      prizeLabel: "当たり",
      output: { kind: "builtin" },
      ...over,
    });
    expect(out[0].rare).toBe(expected);
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["文字列", "大当たり"],
    ["prizeLabel が無い", { output: { kind: "builtin" } }],
    ["prizeLabel が空", { prizeLabel: "", output: { kind: "builtin" } }],
    ["prizeLabel が非文字列", { prizeLabel: 42, output: { kind: "builtin" } }],
    ["output が無い", { prizeLabel: "A" }],
    ["output が非オブジェクト", { prizeLabel: "A", output: "builtin" }],
    [
      "sourceName が空",
      { prizeLabel: "A", output: { kind: "obs-source", sourceName: "" } },
    ],
  ])("⚠ 形が違うペイロードは捨てる: %s", async (_label, payload) => {
    expect(await deliver(payload)).toEqual([]);
  });

  it("⚠⚠⚠ 未知の kind は捨てる（組み込みへ倒さない）", async () => {
    expect(
      await deliver({ prizeLabel: "A", output: { kind: "webhook" } }),
    ).toEqual([]);
  });
});
