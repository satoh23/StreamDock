import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { capForSpeech, createTtsQueue, sanitizeForSpeech } from "./ttsQueue";
import { playWav, synthesize } from "./voicevox";
import type { CommentViewDto } from "./types";

/**
 * 048: 読み上げテキストの文字数上限（「以下略」で打ち切り）の仕様テスト。
 * 049: ＋ キュー本体（`createTtsQueue` の `enqueue`）の仕様テスト。
 *
 * あるべき挙動（docs/tasks/048-tts-reading-length-cap.md 完了条件）:
 * - 上限を超えたコメントの**読み上げテキストだけ**を打ち切り、末尾へ「、以下略」を足す（表示は全文のまま）。
 * - 数える単位は**コードポイント**。UTF-16 コードユニットで割ると 𠮷 等が孤立サロゲート「�」になる。
 * - 上限が不正（非有限・1 未満）なら切り詰めない（既定値・クランプのポリシーは `ttsPrefs.ts` の責務）。
 *
 * あるべき挙動（docs/tasks/049-monetary-event-speech.md 完了条件）:
 * - `getSpeechText` を注入すると `text` が空のコメントでも読み上げキューに載る（課金イベントの無音を解消）。
 * - **未注入なら `comment.text`＝従来と完全に同じ**（後方互換）。
 * - 入力の出どころに関わらず ②sanitize → ③読み替え → ④切り詰め → ⑤空判定 の 5 段は同一に通る。
 *
 * ⚠ 打ち切り表記「、以下略」は**意図的にリテラルで書いている**（実装から import すると恒真式になり仕様を固定できない）。
 * 実機判定で `SPEECH_ELLIPSIS` を差し替える場合は、このファイルの 5 箇所も同時に直すこと。
 */

/**
 * 049: キュー本体を動かすため、合成 HTTP（`synthesize`）と音声再生（`playWav`）を差し替える。
 * **通信も音声再生も一切行わない**（loopback 50021 へも出さない）。`vi.mock` はファイル先頭へ巻き上げられるため
 * ファクトリは外部変数を参照できない＝ここでインラインに `vi.fn` を作る。
 */
vi.mock("./voicevox", () => ({
  synthesize: vi.fn(async () => new ArrayBuffer(0)),
  playWav: vi.fn(async () => {}),
  ZUNDAMON_NORMAL_SPEAKER_ID: 3,
}));

/** 孤立サロゲート（ペアの片割れだけが残った状態）を含むか。含むと画面/読みが「�」に化ける。 */
const hasLoneSurrogate = (s: string): boolean =>
  [...s].some((cp) => {
    const code = cp.codePointAt(0) ?? 0;
    return code >= 0xd800 && code <= 0xdfff;
  });

describe("capForSpeech の境界", () => {
  it("上限ちょうどは素通しする（接尾辞を足さない）", () => {
    const text = "あ".repeat(60);
    expect(capForSpeech(text, 60)).toBe(text);
  });

  it("上限を 1 文字超えたら打ち切って「、以下略」を足す", () => {
    const text = "あ".repeat(61);
    expect(capForSpeech(text, 60)).toBe("あ".repeat(60) + "、以下略");
  });

  it("大幅に超える長文でも本文は上限ちょうどで、続きは読まない", () => {
    // dev-mock の長文枠（290 文字）相当。既定 60 で打ち切ると約 10〜13 秒に収まり、
    // 読み上げ中に届いた後続コメントが MAX_BACKLOG(20) 超過で捨てられなくなる、というのが本タスクの目的。
    const text = "長".repeat(290);
    const capped = capForSpeech(text, 60);
    expect([...capped]).toHaveLength(60 + "、以下略".length);
    expect(capped.endsWith("、以下略")).toBe(true);
  });

  it("空文字は空文字のまま（接尾辞を足さない＝空判定を通って読み上げをスキップできる）", () => {
    expect(capForSpeech("", 60)).toBe("");
  });
});

describe("capForSpeech の文字数の数え方", () => {
  it("サロゲートペアを割らない（孤立サロゲートを作らない）", () => {
    // 𠮷 は絵文字ではないので sanitizeForSpeech では消えず、コードユニット単位で切ると割れる。
    const text = "𠮷".repeat(10);
    const capped = capForSpeech(text, 5);
    expect(hasLoneSurrogate(capped)).toBe(false);
    expect(capped).toBe("𠮷".repeat(5) + "、以下略");
  });

  it("コードポイント数で数える（サロゲートペア 1 文字を 2 文字と数えない）", () => {
    // コードユニット単位なら length===6 で上限 5 を超えたと誤判定する。コードポイントでは 3 文字なので素通し。
    const text = "𠮷𩸽𡈽";
    expect(text.length).toBe(6);
    expect(capForSpeech(text, 5)).toBe(text);
  });

  // ※ 結合文字（濁点 U+3099 等）の書記素クラスタは**意図的に割り得る**仕様（capForSpeech の JSDoc 参照）。
  //   結合文字は基底文字の後ろにあるため、切断点で落ちるのは濁点側＝打ち切り位置の 1 文字が濁点を失って読まれる
  //   （`が`→`か`）。孤立サロゲートのような「�」化とは影響の桁が違うので、ここでは仕様として固定しない
  //   （固定すると Segmenter 導入時にテストごと書き換えになる）。
});

describe("capForSpeech の防御（上限値が不正なとき）", () => {
  // 0.5 は「1 未満なら切り詰めない」ガードの検証。通してしまうと slice の truncate で本文が 0 文字になり、
  // 「、以下略」だけを読む無意味な出力になる（製品経路はクランプ済み整数のみなので到達しないが、純関数の契約として固定する）。
  it.each([0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "上限 %p では切り詰めない",
    (max) => {
      const text = "あ".repeat(100);
      expect(capForSpeech(text, max)).toBe(text);
    },
  );
});

describe("sanitizeForSpeech（既存仕様の回帰）", () => {
  it("URL と絵文字を除去し、空白を畳み込む", () => {
    expect(sanitizeForSpeech("見て https://example.com/a  これ🎉")).toBe(
      "見て これ",
    );
  });

  it("非絵文字のサロゲートペアは残す（だから capForSpeech 側で割らない配慮が要る）", () => {
    expect(sanitizeForSpeech("𠮷野家")).toBe("𠮷野家");
  });
});

/**
 * 049: jsdom には `AudioContext` が無い（`createTtsQueue` が `new AudioContext()` を呼ぶ）ため最小の代役を置く。
 *
 * **`src/test/setup.ts` には置かない**: あちらは全テストファイルに効くので、他のテストが「本物の AudioContext が
 * 無い」ことに気付けなくなり、TTS 以外のコードが暗黙にこの偽物へ依存し得る。vitest はファイル単位で環境が
 * 分離されるので、必要なこのファイルの中だけで `vi.stubGlobal` する。
 *
 * 必要なのは `state` / `resume` / `close` の 3 つだけ。`decodeAudioData` / `createBufferSource` は `playWav` が
 * 使うが、その `playWav` をモックしているので**呼ばれない**。
 * ⚠ 初期 `state` は **"running" 必須**。`pump()` は running でない 1 件を読み上げずに return する（無音ハング防止の
 * ガード）ため、"suspended" のままだと `synthesize` が呼ばれず**意図と違う理由でアサートが落ちる**。
 */
class FakeAudioContext {
  /**
   * 050: 直近に生成されたインスタンス。`createTtsQueue` は AudioContext を内部で 1 つ作って外へ出さないため、
   * 「再生中に AudioContext が止まる」状況を作るにはここから掴むしかない。
   */
  static last: FakeAudioContext | null = null;
  state = "running";
  constructor() {
    FakeAudioContext.last = this;
  }
  async resume(): Promise<void> {
    this.state = "running";
  }
  async close(): Promise<void> {
    this.state = "closed";
  }
}

/** 必須フィールドを埋めた最小の DTO を作る（テストごとに差分だけ上書きする）。 */
const dto = (over: Partial<CommentViewDto>): CommentViewDto => ({
  id: "c1",
  source: "youtube",
  author: { id: "u1", name: "Alice" },
  text: "",
  publishedAt: "2026-07-31T00:00:00Z",
  eventType: "chat",
  ...over,
});

describe("createTtsQueue の enqueue（049: 読み上げ入力の差し替え）", () => {
  let queue: ReturnType<typeof createTtsQueue> | null = null;

  beforeEach(() => {
    vi.stubGlobal("AudioContext", FakeAudioContext);
  });
  afterEach(() => {
    queue?.dispose();
    queue = null;
    vi.unstubAllGlobals();
  });

  /** `synthesize` に渡された読み上げテキストの一覧。 */
  const spoken = (): string[] =>
    vi.mocked(synthesize).mock.calls.map((args) => args[0]);
  /** マイクロタスク＋タイマー 1 周分だけ進める。 */
  const flush = (): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, 0));

  /**
   * 049 レビュー（Q-10）: **アサート前に必ず `await flush()` する**。
   *
   * 現状の `enqueue` → `pump()` は `synthesize(text, speaker)` を**同期的に呼んでから**初めて await に
   * 入るので待たずとも通るが、それは `pump` の内部順序への依存でしかない。050 が `synthesize` の前に
   * `await`（タイムアウト用の AbortController 準備など）を挟むと、**実装は正しいのにここが落ちる**
   * ——しかも「読み上げが載らない」という**誤った意味**で落ちて原因調査を誤らせる。
   * 1 周待つコストはゼロに近いので、同期前提を仕様として固定しない。
   */
  it("getSpeechText 未注入なら comment.text を読む（後方互換）", async () => {
    queue = createTtsQueue();
    queue.enqueue(dto({ text: "こんにちは" }));
    await flush();
    expect(spoken()).toEqual(["こんにちは"]);
  });

  it("getSpeechText を注入すると text が空のコメントでも読み上げキューに載る", async () => {
    // 課金イベント（membership/gift/jewels）は text が空で、従来は ⑤ 空判定で捨てられ**完全に無音**だった。
    queue = createTtsQueue({
      getSpeechText: (c) =>
        c.eventType === "membership"
          ? `${c.author.name}さんがメンバーシップを6ヶ月継続しました`
          : c.text,
    });
    queue.enqueue(dto({ eventType: "membership", text: "", monthCount: 6 }));
    await flush();
    expect(spoken()).toEqual(["Aliceさんがメンバーシップを6ヶ月継続しました"]);
  });

  it("getSpeechText の戻り値も ② sanitize を通る（入力の出どころで処理を分けない）", async () => {
    queue = createTtsQueue({ getSpeechText: () => "見て https://example.com/a  これ🎉" });
    queue.enqueue(dto({ text: "元の本文" }));
    await flush();
    expect(spoken()).toEqual(["見て これ"]);
  });

  it("getSpeechText の戻り値が整形後に空なら読み上げない（⑤ 空判定の維持）", async () => {
    queue = createTtsQueue({ getSpeechText: () => "🎉 https://example.com" });
    queue.enqueue(dto({ text: "元の本文" }));
    await flush();
    expect(synthesize).not.toHaveBeenCalled();
  });

  // 048 レビューからの申し送り: `getMaxLength` は optional ＋ `?? Infinity` のため、本体（CommentViewerApp）の
  // 注入が将来消えても typecheck も他のテストも通ってしまい、**上限だけが黙って消える**。ここで固定する。
  // ※これで固定できるのは「注入したら効くこと」までで、**本体側の注入行の消失**は
  //   `CommentViewerApp.toolbar.test.tsx` の配線テスト側で見る（049 レビュー Q-2）。
  it("getMaxLength を注入した enqueue は実際に切り詰める（048 申し送り）", async () => {
    queue = createTtsQueue({ getMaxLength: () => 60 });
    queue.enqueue(dto({ text: "あ".repeat(61) }));
    await flush();
    expect(spoken()).toEqual(["あ".repeat(60) + "、以下略"]);
  });

  it("getSpeechText で長くなった文言も ④ 切り詰めに乗る（① と ④ が同じ経路）", async () => {
    queue = createTtsQueue({
      getSpeechText: () => "長".repeat(100),
      getMaxLength: () => 60,
    });
    queue.enqueue(dto({ text: "" }));
    await flush();
    expect(spoken()).toEqual(["長".repeat(60) + "、以下略"]);
  });

  it("同じ id は 2 回目を読み上げない（単一注入点の冪等化）", async () => {
    queue = createTtsQueue();
    queue.enqueue(dto({ id: "same", text: "1回目" }));
    await flush();
    queue.enqueue(dto({ id: "same", text: "2回目" }));
    await flush();
    expect(spoken()).toEqual(["1回目"]);
  });
});

/**
 * 049 フォローアップ: **課金イベントを読み上げから漏らさない**優先キューの仕様テスト。
 *
 * 背景（実機で発覚）: 読み上げは到着に**構造的に**追いつかない（60 文字＝10〜13 秒に対し、dev-mock は
 * 0.9〜1.8 秒に 1 件＝**1 件読む間に 6〜15 件届く**）。単一 FIFO ＋ `MAX_BACKLOG` の「古い未読から破棄」では、
 * 配信者が最も聞き逃したくない課金イベントが**通常チャットの洪水に埋もれて捨てられていた**。
 *
 * あるべき挙動:
 * - 課金（`isPriority` が true）は**バックログ超過でも破棄されない**。
 * - 課金は通常チャットより**先に**読まれる（待たされない）。
 * - `isPriority` 未注入なら全件が通常キュー＝**従来と完全に同じ**。
 * - 直列（音が重ならない）は不変＝変わるのは取り出し順だけ。
 */
describe("createTtsQueue の優先キュー（049 フォローアップ: 課金を漏らさない）", () => {
  let queue: ReturnType<typeof createTtsQueue> | null = null;

  beforeEach(() => {
    vi.stubGlobal("AudioContext", FakeAudioContext);
  });
  afterEach(() => {
    queue?.dispose();
    queue = null;
    vi.unstubAllGlobals();
  });

  const spoken = (): string[] =>
    vi.mocked(synthesize).mock.calls.map((args) => args[0]);
  const flush = (): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, 0));
  /** 課金＝eventType が chat 以外、という本体（`isMonetaryEvent`）と同じ粒度の述語。 */
  const isPriority = (c: CommentViewDto) => c.eventType !== "chat";

  /**
   * 通常チャットを大量に流し込んでから課金を 1 件入れ、キューを最後まで消化する。
   * `playWav` はモックで即解決するので、`pump` の再帰は flush を数回回せば終わる。
   */
  const drain = async (times = 40): Promise<void> => {
    for (let i = 0; i < times; i++) await flush();
  };

  it("バックログ超過で通常チャットが捨てられても、課金は必ず読まれる", async () => {
    queue = createTtsQueue({ isPriority });
    // MAX_BACKLOG(=6) を大きく超える通常チャットを一気に積む。
    for (let i = 0; i < 30; i++) {
      queue.enqueue(dto({ id: `c${i}`, text: `チャット${i}` }));
    }
    // その後に課金が 1 件届く。従来はこの後さらにチャットが積まれると破棄されえた。
    queue.enqueue(
      dto({ id: "m1", eventType: "membership", text: "メンシプ加入" }),
    );
    for (let i = 30; i < 60; i++) {
      queue.enqueue(dto({ id: `c${i}`, text: `チャット${i}` }));
    }
    await drain();

    expect(spoken()).toContain("メンシプ加入");
  });

  it("課金は通常チャットより先に読まれる（待たされない）", async () => {
    queue = createTtsQueue({ isPriority });
    // 1 件目は即 pump に取られるので、比較は 2 件目以降で見る。
    queue.enqueue(dto({ id: "c0", text: "先頭" }));
    queue.enqueue(dto({ id: "c1", text: "チャットA" }));
    queue.enqueue(dto({ id: "c2", text: "チャットB" }));
    queue.enqueue(dto({ id: "m1", eventType: "superchat", text: "スパチャ" }));
    await drain();

    const order = spoken();
    expect(order[0]).toBe("先頭");
    // 後から届いた課金が、先に積まれていた通常チャット 2 件を追い越す。
    expect(order.indexOf("スパチャ")).toBeLessThan(order.indexOf("チャットA"));
    expect(order.indexOf("スパチャ")).toBeLessThan(order.indexOf("チャットB"));
  });

  it("課金が連続しても順序は FIFO（優先キュー内は追い越さない）", async () => {
    queue = createTtsQueue({ isPriority });
    queue.enqueue(dto({ id: "c0", text: "先頭" }));
    queue.enqueue(dto({ id: "m1", eventType: "superchat", text: "課金1" }));
    queue.enqueue(dto({ id: "m2", eventType: "membership", text: "課金2" }));
    queue.enqueue(dto({ id: "m3", eventType: "gift", text: "課金3" }));
    await drain();

    const order = spoken();
    expect(order.indexOf("課金1")).toBeLessThan(order.indexOf("課金2"));
    expect(order.indexOf("課金2")).toBeLessThan(order.indexOf("課金3"));
  });

  it("通常チャットはバックログ上限で古い方から捨てられる（既存挙動の維持）", async () => {
    queue = createTtsQueue({ isPriority });
    // 1 件目は pump が取り出すので、キューに残るのは 2 件目以降。
    for (let i = 0; i < 30; i++) {
      queue.enqueue(dto({ id: `c${i}`, text: `チャット${i}` }));
    }
    await drain();

    const order = spoken();
    // 最新は必ず残る／古い方は捨てられている（最新優先の破棄）。
    expect(order).toContain("チャット29");
    expect(order).not.toContain("チャット10");
    // MAX_BACKLOG(=6) ＋ 再生中の 1 件が上限。読み上げが画面から数分遅れないための値。
    expect(order.length).toBeLessThanOrEqual(7);
  });

  it("isPriority 未注入なら全件が通常キュー＝従来と完全に同じ", async () => {
    queue = createTtsQueue();
    queue.enqueue(dto({ id: "c0", text: "先頭" }));
    queue.enqueue(dto({ id: "c1", text: "チャットA" }));
    queue.enqueue(dto({ id: "m1", eventType: "superchat", text: "スパチャ" }));
    await drain();

    // 課金であっても追い越さない（到着順のまま）。
    expect(spoken()).toEqual(["先頭", "チャットA", "スパチャ"]);
  });

  it("dispose すると優先キューも空になる", async () => {
    queue = createTtsQueue({ isPriority });
    queue.enqueue(dto({ id: "m1", eventType: "superchat", text: "課金1" }));
    queue.enqueue(dto({ id: "m2", eventType: "superchat", text: "課金2" }));
    queue.dispose();
    await drain();

    // 1 件目は dispose 前に pump が取り出しているが、2 件目以降は読まれない。
    expect(spoken()).not.toContain("課金2");
    queue = null; // afterEach の二重 dispose を避ける
  });
});

/**
 * 050: **1 件が永久に詰まらない**ことの仕様テスト。
 *
 * 読み上げは FIFO 直列（`playing` フラグ）なので、1 件が返らないと**以後すべてが無音**になり、
 * ユーザーにはアプリ再起動以外の復帰手段が無い。塞ぐ経路は 2 つ:
 * - **合成が返らない**（ENGINE が生きているのに応答しない）→ `SYNTH_TIMEOUT_MS` で諦める。
 *   ENGINE の停止・クラッシュは接続拒否で即エラーになるので元から詰まらない（対象外）。
 * - **再生が終わらない**（再生中に AudioContext が suspended になると `onended` が発火しない）
 *   → `ctx.state` の監視で諦める。**時間では切らない**（まだ鳴っている音を打ち切らないため）。
 *
 * どちらも「その 1 件だけを捨てて次へ進む」＝直列は止まらない。
 * ⚠ この describe だけ **fake timers**（上の 2 つは real timers のまま）。fake timers 下では
 * `setTimeout(resolve, 0)` の flush が進まないので、`vi.advanceTimersByTimeAsync` に置き換える。
 */
describe("createTtsQueue の永久ハング防止（050）", () => {
  let queue: ReturnType<typeof createTtsQueue> | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    FakeAudioContext.last = null;
    vi.stubGlobal("AudioContext", FakeAudioContext);
  });
  afterEach(() => {
    queue?.dispose();
    queue = null;
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const spoken = (): string[] =>
    vi.mocked(synthesize).mock.calls.map((args) => args[0]);
  /** マイクロタスクと 0ms タイマーだけを進める（real timers 側の flush と同じ役割）。 */
  const flush = async (): Promise<void> => {
    await vi.advanceTimersByTimeAsync(0);
  };
  /** `createTtsQueue` が内部で作った AudioContext を掴む（外へ出していないため）。 */
  const audioCtx = (): FakeAudioContext => {
    const ctx = FakeAudioContext.last;
    if (!ctx) throw new Error("AudioContext が生成されていない");
    return ctx;
  };

  it("合成が返らないままでも諦めて次の 1 件へ進む", async () => {
    // ENGINE が応答しない状況。実装と同じく「signal の abort で reject する」形にする
    // （`fetch` は abort されると AbortError で reject する）。
    vi.mocked(synthesize).mockImplementationOnce(
      (_text, _speaker, signal) =>
        new Promise<ArrayBuffer>((_resolve, reject) => {
          signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );
    queue = createTtsQueue();
    queue.enqueue(dto({ id: "c1", text: "詰まる方" }));
    queue.enqueue(dto({ id: "c2", text: "次の方" }));
    await flush();
    // 直列なので、1 件目が終わるまで 2 件目には進まない（＝これが詰まると全部詰まる）。
    expect(spoken()).toEqual(["詰まる方"]);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(spoken()).toEqual(["詰まる方", "次の方"]);
  });

  it("正常に読み上げ終わったら、合成・再生の見張りタイマーを残さない", async () => {
    queue = createTtsQueue();
    queue.enqueue(dto({ id: "c1", text: "こんにちは" }));
    await flush();
    expect(spoken()).toEqual(["こんにちは"]);

    // 解除漏れがあると、1 件読むたびにタイマーが積み上がる（合成 10 秒 / 再生の監視は 1 秒間隔で永続）。
    expect(vi.getTimerCount()).toBe(0);
  });

  it("再生中に AudioContext が止まったら、その 1 件を打ち切って次へ進む", async () => {
    // 再生中に suspended になると onended が発火しない＝この Promise は解決しない、という状況の再現。
    // 実装と同じく「signal の abort で resolve する」形にする（打ち切りは異常ではないので reject しない）。
    vi.mocked(playWav).mockImplementationOnce(
      (_ctx, _wav, signal) =>
        new Promise<void>((resolve) => {
          signal?.addEventListener("abort", () => resolve());
        }),
    );
    queue = createTtsQueue();
    queue.enqueue(dto({ id: "c1", text: "再生が終わらない方" }));
    queue.enqueue(dto({ id: "c2", text: "次の方" }));
    await flush();
    expect(spoken()).toEqual(["再生が終わらない方"]);

    // 背面に回る等で AudioContext が止まる。
    audioCtx().state = "suspended";
    await vi.advanceTimersByTimeAsync(1000);

    // 打ち切って次へ。2 件目は pump 冒頭の既存ガードが resume を試すので読み上げられる。
    expect(spoken()).toEqual(["再生が終わらない方", "次の方"]);
  });

  it("AudioContext が動いている限り、長い再生でも時間では打ち切らない", async () => {
    let aborted = false;
    vi.mocked(playWav).mockImplementationOnce(
      (_ctx, _wav, signal) =>
        new Promise<void>((resolve) => {
          signal?.addEventListener("abort", () => {
            aborted = true;
            resolve();
          });
          setTimeout(resolve, 30_000); // 30 秒鳴り続ける 1 件（上限 200 文字なら現実に起こる長さ）。
        }),
    );
    queue = createTtsQueue();
    queue.enqueue(dto({ id: "c1", text: "長い方" }));
    queue.enqueue(dto({ id: "c2", text: "次の方" }));
    await flush();

    await vi.advanceTimersByTimeAsync(29_000);
    // まだ鳴っているので打ち切ってはいけない（打ち切ると音が途切れる／次と重なる）。
    expect(aborted).toBe(false);
    expect(spoken()).toEqual(["長い方"]);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(aborted).toBe(false);
    expect(spoken()).toEqual(["長い方", "次の方"]);
  });

  it("合成が例外を投げても直列は止まらない（既存挙動の回帰）", async () => {
    vi.mocked(synthesize).mockRejectedValueOnce(new Error("ENGINE 停止"));
    queue = createTtsQueue();
    queue.enqueue(dto({ id: "c1", text: "失敗する方" }));
    queue.enqueue(dto({ id: "c2", text: "次の方" }));
    await flush();

    expect(spoken()).toEqual(["失敗する方", "次の方"]);
  });

  /**
   * ⚠ **この 2 ケースは `SYNTH_TIMEOUT_MS`（既定 10 秒）の値そのものを仕様として固定している**。
   * 定数を import すると「実装と同じものを実装と比べる」恒真式になり値の妥当性を固定できないので、
   * `SPEECH_ELLIPSIS` と同じ作法で**意図的にリテラルで書いている**。実機確認で値を変えるときは
   * ここの 9_000 / 1_000 / 10_000 も同時に直すこと（＝値を変える人が必ずこの仕様に気付く）。
   *
   * なぜ「切る」だけでなく「**切らない**」側を固定するのか: 短すぎると正常な読み上げが恒常的に飛び、
   * しかも通知が無いのでユーザーは気付けない（050 レビュー Q-2 のリスク非対称性）。
   */
  it("合成は 10 秒までは打ち切らない（短すぎると正常な読み上げが黙って飛ぶ）", async () => {
    let aborted = false;
    vi.mocked(synthesize).mockImplementationOnce(
      (_text, _speaker, signal) =>
        new Promise<ArrayBuffer>((_resolve, reject) => {
          signal?.addEventListener("abort", () => {
            aborted = true;
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    );
    queue = createTtsQueue();
    queue.enqueue(dto({ id: "c1", text: "時間のかかる合成" }));
    queue.enqueue(dto({ id: "c2", text: "次の方" }));
    await flush();

    await vi.advanceTimersByTimeAsync(9_000);
    expect(aborted).toBe(false);
    expect(spoken()).toEqual(["時間のかかる合成"]);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(aborted).toBe(true);
    expect(spoken()).toEqual(["時間のかかる合成", "次の方"]);
  });

  it("タイムアウトは 1 件ごとに張り直される（前の 1 件の待ち時間を持ち越さない）", async () => {
    // 守りたい不変条件は「**1 件が** 10 秒以上詰まらない」。キュー全体の予算にしてしまうと、
    // 2 件目以降が前の 1 件の待ち時間を食って不当に短い時間で切られる。
    const hang = (
      _text: string,
      _speaker?: number,
      signal?: AbortSignal,
    ): Promise<ArrayBuffer> =>
      new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")),
        );
      });
    vi.mocked(synthesize)
      .mockImplementationOnce(hang)
      .mockImplementationOnce(hang);
    queue = createTtsQueue();
    queue.enqueue(dto({ id: "c1", text: "詰まる1" }));
    queue.enqueue(dto({ id: "c2", text: "詰まる2" }));
    queue.enqueue(dto({ id: "c3", text: "正常" }));
    await flush();

    await vi.advanceTimersByTimeAsync(10_000);
    expect(spoken()).toEqual(["詰まる1", "詰まる2"]);

    // 2 件目はここでまだ 9 秒しか経っていない＝切られてはいけない。
    await vi.advanceTimersByTimeAsync(9_000);
    expect(spoken()).toEqual(["詰まる1", "詰まる2"]);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(spoken()).toEqual(["詰まる1", "詰まる2", "正常"]);
  });

  it("打ち切った後も直列は健在（後続が続けて読まれる）", async () => {
    vi.mocked(playWav).mockImplementationOnce(
      (_ctx, _wav, signal) =>
        new Promise<void>((resolve) => {
          signal?.addEventListener("abort", () => resolve());
        }),
    );
    queue = createTtsQueue();
    queue.enqueue(dto({ id: "c1", text: "打ち切られる方" }));
    queue.enqueue(dto({ id: "c2", text: "次の方" }));
    queue.enqueue(dto({ id: "c3", text: "その次の方" }));
    await flush();

    audioCtx().state = "suspended";
    await vi.advanceTimersByTimeAsync(1000);
    // 打ち切り後は `pump` 冒頭の既存ガードが resume を試すので、残りは普通に読まれる。
    expect(spoken()).toEqual(["打ち切られる方", "次の方", "その次の方"]);
  });

  it("合成中に dispose されたら、返ってきた結果を再生しない", async () => {
    // 「dispose では合成を中断しない」という設計が成立する根拠そのもの＝中断しない代わりに
    // `disposed` ガードで再生を抑止する。ここが壊れると、閉じたはずの窓から音が出る。
    let release: (wav: ArrayBuffer) => void = () => {};
    vi.mocked(synthesize).mockImplementationOnce(
      () =>
        new Promise<ArrayBuffer>((resolve) => {
          release = resolve;
        }),
    );
    queue = createTtsQueue();
    queue.enqueue(dto({ id: "c1", text: "合成中に閉じる" }));
    await flush();

    queue.dispose();
    release(new ArrayBuffer(0)); // dispose の**後**に合成が返る＝実機で起きる順序
    await flush();

    expect(playWav).not.toHaveBeenCalled();
    queue = null; // afterEach の二重 dispose を避ける
  });

  it("dispose 中の in-flight 再生は打ち切られ、見張りタイマーも残らない", async () => {
    // 従来は dispose しても `playWav` が `onended` を待ち続け（closed な ctx では発火しない）、
    // Promise と source が回収されないまま残っていた。050(B) の副作用として解消された分の固定。
    vi.mocked(playWav).mockImplementationOnce(
      (_ctx, _wav, signal) =>
        new Promise<void>((resolve) => {
          signal?.addEventListener("abort", () => resolve());
        }),
    );
    queue = createTtsQueue();
    queue.enqueue(dto({ id: "c1", text: "再生中に閉じる" }));
    await flush();

    queue.dispose();
    await vi.advanceTimersByTimeAsync(1000);

    expect(vi.getTimerCount()).toBe(0);
    queue = null;
  });
});

/**
 * 050 ＋ docs/security.md §9: **ログに読み上げテキストを出さない**ことの仕様テスト。
 *
 * 根拠（050 タスクファイル「このタスクでやらないこと」）: 「`console.error` / `console.debug` へ
 * **URL・リクエスト内容・読み上げテキストを出さないこと**。出してよいのは**件数と理由**のみ」。
 * 049 追補（security.md §1 例外 032c-c）で**課金イベントの読み上げには投稿者の表示名が入る**ため、
 * 読み上げテキストの流出はそのまま第三者の個人情報の流出になる。
 *
 * デバッグのために本文を 1 つログへ足す、というのは**最もやりがちな退行**なので、
 * 「黙って捨てる 3 経路」すべてについて、そのログに本文・投稿者名が現れないことを表明する。
 */
describe("createTtsQueue のログ（§9: 読み上げテキストを漏らさない）", () => {
  let queue: ReturnType<typeof createTtsQueue> | null = null;
  let debugSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  /** 課金イベントの読み上げ文言を模した、ログに出てはいけない文字列（投稿者名を含む）。 */
  const SECRET = "Aliceさんがメンバーシップを6ヶ月継続しました";

  beforeEach(() => {
    vi.useFakeTimers();
    FakeAudioContext.last = null;
    vi.stubGlobal("AudioContext", FakeAudioContext);
    debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    queue?.dispose();
    queue = null;
    debugSpy.mockRestore();
    errorSpy.mockRestore();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const flush = async (): Promise<void> => {
    await vi.advanceTimersByTimeAsync(0);
  };
  const audioCtx = (): FakeAudioContext => {
    const ctx = FakeAudioContext.last;
    if (!ctx) throw new Error("AudioContext が生成されていない");
    return ctx;
  };
  /** console へ渡された全引数を 1 本の文字列に潰す（Error は message/stack まで見る）。 */
  const logged = (): string =>
    [...debugSpy.mock.calls, ...errorSpy.mock.calls]
      .flat()
      .map((arg) =>
        arg instanceof Error
          ? `${arg.name} ${arg.message} ${arg.stack ?? ""}`
          : String(arg),
      )
      .join("\n");

  it("backlog 破棄のログは件数だけで、捨てたコメントの本文を出さない", async () => {
    queue = createTtsQueue();
    for (let i = 0; i < 30; i++) {
      queue.enqueue(dto({ id: `c${i}`, text: `${SECRET}${i}` }));
    }
    await flush();

    expect(logged()).toContain("破棄");
    expect(logged()).not.toContain(SECRET);
  });

  it("合成が失敗したときのログに読み上げテキストを出さない", async () => {
    vi.mocked(synthesize).mockRejectedValueOnce(new Error("ENGINE 停止"));
    queue = createTtsQueue();
    queue.enqueue(dto({ id: "c1", text: SECRET }));
    await flush();

    expect(logged()).toContain("VOICEVOX 読み上げに失敗しました");
    expect(logged()).not.toContain(SECRET);
  });

  it("合成タイムアウト（AbortError）でも読み上げテキストを出さない", async () => {
    // 050(A) で **AbortError が既存の catch へ新しく流れ込むようになった**経路の確認。
    vi.mocked(synthesize).mockImplementationOnce(
      (_text, _speaker, signal) =>
        new Promise<ArrayBuffer>((_resolve, reject) => {
          signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );
    queue = createTtsQueue();
    queue.enqueue(dto({ id: "c1", text: SECRET }));
    await flush();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(logged()).not.toContain(SECRET);
  });

  it("再生の打ち切りログは事象名だけで、読み上げテキストを出さない", async () => {
    vi.mocked(playWav).mockImplementationOnce(
      (_ctx, _wav, signal) =>
        new Promise<void>((resolve) => {
          signal?.addEventListener("abort", () => resolve());
        }),
    );
    queue = createTtsQueue();
    queue.enqueue(dto({ id: "c1", text: SECRET }));
    await flush();
    audioCtx().state = "suspended";
    await vi.advanceTimersByTimeAsync(1000);

    expect(logged()).toContain("再生中に AudioContext が停止した");
    expect(logged()).not.toContain(SECRET);
  });

  it("dispose による打ち切りは「ストール」として記録しない（正常な後始末なので）", async () => {
    // `ctx.close()` でも watchdog の条件（state !== "running"）は成立するが、それは正常な後始末。
    // 事象名と食い違うログを出すと診断価値が下がる（§9「デバッグに必要な情報だけを書く」）。
    vi.mocked(playWav).mockImplementationOnce(
      (_ctx, _wav, signal) =>
        new Promise<void>((resolve) => {
          signal?.addEventListener("abort", () => resolve());
        }),
    );
    queue = createTtsQueue();
    queue.enqueue(dto({ id: "c1", text: SECRET }));
    await flush();

    queue.dispose();
    await vi.advanceTimersByTimeAsync(1000);

    expect(logged()).not.toContain("再生中に AudioContext が停止した");
    queue = null;
  });

  it("打ち切りログは 1 回だけで、毎秒出続けない（watchdog が回りっぱなしにならない）", async () => {
    vi.mocked(playWav).mockImplementationOnce(
      (_ctx, _wav, signal) =>
        new Promise<void>((resolve) => {
          signal?.addEventListener("abort", () => resolve());
        }),
    );
    queue = createTtsQueue();
    queue.enqueue(dto({ id: "c1", text: SECRET }));
    await flush();
    audioCtx().state = "suspended";

    await vi.advanceTimersByTimeAsync(5000);
    const stallLogs = debugSpy.mock.calls
      .flat()
      .filter((arg: unknown) =>
        String(arg).includes("再生中に AudioContext が停止した"),
      );
    expect(stallLogs).toHaveLength(1);
  });
});
