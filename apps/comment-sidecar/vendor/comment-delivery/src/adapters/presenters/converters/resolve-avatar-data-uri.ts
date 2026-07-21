// 036b: アバター画像の共通取得基盤（036c=Twitch でも再利用）。
//
// 投稿者アイコンの取得元 URL（ドメイン `User.avatar`）を受け取り、sidecar 内で画像を取得して
// `data:image/<mime>;base64,<...>` へ変換して返す。取得は起動時に置換済みの global `fetch`
// （fail-closed ホストガード経由）を通すため、allow-list 外ホスト（host-guard.ts）は自動で throw され
// 本関数は undefined を返す（→ overlay がグレー丸へフォールバック）。webview は data URI のみを踏み、
// 外部 URL を踏まない（親 036・§CSP の不変条件）。data URI/URL は DB/ログに出さない・キャッシュは
// メモリ内・上限付き・非永続（§9）。
//
// 設計方針（docs/tasks/036b-...・security.md「コメントビューア方針」⑩）:
//  - **全域関数（never throws）**: 失敗/タイムアウト/超過/非許可ホスト/MIME 不許可/空 URL はすべて undefined。
//    active 配信経路（src/index.ts）は per-comment try/catch を持たないため、本関数が throw しないことで
//    1 件の失敗がバッチ全体を巻き添えにしないことを担保する。
//  - **縮小はクライアント側で行わない**: YouTube は gRPC リクエストの `profile_image_size`（=48）で CDN から
//    小サイズ URL を受け取るため、ここでのデコード/リサイズは不要（新規依存ゼロ）。想定外の大きさは
//    バイト上限で遮断する。
//  - **投稿者 ID 単位キャッシュ**: アバターは滅多に変わらないため、同一投稿者は再 fetch しない。

/** 取得タイムアウト（ms）。ハング防止。 */
const FETCH_TIMEOUT_MS = 3000;
/** 画像バイト上限（128 KB）。48px アバターは数 KB のため十分な余裕を持ちつつ想定外の巨大応答を遮断する。 */
const MAX_IMAGE_BYTES = 128 * 1024;
/** 正キャッシュ件数上限（投稿者数）。超過時は最古から LRU 破棄。 */
const MAX_POSITIVE_ENTRIES = 500;
/** 負キャッシュ件数上限。 */
const MAX_NEGATIVE_ENTRIES = 500;
/** 負キャッシュ TTL（ms）。失敗直後の同一投稿者の再 fetch を抑制しつつ、期限切れで再取得を許可（一時失敗から回復）。 */
const NEGATIVE_TTL_MS = 5 * 60 * 1000;

/** data URI に載せてよい画像 MIME（Content-Type 完全一致で判定）。 */
const ALLOWED_MIME = new Set<string>([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

/**
 * emit 前の well-formed 検証ゲート。overlay は `background-image: url("<uri>")` で消費するため、
 * `"` / `)` / 空白等が混入しない**整形済み base64 data URI**であることを保証し外部 URL ブレイクアウトを防ぐ
 * （converter コメントが求める「唯一の egress 集約点での well-formed 保証」）。
 */
const DATA_URI_RE = /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;

/**
 * 成功データ URI の LRU キャッシュ（authorId → data URI）。TTL なし（LRU 破棄のみ）。
 * 意図: アバターは滅多に変わらないため投稿者 ID 単位で再 fetch を避ける。理由: 変更後は LRU 破棄まで stale だが
 *   一時表示のアイコンとしては許容範囲。再修正条件: アバター変更の即時反映が要件化したら正キャッシュにも TTL を導入する。
 */
const positiveCache = new Map<string, string>();
/** 失敗の負キャッシュ（authorId → 失効エポック ms）。 */
const negativeCache = new Map<string, number>();
/** 同一投稿者の同時 fetch を 1 本に集約する in-flight マップ。 */
const inFlight = new Map<string, Promise<string | undefined>>();

/** LRU: 参照/追加したキーを末尾へ移動し、上限超過時に最古（先頭）を破棄する。 */
function touchPositive(authorId: string, dataUri: string): void {
  positiveCache.delete(authorId);
  positiveCache.set(authorId, dataUri);
  while (positiveCache.size > MAX_POSITIVE_ENTRIES) {
    const oldest = positiveCache.keys().next().value;
    if (oldest === undefined) break;
    positiveCache.delete(oldest);
  }
}

function rememberFailure(authorId: string): void {
  negativeCache.set(authorId, Date.now() + NEGATIVE_TTL_MS);
  while (negativeCache.size > MAX_NEGATIVE_ENTRIES) {
    const oldest = negativeCache.keys().next().value;
    if (oldest === undefined) break;
    negativeCache.delete(oldest);
  }
}

/** 負キャッシュが有効（未失効）なら true。失効していれば削除して false。 */
function isNegativeCached(authorId: string): boolean {
  const expiry = negativeCache.get(authorId);
  if (expiry === undefined) return false;
  if (Date.now() < expiry) return true;
  negativeCache.delete(authorId);
  return false;
}

/** Content-Type からパラメータ（charset 等）を除いた MIME 本体を小文字で返す。 */
function normalizeMime(contentType: string | null): string | undefined {
  if (!contentType) return undefined;
  const mime = contentType.split(";", 1)[0]?.trim().toLowerCase();
  return mime && ALLOWED_MIME.has(mime) ? mime : undefined;
}

/**
 * 使わないと判断したレスポンス body を即解放する（本文を読まない早期 return パス用）。undici は GC 時に
 * body を自動 dump するため機能上は無くても漏れないが、高チャーン時に socket を早く返すため明示 cancel する。
 * never throws（cancel の失敗は握りつぶす／body が無ければ何もしない）。
 */
function discardBody(res: Response): void {
  void res.body?.cancel()?.catch(() => {});
}

/**
 * 画像を取得して data URI 化する（never throws）。バイト上限は Content-Length（詐称/欠落し得る）と
 * ストリーム実測の両建てで担保し、超過時点で読み取りを中断する。
 */
async function fetchAvatarDataUri(url: string): Promise<string | undefined> {
  try {
    const res = await fetch(url, {
      // タイムアウトでレスポンス/ボディ双方を abort する。
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      // リダイレクト追従はホストガードを迂回して非 allow-list 宛先へ出得るため fail-closed に禁止する
      // （ggpht/googleusercontent の画像は直接 200 応答。将来リダイレクトが必要になったら別途レビュー）。
      redirect: "error",
    });
    if (!res.ok) {
      discardBody(res);
      return undefined;
    }

    const mime = normalizeMime(res.headers.get("content-type"));
    if (!mime) {
      discardBody(res);
      return undefined;
    }

    // Content-Length があり上限超過なら本文を読まずに諦める（body は読まないので明示解放する）。
    const declaredLen = Number(res.headers.get("content-length"));
    if (Number.isFinite(declaredLen) && declaredLen > MAX_IMAGE_BYTES) {
      discardBody(res);
      return undefined;
    }

    const body = res.body;
    if (!body) return undefined;

    // ストリームで実測しながら上限で中断する（Content-Length を信用しない）。
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        total += value.byteLength;
        if (total > MAX_IMAGE_BYTES) {
          await reader.cancel();
          return undefined;
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }

    const base64 = Buffer.concat(chunks).toString("base64");
    const dataUri = `data:${mime};base64,${base64}`;
    return DATA_URI_RE.test(dataUri) ? dataUri : undefined;
  } catch {
    // ネットワーク失敗・タイムアウト・非許可ホスト（ホストガード throw）・リダイレクト等はすべて undefined。
    return undefined;
  }
}

/**
 * 投稿者アイコンの取得元 URL を data URI へ解決する。投稿者 ID 単位でキャッシュし、同一投稿者は
 * 再 fetch しない。取得できない場合は undefined（overlay はグレー丸へフォールバック）。
 *
 * @param authorId 投稿者 ID（キャッシュキー）
 * @param url ドメイン `User.avatar`（取得元 URL）。未取得時は undefined
 */
export async function resolveAvatarDataUri(
  authorId: string,
  url: string | undefined,
): Promise<string | undefined> {
  if (!authorId || !url) return undefined;

  const cached = positiveCache.get(authorId);
  if (cached !== undefined) {
    touchPositive(authorId, cached); // LRU 更新
    return cached;
  }
  if (isNegativeCached(authorId)) return undefined;

  const existing = inFlight.get(authorId);
  if (existing) return existing;

  const task = (async () => {
    const dataUri = await fetchAvatarDataUri(url);
    if (dataUri) {
      negativeCache.delete(authorId);
      touchPositive(authorId, dataUri);
    } else {
      rememberFailure(authorId);
    }
    return dataUri;
  })();

  inFlight.set(authorId, task);
  try {
    return await task;
  } finally {
    inFlight.delete(authorId);
  }
}

// テスト/診断用に内部を公開（本番経路では未使用）。
export const __avatarCacheInternals = {
  positiveCache,
  negativeCache,
  inFlight,
  MAX_IMAGE_BYTES,
  FETCH_TIMEOUT_MS,
};
