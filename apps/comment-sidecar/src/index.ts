// 032c-b コミット2: Twitch Device Code ログイン＋EventSub/Helix 取得＋viewer への配信（インターネット解禁）。
//  - 起動直後に **installHttpHostGuard()** で global fetch を allow-list ガードに置換（DI 配線より前）。
//  - reflect-metadata → tsyringe DI（env ピン留め config＋guarded ws runtime）。
//  - 単一双方向 WS: viewer→sidecar 制御（start-login / start-session / stop-session）、
//    sidecar→viewer（device_code / session.state / comments.append）。
//  - Device Code は polling 前に user_code / verification_uri を viewer へテキスト提示（open 廃止）。
//  - 取得コメントは正規化して comments.append で送るのみ（端末外へ出さない）。トークン/device_code は非ログ。
//  - no-orphan 保険（ppid 監視 self-exit）は維持。
import "reflect-metadata";
import { WebSocket } from "ws";
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
// 035b（モック・一時・dev 動作確認補助）: env ゲート（COMMENT_SIDECAR_MOCK=1）でのみ有効な合成コメントソース。
// OFF（既定）では isMockEnabled() が false を返し mockSource=null＝現行の実取得経路が完全に無改変。副作用のない
// 純関数のみを import する（top-level 副作用ゼロ）。撤去はこの import と下の 1 ゲートを外し dev-mock.ts を消すだけ。
import { isMockEnabled, createMockCommentSource } from "./dev-mock.js";
// 044a: OBS 連携（方式A＝ウィンドウキャプチャ自動追加）。obs-websocket は loopback 4455 のみ・OBS 連携有効時のみ接続。
import {
  createObsClient,
  parseOverlayKind,
  type ObsOverlayKind,
} from "./obs/obs-client.js";
import {
  createThemeFontFetcher,
  createThemeImporter,
  THEME_FONT_MAX_BYTES,
  THEME_IMPORT_MAX_BYTES,
} from "./theme-import.js";
// 060h コミット 2: `theme-import.fetch` の**フレーム 1 件の処理**は純関数へ切り出した
// （`index.ts` は import できずテストで殺せないため・security-review 060c S-3）。
import {
  handleThemeImportFrame,
  THEME_FONT_FETCH_FRAME,
  THEME_IMPORT_FETCH_FRAME,
  type ThemeFrame,
} from "./theme-import-frame.js";

const WS_HOST = "127.0.0.1";
const PREFERRED_PORT = 17331;
const PORT_STDOUT_PREFIX = "COMMENT_SIDECAR_PORT=";
const PPID_WATCH_INTERVAL_MS = 1000;
const DEVICE_CODE_FRAME = "device_code";
const LINK_STATE_FRAME = "link.state";
// 044a: OBS 連携の状態を viewer へ通知する outbound フレーム（device_code/link.state と同じ bare literal 前例）。
const OBS_STATE_FRAME = "obs.state";
// 032c-b/032c-d′: ログイン永続化。token(JSON) は viewer WS には流さず、**stdout の専用行**（親子 private pipe）
// でのみ Rust へ渡し、Rust が OS キーチェーンへ保存する。復元は Rust→**stdin** の専用行で受ける（§9）。
// 032c-d′: twitch/youtube を統一するため各行に **provider を付与**する:
//   保存 = `COMMENT_SIDECAR_TOKEN=<provider> <json>` / 破棄 = `COMMENT_SIDECAR_TOKEN_CLEAR=<provider>` /
//   復元 = `COMMENT_SIDECAR_RESTORE=<provider> <json>`（json は JSON.stringify＝改行/空白なしなので先頭空白で分割可）。
const TOKEN_STDOUT_PREFIX = "COMMENT_SIDECAR_TOKEN=";
const TOKEN_CLEAR_STDOUT_PREFIX = "COMMENT_SIDECAR_TOKEN_CLEAR=";
const RESTORE_STDIN_PREFIX = "COMMENT_SIDECAR_RESTORE=";
// 044a: OBS WebSocket パスワードを Rust→stdin private pipe で受領する（loopback WS には載せない・非ログ・§9）。
const OBS_PW_STDIN_PREFIX = "COMMENT_SIDECAR_OBS_PW=";
const OBS_PW_CLEAR_STDIN_PREFIX = "COMMENT_SIDECAR_OBS_PW_CLEAR=";
// 060c: テーマ取り込みチケットを Rust→stdin private pipe で受領する（非ログ・§9）。
// ⚠⚠ **これが無いと `theme-import.fetch` は「同意を経ない egress トリガー」になる**——loopback WS は
// 未認証で、ブラウザで開いた悪意あるページも `ws://127.0.0.1:<port>` へ繋げるため。
// 詳細は Rust 側 `comment_sidecar/mod.rs` の `THEME_TICKET_PREFIX` の注記。
const THEME_TICKET_STDIN_PREFIX = "COMMENT_SIDECAR_THEME_TICKET=";
/**
 * 060c: 制御フレームで受け付けるチケット文字列の上限（文字数）。
 * 実物は uuid v4 の simple 形＝32 文字なので、余裕をみた値。⚠ 上限の理由は `parseControlFrame` の注記。
 */
const THEME_TICKET_MAX_CHARS = 128;
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
  | { type: "stop-session"; service: Provider }
  // 044a: OBS 連携。port は Rust の read-only 検出由来（非秘密）。パスワードは WS には載せず stdin で受領する。
  // 046d/061a: overlay は対象種別（comments=コメント一覧 / pinned=固定コメント / effects=エフェクト）。
  // **固定 union のみ受理**で、実ソース名/窓名は sidecar 内の表に閉じている（viewer から任意の名前は渡せない）。
  | { type: "obs-enable"; port: number; overlay: ObsOverlayKind }
  // 044a: オーバーレイ表示 OFF 連動＝OBS 側ソースを削除せず非表示にする（port は再表示と同じ検出値）。
  | { type: "obs-hide"; port: number; overlay: ObsOverlayKind }
  | { type: "obs-disable" }
  // 060c/060h: 外部 `@import` と `@font-face` の実体の取り込み時スナップショット。
  // **1 フレーム 1 URL**（バッチ取得しない）。⚠ 形と処理は `theme-import-frame.ts` にある。
  | ThemeFrame;

/*
 * 061a: `parseOverlayKind`（制御フレームの `overlay` を固定 union へ正規化する allow-list）は
 * **`obs/obs-client.ts` へ移した**（上の import）。046d の JSDoc が予告していた再修正トリガー①
 * 「`ObsOverlayKind` に 3 つ目の値を足すとき」に到達したため。
 *
 * ⚠ 移動先が予告（`obs/obs-helpers.ts`）と違う理由と、テストを足せるようになった経緯は
 * **移動先の JSDoc が正**。ここで再掲しない（2 か所に書くと片方だけ古くなる）。
 * ⚠ 呼び出し側（下の `parseControlFrame` の `obs-enable` / `obs-hide` 分岐）は無改変。
 */

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
  if (m.type === "obs-enable") {
    // port は数値 [1,65535] のみ受理（host は sidecar 側で 127.0.0.1 に固定＝viewer は host を指定できない）。
    // S1(修正不要): host が loopback 固定のため任意 port でも egress は発生せず loopback 内に留まる。よって port は
    // 検出値に固定していない。再修正トリガー: 検出ポート以外への接続を禁じたくなったら sidecar 側で直近 detect の
    // port を保持して照合する。
    const port = (msg as { port?: unknown }).port;
    if (
      typeof port === "number" &&
      Number.isInteger(port) &&
      port >= 1 &&
      port <= 65535
    ) {
      return {
        type: "obs-enable",
        port,
        overlay: parseOverlayKind((msg as { overlay?: unknown }).overlay),
      };
    }
    return null;
  }
  if (m.type === "obs-hide") {
    // obs-enable と同じ port 検証（数値 [1,65535]・host は sidecar 側で 127.0.0.1 に固定）。
    const port = (msg as { port?: unknown }).port;
    if (
      typeof port === "number" &&
      Number.isInteger(port) &&
      port >= 1 &&
      port <= 65535
    ) {
      return {
        type: "obs-hide",
        port,
        overlay: parseOverlayKind((msg as { overlay?: unknown }).overlay),
      };
    }
    return null;
  }
  if (m.type === "obs-disable") {
    return { type: "obs-disable" };
  }
  if (m.type === THEME_IMPORT_FETCH_FRAME || m.type === THEME_FONT_FETCH_FRAME) {
    // 060c: 受理条件を**すべて**満たすときだけフレームを組む（`obs-enable` と同じ作法＝
    // `msg` をスプレッドせず明示構築するので、未検証フィールドは 1 つも混入しない）。
    // ⚠ **範囲外の maxBytes はクランプせず拒否する**（誤りを黙って直すと、送り手の想定と
    // 実際の上限が食い違ったまま動く。クランプは取得本体側の「天井」としてだけ効かせる）。
    // ⚠⚠ 060h: **CSS とフォントで受理条件を分けない**（`maxBytes` の天井だけが違う）。
    // 分けると「新しいフレームだけ検査が甘い」形が作れる。
    const isFont = m.type === THEME_FONT_FETCH_FRAME;
    const maxBytesCeiling = isFont ? THEME_FONT_MAX_BYTES : THEME_IMPORT_MAX_BYTES;
    const f = msg as {
      ticket?: unknown;
      requestId?: unknown;
      url?: unknown;
      maxBytes?: unknown;
    };
    if (
      typeof f.ticket === "string" &&
      f.ticket.length > 0 &&
      // ⚠ 長さの上限も見る（security-review 060c S-5）。`url` は 2048、`maxBytes` は範囲検査済みなのに
      // `ticket` だけ無制限だと、**未認証の loopback クライアント**が巨大文字列を送るだけで
      // `Buffer.from()` の確保を強いられる。実物は 32 文字の hex（uuid v4 simple）なので余裕をみて 128。
      f.ticket.length <= THEME_TICKET_MAX_CHARS &&
      typeof f.requestId === "number" &&
      Number.isInteger(f.requestId) &&
      f.requestId >= 0 &&
      f.requestId < 2 ** 31 &&
      typeof f.url === "string" &&
      f.url.length > 0 &&
      f.url.length <= 2048 &&
      typeof f.maxBytes === "number" &&
      Number.isInteger(f.maxBytes) &&
      f.maxBytes >= 1 &&
      f.maxBytes <= maxBytesCeiling
    ) {
      return isFont
        ? {
            type: THEME_FONT_FETCH_FRAME,
            ticket: f.ticket,
            requestId: f.requestId,
            url: f.url,
            maxBytes: f.maxBytes,
          }
        : {
            type: THEME_IMPORT_FETCH_FRAME,
            ticket: f.ticket,
            requestId: f.requestId,
            url: f.url,
            maxBytes: f.maxBytes,
          };
    }
    return null;
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

/**
 * 060c: **要求元のクライアント 1 本にだけ**フレームを送る。
 *
 * ⚠⚠ `output.broadcastMessage` は全 WS クライアントへ配るので、取得した CSS 本文が
 * オーバーレイ窓にも届いてしまう（§9「必要のない窓へ配らない」）。制御ハンドラには要求元の
 * ソケットが渡ってくるので、それを使う。**vendor は 1 行も触っていない。**
 */
function sendToClient(client: WebSocket, message: unknown): void {
  if (client.readyState === WebSocket.OPEN) {
    client.send(JSON.stringify(message));
  }
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
  // 032c-b/032c-d′: token の save/clear を stdout の専用行（provider 付き）で Rust へ伝え、Rust が OS
  // キーチェーンへ永続化する。token は viewer WS には流さず、親子 private pipe（stdout）のみを通る（§9）。
  const authClient = createAuthClient({
    onTokenPersist: (provider, plain) => {
      if (plain === null) {
        process.stdout.write(`${TOKEN_CLEAR_STDOUT_PREFIX}${provider}\n`);
      } else {
        process.stdout.write(
          `${TOKEN_STDOUT_PREFIX}${provider} ${JSON.stringify(plain)}\n`,
        );
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

  // 044a: OBS 連携クライアント。状態は obs.state で viewer へ通知（UI のトグル状態・失敗時の手動誘導に使う）。
  // パスワードは下の stdin 受領（COMMENT_SIDECAR_OBS_PW=）で in-memory に設定する（loopback WS には載せない）。
  const obsClient = createObsClient((state, reason) => {
    output.broadcastMessage({
      type: OBS_STATE_FRAME,
      payload: { state, ...(reason ? { reason } : {}) },
    });
  });

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
  // 再接続時・ログイン成功時・keychain 復元時・認可失効時に送り、viewer が platform 別に「接続済み/未接続」を
  // 反映できる。032c-d′: YouTube も keychain 復元されるため、起動直後に復元済みなら「接続済み」を反映する。
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

  // 032c-b/032c-d′: Rust が stdin へ書いた復元行のトークンをメモリへ復元する（keychain→メモリ）。provider
  // 別（twitch/youtube）に復元する。ネットワークは張らない（取得は start-session で明示）。復元できたら
  // link.state を送って viewer に「接続済み」を反映。
  const restoreToken = async (
    provider: Provider,
    json: string,
  ): Promise<void> => {
    const plain = parseTokenPlain(json);
    if (!plain) return;
    try {
      await authClient.restoreToken(provider, plain);
      logInfo(`[comment-sidecar] ${provider} login restored from keychain`);
      void sendLinkState(provider);
    } catch {
      logInfo(`[comment-sidecar] ${provider} token restore failed`);
    }
  };

  // 取得パイプラインの出力: Comment → 正規化 → comments.append で viewer へ送る（端末外に出さない）。
  const outputPort: CommentOutputPort = {
    outputComments: async (comments: Comment[]): Promise<void> => {
      // 036b: convertCommentToViewDto は avatar 解決（画像 fetch）で async 化。順序を保って解決してから
      // 到着順に broadcast する（同一投稿者は resolveAvatarDataUri のキャッシュ/in-flight で重複 fetch しない）。
      // 036b レビュー申し送り（apply-review・いずれも現状は許容の設計判断）:
      //  - レイテンシ: Promise.all は最も遅い avatar fetch（≤FETCH_TIMEOUT_MS=3s）までバッチ全体の broadcast を待たせる。
      //    通常 CDN 応答は速く初回のみ・キャッシュ後は即時のため許容。再修正条件: 実配信でバッチ表示遅延が問題化したら
      //    コメントを即 broadcast → avatar は後追い更新メッセージで送るデカップリングへ切り替える（大きめの設計変更）。
      //  - ファンアウト: 1 バッチ内の未キャッシュ別投稿者数だけ fetch が並列化し得る（各 3s/128KB で有界）。再修正条件:
      //    初回バッチのピーク socket/メモリが問題化したら簡易セマフォ（同時 6〜8 本・依存追加なし）で平滑化する。
      //  - 全滅回避: resolveAvatarDataUri は never throws（唯一の async 要因）ため Promise.all は reject しない。再修正条件:
      //    将来 convertCommentToViewDto に avatar 以外の throw 要因が増えたら Promise.allSettled / per-item try-catch へ。
      const views = await Promise.all(comments.map(convertCommentToViewDto));
      for (const view of views) {
        output.broadcastMessage({
          type: COMMENT_DELIVERY_MESSAGE_TYPES.COMMENTS_APPEND,
          payload: { comment: toCanonicalComment(view) },
        });
      }
    },
  };

  // 035a: 取得セッションの排他を provider 別に分離する（Twitch と YouTube を同時取得できるようにする）。
  // provider ごとに独立した AbortController を保持し、片方の取得開始は他方を止めない。取得コメントは
  // 従来どおり comments.append（source 別）で流れ、下流のマージ/表示は無改修で両者が 1 リストに並ぶ。
  const sessionAborts = new Map<Provider, AbortController>();
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
  // Rust opener で開く（onOpenAuthUrl → stdout）。032c-d′: 成功でトークンは keychain 永続化（Twitch と同様）。
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
    // 035a: 自 provider（twitch）の既存セッションのみ差し替える（youtube は温存＝並行取得を維持）。
    sessionAborts.get("twitch")?.abort();
    const abort = new AbortController();
    sessionAborts.set("twitch", abort);
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
      // 自分が現在の entry の時だけ削除する（再開始で差し替わっていたら触らない＝レース回避）。
      if (sessionAborts.get("twitch") === abort) {
        sessionAborts.delete("twitch");
      }
    }
  };

  // 032c-d: YouTube 取得セッション（gRPC streamList）。チャンネル名不要（mine=true で自アカウントの
  // アクティブ配信を検出）。035a: provider 別セッションで Twitch と並行取得する（自 provider の既存
  // セッションのみ差し替え、twitch は温存）。取得コメントは既存の outputPort（→ comments.append・
  // source:'youtube'）に流す。クォータ枯渇は runYouTubePipeline 内で graceful stop（FAILED 通知・hot-loop しない）。
  const startYouTubeSession = async (): Promise<void> => {
    // 035a: 自 provider（youtube）の既存セッションのみ差し替える（twitch は温存＝並行取得を維持）。
    sessionAborts.get("youtube")?.abort();
    const abort = new AbortController();
    sessionAborts.set("youtube", abort);
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
      // 自分が現在の entry の時だけ削除する（再開始で差し替わっていたら触らない＝レース回避）。
      if (sessionAborts.get("youtube") === abort) {
        sessionAborts.delete("youtube");
      }
    }
  };

  // 035b（モック・一時・env ゲート）: COMMENT_SIDECAR_MOCK=1 のときだけ合成コメントソースを構築する。既定は null で、
  // 下の setControlMessageHandler / shutdown の分岐はすべて null ガード＝OFF 時は現行経路が無改変。ON 時も実ネットには
  // 出ない（runTwitch/YouTubePipeline・authClient.login* を呼ばず、既存 WS へ合成フレームを流すだけ）。
  const mockSource = isMockEnabled()
    ? createMockCommentSource({ output, sendSessionState, logInfo })
    : null;
  if (mockSource) {
    logInfo("[comment-sidecar] MOCK MODE enabled (COMMENT_SIDECAR_MOCK=1; no real network egress)");
  }

  // 060c: 外部 `@import` の取り込み時スナップショット。
  // ⚠ 取得の入口はここ 1 か所だけで、実体（ガード → DNS 検査 → 取得）は `theme-import.ts` にある。
  const fetchThemeCss = createThemeImporter();
  // 060h: フォント実体の取得（**別ガード・別枠のレート制限**）。⚠ ここも引数なしで作ること
  // （`fetchImpl` を渡すとガードを迂回できる唯一の形になる・静的検査が固定している）。
  const fetchThemeFont = createThemeFontFetcher();
  // 060c: Rust が起動時に stdin private pipe で渡すチケット。**受領するまでは `null`＝どのフレームも通さない**
  // （fail-closed）。⚠ **ログにも WS にも出さない**（§9）。
  let themeImportTicket: string | null = null;

  output.setControlMessageHandler((raw, client) => {
    const frame = parseControlFrame(raw);
    if (!frame) return;
    if (
      frame.type === THEME_IMPORT_FETCH_FRAME ||
      frame.type === THEME_FONT_FETCH_FRAME
    ) {
      // ⚠⚠ 060h コミット 2: **フレーム 1 件の処理は `theme-import-frame.ts` の純関数**にある。
      // 本ファイルは top-level で `main()` を呼ぶため import できず `scripts/test-*.mjs` の対象外＝
      // ここに処理を書くと**チケット照合・unicast・fail-closed がミューテーションで生存する**
      // （060c 時点の実態。担保は実機確認⑧だけだった・security-review 060c S-3）。
      // ⚠ **この分岐に判断を書き戻さないこと。** ここが持ってよいのは「配線」だけである。
      // ⚠⚠ `send` には **`sendToClient` を要求元 1 本に束ねたもの**を渡す（`broadcastMessage` を渡さない）。
      // オーバーレイ窓も同じ WS に読み取り専用で繋がっており、取得した CSS 本文を配る理由が無い（§9）。
      void handleThemeImportFrame({
        frame,
        ticket: themeImportTicket,
        send: (message) => sendToClient(client, message),
        fetchThemeCss,
        fetchThemeFont,
      });
      // ⚠ 取得先 URL も CSS 本文も**ログに出さない**（§9）。件数すら出さない。
      return;
    }
    // 044a: OBS 連携はモック/実取得のどちらとも独立。mock 分岐より前で処理して早期 return する
    //（mockSource は OBS フレームを解さないため渡さない）。接続はオンデマンド・失敗は obs.state で通知。
    if (frame.type === "obs-enable") {
      void obsClient.enable(frame.port, frame.overlay);
      return;
    }
    if (frame.type === "obs-hide") {
      void obsClient.hide(frame.port, frame.overlay);
      return;
    }
    if (frame.type === "obs-disable") {
      obsClient.disable();
      return;
    }
    // 035b（モック・一時）: ON のときは実ハンドラの手前で合成応答へ振り分けて早期 return する（実取得は起動しない）。
    // OFF（mockSource=null）ではこの 1 行を素通りし、以降の実ハンドラ本体は無改変。
    if (mockSource) {
      mockSource.handleControl(frame);
      return;
    }
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
      // 035a: 該当 provider の取得のみ停止する（他 provider は継続＝並行取得を止めない）。
      // アクティブでなくても該当パネルは idle 表示にする。delete と startXxx の finally の
      // `=== abort` ガードは両立する（entry 消失後は finally が no-op）。
      sessionAborts.get(frame.service)?.abort();
      sessionAborts.delete(frame.service);
      sendSessionState(frame.service, "idle");
    }
  });

  // 032c-b/032c-d/032c-d′: viewer が（再）接続したら現在のログイン状態を platform 別に送る（twitch/youtube とも
  // keychain 復元済みログインを反映する）。
  output.setConnectionHandler(() => {
    void sendLinkState("twitch");
    void sendLinkState("youtube");
  });

  // 032c-b/032c-d: 認可失効（refresh 失敗など）で token が破棄されたら link.state を更新する
  //（032c-d′: twitch/youtube とも PersistingTokenStore.clear → Rust が該当 provider の keychain を削除）。両 platform を更新。
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
    // 035a: no-orphan / シグナル / stdin close いずれでも全 provider の取得を止める（片方も止め残さない）。
    for (const abort of sessionAborts.values()) abort.abort();
    // 035b（モック・一時）: モック ON なら合成タイマーも全停止する（OFF=null で no-op）。
    mockSource?.stopAll();
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

  // 032c-b/032c-d′: Rust が起動時に stdin へ書く復元行（COMMENT_SIDECAR_RESTORE=<provider> <json>）を読み、
  // provider 別にログインをメモリへ復元する。行区切りでバッファリングして解析する（stdin は close 監視にも
  // 使うので data も購読）。
  let stdinBuf = "";
  process.stdin.on("data", (chunk: Buffer) => {
    stdinBuf += chunk.toString("utf8");
    let nl: number;
    while ((nl = stdinBuf.indexOf("\n")) !== -1) {
      const line = stdinBuf.slice(0, nl).trim();
      stdinBuf = stdinBuf.slice(nl + 1);
      if (line.startsWith(RESTORE_STDIN_PREFIX)) {
        // 先頭の provider（twitch/youtube・空白区切り）を切り出し、残りを token JSON として復元する。
        const rest = line.slice(RESTORE_STDIN_PREFIX.length);
        const sep = rest.indexOf(" ");
        if (sep !== -1) {
          const rawProvider = rest.slice(0, sep);
          const provider: Provider | null =
            rawProvider === "twitch" || rawProvider === "youtube"
              ? rawProvider
              : null;
          if (provider) void restoreToken(provider, rest.slice(sep + 1));
        }
      } else if (line.startsWith(OBS_PW_CLEAR_STDIN_PREFIX)) {
        // 044a: OBS パスワード破棄（keychain 削除に連動）。in-memory を消す。
        obsClient.setPassword(null);
      } else if (line.startsWith(OBS_PW_STDIN_PREFIX)) {
        // 044a: OBS パスワードを in-memory に設定（loopback WS には出さない・ログにも出さない）。
        obsClient.setPassword(line.slice(OBS_PW_STDIN_PREFIX.length));
      } else if (line.startsWith(THEME_TICKET_STDIN_PREFIX)) {
        // 060c: テーマ取り込みチケットを in-memory に設定（loopback WS にも出さない・非ログ・§9）。
        // ⚠ 空文字は受けない（受けると「長さ 0 のチケット」で誰でも通る形になる）。
        const value = line.slice(THEME_TICKET_STDIN_PREFIX.length);
        if (value.length > 0) themeImportTicket = value;
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
