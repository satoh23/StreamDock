/**
 * 034e: OBS オーバーレイの表示設定（フォント選択 / サイト名表示 ON/OFF）を localStorage に保持する。
 *
 * オーバーレイ窓（OverlayApp）と設定窓（CommentViewerApp/SettingsView）は別 webview だが、同一 Vite バンドル・
 * 同一 localStorage を共有する。設定窓が save* で書き込み、オーバーレイ窓が起動時に load*＋`storage` イベント
 * 購読で即反映する（設定窓での書換は他窓＝オーバーレイ窓で storage イベントを発火させる）。
 *
 * どちらも**非機密の UI 設定値**で、ttsPrefs.ts / channelStorage.ts と同方式（名前空間付き "stream-dock.*" キー・
 * localStorage 直 read/write・例外は握りつぶし）。OAuth トークン等の機密はここに保存しない。外部送信もしない。
 * フォントはすべて **OS 標準フォントのスタック**で、外部 Web フォント（CDN 等）は参照しない（docs/security.md の
 * CSP 方針: 外部 script/style/image/font を増やさない）。
 */

/** オーバーレイのフォント選択の保存キー（既定 system）。 */
export const OVERLAY_FONT_KEY = "stream-dock.comment-viewer.overlay-font";
/** オーバーレイのサイト名表示 ON/OFF の保存キー（既定 OFF）。 */
export const OVERLAY_SHOW_SOURCE_KEY =
  "stream-dock.comment-viewer.overlay-show-source";
/**
 * 044a: OBS へ自動追加（連携）ON/OFF の保存キー（既定 OFF）。**非機密の UI 設定のみ**。
 * OBS WebSocket パスワードはここに保存しない（Rust→OS キーチェーンで保持・§9）。
 */
export const OBS_AUTO_ADD_KEY = "stream-dock.comment-viewer.obs-auto-add";
/**
 * 046b: 「固定コメントをOBSに表示」ON/OFF の保存キー（既定 OFF）。**ユーザー自身の UI 設定値**（トグルの状態）で、
 * §9 追補（046a）が対象とする第三者の個人データ（コメント本文・表示名・金額＝`pinnedComments.ts` のキー）とは
 * データの性質が違う。既存の `OBS_AUTO_ADD_KEY` と同種の非機密トグル値として扱う。
 *
 * 永続化する理由: この設定は「OBS のウィンドウキャプチャに固定コメント窓を仕込む」一度きりのセットアップで、
 * 毎回 ON にし直させると配信開始時に OBS ソースが取り込めない（窓が無い）状態から始まってしまうため。
 * ON のときはコメビュ本体のマウント時に窓を開き直す（`CommentViewerApp` の 046b effect）。
 */
export const PINNED_OVERLAY_ENABLED_KEY =
  "stream-dock.comment-viewer.pinned-overlay-enabled";
/**
 * 060d: 選択中のカスタム CSS テーマ（`overlay_themes` の id）の保存キー。**未保存＝`null`＝既定意匠**。
 *
 * ⚠ **CSS 本文はここに置かない**（Rust が `app_data_dir/themes/<id>.css` に持ち、
 * `get_overlay_theme_css` が文字列で返す）。localStorage に置くのは**id 1 個だけ**で、
 * これは「フォント」「サイト名表示」と同じ**ユーザー自身の UI 設定値**＝ §9 追補（046a）が対象とする
 * 第三者の個人データ（コメント本文・表示名・金額）ではない。
 *
 * ⚠⚠ **`null`（既定）へ必ず戻せることが安全装置**。ユーザー CSS は `.sd-comment { display:none }` の
 * 一行でオーバーレイを完全に不可視にでき、オーバーレイ窓は表示専用・非フォーカスなので**そこからは
 * 何も操作できない**。設定ビューの「既定のデザインに戻す」だけが脱出路になる（060d のテストが固定）。
 */
export const OVERLAY_THEME_KEY = "stream-dock.comment-viewer.overlay-theme";

/**
 * オーバーレイのフォント候補（すべて OS 標準・日本語表示可・外部フォント無し）。`id` を localStorage に保存し、
 * `stack` を font-family に適用する。maru（丸ゴシック）は Windows に該当フォントが無いので gothic 相当へ
 * フォールバックする。ここに載せるのは system/OS 同梱フォントのみで、URL 参照は一切持たない。
 */
export const OVERLAY_FONTS = [
  {
    id: "system",
    label: "システム標準",
    stack:
      'system-ui, -apple-system, "Segoe UI", "Hiragino Sans", "Yu Gothic", "Meiryo", sans-serif',
  },
  {
    id: "gothic",
    label: "ゴシック",
    stack:
      '"Yu Gothic", "YuGothic", "Hiragino Kaku Gothic ProN", "Meiryo", sans-serif',
  },
  {
    id: "maru",
    label: "丸ゴシック",
    stack: '"Hiragino Maru Gothic ProN", "Yu Gothic", "Meiryo", sans-serif',
  },
  {
    id: "mincho",
    label: "明朝",
    stack:
      '"Hiragino Mincho ProN", "Yu Mincho", "YuMincho", "MS Mincho", serif',
  },
] as const;

/** フォント id の型（OVERLAY_FONTS の id 群）。 */
export type OverlayFontId = (typeof OVERLAY_FONTS)[number]["id"];

/** 既定フォント（システム標準）。 */
export const DEFAULT_OVERLAY_FONT: OverlayFontId = "system";

/** 保存済みのフォント id を読み込む。未保存・不正・例外はすべて既定（system）へフォールバック。 */
export function loadOverlayFont(): OverlayFontId {
  try {
    const raw = localStorage.getItem(OVERLAY_FONT_KEY);
    return OVERLAY_FONTS.some((f) => f.id === raw)
      ? (raw as OverlayFontId)
      : DEFAULT_OVERLAY_FONT;
  } catch {
    return DEFAULT_OVERLAY_FONT;
  }
}

/** フォント id を保存する（ローカルのみ・外部送信しない）。 */
export function saveOverlayFont(id: OverlayFontId): void {
  try {
    localStorage.setItem(OVERLAY_FONT_KEY, id);
  } catch {
    // プライベートモード等で書けない場合は黙って無視する（表示は継続できる）。
  }
}

/**
 * フォント id を font-family スタック文字列へ解決する。未知 id は既定（DEFAULT_OVERLAY_FONT）のスタックへ。
 * 034e(review L3): フォールバックを DEFAULT_OVERLAY_FONT に一本化し、loadOverlayFont と既定の定義元を揃える
 * （OVERLAY_FONTS の並び順に依存しないため、将来 system を先頭以外へ移してもフォールバック先が乖離しない）。
 * 末尾の OVERLAY_FONTS[0] は型上の最終ガード（find の undefined を潰す・実運用では到達しない）。
 */
export function resolveOverlayFontStack(id: OverlayFontId): string {
  const found =
    OVERLAY_FONTS.find((f) => f.id === id) ??
    OVERLAY_FONTS.find((f) => f.id === DEFAULT_OVERLAY_FONT) ??
    OVERLAY_FONTS[0];
  return found.stack;
}

/** 保存済みのサイト名表示 ON/OFF を読み込む。未保存・不正・例外はすべて false（OFF）にフォールバック。 */
export function loadOverlayShowSource(): boolean {
  try {
    return localStorage.getItem(OVERLAY_SHOW_SOURCE_KEY) === "true";
  } catch {
    return false;
  }
}

/** サイト名表示 ON/OFF を保存する（ローカルのみ・外部送信しない）。 */
export function saveOverlayShowSource(show: boolean): void {
  try {
    localStorage.setItem(OVERLAY_SHOW_SOURCE_KEY, String(show));
  } catch {
    // プライベートモード等で書けない場合は黙って無視する（表示は継続できる）。
  }
}

/** 044a: OBS 自動追加 ON/OFF を読み込む。未保存・例外は false（OFF）へフォールバック。 */
export function loadObsAutoAdd(): boolean {
  try {
    return localStorage.getItem(OBS_AUTO_ADD_KEY) === "true";
  } catch {
    return false;
  }
}

/** 044a: OBS 自動追加 ON/OFF を保存する（ローカルのみ・非機密・外部送信しない）。 */
export function saveObsAutoAdd(enabled: boolean): void {
  try {
    localStorage.setItem(OBS_AUTO_ADD_KEY, String(enabled));
  } catch {
    // プライベートモード等で書けない場合は黙って無視する。
  }
}

/** 046b: 「固定コメントをOBSに表示」ON/OFF を読み込む。未保存・例外は false（OFF）へフォールバック。 */
export function loadPinnedOverlayEnabled(): boolean {
  try {
    return localStorage.getItem(PINNED_OVERLAY_ENABLED_KEY) === "true";
  } catch {
    return false;
  }
}

/** 046b: 「固定コメントをOBSに表示」ON/OFF を保存する（ローカルのみ・非機密・外部送信しない）。 */
export function savePinnedOverlayEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(PINNED_OVERLAY_ENABLED_KEY, String(enabled));
  } catch {
    // プライベートモード等で書けない場合は黙って無視する。
  }
}

/**
 * 060d: テーマ id として受け入れる形（uuid v4）。
 *
 * ⚠ **Rust 側と対になっている**——id を採番するのは `overlay_theme::service` の `Uuid::new_v4()` だけで、
 * 保存先を組み立てる `is_managed_file_name()` も `<uuid v4>.css` の完全一致を要求している。
 * ここで形を検査しておくと、細工された localStorage 値がそもそもコマンドまで届かない
 * （届いても Rust が `NotFound` を返すだけなので多層防御の 1 枚目という位置づけ）。
 * ⚠ **再修正トリガー＝ Rust の id 採番方式を変えるとき**（変えるとテーマが黙って適用されなくなる）。
 */
const OVERLAY_THEME_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 060d: 選択中テーマ id を読み込む。**未保存・不正な形・例外はすべて `null`（＝既定意匠）**へ倒す。
 *
 * ⚠ 失敗を `null` に倒すのは fail-safe。id が読めないときに「前のテーマを当て続ける」経路が無いので、
 * 壊れた状態からは必ず StreamDock の既定意匠に戻る。
 */
export function loadOverlayTheme(): string | null {
  try {
    const raw = localStorage.getItem(OVERLAY_THEME_KEY);
    return raw !== null && OVERLAY_THEME_ID_RE.test(raw) ? raw : null;
  } catch {
    return null;
  }
}

/**
 * 060d: 選択中テーマ id を保存する（ローカルのみ・外部送信しない）。**`null` はキーごと削除**。
 *
 * ⚠ 削除にしているのは「未保存＝既定」と「既定を選んだ」を同じ状態に潰すため（分岐を増やさない）。
 * 他窓（オーバーレイ窓）には `removeItem` でも `storage` イベントが飛ぶので、即時反映の経路は同じ。
 */
export function saveOverlayTheme(id: string | null): void {
  try {
    if (id === null) localStorage.removeItem(OVERLAY_THEME_KEY);
    else localStorage.setItem(OVERLAY_THEME_KEY, id);
  } catch {
    // プライベートモード等で書けない場合は黙って無視する（表示は継続できる）。
  }
}
