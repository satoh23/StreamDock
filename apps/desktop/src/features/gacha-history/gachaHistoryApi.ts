import { invoke } from "@tauri-apps/api/core";
import type { NewGachaDraw } from "../comment-viewer/bindings/NewGachaDraw";
import type { GachaDrawRecord } from "../comment-viewer/bindings/GachaDrawRecord";
import type { GachaDrawOutcome } from "../../screens/obs-effects/effectFire";

/**
 * 063h: ガチャ抽選結果の記録（Rust 側 SQLite・端末内限定）の Tauri command 薄いラッパ。
 * ⚠ 063i で**読み出し**（[`listGachaDraws`]）が 1 本増えたが、**保存は 1 ミリも動いていない**
 * （テーブルも列もコマンドの権限も増えていない＝読んで表示するだけ）。
 *
 * コンポーネントは invoke を直接呼ばず、この API 経由で記録する
 * （`viewerMemoryApi.ts` / `streamSessionApi.ts` と同型）。
 *
 * ⚠ 型は Rust の ts-rs binding（`comment-viewer/bindings/`）を正とする。出力先が
 * `comment-viewer/bindings/` なのは `check:bindings` の列挙に入っているディレクトリだから
 * （理由は Rust 側 `gacha_history/model.rs` の注記）。⚠ **7 つ目のディレクトリを作らないこと。**
 *
 * ## セキュリティ（docs/security.md §9 追補〔063h〕）
 *
 * ⚠⚠ **新規の外部通信・宛先・capability は増えない**（受信済みの値を端末内 SQLite へ書くだけ）。
 * ⚠⚠⚠ **記録レーンの値は配信面へ 1 バイトも出ない**——この経路の先は SQLite だけで、
 * `emitGachaStageResult`（ステージ窓）にも `sendGachaChat`（配信のチャット）にも繋がっていない。
 * ⚠ **ここから演出・チャットへ値を渡す関数を足さないこと**（追補の「線をレーンごとに引き直す」節が正）。
 */
export type { NewGachaDraw, GachaDrawRecord };

/**
 * 抽選 1 回を記録する（⚠ **fire-and-forget**＝失敗しても演出・チャット・表示を止めない）。
 *
 * ⚠⚠ **失敗を握り潰すのは `recordComments` と同じ best-effort の作法**である。
 * ⚠⚠⚠ **そのぶん「記録されなかったこと」は画面のどこにも出ない**ので、
 * **セッション id が未確定のあいだは捨てずに貯める**こと（`pendingGachaDraws.ts`）。
 * ⚠ §9: 例外の中身をログにも画面にも出さない（`console.*` も書かない）。
 *
 * ## ⚠⚠ 063h レビュー S-4 / Q-4: 画面に出る取りこぼしは **バッファ溢れだけ**である
 *
 * ツールバーの「記録できなかったガチャ N 件」が数えているのは
 * **セッション未確定のバッファが上限を超えて捨てた件数だけ**で、⚠ **ここから先の失敗は数えない**:
 *
 * - Rust の検証で弾かれたもの（`gacha_history::service::record` の §8）
 * - `invoke` 自体が失敗したもの（DB が壊れている等）
 *
 * ⚠⚠ **これは意図的である**——数えるには `await` して結果を待つ必要があり、
 * **best-effort（本線を止めない）と両立しない**。⇒ 代わりに**弾かれる条件を緩く保つ**ことで
 * 実質到達しないようにしている（上限 200 の根拠＝Rust 側 `MAX_GACHA_TEXT_CHARS` の注記が正）。
 * ⚠ **再修正トリガー＝実機で「当たったのにサマリーに無い」が出て、原因が検証弾きだったとき。**
 *   そのときは `await` を足すのではなく、**弾かれた件数だけを Rust から別経路で拾う**こと。
 */
export function recordGachaDraws(
  draws: readonly GachaDrawOutcome[],
  sessionId: string,
): void {
  for (const draw of draws) {
    void invoke("record_gacha_draw", { draw: toNewGachaDraw(draw, sessionId) }).catch(
      () => {
        /* 記録の失敗は演出・チャット・表示を妨げない（best-effort）。 */
      },
    );
  }
}

/**
 * 記録レーンの値を Rust の入力 DTO へ移す。
 *
 * ⚠⚠⚠ **記録 id はここで組む**（`${commentId}:${gachaId}:${nth}`＝穴 A）。
 * **決定的な文字列**なので、StrictMode の二重実行でも再送でも Rust 側の `INSERT OR IGNORE` が
 * 弾いて**行が増えない**。⚠ `nth` は「そのコメントの中で何回目のガチャ抽選か」で、
 * **同じコメントで 2 つの条件が当たったケースを潰さない**ためにある。
 * ⚠⚠ **Rust 側でこの形をパースしないこと**（形は frontend の実装都合＝あちらの `model.rs` が正）。
 *
 * ⚠ `prizeLabel` は **`null` を `undefined` へ倒す**——binding が `prizeLabel?: string`
 * （`#[ts(optional)]`）なので `null` は型に入らない。⚠⚠ serde 側はどちらでも `None` になる
 * （欠けているフィールドの `Option<T>` は既定で `None`）。
 */
function toNewGachaDraw(
  draw: GachaDrawOutcome,
  sessionId: string,
): NewGachaDraw {
  return {
    id: `${draw.commentId}:${draw.gachaId}:${draw.nth}`,
    sessionId,
    viewerId: draw.viewerId,
    viewerName: draw.viewerName,
    gachaId: draw.gachaId,
    gachaName: draw.gachaName,
    ...(draw.prizeLabel === null ? {} : { prizeLabel: draw.prizeLabel }),
    rare: draw.rare,
    drawnAt: draw.drawnAt,
  };
}

/**
 * 063i: 1 回の配信ぶんのガチャ抽選記録を**新しい順**（`drawnAt` 降順）で取得する。read-only。
 *
 * ⚠⚠ **引数はセッション id 1 つだけ**（docs/security.md §3・§9 追補〔063h〕）。
 * 「任意の条件で絞る」引数を足さないこと——アプリ定義コマンドは **ACL を通らず全窓から呼べる**ので、
 * 能力を構造側に持たせない。
 *
 * ⚠ **記録の無い配信は空配列**で返る（`get_stream_summary` と違って `NotFound` にならない）。
 * 記録は遡れないので、063h より前の配信は必ず空になる＝**それは失敗ではない**。
 * ⚠⚠ 画面はこれを**説明文で書かない**（2026-08-16 の決定・`SummaryView.tsx` 冒頭を参照）——
 * 空の 1 行だけがユーザーに見える。
 *
 * ⚠⚠⚠ **上限・ページングは持たない**（切るのは画面側＝`SUMMARY_GACHA_DRAW_LIMIT`）。
 * ⚠ 行数が実際に問題になったら、画面の定数を上げるのではなく **Rust 側にページングを入れる**こと
 * （そのとき §3 の「引数はセッション id 1 つ」を読み直す）。
 *
 * ⚠ 返る行は**発火レーンが作ったものとは限らない**（§9 追補〔063h〕レビュー S-3）。
 * `viewers` にも `stream_sessions` にも対応行を持たない行が来ても、**画面が落ちないこと**。
 */
export function listGachaDraws(sessionId: string): Promise<GachaDrawRecord[]> {
  return invoke<GachaDrawRecord[]>("list_gacha_draws", { sessionId });
}
