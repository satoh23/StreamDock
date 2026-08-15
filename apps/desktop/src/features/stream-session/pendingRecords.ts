import type { CommentViewDto } from "../comment-viewer/types";

/**
 * 062b: **セッション id が確定するまでのコメント記録バッファ**（React 非依存の純関数）。
 *
 * ## なぜ必要か（これが無いと何が起きるか）
 *
 * Rust の `record_comment` は先頭で `require_non_empty(&session_id, …)` を撃ち、frontend の
 * `recordComments` は失敗を `.catch(() => {})` で握り潰す（fire-and-forget）。
 * ⇒ **セッション id が未確定の間に届いたコメントは、画面には出るのに DB には 1 件も残らない。**
 * しかも `app_logs` に固定安全文言が残るだけで、ユーザーには何も見えない。
 *
 * 未確定の窓は 2 か所ある（どちらも非同期 invoke の解決待ち）:
 * 1. 接続直後（`start_stream_session` の解決前）
 * 2. **配信中に窓を開き直した直後**（`close_stale_stream_sessions` → `get_active_stream_session` の解決前。
 *    sidecar が生きていればコメントは**待ってくれない**）
 *
 * 062b の動機は「記録は遡れない」なので、ここは**捨てずに貯めて、確定後に流す**。
 * ⚠ 表示・読み上げ・通知音・OBS は session id を必要としないので、**遅れるのは記録だけ**である。
 *
 * ## 上限を持つ理由
 *
 * invoke が永久に失敗する（DB が壊れている等）とバッファが無限に太るため、
 * 総コメント件数で上限を設ける。溢れたら**古いほうから捨てる**（新しいコメントのほうが、
 * 直後に確定するセッションに属する可能性が高い）。⚠ **捨てた件数は必ず数える**——
 * 黙って捨てると「動いているように見えて記録されない」＝ 062b が最も避けたい失敗になる。
 */

/** バッファに貯めておけるコメントの総数。 */
export const PENDING_RECORD_LIMIT = 500;

/** 記録待ちの 1 バッチ。 */
export interface PendingRecordBatch {
  comments: readonly CommentViewDto[];
  /**
   * 038c の判定（初見／久しぶり）コールバックを渡すか。
   *
   * ⚠ `mergeComments` の `added` は true、`updated`（043e の combo 更新）は false。
   * この区別を保たないと、combo 更新でバッジが再点灯する（043e の契約違反）。
   */
  withResult: boolean;
}

export interface EnqueueResult {
  next: PendingRecordBatch[];
  /** 上限超過で捨てたコメント件数（0 なら取りこぼしなし）。 */
  dropped: number;
}

/** バッファへ 1 バッチ積む（上限超過分は古いほうから捨てる）。 */
export function enqueuePendingRecords(
  prev: readonly PendingRecordBatch[],
  batch: PendingRecordBatch,
): EnqueueResult {
  if (batch.comments.length === 0) return { next: [...prev], dropped: 0 };

  const next = [...prev, batch];
  let total = next.reduce((sum, b) => sum + b.comments.length, 0);
  let dropped = 0;
  while (total > PENDING_RECORD_LIMIT && next.length > 0) {
    const oldest = next[0];
    // 最後の 1 バッチだけが残った状態で溢れている場合は、そのバッチの中を古いほうから削る
    //（バッチ単位で捨てると「1 バッチ 501 件」で全部消える）。
    if (next.length === 1) {
      const over = total - PENDING_RECORD_LIMIT;
      next[0] = { ...oldest, comments: oldest.comments.slice(over) };
      dropped += over;
      total -= over;
      break;
    }
    next.shift();
    dropped += oldest.comments.length;
    total -= oldest.comments.length;
  }
  return { next, dropped };
}
