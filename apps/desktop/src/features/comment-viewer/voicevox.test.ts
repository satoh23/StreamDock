import { describe, it, expect, vi, afterEach } from "vitest";
import { playWav, synthesize } from "./voicevox";

/**
 * 050: `playWav` の**打ち切り契約**の仕様テスト。
 *
 * 背景: 再生中に AudioContext が suspended になると `src.onended` が発火せず、`playWav` の Promise が
 * 永久 pending になる（＝呼び出し側の `playing` が true 固定で、以後の読み上げが全部無音になる）。
 * これを塞ぐために `signal` を足したが、**打ち切り方を間違えると音が重なる**——`stop()` だけで
 * `disconnect()` しないと、後で `ctx.resume()` された瞬間にこの source が息を吹き返し、既に次の 1 件を
 * 再生している呼び出し側と同時に鳴る（直列＝音が重ならない、という中核設計が壊れる）。
 * その保証はここでしか見られないので、`voicevox.ts` に初めて単体テストを入れる。
 *
 * **通信も音声再生も一切行わない**（AudioContext は最小の偽物・`fetch` は必要な箇所だけ `vi.stubGlobal` で
 * 差し替える＝loopback 50021 へも出さない）。
 *
 * ⚠ **`synthesize` の `signal` が body 読み（`res.json()` / `res.arrayBuffer()`）まで効くこと**は、
 * ここでは固定していない。Fetch 仕様上 abort は body stream を error にするので効くが、それを確かめるには
 * `fetch` 自体をモックすることになり、**標準の挙動を自前のモックで再現して自前のモックを検証する**恒真式に
 * なるため。再修正トリガー＝実機で「タイムアウトしたのに `synthesize` が返ってこない」を観測したら、
 * そのときは実物の `fetch` を使う統合テストで確かめる（モックでは意味が無い）。
 * ⚠ 一方で「**2 回の fetch 両方に signal を渡していること**」は恒真式ではなく実装の契約なので、下の
 * 「synthesize の打ち切り配線」で固定する（レビュー Q-1）。
 */

/** `playWav` が触る 4 つ（connect/start/stop/disconnect）と `onended` だけを持つ偽の BufferSource。 */
class FakeBufferSource {
  buffer: unknown = null;
  onended: (() => void) | null = null;
  connected = 0;
  disconnected = 0;
  started = 0;
  stopped = 0;
  connect(): void {
    this.connected++;
  }
  disconnect(): void {
    this.disconnected++;
  }
  start(): void {
    this.started++;
  }
  stop(): void {
    this.stopped++;
  }
}

/** decodeAudioData と createBufferSource だけを持つ偽の AudioContext（実際の音は鳴らさない）。 */
const fakeAudio = (): { ctx: AudioContext; src: FakeBufferSource } => {
  const src = new FakeBufferSource();
  const ctx = {
    destination: {},
    decodeAudioData: async () => ({}),
    createBufferSource: () => src,
  } as unknown as AudioContext;
  return { ctx, src };
};

/** decodeAudioData の await を通して `src.start()` まで進める。 */
const tick = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

describe("playWav の打ち切り（050: 永久ハングを塞ぐ）", () => {
  it("打ち切ると stop と disconnect を呼んで解決する（あとで resume されても音が重ならない）", async () => {
    const { ctx, src } = fakeAudio();
    const controller = new AbortController();
    const done = playWav(ctx, new ArrayBuffer(8), controller.signal);
    await tick();
    expect(src.started).toBe(1);

    controller.abort();
    // suspended 中は onended が発火しないので、abort 自身が解決しないと永久 pending になる。
    await expect(done).resolves.toBeUndefined();
    expect(src.stopped).toBe(1);
    // stop だけでは resume 時に鳴り出す余地が残る。切り離しまでが打ち切りの契約。
    expect(src.disconnected).toBe(1);
  });

  it("打ち切り済みの signal を渡したら鳴らさずに終える", async () => {
    const { ctx, src } = fakeAudio();
    const controller = new AbortController();
    controller.abort(); // decodeAudioData 中に打ち切られた場合に相当。

    await expect(
      playWav(ctx, new ArrayBuffer(8), controller.signal),
    ).resolves.toBeUndefined();
    expect(src.started).toBe(0);
  });

  it("通常時は onended で解決し、stop を呼ばない（既存挙動の回帰）", async () => {
    const { ctx, src } = fakeAudio();
    const done = playWav(ctx, new ArrayBuffer(8));
    await tick();
    expect(src.connected).toBe(1);
    expect(src.started).toBe(1);

    src.onended?.();
    await expect(done).resolves.toBeUndefined();
    expect(src.stopped).toBe(0);
    expect(src.disconnected).toBe(0);
  });

  it("正常終了後は abort リスナが外れている（長時間配信でリスナが増え続けない）", async () => {
    // 1 件ごとに signal を張るので、`onended` で removeEventListener しないとリスナが溜まり続ける。
    // 直接は数えられないので「解除されていれば後から abort しても stop は呼ばれない」で観測する。
    const { ctx, src } = fakeAudio();
    const controller = new AbortController();
    const done = playWav(ctx, new ArrayBuffer(8), controller.signal);
    await tick();
    src.onended?.();
    await done;

    controller.abort();
    expect(src.stopped).toBe(0);
    expect(src.disconnected).toBe(0);
  });

  it("stop() が失敗しても disconnect() は実行する（音が重ならない保証を落とさない）", async () => {
    // 打ち切りの 2 つの後始末のうち、**音が重ならない保証は disconnect の側**にある
    // （stop だけでは後の `ctx.resume()` で source が息を吹き返す）。stop の失敗で
    // disconnect を巻き添えにすると、防ぎたかった「音が重なる」が復活する。
    const { ctx, src } = fakeAudio();
    src.stop = () => {
      throw new Error("closed な context で stop が失敗した");
    };
    const controller = new AbortController();
    const done = playWav(ctx, new ArrayBuffer(8), controller.signal);
    await tick();

    controller.abort();
    await expect(done).resolves.toBeUndefined();
    expect(src.disconnected).toBe(1);
  });

  it("打ち切り処理が途中で例外を投げても解決する（ハング防止がハングを作らない）", async () => {
    // 050 レビュー Q-1: このハンドラは abort イベントのディスパッチ中に走るので、投げた例外は
    // `abort()` の呼び出し側に伝わらず握り潰される＝ resolve に到達しないと永久 pending になり、
    // 呼び出し側の watchdog も clearInterval に到達できず 1 Hz で回り続ける（実測で再現済み）。
    const { ctx, src } = fakeAudio();
    src.disconnect = () => {
      throw new Error("closed な context でノード操作が失敗した");
    };
    const controller = new AbortController();
    const done = playWav(ctx, new ArrayBuffer(8), controller.signal);
    await tick();

    controller.abort();
    await expect(done).resolves.toBeUndefined();
    expect(src.stopped).toBe(1); // 例外は disconnect より前の stop を巻き戻さない
  });

  it("decodeAudioData には複製を渡す（呼び出し側の ArrayBuffer を破壊しない）", async () => {
    // decodeAudioData が入力 ArrayBuffer を破壊的に消費する実装があるため `wav.slice(0)` で渡す、
    // というのが実装の意図。元を渡すようになると、再試行や別用途での再利用が黙って壊れる。
    const src = new FakeBufferSource();
    const decoded: ArrayBuffer[] = [];
    const ctx = {
      destination: {},
      decodeAudioData: async (buf: ArrayBuffer) => {
        decoded.push(buf);
        return {};
      },
      createBufferSource: () => src,
    } as unknown as AudioContext;
    const wav = new ArrayBuffer(8);

    const done = playWav(ctx, wav);
    await tick();
    src.onended?.();
    await done;

    expect(decoded).toHaveLength(1);
    expect(decoded[0]).not.toBe(wav);
    expect(decoded[0].byteLength).toBe(wav.byteLength);
  });
});

/**
 * docs/security.md §9 ＋ 050「このタスクでやらないこと」の仕様テスト。
 *
 * 根拠となる条文: 「`console.error` / `console.debug` へ **URL・リクエスト内容・読み上げテキストを
 * 出さないこと**（現状 `voicevox.ts` はステータス番号だけを載せている＝**この状態を維持する**）」。
 *
 * ここが特別に重いのは、合成 URL が `/audio_query?text=<encodeURIComponent(読み上げ全文)>` で、
 * 049 追補以降は**課金イベントの投稿者名まで含む**ため。`voicevox.ts` に診断ログを 1 行足すだけで、
 * 第三者の表示名とコメント本文がそのままコンソールに出る。**grep での確認は差分レビューでしか効かない**ので、
 * 実行時の不変条件として固定する。
 */
describe("voicevox.ts はログを持たない（§9）", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const spyConsole = () =>
    (["log", "debug", "info", "warn", "error"] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => {}),
    );
  /** 投げられた例外だけを取り出す（`.catch()` だと成功値と型が混ざるため）。 */
  const caught = async (run: () => Promise<unknown>): Promise<Error | null> => {
    try {
      await run();
      return null;
    } catch (e) {
      return e as Error;
    }
  };

  it("playWav は正常再生でも打ち切りでも console を呼ばない", async () => {
    const spies = spyConsole();
    const { ctx, src } = fakeAudio();

    const normal = playWav(ctx, new ArrayBuffer(8));
    await tick();
    src.onended?.();
    await normal;

    const controller = new AbortController();
    const aborted = playWav(ctx, new ArrayBuffer(8), controller.signal);
    await tick();
    controller.abort();
    await aborted;

    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it("synthesize は失敗しても console を呼ばず、Error には status しか載せない", async () => {
    const spies = spyConsole();
    // 課金イベントの読み上げ文言を模す（投稿者名を含む＝漏れたら個人情報の流出になる）。
    const speech = "Aliceさんがメンバーシップを6ヶ月継続しました";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500 })),
    );

    const err = await caught(() => synthesize(speech, 3));

    expect(err).toBeInstanceOf(Error);
    expect(err?.message).toContain("500"); // 理由（status）は出してよい
    expect(err?.message).not.toContain(speech); // 読み上げテキストは出さない
    expect(err?.message).not.toContain("127.0.0.1"); // 宛先 URL も出さない
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it("synthesis 側（2 回目の fetch）が失敗したときも status だけ", async () => {
    const spies = spyConsole();
    const speech = "Bobさんが1000円スパチャしました";
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        call += 1;
        // 1 回目（audio_query）は成功させ、2 回目（synthesis）で落とす。
        return call === 1
          ? { ok: true, json: async () => ({ speedScale: 1 }) }
          : { ok: false, status: 503 };
      }),
    );

    const err = await caught(() => synthesize(speech, 3));

    expect(err?.message).toContain("503");
    expect(err?.message).not.toContain(speech);
    expect(err?.message).not.toContain("127.0.0.1");
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});

/**
 * 050 レビュー（Q-1）: `synthesize` が **2 回の fetch の両方に `signal` を渡している**ことの固定。
 *
 * **なぜこれが要るか**: レビューで `POST /synthesis` 側の `signal` を落とすミューテーションを試したところ、
 * **458 テストすべてが緑のまま通った**。しかし実挙動は 050 の目的そのものが壊れる——合成が詰まるとしたら
 * 推論を回す `/synthesis` の方が本命で、そこから signal が落ちると `setTimeout` が abort しても
 * **fetch は中断されず `synthesize` が返らない＝ `playing` が true 固定の永久ハングが復活**する。
 * しかも `/audio_query` 段ではタイムアウトが効くため「たまに固まる」に化けて原因に辿り着けない。
 *
 * 上の describe の「body 読みまで効くことは恒真式なので固定しない」とは別物で、**どの fetch に
 * 何を渡すかは実装が決めていること**（＝壊せる）。再修正トリガー＝`synthesize` に fetch を増やしたとき。
 */
describe("synthesize の打ち切り配線（050: 2 回の fetch 両方に signal が届く）", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("audio_query と synthesis の両方へ、呼び出し側の signal をそのまま渡す", async () => {
    const inits: (RequestInit | undefined)[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        inits.push(init);
        return inits.length === 1
          ? { ok: true, json: async () => ({ speedScale: 1 }) }
          : { ok: true, arrayBuffer: async () => new ArrayBuffer(4) };
      }),
    );
    const controller = new AbortController();

    await synthesize("よみあげテキスト", 3, controller.signal);

    expect(inits).toHaveLength(2);
    // 同一の signal であること（新しい controller を作り直す実装だと 1 件目の予算を持ち越せない）。
    expect(inits[0]?.signal).toBe(controller.signal);
    expect(inits[1]?.signal).toBe(controller.signal);
  });

  it("signal 未指定でも従来どおり動く（省略可能であることの回帰）", async () => {
    const inits: (RequestInit | undefined)[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        inits.push(init);
        return inits.length === 1
          ? { ok: true, json: async () => ({ speedScale: 1 }) }
          : { ok: true, arrayBuffer: async () => new ArrayBuffer(4) };
      }),
    );

    await synthesize("よみあげテキスト", 3);

    expect(inits).toHaveLength(2);
    expect(inits[0]?.signal).toBeUndefined();
    expect(inits[1]?.signal).toBeUndefined();
  });
});
