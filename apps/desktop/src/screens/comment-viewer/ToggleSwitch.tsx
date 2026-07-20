import styles from "./CommentViewerApp.module.css";

/**
 * 033c: ON/OFF トグル（アクセシブルな role="switch" ボタン）。テーマ設定の role="radio" aria-checked パターンに倣う。
 * 表示専用で、状態は親（CommentViewerApp）が保持し onChange で通知する。読み上げ（本体）と自動連携（設定）で共用する。
 *
 * 034(UI刷新): `inline` を追加。既定（false）はラベル左・トグル右の全幅 1 行（設定ビュー向け）。`inline=true` は
 * ラベルとトグルを隣接させる幅可変のコンパクト配置で、メイン画面ツールバーの右クラスタに収めるために使う。
 */
export function ToggleSwitch({
  label,
  checked,
  onChange,
  inline = false,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  inline?: boolean;
}) {
  return (
    <div className={inline ? styles.toggleRowInline : styles.toggleRow}>
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
