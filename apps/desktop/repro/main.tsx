/**
 * 060c 追修正②の調査用ハーネス（**実物の `OverlayThemeCard` を WKWebView に描かせる**）。
 *
 * ⚠⚠ progress.md「差し戻し⑦／追修正⑦」の再現条件のうち、**静的 HTML では満たせなかった 1 つ**
 * ＝「**実物のコンポーネント**」を満たすためだけに存在する。自作の静的 HTML では再現しないことを
 * 実測で確認済み（外側スクロール・テーマ遷移・`<style>` の head append・トグル ON でマウント・
 * 窓を画面内・`afterScreenUpdates=false` を全部揃えても出なかった）。
 *
 * ⚠ **本番の配線は 1 バイトも変えない**。ここは `window.__TAURI_INTERNALS__.invoke` を差し替えて
 * `OverlayThemeCard` に「テーマが 1 件ある」ように見せるだけの薄い殻である。
 *
 * ⚠ **テーマ CSS はこのリポジトリに置かない**（第三者の著作物）。Swift ドライバが
 * `window.__FIXTURE_CSS` へ流し込む（未設定なら空文字＝既定意匠）。
 *
 * 使い方: `pnpm dev` して `http://localhost:1420/repro/` を開く（ドライバは `scripts/` 外＝
 * スクラッチパッドの `wkshot.swift` が担当）。
 */
import React from "react";
import ReactDOM from "react-dom/client";
import "../src/styles/theme.css";
import { OverlayThemeCard } from "../src/screens/comment-viewer/OverlayThemeCard";
import styles from "../src/screens/comment-viewer/CommentViewerApp.module.css";

declare global {
  interface Window {
    __FIXTURE_CSS?: string;
    __TAURI_INTERNALS__?: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
  }
}

const NOW = "2026-08-09T00:00:00Z";
const THEME = {
  id: "repro-theme-1",
  name: "リプロ用テーマ",
  origin: "snapshot",
  strippedCount: 0,
  createdAt: NOW,
  updatedAt: NOW,
};

// ⚠ `invoke` の実体だけを差し替える（`@tauri-apps/api` の `invoke` は必ずここを通る）。
window.__TAURI_INTERNALS__ = {
  invoke: async (cmd: string) => {
    switch (cmd) {
      case "list_overlay_themes":
        return [THEME];
      case "get_overlay_theme_css":
        return window.__FIXTURE_CSS ?? "";
      case "get_theme_import_ticket":
        return null;
      default:
        return null;
    }
  },
};

// eslint-disable-next-line react-refresh/only-export-components -- 調査用の使い捨てエントリ（HMR 不要）
function Harness() {
  return (
    // ⚠ 実際と同じ「`.settingsView` の div 内スクロール」に入れる（再現条件の 1 つ）。
    <div className={styles.settingsView} style={{ height: "420px" }} id="settings">
      {/* プレビュー枠を画面内へスクロールさせるための詰め物（実際は他のカードが並んでいる位置）。 */}
      <div style={{ height: 300, flexShrink: 0 }}>（上の詰め物）</div>
      <OverlayThemeCard overlayFont="system" overlayShowSource />
      <div style={{ height: 300, flexShrink: 0 }}>（下の詰め物）</div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Harness />
  </React.StrictMode>,
);
