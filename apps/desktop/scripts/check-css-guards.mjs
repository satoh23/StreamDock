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
const SETTINGS_TSX = "src/screens/comment-viewer/SettingsView.tsx";
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
if (failures.length > 0) {
  console.error("CSS guard check FAILED:\n");
  for (const f of failures) console.error(`  - ${f}\n`);
  process.exit(1);
}
console.log("CSS guard check OK");
