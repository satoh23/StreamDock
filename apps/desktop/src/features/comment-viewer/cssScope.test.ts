import { describe, it, expect } from "vitest";
import {
  PREVIEW_SCOPE_CLASS,
  PREVIEW_SCOPE_SELECTOR,
  scopeSelectors,
  unclosedBlockDepth,
} from "./cssScope";
import { rewriteSelectors } from "./cssCompat";

/**
 * 060d: プレビューのスコープ化（`scopeSelectors`）と、取り込み後 CSS の健全性（`unclosedBlockDepth`）の仕様テスト。
 *
 * あるべき挙動（docs/tasks/060d-css-theme-management-ui.md / 060a からの申し送り③）:
 * - **全セレクタがラッパ配下へ閉じる**。1 本でも外へ出ると、プレビューの CSS がコメビュ窓を乗っ取る。
 * - ⚠ **`:root` / `html` / `body` は前置ではなくラッパ自身へ読み替える。** 依頼者の実サンプルが
 *   `:root { --txtcolor }` を含むので、素朴に前置すると `.sd-preview :root` になって**絶対に当たらない**
 *   （プレビューでだけ色が反映されない、原因の分かりにくい不一致になる）。
 * - ⚠ **`@keyframes` の `from` / `to` / `50%` には前置しない**（前置するとアニメーションが壊れる）。
 * - ⚠ **`@media` などのプレリュード（条件部分）は書き換えない。**
 * - ⚠ **`@import` / `url()` には触らない**（除去は 060b・取得は 060c の責務）。
 *
 * ⚠ `scopeSelectors` は **1 回だけ適用する**もので冪等ではない（2 回通せば `.sd-preview` が 2 段になる）。
 * 呼ぶのはプレビューの注入 1 か所だけ。
 */

const S = PREVIEW_SCOPE_SELECTOR;

/** 依頼者の実サンプル（YouTube 用・逐語）。⚠ 第三者資産（ruri.info の CSS 本体）はコピーしていない（URL のみ）。 */
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

describe("PREVIEW_SCOPE_CLASS / PREVIEW_SCOPE_SELECTOR", () => {
  it("クラス名とセレクタが 1 か所から導かれる（ラッパとスコープ化がずれない）", () => {
    expect(PREVIEW_SCOPE_CLASS).toBe("sd-preview");
    expect(PREVIEW_SCOPE_SELECTOR).toBe(`.${PREVIEW_SCOPE_CLASS}`);
  });
});

describe("scopeSelectors: 基本の前置", () => {
  it("通常のセレクタにラッパを前置する", () => {
    expect(scopeSelectors(".foo{color:red}", S)).toBe(
      ".sd-preview .foo{color:red}",
    );
  });

  it("セレクタリストは 1 つずつ前置する（束ねて片方が外へ出ない）", () => {
    expect(scopeSelectors(".a,.b{color:red}", S)).toBe(
      ".sd-preview .a,.sd-preview .b{color:red}",
    );
  });

  it("結合子を含む複合セレクタは全体の先頭にだけ前置する", () => {
    expect(scopeSelectors(".a > .b .c{color:red}", S)).toBe(
      ".sd-preview .a > .b .c{color:red}",
    );
  });

  it("全称セレクタも配下へ閉じる", () => {
    expect(scopeSelectors("*{color:red}", S)).toBe(".sd-preview *{color:red}");
  });
});

describe("scopeSelectors: root 相当の読み替え（申し送り③）", () => {
  it.each([":root", "html", "body"])(
    "%s 単独はラッパ自身へ読み替える（前置すると絶対に当たらない）",
    (sel) => {
      expect(scopeSelectors(`${sel}{--txtcolor:#555}`, S)).toBe(
        ".sd-preview{--txtcolor:#555}",
      );
    },
  );

  it.each([":root", "html", "body"])(
    "%s を祖先に持つ形もラッパ自身へ読み替える（配下は残す）",
    (sel) => {
      expect(scopeSelectors(`${sel} .foo{color:red}`, S)).toBe(
        ".sd-preview .foo{color:red}",
      );
    },
  );

  it("先頭の型セレクタだけを置換し、同じ複合の残り（.dark 等）は保つ", () => {
    expect(scopeSelectors("html.dark .foo{color:red}", S)).toBe(
      ".sd-preview.dark .foo{color:red}",
    );
  });

  it("root 相当が連続していても取り除く（html > body .foo）", () => {
    expect(scopeSelectors("html > body .foo{color:red}", S)).toBe(
      ".sd-preview .foo{color:red}",
    );
  });

  it("大文字の型セレクタも読み替える（CSS 上 html/body は大小無視）", () => {
    expect(scopeSelectors("BODY .foo{color:red}", S)).toBe(
      ".sd-preview .foo{color:red}",
    );
  });

  it("root 相当に見える別のクラス／id は読み替えない", () => {
    expect(scopeSelectors(".body .foo{color:red}", S)).toBe(
      ".sd-preview .body .foo{color:red}",
    );
    expect(scopeSelectors("#body{color:red}", S)).toBe(
      ".sd-preview #body{color:red}",
    );
    expect(scopeSelectors("bodybuilder{color:red}", S)).toBe(
      ".sd-preview bodybuilder{color:red}",
    );
  });

  it("実配信の窓ルート .sd-overlay もラッパへ読み替える（CSS 変数の上書きがプレビューで効く）", () => {
    expect(scopeSelectors(".sd-overlay{--sd-comment-bg:red}", S)).toBe(
      ".sd-preview{--sd-comment-bg:red}",
    );
    expect(scopeSelectors(".sd-overlay .sd-comment{color:red}", S)).toBe(
      ".sd-preview .sd-comment{color:red}",
    );
  });

  it("クラス名は大小を区別する（.SD-OVERLAY は別のクラス）", () => {
    expect(scopeSelectors(".SD-OVERLAY{color:red}", S)).toBe(
      ".sd-preview .SD-OVERLAY{color:red}",
    );
  });
});

/**
 * 060f: ⚠⚠ **`.sd-overlay` は変換表の右辺にもなった**（`yt-live-chat-app` / `yt-live-chat-renderer`）。
 *
 * 060a はこの読み替えが無いことを前提に「`.sd-overlay` は変換表に入れない」としていた。
 * 060d が `ROOT_LIKE_CS` を入れて制約は解消されたが、**「解消されている」の根拠は
 * `rewriteSelectors` → `scopeSelectors` の**順序**に依存する**（`OverlayThemeCard` の
 * プレビュー生成が `scopeSelectors(rewriteSelectors(css).css, …)` の 1 か所だけである、という規約）。
 * ＝ ここで**注入経路と同じ順序で通した結果**を固定しておかないと、
 * 「変換で生まれた `.sd-overlay` がプレビューで素通しになる」退行に気付けない。
 * ⚠ 順序を入れ替える／どちらかの呼び出しを増やす変更をしたら、本 describe を必ず見直すこと。
 */
describe("060f: 変換で生まれた .sd-overlay もプレビューでラッパへ読み替わる", () => {
  /** 注入経路（OverlayThemeCard のプレビュー）と同じ順序。 */
  const pipeline = (css: string) => scopeSelectors(rewriteSelectors(css).css, S);

  it("窓ルートを指す純正チャットのセレクタは .sd-preview になる", () => {
    expect(pipeline("yt-live-chat-app{background:transparent}")).toBe(
      ".sd-preview{background:transparent}",
    );
    expect(pipeline("yt-live-chat-renderer{font-family:X}")).toBe(
      ".sd-preview{font-family:X}",
    );
  });

  it("窓ルート配下の複合セレクタも、前置ではなく読み替えになる", () => {
    expect(
      pipeline(
        "yt-live-chat-app yt-live-chat-text-message-renderer #message{color:red}",
      ),
    ).toBe(".sd-preview .sd-comment-text.sd-comment-in-chat{color:red}");
  });

  it("060f で足した安定クラスは（窓ルートではないので）従来どおり前置される", () => {
    expect(pipeline("yt-live-chat-item-list-renderer #items{padding:0}")).toBe(
      ".sd-preview .sd-comment-list{padding:0}",
    );
    expect(pipeline("yt-live-chat-text-message-renderer{margin:0}")).toBe(
      ".sd-preview .sd-comment-chat{margin:0}",
    );
  });
});

describe("scopeSelectors: カンマの分割は構文を見る", () => {
  it("擬似クラスの引数の中では分割しない", () => {
    expect(scopeSelectors(".a:not(.b, .c){color:red}", S)).toBe(
      ".sd-preview .a:not(.b, .c){color:red}",
    );
  });

  it("属性セレクタの文字列の中では分割しない", () => {
    expect(scopeSelectors('.a[title="x, y"]{color:red}', S)).toBe(
      '.sd-preview .a[title="x, y"]{color:red}',
    );
  });

  it("コメントの中では分割しない", () => {
    expect(scopeSelectors(".a/* x, y */{color:red}", S)).toBe(
      ".sd-preview .a/* x, y */{color:red}",
    );
  });

  it("先頭のコメントの後ろにある :root も読み替える", () => {
    expect(scopeSelectors("/* c */:root{color:red}", S)).toBe(
      "/* c */.sd-preview{color:red}",
    );
  });
});

describe("scopeSelectors: アットルール", () => {
  it("@media の条件部分は書き換えず、中のルールだけ前置する", () => {
    expect(
      scopeSelectors("@media (min-width:100px){.a{color:red}}", S),
    ).toBe("@media (min-width:100px){.sd-preview .a{color:red}}");
  });

  it("@media の中の :root も読み替える", () => {
    expect(scopeSelectors("@media screen{:root{--a:1}}", S)).toBe(
      "@media screen{.sd-preview{--a:1}}",
    );
  });

  it("@supports / @container / @layer のブロックも同じ扱い", () => {
    expect(scopeSelectors("@supports (display:grid){.a{color:red}}", S)).toBe(
      "@supports (display:grid){.sd-preview .a{color:red}}",
    );
    expect(scopeSelectors("@layer base{.a{color:red}}", S)).toBe(
      "@layer base{.sd-preview .a{color:red}}",
    );
  });

  it("⚠ @keyframes の中身（from / to / パーセント）には前置しない", () => {
    const css = "@keyframes k{from{opacity:0}50%{opacity:.5}to{opacity:1}}";
    expect(scopeSelectors(css, S)).toBe(css);
  });

  it("@font-face はセレクタを持たないので無改変", () => {
    const css = '@font-face{font-family:"X";src:local("Y")}';
    expect(scopeSelectors(css, S)).toBe(css);
  });

  it("@property もセレクタを持たないので無改変", () => {
    const css = "@property --x{syntax:'<color>';inherits:false}";
    expect(scopeSelectors(css, S)).toBe(css);
  });

  it("文で終わるアットルール（@import / @charset / @layer a,b;）は無改変", () => {
    const css = '@charset "utf-8";@layer a,b;@import url("x.css");.a{color:red}';
    expect(scopeSelectors(css, S)).toBe(
      '@charset "utf-8";@layer a,b;@import url("x.css");.sd-preview .a{color:red}',
    );
  });
});

describe("scopeSelectors: 触らないもの・壊さないもの", () => {
  it("宣言部の url() と @import の中身に触れない（060b / 060c の責務）", () => {
    const css =
      '@import url("https://x.example/a.css");.a{background:url(data:image/png;base64,AAAA)}';
    expect(scopeSelectors(css, S)).toBe(
      '@import url("https://x.example/a.css");.sd-preview .a{background:url(data:image/png;base64,AAAA)}',
    );
  });

  it("宣言内の文字列に } が入っていてもブロック分割が壊れない", () => {
    expect(scopeSelectors('.a{content:"}"}.b{color:red}', S)).toBe(
      '.sd-preview .a{content:"}"}.sd-preview .b{color:red}',
    );
  });

  it("CSS Nesting は宣言ブロックの中として素通りする（変換しないだけで壊さない）", () => {
    const css = ".a{color:red;& .b{color:blue}}";
    expect(scopeSelectors(css, S)).toBe(".sd-preview .a{color:red;& .b{color:blue}}");
  });

  it("壊れた CSS でも throw せず、処理できた範囲だけ返す", () => {
    expect(() => scopeSelectors(".a{color:red", S)).not.toThrow();
    expect(() => scopeSelectors("/* 閉じないコメント", S)).not.toThrow();
    expect(() => scopeSelectors('.a{content:"閉じない', S)).not.toThrow();
    expect(scopeSelectors("", S)).toBe("");
  });
});

describe("⚠ scopeSelectors: スコープからの脱出（敵対的入力・2026-08-05 実測）", () => {
  // ⚠⚠ プレビューは**コメビュ窓の中で第三者の CSS を走らせる**（オーバーレイ窓と違い、この窓には
  // 設定 UI がある）。スコープ化が破れると窓全体が乗っ取られるので、走査器を desync させて
  // 「ラッパの外に出るルール」を作れないかを敵対的入力で確かめる。
  // ⚠ 判定は「`.escaped{…}` がルールとして生き残り、かつ `.sd-preview` が前に付いていない」こと。
  it.each([
    ["宣言中の文字列に }", '.a{content:"}"}.escaped{color:red}'],
    ["未終端の文字列（改行で閉じる）", '.a{content:"x\n}.escaped{color:red}'],
    ["コメント中の {", ".a{color:red}/* { */.escaped{color:red}"],
    ["url() の中の }", ".a{background:url(data:x;base64,fS8q)}.escaped{color:red}"],
    ["余分な }", ".a{color:red}}.escaped{color:red}"],
    ["@media を閉じた直後", "@media screen{.a{color:red}}.escaped{color:red}"],
    ["@keyframes を閉じた直後", "@keyframes k{from{opacity:0}}.escaped{color:red}"],
    ["@font-face を閉じた直後", '@font-face{src:local("x")}.escaped{color:red}'],
    ["@import 文の直後", '@import "x.css";.escaped{color:red}'],
    ["先頭カンマ", ",.escaped{color:red}"],
    ["@scope の中", "@scope (.a) to (.b){.escaped{color:red}}"],
    ["@layer の文形と block 形", "@layer a,b;@layer a{.escaped{color:red}}"],
    ["エスケープされた } の文字列", '.a{content:"\\7d"}.escaped{color:red}'],
    ["root 相当の連鎖の直後", "html body{color:red}.escaped{color:red}"],
  ])("%s でも .sd-preview の外へ出ない", (_label, css) => {
    const out = scopeSelectors(css, S);
    expect(out).toContain(`${S} .escaped`);
  });

  it("⚠ 祖先を狙う :has() も前置で無力化される（窓の他の部分を触れない）", () => {
    // `html:has(…) .escaped` は本来ドキュメント全体を狙えるが、先頭の html がラッパへ読み替わる。
    expect(scopeSelectors("html:has(.sd-preview) .escaped{color:red}", S)).toBe(
      ".sd-preview:has(.sd-preview) .escaped{color:red}",
    );
    expect(scopeSelectors("*:has(.sd-comment) .escaped{color:red}", S)).toBe(
      ".sd-preview *:has(.sd-comment) .escaped{color:red}",
    );
  });

  // ⚠ **既知の限界（いずれも安全側＝プレビューが「効かなくなる」方向にしか外れない）**
  it("未終端コメントの中身はルールにならない（ブラウザと同じ挙動なので前置しない）", () => {
    expect(scopeSelectors(".a{color:red}/* .escaped{color:red}", S)).toBe(
      ".sd-preview .a{color:red}/* .escaped{color:red}",
    );
  });

  it("CDO/CDC を含むと前置でセレクタが不正になりルールごと落ちる（過剰制限・既知）", () => {
    // CSS Syntax ではスタイルシート最上位の `<!--` / `-->` は無視されるので、本来 `.escaped` は効く。
    // 前置すると `.sd-preview <!-- .escaped` という不正セレクタになり、ブラウザがルールごと捨てる
    // ＝**プレビューで効かなくなるだけ**で、窓へ漏れる向きには外れない。実例が出たら対応する。
    expect(scopeSelectors("<!-- .escaped{color:red} -->", S)).toBe(
      ".sd-preview <!-- .escaped{color:red} -->",
    );
  });
});

describe("scopeSelectors: 実サンプル 2 本（cssCompat と同じ入力で通しで確認する）", () => {
  it("YouTube サンプル: 変換後のセレクタが配下へ閉じ、:root はラッパへ読み替わる", () => {
    const scoped = scopeSelectors(rewriteSelectors(YOUTUBE_SAMPLE).css, S);
    expect(scoped).toBe(`@import url("https://ruri.info/tool/css/midashi1Comment.css");
.sd-preview .sd-comment-text.sd-comment-in-chat,
.sd-preview .sd-comment-text.sd-comment-in-chat * {
font-family: "M PLUS 1p", sans-serif;}
.sd-preview{
--txtcolor:#555555;
}
`);
  });

  it("Twitch サンプル: 同上", () => {
    const scoped = scopeSelectors(rewriteSelectors(TWITCH_SAMPLE).css, S);
    expect(scoped).toBe(`@import url("https://ruri.info/tool/css/twmidashi1Comment.css");
.sd-preview .sd-comment-chat{
font-family: "M PLUS 1p", sans-serif;}
.sd-preview{
--txtcolor:#555555;
}
`);
  });

  it("⚠ 素朴な前置に戻ると :root が当たらなくなる（この不一致を固定する）", () => {
    const scoped = scopeSelectors(rewriteSelectors(YOUTUBE_SAMPLE).css, S);
    expect(scoped).not.toContain(`${S} :root`);
    expect(scoped).not.toContain(":root");
  });
});

describe("unclosedBlockDepth", () => {
  it("健全な CSS は 0", () => {
    expect(unclosedBlockDepth(".a{color:red}")).toBe(0);
    expect(unclosedBlockDepth("@media screen{.a{color:red}}")).toBe(0);
    expect(unclosedBlockDepth("")).toBe(0);
  });

  it("⚠ 対応の取れていない ( で残りが落ちた形を検出する（060b review② Q-3 の実測形）", () => {
    // `.a{width:calc(100% - 10px;}` ＋以降 を取り込むと、060b の保存結果は `.a{` だけになる。
    expect(unclosedBlockDepth(".a{")).toBe(1);
    // 宣言が途中まで残る形（末尾が `{` ではない）も検出できること。
    expect(unclosedBlockDepth(".a{color:red;")).toBe(1);
    expect(unclosedBlockDepth("@media screen{.a{")).toBe(2);
  });

  it("余分な } があっても負にならない", () => {
    expect(unclosedBlockDepth(".a{color:red}}}")).toBe(0);
  });

  it("コメントや文字列の中の波括弧は数えない", () => {
    expect(unclosedBlockDepth('.a{content:"{{{"}')).toBe(0);
    expect(unclosedBlockDepth(".a{color:red}/* { { { */")).toBe(0);
  });

  it("実サンプルは健全（正常な取り込みで警告が出ない）", () => {
    expect(unclosedBlockDepth(YOUTUBE_SAMPLE)).toBe(0);
    expect(unclosedBlockDepth(TWITCH_SAMPLE)).toBe(0);
  });
});

describe("⚠⚠ scopeSelectors: security-review S-1 の回帰（url トークン / CSS エスケープ）", () => {
  // ⚠⚠ **ここが 2026-08-05 の security-review で実際に破れた 2 軸。**
  // 既存の「敵対的入力」14 件は**すべて「文字列 / コメント / base64 の中に構文文字がある」形**で、
  //   ①無引用 `url(` トークンの中の**生の**構文文字
  //   ②文字列の**外**にある CSS エスケープ
  // が 1 件も入っていなかった（＝ 055e の教訓「自分のガードの主張を裏返す変異だけでは、
  // ガードが見ていない領域の穴は見つからない」がそのまま再現した）。
  //
  // ⚠ 下の 8 本は**いずれも 060b のサニタイザを `stripped_count=0`・無改変で通過することを実測済み**
  // （`sanitize_css` を直接叩いて確認）。＝「060b が壁だから届かない」は成り立たない。
  //
  // ⚠ 判定は `.escaped{…}` が**素のまま**出力に現れないこと。`.sd-preview` が付いていれば閉じている。
  it.each([
    // ① url トークンは `)` まで不透明。中の `/*` `"` `'` `{` `}` は構文ではない。
    [
      "url() の中の /*（旧実装は EOF まで飲んでいた）",
      ".a{background:url(data:text/css,/*)}\n.escaped{color:red}",
    ],
    [
      "url() の中の 二重引用符",
      '.a{background:url(data:text/css,")} .escaped{color:red}',
    ],
    [
      "url() の中の 単一引用符",
      ".a{background:url(data:text/css,')} .escaped{color:red}",
    ],
    [
      "url() の中の 生の {",
      ".a{background:url(data:text/css,{)}\n.escaped{color:red}",
    ],
    [
      "url の綴りをエスケープで隠す（\\75 rl）",
      ".a{background:\\75 rl(data:text/css,/*)}\n.escaped{color:red}",
    ],
    [
      "url の綴りをエスケープで隠す（u\\72 l）",
      ".a{background:u\\72 l(data:text/css,{)}\n.escaped{color:red}",
    ],
    // ② 文字列の外の CSS エスケープ。`\{` は ident の一部でブロックを開かない。
    ["宣言値のエスケープされた {", ".a{--x:\\{;}\n.escaped{color:red}"],
    ["セレクタ中のエスケープされた {", ".a\\{b{color:red}\n.escaped{color:blue}"],
  ])("%s でも .sd-preview の外へ出ない", (_label, css) => {
    const out = scopeSelectors(css, S);
    expect(out).toContain(`${S} .escaped`);
    expect(out).not.toMatch(/(^|[};])\s*\.escaped\s*\{/);
  });

  it("⚠ カンマ分割もエスケープを見る（`.a\\(b,.c` の `.c` が素で残らない）", () => {
    // `\(` を括弧と数えると深さが 1 のままになり、**トップレベルのカンマで分割されない**。
    // 前置は先頭にしか付かないので `.sd-preview .a\(b,.escaped` ＝ 2 要素目が素で残る（実測で成立した形）。
    expect(scopeSelectors(".a\\(b,.escaped{color:red}", S)).toBe(
      `${S} .a\\(b,${S} .escaped{color:red}`,
    );
    expect(scopeSelectors(".a\\[b,.escaped{color:red}", S)).toBe(
      `${S} .a\\[b,${S} .escaped{color:red}`,
    );
  });

  it("⚠ 引用形の url() は不透明にしない（従来どおり文字列として走査する）", () => {
    // `url("…")` は関数トークン＋文字列。二重に扱うと差分が生まれるので、文字列走査に任せる。
    expect(scopeSelectors('.a{background:url("data:text/css,}")}\n.b{color:red}', S)).toBe(
      `${S} .a{background:url("data:text/css,}")}\n${S} .b{color:red}`,
    );
  });

  it("⚠ root 相当の判定はエスケープと非 ASCII をトークン境界として見る", () => {
    // `html\41` は ident `htmlA`、`body日本` は ident `body日本`＝どちらも root 相当ではない。
    // 読み替えてしまうと `.sd-preview\41`（＝クラス `sd-previewA`）という**当たらないセレクタ**になる。
    expect(scopeSelectors("html\\41 {color:red}", S)).toBe(
      `${S} html\\41 {color:red}`,
    );
    expect(scopeSelectors("body日本{color:red}", S)).toBe(
      `${S} body日本{color:red}`,
    );
    // 素の root 相当は従来どおり読み替える（退行していないこと）。
    expect(scopeSelectors("html{color:red}", S)).toBe(`${S}{color:red}`);
  });

  it("⚠ url トークンの読み飛ばしが無限ループにならない（未終端でも EOF で止まる）", () => {
    expect(() =>
      scopeSelectors(".a{background:url(data:x,noclose", S),
    ).not.toThrow();
    expect(() => scopeSelectors(".a{color:\\", S)).not.toThrow();
    expect(() => scopeSelectors("\\", S)).not.toThrow();
  });

  it("⚠ ident の途中では ident を開始しない（`2url(` を url トークンと誤認しない）", () => {
    // ⚠ このガード（`i === 0 || !isIdentChar(css[i - 1])`）は**不透明に飲みすぎない**ためのもの。
    // 実 CSS では `2url` は dimension トークン＋`(` で、url トークンではない（中身は構文として読まれる）。
    // ここで url と誤認すると `)` まで飲み、**中の `}` を見落として深さがずれる**＝危険側へ倒れる。
    // ⚠ security-review② でミューテーション（ガード削除）が**生存**したので追加した回帰。
    expect(scopeSelectors(".a{width:2url(}\n.escaped{color:red}", S)).toBe(
      `${S} .a{width:2url(}\n${S} .escaped{color:red}`,
    );
    expect(scopeSelectors(".a{width:1e5url(}\n.escaped{color:red}", S)).toBe(
      `${S} .a{width:1e5url(}\n${S} .escaped{color:red}`,
    );
  });
});

describe("⚠⚠ scopeSelectors: security-review② の回帰（2026-08-05・第三者レビュー）", () => {
  // ⚠⚠ **1 回目の修正（url トークン／エスケープの読み分け）では閉じていなかった 2 系統。**
  // どちらも仕様トークナイザ（css-syntax-3 準拠）を oracle に実測で確認され、
  // **060b のサニタイザを `stripped_count=0`・無改変で通過する**ことも Rust 側で実測済み。
  // ⚠ さらに末尾へ `}` を 1 つ足すと `unclosedBlockDepth` も 0 になり、取り込み時の警告も出なかった。
  it.each([
    // ① `\` ＋改行は valid escape ではない（delim トークン）。ident に飲み込むと
    //    直後の `url(` が url トークンとして認識されず、中の `{` を実ブロック開始と誤認する。
    [
      "`\\` ＋ LF の直後の url()",
      ".a{color:\\\nurl(data:x,{)}\n.escaped{color:red}\n}",
    ],
    [
      "`\\` ＋ CR の直後の url()",
      ".a{color:\\\rurl(data:x,{)}\n.escaped{color:red}\n}",
    ],
    // ② at-keyword トークンの値は**エスケープ復元後**の ident（`@med\69 a` はブラウザにとって `@media`）。
    //    旧実装の `/^@([A-Za-z-]+)/` は `"med"` を返し、グループ規則と認識できていなかった。
    ["@media の名前をエスケープで隠す", "@med\\69 a (min-width:1px){.escaped{color:red}}"],
    ["@media の先頭文字をエスケープ", "@\\6d edia (min-width:1px){.escaped{color:red}}"],
    ["@supports の名前をエスケープ", "@suppo\\72 ts (color:red){.escaped{color:red}}"],
    ["@layer（block 形）の名前をエスケープ", "@lay\\65 r a{.escaped{color:red}}"],
    ["@container の名前をエスケープ", "@containe\\72 (min-width:1px){.escaped{color:red}}"],
    ["@scope の名前をエスケープ", "@scop\\65 (.a){.escaped{color:red}}"],
    ["グループ規則の入れ子（内側だけエスケープ）", "@media screen{@suppo\\72 ts (color:red){.escaped{color:red}}}"],
    // ③ `@starting-style` は規則リストを持つのに allow-list から漏れていた。
    ["@starting-style の中", "@starting-style{.escaped{color:red}}"],
  ])("%s でも .sd-preview の外へ出ない", (_label, css) => {
    const out = scopeSelectors(css, S);
    expect(out).toContain(`${S} .escaped`);
    expect(out).not.toMatch(/(^|[{};])\s*\.escaped\s*\{/);
  });

  it("⚠ 未知のアットルールは従来どおり中身に触れない（ブラウザがブロックごと捨てるため）", () => {
    // `@containerc` は未知＝ブラウザが捨てるので、前置しないのが正しい（過剰前置もしない）。
    expect(scopeSelectors("@containe\\72 c{.escaped{color:red}}", S)).toBe(
      "@containe\\72 c{.escaped{color:red}}",
    );
  });

  it("⚠ `\\` ＋改行を含んでも throw も無限ループもしない", () => {
    expect(() => scopeSelectors("\\\n", S)).not.toThrow();
    expect(() => scopeSelectors("@\\\nmedia{.a{color:red}}", S)).not.toThrow();
    expect(() => scopeSelectors(".a{--x:\\\n}", S)).not.toThrow();
  });
});

describe("⚠⚠ unclosedBlockDepth の既知の見落とし（security-review Q-1・060c で塞ぐ）", () => {
  // ⚠⚠ **これは「正しい」テストではなく、既知の穴を可視化して固定するテストである。**
  //
  // 060d の完了条件は「取り込みで大部分が失われたら警告する」で、`unclosedBlockDepth` はその判定を
  // 「閉じ忘れたブロックが残っているか」で代替している（サイズ比は frontend から計算できないため）。
  // しかし**壊れた `(` がどのブロックにも入っていない位置**（`@import` / `@namespace` /
  // グループ規則のプレリュード）にあると、除去が EOF まで達しても閉じ忘れが 1 つも残らない。
  //
  // 下は Rust の `sanitize_css` を直接叩いて得た**実測値**（保存される CSS）:
  //
  //   入力:  @media (min-width:1px){.sd-comment{color:red}}
  //          @import url(https://fonts.example/x.css      ← ) が無い
  //          .sd-comment{color:blue}
  //          .sd-comment-name{color:green}
  //   保存:  "@media (min-width:1px){.sd-comment{color:red}}"   ← 後半 2 行が黙って消える
  //
  // ⚠ `@import` の `)` 忘れは現実的な打ち間違いなので、取り逃しには実害がある。
  // ⚠⚠ **再修正トリガー＝ 060c で `SanitizeOutcome` に `truncated_to_eof: bool` を足したら、
  // このテストは「警告が出る」側へ書き換えること。** ここが緑のままなら穴が残っている印である。
  it("⚠ トップレベルの壊れた ( で残りが消えた場合は検出できない（0 を返す＝警告が出ない）", () => {
    const savedByRust = "@media (min-width:1px){.sd-comment{color:red}}";
    expect(unclosedBlockDepth(savedByRust)).toBe(0);
  });

  it("宣言の中で壊れた ( のケースは従来どおり検出できる（こちらは塞がっている）", () => {
    // `.b{background:url(https://e/x.png;}` ＋以降 → Rust の保存結果は `.a{color:red}\n.b{`（実測）。
    expect(unclosedBlockDepth(".a{color:red}\n.b{")).toBe(1);
  });
});
