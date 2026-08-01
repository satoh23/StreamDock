import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Screen } from "../types";
import type { HostOs } from "../features/platform/useHostOs";
import { HEADER_SECTIONS } from "./headerSections";
import styles from "./Header.module.css";

/**
 * 021: OS ネイティブ枠に統合するカスタムタイトルバー（Docker Desktop 風）。
 * 左にアプリアイコン＋「StreamDock」ワードマーク、右に診断/設定への遷移アイコンを置く。
 * ヘッダー領域はドラッグでウィンドウ移動できる（`data-tauri-drag-region`）。
 * - macOS: `titleBarStyle="Overlay"` のネイティブ信号機を残すため、左に余白を空ける（`data-os`）。
 * - Windows: フレームレスのため、右端に自作 min/max/close を出す。
 * アプリ名バーに徹し、各画面の見出しは各 screen 側が持つ（二重見出しにしない）。
 */
export function Header({
  hostOs,
  activeNav,
  updateAvailable = false,
  onNavigate,
}: {
  /** ホスト OS（信号機回避の左余白 / Windows 制御ボタンの出し分けに使う） */
  hostOs?: HostOs;
  /** セクション導線 / 右ナビの active 表示（各セクション画面 / 診断 / 設定 / アップデートのとき） */
  activeNav?: Extract<
    Screen,
    | "main"
    | "rakuraku-tools"
    | "obs-effects"
    | "diagnostics"
    | "settings"
    | "app-update"
  >;
  /**
   * 055c: 更新があるか（`AppUpdateStatus.available`）。true のときだけベルにバッジを出す。
   * 確認できなかったときは false のまま＝**バッジを出さない**（「更新なし」と同じ見た目にせず、
   * 理由はアップデート画面側で伝える）。表示専用の prop で、この中で更新チェックはしない。
   */
  updateAvailable?: boolean;
  onNavigate: (screen: Screen) => void;
}) {
  const isWindows = hostOs === "windows";

  return (
    <header className={styles.header} data-os={hostOs ?? undefined} data-tauri-drag-region>
      {/* ロゴ全体をメイン画面へのホームボタンに。ここは drag-region を付けず、header 自体の
          drag-region とロゴ〜ナビ間の余白でウィンドウドラッグは従来どおり効く。 */}
      <button
        type="button"
        className={styles.brand}
        onClick={() => onNavigate("main")}
        aria-label="メイン画面へ"
      >
        {/* 同梱アプリアイコン（public/icon.png）。外部リソースは読み込まない。 */}
        <img className={styles.logo} src="/icon.png" alt="" />
        <span className={styles.wordmark}>StreamDock</span>
      </button>
      <nav className={styles.nav}>
        <div className={styles.sections} data-tutorial-id="header-sections">
          {HEADER_SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`${styles.sectionBtn} ${activeNav === s.screen ? styles.sectionActive : ""}`}
              onClick={() => onNavigate(s.screen)}
              aria-current={activeNav === s.screen ? "page" : undefined}
              data-tutorial-id={`header-section-${s.id}`}
            >
              {s.label}
            </button>
          ))}
        </div>
        {/*
          055c: アップデート導線。テキストセクションではなくアイコンボタンなので
          HEADER_SECTIONS には載せず、診断/設定と同じくここに直書きする（ベル → 診断 → 設定 の順）。
          押すのは画面遷移だけ（毎回の再チェックはしない。再確認はアップデート画面側の導線）。

          ■ 055c review で挙がった 3 点。いずれも**意図した現状維持**:
          - `type="button"` を付けていない（Q-7）: 直下の診断/設定ボタンに合わせている。
            ⚠ 同じファイルの `.brand` / `.sectionBtn` には付いており**既に不統一**だが、`<form>` の
            外なので submit 事故は起きない。ここだけ付けると「右ナビ 3 つ」の中で不揃いになるので
            揃えない。再修正トリガー＝右ナビを `<form>` 内に入れるとき、または 3 つまとめて直すとき。
          - `title` と `aria-label` が更新時に食い違う（Q-6）: `title` は「アップデート」のままで
            件数を持たない。件数はバッジが視覚的に見えているので `title` に重ねる必要が無く、
            スクリーンリーダー向けにだけ `aria-label` で補う。`aria-label` があるとき `title` は
            アクセシブル名の計算に使われないので重複しても無害。
            再修正トリガー＝バッジを視覚的に出さない状態で件数を伝える要件が出たとき。
          - className が条件 false のとき二重スペースになる（Q-8）: 既存の全ボタンと同じ書き方で、
            クラス解決は空白の連続を無視するので機能影響ゼロ。ここだけ整形しない。
        */}
        <button
          className={`${styles.navBtn} ${styles.bell} ${updateAvailable ? styles.hasUpdate : ""} ${activeNav === "app-update" ? styles.active : ""}`}
          onClick={() => onNavigate("app-update")}
          title="アップデート"
          // 件数はバッジではなくアクセシブル名側に持たせる（バッジは aria-hidden）。
          aria-label={updateAvailable ? "アップデート（1件）" : "アップデート"}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M18 8.5a6 6 0 1 0-12 0c0 5.5-2 7-2 7h16s-2-1.5-2-7"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M13.7 19a2 2 0 0 1-3.4 0"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {/* 中身は常に「1」＝「未確認の更新通知が 1 件」の意味（新しいリリースの件数ではない・親 055）。 */}
          {updateAvailable && (
            <span className={styles.navBadge} aria-hidden="true">
              1
            </span>
          )}
        </button>
        <button
          className={`${styles.navBtn} ${activeNav === "diagnostics" ? styles.active : ""}`}
          onClick={() => onNavigate("diagnostics")}
          title="診断 / ログ"
          aria-label="診断 / ログ"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M3 12h4l2.5-6 4 12 2.5-6H21"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <button
          className={`${styles.navBtn} ${activeNav === "settings" ? styles.active : ""}`}
          onClick={() => onNavigate("settings")}
          title="設定"
          aria-label="設定"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path
              d="M12 2.5v3 M12 18.5v3 M21.5 12h-3 M5.5 12h-3 M18.7 5.3l-2.1 2.1 M7.4 16.6l-2.1 2.1 M18.7 18.7l-2.1-2.1 M7.4 7.4 5.3 5.3"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        </button>
        {isWindows && (
          <div className={styles.winControls}>
            <button
              className={styles.winBtn}
              onClick={() => getCurrentWindow().minimize()}
              title="最小化"
              aria-label="最小化"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                <rect x="0" y="4.5" width="10" height="1" fill="currentColor" />
              </svg>
            </button>
            <button
              className={styles.winBtn}
              onClick={() => getCurrentWindow().toggleMaximize()}
              title="最大化"
              aria-label="最大化"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                <rect
                  x="0.5"
                  y="0.5"
                  width="9"
                  height="9"
                  fill="none"
                  stroke="currentColor"
                />
              </svg>
            </button>
            <button
              className={`${styles.winBtn} ${styles.winClose}`}
              onClick={() => getCurrentWindow().close()}
              title="閉じる"
              aria-label="閉じる"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                <path
                  d="M1 1 L9 9 M9 1 L1 9"
                  stroke="currentColor"
                  strokeWidth="1"
                />
              </svg>
            </button>
          </div>
        )}
      </nav>
    </header>
  );
}
