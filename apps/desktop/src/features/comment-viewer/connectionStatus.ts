/**
 * 033b/042b: コメビュ本体の接続状態導出（非 React ロジック）。もとは `StatusIndicator.tsx` の file-local だったが、
 * 042b で本体のプラットフォーム別カード（`ConnectionCard`）が折りたたみ頭の状態表示に再利用するため、同ファイルの
 * docstring の指示どおり非 React ロジック用の `features/comment-viewer/` へ切り出して export する。ここは表示専用の
 * 純導出で、sidecar への通信面（WS）は一切持たない（state は `CommentViewerApp` が保持し、値だけを受け取る）。
 *
 * 非コンポーネントファイルなので `react-refresh/only-export-components` の対象外＝export しても lint を壊さない。
 */

/**
 * 導出される接続状態。色対応: 待機中=灰 / 接続中=黄 / 接続済み=緑 / 失敗=赤。「接続済み」＝配信を検知して
 * コメント取得中の状態（＝旧「取得中」）。
 */
export type ConnectionStatus = "idle" | "connecting" | "connected" | "failed";

/** 状態の日本語ラベル。 */
export const STATUS_LABEL: Record<ConnectionStatus, string> = {
  idle: "待機中",
  connecting: "接続中",
  connected: "接続済み",
  failed: "失敗",
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
export function deriveConnectionStatus(sessionState: string): ConnectionStatus {
  if (sessionState === "connecting") return "connecting";
  if (sessionState === "connected") return "connected";
  if (sessionState === "failed") return "failed";
  return "idle";
}
