/**
 * 032c-c: コメントビューアの TTS キュー（FIFO 直列・Web Audio 再生）。
 *
 * 取得コメントを VOICEVOX でローカル合成し、音が重ならないよう**直列**に読み上げる。
 * - FIFO 直列 ＋ 再生中フラグ（`onended` で次へ）。
 * - バックログ上限超過は**古い未読から破棄**（最新優先）。
 * - 最小整形（URL 除去・絵文字除去）。**著者名は読まない**（本文のみ）。
 * - id 冪等（単一注入点 = `mergeComments` の新規追加分から呼ばれる）。
 *
 * `enqueue` の整形パイプラインは **① 入力決定 → ② sanitize → ③ 読み替え(041a) → ④ 切り詰め(048) → ⑤ 空判定 → push**
 * の 5 段で、**分岐を増やさない単一チョークポイント**として維持する（049 は ① だけを差し替える予定）。
 *
 * AudioContext は本キューが 1 つだけ所有し、`dispose` で閉じる。合成 HTTP と再生プリミティブは
 * `voicevox.ts` に閉じ、通信はループバック 50021 のみ（docs/security.md §1 の例外を参照）。
 */

import type { CommentViewDto } from "./types";
import { applyReadingDictionary, type ReadingRule } from "./readingDictionary";
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

/**
 * 048: 上限超過で打ち切ったときに末尾へ足す文字列。
 *
 * 読点を付けるのは、OpenJTalk が読点をアクセント句の区切りに使うため。無いと本文末尾の語と融合して
 * 誤アクセントになりやすく、「一拍おいて以下略」と聞こえる方が打ち切りだと分かりやすい。
 * この文字列は**読み替え辞書（041a）の適用後**に足すので辞書ルールに書き換えられない（意図的）。
 * 代替候補（実機で読みが崩れたら差し替える）: "、以下省略"（辞書語として安定・いかしょうりゃく）／
 * "、いかりゃく"（読みは強制できるがアクセントは OpenJTalk 任せのまま）。
 * ⚠ **差し替えはここ 1 行では終わらない**: `ttsQueue.test.ts` がこの文字列をリテラルで期待している 4 箇所
 * （境界 2 件・290 文字 1 件・サロゲート 1 件）も同時に直すこと。テスト側から定数を import すると
 * 「実装と同じものを実装と比べる」恒真式になって打ち切り表記の仕様を固定できなくなるため、意図的にリテラルのままにしてある。
 */
const SPEECH_ELLIPSIS = "、以下略";

/**
 * 048: 読み上げテキストを `max` 文字で打ち切り、超過分を `SPEECH_ELLIPSIS` に置き換える（**表示は切らない**）。
 *
 * 目的は「長文 1 件の読み上げ中に届いた後続コメントが `MAX_BACKLOG` 超過で無言破棄される」ことの解消
 * （290 文字＝約 48〜64 秒の間に 27〜38 件届き 7〜18 件が捨てられる）。純関数なので単体テストできる
 * （`createTtsQueue` は AudioContext を作るため、切り詰めを `enqueue` に直書きするとテスト不能になる）。
 *
 * **数える単位はコードポイント**（`[...text]`）。`slice` は UTF-16 コードユニット単位でサロゲートペアを割り、
 * 孤立サロゲート「�」を作る。`sanitizeForSpeech` が消すのは絵文字（Extended_Pictographic）だけなので
 * **𠮷 のような非絵文字のサロゲートペアは残る**。`viewerFormat.ts` の `authorInitial` が `charAt(0)` を避けて
 * `[...s]` を使っているのと同じ理由・同じ手段。
 *
 * 既知の割り切り（いずれも意図的・仕様として残す）:
 * - **書記素クラスタでは数えない**（`Intl.Segmenter` を使わない）。絵文字は sanitize 済みなので ZWJ 連結・肌色修飾は
 *   ほぼ残らず、割れて困るのは結合濁点（U+3099）等だけ。結合文字は基底文字の**後ろ**にあるので、切断点で落ちるのは
 *   常に濁点側＝**濁点を失った基底文字**が残る（`が` が `か` と読まれる）。宙に浮いた濁点にはならない。
 *   誤読するのは打ち切り位置の 1 文字だけで直後に「、以下略」が続くため、孤立サロゲートのような壊れ方（表示・読みが
 *   「�」に化ける）とは影響の桁が違う。再検討条件＝実機でこの 1 文字の誤読が耳に付いたら Segmenter を検討する。
 * - **接尾辞は `max` に含めない**（実際に読まれるのは最大 `max + SPEECH_ELLIPSIS.length` 文字）。よって
 *   `max + 1` 文字のコメントは切り詰めた方が僅かに長くなる。避けるにはヒステリシスが要るが複雑さに見合わない。
 * - `max` が非有限・**1 未満**なら**切り詰めない**（防御）。`0 < max < 1` を通すと `slice` の truncate で本文が
 *   0 文字になり「、以下略」だけを読む無意味な出力になるため、`<= 0` ではなく `< 1` で弾く。
 *   `max` は 1 以上の数値が前提（小数は `slice` が truncate する）で、既定値・範囲クランプのポリシーは持たず
 *   `ttsPrefs.ts` が持つ（本関数の呼び出し元は常にクランプ済みの整数を渡す）。
 */
export function capForSpeech(text: string, max: number): string {
  if (!Number.isFinite(max) || max < 1) return text;
  // 高速パス: コードポイント数 ≤ コードユニット数なので、`text.length` が上限以下なら配列化せず確定で素通し。
  if (text.length <= max) return text;
  const chars = [...text];
  if (chars.length <= max) return text;
  return chars.slice(0, max).join("") + SPEECH_ELLIPSIS;
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
  /**
   * 041a: 合成へ渡す前に適用する読み替えルールを返す getter。`enqueue` のたびに呼び**その時点の辞書**を読む
   * （`getSpeakerId` と同じ getter 注入で、辞書更新のたびにキューを作り直さずに済む＝041b のライブマージを見据える）。
   * 省略・戻り値なしのときは空辞書＝素通し（現行動作）。
   */
  getReadingDictionary?: () => ReadingRule[];
  /**
   * 048: 1 件あたりの読み上げ最大文字数（コードポイント数）を返す getter。`enqueue` のたびに呼び**その時点の設定値**を
   * 読む（`getSpeakerId` / `getReadingDictionary` と同じ注入方式＝設定変更でキューを作り直さずに済む）。
   *
   * **省略・戻り値が非有限/1 未満のときは切り詰めない**（既存 getter と同じ「未注入なら現行動作」の作法）。
   * 既定値と範囲クランプは `ttsPrefs.ts` が単独で持つ（キュー → 設定永続化の依存を張らないため、
   * ここに既定値を二重定義しない）。アプリ本体は常にこの getter を注入するので、製品としては省略は常時有効。
   *
   * ⚠ **この optional ＋ `?? Infinity` は、注入が消えた退行を型でもテストでも検出できない**（`getMaxLength` を
   * 渡さなくても typecheck は通り、テストも 1 件も落ちず、上限だけが黙って消える）。それでも required にしないのは、
   * required にすると `ttsQueue` 側に既定値を持たせるか全テスト呼び出しに値を書かせるかになり、
   * 「既定値の定義元は `ttsPrefs.ts` の 1 箇所」という不変条件のほうが壊れるため。
   * 再修正トリガー＝049/050 で `synthesize`/`playWav` をモックしてキュー本体のテストを足すとき、
   * **`getMaxLength` を注入した `enqueue` が実際に切り詰めること**を 1 ケース必ず固定して、この穴を塞ぐこと。
   */
  getMaxLength?: () => number;
}

/**
 * FIFO 直列の TTS キューを生成する。
 * 再生中は `pump` を起動せず、`onended`（= `playWav` の解決）で次の 1 件へ進む。
 */
export function createTtsQueue(options: TtsQueueOptions = {}): TtsQueue {
  const getSpeakerId = options.getSpeakerId;
  const getReadingDictionary = options.getReadingDictionary;
  const getMaxLength = options.getMaxLength;
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
      const sanitized = sanitizeForSpeech(comment.text);
      // 041a: 読み替え辞書を sanitize の後段で適用する（URL/絵文字除去 → 空白畳み込み → 読み替え → trim の順）。
      // 辞書未注入・空辞書のときは applyReadingDictionary が素通しするため、従来と完全に同じ挙動になる。
      // 末尾 .trim() は防御的（sanitize が既に trim 済み・内蔵 reading も前後空白なしのため実質 no-op だが、
      // 将来 reading に前後空白を持つルールが混ざっても空判定を正しくするため残す）。
      const replaced = applyReadingDictionary(
        sanitized,
        getReadingDictionary?.() ?? [],
      ).trim();
      // 048: 読み替え適用の**直後・空判定の前**で読み上げテキストだけを打ち切る（表示は全文のまま）。
      // ここが唯一のチョークポイントで、`enqueue` の 5 段（① 入力決定 → ② sanitize → ③ 読み替え → ④ 切り詰め →
      // ⑤ 空判定 → push）はこの並びを保つこと。**この位置に置く理由は挙動ではなく契約**である:
      // 切り詰めは空文字を生まないので空判定の前後で結果は同じだが、049（`getSpeechText` で ① を差し替える）は
      // 「② 以降は一切変えない」ことを前提にしており、分岐がここ以外に増えると単一チョークポイントが崩れる。
      const text = capForSpeech(replaced, getMaxLength?.() ?? Infinity);
      if (!text) return; // 整形・読み替え適用後に空（URL/絵文字のみ 等）なら読み上げない。
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
