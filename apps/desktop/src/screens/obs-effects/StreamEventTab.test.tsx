import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { StreamEventTab } from "./StreamEventTab";
import {
  STREAM_EVENT_ROUND_KEY,
  STREAM_EVENT_SELECTED_KEY,
} from "../../features/comment-viewer/overlaySettings";

/**
 * 061l: 「配信イベント」タブ（一覧 → 詳細 → 適用 / 開始 → 終了）の仕様テスト。
 *
 * あるべき挙動:
 * - **一覧 → 詳細 → 一覧**（`Screen` union を増やさないローカル state・`RakurakuToolsScreen` と同型）。
 * - ⚠⚠ **未知 id の詳細は一覧へフォールバックする**（アプリ更新でレジストリから消えた場合）。
 * - ⚠⚠ **「適用」は選択キーだけを書き、開催キーを書かず、窓も開かない**（判断 6）。
 * - **`thumbnail` があれば `<img>`、無ければ絵文字**（判断 3）。
 * - ⚠⚠ **開始/終了はこのコンポーネントが localStorage を書かない**——
 *   開催キーの書き手は `ObsEffectsScreen` だけ（061i 判断 2 の「書き手を 1 か所に閉じる」規律）。
 *
 * ⚠ **同梱レジストリを差し替えて**テストする（実物は見本 1 本なので、
 * サムネイルの有無・未知 id の 2 分岐を実データでは書けない）。
 * ⚠ 差し替えは `streamEventRound.ts` の検証にも効く（あちらも同じモジュールを見ている）＝
 * **本番と同じ突き合わせが走る**。
 */
const mocks = vi.hoisted(() => ({
  /** ⚠ 「アプリ更新でレジストリからエントリが消えた」を再現するための旗。 */
  vanished: { value: false },
  registry: [
    {
      id: "with-thumb",
      icon: "🎯",
      thumbnail: "/stream-events/with-thumb.png",
      title: "サムネのあるイベント",
      summary: "左に画像が出るほう。",
      description: "詳細の説明（サムネあり）。",
      defaultDurationMs: 300_000,
      howTo: ["使い方 1"],
    },
    {
      id: "without-thumb",
      icon: "💬",
      title: "サムネのないイベント",
      summary: "左に絵文字が出るほう。",
      description: "詳細の説明（サムネなし）。",
      defaultDurationMs: 60_000,
      howTo: ["使い方 A", "使い方 B"],
    },
  ],
}));

vi.mock("../../features/obs-effects/streamEventRegistry", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../features/obs-effects/streamEventRegistry")
    >();
  return {
    ...actual,
    STREAM_EVENT_REGISTRY: mocks.registry,
    findStreamEvent: (id: string) =>
      mocks.vanished.value
        ? null
        : (mocks.registry.find((e) => e.id === id) ?? null),
    isStreamEventId: (id: string) =>
      !mocks.vanished.value && mocks.registry.some((e) => e.id === id),
  };
});

const renderTab = (over: Partial<Parameters<typeof StreamEventTab>[0]> = {}) => {
  const props = {
    round: null,
    nowMs: 1_000,
    onStartRound: vi.fn(),
    onEndRound: vi.fn(),
    ...over,
  };
  return { ...render(<StreamEventTab {...props} />), props };
};

describe("061l: StreamEventTab", () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.vanished.value = false;
    vi.clearAllMocks();
  });

  // --- 新規 3: 一覧 → 詳細 → 一覧 ----------------------------------------------------------------

  it("⚠ 新規 3: 一覧にカードが並び、詳細へ行って一覧へ戻れる", () => {
    renderTab();
    expect(screen.getByText("サムネのあるイベント")).toBeInTheDocument();
    expect(screen.getByText("左に画像が出るほう。")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "詳細を見る →" })[1]);
    // 詳細（説明と使い方が出る・一覧のカードは消える）。
    expect(screen.getByText("詳細の説明（サムネなし）。")).toBeInTheDocument();
    expect(screen.getByText("使い方 A")).toBeInTheDocument();
    expect(screen.queryByText("左に画像が出るほう。")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "← 一覧へ戻る" }));
    expect(screen.getByText("左に画像が出るほう。")).toBeInTheDocument();
  });

  it("⚠⚠ 新規 3: 未知 id の詳細は一覧へフォールバックする（クラッシュしない）", () => {
    const { rerender } = renderTab();
    fireEvent.click(screen.getAllByRole("button", { name: "詳細を見る →" })[0]);
    expect(screen.getByText("詳細の説明（サムネあり）。")).toBeInTheDocument();

    // ⚠ 詳細を開いたままエントリが消えた（アプリ更新・細工された保存値）。
    mocks.vanished.value = true;
    rerender(
      <StreamEventTab
        round={null}
        nowMs={1_000}
        onStartRound={vi.fn()}
        onEndRound={vi.fn()}
      />,
    );
    expect(screen.queryByText("詳細の説明（サムネあり）。")).toBeNull();
    expect(screen.getByRole("heading", { name: "配信イベント" })).toBeInTheDocument();
  });

  // --- 新規 4: 適用 -----------------------------------------------------------------------------

  it("⚠⚠ 新規 4: 「適用」は選択キーだけを書き、開催キーを書かず、開始も呼ばない", () => {
    const { props } = renderTab();
    fireEvent.click(screen.getAllByRole("button", { name: "詳細を見る →" })[1]);
    fireEvent.click(screen.getByRole("button", { name: "適用" }));

    expect(localStorage.getItem(STREAM_EVENT_SELECTED_KEY)).toBe("without-thumb");
    // ⚠⚠ 開催キーは 1 バイトも書かない（判断 6）。
    expect(localStorage.getItem(STREAM_EVENT_ROUND_KEY)).toBeNull();
    // ⚠⚠ 窓を開く経路（＝画面へ渡す `onStartRound`）も呼ばない。
    expect(props.onStartRound).not.toHaveBeenCalled();
    expect(props.onEndRound).not.toHaveBeenCalled();
  });

  it("適用すると一覧へ戻り、そのカードが「適用中」になり、「開始」が出る", () => {
    renderTab();
    fireEvent.click(screen.getAllByRole("button", { name: "詳細を見る →" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "適用" }));

    expect(screen.getAllByText("適用中").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "開始" })).toBeInTheDocument();
  });

  it("⚠ 適用していないときは「開始」を出さない（開いたのに何も出ない窓を作らない）", () => {
    renderTab();
    expect(screen.queryByRole("button", { name: "開始" })).toBeNull();
    expect(screen.getByText(/まだイベントを適用していません/)).toBeInTheDocument();
  });

  it("⚠ 保存済みの選択が未知 id なら「まだ適用していない」へ倒れる", () => {
    localStorage.setItem(STREAM_EVENT_SELECTED_KEY, "no-such-event");
    renderTab();
    expect(screen.getByText(/まだイベントを適用していません/)).toBeInTheDocument();
  });

  // --- 開始 / 終了（⚠ 書くのは画面側） ------------------------------------------------------------

  it("⚠⚠ 「開始」は画面へ委ねるだけ（このコンポーネントは開催キーを書かない）", () => {
    localStorage.setItem(STREAM_EVENT_SELECTED_KEY, "with-thumb");
    const { props } = renderTab();
    fireEvent.click(screen.getByRole("button", { name: "開始" }));

    expect(props.onStartRound).toHaveBeenCalledWith("with-thumb");
    // ⚠⚠ 書き手は `ObsEffectsScreen` だけ（061i 判断 2 の規律）。
    expect(localStorage.getItem(STREAM_EVENT_ROUND_KEY)).toBeNull();
  });

  it("⚠⚠ 開催中は「終了」だけを出し、開催キーが指すイベントを表示する", () => {
    // 適用中は「サムネあり」だが、開催中なのは「サムネなし」＝**開催キーのほうが正**。
    localStorage.setItem(STREAM_EVENT_SELECTED_KEY, "with-thumb");
    const { props } = renderTab({
      round: { eventId: "without-thumb", startedAt: 0, endsAt: 300_000 },
      nowMs: 0,
    });

    // ⚠ 一覧にも同じタイトルのカードが並ぶので、**開催カードの中だけ**を見る。
    const roundPanel = screen
      .getByRole("heading", { name: "イベントの開催" })
      .closest("section") as HTMLElement;
    expect(within(roundPanel).getByText("サムネのないイベント")).toBeInTheDocument();
    expect(within(roundPanel).getByText("残り 5 分")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "開始" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "終了" }));
    expect(props.onEndRound).toHaveBeenCalledTimes(1);
    // ⚠⚠ 終了は「閉じる」ではない——窓の操作へ触れる経路をこのコンポーネントは持たない。
    expect(props.onStartRound).not.toHaveBeenCalled();
  });

  it("⚠⚠ 開催中の案内が「終了しても窓は閉じない」ことを書いている（親 046 の規律）", () => {
    const { container } = renderTab({
      round: { eventId: "with-thumb", startedAt: 0, endsAt: 300_000 },
      nowMs: 0,
    });
    expect(container.textContent).toContain("終了しても");
    expect(container.textContent).toContain("開いたまま");
    // ⚠ 「黙って何も起きない」を防ぐ 1 文（コメント取得中だけ件数が増える）。
    expect(container.textContent).toContain("コメントの取得中だけ増えます");
  });

  it("⚠ 窓名は表から引く（直書きしない）", () => {
    localStorage.setItem(STREAM_EVENT_SELECTED_KEY, "with-thumb");
    const { container } = renderTab();
    // ⚠ 実タイトル（`EFFECT_OUTPUT_WINDOW_TITLE.stage`）がそのまま出ること＝
    //   ユーザーは OBS のウィンドウ一覧をこの文字列で探す。
    expect(container.textContent).toContain("StreamDock ステージ演出");
  });

  // --- 新規 15: サムネイル -----------------------------------------------------------------------

  it("⚠⚠ 新規 15: `thumbnail` があれば `<img>`、無ければ絵文字（判断 3）", () => {
    const { container } = renderTab();
    const images = container.querySelectorAll("img");
    // サムネを持つのは 1 本だけ。
    expect(images).toHaveLength(1);
    expect(images[0].getAttribute("src")).toBe("/stream-events/with-thumb.png");
    // ⚠ 同一オリジンの同梱物だけ（外部 URL を載せない）。
    expect(images[0].getAttribute("src")).not.toMatch(/^https?:/);
    // 画像を持たないほうは絵文字で出る。
    expect(container.textContent).toContain("💬");
  });
});
