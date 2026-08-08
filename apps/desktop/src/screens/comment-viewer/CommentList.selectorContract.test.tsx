import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import type { CommentViewDto } from "../../features/comment-viewer/types";
import { CommentList } from "./CommentList";
import {
  rewriteSelectors,
  SELECTOR_TABLE,
} from "../../features/comment-viewer/cssCompat";
import { DEFAULT_DECORATION_RESET } from "../../features/comment-viewer/overlayThemeReset";

/**
 * 060f: **変換表（`cssCompat.ts`）と実 DOM（`CommentList`）の突き合わせ**を、
 * 「変換後のセレクタが実際に当たるか」で表明する。
 *
 * ## なぜこのファイルが必要か（既存テストで足りていなかったこと）
 *
 * 060a / 060f のテストは 2 つに分かれていた:
 * - `cssCompat.test.ts` … 変換表が**どんな文字列を出すか**（実 DOM は見ない）
 * - `CommentList.test.tsx` … DOM に**どんなクラスが付くか**（変換表は見ない）
 *
 * ⚠⚠ **その 2 つが緑でも「変換されたのに当たらない」は成立する**。両者を突き合わせているのは
 * 静的ガード **(10-b)**（`to` のクラストークン ⊆ 契約一覧）と **(10-a)**（契約一覧が
 * `CommentList.tsx` の**ソース文字列**に在る）だけで、どちらも
 * **「そのクラスが、そのセレクタが要求する位置関係で実際にレンダリングされるか」を見ていない。**
 *
 * 実際にそれで 2 回事故が起きている（どちらも上記 4 つがすべて緑のまま通った）:
 * - 060f 起票理由①: chat 専用セレクタが `.sd-comment`（chat と課金の**両方**に付く）へ向いており、
 *   **chat 用に書かれたテーマが課金カードの意匠を壊していた**。
 * - security-review Q-1（2026-08-05）: `to` を子孫セレクタにしたため、`親 子孫` /
 *   `span.クラス` 形のユーザー CSS が**前置の二重積みで永久に当たらなくなっていた**
 *   （しかも `rewritten` は加算され `unmatched` は空＝ 060d の UI が「変換しました」と誤報する）。
 *
 * → **jsdom はレイアウトも色もカスケードも解決しないが、セレクタの照合は本物である**
 * （`querySelectorAll` / `matches`）。だから「**当たるかどうか**」だけはここで機械的に固定できる。
 * ⚠ **「どう見えるか」（詳細度の勝敗・二重吹き出し・窓の透過）はここでは分からない**＝実機確認の担当。
 *
 * 仕様の正: `docs/tasks/060f-overlay-dom-alignment.md`（ズレ①②③）／
 * `docs/tasks/060a-overlay-selector-contract.md`（安定クラス契約）／
 * `docs/progress.md` の 060f 節（「security-review の結果」→「Q-1 の修正」）。
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

/**
 * 契約に載っている全要素が 1 度に出るフィクスチャ。
 * ⚠ `showSource` の既定は **false** なので明示的に渡す（サイト名バッジも契約の一部）。
 * ⚠ 課金カードは 2 種類要る——金額バッジ（`sd-comment-amount`）は `monetaryAmount` を持つ
 * スパチャにだけ、種別の要約（`sd-comment-event`）はメンバーシップ等にだけ出る。
 */
const COMMENTS: CommentViewDto[] = [
  makeComment({ id: "chat1", eventType: "chat", text: "こんにちは" }),
  makeComment({
    id: "tip1",
    eventType: "superchat",
    text: "応援してます",
    monetaryAmount: "1,000 JPY",
    monetary: { amount: 1000, currency: "JPY" },
  }),
  makeComment({
    id: "tip2",
    eventType: "membership",
    text: "",
    monthCount: 3,
  }),
];

/**
 * 注入先の DOM をそのまま再現する。
 * ⚠ **`.sd-overlay` のラッパは `OverlayApp` の写し**（あちらは `<div className={styles.root} sd-overlay>` に
 * `CommentList variant="overlay"` を入れている）。変換表が `yt-live-chat-app` をここへ向けているので、
 * ラッパ無しでは「窓ルートを狙うセレクタが当たるか」を確かめられない。
 * ⚠ ラッパを増やす／`OverlayApp` の構造を変えるときは、ここも合わせること。
 */
const renderOverlay = () =>
  render(
    <div className="sd-overlay">
      <CommentList variant="overlay" showSource comments={COMMENTS} />
    </div>,
  ).container;

/** `from` を変換して、セレクタ部分（`{` の前）だけを取り出す。 */
const convert = (from: string): string => {
  const css = rewriteSelectors(`${from}{a:b}`).css;
  return css.slice(0, css.indexOf("{")).trim();
};

/** `root` 自身と配下で `sel` に当たる要素の数（`sel` が `root` 自身を指す場合も数える）。 */
const hits = (root: Element, sel: string): number =>
  (root.matches(sel) ? 1 : 0) + root.querySelectorAll(sel).length;

/**
 * 器（コメント 1 件の外側）を指す変換先。⚠ コメントの `<li>` の中には**無い**ので、
 * 下の「chat / 課金のどちらに当たるか」の検査からは外して個別に見る。
 */
const CONTAINER_TARGETS = [".sd-overlay", ".sd-comment-list"];

/** 課金カードの `<li>`。⚠ 安定クラスを持たないので**意匠クラス（CSS モジュール）で引く**。 */
const tipItems = (root: Element): HTMLElement[] =>
  [...root.querySelectorAll<HTMLElement>("ol > li")].filter(
    (li) => !li.classList.contains("sd-comment"),
  );

describe("060f: 変換表の変換先が実 DOM に当たる（変換されたのに効かない状態を作らない）", () => {
  it("⚠⚠ 変換表の全エントリの変換先が、レンダリングしたオーバーレイの DOM に 1 つ以上当たる", () => {
    const container = renderOverlay();
    const dead: string[] = [];
    for (const rule of SELECTOR_TABLE) {
      const sel = convert(rule.from);
      // 変換が起きていること（＝表のエントリが自分自身に当たること）を先に確かめる。
      expect(sel).not.toBe(rule.from);
      if (container.querySelectorAll(sel).length === 0) {
        dead.push(`${rule.from} -> ${sel}`);
      }
    }
    // ⚠ ここが空でないなら「ユーザーの CSS は変換されるのに当たらない」＝ 060d の UI が誤報する状態。
    expect(dead).toEqual([]);
  });

  /**
   * ⚠⚠⚠ **060f 追修正④(2026-08-08・本人決定) の中核テスト（実 DOM 側）。**
   *
   * **変換表のどのエントリも、課金カードには 1 つも当たらない。**
   * 060f は 3 巡ぶん「chat 専用クラスへ向ける／目印で限定する」で解こうとして失敗した
   * ——配布テーマが `yt-live-chat-paid-message-renderer{display:none!important}` のように
   * **課金カードを名指しで消しにくる**ため（純正チャットはスパチャがティッカーにも出るので
   * 「インライン側を消す」のが定番。StreamDock にティッカーは無いので意図が成立しない）。
   * → 課金カードから安定クラスと `data-sd-*` を全部外した。ここがその実 DOM 側の受け皿。
   * ⚠ 対になる検査＝ 静的ガード **(10-o)**（`CommentList.tsx` の字面）。**両方消さないこと。**
   *
   * ⚠⚠⚠ **このテストが表明しているのは「名指しできない」までで「到達不能」ではない**
   * （security-review 2026-08-08・レビュー指摘 S-1）。見ているのは**変換表の `to` のリテラル**であり、
   * 「器のエントリ（`.sd-overlay` / `.sd-comment-list`）＋ 汎用/型セレクタ」で合成された形は**範囲外**である。
   * 合成した場合に実際は当たることを、下の「⚠ 既知の限界」テストが**逆向きに固定している**。
   * ＝ この 2 本を**対で読むこと**。片方だけを見て「課金カードは絶対に触れない」と結論しないこと。
   */
  it("⚠⚠⚠ 変換表のどの変換先も課金カードに 1 つも当たらない（060f 追修正④）", () => {
    const container = renderOverlay();
    const chat = container.querySelector<HTMLElement>(".sd-comment-chat");
    const tips = tipItems(container);
    expect(chat).not.toBeNull();
    expect(tips).toHaveLength(2);

    const leaked: string[] = [];
    const missing: string[] = [];
    for (const rule of SELECTOR_TABLE) {
      const sel = convert(rule.from);
      // ⚠ 器（`.sd-overlay` / `.sd-comment-list`）は `<li>` の外なので当たらなくて当然。
      if (!CONTAINER_TARGETS.includes(rule.to) && hits(chat!, sel) === 0) {
        missing.push(`${sel}（chat に当たらない）`);
      }
      const inTips = tips.reduce((n, li) => n + hits(li, sel), 0);
      if (inTips > 0) leaked.push(`${sel}（課金カードに漏れている）`);
    }
    expect({ leaked, missing }).toEqual({ leaked: [], missing: [] });
  });

  /**
   * ⚠⚠ **実テーマの定番「スーパーチャット非表示」が課金カードに届かないことの回帰テスト。**
   * これが届くと `.sd-comment-tip{display:none}` になり、**課金カードが丸ごと消える**（実機で発生）。
   */
  it("⚠⚠ 配布テーマの『スーパーチャット非表示』は課金カードに当たらない", () => {
    const container = renderOverlay();
    const tips = tipItems(container);
    expect(tips).toHaveLength(2);
    for (const from of [
      "yt-live-chat-paid-message-renderer",
      "yt-live-chat-paid-sticker-renderer",
      ".yt-live-chat-membership-item-renderer",
      "yt-live-chat-paid-message-renderer #message",
    ]) {
      const sel = convert(from);
      // ⚠ 変換されない（＝素通り）ので、StreamDock の DOM には当たりようがない。
      expect(sel).toBe(from);
      expect(container.querySelectorAll(sel)).toHaveLength(0);
    }
  });

  /**
   * ⚠⚠⚠ **既知の限界（security-review 2026-08-08・レビュー指摘 S-1）。**
   * **課金カードは「名指しできない」だけで「到達不能」ではない。**
   *
   * 変換表は器のエントリ（`yt-live-chat-app` / `yt-live-chat-renderer` → `.sd-overlay`、
   * `yt-live-chat-item-list-renderer #items` → `.sd-comment-list`）を持っており、これらは
   * 課金カードの**祖先**である。テーマが汎用（`*`）や型（`li`）と組み合わせて書けば届く。
   * ⚠ この 2 つの写像は **060f が新規に追加した**（060a 時点の変換表には無かった）。
   * ＝ 060f は課金カードの名指しを塞ぐと同時に、純正語彙から祖先へ届く経路を 1 つ開けている。
   *
   * ⚠ **能力そのものは 060a 時点から `.sd-overlay li{…}` と直接書けたので区分は変わらない**
   * （`docs/security.md`「## CSP方針」060d 節の 追修正④ 段落）。変わったのは**踏む確率**。
   * ⚠ 起票理由である `yt-live-chat-paid-message-renderer{display:none!important}` は未変換のままなので、
   * **実害（配布テーマで課金カードが丸ごと消える）は解消している**。上のテストがそれを固定している。
   *
   * ⚠⚠ **このテストは「当たるのが現状」を固定するためのもの**（0 件になったら仕様変更＝ docs を先に直す）。
   * 塞ぐなら目印の除去では届かない——必要なのは**構造の分離**（課金カードを shadow root か別の器へ出して
   * 注入した `<style>` のスコープから外す）である。
   * 再修正トリガー: 実機で「祖先＋汎用」を書いた配布テーマが課金カードを壊す事例が観測されたとき。
   */
  it("⚠ 既知の限界: 祖先の契約クラス＋汎用/型セレクタなら課金カードに届く（名指し不可≠到達不能）", () => {
    const container = renderOverlay();
    const tips = tipItems(container);
    expect(tips).toHaveLength(2);

    // ⚠ どれも「純正 YouTube 語彙だけで書かれた」形＝ユーザーが sd 語彙を知らなくても書ける。
    for (const [from, expected] of [
      ["yt-live-chat-renderer *", ".sd-overlay *"],
      ["yt-live-chat-item-list-renderer #items > *", ".sd-comment-list > *"],
      ["yt-live-chat-app li", ".sd-overlay li"],
    ] as const) {
      const sel = convert(from);
      expect(sel).toBe(expected);
      // ⚠ 0 件ではない＝届いている。ここが 0 になったら仕様が変わったということ。
      expect(tips.reduce((n, li) => n + hits(li, sel), 0)).toBeGreaterThan(0);
    }

    // ⚠ 対比: 課金カードを**名指し**する定番の形は、変換表から外したので届かない（実害はこちら）。
    expect(
      container.querySelectorAll(convert("yt-live-chat-paid-message-renderer")),
    ).toHaveLength(0);
  });

  it("器を指す変換先は器に当たり、コメント 1 件の中には無い", () => {
    const container = renderOverlay();
    for (const to of CONTAINER_TARGETS) {
      expect(container.querySelectorAll(to).length).toBeGreaterThan(0);
    }
    for (const li of container.querySelectorAll<HTMLElement>(".sd-comment")) {
      for (const to of CONTAINER_TARGETS) {
        expect(hits(li, to)).toBe(0);
      }
    }
  });

  /**
   * ⚠⚠ **security-review Q-1 の回帰テスト（実 DOM 側）。**
   * `cssCompat.test.ts` は「文字列がこう変換される」ことを、こちらは「**その文字列が実際に当たる**」ことを見る。
   * Q-1 の欠陥（`to` が子孫セレクタ）では、下はすべて**変換されるのに 0 件**だった。
   */
  it("⚠⚠ 実テーマの典型形（親 子孫 / 型セレクタ+クラス）が実 DOM に当たる", () => {
    const container = renderOverlay();
    const cases: [label: string, from: string][] = [
      ["Twitch: 行 → 本文", ".chat-line__message .chat-line__message-body"],
      ["Twitch: 行 → 名前", ".chat-line__message .chat-author__display-name"],
      ["Twitch: span + クラス", "span.chat-author__display-name"],
      ["YouTube: 窓 → 本文", "yt-live-chat-app yt-live-chat-text-message-renderer #message"],
      ["YouTube: 一覧 → コメント", "yt-live-chat-item-list-renderer #items yt-live-chat-text-message-renderer"],
      // ⚠ 060f 追修正④で「課金 → …」の 2 例は落とした。課金カードはユーザー CSS の的ではないので
      //   **当たらないのが正しい**（上の「配布テーマの『スーパーチャット非表示』」テストが逆向きに固定している）。
    ];
    const dead: string[] = [];
    for (const [label, from] of cases) {
      const sel = convert(from);
      if (container.querySelectorAll(sel).length === 0) {
        dead.push(`${label}: ${from} -> ${sel}`);
      }
    }
    expect(dead).toEqual([]);
  });

  /**
   * ⚠⚠ **既知の限界（本テストで判明・060f の回帰では**ない**／060c へ申し送り）。**
   *
   * **テーマが「コメント 1 件 → 中身」を子結合子（`>`）で書いていると当たらない。** StreamDock の chat は
   * 純正チャットに無い中間要素（`div.row`＝アイコン＋吹き出しの行／`div.header`＝名前行）を挟むため、
   * 本文も名前も `<li>` の**直接の子ではない**。
   *
   * ⚠ **060f 以前から当たっていない**（実測。当時は `li > div.row > div.bubble > p` でもう 1 段深く、
   * `.sd-comment > .sd-comment-text` も 0 件だった）＝ 060f はむしろ 1 段浅くした。
   * ⚠ **表の `from` に書かれた `>` は別物で、そちらは正しく吸収される**——`from` は `\s+` と `>` の
   * 両方に当たる形へコンパイルされるので `renderer > #message` は 1 エントリとして畳まれる。
   * 当たらないのは「**独立した 2 エントリの間に書かれた `>`**」で、そこはそのまま出力へ残る。
   *
   * ⚠ 直すなら DOM を平らにする（`div.row` / `div.header` を廃す）しかないが、それは 034e/043c の
   * 意匠（アイコンと吹き出しの横並び・名前行のインデント）を作っている器なので**本タスクでは触らない**。
   * 再修正トリガー＝ 060c で実サンプルの外部 CSS を取り込んだとき、`>` で書かれた指定が
   * 実際に効かないことが観測されたら、そのとき DOM を平らにするか対応を諦めるかを判断する
   * （どちらにしてもユーザーには見えない失敗なので、`unmatched` に出ない点も併せて考えること）。
   */
  it("⚠ 子結合子（>）で書かれた「コメント → 中身」は当たらない（中間の器があるため・060f 以前から）", () => {
    const container = renderOverlay();

    // 表の `from` の中の `>` は吸収されるので、こちらは当たる。
    expect(convert("yt-live-chat-text-message-renderer > #message")).toBe(
      ".sd-comment-text.sd-comment-in-chat",
    );
    expect(
      container.querySelectorAll(".sd-comment-text.sd-comment-in-chat").length,
    ).toBeGreaterThan(0);

    // ⚠ 独立した 2 エントリの間の `>` は残り、中間の器（div.row / div.header）に阻まれて当たらない。
    for (const from of [
      ".chat-line__message > .chat-line__message-body",
      ".chat-line__message > .chat-author__display-name",
    ]) {
      const sel = convert(from);
      expect(sel).toContain(">");
      expect(container.querySelectorAll(sel)).toHaveLength(0);
      // 同じ指定を**子孫**（空白）で書けば当たる＝当たらない原因が「階層の深さ」だけであることの証拠。
      const descendant = convert(from.replace(" > ", " "));
      expect(container.querySelectorAll(descendant).length).toBeGreaterThan(0);
    }
  });

  /**
   * ⚠⚠ **060f 追修正④で `.sd-comment` の意味が変わった**（2026-08-08 本人決定）。
   * 「コメント 1 件（chat / 課金 共通）」→ **「chat のコメント 1 件」**。
   * StreamDock 語彙で `.sd-comment{display:none}` と直接書いても、**課金カードは消えない**。
   * ＝「スパチャのデザインは常に同じで、配信窓に必ず出る」という要件は、
   * 変換表経由だけでなく**ユーザーが sd 語彙で直接書いた場合にも**成立している必要がある。
   * ⚠ ここが「両方に当たる」に戻ったら、それは契約の変更＝ 060a / 060f の docs を先に直すこと。
   */
  it("⚠⚠ `.sd-comment` を直接書いても課金カードには当たらない（060f 追修正④）", () => {
    const container = renderOverlay();
    // 変換を通しても素通り（sd 語彙は変換表の `from` に無い＝冪等性の担保 (10-c)）。
    expect(convert(".sd-comment")).toBe(".sd-comment");
    const matched = [...container.querySelectorAll(".sd-comment")];
    expect(matched).toHaveLength(1);
    expect(matched[0].matches(".sd-comment-chat")).toBe(true);
    // 課金カードは 2 件レンダリングされているが、1 件も当たらない。
    expect(tipItems(container)).toHaveLength(2);
    // 廃止した課金側の語彙もどこにも無い。
    expect(container.querySelectorAll(".sd-comment-tip")).toHaveLength(0);
    expect(container.querySelectorAll(".sd-comment-in-tip")).toHaveLength(0);
  });

  /**
   * ⚠⚠ **本体コメビュ（`variant="default"`）はユーザー CSS の的にならない**（060a の不変条件）。
   * 既存テストは「安定クラスも data 属性も付かない」を `[class*="sd-comment"]` で見ているが、
   * ここでは**変換表の全エントリを実際に当ててみて 0 件**であることで表明する
   * （＝「テーマは本体コメビュを 1 要素も触れない」という、ユーザーから見た保証そのもの）。
   */
  it("⚠⚠ variant=default には変換後のどのセレクタも 1 つも当たらない", () => {
    const { container } = render(
      <CommentList showSource comments={COMMENTS} />,
    );
    const matched: string[] = [];
    for (const rule of SELECTOR_TABLE) {
      const sel = convert(rule.from);
      if (container.querySelectorAll(sel).length > 0) {
        matched.push(`${rule.from} -> ${sel}`);
      }
    }
    expect(matched).toEqual([]);
  });

  /**
   * ⚠ **既知の限界（060c への申し送り）**: StreamDock に存在しない **id** を含む形は、
   * 変換されて構造も保存されるのに**当たらない**（`#author-name` / `#card` は StreamDock に無い。
   * オーバーレイに在る id は `index.html` の `#root` ただ 1 つ＝ (10-g) が固定している）。
   * しかも `#card` は `FOREIGN_ID_NAMES` の「総称 id は入れない」判断の対象なので **`unmatched` にも出ない**。
   * ＝ これは Q-1 とは別物（Q-1 は StreamDock 側に要素が在るのに当たらなくなっていた）。
   * ⚠ **このテストは「当たらないのが現状」を固定するためのもの**。塞ぐなら 060c で
   * `FOREIGN_ID_NAMES` を広げるか allow-list 方式へ変えること（そのときここを書き換える）。
   */
  it("⚠ StreamDock に無い id を含む形は構造は保たれるが当たらない（060c 申し送り）", () => {
    const container = renderOverlay();
    // 構造は保存されている（＝ Q-1 の「子孫へ化ける」は起きていない）。
    expect(convert("#author-name.yt-live-chat-author-chip")).toBe(
      "#author-name.sd-comment-name.sd-comment-in-chat",
    );
    // ⚠ 060f 追修正④: 課金カードのエントリを削除したので、こちらは**完全に未変換**になった。
    expect(convert("#card.yt-live-chat-membership-item-renderer")).toBe(
      "#card.yt-live-chat-membership-item-renderer",
    );
    // ただし当たらない（id が無い）。
    expect(
      container.querySelectorAll("#author-name.sd-comment-name.sd-comment-in-chat"),
    ).toHaveLength(0);
    expect(
      container.querySelectorAll("#card.yt-live-chat-membership-item-renderer"),
    ).toHaveLength(0);
    // ⚠ `#author-name` は警告に出るが `#card` は出ない（総称 id を入れない判断の帰結）。
    expect(
      rewriteSelectors("#author-name.yt-live-chat-author-chip{a:b}").unmatched,
    ).toEqual(["#author-name"]);
    expect(
      rewriteSelectors("#card.yt-live-chat-membership-item-renderer{a:b}")
        .unmatched,
    ).toEqual([]);
  });
});

/**
 * 060a/060f: **安定クラス契約が「ソース文字列に在る」だけでなく「実際にレンダリングされる」こと。**
 *
 * ⚠⚠ 静的ガード **(10-a)** は `CommentList.tsx` の**ソースを grep している**だけなので、
 * 「クラス名は書かれているが、その分岐が実際には描かれない」状態を検出できない
 * （(10-a) 自身の docstring が「実際に DOM に付くことはランタイムのテストが殺す」と役割分担を宣言している）。
 * ここがその「ランタイムのテスト」の受け皿である。**消さないこと。**
 */
describe("060a/060f: 安定クラス契約が実際にレンダリングされる", () => {
  /** ⚠ `sd-overlay` は `OverlayApp` の持ち物なので入れない（(10-d) と `OverlayApp.test.tsx` の担当）。 */
  // ⚠⚠ 060f 追修正④(2026-08-08): 契約は **chat だけのもの**になった。落としたのは 4 つ——
  //   `sd-comment-tip` / `sd-comment-in-tip`（課金カードを的から外した）と、
  //   `sd-comment-amount` / `sd-comment-event`（**課金カードにしか出ない要素**なので一緒に消える）。
  //   ⚠ ガードの `STABLE_CLASSES` と**必ず同じ内容に保つこと**（片方だけ足すと (10-a) か本テストが落ちる）。
  const CONTRACT = [
    "sd-comment",
    "sd-comment-chat",
    "sd-comment-name",
    "sd-comment-source",
    "sd-comment-icon",
    "sd-comment-header",
    "sd-comment-row",
    "sd-comment-body",
    "sd-comment-text",
    "sd-comment-list",
    "sd-comment-in-chat",
  ];

  it("契約の全クラスが overlay の DOM に 1 つ以上出る", () => {
    const container = renderOverlay();
    const missing = CONTRACT.filter(
      (cls) => container.querySelectorAll(`.${cls}`).length === 0,
    );
    expect(missing).toEqual([]);
  });
});

/**
 * 060f 追修正②(2026-08-08): **既定意匠のリセット（`overlayThemeReset.ts`）の当て先が実 DOM に当たること。**
 *
 * リセットは「テーマを当てたら StreamDock の既定の吹き出しを引っ込める」ための固定文字列だが、
 * ⚠ **当て先クラスを 1 文字打ち間違えても、CSS は何のエラーも出さずただ効かない**
 * （＝テーマを当てても既定の吹き出しが残る＝差し戻しの症状にそのまま戻る）。
 * その退行を殺せるのはここだけである（静的ガード (10-m) は「リセットを通しているか」しか見ない）。
 *
 * ⚠ jsdom で見られるのは**当たるかどうか**まで。「レイヤーに勝てているか」はカスケードの解決なので
 * 見られない＝ (10-m) と実機確認の担当。
 */
describe("060f 追修正②: 既定意匠リセットの当て先が実 DOM に当たる", () => {
  /**
   * `:where(X)` / `:where(X)::before` から当て先 `X` を取り出す。
   * ⚠ 疑似要素は `querySelectorAll` では決して当たらないので落とす（当て先の**要素**が在るかを見たい）。
   */
  const bare = (sel: string): string =>
    sel
      .trim()
      .replace(/^:where\(/, "")
      .replace(/\)(::[a-z-]+)?$/, "");

  /** リセットの全セレクタ（カンマ束ねを展開）。 */
  const RESET_SELECTORS = DEFAULT_DECORATION_RESET.split("}")
    .filter((chunk) => chunk.includes("{"))
    .flatMap((chunk) => chunk.slice(0, chunk.indexOf("{")).split(","))
    .map((s) => s.trim())
    .filter((s) => s !== "");

  it("⚠⚠ リセットの当て先はすべてオーバーレイの DOM に 1 つ以上当たる", () => {
    const container = renderOverlay();
    expect(RESET_SELECTORS.length).toBeGreaterThan(0);
    const dead = RESET_SELECTORS.filter(
      (sel) => container.querySelectorAll(bare(sel)).length === 0,
    );
    expect(dead).toEqual([]);
  });

  /**
   * ⚠⚠⚠ **リセットの当て先も課金カードに 1 つも当たらない**（060f 追修正④・2026-08-08）。
   *
   * 追修正③まではリセットの一部（`:where(.sd-comment){position:relative}` と
   * `:where(.sd-comment-body)::before/::after{all:unset}`）が**課金カードにも当たっていた**
   * ——「課金カードには既定の疑似要素が無いので無害」という判断だったが、
   * **無害であることと、当て先が chat に閉じていることは別**である。
   * 課金カードをユーザー CSS から切り離した以上、StreamDock 自身が注入するリセットも同じ線の内側に置く。
   * ＝「スパチャのデザインは常に同じ」を、テーマ経由だけでなく**リセット経由でも**保証する。
   */
  it("⚠⚠⚠ リセットの当て先はどれも課金カードに当たらない（060f 追修正④）", () => {
    const container = renderOverlay();
    const chat = container.querySelector<HTMLElement>(".sd-comment-chat");
    const tips = tipItems(container);
    expect(chat).not.toBeNull();
    expect(tips).toHaveLength(2);

    const leaked: string[] = [];
    for (const sel of RESET_SELECTORS) {
      const target = bare(sel);
      // chat には当たる（当て先が実在することは上のテストが見ている）。
      expect(hits(chat as HTMLElement, target)).toBeGreaterThan(0);
      if (tips.reduce((n, li) => n + hits(li, target), 0) > 0) {
        leaked.push(sel);
      }
    }
    expect(leaked).toEqual([]);

    // 装飾を落とすルールは chat の吹き出し 1 枚だけを狙っていること（起票理由①へ戻さない）。
    const sel = ".sd-comment-body.sd-comment-in-chat";
    expect(DEFAULT_DECORATION_RESET).toContain(`:where(${sel})`);
    expect(hits(chat as HTMLElement, sel)).toBe(1);
  });

  /**
   * ⚠ すき間の当て先は `<li>` そのもの（`--icon-gap` を宣言している要素＝ `.item`）。
   * 中の要素（`.sd-comment-in-chat`）へ当てても、`.item` の宣言には届かない。
   */
  it("⚠ --sd-icon-gap の当て先は chat の <li> 自身", () => {
    const container = renderOverlay();
    expect(DEFAULT_DECORATION_RESET).toContain(
      ":where(.sd-comment-chat){--sd-icon-gap:",
    );
    const li = container.querySelectorAll(".sd-comment-chat");
    expect(li).toHaveLength(1);
    expect(li[0].tagName).toBe("LI");
  });

  /**
   * ⚠ 060f 追修正④: `sd-comment-body` そのものが **chat の吹き出しにしか付かなくなった**
   * （課金カードのボディは意匠クラス `.cardBody` だけを持つ）。
   * ＝ リセットが `.sd-comment-body` とだけ書いても課金カードには届かないが、
   * **それに頼らず当て先へ `-in-chat` を明記している**（上のテスト）。二重の担保。
   */
  it("sd-comment-body は chat の吹き出しだけに付く（課金カードのボディには付かない）", () => {
    const container = renderOverlay();
    const chat = container.querySelector<HTMLElement>(".sd-comment-chat");
    const tips = tipItems(container);
    expect(hits(chat as HTMLElement, ".sd-comment-body")).toBe(1);
    expect(tips.reduce((n, li) => n + hits(li, ".sd-comment-body"), 0)).toBe(0);
    // 課金カードのボディは DOM としては在る（消えていない）。
    expect(tips.every((li) => li.children.length >= 1)).toBe(true);
  });
});
