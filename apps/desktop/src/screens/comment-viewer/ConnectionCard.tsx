import type { ReactNode } from "react";
import {
  deriveConnectionStatus,
  STATUS_LABEL,
  type ConnectionStatus,
} from "../../features/comment-viewer/connectionStatus";
import styles from "./CommentViewerApp.module.css";

/**
 * 042b（デザイン改修）: コメビュ本体ヘッダーのプラットフォーム別 接続ピル（Twitch / YouTube）。横長・角丸のピルを
 * ツールバー内に横並びで置き、クリックすると**ピルの真下に非モーダルのポップオーバー**（別カード）を重ねて出す
 * （`position:absolute`＝他要素の位置は動かさない）。ポップオーバーの中身（連携／取得開始／停止・device code 等）は
 * サービス固有なので `children` として受け取り、`open` のときだけ描画する（閉じている間は children＝device code も出さない）。
 *
 * 「1 つずつ開く（ラジオ排他）」「外側クリック / Esc で閉じる」は state を持つ `CommentViewerApp` 側で制御する
 * （単一 `openCard` state＋cluster ref の document リスナ）。当コンポーネントは `open` を受けてピル＋ポップオーバーを
 * 描くだけの**表示専用**で、sidecar への通信面（WS）や制御フレームは一切持たない（main 窓 no-internet 境界に影響しない）。
 *
 * 状態導出は当該サービスの取得セッション状態（`sessionState`＝session.state）のみを入力にする（`deriveConnectionStatus`）。
 * ログイン済みか／sidecar 接続済みかは「配信検知・取得」とは別概念なので混ぜない（旧 StatusIndicator と同じ扱い）。
 */

/** 状態別の円アイコン色クラス（role トークン経由・両テーマ追従）。CSS Module 結合の対応表なので当ファイルが所有する。 */
const STATUS_DOT_CLASS: Record<ConnectionStatus, string> = {
  idle: styles.dotIdle,
  connecting: styles.dotConnecting,
  connected: styles.dotConnected,
  failed: styles.dotFailed,
};

interface ConnectionCardProps {
  service: string;
  sessionState: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}

export function ConnectionCard({
  service,
  sessionState,
  open,
  onToggle,
  children,
}: ConnectionCardProps) {
  const status = deriveConnectionStatus(sessionState);
  return (
    <div className={styles.connPillWrap}>
      {/* ピル: ネイティブ button でクリック／Enter・Space／フォーカスを標準提供。状態は「色付き円＋日本語テキストラベル」で
          提示し色覚に依存しない（`STATUS_LABEL`）。aria-haspopup="dialog"＋aria-expanded で「下に開く非モーダルポップオーバー」を表す。 */}
      <button
        type="button"
        className={styles.connPill}
        onClick={onToggle}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span
          className={`${styles.statusDot} ${STATUS_DOT_CLASS[status]}`}
          aria-hidden="true"
        />
        <span className={styles.statusService}>{service}</span>
        <span className={styles.statusLabel}>{STATUS_LABEL[status]}</span>
      </button>
      {/* open のときだけ、ピルの真下にポップオーバー（別カード）を絶対配置で重ねる。閉時は非描画＝他要素の位置は動かさない。
          外側クリック / Esc・ラジオ排他は CommentViewerApp 側（cluster ref＋openCard）で制御する。 */}
      {open && (
        <div
          className={styles.connPopover}
          role="dialog"
          aria-label={`${service} 接続`}
        >
          {children}
        </div>
      )}
    </div>
  );
}
