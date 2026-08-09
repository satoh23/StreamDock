import { describe, it, expect } from "vitest";
import type { StrippedFontFace } from "../../features/comment-viewer/overlayThemeApi";
import {
  buildFontFaceCss,
  collectUsedFontFamilies,
  selectFontFaces,
} from "./overlayThemeCard.helpers";

/**
 * 060h: 取り込むフォントの**選び方**の仕様テスト。
 *
 * ⚠⚠ **ここは安全性ではなく選び方を決めるコードである。** 取得できる URL を決めるのは
 * Rust の `strippedFontFaces`（`@font-face` の `src` 限定）で、この選別が間違っても
 * **取得する URL は 1 本も増えない**（増えるのは「取らなかった」だけ）。
 * ＝ ここが守っているのは「実サンプルの 6 ファミリ・約 660 ブロックが予算に入る形へ絞れること」。
 */

/**
 * ⚠⚠ **`family` に引用符を含めない**（060h review Q-1）。初版の fixture は `'"X"'`（引用符込み）で、
 * これは `model.rs` の「引用符付きのまま届きうる」という**誤った doc**に沿って書かれていた。
 * 実際には `sanitize::clamp_descriptor` が `"` と `'` を落とすので、Rust から届く値は**引用符なし**である
 * （Rust 側テスト `font_face_descriptors_are_carried_and_clamped` が `"Zen Kaku Gothic Antique"` で固定）。
 * この誤った前提のせいで `buildFontFaceCss` の引用符忘れが**テスト緑のまま**通っていた。
 */
const face = (over: Partial<StrippedFontFace> = {}): StrippedFontFace => ({
  family: "X",
  weight: "",
  style: "",
  unicodeRange: "",
  urls: ["https://f.example/x.woff2"],
  ...over,
});

describe("collectUsedFontFamilies: テーマが実際に使っているファミリ", () => {
  it("本文の font-family を拾う（引用符・大小・空白を正規化する）", () => {
    const used = collectUsedFontFamilies(
      '.sd-comment{font-family:"Zen Kaku  Gothic Antique", sans-serif}',
    );
    expect(used.has("zen kaku gothic antique")).toBe(true);
    expect(used.has("sans-serif")).toBe(true);
  });

  it("font 短縮形からもファミリを拾う（数値で始まるトークンは落とす）", () => {
    const used = collectUsedFontFamilies(".sd-comment{font:bold 14px/1.5 'M PLUS 1p'}");
    expect(used.has("m plus 1p")).toBe(true);
    expect(used.has("14px/1.5")).toBe(false);
  });

  it("⚠⚠ @font-face の中の font-family（定義側）は数えない", () => {
    // 数えると「定義されているものは全部使われている」ことになり、絞り込みが丸ごと無意味になる。
    const used = collectUsedFontFamilies(
      '@font-face{font-family:"Only Defined";src:url()}.sd-comment{color:red}',
    );
    expect(used.has("only defined")).toBe(false);
    expect(used.size).toBe(0);
  });

  it("⚠⚠ var() 経由の指定は空集合にする（絞り込みを諦める＝落とさない側へ倒す）", () => {
    // ⚠ 060h review Q-3。素直に走査すると `var(--fontfamily)` という**どれとも一致しない名前が
    //   1 件**入り、集合が非空になるので `selectFontFaces` の「空なら絞り込まない」フォールバックが
    //   効かず、**全ブロックが落ちて同意も案内も出ないまま書体だけ入らない**状態になっていた。
    const used = collectUsedFontFamilies(".sd-comment{font-family:var(--fontfamily)}");
    expect(used.size).toBe(0);
    expect(selectFontFaces([face({ family: "X" })], used, 100).picks).toHaveLength(1);

    // ⚠ 実名が併記されていても、解決できない `var()` があるなら諦める側へ倒す
    //   （拾えた実名だけで絞ると `var()` が指していたファミリを黙って落とすことになる）。
    const mixed = collectUsedFontFamilies(
      '.a{font-family:var(--f)}.b{font-family:"M PLUS 1p"}',
    );
    expect(mixed.size).toBe(0);

    // ⚠ フォールバックが引用符付きで書いてあるものは読めるので、そこは絞り込みを続ける。
    const withFallback = collectUsedFontFamilies(
      '.sd-comment{font-family:var(--f, "M PLUS 1p")}',
    );
    expect(withFallback.has("m plus 1p")).toBe(true);
  });
});

describe("selectFontFaces: 取り込む書体の選別", () => {
  it("⚠⚠ 使っていないファミリは落とす（実サンプルの 6 ファミリを絞る仕掛け）", () => {
    const faces = [
      face({ family: "X", urls: ["https://f.example/x.woff2"] }),
      face({ family: "Y", urls: ["https://f.example/y.woff2"] }),
    ];
    const selection = selectFontFaces(faces, new Set(["x"]), 100);
    expect(selection.picks.map((p) => p.url)).toEqual([
      "https://f.example/x.woff2",
    ]);
    // ⚠⚠ 060h review Q-4: **「使っていないから取らなかった」を「見送った」と混ぜない。**
    //   混ぜると実サンプル（6 ファミリ中 1〜2 ファミリを使用）で必ず数百件が「見送り」に数えられ、
    //   「合計サイズが上限に達したため…」という**事実と違う案内が正常系で毎回出る**。
    expect(selection.droppedByFamily).toBe(1);
    expect(selection.droppedByCount).toBe(0);
  });

  it("使用集合が空なら絞り込まない（安全側＝落とさない側へ倒す）", () => {
    // `var()` 経由でファミリを指定するテーマでは使用集合が取れない。そこで全部落とすと
    // 「書体が入らない」が既定の挙動になってしまう。
    const faces = [face({ family: "X" }), face({ family: "Y" })];
    expect(selectFontFaces(faces, new Set(), 100).picks).toHaveLength(2);
  });

  it("ファミリ名が読めないブロックも落とさない", () => {
    const faces = [face({ family: "", urls: ["https://f.example/a.woff2"] })];
    expect(selectFontFaces(faces, new Set(["z"]), 100).picks).toHaveLength(1);
  });

  it("unicode-range を持たないもの（全字面）を優先する", () => {
    const faces = [
      face({ unicodeRange: "U+4E00-9FFF", urls: ["https://f.example/kanji.woff2"] }),
      face({ unicodeRange: "", urls: ["https://f.example/all.woff2"] }),
    ];
    const selection = selectFontFaces(faces, new Set(["x"]), 1);
    expect(selection.picks.map((p) => p.url)).toEqual([
      "https://f.example/all.woff2",
    ]);
  });

  it("同じ優先度なら宣言順のまま（安定ソート）", () => {
    const faces = [
      face({ unicodeRange: "U+0000-00FF", urls: ["https://f.example/1.woff2"] }),
      face({ unicodeRange: "U+0100-01FF", urls: ["https://f.example/2.woff2"] }),
      face({ unicodeRange: "U+0200-02FF", urls: ["https://f.example/3.woff2"] }),
    ];
    expect(
      selectFontFaces(faces, new Set(["x"]), 3).picks.map((p) => p.url),
    ).toEqual([
      "https://f.example/1.woff2",
      "https://f.example/2.woff2",
      "https://f.example/3.woff2",
    ]);
  });

  it("本数の上限で打ち切り、見送った件数を返す（同意の前に出せる数字）", () => {
    const faces = Array.from({ length: 5 }, (_, i) =>
      face({ unicodeRange: `U+${i}`, urls: [`https://f.example/${i}.woff2`] }),
    );
    const selection = selectFontFaces(faces, new Set(["x"]), 2);
    expect(selection.picks).toHaveLength(2);
    // ⚠ こちらは「要るのに取れなかった」ぶん＝案内する種類の数字。
    expect(selection.droppedByCount).toBe(3);
    expect(selection.droppedByFamily).toBe(0);
  });

  it("⚠⚠ 1 ブロックからは 1 本だけ取る（`.woff2` 優先・同じ書体を 2 回引かない）", () => {
    // ⚠ 060h review Q-5。`src:url(a.woff2) format("woff2"),url(b.woff) format("woff")` は
    //   **同じ書体の別形式**。両方引くと ①予算を 2 倍使い ②記述子が同一の `@font-face` が 2 つ並んで
    //   後勝ちになり、先に引いた woff2 が丸損になる。
    const faces = [
      face({ urls: ["https://f.example/b.woff", "https://f.example/a.woff2"] }),
    ];
    expect(
      selectFontFaces(faces, new Set(["x"]), 100).picks.map((p) => p.url),
    ).toEqual(["https://f.example/a.woff2"]);

    // `.woff2` が無ければ先頭を使う（形式の判断は sidecar の MIME 検査が別に行う）。
    const woffOnly = [
      face({ urls: ["https://f.example/b.woff", "https://f.example/c.woff"] }),
    ];
    expect(
      selectFontFaces(woffOnly, new Set(["x"]), 100).picks.map((p) => p.url),
    ).toEqual(["https://f.example/b.woff"]);

    // ⚠ クエリ付きでも拡張子で判断できること（`?v=2` で `.woff2` を見失わない）。
    const withQuery = [
      face({ urls: ["https://f.example/b.woff", "https://f.example/a.woff2?v=2"] }),
    ];
    expect(
      selectFontFaces(withQuery, new Set(["x"]), 100).picks.map((p) => p.url),
    ).toEqual(["https://f.example/a.woff2?v=2"]);
  });
});

describe("buildFontFaceCss: 保存するフォント CSS", () => {
  const pickOf = (over: Partial<StrippedFontFace> = {}) => ({
    pick: { url: "https://f.example/a.woff2", face: face(over) },
    mime: "font/woff2",
    base64: "d09GMg==",
  });

  it("src だけを data URI へ置き換え、外部 URL は 1 つも残らない", () => {
    const css = buildFontFaceCss([pickOf()]);
    expect(css).toContain("src:url(data:font/woff2;base64,d09GMg==)");
    expect(css).not.toContain("f.example");
  });

  it("⚠⚠ font-weight / font-style / unicode-range は引き継ぐ", () => {
    // 引き継がないと、複数ウェイトのファミリが**同じ family 名で最後の 1 つに潰れ**、
    // 分割配信（unicode-range）の意味も失われる。
    const css = buildFontFaceCss([
      pickOf({ weight: "700", style: "italic", unicodeRange: "U+3000-30FF" }),
    ]);
    expect(css).toContain("font-family:\"X\"");
    expect(css).toContain("font-weight:700");
    expect(css).toContain("font-style:italic");
    expect(css).toContain("unicode-range:U+3000-30FF");
  });

  it("⚠⚠ font-family は必ず引用符で囲む（`M PLUS 1p` が丸ごと捨てられないように）", () => {
    // ⚠ 060h review Q-1。`clamp_descriptor` は引用符を**落として**返すので、素で埋めると
    //   `font-family:M PLUS 1p` になる。CSS の `<family-name>` は `<string> | <custom-ident>+` で、
    //   `1p` は数字始まり＝ `<custom-ident>` になれないため**記述子ごと不正**になり、
    //   ブラウザは `@font-face` **ルールを丸ごと捨てる**（実サンプルの 6 ファミリの 1 つがこれ）。
    const css = buildFontFaceCss([pickOf({ family: "M PLUS 1p" })]);
    expect(css).toContain('font-family:"M PLUS 1p"');
    expect(css).not.toContain("font-family:M PLUS 1p");
  });

  it("空の記述子は書き出さない（`font-weight:;` のような壊れた CSS を作らない）", () => {
    const css = buildFontFaceCss([pickOf()]);
    expect(css).not.toContain("font-weight:");
    expect(css).not.toContain("unicode-range:");
  });

  it("woff の format も MIME から決まる（frontend が型を決めない）", () => {
    const css = buildFontFaceCss([
      { ...pickOf(), mime: "application/font-woff", base64: "AA==" },
    ]);
    expect(css).toContain("src:url(data:application/font-woff;base64,AA==)");
    expect(css).toContain('format("woff")');
  });

  it("⚠ 生成した CSS は Rust のサニタイザが許す形（`data:` の url ＋ `@font-face` だけ）", () => {
    // ⚠ ここが崩れると「取得できたのに保存で拒否される」になり、原因がユーザーから見えない。
    //   `{}();"'\\@` を含む記述子は Rust 側の `clamp_descriptor` が落としている前提。
    const css = buildFontFaceCss([pickOf({ unicodeRange: "U+3000-30FF" })]);
    expect(css.startsWith("@font-face{")).toBe(true);
    expect(css.endsWith("}")).toBe(true);
    expect(css.match(/url\(/g)).toHaveLength(1);
  });
});
