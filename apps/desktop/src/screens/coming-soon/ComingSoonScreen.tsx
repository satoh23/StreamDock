import layout from "../formLayout.module.css";
import styles from "./ComingSoonScreen.module.css";

/**
 * 未実装機能の「準備中」ダミーページ。ヘッダーのセクション導線（らくらくツール設定 /
 * OBSエフェクト 等）から遷移する。実機能はまだ無いが、今後追加される予定であることを伝える。
 * 見た目はトークンのみ・絵文字のみで、外部リソースは読み込まない。
 */
export function ComingSoonScreen({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <>
      <div className={layout.top}>
        <div className={`${layout.title} ${layout.pageTitle}`}>
          <h2>{title}</h2>
          <p>この機能は現在準備中です。</p>
        </div>
      </div>

      <div className={styles.card}>
        <span className={styles.icon} aria-hidden="true">
          🚧
        </span>
        <p className={styles.badge}>準備中 / To be continued</p>
        {description && <p className={styles.desc}>{description}</p>}
        <p className={styles.note}>今後のアップデートで追加予定です。</p>
      </div>
    </>
  );
}
