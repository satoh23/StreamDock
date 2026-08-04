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
  it("変換先はすべて sd- 語彙のクラスセレクタで、窓ルート（.sd-overlay）は含まない", () => {
    for (const rule of SELECTOR_TABLE) {
      expect(rule.to.startsWith(".sd-")).toBe(true);
      // 060d のプレビューは全セレクタへ .sd-preview を前置するため、窓ルートは変換先にできない。
      expect(rule.to).not.toContain("sd-overlay");
    }
  });

  it("元セレクタに sd- 語彙を書かない（自分の出力に当たると冪等性が壊れる）", () => {
    for (const rule of SELECTOR_TABLE) {
      expect(rule.from).not.toContain("sd-");
    }
  });
});

describe("rewriteSelectors — 依頼者の実サンプル", () => {
  it("YouTube 実サンプルを丸ごと変換する（カンマ束ね・子孫の * ・@import・:root を含む）", () => {
    const r = rewriteSelectors(YOUTUBE_SAMPLE);
    expect(r.css).toBe(`@import url("https://ruri.info/tool/css/midashi1Comment.css");
.sd-comment-text,
.sd-comment-text * {
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
.sd-comment{
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
  it("YouTube: 単体 renderer / #author-name / 課金カードを書き換え、未知は残して unmatched に載せる", () => {
    const r = rewriteSelectors(YOUTUBE_EXTENDED);
    expect(r.css).toContain(".sd-comment {");
    expect(r.css).toContain(".sd-comment-name {");
    expect(r.css).toContain(".sd-comment-tip {");
    // 変換できた 3 ルール。4 本目（paid-sticker）は変換表に無い。
    expect(r.rewritten).toBe(3);
    expect(r.unmatched).toEqual(["yt-live-chat-paid-sticker-renderer"]);
    // 未知セレクタは**消さずに残す**（消すとユーザーが原因にたどり着けない）。
    expect(r.css).toContain("yt-live-chat-paid-sticker-renderer {");
  });

  it("Twitch: message / message-body / display-name を書き換え、未知は残して unmatched に載せる", () => {
    const r = rewriteSelectors(TWITCH_EXTENDED);
    expect(r.css).toContain(".sd-comment {\n  padding: 8px 12px;");
    expect(r.css).toContain(".sd-comment-text {");
    expect(r.css).toContain(".sd-comment-name {");
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
    expect(r.css).toContain(".sd-comment { color: red }");
    // @import の中の URL は「効かないセレクタ」ではないので警告に載せない。
    expect(r.unmatched).toEqual([]);
  });

  it("宣言部の url() を書き換えない（外部参照の除去は 060b の責務）", () => {
    const css = `.chat-line__message { background-image: url("https://evil.example/x.png") }`;
    const r = rewriteSelectors(css);
    expect(r.css).toBe(
      `.sd-comment { background-image: url("https://evil.example/x.png") }`,
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
    expect(r.css).toContain(".sd-comment{color:red}");
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
      `.sd-comment-text,\n.sd-comment-name,\n.sd-comment-text { color: red }`,
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
    expect(r.css).toBe(".sd-comment-text { color: red }");
    expect(r.css).not.toContain("#message");
  });

  it("子結合子（>）でも祖先付きとして当たる", () => {
    const r = rewriteSelectors(
      "yt-live-chat-text-message-renderer > #message { color: red }",
    );
    expect(r.css).toBe(".sd-comment-text { color: red }");
  });

  it("接尾辞違いの別クラスを巻き込まない（単語境界）", () => {
    const r = rewriteSelectors(".chat-line__no-background2 { color: red }");
    expect(r.css).toBe(".chat-line__no-background2 { color: red }");
    expect(r.rewritten).toBe(0);
    expect(r.unmatched).toEqual([".chat-line__no-background2"]);
  });

  it("複合セレクタ（.foo.chat-line__message）は当てる／別名の一部（.my-yt-live-chat-x）は当てない", () => {
    expect(rewriteSelectors(".foo.chat-line__message { }").css).toBe(
      ".foo.sd-comment { }",
    );
    expect(
      rewriteSelectors(".my-yt-live-chat-text-message-renderer { }").css,
    ).toBe(".my-yt-live-chat-text-message-renderer { }");
  });

  it("擬似クラス・擬似要素は置換後もそのまま残る", () => {
    expect(rewriteSelectors(".chat-line__message:hover { }").css).toBe(
      ".sd-comment:hover { }",
    );
    expect(rewriteSelectors(".chat-line__message-body::first-line { }").css).toBe(
      ".sd-comment-text::first-line { }",
    );
  });

  it("宣言部の文字列を書き換えない（セレクタと同じ文字列が入っていても）", () => {
    const r = rewriteSelectors(
      `.chat-line__message { content: ".chat-line__message"; }`,
    );
    expect(r.css).toBe(`.sd-comment { content: ".chat-line__message"; }`);
  });

  it("コメントの中を書き換えない／閉じブレースを含むコメントでブロック分割が壊れない", () => {
    const r = rewriteSelectors(
      `/* .chat-line__message は残す } */\n.chat-line__message { color: red }`,
    );
    expect(r.css).toBe(
      `/* .chat-line__message は残す } */\n.sd-comment { color: red }`,
    );
    expect(r.rewritten).toBe(1);
  });

  it("宣言の文字列に含まれる } でその先のセレクタを取り違えない", () => {
    // ⚠ 素朴な `/([^{}]+)\{([^{}]*)\}/g` 方式だとここで分割が壊れ、以降の全セレクタを取り違える。
    const r = rewriteSelectors(
      `.a { content: "}" }\n.chat-line__message { color: red }`,
    );
    expect(r.css).toBe(`.a { content: "}" }\n.sd-comment { color: red }`);
    expect(r.rewritten).toBe(1);
  });
});

describe("rewriteSelectors — アットルールの扱い", () => {
  it("@media の中のルールは変換し、@media のプレリュード自体は書き換えない", () => {
    const r = rewriteSelectors(
      "@media (max-width: 600px) { .chat-line__message { color: red } }",
    );
    expect(r.css).toBe(
      "@media (max-width: 600px) { .sd-comment { color: red } }",
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
    expect(r.css).toBe(".sd-comment #timestamp { display: none }");
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
      ".sd-comment { color: red",
    );
    expect(rewriteSelectors("}}}").css).toBe("}}}");
  });
});
