import { useCallback, useEffect, useRef, useState } from "react";
import type { CommentViewDto } from "../../features/comment-viewer/types";
import { createTtsQueue, type TtsQueue } from "../../features/comment-viewer/ttsQueue";
import { checkEngineRunning } from "../../features/comment-viewer/voicevox";
import { launchVoicevoxEngine } from "../../features/comment-viewer/voicevoxApi";
import {
  connectCommentStream,
  type CommentStreamHandle,
  type DeviceCodePrompt,
} from "../../features/comment-viewer/commentStream";
import { loadChannel, saveChannel } from "../../features/comment-viewer/channelStorage";
import styles from "./CommentViewerApp.module.css";

/**
 * 032c-a/032c-c: 内蔵コメントビューア（別ウィンドウ label `comment-viewer`）の描画本体。
 *
 * frontend 専用モック `CommentViewDto` を最小描画（append ＋ id 重複排除 ＋ 上限クランプ）しつつ、
 * 032c-c で **VOICEVOX ローカル合成読み上げ（Web Audio 直列 TTS キュー）** を配線する。新規追加コメントは
 * `mergeComments` の戻り値 `added` を単一注入点として TTS キューへ enqueue する。実データ取得
 * （Twitch/YouTube・Node sidecar・WebSocket）は 032c-b/-d で配線する。ネイティブタイトルバー
 * （capability は `core:default` のみ）で動くため、メイン画面のカスタム Header は再利用しない。
 */

/** 表示上限（超過分は古い方から捨てる＝末尾 MAX 件を保持）。 */
const MAX_COMMENTS = 200;

/** ENGINE 稼働の再確認間隔（ミリ秒）。ループバック GET /version の軽いポーリング。 */
const ENGINE_POLL_INTERVAL_MS = 5000;

/**
 * 起動要求後にボタンを disabled 維持する猶予（ミリ秒）。多重 spawn 防止のため起動成功後もこの間は
 * 押せないようにする。VOICEVOX の初回起動はモデル読込で時間がかかるため長め。猶予内に稼働確認できれば
 * `engineRunning === true` 監視が先に解除する。猶予経過で自動解除し、起動が失敗した場合の永久 disabled を避ける。
 */
const LAUNCH_GRACE_MS = 30000;

/**
 * ずんだもんクレジット表記（VOICEVOX 利用規約に基づく必須表記）。032a の creditNotice を復元。
 * 表示のみで外部通信は発生しない（URL は静的テキスト）。
 */
const CREDIT_NOTICE =
  "ずんだもんの音声を使う配信・動画では「VOICEVOX:ずんだもん」のクレジット表記が必須です（VOICEVOX 利用規約 https://voicevox.hiroshiba.jp/term/ に準拠）。";

/** 初期表示のモック（Twitch/YouTube・通常/投げ銭を混在）。 */
const SEED_COMMENTS: CommentViewDto[] = [
  {
    id: "seed-1",
    source: "youtube",
    author: { id: "u-aoi", name: "あおいそら" },
    text: "配信お疲れさまです！今日も楽しみにしてました",
    publishedAt: "2026-07-15T12:00:00.000Z",
    eventType: "chat",
  },
  {
    id: "seed-2",
    source: "twitch",
    author: { id: "u-kuro", name: "くろねこ" },
    text: "この場面すごい",
    publishedAt: "2026-07-15T12:00:05.000Z",
    eventType: "chat",
  },
  {
    id: "seed-3",
    source: "youtube",
    author: { id: "u-momo", name: "ももか" },
    text: "スパチャで応援します！これからも頑張ってください",
    publishedAt: "2026-07-15T12:00:12.000Z",
    eventType: "superchat",
    monetaryAmount: "¥1,000",
  },
];

/** 配信元の表示ラベル。 */
const SOURCE_LABEL: Record<CommentViewDto["source"], string> = {
  twitch: "Twitch",
  youtube: "YouTube",
};

/** 配信元バッジの色分けクラス。 */
const SOURCE_CLASS: Record<CommentViewDto["source"], string> = {
  twitch: styles.srcTwitch,
  youtube: styles.srcYoutube,
};

/** 取得セッション状態の日本語ラベル（sidecar の session.state に対応）。 */
const SESSION_STATE_LABEL: Record<string, string> = {
  idle: "待機",
  connecting: "接続中",
  connected: "取得中",
  failed: "失敗",
};

/**
 * 既存リストに incoming を追加する。id 重複は排除し、上限を超えたら古い方から捨てる。
 * 実データ配線（032c-b/-d）でも同じ「append ＋ 重複排除 ＋ クランプ」を使う想定。
 *
 * 戻り値の `next` は表示用の全体リスト（上限クランプ後）、`added` は**重複排除後に実際に追加された
 * 新規行**。`added` を TTS enqueue の単一注入点として使う（表示上限でクランプされても読み上げ対象に
 * 含めるため、クランプ前の追加分を返す）。
 */
function mergeComments(
  prev: CommentViewDto[],
  incoming: CommentViewDto[],
): { next: CommentViewDto[]; added: CommentViewDto[] } {
  const seen = new Set(prev.map((c) => c.id));
  const merged = [...prev];
  const added: CommentViewDto[] = [];
  for (const c of incoming) {
    if (seen.has(c.id)) continue; // id 重複排除
    seen.add(c.id);
    merged.push(c);
    added.push(c);
  }
  // 上限クランプ（新しい順に末尾 MAX 件を残す）。
  const next =
    merged.length > MAX_COMMENTS
      ? merged.slice(merged.length - MAX_COMMENTS)
      : merged;
  return { next, added };
}

/** モックコメントを 1 件生成する（連番 ID で安定・重複しない）。 */
function makeMock(seq: number): CommentViewDto {
  const source: CommentViewDto["source"] = seq % 2 === 0 ? "twitch" : "youtube";
  return {
    id: `mock-${seq}`,
    source,
    author: { id: `u-${seq}`, name: `視聴者${seq}` },
    text: `モックコメント #${seq}`,
    publishedAt: new Date().toISOString(),
    eventType: "chat",
  };
}

export function CommentViewerApp() {
  const [comments, setComments] = useState<CommentViewDto[]>(SEED_COMMENTS);
  // 連番の払い出しカウンタ（生成 ID を安定させ、重複を意図的に注入できるようにする）。
  const seqRef = useRef(1);
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
  const [youtubeSessionState, setYoutubeSessionState] = useState<string>("idle");
  const [youtubeSessionReason, setYoutubeSessionReason] = useState<
    string | null
  >(null);
  // 032c-b: チャンネル名は localStorage から復元し、変更のたびに保存する（窓を閉じても空欄化しない）。
  const [channel, setChannel] = useState(() => loadChannel());

  useEffect(() => {
    saveChannel(channel);
  }, [channel]);

  useEffect(() => {
    const queue = createTtsQueue();
    ttsRef.current = queue;
    return () => {
      queue.dispose();
      ttsRef.current = null;
    };
  }, []);

  // 新規追加コメントを読み上げキューへ積む単一注入点（addMock も実データハンドラ onComments もここを通す）。
  // ttsRef のみ参照する安定コールバック（useCallback []）にして、マウント専用の接続 effect の依存にしても
  // 再接続を起こさない＆ TDZ を避ける（onComments より前に定義する必要があるため上へ移動した）。
  // resume は「毎回呼んでよい（running なら no-op）」が、WKWebView の autoplay 制限で **suspended→running の
  // 遷移はユーザー操作起点でしか効かない**。実データ（非操作起点）で初回が鳴るよう、取得開始ボタン
  // （handleStartSession）で resume 済みにし、万一 suspended のままでも ttsQueue.pump 側のガードで
  // 無音ハングを防ぐ（該当 1 件はスキップ）。
  const enqueueForSpeech = useCallback((added: CommentViewDto[]) => {
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

  // 多重 spawn 抑止の保険: 起動要求後、猶予内に稼働確認できなければ（＝起動失敗などで ENGINE が現れない）
  // 自動でフラグを解除して再試行を許す（永久 disabled 回避）。稼働確認が先なら上の effect が解除する。
  useEffect(() => {
    if (!launchRequested) return;
    const id = window.setTimeout(() => setLaunchRequested(false), LAUNCH_GRACE_MS);
    return () => window.clearTimeout(id);
  }, [launchRequested]);

  // 登録済み VOICEVOX を管理付き spawn で起動する（未登録なら登録誘導文言を表示）。起動後は
  // /version ポーリングがバナーを自動で消す。
  const handleLaunch = async () => {
    setLaunching(true);
    setLaunchNotice(null);
    void ttsRef.current?.resume(); // ユーザー操作契機で resume しておく。
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
      setLaunching(false);
    }
  };

  // 暫定：固定文をキュー経由で読み上げる（手動検証用。id を毎回変えて連続テストできる）。
  // 撤去条件: 実データ配線（032c-b/-d）で実コメントの読み上げが検証できるようになったら、この
  // ボタン（下の toolbar の「読み上げテスト」）ごと削除する。
  const testSpeak = () => {
    enqueueForSpeech([
      {
        id: `test-${seqRef.current++}`,
        source: "youtube",
        author: { id: "u-test", name: "テスト" },
        text: "ずんだもんなのだ。テスト読み上げなのだ。",
        publishedAt: new Date().toISOString(),
        eventType: "chat",
      },
    ]);
  };

  const addMock = () => {
    const a = makeMock(seqRef.current++);
    const b = makeMock(seqRef.current++);
    // 既存の seed-1 を再投入して「重複排除」を実演する（追加されないのが正しい挙動）。
    const dup = SEED_COMMENTS[0];
    // 関数型 updater（`setComments(prev => …)`）ではなくスナップショット `comments` を使う理由:
    // enqueue 対象の `added` を setState の外へ取り出す必要があり、updater 内で副作用（enqueue）を持たせる
    // のは StrictMode の二重実行で重複 enqueue し得るため避ける。単発クリックのモック用途では stale の実害は
    // 無い（seqRef で id は常に一意）。再検討条件: 実データ配線（032c-b/-d）で本注入点を高頻度・並行で使う
    // 場合は、reducer 化するか `added` 抽出を updater 外の ref 経由にして stale を避ける。
    const { next, added } = mergeComments(comments, [a, b, dup]);
    setComments(next);
    enqueueForSpeech(added); // dup は added に入らず読み上げられない＝単一注入点が正しく機能する。
  };

  const clearAll = () => setComments([]);

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <h1 className={styles.title}>コメントビューア</h1>
        <span className={styles.count}>{comments.length} 件</span>
      </header>

      <div className={styles.toolbar}>
        <button type="button" className={styles.btn} onClick={addMock}>
          モックを追加
        </button>
        <button type="button" className={styles.btnGhost} onClick={clearAll}>
          クリア
        </button>
        <button type="button" className={styles.btn} onClick={testSpeak}>
          読み上げテスト
        </button>
        <span className={styles.note}>
          モック（手動確認用）。Twitch 実コメントは下の「Twitch に接続」から取得します。
        </span>
      </div>

      {/* 032c-b: Twitch 連携（Device Code ログイン → チャンネル指定で取得開始）。ユーザー明示操作でのみ発火。 */}
      <div className={styles.twitchPanel}>
        <div className={styles.twitchRow}>
          <button
            type="button"
            className={styles.btn}
            onClick={handleTwitchConnect}
            disabled={!streamConnected || linked}
          >
            {linked ? "接続済み" : "Twitch に接続"}
          </button>
          <input
            type="text"
            className={styles.input}
            placeholder="チャンネル名（例: shroud）"
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
          />
          <button
            type="button"
            className={styles.btn}
            onClick={handleStartSession}
            disabled={!streamConnected || !linked || channel.trim() === ""}
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
            onClick={handleYouTubeConnect}
            disabled={!streamConnected || youtubeLinked}
          >
            {youtubeLinked ? "YouTube 接続済み" : "YouTube に接続"}
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

      {engineRunning === false && (
        <div className={styles.engineBanner} role="alert">
          <span className={styles.engineBannerText}>
            VOICEVOX ENGINE が起動していません。読み上げには起動が必要です。
          </span>
          <button
            type="button"
            className={styles.btn}
            onClick={handleLaunch}
            disabled={launching || launchRequested}
          >
            {launching || launchRequested ? "起動中…" : "VOICEVOX を起動"}
          </button>
          {launchNotice && (
            <span className={styles.engineBannerNotice}>{launchNotice}</span>
          )}
        </div>
      )}

      <ol className={styles.list}>
        {comments.length === 0 ? (
          <li className={styles.empty}>コメントはまだありません</li>
        ) : (
          comments.map((c) => (
            <li key={c.id} className={styles.item}>
              <div className={styles.meta}>
                <span className={`${styles.badge} ${SOURCE_CLASS[c.source]}`}>
                  {SOURCE_LABEL[c.source]}
                </span>
                <span className={styles.author}>{c.author.name}</span>
                {c.monetaryAmount && (
                  <span className={styles.amount}>{c.monetaryAmount}</span>
                )}
              </div>
              <p className={styles.text}>{c.text}</p>
            </li>
          ))
        )}
      </ol>

      <section className={styles.credit}>
        <h2 className={styles.creditHeading}>クレジット表記のお願い（必須）</h2>
        <p className={styles.creditText}>{CREDIT_NOTICE}</p>
      </section>
    </div>
  );
}
