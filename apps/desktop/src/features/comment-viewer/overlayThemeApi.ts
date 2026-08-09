import { invoke } from "@tauri-apps/api/core";
import type { OverlayThemeImportResult } from "./bindings/OverlayThemeImportResult";
import type { OverlayThemeOrigin } from "./bindings/OverlayThemeOrigin";
import type { OverlayThemeRecord } from "./bindings/OverlayThemeRecord";
// 060h: 除去した `@font-face`（宛先＋選別に要る記述子）。⚠ 生成元は Rust の `overlay_theme/model.rs`。
import type { StrippedFontFace } from "./bindings/StrippedFontFace";

/**
 * 060d: オーバーレイ カスタム CSS テーマ（060b）の Rust command 薄いラッパ。
 *
 * 既存の作法どおり **コンポーネントは `invoke` を直接呼ばない**（`audioOutputApi.ts` / `obsApi.ts` と同型）。
 * 型は 060b が ts-rs で生成した `bindings/` の 3 本をそのまま再 export する（**新しい bindings 先は作らない**）。
 *
 * - **検証・サニタイズは Rust 側**（060b の `service` / `sanitize`）。⚠ **frontend で外部参照の除去を
 *   再実装しない**——docs/security.md の「## CSP方針 060b 節」が「サニタイザが唯一の壁（load-bearing）」と
 *   記録しており、2 実装に分裂させると片方だけ緩んだときに気づけない。
 * - **セレクタ変換は注入時に frontend が毎回行う**（060b の決定）。保存されているのは**変換前の CSS**で、
 *   変換表（`cssCompat.ts`）を更新すると取り込み済みテーマにも自動で効く。
 * - **CSS 本文・パス・除去した URL を `console.*` にもエラーにも出さない**（§9）。
 *   このファイルに `console.*` を書かないこと。
 *
 * ⚠⚠ **この 7 本はアプリ定義コマンドなので ACL の対象外＝全 4 窓から呼べる**（046b / 055b と同じ限界。
 * ⚠ 060e で `import_overlay_theme_text`、060c で `import_overlay_theme_snapshot` が増えて 5 → 7 本になった）。
 * 絞りは Rust 側（コマンド自体を狭く作る）で担保済み。詳細は `overlay_theme/commands.rs` の module doc と
 * docs/security.md「Capabilities 方針」。
 */

export type {
  OverlayThemeImportResult,
  OverlayThemeOrigin,
  OverlayThemeRecord,
  // 060h: 除去した `@font-face`（宛先＋選別に要る記述子）。⚠ 生成元は Rust の `model.rs`。
  StrippedFontFace,
};

/**
 * 060d: テーマ名の最大長（**Rust の `MAX_NAME_CHARS` と同値**）。
 *
 * ⚠ 数え方は Unicode スカラー値（Rust の `chars().count()`）なので、JS 側も **`[...name].length`** で数える
 * （`name.length` は UTF-16 単位なので絵文字入りの名前で食い違い、「入力できるのに保存できない」になる）。
 */
export const THEME_NAME_MAX_CHARS = 80;

/**
 * 060d: テーマ名が Rust の `validate_theme_name` を通るか、**先に frontend で**判定する。
 *
 * ⚠⚠ **Rust と同じか狭くすること**（060b からの申し送り①）。frontend が通したものを Rust が弾くと
 * 「入力できるのに保存できない」になる。Rust は `util::reject_control_chars`＝`char::is_control` を使い、
 * これは **C0 ＋ DEL に加えて U+0080..=U+009F（C1）も弾く**ので、
 * ⚠ よくある `/[\x00-\x1F\x7F]/` では**狭すぎず・広すぎ**（C1 が漏れる）＝ **`/\p{Cc}/u` が厳密な等価**。
 * ⚠ 058a の `is_selectable_device_id` とは**向きが逆**——あちらは列挙 API（Rust が返した値を絞る側）、
 * こちらは入力フォーム（ユーザーが打った値を Rust へ渡す前に止める側）。
 *
 * @returns 問題があれば表示用の文言、無ければ `null`。
 */
export function themeNameError(raw: string): string | null {
  const name = raw.trim();
  if (name === "") return "テーマ名を入力してください。";
  if (/\p{Cc}/u.test(name))
    return "テーマ名に使用できない文字（制御文字）が含まれています。";
  if ([...name].length > THEME_NAME_MAX_CHARS)
    return `テーマ名は ${THEME_NAME_MAX_CHARS} 文字以内にしてください。`;
  return null;
}

/**
 * ローカルの `.css` を取り込み、`app_data_dir/themes/<uuid>.css` へ保存してレジストリへ登録する。
 *
 * `path` は `@tauri-apps/plugin-dialog` の `open()` が返した**生パス**。⚠ **Rust 側で必ず再検証される**
 * （§8・UNC 拒否 → `.css` → 256KB → UTF-8 → 制御文字 → 件数上限）ので、ここでの整形は利便性の処理でしかない。
 *
 * ⚠ 戻り値の `strippedImportUrls` は **DB に持たない＝この 1 回しか手に入らない**（060c の同意ダイアログ用）。
 * ⚠ **URL をログにも画面にも素で出さない**（§9・060c がホスト強調付きで出す責務を持つ）。
 */
export function importOverlayTheme(
  path: string,
  name: string,
): Promise<OverlayThemeImportResult> {
  return invoke<OverlayThemeImportResult>("import_overlay_theme", {
    path,
    name,
  });
}

/**
 * 060e: テーマ CSS の**バイト長**上限（Rust の `MAX_CSS_BYTES` と同値）。
 *
 * ⚠⚠ **数え方はバイト長**（Rust は `css.len()`＝ UTF-8 バイト数で見る）。JS の `css.length` は
 * UTF-16 単位なので、**日本語コメント入りの CSS で 3 倍近く食い違う**（`"あ".length === 1` だが 3 バイト）。
 * そのままだと「入力できるのに保存できない」になるので、frontend は必ず `cssByteLength()` で数えること。
 * ⚠ 060d の `THEME_NAME_MAX_CHARS`（コードポイント単位）とは**数える単位が違う**——Rust 側が
 * 名前は `chars().count()`、本文は `len()` で見ているため。片方に揃えないこと。
 */
export const THEME_CSS_MAX_BYTES = 256 * 1024;

/** CSS 本文の UTF-8 バイト長（Rust の `css.len()` と同じ数え方）。 */
export function cssByteLength(css: string): number {
  return new TextEncoder().encode(css).length;
}

/**
 * 060e: テーマ CSS 本文が Rust の `validate_css_body` を通るか、**先に frontend で**判定する。
 *
 * ⚠ 060d の `themeNameError` と同じ向き（ユーザーが打った値を Rust へ渡す前に止める側）で、
 * **Rust と同じか狭く**すること。ここで見るのは「空」と「256KB」だけ——制御文字の判定は
 * `is_forbidden_in_css_body`（C0 のうち `\t \n \r \x0C` 以外と DEL）で、貼り付けで混入することは
 * まず無いうえに、**frontend で再実装すると 2 実装に分裂する**ので Rust の固定文言に任せる。
 * ＝ **「押せたのに Rust が断る」だけが残る**が、文言は明確で fail-closed 側なので受容する
 * （security-review② で妥当と確認済み）。⚠ 再修正トリガー＝ユーザーから「押せたのに保存できない」の
 * 報告が実際に出たら、**Rust の `is_forbidden_in_css_body` と 1 文字も違わない判定**をここへ足すこと
 * （`/[\x00-\x08\x0B\x0E-\x1F\x7F]/`＝ C0 のうち `\t \n \r \x0C` 以外と DEL）。
 * ⚠ 先頭 BOM は Rust が剥がすので、ここでは触らない（剥がす前提で数えると 3 バイトぶんずれる）。
 *   ＝ **BOM 付きの CSS では frontend のほうが 3 バイト厳しい**が、これは意図した非対称である:
 *   厳しい側（＝押せなくなる側）へ倒れるので **fail-safe** で、逆（Rust が弾くものを frontend が通す）に
 *   なると「入力できるのに保存できない」になる。境界ぴったり ±3 バイトの CSS は実在しない。
 *   ⚠ 再修正トリガー＝ここで BOM を剥がしたくなったら、**Rust の `validate_css_body` と同じ順序**
 *   （BOM を剥がしてから数える）にすること。片方だけ変えると向きが逆転する。
 *
 * @returns 問題があれば表示用の文言、無ければ `null`。
 */
export function themeCssError(raw: string): string | null {
  if (raw.trim() === "") return "CSS を貼り付けてください。";
  if (cssByteLength(raw) > THEME_CSS_MAX_BYTES)
    return "CSS が大きすぎます。256KB 以内にしてください。";
  return null;
}

/**
 * 貼り付けられた CSS テキストを取り込む（**ファイルを作らせない**導線・060e）。
 *
 * ⚠ 保存先・ファイル名・サニタイズは `importOverlayTheme` と**まったく同じ共通コア**が受け持つ
 * （Rust の `service::store_sanitized_css`）。frontend は本文と名前を渡すだけで、
 * **保存先に関わる情報を 1 つも持たない**。
 * ⚠ **CSS 本文をログにも画面にも出さない**（§9）。エラーは Rust の固定文言をそのまま出す。
 */
export function importOverlayThemeText(
  css: string,
  name: string,
): Promise<OverlayThemeImportResult> {
  return invoke<OverlayThemeImportResult>("import_overlay_theme_text", {
    css,
    name,
  });
}

/**
 * 060c: 登録できるテーマの上限（**Rust の `MAX_THEMES` と同値**）。
 *
 * ⚠ frontend が持つ理由は 1 つだけ——**同意ダイアログを出す前に上限を検査する**ため。
 * 外部 `@import` の取り込みは「除去版を保存 → 同意 → 取得 → Snapshot を保存 → 除去版を削除」の順で、
 * 上限に張り付いていると **2 件目（Snapshot）だけが入らない**。取得してから保存で落ちると
 * **帯域も同意も無駄**になり、ユーザーには「同意したのに失敗した」としか見えない（060b 申し送り⑤の趣旨）。
 * ⚠ 判定を frontend に置いても**壁は Rust 側**（`store_sanitized_css` の件数検査）である。
 */
export const THEME_MAX_COUNT = 200;

/**
 * 060c: **外部 `@import` を取得してインライン展開した CSS** を取り込む（スナップショット）。
 *
 * ⚠ 呼ぶのは `OverlayThemeCard` の取得ループだけ。渡す `css` は
 * 「取得した CSS（同意した順）＋ 除去済み CSS」を連結したもので、**保存されるテーマの `origin` は
 * `snapshot`** になる（⚠ 出自を決めるのは Rust の呼び出し経路で、ここからは指定できない）。
 * ⚠ 検証・サニタイズ・上限は `importOverlayThemeText` と**同じ共通コア**（`store_sanitized_css`）。
 * ⚠ **CSS 本文も取得先 URL もログに出さない**（§9）。
 */
export function importOverlayThemeSnapshot(
  css: string,
  name: string,
): Promise<OverlayThemeImportResult> {
  return invoke<OverlayThemeImportResult>("import_overlay_theme_snapshot", {
    css,
    name,
  });
}

/** 取り込み済みテーマの一覧（新しい順）。read-only。 */
export function listOverlayThemes(): Promise<OverlayThemeRecord[]> {
  return invoke<OverlayThemeRecord[]>("list_overlay_themes");
}

/**
 * 保存済みテーマの CSS を文字列で受け取る（注入とプレビューの元）。
 *
 * ⚠ **返る CSS には `</style>` がそのまま含まれうる**（正当な CSS なので 060b は除去しない）。
 * ＝ **注入は必ず `<style>` の `textContent`** で行うこと。`innerHTML` に入れると DOM を閉じられる。
 * ⚠ テーマが消えている・読めないときは reject する（呼び出し側は**既定意匠へ倒す**こと）。
 */
export function getOverlayThemeCss(id: string): Promise<string> {
  return invoke<string>("get_overlay_theme_css", { id });
}

/**
 * 060h: 取得した Web フォントを **`@font-face` だけの CSS** としてテーマへ添える（**2 つ目の管理ファイル**）。
 *
 * ⚠⚠ **意匠 CSS と別ファイル・別 `<style>` にするのが要件**（060h 問題④）。同じ文字列に混ぜると、
 * テーマを切り替えるたびに `rewriteSelectors` が数 MB を走査する。
 * ⚠ 保存先の組み立て・サニタイズ・書き込みは意匠と**同じ共通コア**（`service::write_sanitized_asset`）で、
 * 違うのは**本文の上限だけ**（意匠 256KB / フォント 5MB）。
 * ⚠ **フォントのバイト列をログにも画面にも出さない**（§9）。
 */
export function attachOverlayThemeFonts(
  id: string,
  css: string,
): Promise<void> {
  return invoke<void>("attach_overlay_theme_fonts", { id, css });
}

/**
 * 060h: テーマのフォント CSS を受け取る（**無ければ空文字**）。
 *
 * ⚠ 注入側は**変換を一切通さずに**別の `<style>` へ載せること
 * （`rewriteSelectors` / `scopeSelectors` / `withDecorationReset` はいずれも `@font-face` に無意味で、
 * 数 MB を毎回走査するだけになる）。
 */
export function getOverlayThemeFontCss(id: string): Promise<string> {
  return invoke<string>("get_overlay_theme_font_css", { id });
}

/**
 * 060h: **フォント取り込みの予算**。
 *
 * | 定数 | 値 | 根拠 |
 * |---|---|---|
 * | 1 本の上限（生 woff2） | 512KiB | Google の日本語サブセットは 1 本 4〜40KB。**分割していない CJK フォント丸ごと（1〜4MB）は落ちる**＝ 1 本で予算を食い潰す形を排除 |
 * | 総量の上限（生 woff2 合計） | 3MiB | base64 で 4MiB。**日本語 1 ファミリ（約 110 分割・生 1.5〜2MB）が丸ごと入る**値 |
 * | 本数の上限 | 256 本 | 日本語 1 ファミリ 110 分割の 2 倍強（Rust の `MAX_STRIPPED_FONT_URLS` と同値） |
 *
 * ⚠ 保存側の上限（5MB）は Rust の `MAX_FONT_CSS_BYTES` が別に持つ。ここは**取得側の予算**である。
 *
 * ⚠ **同じ数字が下流にもある**（060h review Q-11・受容）。512KiB は sidecar の `THEME_FONT_MAX_BYTES`、
 * 256 は Rust の `MAX_STRIPPED_FONT_URLS` にもある。**片方だけ動かせる形にはなっていない**——
 * どちらも「**下流が天井を持ち、ここは要求値**」という非対称で、ここを緩めても下流が切る
 * （sidecar は `maxBytes` をクランプ、Rust は 256 件でリストを打ち切る）。
 * ⚠ 総量 3MiB だけはここにしか無く、Rust の `MAX_FONT_CSS_BYTES`（5MiB）が backstop になっている。
 * ⚠ 再修正トリガー＝「ここを上げれば実際に上限が上がる」形になったら（＝下流の天井を外したら）、
 * その時点で 1 か所へ寄せること。
 */
export const THEME_FONT_MAX_ONE_BYTES = 512 * 1024;
export const THEME_FONT_MAX_TOTAL_BYTES = 3 * 1024 * 1024;
export const THEME_FONT_MAX_COUNT = 256;

/** テーマの表示名を変更する（ファイル実体には触れない）。⚠ `name` は `themeNameError` を通してから渡す。 */
export function renameOverlayTheme(
  id: string,
  name: string,
): Promise<OverlayThemeRecord> {
  return invoke<OverlayThemeRecord>("rename_overlay_theme", { id, name });
}

/** テーマを削除する（レジストリの行とファイル実体の両方）。二重削除は `NotFound` で reject するだけ。 */
export function deleteOverlayTheme(id: string): Promise<void> {
  return invoke<void>("delete_overlay_theme", { id });
}
