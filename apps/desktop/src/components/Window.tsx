import type { ReactNode } from "react";
import styles from "./Window.module.css";

export function Window({
  sidebar,
  children,
}: {
  sidebar: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={styles.app}>
      <div className={styles.window}>
        {sidebar}
        <main className={styles.main}>{children}</main>
      </div>
    </div>
  );
}
