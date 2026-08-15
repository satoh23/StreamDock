import { invoke } from "@tauri-apps/api/core";
import type { StreamSessionRecord } from "../comment-viewer/bindings/StreamSessionRecord";

/**
 * 062b: 配信セッション（Rust 側 SQLite・端末内限定）の Tauri command 薄いラッパ。
 *
 * コンポーネントは invoke を直接呼ばず、この API 経由で操作する。保存は端末内のみで端末外へ出さず、
 * 新規の外部通信・宛先・capability は増えない（`viewerMemoryApi.ts` と同型）。
 *
 * ⚠ 型は Rust の ts-rs binding（`comment-viewer/bindings/StreamSessionRecord`）を正とする。
 * 出力先が `comment-viewer/bindings/` なのは `check:bindings` の列挙に入っているディレクトリだから
 * （理由は Rust 側 `stream_session/model.rs` の注記）。
 */
export type { StreamSessionRecord };

/**
 * 配信セッションを開始する。**進行中があればそれが返る**（Rust 側で冪等）。
 *
 * ⚠ 呼んでよいのは「どれかの provider が `connected` になった」「コメントが届いた」の 2 契機だけ。
 * マウントしただけで呼ぶと**窓を開いた＝配信開始**という誤った境界になる（そこは
 * `getActiveStreamSession` を使う）。
 */
export function startStreamSession(
  platforms: string[],
): Promise<StreamSessionRecord> {
  return invoke<StreamSessionRecord>("start_stream_session", { platforms });
}

/**
 * 進行中の配信セッションを返す（無ければ `null`）。
 *
 * ⚠⚠ **コメビュ窓のマウント時に呼んでセッションを引き継ぐ**のが 062b の主目的
 * （配信中に窓を閉じて開き直しても `session_id` が変わらない）。
 */
export function getActiveStreamSession(): Promise<StreamSessionRecord | null> {
  return invoke<StreamSessionRecord | null>("get_active_stream_session");
}

/** プラットフォームを足す（Rust 側で union・減らない）。 */
export function updateStreamSessionPlatforms(
  id: string,
  platforms: string[],
): Promise<StreamSessionRecord> {
  return invoke<StreamSessionRecord>("update_stream_session_platforms", {
    id,
    platforms,
  });
}

/** 配信セッションを終了する（冪等）。 */
export function endStreamSession(id: string): Promise<StreamSessionRecord> {
  return invoke<StreamSessionRecord>("end_stream_session", { id });
}

/**
 * 配信タイトル（手入力）を更新する。
 *
 * ⚠ 062b の時点では**呼び出す UI がまだ無い**（入力欄は 062c のサマリー画面で足す）。
 * 検証（trim・制御文字拒否・100 文字上限）は Rust 側にあり、Rust のテストが固定している。
 */
export function updateStreamSessionTitle(
  id: string,
  title: string,
): Promise<StreamSessionRecord> {
  return invoke<StreamSessionRecord>("update_stream_session_title", {
    id,
    title,
  });
}

/**
 * 配信セッションの一覧（開始時刻の降順）。
 *
 * ⚠ 062c/062d が使う read-only 経路。**既存データ（`stream_sessions` に行の無い `session_id`）は
 * ここに出てこない**（バックフィルしない＝セッションを捏造しないという 062b の決定）ので、
 * 一覧を出す画面はその旨をユーザーに伝えること。
 */
export function listStreamSessions(): Promise<StreamSessionRecord[]> {
  return invoke<StreamSessionRecord[]>("list_stream_sessions");
}

/**
 * 閉じ忘れたセッションを回収する（戻り値は閉じた件数）。
 *
 * ⚠ **猶予時間は渡せない**（Rust 側の定数）。渡せる形にすると `0` を送るだけで進行中セッションを
 * 全部終了できてしまうため、その能力を構造的に持たせていない（docs/security.md §3）。
 * ⚠ マウント時に `getActiveStreamSession` の**直前**で呼ぶこと——猶予中に窓だけ閉じると
 * 猶予タイマーごと消えるので、これを挟まないと**前回の配信を今回の配信として引き継いでしまう**。
 */
export function closeStaleStreamSessions(): Promise<number> {
  return invoke<number>("close_stale_stream_sessions");
}
