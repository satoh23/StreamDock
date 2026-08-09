import { useCallback, useState } from "react";
import { rewriteSelectors } from "../../features/comment-viewer/cssCompat";
import { unclosedBlockDepth } from "../../features/comment-viewer/cssScope";
import {
  attachOverlayThemeFonts,
  cssByteLength,
  deleteOverlayTheme,
  getOverlayThemeCss,
  importOverlayThemeSnapshot,
  THEME_CSS_MAX_BYTES,
  THEME_FONT_MAX_COUNT,
  THEME_FONT_MAX_ONE_BYTES,
  THEME_FONT_MAX_TOTAL_BYTES,
  THEME_MAX_COUNT,
  type OverlayThemeImportResult,
  type OverlayThemeRecord,
} from "../../features/comment-viewer/overlayThemeApi";
import type {
  ThemeFontFetchResult,
  ThemeImportFetchResult,
} from "../../features/comment-viewer/commentStream";
import { toErrorMessage } from "../../features/tools/useTools";
import {
  buildFontFaceCss,
  collectFontNames,
  collectUsedFontFamilies,
  consentHost,
  fontAdviceText,
  selectFontFaces,
  type FontPick,
} from "./overlayThemeCard.helpers";

/**
 * 060h コミット 1（2026-08-09）: `OverlayThemeCard.tsx` から**取り込みと解析**を切り出したフック。
 *
 * ⚠⚠ **このファイルは「分割だけ」のコミットで作られた＝ロジックは 1 文字も変えていない。**
 * 分割の境界は 060c の security-review Q-1 が指定したもの（`OverlayThemeCard.tsx` の module doc に
 * 「分割するときの境界は決まっている」として書かれていた②）で、そのとおりに切ってある。
 *
 * ⚠ **その「振る舞い差分ゼロ」はコミット単位の主張である**（060h review Q-6）。
 * 段 1（分割）→ 段 2（sidecar の切り出し）→ 段 3（本体）を 1 本の差分にまとめて見ると、
 * `OverlayThemeCard.test.tsx` には**削除行がある**（060c の「同意ループを再起動しない」＝深さ 1 の
 * 不変条件テストを、060h が深さ 2 へ変えたので `MAX_IMPORT_ROUNDS` のテストへ置き換えた）ため、
 * 差分だけからは段 1 の無変更を確かめられない。**分割コミットのまま残すこと**が唯一の担保である。
 *
 * ## 何を持ち、何を持たないか
 *
 * - **持つ**: 取り込み結果（`outcome`）と、060c の同意ダイアログ 1 件分（`consent`）。
 *   どちらも「取り込みという 1 つの流れ」の中でしか意味を持たない state なので、流れと一緒に置く。
 * - **持たない**: `busy` / `error` / テーマ一覧 / 選択中 id / 入力フォーム。
 *   ⚠ とくに `busy` と `error` は**改名・削除でも使う**ので、ここへ移すと
 *   「フックが持つ state を改名処理が setter 経由で書く」というねじれた依存ができる。
 *   カード側に置いたまま setter を受け取る形にしてある。
 *
 * ⚠ **`document` を触らない**（プレビューの `<style>` 注入はカード側の責務）。
 * 静的ガード (10-i) / (10-m) が `OverlayThemeCard.tsx` に `createElement("style")` と
 * `withDecorationReset` が**在ること**を要求しているので、そこは動かせない。
 */

/** 取り込み結果のうち、**保存後の CSS からその場で計算する**ぶん（DB には持たない＝ 060b の決定）。 */
export interface CssAnalysis {
  rewritten: number;
  unmatched: string[];
  /** 対応の取れていない `(` 等で、CSS の残りが丸ごと落ちた疑いがあるか。 */
  truncated: boolean;
}

/** 取り込み直後に表示する結果（⚠ `strippedImportUrls` を含む丸ごとを持つ＝ 060c の同意ダイアログの受け皿）。 */
export interface ImportOutcome {
  result: OverlayThemeImportResult;
  analysis: CssAnalysis | null;
  duplicateName: boolean;
  /** 060c: 外部 `@import` の取得についてユーザーへ伝えること（同意しなかった／取得できなかった等）。 */
  snapshotNotes: string[];
  /** 060c: フォントの案内（060h を待たずに出す）。⚠ 書体を取り込めたときは `null`（Q-2）。 */
  fontNote: string | null;
  /**
   * 060h review Q-2: **実際に取り込めた外部 CSS の件数。**
   *
   * ⚠ 結果パネルの「StreamDock は外部サイトへ接続しないため…」という注記を出すかの判定に使う。
   * 1 件でも取り込めていたらその文言は事実と正反対になるので出さない
   * （打ち切りの説明は `snapshotNotes` 側が持つ）。
   */
  fetchedCssCount: number;
}

/**
 * 060c: 同意ダイアログの 1 件分。
 *
 * ⚠⚠ **`url` は Rust が返した文字列そのもの**で、ここから先も**組み立て直さない**。
 * 画面に出すのも sidecar へ送るのも同じこの 1 変数で、「表示した URL と取得する URL が同一」を
 * 変数の同一性で担保している（テストで固定）。
 */
export type ConsentRequest =
  | {
      kind: "css";
      url: string;
      index: number;
      total: number;
      /**
       * 060h: 何段目の取得か（1＝ユーザー CSS の `@import`／2＝そこで取得した CSS の中の `@import`）。
       * ⚠ 2 段目は「**1 段目で取得した内容が参照している別のアドレス**」であることを必ず明示する。
       */
      round: number;
      resolve: (accepted: boolean) => void;
    }
  | {
      /**
       * 060h: フォント実体の取得（**ホスト単位で 1 枚**）。
       *
       * ⚠⚠ **ここだけ「完全な URL を全部は出さない」**——日本語 1 ファミリで約 110 本になり、
       * 110 枚のダイアログは同意として機能しない（クリック疲れで担保が空洞化する）。
       * **代替の担保**: ①ここに出すホスト集合は**実際に取得する URL 群から導出**したものそのもの
       * ②取得ループは `urls` 以外を 1 本も送らない ③sidecar 側が 1 本ごとに専用ガードを通す。
       */
      kind: "fonts";
      /** 取得先ホスト（重複排除・**強調して全部**出す）。 */
      hosts: string[];
      /** 実際に取得する URL（**`strippedFontUrls` の部分集合**）。 */
      urls: string[];
      /** 候補の総数（上限で見送るぶんを含む）。 */
      total: number;
      resolve: (accepted: boolean) => void;
    };

/**
 * 060c: 取得結果を連結するときの区切り。
 *
 * ⚠ 改行 1 つで足りるが**予算計算に必ず含める**こと（`\n` を足したぶんで 256KB を 1 バイト超えると、
 * 同意も取得も済ませたあとに保存だけが落ちる）。
 */
const SNAPSHOT_JOINER = "\n";

/**
 * 060h: **`@import` を辿ってよい段数**（＝保存ラウンドの回数）。
 *
 * ⚠⚠ **深さは「この定数 1 つ」で決まる。** 実サンプルの構造が
 * `ユーザー CSS` → `ruri.info/…css`（1 段目）→ `@import fonts.googleapis.com`（2 段目）→
 * `@font-face src: fonts.gstatic.com/….woff2`（フォント）なので、
 * **深さ 1（060c）では Google Fonts の CSS に到達できず書体が 1 バイトも入らない**。
 * 3 段目以降は実在の用途が無く、宛先ホストと同意回数だけが増えるので追わない。
 *
 * ⚠ **無限ループしない理由**: 各ラウンドの候補は「前ラウンドで取得したテキスト由来のもの」だけになる
 * ——保存済み CSS からは `@import` が既に除去されているので、同じ宛先が再登場しない。
 */
const MAX_IMPORT_ROUNDS = 2;

/** base64 文字列が表す**生バイト数**（予算は生バイトで測る）。 */
function rawBytesOfBase64(base64: string): number {
  return Math.floor((base64.length * 3) / 4);
}

interface UseThemeImportParams {
  themes: readonly OverlayThemeRecord[];
  selectedId: string | null;
  select: (id: string | null) => void;
  reload: () => Promise<void>;
  setBusy: (busy: boolean) => void;
  setError: (message: string | null) => void;
  /**
   * 取り込みが**成功して結果を表示したあと**にカード側のフォームを片付けるためのコールバック。
   * ⚠ 引数は「貼り付け欄も空へ戻すか」（貼り付け経路だけ `true`）。
   */
  onImported: (clearPastedCss: boolean) => void;
  /**
   * 060c: 外部 `@import` を sidecar に **1 本だけ**取得させる（スナップショット）。
   * ⚠ 未指定なら外部取得の導線ごと出さない（＝取り込みは従来どおり `@import` を除去して成功する＝ fail-closed）。
   */
  requestThemeImport?: (
    url: string,
    maxBytes: number,
  ) => Promise<ThemeImportFetchResult>;
  /**
   * 060h: `@font-face` の `src` が指すフォント実体を **1 本だけ**取得させる。
   * ⚠ 未指定ならフォント段ごと出さない（＝ 060c までの挙動＝ fail-closed）。
   */
  requestThemeFont?: (
    url: string,
    maxBytes: number,
  ) => Promise<ThemeFontFetchResult>;
}

export function useThemeImport({
  themes,
  selectedId,
  select,
  reload,
  setBusy,
  setError,
  onImported,
  requestThemeImport,
  requestThemeFont,
}: UseThemeImportParams) {
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);
  /** 060c: 表示中の同意ダイアログ（1 件ずつ・`null` なら出ていない）。 */
  const [consent, setConsent] = useState<ConsentRequest | null>(null);

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
  const askConsent = (url: string, index: number, total: number, round: number) =>
    new Promise<boolean>((resolve) => {
      setConsent({ kind: "css", url, index, total, round, resolve });
    });

  /**
   * 060h: **フォント実体の取得**に同意を求める（ホスト単位で 1 枚）。
   *
   * ⚠⚠ 1 件ずつにしないのは、日本語 1 ファミリで約 110 本になるため。
   * 110 枚のダイアログはユーザーが読まずに押すので、**担保としては 1 枚のほうが強い**。
   * ⚠ 出すのは「取得先ホスト（全部・強調）」「件数」「上限」で、
   * **実際に取得するのはここへ渡した `urls` だけ**である。
   */
  const askFontConsent = (hosts: string[], urls: string[], total: number) =>
    new Promise<boolean>((resolve) => {
      setConsent({ kind: "fonts", hosts, urls, total, resolve });
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
    /** 060h: 何段目か（ダイアログの文言だけが変わる）。 */
    round: number,
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
      const accepted = await askConsent(urls[i], i + 1, urls.length, round);
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

      // --- 060c/060h: 外部 `@import` の同意・取得・保存し直し（**深さ 2 まで**）---------------
      let finalResult = result;
      const snapshotNotes: string[] = [];
      /** いま保存されている（＝次に消す対象の）テーマ id。 */
      let currentId = result.theme.id;
      /** 次のラウンドで同意を求める `@import` 先。⚠ **保存し直すたびに差し替わる**。 */
      let pendingImportUrls: readonly string[] = result.strippedImportUrls;
      /** 060h: フォントの取得候補（**Rust の一覧の和集合**。ここで URL を組み立てたりしない）。 */
      const fontFaces = [...result.strippedFontFaces];
      let fetchedCssCount = 0;

      if (requestThemeImport !== undefined) {
        for (let round = 1; round <= MAX_IMPORT_ROUNDS; round++) {
          if (pendingImportUrls.length === 0) break;
          if (loaded === null) {
            // 保存した CSS を読めないと予算も計算できないし、連結する土台も無い。fail-closed。
            snapshotNotes.push(
              "保存した CSS を読み取れなかったため、外部デザインの取り込みは行いませんでした。",
            );
            break;
          }
          if (themes.length + 1 >= THEME_MAX_COUNT) {
            // ⚠⚠ **同意ダイアログを出す前に**上限を見る。取得してから保存で落ちると、
            // ユーザーには「同意したのに失敗した」としか見えない（帯域も同意も無駄になる）。
            snapshotNotes.push(
              "デザインの登録数が上限のため、外部デザインは取り込みませんでした。不要なデザインを削除してから取り込み直してください。",
            );
            break;
          }
          const { fetched, notes } = await runConsentLoop(
            pendingImportUrls,
            cssByteLength(loaded.css),
            requestThemeImport,
            round,
          );
          snapshotNotes.push(...notes);
          if (fetched.length === 0) break;
          // ⚠ 取得 CSS を**前置**する（`@import` は先頭にしか書けない＝原位置と等価）。
          const composed = [...fetched, loaded.css].join(SNAPSHOT_JOINER);
          try {
            const snapshot = await importOverlayThemeSnapshot(
              composed,
              finalResult.theme.name, // ⚠ 名前はそのまま引き継ぐ（ユーザーには変わって見えない）。
            );
            // 保存できたので、1 つ前を消す。⚠ **best-effort**——失敗しても throw しない
            // （2 件見えるのは可視の故障で、ユーザーが消せる）。
            const previousId = currentId;
            try {
              await deleteOverlayTheme(previousId);
            } catch {
              snapshotNotes.push(
                "取り込み前の状態のデザインが 1 件残りました。不要であれば削除してください。",
              );
            }
            // 選択中が旧 id を指していたら張り替える。
            // ⚠ **現状この条件は成立しない**（security-review 060c Q-6）——`result.theme.id` は
            // 採番直後の uuid v4 で、取り込み経路は `selectedId` に触れない（`select` の注記）。
            // 残しているのは「取り込んだテーマを自動選択する」変更が入った瞬間に、
            // **削除済み id を選択したままになる**故障を防ぐため。消さないこと。
            if (selectedId === previousId) select(snapshot.theme.id);
            currentId = snapshot.theme.id;
            finalResult = snapshot;
            loaded = await analyze(snapshot.theme.id, snapshot.truncatedToEof);
            fetchedCssCount += fetched.length;
            // ⚠⚠ **次のラウンドの候補は「いま取得したテキスト由来のもの」だけ**になる——
            // 保存済み CSS からは `@import` が既に除去されているため。だから無限ループしない。
            pendingImportUrls = snapshot.strippedImportUrls;
            fontFaces.push(...snapshot.strippedFontFaces);
          } catch (e) {
            // ⚠ 保存に失敗しても**1 つ前は残っている**＝取り込み自体は成功のまま。
            snapshotNotes.push(toErrorMessage(e));
            break;
          }
        }
        if (fetchedCssCount > 0) {
          snapshotNotes.push(
            `外部デザインを ${fetchedCssCount} 件取り込みました（以後この通信は行いません）。`,
          );
        }
        if (pendingImportUrls.length > 0 && fetchedCssCount > 0) {
          // ⚠ **打ち切ったことを黙らない。** 「取り込んだのに一部が反映されない」を
          // 仕様どおりの挙動として説明できるのはここだけである。
          snapshotNotes.push(
            "取り込んだ外部デザインがさらに別のアドレスを参照していましたが、そこから先は取得していません。",
          );
        }
      }

      // --- 060h: フォント実体の同意・取得・別ファイルへの保存 --------------------------------
      // ⚠⚠ **取得できるのは `fontUrls`（＝ Rust のサニタイザが `@font-face` の `src` から拾ったもの）だけ。**
      // frontend は CSS から URL を抜き出さない——ここで正規表現を書き始めると
      // `background-image` まで拾える形になり、それは**トラッキングピクセルの取得経路**である。
      /**
       * 060h review Q-2: **書体を 1 件でも取り込めたか。**
       * 060c の `fontNote`（「StreamDock は外部からフォントを読み込みません」）は、これが真のとき
       * **出してはいけない**——取り込みに成功した直後に「読み込みません」と並ぶことになる。
       */
      let attachedFontCount = 0;
      if (fontFaces.length > 0 && requestThemeFont !== undefined && loaded !== null) {
        // ⚠⚠ **テーマが実際に使っているファミリだけ**に絞る（実サンプルは 6 ファミリを `@import` するが
        // 使っているのは 1〜2 ファミリ。絞らないと 10MB 超になり予算に入らない）。
        const selection = selectFontFaces(
          fontFaces,
          collectUsedFontFamilies(loaded.css),
          THEME_FONT_MAX_COUNT,
        );
        // ⚠ 候補の数え方は `selectFontFaces` と揃える（**1 ブロック 1 本**・060h review Q-5）。
        // URL 単位で数えると `src:url(a.woff2),url(b.woff)` が 2 件に見え、同意ダイアログの
        // 「N 件のうち M 件」が実際に取得する本数と食い違う。
        const candidateCount = fontFaces.filter((f) => f.urls.length > 0).length;
        if (selection.picks.length === 0) {
          // ⚠ 060h review Q-3。ここへ来るのは「候補はあるのに 1 本も選べなかった」＝
          // ファミリの絞り込みが全部落とした場合だけ。**黙って何も起きない**と、ユーザーには
          // 同意も案内も出ないまま書体だけが入らない状態になる（原因が見えない）。
          snapshotNotes.push(
            "このデザインが使っている書体を特定できなかったため、書体は取り込みませんでした。端末にインストールされていれば反映されます。",
          );
        }
        if (selection.picks.length > 0) {
          // ⚠ ホスト集合は**実際に取得する URL 群から導出する**（表示と取得先の対応をここで作る）。
          const urls = selection.picks.map((pick) => pick.url);
          const hosts = [...new Set(urls.map((url) => consentHost(url)))];
          const accepted = await askFontConsent(hosts, urls, candidateCount);
          if (!accepted) {
            snapshotNotes.push(
              "書体は取り込みませんでした。端末にインストールされていれば反映されます。",
            );
          } else {
            const got: { pick: FontPick; mime: string; base64: string }[] = [];
            let remaining = THEME_FONT_MAX_TOTAL_BYTES;
            let failed = 0;
            let rateLimited = 0;
            let offline = false;
            let budgetStopped = false;
            for (const pick of selection.picks) {
              const budget = Math.min(remaining, THEME_FONT_MAX_ONE_BYTES);
              if (budget <= 0) {
                budgetStopped = true;
                break;
              }
              // ⚠⚠ **`selection.picks` 以外は 1 本も送らない**（同意ダイアログのホスト集合の導出元）。
              const fetchedFont = await requestThemeFont(pick.url, budget);
              if (fetchedFont.ok) {
                got.push({
                  pick,
                  mime: fetchedFont.mime,
                  base64: fetchedFont.base64,
                });
                remaining -= rawBytesOfBase64(fetchedFont.base64);
              } else if (
                fetchedFont.reason === "offline" ||
                fetchedFont.reason === "busy"
              ) {
                // ⚠ 接続が落ちたら**残りは打ち切る**（100 本以上を空振りさせない）。
                offline = true;
                break;
              } else if (fetchedFont.reason === "rate") {
                rateLimited++;
              } else {
                failed++;
              }
            }
            if (got.length > 0) {
              try {
                await attachOverlayThemeFonts(currentId, buildFontFaceCss(got));
                attachedFontCount = got.length;
                snapshotNotes.push(
                  `書体を ${got.length} 件取り込みました（以後この通信は行いません）。`,
                );
              } catch (e) {
                // ⚠ 保存に失敗しても意匠は保存済み＝取り込み自体は成功のまま。
                snapshotNotes.push(toErrorMessage(e));
              }
            }
            // ⚠⚠ 060h review Q-4: **`droppedByFamily` をここに混ぜない。** 実サンプルは 6 ファミリ
            // （≒660 ブロック）のうち使うのが 1〜2 ファミリなので、混ぜると「合計サイズが上限に達した」
            // という**事実と違う案内が正常系で毎回出る**（サイズには 1 バイトも触れていない）。
            // 出すのは「要るのに取れなかった」ぶん＝予算打ち切り（`budgetStopped`）と本数上限だけ。
            if (budgetStopped || selection.droppedByCount > 0) {
              snapshotNotes.push(
                "書体の合計サイズが上限に達したため、一部の文字は端末のフォントで表示されます。",
              );
            }
            if (offline) {
              snapshotNotes.push(
                "書体の取得中に内部接続が切れたため、一部の書体は取り込めませんでした。",
              );
            }
            if (rateLimited > 0) {
              snapshotNotes.push(
                `書体の取得が短時間に集中したため、${rateLimited} 件は取得を見送りました。1 分ほど待ってから同じ CSS をもう一度取り込むと反映されます。`,
              );
            }
            if (failed > 0) {
              // ⚠ 理由の詳細（HTTP ステータス・URL）は出さない（§9）。
              snapshotNotes.push(
                `書体を ${failed} 件取得できませんでした（一部の文字は端末のフォントで表示されます）。`,
              );
            }
          }
        }
      }

      // --- 060c: フォントの案内（060h を待たずに出す） --------------------------------------
      // ⚠⚠ 060h review Q-2: **書体を取り込めたときは出さない。** この文言は
      // 「StreamDock は外部からフォントを読み込みません」と言い切るもので、060h が成功した直後は
      // **事実と正反対**になる（保存済み意匠 CSS には `src` を抜かれた `@font-face` が必ず残るので、
      // 条件を素のままにすると 060h の正常系で必ず出てしまう＝「取り込みました」と並ぶ）。
      // ⚠ 取り込めなかったとき（同意しなかった／導線が無い／全部失敗）は**引き続き出す**——
      // そこが「なぜ書体だけ変わらないのか」を説明する唯一の場所である。
      const fontNames = collectFontNames(
        loaded?.css ?? "",
        finalResult.strippedImportUrls,
      );
      const fontNote =
        attachedFontCount === 0 &&
        (fontNames.total > 0 || /@font-face/i.test(loaded?.css ?? ""))
          ? fontAdviceText(fontNames)
          : null;

      setOutcome({
        result: finalResult,
        analysis: loaded?.analysis ?? null,
        duplicateName,
        snapshotNotes,
        fontNote,
        fetchedCssCount,
      });
      onImported(clearPastedCss);
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

  return { outcome, setOutcome, consent, settleConsent, runImport };
}
