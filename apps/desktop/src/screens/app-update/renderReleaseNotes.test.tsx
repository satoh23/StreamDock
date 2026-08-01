import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { renderReleaseNotes } from "./renderReleaseNotes";
// 055e: **実際に配られるリリースノートを全部**実データとしてそのまま通す。
// ⚠ `?raw` は CSS モジュールには効かない（Vite の CSS 処理が先に勝つ・`check-css-guards.mjs` 冒頭の記録）が、
//    `.md` は前処理と衝突しないのでそのまま文字列として読める。型は `src/vite-env.d.ts` の
//    `/// <reference types="vite/client" />` が glob / `*?raw` を宣言している＝**新規依存ゼロ**。
// ⚠ **単一ファイル（v0.1.0.md）の直 import から glob へ変えた**（055e レビュー Q-6）。
//    ベタ書きだと v0.2.0 が出た瞬間に「実際に配られる唯一のデータ」という前提が崩れ、
//    **古いファイルだけを検証し続ける**。glob なら以後のリリースノートが自動で検証対象に入る。
const releaseNotes = Object.entries(
  import.meta.glob("../../../../../docs/release-notes/v*.md", {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>,
)
  .map(([path, md]) => [path.slice(path.lastIndexOf("/") + 1), md] as const)
  .sort(([a], [b]) => a.localeCompare(b));

/**
 * 055e: リリースノートの最小マークダウンレンダラの仕様テスト。
 *
 * 仕様（こうあるべき・docs/tasks/055e）:
 * - 対応する記法は **見出し 3 段 / 箇条書き / 太字 / インラインコード / 空行** だけ。
 * - **対応外の記法は消さず・壊さず、そのまま文字として残す**（表・引用・コードブロック・画像・
 *   水平線・ネストしたリスト・**リンク**）。
 * - **リンクを踏ませない**＝`<a>` を 1 つも作らない（外部 URL を開く面を増やさない）。
 * - **入力が空・改行だけ・巨大・崩れていても例外を投げない**。
 * - 段落は **1 行 = 1 ブロック**（連続する非空行をまとめない・055e の決定）。
 *
 * ⚠ **このファイルの「生 HTML にしない」テストは空虚ではない**（055e レビュー Q-2 で訂正）。当初ここには
 * 「React 要素しか組まない以上、結果に生 HTML が混ざらないのは構造的に必ず通る＝空虚」と書いていたが、
 * 実測では `dangerouslySetInnerHTML` を足す変異も `createElement("a", { href })` を足す変異も
 * **このファイルと `UpdateScreen.test.tsx` のテストが殺した**（静的ガードのほうがすり抜けた）。
 * `scripts/check-css-guards.mjs` の (9) が担うのは**描画結果に現れない追加**
 * （別ファイルへ経路を足す・needle 回避・clamp の順序）で、**役割が違うので両方要る**。
 */
function draw(notes: string) {
  return render(<div>{renderReleaseNotes(notes)}</div>);
}

describe("renderReleaseNotes —— 対応する記法", () => {
  it("見出しは 3 段（# → h4 / ## → h5 / ### → h6）になり、`#` が文字として残らない", () => {
    // ⚠ 画面は既に h2（ページ見出し）と h3（layout.panelHead）を使っているので h4 から始める。
    const { container } = draw("# 大\n## 中\n### 小");
    expect(container.querySelector("h4")?.textContent).toBe("大");
    expect(container.querySelector("h5")?.textContent).toBe("中");
    expect(container.querySelector("h6")?.textContent).toBe("小");
    expect(container.textContent).not.toContain("#");
  });

  it("4 段以上の見出しと空白なしの `#` は見出しにせず、文字として残す", () => {
    const { container } = draw("#### 4 段\n#空白なし");
    expect(container.querySelectorAll("h4, h5, h6")).toHaveLength(0);
    expect(container.textContent).toContain("#### 4 段");
    expect(container.textContent).toContain("#空白なし");
  });

  it("`- ` と `* ` の両方を箇条書きにし、**連続する行だけ**を 1 つの ul にまとめる", () => {
    const { container } = draw("- a\n* b\n\n- c");
    const lists = container.querySelectorAll("ul");
    expect(lists).toHaveLength(2);
    expect(lists[0].querySelectorAll("li")).toHaveLength(2);
    expect(lists[1].querySelectorAll("li")).toHaveLength(1);
    expect(container.textContent).toBe("abc");
  });

  it("行頭以外・インデント付きの `- ` は箇条書きにしない（ネストは対応外＝文字として残す）", () => {
    const { container } = draw("あ - い\n  - ネストした項目");
    expect(container.querySelectorAll("li")).toHaveLength(0);
    expect(container.textContent).toContain("あ - い");
    expect(container.textContent).toContain("  - ネストした項目");
  });

  it("`**太字**` は strong になり、記号が文字として残らない", () => {
    const { container } = draw("これは **太字** です");
    expect(container.querySelector("strong")?.textContent).toBe("太字");
    expect(container.textContent).toBe("これは 太字 です");
  });

  it("`` `コード` `` は code になり、記号が文字として残らない", () => {
    const { container } = draw("設定は `config.json` です");
    expect(container.querySelector("code")?.textContent).toBe("config.json");
    expect(container.textContent).toBe("設定は config.json です");
  });

  it("`**`コード`**` の入れ子は strong の中に code を作る（再帰は深さ 2 で止まる）", () => {
    const { container } = draw("**`pnpm`**");
    const strong = container.querySelector("strong");
    expect(strong).not.toBeNull();
    expect(strong?.querySelector("code")?.textContent).toBe("pnpm");
  });

  it("コード span の中の `**` は解釈しない（コードが先に閉じる）", () => {
    const { container } = draw("`**bold**`");
    expect(container.querySelector("strong")).toBeNull();
    expect(container.querySelector("code")?.textContent).toBe("**bold**");
  });

  it("見出し・段落は開いている箇条書きを閉じる（ブロックの順序が入れ替わらない）", () => {
    // ⚠ 055e レビュー Q-1。空行以外（見出し・段落）で `<ul>` を閉じる分岐が**全く守られていなかった**
    //    ——`flushList()` を見出し分岐 / 段落分岐から消す変異が 588 tests すべて緑のまま生存した。
    //    消えると「見出しが箇条書きより**先**に出て、見出しをまたいだ項目が 1 つの `<ul>` に融合する」
    //    という目に見える崩れになる（CommonMark でも ATX 見出しはリストを中断するし、README も
    //    「見出しの前に空行が要る」とは書いていない＝書き手が普通に踏める形）。
    const { container } = draw("- a\n## H\n- b\n本文\n- c");
    const blocks = Array.from(container.firstElementChild?.children ?? []);
    expect(blocks.map((e) => e.tagName)).toEqual(["UL", "H5", "UL", "P", "UL"]);
    expect(container.querySelectorAll("li")).toHaveLength(3);
  });

  it("段落は 1 行 = 1 ブロック（連続する非空行をまとめない・055e の決定）", () => {
    const { container } = draw("1 行目\n2 行目");
    const paragraphs = container.querySelectorAll("p");
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0].textContent).toBe("1 行目");
    expect(paragraphs[1].textContent).toBe("2 行目");
  });

  it("CRLF で届いても行末に `\\r` を残さない（latest.json は外部データで改行コードを拘束できない）", () => {
    const { container } = draw("## 見出し\r\n- 項目\r\n");
    expect(container.querySelector("h5")?.textContent).toBe("見出し");
    expect(container.querySelector("li")?.textContent).toBe("項目");
    expect(container.textContent).not.toContain("\r");
  });

  it("配列で返しても React の key 警告を出さない", () => {
    // ⚠ key は「付け忘れても描画は成功する」ので、警告そのものを見ないと固定できない。
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    draw("# 見出し\n- a\n- b\n本文 **太字** と `コード` と **太字2**");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("renderReleaseNotes —— 対応外の記法は消さず・壊さず文字として残す", () => {
  const unsupported = [
    "| 表 | の | 行 |",
    "| --- | --- | --- |",
    "> 引用",
    "---",
    "```js",
    "const x = 1;",
    "```",
    "![画像](example.png)",
    "[リンク](example.com)",
    "  - ネストした項目",
    "1. 番号付きリスト",
    "- [ ] チェックボックス",
  ];

  it("表・引用・コードブロック・画像・水平線・ネスト・番号付き・チェックボックスが 1 文字も消えない", () => {
    const { container } = draw(unsupported.join("\n"));
    for (const line of unsupported) {
      // ⚠ `- [ ] チェックボックス` は箇条書きとしては拾われるので、`- ` を落とした形で残る。
      const expected = line.startsWith("- ") ? line.slice(2) : line;
      expect(container.textContent, `「${line}」が残っていない`).toContain(expected);
    }
  });

  it("リンクも画像も要素にしない（外部 URL を開く面を増やさない）", () => {
    const { container } = draw(unsupported.join("\n"));
    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });

  it("notes に HTML が入っていても要素として解釈しない（未署名データ・生 HTML 経路なし）", () => {
    const { container } = draw('<img src=x onerror="alert(1)"><b>bold</b>');
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(container.textContent).toBe('<img src=x onerror="alert(1)"><b>bold</b>');
  });

  it("組み立てる要素は属性を 1 つも持たない（未署名の notes が属性値へ流れない）", () => {
    // ⚠ 055e レビュー S-2。`notes` は minisign 署名の対象外なので、**子要素（テキスト）以外へ流すと
    //    そこが新しい面になる**——特に `style={{ background: line }}` は React が CSS 値を
    //    サニタイズしないため `url(https://…)` で**外部リソース取得**が成立する（§1 / CSP 方針違反）。
    //    生 HTML と違って**描画結果を見ても壊れて見えない**ので、これが無いと
    //    `title={line}` / `style={{…}}` を足す変異がガードにもテストにも掛からない（実測で素通りした）。
    //    ⚠ `key` は React の内部プロパティで DOM 属性にはならないので、期待値は 0 で正しい。
    const { container } = draw(
      '## 見出し\n- **太字** と `コード`\n" onerror=x\nhttps://example.com',
    );
    for (const el of container.querySelectorAll("*")) {
      expect(el.attributes, `${el.tagName} が属性を持っている`).toHaveLength(0);
    }
  });
});

describe("renderReleaseNotes —— 崩れた入力・境界（例外を投げない）", () => {
  it("`**` / `` ` `` の閉じ忘れは記号ごと文字として残す", () => {
    const { container } = draw("**閉じ忘れ と `コード");
    expect(container.querySelector("strong")).toBeNull();
    expect(container.querySelector("code")).toBeNull();
    expect(container.textContent).toBe("**閉じ忘れ と `コード");
  });

  it("中身が空の `****` / ` `` ` も記号ごと文字として残す（空要素を作らない）", () => {
    const { container } = draw("**** と `` はそのまま");
    expect(container.querySelector("strong")).toBeNull();
    expect(container.querySelector("code")).toBeNull();
    expect(container.textContent).toBe("**** と `` はそのまま");
  });

  it("空文字・改行だけならブロックを 1 つも作らない（呼び出し側のフォールバック判定に使う）", () => {
    expect(renderReleaseNotes("")).toHaveLength(0);
    expect(renderReleaseNotes("\n\n\n")).toHaveLength(0);
    expect(renderReleaseNotes("   \n\t\n")).toHaveLength(0);
  });

  it("巨大な入力（clampNotes の上限ぶん）でも例外を投げず 1 文字も落とさない", () => {
    // ⚠ `clampNotes()` が DOM に載る前に 20,000 字で切るので、パーサに来る最大がこの長さ。
    const huge = "あ".repeat(20000);
    const { container } = draw(huge);
    expect(container.textContent).toHaveLength(20000);
  });

  it("記号だけの入力でも例外を投げない", () => {
    for (const input of ["#", "-", "*", "`", "**", "***", "# ", "- ", "|", ">"]) {
      expect(() => renderReleaseNotes(input), `「${input}」で例外`).not.toThrow();
    }
  });
});

describe("renderReleaseNotes —— 実データ（docs/release-notes/v*.md）", () => {
  // ⚠ **これが実際に latest.json の notes に流れて画面に出るデータ**（055a の CI が
  //    ファイルの内容をそのまま流す）。雛形ではなく実物を通すことで、
  //    「書ける記法＝アプリで整形して表示される記法」の 1 対 1 を機械で確かめる。
  // ⚠ 期待値は**ファイルから正規表現で数える**（数字をベタ書きしない）。正規表現は
  //    `renderReleaseNotes.tsx` の HEADING_RE / BULLET_RE と同じ形にしてある。
  const headingsOf = (md: string) => md.match(/^#{1,3} .+$/gm) ?? [];
  const bulletsOf = (md: string) => md.match(/^[-*] .+$/gm) ?? [];

  it("前提: リリースノートが 1 つ以上ある（glob が空振りしていないこと）", () => {
    // ⚠ これが無いと、glob が壊れた / ディレクトリが空になったときに
    //    **it.each が 0 件で回らず、空虚に緑**になる。
    expect(releaseNotes.length).toBeGreaterThan(0);
  });

  it.each(releaseNotes)("%s: 前提として見出しと箇条書きを含んでいる", (_name, md) => {
    // ⚠ これが無いと、ファイルが空になったときに下の 0 個 == 0 個が**空虚に緑**になる。
    expect(headingsOf(md).length).toBeGreaterThan(0);
    expect(bulletsOf(md).length).toBeGreaterThan(0);
  });

  it.each(releaseNotes)("%s: 見出し・箇条書きが過不足なく要素になる", (_name, md) => {
    const { container } = draw(md);
    expect(container.querySelectorAll("h4, h5, h6")).toHaveLength(headingsOf(md).length);
    expect(container.querySelectorAll("li")).toHaveLength(bulletsOf(md).length);
  });

  it.each(releaseNotes)(
    "%s: 記法の記号が本文に残らず、リンクも画像も要素にしない",
    (_name, md) => {
      const { container } = draw(md);
      const text = container.textContent ?? "";
      expect(text).not.toContain("**");
      // ⚠ 素の `not.toContain("#")` にしない——将来「#1 の不具合」のように本文で `#` を使いうる。
      //    見たいのは「**記法として書いた行**がそのまま残っていないこと」なので、行ごと突き合わせる。
      for (const line of [...headingsOf(md), ...bulletsOf(md)]) {
        expect(text, `「${line}」が整形されずに残っている`).not.toContain(line);
      }
      expect(container.querySelector("a")).toBeNull();
      expect(container.querySelector("img")).toBeNull();
    },
  );

  it("実データのどこかに太字があり、strong 要素になる", () => {
    // ⚠ 個々のファイルに `**` を必須にはしない（太字を使わないリリースもありうる）が、
    //    **全体で 0 個**なら「太字が要素になる」経路が実データで一度も踏まれていない＝空虚。
    const total = releaseNotes.reduce(
      (n, [, md]) => n + draw(md).container.querySelectorAll("strong").length,
      0,
    );
    expect(total).toBeGreaterThan(0);
  });
});
