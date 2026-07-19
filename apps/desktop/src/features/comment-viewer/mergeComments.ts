import type { CommentViewDto } from "./types";

/**
 * 033f: 受信コメントの蓄積ロジック（append ＋ id 重複排除 ＋ 上限クランプ）。032c-a 以来
 * `CommentViewerApp` 内 local だったものを、OBS 透過オーバーレイ（`OverlayApp`）と共有するため切り出した
 * 純関数。**本体コメントビューとオーバーレイで完全に同じ表示（同一の重複排除・クランプ）を保証**する。
 */

/** 表示上限（超過分は古い方から捨てる＝末尾 MAX 件を保持）。 */
export const MAX_COMMENTS = 200;

/**
 * 既存リストに incoming を追加する。id 重複は排除し、上限を超えたら古い方から捨てる。
 *
 * 戻り値の `next` は表示用の全体リスト（上限クランプ後）、`added` は**重複排除後に実際に追加された
 * 新規行**。`added` を TTS enqueue の単一注入点として使う（表示上限でクランプされても読み上げ対象に
 * 含めるため、クランプ前の追加分を返す）。`OverlayApp` は読み上げしないため `next` のみ使う。
 */
export function mergeComments(
  prev: CommentViewDto[],
  incoming: CommentViewDto[],
): { next: CommentViewDto[]; added: CommentViewDto[] } {
  const seen = new Set(prev.map((c) => c.id));
  const merged = [...prev];
  const added: CommentViewDto[] = [];
  for (const c of incoming) {
    if (seen.has(c.id)) continue; // id 重複排除
    seen.add(c.id);
    merged.push(c);
    added.push(c);
  }
  // 上限クランプ（新しい順に末尾 MAX 件を残す）。
  const next =
    merged.length > MAX_COMMENTS
      ? merged.slice(merged.length - MAX_COMMENTS)
      : merged;
  return { next, added };
}
