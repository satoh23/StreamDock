import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { capForSpeech, createTtsQueue, sanitizeForSpeech } from "./ttsQueue";
import { synthesize } from "./voicevox";
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
  state = "running";
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
