import type { YouTubeLiveChatMessagesListResponseDto } from "../dto/raw.dto.js";
import { inject, injectable } from "tsyringe";
import { YOUTUBE_DI_TOKENS } from "../access-token/di-tokens.js";
import type { AuthorizedTokenAccessorProvider } from "../../../infrastructure/shared/auth/access-token-provider.js";
import type { YouTubeConfigProvider } from "../../../infrastructure/youtube/config/api-config.js";
import { isGrpcUnauthenticatedError } from "../../shared/auth/error.js";
import grpc from "@grpc/grpc-js";
import protoLoader from "@grpc/proto-loader";

// gRPC本体を直接importしたままだとテストで差し替えづらいため、
// streamList呼び出しに必要な依存（proto読み込み/クライアント生成/metadata）を
// ひとかたまりのruntimeとして注入可能にしている。
//
// 032c-d(stream-dock): SEA 対応＋gRPC チャネルガードのため runtime を拡張する（osareview からの変更点）。
//  - getProtoPath: proto を実ファイルとして読める**一時ファイルのパス**を返す。SEA（単一実行ファイル）では
//    隣接 `stream_list.proto` を読めない（`import.meta.url` 依存を排除）ため、proto を文字列同梱→起動時に
//    一時展開したパスを注入する（youtube-grpc-runtime.ts）。
//  - createClient: gRPC チャネル生成を包み、target host を allow-list 照合してから生成する
//    （fetch/ws を通らない gRPC を封じ込める＝§1 二層 fail-closed の(b)を streamList に適用）。
export type StreamListRuntime = {
  loadSync: typeof protoLoader.loadSync;
  loadPackageDefinition: typeof grpc.loadPackageDefinition;
  createSsl: typeof grpc.credentials.createSsl;
  Metadata: typeof grpc.Metadata;
  getProtoPath: () => string;
  createClient: (
    ServiceCtor: grpc.ServiceClientConstructor,
    target: string,
    credentials: grpc.ChannelCredentials,
  ) => grpc.Client;
};

// 既定 runtime。stream-dock では youtube-grpc-runtime.ts のガード付き runtime を DI で注入するため、
// getProtoPath/createClient の既定は「未注入」を安全側で示す（SEA で誤って隣接ファイル読取・非ガード生成に
// 落ちないよう getProtoPath は throw する）。テスト時はコンストラクタ第3引数でモック runtime を渡して差し替える。
export const DEFAULT_STREAM_LIST_RUNTIME: StreamListRuntime = {
  loadSync: protoLoader.loadSync,
  loadPackageDefinition: grpc.loadPackageDefinition,
  createSsl: grpc.credentials.createSsl,
  Metadata: grpc.Metadata,
  getProtoPath: () => {
    throw new Error(
      "[YouTubeApiClient] StreamListRuntime.getProtoPath must be injected (SEA-safe proto path).",
    );
  },
  // NOTE: この既定 createClient は **allow-list 照合をしない**（そのまま生成する）。ただし本 DEFAULT は
  //   「runtime 未注入」を安全側に示すためのもので、openLiveChatMessageStream は createClient より先に
  //   getProtoPath() を呼び、DEFAULT ではそれが throw するため **この createClient には決して到達しない**
  //   （＝非ガードなチャネル生成は起こらない）。実運用では register-youtube-deps.ts が guardedStreamListRuntime
  //   （assertAllowedGrpcTarget 付き）を必ず注入する。テストは第3引数でモック runtime を渡す。
  //   どうなったら修正検討: getProtoPath より前に createClient を呼ぶよう呼び出し順が変わるなら、ここも throw
  //   （または assertAllowedGrpcTarget）にして非ガード生成の潜在経路を塞ぐ。
  createClient: (ServiceCtor, target, credentials) =>
    new ServiceCtor(target, credentials) as grpc.Client,
};

/**
 * YouTube Data API v3 クライアント（liveChatMessages.streamList 専用）。
 *
 * 参照:
 * - https://developers.google.com/youtube/v3/live/docs/liveChatMessages/streamList
 *
 * 認証に関する注意:
 * - AuthorizedTokenAccessorProvider は @comment-dock/auth の長期接続向け accessor を返す。
 * - streamList が UNAUTHENTICATED を返した場合だけ accessor.refresh() で token を更新し、接続を作り直す。
 */
@injectable()
export class YouTubeApiClient {
  constructor(
    @inject(YOUTUBE_DI_TOKENS.accessTokenProvider)
    private readonly authorizedTokenAccessorProvider: AuthorizedTokenAccessorProvider,
    @inject(YOUTUBE_DI_TOKENS.configProvider)
    private readonly configProvider: YouTubeConfigProvider,
    @inject(YOUTUBE_DI_TOKENS.streamListRuntime)
    private readonly streamListRuntime: StreamListRuntime = DEFAULT_STREAM_LIST_RUNTIME,
  ) {}

  async *fetchLiveChatMessages(input: {
    liveChatId: string;
    pageToken?: string;
  }): AsyncIterable<YouTubeLiveChatMessagesListResponseDto> {
    // token の取得・refresh は auth 側へ委譲し、
    // このクライアントは gRPC streamList の接続と DTO 受信だけを扱う。
    const accessor =
      this.authorizedTokenAccessorProvider.createAuthorizedTokenAccessor();
    let accessToken = await accessor.getCurrentAccessToken();

    while (true) {
      try {
        yield* this.openLiveChatMessageStream(input, accessToken);
        return;
      } catch (error) {
        if (!isGrpcUnauthenticatedError(error)) {
          throw error;
        }
        accessToken = await accessor.refresh();
      }
    }
  }

  private async *openLiveChatMessageStream(
    input: {
      liveChatId: string;
      pageToken?: string;
    },
    accessToken: string,
  ): AsyncIterable<YouTubeLiveChatMessagesListResponseDto> {
    const packageDefinition = this.streamListRuntime.loadSync(
      // 032c-d(stream-dock): SEA では隣接 .proto を読めないため、注入された一時ファイルのパスを使う。
      this.streamListRuntime.getProtoPath(),
      {
        keepCase: true,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true,
      },
    );
    // protoファイルからgRPCクライアントの型情報作成
    const loaded = this.streamListRuntime.loadPackageDefinition(
      packageDefinition,
    ) as {
      youtube: {
        api: {
          v3: {
            V3DataLiveChatMessageService: grpc.ServiceClientConstructor;
          };
        };
      };
    };

    const apiBaseUrl = new URL(this.configProvider.getDataApiBaseUrl());
    const target = `${apiBaseUrl.hostname}:${apiBaseUrl.port || "443"}`;

    // gRPCクライアント生成。032c-d(stream-dock): 注入 runtime の createClient が target host を allow-list
    // 照合してから生成する（fetch/ws を通らない gRPC の封じ込め＝§1 二層の(b)を streamList に適用）。
    const client = this.streamListRuntime.createClient(
      loaded.youtube.api.v3.V3DataLiveChatMessageService,
      target,
      this.streamListRuntime.createSsl(),
    );

    const metadata = new this.streamListRuntime.Metadata();
    metadata.set("authorization", `Bearer ${accessToken}`);
    metadata.set("x-goog-api-format-version", "2");

    const request = {
      live_chat_id: input.liveChatId,
      page_token: input.pageToken,
      part: ["id", "snippet", "authorDetails"],
      max_results: 2000,
    };

    const streamClient = client as grpc.Client & {
      StreamList: (
        req: Record<string, unknown>,
        md: grpc.Metadata,
      ) => grpc.ClientReadableStream<YouTubeLiveChatMessagesListResponseDto>;
    };

    // streamList はイベント駆動（data/end/error）なので、
    // 状態変数で AsyncIterable へ橋渡しする
    const stream = streamClient.StreamList(request, metadata);
    // 受信チャンクを一時的に貯めるキュー
    const queue: YouTubeLiveChatMessagesListResponseDto[] = [];
    // end 到達フラグ。true になったら新規受信は終了
    let done = false;
    // エラーを保持し、for-await 側で throw して上位へ伝播する
    let streamError: Error | null = null;
    // for-await 側が「次のデータ待ち」中に保持する resume 関数
    let wakeup: (() => void) | null = null;

    // data/end/error 受信時に待機中の for-await を起こす。
    const notify = () => {
      if (wakeup) {
        const fn = wakeup;
        wakeup = null;
        fn();
      }
    };

    stream.on("data", (chunk: YouTubeLiveChatMessagesListResponseDto) => {
      queue.push(chunk);
      notify();
    });
    stream.on("error", (error: Error) => {
      streamError = error;
      done = true;
      notify();
    });
    stream.on("end", () => {
      done = true;
      notify();
    });

    try {
      while (true) {
        if (queue.length > 0) {
          const chunk = queue.shift();
          if (chunk) {
            yield chunk;
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
      stream.cancel();
    }
  }
}
