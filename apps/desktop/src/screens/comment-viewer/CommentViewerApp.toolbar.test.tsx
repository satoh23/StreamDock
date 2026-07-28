import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { CommentViewerApp } from "./CommentViewerApp";
import {
  OBS_AUTO_ADD_KEY,
  PINNED_OVERLAY_ENABLED_KEY,
} from "../../features/comment-viewer/overlaySettings";
// 046b レビュー（S-1）: 起動時に前回セッションの固定を捨てることを検証するため、ピンストアのキーを直接見る。
import { PINNED_COMMENTS_KEY } from "../../features/comment-viewer/pinnedComments";
// 型のみの import（コンパイル時に消えるので vi.mock の巻き上げと競合しない）。偽ハンドルと捕捉した handlers を
// 実型に縛るために使う。
import type {
  CommentStreamHandle,
  CommentStreamHandlers,
} from "../../features/comment-viewer/commentStream";

/**
 * 045b: 本体コメントビューのツールバーへ移設した「コメントをOBSに表示」トグルの仕様テスト。
 * あるべき挙動（docs/tasks/045b / 親 045 / 034d の部分反転 / 044a の連動維持）:
 * - 表示（開閉）トグルは**本体ツールバー**にあり、配信中にワンタッチで OBS 表示を開閉できる。
 * - トグル ON で `openCommentOverlayWindow` / OFF で `closeCommentOverlayWindow`（既存ハンドラの流用＝ロジック不変）。
 * - マウント時は `isCommentOverlayOpen()` の実窓状態へ同期する（034d／034f: cross-window 購読を張らず再オープンで復元）。
 * - 設定ビューには表示トグルが**無く**、自動反映トグル（044a のセットアップ）だけが残る＝移設の担保。
 * - 自動反映 ON のとき、表示 OFF で OBS 側ソースを**削除せず非表示**にする（`hideObs`）連動が壊れていない。
 *
 * 045c（E2E 回帰修正）で足した「表示（開閉）が主・自動反映は従」の仕様:
 * - 自動反映を ON にしても**オーバーレイ窓は開かない**（設定を立てるだけ）。044a の旧実装はここで窓を開いており、
 *   045b で表示トグルがツールバーへ出たあとは「設定 ON だけで配信画面に窓が開く」隠れた副作用になっていた。
 * - 自動反映 ON の状態で**表示を ON にしたとき**に、猶予（OBS_ENABLE_DELAY_MS）をおいて `enableObs` が飛ぶ。
 * - OBS 連携の**失敗**は**このツールバー**に出る（旧実装は設定カードにしか出しておらず、押した画面が無反応だった）。
 *   進行（connecting）と成功は出さない: 実機 E2E で「接続中…」は一瞬で消えチラつくだけと分かり撤回した。
 *
 * CommentViewerApp は初のコンポーネントテストのため、マウント時に走る外部境界（Tauri invoke / sidecar WS /
 * Web Audio / ループバック fetch）を全てモックして隔離する。**テストは外部通信も OS 操作も一切行わない**
 * （vitest.config.ts の方針）。localStorage は実物（jsdom）を使い、各テストで明示的にクリアする。
 *
 * レビュー（ファイル名の粒度 / 修正不要）: 6 ケースは全て「オーバーレイ表示トグル」の仕様で、⑤⑥は厳密には
 * ツールバーの話ではない（`.overlayToggle.test.tsx` のほうが内容に忠実）。ただし本ファイルの資産はケースより
 * **モックハーネス**側にあり、改名は docs 3 箇所（progress/task-board/タスクファイル）の参照追従を伴うため見送る。
 * 再修正トリガー＝トグル以外のツールバー仕様（例: 視聴者ボタン・接続ピル）のケースをここに足すとき。そのときは
 * ハーネスを共有ファイルへ切り出し、ケースはファイル名どおりの粒度に分ける。
 *
 * レビュー（ハーネスを共有ファイルへ切り出すか / 修正不要）: 消費者が本ファイル 1 つだけの段階で共有ヘルパへ
 * 抽出すると、抽出インタフェースを外したときの手戻りのほうが高くつく。再修正トリガー＝CommentViewerApp を
 * マウントするテストファイルが 2 本目になったとき（そこで初めて重複の形が分かるので、その形に合わせて切り出す）。
 */

// vi.mock のファクトリは巻き上げられるため、共有スパイは vi.hoisted で先に作る。
const mocks = vi.hoisted(() => ({
  isCommentOverlayOpen: vi.fn(),
  openCommentOverlayWindow: vi.fn(),
  closeCommentOverlayWindow: vi.fn(),
  // 046b: 固定コメント専用オーバーレイ窓（label `pinned-overlay`）の開閉・状態取得。
  isPinnedOverlayOpen: vi.fn(),
  openPinnedOverlayWindow: vi.fn(),
  closePinnedOverlayWindow: vi.fn(),
  // 045c: connectCommentStream に渡された handlers を捕捉する箱。sidecar からの obs.state 通知
  // （handlers.onObsState）をテストから直接叩いて、ツールバーの状態表示を検証するために使う。
  // 実型（CommentStreamHandlers）で縛るので、ハンドラ名が変わればここも typecheck で落ちる。
  handlers: { current: null as CommentStreamHandlers | null },
  // 044a の制御フレーム送信先。connectCommentStream の戻り値（CommentStreamHandle）を差し替える。
  // `satisfies` で実型に縛る: vi.mock のファクトリ戻り値はモジュール型と照合されないため、これが無いと
  // CommentStreamHandle にメソッドが増えても typecheck では気付けず、実行時の "is not a function" まで落ちない。
  stream: {
    disconnect: vi.fn(),
    startLogin: vi.fn(),
    startSession: vi.fn(),
    stopSession: vi.fn(),
    enableObs: vi.fn(),
    hideObs: vi.fn(),
    disableObs: vi.fn(),
  } satisfies CommentStreamHandle,
}));

/*
 * 以下のモックは各モジュールを**丸ごと差し替える**ため、書かなかった export は undefined になる。
 * 現在テストが踏まないものも含め、**実モジュールの export 面を全て埋める**方針を採る（今は未使用でも、
 * 将来 CommentViewerApp 配下が直接 import し始めたときに「値が静かに undefined」で 6 ケースが pass した
 * まま壊れるのを防ぐため）。実体をスプレッドする importOriginal 方式は、実 invoke / 実 fetch を復活させて
 * しまうので採らない（vitest.config.ts の「外部通信・OS 操作を一切しない」方針が優先）。
 */

// オーバーレイ窓の開閉（Rust command）。本テストの検証対象。
// 後半 2 つは MainScreen 専用でこのツリーからは踏まないが、上記方針により export 面を揃えておく。
// 046b: 固定コメント専用オーバーレイの 3 つも**必ず**ここへ足す。このモックはモジュールを丸ごと差し替えるため、
// 書き漏らすと `isPinnedOverlayOpen` が undefined になり、CommentViewerApp のマウント effect が
// 「undefined is not a function」で落ちる（実装が正しくても全ケースがレッドになる）。
vi.mock("../../features/comment-viewer/windowApi", () => ({
  isCommentOverlayOpen: mocks.isCommentOverlayOpen,
  openCommentOverlayWindow: mocks.openCommentOverlayWindow,
  closeCommentOverlayWindow: mocks.closeCommentOverlayWindow,
  isPinnedOverlayOpen: mocks.isPinnedOverlayOpen,
  openPinnedOverlayWindow: mocks.openPinnedOverlayWindow,
  closePinnedOverlayWindow: mocks.closePinnedOverlayWindow,
  closeCommentViewerWindow: vi.fn(async () => {}),
  isCommentViewerOpen: vi.fn(async () => false),
}));

// 044a: OBS WebSocket 設定の read-only 検出とパスワード保存（いずれも invoke）。未検出（null）で固定する。
vi.mock("../../features/comment-viewer/obsApi", () => ({
  detectObsWebsocketConfig: vi.fn(async () => null),
  setObsWebsocketPassword: vi.fn(async () => {}),
  clearObsWebsocketPassword: vi.fn(async () => {}),
}));

// sidecar への単一双方向 WS。接続はせず、制御フレーム送信をスパイできる偽ハンドルを返す。
// 045c: 受け取った handlers を捕捉しておき、sidecar から届く通知（obs.state 等）をテストから再現できるようにする。
vi.mock("../../features/comment-viewer/commentStream", () => ({
  connectCommentStream: vi.fn((handlers) => {
    mocks.handlers.current = handlers;
    return mocks.stream;
  }),
}));

// VOICEVOX ENGINE へのループバック fetch。未起動・話者一覧空で固定する。
// synthesize/playWav は ttsQueue・voicevoxPreview（ともにモック済み）専用だが、export 面を揃えておく。
// 定数 2 つは実値と同じものを置く（undefined が既定話者 id に化けるのを防ぐ）。
vi.mock("../../features/comment-viewer/voicevox", () => ({
  VOICEVOX_BASE: "http://127.0.0.1:50021",
  ZUNDAMON_NORMAL_SPEAKER_ID: 3,
  checkEngineRunning: vi.fn(async () => false),
  fetchSpeakers: vi.fn(async () => []),
  synthesize: vi.fn(async () => new ArrayBuffer(0)),
  playWav: vi.fn(async () => {}),
}));

// ENGINE 起動誘導（invoke）。既定 OFF なので呼ばれないが、境界として塞いでおく。
vi.mock("../../features/comment-viewer/voicevoxApi", () => ({
  launchVoicevoxEngine: vi.fn(async () => ({
    supported: true,
    launched: false,
    message: "",
  })),
}));

// jsdom に AudioContext が無いため、読み上げキューと試聴プレイヤーは生成ごと差し替える。
vi.mock("../../features/comment-viewer/ttsQueue", () => ({
  sanitizeForSpeech: vi.fn((text: string) => text),
  createTtsQueue: vi.fn(() => ({
    enqueue: vi.fn(),
    resume: vi.fn(async () => {}),
    dispose: vi.fn(),
  })),
}));
vi.mock("../../features/comment-viewer/voicevoxPreview", () => ({
  createVoicevoxPreview: vi.fn(() => ({ play: vi.fn(), dispose: vi.fn() })),
}));

// 038c: 視聴者記録（invoke）。コメント受信時のみ走るが、境界として塞いでおく。
// 残り 6 つは ViewersView/ViewerDetailPanel 専用（本ファイルでは一度もマウントしない）だが、export 面を揃えておく。
vi.mock("../../features/viewer-memory/viewerMemoryApi", () => ({
  recordComment: vi.fn(),
  recordComments: vi.fn(),
  listViewers: vi.fn(async () => []),
  getViewer: vi.fn(),
  updateViewerNote: vi.fn(async () => {}),
  deleteViewer: vi.fn(async () => {}),
  clearViewers: vi.fn(async () => {}),
}));

// 設定ビュー（SettingsView）が host_os を invoke するため OS を固定する（SettingsView.obs.test.tsx と同型）。
vi.mock("../../features/platform/useHostOs", () => ({
  useHostOs: () => "macos",
}));

const OVERLAY_TOGGLE = "コメントをOBSに表示";
// 045c: 「いつ反映されるのか」が読み取れる条件付き label（鉤括弧内は上の表示トグルと同一文字列）。
const AUTO_ADD_TOGGLE = "「コメントをOBSに表示」ON時、OBSに自動で反映する";
// 046b: 固定コメント専用オーバーレイの表示トグル（設定ビュー）。カード見出しと同一文字列なので role で絞る。
const PINNED_OVERLAY_TOGGLE = "固定コメントをOBSに表示";

/** 実窓の初期状態（マウント同期の戻り値）を決めて描画する。 */
function renderApp(overlayAlreadyOpen = false) {
  mocks.isCommentOverlayOpen.mockResolvedValue(overlayAlreadyOpen);
  return render(<CommentViewerApp />);
}

/** 044a: sidecar からの obs.state 通知を再現する（実 WS は張らないので捕捉した handlers を直接叩く）。 */
function emitObsState(state: string) {
  // 045c レビュー: 下の `?.` は捕捉が壊れても黙って no-op になるため、「何も出ない」を見る否定ケースが
  // **通知が届いていないから通る**（vacuous）状態になりうる。捕捉の生存をここで明示的に落とす。
  expect(mocks.handlers.current).not.toBeNull();
  act(() => mocks.handlers.current?.onObsState?.(state));
}

/** ツールバーの表示トグル（role="switch"）を取る。 */
function overlaySwitch() {
  return screen.getByRole("switch", { name: OVERLAY_TOGGLE });
}

/** 設定ビューへ移動して自動反映トグル（role="switch"）を取る。 */
function autoAddSwitch() {
  return screen.getByRole("switch", { name: AUTO_ADD_TOGGLE });
}

/** 046b: 設定ビューの固定コメント表示トグル（role="switch"）を取る。 */
function pinnedOverlaySwitch() {
  return screen.getByRole("switch", { name: PINNED_OVERLAY_TOGGLE });
}

beforeEach(() => {
  // clearMocks は呼び出し履歴のみを消す（実装は残る）ため、localStorage と既定の解決値は明示的に戻す。
  localStorage.clear();
  mocks.isCommentOverlayOpen.mockResolvedValue(false);
  mocks.openCommentOverlayWindow.mockResolvedValue(undefined);
  mocks.closeCommentOverlayWindow.mockResolvedValue(undefined);
  mocks.isPinnedOverlayOpen.mockResolvedValue(false);
  mocks.openPinnedOverlayWindow.mockResolvedValue(undefined);
  mocks.closePinnedOverlayWindow.mockResolvedValue(undefined);
  // 045c: 捕捉した handlers はテスト間で持ち越さない（前のテストのアンマウント済みツリーを叩かないため）。
  mocks.handlers.current = null;
});

describe("045b 本体ツールバーの OBS 表示トグル", () => {
  it("ツールバーに表示トグルを描画し、実窓が閉じていれば OFF で出る", async () => {
    renderApp(false);
    await waitFor(() =>
      expect(overlaySwitch()).toHaveAttribute("aria-checked", "false"),
    );
  });

  it("OFF→ON で openCommentOverlayWindow を呼び、トグルが ON になる", async () => {
    renderApp(false);
    const toggle = overlaySwitch();
    fireEvent.click(toggle);
    expect(mocks.openCommentOverlayWindow).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"));
    // 自動反映 OFF のときは OBS への制御フレームを出さない（044a の連動は自動反映 ON のときだけ）。
    expect(mocks.stream.enableObs).not.toHaveBeenCalled();
  });

  it("034d/034f: マウント時に実窓状態へ同期する（外部で開かれていれば ON で出る）", async () => {
    renderApp(true);
    await waitFor(() =>
      expect(overlaySwitch()).toHaveAttribute("aria-checked", "true"),
    );
  });

  it("ON→OFF で closeCommentOverlayWindow を呼び、トグルが OFF に戻る", async () => {
    renderApp(true);
    const toggle = overlaySwitch();
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"));
    fireEvent.click(toggle);
    expect(mocks.closeCommentOverlayWindow).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "false"));
  });

  it("移設の担保: 設定ビューに表示トグルは無く、自動反映トグルだけが残る", async () => {
    renderApp(false);
    await waitFor(() => expect(overlaySwitch()).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "設定" }));
    // 表示（開閉）は本体へ出ていった。カード見出しと導線注記に同じ文字列が出るため、role="switch" で厳密に見る。
    expect(
      screen.queryByRole("switch", { name: OVERLAY_TOGGLE }),
    ).not.toBeInTheDocument();
    // 一度きりのセットアップである自動反映（044a）は設定に残す。
    expect(
      screen.getByRole("switch", { name: AUTO_ADD_TOGGLE }),
    ).toBeInTheDocument();
  });

  it("044a の連動維持: 自動反映 ON のとき表示 OFF で OBS 側を非表示にする（削除しない）", async () => {
    localStorage.setItem(OBS_AUTO_ADD_KEY, "true");
    renderApp(true);
    const toggle = overlaySwitch();
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"));
    fireEvent.click(toggle);
    // 本ケースの主眼は「hideObs＝削除せず非表示」であって disableObs（連携解除）ではない、という一点。
    expect(mocks.stream.hideObs).toHaveBeenCalledTimes(1);
    expect(mocks.stream.disableObs).not.toHaveBeenCalled();
    // 付随して port の既定値も固定する。detectObsWebsocketConfig を null にしているので `obsConfig?.port ?? 4455`
    // の既定側を通る＝044a の「検出できなくても既定 4455 で送る」契約。上の 1 行と意図が違うので分けてある。
    // 046d: 対象種別が付いた（コメント一覧側は "comments"）。
    expect(mocks.stream.hideObs).toHaveBeenCalledWith(4455, "comments");
  });
});

describe("045c 自動反映は表示に従う（E2E 回帰）", () => {
  it("自動反映を ON にしてもオーバーレイ窓は開かない（設定を立てるだけ）", async () => {
    renderApp(false);
    await waitFor(() =>
      expect(overlaySwitch()).toHaveAttribute("aria-checked", "false"),
    );
    fireEvent.click(screen.getByRole("button", { name: "設定" }));

    fireEvent.click(autoAddSwitch());

    // 旧実装はここで openCommentOverlayWindow を呼び、表示まで ON にしていた（045b 後は隠れた副作用）。
    expect(mocks.openCommentOverlayWindow).not.toHaveBeenCalled();
    expect(autoAddSwitch()).toHaveAttribute("aria-checked", "true");
    // 未表示なので OBS への接続要求も出さない（反映は表示 ON が契機）。
    expect(mocks.stream.enableObs).not.toHaveBeenCalled();
    // 本体へ戻ると表示トグルは OFF のまま＝配信画面に窓は開いていない。
    fireEvent.click(screen.getByRole("button", { name: "コメントに戻る" }));
    expect(overlaySwitch()).toHaveAttribute("aria-checked", "false");
  });

  it("自動反映 ON の状態で表示を ON にすると、猶予後に enableObs が飛ぶ", async () => {
    vi.useFakeTimers();
    try {
      localStorage.setItem(OBS_AUTO_ADD_KEY, "true");
      renderApp(false);
      const toggle = overlaySwitch();

      fireEvent.click(toggle);
      // 窓を開く invoke は即時。反映要求は open の解決と同じマイクロタスクでは出さない（猶予つきで遅延する）。
      await act(async () => {});
      expect(mocks.openCommentOverlayWindow).toHaveBeenCalledTimes(1);
      expect(mocks.stream.enableObs).not.toHaveBeenCalled();

      // 猶予（OBS_ENABLE_DELAY_MS）経過後に反映要求が出る。port は未検出なので既定 4455。
      // 猶予の**長さ**は固定しない: 044a 自身が「M1 で本待ちは sidecar の有界リトライへ移したので、E2E で不要と
      // 分かれば撤去してよい」としている調整値で、ここで秒数を pin すると値を触るたび無関係に落ちる。
      // 045c レビュー（固定している粒度の正確な記述）: このケースが固定しているのは「猶予の長さ」ではなく
      // **open の解決と同じマイクロタスクでは出さず、タイマー（マクロタスク）を経由して出る**という一点。
      // 秒数を 0 にしても 4000 にしても通り、同期呼び出しに変えたときだけ上の not.toHaveBeenCalled() が落ちる。
      await act(() => vi.advanceTimersByTimeAsync(10_000));
      // 046d: 対象種別が付いた（コメント一覧側は "comments"）。
      expect(mocks.stream.enableObs).toHaveBeenCalledWith(4455, "comments");
      // 045c レビュー: 二重発火するミューテーションを素通りさせないよう回数も固定する。
      expect(mocks.stream.enableObs).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("接続の進行・成功はツールバーに出さない（失敗だけ伝える）", async () => {
    localStorage.setItem(OBS_AUTO_ADD_KEY, "true");
    renderApp(true);
    await waitFor(() =>
      expect(overlaySwitch()).toHaveAttribute("aria-checked", "true"),
    );

    // 実機 E2E で「接続中…」は成功時ほぼ一瞬で消えチラつくだけと分かったため出さない方針に確定した。
    // 成功（added/reused）も出さない＝配信中のツールバーを騒がしくしない。何も出ないこと自体が仕様。
    // ※ /OBS/ の部分一致では表示トグルの label（「コメントをOBSに表示」）を拾ってしまうため、状態表示の
    //   文字列を名指しで見る。
    // 045c レビュー（網羅性 / 修正不要）: 名指しなので「別文言の進行表示」が将来足されても通ってしまうが、
    //   このケースが防ぎたいのは**撤回した実装の復活**であり、その文言（「OBSに接続中…」）は押さえている。
    //   再修正トリガー＝状態表示の文言が増えたとき（そのときはツールバー配下の textContent 比較へ変える）。
    for (const state of ["connecting", "added", "reused", "idle"]) {
      emitObsState(state);
      expect(screen.queryByText("OBSに接続中…")).not.toBeInTheDocument();
      expect(
        screen.queryByText("OBSに接続できませんでした"),
      ).not.toBeInTheDocument();
    }
  });

  it("接続失敗はツールバーに赤字で出す（OBS 未起動などが押した画面で分かる）", async () => {
    localStorage.setItem(OBS_AUTO_ADD_KEY, "true");
    renderApp(true);
    await waitFor(() =>
      expect(overlaySwitch()).toHaveAttribute("aria-checked", "true"),
    );

    emitObsState("failed");
    // 短文＋title で全文。旧実装は設定カードにしか出しておらず、押した画面は無反応だった。
    const error = screen.getByText("OBSに接続できませんでした");
    expect(error).toHaveAttribute(
      "title",
      "OBSに接続できませんでした。OBSが起動しているか確認してください。",
    );

    // 表示を OFF にすると OBS 側も非表示になるので、残留した赤字が誤解を生まないよう消える。
    fireEvent.click(overlaySwitch());
    await waitFor(() =>
      expect(
        screen.queryByText("OBSに接続できませんでした"),
      ).not.toBeInTheDocument(),
    );
  });
});

/**
 * 045c レビュー（回帰）: 猶予（OBS_ENABLE_DELAY_MS）の setTimeout は id を捨てており取り消せなかったため、
 * 猶予中に OFF にしても発火が止まらず、`hideObs` / `disableObs` の**後に** `enableObs` が飛んでいた。
 * あるべき挙動: ユーザーが OFF にした時点で、仕掛かり中の反映要求ごと取り消される
 * （§1「ユーザーが明示的に有効化した時のみ接続」／045c の「表示 OFF＝OBS も非表示」という不変条件を守る）。
 */
describe("045c レビュー 猶予中の取り消し", () => {
  it("猶予中に表示を OFF にすると、反映要求は飛ばない（赤字も出ない）", async () => {
    vi.useFakeTimers();
    try {
      localStorage.setItem(OBS_AUTO_ADD_KEY, "true");
      renderApp(false);
      const toggle = overlaySwitch();

      fireEvent.click(toggle); // 表示 ON（猶予が仕掛かる）
      await act(async () => {});
      fireEvent.click(toggle); // 猶予の経過前に表示 OFF
      await act(async () => {});
      expect(mocks.stream.hideObs).toHaveBeenCalledTimes(1);

      await act(() => vi.advanceTimersByTimeAsync(10_000));
      // hideObs の後に enableObs が飛ぶと、OBS 側では閉じた窓のソースが再表示されてしまう。
      expect(mocks.stream.enableObs).not.toHaveBeenCalled();
      // 反映要求が飛ばない＝sidecar から failed も返らないので、表示 OFF のまま赤字が残ることもない。
      expect(
        screen.queryByText("OBSに接続できませんでした"),
      ).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("猶予中に自動反映を OFF にすると、反映要求は飛ばない", async () => {
    vi.useFakeTimers();
    try {
      localStorage.setItem(OBS_AUTO_ADD_KEY, "true");
      renderApp(false);

      fireEvent.click(overlaySwitch()); // 表示 ON（猶予が仕掛かる）
      await act(async () => {});
      fireEvent.click(screen.getByRole("button", { name: "設定" }));
      fireEvent.click(autoAddSwitch()); // 猶予の経過前に自動反映 OFF
      await act(async () => {});
      expect(mocks.stream.disableObs).toHaveBeenCalledTimes(1);

      await act(() => vi.advanceTimersByTimeAsync(10_000));
      // 連携を切った直後に接続要求が出るのは §1 の「明示的に有効化した時のみ」から外れる。
      expect(mocks.stream.enableObs).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * 046b: 設定ビューの「固定コメントをOBSに表示」トグル（固定専用オーバーレイ窓 `pinned-overlay`）。
 * あるべき挙動（docs/tasks/046b / 親 046 / 依頼者の決定）:
 * - トグルは**設定ビュー**にある（配信中に切り替える操作ではなく、OBS にウィンドウキャプチャを仕込む
 *   一度きりのセットアップ。固定/解除は右クリックメニュー側の仕事で、窓は開けっぱなしにする）。
 * - ON で `openPinnedOverlayWindow` / OFF で `closePinnedOverlayWindow`。値は **localStorage に永続**する。
 * - 永続 ON で開き直したとき、窓が無ければ**マウント時に自動で開く**（配信開始時に OBS ソースが黒くならない）。
 *   逆に**自動で閉じる経路は作らない**（親 046: ピン 0 件で窓が消えると OBS のウィンドウキャプチャソースが壊れる）。
 * - **046d: この窓も 044a の自動反映の対象**。「OBSに自動で反映する」が ON のときだけ、トグル ON で
 *   `enableObs(port, "pinned")`／OFF で `hideObs(port, "pinned")` を出す。自動反映 OFF なら OBS へ一切繋がない
 *   （045c の「明示的に有効化した時のみ接続」を維持）。コメント一覧側（"comments"）には干渉しない。
 * - **固定コメントは配信をまたいで残らない**（046b レビュー S-1・依頼者の決定）。トグルの永続 ON ＋
 *   マウント時の自動 open と組み合わさると、前回配信の固定が操作なしで本番へ出てしまうため。
 */
describe("046b 設定ビューの固定コメント表示トグル", () => {
  /** 設定ビューを開く（このトグルは設定ビューにしか無い）。 */
  async function openSettings() {
    await waitFor(() => expect(overlaySwitch()).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "設定" }));
  }

  it("前回セッションの固定は引き継がず、マウント時にピンストアを空へ倒す（S-1: 前回配信の固定が本番へ出ない）", async () => {
    // 前回配信で固定が残っている状態を作る（046a はキーを消さず JSON 配列を書く）。
    localStorage.setItem(
      PINNED_COMMENTS_KEY,
      JSON.stringify([
        {
          id: "c-prev",
          source: "twitch",
          author: { id: "u1", name: "前回の視聴者" },
          text: "前の配信で固定したコメント",
          publishedAt: "2026-07-28T10:00:00Z",
          eventType: "chat",
        },
      ]),
    );
    // 「固定コメントをOBSに表示」も ON のまま＝マウント時に窓が自動で開く条件を満たす。
    localStorage.setItem(PINNED_OVERLAY_ENABLED_KEY, "true");

    renderApp(false);

    // 本体の固定帯にも出さない。
    await waitFor(() =>
      expect(screen.queryByText("前の配信で固定したコメント")).toBeNull(),
    );
    // ストア自体を空へ倒す（＝この後に開くオーバーレイ窓の read-on-mount が空を読む）。
    // ここが "[]" でないと、前回のコメントが操作なしで OBS へ映る。
    await waitFor(() =>
      expect(localStorage.getItem(PINNED_COMMENTS_KEY)).toBe("[]"),
    );
    // 窓の自動オープン自体は従来どおり動く（クリアと自動 open は両立する）。
    await waitFor(() =>
      expect(mocks.openPinnedOverlayWindow).toHaveBeenCalledTimes(1),
    );
  });

  it("S-1 の順序: オーバーレイ窓を開く時点で、ピンストアは既に空になっている", async () => {
    // レビュー指摘（S-1 の担保根拠の明示）: クリアと窓オープンは「どちらも起きる」だけでは不十分で、
    // **クリアが窓生成より先**でなければ、開いた窓の read-on-mount が前回の固定を読んで本番へ映してしまう。
    // 担保は宣言順（クリア effect を open effect より前に置く）＋マイクロタスク境界
    //（open は invoke＝async なので、同期の書込が必ず先に完了する）の二重。
    // open 経路を同期化するとこの保証が消えるため、その退行をここで検出する。
    localStorage.setItem(
      PINNED_COMMENTS_KEY,
      JSON.stringify([
        {
          id: "c-prev",
          source: "twitch",
          author: { id: "u1", name: "前回の視聴者" },
          text: "前の配信で固定したコメント",
          publishedAt: "2026-07-28T10:00:00Z",
          eventType: "chat",
        },
      ]),
    );
    localStorage.setItem(PINNED_OVERLAY_ENABLED_KEY, "true");

    // 窓を開くよう要求された**その瞬間**のストア内容を記録する。
    let storeAtOpen: string | null = "(not called)";
    mocks.openPinnedOverlayWindow.mockImplementation(async () => {
      storeAtOpen = localStorage.getItem(PINNED_COMMENTS_KEY);
    });

    renderApp(false);

    await waitFor(() =>
      expect(mocks.openPinnedOverlayWindow).toHaveBeenCalledTimes(1),
    );
    expect(storeAtOpen).toBe("[]");
  });

  it("設定ビューに描画し、未保存なら OFF で出る（本体ツールバーには出さない）", async () => {
    renderApp(false);
    // 置き場所の担保: 表示（開閉）トグルが並ぶ本体ツールバーには**足していない**（045b の混雑を増やさない）。
    expect(
      screen.queryByRole("switch", { name: PINNED_OVERLAY_TOGGLE }),
    ).not.toBeInTheDocument();
    await openSettings();
    expect(pinnedOverlaySwitch()).toHaveAttribute("aria-checked", "false");
  });

  it("OFF→ON で openPinnedOverlayWindow を呼び、設定を永続化する", async () => {
    renderApp(false);
    await openSettings();
    fireEvent.click(pinnedOverlaySwitch());

    // 046b レビュー（連打レース修正）: 開閉要求は直列キューに載るため、invoke は同期ではなく次の
    // マイクロタスク以降で走る（呼び出し自体は waitFor で待つ）。
    await waitFor(() =>
      expect(mocks.openPinnedOverlayWindow).toHaveBeenCalledTimes(1),
    );
    await waitFor(() =>
      expect(pinnedOverlaySwitch()).toHaveAttribute("aria-checked", "true"),
    );
    // 永続化（034d/045b の overlayOpen と違い、こちらは localStorage に残す）。
    expect(localStorage.getItem(PINNED_OVERLAY_ENABLED_KEY)).toBe("true");
  });

  it("ON→OFF で closePinnedOverlayWindow を呼び、永続値も false になる", async () => {
    localStorage.setItem(PINNED_OVERLAY_ENABLED_KEY, "true");
    // 既に開いている状態から始める（マウント時の自動オープンは走らない）。
    mocks.isPinnedOverlayOpen.mockResolvedValue(true);
    renderApp(false);
    await openSettings();
    expect(pinnedOverlaySwitch()).toHaveAttribute("aria-checked", "true");

    fireEvent.click(pinnedOverlaySwitch());
    await waitFor(() =>
      expect(mocks.closePinnedOverlayWindow).toHaveBeenCalledTimes(1),
    );
    await waitFor(() =>
      expect(pinnedOverlaySwitch()).toHaveAttribute("aria-checked", "false"),
    );
    expect(localStorage.getItem(PINNED_OVERLAY_ENABLED_KEY)).toBe("false");
  });

  it("ON→OFF を連打しても、OFF が窓生成の完了後に届く（設定 OFF なのに窓が残らない）", async () => {
    // 046b レビュー（要修正）: open は #[tauri::command(async)]（窓生成で数百 ms）、close は同期コマンド。
    // 直列化していないと「close が窓なし＝no-op で先に流れ、あとから open が窓を作る」順序が起こり、
    // 自動 close 経路が無い 046b では**セッション中ずっと**「設定 OFF なのに OBS へ固定コメントが映る」になる。
    let resolveOpen: () => void = () => {};
    mocks.openPinnedOverlayWindow.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveOpen = () => resolve();
        }),
    );
    renderApp(false);
    await openSettings();

    fireEvent.click(pinnedOverlaySwitch()); // ON（窓生成は未完了のまま止める）
    await waitFor(() =>
      expect(mocks.openPinnedOverlayWindow).toHaveBeenCalledTimes(1),
    );

    fireEvent.click(pinnedOverlaySwitch()); // OFF（open の解決前）
    // 直列化されていれば、open が終わるまで close は走らない（走ると窓なしの no-op になってしまう）。
    expect(mocks.closePinnedOverlayWindow).not.toHaveBeenCalled();

    resolveOpen();
    await waitFor(() =>
      expect(mocks.closePinnedOverlayWindow).toHaveBeenCalledTimes(1),
    );
    expect(localStorage.getItem(PINNED_OVERLAY_ENABLED_KEY)).toBe("false");
  });

  it("永続 ON で開き直すと、窓が無ければマウント時に自動で開く", async () => {
    localStorage.setItem(PINNED_OVERLAY_ENABLED_KEY, "true");
    mocks.isPinnedOverlayOpen.mockResolvedValue(false);
    renderApp(false);

    await waitFor(() =>
      expect(mocks.openPinnedOverlayWindow).toHaveBeenCalledTimes(1),
    );
    await openSettings();
    expect(pinnedOverlaySwitch()).toHaveAttribute("aria-checked", "true");
  });

  it("永続 ON でも窓が既に開いていれば開き直さない（最背面窓を余計に触らない）", async () => {
    localStorage.setItem(PINNED_OVERLAY_ENABLED_KEY, "true");
    mocks.isPinnedOverlayOpen.mockResolvedValue(true);
    renderApp(false);

    await waitFor(() => expect(mocks.isPinnedOverlayOpen).toHaveBeenCalled());
    expect(mocks.openPinnedOverlayWindow).not.toHaveBeenCalled();
  });

  it("永続 OFF なら自動で開かず、開いていた窓を自動で閉じもしない（親 046: 自動 close を作らない）", async () => {
    // 設定は OFF なのに窓が開いている状況（前回 OFF にし損ねた等）。ここで自動 close すると、
    // OBS のウィンドウキャプチャソースがユーザーの操作なしに壊れる。
    mocks.isPinnedOverlayOpen.mockResolvedValue(true);
    renderApp(false);

    await waitFor(() => expect(mocks.isPinnedOverlayOpen).toHaveBeenCalled());
    expect(mocks.openPinnedOverlayWindow).not.toHaveBeenCalled();
    expect(mocks.closePinnedOverlayWindow).not.toHaveBeenCalled();
  });

  it("046d: 自動反映 ON なら、トグル ON で猶予後に enableObs(pinned) が飛ぶ", async () => {
    vi.useFakeTimers();
    try {
      localStorage.setItem(OBS_AUTO_ADD_KEY, "true");
      renderApp(false);
      await act(async () => {});
      fireEvent.click(screen.getByRole("button", { name: "設定" }));

      fireEvent.click(pinnedOverlaySwitch()); // ON
      // 窓が OBS のウィンドウ一覧に載るまでの猶予中は、まだ飛ばない（044a と同じ作法）。
      await act(async () => {});
      expect(mocks.stream.enableObs).not.toHaveBeenCalled();

      await act(() => vi.advanceTimersByTimeAsync(10_000));
      expect(mocks.stream.enableObs).toHaveBeenCalledWith(4455, "pinned");
      // コメント一覧側（"comments"）には干渉しない＝別ソースとして独立している。
      expect(mocks.stream.enableObs).toHaveBeenCalledTimes(1);
      expect(mocks.openCommentOverlayWindow).not.toHaveBeenCalled();
      expect(mocks.closeCommentOverlayWindow).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("046d: 自動反映 ON なら、トグル OFF で hideObs(pinned) が飛ぶ（ソースは消さない）", async () => {
    localStorage.setItem(OBS_AUTO_ADD_KEY, "true");
    localStorage.setItem(PINNED_OVERLAY_ENABLED_KEY, "true");
    mocks.isPinnedOverlayOpen.mockResolvedValue(true);
    renderApp(false);
    await openSettings();

    fireEvent.click(pinnedOverlaySwitch()); // OFF
    await waitFor(() =>
      expect(mocks.stream.hideObs).toHaveBeenCalledWith(4455, "pinned"),
    );
    // 非表示であって連携解除ではない（disableObs は自動反映トグル専用）。
    expect(mocks.stream.disableObs).not.toHaveBeenCalled();
  });

  it("046d: 自動反映 OFF なら、トグル操作で OBS へ一切繋がない（045c の線引きを維持）", async () => {
    // OBS_AUTO_ADD_KEY を立てない＝自動反映 OFF。
    renderApp(false);
    await openSettings();

    fireEvent.click(pinnedOverlaySwitch()); // ON
    await act(async () => {});
    fireEvent.click(pinnedOverlaySwitch()); // OFF
    await act(async () => {});
    await waitFor(() =>
      expect(mocks.closePinnedOverlayWindow).toHaveBeenCalledTimes(1),
    );

    expect(mocks.stream.enableObs).not.toHaveBeenCalled();
    expect(mocks.stream.hideObs).not.toHaveBeenCalled();
    expect(mocks.stream.disableObs).not.toHaveBeenCalled();
  });

  it("046d: 自動反映トグル ON 時、開いている両オーバーレイを対象にする", async () => {
    // 046d レビュー: この経路（「OBSに自動で反映する」を後から ON にする）は種別 2 つを対象にするのに
    // テストが無かった。両方が開いているときは comments / pinned の 2 本が飛ぶことを固定する。
    localStorage.setItem(PINNED_OVERLAY_ENABLED_KEY, "true");
    mocks.isPinnedOverlayOpen.mockResolvedValue(true);
    renderApp(true); // コメント一覧オーバーレイも開いている
    await openSettings();

    fireEvent.click(autoAddSwitch()); // 自動反映 ON

    await waitFor(() =>
      expect(mocks.stream.enableObs).toHaveBeenCalledWith(4455, "comments"),
    );
    await waitFor(() =>
      expect(mocks.stream.enableObs).toHaveBeenCalledWith(4455, "pinned"),
    );
    expect(mocks.stream.enableObs).toHaveBeenCalledTimes(2);
  });

  it("046d: 固定側の自動追加は**実窓**の有無で判定する（設定 ON でも窓が無ければ送らない）", async () => {
    // 046d レビュー（要修正）: 当初は永続設定値（pinnedOverlayEnabled）でゲートしていたため、
    // 「設定 ON ／ 窓なし」（open の invoke が失敗した等）で enableObs("pinned") が飛び、sidecar 側が
    // 先に CreateInput してから窓探索に失敗する＝キャプチャ対象未設定の空ソースが OBS に残っていた。
    localStorage.setItem(PINNED_OVERLAY_ENABLED_KEY, "true");
    mocks.isPinnedOverlayOpen.mockResolvedValue(false); // 設定は ON だが実窓は無い
    // マウント同期 effect の自動 open も失敗させ、「設定 ON・窓なし」を維持する。
    mocks.openPinnedOverlayWindow.mockRejectedValue(new Error("build failed"));
    renderApp(true);
    await openSettings();

    fireEvent.click(autoAddSwitch()); // 自動反映 ON

    // コメント一覧側（実窓 open）は従来どおり飛ぶ。
    await waitFor(() =>
      expect(mocks.stream.enableObs).toHaveBeenCalledWith(4455, "comments"),
    );
    // 固定側は実窓が無いので送らない（設定値ゲートのままなら 2 本目が飛んでレッドになる）。
    expect(mocks.stream.enableObs).not.toHaveBeenCalledWith(4455, "pinned");
  });
});
