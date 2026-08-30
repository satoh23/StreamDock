import type { GachaDrawOutcome } from "../../screens/obs-effects/effectFire";

/**
 * 063h 穴 C: **セッション id が確定するまでのガチャ記録バッファ**（React 非依存の純関数）。
 *
 * ## なぜ必要か（これが無いと何が起きるか）
 *
 * Rust の `record_gacha_draw` は先頭で `require_non_empty(&session_id, …)` を撃ち、frontend の
 * `recordGachaDraws` は失敗を `.catch(() => {})` で握り潰す（fire-and-forget）。
 * ⇒ ⚠⚠⚠ **セッション id が未確定の間に起きた抽選は、演出は出るのに DB には 1 件も残らない。**
 * 062b が「画面に出たのに DB に無い」を最も避けた失敗と呼んでいるのと**同じ形**である。
 *
 * 未確定の窓は 062b と同じ 2 か所（どちらも非同期 invoke の解決待ち）:
 * 1. 接続直後（`start_stream_session` の解決前）
 * 2. **配信中に窓を開き直した直後**（`close_stale_stream_sessions` → `get_active_stream_session`
 *    の解決前。sidecar が生きていればコメントは**待ってくれない**）
 *
 * ## ⚠⚠ `pendingRecords.ts` を汎用化していない理由
 *
 * あちらは 062b の担保（バッチ単位・`withResult` の区別・上限 500）を持っている**現役のコード**で、
 * 型を広げると**コメント記録側の回帰リスク**を作る。⇒ **同じ構え**（上限つき・捨てたら黙らせない）の
 * **小さな専用バッファ**を新設した。⚠ 2 つを統合したくなったら、まずあちらの
 * `withResult`（038c の初見バッジ）が何を守っているかを読むこと。
 *
 * ## 上限を持つ理由
 *
 * invoke が永久に失敗する（DB が壊れている等）とバッファが無限に太るため上限を設ける。
 * 溢れたら**古いほうから捨てる**（新しい抽選のほうが、直後に確定するセッションに属する可能性が高い）。
 * ⚠⚠ **捨てた件数は必ず数える**——黙って捨てると「動いているように見えて記録されない」になる。
 */

/**
 * バッファに貯めておける抽選の件数。
 *
 * ⚠ **コメントの上限（`PENDING_RECORD_LIMIT` ＝ 500）より小さくてよい。**
 * 抽選は**条件に当たったコメントでしか起きない**うえ、バースト上限（5 秒に 3 件）と
 * 条件ごとのクールダウン（10 秒）が上流で縛っているので、未確定の数秒で 100 件に届くことはない。
 * ⚠ 再修正トリガー＝実機で「記録できなかったガチャ」が出たとき（そのときは上限ではなく
 * **セッション確定が遅れている理由**のほうを疑うこと）。
 */
export const PENDING_GACHA_DRAW_LIMIT = 100;

export interface EnqueueGachaDrawsResult {
  next: GachaDrawOutcome[];
  /** 上限超過で捨てた抽選の件数（0 なら取りこぼしなし）。 */
  dropped: number;
}

/**
 * バッファへ積む（上限超過分は**古いほうから**捨てる）。
 *
 * ⚠ バッチ単位ではなく**抽選 1 件単位**で持つ（`pendingRecords` がバッチ単位なのは
 * `withResult` をバッチごとに区別する必要があるからで、こちらにはその区別が無い）。
 */
export function enqueuePendingGachaDraws(
  prev: readonly GachaDrawOutcome[],
  draws: readonly GachaDrawOutcome[],
): EnqueueGachaDrawsResult {
  if (draws.length === 0) return { next: [...prev], dropped: 0 };
  const merged = [...prev, ...draws];
  if (merged.length <= PENDING_GACHA_DRAW_LIMIT) {
    return { next: merged, dropped: 0 };
  }
  const dropped = merged.length - PENDING_GACHA_DRAW_LIMIT;
  return { next: merged.slice(dropped), dropped };
}
