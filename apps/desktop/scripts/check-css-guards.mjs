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
// ## ⚠ 名前は「CSS」だが CSS 専用ではない（055e レビュー Q-3）
//
// 047e は CSS モジュール専用として始まったが、いまは (4) / (6-d) が TS / TSX のソース文字列を、
// (9) が **リリースノート描画のセキュリティ不変条件**（生 HTML / リンク / 外部リソースの不在）を
// 見ている。＝**「テストでは守れない不変条件を静的に守る」チェッカー**と読むのが正しい。
// `check-ui-guards.mjs` への改名は `package.json` の `check:css` を触る必要があり、
// 055e の完了条件（新規依存ゼロ＝`package.json` 差分ゼロ）と衝突するので**別タスクに送る**。
//
// 実行: `node scripts/check-css-guards.mjs`（`pnpm test` から呼ばれる）

import { readFileSync, readdirSync } from "node:fs";
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
/**
 * ⚠ **既知の限界**（security-review②・Q-3）: `//` を文脈なしで消すので、
 * **文字列リテラルの中の `//`（`"http://…"`）以降がその行ごと消える**。
 * ＝ 同じ行の後半に書かれた禁止 API（(10-i) の `.innerHTML =` 等）を見落としうる。
 * 実害の確率は低い（本チェッカーが見るのは「無いこと」で、退行は普通そんな行に書かれない）が、
 * **(10-i) は「守っているのはこの検査だけ」と自称している**ので限界は明示しておく。
 * 再修正トリガー＝ここを厳密にする必要が出たら、正規表現ではなく素の TS パーサ
 * （`typescript` は既に devDependency にある）で読むこと。**新規依存は要らない。**
 */
const stripTsComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

const read = (rel) => stripCssComments(readRaw(rel));

/**
 * 060d(security-review S-5): `src/` 配下の `.ts` / `.tsx` を**コメントを剥がして**すべて読む。
 *
 * (10-i) が「注入するファイルの列挙」から「**リポジトリ全体の禁止 ＋ 生成箇所の allow-list**」へ
 * 変わったため、ファイル名を数える代わりに木を歩く。⚠ テストファイルも含める——本番だけ検査すると
 * 「テストが `innerHTML` で書かれているので本番の不在が意味を失う」形の抜けが残る。
 */
function collectTsSources(relDir) {
  const out = [];
  const walk = (rel) => {
    for (const entry of readdirSync(join(root, rel), { withFileTypes: true })) {
      const child = `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(child);
      else if (/\.tsx?$/.test(entry.name))
        out.push([child, stripTsComments(readRaw(child))]);
    }
  };
  walk(relDir);
  return out;
}

const VIEWER_CSS = "src/screens/comment-viewer/CommentViewerApp.module.css";
const OVERLAY_CSS = "src/screens/comment-viewer/OverlayComment.module.css";
const TONE_TS = "src/screens/comment-viewer/monetaryTone.ts";
const SETTINGS_TSX = "src/screens/comment-viewer/SettingsView.tsx";
// 060a: オーバーレイの「セレクタ契約」（安定クラス・CSS 変数）を持つ 4 本。
const COMMENT_LIST_TSX = "src/screens/comment-viewer/CommentList.tsx";
const OVERLAY_APP_TSX = "src/screens/comment-viewer/OverlayApp.tsx";
const PINNED_OVERLAY_TSX = "src/screens/comment-viewer/PinnedOverlayApp.tsx";
const CSS_COMPAT_TS = "src/features/comment-viewer/cssCompat.ts";
// 060d: ユーザー CSS を実際に注入する側の 3 本（(10-h) / (10-i)）。
const CSS_SCOPE_TS = "src/features/comment-viewer/cssScope.ts";
const THEME_CARD_TSX = "src/screens/comment-viewer/OverlayThemeCard.tsx";
// 055c: 本チェッカー初のメインウィンドウ側 CSS（それまでは comment-viewer 配下 4 本のみが対象だった）。
const HEADER_CSS = "src/components/Header.module.css";
const UPDATE_CSS = "src/screens/app-update/UpdateScreen.module.css";

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

/**
 * 宣言 `prop` が値付きで存在するか（空白ゆれを吸収する）。
 *
 * 先頭を `(?:^|;|\{)` で縛るのは **プロパティ名の部分一致を防ぐため**。これが無いと `prop="color"` が
 * `background-color: …` に一致してしまい、054 レビューの実測で次の 2 方向の事故が両方起きた:
 *   - 偽陰性: `.fieldLabel { color: var(--muted); background-color: var(--text); }` が (6-a) を素通りする
 *   - 偽陽性: `.speakerField` に `background-color` を足しただけで (6-c) が「color が戻っています」で落ちる
 *     （＝正しい CSS なのに fail し、しかもメッセージが真因と食い違う。(5-b) が戒めた失敗と同型）
 * `border-color` を prop に使う (5-a)/(5-b') を含め、既存 (1)〜(5) はすべて宣言が本体先頭か `;` 直後に
 * あるので、この縛りを足しても通る（ミューテーションで非退行を確認済み）。
 */
function hasDecl(body, prop, valuePattern) {
  if (body === null) return false;
  const re = new RegExp(`(?:^|;|\\{)\\s*${prop}\\s*:\\s*${valuePattern}`, "i");
  return re.test(body);
}

/**
 * ルール本体から宣言 `prop` の値を取り出す（末尾のセミコロン省略も拾う）。
 * 先頭を `(?:^|;)` で縛るのは `color` が `background-color` に誤ヒットするのを防ぐため（`hasDecl` と同じ理由）。
 * 値は**正規化して返す**——空白を畳み、括弧内の空白を詰め、`!important` を落とす。これが無いと
 * 突き合わせ相手を複数行値（`var(\n --text\n)`）や `!important` 付きに書き換えただけで、**値としては同じなのに**
 * 検査が落ちる（正しい CSS で fail する＝(5-b) が戒めた失敗と同型）。
 * (6) の「.fieldLabel を .toggleLabel に一致させる」と (7) の「余白の 2 段」で共用する。
 */
function declValue(body, prop) {
  if (body === null) return null;
  const m = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;{}]+)`, "i").exec(body);
  if (!m) return null;
  return m[1]
    .replace(/\s+/g, " ")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/\s*!important$/i, "")
    .trim();
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
// (5) 051 の不変条件: 「その配信で初めてしたコメント」は **初見と同じ枠色**で囲まれ、
//     **課金カードの上では枠色を当てない**（バッジのみ）こと。
//     コンポーネント側のテストでは**原理的にここを守れない**——CSS モジュールは vitest 上で
//     **存在しないキーでも文字列を返す**（実測: `styles.nonExistentKey` → `"_nonExistentKey_<hash>"`）ため、
//     `className` に `styles.itemFirstComment` が入っていることを確かめても、CSS 側にルールが
//     **無い／クラス名を打ち間違えている**状態がそのまま緑になる。色も jsdom では解決されないので、
//     「ルールが実在し、初見と同じトークンを指していること」をここで押さえる。
// ---------------------------------------------------------------------------
{
  const css = read(VIEWER_CSS);
  // (5-a) 枠色が初見（--ok）と同じであること。
  const firstTime = ruleBody(css, ".itemFirstTime");
  const firstComment = ruleBody(css, ".itemFirstComment");
  if (firstComment === null) {
    fail(
      `${VIEWER_CSS}: \`.itemFirstComment\` のルールがありません（051）。` +
        `CommentList が付けるクラスに対応する CSS が無いと、枠色が無音で消えます` +
        `（CSS モジュールは存在しないキーでも文字列を返すので、コンポーネントのテストでは検出できません）。`,
    );
  } else if (!hasDecl(firstComment, "border-color", "var\\(--ok\\)")) {
    fail(
      `${VIEWER_CSS}: \`.itemFirstComment\` の border-color が \`var(--ok)\` ではありません（051）。` +
        `「初コメは初見と同じ色の枠」が要件です。`,
    );
  }
  if (!hasDecl(firstTime, "border-color", "var\\(--ok\\)")) {
    fail(
      `${VIEWER_CSS}: \`.itemFirstTime\` の border-color が \`var(--ok)\` ではありません（038c/051）。` +
        `初見の色を変えるなら .itemFirstComment も一緒に動かすこと（051 は「初見と同じ色」で固定されています）。`,
    );
  }
  // (5-b) 課金カードの上では枠色を当てない（バッジのみ）。抑止セレクタに 3 種すべてが載っていること。
  //   ⚠ **1 ブロックに束ねられていることは要求しない**（セレクタごとに個別に探す）。束ね前提の正規表現に
  //   すると、将来ルールを 2 つに分割しただけで**正しい CSS なのに fail する**（しかもメッセージが
  //   「セレクタがありません」になり真因と食い違う）。ここで守りたいのは「抑止されているか」だけ。
  for (const name of ["itemFirstTime", "itemLongAbsence", "itemFirstComment"]) {
    const re = new RegExp(`^\\s*\\.item\\.itemTipCard\\.${name}\\s*[,{]`, "m");
    if (!re.test(css)) {
      fail(
        `${VIEWER_CSS}: 課金カードの枠色抑止セレクタに \`.item.itemTipCard.${name}\` がありません（047b/051）。` +
          `ヘッダ帯の色が主信号なので、判定の枠色をカードに当てると信号が競合します（判定は .tipChip で出ます）。`,
      );
    }
  }
  // (5-b') セレクタが残っていても宣言が消えていれば抑止は効かない（セレクタだけの検査は素通りする）。
  //   セレクタは（現状）カンマで束ねられていて `ruleBody` の「セレクタ直後が `{`」に当たらないので、
  //   一致位置から次のブロックを自前で切り出す。
  const suppressAt = /^\s*\.item\.itemTipCard\.itemFirstTime\s*[,{]/m.exec(css);
  const suppressOpen = suppressAt ? css.indexOf("{", suppressAt.index) : -1;
  const suppressClose = suppressOpen === -1 ? -1 : css.indexOf("}", suppressOpen);
  const suppressBody =
    suppressClose === -1 ? null : css.slice(suppressOpen + 1, suppressClose);
  if (!hasDecl(suppressBody, "border-color", ".+")) {
    fail(
      `${VIEWER_CSS}: 課金カードの枠色抑止ルールに \`border-color\` の宣言がありません（047b/051）。` +
        `セレクタだけ残して宣言を消すと、判定の枠色がカードに出たままになります。`,
    );
  }
  // (5-c) チップ色も同じ穴を持つ。「初コメは初見と同じ色」を値の重複ではなくセレクタの束ねで
  //   担保しているので、`.badgeFirstComment` が束ねから外れると**無音で無彩色に戻る**
  //   （CSS モジュールは存在しないキーでも文字列を返すため、コンポーネントのテストでは検出できない）。
  const badgeRule = /^\s*\.badgeFirstTime\s*,\s*\n?\s*\.badgeFirstComment\s*\{/m.test(css);
  if (!badgeRule) {
    fail(
      `${VIEWER_CSS}: \`.badgeFirstTime, .badgeFirstComment\` の束ねルールがありません（051）。` +
        `「初コメのチップは初見と同じ色」を値の重複ではなくセレクタの束ねで担保しているため、` +
        `外すと片方だけ色が変わる／初コメのチップが無彩色に戻る退行が無音で通ります。`,
    );
  }
}

// ---------------------------------------------------------------------------
// (6) 054 の不変条件: コメビュ窓の「設定項目名」は **1 種類の書式**で描かれ、可読テキスト
//     （設定項目名・補助説明）に **無効色 `--text-faint` を戻さない**こと。
//     (5) と同じ穴がここにもある——CSS モジュールは vitest 上で**存在しないキーでも文字列を返す**
//     （実測: `styles.nonExistentKey` → `"_nonExistentKey_<hash>"`）ため、SettingsView が
//     `<span className={styles.fieldLabel}>` を付けていることを確かめても、CSS 側にルールが
//     **無い／クラス名を打ち間違えている**状態はそのまま緑になる。font-size / font-weight / color は
//     jsdom が解決しないので、規則の実在は CSS 原文の静的検査でしか守れない。
// ---------------------------------------------------------------------------
{
  const css = read(VIEWER_CSS);

  // (6-a) 設定項目名の書式は 1 種類。基準は `.toggleLabel`（ToggleSwitch は設定画面だけでなく
  //   **本体コメントビューのツールバー**でも使うので値を動かせない）で、`.fieldLabel` をそれに**一致**させる。
  //   値をベタ書きで二重管理せず突き合わせにしているので、将来 `.toggleLabel` を動かしたときは
  //   `.fieldLabel` も一緒に動かさないとここで落ちる（＝規則が割れたまま進めない）。
  //   **落ちたときにやること**: どちらか一方に寄せて 2 つを揃える（片方だけ直して通そうとしない）。
  //   `.toggleLabel` を動かしたい場合は、本体ツールバーのトグル表示も一緒に動くことを実機で確認する。
  //   `font-size` も突き合わせる: これが無いと `.fieldLabel` だけ 11px に戻せてしまい、`.note`（12px）より
  //   項目名が小さい＝**054 が直した症状そのもの**が緑のまま通る（レビュー実測で生存を確認したため追加）。
  const fieldLabel = ruleBody(css, ".fieldLabel");
  if (fieldLabel === null) {
    fail(
      `${VIEWER_CSS}: \`.fieldLabel\` のルールがありません（054）。` +
        `SettingsView がラベル文字列に付けるクラスに対応する CSS が無いと、設定項目名が補助説明（.note）と` +
        `同じ見た目に戻ります（CSS モジュールは存在しないキーでも文字列を返すので、` +
        `コンポーネントのテストでは検出できません）。セレクタをカンマで束ねた場合もここに来るので、` +
        `束ねたのならこのガードの取り出し方も一緒に直すこと。`,
    );
  } else {
    const toggleLabel = ruleBody(css, ".toggleLabel");
    for (const prop of ["font-size", "font-weight", "color"]) {
      const expected = declValue(toggleLabel, prop);
      if (expected === null) {
        fail(
          `${VIEWER_CSS}: \`.toggleLabel\` に ${prop} がありません（054 の基準側）。` +
            `設定項目名の書式はこのルールを正として .fieldLabel と突き合わせています。`,
        );
        continue;
      }
      // 値どうしを直接比べる（`hasDecl` の前方一致だと `.fieldLabel` 側にだけ `!important` が付いた場合に
      // 素通りし、`background-color` にも一致してしまうため）。
      const actual = declValue(fieldLabel, prop);
      if (actual !== expected) {
        fail(
          `${VIEWER_CSS}: \`.fieldLabel\` の ${prop}（${actual ?? "宣言なし"}）が ` +
            `\`.toggleLabel\`（${expected}）と一致しません（054）。` +
            `同じカードにトグルの label と縦積みフィールドの label が並ぶため、書式が割れると 054 以前の` +
            `「どこが項目名で、どこが説明なのか読み取れない」状態に戻ります。サイズ・太さ・色は jsdom で` +
            `解決されないため、コンポーネントのテストでは検出できません。` +
            `直すときは片方だけでなく 2 つを揃えること。`,
        );
      }
    }
  }

  // (6-b) 無効色を可読テキストへ戻さない。`--text-faint` は theme.css で `--muted` をさらに 72% まで
  //   薄めた色＝「押せない」を意味する濃度で、**無効状態（:disabled）専用**。
  //
  //   ⚠ 当初は `.note` / `.fieldLabel` を名指しする denylist にしていたが、それは「規則」ではなく
  //   「今あるもの」しか守らない——**新しいクラスを足して faint を誤用しても素通りする**
  //   （レビュー実測: 新設 `.fieldHint { color: var(--text-faint) }` を足す変異が生存した）。
  //   CSS 先頭で「この窓の正」として 3 段規則を宣言した以上、規則そのものを守る走査型にする。
  //
  //   走査型にすると `.pastTime`（視聴者詳細の過去コメント時刻＝**設定画面外のメタ情報**・054 の対象外で
  //   据え置くとタスクが明示指示）が**正しい CSS のまま落ちる**。(5-b) の「正しい CSS で fail させない・
  //   メッセージを真因と一致させる」を守るため、**明示の例外許可リスト**を持つ形にした
  //   （＝意図的な例外であることが機械にも読める・増えたら必ずここに理由付きで書くことになる）。
  const FAINT_ALLOWED = new Map([
    [".pastTime", "視聴者詳細の過去コメント時刻＝設定画面外のメタ情報（054 タスク (1) の明示指示で据え置き）"],
  ]);
  // ルールを素朴に列挙する（CSS パーサは持ち込まない）。`[^{}]+` はブレースを跨げないので、
  // 直前の `}` / `{` から次の `{` までが自然にセレクタになる。`@media` 自体は本体にブレースを含むため
  // マッチせず、その**中のルールは 1 件ずつ拾える**（＝将来 faint をメディアクエリ内で誤用しても捕まる）。
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1].replace(/\s+/g, " ").trim();
    if (selector.startsWith("@") || selector === "") continue;
    if (!hasDecl(m[2], "color", "var\\(--text-faint\\)")) continue;
    const parts = selector.split(",").map((s) => s.trim());
    if (parts.every((p) => p.includes(":disabled") || FAINT_ALLOWED.has(p))) continue;
    fail(
      `${VIEWER_CSS}: \`${selector}\` が \`color: var(--text-faint)\` を使っています（054）。` +
        `--text-faint は「押せない」を意味する濃度で**無効状態（:disabled）専用**です。` +
        `可読テキスト（設定項目名・補助説明）なら \`var(--muted)\` を使い、無効表現なら \`:disabled\` に付け、` +
        `それ以外の意図的な例外なら本スクリプトの FAINT_ALLOWED に理由付きで追加してください` +
        `（色は jsdom で解決されないため、コンポーネントのテストでは検出できません）。`,
    );
  }

  // (6-c) `.speakerField` は縦積みの器＝**レイアウト専用**へ戻したので typography を持たない。
  //   ここに font-size / color が戻ると `.fieldLabel` の指定と二重になり、(6-a) を通ったまま
  //   ラベル以外の子（select / input / details）まで巻き添えで効く。
  //   ルールが取り出せない場合も**素通りさせない**（`ruleBody` はセレクタ直後が `{` の形しか拾わないので、
  //   カンマで束ねると黙って検査が無効化される＝レビュー実測で生存した fail-open を塞ぐ）。
  //   `.note` も同じ理由で実在を要求する: (6-b) は走査型なので「`.note` というルールが在ること」自体は見ない。
  for (const sel of [".speakerField", ".note"]) {
    if (ruleBody(css, sel) === null) {
      fail(
        `${VIEWER_CSS}: \`${sel}\` のルールを取り出せません（054）。` +
          `削除したか、セレクタをカンマで束ねた（\`${sel}, .other { … }\`）可能性があります。` +
          `束ねたのならこのガードの取り出し方も一緒に直してください（黙って検査が無効になるのを防ぐため fail します）。`,
      );
    }
  }
  for (const prop of ["font-size", "color"]) {
    if (hasDecl(ruleBody(css, ".speakerField"), prop, ".+")) {
      fail(
        `${VIEWER_CSS}: \`.speakerField\` に ${prop} が戻っています（054）。` +
          `このクラスは display / flex-direction / gap だけを持つレイアウト用で、文字の書式は .fieldLabel が持ちます` +
          `（CSS モジュールは存在しないキーでも文字列を返すので、コンポーネントのテストでは検出できません）。`,
      );
    }
  }

  // (6-d) CSS↔TSX の逆向きを閉じる。(6-a) は「CSS にルールが在ること」しか見ないので、
  //   `SettingsView.tsx` 側で `styles.fieldLabl` のように**打ち間違えた**場合はどの層も捕まえない——
  //   typecheck は `vite/client` の `*.module.css` 宣言が `Record<string, string>` なので通り、
  //   vitest は `css: false`（既定）で存在しないキーにも文字列を返し、eslint は無関係。
  //   ⚠ (4) の `monetaryTone.ts` 突き合わせ（`styles.X` を全部抜いて CSS と照合）をこのファイルに
  //   そのまま流用してはいけない: `SettingsView.tsx` には VOICEVOX の話者スタイル `sp.styles.some(…)` /
  //   `selectedSpeaker?.styles.map(…)` があり `\bstyles\.` に衝突する（実測で誤検出）。
  //   そこで (6) が要求するクラスだけをピンポイントで見る。
  const settingsTsx = stripTsComments(readRaw(SETTINGS_TSX));
  if (!/\bstyles\.fieldLabel\b/.test(settingsTsx)) {
    fail(
      `${SETTINGS_TSX}: \`styles.fieldLabel\` の参照がありません（054）。` +
        `CSS 側に .fieldLabel があってもラベル文字列に付いていなければ、設定項目名は補助説明と同じ見た目に戻ります。` +
        `クラス名を打ち間違えても CSS モジュールは文字列を返すため、typecheck も vitest も緑のまま通ります。`,
    );
  }
}

// ---------------------------------------------------------------------------
// (7) 054 追補（E2E）の不変条件: 設定カードの縦余白は **2 段**（項目ブロック同士 > ブロック内）で、
//     この階層が反転・消失しないこと。
//     054 は書式（サイズ/太さ/色）だけを直したが、`.cardBody` の余白が `gap: 10px` の一律だったため
//     「項目名 → その説明」と「説明 → 次の項目」が同じ間隔になり、**実機では依然として読み分けられなかった**。
//     余白は jsdom が一切解決しない（getComputedStyle も getBoundingClientRect も効かない）ので、
//     (5)(6) と同じくここでしか守れない。
// ---------------------------------------------------------------------------
{
  const css = read(VIEWER_CSS);
  const cardBody = ruleBody(css, ".cardBody");
  const NOTE_PULL_SELECTOR = ".cardBody > * + .note";
  const notePull = ruleBody(css, NOTE_PULL_SELECTOR);

  // (7-a) 2 段の値がローカル var で宣言され、gap がその var を使っていること。
  //   ベタ書き（`gap: 10px`）に戻すと (7-b) の calc が指す先が消え、引き寄せ量が黙って壊れる。
  const blockGap = declValue(cardBody, "--card-block-gap");
  const innerGap = declValue(cardBody, "--card-inner-gap");
  if (cardBody === null) {
    fail(`${VIEWER_CSS}: \`.cardBody\` のルールを取り出せません（054 追補）。`);
  } else if (blockGap === null || innerGap === null) {
    fail(
      `${VIEWER_CSS}: \`.cardBody\` に \`--card-block-gap\` / \`--card-inner-gap\` の宣言がありません（054 追補）。` +
        `設定カードの縦余白は「項目ブロック同士」と「ブロック内」の 2 段で、` +
        `\`${NOTE_PULL_SELECTOR}\` の引き寄せ量はこの 2 つの差分で決まります。値をベタ書きに戻すと` +
        `階層が黙って壊れます（余白は jsdom で解決されないため、コンポーネントのテストでは検出できません）。`,
    );
  } else if (declValue(cardBody, "gap") !== "var(--card-block-gap)") {
    fail(
      `${VIEWER_CSS}: \`.cardBody\` の gap が \`var(--card-block-gap)\` ではありません（054 追補）。` +
        `項目ブロック同士の間隔は var を経由させてください（\`${NOTE_PULL_SELECTOR}\` の calc と同じ値を指すため）。`,
    );
  }

  // (7-b) 補助説明を直前の項目へ引き寄せるルールが実在し、量が **2 段の差分**で書かれていること。
  //   `-6px` のようにベタ書きすると、上の var を動かしたときに追随せず階層が壊れる（二重管理になる）。
  const EXPECTED_PULL = "calc(var(--card-inner-gap) - var(--card-block-gap))";
  if (notePull === null) {
    fail(
      `${VIEWER_CSS}: \`${NOTE_PULL_SELECTOR}\` のルールがありません（054 追補）。` +
        `これが無いと補助説明が項目ブロック同士と同じ間隔で並び、「どこからどこまでが 1 つの設定か」が` +
        `読み取れない 054 以前の状態に戻ります（書式だけ直しても実機では読み分けられなかった、が起票理由）。`,
    );
  } else if (declValue(notePull, "margin-top") !== EXPECTED_PULL) {
    fail(
      `${VIEWER_CSS}: \`${NOTE_PULL_SELECTOR}\` の margin-top が \`${EXPECTED_PULL}\` ではありません（054 追補）。` +
        `引き寄せ量は「ブロック内 − ブロック同士」の差分で書いてください。ベタ書きにすると ` +
        `--card-block-gap / --card-inner-gap を動かしたときに追随せず、余白の階層が無音で壊れます。`,
    );
  }

  // (7-c) 階層そのものの担保。ブロック内がブロック同士以上になったら、詰めた意味が消える（むしろ逆転する）。
  const px = (v) => (v !== null && /^-?[\d.]+px$/.test(v) ? parseFloat(v) : null);
  const blockPx = px(blockGap);
  const innerPx = px(innerGap);
  if (blockGap !== null && innerGap !== null) {
    if (blockPx === null || innerPx === null) {
      fail(
        `${VIEWER_CSS}: \`.cardBody\` の --card-block-gap（${blockGap}）/ --card-inner-gap（${innerGap}）が` +
          `px 値ではありません（054 追補）。大小関係を機械で確かめられなくなるので px で書いてください。`,
      );
    } else if (!(innerPx < blockPx)) {
      fail(
        `${VIEWER_CSS}: \`.cardBody\` の余白の階層が反転しています（054 追補）——` +
          `--card-inner-gap（${innerGap}）は --card-block-gap（${blockGap}）より**小さい**必要があります。` +
          `ブロック内がブロック同士以上に開くと、設定項目とその説明が別のかたまりに見えます。`,
      );
    }
  }

  // (7-d) ブロック内の間隔が 2 系統に割れないこと。`.speakerField`（項目名 → コントロールの縦積み）は
  //   var を直接参照できない（.cardBody の外で使われると var 未定義で gap が無効化されるため）ので、
  //   同値であることをここで突き合わせる。
  const speakerFieldGap = declValue(ruleBody(css, ".speakerField"), "gap");
  if (innerGap !== null && speakerFieldGap !== innerGap) {
    fail(
      `${VIEWER_CSS}: \`.speakerField\` の gap（${speakerFieldGap ?? "宣言なし"}）が ` +
        `\`.cardBody\` の --card-inner-gap（${innerGap}）と一致しません（054 追補）。` +
        `「項目名 → コントロール」も「コントロール → 説明」も同じ 1 ブロックの中なので、値が割れると` +
        `ブロックの内側だけリズムが崩れます。片方だけ直さず 2 つを揃えてください` +
        `（.speakerField が var を直接参照しないのは、.cardBody の外で使われたとき gap が無効化されるのを避けるため）。`,
    );
  }
}

// ---------------------------------------------------------------------------
// (8) 055c の不変条件: アップデート通知まわりの「意匠に見えるが要件である」2 つの宣言。
//     どちらも **jsdom では原理的に検証できず**（カスケードも max-height も解決されない）、
//     055c security-review のミューテーションで **どちらも生存**（消しても全テストが緑）だった。
//     これまでは CSS コメントだけが守っていたが、本チェッカーの冒頭が記録しているとおり
//     **コメントはファイル境界を越えない**（035c / 043c / 047c で 3 回再発した理由）ので機械で止める。
// ---------------------------------------------------------------------------
{
  // (8-a) ベルの `opacity: 1` は**意匠ではなくコントラストの要件**。`.navBtn` は opacity: 0.72 を持ち、
  //       `opacity` は子要素へ合成として効くので `.navBadge` 側で 1 と書いても親より濃くできない。
  //       0.72 のままだとバッジ地が帯（--primary）と合成され、**ダークで 2.87:1**（非テキスト要素の
  //       3:1 未満）まで落ちる。1 に戻して初めて 3.94:1 という前提が成立する。
  //       ⚠ ライトでは合成後も 5.22:1 で 3:1 を満たすため、**この宣言はダークでのみ実効**。
  //       「ライトで見た限り問題ない」を根拠に消されやすいので、ここで両テーマ分まとめて守る。
  const bell = ruleBody(read(HEADER_CSS), ".navBtn.hasUpdate");
  if (!hasDecl(bell, "opacity", "1")) {
    fail(
      `${HEADER_CSS}: .navBtn.hasUpdate に \`opacity: 1\` がありません（055c）。` +
        `.navBtn の opacity: 0.72 は子へ合成として効くため .navBadge 側では打ち消せず、` +
        `バッジ地が帯（--primary）と合成されてダークで 2.87:1（3:1 未満）まで落ちます。` +
        `意匠ではなくコントラストの要件です。`,
    );
  }

  // (8-b) リリースノートの丈の制御（055b review S-5）。`notes` は latest.json 由来で
  //       **minisign 署名の対象外**＝長さ無制限の未署名データ。ReleaseNotes.tsx の clampNotes()
  //       （20,000 字）が DOM に載る前に切る第 1 段で、こちらは縦に伸び続けないための第 2 段。
  //       これが消えると 20,000 字が伸び切り、**055d で右下のアップデートボタンを画面外へ押し出す**。
  const notes = ruleBody(read(UPDATE_CSS), ".notesBody");
  for (const [prop, pattern, why] of [
    ["max-height", ".+", "縦に伸び続けます"],
    ["overflow-y", "auto|scroll", "はみ出した分が読めなくなります"],
  ]) {
    if (!hasDecl(notes, prop, pattern)) {
      fail(
        `${UPDATE_CSS}: .notesBody に \`${prop}\` がありません（055c / 055b review S-5）。${why}。` +
          `notes は未署名（minisign の対象外）かつ長さ無制限の外部文字列で、` +
          `伸び切ると 055d のアップデートボタンを画面外へ押し出します。` +
          `文字数側の上限は ReleaseNotes.tsx の clampNotes() が持ちます（2 段構え・両方必要）。`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// (9) 055e の不変条件: リリースノート描画の**面**をソース文字列で固定する。
//
//     ⚠ **ランタイムのテストとの役割分担（055e レビュー Q-2 で訂正）**。当初ここには
//     「React 要素しか組まないので『結果に生 HTML が混ざらない』は構造的に必ず通る＝空虚で、
//     ミューテーションでも殺せない」と書いていたが、**これは誤り**だった。レビューの実測では
//     `dangerouslySetInnerHTML` を足す変異も `createElement("a", { href })` を足す変異も
//     **ランタイムのテストが殺し、当時のこのガードのほうがすり抜けた**
//     （`UpdateScreen.test.tsx` の `<img>`/`<b>` 非解釈、`renderReleaseNotes.test.tsx` の `<a>` ゼロ）。
//     正しい分担はこう:
//       - **ランタイムのテスト**… 描画結果に現れる違反（生 HTML・`<a>`・属性への流入）を殺す。**空虚ではない**。
//       - **本ガード (9)** … 描画結果に**現れないのにソースには現れる**追加を殺す
//         ——別ファイルへ経路を足す・needle を回避する書き方・clamp の順序（(9-b)）・クラス名の乖離（(9-c)）。
//     ＝**両方が要る**。ランタイム側を「どうせ空虚だから」と消さないこと（消すと (9-a) が単独では
//     `createElement` 経由の `<a>` を止められない）。
//
//     ⚠ **なぜ別スクリプトに分けないのか**。①055e の完了条件が「**新規依存ゼロ＝`package.json` 差分ゼロ**」
//     なので、`check:*` を 1 行足すとその担保が崩れる（`pnpm test` は既に `check:css` を呼んでいる）。
//     ②本スクリプトは既に (4) / (6-d) で **TS / TSX のソース文字列**を照合しており、CSS 専用ではない。
//
//     ⚠ 照合は `stripTsComments()` を通した後で行う。`ReleaseNotes.tsx` の JSDoc は
//     「`dangerouslySetInnerHTML` を使わない」と**書いている**ので、剥がさないと**正しいコードで落ちる**
//     （(5-b) が戒めた「正しいコードで fail させない」と同型）。本スクリプトは**自分自身を読まない**ので、
//     needle をここに書いても自己ヒットはしない（Rust 側が踏んだ罠はここでは起きない）。
//     ⚠ ただし `stripTsComments` は**文字列リテラル中の `//` も行末まで落とす**（雑なので）。
//     `const a = "x//y";` と**同じ行に**違反を書かれると見逃す。prettier が整形する以上ほぼ起きないので
//     受容するが、needle を増やすときはこの性質を前提にすること（→ (9-a) の `http` の項）。
// ---------------------------------------------------------------------------
{
  const APP_UPDATE_DIR = "src/screens/app-update";
  const RENDER_TSX = `${APP_UPDATE_DIR}/renderReleaseNotes.tsx`;
  const NOTES_TSX = `${APP_UPDATE_DIR}/ReleaseNotes.tsx`;

  /**
   * (9) 用の読み取り。ファイルが無い（リネーム / 移動）ときに `node:fs` の**生スタックトレース**で
   * 死ぬと真因が読めない（(5-b) の「メッセージが真因と一致する」原則から外れる）ので、
   * ガードの失敗として報告する。⚠ **fail-open にはしない**——`null` を返した側は必ず fail() 済み。
   */
  const readSource = (rel, why) => {
    try {
      return stripTsComments(readRaw(rel));
    } catch {
      fail(`${rel} を読めません（リネーム / 移動しましたか？）。${why}`);
      return null;
    }
  };

  // (9-a) 描画面に「生 HTML」「リンクを開く」「外部リソース」の 3 経路を作らない。
  //   `notes` / `latestVersion` は latest.json 由来で **minisign 署名の対象外**（未署名）＝
  //   HTTPS で守られるだけの外部文字列なので、テキストノードと React 要素以外にしない。
  //
  //   ⚠ **対象はファイル名の列挙ではなくディレクトリ走査**（055e レビュー S-1）。当初は 3 本を
  //   名指ししていたが、それだと **`dangerouslySetInnerHTML` を同ディレクトリの新規ファイルへ置くだけで
  //   ガードが緑のまま通る**（実測済み）。「将来足されること」を止めるのが目的なので、
  //   **ファイルを足す**という最も自然な足し方に穴があってはいけない。
  //   ⚠ needle に `https://` を使わないのは、`stripTsComments` が `//` 以降を落とすため
  //   `const u = "https://…"` が `const u = "https:` に化けて**すり抜ける**から（`http` なら残る）。
  const FORBIDDEN_ANYWHERE = [
    ["dangerouslySetInnerHTML", "未署名の外部文字列を HTML として解釈する経路になります"],
    ["openUrl", "外部 URL を開く経路（リンクを踏ませない・055e の決定）"],
    ["plugin-opener", "外部 URL を開く経路（リンクを踏ませない・055e の決定）"],
    ["window.open", "外部 URL を開く経路（リンクを踏ませない・055e の決定）"],
    ["<a ", "リンク要素（踏める導線）を作っています"],
    ["href=", "リンク要素（踏める導線）を作っています"],
  ];
  //   ⚠ **こちらはレンダラ本体（2 本）にだけ掛ける**（055e レビュー S-1 / 申し送り 6）。
  //   外部リソース参照は「リリースノートの文字列から作らせない」ための needle であって、
  //   アップデート画面**全体**の禁止事項ではない。3 本目（UpdateScreen.tsx）以降にも掛けると、
  //   将来この画面が正当な理由で `src=` や `http` を使った瞬間に**正しいコードで落ちる**。
  const FORBIDDEN_IN_RENDERER = [
    ["http", "外部リソース / 外部宛先を参照しています（§9 の URL 非表示にも触れます）"],
    ["src=", "外部リソース（画像等）を読み込んでいます"],
    ["url(", "外部リソース（画像・フォント）を読み込んでいます"],
  ];

  const sources = readdirSync(join(root, APP_UPDATE_DIR))
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
    .map((f) => `${APP_UPDATE_DIR}/${f}`)
    .sort();

  // レンダラ本体が消える / リネームされると (9-a) の強い側も (9-b)/(9-c) も無意味になるので、
  // **在ることそのもの**を先に要求する（走査方式にした副作用で ENOENT では落ちなくなったため）。
  for (const rel of [RENDER_TSX, NOTES_TSX]) {
    if (!sources.includes(rel)) {
      fail(
        `${rel} がありません（055e）。リリースノートの描画点とレンダラはこの 2 本に閉じているのが前提で、` +
          `リネーム / 移動すると (9-a) の外部リソース検査・(9-b) の clamp 順序・(9-c) のクラス名検査が` +
          `まとめて無効になります。移すなら本ガードの対象も併せて更新してください。`,
      );
    }
  }

  for (const rel of sources) {
    const code = readSource(rel, "(9-a) の検査ができません。");
    if (code === null) continue;
    const needles =
      rel === RENDER_TSX || rel === NOTES_TSX
        ? [...FORBIDDEN_ANYWHERE, ...FORBIDDEN_IN_RENDERER]
        : FORBIDDEN_ANYWHERE;
    for (const [needle, why] of needles) {
      if (code.includes(needle)) {
        fail(
          `${rel}: \`${needle}\` を使っています（055e）。${why}。` +
            `リリースノートは **React 要素としてしか組まない**のが要件で、` +
            `リンクを踏ませたくなったら https 限定＋ホスト検証を入れたうえで別タスクにしてください。`,
        );
      }
    }
  }

  // (9-b) **clamp が先・パースが後**。055c review Q-4 が予告した罠（描画点と丈の制御が同居しているため、
  //   ReleaseNotes.tsx を書き直す形の作業をすると clampNotes が自然に消える）の 2 段目。
  //   `UpdateScreen.test.tsx` の S-5 は「打ち切られること」を見るので**順序までは固定できない**——
  //   `clampNotes(renderReleaseNotes(...))` は型で落ちるが、パースしてから別の場所で切る書き方だと
  //   パーサに 20,000 字超が渡ったまま緑になる。ここで呼び出しの形そのものを固定する。
  //   空白を落として比べるのは、prettier が引数を改行しただけで**正しいコードが落ちる**のを避けるため
  //   （Rust 側の `code_compact()` と同じ理由）。
  //
  //   ⚠ **これは「形」の検査であって「振る舞い」の検査ではない**（055e レビュー S-3・修正不要と判断）。
  //   同じ形をデッドコードに 1 つ置いておけば、実経路が `renderReleaseNotes(notes)` でも本検査は通る
  //   （実測済み）。それでも直さないのは、その変異を **S-5 テストが独立に殺す**から
  //   ——2 段構えの片側が「形」、もう片側が「振る舞い」を見ており、両方を同時に欺くのは
  //   「clamp を消す」という単純な退行では起こらない。AST を読む方向は依存ゼロの前提と釣り合わない。
  //   **再修正のトリガー**: S-5 テストを消す / 弱める変更が入るなら、ここも AST か描画結果ベースへ格上げする。
  const notesCode = readSource(NOTES_TSX, "(9-b) の検査ができません。")?.replace(/\s+/g, "");
  if (notesCode !== undefined && !notesCode.includes("renderReleaseNotes(clampNotes(")) {
    fail(
      `${NOTES_TSX}: \`renderReleaseNotes(clampNotes(…))\` の呼び出しがありません（055e / 055b review S-5）。` +
        `**先に clamp してからパースする**のが要件です（パーサに 20,000 字超を渡さない）。` +
        `clampNotes() を消した／外した／順序を入れ替えた可能性があります。` +
        `文字数の上限は clampNotes()、丈の上限は .notesBody の max-height の **2 段構えで両方必要**です。`,
    );
  }

  // (9-c) CSS↔TSX の逆向きを閉じる（(6-d) と同じ穴）。(8-b) は CSS 側にルールが在ることしか見ないので、
  //   TSX 側でクラス名を変えると **max-height / overflow-y が当たらなくなるのにガードは緑のまま**になる。
  //   CSS モジュールは存在しないキーでも文字列を返すため、typecheck は捕まえられない。
  //
  //   ⚠ **この検査が見ているのは「ファイルから名前が消えていないこと」だけ**（055e レビューで実測・
  //   修正不要と判断）。`ReleaseNotes.tsx` には `styles.notesBody` が **2 箇所**ある
  //   （本体の `<div>` と、空 notes のフォールバック `<p>`）ので、**本体だけを別名に変えても
  //   もう片方が残っていて本検査は通る**。＝ここは「片方だけのリネーム」を殺せない。
  //   それでも needle を `className={styles.notesBody}` の形まで狭めないのは、本体に正当な理由で
  //   2 つ目のクラスが付いた瞬間に**正しいコードで落ちる**から（(5-b) が戒めた失敗と同型）。
  //   **片方だけのリネームは `UpdateScreen.test.tsx` が殺す**——複数のテストが
  //   `[class*="notesBody"]` で本体を引いて `not.toBeNull()` しているため（実測で killed を確認）。
  //   ＝ (9) 全体の役割分担（上の冒頭コメント）どおり、**描画結果に現れる違反はランタイム側の担当**。
  //   **再修正のトリガー**: `UpdateScreen.test.tsx` から `[class*="notesBody"]` の参照が無くなるとき。
  const notesRaw = readSource(NOTES_TSX, "(9-c) の検査ができません。");
  if (notesRaw !== null && !/\bstyles\.notesBody\b/.test(notesRaw)) {
    fail(
      `${NOTES_TSX}: \`styles.notesBody\` の参照がありません（055c / 055e）。` +
        `(8-b) は CSS 側の \`.notesBody\` しか見ないので、TSX 側でクラス名を変えると` +
        `max-height / overflow-y が当たらないまま検査だけが通り、` +
        `長い notes が右下のアップデートボタンを画面外へ押し出します。`,
    );
  }
}

// ---------------------------------------------------------------------------
// (10) 060a の不変条件: オーバーレイの**セレクタ契約**——安定クラス（`sd-*`）・窓を分ける `sd-overlay`・
//      CSS 変数（`--sd-*`）・セレクタ変換表。
//
//      ⚠ **なぜここなのか（ランタイムのテストとの役割分担）**。(9) 冒頭が確立した分担と同じ:
//        - **ランタイムのテスト**（`CommentList.test.tsx`）… 「実際に DOM に付くこと」を殺す。安定クラスは
//          CSS モジュールではなく**素の文字列**なので `querySelector(".sd-comment")` が実効的に効く
//          ＝(5)(6) のような「テストでは原理的に守れない」状況ではない。**消さないこと。**
//        - **本ガード (10)** … ①**3 ファイルにまたがる対応表の整合**（契約一覧 ⇔ DOM ⇔ 変換表。(4) の
//          tone 表と同型）②**jsdom が一切解決しない CSS の実値**（フォールバック値＝現行意匠）。
//
//      ⚠ **安定クラスはユーザーの CSS との契約**であって StreamDock の内部名ではない。リネームすると
//      StreamDock 側はテストを一緒に書き換えれば緑のまま通るが、**ユーザーのテーマは全部壊れる**。
//      契約の一覧を下に置いてあるのは、変更が必ず**このファイルの diff に現れる**ようにするため
//      （(6-b) の FAINT_ALLOWED と同じ「例外・契約は機械にも読める形で残す」作法）。
// ---------------------------------------------------------------------------
{
  /** 060a の安定クラス契約（docs/tasks/060a-overlay-selector-contract.md が正）。 */
  const STABLE_CLASSES = [
    ["sd-comment", "コメント 1 件（chat / 課金 共通の <li>）"],
    ["sd-comment-tip", "課金カードであること"],
    ["sd-comment-name", "投稿者名（chat の .name と課金の .cardName）"],
    ["sd-comment-source", "サイト名バッジ"],
    ["sd-comment-icon", "アイコン"],
    ["sd-comment-body", "吹き出し／カード本体（.bubble と .cardBody）"],
    ["sd-comment-text", "本文テキスト（.text と .cardText）"],
    ["sd-comment-amount", "金額バッジ"],
    ["sd-comment-event", "種別の要約文"],
  ];

  const listTsx = stripTsComments(readRaw(COMMENT_LIST_TSX));
  const overlayAppTsx = stripTsComments(readRaw(OVERLAY_APP_TSX));
  const pinnedTsx = stripTsComments(readRaw(PINNED_OVERLAY_TSX));
  const compatTs = stripTsComments(readRaw(CSS_COMPAT_TS));

  // (10-a) 契約の安定クラスが実際に DOM を組む側へ付いていること。
  //   ⚠ 照合前に `stripTsComments` を通すのが必須——`CommentList.tsx` の 060a 注記は説明のために
  //   クラス名を**本文に書いている**ので、剥がさないと「連結を外してもコメントが残っているので通る」
  //   ＝常に緑の検査になる（本チェッカー初版が踏んだ失敗と同型）。
  //   ⚠ 境界に `\b` を使ってはいけない——`-` は非単語文字なので `\bsd-comment\b` は
  //   **`sd-comment-tip` の中にも一致する**（実測: 素の `sd-comment` だけを外す変異が生存した）。
  //   `cssCompat.ts` の置換と同じく、識別子文字を否定する lookaround で挟む。
  const classToken = (cls) =>
    new RegExp(`(?<![A-Za-z0-9_-])${cls}(?![A-Za-z0-9_-])`);
  for (const [cls, role] of STABLE_CLASSES) {
    if (!classToken(cls).test(listTsx)) {
      fail(
        `${COMMENT_LIST_TSX}: 安定クラス \`${cls}\`（${role}）がありません（060a）。` +
          `これはユーザーのカスタム CSS との**契約**で、消す/リネームすると StreamDock 側は` +
          `テストを一緒に書き換えれば緑のまま通る一方、**ユーザーのテーマが全部壊れます**。` +
          `契約を変えるなら本スクリプトの STABLE_CLASSES と ${CSS_COMPAT_TS} の変換表も一緒に更新してください。`,
      );
    }
  }

  // (10-b) 変換表の**変換先が実在する安定クラスであること**（(4) の tone 表と同型の突き合わせ）。
  //   cssCompat.ts は「純関数の置換表」なので、右辺を打ち間違えても typecheck も vitest も通る
  //   （ただの文字列）。ユーザーの CSS が黙って効かなくなるだけなので、ここで突き合わせる。
  const declared = new Set(STABLE_CLASSES.map(([c]) => c));
  const toValues = [...compatTs.matchAll(/\bto:\s*"([^"]+)"/g)].map((m) => m[1]);
  if (toValues.length === 0) {
    fail(
      `${CSS_COMPAT_TS}: 変換表の \`to:\` を 1 つも抽出できませんでした（060a）。` +
        `表の形（\`{ from, to, why }\` のオブジェクト配列）を変えたなら、本ガードの抽出も一緒に直してください` +
        `（黙って検査が無効になるのを防ぐため fail します）。`,
    );
  }
  for (const to of toValues) {
    for (const m of to.matchAll(/\.([A-Za-z0-9_-]+)/g)) {
      if (!declared.has(m[1])) {
        fail(
          `${CSS_COMPAT_TS}: 変換先 \`${to}\` のクラス \`${m[1]}\` が 060a の安定クラス契約にありません。` +
            `変換表の右辺は**必ず実 DOM に存在する安定クラス**である必要があります` +
            `（存在しないクラスへ変換すると、ユーザーの CSS は「変換されたのに効かない」という最悪の状態になります）。`,
        );
      }
    }
  }

  // (10-c) 変換表の**元セレクタに sd 語彙を書かない**＝変換が冪等であることの構造的な担保。
  //   060b の決定により変換は**注入のたびに毎回**走る（保存するのは変換前の CSS）。自分の出力に
  //   当たる表を書くと 2 周目で結果が変わり、テーマの見え方が注入回数に依存して壊れる。
  const fromValues = [...compatTs.matchAll(/\bfrom:\s*"([^"]+)"/g)].map((m) => m[1]);
  if (fromValues.length === 0) {
    fail(`${CSS_COMPAT_TS}: 変換表の \`from:\` を 1 つも抽出できませんでした（060a）。`);
  }
  for (const from of fromValues) {
    if (from.includes("sd-")) {
      fail(
        `${CSS_COMPAT_TS}: 変換表の元セレクタ \`${from}\` に sd 語彙が入っています（060a）。` +
          `変換は注入のたびに毎回走る（060b の決定）ので、自分の出力に当たる表を書くと**冪等性が壊れます**。`,
      );
    }
  }

  // (10-d) 窓ルートの安定クラスは **comment-overlay 窓にだけ**付く。
  //   060d は「CSS の注入先は `comment-overlay` のみ・固定コメントは別タスク」と決めており、
  //   窓の区別をこのクラスの有無で表している。加えて `PinnedOverlayApp` は 046c の `applyFitScale` が
  //   `.root` の transform / width / height を**排他所有**しているので、そこをユーザー CSS に
  //   触らせる的を作ってはいけない（縮小フィットが壊れる）。
  if (!classToken("sd-overlay").test(overlayAppTsx)) {
    fail(
      `${OVERLAY_APP_TSX}: 窓ルートの安定クラス \`sd-overlay\` がありません（060a）。` +
        `ユーザーが CSS 変数（--sd-*）を上書きする器がこれです。無いと変数が 1 つも効きません。`,
    );
  }
  if (classToken("sd-overlay").test(pinnedTsx)) {
    fail(
      `${PINNED_OVERLAY_TSX}: 固定コメント窓に \`sd-overlay\` が付いています（060a / 060d）。` +
        `060d の注入先は \`comment-overlay\` のみで、窓の区別をこのクラスの有無で表しています。` +
        `また 046c の applyFitScale がこの窓の .root の transform / width / height を排他所有しているため、` +
        `ユーザー CSS がそこを触れると縮小フィットが壊れます。` +
        `固定窓へ広げるのは別タスク（046d と同じ広げ方）として、本ガードも併せて更新してください。`,
    );
  }

  // (10-e) **CSS 変数が実際に読まれていて、フォールバック＝現行意匠の実値のままであること。**
  //   これが「既存の意匠を 1px も変えない」と「定義したが誰も読んでいない変数を作らない」を
  //   同時に守る唯一の手段。どちらも jsdom では解決されない（色も余白も角丸も）ので、
  //   コンポーネントのテストでは**変数参照を直値へ戻す変異も、フォールバック値をずらす変異も生存する**。
  //
  //   ⚠ **フォールバック値が当て先ごとに違うのは意図どおり**（.bubble=14px / .card=12px）。だからこそ
  //   `.root` 側に既定値を「定義」してはならず、ここで**当て先ごとに**固定する。
  //
  //   ⚠ 取り出しは「セレクタで始まる**すべての**ルール」を見て 1 つでも一致すればよい形にする。
  //   `.bubble::after` は「`.bubble::before, .bubble::after { … }` の束ね」と「単独ルール」の 2 つに
  //   分かれており、先頭の 1 つだけを見る `ruleBody` では束ねのほうを掴んで**正しい CSS で落ちる**
  //   （(5-b) が戒めた失敗と同型）。
  const ruleBodies = (css, selector) => {
    const re = new RegExp(
      `^\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{`,
      "gm",
    );
    const out = [];
    for (const m of css.matchAll(re)) {
      const start = css.indexOf("{", m.index);
      const end = css.indexOf("}", start);
      if (end !== -1) out.push(css.slice(start + 1, end));
    }
    return out;
  };

  const overlayCss = read(OVERLAY_CSS);
  const SD_VAR_DECLS = [
    [".item", "--icon-size", "var(--sd-icon-size, 44px)"],
    [".item", "--icon-gap", "var(--sd-icon-gap, 28px)"],
    [".item", "margin-block", "var(--sd-comment-gap, 0px)"],
    [".name", "color", "var(--sd-name-fg, var(--overlay-name-fg))"],
    [".bubble", "background", "var(--sd-comment-bg, var(--overlay-bubble-bg))"],
    [
      ".bubble",
      "border",
      "2.5px solid var(--sd-comment-border, var(--overlay-bubble-border))",
    ],
    [".bubble", "border-radius", "var(--sd-comment-radius, 14px)"],
    [
      ".bubble::before",
      "border-right-color",
      "var(--sd-comment-border, var(--overlay-bubble-border))",
    ],
    [
      ".bubble::after",
      "border-right-color",
      "var(--sd-comment-bg, var(--overlay-bubble-bg))",
    ],
    [".text", "color", "var(--sd-comment-fg, var(--overlay-body-fg))"],
    [".card", "border-radius", "var(--sd-comment-radius, 12px)"],
    [".cardBody", "color", "var(--sd-comment-fg, var(--overlay-body-fg))"],
  ];
  for (const [sel, prop, expected] of SD_VAR_DECLS) {
    const bodies = ruleBodies(overlayCss, sel);
    if (bodies.length === 0) {
      fail(
        `${OVERLAY_CSS}: \`${sel}\` のルールを取り出せません（060a）。` +
          `削除したか、セレクタを別の形（先頭がカンマ束ね等）に変えた可能性があります。` +
          `黙って検査が無効になるのを防ぐため fail します。`,
      );
      continue;
    }
    if (!bodies.some((b) => declValue(b, prop) === expected)) {
      const actual = bodies.map((b) => declValue(b, prop)).find((v) => v !== null);
      fail(
        `${OVERLAY_CSS}: \`${sel}\` の ${prop}（${actual ?? "宣言なし"}）が ` +
          `\`${expected}\` ではありません（060a）。` +
          `**フォールバック側の値が現行の意匠そのもの**なので、ここを動かすと「既存意匠を 1px も変えない」が` +
          `破れます。逆に var() を外して直値へ戻すと、公開した --sd-* 変数を誰も読まなくなり` +
          `「定義したが効かない API」になります（どちらも色・余白・角丸なので jsdom では検出できません）。` +
          `変数を増減・改名するなら本ガードの SD_VAR_DECLS も一緒に更新してください。`,
      );
    }
  }

  // (10-f) 名前の縁取り（多重 text-shadow）は 5 箇所すべてが同じ変数を読むこと。
  //   1 箇所でも直値/別トークンに戻ると、ユーザーが縁取り色を変えたときに**その 1 層だけ元の白が残る**。
  //   値そのものの突き合わせは長すぎて壊れやすいので、出現回数で押さえる。
  const nameBody = ruleBodies(overlayCss, ".name")[0] ?? "";
  const outlineRefs = (nameBody.match(/var\(--sd-name-outline\b/g) ?? []).length;
  if (outlineRefs !== 5) {
    fail(
      `${OVERLAY_CSS}: \`.name\` の text-shadow が \`var(--sd-name-outline, …)\` を ${outlineRefs} 箇所しか` +
        `参照していません（060a・5 箇所必要）。多重 text-shadow の一部だけ直値に戻ると、` +
        `ユーザーが縁取り色を変えたときにその層だけ元の色で残ります（透過映像上の可読性はこの縁取りが握っています）。`,
    );
  }

  // (10-g) オーバーレイの DOM に **id を持たせない**（060a レビュー Q-1 の前提）。
  //   `cssCompat.ts` の `FOREIGN_ID_NAMES` は「注入された CSS に出てくる裸の id は
  //   **証明可能に死んでいる**」を根拠に、`#message` / `#img` 等を**警告専用**で拾っている。
  //   その根拠は「オーバーレイに存在する id は index.html の `#root` ただ 1 つ」という事実だけ。
  //   ここに id を 1 つ足すと、その名前が FOREIGN_ID_NAMES と衝突した瞬間に
  //   **「効くセレクタを効きませんと警告する」誤検知**へ転ぶ（警告の信頼が落ちると誰も読まなくなる）。
  //   ⚠ 意匠でも通信でもないので (10-e) のような値の検査では捕まらず、テストでも落ちない。
  //   id が必要になったら: FOREIGN_ID_NAMES にその名前が無いことを確認し、本検査を更新すること。
  for (const [rel, src] of [
    [COMMENT_LIST_TSX, listTsx],
    [OVERLAY_APP_TSX, overlayAppTsx],
    [PINNED_OVERLAY_TSX, pinnedTsx],
  ]) {
    if (/\sid\s*=/.test(src)) {
      fail(
        `${rel}: オーバーレイの DOM に id 属性が付いています（060a / レビュー Q-1）。` +
          `${CSS_COMPAT_TS} の FOREIGN_ID_NAMES は「注入された CSS の裸 id は当たらない」ことを根拠に` +
          `\`#message\` 等を**警告専用**で拾っています。id を足すなら、その名前が FOREIGN_ID_NAMES と` +
          `衝突していないことを確認し（衝突すると効くセレクタを誤警告します）、本検査も更新してください。`,
      );
    }
  }

  const scopeTs = stripTsComments(readRaw(CSS_SCOPE_TS));
  const themeCardTsx = stripTsComments(readRaw(THEME_CARD_TSX));

  // (10-h) プレビューのスコープ用クラス `sd-preview` の**定義元と使われ方**を固定する。
  //   ラッパに付けるクラスと `scopeSelectors` が前置する文字列がずれると、プレビューの CSS が
  //   **ラッパ配下に閉じず窓全体へ漏れる**（＝コメビュ窓が第三者の CSS に乗っ取られる）。
  //   リネームしても typecheck も vitest も通る——どちらもただの文字列で、漏れたことを jsdom は
  //   再現しないため。**定義を 1 か所（cssScope.ts）に置き、ラッパはそれを import する**形を強制する。
  //   ⚠ `cssCompat.ts` には**書かない**。あちらの変換表の右辺は (10-b) が「実在する安定クラス」で
  //   縛っており、`sd-preview` は実 DOM の安定クラス契約には無い（プレビューのラッパ専用）ため。
  //   060a からの申し送り③（`scopeSelectors` は cssCompat.ts と別ファイルに置くこと）を構造で固定する。
  if (!/PREVIEW_SCOPE_CLASS\s*=\s*"sd-preview"/.test(scopeTs)) {
    fail(
      `${CSS_SCOPE_TS}: \`PREVIEW_SCOPE_CLASS = "sd-preview"\` の定義がありません（060d）。` +
        `ラッパのクラス名とスコープ化に使うセレクタは**ここ 1 か所**で定義してください` +
        `（別々に書くと片方のリネームで、プレビューの CSS がコメビュ窓全体へ漏れます）。`,
    );
  }
  if (!/className=\{PREVIEW_SCOPE_CLASS\}/.test(themeCardTsx)) {
    fail(
      `${THEME_CARD_TSX}: プレビューのラッパが \`className={PREVIEW_SCOPE_CLASS}\` になっていません（060d）。` +
        `CSS モジュール経由のクラス（ハッシュ名）にすると ${CSS_SCOPE_TS} が前置する文字列と一致せず、` +
        `スコープ化が**黙って無効**になります（\`sd-overlay\` と同じく素の文字列クラスである必要があります）。`,
    );
  }
  if (classToken("sd-preview").test(compatTs)) {
    fail(
      `${CSS_COMPAT_TS}: \`sd-preview\` が 060a の変換表側に書かれています（060d・申し送り③）。` +
        `\`sd-preview\` はプレビューのラッパ専用で**実 DOM の安定クラス契約には無い**ため、` +
        `(10-b)（変換先 ⊆ 安定クラス契約）と衝突します。スコープ化は ${CSS_SCOPE_TS} に置いてください。`,
    );
  }

  // (10-i) **ユーザー CSS の注入経路を `<style>` の textContent だけに固定する。**
  //   `get_overlay_theme_css` が返す CSS には `</style>` が**そのまま含まれうる**（正当な CSS なので
  //   060b は除去しない）。`innerHTML` に入れると要素が閉じて**その後ろが HTML として解釈される**。
  //   ⚠ docs/security.md の「レビュー必須条件」がこの経路（`<style>` 生成 / insertRule /
  //   adoptedStyleSheets）を名指ししている。**ランタイムのテストでは殺せない**（jsdom は
  //   `<style>.innerHTML` に RAWTEXT のフラグメント解析を実装しておらず `textContent` と同じ結果になる）
  //   ので、この不変条件を実際に守っているのは**この検査だけ**である。
  //
  //   ⚠⚠ **向きを反転させた**（security-review S-5・2026-08-05）。旧実装は「注入する 3 ファイルに
  //   禁止語が無いこと」だけを見ており、**4 つ目の注入先が別ファイルに増えたら何も落ちなかった**。
  //   ＝「ここが落ちたら経路を増やす前にレビュー区分を確認すること」という当初の狙いを満たしていない。
  //   いまは **`src/` 全体**を見る 2 本立てにしてある:
  //     (i-1) 生 HTML / CSSOM 経由の注入 API を**リポジトリ全体で禁止**（現状 0 件なのでそのまま入る）
  //     (i-2) `<style>` / `<link>` 要素の**生成箇所を allow-list で固定**（＝ 4 つ目が増えたら落ちる）
  const injectionSources = collectTsSources("src");

  // (i-1) 生 HTML / CSSOM 経由の注入 API は**どこにも書かない**。
  //   ⚠ `document.write` / `CSSStyleSheet` / `replaceSync` も同じ理由で禁止（どれも `<style>` の
  //   textContent を経ずにスタイルを注入でき、(i-2) の allow-list を素通りする）。
  //   ⚠ 見るのは**書き込み**だけ（`innerHTML =` / `dangerouslySetInnerHTML=`）。`innerHTML` の**読み取り**は
  //   既存テストが「外部 URL が DOM に出ていないこと」を assert するのに使っており、そちらは禁止対象ではない
  //   （`CommentList.test.tsx` / `MonetaryTicker.test.tsx`）。読みまで禁止すると、その assert を
  //   弱い形へ書き換えさせることになって逆效果になる。
  //   ⚠⚠ **生 HTML を解釈する API は `innerHTML` だけではない**（security-review②・Q-2）。
  //   `insertAdjacentHTML` / `setHTMLUnsafe` / `parseHTMLUnsafe` / `createContextualFragment` は
  //   いずれも **`createElement` を経由しない**ので (i-2) の allow-list も素通りする
  //   （例: `head.insertAdjacentHTML("beforeend", "<style>" + css + "</style>")`）。
  //   現状の使用箇所は 0 件なので、**いま禁止に入れておくのが最も安い**。
  //   再修正トリガー＝新しい「文字列を HTML として解釈する」DOM API が増えたらここへ足すこと。
  const FORBIDDEN_INJECTION = [
    [/dangerouslySetInnerHTML\s*=/, "dangerouslySetInnerHTML="],
    [/\.(?:inner|outer)HTML\s*\+?=[^=]/, ".innerHTML / .outerHTML への代入"],
    [/\.insertAdjacentHTML\s*\(/, "insertAdjacentHTML()"],
    [/\.setHTMLUnsafe\s*\(/, "setHTMLUnsafe()"],
    [/\.parseHTMLUnsafe\s*\(/, "parseHTMLUnsafe()"],
    [/\.createContextualFragment\s*\(/, "createContextualFragment()"],
    [/\.insertRule\s*\(/, "insertRule()"],
    [/adoptedStyleSheets\s*(?:=[^=]|\.push\()/, "adoptedStyleSheets への代入"],
    [/document\s*\.\s*write\s*\(/, "document.write()"],
    [/new\s+CSSStyleSheet\s*\(/, "new CSSStyleSheet()"],
    [/\.replaceSync\s*\(/, "replaceSync()"],
  ];
  for (const [rel, src] of injectionSources) {
    for (const [re, bad] of FORBIDDEN_INJECTION) {
      if (re.test(src)) {
        fail(
          `${rel}: 生 HTML / CSSOM 経由の注入 API \`${bad}\` が使われています（060d・(10-i)）。` +
            `ユーザー CSS の注入は **\`document.createElement("style")\` ＋ \`textContent\` への代入だけ**に` +
            `してください（取り込んだ CSS には \`</style>\` がそのまま含まれうるため、生 HTML 経路だと` +
            `DOM を閉じられます）。docs/security.md の「レビュー必須条件」がこの経路を名指ししています。` +
            `⚠ jsdom ではこの退行をテストで殺せないので、本検査を消さないでください。`,
        );
      }
    }
  }

  // (i-2) `<style>` / `<link>` の**生成箇所**を allow-list で固定する。
  //   ⚠ ここが本検査の要点——注入先が増えたこと自体を検出する。新しい注入先を足すときは、
  //   **先に docs/security.md「レビュー必須条件」の 060d 項を読み**、レビュー区分を確認してから
  //   この allow-list を更新すること（＝黙って 4 本目が入らないようにする）。
  const STYLE_ELEMENT_CREATORS = new Set([OVERLAY_APP_TSX, THEME_CARD_TSX]);
  for (const [rel, src] of injectionSources) {
    const creates =
      /createElement\(\s*"(?:style|link)"/.test(src) ||
      /createElement\(\s*'(?:style|link)'/.test(src);
    if (creates && !STYLE_ELEMENT_CREATORS.has(rel)) {
      fail(
        `${rel}: \`<style>\` / \`<link>\` を生成しています（060d・(10-i)）。` +
          `ユーザー CSS の注入先は現在 ${[...STYLE_ELEMENT_CREATORS].join(" / ")} の 2 か所だけです。` +
          `新しい注入先を足すなら、docs/security.md の「レビュー必須条件」（オーバーレイへのユーザー CSS の注入）` +
          `に該当するかを先に確認し、そのうえで本検査の allow-list を更新してください。`,
      );
    }
  }
  for (const rel of STYLE_ELEMENT_CREATORS) {
    const src = injectionSources.find(([r]) => r === rel)?.[1] ?? "";
    if (!/createElement\(\s*"style"/.test(src)) {
      fail(
        `${rel}: \`createElement("style")\` が見つかりません（060d・(10-i)）。` +
          `注入経路を別の方式へ変えたなら、docs/security.md のレビュー必須条件を確認したうえで` +
          `本検査の allow-list も更新してください（allow-list が古いまま緑になるのを防ぎます）。`,
      );
    }
  }

  // (10-j) **プレビュー枠の封じ込め（`contain: paint`）は意匠ではなく安全装置。**
  //   `overflow: hidden` だけでは **`position: fixed` / `absolute` の子孫を止められない**
  //   （包含ブロックがビューポート／初期包含ブロックになり、包含ブロック連鎖に無い枠のクリップは効かない）。
  //   ⚠ 実測（060d security-review S-2）で `.themePreview` / `.cardBody` / `.card` / `.settingsView` /
  //   `.root` のどれにも包含ブロックを作る性質（transform / filter / perspective / contain / will-change）が
  //   無く、`.sd-preview .sd-comment{position:fixed;inset:0;z-index:2147483647}` の 1 本で**窓全体を覆えた**。
  //   コメビュ窓には「既定のデザインに戻す」（＝壊れたテーマからの唯一の脱出路）・OBS のパスワード入力・
  //   視聴者メモリの削除導線があるので、覆えること自体が UI 偽装／クリックジャッキングになる。
  //   ⚠⚠ **jsdom はレイアウトを計算しないので、この不変条件はテストでは守れない**（(10-a) と同じ事情）。
  //   ここが唯一の機械的な受け皿である。⚠ 実際に効いているかは実機で見ること（progress.md 060d 節の 10-(b)）。
  const previewBody = ruleBody(read(VIEWER_CSS), ".themePreview");
  if (!hasDecl(previewBody, "contain", "paint")) {
    fail(
      `${VIEWER_CSS}: \`.themePreview\` に \`contain: paint\` がありません（060d・(10-j)）。` +
        `これは意匠ではなく**安全装置**です——\`overflow: hidden\` だけでは \`position: fixed\` の子孫を` +
        `止められず、プレビューの中の第三者 CSS が「既定のデザインに戻す」ボタンや OBS のパスワード欄を` +
        `覆えます（実測済み）。詳細は docs/security.md「## CSP方針」の 060d 節。`,
    );
  }
  if (!hasDecl(previewBody, "overflow", "hidden")) {
    fail(
      `${VIEWER_CSS}: \`.themePreview\` の \`overflow: hidden\` が消えています（060d・(10-j)）。` +
        `\`contain: paint\` と併用してください（通常フローのはみ出しを切る役目はこちらが持っています）。`,
    );
  }
}

// ---------------------------------------------------------------------------
if (failures.length > 0) {
  console.error("CSS guard check FAILED:\n");
  for (const f of failures) console.error(`  - ${f}\n`);
  process.exit(1);
}
console.log("CSS guard check OK");
