import { invoke } from "@tauri-apps/api/core";
import type { StreamSummary } from "../comment-viewer/bindings/StreamSummary";
import type { Contributor } from "../comment-viewer/bindings/Contributor";
import type { CurrencyTotal } from "../comment-viewer/bindings/CurrencyTotal";
import type { MonetaryKindTotal } from "../comment-viewer/bindings/MonetaryKindTotal";
import type { RaidRecord } from "../comment-viewer/bindings/RaidRecord";

/**
 * 062c: 配信サマリー（Rust 側 SQLite・端末内限定）の Tauri command 薄いラッパ。
 *
 * コンポーネントは invoke を直接呼ばず、この API 経由で取得する。集計は端末内で完結し、
 * **新規の外部通信・宛先・capability は増えない**（`streamSessionApi.ts` と同型）。
 *
 * ⚠ 型は Rust の ts-rs binding（`comment-viewer/bindings/`）を正とする。出力先が
 * `comment-viewer/bindings/` なのは `check:bindings` の列挙に入っているディレクトリだから
 * （理由は Rust 側 `stream_summary/model.rs` の注記）。
 */
export type {
  StreamSummary,
  Contributor,
  CurrencyTotal,
  MonetaryKindTotal,
  RaidRecord,
};

/**
 * 1 回の配信（`sessionId`）ぶんの集計を取得する。read-only。
 *
 * ⚠ **結果は保存されない**（Rust 側にキャッシュテーブルを作っていない＝docs/security.md §9 の判断を
 * やり直さないため）。都度計算なので、画面は「開いたとき」と「更新ボタン」でだけ呼ぶこと
 * ——配信中にポーリングすると、コメントが一番多い時間帯に毎回フル集計が走る。
 * ⚠ 062b 以前の `sessionId`（`stream_sessions` に対応行が無い）は **NotFound で reject する**。
 * バックフィルしない＝セッションを捏造しないという 062b の決定。
 * ⚠⚠ **画面はこれを説明文で書かない**（2026-08-16 の決定・`SummaryView.tsx` 冒頭を参照）＝
 * 一覧に出ないという事実だけがユーザーに見える。**ここに「注記で伝えること」と書き戻さないこと。**
 */
export function getStreamSummary(sessionId: string): Promise<StreamSummary> {
  return invoke<StreamSummary>("get_stream_summary", { sessionId });
}
