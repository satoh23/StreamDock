import type { CommentViewDto } from "../comment-viewer/types";

/**
 * 062b: 「1 回の配信」の境界判定（**React/DOM 非依存の純関数**）。
 *
 * `CommentViewerApp` が持つ接続状態（provider 別の `session.state`）と受信コメントから、
 * 「いまセッションを開始/継続すべきか、終了へ向かうべきか」だけを決める。実際の
 * invoke・タイマー・state 更新は呼び出し側（`CommentViewerApp`）の責務で、ここは単体でテストできる形に保つ
 * （`firstOfStream.ts` / `monetaryFeed.ts` / `connectionStatus.ts` と同じ作法）。
 *
 * ## セッションの境界（062b の決定）
 *
 * - **開始**: どれかの provider が `connected` になった瞬間／**コメントが届いた瞬間**（下記）。
 * - **継続**: 猶予中に `connected` へ戻る、またはコメントが届く。
 * - **終了**: 全 provider が `connected` でなくなってから `SESSION_END_GRACE_MS` 経過。
 *
 * ⚠⚠ **「コメントが届いた＝配信は生きている」を独立した根拠として扱う**のが 062b の要点のひとつ。
 * sidecar は **WS が繋がるたびに `session.state = idle` のスナップショットを送る**（しかも状態が
 * 変化するまで `connected` を送り直さない）ため、接続状態だけを信じると
 * 「配信中なのに全 provider が待機に見える」状態が生まれる。コメントの到着はその誤認を必ず打ち消す。
 */

/** 配信プラットフォーム（Rust の allow-list と同じ 2 語）。 */
export type StreamPlatform = "twitch" | "youtube";

/**
 * 全 provider が切断されてからセッションを終了するまでの猶予（ミリ秒）。
 *
 * ⚠⚠ Rust 側の `stream_session::service::STALE_GRACE_MINUTES`（30 分）と**対**だが別物である。
 * こちらは「アプリが動いている間のライブ判定」、あちらは「強制終了・窓の閉じ忘れで宙ぶらりんに
 * なった行を次の起動／次のマウントで拾う網」。
 * **不変条件: Rust 側の猶予はこちら以上であること。** Rust 側を短くすると、こちらがまだ
 * 「猶予中（配信は続いている）」と思っているセッションを回収が先回りして閉じてしまう。
 */
export const SESSION_END_GRACE_MS = 30 * 60 * 1000;

/** 昇順・重複なしへ正規化する（Rust 側の保存順と揃える）。 */
function normalize(platforms: readonly string[]): StreamPlatform[] {
  const known = platforms.filter(
    (p): p is StreamPlatform => p === "twitch" || p === "youtube",
  );
  return [...new Set(known)].sort();
}

/**
 * いま「配信を取得できている」プラットフォーム。
 *
 * ⚠ **`connected` だけを生存とみなす**（`idle` / `connecting` / `failed` はいずれも未接続扱い）。
 * `failed` を特別扱いしない理由＝リトライ中に猶予タイマーが動き始めても、猶予は 30 分あり、
 * 復帰（`connected` かコメント到着）で必ず取り消されるため。状態語ごとに分岐を増やすより、
 * 「取得できている＝ `connected`」の 1 本の規則で説明できるほうが壊れにくい。
 * ⚠ `deriveConnectionStatus`（表示用）とは目的が別なので共有しない——あちらは 4 状態の**表示**を導く。
 */
export function connectedPlatforms(
  twitchState: string,
  youtubeState: string,
): StreamPlatform[] {
  const live: StreamPlatform[] = [];
  if (twitchState === "connected") live.push("twitch");
  if (youtubeState === "connected") live.push("youtube");
  return live;
}

/**
 * 受信バッチに含まれるプラットフォーム（＝コメントが実際に流れてきた経路）。
 *
 * セッションが無いときの「その場で開始する」判断に使う。⚠ `source` は WS 境界を跨いだ値なので、
 * 既知の 2 語以外は落とす（Rust 側の allow-list と二重）。
 */
export function platformsOfComments(
  comments: readonly CommentViewDto[],
): StreamPlatform[] {
  return normalize(comments.map((c) => c.source));
}

/**
 * 記録済みのプラットフォーム集合に、今回の分で**増えるものがあるか**。
 *
 * ⚠ 減る方向は見ない（片方が切れても `platforms` から消さない＝「この配信は両方でやった」が正しい記録）。
 * 増分が無いときに invoke を投げないための判定でもある（コメントのたびに Rust を叩かない）。
 */
export function needsPlatformUpdate(
  recorded: readonly string[],
  incoming: readonly string[],
): boolean {
  const known = new Set<string>(recorded);
  return normalize(incoming).some((p) => !known.has(p));
}
