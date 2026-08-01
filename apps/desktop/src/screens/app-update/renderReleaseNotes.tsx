import type { ReactNode } from "react";

/**
 * 055e: リリースノート（`latest.json` の `notes`）の**最小マークダウンレンダラ**（純関数）。
 *
 * ## なぜ自前なのか（新規依存ゼロ）
 *
 * - `react-markdown` + `remark-gfm` は unified / remark / micromark / mdast 系の**推移的依存が 20 以上**
 *   増える。`docs/security.md` §10「依存関係を増やしすぎない」に照らして、
 *   **リリースノート 1 画面のために払うコストとして重い**。
 * - 描画対象は `docs/release-notes/vX.Y.Z.md` ＝**自分たちが書いた数十行**であり、
 *   任意のマークダウンを正確に再現する必要がない。
 * - 自前レンダラは **React 要素を返す**ので `dangerouslySetInnerHTML` が要らず、
 *   **XSS 面がそもそも生まれない**（`marked` + `DOMPurify` 案は HTML 文字列を経由するため、この利点を失う）。
 *
 * ⚠ **`notes` は minisign 署名の対象外**（署名が守るのは DL した実体のバイト列だけ）＝HTTPS で
 * 守られるだけの未署名の外部文字列。**テキストノードと React 要素以外を作らない**のは好みではなく要件で、
 * `apps/desktop/scripts/check-css-guards.mjs` の (9) がソース文字列で機械的に固定している。
 *
 * ## 対応する記法（これ以外は対応しない）
 *
 * | 記法 | 出力 |
 * | --- | --- |
 * | `# ` / `## ` / `### ` | `<h4>` / `<h5>` / `<h6>` |
 * | `- ` / `* ` | `<ul>` / `<li>`（**ネストは対応しない**） |
 * | `**太字**` | `<strong>` |
 * | `` `コード` `` | `<code>` |
 * | 空行 | ブロックの区切り（箇条書きを閉じる） |
 * | それ以外の行 | `<p>` |
 *
 * ## 段落の分け方（055e の決定）
 *
 * **1 行 = 1 ブロック**。連続する非空行を 1 つの `<p>` にまとめ**ない**。
 * 1. タスク (1) の表の字義どおり（「それ以外の行＝段落（`<p>`）としてそのまま」）。
 * 2. **055c からの非退行**——いまは `white-space: pre-wrap` で改行がそのまま見えている。
 *    連結する設計は「書き手が意図して割った行を黙ってつなぐ」＝表示が変わる方向の変更になる。
 * 3. 055a の記録（`docs/progress.md`）が既に行ごとを前提にしている
 *    （「`v0.1.0.md`: 箇条書きの折返し継続行〔…055e では**別段落に割れる**〕を解消し、1 行 1 項目にした」）。
 *
 * ⚠ そのため `UpdateScreen.module.css` の `.notesBody` は **`white-space: pre-wrap` を残している**。
 * 改行は DOM に残らないので「改行を見せる」効果は消えるが、**行頭インデントを保つ**効果が残り、
 * 対応外の記法（ネストしたリスト・コードブロックの中身）を「消さない・壊さない」に直接効く。
 *
 * ## 対応しない記法の扱い
 *
 * 表・引用・コードブロック（```）・画像・水平線・ネストしたリスト・脚注・チェックボックスは
 * **専用処理を一切書かない**＝どれもブロック解析のどの条件にも当たらず `<p>` として素の文字で残る。
 *
 * ⚠ **リンク（`[text](url)`）にも専用処理を書かない**。踏ませない理由は、外部 URL を開く経路
 * （`tauri-plugin-opener`）を増やすと**「外部から来た文字列に含まれる URL を開く」**という新しい面が
 * 生まれるため。リリースノートは自分で書いているので現状は安全だが、**面を増やさない方を選ぶ**。
 * どうしても必要になったら、**https 限定 ＋ ホスト検証**を入れたうえで別タスクにする（再修正トリガー）。
 *
 * ## 壊れた入力の扱い（例外を投げない）
 *
 * `**` の閉じ忘れ・`` ` `` の閉じ忘れ・空中身（`****` / ` `` `）は、**記号を素の文字として吐いて先へ進む**。
 * ＝どんな入力でも「最悪プレーンテキストに劣化する」だけで、消えも壊れも例外も起きない。
 *
 * ⚠ **`clamp` はこの関数の外側**。呼び出しは `renderReleaseNotes(clampNotes(notes))` で、
 * **先に打ち切ってからパースする**（パーサに 20,000 字超を渡さない）。`ReleaseNotes.tsx` を参照。
 */

/**
 * `#` の数 → タグ。画面は既に `<h2>`（ページ見出し）と `<h3>`（`layout.panelHead`）を使っているので h4 から始める。
 *
 * ⚠ **見出しレベルのスキップは承知のうえで許容している**（055e レビュー Q-7・修正不要と判断）。
 * `docs/release-notes/README.md` の雛形が `##` 始まりなので、実際に出るのは h5 / h6 ＝ **h3 → h5 で h4 を飛ばす**。
 * WCAG 2.x の達成基準ではなく Technique（H42）なので許容した。`#` 始まりを雛形にすれば解消するが、
 * 既に書き上がっている `v0.1.0.md` と食い違うので**書き方のほうは動かさない**。
 * **再修正のトリガー**: アクセシビリティ要件が明示的に足されたとき、または `#`〜`###` の 3 段が
 * 実運用で使い分けられ始めたとき（そのときは雛形を `#` 始まりに揃える＝コードは変えない）。
 */
const HEADING_TAGS = ["h4", "h5", "h6"] as const;

/**
 * 見出し行。`#` の後に**半角スペースが要る**ので `####`（4 段）も `#見出し`（空白なし）も当たらず、
 * どちらも段落として素の文字で残る。
 */
const HEADING_RE = /^(#{1,3}) (.+)$/;

/**
 * 箇条書き項目。**行頭のみ**（インデントした `  - foo` はネストしたリスト＝対応外なので当たらない）。
 * `**太字**` が行頭に来ても `*` の次が `*` で半角スペースではないため誤爆しない。
 */
const BULLET_RE = /^[-*] (.+)$/;

/**
 * マークダウン（最小サブセット）を React 要素の配列にする。
 *
 * 返り値は `ReactNode[]`（`ReactNode` に代入可能）。**配列で返すのは呼び出し側が
 * 「ブロックが 1 つも無い＝フォールバック文言を出す」を判定できるようにするため**。
 */
export function renderReleaseNotes(notes: string): ReactNode[] {
  const blocks: ReactNode[] = [];
  let items: ReactNode[] = [];
  let itemsStart = 0;

  /** 貯めていた箇条書き項目を 1 つの `<ul>` として吐き出す。 */
  const flushList = () => {
    if (items.length === 0) return;
    blocks.push(<ul key={`b${itemsStart}`}>{items}</ul>);
    items = [];
  };

  const lines = notes.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    // CRLF で届いても行末に `\r` を残さない（`latest.json` は外部データで改行コードを拘束できない）。
    const raw = lines[i];
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;

    if (line.trim() === "") {
      flushList();
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      flushList();
      const Heading = HEADING_TAGS[heading[1].length - 1];
      blocks.push(<Heading key={`b${i}`}>{renderInline(heading[2], true)}</Heading>);
      continue;
    }

    const bullet = BULLET_RE.exec(line);
    if (bullet) {
      if (items.length === 0) itemsStart = i;
      items.push(<li key={`l${i}`}>{renderInline(bullet[1], true)}</li>);
      continue;
    }

    flushList();
    blocks.push(<p key={`b${i}`}>{renderInline(line, true)}</p>);
  }
  flushList();

  return blocks;
}

/**
 * 行の中の `**太字**` と `` `コード` `` を要素にする。**左から 1 パスの走査**で、
 * 正規表現の後戻りを使わない＝1 行が 20,000 字でも線形に終わる（`clampNotes` の上限に当たる入力を想定）。
 *
 * ⚠ **再帰が 2 段で止まる本当の理由**（055e レビュー Q-4 で訂正）。当初ここには
 * 「`allowStrong` が深さを 2 で止めている／無いと `**a **b** c**` で無限に潜る」と書いていたが、
 * **誤り**だった。`end` は `indexOf("**", i + 2)`＝**最初の**出現なので、`text.slice(i + 2, end)` は
 * **構造的に `**` を含み得ない**。＝旗が無くても 2 段目は `**` を見つけられず、無限再帰は起こらない
 * （`**a **b** c**` も実際には `strong("a ") + "b" + strong(" c")` にフラットに分解される）。
 * `allowStrong` は**その不変条件が将来崩れたときの保険**として残しているのであって、
 * これ単独が終了性を保証しているわけではない（旗を `true` にしても現状は挙動が変わらない＝等価変異）。
 * `` `**bold**` `` はコード span が先に閉じるので `**` は解釈されない（＝CommonMark と同じ優先順）。
 *
 * ⚠ `key` は**行内の文字オフセット**。兄弟の中で必ず一意（同じ位置から 2 つの要素は始まらない）で、
 * 同じ入力なら同じ値になる。素の文字列は key を要求されないのでそのまま push する。
 */
function renderInline(text: string, allowStrong: boolean): ReactNode[] {
  const out: ReactNode[] = [];
  let buffer = "";
  let i = 0;

  const flushText = () => {
    if (buffer === "") return;
    out.push(buffer);
    buffer = "";
  };

  while (i < text.length) {
    const ch = text[i];

    // インラインコード。中身は**一切再解析しない**（`` `**a**` `` は `<code>**a**</code>`）。
    if (ch === "`") {
      const end = text.indexOf("`", i + 1);
      // 閉じが無い / 中身が空（`` ` `` が 2 つ続く）なら記号を素の文字として吐いて 1 つ進む。
      if (end > i + 1) {
        flushText();
        out.push(<code key={`c${i}`}>{text.slice(i + 1, end)}</code>);
        i = end + 1;
        continue;
      }
      buffer += ch;
      i += 1;
      continue;
    }

    // 太字。`*` 1 つ（`*斜体*`）は対応しないので当たらず、素の文字として残る。
    if (allowStrong && ch === "*" && text[i + 1] === "*") {
      const end = text.indexOf("**", i + 2);
      // 閉じが無い / 中身が空（`****`）なら記号を素の文字として吐いて 2 つ進む。
      if (end > i + 2) {
        flushText();
        out.push(
          <strong key={`s${i}`}>{renderInline(text.slice(i + 2, end), false)}</strong>,
        );
        i = end + 2;
        continue;
      }
      buffer += "**";
      i += 2;
      continue;
    }

    buffer += ch;
    i += 1;
  }
  flushText();

  return out;
}
