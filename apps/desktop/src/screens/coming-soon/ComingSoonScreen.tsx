import layout from "../formLayout.module.css";
import styles from "./ComingSoonScreen.module.css";

/**
 * 未実装機能の「準備中」ダミーページ。ヘッダーのセクション導線のうち
 * `implemented: false` のものから遷移する（`App.tsx` が `HEADER_SECTIONS` を引いて出し分ける）。
 * 見た目はトークンのみ・絵文字のみで、外部リソースは読み込まない。
 *
 * ⚠ 2026-08-31 時点で `HEADER_SECTIONS` は全項目が `implemented: true` なので、
 *   **この画面はどこからも出ない**（「らくらくツール設定」の削除で最後の候補が消えた）。
 *   ⚠ **器として残してある**——次に未実装のセクションを足すときにそのまま使うため。
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
