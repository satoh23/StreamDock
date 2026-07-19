import styles from "./CommentViewerApp.module.css";

/**
 * 033c: ON/OFF トグル（アクセシブルな role="switch" ボタン）。テーマ設定の role="radio" aria-checked パターンに倣う。
 * 表示専用で、状態は親（CommentViewerApp）が保持し onChange で通知する。読み上げ（本体）と自動連携（設定）で共用する。
 */
export function ToggleSwitch({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className={styles.toggleRow}>
      <span className={styles.toggleLabel}>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={`${styles.switch} ${checked ? styles.switchOn : ""}`}
        onClick={() => onChange(!checked)}
      >
        <span className={styles.knob} aria-hidden="true" />
      </button>
    </div>
  );
}
