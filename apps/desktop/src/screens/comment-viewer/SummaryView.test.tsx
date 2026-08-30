import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { StreamSessionRecord } from "../../features/stream-session/streamSessionApi";
import type { StreamSummary } from "../../features/stream-summary/streamSummaryApi";
import type { ViewerRecord, ViewerDetail } from "../../features/viewer-memory/types";

/**
 * 062c: 配信サマリー画面の仕様テスト。
 *
 * invoke ラッパ（062b の stream-session / 062c の stream-summary / 038a の viewer-memory）は全てモックする
 * ＝テストは端末外通信も OS 操作も一切しない（vitest.config.ts の方針）。
 *
 * ⚠⚠ **2026-08-16（実機確認・依頼者の決定）: 画面から説明文（注記）を全廃した。**
 * 親 062 (3) は「既知の歪みは隠さず注記する」と決めていたが、実機で**説明文が画面の大半を占めて
 * 数字が読めなかった**ため、**文章ではなく構造（UI そのもの）で分かるようにする**方針へ置き換えた。
 * ⇒ このファイルが固定するのは**その構造**である:
 *   - 総課金額を**通貨ごとに並べる**（1 つの数字に丸めない＝「換算していない」を構造で示す）
 *   - **種別ごとの内訳**を並べる（donation を総額に含めていることを構造で示す）
 *   - **Jewels は回数だけ**で金額を持たない（総課金額の通貨欄にも現れない）
 *   - セッションを切ったら**件数の事実だけ**を添える
 * ⚠ **説明文を書き戻さないこと**（依頼者の明示指示）。詳細は `SummaryView.tsx` 冒頭の注記と
 *   docs/progress.md の 062c 節「注記の全廃」。
 */

vi.mock("../../features/stream-session/streamSessionApi", () => ({
  listStreamSessions: vi.fn(),
  getActiveStreamSession: vi.fn(),
  updateStreamSessionTitle: vi.fn(),
}));
vi.mock("../../features/stream-summary/streamSummaryApi", () => ({
  getStreamSummary: vi.fn(),
}));
vi.mock("../../features/viewer-memory/viewerMemoryApi", () => ({
  getViewer: vi.fn(),
  updateViewerNote: vi.fn(),
  deleteViewer: vi.fn(),
}));
// 063i: ガチャ一覧も invoke ラッパごとモックする（⚠ 記録側 `recordGachaDraws` はこの画面から呼ばれない）。
vi.mock("../../features/gacha-history/gachaHistoryApi", () => ({
  listGachaDraws: vi.fn(),
}));

import {
  listStreamSessions,
  getActiveStreamSession,
  updateStreamSessionTitle,
} from "../../features/stream-session/streamSessionApi";
import { getStreamSummary } from "../../features/stream-summary/streamSummaryApi";
import { getViewer } from "../../features/viewer-memory/viewerMemoryApi";
import { listGachaDraws } from "../../features/gacha-history/gachaHistoryApi";
import type { GachaDrawRecord } from "../../features/gacha-history/gachaHistoryApi";
// ⚠⚠⚠ 063i: 文言はテストに書き写さず**定義から import する**（書き写すと 2 か所目になり、
//   「定義は 1 か所」がテストの側から崩れる＝063h が `GachaPrizeTable.test.tsx` で採った作法）。
import { GACHA_MISS_LABEL } from "../obs-effects/gachaDraw";
import {
  SummaryView,
  SUMMARY_SESSION_LIMIT,
  SUMMARY_GACHA_DRAW_LIMIT,
} from "./SummaryView";

const mockList = vi.mocked(listStreamSessions);
const mockActive = vi.mocked(getActiveStreamSession);
const mockUpdateTitle = vi.mocked(updateStreamSessionTitle);
const mockSummary = vi.mocked(getStreamSummary);
const mockGetViewer = vi.mocked(getViewer);
const mockDraws = vi.mocked(listGachaDraws);

const makeSession = (over: Partial<StreamSessionRecord> = {}): StreamSessionRecord => ({
  id: "s1",
  startedAt: "2026-08-16T10:00:00+00:00",
  endedAt: "2026-08-16T13:00:00+00:00",
  platforms: ["twitch"],
  title: "",
  createdAt: "2026-08-16T10:00:00+00:00",
  updatedAt: "2026-08-16T13:00:00+00:00",
  ...over,
});

const makeSummary = (over: Partial<StreamSummary> = {}): StreamSummary => ({
  session: makeSession(),
  totalComments: 120,
  monetaryTotalCount: 4,
  monetaryByCurrency: [
    { currency: "BITS", amount: 500, count: 1 },
    { currency: "JPY", amount: 1500, count: 3 },
  ],
  monetaryByKind: [
    { kind: "bits", currency: "BITS", amount: 500, count: 1 },
    { kind: "donation", currency: "JPY", amount: 500, count: 1 },
    { kind: "superchat", currency: "JPY", amount: 1000, count: 2 },
  ],
  jewelsCount: 2,
  subscriptionCount: 3,
  contributors: [
    {
      viewerId: "twitch:u1",
      name: "Alice",
      source: "twitch",
      monetaryByCurrency: [{ currency: "JPY", amount: 1000, count: 2 }],
      subscriptionCount: 1,
      firstAt: "2026-08-16T10:05:00Z",
    },
    {
      viewerId: "youtube:u2",
      name: "Bob",
      source: "youtube",
      monetaryByCurrency: [],
      subscriptionCount: 2,
      firstAt: "2026-08-16T10:10:00Z",
    },
  ],
  raids: [{ name: "RaiderChannel", viewerCount: 42, at: "2026-08-16T11:00:00Z" }],
  ...over,
});

/**
 * 063i: ガチャ抽選 1 件（⚠ Rust は `drawnAt` の降順で返すので、**配列の順がそのまま画面の順**）。
 *
 * ⚠⚠ 既定の 1 件目は **`viewerId` が貢献者一覧の Alice と同じで、名前だけ違う**——
 * 「一覧は**抽選時点の名前**、貢献者一覧は**今の名前**」という **2 つの規則が同じ画面に並ぶ**のが
 * 仕様だから（穴 D）。⚠ 説明文を書かない代わりに、この差をテストが固定している。
 */
const makeDraw = (over: Partial<GachaDrawRecord> = {}): GachaDrawRecord => ({
  id: "c1:g:1:0",
  viewerId: "twitch:u1",
  viewerName: "むかしのアリス",
  gachaName: "朝ガチャ",
  prizeLabel: "色紙",
  rare: false,
  drawnAt: "2026-08-16T12:30:00Z",
  ...over,
});

const makeDraws = (): GachaDrawRecord[] => [
  makeDraw({ id: "c2:g:1:0", rare: true }),
  // ⚠ 何も当たらなかった抽選（`prizeLabel` 無し）も**1 行として並ぶ**。
  // ⚠⚠ ここは `undefined` だが、**実際に IPC 越しに来るのは serde が出す `null`** である
  //   （ts-rs が `#[ts(optional)]` で `prizeLabel?: string` を出すため、型の上では `undefined`）。
  //   ⇒ 実装は `?? GACHA_MISS_LABEL` で**両方を受ける**ので、どちらでも同じ行になる。
  //   ⚠ `null` を書くと型が通らないので、この非対称は型ではなく `??` が吸収している。
  //   【再修正トリガー】`??` を `!== undefined` 等の**片側だけを見る形**へ変えるとき
  //   ——そのときは `null` を流すケース（キャストが要る）を 1 本足すこと。
  makeDraw({
    id: "c1:g:1:0",
    viewerId: "youtube:u9",
    viewerName: "ゲスト",
    gachaName: "夜ガチャ",
    prizeLabel: undefined,
    drawnAt: "2026-08-16T11:00:00Z",
  }),
];

const makeViewerDetail = (): ViewerDetail => ({
  viewer: {
    id: "twitch:u1",
    provider: "twitch",
    providerUserId: "u1",
    name: "Alice",
    firstSeenAt: "2026-08-16T10:00:00Z",
    lastCommentAt: "2026-08-16T12:00:00Z",
    totalComments: 12,
    bitsCount: 0,
    bitsAmount: 0,
    superchatCount: 2,
    superchatAmount: 1000,
    subscriptionCount: 1,
    isMember: true,
    note: "",
    createdAt: "2026-08-16T10:00:00Z",
    updatedAt: "2026-08-16T12:00:00Z",
    // 065a: CSV からの引き継ぎ。既定は「引き継ぎ無し」（importedAt が undefined＝未取り込み）。
    nickname: "",
    label: "",
    giftCount: 3,
    streamCount: 1,
    activeDays: 1,
    importedComments: 0,
    importedGifts: 0,
    importedGiftAmount: 0,
    importedActiveDays: 0,
    importedStreamCount: 0,
  } satisfies ViewerRecord,
  comments: [],
});

beforeEach(() => {
  vi.clearAllMocks();
  mockList.mockResolvedValue([makeSession()]);
  mockActive.mockResolvedValue(null);
  mockSummary.mockResolvedValue(makeSummary());
  mockUpdateTitle.mockResolvedValue(makeSession({ title: "配信タイトル" }));
  mockGetViewer.mockResolvedValue(makeViewerDetail());
  mockDraws.mockResolvedValue(makeDraws());
});

describe("SummaryView 数字", () => {
  it("直近の配信の集計を取得して数字を並べる", async () => {
    render(<SummaryView onBack={vi.fn()} />);

    expect(await screen.findByText("120")).toBeInTheDocument(); // 総コメント数
    expect(mockSummary).toHaveBeenCalledWith("s1");
    expect(screen.getByText("4 回")).toBeInTheDocument(); // 総課金回数
    expect(screen.getByText("3 件")).toBeInTheDocument(); // サブスク件数
  });

  it("総課金額を通貨ごとに並べ、1 つの数字に丸めない", async () => {
    render(<SummaryView onBack={vi.fn()} />);

    // ⚠ 「2,000」のような通貨をまたいだ合計を出してはいけない（親 062 (2)）。
    expect(await screen.findByText("500 BITS / 1,500 JPY")).toBeInTheDocument();
    expect(screen.queryByText("2,000")).not.toBeInTheDocument();
  });

  it("Jewels は回数だけを出し、総課金額の通貨欄に現れない（論点 3）", async () => {
    render(<SummaryView onBack={vi.fn()} />);

    expect(await screen.findByText("2 回")).toBeInTheDocument(); // jewelsCount
    expect(screen.queryByText(/JEWELS/)).not.toBeInTheDocument();
  });

  it("種別ごとの内訳（スパチャ / ビッツ / ドネーション）を出す（訂正 2 の副作用の手当て）", async () => {
    render(<SummaryView onBack={vi.fn()} />);

    expect(await screen.findByText("スーパーチャット")).toBeInTheDocument();
    expect(screen.getByText("ビッツ")).toBeInTheDocument();
    expect(screen.getByText("ドネーション")).toBeInTheDocument();
    expect(screen.getByText("1,000 JPY（2 回）")).toBeInTheDocument();
  });
});

describe("SummaryView 貢献者一覧（マスト）", () => {
  it("貢献者を名前・サイト・金額・サブスク件数で並べる", async () => {
    render(<SummaryView onBack={vi.fn()} />);

    expect(await screen.findByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("1,000 JPY")).toBeInTheDocument();
    expect(screen.getByText("2 件")).toBeInTheDocument(); // Bob のサブスク
  });

  it("Rust が返した順序（金額降順）をそのまま描く", async () => {
    render(<SummaryView onBack={vi.fn()} />);
    await screen.findByText("Alice");

    const names = screen.getAllByText(/^(Alice|Bob)$/).map((el) => el.textContent);
    expect(names).toEqual(["Alice", "Bob"]);
  });

  it("行をクリックすると視聴者詳細（038b の導線）へ行く", async () => {
    render(<SummaryView onBack={vi.fn()} />);
    fireEvent.click(await screen.findByText("Alice"));

    await waitFor(() => expect(mockGetViewer).toHaveBeenCalledWith("twitch:u1"));
  });

  it("課金・サブスクが 1 件も無ければ空の案内を出す（論点 4 で絞った結果を隠さない）", async () => {
    mockSummary.mockResolvedValue(makeSummary({ contributors: [] }));
    render(<SummaryView onBack={vi.fn()} />);

    expect(await screen.findByText("課金・サブスクはありません")).toBeVisible();
  });
});

describe("SummaryView レイド一覧（マスト・Twitch のみ）", () => {
  it("誰が何人連れてきたかを出す", async () => {
    render(<SummaryView onBack={vi.fn()} />);

    expect(await screen.findByText("RaiderChannel")).toBeInTheDocument();
    expect(screen.getByText("42 人")).toBeInTheDocument();
  });

  it("YouTube 単独の配信でも欄ごと消さず「Twitch のみ」と分かるように出す", async () => {
    mockList.mockResolvedValue([makeSession({ platforms: ["youtube"] })]);
    mockSummary.mockResolvedValue(
      makeSummary({ session: makeSession({ platforms: ["youtube"] }), raids: [] }),
    );
    render(<SummaryView onBack={vi.fn()} />);

    // 見出し自体に「Twitch のみ」と書いてある（欄を消すと「機能が無い」と誤解される＝040 の先例）。
    // ⚠ **`toBeVisible` で見ること**——`toBeInTheDocument` だけだと `hidden` 属性で隠す変異が素通りする
    //   （変異実測で生存した）。「欄ごと消さない」は目に見えていて初めて意味がある。
    expect(
      await screen.findByText("レイドしてくれた人（Twitch のみ）"),
    ).toBeVisible();
    expect(screen.getByText("レイドはありません")).toBeVisible();
  });

  it("人数が不明なレイドを 0 人と偽らない", async () => {
    mockSummary.mockResolvedValue(
      makeSummary({
        raids: [{ name: "RaiderChannel", at: "2026-08-16T11:00:00Z" }],
      }),
    );
    render(<SummaryView onBack={vi.fn()} />);

    expect(await screen.findByText("不明")).toBeInTheDocument();
    expect(screen.queryByText("0 人")).not.toBeInTheDocument();
  });
});

describe("SummaryView 配信中の扱い", () => {
  it("ended_at が無ければ「配信中」と出す（接続状態を見ない＝申し送り 7）", async () => {
    mockActive.mockResolvedValue(makeSession({ endedAt: undefined }));
    mockList.mockResolvedValue([makeSession({ endedAt: undefined })]);
    mockSummary.mockResolvedValue(
      makeSummary({ session: makeSession({ endedAt: undefined }) }),
    );
    render(<SummaryView onBack={vi.fn()} />);

    // ⚠ バッジ 1 つで伝える（「配信中です。数字は…」という説明文は書かない）。
    expect(await screen.findByText("配信中")).toBeVisible();
  });

  it("終了済みなら終了時刻を出し、「配信中」は出さない", async () => {
    render(<SummaryView onBack={vi.fn()} />);
    await screen.findByText("Alice");

    expect(screen.queryByText("配信中")).not.toBeInTheDocument();
  });

  // ⚠ 申し送り 6: `ended_at` は最大 30 分ぶん後ろにずれる近似なので、**引き算した配信時間を出さない**
  //   （説明文を書かない代わりに、誤差がそのまま出る数字を作らないことで守る）。
  it("配信時間（経過時間）を計算して出さない", async () => {
    render(<SummaryView onBack={vi.fn()} />);
    await screen.findByText("Alice");

    // 10:00 開始・13:00 終了。「3 時間」等を出すと ended_at の誤差がそのまま乗る。
    expect(screen.queryByText(/時間/)).not.toBeInTheDocument();
    expect(screen.queryByText(/配信時間/)).not.toBeInTheDocument();
  });
});

/**
 * ⚠⚠ **説明文を書き戻さないことの担保**（2026-08-16 の決定）。
 *
 * 元は「注記が 6 本とも出ている」ことを固定していたが、**逆向き**に反転させた
 * ——実機で説明文が画面の大半を占めて数字が読めなかったため、依頼者の判断で全廃した。
 * ⚠ ここが落ちたら「また長い説明文を足した」ということなので、**文章ではなく構造で解き直すこと**。
 */
describe("SummaryView 説明文を書かない", () => {
  it("画面に長い説明文（注記）を出さない", async () => {
    const { container } = render(<SummaryView onBack={vi.fn()} />);
    await screen.findByText("Alice");

    // 句点を含む 30 文字以上の散文が 1 つも無いこと。
    // ⚠ 失敗した場合は文章を短くするのではなく、**構造（列・ラベル・並べ方）で伝え直す**こと。
    //
    // ⚠⚠ **レビュー Q-5 で判定を 2 点強化した**（旧実装は下の 2 通りで素通りしていた）:
    //   ① 旧: `el.children.length === 0` ＝ 子要素を 1 つでも持つ段落は**丸ごと走査対象外**だった。
    //      `<p>…<strong>…</strong>…です。</p>` のように注記へ強調を入れるだけですり抜ける。
    //      ⇒ 「**最も内側のブロック**」単位で見る（インライン要素は中身ごと拾う）。
    //   ② 旧: 走査が `p, span, div` だけ・語尾が `ます|です` だけ。箇条書き（`li`）へ移す／
    //      「〜に注意。」と書き換えるだけですり抜ける。⇒ 要素を広げ、語尾は**句点の有無**で見る。
    //
    // ⚠ **残る偽陰性**: 句点を打たない長文は捕まらない（`.statGrid` のようにセルを連結した
    //   テキストが偶然 30 文字を超えるため、句点なしまで弾くと偽陽性になる）。
    // ⚠⚠ **偽陽性の注意**: このガードは注記と**正当な固定文言（エラー・空状態）を区別できない**。
    //   現在の文言はすべて 30 文字未満なので通っているが、エラー文に一言足すと落ちる。
    //   そのときは**ガードを消さずに**、その文言だけを除外する allow-list を足すこと。
    const BLOCK = "p, li, td, h1, h2, h3, label, div, section";
    const prose = [...container.querySelectorAll(BLOCK)]
      .filter((el) => el.querySelector(BLOCK) === null)
      .map((el) => (el.textContent ?? "").trim())
      .filter((t) => t.length >= 30 && t.includes("。"));
    expect(prose).toEqual([]);
  });

  it("配信が 1 件も無ければ、説明ではなく空の状態だけを出す", async () => {
    mockList.mockResolvedValue([]);
    mockActive.mockResolvedValue(null);
    render(<SummaryView onBack={vi.fn()} />);

    expect(
      await screen.findByText("表示できる配信がありません"),
    ).toBeInTheDocument();
    expect(mockSummary).not.toHaveBeenCalled();
    // 「記録を始める前の配信は…」の類の説明を出さない。
    expect(screen.queryByText(/出てきません/)).not.toBeInTheDocument();
  });
});

describe("SummaryView セッションの選択（穴 K / 穴 I）", () => {
  // ⚠ **一覧の先頭 ≠ 進行中** のデータで確かめること（変異実測: 先頭が進行中のデータだと
  //   `shown[0]` を選ぶだけの実装と区別が付かず、この分岐が固定できていなかった）。
  //   一覧は `started_at` の降順なので、「閉じ忘れの古い進行中 ＋ そのあと終わった新しい配信」で
  //   先頭と進行中が食い違いうる。
  it("一覧の先頭でなくても、進行中のセッションを既定で選ぶ", async () => {
    const running = makeSession({
      id: "live",
      startedAt: "2026-08-15T10:00:00+00:00",
      endedAt: undefined,
    });
    const newerEnded = makeSession({
      id: "newer",
      startedAt: "2026-08-16T10:00:00+00:00",
    });
    mockActive.mockResolvedValue(running);
    mockList.mockResolvedValue([newerEnded, running]);
    render(<SummaryView onBack={vi.fn()} />);

    await waitFor(() => expect(mockSummary).toHaveBeenCalledWith("live"));
    expect(mockSummary).not.toHaveBeenCalledWith("newer");
  });

  it("進行中が無ければ直近の配信を選ぶ", async () => {
    mockActive.mockResolvedValue(null);
    mockList.mockResolvedValue([
      makeSession({ id: "newest" }),
      makeSession({ id: "older" }),
    ]);
    render(<SummaryView onBack={vi.fn()} />);

    await waitFor(() => expect(mockSummary).toHaveBeenCalledWith("newest"));
  });

  it("配信を選び直すと集計を取り直す", async () => {
    mockList.mockResolvedValue([makeSession({ id: "s1" }), makeSession({ id: "s2" })]);
    render(<SummaryView onBack={vi.fn()} />);
    await waitFor(() => expect(mockSummary).toHaveBeenCalledWith("s1"));

    fireEvent.change(screen.getByLabelText("配信を選択"), { target: { value: "s2" } });

    await waitFor(() => expect(mockSummary).toHaveBeenCalledWith("s2"));
  });

  it("更新ボタンで取り直す（⚠ ポーリングはしない＝穴 I）", async () => {
    render(<SummaryView onBack={vi.fn()} />);
    await waitFor(() => expect(mockSummary).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "更新" }));

    await waitFor(() => expect(mockSummary).toHaveBeenCalledTimes(2));
  });

  it("上限を超えた配信を黙って切らず、切ったことを画面に出す（穴 K）", async () => {
    const many = Array.from({ length: SUMMARY_SESSION_LIMIT + 5 }, (_, i) =>
      makeSession({ id: `s${i}` }),
    );
    mockList.mockResolvedValue(many);
    render(<SummaryView onBack={vi.fn()} />);

    const select = await screen.findByLabelText("配信を選択");
    expect(within(select).getAllByRole("option")).toHaveLength(SUMMARY_SESSION_LIMIT);
    // ⚠ 文章ではなく**件数の事実だけ**を添える（説明文は書かない＝2026-08-16 の決定）。
    expect(
      screen.getByText(`直近 ${SUMMARY_SESSION_LIMIT} 件 / 全 ${many.length} 件`),
    ).toBeVisible();
  });

  // ⚠⚠ レビュー Q-4: `unshift`（進行中が切り捨て範囲の外に居る）分岐が一度も通っていなかった
  //   ——`mockActive` の既定が `null` で、上の切り捨てテストでも上書きしていなかったため、
  //   当該 3 行を消しても緑のまま通った。「選んでいる配信が選択肢に無い」状態を作らないための分岐なので固定する。
  it("進行中の配信が切り捨て範囲の外に居ても、選択肢に残して既定で選ぶ（穴 K）", async () => {
    // 一覧は started_at の降順。閉じ忘れた古い進行中は末尾＝上限の外に落ちる。
    const many = Array.from({ length: SUMMARY_SESSION_LIMIT + 5 }, (_, i) =>
      makeSession({ id: `s${i}` }),
    );
    const stale = makeSession({
      id: "stale-live",
      startedAt: "2026-08-01T10:00:00+00:00",
      endedAt: undefined,
    });
    mockList.mockResolvedValue([...many, stale]);
    mockActive.mockResolvedValue(stale);
    render(<SummaryView onBack={vi.fn()} />);

    // 切り捨てられずに選択肢へ残り、既定で選ばれる。
    await waitFor(() => expect(mockSummary).toHaveBeenCalledWith("stale-live"));
    const select = await screen.findByLabelText("配信を選択");
    expect(within(select).getAllByRole("option")).toHaveLength(
      SUMMARY_SESSION_LIMIT + 1,
    );
    // ⚠ Q-6: 添える「事実」は実際の選択肢数（21）であって定数（20）ではない。
    expect(
      screen.getByText(`直近 ${SUMMARY_SESSION_LIMIT + 1} 件 / 全 26 件`),
    ).toBeVisible();
  });

  it("上限以下なら切り捨ての表示を出さない", async () => {
    render(<SummaryView onBack={vi.fn()} />);
    await screen.findByText("Alice");

    expect(screen.queryByText(/直近 20 件/)).not.toBeInTheDocument();
  });
});

describe("SummaryView 配信タイトル", () => {
  it("既存の update_stream_session_title を呼ぶだけ（検証は Rust 側）", async () => {
    render(<SummaryView onBack={vi.fn()} />);
    const input = await screen.findByLabelText("配信タイトル");

    fireEvent.change(input, { target: { value: "配信タイトル" } });
    fireEvent.click(screen.getByRole("button", { name: "タイトルを保存" }));

    await waitFor(() =>
      expect(mockUpdateTitle).toHaveBeenCalledWith("s1", "配信タイトル"),
    );
    expect(await screen.findByText("保存しました。")).toBeInTheDocument();
  });
});

describe("SummaryView 失敗時（§9）", () => {
  it("取得に失敗しても固定の安全文言だけを出す（エラー本文を出さない）", async () => {
    mockSummary.mockRejectedValue(new Error("db path /Users/secret/app.db"));
    render(<SummaryView onBack={vi.fn()} />);

    expect(
      await screen.findByText("配信サマリーを取得できませんでした。"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/secret/)).not.toBeInTheDocument();
  });

  it("一覧の取得に失敗しても固定の安全文言だけを出す", async () => {
    mockList.mockRejectedValue(new Error("boom"));
    render(<SummaryView onBack={vi.fn()} />);

    expect(
      await screen.findByText("配信の一覧を取得できませんでした。"),
    ).toBeInTheDocument();
  });
});

describe("SummaryView 戻る導線", () => {
  it("← でコメントへ戻る", async () => {
    const onBack = vi.fn();
    render(<SummaryView onBack={onBack} />);

    fireEvent.click(await screen.findByLabelText("コメントへ戻る"));
    expect(onBack).toHaveBeenCalled();
  });
});

/**
 * 063i: ガチャを引いた人の一覧。
 *
 * ⚠⚠ **並び順は「Rust が返した順」で固定する**（＝「抽選順」では書かない）。
 * 同じバッチの抽選は `drawnAt` が同値になり、その中の同点崩しは**記録 id の辞書順**＝
 * 抽選順とは無関係だからである（docs/security.md §9 追補〔063h〕§8・レビュー Q-2）。
 */
describe("SummaryView ガチャを引いた人（063i）", () => {
  it("引いた人・ガチャ・結果・時刻を並べる（レイド一覧の下）", async () => {
    render(<SummaryView onBack={vi.fn()} />);

    expect(await screen.findByText("ガチャを引いた人")).toBeVisible();
    expect(mockDraws).toHaveBeenCalledWith("s1");
    expect(screen.getByText("色紙")).toBeVisible();
    expect(screen.getByText("朝ガチャ")).toBeVisible();
    expect(screen.getByText("夜ガチャ")).toBeVisible();
  });

  /**
   * ⚠⚠⚠ **外れを意味する語をこのファイルに書かないこと。**
   *
   * 063h / 063i の確認コマンドは `grep -rn` で**その語が `src` に無いこと**を見るので、
   * テストの否定アサーションに書くと**永久にヒットし続けて確認が壊れる**
   * （`gachaDraw.ts` の [`GACHA_MISS_LABEL`] が同じ理由の注記を持っている）。
   * ⇒ 代わりに「**結果セルが `GACHA_MISS_LABEL` と完全一致すること**」で担保する
   * ——`getByText(文字列)` は既定で完全一致なので、
   * 063h が実測した「前方一致だと『何も出ない**よ**』が素通りする」穴も同時に塞げる。
   */
  it("何も出なかった抽選も 1 行として並ぶ（結果は定義された文言そのもの）", async () => {
    render(<SummaryView onBack={vi.fn()} />);
    await screen.findByText("ガチャを引いた人");

    // ⚠ 文言は定義（`GACHA_MISS_LABEL`）から引く＝テストに書き写さない
    //   （書き写すと 2 か所目になり、設定画面のテスト抽選と割れても気付けない）。
    expect(screen.getByText(GACHA_MISS_LABEL)).toBeVisible();
    // 当たりの行はそのまま景品名が出る（＝全部が「何も出ない」になる変異を殺す）。
    expect(screen.getByText("色紙")).toBeVisible();
  });

  it("レアだけにバッジを出す（列は増やさない）", async () => {
    render(<SummaryView onBack={vi.fn()} />);
    await screen.findByText("ガチャを引いた人");

    // 既定は「レアの当たり 1 件 ＋ レアでない 1 件」。
    expect(screen.getAllByText("レア")).toHaveLength(1);
    // 列にしていない＝ヘッダは 4 列のまま（「レア」の見出しは無い）。
    const head = screen.getByText("結果").parentElement!;
    expect([...head.children].map((c) => c.textContent)).toEqual([
      "時刻",
      "引いた人",
      "ガチャ",
      "結果",
    ]);
  });

  it("レアが 1 件も無ければバッジは出ない", async () => {
    mockDraws.mockResolvedValue([makeDraw({ rare: false })]);
    render(<SummaryView onBack={vi.fn()} />);
    await screen.findByText("ガチャを引いた人");

    expect(screen.queryByText("レア")).not.toBeInTheDocument();
  });

  it("1 度も引かれていない配信では 1 行の短文だけを出す（説明文を書かない）", async () => {
    mockDraws.mockResolvedValue([]);
    render(<SummaryView onBack={vi.fn()} />);

    expect(await screen.findByText("ガチャはありません")).toBeVisible();
    // ⚠ 「記録を始める前の配信だから空です」等の説明を足さない（注記全廃の決定）。
    // ⚠⚠ **ガチャ節の中だけを見る**（画面全体を `queryByText(/記録/)` で見ると、
    //   サマリーの別の節に「記録」を含む文言が入っただけで**無関係な理由で誤爆する**
    //   ——062b の「記録できなかったコメント N 件」がまさにその形）。
    const gachaSection = screen
      .getByText("ガチャを引いた人")
      .closest("section")!;
    expect(within(gachaSection).queryByText(/記録/)).not.toBeInTheDocument();
  });

  it("Rust が返した順序（時刻の降順）をそのまま描く", async () => {
    render(<SummaryView onBack={vi.fn()} />);
    await screen.findByText("ガチャを引いた人");

    const names = screen
      .getAllByText(/^(むかしのアリス|ゲスト)$/)
      .map((el) => el.textContent);
    expect(names).toEqual(["むかしのアリス", "ゲスト"]);
  });

  /**
   * ⚠⚠ 穴 D: 一覧は**抽選した時点の名前**を出す（`viewers.name` を引き直さない）。
   *
   * ⚠⚠⚠ **同じ画面に 2 つの規則が並ぶ**のが仕様である——貢献者一覧は「今の名前」（Alice）、
   * ガチャ一覧は「当時の名前」（むかしのアリス）。⚠ 説明文は書かないので、
   * **意図を固定できるのはこのテストだけ**である。
   */
  it("改名した視聴者は、貢献者一覧が今の名前・ガチャ一覧が抽選時点の名前を出す", async () => {
    render(<SummaryView onBack={vi.fn()} />);
    await screen.findByText("ガチャを引いた人");

    // 同じ視聴者（twitch:u1）が、2 つの節で別の名前で出ている。
    expect(screen.getByText("Alice")).toBeVisible();
    expect(screen.getByText("むかしのアリス")).toBeVisible();
  });

  /*
   * ⚠ **`viewerId` が DOM 属性へ出る変異は、ここでも固定していない**（063h の申し送り 5）。
   * 実装では `viewerId` は `onClick` / `onKeyDown` のクロージャの中だけで使われ、DOM 属性にも
   * `key`（ガチャ行は `d.id`）にも出ていない。⚠ **固定していないのは意図的**——
   * 上の貢献者一覧の行がまったく同じ性質で同じく未固定なので、**片方だけ固定すると
   * 「こちらだけ守られている」という誤読**を生む（この画面の第三者 id は 2 か所にある）。
   * 【再修正トリガー】行に `data-*` / `id` / `title` 等の属性を足すとき、または貢献者一覧側に
   * 同じ担保を足すとき——そのときは **2 か所同時に**（例: 行の `outerHTML` に視聴者 id が
   * 含まれないこと）固定すること。
   */
  it("行から視聴者詳細へ飛べる（貢献者一覧と同じ導線）", async () => {
    render(<SummaryView onBack={vi.fn()} />);
    fireEvent.click(await screen.findByText("むかしのアリス"));

    await waitFor(() => expect(mockGetViewer).toHaveBeenCalledWith("twitch:u1"));
  });

  it("キーボード（Enter）でも視聴者詳細へ飛べる", async () => {
    render(<SummaryView onBack={vi.fn()} />);
    await screen.findByText("ガチャを引いた人");

    const row = screen.getByText("ゲスト").closest("[role=\"button\"]");
    fireEvent.keyDown(row!, { key: "Enter" });

    await waitFor(() =>
      expect(mockGetViewer).toHaveBeenCalledWith("youtube:u9"),
    );
  });

  /**
   * ⚠⚠⚠ 申し送り 1（063h の security-review S-1）の担保。
   *
   * `gacha_draws` は `viewers` に FK を張らないので、**視聴者行が無い人のガチャ履歴が実在する**
   * （改行入りのスパチャはコメント記録が落ちて `viewers` 行を作らないが、ガチャの記録は成功する）。
   * ⚠ **実装を足す必要は無い**——`ViewerDetailPanel` が `getViewer` の失敗を既に catch している。
   * ⇒ ここでやるのは「**壊れないことをテストで固定する**」ことだけである。
   */
  it("視聴者詳細が引けなくても画面が壊れず、一覧へ戻れる", async () => {
    mockGetViewer.mockRejectedValue(new Error("not found"));
    render(<SummaryView onBack={vi.fn()} />);
    fireEvent.click(await screen.findByText("ゲスト"));

    // 固定の安全文言が出る（一覧が丸ごと開けなくなる形にはしない＝038a の amount 事故と同じ壊れ方を作らない）。
    expect(
      await screen.findByText(/この視聴者の記録が見つかりませんでした/),
    ).toBeVisible();

    fireEvent.click(screen.getByLabelText("一覧へ戻る"));
    expect(await screen.findByText("ガチャを引いた人")).toBeVisible();
  });

  it("多いときは直近 N 件に切り、切ったことを画面に出す（穴 A）", async () => {
    const many = Array.from({ length: SUMMARY_GACHA_DRAW_LIMIT + 3 }, (_, i) =>
      makeDraw({ id: `c${i}:g:1:0`, viewerName: `視聴者${i}` }),
    );
    mockDraws.mockResolvedValue(many);
    render(<SummaryView onBack={vi.fn()} />);
    await screen.findByText("ガチャを引いた人");

    expect(screen.getByText("視聴者0")).toBeVisible();
    expect(
      screen.queryByText(`視聴者${SUMMARY_GACHA_DRAW_LIMIT}`),
    ).not.toBeInTheDocument();
    // ⚠ 文章ではなく**件数の事実だけ**を添える（セッション一覧と同じ言い回し）。
    expect(
      screen.getByText(
        `直近 ${SUMMARY_GACHA_DRAW_LIMIT} 件 / 全 ${many.length} 件`,
      ),
    ).toBeVisible();
  });

  it("上限以下なら切り捨ての表示を出さない", async () => {
    render(<SummaryView onBack={vi.fn()} />);
    await screen.findByText("ガチャを引いた人");

    expect(screen.queryByText(/直近 50 件/)).not.toBeInTheDocument();
  });
});

/**
 * ⚠⚠⚠ 063i: **2 本の invoke の失敗を切り分ける**（完了条件 4）。
 *
 * ⚠ `SummaryView` の `error` は **配信一覧／サマリー／タイトル保存**の 3 用途で共用され、
 * サマリー失敗時は `setSummary(null)` も撃つ。⇒ ガチャの失敗をそこへ相乗りさせると
 * **「ガチャが取れないと配信サマリーごと出ない」**という退行になる。
 */
describe("SummaryView 2 本の取得の切り分け（063i）", () => {
  it("ガチャの取得に失敗しても、課金・レイドの節は従来どおり出る", async () => {
    mockDraws.mockRejectedValue(new Error("db path /Users/secret/app.db"));
    render(<SummaryView onBack={vi.fn()} />);

    // 既存の 2 節は無事。
    expect(await screen.findByText("Alice")).toBeVisible();
    expect(screen.getByText("課金・サブスクをしてくれた人")).toBeVisible();
    expect(screen.getByText("RaiderChannel")).toBeVisible();
    // ガチャ節だけが固定の安全文言になる（§9: エラー本文は出さない）。
    expect(
      screen.getByText("ガチャの結果を取得できませんでした。"),
    ).toBeVisible();
    expect(screen.queryByText(/secret/)).not.toBeInTheDocument();
    // ⚠⚠ 失敗を「1 回も引かれていない」と偽らない。
    expect(screen.queryByText("ガチャはありません")).not.toBeInTheDocument();
  });

  /**
   * ⚠ 逆向きは**既存構造を壊さない側**を採る（決めてテストで固定する）。
   * `summary === null` で画面全体が 1 行に落ちるのが 062c からの構造なので、
   * **サマリーが取れなければガチャ節も出さない**。
   * ⚠⚠ ガチャだけを残す形にすると、「配信の中身が分からないまま抽選結果だけが並ぶ」画面になる。
   */
  it("サマリーの取得に失敗したときは、ガチャ節も出さない（既存構造を保つ）", async () => {
    mockSummary.mockRejectedValue(new Error("boom"));
    render(<SummaryView onBack={vi.fn()} />);

    expect(
      await screen.findByText("配信サマリーを取得できませんでした。"),
    ).toBeVisible();
    expect(screen.queryByText("ガチャを引いた人")).not.toBeInTheDocument();
  });

  it("更新ボタンで 2 本とも取り直す", async () => {
    render(<SummaryView onBack={vi.fn()} />);
    await waitFor(() => expect(mockDraws).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "更新" }));

    await waitFor(() => expect(mockDraws).toHaveBeenCalledTimes(2));
    expect(mockSummary).toHaveBeenCalledTimes(2);
  });

  it("配信を選び直すとガチャも取り直す", async () => {
    mockList.mockResolvedValue([makeSession({ id: "s1" }), makeSession({ id: "s2" })]);
    render(<SummaryView onBack={vi.fn()} />);
    await waitFor(() => expect(mockDraws).toHaveBeenCalledWith("s1"));

    fireEvent.change(screen.getByLabelText("配信を選択"), {
      target: { value: "s2" },
    });

    await waitFor(() => expect(mockDraws).toHaveBeenCalledWith("s2"));
  });
});
