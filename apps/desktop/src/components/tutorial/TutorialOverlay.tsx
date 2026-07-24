import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTutorial } from "../../features/tutorial/useTutorial";
import styles from "./TutorialOverlay.module.css";

/** スポットライトの穴（ビューポート座標）。 */
type Hole = { top: number; left: number; width: number; height: number };

/** 穴まわりの余白（対象を少しだけ広く見せる）。ヘッダー対象は隣接リンク漏れ防止で 0。 */
const PAD = 6;
/** 吹き出しの配置計算に使う目安値。 */
const BH = 180; // 吹き出し高さ見積り
const BW_SIDE = 300; // 横配置時の幅
const BW_MAIN = 360; // 上下配置時の幅
const GAP = 16; // 穴と吹き出しの間隔（上下配置）
const SIDE_GAP = 46; // 穴と吹き出しの間隔（横配置。インジケータが収まる幅）
const IND = 30; // インジケータ（絵文字）の見た目幅
const M = 12; // viewport 端からの最小余白

type Placement = "below" | "above" | "right" | "left";

/**
 * 吹き出し／インジケータの配置を、空きスペースに応じて 下→上→右→左 の順で選ぶ。
 * 縦の余白が足りない縦長ターゲット（フォームパネル）では自動的に横へ回り込む。
 */
function computePlacement(
  top: number,
  left: number,
  right: number,
  bottom: number,
  innerW: number,
  innerH: number,
) {
  const spaceBelow = innerH - bottom;
  const spaceAbove = top;
  const spaceRight = innerW - right;
  const spaceLeft = left;
  const cx = (left + right) / 2;
  const cy = (top + bottom) / 2;

  let placement: Placement;
  if (spaceBelow >= BH + GAP) placement = "below";
  else if (spaceAbove >= BH + GAP) placement = "above";
  else if (spaceRight >= BW_SIDE + SIDE_GAP) placement = "right";
  else if (spaceLeft >= BW_SIDE + SIDE_GAP) placement = "left";
  else {
    const max = Math.max(spaceBelow, spaceAbove, spaceRight, spaceLeft);
    placement =
      max === spaceBelow
        ? "below"
        : max === spaceAbove
          ? "above"
          : max === spaceRight
            ? "right"
            : "left";
  }

  const clampX = (x: number) =>
    Math.min(Math.max(x, M), Math.max(M, innerW - BW_MAIN - M));
  const clampY = (y: number) =>
    Math.min(Math.max(y, M), Math.max(M, innerH - BH - M));

  const isSide = placement === "right" || placement === "left";
  let bubbleStyle: React.CSSProperties;
  let indicatorStyle: React.CSSProperties;
  let indicatorChar: string;
  // 横配置は穴〜吹き出しの隙間にインジケータが収まる時だけ表示（被り防止）。上下は常に表示。
  let showIndicator = true;

  if (placement === "below") {
    bubbleStyle = { left: clampX(left), top: Math.min(bottom + 38, innerH - 60) };
    indicatorChar = "👆";
    indicatorStyle = { left: cx - 15, top: bottom + 6 };
  } else if (placement === "above") {
    bubbleStyle = { left: clampX(left), bottom: Math.max(M, innerH - top + 38) };
    indicatorChar = "👇";
    indicatorStyle = { left: cx - 15, top: top - 36 };
  } else if (placement === "right") {
    const bubbleLeft = Math.min(right + SIDE_GAP, innerW - BW_SIDE - M);
    const gapW = bubbleLeft - right;
    bubbleStyle = { left: bubbleLeft, top: clampY(cy - BH / 2) };
    indicatorChar = "👈";
    // 穴と吹き出しの隙間の中央へ置く（吹き出しへ被らない）。
    indicatorStyle = { left: right + Math.max(2, (gapW - IND) / 2), top: cy - 15 };
    showIndicator = gapW >= IND + 8;
  } else {
    const bubbleLeft = Math.max(M, left - SIDE_GAP - BW_SIDE);
    const bubbleRight = bubbleLeft + BW_SIDE;
    const gapW = left - bubbleRight;
    bubbleStyle = { left: bubbleLeft, top: clampY(cy - BH / 2) };
    indicatorChar = "👉";
    indicatorStyle = { left: bubbleRight + Math.max(2, (gapW - IND) / 2), top: cy - 15 };
    showIndicator = gapW >= IND + 8;
  }

  return { isSide, bubbleStyle, indicatorStyle, indicatorChar, showIndicator };
}

/**
 * 027 First-Run Tutorial のオーバーレイ。#root へ portal し、対象要素を
 * 上下左右 4 枚パネルの穴あきディムでハイライトする。
 * - spotlight-action: 穴を空けて対象がネイティブにクリックを受ける。
 * - spotlight-info  : 穴に透明ブロッカーを重ねてクリック不可にする。
 * - dialog / 対象未検出: 全面ディム＋中央カードにフォールバックする。
 *
 * 本文（.main）はスクロールしヘッダー配下へ潜り込むため、ヘッダー以外を対象とするステップでは
 * 穴の上端をヘッダー下端でクランプし、上側ディムパネルが常にヘッダーを覆う（誤クリック防止）。
 */
export function TutorialOverlay() {
  const { active, currentStep, advance, skip } = useTutorial();
  const [hole, setHole] = useState<Hole | null>(null);
  const [headerBottom, setHeaderBottom] = useState(0);
  const rafRef = useRef<number | null>(null);

  const targetId = currentStep?.targetId;

  const measure = useCallback(() => {
    const header = document.querySelector("header");
    setHeaderBottom(header ? header.getBoundingClientRect().bottom : 0);
    if (!targetId) {
      setHole(null);
      return;
    }
    const el = document.querySelector(`[data-tutorial-id="${targetId}"]`);
    if (!el) {
      setHole(null);
      return;
    }
    const r = el.getBoundingClientRect();
    setHole({ top: r.top, left: r.left, width: r.width, height: r.height });
  }, [targetId]);

  const scheduleMeasure = useCallback(() => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      measure();
    });
  }, [measure]);

  // step 変化・resize・scroll・対象のサイズ変化で穴を再計測する。
  useEffect(() => {
    if (!active) return;
    scheduleMeasure();
    if (!targetId) return;
    const el = document.querySelector(`[data-tutorial-id="${targetId}"]`);
    window.addEventListener("resize", scheduleMeasure);
    window.addEventListener("scroll", scheduleMeasure, true);
    let observer: ResizeObserver | undefined;
    if (el && typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(scheduleMeasure);
      observer.observe(el);
    }
    return () => {
      window.removeEventListener("resize", scheduleMeasure);
      window.removeEventListener("scroll", scheduleMeasure, true);
      observer?.disconnect();
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [active, targetId, scheduleMeasure]);

  // target-click ステップは対象クリックをキャプチャして進む（実操作は通常どおり実行される）。
  useEffect(() => {
    if (!active || !currentStep) return;
    const a = currentStep.advanceOn;
    if (a.kind !== "target-click") return;
    const clickId = a.clickId ?? currentStep.targetId;
    if (!clickId) return;
    const onClick = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && el.closest(`[data-tutorial-id="${clickId}"]`)) advance();
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [active, currentStep, advance]);

  // target-appears ステップは、指定要素が DOM に現れたら進む（例: プリセット Step1→Step2 の遷移＝
  // バリデーション通過。クリックだけでは進めず、画面と説明の食い違いを防ぐ）。
  useEffect(() => {
    if (!active || !currentStep) return;
    const a = currentStep.advanceOn;
    if (a.kind !== "target-appears") return;
    const appearId = a.appearId;
    const exists = () =>
      !!document.querySelector(`[data-tutorial-id="${appearId}"]`);
    if (exists()) {
      advance();
      return;
    }
    const observer = new MutationObserver(() => {
      if (exists()) advance();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [active, currentStep, advance]);

  if (!active || !currentStep) return null;
  const root = document.getElementById("root");
  if (!root) return null;

  const showNext = currentStep.advanceOn.kind === "next";
  const isAction = currentStep.mode === "spotlight-action";
  const isInfo = currentStep.mode === "spotlight-info";
  const isHeaderTarget = !!targetId?.startsWith("header-");

  const skipButton = (
    <button type="button" className={styles.skip} onClick={skip}>
      チュートリアルをスキップ
    </button>
  );

  const cardInner = (
    <>
      {currentStep.title && <h3 className={styles.title}>{currentStep.title}</h3>}
      <p className={styles.body}>{currentStep.body}</p>
      {showNext && (
        <div className={styles.actions}>
          <button type="button" className={styles.nextBtn} onClick={advance}>
            次へ
          </button>
        </div>
      )}
    </>
  );

  // dialog / 対象未検出 / 穴がヘッダー裏に隠れて可視領域が無い場合の中央カードフォールバック。
  const renderCentered = () =>
    createPortal(
      <div className={styles.overlay}>
        {/* ディム部分はウィンドウのドラッグ面にする（ヘッダー同様）。カード内のボタンは
            Tauri 側で clickable 要素として drag より優先されるため個別対応は不要。 */}
        <div className={styles.dialogDim} data-tauri-drag-region>
          <div className={styles.card}>
            {cardInner}
            {/* 進行が止まらないよう、next を持たないステップでも「次へ」を出す。 */}
            {!showNext && (
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.nextBtn}
                  onClick={advance}
                >
                  次へ
                </button>
              </div>
            )}
          </div>
        </div>
        {skipButton}
      </div>,
      root,
    );

  if (currentStep.mode === "dialog" || !hole) {
    return renderCentered();
  }

  const innerW = window.innerWidth;
  const innerH = window.innerHeight;
  const pad = isHeaderTarget ? 0 : PAD;
  // ヘッダー以外の対象では、穴の上端をヘッダー下端でクランプ（上ディムパネルが常にヘッダーを覆う）。
  const topClamp = isHeaderTarget ? 0 : headerBottom;
  const top = Math.max(0, hole.top - pad, topClamp);
  const left = Math.max(0, hole.left - pad);
  const right = Math.min(innerW, hole.left + hole.width + pad);
  const bottom = Math.min(innerH, hole.top + hole.height + pad);
  const holeW = right - left;
  const holeH = bottom - top;

  // クランプで可視領域が消えた（対象が完全にヘッダー裏へスクロール）場合は中央カードへ。
  if (holeW <= 0 || holeH <= 0) {
    return renderCentered();
  }

  const { isSide, bubbleStyle, indicatorStyle, indicatorChar, showIndicator } =
    computePlacement(top, left, right, bottom, innerW, innerH);

  return createPortal(
    <div className={styles.overlay}>
      {/* 穴の外側 4 枚（ディム＋外側クリック遮断）。ディムはウィンドウのドラッグ面にする
          （ヘッダーを覆う上パネル含む）。穴内の実対象は BUTTON 等として drag より優先される。
          ダブルクリックで最大化トグル（internal_toggle_maximize）が発火するのは意図どおり
          ＝タイトルバー相当。自ウィンドウの最大化状態のみを変え、drag.js が stopImmediatePropagation
          するため配下 UI のクリック遮断意図には波及しない。この最大化挙動が UX 上問題化したら、
          各ディムに onDoubleClick で preventDefault/stopPropagation を噛ませて抑止する。 */}
      <div className={styles.panel} style={{ top: 0, left: 0, width: innerW, height: top }} data-tauri-drag-region />
      <div
        className={styles.panel}
        style={{ top: bottom, left: 0, width: innerW, height: Math.max(0, innerH - bottom) }}
        data-tauri-drag-region
      />
      <div className={styles.panel} style={{ top, left: 0, width: left, height: holeH }} data-tauri-drag-region />
      <div
        className={styles.panel}
        style={{ top, left: right, width: Math.max(0, innerW - right), height: holeH }}
        data-tauri-drag-region
      />

      {/* spotlight-info は穴に透明ブロッカーを重ねてクリック不可にする。ここもドラッグ可にして
          「クリックもドラッグも効かない死に領域」を作らない。 */}
      {isInfo && (
        <div
          className={styles.blocker}
          style={{ top, left, width: holeW, height: holeH }}
          data-tauri-drag-region
        />
      )}

      {/* 穴の縁を強調するリング（クリック透過）。 */}
      <div className={styles.ring} style={{ top, left, width: holeW, height: holeH }} />

      {/* クリック可ステップの誘導インジケータ（配置方向に応じた向き）。 */}
      {isAction && showIndicator && (
        <div
          className={`${styles.indicator} ${isSide ? styles.indicatorSide : ""}`}
          style={indicatorStyle}
          aria-hidden="true"
        >
          {indicatorChar}
        </div>
      )}

      {/* 吹き出し。 */}
      <div
        className={`${styles.card} ${styles.bubble} ${isSide ? styles.bubbleSide : ""}`}
        style={bubbleStyle}
      >
        {cardInner}
      </div>

      {skipButton}
    </div>,
    root,
  );
}
