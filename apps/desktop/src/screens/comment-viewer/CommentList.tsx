import { useRef } from "react";
import type { CommentViewDto } from "../../features/comment-viewer/types";
import {
  useFollowScroll,
  type FollowMode,
} from "../../features/comment-viewer/useFollowScroll";
import styles from "./CommentViewerApp.module.css";
import overlayStyles from "./OverlayComment.module.css";

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

/** 034e: overlay 意匠のサイト名ピルバッジの色分けクラス（Twitch=紫 / YouTube=赤）。default の SOURCE_CLASS と同型。 */
const OVERLAY_SOURCE_CLASS: Record<CommentViewDto["source"], string> = {
  twitch: overlayStyles.sourceTwitch,
  youtube: overlayStyles.sourceYoutube,
};

/** 036a: overlay アイコンの画像なしフォールバック（名前の頭文字）。features/tools の toIconLetter は
 *  ツール用の別系統なので import せず、comment-viewer 内に equivalent を持つ。
 *  配信コメントの表示名は絵文字始まりが多いため、charAt(0)（UTF-16 コードユニット＝サロゲートペアを分割し
 *  孤立サロゲート「�」になる）ではなくコードポイント単位（`[...s]`）で先頭 1 文字を取り、絵文字先頭でも壊さない。
 *  ※ツール用 toIconLetter は入力特性（アプリ名・iconLabel 前提）が異なるため据え置きで問題なく、こちらのみ配慮する。 */
const authorInitial = (name: string): string => [...name.trim()][0] ?? "?";

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
  /**
   * 034e: 表示バリアント。既定 "default"（コメビュ本体＝現行の item/meta/badge/author/text マークアップで不変）。
   * "overlay" のとき OBS オーバーレイ用のチャット意匠（アイコン枠＋名前の左カラム＋半透過グレーの吹き出しに本文）で
   * 描く。意匠クラスは OverlayComment.module.css に隔離してあり本体 CSS には波及しない。
   */
  variant?: "default" | "overlay";
  /**
   * 034e: overlay 意匠でサイト名（Twitch/YouTube）を吹き出しに小さく添えるか。既定 false。設定ビューの
   * 「サイト名を表示する」トグル値をオーバーレイ窓が渡す（受信済み source の表示のみ・新規取得はしない）。
   */
  showSource?: boolean;
}

export function CommentList({
  comments,
  showCount = true,
  followMode = "off",
  variant = "default",
  showSource = false,
}: CommentListProps) {
  const olRef = useRef<HTMLOListElement>(null);
  const follow = useFollowScroll(olRef, comments, { mode: followMode });

  // 034e(review L5・修正不要): renderDefaultItem/renderOverlayItem は毎レンダー再生成され、使わない分岐も生成される。
  // この一覧（最大 200 件クランプ）の規模では無視できるコストで、分岐マークアップを素直に読める形を優先した意図的な書き方。
  // 再修正トリガー＝将来コメント上限を大幅に増やす等で map 再生成のコストが実測で問題化したら、useCallback 化や
  // 分岐選択のメモ化を検討する。
  // 既定（コメビュ本体）のコメント項目。現行マークアップから一切変えない（本体の見た目を不変に保つ）。
  const renderDefaultItem = (c: CommentViewDto) => (
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
  );

  // 034e: OBS オーバーレイ用チャット意匠（LINE 風）。上段＝名前＋サイト名ピルバッジ（別の行）／下段＝アイコン｜吹き出し
  // （同じ行の 2 列）。吹き出し左辺のしっぽがアイコン方向へ向く。showSource=true のときだけサイト名ピルを名前の横に
  // 添える（受信済み source の表示のみ・新規取得はしない）。
  const renderOverlayItem = (c: CommentViewDto) => {
    // 036a: 描画シンクで「webview が踏むのは data URI のみ」（親 036・§CSP の不変条件）を強制する。avatar を
    // background-image に差すのは値が data: 始まりのときだけとし、それ以外（036b にバグで raw URL が漏れた等）は
    // 画像化せずイニシャルにフォールバックさせて外部 URL を踏ませない。036a では送り側未実装で avatar は常に空＝
    // この分岐は発火しない（挙動は従来のグレー丸＋イニシャルのまま）。data: 始まりでも整形済み base64 data URI か
    // 否かの検証は egress 集約点＝converter（036b）の責務で、ここは最終防波堤の型ガードに徹する。
    const avatarDataUri = c.author.avatar?.startsWith("data:")
      ? c.author.avatar
      : undefined;
    return (
      <li key={c.id} className={overlayStyles.item}>
        <div className={overlayStyles.header}>
          <span className={overlayStyles.name}>{c.author.name}</span>
          {showSource && (
            <span
              className={`${overlayStyles.source} ${OVERLAY_SOURCE_CLASS[c.source]}`}
            >
              {SOURCE_LABEL[c.source]}
            </span>
          )}
        </div>
        <div className={overlayStyles.row}>
          <div
            className={overlayStyles.icon}
            style={
              avatarDataUri
                ? { backgroundImage: `url("${avatarDataUri}")` }
                : undefined
            }
            aria-hidden="true"
          >
            {!avatarDataUri && (
              <span className={overlayStyles.iconFallback}>
                {authorInitial(c.author.name)}
              </span>
            )}
          </div>
          <div className={overlayStyles.bubble}>
            <p className={overlayStyles.text}>{c.text}</p>
          </div>
        </div>
      </li>
    );
  };

  // 追従有無で共有する一覧本体（map は不変）。ref/onScroll は "off" のとき no-op なので付けても素の挙動のまま。
  const list = (
    <ol className={styles.list} ref={olRef} onScroll={follow.onScroll}>
      {comments.length === 0 ? (
        <li className={styles.empty}>コメントはまだありません</li>
      ) : (
        comments.map(
          variant === "overlay" ? renderOverlayItem : renderDefaultItem,
        )
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
