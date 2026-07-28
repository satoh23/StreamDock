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

/** 032c-d: 配信サービス（各サービス個別選択・併存）。 */
export type CommentService = "twitch" | "youtube";

/**
 * 046d: OBS へ自動追加する対象オーバーレイの種別。sidecar 側の `ObsOverlayKind` と**同じ 2 値**で、
 * 制御フレームにはこの識別子だけを載せる（ソース名・窓名は sidecar 内の表に閉じる＝任意の名前を渡さない）。
 */
export type ObsOverlayKind = "comments" | "pinned";

export interface CommentStreamHandlers {
  onComments: (comments: CommentViewDto[]) => void;
  onDeviceCode?: (prompt: DeviceCodePrompt) => void;
  /** 032c-d: session.state を platform 別に受け取る（twitch/youtube を viewer が別パネルに反映）。 */
  onSessionState?: (
    platform: CommentService,
    state: string,
    reason?: string,
  ) => void;
  onConnectionChange?: (connected: boolean) => void;
  /** 032c-b/032c-d: ログイン済みか（platform 別）。twitch=keychain 復元/成功/失効、youtube=in-memory の当該セッション。 */
  onLinkState?: (platform: CommentService, linked: boolean) => void;
  /** 044a: OBS 連携の状態（idle/connecting/added/reused/failed）。UI のトグル状態・失敗時の手動誘導に使う。 */
  onObsState?: (state: string, reason?: string) => void;
}

export interface CommentStreamHandle {
  disconnect(): void;
  /** 032c-d: service 省略時は twitch（後方互換）。youtube はブラウザ同意フロー。 */
  startLogin(service?: CommentService): void;
  /** 032c-d: service ごとに取得開始。twitch は channel 必須／youtube は channel 不要（mine=true）。 */
  startSession(service: CommentService, channel?: string): void;
  stopSession(service: CommentService): void;
  /** 044a: OBS 連携を有効化し、指定ポート（read-only 検出由来・非秘密）の OBS へソースを自動追加させる。
   *  パスワードはこの WS には載せず、Rust コマンド（set_obs_websocket_password）経由で sidecar へ渡す。
   *  046d: `overlay` は対象種別。実際のソース名/窓名は **sidecar 内の表**に閉じており、ここから名前は渡さない。 */
  enableObs(port: number, overlay: ObsOverlayKind): void;
  /** 044a: オーバーレイ表示 OFF 連動。OBS 側ソースを削除せず非表示にする（ON で enableObs が再表示）。port のみ・非秘密。 */
  hideObs(port: number, overlay: ObsOverlayKind): void;
  /** 044a: OBS 連携 OFF（状態を idle に戻す・OBS 側のソースは消さない）。 */
  disableObs(): void;
}

/** sidecar から届く platform を正規化する（未指定・不正は既定 twitch＝後方互換）。 */
function parsePlatform(v: unknown): CommentService {
  return v === "youtube" ? "youtube" : "twitch";
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
        const p = m.payload as
          | { platform?: unknown; state?: unknown; reason?: unknown }
          | undefined;
        if (typeof p?.state === "string") {
          handlers.onSessionState?.(
            parsePlatform(p.platform),
            p.state,
            typeof p.reason === "string" ? p.reason : undefined,
          );
        }
      } else if (m.type === "link.state") {
        const p = m.payload as
          | { platform?: unknown; linked?: unknown }
          | undefined;
        if (typeof p?.linked === "boolean") {
          handlers.onLinkState?.(parsePlatform(p.platform), p.linked);
        }
      } else if (m.type === "obs.state") {
        // 044a: OBS 連携の状態通知。非秘密（state/reason のみ・パスワードは載らない）。
        // L4(修正不要): state は WS 境界を跨ぐため string で受ける（sidecar の ObsState union は共有しない）。
        // SettingsView がリテラル比較で網羅する。再修正トリガー: 状態語が増えて取りこぼしが問題化したら共有 union 化する。
        const p = m.payload as
          | { state?: unknown; reason?: unknown }
          | undefined;
        if (typeof p?.state === "string") {
          handlers.onObsState?.(
            p.state,
            typeof p.reason === "string" ? p.reason : undefined,
          );
        }
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
    startLogin(service?: CommentService): void {
      send({ type: "start-login", ...(service ? { service } : {}) });
    },
    startSession(service: CommentService, channel?: string): void {
      send({ type: "start-session", service, ...(channel ? { channel } : {}) });
    },
    stopSession(service: CommentService): void {
      send({ type: "stop-session", service });
    },
    enableObs(port: number, overlay: ObsOverlayKind): void {
      send({ type: "obs-enable", port, overlay });
    },
    hideObs(port: number, overlay: ObsOverlayKind): void {
      send({ type: "obs-hide", port, overlay });
    },
    disableObs(): void {
      send({ type: "obs-disable" });
    },
  };
}
