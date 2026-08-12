import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { EffectOverlayApp } from "./EffectOverlayApp";
import {
  EFFECT_ASSIGNMENTS_KEY,
  EFFECT_MONETARY_ENABLED_KEY,
  EFFECT_OVERLAY_GUIDE_PENDING_KEY,
  EFFECT_TEST_FIRE_KEY,
} from "../../features/comment-viewer/overlaySettings";
import type { CommentViewDto } from "../../features/comment-viewer/types";
import type { EffectTemplateMedia } from "../../features/obs-effects/bindings/EffectTemplateMedia";
import type { EffectTemplateRecord } from "../../features/obs-effects/bindings/EffectTemplateRecord";
import { EFFECT_DISPLAY_MS, EFFECT_MAX_CONCURRENT } from "./effectTrigger";

/**
 * 061a / 061b-1: エフェクト専用オーバーレイ窓（label `effect-overlay`）の描画本体の仕様テスト。
 *
 * あるべき挙動:
 * - 透過窓の目印 `data-overlay="1"` を document に立て、unmount で外す（`OverlayApp` 踏襲）。
 * - **セットアップ用ガイドは「明示操作で開いたとき」だけ出て、一定時間で自動的に消える。**
 *   ⚠⚠ 061a レビュー（Q-1）で条件が 1 つ増えた。旧実装は**無条件に出していた**ため、
 *   `App.tsx` の起動時復元（＝アプリ起動のたびに窓が開く経路。061a が同時に新設した）でも出てしまい、
 *   「配信直前に StreamDock を起動」で 30 秒間 OBS のキャプチャに映っていた。
 *   いまは `EFFECT_OVERLAY_GUIDE_PENDING_KEY`（`ObsEffectsScreen` の表示トグル ON だけが立てる
 *   ワンショット旗）が立っているときだけ出し、マウント時に旗を倒す。
 * - ⚠⚠ **061b で 061a の決定を反転した**: 旧テストは「**WS へ接続しない**」を固定していたが、
 *   いまは **`connectCommentStream` を 1 回だけ呼ぶ**（`OverlayApp` と同じ読み取り専用接続）。
 *   その代償として第三者のコメント本文がこの窓に流れ込むので、**受け取っても描かない・保存しない・
 *   ログに出さない**ことを固定する。⚠ ここを落とすと §9 の担保が「実装がたまたまそうなっている」だけになる。
 * - ⚠ **061b-1（経路）の時点ではエフェクトの中身を何も描かない**（描画は 061b-2）。
 * - ⚠ **安定クラス `sd-overlay` を付けない**（060d の注入先は `comment-overlay` のみ）。
 *   静的ガード `check-css-guards.mjs` (10-d) と二重に固定する（あちらは字面、こちらは実 DOM）。
 *
 * 実 WS を張らないよう `connectCommentStream` はモックする（**呼ばれること自体が検証対象**になった＝
 * `PinnedOverlayApp.test.tsx` とは逆向き）。`OverlayApp.test.tsx` と同じハーネス。
 *
 * ⚠⚠ **061b レビュー（S-2）で §9 の担保に穴があった。** 当時のケースは「描かない」「localStorage へ
 * 保存しない」しか固定しておらず、実測ミューテーションで
 * **`console.log("[effect]", cs)` を足す変異が全ケース緑のまま生存**していた
 * （`no-console` の eslint ルールも無いので自動チェックがゼロだった）。下の
 * 「ログに出さない」ケースがこの穴を塞ぐ。
 * ⚠ **`useState` に持つだけで描かない変異は、いまも検出できていない**（外から観測する手段が無く、
 * React 内部へ介入しないと分からない）。これは意図的な割り切りで、§9 の実害
 * （画面に出る／永続する／ログへ漏れる）は下の 3 ケースで塞げている。
 * **再修正トリガー＝061b-2 で state を持つようになったら、「本文とアバターを含む DTO を
 * そのまま state に置いていないこと」を `decideEffects` の入出力の型で構造的に担保すること**
 * （`EffectRequest` に `text` / `avatar` を持たせない＝親 061 の決定）。
 */
const mocks = vi.hoisted(() => ({
  connectCommentStream: vi.fn(),
  listEffectTemplates: vi.fn(),
  getEffectTemplateMedia: vi.fn(),
}));

vi.mock("../../features/comment-viewer/commentStream", () => ({
  connectCommentStream: mocks.connectCommentStream,
}));

// ⚠ 061d-2: この窓は先読みのために `list_effect_templates` / `get_effect_template_media` を呼ぶ。
//   ⚠ **実 IPC は 1 つも走らせない**（テストは外部通信も OS 操作も一切行わない）。
vi.mock("../../features/obs-effects/effectTemplateApi", () => ({
  listEffectTemplates: mocks.listEffectTemplates,
  getEffectTemplateMedia: mocks.getEffectTemplateMedia,
}));

/**
 * 触られたプロパティ名を記録する `CommentStreamHandle` のスタブ。
 *
 * ⚠⚠ **061b レビュー（Q-3）で導入した。** 旧テストは `beforeEach` が作った
 * `{ disconnect }` をそのまま取り出して `expect(Object.keys(handle)).toEqual(["disconnect"])`
 * と書いていたが、これは**テスト自身が作ったオブジェクトの形を見ているだけのトートロジー**で、
 * コンポーネントが何をしても絶対に失敗しなかった。実際に「送信側に触れない」を担保していたのは
 * **モックが最小形であること**（他のメソッドを呼べば TypeError で落ちる）だけで、しかも
 * `handle.enableObs?.(...)` のように optional chaining で書かれると素通りする。
 * Proxy で**参照そのもの**を記録すれば、読み取り専用接続であることを実際に固定できる。
 */
const makeHandleSpy = () => {
  const touched: string[] = [];
  const disconnect = vi.fn();
  const proxy = new Proxy({ disconnect } as Record<string, unknown>, {
    get(target, prop) {
      // ⚠ symbol キー（`Symbol.toPrimitive` 等・テストランナーや React が触り得る）は記録しない。
      //   記録したいのは「実装が名前で参照したメソッド」だけ。
      if (typeof prop !== "string") return undefined;
      touched.push(prop);
      return target[prop];
    },
  });
  return { proxy, touched, disconnect };
};

/** `console.*` を全て監視する（§9・第三者の本文/表示名/金額/id を 1 バイトも出さないこと）。 */
const spyConsole = () =>
  (["log", "info", "warn", "error", "debug", "trace"] as const).map((level) =>
    vi.spyOn(console, level).mockImplementation(() => {}),
  );

/** sidecar からのコメント受信を模す（`connectCommentStream` に渡された handlers を直接叩く）。 */
const emitComments = (comments: CommentViewDto[]) => {
  const handlers = mocks.connectCommentStream.mock.calls[0]?.[0];
  if (!handlers) throw new Error("connectCommentStream が呼ばれていない");
  act(() => {
    handlers.onComments(comments);
  });
};

/** 第三者のコメント 1 件（本文・アバター入り）。この窓へ流し込んでも表に出ないことを確かめる。 */
const THIRD_PARTY_TEXT = "これは第三者のコメント本文です";
const THIRD_PARTY_NAME = "視聴者ネーム";
const superchat = (): CommentViewDto => ({
  id: "sc-1",
  source: "youtube",
  author: {
    id: "u1",
    name: THIRD_PARTY_NAME,
    avatar: "data:image/png;base64,AAAA",
  },
  text: THIRD_PARTY_TEXT,
  publishedAt: "2026-08-09T00:00:00Z",
  eventType: "superchat",
  monetaryAmount: "¥1,000",
  monetary: { amount: 1000, currency: "JPY" },
});

/** 「投げ銭でエフェクトを出す」を ON にした状況を作る（既定は OFF）。 */
const enableMonetary = () =>
  localStorage.setItem(EFFECT_MONETARY_ENABLED_KEY, "true");

// --- 061d-2: テンプレート割り当てのための道具立て -----------------------------------------------

const TEMPLATE_ID = "93c76e02-1111-4222-8333-444455556666";
const TEMPLATE_ID2 = "0f0e0d0c-1111-4222-8333-444455556666";

const PNG: EffectTemplateMedia = {
  media: "data:image/png;base64,iVBORw0KGgo=",
  sound: null,
};

const templateRecord = (
  over: Partial<EffectTemplateRecord> = {},
): EffectTemplateRecord => ({
  id: TEMPLATE_ID,
  name: "きらきら演出",
  durationMs: 5000,
  layout: { anchor: "center", offsetX: 0, offsetY: 0, width: 480, height: 240 },
  text: {
    template: "{name}さんが{amount}",
    templateWithoutAmount: "{message}",
    anchor: "bottom",
    fontSize: 32,
  },
  hasSound: false,
  createdAt: "2026-08-11T00:00:00Z",
  updatedAt: "2026-08-11T00:00:00Z",
  ...over,
});

/** main 窓が割り当てを保存した状況を作る（未指定の種別は「組み込み」へ埋まる）。 */
const setAssignments = (value: Record<string, unknown>) =>
  localStorage.setItem(EFFECT_ASSIGNMENTS_KEY, JSON.stringify(value));

/** ⚠ `<img alt="">` は role が "presentation" なので `getByRole("img")` では引けない。 */
const container0 = () => document.body;

/**
 * 窓を描いて**先読みが終わるまで待つ**。
 * ⚠ これが「先読み済みの状態」を作る唯一の手順で、キャッシュミス側のケースでは**呼ばない**。
 *
 * ⚠⚠ **061d-2 レビュー Q-7: マイクロタスクの段数に結合している**（`warmTemplates` の await が
 * 1 段増えると足りなくなる）。ほとんどのケースは「温まっていなければテンプレートが出ない」で
 * **落ちて気付ける**が、**否定アサーション**（`not.toHaveBeenCalledWith(…)`）だけは
 * 温まっていなくても緑になる＝ **vacuous になりうる**。
 * ⚠ **規律: 否定を見るケースでは、必ず先に「温まったこと」を肯定で確かめてから否定を見る。**
 * （`waitFor` へ寄せない理由＝ 待つ対象が「IPC が呼ばれたこと」ではなく「先読みが一巡したこと」で、
 * 肯定の観測点をケースごとに書くほうが、何を待っているかがテストに残る。）
 */
const renderWarmed = async () => {
  const view = render(<EffectOverlayApp />);
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  return view;
};

/** main 窓が「テスト表示」を押した状況を作る（＝他窓からの `storage` イベント）。 */
const fireTestFrom = (value = "1") => {
  localStorage.setItem(EFFECT_TEST_FIRE_KEY, value);
  act(() => {
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: EFFECT_TEST_FIRE_KEY,
        newValue: value,
      }),
    );
  });
};

describe("061a/061b: EffectOverlayApp", () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.connectCommentStream.mockReset();
    mocks.connectCommentStream.mockReturnValue({ disconnect: vi.fn() });
    mocks.listEffectTemplates.mockReset();
    mocks.listEffectTemplates.mockResolvedValue([]);
    mocks.getEffectTemplateMedia.mockReset();
    mocks.getEffectTemplateMedia.mockResolvedValue(PNG);
  });

  afterEach(() => {
    vi.useRealTimers();
    document.documentElement.removeAttribute("data-overlay");
  });

  /** 明示操作（`ObsEffectsScreen` の表示トグル ON）で窓が開いた状況を作る。 */
  const armGuide = () =>
    localStorage.setItem(EFFECT_OVERLAY_GUIDE_PENDING_KEY, "true");

  it("data-overlay を立て、unmount で外す", () => {
    const { unmount } = render(<EffectOverlayApp />);
    expect(document.documentElement.getAttribute("data-overlay")).toBe("1");
    unmount();
    expect(document.documentElement.hasAttribute("data-overlay")).toBe(false);
  });

  it("明示操作で開いた直後はセットアップ用ガイドが出る（OBS でキャプチャ範囲を確認するため）", () => {
    armGuide();
    render(<EffectOverlayApp />);
    expect(screen.getByText("StreamDock エフェクト")).toBeInTheDocument();
    expect(
      screen.getByText(/この枠にエフェクトが表示されます/),
    ).toBeInTheDocument();
  });

  it("⚠ 旗が立っていなければガイドを出さない（起動時の窓復元では配信画面を汚さない）", () => {
    // ⚠ 061a レビュー（Q-1）の本命。`App.tsx` の起動時復元は旗を立てないので、
    // 「設定 ON のまま配信直前に StreamDock を起動」でガイドが OBS に映らないこと。
    render(<EffectOverlayApp />);
    expect(screen.queryByText("StreamDock エフェクト")).toBeNull();
    expect(screen.queryByText(/この枠にエフェクトが表示されます/)).toBeNull();
  });

  it("⚠ 旗はマウント時に倒れる（次に開く窓ではもう出ない）", () => {
    armGuide();
    const { unmount } = render(<EffectOverlayApp />);
    expect(screen.getByText("StreamDock エフェクト")).toBeInTheDocument();
    expect(localStorage.getItem(EFFECT_OVERLAY_GUIDE_PENDING_KEY)).toBe("false");

    // 窓を開き直しても（旗が立て直されていなければ）出ない。
    unmount();
    render(<EffectOverlayApp />);
    expect(screen.queryByText("StreamDock エフェクト")).toBeNull();
  });

  it("ガイドは一定時間で自動的に消える（開けっぱなしでも残らないことの担保）", () => {
    vi.useFakeTimers();
    armGuide();
    render(<EffectOverlayApp />);
    expect(screen.getByText("StreamDock エフェクト")).toBeInTheDocument();

    // ⚠ 実装の定数（SETUP_GUIDE_VISIBLE_MS）より十分に長く進める。テストは**「いつか消える」**を
    // 固定するのが目的で、秒数そのものを固定すると値の調整のたびに落ちる（値の根拠は実装の JSDoc）。
    act(() => {
      vi.advanceTimersByTime(120_000);
    });
    expect(screen.queryByText("StreamDock エフェクト")).toBeNull();
    expect(screen.queryByText(/この枠にエフェクトが表示されます/)).toBeNull();
  });

  it("ガイドが消えたあとは何も描かない（061b-1 は経路だけ・描画は 061b-2）", () => {
    vi.useFakeTimers();
    armGuide();
    const { container } = render(<EffectOverlayApp />);
    act(() => {
      vi.advanceTimersByTime(120_000);
    });
    // ルート要素は残る（061b がここへ描く器）が、その中は空であること。
    expect(container.textContent).toBe("");
  });

  it("安定クラス sd-overlay を付けない（060d の注入先は comment-overlay のみ）", () => {
    const { container } = render(<EffectOverlayApp />);
    expect(container.querySelector(".sd-overlay")).toBeNull();
  });

  // --- 061b-1: sidecar の loopback WS への読み取り専用接続 -------------------------------------

  it("⚠ sidecar の WS へ接続する（061a の「接続しない」を 061b で反転した）", () => {
    // ⚠⚠ 旧テストは「1 本も張らない」ことを固定していた。061b でエフェクト窓が
    // `OverlayApp` と同じく loopback WS を直接張る設計に変わったので、**逆向きの仕様**になった。
    render(<EffectOverlayApp />);
    expect(mocks.connectCommentStream).toHaveBeenCalledTimes(1);
  });

  it("⚠ 接続は「窓内 WS 1 本」（再レンダーで張り直さない）", () => {
    const { rerender } = render(<EffectOverlayApp />);
    rerender(<EffectOverlayApp />);
    expect(mocks.connectCommentStream).toHaveBeenCalledTimes(1);
  });

  it("⚠ unmount で切断する（窓を閉じたあと接続が残らない）", () => {
    const disconnect = vi.fn();
    mocks.connectCommentStream.mockReturnValue({ disconnect });
    const { unmount } = render(<EffectOverlayApp />);
    expect(disconnect).not.toHaveBeenCalled();
    unmount();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it("⚠ 制御フレームを 1 つも送らない（読み取り専用＝onComments だけを使う）", () => {
    // ⚠ 戻り値側は Proxy で**実際に参照されたプロパティ**を記録する（061b レビュー Q-3）。
    //   旧実装の `Object.keys(handle)` はテスト自身が作った形を見るだけのトートロジーだった。
    const spy = makeHandleSpy();
    mocks.connectCommentStream.mockReturnValue(spy.proxy);

    const { unmount } = render(<EffectOverlayApp />);
    const handlers = mocks.connectCommentStream.mock.calls[0]?.[0];
    expect(handlers).toBeDefined();
    // `onComments` 以外のハンドラを取らない＝session/link/obs/device_code の受信面も持たない。
    expect(Object.keys(handlers)).toEqual(["onComments"]);

    // コメントを受け取っても、送信側（`enableObs` / `startSession` 等）へは一切触れない。
    emitComments([superchat()]);
    unmount();
    // ＝ハンドルから参照したのは disconnect だけ。`handle.enableObs?.(...)` のような
    //   optional chaining での送信も、参照した時点でここに現れるので捕まる。
    expect([...new Set(spy.touched)]).toEqual(["disconnect"]);
  });

  it("⚠⚠ エフェクトを出すときも本文とアバターは描かない（§9 の担保）", () => {
    // ⚠ 061a では「そもそも WS を張らない」ことが担保だった。061b でその担保が失われたので、
    // **受け取っても本文とアイコンは表に出さない**ことをここで固定する
    //（落とすと §9 が実装の偶然に依存する）。⚠ **名前と金額は出るのが仕様**（それが機能そのもの）。
    enableMonetary();
    const { container } = render(<EffectOverlayApp />);
    emitComments([superchat()]);

    expect(screen.getByText(THIRD_PARTY_NAME)).toBeInTheDocument(); // 出るのが仕様
    expect(screen.getByText("¥1,000")).toBeInTheDocument(); // 出るのが仕様
    expect(container.textContent).not.toContain(THIRD_PARTY_TEXT); // ⚠ 本文は出さない
    expect(container.querySelector("img")).toBeNull(); // ⚠ アイコンは出さない
    expect(container.innerHTML).not.toContain("data:image");
  });

  it("⚠⚠ 受け取ったコメントを localStorage へ保存しない（046a と同じ規律）", () => {
    enableMonetary();
    render(<EffectOverlayApp />);
    emitComments([superchat()]);

    // ⚠ 窓が書いてよいのはガイドのワンショット旗だけ（マウント時に false へ倒す）。
    //   ⚠ `EFFECT_MONETARY_ENABLED_KEY` はこのテストが立てたもので、窓は**読むだけ**。
    const keys = Object.keys(localStorage).sort();
    expect(keys).toEqual(
      [EFFECT_MONETARY_ENABLED_KEY, EFFECT_OVERLAY_GUIDE_PENDING_KEY].sort(),
    );
    // 念のため全値を走査して、本文・表示名・アバターがどこにも入っていないことを確かめる。
    const dump = keys.map((k) => localStorage.getItem(k) ?? "").join("|");
    expect(dump).not.toContain(THIRD_PARTY_TEXT);
    expect(dump).not.toContain(THIRD_PARTY_NAME);
    expect(dump).not.toContain("data:image");
  });

  it("⚠⚠ 受け取った第三者のコメントを console へ 1 バイトも出さない（§9 の担保）", () => {
    // ⚠⚠ **061b レビュー S-2 で追加。** これが無いと、`onComments` を埋める人が
    //   `console.log("[effect]", comments)` を残したまま**全テスト緑**で通る（実測で生存した変異）。
    //   `no-console` の eslint ルールも無いので、ここが唯一の自動チェックになる。
    //   ⚠ ログは配信者の端末に残り、画面共有・不具合報告の貼り付けでそのまま外へ出るので、
    //   第三者の本文・表示名・金額・id はレベルを問わず出さない（§9・046a 追補）。
    // ⚠ **発火する側でも確かめる**（OFF で素通りしているから静かなだけ、では担保にならない）。
    enableMonetary();
    const spies = spyConsole();
    render(<EffectOverlayApp />);
    emitComments([superchat()]);
    // ⚠⚠ **非課金コメント（通常チャット）でも確かめる**（061b レビュー②S-2・実測で生存した変異）。
    //   課金 1 件だけだと、**課金判定で弾いた側**でログを出す変異
    //   （`if (!isMonetaryEvent(...)) { console.debug(c.author.name, c.text); continue; }`）が
    //   **全 1347 件緑のまま生存**する。第三者の本文が流れる量としては通常チャットが圧倒的多数なので、
    //   ここを見ていないと §9 の担保はほぼ効いていない（S-2 の初回対応が塞ぎ切れていなかった穴）。
    emitComments([
      {
        ...superchat(),
        id: "chat-1",
        eventType: "chat",
        monetaryAmount: undefined,
        monetary: undefined,
      },
    ]);

    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  });

  // --- 061b-2: 発火と描画 -----------------------------------------------------------------------

  it("⚠ 「投げ銭でエフェクトを出す」が OFF なら 1 件も出さない（既定 OFF）", () => {
    const { container } = render(<EffectOverlayApp />); // enableMonetary() を呼ばない
    emitComments([superchat()]);
    expect(container.textContent).not.toContain(THIRD_PARTY_NAME);
  });

  it("⚠ 設定は発火のたびに読み直す（窓を開き直さなくても効く）", () => {
    // ⚠ state にミラーしていたら、あとから ON にしても次のコメントで出ない。
    //   この設定の持ち主は main 窓なので、写した瞬間に stale になる形が作れる。
    const { container } = render(<EffectOverlayApp />);
    emitComments([superchat()]);
    expect(container.textContent).not.toContain(THIRD_PARTY_NAME);

    enableMonetary();
    emitComments([{ ...superchat(), id: "sc-2" }]);
    expect(screen.getByText(THIRD_PARTY_NAME)).toBeInTheDocument();
  });

  it("エフェクトは一定時間で消える（配信画面に残り続けない）", () => {
    vi.useFakeTimers();
    enableMonetary();
    const { container } = render(<EffectOverlayApp />);
    emitComments([superchat()]);
    expect(screen.getByText(THIRD_PARTY_NAME)).toBeInTheDocument();

    // ⚠ 実装の定数より十分に長く進める（「いつか消える」を固定するのが目的・秒数は実装の JSDoc が正）。
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(container.textContent).toBe("");
  });

  it("⚠⚠ 同一 id を 2 回受け取っても 1 回しか出ない（043e の combo 再送）", () => {
    enableMonetary();
    render(<EffectOverlayApp />);
    emitComments([superchat()]);
    emitComments([superchat()]); // 同じ id が再送された
    expect(screen.getAllByText(THIRD_PARTY_NAME)).toHaveLength(1);
  });

  it("⚠⚠ 再接続で同じコメントが流れ直しても再発火しない（接続直後の一斉発火を防ぐ）", () => {
    // ⚠ `seenIds` はコンポーネントの ref なので、`connectCommentStream` の内部再接続
    //（`scheduleReconnect`）でソケットが張り直されても持続する。ここでは
    //「同じ handlers へ同じコメントが再度流れてくる」＝再接続後の再送を模す。
    enableMonetary();
    const other = {
      ...superchat(),
      id: "sc-2",
      author: { id: "u2", name: "別の人" },
    };
    render(<EffectOverlayApp />);
    emitComments([superchat(), other]);
    expect(screen.getAllByText(THIRD_PARTY_NAME)).toHaveLength(1);
    expect(screen.getAllByText("別の人")).toHaveLength(1);

    emitComments([superchat(), other]);
    expect(screen.getAllByText(THIRD_PARTY_NAME)).toHaveLength(1);
    expect(screen.getAllByText("別の人")).toHaveLength(1);
  });

  it("⚠ 同時に出るのは上限まで（大量に来ても画面を埋め尽くさない）", () => {
    enableMonetary();
    const { container } = render(<EffectOverlayApp />);
    emitComments(
      Array.from({ length: 30 }, (_, i) => ({
        ...superchat(),
        id: `burst-${i}`,
        author: { id: `u${i}`, name: `視聴者${i}` },
      })),
    );
    const lines = container.querySelectorAll("p");
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.length).toBeLessThanOrEqual(EFFECT_MAX_CONCURRENT);
  });

  it("⚠⚠ あふれたときに捨てるのは**古い方**（いま来た投げ銭が黙って消えない）", () => {
    // ⚠⚠ 061b レビュー②Q-3・実測で生存した変異。旧テストは件数の**上限**しか見ていなかったため、
    //   `slice(-N)` を `slice(0, N)` にする変異（＝**新しい方を捨てて古い N 件が居座る**）が
    //   全 1347 件緑のまま通った。機能としては最悪の壊れ方（いま課金した人のエフェクトが出ない）なので、
    //   件数ではなく**どれが残るか**を固定する。
    // ⚠ 手口: まずテスト発火で枠を上限まで埋める（テスト発火は `decideEffects` を通らないので
    //   バースト上限に邪魔されず `showEffect` の切り方だけを見られる）。そのうえで**本物の課金コメント**を
    //   1 件流し、**それが画面に居ること**を見る。固定ダミーだけで埋めると中身が同一で見分けが付かない。
    enableMonetary();
    render(<EffectOverlayApp />);
    for (let i = 0; i < EFFECT_MAX_CONCURRENT; i++) fireTestFrom(String(i));
    expect(screen.getAllByText("テスト")).toHaveLength(EFFECT_MAX_CONCURRENT);

    emitComments([superchat()]);
    // 新しい方（本物の課金）が残り、いちばん古いテストダミーが押し出されていること。
    expect(screen.getByText(THIRD_PARTY_NAME)).toBeInTheDocument();
    expect(screen.getAllByText("テスト")).toHaveLength(EFFECT_MAX_CONCURRENT - 1);
  });

  it("金額を持たない種別は「〇〇さんが…しました」を出す", () => {
    enableMonetary();
    render(<EffectOverlayApp />);
    emitComments([
      {
        ...superchat(),
        id: "sub-1",
        source: "twitch",
        eventType: "subscription",
        monetaryAmount: undefined,
        monetary: undefined,
        monthCount: 3,
      },
    ]);
    expect(
      screen.getByText(`${THIRD_PARTY_NAME}さんがサブスクを3ヶ月継続しました`),
    ).toBeInTheDocument();
  });

  // --- 061b-2: テスト発火（main 窓 → localStorage の nonce → storage）---------------------------

  it("⚠ テスト発火で固定ダミーが出る（第三者データを使わない）", () => {
    render(<EffectOverlayApp />);
    fireTestFrom();
    expect(screen.getByText("テスト")).toBeInTheDocument();
    expect(screen.getByText("¥1,000")).toBeInTheDocument();
  });

  it("⚠ テスト発火は「投げ銭でエフェクトを出す」が OFF でも動く（OBS の位置合わせ用）", () => {
    render(<EffectOverlayApp />); // enableMonetary() を呼ばない
    fireTestFrom();
    expect(screen.getByText("テスト")).toBeInTheDocument();
  });

  it("⚠ localStorage.clear()（key === null）ではテスト発火しない", () => {
    // ⚠ 設定をまとめて消す操作で配信画面にエフェクトが出るのは筋が悪い（046b の `clear()` 論点と同型）。
    const { container } = render(<EffectOverlayApp />);
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: null }));
    });
    expect(container.textContent).not.toContain("テスト");
  });

  it("⚠ キーの削除（newValue === null）ではテスト発火しない", () => {
    // ⚠ 061b レビュー②Q-5・実測で生存した変異（`if (e.newValue === null) return;` を消しても全緑だった）。
    //   `clear()` は `key === null` で来るので上のケースが拾うが、**`removeItem` は key 付き・値 null** で
    //   来るため、そちらはこのケースでしか止められない。「設定を消す操作で配信画面にエフェクトが出る」
    //   のは筋が悪い、という判断は `clear()` と同じ（046b の論点と同型）。
    const { container } = render(<EffectOverlayApp />);
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: EFFECT_TEST_FIRE_KEY,
          newValue: null,
        }),
      );
    });
    expect(container.textContent).not.toContain("テスト");
  });

  it("⚠ テスト発火を連打しても上限を超えない（固定 id でも取り違えない）", () => {
    const { container } = render(<EffectOverlayApp />);
    for (let i = 0; i < 10; i++) fireTestFrom(String(i));
    expect(container.querySelectorAll("p").length).toBeLessThanOrEqual(
      EFFECT_MAX_CONCURRENT,
    );
  });

  // --- 061b-2: ガイドとの共存 --------------------------------------------------------------------

  it("⚠ エフェクトが出たらセットアップ用ガイドを畳む（960×360 で両方は読めない）", () => {
    armGuide();
    render(<EffectOverlayApp />);
    expect(screen.getByText("StreamDock エフェクト")).toBeInTheDocument();

    fireTestFrom();
    expect(screen.queryByText("StreamDock エフェクト")).toBeNull();
    expect(screen.getByText("テスト")).toBeInTheDocument();
  });

  // --- 061d-2: テンプレートの描画・先読み・音・テスト発火の割り当て反映 --------------------------
  //
  // ⚠⚠ **この窓が第三者由来のバイト列を実際に踏むのは 061d-2 から**である
  // （061c は「経路ができた」まで、061d-1 は main 窓のプレビューが先に踏んだところまで）。
  // ここで固定するのは「踏んでも安全である根拠」そのもの＝
  //   ①`safeEffectMedia` を通っていること ②差し込み文面がテキストノードであること
  //   ③失敗しても**無反応にならない**こと（必ず組み込みへ落ちる）。

  it("⚠⚠ 割り当てたテンプレートが配信画面に出る", async () => {
    enableMonetary();
    mocks.listEffectTemplates.mockResolvedValue([templateRecord()]);
    setAssignments({
      superchat: { kind: "template", templateId: TEMPLATE_ID },
    });
    await renderWarmed();

    emitComments([superchat()]);
    expect(screen.getByTestId("effect-template")).toBeInTheDocument();
    // ⚠ `alt=""` の装飾画像なので role は "presentation"（`getByRole("img")` では引けない）。
    expect(container0().querySelector("img")).toHaveAttribute("src", PNG.media);
    // ⚠ 差し込み文面が出る（`{name}` / `{amount}` が置換されている）。
    expect(
      screen.getByText(`${THIRD_PARTY_NAME}さんが¥1,000`),
    ).toBeInTheDocument();
  });

  it("⚠⚠ テンプレートは組み込みの縦積みの**外**に置く（`inset: 0` の層が箱を突き抜けない）", async () => {
    enableMonetary();
    mocks.listEffectTemplates.mockResolvedValue([templateRecord()]);
    setAssignments({
      superchat: { kind: "template", templateId: TEMPLATE_ID },
      subscription: { kind: "builtin-monetary" },
    });
    const { container } = await renderWarmed();

    emitComments([
      superchat(),
      {
        ...superchat(),
        id: "sub-1",
        eventType: "subscription",
        monetaryAmount: undefined,
        monetary: undefined,
        author: { id: "u2", name: "サブスクの人" },
      },
    ]);

    // ⚠ 組み込みのカードとテンプレートが**同時に**出ている状況を作ってから見る。
    expect(screen.getByText(/サブスクの人/)).toBeInTheDocument();
    const template = screen.getByTestId("effect-template");
    const stack = container.querySelector('[class*="effectStack"]');
    expect(stack).not.toBeNull();
    // ⚠⚠ **テンプレート層を `.effectStack` の中へ移す変異は、この 1 行がレッドにする**
    //   （061d-1 レビュー Q-6 の罠＝箱を無視して層が飛び出す）。
    expect(stack?.contains(template)).toBe(false);
  });

  it("⚠⚠ `data:` 以外のメディアは描かず組み込みで出す（safeEffectMedia を通す）", async () => {
    enableMonetary();
    mocks.listEffectTemplates.mockResolvedValue([templateRecord()]);
    mocks.getEffectTemplateMedia.mockResolvedValue({
      media: "javascript:alert(1)",
      sound: null,
    });
    setAssignments({
      superchat: { kind: "template", templateId: TEMPLATE_ID },
    });
    await renderWarmed();

    emitComments([superchat()]);
    expect(screen.queryByTestId("effect-template")).toBeNull();
    // ⚠ **無反応にならない**（組み込み意匠で出る）。
    expect(screen.getByText(THIRD_PARTY_NAME)).toBeInTheDocument();
    expect(screen.getByText("¥1,000")).toBeInTheDocument();
  });

  it("⚠⚠ メディアのデコードに失敗したら組み込みへフォールバックする（無反応にならない）", async () => {
    enableMonetary();
    mocks.listEffectTemplates.mockResolvedValue([templateRecord()]);
    setAssignments({
      superchat: { kind: "template", templateId: TEMPLATE_ID },
    });
    await renderWarmed();

    emitComments([superchat()]);
    const img = container0().querySelector("img");
    if (img === null) throw new Error("テンプレートのメディアが描かれていない");
    act(() => {
      fireEvent.error(img);
    });
    expect(screen.queryByTestId("effect-template")).toBeNull();
    expect(screen.getByText(THIRD_PARTY_NAME)).toBeInTheDocument();
    expect(screen.getByText("¥1,000")).toBeInTheDocument();
  });

  it("⚠⚠ `{name}` に HTML を入れても *テキストとして* 出る（第三者の自由入力）", async () => {
    enableMonetary();
    mocks.listEffectTemplates.mockResolvedValue([templateRecord()]);
    setAssignments({
      superchat: { kind: "template", templateId: TEMPLATE_ID },
    });
    const { container } = await renderWarmed();

    const evil = '<img src=x onerror=alert(1)>';
    emitComments([
      { ...superchat(), author: { id: "u9", name: evil } },
    ]);
    expect(screen.getByText(`${evil}さんが¥1,000`)).toBeInTheDocument();
    // ⚠ 要素になっていない＝ テンプレートのメディア 1 枚しか `<img>` が無い。
    expect(container.querySelectorAll("img")).toHaveLength(1);
  });

  it("⚠ text を持たないテンプレート（メディアだけ）でも描ける", async () => {
    enableMonetary();
    mocks.listEffectTemplates.mockResolvedValue([templateRecord({ text: null })]);
    setAssignments({
      superchat: { kind: "template", templateId: TEMPLATE_ID },
    });
    await renderWarmed();

    emitComments([superchat()]);
    expect(screen.getByTestId("effect-template")).toBeInTheDocument();
    expect(screen.queryByText(THIRD_PARTY_NAME)).toBeNull();
  });

  // --- ②: per-effect の撤去タイマー -------------------------------------------------------------

  it("⚠⚠ テンプレートは `durationMs` で消える（組み込みの既定より短くても長くても）", async () => {
    enableMonetary();
    mocks.listEffectTemplates.mockResolvedValue([
      templateRecord({ durationMs: 800 }),
    ]);
    setAssignments({
      superchat: { kind: "template", templateId: TEMPLATE_ID },
    });
    await renderWarmed();
    vi.useFakeTimers();

    emitComments([superchat()]);
    expect(screen.getByTestId("effect-template")).toBeInTheDocument();
    // ⚠ 既定（`EFFECT_DISPLAY_MS`）より**手前**で消える＝固定値へ戻す変異でレッド。
    act(() => {
      vi.advanceTimersByTime(900);
    });
    expect(screen.queryByTestId("effect-template")).toBeNull();
  });

  it("⚠⚠ 長い `durationMs` のテンプレートは既定時間を過ぎても残る", async () => {
    enableMonetary();
    mocks.listEffectTemplates.mockResolvedValue([
      templateRecord({ durationMs: 15_000 }),
    ]);
    setAssignments({
      superchat: { kind: "template", templateId: TEMPLATE_ID },
    });
    await renderWarmed();
    vi.useFakeTimers();

    emitComments([superchat()]);
    act(() => {
      vi.advanceTimersByTime(EFFECT_DISPLAY_MS + 1_000);
    });
    expect(screen.getByTestId("effect-template")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(15_000);
    });
    expect(screen.queryByTestId("effect-template")).toBeNull();
  });

  it("⚠ `durationMs` が壊れていても即座に消えない（setTimeout に NaN を渡さない）", async () => {
    enableMonetary();
    mocks.listEffectTemplates.mockResolvedValue([
      templateRecord({ durationMs: Number.NaN }),
    ]);
    setAssignments({
      superchat: { kind: "template", templateId: TEMPLATE_ID },
    });
    await renderWarmed();
    vi.useFakeTimers();

    emitComments([superchat()]);
    act(() => {
      vi.advanceTimersByTime(EFFECT_DISPLAY_MS - 100);
    });
    expect(screen.getByTestId("effect-template")).toBeInTheDocument();
  });

  it("⚠ `durationMs` が `setTimeout` の上限ちょうどなら、そのまま使う（境界）", async () => {
    // ⚠ 仕様: 弾くのは「`setTimeout` が壊れる値」だけ。上限ちょうど（2^31-1）は壊れないので
    //   既定へ落とさない（Rust の範囲 500〜15000 を TS に複製しない、という判断と両立させる）。
    enableMonetary();
    mocks.listEffectTemplates.mockResolvedValue([
      templateRecord({ durationMs: 2_147_483_647 }),
    ]);
    setAssignments({
      superchat: { kind: "template", templateId: TEMPLATE_ID },
    });
    await renderWarmed();
    vi.useFakeTimers();

    emitComments([superchat()]);
    // 既定（`EFFECT_DISPLAY_MS`）を大きく超えても残る＝既定へ落ちていない。
    act(() => {
      vi.advanceTimersByTime(EFFECT_DISPLAY_MS * 10);
    });
    expect(screen.getByTestId("effect-template")).toBeInTheDocument();
  });

  it("⚠ `durationMs` が 32bit を超えていても即座に消えない（setTimeout のオーバーフロー・レビュー Q-5）", async () => {
    enableMonetary();
    // ⚠ `setTimeout` の遅延は 32bit に丸められるので、`2^31-1` 超は**即時発火**する（NaN と同じ症状）。
    mocks.listEffectTemplates.mockResolvedValue([
      templateRecord({ durationMs: 2_147_483_648 }),
    ]);
    setAssignments({
      superchat: { kind: "template", templateId: TEMPLATE_ID },
    });
    await renderWarmed();
    vi.useFakeTimers();

    emitComments([superchat()]);
    act(() => {
      vi.advanceTimersByTime(EFFECT_DISPLAY_MS - 100);
    });
    expect(screen.getByTestId("effect-template")).toBeInTheDocument();
  });

  // --- ④: 先読みと 穴 β の (c) ------------------------------------------------------------------

  it("⚠⚠ 先読みするのは「割り当てに出てくる id」だけ（一覧全部を読まない）", async () => {
    mocks.listEffectTemplates.mockResolvedValue([
      templateRecord(),
      templateRecord({ id: TEMPLATE_ID2, name: "使っていない演出" }),
    ]);
    setAssignments({
      superchat: { kind: "template", templateId: TEMPLATE_ID },
    });
    await renderWarmed();

    expect(mocks.getEffectTemplateMedia).toHaveBeenCalledWith(TEMPLATE_ID);
    expect(mocks.getEffectTemplateMedia).not.toHaveBeenCalledWith(TEMPLATE_ID2);
  });

  it("⚠⚠ 先読み前に発火したら、その回は組み込みで出し切る（穴 β の案 (c)）", async () => {
    enableMonetary();
    // ⚠ 先読みを終わらせずに発火させる（`renderWarmed` を使わない）。
    let resolveList: (value: EffectTemplateRecord[]) => void = () => {};
    mocks.listEffectTemplates.mockReturnValue(
      new Promise<EffectTemplateRecord[]>((r) => {
        resolveList = r;
      }),
    );
    setAssignments({
      superchat: { kind: "template", templateId: TEMPLATE_ID },
    });
    render(<EffectOverlayApp />);

    emitComments([superchat()]);
    // ⚠ **無反応にならない**（組み込みで出る）。
    expect(screen.queryByTestId("effect-template")).toBeNull();
    expect(screen.getByText(THIRD_PARTY_NAME)).toBeInTheDocument();

    // 温まったら次回からテンプレートで出る（＝「初回だけ組み込み」で収束する）。
    await act(async () => {
      resolveList([templateRecord()]);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    emitComments([{ ...superchat(), id: "sc-2" }]);
    expect(screen.getByTestId("effect-template")).toBeInTheDocument();
  });

  it("⚠ 発火時ミスの取り直しは 1 id につき 1 回だけ（投げ銭のたびに IPC が走らない）", async () => {
    enableMonetary();
    // 一覧に載っていない id を割り当てておく（＝削除済みテンプレートを指す割り当て）。
    mocks.listEffectTemplates.mockResolvedValue([]);
    mocks.getEffectTemplateMedia.mockRejectedValue(new Error("gone"));
    setAssignments({
      superchat: { kind: "template", templateId: TEMPLATE_ID },
    });
    await renderWarmed();
    const listCallsAfterWarm = mocks.listEffectTemplates.mock.calls.length;

    for (let i = 0; i < 3; i++) {
      emitComments([{ ...superchat(), id: `sc-${i}` }]);
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
    }
    // ⚠ 3 回発火しても取り直しは 1 回だけ。
    expect(mocks.listEffectTemplates.mock.calls.length).toBe(
      listCallsAfterWarm + 1,
    );
    // ⚠ そして**必ず組み込みで出ている**（実在しない id が「なし」へ倒れていない＝⑪）。
    expect(screen.getAllByText(THIRD_PARTY_NAME).length).toBeGreaterThan(0);
  });

  it("⚠ 割り当てが変わったら（`storage`）キャッシュを温め直す", async () => {
    mocks.listEffectTemplates.mockResolvedValue([
      templateRecord(),
      templateRecord({ id: TEMPLATE_ID2, name: "別の演出" }),
    ]);
    setAssignments({
      superchat: { kind: "template", templateId: TEMPLATE_ID },
    });
    await renderWarmed();
    // ⚠ **先に肯定を見る**（Q-7）。これが無いと、先読みが一巡していないだけで
    //   下の否定が通ってしまい、ケース全体が vacuous になる。
    expect(mocks.getEffectTemplateMedia).toHaveBeenCalledWith(TEMPLATE_ID);
    expect(mocks.getEffectTemplateMedia).not.toHaveBeenCalledWith(TEMPLATE_ID2);

    setAssignments({
      superchat: { kind: "template", templateId: TEMPLATE_ID2 },
    });
    await act(async () => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: EFFECT_ASSIGNMENTS_KEY,
          newValue: "{}",
        }),
      );
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.getEffectTemplateMedia).toHaveBeenCalledWith(TEMPLATE_ID2);
  });

  // --- 割り当ての反映（①・⑪） ------------------------------------------------------------------

  it("⚠⚠ 「エフェクトを出さない」種別は 1 件も出ない", async () => {
    enableMonetary();
    setAssignments({ superchat: { kind: "none" } });
    const { container } = await renderWarmed();

    emitComments([superchat()]);
    expect(container.textContent).toBe("");
  });

  it("⚠ 割り当ては発火のたびに読み直す（main 窓で変えた直後の 1 件目から効く）", async () => {
    enableMonetary();
    await renderWarmed();
    emitComments([superchat()]);
    expect(screen.getAllByText(THIRD_PARTY_NAME)).toHaveLength(1);

    // ⚠ `storage` を撒かずに localStorage だけ書き換える＝**窓跨ぎ伝播に依存していない**ことの担保。
    setAssignments({ superchat: { kind: "none" } });
    emitComments([{ ...superchat(), id: "sc-2" }]);
    // ⚠ 2 件目は出ない（1 件目は表示時間が来るまで残っているので、件数で見る）。
    expect(screen.getAllByText(THIRD_PARTY_NAME)).toHaveLength(1);
  });

  // --- 穴 ε: 音 ---------------------------------------------------------------------------------

  it("⚠ 音源を持つテンプレートでは `<audio>` を 1 本置く（配信に載る）", async () => {
    enableMonetary();
    mocks.listEffectTemplates.mockResolvedValue([
      templateRecord({ hasSound: true }),
    ]);
    mocks.getEffectTemplateMedia.mockResolvedValue({
      media: PNG.media,
      sound: "data:audio/wav;base64,AAAA",
    });
    setAssignments({
      superchat: { kind: "template", templateId: TEMPLATE_ID },
    });
    await renderWarmed();

    emitComments([superchat()]);
    expect(screen.getByTestId("effect-sound")).toHaveAttribute(
      "src",
      "data:audio/wav;base64,AAAA",
    );
  });

  it("⚠⚠ 同時に 3 件出ても鳴るのは 1 本だけ（最後に出たもの）", async () => {
    enableMonetary();
    mocks.listEffectTemplates.mockResolvedValue([
      templateRecord({ hasSound: true }),
    ]);
    mocks.getEffectTemplateMedia.mockResolvedValue({
      media: PNG.media,
      sound: "data:audio/wav;base64,AAAA",
    });
    setAssignments({
      superchat: { kind: "template", templateId: TEMPLATE_ID },
    });
    await renderWarmed();

    emitComments(
      Array.from({ length: EFFECT_MAX_CONCURRENT }, (_, i) => ({
        ...superchat(),
        id: `sc-${i}`,
        author: { id: `u${i}`, name: `視聴者${i}` },
      })),
    );
    expect(screen.getAllByTestId("effect-template")).toHaveLength(
      EFFECT_MAX_CONCURRENT,
    );
    // ⚠⚠ **3 本鳴らす変異は、この 1 行がレッドにする。**
    expect(screen.getAllByTestId("effect-sound")).toHaveLength(1);
  });

  it("⚠ 音源が `data:` 以外なら鳴らさない（メディアは出す）", async () => {
    enableMonetary();
    mocks.listEffectTemplates.mockResolvedValue([
      templateRecord({ hasSound: true }),
    ]);
    mocks.getEffectTemplateMedia.mockResolvedValue({
      media: PNG.media,
      sound: "https://example.com/a.wav",
    });
    setAssignments({
      superchat: { kind: "template", templateId: TEMPLATE_ID },
    });
    await renderWarmed();

    emitComments([superchat()]);
    expect(screen.getByTestId("effect-template")).toBeInTheDocument();
    expect(screen.queryByTestId("effect-sound")).toBeNull();
  });

  it("⚠ 組み込みのエフェクトでは音を鳴らさない", async () => {
    enableMonetary();
    await renderWarmed();
    emitComments([superchat()]);
    expect(screen.queryByTestId("effect-sound")).toBeNull();
  });

  it("⚠⚠ 組み込みが後から出ても、鳴っているテンプレートの音は止めない（レビュー Q-10）", async () => {
    // ⚠ 仕様: 音を差し替えるのは**音源を持つテンプレートが出たときだけ**。
    //   組み込みが後続で出たときに音を止めると、`EFFECT_MAX_CONCURRENT` を超えた瞬間に
    //   「まだ表示時間が残っているのに音だけ切れる」が起きる（音と映像を独立させる方針）。
    // ⚠ **画面から押し出された 1 件の音も、その 1 件の撤去タイマーまでは鳴り続ける**
    //   ——これは受容した挙動で、実装のコメントに理由と再修正トリガーを書いてある。
    enableMonetary();
    // ⚠ テンプレートの表示時間はバースト窓（＝`EFFECT_DISPLAY_MS`）より長くしておく。
    //   でないと、下で窓を空けるために時計を進めた時点でテンプレート自身が撤去されてしまい、
    //   「押し出されたのに音が残る」ではなく「時間切れで消えた」を見ることになる。
    mocks.listEffectTemplates.mockResolvedValue([
      templateRecord({ hasSound: true, durationMs: 15_000 }),
    ]);
    mocks.getEffectTemplateMedia.mockResolvedValue({
      media: PNG.media,
      sound: "data:audio/wav;base64,AAAA",
    });
    setAssignments({
      superchat: { kind: "template", templateId: TEMPLATE_ID },
      subscription: { kind: "builtin-monetary" },
    });
    await renderWarmed();
    vi.useFakeTimers();

    emitComments([superchat()]);
    expect(screen.getByTestId("effect-sound")).toBeInTheDocument();

    // ⚠ バースト窓を空ける（空けないと下の 3 件のうち 2 件しか発火せず、押し出しが起きない）。
    act(() => {
      vi.advanceTimersByTime(EFFECT_DISPLAY_MS + 100);
    });
    // 組み込みを `EFFECT_MAX_CONCURRENT` 件流してテンプレートを画面から押し出す。
    emitComments(
      Array.from({ length: EFFECT_MAX_CONCURRENT }, (_, i) => ({
        ...superchat(),
        id: `sub-${i}`,
        eventType: "subscription",
        monetaryAmount: undefined,
        monetary: undefined,
        author: { id: `u${i}`, name: `サブスクの人${i}` },
      })),
    );
    expect(screen.queryByTestId("effect-template")).toBeNull();
    // ⚠⚠ **音を止める変異（組み込みでも `setSound` を呼ぶ／押し出しで音を消す）はここがレッドにする。**
    expect(screen.getByTestId("effect-sound")).toBeInTheDocument();
  });

  it("⚠ `clear()`（`e.key === null`）では温め直さない（レビュー Q-4）", async () => {
    // ⚠ 仕様: 温め直しは「割り当てが変わった」ときだけ。`clear()` は**設定そのものが無かったことになる**
    //   操作で、送り先の意図が消えているのにキャッシュを触りに行く筋は無い
    //   （テスト発火の受け口が `clear()` で発火しないのと同じ向き）。
    mocks.listEffectTemplates.mockResolvedValue([templateRecord()]);
    setAssignments({
      superchat: { kind: "template", templateId: TEMPLATE_ID },
    });
    await renderWarmed();
    const callsAfterWarm = mocks.listEffectTemplates.mock.calls.length;

    await act(async () => {
      window.dispatchEvent(new StorageEvent("storage", { key: null }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.listEffectTemplates.mock.calls.length).toBe(callsAfterWarm);
  });

  // --- ⑧: テスト発火の割り当て反映 --------------------------------------------------------------

  it("⚠⚠ テスト発火はスーパーチャットの割り当てを反映する", async () => {
    mocks.listEffectTemplates.mockResolvedValue([templateRecord()]);
    setAssignments({
      superchat: { kind: "template", templateId: TEMPLATE_ID },
    });
    await renderWarmed();

    fireTestFrom();
    expect(screen.getByTestId("effect-template")).toBeInTheDocument();
    // ⚠ 中身は**この窓の固定ダミー**（第三者のデータが localStorage を経由しない・§9）。
    expect(screen.getByText("テストさんが¥1,000")).toBeInTheDocument();
  });

  it("⚠⚠ 「エフェクトを出さない」設定でもテスト発火は組み込みで必ず出る（OBS の位置合わせ）", async () => {
    setAssignments({ superchat: { kind: "none" } });
    await renderWarmed();

    fireTestFrom();
    // ⚠⚠ **この特例を消す変異（`?? { kind: "builtin-monetary" }` を外す）はここがレッドにする。**
    expect(screen.getByText("テスト")).toBeInTheDocument();
    expect(screen.getByText("¥1,000")).toBeInTheDocument();
  });
});
