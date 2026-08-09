import type { CommentViewDto } from "../../features/comment-viewer/types";
import type {
  OverlayThemeRecord,
  StrippedFontFace,
} from "../../features/comment-viewer/overlayThemeApi";

/**
 * 060h コミット 1（2026-08-09）: `OverlayThemeCard.tsx` から**純関数と定数だけ**を切り出したもの。
 *
 * ⚠⚠ **このファイルは「分割だけ」のコミットで作られた＝中身は 1 文字も変えていない。**
 * 分割の境界は 060c の security-review Q-1 が指定したもの（`OverlayThemeCard.tsx` の module doc に
 * 「分割するときの境界は決まっている」として書かれていた①）で、そのとおりに切ってある。
 *
 * ## ここに置いてよいものの規則
 *
 * **React にも Tauri コマンドにも触らない純関数と、その定数だけ。** state を読むもの・
 * `invoke` するもの・`document` を触るものはここへ置かない
 * （前者は `useThemeImport.ts`、後者は `OverlayThemeCard.tsx` の責務）。
 *
 * ⚠ **`document.createElement("style")` をここへ移さないこと。** 静的ガード (10-i) は
 * `OverlayThemeCard.tsx` に `createElement("style")` が**在ること**を要求しており、
 * 移すと「注入経路の allow-list が古いまま緑になる」検査が落ちる。
 */

/** `unmatched` を画面に出すときの上限（**件数**）。超えた分は「ほか N 件」に畳む。 */
const UNMATCHED_MAX_ITEMS = 10;
/** `unmatched` を画面に出すときの上限（**1 件あたりの文字数**）。 */
const UNMATCHED_MAX_CHARS = 60;
/** 画面に出すファイル名の上限（コードポイント単位・security-review S-6）。 */
const FILE_NAME_MAX_CHARS = 60;

/** 060c: 同意ダイアログに出す URL の表示上限（コードポイント）。⚠ **送るのは clamp 前の完全な URL**。 */
export const CONSENT_URL_MAX_CHARS = 512;

/** 060c: フォント名の案内に出す上限（件数 / 1 件あたりのコードポイント）。 */
const FONT_NAME_MAX_ITEMS = 5;
const FONT_NAME_MAX_CHARS = 40;

/**
 * ⚠ ユーザー由来の未署名文字列を**表示できる形へ潰す**（このカードで画面に出す文字列の唯一の入口）。
 *
 * 制御文字を落とし（引用符なしの属性値は `]` まで何でも拾うので改行も制御文字も入りうる）、
 * 空白を 1 個へ正規化し、**コードポイント単位**で切る（`slice` だとサロゲートペアを割る）。
 * ⚠ **`\p{Cf}`（bidi / format 文字）も落とす**（security-review②）。`\p{Cc}` では落ちないので、
 * これが無いと `theme<U+202E>ssc.txt` のような**表示偽装**が成立する。
 *
 * ⚠⚠ 実装が 3 か所（`clampUnmatched` / `displayFileName` / 060c の同意ダイアログ）に**複製されていた**ので
 * 1 本に寄せた（security-review 060c Q-4）。**新しい表示箇所を足すときも必ずここを通すこと**——
 * 片方だけ bidi を落とす、という非対称が過去 2 回起きている（S-6 / 060c）。
 */
export function clampDisplayText(raw: string, maxChars: number): string {
  const flat = raw
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  const chars = [...flat];
  return chars.length > maxChars
    ? `${chars.slice(0, maxChars).join("")}…`
    : flat;
}

/** `unmatched` の一覧を件数・長さの両方で clamp する（超えた件数は「ほか N 件」へ畳む）。 */
export function clampUnmatched(list: readonly string[]): {
  shown: string[];
  rest: number;
} {
  const shown = list
    .slice(0, UNMATCHED_MAX_ITEMS)
    .map((raw) => clampDisplayText(raw, UNMATCHED_MAX_CHARS));
  return { shown, rest: Math.max(0, list.length - shown.length) };
}

/**
 * 選んだファイルのパスからファイル名だけを取り出す（⚠ パスそのものは画面にもログにも出さない・§9）。
 *
 * ⚠ **表示用に正規化まで行う**（security-review S-6）。`unmatched` は clamp しているのに
 * ファイル名だけ生で描画していたのが非対称だった。ファイル名はユーザー自身のものなので実害は小さいが、
 * ①長大名でカード内のレイアウトが壊れる ②**bidi / format 文字（`\p{Cf}`）は `\p{Cc}` では落ちない**ので
 * `theme<U+202E>ssc.txt` のような拡張子偽装の見た目を作れる——どちらも「見せる前に潰す」で足りる。
 * React が escape するので XSS にはならない。
 */
export function baseName(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] ?? "";
}

/** 画面に出すファイル名（制御文字・書式文字を落とし、コードポイント単位で切る）。 */
export function displayFileName(fileName: string): string {
  return clampDisplayText(fileName, FILE_NAME_MAX_CHARS);
}

/** ファイル名からテーマ名の初期値を作る（Rust の `validate_theme_name` を確実に通る形に丸める）。 */
export function defaultThemeName(fileName: string): string {
  const stem = fileName.replace(/\.css$/i, "");
  const cleaned = stem.replace(/\p{Cc}/gu, "").trim();
  const chars = [...cleaned];
  const clamped = chars.slice(0, 80).join("").trim();
  return clamped === "" ? "テーマ" : clamped;
}

/** プレビュー用のダミーコメント（chat と課金の 2 分岐を見せる＝`.sd-comment-tip` / `data-sd-tone` も出る）。 */
export const PREVIEW_COMMENTS: CommentViewDto[] = [
  {
    id: "sd-preview-chat",
    source: "twitch",
    author: { id: "sd-preview-1", name: "視聴者さん" },
    text: "これはプレビュー用のサンプルコメントです。",
    publishedAt: "2026-01-01T00:00:00Z",
    eventType: "chat",
  },
  {
    id: "sd-preview-tip",
    source: "youtube",
    author: { id: "sd-preview-2", name: "応援してる人" },
    text: "配信たのしみにしてます！",
    publishedAt: "2026-01-01T00:01:00Z",
    eventType: "superchat",
    // ⚠ 060i(2026-08-09): **本番の表記と同形にすること**（`"1,000 JPY"`）。以前は `"￥1,000"` だったが、
    //   実データは `wire.ts` が `<桁区切り済み数値> <通貨コード>` で組む（`monetaryAmount` は監視済みの値を
    //   verbatim 表示する契約）ので、見本だけ円記号にすると**プレビューでヘッダの幅を見積れない**
    //   ——金額バッジは `white-space: nowrap` でヘッダ右端を占める要素なので、見本の綴りが短いと
    //   「本番では入らない幅」を「入る」と誤って見せる。
    monetaryAmount: "1,000 JPY",
    monetary: { amount: 1000, currency: "JPY" },
  },
];

/**
 * 060c: 同意ダイアログのホスト行に出す文字列を作る。
 *
 * ⚠⚠ **`new URL(url).hostname` を出す**のが要点。`https://ruri.info@evil.example/a.css` は
 * 正当な URL なので Rust 側では弾いておらず（`record_import_url` の注記）、完全な URL を素で出すと
 * **先頭に見えるほう（`ruri.info`）を信じられる**。実際の宛先は `hostname` である。
 * ⚠ IDN は punycode（`xn--…`）で出る——これは**欠点ではなく偽装の検出手段**なのでそのまま見せる。
 *
 * ⚠⚠ **既知の限界（受容・security-review 060c S-4）**: ここで使う `new URL()` は **webview の URL パーサ**
 * （WebKit / Blink）で、sidecar の `assertAllowedThemeImportUrl` は **Node のパーサ**（ada）である。
 * ＝「表示 URL と送信 URL は同じ 1 変数」は `consent.url` については成立しているが、
 * **そこから導出したホスト名の同一性は 2 実装の一致に依存している**。
 * 両方 WHATWG 準拠で IDNA も同じ ICU 系なので乖離は考えにくく、乖離しても**取得できる形は
 * sidecar 側のガードが決める**（表示だけが甘くなる形）ため受容する。
 * ⚠ 再修正トリガー＝ホスト名を**同意の可否以外の判断**（allow-list 照合・「以前同意した宛先」の記憶など）に
 * 使い始めたら、判定を sidecar 側の 1 実装へ寄せること。
 */
export function consentHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    // ⚠ Rust 側が `http(s)` の絶対 URL に限定しているのでここには来ない想定だが、
    // 来たときに「ホスト不明のまま取得の同意を求める」ことがないよう、分かる形にして出す。
    return "(アドレスを解釈できません)";
  }
}

/**
 * 060c: 保存された CSS と、除去された `@import` の宛先から**フォント名**を拾う。
 *
 * 060h（Web フォントの実体取り込み）を待たずに「なぜ書体だけ変わらないのか」を伝えるための案内なので、
 * **拾えたら出す・拾えなくても案内は出す**（呼び出し側が判断する）。拾い方は 2 系統:
 *
 * 1. **保存済み CSS の `@font-face` の `font-family`** … 060b は `src:url(https://…)` を**宣言ごと**
 *    落とすが、`@font-face` ブロックと `font-family` 宣言は残るのでここが最も確実。
 * 2. **`strippedImportUrls` の Google Fonts クエリ** … `…/css2?family=Zen+Kaku+Gothic+Antique:wght@400`
 *    の `family=`（v1 の `?family=A|B` にも対応）。⚠ 実サンプルはこの形。
 *
 * ⚠ **ユーザー入力由来の文字列を画面に出す**ので、件数・長さとも clamp する（060d と同じ作法）。
 * ⚠ 戻り値は `clampUnmatched` と同じ `{ shown, total }` 形にしてある——**畳んだ後の件数で
 * 「ほか N 件」を数えると過少申告になる**（12 種あっても「ほか 4 件」と出ていた・security-review 060c Q-10）。
 */
export function collectFontNames(
  css: string,
  strippedImportUrls: readonly string[],
): { shown: string[]; total: number } {
  const names: string[] = [];
  const push = (raw: string) => {
    const name = clampDisplayText(raw.replace(/^['"]|['"]$/g, ""), FONT_NAME_MAX_CHARS);
    if (name !== "" && !names.includes(name)) names.push(name);
  };

  // 1. `@font-face { … font-family: X … }`。⚠ ブロックの中だけを見る（本文の `font-family` は
  //    「端末にあるフォントの指定」であって、外部から読み込もうとしたものではない）。
  for (const block of css.matchAll(/@font-face\s*\{([^}]*)\}/gi)) {
    const decl = /font-family\s*:\s*([^;}]+)/i.exec(block[1]);
    if (decl) push(decl[1].trim());
  }

  // 2. Google Fonts の `family=`。⚠ URL は既に Rust 側で clamp・検証済み（http(s) 絶対 URL のみ）。
  for (const raw of strippedImportUrls) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      continue;
    }
    for (const value of url.searchParams.getAll("family")) {
      // v1 は `A|B|C`、v2 は 1 パラメータ 1 ファミリ（`Name:wght@400`）。
      for (const item of value.split("|")) {
        const family = item.split(":")[0].replace(/\+/g, " ").trim();
        if (family !== "") push(family);
      }
    }
  }

  return { shown: names.slice(0, FONT_NAME_MAX_ITEMS), total: names.length };
}

/**
 * 060c: フォント案内の文言を作る（拾えなかったときは名前を伏せた汎用文）。
 *
 * ⚠ **§1 を一切曲げずにユーザーへ次の行動を示せる**ので、060h の完成を待たずに出す。
 * ⚠ 件数は **clamp 前の `total`** で数える（画面に出す名前は `shown` の先頭だけ・Q-10）。
 */
export function fontAdviceText(names: { shown: string[]; total: number }): string {
  const subject =
    names.total === 0
      ? "外部のフォント"
      : names.total === 1
        ? names.shown[0]
        : `${names.shown[0]} ほか ${names.total - 1} 件`;
  // ⚠ 名前を鉤括弧で括る——`X ほか 2 件` のような集合表現でも日本語として崩れないため。
  return `このテーマは「${subject}」を指定していますが、StreamDock は外部からフォントを読み込みません。端末にインストールすると反映されます。`;
}

// --- 060h: 取り込むフォントの選別 ---------------------------------------------------------------
//
// ⚠⚠ **ここは「安全性」ではなく「選び方」を決めるコードである。**
// 取得できる URL を決めるのは Rust の `strippedFontFaces`（`@font-face` の `src` 限定・
// http(s) 絶対 URL のみ）で、ここが間違っても**取得する URL は 1 本も増えない**
// ——増えるのは「取らなかった」だけである。この非対称を崩さないこと。
//
// ⚠⚠ **frontend で CSS から URL を抜き出さない**（正規表現を書き始めない）。書くと
// `background-image` まで拾える形になり、それは**トラッキングピクセルの取得経路**である。
// 選別に要る `font-family` / `unicode-range` も **Rust が同じ 1 か所から返している**
// （保存後の CSS には `src` が残らないので、そもそも対応づけが復元できない・実測）。

/**
 * 060h: **テーマが実際に使っているフォント名**を集める（`font-family` / `font` 宣言の値）。
 *
 * ⚠⚠ **これが選別の要**である。依頼者の実サンプルは Google Fonts を **6 ファミリ** `@import` するが、
 * `font-family` で実際に指しているのは 1〜2 ファミリしかない。絞らないと
 * 6 × 約 110 分割 ≒ 10MB 超になり、予算に**入らない**（＝どのファミリが入るかが宣言順まかせになる）。
 *
 * ⚠ `@font-face` ブロックの中の `font-family`（＝定義側）は**数えない**。数えると
 * 「定義されているものは全部使われている」ことになり、絞り込みが丸ごと無意味になる。
 * ⚠ ここが読むのは**保存済みの意匠 CSS**で、URL は 1 つも出てこない（取得先を増やす経路にならない）。
 *
 * ⚠⚠ **`var()` 経由の指定は「使用集合が取れなかった」として扱う**（060h review Q-3）。
 * `font-family:var(--fontfamily)` から実際のファミリ名は取れないのに、素直に走査すると
 * `var(--fontfamily)` という**どれとも一致しない名前が 1 件入る**＝集合が非空になり、
 * `selectFontFaces` の「集合が空なら絞り込まない」フォールバックが効かず**全ブロックが落ちる**。
 * その結果、同意ダイアログも結果メモも出ないまま書体だけが入らない（実測で成立する形）。
 * → 解決できない `var()` を 1 つでも見つけたら**空集合を返して絞り込みを諦める**（落とさない側へ倒す）。
 * ⚠ `var(--x, "M PLUS 1p")` のようにフォールバックが引用符付きで書いてあるものは拾えるので、
 * 「引用符付きの名前が 1 つも取れなかったとき」だけ諦める形にしてある。
 */
export function collectUsedFontFamilies(css: string): Set<string> {
  // `@font-face{…}` を落としてから走査する（定義側と使用側を混ぜない）。
  const withoutFontFace = css.replace(/@font-face\s*\{[^}]*\}/gi, " ");
  const used = new Set<string>();
  /** 解決できない `var()` を見たか（⚠ 見たら最後に空集合へ倒す・上の注記）。 */
  let unresolvable = false;
  for (const match of withoutFontFace.matchAll(
    /(?:^|[;{\s])font(?:-family)?\s*:\s*([^;}]+)/gi,
  )) {
    // ⚠ `var(--x)` は名前が読めない。`var(--x, "Name")` のように引用符付きの実名が併記されて
    //   いれば下の走査が拾うので、**拾えたかどうかは最後にまとめて判定する**。
    if (/\bvar\s*\(/i.test(match[1] ?? "")) {
      if (!/(['"]).+?\1/.test(match[1] ?? "")) unresolvable = true;
    }
    for (const item of (match[1] ?? "").split(",")) {
      // ⚠ `font` 短縮形（`bold 14px/1.5 "M PLUS 1p"`）では、ファミリ名は**値の末尾**にある。
      //   引用符付きなら中身を、無ければ最後の空白区切りトークンを拾う。
      //   ⚠ **多めに拾って構わない**——この集合は「落とさない側」の判断にしか使わないので、
      //   余計な名前が入っても取得先が増えることはない（増えるのは「落とさなかった」だけ）。
      const quoted = [...item.matchAll(/(['"])(.*?)\1/g)].map((m) => m[2]);
      const candidates = quoted.length > 0 ? quoted : [item, item.trim().split(/\s+/).pop() ?? ""];
      for (const candidate of candidates) {
        const name = normalizeFontFamily(candidate);
        // 数値で始まるトークン（`14px/1.5` 等）はファミリ名ではない。
        if (name === "" || /^\d/.test(name)) continue;
        // ⚠ `var(--x)` そのものはファミリ名ではない（集合に入れると「どれとも一致しない 1 件」になり、
        //   フォールバックが効かなくなる＝ Q-3 の実体）。
        if (name.startsWith("var(")) continue;
        used.add(name);
      }
    }
  }
  // ⚠⚠ 解決できない `var()` を 1 つでも見たら**絞り込みを丸ごと諦める**（空集合を返す）。
  // 部分的に拾えた実名だけで絞ると、`var()` 側が指していたファミリを**黙って落とす**ことになる
  // ——このコードが守っているのは「予算に収める」ことで、「必要な書体を落とさない」ほうが上位である。
  // ⚠ 絞り込みを外しても取得は無制限にならない（`THEME_FONT_MAX_COUNT` と総量予算が別に効く）。
  return unresolvable ? new Set<string>() : used;
}

/** フォント名を比較用に正規化する（引用符除去・小文字化・空白を 1 個へ）。 */
function normalizeFontFamily(raw: string): string {
  return raw
    .trim()
    .replace(/^['"]|['"]$/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/** 060h: 取得する 1 本（URL と、それが属する `@font-face` の記述子）。 */
export interface FontPick {
  url: string;
  face: StrippedFontFace;
}

/** 060h: 選別の結果。 */
export interface FontSelection {
  /** 取得する 1 本ずつ。⚠ **必ず `strippedFontFaces` に載っていた URL だけ**。 */
  picks: FontPick[];
  /**
   * **テーマが使っていないファミリ**だったので取らなかった件数。
   *
   * ⚠⚠ 060h review Q-4 で `skipped` を 2 つに割った。以前は 1 つの数字にまとめていたので、
   * 実サンプル（6 ファミリ ≒ 660 本のうち使用 1〜2 ファミリ ≒ 110 本）で**必ず 550 件が「見送り」に
   * 数えられ**、「合計サイズが上限に達したため…」という**事実と違う案内が正常系で毎回出ていた**。
   * こちらは「そもそも要らないから取らなかった」ぶんで、ユーザーに謝る種類の数字ではない。
   */
  droppedByFamily: number;
  /** **本数の上限**で打ち切ったぶん（＝要るのに取れなかった件数。こちらは案内する）。 */
  droppedByCount: number;
}

/**
 * 060h: 取得するフォントを選ぶ。**規則は 3 段**（`docs/tasks/060h-*.md` の問題③の結論）:
 *
 * 1. **テーマが実際に使っているファミリだけ**（使用集合が空／名前が読めないものは**落とさない**側へ倒す）
 * 2. **`unicode-range` を持たないものを優先**（全字面を覆うので、部分取得でも見た目が安定する）
 * 3. **宣言順に、本数の予算まで**（バイトの予算は取得ループが逐次で減らす——
 *    `Content-Length` を信用しない方針なので、取得前に総量は分からない）
 *
 * ⚠⚠ **1 ブロックからは 1 本しか取らない**（060h review Q-5）。`src:url(a.woff2) format("woff2"),
 * url(b.woff) format("woff")` は**同じ書体の別形式**なので、両方引くと
 * ①同じ書体を 2 回ダウンロードして予算を 2 倍使い ②記述子がまったく同じ `@font-face` が 2 つ並んで
 * 後勝ちになり、**先に引いた woff2 が丸損**になる。`.woff2` を優先し、無ければ先頭を使う。
 */
export function selectFontFaces(
  faces: readonly StrippedFontFace[],
  usedFamilies: ReadonlySet<string>,
  maxCount: number,
): FontSelection {
  // ⚠ 1 ブロック = 1 本（`.woff2` 優先）。⚠ 判定はパスの形だけで、**ここで URL を組み立てない**。
  const all: FontPick[] = faces
    .filter((face) => face.urls.length > 0)
    .map((face) => ({
      url:
        face.urls.find((url) => url.toLowerCase().split("?")[0].endsWith(".woff2")) ??
        face.urls[0],
      face,
    }));
  const keep = ({ face }: FontPick): boolean => {
    if (usedFamilies.size === 0) return true; // 使用集合が取れなければ絞り込まない
    const family = normalizeFontFamily(face.family);
    if (family === "") return true; // 名前が読めなければ落とさない
    return usedFamilies.has(family);
  };
  // ⚠ **安定ソート**で「`unicode-range` を持たないものが先」。同じ優先度なら宣言順のまま。
  const kept = all.filter(keep);
  const ordered = kept
    .map((pick, index) => ({ pick, index, wide: pick.face.unicodeRange === "" }))
    .sort((a, b) => (a.wide === b.wide ? a.index - b.index : a.wide ? -1 : 1))
    .map((e) => e.pick);

  return {
    picks: ordered.slice(0, maxCount),
    droppedByFamily: all.length - kept.length,
    droppedByCount: Math.max(0, ordered.length - maxCount),
  };
}

/**
 * 060h: 取得したフォントから **`@font-face` だけの CSS** を組む。
 *
 * ⚠⚠ **`mime` は sidecar が allow-list で検証した値**をそのまま使う（frontend が型を決めない）。
 * ⚠ 元の記述子（`font-weight` / `font-style` / `unicode-range`）は**そのまま引き継ぐ**——
 * 引き継がないと、複数ウェイトのファミリが**同じ family 名で最後の 1 つに潰れ**、
 * 分割配信（`unicode-range`）の意味も失われる。
 * ⚠ 引き継がないのは `src` だけ（そこを data URI で置き換えるのが本タスクそのもの）。
 * ⚠ 記述子は **Rust 側で clamp 済み**（`sanitize::clamp_descriptor`）なので、ここでは組み立てるだけ。
 *
 * ⚠⚠ **`font-family` は必ず引用符で囲む**（060h review Q-1）。`clamp_descriptor` は引用符を
 * **落として**返すので、素で埋めると `font-family:M PLUS 1p` になる——CSS の `<family-name>` は
 * `<string> | <custom-ident>+` で、`1p` は数字始まりなので `<custom-ident>` になれず**記述子ごと不正**、
 * つまり `@font-face` **ルールが丸ごとブラウザに捨てられる**。実サンプルの 6 ファミリの 1 つが
 * まさに `M PLUS 1p` で、全テスト緑のままこの書体だけ静かに反映されない状態だった。
 * ⚠ 囲んでも脱出できない（`clamp_descriptor` が `"` と `\` を落としている）。
 */
export function buildFontFaceCss(
  fonts: readonly { pick: FontPick; mime: string; base64: string }[],
): string {
  const rules: string[] = [];
  for (const font of fonts) {
    const face = font.pick.face;
    const descriptors: string[] = [];
    if (face.family !== "") descriptors.push(`font-family:"${face.family}"`);
    if (face.weight !== "") descriptors.push(`font-weight:${face.weight}`);
    if (face.style !== "") descriptors.push(`font-style:${face.style}`);
    if (face.unicodeRange !== "")
      descriptors.push(`unicode-range:${face.unicodeRange}`);
    const format = font.mime.includes("woff2") ? "woff2" : "woff";
    descriptors.push(
      `src:url(data:${font.mime};base64,${font.base64}) format("${format}")`,
    );
    rules.push(`@font-face{${descriptors.join(";")}}`);
  }
  return rules.join("\n");
}

/**
 * 060e: 貼り付け取り込みの**名前の既定値**を作る（「デザイン 1」「デザイン 2」…）。
 *
 * ⚠ **名前を必須入力にすると「貼って押すだけ」にならない**（Rust の `validate_theme_name` は空を拒否する）。
 * ⚠ 既存と重複しない番号を選ぶ——060b は `name` に UNIQUE を張っていないので**重複しても保存はできる**が、
 * 既定値が最初から重複していると「同じ名前のデザインが既にあります」が毎回出て警告の意味が薄れる。
 */
export function nextPastedName(themes: readonly OverlayThemeRecord[]): string {
  const used = new Set(themes.map((t) => t.name));
  // ⚠ 上限を式で書く（security-review②・品質 #5）。`themes.length + 1` 個の候補があれば
  // 鳩の巣原理で必ず 1 つは空いているので、**終了条件を持たないループにしない**
  // （実際は Rust の 200 件上限で必ず抜けるが、その根拠がこのファイルからは見えない）。
  for (let i = 1; i <= themes.length + 1; i++) {
    const candidate = `デザイン ${i}`;
    if (!used.has(candidate)) return candidate;
  }
  return `デザイン ${themes.length + 1}`;
}
