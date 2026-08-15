import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act, within } from "@testing-library/react";
import { ObsEffectsScreen } from "./ObsEffectsScreen";
import {
  EFFECT_ASSIGNMENTS_KEY,
  EFFECT_OVERLAY_ENABLED_KEY,
  STAGE_OVERLAY_ENABLED_KEY,
  EFFECT_OBS_AUTO_ADD_KEY,
  EFFECT_OVERLAY_GUIDE_PENDING_KEY,
  EFFECT_TEST_FIRE_KEY,
  EFFECT_TEST_FIRE_PENDING_KEY,
  STREAM_EVENT_ROUND_KEY,
  STREAM_EVENT_SELECTED_KEY,
} from "../../features/comment-viewer/overlaySettings";
// 型のみの import（コンパイル時に消えるので vi.hoisted / vi.mock の巻き上げと競合しない）。
// ⚠ 明示的に型を付けないと `vi.fn(async () => null)` の戻り値が `Promise<null>` に推論され、
// 検出できたケース（`mockResolvedValue({...})`）が typecheck で落ちる。
import type { ObsWsConfig } from "../../features/comment-viewer/obsApi";
import type { EffectTemplateRecord } from "../../features/obs-effects/bindings/EffectTemplateRecord";

/**
 * 061a: main 窓の「OBSエフェクト」画面の仕様テスト。
 *
 * あるべき挙動:
 * - ⚠⚠ **061i: 窓の open/close は「条件」と「明示操作」から起きる**（表示トグルは廃止）。
 *   **開くのは自動・閉じるのは明示**（判断 1）で、invoke するのは相変わらずこの画面だけ。
 * - ⚠⚠ **自動反映トグルは設定を立てるだけ**——窓を開かないし OBS へも繋がない（045c の規律。
 *   044a の旧実装は「自動反映 ON だけで窓が開く」隠れた副作用を持っており、045c が回帰として削除した）。
 *   この画面には WS が無いので構造としても破れないが、**将来ここへ open を足す退行**を止めるために固定する。
 * - ⚠⚠ **061p で前提ステータス（6 行）とその中のボタンが消えた。**
 *   ⇒ **窓の状態・条件の件数・開催中のイベントを DOM から観測する手段はもう無い**ので、
 *   これらの仕様は **localStorage のキーと invoke の呼ばれ方**で固定する（観測点の付け替え）。
 *   ⚠ **「表示が消えたから検査も消す」ではない**——挙動（自動 open・キューの直列化・派生値の
 *   書き手が 1 か所）は 1 ミリも変えていないので、**検査は同じ数だけ残っている**。
 * - ⚠ **コメビュ窓が閉じているときの前提案内だけは残っている**（`docs/security.md` §1 が
 *   要求する停止導線の main 窓側 1 か所）。⚠⚠ **061p で止め方が
 *   「コメントビューアを開いて取得を停止する」1 つになった**（「ウィンドウを閉じる」は廃止）。
 * - 準備中プレースホルダ（`ComingSoonScreen`）の文言が出ない。
 *   ⚠ 061p: 「配信イベント」タブは**同梱イベントが 0 本のとき自前の「準備中です」を出す**が、
 *   `ComingSoonScreen` の固有文言（「この機能は現在準備中です」「To be continued」）は使わない。
 *
 * ## ⚠⚠ 061p: 同梱レジストリを差し替えて検査する
 *
 * 開催の仕様（開始 → ステージ窓だけ開く／終了 → 窓を閉じない／期限切れの掃除）は
 * **同梱イベントが 0 本になっても仕様として生き続ける**ので、検査用イベントを 1 本注入する。
 * ⚠ **実データが 0 本＝実機ではタブに「準備中です」が出るだけ**であることは
 * `streamEventRegistry.test.ts` と `StreamEventTab.test.tsx` が固定している。
 *
 * 外部境界（Tauri invoke）は全てモックして隔離する。**テストは外部通信も OS 操作も一切行わない**。
 */

const mocks = vi.hoisted(() => ({
  openEffectOverlayWindow: vi.fn(async () => {}),
  closeEffectOverlayWindow: vi.fn(async () => {}),
  isEffectOverlayOpen: vi.fn(async () => false),
  // 061k: ステージ窓ぶん（**独立のキュー・独立の状態**であることを見る）。
  openStageOverlayWindow: vi.fn(async () => {}),
  closeStageOverlayWindow: vi.fn(async () => {}),
  isStageOverlayOpen: vi.fn(async () => false),
  isCommentViewerOpen: vi.fn(async () => false),
  openCommentViewerWindow: vi.fn(async () => {}),
  detectObsWebsocketConfig: vi.fn(async (): Promise<ObsWsConfig | null> => null),
  // ⚠ 061i: この画面は `useEffectTemplates`（＝テンプレート一覧の IPC）を持つ。
  //   061h までは条件を触るケースが無かったのでモックが要らなかったが、
  //   061i の本命（条件 → 窓）を見るには**一覧に実物が載っている**必要がある。
  listEffectTemplates: vi.fn(async (): Promise<EffectTemplateRecord[]> => []),
  importEffectTemplate: vi.fn(),
  getEffectTemplateMedia: vi.fn(),
  deleteEffectTemplate: vi.fn(async () => {}),
  /** 061p: 検査用の同梱イベント 1 本（実データは 0 本＝上のクラス JSDoc の 061p 節）。 */
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

vi.mock("../../features/obs-effects/effectTemplateApi", () => ({
  listEffectTemplates: mocks.listEffectTemplates,
  importEffectTemplate: mocks.importEffectTemplate,
  getEffectTemplateMedia: mocks.getEffectTemplateMedia,
  deleteEffectTemplate: mocks.deleteEffectTemplate,
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(async () => null) }));

// ⚠ モジュールを丸ごと差し替えるので、書かなかった export は undefined になる。この画面が踏まない
// ものも含めて実モジュールの export 面を埋める（将来この画面が直接 import し始めたときに
// 「値が静かに undefined」でテストが通ったまま壊れるのを防ぐ・既存テストと同じ方針）。
vi.mock("../../features/comment-viewer/windowApi", () => ({
  openEffectOverlayWindow: mocks.openEffectOverlayWindow,
  closeEffectOverlayWindow: mocks.closeEffectOverlayWindow,
  isEffectOverlayOpen: mocks.isEffectOverlayOpen,
  openStageOverlayWindow: mocks.openStageOverlayWindow,
  closeStageOverlayWindow: mocks.closeStageOverlayWindow,
  isStageOverlayOpen: mocks.isStageOverlayOpen,
  isCommentViewerOpen: mocks.isCommentViewerOpen,
  openCommentViewerWindow: mocks.openCommentViewerWindow,
  closeCommentViewerWindow: vi.fn(async () => {}),
  openCommentOverlayWindow: vi.fn(async () => {}),
  closeCommentOverlayWindow: vi.fn(async () => {}),
  isCommentOverlayOpen: vi.fn(async () => false),
  openPinnedOverlayWindow: vi.fn(async () => {}),
  closePinnedOverlayWindow: vi.fn(async () => {}),
  isPinnedOverlayOpen: vi.fn(async () => false),
}));

vi.mock("../../features/comment-viewer/obsApi", () => ({
  detectObsWebsocketConfig: mocks.detectObsWebsocketConfig,
  setObsWebsocketPassword: vi.fn(async () => {}),
  clearObsWebsocketPassword: vi.fn(async () => {}),
}));

const autoAddToggle = () =>
  screen.getByRole("switch", {
    name: "エフェクトのウィンドウを OBS へ自動で追加する",
  });
// ⚠ 061h: 「投げ銭でエフェクトを出す」トグルと「テスト表示」ボタンは**この画面から消えた**
//   （前者は組み込み演出の ON/OFF が本体で廃止／後者は `EffectTemplateCard` の各行へ移設）。
//   移設先のケースは `EffectTemplateCard.test.tsx` にある。
// ⚠⚠ 061i: 「エフェクトを配信画面に表示する」トグルも消えた（＝ヘルパごと削除した）。
//   窓を開く契機は「条件が 0 → 1 件」と「テスト表示」だけで、閉じる契機は明示のボタンだけ。

/** ⚠ 061i: 実物と同じ uuid の形（Rust の `Uuid::new_v4()` が採番するもの）。 */
const TEMPLATE_ID = "93c76e02-1111-4222-8333-444455556666";
const TEMPLATE_ID2 = "0f0e0d0c-1111-4222-8333-444455556666";

const record = (
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

/** 061i: 条件の `<select>`（イベント種別のラベルで引く）。 */
const conditionSelect = (label: string) =>
  screen.getByLabelText(`${label}のエフェクト`) as HTMLSelectElement;

/** 061k: 条件の**出力先**の `<select>`。 */
const outputSelect = (label: string) =>
  screen.getByLabelText(`${label}の出力先`) as HTMLSelectElement;

// ⚠⚠ **061p: `conditionStatus()` / `roundStatus()` / `windowStatus()` を削除した**
//   （「表示する条件」「開催中のイベント」「エフェクトのウィンドウ」の各行ごと画面から消えたため）。
//   ⇒ **観測点の付け替え**:
//     - 条件の件数 …… `EFFECT_OVERLAY_ENABLED_KEY` / `STAGE_OVERLAY_ENABLED_KEY`（派生値）と
//       `openEffectOverlayWindow` / `openStageOverlayWindow` の呼ばれ方
//     - 窓の状態 …… `is*OverlayOpen` の**呼ばれた回数**（ポーリングが回っていること）と、
//       ⚠⚠ **`EffectTemplateCard` の「配信画面でテスト表示」がどちらの経路へ倒れるか**
//       （＝停止中なら保留旗を書く／表示中なら `storage` を撒く。これが窓の状態の唯一の実用途）
//     - 開催中のイベント …… 「配信イベント」タブの中の表示（残り時間・終了ボタン）と開催キー

/** 061l: 検査用イベントの id（⚠ 注入したレジストリから引く＝id を 2 か所へ書かない）。 */
const EVENT_ID = mocks.event.id;

/** 061p: ポーリングが 1 周した（＝窓の状態が state に入った）ことを待つ。 */
const waitForStatusPoll = async () => {
  await waitFor(() =>
    expect(mocks.isEffectOverlayOpen.mock.calls.length).toBeGreaterThan(0),
  );
  await act(async () => {});
};

describe("061a: ObsEffectsScreen", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mocks.isEffectOverlayOpen.mockResolvedValue(false);
    mocks.isStageOverlayOpen.mockResolvedValue(false);
    mocks.isCommentViewerOpen.mockResolvedValue(false);
    mocks.detectObsWebsocketConfig.mockResolvedValue(null);
    mocks.listEffectTemplates.mockResolvedValue([]);
    mocks.deleteEffectTemplate.mockResolvedValue(undefined);
  });

  afterEach(() => {
    // ⚠ 061a レビュー（Q-9）: 旧コメントは「アンマウントで clearInterval される実装の裏取りも兼ねる」と
    // 書いていたが、`useRealTimers()` はそれを一切検証していなかった（コメントと実態の乖離）。
    // 裏取りは下の「アンマウントでポーリングが止まる」ケースが担う。ここは後片付けだけ。
    vi.useRealTimers();
  });

  it("準備中プレースホルダではなく実画面が出る", async () => {
    const { container } = render(<ObsEffectsScreen />);
    expect(screen.getByRole("heading", { name: "OBSエフェクト" })).toBeInTheDocument();
    // ⚠ 061i: 「配信イベント」タブに「準備中です」が入ったので、`/準備中/` の否定では
    //   `ComingSoonScreen` の不在を言えなくなった。**あの画面固有の文**で見る。
    expect(container.textContent).not.toContain("この機能は現在準備中です");
    expect(container.textContent).not.toContain("To be continued");
    expect(autoAddToggle()).toBeInTheDocument();
  });

  it("⚠ 061i: 残っているトグルは自動反映の 1 つだけで、既定は OFF", () => {
    render(<ObsEffectsScreen />);
    expect(screen.getAllByRole("switch")).toHaveLength(1);
    expect(autoAddToggle()).toHaveAttribute("aria-checked", "false");
  });

  // --- 061i: タブ ------------------------------------------------------------------------------

  it("⚠ 061i: タブが 2 枚あり、既定は「コメントで出すエフェクト」", async () => {
    render(<ObsEffectsScreen />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual([
      "コメントで出すエフェクト",
      "配信イベント",
    ]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    // 既定タブの中身＝条件とインポートの 2 カード。
    // ⚠⚠ **061p で並びを反転した**（条件が先・インポートが最後）ので、**順序も固定する**
    //   ——指示は「インポートのカードは一番下」なので、戻す変異をここで殺す。
    const headings = screen
      .getAllByRole("heading", { level: 3 })
      .map((h) => h.textContent);
    expect(headings.slice(0, 2)).toEqual([
      "エフェクトを表示する条件",
      "エフェクトのインポート",
    ]);
    // ⚠ 061p: 旧名（「エフェクトのテンプレート」）は戻ってこない。
    expect(
      screen.queryByRole("heading", { name: "エフェクトのテンプレート" }),
    ).toBeNull();
  });

  it("⚠⚠ 061p: 「配信イベント」タブは準備中（同梱イベントが 0 本のときの見え方）", async () => {
    // ⚠⚠ **061p の指示＝見本「みんなでコメントカウント」は要らない**（ユーザーが使えるものだと
    //   誤解する）。⇒ **レジストリを空にし、タブは「準備中です」だけを出す**。
    // ⚠ ここは**注入したレジストリ（1 本）ではなく実データの見え方**を見たいので、
    //   `STREAM_EVENT_REGISTRY` の中身に依存しない形で
    //   **`StreamEventTab` が空のときに出す文言**を `StreamEventTab.test.tsx` が固定している。
    //   ⇒ このケースでは「**廃止した見本の名前が戻ってこない**」ことだけを固定する。
    const { container } = render(<ObsEffectsScreen />);
    fireEvent.click(screen.getByRole("tab", { name: "配信イベント" }));

    expect(container.textContent).not.toContain("みんなでコメントカウント");
    // ⚠ `ComingSoonScreen`（画面まるごと用のダミーページ）は流用しない。
    expect(container.textContent).not.toContain("この機能は現在準備中です");
    expect(container.textContent).not.toContain("To be continued");
    // ⚠ タブを切り替えるとコメント側のカードは出ない（＝本当に入れ替わっている）。
    expect(
      screen.queryByRole("heading", { name: "エフェクトを表示する条件" }),
    ).toBeNull();
  });

  it("⚠⚠ 061i: 「OBS へ自動で反映」は**両タブの外**にある", async () => {
    // ⚠ どちらのタブで使うエフェクトも**同じ窓・同じ OBS ソース**に出るため
    //   （タブの中へ入れると「タブごとに別の窓がある」と読める）。
    // ⚠⚠ **061p: 一緒に共通領域へ置いていた前提ステータス 6 行と、
    //   「配信画面に表示」カードは削除した**（下の「061p: 消えたもの」の節が固定する）。
    render(<ObsEffectsScreen />);
    fireEvent.click(screen.getByRole("tab", { name: "配信イベント" }));

    expect(autoAddToggle()).toBeInTheDocument();
  });

  // --- ⚠⚠⚠ 061p: 消えたものが戻ってこないこと -------------------------------------------------

  it("⚠⚠ 061p: 前提ステータスの 6 行が 1 つも出ない（情報過多の解消そのものが仕様）", async () => {
    // ⚠⚠ **指示＝「表示する条件などのステータスは全ていらない。情報が増えて UX が下がる」。**
    //   ⚠ 親切心で 1 行ずつ戻すと元の 6 行に戻るので、**まとめて固定する**。
    mocks.isEffectOverlayOpen.mockResolvedValue(true);
    mocks.isStageOverlayOpen.mockResolvedValue(true);
    mocks.isCommentViewerOpen.mockResolvedValue(true);
    mocks.detectObsWebsocketConfig.mockResolvedValue({
      enabled: true,
      port: 4455,
      authRequired: false,
    });
    const { container } = render(<ObsEffectsScreen />);
    await waitForStatusPoll();

    for (const label of [
      "表示する条件",
      "エフェクトのウィンドウ（小さく（画面のすみ））",
      "エフェクトのウィンドウ（大きく（画面全体））",
      "開催中のイベント",
      "コメントビューア",
      "OBS の WebSocket",
    ]) {
      expect(screen.queryByText(label)).toBeNull();
    }
    // ⚠ 値の側（「表示中」「開いています」「有効（ポート 4455）」）も出ない。
    expect(container.textContent).not.toContain("表示中");
    expect(container.textContent).not.toContain("開いています");
    expect(container.textContent).not.toContain("有効（ポート");
  });

  it("⚠⚠⚠ 061p: 「ウィンドウを閉じる」「ウィンドウを開く」がどこにも無い（§1 の停止導線を改訂した）", async () => {
    // ⚠⚠⚠ **`docs/security.md` §1 の 061p 追補と対になる検査。**
    //   このボタンは §1 が名指ししていた停止導線だったので、**消すこと自体が方針変更**である。
    //   ⇒ 止め方は「コメントビューアを開いて取得を停止する」1 つになった（下の前提案内の節）。
    //   ⚠ **帰結＝アプリ内からエフェクトの出力窓を閉じる手段は無い**（`close*` の invoke が 0 件）。
    mocks.isEffectOverlayOpen.mockResolvedValue(true);
    mocks.isStageOverlayOpen.mockResolvedValue(true);
    localStorage.setItem(
      EFFECT_ASSIGNMENTS_KEY,
      JSON.stringify({ superchat: { kind: "template", templateId: TEMPLATE_ID } }),
    );
    mocks.listEffectTemplates.mockResolvedValue([record()]);
    const { container } = render(<ObsEffectsScreen />);
    await waitForStatusPoll();

    expect(container.textContent).not.toContain("ウィンドウを閉じる");
    expect(container.textContent).not.toContain("ウィンドウを開く");
    expect(mocks.closeEffectOverlayWindow).not.toHaveBeenCalled();
    expect(mocks.closeStageOverlayWindow).not.toHaveBeenCalled();
  });

  it("⚠ 061p: 「配信画面に表示」カードが無く、窓名の案内だけが残っている", async () => {
    // ⚠ 指示＝「説明だけのカードは要らない（削除忘れでは？）」。
    // ⚠⚠ **窓名は残す**——OBS で手動追加する人は**この文字列でウィンドウ一覧を探す**ので、
    //   カードごと消すと探せなくなる（061k が実機で踏んだ言い落としと同じ穴）。
    render(<ObsEffectsScreen />);
    expect(
      screen.queryByRole("heading", { name: "配信画面に表示" }),
    ).toBeNull();
    expect(
      screen.getByText(/「StreamDock エフェクト」と「StreamDock ステージ演出」/),
    ).toBeInTheDocument();
  });

  it("⚠ 061p: OBS の WebSocket 設定を検出しに行かない（表示先が無くなったため）", async () => {
    // ⚠ 帰結＝ OBS 側で WebSocket が無効でも**この画面では気づけない**（受容）。
    //   ⚠ 同じ検出はコメビュ窓の設定が持っており、あちらは無改変。
    render(<ObsEffectsScreen />);
    await waitForStatusPoll();
    expect(mocks.detectObsWebsocketConfig).not.toHaveBeenCalled();
  });

  it("⚠⚠ 061i: 「エフェクトを配信画面に表示する」トグルが戻ってこない", () => {
    // ⚠⚠ **二度手間の解消そのものが仕様**（条件を設定した時点で「出したい」ことは自明）。
    //   ⚠ 061h が軸を 3 つ → 2 つにし、061i が 2 つ → 1 つ（自動反映のみ）にした。
    const { container } = render(<ObsEffectsScreen />);
    expect(
      screen.queryByRole("switch", { name: "エフェクトを配信画面に表示する" }),
    ).toBeNull();
    expect(container.textContent).not.toContain("エフェクトを配信画面に表示する");
  });

  // --- 061h: 廃止したものが戻ってこないこと ------------------------------------------------------

  it("⚠⚠ 061h: 「投げ銭でエフェクトを出す」トグルがこの画面に無い", () => {
    // ⚠⚠ **あのトグルの本体は組み込み演出（「〇〇さんが ¥1,000」）の ON/OFF だった**ので、
    //   組み込みを廃止した 061h で意味が無くなった。⚠ さらに実機で UX が破綻していた最大の原因が
    //   「ON/OFF の軸が 3 つ（表示・投げ銭・割り当て）に割れ、どれか 1 つ忘れると黙って何も出ない」
    //   だったので、**軸を戻さない**こと自体が仕様である（表示トグルの削除は 061i）。
    const { container } = render(<ObsEffectsScreen />);
    expect(
      screen.queryByRole("switch", { name: "投げ銭でエフェクトを出す" }),
    ).toBeNull();
    expect(container.textContent).not.toContain("投げ銭でエフェクトを出す");
  });

  it("⚠ 061h: 「テスト表示」はこの画面ではなくテンプレート行にある", () => {
    // ⚠ 移設の理由＝「**どのエフェクトの位置合わせをしているのか**」を選べないのが旧設計の弱点だった。
    //   移設先の仕様（wire・停止中の注記）は `EffectTemplateCard.test.tsx` が固定する。
    render(<ObsEffectsScreen />);
    expect(screen.queryByRole("button", { name: "テスト表示" })).toBeNull();
  });

  // --- 061i（判断 1・2）: 条件が窓を開く / 明示操作だけが閉じる -----------------------------------

  it("⚠⚠ 061i: 条件を 0 → 1 件にすると窓が開き、フラグが true になる（トグルの代わり）", async () => {
    // ⚠⚠ **これが 061i の中心。** 「条件を設定した時点で配信画面に出したいことは自明」なので、
    //   別のトグルを ON にさせない。⚠ **061h で既定が「出さない」になったから成立する**
    //   （既定が組み込みのままだと「条件が 1 つでも有効」が常に真になる）。
    mocks.listEffectTemplates.mockResolvedValue([record()]);
    render(<ObsEffectsScreen />);
    await screen.findAllByText("きらきら演出"); // ⚠ 一覧と `<option>` の 2 か所に出る
    // ⚠ 061p: 「表示する条件」行は消えたので、件数は**派生値**で見る（0 件＝キーが無い）。
    expect(localStorage.getItem(EFFECT_OVERLAY_ENABLED_KEY)).toBeNull();

    fireEvent.change(conditionSelect("スーパーチャット・ビッツ"), {
      target: { value: `template:${TEMPLATE_ID}` },
    });

    await waitFor(() =>
      expect(mocks.openEffectOverlayWindow).toHaveBeenCalledTimes(1),
    );
    expect(localStorage.getItem(EFFECT_OVERLAY_ENABLED_KEY)).toBe("true");
    expect(mocks.closeEffectOverlayWindow).not.toHaveBeenCalled();
  });

  // --- 061k: 出力先ごとの窓 -----------------------------------------------------------------------

  it("⚠⚠ 新規 5: stage 条件を 0 → 1 件にすると **stage のキーが true・stage 窓が開く**", async () => {
    mocks.listEffectTemplates.mockResolvedValue([record()]);
    render(<ObsEffectsScreen />);
    await screen.findAllByText("きらきら演出");

    // ⚠ まず出力先を「全画面」へ（この時点では `effect` が none なので `<select>` は無効）。
    //   ⇒ **先にエフェクトを選び、それから出力先を変える**（実際のユーザー操作と同じ順）。
    fireEvent.change(conditionSelect("スーパーチャット・ビッツ"), {
      target: { value: `template:${TEMPLATE_ID}` },
    });
    await waitFor(() =>
      expect(mocks.openEffectOverlayWindow).toHaveBeenCalledTimes(1),
    );
    fireEvent.change(outputSelect("スーパーチャット・ビッツ"), {
      target: { value: "stage" },
    });

    await waitFor(() =>
      expect(mocks.openStageOverlayWindow).toHaveBeenCalledTimes(1),
    );
    expect(localStorage.getItem(STAGE_OVERLAY_ENABLED_KEY)).toBe("true");
    // ⚠⚠ **コーナー側は「もう条件が無い」ので false へ倒れる**（＝OBS のソースが非表示になる）。
    //   ⚠ ただし**窓は閉じない**（判断 1）。
    expect(localStorage.getItem(EFFECT_OVERLAY_ENABLED_KEY)).toBe("false");
    expect(mocks.closeEffectOverlayWindow).not.toHaveBeenCalled();
    // ⚠ open は 1 回ずつ（コーナーを重ねて開かない）。
    expect(mocks.openEffectOverlayWindow).toHaveBeenCalledTimes(1);
  });

  it("⚠⚠ 新規 6: corner 条件だけのとき **stage 窓は開かない**（開いたのに何も出ない窓を作らない）", async () => {
    mocks.listEffectTemplates.mockResolvedValue([record()]);
    render(<ObsEffectsScreen />);
    await screen.findAllByText("きらきら演出");

    fireEvent.change(conditionSelect("スーパーチャット・ビッツ"), {
      target: { value: `template:${TEMPLATE_ID}` },
    });

    await waitFor(() =>
      expect(mocks.openEffectOverlayWindow).toHaveBeenCalledTimes(1),
    );
    // ⚠⚠ **本命**: 合計で判定する実装だとここが 1 になる。
    expect(mocks.openStageOverlayWindow).not.toHaveBeenCalled();
    expect(localStorage.getItem(STAGE_OVERLAY_ENABLED_KEY)).toBe("false");
  });

  it("⚠⚠ 新規 11: 開閉キューは窓ごとに独立（corner の close 中に stage の open が待たされない）", async () => {
    // ⚠⚠ **1 本のキューに混ぜるとここが落ちる**（061i がキューを作った理由は
    //   「**同じ窓**への close と open の順序」であって、別の窓を直列化する理由は無い）。
    // ⚠⚠ **061p で駆動が変わった**——「コーナー窓の close を止めておく」ができなくなった
    //   （「ウィンドウを閉じる」を削除したため）ので、**コーナー窓の open を止めて**同じ性質を見る。
    //   ⚠ 見たい不変条件は変わっていない＝**片方の窓の滞留が、もう片方の窓の要求を待たせない**。
    let releaseCornerOpen = () => {};
    mocks.openEffectOverlayWindow.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseCornerOpen = resolve;
        }),
    );
    mocks.listEffectTemplates.mockResolvedValue([record()]);
    render(<ObsEffectsScreen />);
    await screen.findAllByText("きらきら演出");

    // コーナー条件を 0 → 1 件（＝コーナー窓の open。この Promise は解決させないまま止めておく）。
    fireEvent.change(conditionSelect("スーパーチャット・ビッツ"), {
      target: { value: `template:${TEMPLATE_ID}` },
    });
    await waitFor(() =>
      expect(mocks.openEffectOverlayWindow).toHaveBeenCalledTimes(1),
    );

    // その最中に別の条件を stage 出力で作る＝ステージ窓の open が投げられる。
    fireEvent.change(conditionSelect("メンバーシップ"), {
      target: { value: `template:${TEMPLATE_ID}` },
    });
    fireEvent.change(outputSelect("メンバーシップ"), {
      target: { value: "stage" },
    });

    // ⚠⚠ **コーナーの open が止まったままでも stage の open は届く**（＝キューが別）。
    await waitFor(() =>
      expect(mocks.openStageOverlayWindow).toHaveBeenCalledTimes(1),
    );
    releaseCornerOpen();
  });

  it("⚠⚠ 061i: 1 件以上のまま別の条件を変えても open を重ねて投げない", async () => {
    // ⚠ 無駄な invoke を出さない（Rust 側は既存窓を再利用するので実害は無いが、
    //   「割り当てを触るたびに IPC が飛ぶ」のは 061c 申し送り 6 と同じ向きの規律に反する）。
    mocks.listEffectTemplates.mockResolvedValue([
      record(),
      record({ id: TEMPLATE_ID2, name: "別の演出" }),
    ]);
    render(<ObsEffectsScreen />);
    await screen.findAllByText("きらきら演出"); // ⚠ 一覧と `<option>` の 2 か所に出る

    fireEvent.change(conditionSelect("スーパーチャット・ビッツ"), {
      target: { value: `template:${TEMPLATE_ID}` },
    });
    await waitFor(() =>
      expect(mocks.openEffectOverlayWindow).toHaveBeenCalledTimes(1),
    );

    // 2 件目の条件を足す／1 件目を別のテンプレートに変える——どちらも「0 → 1」ではない。
    fireEvent.change(conditionSelect("メンバーシップ"), {
      target: { value: `template:${TEMPLATE_ID2}` },
    });
    fireEvent.change(conditionSelect("スーパーチャット・ビッツ"), {
      target: { value: `template:${TEMPLATE_ID2}` },
    });
    await act(async () => {});

    expect(mocks.openEffectOverlayWindow).toHaveBeenCalledTimes(1);
  });

  it("⚠⚠ 061i: 条件を全部「出さない」に戻すとフラグが false になる（窓は閉じない）", async () => {
    // ⚠⚠ **意図した新しい挙動**——フラグが false になると `CommentViewerApp` の既存分岐が
    //   `hideObs("effects")` を送って **OBS 側のソースが非表示**になる。
    // ⚠⚠ **窓は閉じない**（判断 1）。配信中に窓が消えると OBS のウィンドウキャプチャが
    //   真っ黒になり、配信者は原因に気づけない（親 046 の規律）。
    mocks.listEffectTemplates.mockResolvedValue([record()]);
    render(<ObsEffectsScreen />);
    await screen.findAllByText("きらきら演出"); // ⚠ 一覧と `<option>` の 2 か所に出る

    fireEvent.change(conditionSelect("スーパーチャット・ビッツ"), {
      target: { value: `template:${TEMPLATE_ID}` },
    });
    await waitFor(() =>
      expect(localStorage.getItem(EFFECT_OVERLAY_ENABLED_KEY)).toBe("true"),
    );

    fireEvent.change(conditionSelect("スーパーチャット・ビッツ"), {
      target: { value: "none" },
    });
    await act(async () => {});

    expect(localStorage.getItem(EFFECT_OVERLAY_ENABLED_KEY)).toBe("false");
    expect(mocks.closeEffectOverlayWindow).not.toHaveBeenCalled();
  });

  it("⚠⚠ 061i: テンプレート削除で条件が 0 件になったときもフラグが false になる", async () => {
    // ⚠⚠ **派生値の書き手を 1 か所に閉じたことの担保**（判断 2）。この経路
    //   （`clearEffectAssignmentsForTemplate`）は**最も忘れやすい 3 本目**で、漏らすと
    //   「最後のテンプレートを消したのにフラグが true のまま」＝ 条件が 0 件なのに OBS へ映り続ける。
    mocks.listEffectTemplates.mockResolvedValue([record()]);
    render(<ObsEffectsScreen />);
    await screen.findAllByText("きらきら演出"); // ⚠ 一覧と `<option>` の 2 か所に出る
    fireEvent.change(conditionSelect("スーパーチャット・ビッツ"), {
      target: { value: `template:${TEMPLATE_ID}` },
    });
    await waitFor(() =>
      expect(localStorage.getItem(EFFECT_OVERLAY_ENABLED_KEY)).toBe("true"),
    );

    // 削除後は一覧が空になる（＝条件も「表示しない」へ戻る）。
    mocks.listEffectTemplates.mockResolvedValue([]);
    fireEvent.click(screen.getByRole("button", { name: "削除" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "削除" }),
    );

    await waitFor(() =>
      expect(localStorage.getItem(EFFECT_OVERLAY_ENABLED_KEY)).toBe("false"),
    );
    // ⚠ 窓は閉じない（判断 1）。
    expect(mocks.closeEffectOverlayWindow).not.toHaveBeenCalled();
  });

  // ⚠⚠⚠ **061p: 「ウィンドウを閉じる」の 2 ケースを削除した**
  //   （①押しても派生値を触らない ②停止中には出さない）。**ボタンごと廃止したため。**
  //   ⚠ ①が守っていた「**設定と窓を混ぜない**」（判断 1）は、いまや窓を閉じる経路が
  //   1 つも無いので**構造的に成立している**（`close*` が呼ばれないことは上の 061p の節が固定）。
  //   ⚠ 復活させるときは `git show` でこの 2 ケースごと戻すこと。

  // --- 061i レビュー対応: 移行（S-3）と「ウィンドウを開く」（Q-2） ---------------------------------

  it("⚠⚠ 061i レビュー S-3: 条件があるのにフラグが false なら、マウント時に true へ直す（窓は開かない）", async () => {
    // ⚠⚠ **061h で「条件だけ設定して表示トグルは OFF のまま」だった人＝061i が救おうとしている
    //   当のユーザー**が、この状態でアップグレードしてくる。放置すると
    //   ①起動時復元が走らず窓が開かない ②条件を編集しても `hadConditions` が既に true なので
    //   open は投げられず、**フラグだけ true になって OBS ソースが有効化される**（窓が無いので真っ黒）。
    // ⚠ **窓は開かない**こと（開くと「閉じたのに画面を開き直すたび復活する」＝判断 1 の脱出路が潰れる）。
    localStorage.setItem(
      EFFECT_ASSIGNMENTS_KEY,
      JSON.stringify({ superchat: { kind: "template", templateId: TEMPLATE_ID } }),
    );
    localStorage.setItem(EFFECT_OVERLAY_ENABLED_KEY, "false");
    mocks.listEffectTemplates.mockResolvedValue([record()]);

    render(<ObsEffectsScreen />);
    await waitFor(() =>
      expect(localStorage.getItem(EFFECT_OVERLAY_ENABLED_KEY)).toBe("true"),
    );
    expect(mocks.openEffectOverlayWindow).not.toHaveBeenCalled();
    expect(mocks.closeEffectOverlayWindow).not.toHaveBeenCalled();
  });

  it("⚠⚠ 061i レビュー S-3: 条件が 0 件なのにフラグが true なら、マウント時に false へ倒す", async () => {
    // ⚠⚠ **061h で表示トグルを ON にしていた人**がこの状態で来る。放置すると毎起動で空の窓が開き、
    //   「ウィンドウを閉じる」はフラグを触らない（判断 1）ので**次回起動でまた開く**＝
    //   恒久的に止める手段が実質無い。
    localStorage.setItem(EFFECT_OVERLAY_ENABLED_KEY, "true");

    render(<ObsEffectsScreen />);
    await waitFor(() =>
      expect(localStorage.getItem(EFFECT_OVERLAY_ENABLED_KEY)).toBe("false"),
    );
    // ⚠ 窓は閉じない（判断 1・自動 close は作らない）。
    expect(mocks.closeEffectOverlayWindow).not.toHaveBeenCalled();
  });

  it("⚠ 061i レビュー S-3: 値が実態と一致していれば書かない（無駄な `storage` を撒かない）", async () => {
    // ⚠ 同値でも書くと、コメビュ窓へ `storage` が飛んで `enableObs` / `hideObs` が走る。
    //   ⚠ 未保存（キー無し）は false 扱いなので、条件 0 件の初回訪問では**キーが生えないこと**が期待。
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    render(<ObsEffectsScreen />);
    await waitForStatusPoll();

    expect(localStorage.getItem(EFFECT_OVERLAY_ENABLED_KEY)).toBeNull();
    expect(
      setItem.mock.calls.filter((c) => c[0] === EFFECT_OVERLAY_ENABLED_KEY),
    ).toEqual([]);
    setItem.mockRestore();
  });

  // ⚠⚠ **061p: 「ウィンドウを開く」の 2 ケースを削除した**（ボタンごと廃止）。
  //   ⚠⚠ **061i レビュー Q-2 の非対称は「両方無い」で解消した**——閉じる手段も開く手段も
  //   画面から消えたので、**窓を開き直す導線は「配信画面でテスト表示」とアプリ再起動だけ**である。
  //   ⚠ 前者の仕様は `EffectTemplateCard.test.tsx`、後者は `effectOverlayRestore` が持つ。

  it("⚠⚠ 061i レビュー S-4: 自動 open の直後は窓を楽観的に「開いている」扱いにする", async () => {
    // ⚠⚠ **旗の残骸を防ぐための楽観更新。** ポーリングは 2 秒間隔なので、素のままだと
    //   自動 open の直後もしばらく「停止中」のままである。その隙間に「配信画面でテスト表示」を押すと
    //   `EffectTemplateCard` が**旗経路**へ倒れるが、既存窓は `show()` されるだけで
    //   **再マウントしない**＝旗を読み直さないので、保留旗とガイド旗が**消えない残骸**になる
    //   （次に窓が開いた瞬間＝再起動時の復元で、無操作でエフェクトが出てガイドが OBS へ映る）。
    // ⚠⚠ **061p で観測点を付け替えた**——「表示中」という文字は画面から消えたので、
    //   **この state の唯一の実用途である「テスト表示がどちらの経路へ倒れるか」**を直接見る。
    //   ⇒ 楽観更新が無いとコーナーの**保留旗が書かれてしまう**（＝残骸）。
    // ⚠ close 側は楽観更新しない（061p 現在、close の経路自体が無い）。
    mocks.listEffectTemplates.mockResolvedValue([record()]);
    // ⚠ ステージ窓は開いている扱いにして、コーナー側の分岐だけを見る。
    mocks.isStageOverlayOpen.mockResolvedValue(true);
    // ⚠ open を解決させない＝「invoke は投げたが実態はまだ分からない」状態を作る。
    mocks.openEffectOverlayWindow.mockImplementation(() => new Promise(() => {}));
    render(<ObsEffectsScreen />);
    await screen.findAllByText("きらきら演出"); // ⚠ 一覧と `<option>` の 2 か所に出る
    await waitForStatusPoll();

    fireEvent.change(conditionSelect("スーパーチャット・ビッツ"), {
      target: { value: `template:${TEMPLATE_ID}` },
    });
    await waitFor(() =>
      expect(mocks.openEffectOverlayWindow).toHaveBeenCalledTimes(1),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "配信画面でテスト表示" }),
    );

    // ⚠⚠ **本命**: 保留旗もガイド旗も書かれない（＝`storage` 経路へ倒れた）。
    expect(localStorage.getItem(EFFECT_TEST_FIRE_PENDING_KEY)).toBeNull();
    expect(localStorage.getItem(EFFECT_OVERLAY_GUIDE_PENDING_KEY)).toBeNull();
    expect(localStorage.getItem(EFFECT_TEST_FIRE_KEY)).not.toBeNull();
    // ⚠ 窓を開き直す invoke も増えない（既に「開いている」と見なしているため）。
    expect(mocks.openEffectOverlayWindow).toHaveBeenCalledTimes(1);
  });

  it("⚠⚠ 061p: 窓の状態のポーリングは残っている（表示はしないが、テスト表示の経路分岐に要る）", async () => {
    // ⚠⚠ **前提ステータスを消したときに一緒に消しやすい**——消すと `effectWindowOpen` が
    //   `null` のままになり、`EffectTemplateCard` が**常に `storage` 経路へ倒れる**＝
    //   停止中の窓では「押しても何も出ない」（061h までの挙動）へ静かに退行する。
    mocks.isEffectOverlayOpen.mockResolvedValue(false);
    mocks.isStageOverlayOpen.mockResolvedValue(false);
    mocks.listEffectTemplates.mockResolvedValue([record()]);
    render(<ObsEffectsScreen />);
    await screen.findAllByText("きらきら演出");
    await waitForStatusPoll();

    fireEvent.click(
      screen.getByRole("button", { name: "配信画面でテスト表示" }),
    );

    // ⚠ 2 窓とも停止中なので、**旗経路**（保留旗＋ガイド旗＋窓を開く）へ倒れる。
    expect(localStorage.getItem(EFFECT_TEST_FIRE_PENDING_KEY)).toBe(TEMPLATE_ID);
    expect(localStorage.getItem(EFFECT_OVERLAY_GUIDE_PENDING_KEY)).toBe("true");
    await waitFor(() =>
      expect(mocks.openEffectOverlayWindow).toHaveBeenCalledTimes(1),
    );
    expect(mocks.openStageOverlayWindow).toHaveBeenCalledTimes(1);
  });

  it("⚠ 自動反映トグルは設定を立てるだけ（窓を開かない・045c の規律）", async () => {
    render(<ObsEffectsScreen />);
    fireEvent.click(autoAddToggle());

    expect(localStorage.getItem(EFFECT_OBS_AUTO_ADD_KEY)).toBe("true");
    // ⚠ ここが本命。044a の旧実装は「自動反映 ON だけで窓が開く」隠れた副作用を持っていた。
    expect(mocks.openEffectOverlayWindow).not.toHaveBeenCalled();
    expect(mocks.closeEffectOverlayWindow).not.toHaveBeenCalled();
    // ⚠⚠ 061i: **派生値も巻き添えで動かない**（2 つの設定は独立。あのフラグの書き手は
    //   `useEffectTemplates` の割り当て保存経路だけ＝ここが書いたら「2 つの真実」が 3 つになる）。
    expect(localStorage.getItem(EFFECT_OVERLAY_ENABLED_KEY)).toBeNull();
  });

  it("コメビュ窓が閉じているとき、OBS へ反映されない旨の案内と導線が出る", async () => {
    mocks.isCommentViewerOpen.mockResolvedValue(false);
    render(<ObsEffectsScreen />);

    // ⚠ 061p: 「コメントビューア＝閉じています」の行は消えたので、**案内そのもの**の出現を待つ。
    await waitFor(() =>
      expect(screen.getByText(/OBS\s*への反映は行われません/)).toBeInTheDocument(),
    );
    expect(
      screen.getByText(/OBS\s*への反映は行われません/),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "コメントビューアを開く" }));
    await waitFor(() =>
      expect(mocks.openCommentViewerWindow).toHaveBeenCalledTimes(1),
    );
  });

  it("⚠⚠ 061b: 案内文が「エフェクトも表示されません」と言わない（嘘になったため）", async () => {
    // ⚠ 061b でエフェクト窓が sidecar の WS を直接張るようになり、sidecar もエフェクト窓が
    // 生きている間は落ちなくなった。＝**コメビュ窓を閉じてもエフェクトは出続ける**ので、
    // 061a の文言（「（エフェクトも表示されません）」）は事実と食い違う。
    // ⚠ ここが無いと、あの一文を「親切だから」で書き戻せてしまう（嘘の案内が静かに復活する）。
    mocks.isCommentViewerOpen.mockResolvedValue(false);
    const { container } = render(<ObsEffectsScreen />);

    // ⚠ 061p: 「コメントビューア＝閉じています」の行は消えたので、**案内そのもの**の出現を待つ。
    await waitFor(() =>
      expect(screen.getByText(/OBS\s*への反映は行われません/)).toBeInTheDocument(),
    );
    expect(container.textContent).not.toContain("エフェクトも表示されません");
  });

  it("⚠⚠ 061b/061p: コメント取得（外部通信）が続くことと、その止め方を案内する（§1 の停止導線）", async () => {
    // ⚠ 061b レビュー S-1: コメビュ窓を閉じても sidecar が生き続けるケースでは
    //   Twitch/YouTube への取得＝外部通信も続く（`stop-session` は送られない）。
    // ⚠⚠⚠ **061p で止め方が 1 つになった。** 061i/061k は
    //   「エフェクトのウィンドウを**2 つとも**『ウィンドウを閉じる』で閉じる」も案内していたが、
    //   **そのボタンを削除した**ので、案内は `stop-session`（コメントビューアで取得を停止）だけになる。
    //   ⚠ `docs/security.md` §1 の 061p 追補が要求するのはこの 2 要素——
    //   **①取得が続いていること ②その止め方**。⚠ **どちらかを落とす変異はここで落ちる。**
    mocks.isCommentViewerOpen.mockResolvedValue(false);
    const { container } = render(<ObsEffectsScreen />);

    await waitFor(() =>
      expect(screen.getByText(/OBS\s*への反映は行われません/)).toBeInTheDocument(),
    );
    // ①取得が続く条件（エフェクトのウィンドウが開いている間）
    expect(container.textContent).toContain(
      "エフェクトのウィンドウが開いているあいだはコメントの取得が続く",
    );
    // ②止め方（＝いま実在する唯一の操作）
    expect(container.textContent).toContain(
      "コメントビューアを開いて取得を停止してください",
    );
    // ⚠⚠ **廃止した操作を案内しない**（061i レビュー S-1／061p で 2 度発火した失敗モード）。
    expect(container.textContent).not.toContain("ウィンドウを閉じる");
    expect(container.textContent).not.toContain("2 つとも");
  });

  it("⚠⚠ 061b: 条件なしで「閉じても続く」と断言しない（Q-1 の再発防止）", async () => {
    // ⚠ 「エフェクトの表示そのものは、…取得を開始したあとであれば、…閉じても続きます」という
    //   **条件が足りない旧文言**を書き戻せないようにする。約束できることだけを書く。
    mocks.isCommentViewerOpen.mockResolvedValue(false);
    const { container } = render(<ObsEffectsScreen />);

    await waitFor(() =>
      expect(screen.getByText(/OBS\s*への反映は行われません/)).toBeInTheDocument(),
    );
    expect(container.textContent).not.toContain("エフェクトの表示そのものは");
  });

  /**
   * ⚠⚠ 061e(4): 「OBS へ自動で反映」カードの注記が**事実と一致している**こと。
   *
   * 旧文は「追加や失敗の結果はコメントビューアの画面上部に表示されます。」だったが、実際にツールバーへ
   * 出るのは**失敗の赤字だけ**（成功時は何も出ない＝045c が「配信中のツールバーを騒がしくしない」として
   * 意図的にそう決めている）。全状態が見えるのはコメビュ窓の ⚙設定 →「OBSに表示」カード。
   * ＝旧文のままだと「成功したはずなのに何も出ない」＝**壊れていると誤解する**。
   *
   * 固定する 3 要素（061a レビュー Q-1 の規律＝**約束できることだけ書く**）:
   *   ①失敗したときだけ赤い文字が出る（成功時は何も出ない）
   *   ②追加できたかどうかの確認場所（コメビュ窓の設定 →「OBSに表示」）
   *   ③コメビュ窓を開いていないと反映そのものが行われない
   */
  it("⚠⚠ 061e/061p: 注記が「失敗のときだけ赤字が出る」と書いてある（旧文は嘘だった）", async () => {
    const { container } = render(<ObsEffectsScreen />);
    await waitFor(() => expect(autoAddToggle()).toBeInTheDocument());

    // ⚠⚠ **「コメント画面の」という限定まで固定する**（061e レビュー Q-3）。ここが無いと
    // 「コメントビューアの画面上部に**いつでも**赤い文字が出ます」のような**別の言い回しの嘘**へ
    // 書き換える変異が**生存する**（実測: 部分一致 2 件と旧文の不在 assert だけでは緑のまま通った）。
    // ⚠ 限定が要る理由＝コメビュ窓で設定/視聴者ビューを開いている間はツールバーごと差し替わる
    //（045c/059a の既知の割り切り）。
    expect(container.textContent).toContain("失敗したときだけ");
    expect(container.textContent).toContain(
      "コメントビューアのコメント画面の上部に赤い文字が出ます",
    );
    // ⚠ ここが無いと、あの一文を「親切だから」で書き戻せてしまう（嘘の案内が静かに復活する）。
    expect(container.textContent).not.toContain(
      "追加や失敗の結果はコメントビューアの画面上部に表示されます",
    );
  });

  // ⚠⚠ **061p: 061e の要素②③（確認場所＝「OBSに表示」／コメビュ窓が要ること）の 1 ケースを削除した。**
  //   注記を 3 文 → 1 文へ短縮したため（指示＝説明が長すぎる）。
  //   ⚠ **①（失敗のときだけ赤字）だけを残した**のは、あれが「成功したはずなのに何も出ない＝
  //   壊れていると誤解する」を防いでいる唯一の文だから。
  //   ⚠ ③（コメビュ窓を開いていないと反映されない）は**前提案内が `viewerOpen === false` のときに
  //   出す**ので、必要な人には届く（061e 穴 2 の役割分担のうち、常時側だけを削ったことになる）。

  it("⚠⚠ 061e: 注記は常時出る／前提案内の指示文とは重複させない（役割分担の固定）", async () => {
    // ⚠⚠ **穴 2 の結論をここで固定する。**
    //   - **注記（常時）** ＝「**結果がどこに出るか**」（このカードの意味論）
    //   - **前提案内（`viewerOpen === false` のときだけ）** ＝「**いま何が足りないか・どうすればよいか**」
    // 同じことを 2 か所に別の言葉で載せない（061a Q-1 が戒めた形）ので、注記側には前提案内の
    // **指示**（「コメントビューアを開くと、そのときに反映されます」）を書かない。
    mocks.isCommentViewerOpen.mockResolvedValue(true);
    const { container } = render(<ObsEffectsScreen />);
    await waitForStatusPoll();

    // コメビュ窓が開いていても注記は出る（＝常時表示）。
    expect(container.textContent).toContain("失敗したときだけ");
    // ⚠ 061p: 前提案内は出ないので、止め方の案内もこの画面には無い。
    expect(container.textContent).not.toContain("取得を停止してください");
    // 前提案内は出ないので、その指示文もこの画面のどこにも無い（＝注記が抱え込んでいない）。
    expect(container.textContent).not.toContain(
      "コメントビューアを開くと、そのときに反映されます",
    );
  });

  it("コメビュ窓が開いているときは案内を出さない", async () => {
    mocks.isCommentViewerOpen.mockResolvedValue(true);
    render(<ObsEffectsScreen />);

    await waitForStatusPoll();
    expect(screen.queryByText(/OBS\s*への反映は行われません/)).toBeNull();
    expect(screen.queryByRole("button", { name: "コメントビューアを開く" })).toBeNull();
  });

  // ⚠⚠ **061p: OBS WebSocket の検出結果を出す 2 ケースを削除した**
  //   （有効／無効の 2 状態。⚠ 認証必須のケースも下で削除）。「OBS の WebSocket」行ごと廃止したため。
  //   ⚠ **検出そのものを呼ばなくなったこと**は上の 061p の節が固定している。

  // --- 061a レビュー（Q-9）で追加した 3 ケース -------------------------------------------------

  it("⚠ アンマウントで前提ステータスのポーリングが止まる（配信中に回り続けさせない）", async () => {
    vi.useFakeTimers();
    const { unmount } = render(<ObsEffectsScreen />);
    // マウント直後の 1 回目が走る。
    await vi.advanceTimersByTimeAsync(0);
    const callsAtMount = mocks.isEffectOverlayOpen.mock.calls.length;
    expect(callsAtMount).toBeGreaterThan(0);

    // 1 周期進めるとポーリングが増えることを確かめてから……
    await vi.advanceTimersByTimeAsync(2000);
    expect(mocks.isEffectOverlayOpen.mock.calls.length).toBeGreaterThan(
      callsAtMount,
    );
    const callsBeforeUnmount = mocks.isEffectOverlayOpen.mock.calls.length;

    // ⚠ 本命: アンマウント後は何周期進めても 1 回も増えないこと（clearInterval が効いている）。
    unmount();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.isEffectOverlayOpen.mock.calls.length).toBe(callsBeforeUnmount);
  });

  it("⚠⚠ 061i/061p: 同じ窓への要求は直列化される（先の open が終わるまで次を投げない）", async () => {
    // ⚠ `open_effect_overlay_window` は `#[tauri::command(async)]`（別スレッド・窓生成で数百 ms）。
    //   直列化が無いと、同じ窓に対する 2 つの要求が**同時に走る**（061i がキューを作った理由）。
    // ⚠⚠ **061p で駆動を差し替えた**——旧版は「自動 open の途中で『ウィンドウを閉じる』を押す」で
    //   順序を見ていたが、**そのボタンを削除した**。⇒ コーナー窓への open 契機が
    //   **2 つ残っている**ことを使う（①「配信画面でテスト表示」②条件が 0 → 1 件）。
    //   ⚠ 見たい不変条件は同じ＝**先の要求が解決するまで次の invoke を投げない**。
    let resolveFirst: (() => void) | undefined;
    mocks.openEffectOverlayWindow.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          // ⚠ 2 本目以降は待たせない（1 本目だけを止める）。
          if (resolveFirst === undefined) resolveFirst = resolve;
          else resolve();
        }),
    );
    // ⚠ ステージ窓は開いている扱い（テスト表示がコーナー窓だけを開く状態にする）。
    mocks.isEffectOverlayOpen.mockResolvedValue(false);
    mocks.isStageOverlayOpen.mockResolvedValue(true);
    mocks.listEffectTemplates.mockResolvedValue([record()]);

    render(<ObsEffectsScreen />);
    await screen.findAllByText("きらきら演出"); // ⚠ 一覧と `<option>` の 2 か所に出る
    await waitForStatusPoll();

    // ①テスト表示 → コーナー窓の open（まだ解決させない）。
    fireEvent.click(screen.getByRole("button", { name: "配信画面でテスト表示" }));
    await act(async () => {});
    expect(resolveFirst).toBeDefined(); // open が呼ばれ、未解決のまま滞留している
    expect(mocks.openEffectOverlayWindow).toHaveBeenCalledTimes(1);

    // ②その最中に条件を 0 → 1 件（＝同じ窓への 2 本目の要求）。
    fireEvent.change(conditionSelect("スーパーチャット・ビッツ"), {
      target: { value: `template:${TEMPLATE_ID}` },
    });
    await act(async () => {});
    // ⚠⚠ **本命**: 1 本目が滞留している間、2 本目の invoke は**まだ飛ばない**。
    expect(mocks.openEffectOverlayWindow).toHaveBeenCalledTimes(1);

    // ⚠ `waitFor`（実タイマー・既定 1s）は使わない。解決後に走るのは
    //   「refreshStatus → open → refreshStatus」という**マイクロタスクの連なりだけ**なので、
    //   `act` で流し切れば結果は決定的になる（フルスイートの負荷で 1s を跨ぐ flaky を持ち込まない）。
    await act(async () => resolveFirst?.());
    await act(async () => {});
    expect(mocks.openEffectOverlayWindow).toHaveBeenCalledTimes(2);
  });

  it("⚠ 前提ステータスは他の窓での開閉にも追随する（この画面の外でも開閉されるため）", async () => {
    // ⚠ ポーリングにしている理由そのもの: エフェクト窓もコメビュ窓も、ツール管理・窓の × ・
    // 他窓の操作で開閉されうる。**この画面を開いたまま**表示が実態へ追いつくこと。
    // ⚠ ステータスは invoke の解決を経て state へ入るので、**`act` で包んで再レンダーまで流す**
    //（`advanceTimersByTimeAsync` だけだと「確認中…」のまま先へ進む）。
    // ⚠ 061p: ステータス行は消えたので、**前提案内の出入り**で追随を見る（観測点の付け替え）。
    vi.useFakeTimers();
    mocks.isCommentViewerOpen.mockResolvedValue(false);
    render(<ObsEffectsScreen />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(
      screen.getByRole("button", { name: "コメントビューアを開く" }),
    ).toBeInTheDocument();

    // 画面の外でコメビュ窓が開かれた。
    mocks.isCommentViewerOpen.mockResolvedValue(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    // 案内が引っ込む（＝「黙って何も起きない」状態が解消したことが分かる）。
    expect(screen.queryByRole("button", { name: "コメントビューアを開く" })).toBeNull();
  });

  it("⚠⚠ 061i: 条件の自動 open ではセットアップ用ガイドの旗を立てない（061a Q-1 の再発防止）", async () => {
    // ⚠⚠ **判断 3 の否定側。** ガイドを出してよいのは**明示操作**だけ——旧起点（表示トグル ON）が
    //   061i で消えたので、新起点は `EffectTemplateCard` の「テスト表示で停止中の窓を開いたとき」に移した。
    //   ⚠ ここで立てると**条件を 1 つ足すたび**にガイドが 30 秒 OBS のキャプチャへ映る
    //   （＝061a レビュー Q-1 が「起動時復元では立てない」と決めたのと同じ理由）。
    mocks.listEffectTemplates.mockResolvedValue([record()]);
    // ⚠ 「ウィンドウを閉じる」も同じケースで見たいので、窓は最初から表示中にしておく
    //   （ポーリングは 2 秒間隔で、`waitFor` の既定 1 秒では次の周回に間に合わない）。
    mocks.isEffectOverlayOpen.mockResolvedValue(true);
    render(<ObsEffectsScreen />);
    await screen.findAllByText("きらきら演出"); // ⚠ 一覧と `<option>` の 2 か所に出る

    fireEvent.change(conditionSelect("スーパーチャット・ビッツ"), {
      target: { value: `template:${TEMPLATE_ID}` },
    });
    await waitFor(() =>
      expect(mocks.openEffectOverlayWindow).toHaveBeenCalledTimes(1),
    );
    expect(localStorage.getItem(EFFECT_OVERLAY_GUIDE_PENDING_KEY)).toBeNull();

    // ⚠ 061p: 「ウィンドウを閉じる」でも立てないことを見ていたが、**ボタンごと廃止**したので落とした。
    // ⚠ 自動反映トグルでも立てない（窓を開かないので）。
    fireEvent.click(autoAddToggle());
    expect(localStorage.getItem(EFFECT_OVERLAY_GUIDE_PENDING_KEY)).toBeNull();
  });

  // --- 061l: 配信イベントの開催（判断 5・6・10・11） ---------------------------------------------

  /** 061l: 「配信イベント」タブを開いて、適用済みの状態にする（＝「開始」が出る状態）。 */
  const openEventTabWithApplied = () => {
    localStorage.setItem(STREAM_EVENT_SELECTED_KEY, EVENT_ID);
    const view = render(<ObsEffectsScreen />);
    fireEvent.click(screen.getByRole("tab", { name: "配信イベント" }));
    return view;
  };

  it("⚠⚠ 新規 5: 「開始」は開催キーを書き、**ステージ窓だけ**を開く", async () => {
    openEventTabWithApplied();
    fireEvent.click(screen.getByRole("button", { name: "開始" }));

    // ① 開催キーが書かれる（`endsAt` は `defaultDurationMs` から決まる絶対時刻）。
    const saved = JSON.parse(
      localStorage.getItem(STREAM_EVENT_ROUND_KEY) as string,
    ) as { eventId: string; startedAt: number; endsAt: number };
    expect(saved.eventId).toBe(EVENT_ID);
    expect(saved.endsAt - saved.startedAt).toBe(5 * 60_000);

    // ② ⚠⚠ **ステージ窓だけ**（コーナー窓は開かない＝イベントはステージにしか出ない・判断 7）。
    await waitFor(() =>
      expect(mocks.openStageOverlayWindow).toHaveBeenCalledTimes(1),
    );
    expect(mocks.openEffectOverlayWindow).not.toHaveBeenCalled();
    // ③ ⚠ 派生値（窓を出すか）は触らない——あれの意味は「その出力先の条件が 1 件以上あるか」で、
    //    書き手は `useEffectTemplates` だけ（061i 判断 2・061k 判断 6 の不変条件）。
    expect(localStorage.getItem(STAGE_OVERLAY_ENABLED_KEY)).toBeNull();
    expect(localStorage.getItem(EFFECT_OVERLAY_ENABLED_KEY)).toBeNull();
  });

  it("⚠⚠ 新規 6: 「終了」は開催キーを消すが、**窓は 1 つも閉じない**（親 046 の規律）", async () => {
    openEventTabWithApplied();
    fireEvent.click(screen.getByRole("button", { name: "開始" }));
    await waitFor(() =>
      expect(mocks.openStageOverlayWindow).toHaveBeenCalledTimes(1),
    );

    fireEvent.click(screen.getByRole("button", { name: "終了" }));
    expect(localStorage.getItem(STREAM_EVENT_ROUND_KEY)).toBeNull();

    // ⚠⚠ **`close` 系 IPC が 1 度も呼ばれていないこと**（「何も出ない」では殺せない変異②の本体）。
    await act(async () => {});
    expect(mocks.closeStageOverlayWindow).not.toHaveBeenCalled();
    expect(mocks.closeEffectOverlayWindow).not.toHaveBeenCalled();
  });

  it("⚠⚠ 新規 14/061p: 開催中かどうかが「配信イベント」タブの表示に出る（2 状態とも）", async () => {
    // ⚠⚠ **061p で観測点を付け替えた**——前提ステータスの「開催中のイベント」行は削除したので、
    //   **タブの中の表示**（＝開催中は残り時間と「終了」、未開催は「適用中」と「開始」）で見る。
    //   ⚠ 残りは**分まで**（秒を出すと毎秒再描画になる・判断 10）。
    // ⚠ 「適用中」バッジは一覧カードにも出るので、**開催の器のほうのボタン**で状態を見る。
    openEventTabWithApplied();
    expect(screen.getByRole("button", { name: "開始" })).toBeInTheDocument();
    expect(screen.queryByText(/残り \d+ 分/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "開始" }));
    expect(screen.getByText("残り 5 分")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "終了" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "開始" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "終了" }));
    expect(screen.getByRole("button", { name: "開始" })).toBeInTheDocument();
    expect(screen.queryByText(/残り \d+ 分/)).toBeNull();
    await act(async () => {});
  });

  it("⚠ 新規 14: 開催中の保存値はマウント時に読む（画面を開き直しても続いている）", async () => {
    const now = Date.now();
    localStorage.setItem(STREAM_EVENT_SELECTED_KEY, EVENT_ID);
    localStorage.setItem(
      STREAM_EVENT_ROUND_KEY,
      JSON.stringify({ eventId: EVENT_ID, startedAt: now, endsAt: now + 120_000 }),
    );
    render(<ObsEffectsScreen />);
    fireEvent.click(screen.getByRole("tab", { name: "配信イベント" }));
    expect(screen.getByText("残り 2 分")).toBeInTheDocument();
    // ⚠⚠ **窓は開き直さない**（開くのは「開始」の操作だけ＝画面を開くたびに窓が増えない）。
    await act(async () => {});
    expect(mocks.openStageOverlayWindow).not.toHaveBeenCalled();
  });

  it("⚠⚠ 期限切れの保存値は「開催していません」になるが、**掃除はされずに残る**（受容の裏取り）", async () => {
    // ⚠⚠ **061l レビュー Q-1 でテスト名を訂正した。** 旧名は「掃除される（best-effort）」だったが、
    //   本体は掃除を 1 行も検査しておらず、**実際にも掃除されない**（レビューで `toBeNull()` を
    //   足すと RED になることを実測）。マウント時点で期限切れなら `round` は最初から `null` ＝
    //   **tick を張らない**ので `clearStreamEventRound` に到達しないためである。
    //   ⇒ これは progress.md 061l 節が受容事項として書いている挙動そのものなので、
    //   **受容している側を機械で固定する**形へ直した（名前だけ直して未検査のままにしない）。
    localStorage.setItem(
      STREAM_EVENT_ROUND_KEY,
      JSON.stringify({ eventId: EVENT_ID, startedAt: 0, endsAt: 1 }),
    );
    localStorage.setItem(STREAM_EVENT_SELECTED_KEY, EVENT_ID);
    render(<ObsEffectsScreen />);
    fireEvent.click(screen.getByRole("tab", { name: "配信イベント" }));
    // ⚠ 期限切れ＝開催していない＝タブは「適用中／開始」の状態に戻っている。
    expect(screen.getByRole("button", { name: "開始" })).toBeInTheDocument();
    await act(async () => {});
    // ⚠⚠ **残ることが正しい**——正しさは `parseStreamEventRound` が持っており（読む側が必ず落とす）、
    //   掃除は「開催中に main 窓がこの画面を開いているとき」の best-effort に留めてある（判断 5）。
    //   ⚠ 帰結＝**期限切れキーは再起動をまたいで残る**ので、
    //   **端末内データの一括削除を作るときの対象**になる（`overlaySettings.ts` の申し送りが正）。
    expect(localStorage.getItem(STREAM_EVENT_ROUND_KEY)).not.toBeNull();
  });

  it("⚠⚠ 期限前の tick では掃除しない（開催が勝手に終わらない）", async () => {
    // ⚠⚠ **変異 ⑭-e（掃除の条件を外す）を殺すのはこのケースだけ**——期限切れ側のケースは
    //   「最後には消えている」ことしか見ておらず、**10 秒で勝手に終わる**実装でも緑になる。
    vi.useFakeTimers();
    localStorage.setItem(STREAM_EVENT_SELECTED_KEY, EVENT_ID);
    render(<ObsEffectsScreen />);
    fireEvent.click(screen.getByRole("tab", { name: "配信イベント" }));
    fireEvent.click(screen.getByRole("button", { name: "開始" }));

    // tick を何周期か回しても、期限（5 分）までは開催が続く。
    // ⚠ `act` で包む——包まないと**最後の 1 テックの state 更新が DOM へ反映される前**に読んでしまい、
    //   残り時間が 1 テックぶん古く見える（実測で踏んだ）。
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(localStorage.getItem(STREAM_EVENT_ROUND_KEY)).not.toBeNull();
    // ⚠ 残りは分で減っていく（時計が 1 つ＝`nowMs` が tick で進んでいる）。
    // ⚠ 061p: 観測点はタブの中の残り時間（前提ステータスの行は削除した）。
    expect(screen.getByText("残り 4 分")).toBeInTheDocument();
  });

  it("⚠⚠ 新規 13: 期限が来たら表示が消えて掃除が走り、アンマウントで tick が止まる", async () => {
    vi.useFakeTimers();
    localStorage.setItem(STREAM_EVENT_SELECTED_KEY, EVENT_ID);
    const { unmount } = render(<ObsEffectsScreen />);
    fireEvent.click(screen.getByRole("tab", { name: "配信イベント" }));
    fireEvent.click(screen.getByRole("button", { name: "開始" }));
    expect(screen.getByText("残り 5 分")).toBeInTheDocument();

    // 5 分を越えると、tick が期限切れに気づいて表示を落とし、保存値も掃除する。
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000 + 10_000);
    });
    expect(screen.queryByText(/残り \d+ 分/)).toBeNull();
    expect(localStorage.getItem(STREAM_EVENT_ROUND_KEY)).toBeNull();

    // ⚠ 本命: 開催中にアンマウントしても tick が残らない（配信中にタイマーを残さない）。
    fireEvent.click(screen.getByRole("button", { name: "開始" }));
    expect(localStorage.getItem(STREAM_EVENT_ROUND_KEY)).not.toBeNull();
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60_000);
    });
    // ⚠ アンマウント後の tick が走っていれば、掃除で消えてしまう＝残っていることが「止まった」証拠。
    expect(localStorage.getItem(STREAM_EVENT_ROUND_KEY)).not.toBeNull();
  });

  // ⚠⚠ **061p: 「「開催中のイベント」行は共通領域にある」を削除した**（行ごと廃止）。
  //   ⚠ **開催状態の持ち主が `ObsEffectsScreen` であること自体は変えていない**
  //   （タブへ props で渡し、開始のステージ窓 open もこの画面のキューを通る＝上のケース群が固定）。
});
