/**
 * 032c-c: コメントビューアの TTS キュー（FIFO 直列・Web Audio 再生）。
 *
 * 取得コメントを VOICEVOX でローカル合成し、音が重ならないよう**直列**に読み上げる。
 * - FIFO 直列 ＋ 再生中フラグ（`onended` で次へ）。
 * - バックログ上限超過は**古い未読から破棄**（最新優先）。
 * - 最小整形（URL 除去・絵文字除去）。**著者名は読まない**（本文のみ）。
 * - id 冪等（単一注入点 = `mergeComments` の新規追加分から呼ばれる）。
 *
 * AudioContext は本キューが 1 つだけ所有し、`dispose` で閉じる。合成 HTTP と再生プリミティブは
 * `voicevox.ts` に閉じ、通信はループバック 50021 のみ（docs/security.md §1 の例外を参照）。
 */

import type { CommentViewDto } from "./types";
import { playWav, synthesize, ZUNDAMON_NORMAL_SPEAKER_ID } from "./voicevox";

/** バックログ上限。超過分は古い未読から破棄する（最新優先）。 */
const MAX_BACKLOG = 20;

/** URL を除去する（`https?://…` の連続非空白）。 */
const URL_RE = /https?:\/\/\S+/g;
/** 絵文字を除去する（Unicode Extended_Pictographic）。 */
const EMOJI_RE = /\p{Extended_Pictographic}/gu;

/**
 * 読み上げ用にコメント本文を最小整形する（URL 除去・絵文字除去・空白畳み込み）。
 * 著者名は対象外（本文のみを読む）。
 */
export function sanitizeForSpeech(text: string): string {
  return text
    .replace(URL_RE, "")
    .replace(EMOJI_RE, "")
    .replace(/\s+/g, " ")
    .trim();
}

export interface TtsQueue {
  /** コメントを読み上げキューに積む（id 冪等・整形後に空ならスキップ）。 */
  enqueue: (comment: CommentViewDto) => void;
  /** AudioContext を resume する（ユーザー操作契機で呼ぶ・WKWebView の autoplay 対策）。 */
  resume: () => Promise<void>;
  /** 破棄（キューを空にし AudioContext を閉じる）。 */
  dispose: () => void;
}

/** 033d: TTS キュー生成時のオプション。 */
export interface TtsQueueOptions {
  /**
   * 合成に使う話者（VOICEVOX style id）を返す getter。合成の直前に呼び、**その時点の選択値**を読む。
   * キューはマウント時に 1 回だけ生成されるため、静的値ではなく getter で受け取ることで、話者変更のたびに
   * キューを作り直さずに済む（グローバル直参照も避ける）。省略・戻り値なしのときは既定 3（ずんだもんノーマル）。
   */
  getSpeakerId?: () => number;
}

/**
 * FIFO 直列の TTS キューを生成する。
 * 再生中は `pump` を起動せず、`onended`（= `playWav` の解決）で次の 1 件へ進む。
 */
export function createTtsQueue(options: TtsQueueOptions = {}): TtsQueue {
  const getSpeakerId = options.getSpeakerId;
  const queue: string[] = [];
  const seenIds = new Set<string>();
  let playing = false;
  let disposed = false;
  const ctx = new AudioContext();

  async function pump(): Promise<void> {
    if (playing || disposed) return;
    const text = queue.shift();
    if (text === undefined) return;
    playing = true;
    try {
      // 032c-b: 実データ配線でコメントはユーザー操作を伴わず届く。AudioContext が suspended のまま
      // playWav に入ると src.start() の onended が発火せず Promise が解決されない＝playing が true 固定で
      // キュー全体が無音ハングする。再生前に resume を試み、それでも running でなければこの 1 件はスキップ
      // する（永久ハングを塞ぐ）。通常フローでは「コメント取得開始」ボタン（ユーザー操作）で先に resume
      // 済みのため、このスキップは初回操作前の例外ケースの保険。
      if (ctx.state !== "running") {
        try {
          await ctx.resume();
        } catch {
          /* resume 不可（gesture 未取得など）はスキップ側で処理する */
        }
      }
      if (ctx.state !== "running") {
        console.debug("TTS: AudioContext が running でないため、この 1 件の読み上げをスキップしました");
        return;
      }
      // `synthesize` は AbortSignal 対応だが、ここでは渡さない（in-flight の合成を dispose で中断しない）。
      // 理由: 宛先は loopback 50021 のみで 1 件の合成は軽量、dispose 後は `disposed` ガードで再生を抑止する
      // ため実害が無い（残るのは高々 1 件の完了済み合成の破棄）。
      // 再検討条件: 実データ配線（032c-b/-d）で高頻度・長文合成が常態化し、アンマウント連打時の無駄合成が
      // 目立つようになったら、queue に AbortController を持たせ dispose で abort する。
      // 033d: 選択話者（style id）で合成する。未選択/getter 未指定は既定 3（ずんだもんノーマル）を維持。
      const speaker = getSpeakerId?.() ?? ZUNDAMON_NORMAL_SPEAKER_ID;
      const wav = await synthesize(text, speaker);
      if (!disposed) await playWav(ctx, wav);
    } catch (e) {
      // 合成/再生に失敗しても直列を止めず次へ継続する（ENGINE 停止などは誘導 UI 側で扱う）。
      console.error("VOICEVOX 読み上げに失敗しました", e);
    } finally {
      playing = false;
      if (!disposed) void pump();
    }
  }

  return {
    enqueue(comment) {
      if (disposed) return;
      if (seenIds.has(comment.id)) return; // 単一注入点の冪等化（二重 enqueue を無害化）。
      seenIds.add(comment.id);
      const text = sanitizeForSpeech(comment.text);
      if (!text) return; // 整形後に空（URL/絵文字のみ 等）なら読み上げない。
      queue.push(text);
      if (queue.length > MAX_BACKLOG) {
        const dropped = queue.length - MAX_BACKLOG;
        queue.splice(0, dropped); // 古い未読から破棄（最新優先）。
        console.debug(`TTS backlog 上限超過: 古い未読 ${dropped} 件を破棄`);
      }
      void pump();
    },
    async resume() {
      if (disposed) return;
      await ctx.resume();
    },
    dispose() {
      disposed = true;
      queue.length = 0;
      void ctx.close();
    },
  };
}
