/**
 * 060c 追修正④の調査用ハーネス（**実物の `OverlayApp`（＝ OBS へ映す配信窓）を WKWebView に描かせる**）。
 *
 * 目的は 1 つだけ——**プレビューで見つけた「テーマの高さが器を突き抜ける」不具合が、配信窓でも起きるか**を
 * 測ること。プレビュー枠は `height:200px` の固定枠だったが、配信窓のルート（`.sd-overlay`）は
 * `#root`（＝窓いっぱい）に対する `height:100%` なので、**同じ形で起きるとは限らない**。
 *
 * ⚠ **本番の配線は 1 バイトも変えない**。`window.__TAURI_INTERNALS__.invoke` を差し替えて
 * 「テーマが 1 件・選択済み」に見せるだけの薄い殻である（`repro/main.tsx` と同じ作法）。
 * ⚠ テーマ CSS はリポジトリに置かない。Swift ドライバが `window.__FIXTURE_CSS` へ流し込む。
 * ⚠ コメントは流れてこない（WS に繋がらない）が、測りたいのは**器の高さの関係**なので足りる。
 */
import React from "react";
import ReactDOM from "react-dom/client";
import "../src/styles/theme.css";
import { OverlayApp } from "../src/screens/comment-viewer/OverlayApp";

declare global {
  interface Window {
    __FIXTURE_CSS?: string;
    __TAURI_INTERNALS__?: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
  }
}

const NOW = "2026-08-09T00:00:00Z";
// ⚠ 配信窓は「選択中テーマ id」を localStorage から読む（`loadOverlayTheme`）。UUID 形でないと
// `OVERLAY_THEME_ID_RE` に弾かれて既定意匠へ倒れるので、UUID 形の id を使う。
const THEME = {
  id: "11111111-2222-4333-8444-555555555555",
  name: "リプロ用テーマ",
  origin: "snapshot",
  strippedCount: 0,
  createdAt: NOW,
  updatedAt: NOW,
};

// ⚠ 「このテーマを選択中」に見せる（本番と同じ経路＝`loadOverlayTheme()` が読む localStorage）。
localStorage.setItem("stream-dock.comment-viewer.overlay-theme", THEME.id);

window.__TAURI_INTERNALS__ = {
  invoke: async (cmd: string) => {
    switch (cmd) {
      case "list_overlay_themes":
        return [THEME];
      case "get_overlay_theme_css":
        return window.__FIXTURE_CSS ?? "";
      default:
        return null;
    }
  },
};

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <OverlayApp />
  </React.StrictMode>,
);
