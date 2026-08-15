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
  type ThemeFontFetchResult,
  type ThemeImportFetchResult,
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
  // 061a: エフェクト窓の設定は **main 窓（`ObsEffectsScreen`）が書き手**で、この窓は読み手。
  // ⚠ state にミラーせず、判断のたびに読み直す（詳細はエフェクト連携 effect の JSDoc）。
  // ⚠ 064e: `loadEffectObsAutoAdd` / `EFFECT_OBS_AUTO_ADD_KEY` の import を外した
  //   （自動反映が既定になり、**設定そのものが消えた**）。
  loadStageOverlayEnabled,
  STAGE_OVERLAY_ENABLED_KEY,
  // 064a: OBS のソースを再生する方式（main 窓からの依頼をこの窓が代行する）。
  OBS_SOURCE_LIST_REQUEST_KEY,
  OBS_SOURCE_TEST_FIRE_KEY,
  parseObsSourceTestFire,
  saveObsSourceList,
  // 064b: OBS が長さを教えてくれなかったときの既定（実際の長さは OBS 側のメディアが持つ）。
  OBS_SOURCE_FALLBACK_DURATION_MS,
} from "../../features/comment-viewer/overlaySettings";
/**
 * 064b: **コメントの条件が当たったら OBS 側のソースを鳴らす**（方針転換の本体）。
 *
 * ⚠⚠ **なぜこの窓なのか（構造上の必然）**: sidecar と WS で繋がっているのは**この窓だけ**なので、
 * OBS を鳴らせるのもこの窓だけである（064a で `ObsSourceCard` の依頼を代行しているのと同じ非対称）。
 * ⚠ エフェクト窓（テンプレートを描くレーン）は **OBS 用の条件を 1 度も見ない**
 * （`createEffectMatcher` が当たり判定の前に落とす）。
 *
 * ⚠⚠ **`screens/comment-viewer/` → `screens/obs-effects/` の import はここが初めて**である。
 * 逆向き（`obs-effects/` → `comment-viewer/viewerFormat`）は 061b から在り、ディレクトリとしては
 * 相互参照になるが、**モジュールの循環は無い**（`viewerFormat` はこの窓を参照しない）。
 * ⚠ `effectTrigger.ts` の JSDoc が予告している再修正トリガー
 * 「**エフェクト窓以外に `decideEffects` の消費者が現れたとき**」に**該当する**が、
 * あちらが警戒しているのは `features/` → `screens/` という**層の逆転**であり、
 * ここは `screens/` どうしの横参照なのでその形にはならない。
 * ⚠⚠ **本当の解決は 064d**（取り込み機能ごと `screens/obs-effects/` を畳むとき）で、
 * そのときに `effectTrigger` / `effectAssignments` / `viewerFormat` の置き場所をまとめて決めること。
 * **いま移さないのは、064d で消える側のディレクトリへ引っ越しを 2 回行わないため。**
 */
import {
  createEffectTriggerState,
  createSeenEffectIds,
  decideEffects,
  takeFreshComments,
} from "../obs-effects/effectTrigger";
import { createObsSourceMatcher } from "../obs-effects/effectAssignments";
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
// 059a / 059b: 通知音。鳴らすかどうか（クールダウン・未選択ガード・Rust の同時再生 1 本への譲り）は
// notificationSound が持ち、ここは「いつ・どちらの音を呼ぶか（受信バッチごとに 1 回・**排他**）」と
// 「失敗をどう見せるか」だけを決める。
import { requestNotificationSound } from "../../features/comment-viewer/notificationSound";
import {
  loadSoundCommentEnabled,
  saveSoundCommentEnabled,
  loadSoundMonetaryEnabled,
  saveSoundMonetaryEnabled,
} from "../../features/comment-viewer/soundPrefs";
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
  // 061a: エフェクト窓の open/close は main 窓が持つ。この窓が使うのは **実窓の存在確認だけ**
  //（`enableObs("effects")` を送ってよいかの判定・046d レビューと同じ理由）。
  // 061k: ステージ窓ぶん（`enableObs("stage")` を送ってよいかの判定・同じ理由）。
  isStageOverlayOpen,
} from "../../features/comment-viewer/windowApi";
import { CommentList } from "./CommentList";
import {
  SettingsView,
  type AudioOutputListState,
  type SoundPreviewState,
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
import { ToggleSwitch } from "../../components/ToggleSwitch";
import styles from "./CommentViewerApp.module.css";
// 061g: ボタンの意匠は `components/compactButtons.module.css` へ移した（`ConfirmDialog` が
// `components/` へ出たため）。⚠ 寸法・配色はこの窓の 6 ファイル計 25 箇所と `ConfirmDialog` の共有。
import btnStyles from "../../components/compactButtons.module.css";

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
  // 061a: 検出済み OBS 設定を、**マウント時 1 回だけ張る effect**（下のエフェクト連携の `storage` 購読）から
  // 最新値で読むための ref 同期。state を直接掴むと stale closure で検出ポートが既定 4455 に化ける。
  // この窓の他の getter 注入（ttsEnabledRef / readMonetaryIdsRef）と同じイディオム。
  const obsConfigRef = useRef<ObsWsConfig | null>(null);
  useEffect(() => {
    obsConfigRef.current = obsConfig;
  }, [obsConfig]);
  // ⚠⚠ 061e(5)（実機確認で発見した Bug-1 の修正）: **sidecar WS が OPEN かどうか**を、deps 空の effect や
  // イベントハンドラから最新値で読むための ref 同期（`obsConfigRef` と同じイディオム）。
  // `streamConnected` は `onConnectionChange` 由来で、その呼び出し元は `commentStream.ts` の
  // `socket.onopen` / `socket.onclose` なので、**「`send` が通るか」と厳密に等価**。
  // ⚠ `streamRef.current`（ハンドルの有無）では代用できない——`connectCommentStream` は接続確立を待たずに
  // 同期でハンドルを返すので、**接続前でも非 null** になる。これが Bug-1 の直接の原因だった。
  const streamConnectedRef = useRef(false);
  useEffect(() => {
    streamConnectedRef.current = streamConnected;
  }, [streamConnected]);
  // 045c レビュー（回帰）: 表示 ON で仕掛ける猶予タイマー（OBS_ENABLE_DELAY_MS）の id。取り消せるように保持する。
  // 旧実装は id を捨てていたため、猶予中に表示 OFF / 自動反映 OFF にしても発火が止まらず、hideObs / disableObs の
  // **後に** enableObs が飛んでいた（OBS 側で閉じた窓のソースが再表示され、ツールバーにも表示 OFF のまま赤字が残る）。
  //
  // ⚠⚠ **061a で「種別ごとに 1 本の ref」から `Map<ObsOverlayKind, number>` へ一般化した。**
  // 046d までは `obsEnableTimerRef` / `pinnedObsEnableTimerRef` の 2 本を手で並べていたが、3 本目を
  // copy-paste すると**アンマウント時の cleanup が 3 分岐になり、4 本目で必ず 1 つ忘れる**。
  // 045c が実際に踏んだ回帰は「取り消し漏れ」そのものなので、**取り消しがループで書ける形**にしておく
  //（`clearObsEnableTimer()` を引数なしで呼べば全種別が止まる＝種別を増やしても cleanup は無改変）。
  // 種別ごとに別エントリなのは 046d の意図どおり（片方の ON がもう片方の仕掛かりを取り消さない）。
  const obsEnableTimersRef = useRef<Map<ObsOverlayKind, number>>(new Map());

  // --- 064b: OBS 側のソースを鳴らすレーン -------------------------------------------------------
  //
  // ⚠⚠ **レーンごとに state を分ける**（061k が 2 窓で作った構えの 3 本目）。エフェクト窓と
  //   共有すると「OBS のソースが 3 回鳴っただけで直後の投げ銭がエフェクト窓で捨てられる」が起きる。
  //   ⚠ この窓はエフェクト窓の state を**そもそも触れない**（別プロセスの webview なので構造的に無理）が、
  //   規律としては同じ＝**バースト枠とクールダウンはレーンごとに独立**である。
  // ⚠ **ref に持つ**（state にしない）——`connectCommentStream` は**マウント時 1 回だけ**張るので、
  //   ここを state にすると effect が張り直されて WS が切れ、その間のコメントを落とす。
  const obsEffectStateRef = useRef(createEffectTriggerState());
  const obsEffectSeenIdsRef = useRef<Set<string>>(createSeenEffectIds());
  // ⚠⚠ **matcher は呼ばれるたびに localStorage を読み直す**（`createObsSourceMatcher` の JSDoc が正）。
  //   ＝ main 窓で条件を変えた直後の 1 件目から効く（`storage` の窓跨ぎ伝播に依存しない）。
  const obsSourceMatcher = useMemo(() => createObsSourceMatcher(), []);

  // 058a: 通知音の出力デバイス（②-軽）。
  // - audioOutputDeviceId: ユーザーが選んだデバイス ID の永続状態（非機密・localStorage）。
  //   `""`＝未選択で、これは**「既定デバイスで鳴らす」ではなく「鳴らさない」**を意味する
  //   （②-軽では OS 既定＝仮想オーディオデバイス＝配信に載る側なので、既定へ落とすと
  //   「載せないつもりの通知音が配信に載る」＝機能の存在理由が壊れる。fail-closed）。
  // - audioOutputDevices / audioOutputListState: Rust の列挙結果とその状態。
  //   **デバイス名は state に置くだけで保存しない**（古い名前を残さない・§9）。
  // ⚠ 059c: `audioTestState`（058a のテスト再生の状態）は**削除した**——ボタン自体が無くなったため。
  const [audioOutputDeviceId, setAudioOutputDeviceId] = useState(() =>
    loadAudioOutputDeviceId(),
  );
  const [audioOutputDevices, setAudioOutputDevices] = useState<
    AudioOutputDevice[]
  >([]);
  const [audioOutputListState, setAudioOutputListState] =
    useState<AudioOutputListState>("loading");

  // 059a / 059b: 通知音（コメント音・投げ銭音）。
  // - soundCommentEnabled / soundMonetaryEnabled: ON/OFF の永続状態（非機密・localStorage）。
  //   **どちらも既定 OFF**（アップデート直後にユーザー操作ゼロで音が鳴り始めるのを避ける。
  //   理由は soundPrefs.ts の JSDoc）。⚠ **2 つは独立**（片方 OFF でもう片方は鳴る）。
  // - soundPreviewState: 設定画面の「試聴」の状態（⚠ 059c: 058a のテスト再生が消えたので、
  //   通知音まわりの再生 state はこれ 1 本になった）。
  //   ⚠ **059b の投げ銭試聴とは共有する**（同じカード・同じデバイス・同じ復旧手順で、
  //   分ける理由が無い。むしろ共有だと「片方の再生中はもう片方も押せない」＝Rust の同時再生 1 本と
  //   一致する disabled になる。詳細は SettingsView の SoundPreviewState の JSDoc）。
  // - notificationSoundFailed: **配信中に鳴らせなかったこと**の継続表示フラグ（下のツールバー indicator）。
  //   ⚠⚠ これが 058a から 059 へ渡された宿題そのもの——058a は fail-closed かつホットプラグ監視を持たない
  //   ので、失敗を無言で捨てると「配信中にデバイスを抜いたら通知音が鳴らなくなった」ことに気付く手段がゼロになる。
  const [soundCommentEnabled, setSoundCommentEnabled] = useState(() =>
    loadSoundCommentEnabled(),
  );
  const [soundMonetaryEnabled, setSoundMonetaryEnabled] = useState(() =>
    loadSoundMonetaryEnabled(),
  );
  const [soundPreviewState, setSoundPreviewState] =
    useState<SoundPreviewState>("idle");
  const [notificationSoundFailed, setNotificationSoundFailed] = useState(false);

  // 059a / 059b: 受信 effect から通知音を鳴らすための ref 3 本。**state を直接 useCallback の依存に
  // 入れない**——playBatchNotification が作り直されると、それを依存に持つ WS 接続 effect が張り直されて
  // 「窓内 WS 1 本」の原則に反する（ttsEnabledRef / speakTwitchRef と同じ理由）。同期は下の effect 群で行う。
  const soundCommentEnabledRef = useRef(soundCommentEnabled);
  const soundMonetaryEnabledRef = useRef(soundMonetaryEnabled);
  const audioOutputDeviceIdRef = useRef(audioOutputDeviceId);

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

  // 059a / 059b: 通知音の ON/OFF を永続化する（058a のデバイス選択と同じ扱い）。
  useEffect(() => {
    saveSoundCommentEnabled(soundCommentEnabled);
  }, [soundCommentEnabled]);
  useEffect(() => {
    saveSoundMonetaryEnabled(soundMonetaryEnabled);
  }, [soundMonetaryEnabled]);

  // 059a / 059b: 受信 effect（安定コールバック）から最新値を読むための ref 同期。
  useEffect(() => {
    soundCommentEnabledRef.current = soundCommentEnabled;
  }, [soundCommentEnabled]);
  useEffect(() => {
    soundMonetaryEnabledRef.current = soundMonetaryEnabled;
  }, [soundMonetaryEnabled]);
  useEffect(() => {
    audioOutputDeviceIdRef.current = audioOutputDeviceId;
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
  // 「再読み込み」ボタンと試聴の失敗表示の 3 段で、「黙って載る側に倒れる」は防げる
  //（⚠ 059c 以前は 3 段目が「テスト再生の失敗表示」だった。ボタン削除に伴い試聴が引き継いでいる）。
  useEffect(() => {
    if (view !== "settings") return;
    refreshAudioOutputDevices();
  }, [view, refreshAudioOutputDevices]);

  // 059a: コメント通知音を試聴する（設定画面の「通知音を試聴」ボタン・上段）。
  //
  // ⚠ **notificationSound.ts のクールダウンを通さない。** ユーザーの明示操作にレート制限をかけると
  // 「押したのに鳴らない」＝壊れて見える（034c の話者試聴と同じ考え方）。連打は再生中 disabled で抑える。
  //
  // ⚠⚠ **059c で 058a の `handleTestNotificationSound`（テスト再生・`"test"` 音）は削除した**（本人指示）。
  // 058a はこれを「『選んだデバイスから鳴る』と『既定デバイスからは鳴らない』を耳で確かめる唯一の手段」と
  // 位置づけていたが、**この試聴が同じ `audioOutputDeviceId` へ同じ経路で実音を鳴らす**ので合格基準は測れる。
  // ＝赤字を見たユーザーが押す復旧導線もこのボタンに一本化された（下の `setNotificationSoundFailed(false)`）。
  // ⚠ Rust の `NotificationSound::Test` は**残してある**（enum から消すと docs/security.md の
  // レビュー必須条件「音声デバイスの列挙・音声の再生」に該当し security-review のやり直しになるため）。
  const handlePreviewCommentSound = useCallback(() => {
    if (audioOutputDeviceId === NO_AUDIO_OUTPUT_DEVICE) return;
    setSoundPreviewState("playing");
    playNotificationSound(audioOutputDeviceId, "comment")
      .then(() => {
        setSoundPreviewState("idle");
        // 試聴で鳴った＝いま鳴らせる状態なので、配信中に立った継続表示も畳んでよい
        //（デバイスを挿し直したユーザーが、次のコメントを待たずに赤字を消せる導線になる）。
        setNotificationSoundFailed(false);
      })
      // 失敗＝そのデバイスでは鳴らせない。**既定デバイスで鳴らし直さない**（fail-closed）。
      .catch(() => setSoundPreviewState("failed"));
  }, [audioOutputDeviceId]);

  // 059b: 投げ銭通知音を試聴する（設定画面の「通知音を試聴」ボタン・下段）。
  //
  // ⚠ コメント試聴と**同じ state（soundPreviewState）を共有する**。分けない理由:
  // ①同じカード・同じデバイス・同じ復旧手順なので、失敗の案内文が音種で変わらない
  // ②共有だと「片方の再生中はもう片方も disabled」になり、**Rust の同時再生 1 本と一致する**
  //  （分けると再生中にもう片方を押せてしまい、Rust に黙って捨てられる＝押したのに鳴らない）。
  // ⚠ 059a と同じく **notificationSound.ts のクールダウンを通さない**（明示操作にレート制限をかけない）。
  const handlePreviewMonetarySound = useCallback(() => {
    if (audioOutputDeviceId === NO_AUDIO_OUTPUT_DEVICE) return;
    setSoundPreviewState("playing");
    playNotificationSound(audioOutputDeviceId, "monetary")
      .then(() => {
        setSoundPreviewState("idle");
        // 試聴で鳴った＝いま鳴らせる状態なので、配信中に立った継続表示も畳んでよい（059a と同じ導線）。
        setNotificationSoundFailed(false);
      })
      // 失敗＝そのデバイスでは鳴らせない。**既定デバイスで鳴らし直さない**（fail-closed）。
      .catch(() => setSoundPreviewState("failed"));
  }, [audioOutputDeviceId]);

  // 058a: デバイスを選び直したら直前の失敗表示を消す（古い赤字が残って混乱させない）。
  // 059a: 通知音側の失敗表示（試聴の赤字とツールバーの継続表示）も同じ理由で畳む。
  // ⚠ ツールバーの継続表示をここで消すのは「デバイスを選び直した＝ユーザーが対処した」ためで、
  // **時間経過では消さない**（気付かせるのが目的なので、放っておいて消えては意味がない）。
  const handleAudioOutputDeviceIdChange = useCallback((deviceId: string) => {
    setAudioOutputDeviceId(deviceId);
    setSoundPreviewState("idle");
    setNotificationSoundFailed(false);
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
  // ⚠ 061a: **ループで全種別を止める**ので、種別を増やしてもこの effect は無改変でよい（取り消し漏れが起きない）。
  useEffect(() => {
    const timers = obsEnableTimersRef.current;
    return () => {
      for (const id of timers.values()) {
        window.clearTimeout(id);
      }
      timers.clear();
    };
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

  // 059a / 059b: 受信バッチに新着があれば通知音を **1 回だけ** 鳴らす安定コールバック
  // （useCallback []・enqueueForSpeech と同型）。
  //
  // ⚠⚠ **排他の実装点はここ**（親 059 の決定）。課金コメントが 1 件でも含まれるバッチでは
  // **投げ銭音だけ**を鳴らし、コメント音は鳴らさない。両方鳴ると「別の音にした」意味が消える。
  // 059b で `playCommentNotification` から改名した——2 音のどちらを鳴らすかを決める関数になったので、
  // 旧名だと「コメント音を鳴らす関数」に読め、**この関数の一番大事な責務（排他）が名前から消える**。
  //
  // ⚠⚠ **課金判定は `isMonetaryEvent(c.eventType)`。`displayEventType` を通さないこと。**
  // 059b のタスクファイルと task-board の申し送りは「表示側と同じ `displayEventType` を使うこと」と
  // 書いていたが、**そのとおりに `isMonetaryEvent(displayEventType(c))` と書くとビッツで鳴らない**——
  // `displayEventType` は superchat + currency:"BITS" を `"bits"` へ振り替えるが、`"bits"` は
  // `MONETARY_EVENT_TYPES` に入っていないため（あの Set は「ビッツは superchat に含まれる」という
  // 前提で作られていて、**生の eventType に適用する述語**である）。
  // `displayEventType(c) !== "chat"` も採らない——`CommentList` のオーバーレイ側はそれで分岐しているが、
  // あれは「chat 以外は課金カードで描く」＝見た目が違うだけの安全な劣化で、**音で同じことをすると
  // 未知の種別に対して「投げ銭が来た」と嘘をつく**ことになり劣化の向きが逆になる。
  // 採った式は `CommentList` の本体一覧・047 のティッカー・049 の読み上げ優先キュー・固定帯と**同一**で、
  // 「判定を 2 実装に分裂させない」という申し送りの意図はこちらで満たしている
  //（`MONETARY_EVENT_TYPES` に種別が増えたとき自動で追従するのもこの式だけ）。
  //
  // ⚠ **排他は ON/OFF より先に効く**（本人決定・2026-08-04）。バッチの代表音を先に決め、
  // **その音の ON/OFF だけ**を見る。＝課金 1 件＋通常 5 件のバッチで投げ銭音が OFF なら、
  // コメント音へフォールバックせず**そのバッチは無音**。「投げ銭音を OFF にしたのにスパチャで
  // コメント音が鳴る」を避けるため。sidecar は comments.append を 1 件ずつ送るので混在バッチ自体が稀。
  // **再修正トリガー＝実機で「スパチャのときだけ無音になるのが不便」と感じたとき。**
  //
  // ⚠⚠ **1 バッチ 1 回。** `added.forEach` にしないこと——バッチで 20 件届いても鳴らすのは 1 回で、
  // これは「クールダウンが潰してくれるから結果的に 1 回」ではなく**意図としてここで 1 回に決めている**。
  // （クールダウンの値を変えたときに壊れないよう、`CommentViewerApp.notificationSound.test.tsx` が
  // クールダウンより手前の呼び出し回数を数えて固定している。）
  // ⚠ **`updated`（043e の Jewels combo 更新）では鳴らさない**——同じコメントの金額が伸びただけで
  // 新しいコメントではない。呼び出し側が `added` しか渡さないことで守る。
  // ⚠⚠ **未選択なら invoke しない＝既定デバイスへ落とさない**（fail-closed）。②-軽では OS 既定＝
  // 仮想オーディオデバイス＝配信に載る側なので、落とすと「載せないつもりの通知音が配信に載る」。
  // 鳴らないのは軽微な不便で、載るのは事故（058a の判断をここでも守る）。
  //
  // ⚠ **StrictMode の updater 二重実行について**: この関数は setComments の updater 内から呼ばれ、
  // main.tsx は <React.StrictMode> なので dev では 2 回走る。enqueueForSpeech は ttsQueue の seenIds、
  // recordComments は Rust の INSERT OR IGNORE で冪等だが、**通知音は構造的には冪等でない**。
  // 実際に 1 回で済むのは、同一 tick の 2 回目が必ず notificationSound のクールダウンに当たるため
  // ＝**クールダウンが冪等化も担っている**。偶然に見えて設計なので、テストで固定してある
  // （notificationSound.test.ts の「同一 tick の 2 回目」ケースと、
  //   CommentViewerApp.notificationSound.test.tsx の <React.StrictMode> 下のケース）。
  // ⚠ **これは時間ベースの冪等化＝構造的な冪等化ではない**（レビュー指摘・受容した弱点）。
  // クールダウンを 0 にすると dev で 2 回鳴る、という結合が残っている。現状維持にしたのは、
  // 実機で調整しうるのは comment(600ms) / monetary(1500ms) の 2 値だけで 0 にする理由が無く、
  // 上記 2 本のテストが結合を可視化しているため（059b で音が増えても結論は変わらない）。
  // **再修正トリガー＝クールダウンを 250ms 未満まで下げたくなったとき／この副作用呼び出しを
  // updater の外へ出すとき**。そのときは `lastNotifiedIdRef` に最後の要素の id を持たせて
  // 同一 id なら鳴らさない形（ref 1 本）にすれば、クールダウンの値と完全に独立した冪等性になる。
  //
  // ⚠ **`added` は「新規コメント」ではなく厳密には「`prev` に無い id」**（mergeComments の既知性質 Q-1）。
  // MAX_COMMENTS のクランプで表示から落ちた jewels 行に後から combo 更新が届くと `added` に載る。
  // 059a では実害なし——通知音は「そのコメントを喋る」のではなく「新着があれば 1 回鳴る」だけで、
  // 表示から消えた行の再出現を新着として扱うのはむしろ自然だから。
  // ⚠ **059b では排他判定を `added` の中身で行うので意味が増える**（このケースで「200 件前のスパチャの
  // 投げ銭音が鳴り直す」）。**受容した**（本人決定・2026-08-04）。理由:
  // ①**鳴っても嘘ではない**——combo 更新は実際に追加のジュエルが贈られたイベントで、「200 件前」なのは
  //  表示行の話であって金銭の発生は今である。
  // ②発生条件は「jewels の初報と combo 更新の間に 200 件流れる」で、043e が「combo 更新は数秒以内に届く
  //  ため実運用では稀」と実測済み。
  // ③`ttsQueue.seenIds` 相当の Set を通知音のためだけに持つと、**無限に増える集合**を抱えるうえ、
  //  059a の冪等化（クールダウン）と防波堤が 2 系統になって「どちらが効いたか」が読めなくなる。
  // **再修正トリガー＝`MAX_COMMENTS` を大幅に下げる／combo 更新が数十秒後に届く実データを観測したとき。**
  const playBatchNotification = useCallback((added: CommentViewDto[]) => {
    if (added.length === 0) return;
    // 排他: 課金が 1 件でもあれば投げ銭音、無ければコメント音。**どちらか 1 つだけ**を 1 回鳴らす。
    const sound = added.some((c) => isMonetaryEvent(c.eventType))
      ? ("monetary" as const)
      : ("comment" as const);
    const enabled =
      sound === "monetary"
        ? soundMonetaryEnabledRef.current
        : soundCommentEnabledRef.current;
    if (!enabled) return;
    const deviceId = audioOutputDeviceIdRef.current;
    if (deviceId === NO_AUDIO_OUTPUT_DEVICE) return;
    void requestNotificationSound(sound, deviceId).then((outcome) => {
      // ⚠ "skipped"（クールダウン）では触らない。鳴らさなかっただけで、故障ではない。
      // ⚠ **飛行中の要求が「対処済み」を上書きしうる**（レビュー Q-6・受容した挙動）。デバイスを選び直した／
      // 試聴が成功した直後に、それ以前に投げた要求が reject すると、古いデバイスの失敗でこの赤字が戻る。
      // 世代カウンタ（requestGenerationRef）で古い解決を捨てる手はあるが、次の成功・次の選び直し・次の試聴の
      // どれでも消えるうえ再生要求は最短でも 600ms に 1 回しか飛ばないので、複雑さに見合わないと判断した。
      // **再修正トリガー＝クールダウンを大幅に短くする／再生完了までの時間が数秒規模に伸びるとき**
      // （飛行中の要求が積み上がるようになると、この上書きが目に見える頻度になる）。
      if (outcome === "played") setNotificationSoundFailed(false);
      else if (outcome === "failed") setNotificationSoundFailed(true);
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
          // 059a / 059b: 通知音も added に相乗りする（新しい差分検出を発明しない）。⚠ **1 バッチ 1 回**で、
          // updated（Jewels combo 更新）には渡さない。どちらの音を鳴らすか（排他）・ON/OFF・未選択ガードの
          // 判断はすべて playBatchNotification 側。
          playBatchNotification(added);
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

        // ⚠⚠ 064b: **コメントの条件が当たったら OBS 側のソースを鳴らす。**
        //
        // ⚠⚠ **二重発火を止めているのは [`takeFreshComments`]（＝ id の集合）である。**
        //   これ 1 つで [043e] の combo 再送・再接続・StrictMode の updater 二重実行の
        //   **3 つすべて**に効く（集合は ref なので、どの経路でも 2 度目は空配列になる）。
        //
        // ⚠ **置き場所が `setComments` の updater の外**なのは、ティッカー（047）・051 と同じ規律による:
        //   ①updater の中で別の副作用を起こさない ②`mergeComments` は表示・TTS・保存の
        //   単一注入点なので、そこへ関心を混ぜない。
        //   ⚠⚠ **ただし「updater の中に入れると 2 回鳴る」は事実ではない**（実際に変異させて確認した）
        //   ——上の id 集合が先に落とすため。⇒ **この置き場所はテストでは固定できていない**
        //   （＝規律として守るもので、テストが守ってくれるものではない）。
        //   ⚠ 逆に **id 集合のほうを外すと、テストが必ずレッドになる**（そちらが本体の担保）。
        // ⚠ `mergeComments` の `added` を使わないのも同じ理由（あれは updater の中にしか無い）。
        // ⚠⚠ **`updated` に `[]` を渡す**のは「このレーンは combo 更新を一切扱わない」の明示
        //   （`decideEffects` 側にも `updated` から出さない規則があり、二重に守っている）。
        // ⚠ **鳴らすのは「表示 → 頭出し → 指定時間で非表示」の 3 操作だけ**で、
        //   ソースを作る／消す／設定を書き換える能力はこの経路に無い（§3）。
        // ⚠⚠ **第三者のコメント本文は OBS へ 1 バイトも渡らない**——渡るのは
        //   `sourceName`（＝**ユーザー自身が OBS で付けた名前**）だけで、本文は照合に使って捨てる
        //   （`EffectMatch` に本文を載せる場所が型として無い・§9）。
        const freshForObs = takeFreshComments(
          obsEffectSeenIdsRef.current,
          incoming,
        );
        if (freshForObs.length > 0) {
          const fires = decideEffects(
            freshForObs,
            [],
            obsEffectStateRef.current,
            Date.now(),
            obsSourceMatcher,
          );
          for (const fire of fires) {
            // ⚠ 何秒出すかは **OBS 側のメディアの長さ**が正（sidecar が聞く）。
            //   ここで渡すのは**聞けなかったときの既定**だけである。
            requestObsSourceFire(
              fire.sourceName,
              OBS_SOURCE_FALLBACK_DURATION_MS,
            );
          }
        }
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
      // 064a: 鳴らせる OBS ソースの一覧を main 窓へ渡す（localStorage 経由）。
      //   ⚠⚠ **064c: `ok`（取れたのか）も一緒に書く。** 旧実装は失敗時も空配列で来るのを
      //   そのまま「0 件」として見せていたが、main 窓は**そこから理由を復元できず**、
      //   OBS 未起動のユーザーへ「OBS のシーンにソースを追加してください」と誤案内していた。
      //   ⚠ 失敗の**文言**は従来どおりツールバーの `obsState` 側に出る（表示の持ち主は増やしていない）。
      onObsSources: (sources, ok) => {
        saveObsSourceList(sources, ok);
      },
      onObsState: (state) => {
        setObsState(state);
      },
    });
    streamRef.current = handle;
    return () => {
      handle.disconnect();
      streamRef.current = null;
    };
    // enqueueForSpeech / handleRecordResult / playBatchNotification はいずれも useCallback([]) で安定
    // ＝この effect は実質マウント専用のまま（窓内 WS 1 本の原則を守る。deps に載せても再接続しない）。
    // ⚠ 059a/059b: playBatchNotification が state を依存に持つと**ここが張り直されて WS が繋ぎ直る**ので、
    // 通知音の ON/OFF 2 つとデバイス ID は ref 経由で読んでいる
    //（soundCommentEnabledRef / soundMonetaryEnabledRef / audioOutputDeviceIdRef）。
    // ⚠ 064b: `obsSourceMatcher` は `useMemo(…, [])` で**一生変わらない**ので、deps に載せても
    //   張り直らない（061k がエフェクト窓で `matchEffect` を deps に載せているのと同じ形）。
    // ⚠⚠ **ここに不安定な値を足さないこと**——張り直すと WS が切れて、その間のコメントを落とす。
    // ⚠ `requestObsSourceFire` を deps に載せていないのは、あれが**ref しか読まない**ため
    //   （`streamRef` / `obsConfigRef`）。マウント時の写しを掴んでいても常に最新の接続へ送る。
  }, [
    enqueueForSpeech,
    handleRecordResult,
    playBatchNotification,
    obsSourceMatcher,
  ]);

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
  // 落とさない（表示専用）。⚠ **061b: 「kill 契機はコメビュ窓に集約のまま」ではなくなった**
  // （061b レビュー②S-4）。契機は `comment-viewer` / `effect-overlay` の 2 点だが、
  // `comment-overlay` はそこに入っていないので、この窓の性質自体は 033f から不変。
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
  //
  // ⚠⚠ 061a レビュー（Q-2・**修正不要と判断／要監視**）: 046d が共有を受容した根拠は「これは
  // **セットアップ時の一度きりの操作**だから」だったが、061a の effects はその条件から外れている——
  // effects だけ**マウント時 reconcile（下のエフェクト連携 effect）からも走る**ので、
  // 「設定 ON のまま OBS 未起動でコメビュ窓を開く」と**開くたびにツールバーへ failed が出る**
  //（しかも設定した場所は main 窓なので、ユーザーには出所が分からない）。
  // それでも今直さないのは、**種別ごとの表示にするには sidecar の `obs.state` フレームに種別を載せる
  // ＝ wire の変更が要る**から（`CommentStreamHandlers.onObsState` は `(state, reason)` だけで種別を運ばない）。
  // 061a は「`enable`/`hide`/`disable`/`ensureOverlaySource` を 1 行も変えない」を要件にしており、
  // wire 変更はその要件と 046d の再修正トリガーの領分で、レビュー指摘への追従としては過大。
  // **再修正トリガー**＝①実機で「コメビュを開くたびに OBS の赤字が出る」が確認された
  // ②061b で effects が毎コメント発火の層になる（＝失敗表示の頻度が跳ね上がる）、のどちらか。
  // そのときは `obs.state` に `overlay` を足し、`obsState` を `Record<ObsOverlayKind, ObsState>` へ広げる
  //（046d の再修正トリガーと同じ作業なので、まとめて 1 回で済む）。
  //
  // ⚠⚠ **061e レビュー Q-1（修正不要・受容の明示）: 連携 ON でゲートされるのは「呼ぶ瞬間」だけで、
  // in-flight の結果は追いかけられない。** `disableObs()` は sidecar の `disable()`＝`onState("idle")` を
  // 出すだけで、**走っている `enable()` を止めない**（`obs-client.ts`）。よって
  //   ①連携 ON・表示 ON で反映を仕掛ける →②sidecar が接続待ち（OBS 未起動なら `CONNECT_TIMEOUT_MS`＝4 秒）
  //   →③その間に連携を OFF（`disableObs` の echo で idle・赤字は消える）→④timeout の `failed` が着弾
  // という順序だと、**連携 OFF なのに数秒遅れで赤字が出る**（061e(2) でゲートが外れたため可視化された）。
  // ⚠ この状態は「表示 OFF」では消えない（`handleOverlayToggle` の OFF 分岐は `if (obsAutoAdd)` の内側）。
  // 消えるのは「自動反映を ON→OFF」または窓の開き直し。
  // **それでも直さないのは**、④の赤字が指す事実（**OBS へ繋がらない**）はその瞬間**現に真**で、
  // ユーザーが取る行動も変わらない（OBS を起動する）から＝(b) が受け入れた stale-positive と同種。
  // **再修正トリガー**＝実機で「OFF にしたのに後から赤字が出る」が煩わしいと分かったとき。
  // そのときは**世代カウンタ**（`requestObsAutoAdd` 発行時と OFF 系操作で世代を上げ、`onObsState` は
  // 最新世代の結果だけ反映する）を足す。⚠ ゲートを戻すのは不可（061e(2) の (B) が再発する）。
  const requestObsAutoAdd = (overlay: ObsOverlayKind) => {
    setObsState("connecting");
    void detectObsWebsocketConfig().then((cfg) => {
      setObsConfig(cfg);
      const stream = streamRef.current;
      // L2: コメントストリーム WS 未接続なら enableObs が no-op になり connecting が固着するため failed に落とす。
      // ⚠⚠ **061e(5)（実機で発見した Bug-1 の修正）: 判定を `streamRef.current` から
      // `streamConnectedRef.current` へ直した。** L2 の意図は元から「**送っても届かないなら failed**」だったが、
      // 見ていたのが**ハンドルの有無**で、`connectCommentStream` は接続確立を待たず同期でハンドルを返すため
      // **接続前でも非 null**＝ガードが素通りしていた。その結果 `send`（`commentStream.ts`・OPEN 以外は
      // **黙って捨てる**）に飲まれ、**`obsState` が `connecting` のまま永久に固着**していた
      //（実機確認で 2 回再現。ツールバーは failed のときだけ出すので**赤字も出ない**＝
      // 061e が直そうとした「結果が読み取れない」が、最も起きやすい経路で残っていた）。
      // ⚠ これで「切断中に storage で連携 ON」のような経路も `connecting` 固着ではなく failed へ落ちる。
      if (!stream || !streamConnectedRef.current) {
        setObsState("failed");
        return;
      }
      stream.enableObs(cfg?.port ?? 4455, overlay);
    });
  };

  /**
   * 060c: 外部 `@import` の取得を sidecar へ依頼する（**1 本だけ**・スナップショット）。
   *
   * ⚠ WS ハンドル（`streamRef`）を持っているのはこのコンポーネントだけなので、ここから
   * `SettingsView` → `OverlayThemeCard` へ**この 1 本だけ**を渡す。カード側が WS を張り直すと
   * 接続が二重になるため。
   * ⚠ **未接続なら取得を試みず即座に失敗として返す**（`requestThemeImport` 側も同じ判定をするが、
   * ハンドルそのものが無い状態はここでしか分からない）。取り込み自体は成功のまま＝ fail-closed。
   * ⚠ URL も CSS 本文もここではログに出さない（§9）。
   */
  const requestThemeImport = useCallback(
    (url: string, maxBytes: number) => {
      const stream = streamRef.current;
      if (!stream) {
        return Promise.resolve<ThemeImportFetchResult>({
          ok: false,
          reason: "offline",
        });
      }
      return stream.requestThemeImport(url, maxBytes);
    },
    [],
  );

  /**
   * 060h: `@font-face` の `src` が指すフォント実体の取得を sidecar へ依頼する（**1 本だけ**）。
   * ⚠ 経路も判断も `requestThemeImport` と同一で、違うのは sidecar 側のガードとレート枠だけ。
   */
  const requestThemeFont = useCallback(
    (url: string, maxBytes: number) => {
      const stream = streamRef.current;
      if (!stream) {
        return Promise.resolve<ThemeFontFetchResult>({
          ok: false,
          reason: "offline",
        });
      }
      return stream.requestThemeFont(url, maxBytes);
    },
    [],
  );

  // 044a: オーバーレイ表示 OFF 連動。OBS 側ソースを**削除せず非表示**にする（ON で requestObsAutoAdd が再表示）。
  // port は既知の検出値（無ければ既定 4455）を使う。sidecar 側は best-effort（該当なし/未起動は idle）。
  // ⚠ 061a: `obsConfig`（state）ではなく `obsConfigRef` から読む。呼び出し元に**マウント時 1 回だけ張る
  // `storage` 購読**（下のエフェクト連携 effect）が加わったため、state を直接読むと deps 空の closure が
  // 初期値 null を掴んだままになり、**検出ポートを無視して既定 4455 へ送る**（実質サイレント失敗）。
  const requestObsHide = (overlay: ObsOverlayKind) => {
    streamRef.current?.hideObs(obsConfigRef.current?.port ?? 4455, overlay);
  };

  /**
   * 064a: **main 窓の依頼を代行して OBS のソース一覧を取り直す。**
   *
   * ⚠⚠ **main 窓は WS を持たないので、この窓が代わりに投げるしかない**
   * （`ObsEffectsScreen` の JSDoc が「構造としてそうならざるを得ない」と書いている非対称そのもの）。
   * 結果は `onObsSources` → `saveObsSourceList` で localStorage へ書き戻し、main 窓が読む。
   * ⚠ `obsConfigRef` から port を読むのは `requestObsHide` と同じ理由（deps 空の closure が
   * 初期値 null を掴んで既定 4455 へ送るのを避ける）。
   */
  const requestObsSourceListRefresh = () => {
    streamRef.current?.listObsSources(obsConfigRef.current?.port ?? 4455);
  };

  /**
   * 064a: **main 窓の依頼を代行してソースを 1 回鳴らす。**
   *
   * ⚠⚠ **ここでソース名を検証しない。** 検証の持ち主は sidecar 側 1 か所
   * （形式検査 ＋ **`GetInputList` との実在照合**）で、ここで先回りすると規則が 2 か所に割れる。
   * ⚠ localStorage は他窓からも書けるが、**壁は sidecar 側にある**ので素通りにはならない。
   */
  const requestObsSourceFire = (sourceName: string, durationMs: number) => {
    streamRef.current?.fireObsSource(
      obsConfigRef.current?.port ?? 4455,
      sourceName,
      durationMs,
    );
  };

  // 045c レビュー（回帰）: 仕掛かり中の猶予タイマーを取り消す。表示 OFF・自動反映 OFF・アンマウントで呼ぶ。
  // 「ユーザーが OFF にしたのに、その後 enableObs が飛ぶ」を止めるのが目的（§1 の「明示的に有効化した時のみ接続」）。
  // ⚠ 061a: 引数を省くと**全種別**を取り消す（アンマウント用）。種別を指定すればその 1 本だけ。
  const clearObsEnableTimer = (overlay?: ObsOverlayKind) => {
    const timers = obsEnableTimersRef.current;
    if (overlay === undefined) {
      for (const id of timers.values()) window.clearTimeout(id);
      timers.clear();
      return;
    }
    const id = timers.get(overlay);
    if (id !== undefined) {
      window.clearTimeout(id);
      timers.delete(overlay);
    }
  };

  // 044a/046d: 「窓が OBS のウィンドウ一覧に載る」までの猶予をおいてから自動追加を要求する。
  // ⚠ **張り直す前に必ず既存を取り消す**（連打で二重に仕掛からないようにする・045c レビュー）。
  const scheduleObsAutoAdd = (overlay: ObsOverlayKind) => {
    clearObsEnableTimer(overlay);
    const id = window.setTimeout(() => {
      obsEnableTimersRef.current.delete(overlay);
      requestObsAutoAdd(overlay);
    }, OBS_ENABLE_DELAY_MS);
    obsEnableTimersRef.current.set(overlay, id);
  };

  const handleOverlayToggle = (next: boolean) => {
    if (next) {
      void openCommentOverlayWindow().then(() => {
        setOverlayOpen(true);
        // 044a: OBS 自動追加が ON なら、窓が OBS のウィンドウ一覧に載る猶予をおいてソース追加を要求する。
        // 045c レビュー: 連打で二重に仕掛からないよう、張り直す前に既存を取り消す（scheduleObsAutoAdd の中）。
        if (obsAutoAdd) {
          scheduleObsAutoAdd("comments");
        }
      });
    } else {
      void closeCommentOverlayWindow().then(() => setOverlayOpen(false));
      // 045c レビュー: 猶予中に表示 OFF されたら反映要求ごと取り消す（hideObs の後に enableObs が飛ぶのを防ぐ）。
      // 自動反映の ON/OFF に関わらず取り消してよい（OFF ならそもそも仕掛かっていない）。
      clearObsEnableTimer("comments");
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
    clearObsEnableTimer("pinned");
    if (next) {
      // 窓が OBS の「ウィンドウ一覧」に載るまでの猶予を置いてから追加を要求する（044a と同じ理由・同じ値）。
      scheduleObsAutoAdd("pinned");
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

  // 061k: ステージ窓（label `stage-overlay`）ぶん。⚠ 理由は上と完全に同じ（046d レビュー）——
  // 設定 ON ／ 窓なしで走らせると、キャプチャ対象未設定の空ソース「StreamDock ステージ演出」が
  // OBS に残る（ユーザーが手で消すまで消えない）。
  // ⚠⚠ **コーナー側と独立に判定すること**（片方だけ開いている、が通常の状態）。
  const requestStageObsAutoAddIfOpen = () => {
    void isStageOverlayOpen().then((open) => {
      if (open) requestObsAutoAdd("stage");
    });
  };

  /**
   * 061a: **エフェクト窓の OBS 自動反映を、この窓が代行する。**
   *
   * ⚠⚠ **なぜ設定は main 窓にあるのに送出はここなのか**（061a 実装で判明した構造上の制約）:
   * `obs-enable` を送れるのは WS ハンドル（`streamRef`）を持つこの窓だけ。一方 `obs-effects` 画面は
   * main 窓にある（親 061 の決定＝061c/061d のファイル取り込みが `default.json` の `dialog:allow-open` を
   * 要るため）。main 窓からも WS を張る案は採らなかった（`get_comment_stream_port` が null の間
   * **毎秒 invoke が永久ループ**し、`onComments` 必須なので**第三者のコメント本文が main 窓へ流れ込む**
   * ＝§9 の後退）。詳細は `ObsEffectsScreen` の JSDoc。
   *
   * ⚠⚠ **061b で前提が 1 つ変わった**（この effect 自体は無改変）: 当初の根拠には
   * 「sidecar のライフサイクルもこの窓に紐づいている」も含まれていたが、061b で **sidecar は
   * 「コメビュ窓 or エフェクト窓のどちらかが生きている間」生存する**ようになった（`SIDECAR_CONSUMER_LABELS`）。
   * さらにエフェクト窓は自前の WS ハンドルを持つので、**技術的には `obs-enable("effects")` を自分で送れる**。
   * それでも所有者をここに残しているのは、①`obs.state`（added/reused/failed）の受け皿（ツールバーと
   * 設定カード）がこの窓にあり、移すと**結果表示が完全に消える** ②045c の規律（設定を立てるだけ／契機は表示 ON／
   * **猶予タイマーの取り消し**）をエフェクト窓側に再実装することになる、の 2 点で 061b のスコープを超えるため。
   * **再修正トリガー＝所有者を移す別タスクに着手するとき**（そのときは 061a の宿題 (A)(B)(C) とまとめて）。
   *
   * ⚠ **残るねじれ**: 061b 以降「**エフェクトは出るが、OBS への自動追加はコメビュ窓が要る**」。
   * `ObsEffectsScreen` の前提案内はこの非対称をそのまま書いてある（「エフェクトも表示されません」は
   * 偽になったので削除済み）。
   *
   * ⚠ 伝達は 046a/046b と同じ**二段構え**にしてある:
   *   - **保証ベースライン**＝下の**接続確立時 reconcile**（`streamConnected` が true になった 1 回）。
   *     `storage` が届かなくても、コメビュ窓を開き直せば必ず反映される。
   *     ⚠⚠ **061e(5) で契機を「マウント時」から「WS 接続確立時」へ移した**（実機で発見した Bug-1）。
   *     マウント時点では sidecar WS がまだ OPEN でなく、`send` が**黙って捨てる**ため
   *     **保証ベースラインが保証になっていなかった**（詳細は下の effect のコメント）。
   *   - **即時反映**＝`storage` 購読（**ベストエフォート**。別 webview 間の伝播はプラットフォーム依存）。
   * ⚠ **コメビュ窓が閉じている間は `obs-enable` を誰も送れない**（＝OBS への自動追加だけが止まる。
   * エフェクトの表示自体は 061b で独立した）。この事実は `ObsEffectsScreen` の前提ステータスと
   * 案内で明示してある（黙って何も起きない状態を作らない）。
   *
   * ⚠ 045c の規律をそのまま踏襲する:
   *   - 自動反映トグルは**設定を立てるだけ**（main 窓に WS が無いので構造として保証されている）
   *   - **反映の契機は表示 ON**（＝`EFFECT_OVERLAY_ENABLED_KEY` が true になったとき）
   *   - 表示 OFF で `obsState` を idle へ戻す
   *     ⚠ **061e(1) で「自動反映 OFF」側でも戻すようにした**（045c の不変条件を両側で成立させる）。
   *     ⚠ ただし `obsState` は 3 種別で 1 本なので、**他種別の連携がすべて OFF のときだけ**倒す
   *     （理由は下の分岐のコメント＝061e 穴 1）。
   *   - ⚠ **猶予タイマーは必ず取り消す**（表示 OFF・自動反映 OFF の両方で）
   *
   * ⚠ **`disableObs()` は呼ばない。** あれは kind を取らず sidecar の状態を丸ごと idle にするので、
   * comments / pinned の連携を巻き添えにする。effects の OFF は `hideObs("effects")` だけで足りる。
   *
   * ⚠ localStorage を毎回**読み直す**（state にミラーしない）。この 2 つの設定の持ち主は main 窓なので、
   * state に写すと「main 窓で変えたのに古い値で判断する」形が作れてしまう。
   */
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      // clear() 時は e.key === null で来るため、その場合は両方を評価する。
      // ⚠ 061a レビュー（Q-4・修正不要）: `clear()` では**表示 OFF 側の後始末（hideObs／obsState を idle）に
      // 到達しない**。自動反映キーも同時に消えて `loadEffectObsAutoAdd()` が false になり、
      // 下の `if (loadEffectObsAutoAdd())` で弾かれるため（＝OBS 側のソースは表示されたまま残る）。
      // これは意図どおり: `clear()` は「設定そのものが無かったことになる」操作で、**送り先の意図が消えている**のに
      // OBS を触りに行く方が筋が悪い（ユーザーが OBS 側で消せる／次の表示 ON で整合する）。
      // なお `clear()` を呼ぶコードは本アプリに無く、DevTools 経由でしか到達しない。
      // **再修正トリガー**＝設定リセット機能を UI に足すときは、この分岐ではなくその機能側で
      // 明示的に `hideObs` を送ること（`clear()` に副作用を持たせない）。
      // ⚠⚠ **ステージ窓ぶんの分岐**（061k 判断 6・10）。
      // ⚠⚠ **064d でこれが唯一の出力窓になった**——コーナー窓（`"effects"`）は
      //   取り込んだテンプレート専用だったので、取り込み機能ごと廃止した。
      // ⚠⚠ **064d で `STAGE_OVERLAY_ENABLED_KEY` の意味が変わった**——
      //   旧「stage 出力の条件が 1 件以上あるか」→ 新「**いま配信イベントでステージ窓を使っているか**」。
      //   書き手は `ObsEffectsScreen` の開始／終了ハンドラ 1 か所（あちらの JSDoc が正）。
      // ⚠ `clear()`（`e.key === null`）では OBS を触りに行かない（061a Q-4 の受容）。
      // ⚠⚠⚠ **064e: `loadEffectObsAutoAdd()` のゲートを外した（＝既定 ON）。**
      //   あのトグルは「ステージ窓を OBS へ自動追加するか」だけを決めていたが、
      //   ⚠ **ステージ窓が開く契機は 064d 以降「配信イベントの開始」だけ**であり、
      //   その開始こそがユーザーの明示操作である。⇒ **明示操作が 2 段（トグル＋開始）から
      //   1 段（開始）になった**＝ `docs/security.md` §1 の 044a 例外に対する姿勢変更で、
      //   **§1 に 064e 追補を書いてある**（依頼者の指示＝「OBS に自動で反映はデフォルト機能にします」）。
      //   ⚠ 044a の comments / pinned 側のトグル（`OBS_AUTO_ADD_KEY`）は**無改変**。
      if (e.key === STAGE_OVERLAY_ENABLED_KEY || e.key === null) {
        if (loadStageOverlayEnabled()) {
          scheduleObsAutoAdd("stage");
        } else {
          clearObsEnableTimer("stage");
          // ⚠⚠⚠ **064e: `e.key !== null`（＝`clear()` ではない）を明示的に足した。**
          //   これは新しい規律ではなく、**消したゲートが偶然果たしていた役割の埋め合わせ**である
          //   ——旧コードは `loadEffectObsAutoAdd()` が `clear()` で false になることに頼って
          //   ここへ到達しない形になっており、061a レビュー Q-4 はそれを「修正不要」と受容していた
          //   （上のコメント）。⚠ **ゲートを外しただけだと `clear()` が OBS へ `hide` を送り始める**
          //   ＝「`clear()` に副作用を持たせない」という Q-4 の判断を黙って破ることになる。
          //   ⚠ **タイマーの取り消しは `clear()` でも行う**（あちらはこのアプリ内の後始末で、
          //   OBS へは何も送らない＝Q-4 の対象外）。
          if (e.key !== null) {
            requestObsHide("stage");
            // ⚠ `obsState` は 4 種別で 1 本のまま（061e Q-5 の受容の範囲が 3 → 4 へ広がった）。
            setObsState("idle");
          } else if (!loadObsAutoAdd()) {
            // ⚠⚠ **`clear()` のときの後始末**（064e で削除した `EFFECT_OBS_AUTO_ADD_KEY` 分岐から移設）。
            //   ⚠ **OBS へは何も送らない**（Q-4）が、共有の赤字だけは畳んでよい。
            //   ⚠⚠ **`!loadObsAutoAdd()` で狭めているのは 061e 穴 1 の結論**——`obsState` は
            //   comments / pinned / stage の共有なので、無条件に倒すと**他種別の失敗の赤字まで
            //   巻き添えで消える**（「失敗が黙って出ない」を自分で 1 本作ることになる）。
            setObsState("idle");
          }
        }
      }
      // ⚠⚠ 064a: main 窓からの依頼 2 種（一覧の取り直し／1 回鳴らす）。
      //   ⚠ **`e.key === null`（`clear()`）では動かさない**——`clear()` は「全部消す」であって
      //   「OBS を触れ」ではない（061a Q-4 の受容と同じ姿勢）。
      if (e.key === OBS_SOURCE_LIST_REQUEST_KEY && e.newValue !== null) {
        requestObsSourceListRefresh();
      }
      if (e.key === OBS_SOURCE_TEST_FIRE_KEY && e.newValue !== null) {
        const fire = parseObsSourceTestFire(e.newValue);
        // ⚠ 壊れた値は**何もしない**（黙って落とすのが正しい＝押し直せばよい）。
        if (fire !== null) requestObsSourceFire(fire.sourceName, fire.durationMs);
      }
      // ⚠⚠⚠ **064e: `EFFECT_OBS_AUTO_ADD_KEY` の分岐（67 行）を丸ごと削除した。**
      //
      // あの分岐は「main 窓で自動反映トグルが切り替わった」ことに反応するためのもので、
      // **064e でトグルごと消えた（＝既定 ON）**ので、**発火する契機が 1 つも無くなった**。
      // ⚠ 消えた 2 つの経路と、その受け皿:
      //   - **ON にした瞬間の即時反映**（`requestStageObsAutoAddIfOpen`）…
      //     ⇒ 開始時は上の `STAGE_OVERLAY_ENABLED_KEY` 分岐が、既に開いている窓は
      //        下の **WS 接続時 reconcile** が拾う（どちらも 064e で無条件になった）。
      //   - **OFF にした瞬間の後始末**（`clearObsEnableTimer` ／ 共有 `obsState` を idle へ）…
      //     ⇒ 「OFF にする」という操作が存在しない。⚠ **`clear()` ぶんの後始末だけは
      //        上の `STAGE_OVERLAY_ENABLED_KEY` 分岐へ移してある**（あちらも `e.key === null` で入る）。
      // ⚠⚠ **061e 穴 1 の結論（共有 `obsState` を無条件に idle へ倒さない＝他種別の赤字を
      //   巻き添えにしない）は、移した先でも `!loadObsAutoAdd()` として保っている。**
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("storage", onStorage);
    };
    // ⚠ **マウント時 1 回だけ**張る（購読を張り直すと購読が多重化する）。参照している
    // ヘルパはレンダーごとに作り直されるが、可変の値は ref（`streamRef` / `obsConfigRef` /
    // `streamConnectedRef` / `obsEnableTimersRef`）と localStorage 直読みからしか取らないので stale にならない。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * ⚠⚠ 061e(5): **エフェクト連携の「保証ベースライン」reconcile**（上の `storage` 購読から切り出したもの）。
   *
   * **実機確認で見つかった Bug-1 の修正。** 061a はこれを**マウント時**に走らせていたが、その時点では
   * sidecar への WS がまだ OPEN でなく、`commentStream.ts` の `send` は **OPEN 以外を黙って捨てる**。
   * よって `enableObs("effects")` は誰にも届かず、しかし直前に `requestObsAutoAdd` が
   * `setObsState("connecting")` を立てているので、**`obsState` が `connecting` のまま永久に固着**していた。
   * ツールバーの赤字は `failed` のときだけ出るので**何も出ず**、設定カードには「OBSに接続しています…」が
   * 残り続ける＝ **061e が直そうとした「結果が読み取れない」が、最も起きやすい経路で残っていた。**
   * ⚠ 061a が「`storage` が届かなくても開き直せば必ず反映される」と書いていた**保証が成立していなかった**。
   * ⚠ 実機で 2 回再現。ユニットテストが緑だったのは `obs.state` を手で注入していたためで、
   * 「failed が来ない」経路そのものを再現していなかった（061d-1 に続く「テスト緑≠実機で正しい」の 2 例目）。
   *
   * ⇒ **契機を「マウント」から「WS 接続確立」へ移す。** `streamConnected` は `onConnectionChange` 由来で、
   * その呼び出し元は `commentStream.ts` の `socket.onopen` / `socket.onclose` なので、
   * **「`send` が通るか」と厳密に等価**。
   *
   * ⚠ **走らせるのは「最初に接続できた 1 回」だけ**（`effectReconcileDoneRef`）。再接続のたびに走らせると
   * 045c の「**反映の契機は表示 ON**」を越えて、配信中に sidecar が落ちて復帰するたび `enableObs` が飛ぶ。
   * 061a の意味論（**窓を開いたら 1 回**）をそのまま接続タイミングへ移すのが目的で、増やすのが目的ではない。
   * **再修正トリガー**＝実機で「再接続後に OBS の反映が落ちたままになる」が確認されたとき
   *（そのときは ref を落として毎回走らせるのではなく、**切断を検知して idle へ倒す**方を先に検討すること）。
   *
   * ⚠ 一度も接続できない窓では走らない＝**何も起きない**。ただし `requestObsAutoAdd` を呼ばないので
   * `connecting` 固着にはならず（idle のまま）、sidecar 未接続そのものは既存の接続状態表示が伝える。
   */
  const effectReconcileDoneRef = useRef(false);
  useEffect(() => {
    if (!streamConnected || effectReconcileDoneRef.current) return;
    effectReconcileDoneRef.current = true;
    // 猶予は要らない（窓は既に開いていて OBS のウィンドウ一覧に載っているはず）。
    // ⚠ 064d: 対象はステージ窓 1 つだけ（コーナー窓は取り込み機能ごと廃止）。
    // ⚠⚠ 064e: `loadEffectObsAutoAdd()` のゲートを外した（＝既定 ON）。
    //   ⚠ **`loadStageOverlayEnabled()` は残す**——あれは「いま配信イベントを開催しているか」で、
    //   **これが唯一の明示操作の痕跡**である（064d で意味を移した）。ここを外すと
    //   **開催していないのに OBS へ繋ぐ**ことになり、§1 の 044a 例外を本当に破る。
    if (loadStageOverlayEnabled()) requestStageObsAutoAddIfOpen();
    // ⚠ `requestStageObsAutoAddIfOpen` はレンダーごとに作り直されるが、読むのは ref と localStorage だけ。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamConnected]);

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
      // ⚠ 061a: このトグルが束ねるのは comments / pinned の 2 種別だけ（effects は専用キー＝
      // `EFFECT_OBS_AUTO_ADD_KEY` で main 窓が持つ）。**effects の仕掛かりまで巻き添えで消さない。**
      clearObsEnableTimer("comments");
      clearObsEnableTimer("pinned");
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
          soundCommentEnabled={soundCommentEnabled}
          onSoundCommentEnabledChange={setSoundCommentEnabled}
          onPreviewCommentSound={handlePreviewCommentSound}
          soundMonetaryEnabled={soundMonetaryEnabled}
          onSoundMonetaryEnabledChange={setSoundMonetaryEnabled}
          onPreviewMonetarySound={handlePreviewMonetarySound}
          soundPreviewState={soundPreviewState}
          overlayFont={overlayFont}
          onOverlayFontChange={setOverlayFont}
          overlayShowSource={overlayShowSource}
          onOverlayShowSourceChange={setOverlayShowSource}
          onRequestThemeImport={requestThemeImport}
          onRequestThemeFont={requestThemeFont}
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
                    className={btnStyles.btn}
                    onClick={handleTwitchConnect}
                    disabled={!streamConnected || linked}
                  >
                    {linked ? "連携済み" : "連携"}
                  </button>
                  <button
                    type="button"
                    className={btnStyles.btn}
                    onClick={handleStartSession}
                    disabled={
                      !streamConnected || !linked || channel.trim() === ""
                    }
                  >
                    コメント取得開始
                  </button>
                  <button
                    type="button"
                    className={btnStyles.btnGhost}
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
                    className={btnStyles.btn}
                    onClick={handleYouTubeConnect}
                    disabled={!streamConnected || youtubeLinked}
                  >
                    {youtubeLinked ? "連携済み" : "連携"}
                  </button>
                  <button
                    type="button"
                    className={btnStyles.btn}
                    onClick={handleYouTubeStartSession}
                    disabled={!streamConnected || !youtubeLinked}
                  >
                    コメント取得開始
                  </button>
                  <button
                    type="button"
                    className={btnStyles.btnGhost}
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
                  切り出して両方から使う）。
                  ⚠⚠ **061e(2): その `obsAutoAdd &&` を外した。** 045c の再修正トリガーが 061a で発火していた——
                  `obsAutoAdd` が束ねるのは **comments / pinned の 2 種別だけ**で、effects の連携は main 窓が持つ
                  別キー（`EFFECT_OBS_AUTO_ADD_KEY`）。そのため「コメント側 OFF ／ エフェクト側 ON」の構成では
                  **エフェクトの OBS 追加に失敗しても赤字が 1 文字も出ない**（＝黙って反映されない）。
                  ⚠ ゲートの代わりになるのは **061e(1) で両側に揃えた不変条件**（連携 OFF なら必ず idle へ倒す）。
                  ⚠ **`obsAutoAdd || effectObsAutoAdd` の OR にはしない**——そのためには main 窓が持つ設定を
                  この窓の state へミラーする必要があり、`storage` の窓跨ぎ伝播（**ベストエフォート**）に
                  **表示の可否**を委ねることになる＝伝播が届かないと失敗が黙って出ない（いま直している症状そのもの）。
                  不変条件で担保するほうが、state を増やさずに強い。
                  ⚠ **文言は変えない**（どの種別で失敗してもユーザーが取る行動は同じ＝OBS が起動しているか確認する。
                  059b の通知音インジケータが「失敗の中身で文言を変えない」と決めたのと同じ理由）。
                  ⚠⚠ **これでも「どの種別が失敗したか」は出せない**（`obs.state` の payload は `{ state, reason? }` で
                  `overlay` を運ばない＝`obsState` は 3 種別で 1 本）。さらに sidecar は `hide()` / `disable()` の
                  たびに `idle` を broadcast し返すので、**ある種別の OFF が別種別の failed を消す**のは
                  frontend では塞げない（061e 穴 1 の結論。唯一 frontend で制御できる経路＝エフェクトの
                  連携 OFF だけは上のエフェクト連携 effect で狭めてある）。
                  **再修正トリガーは 046d / 061a Q-2 のものをそのまま引き継ぐ**＝「**どちらのオーバーレイが OBS に
                  出ていないか分からない**」という問い合わせが実際に出たら、`obs.state` に `overlay` を足し
                  `obsState` を `Record<ObsOverlayKind, ObsState>` へ広げる（sidecar・commentStream・この窓・
                  SettingsView の 4 層に同時に手が入るので、046d の分とまとめて 1 回で済ませる）。
                  ⚠⚠ **061e レビュー Q-4: このゲート撤去で 061a Q-2 のトリガー①は「引き継いだ」だけでなく
                  発火しやすくなった。** トリガー①は「実機で**コメビュを開くたびに OBS の赤字が出る**が確認された」
                  だが、061e 前はコメント側連携が OFF ならこの症状はゲートで見えなかった。いまは
                  **エフェクト連携 ON ＋ OBS 未起動なら、コメビュ窓を開くたび**（マウント時 reconcile →
                  `enableObs("effects")` → failed）に**必ず**赤字が出る。⚠ これは 061e の目的（失敗の可視化）
                  そのものなので**赤字を隠す方向では直さない**——発火したときの答えは wire 変更（種別ごとの
                  state ＋ 種別つきの文言）であって、ゲートを戻すことではない。 */}
              {obsState === "failed" && (
                <span
                  className={styles.toolbarError}
                  role="status"
                  title="OBSに接続できませんでした。OBSが起動しているか確認してください。"
                >
                  OBSに接続できませんでした
                </span>
              )}
              {/* 059a: 通知音が鳴らせなかったことの**継続表示**（058a が 059 へ投げた宿題）。
                  ⚠⚠ これが無いと、配信中にデバイスを抜いたとき**黙って鳴らなくなる**。058a は
                  fail-closed（見つからなければ鳴らさない）で、かつホットプラグ監視を持たない＝設定画面を
                  開いた時にしか突き合わせないため、ここが唯一の気付ける経路になる。
                  「鳴らないほうがマシ」は「鳴らないことに気付けなくてよい」ではない。
                  置き場所とクラスは 045c の OBS エラーと**同じ**にした。性質が同じ（ユーザー操作なしに起きた
                  失敗を配信中の画面へ出す）ためで、設定カード内の .errorText（＝押したボタンの結果）とは別物。
                  同時に 2 つ並びうるが .toolbarActions は flex-wrap: wrap なので折り返して収まる（CSS 差分ゼロ）。
                  ⚠ ゲートに ON/OFF を噛ませるのは 045c の `obsAutoAdd &&` と同じ考え方
                  ——OFF のときは鳴らないのが正常なので赤字を出さない。
                  ⚠ 059b: ゲートは **2 音の OR**（どちらか一方でも ON なら出す）。片方だけ ON の状態で
                  デバイスを抜いたときに黙って鳴らなくなるのを防ぐ＝この indicator の存在理由そのもの。
                  失敗の中身（どちらの音か）で文言は変えない——ユーザーが取る行動が同じだから。
                  ⚠ 消えるのは①次の再生が成功したとき②デバイスを選び直したとき③どちらかの試聴が
                  成功したとき④OFF にしたとき（この式で自動）。⚠ 059c 以前はここに「⑤058a のテスト再生が
                  成功したとき」があったが、テスト再生ボタンの削除に伴い③が唯一の能動的な復旧導線になった。
                  **時間経過では消さない**（気付かせるのが目的なので、放っておいて消えたら意味がない）。
                  ⚠ §9: デバイス名・デバイス ID・例外の中身を出さない（文言は固定文字列のみ）。
                  ⚠ title で**原因を断定しない**（レビュー S-2）。失敗は AUDIO_DEVICE_UNAVAILABLE だけでなく
                  AUDIO_PLAYBACK_FAILED（デバイスは在るがストリームが開けない）でも起きるが、
                  エラーコードで分岐すると §9 の面（例外の中身に触れる経路）が増えるので、
                  **ユーザーが取れる行動**（選び直す・再読み込みする）だけを書く。
                  ⚠ **この indicator はコメント画面にしか出ない**（設定ビュー・視聴者ビューはツールバーごと
                  差し替わる）。045c の OBS エラーと同じ割り切りで、設定を開いている間は「試聴」で能動的に
                  確認できるため許容している。**再修正トリガー＝「設定を開いたまま配信していて気付けなかった」
                  が実際に起きたとき**（そのときは indicator をビュー共通の場所へ出す設計に変える）。 */}
              {(soundCommentEnabled || soundMonetaryEnabled) &&
                notificationSoundFailed && (
                  <span
                    className={styles.toolbarError}
                    role="status"
                    title="通知音を鳴らせませんでした。設定の「通知音」でデバイスを選び直すか、再読み込みしてください。"
                  >
                    通知音を再生できません
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
                className={btnStyles.btn}
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
