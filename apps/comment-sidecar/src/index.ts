// 032c-b コミット2: Twitch Device Code ログイン＋EventSub/Helix 取得＋viewer への配信（インターネット解禁）。
//  - 起動直後に **installHttpHostGuard()** で global fetch を allow-list ガードに置換（DI 配線より前）。
//  - reflect-metadata → tsyringe DI（env ピン留め config＋guarded ws runtime）。
//  - 単一双方向 WS: viewer→sidecar 制御（start-login / start-session / stop-session）、
//    sidecar→viewer（device_code / session.state / comments.append）。
//  - Device Code は polling 前に user_code / verification_uri を viewer へテキスト提示（open 廃止）。
//  - 取得コメントは正規化して comments.append で送るのみ（端末外へ出さない）。トークン/device_code は非ログ。
//  - no-orphan 保険（ppid 監視 self-exit）は維持。
import "reflect-metadata";
import { installHttpHostGuard } from "./host-guard.js";

// stdout は Rust への実ポート受け渡し（`COMMENT_SIDECAR_PORT=<port>` 1 行）専用にする。
// vendored コード（osareview 由来）は console.info/log を stdout に出すため、そのままだと
// ポート受け渡しの stdout プロトコルに運用ログが混線する（Rust 側は prefix 行スキャンで無害化
// しているが、プロトコル stdout に他出力を載せない方が堅い）。診断は stderr に集約する。
// トークン等は元々どの console にも載せていないため、寄せ先が stderr でも §9 は不変。
console.log = console.error;
console.info = console.error;
// allow-list ガードは DI/認証クライアント生成より前に有効化する。
installHttpHostGuard();

import { container } from "tsyringe";
import { COMMENT_DELIVERY_MESSAGE_TYPES } from "@comment-dock/shared";
import { convertCommentToViewDto } from "@comment-dock/comment-delivery";
import { WebSocketCommentOutputPort } from "../vendor/gateway/src/adapters/ws/websocket-comment.output-port.js";
import {
  createAuthClient,
  type Provider,
  type TokenSetPlain,
} from "./auth/index.js";
import {
  createTwitchPipeline,
  createYouTubePipeline,
  registerCommentFetcherDependencies,
  registerYouTubeDependencies,
  runTwitchPipeline,
  runYouTubePipeline,
  selfCheckStreamListProto,
  type Comment,
  type CommentOutputPort,
} from "./comment-fetcher/index.js";
import { toCanonicalComment } from "./wire.js";

const WS_HOST = "127.0.0.1";
const PREFERRED_PORT = 17331;
const PORT_STDOUT_PREFIX = "COMMENT_SIDECAR_PORT=";
const PPID_WATCH_INTERVAL_MS = 1000;
const DEVICE_CODE_FRAME = "device_code";
const LINK_STATE_FRAME = "link.state";
// 032c-b: ログイン永続化。token(JSON) は viewer WS には流さず、**stdout の専用行**（親子 private pipe）で
// のみ Rust へ渡し、Rust が OS キーチェーンへ保存する。復元は Rust→**stdin** の専用行で受ける（§9）。
const TOKEN_STDOUT_PREFIX = "COMMENT_SIDECAR_TOKEN=";
const TOKEN_CLEAR_STDOUT = "COMMENT_SIDECAR_TOKEN_CLEAR";
const RESTORE_STDIN_PREFIX = "COMMENT_SIDECAR_RESTORE=";
// 032c-d: YouTube 同意画面の認可 URL を Rust へ渡す stdout 専用行（親子 private pipe）。Rust が
// host=accounts.google.com を検証して opener で開く。**URL 全体はログに出さない**（載るのは code_challenge・
// 非機密で code_verifier は載らない）。token/secret は一切載せない（§9）。
const OPEN_URL_STDOUT_PREFIX = "COMMENT_SIDECAR_OPEN_URL=";

// 診断ログは stdout（ポート受け渡し）と混線しないよう stderr に出す。トークン/device_code は載せない。
const logInfo = (message: string, extra?: unknown): void => {
  process.stderr.write(
    extra === undefined ? `${message}\n` : `${message} ${JSON.stringify(extra)}\n`,
  );
};

type ControlFrame =
  // 032c-d: start-login/start-session/stop-session に service を付与（既定 twitch＝後方互換）。
  // twitch=Device Code＋channel 必須 / youtube=Authorization Code＋mine=true（channel 不要）。
  | { type: "start-login"; service: Provider }
  | { type: "start-session"; service: Provider; channel?: string }
  | { type: "stop-session"; service: Provider };

/** service フィールドを Provider に正規化する（未指定・不正は既定 twitch＝後方互換）。 */
function parseService(v: unknown): Provider {
  return v === "youtube" ? "youtube" : "twitch";
}

function parseControlFrame(raw: string): ControlFrame | null {
  let msg: unknown;
  try {
    msg = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof msg !== "object" || msg === null) return null;
  const m = msg as { type?: unknown; channel?: unknown; service?: unknown };
  if (m.type === "start-login") {
    return { type: "start-login", service: parseService(m.service) };
  }
  if (m.type === "stop-session") {
    return { type: "stop-session", service: parseService(m.service) };
  }
  if (m.type === "start-session") {
    const service = parseService(m.service);
    // youtube はチャンネル名不要（mine=true）。twitch は channel 必須。
    if (service === "youtube") {
      return { type: "start-session", service };
    }
    if (typeof m.channel === "string") {
      return { type: "start-session", service, channel: m.channel };
    }
    return null;
  }
  return null;
}

/** Rust から stdin で届く復元 JSON を TokenSetPlain として堅牢にパースする（不正なら null）。 */
function parseTokenPlain(json: string): TokenSetPlain | null {
  let v: unknown;
  try {
    v = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if (
    typeof o.accessToken === "string" &&
    typeof o.refreshToken === "string" &&
    typeof o.expiresAt === "number" &&
    typeof o.scope === "string" &&
    typeof o.obtainedAt === "number"
  ) {
    return {
      accessToken: o.accessToken,
      refreshToken: o.refreshToken,
      expiresAt: o.expiresAt,
      scope: o.scope,
      obtainedAt: o.obtainedAt,
    };
  }
  return null;
}

async function main(): Promise<void> {
  // 032c-b: token の save/clear を stdout の専用行で Rust へ伝え、Rust が OS キーチェーンへ永続化する。
  // token は viewer WS には流さず、親子 private pipe（stdout）のみを通る（§9）。
  const authClient = createAuthClient({
    onTokenPersist: (plain) => {
      if (plain === null) {
        process.stdout.write(`${TOKEN_CLEAR_STDOUT}\n`);
      } else {
        process.stdout.write(`${TOKEN_STDOUT_PREFIX}${JSON.stringify(plain)}\n`);
      }
    },
    // 032c-d: YouTube 同意画面の認可 URL を Rust へ渡す（Rust が host=accounts.google.com を検証して
    // opener で開く）。**URL 全体はログに出さない**（stdout の専用行のみ・診断は stderr）。
    onOpenAuthUrl: (url) => {
      process.stdout.write(`${OPEN_URL_STDOUT_PREFIX}${url}\n`);
    },
  });
  registerCommentFetcherDependencies({ authClient });
  // 032c-d: YouTube 取得の DI（ガード付き gRPC runtime・定数 Data API base・guarded fetch）を登録する。
  registerYouTubeDependencies({ authClient });

  const output = container.resolve(WebSocketCommentOutputPort);

  // スパイク1(強・オフライン): Twitch の @inject 多引数コンストラクタ群を解決し、decorator metadata が
  // tsc→esbuild→SEA を生存していることを確認する（DI 解決のみ・ネットワークは張らない）。
  createTwitchPipeline();
  logInfo("[comment-sidecar] tsyringe DI resolved twitch graph (decorator metadata OK)");
  // 032c-d: YouTube DI グラフ解決（decorator metadata 生存確認）＋**proto-under-SEA gate（スパイク1）**。
  // 実ネットワークは張らない（proto を一時展開して loadSync できるかだけを確認する）。
  createYouTubePipeline({});
  const protoCheck = selfCheckStreamListProto();
  logInfo(
    protoCheck.ok
      ? "[comment-sidecar] youtube DI resolved + stream_list.proto loadable (spike1 proto-under-SEA OK)"
      : `[comment-sidecar] WARN stream_list.proto load failed (spike1): ${protoCheck.error}`,
  );

  const sendSessionState = (
    platform: Provider,
    state: string,
    reason?: string,
  ): void => {
    output.broadcastMessage({
      type: COMMENT_DELIVERY_MESSAGE_TYPES.SESSION_STATE,
      payload: { platform, state, ...(reason ? { reason } : {}) },
    });
  };

  // 032c-b/032c-d: 現在のログイン状態を viewer へ通知する（getLinkStatus はメモリのトークン有無を見る・非機密）。
  // 再接続時・ログイン成功時・keychain 復元時（twitch のみ）・認可失効時に送り、viewer が platform 別に
  // 「接続済み/未接続」を反映できる。YouTube は in-memory のみのため復元は無く、sidecar 起動直後は未接続。
  const sendLinkState = async (platform: Provider): Promise<void> => {
    let linked = false;
    try {
      const status = await authClient.getLinkStatus(platform);
      linked = status.state === "linked";
    } catch {
      linked = false;
    }
    output.broadcastMessage({
      type: LINK_STATE_FRAME,
      payload: { platform, linked },
    });
  };

  // 032c-b: Rust が stdin へ書いた復元行のトークンをメモリへ復元する（keychain→メモリ）。ネットワークは
  // 張らない（取得は start-session で明示）。復元できたら link.state を送って viewer に「接続済み」を反映。
  const restoreFromJson = async (json: string): Promise<void> => {
    const plain = parseTokenPlain(json);
    if (!plain) return;
    try {
      await authClient.restoreTwitchToken(plain);
      logInfo("[comment-sidecar] twitch login restored from keychain");
      void sendLinkState("twitch");
    } catch {
      logInfo("[comment-sidecar] twitch token restore failed");
    }
  };

  // 取得パイプラインの出力: Comment → 正規化 → comments.append で viewer へ送る（端末外に出さない）。
  const outputPort: CommentOutputPort = {
    outputComments: async (comments: Comment[]): Promise<void> => {
      for (const comment of comments) {
        const view = convertCommentToViewDto(comment);
        output.broadcastMessage({
          type: COMMENT_DELIVERY_MESSAGE_TYPES.COMMENTS_APPEND,
          payload: { comment: toCanonicalComment(view) },
        });
      }
    },
  };

  let sessionAbort: AbortController | null = null;
  // 032c-d: 現在アクティブな取得セッションの platform（各サービス個別選択＝同時取得しない・1 つだけ）。
  // 別サービスの取得開始は前セッションを abort する（sessionAbort を差し替え）。
  let activeSessionPlatform: Provider | null = null;
  let loginInFlight = false;

  const startLogin = async (): Promise<void> => {
    if (loginInFlight) return;
    loginInFlight = true;
    try {
      await authClient.loginTwitchWithDeviceCode((prompt) => {
        // user_code / verification_uri は非機密（ユーザー提示用）。device_code(秘密) は載せない。
        output.broadcastMessage({ type: DEVICE_CODE_FRAME, payload: prompt });
      });
      sendSessionState("twitch", "idle"); // ログイン成功（取得は start-session で開始）。
      void sendLinkState("twitch"); // ログイン済みを viewer に反映する。
      logInfo("[comment-sidecar] twitch login succeeded");
    } catch (error) {
      sendSessionState("twitch", "failed", safeReason(error));
      logInfo("[comment-sidecar] twitch login failed");
    } finally {
      loginInFlight = false;
    }
  };

  // 032c-d: YouTube ログイン（Authorization Code + loopback / PKCE）。device code は無く、認可 URL は
  // Rust opener で開く（onOpenAuthUrl → stdout）。成功でトークンは in-memory（keyring 無し）。取得は commit2。
  let youtubeLoginInFlight = false;
  const startYouTubeLogin = async (): Promise<void> => {
    if (youtubeLoginInFlight) return;
    youtubeLoginInFlight = true;
    // ブラウザ同意待ちを viewer に伝える（device code テキストは出さず「ブラウザで同意」ステータス）。
    sendSessionState("youtube", "connecting");
    try {
      await authClient.login("youtube"); // loopback で code 受領 → oauth2.googleapis.com で token 交換。
      sendSessionState("youtube", "idle"); // ログイン成功（取得は commit2 で start-session）。
      void sendLinkState("youtube");
      logInfo("[comment-sidecar] youtube login succeeded");
    } catch (error) {
      sendSessionState("youtube", "failed", safeReason(error, "YouTube 連携でエラーが発生しました。"));
      logInfo("[comment-sidecar] youtube login failed");
    } finally {
      youtubeLoginInFlight = false;
    }
  };

  const startSession = async (channel: string): Promise<void> => {
    if (sessionAbort) sessionAbort.abort();
    const abort = new AbortController();
    sessionAbort = abort;
    activeSessionPlatform = "twitch";
    sendSessionState("twitch", "connecting");
    try {
      await runTwitchPipeline(
        {},
        outputPort,
        {
          signal: abort.signal,
          onStateChange: (event) => {
            sendSessionState("twitch", event.state, event.reason);
          },
        },
        channel,
      );
    } catch (error) {
      if (!abort.signal.aborted) {
        sendSessionState("twitch", "failed", safeReason(error));
        logInfo("[comment-sidecar] twitch session error");
      }
    } finally {
      if (sessionAbort === abort) {
        sessionAbort = null;
        activeSessionPlatform = null;
      }
    }
  };

  // 032c-d: YouTube 取得セッション（gRPC streamList）。チャンネル名不要（mine=true で自アカウントの
  // アクティブ配信を検出）。Twitch と同時には走らせない（前セッションを abort）。取得コメントは既存の
  // outputPort（→ comments.append・source:'youtube'）に流す。クォータ枯渇は runYouTubePipeline 内で
  // graceful stop（FAILED 通知・hot-loop しない）。
  const startYouTubeSession = async (): Promise<void> => {
    if (sessionAbort) sessionAbort.abort();
    const abort = new AbortController();
    sessionAbort = abort;
    activeSessionPlatform = "youtube";
    sendSessionState("youtube", "connecting");
    try {
      await runYouTubePipeline({}, outputPort, {
        signal: abort.signal,
        onStateChange: (event) => {
          sendSessionState("youtube", event.state, event.reason);
        },
      });
    } catch (error) {
      if (!abort.signal.aborted) {
        sendSessionState(
          "youtube",
          "failed",
          safeReason(error, "YouTube 連携でエラーが発生しました。"),
        );
        logInfo("[comment-sidecar] youtube session error");
      }
    } finally {
      if (sessionAbort === abort) {
        sessionAbort = null;
        activeSessionPlatform = null;
      }
    }
  };

  output.setControlMessageHandler((raw) => {
    const frame = parseControlFrame(raw);
    if (!frame) return;
    if (frame.type === "start-login") {
      // 032c-d: service で分岐（youtube=Authorization Code / twitch=Device Code）。
      if (frame.service === "youtube") {
        void startYouTubeLogin();
      } else {
        void startLogin();
      }
    } else if (frame.type === "start-session") {
      // 032c-d: service で分岐。youtube=mine=true（channel 不要）/ twitch=channel 必須。
      if (frame.service === "youtube") {
        void startYouTubeSession();
      } else if (frame.channel !== undefined) {
        void startSession(frame.channel);
      }
    } else if (frame.type === "stop-session") {
      // 032c-d: 該当サービスがアクティブなら停止。アクティブでなくても該当パネルは idle 表示にする。
      if (activeSessionPlatform === frame.service) {
        sessionAbort?.abort();
        sessionAbort = null;
        activeSessionPlatform = null;
      }
      sendSessionState(frame.service, "idle");
    }
  });

  // 032c-b/032c-d: viewer が（再）接続したら現在のログイン状態を platform 別に送る（twitch は keychain
  // 復元済みログインを反映・youtube は in-memory のため sidecar 起動後の当該セッションのログイン有無）。
  output.setConnectionHandler(() => {
    void sendLinkState("twitch");
    void sendLinkState("youtube");
  });

  // 032c-b/032c-d: 認可失効（refresh 失敗など）で token が破棄されたら link.state を更新する
  //（twitch: PersistingTokenStore.clear → Rust が keychain 削除。youtube: in-memory 破棄）。両 platform を更新。
  authClient.onAuthorizationLost(() => {
    void sendLinkState("twitch");
    void sendLinkState("youtube");
  });

  const port = await output.startWithFallback(WS_HOST, PREFERRED_PORT);
  process.stdout.write(`${PORT_STDOUT_PREFIX}${port}\n`);
  logInfo("[comment-sidecar] listening", { host: WS_HOST, port });

  // no-orphan 保険（親消滅で self-exit）＋シグナル/stdin での終了。
  const parentPid = process.ppid;
  let ppidTimer: NodeJS.Timeout | null = null;
  const shutdown = (code: number): void => {
    if (ppidTimer) clearInterval(ppidTimer);
    sessionAbort?.abort();
    void output.close().finally(() => process.exit(code));
  };
  ppidTimer = setInterval(() => {
    let parentAlive = true;
    try {
      process.kill(parentPid, 0);
    } catch {
      parentAlive = false;
    }
    if (!parentAlive) {
      logInfo("[comment-sidecar] parent gone; self-exiting");
      shutdown(0);
    }
  }, PPID_WATCH_INTERVAL_MS);
  process.on("SIGTERM", () => shutdown(0));
  process.on("SIGINT", () => shutdown(0));
  process.stdin.on("close", () => shutdown(0));

  // 032c-b: Rust が起動時に stdin へ書く復元行（COMMENT_SIDECAR_RESTORE=<json>）を読み、ログインを
  // メモリへ復元する。行区切りでバッファリングして解析する（stdin は close 監視にも使うので data も購読）。
  let stdinBuf = "";
  process.stdin.on("data", (chunk: Buffer) => {
    stdinBuf += chunk.toString("utf8");
    let nl: number;
    while ((nl = stdinBuf.indexOf("\n")) !== -1) {
      const line = stdinBuf.slice(0, nl).trim();
      stdinBuf = stdinBuf.slice(nl + 1);
      if (line.startsWith(RESTORE_STDIN_PREFIX)) {
        void restoreFromJson(line.slice(RESTORE_STDIN_PREFIX.length));
      }
    }
  });
  process.stdin.resume();
}

/**
 * エラー文言を viewer（loopback WS の session.state.reason）へ渡す。
 * osareview のエラーは概ね安全な定型文言でトークンを含まない。唯一の例外は Helix の非 401 失敗で、
 * `helix.client.ts` が Twitch のレスポンス本文（errorBody）を message に含める。errorBody は Twitch の
 * エラー JSON で**呼び出し側の access/refresh token は含まない**ため、露出は低リスク（宛先は公開 API）。
 * 032c-d(YouTube): 同様に live-stream.client.ts が Data API の非 401 失敗で Google のエラー本文（errorBody）を
 * message に含めるが、これも**呼び出し側の token を含まない**公開 API のエラー JSON で低リスク。クォータ枯渇
 * （QuotaExceededError）・OAuth エラー（oauth.client.ts）はいずれも定型文言＋OAuth エラーコードのみで機微情報なし。
 * どうなったら直すべきか: reason に載る情報を厳密に絞りたい場合は、ここで固定文言へ丸めるか、各 client が
 * errorBody を message に含めないようにする。
 */
function safeReason(
  error: unknown,
  fallback = "Twitch 連携でエラーが発生しました。",
): string {
  return error instanceof Error ? error.message : fallback;
}

main().catch((error) => {
  process.stderr.write(`[comment-sidecar] fatal: ${String(error)}\n`);
  process.exit(1);
});
