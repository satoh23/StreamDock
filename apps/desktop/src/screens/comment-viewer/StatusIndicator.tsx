import styles from "./CommentViewerApp.module.css";

/**
 * 033b: コメビュ本体（comment ビュー）の接続状態インジケータ。接続ボタンの代わりに置き、
 * 「色付き円＋テキスト」で Twitch / YouTube の接続状態を一目で分かるようにする。
 *
 * ここでの「接続」＝**配信を検知してコメントを取得している状況**を指す。各行は当該サービスの取得セッション状態
 * （sidecar の session.state）から**独立に**状態を導出し、相互参照や「取得中を 1 つだけ優先表示」ロジックを
 * 持たない。将来 Twitch/YouTube の併存・同時取得が前提になっても両行が同時に「接続済み（緑）」を表示でき、
 * UI 変更は不要。
 *
 * 接続操作（ログイン・取得開始/停止）は設定ビュー（`SettingsView`）側に集約する。ここは表示専用で、
 * sidecar への通信面（WS）は一切持たない（state は `CommentViewerApp` が保持し props で受け取るだけ）。
 */

/**
 * 導出される接続状態。色対応: 待機中=灰 / 接続中=黄 / 接続済み=緑 / 失敗=赤。「接続済み」＝配信を検知して
 * コメント取得中の状態（＝旧「取得中」）。
 *
 * この型と `deriveConnectionStatus` は **file-local（export しない）**。意図: このファイルは React コンポーネント
 * （`StatusIndicator`）を export するため、非コンポーネントを併せて export すると `react-refresh/only-export-components`
 * 警告が出る。かつ現状は他所から未参照なので公開する必要がない。**再修正トリガー**: 033c/033d/033f 等でこの導出を
 * 外部で再利用する必要が出たら、非 React ロジック用の `features/comment-viewer/` へ切り出して export する。
 */
type ConnectionStatus = "idle" | "connecting" | "connected" | "failed";

/** 状態の日本語ラベル。 */
const STATUS_LABEL: Record<ConnectionStatus, string> = {
  idle: "待機中",
  connecting: "接続中",
  connected: "接続済み",
  failed: "失敗",
};

/** 状態別の円アイコン色クラス（role トークン経由・両テーマ追従）。 */
const STATUS_DOT_CLASS: Record<ConnectionStatus, string> = {
  idle: styles.dotIdle,
  connecting: styles.dotConnecting,
  connected: styles.dotConnected,
  failed: styles.dotFailed,
};

/**
 * 1 サービス分の接続状態を導出する（サービスごとに独立・同型）。ここでの「接続」＝**配信を検知してコメントを
 * 取得している状況**なので、唯一の入力は sidecar の取得セッション状態（`sessionState`＝session.state）とする。
 * ログイン済みか（`linked`）／sidecar への WS が繋がっているか（`streamConnected`）は「配信検知・取得」とは
 * 別概念なので**判定に混ぜない**（ログインしただけ・sidecar 接続しただけでは「接続済み」にしない）。
 *
 *   - connecting: 配信をまだ検知できていないが検知しようとしている（＝接続中）
 *   - connected : 配信を検知してコメント取得中（＝接続済み）
 *   - failed    : 取得に失敗（＝失敗）
 *   - idle・その他: 配信を検知しようとしていない（＝待機中）
 *
 * **再修正トリガー**: sidecar の session.state の語彙（idle/connecting/connected/failed）が増減したら本判定を更新する。
 */
function deriveConnectionStatus(sessionState: string): ConnectionStatus {
  if (sessionState === "connecting") return "connecting";
  if (sessionState === "connected") return "connected";
  if (sessionState === "failed") return "failed";
  return "idle";
}

interface StatusRowProps {
  service: string;
  status: ConnectionStatus;
}

function StatusRow({ service, status }: StatusRowProps) {
  return (
    <div className={styles.statusRow}>
      <span
        className={`${styles.statusDot} ${STATUS_DOT_CLASS[status]}`}
        aria-hidden="true"
      />
      <span className={styles.statusService}>{service}</span>
      <span className={styles.statusLabel}>{STATUS_LABEL[status]}</span>
    </div>
  );
}

interface StatusIndicatorProps {
  twitchSessionState: string;
  youtubeSessionState: string;
}

export function StatusIndicator({
  twitchSessionState,
  youtubeSessionState,
}: StatusIndicatorProps) {
  const twitchStatus = deriveConnectionStatus(twitchSessionState);
  const youtubeStatus = deriveConnectionStatus(youtubeSessionState);
  // 状態は「色付き円＋日本語テキストラベル」で提示し色覚に依存しない（`STATUS_LABEL`）。本体は一目確認用のため
  // aria-live は付けない（状態変化の詳細通知・操作は設定ビュー側で足りる）。**再修正トリガー**: 状態変化の即時
  // 読み上げ（スクリーンリーダー通知）が要件化されたら、この wrapper に role="status" / aria-live="polite" を付す。
  return (
    <div className={styles.statusIndicator}>
      <StatusRow service="Twitch" status={twitchStatus} />
      <StatusRow service="YouTube" status={youtubeStatus} />
    </div>
  );
}
