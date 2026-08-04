import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import type { CommentViewDto } from "../../features/comment-viewer/types";
import {
  toPinned,
  savePinned,
  PINNED_COMMENTS_KEY,
} from "../../features/comment-viewer/pinnedComments";
import {
  OVERLAY_SHOW_SOURCE_KEY,
  saveOverlayShowSource,
} from "../../features/comment-viewer/overlaySettings";
import { PinnedOverlayApp } from "./PinnedOverlayApp";

/**
 * 046b: 固定コメント専用オーバーレイ（別ウィンドウ label `pinned-overlay`）の描画仕様テスト。
 *
 * 仕様（こうあるべき・docs/tasks/046b-pinned-overlay-window.md / 親 046）:
 * - **WS へ接続しない**（`connectCommentStream` を呼ばない）＝表示専用・通信面ゼロ。
 * - 046a のピンストア（localStorage）を **read-on-mount** で読み、固定コメントを描く。
 * - 他窓（コメビュ本体）の書換を **`storage` 購読**で即反映する。**固定解除は `"[]"` の書込として届く**
 *   （046a はキーを消さないので newValue が null にならない）。
 * - **固定 0 件なら何も描かない**（完全透明）。既存 `comment-overlay` と違い 0 件が通常状態なので、
 *   「コメントはまだありません」を OBS に出し続けない。
 * - 背景透過のため document に `data-overlay="1"` を立て、unmount で外す（他窓へ波及させない）。
 *
 * 実 WS を張らないよう `connectCommentStream` はモックする（**呼ばれないこと自体が検証対象**）。
 * localStorage は実物（jsdom）を使い、各テストでクリアする。
 */

const mocks = vi.hoisted(() => ({ connectCommentStream: vi.fn() }));

// 表示専用の担保。実装がうっかり WS へ繋いだら「呼ばれない」ケースがレッドになる。
vi.mock("../../features/comment-viewer/commentStream", () => ({
  connectCommentStream: mocks.connectCommentStream,
}));

const makePinned = (over: Partial<CommentViewDto> = {}) =>
  toPinned({
    id: "p1",
    source: "twitch",
    author: { id: "u1", name: "Alice" },
    text: "固定したコメント",
    publishedAt: "2026-07-29T10:00:00Z",
    eventType: "chat",
    ...over,
  });

/** 他窓（コメビュ本体）での localStorage 書換を再現する（自窓の書換では storage は発火しないため手で撃つ）。 */
function emitStorage(key: string | null, newValue: string | null) {
  act(() => {
    window.dispatchEvent(new StorageEvent("storage", { key, newValue }));
  });
}

/**
 * 046c: jsdom はレイアウトを実装しておらず `scrollHeight`/`clientHeight` が常に 0 なので、
 * 測定値を差し込めるようにする（どちらも `Element.prototype` 上の configurable な getter＝上書き可能）。
 *
 * 偽の測定値では「幅に応じた本文の再フロー」まで再現できないため、**スケールの具体値は検証しない**
 * （テスト内に同じモデルを書くだけのトートロジーになる）。数値探索の性質は `overlayFit.test.ts` で押さえてあるので、
 * ここでは「縮めるか / 縮めないか」という粗い性質だけを固定する。
 */
let stubContent = 0;
let stubAvailable = 0;
let restoreLayout: (() => void) | null = null;

function stubLayout(content: number, available: number) {
  // ⚠ **`content`（scrollHeight）は必ず `available`（clientHeight）以上へ丸める**。実 DOM の scrollHeight は
  // 仕様上 clientHeight を下限にクランプされるため、`content < available` は物理的に起こり得ない。
  // レビュー指摘（046c 初回実装の再発防止）: ここを引数そのままにすると、旧判定式
  // `content <= available - FIT_SAFETY_PX` が `stubLayout(200, 560)` で真になってしまい、
  // **バグ入りの実装でも「収まっているときは縮めない」ケースがグリーンになる**
  //（overlayFit.test.ts のモデルには同じ制約を入れたが、こちらは漏れていた）。
  stubContent = Math.max(content, available);
  stubAvailable = available;
  if (restoreLayout) return;
  const props = ["scrollHeight", "clientHeight"] as const;
  const originals = props.map(
    (p) => [p, Object.getOwnPropertyDescriptor(Element.prototype, p)] as const,
  );
  Object.defineProperty(Element.prototype, "scrollHeight", {
    configurable: true,
    get: () => stubContent,
  });
  Object.defineProperty(Element.prototype, "clientHeight", {
    configurable: true,
    get: () => stubAvailable,
  });
  restoreLayout = () => {
    for (const [prop, descriptor] of originals) {
      if (descriptor) Object.defineProperty(Element.prototype, prop, descriptor);
    }
  };
}

/** 描画された `.root`（縮小フィットの対象＝`.fit` ラッパの子）。 */
const fitTarget = (container: HTMLElement): HTMLElement =>
  container.firstElementChild?.firstElementChild as HTMLElement;

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  // 属性が残ると次のテスト（および他窓相当の描画）へ透過 CSS が漏れる。cleanup 後の状態を明示的に確認する。
  // 046b レビュー（修正不要）: これは衛生目的で、unmount cleanup の検証を隠蔽しない。
  // cleanup の担保は下の「unmount で外す」ケース（unmount() を明示的に呼んで属性の消滅を見る）が持っており、
  // 実装の removeAttribute を落とせばそのケースがレッドになる。
  document.documentElement.removeAttribute("data-overlay");
  // 046c: レイアウトの偽装は必ず元へ戻す（Element.prototype への上書きなので、漏れると他の全ケースに波及する）。
  restoreLayout?.();
  restoreLayout = null;
  stubContent = 0;
  stubAvailable = 0;
});

describe("PinnedOverlayApp 046b 固定コメント専用オーバーレイ", () => {
  it("WS へ接続しない（表示専用・通信面ゼロ）", () => {
    savePinned([makePinned()]);
    render(<PinnedOverlayApp />);
    expect(mocks.connectCommentStream).not.toHaveBeenCalled();
  });

  it("read-on-mount: 保存済みの固定コメントを描く（窓を開き直せば必ず最新）", () => {
    savePinned([makePinned({ text: "見失いたくないコメント" })]);
    render(<PinnedOverlayApp />);
    expect(screen.getByText("見失いたくないコメント")).toBeTruthy();
    expect(screen.getByText("Alice")).toBeTruthy();
  });

  it("固定 0 件なら何も描かない（空文言を OBS に出し続けない）", () => {
    const { container } = render(<PinnedOverlayApp />);
    expect(container.firstChild).toBeNull();
    // 既存 comment-overlay が 0 件時に出す文言は、こちらでは出さない（0 件が通常状態のため）。
    expect(screen.queryByText("コメントはまだありません")).toBeNull();
  });

  it("storage: 他窓での固定をそのまま反映する（開いたまま即反映）", () => {
    render(<PinnedOverlayApp />);
    expect(screen.queryByText("あとから固定")).toBeNull();

    const next = JSON.stringify([makePinned({ text: "あとから固定" })]);
    localStorage.setItem(PINNED_COMMENTS_KEY, next);
    emitStorage(PINNED_COMMENTS_KEY, next);

    expect(screen.getByText("あとから固定")).toBeTruthy();
  });

  it('storage: 固定解除は "[]" の書込として届き、表示が消える', () => {
    savePinned([makePinned({ text: "消えるはず" })]);
    render(<PinnedOverlayApp />);
    expect(screen.getByText("消えるはず")).toBeTruthy();

    // 046a はキーを削除せず "[]" を書く（削除だと newValue が null になり「未保存」と区別できない）。
    localStorage.setItem(PINNED_COMMENTS_KEY, "[]");
    emitStorage(PINNED_COMMENTS_KEY, "[]");

    expect(screen.queryByText("消えるはず")).toBeNull();
  });

  it("storage: 無関係なキーの書換では読み直さない（他窓の設定変更で固定が消えない）", () => {
    savePinned([makePinned({ text: "残るはず" })]);
    render(<PinnedOverlayApp />);

    // 別キーの変更中に、ピンストアだけを（storage を撃たずに）空にしても表示は変わらない
    // ＝ピン用の分岐が対象キーで絞れている（絞りを外すと空に読み直されてレッドになる）。
    localStorage.setItem(PINNED_COMMENTS_KEY, "[]");
    emitStorage("stream-dock.comment-viewer.channel", "other");

    expect(screen.getByText("残るはず")).toBeTruthy();
  });

  it("storage: clear()（key=null）では両方読み直す", () => {
    savePinned([makePinned({ text: "clear で消える" })]);
    render(<PinnedOverlayApp />);
    expect(screen.getByText("clear で消える")).toBeTruthy();

    localStorage.clear();
    emitStorage(null, null);

    expect(screen.queryByText("clear で消える")).toBeNull();
  });

  it("既存オーバーレイ設定（サイト名表示）に追従する", () => {
    saveOverlayShowSource(true);
    savePinned([makePinned()]);
    render(<PinnedOverlayApp />);
    expect(screen.getByText("Twitch")).toBeTruthy();

    // 設定窓での OFF も storage で届く（2 窓で書体・サイト名の有無が食い違わない）。
    saveOverlayShowSource(false);
    emitStorage(OVERLAY_SHOW_SOURCE_KEY, "false");
    expect(screen.queryByText("Twitch")).toBeNull();
  });

  it("金額を持たない課金種別も本体と同じ要約文言で描ける（monthCount/tier を保存している効果）", () => {
    savePinned([
      makePinned({
        text: "",
        eventType: "subscription",
        monthCount: 3,
        tier: 1,
      }),
    ]);
    render(<PinnedOverlayApp />);
    // 046a が monthCount/tier を保存しているので、WS へ繋がないこの窓でも本体と同じ文言を再現できる
    //（どちらかが保存対象から落ちると月数か Tier 表記が欠けてレッドになる）。
    expect(
      screen.getByText("Aliceさんがサブスクを3ヶ月継続しました（Tier1）"),
    ).toBeTruthy();
  });

  it("背景透過の目印 data-overlay を立て、unmount で外す（他窓へ波及させない）", () => {
    savePinned([makePinned()]);
    const { unmount } = render(<PinnedOverlayApp />);
    expect(document.documentElement.getAttribute("data-overlay")).toBe("1");
    unmount();
    expect(document.documentElement.hasAttribute("data-overlay")).toBe(false);
  });

  it("固定 0 件でも透過の目印は立てる（窓自体は開いたまま完全透明にする）", () => {
    render(<PinnedOverlayApp />);
    // 0 件で null を返しても effect は走る＝窓の背景は透明のまま（不透明な var(--bg) が出ない）。
    expect(document.documentElement.getAttribute("data-overlay")).toBe("1");
  });
});

/**
 * 046c: 長文が窓に収まらないときの自動縮小フィット。
 *
 * あるべき挙動（docs/tasks/046c-pinned-overlay-long-text-fit.md）:
 * - **収まっているときは何も付けない**（短文では 046b 時点と DOM が完全に同一＝既存の見た目を変えない）。
 * - 収まらないときだけ `transform: scale()` ＋ `width`/`height` の**サイズ補正**を当てる。
 *   サイズ補正が無いと `ol` の測定値が変わらず収まり判定が動かないので、3 点セットで検証する。
 * - 窓のリサイズで測り直す。
 */
describe("PinnedOverlayApp 046c 長文の自動縮小フィット", () => {
  it("収まっているときは transform を付けない（短文で既存の見た目を変えない）", () => {
    stubLayout(200, 560);
    savePinned([makePinned()]);
    const { container } = render(<PinnedOverlayApp />);

    const root = fitTarget(container);
    expect(root.style.transform).toBe("");
    expect(root.style.width).toBe("");
    expect(root.style.height).toBe("");
  });

  it("収まらないときは縮小し、サイズ補正もあわせて当てる", () => {
    // 290 字 / 320px 窓の見切れ相当（content が available を大きく超える）。
    stubLayout(554, 320);
    savePinned([makePinned({ text: "とても長いコメント" })]);
    const { container } = render(<PinnedOverlayApp />);

    const root = fitTarget(container);
    const scale = Number(/scale\(([\d.]+)\)/.exec(root.style.transform)?.[1]);
    expect(scale).toBeGreaterThan(0);
    expect(scale).toBeLessThan(1);
    expect(root.style.transformOrigin).toBe("top left");
    // width/height の補正が無いと `ol` の測定値が変わらず、収まり判定が永久に動かない。
    expect(root.style.width).not.toBe("");
    expect(root.style.height).not.toBe("");
  });

  it("測れない環境（jsdom 素のまま）では縮めない", () => {
    // レイアウトを偽装しない＝scrollHeight/clientHeight とも 0。ここで縮めてしまうと、
    // このファイルの既存ケースが全部スケール付きになる（available<=0 の即 return を守る回帰テスト）。
    savePinned([makePinned()]);
    const { container } = render(<PinnedOverlayApp />);
    expect(fitTarget(container).style.transform).toBe("");
  });

  it("固定 0 件ならラッパごと描かない（完全透明を維持する）", () => {
    stubLayout(554, 320);
    const { container } = render(<PinnedOverlayApp />);
    // クリップ用ラッパを 0 件でも描いてしまうと、透明な箱が残って既存の「何も描かない」仕様が崩れる。
    expect(container.firstChild).toBeNull();
  });

  it("窓のリサイズで測り直す（縦に縮められたら縮小が発動する）", async () => {
    stubLayout(200, 560);
    savePinned([makePinned()]);
    const { container } = render(<PinnedOverlayApp />);
    expect(fitTarget(container).style.transform).toBe("");

    // 窓を縦に縮めた状態を作ってから resize を撃つ。
    stubLayout(554, 200);
    await act(async () => {
      window.dispatchEvent(new Event("resize"));
      // rAF コアレスぶんを 1 フレーム進める。
      await new Promise((resolve) => setTimeout(resolve, 32));
    });

    expect(fitTarget(container).style.transform).toMatch(/^scale\(/);
  });
});

/**
 * 060a: 固定コメント窓における**セレクタ契約の出方**の仕様テスト。
 *
 * 仕様（docs/tasks/060a-overlay-selector-contract.md の「実装で判明した前提と訂正」2 ／
 * docs/progress.md 060a 節が正）:
 * - `renderOverlayItem` は `CommentList variant="overlay"` として**この窓とも共有**なので、
 *   安定クラス（`sd-*`）と data 属性は**この窓の DOM にも出る**。注入経路が無い限り無害で、
 *   将来 046d のように広げるときに DOM 側が用意済みになる、というのが採用理由。
 * - ⚠⚠ **窓ルートの `sd-overlay` だけは付けない。** 理由は 2 つ:
 *   ①060d の「CSS の注入先は `comment-overlay` のみ」を**構造で**表す（窓の区別がこのクラスの有無）
 *   ②046c の `applyFitScale` がこの窓の `.root` の `transform`/`width`/`height` を**排他所有**しており、
 *     そこをユーザー CSS に触らせる的を作ると縮小フィットが壊れる。
 *
 * ⚠ ガード (10-d) は `PinnedOverlayApp.tsx` の**ソース文字列**に `sd-overlay` が無いことしか見ない。
 * 「実際に DOM へ出る／出ない」はここが唯一の担保（(10) 冒頭が定めた役割分担のとおり）。
 * 固定窓へ広げるときは**このテストとガード (10-d) を必ず一緒に**更新すること。
 */
describe("PinnedOverlayApp 060a セレクタ契約の出方", () => {
  it("安定クラスと data 属性は固定窓の DOM にも出る（共有コンポーネント経由）", () => {
    savePinned([makePinned({ text: "固定した本文" })]);
    const { container } = render(<PinnedOverlayApp />);

    const item = container.querySelector<HTMLElement>(".sd-comment");
    expect(item).toBeTruthy();
    expect(item?.dataset.sdSource).toBe("twitch");
    expect(item?.dataset.sdEvent).toBe("chat");
    expect(container.querySelector(".sd-comment-name")?.textContent).toBe("Alice");
    expect(container.querySelector(".sd-comment-text")?.textContent).toBe("固定した本文");
    expect(container.querySelector(".sd-comment-icon")).toBeTruthy();
    expect(container.querySelector(".sd-comment-body")).toBeTruthy();
    // chat には data-sd-tone を付けない（comment-overlay 窓と同じ判断）。
    expect(item?.dataset.sdTone).toBeUndefined();
  });

  it("⚠ 窓ルートに sd-overlay は付かない（060d の注入先は comment-overlay のみ）", () => {
    savePinned([makePinned()]);
    const { container } = render(<PinnedOverlayApp />);
    expect(container.querySelector(".sd-overlay")).toBeNull();
    // 046c が transform を書き込む .root 自身にも付いていないこと（排他所有を守る）。
    expect((container.firstChild as HTMLElement).className).not.toContain("sd-overlay");
  });

  it("課金の固定コメントでも契約が出る（sd-comment-tip と data-sd-tone）", () => {
    savePinned([
      makePinned({
        eventType: "superchat",
        text: "応援してます",
        monetaryAmount: "10,000 JPY",
        monetary: { amount: 10000, currency: "JPY" },
      }),
    ]);
    const { container } = render(<PinnedOverlayApp />);
    const item = container.querySelector<HTMLElement>(".sd-comment");
    expect(item?.className).toContain("sd-comment-tip");
    expect(item?.dataset.sdTone).toBe("t6");
    expect(container.querySelector(".sd-comment-amount")?.textContent).toBe("10,000 JPY");
  });
});
