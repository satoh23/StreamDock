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

import {
  listStreamSessions,
  getActiveStreamSession,
  updateStreamSessionTitle,
} from "../../features/stream-session/streamSessionApi";
import { getStreamSummary } from "../../features/stream-summary/streamSummaryApi";
import { getViewer } from "../../features/viewer-memory/viewerMemoryApi";
import { SummaryView, SUMMARY_SESSION_LIMIT } from "./SummaryView";

const mockList = vi.mocked(listStreamSessions);
const mockActive = vi.mocked(getActiveStreamSession);
const mockUpdateTitle = vi.mocked(updateStreamSessionTitle);
const mockSummary = vi.mocked(getStreamSummary);
const mockGetViewer = vi.mocked(getViewer);

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
