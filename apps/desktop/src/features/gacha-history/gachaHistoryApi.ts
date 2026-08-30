import { invoke } from "@tauri-apps/api/core";
import type { NewGachaDraw } from "../comment-viewer/bindings/NewGachaDraw";
import type { GachaDrawOutcome } from "../../screens/obs-effects/effectFire";

/**
 * 063h: ガチャ抽選結果の記録（Rust 側 SQLite・端末内限定）の Tauri command 薄いラッパ。
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
export type { NewGachaDraw };

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
