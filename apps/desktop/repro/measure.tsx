/**
 * 060c 追修正⑥ の調査用ハーネス（**幾何を数値で出す**）。
 *
 * ⚠ 本番の配線は 1 バイトも変えない。`OverlayThemeCard` のプレビュー部（`.themePreview` ＞
 * `.sd-preview` ＞ `CommentList variant="overlay"`）と、注入パイプライン
 * （`rewriteSelectors` → `withDecorationReset` → `scopeSelectors`）だけを**同じ順序で**再現する。
 *
 * ⚠ テーマ CSS はリポジトリに置かない（第三者の著作物）。`location.hash` から流し込む。
 *
 * 使い方:
 *   pnpm --filter ./apps/desktop dev
 *   chrome --headless --dump-dom "http://localhost:1420/repro/measure.html#<encodeURIComponent(css)>"
 */
import React from "react";
import ReactDOM from "react-dom/client";
import { flushSync } from "react-dom";
import "../src/styles/theme.css";
import type { CommentViewDto } from "../src/features/comment-viewer/types";
import { rewriteSelectors } from "../src/features/comment-viewer/cssCompat";
import { withDecorationReset } from "../src/features/comment-viewer/overlayThemeReset";
import {
  OVERLAY_ROOT_SELECTOR,
  PREVIEW_SCOPE_CLASS,
  PREVIEW_SCOPE_SELECTOR,
  rewriteRootLike,
  scopeSelectors,
} from "../src/features/comment-viewer/cssScope";
import { resolveOverlayFontStack } from "../src/features/comment-viewer/overlaySettings";
import { CommentList } from "../src/screens/comment-viewer/CommentList";
import styles from "../src/screens/comment-viewer/CommentViewerApp.module.css";
import overlayRoot from "../src/screens/comment-viewer/OverlayApp.module.css";

// ⚠ `OverlayThemeCard` の PREVIEW_COMMENTS と同じ 2 件（export されていないので写し）。
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

/** `?mode=overlay` で配信窓（OBS）側の注入経路を再現する。既定はプレビュー。 */
const OVERLAY_MODE = new URLSearchParams(location.search).get("mode") === "overlay";
const ROOT_CLASS = OVERLAY_MODE ? "sd-overlay" : PREVIEW_SCOPE_CLASS;

const rawCss = decodeURIComponent(location.hash.slice(1));

if (rawCss.trim() !== "") {
  const el = document.createElement("style");
  el.dataset.sdPreviewTheme = "";
  // ⚠ 順序も本番どおり（プレビュー＝reset→scope／配信窓＝rootLike→reset）。
  el.textContent = OVERLAY_MODE
    ? withDecorationReset(
        rewriteRootLike(rewriteSelectors(rawCss).css, OVERLAY_ROOT_SELECTOR),
      )
    : scopeSelectors(
        withDecorationReset(rewriteSelectors(rawCss).css),
        PREVIEW_SCOPE_SELECTOR,
      );
  document.head.appendChild(el);
}

// eslint-disable-next-line react-refresh/only-export-components -- 調査用の使い捨てエントリ（HMR 不要）
function Harness() {
  return (
    <div className={OVERLAY_MODE ? undefined : styles.themePreview}>
      <div
        className={
          OVERLAY_MODE ? `${overlayRoot.root} sd-overlay` : PREVIEW_SCOPE_CLASS
        }
        style={{ fontFamily: resolveOverlayFontStack("system") }}
      >
        <CommentList
          comments={PREVIEW_COMMENTS}
          showCount={false}
          variant="overlay"
          showSource
        />
      </div>
    </div>
  );
}

// ⚠ headless の `--dump-dom` は load 時点で吐くので、**同期でコミット**させる（flushSync）。
const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);
flushSync(() => {
  root.render(<Harness />);
});

// --- 計測 -------------------------------------------------------------------------------
const r = (n: number) => Math.round(n * 100) / 100;

function report(): string {
  const out: string[] = [];
  const wrap = document.querySelector(`.${ROOT_CLASS}`);
  if (wrap === null) return "NO_WRAPPER";
  const base = wrap.getBoundingClientRect();
  const rel = (el: Element | null, label: string) => {
    if (el === null) {
      out.push(`${label}: (absent)`);
      return null;
    }
    const b = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    out.push(
      `${label}: x=${r(b.left - base.left)} y=${r(b.top - base.top)} w=${r(b.width)} h=${r(b.height)} display=${cs.display}`,
    );
    return { b, cs };
  };

  const li = document.querySelector("li.sd-comment-chat");
  const liInfo = rel(li, "li.sd-comment-chat");
  rel(document.querySelector(".sd-comment-header"), "  header");
  rel(document.querySelector(".sd-comment-name"), "  name");
  const src = rel(document.querySelector(".sd-comment-source"), "  source(pill)");
  rel(document.querySelector(".sd-comment-icon"), "  icon");
  rel(document.querySelector(".sd-comment-row"), "  row");
  rel(document.querySelector(".sd-comment-body"), "  body(p)");

  if (li !== null && liInfo !== null) {
    const cs = getComputedStyle(li, "::before");
    out.push(
      `  li::before computed: content=${cs.content} position=${cs.position} top=${cs.top} left=${cs.left} w=${cs.width} h=${cs.height} bg=${cs.backgroundColor}`,
    );
    // 絶対配置の包含ブロック＝ li のパディングボックス。
    const liCs = liInfo.cs;
    const px = (v: string) => parseFloat(v) || 0;
    const padBoxLeft =
      liInfo.b.left - base.left + px(liCs.borderLeftWidth);
    const padBoxTop = liInfo.b.top - base.top + px(liCs.borderTopWidth);
    const barX = padBoxLeft + px(cs.left);
    const barY = padBoxTop + px(cs.top);
    const barW = px(cs.width);
    const barH = px(cs.height);
    out.push(
      `  li::before rect(推定): x=${r(barX)} y=${r(barY)} w=${r(barW)} h=${r(barH)} → x2=${r(barX + barW)} y2=${r(barY + barH)}`,
    );
    if (src !== null) {
      const sx = src.b.left - base.left;
      const sy = src.b.top - base.top;
      const ox = Math.min(sx + src.b.width, barX + barW) - Math.max(sx, barX);
      const oy = Math.min(sy + src.b.height, barY + barH) - Math.max(sy, barY);
      out.push(
        `  ⇒ pill×bar overlap: dx=${r(ox)} dy=${r(oy)} => ${ox > 0 && oy > 0 ? "OVERLAP" : "no overlap"}`,
      );
    }
  }
  return out.join("\n");
}

// ⚠ headless では rAF もタイマーも当てにならないので、**同期で 1 回**測る
//   （React 19 の createRoot().render() は同期でコミットされるので、この時点で DOM は在る）。
const write = (tag: string) => {
  const pre = document.getElementById("sd-measure");
  if (pre === null) return;
  try {
    pre.textContent = `[${tag}]\n${report()}`;
  } catch (e) {
    pre.textContent = `[${tag}] THREW: ${String(e)}`;
  }
};
write("sync");
setTimeout(() => write("t600"), 600);
