import { describe, it, expect } from "vitest";
import {
  DEFAULT_DECORATION_RESET,
  withDecorationReset,
} from "./overlayThemeReset";
import { rewriteSelectors } from "./cssCompat";
import { scopeSelectors, PREVIEW_SCOPE_SELECTOR } from "./cssScope";

/**
 * 060f 追修正(2026-08-08): **既定意匠のリセット**の仕様テスト。
 *
 * ## あるべき挙動（仕様）
 *
 * 実機確認で 2 巡、崩れが出た。
 *
 * **① しっぽが二重に見える。** StreamDock の既定のしっぽは**疑似要素 2 枚**
 * （`.bubble::before` ＝枠色の三角／`.bubble::after` ＝塗り色の三角）で描かれているのに対し、
 * **取り込むテーマは `::before` 1 枚しか書かないのが普通**で、`::after` が孤児として残るため。
 *
 * **② 既定の吹き出しが「テーマが越えられない床」になっていた。** テーマが明示的に書かなかった
 * プロパティ（枠・角丸・影）は既定のまま残るので、どのテーマも
 * 「StreamDock の吹き出し ＋ テーマの一部」というハイブリッドになる。
 * ＝ **吹き出しを持たないタイプのデザインが原理的に適用できない**（本人指摘・2026-08-08）。
 *
 * → テーマ CSS の**手前**に固定のリセットを連結して、既定の装飾一式を引っ込める。
 *
 * リセットが満たすべき条件:
 * 1. **既定の `.bubble` 一式（詳細度 `(0,1,0)`）に勝つ** … 既定側を `@layer sd-default` に
 *    入れ、リセットは非レイヤーで置くことで成立（カスケードは「非レイヤー > レイヤー」）
 * 2. **ユーザーのテーマにはどんな書き方でも負ける** … `:where()` で詳細度を **0** にし、かつ**手前**に置く
 * 3. **固定文字列である**（ユーザー入力を 1 バイトも混ぜない＝新しい注入経路を作らない）
 * 4. **変換（`rewriteSelectors`）に触られない**（注入のたびに毎回走るので、触られると冪等性が壊れる）
 * 5. **プレビューでは `scopeSelectors` に閉じ込められる**（＝連結はスコープ化の**前**）
 * 6. ⚠ **課金カードを巻き込まない**（chat 用テーマが課金カードを壊さない＝ 060f の起票理由①）
 * 7. ⚠ **`position` と `padding` は落とさない**（下の各テストに理由）
 *
 * ⚠ 1 と 2 の「実際にどちらが勝つか」は**カスケードの解決**なので jsdom では見られない。
 * ここで見られるのは**形**（詳細度 0・先頭・固定文字列・当て先）までで、
 * 効いていることの担保は静的ガード **(10-m)** と実機確認が持つ。
 *
 * ⚠⚠ **この役割分担の限界（レビュー指摘・申し送り 11・2026-08-08・修正不要と判断）**:
 * 3 層（形＝ここ／結線＝静的ガード／カスケードと画素＝実機）に分けているのは妥当だが、
 * **本変更の中核（「リセットが既定に勝ち、テーマには負ける」）は現時点でいかなる自動検証も受けていない。**
 * 静的ガード層がその役目を負っており、**同じ形の間違いで 3 回破れている**（(10-m) の穴 ①②③・
 * ③はレビューで実測されて是正）。
 * ⚠ **ここを jsdom で埋めることはできない**（nwsapi はカスケードも `@layer` も評価しない）ので、
 * 本ファイルを厚くしても解決しない＝この分業のままにする。
 * 再修正トリガー: 同じ種類の差し戻しがもう 1 度出たら、実エンジン（WebKit）での
 * スモークテストを 1 本入れる——オーバーレイへ 3 行のテーマを注入して
 * `getComputedStyle(p).backgroundColor === "rgba(0, 0, 0, 0)"` を見るだけで中核が固定できる。
 * ⚠ 導入判断は 060c / 060g のスコープで行うこと（新規 devDependency が要るので単独では入れない）。
 *
 * 仕様の正: `overlayThemeReset.ts` の docstring ／ `docs/progress.md` の 060f 節。
 */

/**
 * リセットを「ルール（プレリュード＋宣言ブロック）」に分解する。
 *
 * ⚠ **`split("}")` の素朴なパーサ**。リセットは固定文字列で、宣言値に `}` を含まないので今は正しいが、
 * 値に `}` が入った瞬間に**黙って別のルール境界で切り始め**、以降のアサーションが全部
 * 「別のものを検査して緑」になる（レビュー指摘 Q-8・2026-08-08）。
 * → 下の `describe` 先頭で **ルール数と「値に `}` が無いこと」を表明**して、その silent failure を止めている。
 * 再修正トリガー: リセットの値に `}` を書く必要が出たら（`content` で文字を描く等）、
 * ここを素の CSS パーサへ差し替えること。**依存は増やさず**、`cssScope.ts` の `scan` を再利用すればよい。
 */
const RESET_RULES: { selectors: string[]; body: string }[] =
  DEFAULT_DECORATION_RESET.split("}")
    .filter((chunk) => chunk.includes("{"))
    .map((chunk) => {
      const at = chunk.indexOf("{");
      return {
        selectors: chunk
          .slice(0, at)
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s !== ""),
        body: chunk.slice(at + 1),
      };
    });

/** そのリセットが宣言しているプロパティ名。 */
const propsOf = (body: string): string[] =>
  body
    .split(";")
    .map((d) => d.split(":")[0]?.trim() ?? "")
    .filter((p) => p !== "");

const ALL_PROPS = RESET_RULES.flatMap((r) => propsOf(r.body));

/**
 * ⚠ 「装飾」＝ chat 限定でなければならないプロパティ。
 * これを宣言するルールが課金カードにも当たると、060f の起票理由①（chat 用テーマが課金カードを壊す）へ戻る。
 *
 * ⚠⚠ **これは change-detector ではなく allow-list である**（レビュー指摘 Q-8 で確認）——
 * 「このプロパティを宣言するなら chat 限定であれ」という向きなので、`position` / `all` /
 * `--sd-icon-gap` を足しても**正しいコードが落ちない**（追修正③で実際にそうなった消去法版の反省）。
 * ⚠ 代わりの弱点は「**未収載の装飾プロパティ**（`outline` / `background-image` / `backdrop-filter` 等）を
 * 足すと chat 限定検査が黙って適用外になる」こと。リセットに装飾を足すときは**必ずここへも足すこと。**
 * 再修正トリガー: 収載漏れが実際に起きたら、列挙をやめて「`position` と `--sd-*` 以外はすべて装飾」の
 * 消去法へ反転させる（そのときは追修正③の失敗を繰り返さないよう例外リストを別に持つ）。
 */
const DECORATION_PROPS = [
  "background",
  "border",
  "border-radius",
  "filter",
  "box-shadow",
  "padding",
];

/** 疑似要素（`::before` / `::after`）を当て先にしているルールか。 */
const isPseudoRule = (selectors: string[]): boolean =>
  selectors.every((s) => s.includes("::"));

describe("DEFAULT_DECORATION_RESET", () => {
  /**
   * ⚠⚠ **上の `RESET_RULES` パーサ（`split("}")`）が正しく切れていることの前提条件**
   * （レビュー指摘 Q-8・2026-08-08）。これが無いと、値に `}` が混ざった瞬間にパーサが別の境界で
   * 切り始め、**以下のアサーション全部が「別のものを検査して緑」になる**（silent failure）。
   * ルール数も固定する——ブロックを 1 つ消す変異が、どのテストにも引っかからずに通るのを防ぐため。
   */
  it("⚠⚠ パーサの前提: ルールは 5 つ・宣言値に `}` を含まない", () => {
    // ⚠ 060c 追修正(2026-08-09): `:where(.sd-comment-chat){padding:0}` を足して 4 → 5 になった。
    expect(RESET_RULES).toHaveLength(5);
    for (const rule of RESET_RULES) {
      expect(rule.body).not.toContain("}");
      expect(rule.body).not.toContain("{");
    }
    // 分解した合計が元の文字列を覆っている（取りこぼしたブロックが無い）。
    const braces = [...DEFAULT_DECORATION_RESET].filter((c) => c === "{").length;
    expect(braces).toBe(RESET_RULES.length);
  });

  /**
   * ⚠⚠ 060f 追修正③(2026-08-08): **`content: none` では不足だった**（実機「しっぽがズレる」）。
   * `content` だけ止めても、テーマが `content:""` で疑似要素を復活させた瞬間、テーマが**書かなかった**
   * `top` / `width` / `height` / `border-*-width` / `border-style` / `border-color` が
   * `@layer sd-default` の既定値のまま効く。文字（`content:"◀"`）・回転四角・画像でしっぽを描くテーマは必ず崩れる。
   * → `all: unset` で**白紙**に戻す（`all` は `content` を含むので従来の挙動を包含する）。
   */
  it("⚠⚠ 既定のしっぽは all:unset で白紙に戻す（content:none では幾何が漏れる）", () => {
    const pseudo = RESET_RULES.filter((r) => isPseudoRule(r.selectors));
    expect(pseudo).toHaveLength(1);
    expect(pseudo[0].selectors).toEqual([
      ":where(.sd-comment-body.sd-comment-in-chat)::before",
      ":where(.sd-comment-body.sd-comment-in-chat)::after",
    ]);
    expect(propsOf(pseudo[0].body)).toEqual(["all"]);
    expect(pseudo[0].body).toContain("unset");
  });

  /**
   * ⚠⚠⚠ **060f 追修正④(2026-08-08・本人決定) の中核**: リセットは **chat にしか当たってはいけない。**
   * 課金カードにはもう安定クラスが 1 つも無い（`CommentList.tsx` の課金分岐・静的ガード (10-o)）ので
   * `.sd-comment-body` だけでも実害は出ないが、**当て先を字面で chat に閉じておく**ことで、
   * 将来カード側にクラスを戻したときリセットが黙って漏れるのを防ぐ。
   * ＝「課金カードのデザインは常に同じ」という要件を、リセット側でも独立に担保する。
   */
  it("⚠⚠⚠ 全ルールの当て先が chat 専用クラスを含む（課金カードには絶対に当たらない）", () => {
    for (const rule of RESET_RULES) {
      for (const sel of rule.selectors) {
        expect(
          sel.includes("sd-comment-chat") || sel.includes("sd-comment-in-chat"),
        ).toBe(true);
        // 課金側の語彙が復活していないこと（廃止済み）。
        expect(sel).not.toContain("sd-comment-tip");
        expect(sel).not.toContain("sd-comment-in-tip");
      }
    }
  });

  /**
   * ⚠⚠ 実テーマ頻出の「コメント 1 件の枠に対する絶対配置」（依頼者の実サンプルの縦バー＝
   * `.yt-live-chat-text-message-renderer::before{position:absolute;left:0;top:20%;height:60%}`）が
   * **窓の左上へ飛ばない**ようにする。`.item` は `position: static` なので器の側に基準が要る。
   * ⚠ 060f 追修正④(2026-08-08) で `.sd-comment` → `.sd-comment-chat` にした（当て先は同じ `<li>`）。
   * 追修正③時点は「課金カード側のテーマも同じ罠を踏むから chat 限定にしない」判断だったが、
   * **課金カードがユーザー CSS の的でなくなった**ので理由自体が消えた。
   */
  it("⚠⚠ chat の <li> に位置の基準を与える（テーマの絶対配置が窓の左上へ飛ばない）", () => {
    const rule = RESET_RULES.find((r) => propsOf(r.body).includes("position"));
    expect(rule).toBeDefined();
    expect(rule?.selectors).toEqual([":where(.sd-comment-chat)"]);
    expect(rule?.body).toContain("relative");
  });

  /**
   * ⚠⚠ **追修正②の本体。** これが無いと、テーマが枠・角丸・影を明示的に書かないかぎり
   * 既定の吹き出しが残り、**吹き出しを持たないデザインが適用できない**。
   */
  it("⚠⚠ 吹き出しの装飾（背景・枠・角丸・影）を落とす", () => {
    for (const prop of ["background", "border", "border-radius", "filter"]) {
      expect(ALL_PROPS).toContain(prop);
    }
  });

  /**
   * ⚠⚠ `.bubble{position:relative}` は**テーマの `::before`（絶対配置のしっぽ）の基準**。
   * ここで `static` へ戻すと、テーマのしっぽが遠い祖先を基準に飛んで画面の変な位置に出る。
   * ＝ **リセットが直そうとした崩れを、リセット自身が別の形で作り直す**。
   * ⚠ 追修正③で `.sd-comment`（器）には `position: relative` を**与える**ようになったが、
   * それとは別物——ここで見ているのは**吹き出し自身**の `position` を触っていないこと。
   */
  it("⚠⚠ 吹き出し自身の position は落とさない（テーマのしっぽの位置基準を壊さない）", () => {
    const bubble = RESET_RULES.find((r) =>
      r.selectors.some(
        (s) => s.includes("sd-comment-body") && !s.includes("::"),
      ),
    );
    expect(bubble).toBeDefined();
    expect(propsOf(bubble?.body ?? "")).not.toContain("position");
  });

  /**
   * ⚠⚠⚠ chat では `.bubble`（箱）と `.text`（文字）が**同じ 1 枚の `<p>`** に併記されている。
   * だからここで `all: unset` を使うと、**本文の font-size / color / line-height / margin:0 まで消える**
   * （疑似要素のほうは併記が無いので `all` で構わない＝上のテスト）。
   */
  it("⚠⚠⚠ 吹き出し自身のリセットに all は使わない（本文の書体・色まで消える）", () => {
    for (const rule of RESET_RULES) {
      if (isPseudoRule(rule.selectors)) continue;
      expect(propsOf(rule.body)).not.toContain("all");
    }
  });

  /**
   * ⚠⚠ **padding の扱いは当て先で正反対**（060c 追修正 2026-08-09 で片側だけ反転した）。
   *
   * - **吹き出し（`.sd-comment-body`＝本文の箱）の padding は落とさない**（2026-08-08 本人決定）。
   *   純正チャット向けテーマは **YouTube 側の余白に依存して書かれている**ので、落とすと
   *   背景しか指定していないテーマで**文字が箱の端に張り付く**。
   * - **`<li>`（`.sd-comment-chat`＝コメント 1 件の外枠）の padding は落とす**（060c 追修正）。
   *   `.item{padding:6px 4px}` は 035b で足した **StreamDock 固有**の余白で、テーマはその存在を
   *   知らずに自分でも `padding` を書くため**両方が積み上がってコメント間が広がりすぎる**（実機で確認）。
   *
   * ⚠ 2 つを取り違えると、どちらかの実機不具合がそのまま戻る。
   */
  it("⚠⚠ padding は <li> からは落とし、吹き出しからは落とさない", () => {
    const li = RESET_RULES.filter((r) =>
      r.selectors.every((s) => s === ":where(.sd-comment-chat)"),
    );
    const bubble = RESET_RULES.filter((r) =>
      r.selectors.some((s) => s.includes("sd-comment-body")),
    );
    expect(li.length).toBeGreaterThan(0);
    expect(bubble.length).toBeGreaterThan(0);

    // <li> 側：padding を 0 へ返すルールが在ること。
    const liPadding = li.find((r) => propsOf(r.body).includes("padding"));
    expect(liPadding).toBeDefined();
    expect(liPadding?.body).toContain("0");

    // 吹き出し側：padding を 1 つも宣言していないこと（本文が端に張り付かない）。
    for (const rule of bubble) {
      expect(propsOf(rule.body)).not.toContain("padding");
    }
  });

  /**
   * ⚠ 28px の内訳は「既定のしっぽの突き出し 20px ＋ 素のすき間 8px」。しっぽを描かなくなるので 20px を返す。
   * ⚠⚠ 当て先が**入口の `--sd-icon-gap`** であることが要点——`.item` が宣言しているのは `--icon-gap` で、
   * そちらを狙っても同じ要素のより高詳細度の宣言に負けて効かない。
   */
  it("⚠ アイコンとのすき間を 8px へ戻す（--sd-icon-gap を chat の <li> へ当てる）", () => {
    const gap = RESET_RULES.find((r) => propsOf(r.body).includes("--sd-icon-gap"));
    expect(gap).toBeDefined();
    expect(gap?.body).toContain("8px");
    expect(gap?.selectors).toEqual([":where(.sd-comment-chat)"]);
    // ⚠ `--icon-gap`（`.item` 自身の宣言）を狙うと効かない。
    expect(ALL_PROPS).not.toContain("--icon-gap");
  });

  /**
   * ⚠⚠ **060f の起票理由①（chat 用テーマが課金カードを壊す）に戻さないこと。**
   * 装飾を落とすルールの当て先は **chat 限定**でなければならない。
   * ⚠ 追修正④(2026-08-08) で**リセットの 4 ルールすべてが chat 限定**になった（レビュー指摘 Q-7 で
   * 陳腐化を訂正——ここは追修正③まで「疑似要素のルールだけは共通で構わない（課金カードに既定の
   * 疑似要素は無いので無害）」と書いてあった）。**無害であることと、当て先が chat に閉じていることは別**で、
   * 全ルールの chat 限定は下の「全ルールの当て先が chat 専用クラスを含む」テストが固定している。
   */
  it("⚠⚠ 装飾を落とすルールは chat 限定（課金カードの意匠を巻き込まない）", () => {
    // ⚠ 判定は「**装飾プロパティを宣言しているか**」で行う（これが本来の不変条件）。
    //   「`content` 以外なら装飾」のような消去法にすると、`position` や `all` を足しただけで
    //   正しいコードが落ちる（追修正③で実際に起きた）。
    const decorating = RESET_RULES.filter((r) =>
      propsOf(r.body).some((p) => DECORATION_PROPS.includes(p)),
    );
    expect(decorating.length).toBeGreaterThan(0);
    for (const rule of decorating) {
      for (const sel of rule.selectors) {
        // ⚠ 060c 追修正(2026-08-09): 判定を `sd-comment-in-chat` の一点張りから
        //   「**chat 専用クラスのどちらか**」へ広げた。守っている不変条件（＝課金カードに当たらない）は
        //   同じで、`.sd-comment-chat` は chat の `<li>` にしか付かない（`CommentList.tsx` の契約・
        //   `CommentList.selectorContract.test.tsx` が実 DOM で固定）。
        //   広げた理由＝ `<li>` の padding を返すルール（`:where(.sd-comment-chat){padding:0}`）が
        //   装飾プロパティを宣言する 2 本目になり、当て先が**器**なので `in-chat` を含まないため。
        //   ⚠ **`sd-comment` / `sd-comment-body` 単独へ緩めないこと**（それは課金カードにも当たりうる）。
        expect(
          sel.includes("sd-comment-chat") || sel.includes("sd-comment-in-chat"),
        ).toBe(true);
        expect(sel).not.toContain("sd-comment-in-tip");
        expect(sel).not.toContain("sd-comment-tip");
      }
    }
  });

  /**
   * ⚠⚠ **ここが仕組みの要**。`:where()` を外すと詳細度が上がり、
   * テーマが弱いセレクタで書いたときに**リセットがテーマに勝ってしまう**（＝テーマの意匠が出ない）。
   * 0 にしておけば「テーマがどう書いても必ず勝つ」が構造的に保証される。
   */
  it("⚠⚠ 全セレクタが :where() で包まれている（詳細度 0＝テーマに必ず負ける）", () => {
    expect(RESET_RULES.length).toBeGreaterThan(0);
    for (const rule of RESET_RULES) {
      expect(rule.selectors.length).toBeGreaterThan(0);
      for (const sel of rule.selectors) {
        // `:where(…)` の外側にクラス・id・要素名が 1 つも無いこと（擬似要素だけ許す）。
        expect(sel).toMatch(/^:where\([^)]+\)(?:::(?:before|after))?$/);
      }
    }
  });

  /**
   * ⚠ ユーザー入力を 1 バイトも混ぜない＝「テーマとは別の CSS 注入経路」を作らない
   * （`docs/security.md`「レビュー必須条件」の区分を跨がないための線引き。060g の表示設定層と同じ）。
   */
  it("⚠ 固定文字列である（引数も補間も無い）", () => {
    expect(typeof DEFAULT_DECORATION_RESET).toBe("string");
    expect(DEFAULT_DECORATION_RESET).not.toContain("${");
    // 呼び出し引数に関係なく、前置される部分は常に同じ。
    expect(withDecorationReset("A")).toBe(DEFAULT_DECORATION_RESET + "A");
    expect(withDecorationReset("B")).toBe(DEFAULT_DECORATION_RESET + "B");
  });

  /**
   * ⚠ `!important` で解決してはいけない——今度は**ユーザーのテーマに勝ってしまう**
   * （リセットは「既定に勝ち、テーマには負ける」の両立が要件）。
   */
  it("⚠ !important を使わない（テーマに勝ってしまうため）", () => {
    expect(DEFAULT_DECORATION_RESET).not.toContain("!important");
  });
});

describe("withDecorationReset", () => {
  /**
   * ⚠⚠ **順序がこの仕組みの全部**。リセットが後ろに付くと、テーマが書いた意匠を
   * リセットが消してしまう（＝テーマの意匠が出ない）。手前に置くから「テーマが後勝ち」になる。
   */
  it("⚠⚠ リセットは必ず CSS の手前に来る（テーマが後勝ちする順序）", () => {
    const theme = '.sd-comment-text::before{content:""}';
    const out = withDecorationReset(theme);
    expect(out.startsWith(DEFAULT_DECORATION_RESET)).toBe(true);
    // ⚠ レビュー指摘 Q-3(2026-08-08): ここは元々 `indexOf("content:none")` を見ていたが、
    //   追修正③で定数が `all:unset` になった時点で **`-1` を返す恒真アサーション**に化けていた
    //   （`-1 < 正の数` は常に真＝何も検証していない）。リセットの**実物**と比べる形へ直した。
    //   ⚠ 定数の中身に依存する文字列リテラルをテストに書かないこと（同じ形で黙って死ぬ）。
    expect(out.indexOf(DEFAULT_DECORATION_RESET)).toBeLessThan(
      out.indexOf(theme),
    );
  });

  it("テーマ CSS を 1 バイトも書き換えない", () => {
    const theme = '@import url("https://x.test/a.css");\n.a{content:"}"}';
    expect(
      withDecorationReset(theme).slice(DEFAULT_DECORATION_RESET.length),
    ).toBe(theme);
  });

  it("空の CSS でもリセットだけが残る（テーマが空でも既定の装飾は引っ込む）", () => {
    expect(withDecorationReset("")).toBe(DEFAULT_DECORATION_RESET);
  });
});

describe("注入経路との組み合わせ", () => {
  /**
   * ⚠ 変換は**注入のたびに毎回**走る（060b の決定）。リセットは sd 語彙で書かれているが、
   * 変換表の `from` に sd 語彙は無い（静的ガード (10-c)）ので**触られない**。
   * ここが崩れると、注入のたびにリセットが変形して冪等性が壊れる。
   */
  it("⚠ rewriteSelectors はリセットに 1 バイトも触らない（冪等）", () => {
    const r = rewriteSelectors(DEFAULT_DECORATION_RESET);
    expect(r.css).toBe(DEFAULT_DECORATION_RESET);
    expect(r.rewritten).toBe(0);
    expect(r.unmatched).toEqual([]);
  });

  /**
   * ⚠⚠ **プレビューでは連結が「スコープ化の前」でなければならない。**
   * 後に連結すると**リセットだけが `.sd-preview` の外へ漏れて**、コメビュ窓の
   * 他所（＝プレビュー枠の外）の吹き出し装飾まで止めてしまう。
   */
  it("⚠⚠ プレビュー経路ではリセットも .sd-preview 配下へ閉じ込められる", () => {
    const theme = ".chat-line__no-background{color:red}";
    const scoped = scopeSelectors(
      withDecorationReset(rewriteSelectors(theme).css),
      PREVIEW_SCOPE_SELECTOR,
    );
    // リセット由来のセレクタが素のまま（前置なし）で残っていないこと。
    expect(scoped).not.toContain("\n:where(");
    expect(scoped.startsWith(".sd-preview :where(")).toBe(true);
    for (const line of scoped.split("\n")) {
      if (line.includes(":where(")) {
        expect(line.startsWith(".sd-preview ")).toBe(true);
      }
    }
    // ⚠ 装飾リセットのぶんも漏れていないこと（追修正②で行が増えたので明示的に見る）。
    expect(scoped).toContain(
      ".sd-preview :where(.sd-comment-body.sd-comment-in-chat)",
    );
    expect(scoped).toContain(".sd-preview :where(.sd-comment-chat)");
    // テーマぶんは従来どおり変換＋前置される。
    expect(scoped).toContain(".sd-preview .sd-comment-chat{color:red}");
  });

  it("配信窓の経路ではスコープ化しない（前置する相手がいない）", () => {
    const out = withDecorationReset(
      rewriteSelectors(".chat-line__no-background{color:red}").css,
    );
    expect(out).toBe(`${DEFAULT_DECORATION_RESET}.sd-comment-chat{color:red}`);
  });
});
