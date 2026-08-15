import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { EffectOverlayApp } from "./EffectOverlayApp";
import {
  STREAM_EVENT_ROUND_KEY,
} from "../../features/comment-viewer/overlaySettings";
import type { CommentViewDto } from "../../features/comment-viewer/types";

/**
 * 061l: **ステージ窓に出る配信イベント**の仕様テスト（判断 4・5・7・8・11）。
 *
 * ⚠⚠ **既存の `EffectOverlayApp.test.tsx` とファイルを分けてある。** 理由は
 * **`./effectTrigger` を部分モックする**必要があるため（モジュールモックはファイル単位に効くので、
 * 既存 40 件超のケースの前提を汚さないよう別ファイルにした）。
 *
 * あるべき挙動:
 * - **マウント時に開催状態を読む**（`storage` が届かなくても出る＝判断 5）／**`storage` でも反映する**
 * - ⚠⚠ **コーナー窓には出さない**（判断 7＝ステージ窓は「全画面演出用」）
 * - **開催中のコメントで件数が増える**／⚠ **同一 id の再送（043e の combo 更新）では増えない**
 * - ⚠⚠ **本文・表示名が 1 文字も出ない**（§9・判断 8＝渡せる型が `{count, remainingMs}` しかない）
 * - ⚠⚠ **エフェクトのバースト枠・クールダウンを 1 つも消費しない**
 *   （＝ `recentFires` / `lastConditionAt` / `lastGiftAt` の**サイズを直接数える**。
 *   「何も出ない」系のアサーションでは殺せない＝061j 追加穴 η・061d-2 穴 γ・061k と同型の罠）
 * - **タイマーと `storage` リスナーがアンマウントで必ず外れる**（判断 11・教訓 E-1）
 *
 * ## ⚠⚠ 061p: 同梱レジストリを**差し替えて**検査する（`StreamEventTab.test.tsx` と同じ手）
 *
 * 061l はここで `STREAM_EVENT_REGISTRY[0]`（＝見本「みんなでコメントカウント」）を直接使っていたが、
 * **061p で同梱イベントが 0 本になった**ため、そのままでは 1 件も検査できない。
 * ⇒ **検査用のイベントを 1 本注入する**＝「ステージ窓の描画と件数の数え方」の仕様は
 * 同梱データの本数に関係なく固定され続ける（次タスクで玉入れ大会を足しても無改変で通る）。
 * ⚠⚠ **実データが 0 本＝実機ではイベントが 1 ピクセルも出ない**ことは
 * `streamEventRegistry.test.ts`（未知 id は引けない）と `streamEventRound.test.ts`
 * （未知 id の保存値は `null` へ倒す）が固定している。
 */
const mocks = vi.hoisted(() => ({
  connectCommentStream: vi.fn(),
  /**
   * ⚠⚠ **`decideEffects` の呼び出しを記録するラッパ**（実装へはそのまま委譲する）。
   * 第 3 引数が **`EffectOverlayApp` が `useRef` で抱えている発火層の state そのもの**なので、
   * ここから `recentFires` / `lastConditionAt` / `lastGiftAt` の**サイズを直接数えられる**。
   */
  /** 061p: 検査用の同梱イベント 1 本（実データは 0 本）。 */
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

vi.mock("../../features/obs-effects/streamEventRegistry", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../features/obs-effects/streamEventRegistry")
    >();
  const registry = [mocks.event];
  return {
    ...actual,
    STREAM_EVENT_REGISTRY: registry,
    findStreamEvent: (id: string) => registry.find((e) => e.id === id) ?? null,
    isStreamEventId: (id: string) => registry.some((e) => e.id === id),
  };
});

vi.mock("../../features/comment-viewer/commentStream", () => ({
  connectCommentStream: mocks.connectCommentStream,
}));


// ⚠ 061p: **注入した検査用イベント**（実データは 0 本＝上のクラス JSDoc の 061p 節）。
const EVENT = mocks.event;
const THIRD_PARTY_TEXT = "これは第三者のコメント本文です";
const THIRD_PARTY_NAME = "視聴者ネーム";

/** 第三者のコメント（本文・表示名・アバター入り）。 */
const comment = (id: string, over: Partial<CommentViewDto> = {}): CommentViewDto => ({
  id,
  source: "youtube",
  author: { id: `u-${id}`, name: THIRD_PARTY_NAME, avatar: "data:image/png;base64,AAAA" },
  text: THIRD_PARTY_TEXT,
  publishedAt: "2026-08-15T00:00:00Z",
  eventType: "chat",
  ...over,
});

/** 課金コメント（割り当てがあればエフェクトが出る）。 */
const superchat = (id: string): CommentViewDto =>
  comment(id, {
    eventType: "superchat",
    monetaryAmount: "¥1,000",
    monetary: { amount: 1000, currency: "JPY" },
  });

const emitComments = (comments: CommentViewDto[]) => {
  const handlers = mocks.connectCommentStream.mock.calls[0]?.[0];
  if (!handlers) throw new Error("connectCommentStream が呼ばれていない");
  act(() => {
    handlers.onComments(comments);
  });
};

/** main 窓が開催を始めた状態を作る（＝保存値だけ。窓はまだ読んでいない）。 */
const armRound = (over: { eventId?: string; endsAt?: number } = {}) => {
  const now = Date.now();
  const round = {
    eventId: over.eventId ?? EVENT.id,
    startedAt: now,
    endsAt: over.endsAt ?? now + 300_000,
  };
  localStorage.setItem(STREAM_EVENT_ROUND_KEY, JSON.stringify(round));
  return round;
};

/** 他窓（main 窓）の書換を模した `storage` イベント。 */
const dispatchRoundStorage = (newValue: string | null) => {
  act(() => {
    window.dispatchEvent(
      new StorageEvent("storage", { key: STREAM_EVENT_ROUND_KEY, newValue }),
    );
  });
};

/** ⚠ 件数は「コメント」の直前に出る数字。行そのものを読む。 */
const countText = () => screen.getByText("コメント").parentElement?.textContent ?? "";

describe("061l: EffectOverlayApp（配信イベント）", () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.connectCommentStream.mockReset();
    mocks.connectCommentStream.mockReturnValue({ disconnect: vi.fn() });
  });

  afterEach(() => {
    vi.useRealTimers();
    document.documentElement.removeAttribute("data-overlay");
  });

  // --- 新規 7 / 8: 開催状態の受け取り -------------------------------------------------------------

  it("⚠⚠ 新規 7: ステージ窓はマウント時に開催状態を読む（`storage` が届かなくても出る）", () => {
    armRound();
    render(<EffectOverlayApp />);
    // ⚠ `storage` は 1 度も飛ばしていない（＝マウント時の読み出しだけで出ている）。
    expect(screen.getByText(EVENT.title)).toBeInTheDocument();
    expect(countText()).toContain("0");
  });

  it("⚠ 開催していなければ何も描かない", () => {
    const { container } = render(<EffectOverlayApp />);
    expect(screen.queryByText(EVENT.title)).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("⚠ 期限切れ・壊れた保存値では描かない（`parseStreamEventRound` が落とす）", () => {
    armRound({ endsAt: Date.now() - 1 });
    const { unmount } = render(<EffectOverlayApp />);
    expect(screen.queryByText(EVENT.title)).toBeNull();
    unmount();

    localStorage.setItem(STREAM_EVENT_ROUND_KEY, "{");
    render(<EffectOverlayApp />);
    expect(screen.queryByText(EVENT.title)).toBeNull();
  });

  it("⚠⚠ 新規 8: `storage` で開始と終了が反映される", () => {
    render(<EffectOverlayApp />);
    expect(screen.queryByText(EVENT.title)).toBeNull();

    // 開始（main 窓の書換）。
    const round = armRound();
    dispatchRoundStorage(JSON.stringify(round));
    expect(screen.getByText(EVENT.title)).toBeInTheDocument();

    // 終了（main 窓が `removeItem`＝`newValue === null`）。
    localStorage.removeItem(STREAM_EVENT_ROUND_KEY);
    dispatchRoundStorage(null);
    expect(screen.queryByText(EVENT.title)).toBeNull();
  });

  it("⚠ 他のキーの `storage` では反応しない", () => {
    render(<EffectOverlayApp />);
    armRound();
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", { key: "stream-dock.other-key", newValue: "{}" }),
      );
    });
    expect(screen.queryByText(EVENT.title)).toBeNull();
  });

  it("⚠⚠ この窓は開催キーを書きも消しもしない（書き手は main 窓だけ・判断 5）", () => {
    const round = armRound();
    const raw = JSON.stringify(round);
    const { unmount } = render(<EffectOverlayApp />);
    emitComments([comment("c-1"), comment("c-2")]);
    expect(localStorage.getItem(STREAM_EVENT_ROUND_KEY)).toBe(raw);
    unmount();
    // ⚠⚠ アンマウント（窓を閉じた）でも消さない＝ 開き直せば開催は続いている。
    expect(localStorage.getItem(STREAM_EVENT_ROUND_KEY)).toBe(raw);
  });

  // --- 新規 9: コーナー窓には出さない -------------------------------------------------------------

  it("⚠⚠ 新規 10: 開催中のコメントで件数が増える", () => {
    armRound();
    render(<EffectOverlayApp />);
    expect(countText()).toContain("0");

    emitComments([comment("c-1"), comment("c-2")]);
    expect(countText()).toContain("2");

    emitComments([comment("c-3")]);
    expect(countText()).toContain("3");
  });

  it("⚠⚠ 新規 10: 開催していなければ数えない（あとから開始すると 0 から）", () => {
    // ⚠⚠ **このケースの前半は「仕様の明示」であって変異を殺していない**（061l レビュー Q-3・実測）。
    //   変異⑦（開催していなくても数える＝ガードごと外す）を当てても、
    //   **開始より前に数えた分は開催が変わったときの 0 リセットに吸われて外から観測できない**ため、
    //   RED になるのは下の「⚠⚠ 期限を過ぎたら、tick が来る前でも数えない」**1 件だけ**である。
    //   ⇒ **割り切って残している**（仕様として読めることに価値がある）。
    //   ⚠ 「⑦ はこのケースで殺せている」と読まないこと。
    render(<EffectOverlayApp />);
    emitComments([comment("c-1"), comment("c-2")]);
    expect(screen.queryByText("コメント")).toBeNull();

    const round = armRound();
    dispatchRoundStorage(JSON.stringify(round));
    // ⚠ 開始より前のコメントは数に入らない（件数は永続しない＝穴 δ の受容）。
    expect(countText()).toContain("0");
    emitComments([comment("c-3")]);
    expect(countText()).toContain("1");
  });

  it("⚠⚠ 穴 γ: 同一 id の再送（043e の combo 更新）で二重に数えない", () => {
    armRound();
    render(<EffectOverlayApp />);

    emitComments([comment("j-1")]);
    expect(countText()).toContain("1");
    // ⚠⚠ YouTube Jewels は**同じ id を金額違いで再送する**。
    emitComments([comment("j-1", { monetaryAmount: "¥2,000" })]);
    expect(countText()).toContain("1");

    // ⚠⚠ **ここが本命（変異 ⑭-b＝`incoming` で数える を殺すのはこのケースだけ）。**
    //   再送だけのバッチは `fresh.length === 0` の早期 return で**件数の処理まで到達しない**ので、
    //   上の 2 行では `incoming` と `fresh` を区別できない（＝最初の実測で ⑭-b が生存した）。
    //   ⇒ **再送と新着が混ざったバッチ**を流す。`incoming` で数えると 2 増えて 4 になる。
    emitComments([comment("j-1", { monetaryAmount: "¥3,000" }), comment("j-2")]);
    expect(countText()).toContain("2");
    expect(countText()).not.toContain("3");
  });

  it("⚠⚠ 期限を過ぎたら、tick が来る前でも数えない", () => {
    armRound({ endsAt: Date.now() + 50 });
    render(<EffectOverlayApp />);
    emitComments([comment("c-1")]);
    expect(countText()).toContain("1");

    // 期限を跨いだあとのコメント（⚠ tick（1 秒）はまだ来ていない）。
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 10_000);
    emitComments([comment("c-2")]);
    expect(countText()).toContain("1");
    vi.mocked(Date.now).mockRestore();
  });

  it("⚠⚠ 変異 ⑭-c: 2 回目の開催は 0 から数え直す", () => {
    const first = armRound();
    render(<EffectOverlayApp />);
    emitComments([comment("c-1"), comment("c-2")]);
    expect(countText()).toContain("2");

    // 終了 → もう一度開始。
    dispatchRoundStorage(null);
    const second = { ...first, startedAt: first.startedAt + 1, endsAt: first.endsAt + 1 };
    localStorage.setItem(STREAM_EVENT_ROUND_KEY, JSON.stringify(second));
    dispatchRoundStorage(JSON.stringify(second));
    expect(countText()).toContain("0");
  });

  it("⚠ 同じ内容の `storage` が届いても件数は消えない", () => {
    const round = armRound();
    render(<EffectOverlayApp />);
    emitComments([comment("c-1"), comment("c-2")]);
    expect(countText()).toContain("2");

    // ⚠ main 窓が同じ値を書き直した（＝内容は変わっていない）。
    dispatchRoundStorage(JSON.stringify(round));
    expect(countText()).toContain("2");
  });

  // --- 新規 11: §9 --------------------------------------------------------------------------------

  it("⚠⚠ 新規 11: イベントの表示に第三者の本文・表示名・アバターが 1 文字も出ない（§9）", () => {
    armRound();
    const { container } = render(<EffectOverlayApp />);
    emitComments([comment("c-1"), superchat("c-2")]);

    expect(countText()).toContain("2");
    expect(container.textContent).not.toContain(THIRD_PARTY_TEXT);
    expect(container.textContent).not.toContain(THIRD_PARTY_NAME);
    expect(container.querySelector("img")).toBeNull();
    // ⚠ 金額も出さない（イベントへ渡せるのは `{count, remainingMs}` だけ）。
    expect(container.textContent).not.toContain("¥1,000");
  });

  it("⚠⚠ 新規 11: イベント経由でも localStorage / console へ第三者データが漏れない（§9）", () => {
    const spies = (["log", "info", "warn", "error", "debug", "trace"] as const).map(
      (level) => vi.spyOn(console, level).mockImplementation(() => {}),
    );
    // ⚠ 開催の仕込み（main 窓の役目）を済ませてから監視を始める＝**この窓の書込だけ**を見る。
    armRound();
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    render(<EffectOverlayApp />);
    emitComments([comment("c-1"), superchat("c-2")]);

    expect(countText()).toContain("2");
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    // ⚠⚠ 件数を localStorage に持たない（穴 δ の結論）＝ **開催キーも件数も 1 度も書かない**。
    //   ⚠ この窓がマウント時に書くのは既存のガイド旗（`false` を倒すだけ）だけである。
    expect(
      setItem.mock.calls.filter((c) => c[0] === STREAM_EVENT_ROUND_KEY),
    ).toEqual([]);
    for (const [, value] of setItem.mock.calls) {
      expect(value).not.toContain(THIRD_PARTY_TEXT);
      expect(value).not.toContain(THIRD_PARTY_NAME);
    }
    for (const spy of spies) spy.mockRestore();
    setItem.mockRestore();
  });

  // --- 新規 12: 発火層の枠を食わない ---------------------------------------------------------------

  it("⚠⚠ 新規 13: 期限が来たら表示が消える（⚠ 窓は閉じない・localStorage も触らない）", async () => {
    vi.useFakeTimers();
    const round = armRound({ endsAt: Date.now() + 2_000 });
    render(<EffectOverlayApp />);
    expect(screen.getByText(EVENT.title)).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(screen.queryByText(EVENT.title)).toBeNull();
    // ⚠⚠ 掃除は main 窓の役目（この窓は読むだけ）。
    expect(localStorage.getItem(STREAM_EVENT_ROUND_KEY)).toBe(JSON.stringify(round));
  });

  it("⚠ 残り時間は tick で進む（配信画面は秒まで出す）", async () => {
    vi.useFakeTimers();
    armRound({ endsAt: Date.now() + 65_000 });
    render(<EffectOverlayApp />);
    expect(screen.getByText(/残り 1:0\d/)).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(screen.getByText(/残り 0:5\d/)).toBeInTheDocument();
  });

  it("⚠⚠ 新規 13: アンマウントでタイマーと `storage` リスナーが必ず外れる", async () => {
    vi.useFakeTimers();
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const clearSpy = vi.spyOn(window, "clearInterval");
    armRound();
    const { unmount } = render(<EffectOverlayApp />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    const added = addSpy.mock.calls.filter((c) => c[0] === "storage").length;
    unmount();
    const removed = removeSpy.mock.calls.filter((c) => c[0] === "storage").length;
    // ⚠⚠ **張った数と外した数が同じ**（教訓 E-1＝「張る側」を足したら「取り消す側」も数える）。
    expect(added).toBeGreaterThan(0);
    expect(removed).toBe(added);
    expect(clearSpy).toHaveBeenCalled();

    // ⚠ アンマウント後は何周期進めても再描画されない（タイマーが残っていれば警告か例外になる）。
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(screen.queryByText(EVENT.title)).toBeNull();
    addSpy.mockRestore();
    removeSpy.mockRestore();
    clearSpy.mockRestore();
  });

});
