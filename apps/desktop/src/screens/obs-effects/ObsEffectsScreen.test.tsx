import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { ObsEffectsScreen } from "./ObsEffectsScreen";
import {
  STAGE_OVERLAY_ENABLED_KEY,
  // ⚠⚠ 063c 段 1: **2 本目の旗**（この画面が唯一の書き手であることを下のケース群が固定する）。
  GACHA_STAGE_ENABLED_KEY,
  EFFECT_OVERLAY_GUIDE_PENDING_KEY,
  // 064f: 取得ボタンがこの画面（タイトル行）へ移ったので、依頼と一覧のキーをここで見る。
  EFFECT_ASSIGNMENTS_KEY,
  OBS_SOURCE_LIST_KEY,
  OBS_SOURCE_LIST_REQUEST_KEY,
  STREAM_EVENT_ROUND_KEY,
  STREAM_EVENT_SELECTED_KEY,
} from "../../features/comment-viewer/overlaySettings";
// 型のみの import（コンパイル時に消えるので vi.hoisted / vi.mock の巻き上げと競合しない）。
// ⚠ 明示的に型を付けないと `vi.fn(async () => null)` の戻り値が `Promise<null>` に推論され、
// 検出できたケース（`mockResolvedValue({...})`）が typecheck で落ちる。
import type { ObsWsConfig } from "../../features/comment-viewer/obsApi";

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

// ⚠⚠⚠ **064e: `autoAddToggle()` を削除した**——「OBS へ自動で反映」カードごと消えたため
//   （依頼者の指示＝「OBS に自動で反映はデフォルト機能にします」）。
//   ⚠ **この画面のトグルは 0 個になった**（061i で表示トグル、064e で自動反映トグル）。
//   ⚠⚠ **挙動そのものは消えていない**——ステージ窓の OBS 追加は**配信イベントを開始したら必ず走る**。
//   その検査は `CommentViewerApp.effects.test.tsx`（＝実際に走らせる窓）が持つ。
// ⚠ 061h: 「投げ銭でエフェクトを出す」トグルと「テスト表示」ボタンは**この画面から消えた**
//   （前者は組み込み演出の ON/OFF が本体で廃止／後者は `EffectTemplateCard` の各行へ移設）。
//   移設先のケースは `EffectTemplateCard.test.tsx` にある。
// ⚠⚠ 061i: 「エフェクトを配信画面に表示する」トグルも消えた（＝ヘルパごと削除した）。
//   窓を開く契機は「条件が 0 → 1 件」と「テスト表示」だけで、閉じる契機は明示のボタンだけ。

// ⚠⚠ **061p: `conditionStatus()` / `roundStatus()` / `windowStatus()` を削除した**
//   （「表示する条件」「開催中のイベント」「エフェクトのウィンドウ」の各行ごと画面から消えたため）。
//   ⇒ **観測点の付け替え**:
//     - 条件の件数 …… `STAGE_OVERLAY_ENABLED_KEY` と `openStageOverlayWindow` の呼ばれ方
//       （⚠ 064d でコーナー窓ぶんは消え、064 レビュー S-6 で `EFFECT_OVERLAY_ENABLED_KEY` も削除した）
//     - 窓の状態 …… `is*OverlayOpen` の**呼ばれた回数**（ポーリングが回っていること）と、
//       ⚠⚠ **`EffectTemplateCard` の「配信画面でテスト表示」がどちらの経路へ倒れるか**
//       （＝停止中なら保留旗を書く／表示中なら `storage` を撒く。これが窓の状態の唯一の実用途）
//     - 開催中のイベント …… 「配信イベント」タブの中の表示（残り時間・終了ボタン）と開催キー

/** 061l: 検査用イベントの id（⚠ 注入したレジストリから引く＝id を 2 か所へ書かない）。 */
const EVENT_ID = mocks.event.id;

/**
 * ポーリングが 1 周した（＝前提ステータスが state に入った）ことを待つ。
 * ⚠⚠ 064d: 観測点を `isStageOverlayOpen` から **`isCommentViewerOpen`** へ移した——
 *   窓の状態を使っていた唯一の用途（テスト表示の経路分岐）が取り込み機能ごと消えたので、
 *   いま残っているポーリングは**前提案内（コメビュ窓が開いているか）だけ**である。
 */
const waitForStatusPoll = async () => {
  await waitFor(() =>
    expect(mocks.isCommentViewerOpen.mock.calls.length).toBeGreaterThan(0),
  );
  await act(async () => {});
};

describe("061a: ObsEffectsScreen", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mocks.isStageOverlayOpen.mockResolvedValue(false);
    mocks.isStageOverlayOpen.mockResolvedValue(false);
    mocks.isCommentViewerOpen.mockResolvedValue(false);
    mocks.detectObsWebsocketConfig.mockResolvedValue(null);
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
    expect(
      screen.getByRole("heading", { name: "エフェクトを手動再生" }),
    ).toBeInTheDocument();
  });

  /**
   * ⚠⚠⚠ **063c 段 1 でこのケースを書き換えた**（理由は `docs/progress.md` の 063c 段 1 節が正）。
   *
   * 旧: 「この画面にトグルは 1 つも無い」（`queryAllByRole("switch")` が 0 件）。
   * ⚠⚠ **063c 段 1 でトグルが 1 つ増えた**（「ガチャの演出を配信画面に出す」）ので、
   * 件数 0 のままだと**このケースを消すしかなくなる**。⇒ **消さずに絞る。**
   *
   * ⚠ **旧ケースが本当に殺したかった変異は「064e が消した設定の復活」**である
   *   （＝「OBS へ自動で反映」トグルが戻ると、**OFF のときに配信イベントの窓が OBS へ出なくなり**、
   *   061l の玉入れが「開始したのに配信画面に何も出ない」へ戻る）。
   * ⇒ **件数ではなくアクセシブル名で見る**ようにした。これで
   *   ①旧トグル（「OBS へ自動で反映」「エフェクトを配信画面に表示」）の復活は**引き続きレッド**
   *   ②063c のトグルが増えても緑、が両立する。
   * ⚠⚠ **「switch が 0 件」へ戻さないこと**（戻すと 063c のトグルを消すことになる）。
   */
  it("⚠⚠ 064e / 061i: 廃止したトグル（自動反映・配信画面に表示）は戻ってこない", () => {
    render(<ObsEffectsScreen />);
    for (const gone of [
      "OBS へ自動で反映",
      "OBSに自動で反映する",
      "エフェクトを配信画面に表示",
    ]) {
      expect(screen.queryByRole("switch", { name: gone })).toBeNull();
    }
    // ⚠⚠⚠ **063c 段 4-d: 件数ではなく「名前の集合」で見るように変えた。**
    //   ⚠ 段 4-d でプレビュー用のスイッチが 1 つ増えたが、⚠⚠ **あれは設定ではない**
    //   （保存しない・配信画面に影響しない・OBS に触らない）。
    //   ⚠⚠⚠ **件数で見ていると「増えたら直す」だけの作業になり、
    //   増えたのが「OBS へ繋ぐ 3 つ目のトグル」でも同じように直されてしまう。**
    //   ⇒ **名前で見る**＝ 知らないトグルが増えた瞬間にレッドになる。
    //   ⚠ ここに名前を足すときは、**それが `docs/security.md` §1 のガードかどうか**を必ず書くこと。
    expect(
      screen.queryAllByRole("switch").map((el) => el.getAttribute("aria-label")),
    ).toEqual([
      // ⚠⚠⚠ **これだけが §1（044a 例外）のガードである**（ON で窓が開き OBS へ繋ぐ）。
      "ガチャの演出を配信画面に出す",
      // ⚠ プレビューの見え方を変えるだけ（保存しない）。
      "プレビューで「レア！」を出す",
    ]);
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
    // ⚠⚠⚠ **064c で並びを反転した（OBS のソース → 条件）。順序そのものが仕様である。**
    //   ⚠ 061p は「取り込みのカードは一番下へ」＝**取り込みは最初の 1 回だけ**だから、という
    //   理由で条件を先頭に置いていた。⚠⚠ **064d でその取り込み自体が消えた**ので根拠も消えている。
    //   いま先頭にあるのは「**OBS の一覧を取る**」＝ ①先にやらないと条件で 1 つも選べず
    //   ②OBS 側を編集するたびにやり直す操作である。
    //   ⇒ **逆順に戻すと、空の `<select>` を先に見せてその理由を下に書くことになる**
    //   （＝ 061a 以来の「黙って何も起きない状態を作らない」に反する）。**戻す変異をここで殺す。**
    const headings = screen
      .getAllByRole("heading", { level: 3 })
      .map((h) => h.textContent);
    // ⚠⚠ **064e: 3 つ目（「OBS へ自動で反映」）が消え、1 つ目の名前が変わった。**
    //   ⇒ **`slice` をやめて全件と比べる**——`slice(0, 3)` のままだと
    //   「カードが 1 枚戻ってきた」変異が**先頭 3 件が合っている限り生存する**（064e で実際に
    //   カードを消したので、件数そのものが仕様になった）。
    // ⚠⚠⚠ **063d で「ガチャ」が 3 枚目として増えた**（タブの外＝両タブから参照される共有物だから）。
    //   ⚠ **順序も仕様である**——ガチャは**タブの中の 2 枚より後**（＝共通の下部）に出ること。
    //   ⚠ タブの中へ動かす変異は、この並びが変わるのでここで落ちる。
    // ⚠⚠ **063c 段 4-d で「ガチャの演出」が 4 枚目として増えた**——
    //   依頼者の指摘（「項目が増えることで画面が複雑になってしまっている」）に対し、
    //   ⚠ **「何が当たるか」（ガチャ）と「どう見えるか」（ガチャの演出）で切った**結果である。
    //   ⚠⚠⚠ **順序も仕様**（演出はガチャの後）——先に置くと「まだ作っていないガチャの見た目」を
    //   先に設定させることになる。
    expect(headings).toEqual([
      "エフェクトを手動再生",
      "エフェクトを表示する条件",
      "ガチャ",
      "ガチャの演出",
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

  it("⚠⚠ 064e: §1 の停止導線は**両タブの外**にある（タブを切り替えても消えない）", async () => {
    // ⚠⚠ **061i の「OBS へ自動で反映は両タブの外」を、064e でこの導線へ引き継いだ。**
    //   あのカードは 064e で消えたが、**中に入っていた `docs/security.md` §1 の停止導線
    //   （main 窓側 1 か所）はカードの外へ出して残してある**。
    //   ⚠ タブの中へ入れると「配信イベントを見ているときだけ取得が止められる」と読める。
    mocks.isCommentViewerOpen.mockResolvedValue(false);
    render(<ObsEffectsScreen />);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "コメントビューアを開く" }),
      ).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("tab", { name: "配信イベント" }));

    expect(
      screen.getByRole("button", { name: "コメントビューアを開く" }),
    ).toBeInTheDocument();
  });

  // --- ⚠⚠⚠ 061p: 消えたものが戻ってこないこと -------------------------------------------------

  it("⚠⚠ 061p: 前提ステータスの 6 行が 1 つも出ない（情報過多の解消そのものが仕様）", async () => {
    // ⚠⚠ **指示＝「表示する条件などのステータスは全ていらない。情報が増えて UX が下がる」。**
    //   ⚠ 親切心で 1 行ずつ戻すと元の 6 行に戻るので、**まとめて固定する**。
    mocks.isStageOverlayOpen.mockResolvedValue(true);
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
    mocks.isStageOverlayOpen.mockResolvedValue(true);
    const { container } = render(<ObsEffectsScreen />);
    await waitForStatusPoll();

    expect(container.textContent).not.toContain("ウィンドウを閉じる");
    expect(container.textContent).not.toContain("ウィンドウを開く");
    expect(mocks.closeEffectOverlayWindow).not.toHaveBeenCalled();
    expect(mocks.closeStageOverlayWindow).not.toHaveBeenCalled();
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

  it("⚠⚠ 064e: この画面が OBS へ繋ぐ経路も窓を開く経路も持たない（045c の規律の後継）", async () => {
    // ⚠⚠ **045c の「自動反映トグルは設定を立てるだけ（窓を開かない）」を、064e でこの形へ移した。**
    //   トグルが消えたので「設定を立てるだけ」という言い方は成立しないが、
    //   **守りたい不変条件は残る＝この画面をただ開いても何も起きない**。
    //   ⚠ 044a の旧実装は「自動反映 ON だけで窓が開く」隠れた副作用を持っており、045c が回帰として削除した。
    //   ⚠ 窓を開くのは**配信イベントの開始だけ**（下の 061l のケース群が固定している）。
    render(<ObsEffectsScreen />);
    await waitForStatusPoll();

    expect(mocks.openEffectOverlayWindow).not.toHaveBeenCalled();
    expect(mocks.openStageOverlayWindow).not.toHaveBeenCalled();
    expect(mocks.closeEffectOverlayWindow).not.toHaveBeenCalled();
    // ⚠⚠ **派生値も勝手に動かない**（`STAGE_OVERLAY_ENABLED_KEY` の書き手は
    //   開始／終了ハンドラだけ＝画面を開いただけで書いたら「2 つの真実」ができる）。
    expect(localStorage.getItem(STAGE_OVERLAY_ENABLED_KEY)).toBeNull();
  });

  it("⚠⚠ 064f: コメビュ窓が閉じているとき、専用機能である旨の案内と導線が出る", async () => {
    // ⚠⚠⚠ **064f で文面を丸ごと入れ替えた**（依頼者＝「裏の処理をユーザーに意識させる必要がない」）。
    //   旧文は「OBS への操作は行われません／取得が続く／止め方」＝ `docs/security.md` §1 の停止導線で、
    //   **§1 側を改訂して `MainScreen` の 1 か所に絞った**（下の「消えたもの」のケースが正）。
    mocks.isCommentViewerOpen.mockResolvedValue(false);
    render(<ObsEffectsScreen />);

    await waitFor(() =>
      expect(
        screen.getByText(/コメントビューア for\s*StreamDock/),
      ).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "コメントビューアを開く" }));
    await waitFor(() =>
      expect(mocks.openCommentViewerWindow).toHaveBeenCalledTimes(1),
    );
  });

  it("⚠ 064f: コメビュ窓が開いていれば案内は出さない（開いているのに「起動して」と言わない）", async () => {
    // ⚠ 061a レビュー Q-1 の規律＝**約束できることだけ書く**。開いている人に
    //   「起動してください」を出すのは、それ自体が嘘である。
    mocks.isCommentViewerOpen.mockResolvedValue(true);
    render(<ObsEffectsScreen />);
    await waitForStatusPoll();

    expect(screen.queryByText(/コメントビューア for\s*StreamDock/)).toBeNull();
    expect(
      screen.queryByRole("button", { name: "コメントビューアを開く" }),
    ).toBeNull();
  });

  // --- ⚠⚠ 064f: 取得ボタンがタイトル行へ移った ------------------------------------------------

  it("⚠⚠ 064f: 「最新のOBSのソースを取得」はタイトル行にあり、押すと依頼だけを書く", async () => {
    // ⚠⚠ **main 窓は OBS へ触らない**——やるのは localStorage へ nonce を書くことだけで、
    //   実際に投げるのはコメビュ窓である（構造上の非対称）。
    mocks.isCommentViewerOpen.mockResolvedValue(true);
    render(<ObsEffectsScreen />);
    await waitForStatusPoll();

    const button = screen.getByRole("button", {
      name: "最新のOBSのソースを取得",
    });
    // ⚠ タイトル行＝`<h2>OBSエフェクト</h2>` と同じ行（`layout.top`）に居ること。
    expect(button.closest("div")?.parentElement).toBe(
      screen.getByRole("heading", { name: "OBSエフェクト" }).closest("div")
        ?.parentElement,
    );
    expect(localStorage.getItem(OBS_SOURCE_LIST_REQUEST_KEY)).toBeNull();

    fireEvent.click(button);

    expect(localStorage.getItem(OBS_SOURCE_LIST_REQUEST_KEY)).not.toBeNull();
  });

  it("⚠⚠ 064f: ボタンとカードが同じ状態を見る（押したらカードが「取得しています」になる）", async () => {
    // ⚠⚠⚠ **これが 064f でフックへ切り出した理由そのもの。** ボタン（タイトル行）と
    //   カード（一覧・案内）が別々の state を持つと、**押したのにカードが反応しない**という
    //   食い違いが構造的に作れてしまう（061d-2 レビュー Q-9 と同型）。
    mocks.isCommentViewerOpen.mockResolvedValue(true);
    render(<ObsEffectsScreen />);
    await waitForStatusPoll();

    fireEvent.click(
      screen.getByRole("button", { name: "最新のOBSのソースを取得" }),
    );

    expect(screen.getByText(/取得しています/)).toBeInTheDocument();
    // ⚠ 返事待ちの二度押しはできない。
    expect(
      screen
        .getByRole("button", { name: "最新のOBSのソースを取得" })
        .closest("button")?.disabled,
    ).toBe(true);
  });

  it("⚠⚠ 064c/064f: コメビュ窓が閉じていれば取得ボタンは押せない（8 秒待たせない）", async () => {
    // ⚠⚠ **この配線が切れても typecheck は通る**ので、**画面から観測できる形で固定する**。
    //   切れるとボタンがいつでも押せてしまい、押しても依頼が誰にも届かない
    //   （＝ 8 秒待って「応答がありません」としか言えない）。
    mocks.isCommentViewerOpen.mockResolvedValue(false);
    render(<ObsEffectsScreen />);

    await waitFor(() =>
      expect(screen.getByText(/コメントビューアを開くと/)).toBeInTheDocument(),
    );
    expect(
      screen
        .getByRole("button", { name: "最新のOBSのソースを取得" })
        .closest("button")?.disabled,
    ).toBe(true);
  });

  it("⚠ 064f: コメビュ窓が書き戻したら（storage）一覧が画面に出る", async () => {
    // ⚠ 購読はフック（`useObsSourceList`）が持つ。⚠ `storage` は**他窓での書換**でだけ飛ぶので、
    //   この購読が拾うのは常にコメビュ窓の書き込みである。
    mocks.isCommentViewerOpen.mockResolvedValue(true);
    render(<ObsEffectsScreen />);
    await waitForStatusPoll();
    expect(screen.queryByText("あとから来た演出")).toBeNull();

    localStorage.setItem(
      OBS_SOURCE_LIST_KEY,
      JSON.stringify({
        at: Date.now(),
        ok: true,
        sources: [{ name: "あとから来た演出", kind: "ffmpeg_source" }],
      }),
    );
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", { key: OBS_SOURCE_LIST_KEY }),
      );
    });

    // ⚠⚠ **2 か所に出る**（手動再生カードの一覧 ＋ 条件カードの `<select>` の選択肢）。
    //   ⚠ どちらも同じ localStorage を読むので、これは食い違いではなく**期待どおり**である
    //   （購読はフックと `EffectAssignmentCard` が別々に持つ＝どちらか片方だけが更新されない）。
    expect(screen.getAllByText("あとから来た演出").length).toBeGreaterThanOrEqual(2);
  });

  /**
   * ⚠⚠⚠ **064f: `docs/security.md` §1 の停止導線をこの画面から外した**（依頼者の指示＝
   * 「裏の処理をユーザーに意識させる必要がない」）。⇒ **061b / 061p の 3 ケースを 1 本へ畳んだ。**
   *
   * ## ⚠⚠ なぜ §1 を後退させずに消せたのか
   *
   * §1 が要求するのは「**取得が続いていることと、その止め方**を明示する導線を保つこと」で、
   * 061k 以降その導線は**この画面と `MainScreen` の 2 か所**にあった。
   * ⚠⚠ **この画面側は `viewerOpen === false` のときに「取得が続く」と無条件に言っていた**が、
   * **実際に続くのはステージ窓が開いているときだけ**である（sidecar の消費者は
   * `comment-viewer` と `stage-overlay` の 2 つ）。⇒ **ほとんどの場合、案内は不正確だった。**
   * 一方 `MainScreen` は `isStageOverlayOpen()` を**実際に見て**文言を出し分けている＝**正確**。
   * ⇒ **精度の低い方を消し、高い方（`MainScreen`）だけを残した**（§1 は「導線は 1 か所」へ改訂済み）。
   * ⚠ **`MainScreen` 側は無改変**。**「片方だけ直さない」の対象がその 1 か所になった。**
   *
   * ⚠⚠ **ここで固定するのは「旧文言が戻ってこないこと」**——親切心で書き戻すと、
   * ①不正確な案内が復活し ②§1 の導線が「2 か所で食い違う」状態に戻る。
   */
  it("⚠⚠⚠ 064f: §1 の停止導線と、その周辺の旧文言が戻ってこない", async () => {
    mocks.isCommentViewerOpen.mockResolvedValue(false);
    const { container } = render(<ObsEffectsScreen />);

    await waitFor(() =>
      expect(
        screen.getByText(/コメントビューア for\s*StreamDock/),
      ).toBeInTheDocument(),
    );

    // 064f で消した §1 の 2 要素（①取得が続く ②止め方）。⚠ 持ち主は `MainScreen` だけになった。
    expect(container.textContent).not.toContain("コメントの取得が続く");
    expect(container.textContent).not.toContain("取得を停止してください");
    // 061b が「嘘になった」として消した文（061a の名残）。
    expect(container.textContent).not.toContain("エフェクトも表示されません");
    // 061b レビュー Q-1 が「条件が足りない」として書き直した文。
    expect(container.textContent).not.toContain("エフェクトの表示そのものは");
    // ⚠⚠ 061i レビュー S-1／061p で 2 度発火した「廃止した操作を案内する」失敗モード。
    expect(container.textContent).not.toContain("ウィンドウを閉じる");
    expect(container.textContent).not.toContain("2 つとも");
  });

  /**
   * ⚠⚠⚠ **064e: 「OBS へ自動で反映」カードを丸ごと削除した**（依頼者の指示＝
   * 「OBS に自動で反映はデフォルト機能にします」）。
   *
   * ⚠ 一緒に消えた 061e(4) の注記（「失敗したときだけ赤い文字が出ます」）と 061p の窓名 note の
   * **2 ケースを、下の 1 ケースへ畳んである**。
   * ⚠⚠ **「消えたことを固定する」のが目的**——061e/061p はどちらも「文言が嘘に戻る」変異を
   * 殺すために書かれたケースで、**カードごと消えたいま守るべきは「カードが戻らないこと」**である
   * （戻すなら、それは設定を復活させる＝§1 の姿勢を戻す判断であり、UI の話ではない）。
   */
  it("⚠⚠⚠ 064e: 「OBS へ自動で反映」カードが戻ってこない（既定 ON は設定ではない）", async () => {
    mocks.isCommentViewerOpen.mockResolvedValue(true);
    const { container } = render(<ObsEffectsScreen />);
    await waitForStatusPoll();

    expect(
      screen.queryByRole("heading", { name: "OBS へ自動で反映" }),
    ).toBeNull();
    // ⚠ カードが持っていた文言（061e(4) の注記）も戻らない。
    expect(container.textContent).not.toContain("失敗したときだけ");
    // ⚠⚠⚠ **063c 段 1: 「ウィンドウキャプチャ」の否定を外した**（理由は progress.md の 063c 段 1 節）。
    //   旧ケースはこの語を **064e が消したカードの痕跡**として使っていたが、
    //   ⚠ 063c 段 1 のトグルの説明が**同じ語を正当に使う**（ON にすると OBS に
    //   「ウィンドウキャプチャ」のソースが作られる、という**起きることの説明**）。
    //   ⇒ **語の否定ではなく、カードの同一性（見出し・固有の文言・トグル名）で見る。**
    //   ⚠ **語の否定へ戻さないこと**——戻すと「何が起きるか説明しない」方向へ倒れ、
    //   061a Q-1（黙って何かが起きる状態を作らない）に反する。
    expect(container.textContent).not.toContain("OBSに自動で反映する");
    // ⚠⚠ **旧トグルを戻す変異は名前で殺す**（件数では 063c のトグルと区別できない）。
    expect(screen.queryByRole("switch", { name: "OBS へ自動で反映" })).toBeNull();
  });

  it("⚠ 064e: コメビュ窓が開いていれば前提案内も出ない（この画面は静か）", async () => {
    // ⚠⚠ **061e 穴 2 の役割分担のうち「常時側」が 064e で無くなった**——
    //   カードの注記が消えたので、**この画面の恒常テキストは見出しと入力だけ**になった。
    //   ⚠ 「いま何が足りないか」を出す条件付きの案内（前提案内・`ObsSourceCard` の状態）は健在。
    mocks.isCommentViewerOpen.mockResolvedValue(true);
    const { container } = render(<ObsEffectsScreen />);
    await waitForStatusPoll();

    expect(container.textContent).not.toContain("取得を停止してください");
    expect(container.textContent).not.toContain(
      "コメントビューアを開くと、そのときに反映されます",
    );
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
    const callsAtMount = mocks.isCommentViewerOpen.mock.calls.length;
    expect(callsAtMount).toBeGreaterThan(0);

    // 1 周期進めるとポーリングが増えることを確かめてから……
    await vi.advanceTimersByTimeAsync(2000);
    expect(mocks.isCommentViewerOpen.mock.calls.length).toBeGreaterThan(
      callsAtMount,
    );
    const callsBeforeUnmount = mocks.isCommentViewerOpen.mock.calls.length;

    // ⚠ 本命: アンマウント後は何周期進めても 1 回も増えないこと（clearInterval が効いている）。
    unmount();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.isCommentViewerOpen.mock.calls.length).toBe(callsBeforeUnmount);
  });

  /** 061l: 「配信イベント」タブを、イベントを適用した状態で開く。 */
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
    // ③ ⚠⚠ **064d: 派生値とガイドの旗はここが唯一の書き手になった**
    //    （旧: `useEffectTemplates` が「stage 条件が 1 件以上あるか」として書いていた）。
    //    ⚠ これが無いと **OBS への自動追加が起きず、セットアップ用ガイドも二度と出ない**
    //    ＝ ユーザーが OBS でこの窓を見つけられない（黙って壊れる）。
    expect(localStorage.getItem(STAGE_OVERLAY_ENABLED_KEY)).toBe("true");
    expect(localStorage.getItem(EFFECT_OVERLAY_GUIDE_PENDING_KEY)).toBe("true");
  });

  it("⚠⚠ 064d: 「終了」で派生値を false へ戻す（OBS のソースは非表示になるだけ）", () => {
    openEventTabWithApplied();
    fireEvent.click(screen.getByRole("button", { name: "開始" }));
    expect(localStorage.getItem(STAGE_OVERLAY_ENABLED_KEY)).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "終了" }));
    expect(localStorage.getItem(STAGE_OVERLAY_ENABLED_KEY)).toBe("false");
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

  /**
   * ⚠⚠⚠ **064 レビュー S-1（修正の回帰テスト）: 旗を落とす契機は「終了」だけではない。**
   *
   * `STAGE_OVERLAY_ENABLED_KEY` は 064e 以降 **`docs/security.md` §1（044a 例外）を守る
   * 唯一のガード**で、§1 の追補は「**旗 true ＝ ユーザーが『開始』を押した**」という同値を
   * 根拠にしている。⚠ 旧実装は `handleEndRound` でしか false にしておらず、
   * **「終了」を押さずに時間切れになると旗が永久に true** で残っていた。
   *
   * 壊れ方＝ 再起動 → `restoreEffectOverlayWindow` がステージ窓を復元 →
   * WS 接続時 reconcile が `enableObs("stage")` を送る ＝
   * **そのセッションでの明示操作ゼロで OBS へ繋ぐ**。
   * ⚠⚠ **下の 2 ケースのどちらかを消すと、その同値が黙って偽に戻る。**
   */
  it("⚠⚠⚠ S-1: 期限切れの tick でも派生値を false へ戻す（§1 の唯一のガード）", async () => {
    vi.useFakeTimers();
    localStorage.setItem(STREAM_EVENT_SELECTED_KEY, EVENT_ID);
    render(<ObsEffectsScreen />);
    fireEvent.click(screen.getByRole("tab", { name: "配信イベント" }));
    fireEvent.click(screen.getByRole("button", { name: "開始" }));
    expect(localStorage.getItem(STAGE_OVERLAY_ENABLED_KEY)).toBe("true");

    // ⚠ 「終了」を**押さずに**時間切れにする（実運用で最も普通に起きる終わり方）。
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000 + 10_000);
    });

    expect(localStorage.getItem(STREAM_EVENT_ROUND_KEY)).toBeNull();
    // ⚠⚠ **開催キーと対で落ちること**（`saveStageOverlayEnabled(false)` を消すと RED）。
    expect(localStorage.getItem(STAGE_OVERLAY_ENABLED_KEY)).toBe("false");
  });

  it("⚠⚠⚠ S-1: 開催していないのに旗が残っていたら、マウント時に直す", async () => {
    // ⚠ 「開催中に main 窓を閉じた／アプリを終了した」＝ tick が走らないまま期限が過ぎた状態。
    //   ⚠⚠ 保存値は期限切れなので `parseStreamEventRound` が落とす（＝開催していない）が、
    //   **旗だけが true で取り残されている**。
    localStorage.setItem(
      STREAM_EVENT_ROUND_KEY,
      JSON.stringify({ eventId: EVENT_ID, startedAt: 0, endsAt: 1 }),
    );
    localStorage.setItem(STAGE_OVERLAY_ENABLED_KEY, "true");

    render(<ObsEffectsScreen />);
    await act(async () => {});

    expect(localStorage.getItem(STAGE_OVERLAY_ENABLED_KEY)).toBe("false");
  });

  it("⚠⚠ S-1: 開催中に画面を開いても旗は落とさない（掃除が開催を殺さない）", async () => {
    // ⚠⚠ **修復が行きすぎていないことの裏取り**——ここが落ちると
    //   「配信中に main 窓でこの画面を開いたら OBS のソースが消える」になる。
    const now = Date.now();
    localStorage.setItem(
      STREAM_EVENT_ROUND_KEY,
      JSON.stringify({ eventId: EVENT_ID, startedAt: now, endsAt: now + 120_000 }),
    );
    localStorage.setItem(STAGE_OVERLAY_ENABLED_KEY, "true");

    render(<ObsEffectsScreen />);
    await act(async () => {});

    expect(localStorage.getItem(STAGE_OVERLAY_ENABLED_KEY)).toBe("true");
  });

  it("⚠⚠ S-1: 未開催・旗も未設定なら 1 バイトも書かない（画面を開いただけで OBS を触らない）", async () => {
    // ⚠⚠⚠ **無条件に `saveStageOverlayEnabled(false)` を打つ実装をここで殺す。**
    //   打つと、コメビュ窓の `storage` 購読が **画面を開くたびに `hideObs("stage")` を OBS へ送る**
    //   ＝ユーザーが何もしていないのに OBS を触りに行く（§1 の姿勢に反する）。
    render(<ObsEffectsScreen />);
    await act(async () => {});

    expect(localStorage.getItem(STAGE_OVERLAY_ENABLED_KEY)).toBeNull();
  });

  // --- 063c 段 1: 2 本目の旗（ガチャ演出の明示トグル）の書き手 ---------------------------------

  /**
   * ⚠⚠⚠ **`docs/security.md` §1（044a 例外）が認める 2 つ目の明示操作の、実装側の固定。**
   *
   * ⚠ トグルそのもの（既定 OFF・押せる条件・文言）は `GachaLibraryCard.test.tsx` が固定している。
   * ここが見るのは **この画面が「旗の唯一の書き手」であること**と、
   * **ON が `handleStartRound` と同じ 3 点セット**（旗 → ガイド旗 → 窓を開く）であることの 2 つ。
   */

  /** ガチャを 1 件作り、スパチャの条件へ割り当てる（＝トグルが押せる状態を作る）。 */
  const enableGachaToggleTarget = () => {
    fireEvent.click(screen.getByRole("button", { name: "ガチャを作る" }));
    fireEvent.change(screen.getByLabelText("スーパーチャット・ビッツのエフェクト"), {
      target: { value: "gacha:g:1" },
    });
  };
  const gachaToggle = () =>
    screen.getByRole("switch", { name: "ガチャの演出を配信画面に出す" });

  it("⚠⚠⚠ 063c: トグル ON で旗が立ち、ステージ窓が開く（明示操作＝§1 の契機）", async () => {
    render(<ObsEffectsScreen />);
    enableGachaToggleTarget();
    // ⚠ この時点ではまだ何も起きていない（割り当てただけでは窓は開かない）。
    expect(mocks.openStageOverlayWindow).not.toHaveBeenCalled();
    expect(localStorage.getItem(GACHA_STAGE_ENABLED_KEY)).toBeNull();

    fireEvent.click(gachaToggle());
    await act(async () => {});

    expect(localStorage.getItem(GACHA_STAGE_ENABLED_KEY)).toBe("true");
    expect(mocks.openStageOverlayWindow).toHaveBeenCalledTimes(1);
    // ⚠⚠ **ガイド旗も立つ**（061a Q-1＝明示操作で窓を開くときだけ。`handleStartRound` と同じ）。
    expect(localStorage.getItem(EFFECT_OVERLAY_GUIDE_PENDING_KEY)).toBe("true");
    // ⚠⚠⚠ **061l の旗には 1 バイトも触らない**（旗を共用すると、配信イベントの終了が
    //   ガチャ演出を黙って止める／画面を開くたびにガチャの旗が消える）。
    expect(localStorage.getItem(STAGE_OVERLAY_ENABLED_KEY)).toBeNull();
  });

  it("⚠⚠ 063c: トグル OFF で旗は落ちるが、窓は閉じない（親 046 の規律）", async () => {
    render(<ObsEffectsScreen />);
    enableGachaToggleTarget();
    fireEvent.click(gachaToggle());
    await act(async () => {});

    fireEvent.click(gachaToggle());
    await act(async () => {});

    expect(localStorage.getItem(GACHA_STAGE_ENABLED_KEY)).toBe("false");
    // ⚠⚠ **配信中に窓が消えると OBS のウィンドウキャプチャが真っ黒になる。**
    //   OBS 側のソースは `CommentViewerApp` が `hideObs("stage")` で非表示にするだけ（削除しない）。
    expect(mocks.closeStageOverlayWindow).not.toHaveBeenCalled();
    // ⚠ 窓を開き直しもしない（OFF は「開く」の反対ではない）。
    expect(mocks.openStageOverlayWindow).toHaveBeenCalledTimes(1);
  });

  it("⚠⚠⚠ 063c: ガチャを割り当てただけでは旗も窓も動かない（064d が消した派生値を戻さない）", async () => {
    render(<ObsEffectsScreen />);
    enableGachaToggleTarget();
    await act(async () => {});

    // ⚠⚠ **061i にあり 064d が hook ごと削除した「条件が 0 → 1 件で旗が立つ」の復活をここで殺す。**
    expect(localStorage.getItem(GACHA_STAGE_ENABLED_KEY)).toBeNull();
    expect(localStorage.getItem(STAGE_OVERLAY_ENABLED_KEY)).toBeNull();
    expect(mocks.openStageOverlayWindow).not.toHaveBeenCalled();
    expect(localStorage.getItem(EFFECT_OVERLAY_GUIDE_PENDING_KEY)).toBeNull();
  });

  it("⚠⚠ 063c: 画面を開いただけではガチャの旗に 1 バイトも書かない", async () => {
    // ⚠ 061l 側の「取り残し修復」と違い、こちらは**掃除する対象が無い**
    //   （常設トグルなので「取り残し」という状態が存在しない）。
    //   ⇒ マウント時に false を書く実装を足すと、**ユーザーの設定を毎回消す**ことになる。
    localStorage.setItem(GACHA_STAGE_ENABLED_KEY, "true");
    render(<ObsEffectsScreen />);
    await act(async () => {});

    expect(localStorage.getItem(GACHA_STAGE_ENABLED_KEY)).toBe("true");
  });

  // ⚠⚠ **061p: 「「開催中のイベント」行は共通領域にある」を削除した**（行ごと廃止）。
  //   ⚠ **開催状態の持ち主が `ObsEffectsScreen` であること自体は変えていない**
  //   （タブへ props で渡し、開始のステージ窓 open もこの画面のキューを通る＝上のケース群が固定）。

  /**
   * ⚠⚠⚠ **レビュー Q-3: 063d のガチャ移行が「子より先に走る」ことを、ここだけが固定する。**
   *
   * `ObsEffectsScreen` は `runGachaMigration()` を **`useState` の初期化関数**で呼ぶ。
   * ⚠ `useEffect` へ動かすと **effect は子の render の後に走る**ので、
   * `EffectAssignmentCard` が**移行前の保存値**を読み、`parseAssignment` が 063a 形式を
   * 「出さない」へ落とした結果を state に固めてしまう（＝割り当てが黙って消える）。
   *
   * ⚠⚠ **この 1 本を書くまで、その順序依存を守る検査は 1 つも無かった**
   * （`GachaPrizeTable.test.tsx` / `GachaLibraryCard.test.tsx` のハーネスは
   * **同じ形を真似ているだけ**で、本物の画面が壊れても緑のまま通る）。
   * ⚠ **実測**: `useEffect` へ動かす変異でこのケースだけが `value === "none"` で落ちる。
   * ⚠⚠⚠ **このケースを消さないこと。**
   */
  it("⚠⚠⚠ Q-3: 063a 形式で開くと、条件の <select> が移行後のガチャを指す（移行は子より先）", () => {
    localStorage.setItem(
      EFFECT_ASSIGNMENTS_KEY,
      JSON.stringify([
        {
          id: "event:superchat",
          when: { type: "event", eventType: "superchat" },
          effect: {
            kind: "gacha",
            prizes: [{ name: "大当たり", weight: 100, sourceName: "きらきら演出" }],
          },
        },
      ]),
    );
    render(<ObsEffectsScreen />);
    expect(
      (
        screen.getByLabelText(
          "スーパーチャット・ビッツのエフェクト",
        ) as HTMLSelectElement
      ).value,
    ).toBe("gacha:g:1");
  });
});
