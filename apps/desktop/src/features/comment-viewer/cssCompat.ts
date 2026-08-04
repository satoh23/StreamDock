/**
 * 060a: 純正チャット（YouTube / Twitch）向けに書かれたユーザー CSS のセレクタを、StreamDock
 * オーバーレイの**安定クラス（`sd-*`）**へ機械的に書き換える純関数。React/CSS/DOM 非依存で、
 * `features/` の他モジュール（`connectionStatus.ts` 等）と同じく素の Node からも import できる。
 *
 * ## なぜ変換なのか（親 060 の決定）
 *
 * ユーザーの CSS は `yt-live-chat-text-message-renderer #message` / `.chat-line__no-background` の
 * ように**他社の DOM 形**で書かれている。StreamDock 側の DOM をその形に寄せる（カスタム要素名や
 * 重複 `id="message"` を持ち込む）と、意匠・アクセシビリティ・テストが他社仕様に人質を取られる。
 * **変換表なら StreamDock の DOM はきれいなままで、対応表が古くなっても StreamDock 側は壊れない。**
 *
 * ## ⚠ この module が「しないこと」
 *
 * - **`@import` と `url()` には触らない。** 外部参照の除去は 060b（Rust 側）、外部 `@import` の
 *   スナップショットは 060c の責務。**2 か所で同じ入力を触ると、片方だけ緩んだときに気づけない。**
 *   下の `scanPreludes()` は「セレクタ（プレリュード）以外を一切見ない」形なので、この分離は
 *   **祈りではなく構造**で担保されている（宣言部・文字列・コメントの中身に触る経路が存在しない）。
 * - **CSS の完全パースはしない**（新規依存ゼロ）。セレクタ部分の文字列置換に留める。
 * - **変換できなかったセレクタを消さない。** そのまま残し、`unmatched` に記録して呼び出し側へ返す。
 *   黙って効かないのが最悪なので、UI（060d）が「効かないセレクタ」を必ず出せるようにする。
 *
 * ## ⚠ 呼び出し元（060a 時点ではゼロ）
 *
 * **060a 時点でこの関数を呼ぶコードは存在しない**（import 元は `cssCompat.test.ts` のみ）。
 * 呼ぶのは **060d の注入処理**で、060b の決定により「**保存するのは変換前の CSS・変換は注入時に
 * frontend が毎回行う**」（変換表を更新すると取り込み済みテーマにも自動で効く）。
 * → **注入とプレビュー表示のたびに毎回走る**ので、**決定性**（同じ入力→同じ `rewritten`/`unmatched`）と
 * **冪等性**（2 回通しても壊れない）が機能要件。冪等性は `SELECTOR_TABLE` の `from` に sd 語彙を
 * 書かないことで成立し、`scripts/check-css-guards.mjs` の **(10-c)** が静的に守っている。
 *
 * 再修正トリガー: この関数の呼び出し元が増えたら、**呼ぶ側が 060b の外部参照除去を通した CSS を
 * 渡しているか**を必ず確認すること（安定クラス `.sd-comment-icon` は `background-image: url(…)` で
 * 外部画像を差せる的でもあり、塞ぐのは 060b の責務）。
 */

/** 変換表の 1 エントリ。 */
export interface SelectorRule {
  /**
   * 元セレクタ（純正チャット由来）。空白は `\s+` / `>` の両方を許す形へコンパイルされるので、
   * `renderer #message` と `renderer > #message` の双方に当たる。
   * ⚠ **sd 語彙（`sd-` を含む文字列）を書かないこと**——変換は注入のたびに毎回走るため、
   * 自分の出力に当たる表を書くと冪等性が壊れる（check-css-guards.mjs **(10-c)** が検査する）。
   */
  readonly from: string;
  /**
   * 変換先。⚠ **必ず実 DOM に存在する安定クラス**であること
   * （契約一覧との突き合わせを check-css-guards.mjs **(10-b)** が、その契約が `CommentList.tsx` に
   * 実在することを **(10-a)** が行う）。
   * ⚠ `.sd-overlay` は入れない: 060d のプレビューは全セレクタへ `.sd-preview` を前置するため、
   * 窓ルートを指すセレクタはプレビュー側で当たらなくなる。
   */
  readonly to: string;
  /** なぜこの対応なのか（表を読む人向け）。 */
  readonly why: string;
}

/**
 * 060a: セレクタ変換表（初期版）。**網羅は目指さない**——実サンプルが通るところから始め、
 * 要望が来たら足す（`unmatched` が「何が足りないか」の観測手段になる）。
 *
 * ⚠ **単独の `#message` / `#author-name` / `#img` は入れない。** これらは YouTube 内部の id だが、
 * セレクタとしては汎用すぎてユーザー自身の `#img` を壊しうる。**祖先付きの形だけ**を表に入れる
 * （`yt-img-shadow` は `yt-` 接頭辞を持つので単独でも安全）。
 *
 * ⚠ **適用順は定義順ではなく `from` の長い順**（下の `COMPILED` がソートする）＝表を書く人は
 * 順序を気にしなくてよい。`yt-live-chat-text-message-renderer` を先に当ててしまうと
 * `… #message` が `.sd-comment #message` に化けて壊れるため。
 *
 * ⚠ **だからこの表は意図的に「長さ順に並べていない」**（総論のエントリを各論より先に置いてある）。
 * 定義順が既に長さ順だと、`COMPILED` のソートを外す変異が**テストで殺せなくなる**（実測で生存した）。
 * 表を並べ替えるときも、長さ順には**しないこと**——ソートが効いていることの証拠がこの並びである。
 */
export const SELECTOR_TABLE: readonly SelectorRule[] = [
  // --- YouTube 純正チャット -------------------------------------------------
  {
    from: "yt-live-chat-text-message-renderer",
    to: ".sd-comment",
    why: "コメント 1 件。⚠ 下の祖先付きエントリ（#message 等）より**後**に当たる（長い順ソート）。",
  },
  {
    from: "yt-live-chat-text-message-renderer #message",
    to: ".sd-comment-text",
    why: "コメント本文。chat の吹き出しと課金カードの本文の両方に付く安定クラス。",
  },
  {
    from: "yt-live-chat-text-message-renderer #author-name",
    to: ".sd-comment-name",
    why: "投稿者名。chat の名前と課金カードのヘッダ名の両方に付く。",
  },
  {
    from: "yt-live-chat-text-message-renderer #img",
    to: ".sd-comment-icon",
    why: "投稿者アイコン。祖先付きの形だけを変換する（単独 #img はユーザー自身の id を壊しうる）。",
  },
  {
    from: "yt-live-chat-paid-message-renderer",
    to: ".sd-comment-tip",
    why: "スーパーチャット（課金カード）。StreamDock では chat 以外の課金コメント全般に付く。",
  },
  {
    from: "yt-img-shadow",
    to: ".sd-comment-icon",
    why: "アイコンの枠。yt- 接頭辞があるので単独でも他と衝突しない。",
  },

  // --- Twitch 純正チャット --------------------------------------------------
  {
    from: ".chat-line__message",
    to: ".sd-comment",
    why: "コメント 1 件。",
  },
  {
    from: ".chat-line__message-body",
    to: ".sd-comment-text",
    why: "コメント本文。⚠ .chat-line__message より先に当たる（長い順ソート）。単語境界でも守られている。",
  },
  {
    from: ".chat-line__no-background",
    to: ".sd-comment",
    why: "コメント 1 件（背景なし行）。",
  },
  {
    from: ".chat-author__display-name",
    to: ".sd-comment-name",
    why: "投稿者名。",
  },
];

/** `rewriteSelectors()` の戻り値。 */
export interface RewriteResult {
  /** 変換後の CSS。**変換できなかったセレクタは消さずそのまま残る。** */
  css: string;
  /**
   * セレクタに 1 箇所以上の変換が起きた**ルールの数**（`{ … }` ブロック 1 つ＝最大 1 件）。
   * 1 ルールのセレクタに 3 箇所の置換が起きても 1。060d の UI 文言
   * 「M 個のルールを StreamDock 用に変換しました」に**そのまま**落ちる粒度にしてある。
   *
   * ⚠ **「変換した」は「効く」を意味しない**（060a レビュー Q-1）。複合セレクタの一部だけが
   * 変換され、残りが純正チャットのままなら、そのルールは `rewritten` に数えられたうえで**当たらない**
   * （`…renderer #timestamp` → `.sd-comment #timestamp`）。裸 id ぶんは `unmatched` が拾うように
   * したので UI は両方を出せるが、**`rewritten` 単独を「成功件数」として見せないこと**。
   */
  rewritten: number;
  /**
   * 変換後もなお残っている**純正チャット由来のセレクタトークン**（重複排除・出現順）。
   *
   * ⚠ **「sd 語彙でない全セレクタ」ではない。** それだと `body` / `@media` / 擬似クラスが大量に載って
   * 警告が意味を失う（ユーザーが自分で sd 語彙に沿って書いた CSS でも警告だらけになる）。
   * 判定は `FOREIGN_SELECTOR_RE`＝**接頭辞ベース＋純正チャットの裸 id の列挙**。
   * 裸 id を**変換表**に入れない判断とは別物（`FOREIGN_ID_NAMES` の docstring を参照）。
   *
   * ⚠ 要素は**ルールではなくトークン**（例 `"yt-live-chat-paid-sticker-renderer"`）。
   * UI は「効かないセレクタ: …」と出せる＝ユーザーが何を直せばよいか分かる。
   * したがって `unmatched.length` は**種類数であってルール数ではない**（060d への申し送り）。
   *
   * ⚠⚠ **要素数も 1 要素の長さも入力次第で無制限**（060a レビュー S-1・実測）。
   * ここは**ユーザー CSS 由来の未署名文字列**なので、060d は**そのまま画面に出さず clamp すること**:
   *   - 要素数: 相異なる `.chat-*` を 2 万個含む CSS → `unmatched.length === 20000`
   *   - 1 要素の長さ: 引用符**なし**の属性値は `\[data-a-target[^\]]*\]` が `]` まで無制限に拾うため、
   *     5 万文字の 1 トークンになりうる。`[^\]]` は改行も制御文字も食う。
   *   - なお引用符**付き**（`[data-a-target="…"]`）は走査が文字列を除外するので載らない（実測）。
   * React が escape するので XSS にはならないが、長さ無制限の未署名文字列という点で
   * 055b review S-5 と同型。件数と 1 件あたりの長さの**両方**に上限を課すこと。
   */
  unmatched: string[];
}

/** 中に「規則」を持つアットルール（この中はセレクタとして走査を続ける）。 */
const GROUP_AT_RULES: ReadonlySet<string> = new Set([
  "media",
  "supports",
  "container",
  "layer",
  "scope",
  "document",
]);

/**
 * 060a: 純正チャット由来の**裸の id**。⚠ **警告専用**で、`SELECTOR_TABLE` には入れない。
 *
 * ⚠⚠ **「変換しない理由」と「警告しない理由」は別物**（060a レビュー Q-1 で是正）。
 * 裸の id を**変換**表に入れないのは正しい——`#img` を `.sd-comment-icon` に化けさせると
 * ユーザー自身の `#img` を壊しうるため（だから表には祖先付きの形だけを入れてある）。
 * しかし**警告**にその理屈は移らない。**ユーザーは StreamDock の DOM に id を作れない**からで、
 * オーバーレイに存在する id は `index.html` の `#root` **ただ 1 つ**（実測）。
 * ＝注入された CSS に現れる `#root` 以外の裸 id は**証明可能に死んでいる**。
 *
 * これが無いと、実在のテーマで最も多い書き方が「黙って効かない」に落ちる（レビュー実測）:
 *   `…renderer #timestamp` → `.sd-comment #timestamp`（rewritten=1・警告なし・当たらない）
 *   `…renderer #chat-badges` / `#author-photo` / `> #content > #message` も同型。
 * `rewritten` が**加算されてしまう**ぶん、警告が無いと 060d の UI が「M 個変換しました」と
 * 積極的に誤報する。この module の docstring が「黙って効かないのが最悪」と書いている状態そのもの。
 *
 * ⚠ **総称的な id（`#content` / `#card` / `#header` / `#menu` 等）は意図的に入れていない。**
 * 将来 StreamDock 側がその名前の id を持つと誤検知に転ぶため（`(10-g)` が id 追加を検知して
 * ここへ差し戻す）。＝これらは「変換されないのに警告も出ない」バケツに残る**既知の取りこぼし**。
 * 再修正トリガー: 060c で実サンプルの外部 CSS を取り込んだとき、`unmatched` に出ないまま
 * 効いていないセレクタが観測されたら、その id をここへ足す（allow-list 方式へ広げてもよい）。
 */
const FOREIGN_ID_NAMES = [
  "message",
  "author-name",
  "author-photo",
  "img",
  "chat-badges",
  "timestamp",
  "purchase-amount",
];

/**
 * 純正チャット由来と**断定できる**セレクタトークン。`unmatched` の判定にだけ使う。
 * 保守的（接頭辞ベース＋上の id 列挙）にしてあるのは、誤検知が 1 つ入るだけで「効かないセレクタ」の
 * 一覧がノイズに埋もれて誰も読まなくなるため。取りこぼしは実害が小さい（変換されないだけ）。
 *
 * ⚠ **`compileFrom()` と違い、CSS エスケープを完全には解釈しない**（060a レビュー Q-5）。
 * 裸 id だけは `(?<!\\)` を付けたが、クラス側の `.a\.chat-line__message`（`.` を含む 1 つのクラス名）は
 * ここでは `.chat-line__message` として拾われる＝**ユーザー自身のクラスに「効きません」と警告しうる**。
 * 変換のほうは正しく当てない（安全側）ので実害は警告文の誤りに限られる。エスケープ付きクラス名の
 * 実例が出てきたら、ここも `(?<!\\)` 相当を足す。
 *
 * ⚠ **大文字のセレクタは拾わない**（`YT-LIVE-CHAT-…`）。HTML では型セレクタは大小無視なので
 * 正当な入力だが、`i` を付けると `.CHAT-` 等まで拾って誤検知が増える。実例が出たら再検討する。
 */
const FOREIGN_SELECTOR_RE = new RegExp(
  [
    "(?<![A-Za-z0-9_.#-])ytd?-[A-Za-z0-9-]+", // yt-live-chat-*, yt-img-shadow, ytd-*
    "\\.(?:chat-|tw-|video-chat)[A-Za-z0-9_-]*", // .chat-line__*, .chat-author__*, .tw-*
    "\\[data-a-target[^\\]]*\\]", // Twitch の属性セレクタ
    // 裸の id（警告専用・上の FOREIGN_ID_NAMES の理由を参照）。`\` エスケープの直後には当てない。
    `(?<!\\\\)#(?:${FOREIGN_ID_NAMES.join("|")})(?![A-Za-z0-9_-])`,
  ].join("|"),
  "g",
);

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * 変換表の `from` を正規表現へコンパイルする。ここが**置換の安全性の全部**。
 *
 * - **単語境界（後ろ）**: 常に `(?![A-Za-z0-9_-])`＝`.chat-line__no-background2` のような
 *   **別クラスを巻き込まない**。
 * - **単語境界（前）**: `from` の形で出し分ける。
 *   - `.` / `#` 始まり（`.chat-line__message`）… 先頭の `.` 自体が境界なので**識別子文字の直後でも当てる**
 *     （`.foo.chat-line__message` という**複合セレクタは正当に当てたい**）。禁じるのは直前の `\` だけ
 *     ＝`\.` でエスケープされた「`.` を含むクラス名」の一部に当てないため。
 *   - 要素名始まり（`yt-live-chat-…`）… `.` `#` `-` と識別子文字を禁じる
 *     ＝`.my-yt-live-chat-x`（別クラス）や `.yt-live-chat-x`（同名のクラス）に当てない。
 * - **空白**: `\s+` と `>` の両方を許す（`renderer #message` / `renderer > #message`）。
 *   兄弟結合子（`~` `+`）は意味が変わるので許さない。
 */
function compileFrom(from: string): RegExp {
  const body = from.trim().split(/\s+/).map(escapeRe).join("(?:\\s*>\\s*|\\s+)");
  const startsWithSymbol = from.startsWith(".") || from.startsWith("#");
  const behind = startsWithSymbol ? "(?<!\\\\)" : "(?<![A-Za-z0-9_.#-])";
  return new RegExp(`${behind}${body}(?![A-Za-z0-9_-])`, "g");
}

/** 長い順にコンパイル済みの表（module 初期化時に 1 回だけ）。 */
const COMPILED: readonly { re: RegExp; to: string }[] = [...SELECTOR_TABLE]
  .sort((a, b) => b.from.length - a.from.length)
  .map((r) => ({ re: compileFrom(r.from), to: r.to }));

/** セレクタ（プレリュード）の中で、コメント・文字列を除いた「置換してよい」範囲。 */
interface PreludeSegment {
  start: number;
  end: number;
}

/** 1 ルール（`{ … }` 1 つ）のプレリュード。カンマ束ね・コメント混在で segment が複数になりうる。 */
interface PreludeRule {
  segments: PreludeSegment[];
}

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

/** プレリュードがアットルールなら、その名前（小文字）を返す。通常セレクタなら null。 */
function atRuleName(prelude: string): string | null {
  const head = prelude.replace(/\/\*[\s\S]*?\*\//g, "").trimStart();
  const m = /^@([A-Za-z-]+)/.exec(head);
  return m ? m[1].toLowerCase() : null;
}

/**
 * CSS を 1 パス走査し、「セレクタとして置換してよい範囲」だけを列挙する。
 *
 * **CSS パーサは持ち込まない**（新規依存ゼロ）が、`check-css-guards.mjs` (6-b) が使っている素朴な
 * 「ブレースを跨げない正規表現でルールを列挙する」方式は**採らない**——宣言内の文字列
 * （`content: "}"`）や閉じブレースを含む CSS コメントでブロック分割が壊れ、そこから先の
 * 全セレクタを取り違えるため。状態機械なら:
 *
 * - コメント・文字列は**中身を一切見ずに素通り**する ＝ `url()` の中身も `@import` の URL も
 *   構造上触れない（060b / 060c との責務分離が祈りではなく構造で成立する）
 * - `{` の中身は「宣言」として素通りし、**グループ規則（@media 等）の中だけ**セレクタ走査を続ける
 *   ＝ `@font-face` / `@keyframes` の中身（`from` / `to` / `50%`）を誤ってセレクタ扱いしない
 * - `@` で始まるプレリュードは**そもそも置換対象にしない**（`@media (…)` を書き換えない・
 *   `@import "…";` は `;` で捨てる）
 *
 * ⚠ **CSS Nesting（`&`）は非対応**。ネストしたセレクタは「宣言ブロックの中」として素通りするので、
 * 変換されないだけで壊れはしない（`unmatched` にも載らない）。
 * 再修正トリガー: ユーザーの CSS でネストが一般化したら、宣言ブロック内のセレクタ検出を足す。
 */
function scanPreludes(css: string): PreludeRule[] {
  const rules: PreludeRule[] = [];
  /** 親スコープが規則リストだったか（`}` で復帰するため積む）。 */
  const stack: boolean[] = [];
  let inRuleList = true;
  let rawStart = 0;
  let segStart = 0;
  let segs: PreludeSegment[] = [];
  let i = 0;

  const pushSeg = (end: number): void => {
    if (end > segStart) segs.push({ start: segStart, end });
  };
  const resetPrelude = (at: number): void => {
    rawStart = at;
    segStart = at;
    segs = [];
  };

  while (i < css.length) {
    const c = css[i];

    if (c === "/" && css[i + 1] === "*") {
      const e = css.indexOf("*/", i + 2);
      const next = e === -1 ? css.length : e + 2;
      if (inRuleList) {
        pushSeg(i);
        segStart = next;
      }
      i = next;
      continue;
    }

    if (c === '"' || c === "'") {
      const next = skipString(css, i);
      if (inRuleList) {
        pushSeg(i);
        segStart = next;
      }
      i = next;
      continue;
    }

    if (c === "{") {
      let childIsRuleList = false;
      if (inRuleList) {
        pushSeg(i);
        const name = atRuleName(css.slice(rawStart, i));
        // アットルールのプレリュード自体は置換しない（@media (…) を書き換えない）。
        if (name === null) rules.push({ segments: segs });
        else childIsRuleList = GROUP_AT_RULES.has(name);
      }
      stack.push(inRuleList);
      inRuleList = childIsRuleList;
      i++;
      resetPrelude(i);
      continue;
    }

    if (c === "}") {
      inRuleList = stack.length > 0 ? (stack.pop() as boolean) : true;
      i++;
      resetPrelude(i);
      continue;
    }

    // `@import "…";` / `@charset "…";` のような文で終わるアットルール。プレリュードごと捨てる。
    if (c === ";" && inRuleList) {
      i++;
      resetPrelude(i);
      continue;
    }

    i++;
  }

  return rules;
}

/** 1 segment に変換表を適用する（長い順・境界付き）。 */
function rewriteSegment(text: string): { out: string; hit: boolean } {
  let out = text;
  let hit = false;
  for (const { re, to } of COMPILED) {
    re.lastIndex = 0;
    out = out.replace(re, () => {
      hit = true;
      return to;
    });
  }
  return { out, hit };
}

/**
 * 060a: 純正チャット向け CSS のセレクタを StreamDock の安定クラスへ書き換える。
 *
 * - 変換できなかったセレクタは**そのまま残す**（消さない）。
 * - `@import` / `url()` / 宣言部 / 文字列 / コメントの中身は**一切変更しない**。
 * - 壊れた CSS（`{` が閉じない等）でも throw せず、変換できた範囲だけ返す（無害に劣化する）。
 *
 * ⚠ **否定の中では意味が反転しうる**（060a レビュー Q-4）。`.sd-comment:not(.chat-line__message)` は
 * `.sd-comment:not(.sd-comment)`＝**何にも当たらない自己否定**になる（`:is()` のほうは
 * `:is(.sd-comment,.sd-comment)` と重複するだけで無害）。トークン単位の置換である以上、
 * 「効かなくする」ではなく「壊す」唯一のケースがここ。実例は考えにくいので据え置く。
 * 再修正トリガー: ユーザーの CSS で `:not()` に純正チャットのセレクタを書く例が出たら、
 * `:not(…)` の中は置換対象から外す（プレリュード内の擬似クラス引数を別 segment に切る）。
 */
export function rewriteSelectors(css: string): RewriteResult {
  const rules = scanPreludes(css);
  const foreign = new Set<string>();
  let out = "";
  let cursor = 0;
  let rewritten = 0;

  for (const rule of rules) {
    let hit = false;
    for (const seg of rule.segments) {
      out += css.slice(cursor, seg.start);
      const r = rewriteSegment(css.slice(seg.start, seg.end));
      out += r.out;
      if (r.hit) hit = true;
      // 変換**後**のセレクタに残っている外来トークンだけを拾う（変換できたものは消えている）。
      FOREIGN_SELECTOR_RE.lastIndex = 0;
      for (const m of r.out.matchAll(FOREIGN_SELECTOR_RE)) foreign.add(m[0]);
      cursor = seg.end;
    }
    if (hit) rewritten++;
  }
  out += css.slice(cursor);

  return { css: out, rewritten, unmatched: [...foreign] };
}
