import { WebSocket, WebSocketServer } from "ws";
import { injectable } from "tsyringe";
import {
  ACCOUNT_LINK_STATES,
  COMMENT_DELIVERY_MESSAGE_TYPES,
  SESSION_PLATFORMS,
  SESSION_STATES,
  type AccountLinkSnapshots,
  type AccountLinkStateMessage,
  type CommentDeliveryMessage,
  type CommentViewDto,
  type CommentsAppendMessage,
  type SessionStateMessage,
  type StreamingSessionSnapshots,
} from "@comment-dock/shared";
import type { CommentOutputPort } from "@comment-dock/comment-delivery";
import {
  getWebSocketApiEndpoint,
  type WebSocketApiEndpoint,
} from "../../infrastructure/websocket/config/api-config.js";
import type {
  SessionStateOutputEvent,
  SessionStateOutputPort,
} from "../../usecases/interfaces/session-state-output-port.interface.js";
import type {
  AccountStateOutputEvent,
  AccountStateOutputPort,
} from "../../usecases/interfaces/account-state-output-port.interface.js";

const SESSION_PLATFORMS_LIST = [
  SESSION_PLATFORMS.YOUTUBE,
  SESSION_PLATFORMS.TWITCH,
] as const;

// 032c-b(stream-dock): viewer→sidecar の制御フレームを同一ソケットで受けるための inbound ハンドラ型。
export type ControlMessageHandler = (raw: string, client: WebSocket) => void;

@injectable()
export class WebSocketCommentOutputPort
  implements CommentOutputPort, SessionStateOutputPort, AccountStateOutputPort
{
  private server: WebSocketServer | null = null;

  // 032c-b(stream-dock): 実際に bind したポート（EADDRINUSE フォールバックで 17331 以外になり得る）。
  private boundPortValue: number | null = null;

  // 032c-b(stream-dock): 単一双方向 WS の inbound 制御ハンドラ（未設定時は無視）。
  private controlHandler: ControlMessageHandler | null = null;

  // 032c-b(stream-dock): 新規接続時に発火するハンドラ（viewer 再接続時に現在のログイン状態
  // link.state を送るのに使う。未設定時は無視）。
  private connectionHandler: ((client: WebSocket) => void) | null = null;

  private readonly sessionSnapshots: StreamingSessionSnapshots = {
    [SESSION_PLATFORMS.YOUTUBE]: {
      platform: SESSION_PLATFORMS.YOUTUBE,
      state: SESSION_STATES.IDLE,
    },
    [SESSION_PLATFORMS.TWITCH]: {
      platform: SESSION_PLATFORMS.TWITCH,
      state: SESSION_STATES.IDLE,
    },
  };

  private readonly accountSnapshots: AccountLinkSnapshots = {
    [SESSION_PLATFORMS.YOUTUBE]: {
      provider: SESSION_PLATFORMS.YOUTUBE,
      state: ACCOUNT_LINK_STATES.UNLINKED,
    },
    [SESSION_PLATFORMS.TWITCH]: {
      provider: SESSION_PLATFORMS.TWITCH,
      state: ACCOUNT_LINK_STATES.UNLINKED,
    },
  };

  // 032c-b(stream-dock): 単一双方向 WS の inbound 制御ハンドラを設定する。
  setControlMessageHandler(handler: ControlMessageHandler | null): void {
    this.controlHandler = handler;
  }

  // 032c-b(stream-dock): 新規接続時ハンドラを設定する（viewer 再接続で link.state を送る用）。
  setConnectionHandler(handler: ((client: WebSocket) => void) | null): void {
    this.connectionHandler = handler;
  }

  // 032c-b(stream-dock): 実際に bind したポート（未起動なら null）。
  getBoundPort(): number | null {
    return this.boundPortValue;
  }

  private bind(host: string, port: number): Promise<void> {
    const server = new WebSocketServer({ host, port });

    server.on("connection", (client) => {
      // 032c-b(stream-dock): この loopback WS は現状「未認証」で、127.0.0.1 に到達できる
      // 同一 PC の任意プロセス（およびユーザーがブラウザで開いた悪意あるページ）が接続して
      // 制御フレーム送信・comments.append / device_code(user_code) 受信をし得る。
      //  - なぜ現状で許容か: **秘密情報（access/refresh token・device_code）は WS に一切流さない**
      //    （送るのは user_code / verification_uri＝ユーザー提示用の非機密のみ、index.ts 参照）。
      //    宛先は allow-list 限定で、露出は「公開コメント＋非機密 user_code」程度。032c-c の
      //    loopback（VOICEVOX 50021）と同レベルの前提で、docs/progress.md に後回し改善として記録済み。
      //  - どうなったら直すべきか: WS に機密を載せる必要が出たとき / 脅威モデルが変わったときは、
      //    接続時の Origin 検証（webview 由来以外を拒否）＋ nonce ハンドシェイクを入れて認証する。
      // 032c-b(stream-dock): これらのスナップショット（sessionSnapshots/accountSnapshots）は
      // publishSessionState/publishAccountState でのみ更新されるが、stream-dock の制御経路（index.ts）は
      // それらではなく broadcastMessage(session.state) を直接使うため、スナップショットは常に初期値
      // （session=idle / account=unlinked）のまま。したがってセッション中に viewer が再接続すると、この
      // 接続直後スナップショットは一瞬 stale な「待機」を出し得る。
      //  - なぜ現状で許容か: 直後に本物のログイン状態は connectionHandler(→ index.ts の sendLinkState)が
      //    link.state で送り直し、以降のセッション状態も同ソケットのライブ session.state で上書きされるため、
      //    実害は「再接続直後の一瞬だけ idle 表示」に留まる（loopback WS は安定でこの再接続自体が稀）。
      //  - どうなったら直すべきか: 再接続直後にセッション状態も正確に復元したくなったら、index.ts を
      //    publishSessionState 経由に切り替える（スナップショットを最新化する）か、connectionHandler で
      //    現在の session.state も送り直す。
      this.sendSessionSnapshots(client);
      this.sendAccountSnapshots(client);
      // 032c-b(stream-dock): 接続直後に現在のログイン状態（link.state）を送る（再接続で復元済みログインを反映）。
      this.connectionHandler?.(client);
      // 032c-b(stream-dock): viewer→sidecar の制御フレームを同一ソケットで受ける。
      client.on("message", (data) => {
        const raw =
          typeof data === "string" ? data : data.toString("utf8");
        this.controlHandler?.(raw, client);
      });
    });

    return new Promise<void>((resolve, reject) => {
      const handleListening = (): void => {
        server.off("error", handleError);
        const address = server.address();
        this.boundPortValue =
          address && typeof address === "object" ? address.port : port;
        this.server = server;
        resolve();
      };
      const handleError = (error: Error): void => {
        server.off("listening", handleListening);
        reject(error);
      };

      server.once("listening", handleListening);
      server.once("error", handleError);
    });
  }

  async start(
    endpoint: WebSocketApiEndpoint = getWebSocketApiEndpoint(),
  ): Promise<void> {
    if (this.server) {
      return;
    }
    await this.bind(endpoint.host, endpoint.port);
    console.info("[comment-sidecar] WebSocket server started", {
      host: endpoint.host,
      port: this.boundPortValue,
    });
  }

  // 032c-b(stream-dock): 希望ポートが EADDRINUSE の場合は OS 割当の空きポート（port 0）へフォールバックする。
  async startWithFallback(host: string, preferredPort: number): Promise<number> {
    if (this.server) {
      return this.boundPortValue ?? preferredPort;
    }
    try {
      await this.bind(host, preferredPort);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      if (code !== "EADDRINUSE") {
        throw error;
      }
      console.warn(
        `[comment-sidecar] port ${preferredPort} is in use, falling back to an OS-assigned free port`,
      );
      await this.bind(host, 0);
    }
    console.info("[comment-sidecar] WebSocket server started", {
      host,
      port: this.boundPortValue,
    });
    return this.boundPortValue ?? preferredPort;
  }

  async outputToUi(comments: CommentViewDto[]): Promise<void> {
    await this.ensureServerStarted();

    for (const comment of comments) {
      const message: CommentsAppendMessage = {
        type: COMMENT_DELIVERY_MESSAGE_TYPES.COMMENTS_APPEND,
        payload: { comment },
      };
      this.broadcast(message);
    }
  }

  // 032c-b(stream-dock): 任意フレーム（comments.append / device_code / session.state）を全クライアントへ送る。
  // 正規化 CommentViewDto など、osareview 型に縛られないペイロードを送るための汎用ブロードキャスト。
  broadcastMessage(message: unknown): void {
    if (!this.server) {
      return;
    }
    const encoded = JSON.stringify(message);
    for (const client of this.server.clients) {
      this.sendEncoded(client, encoded);
    }
  }

  async publishSessionState(event: SessionStateOutputEvent): Promise<void> {
    this.sessionSnapshots[event.platform] = {
      platform: event.platform,
      state: event.state,
      ...(event.reason ? { reason: event.reason } : {}),
      ...(event.liveStreamId ? { liveStreamId: event.liveStreamId } : {}),
      ...(event.title ? { title: event.title } : {}),
    };

    await this.ensureServerStarted();
    this.broadcast(this.toSessionStateMessage(event));
  }

  async publishAccountState(event: AccountStateOutputEvent): Promise<void> {
    this.accountSnapshots[event.provider] = {
      provider: event.provider,
      state: event.state,
      ...(event.reason ? { reason: event.reason } : {}),
    };

    await this.ensureServerStarted();
    this.broadcast(this.toAccountStateMessage(event));
  }

  async close(): Promise<void> {
    if (!this.server) {
      return;
    }

    const server = this.server;
    this.server = null;

    for (const client of server.clients) {
      client.terminate();
    }

    await new Promise<void>((resolve, reject) => {
      server.close((error?: Error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  private async ensureServerStarted(): Promise<void> {
    if (this.server) {
      return;
    }
    await this.start();
  }

  private sendSessionSnapshots(client: WebSocket): void {
    for (const platform of SESSION_PLATFORMS_LIST) {
      const snapshot = this.sessionSnapshots[platform];
      this.send(client, this.toSessionStateMessage(snapshot));
    }
  }

  private sendAccountSnapshots(client: WebSocket): void {
    for (const provider of SESSION_PLATFORMS_LIST) {
      const snapshot = this.accountSnapshots[provider];
      this.send(client, this.toAccountStateMessage(snapshot));
    }
  }

  private broadcast(message: CommentDeliveryMessage): void {
    if (!this.server) {
      return;
    }

    const encoded = JSON.stringify(message);
    for (const client of this.server.clients) {
      this.sendEncoded(client, encoded);
    }
  }

  private send(client: WebSocket, message: CommentDeliveryMessage): void {
    this.sendEncoded(client, JSON.stringify(message));
  }

  private sendEncoded(client: WebSocket, encoded: string): void {
    if (client.readyState === WebSocket.OPEN) {
      client.send(encoded);
    }
  }

  private toSessionStateMessage(
    event: SessionStateOutputEvent,
  ): SessionStateMessage {
    return {
      type: COMMENT_DELIVERY_MESSAGE_TYPES.SESSION_STATE,
      payload: {
        platform: event.platform,
        state: event.state,
        ...(event.reason ? { reason: event.reason } : {}),
        ...(event.liveStreamId ? { liveStreamId: event.liveStreamId } : {}),
        ...(event.title ? { title: event.title } : {}),
      },
    };
  }

  private toAccountStateMessage(
    event: AccountStateOutputEvent,
  ): AccountLinkStateMessage {
    return {
      type: COMMENT_DELIVERY_MESSAGE_TYPES.ACCOUNT_LINK_STATE,
      payload: {
        provider: event.provider,
        state: event.state,
        ...(event.reason ? { reason: event.reason } : {}),
      },
    };
  }
}
