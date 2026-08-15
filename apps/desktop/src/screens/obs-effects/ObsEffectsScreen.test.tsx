import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act, within } from "@testing-library/react";
import { ObsEffectsScreen } from "./ObsEffectsScreen";
import {
  EFFECT_ASSIGNMENTS_KEY,
  EFFECT_OVERLAY_ENABLED_KEY,
  STAGE_OVERLAY_ENABLED_KEY,
  EFFECT_OBS_AUTO_ADD_KEY,
  EFFECT_OVERLAY_GUIDE_PENDING_KEY,
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
 * - **前提ステータス**が「いま何が足りないか」を出す。⚠ とくに**コメビュ窓が閉じていると
 *   OBS へは反映されない**ことを明示する（`obs-enable` を送れる窓が存在しないため）。
 *   ⚠⚠ **061b で案内文から「（エフェクトも表示されません）」を削った**——エフェクト窓が sidecar の WS を
 *   直接張るようになり、**コメント取得を開始したあとならコメビュ窓を閉じてもエフェクトは出続ける**ので、
 *   あの一文は嘘になった。代わりに「エフェクトの表示自体は続く」という非対称を明示する。
 *   下の 2 ケースがこの文言を仕様として固定する（**復活させない**ための回帰テスト）。
 * - 準備中プレースホルダ（`ComingSoonScreen`）の文言が出ない。
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
}));

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

/** 061i: 「表示する条件」行の値。 */
const conditionStatus = () =>
  screen.getByText("表示する条件").parentElement?.textContent ?? "";

/**
 * 061k: **出力先ごとの「エフェクトのウィンドウ」行**の値（「表示中」/「停止中」/「確認中…」）。
 * ⚠ 窓が 2 本になったので `getByText("停止中")` は**必ず 2 件ヒットする**——行を特定して読む。
 */
const windowStatus = (label = "コーナー（小さめ）") =>
  screen.getByText(`エフェクトのウィンドウ（${label}）`).parentElement?.textContent ??
  "";

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
    // 既定タブの中身＝テンプレートと条件の 2 カード。
    expect(
      screen.getByRole("heading", { name: "エフェクトのテンプレート" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "エフェクトを表示する条件" }),
    ).toBeInTheDocument();
  });

  it("⚠ 061i: 「配信イベント」タブは準備中の案内だけ（061l まで枠だけ）", async () => {
    render(<ObsEffectsScreen />);
    fireEvent.click(screen.getByRole("tab", { name: "配信イベント" }));

    expect(screen.getByText(/この機能は準備中です/)).toBeInTheDocument();
    // ⚠ タブを切り替えるとコメント側のカードは出ない（＝本当に入れ替わっている）。
    expect(
      screen.queryByRole("heading", { name: "エフェクトを表示する条件" }),
    ).toBeNull();
  });

  it("⚠⚠ 061i: 「OBS へ自動で反映」と前提ステータスは**両タブの外**にある", async () => {
    // ⚠ どちらのタブで使うエフェクトも**同じ窓・同じ OBS ソース**に出るため
    //   （タブの中へ入れると「タブごとに別の窓がある」と読める）。⚠ 061k で窓が 2 本になったら見直す。
    render(<ObsEffectsScreen />);
    fireEvent.click(screen.getByRole("tab", { name: "配信イベント" }));

    expect(autoAddToggle()).toBeInTheDocument();
    expect(screen.getByText("表示する条件")).toBeInTheDocument();
    // ⚠ 061k: 窓が 2 本になったので行も 2 本（どちらも共通領域にある）。
    expect(
      screen.getByText("エフェクトのウィンドウ（コーナー（小さめ））"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("エフェクトのウィンドウ（全画面（ステージ））"),
    ).toBeInTheDocument();
    // OBS への取り込み手順も共通領域（トグルは消えたが説明は残す）。
    expect(
      screen.getByRole("heading", { name: "配信画面に表示" }),
    ).toBeInTheDocument();
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
    expect(conditionStatus()).toContain("設定されていません");

    fireEvent.change(conditionSelect("スーパーチャット・ビッツ"), {
      target: { value: `template:${TEMPLATE_ID}` },
    });

    await waitFor(() =>
      expect(mocks.openEffectOverlayWindow).toHaveBeenCalledTimes(1),
    );
    expect(localStorage.getItem(EFFECT_OVERLAY_ENABLED_KEY)).toBe("true");
    expect(mocks.closeEffectOverlayWindow).not.toHaveBeenCalled();
    expect(conditionStatus()).toContain("1 件");
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
    // ⚠ 「表示する条件」行は**合計 1 行のまま**だが、内訳が出る（穴 α の緩和）。
    expect(conditionStatus()).toContain("1 件");
    expect(conditionStatus()).toContain("全画面（ステージ） 0");
  });

  it("⚠⚠ 新規 11: 開閉キューは窓ごとに独立（corner の close 中に stage の open が待たされない）", async () => {
    // ⚠⚠ **1 本のキューに混ぜるとここが落ちる**（061i がキューを作った理由は
    //   「**同じ窓**への close と open の順序」であって、別の窓を直列化する理由は無い）。
    let releaseClose = () => {};
    mocks.closeEffectOverlayWindow.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseClose = resolve;
        }),
    );
    mocks.isEffectOverlayOpen.mockResolvedValue(true);
    mocks.listEffectTemplates.mockResolvedValue([record()]);
    render(<ObsEffectsScreen />);
    await screen.findAllByText("きらきら演出");
    await waitFor(() => expect(windowStatus()).toContain("表示中"));

    // コーナー窓を閉じる（この Promise は解決させないまま止めておく）。
    fireEvent.click(
      screen.getByRole("button", { name: "コーナー（小さめ）のウィンドウを閉じる" }),
    );
    // その最中に stage 条件を作る＝ステージ窓の open が投げられる。
    fireEvent.change(conditionSelect("スーパーチャット・ビッツ"), {
      target: { value: `template:${TEMPLATE_ID}` },
    });
    fireEvent.change(outputSelect("スーパーチャット・ビッツ"), {
      target: { value: "stage" },
    });

    // ⚠⚠ **close が止まったままでも stage の open は届く**（＝キューが別）。
    await waitFor(() =>
      expect(mocks.openStageOverlayWindow).toHaveBeenCalledTimes(1),
    );
    releaseClose();
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
    expect(conditionStatus()).toContain("2 件");
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
    expect(conditionStatus()).toContain("設定されていません");
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
    expect(conditionStatus()).toContain("設定されていません");
    // ⚠ 窓は閉じない（判断 1）。
    expect(mocks.closeEffectOverlayWindow).not.toHaveBeenCalled();
  });

  it("⚠⚠ 061i: 「ウィンドウを閉じる」で窓は閉じるが、フラグは false にならない", async () => {
    // ⚠⚠ **設定と窓を混ぜない**（判断 1）。これは「条件を消す」操作ではなく
    //   「いま出ている窓を片付ける」操作なので、条件はそのまま残る
    //   ＝ アプリを開き直せば `restoreEffectOverlayWindow` がまた開く。
    // ⚠⚠ **061i レビュー S-3 で前提を直した。** 旧版は「条件 0 件・フラグ true」という
    //   **実装上ありえない不整合**を作って「フラグが変わらないこと」を見ていたため、
    //   マウント時の再計算（S-3）が入った途端に落ちた。⚠ 見たいのは
    //   「**閉じるボタンがフラグを触らない**」であって「フラグが絶対に動かない」ではないので、
    //   条件を 1 件持たせて **true が正当な状態**にしてから押す。
    localStorage.setItem(
      EFFECT_ASSIGNMENTS_KEY,
      JSON.stringify({ superchat: { kind: "template", templateId: TEMPLATE_ID } }),
    );
    localStorage.setItem(EFFECT_OVERLAY_ENABLED_KEY, "true");
    mocks.listEffectTemplates.mockResolvedValue([record()]);
    mocks.isEffectOverlayOpen.mockResolvedValue(true);
    render(<ObsEffectsScreen />);
    await waitFor(() => expect(windowStatus()).toContain("表示中"));

    fireEvent.click(
      screen.getByRole("button", { name: "コーナー（小さめ）のウィンドウを閉じる" }),
    );
    await waitFor(() =>
      expect(mocks.closeEffectOverlayWindow).toHaveBeenCalledTimes(1),
    );

    expect(localStorage.getItem(EFFECT_OVERLAY_ENABLED_KEY)).toBe("true");
    expect(mocks.openEffectOverlayWindow).not.toHaveBeenCalled();
  });

  it("⚠ 061i: 窓が停止中のときは「ウィンドウを閉じる」を出さない", async () => {
    mocks.isEffectOverlayOpen.mockResolvedValue(false);
    render(<ObsEffectsScreen />);
    await waitFor(() => expect(windowStatus()).toContain("停止中"));
    expect(
      screen.queryByRole("button", { name: "コーナー（小さめ）のウィンドウを閉じる" }),
    ).toBeNull();
  });

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
    await waitFor(() => expect(windowStatus()).toContain("停止中"));

    expect(localStorage.getItem(EFFECT_OVERLAY_ENABLED_KEY)).toBeNull();
    expect(
      setItem.mock.calls.filter((c) => c[0] === EFFECT_OVERLAY_ENABLED_KEY),
    ).toEqual([]);
    setItem.mockRestore();
  });

  it("⚠⚠ 061i レビュー Q-2: 停止中でも条件があれば「ウィンドウを開く」で開き直せる", async () => {
    // ⚠⚠ **自動 open の契機は「0 → 1 件の遷移」だけ**なので、条件が既に 1 件以上ある状態では
    //   何をしても窓が開かない（＝「閉じる」はあるのに「開く」が無い非対称）。
    // ⚠ フラグは触らない（設定と窓を混ぜない・判断 1）。⚠ ガイド旗も立てない（判断 3）。
    localStorage.setItem(
      EFFECT_ASSIGNMENTS_KEY,
      JSON.stringify({ superchat: { kind: "template", templateId: TEMPLATE_ID } }),
    );
    mocks.listEffectTemplates.mockResolvedValue([record()]);
    mocks.isEffectOverlayOpen.mockResolvedValue(false);
    render(<ObsEffectsScreen />);
    await waitFor(() => expect(windowStatus()).toContain("停止中"));

    fireEvent.click(
      screen.getByRole("button", { name: "コーナー（小さめ）のウィンドウを開く" }),
    );
    await waitFor(() =>
      expect(mocks.openEffectOverlayWindow).toHaveBeenCalledTimes(1),
    );
    expect(localStorage.getItem(EFFECT_OVERLAY_ENABLED_KEY)).toBe("true"); // 再計算のぶん（押して変わったのではない）
    expect(localStorage.getItem(EFFECT_OVERLAY_GUIDE_PENDING_KEY)).toBeNull();
  });

  it("⚠ 061i レビュー Q-2: 条件が 0 件のときは「ウィンドウを開く」を出さない", async () => {
    // ⚠ 出しても「開いたのに何も出ない窓」を作るだけで、正しい行動は条件を設定すること。
    mocks.isEffectOverlayOpen.mockResolvedValue(false);
    render(<ObsEffectsScreen />);
    await waitFor(() => expect(windowStatus()).toContain("停止中"));
    expect(
      screen.queryByRole("button", { name: "コーナー（小さめ）のウィンドウを開く" }),
    ).toBeNull();
  });

  it("⚠⚠ 061i レビュー S-4: 自動 open の直後は前提ステータスを楽観的に「表示中」にする", async () => {
    // ⚠⚠ **旗の残骸を防ぐための楽観更新。** ポーリングは 2 秒間隔なので、素のままだと
    //   自動 open の直後もしばらく「停止中」に見える。その隙間に「配信画面でテスト表示」を押すと
    //   `EffectTemplateCard` が**旗経路**へ倒れるが、既存窓は `show()` されるだけで
    //   **再マウントしない**＝旗を読み直さないので、保留旗とガイド旗が**消えない残骸**になる
    //   （次に窓が開いた瞬間＝再起動時の復元で、無操作でエフェクトが出てガイドが OBS へ映る）。
    // ⚠ close 側は楽観更新しない（壊れ方が「押しても出ない」で軽いほうへ倒れるため）。
    mocks.listEffectTemplates.mockResolvedValue([record()]);
    // ⚠ open を解決させない＝「invoke は投げたが実態はまだ分からない」状態を作る。
    mocks.openEffectOverlayWindow.mockImplementation(() => new Promise(() => {}));
    render(<ObsEffectsScreen />);
    await screen.findAllByText("きらきら演出"); // ⚠ 一覧と `<option>` の 2 か所に出る
    await waitFor(() => expect(windowStatus()).toContain("停止中"));

    fireEvent.change(conditionSelect("スーパーチャット・ビッツ"), {
      target: { value: `template:${TEMPLATE_ID}` },
    });

    expect(windowStatus()).toContain("表示中");
    // ⚠ ＝ この時点でテスト表示を押しても旗経路へは倒れない（`EffectTemplateCard` が `true` を見る）。
    expect(windowStatus()).not.toContain("停止中");
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

    await waitFor(() => expect(screen.getByText("閉じています")).toBeInTheDocument());
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

    await waitFor(() => expect(screen.getByText("閉じています")).toBeInTheDocument());
    expect(container.textContent).not.toContain("エフェクトも表示されません");
  });

  it("⚠ 061b: エフェクトの表示だけは続く、という非対称を**条件つきで**案内する", async () => {
    // 「OBS への反映は止まるが、エフェクトの表示自体は続く」というねじれをユーザーへ明示する
    //（`obs-enable` の送出だけがコメビュ窓に残っているため）。
    // ⚠⚠ **061b レビュー Q-1 で「エフェクトのウィンドウを表示したまま」という条件を必須にした。**
    //   条件抜きで「取得を開始したあとなら続きます」と書くと、この案内が出る状況
    //   （＝コメビュ窓が閉じている）に「表示 OFF のまま閉じた＝sidecar は既に死んでいる」
    //   ユーザーが含まれるため**嘘になる**（061a Q-1「配信中には表示されません」と同じ失敗モード）。
    mocks.isCommentViewerOpen.mockResolvedValue(false);
    render(<ObsEffectsScreen />);

    await waitFor(() => expect(screen.getByText("閉じています")).toBeInTheDocument());
    expect(
      screen.getByText(
        /エフェクトのウィンドウ（.*）を表示したまま[\s\S]*閉じた場合は[\s\S]*続きます/,
      ),
    ).toBeInTheDocument();
  });

  it("⚠⚠ 061b: 条件なしで「閉じても続く」と断言しない（Q-1 の再発防止）", async () => {
    // ⚠ 「エフェクトの表示そのものは、…取得を開始したあとであれば、…閉じても続きます」という
    //   **条件が足りない旧文言**を書き戻せないようにする。約束できることだけを書く。
    mocks.isCommentViewerOpen.mockResolvedValue(false);
    const { container } = render(<ObsEffectsScreen />);

    await waitFor(() => expect(screen.getByText("閉じています")).toBeInTheDocument());
    expect(container.textContent).not.toContain("エフェクトの表示そのものは");
  });

  it("⚠⚠ 061b: コメント取得（外部通信）が続くことと、その止め方を案内する", async () => {
    // ⚠ 061b レビュー S-1: コメビュ窓を閉じても sidecar が生き続けるケースでは
    //   Twitch/YouTube への取得＝外部通信も続く（`stop-session` は送られない）。
    //   ツール管理の「停止」は窓を閉じるだけなので、**取得を止める導線はここにしか無い**。
    mocks.isCommentViewerOpen.mockResolvedValue(false);
    const { container } = render(<ObsEffectsScreen />);

    await waitFor(() => expect(screen.getByText("閉じています")).toBeInTheDocument());
    expect(container.textContent).toContain("コメントの取得がそのまま続きます");
    expect(container.textContent).toContain("取得を止めたいとき");
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
  it("⚠⚠ 061e: 注記が「失敗のときだけ赤字・成功は無表示」と書いてある（旧文は嘘だった）", async () => {
    const { container } = render(<ObsEffectsScreen />);
    await waitFor(() => expect(autoAddToggle()).toBeInTheDocument());

    // 要素①
    expect(container.textContent).toContain("失敗したときだけ");
    expect(container.textContent).toContain("成功したときは何も出ません");
    // ⚠⚠ **「コメント画面の」という限定まで固定する**（061e レビュー Q-3）。ここが無いと
    // 「コメントビューアの画面上部に**いつでも**赤い文字が出ます」のような**別の言い回しの嘘**へ
    // 書き換える変異が**生存する**（実測: 上の部分一致 2 件と旧文の不在 assert だけでは 28/28 緑のまま通った）。
    // ⚠ 限定が要る理由＝コメビュ窓で設定/視聴者ビューを開いている間はツールバーごと差し替わる
    //（045c/059a の既知の割り切り）。
    expect(container.textContent).toContain(
      "コメントビューアのコメント画面の上部に赤い文字が出ます",
    );
    // ⚠ ここが無いと、あの一文を「親切だから」で書き戻せてしまう（嘘の案内が静かに復活する）。
    expect(container.textContent).not.toContain(
      "追加や失敗の結果はコメントビューアの画面上部に表示されます",
    );
  });

  it("⚠ 061e: 注記に「どこで結果を確認できるか」と「コメビュ窓が要ること」が書いてある", async () => {
    const { container } = render(<ObsEffectsScreen />);
    await waitFor(() => expect(autoAddToggle()).toBeInTheDocument());

    // 要素②（全状態が見えるのは設定カードのほう）
    expect(container.textContent).toContain("「OBSに表示」で確認できます");
    // 要素③（061a の事実＝`obs-enable` を送れるのはコメビュ窓だけ）
    expect(container.textContent).toContain(
      "コメントビューアを開いていないあいだは反映そのものが行われない",
    );
  });

  it("⚠⚠ 061e: 注記は常時出る／前提案内の指示文とは重複させない（役割分担の固定）", async () => {
    // ⚠⚠ **穴 2 の結論をここで固定する。**
    //   - **注記（常時）** ＝「**結果がどこに出るか**」（このカードの意味論）
    //   - **前提案内（`viewerOpen === false` のときだけ）** ＝「**いま何が足りないか・どうすればよいか**」
    // 同じことを 2 か所に別の言葉で載せない（061a Q-1 が戒めた形）ので、注記側には前提案内の
    // **指示**（「コメントビューアを開くと、そのときに反映されます」）を書かない。
    mocks.isCommentViewerOpen.mockResolvedValue(true);
    const { container } = render(<ObsEffectsScreen />);
    await waitFor(() =>
      expect(screen.getByText("開いています")).toBeInTheDocument(),
    );

    // コメビュ窓が開いていても注記は出る（＝常時表示）。
    expect(container.textContent).toContain("失敗したときだけ");
    // 前提案内は出ないので、その指示文もこの画面のどこにも無い（＝注記が抱え込んでいない）。
    expect(container.textContent).not.toContain(
      "コメントビューアを開くと、そのときに反映されます",
    );
  });

  it("コメビュ窓が開いているときは案内を出さない", async () => {
    mocks.isCommentViewerOpen.mockResolvedValue(true);
    render(<ObsEffectsScreen />);

    await waitFor(() =>
      expect(screen.getByText("開いています")).toBeInTheDocument(),
    );
    expect(screen.queryByText(/OBS\s*への反映は行われません/)).toBeNull();
    expect(screen.queryByRole("button", { name: "コメントビューアを開く" })).toBeNull();
  });

  it("前提ステータスに OBS WebSocket の検出結果が出る", async () => {
    mocks.detectObsWebsocketConfig.mockResolvedValue({
      enabled: true,
      port: 4455,
      authRequired: false,
    });
    render(<ObsEffectsScreen />);
    await waitFor(() =>
      expect(screen.getByText("有効（ポート 4455）")).toBeInTheDocument(),
    );
  });

  it("OBS WebSocket が無効なら有効化を促す（未検出と同じ扱い）", async () => {
    mocks.detectObsWebsocketConfig.mockResolvedValue({
      enabled: false,
      port: 4455,
      authRequired: false,
    });
    render(<ObsEffectsScreen />);
    await waitFor(() =>
      expect(screen.getByText(/無効（OBS の/)).toBeInTheDocument(),
    );
  });

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

  it("⚠⚠ 061i: 窓の開閉は直列化される（条件の自動 open の途中で「閉じる」を押しても順序が保たれる）", async () => {
    // ⚠ `open_effect_overlay_window` は `#[tauri::command(async)]`（別スレッド・窓生成で数百 ms）、
    // close は同期コマンド。直列化が無いと「close が『窓なし＝no-op』で先に流れ、その後 open が窓を作る」
    // 順序が起こりうる（＝閉じたはずの窓が OBS に映り続ける・自動 close 経路が無いので解消しない）。
    // ⚠⚠ **061i で経路が変わったので固定する経路も差し替えた**（表示トグルの連打 → 条件の自動 open ＋
    //   「ウィンドウを閉じる」）。**契機が増えたぶん、直列化はむしろ必要になっている**——
    //   だから `effectOverlayOpRef` は残してあり、3 つの契機は全部あのキューを通る。
    const order: string[] = [];
    let resolveOpen: (() => void) | undefined;
    mocks.openEffectOverlayWindow.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveOpen = () => {
            order.push("open");
            resolve();
          };
        }),
    );
    mocks.closeEffectOverlayWindow.mockImplementation(async () => {
      order.push("close");
    });
    // 「閉じる」ボタンを出すために、窓は表示中に見せておく。
    mocks.isEffectOverlayOpen.mockResolvedValue(true);
    mocks.listEffectTemplates.mockResolvedValue([record()]);

    render(<ObsEffectsScreen />);
    await screen.findAllByText("きらきら演出"); // ⚠ 一覧と `<option>` の 2 か所に出る
    await waitFor(() => expect(windowStatus()).toContain("表示中"));

    // 条件を 0 → 1 件（＝自動 open。まだ解決させない）。
    fireEvent.change(conditionSelect("スーパーチャット・ビッツ"), {
      target: { value: `template:${TEMPLATE_ID}` },
    });
    // ⚠ open は `effectOverlayOpRef` の `.then` の中で呼ばれる＝**マイクロタスクを 1 つ挟む**ので、
    // ここで流さないと `resolveOpen` がまだ未定義のまま先へ進んでしまう（実装時に踏んだ）。
    await act(async () => {});
    expect(resolveOpen).toBeDefined(); // open が呼ばれ、未解決のまま滞留している

    fireEvent.click(
      screen.getByRole("button", { name: "コーナー（小さめ）のウィンドウを閉じる" }),
    );
    expect(order).toEqual([]); // どちらもまだ走り終わっていない

    // ⚠ `waitFor`（実タイマー・既定 1s）は使わない。open の解決後に走るのは
    // 「refreshStatus → close → refreshStatus」という**マイクロタスクの連なりだけ**なので、
    // `act` で流し切れば結果は決定的になる。フルスイートの負荷で 1s を跨ぐ flaky を持ち込まないため。
    await act(async () => resolveOpen?.());
    await act(async () => {});
    expect(order).toEqual(["open", "close"]);
    // ⚠ 「閉じる」は設定を触らないので、条件のぶん true のまま（判断 1）。
    expect(localStorage.getItem(EFFECT_OVERLAY_ENABLED_KEY)).toBe("true");
  });

  it("OBS WebSocket が認証必須ならその旨も出す（パスワード設定が要ることに気付ける）", async () => {
    mocks.detectObsWebsocketConfig.mockResolvedValue({
      enabled: true,
      port: 4466,
      authRequired: true,
    });
    render(<ObsEffectsScreen />);
    await waitFor(() =>
      expect(
        screen.getByText("有効（ポート 4466・パスワードあり）"),
      ).toBeInTheDocument(),
    );
  });

  it("⚠ 前提ステータスは他の窓での開閉にも追随する（この画面の外でも開閉されるため）", async () => {
    // ⚠ ポーリングにしている理由そのもの: エフェクト窓もコメビュ窓も、ツール管理・窓の × ・
    // 他窓の操作で開閉されうる。**この画面を開いたまま**表示が実態へ追いつくこと。
    // ⚠ ステータスは invoke の解決を経て state へ入るので、**`act` で包んで再レンダーまで流す**
    //（`advanceTimersByTimeAsync` だけだと「確認中…」のまま先へ進む）。
    vi.useFakeTimers();
    mocks.isCommentViewerOpen.mockResolvedValue(false);
    render(<ObsEffectsScreen />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText("閉じています")).toBeInTheDocument();

    // 画面の外でコメビュ窓が開かれた。
    mocks.isCommentViewerOpen.mockResolvedValue(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(screen.getByText("開いています")).toBeInTheDocument();
    // 案内も引っ込む（＝「黙って何も起きない」状態が解消したことが分かる）。
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

    // ⚠ 「ウィンドウを閉じる」でも立てない（閉じる操作にガイドの出番は無い）。
    await waitFor(() => expect(windowStatus()).toContain("表示中"));
    fireEvent.click(
      screen.getByRole("button", { name: "コーナー（小さめ）のウィンドウを閉じる" }),
    );
    await act(async () => {});
    expect(localStorage.getItem(EFFECT_OVERLAY_GUIDE_PENDING_KEY)).toBeNull();

    // ⚠ 自動反映トグルでも立てない（窓を開かないので）。
    fireEvent.click(autoAddToggle());
    expect(localStorage.getItem(EFFECT_OVERLAY_GUIDE_PENDING_KEY)).toBeNull();
  });
});
