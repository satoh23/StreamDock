/**
 * 060d: 注入まわりの CSS 純関数 2 本。React/CSS/DOM 非依存で、素の Node からも import できる。
 *
 * 1. `scopeSelectors(css, ".sd-preview")` … **プレビュー専用**。全セレクタをラッパ配下へ閉じ込める。
 *    `<style>` はスコープを持たないので、これが無いとプレビューの CSS が**コメビュ窓全体へ漏れる**。
 * 2. `unclosedBlockDepth(css)` … 取り込み後の CSS が**途中で途切れているか**の判定
 *    （060b review② Q-3 の「対応の取れていない `(` で残り全部が消える」に気づかせるため）。
 *
 * ## ⚠ なぜ `cssCompat.ts` と別ファイルなのか（060a からの申し送り③）
 *
 * - `cssCompat.ts` は **060a の資産で本タスクでは 1 バイトも触らない**（`git status` で差分ゼロを担保する）。
 *   そのため向こうの `scanPreludes()` を `export` して借りることはしない。
 * - 加えて `scripts/check-css-guards.mjs` の **(10-b)** は `cssCompat.ts` の `to:` 右辺 ⊆ 安定クラス契約を
 *   検査しており、`.sd-preview` は**実 DOM の安定クラス契約には無い**（プレビューのラッパ専用）ので、
 *   向こうの変換表に混ぜてはいけない。分離を **(10-h)** が機械で固定している。
 *
 * ## ⚠ 走査器を複製していることについて（**片方向にだけずらしてある**）
 *
 * 下の `scan()` は `cssCompat.ts` の `scanPreludes()` と同型から出発した**意図的な複製**で、理由は
 * 「060a の資産を凍結したまま 060d の都合を足す」。
 *
 * ⚠⚠ **security-review（2026-08-05）で、この走査器が実 CSS パーサと desync して
 * 「`.sd-preview` が前に付かない規則」を作れることが実測された**（PoC 8 系統・独立実装の CSS パーサを
 * oracle に確認）。⚠⚠ **さらに security-review②（同日・第三者）で、下の修正の取りこぼしが 2 系統
 * 実測された**（`isIdentStart` の `\`＋改行・`atRuleName` のエスケープ未復元＝各関数の注記を参照）。
 * ＝ **「1 か所直したら閉じた」と考えないこと。この走査器は仕様トークナイザとの差分でしか検証できない。**
 * 原因は 2 つで、どちらも **`cssCompat.ts` の `scanPreludes()` にも同じ形で残っている**:
 *
 * 1. **無引用の `url(` トークンを素通りしていた。** 実 CSS では `url(` から `)` までは**不透明**で、
 *    中の `/`＋`*` や `"` `'` `{` `}` は構文ではない。`url(data:text/css,` ＋ `/`＋`*` ＋ `)` は
 *    060b のサニタイザを **stripped=0・無改変**で通り、走査器だけが「コメント開始」と誤認して
 *    **そこから EOF までを飲み**、以降の規則が素のまま出力されていた。
 * 2. **CSS エスケープ（`\`）を一切扱っていなかった。** `--x:\{` / `.a\{b` の `\{` は ident の一部で
 *    ブロックを開かないが、走査器は実ブロック開始と誤認して深さがずれていた。
 *    `.a\(b,.c{}` は `splitTopLevelCommas` 側が壊れて `.c` が素で残った。
 *
 * → **本ファイルだけを直した**（`cssCompat.ts` は 060a の凍結資産なので触らない）。
 * ⚠ これで両者は**もう同型ではない**が、ずれる向きは**安全側の片方向**である:
 * `scan()` のほうが正しくプレリュードを見つけるので、**`rewriteSelectors` が変換した規則は必ず
 * `scopeSelectors` にも見えている**（＝「変換されたがスコープされない」は起きない）。
 * 逆に `cssCompat.ts` が url トークンの中を誤ってプレリュードと見なした場合、そこは実 CSS では規則ではなく
 * ブラウザが適用しないので無害（＝変換が効かないだけ）。
 * **この関係は `cssScope.test.ts` の「脱出ゼロ」不変条件が敵対的コーパスで固定している。**
 * 再修正トリガー＝ `cssCompat.ts` の `scanPreludes` を変更したら必ずこの `scan()` も一緒に見ること
 * （とくに**向きを逆転させない**＝あちらだけを厳密にすると漏れる側に倒れる）。
 *
 * ## ⚠ この module が「しないこと」
 *
 * - **`@import` と `url()` には触らない**（除去は 060b・取得は 060c の責務）。下の走査は文字列・
 *   コメント・**url トークン**の中身を一切見ないので、この分離は**祈りではなく構造**で成立している。
 * - **CSS の完全パースはしない**（新規依存ゼロ）。読み分けるのは
 *   「コメント / 文字列 / エスケープ / ident / url トークン / `{}` / `;`」だけ。
 * - **オーバーレイ窓への注入では `scopeSelectors` を使わない**（窓ごと分かれているため前置は不要かつ有害）。
 *
 * ## ⚠⚠ スコープ化が守れないもの（＝ここだけでは閉じない・security-review S-2 / S-3）
 *
 * `scopeSelectors` が保証するのは「**どの要素に当たるか**」だけで、次の 2 つは守れない:
 *
 * - **どこに描かれるか**: 配下の要素に `position:fixed` / `absolute` を当てると、祖先の `overflow:hidden`
 *   では切られない（包含ブロックがビューポート／初期包含ブロックになるため）。実測で
 *   `.themePreview` / `.card` / `.settingsView` のどれにも包含ブロックを作る性質が無かった。
 *   → 閉じているのは **`.themePreview` の `contain: paint`**（`CommentViewerApp.module.css`）。
 * - **文書グローバルな名前**: `@font-face` の `font-family` 名と `@keyframes` の名前。
 *   ⚠ **この 2 つだけではない**（security-review②・2026-08-05）——`@property`（カスタムプロパティの
 *   **登録**。`inherits` と `initial-value` が文書全体の計算値に効き、`syntax` に合わない既存値を無効化できる）と
 *   `@counter-style` も同じ性質を持つ。どれも「規則を持たないアットルール」なので下の `scan()` は中身に
 *   触れず、060b のサニタイザも通す。**受容の範囲はこの 4 種**として読むこと。
 *   ⚠ 060b は `data:` の `url()` を許可形として残すので、`local()` の差し替えだけでなく
 *   **任意の woff2 を data URI で持ち込んで既存フォント名を乗っ取る**ことまで成立する
 *   （実測: `@font-face{font-family:"Segoe UI";src:url(data:font/woff2;base64,…)}` は stripped=0）。
 *   現状の対処は**プレビューを開いている間だけ `<style>` を置く**＝露出時間を限ることだけ。
 *   → **恒久策は shadow root / iframe への移行**（設計変更なので別タスク）。
 */

/**
 * 060d: プレビューのラッパに付ける**素の文字列クラス**。
 *
 * ⚠ CSS モジュールのハッシュ名では `scopeSelectors` が前置する文字列と一致しない（`sd-overlay` と同じ扱い）。
 * ⚠ **クラス名とセレクタをここ 1 か所で定義する**のが要点——ラッパ側とスコープ化側で別々に書くと、
 * 片方をリネームしても typecheck も vitest も通ってしまい（どちらもただの文字列で、
 * 「漏れたこと」を jsdom は再現しない）、**プレビューの CSS がコメビュ窓全体へ漏れる**。
 * 使われ方は `scripts/check-css-guards.mjs` の **(10-h)** が静的に固定している。
 */
export const PREVIEW_SCOPE_CLASS = "sd-preview";
/** 上のクラスのセレクタ表現（`scopeSelectors` の第 2 引数）。 */
export const PREVIEW_SCOPE_SELECTOR = `.${PREVIEW_SCOPE_CLASS}`;

/**
 * 中に「規則」を持つアットルール（この中はセレクタとして走査を続ける）。
 *
 * ⚠ `cssCompat.ts`（060a の凍結資産）と同じ集合＋`starting-style`。
 * ⚠⚠ **これは allow-list なので、載っていないアットルールの中身は「宣言」として素通りする**
 * ＝ **中の規則に前置されない**。ブラウザが規則リストを持つアットルールを増やすたびに穴が空くので、
 * **再修正トリガー＝ CSS の新しいグループ規則が実装されたら必ずここへ足すこと**。
 * `starting-style` は security-review②（2026-08-05）の実測で漏れが見つかったぶん
 * （被害はトランジションの開始値に限られるが、失敗の形は S-1b と同型）。
 */
const GROUP_AT_RULES: ReadonlySet<string> = new Set([
  "media",
  "supports",
  "container",
  "layer",
  "scope",
  "document",
  "starting-style",
]);

/**
 * ident の続きになりうる文字（＝トークン境界の否定先読みに使う集合）。
 *
 * ⚠ **`\`（CSS エスケープ）と非 ASCII を含める**（security-review S-1）。`html\41 {}` は ident `htmlA`、
 * `body日本{}` は ident `body日本` で、どちらも root 相当ではない。含めないと
 * `.sd-preview\41` のような**当たらないセレクタ**を作る（安全側には倒れるが黙って効かなくなる）。
 * css-syntax-3 の ident code point は U+0080 以上をすべて含むので、ここは**含める側**が仕様どおり
 * （060b review② S-1 の「url 位置の貪欲読みでは ASCII に絞る」とは逆向きの論点である点に注意）。
 */
const IDENT_TAIL = String.raw`(?:[A-Za-z0-9_\-\\]|\P{ASCII})`;

/**
 * ⚠ プレビューでは**ラッパ自身へ読み替える**セレクタ（前置してはいけないもの）。
 *
 * - `:root` / `html` / `body` … プレビューのラッパの**祖先**なので、素朴に前置すると
 *   `.sd-preview :root` になって**絶対に当たらない**。⚠ 依頼者の実サンプルが `:root { --txtcolor }` を
 *   含んでおり、これを外すと「プレビューでだけ色が反映されない」という原因の分かりにくい不一致になる
 *   （060a の実サンプル検証で判明・progress.md 060a 節）。
 * - `.sd-overlay` … 実配信での窓ルート。プレビューでの対応物がラッパなので同じ扱いにする。
 *   これが無いと、ユーザーが StreamDock 語彙で書いた `.sd-overlay { --sd-comment-bg: … }`
 *   （＝ CSS 変数を上書きする唯一の器）が**プレビューでだけ効かない**。
 *
 * 型セレクタと擬似クラスは CSS 上大小無視なので `html` / `body` / `:root` は `i` で拾う。
 * ⚠ 一方 `.sd-overlay` は**クラス名＝大小区別**なので `i` を付けない（`.SD-OVERLAY` は別のクラス）。
 */
const ROOT_LIKE_CI = new RegExp(`^(?::root|html|body)(?!${IDENT_TAIL})`, "iu");
const ROOT_LIKE_CS = new RegExp(`^\\.sd-overlay(?!${IDENT_TAIL})`, "u");
/** 2 つ目以降の root 相当（`html > body .foo` の ` > body`）。子孫・子結合子だけを許す。 */
const TRAILING_ROOT_LIKE = new RegExp(
  `^(?:\\s*>\\s*|\\s+)(?::root|html|body)(?!${IDENT_TAIL})`,
  "iu",
);

/** 文字列リテラルの終端の次の位置を返す（改行での不正終端も CSS 仕様どおりそこで閉じる）。 */
function skipString(css: string, start: number): number {
  const quote = css[start];
  let i = start + 1;
  while (i < css.length) {
    const c = css[i];
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === quote) return i + 1;
    if (c === "\n") return i;
    i++;
  }
  return css.length;
}

/**
 * ident の**開始**になりうる文字（数字は除く。`\` は CSS エスケープの開始）。
 *
 * ⚠⚠ **`\` ＋改行は ident を開始しない**（security-review② S-1a・2026-08-05）。css-syntax-3 §4.3.7 の
 * 「2 つのコードポイントが valid escape か」は **`\` の次が改行なら false** で、そのとき `\` は
 * **ただの delim トークン**になる。ここで ident を開始すると改行を ident に飲み込み、
 * **直後の `url(` が url トークンとして認識されなくなる**（＝[`skipUrlToken`] の不透明扱いが起動しない）。
 * 実測で成立した脱出: `.a{color:\`＋改行＋`url(data:x,{)}` は、url トークンの中の `{` を実ブロック開始と
 * 誤認して以降ずっと深さがずれ、**後続の規則が素のまま出力された**（仕様トークナイザで裏取り済み）。
 * ⚠ `next` は「`c` の次の文字」。EOF（`undefined`）も valid escape ではないので false。
 */
function isIdentStart(c: string, next?: string): boolean {
  if (c === "\\") return next !== undefined && !/[\n\r\f]/.test(next);
  return /[A-Za-z_-]/.test(c) || c >= "\u0080";
}

/** ident の**続き**になりうる文字（`\` を除く。エスケープは `readIdent` が個別に処理する）。 */
function isIdentChar(c: string): boolean {
  return /[A-Za-z0-9_-]/.test(c) || c >= "\u0080";
}

/**
 * `start` から ident を 1 つ読み、次の位置と**エスケープを復元した小文字の値**を返す。
 *
 * ⚠ 復元まで行うのは `url(` の綴りを**エスケープで隠せないようにする**ため（security-review S-1）。
 * `\75 rl(` / `u\72 l(` は仕様上 `url(` と同じ関数トークンで、060b の allow-list も同じ扱いをする。
 * 素の文字列比較だけだと、ここで url トークンの**不透明扱いを外せてしまう**＝走査器を desync できる。
 */
function readIdent(css: string, start: number): { end: number; value: string } {
  let i = start;
  let value = "";

  while (i < css.length) {
    const c = css[i];
    if (c === "\\") {
      // ⚠⚠ **`\` ＋改行は valid escape ではない**（css-syntax-3 §4.3.7・security-review② S-1a）。
      // 仕様では delim トークンになり、ident はここで終わる。飲み込むと直後の `url(` を
      // url トークンとして認識できなくなり、走査器が desync する（実測で脱出が成立した）。
      // ⚠ EOF（`css[i + 1]` が undefined）も valid escape ではないので、同じくここで終える
      // （`isIdentStart` が偽になるので、そもそもここから ident を開始することはない）。
      if (/[\n\r\f]/.test(css[i + 1] ?? "\n")) break;
      const hex = /^[0-9a-fA-F]{1,6}/.exec(css.slice(i + 1, i + 7));
      if (hex === null) {
        // 改行以外の不正なエスケープ（`\{` `\(` 等）は **valid escape なので 2 文字進める**。
        // ここで止まると `\{` を実ブロック開始と誤認する退行に戻る。
        value += css[i + 1] ?? "";
        i += 2;
        continue;
      }
      const cp = parseInt(hex[0], 16);
      const invalid = cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff);
      value += invalid ? "\uFFFD" : String.fromCodePoint(cp);
      i += 1 + hex[0].length;
      // 16 進エスケープ直後の空白 1 個は区切りとして食われる（css-syntax-3）。
      if (i < css.length && /\s/.test(css[i])) i++;
      continue;
    }
    if (!isIdentChar(c)) break;
    value += c;
    i++;
  }

  return { end: i, value: value.toLowerCase() };
}

/**
 * `url(` の開き括弧の**次**から url トークンを読み飛ばし、閉じ `)` の次の位置を返す。
 *
 * ⚠⚠ **これが security-review S-1 の本体。** 実 CSS では無引用の `url(` から `)` までは
 * **1 つの不透明なトークン**で、中の `/`＋`*`・引用符・`{` `}` は構文ではない。
 * これを解釈してしまうと、`url(data:text/css,` ＋ `/`＋`*` ＋ `)` の 1 行で走査が EOF まで飛び、
 * 以降の規則が**スコープされずに出力される**（実測で成立した）。
 * ⚠ 引数付き引用形（`url("…")`）は関数トークン＋文字列なので**不透明にしない**（`null` を返し、
 * 通常の文字列走査に任せる）。中身の解釈が要らない点は同じで、二重に扱うと差分が生まれる。
 * ⚠ 仕様上、正常な url-token も bad-url-token も**どちらも `)` で終わる**ので、終端は 1 通りに決まる。
 */
function skipUrlToken(css: string, start: number): number | null {
  let i = start;
  while (i < css.length && /\s/.test(css[i])) i++;
  const head = css[i];
  if (head === undefined || head === '"' || head === "'") return null;

  while (i < css.length) {
    const c = css[i];
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === ")") return i + 1;
    i++;
  }
  return css.length;
}

/**
 * プレリュードがアットルールなら、その名前（**エスケープを復元した小文字**）を返す。通常セレクタなら null。
 *
 * ⚠⚠ **名前は必ず [`readIdent`] で読むこと**（security-review② S-1b・2026-08-05）。旧実装は
 * `/^@([A-Za-z-]+)/` でエスケープを解釈していなかったため、**`@med\69 a` が `"med"` に化けて
 * `GROUP_AT_RULES` から外れ、中の規則に前置されなかった**（＝ラッパの外へ丸ごと脱出できた）。
 * 仕様（css-syntax-3 §4.3.1）では at-keyword トークンの値はエスケープ復元後の ident なので、
 * `@med\69 a` は**ブラウザにとって `@media` そのもの**である（仕様トークナイザで実測）。
 * 同型で `@suppo\72 ts` / `@lay\65 r` / `@containe\72` / `@scop\65` も成立していた。
 * ⚠ 副作用として `@media2` のような「英字以外で終わる名前」は旧実装の `"media"` から `"media2"` へ変わるが、
 * これは**仕様どおり**（ブラウザも未知のアットルールとしてブロックごと捨てる）＝安全側。
 */
function atRuleName(prelude: string): string | null {
  const head = prelude.replace(/\/\*[\s\S]*?\*\//g, "").trimStart();
  if (!head.startsWith("@")) return null;
  const { value } = readIdent(head, 1);
  return value === "" ? null : value;
}

interface ScanResult {
  /** 通常ルール（アットルールでない）のプレリュードの**生範囲**（コメント・文字列を含む）。 */
  preludes: { start: number; end: number }[];
  /** EOF 時点で閉じられていないブロックの数（余分な `}` では負にならない）。 */
  depth: number;
}

/**
 * CSS を 1 パス走査し、「`.sd-preview` を前置してよいプレリュードの範囲」と「閉じ忘れの数」を得る。
 *
 * - コメント・文字列・**ident / url トークン**は**中身を一切見ずに素通り**する
 *   ＝ `url()` の中身にも `@import` の URL にも触れない。
 *   ⚠ ident と url を**トークンとして**読むのが security-review S-1 の修正点。1 文字ずつ進めると
 *   `\{`（ident の一部）や `url(…/`＋`*…)`（不透明）を構文と誤認して desync する。
 * - `{` の中身は「宣言」として素通りし、**グループ規則の中だけ**セレクタ走査を続ける
 *   ＝ ⚠ **`@keyframes` の `from` / `to` / `50%` をセレクタと誤認しない**（前置すると意味が壊れる）。
 *   `@font-face` / `@page` / `@property` も同じ理由で中身に触れない。
 * - `@` で始まるプレリュードは**そのまま**（`@media (…)` の条件部分を書き換えない）。
 * - 壊れた CSS（`{` が閉じない等）でも throw しない。処理できた範囲だけ返す。
 */
function scan(css: string): ScanResult {
  const preludes: { start: number; end: number }[] = [];
  /** 親スコープが規則リストだったか（`}` で復帰するため積む）。長さ＝現在のブロック深さ。 */
  const stack: boolean[] = [];
  let inRuleList = true;
  let rawStart = 0;
  let i = 0;

  while (i < css.length) {
    const c = css[i];

    if (c === "/" && css[i + 1] === "*") {
      const e = css.indexOf("*/", i + 2);
      i = e === -1 ? css.length : e + 2;
      continue;
    }

    if (c === '"' || c === "'") {
      i = skipString(css, i);
      continue;
    }

    // ⚠ ident は**まるごと**読み飛ばす（security-review S-1）。ident は `{` `}` `;` を含まない
    // ——ただし**エスケープ経由なら含みうる**（`--x:\{`）ので、1 文字ずつ進めてはいけない。
    // 直前が ident 構成文字のときは ident の途中なので、ここでは開始しない（`2url(` を url と誤認しない）。
    if (isIdentStart(c, css[i + 1]) && (i === 0 || !isIdentChar(css[i - 1]))) {
      const ident = readIdent(css, i);
      if (ident.value === "url" && css[ident.end] === "(") {
        const after = skipUrlToken(css, ident.end + 1);
        if (after !== null) {
          i = after;
          continue;
        }
      }
      // ident.end は必ず i より先へ進む（isIdentStart が真なら 1 文字以上読む）＝無限ループしない。
      i = ident.end;
      continue;
    }

    if (c === "{") {
      let childIsRuleList = false;
      if (inRuleList) {
        const name = atRuleName(css.slice(rawStart, i));
        if (name === null) preludes.push({ start: rawStart, end: i });
        else childIsRuleList = GROUP_AT_RULES.has(name);
      }
      stack.push(inRuleList);
      inRuleList = childIsRuleList;
      i++;
      rawStart = i;
      continue;
    }

    if (c === "}") {
      inRuleList = stack.length > 0 ? (stack.pop() as boolean) : true;
      i++;
      rawStart = i;
      continue;
    }

    // `@import "…";` / `@charset "…";` / `@layer a,b;` のような文で終わるアットルール。
    if (c === ";" && inRuleList) {
      i++;
      rawStart = i;
      continue;
    }

    i++;
  }

  return { preludes, depth: stack.length };
}

/**
 * セレクタリストを**トップレベルのカンマ**で分割する。
 * `(` `[` の内側・文字列・コメント・**エスケープ**の中のカンマでは分割しない
 * （`:not(.a, .b)` / `[title="a, b"]` / `.a\,b` / CSS コメントの中のカンマ を壊さない）。
 *
 * ⚠⚠ **エスケープを見るのは必須**（security-review S-1）。`.a\(b,.c{}` は実 CSS では
 * 「クラス `a(b`」と「`.c`」の 2 要素のセレクタリストだが、`\(` を括弧と数えると深さが 1 のままになり
 * **カンマで分割されない** → 前置が先頭にしか付かず `.sd-preview .a\(b,.c` ＝ **`.c` が素で残る**
 * （＝ラッパの外へ漏れる）。実測で成立した形。
 */
function splitTopLevelCommas(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  let i = 0;

  while (i < text.length) {
    const c = text[i];
    if (c === "/" && text[i + 1] === "*") {
      const e = text.indexOf("*/", i + 2);
      i = e === -1 ? text.length : e + 2;
      continue;
    }
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === '"' || c === "'") {
      i = skipString(text, i);
      continue;
    }
    if (c === "(" || c === "[") {
      depth++;
      i++;
      continue;
    }
    if (c === ")" || c === "]") {
      if (depth > 0) depth--;
      i++;
      continue;
    }
    if (c === "," && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
    i++;
  }

  parts.push(text.slice(start));
  return parts;
}

/** 先頭の空白と CSS コメントを本体から切り離す（コメントで始まる `:root` も root 相当と認識するため）。 */
function splitLeadingTrivia(part: string): [string, string] {
  let i = 0;
  for (;;) {
    while (i < part.length && /\s/.test(part[i])) i++;
    if (part.startsWith("/*", i)) {
      const e = part.indexOf("*/", i + 2);
      i = e === -1 ? part.length : e + 2;
      continue;
    }
    break;
  }
  return [part.slice(0, i), part.slice(i)];
}

/**
 * 1 つの複合セレクタをラッパ配下へ閉じ込める。
 *
 * - 先頭が root 相当（`:root` / `html` / `body` / `.sd-overlay`）なら、その**トークンだけ**を `scope` へ
 *   置換する（`html.dark .foo` → `.sd-preview.dark .foo`＝複合の残りを保つ）。
 * - 続けて並ぶ root 相当（`html > body .foo` の ` > body`）は**取り除く**。
 * - それ以外は `scope` を前置する。
 */
function scopePart(part: string, scope: string): string {
  const [trivia, body] = splitLeadingTrivia(part);
  // 空のパート（`{}` 直前の空白・末尾カンマの後ろ）はそのまま返す。
  if (body === "") return part;

  const head = ROOT_LIKE_CI.exec(body) ?? ROOT_LIKE_CS.exec(body);
  if (head === null) return `${trivia}${scope} ${body}`;

  let rest = body.slice(head[0].length);
  for (;;) {
    const more = TRAILING_ROOT_LIKE.exec(rest);
    if (more === null) break;
    rest = rest.slice(more[0].length);
  }
  return `${trivia}${scope}${rest}`;
}

/**
 * 060d: CSS の全セレクタを `scope`（プレビューのラッパ）配下へ閉じ込める。**プレビュー専用**。
 *
 * ⚠⚠ **冪等ではない**（2 回通すと `.sd-preview .sd-preview …` になる）。⚠ 一方 `rewriteSelectors`（060a）は
 * 冪等性を機能要件にしているので、**同じ CSS を扱う 2 本で性質が非対称**である。事故になっていないのは
 * 「呼ぶのはプレビューの注入 1 か所だけ」という規約だけが根拠なので、**呼び出しを増やさないこと**。
 * ⚠ 「既に scope 済みなら何もしない」という自己防衛は**入れてはいけない**——その判定自体が
 * 「`.sd-preview` で始まるセレクタを書けば前置を回避できる」という攻撃面になる（security-review Q-16）。
 * 再修正トリガー＝2 か所目から呼びたくなったら、呼び出し側で「素の CSS を 1 回だけ通す」形に直すこと。
 *
 * ⚠ **スコープしきれないもの（既知の限界）**:
 * - `@font-face` の `font-family` 名と `@keyframes` の名前は**文書グローバル**。既存の名前を再定義する
 *   テーマを入れると、プレビューを開いている間だけコメビュ窓の他所へ波及しうる。
 *   ⚠⚠ 範囲は `local()` の差し替えだけではない——**060b は `data:` の `url()` を許可形として残す**ので、
 *   `@font-face{font-family:"Segoe UI";src:url(data:font/woff2;base64,…)}` で**任意のグリフを持つフォント**を
 *   持ち込み、アプリ UI のフォント名を乗っ取れる（＝表示文字列の偽装。実測で stripped=0・security-review S-3）。
 *   → 呼び出し側（`OverlayThemeCard`）は**プレビューを開いている間だけ `<style>` を置く**ことで露出を限る。
 *   ⚠ これは**露出時間を限るだけで、閉じてはいない**。名前の書き換えは `var()` 経由で破れるので中途半端になる。
 *   再修正トリガー＝**恒久策は shadow root / iframe への移行**（設計変更につき別タスク。
 *   実際に波及が観測されるか、プレビュー以外の場所でユーザー CSS を描画したくなった時点で着手すること）。
 * - **描画位置は閉じ込められない**: 配下の要素に `position:fixed` / `absolute` を当てると祖先の
 *   `overflow:hidden` では切られない。→ `.themePreview` の **`contain: paint`** が閉じている（S-2）。
 * - カスタムプロパティは `scope` に落ちるので**配下にしか継承しない**（意図どおり・正しく閉じている）。
 * - `@media` の評価対象はコメビュ窓のサイズであって OBS の出力サイズではない（プレビューは「だいたい」）。
 *
 * @param css スコープ化する CSS（`rewriteSelectors()` を通した後のものを渡す）
 * @param scope 前置するラッパのセレクタ（例 `".sd-preview"`）
 */
export function scopeSelectors(css: string, scope: string): string {
  const { preludes } = scan(css);
  let out = "";
  let cursor = 0;

  for (const p of preludes) {
    out += css.slice(cursor, p.start);
    out += splitTopLevelCommas(css.slice(p.start, p.end))
      .map((part) => scopePart(part, scope))
      .join(",");
    cursor = p.end;
  }

  return out + css.slice(cursor);
}

/**
 * 060d: 保存後の CSS に**閉じ忘れたブロックがいくつ残っているか**を返す（0 なら健全）。
 *
 * ⚠⚠ **これが「取り込み前後のサイズ比」の代わり**（060b review② Q-3）。当初の完了条件は比率だったが、
 * frontend は取り込み前のファイルを**読む手段を持たない**（`plugin-dialog` の `open()` はパス文字列しか
 * 返さず、`fs` plugin も asset protocol も無い）ので比率そのものが計算できない。
 * さらに比率は**正常系と病的ケースを区別できない**——依頼者の実サンプル（全 6 行のうち 1 行が `@import`）も、
 * `url()` を多数持つ普通のテーマも、正常に除去されただけで数割減る。
 *
 * 病的ケースは構造で見分けられる: 対応の取れていない `(` があると、そこから EOF までが 1 宣言として
 * 扱われて除去されるため、**囲んでいた `}` も一緒に消える**。
 * 実測（`overlay_theme/model.rs` の注記）: `.a{width:calc(100% - 10px;}` ＋以降 → 出力は `.a{` のみ。
 * ⚠ 末尾が `{` とは限らない（`.a{color:red;width:calc(1px;}` → `.a{color:red;`）ので、
 * **末尾 1 文字ではなくブロックの深さ**を見ること。
 *
 * ## ⚠⚠ 見落とす失敗モードがある（security-review Q-1・修正は 060c 送り）
 *
 * **壊れた `(` が「どのブロックにも入っていない位置」にあると、除去が EOF まで届いても深さが 0 のまま**に
 * なる。実測（Rust の `sanitize_css` を直接叩いて確認）:
 *
 * ```text
 * 入力:  @media (min-width:1px){.sd-comment{color:red}}
 *        @import url(https://fonts.example/x.css      ← ) が無い
 *        .sd-comment{color:blue}
 *        .sd-comment-name{color:green}
 * 保存:  "@media (min-width:1px){.sd-comment{color:red}}"   ← 後半 2 行が黙って消える
 * depth: 0（＝この関数は 0 を返し、UI の警告が出ない）
 * ```
 *
 * `@import` / `@namespace` / グループ規則のプレリュードは**トップレベル**にあるので、そこで `(` が
 * 壊れると閉じ忘れが 1 つも残らない。しかも `@import` の `)` 忘れは現実的な打ち間違いである。
 * ＝ **この関数は「宣言の中で壊れた `(`」だけを見ており、置き換え元の目的（取り込み欠損の検知）を
 * 半分しか満たしていない。**
 *
 * ⚠ frontend だけでは原理的に埋まらない（欠損の事実は除去した Rust 側にしかなく、frontend は
 * 取り込み前のファイルを 1 バイトも読めない）。
 * **再修正トリガー＝ 060c で `overlay_theme` を触るとき**に、`SanitizeOutcome` へ
 * `truncated_to_eof: bool`（除去範囲の終端が入力長に達したか）を 1 個足し、UI 側は
 * `truncatedToEof || unclosedBlockDepth(css) > 0` で警告すること。本関数は別の失敗モードを見ているので残す。
 */
export function unclosedBlockDepth(css: string): number {
  return scan(css).depth;
}
