import { inject, injectable } from "tsyringe";
import WebSocket from "ws";
import type { AuthorizedTokenAccessor } from "@comment-dock/auth";
import { TWITCH_DI_TOKENS } from "../access-token/di-tokens.js";
import type { TwitchHelixClient } from "./helix.client.js";
import type { TwitchConfigProvider } from "../../../infrastructure/twitch/config/api-config.js";
import type { AuthorizedTokenAccessorProvider } from "../../../infrastructure/shared/auth/access-token-provider.js";
import { isUnauthorizedRequestError } from "../../shared/auth/error.js";
// 063e 段 2-b: 修復は**純粋モジュール**へ切り出してある（`dev-mock.ts` からも呼ぶため。理由は当該ファイルの冒頭）。
import { repairNotificationEvent } from "./eventsub-repair.js";
import {
  TWITCH_EVENTSUB_MESSAGE_TYPES,
  type TwitchBitsUseEventDto,
  type TwitchChannelPointsRedemptionEventDto,
  type TwitchChatMessageEventDto,
  type TwitchChatNotificationEventDto,
  type TwitchEventSubEnvelopeDto,
  type TwitchEventSubNotificationEnvelopeDto,
  type TwitchEventSubReconnectEnvelopeDto,
  type TwitchEventSubSessionWelcomeEnvelopeDto,
} from "../dto/raw.dto.js";

// ws 実装を直接固定せず、テスト時に差し替え可能にするための runtime 境界。
type WebSocketRuntime = {
  createClient: (url: string) => WebSocket;
};

// 032c-b(stream-dock): これは allow-list ガードを通さない**生の** new WebSocket。初回接続にも
// reconnect_url にも使われるため、本番では必ず DI で `guardedWebSocketRuntime`（host-guard.ts）へ
// 差し替える（register-twitch-deps.ts が eventSubWebSocketRuntime に useValue で固定）。
// この DEFAULT はコンストラクタ引数の既定値／単体テスト用フォールバックで、DI 配線がある限り
// 到達しない。どうなったら要注意か: DI 登録を外す/変える改修時は、この生ランタイムに落ちて
// allow-list を素通りしないよう、必ず guarded 版が注入され続けることを確認すること。
export const DEFAULT_WEBSOCKET_RUNTIME: WebSocketRuntime = {
  createClient: (url) => new WebSocket(url),
};

type ConnectedEventSubSession = {
  socket: WebSocket;
  sessionId: string;
};

type TwitchChatEvent =
  | TwitchChatMessageEventDto
  | TwitchChatNotificationEventDto
  | TwitchBitsUseEventDto
  // 063e: チャンネルポイントの引き換え。
  | TwitchChannelPointsRedemptionEventDto;

/**
 * 063e 段 1-b: **チャンネルポイント購読の成否を 1 bit だけ外へ知らせる口。**
 *
 * ⚠⚠⚠ **これが無いと「黙って効かない」が残る**（061a Q-1）。この購読は**非致命**なので、
 * 失敗しても本線（コメント取得）は動き続け、画面には**何も起きない**。しかも失敗は例外ではなく
 * **既定状態**である——チャンネルポイントは Twitch 側で有効化されていないチャンネルでは使えず、
 * 新規配信者はまさにその状態から始まる。⇒ 配信者が「なぜ届かないのか」を知る手段が 1 つも無くなる。
 *
 * ⚠⚠ **理由（エラー内容）は運ばない**（§9）。運ぶのは「作れたか／作れなかったか」の 1 bit だけで、
 * HTTP ステータスも本文もチャンネル名もトークンも通らない。⚠ 原因の切り分けは
 * **固定の文言**（`SettingsView` のカード）が担い、ここは分岐しない。
 *
 * ⚠ 実装は**投げてはならない**。投げると `Promise.all` が reject して
 * **購読が成功しているのにセッションが落ちる**（担保は `reportChannelPointsSubscription` の try/catch）。
 */
export type ChannelPointsSubscriptionReporter = (ok: boolean) => void;

/** 通知先が配線されていないとき（単体テスト・DI 未登録）の既定。 */
export const NOOP_CHANNEL_POINTS_SUBSCRIPTION_REPORTER: ChannelPointsSubscriptionReporter =
  () => {};

// 063e 段 2-b: 修復の実体は `eventsub-repair.ts`。⚠ **ここから再 export する**
//   （`scripts/test-eventsub-repair.mjs` の静的検査が「受信ハンドラから呼ばれている」ことを
//   このファイルで見ており、呼び出し側の可読性も保ちたいため）。
export { repairNotificationEvent } from "./eventsub-repair.js";

@injectable()
export class TwitchEventSubWebSocketClient {
  constructor(
    @inject(TWITCH_DI_TOKENS.helixClient)
    private readonly helixClient: TwitchHelixClient,
    @inject(TWITCH_DI_TOKENS.accessTokenProvider)
    private readonly authorizedTokenAccessorProvider: AuthorizedTokenAccessorProvider,
    @inject(TWITCH_DI_TOKENS.configProvider)
    private readonly configProvider: TwitchConfigProvider,
    @inject(TWITCH_DI_TOKENS.eventSubWebSocketRuntime)
    private readonly runtime: WebSocketRuntime = DEFAULT_WEBSOCKET_RUNTIME,
    // 063e 段 1-b: チャンネルポイント購読の成否の通知先。⚠ DI に無いときは no-op
    //   （通知が出ないだけで、取得は 1 バイトも変わらない＝fail-open で正しい）。
    @inject(TWITCH_DI_TOKENS.channelPointsSubscriptionReporter)
    private readonly channelPointsReporter: ChannelPointsSubscriptionReporter = NOOP_CHANNEL_POINTS_SUBSCRIPTION_REPORTER,
  ) {}

  /**
   * 063e 段 1-b: チャンネルポイント購読の成否を通知する。
   *
   * ⚠⚠⚠ **例外を絶対に外へ出さない。** この呼び出しは `subscribeChatEvents` の `Promise.all` の中に
   * いるので、投げると **`connectAndSubscribeChatEventsOnce` が throw → セッションが落ちる**。
   * ⚠ 購読自体は成功しているのに「通知に失敗したせいでコメント取得が止まる」は、
   *   非致命化してきた設計をひっくり返す最悪の壊れ方である。
   */
  private reportChannelPointsSubscription(ok: boolean): void {
    try {
      this.channelPointsReporter(ok);
    } catch {
      // best-effort。通知できないことは本線に影響させない（§9 配慮で内容もログに残さない）。
    }
  }

  /**
   * 接続→購読作成後、notificationイベントを AsyncIterable で継続返却する。
   */
  async *streamChatEvents(input: {
    broadcasterUserId: string;
    userId: string;
  }): AsyncIterable<TwitchChatEvent> {
    const accessor =
      this.authorizedTokenAccessorProvider.createAuthorizedTokenAccessor();
    const session = await this.connectAndSubscribeChatEvents(input, accessor);
    let socket = session.socket;

    const queue: TwitchChatEvent[] = [];
    let done = false;
    let streamError: Error | null = null;
    let wakeup: (() => void) | null = null;

    const notify = () => {
      if (!wakeup) {
        return;
      }
      const fn = wakeup;
      wakeup = null;
      fn();
    };

    const handleMessage = (raw: WebSocket.RawData) => {
      try {
        const payload = this.rawDataToString(raw);
        const envelope = this.parseEnvelope(payload);
        if (
          envelope.metadata.message_type ===
          TWITCH_EVENTSUB_MESSAGE_TYPES.SESSION_RECONNECT
        ) {
          const reconnectEnvelope =
            envelope as TwitchEventSubReconnectEnvelopeDto;
          void reconnectSocket(reconnectEnvelope.payload.session.reconnect_url);
          return;
        }

        if (
          envelope.metadata.message_type !==
          TWITCH_EVENTSUB_MESSAGE_TYPES.NOTIFICATION
        ) {
          return;
        }

        // 直前で notification 以外を除外しているため、ここでは NotificationEnvelope として扱える。
        const notification = envelope as TwitchEventSubNotificationEnvelopeDto;
        // 063e 段 1-b: 043a の bits.use 補填はここへ括り出した（`repairNotificationEvent`）。
        // ⚠ **`metadata.subscription_type` を根拠にした修復**なので、mapper の形推測より強い。
        repairNotificationEvent(notification);
        const event = notification.payload.event;
        queue.push(event);
        notify();
      } catch (error) {
        streamError = error instanceof Error ? error : new Error(String(error));
        done = true;
        notify();
      }
    };

    const handleError = (error: Error) => {
      streamError = error;
      done = true;
      notify();
    };

    const handleClose = () => {
      if (!done) {
        streamError = new Error(
          "Twitch のコメント受信接続が切断されました。再接続をお試しください。",
        );
      }
      done = true;
      notify();
    };

    const reconnectSocket = async (url: string): Promise<void> => {
      try {
        const nextSession = await this.connect(url);
        detachSocketHandlers(socket);
        if (
          socket.readyState === WebSocket.OPEN ||
          socket.readyState === WebSocket.CONNECTING
        ) {
          socket.close();
        }
        socket = nextSession.socket;
        attachSocketHandlers(socket);
      } catch (error) {
        streamError = error instanceof Error ? error : new Error(String(error));
        done = true;
        notify();
      }
    };

    const attachSocketHandlers = (target: WebSocket) => {
      target.on("message", handleMessage);
      target.on("error", handleError);
      target.on("close", handleClose);
    };

    const detachSocketHandlers = (target: WebSocket) => {
      target.off("message", handleMessage);
      target.off("error", handleError);
      target.off("close", handleClose);
    };

    attachSocketHandlers(socket);

    try {
      while (true) {
        if (queue.length > 0) {
          const event = queue.shift();
          if (event) {
            yield event;
          }
          continue;
        }

        if (streamError) {
          throw streamError;
        }

        if (done) {
          break;
        }

        await new Promise<void>((resolve) => {
          wakeup = resolve;
        });
      }
    } finally {
      detachSocketHandlers(socket);

      if (
        socket.readyState === WebSocket.OPEN ||
        socket.readyState === WebSocket.CONNECTING
      ) {
        socket.close();
      }
    }
  }

  /**
   * EventSubへ接続し、チャット受信用の2購読を作成した状態を返す。
   * subscription 作成時の token 取得・refresh は auth の accessor に委譲する。
   */
  private async connectAndSubscribeChatEvents(
    input: {
      broadcasterUserId: string;
      userId: string;
    },
    accessor: AuthorizedTokenAccessor,
  ): Promise<ConnectedEventSubSession> {
    let accessToken = await accessor.getCurrentAccessToken();

    try {
      return await this.connectAndSubscribeChatEventsOnce(input, accessToken);
    } catch (error) {
      if (!isUnauthorizedRequestError(error)) {
        throw error;
      }
      accessToken = await accessor.refresh();
      return this.connectAndSubscribeChatEventsOnce(input, accessToken);
    }
  }

  private async connectAndSubscribeChatEventsOnce(
    input: {
      broadcasterUserId: string;
      userId: string;
    },
    accessToken: string,
  ): Promise<ConnectedEventSubSession> {
    const session = await this.connect();
    try {
      await this.subscribeChatEvents(
        {
          sessionId: session.sessionId,
          broadcasterUserId: input.broadcasterUserId,
          userId: input.userId,
        },
        accessToken,
      );
    } catch (error) {
      if (
        session.socket.readyState === WebSocket.OPEN ||
        session.socket.readyState === WebSocket.CONNECTING
      ) {
        session.socket.close();
      }
      throw error;
    }
    return session;
  }

  /**
   * EventSub WebSocketへ接続し、session_welcome から session_id を取得して返す。
   * 返り値:
   * - socket: 以降の message/error/close 監視と受信継続に使う接続本体
   * - sessionId: Helix の eventsub/subscriptions 作成時の transport.session_id に使う
   */
  private async connect(
    url = this.configProvider.getEventSubWebSocketUrl(),
  ): Promise<ConnectedEventSubSession> {
    const socket = this.runtime.createClient(url);

    await new Promise<void>((resolve, reject) => {
      const handleOpen = () => {
        cleanup();
        resolve();
      };
      const handleError = (error: Error) => {
        cleanup();
        reject(error);
      };
      const cleanup = () => {
        socket.off("open", handleOpen);
        socket.off("error", handleError);
      };
      socket.once("open", handleOpen);
      socket.once("error", handleError);
    });

    const sessionId = await this.waitForSessionWelcome(socket);
    return { socket, sessionId };
  }

  /**
   * EventSub の生メッセージ文字列を envelope DTO へ変換する。
   * - JSONとして不正な場合はエラー
   * - EventSub envelope 形式（metadata.message_type が既知値）でない場合はエラー
   */
  private parseEnvelope(payload: string): TwitchEventSubEnvelopeDto {
    const parsed = this.parseJson(payload);

    if (!this.isEventSubEnvelope(parsed)) {
      throw new Error(
        "Twitch から受信したメッセージ形式を読み取れませんでした。",
      );
    }

    return parsed;
  }

  /**
   * EventSub WebSocket セッションへ、チャット受信用の購読を作成する。
   * - channel.chat.message（必須）
   * - channel.chat.notification（必須）
   * - channel.bits.use（043a 拡張・任意＝非致命）: Bits Power-ups。旧トークンは bits:read scope 欠如で
   *   403 になり得るため**失敗しても本線の 2 購読・配信を止めない**（ユーザーが再ログインすると次回接続で有効化）。
   * - channel.channel_points_custom_reward_redemption.add（063e・任意＝非致命）: チャンネルポイントの引き換え。
   *   ⚠⚠ **非致命化は選択ではなく前提である**——失敗しうる経路が**構造的に 2 つ**ある:
   *   ①旧トークン（`channel:read:redemptions` の付与前＝再ログイン前）
   *   ②**他人のチャンネルへの接続**。⚠ 公式は本購読の Authorization を
   *     「Requires `channel:read:redemptions` scope from a broadcaster's access token.」と定義しており
   *     **ブロードキャスター本人のトークンでしか通らない**のに、接続先は**手入力のチャンネル名**である
   *     （`live-stream.client.ts` の `resolveUserIdByLogin`）。⇒ ②は仕様上、必ず起きる。
   */
  private async subscribeChatEvents(
    input: {
      sessionId: string;
      broadcasterUserId: string;
      userId: string;
    },
    accessToken: string,
  ): Promise<void> {
    await Promise.all([
      this.helixClient.createEventSubSubscriptionWithToken(
        {
          type: "channel.chat.message",
          version: "1",
          condition: {
            broadcaster_user_id: input.broadcasterUserId,
            user_id: input.userId,
          },
          sessionId: input.sessionId,
        },
        accessToken,
      ),
      this.helixClient.createEventSubSubscriptionWithToken(
        {
          type: "channel.chat.notification",
          version: "1",
          condition: {
            broadcaster_user_id: input.broadcasterUserId,
            user_id: input.userId,
          },
          sessionId: input.sessionId,
        },
        accessToken,
      ),
      // 043a(拡張): Bits Power-ups。scope/version/condition のいずれかが不一致でも本線を止めないよう非致命化。
      // 失敗時は Power-ups が届かないだけ（グレースフル劣化）。§9 配慮でエラー内容（token 等）はログに残さない。
      this.helixClient
        .createEventSubSubscriptionWithToken(
          {
            type: "channel.bits.use",
            version: "1",
            condition: {
              broadcaster_user_id: input.broadcasterUserId,
            },
            sessionId: input.sessionId,
          },
          accessToken,
        )
        .catch(() => {
          // best-effort。bits:read 未付与（再ログイン前）・beta 仕様差異等はここで握りつぶす。
        }),
      // 063e: チャンネルポイントの引き換え。⚠⚠ 043a の `channel.bits.use` と**まったく同じ形**で非致命化する
      // （403 でも本線の 2 購読とコメント配信を止めない）。失敗時は引き換えが届かないだけ（グレースフル劣化）。
      // ⚠ **`reward_id` を condition に入れない**（段 3 まで報酬を絞らない＝全報酬をまとめて受ける）。
      // ⚠ §9 配慮でエラー内容（token・チャンネル名等）はログに残さない。
      this.helixClient
        .createEventSubSubscriptionWithToken(
          {
            type: "channel.channel_points_custom_reward_redemption.add",
            version: "1",
            condition: {
              broadcaster_user_id: input.broadcasterUserId,
            },
            sessionId: input.sessionId,
          },
          accessToken,
        )
        // 063e 段 1-b: 成否を 1 bit だけ外へ知らせる（`ChannelPointsSubscriptionReporter` の注記が理由）。
        // ⚠⚠ **`.catch` を `.then` の第 2 引数に畳まないこと。** この形なら
        //   `.then` の中身が万一投げても下の `.catch` が受けるので、**非致命性が二重に守られる**
        //   （`reportChannelPointsSubscription` 自体も try/catch 済み＝理屈上は投げないが、
        //   「非致命である」ことを源コードの形として残す方を採る）。
        .then(() => {
          this.reportChannelPointsSubscription(true);
        })
        .catch(() => {
          // best-effort。channel:read:redemptions 未付与（再ログイン前）／チャンネルポイントが
          // Twitch 側で有効化されていない／他人のチャンネル（403）はここで握りつぶす。
          // ⚠⚠ **ここが守るのは「購読作成の失敗」だけである。** 購読が成功したあとに届くイベントを
          //   mapper が扱えないと本線は止まる——その担保は `comment.mapper.ts` の
          //   `isChannelPointsRedemptionEvent` と、chat フォールバックの fail-safe 化のほうにある。
          // ⚠ §9: エラー内容はログにも通知にも載せない（載せるのは false の 1 bit だけ）。
          this.reportChannelPointsSubscription(false);
        }),
    ]);
  }

  private async waitForSessionWelcome(socket: WebSocket): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const handleMessage = (raw: WebSocket.RawData) => {
        const payload =
          typeof raw === "string"
            ? raw
            : Buffer.isBuffer(raw)
              ? raw.toString("utf8")
              : raw.toString();
        const envelope = this.parseEnvelope(payload);

        if (
          envelope.metadata.message_type !==
          TWITCH_EVENTSUB_MESSAGE_TYPES.SESSION_WELCOME
        ) {
          return;
        }

        cleanup();
        resolve(
          (envelope as TwitchEventSubSessionWelcomeEnvelopeDto).payload.session
            .id,
        );
      };

      const handleError = (error: Error) => {
        cleanup();
        reject(error);
      };

      const handleClose = () => {
        cleanup();
        reject(
          new Error(
            "Twitch のコメント受信接続が初期化前に切断されました。再接続をお試しください。",
          ),
        );
      };

      const cleanup = () => {
        socket.off("message", handleMessage);
        socket.off("error", handleError);
        socket.off("close", handleClose);
      };

      socket.on("message", handleMessage);
      socket.once("error", handleError);
      socket.once("close", handleClose);
    });
  }

  private isEventSubEnvelope(
    value: unknown,
  ): value is TwitchEventSubEnvelopeDto {
    if (typeof value !== "object" || value === null) {
      return false;
    }

    const metadata = (value as { metadata?: unknown }).metadata;
    if (typeof metadata !== "object" || metadata === null) {
      return false;
    }

    const messageType = (metadata as { message_type?: unknown }).message_type;
    return (
      messageType === TWITCH_EVENTSUB_MESSAGE_TYPES.SESSION_WELCOME ||
      messageType === TWITCH_EVENTSUB_MESSAGE_TYPES.SESSION_KEEPALIVE ||
      messageType === TWITCH_EVENTSUB_MESSAGE_TYPES.NOTIFICATION ||
      messageType === TWITCH_EVENTSUB_MESSAGE_TYPES.SESSION_RECONNECT ||
      messageType === TWITCH_EVENTSUB_MESSAGE_TYPES.REVOCATION
    );
  }

  private parseJson(payload: string): unknown {
    try {
      return JSON.parse(payload);
    } catch {
      throw new Error("Twitch から受信したメッセージを読み取れませんでした。");
    }
  }

  private rawDataToString(raw: WebSocket.RawData): string {
    if (typeof raw === "string") {
      return raw;
    }
    if (Buffer.isBuffer(raw)) {
      return raw.toString("utf8");
    }
    return raw.toString();
  }
}
