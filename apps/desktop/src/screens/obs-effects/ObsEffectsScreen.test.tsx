import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { ObsEffectsScreen } from "./ObsEffectsScreen";
import {
  EFFECT_OVERLAY_ENABLED_KEY,
  EFFECT_OBS_AUTO_ADD_KEY,
  EFFECT_OVERLAY_GUIDE_PENDING_KEY,
  EFFECT_MONETARY_ENABLED_KEY,
  EFFECT_TEST_FIRE_KEY,
} from "../../features/comment-viewer/overlaySettings";
// 型のみの import（コンパイル時に消えるので vi.hoisted / vi.mock の巻き上げと競合しない）。
// ⚠ 明示的に型を付けないと `vi.fn(async () => null)` の戻り値が `Promise<null>` に推論され、
// 検出できたケース（`mockResolvedValue({...})`）が typecheck で落ちる。
import type { ObsWsConfig } from "../../features/comment-viewer/obsApi";

/**
 * 061a: main 窓の「OBSエフェクト」画面の仕様テスト。
 *
 * あるべき挙動:
 * - **表示トグル**は窓の open/close を**この画面が直接 invoke する**（コメビュ窓に依存しない）。
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
  isCommentViewerOpen: vi.fn(async () => false),
  openCommentViewerWindow: vi.fn(async () => {}),
  detectObsWebsocketConfig: vi.fn(async (): Promise<ObsWsConfig | null> => null),
}));

// ⚠ モジュールを丸ごと差し替えるので、書かなかった export は undefined になる。この画面が踏まない
// ものも含めて実モジュールの export 面を埋める（将来この画面が直接 import し始めたときに
// 「値が静かに undefined」でテストが通ったまま壊れるのを防ぐ・既存テストと同じ方針）。
vi.mock("../../features/comment-viewer/windowApi", () => ({
  openEffectOverlayWindow: mocks.openEffectOverlayWindow,
  closeEffectOverlayWindow: mocks.closeEffectOverlayWindow,
  isEffectOverlayOpen: mocks.isEffectOverlayOpen,
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

const displayToggle = () =>
  screen.getByRole("switch", { name: "エフェクトを配信画面に表示する" });
const autoAddToggle = () =>
  screen.getByRole("switch", {
    name: "エフェクトのウィンドウを OBS へ自動で追加する",
  });
const monetaryToggle = () =>
  screen.getByRole("switch", { name: "投げ銭でエフェクトを出す" });
const testFireButton = () =>
  screen.getByRole("button", { name: "テスト表示" });

describe("061a: ObsEffectsScreen", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mocks.isEffectOverlayOpen.mockResolvedValue(false);
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
    render(<ObsEffectsScreen />);
    expect(screen.getByRole("heading", { name: "OBSエフェクト" })).toBeInTheDocument();
    expect(screen.queryByText(/準備中/)).toBeNull();
    expect(displayToggle()).toBeInTheDocument();
    expect(autoAddToggle()).toBeInTheDocument();
  });

  it("既定は 3 つのトグルとも OFF", () => {
    render(<ObsEffectsScreen />);
    expect(displayToggle()).toHaveAttribute("aria-checked", "false");
    expect(autoAddToggle()).toHaveAttribute("aria-checked", "false");
    // ⚠ 061b: 配信画面に出るものは既定で出さない。
    expect(monetaryToggle()).toHaveAttribute("aria-checked", "false");
  });

  // --- 061b: 投げ銭エフェクトのトグルとテスト発火 -------------------------------------------------

  it("⚠ 投げ銭トグルは設定を立てるだけ（窓を開かない・045c の規律）", () => {
    render(<ObsEffectsScreen />);
    fireEvent.click(monetaryToggle());

    expect(localStorage.getItem(EFFECT_MONETARY_ENABLED_KEY)).toBe("true");
    expect(mocks.openEffectOverlayWindow).not.toHaveBeenCalled();
    expect(mocks.closeEffectOverlayWindow).not.toHaveBeenCalled();
    // 他の 2 つのトグルを巻き添えにしない（3 つの設定は独立）。
    expect(displayToggle()).toHaveAttribute("aria-checked", "false");
    expect(autoAddToggle()).toHaveAttribute("aria-checked", "false");
  });

  it("投げ銭トグルの永続値を読み直す（次に画面を開いたときも ON のまま）", () => {
    localStorage.setItem(EFFECT_MONETARY_ENABLED_KEY, "true");
    render(<ObsEffectsScreen />);
    expect(monetaryToggle()).toHaveAttribute("aria-checked", "true");
  });

  it("⚠⚠ テスト発火が localStorage へ書くのは nonce だけ（第三者データを載せない・§9）", () => {
    // ⚠ ここが本命。⚠ **エフェクトの中身（名前・金額）を書くと §9 追補〔046a〕の対象になる**——
    //   廃止した `effectQueue` はまさにそれをやる設計だった。合図だけを送り、中身は
    //   エフェクト窓側の固定ダミーから作る、という線引きをここで固定する。
    render(<ObsEffectsScreen />);
    fireEvent.click(testFireButton());

    const value = localStorage.getItem(EFFECT_TEST_FIRE_KEY);
    expect(value).not.toBeNull();
    // 中身らしきものが 1 つも載っていないこと（数字とハイフンだけの nonce）。
    expect(value).toMatch(/^\d+-\d+$/);
  });

  it("⚠ テスト発火は連打のたびに違う値になる（同値だと storage イベントが飛ばない）", () => {
    render(<ObsEffectsScreen />);
    fireEvent.click(testFireButton());
    const first = localStorage.getItem(EFFECT_TEST_FIRE_KEY);
    fireEvent.click(testFireButton());
    const second = localStorage.getItem(EFFECT_TEST_FIRE_KEY);
    expect(second).not.toBe(first);
  });

  it("⚠ テスト発火は窓を開かない・OBS へも繋がない（合図を書くだけ）", () => {
    render(<ObsEffectsScreen />);
    fireEvent.click(testFireButton());
    expect(mocks.openEffectOverlayWindow).not.toHaveBeenCalled();
    expect(mocks.detectObsWebsocketConfig).not.toHaveBeenCalledTimes(2);
  });

  it("⚠ エフェクト窓が停止中なら、テスト発火しても何も出ないことを案内する", async () => {
    // ⚠ 「黙って何も起きない」を作らないための注記（061a の前提ステータスと同じ趣旨）。
    mocks.isEffectOverlayOpen.mockResolvedValue(false);
    render(<ObsEffectsScreen />);
    await waitFor(() => expect(screen.getByText("停止中")).toBeInTheDocument());
    expect(
      screen.getByText(/エフェクトのウィンドウが停止中のため/),
    ).toBeInTheDocument();
  });

  it("エフェクト窓が表示中ならその注記は出さない", async () => {
    mocks.isEffectOverlayOpen.mockResolvedValue(true);
    render(<ObsEffectsScreen />);
    await waitFor(() => expect(screen.getByText("表示中")).toBeInTheDocument());
    expect(screen.queryByText(/エフェクトのウィンドウが停止中のため/)).toBeNull();
  });

  it("表示トグル ON で窓を開き、設定を永続化する", async () => {
    render(<ObsEffectsScreen />);
    fireEvent.click(displayToggle());

    await waitFor(() =>
      expect(mocks.openEffectOverlayWindow).toHaveBeenCalledTimes(1),
    );
    expect(mocks.closeEffectOverlayWindow).not.toHaveBeenCalled();
    expect(localStorage.getItem(EFFECT_OVERLAY_ENABLED_KEY)).toBe("true");
  });

  it("表示トグル OFF で窓を閉じる（設定も false になる）", async () => {
    localStorage.setItem(EFFECT_OVERLAY_ENABLED_KEY, "true");
    render(<ObsEffectsScreen />);
    expect(displayToggle()).toHaveAttribute("aria-checked", "true");

    fireEvent.click(displayToggle());
    await waitFor(() =>
      expect(mocks.closeEffectOverlayWindow).toHaveBeenCalledTimes(1),
    );
    expect(localStorage.getItem(EFFECT_OVERLAY_ENABLED_KEY)).toBe("false");
  });

  it("⚠ 自動反映トグルは設定を立てるだけ（窓を開かない・045c の規律）", async () => {
    render(<ObsEffectsScreen />);
    fireEvent.click(autoAddToggle());

    expect(localStorage.getItem(EFFECT_OBS_AUTO_ADD_KEY)).toBe("true");
    // ⚠ ここが本命。044a の旧実装は「自動反映 ON だけで窓が開く」隠れた副作用を持っていた。
    expect(mocks.openEffectOverlayWindow).not.toHaveBeenCalled();
    expect(mocks.closeEffectOverlayWindow).not.toHaveBeenCalled();
    // 表示トグルも巻き添えで ON にならない（2 つの設定は独立）。
    expect(displayToggle()).toHaveAttribute("aria-checked", "false");
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
        /エフェクトのウィンドウを表示したまま[\s\S]*閉じた場合は[\s\S]*続きます/,
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

  it("⚠ 表示トグルの連打は直列化され、最後の意図（OFF）が実窓に勝つ", async () => {
    // ⚠ `open_effect_overlay_window` は `#[tauri::command(async)]`（別スレッド・窓生成で数百 ms）、
    // close は同期コマンド。直列化が無いと「close が『窓なし＝no-op』で先に流れ、その後 open が窓を作る」
    // 順序が起こりうる（＝設定 OFF なのに窓が OBS に映り続ける・自動 close 経路が無いので解消しない）。
    // ここでは open だけを遅く解決させ、**close がその完了後に走る**ことを固定する。
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

    render(<ObsEffectsScreen />);
    fireEvent.click(displayToggle()); // ON
    // ⚠ open は `effectOverlayOpRef` の `.then` の中で呼ばれる＝**マイクロタスクを 1 つ挟む**ので、
    // ここで流さないと `resolveOpen` がまだ未定義のまま先へ進んでしまう（実装時に踏んだ）。
    await act(async () => {});
    expect(resolveOpen).toBeDefined(); // open が呼ばれ、未解決のまま滞留している

    fireEvent.click(displayToggle()); // OFF（直列化されていれば open の完了を待つ）
    expect(order).toEqual([]); // どちらもまだ走り終わっていない

    // ⚠ `waitFor`（実タイマー・既定 1s）は使わない。open の解決後に走るのは
    // 「refreshStatus → close → refreshStatus」という**マイクロタスクの連なりだけ**なので、
    // `act` で流し切れば結果は決定的になる。フルスイートの負荷で 1s を跨ぐ flaky を持ち込まないため。
    await act(async () => resolveOpen?.());
    await act(async () => {});
    expect(order).toEqual(["open", "close"]);
    // 永続値は最後の意図（OFF）。
    expect(localStorage.getItem(EFFECT_OVERLAY_ENABLED_KEY)).toBe("false");
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

  it("⚠ セットアップ用ガイドの旗は表示 ON のときだけ立つ（起動時復元では出さないため）", async () => {
    render(<ObsEffectsScreen />);
    // OFF → ON。
    fireEvent.click(displayToggle());
    expect(localStorage.getItem(EFFECT_OVERLAY_GUIDE_PENDING_KEY)).toBe("true");

    // ⚠ ON → OFF では立てない（OFF は窓を閉じる操作でガイドの出番が無い）。
    localStorage.setItem(EFFECT_OVERLAY_GUIDE_PENDING_KEY, "false");
    fireEvent.click(displayToggle());
    expect(localStorage.getItem(EFFECT_OVERLAY_GUIDE_PENDING_KEY)).toBe("false");

    // ⚠ 自動反映トグルでも立てない（窓を開かないので）。
    fireEvent.click(autoAddToggle());
    expect(localStorage.getItem(EFFECT_OVERLAY_GUIDE_PENDING_KEY)).toBe("false");
  });
});
