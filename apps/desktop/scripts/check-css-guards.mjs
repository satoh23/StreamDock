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

/**
 * 061g レビュー: `src/components` 配下の `*.module.css` を**再帰で全部**集める。
 *
 * (6-b) の走査先を**手書きのリストにしないため**にある。手書きだと「新しい意匠モジュールを作って
 * そこで faint を誤用すれば素通りする」——061g レビューの変異実測でこれが生存した
 *（denylist を走査型へ変えたときと**同型の穴**で、当時の教訓は「規則そのものを守れ」だった）。
 * ⚠ `components/tutorial/` のようなサブディレクトリも拾う（1 階層に閉じない）。
 */
function collectModuleCss(relDir) {
  const out = [];
  const walk = (rel) => {
    for (const entry of readdirSync(join(root, rel), { withFileTypes: true })) {
      const child = `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(child);
      else if (entry.name.endsWith(".module.css")) out.push(child);
    }
  };
  walk(relDir);
  return out.sort();
}

const VIEWER_CSS = "src/screens/comment-viewer/CommentViewerApp.module.css";
const OVERLAY_CSS = "src/screens/comment-viewer/OverlayComment.module.css";
const TONE_TS = "src/screens/comment-viewer/monetaryTone.ts";
const SETTINGS_TSX = "src/screens/comment-viewer/SettingsView.tsx";
// 060a: オーバーレイの「セレクタ契約」（安定クラス・CSS 変数）を持つ 4 本。
const COMMENT_LIST_TSX = "src/screens/comment-viewer/CommentList.tsx";
const OVERLAY_APP_TSX = "src/screens/comment-viewer/OverlayApp.tsx";
// 060c 追修正: 配信窓そのものの CSS（document のスクロール抑止・スクロールバー抑止＝ (10-p)）。
const OVERLAY_APP_CSS = "src/screens/comment-viewer/OverlayApp.module.css";
const PINNED_OVERLAY_TSX = "src/screens/comment-viewer/PinnedOverlayApp.tsx";
// 061a: 3 本目の透過オーバーレイ窓。⚠ **060d の注入先ではない**ので、(10-d) の否定検査の対象に含める
//（窓を増やすたびにここへ足すこと。足さないと「注入先は comment-overlay のみ」という契約に穴が開く）。
const EFFECT_OVERLAY_TSX = "src/screens/obs-effects/EffectOverlayApp.tsx";
// 061d: エフェクト窓の描画の一部が**ファイルとして外へ出た**（main 窓のプレビューと共有するため）。
// ⚠⚠ (10-d) はファイル名で対象を選ぶので、**切り出した先を足さないと否定検査がすり抜ける**
//（「窓を増やすたびに足す」の**ファイル分割版**。この窓に描かれるものを増やすときは必ずここへ足すこと）。
const EFFECT_TEMPLATE_VIEW_TSX =
  "src/screens/obs-effects/EffectTemplateView.tsx";
// 061d-2: エフェクト窓の 2 層（テンプレート層＝絶対配置・組み込み＝手前）の位置指定を持つ CSS。
// ⚠⚠ **jsdom はレイアウトを解決しないので、この 3 ルールはコンポーネントテストでは殺せない**
//（061d-2 のミューテーションで `.templateLayer` の `position/inset` を外す変異が実際に生存した）。
// ＝ **(10-r) がこの不変条件を殺している唯一の検査**である。
const EFFECT_OVERLAY_CSS = "src/screens/obs-effects/EffectOverlayApp.module.css";
// 061d-2: main 窓のプレビュー（エフェクト窓と `EffectTemplateView` を共有する 2 つ目の呼び出し元）。
// ⚠ (10-t) の対象＝「取り込んだメディアを `src` に載せるファイル」はここまでの 3 本。
const EFFECT_PREVIEW_TSX = "src/screens/obs-effects/EffectTemplatePreview.tsx";
const CSS_COMPAT_TS = "src/features/comment-viewer/cssCompat.ts";
// 060d: ユーザー CSS を実際に注入する側の 3 本（(10-h) / (10-i)）。
const CSS_SCOPE_TS = "src/features/comment-viewer/cssScope.ts";
const THEME_CARD_TSX = "src/screens/comment-viewer/OverlayThemeCard.tsx";
// 055c: 本チェッカー初のメインウィンドウ側 CSS（それまでは comment-viewer 配下 4 本のみが対象だった）。
const HEADER_CSS = "src/components/Header.module.css";
const UPDATE_CSS = "src/screens/app-update/UpdateScreen.module.css";
// 061g: 画面を跨ぐ共通部品 3 本（ToggleSwitch / Select / ConfirmDialog）を `components/` へ移したので、
// 意匠も `CommentViewerApp.module.css` から出た。⚠⚠ **これで 054 の 3 段規則は宣言（VIEWER_CSS の先頭）と
// 実体（下の 4 枚）がファイルを跨いだ**——(6-a) はその突き合わせを、(6-b) は faint の走査を、
// **VIEWER_CSS だけでなくここも見る**必要がある（見ないと「新しい CSS モジュールへ移すだけで検査が消える」）。
// ⚠ 本チェッカー冒頭の記録どおり、3 回目の再発は「別 CSS モジュールへ意匠を移した際にコメントが付いてこなかった」
// ために起きた。**部品を `components/` へ足すときは、意匠のモジュールもここへ足すこと。**
// ⚠⚠ **061g の「移設であって複製ではない」は (11) が守る**（2026-08-14・独立レビューの指摘で追加）。
// それまでこの不変条件はどのガードも見ておらず、VIEWER_CSS の末尾へ `.btn { … }` を書き戻す変異が
// **本チェッカーも 1520 件のテストも素通り**した。移設先のファイル名を足すのはここ、検査は (11)。
const COMPONENTS_DIR = "src/components";
const TOGGLE_CSS = "src/components/ToggleSwitch.module.css";
const SELECT_CSS = "src/components/Select.module.css";
const CONFIRM_CSS = "src/components/ConfirmDialog.module.css";
const BUTTONS_CSS = "src/components/compactButtons.module.css";
// 061i: `components/` の 5 枚目（**移設ではなく新設**の共通部品＝タブ）。
// ⚠ (6-b) の faint 走査は `COMPONENTS_DIR` のディレクトリ走査なので**自動で対象になる**（追記は不要）。
// ⚠ ここへ足すのは (11-b)「移設先に意匠が実在する」検査のため——(11) のリストのコメントが
// 「`components/` へ 4 本目の部品を出したときは、ここへも足すこと（足し忘れは検査の縮小になる）」と
// 指示している。⚠ **新設なので (11-a)（VIEWER_CSS に複製が無いこと）は自明に通る**が、
// 逆に「あちらに `.tab` を書けば複製になる」ことは今後も真なので、両方向とも意味がある。
const TABS_CSS = "src/components/Tabs.module.css";

const failures = [];
const fail = (msg) => failures.push(msg);

/**
 * 061g: コメントを剥がした CSS を**読めなかったときに落ちる**形で読む（(9) の `readSource` と同じ idiom）。
 *
 * 移設で対象が別ファイルになった以上、リネーム / 移動で `node:fs` の**生スタックトレース**が出ると
 * 真因が読めない（(5-b) の「メッセージが真因と一致する」原則から外れる）。
 * ⚠ **fail-open にはしない**——`null` を返した側は必ず fail() 済みなので、呼び出し側は `continue` してよい。
 */
const readCssGuarded = (rel, why) => {
  try {
    return read(rel);
  } catch {
    fail(`${rel} を読めません（リネーム / 移動しましたか？）。${why}`);
    return null;
  }
};

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
  // ⚠ 061g レビュー: ここだけ `readCssGuarded` を通していない（＝ VIEWER_CSS を改名すると `node:fs` の
  //   生スタックが出る）。基準の片側だけ守られている非対称だが、**VIEWER_CSS は (6)(7) 以外の多数の
  //   ガードが `read(VIEWER_CSS)` で読んでおり、ここだけ包んでも他が生スタックのままで意味が薄い**。
  //   ⇒ 再修正トリガー＝ VIEWER_CSS を移動・改名する変更が来たとき。そのときは本スクリプト全体の
  //   `read(...)` を一括で `readCssGuarded` に寄せる（1 か所だけ直すと非対称が別の場所へ移るだけ）。
  const css = read(VIEWER_CSS);

  // (6-a) 設定項目名の書式は 1 種類。基準は `.toggleLabel`（ToggleSwitch は設定画面だけでなく
  //   **本体コメントビューのツールバー**でも **OBSエフェクト画面**でも使うので値を動かせない）で、
  //   `.fieldLabel` をそれに**一致**させる。
  //   値をベタ書きで二重管理せず突き合わせにしているので、将来 `.toggleLabel` を動かしたときは
  //   `.fieldLabel` も一緒に動かさないとここで落ちる（＝規則が割れたまま進めない）。
  //   **落ちたときにやること**: どちらか一方に寄せて 2 つを揃える（片方だけ直して通そうとしない）。
  //   `.toggleLabel` を動かしたい場合は、3 画面すべてのトグル表示が一緒に動くことを実機で確認する。
  //   `font-size` も突き合わせる: これが無いと `.fieldLabel` だけ 11px に戻せてしまい、`.note`（12px）より
  //   項目名が小さい＝**054 が直した症状そのもの**が緑のまま通る（レビュー実測で生存を確認したため追加）。
  //
  //   ⚠⚠ **061g で 2 つの実体がファイルを跨いだ**（`.toggleLabel` は `components/ToggleSwitch.module.css`、
  //   `.fieldLabel` は `VIEWER_CSS`）。突き合わせの**意味も対象プロパティも変えていない**——読み先だけを
  //   直した。移設で「ruleBody が null を返して検査が空回りする」形にはしていない（下の 2 段の fail を参照）。
  //   ⚠ 失敗メッセージは**どちらのファイルを見ればよいか**が分かるよう、常に両方の rel を出す。
  const fieldLabel = ruleBody(css, ".fieldLabel");
  const toggleCss = readCssGuarded(
    TOGGLE_CSS,
    "(6-a) の基準側 `.toggleLabel` を読めないため、設定項目名の書式が 1 種類であることを検査できません。",
  );
  if (fieldLabel === null) {
    fail(
      `${VIEWER_CSS}: \`.fieldLabel\` のルールがありません（054）。` +
        `SettingsView がラベル文字列に付けるクラスに対応する CSS が無いと、設定項目名が補助説明（.note）と` +
        `同じ見た目に戻ります（CSS モジュールは存在しないキーでも文字列を返すので、` +
        `コンポーネントのテストでは検出できません）。セレクタをカンマで束ねた場合もここに来るので、` +
        `束ねたのならこのガードの取り出し方も一緒に直すこと。`,
    );
  } else if (toggleCss !== null) {
    const toggleLabel = ruleBody(toggleCss, ".toggleLabel");
    if (toggleLabel === null) {
      // ルールごと消えた / クラス名が変わった / セレクタをカンマで束ねた場合。
      // 3 プロパティぶんの「宣言がありません」を並べるより真因が読める。
      fail(
        `${TOGGLE_CSS}: \`.toggleLabel\` のルールを取り出せません（054・(6-a) の基準側）。` +
          `削除したか、クラス名を変えたか、セレクタをカンマで束ねた可能性があります。` +
          `このルールは ${VIEWER_CSS} の \`.fieldLabel\` と突き合わせる**正**なので、` +
          `無いと「設定項目名の書式は 1 種類」を機械で守れなくなります` +
          `（束ねたのならこのガードの取り出し方も一緒に直してください）。`,
      );
    } else {
      for (const prop of ["font-size", "font-weight", "color"]) {
        const expected = declValue(toggleLabel, prop);
        if (expected === null) {
          fail(
            `${TOGGLE_CSS}: \`.toggleLabel\` に ${prop} がありません（054 の基準側）。` +
              `設定項目名の書式はこのルールを正として ${VIEWER_CSS} の \`.fieldLabel\` と突き合わせています。`,
          );
          continue;
        }
        // 値どうしを直接比べる（`hasDecl` の前方一致だと `.fieldLabel` 側にだけ `!important` が付いた場合に
        // 素通りし、`background-color` にも一致してしまうため）。
        const actual = declValue(fieldLabel, prop);
        if (actual !== expected) {
          fail(
            `設定項目名の書式が 2 つに割れています（054・(6-a)）: ` +
              `${VIEWER_CSS} の \`.fieldLabel\` の ${prop}（${actual ?? "宣言なし"}）が ` +
              `${TOGGLE_CSS} の \`.toggleLabel\`（${expected}）と一致しません。` +
              `⚠ 直すファイルは**この 2 つ**です（061g で部品を components/ へ移したため、` +
              `基準側は screens/ ではなく components/ にあります）。` +
              `同じカードにトグルの label と縦積みフィールドの label が並ぶため、書式が割れると 054 以前の` +
              `「どこが項目名で、どこが説明なのか読み取れない」状態に戻ります。サイズ・太さ・色は jsdom で` +
              `解決されないため、コンポーネントのテストでは検出できません。` +
              `直すときは片方だけでなく 2 つを揃えること。`,
          );
        }
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
  //   ⚠ 061g 以降、その宣言は VIEWER_CSS の先頭に残っているが**実体の一部は components/ にある**。
  //   走査先は下の FAINT_SCANNED（VIEWER_CSS ＋ `components/` 配下の `*.module.css` **全部**）。
  //   ⚠⚠ **手書きのリストにしないこと**——下のコメントを参照（同型の穴を 2 度踏まないため）。
  //
  //   走査型にすると `.pastTime`（視聴者詳細の過去コメント時刻＝**設定画面外のメタ情報**・054 の対象外で
  //   据え置くとタスクが明示指示）が**正しい CSS のまま落ちる**。(5-b) の「正しい CSS で fail させない・
  //   メッセージを真因と一致させる」を守るため、**明示の例外許可リスト**を持つ形にした
  //   （＝意図的な例外であることが機械にも読める・増えたら必ずここに理由付きで書くことになる）。
  const FAINT_ALLOWED = new Map([
    [".pastTime", "視聴者詳細の過去コメント時刻＝設定画面外のメタ情報（054 タスク (1) の明示指示で据え置き）"],
  ]);
  //   ⚠⚠ **061g で走査先を広げ、2026-08-14（独立レビュー）にディレクトリ走査へ変えた。**
  //   061g までは VIEWER_CSS 1 枚だけを見ており、061g では移設先 4 枚を**手で足した**。どちらの形でも
  //   「**新しい CSS モジュールを作ってそこで faint を誤用すれば素通りする**」穴が残る
  //   （変異実測: `components/NewThing.module.css` に `.newHint { color: var(--text-faint) }` を足す →
  //   手書きリスト版では**生存した**）。これは denylist を走査型へ変えたときと**同型の穴**で、
  //   当時の教訓は「規則そのものを守れ」だった。**リストの保守を人間に委ねた時点で同じ穴が開く**ので、
  //   `components/` はディレクトリごと走査する（＝部品を足しても検査に穴が開かない）。
  //   ⚠ 条件は**一切緩めていない**（`:disabled` と FAINT_ALLOWED 以外は落ちる）。走査範囲が広がるだけ。
  //   ⚠ `components/compactButtons.module.css` の `.btn:disabled` / `.btnGhost:disabled` /
  //   `.dangerBtn:disabled` と `primitives.module.css` の `.primary:disabled` は faint を使うが
  //   `:disabled` なので通る（＝正しい用法。走査対象を広げても既存は緑のまま＝実測）。
  //
  //   ⚠⚠ **`src` 全体へのグロブは不可**（意図的に `components/` ＋ VIEWER_CSS に限っている）:
  //   `formLayout.module.css`（`.field input::placeholder`）/ `RakurakuToolsScreen.module.css`
  //   （`.componentNote` / `.componentUrl`）/ `ComingSoonScreen.module.css`（`.note`）が faint を
  //   可読テキストに使っており、広げると**正しい CSS で fail する**（(5-b) が戒めた失敗）。
  //   ＝ **3 段規則の適用単位は「このコメビュ窓 ＋ 共通部品」**であって全画面ではない
  //   （CSS 先頭の宣言が「13px/700 をこの窓の外へ持ち出さないこと」と書いているのと同じ線引き）。
  //   ⇒ 適用単位を広げたくなったら、**まず宣言（VIEWER_CSS 先頭の表）を書き換えてから**ここを広げること。
  const FAINT_SCANNED = [
    [VIEWER_CSS, css],
    ...collectModuleCss(COMPONENTS_DIR).map((rel) => [
      rel,
      // (6-a) で読んだ分は使い回す（同じファイルで fail を 2 回出さないため）。
      rel === TOGGLE_CSS
        ? toggleCss
        : readCssGuarded(rel, "(6-b) の faint 走査ができません。"),
    ]),
  ];
  // ルールを素朴に列挙する（CSS パーサは持ち込まない）。`[^{}]+` はブレースを跨げないので、
  // 直前の `}` / `{` から次の `{` までが自然にセレクタになる。`@media` 自体は本体にブレースを含むため
  // マッチせず、その**中のルールは 1 件ずつ拾える**（＝将来 faint をメディアクエリ内で誤用しても捕まる）。
  for (const [rel, source] of FAINT_SCANNED) {
    if (source === null) continue; // 読めない旨は readCssGuarded が既に fail 済み（fail-open ではない）。
    for (const m of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = m[1].replace(/\s+/g, " ").trim();
      if (selector.startsWith("@") || selector === "") continue;
      if (!hasDecl(m[2], "color", "var\\(--text-faint\\)")) continue;
      const parts = selector.split(",").map((s) => s.trim());
      if (parts.every((p) => p.includes(":disabled") || FAINT_ALLOWED.has(p))) continue;
      fail(
        `${rel}: \`${selector}\` が \`color: var(--text-faint)\` を使っています（054）。` +
          `--text-faint は「押せない」を意味する濃度で**無効状態（:disabled）専用**です。` +
          `可読テキスト（設定項目名・補助説明）なら \`var(--muted)\` を使い、無効表現なら \`:disabled\` に付け、` +
          `それ以外の意図的な例外なら本スクリプトの FAINT_ALLOWED に理由付きで追加してください` +
          `（色は jsdom で解決されないため、コンポーネントのテストでは検出できません）。`,
      );
    }
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
  /**
   * 060a/060f の安定クラス契約（docs/tasks/060a-overlay-selector-contract.md ＋
   * docs/tasks/060f-overlay-dom-alignment.md が正）。**`CommentList.tsx` に在るべきもの**だけを置く。
   */
  const STABLE_CLASSES = [
    // ⚠⚠⚠ 060f 追修正④(2026-08-08): **この契約は chat だけのもの**になった。
    //   課金カード（投げ銭カード）には安定クラスも `data-sd-*` も付けない（下の (10-o) が固定）。
    //   削除したのは `sd-comment-tip` と `sd-comment-in-tip` の 2 つ。理由は `CommentList.tsx` の
    //   課金分岐のコメント（要点＝配布テーマは課金カードを**名指しで消しにくる**ので限定では防げない）。
    ["sd-comment", "コメント 1 件（⚠ 追修正④で **chat の <li> 専用**になった）"],
    ["sd-comment-chat", "chat であること（060f・⚠ <li> にだけ・課金には付けない）"],
    // 060f 追修正（security-review Q-1）: **`to` を 1 要素の複合セレクタに保つための目印**。
    // ⚠⚠ これは意匠でも便利クラスでもなく、「合成しても二重前置にならない」を成立させる装置。
    // 契約は「chat の `<li>` の中の要素は**すべて**持つ」（例外を作らない）。詳細は
    // `CommentList.tsx` の `renderOverlayItem` 冒頭と `cssCompat.ts` の `SELECTOR_TABLE` docstring。
    ["sd-comment-in-chat", "chat の <li> の**中**の要素すべて（060f 追修正）"],
    ["sd-comment-name", "投稿者名（chat の .name）"],
    ["sd-comment-source", "サイト名バッジ（chat のみ）"],
    ["sd-comment-icon", "アイコン（chat のみ）"],
    ["sd-comment-header", "名前行（chat の .header）"],
    // ⚠ 060f 追修正(2026-08-08): アイコンは `<li>` 直下（グリッド 1 列目）へ移したので、
    //   この中には吹き出ししか無い。契約としては残す（消すとテーマが黙って壊れる）。
    ["sd-comment-row", "吹き出しの行（chat の .row・⚠ アイコンはもう中に無い）"],
    ["sd-comment-body", "吹き出し（chat の <p>）"],
    ["sd-comment-text", "本文テキスト（chat の <p>）"],
    // ⚠ 追修正④で `sd-comment-amount`（金額バッジ）と `sd-comment-event`（種別の要約文）を落とした。
    //   どちらも**課金カードにしか出ない**要素で、課金カードから安定クラスを外した時点で DOM から消える。
    //   契約に残すと (10-a)（契約が `CommentList.tsx` に実在すること）が落ちる＝**必ず対で消すこと。**
    ["sd-comment-list", "一覧の器（⚠ variant=\"overlay\" のときだけ付く）"],
  ];

  /**
   * 060f: **窓ルートだけは `CommentList.tsx` ではなく `OverlayApp.tsx` に在る**ので、
   * (10-a)（`CommentList.tsx` に実在すること）の対象からは外し、ここに分けて持つ。
   *
   * ⚠ 分ける理由は (10-b)（変換表の右辺 ⊆ 契約）に**必要だから**。060f で
   * `yt-live-chat-app` / `yt-live-chat-renderer` → `.sd-overlay` を変換表へ入れたため、
   * ここに無いと「正しいコードなのに (10-b) が落ちる」（実測）。逆に `STABLE_CLASSES` へ
   * 素朴に足すと今度は (10-a) が「`CommentList.tsx` に `sd-overlay` が無い」で落ちる。
   * ⚠ この窓ルートが **`OverlayApp.tsx` に実在すること**と**固定コメント窓に付かないこと**は **(10-d)** が
   * この配列を回して固定している（security-review 2026-08-05 でクラス名のハードコードから変更）。
   * ＝ ここへ 2 件目を足すと (10-b) の許可と (10-d) の実在検査が**自動で揃う**。片方だけ増やせない。
   */
  const ROOT_CLASSES = [
    ["sd-overlay", "オーバーレイ窓のルート（ユーザーが --sd-* を上書きする器）"],
  ];

  const listTsx = stripTsComments(readRaw(COMMENT_LIST_TSX));
  const overlayAppTsx = stripTsComments(readRaw(OVERLAY_APP_TSX));
  const pinnedTsx = stripTsComments(readRaw(PINNED_OVERLAY_TSX));
  const effectTsx = stripTsComments(readRaw(EFFECT_OVERLAY_TSX));
  const effectTemplateTsx = stripTsComments(readRaw(EFFECT_TEMPLATE_VIEW_TSX));
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

  // (10-o) **課金カード（投げ銭カード）にはユーザー CSS の的を 1 つも置かない。**（060f 追修正④ 2026-08-08）
  //   ⚠ 番号が (10-a) の隣で飛んでいるのは追加順のため（どちらも `CommentList.tsx` の契約検査なので位置を揃えた）。
  //
  //   ⚠⚠⚠ **これは意匠の話ではなく「課金カードが消える」実害への対策。** OBS 用に配られている
  //   純正チャットのテーマは、**課金カードを名指しで消す**のが定番である:
  //     yt-live-chat-paid-message-renderer, yt-live-chat-paid-sticker-renderer { display:none !important }
  //     .yt-live-chat-membership-item-renderer { display:none !important }
  //   純正チャットではスパチャが**ティッカー（上部の帯）にも出る**ので「二重に出るからインライン側を消す」
  //   という意図だが、StreamDock にティッカーは無いので**意図が成立せず、課金カードが丸ごと消える**
  //   （2026-08-08 実機で発生）。⚠⚠ **目印クラスを足す方向（060f が 3 巡ぶん試した「限定」）では
  //   原理的に防げない**——テーマが狙っているのは「課金カードそのもの」だから。
  //   → 課金カードから**安定クラスと `data-sd-*` を全部外した**（2026-08-08 本人決定
  //   「スパチャのデザインは常に同じで、配信窓に必ず出る」）。ここがその退行を殺す唯一の受け皿。
  //
  //   ⚠ 対になる検査＝ `CommentList.selectorContract.test.tsx` の「変換表・リセットのどの当て先も
  //   課金カードに当たらない」。**両方消さないこと**（こちらは字面、あちらは実 DOM を見ている）。
  {
    // ⚠ 課金分岐は「`monetaryTone()` を引くところ」から `renderOverlayItem` の終わりまで。
    //   目印が見つからないときは**黙って素通りさせず fail する**（リファクタで検査が無効化されるのを防ぐ）。
    //
    // ⚠⚠ **正規表現で TSX をスライスする方式の脆さについて**（レビュー指摘 Q-4・2026-08-08・**修正不要と判断**）。
    //   意図＝ 依存ゼロ（本スクリプトの前提）で「課金分岐の**字面**」だけを見る最小の受け皿。
    //   脆さは実在する: アンカーと終端 `\n  };` に依存するので、課金分岐を別関数へ切り出す・
    //   インデントを変える・Prettier 設定を変えると壊れる。AST ではない。
    //   **修正不要と判断した理由は「壊れ方の向きが正しい」から**——アンカー消失時は黙って通らず
    //   **fail する**（下の分岐）ので、リファクタで検査が無効化されることはない。実際にミューテーション
    //   （課金 `<li>` へ `sd-comment` / `data-sd-tone` を戻す）で KILLED を実測済み。
    //   ⚠ 誤検知の心配も小さい: 意匠クラスは CSS Modules のハッシュ名なので `sd-comment` を含む名前を書けない。
    //   ⚠ 範囲外になる `renderIcon` の**定義**（アンカーより前）は、引数必須のシグネチャと
    //   課金側が明示的に `""` を渡す形で守られている（緩めると typecheck が落ちる）。
    //   再修正トリガー: 課金分岐を別ファイル／別コンポーネントへ切り出すとき（＝そのとき本検査も
    //   一緒に更新する。AST 化するなら `typescript` は既に devDependency にあるので**新規依存は要らない**）。
    const TIP_ANCHOR = "const tone = monetaryTone(c);";
    const start = listTsx.indexOf(TIP_ANCHOR);
    const end = start === -1 ? -1 : listTsx.indexOf("\n  };", start);
    if (start === -1 || end === -1) {
      fail(
        `${COMMENT_LIST_TSX}: 課金カード分岐の目印（\`${TIP_ANCHOR}\`）が見つかりません（060f 追修正④・(10-o)）。` +
          `この検査は「課金カードにユーザー CSS の的を置かない」を守る唯一の静的ガードなので、` +
          `分岐を書き換えるなら**目印と一緒に本検査も更新**してください（黙って無効化させないため fail します）。`,
      );
    } else {
      const tipBranch = listTsx.slice(start, end);
      for (const [pattern, what] of [
        [/(?<![A-Za-z0-9_-])sd-comment[A-Za-z0-9_-]*/g, "安定クラス"],
        [/data-sd-[a-z-]+/g, "`data-sd-*` 属性"],
      ]) {
        const hits = [...new Set(tipBranch.match(pattern) ?? [])];
        if (hits.length > 0) {
          fail(
            `${COMMENT_LIST_TSX}: 課金カード分岐に${what}が残っています（060f 追修正④・(10-o)）: ` +
              `${hits.join(" / ")}。` +
              `⚠ **課金カードはユーザー CSS の的にしない**（本人決定 2026-08-08「スパチャのデザインは` +
              `常に同じで、配信窓に必ず出る」）。的を 1 つでも置くと、配布テーマの定番である` +
              `\`yt-live-chat-paid-message-renderer{display:none!important}\` 系の指定で` +
              `**課金カードが丸ごと消えます**（実機で発生）。` +
              `⚠ 意匠は CSS モジュールのハッシュ名（\`.card\` / \`.tierN\`）で当てること——` +
              `あれはユーザーから名指しできないので的になりません。`,
          );
        }
      }
    }
  }

  // (10-b) 変換表の**変換先が実在する安定クラスであること**（(4) の tone 表と同型の突き合わせ）。
  //   cssCompat.ts は「純関数の置換表」なので、右辺を打ち間違えても typecheck も vitest も通る
  //   （ただの文字列）。ユーザーの CSS が黙って効かなくなるだけなので、ここで突き合わせる。
  //   ⚠ 060f: `to` は**複合セレクタ**（`.sd-comment-chat .sd-comment-text`）を取りうるが、
  //   `matchAll(/\.([A-Za-z0-9_-]+)/g)` が**全クラストークン**を抜くので検査はそのまま効く（実測）。
  //   ⚠ 窓ルート（`.sd-overlay`）は `CommentList.tsx` ではなく `OverlayApp.tsx` に在るため、
  //   (10-a) の対象である `STABLE_CLASSES` ではなく `ROOT_CLASSES` から合流させる。
  const declared = new Set(
    [...STABLE_CLASSES, ...ROOT_CLASSES].map(([c]) => c),
  );
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

  // (10-l) 変換表の**変換先に子孫結合子を書かない**＝ `to` は「**1 要素の複合セレクタ**」だけ。
  //   ⚠ 番号が (10-b) の隣で飛んでいるのは追加順のため（どちらも `to` の検査なので位置を揃えた）。
  //
  //   ⚠⚠ **これは作法ではなく安全装置**（security-review Q-1・2026-08-05 → 修正 2026-08-06）。
  //   `to` を子孫セレクタ（`.sd-comment-chat .sd-comment-text`）にすると、**祖先側のエントリと合成された
  //   ときに前置が二重に積まれ「絶対に当たらないセレクタ」になる**（`.chat-line__message
  //   .chat-line__message-body` → `.sd-comment-chat .sd-comment-chat .sd-comment-text` ＝ <li> の中に
  //   <li> が要る）。トークン単位の置換である以上、表の書き方だけでは防げない。
  //   ⚠⚠ しかもこの失敗は**黙っている**——`rewritten` は加算され `unmatched` は空なので、060d の UI が
  //   「M 個のルールを変換しました」と**積極的に誤報する**（＝ (10-b) が言う「変換されたのに効かない＝
  //   最悪の状態」）。だから静的に禁じる。限定は `sd-comment-in-chat` / `sd-comment-in-tip` で表すこと。
  //   ⚠ 対になる検査＝ `cssCompat.test.ts` の**全順序対（表の全エントリ × 全エントリ）の総当たり**。**両方消さないこと。**
  for (const to of toValues) {
    if (/\s|>/.test(to.trim())) {
      fail(
        `${CSS_COMPAT_TS}: 変換先 \`${to}\` に子孫結合子（空白 / \`>\`）が入っています（060f・(10-l)）。` +
          `\`to\` は**1 要素の複合セレクタ**（例 \`.sd-comment-text.sd-comment-in-chat\`）だけにしてください。` +
          `子孫セレクタにすると、祖先側のエントリと合成されたときに**前置が二重に積まれて永久に当たらない` +
          `セレクタ**になり（\`.sd-comment-chat .sd-comment-chat .sd-comment-text\`）、しかも rewritten は` +
          `加算され unmatched は空なので **060d の UI が「変換しました」と誤報します**。` +
          `chat / 課金の限定は \`sd-comment-in-chat\` / \`sd-comment-in-tip\` の目印クラスで表してください。`,
      );
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

  // (10-k) 変換表の**元セレクタに窓ルート相当（`body` / `html` / `:root`）を書かない**。
  //   ⚠ 番号が (10-c) の隣で飛んでいるのは追加順のため（どちらも `from` の検査なので位置を揃えた）。
  //
  //   ⚠⚠ **これは意匠ではなく安全装置。** オーバーレイ窓の透過（＝ OBS 合成の前提）は
  //   `html[data-overlay="1"]` の背景透明化で成立しており、そこを変換の的にすると**窓を塗り潰せる**。
  //   security-review（2026-08-05）で「この判断を守っているのは `cssCompat.ts` のコメントと
  //   `cssCompat.test.ts` の describe だけ＝テストを一緒に消せば緑のまま通る」と指摘されたぶん。
  //   ⚠ **未変換の `body` は `unmatched` にも載らない**（`FOREIGN_SELECTOR_RE` は接頭辞ベースで、
  //   「sd 語彙でない全セレクタ」を載せる設計ではない）ので、**足してしまっても警告では気付けない**。
  //   だから静的に禁じる。
  //   ⚠ トークン単位で見ること——`.chat-line__message-body` は部分文字列に `body` を含むので、
  //   素朴な `includes("body")` では**正しいコードで落ちる**。
  const ROOT_LIKE_FROM = ["body", "html", ":root"];
  for (const from of fromValues) {
    for (const token of from.trim().split(/\s*>\s*|\s+/)) {
      if (ROOT_LIKE_FROM.includes(token.toLowerCase())) {
        fail(
          `${CSS_COMPAT_TS}: 変換表の元セレクタ \`${from}\` に窓ルート相当 \`${token}\` が入っています（060f）。` +
            `オーバーレイ窓の透過（OBS 合成の前提）は html[data-overlay="1"] の背景透明化で成立しているため、` +
            `ここを変換の的にすると**ユーザーの CSS が窓を塗り潰せます**。` +
            `⚠ 未変換の \`body\` は unmatched にも載らないので、足してしまっても警告では気付けません` +
            `（だからこの検査があります）。意図的に解禁するなら docs/security.md の` +
            `「レビュー必須条件＝オーバーレイへのユーザー CSS の注入」を先に読むこと。`,
        );
      }
    }
  }

  // (10-d) 窓ルートの安定クラスは **comment-overlay 窓にだけ**付く。
  //   060d は「CSS の注入先は `comment-overlay` のみ・固定コメントは別タスク」と決めており、
  //   窓の区別をこのクラスの有無で表している。加えて `PinnedOverlayApp` は 046c の `applyFitScale` が
  //   `.root` の transform / width / height を**排他所有**しているので、そこをユーザー CSS に
  //   触らせる的を作ってはいけない（縮小フィットが壊れる）。
  //
  //   ⚠ 060f 後追い（security-review 2026-08-05）: **検査対象を `ROOT_CLASSES` から回す**。
  //   ここでクラス名を文字列でハードコードしていると、(10-b) は `ROOT_CLASSES` を見て許可する一方
  //   **2 件目の窓ルート（将来 046d で固定窓へ広げるとき等）は実在性を誰も検査しない**状態になる
  //   ＝ (10-b) の目的（変換先の打ち間違いを機械で検出する）が静かに穴になる。契約の出所を 1 か所に寄せる。
  for (const [cls, role] of ROOT_CLASSES) {
    if (!classToken(cls).test(overlayAppTsx)) {
      fail(
        `${OVERLAY_APP_TSX}: 窓ルートの安定クラス \`${cls}\`（${role}）がありません（060a / 060f）。` +
          `ユーザーが CSS 変数（--sd-*）を上書きする器がこれです。無いと変数が 1 つも効きません。` +
          `⚠ この名前は本スクリプトの ROOT_CLASSES が正で、(10-b) が変換表の右辺をここへ突き合わせています。`,
      );
    }
    if (classToken(cls).test(pinnedTsx)) {
      fail(
        `${PINNED_OVERLAY_TSX}: 固定コメント窓に \`${cls}\` が付いています（060a / 060d）。` +
          `060d の注入先は \`comment-overlay\` のみで、窓の区別をこのクラスの有無で表しています。` +
          `また 046c の applyFitScale がこの窓の .root の transform / width / height を排他所有しているため、` +
          `ユーザー CSS がそこを触れると縮小フィットが壊れます。` +
          `固定窓へ広げるのは別タスク（046d と同じ広げ方）として、本ガードも併せて更新してください。`,
      );
    }
    // 061a: 3 本目（エフェクト窓）も同じ理由で注入先ではない。⚠ ここを足さないと、窓を増やすたびに
    // 「注入先は comment-overlay のみ」という 060d の契約が**静かに穴だらけ**になる。
    // 061d: エフェクト窓へ描かれるものが 2 ファイルに分かれた（`EffectTemplateView` は main 窓の
    // プレビューと共有する描画本体）ので、**切り出した先も同じ否定検査にかける**。
    // ⚠ 変数名を `tsxRel` にしているのは、外側の `for (const rel of [VIEWER_CSS, OVERLAY_CSS])` を
    //   シャドウしないため（061d-1 レビュー Q-5）。このスクリプトは「フェイル文にファイル名を出す」ことが
    //   機能そのものなので、同名だと後で外側の `rel` を参照した瞬間に**間違ったファイル名を報告する**。
    for (const [tsxRel, tsxSrc] of [
      [EFFECT_OVERLAY_TSX, effectTsx],
      [EFFECT_TEMPLATE_VIEW_TSX, effectTemplateTsx],
    ]) {
      if (classToken(cls).test(tsxSrc)) {
        fail(
          `${tsxRel}: エフェクト窓に \`${cls}\` が付いています（060a / 060d / 061a / 061d）。` +
            `060d の注入先は \`comment-overlay\` のみで、窓の区別をこのクラスの有無で表しています。` +
            `エフェクト窓へ広げるのは別タスク（061c / 061d のテンプレート意匠とも衝突するので、` +
            `そのときは注入先の設計から見直すこと）として、本ガードも併せて更新してください。`,
        );
      }
    }
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
  //
  //   ⚠ **既知の限界**（security-review 060i・Q-3・**現状は修正不要**）: 本文の切り出しは
  //   `indexOf("}")` ＝ **最初の閉じ括弧まで**なので、**ルールの中にネストしたブロック**
  //   （`@media` / CSS ネスト / `@supports`）があると本文が途中で切れる。
  //   意図＝ CSS パーサを持ち込まずに済ませる（新規依存ゼロが 055e からの担保）ため。
  //   修正不要の理由＝ 本ヘルパの当て先（`.bubble` / `.item` / `.card` / `.icon` / `.header` / `.row`）は
  //   **すべて平坦なルール**で、ネストが入ると検査は「厳しくなる側」（本文が短くなって一致しない＝ fail）に
  //   倒れるので、黙って緑になる形の失敗は起きない。
  //   **再修正トリガー**: これらの器のどれかにネストしたブロックを書く必要が出たとき。そのときは
  //   正規表現をやめて `typescript` ではなく**波括弧の深さを数える**素朴なスキャナに差し替えれば足りる
  //   （新規依存は要らない。`stripCssComments` を通した後なのでコメント内の `{}` は既に消えている）。
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
  //   ⚠⚠ **これは理屈ではなく実測で裏付けられている**（060c・2026-08-09。詳細は docs/progress.md の
  //   060c 節「副産物 —— `</` + `style>` 破断による実 egress を偶然観測した」）。S-5 の計測ページ自身が
  //   2 回 `<style>` を壊し（②は **CSS コメントの中**の生の終了タグ）、壊れた瞬間に残りが HTML として
  //   解析されて**本物のインライン SVG 要素**になり、`<image href="http://…">` が
  //   **WebKit / Blink の両方で実際に外部 GET を出した**。＝ この検査を緩めると egress が起きる。
  //   **消さないこと。**
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
  //   この allow-list を更新すること（＝黙って新しい注入先が入らないようにする）。
  //
  //   ⚠⚠ **060h で「ファイルの集合」から「ファイル → 本数」へ強化した。**
  //   旧実装は `Set<ファイル>` だったので、**既に許可されたファイルの中に 2 本目の `<style>` を足しても
  //   何も落ちなかった**（060h はまさにそれを行った＝意匠とは別にフォント用の `<style>` を足す）。
  //   これは 060d security-review S-5 で「4 つ目の注入先が別ファイルに増えても落ちない」を直したときに
  //   **同一ファイル内の増加が残っていた**、という同型の穴である。本数まで固定すれば次は必ず落ちる。
  //   ⚠⚠ **060h security-review S-3 でさらに 2 つ穴を塞いだ**（どちらも実測で「緑のまま通った」）:
  //     ① 本数のカウントが**ダブルクォートしか見ていなかった**——allow-list 済みファイルに
  //        `createElement('style')`（シングルクォート）で 3 本目を足すと actual が増えず素通りする。
  //     ② **`link` の本数を固定していなかった**——allow-list 済みファイルに
  //        `createElement("link")` ＋ `href="https://cdn.example/x.css"` を足しても何も落ちない。
  //        これは §1 が名指しで禁じる「CDN からの css 読み込み」そのもので、`csp: null` の下では
  //        他に止めるものが無い。**`link` の期待値は 0**（増やすなら §1 の例外新設が要る）。
  //   ＝ 「条件を満たすものが 1 つ在るか」ではなく「**該当する全部が期待どおりか**」を見る、という
  //     (10-m) が 3 度踏んだのと同じ教訓。数える対象を増やすときは必ずクォート両対応にすること。
  const STYLE_ELEMENT_CREATORS = new Map([
    // [ファイル, { style: 本数, link: 本数 }]
    // 意匠（060d）＋ フォント（060h）。⚠ `link` は**どちらのファイルでも 0**。
    [OVERLAY_APP_TSX, { style: 2, link: 0 }],
    // プレビューの意匠（060d）＋ プレビューのフォント（060h）。
    [THEME_CARD_TSX, { style: 2, link: 0 }],
  ]);
  /** ⚠ クォートは両対応で数える（片方だけ見ると、もう片方で書いた 3 本目が素通りする）。 */
  const countCreateElement = (src, tag) =>
    (src.match(new RegExp(`createElement\\(\\s*["']${tag}["']`, "g")) ?? []).length;
  for (const [rel, src] of injectionSources) {
    const creates =
      /createElement\(\s*"(?:style|link)"/.test(src) ||
      /createElement\(\s*'(?:style|link)'/.test(src);
    if (creates && !STYLE_ELEMENT_CREATORS.has(rel)) {
      fail(
        `${rel}: \`<style>\` / \`<link>\` を生成しています（060d・(10-i)）。` +
          `ユーザー CSS の注入先は現在 ${[...STYLE_ELEMENT_CREATORS.keys()].join(" / ")} の 2 ファイルだけです。` +
          `新しい注入先を足すなら、docs/security.md の「レビュー必須条件」（オーバーレイへのユーザー CSS の注入）` +
          `に該当するかを先に確認し、そのうえで本検査の allow-list を更新してください。`,
      );
    }
  }
  for (const [rel, expected] of STYLE_ELEMENT_CREATORS) {
    const src = injectionSources.find(([r]) => r === rel)?.[1] ?? "";
    for (const tag of ["style", "link"]) {
      const actual = countCreateElement(src, tag);
      if (actual !== expected[tag]) {
        fail(
          `${rel}: \`createElement("${tag}")\` が ${actual} 個です（期待 ${expected[tag]} 個・060d/060h・(10-i)）。` +
            (tag === "link"
              ? `⚠⚠ \`<link rel=stylesheet href=…>\` は **§1 が禁じている「CDN からの css 読み込み」** そのもので、` +
                `\`csp: null\` の下では他に止めるものがありません。足すなら §1 の例外新設（security-review 必須）が要ります。`
              : `注入する \`<style>\` を増減させたなら、docs/security.md の「レビュー必須条件」` +
                `（オーバーレイへのユーザー CSS の注入）を確認したうえで本検査の本数も更新してください` +
                `（allow-list が古いまま緑になるのを防ぎます）。`),
        );
      }
    }
  }

  // (10-m) **既定意匠のリセットが、注入経路 2 か所の「両方」で前置されていること。**（060f 追修正 2026-08-08）
  //   ⚠ 番号が (10-i) の隣で飛んでいるのは追加順のため（どちらも注入経路の検査なので位置を揃えた）。
  //
  //   既定のしっぽは疑似要素 2 枚（`.bubble::before` / `::after`）で描いているが、**取り込むテーマは
  //   `::before` 1 枚しか書かないのが普通**で、`::after` が孤児として残り**しっぽが二重に見えていた**（実機で確認）。
  //   → `overlayThemeReset.ts` の固定リセットを注入 CSS の**手前**に連結して止める。
  //   ⚠ 追修正②(2026-08-08) でリセットの守備範囲が広がった——しっぽだけでなく**吹き出しの装飾一式**
  //   （背景・枠・角丸・影）と `--sd-icon-gap` も引っ込める。無いとテーマが既定の吹き出しを部分的にしか
  //   上書きできず、**吹き出しを持たないデザインが原理的に適用できない**（本人指摘）。
  //
  //   ⚠⚠ **片方だけ抜けると本番とプレビューで見え方が食い違う**。しかも jsdom はカスケードも
  //   `@layer` の優先順位も解決しないので、**この退行はコンポーネントのテストでは殺せない**（(10-a) と同じ事情）。
  //   ここが唯一の機械的な受け皿である。**消さないこと。**
  //   ⚠ あわせて `OverlayComment.module.css` 側の `@layer sd-default` も検査する——リセットは
  //   「非レイヤー > レイヤー」で既定に勝っているので、**レイヤーを外すとリセットが黙って効かなくなる**
  //   （リセットの詳細度は `:where()` で 0 なので、詳細度では既定に勝てない）。
  //   ⚠⚠ **`.bubble` 本体がレイヤーの「中」にあることまで見る**——`@layer` の存在だけを見ていると、
  //   `.bubble` をレイヤーの外へ出す変異（＝装飾リセットだけが黙って効かなくなる）が生き残る。
  //   ⚠ **呼び出し（`withDecorationReset(`）を見ること。名前の出現だけでは不十分**——
  //   `import { withDecorationReset } from …` が残っていると、**呼び出しを消しても緑のまま通る**
  //   （初版がこの穴を持っており、ミューテーションで実測して是正した）。
  const RESET_HELPER = "withDecorationReset";
  for (const rel of [OVERLAY_APP_TSX, THEME_CARD_TSX]) {
    const src = injectionSources.find(([r]) => r === rel)?.[1] ?? "";
    if (!new RegExp(`\\b${RESET_HELPER}\\s*\\(`).test(src)) {
      fail(
        `${rel}: 既定意匠のリセット \`${RESET_HELPER}()\` を通していません（060f 追修正・(10-m)）。` +
          `注入する CSS の**手前**に \`overlayThemeReset.ts\` のリセットを連結してください。` +
          `⚠ 無いと、テーマが \`::before\` だけでしっぽを描いたときに既定の \`::after\`（内側の塗り三角）が` +
          `孤児として残り、**しっぽが二重に見えます**（実機で確認済み）。` +
          `⚠ 注入経路は配信窓とプレビューの 2 か所で、**片方だけ抜けると本番とプレビューで見え方が食い違います**` +
          `（jsdom はカスケードを解決しないのでテストでは気付けません）。`,
      );
    }
  }
  // ⚠ コメントを落としてから見る（このファイルのコメントは説明用に `{ … }` を含む）。
  const layeredCss = stripCssComments(read(OVERLAY_CSS));
  const layerOpen = /@layer\s+sd-default\s*\{/.exec(layeredCss);
  if (layerOpen === null) {
    fail(
      `${OVERLAY_CSS}: 既定の吹き出し一式を囲む \`@layer sd-default\` がありません（060f 追修正・(10-m)）。` +
        `(10-m) のリセットは詳細度 0（\`:where()\`）で、**「非レイヤー > レイヤー」というカスケードの順序だけで** ` +
        `既定意匠に勝っています。レイヤーを外すとリセットが黙って効かなくなり、` +
        `しっぽの二重と「テーマが既定の吹き出しを越えられない」状態が同時に再発します。` +
        `⚠ 逆にリセット側を \`!important\` にして解決しないこと——今度は**ユーザーのテーマに勝ってしまいます**。`,
    );
  } else {
    // レイヤーブロックの範囲（対応する `}` まで）を求める。
    let depth = 0;
    let end = -1;
    for (let i = layerOpen.index + layerOpen[0].length - 1; i < layeredCss.length; i++) {
      if (layeredCss[i] === "{") depth++;
      else if (layeredCss[i] === "}" && --depth === 0) {
        end = i;
        break;
      }
    }
    // ⚠ `.bubble` 本体まで中に入っていること。ここを見ないと「`.bubble` だけレイヤーの外へ出す」
    //   変異（＝装飾リセットだけが静かに効かなくなる）が生き残る。
    //
    // ⚠⚠⚠ **レビュー指摘 S-1（2026-08-08）で 3 つ目の穴が実測された。** ここは初版から数えて
    //   3 度、同じ形の間違い（「**条件を満たすものが 1 つ在るか**」を見て「**該当する全部が満たすか**」を
    //   見ない）をしている:
    //     ① `src.includes("withDecorationReset")` … import が残っていれば呼び出しを消しても緑
    //     ② `@layer` の**存在**だけ            … `.bubble` をレイヤー外へ出す変異が生存
    //     ③ `exec`（＝**最初の 1 件**だけ）      … 単独ルールをレイヤー外へ出す変異が生存
    //   ③ の実測: `.bubble::before` / `.bubble::after` は**このファイルに 2 回ずつ現れる**
    //   （「`.bubble::before, .bubble::after {` の束ね」と「しっぽの幾何を持つ単独ルール」）。
    //   `exec` が拾うのは束ねのほうなので、**単独ルール（`top:12px` / `left:-20px` /
    //   `border-*-width`）だけをレイヤー外へ出すと check:css も vitest 1119 件も全部緑で通った**。
    //   それが復活させるのは追修正③が直したまさにその欠陥（テーマが `content:""` で疑似要素を
    //   復活させた瞬間に既定の幾何が漏れる）である。
    //   → **`matchAll` で全件を見て、1 件でもレイヤー外なら落とす。**
    //   ⚠ 同じ罠は (10-e) の `ruleBodies` が既に踏んで是正済み（あちらのコメントが
    //   「先頭の 1 つだけを見る `ruleBody` では束ねのほうを掴む」と書いている）。**その教訓が
    //   ここへ伝わっていなかった**——今後この種の検査を足すときは必ず `matchAll` で書くこと。
    //   ⚠ 先頭を `^[ \t]*` にするのも意図（`^\s*` は `\s` が `\n` を含むため、空行をまたいで
    //   マッチ開始位置が**前の行へずれる**＝ index の範囲比較が信用できなくなる）。
    for (const sel of [".bubble", ".bubble::before", ".bubble::after"]) {
      const re = new RegExp(
        `^[ \\t]*${sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[ \\t]*[,{]`,
        "gm",
      );
      const idxs = [...layeredCss.matchAll(re)].map((m) => m.index);
      const outside = idxs.filter(
        (i) => end === -1 || i < layerOpen.index || i > end,
      );
      if (idxs.length === 0 || outside.length > 0) {
        fail(
          `${OVERLAY_CSS}: \`${sel}\` のルール${idxs.length === 0 ? "が見つかりません" : `${idxs.length} 件のうち ${outside.length} 件`}が ` +
            `\`@layer sd-default\` の中にありません（060f 追修正・(10-m)）。` +
            `リセット（\`overlayThemeReset.ts\`・詳細度 0）は**レイヤーの外にあること**だけで既定に勝っています。` +
            `1 ルールでもレイヤーの外に出すと、そのプロパティだけリセットが効かなくなり、` +
            `**テーマを当てても StreamDock の吹き出しが残ります**（jsdom はカスケードを解決しないので` +
            `テストでは検出できません）。` +
            `⚠ \`${sel}\` は**束ねルールと単独ルールの 2 つに分かれている**ので、片方だけ中に在っても不足です。`,
        );
      }
    }
  }

  // (10-n) **レイアウト器の「宣言インベントリ」**＝ 060f 追修正で失われた担保の置き換え。
  //   ⚠ 番号が (10-m) の隣で飛んでいるのは追加順のため。
  //
  //   ⚠⚠ **背景（レビュー指摘・申し送り 1）**: 060f は「意匠 CSS（`OverlayComment.module.css`）の
  //   **非コメント差分ゼロ**」を唯一の機械的な担保にしていた（`git diff` で「宣言を 1 つも触っていない」と
  //   示せる）。追修正①のグリッド化で**その担保を手放した**が、代替として挙げた 2 つはどちらも穴だった:
  //     - **(10-e)** は `--sd-*` の**フォールバック値の一致**しか見ない＝**新しく足された宣言**
  //       （`.icon{margin-right}` / `.item{display:grid}` 等）は 1 つも検査対象外。
  //     - **A/B スクショ**は未実施で、しかも chat 中心のチェックリストだった。
  //   → 実際にそこを通り抜けた回帰が 1 件出た（レビュー指摘 Q-1）: `.icon{margin-right:var(--icon-gap)}` が
  //     **課金カードのヘッダにも効いて**アバターと名前の間隔が 8px → 36px に広がっていた。
  //     vitest 1119 件と (10-a)〜(10-m) の**全部が緑のまま通った**。
  //
  //   → **宣言してよいプロパティ名の集合を器ごとに固定する。** 値は見ない（値は (10-e) の担当で、
  //   ここで二重に持つと正しい調整で落ちる）。**増えても減っても落ちる**のが要点で、
  //   「意匠を触ったこと自体」を検出して A/B スクショの判断へ回すのがこの検査の役目である。
  //
  //   ⚠ **これは change-detector として意図的にきつい。** 意匠を変えるときは落ちるのが正しく、
  //   そのとき更新するのは**この配列 ＋ 実機の A/B スクショ（chat と課金カードの両方）**。
  //   ⚠ 対象は「chat と課金でルールを共有している器」だけに絞ってある（`.bubble` / `.text` は
  //   (10-e) と (10-m) が持っているので入れない）。共有している器こそ Q-1 型の事故が起きる場所。
  const LAYOUT_DECLS = [
    // `.item`＝コメント 1 件の `<li>`。⚠ `.card` と**同じ要素**に当たる（`.item.card`）。
    [
      ".item",
      "--icon-size,--icon-gap,display,grid-template-columns,row-gap,align-items,flex-shrink,padding,margin-block",
    ],
    // ⚠⚠ `.icon` は **chat の 1 列目と課金カードのヘッダ帯で共有**（`renderIcon` が 1 実装）。
    //   ここへ余白系を足すと**必ず**課金カードにも効く。足すなら `.card .icon` の打ち消しも対で足すこと。
    [
      ".icon",
      "grid-column,grid-row,margin-right,flex-shrink,width,height,border-radius,background,background-size,background-position,display,align-items,justify-content",
    ],
    // ⚠ Q-1 の打ち消し本体。**消すと 36px の回帰がそのまま戻る**ので、ここで存在を固定する。
    [".card .icon", "margin-right"],
    [".header", "display,align-items,gap,grid-column"],
    [".row", "grid-column,grid-row,display,align-items"],
    // ⚠ 060c 追修正⑤(2026-08-09): `filter` → `box-shadow` へ**意図的に**差し替えた（WebKit の描画バグの真因）。
    //   実測 20/20 → 0/12。理由と実測値は `OverlayComment.module.css` の `.card` のコメントが正。
    [".card", "overflow,border-radius,box-shadow,gap,padding,grid-template-columns"],
  ];
  for (const [sel, expectedCsv] of LAYOUT_DECLS) {
    const bodies = ruleBodies(overlayCss, sel);
    if (bodies.length === 0) {
      fail(
        `${OVERLAY_CSS}: \`${sel}\` のルールを取り出せません（060f 追修正・(10-n)）。` +
          `削除したか、セレクタの形を変えた可能性があります。黙って検査が無効になるのを防ぐため fail します。`,
      );
      continue;
    }
    const actual = bodies
      .flatMap((b) => b.split(";"))
      .map((d) => d.split(":")[0].trim())
      .filter((p) => p !== "");
    const expected = expectedCsv.split(",");
    const added = actual.filter((p) => !expected.includes(p));
    const removed = expected.filter((p) => !actual.includes(p));
    if (added.length > 0 || removed.length > 0) {
      fail(
        `${OVERLAY_CSS}: \`${sel}\` の宣言インベントリが変わりました（060f 追修正・(10-n)）。` +
          `${added.length > 0 ? `増えた: ${added.join(" / ")}。` : ""}` +
          `${removed.length > 0 ? `減った: ${removed.join(" / ")}。` : ""}` +
          `⚠ 060f は「意匠 CSS の非コメント差分ゼロ」という担保を追修正で手放しており、` +
          `**ここが唯一の代替**です（(10-e) は値しか見ないので、宣言の増減は素通りします）。` +
          `⚠⚠ これらの器は **chat と課金カードでルールを共有している**ので、片方を狙った宣言が` +
          `もう片方に効きます（実際に \`.icon{margin-right}\` が課金カードのヘッダを 28px 広げる回帰を出しました）。` +
          `→ 意図した変更なら本配列を更新し、**実機の A/B スクショを chat と課金カードの両方で取り直してください**。`,
      );
    }
  }

  // (10-s) **オーバーレイのグリッド列は `minmax(0, …)`＝「縮められる 1fr」でなければならない。**
  //   （060i・2026-08-09 実機不具合。⚠ **(10-r) は 060c 追修正⑥ 用に予約済み**なので番号を飛ばしている。）
  //
  //   症状（本人報告・スクショ）＝ **課金カードでユーザー名が長いと、ヘッダ右端の金額バッジが途中で切れる。**
  //   原因は「名前が長いこと」ではなく **`1fr` が `minmax(auto, 1fr)` の糖衣**であること:
  //     min トラックサイジング関数が `auto` の間は、その列を張るグリッドアイテム（`.cardHeader` /
  //     `.header` / `.row`）の `min-width: auto` が**自動最小サイズ＝内容ベース最小**として生き続ける。
  //     `.cardName` / `.name` は `white-space: nowrap` なので min-content ＝ **名前の全幅**であり、
  //     列そのものがカード幅／窓幅を超えて広がる。
  //   → `.cardName` の `flex: 1 / min-width: 0 / text-overflow: ellipsis` は「ヘッダ幅＝カード幅」を
  //     前提にしているので**一度も発動できず**、溢れた分がヘッダの右端（金額バッジ）へ出て
  //     `.card { overflow: hidden }` に切られる。chat 側は `.item` が `overflow: visible` なので、
  //     **`<li>` の幅は変わらないまま 2 列目だけが `<li>` の外へ広がり**、名前行のサイト名ピルと
  //     吹き出しの右側が窓の外へ出て**黙って切れる**
  //     （横スクロールバーは `OverlayApp.module.css` の `::-webkit-scrollbar { width: 0 }` で消えている）。
  //
  //   ⚠ 実測（Chrome headless・`repro/measure.html?mode=overlay&case=long&w=<窓幅>`）:
  //     素の `1fr` では `.cardHeader` の幅が**窓幅に関係なく 363.67px で一定**（＝ min-content に張り付いて
  //     縮む余地が無い）。カード幅は 400/360/320/280px の窓でそれぞれ 376/336/296/256 なので、
  //     金額バッジは 360px 以下で +17.67 / +57.67 / +97.67px はみ出して切られる。
  //     `minmax(0, 1fr)` にすると全幅でヘッダ幅＝カード幅・溢れ 0 になり、名前が ellipsis で丸まる。
  //     chat 側（w=320）は `scrollWidth 379` vs `clientWidth 320` ＝ 59px の横スクロールが 0 になり、
  //     吹き出しの高さが 77 → 105.5 になる（＝ **本文が折り返されるようになった**）。
  //
  //   ⚠⚠ **(10-n) ではこの差し戻しを捕まえられない。** あれは器ごとの「宣言してよいプロパティ**名**の
  //   集合」だけを見て**値を見ない**（`grid-template-columns` は既に両者の名簿に入っている）ので、
  //   `minmax(0, 1fr)` → `1fr` の 1 トークン差し戻しを素通りさせる。
  //   ⚠⚠ **jsdom はレイアウトを解決しないので vitest でも守れない**（(10-a) / (10-j) と同じ事情）。
  //   ＝ **ここが唯一の機械的な受け皿**である。
  //
  //   ⚠ 検査は「値に `minmax(0, …)` が含まれること」だけを見て、トラック本数や `auto` 列の有無は
  //   (10-n) の宣言インベントリと `.card` / `.item` 自身のコメントに委ねる（同じ主張を 2 か所で持つと
  //   正しい調整で二重に落ちる）。⚠ したがって **3 列目を足す変異はここでは落ちない**（正規表現は
  //   前方一致しか見ない）。これは意図どおりで、列の増減は器のコメントと実測が受け持つ。
  //   ⚠ 逆向き（`minmax(auto, 1fr)` と書いて「minmax だから OK」に見せる形）も殺すため、
  //   **min 側が `0` であること**を綴りとして要求する。
  //
  //   ⚠⚠ **判定は `some` ではなく「宣言を持つルールが**すべて**一致」**（security-review 060i・Q-1・
  //   2026-08-09 に是正）。`some` だと**同じセレクタの 2 本目を後ろに足して `1fr` へ差し戻す**変異が
  //   生存した（実測: ファイル末尾に `.card{grid-template-columns:1fr}` を追記して (10-s) も (10-n) も緑。
  //   ⚠ CSS はソース順で後勝ちなので、これは**バグが完全に再発する形**である）。
  //   ⚠ この CSS は `.card` が `.item` を**後勝ちで打ち消す**構造を既に採っている（`.card` のコメント参照）
  //   ＝「同じセレクタの 2 本目を後ろに足す」は将来ここで最も起きやすい編集なので、穴のまま残せない。
  const SHRINKABLE_TRACKS = [
    // chat の 2 列グリッド。1 列目＝アイコン（`auto` のまま／アイコンが消えたら畳まれる必要がある）、
    // 2 列目＝名前行と吹き出し。⚠ 縮むべきなのは **2 列目だけ**。
    [".item", /grid-template-columns:\s*auto\s+minmax\(\s*0\s*,/],
    // 課金カードは 1 列（ヘッダ帯とボディを縦に積む）。⚠ 本人報告の直接原因はこちら。
    [".card", /grid-template-columns:\s*minmax\(\s*0\s*,/],
  ];
  for (const [sel, re] of SHRINKABLE_TRACKS) {
    const bodies = ruleBodies(overlayCss, sel);
    if (bodies.length === 0) {
      fail(
        `${OVERLAY_CSS}: \`${sel}\` のルールを取り出せません（060i・(10-s)）。` +
          `削除したかセレクタの形を変えた可能性があります。黙って検査が無効になるのを防ぐため fail します。`,
      );
      continue;
    }
    // `grid-template-columns` を宣言しているルールだけを見て、**その全部**が `minmax(0, …)` であること。
    // ⚠ 宣言を持つルールが 0 本なら「宣言ごと消された」なので、これも fail に倒す（(10-n) も落ちるが、
    //   あちらのメッセージだけだと「なぜ minmax でなければならないか」が伝わらない）。
    const declaring = bodies.filter((b) => /grid-template-columns\s*:/.test(b));
    if (declaring.length === 0 || !declaring.every((b) => re.test(b))) {
      fail(
        `${OVERLAY_CSS}: \`${sel}\` の \`grid-template-columns\` が \`minmax(0, …)\` ではありません（060i・(10-s)）。` +
          `${declaring.length > 1 ? `⚠ \`${sel}\` は \`grid-template-columns\` を ${declaring.length} 本のルールで宣言しています——CSS はソース順で後勝ちなので、**後ろの 1 本だけが \`1fr\` でもバグは完全に再発します**（本検査は全部の一致を要求します）。` : ""}` +
          `⚠ **\`1fr\` は \`minmax(auto, 1fr)\` の糖衣**です——min が \`auto\` の間は、その列を張る` +
          `グリッドアイテム（\`.cardHeader\` / \`.header\` / \`.row\`）の \`min-width: auto\` が内容ベース最小として` +
          `生き、\`white-space: nowrap\` の**ユーザー名の全幅**まで列が広がります。` +
          `結果 \`.cardName\` の \`flex:1 / min-width:0 / ellipsis\` が一度も発動せず、` +
          `**課金カードでは金額バッジが \`overflow: hidden\` に切られ**（本人報告の症状）、` +
          `**chat では 2 列目が \`<li>\` の外へ広がってサイト名ピルと吹き出しの右側が窓の外へ出ます**` +
          `（横スクロールバーは \`::-webkit-scrollbar { width: 0 }\` で消えているので溢れが見えません）。` +
          `⚠ 実測: 素の \`1fr\` では \`.cardHeader\` の幅が**窓幅に関係なく 363.67px で一定**＝縮む余地がありません。` +
          `⚠ (10-n) は宣言の**プロパティ名**しか見ないのでこの差し戻しを素通りさせ、` +
          `jsdom はレイアウトを解決しないので vitest でも守れません＝**ここが唯一の受け皿**です。` +
          `→ 意図して変えるなら \`repro/measure.tsx\` で \`.cardHeader\` の width と \`.card\` の clientWidth が` +
          `一致することを測り直してください（判定の正は実測です）。`,
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
  // (10-j) 追加分（060f 追修正⑦・2026-08-08）: **`transform: translateZ(0)` は意匠ではなく描画バグ回避。**
  //   これが無いと、テーマの `<style>` を差し替えたときに **WKWebView がプレビューの課金カードの領域を
  //   再描画しそこね、「要素はあるのに描かれない」**（実機で発生。ドラッグ選択＝強制再描画で出てくる）。
  //   ⚠ 実測: 修正なしでテーマ遷移 7 通り中 3 通りが再現、これを足すと 7 通りとも正常、正常時の画素差分は 0。
  //   ⚠ `will-change: transform` / `isolation` / `backface-visibility` では**直らない**（実測）。
  //   ⚠⚠ `contain: paint` は無関係（`contain: none` でも再発する）。一度そう誤診して差し戻している。
  //   ⚠ 当て先をユーザー CSS が名指しできる要素（`.sd-preview` / `.sd-comment-list` / `.sd-comment`）へ
  //   移さないこと——テーマ側から上書きされて回避策が黙って無効化される。
  //
  //   ⚠⚠ **本検査は `translateZ(0)` という「綴りそのもの」を固定している**（レビュー指摘 Q-3・2026-08-08）。
  //   実測: 等価な `transform: translate3d(0, 0, 0)` に書き換えると**落ちる**（＝正しい CSS で fail する）。
  //   逆に `transform: scale(1) translateZ(0)` のような複数値は `hasDecl` が `:` 直後しか見ないので**すり抜ける**。
  //   → **緩めない判断**。この回避策が効くこと自体がエンジン固有の実測結果（`will-change` /
  //   `isolation` / `backface-visibility` は効かず、`translateZ(0)` だけが効いた）なので、
  //   「等価に見える書き方」が同じ合成レイヤー昇格を起こす保証が無い。**綴りを変える＝測り直す**が正しい。
  //   ⚠ そのぶん**メッセージ側でその事情を伝える**こと（正しい CSS が落ちたときに理由が読めないのは
  //   (5-b) が戒めた失敗と同型なので、パターンではなく説明で埋める）。
  //   再修正トリガー: 実機で `translate3d` 等の別の書き方でも直ることを**画素で**確認できたら、
  //   値パターンを `translate(?:Z\(0[a-z%]*\)|3d\([^)]*\))` へ広げてよい。
  if (!hasDecl(previewBody, "transform", "translateZ\\(0\\)")) {
    fail(
      `${VIEWER_CSS}: \`.themePreview\` の \`transform: translateZ(0)\` が消えています（060f 追修正⑦・(10-j)）。` +
        `これは意匠ではなく **WebKit の描画バグ回避**です——無いと、デザインを切り替えたときに` +
        `プレビューの課金カード（スパチャ）が「要素はあるのに描かれない」状態になります（2026-08-08 実機）。` +
        `⚠ \`will-change\` / \`isolation\` では代替できません（実測）。詳細は progress.md「差し戻し⑦」。` +
        `⚠⚠ 本検査は **\`translateZ(0)\` という綴りそのもの**を固定しています——` +
        `等価に見える \`translate3d(0,0,0)\` でも落ちます（意図的）。効くことが実測でしか分かっていない` +
        `回避策なので、**綴りを変えるなら実機の WKWebView で測り直してから**本ガードも更新してください。`,
    );
  }

}

// ---------------------------------------------------------------------------
// (10-p) **オーバーレイ窓の「スクロールする器」の不変条件**（060c 追修正・2026-08-09 実機不具合）。
//   ⚠ ここで守る 3 つは**ランタイムのテストでは殺せない**（jsdom はカスケードもレイアウトも評価しないので、
//   document がスクロールしても、テーマがコメント一覧の `overflow` を潰しても緑のまま通る）。
//   実際に 2 件とも実機で初めて見つかっている。
{
  const overlayAppCss = read(OVERLAY_APP_CSS);
  const viewerCss = read(VIEWER_CSS);
  const listTsx = read(COMMENT_LIST_TSX);

  // ① **配信窓の document をスクロールさせない。**
  //   060c の `rewriteRootLike` はユーザー CSS の `body`/`html`/`:root` を `.sd-overlay` へ読み替えるので、
  //   純正チャット向けテーマの定番 `body{margin:6px auto; overflow:hidden}` が
  //   「`height:100%` の要素に margin が付く（＝はみ出す）＋ ビューポートへの `overflow:hidden` の
  //   伝播が消える」に化け、**OBS のキャプチャに縦バーが写り込む**（実機で確認）。
  //   ⚠ ユーザーはこの 3 セレクタに到達できない（`html`/`body` と書いても `.sd-overlay` に化ける）ので、
  //   ここが**構造的な担保**になっている。
  if (
    !/html\[data-overlay="1"\][\s\S]{0,240}?\{[^}]*overflow\s*:\s*hidden/.test(
      overlayAppCss,
    )
  ) {
    fail(
      `${OVERLAY_APP_CSS}: \`html[data-overlay="1"]\` 側の \`overflow: hidden\` がありません（060c 追修正・(10-p)）。` +
        `これが無いと、ユーザー CSS の \`body{margin:…}\`（060c の rewriteRootLike で \`.sd-overlay\` へ化ける）が` +
        `\`height:100%\` の窓ルートをはみ出させ、**OBS のキャプチャに縦スクロールバーが写り込みます**（2026-08-09 実機）。` +
        `⚠ 元の \`body{overflow:hidden}\` はビューポートへ伝播してこれを隠していましたが、読み替え後は伝播しません。`,
    );
  }

  // ② **スクロール容器と「一覧の器」が別要素であること。**
  //   1 層だった頃は `<ol>` が両方を兼ねており、安定クラス `sd-comment-list` 経由で
  //   ユーザー CSS が `overflow:hidden` を当てて**スクロール機能そのものを殺せた**
  //   （YouTube では `#items` と `#item-scroller` が別要素なので、テーマは両方に書くのが定番）。
  //   ⚠ 守るのは「`sd-comment-list` が付く要素と、スクロールする要素が別であること」。
  //
  //   ⚠⚠ **2026-08-09 に一度この 2 層化を撤回して「1 層 ＋ 床（無名 `@layer` の `!important`）」にしたが、
  //   差し戻した。** 撤回の根拠は「1 層は 060f 追修正⑦が paint 安定と実測した構造だから」だったが、
  //   ⑦が測った 7 通りは**テーマ遷移**であって**スクロール**ではなく、根拠が成立していなかった
  //   （案 A へ切り替えても描画バグは直らないことを実機で確認）。
  //   ⚠ **描画バグ（スクロールで課金カードの見切れていた部分が描かれない）は構造と無関係**——
  //   1 層でも 2 層でも出る。ここを触って直そうとしないこと。
  if (!/\.scroller\s*\{[^}]*overflow-y\s*:\s*auto/.test(viewerCss)) {
    fail(
      `${VIEWER_CSS}: \`.scroller { overflow-y: auto }\` がありません（060c 追修正・(10-p)）。` +
        `スクロール容器と一覧の器（\`<ol>\`＝\`sd-comment-list\`）は**別要素**である必要があります` +
        `——1 層に戻すと、テーマの \`#items{overflow:hidden!important}\` が` +
        `**スクロール機能ごと殺します**（2026-08-09 実機・プレビューで見切れてスクロール不能）。`,
    );
  }
  if (/\.list\s*\{[^}]*overflow/.test(viewerCss)) {
    fail(
      `${VIEWER_CSS}: \`.list\`（＝\`sd-comment-list\` が付く \`<ol>\`）に \`overflow\` が戻っています（060c 追修正・(10-p)）。` +
        `ここに overflow があると、その要素はユーザー CSS から \`overflow:hidden\` で潰せる` +
        `**スクロール容器**になります。スクロールは \`.scroller\` の責務です。`,
    );
  }

  // ④ **プレビュー枠の中身は枠より背が高くなれないこと（＝もう 1 つの床）。**
  //   `scopeSelectors` はテーマの `body`/`html`/`:root` を `.sd-preview`（＝`.themePreview > *`）へ読み替えるので、
  //   配布テーマの定型句 `body{min-height:100vh}` / `yt-live-chat-app{height:100vh}` が **200px の枠を突き抜ける**。
  //   このとき `<ol>` も一緒に伸びるので `scrollHeight === clientHeight`＝**スクロールも発生せず**、
  //   枠が切った下側へ**永久に到達できない**（2026-08-09 実機「特定のデザインだけ見切れたまま出てこない」）。
  //   ⚠ 実測（フィクスチャ 14 種）: 床なし **6/14 が到達不能** → 床あり **14/14 正常**、
  //   高さ指定の無いテーマは**床の有無で 1px も変わらない**。
  //   ⚠ 2 宣言そろって初めて効く——CSS では `min-height` が `max-height` に勝つので、
  //   `max-height` だけではテーマの `min-height:100vh` を止められない。
  const previewFloor =
    /@layer\s*\{\s*\.themePreview\s*>\s*\*\s*\{([^}]*)\}/.exec(viewerCss)?.[1] ?? "";
  if (
    !/min-height\s*:\s*0\s*!important/.test(previewFloor) ||
    !/max-height\s*:\s*100%\s*!important/.test(previewFloor)
  ) {
    fail(
      `${VIEWER_CSS}: プレビュー枠の床（\`@layer { .themePreview > * { min-height: 0 !important; max-height: 100% !important } }\`）が` +
        `ありません（060c 追修正④・(10-p)）。これが無いと、テーマの \`body{min-height:100vh}\` 等が` +
        `**プレビュー枠（200px）を突き抜け、\`<ol>\` も一緒に伸びてスクロールが発生しなくなり、` +
        `枠が切った下側へ永久に到達できません**（2026-08-09 実機・14 種中 6 種で再現）。` +
        `⚠ \`min-height: 0\` と \`max-height: 100%\` は**両方**必要です（\`min-height\` が \`max-height\` に勝つため）。` +
        `⚠ \`height\` は固定しないこと——テーマの \`body{margin}\` / \`body{padding}\` は効かせる設計です。`,
    );
  }
  if (
    /@layer\s+[A-Za-z_-][\w-]*\s*\{[^{}]*\.themePreview\s*>\s*\*\s*\{[^}]*!important/.test(
      viewerCss,
    )
  ) {
    fail(
      `${VIEWER_CSS}: プレビュー枠の床のレイヤーに**名前が付いています**（060c 追修正④・(10-p)）。` +
        `理由は \`.list\` の床と同じ——名前を付けるとテーマが \`@layer <その名前>{…}\` で**同じレイヤーへ合流**でき、` +
        `同一レイヤー内の詳細度勝負に戻って床が破れます（実測で確認済み）。`,
    );
  }

  // 目印（意匠 CSS から名指しするためのフック）が実在すること。⚠ `sd-` を付けない＝ユーザー CSS 契約ではない。
  //   ⚠⚠ **検査するのは「実際のコード」であって「文字列の出現」ではない**（自ミューテーションで判明・
  //   素の `includes("data-comment-scroll")` は**注記コメントに当たって生存する**）。属性の形・セレクタの形・
  //   `querySelector` 呼び出しの形まで含めて見る。
  const MARKER_USES = [
    // JSX 属性（値の代入まで見る＝コメントに当たらない）。
    [COMMENT_LIST_TSX, listTsx, /data-comment-scroll=\{/],
    // 意匠 CSS のセレクタ（`::-webkit-scrollbar` の当て先）。
    [
      OVERLAY_APP_CSS,
      overlayAppCss,
      /\[data-comment-scroll\]\)::-webkit-scrollbar/,
    ],
    // 縮小計測の引き先（`querySelector`）。
    [
      PINNED_OVERLAY_TSX,
      read(PINNED_OVERLAY_TSX),
      /querySelector\(\s*["'`]\[data-comment-scroll\]["'`]\s*\)/,
    ],
  ];
  for (const [file, src, re] of MARKER_USES) {
    if (!re.test(src)) {
      fail(
        `${file}: スクロール容器の目印 \`data-comment-scroll\` を実コードで使っていません（060c 追修正・(10-p)）。` +
          `期待する形: \`${re.source}\`。⚠ \`ol\` 要素セレクタへ戻さないこと——「スクロールする要素」を` +
          `**役割で**引くための目印です（034b が再修正トリガーとして予告していた形）。` +
          `目印が切れると、\`OverlayApp.module.css\` はバーを出したままになり、` +
          `\`PinnedOverlayApp\` の縮小計測は \`scrollHeight === clientHeight\` で**恒久 no-op** になります。`,
      );
    }
  }

  // ③ **目印・ref・onScroll は「スクロールする `<div>`」に付き、安定クラスは中の `<ol>` に付くこと。**
  //   ⚠ ②は CSS 側しか見ないので、DOM を 1 層へ戻す変更や、目印だけ `<ol>` へ移す変更は落ちない。
  //   ⚠ 目印が**スクロールしない要素**へ付くと、`PinnedOverlayApp` の縮小計測が
  //   `scrollHeight === clientHeight` で恒久 no-op になる。
  const scrollerTag = listTsx.match(/<div\s+className=\{styles\.scroller\}[\s\S]*?>/)?.[0] ?? "";
  for (const [what, re] of [
    ["目印", /data-comment-scroll=\{/],
    ["ref", /ref=\{scrollRef\}/],
    ["onScroll", /onScroll=\{follow\.onScroll\}/],
  ]) {
    if (!re.test(scrollerTag)) {
      fail(
        `${COMMENT_LIST_TSX}: スクロール容器の \`<div className={styles.scroller}>\` に ${what} が付いていません（060c 追修正・(10-p)）。` +
          `期待する形: \`${re.source}\`。⚠ スクロールするのは \`<div>\`（\`.scroller\`）で、` +
          `\`sd-comment-list\` が付くのは中の \`<ol>\` です（2 層）。`,
      );
    }
  }
  if (/<ol\s+className=[\s\S]*?>/.test(listTsx)) {
    const olTag = listTsx.match(/<ol\s+className=[\s\S]*?>/)[0];
    if (/data-comment-scroll=\{/.test(olTag) || /ref=\{/.test(olTag)) {
      fail(
        `${COMMENT_LIST_TSX}: \`<ol>\` に目印か ref が付いています（060c 追修正・(10-p)）。` +
          `**スクロールするのは外側の \`<div>\`（\`.scroller\`）**で、\`<ol>\` は「一覧の器」です` +
          `——同じ要素に戻すと、テーマの \`#items{overflow:hidden!important}\` がスクロール機能ごと殺します。`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// (10-q) **課金カードの影は `box-shadow` で描く（`filter` に戻さない）**（060c 追修正⑤・2026-08-09 実測）。
//   `filter: drop-shadow` が **WebKit の描画バグの真因**だった——プレビューをスクロールすると、見切れていた
//   課金カードが描かれない（本人報告「選択すると出る」＝レイアウトは正しく描画だけが古い）。
//   ⚠ 実測（実機・実物のコンポーネント・自己対照差分で判定・同一セッションの参照アームつき）:
//     `filter` = **20/20 で再現** ／ `filter:none` = 0/12 ／ **`box-shadow` = 0/12**。
//   ⚠ ここは jsdom では殺せない（カスケードもレイアウトも合成も評価されない）。実機でしか出ない。
//   ⚠ **`.bubble` は `filter` のまま**でなければならない——あちらは `::before`/`::after` のしっぽを含めた
//     1 つのシルエットに影を落としており、`box-shadow` にすると**しっぽの影が消える**（当て先が非対称なのは意図）。
{
  const overlayCss = read(OVERLAY_CSS);
  const cardBody = ruleBody(overlayCss, ".card");
  if (cardBody === null) {
    fail(`${OVERLAY_CSS}: \`.card\` の規則が見つかりません（060c 追修正⑤・(10-q)）。`);
  } else {
    if (/filter\s*:/.test(cardBody)) {
      fail(
        `${OVERLAY_CSS}: \`.card\`（課金カード）に \`filter\` が戻っています（060c 追修正⑤・(10-q)）。` +
          `\`filter: drop-shadow\` は **WebKit の描画バグの真因**で、プレビューをスクロールすると` +
          `**課金カードが描かれなくなります**（実機で 20/20 再現 → \`box-shadow\` で 0/12）。` +
          `影は \`box-shadow\` で描いてください——\`.card\` は \`overflow:hidden\` ＋角丸の**不透明矩形**なので` +
          `\`drop-shadow\` のシルエットとボーダーボックスが一致し、置換できます。` +
          `⚠ 実測の手順は \`docs/progress.md\` の 060c 節「追修正⑤」、理由は同ファイルの \`.card\` のコメントが正。`,
      );
    }
    if (!/box-shadow\s*:/.test(cardBody)) {
      fail(
        `${OVERLAY_CSS}: \`.card\` に \`box-shadow\` がありません（060c 追修正⑤・(10-q)）。` +
          `映像上でカードの輪郭を出すための影で、\`.bubble\` と同じ色トークンを使います。`,
      );
    }
  }
  // ⚠ 対の不変条件: `.bubble` は `filter: drop-shadow` のままであること（しっぽの影が消えるため置換不可）。
  const bubbleBody = ruleBody(overlayCss, ".bubble");
  if (bubbleBody !== null && !/filter\s*:\s*drop-shadow/.test(bubbleBody)) {
    fail(
      `${OVERLAY_CSS}: \`.bubble\` の \`filter: drop-shadow\` が無くなっています（060c 追修正⑤・(10-q)）。` +
        `⚠ **課金カードと同じ置換をここへ適用しないこと**——\`.bubble\` の影は` +
        `\`::before\`/\`::after\` の**しっぽを含めた 1 つのシルエット**に落ちており、` +
        `\`box-shadow\` にすると**しっぽの影だけが消えます**。`,
    );
  }
}

// (10-r) **エフェクト窓のテンプレート層の位置指定は意匠ではなく要件**（061d-2・穴 δ / 061d-1 レビュー Q-6）。
//   `EffectTemplateView` の器は `position: absolute; inset: 0` なので、置き場所を間違えると
//   **padding / gap を持つ箱を無視して飛び出す**。061d-2 は
//   「テンプレート専用の絶対配置層を作り、`.root` に基準を明示する」ことでこれを構造的に回避した。
//   ⚠⚠ **その担保は CSS 側の 2 ルールに乗っている**:
//     - `.root` の `position: relative` … 無いと `.templateLayer` の基準が初期包含ブロック
//       （＝窓）になり、`.root` に padding / margin が入った瞬間にずれる
//     - `.templateLayer` の `position: absolute; inset: 0` … これ自身が子の包含ブロックになる
//   ⚠⚠ **061h で `.effectStack`（組み込みカードの縦積み）の 2 検査を落とした。** 組み込み意匠を
//   廃止して**層が 1 枚になった**ので、「組み込みを手前に出す（`position: relative; z-index: 1`）」
//   という前後関係の担保は**守る対象そのものが無くなった**（061d-2 の穴 δ の論点は解消ではなく消滅）。
//   ⚠ 残る 2 ルールは 061h でも**そのまま生きている**（テンプレート層の基準は依然この 2 つ）。
//   ⚠⚠ **jsdom はカスケードもレイアウトも解決しない**ので、DOM 構造は
//   `EffectOverlayApp.test.tsx` が固定できても、**CSS だけを壊す変更は 1 件も止まらない**
//   （061d-2 のミューテーションで実測＝10 件中この 1 件だけが SURVIVED した）。
//   ⚠⚠ **061l で層が 2 枚になった**（`.eventLayer`＝配信イベント / `.templateLayer`＝エフェクト）。
//   **同じ理由がそのまま当てはまる**ので、イベント層の 2 宣言もここで固定する——
//   ⚠ こちらを外すと、イベントが `.root` の flex（中央寄せ）に巻き込まれて
//   **セットアップ用ガイドやテンプレートと重なる**が、**コンポーネントテストは全部緑のまま**である。
//   ⚠ **層を増やしたらここへ足すこと**（(10-d) の「窓を増やすたびに足す」と同じ運用）。
{
  const effectCss = read(EFFECT_OVERLAY_CSS);
  const expectations = [
    [".root", "position", "relative", "テンプレート層とイベント層の基準（無いと窓に解決される）"],
    [".templateLayer", "position", "absolute", "テンプレートを通常フローの外へ出す層"],
    [".templateLayer", "inset", "0", "層を窓いっぱいに広げる（`EffectTemplateView` の器の基準）"],
    [".eventLayer", "position", "absolute", "配信イベントを通常フローの外へ出す層（061l・判断 7）"],
    [".eventLayer", "inset", "0", "層を窓いっぱいに広げる（061l・判断 7）"],
  ];
  for (const [selector, prop, valuePattern, role] of expectations) {
    const body = ruleBody(effectCss, selector);
    if (body === null) {
      fail(
        `${EFFECT_OVERLAY_CSS}: \`${selector}\` の規則が見つかりません（061d-2・(10-r)）。` +
          `この 2 ルールでエフェクト窓のテンプレート層（\`.root\` を基準にした絶対配置層）が` +
          `成立しています。`,
      );
      continue;
    }
    if (!hasDecl(body, prop, valuePattern)) {
      fail(
        `${EFFECT_OVERLAY_CSS}: \`${selector}\` の \`${prop}\`（${role}）がありません（061d-2・(10-r)）。` +
          `⚠ これは意匠ではなく **061d-1 レビュー Q-6 の罠（\`inset:0\` の層が箱を突き抜ける）を` +
          `回避している構造**です。⚠ **jsdom はレイアウトを解決しないので、ここを外す変更を止められるのは` +
          `この検査だけ**（コンポーネントテストは全部緑のまま通ります）。` +
          `判断の全文は \`EffectOverlayApp.module.css\` の各ルールの注記と docs/progress.md の` +
          ` 061d-2 節（＋層が 1 枚になった経緯は 061h 節）が正。`,
      );
    }
  }
}

// (10-t) **取り込んだメディアを描く側で「実行文脈になれる入れ物」を作らない**（061d-2 レビュー S-2）。
//   docs/security.md の Capabilities 方針 061a 節「失効条件の最終判定」は、第三者由来のバイト列を
//   webview へ載せることの受容根拠を **3 経路が閉じていること**に置いている:
//     1. `image/svg+xml` / `text/html` を許可しない → `check-effect-template-contract.mjs` が固定
//     2. `innerHTML` 系を使わない                   → (10-i) が固定
//     3. `blob:` / `<iframe>` / 外部 URL を作らない → **ここまで機械検査が無かった**
//   ⚠⚠ 3 だけが「レビューと JSDoc」で支えられている状態は、1 と 2 に対して非対称である
//   （061c/061d のレビューが繰り返し「コメントだけが規約を支えている形を残さない」と書いている）。
//   ⚠ 対象は**取り込んだメディアを `src` に載せる 3 本**。ファイル名で選ぶ検査なので、
//   **描画を切り出したら必ずここへ足すこと**（(10-d) と同じ運用）。
{
  const banned = [
    ["createObjectURL", "`blob:` URL を作っています"],
    ["<iframe", "`<iframe>` を置いています"],
    ["srcDoc", "`srcDoc` を使っています"],
    ["srcdoc", "`srcdoc` を使っています"],
  ];
  for (const rel of [
    EFFECT_OVERLAY_TSX,
    EFFECT_TEMPLATE_VIEW_TSX,
    EFFECT_PREVIEW_TSX,
  ]) {
    // ⚠ コメントで言及するのは許す（この不変条件は各ファイルの JSDoc が説明しているため）。
    //   行コメント / ブロックコメントを落としてから見る（(10-i) と同じ前処理の考え方）。
    const src = read(rel)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
    for (const [needle, what] of banned) {
      if (src.includes(needle)) {
        fail(
          `${rel}: ${what}（061d-2・(10-t)）。` +
            `この窓が第三者由来のバイト列を \`src\` に載せられるのは、` +
            `**実行文脈が生まれる 3 経路が閉じている**ことだけが根拠です` +
            `（\`svg\`/\`html\` を許可しない・\`innerHTML\` を使わない・` +
            `**\`blob:\` / \`<iframe>\` / 外部 URL を作らない**）。` +
            `1 つでも緩めるのは受容根拠を作り直す変更なので、` +
            `先に docs/security.md の「Tauri Permissions / Capabilities 方針」061a 節を読むこと。`,
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// (11) 061g の不変条件: 画面を跨ぐ共通部品 3 本の意匠は **`components/` の 4 枚にだけ在る**。
//     061g は「置き場所だけを変え、描画は 1mm も変えない」タスクで、その安全性の議論は全部
//     **「移設であって複製ではない」**＝ VIEWER_CSS に 1 ルールも残っていないことに乗っている。
//     ⚠⚠ ところが 061g 時点では**その不変条件をどのガードも検査していなかった**
//     （2026-08-14 の独立レビューが変異で実測: VIEWER_CSS の末尾へ `.btn { … }` を書き戻す変異が
//     **本チェッカーも 1520 件のテストも素通り**した）。通ってしまうと `styles.btn` が再び実在クラスへ
//     解決し、`btnStyles.btn` と**別々の見た目で共存する**——(6-d) が塞いだ「打ち間違いが黙って通る」
//     と同型の穴。CSS モジュールは存在しないキーにも文字列を返すので、どの層も気づけない。
//     ⚠ **祖先の教訓**: このリポジトリは「別 CSS モジュールへ意匠を移したのにコメント/検査が
//     付いてこなかった」失敗を 3 回再発させている。移設そのものを不変条件にしたのがこの (11)。
// ---------------------------------------------------------------------------
{
  // 移設した意匠の一覧。**移設先ごとに「あちらに在り、こちらに無い」を両方向から見る。**
  // ⚠ `components/` へ 4 本目の部品を出したときは、ここへも足すこと（足し忘れは検査の縮小になる）。
  const MOVED = [
    [
      TOGGLE_CSS,
      [
        ".toggleRow",
        ".toggleRowInline",
        ".toggleLabel",
        ".switch",
        ".switchOn",
        ".knob",
        ".toggleRowDisabled",
      ],
    ],
    [SELECT_CSS, [".selectWrap", ".selectCustom", ".chevron"]],
    [
      CONFIRM_CSS,
      [
        ".confirmDialog",
        ".confirmBody",
        ".confirmTitle",
        ".confirmMessage",
        ".confirmActions",
      ],
    ],
    [BUTTONS_CSS, [".btn", ".btnGhost", ".dangerBtn"]],
    // 061i: **新設**の共通部品（タブ）。⚠ 移設ではないので (11-a) は自明に通るが、(11-b) が要る
    //   ——`.tabActive` をルールごと消しても**選択中のタブが「ただのボタン」に見えるだけ**で、
    //   jsdom はレイアウトも色も解決しないため**テストは全部緑のまま通る**
    //   （`.dangerBtn` の実測と同型の穴。意匠ではなく「いまどれを見ているか」が消える）。
    [TABS_CSS, [".tabs", ".tab", ".tabActive"]],
  ];
  const movedClasses = MOVED.flatMap(([, sels]) => sels);
  // `.btn` が `.btnGhost` / `.dangerBtn` に誤ヒットしないよう、クラス名の直後が識別子文字でないことを見る。
  const classToken = (name) =>
    new RegExp(`${name.replace(/\./g, "\\.")}(?![A-Za-z0-9_-])`);

  // (11-a) **複製ゼロ**: VIEWER_CSS に移設クラスが 1 つも残っていないこと。
  //   `ruleBody` の否定ではなく**セレクタの全走査**にするのは、`ruleBody` が「行頭のセレクタ直後が `{`」
  //   の形しか拾わず、`.btn, .other { … }` と束ねられると**黙って素通りする**ため（(6-c) が塞いだ
  //   fail-open と同型）。子孫セレクタ（`.card .btn`）も拾う。
  const viewerSource = readCssGuarded(
    VIEWER_CSS,
    "(11-a) の「移設した意匠が元の窓に残っていないこと」を検査できません。",
  );
  if (viewerSource !== null) {
    for (const m of viewerSource.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = m[1].replace(/\s+/g, " ").trim();
      if (selector.startsWith("@") || selector === "") continue;
      for (const name of movedClasses) {
        if (!classToken(name).test(selector)) continue;
        const [dest] = MOVED.find(([, sels]) => sels.includes(name));
        fail(
          `${VIEWER_CSS}: ` +
            (selector === name
              ? `\`${name}\` のルールがここにあります`
              : `\`${selector}\` が \`${name}\` を含んでいます`) +
            `（061g・(11-a)）。` +
            `このクラスは **${dest} へ移設済み**で、ここに書くと**複製**になります。` +
            `複製が在ると \`styles${name}\` が再び実在クラスへ解決し、\`btnStyles${name}\` / ` +
            `\`confirmStyles${name}\` と**別々の見た目で共存**します（CSS モジュールは存在しないキーにも` +
            `文字列を返すので typecheck も vitest も緑のまま通る＝ (6-d) が塞いだ穴と同型）。` +
            `⚠ 意匠を変えたいなら **${dest} 側を直すこと**（この窓に書き戻さない）。` +
            `この窓だけの別意匠が要るなら、**別のクラス名**を付けてください。`,
        );
      }
    }
  }

  // (11-b) **移設先に実体が在る**こと。⚠ 消えても誰も気づかない——独立レビューの変異実測で
  //   `.dangerBtn` をルールごと削除しても `.confirmMessage` を削除しても**緑のまま通った**。
  //   `.dangerBtn` が消えると**破壊的操作（削除確認）の危険色が無音で消える**＝意匠ではなく安全性の退行。
  for (const [rel, sels] of MOVED) {
    const src = readCssGuarded(
      rel,
      "(11-b) の「移設先に意匠が実在するか」を検査できません。",
    );
    if (src === null) continue;
    for (const sel of sels) {
      if (ruleBody(src, sel) !== null) continue;
      fail(
        `${rel}: \`${sel}\` のルールを取り出せません（061g・(11-b)）。` +
          `削除したか、クラス名を変えたか、セレクタをカンマで束ねた可能性があります。` +
          (sel === ".dangerBtn"
            ? `⚠⚠ \`.dangerBtn\` は**破壊的操作（視聴者メモリ削除・テーマ削除・テンプレート削除）の` +
              `実行ボタンの危険色**です。消えると確認ダイアログの危険色が無音で消えます。`
            : `このクラスは ${rel} の利用者（\`components/\` の部品と、それを使う各画面）が参照しています。`) +
          `束ねたのならこのガードの取り出し方も一緒に直してください` +
          `（黙って検査が無効になるのを防ぐため fail します）。`,
      );
    }
  }

  // (11-c) **TSX → CSS の向きを閉じる**（(4) の tone 表 / (6-d) と同型）。(11-b) は「CSS にルールが在る」
  //   ことしか見ないので、TSX 側で `btnStyles.dangerBtn` を `btnStyles.danger` に打ち間違えても、
  //   あるいは `danger` 分岐そのものを消しても素通りする。CSS モジュールは存在しないキーにも文字列を
  //   返すため typecheck も vitest も緑（`vite/client` の宣言が `Record<string, string>`）。
  //   ⚠ `styles.` ではなく **`btnStyles.` / `confirmStyles.` という別名でしか参照されない**ので、
  //   (6-d) が避けた `sp.styles.some(…)` のような誤検出は起きない（別名は 061g が導入した専用の名前）。
  const ALIASED = new Map([
    ["btnStyles", BUTTONS_CSS],
    ["confirmStyles", CONFIRM_CSS],
  ]);
  for (const [rel, src] of collectTsSources("src")) {
    for (const [alias, cssRel] of ALIASED) {
      const cssSource = readCssGuarded(
        cssRel,
        `(11-c) の「TSX の \`${alias}.X\` が CSS に実在するか」を検査できません。`,
      );
      if (cssSource === null) continue;
      for (const m of src.matchAll(
        new RegExp(`\\b${alias}\\.([A-Za-z0-9_]+)`, "g"),
      )) {
        const key = m[1];
        if (ruleBody(cssSource, `.${key}`) !== null) continue;
        fail(
          `${rel}: \`${alias}.${key}\` が参照されていますが、${cssRel} に \`.${key}\` がありません` +
            `（061g・(11-c)）。クラス名の打ち間違い、または CSS 側の削除・改名です。` +
            `CSS モジュールは存在しないキーでも文字列を返すため、typecheck も vitest も緑のまま通り、` +
            `**該当要素だけ意匠が当たらない**状態になります（jsdom は CSS を解決しないので気づけません）。`,
        );
      }
    }
  }

  // (11-d) **危険色の分岐が生きている**こと。(11-b)(11-c) は「クラスが在る／参照が正しい」までで、
  //   `danger ? btnStyles.dangerBtn : btnStyles.btn` を `btnStyles.btn` に潰す変更は捕まえられない
  //   （どちらも実在するクラスなので）。⚠ これは 060c の「うっかり Enter で実行してしまう」対策と対で、
  //   **削除確認が普通のボタンに見える**ことになる＝意匠ではなく安全性の退行。
  //   ⚠ 既定フォーカス（`autoFocus` がキャンセル側）は `ConfirmDialog.test.tsx` が検査する
  //   （DOM で見えるものはテストの担当・CSS で見えないものが本チェッカーの担当、という切り分け）。
  const CONFIRM_TSX = "src/components/ConfirmDialog.tsx";
  const confirmTsx = stripTsComments(readRaw(CONFIRM_TSX));
  if (!/danger\s*\?\s*btnStyles\.dangerBtn\s*:\s*btnStyles\.btn/.test(confirmTsx)) {
    fail(
      `${CONFIRM_TSX}: 実行ボタンの \`danger ? btnStyles.dangerBtn : btnStyles.btn\` が見つかりません` +
        `（061g・(11-d)）。**破壊的操作（削除確認）の危険色はこの分岐だけが担保**しています` +
        `（消えると削除ボタンが通常色になり、取り消せない操作が普通の操作に見えます）。` +
        `分岐の書き方を変えるなら、このガードの検査方法も一緒に直してください` +
        `（色は jsdom で解決されないため、コンポーネントのテストでは検出できません）。`,
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
