import { invoke } from "@tauri-apps/api/core";
import type { CommentViewDto } from "./types";

/**
 * 032c-b: 内蔵コメントビューアと Twitch コメント取得 sidecar の単一双方向 WebSocket。
 *
 * 接続先ポートは Rust が sidecar の stdout から受領した実ポート（既定 17331・使用中なら空きポート）を
 * 読み取り専用コマンド `get_comment_stream_port` で取得してから `ws://127.0.0.1:<port>` に接続する
 * （frontend は raw ポート/パスを組み立てない・localhost のみ・main は no-internet）。
 *
 * - viewer→sidecar 制御: `start-login`（Device Code 開始）/ `start-session`（channel 指定で取得開始）/ `stop-session`
 * - sidecar→viewer: `device_code`（user_code / verification_uri をテキスト提示）/ `session.state` / `comments.append`
 *
 * `comments.append` の payload.comment は Rust 正規化 CommentViewDto と**同形**（sidecar が正規化済み）なので、
 * ここでの形式変換は不要（コミット1 の暫定アダプタは撤去済み）。
 */

/** Device Code の提示情報（user_code / verification_uri）。 */
export interface DeviceCodePrompt {
  userCode: string;
  verificationUri: string;
}

export interface CommentStreamHandlers {
  onComments: (comments: CommentViewDto[]) => void;
  onDeviceCode?: (prompt: DeviceCodePrompt) => void;
  onSessionState?: (state: string, reason?: string) => void;
  onConnectionChange?: (connected: boolean) => void;
  /** 032c-b: Twitch ログイン済みか（keychain 復元・ログイン成功・失効で更新される）。 */
  onLinkState?: (linked: boolean) => void;
}

export interface CommentStreamHandle {
  disconnect(): void;
  startLogin(): void;
  startSession(channel: string): void;
  stopSession(): void;
}

/** ポート未確定時・切断時の再試行間隔（ミリ秒）。 */
const RETRY_INTERVAL_MS = 1000;

function isDeviceCodePrompt(v: unknown): v is DeviceCodePrompt {
  if (typeof v !== "object" || v === null) return false;
  const p = v as { userCode?: unknown; verificationUri?: unknown };
  return typeof p.userCode === "string" && typeof p.verificationUri === "string";
}

export function connectCommentStream(
  handlers: CommentStreamHandlers,
): CommentStreamHandle {
  let closed = false;
  let ws: WebSocket | null = null;
  let retryTimer: number | null = null;

  const clearRetry = (): void => {
    if (retryTimer !== null) {
      window.clearTimeout(retryTimer);
      retryTimer = null;
    }
  };

  const scheduleReconnect = (): void => {
    if (closed) return;
    clearRetry();
    retryTimer = window.setTimeout(() => void connect(), RETRY_INTERVAL_MS);
  };

  const send = (frame: unknown): void => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(frame));
    }
  };

  const connect = async (): Promise<void> => {
    if (closed) return;
    let port: number | null = null;
    try {
      port = await invoke<number | null>("get_comment_stream_port");
    } catch {
      port = null;
    }
    if (closed) return;
    if (port === null) {
      scheduleReconnect();
      return;
    }

    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    ws = socket;
    socket.onopen = () => {
      handlers.onConnectionChange?.(true);
    };
    socket.onmessage = (ev) => {
      if (typeof ev.data !== "string") return;
      let msg: unknown;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (typeof msg !== "object" || msg === null) return;
      const m = msg as { type?: unknown; payload?: unknown };
      if (m.type === "comments.append") {
        const comment = (m.payload as { comment?: unknown } | undefined)?.comment;
        if (comment) handlers.onComments([comment as CommentViewDto]);
      } else if (m.type === "device_code") {
        if (isDeviceCodePrompt(m.payload)) handlers.onDeviceCode?.(m.payload);
      } else if (m.type === "session.state") {
        const p = m.payload as { state?: unknown; reason?: unknown } | undefined;
        if (typeof p?.state === "string") {
          handlers.onSessionState?.(
            p.state,
            typeof p.reason === "string" ? p.reason : undefined,
          );
        }
      } else if (m.type === "link.state") {
        const p = m.payload as { linked?: unknown } | undefined;
        if (typeof p?.linked === "boolean") handlers.onLinkState?.(p.linked);
      }
    };
    socket.onclose = () => {
      if (ws === socket) ws = null;
      handlers.onConnectionChange?.(false);
      scheduleReconnect();
    };
    socket.onerror = () => {
      try {
        socket.close();
      } catch {
        /* noop */
      }
    };
  };

  void connect();

  return {
    disconnect(): void {
      closed = true;
      clearRetry();
      if (ws) {
        try {
          ws.close();
        } catch {
          /* noop */
        }
        ws = null;
      }
    },
    startLogin(): void {
      send({ type: "start-login" });
    },
    startSession(channel: string): void {
      send({ type: "start-session", channel });
    },
    stopSession(): void {
      send({ type: "stop-session" });
    },
  };
}
