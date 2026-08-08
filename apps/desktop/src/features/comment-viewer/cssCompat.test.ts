import { describe, it, expect } from "vitest";
import { rewriteSelectors, SELECTOR_TABLE } from "./cssCompat";

/**
 * 060a: セレクタ変換表（`cssCompat.ts`）の仕様テスト。
 *
 * 仕様（こうあるべき）— `cssCompat.ts` の docstring が正:
 * - 既知の純正チャットセレクタは `sd-` 語彙へ書き換わる（**長い順**・**単語境界付き**）
 * - 変換できなかったセレクタは**消さずにそのまま残り**、純正チャット由来と断定できるものだけ `unmatched` に載る
 * - `rewritten` は**ルール単位**（`{ … }` 1 つにつき最大 1 件）
 * - `@import` / `url()` / 宣言部 / 文字列 / コメントの中身は**一切変更しない**（060b / 060c の責務）
 * - **冪等**（060d が注入のたびに毎回呼ぶ）
 *
 * ⚠ **`YOUTUBE_SAMPLE` / `TWITCH_SAMPLE` は依頼者の実サンプル CSS を逐語で入れてある**（2026-08-04 受領）。
 * ⚠ **この 2 本には意匠がほとんど入っていない**——実体は冒頭の外部 `@import`（ruri.info）の中で、
 * ここにあるのは書体の指定と、その外部 CSS が読む `--txtcolor` の 2 つだけ。つまり
 * **本サンプルは「変換表が実サンプルを通せるか」は答えるが、「セレクタ契約が意匠を作るのに足りるか」は
 * 答えていない**（それを答えるには外部 CSS の中身が要る＝060c の領分）。詳細は progress.md 060a 節。
 * → 表の残りのエントリは下の `*_EXTENDED`（想定形）で網羅する。
 *
 * 再修正トリガー: 変換表にエントリを足す／`unmatched` の判定（`FOREIGN_SELECTOR_RE`）を広げるときは、
 * 「ユーザーが自分で sd 語彙に沿って書いた CSS で `unmatched` が空のまま」（下の最後のケース）が
 * 落ちないことを必ず確認する。ここが崩れると警告がノイズに埋もれて誰も読まなくなる。
 */

/** 依頼者の実サンプル（YouTube 用・逐語）。⚠ 意匠の実体は外部 @import の中にある。 */
const YOUTUBE_SAMPLE = `@import url("https://ruri.info/tool/css/midashi1Comment.css");
yt-live-chat-text-message-renderer #message,
yt-live-chat-text-message-renderer #message * {
font-family: "M PLUS 1p", sans-serif;}
:root{
--txtcolor:#555555;
}
`;

/** 依頼者の実サンプル（Twitch 用・逐語）。 */
const TWITCH_SAMPLE = `@import url("https://ruri.info/tool/css/twmidashi1Comment.css");
.chat-line__no-background{
font-family: "M PLUS 1p", sans-serif;}
:root{
--txtcolor:#555555;
}
`;

/** 想定形。実サンプルが触れていない変換表のエントリを網羅するために置く（実サンプルではない）。 */
const YOUTUBE_EXTENDED = `yt-live-chat-text-message-renderer {
  font-family: "Zen Kaku Gothic Antique", sans-serif;
}
yt-live-chat-text-message-renderer #author-name {
  font-weight: 700;
}
yt-live-chat-paid-message-renderer {
  border-radius: 12px;
}
yt-live-chat-paid-sticker-renderer {
  display: none;
}
`;

/** 想定形（実サンプルではない）。 */
const TWITCH_EXTENDED = `.chat-line__message {
  padding: 8px 12px;
}
.chat-line__message-body {
  font-size: 20px;
}
.chat-author__display-name {
  font-weight: 800;
}
.chat-line__timestamp {
  display: none;
}
`;

describe("SELECTOR_TABLE", () => {
  it("変換先はすべて sd- 語彙のクラスセレクタ（複合セレクタも可）", () => {
    for (const rule of SELECTOR_TABLE) {
      expect(rule.to.startsWith(".sd-")).toBe(true);
      // 060f: 複合セレクタ（`.sd-comment-text.sd-comment-in-chat`）を許すので、トークン単位でも
      // sd 語彙だけであることを見る（check-css-guards.mjs (10-b) と同じ抜き方）。
      for (const m of rule.to.matchAll(/\.([A-Za-z0-9_-]+)/g)) {
        expect(m[1].startsWith("sd-")).toBe(true);
      }
    }
  });

  /**
   * 060f: **窓ルート（`.sd-overlay`）は意図的に変換先に入っている。**
   * 060a 時点は「060d のプレビューは全セレクタへ `.sd-preview` を前置するので窓ルートは当たらなくなる」を
   * 理由に禁じており、ここには `expect(rule.to).not.toContain("sd-overlay")` があった。
   * ⚠ その前提は **060d が `.sd-overlay` を `.sd-preview` へ読み替える実装（`cssScope.ts` の
   * `ROOT_LIKE_CS`）を入れた時点で解消済み**で、読み替えが効くことは `cssScope.test.ts` が固定している。
   * ＝ **禁止を外したのは意図した仕様変更**であって、うっかり緩めたのではない。
   */
  it("窓ルート（.sd-overlay）を向くエントリがあり、プレビュー側の読み替えとセットで成立している", () => {
    const roots = SELECTOR_TABLE.filter((r) => r.to === ".sd-overlay");
    expect(roots.map((r) => r.from)).toEqual([
      "yt-live-chat-app",
      "yt-live-chat-renderer",
    ]);
  });

  it("元セレクタに sd- 語彙を書かない（自分の出力に当たると冪等性が壊れる）", () => {
    for (const rule of SELECTOR_TABLE) {
      expect(rule.from).not.toContain("sd-");
    }
  });
});

/**
 * 060f: **変換表の向き先そのもの**を 1 件ずつ固定する。
 *
 * ⚠⚠ ここが 060f の芯である。`.sd-comment` は chat と課金の**両方**に付くので、
 * YouTube / Twitch の「テキストコメント**専用**」セレクタをそこへ向けていると
 * **chat 用に書かれたテーマが課金カードの意匠を壊す**（2026-08-05 の実測で判明した「論外」の 1 つ目）。
 * 表を `.sd-comment` へ戻す変異はここで落ちる。
 *
 * ⚠ 逆に**限定しすぎ**も壊れる（`yt-img-shadow` は chat と課金の共有要素で、
 * 限定すると「絶対に当たらないセレクタ」を生む）。だから据え置き側も個別に固定する。
 * ⚠⚠ **`div#author-info` は 060c 追修正(2026-08-09)で表から削除した**（初版のこのコメントは
 * 「chat と課金の共有要素」と書いていたが、**YouTube のテキストコメントに `#author-info` は無い**
 * ＝あれは課金カードのヘッダで、読み自体が誤っていた）。下に「表に無いこと」を固定するテストがある。
 */
describe("SELECTOR_TABLE — 060f の向き先（chat 限定 / 据え置き / 新規）", () => {
  const to = (from: string) => SELECTOR_TABLE.find((r) => r.from === from)?.to;

  it("chat 専用セレクタは 8 件とも chat 専用クラスへ向く", () => {
    expect(to("yt-live-chat-text-message-renderer")).toBe(".sd-comment-chat");
    expect(to("yt-live-chat-text-message-renderer #message")).toBe(
      ".sd-comment-text.sd-comment-in-chat",
    );
    expect(to("yt-live-chat-text-message-renderer #author-name")).toBe(
      ".sd-comment-name.sd-comment-in-chat",
    );
    expect(to("yt-live-chat-text-message-renderer #img")).toBe(
      ".sd-comment-icon.sd-comment-in-chat",
    );
    expect(to(".chat-line__message")).toBe(".sd-comment-chat");
    expect(to(".chat-line__message-body")).toBe(
      ".sd-comment-text.sd-comment-in-chat",
    );
    expect(to(".chat-line__no-background")).toBe(".sd-comment-chat");
    expect(to(".chat-author__display-name")).toBe(
      ".sd-comment-name.sd-comment-in-chat",
    );
  });

  /**
   * ⚠⚠⚠ **060f 追修正④(2026-08-08・本人決定): 課金カードを狙うエントリは表に置かない。**
   *
   * 削除したのは 3 件（`yt-live-chat-paid-message-renderer` / 同 `#message` /
   * `.yt-live-chat-membership-item-renderer`）。理由は**課金カードをユーザー CSS の的から外した**こと
   * （`CommentList.tsx` の課金分岐・静的ガード (10-o)）——変換先が DOM に存在しないので、残すと
   * `rewritten` だけ加算されて当たらない＝ (10-b) が「最悪」と呼ぶ状態になる。
   *
   * ⚠⚠ **戻さないこと。** OBS 用に配られているテーマは
   * `yt-live-chat-paid-message-renderer{display:none!important}` を書くのが定番で、変換すると
   * **StreamDock の課金カードが丸ごと消える**（2026-08-08 実機で発生）。
   */
  it("⚠⚠⚠ 課金カードを狙うエントリは 1 件も無い（060f 追修正④）", () => {
    for (const from of [
      "yt-live-chat-paid-message-renderer",
      "yt-live-chat-paid-message-renderer #message",
      ".yt-live-chat-membership-item-renderer",
    ]) {
      expect(to(from)).toBeUndefined();
    }
    // `to` の側にも課金の語彙が残っていないこと。
    for (const rule of SELECTOR_TABLE) {
      expect(rule.to).not.toContain("sd-comment-tip");
      expect(rule.to).not.toContain("sd-comment-in-tip");
    }
  });

  it("⚠ 共有要素は目印を付けない（実際に当たるのは chat だけ）", () => {
    // ⚠⚠ YouTube では chat と課金の**両方**に出る共有要素。StreamDock 側は課金カードが的でないので
    //   目印なしでも chat のアイコンにしか当たらない（`CommentList.selectorContract.test.tsx` が実 DOM で固定）。
    expect(to("yt-img-shadow")).toBe(".sd-comment-icon");
    expect(to("yt-img-shadow")).not.toContain("sd-comment-in-chat");
  });

  it("新規エントリが入っている", () => {
    expect(to(".yt-live-chat-author-chip")).toBe(
      ".sd-comment-name.sd-comment-in-chat",
    );
    expect(to("yt-live-chat-app")).toBe(".sd-overlay");
    expect(to("yt-live-chat-renderer")).toBe(".sd-overlay");
    expect(to("yt-live-chat-item-list-renderer #items")).toBe(
      ".sd-comment-list",
    );
  });

  /**
   * ⚠⚠ **060c 追修正(2026-08-09・実機不具合): `div#author-info` を表に戻さないこと。**
   *
   * YouTube の `#author-info` は**課金カード（paid renderer）のヘッダ**で、**テキストコメントには無い**。
   * 実テーマは `#author-info{padding:8px 16px!important}` を書きつつ課金カードごと `display:none` に
   * するので **YouTube では 1 度も効かない**が、StreamDock では chat の名前行に当たり、
   * 同じテーマが名前（`.yt-live-chat-author-chip`）を消すため
   * **中身が空なのに padding だけ残る 16px の帯**が全コメントに挿さっていた（実機で確認）。
   * ⚠ `.sd-comment-header` は安定クラス契約としては残る（ユーザーは直接書ける）。
   */
  it("⚠⚠ div#author-info は変換表に無い（課金カードのヘッダなので chat へ向けない）", () => {
    expect(to("div#author-info")).toBeUndefined();
    expect(SELECTOR_TABLE.some((r) => r.from.includes("author-info"))).toBe(
      false,
    );
  });

  /**
   * ⚠⚠ 060f 追修正③(2026-08-08): **クラス形のコメント 1 件**。依頼者の実サンプルの**看板デザイン**
   * （吹き出し左端の縦バー）が `.yt-live-chat-text-message-renderer::before` で書かれており、
   * **変換も警告もされずに黙って消えていた**（実機で確認）。YouTube の Polymer は同名のクラスを
   * 子孫にも撒くので、実テーマではこの形が頻出する。
   */
  it("⚠⚠ クラス形のコメント 1 件も変換する（実サンプルの縦バー）", () => {
    expect(to(".yt-live-chat-text-message-renderer")).toBe(".sd-comment-chat");
    // 実サンプルの書き方そのもの（疑似要素付き）。
    expect(
      rewriteSelectors(".yt-live-chat-text-message-renderer::before{content:''}")
        .css,
    ).toBe(".sd-comment-chat::before{content:''}");
    // ⚠ 要素形（別エントリ）も従来どおり。長い順ソートでクラス形が先に当たるので取り違えない。
    expect(to("yt-live-chat-text-message-renderer")).toBe(".sd-comment-chat");
    expect(to("yt-live-chat-text-message-renderer #message")).toBe(
      ".sd-comment-text.sd-comment-in-chat",
    );
  });

  /**
   * ⚠⚠ **要素形とクラス形で別エントリが要る理由の回帰テスト。**
   * 要素形の前方境界 `(?<![A-Za-z0-9_.#-])` は `.` を弾く。弾かないと `.yt-…` の `.` が残って
   * **`..sd-comment-chat` という壊れたセレクタ**になる（境界を緩める修正をしたらここが落ちる）。
   */
  it("⚠⚠ クラス形を変換しても `..` の壊れたセレクタにならない", () => {
    const convert = (sel: string) => {
      const css = rewriteSelectors(`${sel}{a:b}`).css;
      return css.slice(0, css.indexOf("{"));
    };
    for (const from of [
      ".yt-live-chat-text-message-renderer",
      ".yt-live-chat-author-chip",
      ".yt-live-chat-membership-item-renderer",
    ]) {
      expect(convert(from)).not.toContain("..");
    }
    // 要素形とクラス形が混在した実テーマの形でも壊れない。
    expect(
      convert("yt-live-chat-app .yt-live-chat-text-message-renderer::before"),
    ).toBe(".sd-overlay .sd-comment-chat::before");

    // ⚠ **既知の取りこぼし（060c 送り・欠陥ではない）**: 祖先が**クラス形**だと
    // `…renderer #message` の**祖先付きエントリのほうが当たらない**（要素形の前方境界が `.` を弾くため）。
    // 残った裸 `#message` は StreamDock に無いので当たらないが、⚠ **`unmatched` には出る**ので
    // 「黙って効かない」にはならない（それがこの形を放置してよい理由）。
    expect(
      convert(".yt-live-chat-text-message-renderer #message"),
    ).toBe(".sd-comment-chat #message");
    expect(
      rewriteSelectors(".yt-live-chat-text-message-renderer #message{a:b}")
        .unmatched,
    ).toEqual(["#message"]);
  });

  it("⚠⚠ body / html / :root は変換表に無い（窓の透過が壊れる）", () => {
    for (const rule of SELECTOR_TABLE) {
      expect(["body", "html", ":root"]).not.toContain(rule.from);
    }
  });
});

/**
 * 060f 追修正④(2026-08-08): **課金カードを狙う指定は「未変換のまま残って警告に出る」のが正しい姿。**
 *
 * 課金カードをユーザー CSS の的から外した（`CommentList.tsx` の課金分岐・(10-o)）ので、
 * `yt-live-chat-paid-message-renderer` 系は**変換しない**。⚠ 変換して当たらない形にするより、
 * 未変換で `unmatched` に出したほうが「効きません」とユーザーに見える＝ (10-b) の言う最悪を避けられる。
 */
describe("rewriteSelectors — 課金カードを狙う指定は変換しない（未変換のまま警告へ）", () => {
  it("⚠⚠ 配布テーマの定番『スーパーチャット非表示』が課金カードに届かない", () => {
    // これが変換されると `.sd-comment-tip{display:none}` になり、**課金カードが丸ごと消える**（実機で発生）。
    const r = rewriteSelectors(
      "yt-live-chat-paid-message-renderer,\nyt-live-chat-paid-sticker-renderer{display:none !important}",
    );
    expect(r.css).toContain("yt-live-chat-paid-message-renderer");
    expect(r.css).not.toContain("sd-comment");
    expect(r.rewritten).toBe(0);
    // ⚠ 未変換だが**警告には出る**（`yt-` 接頭辞を FOREIGN_SELECTOR_RE が拾う）＝黙って効かないではない。
    expect(r.unmatched).toContain("yt-live-chat-paid-message-renderer");
  });

  it("⚠ メンバーシップ非表示（クラス形）も変換しない", () => {
    const r = rewriteSelectors(
      ".yt-live-chat-membership-item-renderer{display:none !important}",
    );
    expect(r.css).toBe(
      ".yt-live-chat-membership-item-renderer{display:none !important}",
    );
    expect(r.rewritten).toBe(0);
  });

  it("共有要素は chat の下でだけ当たる形へ変換される", () => {
    expect(
      rewriteSelectors("yt-live-chat-text-message-renderer yt-img-shadow{a:b}")
        .css,
    ).toBe(".sd-comment-chat .sd-comment-icon{a:b}");
    // ⚠ 課金側の祖先は未変換のまま残るので、合成されても StreamDock の DOM には当たらない。
    expect(
      rewriteSelectors("yt-live-chat-paid-message-renderer yt-img-shadow{a:b}")
        .css,
    ).toBe("yt-live-chat-paid-message-renderer .sd-comment-icon{a:b}");
  });

  /**
   * 060c 追修正: `div#author-info` は**変換されず、`unmatched` に出る**（黙って効かないを作らない）。
   * ⚠ 警告に出すために `FOREIGN_ID_NAMES` へ `author-info` を足してある。
   */
  it("div#author-info は変換されず「効かないセレクタ」として警告に出る", () => {
    const r = rewriteSelectors("div#author-info{a:b}");
    expect(r.css).toBe("div#author-info{a:b}");
    expect(r.rewritten).toBe(0);
    expect(r.unmatched).toEqual(["#author-info"]);
  });

  /**
   * 060f: **変換先が複合セレクタになっても冪等**（060d は注入とプレビューのたびに毎回呼ぶ）。
   * 担保しているのは「`from` に sd 語彙を書かない」ことだけで、静的ガード (10-c) が固定している。
   * ⚠ 長い順ソートも新エントリで効いていること（`…paid-message-renderer #message` が
   * `…paid-message-renderer` 単体に食われない）を同時に見る。
   */
  it("複合セレクタでも冪等で、長い順ソートが新エントリでも効く", () => {
    const inputs = [
      "yt-live-chat-text-message-renderer #message{a:b}",
      "yt-live-chat-item-list-renderer #items{a:b}",
      ".chat-line__message-body{a:b}",
      "yt-live-chat-app{a:b}",
    ];
    for (const css of inputs) {
      const once = rewriteSelectors(css);
      const twice = rewriteSelectors(once.css);
      expect(once.rewritten).toBe(1);
      expect(twice.css).toBe(once.css);
      expect(twice.rewritten).toBe(0);
      // 祖先だけ変換されて裸 id が残る形になっていないこと（＝食われていない）。
      expect(once.css).not.toContain("#");
    }
  });
});

/**
 * 060f の**完了条件そのもの**を 1 本で見るテスト。
 * 「`unmatched` に残るのは StreamDock に対応物が無いものだけ」を、YouTube 純正チャット向けテーマの
 * 典型形（吹き出し＋画面部品の非表示）で固定する。
 *
 * ⚠ **依頼者の実サンプルそのものではない**——実サンプルの意匠の実体は第三者サイトの外部 CSS の中にあり、
 * リポジトリへは URL しか持ち込んでいない（060a の判断）。ここにあるのは docs に残る内訳
 * （変換 10 / 未変換 20・うち 6 が 060f で追加した分・14 は対応物なし）から組んだ**等価な再構成**である。
 */
describe("rewriteSelectors — YouTube テーマの典型形で unmatched が「対応物なし」だけになる", () => {
  const THEME = `yt-live-chat-app { background: transparent }
yt-live-chat-renderer { font-family: "M PLUS 1p" }
yt-live-chat-item-list-renderer #items { padding: 4px }
yt-live-chat-text-message-renderer { margin: 6px 0 }
yt-live-chat-text-message-renderer #message { background: #fff; border-radius: 14px }
yt-live-chat-text-message-renderer #message:before { content: "" }
yt-live-chat-text-message-renderer #author-name { font-weight: 700 }
yt-live-chat-text-message-renderer #img { border-radius: 50% }
yt-img-shadow { width: 44px }
div#author-info { margin-left: 56px }
.yt-live-chat-author-chip { color: #333 }
yt-live-chat-paid-message-renderer { border-radius: 12px }
.yt-live-chat-membership-item-renderer { border-radius: 12px }
yt-live-chat-header-renderer { display: none }
yt-live-chat-message-input-renderer { display: none }
yt-live-chat-ticker-renderer { display: none }
#chat-badges { display: none }
#timestamp { display: none }
`;

  it("StreamDock に対応物があるものは全部変換され、残るのは画面部品と課金カードだけ", () => {
    const r = rewriteSelectors(THEME);
    // 10 ルールが変換される。
    // ⚠ 060f 追修正④: 課金カードの 2 ルール（paid-message / membership）は**変換しない**ので、
    //   変換数が 13 → 11 に減り、`unmatched` に paid-message が 1 件増えた（クラス形の membership は
    //   `.yt-` 接頭辞のため従来どおり `unmatched` にも載らない）。
    // ⚠ 060c 追修正(2026-08-09): `div#author-info` を表から削除したので 11 → 10 へ減り、
    //   代わりに `#author-info` が `unmatched` に出る（`FOREIGN_ID_NAMES` へ足したため。
    //   ＝ 黙って効かない状態にはしていない）。
    expect(r.rewritten).toBe(10);
    expect(r.unmatched).toEqual([
      "#author-info",
      "yt-live-chat-paid-message-renderer",
      "yt-live-chat-header-renderer",
      "yt-live-chat-message-input-renderer",
      "yt-live-chat-ticker-renderer",
      "#chat-badges",
      "#timestamp",
    ]);
    // ⚠⚠ 060f の芯: chat 用の指定が課金カード（`.sd-comment`）へ落ちていないこと。
    expect(r.css).toContain(".sd-comment-text.sd-comment-in-chat {");
    expect(r.css).not.toMatch(/(?<![A-Za-z0-9_-])\.sd-comment(?![A-Za-z0-9_-])/);
    // ⚠⚠ 060f 追修正④の芯: 課金カードを狙う 2 本が**素通り**していること
    //   （変換すると `.sd-comment-tip` になり、`display:none` 系のテーマでカードが消える）。
    expect(r.css).toContain("yt-live-chat-paid-message-renderer {");
    expect(r.css).toContain(".yt-live-chat-membership-item-renderer {");
    expect(r.css).not.toContain("sd-comment-tip");
  });

  it("2 回通しても同じ（注入のたびに毎回走る）", () => {
    const once = rewriteSelectors(THEME);
    const twice = rewriteSelectors(once.css);
    expect(twice.css).toBe(once.css);
    expect(twice.rewritten).toBe(0);
    expect(twice.unmatched).toEqual(once.unmatched);
  });
});

/**
 * 060f: ⚠⚠ **`body` は変換もされないし `unmatched` にも載らない。**
 *
 * 060f のタスクファイルは当初「`body` が `unmatched` に出ることを期待どおりとして固定する」と
 * 書いていたが、**実装と食い違っていた**（実測で判明・タスクファイル側を訂正した）。
 * `FOREIGN_SELECTOR_RE` は**接頭辞ベース**（`ytd?-` / `.chat-` / `.tw-` / `[data-a-target…]` ＋
 * `FOREIGN_ID_NAMES` の列挙）で、「sd 語彙でない全セレクタ」を載せる設計では**ない**
 * （載せると `:root` や `body` で警告がノイズに埋もれて誰も読まなくなる——060a の判断）。
 *
 * ＝ **「変換表に足さなかったものは警告で気付ける」は成り立たない。** `body` を足さない判断を
 * 守っているのは `cssCompat.ts` のコメントと本テストだけである。**消さないこと。**
 */
describe("rewriteSelectors — body は変換しない（窓の透過を壊さない）", () => {
  const untouched: [label: string, css: string][] = [
    ["body 単独", "body{background:#000}"],
    ["html, body の束ね", "html,body{margin:0}"],
    [":root", ":root{--txtcolor:#555}"],
    ["body の子孫", "body .something{color:red}"],
  ];

  for (const [label, css] of untouched) {
    it(`${label} — 出力が 1 バイトも変わらず、警告にも載らない`, () => {
      const r = rewriteSelectors(css);
      expect(r.css).toBe(css);
      expect(r.rewritten).toBe(0);
      // ⚠ ここが「出る」に変わったら、それは FOREIGN_SELECTOR_RE を広げた変更＝
      // 060a の「警告をノイズにしない」判断を覆している。意図的なら本テストごと書き換えること。
      expect(r.unmatched).toEqual([]);
    });
  }
});

/**
 * 060f 追修正（security-review Q-1・2026-08-06）: ⚠⚠⚠ **`to` は「1 要素の複合セレクタ」だけ。**
 *
 * 060f の初版は `to` を**子孫セレクタ**（`.sd-comment-chat .sd-comment-text`）にしていたため、
 * ユーザー CSS が `親 子孫` / `span.クラス` の形で書かれていると**前置が二重に積まれて
 * 永久に当たらないセレクタ**になっていた（`.sd-comment-chat .sd-comment-chat .sd-comment-text`
 * ＝ `<li>` の中に `<li>` が要る）。⚠ しかも `rewritten` は**加算され** `unmatched` は**空**なので、
 * 060d の UI は「M 個のルールを変換しました」と**誤報していた**（3 件は 060f 以前は効いていた＝回帰）。
 *
 * → 限定を **`sd-comment-in-chat` / `sd-comment-in-tip` の同一要素の目印**で表す形に変え、
 * 合成しても構造が保存されるようにした。**ここが直ったことの証拠がこの describe である。**
 * ⚠ 対になる機械的な担保は `check-css-guards.mjs` の **(10-l)**（`to` に結合子を禁じる）と、
 * 下の**全順序対の総当たり**。**3 つとも消さないこと。**
 */
describe("rewriteSelectors — 合成しても構造が保存される（複合 to の二重前置が起きない）", () => {
  const out = (sel: string) => rewriteSelectors(`${sel}{a:b}`);

  it("親 子孫 形（Twitch テーマの定型）が当たる形へ変換される", () => {
    // ⚠ 初版: `.sd-comment-chat .sd-comment-chat .sd-comment-text`（永久に当たらない）。
    expect(out(".chat-line__message .chat-line__message-body").css).toBe(
      ".sd-comment-chat .sd-comment-text.sd-comment-in-chat{a:b}",
    );
    expect(out(".chat-line__message .chat-author__display-name").css).toBe(
      ".sd-comment-chat .sd-comment-name.sd-comment-in-chat{a:b}",
    );
    // 子結合子でも同じ（`from` は `\s+` と `>` の両方に当たる）。
    expect(out(".chat-line__message > .chat-line__message-body").css).toBe(
      ".sd-comment-chat > .sd-comment-text.sd-comment-in-chat{a:b}",
    );
  });

  it("型セレクタ + クラスの複合が「1 要素」のまま保たれる", () => {
    // ⚠ 初版: `span.sd-comment-chat .sd-comment-name`（名前 <span> に当たらなくなっていた）。
    expect(out("span.chat-author__display-name").css).toBe(
      "span.sd-comment-name.sd-comment-in-chat{a:b}",
    );
    expect(out("#author-name.yt-live-chat-author-chip").css).toBe(
      "#author-name.sd-comment-name.sd-comment-in-chat{a:b}",
    );
  });

  it("⚠ 課金カードの本文は変換しない（060f 追修正④で的から外した）", () => {
    // 素通り＝ StreamDock の課金カードには当たらない（そもそも安定クラスが無い）。
    expect(out("yt-live-chat-paid-message-renderer #message").css).toBe(
      "yt-live-chat-paid-message-renderer #message{a:b}",
    );
    // chat 側は従来どおり 1 要素の複合へ畳まれる。
    expect(out("yt-live-chat-text-message-renderer #message").css).toBe(
      ".sd-comment-text.sd-comment-in-chat{a:b}",
    );
  });

  /**
   * ⚠⚠ **これが Q-1 の再発防止の本体**（静的ガード (10-l) と対）。
   *
   * 見ているのは「**複合セレクタの個数が保存される**」——`to` が 1 要素だけを指しているなら、
   * 元セレクタの複合が N 個なら変換後も N 個になる。初版の欠陥はここで落ちていた
   * （`.chat-line__message .chat-line__message-body` は元が 2 個なのに
   * `.sd-comment-chat .sd-comment-chat .sd-comment-text` ＝ **3 個**になっていた
   * ＝ `to` が「自分以外の要素（祖先）」を語っていた証拠）。
   *
   * ⚠⚠ **「同じクラストークンが重複しないこと」を見てはいけない**（実測で 28 件の誤検出）。
   * 目印クラス（`sd-comment-in-chat`）は**同じ chat の中の 2 要素なら当然両方に付く**ので、
   * `#message #author-name` → `.sd-comment-text.sd-comment-in-chat .sd-comment-name.sd-comment-in-chat`
   * のように重複するのが**正しい**。そもそもこの入力は純正チャット側でも当たらない（`#author-name` は
   * `#message` の中に無い）ので、変換の問題ではない。**ここを締めすぎると正しいコードで落ちる。**
   */
  it("⚠⚠ 全順序対を合成しても、複合セレクタが 1 エントリ 1 個のまま増えない", () => {
    /** セレクタを結合子で切って複合の個数を数える（`*` や型セレクタも 1 個として数える）。 */
    const compounds = (sel: string) =>
      sel
        .trim()
        .split(/\s*>\s*|\s+/)
        .filter((t) => t !== "").length;

    // 単体: `to` は必ず**ちょうど 1 個の複合**（静的ガード (10-l) と同じ不変条件をここでも押さえる）。
    // ⚠ 初版の子孫 to は 7 件がここで落ちる（実測）。
    for (const rule of SELECTOR_TABLE) {
      expect(compounds(rule.to)).toBe(1);
    }

    // 全順序対: 2 エントリを子孫でつないだら、変換後も**ちょうど 2 個**。
    // ⚠ 初版の子孫 to では 3 個になっていた（＝祖先が 1 個余分に生える＝ Q-1 の欠陥そのもの）。
    // ⚠ 元セレクタ側の複合数と比べてはいけない——`renderer #message`（2 個）が 1 要素へ畳まれるのは
    // **この表の目的そのもの**なので、元と比べる検査は正しいコードで落ちる（実測 145 件）。
    const broken: string[] = [];
    for (const a of SELECTOR_TABLE) {
      for (const b of SELECTOR_TABLE) {
        const css = rewriteSelectors(`${a.from} ${b.from}{x:y}`).css;
        const got = css.slice(0, css.indexOf("{"));
        if (compounds(got) !== 2) {
          broken.push(`${a.from} ${b.from} -> ${got} (${compounds(got)})`);
        }
      }
    }
    expect(broken).toEqual([]);
  });
});

describe("rewriteSelectors — 依頼者の実サンプル", () => {
  it("YouTube 実サンプルを丸ごと変換する（カンマ束ね・子孫の * ・@import・:root を含む）", () => {
    const r = rewriteSelectors(YOUTUBE_SAMPLE);
    // ⚠ 060f: 向き先が `.sd-comment-text` から **chat 限定の複合セレクタ**へ変わった
    // （chat 用に書かれたテーマが課金カードに当たらないようにするため）。
    expect(r.css).toBe(`@import url("https://ruri.info/tool/css/midashi1Comment.css");
.sd-comment-text.sd-comment-in-chat,
.sd-comment-text.sd-comment-in-chat * {
font-family: "M PLUS 1p", sans-serif;}
:root{
--txtcolor:#555555;
}
`);
    // カンマ束ねの 2 パートは 1 ルール。`:root` は変換対象ではないので数に入らない。
    expect(r.rewritten).toBe(1);
    // ⚠ `:root` も `--txtcolor` も**警告に載らない**。「sd 語彙でない全セレクタ」を載せる設計だったら
    // ここで `:root` が載り、実サンプルの時点で既に警告がノイズになっていた。
    expect(r.unmatched).toEqual([]);
  });

  it("Twitch 実サンプルを丸ごと変換する", () => {
    const r = rewriteSelectors(TWITCH_SAMPLE);
    expect(r.css)
      .toBe(`@import url("https://ruri.info/tool/css/twmidashi1Comment.css");
.sd-comment-chat{
font-family: "M PLUS 1p", sans-serif;}
:root{
--txtcolor:#555555;
}
`);
    expect(r.rewritten).toBe(1);
    expect(r.unmatched).toEqual([]);
  });

  it("実サンプルを 2 回通しても結果が変わらない（060d は注入のたびに毎回呼ぶ）", () => {
    for (const sample of [YOUTUBE_SAMPLE, TWITCH_SAMPLE]) {
      const once = rewriteSelectors(sample);
      const twice = rewriteSelectors(once.css);
      expect(twice.css).toBe(once.css);
      // 2 周目は書き換える対象がもう無い（変換表の from に sd 語彙が無いことの帰結）。
      expect(twice.rewritten).toBe(0);
      expect(twice.unmatched).toEqual(once.unmatched);
    }
  });
});

describe("rewriteSelectors — 変換表の残りのエントリ（想定形）", () => {
  it("YouTube: 単体 renderer / #author-name を書き換え、課金・未知は残して unmatched に載せる", () => {
    const r = rewriteSelectors(YOUTUBE_EXTENDED);
    expect(r.css).toContain(".sd-comment-chat {");
    expect(r.css).toContain(".sd-comment-name.sd-comment-in-chat {");
    // ⚠ 060f 追修正④: 課金カードは変換しない＝素通りで `unmatched` に出る。
    expect(r.css).toContain("yt-live-chat-paid-message-renderer {");
    expect(r.css).not.toContain("sd-comment-tip");
    // 変換できた 2 ルール（課金 2 本＝ paid-message / paid-sticker は変換表に無い）。
    expect(r.rewritten).toBe(2);
    expect(r.unmatched).toEqual([
      "yt-live-chat-paid-message-renderer",
      "yt-live-chat-paid-sticker-renderer",
    ]);
    // 未知セレクタは**消さずに残す**（消すとユーザーが原因にたどり着けない）。
    expect(r.css).toContain("yt-live-chat-paid-sticker-renderer {");
  });

  it("Twitch: message / message-body / display-name を書き換え、未知は残して unmatched に載せる", () => {
    const r = rewriteSelectors(TWITCH_EXTENDED);
    expect(r.css).toContain(".sd-comment-chat {\n  padding: 8px 12px;");
    expect(r.css).toContain(".sd-comment-text.sd-comment-in-chat {");
    expect(r.css).toContain(".sd-comment-name.sd-comment-in-chat {");
    expect(r.rewritten).toBe(3);
    expect(r.unmatched).toEqual([".chat-line__timestamp"]);
    expect(r.css).toContain(".chat-line__timestamp {");
  });
});

describe("rewriteSelectors — 060b / 060c の責務には触れない", () => {
  it("@import は行ごとそのまま通す（外部参照の除去は 060b の責務）", () => {
    const css = `@import url("https://example.test/theme.css");\n.chat-line__message { color: red }`;
    const r = rewriteSelectors(css);
    expect(r.css).toContain(`@import url("https://example.test/theme.css");`);
    expect(r.css).toContain(".sd-comment-chat { color: red }");
    // @import の中の URL は「効かないセレクタ」ではないので警告に載せない。
    expect(r.unmatched).toEqual([]);
  });

  it("宣言部の url() を書き換えない（外部参照の除去は 060b の責務）", () => {
    const css = `.chat-line__message { background-image: url("https://evil.example/x.png") }`;
    const r = rewriteSelectors(css);
    expect(r.css).toBe(
      `.sd-comment-chat { background-image: url("https://evil.example/x.png") }`,
    );
  });
});

/**
 * 060a: **本 module 最大のセキュリティ不変条件**の網羅テスト（レビューで敵対的入力を通した結果を常設化）。
 *
 * 仕様（`cssCompat.ts` の docstring ／ docs/security.md §1・CSP 方針が正）:
 * - `@import` と `url()` には**触らない**。外部参照の除去は 060b、外部 `@import` のスナップショットは 060c。
 *   **2 か所で同じ入力を触ると、片方だけ緩んだときに気づけない。**
 * - この分離は「セレクタ以外を一切見ない」走査で**構造として**担保されている、というのが設計の主張。
 *
 * ⚠ **読むだけでは走査型スキャナのバグは見つからない。** ここは「壊れたら 060b の除去が
 * 二重処理になる／宣言部が書き換わる」という**壊れ方の分かりにくい**層なので、
 * 実際に敵対的な形を通して押さえる。**ケースを減らさないこと。**
 *
 * 再修正トリガー: `scanPreludes()` の状態遷移（コメント／文字列／宣言ブロック／グループ規則）に
 * 手を入れたら、必ずこの describe 全体を再実行して緑を確認する。
 */
describe("rewriteSelectors — url() / @import に 1 バイトも触れない（敵対的入力）", () => {
  /** CSS 中の `url(…)` トークンを出現順にすべて取り出す。 */
  const urlsOf = (css: string): string[] => css.match(/url\([^)]*\)/g) ?? [];

  /** どのケースも「変換対象のセレクタ」と「触ってはいけない url()」を同時に含む。 */
  const cases: [label: string, css: string][] = [
    [
      "@import（引用符なし）",
      `@import url(http://evil.test/a.css);\n.chat-line__message{color:red}`,
    ],
    [
      "@import（URL の中に波括弧）",
      `@import url(http://evil.test/{}.css);\n.chat-line__message{color:red}`,
    ],
    [
      "@font-face の src",
      `@font-face{font-family:"X";src:url(http://evil.test/f.woff2)}\n.chat-line__message{color:red}`,
    ],
    [
      "宣言部の url（引用符なし）",
      `.chat-line__message{background-image:url(http://evil.test/x.png)}`,
    ],
    [
      "url の中身がセレクタと同じ文字列",
      `.chat-line__message{background:url("http://evil.test/.chat-line__message.png")}`,
    ],
    [
      // ⚠ 引用符が無いので**文字列スキップに守られない**＝宣言部を素通りする実装でなければ落ちる。
      // 走査型スキャナが「宣言ブロックの中をセレクタとして見ない」ことを最も強く問う 1 本。
      "url の中身がセレクタと同じ文字列（引用符なし）",
      `.chat-line__message{background:url(http://evil.test/.chat-line__message.png)}`,
    ],
    [
      "url の中身に波括弧",
      `.chat-line__message{background:url("http://evil.test/a{b}c.png")}`,
    ],
    [
      "image-set（複数 url）",
      `.chat-line__message{background-image:image-set(url(http://evil.test/1x.png) 1x,url(http://evil.test/2x.png) 2x)}`,
    ],
    [
      "cursor: url()",
      `.chat-line__message{cursor:url(http://evil.test/c.cur),auto}`,
    ],
    [
      "list-style-image",
      `.chat-line__message{list-style-image:url(http://evil.test/l.png)}`,
    ],
    [
      "@namespace（url を含む文で終わるアットルール）",
      `@namespace svg url(http://www.w3.org/2000/svg);\n.chat-line__message{color:red}`,
    ],
    [
      "カスタムプロパティが波括弧を含む（CSS 仕様上は妥当）",
      `.chat-line__message{--foo:{color:red};background:url(http://evil.test/z.png)}`,
    ],
    [
      "CSS Nesting の中の url（ネストは非対応だが url は無傷であること）",
      `.sd-comment{color:red;& .chat-line__message{background:url(http://evil.test/n.png)}}`,
    ],
  ];

  for (const [label, css] of cases) {
    it(`${label} — url() が出現順・文字列ごと保存される`, () => {
      const r = rewriteSelectors(css);
      expect(urlsOf(r.css)).toEqual(urlsOf(css));
    });
  }

  it("@import の行は変換後もそのまま残り、警告にも載らない（除去は 060b の責務）", () => {
    const r = rewriteSelectors(
      `@import "http://evil.test/b.css" screen and (min-width:1px);\n.chat-line__message{color:red}`,
    );
    expect(r.css).toContain(
      `@import "http://evil.test/b.css" screen and (min-width:1px);`,
    );
    expect(r.css).toContain(".sd-comment-chat{color:red}");
    expect(r.unmatched).toEqual([]);
  });
});

/**
 * 060a: 「変換できるセレクタが 1 つも無い CSS は**恒等変換**になる」という不変条件。
 * これが破れる＝宣言部やアットルールのプレリュードを誤ってセレクタと認識している、ということ。
 * url() を含まないケースまで一網打尽に押さえられるので、上の url テストと対で置く。
 */
describe("rewriteSelectors — 変換対象が無い CSS は 1 バイトも変えない", () => {
  const identity: [label: string, css: string][] = [
    ["@charset", `@charset "UTF-8";\n.mytheme{color:red}`],
    ["@layer（ブロックなしの文）", `@layer base, theme;\n.mytheme{color:red}`],
    ["@layer（ブロック付き）", `@layer base{.mytheme{color:red}}`],
    ["@supports の中の @media（入れ子のグループ規則）", `@supports (display:grid){@media screen{.mytheme{color:red}}}`],
    ["@media の二重ネスト", `@media screen{@media print{.mytheme{color:red}}}`],
    ["@container", `@container (min-width:1px){.mytheme{color:red}}`],
    ["@scope", `@scope (.mytheme) to (.other){.inner{color:red}}`],
    ["@keyframes の from / to をセレクタ扱いしない", `@keyframes k{from{opacity:0}to{opacity:1}}`],
    ["宣言の文字列に閉じ波括弧", `.a{content:"}"}\n.b{content:"{"}`],
    ["文字列中のエスケープ引用符", `.a{content:"\\""}\n.b{color:red}`],
    ["改行で不正終端した文字列", `.a{content:"oops\n}\n.b{color:red}`],
    ["EOF で終わらない文字列", `.a{content:"oops`],
    ["閉じ波括弧と引用符を含むコメント", `/* } " */\n.a{color:red}`],
    ["閉じられていないコメント", `/* .chat-line__message\n.a{color:red}`],
    ["属性セレクタの文字列に波括弧", `[data-x="{"]{color:red}`],
    ["属性セレクタの文字列にエスケープ引用符", `[data-x="a\\"b"]{color:red}`],
    ["大文字のセレクタ（既知の制限・変換しない）", `YT-LIVE-CHAT-TEXT-MESSAGE-RENDERER{color:red}`],
    ["CSS エスケープでドットを含むクラス名", `.a\\.chat-line__message{color:red}`],
    // ⚠⚠ CSS Nesting（`&`）は**非対応**＝ネストしたセレクタは「宣言ブロックの中」として素通りする
    // （`scanPreludes` の docstring に既知の制限として明記・再修正トリガーつき）。
    // このケースは**責務分離の核を守る変異検知**でもある: 「通常規則の中身もセレクタとして走査する」
    // 変異（＝ネスト対応を素朴に足すとこうなる）を入れると、ここが変換されて落ちる。
    // その変異は同時に**宣言部を走査対象にする**＝060b の url() 除去と二重処理になる入口なので、
    // ネスト対応を足すときは「宣言テキストを走査しない」ことを別途担保してからにすること。
    [
      "CSS Nesting のセレクタは変換しない（非対応・宣言ブロックとして素通り）",
      `.sd-comment{color:red;& .chat-line__message{color:blue}}`,
    ],
    [
      "CSS Nesting の中の要素セレクタも同様",
      `.sd-comment{color:red;& yt-live-chat-text-message-renderer{color:blue}}`,
    ],
  ];

  for (const [label, css] of identity) {
    it(`${label}`, () => {
      const r = rewriteSelectors(css);
      expect(r.css).toBe(css);
      expect(r.rewritten).toBe(0);
    });
  }
});

/**
 * 060a: 壊れた／敵対的な入力でも **throw せず・止まらず**、変換できた範囲だけ返す（無害に劣化する）。
 * 060d が注入とプレビューのたびに毎回呼ぶので、例外もハングもそのまま UI の故障になる。
 */
describe("rewriteSelectors — 敵対的・壊れた入力でも throw せず劣化する", () => {
  const hostile: [label: string, css: string][] = [
    ["開き波括弧だけ", "{"],
    ["閉じ波括弧だけ", "}"],
    ["閉じ波括弧の連打", "}".repeat(500)],
    ["深いネスト", "@media screen{".repeat(2000) + ".chat-line__message{color:red}" + "}".repeat(2000)],
    ["BOM", "\uFEFF.chat-line__message{color:red}"],
    ["NUL バイト", ".chat-line__message\u0000{color:red}"],
    ["制御文字", ".chat-line__message{color:red\u0001\u0002\u0007}"],
    ["末尾が単独のバックスラッシュ", '.chat-line__message{content:"\\'],
    ["名前の無いアットルール", "@{color:red}"],
    ["セミコロンの連打", ";;;;;;.chat-line__message{color:red}"],
    ["プレリュードにセミコロン", "@media screen; {.chat-line__message{color:red}}"],
  ];

  for (const [label, css] of hostile) {
    it(`${label} — throw せず文字列を返す`, () => {
      const r = rewriteSelectors(css);
      expect(typeof r.css).toBe("string");
      expect(Array.isArray(r.unmatched)).toBe(true);
    });
  }
});

/**
 * 060a: **計算量の回帰ガード**（レビュー S-4／§8「ユーザー入力を信頼しない」）。
 * 060d はテーマ切替・プレビュー入力のたびに毎回呼ぶので、ここが指数時間に退行すると UI が固まる。
 * 変換表は `new RegExp` へコンパイルされ、結合子が `(?:\s*>\s*|\s+)`＝**空白で重なる 2 択**になっているため、
 * 量化子を入れ子にする変更（例 `(?:\s*>\s*|\s+)+`）を入れると catastrophic backtracking に転ぶ。
 *
 * ⚠ 実測は 5〜15ms 程度。閾値は CI の遅さを見込んで大きく取ってあり、**指数爆発だけを捕まえる**。
 */
describe("rewriteSelectors — 計算量（ReDoS 回帰ガード）", () => {
  const within = (ms: number, css: string) => {
    const t0 = Date.now();
    rewriteSelectors(css);
    expect(Date.now() - t0).toBeLessThan(ms);
  };

  it("リテラル直後の長い連続空白で爆発しない", () => {
    within(3000, "yt-live-chat-text-message-renderer" + " ".repeat(100000) + "{color:red}");
  });

  it("リテラルと連続空白の繰り返しで爆発しない", () => {
    within(3000, ("yt-live-chat-text-message-renderer" + " ".repeat(500) + ",").repeat(1000) + "x{color:red}");
  });

  it("子結合子の大量連結で爆発しない", () => {
    within(3000, "yt-live-chat-text-message-renderer" + " > ".repeat(50000) + "#message{color:red}");
  });

  it("060b の上限（256KB）相当の現実的な CSS を現実的な時間で処理する", () => {
    within(3000, ".chat-line__message{color:red}\n".repeat(8000));
  });
});

describe("rewriteSelectors — rewritten の粒度", () => {
  it("1 ルールに複数の置換が起きても 1 件と数える（UI の「M 個のルール」に落とすため）", () => {
    const css = `yt-live-chat-text-message-renderer #message,
yt-live-chat-text-message-renderer #author-name,
.chat-line__message-body { color: red }`;
    const r = rewriteSelectors(css);
    expect(r.rewritten).toBe(1);
    expect(r.css).toBe(
      `.sd-comment-text.sd-comment-in-chat,\n.sd-comment-name.sd-comment-in-chat,\n.sd-comment-text.sd-comment-in-chat { color: red }`,
    );
  });

  it("置換が 1 つも起きなかったルールは数えない", () => {
    const r = rewriteSelectors(".chat-line__timestamp { display: none }");
    expect(r.rewritten).toBe(0);
  });
});

describe("rewriteSelectors — 置換の安全性", () => {
  it("長いセレクタを先に当てる（祖先付きが単体に食われない）", () => {
    // ⚠ このケースが「長い順ソート」の実効性を握る。単体の
    // `yt-live-chat-text-message-renderer` を先に当てると `.sd-comment #message` に化ける。
    const r = rewriteSelectors(
      "yt-live-chat-text-message-renderer #message { color: red }",
    );
    expect(r.css).toBe(".sd-comment-text.sd-comment-in-chat { color: red }");
    expect(r.css).not.toContain("#message");
  });

  it("子結合子（>）でも祖先付きとして当たる", () => {
    const r = rewriteSelectors(
      "yt-live-chat-text-message-renderer > #message { color: red }",
    );
    expect(r.css).toBe(".sd-comment-text.sd-comment-in-chat { color: red }");
  });

  it("接尾辞違いの別クラスを巻き込まない（単語境界）", () => {
    const r = rewriteSelectors(".chat-line__no-background2 { color: red }");
    expect(r.css).toBe(".chat-line__no-background2 { color: red }");
    expect(r.rewritten).toBe(0);
    expect(r.unmatched).toEqual([".chat-line__no-background2"]);
  });

  it("複合セレクタ（.foo.chat-line__message）は当てる／別名の一部（.my-yt-live-chat-x）は当てない", () => {
    expect(rewriteSelectors(".foo.chat-line__message { }").css).toBe(
      ".foo.sd-comment-chat { }",
    );
    expect(
      rewriteSelectors(".my-yt-live-chat-text-message-renderer { }").css,
    ).toBe(".my-yt-live-chat-text-message-renderer { }");
  });

  it("擬似クラス・擬似要素は置換後もそのまま残る", () => {
    expect(rewriteSelectors(".chat-line__message:hover { }").css).toBe(
      ".sd-comment-chat:hover { }",
    );
    expect(rewriteSelectors(".chat-line__message-body::first-line { }").css).toBe(
      ".sd-comment-text.sd-comment-in-chat::first-line { }",
    );
  });

  it("宣言部の文字列を書き換えない（セレクタと同じ文字列が入っていても）", () => {
    const r = rewriteSelectors(
      `.chat-line__message { content: ".chat-line__message"; }`,
    );
    expect(r.css).toBe(`.sd-comment-chat { content: ".chat-line__message"; }`);
  });

  it("コメントの中を書き換えない／閉じブレースを含むコメントでブロック分割が壊れない", () => {
    const r = rewriteSelectors(
      `/* .chat-line__message は残す } */\n.chat-line__message { color: red }`,
    );
    expect(r.css).toBe(
      `/* .chat-line__message は残す } */\n.sd-comment-chat { color: red }`,
    );
    expect(r.rewritten).toBe(1);
  });

  it("宣言の文字列に含まれる } でその先のセレクタを取り違えない", () => {
    // ⚠ 素朴な `/([^{}]+)\{([^{}]*)\}/g` 方式だとここで分割が壊れ、以降の全セレクタを取り違える。
    const r = rewriteSelectors(
      `.a { content: "}" }\n.chat-line__message { color: red }`,
    );
    expect(r.css).toBe(`.a { content: "}" }\n.sd-comment-chat { color: red }`);
    expect(r.rewritten).toBe(1);
  });
});

describe("rewriteSelectors — アットルールの扱い", () => {
  it("@media の中のルールは変換し、@media のプレリュード自体は書き換えない", () => {
    const r = rewriteSelectors(
      "@media (max-width: 600px) { .chat-line__message { color: red } }",
    );
    expect(r.css).toBe(
      "@media (max-width: 600px) { .sd-comment-chat { color: red } }",
    );
    expect(r.rewritten).toBe(1);
  });

  it("@keyframes の step（from / to）をセレクタとして扱わない", () => {
    const css = "@keyframes k { from { opacity: 0 } to { opacity: 1 } }";
    const r = rewriteSelectors(css);
    expect(r.css).toBe(css);
    expect(r.rewritten).toBe(0);
  });

  it("@font-face の宣言部に触らない", () => {
    const css = `@font-face { font-family: "X"; src: url("https://example.test/x.woff2") }`;
    expect(rewriteSelectors(css).css).toBe(css);
  });
});

describe("rewriteSelectors — unmatched の意味", () => {
  it("純正チャット由来と断定できるセレクタだけを載せる（同じものは 1 度だけ）", () => {
    const r = rewriteSelectors(
      `.chat-line__timestamp { }\n.chat-line__timestamp:hover { }\nyt-live-chat-ticker-renderer { }`,
    );
    expect(r.unmatched).toEqual([
      ".chat-line__timestamp",
      "yt-live-chat-ticker-renderer",
    ]);
  });

  /**
   * 060a レビュー Q-1 の是正。**部分変換で死んだセレクタを警告に載せる。**
   * 祖先だけ変換されて子孫が純正チャットの裸 id のまま残ると、そのルールは `rewritten` に
   * 数えられたうえで**当たらない**。ユーザーが StreamDock の DOM に id を作る手段は無く、
   * 実在する id は `index.html` の `#root` だけ（`check-css-guards.mjs` (10-g) が固定）なので、
   * 裸 id は**警告専用**なら誤検知しない。
   */
  it("祖先だけ変換されて裸 id が残ったルールを警告に載せる（黙って効かないを防ぐ）", () => {
    const r = rewriteSelectors(
      `yt-live-chat-text-message-renderer #timestamp { display: none }`,
    );
    // 祖先は変換される（＝rewritten は加算される）が、#timestamp は StreamDock に存在しない。
    expect(r.css).toBe(".sd-comment-chat #timestamp { display: none }");
    expect(r.rewritten).toBe(1);
    // ⚠ ここが空だと「M 個変換しました」とだけ出て、ユーザーは効かない理由に辿り着けない。
    expect(r.unmatched).toEqual(["#timestamp"]);
  });

  it("実在テーマで頻出する裸 id をひととおり載せる", () => {
    const r = rewriteSelectors(`yt-live-chat-text-message-renderer #chat-badges { display: none }
yt-live-chat-text-message-renderer #author-photo { display: none }
yt-live-chat-text-message-renderer > #content > #message { color: red }`);
    expect(r.unmatched).toEqual(["#chat-badges", "#author-photo", "#message"]);
  });

  it("単語境界を守る（#message2 / #message-body は別物）", () => {
    const r = rewriteSelectors(`#message2 { }\n#message-body { }`);
    expect(r.unmatched).toEqual([]);
  });

  it("総称的な id（#content / #card 等）は意図的に載せない（将来の誤検知を避ける）", () => {
    // ⚠ 既知の取りこぼし。FOREIGN_ID_NAMES の docstring に再修正トリガーつきで記録してある。
    expect(rewriteSelectors("#content { } #card { }").unmatched).toEqual([]);
  });

  it("CSS エスケープされた `#` は id と見なさない（\\# はユーザーのクラス名の一部）", () => {
    expect(rewriteSelectors(".a\\#message { color: red }").unmatched).toEqual([]);
  });

  it("裸 id を載せても冪等（2 回通して unmatched が変わらない）", () => {
    const css = "yt-live-chat-text-message-renderer #timestamp { display: none }";
    const once = rewriteSelectors(css);
    const twice = rewriteSelectors(once.css);
    expect(twice.css).toBe(once.css);
    expect(twice.rewritten).toBe(0);
    // 2 周目も同じ警告が出る（変換されないものは何度通しても残るため）。
    expect(twice.unmatched).toEqual(once.unmatched);
  });

  it("ユーザーが sd 語彙で書いた CSS では空になる（警告がノイズに埋もれない）", () => {
    const r = rewriteSelectors(`body { margin: 0 }
.sd-comment { background: rgba(0, 0, 0, 0.5) }
.sd-comment[data-sd-tone="t6"] .sd-comment-body { background: gold }
.sd-comment:hover .sd-comment-text { color: red }
@media (max-width: 600px) { .sd-comment-text { font-size: 14px } }`);
    expect(r.unmatched).toEqual([]);
    expect(r.rewritten).toBe(0);
  });
});

/**
 * 060a レビュー S-1 の申し送りを機械で見える形にしておく。**ここは仕様の固定であって
 * 「これでよい」ではない**——`unmatched` はユーザー CSS 由来の未署名文字列で、要素数も
 * 1 要素の長さも入力次第で無制限。**060d は画面に出す前に両方を clamp すること。**
 */
describe("rewriteSelectors — unmatched は無制限（060d の clamp 前提）", () => {
  it("要素数は入力次第でいくらでも増える", () => {
    const css = Array.from(
      { length: 2000 },
      (_, i) => `.chat-x${i} { color: red }`,
    ).join("\n");
    expect(rewriteSelectors(css).unmatched.length).toBe(2000);
  });

  it("引用符なしの属性値は 1 要素が長さ無制限になる／引用符ありは載らない", () => {
    const bare = rewriteSelectors(`[data-a-target=${"B".repeat(5000)}] { }`);
    expect(bare.unmatched[0].length).toBeGreaterThan(5000);
    // 引用符付きは走査が文字列を除外するので載らない（副産物として安全側に倒れている）。
    expect(rewriteSelectors(`[data-a-target="${"B".repeat(5000)}"] { }`).unmatched)
      .toEqual([]);
  });
});

describe("rewriteSelectors — 異常系（壊れず劣化する）", () => {
  it("空文字列・宣言のみ・閉じられていないブロックでも throw しない", () => {
    expect(rewriteSelectors("")).toEqual({
      css: "",
      rewritten: 0,
      unmatched: [],
    });
    expect(rewriteSelectors("color: red;").css).toBe("color: red;");
    expect(rewriteSelectors(".chat-line__message { color: red").css).toBe(
      ".sd-comment-chat { color: red",
    );
    expect(rewriteSelectors("}}}").css).toBe("}}}");
  });
});
