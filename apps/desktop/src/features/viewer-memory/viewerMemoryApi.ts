import { invoke } from "@tauri-apps/api/core";
import type { CommentViewDto } from "../comment-viewer/types";
import type { ListViewersInput, ViewerDetail, ViewerRecord } from "./types";

/**
 * 038a: 視聴者メモリ（Rust 側 SQLite・端末内限定）の Tauri command 薄いラッパ。
 *
 * コンポーネントは invoke を直接呼ばず、この API 経由で操作する。保存は端末内のみで端末外へ出さず、
 * 新規の外部通信・宛先・capability は増えない（受信済みコメントを command で渡すだけ）。
 * `recordComment` 以外（一覧/詳細/メモ/削除）は 038b の UI から使う。
 */

/** 受信済みコメント 1 件を Rust の視聴者メモリへ記録する（視聴者 upsert＋集計・同一 id は冪等）。 */
export function recordComment(
  comment: CommentViewDto,
  sessionId: string,
): Promise<void> {
  return invoke<void>("record_comment", { comment, sessionId });
}

/**
 * 受信済みコメント群をまとめて記録する（表示/読み上げを止めない fire-and-forget）。
 *
 * 記録失敗は握り潰す（best-effort）。ログにも本文は出さない（§9）。`comments` は呼び出し側で
 * comment.id 重複排除済み（mergeComments の `added`）で、Rust 側も `INSERT OR IGNORE` で冪等。
 */
export function recordComments(
  comments: CommentViewDto[],
  sessionId: string,
): void {
  for (const comment of comments) {
    void recordComment(comment, sessionId).catch(() => {
      /* 視聴者メモリ記録の失敗はコメント表示・読み上げを妨げない（best-effort）。 */
    });
  }
}

/** 視聴者一覧（検索・並び替えは任意）。 */
export function listViewers(input?: ListViewersInput): Promise<ViewerRecord[]> {
  return invoke<ViewerRecord[]>("list_viewers", { input });
}

/** 視聴者の詳細（本人＋過去コメント）。 */
export function getViewer(id: string): Promise<ViewerDetail> {
  return invoke<ViewerDetail>("get_viewer", { id });
}

/** 配信者メモを更新して更新後の視聴者を返す。 */
export function updateViewerNote(
  id: string,
  note: string,
): Promise<ViewerRecord> {
  return invoke<ViewerRecord>("update_viewer_note", { id, note });
}

/** 視聴者を削除する（当該コメントも Rust 側 FK CASCADE で削除）。 */
export function deleteViewer(id: string): Promise<void> {
  return invoke<void>("delete_viewer", { id });
}

/** 全視聴者を削除する（プライバシー手段の全消去）。 */
export function clearViewers(): Promise<void> {
  return invoke<void>("clear_viewers");
}
