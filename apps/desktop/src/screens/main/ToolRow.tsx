import type { Tool } from "../../types";
import { IconTile, OrderBadge, Spinner, StatusBadge } from "../../components/primitives";
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
  order,
  editMode,
  onStart,
  onStop,
  onMoveUp,
  onMoveDown,
  onDelete,
}: {
  tool: Tool;
  index: number;
  total: number;
  order: number;
  editMode: boolean;
  onStart: () => void;
  onStop: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
}) {
  return (
    <div className={styles.tool}>
      <OrderBadge label={String(order)} />
      <IconTile glyph={tool.iconLetter} />
      <div className={styles.info}>
        <h4>{tool.name}</h4>
        <p>{tool.description}</p>
      </div>
      <StatusBadge state={tool.state} />

      <div className={styles.toolActions}>
        {editMode ? (
          <>
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
        ) : tool.state === "running" ? (
          <>
            <button className={styles.runtimeAction} title="開く">
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
        ) : tool.state === "starting" ? (
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
