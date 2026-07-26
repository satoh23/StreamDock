import { useCallback, useEffect, useRef, useState } from "react";
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
} from "../../features/comment-viewer/overlaySettings";
// 044a: OBS 連携（方式A）。config 検出・パスワード設定は Rust command 経由、連携 ON/OFF は WS 制御フレーム。
import {
  detectObsWebsocketConfig,
  setObsWebsocketPassword,
  clearObsWebsocketPassword,
  type ObsWsConfig,
} from "../../features/comment-viewer/obsApi";
import { mergeComments } from "../../features/comment-viewer/mergeComments";
import { recordComments } from "../../features/viewer-memory/viewerMemoryApi";
import type { RecordResult } from "../../features/viewer-memory/types";
import {
  openCommentOverlayWindow,
  closeCommentOverlayWindow,
  isCommentOverlayOpen,
} from "../../features/comment-viewer/windowApi";
import { CommentList } from "./CommentList";
import { SettingsView } from "./SettingsView";
import { ViewersView } from "./ViewersView";
import { ViewerDetailPanel } from "./ViewerDetailPanel";
import { viewerIdOf } from "./viewerFormat";
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

  // 034d: OBS オーバーレイ窓の開閉状態（設定ビューのトグル表示に使う。開＝ON / 閉＝OFF）。窓の実状態と同期させ、
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

  // 044a: OBS 連携（方式A＝ウィンドウキャプチャ自動追加）。
  // - obsConfig: OBS の WebSocket 設定の read-only 検出結果（有効/ポート/認証要否）。null=未検出（未導入/未設定）。
  // - obsAutoAdd: 「OBS へ自動追加（連携）」トグルの永続状態（非機密・localStorage）。パスワードは保存しない。
  // - obsState: sidecar からの obs.state 通知（connecting/added/reused/failed/idle）。UI の状態表示に使う。
  //   ※失敗時の技術的 reason（ECONNREFUSED 等）はユーザーに無意味なため UI では表示しない（reason は受けても捨てる）。
  const [obsConfig, setObsConfig] = useState<ObsWsConfig | null>(null);
  const [obsAutoAdd, setObsAutoAdd] = useState(() => loadObsAutoAdd());
  const [obsState, setObsState] = useState<string>("idle");

  useEffect(() => {
    saveChannel(channel);
  }, [channel]);

  // 034d: マウント時に実際の窓状態へトグルを同期する（外部で開閉されていても実状態に合わせる）。
  useEffect(() => {
    void isCommentOverlayOpen().then(setOverlayOpen);
  }, []);

  // 044a: マウント時に OBS の WebSocket 設定を read-only 検出する（有効/ポート/認証要否）。
  // これで設定 UI が「WS 無効です／認証が必要です」を正確に案内し、認証時のみパスワード入力を出せる。
  // 検出できない（未導入/未設定/読取不可）ときは null＝有効化ガイドを出す。書き込みは一切しない（§5）。
  useEffect(() => {
    void detectObsWebsocketConfig().then(setObsConfig);
  }, []);

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
    const queue = createTtsQueue({
      getSpeakerId: () => selectedSpeakerIdRef.current,
      getReadingDictionary: () => BUILTIN_READING_DICTIONARY,
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

  // 032c-b: Twitch コメント取得 sidecar の単一双方向 WS に接続する。受信コメントは表示へ流し
  // （単一注入点 mergeComments）、新規追加分（added）を TTS キューへ enqueue して読み上げる。
  // enqueue は comment.id 冪等（ttsQueue の seenIds）なので、StrictMode で updater が二重実行されても
  // 重複読み上げにはならない（updater 内で enqueue しても安全）。バースト受信でも React が prev を直列化
  // するため取りこぼさない。読み上げには AudioContext の resume が要るが、それは「コメント取得開始」
  // ボタン（ユーザー操作）で行う（handleStartSession）。
  // Device Code の user_code / verification_uri と session.state を受け取り UI に反映する。
  useEffect(() => {
    const handle = connectCommentStream({
      onComments: (incoming) =>
        setComments((prev) => {
          const { next, added } = mergeComments(prev, incoming);
          enqueueForSpeech(added);
          // 038a: 受信済みコメント（新規分）を Rust の視聴者メモリへ記録する（端末内 SQLite のみ・
          // 端末外へ出さない）。added は comment.id で dedup 済み、Rust 側も INSERT OR IGNORE で冪等なので
          // StrictMode の updater 二重実行でも集計は重複しない（enqueueForSpeech と同じ論拠）。fire-and-forget。
          // 038c: 判定（初見/久しぶり）を handleRecordResult で受け取りバッジ Map を更新する（実挿入の初回のみ肯定）。
          recordComments(added, sessionIdRef.current, handleRecordResult);
          return next;
        }),
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
  // fetch にタイムアウト/signal は付けていない: 宛先は loopback で応答は即時、`checkEngineRunning` が
  // 例外を bool 化するため、稀に前回リクエストと重なっても副作用が無い（`cancelled` ガードで unmount 後の
  // setState も防ぐ）。再検討条件: loopback 以外へ宛先が広がる、または応答遅延で tick が滞留するなら
  // AbortController + タイムアウトを導入する。
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

  // 034d: 設定ビューのオーバーレイ開閉トグル（ON=開く / OFF=閉じる）。033f のオープン/クローズ挙動は不変で、
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
  const requestObsAutoAdd = () => {
    setObsState("connecting");
    void detectObsWebsocketConfig().then((cfg) => {
      setObsConfig(cfg);
      const stream = streamRef.current;
      if (!stream) {
        // L2: コメントストリーム WS 未接続なら enableObs が no-op になり connecting が固着するため failed に落とす。
        setObsState("failed");
        return;
      }
      stream.enableObs(cfg?.port ?? 4455);
    });
  };

  // 044a: オーバーレイ表示 OFF 連動。OBS 側ソースを**削除せず非表示**にする（ON で requestObsAutoAdd が再表示）。
  // port は既知の検出値（無ければ既定 4455）を使う。sidecar 側は best-effort（該当なし/未起動は idle）。
  const requestObsHide = () => {
    streamRef.current?.hideObs(obsConfig?.port ?? 4455);
  };

  const handleOverlayToggle = (next: boolean) => {
    if (next) {
      void openCommentOverlayWindow().then(() => {
        setOverlayOpen(true);
        // 044a: OBS 自動追加が ON なら、窓が OBS のウィンドウ一覧に載る猶予をおいてソース追加を要求する。
        if (obsAutoAdd) {
          window.setTimeout(() => requestObsAutoAdd(), OBS_ENABLE_DELAY_MS);
        }
      });
    } else {
      void closeCommentOverlayWindow().then(() => setOverlayOpen(false));
      // 044a: 連携 ON のときは、表示 OFF で OBS 側のソースも非表示にする（削除はしない）。
      if (obsAutoAdd) requestObsHide();
    }
  };

  // 044a: 「OBS へ自動追加（連携）」トグル。ON でオーバーレイ窓を（未開なら開いて）キャプチャ対象にし、OBS へ
  // ウィンドウキャプチャソースを自動追加（既存なら再利用）する。OFF は連携を止める（OBS 側のソースは消さない）。
  const handleObsAutoAddToggle = (next: boolean) => {
    setObsAutoAdd(next);
    if (!next) {
      streamRef.current?.disableObs();
      setObsState("idle");
      return;
    }
    if (overlayOpen) {
      requestObsAutoAdd();
    } else {
      // 未開ならオーバーレイを開いてから猶予をおいて追加（ワンクリックでソース追加まで到達させる）。
      void openCommentOverlayWindow().then(() => {
        setOverlayOpen(true);
        window.setTimeout(() => requestObsAutoAdd(), OBS_ENABLE_DELAY_MS);
      });
    }
  };

  // 044a: OBS WebSocket パスワードを保存する（認証有効な OBS 用）。Rust が §8 検証→keychain→sidecar へ私信。
  // 保存後、連携 ON かつオーバーレイ open なら再試行して認証成功後の自動追加に繋げる。
  const handleSetObsPassword = (password: string) => {
    void setObsWebsocketPassword(password).then(() => {
      if (obsAutoAdd && overlayOpen) requestObsAutoAdd();
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
          speakers={speakers}
          selectedSpeakerId={selectedSpeakerId}
          onSpeakerIdChange={setSelectedSpeakerId}
          onPreview={(id) => previewRef.current?.play(id)}
          overlayOpen={overlayOpen}
          onOverlayToggle={handleOverlayToggle}
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
