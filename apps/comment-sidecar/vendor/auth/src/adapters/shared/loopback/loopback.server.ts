import http from "node:http";
import { URL } from "node:url";

const DEFAULT_CALLBACK_PATH = "/callback";
const LOOPBACK_HOST = "127.0.0.1";

export class LoopbackOAuthError extends Error {
  readonly oauthError?: string;
  readonly oauthErrorDescription?: string;

  constructor(
    message: string,
    oauthError?: string,
    oauthErrorDescription?: string,
  ) {
    super(message);
    this.name = "LoopbackOAuthError";
    this.oauthError = oauthError;
    this.oauthErrorDescription = oauthErrorDescription;
  }
}

type CreateLoopbackOAuthCallbackServerOptions = {
  expectedState: string;
  timeoutMs: number;
  /** @default "/callback" */
  callbackPath?: string;
};

type LoopbackOAuthCallbackServer = {
  readonly redirectUri: string;
  /** 認可コード。タイムアウト・state 不一致・OAuth error・code 欠落で reject */
  readonly authorizationCode: Promise<string>;
  close: () => Promise<void>;
};

function sendHtml(
  res: http.ServerResponse,
  status: number,
  title: string,
  body: string,
): void {
  const html = `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body><p>${escapeHtml(body)}</p></body></html>`;
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * RFC 8252 向けループバックリスナー。127.0.0.1 のランダムポートで待ち受け、
 * 1 回目の GET callbackPath のみ処理してサーバーを閉じる。
 */
export async function createLoopbackOAuthCallbackServer(
  options: CreateLoopbackOAuthCallbackServerOptions,
): Promise<LoopbackOAuthCallbackServer> {
  const callbackPath = options.callbackPath ?? DEFAULT_CALLBACK_PATH;

  let settled = false;
  let server: http.Server | undefined;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  let resolveCode!: (code: string) => void;
  let rejectCode!: (err: Error) => void;

  const finish = (fn: () => void): void => {
    if (settled) {
      return;
    }
    settled = true;
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
      timeoutId = undefined;
    }
    fn();
  };

  const close = (): Promise<void> =>
    new Promise((resolve, reject) => {
      if (server === undefined) {
        resolve();
        return;
      }
      const s = server;
      server = undefined;
      s.close((err) => (err ? reject(err) : resolve()));
    });

  server = http.createServer((req, res) => {
    if (settled) {
      res.writeHead(404);
      res.end();
      return;
    }

    if (req.method !== "GET") {
      res.writeHead(405);
      res.end();
      return;
    }

    let url: URL;
    try {
      url = new URL(
        req.url ?? "/",
        `http://${req.headers.host ?? LOOPBACK_HOST}`,
      );
    } catch {
      res.writeHead(400);
      res.end("不正なリクエストです。");
      return;
    }

    if (url.pathname !== callbackPath) {
      res.writeHead(404);
      res.end("ページが見つかりません。");
      return;
    }

    const state = url.searchParams.get("state");
    const code = url.searchParams.get("code");
    const oauthError = url.searchParams.get("error");
    const oauthErrorDescription = url.searchParams.get("error_description");

    // NOTE: OAuth の CSRF 対策。今回のログイン試行に紐づかない callback は reject する。
    if (state !== options.expectedState) {
      finish(() => {
        sendHtml(
          res,
          400,
          "認可の検証に失敗しました",
          "認可の検証に失敗しました。もう一度お試しください。",
        );
        void close();
        rejectCode(
          new LoopbackOAuthError("OAuth コールバックの state が一致しません。"),
        );
      });
      return;
    }

    // NOTE: 認可サーバーが error を返した場合は code を使わず失敗として確定する。
    if (oauthError !== null && oauthError !== "") {
      const desc =
        oauthErrorDescription !== null && oauthErrorDescription !== ""
          ? oauthErrorDescription
          : undefined;
      finish(() => {
        sendHtml(
          res,
          400,
          "ログインに失敗しました",
          desc ??
            "認可サービスからエラーが返されました。もう一度お試しください。",
        );
        void close();
        rejectCode(
          new LoopbackOAuthError(
            `OAuth エラーが返されました: ${oauthError}`,
            oauthError,
            desc,
          ),
        );
      });
      return;
    }

    if (code === null || code === "") {
      finish(() => {
        sendHtml(
          res,
          400,
          "認可コードがありません",
          "認可コードがありません。",
        );
        void close();
        rejectCode(
          new LoopbackOAuthError(
            "OAuth コールバックに認可コードがありません。",
          ),
        );
      });
      return;
    }

    finish(() => {
      sendHtml(
        res,
        200,
        "ログインに成功しました",
        "ログイン処理を続けています。このウィンドウは閉じて構いません。",
      );
      void close();
      resolveCode(code);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server!.listen(0, LOOPBACK_HOST, () => resolve());
    server!.once("error", reject);
  });

  const addr = server!.address();
  if (addr === null || typeof addr === "string") {
    await close();
    throw new Error(
      "ログイン用の一時サーバーを起動できませんでした。もう一度お試しください。",
    );
  }

  const redirectUri = `http://${LOOPBACK_HOST}:${addr.port}${callbackPath}`;

  const authorizationCode = new Promise<string>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });

  timeoutId = setTimeout(() => {
    finish(() => {
      void close();
      rejectCode(new LoopbackOAuthError("OAuth callback timed out"));
    });
  }, options.timeoutMs);

  return {
    redirectUri,
    authorizationCode,
    close,
  };
}
