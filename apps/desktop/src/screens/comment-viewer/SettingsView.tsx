import { useState } from "react";
import type { VoicevoxSpeaker } from "../../features/comment-viewer/voicevox";
import {
  OVERLAY_FONTS,
  resolveOverlayFontStack,
  type OverlayFontId,
} from "../../features/comment-viewer/overlaySettings";
import type { ObsWsConfig } from "../../features/comment-viewer/obsApi";
import type {
  ThemeFontFetchResult,
  ThemeImportFetchResult,
} from "../../features/comment-viewer/commentStream";
import type { AudioOutputDevice } from "../../features/comment-viewer/audioOutputApi";
import { NO_AUDIO_OUTPUT_DEVICE } from "../../features/comment-viewer/audioOutputPrefs";
import {
  TTS_MAX_LENGTH_MAX,
  TTS_MAX_LENGTH_MIN,
  clampTtsMaxLength,
} from "../../features/comment-viewer/ttsPrefs";
import { ToggleSwitch } from "../../components/ToggleSwitch";
import { Select } from "../../components/Select";
import { OverlayThemeCard } from "./OverlayThemeCard";
import { useHostOs } from "../../features/platform/useHostOs";
import { ChatSendCard } from "./ChatSendCard";
import styles from "./CommentViewerApp.module.css";
// 061g: ボタンの意匠は `components/compactButtons.module.css` へ移した（`ConfirmDialog` が
// `components/` へ出たため）。⚠ 寸法・配色はこの窓の 6 ファイル計 25 箇所と `ConfirmDialog` の共有。
import btnStyles from "../../components/compactButtons.module.css";

/**
 * 033b: コメビュ窓内の「設定ビュー」。本体（comment ビュー）から歯車ボタンで切り替えて表示し、Twitch/YouTube の
 * 接続・チャンネル入力・取得開始/停止・Device Code 提示をここに集約する（本体には接続ボタンを置かない）。
 *
 * このコンポーネントは**表示専用**で、sidecar への通信面（WS）や制御フレームは一切持たない。接続状態 state は
 * `CommentViewerApp` が保持し、既存ハンドラ（`handleTwitchConnect` / `handleStartSession` / `handleStopSession` /
 * `handleYouTubeConnect` / `handleYouTubeStartSession` / `handleYouTubeStopSession`）を props でそのまま受け取って
 * 呼ぶだけ。よって WS 接続は窓内 1 本のまま・宛先も不変で、メイン窓 no-internet 境界に影響しない。
 *
 * 034(UI刷新): 帯の縦積みを複数カード（読み上げ(VOICEVOX) / OBSオーバーレイ）へ再編し、選択 UI は自作 Select に
 * 統一する。表示・レイアウトのみの変更で、上記ハンドラ・disabled 条件・localStorage 連携などの挙動は不変。
 *
 * 042b: 接続（Twitch/YouTube の連携・取得開始/停止・Device Code 提示）カードは本体のプラットフォーム別カードへ移設
 * したため、この設定ビューからは撤去した（033b の部分反転）。設定ビューは読み上げ／OBS オーバーレイの設定のみを担い、
 * 接続系の state・ハンドラは受け取らない（表示専用で WS を持たない性質は不変・窓内 1 本のまま）。
 */

/**
 * 058a: 出力デバイス列挙の状態。
 *
 * `"ready"` と 0 件・`"failed"` を区別するのは、**どれも「通知音が鳴らない」状態なのに
 * ユーザーが取る行動が違う**から（デバイスを挿す／再読み込みする／選び直す）。
 * ⚠ `"loading"` の間は「見つかりません」の警告を出さないこと（起動直後に必ず一瞬赤くなる）。
 */
export type AudioOutputListState = "loading" | "ready" | "failed";

/**
 * 059a: 通知音の試聴の状態。
 *
 * ⚠ **059b の投げ銭音試聴とは「共有する」**（2 つの試聴ボタンで 1 つの state）。同じカード・
 * 同じデバイス・同じ復旧手順＝失敗の案内文が音種で変わらないので、分ける理由が無い。むしろ共有だと
 * **片方の再生中はもう片方も disabled** になり、**Rust の同時再生 1 本（058a）と一致する**
 * （分けると再生中にもう片方を押せてしまい、Rust に黙って捨てられて「押したのに鳴らない」になる）。
 *
 * ⚠ **059c で `AudioTestState`（058a の「テスト再生」の状態）は削除した**——テスト再生ボタン自体が
 * 無くなったため（本人指示）。副産物として「構造的に同一な 2 つの state を取り違える」リスクが消え、
 * 059a のレビュー Q-9 が branded type の代わりに置いていた配線テスト（試聴の失敗が 058a のカードへ
 * 漏れないこと）も、カード統合と同時に役目を終えた。
 * **再修正トリガー＝再び通知音以外の再生 state が増えたとき**（そのときは取り違えを殺す配線テストを戻す）。
 */
export type SoundPreviewState = "idle" | "playing" | "failed";

interface SettingsViewProps {
  onBack: () => void;
  // 033c: VOICEVOX 自動連携 ON/OFF（読み上げトグルは本体コメントビューへ・state は CommentViewerApp が保持）。
  voicevoxAutolink: boolean;
  onVoicevoxAutolinkChange: (value: boolean) => void;
  // 035c: source 別読み上げ ON/OFF（既定 両 ON・state/永続化は CommentViewerApp が保持）。VOICEVOX 読み上げが OFF
  // （ttsEnabled=false）のときは両トグルを無効表示にするため、判定用に ttsEnabled も受け取る（読み上げトグル本体は
  // 本体コメントビューのツールバーにあり、この設定ビューは状態を受け取って disabled 表示するだけ）。
  ttsEnabled: boolean;
  speakTwitch: boolean;
  onSpeakTwitchChange: (value: boolean) => void;
  speakYoutube: boolean;
  onSpeakYoutubeChange: (value: boolean) => void;
  // 048: 1 件あたりの読み上げ最大文字数（超過分は「以下略」で打ち切る）。state/永続化は CommentViewerApp が保持し、
  // ここは表示と確定値の受け渡しのみ。**省略の ON/OFF トグルは無い**（常時有効・変えられるのは文字数だけ）。
  ttsMaxLength: number;
  onTtsMaxLengthChange: (value: number) => void;
  // 033d: 読み上げ話者の選択（話者・スタイル一覧と選択中 style id。state は CommentViewerApp が保持）。
  speakers: VoicevoxSpeaker[];
  selectedSpeakerId: number;
  onSpeakerIdChange: (id: number) => void;
  // 034c: 話者/スタイル選択時にその声のサンプルを試聴する（中断切替は CommentViewerApp が持つ preview プレイヤーが担う）。
  onPreview: (styleId: number) => void;
  // 058a: 通知音の出力デバイス（②-軽）。列挙と再生は Rust 側（webview では出力先を選べない＝058s 実測）で、
  // ここは表示と選択の受け渡しのみ（このビューの「表示専用」性質は不変）。
  // ⚠ `audioOutputDeviceId` の `""`＝未選択は **「既定デバイスで鳴らす」ではなく「鳴らさない」**。
  // 既定＝仮想オーディオデバイス＝配信に載る側なので、ここを既定へ落とす UI にしないこと（fail-closed）。
  audioOutputDevices: AudioOutputDevice[];
  audioOutputListState: AudioOutputListState;
  audioOutputDeviceId: string;
  onAudioOutputDeviceIdChange: (deviceId: string) => void;
  onReloadAudioOutputDevices: () => void;
  // ⚠ 059c: `onTestNotificationSound` / `audioTestState`（058a の「テスト再生」）は**削除した**（本人指示）。
  // 出力先の検証は下の「通知音を試聴」が同じデバイスで実音を鳴らすことで果たせる。
  // 059a / 059b: 通知音（コメント音・投げ銭音）の ON/OFF と試聴。state/永続化（soundPrefs）は
  // CommentViewerApp が保持し、ここは表示とユーザー操作の受け渡しのみ（「表示専用」性質は不変）。
  // ⚠ **音量は受け取らない**（振幅は Rust の PEAK_AMPLITUDE 固定。理由と再修正トリガーは soundPrefs.ts）。
  // ⚠ 出力先が未選択のとき**トグルを disabled にしない**（判断は下記カードのコメント）。
  // ⚠ **ON/OFF は音ごとに独立**（片方 OFF でもう片方は鳴る）。一方 `soundPreviewState` は
  // **2 つの試聴で共有する**（理由は同型の JSDoc）。
  soundCommentEnabled: boolean;
  onSoundCommentEnabledChange: (value: boolean) => void;
  onPreviewCommentSound: () => void;
  soundMonetaryEnabled: boolean;
  onSoundMonetaryEnabledChange: (value: boolean) => void;
  onPreviewMonetarySound: () => void;
  soundPreviewState: SoundPreviewState;
  // 045b: 表示（開閉）トグルは本体コメントビューのツールバーへ移設したため、この設定ビューは overlayOpen /
  // onOverlayToggle を受け取らない（034d の部分反転）。開閉 state・ハンドラは CommentViewerApp が保持したまま。
  // 034e: オーバーレイの意匠設定（フォント選択・サイト名表示）。値は CommentViewerApp が保持し localStorage 永続。
  // 実際の描画反映はオーバーレイ窓（OverlayApp）が同一 localStorage を storage 購読で受けて行う（この設定ビューは表示専用）。
  overlayFont: OverlayFontId;
  onOverlayFontChange: (id: OverlayFontId) => void;
  overlayShowSource: boolean;
  onOverlayShowSourceChange: (value: boolean) => void;
  /**
   * 060c: 外部 `@import` を sidecar に 1 本だけ取得させる（`OverlayThemeCard` へ素通しするだけ）。
   *
   * ⚠ WS ハンドルを持っているのは `CommentViewerApp` なので、ここは経路を通すだけで**中身を知らない**
   * （このビューは従来どおり秘密も WS も持たない）。⚠ 未指定なら外部取得の導線は出ない（fail-closed）。
   */
  onRequestThemeImport?: (
    url: string,
    maxBytes: number,
  ) => Promise<ThemeImportFetchResult>;
  /**
   * 060h: `@font-face` の `src` が指すフォント実体を 1 本だけ取得させる（同じく素通し）。
   * ⚠ 未指定ならフォント段ごと出ない（fail-closed）。
   */
  onRequestThemeFont?: (
    url: string,
    maxBytes: number,
  ) => Promise<ThemeFontFetchResult>;
  // 044a: OBS 連携（方式A＝ウィンドウキャプチャ自動追加）。state/ハンドラは CommentViewerApp が保持し、
  // ここは表示とユーザー操作の受け渡しのみ（WS/秘密は持たない・パスワードは onSetObsPassword 経由で Rust へ）。
  obsConfig: ObsWsConfig | null; // OBS WebSocket の read-only 検出結果（null=未検出）
  obsAutoAdd: boolean; // 「OBS へ自動追加」トグルの状態
  onObsAutoAddToggle: (next: boolean) => void;
  obsState: string; // sidecar からの状態通知（idle/connecting/added/reused/failed）
  /**
   * 063e 段 1-b: **チャンネルポイント購読の成否**（`"unknown"` / `"receiving"` / `"unavailable"`）。
   *
   * ⚠⚠⚠ **これが無いと「黙って効かない」が残る**（061a Q-1）。購読は非致命なので、失敗しても
   * コメント取得は続き、画面には**何も起きない**。⚠ しかも失敗は**新規配信者の既定状態**である
   * （Twitch 側でチャンネルポイントが有効化されるまで機能自体が存在しない）。
   * ⚠ `obsState` と同じく WS 境界で型が失われるため `string` で受け、ここがリテラル比較で網羅する。
   */
  channelPointsState: string;
  onSetObsPassword: (password: string) => void;
  onClearObsPassword: () => void;
  // 046b: 「固定コメントをOBSに表示」トグル（固定専用オーバーレイ窓 `pinned-overlay` の表示 ON/OFF）。
  // 値は CommentViewerApp が保持し localStorage 永続。ここは表示とユーザー操作の受け渡しのみ。
  pinnedOverlayEnabled: boolean;
  onPinnedOverlayToggle: (next: boolean) => void;
  /**
   * 066: **チャットへの書き込み**（⚠ **StreamDock 初の書き込み経路**）のテスト送信。
   *
   * ⚠⚠ **ここは受け渡しだけ**——トグルの state は [`ChatSendCard`] が自分で持つ
   * （064d が `EffectAssignmentCard` で採った形と同じ＝**唯一の消費者がそのカード**なので、
   * 画面を跨ぐ配線を作らない）。⚠ **宛先は渡らない**（sidecar が接続中の配信から決める）。
   */
  onChatTestSend: (message: string) => Promise<{ ok: boolean; reason?: string }>;
  /**
   * 066 / security-review S-2: **送信先として画面に出す**チャンネル名（表示専用）。
   * ⚠ **宛先を決める値ではない**（[`ChatSendCard`] の `channel` の注記が正）。
   */
  chatSendChannel: string;
}

export function SettingsView({
  onBack,
  voicevoxAutolink,
  onVoicevoxAutolinkChange,
  ttsEnabled,
  speakTwitch,
  onSpeakTwitchChange,
  speakYoutube,
  onSpeakYoutubeChange,
  ttsMaxLength,
  onTtsMaxLengthChange,
  speakers,
  selectedSpeakerId,
  onSpeakerIdChange,
  onPreview,
  audioOutputDevices,
  audioOutputListState,
  audioOutputDeviceId,
  onAudioOutputDeviceIdChange,
  onReloadAudioOutputDevices,
  soundCommentEnabled,
  onSoundCommentEnabledChange,
  onPreviewCommentSound,
  soundMonetaryEnabled,
  onSoundMonetaryEnabledChange,
  onPreviewMonetarySound,
  soundPreviewState,
  overlayFont,
  onOverlayFontChange,
  overlayShowSource,
  onOverlayShowSourceChange,
  onRequestThemeImport,
  onRequestThemeFont,
  obsConfig,
  obsAutoAdd,
  onObsAutoAddToggle,
  obsState,
  channelPointsState,
  onSetObsPassword,
  onClearObsPassword,
  pinnedOverlayEnabled,
  onPinnedOverlayToggle,
  onChatTestSend,
  chatSendChannel,
}: SettingsViewProps) {
  // 044a: OBS パスワード入力のローカル state（**この値は保存しない・保存は Rust→keychain**）。認証が必要な OBS の
  // ときだけ入力欄を出す。保存ボタンで onSetObsPassword に渡し、入力欄は即クリアして DOM/メモリに残さない（§9）。
  const [obsPasswordInput, setObsPasswordInput] = useState("");
  // 048: 読み上げ最大文字数の**入力中の生文字列**。確定（blur / Enter）まで親 state に反映しない。
  // 理由: 打鍵ごとに確定すると「80 にしたい途中の 8」が下限 20 へクランプされて入力が壊れ、さらに
  // 1 打鍵ごとに localStorage へ書くことになる（親の永続化 effect が state 変更のたびに走るため）。
  // 設定ビューは view 切替でアンマウントされるので、開くたびに現在値で初期化される。
  const [maxLengthInput, setMaxLengthInput] = useState(() =>
    String(ttsMaxLength),
  );

  /**
   * 048: 文字数入力を確定する（blur / Enter）。
   * - 空・NaN（全角数字は `type="number"` が受け付けず空になる）は**直前の確定値へ戻す**。
   *   既定値へ飛ばさない＝ユーザーが設定した値を打ち間違いで勝手に消さない。
   * - 有限値は `clampTtsMaxLength` で丸め、**入力欄の表示もクランプ後の値へ書き戻す**
   *   （「999 と打ったら 200 に落ちた」が見えるようにする。min/max 属性はブラウザの補助であって保証ではない）。
   */
  const commitMaxLength = () => {
    const parsed = Number(maxLengthInput.trim());
    if (maxLengthInput.trim() === "" || !Number.isFinite(parsed)) {
      setMaxLengthInput(String(ttsMaxLength));
      return;
    }
    const next = clampTtsMaxLength(parsed);
    setMaxLengthInput(String(next));
    onTtsMaxLengthChange(next);
  };
  // 033f Windows 追修正③: OBS のウィンドウキャプチャ方式は OS で事情が異なる。Windows は
  // 「Windows 10(WGC)＋透過を許可」でないと GPU/透過の WebView2 窓を取り込めず黒くなるため、
  // Windows のときだけ設定手順の一文を出す。OS 判定は既存の host_os（タイトルバー出し分けと
  // 同経路）を読み取り専用で使う（この設定ビューの「表示専用」＝WS/制御フレームを持たない性質は不変）。
  const hostOs = useHostOs();

  // 033d: 選択中 style id を含む話者を導出（話者 select の現在値）。一覧が空/未一致なら先頭話者にフォールバック。
  const selectedSpeaker =
    speakers.find((sp) =>
      sp.styles.some((st) => st.id === selectedSpeakerId),
    ) ?? speakers[0];

  // 058a: select に出せる値（＝**今の一覧に実在するデバイス**）だけを現在値にする。
  // 保存済み ID が一覧に無いときは「選択しない」を表示するが、**保存値そのものは消さない**
  // （ヘッドホンを挿し直せばそのまま復帰する）。ここで消してしまうと、抜くたびに選び直しになる。
  const selectedAudioOutputDeviceId = audioOutputDevices.some(
    (device) => device.id === audioOutputDeviceId,
  )
    ? audioOutputDeviceId
    : NO_AUDIO_OUTPUT_DEVICE;

  // 058a: 「選んだはずのデバイスが今は無い」状態。**これを黙って既定デバイスへ落とさない**のが本タスクの
  // 肝で（②-軽では既定＝仮想オーディオデバイス＝配信に載る側）、代わりに UI で気付かせる。
  // ⚠ 列挙中（loading）は判定しない——起動直後に一瞬必ず赤くなってしまう。
  const savedAudioOutputDeviceMissing =
    audioOutputDeviceId !== NO_AUDIO_OUTPUT_DEVICE &&
    audioOutputListState === "ready" &&
    selectedAudioOutputDeviceId === NO_AUDIO_OUTPUT_DEVICE;

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

      {/* 033c/034(UI刷新): 読み上げ（VOICEVOX）カード。自動連携は設定向けの一度きり設定（読み上げ ON/OFF は配信中に
          頻繁に切り替えるため本体コメントビューへ置く）。起動は既存 launch_voicevox_engine の再利用。 */}
      <div className={styles.card}>
        <div className={styles.cardHead}>読み上げ（VOICEVOX）</div>
        <div className={styles.cardBody}>
          <ToggleSwitch
            label="VOICEVOX自動連携"
            checked={voicevoxAutolink}
            onChange={onVoicevoxAutolinkChange}
          />
          <span className={styles.note}>
            自動連携が ON だと、コメントビューアを開いたときに VOICEVOX
            を自動起動します（要: ツール管理に VOICEVOX を登録）。
          </span>

          {/* 035c: 配信元（Twitch/YouTube）別の読み上げ ON/OFF。両プラットフォーム同時取得時の読み上げ暴発を抑えるための
              フィルタで、既定は両 ON（現行踏襲）。OFF の配信元はコメントを読み上げないが、表示・一覧には残る。読み上げ
              フィルタのみで、VOICEVOX 読み上げ本体が OFF（ttsEnabled=false）のときは両トグルを無効表示にする。 */}
          <ToggleSwitch
            label="Twitch を読み上げる"
            checked={speakTwitch}
            onChange={onSpeakTwitchChange}
            disabled={!ttsEnabled}
          />
          <ToggleSwitch
            label="YouTube を読み上げる"
            checked={speakYoutube}
            onChange={onSpeakYoutubeChange}
            disabled={!ttsEnabled}
          />
          <span className={styles.note}>
            配信元ごとに読み上げの ON/OFF を切り替えられます（OFF
            の配信元は読み上げませんが、コメント表示は残ります）。VOICEVOX
            読み上げが ON のときだけ設定できます。
          </span>

          {/* 048: 読み上げの文字数上限。長文 1 件の読み上げ中（290 文字なら 48〜64 秒）に届いたコメントが
              バックログ上限で無言破棄されるのを防ぐため、**読み上げテキストだけ**を打ち切る（表示は全文のまま）。
              省略の ON/OFF トグルは持たない（常時有効・変えられるのは文字数だけ）ので、クランプの下限/上限が
              「上限なし」を作らせない役割も兼ねる。ttsEnabled=false でも disabled にしない（話者/スタイル選択と
              同じ「読み上げの中身」を決める設定で、読み上げ前に決めておけるため。source トグルとは性質が違う）。 */}
          <label className={styles.speakerField}>
            {/* 054: ラベル文字列を .fieldLabel で包む（設定項目名＝13px/700/--text）。<label> が子の
                コントロールを包む暗黙ラベルのままなので、関連付け・アクセシブル名は不変（htmlFor/id は導入しない）。 */}
            <span className={styles.fieldLabel}>読み上げの文字数上限</span>
            {/* step=10 は矢印キー/スピナーの刻みを 10 にするためだけの指定で、値の妥当性はここでは決めない
                （65 のような step 外の値も確定時の clampTtsMaxLength が通すので有効。step 不整合は :invalid に
                該当するが、この CSS モジュールに :invalid のスタイルは無いため見た目にも出ない）。
                再修正トリガー＝:invalid の見た目を入れるとき、または「1 刻みで微調整したい」要望が出たとき（step=1 へ）。
                onKeyDown で isComposing を見ていないのは、type="number" が IME 入力を実質受け付けない（変換中の
                文字が value に載らない）ため。仮に誤発火しても commitMaxLength は現在の入力を確定するだけで、
                空なら直前値へ戻る＝非破壊。再修正トリガー＝WKWebView/WebView2 実機で変換確定の Enter が
                値を書き換える事象を観測したとき（そのとき e.nativeEvent.isComposing で弾く）。 */}
            <input
              className={styles.searchInput}
              type="number"
              inputMode="numeric"
              min={TTS_MAX_LENGTH_MIN}
              max={TTS_MAX_LENGTH_MAX}
              step={10}
              value={maxLengthInput}
              onChange={(e) => setMaxLengthInput(e.target.value)}
              onBlur={commitMaxLength}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitMaxLength();
              }}
            />
          </label>
          <span className={styles.note}>
            読み上げは指定文字数で打ち切り、続きは「以下略」と読みます（コメントの表示は全文のままです）。
            {TTS_MAX_LENGTH_MIN}〜{TTS_MAX_LENGTH_MAX} 文字。
          </span>

          {/* 033d: 読み上げ話者・スタイルの選択（話者→スタイルの 2 段）。ENGINE 稼働後に一覧（GET /speakers）が
              埋まると選べるようになる。未取得（空）のときは現在の選択（style id）を保持したまま案内文を出す。 */}
          {speakers.length === 0 ? (
            <span className={styles.note}>
              読み上げ話者は VOICEVOX ENGINE を起動すると選べます（現在の選択:
              id=
              {selectedSpeakerId}）。
            </span>
          ) : (
            <div className={styles.voicevoxRow}>
              {/* 034c: 話者/スタイルを選ぶたびに onPreview を呼ぶ（キーボード矢印での選択走査でも都度発火する）。
                  デバウンスは入れない: 「選択で即再生」の要件を損なうため。連続選択は preview プレイヤー側の中断切替
                  （前の合成 abort ＋ 再生 stop）で吸収され、宛先は loopback で軽量。
                  再修正トリガー: 実機で矢印走査時に 50021 への合成連打が負荷になった場合のみ、ここにデバウンスを検討する。 */}
              <label className={styles.speakerField}>
                <span className={styles.fieldLabel}>話者</span>
                <Select
                  ariaLabel="話者"
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
                </Select>
              </label>
              <label className={styles.speakerField}>
                <span className={styles.fieldLabel}>スタイル</span>
                <Select
                  ariaLabel="スタイル"
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
                </Select>
              </label>
              {/* 034c: 同じ声をもう一度鳴らす小さな試聴ボタン（選択を変えずに聴き直せる）。選択トリガーと同じ
                  onPreview を呼ぶだけ（別導線を増やさない）。前の再生中なら中断して鳴らし直す。 */}
              <button
                type="button"
                className={btnStyles.btnGhost}
                onClick={() => onPreview(selectedSpeakerId)}
                title="選択中の声のサンプルをもう一度再生します"
              >
                試聴 ▶
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 059c（2026-08-04・本人指示による UI 再編）: 058a の「音声出力（通知音）」カードと
          059a/059b の「通知音」カードを **1 枚に統合**した。読み上げカードの直後に置く＝音まわりを 1 か所へ。
          ⚠⚠ **058a / 059a のタスクファイルにある「カードを分ける」決定は、この再編で失効している**
          （058a のカードが「ここが担うのは出力先だけで、ON/OFF・種類は 059 がそれぞれの機能の隣に置く」と
          宣言していたが、実際には 2 枚とも通知音の設定で、ユーザーからは 1 つの機能に見える）。
          経緯と失効した記述の一覧は docs/progress.md の 059c 節。

          構成の順序は「**何を鳴らすか** → **どこへ出すか**」。出力先を後ろに置いたのは、
          ⚠ **どちらかの音が ON のときだけ出力先を出す**ため——両方 OFF なら鳴らないので出力先を選ぶ意味が無く、
          先頭に置くと「使わないかもしれない設定」から読ませることになる。
          ⚠ 列挙（`listAudioOutputDevices`）は **設定ビューを開いた時点**で走る（CommentViewerApp の effect）ので、
          この条件表示によって列挙のタイミングは変わらない＝ON にした瞬間に一覧は揃っている。

          書式は 054 の階層規則どおり（項目名＝ToggleSwitch の .toggleLabel / .fieldLabel、説明＝.note、警告＝.errorText）。
          **既存クラスだけを使い、新しい px / weight を発明しない**（CSS 差分ゼロ）。
          ⚠ **音量スライダーは無い。** 振幅は Rust の PEAK_AMPLITUDE 固定で、②-軽では通知音だけが専用の実デバイスへ
          出るため OS のデバイス別音量が独立に効く（詳細と再修正トリガーは soundPrefs.ts の docstring）。
          ⚠ ON/OFF をツールバーへ置かないのは、通知音が「一度 ON にしたらそのまま」寄りの設定だから
          （045b がツールバーへ移したのは配信中に頻繁に切り替える操作）。 */}
      <div className={styles.card}>
        <div className={styles.cardHead}>通知音</div>
        <div className={styles.cardBody}>
          {/* ⚠ 059c: 説明文から「（既定は OFF）」を落とした（本人指示）。トグルを見れば分かる情報を
              文章で繰り返さない。「配信に載る/載らない」の説明も落として**下の出力先セクションの .note に
              一本化**した（カード統合前は「上の『音声出力（通知音）』で〜」と別カードを指しており、
              統合後はその参照自体が成立しない）。 */}
          <ToggleSwitch
            label="コメント通知音"
            checked={soundCommentEnabled}
            onChange={onSoundCommentEnabledChange}
          />
          <span className={styles.note}>
            コメントが届いたときに短い通知音を鳴らします。連投しても鳴りっぱなしにならないよう間隔をあけて鳴らします。
          </span>
          {/* 034c の話者試聴と同じ考え方＝「ON にしても次のコメントが来るまで音が確認できない」を避ける。
              ⚠ ユーザーの明示操作なので **notificationSound.ts のクールダウンを通さない**
              （押したのに鳴らないのは壊れて見える）。連打は再生中 disabled で抑える。
              ⚠⚠ **059c: 2 つの試聴ボタンは表示名もアクセシブル名も「通知音を試聴 ▶」で完全に同一**（本人決定）。
              どちらの音かは**直上のトグルとの位置関係**で示し、`aria-label` では区別しない。
              帰結として ①スクリーンリーダーでは 2 つを区別できない ②テストは `getAllByRole` の並び順で引く
              ことになる（`SettingsView.audio.test.tsx` は取り違えを防ぐため、引いた直後に `title` を
              assert して並び順の前提を明示検証している）。**再修正トリガー＝押し間違いが実際に起きたとき**
              （そのときは表示名を変えずに `aria-label` で区別する＝可視ラベルを含むので WCAG 2.5.3 も満たす）。
              ⚠ 2 つのボタンは `soundPreviewState` を共有するので**片方の再生中は両方 disabled** になる。
              これは意図どおりで、Rust の同時再生 1 本（058a）と一致する（詳細は SoundPreviewState の JSDoc）。 */}
          <div className={styles.voicevoxRow}>
            <button
              type="button"
              className={btnStyles.btnGhost}
              onClick={onPreviewCommentSound}
              disabled={
                selectedAudioOutputDeviceId === NO_AUDIO_OUTPUT_DEVICE ||
                soundPreviewState === "playing"
              }
              title="コメント通知音を選択中のデバイスで鳴らします"
            >
              通知音を試聴 ▶
            </button>
          </div>

          {/* 059b: 投げ銭通知音。⚠ **ON/OFF はコメント音と独立**（片方だけ ON にできる）。
              ⚠⚠ **059c: 説明文から「コメント通知音とは同時に鳴りません」と「OFF のときは無音になります」を
              落とした**（本人指示）。⚠ **後者はレビュー Q-3 で「必須」として足したもので、これを消すと
              「投げ銭通知音 OFF ＋ コメント通知音 ON」でスパチャが来たときに完全に無音になる理由が
              画面のどこからも読めなくなる**（排他は ON/OFF より先に効くため）。挙動そのものは意図どおりで
              変えていない（「投げ銭音を OFF にしたのにスパチャでコメント音が鳴る」を避ける決定）。
              **再修正トリガー＝実機で「スパチャのときだけ鳴らない」と混乱したとき**——そのときは説明文を
              戻すか、排他より ON/OFF を先に見る（＝投げ銭音 OFF ならコメント音へフォールバックする）へ
              仕様変更するかのどちらかを選ぶこと。 */}
          <ToggleSwitch
            label="投げ銭通知音"
            checked={soundMonetaryEnabled}
            onChange={onSoundMonetaryEnabledChange}
          />
          <span className={styles.note}>
            スーパーチャット・ビッツ・サブスク・メンバーシップ・ギフト・ドネーション・ジュエルを受け取ったときに、コメント通知音とは別の音を鳴らします。
          </span>
          <div className={styles.voicevoxRow}>
            <button
              type="button"
              className={btnStyles.btnGhost}
              onClick={onPreviewMonetarySound}
              disabled={
                selectedAudioOutputDeviceId === NO_AUDIO_OUTPUT_DEVICE ||
                soundPreviewState === "playing"
              }
              title="投げ銭通知音を選択中のデバイスで鳴らします"
            >
              通知音を試聴 ▶
            </button>
          </div>

          {soundPreviewState === "failed" && (
            <span className={styles.errorText}>
              通知音を再生できませんでした。デバイスを選び直してください。
            </span>
          )}

          {/* ⚠ 059c: 出力先は**どちらかの音が ON のときだけ**出す（本人指示）。両方 OFF なら通知音は
              鳴らないので、出力先を選ぶ意味が無い。⚠ トグル自体は出力先が未選択でも disabled にしない
              （「先に ON にしてから出力先を選ぶ」順序を禁止する理由が無い。むしろこの条件表示は
              その順序を前提にしている）。 */}
          {(soundCommentEnabled || soundMonetaryEnabled) && (
            <>
              <label className={styles.speakerField}>
                <span className={styles.fieldLabel}>通知音の出力先</span>
                {/* ⚠ 先頭の選択肢は「選択しない」＝**鳴らさない**。「既定デバイス」ではない。
                    ②-軽では OS 既定＝仮想オーディオデバイス＝配信に載る側なので、ここに
                    「既定デバイス」という選択肢を足すと「載せないつもりの音が載る」導線になる。 */}
                <Select
                  ariaLabel="通知音の出力先"
                  value={selectedAudioOutputDeviceId}
                  onChange={(e) => onAudioOutputDeviceIdChange(e.target.value)}
                >
                  <option value={NO_AUDIO_OUTPUT_DEVICE}>
                    選択しない（通知音を鳴らさない）
                  </option>
                  {audioOutputDevices.map((device) => (
                    <option key={device.id} value={device.id}>
                      {device.name}
                    </option>
                  ))}
                </Select>
              </label>
              <div className={styles.voicevoxRow}>
                {/* デバイスを挿し直したときに設定を開き直さず済ませるための再列挙。
                    着脱イベントの購読（ホットプラグ監視）は持たない。
                    ⚠ 059c: 隣にあった「テスト再生 ▶」は削除した（本人指示）。出力先の検証は
                    上の「通知音を試聴 ▶」が同じデバイスで実音を鳴らすことで果たせるため、
                    ボタンが 1 つ減っても 058a の合格基準（選んだデバイスから鳴る／既定からは鳴らない）は
                    耳で確かめられる。⚠ Rust の `NotificationSound::Test` は**残してある**
                    （enum から消すと docs/security.md のレビュー必須条件に該当するため）。 */}
                <button
                  type="button"
                  className={btnStyles.btnGhost}
                  onClick={onReloadAudioOutputDevices}
                  disabled={audioOutputListState === "loading"}
                  title="接続中の音声出力デバイスを取得し直します"
                >
                  再読み込み
                </button>
              </div>

              {/* ⚠ 判定に使うのは `selectedAudioOutputDeviceId`（一覧と突き合わせた後）ではなく
                  **生の `audioOutputDeviceId`**。「選んだデバイスが今は見つからない」場合は次の
                  `savedAudioOutputDeviceMissing` が担当で、両方出すと**同じ状態を 2 つの違う言葉で
                  二重に叱る**ことになる（かつ「未選択」は事実として誤り）。列挙中（loading）に
                  一瞬赤くならないのも、生の値を見ているおかげで自動的に成立する。
                  ⚠ 059c: 旧文言は「上の『音声出力（通知音）』でデバイスを選ぶまで鳴りません」だったが、
                  カード統合で参照先が消えたので**位置参照を落とした**。 */}
              {audioOutputDeviceId === NO_AUDIO_OUTPUT_DEVICE && (
                // ⚠ §9: デバイス名・デバイス ID を出さない。
                <span className={styles.errorText}>
                  通知音の出力先が未選択です。デバイスを選ぶまで鳴りません。
                </span>
              )}
              {savedAudioOutputDeviceMissing && (
                // ⚠ §9: デバイス名・デバイス ID を出さない（「以前選んだ」で特定せずに済ませる）。
                <span className={styles.errorText}>
                  以前選んだ音声出力デバイスが見つかりません。通知音は鳴りません。デバイスを選び直してください。
                </span>
              )}
              {audioOutputListState === "failed" && (
                <span className={styles.errorText}>
                  音声出力デバイスを取得できませんでした。「再読み込み」をお試しください。
                </span>
              )}
              {audioOutputListState === "ready" &&
                audioOutputDevices.length === 0 && (
                  <span className={styles.errorText}>
                    使える音声出力デバイスがありません。スピーカーやヘッドホンを接続してから「再読み込み」を押してください。
                  </span>
                )}

              {/* ⚠ 「配信には載りません」と**断定しない**（059a レビュー Q-7）。載らないのは
                  「配信に流していないデバイス（PC のスピーカー／ヘッドホン）を選んだ場合」だけで、
                  ここで仮想オーディオデバイスを選べば載る。断定すると、下の <details> が案内している
                  仮想デバイスをここで選んでしまったユーザーに嘘をつくことになる。条件付きで書き、
                  かつ「何を選べばよいか」を同時に伝える。
                  ⚠ 059c: 各トグルの .note から「配信に載る/載らない」の説明を落とした結果、
                  **この 1 本がその説明の唯一の置き場所**になった。消さないこと。 */}
              <span className={styles.note}>
                ここで選んだデバイスからだけ通知音が鳴ります。配信に流していないデバイス（PCのスピーカーやヘッドホン）を選べば、通知音は配信に載りません。未選択のあいだは通知音を鳴らしません。
              </span>

              {/* 058s の申し送り: ②-軽は仮想オーディオデバイスの導入が前提で、**入れていないと
                  「配信に載せない」が機能しない**（読み上げも配信に載らない）。導入自体は自動化しない
                  （案内のみ）ので、ここで前提をはっきり書く。長いので既存の <details> 作法で畳む。 */}
              {/* ⚠ 段落は <span> ではなく <div> にする（レビュー指摘）。`.note` は font-size/line-height/color
                  だけで display を持たないので、カード直下（`.cardBody` は flex column ＝ フレックスアイテムが
                  blockify される）では改行されるが、この <details> は flex ではないため <span> のままだと
                  3 段落が**空白すら無しに 1 行へ連結**する（JSX は要素間の改行を除去する）。
                  `.errorText` を <div> で使う前例（このファイル内）と同じ扱いで、CSS 差分ゼロのまま解決する。
                  再修正トリガー＝段落間に余白が要ると判断したとき（`.cardBody > * + .note` と同型のルールが要る）。
                  ⚠ `.obsPasswordHelp` は名前こそ OBS 固有だが、CSS 冒頭の書式表が `.note` と並べて
                  「補助説明」役割として定義しているクラスで、汎用 <details> への流用は書式規則どおり。
                  再修正トリガー＝3 箇所目の流用が出たら `.helpDetails` へ改名する。 */}
              <details className={styles.obsPasswordHelp}>
                <summary>読み上げを配信に載せて、通知音は載せない設定にするには</summary>
                <div className={styles.note}>
                  OS の既定の出力先を<strong>仮想オーディオデバイス</strong>
                  にして、OBS の「音声入力キャプチャ」でそのデバイスを選んでください（macOS は BlackHole、Windows
                  は VB-CABLE などが一般的です）。読み上げは OS
                  の既定へ出るので配信に載り、通知音はここで選んだデバイスへ出るので載りません。
                </div>
                <div className={styles.note}>
                  仮想オーディオデバイスを導入していない場合、この設定をしても「配信に載せない」は機能しません（読み上げも配信に載りません）。
                </div>
                <div className={styles.note}>
                  OBS 側は「デスクトップ音声」や「アプリケーション音声キャプチャ」ではなく、
                  <strong>仮想デバイスを指定した「音声入力キャプチャ」</strong>
                  を使ってください。アプリ単位のキャプチャは出力先の指定を無視してアプリの音を全部拾うため、読み上げと通知音を分けられません。
                </div>
              </details>
            </>
          )}
        </div>
      </div>

      {/* OBSオーバーレイカード。**054 追補(E2E) 以降このカードが担うのは「自動反映（044a）のセットアップ」だけ**で、
          表示（開閉）トグルはここには無い（本体ツールバーへ移設済み）。手動ウィンドウキャプチャの手順注記と
          移設先への導線注記は削除した（下記 cardBody 内の 054 追補コメントに理由と再修正トリガーを書いてある）。
          オーバーレイは表示専用で、閉じても sidecar は落とさない（⚠ 061b で kill 契機は
          `comment-viewer` / `effect-overlay` の 2 点へ広がったが、この窓はそこに入っていない）。
          経緯: 034d/034(UI刷新) で開閉トグルをこのカードへ集約したが、045b で**部分反転**した。表示（開閉）は
          配信中に頻繁に切り替えるので本体へ、一度きりのセットアップである自動反映はここに残す、という線引き
          （親 045）。045b が併せて置いた移設先への導線注記は、054 追補で自動反映が既定の導線になったため撤去した。
          レビュー（ARIA 逸脱 / 修正不要）: 仕様は aria-pressed だが、switch ロールでは aria-checked が正しい等価
          表現のため既存 ToggleSwitch を流用した。045b 後もカードに残る自動反映トグルが同じ ToggleSwitch なので
          この判断は現役。再修正トリガー＝トグルを switch でなく通常の押しボタン（toggle button）に置き換えるなら
          aria-pressed へ戻す。
          045a: 可視文言のみ「コメントをOBSに表示」へ改名した。窓 label `comment-overlay` と OBS 実窓名
          「StreamDock コメントオーバーレイ」は据え置き（044a の自動追加が窓名一致で探すため・親 045 の線引き）。
          054 追補(E2E): この**実窓名を UI に出していた手動キャプチャ注記は削除した**ので、窓名の一致は
          lib.rs の `.title` と sidecar の `OBS_SOURCE_NAME` の 2 者間だけの契約になった（UI 側の目視担保は無い）。
          窓名を変えるときはこの 2 つを必ず同時に直すこと。
          ⚠⚠ **059c(2)（2026-08-04・本人指示）で 046b の「固定コメントをOBSに表示」カードを吸収し、
          見出しを「コメントをOBSに表示」→「OBSに表示」へ改めた。** 経緯と失効した記述は docs/progress.md の
          059c 節を正とする。
          - **見出しの改名は「見出しと中身のずれ」の解消でもある**（旧レビューが「修正不要・再修正トリガー＝
            次に文言タスクを起票するとき」として残していた既知問題）。045b でトグルが出ていって以降、見出し
            「コメントをOBSに表示」は**このカードに無いコントロール名**を指しており、さらに固定コメントを
            吸収すると中身の一部しか表さなくなるため、ここで解消した。
          - 副産物として、**見出しとツールバーのトグル label の同一文字列衝突も消えた**。
            ⚠ ただし `CommentViewerApp.toolbar.test.tsx` の `role="switch"` 絞り込みは**残す**
            （外すと衝突が再発したときに気付けない）。
          - 045a の「可視文言から『オーバーレイ』を消す」方針とも整合する（「OBSオーバーレイ」は採らない）。 */}
      <div className={styles.card}>
        <div className={styles.cardHead}>OBSに表示</div>
        <div className={styles.cardBody}>
          {/* 054 追補(E2E): ここにあった注記 2 本を**依頼者の指示で削除**した。
              (a) 045b の移設先導線「表示の ON/OFF は、コメント画面の上部にある『コメントをOBSに表示』で切り替えます。」
              (b) 033f 由来の手動キャプチャ手順「OBSの『ウィンドウキャプチャ』で…『StreamDock コメントオーバーレイ』を選ぶと…」
              理由: 自動反映（044a/046d）が既定の導線になり、説明が過剰で設定が読みにくいという実機フィードバック。
              ⚠ 手放したもの（意図的・再修正トリガー付き）:
                - 設定画面だけを見ている人が「表示をどこで ON にするか」を辿る導線（045b が置いたもの）。
                  再修正トリガー＝「表示の ON/OFF が見つからない」という実機フィードバックが出たとき。
                - 自動反映が失敗した人向けの手動フォールバック手順と、OBS 実窓名の可視提示。
                  再修正トリガー＝自動反映の失敗報告が出て、手動手順を画面から辿れないことが原因になったとき
                  （そのとき窓名リテラルは lib.rs の `.title` / sidecar の `OBS_SOURCE_NAME` と一致させること）。
              固定コメントカード側の手動手順は指示外のため据え置き＝**2 カードで非対称**であることも承知の上。 */}
          {/* 033f Windows 追修正③: Windows は OBS 側の設定が macOS と異なる。旧「BitBlt」方式では GPU/透過の
              WebView2 窓を取り込めず真っ黒になるため、WGC＋透過許可を Windows のときだけ案内する。
              上の手動手順を消した後も**残す**: 044a が自動設定するのは `pickWgcMethodValue` によるキャプチャ方式だけで、
              「透過を許可」は自動化されていない＝自動反映を使う人にも必要。固定コメントカードの Windows 注記
              （「上のコメント用と同じく」）が参照している先でもある。 */}
          {hostOs === "windows" && (
            <span className={styles.note}>
              Windows では OBS のウィンドウキャプチャで「キャプチャ方式＝Windows
              10（1903 以降）」を選び、「透過を許可」を ON
              にしてください。旧方式（BitBlt）のままだと真っ黒になります。
            </span>
          )}

          {/* 044a: OBS へ自動追加（連携）。ON の間、オーバーレイを「ウィンドウキャプチャ」ソースとして OBS へ
              自動追加（既存なら再利用）する。手動でのウィンドウキャプチャ追加が不要になる。接続は loopback
              （127.0.0.1:4455）のみ・ユーザーが ON にした時のみ。失敗時は上の手動手順にフォールバックする。
              045c: label を「いつ反映されるのか」が読み取れる条件付きの文へ変更した。旧「OBSに自動で反映する」は
              **このトグル単体で反映が起きる**ようにも読め、実際 044a の旧実装も ON だけでオーバーレイを開いて
              いた（045c で削除）。鉤括弧内は移設先トグルの label と同一文字列（045a 確定）にして指示語を避ける。
              054 追補(E2E): 「失敗時は**上の手動手順にフォールバックする**」と書いていたが、その手動手順の注記は
              画面から削除した（挙動としてのフォールバック＝自動追加を諦めて失敗状態を出すこと自体は不変）。 */}
          <ToggleSwitch
            label="「コメントをOBSに表示」ON時、OBSに自動で反映する"
            checked={obsAutoAdd}
            onChange={onObsAutoAddToggle}
          />
          {/* 054 追補(E2E): ここにあった「ONにすると、上の手動でのウィンドウキャプチャ追加が不要になります。」も
              一緒に削除した。指していた「上の手動での…」が無くなり宙に浮くため（依頼者の判断）。
              自動反映の効果は label「『コメントをOBSに表示』ON時、OBSに自動で反映する」（045c で条件付きの文へ
              改めたもの）が単体で伝えるので、注記無しでも意味は通る。 */}

          {/* 状態表示（idle 以外）。added/reused は「表示できた」ことだけ伝える（区別しない）。failed は赤字（エラー）。
              045a レビュー（表記ゆれ）→ **045b で解消済み**: 「OBS に接続しています…」だけ半角スペースありで他と
              ゆれていた。045a は据え置き（再修正トリガー＝「045b でこの周辺を触るとき」）としていたが、045b が
              同カードの本文を編集し、4 行上の導線注記で「OBSに」表記を新たに増やしたためトリガー発火と判断し、
              「OBSに接続しています…」へ statement を統一した。以降このカードの可視文言は全て「OBSに」で揃う。 */}
          {obsState === "connecting" && (
            <span className={styles.note}>OBSに接続しています…</span>
          )}
          {/* ⚠⚠ 061e(3): 「OBSにコメントを表示しました。」→「OBSに表示しました。」（**「コメント」を消しただけ**）。
              `obsState` は comments / pinned / effects の **3 種別で共有**されているので、
              **エフェクトや固定コメントの成功でもこの文が出る**＝「コメントを」と書くと嘘になる。
              ⚠ `connecting` / `failed` は既に種別非依存なので触らない。カードの見出し・トグルの label も触らない
              （あちらはコメント用トグルの説明として正しい）。⚠ 「OBSに」表記の統一（045b）は維持する。
              ⚠ 種別を名乗らないのは wire が種別を運ばないため（`obs.state` の payload は `{ state, reason? }`）。
              再修正トリガーは 046d / 061a Q-2 と同じ（`CommentViewerApp` のツールバー赤字のコメントが正）。 */}
          {(obsState === "added" || obsState === "reused") && (
            <span className={styles.note}>OBSに表示しました。</span>
          )}
          {obsState === "failed" && (
            <span className={styles.errorText}>
              OBSに接続できませんでした。OBSが起動しているか確認してください。
            </span>
          )}

          {/* WS 未検出/未有効なら有効化ガイド（read-only 検出結果に基づく・書き込みはしない）。エラーとして赤字で案内する。 */}
          {(obsConfig === null || !obsConfig.enabled) && (
            <div className={styles.errorText}>
              OBSの設定が不足しています。OBSのメニュー → ツール →
              WebSocketサーバー設定 を開き、以下を確認してください。
              <ul className={styles.obsGuideSteps}>
                <li>WebSocketサーバーを有効にするにチェックを入れる</li>
                <li>サーバーポートが4455になっていることを確認</li>
                <li>適用ボタンをクリック。</li>
              </ul>
            </div>
          )}

          {/* OBS 側で認証が必要なときだけパスワード入力を出す（不要な人には出さない）。
              入力値は保存せず、保存ボタンで Rust（keychain）へ渡した直後にクリアする（§9）。 */}
          {obsConfig?.authRequired && (
            <div className={styles.speakerField}>
              {/* 入力を短幅（searchInput）にし、保存/削除ボタンを横に並べる。保存＝主要色(btn)・削除＝ghost。 */}
              <div className={styles.fontRow}>
                <input
                  className={styles.searchInput}
                  type="password"
                  autoComplete="off"
                  value={obsPasswordInput}
                  onChange={(e) => setObsPasswordInput(e.target.value)}
                  placeholder="OBS のサーバーパスワード"
                />
                <button
                  type="button"
                  className={btnStyles.btn}
                  disabled={obsPasswordInput.trim().length === 0}
                  onClick={() => {
                    onSetObsPassword(obsPasswordInput);
                    setObsPasswordInput(""); // DOM/メモリに残さない（§9）
                  }}
                >
                  保存
                </button>
                <button
                  type="button"
                  className={btnStyles.btnGhost}
                  onClick={() => {
                    onClearObsPassword();
                    setObsPasswordInput("");
                  }}
                >
                  削除
                </button>
              </div>
              {/* 取得方法はフォーム下に折りたたみで置く（既定は閉じ・クリックで展開・native details）。 */}
              <details className={styles.obsPasswordHelp}>
                <summary>OBSのサーバーパスワード取得方法</summary>
                OBSのメニュー → ツール → WebSocketサーバー設定 → 接続情報を表示
                → サーバーパスワードの横にあるコピーをクリック
              </details>
            </div>
          )}

          {/* 034e: オーバーレイの意匠設定（フォント選択・サイト名表示）。値は同一 localStorage を介してオーバーレイ窓へ
              即反映する（OverlayApp が storage 購読）。フォントはすべて OS 標準で外部フォントは使わない（CSP 方針）。
              サイト名は受信済み source（Twitch/YouTube）の表示のみで新規取得はしない。 */}
          <label className={styles.speakerField}>
            <span className={styles.fieldLabel}>フォント</span>
            {/* 034(UI刷新): 選択したフォントで実際にどう表示されるかを右側でプレビューする。resolveOverlayFontStack で
                id → font-family スタックへ解決し inline 適用（オーバーレイ本体と同じ解決経路・OS 標準フォントのみで
                外部フォントは参照しない）。 */}
            <div className={styles.fontRow}>
              <Select
                ariaLabel="フォント"
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
              </Select>
              <span className={styles.fontPreview} aria-hidden="true">
                <span className={styles.fontPreviewLabel}>プレビュー</span>
                <span
                  className={styles.fontPreviewSample}
                  style={{ fontFamily: resolveOverlayFontStack(overlayFont) }}
                >
                  あア亜Ag 123
                </span>
              </span>
            </div>
          </label>
          <ToggleSwitch
            label="サイト名を表示する"
            checked={overlayShowSource}
            onChange={onOverlayShowSourceChange}
          />
          <span className={styles.note}>
            ON にすると、OBSに表示する各コメントに配信サービス名（Twitch /
            YouTube）を小さく表示します。
          </span>

          {/* 046b: 固定コメント（右クリック→「上部に固定」）を OBS へ出す専用オーバーレイ窓の設定。
              上の「コメントをOBSに表示」とは**別ウィンドウ**（label `pinned-overlay`）で、OBS では別ソースとして取り込む。
              設定ビューに置く理由（親 045 の線引きに照らした判断・依頼者の決定）: 表示（開閉）を
              ツールバーへ移した 045b の基準は「配信中に頻繁に切り替えるか」だが、固定オーバーレイの出し入れは
              **固定/固定解除（右クリックメニュー）側の仕事**で、窓そのものは開けっぱなしにする＝
              「OBS にウィンドウキャプチャを仕込む」一度きりのセットアップに当たる。

              ⚠⚠ **059c(2)（2026-08-04・本人指示）で、独立していた「固定コメントをOBSに表示」カードを
              このカードへ統合した。** 046b が「上の OBS カードの隣に別カードで置く」と決めていた配置は失効している。
              - **要素の順序・内容は 1 つも変えていない**（`.card` / `.cardHead` の枠を外して中身をここへ移しただけ）。
                そのおかげで下の注記が指す「上の『OBSに自動で反映する』」「上のコメント用」「上の設定」は
                **すべて参照が成立したまま**＝文言の書き換えはゼロ。⚠ この 3 本より前に要素を挿入するときは、
                「上の」が指す先が変わらないか必ず確認すること。
              - ⚠ 手動手順（「OFFのときは…手動で追加してください」）は固定側にだけ在り、コメント側には無い
                （054 追補で削除された）＝**案内粒度の非対称は統合後も残っている**（承知の上）。
                再修正トリガー＝2 つの案内粒度を揃える文言タスクを起票するとき。 */}
          {/* ON で専用ウィンドウが開く（固定が 0 件のときは完全に透明で何も映らない）。固定/固定解除では
              窓は開閉せず中身が入れ替わるだけ＝OBS のソースが途切れない。
              ⚠ 059c(2) 以前は**カード見出しとこの label が同一文字列**で、テストが `role="switch"` 絞りを
              強いられていた（046b レビューの既知問題）。見出しが「OBSに表示」になったので衝突は解消したが、
              テスト側の絞り込みは**残してある**（外すと再発時に気付けない）。 */}
          <ToggleSwitch
            label="固定コメントをOBSに表示"
            checked={pinnedOverlayEnabled}
            onChange={onPinnedOverlayToggle}
          />
          <span className={styles.note}>
            ONにすると、コメントを右クリックして「上部に固定」したものが OBS
            に表示されます。固定していない間は何も映りません。
          </span>
          {/* 046b レビュー（S-1・依頼者の決定）: この設定が ON だとコメントビューアを開いた時点で窓が自動で開く
              ため、固定を永続させると「前回配信のコメントが次の配信開始時に操作なしで本番へ出る」ことになる。
              そのため**固定はコメントビューアを開くたびに空へ戻す**仕様にした（CommentViewerApp の pinned state）。
              ここでは「配信をまたいでは残らない」ことをユーザーに明示する（毎回固定し直す運用になるため）。 */}
          <span className={styles.note}>
            固定はコメントビューアを開くたびにリセットされます（前の配信で固定したコメントが、次の配信にそのまま映ることはありません）。
          </span>
          {/* 046d: この窓も 044a の自動反映の対象になった（当初は「対象外・手動キャプチャ前提」だったが、
              親 046 が将来タスクとして先送りしていただけで技術的な障害は無く、依頼者の指示で解禁）。
              自動反映が OFF のときのために手動手順も残す。 */}
          <span className={styles.note}>
            上の「OBSに自動で反映する」がONなら、OBSに「StreamDock
            固定コメント」ソースが自動で追加されます。OFFのときは、OBSの「ウィンドウキャプチャ」でウィンドウ「StreamDock
            固定コメント」を選んで手動で追加してください。位置やサイズの調整は、コメントを1件固定してから行うと分かりやすいです。
          </span>
          {hostOs === "windows" && (
            <span className={styles.note}>
              Windows
              では、上のコメント用と同じく「キャプチャ方式＝Windows10（1903
              以降）」と「透過を許可」の設定がこのソースにも必要です。
            </span>
          )}
          {/* フォント・サイト名表示は 2 つのオーバーレイ窓で共有する（同じ OBS 画面に 2 つ並ぶため）。
              ⚠ 059c(2) 以前は「上の**カード**の設定を共有する」と書いていたが、統合で同一カード内になった。
              可視文言の「上の設定」は**同じカードの上方**を指すのでそのまま成立している。 */}
          <span className={styles.note}>
            フォントとサイト名表示は、上の設定がこのウィンドウにも適用されます。
          </span>
        </div>
      </div>

      {/* 060d: カスタム CSS テーマの取り込み・一覧・切替・プレビュー。
          ⚠ **このカードは末尾に置くこと。** 上の「OBSに表示」カードには「上の『OBSに自動で反映する』」
          「上のコメント用」「上の設定」という**位置参照の注記が 3 本**あり、途中へ挿入すると指す先が変わる
          （同カードのコメントが警告している既知の制約）。末尾なら 1 つも壊れない。
          ⚠ 「OBSに表示」カードへ混ぜないのは、取り込み・プレビュー・結果表示の分量が大きく、
          OBS のセットアップ手順（Windows のキャプチャ方式・パスワード・自動反映）が埋もれるため。
          ⚠ このカードだけ **state を自分で持つ**（理由は OverlayThemeCard.tsx の module doc）。
          ここから渡すのは**プレビューの体裁に要る 2 つだけ**で、値の所有は CommentViewerApp のまま。 */}
      <OverlayThemeCard
        overlayFont={overlayFont}
        overlayShowSource={overlayShowSource}
        requestThemeImport={onRequestThemeImport}
        requestThemeFont={onRequestThemeFont}
      />
      {/* 066: チャットへの書き込み。⚠⚠ **末尾に置く**（060d と同じ理由＝上のカードには
          「上の…」という位置参照の注記が 3 本あり、途中へ挿入すると指す先が変わる）。
          ⚠ このカードも **state を自分で持つ**（トグルの唯一の消費者なので画面を跨ぐ配線を作らない）。
          ここから渡すのは**送信の 1 本だけ**である。 */}
      <ChatSendCard onTestSend={onChatTestSend} channel={chatSendChannel} />
      {/* 063e: チャンネルポイントの受信について**約束できることと、できないこと**を書くカード。
          ⚠⚠ **トグルは無い**（設定できることが 1 つも無いので作らない）。増えるのは受信能力だけで、
          ユーザーが選べるのは「Twitch にログインし直すかどうか」だけである。

          ## ⚠⚠⚠ 書く理由＝「黙って効かない」を作らないため（061a Q-1）

          この購読は**非致命**（403 でもコメント取得は続く）なので、届かない人には**エラーすら出ない**。
          しかも届かない条件が **3 つ**あり、そのうち①は**新規配信者の既定状態**である:
            ① Twitch 側でチャンネルポイントが有効になっていない
               ⚠⚠ 新規チャンネルには**そもそも存在しない**（アフィリエイト条件を満たすと Twitch から
                  オンボーディングの案内が届いて初めて使える）。⚠ StreamDock の想定ユーザーの多くがここに居る。
            ② 他人のチャンネルに接続している（購読はブロードキャスター本人のトークンでしか通らない
               ＝公式の Authorization 要件。なのに接続先は**手入力のチャンネル名**である）
            ③ 再ログイン前（旧トークンに `channel:read:redemptions` が無い）
          ⇒ 書かなければ、ユーザーは「なぜ届かないのか」を知る手段が 1 つも無い。

          ## ⚠⚠ 段 1-b: 固定の説明文に**実際の状態**を足した

          段 1 は固定文だけだった（「材料は sidecar にあるが frontend へ届ける WS フレームが要る」ため）。
          ⚠ しかし①が既定状態だと分かった以上、**固定文だけでは「自分がどれなのか」を切り分けられない**。
          ⇒ `channelpoints.state`（成否 1 bit ＋ 未接続）を足した。⚠ **理由は載っていない**（§9）ので、
             原因の切り分けは下の 3 項目の固定文が担う——**状態表示と説明文は役割が違う**（片方だけでは足りない）。
          ⚠ 末尾に置くのは 060d / 066 と同じ理由（上のカードに「上の…」という位置参照の注記が 3 本ある）。 */}
      <section className={styles.card}>
        {/* ⚠ ベータであることを**見出しに書く**。カード本文の末尾にだけ書くと、
            スクロールして読まない人に届かない（この機能は作者が実機確認できていない）。 */}
        <div className={styles.cardHead}>チャンネルポイント（ベータ）</div>
        {/* ⚠⚠ 段 1-b の修正: **`.cardBody` が抜けていた。** 段 1 は `<span className={styles.note}>` を
            `.card` の直下に置いており、`.card` は padding を持たない・`.note` は inline なので、
            **4 つの説明文がカードの端に貼り付いた 1 かたまりの文**として描画されていた
            （他の全カードは `.cardBody` を挟んでいる＝この 1 枚だけ崩れていた）。 */}
        <div className={styles.cardBody}>
          {/* ⚠⚠⚠ **状態を先頭に出す。** 「効いていない」人が最初に見るべき情報だからである。 */}
          {channelPointsState === "receiving" && (
            <span className={styles.channelPointsOk}>
              引き換えを受信できる状態です。
            </span>
          )}
          {channelPointsState === "unavailable" && (
            /* ⚠⚠ **赤（errorText）にしない。** 他の人のチャンネルを見ているときはこれが正常であり、
                新規配信者にとっては既定の状態でもある。赤にすると「壊れている」と誤解させ、
                かつ**正常な人にも赤字を出し続ける**ことになる（赤を軽くしない）。 */
            <span className={styles.channelPointsWarn}>
              引き換えを受信できていません。下の 3
              つの条件のどれかが満たされていません。
            </span>
          )}
          {channelPointsState !== "receiving" &&
            channelPointsState !== "unavailable" && (
              /* ⚠ **`unknown` を「受信できていません」と混ぜないこと。** 混ぜると、まだ接続していない
                  だけの人に「Twitch の設定を確認してください」と誤案内する（064c が `obs.sources` の
                  `ok` で潰したのとまったく同じ失敗モード）。
                  ⚠ 既知の 2 語以外（将来 sidecar が語を増やした場合）もここへ倒す＝断言しない側が安全。 */
              <span className={styles.note}>
                Twitch
                のコメント取得を開始すると、受信できる状態かどうかがここに出ます。
              </span>
            )}

          <span className={styles.note}>
            Twitch
            のチャンネルポイント報酬の引き換えを、コメント一覧に「チャンネルポイント」として表示します。
            視聴者が報酬にテキストを入力していれば、その本文も表示します。
          </span>
          {/* ⚠⚠⚠ **約束できることだけ書く**（061a Q-1）。段 1 の時点ではここに「ガチャ」を書かなかった
              ——**当時は本当に回らなかった**（エフェクト条件の表に行が無かった）からである。
              ⚠⚠ **063e 段 2 でその再修正トリガーが発火した**（レビュー Q-H1）:
              `EFFECT_CONDITION_EVENT_TYPES` に `channelpoint` が入り、`effectAssignments.ts` の
              課金ゲートが消えて**実際に回るようになった**（`effectFire.test.ts` が端から端まで固定している）。
              ⇒ 書かないままにすると、今度は**できるようになったことに気付けない**という逆向きの
              「黙って効かない」になる。⚠ 次に約束を増やすとき（段 3 の報酬名ごとの出し分け等）も、
              **実際に動くようになってから**ここへ足すこと。 */}
          <span className={styles.note}>
            エフェクト画面の割り当て表に「チャンネルポイント」の行が出ます。そこでガチャや
            OBS のソースを割り当てると、引き換えのたびに動きます。
          </span>

          <span className={styles.note}>
            受信するには、次の 3 つがすべて必要です。
          </span>
          {/* ⚠⚠⚠ ①が**このカードで最も重要な 1 行**である。依頼者自身がここで詰まった
              （チャンネルを作った直後で、クリエイターダッシュボードに項目自体が無かった）。
              ⚠ 具体的な有効化手順は書かない——Twitch 側の導線は達成状況で変わり、
              **こちらで確認できないことを手順として書くと嘘になる**。
              代わりに「項目が出ていなければまだ使えない」という**確認できる事実**だけを書く。 */}
          <span className={styles.note}>
            ① Twitch
            側でチャンネルポイントが有効になっていること。⚠ 新しいチャンネルでは使えません（Twitch
            のクリエイターダッシュボードに「チャンネルポイント」の項目が出ていなければ、まだ有効になっていません）。
          </span>
          <span className={styles.note}>
            ②
            あなた自身のチャンネルに接続していること（Twitch
            の仕様で、他の人のチャンネルの引き換えは受け取れません）。他の人のチャンネルに接続しても、
            コメントの取得は通常どおり続きます。
          </span>
          {/* ⚠⚠ 穴 S: アプリに「ログアウト」「連携解除」の導線が無い（トークンは OS キーチェーンに永続する）ので、
              **やり直し方まで書かないと手順として成立しない**。⚠ これは 066 が既に抱えている問題で、
              アプリ内の導線を作るのは別タスク。ここでは**実際にできる手順**を書く。
              ⚠⚠⚠ **再修正トリガー＝ 066 をリリースするとき**（レビュー S-4）。あの時点で
              **既存ユーザー全員が再ログインを要求される**ので、「Twitch のサイトへ行って解除してくる」が
              全員の必須手順になる＝アプリ内導線の優先度をそこで上げること。
              ⚠ 導線ができたらこの文言も「設定から連携を解除してください」へ差し替える（手順を 2 通り残さない）。 */}
          <span className={styles.note}>
            ③ Twitch
            にログインし直していること（引き換えを見る許可を得るため）。ログインし直すには、Twitch
            のサイトの「設定 →
            接続」で StreamDock
            の連携をいったん解除してから、もう一度接続してください。
          </span>
          {/* ⚠ 「できないこと」も書く。報酬の消化・返却の権限（`channel:manage:redemptions`）は
              **意図的に取っていない**ので、期待されて「効かない」を作らないために明示する。 */}
          <span className={styles.note}>
            引き換えの取り消しや「完了」への変更は行いません（読み取りのみ）。
            YouTube に同じ機能はありません。
          </span>
          {/* ⚠⚠⚠ **ベータであることと、その理由を正直に書く。** 作者は Twitch
              側でチャンネルポイントを有効化できないため、**実際の引き換えでの動作確認ができていない**。
              ⚠ 「動作確認済みです」と読める書き方をしないこと。⚠ 報告してほしい内容を具体的に書くのは、
              「動きません」だけでは①②③のどれかを切り分けられないため（上の状態表示が手掛かりになる）。 */}
          <span className={styles.note}>
            ⚠ この機能はベータです。作者の環境ではチャンネルポイントを有効化できないため、実際の引き換えでの動作確認ができていません。
            うまく動かないときは、上に出ている受信状態と、上の 3
            つの条件のどれを満たしているかを添えて報告してください。
          </span>
        </div>
      </section>
    </div>
  );
}
