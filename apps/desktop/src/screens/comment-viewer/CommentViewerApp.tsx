import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CommentViewDto } from "../../features/comment-viewer/types";
import {
  createTtsQueue,
  type TtsQueue,
} from "../../features/comment-viewer/ttsQueue";
import { BUILTIN_READING_DICTIONARY } from "../../features/comment-viewer/readingDictionary";
import {
  checkEngineRunning,
  fetchSpeakers,
  type VoicevoxSpeaker,
} from "../../features/comment-viewer/voicevox";
import { launchVoicevoxEngine } from "../../features/comment-viewer/voicevoxApi";
import {
  createVoicevoxPreview,
  type VoicevoxPreview,
} from "../../features/comment-viewer/voicevoxPreview";
import {
  connectCommentStream,
  type CommentStreamHandle,
  type DeviceCodePrompt,
  type ObsOverlayKind,
} from "../../features/comment-viewer/commentStream";
import {
  loadChannel,
  saveChannel,
} from "../../features/comment-viewer/channelStorage";
import {
  loadTtsEnabled,
  saveTtsEnabled,
  loadVoicevoxAutolink,
  saveVoicevoxAutolink,
  loadSpeakTwitch,
  saveSpeakTwitch,
  loadSpeakYoutube,
  saveSpeakYoutube,
  loadTtsMaxLength,
  saveTtsMaxLength,
} from "../../features/comment-viewer/ttsPrefs";
import {
  loadSpeakerId,
  saveSpeakerId,
} from "../../features/comment-viewer/speakerStorage";
import {
  loadOverlayFont,
  saveOverlayFont,
  loadOverlayShowSource,
  saveOverlayShowSource,
  loadObsAutoAdd,
  saveObsAutoAdd,
  loadPinnedOverlayEnabled,
  savePinnedOverlayEnabled,
} from "../../features/comment-viewer/overlaySettings";
// 046a: 固定コメント（ピン留め）のピンストア。本体が唯一の書き手で、046b の固定専用オーバーレイが読み手になる。
import {
  savePinned,
  toPinned,
  PINNED_LIMIT,
  type PinnedComment,
} from "../../features/comment-viewer/pinnedComments";
// 044a: OBS 連携（方式A）。config 検出・パスワード設定は Rust command 経由、連携 ON/OFF は WS 制御フレーム。
import {
  detectObsWebsocketConfig,
  setObsWebsocketPassword,
  clearObsWebsocketPassword,
  type ObsWsConfig,
} from "../../features/comment-viewer/obsApi";
// 058a: 通知音の出力デバイス（②-軽）。列挙と再生は Rust command 経由（webview では出力先を選べない＝058s 実測）。
// 選択の永続化は他の UI 設定と同じ localStorage。読み上げ（Web Audio）には一切触れない。
import {
  listAudioOutputDevices,
  playNotificationSound,
  type AudioOutputDevice,
} from "../../features/comment-viewer/audioOutputApi";
import {
  loadAudioOutputDeviceId,
  saveAudioOutputDeviceId,
  NO_AUDIO_OUTPUT_DEVICE,
} from "../../features/comment-viewer/audioOutputPrefs";
import { mergeComments } from "../../features/comment-viewer/mergeComments";
import { recordComments } from "../../features/viewer-memory/viewerMemoryApi";
import type { RecordResult } from "../../features/viewer-memory/types";
import {
  openCommentOverlayWindow,
  closeCommentOverlayWindow,
  isCommentOverlayOpen,
  openPinnedOverlayWindow,
  closePinnedOverlayWindow,
  isPinnedOverlayOpen,
} from "../../features/comment-viewer/windowApi";
import { CommentList } from "./CommentList";
import {
  SettingsView,
  type AudioOutputListState,
  type AudioTestState,
} from "./SettingsView";
import { ViewersView } from "./ViewersView";
import { ViewerDetailPanel } from "./ViewerDetailPanel";
import { PinnedCommentBar } from "./PinnedCommentBar";
import { MonetaryTicker } from "./MonetaryTicker";
import { mergeMonetary } from "./monetaryFeed";
import { trackFirstOfStream } from "./firstOfStream";
import { isMonetaryEvent, viewerIdOf } from "./viewerFormat";
import { composeSpeechText } from "./speechText";
import { ConnectionCard } from "./ConnectionCard";
import { ToggleSwitch } from "./ToggleSwitch";
import styles from "./CommentViewerApp.module.css";

/**
 * 032c-a/032c-c: 内蔵コメントビューア（別ウィンドウ label `comment-viewer`）の描画本体。
 *
 * 受信コメント（`CommentViewDto`）を最小描画（append ＋ id 重複排除 ＋ 上限クランプ）しつつ、
 * 032c-c で **VOICEVOX ローカル合成読み上げ（Web Audio 直列 TTS キュー）** を配線する。新規追加コメントは
 * `mergeComments` の戻り値 `added` を単一注入点として TTS キューへ enqueue する。実データ取得
 * （Twitch/YouTube・Node sidecar・WebSocket）は 032c-b/-d で配線する。ネイティブタイトルバー
 * （capability は `core:default` のみ）で動くため、メイン画面のカスタム Header は再利用しない。
 */

/** ENGINE 稼働の再確認間隔（ミリ秒）。ループバック GET /version の軽いポーリング。 */
const ENGINE_POLL_INTERVAL_MS = 5000;

/**
 * 042b: 展開カード本体に出す取得セッションの詳細状態ラベル（sidecar の session.state に対応）。もとは
 * `SettingsView` の file-local だったが、接続 UI を本体カードへ移設したのでここへ移す。カード頭の
 * `STATUS_LABEL`（待機中/接続中/接続済み/失敗）とは別語彙（取得中 等）で、展開時の詳細行にだけ使う。
 */
const SESSION_STATE_LABEL: Record<string, string> = {
  idle: "待機",
  connecting: "接続中",
  connected: "取得中",
  failed: "失敗",
};

/**
 * 起動要求後にボタンを disabled 維持する猶予（ミリ秒）。多重 spawn 防止のため起動成功後もこの間は
 * 押せないようにする。VOICEVOX の初回起動はモデル読込で時間がかかるため長め。猶予内に稼働確認できれば
 * `engineRunning === true` 監視が先に解除する。猶予経過で自動解除し、起動が失敗した場合の永久 disabled を避ける。
 */
const LAUNCH_GRACE_MS = 30000;

/**
 * 033c/033d: VOICEVOX クレジット表記の案内。読み上げトグルが ON のときだけ、本体コメントビューのトグル直下に
 * 表示する。表示のみで外部通信は発生しない（URL は静的テキスト）。
 *
 * 033d: VOICEVOX の規約は「ソフトウェア規約」＋「音声ライブラリ（話者）ごとの個別規約」の 2 層で、クレジットの
 * 細則・許可範囲・禁止用途は**話者ごとに異なる**（公式 Q&A: キャラとソフトで権利者が別・各話者の規約を確認、
 * https://voicevox.hiroshiba.jp/qa/ ）。そのためアプリ側では条件を断定せず、①VOICEVOX クレジットが必要という
 * 共通事項 ②書き方の一般例「VOICEVOX:<話者名>」 ③公式規約と選択話者の規約を各自確認する誘導、に留める
 * （アプリが個別条件を保証しない＝責任回避）。話者名が未解決（ENGINE 未起動で一覧未取得）のときは一般例の
 * プレースホルダにフォールバックする。文面/URL は静的テキストで外部通信は発生しない。
 */
function creditNotice(speakerName: string | null): string {
  const target = speakerName
    ? `VOICEVOX:${speakerName}`
    : "VOICEVOX:（話者名）";
  return (
    `VOICEVOX の音声を配信・動画で使う場合、VOICEVOX を利用したことがわかるクレジット表記が必要です` +
    `（一般的な書き方は「${target}」）。ただし、表記の条件や利用できる範囲は話者（音声ライブラリ）ごとに異なります。` +
    `ご利用前に必ず VOICEVOX 利用規約 https://voicevox.hiroshiba.jp/term/ と、選択中の話者の利用規約をご確認ください。`
  );
}

// 038b フォローアップ: ツールバーのアイコンはアプリ規約に合わせインライン SVG（currentColor・viewBox 0 0 24 24）で統一する
// （絵文字だと OS 依存の多色になり設定/視聴者でトーンが揃わないため）。.settingsBtn の color（muted→hover text）を
// currentColor で継承し、外部リソースを読み込まない（自己完結・テーマ追従）。ToolRow/Header と同じローカル icon 慣習。
function GearIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-1.41 3.41 2 2 0 0 1-1.42-.59l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function ViewersIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

export function CommentViewerApp() {
  const [comments, setComments] = useState<CommentViewDto[]>([]);
  // 033b/038b: 表示モード（本体コメント / 設定 / 視聴者）。歯車ボタンで settings、人型ボタンで viewers へ、
  // 各ビューの戻るボタンで comment へ切替。切替は描画のみで、接続 state・WS・TTS は本コンポーネントに残るため、
  // 設定/視聴者を表示中もコメント受信・蓄積は継続し（WS は窓内 1 本のまま）、本体へ戻ると全件が並ぶ。
  const [view, setView] = useState<"comment" | "settings" | "viewers">(
    "comment",
  );
  // 042b（デザイン改修）: ヘッダー内 接続ピル（Twitch / YouTube）のポップオーバー開閉。1 つずつ開く（ラジオ排他）ので
  // 独立 bool ではなく単一の openCard で持つ（一方を開くと他方は自動的に閉じる）。表示状態のみでコメント受信・WS には触れない。
  const [openCard, setOpenCard] = useState<"twitch" | "youtube" | null>(null);
  // ポップオーバーの「外側クリック」/ Esc 判定用に、ピル 2 枚＋各ポップオーバーを内包する cluster を参照する。
  const connClusterRef = useRef<HTMLDivElement | null>(null);
  // 042b（デザイン改修）: ポップオーバーは外側クリックまたは Esc で閉じる。開いている間だけ document リスナを張る
  // UI 専用の effect で、WS/sidecar には一切触れない（窓内 WS 1 本のまま）。cluster 内クリック（＝他方のピル）は
  // トグルで切替＝ラジオ排他が成立し、ポップオーバー内（フォーム）クリックでは閉じない。
  useEffect(() => {
    if (openCard === null) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!connClusterRef.current?.contains(e.target as Node)) {
        setOpenCard(null);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // レビュー対応（a11y）: Esc で閉じる前に、開いているピル（`aria-expanded="true"`＝ラジオで常に 1 枚）へ
      // フォーカスを戻す。フォーカスがポップオーバー内（入力/ボタン）にあるまま unmount すると focus が body へ落ち、
      // キーボードユーザーが操作位置を失うため。state 更新前なので DOM にまだ開いているピルが在り querySelector で拾える。
      // 外側クリック（pointer）では戻さない（ユーザーは既に別要素へ操作を移しており、戻すと逆に邪魔になるため＝disclosure の定石）。
      connClusterRef.current
        ?.querySelector<HTMLElement>('[aria-expanded="true"]')
        ?.focus();
      setOpenCard(null);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [openCard]);
  // 038b フォローアップ: 流れているコメントをクリックすると、コメント本体の右にその視聴者の詳細をスプリット表示する
  // （× で閉じる）。WS/comments/recordComments/sessionIdRef には触れない＝コメント受信は止まらず、選択 id を持つだけ。
  const [selectedViewerId, setSelectedViewerId] = useState<string | null>(null);
  // 038c: コメント id → 初見/久しぶり判定。record_comment の戻り値（実挿入の初回のみ肯定）を受けて、
  // CommentList の該当行に「初見」「久しぶり」バッジ＋枠色を出す。**肯定判定のみ格納**するため、
  // Map サイズは新規/復帰視聴者の distinct 数でバウンドし小さい（通常コメントは載せない）。判定は
  // 端末外へ出さない真偽 2 値のみ（§9）。
  // apply-review(品質Q2・後回し可): この Map は配信セッション中プルーニングしない（表示窓 200 件外へ流れた
  // 肯定判定も保持する）。1 エントリは極小（id 文字列＋真偽 2 値）で端末外送信も無く実害が小さいため据え置く。
  // 再修正トリガー: 長時間配信で distinct な新規/復帰視聴者数が実測でメモリ問題化したら、comments の 200 件
  // クランプに整合させて prune する。
  const [viewerBadges, setViewerBadges] = useState<Map<string, RecordResult>>(
    () => new Map(),
  );
  // 051: 「その配信で初めてしたコメント」＝ viewerId → その視聴者のこの配信での初コメント id。
  // 038c の判定（初見/久しぶり）は**その視聴者の「来訪の 1 件目」**にしか付かないので、
  // 「初見/久しぶり ⊂ その配信の初コメント」だが**逆は成り立たない**（毎回来る常連の初コメントには
  // 判定が付かない）。「今日はじめて喋った人」に「初コメ」バッジ＋枠色を出すにはこちらが要る。
  // 蓄積規則は `firstOfStream.ts` の純関数（**既記録の viewerId は上書きしない**＝冪等）に閉じてある。
  // 永続しない（セッション内のみ・`viewerBadges` と同じ扱い）。窓のマウント単位＝`sessionIdRef` と同じ粒度。
  const [firstOfStream, setFirstOfStream] = useState<
    ReadonlyMap<string, string>
  >(() => new Map());
  // 表示側（CommentList）が要るのは「初コメントの id 集合」だけなので、Map から導出する。
  // Map は同一参照 early-out を持つので、変化が無いバッチでは この useMemo も再計算されない。
  const firstOfStreamIds = useMemo(
    () => new Set(firstOfStream.values()),
    [firstOfStream],
  );
  // TTS キュー（AudioContext を 1 つ所有）。マウントで生成し、アンマウントで dispose する。
  const ttsRef = useRef<TtsQueue | null>(null);
  // 034c: 話者サンプル試聴プレイヤー（中断切替つき・本線 TTS とは別の AudioContext）。設定ビューで話者/スタイルを
  // 選ぶと選択 style id の声を即再生し、再生中に別の声を選ぶと前を中断して切り替える。マウントで生成・アンマウントで
  // dispose する（ttsRef と同型）。読み上げ本線には積まない（干渉しない）。
  const previewRef = useRef<VoicevoxPreview | null>(null);
  // ENGINE 稼働状態（null=未確認 / true=稼働 / false=未起動）と起動誘導の状態。
  const [engineRunning, setEngineRunning] = useState<boolean | null>(null);
  const [launchNotice, setLaunchNotice] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);
  // 起動要求済みフラグ。起動成功後、ENGINE が /version で稼働確認できるまで（または猶予経過まで）true に
  // して「VOICEVOX を起動」ボタンを disabled 維持し、連打による多重 spawn を防ぐ（2 つ目以降は 50021 バインド
  // 失敗で即終了するが registry に死んだ handle が溜まるため未然に抑止する）。未登録/失敗時はセットせず再試行可。
  const [launchRequested, setLaunchRequested] = useState(false);

  // 033c: VOICEVOX 読み上げ ON/OFF（既定 OFF・localStorage 永続）。ON のときだけコメントを読み上げ、
  // ON のときだけクレジット表記を出す。全員が読み上げを使う訳ではないため既定は無効。
  const [ttsEnabled, setTtsEnabled] = useState(() => loadTtsEnabled());
  // 033c: VOICEVOX 自動連携（既定 OFF・localStorage 永続）。ON なら窓オープン時に ENGINE を 1 回自動起動する。
  const [voicevoxAutolink, setVoicevoxAutolink] = useState(() =>
    loadVoicevoxAutolink(),
  );

  // 035c: source 別の読み上げ ON/OFF（既定は両方 ON・localStorage 永続）。両プラットフォーム同時取得時の読み上げ暴発を
  // 抑えるため source 単位で読み上げを絞る。既定 ON で現行の全読み上げ挙動を踏襲する。OFF でも表示・一覧は全 source
  // 継続で、絞るのは読み上げキュー投入（enqueueForSpeech）だけ。
  const [speakTwitch, setSpeakTwitch] = useState(() => loadSpeakTwitch());
  const [speakYoutube, setSpeakYoutube] = useState(() => loadSpeakYoutube());

  // 048: 1 件あたりの読み上げ最大文字数（既定 60・localStorage 永続）。超過分は「、以下略」で打ち切る。
  // 省略は常時有効（ON/OFF トグルは持たない）で、変えられるのは文字数だけ。**表示は全文のまま**で、
  // 切り詰まるのは ttsQueue へ渡す読み上げテキストだけ。
  const [ttsMaxLength, setTtsMaxLength] = useState(() => loadTtsMaxLength());

  // 033d: 読み上げ話者（VOICEVOX style id・localStorage 永続）。未選択時の既定は 3（ずんだもんノーマル）。
  const [selectedSpeakerId, setSelectedSpeakerId] = useState(() =>
    loadSpeakerId(),
  );
  // 033d: 話者・スタイル一覧（ENGINE 稼働後に GET /speakers で取得して埋める）。未起動時は空のまま。
  const [speakers, setSpeakers] = useState<VoicevoxSpeaker[]>([]);

  // 033c: 起動の各契機（読み上げ ON / 自動連携 / 手動ボタン）が参照するガード用 ref 群。stale closure を避け、
  // 安定な launchEngine / enqueueForSpeech から最新値を読む。同期は下の useEffect 群で行う。
  const ttsEnabledRef = useRef(ttsEnabled);
  const engineRunningRef = useRef(engineRunning);
  const launchRequestedRef = useRef(launchRequested);
  // 035c: source 別読み上げ ON/OFF を安定 enqueueForSpeech（useCallback []）から最新値で読むための ref。
  // state を直接 useCallback の依存に入れると enqueueForSpeech が作り直され、それを依存に持つ WS 接続 effect が
  // 張り直されて「窓内 1 本」原則に反するため、ttsEnabledRef と同様に ref 経由で参照する。
  const speakTwitchRef = useRef(speakTwitch);
  const speakYoutubeRef = useRef(speakYoutube);
  // 033d: TTS キューは合成直前に getter で最新の選択話者を読む（キューを作り直さない）。state の stale closure を
  // 避けるため ref に同期し、createTtsQueue の getSpeakerId から参照する。
  const selectedSpeakerIdRef = useRef(selectedSpeakerId);
  // 048: 読み上げ最大文字数も同じ理由で ref に同期し、createTtsQueue の getMaxLength から参照する
  //（文字数を変えてもキューを作り直さない＝再生中の読み上げやバックログを落とさない）。
  const ttsMaxLengthRef = useRef(ttsMaxLength);
  // 起動中フラグ（state ではなく ref）。launchEngine 先頭で最初の await より前に立て、同一 tick/並行の
  // 複数契機が来ても spawn を 1 回に抑える同期ガード（launchRequested は起動成功後の窓を守る別レイヤ）。
  const launchInFlightRef = useRef(false);

  // 038a: 視聴者メモリの「その配信」の束を識別するローカル session_id。窓マウント毎に 1 つ採番し、
  // この窓の全 record_comment に付与する（専用 session テーブルは持たない・端末外へ出さないローカル ID）。
  // 【意図/修正不要理由】採番は crypto.randomUUID。Tauri webview は secure context 前提で対象 OS
  //   （WKWebView/WebView2/WebKitGTK）いずれも利用可能なため fallback は置かない。
  // 【再修正トリガ】非 secure context/古い webview で randomUUID 未定義エラーが出たら try/catch + 簡易 fallback を足す（Q4）。
  const sessionIdRef = useRef<string>("");
  if (!sessionIdRef.current) {
    sessionIdRef.current = crypto.randomUUID();
  }

  // 032c-b: Twitch 連携（Device Code ログイン・取得セッション）の状態。
  const streamRef = useRef<CommentStreamHandle | null>(null);
  const [streamConnected, setStreamConnected] = useState(false);
  const [deviceCode, setDeviceCode] = useState<DeviceCodePrompt | null>(null);
  const [sessionState, setSessionState] = useState<string>("idle");
  const [sessionReason, setSessionReason] = useState<string | null>(null);
  // 032c-b: Twitch ログイン済みか（sidecar が keychain 復元・ログイン成功・失効で link.state を送る）。
  // これで再オープン時に「毎回ログインし直し」を避け、接続済みなら取得開始だけで済ませる。
  const [linked, setLinked] = useState(false);
  // 032c-d: YouTube 連携（Authorization Code ログイン）の状態。Twitch と併存し各サービス個別に選択する。
  // 032c-d′: YouTube も Twitch 同様 OS キーチェーンに永続化するため、窓再オープン／再起動でも再ログイン不要。
  const [youtubeLinked, setYoutubeLinked] = useState(false);
  const [youtubeSessionState, setYoutubeSessionState] =
    useState<string>("idle");
  const [youtubeSessionReason, setYoutubeSessionReason] = useState<
    string | null
  >(null);
  // 032c-b: チャンネル名は localStorage から復元し、変更のたびに保存する（窓を閉じても空欄化しない）。
  const [channel, setChannel] = useState(() => loadChannel());

  // 034d: OBS オーバーレイ窓の開閉状態（045b でトグルの置き場所は本体ツールバーへ移設。開＝ON / 閉＝OFF）。
  // 045b 後も state はこの窓に置いたまま（handleObsAutoAddToggle が未開判定に参照する）。窓の実状態と同期させ、
  // ①初期化・再マウント時に isCommentOverlayOpen() で同期 ②トグル操作後に更新する。
  // 034f（回帰修正）: 旧実装は comment-overlay 窓へ cross-window の onCloseRequested を張っていたが、これがあると
  // Tauri が close-requested を JS へ委譲し（core が prevent_close）、JS ラッパの destroy() が capability
  // （core:default に allow-destroy 無し）で拒否され、トグル OFF でも窓が閉じなかった。購読を撤去し、OFF は Rust
  // close()（capability 非依存の直接 API）で確実に閉じる。外部閉じの即時同期は失うが、overlay は枠なし・非フォーカス・
  // 最背面で手動 close 手段が実質無く、再オープン時は下の mount 同期で復元されるため実害なし。
  const [overlayOpen, setOverlayOpen] = useState(false);

  // 034e: OBS オーバーレイの表示設定（フォント / サイト名表示・localStorage 永続）。この窓は設定 UI と永続化のみ担い、
  // 実際の描画反映はオーバーレイ窓（OverlayApp）が同一 localStorage を storage 購読で受けて行う（両窓は別 webview）。
  const [overlayFont, setOverlayFont] = useState(() => loadOverlayFont());
  const [overlayShowSource, setOverlayShowSource] = useState(() =>
    loadOverlayShowSource(),
  );

  // 046a: 固定コメント（ピン留め）。変化のたびに localStorage へ保存する（channel / overlayFont と同型）。
  // 書換は他窓（046b の固定専用オーバーレイ）で storage イベントを発火させる。
  // 上限は PINNED_LIMIT（046a では 1＝単一ピン）で、超過分は最古から押し出す。
  //
  // **046b レビュー（S-1・依頼者の決定で挙動変更）: 前回セッションの固定は引き継がず、必ず空で始める**
  //（当初は `loadPinned()` で初期化＝窓を開き直しても復元していた）。理由は、046b で
  // ①ピン本体 ②「固定コメントをOBSに表示」トグル の 2 つが永続し、さらに ③ON ならマウント時に窓を自動 open
  // するようになった結果、**前回配信で固定したコメント（表示名・本文・金額）が次の配信の開始時に操作ゼロで
  // 本番画面へ出る**ようになったため（窓は最背面・透過で配信者自身は気付きにくい）。
  // 永続した第三者の個人データが「配信に出る面」へ自動描画されるのは 046b が初めてで、docs/security.md の
  // §9 追補（046a）が対象とするデータそのもの。**ピンストアの役割は本体窓↔オーバーレイ窓の受け渡し**であって
  // セッションをまたぐ保存ではないので、この変更は 046a の設計意図と矛盾しない。
  // なお `pinnedComments.ts`（ストア側）は無改変＝保存形・キー・上限・046b の読み手契約はいずれも不変で、
  // 「いつ空へ倒すか」だけを本体側で決めている。**localStorage を空へ倒すのは下の専用 effect
  // （`savePinned([])` をマウント時に 1 回）**で、state の初期値をここで `[]` にするのと 2 点セットで S-1 を担保する
  //（当初は永続化 effect のマウント時 1 発に相乗りしていたが、レビュー指摘で独立させた）。
  // 再修正トリガー＝「配信をまたいで固定を残したい」という要望が出たら、①起動時クリアをやめる のではなく
  // 「前回の固定を復元しますか」を明示操作にする（無操作で配信面に出さない、を守る）。
  //
  // 固定は**固定した時点のスナップショット**（comments の参照ではなくコピー）。狙いは ①一覧が MAX_COMMENTS で
  // クランプされて流れ去っても固定が残る ②046b が WS 無しで描ける、の 2 点。代償として、043e の jewels combo 更新
  // （mergeComments が既存行を上書きする唯一の経路）が後から届いても固定側の金額/combo は古いままになる。
  // 固定は「見失わないための再掲」で、更新は流れる一覧側で見えるため許容する。
  // 再修正トリガー＝固定した投げ銭の金額が伸びていくのを固定側でも追いたくなったら、mergeComments の updated を
  // 拾って pinned の同 id を差し替える（そのときも保存形は変えなくてよい）。
  const [pinned, setPinned] = useState<PinnedComment[]>([]);

  // 047: 上部の課金ティッカー（横スクロールの常時表示帯）が使う蓄積。**`comments` から導出しない**のは、
  // `comments` が MAX_COMMENTS(=200) でクランプされ、200 件のコメントが流れた時点でティッカーから投げ銭が
  // 消えてしまうため（「見失わないための常時表示」という機能の目的を直接壊す・046a が実機で踏んだのと同じ轍）。
  // 蓄積規則は `monetaryFeed.ts` の純関数に閉じてある（上限 50・最新が先頭・jewels の combo 更新に追随）。
  // **localStorage には保存しない**（前回配信の投げ銭が次の起動でユーザー操作ゼロで画面に出る経路を作らない＝
  // 046b の S-1 と同じ方針・docs/security.md §9 追補〔046a〕）。
  //
  // 【セキュリティレビュー S-1・修正不要】「永続しない」は**ディスクに残らない**であって「画面から消える」では
  // ない。従来 投げ銭の表示名・金額は MAX_COMMENTS(=200) のローリングで流れ去っていたが、ティッカーは配信 1 本の
  // あいだ最大 50 件を出しっぱなしにする＝**画面滞在時間は明確に伸びている**。OBS のウィンドウキャプチャ経路
  //（044a）は「StreamDock コメントオーバーレイ」「StreamDock 固定コメント」の 2 窓のみが対象でコメビュ本体窓は
  // 含まれないため配信への露出は増えないが、配信者が**画面全体キャプチャ**を使う場合は視聴者名＋金額が配信中ずっと
  // 映る。これはコメビュ本体窓（コメント一覧も同様に映る）が元から持つ性質で 047 が新しいリスク種別を作っては
  // いないため据え置く。再修正トリガー＝「ティッカーを OBS オーバーレイにも出したい」要望が出たとき
  //（そのときは 046b S-1 と同じ土俵＝§9 追補の対象になるので security-review を通すこと）。
  //
  // 【S-B（047e レビュー）・修正不要】047b で露出物が 1 つ増えている: **本体窓が第三者のアバター画像を描くように
  // なった**（従来 画像を描くのは OBS オーバーレイだけで、本体窓は文字のみだった）。描画は一覧の課金カード／
  // ティッカーのピル／全文ダイアログの 3 箇所。新規 fetch・新規永続化はゼロ（036b が既にメモリへ載せた data URI を
  // 描くだけ・ガードは viewerFormat.ts の avatarDataUri 1 実装）なので §9 追補の発火条件（＝**永続化**の変更）には
  // 当たらないが、画面全体キャプチャ時に露出するものに「顔写真」が加わったのは事実なので明記しておく。
  // 固定帯（046a）は toPinned が author.avatar を落とすため頭文字のみ＝localStorage にも画面にも画像は出ない。
  // 再修正トリガー＝アバターを**保存**するようになったとき（そのときは §9 追補の対象＝security-review 必須）。
  const [monetary, setMonetary] = useState<CommentViewDto[]>([]);
  // 047: 展開済み（＝既読）の課金コメント id。ティッカー側ではなく**ここ**が持つ理由は、設定ビュー／視聴者ビューへ
  // 切り替えると `view === "comment"` の分岐ごとアンマウントされ、ティッカー内の state だと既読が消えるため
  // （`pinned` / `viewerBadges` と同じ置き場所）。こちらも永続しない（セッション内のみ）。
  //
  // 【軽レビュー・修正不要】`monetary` は MONETARY_MAX(=50) でクランプされるが、この Set は**上限から落ちた
  // id も持ち続ける**（＝配信中は単調増加する）。据え置く理由は ①要素は課金コメント 1 件あたり 1 個の id 文字列で、
  // 長時間配信でも数百エントリ＝数十 KB 程度 ②`viewerBadges`（Map・同じく単調増加）が先例として同じ扱い
  // ③落ちた id を掃除する側の実装（`monetary` の変化を購読して差集合を取る effect）は、掃除中に同じ id が
  // 再来したときに「既読が未読へ戻る」ほうの壊れ方を作りうる。
  // **③の具体的な発火機構（レビューで明示）**: 上限から落ちた jewels に後から 043e の combo 更新が届くと、
  // `mergeMonetary` の findIndex が -1 を返して**新規として先頭へ積み直される**。掃除 effect を入れていると
  // その id は既に Set から消えているため、**一度読んだ投げ銭が未読（赤枠）として復活する**。
  // 単調増加のままならこの経路でも既読が保たれる＝掃除しないことが正しさに寄与している。
  // 再修正トリガー＝プロファイルで実際にメモリが問題化したとき（そのときは `monetary` の id 集合で
  // intersection を取る effect を 1 つ足す）。
  const [readMonetaryIds, setReadMonetaryIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  // 047f: `mergeMonetary` は setState の updater 内で呼ばれるので、既読集合を**その場で読む**手段が要る
  // （クランプで「既読から先に捨てる」ため）。この window の他の getter 注入と同じ ref 同期イディオム。
  //
  // ⚠ ref は 1 レンダー遅れるが、**遅れは「捨てすぎる」方向ではなく「残しすぎる」方向にしか効かない**
  // （既読化をまだ知らない ＝ 未読扱い ＝ 捨てない）。未読を落とさないことが本修正の目的なので、
  // ラグは安全側に倒れている＝同期を厳密化する必要がない。
  // ⚠ **この論証は「`readMonetaryIds` が単調増加（既読は減らない）」を前提にしている**。上の
  // `setReadMonetaryIds` が唯一の更新点で、集合をクリアする経路は存在しないため成立している。
  // 再修正トリガー＝「ティッカーをクリア」「配信切替で既読リセット」等で**既読が減る経路**を足すとき。
  // そのときラグの向きは反転する（既読と誤認して**未読を捨てる**）ので、ref 同期では足りなくなる。
  const readMonetaryIdsRef = useRef<ReadonlySet<string>>(readMonetaryIds);
  useEffect(() => {
    readMonetaryIdsRef.current = readMonetaryIds;
  }, [readMonetaryIds]);

  // 046b: 「固定コメントをOBSに表示」トグルの状態＝固定専用オーバーレイ窓（label `pinned-overlay`）を出すか。
  // 034d/045b のオーバーレイ表示トグル（`overlayOpen`）と違い**localStorage に永続**する。理由は
  // ①これは配信中に切り替える操作ではなく「OBS のウィンドウキャプチャに固定コメント窓を仕込む」一度きりの
  // セットアップ（固定/解除は右クリックメニュー側の仕事で、窓は開けっぱなしにする）②毎回 ON にし直させると
  // 配信開始時に窓が無く、OBS 側のソースが取り込めない状態から始まる、の 2 点（依頼者の決定）。
  // 永続値が真のときはマウント時に窓を開き直す（下の 046b effect）。
  const [pinnedOverlayEnabled, setPinnedOverlayEnabled] = useState(() =>
    loadPinnedOverlayEnabled(),
  );
  // 046b レビュー（要修正・連打レース）: 固定オーバーレイ窓の開閉要求を**直列化**するキュー。
  // `open_pinned_overlay_window` は `#[tauri::command(async)]`（別スレッド・窓生成で数百 ms）、
  // `close_pinned_overlay_window` は同期コマンドなので、素の `void invoke()` だと ON→OFF 連打で
  // 「close が『窓なし＝no-op』で先に流れ、その後 open が窓を作る」順序が起こりうる。046b は
  // 自動 close 経路を持たない設計のため、この状態は**セッション中に解消せず**「設定 OFF なのに
  // 固定コメントが OBS に映り続ける」になる。前の要求の完了後に次を流すことで最後の意図が勝つようにする。
  // マウント同期 effect もこのキューに載せる（永続値の復元と、その解決前のトグル操作が競合するため）。
  // `.catch` はキューを詰まらせないための握りつぶし（reject を伝播させると以降の開閉要求が全て死ぬ）。
  const pinnedOverlayOpRef = useRef<Promise<void>>(Promise.resolve());

  // 044a: OBS 連携（方式A＝ウィンドウキャプチャ自動追加）。
  // - obsConfig: OBS の WebSocket 設定の read-only 検出結果（有効/ポート/認証要否）。null=未検出（未導入/未設定）。
  // - obsAutoAdd: 「OBS へ自動追加（連携）」トグルの永続状態（非機密・localStorage）。パスワードは保存しない。
  // - obsState: sidecar からの obs.state 通知（connecting/added/reused/failed/idle）。UI の状態表示に使う。
  //   ※失敗時の技術的 reason（ECONNREFUSED 等）はユーザーに無意味なため UI では表示しない（reason は受けても捨てる）。
  //   045c レビュー（union にしない / 修正不要）: sidecar には ObsState union（obs-client.ts）があるが、こちらは
  //   string のまま置く。①同コンポーネントの sessionState / youtubeSessionState も useState<string> で慣習が揃う
  //   ②ツールバーの `obsState === "failed"` を typo すると CommentViewerApp.toolbar.test.tsx の failed ケースが落ちる
  //   ③そもそも受け口 CommentStreamHandlers.onObsState が (state: string) なので、ここだけ union にしても境界は
  //   守られない。再修正トリガー＝viewer/sidecar で状態型を共有する（別タスク）とき。中途半端な union 化はしない。
  const [obsConfig, setObsConfig] = useState<ObsWsConfig | null>(null);
  const [obsAutoAdd, setObsAutoAdd] = useState(() => loadObsAutoAdd());
  const [obsState, setObsState] = useState<string>("idle");
  // 045c レビュー（回帰）: 表示 ON で仕掛ける猶予タイマー（OBS_ENABLE_DELAY_MS）の id。取り消せるように保持する。
  // 旧実装は id を捨てていたため、猶予中に表示 OFF / 自動反映 OFF にしても発火が止まらず、hideObs / disableObs の
  // **後に** enableObs が飛んでいた（OBS 側で閉じた窓のソースが再表示され、ツールバーにも表示 OFF のまま赤字が残る）。
  const obsEnableTimerRef = useRef<number | null>(null);
  // 046d: 固定コメントオーバーレイ用の猶予タイマー。コメント一覧用（上）とは**別に持つ**
  //（片方の ON がもう片方の仕掛かりを取り消してしまわないようにする）。
  const pinnedObsEnableTimerRef = useRef<number | null>(null);

  // 058a: 通知音の出力デバイス（②-軽）。
  // - audioOutputDeviceId: ユーザーが選んだデバイス ID の永続状態（非機密・localStorage）。
  //   `""`＝未選択で、これは**「既定デバイスで鳴らす」ではなく「鳴らさない」**を意味する
  //   （②-軽では OS 既定＝仮想オーディオデバイス＝配信に載る側なので、既定へ落とすと
  //   「載せないつもりの通知音が配信に載る」＝機能の存在理由が壊れる。fail-closed）。
  // - audioOutputDevices / audioOutputListState: Rust の列挙結果とその状態。
  //   **デバイス名は state に置くだけで保存しない**（古い名前を残さない・§9）。
  // - audioTestState: テスト再生の状態。obsState と同じ「操作の結果を 1 行で出す」構え。
  //   ここは string ではなく union にする（受け口が sidecar 由来の `(state: string)` である
  //   obsState と違い、この state の書き手はこのファイルだけ＝union を守り切れるため）。
  const [audioOutputDeviceId, setAudioOutputDeviceId] = useState(() =>
    loadAudioOutputDeviceId(),
  );
  const [audioOutputDevices, setAudioOutputDevices] = useState<
    AudioOutputDevice[]
  >([]);
  const [audioOutputListState, setAudioOutputListState] =
    useState<AudioOutputListState>("loading");
  const [audioTestState, setAudioTestState] = useState<AudioTestState>("idle");

  useEffect(() => {
    saveChannel(channel);
  }, [channel]);

  // 058a: 選んだ出力デバイスを localStorage に永続化する（再オープン・再起動で復元）。
  // マウント時にも 1 回走って同じ値を書き直すが、既存の saveChannel / saveObsAutoAdd と同じ挙動で、
  // このキーを `storage` イベントで購読している窓は無いため無害（音はコメビュ窓でしか鳴らない）。
  // 再修正トリガー＝このキーを購読する窓を足すとき。
  useEffect(() => {
    saveAudioOutputDeviceId(audioOutputDeviceId);
  }, [audioOutputDeviceId]);

  // 058a: 出力デバイスを列挙し直す。
  //
  // ⚠ **失敗を空配列で潰さない。** 「デバイスが 1 つも無い」と「列挙できなかった」は UI の案内が違い、
  // どちらも「選んだデバイスが一覧に無い」＝**通知音が鳴らない**状態なので、黙って既定へ落とさず
  // ユーザーに気付かせる必要がある（058s が明示的に警告している論点）。
  //
  // アンマウント後 setState のガード（AbortController / mounted フラグ）は**意図的に持たない**
  // （レビュー指摘に対する判断）。理由＝`CommentViewerApp` はこの窓のルート相当で通常アンマウント
  // されず、React 18 以降はアンマウント後 setState の警告も出ない。「再読み込み」連打で複数の invoke が
  // in-flight になると後勝ちになるが、同じ列挙結果なので実害が無い。
  // 再修正トリガー＝このコンポーネントを条件付きレンダリングするようになるか、列挙結果が呼び出しごとに
  // 変わりうる（フィルタ引数を足す等）ようになったとき。そのときは世代番号（useRef）で最新のみ採用する。
  const refreshAudioOutputDevices = useCallback(() => {
    setAudioOutputListState("loading");
    listAudioOutputDevices()
      .then((devices) => {
        setAudioOutputDevices(devices);
        setAudioOutputListState("ready");
      })
      .catch(() => {
        // §9: 例外オブジェクトを画面にもコンソールにも出さない（デバイス名/ID を含みうる経路を作らない）。
        setAudioOutputDevices([]);
        setAudioOutputListState("failed");
      });
  }, []);

  // 058a: 設定ビューを開くたびに列挙し直す（＝デバイスを挿し直したら開き直せば直る）。
  // ホットプラグ監視（デバイス着脱イベントの購読）は 058a では入れない——設定を開いた時点の突き合わせと
  // 「再読み込み」ボタンとテスト再生の失敗表示の 3 段で、「黙って載る側に倒れる」は防げる。
  useEffect(() => {
    if (view !== "settings") return;
    refreshAudioOutputDevices();
  }, [view, refreshAudioOutputDevices]);

  // 058a: 選んだデバイスでテスト音を鳴らす。
  // 「選んだデバイスから鳴る」と「既定デバイスからは鳴らない」の 2 点を耳で確かめるための唯一の手段で、
  // これが無いと 058s の合格基準を 058a 単体で測れない（034c の話者試聴ボタンと同じ考え方）。
  const handleTestNotificationSound = useCallback(() => {
    if (audioOutputDeviceId === NO_AUDIO_OUTPUT_DEVICE) return;
    setAudioTestState("playing");
    playNotificationSound(audioOutputDeviceId, "test")
      .then(() => setAudioTestState("idle"))
      // 失敗＝そのデバイスでは鳴らせない。**既定デバイスで鳴らし直さない**（fail-closed）。
      .catch(() => setAudioTestState("failed"));
  }, [audioOutputDeviceId]);

  // 058a: デバイスを選び直したら直前の失敗表示を消す（古い赤字が残って混乱させない）。
  const handleAudioOutputDeviceIdChange = useCallback((deviceId: string) => {
    setAudioOutputDeviceId(deviceId);
    setAudioTestState("idle");
  }, []);

  // 034d: マウント時に実際の窓状態へトグルを同期する（外部で開閉されていても実状態に合わせる）。
  useEffect(() => {
    void isCommentOverlayOpen().then(setOverlayOpen);
  }, []);

  // 046b レビュー S-1（対応の明示化）: 前回セッションのピンを**必ず捨てる**。
  // 狙い＝「前回配信で固定したコメント（表示名・本文・金額）が、次の配信の開始時にユーザー操作ゼロで
  // 本番画面へ出る」経路を断つこと（docs/security.md §9 追補〈046a〉の ⚠ 節）。
  //
  // **この effect が S-1 の担保そのもの**。当初は下の `savePinned(pinned)` effect が「マウント時に `"[]"` を
  // 1 発書く」副産物に依存していたが、①汎用の永続化 effect が意図を表明していない ②同型の save effect が
  // 10 個ほど並んでいるため「初回スキップ/前回値比較」の一括最適化で静かに壊れる ③所有者の単位でテストできない、
  // の 3 点でレビュー指摘を受けたため、独立した effect として明示した。
  //
  // ⚠ **下の 046b マウント同期 effect（窓を開く）より前に宣言すること**。この書込は同期で、窓を開く経路は
  // async（invoke＝マイクロタスク境界を越える）なので、宣言順とマイクロタスク境界の二重で
  // 「クリアが窓生成より先」が保証される。**未検証の `storage` 跨ぎ配送には依存しない**
  //（再起動時はオーバーレイ窓がまだ存在せず、窓が開くのは必ずこの書込の後＝read-on-mount が空を読む）。
  // `storage` に依存するのは「オーバーレイを開いたままコメビュ窓だけ開き直した」二次ケースのみ。
  //
  // `pinnedComments.ts`（ストア側）は無改変＝キー・保存形・上限・046b の読み手契約はいずれも不変で、
  // 「いつ空へ倒すか」だけを本体側で決めている（`clearPinned()` を新設せず `savePinned([])` を使うのはこのため）。
  // 再修正トリガー＝「配信をまたいで固定を残したい」要望が出たら、この effect を消すのではなく
  // 「前回の固定を復元しますか」を明示操作にする（**無操作で配信面に出さない**、を守る）。
  useEffect(() => {
    savePinned([]);
  }, []);

  // 046b: マウント時、「固定コメントをOBSに表示」が ON なのに窓が無ければ開き直す（永続設定の復元）。
  // 034d の overlayOpen と**向きが逆**なのは意図的で、こちらは永続設定が真＝ユーザーの意思なので、
  // 実窓ではなく設定へ合わせる（配信開始時に OBS ソースが黒いままにならない）。
  // 逆に設定 OFF で窓が開いていた場合は**何もしない**: 親 046 は「ピン 0 件で窓が自動的に閉じると OBS の
  // ウィンドウキャプチャソースが壊れる」ことを理由に**自動 close を禁じている**ため、自動で閉じる経路は作らない
  //（ここで開くのはユーザーが明示的に ON にした設定に基づく自動 open で、親 046 の懸念とは向きが逆＝
  //  窓がより確実に存在する方向。逸脱の理由は docs/progress.md の 046b 節に明記した）。
  // open は Rust 側で冪等（既存なら show して return）なので厳密には is* を挟まなくても動くが、
  // 「開いているなら触らない」ことを明示して最背面窓の余計な show を避ける。
  // 依存配列を空にして**マウント時 1 回だけ**にするのは、トグル操作のたびに再実行させないため
  //（トグルの実開閉は handlePinnedOverlayToggle が行う）。
  // 046b レビュー（修正不要・意図の明記）: state（pinnedOverlayEnabled）ではなく loadPinnedOverlayEnabled() を
  // 直読みするのは、exhaustive-deps 回避が発端だが**解決時点の永続値を読む方が正しい**ため意図的に残す。
  // is* の解決を待っている間にユーザーが OFF にした場合、state 参照（deps 空＝stale closure）だと古い true を
  // 見て窓を開いてしまうが、直読みなら最新値（false）を見て開かない。
  // 再修正トリガー＝この effect が永続値以外の state にも依存するようになったら、ref 同期に切り替える。
  useEffect(() => {
    pinnedOverlayOpRef.current = pinnedOverlayOpRef.current
      .then(() => isPinnedOverlayOpen())
      .then((open) => {
        if (loadPinnedOverlayEnabled() && !open) {
          return openPinnedOverlayWindow();
        }
      })
      .catch(() => {});
  }, []);

  // 044a: マウント時に OBS の WebSocket 設定を read-only 検出する（有効/ポート/認証要否）。
  // これで設定 UI が「WS 無効です／認証が必要です」を正確に案内し、認証時のみパスワード入力を出せる。
  // 検出できない（未導入/未設定/読取不可）ときは null＝有効化ガイドを出す。書き込みは一切しない（§5）。
  useEffect(() => {
    void detectObsWebsocketConfig().then(setObsConfig);
  }, []);

  // 045c レビュー: アンマウント時にも猶予タイマーを止める。streamRef が null 化されるので enableObs 自体は飛ばないが、
  // 破棄済みツリーへ setObsState("failed") が走るのを避ける。ヘルパを参照せず ref だけ見るので deps は空でよい。
  useEffect(
    () => () => {
      if (obsEnableTimerRef.current !== null) {
        window.clearTimeout(obsEnableTimerRef.current);
      }
      if (pinnedObsEnableTimerRef.current !== null) {
        window.clearTimeout(pinnedObsEnableTimerRef.current);
      }
    },
    [],
  );

  // 033c: トグル状態を localStorage に永続化する（channel と同型）。再オープン・再起動で復元される。
  useEffect(() => {
    saveTtsEnabled(ttsEnabled);
  }, [ttsEnabled]);
  useEffect(() => {
    saveVoicevoxAutolink(voicevoxAutolink);
  }, [voicevoxAutolink]);
  // 035c: source 別読み上げ ON/OFF を localStorage に永続化する（再オープン・再起動で復元）。
  useEffect(() => {
    saveSpeakTwitch(speakTwitch);
  }, [speakTwitch]);
  useEffect(() => {
    saveSpeakYoutube(speakYoutube);
  }, [speakYoutube]);
  // 048: 読み上げ最大文字数を localStorage に永続化する（再オープン・再起動で復元）。設定 UI は blur/Enter で
  // 確定するので、ここが走るのは確定 1 回分だけ（打鍵ごとに書かない）。
  // マウント時にも 1 回走って同じ値を書き直す（＝他窓へ storage イベントが 1 発飛ぶ）が、既存の saveChannel /
  // saveObsAutoAdd / savePinnedOverlayEnabled と同じ挙動で、読み手（OverlayApp / PinnedOverlayApp）は
  // e.key で購読キーを絞っておりこのキーを見ないため無害。再修正トリガー＝このキーを購読する窓を足すとき。
  useEffect(() => {
    saveTtsMaxLength(ttsMaxLength);
  }, [ttsMaxLength]);
  // 033d: 選択話者を localStorage に永続化する（再オープン・再起動で復元）。
  useEffect(() => {
    saveSpeakerId(selectedSpeakerId);
  }, [selectedSpeakerId]);
  // 034e: オーバーレイの表示設定を localStorage に永続化する（channel と同型）。書換で他窓（オーバーレイ窓）の
  // storage イベントが発火し、開いたままのオーバーレイへ即反映される。
  useEffect(() => {
    saveOverlayFont(overlayFont);
  }, [overlayFont]);
  useEffect(() => {
    saveOverlayShowSource(overlayShowSource);
  }, [overlayShowSource]);
  // 044a: OBS 自動追加 ON/OFF を永続化（非機密・パスワードは含めない）。
  useEffect(() => {
    saveObsAutoAdd(obsAutoAdd);
  }, [obsAutoAdd]);
  // 046b: 「固定コメントをOBSに表示」ON/OFF を永続化（非機密のトグル値のみ）。
  // 046b レビュー（修正不要）: この effect はマウント時にも走るため、コメビュ本体を開くたびに同じ値が 1 回書かれ、
  // 他窓で `storage` イベントが 1 発飛ぶ（saveChannel / saveObsAutoAdd / savePinned と同じ既存挙動）。
  // 無害な理由＝読み手の `PinnedOverlayApp` / `OverlayApp` は購読キーを絞っており、どちらもこのキーを見ていない。
  // 再修正トリガー＝オーバーレイ側がこのキーを購読する（例: 窓側で ON/OFF を表示する）ようになったら、
  // 値が変わったときだけ書くようガード（前回値との比較）を足す。
  useEffect(() => {
    savePinnedOverlayEnabled(pinnedOverlayEnabled);
  }, [pinnedOverlayEnabled]);
  // 046a: 固定コメントを永続化（非機密の表示データのみ・アバターは載せない）。解除時は "[]" を書いて
  // 046b 側にも「解除」が伝わるようにする（savePinned がキーを消さない理由はそちらの JSDoc 参照）。
  // Rust の DB/ログには渡さない（recordComments 等の保存経路には流さない・§9）。
  //
  // S-1（前回セッションのピンを捨てる）の担保は**この effect ではなく、上の専用 effect が持つ**
  //（当初はここのマウント時 1 発に相乗りしていたが、レビュー指摘で明示化した）。したがって
  // ここは純粋な永続化に戻っており、他の save effect 群と同じ扱いでよい（初回スキップ等の最適化を
  // 一括で入れる場合も、上の専用 effect を消さなければ S-1 は壊れない）。
  useEffect(() => {
    savePinned(pinned);
  }, [pinned]);

  // 033c: 安定コールバック（enqueueForSpeech / launchEngine）から最新値を読むための ref 同期。
  useEffect(() => {
    ttsEnabledRef.current = ttsEnabled;
  }, [ttsEnabled]);
  useEffect(() => {
    engineRunningRef.current = engineRunning;
  }, [engineRunning]);
  useEffect(() => {
    launchRequestedRef.current = launchRequested;
  }, [launchRequested]);
  useEffect(() => {
    selectedSpeakerIdRef.current = selectedSpeakerId;
  }, [selectedSpeakerId]);
  // 048: 読み上げ最大文字数を ref に同期（enqueue のたびに getMaxLength から最新値を読む）。
  useEffect(() => {
    ttsMaxLengthRef.current = ttsMaxLength;
  }, [ttsMaxLength]);
  // 035c: source 別読み上げ ON/OFF を ref に同期（enqueueForSpeech から最新値を読む）。
  useEffect(() => {
    speakTwitchRef.current = speakTwitch;
  }, [speakTwitch]);
  useEffect(() => {
    speakYoutubeRef.current = speakYoutube;
  }, [speakYoutube]);

  useEffect(() => {
    // 033d: 合成直前に選択話者（style id）を ref から読む getter を渡す。話者変更でキューを作り直さない。
    // 041a: 合成前の読み替え辞書も getter で渡す。現状は内蔵辞書のみ（静的）だが、041b でユーザー辞書を内蔵へ
    // 重ねる（ライブマージ）際もキューを作り直さずに済むよう getter 注入の形にしておく。
    // 048: 読み上げ最大文字数も getter で渡す（設定を変えてもキューを作り直さない）。値は ttsPrefs 側で
    // クランプ済みの整数で、切り詰めは ttsQueue の enqueue（読み替え適用の直後）だけで起きる。
    // 049: 読み上げ用テキストの組立も渡す。課金イベントは text が空で無音だったため、表示と同じ文言
    // （composeEventMessage を再利用）を読ませる。**純関数なので ref 同期は不要**（state に依存しない）。
    // 049 フォローアップ: 課金イベントを**優先キュー**へ載せる述語も渡す。読み上げは到着に構造的に
    // 追いつかない（1 件読む間に 6〜15 件届く）ため、単一 FIFO だと課金が通常チャットの洪水で破棄される。
    // 判定（種別を見る責務）は screens 側に置き、ttsQueue には述語だけを注入する（層の逆転を避ける）。
    const queue = createTtsQueue({
      getSpeakerId: () => selectedSpeakerIdRef.current,
      getReadingDictionary: () => BUILTIN_READING_DICTIONARY,
      getMaxLength: () => ttsMaxLengthRef.current,
      getSpeechText: composeSpeechText,
      isPriority: (c) => isMonetaryEvent(c.eventType),
    });
    ttsRef.current = queue;
    return () => {
      queue.dispose();
      ttsRef.current = null;
    };
  }, []);

  // 034c: 話者サンプル試聴プレイヤーを生成/破棄する（ttsQueue と別の AudioContext・別経路）。設定ビューの話者/
  // スタイル選択（onPreview）から呼ばれ、選択の style id で固定サンプル文を再生する。読み上げ本線には積まない。
  useEffect(() => {
    const preview = createVoicevoxPreview();
    previewRef.current = preview;
    return () => {
      preview.dispose();
      previewRef.current = null;
    };
  }, []);

  // 新規追加コメントを読み上げキューへ積む単一注入点（実データハンドラ onComments はここを通す）。
  // ttsRef のみ参照する安定コールバック（useCallback []）にして、マウント専用の接続 effect の依存にしても
  // 再接続を起こさない＆ TDZ を避ける（onComments より前に定義する必要があるため上へ移動した）。
  // resume は「毎回呼んでよい（running なら no-op）」が、WKWebView の autoplay 制限で **suspended→running の
  // 遷移はユーザー操作起点でしか効かない**。実データ（非操作起点）で初回が鳴るよう、取得開始ボタン
  // （handleStartSession）で resume 済みにし、万一 suspended のままでも ttsQueue.pump 側のガードで
  // 無音ハングを防ぐ（該当 1 件はスキップ）。
  // 033c: 読み上げトグルが OFF のときは何もしない（no-op）。トグル state を直接この useCallback の依存に
  // 入れると enqueueForSpeech が作り直され、それを依存に持つ WS 接続 effect が張り直されて「窓内 1 本」原則に
  // 反する。よって state ではなく ttsEnabledRef を参照して安定（useCallback []）を保つ。OFF 中に来たコメントは
  // enqueue しない＝ttsQueue の seenIds にも載らないため、後で ON にしても遡って読み上げない（期待挙動）。
  // 035c: 読み上げ全体 ON（ttsEnabledRef）の上で、さらに **source 別トグルと併用**して per-comment で絞る。
  // OFF の source（speakTwitch/speakYoutube が false）のコメントは enqueue しない。呼び出し全体は止めず、
  // 混在した added を 1 件ずつ判定して混在時も片方だけ読み上げる。表示（mergeComments の next）は不変で全 source
  // 継続。OFF の source のコメントも seenIds に載らないため、後でその source を ON にしても遡って読み上げない。
  const enqueueForSpeech = useCallback((added: CommentViewDto[]) => {
    if (!ttsEnabledRef.current) return;
    const tts = ttsRef.current;
    if (!tts || added.length === 0) return;
    void tts.resume();
    added.forEach((c) => {
      // 035c: source 別トグルは twitch/youtube のみ明示除外。CommentSource（"twitch" | "youtube"）以外は
      // 該当トグルが無いので安全側（読み上げ ON）でそのまま enqueue する。今 source を増やすと state・永続化
      // （ttsPrefs）・この分岐の 3 箇所を同時に足す必要があり、この分岐だけ漏らすと新 source が黙って常時読み上げに
      // なる。再修正トリガー: CommentSource に 3 つ目以降を追加するとき（追従漏れ検知が要れば switch(c.source) の
      // 網羅を satisfies never で強制する形に寄せる）。
      if (c.source === "twitch" && !speakTwitchRef.current) return;
      if (c.source === "youtube" && !speakYoutubeRef.current) return;
      tts.enqueue(c);
    });
  }, []);

  // 038c: record_comment の判定を受けてバッジ Map を更新する安定コールバック（useCallback []）。
  // **肯定判定（初見 or 久しぶり）だけを格納**し、否定（通常コメント・重複記録の false/false）は無視する。
  // Rust 側は実挿入の初回のみ肯定を返すため、StrictMode の updater 二重実行・fire-and-forget の重複解決でも
  // 肯定は 1 度きり＝バッジがブレない（否定で上書きしない）。setState は Promise 解決時（render 外）に走る。
  const handleRecordResult = useCallback(
    (commentId: string, result: RecordResult) => {
      if (!result.firstTime && !result.longAbsence) return;
      setViewerBadges((prev) => {
        if (prev.has(commentId)) return prev; // 既存の肯定判定は保持（無駄な再レンダも避ける）。
        const next = new Map(prev);
        next.set(commentId, result);
        return next;
      });
    },
    [],
  );

  // 046a: コメント行の右クリックメニューから呼ばれる**固定トグル**。既に固定済みの id なら解除、そうでなければ
  // 先頭（最新）に足して PINNED_LIMIT でクランプする（046a では 1＝直前の固定を置き換える単一ピン）。
  // toPinned が author.avatar を落とすので、localStorage に data URI は載らない。
  const handleTogglePin = useCallback((comment: CommentViewDto) => {
    setPinned((prev) =>
      prev.some((p) => p.id === comment.id)
        ? prev.filter((p) => p.id !== comment.id)
        : [toPinned(comment), ...prev].slice(0, PINNED_LIMIT),
    );
  }, []);

  // 046a: 固定帯の「固定解除」導線。
  const handleUnpin = useCallback((id: string) => {
    setPinned((prev) => prev.filter((p) => p.id !== id));
  }, []);

  // 047: ティッカーのピルを押して全文ダイアログを開いたときに既読化する。同じ id を 2 度押しても Set を
  // 作り直さない（＝参照が変わらず無駄な再レンダを起こさない）。
  const handleMonetaryRead = useCallback((id: string) => {
    setReadMonetaryIds((prev) =>
      prev.has(id) ? prev : new Set(prev).add(id),
    );
  }, []);

  // 046a: メニュー文言（「上部に固定」/「固定解除」）の出し分け用。CommentList は表示のためだけに参照する。
  const pinnedIds = useMemo(
    () => new Set(pinned.map((p) => p.id)),
    [pinned],
  );

  // 032c-b: Twitch コメント取得 sidecar の単一双方向 WS に接続する。受信コメントは表示へ流し
  // （単一注入点 mergeComments）、新規追加分（added）を TTS キューへ enqueue して読み上げる。
  // enqueue は comment.id 冪等（ttsQueue の seenIds）なので、StrictMode で updater が二重実行されても
  // 重複読み上げにはならない（updater 内で enqueue しても安全）。バースト受信でも React が prev を直列化
  // するため取りこぼさない。読み上げには AudioContext の resume が要るが、それは「コメント取得開始」
  // ボタン（ユーザー操作）で行う（handleStartSession）。
  // Device Code の user_code / verification_uri と session.state を受け取り UI に反映する。
  useEffect(() => {
    const handle = connectCommentStream({
      onComments: (incoming) => {
        setComments((prev) => {
          const { next, added, updated } = mergeComments(prev, incoming);
          // added（prev に無い id）だけが読み上げの対象。updated は下で記録のみ行い**ここには渡さない**。
          // 【レビュー指摘 Q-1】MAX_COMMENTS クランプで next から落ちた jewels 行に後から combo 更新が
          //   届いた場合は prev に無いため added 側に載る。その再読み上げを防いでいるのは added の構造では
          //   なく enqueueForSpeech 内の ttsQueue.seenIds（同 id は no-op）＝最終防波堤。詳細は
          //   mergeComments.ts の docstring。
          enqueueForSpeech(added);
          // 038a: 受信済みコメント（新規分）を Rust の視聴者メモリへ記録する（端末内 SQLite のみ・
          // 端末外へ出さない）。added は comment.id で dedup 済み、Rust 側も INSERT OR IGNORE で冪等なので
          // StrictMode の updater 二重実行でも集計は重複しない（enqueueForSpeech と同じ論拠）。fire-and-forget。
          // 038c: 判定（初見/久しぶり）を handleRecordResult で受け取りバッジ Map を更新する（実挿入の初回のみ肯定）。
          recordComments(added, sessionIdRef.current, handleRecordResult);
          // 043e: combo 更新（YouTube Jewels の同一 id 再送）は「新規コメント」ではないので、
          // **読み上げず（added に載らない）記録だけ**行う。判定コールバックを渡さないのは、Rust が更新経路で
          // 必ず {false,false} を返す＝初見/久しぶりバッジを再点灯させない契約を呼び出し側でも明示するため。
          // StrictMode で updater が二重実行されると同じ UPDATE が 2 回飛ぶが、同じ値の冪等な上書きであり
          // 集計は viewer_comments からの全再計算（total_comments は COUNT(*) で不変）なのでドリフトしない。
          recordComments(updated, sessionIdRef.current);
          return next;
        });
        // 047: 上部ティッカー用の蓄積。**`mergeComments` の中には入れず、同じ `incoming` から独立に導出する**。
        // ①`mergeComments` は表示・TTS・保存の 3 系統がぶら下がる単一注入点なので、表示専用の関心を混ぜない
        // ②setState の updater 内で別の setState を呼ぶ入れ子を作らない
        // ③ティッカーは 200 件クランプの影響を受けてはいけない（受けたら機能の目的が壊れる）ので、
        //   そもそも `mergeComments` の `next` からは導出できない。
        // `mergeMonetary` は chat を捨てて id 重複を排除する冪等な純関数なので、StrictMode の二重実行でも
        // 件数はぶれず、課金が 1 件も無いバッチでは `prev` を同一参照で返す（無駄な再レンダを起こさない）。
        // 047f: 既読集合を渡す＝上限超過で**捨てるのは既読だけ**になり、未読は帯から消えない
        //（「未読数が 50 件以上数えられない」の本体は、未読が黙って消えて二度と押せなくなることだった）。
        setMonetary((prev) =>
          mergeMonetary(prev, incoming, (id) =>
            readMonetaryIdsRef.current.has(id),
          ),
        );
        // 051: 「その配信で初めてしたコメント」の確定。ティッカーと同じ位置（updater の外・同じ `incoming`
        // から独立に導出）に置く＝**setState の updater 内で別の setState を呼ぶ入れ子を作らない**。
        // `added` ではなく `incoming` を渡してよいのは、`trackFirstOfStream` が「既記録の viewerId を
        // 上書きしない」＝再送も combo 更新も自然に no-op になるため（詳細は firstOfStream.ts）。
        setFirstOfStream((prev) => trackFirstOfStream(prev, incoming));
      },
      onDeviceCode: (prompt) => setDeviceCode(prompt),
      onSessionState: (platform, state, reason) => {
        // 032c-d: platform 別に反映（Twitch と YouTube を別パネルに）。
        if (platform === "youtube") {
          setYoutubeSessionState(state);
          setYoutubeSessionReason(reason ?? null);
          return;
        }
        setSessionState(state);
        setSessionReason(reason ?? null);
        // 接続済み（connected）になったら Device Code 提示は不要なので消す。
        if (state === "connected") setDeviceCode(null);
      },
      onConnectionChange: (connected) => setStreamConnected(connected),
      onLinkState: (platform, isLinked) => {
        if (platform === "youtube") {
          setYoutubeLinked(isLinked);
          return;
        }
        setLinked(isLinked);
        // ログイン済み（復元含む）なら Device Code 提示は不要なので消す。
        if (isLinked) setDeviceCode(null);
      },
      // 044a: OBS 連携の状態通知（非秘密）。UI の状態表示に反映する（技術的 reason は UI に出さないため捨てる）。
      onObsState: (state) => {
        setObsState(state);
      },
    });
    streamRef.current = handle;
    return () => {
      handle.disconnect();
      streamRef.current = null;
    };
    // enqueueForSpeech / handleRecordResult はいずれも useCallback([]) で安定＝この effect は実質マウント専用のまま
    // （窓内 WS 1 本の原則を守る。deps に載せても再接続しない）。
  }, [enqueueForSpeech, handleRecordResult]);

  // ユーザー明示操作でのみ発火する（§1 の「ユーザーが明示接続した時のみ」）。
  const handleTwitchConnect = () => {
    setSessionReason(null);
    streamRef.current?.startLogin();
  };
  // 032c-d: YouTube ログイン開始（ユーザー明示操作でのみ発火）。Rust がブラウザで accounts.google.com を開く。
  const handleYouTubeConnect = () => {
    setYoutubeSessionReason(null);
    streamRef.current?.startLogin("youtube");
  };
  const handleStartSession = () => {
    const ch = channel.trim();
    if (!ch) return;
    setSessionReason(null);
    // 032c-b: 取得開始はユーザー操作なので、ここで AudioContext を resume しておく。以降 sidecar から
    // （非操作起点で）届く実コメントの読み上げが suspended で無音化しないようにする単一の resume 契機。
    void ttsRef.current?.resume();
    streamRef.current?.startSession("twitch", ch);
  };
  const handleStopSession = () => {
    streamRef.current?.stopSession("twitch");
  };
  // 032c-d: YouTube 取得開始/停止（チャンネル名不要＝mine=true）。取得開始はユーザー操作なので TTS resume する。
  const handleYouTubeStartSession = () => {
    setYoutubeSessionReason(null);
    void ttsRef.current?.resume();
    streamRef.current?.startSession("youtube");
  };
  const handleYouTubeStopSession = () => {
    streamRef.current?.stopSession("youtube");
  };

  // ENGINE 稼働を GET /version で定期確認する（未起動→起動誘導、起動後は自動でバナーが消える）。
  // fetch にタイムアウト/signal は付けていない: `checkEngineRunning` が例外を bool 化するため、稀に
  // 前回リクエストと重なっても副作用が無い（`cancelled` ガードで unmount 後の setState も防ぐ）。
  //
  // ⚠ **「宛先は loopback なので応答は即時」という当初の前提は崩れている（050・2026-07-31）**。
  // ENGINE は**生きているのに応答を返さない**ことがある（スリープ復帰後・モデルロードのスタック等）。
  // 050 はまさにその状況を前提に合成側へ `SYNTH_TIMEOUT_MS` を入れたので、ここの
  // 「再検討条件＝応答遅延で tick が滞留するなら AbortController + タイムアウトを導入する」は
  // **既に満たされている**。このコメントを「検討済みで問題なし」と読まないこと。
  // 実害: `checkEngineRunning` が返らない間 `engineRunning` が更新されず**起動誘導バナーすら出ない**
  // （読み上げは 050 で 1 件ずつ諦めて進むが、ユーザーには何も見えない）。加えて tick は前回の完了を
  // 待たずに 5 秒ごと無条件に発火するので、pending の fetch が積み上がる。
  // 対応は **052 として起票済み**（本タスク〔050〕では `src/screens/` 差分ゼロのスコープ規律を優先した）。
  // 方針＝呼び出し側で AbortController ＋ ポーリング間隔より短いタイムアウトを張るだけ（新規依存ゼロ・
  // abort は `checkEngineRunning` が false 化するので既存のバナー導線がそのまま働く）。
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      const ok = await checkEngineRunning();
      if (!cancelled) setEngineRunning(ok);
    };
    void tick();
    const id = window.setInterval(tick, ENGINE_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  // 起動が稼働につながったら起動要求フラグを即解除する（このとき起動誘導バナー自体も消えるが、次に ENGINE が
  // 落ちた際に再度起動できるよう false に戻しておく）。
  useEffect(() => {
    if (engineRunning === true) setLaunchRequested(false);
  }, [engineRunning]);

  // 033d: ENGINE 稼働を検知したら GET /speakers で話者一覧を取得して選択肢を埋める（未取得のときのみ）。
  // 宛先はループバック 50021・一覧のみ取得で端末外送信なし（fetchSpeakers 参照）。起動前は空一覧のままで、
  // 前回選択値（selectedSpeakerId）は保持・表示される。cancelled ガードで unmount 後の setState を防ぐ。
  //
  // 一度一覧を得たら（speakers.length > 0）再取得しない意図的挙動: ENGINE の話者集合が変わるのは稀で、
  // engine 再起動ごとの再取得は不要と判断した。副作用として、初回が transient に空応答だと engineRunning が
  // トグルするまで再取得されない（実害小）。話者集合の差し替えが実運用で問題化したら、engineRunning の
  // 立ち上がりエッジで再取得する設計へ見直す（deps/ガードを変更する）。
  useEffect(() => {
    if (engineRunning !== true || speakers.length > 0) return;
    let cancelled = false;
    void fetchSpeakers().then((list) => {
      if (cancelled || list.length === 0) return;
      // setSpeakers と下の setSelectedSpeakerId は React 18 の同 tick バッチングで同時反映される。よって
      // SettingsView は「一覧充填」と「reconcile 後の選択 id」を同じ描画で受け取り、style select の
      // controlled value が常に一覧内に収まる（一時的な value mismatch 警告を避ける）。
      setSpeakers(list);
      // 取得した一覧に現在の選択 id が無ければ（別バージョンの ENGINE 等で消えた話者）、先頭スタイルへ寄せる。
      // 未知 id のまま合成すると毎回失敗するため。ref から最新値を読み deps を増やさない。ここでの
      // setSelectedSpeakerId は saveSpeakerId effect 経由で localStorage を上書きするが、これは未知 id での
      // 恒常的な合成失敗を避けるための意図的なユーザー操作なし書換（据え置き＋警告案より合成成立を優先）。
      const exists = list.some((sp) =>
        sp.styles.some((st) => st.id === selectedSpeakerIdRef.current),
      );
      if (!exists) {
        // fetchSpeakers が styles 空の話者を除くため list[0].styles[0] は存在する（防御的に ?. は残す）。
        const firstId = list[0]?.styles[0]?.id;
        if (firstId !== undefined) setSelectedSpeakerId(firstId);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [engineRunning, speakers.length]);

  // 多重 spawn 抑止の保険: 起動要求後、猶予内に稼働確認できなければ（＝起動失敗などで ENGINE が現れない）
  // 自動でフラグを解除して再試行を許す（永久 disabled 回避）。稼働確認が先なら上の effect が解除する。
  useEffect(() => {
    if (!launchRequested) return;
    const id = window.setTimeout(
      () => setLaunchRequested(false),
      LAUNCH_GRACE_MS,
    );
    return () => window.clearTimeout(id);
  }, [launchRequested]);

  // 033c: 登録済み VOICEVOX を管理付き spawn で起動する唯一の入口（読み上げ ON 契機・自動連携・手動ボタンが
  // すべてここを通る＝導線を増やさない）。Rust command（launch_voicevox_engine）・引数・経路は不変で「呼ぶ契機」
  // だけを増やす。未登録なら登録誘導文言を表示。起動後は /version ポーリングがバナーを自動で消す。
  // 二重 spawn を 3 段で抑止する（安定 useCallback []・ガードは ref から最新値を読む）:
  //   1. launchInFlightRef … 最初の await より前に立てる同期ガード（同一 tick/並行の複数契機を 1 回に）。
  //   2. launchRequestedRef … 起動成功後〜稼働確認/猶予経過までの窓を守る（launchRequested state ＋ LAUNCH_GRACE_MS）。
  //   3. engineRunningRef  … 既に稼働中（true）なら起動しない。
  const launchEngine = useCallback(async () => {
    if (launchInFlightRef.current) return; // 同期ガード（最優先・最初の await より前で判定）。
    if (engineRunningRef.current === true) return; // 既に稼働中。
    if (launchRequestedRef.current) return; // 直近に起動要求済み（猶予内）。
    launchInFlightRef.current = true;
    setLaunching(true);
    setLaunchNotice(null);
    void ttsRef.current?.resume(); // 起動契機に合わせて resume を試みる（running なら no-op）。
    try {
      const result = await launchVoicevoxEngine();
      if (result.launched) {
        // 起動できたら、ENGINE が /version で稼働確認できるまでボタンを止めて多重 spawn を防ぐ。
        setLaunchRequested(true);
      } else {
        // 未登録など（launched=false）は誘導文言を出す。再試行できるよう requested はセットしない。
        setLaunchNotice(result.message);
      }
    } catch (e) {
      console.error("VOICEVOX ENGINE の起動に失敗しました", e);
      setLaunchNotice("VOICEVOX ENGINE の起動に失敗しました。");
    } finally {
      launchInFlightRef.current = false;
      setLaunching(false);
    }
  }, []);

  // 033c(A): 読み上げ ON かつ ENGINE 未起動なら自動起動する。トグル ON（ttsEnabled 変化）と、ポーリングで
  // engine 落ちを検知（engineRunning が false 化）の両方をこの 1 effect が拾う。engineRunning の初期値は null の
  // ため未確認時は発火しない（=false のときだけ）。二重 spawn は launchEngine 側のガードが吸収する。
  useEffect(() => {
    if (ttsEnabled && engineRunning === false) void launchEngine();
  }, [ttsEnabled, engineRunning, launchEngine]);

  // 033c(B): 自動連携 ON なら「窓オープン時」に 1 回だけ ENGINE を起動する。永続値を直読みしてマウント契機に
  // 限定し（lint clean）、StrictMode の二重実行や (A) との同時発火は launchEngine のガードが吸収する。
  useEffect(() => {
    if (loadVoicevoxAutolink()) void launchEngine();
  }, [launchEngine]);

  // 033c: 読み上げトグルの切替。ON はユーザー操作契機なので AudioContext を resume しておく（WKWebView の
  // autoplay 対策・以降 sidecar から非操作起点で届く実コメントの初回読み上げが無音化しないように）。
  // ENGINE 未起動時の自動起動は上の effect(A)（ttsEnabled 変化を拾う）が担う。
  const handleTtsEnabledChange = (enabled: boolean) => {
    setTtsEnabled(enabled);
    if (enabled) void ttsRef.current?.resume();
  };

  // 034d/045b: オーバーレイ開閉トグルのハンドラ（ON=開く / OFF=閉じる）。呼び出し元は 045b で設定ビューから
  // **本体コメントビューのツールバー**へ移設した（034d の部分反転）が、このハンドラ自体は無変更で流用している。
  // 033f のオープン/クローズ挙動は不変で、
  // Rust が透過・フレームレス・最背面・非フォーカスで生成し（open_comment_overlay_window）、閉じても sidecar は
  // 落とさない（表示専用・no-orphan kill 契機はコメビュ窓に集約のまま）。
  // 034f（回帰修正）: 旧実装の cross-window onCloseRequested 購読を撤去（購読があると OFF で Tauri が JS の destroy()
  // へ委譲し capability 不足で拒否＝窓が閉じなかった）。ON は open→state 更新のみ、OFF は Rust close() で確実に閉じる
  // （Rust の window.close() は capability 非依存の直接 API）。トグル state は楽観更新し、実状態は再マウント時の
  // isCommentOverlayOpen 同期に委ねる。
  // 034f（レビュー: .catch 欠如／連打時ズレ / 修正不要）: open()/close() は .then のみで .catch を付けていない。
  // reject 時も実窓と概ね整合し（open 失敗→OFF のまま／close 失敗→ON のまま）、かつ再オープン時の mount 同期
  // （上の isCommentOverlayOpen）で回復するため実害が小さく、旧実装（同じく無 catch）から悪化しない。ON→OFF を
  // resolve 前に連打した際の一時的な state と実窓のズレも同 mount 同期で回復する。
  // 再修正トリガー＝①command reject が実運用で頻発し unhandled rejection が問題化する ②連打ズレが実害になる、なら
  // 両分岐へ .catch(() => void isCommentOverlayOpen().then(setOverlayOpen)) を足し失敗時も実状態へ再同期する。
  // 044a: オーバーレイ窓が OBS の「ウィンドウ一覧」に載るまでの初期猶予（開いた直後は候補に出ないことがある）。
  // M1: 載るまでの本待ちは sidecar 側の有界リトライ（findOverlayWindowItem）へ移したため、これは最初の一撃を
  // 早めるためのベストエフォート猶予（唯一の待ち機構ではない）。E2E で不要と分かれば撤去してよい。
  const OBS_ENABLE_DELAY_MS = 1200;

  // 044a: OBS へ自動追加を要求する。まず config を read-only で再検出（起動後に OBS 側で有効化された場合に追従）
  // してから、検出ポート（無ければ既定 4455）で sidecar に enableObs を送る。host は sidecar 側で 127.0.0.1 に固定。
  // パスワードはこの経路（WS）には載せず、別途 set_obs_websocket_password（Rust→keychain→stdin）で渡す。
  // 046d: `overlay` で対象を選ぶ（"comments"＝コメント一覧オーバーレイ / "pinned"＝固定コメントオーバーレイ）。
  // 渡すのは識別子だけで、OBS のソース名・窓名は sidecar 内の表に閉じている（任意の名前を渡す口は作らない）。
  //
  // 046d レビュー（修正不要・`obsState` を 2 種別で共有している点）: 意図は「OBS 連携の状態表示は 1 つ」で、
  // `enableObs("comments")` と `enableObs("pinned")` の結果が同じ state に流れ込む。よって
  // ①ツールバーの失敗表示はどちらのソースで失敗したか区別できない ②両方が同時に走ると最後の書き手が勝つ
  //（片方の失敗が他方の成功に隠れうる）。それでも分けないのは、これが**セットアップ時の一度きりの操作**で、
  // 失敗しても OBS 側は壊れず設定カードに手動追加の手順が併記されているため、状態を 2 系統に増やす複雑さの方が
  // コストが上回ると判断したから。なお sidecar 側は 2 種別で**別ソース名**を触るので、同時実行でも二重ソース作成・
  // ソース間の相互破壊は起きない（`obs-client.ts` の L5 注記＝毎回独立インスタンスで完結、が種別違いでも成立）。
  // 再修正トリガー＝「どちらのオーバーレイが OBS に出ていないか分からない」という問い合わせが実際に出たら、
  // `obsState` を `Record<ObsOverlayKind, ObsState>` にして表示側も種別ごとに出す。
  const requestObsAutoAdd = (overlay: ObsOverlayKind) => {
    setObsState("connecting");
    void detectObsWebsocketConfig().then((cfg) => {
      setObsConfig(cfg);
      const stream = streamRef.current;
      if (!stream) {
        // L2: コメントストリーム WS 未接続なら enableObs が no-op になり connecting が固着するため failed に落とす。
        setObsState("failed");
        return;
      }
      stream.enableObs(cfg?.port ?? 4455, overlay);
    });
  };

  // 044a: オーバーレイ表示 OFF 連動。OBS 側ソースを**削除せず非表示**にする（ON で requestObsAutoAdd が再表示）。
  // port は既知の検出値（無ければ既定 4455）を使う。sidecar 側は best-effort（該当なし/未起動は idle）。
  const requestObsHide = (overlay: ObsOverlayKind) => {
    streamRef.current?.hideObs(obsConfig?.port ?? 4455, overlay);
  };

  // 045c レビュー（回帰）: 仕掛かり中の猶予タイマーを取り消す。表示 OFF・自動反映 OFF・アンマウントで呼ぶ。
  // 「ユーザーが OFF にしたのに、その後 enableObs が飛ぶ」を止めるのが目的（§1 の「明示的に有効化した時のみ接続」）。
  const clearObsEnableTimer = () => {
    if (obsEnableTimerRef.current !== null) {
      window.clearTimeout(obsEnableTimerRef.current);
      obsEnableTimerRef.current = null;
    }
  };

  // 046d: 固定オーバーレイ用の猶予タイマーを取り消す（clearObsEnableTimer と同型・対象が別）。
  const clearPinnedObsEnableTimer = () => {
    if (pinnedObsEnableTimerRef.current !== null) {
      window.clearTimeout(pinnedObsEnableTimerRef.current);
      pinnedObsEnableTimerRef.current = null;
    }
  };

  const handleOverlayToggle = (next: boolean) => {
    if (next) {
      void openCommentOverlayWindow().then(() => {
        setOverlayOpen(true);
        // 044a: OBS 自動追加が ON なら、窓が OBS のウィンドウ一覧に載る猶予をおいてソース追加を要求する。
        // 045c レビュー: 連打で二重に仕掛からないよう、張り直す前に既存を取り消す。
        if (obsAutoAdd) {
          clearObsEnableTimer();
          obsEnableTimerRef.current = window.setTimeout(() => {
            obsEnableTimerRef.current = null;
            requestObsAutoAdd("comments");
          }, OBS_ENABLE_DELAY_MS);
        }
      });
    } else {
      void closeCommentOverlayWindow().then(() => setOverlayOpen(false));
      // 045c レビュー: 猶予中に表示 OFF されたら反映要求ごと取り消す（hideObs の後に enableObs が飛ぶのを防ぐ）。
      // 自動反映の ON/OFF に関わらず取り消してよい（OFF ならそもそも仕掛かっていない）。
      clearObsEnableTimer();
      // 044a: 連携 ON のときは、表示 OFF で OBS 側のソースも非表示にする（削除はしない）。
      if (obsAutoAdd) {
        requestObsHide("comments");
        // 045c: 表示 OFF＝OBS 側も非表示なので、直前の結果（connecting/added/failed）は実態と食い違う。idle へ戻し、
        // ツールバーのエラー表示と設定カードの状態表示が消えるようにする（残留した赤字が誤解を生む）。
        // sidecar 側も hide()/disable() で onState("idle") を返す（obs-client.ts）ので、これは先取りの echo であり
        // 状態機械の非対称にはならない。WS が落ちていて通知が来ない場合にも実態へ合わせられる利点がある。
        setObsState("idle");
      }
    }
  };

  // 046b: 「固定コメントをOBSに表示」トグル。ON で固定専用オーバーレイ窓（label `pinned-overlay`）を開き、
  // OFF で閉じる。ピン 0 件でも窓は完全透明で開くだけなので、OBS 側でウィンドウキャプチャを**先に**追加できる。
  //
  // **固定/固定解除ではこの窓を開閉しない**（解除時は窓の中身が透明に戻るだけ）。親 046 が
  // 「ピン 0 件で窓が自動的に閉じると OBS ソースが壊れる」ことを理由に自動 close を禁じているため。
  //
  // 046d: **この窓も 044a の自動反映の対象**（当初は「対象外・手動キャプチャ前提」で作ったが、
  // 親 046 が「将来タスク」として先送りしていただけで技術的な障害は無く、依頼者の指示で解禁した）。
  // 「OBSに自動で反映する」が ON のときだけ、ON で `enableObs("pinned")` / OFF で `hideObs("pinned")` を出す。
  // 045c が確定させた線引き「表示（開閉）が主・自動反映は従」に合わせ、**このトグル自体は OBS への接続契機**
  // であって、自動反映が OFF なら OBS へは一切繋がない。
  //
  // 046b レビュー（修正不要・根拠の訂正）: state を invoke の**前に**同期で立てるのは意図的で、
  // handleOverlayToggle（`.then()` の中で setOverlayOpen する＝state が実窓の帰結）とは設計が違う。
  // こちらの state は実窓のミラーではなく**永続設定**なので、成否に依らず即座にユーザーの意思を記録する。
  // 失敗時は「トグル ON・永続 true・窓なし」になるが、次にコメビュ本体を開いたときのマウント同期 effect が
  // 実窓を設定へ追いつかせる（＝設定が正・窓が従、で一貫する）。
  // 再修正トリガー＝invoke の reject が実運用で頻発し、失敗をその場でユーザーに伝える必要が出たとき。
  // そのときは下の catch で setPinnedOverlayEnabled を巻き戻すのではなく、エラー表示を足す（設定値は保持する）。
  const handlePinnedOverlayToggle = (next: boolean) => {
    setPinnedOverlayEnabled(next);
    // 連打レース対策で直列化する（理由は pinnedOverlayOpRef の注記）。
    pinnedOverlayOpRef.current = pinnedOverlayOpRef.current
      .then(() =>
        next ? openPinnedOverlayWindow() : closePinnedOverlayWindow(),
      )
      .catch(() => {});

    // 046d: 自動反映が OFF なら OBS へは一切繋がない（045c の「明示的に有効化した時のみ接続」を維持）。
    if (!obsAutoAdd) return;
    clearPinnedObsEnableTimer();
    if (next) {
      // 窓が OBS の「ウィンドウ一覧」に載るまでの猶予を置いてから追加を要求する（044a と同じ理由・同じ値）。
      pinnedObsEnableTimerRef.current = window.setTimeout(() => {
        pinnedObsEnableTimerRef.current = null;
        requestObsAutoAdd("pinned");
      }, OBS_ENABLE_DELAY_MS);
    } else {
      // 表示 OFF＝OBS 側も非表示（**ソースは消さない**・ON で再表示される）。直前の結果表示も実態へ揃える。
      requestObsHide("pinned");
      setObsState("idle");
    }
  };

  // 046d レビュー（要修正・非対称の解消）: 固定オーバーレイの自動追加は**実窓の有無**で判定する。
  // コメント一覧側は `overlayOpen`（実窓の状態）でゲートしているのに対し、当初の実装は
  // `pinnedOverlayEnabled`（**永続設定値**）でゲートしていた。トグル操作としては「設定が正・窓が従」の整理で
  // 正しいが、`requestObsAutoAdd` は「窓が OBS のウィンドウ一覧に載っている」ことを前提にする操作なので、
  // 設定 ON ／ 窓なし（＝open の invoke が失敗した等）の状態で走ると sidecar 側 `ensureOverlaySource` が
  // **先に `CreateInput` でソースを作ってから**窓を探して失敗し、キャプチャ対象未設定の空ソース
  // 「StreamDock 固定コメント」が OBS に残る（ユーザーが手で消すまで消えない）。
  // 再修正トリガー＝`requestObsAutoAdd` が窓の存在を前提にしなくなったら（sidecar 側で窓を確認してから
  // CreateInput する順序に変えたら）、設定値ゲートに戻してよい。
  const requestPinnedObsAutoAddIfOpen = () => {
    void isPinnedOverlayOpen().then((open) => {
      if (open) requestObsAutoAdd("pinned");
    });
  };

  // 044a: 「OBS へ自動追加（連携）」トグル。ON の間、オーバーレイ表示 ON に連動して OBS へウィンドウキャプチャ
  // ソースを自動追加（既存なら再利用）する。OFF は連携を止める（OBS 側のソースは消さない）。
  // 045c（E2E 回帰修正）: 旧実装は「未開ならオーバーレイを開いてから追加」＝このトグル ON だけで表示まで ON に
  // していた。044a 当時は表示トグルも同じ設定カードにあり「ワンクリックでソース追加まで到達」が筋だったが、
  // 045b で表示トグルをツールバーへ移設したことで「設定を ON にしただけで配信画面に窓が開く」隠れた副作用に
  // 変質した（E2E で発覚）。開く経路を削除し、ON は**設定を立てるだけ**にする。実際の反映は表示 ON 時に
  // handleOverlayToggle が行う＝「表示（開閉）が主・自動反映は従」という親 045 の線引きに揃えた。
  // なお ①ユーザー操作なしに窓が開く経路が 1 本減る ②OBS への接続契機は表示 ON の明示操作だけになる、の
  // 2 点でセキュリティ上も後退しない（§1・宛先は loopback 127.0.0.1:4455 のまま不変）。
  const handleObsAutoAddToggle = (next: boolean) => {
    setObsAutoAdd(next);
    if (!next) {
      // 045c レビュー: 猶予中に連携 OFF されたら反映要求ごと取り消す（disableObs の後に enableObs が飛ぶのを防ぐ）。
      clearObsEnableTimer();
      streamRef.current?.disableObs();
      setObsState("idle");
      return;
    }
    // 既に表示中なら猶予不要（窓は OBS のウィンドウ一覧に載っている）ので即反映する。未表示なら何もしない。
    // 046d: 固定オーバーレイも対象になったので、開いている方を両方とも反映する（どちらも開いていなければ何もしない）。
    if (overlayOpen) requestObsAutoAdd("comments");
    requestPinnedObsAutoAddIfOpen();
  };

  // 044a: OBS WebSocket パスワードを保存する（認証有効な OBS 用）。Rust が §8 検証→keychain→sidecar へ私信。
  // 保存後、連携 ON かつオーバーレイ open なら再試行して認証成功後の自動追加に繋げる。
  const handleSetObsPassword = (password: string) => {
    void setObsWebsocketPassword(password).then(() => {
      if (!obsAutoAdd) return;
      if (overlayOpen) requestObsAutoAdd("comments");
      requestPinnedObsAutoAddIfOpen();
    });
  };

  // 044a: OBS パスワードを破棄する（keychain 削除＋sidecar の in-memory 消去）。
  const handleClearObsPassword = () => {
    void clearObsWebsocketPassword();
  };

  // 033d: クレジット表記に使う選択話者名。一覧から選択 style id を含む話者名を引く。ENGINE 未起動で一覧が
  // 未取得なら null（creditNotice が話者名を省いた汎用文にフォールバックする）。
  const selectedSpeakerName =
    speakers.find((sp) => sp.styles.some((st) => st.id === selectedSpeakerId))
      ?.name ?? null;

  return (
    <div className={styles.root}>
      {view === "viewers" ? (
        // 038b: 視聴者一覧・詳細＋配信者メモ。表示専用（invoke のみ）で WS/TTS/sidecar を持たない（窓内 WS 1 本のまま）。
        <ViewersView onBack={() => setView("comment")} />
      ) : view === "settings" ? (
        // 042b: 接続 UI（Twitch/YouTube の連携・取得開始/停止・Device Code 提示）は本体のプラットフォーム別カードへ
        // 移設した（033b の部分反転）。設定ビューは読み上げ（VOICEVOX）／OBS オーバーレイの設定のみを担い、接続系の
        // state・ハンドラは受け取らない。表示専用で WS を持たない性質は不変（窓内 1 本のまま）。
        <SettingsView
          onBack={() => setView("comment")}
          voicevoxAutolink={voicevoxAutolink}
          onVoicevoxAutolinkChange={setVoicevoxAutolink}
          ttsEnabled={ttsEnabled}
          speakTwitch={speakTwitch}
          onSpeakTwitchChange={setSpeakTwitch}
          speakYoutube={speakYoutube}
          onSpeakYoutubeChange={setSpeakYoutube}
          ttsMaxLength={ttsMaxLength}
          onTtsMaxLengthChange={setTtsMaxLength}
          speakers={speakers}
          selectedSpeakerId={selectedSpeakerId}
          onSpeakerIdChange={setSelectedSpeakerId}
          onPreview={(id) => previewRef.current?.play(id)}
          audioOutputDevices={audioOutputDevices}
          audioOutputListState={audioOutputListState}
          audioOutputDeviceId={audioOutputDeviceId}
          onAudioOutputDeviceIdChange={handleAudioOutputDeviceIdChange}
          onReloadAudioOutputDevices={refreshAudioOutputDevices}
          onTestNotificationSound={handleTestNotificationSound}
          audioTestState={audioTestState}
          overlayFont={overlayFont}
          onOverlayFontChange={setOverlayFont}
          overlayShowSource={overlayShowSource}
          onOverlayShowSourceChange={setOverlayShowSource}
          obsConfig={obsConfig}
          obsAutoAdd={obsAutoAdd}
          onObsAutoAddToggle={handleObsAutoAddToggle}
          obsState={obsState}
          onSetObsPassword={handleSetObsPassword}
          onClearObsPassword={handleClearObsPassword}
          pinnedOverlayEnabled={pinnedOverlayEnabled}
          onPinnedOverlayToggle={handlePinnedOverlayToggle}
        />
      ) : (
        <>
          {/* 033b/034d/034(UI刷新)/042b/042b改: 本体上部ヘッダー。左＝プラットフォーム別 接続ピル（Twitch / YouTube を
              横並び）、右クラスタ＝VOICEVOX 読み上げトグル（配信中に頻繁に切替＝UX 上ベスト）＋視聴者ボタン＋『⚙ 設定』ボタン。
              接続ピルはクリックでピル直下に非モーダルのポップオーバー（連携/取得開始/停止）を重ねて出す（他要素の位置は動かさない・
              1 つずつ＝ラジオ・外側クリック/Esc で閉じる）。既存ハンドラ・制御フレームをそのまま呼び、WS は窓内 1 本のまま
              （ConnectionCard は表示専用で通信面を持たない・main 窓 no-internet 不変）。 */}
          <div className={styles.toolbar}>
            {/* 042b改: 接続ピル群（Twitch / YouTube）。cluster ref で外側クリック判定（内包する他方ピル押下はラジオ切替＝閉じない）。 */}
            <div className={styles.connCluster} ref={connClusterRef}>
              <ConnectionCard
                service="Twitch"
                sessionState={sessionState}
                open={openCard === "twitch"}
                onToggle={() =>
                  setOpenCard((prev) => (prev === "twitch" ? null : "twitch"))
                }
              >
                {/* 032c-b/042b改2: Twitch 連携（Device Code ログイン → ユーザー名指定で取得開始）。ユーザー明示操作でのみ発火する（§1）。
                    レイアウトは YouTube と揃え、最上段に「何を入れるか」を明示したユーザー名入力（ラベル付き）を置き、その下に
                    連携／取得開始／停止のボタン行、さらに下に状態を並べる。 */}
                {/* 最上段: ユーザー名入力（<label> で包み、ラベルクリックで入力にフォーカス＝入力対象を明確化）。Twitch の
                    チャンネル名＝配信者のユーザー名なので表示は「ユーザー名」とする（内部の state 名 channel は据え置き）。 */}
                <label className={styles.connField}>
                  <span className={styles.connFieldLabel}>ユーザー名</span>
                  <input
                    type="text"
                    className={styles.input}
                    placeholder="例: shroud"
                    value={channel}
                    onChange={(e) => setChannel(e.target.value)}
                  />
                </label>
                <div className={styles.connActions}>
                  <button
                    type="button"
                    className={styles.btn}
                    onClick={handleTwitchConnect}
                    disabled={!streamConnected || linked}
                  >
                    {linked ? "連携済み" : "連携"}
                  </button>
                  <button
                    type="button"
                    className={styles.btn}
                    onClick={handleStartSession}
                    disabled={
                      !streamConnected || !linked || channel.trim() === ""
                    }
                  >
                    コメント取得開始
                  </button>
                  <button
                    type="button"
                    className={styles.btnGhost}
                    onClick={handleStopSession}
                    disabled={!streamConnected}
                  >
                    停止
                  </button>
                </div>
                {/* 032c-b: sidecar 未接続（streamConnected=false）のときは session.state（既定 idle=「待機」）を出すと
                    「準備完了なのに無反応」に見えるため、接続確立までは接続状態を優先表示し、ボタン群の disabled と合わせて
                    「まだ操作できない」ことを可視化する。接続確立後は従来どおり取得セッション状態を表示する。 */}
                <span className={styles.status}>
                  状態:{" "}
                  {!streamConnected
                    ? "コメント取得プロセスに接続中…"
                    : `${SESSION_STATE_LABEL[sessionState] ?? sessionState}${
                        sessionReason ? `（${sessionReason}）` : ""
                      }`}
                </span>
                {/* 042b改（ポップオーバー×device code の可視性）: device code は「ピルを開いて連携ボタンを押す」導線でのみ
                    到着するため、到着時ポップオーバーは必ず開いている＝閉じていて見えない退行はない。開閉状態 `openCard` は
                    常時マウントの CommentViewerApp が保持し、view 切替（設定/視聴者）で戻っても保たれる。再修正トリガー＝
                    閉じている間にも device code を受け取りうる導線（自動連携・再ログイン等）を足したら、到着時に該当ピルを
                    自動で開く（`setOpenCard("twitch")`）。 */}
                {deviceCode && (
                  <div className={styles.deviceCode} role="status">
                    <span className={styles.deviceCodeLabel}>
                      下記 URL をブラウザで開き、次のコードを入力して連携を許可してください:
                    </span>
                    <span className={styles.codeValue}>
                      {deviceCode.userCode}
                    </span>
                    <span className={styles.verifyUri}>
                      {deviceCode.verificationUri}
                    </span>
                  </div>
                )}
              </ConnectionCard>

              <ConnectionCard
                service="YouTube"
                sessionState={youtubeSessionState}
                open={openCard === "youtube"}
                onToggle={() =>
                  setOpenCard((prev) => (prev === "youtube" ? null : "youtube"))
                }
              >
                {/* 032c-d: YouTube 連携（Authorization Code ログイン → ブラウザ同意 → 取得開始）。Twitch と併存・各サービス
                    個別選択（同時取得はしない）。チャンネル名入力は不要（mine=true の自アカウントのアクティブ配信）。
                    認可画面は Rust がシステムブラウザで accounts.google.com を開く（sidecar は URL に触らず・code_verifier は
                    載らない）。ユーザー明示操作でのみ発火する（§1）。 */}
                <div className={styles.connActions}>
                  <button
                    type="button"
                    className={styles.btn}
                    onClick={handleYouTubeConnect}
                    disabled={!streamConnected || youtubeLinked}
                  >
                    {youtubeLinked ? "連携済み" : "連携"}
                  </button>
                  <button
                    type="button"
                    className={styles.btn}
                    onClick={handleYouTubeStartSession}
                    disabled={!streamConnected || !youtubeLinked}
                  >
                    コメント取得開始
                  </button>
                  <button
                    type="button"
                    className={styles.btnGhost}
                    onClick={handleYouTubeStopSession}
                    disabled={!streamConnected}
                  >
                    停止
                  </button>
                </div>
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
                <span className={styles.note}>
                  YouTube はチャンネル名入力不要（自分のアクティブ配信を取得）。無料クォータ（10,000 units/日）を使い切ると取得は自動停止します。
                </span>
              </ConnectionCard>
            </div>
            <div className={styles.toolbarActions}>
              {/* 045b: OBS への表示（開閉）トグル。034d で設定ビューへ集約していたが、配信中に頻繁に切り替える操作
                  なのでここへ移設した（034d の部分反転・親 045 の線引き）。移設は **UI の位置だけ**で、state
                  （overlayOpen）・ハンドラ（handleOverlayToggle）・自動反映との連動は設定ビュー時代のものをそのまま
                  呼ぶ。VOICEVOX 読み上げの左＝右クラスタの先頭に置くのは、右寄せクラスタでは先頭挿入だけが既存
                  （読み上げ/視聴者/設定）の画面位置を動かさないため。label は 045a 確定の自己完結型をそのまま使う。
                  045b レビュー（接続状態がここに出ない）→ **045c で解消済み**（下の状態表示）。トリガーに挙げた
                  「実機で自動反映 ON かつ OBS 未起動を試して困ると確認できたとき」が E2E で発火した。 */}
              {/* 045c: OBS 連携の**失敗だけ**をこのツールバーで伝える。旧実装は obsState を SettingsView のカードに
                  しか出しておらず、表示トグルがここへ移設された 045b 以降は「押した画面に何も出ない」状態だった。
                  短文＋title で全文。
                  045c レビュー（role="status" の効き / 今回は表示条件を変えない）: aria-live リージョンは**先に DOM に
                  あって中身が後から変わる**ときに読み上げられるのが基本挙動で、ここはリージョンごと条件付きで
                  マウントするため、環境によっては読み上げられない。**視覚表示が主目的**（配信中に赤字で気付ければ足りる）
                  と割り切り、role は「操作を妨げない状態通知」の意味付けとして残す（alert にしないのも同じ理由）。
                  常時マウントして中身だけ差し替える形にすると、空のときも .toolbarActions の gap が 1 つ分入って
                  トグル位置が常時ずれるため、視覚を犠牲にしてまで採らない。再修正トリガー＝スクリーンリーダー利用者
                  から「気付けない」と報告が来たとき。そのときは空文字のリージョンを常時置き、gap 側を調整する。
                  045c 実機 E2E（進行表示の撤回）: 一度は connecting も「OBSに接続中…」として出したが、成功時は
                  ほぼ一瞬で消えるためチラつきにしかならず UX が悪化した（本人確認）。**進行は出さない**方針に確定。
                  成功（added/reused）も出さない＝配信中のツールバーを騒がしくしない。ユーザーが知る必要があるのは
                  「反映されなかった」ときだけ、という整理。再修正トリガー＝接続に体感できる待ちが生じるようになり
                  （例: OBS 側の応答が遅い環境が実機で見つかる）、無反応に見えると分かったとき。そのときは即時表示
                  ではなく**一定時間 connecting が続いた場合だけ**出す（遅延表示）形にする＝チラつきは再発させない。 */}
              {/* 045c レビュー（ゲート条件の非対称 / 修正不要）: ここは obsAutoAdd で絞るが SettingsView の状態表示は
                  絞っていない。両者が等価なのは **連携 OFF 時に必ず obsState を idle へ戻す**（handleObsAutoAddToggle の
                  OFF 分岐）という不変条件があるためで、粒度の違い（ここは失敗のみ／カードは全状態）とは別の話。
                  再修正トリガー＝setObsState の呼び出し箇所が増えてこの不変条件が崩れたとき（そのときは派生値に
                  切り出して両方から使う）。 */}
              {obsAutoAdd && obsState === "failed" && (
                <span
                  className={styles.toolbarError}
                  role="status"
                  title="OBSに接続できませんでした。OBSが起動しているか確認してください。"
                >
                  OBSに接続できませんでした
                </span>
              )}
              <ToggleSwitch
                label="コメントをOBSに表示"
                checked={overlayOpen}
                onChange={handleOverlayToggle}
                inline
              />
              <ToggleSwitch
                label="VOICEVOX読み上げ"
                checked={ttsEnabled}
                onChange={handleTtsEnabledChange}
                inline
              />
              {/* 038b: 視聴者ビューへの導線。設定ギアと同じゴーストボタン流儀（テキスト無し・title/aria-label で用途を担保）。 */}
              <button
                type="button"
                className={styles.settingsBtn}
                onClick={() => setView("viewers")}
                title="視聴者一覧"
                aria-label="視聴者一覧"
              >
                <ViewersIcon />
              </button>
              <button
                type="button"
                className={styles.settingsBtn}
                onClick={() => setView("settings")}
                title="設定"
                aria-label="設定"
              >
                <GearIcon />
              </button>
            </div>
          </div>

          {/* 033c/034(UI刷新): 読み上げ ON のときだけ、ツールバー直下にクレジット表記（必須）をコンパクトな通知カードで
              出す（OFF の人には出さない）。選択話者名に追従（creditNotice）。 */}
          {ttsEnabled && (
            <section className={styles.credit}>
              <h2 className={styles.creditHeading}>
                クレジット表記のお願い（必須）
              </h2>
              <p className={styles.creditText}>
                {creditNotice(selectedSpeakerName)}
              </p>
            </section>
          )}

          {/* 033c: 読み上げ ON かつ ENGINE 未起動のときだけ表示（OFF の人には出さない）。上の effect(A) が同時に
              自動起動を走らせるため、ボタンは同じ launchEngine を叩く再試行/未登録誘導のフォールバック（通常は
              launchRequested で「起動中…」表示・disabled、未登録や失敗時のみ押せる）＝別導線を増やさない。 */}
          {ttsEnabled && engineRunning === false && (
            <div className={styles.engineBanner} role="alert">
              <span className={styles.engineBannerText}>
                VOICEVOX ENGINE が起動していません。読み上げには起動が必要です。
              </span>
              <button
                type="button"
                className={styles.btn}
                onClick={() => void launchEngine()}
                disabled={launching || launchRequested}
              >
                {launching || launchRequested ? "起動中…" : "VOICEVOX を起動"}
              </button>
              {launchNotice && (
                <span className={styles.engineBannerNotice}>
                  {launchNotice}
                </span>
              )}
            </div>
          )}

          {/* 047: 課金コメントの常時ティッカー（横スクロール）。**固定帯の上**に置く理由は 3 つ:
              ①ティッカーは「課金が 1 件でもあれば出っぱなし」なのに対し固定帯は 0/1 件で頻繁に出入りするため、
                上に置けば固定の出入りでティッカーの縦位置が動かない
              ②固定帯は自身の border-bottom でコメント一覧との境目を担っている（046a の実機修正）ので、
                固定帯と一覧の隣接関係を壊さない＝`PinnedCommentBar` / `.pinnedBar` を 1 行も触らずに済む
              ③YouTube のライブチャットも「ヘッダ直下がティッカー、その下が固定メッセージ」の順。
              課金 0 件のときは MonetaryTicker が null を返すので、既存レイアウトは完全に不変。 */}
          <MonetaryTicker
            items={monetary}
            readIds={readMonetaryIds}
            onRead={handleMonetaryRead}
          />

          {/* 046a: 固定コメント帯。クレジット（法的必須表記）と ENGINE バナー（role="alert"）の下、コメント一覧の
              直上に置く＝一覧に直結する情報を一覧の隣に置きつつ、上 2 つの優先度を崩さない。固定 0 件のときは
              PinnedCommentBar が null を返し、この機能を使わないユーザーには既存レイアウトが完全に不変。 */}
          <PinnedCommentBar pinned={pinned} onUnpin={handleUnpin} />

          {/* 034a: 本体は最新コメントへ自動追従（下端で追従・スクロールアップで解除＋「最新コメント N件 ↓」ボタン）。
              追従判定は useFollowScroll（CommentList 内）に集約し、034b はオーバーレイに followMode="always" を渡して再利用する。 */}
          {/* 038b フォローアップ: コメント一覧（左・流れ続ける）＋クリックで開く視聴者詳細（右）のスプリット。
              onSelect で選択視聴者 id をセットするだけで WS/受信・蓄積には触れない。狭い窓では詳細が全幅オーバーレイ。 */}
          <div className={styles.commentSplit}>
            <div className={styles.commentPane}>
              {/* 【レビュー：統合テスト】この配線（onSelect→viewerIdOf→ViewerDetailPanel 表示）は、CommentList の
                  onSelect 発火（CommentList.test）と viewerIdOf の連結/trim（viewerFormat.test）で個別にカバー済み。
                  【なぜ統合テスト無しで可か】CommentViewerApp 全体は WS/TTS/AudioContext/sidecar 依存が重く単体化コストが
                  高い一方、ここは 1 行の合成でロジックを持たない。【再修正トリガー】この配線に条件分岐が増える／
                  CommentViewerApp が現実的に単体化できるようになったら「コメントクリック→get_viewer(期待id)」の smoke を足す。 */}
              <CommentList
                comments={comments}
                followMode="release"
                onSelect={(c) => setSelectedViewerId(viewerIdOf(c))}
                badges={viewerBadges}
                firstOfStreamIds={firstOfStreamIds}
                onPin={handleTogglePin}
                pinnedIds={pinnedIds}
              />
            </div>
            {selectedViewerId !== null && (
              <div className={styles.detailPane}>
                <ViewerDetailPanel
                  id={selectedViewerId}
                  onDismiss={() => setSelectedViewerId(null)}
                  dismissKind="close"
                  onDeleted={() => setSelectedViewerId(null)}
                />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
