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
import {
  PREVIEW_SCOPE_CLASS,
  PREVIEW_SCOPE_SELECTOR,
  scopeSelectors,
  unclosedBlockDepth,
} from "../../features/comment-viewer/cssScope";
import {
  deleteOverlayTheme,
  getOverlayThemeCss,
  importOverlayTheme,
  importOverlayThemeText,
  listOverlayThemes,
  renameOverlayTheme,
  themeCssError,
  themeNameError,
  type OverlayThemeImportResult,
  type OverlayThemeRecord,
} from "../../features/comment-viewer/overlayThemeApi";
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
 * 800 行超あるが**いまは分割しない**。テストが `OverlayThemeCard.test.tsx` 1 本にコンポーネント境界で
 * 書かれており（60 件超）、分割は「テストが通ることの意味」を変えずに行えないため、コストが利益を上回る。
 * ⚠ **分割するときの境界は決まっている**: ①純関数＋定数（`clampUnmatched` / `baseName` /
 * `displayFileName` / `defaultThemeName` / `nextPastedName` / `PREVIEW_COMMENTS`・約 100 行）を
 * `overlayThemeCard.helpers.ts` へ ②取り込みと解析（`analyze` / `runImport` / `ImportOutcome`）を
 * `useThemeImport()` フックへ。これで UI 本体は 500 行台になる。
 * 再修正トリガー＝**060c の同意ダイアログを足して 1000 行を超えたら**、上の順で切ること。
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
 * ⚠ ユーザー CSS 由来の未署名文字列を**表示できる形へ潰す**。
 * 制御文字を落とし（引用符なしの属性値は `]` まで何でも拾うので改行も制御文字も入りうる）、
 * 空白を 1 個へ正規化し、**コードポイント単位**で切る（`slice` だとサロゲートペアを割る）。
 */
function clampUnmatched(list: readonly string[]): {
  shown: string[];
  rest: number;
} {
  const shown = list.slice(0, UNMATCHED_MAX_ITEMS).map((raw) => {
    // ⚠ **`\p{Cf}`（bidi / format 文字）も落とす**（security-review②・`displayFileName` と揃えた）。
    // ファイル名だけ bidi を落として `unmatched` を素で出すのは非対称で、同じ「表示偽装」が成立する。
    const flat = raw
      .replace(/[\p{Cc}\p{Cf}]/gu, "")
      .replace(/\s+/g, " ")
      .trim();
    const chars = [...flat];
    return chars.length > UNMATCHED_MAX_CHARS
      ? `${chars.slice(0, UNMATCHED_MAX_CHARS).join("")}…`
      : flat;
  });
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
  const flat = fileName
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  const chars = [...flat];
  return chars.length > FILE_NAME_MAX_CHARS
    ? `${chars.slice(0, FILE_NAME_MAX_CHARS).join("")}…`
    : flat;
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
    monetaryAmount: "￥1,000",
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
}

export function OverlayThemeCard({
  overlayFont,
  overlayShowSource,
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
    async (id: string): Promise<CssAnalysis | null> => {
      try {
        const css = await getOverlayThemeCss(id);
        const { rewritten, unmatched } = rewriteSelectors(css);
        // ⚠ 「取り込み前後のサイズ比」ではなく**閉じ忘れ**で判定する理由は cssScope.ts の
        // `unclosedBlockDepth` の注記を参照（比率だと正常系と病的ケースを区別できず、
        // かつ frontend は取り込み前のファイルを読む手段を持たない）。
        return { rewritten, unmatched, truncated: unclosedBlockDepth(css) > 0 };
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
   * 取り込みを実行する（**貼り付け版とファイル版で後処理を共有する**）。
   *
   * ⚠ 分けているのは `invokeImport`（どのコマンドを呼ぶか）だけ。結果の解析・同名警告・一覧の再取得は
   * 完全に同じで、**取り込み経路が増えても表示の作法が分岐しない**（Rust 側で検証を共通コアに寄せたのと同じ発想）。
   *
   * ⚠⚠ **060c への申し送り**: 外部 `@import` のスナップショットを実装するときは、
   * **`await invokeImport()` の直後・`setOutcome` の前**に同意ダイアログと取得を挟むこと。
   * `strippedImportUrls` は **DB に持たない＝この 1 回しか手に入らない**ので、他の場所からは後付けできない。
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
      const analysis = await analyze(result.theme.id);
      setOutcome({ result, analysis, duplicateName });
      backToPasteForm();
      if (clearPastedCss) setCssInput("");
      await reload();
    } catch (e) {
      // Rust が返す固定文言をそのまま出す（@media のプレリュード拒否など）。⚠ frontend で書き直さない。
      setError(toErrorMessage(e));
    } finally {
      setBusy(false);
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
        setPreviewCss(
          scopeSelectors(rewriteSelectors(css).css, PREVIEW_SCOPE_SELECTOR),
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
        <span className={styles.note}>
          コメントが表示されなくなったときは「既定のデザインに戻す」で元に戻せます。
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
    </div>
  );
}
