import { useCallback, useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import type { CommentViewDto } from "../../features/comment-viewer/types";
import type { OverlayFontId } from "../../features/comment-viewer/overlaySettings";
import {
  loadOverlayTheme,
  resolveOverlayFontStack,
  saveOverlayTheme,
} from "../../features/comment-viewer/overlaySettings";
import { rewriteSelectors } from "../../features/comment-viewer/cssCompat";
import { withDecorationReset } from "../../features/comment-viewer/overlayThemeReset";
import {
  PREVIEW_SCOPE_CLASS,
  PREVIEW_SCOPE_SELECTOR,
  scopeSelectors,
  unclosedBlockDepth,
} from "../../features/comment-viewer/cssScope";
import {
  cssByteLength,
  deleteOverlayTheme,
  getOverlayThemeCss,
  importOverlayTheme,
  importOverlayThemeSnapshot,
  importOverlayThemeText,
  listOverlayThemes,
  renameOverlayTheme,
  themeCssError,
  themeNameError,
  THEME_CSS_MAX_BYTES,
  THEME_MAX_COUNT,
  type OverlayThemeImportResult,
  type OverlayThemeRecord,
} from "../../features/comment-viewer/overlayThemeApi";
import type { ThemeImportFetchResult } from "../../features/comment-viewer/commentStream";
import { toErrorMessage } from "../../features/tools/useTools";
import { ConfirmDialog } from "./ConfirmDialog";
import { CommentList } from "./CommentList";
import { ToggleSwitch } from "./ToggleSwitch";
import styles from "./CommentViewerApp.module.css";

/**
 * 060d: 設定ビューの「コメントのデザイン」カード。ユーザーが用意した CSS を取り込み、名前を付けて保存し、
 * OBS に表示するコメントの意匠を切り替える。
 *
 * ## 状態をこのコンポーネントが持つ理由（`SettingsView` の「表示専用」からの意図的な逸脱）
 *
 * 他のカードは state を `CommentViewerApp` が持ち `SettingsView` は表示専用、という作法だが、ここは
 * **自前で API を呼び自前で `ConfirmDialog` を持つ**（`ViewersView` / `ViewerDetailPanel` と同じ形）。理由:
 * ①`SettingsViewProps` は既に 30 個超で、一覧・取り込み・改名・削除・プレビューを足すと更に 10 個増える
 * ②選択中テーマ id の**消費者はオーバーレイ窓だけ**で、経路は localStorage＝`CommentViewerApp` は関与しない
 * ③`CommentViewerApp.tsx` は既に 1900 行超。
 * `SettingsView` から受け取るのは**プレビューの体裁に要る 2 つだけ**（フォントとサイト名表示）。
 *
 * ## ⚠ ファイルの長さについて（security-review②・品質 #10）
 *
 * ⚠⚠ **1300 行超（060c 時点）。旧トリガー「060c の同意ダイアログを足して 1000 行を超えたら切る」は
 * 発火したが、060c では切っていない**（security-review 060c Q-1 で指摘され、明示的に見送った）。
 *
 * 見送った理由: ①テストが `OverlayThemeCard.test.tsx` 1 本にコンポーネント境界で書かれており
 * （100 件超・うち 060c 群が約 20 件）、分割は「テストが通ることの意味」を変えずには行えない
 * ②060c は **§1 に 8 件目の例外を新設する変更**で、同じコミットに大きな構造変更を混ぜると
 * security-review の差分が読めなくなる（**レビュー可能性を優先した**）。
 *
 * ⚠ **分割するときの境界は決まっている**: ①純関数＋定数（`clampDisplayText` / `clampUnmatched` /
 * `baseName` / `displayFileName` / `defaultThemeName` / `nextPastedName` / `consentHost` /
 * `collectFontNames` / `fontAdviceText` / `PREVIEW_COMMENTS`・約 200 行）を
 * `overlayThemeCard.helpers.ts` へ ②取り込みと解析（`analyze` / `runImport` / `runConsentLoop` /
 * `ImportOutcome`）を `useThemeImport()` フックへ。これで UI 本体は 600 行台になる。
 * ⚠⚠ **新しい再修正トリガー＝ 060h（Web フォントの実体取り込み）に着手するとき、実装の前に①②の順で切ること。**
 * 060h は取得ループとフォント案内の両方に手を入れるので、**切らずに足すと確実に 1600 行を超える**。
 * ＝ 060h のタスクの第 1 コミットを「分割だけ（振る舞い差分ゼロ）」にすること。
 *
 * ## ⚠ このカードが背負っている安全側の要件
 *
 * - **「既定のデザインに戻す」は常時表示・常時有効**。ユーザー CSS は `.sd-comment { display:none }` の
 *   一行でオーバーレイを不可視にでき、オーバーレイ窓は表示専用・非フォーカスなので**そこからは復帰できない**。
 *   ここが唯一の脱出路（テストで固定）。
 * - **プレビューの CSS は `scopeSelectors` でラッパ配下へ閉じ込める**。`<style>` はスコープを持たないので、
 *   素で注入するとコメビュ窓全体が第三者の CSS に乗っ取られる。
 *   ⚠⚠ **`scopeSelectors` だけでは閉じない**（security-review S-2 / S-3・2026-08-05）:
 *   ①**描画位置**は `.themePreview` の **`contain: paint`** が閉じている（`overflow:hidden` だけでは
 *     `position:fixed` の子孫を止められず、「既定のデザインに戻す」ボタンや OBS のパスワード欄を
 *     覆えた）。②**`@font-face` の family 名 / `@keyframes` の名前**は文書グローバルで**閉じていない**——
 *     060b が `data:` の `url()` を許可形として残すため、任意のグリフを持つフォントで
 *     アプリ UI のフォント名を乗っ取れる（＝表示文字列の偽装）。守っているのは
 *     「プレビューを開いている間だけ `<style>` を置く」＝**露出時間を限ることだけ**である。
 *     恒久策は shadow root / iframe への移行（設計変更につき別タスク）。
 * - **ユーザー CSS 由来の文字列（`unmatched`）は clamp してから出す**。件数も 1 要素の長さも入力次第で無制限
 *   （060a レビュー S-1 の実測）。React が escape するので XSS にはならないが、画面が壊れる。
 * - **除去した `@import` の URL は出さない**（件数だけ）。完全な URL を安全に見せるには「ホストを別行で強調」が
 *   要り（userinfo 付き URL の表示偽装対策・060b review② S-6）、それは 060c の同意ダイアログの責務。
 * - **パス文字列を画面に出さない**（§9）。出すのはファイル名だけ。
 */

/** `unmatched` を画面に出すときの上限（**件数**）。超えた分は「ほか N 件」に畳む。 */
const UNMATCHED_MAX_ITEMS = 10;
/** `unmatched` を画面に出すときの上限（**1 件あたりの文字数**）。 */
const UNMATCHED_MAX_CHARS = 60;
/** 画面に出すファイル名の上限（コードポイント単位・security-review S-6）。 */
const FILE_NAME_MAX_CHARS = 60;

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
function clampDisplayText(raw: string, maxChars: number): string {
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
function clampUnmatched(list: readonly string[]): {
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
function baseName(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] ?? "";
}

/** 画面に出すファイル名（制御文字・書式文字を落とし、コードポイント単位で切る）。 */
function displayFileName(fileName: string): string {
  return clampDisplayText(fileName, FILE_NAME_MAX_CHARS);
}

/** ファイル名からテーマ名の初期値を作る（Rust の `validate_theme_name` を確実に通る形に丸める）。 */
function defaultThemeName(fileName: string): string {
  const stem = fileName.replace(/\.css$/i, "");
  const cleaned = stem.replace(/\p{Cc}/gu, "").trim();
  const chars = [...cleaned];
  const clamped = chars.slice(0, 80).join("").trim();
  return clamped === "" ? "テーマ" : clamped;
}

/** プレビュー用のダミーコメント（chat と課金の 2 分岐を見せる＝`.sd-comment-tip` / `data-sd-tone` も出る）。 */
const PREVIEW_COMMENTS: CommentViewDto[] = [
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

/** 取り込み結果のうち、**保存後の CSS からその場で計算する**ぶん（DB には持たない＝ 060b の決定）。 */
interface CssAnalysis {
  rewritten: number;
  unmatched: string[];
  /** 対応の取れていない `(` 等で、CSS の残りが丸ごと落ちた疑いがあるか。 */
  truncated: boolean;
}

/** 取り込み直後に表示する結果（⚠ `strippedImportUrls` を含む丸ごとを持つ＝ 060c の同意ダイアログの受け皿）。 */
interface ImportOutcome {
  result: OverlayThemeImportResult;
  analysis: CssAnalysis | null;
  duplicateName: boolean;
  /** 060c: 外部 `@import` の取得についてユーザーへ伝えること（同意しなかった／取得できなかった等）。 */
  snapshotNotes: string[];
  /** 060c: フォントの案内（060h を待たずに出す）。 */
  fontNote: string | null;
}

/**
 * 060c: 同意ダイアログの 1 件分。
 *
 * ⚠⚠ **`url` は Rust が返した文字列そのもの**で、ここから先も**組み立て直さない**。
 * 画面に出すのも sidecar へ送るのも同じこの 1 変数で、「表示した URL と取得する URL が同一」を
 * 変数の同一性で担保している（テストで固定）。
 */
interface ConsentRequest {
  url: string;
  index: number;
  total: number;
  resolve: (accepted: boolean) => void;
}

/** 060c: 同意ダイアログに出す URL の表示上限（コードポイント）。⚠ **送るのは clamp 前の完全な URL**。 */
const CONSENT_URL_MAX_CHARS = 512;

/** 060c: フォント名の案内に出す上限（件数 / 1 件あたりのコードポイント）。 */
const FONT_NAME_MAX_ITEMS = 5;
const FONT_NAME_MAX_CHARS = 40;

/**
 * 060c: 取得結果を連結するときの区切り。
 *
 * ⚠ 改行 1 つで足りるが**予算計算に必ず含める**こと（`\n` を足したぶんで 256KB を 1 バイト超えると、
 * 同意も取得も済ませたあとに保存だけが落ちる）。
 */
const SNAPSHOT_JOINER = "\n";

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
function consentHost(url: string): string {
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
function collectFontNames(
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
function fontAdviceText(names: { shown: string[]; total: number }): string {
  const subject =
    names.total === 0
      ? "外部のフォント"
      : names.total === 1
        ? names.shown[0]
        : `${names.shown[0]} ほか ${names.total - 1} 件`;
  // ⚠ 名前を鉤括弧で括る——`X ほか 2 件` のような集合表現でも日本語として崩れないため。
  return `このテーマは「${subject}」を指定していますが、StreamDock は外部からフォントを読み込みません。端末にインストールすると反映されます。`;
}

/**
 * 入力フォームの状態（**同じ名前入力フォームを 3 用途で使い回す**）。
 *
 * - `paste` … 060e の主導線。⚠ **ファイルを作らせない**ので `path` も `fileName` も持たない。
 * - `import` … ファイル選択（060d）。既に `.css` を持っている人向けの副導線として残してある。
 * - `rename` … 既存テーマの改名。
 *
 * ⚠ **`null`（フォームが閉じている）という状態は無い**（060e で既定が `paste` になったため）。
 * 060d までは `null` があり、その名残の `form !== null` ガードが各所に残って**状態機械が実際より
 * 複雑に読めていた**ので、security-review② で型から落とした。
 * 再修正トリガー＝「入力欄を完全に隠す」状態が要るときは、`null` を足すのではなく
 * `{ kind: "closed" }` として**明示の状態**にすること（`?.` の連鎖が復活しないように）。
 */
type NameForm =
  | { kind: "paste" }
  | { kind: "import"; path: string; fileName: string }
  | { kind: "rename"; id: string };

/**
 * 060e: 貼り付け取り込みの**名前の既定値**を作る（「デザイン 1」「デザイン 2」…）。
 *
 * ⚠ **名前を必須入力にすると「貼って押すだけ」にならない**（Rust の `validate_theme_name` は空を拒否する）。
 * ⚠ 既存と重複しない番号を選ぶ——060b は `name` に UNIQUE を張っていないので**重複しても保存はできる**が、
 * 既定値が最初から重複していると「同じ名前のデザインが既にあります」が毎回出て警告の意味が薄れる。
 */
function nextPastedName(themes: readonly OverlayThemeRecord[]): string {
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

interface OverlayThemeCardProps {
  /** プレビューを実配信に近づけるためだけに受け取る（値の所有は `CommentViewerApp` のまま）。 */
  overlayFont: OverlayFontId;
  overlayShowSource: boolean;
  /**
   * 060c: 外部 `@import` を sidecar に **1 本だけ**取得させる（スナップショット）。
   *
   * ⚠ WS ハンドルを持っているのは `CommentViewerApp` なので、**この 1 本だけ**を流してもらう
   * （カードが WS を張り直すと接続が二重になる）。⚠ 未指定なら外部取得の導線ごと出さない
   * （＝取り込みは従来どおり `@import` を除去して成功する＝ fail-closed）。
   */
  requestThemeImport?: (
    url: string,
    maxBytes: number,
  ) => Promise<ThemeImportFetchResult>;
}

export function OverlayThemeCard({
  overlayFont,
  overlayShowSource,
  requestThemeImport,
}: OverlayThemeCardProps) {
  const [themes, setThemes] = useState<OverlayThemeRecord[]>([]);
  // ⚠ 「読み込み中」と「読めた（0 件）」と「読めなかった」を分ける。どれも一覧が空に見えるが、
  // ユーザーが取る行動が違う（待つ／取り込む／設定を開き直す）。058a の列挙状態と同じ考え方。
  const [listState, setListState] = useState<"loading" | "ready" | "failed">(
    "loading",
  );
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    loadOverlayTheme(),
  );
  // ⚠ 060e: **既定は貼り付けフォーム**（`null` ではない）。ユーザーに `.css` ファイルを作らせないため、
  // カードを開いた時点で貼って押せる状態にしておく。ファイル選択・改名のときだけ一時的に差し替わる。
  const [form, setForm] = useState<NameForm>({ kind: "paste" });
  const [nameInput, setNameInput] = useState("");
  /** 貼り付けられた CSS 本文。⚠ **ここから出るのは invoke だけ**（ログにも画面にも出さない・§9）。 */
  const [cssInput, setCssInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);
  const [pendingDelete, setPendingDelete] = useState<OverlayThemeRecord | null>(
    null,
  );
  /** 060c: 表示中の同意ダイアログ（1 件ずつ・`null` なら出ていない）。 */
  const [consent, setConsent] = useState<ConsentRequest | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  const reload = useCallback(async () => {
    try {
      setThemes(await listOverlayThemes());
      setListState("ready");
    } catch {
      // ⚠ 一覧が読めないこと自体は伝えるが、詳細は出さない（§9）。
      setListState("failed");
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  /**
   * 保存後の CSS を読み、**注入時と同じ変換**を通して結果を数える。
   * ⚠ DB に持たないのは 060b の決定（変換表を更新した瞬間に DB の数字が古くなるため）。
   */
  const analyze = useCallback(
    async (
      id: string,
      truncatedToEof: boolean,
    ): Promise<{ css: string; analysis: CssAnalysis } | null> => {
      try {
        const css = await getOverlayThemeCss(id);
        const { rewritten, unmatched } = rewriteSelectors(css);
        // ⚠ 「取り込み前後のサイズ比」ではなく**構造**で判定する理由は cssScope.ts の
        // `unclosedBlockDepth` の注記を参照（比率だと正常系と病的ケースを区別できず、
        // かつ frontend は取り込み前のファイルを読む手段を持たない）。
        // ⚠⚠ **2 本の OR で見る**（060c）。`truncatedToEof`（Rust）は「壊れた `(` がトップレベルに
        // あって除去が EOF まで達した」を、`unclosedBlockDepth`（ここ）は「壊れた `(` がブロックの中に
        // あって `}` ごと消えた」を見ており、**互いに相手を含まない**。片方だけだと取り逃す。
        return {
          css,
          analysis: {
            rewritten,
            unmatched,
            truncated: truncatedToEof || unclosedBlockDepth(css) > 0,
          },
        };
      } catch {
        return null;
      }
    },
    [],
  );

  /**
   * 選択を切り替える（＝オーバーレイ窓へ localStorage 経由で伝える）。
   *
   * ⚠ **`busy`（取り込み／改名／削除の実行中）でも止めない**（security-review Q-5・意図）。理由:
   * ①「既定のデザインに戻す」は**壊れたテーマからの唯一の脱出路**なので、他の操作の巻き添えで
   *   押せなくなる状態を作らない（ここが塞がると配信中に詰む）。ラジオも同じ導線なので揃える。
   * ②切り替えても壊れない——localStorage への書き込みと進行中の invoke は独立で、
   *   取り込み完了後の `reload()` は一覧だけを差し替える（`selectedId` は触らない）。
   * 見える副作用は「取り込み中に切り替えると一覧が一瞬古く見える」だけ。
   * 再修正トリガー＝ここに「実行中は選択を反映しない」系の分岐を足したくなったら、
   * **先に「既定のデザインに戻す」だけは常時有効である**ことを担保してから入れること。
   */
  const select = useCallback((id: string | null) => {
    setSelectedId(id);
    saveOverlayTheme(id);
  }, []);

  /**
   * 060e: 名前を空のままにできるのは**貼り付けのときだけ**（そのとき `autoName` が入る）。
   * ⚠ ファイル取り込みと改名は従来どおり空を拒否する——前者はファイル名から必ず初期値が入るし、
   * 後者は「今の名前を消して保存」が事故にしかならないため。
   */
  const autoName = useMemo(() => nextPastedName(themes), [themes]);
  const effectiveName =
    form.kind === "paste" && nameInput.trim() === ""
      ? autoName
      : nameInput.trim();

  // ⚠ Rust の `validate_theme_name` と同じ規則を**先に** frontend で当てる（060b からの申し送り①）。
  // 通してしまうと「入力できるのに保存できない」になる。
  const nameError = themeNameError(effectiveName);
  // ⚠ 同じく Rust の `validate_css_body` を先に当てる（060e）。空・256KB 超だけを見る。
  // ⚠ **`useMemo` にしない**（security-review②・品質 #6）。毎レンダー走るが、実測で
  // **256KB（`あ`×85K＝261,142 バイト）でも `trim()`＋`TextEncoder.encode()` が 0.14ms/回**
  // （ASCII 256KB なら 0.03ms）＝ React の再レンダーそのものより桁で安い。
  // 再修正トリガー＝上限を数 MB へ上げるとき（そのときは実測してから判断すること）。
  const cssError = form.kind === "paste" ? themeCssError(cssInput) : null;
  const duplicateWhileTyping =
    nameError === null &&
    themes.some(
      (t) =>
        t.name === effectiveName &&
        !(form.kind === "rename" && t.id === form.id),
    );

  const startImport = async () => {
    setError(null);
    try {
      const picked = await open({
        multiple: false,
        directory: false,
        title: "コメントのデザイン（CSS）を選択",
        filters: [{ name: "CSS", extensions: ["css"] }],
      });
      if (typeof picked !== "string") return;
      const fileName = baseName(picked);
      setOutcome(null);
      setForm({ kind: "import", path: picked, fileName });
      setNameInput(defaultThemeName(fileName));
    } catch (e) {
      setError(toErrorMessage(e));
    }
  };

  const startRename = (theme: OverlayThemeRecord) => {
    setError(null);
    setOutcome(null);
    setForm({ kind: "rename", id: theme.id });
    setNameInput(theme.name);
  };

  /**
   * フォームを既定状態（＝貼り付け欄）へ戻す。⚠ 060e で「閉じる」ではなく「戻す」になった。
   *
   * ⚠⚠ **貼り付けた CSS 本文（`cssInput`）はここで消さない**（security-review②・品質 #1）。
   * ここは「キャンセル」「改名の成功」「**ファイル**取り込みの成功」からも呼ばれるので、消すと
   * **数十行貼った直後に「名前を変更」を押しただけで貼った内容が失われる**（データロス）。
   * 本文を捨てるのは「**貼り付けたものが保存できた**」ときだけ＝下の `runImport` の `clearPastedCss`。
   */
  const backToPasteForm = () => {
    setForm({ kind: "paste" });
    setNameInput("");
  };

  /**
   * 060c: 1 件分の同意を求め、ユーザーが押すまで待つ。
   *
   * ⚠ `url` は Rust が返した文字列そのものを**そのまま**受け渡す（表示用と取得用で別々に組み立てない）。
   *
   * ⚠ **未解決のまま残る経路が 1 つだけある＝ダイアログ表示中のアンマウント**
   * （security-review 060c Q-8）。`runImport` の `finally` は例外経路しか救わない。
   * 塞いでいない理由: このカードがアンマウントされるのは**コメビュ窓を閉じるとき**だけで、
   * そのとき `runImport` の続きが走らなくても失われるものが無い（除去版は保存済み・取得は未実行）。
   * ⚠ 再修正トリガー＝カードが**窓を閉じずにアンマウントされうる**（タブ化・設定画面の遅延描画など）
   * ようになったら、`useEffect` のクリーンアップで `settleConsent(false)` を呼ぶこと。
   */
  const askConsent = (url: string, index: number, total: number) =>
    new Promise<boolean>((resolve) => {
      setConsent({ url, index, total, resolve });
    });

  /**
   * 同意ダイアログを 1 件閉じ、待っている `askConsent` を解決する。
   *
   * ⚠ **updater の中で `resolve` を呼ぶ（＝純粋でない updater）のは意図的**（security-review 060c Q-7）。
   * 「いま表示されている 1 件」と「解決すべき Promise」を**同じ 1 つの状態遷移**に縛るためで、
   * ref に逃がすと state と ref が乖離しうる（キャンセルと承諾が競合したときに二重解決になる）。
   * ⚠ **なぜ安全か**: React StrictMode（dev）は updater を 2 回呼ぶが、`resolve` は解決済み Promise に
   * 対して no-op なので**観測できる差が出ない**。1 回目で `null` を返すため 2 回目の `current` も同じ値。
   * ⚠ 再修正トリガー＝この updater に **`resolve` 以外の副作用**（ログ・別の setState・計測）を足したく
   * なったら、そこで冪等性が崩れるので resolver を `useRef` へ移し、updater の外で呼ぶこと。
   */
  const settleConsent = (accepted: boolean) => {
    setConsent((current) => {
      current?.resolve(accepted);
      return null;
    });
  };

  /**
   * 060c: 除去された外部 `@import` を、**1 本ずつ同意を取って 1 回だけ取得**する。
   *
   * ⚠⚠ **同意 N 回・取得 N 回だが、保存は 1 回**。全部の取得結果を順に連結し、除去済み CSS の**前に**
   * 一括で前置して `Snapshot` として保存し直す（有効な CSS の `@import` は先頭にしか書けないので
   * 前置＝原位置と等価・060b 申し送り③）。テーマを N 個作らないための設計。
   *
   * @returns 取得できた CSS（同意した順）と、ユーザーへ伝えるメモ。
   */
  const runConsentLoop = async (
    urls: readonly string[],
    savedCssBytes: number,
    /** ⚠ 呼び出し側で `undefined` を除いてから渡す（ここで非 null 表明をしない）。 */
    fetchOne: (url: string, maxBytes: number) => Promise<ThemeImportFetchResult>,
  ): Promise<{ fetched: string[]; notes: string[] }> => {
    const fetched: string[] = [];
    const notes: string[] = [];
    let declined = 0;
    let failed = 0;
    let offline = false;
    // ⚠ レート制限（sidecar 側・同時 1 件／60 秒 8 件）は `failed` と**別に数える**
    // （security-review 060c S-7）。まとめると「アドレスが変わっている」と案内してしまい、
    // ユーザーが取る行動が変わってしまう——こちらは**待てば通る**。
    let rateLimited = 0;
    // ⚠⚠ **予算は逐次で減らす**。保存上限（256KB）が事実上の合計上限なので、
    // 「取得に成功してから保存で落ちる」＝帯域も同意も無駄、を作らない（060b 申し送り⑤）。
    let remaining = THEME_CSS_MAX_BYTES - savedCssBytes;

    for (let i = 0; i < urls.length; i++) {
      const budget = remaining - SNAPSHOT_JOINER.length;
      if (budget <= 0) {
        notes.push(
          "デザインの合計サイズが上限（256KB）に達したため、残りの外部デザインは取り込みませんでした。",
        );
        break;
      }
      // ⚠ **同意が先・取得は後**。ここを入れ替えると「同意していないのに通信した」になる。
      const accepted = await askConsent(urls[i], i + 1, urls.length);
      if (!accepted) {
        declined++;
        continue;
      }
      const result = await fetchOne(urls[i], budget);
      if (result.ok) {
        fetched.push(result.css);
        remaining -= cssByteLength(result.css) + SNAPSHOT_JOINER.length;
      } else if (result.reason === "offline" || result.reason === "busy") {
        offline = true;
      } else if (result.reason === "rate") {
        rateLimited++;
      } else {
        failed++;
      }
    }

    if (declined > 0) {
      notes.push(
        `外部からは取得しませんでした（${declined} 件）。その指定は取り除かれた状態で保存されています。`,
      );
    }
    if (offline) {
      notes.push(
        "外部から取り込むための内部接続が準備中のため、取得できませんでした。少し待ってから同じ CSS をもう一度取り込むと反映されることがあります。",
      );
    }
    if (rateLimited > 0) {
      // ⚠ 「待てば通る」ことが分かる文言にする（下の `failed` は「URL を直す」側で、行動が違う）。
      notes.push(
        `外部デザインの取得が短時間に集中したため、${rateLimited} 件は取得を見送りました。1 分ほど待ってから同じ CSS をもう一度取り込むと反映されます。`,
      );
    }
    if (failed > 0) {
      // ⚠ 理由の詳細（HTTP ステータス・URL・本文）は出さない（§9）。ユーザーが取る行動は同じである。
      notes.push(
        `外部デザインを ${failed} 件取得できませんでした（アドレスが変わっている・公開されていない・StreamDock が許可していない形式のいずれかです）。`,
      );
    }
    return { fetched, notes };
  };

  /**
   * 取り込みを実行する（**貼り付け版とファイル版で後処理を共有する**）。
   *
   * ⚠ 分けているのは `invokeImport`（どのコマンドを呼ぶか）だけ。結果の解析・同名警告・一覧の再取得は
   * 完全に同じで、**取り込み経路が増えても表示の作法が分岐しない**（Rust 側で検証を共通コアに寄せたのと同じ発想）。
   *
   * ## 060c: 外部 `@import` のスナップショット
   *
   * 同意と取得は **`await invokeImport()` の直後・`setOutcome` の前**に挟む。
   * `strippedImportUrls` は **DB に持たない＝この 1 回しか手に入らない**ので、他の場所からは後付けできない。
   *
   * ⚠⚠ **保存し直しの順序＝「Snapshot を保存 → 成功したら除去版を削除」**（本人決定・案 A）。
   * 逆順（先に削除）にすると、保存に失敗したときテーマが**丸ごと消える**。この順なら
   * 保存に失敗しても除去版が残る＝**失われるものが無い**。削除に失敗したら 2 件残るが、
   * それは可視でユーザーが消せる故障なので受容する（`store_sanitized_css` が
   * 「孤児ファイルは不可視で無害／孤児 DB 行は可視の故障」と分けているのと同じ思想）。
   *
   * ⚠⚠ **同意ループの入力は 1 回目の結果の `strippedImportUrls` だけ**（`urls` に束縛して再代入しない）。
   * Snapshot 保存の結果にも `strippedImportUrls` が載る（取得した CSS の中の入れ子 `@import`。
   * 実サンプルでは Google Fonts が 6 本入る）が、**それで同意ループを再起動しない**＝無限ループ防止。
   * 2 回目の結果はフォント名の抽出にだけ使う。
   */
  const runImport = async (
    invokeImport: () => Promise<OverlayThemeImportResult>,
    /**
     * 成功したときに**貼り付け欄も空へ戻すか**。⚠ 貼り付け経路だけ `true`
     * （ファイル取り込みで貼りかけの本文を消さないため・security-review② 品質 #1）。
     */
    clearPastedCss: boolean,
  ) => {
    setBusy(true);
    setError(null);
    try {
      const result = await invokeImport();
      // ⚠ 同名でもブロックしない（`name` に UNIQUE を張らない 060b の設計・重複警告は UI の責務）。
      const duplicateName = themes.some((t) => t.name === result.theme.name);
      let loaded = await analyze(result.theme.id, result.truncatedToEof);

      // --- 060c: 外部 `@import` の同意・取得・保存し直し ------------------------------------
      let finalResult = result;
      const snapshotNotes: string[] = [];
      // ⚠ **1 回目の結果だけを束縛する**（無限ループ防止・上の注記）。
      const urls = result.strippedImportUrls;
      if (urls.length > 0 && requestThemeImport !== undefined) {
        if (loaded === null) {
          // 保存した CSS を読めないと予算も計算できないし、連結する土台も無い。fail-closed。
          snapshotNotes.push(
            "保存した CSS を読み取れなかったため、外部デザインの取り込みは行いませんでした。",
          );
        } else if (themes.length + 1 >= THEME_MAX_COUNT) {
          // ⚠⚠ **同意ダイアログを出す前に**上限を見る。取得してから保存で落ちると、
          // ユーザーには「同意したのに失敗した」としか見えない（帯域も同意も無駄になる）。
          snapshotNotes.push(
            "デザインの登録数が上限のため、外部デザインは取り込みませんでした。不要なデザインを削除してから取り込み直してください。",
          );
        } else {
          const { fetched, notes } = await runConsentLoop(
            urls,
            cssByteLength(loaded.css),
            requestThemeImport,
          );
          snapshotNotes.push(...notes);
          if (fetched.length > 0) {
            // ⚠ 取得 CSS を**前置**する（`@import` は先頭にしか書けない＝原位置と等価）。
            const composed = [...fetched, loaded.css].join(SNAPSHOT_JOINER);
            try {
              const snapshot = await importOverlayThemeSnapshot(
                composed,
                result.theme.name, // ⚠ 名前はそのまま引き継ぐ（ユーザーには変わって見えない）。
              );
              // 保存できたので、除去版を消す。⚠ **best-effort**——失敗しても throw しない
              // （2 件見えるのは可視の故障で、ユーザーが消せる）。
              try {
                await deleteOverlayTheme(result.theme.id);
              } catch {
                snapshotNotes.push(
                  "取り込み前の状態のデザインが 1 件残りました。不要であれば削除してください。",
                );
              }
              // 選択中が旧 id を指していたら張り替える。
              // ⚠ **現状この条件は成立しない**（security-review 060c Q-6）——`result.theme.id` は
              // 採番直後の uuid v4 で、取り込み経路は `selectedId` に触らない（`select` の注記）。
              // 残しているのは「取り込んだテーマを自動選択する」変更が入った瞬間に、
              // **削除済み id を選択したままになる**故障を防ぐため。消さないこと。
              if (selectedId === result.theme.id) select(snapshot.theme.id);
              finalResult = snapshot;
              loaded = await analyze(snapshot.theme.id, snapshot.truncatedToEof);
              snapshotNotes.push(
                `外部デザインを ${fetched.length} 件取り込みました（以後この通信は行いません）。`,
              );
            } catch (e) {
              // ⚠ 保存に失敗しても**除去版は残っている**＝取り込み自体は成功のまま。
              snapshotNotes.push(toErrorMessage(e));
            }
          }
        }
      }

      // --- 060c: フォントの案内（060h を待たずに出す） --------------------------------------
      const fontNames = collectFontNames(
        loaded?.css ?? "",
        finalResult.strippedImportUrls,
      );
      const fontNote =
        fontNames.total > 0 || /@font-face/i.test(loaded?.css ?? "")
          ? fontAdviceText(fontNames)
          : null;

      setOutcome({
        result: finalResult,
        analysis: loaded?.analysis ?? null,
        duplicateName,
        snapshotNotes,
        fontNote,
      });
      backToPasteForm();
      if (clearPastedCss) setCssInput("");
      await reload();
    } catch (e) {
      // Rust が返す固定文言をそのまま出す（@media のプレリュード拒否など）。⚠ frontend で書き直さない。
      setError(toErrorMessage(e));
    } finally {
      setBusy(false);
      // ⚠ 例外で抜けたときに同意ダイアログが出たままにならないようにする。
      setConsent((current) => {
        current?.resolve(false);
        return null;
      });
    }
  };

  const runRename = async (id: string, name: string) => {
    setBusy(true);
    setError(null);
    try {
      await renameOverlayTheme(id, name);
      backToPasteForm();
      await reload();
    } catch (e) {
      setError(toErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const submitForm = () => {
    if (nameError !== null) return;
    const name = effectiveName;
    if (form.kind === "paste") {
      if (cssError !== null) return;
      // ⚠ 本文はここでしか触らない（state → invoke の 1 経路だけ）。ログにも画面にも出さない（§9）。
      void runImport(() => importOverlayThemeText(cssInput, name), true);
    } else if (form.kind === "import") {
      // ⚠ 第 2 引数 false ＝ **貼りかけの本文を消さない**（ファイル取り込みは別経路）。
      void runImport(() => importOverlayTheme(form.path, name), false);
    } else {
      void runRename(form.id, name);
    }
  };

  const runDelete = async (theme: OverlayThemeRecord) => {
    setBusy(true);
    setError(null);
    try {
      await deleteOverlayTheme(theme.id);
      // ⚠ 選択中を消したら必ず既定へ戻す（消えたテーマを指したままにすると復帰不能に見える）。
      if (selectedId === theme.id) select(null);
      if (outcome?.result.theme.id === theme.id) setOutcome(null);
      setPendingDelete(null);
      await reload();
    } catch (e) {
      setError(toErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  // ⚠ 保存済み id が一覧に無い＝テーマが消えている。**黙って既定へ倒さず UI で気付かせる**
  // （058a の「以前選んだデバイスが見つかりません」と同型）。⚠ 読み込み中は判定しない（一瞬必ず赤くなる）。
  const selectedMissing =
    selectedId !== null &&
    listState === "ready" &&
    !themes.some((t) => t.id === selectedId);

  // --- プレビュー ---------------------------------------------------------------------------
  // ⚠ **開いている間だけ `<style>` を置く**。`@font-face` の family 名と `@keyframes` の名前は
  // スコープ化できず文書グローバルなので、露出する時間を明示操作の間だけに限る（cssScope.ts の既知の限界）。
  const [previewCss, setPreviewCss] = useState<string | null>(null);
  // ⚠ **プレビューの対象は「選択中」のテーマだけ**（取り込んだ直後のテーマではない）。
  // ＝ 060e の「貼って押すだけ」で入れたものを確かめるには、いったん選択する（＝配信へ反映する）必要がある。
  // いま分けていない理由: プレビューの対象を `selectedId` 以外にすると
  // 「いま配信に出ている意匠」と「枠の中の意匠」が食い違い、**枠が本番の見本である**という前提が壊れる
  // （壊れたテーマからの脱出判断を枠の見た目でしている以上、ここを二重化したくない）。
  // ⚠ 再修正トリガー＝「適用せずに試したい」という要望が実機確認で出たら、
  // **選択とは独立した「プレビュー対象」state を足す**こと（`select()` の意味は変えない）。
  const previewThemeId = previewOpen && !selectedMissing ? selectedId : null;

  // ⚠ **切替時に「先に外す」ことをしない**のは意図（security-review Q-7）。`previewCss` を先に `null` へ
  // 落とさないので、新しい CSS が届くまで**古いスタイルが残る**。`OverlayApp` の注入は逆に「先に外す」
  // ——同じ製品内で方針が分かれているので理由を書いておく:
  //   - `OverlayApp` は**配信に載る**ので、取得に失敗したときに前のテーマが残ると
  //     「表示と選択状態が食い違う」ほうが害。だから先に外す（一瞬既定へ戻る）。
  //   - ここは**設定画面の見本**なので、切り替えのたびに枠が既定意匠へ点滅するほうが害。
  //     取得に失敗すれば下の `.catch` が `null` にするので、古い CSS が残り続けることはない。
  // 再修正トリガー＝プレビューでも「失敗時に前のテーマが残って見える」ことが問題になったら、
  // 先頭で `setPreviewCss(null)` を呼ぶ形へ揃えること。
  useEffect(() => {
    if (previewThemeId === null) {
      setPreviewCss(null);
      return;
    }
    let cancelled = false;
    getOverlayThemeCss(previewThemeId)
      .then((css) => {
        if (cancelled) return;
        // 注入と同じ変換を通してから、プレビューのラッパ配下へ閉じ込める。
        // ⚠⚠ 060f 追修正(2026-08-08): 既定意匠のリセット（`withDecorationReset`）を**スコープ化の前**に
        //   前置する。順序が要点——後に連結すると**リセットだけが `.sd-preview` の外へ漏れて**
        //   コメビュ窓全体に効いてしまう。前に置けば `scopeSelectors` がこれも配下へ閉じ込める。
        // ⚠ 配信窓（`OverlayApp`）と**両方**通すこと。片方だけだとプレビューと本番で見え方が食い違い、
        //   しかも jsdom はカスケードを解決しないのでテストでは気付けない（静的ガード (10-m) が固定）。
        setPreviewCss(
          scopeSelectors(
            withDecorationReset(rewriteSelectors(css).css),
            PREVIEW_SCOPE_SELECTOR,
          ),
        );
      })
      .catch(() => {
        if (!cancelled) setPreviewCss(null);
      });
    return () => {
      cancelled = true;
    };
  }, [previewThemeId]);

  useEffect(() => {
    if (previewCss === null) return;
    const el = document.createElement("style");
    el.dataset.sdPreviewTheme = "";
    // ⚠ ここも `textContent` のみ（`</style>` を含む CSS でも DOM を壊せない）。
    el.textContent = previewCss;
    document.head.appendChild(el);
    return () => {
      el.remove();
    };
  }, [previewCss]);

  const unmatchedView = useMemo(
    () => clampUnmatched(outcome?.analysis?.unmatched ?? []),
    [outcome],
  );

  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>コメントのデザイン</div>
      <div className={styles.cardBody}>
        <span className={styles.note}>
          OBSに表示するコメントの見た目を、自分で用意した CSS
          ファイルに差し替えられます。取り込んだ CSS
          は端末内に保存され、外部へ送信されることはありません。
        </span>

        <div className={styles.speakerField}>
          <span className={styles.fieldLabel}>使うデザイン</span>
          <ul className={styles.themeList}>
            <li>
              <label className={styles.themeRow}>
                <input
                  type="radio"
                  name="sd-overlay-theme"
                  checked={selectedId === null}
                  onChange={() => select(null)}
                />
                <span className={styles.themeName}>
                  既定（StreamDock 標準）
                </span>
              </label>
            </li>
            {themes.map((theme) => (
              <li key={theme.id}>
                <div className={styles.themeRow}>
                  <label className={styles.themeRowMain}>
                    <input
                      type="radio"
                      name="sd-overlay-theme"
                      checked={selectedId === theme.id}
                      onChange={() => select(theme.id)}
                    />
                    <span className={styles.themeName}>{theme.name}</span>
                  </label>
                  <button
                    type="button"
                    className={styles.btnGhost}
                    onClick={() => startRename(theme)}
                    disabled={busy}
                  >
                    名前を変更
                  </button>
                  <button
                    type="button"
                    className={styles.btnGhost}
                    onClick={() => setPendingDelete(theme)}
                    disabled={busy}
                  >
                    削除
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>

        {listState === "failed" && (
          <span className={styles.errorText}>
            取り込み済みのデザイン一覧を読み込めませんでした。設定を開き直してください。
          </span>
        )}
        {selectedMissing && (
          <span className={styles.errorText}>
            選択中のデザインが見つかりません。「既定のデザインに戻す」を押すか、デザインを選び直してください。
          </span>
        )}

        {/* ⚠⚠ 壊れたテーマからの唯一の脱出路。**常に出す・常に押せる**（一覧が読めなくても押せること）。 */}
        <div className={styles.voicevoxRow}>
          <button
            type="button"
            className={styles.btn}
            onClick={() => select(null)}
            title="StreamDock 標準のデザインに戻します"
          >
            既定のデザインに戻す
          </button>
        </div>
        {/* ⚠⚠ 060f 追修正②(2026-08-08): **「テーマを選ぶと既定の装飾が引っ込む」ことを説明する唯一の場所。**
            リセット（`overlayThemeReset.ts`）が吹き出しの背景・枠・角丸・影・しっぽを止めるので、
            色だけ変えるデザインを入れた人には**何も知らないと「取り込んだら壊れた」としか見えない**。
            ⚠ 「吹き出しが無いデザインも当てられる」ことの告知でもある（本人要望・2026-08-08）。
            ⚠⚠ **並び順は意図（レビュー指摘 Q-6・2026-08-08）**——この 1 本を脱出路の案内より**前**に置く。
            ユーザーが頼んでいない挙動変更を告げるのがこれで、脱出路の案内は「何が起きるか」を
            知った後でなければ意味を持たないため。 */}
        <span className={styles.note}>
          デザインを選ぶと、StreamDock
          標準の吹き出し（背景・枠・しっぽ）は使われません。選んだデザインの指定だけが反映されるので、背景を指定していないデザインでは文字がそのまま映像の上に出ます。
        </span>
        {/* ⚠⚠ 060f 追修正④(2026-08-08・本人決定): **「スパチャは変わらない」ことを説明する唯一の場所。**
            配布テーマの多くは「スーパーチャット非表示」を含んでおり（純正チャットはティッカーにも出るため）、
            以前はそれが StreamDock の課金カードにも効いて**カードが丸ごと消えていた**。
            課金カードをユーザー CSS の的から外して直したが、⚠ **黙って直すと今度は
            「デザインを変えたのにスパチャだけ変わらない＝効いていない」と誤解される**ので明示する。 */}
        <span className={styles.note}>
          スーパーチャットなどの課金コメントは、デザインを選んでも
          StreamDock 標準の見た目のまま表示されます（取り込んだデザインの影響を受けません）。
        </span>
        <span className={styles.note}>
          コメントが表示されなくなったときは「既定のデザインに戻す」で元に戻せます。
        </span>
        {/* ⚠ 060f 追修正③(2026-08-08): アイコンとのすき間はテーマ適用中 8px に詰めている
            （既定の 28px の内訳＝しっぽの突き出し 20px ＋ 素のすき間 8px のうち、描かなくなる 20px を返す）。
            しっぽが 8px より長いデザインではアイコンに重なるので、逃げ道をここに書いておく。
            ⚠ この 1 文が無いと、ユーザーは「重なる」を直す手段（`--sd-icon-gap`）に到達できない。
            ⚠ レビュー指摘 Q-7(2026-08-08): **`<code>` は使わない**——このアプリで `code` にスタイルが
            当たるのは `UpdateScreen.module.css` の `.notesBody code` だけ（別スコープ）なので、ここでは
            UA 既定の等幅フォントが素で出て周囲の `.note` と書体もサイズも食い違う。素の文字列＋「」に揃える
            （このファイルの他の注記・プレースホルダと同じ作法）。 */}
        <span className={styles.note}>
          しっぽ付きのデザインでアイコンと重なるときは、CSS
          に「.sd-comment {"{"} --sd-icon-gap: 28px; {"}"}」を足すと間隔を広げられます。
        </span>

        {/* 034e の「フォント」「サイト名」と同じく、同一 localStorage 経由でオーバーレイ窓へ伝わる。
            ⚠ 別 webview 間の storage 伝播は**プラットフォーム依存でベストエフォート**なので、
            届かなかったときの手順（開き直し）を書いておく。可視文言はツールバーのトグルと同一（045a）。 */}
        <span className={styles.note}>
          デザインの変更は、OBSに表示中のコメントへすぐ反映されます。反映されないときは、コメント画面上部の「コメントをOBSに表示」を一度
          OFF にしてから ON にし直してください。
        </span>

        {/* --- 取り込み ------------------------------------------------------------------
            ⚠⚠ 060e: **主導線は「貼り付けて取り込む」**。ユーザーに `.css` ファイルを作らせない。
            保存先・ファイル名・サニタイズはファイル版と**まったく同じ共通コア**（Rust の
            `store_sanitized_css`）が受け持つので、ここは本文と名前を渡すだけ。
            ⚠ ファイル選択は**副導線として残す**（既に `.css` を持っている人の手数が増えないように）。 */}
        {form.kind === "paste" && (
          <div className={styles.speakerField}>
            <span className={styles.fieldLabel}>CSSを貼り付けて取り込む</span>
            {/* ⚠ `disabled={busy}` は**取り込み中に打った続きが成功時のクリアで消えない**ようにするため
                （security-review②・品質 #3）。他のボタンと同じ作法に揃えている。 */}
            <textarea
              className={styles.themeCssInput}
              value={cssInput}
              aria-label="CSS"
              spellCheck={false}
              disabled={busy}
              placeholder={".sd-comment { background: #fff; border-radius: 20px; }"}
              onChange={(e) => setCssInput(e.target.value)}
            />
            <div className={styles.fontRow}>
              <input
                className={styles.searchInput}
                type="text"
                value={nameInput}
                aria-label="デザインの名前"
                placeholder={autoName}
                onChange={(e) => setNameInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitForm();
                }}
              />
              <button
                type="button"
                className={styles.btn}
                onClick={submitForm}
                disabled={busy || nameError !== null || cssError !== null}
              >
                取り込む
              </button>
            </div>
            {/* ⚠ 空のうちはエラーを出さない（開いた直後に赤くしない）。押せないことで伝える。 */}
            {cssInput !== "" && cssError !== null && (
              <span className={styles.errorText}>{cssError}</span>
            )}
            {nameError !== null && (
              <span className={styles.errorText}>{nameError}</span>
            )}
            {duplicateWhileTyping && (
              <span className={styles.note}>
                同じ名前のデザインが既にあります（このまま進められます）。
              </span>
            )}
            <span className={styles.note}>
              名前を空のままにすると「{autoName}」で保存します。
            </span>
            <div className={styles.voicevoxRow}>
              <button
                type="button"
                className={styles.btnGhost}
                onClick={() => void startImport()}
                disabled={busy}
              >
                CSSファイルを取り込む…
              </button>
            </div>
          </div>
        )}
        {form.kind !== "paste" && (
          <div className={styles.speakerField}>
            <span className={styles.fieldLabel}>
              {form.kind === "import"
                ? `「${displayFileName(form.fileName)}」に名前を付ける`
                : "デザインの名前を変更する"}
            </span>
            <div className={styles.fontRow}>
              <input
                className={styles.searchInput}
                type="text"
                value={nameInput}
                aria-label="デザインの名前"
                onChange={(e) => setNameInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitForm();
                }}
              />
              <button
                type="button"
                className={styles.btn}
                onClick={submitForm}
                disabled={busy || nameError !== null}
              >
                {form.kind === "import" ? "取り込む" : "保存"}
              </button>
              <button
                type="button"
                className={styles.btnGhost}
                onClick={backToPasteForm}
                disabled={busy}
              >
                キャンセル
              </button>
            </div>
            {nameError !== null && (
              <span className={styles.errorText}>{nameError}</span>
            )}
            {/* ⚠ 同名は**警告するだけでブロックしない**（060b が `name` に UNIQUE を張らなかったのは
                「2 つ入れて見比べる」使い方があるため。判断はユーザーに残す）。 */}
            {duplicateWhileTyping && (
              <span className={styles.note}>
                同じ名前のデザインが既にあります（このまま進められます）。
              </span>
            )}
          </div>
        )}

        {error !== null && <span className={styles.errorText}>{error}</span>}

        {/* --- 取り込み結果 -------------------------------------------------------------- */}
        {outcome !== null && (
          <div className={styles.speakerField}>
            <span className={styles.fieldLabel}>取り込み結果</span>
            <span className={styles.note}>
              「{outcome.result.theme.name}」を取り込みました。
            </span>
            {outcome.result.theme.strippedCount > 0 && (
              <span className={styles.note}>
                取り込めない参照を {outcome.result.theme.strippedCount}{" "}
                件除去しました（外部サイトの画像やフォント、相対パスの指定などを含みます）。
              </span>
            )}
            {/* ⚠⚠ ここが「入れたのに書体しか変わらない」の説明。依頼者のサンプルは意匠の実体が
                外部 CSS の中にあるため、この 1 本が無いと**仕様どおりの挙動がバグに見える**。
                ⚠ URL そのものは出さない（§9・ホスト強調付きで出すのは 060c の同意ダイアログの責務）。
                ⚠ **「うち少なくとも N 件」と書く**（security-review Q-8）。`strippedImportUrls` は Rust 側で
                16 件上限＋「取得できて偽装できない形（http(s) 絶対 URL・エスケープ無し・bidi 無し）」に
                絞られているので、**真の @import 件数より少なくなりうる**（載せなかった分も
                `strippedCount` には数えられている）。「うち N 件」と言い切ると数が合わない場合がある。 */}
            {outcome.result.strippedImportUrls.length > 0 && (
              <span className={styles.note}>
                うち少なくとも {outcome.result.strippedImportUrls.length}{" "}
                件は外部サイトの CSS の読み込み（@import）です。StreamDock
                は外部サイトへ接続しないため、その中に書かれたデザインは反映されません。
              </span>
            )}
            {outcome.analysis !== null && outcome.analysis.rewritten > 0 && (
              <>
                <span className={styles.note}>
                  {outcome.analysis.rewritten} 個のルールを StreamDock
                  用に変換しました。
                </span>
                {/* ⚠ `rewritten` を単独で「成功件数」として見せない（060a レビュー Q-1）。
                    複合セレクタの一部だけが変換されたルールは、数えられたうえで当たらない。 */}
                <span className={styles.note}>
                  変換できたルールでも、指定の一部が StreamDock
                  に無い要素を指していると反映されないことがあります。
                </span>
              </>
            )}
            {outcome.analysis !== null &&
              outcome.analysis.unmatched.length > 0 && (
                <span className={styles.note}>
                  {outcome.analysis.unmatched.length}{" "}
                  種類のセレクタは変換できませんでした（この指定は反映されません）:{" "}
                  {unmatchedView.shown.join(" / ")}
                  {unmatchedView.rest > 0 && ` ほか ${unmatchedView.rest} 件`}
                </span>
              )}
            {outcome.analysis === null && (
              // ⚠ `analyze` が失敗すると変換件数も未変換セレクタも出せない。**黙って結果パネルが縮む**と
              // 「出るときと出ないときがある」としか見えないので、読めなかったことを明示する
              // （security-review Q-6・一覧の loading / ready / failed を 3 分岐にしたのと同じ考え方）。
              <span className={styles.note}>
                取り込みは完了しましたが、保存した CSS
                の内容を確認できませんでした（変換の件数は表示できません）。
              </span>
            )}
            {outcome.analysis?.truncated === true && (
              // ⚠ 060b review② Q-3。対応の取れていない `(` があると、そこから末尾までが 1 宣言として
              // 除去され、参照が 1 つでもあれば**ファイルの残り全部が消える**（除去件数は 1 のまま）。
              // ⚠ 文言で原因を**括弧に断定しない**（security-review Q-2）。同じ症状は未終端の
              // `@import url(` やクォートの閉じ忘れでも起きるし、そちらは `unclosedBlockDepth` では
              // 検出できない（見落とす失敗モードの詳細は cssScope.ts の `unclosedBlockDepth` の注記）。
              <span className={styles.errorText}>
                CSS
                の大部分が取り込めていない可能性があります。括弧やクォートの対応が取れているか確認してください。
              </span>
            )}
            {/* 060c: 外部 `@import` の取得についてのメモ（同意しなかった／取得できなかった／取得した件数）。
                ⚠ URL も理由の詳細もここには出さない（§9）。出すのは「何が起きたか」と「次に何をすればよいか」。 */}
            {/* ⚠ key は index（本文をキーにすると同文言が 2 件出たとき React が警告する・Q-9）。
                並びは固定で並べ替えも挿入も起きないので index で問題ない。 */}
            {outcome.snapshotNotes.map((note, i) => (
              <span key={i} className={styles.note}>
                {note}
              </span>
            ))}
            {/* 060c: フォントの案内。⚠ **060h を待たずに出す**——§1 を一切曲げずに
                「なぜ書体だけ変わらないのか」と「次に何をすればよいか」を伝えられる唯一の手段。 */}
            {outcome.fontNote !== null && (
              <span className={styles.note}>{outcome.fontNote}</span>
            )}
            {outcome.duplicateName && (
              <span className={styles.note}>
                同じ名前のデザインが既にあります。区別しにくいときは名前を変更してください。
              </span>
            )}
          </div>
        )}

        {/* --- プレビュー ---------------------------------------------------------------- */}
        <ToggleSwitch
          label="プレビューを表示する"
          checked={previewOpen}
          onChange={setPreviewOpen}
        />
        {previewOpen && (
          <>
            <div className={styles.themePreview}>
              {/* ⚠ ラッパは**素の文字列クラス**（CSS モジュールのハッシュ名では前置した文字列と一致しない）。
                  060a が CSS 変数の既定値を「参照側の var(--sd-X, 現行値) フォールバック」に置いたので、
                  `.root` の外にあるこのラッパ配下でも既定意匠がそのまま保たれる。 */}
              <div
                className={PREVIEW_SCOPE_CLASS}
                style={{ fontFamily: resolveOverlayFontStack(overlayFont) }}
              >
                <CommentList
                  comments={PREVIEW_COMMENTS}
                  showCount={false}
                  variant="overlay"
                  showSource={overlayShowSource}
                />
              </div>
            </div>
            <span className={styles.note}>
              実際の配信では背景・大きさ・並ぶ件数が異なるため、だいたいの見え方を確かめるためのものです。
            </span>
          </>
        )}
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="デザインを削除しますか？"
        message={
          pendingDelete === null
            ? ""
            : `「${pendingDelete.name}」を削除します。取り込んだ CSS も端末から削除され、元に戻せません。`
        }
        confirmLabel="削除"
        danger
        busy={busy}
        onConfirm={() => {
          if (pendingDelete !== null) void runDelete(pendingDelete);
        }}
        onCancel={() => setPendingDelete(null)}
      />

      {/* --- 060c: 外部 `@import` の取得同意 -----------------------------------------------
          ⚠⚠ **宛先を allow-list で固定できない**（ユーザーが持ち込んだ CSS に書かれた URL）ので、
          **毎回の明示同意が唯一の担保**である。したがって:
          - **「今後確認しない」は作らない**（作った瞬間に担保が消える）
          - **既定はキャンセル側**（`ConfirmDialog` の autoFocus）
          - **取得先ホストを別行で強調**する（`https://ruri.info@evil.example/a.css` は正当な URL なので
            Rust 側では弾いておらず、完全な URL を素で出すと先頭を信じられる・060b review② S-6）
          - **表示する URL と送信する URL は同じ 1 変数**（`consent.url`）。組み立て直さない。 */}
      <ConfirmDialog
        open={consent !== null}
        title="外部からデザインを取得しますか？"
        message={
          consent === null
            ? ""
            : "取り込んだ CSS は、次のアドレスにあるデザインを読み込む指定を含んでいます。"
        }
        details={
          consent === null ? null : (
            <div className={styles.speakerField}>
              <span className={styles.fieldLabel}>取得先ホスト</span>
              <strong className={styles.note}>{consentHost(consent.url)}</strong>
              <span className={styles.fieldLabel}>完全なアドレス</span>
              {/* ⚠ 表示は clamp する（2048 文字の URL でダイアログを壊さない）。
                  ⚠⚠ **送信するのは clamp 前の `consent.url`** なので、省略したときはその旨も出す。 */}
              <span className={styles.note}>
                {clampDisplayText(consent.url, CONSENT_URL_MAX_CHARS)}
              </span>
              {[...consent.url].length > CONSENT_URL_MAX_CHARS && (
                <span className={styles.note}>
                  （アドレスが長いため表示を省略しています）
                </span>
              )}
              <span className={styles.note}>
                StreamDock が<strong>この 1 回だけ</strong>
                このアドレスから CSS を取得します。取得した内容はデザインに保存され、
                <strong>以後は通信しません</strong>。
              </span>
              <span className={styles.note}>
                取得しない場合、この指定は取り除かれ、そのぶんのデザインは反映されません。
              </span>
              <span className={styles.note}>
                取得した内容に含まれる外部の画像・フォントは取り込まれません。
              </span>
              <span className={styles.note}>
                （{consent.total} 件中 {consent.index} 件目）
              </span>
            </div>
          )
        }
        confirmLabel="取得する"
        cancelLabel="取得しない"
        onConfirm={() => settleConsent(true)}
        onCancel={() => settleConsent(false)}
      />
    </div>
  );
}
