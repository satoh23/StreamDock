// 047e: CSS モジュールの「テストで守れない不変条件」を機械で守るチェッカー。
//
// ## なぜ vitest ではなくこの形なのか
//
// jsdom はレイアウトを計算せず（getBoundingClientRect は常に 0・CSS モジュールのクラスは識別子に置換され
// カスケードも走らない）、スクロールバーの有無も再現しないため、「潰れない」「切られない」は**原理的に
// 検証不能**。残る手は CSS ソースの静的検査だが、vitest からは CSS 原文を読めない——`?raw` も
// `import.meta.glob(..., { query: "?raw" })` も Vite の CSS modules 処理が先に勝って `{}` を返す（実測済み）。
//
// node で直接読めば済む話だが、テストを `src/` 配下の *.test.ts に置くと `tsconfig.json` の
// `include: ["src"]` に入り `node:fs` の型＝@types/node が要る。**`scripts/` はその include の外**なので、
// ここに素の .mjs を置けば新規依存ゼロ・typecheck 影響ゼロで同じ検査ができる。
// 先例: apps/comment-sidecar の `scripts/test-host-guard.mjs` ほか（pnpm test から素の node で直列実行）。
//
// ## なぜ必要か（コメントでは止まらなかった実績）
//
// 「flex 縦積み＋overflow:auto の子に overflow:hidden を足すと、その子だけ自動最小高さが 0 になって潰れる」
// はこのリポジトリで **3 回**発生している（035c `.card` / 043c overlay `.item` / 047c 本体 `.item`）。
// 過去 2 回とも再修正トリガー付きのコメントを残したが、3 回目は **別 CSS モジュールへ意匠を移植した際に
// コメントが付いてこなかった**ために再発した。コメントはファイル境界を越えないので、境界を越える検査が要る。
//
// 実行: `node scripts/check-css-guards.mjs`（`pnpm test` から呼ばれる）

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const readRaw = (rel) => readFileSync(join(root, rel), "utf8");

/**
 * コメントを剥がして読む。**これが無いと本チェッカーは原理的に無意味になる**——このリポジトリの CSS は
 * 不変条件を長い日本語コメントで説明しており、その本文に `flex-shrink:0` や `flex:none` という文字列が
 * そのまま含まれる。素朴に本文検索すると「宣言を消してもコメントが残っているので通る」＝**常に緑の
 * 検査**になる（初版がこれで、ミューテーション 3 種すべてが生存した）。
 * 併せて「コメント内の `{}`（`?raw` の説明文に出てくる）」がブロック抽出の `indexOf("}")` を誤爆させる
 * 問題も同時に消える。
 */
const stripCssComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "");
const stripTsComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

const read = (rel) => stripCssComments(readRaw(rel));

const VIEWER_CSS = "src/screens/comment-viewer/CommentViewerApp.module.css";
const OVERLAY_CSS = "src/screens/comment-viewer/OverlayComment.module.css";
const TONE_TS = "src/screens/comment-viewer/monetaryTone.ts";

const failures = [];
const fail = (msg) => failures.push(msg);

/**
 * セレクタのルール本体（`{ … }`）を取り出す。CSS パーサは持ち込まない（依存ゼロが本スクリプトの前提）ので、
 * 「そのセレクタで始まる最初のブロック」を素朴に切り出す。宣言の有無しか見ないのでこれで十分。
 */
function ruleBody(css, selector) {
  // 行頭のセレクタのみ対象（`.item` が `.item.itemTipCard` に誤ヒットしないよう次は `{` か `,` か空白）。
  const re = new RegExp(`^\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{`, "m");
  const m = re.exec(css);
  if (!m) return null;
  const start = css.indexOf("{", m.index);
  const end = css.indexOf("}", start);
  return end === -1 ? null : css.slice(start + 1, end);
}

/** 宣言 `prop` が値付きで存在するか（空白ゆれを吸収する）。 */
function hasDecl(body, prop, valuePattern) {
  if (body === null) return false;
  const re = new RegExp(`${prop}\\s*:\\s*${valuePattern}`, "i");
  return re.test(body);
}

// ---------------------------------------------------------------------------
// (1) 047c の不変条件: `.item` は flex 縦積みの中で縮んではいけない。
//     本体（.list / .pinnedBar / .pastList）と OBS オーバーレイの **両方**の CSS モジュールで要求する。
//     これが 3 回目の再発を生んだ「片方にしか無いガード」を直接塞ぐ。
// ---------------------------------------------------------------------------
for (const rel of [VIEWER_CSS, OVERLAY_CSS]) {
  const body = ruleBody(read(rel), ".item");
  if (!hasDecl(body, "flex-shrink", "0")) {
    fail(
      `${rel}: .item に \`flex-shrink: 0\` がありません。` +
        `flex 縦積み（overflow:auto）の子は、overflow が visible 以外のクラスを重ねた瞬間に自動最小高さが 0 になり潰れます` +
        `（035c / 043c / 047c で 3 回発生）。`,
    );
  }
}

// ---------------------------------------------------------------------------
// (2) 047c 二次防御: 上部の帯そのものも縮んではいけない。
// ---------------------------------------------------------------------------
{
  const css = read(VIEWER_CSS);
  for (const sel of [".tickerBar", ".pinnedBar"]) {
    const body = ruleBody(css, sel);
    const guarded =
      hasDecl(body, "flex", "none") || hasDecl(body, "flex-shrink", "0");
    if (!guarded) {
      fail(
        `${VIEWER_CSS}: ${sel} に \`flex: none\`（または flex-shrink: 0）がありません。` +
          `.root の flex 縦積みで帯自身が潰れます。`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// (3) 047d の不変条件: 高さが外から与えられる（align-items:stretch）横スクロール領域は、
//     スクロールバーに縦を食わせず、かつ中身の実高を下限として持つこと。
// ---------------------------------------------------------------------------
{
  const css = read(VIEWER_CSS);
  const body = ruleBody(css, ".tickerTrack");
  if (!hasDecl(body, "scrollbar-width", "none")) {
    fail(`${VIEWER_CSS}: .tickerTrack に \`scrollbar-width: none\` がありません（047d）。`);
  }
  if (!hasDecl(body, "min-height", ".+")) {
    fail(
      `${VIEWER_CSS}: .tickerTrack に \`min-height\` がありません（047d 二次防御）。` +
        `overflow-y:hidden がピルを上下から切ります。`,
    );
  }
  if (!/\.tickerTrack::-webkit-scrollbar\s*\{[^}]*display\s*:\s*none/.test(css)) {
    // css はコメント除去済みなので、説明文中の同名文字列では通らない。
    fail(
      `${VIEWER_CSS}: .tickerTrack::-webkit-scrollbar { display: none } がありません（047d）。` +
        `実行環境の WKWebView は scrollbar-width をまだ見ないため、こちらが実効です。`,
    );
  }
}

// ---------------------------------------------------------------------------
// (4) 047b の不変条件（レビュー Q-6）: tone → クラスの対応表は 2 つの CSS モジュールに分かれている。
//     `Record<MonetaryTone, string>` は**キーの当て漏れ**しか落とせず、「Record には足したが CSS に
//     ルールを書き忘れた」場合は CSS modules が undefined を返して**無音で無配色**になる。
//     monetaryTone.ts が参照しているクラスが実在するかを、両モジュールに対して突き合わせる。
// ---------------------------------------------------------------------------
{
  const toneTs = stripTsComments(readRaw(TONE_TS));
  const viewerCss = read(VIEWER_CSS);
  const overlayCss = read(OVERLAY_CSS);

  const refs = [
    { re: /\bstyles\.([A-Za-z0-9_]+)/g, css: viewerCss, rel: VIEWER_CSS },
    { re: /\boverlayStyles\.([A-Za-z0-9_]+)/g, css: overlayCss, rel: OVERLAY_CSS },
  ];

  let total = 0;
  for (const { re, css, rel } of refs) {
    const names = [...toneTs.matchAll(re)].map((m) => m[1]);
    if (names.length === 0) {
      fail(`${TONE_TS}: クラス参照を 1 つも抽出できませんでした（このチェッカーの想定と実装がずれています）。`);
      continue;
    }
    total += names.length;
    for (const name of new Set(names)) {
      if (!new RegExp(`^\\s*\\.${name}\\s*[{,]`, "m").test(css)) {
        fail(
          `${rel}: .${name} が定義されていません（${TONE_TS} が参照）。` +
            `tone を足すときは 2 つの CSS モジュール両方にルールが要ります。`,
        );
      }
    }
  }
  // 表が 2 本とも同数であること（片方だけ tone を足した状態を検出する）。
  if (total % 2 !== 0) {
    fail(`${TONE_TS}: TONE_CLASS と OVERLAY_TONE_CLASS の項目数が一致していません。`);
  }
}

// ---------------------------------------------------------------------------
if (failures.length > 0) {
  console.error("CSS guard check FAILED:\n");
  for (const f of failures) console.error(`  - ${f}\n`);
  process.exit(1);
}
console.log("CSS guard check OK");
