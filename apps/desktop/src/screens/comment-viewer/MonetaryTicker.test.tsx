import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { CommentViewDto } from "../../features/comment-viewer/types";
import { MonetaryTicker } from "./MonetaryTicker";
// 047b: ティア配色が実際に当たっているかを、CSS Modules のハッシュ名に依存せず検証するために引く。
import { TONE_CLASS } from "./monetaryTone";
import { fmtDateTime } from "./viewerFormat";

/**
 * 047: 課金ティッカー（＋クリック展開ダイアログ＋既読マーク）の描画仕様テスト。
 *
 * `CommentViewerApp` 全体は WS/TTS/AudioContext/sidecar 依存が重く単体化コストが高いが、`MonetaryTicker` は
 * props → JSX の表示コンポーネント（持つ state は「どのピルを開いているか」だけ）なので、
 * `PinnedCommentBar.test.tsx` と同じ流儀で直接テストできる。
 *
 * 仕様（こうあるべき）:
 * - 課金 0 件なら何も描かない（この機能を使わないユーザーには既存レイアウトが完全に不変）。
 * - **帯には常にラベル「投げ銭」が出る**（047b・未読 0 件でも消えない＝帯が無名になる時間を作らない）。
 * - **ピルは YouTube 厳守＝アイコン＋金額だけ**（047b）。種別ラベルと投稿者名は**視覚には出さず**
 *   `aria-label` / `title` と、クリックで開くダイアログが担う。
 * - 未読件数チップは未読が 1 件以上のときだけ出る。
 * - ピルを押すと**その時点で既読**になり（`onRead`）、✓ が付く。
 * - ダイアログは **Esc / backdrop クリック / 「閉じる」ボタン**の 3 経路で閉じる。
 * - アバターは **`data:` 始まりのときだけ**画像化し、外部 URL は踏まず頭文字へ落とす（036a のガード）。
 *
 * 抽出条件（chat が入らない・7 種別が入る・200 件クランプの影響を受けない）は `monetaryFeed.test.ts` の担当。
 */

const comment = (over: Partial<CommentViewDto> = {}): CommentViewDto => ({
  id: "m1",
  source: "youtube",
  author: { id: "u1", name: "Alice" },
  text: "応援してます",
  publishedAt: "2026-01-01T00:00:00Z",
  eventType: "superchat",
  monetaryAmount: "1,000 JPY",
  monetary: { amount: 1000, currency: "JPY" },
  ...over,
});

/**
 * 既読 id を実際に保持する薄い親。本番では `CommentViewerApp` がこの役割を担う（ビュー切替でアンマウント
 * されない場所に置く必要があるため、ティッカー自身には持たせていない）。
 */
function Harness({ items }: { items: CommentViewDto[] }) {
  const [readIds, setReadIds] = useState<ReadonlySet<string>>(() => new Set());
  return (
    <MonetaryTicker
      items={items}
      readIds={readIds}
      onRead={(id) => setReadIds((prev) => new Set(prev).add(id))}
    />
  );
}

describe("MonetaryTicker 047 課金ティッカー", () => {
  it("課金 0 件なら何も描かない（既存レイアウトが不変）", () => {
    const { container } = render(
      <MonetaryTicker items={[]} readIds={new Set()} onRead={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("047b: ピルは金額だけを見せ、種別ラベルと投稿者名は aria-label に載せる（YouTube 厳守）", () => {
    render(
      <MonetaryTicker items={[comment()]} readIds={new Set()} onRead={vi.fn()} />,
    );
    expect(screen.getByLabelText("課金コメント")).toBeTruthy();
    // 視覚に出るのは金額のみ。ピルはティア色の塗りつぶしで、色が種別と金額帯を担う。
    expect(screen.getByText("1,000 JPY")).toBeTruthy();
    expect(screen.queryByText("スーパーチャット")).toBeNull();
    expect(screen.queryByText("Alice")).toBeNull();
    // 名前と種別は支援技術には出続ける（視覚から落ちたぶん、ここが唯一のテキスト経路になる）。
    expect(
      screen.getByRole("button", { name: "未読 スーパーチャット Alice 1,000 JPY" }),
    ).toBeTruthy();
    // 本文はピルにもラベルにも出さない（クリックで開くダイアログの役割・§9）。
    expect(screen.queryByText("応援してます")).toBeNull();
  });

  it("047b: 帯のラベル「投げ銭」は未読 0 件でも消えない（何の欄か分からなくならない）", () => {
    const items = [comment()];
    const { rerender } = render(
      <MonetaryTicker items={items} readIds={new Set()} onRead={vi.fn()} />,
    );
    expect(screen.getByText("投げ銭")).toBeTruthy();

    rerender(
      <MonetaryTicker
        items={items}
        readIds={new Set(["m1"])}
        onRead={vi.fn()}
      />,
    );
    // 未読チップは消えるが、ラベルは残る。
    expect(screen.queryByText(/^未読 /)).toBeNull();
    expect(screen.getByText("投げ銭")).toBeTruthy();
  });

  it("ビッツは種別ラベルが「ビッツ」になる（displayEventType の流用・aria-label 経由）", () => {
    render(
      <MonetaryTicker
        items={[
          comment({
            eventType: "superchat",
            monetary: { amount: 100, currency: "BITS" },
            monetaryAmount: "100 bits",
          }),
        ]}
        readIds={new Set()}
        onRead={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /ビッツ/ })).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /スーパーチャット/ }),
    ).toBeNull();
  });

  it("047b: 金額を持たない課金種別はピルに種別語を出す（空のピルを作らない）", () => {
    render(
      <MonetaryTicker
        items={[
          comment({
            eventType: "membership",
            monetaryAmount: undefined,
            monetary: undefined,
          }),
        ]}
        readIds={new Set()}
        onRead={vi.fn()}
      />,
    );
    expect(screen.getByText("メンバーシップ")).toBeTruthy();
  });

  // 【重要】ピルの「額で色が変わる」は 047b の中心要件。tone クラスを当てないミューテーションを殺すために、
  // CSS Modules のハッシュ名ではなく TONE_CLASS 経由で当たり先を固定する。
  it("047b: ピルは金額に応じてティア色クラスが変わる（¥200→t1 / ¥5,000→t5）", () => {
    const sc = (amount: number) =>
      comment({
        id: `m${amount}`,
        monetaryAmount: `${amount} JPY`,
        monetary: { amount, currency: "JPY" },
      });
    render(
      <MonetaryTicker
        items={[sc(200), sc(5000)]}
        readIds={new Set()}
        onRead={vi.fn()}
      />,
    );
    expect(
      screen.getByText("200 JPY").closest("button")?.className,
    ).toContain(TONE_CLASS.t1);
    expect(
      screen.getByText("5000 JPY").closest("button")?.className,
    ).toContain(TONE_CLASS.t5);
  });

  it("036a: アバターが data URI のときだけ背景画像に差す", () => {
    const dataUri = "data:image/png;base64,AAAA";
    render(
      <MonetaryTicker
        items={[
          comment({ author: { id: "u1", name: "Alice", avatar: dataUri } }),
        ]}
        readIds={new Set()}
        onRead={vi.fn()}
      />,
    );
    const pill = screen.getByRole("button");
    expect(pill.querySelector('[style*="background-image"]')).not.toBeNull();
    // 画像があるときは頭文字を出さない。047e: 旧アサーションは `not.toContain("A1,000")` 相当で、
    // 頭文字が描画されていても連結の形が違えば通ってしまう弱い形だった。ピル全体の文字列を固定する
    // （＝金額以外は何も出ていないことまで見る）。
    expect(pill.textContent).toBe("1,000 JPY");
  });

  it("036a: アバターが外部 URL なら踏まず頭文字にフォールバックする（ガードがティッカーでも効く）", () => {
    render(
      <MonetaryTicker
        items={[
          comment({
            author: {
              id: "u1",
              name: "Alice",
              avatar: "https://evil.example/a.png",
            },
          }),
        ]}
        readIds={new Set()}
        onRead={vi.fn()}
      />,
    );
    const pill = screen.getByRole("button");
    expect(pill.innerHTML).not.toContain("evil.example");
    expect(pill.querySelector('[style*="background-image"]')).toBeNull();
    // 頭文字（コードポイント単位の先頭 1 文字）が代わりに出る。
    expect(pill.textContent).toContain("A");
  });

  // 047e（セキュリティレビュー S-A）: 036a のガードが守るのは「本体窓が外部 URL を踏まないこと」なので、
  // 純関数の単体（viewerFormat.test.ts）だけでなく**実際に描かれた DOM**でも固定する。`data:` で始まりつつ
  // 引用符を含む値は `url("…"), url("https://…")` の 2 層背景を作れてしまい、2 層目が実 egress になる。
  it("036a: data: 始まりでも引用符で url() を閉じる値は背景画像にしない（本体窓からの egress を作らない）", () => {
    render(
      <MonetaryTicker
        items={[
          comment({
            author: {
              id: "u1",
              name: "Alice",
              avatar:
                'data:image/png;base64,AAA"),url("https://evil.example/x.png',
            },
          }),
        ]}
        readIds={new Set()}
        onRead={vi.fn()}
      />,
    );
    const pill = screen.getByRole("button");
    expect(pill.innerHTML).not.toContain("evil.example");
    expect(pill.querySelector('[style*="background-image"]')).toBeNull();
    // 画像化せず頭文字へ落ちる（表示は壊れない）。
    expect(pill.textContent).toContain("A");
  });

  it("未読件数チップを出す（全部既読になったら消える）", () => {
    const items = [comment({ id: "m1" }), comment({ id: "m2" })];
    const { rerender } = render(
      <MonetaryTicker items={items} readIds={new Set()} onRead={vi.fn()} />,
    );
    expect(screen.getByText("未読 2")).toBeTruthy();

    rerender(
      <MonetaryTicker
        items={items}
        readIds={new Set(["m1"])}
        onRead={vi.fn()}
      />,
    );
    expect(screen.getByText("未読 1")).toBeTruthy();

    rerender(
      <MonetaryTicker
        items={items}
        readIds={new Set(["m1", "m2"])}
        onRead={vi.fn()}
      />,
    );
    expect(screen.queryByText(/^未読/)).toBeNull();
  });

  it("ピルを押すと既読になり、✓ が付いて未読件数が減る", () => {
    render(<Harness items={[comment()]} />);
    expect(screen.getByText("未読 1")).toBeTruthy();
    expect(screen.queryByText("✓")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /^未読/ }));

    expect(screen.getByText("✓")).toBeTruthy();
    expect(screen.queryByText(/^未読 /)).toBeNull();
    // 既読/未読は視覚（✓・枠色）だけでなく読み上げ名にも出す。
    expect(screen.getByRole("button", { name: /^既読/ })).toBeTruthy();
  });

  it("押されたピルの id を親へ返す（既読の実体は親が持つ）", () => {
    const onRead = vi.fn();
    render(
      <MonetaryTicker
        items={[comment({ id: "target-id" })]}
        readIds={new Set()}
        onRead={onRead}
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onRead).toHaveBeenCalledTimes(1);
    expect(onRead).toHaveBeenCalledWith("target-id");
  });

  it("ピルのクリックでダイアログが開き、本文・金額・受信時刻が全文で出る", () => {
    render(<Harness items={[comment()]} />);
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /^未読/ }));

    const dialog = screen.getByRole("dialog") as HTMLDialogElement;
    // showModal 済み（＝focus trap・Esc・backdrop がブラウザ標準で効く状態）。
    expect(dialog.open).toBe(true);
    expect(screen.getByText("応援してます")).toBeTruthy();
    expect(screen.getByText("YouTube")).toBeTruthy();
    expect(screen.getByText(fmtDateTime("2026-01-01T00:00:00Z"))).toBeTruthy();
  });

  it("金額を持たない課金種別は、ダイアログで要約文言が読める（composeEventMessage の流用）", () => {
    render(
      <Harness
        items={[
          comment({
            eventType: "subscription",
            source: "twitch",
            text: "",
            monetaryAmount: undefined,
            monetary: undefined,
            monthCount: 3,
            tier: 1,
          }),
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^未読/ }));
    expect(
      screen.getByText("Aliceさんがサブスクを3ヶ月継続しました（Tier1）"),
    ).toBeTruthy();
  });

  it("「閉じる」ボタンで閉じる", () => {
    render(<Harness items={[comment()]} />);
    fireEvent.click(screen.getByRole("button", { name: /^未読/ }));
    fireEvent.click(screen.getByRole("button", { name: "閉じる" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Esc（cancel イベント）で閉じる（既定 close を止めて state 経由で閉じる）", () => {
    render(<Harness items={[comment()]} />);
    fireEvent.click(screen.getByRole("button", { name: /^未読/ }));
    fireEvent(
      screen.getByRole("dialog"),
      new Event("cancel", { cancelable: true }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("backdrop（ダイアログ要素自身）のクリックで閉じる／本文のクリックでは閉じない", () => {
    render(<Harness items={[comment()]} />);
    fireEvent.click(screen.getByRole("button", { name: /^未読/ }));

    // 本文上のクリックは target が <dialog> にならないので閉じない。
    fireEvent.click(screen.getByText("応援してます"));
    expect(screen.queryByRole("dialog")).not.toBeNull();

    fireEvent.click(screen.getByRole("dialog"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("開いたまま中身が更新されたら（jewels の combo）ダイアログにも反映される", () => {
    const jewels = (over: Partial<CommentViewDto> = {}) =>
      comment({
        id: "g1",
        eventType: "jewels",
        text: "",
        monetaryAmount: "30 jewels",
        monetary: { amount: 30, currency: "JEWELS" },
        ...over,
      });
    const { rerender } = render(
      <MonetaryTicker
        items={[jewels()]}
        readIds={new Set()}
        onRead={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^未読/ }));
    expect(screen.getAllByText("30 jewels").length).toBeGreaterThan(0);

    // 開いている対象は id ではなく items から引き直しているので、combo 更新が届けば表示も伸びる。
    rerender(
      <MonetaryTicker
        items={[jewels({ monetaryAmount: "90 jewels", comboCount: 3 })]}
        readIds={new Set()}
        onRead={vi.fn()}
      />,
    );
    expect(screen.queryByText("30 jewels")).toBeNull();
    expect(screen.getAllByText("90 jewels").length).toBeGreaterThan(0);
  });
});

/**
 * 047f（実機不具合）: **マウスの縦ホイールで帯を横スクロールできる**ことの仕様テスト。
 *
 * 背景: 047d が横スクロールバーを消した（帯の内側の高さを食ってピルが上下に切れる不具合の対処）際の
 * 申し送りは「Tab の自動横スクロールとトラックパッド/Shift+ホイールが効くので操作性は落ちない」だったが、
 * **マウス（ホイールのみ）が想定から漏れており、横へ動かす手段が実質ゼロ**になっていた。
 *
 * あるべき挙動:
 * - 縦ホイール（`deltaY`）で `scrollLeft` が動く。
 * - **`deltaX` があるときは触らない**（トラックパッドの横スワイプはブラウザ標準が動かすので、倍速にしない）。
 * - **実際に動かせるときだけ `preventDefault()`**。溢れていない／端に達しているときは既定動作へ流す
 *   （＝標準のスクロールチェーン。常に止めるとピルが少ないときホイールが死んだように感じる）。
 *
 * ⚠ jsdom はレイアウトを持たない（`scrollWidth`/`clientWidth` は常に 0）ので、**寸法は明示的に注入**して
 * ハンドラの契約だけを固定する。実際の操作感は E2E（実機）の担当。
 */
describe("MonetaryTicker 047f ホイールでの横スクロール", () => {
  /**
   * ティッカーのトラック（`overflow-x: auto` のスクロール領域）を取り出す。
   *
   * 【レビュー・修正不要】DOM 構造に依存した掴み方（`section > div:nth-of-type(2)`）である点は承知のうえ。
   * トラックには role も aria-label も無く（ラベルは帯 `section` 側が持つ・中身のピルが実 `<button>` なので
   * 支援技術向けの追加ラベルは不要という 047d の判断）、テストのためだけに `data-testid` を実装へ足すのを
   * 避けた。構造が変わった場合も**listener が張られていない別要素を掴む＝ケースが落ちる**ので、
   * 静かに緑になる（vacuous に通る）ことはない。
   * 再修正トリガー: 帯の構造をもう一度変えるとき、または帯の中に別のスクロール領域が増えるとき。
   */
  const track = (container: HTMLElement): HTMLElement => {
    const el = container.querySelector("section > div:nth-of-type(2)");
    if (!(el instanceof HTMLElement)) throw new Error("トラックが見つからない");
    return el;
  };
  /** jsdom に無い寸法を注入する（scrollWidth > clientWidth ＝ 横に溢れている状態）。 */
  const sized = (el: HTMLElement, scrollWidth: number, clientWidth: number) => {
    Object.defineProperty(el, "scrollWidth", { value: scrollWidth, configurable: true });
    Object.defineProperty(el, "clientWidth", { value: clientWidth, configurable: true });
    el.scrollLeft = 0;
  };
  /** `{ passive: false }` で張った listener を通す＝React の onWheel では届かない経路。 */
  const wheel = (el: HTMLElement, init: WheelEventInit): WheelEvent => {
    const e = new WheelEvent("wheel", { bubbles: true, cancelable: true, ...init });
    el.dispatchEvent(e);
    return e;
  };

  it("縦ホイールで横スクロールする（マウスだけで帯を動かせる）", () => {
    const { container } = render(
      <MonetaryTicker items={[comment()]} readIds={new Set()} onRead={vi.fn()} />,
    );
    const el = track(container);
    sized(el, 800, 300);

    const e = wheel(el, { deltaY: 120 });

    expect(el.scrollLeft).toBe(120);
    expect(e.defaultPrevented).toBe(true); // 親が縦に動くのを止める
  });

  it("トラックパッドの横スワイプ（deltaX あり）には手を出さない（倍速にしない）", () => {
    const { container } = render(
      <MonetaryTicker items={[comment()]} readIds={new Set()} onRead={vi.fn()} />,
    );
    const el = track(container);
    sized(el, 800, 300);

    const e = wheel(el, { deltaX: 40, deltaY: 10 });

    expect(el.scrollLeft).toBe(0); // ブラウザ標準に任せる
    expect(e.defaultPrevented).toBe(false);
  });

  it("溢れていないときは既定動作へ流す（ホイールが死んだように感じさせない）", () => {
    const { container } = render(
      <MonetaryTicker items={[comment()]} readIds={new Set()} onRead={vi.fn()} />,
    );
    const el = track(container);
    sized(el, 300, 300); // 横に溢れていない

    const e = wheel(el, { deltaY: 120 });

    expect(el.scrollLeft).toBe(0);
    expect(e.defaultPrevented).toBe(false);
  });

  it("右端まで来たら既定動作へ流す（スクロールチェーン）", () => {
    const { container } = render(
      <MonetaryTicker items={[comment()]} readIds={new Set()} onRead={vi.fn()} />,
    );
    const el = track(container);
    sized(el, 800, 300);
    el.scrollLeft = 500; // = scrollWidth - clientWidth ＝ 右端

    const e = wheel(el, { deltaY: 120 });

    expect(el.scrollLeft).toBe(500);
    expect(e.defaultPrevented).toBe(false);
  });

  it("行単位で届くホイール（DOM_DELTA_LINE）は px 換算する", () => {
    const { container } = render(
      <MonetaryTicker items={[comment()]} readIds={new Set()} onRead={vi.fn()} />,
    );
    const el = track(container);
    sized(el, 800, 300);

    wheel(el, { deltaY: 3, deltaMode: 1 });

    expect(el.scrollLeft).toBe(48); // 3 行 × 16px
  });
});
