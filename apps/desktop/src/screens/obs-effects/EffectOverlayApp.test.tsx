import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { EffectOverlayApp } from "./EffectOverlayApp";
import {
  EFFECT_ASSIGNMENTS_KEY,
  EFFECT_OVERLAY_GUIDE_PENDING_KEY,
  EFFECT_TEST_FIRE_KEY,
  EFFECT_TEST_FIRE_PENDING_KEY,
} from "../../features/comment-viewer/overlaySettings";
import type { CommentViewDto } from "../../features/comment-viewer/types";
import { MONETARY_EVENT_TYPES } from "../comment-viewer/viewerFormat";
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
 *   いまは `EFFECT_OVERLAY_GUIDE_PENDING_KEY`（**明示操作だけが立てる**ワンショット旗）が
 *   立っているときだけ出し、マウント時に旗を倒す。
 *   ⚠ **061i で起点が移った**——「`ObsEffectsScreen` の表示トグル ON」→
 *   「`EffectTemplateCard` のテスト表示で**停止中の窓を開いたとき**」（判断 3）。
 *   ⚠ **条件を編集して窓が自動で開いたときは立たない**（起点側のケースは `EffectTemplateCard.test.tsx` と
 *   `ObsEffectsScreen.test.tsx` が固定する。この窓が見るのは「旗があれば出す・読んだら倒す」だけ）。
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
 *
 * ## ⚠⚠ 061h でこのファイルの前提が 2 つ変わった
 *
 * 1. **既定では 1 件も出ない。** 組み込み意匠を廃止し `DEFAULT_EFFECT_ASSIGNMENT` を
 *    `{kind:"none"}` へ反転したので、**発火を観測するケースは必ず「テンプレートを割り当てて
 *    先読みを終わらせる」**という前置きが要る（`renderAssigned()`）。
 *    ＝ 061b の「投げ銭でエフェクトを出す」トグル（`EFFECT_MONETARY_ENABLED_KEY`）は**廃止**した。
 * 2. **テスト表示は「押した行のテンプレート」を出す。** wire が `<nonce>:<templateId>` になり、
 *    061d-2 の「スーパーチャットの割り当てを引く／『出さない』でも組み込みで必ず出す」特例（穴 η）は
 *    **特例ごと消えた**。⚠ 受け取った id は使う前に**形を検証する**（§9・多層防御の 1 枚目）。
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

/** main 窓が割り当てを保存した状況を作る（⚠ 061h: 未指定の種別は「**出さない**」へ埋まる）。 */
const setAssignments = (value: Record<string, unknown>) =>
  localStorage.setItem(EFFECT_ASSIGNMENTS_KEY, JSON.stringify(value));

/**
 * ⚠⚠ **061h: 「全課金種別を 1 つのテンプレートへ割り当てた」状態。**
 *
 * 061b 時点では既定（組み込み）のまま投げ銭を流せばエフェクトが出たが、061h の既定は
 * 「出さない」なので、**発火そのものを観測したいケースはまずこれを呼ぶ**。
 * ＝ 「割り当てないと出ない」という 061h の仕様が、テストの前置きとして毎回現れる。
 */
const assignAllToTemplate = (templateId = TEMPLATE_ID) =>
  setAssignments(
    Object.fromEntries(
      [...MONETARY_EVENT_TYPES].map((eventType) => [
        eventType,
        { kind: "template", templateId },
      ]),
    ),
  );

/** テンプレートの差し込み文面（`{name}さんが{amount}`）で出る文字列。 */
const templateLine = (name: string, amount = "¥1,000") => `${name}さんが${amount}`;

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

/**
 * ⚠ 061h: **発火を観測するケースの標準の前置き**
 * ＝「一覧にテンプレートがある」＋「全種別をそれへ割り当て」＋「先読み完了」。
 */
const renderAssigned = async (records = [templateRecord()]) => {
  mocks.listEffectTemplates.mockResolvedValue(records);
  assignAllToTemplate();
  return renderWarmed();
};

/**
 * main 窓が「配信画面でテスト表示」を押した状況を作る（＝他窓からの `storage` イベント）。
 *
 * ⚠ 061h: wire は `<nonce>:<templateId>`。**nonce だけの旧形式は id が取れないので発火しない**
 * （下の「形の検証」ケースがそれを固定する）。
 */
const fireTestFrom = (templateId: string = TEMPLATE_ID, nonce = "1") => {
  const value = `${nonce}:${templateId}`;
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

/** テスト表示の生の wire 値を流す（形が壊れている値を試すため）。 */
const fireTestRaw = (value: string) => {
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

  /** 明示操作（⚠ 061i 以降は「停止中の窓をテスト表示で開いた」）で窓が開いた状況を作る。 */
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

  it("⚠⚠ 061i: ガイドの本文が「いつ出るか」を実装どおりに書いている（廃止したトグルを名指ししない）", () => {
    // ⚠⚠ **061i の実機確認で見つかった退行の回帰テスト。** 061h まで本文は
    //   「このガイドは、**表示を ON にした直後**だけ出て自動的に消えます。」と書いていたが、
    //   061i でそのトグルは**廃止**され、起点は「停止中の窓をテスト表示で開いたとき」へ移った。
    // ⚠⚠ **この 1 文だけは OBS のキャプチャに数十秒そのまま映る**＝画面内の案内文より嘘の害が大きい
    //   （配信を見ている視聴者にも読める）。061a レビュー Q-1「約束できることだけ書く」の最も重い適用先。
    // ⚠ 起点を変えるときは `ObsEffectsScreen` の案内文・`EFFECT_OVERLAY_GUIDE_PENDING_KEY` の
    //   JSDoc とあわせて **3 か所**直すこと。
    armGuide();
    render(<EffectOverlayApp />);
    expect(
      screen.getByText(/「配信画面でテスト表示」で開いた直後だけ出て/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/表示を ON にした直後/)).toBeNull();
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

  it("⚠⚠ エフェクトを出すときも本文とアバターは描かない（§9 の担保）", async () => {
    // ⚠ 061a では「そもそも WS を張らない」ことが担保だった。061b でその担保が失われたので、
    // **受け取っても本文とアイコンは表に出さない**ことをここで固定する
    //（落とすと §9 が実装の偶然に依存する）。⚠ **名前と金額は出るのが仕様**（それが機能そのもの）。
    // ⚠ 061h: 出す手段がテンプレートだけになったので、割り当てたうえで見る。
    const { container } = await renderAssigned();
    emitComments([superchat()]);

    expect(
      screen.getByText(templateLine(THIRD_PARTY_NAME)),
    ).toBeInTheDocument(); // 名前と金額は出るのが仕様
    expect(container.textContent).not.toContain(THIRD_PARTY_TEXT); // ⚠ 本文は出さない
    // ⚠ 061h: `<img>` は**テンプレートのメディア 1 枚だけ**（アバターは描かない）。
    expect(container.querySelectorAll("img")).toHaveLength(1);
    expect(container.querySelector("img")).toHaveAttribute("src", PNG.media);
    expect(container.innerHTML).not.toContain("data:image/png;base64,AAAA");
  });

  // --- 061j: キーワード条件（この窓が「通常チャットでも発火する」ようになった） --------------------

  /** 通常チャット 1 件（⚠ 課金の情報を持たない＝ 061h までは 1 件も出せなかった種別）。 */
  const chat = (text: string): CommentViewDto => ({
    id: `chat-${text}`,
    source: "youtube",
    author: { id: "u2", name: THIRD_PARTY_NAME, avatar: "data:image/png;base64,AAAA" },
    text,
    publishedAt: "2026-08-15T00:00:00Z",
    eventType: "chat",
  });

  /** キーワード条件 1 件だけを保存し、一覧とキャッシュを温めた窓を描く。 */
  const renderWithKeyword = async (
    text: string,
    match: "contains" | "exact" = "contains",
  ) => {
    assignKeyword(text, match);
    mocks.listEffectTemplates.mockResolvedValue([templateRecord()]);
    return renderWarmed();
  };

  /** キーワード条件 1 件だけを保存した状態にする。 */
  const assignKeyword = (text: string, match: "contains" | "exact" = "contains") =>
    localStorage.setItem(
      EFFECT_ASSIGNMENTS_KEY,
      JSON.stringify([
        {
          id: "kw:1",
          when: { type: "keyword", text, match },
          effect: { kind: "template", templateId: TEMPLATE_ID },
        },
      ]),
    );

  it("⚠⚠ 新規 1: キーワードを含む**通常チャット**でエフェクトが出る（061j の本命）", async () => {
    // ⚠⚠ **061h まではこの窓が通常チャットで発火する経路は 1 本も無かった**
    //   （`decideEffects` の先頭で課金判定に落ちていた）。課金ゲートを matcher 側へ移した
    //   ことの結線を、**窓の側から**固定する（`resolveEffectMatch` の単体テストとは別の担保）。
    const { container } = await renderWithKeyword("草");
    emitComments([chat("これは草だな")]);
    await screen.findByTestId("effect-template");
    // ⚠ メディアは出る。
    expect(container.querySelector("img")).toHaveAttribute("src", PNG.media);
  });

  it("⚠ キーワードに当たらない通常チャットでは何も出ない", async () => {
    await renderWithKeyword("草");
    emitComments([chat("こんばんは〜")]);
    expect(screen.queryByTestId("effect-template")).toBeNull();
  });

  it("⚠⚠ 新規 17: **キーワードで発火したときも**本文を描かない（§9）", async () => {
    // ⚠⚠ **061j で第三者の本文が新しい層（`effectAssignments.ts` の照合）を通るようになった。**
    //   ⚠ 「当たった本文をそのまま出す」実装は自然に書けてしまう（キーワードが当たっている以上、
    //   本文は手元にある）ので、**発火した状態で**描かれないことを固定する。
    //   ⚠ 判断 12 のとおり、キーワード発火では**文字が 1 行も出ない**のが仕様である。
    const { container } = await renderWithKeyword("草");
    emitComments([chat(`草 ${THIRD_PARTY_TEXT}`)]);
    await screen.findByTestId("effect-template");

    expect(container.textContent).not.toContain(THIRD_PARTY_TEXT);
    // ⚠ 投稿者名も出ない（既定テンプレートの `templateWithoutAmount` は `{message}` だけで、
    //   通常チャットでは `message` が null ＝ 1 行も描かれない・判断 12）。
    expect(container.textContent).not.toContain(THIRD_PARTY_NAME);
    // ⚠ アバターも描かない（`<img>` はテンプレートのメディア 1 枚だけ）。
    expect(container.querySelectorAll("img")).toHaveLength(1);
    expect(container.innerHTML).not.toContain("data:image/png;base64,AAAA");
  });

  it("⚠⚠ キーワードで発火しても、本文が localStorage にも console にも出ない（§9）", async () => {
    const logs = spyConsole();
    await renderWithKeyword("草");
    emitComments([chat(`草 ${THIRD_PARTY_TEXT}`)]);
    await screen.findByTestId("effect-template");

    const dump = Object.keys(localStorage)
      .map((k) => localStorage.getItem(k) ?? "")
      .join("|");
    expect(dump).not.toContain(THIRD_PARTY_TEXT);
    expect(dump).not.toContain(THIRD_PARTY_NAME);
    const consoleDump = logs
      .flatMap((spy) => spy.mock.calls.flat())
      .map((a) => String(a))
      .join("|");
    expect(consoleDump).not.toContain(THIRD_PARTY_TEXT);
    expect(consoleDump).not.toContain(THIRD_PARTY_NAME);
  });

  it("⚠ 同じキーワードが連続しても、クールダウンの間は 1 件しか出ない（判断 7 の結線）", async () => {
    await renderWithKeyword("草");
    emitComments([chat("草1")]);
    emitComments([chat("草2")]);
    // ⚠ `Date.now()` は実時間なので、2 件は必ずクールダウン（10 秒）の内側に入る。
    expect(await screen.findAllByTestId("effect-template")).toHaveLength(1);
  });

  it("⚠⚠ 受け取ったコメントを localStorage へ保存しない（046a と同じ規律）", async () => {
    await renderAssigned();
    emitComments([superchat()]);

    // ⚠ 窓が書いてよいのはガイドのワンショット旗だけ（マウント時に false へ倒す）。
    //   ⚠ `EFFECT_ASSIGNMENTS_KEY` はこのテストが立てたもので、窓は**読むだけ**。
    const keys = Object.keys(localStorage).sort();
    expect(keys).toEqual(
      [EFFECT_ASSIGNMENTS_KEY, EFFECT_OVERLAY_GUIDE_PENDING_KEY].sort(),
    );
    // 念のため全値を走査して、本文・表示名・アバターがどこにも入っていないことを確かめる。
    const dump = keys.map((k) => localStorage.getItem(k) ?? "").join("|");
    expect(dump).not.toContain(THIRD_PARTY_TEXT);
    expect(dump).not.toContain(THIRD_PARTY_NAME);
    expect(dump).not.toContain("data:image");
  });

  it("⚠⚠ 受け取った第三者のコメントを console へ 1 バイトも出さない（§9 の担保）", async () => {
    // ⚠⚠ **061b レビュー S-2 で追加。** これが無いと、`onComments` を埋める人が
    //   `console.log("[effect]", comments)` を残したまま**全テスト緑**で通る（実測で生存した変異）。
    //   `no-console` の eslint ルールも無いので、ここが唯一の自動チェックになる。
    //   ⚠ ログは配信者の端末に残り、画面共有・不具合報告の貼り付けでそのまま外へ出るので、
    //   第三者の本文・表示名・金額・id はレベルを問わず出さない（§9・046a 追補）。
    // ⚠ **発火する側でも確かめる**（割り当てが無くて素通りしているから静かなだけ、では担保にならない）。
    const spies = spyConsole();
    await renderAssigned();
    emitComments([superchat()]);
    // ⚠ 先に「実際に出ている」ことを見る（vacuous にしないため・レビュー Q-7 の規律）。
    expect(screen.getByTestId("effect-template")).toBeInTheDocument();
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

  it("⚠⚠ 割り当てが既定（表示しない）のままなら 1 件も出さない（061h の既定）", async () => {
    // ⚠⚠ **061h の本命。** 061b はここが「投げ銭でエフェクトを出すトグルが OFF なら出ない」で、
    //   トグルが ON なら**割り当てが無くても組み込みが出た**（＝頼んでいない演出）。
    //   いまは**割り当てを引かない限り 1 件も出ない**。
    mocks.listEffectTemplates.mockResolvedValue([templateRecord()]);
    const { container } = await renderWarmed(); // assignAllToTemplate() を呼ばない
    emitComments([superchat()]);
    expect(container.textContent).toBe("");
    expect(screen.queryByTestId("effect-template")).toBeNull();
  });

  it("⚠ 割り当ては発火のたびに読み直す（未設定 → 割り当てが次の 1 件目から効く）", async () => {
    // ⚠ state にミラーしていたら、あとから割り当てても次のコメントで出ない。
    //   この設定の持ち主は main 窓なので、写した瞬間に stale になる形が作れる。
    mocks.listEffectTemplates.mockResolvedValue([templateRecord()]);
    const { container } = await renderWarmed();
    emitComments([superchat()]);
    expect(container.textContent).toBe("");

    // ⚠ `storage` を撒かずに localStorage だけ書き換える＝窓跨ぎ伝播に依存していないことの担保。
    //   ⚠ メディアはマウント時の先読みで温まっていないので、**1 件目はキャッシュミスで出ない**
    //   （061h の `fire()` は待たない）。温め直しが済んだ 2 件目から出る。
    assignAllToTemplate();
    emitComments([{ ...superchat(), id: "sc-2" }]);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    emitComments([{ ...superchat(), id: "sc-3" }]);
    expect(screen.getByTestId("effect-template")).toBeInTheDocument();
  });

  it("エフェクトは一定時間で消える（配信画面に残り続けない）", async () => {
    const { container } = await renderAssigned();
    vi.useFakeTimers();
    emitComments([superchat()]);
    expect(screen.getByTestId("effect-template")).toBeInTheDocument();

    // ⚠ 実装の定数より十分に長く進める（「いつか消える」を固定するのが目的・秒数は実装の JSDoc が正）。
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(container.textContent).toBe("");
  });

  it("⚠⚠ 同一 id を 2 回受け取っても 1 回しか出ない（043e の combo 再送）", async () => {
    await renderAssigned();
    emitComments([superchat()]);
    emitComments([superchat()]); // 同じ id が再送された
    expect(screen.getAllByTestId("effect-template")).toHaveLength(1);
  });

  it("⚠⚠ 再接続で同じコメントが流れ直しても再発火しない（接続直後の一斉発火を防ぐ）", async () => {
    // ⚠ `seenIds` はコンポーネントの ref なので、`connectCommentStream` の内部再接続
    //（`scheduleReconnect`）でソケットが張り直されても持続する。ここでは
    //「同じ handlers へ同じコメントが再度流れてくる」＝再接続後の再送を模す。
    const other = {
      ...superchat(),
      id: "sc-2",
      author: { id: "u2", name: "別の人" },
    };
    await renderAssigned();
    emitComments([superchat(), other]);
    expect(screen.getAllByText(templateLine(THIRD_PARTY_NAME))).toHaveLength(1);
    expect(screen.getAllByText(templateLine("別の人"))).toHaveLength(1);

    emitComments([superchat(), other]);
    expect(screen.getAllByText(templateLine(THIRD_PARTY_NAME))).toHaveLength(1);
    expect(screen.getAllByText(templateLine("別の人"))).toHaveLength(1);
  });

  it("⚠ 同時に出るのは上限まで（大量に来ても画面を埋め尽くさない）", async () => {
    await renderAssigned();
    emitComments(
      Array.from({ length: 30 }, (_, i) => ({
        ...superchat(),
        id: `burst-${i}`,
        author: { id: `u${i}`, name: `視聴者${i}` },
      })),
    );
    const shown = screen.getAllByTestId("effect-template");
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.length).toBeLessThanOrEqual(EFFECT_MAX_CONCURRENT);
  });

  it("⚠⚠ あふれたときに捨てるのは**古い方**（いま来た投げ銭が黙って消えない）", async () => {
    // ⚠⚠ 061b レビュー②Q-3・実測で生存した変異。旧テストは件数の**上限**しか見ていなかったため、
    //   `slice(-N)` を `slice(0, N)` にする変異（＝**新しい方を捨てて古い N 件が居座る**）が
    //   全 1347 件緑のまま通った。機能としては最悪の壊れ方（いま課金した人のエフェクトが出ない）なので、
    //   件数ではなく**どれが残るか**を固定する。
    // ⚠ 手口: まずテスト表示で枠を上限まで埋める（テスト表示は `decideEffects` を通らないので
    //   バースト上限に邪魔されず `showEffect` の切り方だけを見られる）。そのうえで**本物の課金コメント**を
    //   1 件流し、**それが画面に居ること**を見る。固定ダミーだけで埋めると中身が同一で見分けが付かない。
    await renderAssigned();
    for (let i = 0; i < EFFECT_MAX_CONCURRENT; i++)
      fireTestFrom(TEMPLATE_ID, String(i));
    expect(screen.getAllByText(templateLine("テスト"))).toHaveLength(
      EFFECT_MAX_CONCURRENT,
    );

    emitComments([superchat()]);
    // 新しい方（本物の課金）が残り、いちばん古いテストダミーが押し出されていること。
    expect(
      screen.getByText(templateLine(THIRD_PARTY_NAME)),
    ).toBeInTheDocument();
    expect(screen.getAllByText(templateLine("テスト"))).toHaveLength(
      EFFECT_MAX_CONCURRENT - 1,
    );
  });

  it("⚠⚠ 金額を持たない種別は `templateWithoutAmount` の文面で出る（実機確認⑧の経路）", async () => {
    // ⚠⚠ **061d-2 から持ち越した実機確認⑩（金額なしの経路）を 061h で消化する**ための機械側の担保。
    //   組み込み経路が消えたので、確認するのは**テンプレートの `templateWithoutAmount`**（`{message}`）側。
    //   ⚠ 文言を**この場で組み立てない**（`composeEventMessage` の文をそのまま差し込む）。
    await renderAssigned();
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

  // --- 061b-2 / 061h: テスト表示（main 窓 → localStorage の `<nonce>:<templateId>` → storage）---

  it("⚠ テスト表示で固定ダミーが出る（第三者データを使わない）", async () => {
    await renderAssigned();
    fireTestFrom();
    // ⚠ 中身は**この窓の固定ダミー**（localStorage に載るのは nonce と id だけ・§9）。
    expect(screen.getByText(templateLine("テスト"))).toBeInTheDocument();
  });

  it("⚠⚠ テスト表示は wire の templateId のものを出す（割り当ては引かない）", async () => {
    // ⚠⚠ **061h で挙動が変わったところ。** 061d-2 は `resolveEffectKind("superchat")` を引いていたので、
    //   「スーパーチャットに割り当てたもの」しか位置合わせできなかった。
    //   いまは**押した行のテンプレート**が出る（＝どのエフェクトの位置合わせかを選べる）。
    mocks.listEffectTemplates.mockResolvedValue([
      templateRecord(),
      templateRecord({
        id: TEMPLATE_ID2,
        name: "別の演出",
        text: {
          template: "べつの{name}",
          templateWithoutAmount: "{message}",
          anchor: "bottom",
          fontSize: 32,
        },
      }),
    ]);
    // superchat には TEMPLATE_ID を割り当てておく（＝引かれていたらこちらが出てしまう）。
    assignAllToTemplate(TEMPLATE_ID);
    await renderWarmed();

    fireTestFrom(TEMPLATE_ID2);
    // ⚠ 割り当てに無いテンプレートなので**先読みされていない**＝取り直しを待つ。
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText("べつのテスト")).toBeInTheDocument();
    expect(screen.queryByText(templateLine("テスト"))).toBeNull();
  });

  it("⚠⚠ 「エフェクトを出さない」ままでもテスト表示は出る（位置合わせは割り当てと独立）", async () => {
    // ⚠⚠ **061d-2 の「『出さない』設定でも組み込みで必ず出す」特例（穴 η）の後継。**
    //   あの特例は「割り当てを引く」実装だったから必要だった。061h は wire の id で出すので、
    //   **特例を 1 行も書かずに同じ要件（設定のせいで窓の位置が一生わからない状態を作らない）を満たす。**
    mocks.listEffectTemplates.mockResolvedValue([templateRecord()]);
    setAssignments({ superchat: { kind: "none" } });
    await renderWarmed();

    fireTestFrom();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText(templateLine("テスト"))).toBeInTheDocument();
  });

  it("⚠⚠ テスト表示の templateId が uuid の形でなければ何も出さない（§9・多層防御の 1 枚目）", async () => {
    // ⚠⚠ **061h で wire に id を載せた代わりに要る検証。** localStorage は**他窓から書ける**ので、
    //   ここを外すと細工された値がそのまま IPC まで運ばれる（実際には Rust の `is_template_id` も
    //   弾くが、2 層の 1 枚目としてここで止める）。
    // ⚠ 旧形式（nonce だけ）も id が取れないので発火しない＝ wire の互換は無い（意図した仕様）。
    // ⚠ **区切り `:` の無い素の uuid も発火しない**（wire の形を満たさない入口を増やさない）。
    //
    // ⚠⚠ **実測（061h のミューテーション⑤）: 「何も出ない」だけでは検証を外す変異が生存する。**
    //   形が壊れた id はどのみち `recordsRef` に載っていないので、検証を素通しにしても
    //   **画面には何も出ない**（描画側の照合が偶然カバーしてしまう）。
    //   ⚠ 検証の実効は「**その値を持って IPC を起こさない**」ことなので、そちらを観測する。
    const { container } = await renderAssigned();
    const listCallsAfterWarm = mocks.listEffectTemplates.mock.calls.length;

    for (const raw of [
      "1",
      "1:",
      "1:../../etc/passwd",
      "1:not-a-uuid",
      `1:${TEMPLATE_ID}/../x`,
      TEMPLATE_ID,
    ]) {
      fireTestRaw(raw);
    }
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.textContent).toBe("");
    // ⚠⚠ **検証を外す変異はこの 1 行がレッドにする**（細工された値で取り直しが走る）。
    expect(mocks.listEffectTemplates.mock.calls.length).toBe(listCallsAfterWarm);

    // ⚠ 形が正しければ出ることも同じケースで見る（検証ごと素通しにする変異と、
    //   何も出なくする変異の**両方**を殺すため）。
    fireTestFrom();
    expect(screen.getByText(templateLine("テスト"))).toBeInTheDocument();
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

  it("⚠ テスト表示を連打しても上限を超えない（固定 id でも取り違えない）", async () => {
    await renderAssigned();
    for (let i = 0; i < 10; i++) fireTestFrom(TEMPLATE_ID, String(i));
    expect(screen.getAllByTestId("effect-template").length).toBeLessThanOrEqual(
      EFFECT_MAX_CONCURRENT,
    );
  });

  // --- 061i（判断 4）: 保留旗（窓が停止中に押されたテスト表示） ------------------------------------
  //
  // ⚠⚠ **`storage` では渡せないから旗にした。** main 窓が「open を await → nonce を書く」と実装すると、
  //   `open_effect_overlay_window` の解決は**窓生成の完了**であって**この窓が `storage` リスナーを
  //   登録し終えたこと**ではないため、**登録前に飛んだぶんが消える**（押しても何も出ない）。
  //   ＝ `EFFECT_OVERLAY_GUIDE_PENDING_KEY` と同じワンショット旗で渡し、**マウント時に読む**。

  it("⚠⚠ 061i: マウント時に保留旗を読んで 1 回だけ発火し、旗を消す", async () => {
    mocks.listEffectTemplates.mockResolvedValue([templateRecord()]);
    localStorage.setItem(EFFECT_TEST_FIRE_PENDING_KEY, TEMPLATE_ID);

    const { unmount } = await renderWarmed();
    // ⚠ 材料が冷えていれば `fireTest` が待つ経路に入るので、解決を流し切ってから見る。
    await act(async () => {});
    expect(screen.getByText(templateLine("テスト"))).toBeInTheDocument();
    // ⚠⚠ **読んだら消す**（消さないと窓を開くたびに同じエフェクトが出る＝無操作で配信画面へ出る経路）。
    expect(localStorage.getItem(EFFECT_TEST_FIRE_PENDING_KEY)).toBeNull();

    // 窓を開き直しても（旗が立て直されていなければ）出ない。
    unmount();
    const { container } = await renderWarmed();
    await act(async () => {});
    expect(container.textContent).not.toContain("テスト");
  });

  it("⚠ 061i: 保留旗が無ければマウントだけでは何も出ない", async () => {
    mocks.listEffectTemplates.mockResolvedValue([templateRecord()]);
    const { container } = await renderWarmed();
    await act(async () => {});
    expect(container.textContent).not.toContain("テスト");
  });

  it("⚠⚠ 061i: 形の壊れた保留旗では発火せず、IPC も起こさない", async () => {
    // ⚠⚠ **061h の変異⑤が最初に生存した理由をここで塞ぐ。** 「何も出ない」だけを見ると、
    //   **形の壊れた id はどのみち `recordsRef` に載っていない**ので、検証を素通しにしても
    //   画面には何も出ない（描画側の照合が偶然カバーしてしまう）。
    //   ⚠ **検証の実効は「その値を持って IPC を起こさない」こと**なので、
    //   `list_effect_templates` の呼び出し回数が増えないことを見る。
    mocks.listEffectTemplates.mockResolvedValue([templateRecord()]);
    localStorage.setItem(EFFECT_TEST_FIRE_PENDING_KEY, "../../etc/passwd");

    const { container } = await renderWarmed();
    await act(async () => {});

    expect(container.textContent).not.toContain("テスト");
    // 先読み（`warmTemplates`）の 1 回だけ。⚠ 検証を外すと `fireTest` が取り直しに走って 2 回になる。
    expect(mocks.listEffectTemplates).toHaveBeenCalledTimes(1);
    expect(mocks.getEffectTemplateMedia).not.toHaveBeenCalled();
    // ⚠ 旗は消す（壊れた値を残すと、次に窓を開くたびに同じ判定を繰り返す）。
    expect(localStorage.getItem(EFFECT_TEST_FIRE_PENDING_KEY)).toBeNull();
  });

  it("⚠ 061i: 保留旗の経路でもセットアップ用ガイドは main 窓の旗に従う（この窓は勝手に出さない）", async () => {
    // ⚠ ガイドを出すかどうかの判断は main 窓（明示操作かどうかを知っているのはあちらだけ）。
    //   ⚠ 保留旗が立っていること自体をガイドの根拠にしない（＝旗を 2 つに分けている理由）。
    mocks.listEffectTemplates.mockResolvedValue([templateRecord()]);
    localStorage.setItem(EFFECT_TEST_FIRE_PENDING_KEY, TEMPLATE_ID);
    await renderWarmed();
    expect(screen.queryByText("StreamDock エフェクト")).toBeNull();
  });

  // --- 061i（判断 5）: テスト表示が「失敗の固着」を解除する ----------------------------------------

  it("⚠⚠ 061i: 一度 `failed` に載ったテンプレートが、テスト表示（`storage`）で再試行される", async () => {
    // ⚠⚠ **061h レビュー Q-1 への回答の片方。** `safeEffectMedia` に弾かれた／取得に失敗した id は
    //   `failed` に載り、**`warmTemplates`（割り当ての変更か窓のマウント）まで無音のまま**だった
    //   ＝ 壊れたテンプレートを**取り込み直してもアプリを再起動するまで復活しない**。
    //   ⚠ テスト表示の入口で解除するようにしたので、**明示操作で再試行できる**。
    mocks.listEffectTemplates.mockResolvedValue([templateRecord()]);
    mocks.getEffectTemplateMedia.mockRejectedValueOnce(new Error("failed"));
    assignAllToTemplate();
    await renderWarmed();

    // 先読みが失敗している＝この時点では本番の発火でも何も出ない（＝観測できない無音）。
    emitComments([superchat()]);
    expect(screen.queryByTestId("effect-template")).toBeNull();

    // ⚠ ここが本命。テスト表示で失敗記録が消え、取り直して出る。
    mocks.getEffectTemplateMedia.mockResolvedValue(PNG);
    fireTestFrom();
    await act(async () => {});
    await act(async () => {});
    expect(screen.getByText(templateLine("テスト"))).toBeInTheDocument();
  });

  it("⚠⚠ 061i: テスト表示は `missHandledRef` も解除する（本番の発火経路がもう一度取り直せる）", async () => {
    // ⚠⚠ **`failed` だけ消しても足りない。** 本番の発火（`fire`）はキャッシュミスの後始末を
    //   **1 id につき 1 回だけ**に絞っている（`missHandledRef`）ので、そこが立ったままだと
    //   **次の投げ銭では一覧の取り直しすら走らない**＝ 明示操作をしても本番経路は固着したままになる。
    // ⚠⚠ **観測点の選び方がこのケースの肝**（⚠ 最初に書いた版は**空振りしていた**——
    //   「テスト表示のあとに `get_effect_template_media` が増えること」を見ていたが、
    //   その増分は **`fireTest` 自身の取り直し**なので、解除を消しても緑のまま生存した。
    //   ＝ 061h の変異⑤と同型の罠を**自分でもう一度踏んだ**）。
    //   ⇒ **テスト表示が終わった時点で数え直し**、そのあとの**投げ銭**で
    //   `list_effect_templates` が増えるかを見る（＝本番経路の後始末が動いたかどうか）。
    // ⚠ 一覧に載っていない id（削除済み／一覧の取得が失敗した状態）を使うのは、
    //   `handleCacheMiss` の中で**一覧の取り直しが走る**＝ IPC として観測できる経路だから。
    mocks.listEffectTemplates.mockResolvedValue([]);
    assignAllToTemplate();
    await renderWarmed();

    emitComments([superchat()]); // → `handleCacheMiss` が 1 回だけ走る
    await act(async () => {});
    const callsAfterFirst = mocks.listEffectTemplates.mock.calls.length;
    // ⚠ 2 件目では走らない（`missHandledRef` が絞っている＝この仕組みが生きていることの確認。
    //   ここが増えると下の観測が「絞りが効いていないだけ」で通ってしまう）。
    emitComments([{ ...superchat(), id: "sc-2" }]);
    await act(async () => {});
    expect(mocks.listEffectTemplates.mock.calls.length).toBe(callsAfterFirst);

    // ⚠ 明示操作（テスト表示）。⚠ **この操作自身の取り直しを数えないよう、終わってから数え直す。**
    fireTestFrom();
    await act(async () => {});
    await act(async () => {});
    const callsAfterTest = mocks.listEffectTemplates.mock.calls.length;

    // ⚠ ここが本命: 解除されていれば、次の投げ銭で**もう一度**後始末（一覧の取り直し）が走る。
    emitComments([{ ...superchat(), id: "sc-3" }]);
    await act(async () => {});
    expect(mocks.listEffectTemplates.mock.calls.length).toBeGreaterThan(
      callsAfterTest,
    );
  });

  it("⚠⚠ 061i: 失敗の解除は**押した id だけ**（他の id は巻き添えにしない）", async () => {
    // ⚠ 061h は `clearFailures()`（全 id）を呼んでいた——`EffectMediaCache` に id 単位の解除が
    //   無かったため。061i で `markFailed` の対称形 `clearFailed(id)` を足し、その再修正トリガーを消化した。
    //   ⚠ 押していない id まで再挑戦させると、**壊れたテンプレートを割り当てているだけで
    //   投げ銭のたびに 6.7M 文字の IPC が走る**（`failed` を持つ理由そのもの）状態へ近づく。
    mocks.listEffectTemplates.mockResolvedValue([
      templateRecord(),
      templateRecord({ id: TEMPLATE_ID2, name: "別の演出" }),
    ]);
    mocks.getEffectTemplateMedia.mockRejectedValue(new Error("failed"));
    setAssignments({
      superchat: { kind: "template", templateId: TEMPLATE_ID },
      subscription: { kind: "template", templateId: TEMPLATE_ID2 },
    });
    await renderWarmed();
    mocks.getEffectTemplateMedia.mockClear();

    // TEMPLATE_ID だけテスト表示する。
    fireTestFrom(TEMPLATE_ID);
    await act(async () => {});
    await act(async () => {});

    const primed = mocks.getEffectTemplateMedia.mock.calls.map((c) => c[0]);
    expect(primed).toContain(TEMPLATE_ID);
    expect(primed).not.toContain(TEMPLATE_ID2);
  });

  // --- 061b-2: ガイドとの共存 --------------------------------------------------------------------

  it("⚠ エフェクトが出たらセットアップ用ガイドを畳む（960×360 で両方は読めない）", async () => {
    armGuide();
    await renderAssigned();
    expect(screen.getByText("StreamDock エフェクト")).toBeInTheDocument();

    fireTestFrom();
    expect(screen.queryByText("StreamDock エフェクト")).toBeNull();
    expect(screen.getByText(templateLine("テスト"))).toBeInTheDocument();
  });

  // --- 061d-2: テンプレートの描画・先読み・音・テスト発火の割り当て反映 --------------------------
  //
  // ⚠⚠ **この窓が第三者由来のバイト列を実際に踏むのは 061d-2 から**である
  // （061c は「経路ができた」まで、061d-1 は main 窓のプレビューが先に踏んだところまで）。
  // ここで固定するのは「踏んでも安全である根拠」そのもの＝
  //   ①`safeEffectMedia` を通っていること ②差し込み文面がテキストノードであること
  //   ③⚠⚠ **061h で反転**——失敗したら**その 1 件を出さない**こと（061d-2 は「必ず組み込みへ落ちる」）。

  it("⚠⚠ 割り当てたテンプレートが配信画面に出る", async () => {
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

  it("⚠⚠ `data:` 以外のメディアは 1 件も描かない（safeEffectMedia を通す・061h で反転）", async () => {
    mocks.listEffectTemplates.mockResolvedValue([templateRecord()]);
    mocks.getEffectTemplateMedia.mockResolvedValue({
      media: "javascript:alert(1)",
      sound: null,
    });
    setAssignments({
      superchat: { kind: "template", templateId: TEMPLATE_ID },
    });
    const { container } = await renderWarmed();

    emitComments([superchat()]);
    expect(screen.queryByTestId("effect-template")).toBeNull();
    // ⚠⚠ **061h: 組み込みへ落とさず「何も出さない」**（061d-2 はここで組み込み意匠が出ていた）。
    expect(container.textContent).toBe("");
  });

  it("⚠⚠ メディアのデコードに失敗したら、その 1 件を撤去する（061h で反転）", async () => {
    // ⚠⚠ **061d-2 は `{ ...e, template: null }` で組み込みへ落としていた**（「配信中に無反応にしない」）。
    //   061h は受け皿ごと廃止したので**消す**。⚠ 変異④（撤去しない＝出したままにする）はここがレッドにする。
    const { container } = await renderAssigned();

    emitComments([superchat()]);
    const img = container0().querySelector("img");
    if (img === null) throw new Error("テンプレートのメディアが描かれていない");
    act(() => {
      fireEvent.error(img);
    });
    expect(screen.queryByTestId("effect-template")).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("⚠⚠ `{name}` に HTML を入れても *テキストとして* 出る（第三者の自由入力）", async () => {
    const { container } = await renderAssigned();

    const evil = '<img src=x onerror=alert(1)>';
    emitComments([
      { ...superchat(), author: { id: "u9", name: evil } },
    ]);
    expect(screen.getByText(`${evil}さんが¥1,000`)).toBeInTheDocument();
    // ⚠ 要素になっていない＝ テンプレートのメディア 1 枚しか `<img>` が無い。
    expect(container.querySelectorAll("img")).toHaveLength(1);
  });

  it("⚠ text を持たないテンプレート（メディアだけ）でも描ける", async () => {
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

  it("⚠⚠ テンプレートは `durationMs` で消える（`EFFECT_DISPLAY_MS` より短くても長くても）", async () => {
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

  it("⚠⚠ 先読み前に発火したら、その 1 件は出さない（061h：穴 β 案 (c) の反転）", async () => {
    // ⚠⚠ **061d-2 はここで「組み込みで出し切る」ことを固定していた**（穴 β の案 (c)＝
    //   「配信中に何も出ないより素の表示でも出るほうがよい」）。061h はこれを反転している——
    //   組み込みという受け皿を廃止したうえで、「**頼んでいない演出が出る**ほうが害が大きい」
    //   「出ないことは main 窓の警告で見える」という判断（docs/progress.md の 061h 節）。
    // ⚠ 先読みを終わらせずに発火させる（`renderWarmed` を使わない）。
    armGuide();
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
    // ⚠⚠ **1 件も出ない**（061d-2 はここで組み込み意匠が出ていた）。
    expect(screen.queryByTestId("effect-template")).toBeNull();
    expect(screen.queryByText(templateLine(THIRD_PARTY_NAME))).toBeNull();
    // ⚠⚠ **出していない以上、セットアップ用ガイドも畳まない。**
    //   ⚠ これが `showEffect(request, null)` を戻す変異（＝何も描かない要素で枠を 1 つ食う）を
    //   殺す唯一の観測点である（DOM には何も出ないので、ガイドの生死でしか見分けられない）。
    expect(screen.getByText("StreamDock エフェクト")).toBeInTheDocument();

    // 温まったら次回からテンプレートで出る（＝「初回だけ出ない」で収束する）。
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
    // 一覧に載っていない id を割り当てておく（＝削除済みテンプレートを指す割り当て）。
    mocks.listEffectTemplates.mockResolvedValue([]);
    mocks.getEffectTemplateMedia.mockRejectedValue(new Error("gone"));
    setAssignments({
      superchat: { kind: "template", templateId: TEMPLATE_ID },
    });
    const { container } = await renderWarmed();
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
    // ⚠⚠ **061h: そして 1 件も出ていない**（061d-2 はここで「必ず組み込みで出ている」を
    //   固定していた＝実在しない id が「なし」へ倒れないことの担保だった）。
    //   ⚠ ユーザーがこれに気付ける場所は **main 窓の警告**（`EffectAssignmentCard` の `missing`）だけで、
    //   その 1 文が 061h の反転の前提になっている。
    expect(container.textContent).toBe("");
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
    setAssignments({ superchat: { kind: "none" } });
    const { container } = await renderWarmed();

    emitComments([superchat()]);
    expect(container.textContent).toBe("");
  });

  it("⚠ 割り当ては発火のたびに読み直す（main 窓で変えた直後の 1 件目から効く）", async () => {
    await renderAssigned();
    emitComments([superchat()]);
    expect(screen.getAllByTestId("effect-template")).toHaveLength(1);

    // ⚠ `storage` を撒かずに localStorage だけ書き換える＝**窓跨ぎ伝播に依存していない**ことの担保。
    setAssignments({ superchat: { kind: "none" } });
    emitComments([{ ...superchat(), id: "sc-2" }]);
    // ⚠ 2 件目は出ない（1 件目は表示時間が来るまで残っているので、件数で見る）。
    expect(screen.getAllByTestId("effect-template")).toHaveLength(1);
  });

  // --- 穴 ε: 音 ---------------------------------------------------------------------------------

  it("⚠ 音源を持つテンプレートでは `<audio>` を 1 本置く（配信に載る）", async () => {
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

  it("⚠ 音源を持たないテンプレートでは音を鳴らさない", async () => {
    // ⚠ 061h: 061d-2 の「組み込みのエフェクトでは音を鳴らさない」を、
    //   **音の無いテンプレート**で見る形へ置き換えた（組み込みの経路が消えたため）。
    await renderAssigned();
    emitComments([superchat()]);
    expect(screen.getByTestId("effect-template")).toBeInTheDocument();
    expect(screen.queryByTestId("effect-sound")).toBeNull();
  });

  it("⚠⚠ 音の無いテンプレートが後から出ても、鳴っている音は止めない（レビュー Q-10）", async () => {
    // ⚠ 仕様: 音を差し替えるのは**音源を持つテンプレートが出たときだけ**。
    //   音の無いものが後続で出たときに音を止めると、`EFFECT_MAX_CONCURRENT` を超えた瞬間に
    //   「まだ表示時間が残っているのに音だけ切れる」が起きる（音と映像を独立させる方針）。
    // ⚠ **画面から押し出された 1 件の音も、その 1 件の撤去タイマーまでは鳴り続ける**
    //   ——これは受容した挙動で、実装のコメントに理由と再修正トリガーを書いてある。
    // ⚠ 061h: 061d-2 は後続を**組み込み**で出していた（`subscription: {kind:"builtin-monetary"}`）。
    //   組み込みが消えたので、**音を持たない 2 本目のテンプレート**を後続に使う（不変条件は同じ）。
    // ⚠ テンプレートの表示時間はバースト窓（＝`EFFECT_DISPLAY_MS`）より長くしておく。
    //   でないと、下で窓を空けるために時計を進めた時点でテンプレート自身が撤去されてしまい、
    //   「押し出されたのに音が残る」ではなく「時間切れで消えた」を見ることになる。
    mocks.listEffectTemplates.mockResolvedValue([
      templateRecord({ hasSound: true, durationMs: 15_000 }),
      templateRecord({ id: TEMPLATE_ID2, name: "無音の演出" }),
    ]);
    mocks.getEffectTemplateMedia.mockImplementation(async (id: string) =>
      id === TEMPLATE_ID
        ? { media: PNG.media, sound: "data:audio/wav;base64,AAAA" }
        : PNG,
    );
    setAssignments({
      superchat: { kind: "template", templateId: TEMPLATE_ID },
      subscription: { kind: "template", templateId: TEMPLATE_ID2 },
    });
    await renderWarmed();
    vi.useFakeTimers();

    emitComments([superchat()]);
    expect(screen.getByTestId("effect-sound")).toBeInTheDocument();

    // ⚠ バースト窓を空ける（空けないと下の 3 件のうち 2 件しか発火せず、押し出しが起きない）。
    act(() => {
      vi.advanceTimersByTime(EFFECT_DISPLAY_MS + 100);
    });
    // 無音のテンプレートを `EFFECT_MAX_CONCURRENT` 件流して、音つきを画面から押し出す。
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
    // ⚠ 音つきの 1 本が押し出され、無音の 3 本だけが残っている。
    expect(screen.getAllByTestId("effect-template")).toHaveLength(
      EFFECT_MAX_CONCURRENT,
    );
    expect(screen.queryByText(templateLine(THIRD_PARTY_NAME))).toBeNull();
    // ⚠⚠ **音を止める変異（無音でも `setSound` を呼ぶ／押し出しで音を消す）はここがレッドにする。**
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

  // --- ⑧ / 061h: テスト表示 -----------------------------------------------------------------------

  it("⚠⚠ テスト表示は先読みされていないテンプレートでも 1 回目から出る（取り込み直後の位置合わせ）", async () => {
    // ⚠⚠ **061h で `fire()` と別経路にした理由そのもの。** `warmTemplates` が温めるのは
    //   **割り当てに出てくる id だけ**なので、取り込んだばかりのテンプレートは冷えている。
    //   本番の発火は「発火の瞬間に IPC を呼ばない」（実機確認⑧）ので諦めるが、
    //   **明示操作 1 回のテスト表示は待ってでも出す**——でないと「1 回目は何も出ず 2 回目から出る」になる。
    mocks.listEffectTemplates.mockResolvedValue([templateRecord()]);
    // 割り当ては空（＝先読みの対象が 1 件も無い）。
    await renderWarmed();
    expect(mocks.getEffectTemplateMedia).not.toHaveBeenCalled();

    fireTestFrom();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByTestId("effect-template")).toBeInTheDocument();
    expect(screen.getByText(templateLine("テスト"))).toBeInTheDocument();
  });

  it("⚠ テスト表示は存在しないテンプレートでは何も出さない（黙って落ちる）", async () => {
    // ⚠ 削除済みの id を指す合図が届いた場合（main 窓と窓のあいだで一覧がずれた等）。
    //   ⚠ この窓にエラー文言を出さないのは 061a 以来の規律（出せば OBS にそのまま映る）。
    mocks.listEffectTemplates.mockResolvedValue([]);
    const { container } = await renderWarmed();

    fireTestFrom(TEMPLATE_ID2);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.textContent).toBe("");
  });
});
