import { IconTile, OrderBadge } from "./primitives";
import styles from "./PreviewCard.module.css";

export interface PreviewRowData {
  key: string;
  orderLabel: string;
  parallel?: boolean;
  iconLetter: string;
  name: string;
  description: string;
  /** 追加/新規行のハイライト表示 */
  highlight?: boolean;
}

export function PreviewCard({
  title,
  name,
  count,
  rows,
  help,
  emptyMessage,
}: {
  title: string;
  /** preview-name ボックス (プリセット追加で使用) */
  name?: string;
  count?: string;
  rows: PreviewRowData[];
  help?: string;
  emptyMessage?: string;
}) {
  return (
    <aside className={`${styles.panel} ${styles.previewCard}`}>
      <div className={styles.previewTitle}>{title}</div>

      {name !== undefined && (
        <div className={styles.previewName}>
          <h3>{name}</h3>
          {count !== undefined && <p>{count}</p>}
        </div>
      )}

      {rows.length === 0 && emptyMessage ? (
        <div className={styles.emptyPreview}>{emptyMessage}</div>
      ) : (
        rows.map((row) => (
          <div
            key={row.key}
            className={`${styles.previewRow} ${row.highlight ? styles.newRow : ""}`}
          >
            <OrderBadge label={row.orderLabel} parallel={row.parallel} />
            <IconTile glyph={row.iconLetter} size="sm" />
            <div>
              <h4>{row.name}</h4>
              <p>{row.description}</p>
            </div>
          </div>
        ))
      )}

      {help && <div className={styles.plainHelp}>{help}</div>}
    </aside>
  );
}
