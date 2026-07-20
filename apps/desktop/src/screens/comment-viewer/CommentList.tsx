import { useRef } from "react";
import type { CommentViewDto } from "../../features/comment-viewer/types";
import {
  useFollowScroll,
  type FollowMode,
} from "../../features/comment-viewer/useFollowScroll";
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
  /**
   * 033f 追修正: コメント合計（「N 件」）見出しを出すか。既定 true（コメビュ本体）。OBS 用オーバーレイは
   * コメントだけ映したいので false を渡す。
   */
  showCount?: boolean;
  /**
   * 034a: 最新コメントへの自動追従モード。既定 "off"（既存挙動＝追従なし・素の `<ol>`）。コメビュ本体は
   * "release"（下端で追従・スクロールアップで解除＋「最新コメント N件 ↓」ボタン）、034b のオーバーレイは
   * "always"（常時追従・解除/ボタン無し）を渡してこの追従判定を再利用する。追従判定は
   * `useFollowScroll` に切り出してあり、CommentList は表示専用（接続/WS/TTS の業務 state を持たない）ままにする。
   */
  followMode?: FollowMode;
}

export function CommentList({
  comments,
  showCount = true,
  followMode = "off",
}: CommentListProps) {
  const olRef = useRef<HTMLOListElement>(null);
  const follow = useFollowScroll(olRef, comments, { mode: followMode });

  // 追従有無で共有する一覧本体（map は不変）。ref/onScroll は "off" のとき no-op なので付けても素の挙動のまま。
  const list = (
    <ol className={styles.list} ref={olRef} onScroll={follow.onScroll}>
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
  );

  return (
    <>
      {showCount && (
        <div className={styles.listHeader}>
          <span className={styles.count}>{comments.length} 件</span>
        </div>
      )}

      {followMode === "release" ? (
        // release のときだけ position:relative ラッパで包み、解除中に半透過黒の長丸ボタンを重ねる。
        // "off"/"always" は素の `<ol>` のまま（オーバーレイの DOM/CSS を今と同一に保つ＝非退行）。
        <div className={styles.listWrap}>
          {list}
          {/* apply-review(L3): 中央 pill は最下部近傍行に重なりうるが、解除中（スクロールアップ中）は最新行が画面外で
              実害小・一般的な "jump to latest" 挙動のため据え置く。z-index 未指定でも DOM 後置で最前面・中央寄せで
              右スクロールバーとも干渉しない。再修正トリガー: 実機で最下部行の視認性に支障が出たら list に下パディングを足す。 */}
          {!follow.following && follow.unseenCount > 0 && (
            <button
              type="button"
              className={styles.jumpButton}
              onClick={follow.jumpToLatest}
            >
              最新コメント {follow.unseenCount}件 ↓
            </button>
          )}
        </div>
      ) : (
        list
      )}
    </>
  );
}
