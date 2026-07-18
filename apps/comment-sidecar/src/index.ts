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
import { createAuthClient, type TokenSetPlain } from "./auth/index.js";
import {
  createTwitchPipeline,
  registerCommentFetcherDependencies,
  runTwitchPipeline,
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

// 診断ログは stdout（ポート受け渡し）と混線しないよう stderr に出す。トークン/device_code は載せない。
const logInfo = (message: string, extra?: unknown): void => {
  process.stderr.write(
    extra === undefined ? `${message}\n` : `${message} ${JSON.stringify(extra)}\n`,
  );
};

type ControlFrame =
  | { type: "start-login" }
  | { type: "start-session"; channel: string }
  | { type: "stop-session" };

function parseControlFrame(raw: string): ControlFrame | null {
  let msg: unknown;
  try {
    msg = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof msg !== "object" || msg === null) return null;
  const m = msg as { type?: unknown; channel?: unknown };
  if (m.type === "start-login") return { type: "start-login" };
  if (m.type === "stop-session") return { type: "stop-session" };
  if (m.type === "start-session" && typeof m.channel === "string") {
    return { type: "start-session", channel: m.channel };
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
  });
  registerCommentFetcherDependencies({ authClient });

  const output = container.resolve(WebSocketCommentOutputPort);

  // スパイク1(強・オフライン): Twitch の @inject 多引数コンストラクタ群を解決し、decorator metadata が
  // tsc→esbuild→SEA を生存していることを確認する（DI 解決のみ・ネットワークは張らない）。
  createTwitchPipeline();
  logInfo("[comment-sidecar] tsyringe DI resolved twitch graph (decorator metadata OK)");

  const sendSessionState = (state: string, reason?: string): void => {
    output.broadcastMessage({
      type: COMMENT_DELIVERY_MESSAGE_TYPES.SESSION_STATE,
      payload: { platform: "twitch", state, ...(reason ? { reason } : {}) },
    });
  };

  // 032c-b: 現在のログイン状態を viewer へ通知する（getLinkStatus はメモリのトークン有無を見る・非機密）。
  // 再接続時・ログイン成功時・keychain 復元時・認可失効時に送り、viewer が「接続済み/未接続」を反映できる。
  const sendLinkState = async (): Promise<void> => {
    let linked = false;
    try {
      const status = await authClient.getLinkStatus("twitch");
      linked = status.state === "linked";
    } catch {
      linked = false;
    }
    output.broadcastMessage({ type: LINK_STATE_FRAME, payload: { linked } });
  };

  // 032c-b: Rust が stdin へ書いた復元行のトークンをメモリへ復元する（keychain→メモリ）。ネットワークは
  // 張らない（取得は start-session で明示）。復元できたら link.state を送って viewer に「接続済み」を反映。
  const restoreFromJson = async (json: string): Promise<void> => {
    const plain = parseTokenPlain(json);
    if (!plain) return;
    try {
      await authClient.restoreTwitchToken(plain);
      logInfo("[comment-sidecar] twitch login restored from keychain");
      void sendLinkState();
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
  let loginInFlight = false;

  const startLogin = async (): Promise<void> => {
    if (loginInFlight) return;
    loginInFlight = true;
    try {
      await authClient.loginTwitchWithDeviceCode((prompt) => {
        // user_code / verification_uri は非機密（ユーザー提示用）。device_code(秘密) は載せない。
        output.broadcastMessage({ type: DEVICE_CODE_FRAME, payload: prompt });
      });
      sendSessionState("idle"); // ログイン成功（取得は start-session で開始）。
      void sendLinkState(); // ログイン済みを viewer に反映する。
      logInfo("[comment-sidecar] twitch login succeeded");
    } catch (error) {
      sendSessionState("failed", safeReason(error));
      logInfo("[comment-sidecar] twitch login failed");
    } finally {
      loginInFlight = false;
    }
  };

  const startSession = async (channel: string): Promise<void> => {
    if (sessionAbort) sessionAbort.abort();
    const abort = new AbortController();
    sessionAbort = abort;
    sendSessionState("connecting");
    try {
      await runTwitchPipeline(
        {},
        outputPort,
        {
          signal: abort.signal,
          onStateChange: (event) => {
            sendSessionState(event.state, event.reason);
          },
        },
        channel,
      );
    } catch (error) {
      if (!abort.signal.aborted) {
        sendSessionState("failed", safeReason(error));
        logInfo("[comment-sidecar] twitch session error");
      }
    } finally {
      if (sessionAbort === abort) sessionAbort = null;
    }
  };

  output.setControlMessageHandler((raw) => {
    const frame = parseControlFrame(raw);
    if (!frame) return;
    if (frame.type === "start-login") {
      void startLogin();
    } else if (frame.type === "start-session") {
      void startSession(frame.channel);
    } else if (frame.type === "stop-session") {
      sessionAbort?.abort();
      sessionAbort = null;
      sendSessionState("idle");
    }
  });

  // 032c-b: viewer が（再）接続したら現在のログイン状態を送る（keychain 復元済みログインを反映）。
  output.setConnectionHandler(() => {
    void sendLinkState();
  });

  // 032c-b: 認可失効（refresh 失敗など）で token が破棄されたら link.state を更新する
  //（PersistingTokenStore.clear → Rust が keychain 削除、viewer は未接続表示に戻る）。
  authClient.onAuthorizationLost(() => {
    void sendLinkState();
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
 * どうなったら直すべきか: reason に載る情報を厳密に絞りたい場合は、ここで固定文言へ丸めるか、
 * helix.client.ts が errorBody を message に含めないようにする。
 */
function safeReason(error: unknown): string {
  return error instanceof Error ? error.message : "Twitch 連携でエラーが発生しました。";
}

main().catch((error) => {
  process.stderr.write(`[comment-sidecar] fatal: ${String(error)}\n`);
  process.exit(1);
});
