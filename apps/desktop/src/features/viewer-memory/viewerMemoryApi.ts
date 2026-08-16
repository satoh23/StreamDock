import { invoke } from "@tauri-apps/api/core";
import type { CommentViewDto } from "../comment-viewer/types";
import type {
  ListViewersInput,
  RecordResult,
  ViewerDetail,
  ViewerImportResult,
  ViewerRecord,
} from "./types";

/**
 * 038a: 視聴者メモリ（Rust 側 SQLite・端末内限定）の Tauri command 薄いラッパ。
 *
 * コンポーネントは invoke を直接呼ばず、この API 経由で操作する。保存は端末内のみで端末外へ出さず、
 * 新規の外部通信・宛先・capability は増えない（受信済みコメントを command で渡すだけ）。
 * `recordComment` 以外（一覧/詳細/メモ/削除）は 038b の UI から使う。
 */

/**
 * 受信済みコメント 1 件を Rust の視聴者メモリへ記録する（視聴者 upsert＋集計・同一 id は冪等）。
 *
 * 038c: 戻り値は判定（初見／久しぶり）。実際に挿入された初回のみ肯定値が返り、重複記録は両方 false。
 */
export function recordComment(
  comment: CommentViewDto,
  sessionId: string,
): Promise<RecordResult> {
  return invoke<RecordResult>("record_comment", { comment, sessionId });
}

/**
 * 受信済みコメント群をまとめて記録する（表示/読み上げを止めない fire-and-forget）。
 *
 * 記録失敗は握り潰す（best-effort）。ログにも本文は出さない（§9）。`comments` は呼び出し側で
 * comment.id 重複排除済み（mergeComments の `added`）で、Rust 側も `INSERT OR IGNORE` で冪等。
 *
 * 038c: `onResult` を渡すと、各コメントの判定（初見／久しぶり）を解決時に `comment.id` 付きで通知する
 * （バッジ表示用）。fire-and-forget は不変で、判定はコメント表示・読み上げより **わずかに遅れて**解決してよい。
 */
export function recordComments(
  comments: CommentViewDto[],
  sessionId: string,
  onResult?: (commentId: string, result: RecordResult) => void,
): void {
  for (const comment of comments) {
    void recordComment(comment, sessionId)
      .then((result) => onResult?.(comment.id, result))
      .catch(() => {
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

/**
 * 065b: 他のコメントビューアーが書き出した CSV（視聴者データ）を取り込んで `viewers` を upsert する。
 *
 * 060b の `importOverlayTheme` と**同型**＝`@tauri-apps/plugin-dialog` の `open()` が返した**生パス**を
 * そのまま渡すだけで、検証（UNC 拒否 → 拡張子 → is_file → サイズ上限 → 実バイト再チェック → UTF-8 →
 * 必須 9 列）はすべて Rust 側が行う。⚠ **frontend は取り込み前のファイルを読む手段を持たない**
 * （`open()` はパス文字列しか返さず `fs:*` は 1 つも付与されていない）＝**プレビューは実装できない**。
 *
 * ⚠ 戻り値は**件数だけ**（`ViewerImportResult`）。視聴者名・メモ・ニックネーム・ラベル・ID は
 * 1 つも載っていない（docs/security.md §9・065a の設計）。
 */
export function importViewerMemoryCsv(
  path: string,
): Promise<ViewerImportResult> {
  return invoke<ViewerImportResult>("import_viewer_memory_csv", { path });
}
