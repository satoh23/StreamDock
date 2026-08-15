import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { CommentViewDto } from "../../features/comment-viewer/types";
import type { RecordResult } from "../../features/viewer-memory/types";
import { CommentList } from "./CommentList";
// 047b: ティア配色が実際に当たっているかを、CSS Modules のハッシュ名に依存せず検証するために引く。
import { TONE_CLASS } from "./monetaryTone";
/**
 * 060f: 意匠クラスの**同一性**で表明するために引く（部分文字列一致では不十分だったため）。
 * ⚠ 実測: 部分文字列で `expect(className).toContain("text")` と書くと、同じ要素に併記された
 * **安定クラス `sd-comment-text` に一致してしまい**、意匠クラス（`overlayStyles.text`）を
 * 落とす変異が**生存する**。CSS Modules は vitest 上で `_<key>_<hash>` を返すので、
 * ここから引いた文字列と `classList.contains()` で突き合わせればハッシュ名に依存せず正確に見られる。
 */
import overlayStyles from "./OverlayComment.module.css";

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

/**
 * 047b: 本体（default 変種）の課金コメント行を **YouTube スパチャ風のティア色カード**（ヘッダ帯＋ボディの
 * 2 段構造）へ変えた。043b の赤枠＋琥珀バッジ 1 行構造からマークアップが変わるため、
 * **既存の行の契約が壊れていないこと**をここで固定する。
 *
 * 仕様（こうあるべき）:
 * - 課金行でも `onSelect`（クリック→視聴者詳細）と `onPin`（右クリック→固定メニュー）は従来どおり動く。
 * - 初見/久しぶりの判定バッジは、カードのヘッダ帯の中に文言そのままで出る（器だけ差し替わる）。
 * - chat 行はカード化されず従来どおり（回帰なし）。
 */
describe("CommentList 047b 課金コメントのティアカード", () => {
  const superchat = (over: Partial<CommentViewDto> = {}) =>
    makeComment({
      id: "m1",
      eventType: "superchat",
      text: "応援してます",
      monetaryAmount: "1,000 JPY",
      monetary: { amount: 1000, currency: "JPY" },
      ...over,
    });

  it("課金行でも onSelect が従来どおり動く（カード化で行のクリック契約が壊れていない）", () => {
    const onSelect = vi.fn();
    render(<CommentList comments={[superchat()]} onSelect={onSelect} />);
    fireEvent.click(screen.getByText("応援してます"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0].id).toBe("m1");
  });

  it("課金行でも右クリックで固定メニューが開く（onPin の契約が壊れていない）", () => {
    const onPin = vi.fn();
    render(<CommentList comments={[superchat()]} onPin={onPin} />);
    fireEvent.contextMenu(screen.getByText("応援してます"));
    fireEvent.click(screen.getByText("上部に固定"));
    expect(onPin).toHaveBeenCalledTimes(1);
    expect(onPin.mock.calls[0][0].id).toBe("m1");
  });

  it("課金カードのヘッダにも初見バッジ・配信元・種別・金額が出る", () => {
    render(
      <CommentList
        comments={[superchat()]}
        badges={badgesOf({ m1: { firstTime: true, longAbsence: false } })}
      />,
    );
    expect(screen.getByText("初見")).toBeTruthy();
    expect(screen.getByText("Twitch")).toBeTruthy();
    expect(screen.getByText("スーパーチャット")).toBeTruthy();
    expect(screen.getByText("1,000 JPY")).toBeTruthy();
    expect(screen.getByText("Alice")).toBeTruthy();
  });

  it("金額も本文も無い課金行でも壊れず、ヘッダだけで成立する（空ボディを作らない）", () => {
    render(
      <CommentList
        comments={[
          superchat({
            text: "",
            monetaryAmount: undefined,
            monetary: undefined,
          }),
        ]}
      />,
    );
    expect(screen.getByText("Alice")).toBeTruthy();
    expect(screen.getByText("スーパーチャット")).toBeTruthy();
  });

  // 【重要】これが無いと「tone クラスを当てない」ミューテーションが全テストをすり抜ける（＝配色が丸ごと
  // 消えても気付けない）。CSS Modules のハッシュ名は TONE_CLASS 経由で引くのでハッシュに依存しない。
  // 金額でクラスが**変わる**ことまで見るので、「常に t0」のような潰れ方も落ちる。
  it("金額に応じてティア色クラスが変わる（¥100→t0 / ¥1,000→t3 / ¥10,000→t6）", () => {
    const row = (amount: number, text: string) =>
      superchat({
        id: `m${amount}`,
        text,
        monetaryAmount: `${amount} JPY`,
        monetary: { amount, currency: "JPY" },
      });
    render(
      <CommentList
        comments={[row(100, "ひゃく"), row(1000, "せん"), row(10000, "いちまん")]}
      />,
    );
    expect(screen.getByText("ひゃく").closest("li")?.className).toContain(
      TONE_CLASS.t0,
    );
    expect(screen.getByText("せん").closest("li")?.className).toContain(
      TONE_CLASS.t3,
    );
    expect(screen.getByText("いちまん").closest("li")?.className).toContain(
      TONE_CLASS.t6,
    );
  });

  it("ティア非対象の種別は種別ごとの単色クラスになる（ビッツ / サブスク）", () => {
    render(
      <CommentList
        comments={[
          superchat({
            id: "b1",
            text: "びっつ",
            monetaryAmount: "100 bits",
            monetary: { amount: 100, currency: "BITS" },
          }),
          makeComment({ id: "s1", eventType: "subscription", text: "さぶすく" }),
        ]}
      />,
    );
    expect(screen.getByText("びっつ").closest("li")?.className).toContain(
      TONE_CLASS.bits,
    );
    expect(screen.getByText("さぶすく").closest("li")?.className).toContain(
      TONE_CLASS.subscription,
    );
  });

  it("chat 行はカード化されない（従来どおり本文と名前だけ・回帰なし）", () => {
    render(<CommentList comments={[makeComment({ text: "ふつうのコメント" })]} />);
    expect(screen.getByText("ふつうのコメント")).toBeTruthy();
    expect(screen.getByText("Alice")).toBeTruthy();
    // 種別ラベルは chat には出ない（eventLabel が空文字へ劣化する）。
    expect(screen.queryByText("スーパーチャット")).toBeNull();
  });
});

/**
 * 051: **その配信で初めてしたコメント**に「初コメ」バッジ＋初見と同じ枠色を付ける仕様テスト。
 *
 * 仕様（こうあるべき）:
 * - `firstOfStreamIds` に載っている id の行に **「初コメ」バッジ**が出て、**初見と同じ枠色クラス**が付く。
 * - 判定は **1 行 1 信号**。優先順は **初見 > 久しぶり > 初コメ**（情報量の多い方を残す）。
 *   ⚠ 038c の判定（初見/久しぶり）は論理的に「その配信の初コメント」に含まれる（`record_comment` は
 *   **その視聴者の来訪 1 件目**にしか肯定を返さない）ので、排他にしないと ①久しぶり（青枠）と初コメ（緑枠）が
 *   同じ行に同時に付いて勝敗が CSS のソース順で決まる ②「初見」と「初コメ」が二重に出る、の 2 つが起きる。
 * - **課金カード × 初コメはバッジのみ**（枠に色を付けない）。ヘッダ帯の色が主信号なので枠まで意味を持たせない
 *   ＝初見/久しぶりが既に受けている扱いと同じ（047b）。
 * - `firstOfStreamIds` 未指定・非該当は従来どおり無装飾。
 *
 * ⚠ **このテストで守れるのは「誰にどのクラス/バッジが付くか」まで**。CSS モジュールは vitest 上で
 * **存在しないキーでも文字列を返す**（実測: `styles.nonExistentKey` → `"_nonExistentKey_<hash>"`）ため、
 * 「CSS 側にルールが無い／クラス名を打ち間違えた／色が初見と違う」状態はここでは緑のまま通る。
 * その層は `scripts/check-css-guards.mjs` のガード (5) が押さえている（`pnpm test` から実行される）。
 */
describe("CommentList 051 初コメバッジと枠色", () => {
  /** 行に付いたクラス名（CSS モジュールのローカル名は `_<key>_<hash>`）。 */
  const rowClass = (text: string): string =>
    screen.getByText(text).closest("li")?.className ?? "";

  it("その配信で初めてしたコメントに「初コメ」バッジと初見と同じ枠色が付く", () => {
    render(
      <CommentList
        comments={[
          makeComment({ id: "c1", text: "はじめまして" }),
          makeComment({ id: "c2", text: "二回目です" }),
        ]}
        firstOfStreamIds={new Set(["c1"])}
      />,
    );
    expect(screen.getByText("初コメ")).toBeTruthy();
    expect(rowClass("はじめまして")).toContain("itemFirstComment");
    // 同じ視聴者の 2 件目は無装飾（「今日はじめて喋った人」という意味が薄まらない）。
    expect(rowClass("二回目です")).not.toContain("itemFirstComment");
  });

  it("初見の行は「初見」だけ出す（初コメと二重に出さない・枠も初見のまま）", () => {
    const badges = new Map<string, RecordResult>([
      ["c1", { firstTime: true, longAbsence: false }],
    ]);
    render(
      <CommentList
        comments={[makeComment({ id: "c1", text: "しょけん" })]}
        badges={badges}
        firstOfStreamIds={new Set(["c1"])}
      />,
    );
    expect(screen.getByText("初見")).toBeTruthy();
    expect(screen.queryByText("初コメ")).toBeNull();
    const cls = rowClass("しょけん");
    expect(cls).toContain("itemFirstTime");
    expect(cls).not.toContain("itemFirstComment");
  });

  it("久しぶりの行は「久しぶり」だけ出し、枠は青のまま（緑に上書きされない）", () => {
    const badges = new Map<string, RecordResult>([
      ["c1", { firstTime: false, longAbsence: true }],
    ]);
    render(
      <CommentList
        comments={[makeComment({ id: "c1", text: "ひさしぶり" })]}
        badges={badges}
        firstOfStreamIds={new Set(["c1"])}
      />,
    );
    expect(screen.getByText("久しぶり")).toBeTruthy();
    expect(screen.queryByText("初コメ")).toBeNull();
    const cls = rowClass("ひさしぶり");
    expect(cls).toContain("itemLongAbsence");
    // 枠色が 2 つ付くと CSS のソース順で勝敗が決まる＝意図が読めない状態になる。
    expect(cls).not.toContain("itemFirstComment");
  });

  it("課金カード × 初コメはバッジだけ出す（枠色はカード側の抑止に任せる）", () => {
    render(
      <CommentList
        comments={[
          makeComment({
            id: "s1",
            text: "おうえん",
            eventType: "superchat",
            monetaryAmount: "1,000 JPY",
            monetary: { amount: 1000, currency: "JPY" },
          }),
        ]}
        firstOfStreamIds={new Set(["s1"])}
      />,
    );
    // バッジはヘッダ帯の中に出る（情報は落ちない）。
    expect(screen.getByText("初コメ")).toBeTruthy();
    // クラス自体は付くが、色は `.item.itemTipCard.itemFirstComment` が打ち消す（CSS guard (5-b) の担当）。
    expect(rowClass("おうえん")).toContain("itemTipCard");
  });

  it("firstOfStreamIds 未指定・判定なしなら従来どおり無装飾", () => {
    render(<CommentList comments={[makeComment({ id: "c1", text: "ふつう" })]} />);
    expect(screen.queryByText("初コメ")).toBeNull();
    expect(rowClass("ふつう")).not.toContain("itemFirstComment");
  });
});

/**
 * 060a: オーバーレイの**セレクタ契約**（ユーザーのカスタム CSS が狙う的）の仕様テスト。
 * 仕様の正 = docs/tasks/060a-overlay-selector-contract.md。
 *
 * あるべき挙動:
 * - `variant="overlay"` の DOM に、ビルドでハッシュ化されない**素の安定クラス**（`sd-*`）が付く。
 * - **chat と課金で「同じ役割」には同じ安定クラス**（`text` と `cardText` はどちらも `sd-comment-text`）。
 * - `data-sd-source` / `data-sd-event` が全コメントに付く。`data-sd-event` は `displayEventType()` と
 *   同じ判定なので **ビッツは "bits"** になる（表示分岐と一致しているのが CSS 契約として正しい）。
 * - `data-sd-tone` は**課金分岐にだけ**付く（`monetaryTone()` は chat を "t0" へ無害劣化させるため、
 *   chat に付けると `[data-sd-tone="t0"]` が全 chat に当たってしまう）。
 * - **`variant="default"`（コメビュ本体）には 1 つも付かない**（対象はオーバーレイのみ）。
 *
 * ⚠ **このテストで守れるのは「DOM に付くこと」まで。** 安定クラスは CSS モジュールではなく素の文字列なので
 * `querySelector(".sd-comment")` が実効的に効く（他の describe と違ってハッシュ問題は無い）。一方で
 * 「変換表の右辺が実在すること」「CSS 変数のフォールバックが現行意匠のままであること」は jsdom で
 * 解決できないので `scripts/check-css-guards.mjs` のガード (10) が押さえている（`pnpm test` から実行）。
 *
 * 再修正トリガー: 安定クラス・data 属性を増減するときは、本テスト・ガード (10) の STABLE_CLASSES・
 * `cssCompat.ts` の変換表・060a のタスクファイルを**必ず 4 点セット**で更新すること。
 */
describe("CommentList 060a オーバーレイのセレクタ契約", () => {
  const sd = (container: HTMLElement, cls: string) =>
    container.querySelector<HTMLElement>(`.${cls}`);

  it("chat には chat 側の安定クラスが付き、課金専用のクラスは付かない", () => {
    const { container } = render(
      <CommentList
        variant="overlay"
        showSource
        comments={[makeComment({ eventType: "chat", text: "こんにちは" })]}
      />,
    );
    expect(sd(container, "sd-comment")).toBeTruthy();
    expect(sd(container, "sd-comment-name")?.textContent).toBe("Alice");
    expect(sd(container, "sd-comment-source")?.textContent).toBe("Twitch");
    expect(sd(container, "sd-comment-icon")).toBeTruthy();
    expect(sd(container, "sd-comment-body")).toBeTruthy();
    expect(sd(container, "sd-comment-text")?.textContent).toBe("こんにちは");
    // 課金専用（chat には出ない）。
    expect(sd(container, "sd-comment-tip")).toBeNull();
    expect(sd(container, "sd-comment-amount")).toBeNull();
    expect(sd(container, "sd-comment-event")).toBeNull();
  });

  /**
   * ⚠⚠⚠ **060f 追修正④(2026-08-08・本人決定) の中核テスト。**
   *
   * **課金カード（投げ銭カード）にはユーザー CSS の的を 1 つも置かない**——安定クラスも `data-sd-*` も。
   *
   * 060f は 3 巡ぶん「chat 専用クラスへ向ける／目印クラスで限定する」方向で解こうとして失敗した。
   * 理由は、OBS 用に配られている純正チャットのテーマが**課金カードを名指しで消しにくる**から:
   *   `yt-live-chat-paid-message-renderer, yt-live-chat-paid-sticker-renderer { display:none !important }`
   *   `.yt-live-chat-membership-item-renderer { display:none !important }`
   * 純正チャットではスパチャが**ティッカーにも出る**ので「二重に出るからインライン側を消す」意図だが、
   * StreamDock にティッカーは無いので**意図が成立せず、課金カードが丸ごと消える**（2026-08-08 実機）。
   * ＝ **目印を足す方向では原理的に防げない**ので、的そのものを外した。
   *
   * ⚠ 意匠は CSS モジュールのハッシュ名（`.card` / `.tierN`）で当てる——あれはユーザーから
   * 名指しできないので的にならない（下の「併記」テストが意匠クラスの実在を固定している）。
   * ⚠ 対になる検査＝ 静的ガード **(10-o)**（字面）と `CommentList.selectorContract.test.tsx`
   * （変換表・リセットのどの当て先も課金カードに当たらないこと）。**3 つとも消さないこと。**
   */
  it("⚠⚠⚠ 課金カードには安定クラスも data-sd-* も 1 つも付かない（060f 追修正④）", () => {
    const { container } = render(
      <CommentList
        variant="overlay"
        showSource
        comments={[
          makeComment({ id: "c1", eventType: "chat", text: "hi" }),
          makeComment({
            id: "s1",
            eventType: "superchat",
            text: "sc",
            monetaryAmount: "1,000 JPY",
            monetary: { amount: 1000, currency: "JPY" },
          }),
          makeComment({ id: "sub1", eventType: "subscription", text: "" }),
        ]}
      />,
    );
    const items = [...container.querySelectorAll<HTMLElement>("ol > li")];
    expect(items).toHaveLength(3);
    const [chat, ...tips] = items;

    // chat 側は従来どおり的を持つ。
    expect(chat.classList.contains("sd-comment")).toBe(true);
    expect(chat.classList.contains("sd-comment-chat")).toBe(true);

    // ⚠ 課金カードは `<li>` も配下も、`sd-comment` 接頭辞のクラスと `data-sd-*` を 1 つも持たない。
    for (const tip of tips) {
      for (const el of [tip, ...tip.querySelectorAll<HTMLElement>("*")]) {
        const stable = [...el.classList].filter((c) =>
          c.startsWith("sd-comment"),
        );
        expect({ el: el.tagName, stable }).toEqual({
          el: el.tagName,
          stable: [],
        });
        expect(Object.keys(el.dataset)).toEqual([]);
      }
    }
    // 一覧全体でも、安定クラスを持つのは chat の 1 件だけ。
    expect(container.querySelectorAll(".sd-comment").length).toBe(1);
    expect(container.querySelectorAll(".sd-comment-chat").length).toBe(1);
    // 廃止した課金側の語彙が復活していないこと。
    expect(container.querySelectorAll(".sd-comment-tip").length).toBe(0);
    expect(container.querySelectorAll(".sd-comment-in-tip").length).toBe(0);
  });

  /**
   * 060f ②: ⚠⚠ **chat の吹き出しは `<p>` 1 枚**（`li > div.row > p.sd-comment-body.sd-comment-text`）。
   *
   * YouTube 側に `.sd-comment-body` に相当する要素が無く、取り込んだ CSS は `#message`
   * （→ `.sd-comment-text`）に吹き出しと `:before` / `:after` のしっぽを描く。器が 2 段あると
   * **StreamDock の吹き出しの内側にもう 1 個吹き出しが描かれる**（「論外」の 2 つ目）。
   * ＝ **`sd-comment-body` と `sd-comment-text` が同一要素であること**が、二重を防ぐ条件そのもの。
   * ⚠ `sd-comment-body` を消す（`sd-comment-text` だけにする）変異もここで落ちる——契約
   * 「chat と課金で同じ役割には同じ安定クラス」を保つため、消さずに `<p>` へ残す判断である。
   */
  it("chat の吹き出しは p 1 枚で、sd-comment-body と sd-comment-text が同一要素", () => {
    const { container } = render(
      <CommentList
        variant="overlay"
        comments={[makeComment({ eventType: "chat", text: "こんにちは" })]}
      />,
    );
    const body = sd(container, "sd-comment-body");
    const text = sd(container, "sd-comment-text");
    expect(body).not.toBeNull();
    // ⚠ 同一性（`toBe`）で見る。別要素なら中間の器が残っている＝吹き出しが二重になる。
    expect(body).toBe(text);
    expect(body?.tagName).toBe("P");
    // 親は `.sd-comment-row`（アイコン＋吹き出しの行）で、間に器が挟まっていない。
    expect(body?.parentElement?.classList.contains("sd-comment-row")).toBe(true);
  });

  /**
   * 060f: ⚠ **課金カードの DOM 構造は触っていない**（`cardBody` はヘッダ帯＋ボディの 2 段構造に必要）。
   * ⚠ 060f 追修正④で課金カードから安定クラスが消えたので、**表明は CSS モジュールのクラスで行う**
   * （安定クラスで書くと「的が残っている」ことになってしまう＝ (10-o) と矛盾する）。
   */
  it("課金カードは従来どおりヘッダ帯＋ボディの 2 段（意匠クラスで表明）", () => {
    const { container } = render(
      <CommentList
        variant="overlay"
        comments={[
          makeComment({
            eventType: "superchat",
            text: "応援してます",
            monetaryAmount: "1,000 JPY",
            monetary: { amount: 1000, currency: "JPY" },
          }),
        ]}
      />,
    );
    const header = container.querySelector<HTMLElement>(
      `.${overlayStyles.cardHeader}`,
    );
    const body = container.querySelector<HTMLElement>(
      `.${overlayStyles.cardBody}`,
    );
    const text = container.querySelector<HTMLElement>(
      `.${overlayStyles.cardText}`,
    );
    expect(header?.tagName).toBe("DIV");
    expect(body?.tagName).toBe("DIV");
    expect(text?.tagName).toBe("P");
    // chat のように 1 枚へ畳んでいない（カードは器が 2 段のまま）。
    expect(body).not.toBe(text);
    expect(text?.parentElement).toBe(body);
    expect(text?.textContent).toBe("応援してます");
  });

  /**
   * 060f ③: 器の安定クラス（`sd-comment-header` / `sd-comment-row`）。
   * ⚠ 060f 追修正④で**どちらも chat にしか付かない**（課金カードのヘッダ帯は的ではない）。
   */
  it("器の安定クラス（header / row）は chat にだけ付く", () => {
    const { container } = render(
      <CommentList
        variant="overlay"
        comments={[
          makeComment({ id: "c1", eventType: "chat", text: "hi" }),
          makeComment({
            id: "s1",
            eventType: "superchat",
            text: "sc",
            monetary: { amount: 1000, currency: "JPY" },
          }),
        ]}
      />,
    );
    const [chat, tip] = [...container.querySelectorAll<HTMLElement>("ol > li")];
    expect(chat.querySelector(".sd-comment-header")).not.toBeNull();
    expect(chat.querySelector(".sd-comment-row")).not.toBeNull();
    // ⚠ 課金カードのヘッダ帯は DOM としては在るが、安定クラスは持たない。
    expect(
      tip.querySelector(`.${overlayStyles.cardHeader}`),
    ).not.toBeNull();
    expect(tip.querySelector(".sd-comment-header")).toBeNull();
    expect(tip.querySelector(".sd-comment-row")).toBeNull();
  });

  /**
   * 060f ③: ⚠⚠ **`sd-comment-list` は `variant="overlay"` のときだけ。**
   * この `<ol>` の CSS モジュールは `CommentViewerApp.module.css`＝**本体コメビュと共有**なので、
   * 無条件に付けると 060a の不変条件「default には 1 つも付かない」を破る
   * （下の "variant=default …" テストが `[class*="sd-comment"]` で拾って落ちる）。
   */
  it("sd-comment-list は overlay の <ol> にだけ付く", () => {
    const { container } = render(
      <CommentList
        variant="overlay"
        comments={[makeComment({ eventType: "chat", text: "hi" })]}
      />,
    );
    const ol = container.querySelector("ol");
    expect(ol?.classList.contains("sd-comment-list")).toBe(true);
  });

  /**
   * ⚠⚠ **060c 追修正(2026-08-09・実機不具合): スクロール容器と「一覧の器」は別要素であること。**
   *
   * 1 層だった頃は `<ol>` が両方を兼ねており、安定クラス `sd-comment-list`
   * （変換表の `yt-live-chat-item-list-renderer #items` の対応先）経由で
   * **ユーザー CSS がスクロール機能そのものを殺せた**:
   *
   * ```text
   * テーマ: yt-live-chat-item-list-renderer #items { overflow: hidden !important }
   *   → .sd-comment-list { overflow: hidden !important }
   *   → プレビューでコメントが見切れてスクロールできない／配信窓の手動スクロールも死ぬ（実機で確認）
   * ```
   *
   * ⚠ YouTube では `#items`（器）と `#item-scroller`（スクロール容器）が**別要素**で、テーマは
   * 「スクロールバーを消す」意図で両方に書くのが定番。StreamDock で 1 要素だったせいで、その意図が
   * 「スクロール機能の停止」に化けていた。
   * ⚠⚠ **ここは「どちらが overflow を持つか」までは見ない**（jsdom はカスケードもレイアウトも
   * 評価しないので見られない）。CSS 側の不変条件は静的ガード **(10-p)** が持つ。
   * ここで固定するのは**構造**——`sd-comment-list` が付く要素が、スクロール容器**そのものではない**こと。
   *
   * ⚠ 2026-08-09 に一度この 2 層化を撤回して 1 層＋床にしたが、差し戻した（根拠が成立していなかった。
   * `CommentViewerApp.module.css` の `.scroller` のコメントが正）。
   */
  it("⚠⚠ sd-comment-list はスクロール容器ではない（テーマが overflow を潰してもスクロールが死なない）", () => {
    const { container } = render(
      <CommentList
        variant="overlay"
        comments={[makeComment({ eventType: "chat", text: "hi" })]}
      />,
    );
    const ol = container.querySelector("ol");
    const scroller = container.querySelector("[data-comment-scroll]");
    expect(ol).not.toBeNull();
    expect(scroller).not.toBeNull();
    // 別要素であること（同一要素へ戻す変異はここで落ちる）。
    expect(scroller).not.toBe(ol);
    // 器はスクロール容器の**中**にあること（外側に置くと `.scroller` の高さが決まらない）。
    expect(scroller?.contains(ol as Node)).toBe(true);
    // ⚠ `sd-comment-list` は器（`<ol>`）側に付くこと。スクロール容器へ移すと同じ穴が開き直る。
    expect(ol?.classList.contains("sd-comment-list")).toBe(true);
    expect(
      (scroller as HTMLElement).classList.contains("sd-comment-list"),
    ).toBe(false);
  });

  /**
   * ⚠ 060c 追修正: **`<div>` は `<ol>` の外側**（＝リストの意味論を壊さない）。
   * 内側に入れると `<ol>` の子が `<li>` でなくなり、`role="list"` / `"listitem"` の対応が崩れる。
   */
  it("⚠ <ol> の子は <li> だけ（スクロール用の <div> を中に入れていない）", () => {
    const { container } = render(
      <CommentList
        variant="overlay"
        comments={[
          makeComment({ id: "a", eventType: "chat", text: "x" }),
          makeComment({ id: "b", eventType: "chat", text: "y" }),
        ]}
      />,
    );
    const ol = container.querySelector("ol");
    expect(ol?.children.length).toBeGreaterThan(0);
    for (const child of Array.from(ol?.children ?? [])) {
      expect(child.tagName).toBe("LI");
    }
  });

  /**
   * ⚠⚠ 060a の不変条件「`variant="default"` には安定クラスも data 属性も 1 つも付かない」を
   * 目印にも適用する（本体コメビュはユーザー CSS の的にならない）。
   * ⚠ 目印に `sd-` を付けていないのは**ユーザー CSS 契約ではない**ことを名前で示すためだが、
   * 「default に付けない」の線はそれとは独立に守る。
   */
  it("⚠ スクロール容器の目印は overlay のときだけ付く（default には付かない）", () => {
    const { container: overlay } = render(
      <CommentList
        variant="overlay"
        comments={[makeComment({ eventType: "chat", text: "hi" })]}
      />,
    );
    expect(overlay.querySelectorAll("[data-comment-scroll]")).toHaveLength(1);

    const { container: def } = render(
      <CommentList comments={[makeComment({ eventType: "chat", text: "hi" })]} />,
    );
    expect(def.querySelectorAll("[data-comment-scroll]")).toHaveLength(0);
  });

  /**
   * 060f 追修正（security-review Q-1・2026-08-06）: ⚠⚠⚠ **目印クラスの契約は「例外を作らない」。**
   *
   * 「chat の `<li>` 自身は `sd-comment-chat`、その**中の要素はすべて** `sd-comment-in-chat`」
   * ——これが変換表の `to` を「1 要素の複合セレクタ」に保つための土台で、崩すと `to` が子孫セレクタに
   * 戻り、**合成時に二重前置されて永久に当たらないセレクタ**が生まれる
   * （`rewritten` は加算され `unmatched` は空なので UI が誤報する）。
   * ⚠ **「まだ変換表が使っていないから付けない」をしないこと**——将来その役割へ向けたエントリを
   * 足した瞬間に、黙って当たらないセレクタになる。だからここで**全要素**を見る。
   * ⚠ アイコンは chat / 課金で**同じ関数から作る**ので、目印が課金へ漏れる変異はここで落ちる。
   * ⚠ 見るのは**安定クラスを持つ要素だけ**（契約に載っていない `iconFallback` は対象外＝下の注記）。
   * ⚠ 060f 追修正④で対の `sd-comment-in-tip` は廃止（課金カードは的ではない＝上のテストが固定）。
   */
  it("chat の中の要素はすべて sd-comment-in-chat（<li> 自身は持たない）", () => {
    const { container } = render(
      <CommentList
        variant="overlay"
        comments={[
          makeComment({ id: "c1", eventType: "chat", text: "hi" }),
          makeComment({
            id: "s1",
            eventType: "superchat",
            text: "sc",
            monetaryAmount: "1,000 JPY",
            monetary: { amount: 1000, currency: "JPY" },
          }),
        ]}
      />,
    );
    const chat = container.querySelector<HTMLElement>(".sd-comment-chat")!;

    // ⚠ `<li>` 自身は目印を持たない（持つのは `sd-comment-chat`）。
    expect(chat.classList.contains("sd-comment-in-chat")).toBe(false);
    // ⚠ 対象は「**安定クラスを持つ要素**」＝契約に載っている要素。`iconFallback`（アイコン内の
    // 頭文字）のように 060a が意図的に**契約へ出していない**要素は目印も持たない（ユーザー CSS の
    // 的ではないので、目印を付けると契約を黙って広げることになる）。
    const inner = [
      ...chat.querySelectorAll<HTMLElement>('[class*="sd-comment"]'),
    ];
    expect(inner.length).toBeGreaterThan(0);
    for (const el of inner) {
      expect(el.classList.contains("sd-comment-in-chat")).toBe(true);
    }
  });

  /**
   * 060f 追修正(2026-08-08): ⚠⚠ **アイコンは `<li>` の直下**（`.sd-comment-row` の中ではない）。
   *
   * 取り込んだテーマが `.sd-comment-icon{display:none}` でアイコンを消すと、
   * **名前行だけ 72px のインデントが残る**崩れが実機で出た（`.header` が
   * `margin-left: calc(--icon-size + --icon-gap)` をハードコードで持っており、
   * アイコンが実際に描かれているかに追随しなかった）。
   * ⚠ **CSS では「兄弟が display:none か」を検出できない**ので、インデントを**アイコンの実体**
   * （`.item` のグリッド 1 列目）から作る形に変えた＝アイコンが消えれば列ごと畳まれる。
   *
   * ＝ **この DOM の形（アイコンが `<li>` 直下・グリッドの兄弟）がその仕組みの前提**。
   * ⚠ アイコンを `.row` の中へ戻す変異はここで落ちる。戻すなら `.header` のインデントの作り方も
   * 一緒に考え直すこと（progress.md 060f 節「実機確認の差し戻し」）。
   * ⚠ jsdom はレイアウトを持たないので「実際に詰まるか」は見られない＝実機確認の担当。
   */
  it("chat のアイコンは <li> の直下（.sd-comment-row の中ではない）", () => {
    const { container } = render(
      <CommentList
        variant="overlay"
        comments={[makeComment({ eventType: "chat", text: "hi" })]}
      />,
    );
    const li = container.querySelector<HTMLElement>(".sd-comment-chat");
    const icon = sd(container, "sd-comment-icon");
    const row = container.querySelector<HTMLElement>(".sd-comment-row");
    expect(li).not.toBeNull();
    expect(icon).not.toBeNull();
    expect(row).not.toBeNull();
    // アイコンの親は <li> そのもの（間に器が挟まっていない）。
    expect(icon?.parentElement).toBe(li);
    // ⚠ 行の中に残っているのは吹き出しだけ。
    expect(row?.querySelector(".sd-comment-icon")).toBeNull();
    expect(row?.children.length).toBe(1);
    expect(row?.firstElementChild).toBe(sd(container, "sd-comment-body"));
  });

  /**
   * 060f 追修正: 課金カードのアイコンは**従来どおり `.sd-comment-header`（ヘッダ帯）の中**。
   * ⚠ 課金カードはグリッドの 1 列に戻してある（`.card { grid-template-columns: minmax(0, 1fr) }`）ので、
   * chat 側の列構成を持ち込まないこと。
   * ⚠ 060i(2026-08-09): 素の `1fr` ではなく **`minmax(0, 1fr)`**（＝縮められる 1 列）。`1fr` は
   * `minmax(auto, 1fr)` の糖衣なので、名前が長いと列が min-content まで広がって金額バッジが切れる。
   * 静的ガード (10-s) が固定している（jsdom はレイアウトを解決しないのでここでは検証できない）。
   */
  it("課金カードのアイコンは従来どおりヘッダ帯の中にある", () => {
    const { container } = render(
      <CommentList
        variant="overlay"
        comments={[
          makeComment({
            eventType: "superchat",
            text: "sc",
            monetary: { amount: 1000, currency: "JPY" },
          }),
        ]}
      />,
    );
    // ⚠ 060f 追修正④: 課金カード側は安定クラスを持たないので**意匠クラスで引く**。
    const header = container.querySelector<HTMLElement>(
      `.${overlayStyles.cardHeader}`,
    );
    const icon = container.querySelector<HTMLElement>(
      `.${overlayStyles.icon}`,
    );
    expect(icon?.parentElement).toBe(header);
    // ⚠ 036a のガードは 1 実装のまま＝課金側のアイコンも同じ関数から作られている
    //   （`sd-comment-icon` が付いていないだけで、要素としては同じ形）。
    expect(icon?.classList.contains("sd-comment-icon")).toBe(false);
  });

  it("showSource=false ならサイト名バッジの安定クラスも出ない（DOM ごと無い）", () => {
    const { container } = render(
      <CommentList
        variant="overlay"
        comments={[makeComment({ eventType: "chat", text: "やあ" })]}
      />,
    );
    expect(sd(container, "sd-comment-source")).toBeNull();
  });

  /**
   * ⚠ 060f 追修正④: 課金カードは**意匠だけを持つ**（的は持たない）。
   * 中身（名前・金額・本文）が従来どおり出ていることは意匠クラスで固定する
   * ——ここが緑のまま「カードが空になる」退行を通さないため。
   */
  it("課金カードは意匠クラスだけを持ち、中身は従来どおり出る", () => {
    const { container } = render(
      <CommentList
        variant="overlay"
        comments={[
          makeComment({
            eventType: "superchat",
            text: "応援してます",
            monetary: { amount: 10000, currency: "JPY" },
            monetaryAmount: "10,000 JPY",
          }),
        ]}
      />,
    );
    const q = (key: string) =>
      container.querySelector<HTMLElement>(`.${overlayStyles[key]}`);
    expect(q("card")).toBeTruthy();
    expect(q("cardName")?.textContent).toBe("Alice");
    expect(q("icon")).toBeTruthy();
    expect(q("cardBody")).toBeTruthy();
    expect(q("cardText")?.textContent).toBe("応援してます");
    expect(q("amountBadge")?.textContent).toBe("10,000 JPY");
    // ⚠ 課金カードの中にユーザー CSS の的は 1 つも無い。
    //   （`<ol>` の `sd-comment-list` は器なので対象外＝`<li>` の中だけを見る。）
    const li = container.querySelector<HTMLElement>("ol > li")!;
    expect(li.querySelectorAll('[class*="sd-comment"]')).toHaveLength(0);
    expect([...li.classList].filter((c) => c.startsWith("sd-comment"))).toEqual(
      [],
    );
  });

  it("要約文を出す課金種別（サブスク）は従来どおり出る（安定クラスは付かない）", () => {
    const { container } = render(
      <CommentList
        variant="overlay"
        comments={[makeComment({ eventType: "subscription", text: "" })]}
      />,
    );
    expect(
      container.querySelector<HTMLElement>(`.${overlayStyles.eventMessage}`)
        ?.textContent,
    ).toContain("サブスク");
    const li = container.querySelector<HTMLElement>("ol > li")!;
    expect(li.querySelectorAll('[class*="sd-comment"]')).toHaveLength(0);
  });

  it("data-sd-source は配信元をそのまま出す", () => {
    const { container } = render(
      <CommentList
        variant="overlay"
        comments={[
          makeComment({ id: "t1", source: "twitch", text: "tw" }),
          makeComment({ id: "y1", source: "youtube", text: "yt" }),
        ]}
      />,
    );
    const items = container.querySelectorAll<HTMLElement>(".sd-comment");
    expect(items.length).toBe(2);
    expect(items[0].dataset.sdSource).toBe("twitch");
    expect(items[1].dataset.sdSource).toBe("youtube");
  });

  /**
   * ⚠ 060f 追修正④: `data-sd-event` が付くのは **chat だけ**になった（課金カードは的ではない）。
   * `displayEventType()` と同じ判定であることは chat 側でも表明できる（chat は常に "chat"）。
   * ⚠ 「ビッツは bits」という判定そのものは `displayEventType` の単体テストが持っている。
   */
  it("data-sd-event は chat にだけ付き、displayEventType と同じ値になる", () => {
    const { container } = render(
      <CommentList
        variant="overlay"
        comments={[
          makeComment({ id: "c1", eventType: "chat", text: "hi" }),
          makeComment({
            id: "b1",
            eventType: "superchat",
            text: "cheer",
            monetary: { amount: 100, currency: "BITS" },
          }),
        ]}
      />,
    );
    const items = [...container.querySelectorAll<HTMLElement>("ol > li")];
    expect(items[0].dataset.sdEvent).toBe("chat");
    // ⚠ ビッツ（eventType="superchat" + currency="BITS"）は課金カード＝属性を持たない。
    expect(items[1].dataset.sdEvent).toBeUndefined();
  });

  /**
   * ⚠⚠ 060f 追修正④: **`data-sd-tone` はどこにも出なくなった。**
   * 出していたのは課金カードだけで、そこを的から外したため。
   * ＝ 060a が公開していた `.sd-comment[data-sd-tone="t6"] .sd-comment-body{…}`（ティア別に課金カードを
   * 飾る）は**できなくなった**。本人決定「スパチャのデザインは常に同じ」の直接の帰結で、受容済み。
   * ⚠ chat に付けない理由は従来どおり（`monetaryTone()` は chat を "t0" へ無害劣化させるので、
   * 付けると「最低額スパチャだけ光らせる」CSS が全 chat にも当たる）。
   */
  it("⚠ data-sd-tone はもうどこにも出ない（課金カードを的から外したため）", () => {
    const { container } = render(
      <CommentList
        variant="overlay"
        comments={[
          makeComment({ id: "c1", eventType: "chat", text: "hi" }),
          makeComment({
            id: "s1",
            eventType: "superchat",
            text: "sc",
            monetary: { amount: 10000, currency: "JPY" },
          }),
          makeComment({ id: "sub1", eventType: "subscription", text: "" }),
        ]}
      />,
    );
    expect(container.querySelectorAll("[data-sd-tone]")).toHaveLength(0);
  });

  /**
   * ⚠⚠ **安定クラスは CSS モジュールのクラスへ「併記」であって「置換」ではない**（060a の中心要件＝
   * 「既存の意匠を 1px も変えない」）。`className={\`${overlayStyles.item} sd-comment\`}` を
   * `className="sd-comment"` に書き換える変異は、**意匠を全部消すのに 060a の契約テストは全部緑のまま通る**
   * （契約テストは `.sd-comment` を引くだけだから）。ここがその変異を殺す唯一のテスト。
   *
   * CSS モジュールのローカル名は vitest 上で `_<key>_<hash>` 形式になるので、キー名の部分文字列で表明する
   * （051 の `rowClass` と同じイディオム）。⚠ CSS モジュールは**存在しないキーでも文字列を返す**ので、
   * 「CSS 側にルールがあるか」まではここでは守れない——その層は check-css-guards.mjs のガード (10-e)。
   */
  it("安定クラスは CSS モジュールのクラスに**併記**される（置換ではない＝意匠が消えない）", () => {
    const { container } = render(
      <CommentList
        variant="overlay"
        showSource
        comments={[
          makeComment({ id: "c1", eventType: "chat", text: "こんにちは" }),
          makeComment({
            id: "s1",
            eventType: "superchat",
            text: "応援してます",
            monetaryAmount: "10,000 JPY",
            monetary: { amount: 10000, currency: "JPY" },
          }),
        ]}
      />,
    );
    const [chat, tip] = [...container.querySelectorAll<HTMLElement>("ol > li")];

    // chat: 行・名前・吹き出し・本文・アイコン・サイト名バッジ
    expect(chat.className).toContain("item");
    expect(sd(container, "sd-comment-name")?.className).toContain("name");
    expect(sd(container, "sd-comment-icon")?.className).toContain("icon");
    expect(sd(container, "sd-comment-source")?.className).toContain("source");
    // ⚠⚠ 060f: 吹き出しと本文は 1 枚の `<p>` に畳んだので、**意匠クラスが 2 つとも載っている**
    // ことを見る。`.bubble`（背景/枠/角丸/影/しっぽの基準）と `.text`（サイズ/行間/色/margin:0）は
    // 重複プロパティが無いので併記で当てており、**片方でも落ちると意匠が半分消える**
    // （`OverlayComment.module.css` を非コメント差分ゼロに保つための構成なので、
    //   1 規則へ統合する変更をするならこの表明も一緒に書き換えること）。
    // ⚠ **部分文字列一致では書かないこと**（実測でこの変異が生存した）——同じ要素に安定クラス
    // `sd-comment-text` が併記されているので `toContain("text")` はそちらに一致してしまう。
    const chatBubble = sd(container, "sd-comment-body");
    expect(chatBubble?.classList.contains(overlayStyles.bubble)).toBe(true);
    expect(chatBubble?.classList.contains(overlayStyles.text)).toBe(true);
    // 行・名前行の器も CSS モジュールのクラスを保っている（安定クラスで置換していない）。
    expect(chat.querySelector(".sd-comment-row")?.className).toContain("row");
    expect(chat.querySelector(".sd-comment-header")?.className).toContain(
      "header",
    );

    // 課金カード: .item と .card とティア配色クラスが全部残っていること（意匠の本体）。
    // ⚠ OBS 側のティアクラスは 043c 由来の `.tier6`（本体 UI の `.toneT6` とは別名・monetaryTone.ts 参照）。
    // ⚠⚠ 060f 追修正④: 課金カードは安定クラスを持たないので、ここは**意匠クラスだけ**で表明する。
    //   「安定クラスを外したついでに意匠クラスまで消える」退行を殺すのがこの 4 行の役目。
    expect(tip.className).toContain("item");
    expect(tip.className).toContain("card");
    expect(tip.className).toContain("tier6");
    expect(
      tip.querySelector<HTMLElement>(`.${overlayStyles.amountBadge}`),
    ).not.toBeNull();
    expect(
      tip.querySelector<HTMLElement>(`.${overlayStyles.cardBody}`),
    ).not.toBeNull();
    expect(
      tip.querySelector<HTMLElement>(`.${overlayStyles.cardHeader}`),
    ).not.toBeNull();
  });

  it("variant=default（コメビュ本体）には安定クラスも data 属性も付かない", () => {
    const { container } = render(
      <CommentList
        comments={[
          makeComment({ eventType: "chat", text: "hi" }),
          makeComment({
            id: "s1",
            eventType: "superchat",
            text: "sc",
            monetaryAmount: "1,000 JPY",
            monetary: { amount: 1000, currency: "JPY" },
          }),
        ]}
      />,
    );
    expect(container.querySelector('[class*="sd-comment"]')).toBeNull();
    expect(container.querySelector("[data-sd-source]")).toBeNull();
    expect(container.querySelector("[data-sd-event]")).toBeNull();
    expect(container.querySelector("[data-sd-tone]")).toBeNull();
  });
});

/**
 * 062a: レイド行の描画仕様。
 *
 * ⚠⚠ **レイドは `MONETARY_EVENT_TYPES` に入れない**（課金ではない）ので、`renderDefaultItem` の
 * **chat 分岐**へ落ちる。ところがあの分岐は設計上 `typeLabel` を描かない（課金種別の追加漏れを
 * 一覧が隠さないための意図的な設計）ので、**名指しの分岐を足さないとレイドは「配信元バッジ＋名前だけの
 * 空行」になる**。ここはその 1 点を固定する。
 *
 * ⚠ 併せて「配信画面（overlay）には出さない」ことも固定する。落とし忘れると**空の吹き出しが
 * 配信に映る**（062a の取り込みが作りうる表示欠陥で、062a 以前の配信画面には出ていなかった）。
 */
describe("CommentList 062a レイド", () => {
  const raid = (over: Partial<CommentViewDto> = {}): CommentViewDto =>
    makeComment({
      id: "r1",
      eventType: "raid",
      text: "",
      author: { id: "raider", name: "RaiderChannel" },
      raidViewerCount: 42,
      ...over,
    });

  it("本体の一覧に「レイド」ラベルと人数が出る", () => {
    render(<CommentList comments={[raid()]} />);
    expect(screen.getByText("レイド 42人")).toBeTruthy();
    expect(screen.getByText("RaiderChannel")).toBeTruthy();
  });

  it("人数が 4 桁以上なら桁区切りが入る（fmtNumber を通している）", () => {
    render(<CommentList comments={[raid({ raidViewerCount: 12345 })]} />);
    expect(screen.getByText("レイド 12,345人")).toBeTruthy();
  });

  it("⚠ 人数が欠けていてもラベルだけは出る（空行にならない）", () => {
    render(<CommentList comments={[raid({ raidViewerCount: undefined })]} />);
    expect(screen.getByText("レイド")).toBeTruthy();
  });

  it("⚠ レイドは課金カード（ティア色）にならない", () => {
    const { container } = render(<CommentList comments={[raid()]} />);
    // 課金カードなら TONE_CLASS のいずれかが当たる。レイドではどれも当たってはいけない。
    for (const cls of Object.values(TONE_CLASS)) {
      expect(container.querySelector(`.${cls}`)).toBeNull();
    }
    // 金額バッジも出ない（レイドは monetaryAmount を持たない）。
    expect(container.textContent).not.toContain("JPY");
  });

  it("⚠⚠ 配信画面（variant=overlay）にはレイド行を出さない（空の吹き出しを映さない）", () => {
    const { container } = render(
      <CommentList
        comments={[raid(), makeComment({ id: "c1", text: "hello" })]}
        variant="overlay"
      />,
    );
    // 通常チャットは出る。
    expect(screen.getByText("hello")).toBeTruthy();
    // レイドは行ごと出ない（名前も吹き出しも無い）。
    expect(screen.queryByText("RaiderChannel")).toBeNull();
    expect(container.querySelectorAll("li").length).toBe(1);
  });
});
