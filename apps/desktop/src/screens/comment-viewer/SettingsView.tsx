import type { DeviceCodePrompt } from "../../features/comment-viewer/commentStream";
import { ToggleSwitch } from "./ToggleSwitch";
import styles from "./CommentViewerApp.module.css";

/**
 * 033b: コメビュ窓内の「設定ビュー」。本体（comment ビュー）から歯車ボタンで切り替えて表示し、Twitch/YouTube の
 * 接続・チャンネル入力・取得開始/停止・Device Code 提示をここに集約する（本体には接続ボタンを置かない）。
 *
 * このコンポーネントは**表示専用**で、sidecar への通信面（WS）や制御フレームは一切持たない。接続状態 state は
 * `CommentViewerApp` が保持し、既存ハンドラ（`handleTwitchConnect` / `handleStartSession` / `handleStopSession` /
 * `handleYouTubeConnect` / `handleYouTubeStartSession` / `handleYouTubeStopSession`）を props でそのまま受け取って
 * 呼ぶだけ。よって WS 接続は窓内 1 本のまま・宛先も不変で、メイン窓 no-internet 境界に影響しない。
 */

/** 取得セッション状態の日本語ラベル（sidecar の session.state に対応）。 */
const SESSION_STATE_LABEL: Record<string, string> = {
  idle: "待機",
  connecting: "接続中",
  connected: "取得中",
  failed: "失敗",
};

interface SettingsViewProps {
  onBack: () => void;
  streamConnected: boolean;
  // Twitch
  linked: boolean;
  sessionState: string;
  sessionReason: string | null;
  deviceCode: DeviceCodePrompt | null;
  channel: string;
  onChannelChange: (value: string) => void;
  onTwitchConnect: () => void;
  onStartSession: () => void;
  onStopSession: () => void;
  // YouTube
  youtubeLinked: boolean;
  youtubeSessionState: string;
  youtubeSessionReason: string | null;
  onYouTubeConnect: () => void;
  onYouTubeStartSession: () => void;
  onYouTubeStopSession: () => void;
  // 033c: VOICEVOX 自動連携 ON/OFF（読み上げトグルは本体コメントビューへ・state は CommentViewerApp が保持）。
  voicevoxAutolink: boolean;
  onVoicevoxAutolinkChange: (value: boolean) => void;
}

export function SettingsView({
  onBack,
  streamConnected,
  linked,
  sessionState,
  sessionReason,
  deviceCode,
  channel,
  onChannelChange,
  onTwitchConnect,
  onStartSession,
  onStopSession,
  youtubeLinked,
  youtubeSessionState,
  youtubeSessionReason,
  onYouTubeConnect,
  onYouTubeStartSession,
  onYouTubeStopSession,
  voicevoxAutolink,
  onVoicevoxAutolinkChange,
}: SettingsViewProps) {
  return (
    <div className={styles.settingsView}>
      <div className={styles.settingsHeader}>
        <button
          type="button"
          className={styles.iconBtn}
          onClick={onBack}
          title="コメントに戻る"
          aria-label="コメントに戻る"
        >
          ←
        </button>
        <h1 className={styles.settingsTitle}>設定</h1>
      </div>

      {/* 032c-b: Twitch 連携（Device Code ログイン → チャンネル指定で取得開始）。ユーザー明示操作でのみ発火。 */}
      <div className={styles.twitchPanel}>
        <div className={styles.twitchRow}>
          <button
            type="button"
            className={styles.btn}
            onClick={onTwitchConnect}
            disabled={!streamConnected || linked}
          >
            {linked ? "接続済み" : "Twitch に接続"}
          </button>
          <input
            type="text"
            className={styles.input}
            placeholder="チャンネル名（例: shroud）"
            value={channel}
            onChange={(e) => onChannelChange(e.target.value)}
          />
          <button
            type="button"
            className={styles.btn}
            onClick={onStartSession}
            disabled={!streamConnected || !linked || channel.trim() === ""}
          >
            コメント取得開始
          </button>
          <button
            type="button"
            className={styles.btnGhost}
            onClick={onStopSession}
            disabled={!streamConnected}
          >
            停止
          </button>
          {/* 032c-b: sidecar 未接続（streamConnected=false）のときは session.state（既定 idle=「待機」）を
              出すと「準備完了なのに無反応」に見えてしまう（今回の無反応バグの温床）。接続確立までは
              接続状態を優先表示し、上のボタン群の disabled 表示（:disabled のグレーアウト）と合わせて
              「まだ操作できない」ことを可視化する。接続確立後は従来どおり取得セッション状態を表示する。 */}
          <span className={styles.status}>
            状態:{" "}
            {!streamConnected
              ? "コメント取得プロセスに接続中…"
              : `${SESSION_STATE_LABEL[sessionState] ?? sessionState}${
                  sessionReason ? `（${sessionReason}）` : ""
                }`}
          </span>
        </div>
        {deviceCode && (
          <div className={styles.deviceCode} role="status">
            <span className={styles.deviceCodeLabel}>
              下記 URL をブラウザで開き、次のコードを入力して連携を許可してください:
            </span>
            <span className={styles.codeValue}>{deviceCode.userCode}</span>
            <span className={styles.verifyUri}>{deviceCode.verificationUri}</span>
          </div>
        )}
      </div>

      {/* 032c-d: YouTube 連携（Authorization Code ログイン → ブラウザ同意 → 取得開始）。Twitch と併存・各サービス
          個別選択（同時取得はしない）。チャンネル名入力は不要（mine=true の自アカウントのアクティブ配信）。
          認可画面は Rust がシステムブラウザで accounts.google.com を開く（sidecar は URL に触らず・
          code_verifier は載らない）。ユーザー明示操作でのみ発火する（§1）。 */}
      <div className={styles.youtubePanel}>
        <div className={styles.youtubeRow}>
          <button
            type="button"
            className={styles.btn}
            onClick={onYouTubeConnect}
            disabled={!streamConnected || youtubeLinked}
          >
            {youtubeLinked ? "YouTube 接続済み" : "YouTube に接続"}
          </button>
          <button
            type="button"
            className={styles.btn}
            onClick={onYouTubeStartSession}
            disabled={!streamConnected || !youtubeLinked}
          >
            コメント取得開始
          </button>
          <button
            type="button"
            className={styles.btnGhost}
            onClick={onYouTubeStopSession}
            disabled={!streamConnected}
          >
            停止
          </button>
          <span className={styles.status}>
            状態:{" "}
            {!streamConnected
              ? "コメント取得プロセスに接続中…"
              : !youtubeLinked && youtubeSessionState === "connecting"
                ? "ブラウザで同意してください…"
                : `${SESSION_STATE_LABEL[youtubeSessionState] ?? youtubeSessionState}${
                    youtubeSessionReason ? `（${youtubeSessionReason}）` : ""
                  }`}
          </span>
        </div>
        <span className={styles.note}>
          YouTube はチャンネル名入力不要（自分のアクティブ配信を取得）。無料クォータ（10,000 units/日）を使い切ると取得は自動停止します。
        </span>
      </div>

      {/* 033c: VOICEVOX 自動連携（設定向けの一度きり設定）。読み上げ ON/OFF は配信中に頻繁に切り替えるため本体
          コメントビューへ置く。起動は既存 launch_voicevox_engine の再利用。 */}
      <div className={styles.voicevoxPanel}>
        <ToggleSwitch
          label="VOICEVOX自動連携"
          checked={voicevoxAutolink}
          onChange={onVoicevoxAutolinkChange}
        />
        <span className={styles.note}>
          自動連携が ON だと、コメントビューアを開いたときに VOICEVOX を自動起動します（要: ツール管理に VOICEVOX を登録）。
        </span>
      </div>
    </div>
  );
}
