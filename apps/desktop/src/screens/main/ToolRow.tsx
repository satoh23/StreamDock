import type { Tool } from "../../types";
import { IconTile, OrderBadge, Spinner, StatusBadge } from "../../components/primitives";
import { iconDataUri } from "../../features/tools/display";
import styles from "./MainScreen.module.css";

function OpenIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 7h8v8" />
      <path d="M17 7 7 17" />
      <path d="M6 8.5v8.5c0 .55.45 1 1 1h8.5" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <rect x="7" y="7" width="10" height="10" rx="2" />
    </svg>
  );
}

function StartIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 5.5v13l10-6.5-10-6.5Z" />
    </svg>
  );
}

export function ToolRow({
  tool,
  index,
  total,
  orderLabel,
  parallel,
  editMode,
  onStart,
  onStop,
  onOpen,
  onMoveUp,
  onMoveDown,
  onToggleMode,
  onDelete,
}: {
  tool: Tool;
  index: number;
  total: number;
  orderLabel: string;
  parallel: boolean;
  editMode: boolean;
  onStart: () => void;
  onStop: () => void;
  onOpen: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onToggleMode: () => void;
  onDelete: () => void;
}) {
  return (
    <div className={styles.tool}>
      <OrderBadge label={orderLabel} parallel={parallel} />
      <IconTile glyph={tool.iconLetter} imageSrc={iconDataUri(tool.iconPng)} />
      <div className={styles.info}>
        <h4>{tool.name}</h4>
        <p>{parallel ? "順番なしで並行起動" : tool.description}</p>
      </div>
      {/* 023: url 種別は PID 管理下に入らないため status バッジを出さない。ただしグリッドの status 列
          セルは空で占有し、アクション列（toolActions）が PC アプリ行と同じ位置に揃うようにする。 */}
      {tool.kind === "url" ? <span aria-hidden /> : <StatusBadge state={tool.state} />}

      <div className={styles.toolActions}>
        {editMode ? (
          <>
            <button
              className={styles.modeToggle}
              onClick={onToggleMode}
              title={parallel ? "起動順を付ける" : "並行起動にする"}
            >
              {parallel ? "番号を付ける" : "並行にする"}
            </button>
            <button
              className={`${styles.move} ${index === 0 ? styles.disabled : ""}`}
              onClick={onMoveUp}
              title="上に移動"
            >
              ↑
            </button>
            <button
              className={`${styles.move} ${index === total - 1 ? styles.disabled : ""}`}
              onClick={onMoveDown}
              title="下に移動"
            >
              ↓
            </button>
            <button className={styles.delete} onClick={onDelete} title="削除">
              ×
            </button>
          </>
        ) : tool.kind === "url" ? (
          // 023: url 種別は state に依らず起動ボタンだけを出す（停止/状態表示なし・MVP: 開くのみ）。
          // マーク・ラベルは PC アプリの未起動時ボタンと統一する（StartIcon / 「起動」）。
          <button
            className={`${styles.runtimeAction} ${styles.startBtn}`}
            onClick={onOpen}
            title="起動"
          >
            <StartIcon />
          </button>
        ) : tool.state === "running" || tool.state === "launched" ? (
          <>
            <button
              className={styles.runtimeAction}
              onClick={onOpen}
              title="開く"
            >
              <OpenIcon />
            </button>
            <button
              className={`${styles.runtimeAction} ${styles.stopBtn}`}
              onClick={onStop}
              title="停止"
            >
              <StopIcon />
            </button>
          </>
        ) : tool.state === "starting" || tool.state === "stopping" ? (
          // 起動要求送信中（starting）／停止要求送信中（stopping）はボタンを Spinner に置き換えて無効化する。
          <div className={styles.loadingAction}>
            <Spinner />
          </div>
        ) : (
          <button
            className={`${styles.runtimeAction} ${styles.startBtn}`}
            onClick={onStart}
            title="起動"
          >
            <StartIcon />
          </button>
        )}
      </div>
    </div>
  );
}
