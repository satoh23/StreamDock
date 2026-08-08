/**
 * 060c 追修正⑥ の調査用ハーネス（**幾何を数値で出す**）。
 *
 * ⚠ 本番の配線は 1 バイトも変えない。`OverlayThemeCard` のプレビュー部（`.themePreview` ＞
 * `.sd-preview` ＞ `CommentList variant="overlay"`）と、注入パイプライン
 * （`rewriteSelectors` → `withDecorationReset` → `scopeSelectors`）だけを**同じ順序で**再現する。
 *
 * ⚠ テーマ CSS はリポジトリに置かない（第三者の著作物）。`location.hash` から流し込む。
 *
 * ## ⚠ 位置づけ（security-review 060i・Q-8・**現状は修正不要**）
 *
 * - **製品バンドルには入らない**。`vite.config.ts` に `rollupOptions.input` が無く既定エントリは root の
 *   `index.html` 1 本、`repro/` は `publicDir`（`public/`）の外。**実測**（2026-08-09・`pnpm build`）:
 *   `dist/` は `index.html` ＋ `assets/index-*.{css,js}` ＋ `public/` の中身だけで、`measure.html` は無い。
 *   ⚠ このページは `location.hash` の CSS を**特権窓と同じ形で注入する**ので、ここが崩れると
 *   「任意 CSS 注入ページが製品に入る」ことになる。**再修正トリガー**: `vite.config.ts` に
 *   `rollupOptions.input` を足す／`repro/` を `public/` へ移す変更が入ったら、`dist/` を実際に見て確認する。
 * - **`tsc` の対象外**（`tsconfig.json` の `include` が `["src"]`。`pnpm typecheck` も `pnpm build` の
 *   `tsc` も見ない。eslint は通る）。意図＝ 本番の型検査に調査用の殻を混ぜない。修正不要の理由＝
 *   製品に同梱されず、`repro/` 全体の処遇（削除 or `scripts/` へ移設）が 060c の残課題として未決だから。
 *   **再修正トリガー**: 処遇を「残す」と決めたら `include` へ `"repro"` を足す（`noUnusedLocals` があるので
 *   多少の手直しが要る）。**先に決めるべきは処遇のほうで、型検査はその後。**
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
// 060i: 課金カードには安定クラスが 1 つも無い（060f 追修正④）ので、意匠クラス（ハッシュ名）で引くしかない。
import overlayComment from "../src/screens/comment-viewer/OverlayComment.module.css";

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
    // 060i: `OverlayThemeCard` の見本と同形（本番 `wire.ts` の綴り＝`<桁区切り数値> <通貨コード>`）。
    monetaryAmount: "1,000 JPY",
    monetary: { amount: 1000, currency: "JPY" },
  },
];

/**
 * 060i: `?case=long` で **長いユーザー名 ＋ 4 桁以上の金額**に差し替える。
 *
 * 既定の 2 件（上の写し）は名前が 6 字と短いので**現象が出ない**——これが「設定プレビューでは
 * 気付けず、実機の OBS で初めて金額バッジの見切れとして現れた」理由そのものである。
 * ⚠ dev-mock の該当ケース（`seq % 20 === 1`＝赤スパ）と同じ名前・同じ額にしてある。
 */
const LONG_CASE = new URLSearchParams(location.search).get("case") === "long";
const MEASURE_COMMENTS: CommentViewDto[] = LONG_CASE
  ? [
      {
        ...PREVIEW_COMMENTS[0],
        source: "youtube",
        author: { id: "sd-preview-1", name: "ぶいちゅーばー推しのすごく長い名前" },
      },
      {
        ...PREVIEW_COMMENTS[1],
        author: { id: "sd-preview-2", name: "ぶいちゅーばー推し" },
        monetaryAmount: "20,000 JPY",
        monetary: { amount: 20000, currency: "JPY" },
      },
    ]
  : PREVIEW_COMMENTS;

/**
 * 060i: `?w=400` で **窓幅を明示する**（既定は headless の窓幅そのまま）。
 *
 * ⚠ `chrome --headless --window-size=…` は `--dump-dom` 経路では当てにならない（実測で 400 を渡しても
 * 485px で描かれた）。幅は本検査の**独立変数**（配信窓の既定は 400×720・`min_inner_size` は 240）なので、
 * ページ側で決め切る。当て先は `#root`＝**本番で `.sd-overlay` の親になる要素**なので、
 * 「窓を細くした」のと同じ条件になる（`.sd-overlay` 自身に width を書くとユーザー CSS の的を汚す）。
 */
const FORCED_WIDTH = new URLSearchParams(location.search).get("w");

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
          comments={MEASURE_COMMENTS}
          showCount={false}
          variant="overlay"
          showSource
        />
      </div>
    </div>
  );
}

// ⚠ headless の `--dump-dom` は load 時点で吐くので、**同期でコミット**させる（flushSync）。
const rootEl = document.getElementById("root") as HTMLElement;
// 060i: 窓幅の代わり（上の FORCED_WIDTH の注記を参照）。`height` は触らない（縦は本検査の対象外）。
if (FORCED_WIDTH !== null) rootEl.style.width = `${FORCED_WIDTH}px`;
const root = ReactDOM.createRoot(rootEl);
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

  // ---- 060i: 「縮められない 1fr」の検出 -------------------------------------------------
  //   判定は**幅の比較 1 本**に尽きる。`1fr`（= `minmax(auto, 1fr)`）だとグリッド列が
  //   ヘッダの min-content まで広がるので、**ヘッダ帯がカードより広くなる**。
  //   `minmax(0, 1fr)` なら列＝カード幅に固定され、flex が名前を縮めて ellipsis が出る。
  const q = <T extends Element>(sel: string) => document.querySelector<T>(sel);
  const card = q<HTMLElement>(`.${overlayComment.card}`);
  const cardHeader = q<HTMLElement>(`.${overlayComment.cardHeader}`);
  const cardName = q<HTMLElement>(`.${overlayComment.cardName}`);
  const amount = q<HTMLElement>(`.${overlayComment.amountBadge}`);
  out.push("--- 060i ---");
  if (card === null || cardHeader === null) {
    out.push("card: (absent)");
  } else {
    const cw = card.clientWidth;
    const hw = cardHeader.getBoundingClientRect().width;
    out.push(`card.clientWidth=${r(cw)} header.width=${r(hw)} overflow=${r(hw - cw)}`);
    out.push(`  ⇒ ヘッダがカードより広い: ${hw - cw > 0.5 ? "YES（列が縮められていない）" : "no"}`);
    if (amount !== null) {
      const over = amount.getBoundingClientRect().right - card.getBoundingClientRect().right;
      out.push(
        `  金額バッジ right − card right = ${r(over)} ⇒ ${over > 0.5 ? "見切れ（clip される）" : "カード内に収まる"}`,
      );
    }
    if (cardName !== null) {
      const ell = cardName.scrollWidth - cardName.clientWidth;
      out.push(
        `  cardName scrollWidth−clientWidth = ${r(ell)} ⇒ ellipsis ${ell > 0.5 ? "発動" : "未発動"}`,
      );
    }
  }
  // chat 側（同根・`<li>` ごと横に溢れる形で出る）。
  const scroller = q<HTMLElement>("[data-comment-scroll]");
  if (li !== null && scroller !== null) {
    const over = li.getBoundingClientRect().width - scroller.clientWidth;
    out.push(`chat li.width − scroller.clientWidth = ${r(over)} ⇒ ${over > 0.5 ? "はみ出し" : "収まる"}`);
    out.push(`  scroller.scrollWidth=${r(scroller.scrollWidth)} clientWidth=${r(scroller.clientWidth)}`);
    const name = q<HTMLElement>(".sd-comment-name");
    if (name !== null) {
      const ell = name.scrollWidth - name.clientWidth;
      out.push(`  chat name ellipsis ${ell > 0.5 ? "発動" : "未発動"}（差 ${r(ell)}）`);
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
