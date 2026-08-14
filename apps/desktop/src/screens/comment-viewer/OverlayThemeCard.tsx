import { useCallback, useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
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
} from "../../features/comment-viewer/cssScope";
import {
  deleteOverlayTheme,
  getOverlayThemeCss,
  getOverlayThemeFontCss,
  importOverlayTheme,
  importOverlayThemeText,
  listOverlayThemes,
  renameOverlayTheme,
  themeCssError,
  themeNameError,
  type OverlayThemeRecord,
} from "../../features/comment-viewer/overlayThemeApi";
import type {
  ThemeFontFetchResult,
  ThemeImportFetchResult,
} from "../../features/comment-viewer/commentStream";
import { toErrorMessage } from "../../features/tools/useTools";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { CommentList } from "./CommentList";
import { ToggleSwitch } from "../../components/ToggleSwitch";
import {
  baseName,
  clampDisplayText,
  clampUnmatched,
  consentHost,
  CONSENT_URL_MAX_CHARS,
  defaultThemeName,
  displayFileName,
  nextPastedName,
  PREVIEW_COMMENTS,
} from "./overlayThemeCard.helpers";
import { useThemeImport } from "./useThemeImport";
import styles from "./CommentViewerApp.module.css";
// 061g: ボタンの意匠は `components/compactButtons.module.css` へ移した（`ConfirmDialog` が
// `components/` へ出たため）。⚠ 寸法・配色はこの窓の 6 ファイル計 25 箇所と `ConfirmDialog` の共有。
import btnStyles from "../../components/compactButtons.module.css";

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
 * ## ⚠ ファイルの長さについて（security-review②・品質 #10 → 060c Q-1 → **060h で分割済み**）
 *
 * ✅ **2026-08-09（060h コミット 1）で分割した。** 060c の時点で 1300 行超になり、
 * security-review 060c Q-1 が「切る」ことを求めていたが、**§1 に 8 件目の例外を新設する変更と
 * 同じコミットに大きな構造変更を混ぜると security-review の差分が読めなくなる**ため見送っていた。
 * その再修正トリガー（「060h に着手するとき、実装の前に切る」）が発火したので、
 * **060h の第 1 コミットを「分割だけ・振る舞い差分ゼロ」**として実施した。
 *
 * 切った先は指定どおりの 2 つ:
 * ① 純関数＋定数 → [`./overlayThemeCard.helpers`]
 * ② 取り込みと解析（`analyze` / `runImport` / `runConsentLoop` / `ImportOutcome`）→ [`./useThemeImport`]
 *
 * ⚠⚠ **このファイルに残っているのは「UI と、UI にしか置けないもの」だけである。**
 * とくに次の 2 つは**静的ガードが本ファイルに在ることを要求している**ので、動かさないこと:
 * - `document.createElement("style")`（プレビュー注入）… (10-i) の `<style>` 生成箇所 allow-list
 * - `withDecorationReset(...)`（既定意匠のリセット前置）… (10-m) の「注入経路 2 か所の両方」
 *
 * ⚠ 次に切るとしたら「プレビュー」（`previewCss` の取得と `<style>` の出し入れ）だが、
 * **上の 2 つのガードがこのファイルを名指ししている**ので、切るなら allow-list の更新と
 * security-review の区分確認が先である（＝黙って移せない）。
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
  /**
   * 060h: `@font-face` の `src` が指すフォント実体を **1 本だけ**取得させる。
   * ⚠ 未指定ならフォント段ごと出さない（＝ 060c までの挙動＝ fail-closed）。
   */
  requestThemeFont?: (
    url: string,
    maxBytes: number,
  ) => Promise<ThemeFontFetchResult>;
}

export function OverlayThemeCard({
  overlayFont,
  overlayShowSource,
  requestThemeImport,
  requestThemeFont,
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
   * フォームを既定状態（＝貼り付け欄）へ戻す。⚠ 060e で「閉じる」ではなく「戻す」になった。
   *
   * ⚠⚠ **貼り付けた CSS 本文（`cssInput`）はここで消さない**（security-review②・品質 #1）。
   * ここは「キャンセル」「改名の成功」「**ファイル**取り込みの成功」からも呼ばれるので、消すと
   * **数十行貼った直後に「名前を変更」を押しただけで貼った内容が失われる**（データロス）。
   * 本文を捨てるのは「**貼り付けたものが保存できた**」ときだけ＝下の `onImported` の `clearPastedCss`。
   */
  const backToPasteForm = () => {
    setForm({ kind: "paste" });
    setNameInput("");
  };

  // ⚠⚠ 060h コミット 1: 取り込み・解析・060c の同意ループは [`useThemeImport`] へ切り出した
  // （**分割だけ・振る舞い差分ゼロ**）。`busy` / `error` はここに残す——改名と削除でも使うので、
  // フックへ移すと「フックの state を改名処理が setter 経由で書く」ねじれた依存ができる。
  const { outcome, setOutcome, consent, settleConsent, runImport } =
    useThemeImport({
      themes,
      selectedId,
      select,
      reload,
      setBusy,
      setError,
      onImported: (clearPastedCss) => {
        backToPasteForm();
        if (clearPastedCss) setCssInput("");
      },
      requestThemeImport,
      requestThemeFont,
    });

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

  // --- 060h: プレビューのフォント -------------------------------------------------------------
  // ⚠⚠ **意匠とは別の `<style>` に載せる**（`rewriteSelectors` / `scopeSelectors` /
  //   `withDecorationReset` を 1 つも通さない）。`@font-face` はセレクタを持たないので変換する対象が無く、
  //   混ぜると**テーマを切り替えるたびに数 MB を走査する**（060h 問題④）。
  // ⚠⚠ **`@font-face` の family 名は文書グローバルで閉じられない**（cssScope.ts の既知の限界）。
  //   060d はこれを「プレビューを開いている間だけ `<style>` を置く」＝**露出時間を限ること**で受容しており、
  //   060h でも**同じ強さの担保をフォント側にも適用する**（`previewThemeId` に厳密に連動し、
  //   取得に失敗しても残らない）。⚠ 能力自体は 060d の時点で既に開いている——
  //   `@font-face{src:url(data:font/woff2;base64,…)}` は 060b の許可形なので、
  //   base64 フォントを貼り付けた CSS はここへ実フォントを注入できた。**060h が変えるのは頻度である。**
  //   恒久策（shadow root / iframe）は別タスク。
  const [previewFontCss, setPreviewFontCss] = useState<string | null>(null);
  useEffect(() => {
    if (previewThemeId === null) {
      setPreviewFontCss(null);
      return;
    }
    let cancelled = false;
    getOverlayThemeFontCss(previewThemeId)
      .then((css) => {
        if (cancelled) return;
        setPreviewFontCss(css.trim() === "" ? null : css);
      })
      .catch(() => {
        if (!cancelled) setPreviewFontCss(null);
      });
    return () => {
      cancelled = true;
    };
  }, [previewThemeId]);

  useEffect(() => {
    if (previewFontCss === null) return;
    const el = document.createElement("style");
    el.dataset.sdPreviewFonts = "";
    // ⚠ ここも `textContent` のみ。
    el.textContent = previewFontCss;
    document.head.appendChild(el);
    return () => {
      el.remove();
    };
  }, [previewFontCss]);

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
                    className={btnStyles.btnGhost}
                    onClick={() => startRename(theme)}
                    disabled={busy}
                  >
                    名前を変更
                  </button>
                  <button
                    type="button"
                    className={btnStyles.btnGhost}
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
            className={btnStyles.btn}
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
                className={btnStyles.btn}
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
                className={btnStyles.btnGhost}
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
                className={btnStyles.btn}
                onClick={submitForm}
                disabled={busy || nameError !== null}
              >
                {form.kind === "import" ? "取り込む" : "保存"}
              </button>
              <button
                type="button"
                className={btnStyles.btnGhost}
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
            {/* ⚠⚠ 060h review Q-2: **外部デザインを実際に取り込めたときは出さない。**
                この文言は「StreamDock は外部サイトへ接続しない」と言い切るもので、060h の
                2 段ループが 1 件でも取得できた直後は事実と正反対になる（`snapshotNotes` 側に
                「外部デザインを N 件取り込みました」「そこから先は取得していません」が出るので、
                打ち切りの説明はそちらが担う）。⚠ 取得が 0 件のときは引き続きここが唯一の説明である。 */}
            {outcome.result.strippedImportUrls.length > 0 &&
              outcome.fetchedCssCount === 0 && (
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
        open={consent?.kind === "css"}
        title="外部からデザインを取得しますか？"
        message={
          consent?.kind !== "css"
            ? ""
            : consent.round > 1
              ? "取得したデザインは、さらに次のアドレスにあるデザインを読み込む指定を含んでいます。"
              : "取り込んだ CSS は、次のアドレスにあるデザインを読み込む指定を含んでいます。"
        }
        details={
          consent?.kind !== "css" ? null : (
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
              {/* ⚠⚠ 060h: **1 段目の時点では 2 段目の宛先を知りようがない**（まだ取得していない）ので、
                  「自動では取りに行かない・改めて確認する」ことをここで約束する。
                  これが無いと「同意した宛先」と「実際に接続した宛先」が食い違って見える。 */}
              <span className={styles.note}>
                取得した内容がさらに別のアドレスを参照していた場合は、改めて確認します（自動では取得しません）。
              </span>
              <span className={styles.note}>
                取得した内容に含まれる外部の画像は取り込まれません。
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

      {/* --- 060h: フォント実体の取得同意 ---------------------------------------------------
          ⚠⚠ **ここだけ「完全な URL を全部は出さない」**——日本語 1 ファミリは unicode-range で
          約 110 分割されるので、110 枚のダイアログは同意として機能しない（読まずに押される）。
          代わりに:
          - **取得先ホストを重複排除して全部強調**する（ここが「どこへ接続するか」の全量である）
          - **件数と上限**を出す（帯域も同意も無駄にしないため、上限超過は**同意の前に**分かる）
          - 実際に取得するのは `consent.urls` だけで、上のホスト集合は**そこから導出**している
          - 既定はキャンセル側・「今後確認しない」は作らない（CSS 側と同じ） */}
      <ConfirmDialog
        open={consent?.kind === "fonts"}
        title="書体（フォント）を取り込みますか？"
        message={
          consent?.kind !== "fonts"
            ? ""
            : "取り込んだデザインは外部の書体を指定しています。取り込むと、以後は通信せずにその書体で表示できます。"
        }
        details={
          consent?.kind !== "fonts" ? null : (
            <div className={styles.speakerField}>
              <span className={styles.fieldLabel}>取得先ホスト</span>
              {consent.hosts.map((host) => (
                <strong key={host} className={styles.note}>
                  {host}
                </strong>
              ))}
              <span className={styles.fieldLabel}>取得する件数</span>
              <span className={styles.note}>
                {consent.urls.length} 件
                {consent.total > consent.urls.length &&
                  `（このデザインが指定している ${consent.total} 件のうち、上限に収まるぶんだけ）`}
              </span>
              {/* ⚠ 060h review Q-10: 上限は**ユーザーが観測する量（＝通信量）**で書く。
                  実装の予算は生バイト 3MiB（base64 化して保存すると約 4MB）なので、
                  「約 4MB」と出すとダウンロード量の見積りとズレる。 */}
              <span className={styles.note}>
                書体は分割して配信されるため件数が多くなります。通信量が上限（約 3MB）を超えるぶんは取り込まず、その文字は端末のフォントで表示されます。
              </span>
              <span className={styles.note}>
                取り込んだ書体はデザインと一緒に端末へ保存され、
                <strong>以後は通信しません</strong>。
              </span>
              {/* ⚠ ライセンスはユーザー自身の責任。任意の URL を指定できる以上、StreamDock は確認できない。 */}
              <span className={styles.note}>
                取り込む書体の利用条件（ライセンス）はご自身でご確認ください。StreamDock
                は確認できません。
              </span>
              <span className={styles.note}>
                取り込まない場合でも、デザインはそのまま使えます（書体だけが端末のフォントになります）。
              </span>
            </div>
          )
        }
        // ⚠ ラベルを「取り込む」にしない——貼り付けフォームのボタンと**同名になり**、
        //   ユーザーにもテストにもどちらを押すのか区別が付かなくなる。
        confirmLabel="書体を取り込む"
        cancelLabel="取り込まない"
        onConfirm={() => settleConsent(true)}
        onCancel={() => settleConsent(false)}
      />
    </div>
  );
}
