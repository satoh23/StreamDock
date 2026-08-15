import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  OBS_SOURCE_TEST_FIRE_KEY,
  parseObsSourceTestFire,
  type ObsSourceListSnapshot,
} from "../../features/comment-viewer/overlaySettings";
import { ObsSourceCard } from "./ObsSourceCard";
import type { ObsSourceListStatus } from "./obsSourceListStatus";
import type { ObsSourceListState } from "./useObsSourceList";

/**
 * 064a/064c/064f: **OBS 側のソースを手動で再生する**カードの仕様テスト。
 *
 * ## ⚠⚠ 064f: このカードは**表示専用**になった
 *
 * 取得ボタンが画面のタイトル行へ移り、状態の持ち主は `ObsEffectsScreen`（[`useObsSourceList`]）に
 * なった。⇒ ⚠ **依頼を出す・返事を待つ・`storage` を購読する側の検査は
 * `ObsEffectsScreen.test.tsx`（＝実際の配線）へ移してある。** ここで見るのは
 * 「**渡された状態が、ユーザーに読める形で出ているか**」だけである。
 *
 * ⚠⚠ 固定したい不変条件:
 * - **main 窓は OBS へ直接触らない**——やるのは localStorage へ依頼を書くことだけ
 *   （実際に投げるのはコメビュ窓。この非対称は構造上のもので、崩すと main 窓に WS を持たせることになる）。
 * - **ソース名を画面側で検証しない**（壁は sidecar 側の 2 枚＝形式検査と `GetInputList` の実在照合）。
 * - ⚠⚠ **064c: どの状態でも「次にやること」が読める**（黙って何も起きない状態を作らない）。
 *   ⚠ **状態そのものの決め方は [`obsSourceListStatus`] 側で固定してある。**
 *
 * ⚠⚠⚠ **064e: 「現在のシーンに置いたソースだけ再生できる」の note を削除した**（依頼者の指示）。
 * ⚠ 064a はこれを「書かないとバグとして報告される」として置いており、**実際に情報を 1 つ失っている**。
 * ⇒ **再修正トリガー＝「一覧に出るのに再生されない」と実機で言われたとき**（`ObsSourceCard` の
 * 該当箇所のコメントが正）。⚠ **そのとき常時表示の note を戻すのではなく、失敗した行にだけ出すこと。**
 */

describe("ObsSourceCard（064f: 表示専用）", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  const snapshot = (
    sources: { name: string; kind: string }[],
    ok = true,
  ): ObsSourceListSnapshot => ({ at: 1_700_000_000_000, ok, sources });

  /** ⚠ カードは表示専用なので、状態は**手で組んで渡す**（実際の組み立てはフックの仕事）。 */
  const renderCard = (over: Partial<ObsSourceListState> = {}) =>
    render(
      <ObsSourceCard
        state={{
          list: null,
          status: "never" as ObsSourceListStatus,
          refresh: vi.fn(),
          blocked: false,
          ...over,
        }}
      />,
    );

  // --- ⚠⚠⚠ 064c の中心: 「繋がらない」と「0 件」を取り違えない -------------------------------

  it("⚠⚠⚠ OBS へ繋がらなかったときに「シーンにソースを追加」と言わない", () => {
    // ⚠⚠ **064a はここで嘘をついていた**——失敗も成功も空配列で来ていたので、
    //   OBS が落ちているだけのユーザーを「OBS でソースを作る」作業へ誘導していた
    //   （061a レビュー Q-1 と同じ失敗モードの 3 度目）。
    renderCard({ status: "disconnected", list: snapshot([], false) });

    expect(screen.getByText(/OBS に接続できませんでした/)).toBeTruthy();
    // ⚠ **本命のアサーション**（文言が戻ってきたら落ちる）。
    expect(screen.queryByText(/メディアソース/)).toBeNull();
  });

  it("⚠⚠ 繋がったうえで 0 件のときだけ「シーンにソースを追加」と案内する", () => {
    renderCard({ status: "empty", list: snapshot([]) });

    expect(screen.getByText(/メディアソース/)).toBeTruthy();
    expect(screen.queryByText(/OBS に接続できませんでした/)).toBeNull();
  });

  // --- 状態ごとの案内（黙って何も起きない状態を作らない）-----------------------------------------

  it("⚠ まだ 1 度も取っていないときは、次にやることを出す（下の条件が空である理由）", () => {
    renderCard({ status: "never" });
    // ⚠⚠ **画面にあるボタン名と揃える**（064f で「最新のOBSのソースを取得」へ改名した）。
    //   ⚠ 揃っていないと「存在しない操作の案内」になる（061i レビュー S-1 が 2 度踏んだ失敗モード）。
    expect(screen.getByText(/「最新のOBSのソースを取得」を押してください/)).toBeTruthy();
  });

  it("取得中はそう言う", () => {
    renderCard({ status: "pending", list: snapshot([]) });
    expect(screen.getByText(/取得しています/)).toBeTruthy();
  });

  it("⚠ 待ちきれなかったときはそう言う（「取得しています」を残さない）", () => {
    renderCard({ status: "timeout" });
    expect(screen.getByText(/応答がありませんでした/)).toBeTruthy();
    expect(screen.queryByText(/取得しています/)).toBeNull();
  });

  it("⚠ コメビュ窓が閉じていれば理由を出す", () => {
    renderCard({ status: "no-viewer" });
    expect(screen.getByText(/コメントビューアを開くと/)).toBeTruthy();
  });

  // --- 一覧と再生 ------------------------------------------------------------------------------

  it("一覧が来たら名前と種別を出す", () => {
    renderCard({
      status: "ready",
      list: snapshot([
        { name: "きらきら演出", kind: "ffmpeg_source" },
        { name: "紙吹雪", kind: "image_source" },
      ]),
    });
    expect(screen.getByText("きらきら演出")).toBeTruthy();
    expect(screen.getByText("動画")).toBeTruthy();
    expect(screen.getByText("紙吹雪")).toBeTruthy();
    expect(screen.getByText("画像")).toBeTruthy();
  });

  it("⚠ 「いつ時点の一覧か」を出す（OBS 側で足した人が古い一覧と誤認しない）", () => {
    renderCard({
      status: "ready",
      list: snapshot([{ name: "A", kind: "ffmpeg_source" }]),
    });
    // ⚠ 表記は `HH:MM`（`toLocaleTimeString` を使わない＝実行環境のロケールで変わらない）。
    expect(screen.getByText(/^\d{2}:\d{2} 時点の一覧です。$/)).toBeTruthy();
  });

  it("⚠ 取得中は「いつ時点か」を出さない（古い時刻を今の結果と誤認させない）", () => {
    renderCard({
      status: "pending",
      list: snapshot([{ name: "A", kind: "ffmpeg_source" }]),
    });
    expect(screen.queryByText(/時点の一覧です。/)).toBeNull();
  });

  it("⚠⚠ 「再生する」は選んだソース名と表示時間を wire に載せる", () => {
    renderCard({
      status: "ready",
      list: snapshot([{ name: "きらきら演出", kind: "ffmpeg_source" }]),
    });
    fireEvent.click(screen.getByText("再生する"));

    const fire = parseObsSourceTestFire(
      localStorage.getItem(OBS_SOURCE_TEST_FIRE_KEY),
    );
    expect(fire).not.toBeNull();
    expect(fire?.sourceName).toBe("きらきら演出");
    expect(fire?.durationMs).toBeGreaterThan(0);
  });

  it("⚠ 行を取り違えない（押したソースの名前が載る）", () => {
    renderCard({
      status: "ready",
      list: snapshot([
        { name: "A", kind: "ffmpeg_source" },
        { name: "B", kind: "ffmpeg_source" },
      ]),
    });
    fireEvent.click(screen.getAllByText("再生する")[1]);
    expect(
      parseObsSourceTestFire(localStorage.getItem(OBS_SOURCE_TEST_FIRE_KEY))
        ?.sourceName,
    ).toBe("B");
  });

  it("⚠⚠ ソース名に `:` が含まれていても壊れない（wire の分解が先頭 2 つで切っている）", () => {
    // ⚠ `split(":")` で全部割る実装だと、この名前は再生できなくなる（実在するのに「見つかりません」になる）。
    renderCard({
      status: "ready",
      list: snapshot([{ name: "12:34 の演出", kind: "ffmpeg_source" }]),
    });
    fireEvent.click(screen.getByText("再生する"));
    expect(
      parseObsSourceTestFire(localStorage.getItem(OBS_SOURCE_TEST_FIRE_KEY))
        ?.sourceName,
    ).toBe("12:34 の演出");
  });

  it("⚠⚠ コメビュ窓が閉じていても一覧は隠さない（条件への割り当ては続けられる）", () => {
    // ⚠ 下の `EffectAssignmentCard` は**同じ localStorage を読む**ので、ここで隠すと
    //   「`<select>` には出るのにこのカードには無い」という食い違いになる。
    //   ⚠ ただし再生の依頼も届かないので、「再生する」は押せない。
    renderCard({
      status: "no-viewer",
      blocked: true,
      list: snapshot([{ name: "きらきら演出", kind: "ffmpeg_source" }]),
    });

    expect(screen.getByText("きらきら演出")).toBeTruthy();
    expect(screen.getByText("再生する").closest("button")?.disabled).toBe(true);
  });

  it("⚠ 塞がれていなければ「再生する」は押せる", () => {
    renderCard({
      status: "ready",
      list: snapshot([{ name: "A", kind: "ffmpeg_source" }]),
    });
    expect(screen.getByText("再生する").closest("button")?.disabled).toBe(false);
  });

  it("⚠⚠ 064e/064f: 常時表示の説明文を持たない（見出し以外の恒常テキストを増やさない）", () => {
    // ⚠⚠ **064e で 2 本消した**——カードの説明文と「現在のシーンに置いたソースだけ再生できます」。
    //   ⚠ 依頼者の指示は 061p 以来一貫して「**説明が長い**」なので、
    //   **「親切だから」で常時表示の note を書き戻す変異をここで殺す**。
    //   ⚠ 状態ごとの案内（未取得・取得中・接続失敗・0 件）は**別物**で、あれは条件付きで出る
    //   ＝「黙って何も起きない」を防ぐ本体である（上のケース群が固定している）。
    const { container } = renderCard({
      status: "ready",
      list: snapshot([{ name: "A", kind: "ffmpeg_source" }]),
    });

    expect(screen.queryByText(/シーンに置いてある/)).toBeNull();
    // ⚠ 064e: 「鳴らす」系の語も画面から消えた（依頼者＝「言葉の意味が不明」）。
    expect(container.textContent).not.toContain("鳴ら");
  });

  it("⚠ 064f: 見出しは「エフェクトを手動再生」（コメントでの自動再生と対になる）", () => {
    renderCard({ status: "never" });
    expect(
      screen.getByRole("heading", { name: "エフェクトを手動再生" }),
    ).toBeInTheDocument();
  });
});
