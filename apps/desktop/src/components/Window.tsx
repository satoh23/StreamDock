import type { ReactNode } from "react";
import styles from "./Window.module.css";

export function Window({
  header,
  sidebar,
  children,
}: {
  header?: ReactNode;
  sidebar?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={styles.shell}>
      {header}
      <div className={`${styles.body} ${sidebar ? "" : styles.fullWidth}`}>
        {sidebar}
        <main className={styles.main}>{children}</main>
      </div>
    </div>
  );
}
