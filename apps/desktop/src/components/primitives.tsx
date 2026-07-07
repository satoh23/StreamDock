import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { ToolState } from "../types";
import styles from "./primitives.module.css";

const STATUS_LABELS: Record<ToolState, string> = {
  running: "起動済み",
  starting: "起動中",
  // 起動要求は成功したが、アプリ側の初期ローディング完了は検知できないため
  // 完了断定の「起動済み」ではなく「起動中」を継続表示する（resting 状態）。
  launched: "起動中",
  waiting: "待機中",
  error: "エラー",
};

export function IconTile({
  glyph,
  size = "md",
}: {
  glyph: string;
  size?: "md" | "sm";
}) {
  return <div className={`${styles.iconTile} ${styles[size]}`}>{glyph}</div>;
}

export function OrderBadge({
  label,
  parallel = false,
}: {
  label: string;
  parallel?: boolean;
}) {
  return (
    <div className={`${styles.order} ${parallel ? styles.parallel : ""}`}>{label}</div>
  );
}

export function Chip({ children }: { children: ReactNode }) {
  return <span className={styles.chip}>{children}</span>;
}

export function StatusBadge({ state }: { state: ToolState }) {
  return <span className={`${styles.status} ${styles[state]}`}>{STATUS_LABELS[state]}</span>;
}

export function Spinner() {
  return <div className={styles.spinner} />;
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary";
  stopAll?: boolean;
};

export function Button({
  variant = "secondary",
  stopAll = false,
  className = "",
  children,
  ...rest
}: ButtonProps) {
  const variantClass =
    variant === "primary"
      ? `${styles.primary} ${stopAll ? styles.stopAll : ""}`
      : styles.secondary;
  return (
    <button className={`${styles.btn} ${variantClass} ${className}`} {...rest}>
      {children}
    </button>
  );
}
