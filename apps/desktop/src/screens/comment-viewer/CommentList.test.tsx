import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { CommentViewDto } from "../../features/comment-viewer/types";
import type { RecordResult } from "../../features/viewer-memory/types";
import { CommentList } from "./CommentList";

/**
 * 038b フォローアップ: 流れるコメントをクリック→視聴者詳細を開くための onSelect の仕様テスト。
 * 仕様（こうあるべき）:
 * - onSelect 指定時のみコメント行がクリック可能（押されたコメントを渡す）。
 * - onSelect 未指定なら従来どおり表示専用（行は button にならない・クリックしても何も起きない＝回帰なし）。
 */

const makeComment = (over: Partial<CommentViewDto> = {}): CommentViewDto => ({
  id: "c1",
  source: "twitch",
  author: { id: "u1", name: "Alice" },
  text: "hello",
  publishedAt: "2026-07-26T10:00:00Z",
  eventType: "chat",
  ...over,
});

describe("CommentList onSelect", () => {
  it("onSelect 指定時、行クリックでそのコメントを渡して呼ぶ", () => {
    const onSelect = vi.fn();
    render(
      <CommentList
        comments={[
          makeComment({ id: "c1", text: "hello" }),
          makeComment({ id: "c2", text: "world", author: { id: "u2", name: "Bob" } }),
        ]}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByText("hello"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0].id).toBe("c1");
  });

  it("onSelect 未指定なら行は非インタラクティブ（button ロールを持たず、クリックしても何も起きない）", () => {
    render(<CommentList comments={[makeComment({ text: "hello" })]} />);
    // off モードなのでジャンプボタンも無く、コメント行も button にならない＝button ロールは 0。
    expect(screen.queryByRole("button")).toBeNull();
    // クリックしても例外にならない（表示専用のまま）。
    fireEvent.click(screen.getByText("hello"));
  });
});

/**
 * 038c: 初見／久しぶりバッジの描画仕様テスト（品質レビュー Q1・test-coverage 欠如の後追い）。
 * renderDefaultItem の分岐（該当 id に firstTime→「初見」/ longAbsence→「久しぶり」・初見優先で 1 つだけ・
 * 非該当は無装飾・overlay 変種には出さない）を、ユーザーに見えるバッジ文言で担保する（CSS クラス名は
 * CSS Modules 変換に依存するため文言で検証する）。判定ロジック自体は Rust 側 5 件で担保済み。
 */
const badgesOf = (entries: Record<string, RecordResult>) =>
  new Map<string, RecordResult>(Object.entries(entries));

describe("CommentList 038c バッジ（初見／久しぶり）", () => {
  it("firstTime の id には「初見」バッジが出る（久しぶりは出ない）", () => {
    render(
      <CommentList
        comments={[makeComment({ id: "c1", text: "hi" })]}
        badges={badgesOf({ c1: { firstTime: true, longAbsence: false } })}
      />,
    );
    expect(screen.getByText("初見")).toBeTruthy();
    expect(screen.queryByText("久しぶり")).toBeNull();
  });

  it("longAbsence の id には「久しぶり」バッジが出る（初見は出ない）", () => {
    render(
      <CommentList
        comments={[makeComment({ id: "c1", text: "hi" })]}
        badges={badgesOf({ c1: { firstTime: false, longAbsence: true } })}
      />,
    );
    expect(screen.getByText("久しぶり")).toBeTruthy();
    expect(screen.queryByText("初見")).toBeNull();
  });

  it("両方 true でも初見が優先で 1 つだけ出す（久しぶりは出さない）", () => {
    render(
      <CommentList
        comments={[makeComment({ id: "c1", text: "hi" })]}
        badges={badgesOf({ c1: { firstTime: true, longAbsence: true } })}
      />,
    );
    expect(screen.getByText("初見")).toBeTruthy();
    expect(screen.queryByText("久しぶり")).toBeNull();
  });

  it("非該当 id（別コメント）はバッジ無し（従来どおり無装飾）", () => {
    render(
      <CommentList
        comments={[makeComment({ id: "c1", text: "hi" })]}
        badges={badgesOf({ other: { firstTime: true, longAbsence: false } })}
      />,
    );
    expect(screen.queryByText("初見")).toBeNull();
    expect(screen.queryByText("久しぶり")).toBeNull();
  });

  it("overlay バリアントには判定バッジが出ない（badges を渡しても renderDefaultItem 限定）", () => {
    render(
      <CommentList
        comments={[makeComment({ id: "c1", text: "hi" })]}
        variant="overlay"
        badges={badgesOf({ c1: { firstTime: true, longAbsence: false } })}
      />,
    );
    expect(screen.queryByText("初見")).toBeNull();
  });
});

/**
 * 043c: オーバーレイの投げ銭カード（YouTube スパチャ風）の描画仕様テスト。
 * 仕様の正 = docs/tasks/043c-overlay-monetary-highlight.md 完了条件・docs/security.md（036a data URI ガード）。
 * あるべき挙動:
 * - chat（variant=overlay）は従来の吹き出しのまま＝本文が出て、金額バッジ・要約文言は出ない（非退行）。
 * - 金額を持つ投げ銭（superchat/bits/donation/jewels）は金額バッジ（monetaryAmount）を出す。
 * - 金額を持たない投げ銭（subscription/membership/gift）は composeEventMessage の要約文を主表示にする（金額バッジ無し）。
 * - 金額も本文も無い投げ銭でも壊れず、名前は出る（(eventMessage || text) が空ならボディ節を作らない条件分岐）。
 * - 036a のガード: avatar を背景画像に差すのは data URI のときだけ。外部 URL は踏まず頭文字にフォールバック（chat/カード両分岐で温存）。
 * ※ ティア段階配色（tier0..6）と種別単色は CSS クラス駆動で「見える文言」に差が出ないため、色分けは superchatTier の
 *   純関数テスト（viewerFormat.test.ts）＋実機 E2E で担保し、ここでは CSS クラス名に依存したアサーションはしない。
 */
const iconEl = (container: HTMLElement) =>
  container.querySelector<HTMLElement>('[aria-hidden="true"]');

describe("CommentList 043c オーバーレイ投げ銭カード", () => {
  it("chat は従来の吹き出しのまま（本文が出て、金額バッジ・要約文言は出ない＝非退行）", () => {
    render(
      <CommentList
        variant="overlay"
        comments={[makeComment({ eventType: "chat", text: "こんにちは" })]}
      />,
    );
    expect(screen.getByText("こんにちは")).toBeTruthy();
    expect(screen.queryByText(/JPY|bits/)).toBeNull();
    expect(screen.queryByText(/さんが/)).toBeNull();
  });

  it("スパチャ（実通貨）は金額バッジ（monetaryAmount）と本文を出す", () => {
    render(
      <CommentList
        variant="overlay"
        comments={[
          makeComment({
            eventType: "superchat",
            text: "応援してます",
            monetary: { amount: 1000, currency: "JPY" },
            monetaryAmount: "1,000 JPY",
          }),
        ]}
      />,
    );
    expect(screen.getByText("1,000 JPY")).toBeTruthy();
    expect(screen.getByText("応援してます")).toBeTruthy();
  });

  it("ビッツ（superchat＋currency=BITS）は枚数バッジを出す", () => {
    render(
      <CommentList
        variant="overlay"
        comments={[
          makeComment({
            eventType: "superchat",
            text: "cheer",
            monetary: { amount: 100, currency: "BITS" },
            monetaryAmount: "100 bits",
          }),
        ]}
      />,
    );
    expect(screen.getByText("100 bits")).toBeTruthy();
  });

  it("サブスク（金額なし種別）は要約文言を主表示にする（金額バッジは出ない）", () => {
    render(
      <CommentList
        variant="overlay"
        comments={[
          makeComment({
            eventType: "subscription",
            text: "",
            monthCount: 3,
            tier: 1,
          }),
        ]}
      />,
    );
    expect(
      screen.getByText("Aliceさんがサブスクを3ヶ月継続しました（Tier1）"),
    ).toBeTruthy();
    expect(screen.queryByText(/JPY|bits/)).toBeNull();
  });

  it("ギフト（金額なし種別）はサブギフトの要約文言を出す", () => {
    render(
      <CommentList
        variant="overlay"
        comments={[makeComment({ eventType: "gift", text: "", giftCount: 5 })]}
      />,
    );
    expect(screen.getByText(/サブギフトを5件贈りました/)).toBeTruthy();
  });

  it("ドネーション（実金銭）は金額バッジを出す", () => {
    render(
      <CommentList
        variant="overlay"
        comments={[
          makeComment({
            eventType: "donation",
            text: "",
            monetary: { amount: 20, currency: "USD" },
            monetaryAmount: "20 USD",
          }),
        ]}
      />,
    );
    expect(screen.getByText("20 USD")).toBeTruthy();
  });

  it("金額も本文も無い投げ銭でも壊れず名前は出る（空ボディを作らない）", () => {
    render(
      <CommentList
        variant="overlay"
        comments={[makeComment({ eventType: "superchat", text: "" })]}
      />,
    );
    // monetaryAmount / monetary / text がいずれも無い superchat → 名前だけ出て例外にならない。
    expect(screen.getByText("Alice")).toBeTruthy();
    expect(screen.queryByText(/JPY|bits/)).toBeNull();
  });

  it("036a: カード分岐で avatar が data URI のときだけ背景画像に差す", () => {
    const { container } = render(
      <CommentList
        variant="overlay"
        comments={[
          makeComment({
            eventType: "superchat",
            monetaryAmount: "500 JPY",
            author: {
              id: "u1",
              name: "Alice",
              avatar: "data:image/png;base64,AAAA",
            },
          }),
        ]}
      />,
    );
    expect(iconEl(container)?.style.backgroundImage).toContain(
      "data:image/png;base64,AAAA",
    );
  });

  it("036a: カード分岐で avatar が外部 URL なら踏まず頭文字にフォールバック", () => {
    const { container } = render(
      <CommentList
        variant="overlay"
        comments={[
          makeComment({
            eventType: "superchat",
            monetaryAmount: "500 JPY",
            author: {
              id: "u1",
              name: "Alice",
              avatar: "https://evil.example/x.png",
            },
          }),
        ]}
      />,
    );
    expect(iconEl(container)?.style.backgroundImage).toBe("");
    expect(screen.getByText("A")).toBeTruthy(); // 頭文字フォールバック
    expect(container.innerHTML).not.toContain("evil.example"); // 外部 URL を DOM に出さない
  });

  it("036a: chat 分岐でも外部 URL を踏まずフォールバックする（ガードは両分岐で温存）", () => {
    const { container } = render(
      <CommentList
        variant="overlay"
        comments={[
          makeComment({
            eventType: "chat",
            author: {
              id: "u1",
              name: "Bob",
              avatar: "https://evil.example/x.png",
            },
          }),
        ]}
      />,
    );
    expect(iconEl(container)?.style.backgroundImage).toBe("");
    expect(screen.getByText("B")).toBeTruthy();
    expect(container.innerHTML).not.toContain("evil.example");
  });

  // 043c エッジケース: 長文（YouTube 赤スパの本文上限 290 字を参考）が切り捨てられず全文描画されること。
  //   見た目の折返し/伸長/スクロールは jsdom では測れないため実機目視（dev-mock の長文サンプル）で確認し、
  //   ここでは「全文が DOM に出る＝truncate ロジックが無い」ことだけを保証する（回帰ガード）。
  it("スパチャの長文本文（290字）が全文カードボディに出る（切り捨てなし）", () => {
    const long = "あ".repeat(290);
    render(
      <CommentList
        variant="overlay"
        comments={[
          makeComment({
            eventType: "superchat",
            text: long,
            monetary: { amount: 20000, currency: "JPY" },
            monetaryAmount: "20,000 JPY",
          }),
        ]}
      />,
    );
    expect(screen.getByText(long)).toBeTruthy();
    expect(screen.getByText("20,000 JPY")).toBeTruthy(); // 金額バッジも併存する
  });

  it("通常チャットの長文本文（290字）が全文 overlay 吹き出しに出る（切り捨てなし・非退行）", () => {
    const long = "あ".repeat(290);
    render(
      <CommentList
        variant="overlay"
        comments={[makeComment({ eventType: "chat", text: long })]}
      />,
    );
    expect(screen.getByText(long)).toBeTruthy();
  });
});

/**
 * 043d: YouTube のギフトメンシプ（贈与側 MEMBERSHIP_GIFTING_EVENT → `gift`）と Jewels（GIFT_EVENT → `jewels`）が
 * コメビュ本体／オーバーレイの**両方**で正しく描画されることの仕様テスト。
 *
 * 仕様（こうあるべき）:
 * - gift の呼び名は**配信元で異なる**。YouTube は「メンバーシップギフト」、Twitch は従来どおり「サブギフト」。
 * - 043d は `composeEventMessage` に `source` を足しただけで**呼び出し側の引数を変えていない**。これは
 *   「CommentList が CommentViewDto を丸ごと渡している（＝source を含む）」という前提に**依存**している。
 *   その配線が実際に効いていることを本体（renderDefaultItem）と overlay の両分岐で固定する
 *   （viewerFormat.test.ts は純関数のみを見ており、この配線を検証できない）。
 * - YouTube 側は `tier` を持たないので「（TierN）」は付かない。
 * - jewels は**金額を持つ種別**なので、要約文言ではなく「種別ラベル＋金額バッジ＋本文」で見せる。
 *   currency="JEWELS" は superchat/bits に化けてはいけない（displayEventType の振り分け対象外）。
 */
describe("CommentList 043d YouTube ギフトメンシプ／Jewels", () => {
  it("本体: YouTube の gift は「メンバーシップギフト」の要約文言になる（source が配線されている証拠）", () => {
    render(
      <CommentList
        comments={[
          makeComment({
            source: "youtube",
            eventType: "gift",
            text: "",
            giftCount: 5,
          }),
        ]}
      />,
    );
    expect(screen.getByText(/メンバーシップギフトを5件贈りました/)).toBeTruthy();
    // Twitch 語彙へフォールバックしていないこと（source 渡し忘れの検知）。
    expect(screen.queryByText(/サブギフト/)).toBeNull();
    // 課金イベントの種別ラベルが出る。
    expect(screen.getByText("ギフト")).toBeTruthy();
  });

  it("overlay: YouTube の gift も「メンバーシップギフト」（本体と同じ語彙）", () => {
    render(
      <CommentList
        variant="overlay"
        comments={[
          makeComment({
            source: "youtube",
            eventType: "gift",
            text: "",
            giftCount: 3,
          }),
        ]}
      />,
    );
    expect(screen.getByText(/メンバーシップギフトを3件贈りました/)).toBeTruthy();
    expect(screen.queryByText(/サブギフト/)).toBeNull();
  });

  it("本体: Twitch の gift は「サブギフト」のまま（043d による非退行）", () => {
    render(
      <CommentList
        comments={[
          makeComment({
            source: "twitch",
            eventType: "gift",
            text: "",
            giftCount: 5,
            tier: 1,
          }),
        ]}
      />,
    );
    expect(screen.getByText(/サブギフトを5件贈りました（Tier1）/)).toBeTruthy();
    expect(screen.queryByText(/メンバーシップギフト/)).toBeNull();
  });

  it("本体: YouTube の gift に Tier 表記は付かない（YouTube は tier を持たない）", () => {
    render(
      <CommentList
        comments={[
          makeComment({
            source: "youtube",
            eventType: "gift",
            text: "",
            giftCount: 1,
          }),
        ]}
      />,
    );
    expect(screen.queryByText(/Tier/)).toBeNull();
  });

  it("本体: 件数が無い YouTube gift は件数なしの文へ無害に劣化する", () => {
    render(
      <CommentList
        comments={[makeComment({ source: "youtube", eventType: "gift", text: "" })]}
      />,
    );
    expect(screen.getByText(/メンバーシップギフトを贈りました/)).toBeTruthy();
    // 「0件贈りました」を作らない（mapper が 0 を undefined へ落とす設計の表示側担保）。
    expect(screen.queryByText(/0件/)).toBeNull();
  });

  it("本体: Jewels は「ジュエル」ラベル＋金額バッジで出す（要約文言は作らない）", () => {
    render(
      <CommentList
        comments={[
          makeComment({
            source: "youtube",
            eventType: "jewels",
            text: "バラを贈りました",
            monetary: { amount: 30, currency: "JEWELS" },
            monetaryAmount: "30 JEWELS",
          }),
        ]}
      />,
    );
    expect(screen.getByText("ジュエル")).toBeTruthy();
    expect(screen.getByText("30 JEWELS")).toBeTruthy();
    expect(screen.getByText("バラを贈りました")).toBeTruthy();
    // 金額を持つ種別は composeEventMessage が null＝「〇〇さんが…しました」の要約文を作らない。
    // 本文自体が「…贈りました」で終わり得るため、要約文に必ず含まれる「<名前>さんが」で判定する。
    expect(screen.queryByText(/Aliceさんが/)).toBeNull();
    // currency=JEWELS が bits/スパチャのラベルへ化けないこと。
    expect(screen.queryByText("ビッツ")).toBeNull();
    expect(screen.queryByText("スーパーチャット")).toBeNull();
  });

  it("overlay: Jewels も金額バッジを出す（本体と同じ）", () => {
    render(
      <CommentList
        variant="overlay"
        comments={[
          makeComment({
            source: "youtube",
            eventType: "jewels",
            text: "",
            monetary: { amount: 30, currency: "JEWELS" },
            monetaryAmount: "30 JEWELS",
          }),
        ]}
      />,
    );
    expect(screen.getByText("30 JEWELS")).toBeTruthy();
    expect(screen.queryByText("ビッツ")).toBeNull();
  });
});

/**
 * 043e: Jewels の combo 回数（comboCount）の表示仕様テスト。
 *
 * 仕様（こうあるべき）:
 * - comboCount があるときだけ本体（default 変種）に「×N」を出す＝フェーズ2 で「jewels_amount が単価か累計か」を
 *   実機で判別するための観測手段。単発ギフトは mapper が undefined へ落とすので何も出ない。
 * - **オーバーレイ（配信画面）には出さない**＝視聴者に見せる情報を増やさない。
 */
describe("CommentList 043e combo 回数の表示", () => {
  const combo = (over: Partial<CommentViewDto> = {}) =>
    makeComment({
      source: "youtube",
      eventType: "jewels",
      text: "",
      monetary: { amount: 30, currency: "JEWELS" },
      monetaryAmount: "30 JEWELS",
      ...over,
    });

  it("comboCount があると金額バッジの隣に「×N」が出る", () => {
    render(<CommentList comments={[combo({ comboCount: 3 })]} />);
    expect(screen.getByText("30 JEWELS")).toBeTruthy();
    expect(screen.getByText("×3")).toBeTruthy();
  });

  it("comboCount が無ければ何も出ない（単発ギフトに「×0」等を作らない）", () => {
    render(<CommentList comments={[combo()]} />);
    expect(screen.getByText("30 JEWELS")).toBeTruthy();
    expect(screen.queryByText(/^×/)).toBeNull();
  });

  it("overlay（配信画面）には combo 回数を出さない", () => {
    render(<CommentList variant="overlay" comments={[combo({ comboCount: 3 })]} />);
    expect(screen.getByText("30 JEWELS")).toBeTruthy();
    expect(screen.queryByText("×3")).toBeNull();
  });
});

/**
 * 046a: 右クリック→固定/固定解除メニューの仕様テスト。
 *
 * 仕様（こうあるべき・docs/tasks/046a-viewer-pin-comment.md）:
 * - `onPin` 指定時のみ、既定バリアントの行を右クリックするとメニューが開き、押されたコメントを `onPin` に渡す。
 * - 文言は `pinnedIds` で出し分ける（未固定＝「上部に固定」／固定済み＝「固定解除」）。
 * - `onPin` 未指定なら右クリックしても何も起きない（ネイティブメニューを潰さない＝回帰なし）。
 * - overlay バリアントには効かない（OBS 表示は非インタラクティブのまま）。
 * - Esc / 外側クリックで閉じる。メニューは開いている間だけ DOM に出す。
 * - 左クリック導線（`onSelect` →視聴者詳細）と干渉しない。
 */
describe("CommentList 046a 右クリック固定メニュー", () => {
  it("onPin 指定時、行の右クリックで「上部に固定」メニューが開き、ネイティブメニューは抑止される", () => {
    render(
      <CommentList comments={[makeComment({ text: "hello" })]} onPin={vi.fn()} />,
    );
    expect(screen.queryByRole("menu")).toBeNull(); // 閉じている間は DOM に出さない
    // fireEvent は dispatchEvent の戻り値をそのまま返す＝preventDefault されていれば false。
    // これを見ることで「この行だけネイティブメニューを抑止する」という抑止範囲の仕様を固定する
    //（セキュリティレビュー S-3: これが無いと preventDefault を消すミューテーションが素通りする）。
    const notCancelled = fireEvent.contextMenu(screen.getByText("hello"), {
      clientX: 20,
      clientY: 30,
    });
    expect(notCancelled).toBe(false);
    expect(screen.getByRole("menu")).toBeTruthy();
    expect(screen.getByRole("menuitem").textContent).toBe("上部に固定");
  });

  it("メニュー項目を押すと、右クリックしたコメントを渡して onPin を呼びメニューが閉じる", () => {
    const onPin = vi.fn();
    render(
      <CommentList
        comments={[
          makeComment({ id: "c1", text: "hello" }),
          makeComment({ id: "c2", text: "world", author: { id: "u2", name: "Bob" } }),
        ]}
        onPin={onPin}
      />,
    );
    fireEvent.contextMenu(screen.getByText("world"));
    fireEvent.click(screen.getByRole("menuitem"));
    expect(onPin).toHaveBeenCalledTimes(1);
    expect(onPin.mock.calls[0][0].id).toBe("c2");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("pinnedIds に含まれる id は「固定解除」文言になる（トグルの出し分け）", () => {
    render(
      <CommentList
        comments={[makeComment({ id: "c1", text: "hello" })]}
        onPin={vi.fn()}
        pinnedIds={new Set(["c1"])}
      />,
    );
    fireEvent.contextMenu(screen.getByText("hello"));
    expect(screen.getByRole("menuitem").textContent).toBe("固定解除");
  });

  it("onPin 未指定なら右クリックしてもメニューが出ず、ネイティブメニューも潰さない（回帰なし）", () => {
    render(<CommentList comments={[makeComment({ text: "hello" })]} />);
    // 抑止していない＝dispatchEvent が true を返す（OS 標準のコピー等をユーザーから奪わない）。
    expect(fireEvent.contextMenu(screen.getByText("hello"))).toBe(true);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("overlay バリアントには効かない（onPin を渡してもメニューが出ずネイティブメニューも潰さない）", () => {
    render(
      <CommentList
        variant="overlay"
        comments={[makeComment({ text: "hello" })]}
        onPin={vi.fn()}
      />,
    );
    expect(fireEvent.contextMenu(screen.getByText("hello"))).toBe(true);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("Esc で閉じる（onPin は呼ばない）", () => {
    const onPin = vi.fn();
    render(
      <CommentList comments={[makeComment({ text: "hello" })]} onPin={onPin} />,
    );
    fireEvent.contextMenu(screen.getByText("hello"));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(onPin).not.toHaveBeenCalled();
  });

  it("メニュー外の mousedown で閉じる（onPin は呼ばない）", () => {
    const onPin = vi.fn();
    render(
      <CommentList comments={[makeComment({ text: "hello" })]} onPin={onPin} />,
    );
    fireEvent.contextMenu(screen.getByText("hello"));
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(onPin).not.toHaveBeenCalled();
  });

  it("Esc で閉じたとき、フォーカスは開く直前の要素へ戻る（a11y・キーボード操作の継続性）", () => {
    // レビュー対応（Q-2）: 項目が unmount されるとフォーカスが <body> へ落ち、Shift+F10 → Esc した
    // キーボード利用者が一覧の先頭から Tab し直しになる。role="menu" を名乗る以上、閉じたら呼び出し元へ返す。
    render(
      <>
        <input data-testid="opener" />
        <CommentList
          comments={[makeComment({ text: "hello" })]}
          onPin={vi.fn()}
        />
      </>,
    );
    const opener = screen.getByTestId("opener");
    opener.focus();
    expect(document.activeElement).toBe(opener);

    fireEvent.contextMenu(screen.getByText("hello"));
    // 開いたら項目へフォーカスが移る。
    expect(document.activeElement).toBe(screen.getByRole("menuitem"));

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("外側クリックで閉じたときは、押した先からフォーカスを奪い返さない", () => {
    render(
      <>
        <input data-testid="opener" />
        <button data-testid="other">別のボタン</button>
        <CommentList
          comments={[makeComment({ text: "hello" })]}
          onPin={vi.fn()}
        />
      </>,
    );
    screen.getByTestId("opener").focus();
    fireEvent.contextMenu(screen.getByText("hello"));

    const other = screen.getByTestId("other");
    fireEvent.mouseDown(other);
    other.focus(); // 実ブラウザの mousedown 既定動作（押した要素へフォーカス）を模す
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(other);
  });

  it("右クリックは左クリック導線（onSelect＝視聴者詳細）を発火させない", () => {
    const onSelect = vi.fn();
    render(
      <CommentList
        comments={[makeComment({ text: "hello" })]}
        onSelect={onSelect}
        onPin={vi.fn()}
      />,
    );
    fireEvent.contextMenu(screen.getByText("hello"));
    expect(onSelect).not.toHaveBeenCalled();
    // 逆向きも確認: 左クリックは従来どおり onSelect のみ（メニューは開かない）。
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByText("hello"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
