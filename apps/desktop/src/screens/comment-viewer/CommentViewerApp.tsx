import { useCallback, useEffect, useRef, useState } from "react";
import type { CommentViewDto } from "../../features/comment-viewer/types";
import {
  createTtsQueue,
  type TtsQueue,
} from "../../features/comment-viewer/ttsQueue";
import {
  checkEngineRunning,
  fetchSpeakers,
  type VoicevoxSpeaker,
} from "../../features/comment-viewer/voicevox";
import { launchVoicevoxEngine } from "../../features/comment-viewer/voicevoxApi";
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
} from "../../features/comment-viewer/ttsPrefs";
import {
  loadSpeakerId,
  saveSpeakerId,
} from "../../features/comment-viewer/speakerStorage";
import { mergeComments } from "../../features/comment-viewer/mergeComments";
import {
  openCommentOverlayWindow,
  closeCommentOverlayWindow,
} from "../../features/comment-viewer/windowApi";
import { CommentList } from "./CommentList";
import { SettingsView } from "./SettingsView";
import { StatusIndicator } from "./StatusIndicator";
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

export function CommentViewerApp() {
  const [comments, setComments] = useState<CommentViewDto[]>([]);
  // 033b: 表示モード（本体コメント / 設定）。歯車ボタンで settings へ、戻るボタンで comment へ切替。
  // 切替は描画のみで、接続 state・WS・TTS は本コンポーネントに残るため、設定表示中もコメント受信・蓄積は継続し
  // （WS は窓内 1 本のまま）、本体へ戻ると全件が並ぶ。
  const [view, setView] = useState<"comment" | "settings">("comment");
  // TTS キュー（AudioContext を 1 つ所有）。マウントで生成し、アンマウントで dispose する。
  const ttsRef = useRef<TtsQueue | null>(null);
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
  // 033d: TTS キューは合成直前に getter で最新の選択話者を読む（キューを作り直さない）。state の stale closure を
  // 避けるため ref に同期し、createTtsQueue の getSpeakerId から参照する。
  const selectedSpeakerIdRef = useRef(selectedSpeakerId);
  // 起動中フラグ（state ではなく ref）。launchEngine 先頭で最初の await より前に立て、同一 tick/並行の
  // 複数契機が来ても spawn を 1 回に抑える同期ガード（launchRequested は起動成功後の窓を守る別レイヤ）。
  const launchInFlightRef = useRef(false);

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

  useEffect(() => {
    saveChannel(channel);
  }, [channel]);

  // 033c: トグル状態を localStorage に永続化する（channel と同型）。再オープン・再起動で復元される。
  useEffect(() => {
    saveTtsEnabled(ttsEnabled);
  }, [ttsEnabled]);
  useEffect(() => {
    saveVoicevoxAutolink(voicevoxAutolink);
  }, [voicevoxAutolink]);
  // 033d: 選択話者を localStorage に永続化する（再オープン・再起動で復元）。
  useEffect(() => {
    saveSpeakerId(selectedSpeakerId);
  }, [selectedSpeakerId]);

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

  useEffect(() => {
    // 033d: 合成直前に選択話者（style id）を ref から読む getter を渡す。話者変更でキューを作り直さない。
    const queue = createTtsQueue({
      getSpeakerId: () => selectedSpeakerIdRef.current,
    });
    ttsRef.current = queue;
    return () => {
      queue.dispose();
      ttsRef.current = null;
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
  const enqueueForSpeech = useCallback((added: CommentViewDto[]) => {
    if (!ttsEnabledRef.current) return;
    const tts = ttsRef.current;
    if (!tts || added.length === 0) return;
    void tts.resume();
    added.forEach((c) => tts.enqueue(c));
  }, []);

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
    });
    streamRef.current = handle;
    return () => {
      handle.disconnect();
      streamRef.current = null;
    };
  }, [enqueueForSpeech]);

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

  // 033f: OBS 用の背景透過オーバーレイ窓をワンクリックで開く。Rust が透過・フレームレス・最背面（always_on_bottom）・
  // 非フォーカスで生成する（open_comment_overlay_window。追修正①で最前面→最背面に変更）。オーバーレイは表示専用で
  // loopback WS の読み取り専用接続のみ・sidecar には関与しない（起動/停止契機はコメビュ窓に集約のまま＝no-orphan kill 不変）。
  const handleOpenOverlay = () => {
    void openCommentOverlayWindow();
  };

  // 033f 追修正: OBS 用オーバーレイ窓を閉じる。最背面・非フォーカスで開き Cmd+W で掴みにくいため本体から明示的に
  // 閉じられるようにする。窓が無ければ Rust 側 no-op（冪等）。sidecar には関与しない（no-orphan kill 不変）。
  const handleCloseOverlay = () => {
    void closeCommentOverlayWindow();
  };

  // 033d: クレジット表記に使う選択話者名。一覧から選択 style id を含む話者名を引く。ENGINE 未起動で一覧が
  // 未取得なら null（creditNotice が話者名を省いた汎用文にフォールバックする）。
  const selectedSpeakerName =
    speakers.find((sp) => sp.styles.some((st) => st.id === selectedSpeakerId))
      ?.name ?? null;

  return (
    <div className={styles.root}>
      {view === "settings" ? (
        // 033b: 接続 UI（Twitch/YouTube の接続・取得開始/停止・Device Code 提示）は設定ビューへ集約。
        // 既存 state・ハンドラを props で渡すだけで、SettingsView は WS を持たない（窓内 1 本のまま）。
        <SettingsView
          onBack={() => setView("comment")}
          streamConnected={streamConnected}
          linked={linked}
          sessionState={sessionState}
          sessionReason={sessionReason}
          deviceCode={deviceCode}
          channel={channel}
          onChannelChange={setChannel}
          onTwitchConnect={handleTwitchConnect}
          onStartSession={handleStartSession}
          onStopSession={handleStopSession}
          youtubeLinked={youtubeLinked}
          youtubeSessionState={youtubeSessionState}
          youtubeSessionReason={youtubeSessionReason}
          onYouTubeConnect={handleYouTubeConnect}
          onYouTubeStartSession={handleYouTubeStartSession}
          onYouTubeStopSession={handleYouTubeStopSession}
          voicevoxAutolink={voicevoxAutolink}
          onVoicevoxAutolinkChange={setVoicevoxAutolink}
          speakers={speakers}
          selectedSpeakerId={selectedSpeakerId}
          onSpeakerIdChange={setSelectedSpeakerId}
        />
      ) : (
        <>
          {/* 033b/033f: 本体上部の小さなツールバー。左に接続状態インジケータ（接続ボタンの代わり）、
              右に OBS オーバーレイを開くボタン＋設定への歯車。 */}
          <div className={styles.toolbar}>
            <StatusIndicator
              twitchSessionState={sessionState}
              youtubeSessionState={youtubeSessionState}
            />
            <div className={styles.toolbarActions}>
              <button
                type="button"
                className={styles.btnGhost}
                onClick={handleOpenOverlay}
                title="OBS 用の背景透過オーバーレイ窓を最背面で開きます"
              >
                OBS オーバーレイ
              </button>
              {/* 修正不要（据え置き）: ラベルは「閉じる」の短縮のまま。意図＝ツールバー幅が狭く、直前の「OBS オーバーレイ」
                  ボタンと隣接する文脈＋title 属性（下記）でオーバーレイ窓が対象と読めるため。再修正トリガー＝「コメビュ本体を
                  閉じる」と誤解する報告が出たら「オーバーレイを閉じる」等に改名する。 */}
              <button
                type="button"
                className={styles.btnGhost}
                onClick={handleCloseOverlay}
                title="OBS 用オーバーレイ窓を閉じます"
              >
                閉じる
              </button>
              <button
                type="button"
                className={styles.iconBtn}
                onClick={() => setView("settings")}
                title="設定"
                aria-label="設定"
              >
                ⚙
              </button>
            </div>
          </div>
          {/* 033f: OBS 取り込みの案内（ボタン近傍の小さな注記）。表示のみで外部通信なし。オーバーレイは最背面で開くため
              配信者の画面には前面表示されず、OBS のウィンドウキャプチャにだけ映る（033f 追修正）。 */}
          <p className={styles.overlayHint}>
            OBS の「ウィンドウキャプチャ」で「StreamDock コメントオーバーレイ」を選ぶとコメントを重ねられます（背景は透過）。オーバーレイは常に最背面で開くので、配信者の画面には前面表示されません。閉じるときは「閉じる」を押してください。
          </p>

          {/* 033c: 読み上げ ON/OFF は配信中に頻繁に切り替えるため本体コメントビュー上部に置く（設定ビューではなく
              ここに置くほうが UX が良い）。ON のときだけコメントを読み上げ、ON のときだけクレジット表記をトグル
              直下に出す。 */}
          <div className={styles.voicevoxBar}>
            <ToggleSwitch
              label="VOICEVOX読み上げ"
              checked={ttsEnabled}
              onChange={handleTtsEnabledChange}
            />
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
          </div>

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

          <CommentList comments={comments} />
        </>
      )}
    </div>
  );
}
