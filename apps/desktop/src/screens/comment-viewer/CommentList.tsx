import type { CommentViewDto } from "../../features/comment-viewer/types";
import styles from "./CommentViewerApp.module.css";

/**
 * 033b: 受信コメントの一覧描画（listHeader の総数＋`<ol>` 本体）。`CommentViewerApp` の肥大化対策で切り出した
 * 表示専用コンポーネント（state を持たず props の `comments` を描画するだけ）。033f（OBS 透過オーバーレイ）が
 * この一覧描画を再利用する。
 */

/** 配信元の表示ラベル。 */
const SOURCE_LABEL: Record<CommentViewDto["source"], string> = {
  twitch: "Twitch",
  youtube: "YouTube",
};

/** 配信元バッジの色分けクラス。 */
const SOURCE_CLASS: Record<CommentViewDto["source"], string> = {
  twitch: styles.srcTwitch,
  youtube: styles.srcYoutube,
};

interface CommentListProps {
  comments: CommentViewDto[];
}

export function CommentList({ comments }: CommentListProps) {
  return (
    <>
      <div className={styles.listHeader}>
        <span className={styles.count}>{comments.length} 件</span>
      </div>

      <ol className={styles.list}>
        {comments.length === 0 ? (
          <li className={styles.empty}>コメントはまだありません</li>
        ) : (
          comments.map((c) => (
            <li key={c.id} className={styles.item}>
              <div className={styles.meta}>
                <span className={`${styles.badge} ${SOURCE_CLASS[c.source]}`}>
                  {SOURCE_LABEL[c.source]}
                </span>
                <span className={styles.author}>{c.author.name}</span>
                {c.monetaryAmount && (
                  <span className={styles.amount}>{c.monetaryAmount}</span>
                )}
              </div>
              <p className={styles.text}>{c.text}</p>
            </li>
          ))
        )}
      </ol>
    </>
  );
}
