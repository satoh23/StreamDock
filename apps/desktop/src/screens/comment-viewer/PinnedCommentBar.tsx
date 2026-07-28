import { useCallback, useState } from "react";
import type { CommentSource } from "../../features/comment-viewer/types";
import type { PinnedComment } from "../../features/comment-viewer/pinnedComments";
import styles from "./CommentViewerApp.module.css";
import { CommentContextMenu } from "./CommentContextMenu";
import {
  composeEventMessage,
  displayEventType,
  eventLabel,
  isMonetaryEvent,
  providerLabel,
} from "./viewerFormat";

/**
 * 046a: コメビュ本体の上部に出す固定コメント帯（コメント一覧の直上）。
 *
 * 表示専用で、固定の実体・永続化は親（`CommentViewerApp` ＋ `pinnedComments.ts`）が持つ。意匠と文言整形は
 * コメント行（`CommentList` の `renderDefaultItem`）と同じ CSS クラス（`.item`/`.badge`/`.author`/`.amount`/
 * `.text`/`.eventMessage`）と `viewerFormat.ts` のヘルパ（`eventLabel`/`displayEventType`/`isMonetaryEvent`/
 * `composeEventMessage`/`providerLabel`）を**流用**する（重複実装しない）。
 *
 * 固定が 0 件のときは何も描かない＝この機能を使わないユーザーには既存レイアウトが完全に不変
 * （帯の下端に引く divider も一緒に消える）。
 * 初見/久しぶりバッジ（038c）と combo 回数（043e）は固定帯には出さない（固定は「見失わないための再掲」で、
 * 判定バッジや観測値は流れる一覧側の役割）。
 *
 * 046a(実機確認後の修正・2026-07-28): 解除導線を**右クリックメニューに一本化**した（「固定解除」ボタンを廃止）。
 * 一覧側の行を右クリックしても解除できる（`onPin` がトグル）が、一覧は `MAX_COMMENTS`(=200) でクランプされるため
 * 固定したコメントが流れ去ると**右クリックする対象そのものが消えて解除できなくなる**。帯の側にも同じメニューを
 * 出すことでこの詰みを防ぐ。メニュー UI は `CommentList` と同じ `CommentContextMenu` を再利用する（新規依存なし）。
 */

/** 配信元バッジの色分けクラス（`CommentList` の `SOURCE_CLASS` と同型）。Record で持つので
 *  `CommentSource` に値が増えたらキー不足でコンパイルエラーになる（三項演算子だと黙って片方の色に寄る）。 */
const SOURCE_CLASS: Record<CommentSource, string> = {
  twitch: styles.srcTwitch,
  youtube: styles.srcYoutube,
};

interface PinnedCommentBarProps {
  /** 固定中のコメント（先頭＝最新）。046a では最大 1 件（`PINNED_LIMIT`）。 */
  pinned: readonly PinnedComment[];
  /** 右クリックメニューの「固定解除」を選んだときに、その id を親へ返す。 */
  onUnpin: (id: string) => void;
}

export function PinnedCommentBar({ pinned, onUnpin }: PinnedCommentBarProps) {
  // 右クリックメニューの開閉。null＝閉。開いている間だけ描く（`CommentList` と同じ作法）。
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(
    null,
  );
  // CommentContextMenu の document 購読の依存に入るため、参照を安定させる。
  const closeMenu = useCallback(() => setMenu(null), []);

  if (pinned.length === 0) return null;

  return (
    <>
      <section className={styles.pinnedBar} aria-label="固定したコメント">
        {pinned.map((p) => {
          // 043b と同じ整形（金額を持たない課金種別は要約文言・金額を持つ種別は種別ラベル＋金額バッジ＋本文）。
          const isMoney = isMonetaryEvent(p.eventType);
          const typeLabel = eventLabel(displayEventType(p));
          const eventMessage = composeEventMessage(p);
          const itemClasses = [styles.item, styles.pinnedItem];
          if (isMoney) itemClasses.push(styles.itemMonetary);
          return (
            <div
              key={p.id}
              className={itemClasses.join(" ")}
              // キーボードからも Shift+F10 / メニューキーでメニューを開けるようフォーカス可能にする
              //（解除ボタンを廃止したため、これが唯一のキーボード導線になる）。
              tabIndex={0}
              // preventDefault はこの帯の項目だけ＝アプリ全体のネイティブメニューは従来どおり出る。
              onContextMenu={(e) => {
                e.preventDefault();
                // キーボード由来の contextmenu は clientX/Y が 0 で来るため、その場合は項目の左下に出す。
                const rect = e.currentTarget.getBoundingClientRect();
                setMenu({
                  x: e.clientX || rect.left,
                  y: e.clientY || rect.bottom,
                  id: p.id,
                });
              }}
            >
              <div className={styles.meta}>
                <span className={`${styles.badge} ${styles.badgePinned}`}>
                  固定
                </span>
                <span className={`${styles.badge} ${SOURCE_CLASS[p.source]}`}>
                  {providerLabel(p.source)}
                </span>
                {typeLabel && (
                  <span className={`${styles.badge} ${styles.badgeEvent}`}>
                    {typeLabel}
                  </span>
                )}
                <span className={styles.author}>{p.author.name}</span>
                {p.monetaryAmount && (
                  <span className={styles.amount}>{p.monetaryAmount}</span>
                )}
              </div>
              {eventMessage && (
                <p className={styles.eventMessage}>{eventMessage}</p>
              )}
              {p.text && <p className={styles.text}>{p.text}</p>}
            </div>
          );
        })}
      </section>

      {/* メニューは position:fixed なので、`.pinnedBar`（max-height＋overflow-y:auto のスクロールコンテナ）の
          外に置く＝帯の中をスクロールしても取り残されない・クリップの懸念も持ち込まない（CommentList と同じ構造）。 */}
      {menu && (
        <CommentContextMenu
          x={menu.x}
          y={menu.y}
          label="固定解除"
          onSelect={() => {
            onUnpin(menu.id);
            setMenu(null);
          }}
          onDismiss={closeMenu}
        />
      )}
    </>
  );
}
