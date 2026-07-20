import type { DeviceCodePrompt } from "../../features/comment-viewer/commentStream";
import type { VoicevoxSpeaker } from "../../features/comment-viewer/voicevox";
import {
  OVERLAY_FONTS,
  type OverlayFontId,
} from "../../features/comment-viewer/overlaySettings";
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
  // 033d: 読み上げ話者の選択（話者・スタイル一覧と選択中 style id。state は CommentViewerApp が保持）。
  speakers: VoicevoxSpeaker[];
  selectedSpeakerId: number;
  onSpeakerIdChange: (id: number) => void;
  // 034c: 話者/スタイル選択時にその声のサンプルを試聴する（中断切替は CommentViewerApp が持つ preview プレイヤーが担う）。
  onPreview: (styleId: number) => void;
  // 034d: OBS オーバーレイ窓の開閉（開＝ON / 閉＝OFF）。state は CommentViewerApp が保持し、外部 close も購読で同期。
  overlayOpen: boolean;
  onOverlayToggle: (next: boolean) => void;
  // 034e: オーバーレイの意匠設定（フォント選択・サイト名表示）。値は CommentViewerApp が保持し localStorage 永続。
  // 実際の描画反映はオーバーレイ窓（OverlayApp）が同一 localStorage を storage 購読で受けて行う（この設定ビューは表示専用）。
  overlayFont: OverlayFontId;
  onOverlayFontChange: (id: OverlayFontId) => void;
  overlayShowSource: boolean;
  onOverlayShowSourceChange: (value: boolean) => void;
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
  speakers,
  selectedSpeakerId,
  onSpeakerIdChange,
  onPreview,
  overlayOpen,
  onOverlayToggle,
  overlayFont,
  onOverlayFontChange,
  overlayShowSource,
  onOverlayShowSourceChange,
}: SettingsViewProps) {
  // 033d: 選択中 style id を含む話者を導出（話者 select の現在値）。一覧が空/未一致なら先頭話者にフォールバック。
  const selectedSpeaker =
    speakers.find((sp) => sp.styles.some((st) => st.id === selectedSpeakerId)) ??
    speakers[0];

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

        {/* 033d: 読み上げ話者・スタイルの選択（話者→スタイルの 2 段）。ENGINE 稼働後に一覧（GET /speakers）が
            埋まると選べるようになる。未取得（空）のときは現在の選択（style id）を保持したまま案内文を出す。 */}
        {speakers.length === 0 ? (
          <span className={styles.note}>
            読み上げ話者は VOICEVOX ENGINE を起動すると選べます（現在の選択: id={selectedSpeakerId}）。
          </span>
        ) : (
          <div className={styles.voicevoxRow}>
            {/* 034c: 話者/スタイルを選ぶたびに onPreview を呼ぶ（キーボード矢印での選択走査でも都度発火する）。
                デバウンスは入れない: 「選択で即再生」の要件を損なうため。連続選択は preview プレイヤー側の中断切替
                （前の合成 abort ＋ 再生 stop）で吸収され、宛先は loopback で軽量。
                再修正トリガー: 実機で矢印走査時に 50021 への合成連打が負荷になった場合のみ、ここにデバウンスを検討する。 */}
            <label className={styles.speakerField}>
              話者
              <select
                className={styles.select}
                value={speakers.indexOf(selectedSpeaker)}
                onChange={(e) => {
                  const sp = speakers[Number(e.target.value)];
                  const firstId = sp?.styles[0]?.id;
                  if (firstId !== undefined) {
                    onSpeakerIdChange(firstId);
                    onPreview(firstId); // 034c: 話者切替＝先頭スタイルの声を即試聴（前の再生は中断切替）。
                  }
                }}
              >
                {speakers.map((sp, i) => (
                  <option key={i} value={i}>
                    {sp.name}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.speakerField}>
              スタイル
              <select
                className={styles.select}
                value={selectedSpeakerId}
                onChange={(e) => {
                  const id = Number(e.target.value);
                  onSpeakerIdChange(id);
                  onPreview(id); // 034c: スタイル切替＝その声を即試聴（前の再生は中断切替）。
                }}
              >
                {selectedSpeaker?.styles.map((st) => (
                  <option key={st.id} value={st.id}>
                    {st.name}
                  </option>
                ))}
              </select>
            </label>
            {/* 034c: 同じ声をもう一度鳴らす小さな試聴ボタン（選択を変えずに聴き直せる）。選択トリガーと同じ
                onPreview を呼ぶだけ（別導線を増やさない）。前の再生中なら中断して鳴らし直す。 */}
            <button
              type="button"
              className={styles.btnGhost}
              onClick={() => onPreview(selectedSpeakerId)}
              title="選択中の声のサンプルをもう一度再生します"
            >
              試聴 ▶
            </button>
          </div>
        )}
      </div>

      {/* 034d: OBS オーバーレイの開閉（本体ツールバーから移設）。1 つのトグルで開閉し、現在の状態を配色＋
          aria-checked（ToggleSwitch は role="switch"）で明示する。ON=開く / OFF=閉じる。オーバーレイは
          表示専用で、閉じても sidecar は落とさない（no-orphan kill 契機はコメビュ窓に集約のまま）。
          034e はこの節の隣にサイト名トグル等のデザイン設定を足す。
          レビュー（ARIA 逸脱 / 修正不要）: 仕様は aria-pressed だが、switch ロールでは aria-checked が正しい等価
          表現のため既存 ToggleSwitch を流用した（034e が隣に足すトグル群とも揃う）。再修正トリガー＝トグルを
          switch でなく通常の押しボタン（toggle button）に置き換えるなら aria-pressed へ戻す。 */}
      <div className={styles.overlayPanel}>
        <ToggleSwitch
          label="OBS オーバーレイを表示"
          checked={overlayOpen}
          onChange={onOverlayToggle}
        />
        <span className={styles.note}>
          OBS の「ウィンドウキャプチャ」で「StreamDock コメントオーバーレイ」を選ぶとコメントを重ねられます（背景は透過）。オーバーレイは常に最背面で開くので、配信者の画面には前面表示されません。
        </span>

        {/* 034e: オーバーレイの意匠設定（フォント選択・サイト名表示）。値は同一 localStorage を介してオーバーレイ窓へ
            即反映する（OverlayApp が storage 購読）。フォントはすべて OS 標準で外部フォントは使わない（CSP 方針）。
            サイト名は受信済み source（Twitch/YouTube）の表示のみで新規取得はしない。 */}
        <label className={styles.speakerField}>
          フォント
          <select
            className={styles.select}
            value={overlayFont}
            onChange={(e) =>
              onOverlayFontChange(e.target.value as OverlayFontId)
            }
          >
            {OVERLAY_FONTS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <ToggleSwitch
          label="サイト名を表示する"
          checked={overlayShowSource}
          onChange={onOverlayShowSourceChange}
        />
        <span className={styles.note}>
          ON にすると、オーバーレイの各コメントに配信サービス名（Twitch / YouTube）を小さく表示します。
        </span>
      </div>
    </div>
  );
}
