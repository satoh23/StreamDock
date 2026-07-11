import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Screen } from "../types";
import type { HostOs } from "../features/platform/useHostOs";
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
  onNavigate,
}: {
  /** ホスト OS（信号機回避の左余白 / Windows 制御ボタンの出し分けに使う） */
  hostOs?: HostOs;
  /** 右ナビの active 表示（診断画面 / 設定画面のとき） */
  activeNav?: Extract<Screen, "diagnostics" | "settings">;
  onNavigate: (screen: Screen) => void;
}) {
  const isWindows = hostOs === "windows";

  return (
    <header className={styles.header} data-os={hostOs ?? undefined} data-tauri-drag-region>
      <div className={styles.brand} data-tauri-drag-region>
        {/* 同梱アプリアイコン（public/icon.png）。外部リソースは読み込まない。 */}
        <img className={styles.logo} src="/icon.png" alt="" />
        <span className={styles.wordmark}>StreamDock</span>
      </div>
      <nav className={styles.nav}>
        <button
          className={`${styles.navBtn} ${activeNav === "diagnostics" ? styles.active : ""}`}
          onClick={() => onNavigate("diagnostics")}
          title="診断 / ログ"
          aria-label="診断 / ログ"
        >
          🩺
        </button>
        <button
          className={`${styles.navBtn} ${activeNav === "settings" ? styles.active : ""}`}
          onClick={() => onNavigate("settings")}
          title="設定"
          aria-label="設定"
        >
          ⚙
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
